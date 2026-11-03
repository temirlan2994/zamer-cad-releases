// Минимальный разбор текстового DXF для подложки-топосъёмки.
// Поддержаны LINE, LWPOLYLINE, POLYLINE/VERTEX, SPLINE, CIRCLE, ARC, ELLIPSE,
// POINT, TEXT/MTEXT/ATTRIB, SOLID/3DFACE, INSERT. Отметки высот (Z у POINT,
// вершин 3D-полилиний и 3DFACE, подписи «123.45») — extractDxfElevations.
// DWG (бинарный) так читать нельзя — только DXF.

// Единицы чертежа ($INSUNITS) → миллиметры.
const UNIT_TO_MM = { 1: 25.4, 2: 304.8, 4: 1, 5: 10, 6: 1000, 8: 0.001, 13: 1e-6 };

// Миллиметров в единице чертежа (по $INSUNITS; без него — метры, как в съёмке).
export function dxfUnitMm(parsed, defaultUnitMm = 1000) {
  return UNIT_TO_MM[parsed?.insunits] || defaultUnitMm;
}

export function parseDxf(text) {
  const raw = text.split(/\r\n|\r|\n/);
  const pairs = [];
  for (let i = 0; i + 1 < raw.length; i += 2) {
    const code = parseInt(raw[i].trim(), 10);
    if (Number.isNaN(code)) continue;
    pairs.push({ code, value: raw[i + 1] });
  }
  let insunits = null;
  for (let i = 0; i < pairs.length - 1; i += 1) {
    if (pairs[i].code === 9 && pairs[i].value.trim() === '$INSUNITS') {
      insunits = parseInt(pairs[i + 1].value.trim(), 10);
      break;
    }
  }
  // Группы по коду 0.
  const groups = [];
  let cur = null;
  for (const p of pairs) {
    if (p.code === 0) { if (cur) groups.push(cur); cur = { type: p.value.trim(), codes: [] }; }
    else if (cur) cur.codes.push(p);
  }
  if (cur) groups.push(cur);
  // Разметка секций ($SEC) и подсчёт типов.
  let section = null;
  const typeCounts = {};
  for (const g of groups) {
    if (g.type === 'SECTION') { const f = g.codes.find((c) => c.code === 2); section = f ? f.value.trim() : null; }
    g._sec = section;
    if (g.type === 'ENDSEC') section = null;
    typeCounts[g.type] = (typeCounts[g.type] || 0) + 1;
  }
  const gnum = (g, code) => { const f = g.codes.find((c) => c.code === code); return f ? parseFloat(f.value) : undefined; };
  const gall = (g, code) => g.codes.filter((c) => c.code === code).map((c) => parseFloat(c.value));
  const gstr = (g, code) => { const f = g.codes.find((c) => c.code === code); return f ? f.value : undefined; };

  // Считывает один объект (и VERTEX-ы для POLYLINE). Возвращает {ents, skip}.
  function readEntity(arr, idx) {
    const g = arr[idx];
    const ents = [];
    let skip = 0;
    switch (g.type) {
      case 'LINE': ents.push({ type: 'line', x1: gnum(g, 10), y1: gnum(g, 20), x2: gnum(g, 11), y2: gnum(g, 21) }); break;
      case 'LWPOLYLINE': {
        const xs = gall(g, 10); const ys = gall(g, 20);
        const elev = gnum(g, 38); // отметка плоской полилинии (горизонтали)
        const pts = xs.map((x, i) => ({ x, y: ys[i] })).filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
        if (pts.length) ents.push({ type: 'poly', pts, closed: Boolean((gnum(g, 70) || 0) & 1), elev: Number.isFinite(elev) && elev !== 0 ? elev : undefined });
        break;
      }
      case 'POLYLINE': {
        const pts = []; const flags = gnum(g, 70) || 0; const closed = Boolean(flags & 1);
        const is3d = Boolean(flags & 8);
        const elev = gnum(g, 30); // у 2D-полилинии Z «фиктивной точки» — отметка
        let j = idx + 1;
        for (; j < arr.length && arr[j].type === 'VERTEX'; j += 1) {
          const x = gnum(arr[j], 10); const y = gnum(arr[j], 20); const z = gnum(arr[j], 30);
          if (Number.isFinite(x) && Number.isFinite(y)) pts.push(is3d && Number.isFinite(z) ? { x, y, z } : { x, y });
        }
        skip = j - idx - 1;
        if (pts.length) ents.push({ type: 'poly', pts, closed, elev: !is3d && Number.isFinite(elev) && elev !== 0 ? elev : undefined });
        break;
      }
      case 'SPLINE': {
        let xs = gall(g, 11); let ys = gall(g, 21);
        if (!xs.length) { xs = gall(g, 10); ys = gall(g, 20); }
        const pts = xs.map((x, i) => ({ x, y: ys[i] })).filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
        if (pts.length >= 2) ents.push({ type: 'poly', pts, closed: false });
        break;
      }
      case 'CIRCLE': ents.push({ type: 'circle', cx: gnum(g, 10), cy: gnum(g, 20), r: gnum(g, 40) }); break;
      case 'ARC': ents.push({ type: 'arc', cx: gnum(g, 10), cy: gnum(g, 20), r: gnum(g, 40), a1: gnum(g, 50), a2: gnum(g, 51) }); break;
      case 'ELLIPSE': ents.push({ type: 'ellipse', cx: gnum(g, 10), cy: gnum(g, 20), mx: gnum(g, 11), my: gnum(g, 21), ratio: gnum(g, 40) ?? 1, a1: gnum(g, 41) ?? 0, a2: gnum(g, 42) ?? (Math.PI * 2) }); break;
      case 'POINT': ents.push({ type: 'point', x: gnum(g, 10), y: gnum(g, 20), z: gnum(g, 30) }); break;
      case 'TEXT': { const t = gstr(g, 1); if (t) ents.push({ type: 'text', x: gnum(g, 10), y: gnum(g, 20), h: gnum(g, 40) || 2.5, text: t, rot: gnum(g, 50) || 0 }); break; }
      case 'ATTRIB': {
        // Атрибут блока (часто — отметка у геодезической точки); невидимые пропускаем.
        const t = gstr(g, 1);
        if (t && !((gnum(g, 70) || 0) & 1)) ents.push({ type: 'text', x: gnum(g, 10), y: gnum(g, 20), h: gnum(g, 40) || 2.5, text: t, rot: gnum(g, 50) || 0 });
        break;
      }
      case 'MTEXT': {
        const parts = g.codes.filter((c) => c.code === 1 || c.code === 3).map((c) => c.value);
        const t = parts.join('').replace(/\\[A-Za-z][^;]*;|[{}]/g, '');
        if (t) ents.push({ type: 'text', x: gnum(g, 10), y: gnum(g, 20), h: gnum(g, 40) || 2.5, text: t, rot: 0 });
        break;
      }
      case 'SOLID': case '3DFACE': {
        const xs = gall(g, 10).concat(gall(g, 11), gall(g, 12), gall(g, 13));
        const ys = gall(g, 20).concat(gall(g, 21), gall(g, 22), gall(g, 23));
        const zs = gall(g, 30).concat(gall(g, 31), gall(g, 32), gall(g, 33));
        const face = g.type === '3DFACE' && zs.length === xs.length;
        const pts = xs.map((x, i) => (face ? { x, y: ys[i], z: zs[i] } : { x, y: ys[i] }))
          .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
        if (pts.length >= 3) ents.push({ type: 'poly', pts, closed: true, face: face || undefined });
        break;
      }
      case 'INSERT': ents.push({ type: 'insert', name: gstr(g, 2), x: gnum(g, 10) || 0, y: gnum(g, 20) || 0, z: gnum(g, 30) || 0, sx: gnum(g, 41) ?? 1, sy: gnum(g, 42) ?? 1, sz: gnum(g, 43) ?? 1, rot: gnum(g, 50) || 0 }); break;
      default: break;
    }
    return { ents, skip };
  }

  // Определения блоков (секция BLOCKS): имя → {base, items}.
  const blockDefs = {};
  for (let i = 0; i < groups.length; i += 1) {
    if (groups[i].type === 'BLOCK' && groups[i]._sec === 'BLOCKS') {
      const name = gstr(groups[i], 2);
      const base = { x: gnum(groups[i], 10) || 0, y: gnum(groups[i], 20) || 0 };
      const items = [];
      let j = i + 1;
      for (; j < groups.length && groups[j].type !== 'ENDBLK'; j += 1) {
        const r = readEntity(groups, j);
        for (const e of r.ents) items.push(e);
        j += r.skip;
      }
      if (name) blockDefs[name] = { base, items };
      i = j;
    }
  }

  const tfPoint = (p, tf) => {
    const lx = (p.x - tf.base.x) * tf.sx;
    const ly = (p.y - tf.base.y) * tf.sy;
    const c = Math.cos(tf.rot); const s = Math.sin(tf.rot);
    const out = { x: tf.x + lx * c - ly * s, y: tf.y + lx * s + ly * c };
    if (Number.isFinite(p.z)) out.z = (tf.z || 0) + p.z * (tf.sz ?? 1);
    return out;
  };
  const tfEnt = (e, tf) => {
    const sc = (Math.abs(tf.sx) + Math.abs(tf.sy)) / 2;
    const degRot = (tf.rot * 180) / Math.PI;
    if (e.type === 'line') { const a = tfPoint({ x: e.x1, y: e.y1 }, tf); const b = tfPoint({ x: e.x2, y: e.y2 }, tf); return { type: 'line', x1: a.x, y1: a.y, x2: b.x, y2: b.y }; }
    if (e.type === 'poly') {
      return {
        type: 'poly', closed: e.closed, face: e.face, pts: e.pts.map((p) => tfPoint(p, tf)),
        elev: e.elev !== undefined ? (tf.z || 0) + e.elev * (tf.sz ?? 1) : undefined,
      };
    }
    if (e.type === 'circle') { const c = tfPoint({ x: e.cx, y: e.cy }, tf); return { type: 'circle', cx: c.x, cy: c.y, r: e.r * sc }; }
    if (e.type === 'arc') { const c = tfPoint({ x: e.cx, y: e.cy }, tf); return { type: 'arc', cx: c.x, cy: c.y, r: e.r * sc, a1: e.a1 + degRot, a2: e.a2 + degRot }; }
    if (e.type === 'ellipse') { const c = tfPoint({ x: e.cx, y: e.cy }, tf); return { type: 'ellipse', cx: c.x, cy: c.y, mx: e.mx * sc, my: e.my * sc, ratio: e.ratio, a1: e.a1, a2: e.a2 }; }
    if (e.type === 'point') { const c = tfPoint({ x: e.x, y: e.y, z: e.z }, tf); return { type: 'point', x: c.x, y: c.y, z: c.z }; }
    if (e.type === 'text') { const c = tfPoint({ x: e.x, y: e.y }, tf); return { type: 'text', x: c.x, y: c.y, h: e.h * sc, text: e.text, rot: e.rot + degRot }; }
    return null;
  };
  // Разворачивает INSERT в примитивы (рекурсивно, с ограничением глубины).
  function expand(ins, depth, out) {
    if (depth > 6) return;
    const def = blockDefs[ins.name];
    if (!def) return;
    const tf = { x: ins.x, y: ins.y, z: ins.z || 0, sx: ins.sx, sy: ins.sy, sz: ins.sz ?? 1, rot: (ins.rot * Math.PI) / 180, base: def.base };
    for (const e of def.items) {
      if (e.type === 'insert') {
        const np = tfPoint({ x: e.x, y: e.y }, tf);
        expand({ name: e.name, x: np.x, y: np.y, z: (tf.z || 0) + (e.z || 0) * (tf.sz ?? 1), sx: e.sx * tf.sx, sy: e.sy * tf.sy, sz: (e.sz ?? 1) * (tf.sz ?? 1), rot: e.rot + ins.rot }, depth + 1, out);
      } else { const t = tfEnt(e, tf); if (t) out.push(t); }
    }
  }

  // Модельное пространство (секция ENTITIES).
  const entities = [];
  const collect = (filterSec) => {
    for (let i = 0; i < groups.length; i += 1) {
      if (filterSec && groups[i]._sec !== 'ENTITIES') continue;
      const r = readEntity(groups, i);
      i += r.skip;
      for (const e of r.ents) { if (e.type === 'insert') expand(e, 0, entities); else entities.push(e); }
    }
  };
  collect(true);
  // Запас: если в ENTITIES ничего не нашли — пробуем по всему файлу.
  if (!entities.length) collect(false);

  return { entities, insunits, typeCounts };
}

