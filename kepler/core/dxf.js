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
  for (let i = 0; i < blocks.length; i += 1) {
    const blk = blocks[i];
    const get = (code) => {
      const f = blk.codes.find((c) => c.code === code);
      return f ? parseFloat(f.value) : undefined;
    };
    const getAll = (code) => blk.codes.filter((c) => c.code === code).map((c) => parseFloat(c.value));
    switch (blk.type) {
      case 'LINE':
        entities.push({ type: 'line', x1: get(10), y1: get(20), x2: get(11), y2: get(21) });
        break;
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
  return { entities, insunits };
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
    else if (e.type === 'point') { add(e.x, e.y); }
  }
  if (!xs.length) {
    throw new Error('в DXF не найдено геометрии (линии/полилинии)');
  }
  const sx = [...xs].sort((a, b) => a - b);
  const sy = [...ys].sort((a, b) => a - b);
  const pick = (arr, p) => arr[Math.min(arr.length - 1, Math.max(0, Math.round((arr.length - 1) * p)))];
  let minX = pick(sx, 0.01);
  let maxX = pick(sx, 0.99);
  let minY = pick(sy, 0.01);
  let maxY = pick(sy, 0.99);
  // Если после отсечения габарит выродился — берём полный диапазон.
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
  for (const e of entities) {
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
    } else if (e.type === 'point') {
      c.arc(tx(e.x), ty(e.y), 1.5, 0, Math.PI * 2);
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
