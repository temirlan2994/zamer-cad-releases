// Минимальный разбор текстового DXF для подложки-топосъёмки.
// Поддержаны LINE, LWPOLYLINE, POLYLINE/VERTEX, CIRCLE, ARC, POINT.
// DWG (бинарный) так читать нельзя — только DXF.

// Единицы чертежа ($INSUNITS) → миллиметры.
const UNIT_TO_MM = { 1: 25.4, 2: 304.8, 4: 1, 5: 10, 6: 1000, 8: 0.001, 13: 1e-6 };

export function parseDxf(text) {
  const raw = text.split(/\r\n|\r|\n/);
  // Пары «код / значение».
  const pairs = [];
  for (let i = 0; i + 1 < raw.length; i += 2) {
    const code = parseInt(raw[i].trim(), 10);
    if (Number.isNaN(code)) continue;
    pairs.push({ code, value: raw[i + 1] });
  }
  // $INSUNITS из заголовка.
  let insunits = null;
  for (let i = 0; i < pairs.length - 1; i += 1) {
    if (pairs[i].code === 9 && pairs[i].value.trim() === '$INSUNITS') {
      insunits = parseInt(pairs[i + 1].value.trim(), 10);
      break;
    }
  }
  // Разбиваем на блоки по коду 0 (тип объекта).
  const blocks = [];
  let cur = null;
  for (const p of pairs) {
    if (p.code === 0) {
      if (cur) blocks.push(cur);
      cur = { type: p.value.trim(), codes: [] };
    } else if (cur) {
      cur.codes.push(p);
    }
  }
  if (cur) blocks.push(cur);

  const entities = [];
  const typeCounts = {};
  for (let i = 0; i < blocks.length; i += 1) {
    const blk = blocks[i];
    typeCounts[blk.type] = (typeCounts[blk.type] || 0) + 1;
    const get = (code) => {
      const f = blk.codes.find((c) => c.code === code);
      return f ? parseFloat(f.value) : undefined;
    };
    const getAll = (code) => blk.codes.filter((c) => c.code === code).map((c) => parseFloat(c.value));
    const getStr = (code) => { const f = blk.codes.find((c) => c.code === code); return f ? f.value : undefined; };
    switch (blk.type) {
      case 'LINE':
        entities.push({ type: 'line', x1: get(10), y1: get(20), x2: get(11), y2: get(21) });
        break;
      case 'SPLINE': {
        // Берём контрольные точки (10/20); если есть опорные (11/21) — их.
        let xs = getAll(11);
        let ys = getAll(21);
        if (!xs.length) { xs = getAll(10); ys = getAll(20); }
        const pts = xs.map((x, idx) => ({ x, y: ys[idx] })).filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
        if (pts.length >= 2) entities.push({ type: 'poly', pts, closed: Boolean((get(70) || 0) & 1) });
        break;
      }
      case 'ELLIPSE':
        entities.push({
          type: 'ellipse', cx: get(10), cy: get(20),
          mx: get(11), my: get(21), ratio: get(40) ?? 1,
          a1: get(41) ?? 0, a2: get(42) ?? (Math.PI * 2),
        });
        break;
      case 'TEXT':
        entities.push({ type: 'text', x: get(10), y: get(20), h: get(40) || 2.5, text: getStr(1) || '', rot: get(50) || 0 });
        break;
      case 'MTEXT': {
        const parts = blk.codes.filter((c) => c.code === 1 || c.code === 3).map((c) => c.value);
        entities.push({ type: 'text', x: get(10), y: get(20), h: get(40) || 2.5, text: parts.join('').replace(/\\[A-Za-z][^;]*;|[{}]/g, ''), rot: 0 });
        break;
      }
      case 'SOLID':
      case '3DFACE': {
        const xs = getAll(10).concat(getAll(11), getAll(12), getAll(13));
        const ys = getAll(20).concat(getAll(21), getAll(22), getAll(23));
        const pts = xs.map((x, idx) => ({ x, y: ys[idx] })).filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
        if (pts.length >= 3) entities.push({ type: 'poly', pts, closed: true });
        break;
      }
      case 'LWPOLYLINE': {
        const xs = getAll(10);
        const ys = getAll(20);
        const pts = xs.map((x, idx) => ({ x, y: ys[idx] })).filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
        entities.push({ type: 'poly', pts, closed: Boolean((get(70) || 0) & 1) });
        break;
      }
      case 'POLYLINE': {
        // За POLYLINE идут VERTEX … до SEQEND.
        const pts = [];
        const closed = Boolean((get(70) || 0) & 1);
        let j = i + 1;
        for (; j < blocks.length && blocks[j].type === 'VERTEX'; j += 1) {
          const vget = (code) => {
            const f = blocks[j].codes.find((c) => c.code === code);
            return f ? parseFloat(f.value) : undefined;
          };
          const x = vget(10);
          const y = vget(20);
          if (Number.isFinite(x) && Number.isFinite(y)) pts.push({ x, y });
        }
        i = j - 1; // пропускаем разобранные VERTEX (SEQEND пропустит switch)
        if (pts.length) entities.push({ type: 'poly', pts, closed });
        break;
      }
      case 'CIRCLE':
        entities.push({ type: 'circle', cx: get(10), cy: get(20), r: get(40) });
        break;
      case 'ARC':
        entities.push({ type: 'arc', cx: get(10), cy: get(20), r: get(40), a1: get(50), a2: get(51) });
        break;
      case 'POINT':
        entities.push({ type: 'point', x: get(10), y: get(20) });
        break;
      default:
        break;
    }
  }
  return { entities, insunits, typeCounts };
}

// Короткая сводка типов объектов DXF (для подсказки/диагностики).
export function dxfTypeSummary(parsed, limit = 5) {
  const entries = Object.entries(parsed.typeCounts || {})
    .filter(([t]) => t && t !== 'ENDSEC' && t !== 'SECTION' && t !== 'EOF' && t !== 'ENDBLK' && t !== 'SEQEND' && t !== 'VERTEX')
    .sort((a, b) => b[1] - a[1]);
  return entries.slice(0, limit).map(([t, n]) => `${t}×${n}`).join(', ');
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
  const unitMm = UNIT_TO_MM[parsed.insunits] || defaultUnitMm;
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
  };
}