// Короткая сводка типов объектов DXF (для подсказки/диагностики).
export function dxfTypeSummary(parsed, limit = 5) {
  const entries = Object.entries(parsed.typeCounts || {})
    .filter(([t]) => t && t !== 'ENDSEC' && t !== 'SECTION' && t !== 'EOF' && t !== 'ENDBLK' && t !== 'SEQEND' && t !== 'VERTEX')
    .sort((a, b) => b[1] - a[1]);
  return entries.slice(0, limit).map(([t, n]) => `${t}×${n}`).join(', ');
}

// Подпись отметки: «123.45», «123,45», «+0.50», допускается «м» в конце.
const ELEV_TEXT_RE = /^[+-]?\d{1,5}[.,]\d{1,3}\s*(м|m)?$/i;

// Отметки высот из разобранного DXF (для рельефа, core/terrain.js):
//  — POINT с Z (код 30); Z — в единицах чертежа, как XY ($INSUNITS);
//  — подписи TEXT/MTEXT/ATTRIB вида «123.45» (метры): рядом с POINT (в
//    радиусе 2 высот текста) — отметка этой точки, иначе — сама по себе в
//    точке вставки текста;
//  — вершины 3DFACE и 3D-полилиний с Z, горизонтали с отметкой (код 38).
// Возвращает { marks: [{x, y, z}] — x, y в единицах чертежа, z в мм;
//   counts: { points, labels, vertices }, unitMm }.
export function extractDxfElevations(parsed, { defaultUnitMm = 1000, maxMarks = 4000 } = {}) {
  const unitMm = dxfUnitMm(parsed, defaultUnitMm);
  const ents = parsed?.entities || [];
  const fin = (v) => Number.isFinite(v);
  const points = ents.filter((e) => e.type === 'point' && fin(e.x) && fin(e.y))
    .map((e) => ({ x: e.x, y: e.y, z: fin(e.z) && e.z !== 0 ? e.z * unitMm : null, label: null }));
  let labels = [];
  for (const e of ents) {
    if (e.type !== 'text' || !fin(e.x) || !fin(e.y)) continue;
    const t = String(e.text).trim();
    if (!ELEV_TEXT_RE.test(t)) continue;
    const v = Number(t.replace(/\s*(м|m)$/i, '').replace(',', '.'));
    if (fin(v)) labels.push({ x: e.x, y: e.y, h: e.h || 2.5, z: v * 1000 });
  }
  // Отсев посторонних чисел (размеры, площади): отметки участка лежат рядом
  // друг с другом — дальше 100 м от медианы не бывает.
  if (labels.length > 2) {
    const sorted = labels.map((l) => l.z).sort((a, b) => a - b);
    const med = sorted[Math.floor(sorted.length / 2)];
    labels = labels.filter((l) => Math.abs(l.z - med) <= 100000);
  }
  // Привязка подписи к ближайшей точке в радиусе 2 высот текста.
  if (points.length && labels.length) {
    const cell = Math.max(1e-9, Math.max(...labels.map((l) => l.h)) * 2);
    const grid = new Map();
    points.forEach((p, i) => {
      const k = `${Math.floor(p.x / cell)},${Math.floor(p.y / cell)}`;
      if (!grid.has(k)) grid.set(k, []);
      grid.get(k).push(i);
    });
    for (const l of labels) {
      const cx = Math.floor(l.x / cell); const cy = Math.floor(l.y / cell);
      let best = null;
      for (let i = -1; i <= 1; i += 1) {
        for (let j = -1; j <= 1; j += 1) {
          for (const idx of grid.get(`${cx + i},${cy + j}`) || []) {
            const p = points[idx];
            if (p.label) continue;
            const d = Math.hypot(p.x - l.x, p.y - l.y);
            if (d <= l.h * 2 && (!best || d < best.d)) best = { d, idx };
          }
        }
      }
      if (best) { points[best.idx].label = l; l.used = true; }
    }
  }
  const counts = { points: 0, labels: 0, vertices: 0 };
  const raw = [];
  for (const p of points) {
    const z = p.z ?? p.label?.z ?? null;
    if (z == null) continue;
    raw.push({ x: p.x, y: p.y, z });
    counts.points += 1;
  }
  for (const l of labels) {
    if (l.used) continue;
    raw.push({ x: l.x, y: l.y, z: l.z });
    counts.labels += 1;
  }
  for (const e of ents) {
    if (e.type !== 'poly') continue;
    for (const p of e.pts) {
      const z = fin(p.z) ? p.z : e.elev;
      if (!fin(z) || z === 0 || !fin(p.x) || !fin(p.y)) continue;
      if (!e.face && !fin(p.z) && e.elev === undefined) continue;
      raw.push({ x: p.x, y: p.y, z: z * unitMm, vertex: true });
    }
  }
  // Дубликаты (общие вершины граней, точка + подпись) и прореживание.
  let minX = Infinity; let maxX = -Infinity; let minY = Infinity; let maxY = -Infinity;
  for (const m of raw) {
    if (m.x < minX) minX = m.x; if (m.x > maxX) maxX = m.x;
    if (m.y < minY) minY = m.y; if (m.y > maxY) maxY = m.y;
  }
  const span = Math.max(maxX - minX, maxY - minY) || 1;
  const tol = span / 2000;
  const seen = new Set();
  let marks = [];
  for (const m of raw) {
    const k = `${Math.round(m.x / tol)},${Math.round(m.y / tol)}`;
    if (seen.has(k)) continue;
    seen.add(k);
    if (m.vertex) counts.vertices += 1;
    marks.push({ x: m.x, y: m.y, z: Math.round(m.z * 100) / 100 });
  }
  if (marks.length > maxMarks) {
    const stride = marks.length / maxMarks;
    marks = Array.from({ length: maxMarks }, (_, i) => marks[Math.floor(i * stride)]);
  }
  return { marks, counts, unitMm };
}

// Растрирует разобранный DXF в canvas-изображение. Возвращает dataURL, размер
// в пикселях и реальную ширину в мм (по $INSUNITS; по умолчанию — метры).
export function dxfToImage(parsed, { targetMax = 2200, defaultUnitMm = 1000 } = {}) {
  const { entities } = parsed;
  // Собираем все вершины. В геодезических DXF часто есть одиночные выносные
  // точки/рамки далеко от участка — они раздувают габарит, из-за чего сам
  // чертёж становится микроскопическим. Поэтому границы берём РОБАСТНО: по
  // перцентилям (1–99%), отсекая выбросы.
  const xs = [];
  const ys = [];
  const add = (x, y) => { if (Number.isFinite(x) && Number.isFinite(y)) { xs.push(x); ys.push(y); } };
  for (const e of entities) {
    if (e.type === 'line') { add(e.x1, e.y1); add(e.x2, e.y2); }
    else if (e.type === 'poly') { for (const p of e.pts) add(p.x, p.y); }
    else if (e.type === 'circle' || e.type === 'arc') { add(e.cx - e.r, e.cy - e.r); add(e.cx + e.r, e.cy + e.r); }
    else if (e.type === 'ellipse') { const rr = Math.hypot(e.mx, e.my); add(e.cx - rr, e.cy - rr); add(e.cx + rr, e.cy + rr); }
    else if (e.type === 'point' || e.type === 'text') { add(e.x, e.y); }
  }
  if (!xs.length) {
    throw new Error('в DXF не найдено геометрии (линии/полилинии)');
  }
  const sx = [...xs].sort((a, b) => a - b);
  const sy = [...ys].sort((a, b) => a - b);
  // Робастные границы по межквартильному размаху (IQR): отбрасываем далёкие
  // выбросы (выносные точки/рамки), но не обрезаем нормальный разброс.
  const quart = (arr, p) => arr[Math.min(arr.length - 1, Math.max(0, Math.floor((arr.length - 1) * p)))];
  const robust = (arr) => {
    const q1 = quart(arr, 0.25);
    const q3 = quart(arr, 0.75);
    const iqr = q3 - q1 || Math.max(1, Math.abs(q3));
    const lo = q1 - 3 * iqr;
    const hi = q3 + 3 * iqr;
    let mn = Infinity;
    let mx = -Infinity;
    for (const v of arr) { if (v >= lo && v <= hi) { if (v < mn) mn = v; if (v > mx) mx = v; } }
    if (mn === Infinity) { mn = arr[0]; mx = arr[arr.length - 1]; }
    return [mn, mx];
  };
  let [minX, maxX] = robust(sx);
  let [minY, maxY] = robust(sy);
  if (maxX - minX < 1e-6) { minX = sx[0]; maxX = sx[sx.length - 1]; }
  if (maxY - minY < 1e-6) { minY = sy[0]; maxY = sy[sy.length - 1]; }
  if (maxX <= minX || maxY <= minY) {
    throw new Error('в DXF не найдено геометрии (линии/полилинии)');
  }
  const wU = maxX - minX;
  const hU = maxY - minY;
  const pad = Math.max(wU, hU) * 0.02 + 1;
  const bx = minX - pad;
  const by = minY - pad;
  const bw = wU + pad * 2;
  const bh = hU + pad * 2;
  const k = targetMax / Math.max(bw, bh);
  const W = Math.max(1, Math.round(bw * k));
  const H = Math.max(1, Math.round(bh * k));
  const cnv = document.createElement('canvas');
  cnv.width = W;
  cnv.height = H;
  const c = cnv.getContext('2d');
  c.fillStyle = '#ffffff';
  c.fillRect(0, 0, W, H);
  c.strokeStyle = '#1a2330';
  c.lineWidth = 1;
  c.lineJoin = 'round';
  c.lineCap = 'round';
  const tx = (x) => (x - bx) * k;
  const ty = (y) => H - (y - by) * k; // DXF: Y вверх → канвас: Y вниз
  // Марка точки — крестик, заметный после уменьшения (в масштабе чертежа).
  const ptArm = Math.max(3, Math.max(bw, bh) * k * 0.004);
  c.fillStyle = '#1a2330';
  c.textBaseline = 'alphabetic';
  for (const e of entities) {
    if (e.type === 'text') {
      if (!e.text) continue;
      const fs = Math.max(6, (e.h || 2.5) * k);
      c.font = `${fs}px system-ui, sans-serif`;
      c.save();
      c.translate(tx(e.x), ty(e.y));
      if (e.rot) c.rotate(-(e.rot * Math.PI) / 180);
      c.fillText(e.text, 0, 0);
      c.restore();
      continue;
    }
    c.beginPath();
    if (e.type === 'line') {
      c.moveTo(tx(e.x1), ty(e.y1));
      c.lineTo(tx(e.x2), ty(e.y2));
      c.stroke();
    } else if (e.type === 'poly') {
      e.pts.forEach((p, idx) => { const X = tx(p.x); const Y = ty(p.y); if (idx) c.lineTo(X, Y); else c.moveTo(X, Y); });
      if (e.closed) c.closePath();
      c.stroke();
    } else if (e.type === 'circle') {
      c.arc(tx(e.cx), ty(e.cy), e.r * k, 0, Math.PI * 2);
      c.stroke();
    } else if (e.type === 'arc') {
      // Y инвертирован → углы идут по часовой; меняем знак и порядок.
      c.arc(tx(e.cx), ty(e.cy), e.r * k, -(e.a2 * Math.PI) / 180, -(e.a1 * Math.PI) / 180);
      c.stroke();
    } else if (e.type === 'ellipse') {
      const major = Math.hypot(e.mx, e.my) * k;
      const minor = major * (e.ratio || 1);
      const rot = Math.atan2(e.my, e.mx);
      c.ellipse(tx(e.cx), ty(e.cy), major, minor, -rot, 0, Math.PI * 2);
      c.stroke();
    } else if (e.type === 'point') {
      c.moveTo(tx(e.x) - ptArm, ty(e.y));
      c.lineTo(tx(e.x) + ptArm, ty(e.y));
      c.moveTo(tx(e.x), ty(e.y) - ptArm);
      c.lineTo(tx(e.x), ty(e.y) + ptArm);
      c.stroke();
    }
  }
  const unitMm = dxfUnitMm(parsed, defaultUnitMm);
  const worldWidthMm = bw * unitMm;
  // Масштаб считаем надёжным только если реальный размер правдоподобный
  // (от 0.5 м до 2 км). Иначе единицы угаданы неверно — пусть пользователь
  // задаст масштаб по отрезку, а картинку поставим удобного размера.
  const reliableScale = worldWidthMm >= 500 && worldWidthMm <= 2_000_000;
  return {
    dataUrl: cnv.toDataURL('image/png'),
    size: { w: W, h: H },
    worldWidthMm,
    worldWidthM: worldWidthMm / 1000,
    reliableScale,
    hadUnits: Boolean(UNIT_TO_MM[parsed.insunits]),
    entityCount: entities.length,
    // Единицы чертежа → пиксели картинки: px = (x − bx)·k, py = H − (y − by)·k.
    transform: { bx, by, k, H },
  };
}
