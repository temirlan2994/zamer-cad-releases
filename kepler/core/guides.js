// «Умные направляющие» при перемещении объектов (как в Figma), без DOM.
// Движущийся набор и цели — фигуры: { pts: [{x,y}…] } (углы реальной формы,
// в т.ч. повёрнутой) или { c: {x,y}, r } (круг). Выравнивание считается в
// «рамках» — системах осей под углом angle (рад): оси экрана и оси самого
// объекта. В каждой рамке у фигур берутся габариты: края и центр.
//
// Типы: совпадение краёв (left/right/top/bottom), центров (cx/cy), стык
// «край к краю» (dock), равные промежутки между тремя объектами (equal).
// Порог tol и окрестность reach — в мм (вызывающий переводит из пикселей).
// Индекс по осям: отсортированные значения краёв/центров целей — поиск
// кандидатов двоичным поиском, кадр на сотнях целей — доли миллисекунды.

export const GUIDE_TOL_PX = 8;
const HALF_PI = Math.PI / 2;
const EPS = 1e-6;

const rot = (x, y, c, s) => ({ x: x * c - y * s, y: x * s + y * c });

// Углы рамок без повторов (по модулю 90°): оси экрана и объекта.
export function guideFrames(angles) {
  const out = [];
  for (const a of angles) {
    if (!Number.isFinite(a)) continue;
    let m = a % HALF_PI;
    if (m < 0) m += HALF_PI;
    if (HALF_PI - m < 1e-6) m = 0;
    if (!out.some((b) => Math.abs(b - m) < 1e-6)) out.push(m);
  }
  return out.length ? out : [0];
}

// Габариты фигуры в рамке (c, s — cos/sin угла −angle).
function shapeBox(shape, c, s, box) {
  if (shape.c && shape.r !== undefined) {
    const p = rot(shape.c.x, shape.c.y, c, s);
    grow(box, p.x - shape.r, p.y - shape.r);
    grow(box, p.x + shape.r, p.y + shape.r);
    return box;
  }
  for (const q of shape.pts || []) {
    const p = rot(q.x, q.y, c, s);
    grow(box, p.x, p.y);
  }
  return box;
}

const emptyBox = () => ({ minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });
function grow(b, x, y) {
  if (x < b.minX) b.minX = x;
  if (x > b.maxX) b.maxX = x;
  if (y < b.minY) b.minY = y;
  if (y > b.maxY) b.maxY = y;
}
const valid = (b) => b.minX <= b.maxX && b.minY <= b.maxY;

// Отсортированный по значению список «край/центр» по одной оси.
function axisIndex(boxes, lo, hi) {
  const items = [];
  boxes.forEach((b, i) => {
    items.push({ v: b[lo], k: 0, i });
    items.push({ v: (b[lo] + b[hi]) / 2, k: 1, i });
    items.push({ v: b[hi], k: 2, i });
  });
  items.sort((a, b) => a.v - b.v);
  return { v: Float64Array.from(items, (x) => x.v), k: Uint8Array.from(items, (x) => x.k), i: Uint32Array.from(items, (x) => x.i) };
}

function lowerBound(arr, x) {
  let lo = 0; let hi = arr.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m] < x) lo = m + 1; else hi = m; }
  return lo;
}

/**
 * Индекс целей: строится один раз в начале жеста.
 * targets: [{ id?, pts } | { id?, c, r }], angles: углы рамок (рад).
 */
export function prepareGuides(targets, angles = [0]) {
  const frames = guideFrames(angles).map((angle) => {
    const c = Math.cos(-angle); const s = Math.sin(-angle);
    const boxes = [];
    for (const t of targets || []) {
      const b = shapeBox(t, c, s, emptyBox());
      if (!valid(b)) continue;
      b.id = t.id;
      boxes.push(b);
    }
    return { angle, c, s, boxes, xs: axisIndex(boxes, 'minX', 'maxX'), ys: axisIndex(boxes, 'minY', 'maxY') };
  });
  return { frames };
}

// Габариты движущегося набора в каждой рамке (в начале жеста).
export function movingBoxes(index, shapes) {
  return index.frames.map((f) => {
    const b = emptyBox();
    for (const sh of shapes || []) shapeBox(sh, f.c, f.s, b);
    return valid(b) ? b : null;
  });
}

const shift = (b, dx, dy) => ({ minX: b.minX + dx, maxX: b.maxX + dx, minY: b.minY + dy, maxY: b.maxY + dy });
// Зазор между отрезками [a0,a1] и [b0,b1] (0 — перекрываются).
const gapOf = (a0, a1, b0, b1) => Math.max(0, b0 - a1, a0 - b1);
const overlap = (a0, a1, b0, b1) => Math.min(a1, b1) - Math.max(a0, b0);

// Лучший кандидат по оси X рамки (для Y — то же с переставленными полями).
function bestOnAxis(f, idx, M, tol, reach, ax, opts) {
  const [lo, hi, plo, phi] = ax === 'x' ? ['minX', 'maxX', 'minY', 'maxY'] : ['minY', 'maxY', 'minX', 'maxX'];
  const mv = [M[lo], (M[lo] + M[hi]) / 2, M[hi]];
  let best = null;
  const consider = (cand) => {
    if (!best || cand.d < best.d - EPS || (Math.abs(cand.d - best.d) <= EPS && cand.near < best.near)) best = cand;
  };
  for (let mk = 0; mk < 3; mk += 1) {
    const m = mv[mk];
    const from = lowerBound(idx.v, m - tol);
    for (let j = from; j < idx.v.length && idx.v[j] <= m + tol; j += 1) {
      const tk = idx.k[j];
      // Центр — только к центру; край — к любому краю.
      if ((mk === 1) !== (tk === 1)) continue;
      const b = f.boxes[idx.i[j]];
      const near = gapOf(M[plo], M[phi], b[plo], b[phi]);
      if (near > reach) continue;
      let type;
      if (mk === 1) type = ax === 'x' ? 'cx' : 'cy';
      else if (mk === tk) type = ax === 'x' ? (mk === 0 ? 'left' : 'right') : (mk === 0 ? 'top' : 'bottom');
      else type = 'dock';
      consider({ d: Math.abs(idx.v[j] - m), off: idx.v[j] - m, at: idx.v[j], type, box: b, near });
    }
  }
  if (opts.equal !== false) {
    // Равные промежутки: соседи в одном ряду (перекрытие по поперечной оси).
    let L = null; let L2 = null; let R = null; let R2 = null;
    const mc = (M[lo] + M[hi]) / 2;
    const row = [];
    for (const b of f.boxes) {
      if (overlap(M[plo], M[phi], b[plo], b[phi]) <= EPS) continue;
      if (Math.abs(b[lo] - M[lo]) > reach + (M[hi] - M[lo]) && Math.abs(b[hi] - M[hi]) > reach + (M[hi] - M[lo])) continue;
      row.push(b);
      if (b[hi] <= mc && b[hi] <= M[lo] + tol && (!L || b[hi] > L[hi])) L = b;
      if (b[lo] >= mc && b[lo] >= M[hi] - tol && (!R || b[lo] < R[lo])) R = b;
    }
    for (const b of row) {
      if (L && b !== L && b[hi] <= L[lo] + EPS && overlap(L[plo], L[phi], b[plo], b[phi]) > EPS && (!L2 || b[hi] > L2[hi])) L2 = b;
      if (R && b !== R && b[lo] >= R[hi] - EPS && overlap(R[plo], R[phi], b[plo], b[phi]) > EPS && (!R2 || b[lo] < R2[lo])) R2 = b;
    }
    const eq = (off, gap, pair) => {
      if (gap <= EPS || Math.abs(off) > tol) return;
      consider({ d: Math.abs(off) + EPS * 2, off, type: 'equal', gap, pair, near: 0 });
    };
    if (L && R) {
      const off = (L[hi] + R[lo] - M[lo] - M[hi]) / 2;
      eq(off, M[lo] + off - L[hi], [[L, null], [null, R]]);
    }
    if (L && L2) {
      const g = L[lo] - L2[hi];
      eq(L[hi] + g - M[lo], g, [[L2, L], [L, null]]);
    }
    if (R && R2) {
      const g = R2[lo] - R[hi];
      eq(R[lo] - g - M[hi], g, [[null, R], [R, R2]]);
    }
  }
  return best;
}

/**
 * Привязка движущегося набора. index — prepareGuides, boxes — movingBoxes
 * (в начале жеста), delta — сдвиг курсора от начала (мм, в осях пространства).
 * Возвращает { delta, snapped, angle, snapU, snapV, axes, guides }:
 * delta — исправленный сдвиг; axes — { x, y } какие оси пространства
 * привязаны (null, если рамка повёрнута относительно осей пространства);
 * guides — [{ type, from, to, label? }] для рисования.
 */
export function snapGuides(index, boxes, delta, { tol = 1, reach = Infinity, equal = true, enabled = true, format = null } = {}) {
  const none = { delta: { x: delta.x, y: delta.y }, snapped: false, angle: 0, snapU: false, snapV: false, axes: { x: false, y: false }, guides: [] };
  if (!enabled || !index?.frames?.length) return none;
  let pick = null;
  index.frames.forEach((f, fi) => {
    const B = boxes[fi];
    if (!B) return;
    const d = rot(delta.x, delta.y, f.c, f.s);
    const M = shift(B, d.x, d.y);
    const bx = bestOnAxis(f, f.xs, M, tol, reach, 'x', { equal });
    const by = bestOnAxis(f, f.ys, M, tol, reach, 'y', { equal });
    if (!bx && !by) return;
    const score = Math.min(bx ? bx.d : Infinity, by ? by.d : Infinity);
    if (!pick || score < pick.score - EPS) pick = { f, M, bx, by, score };
  });
  if (!pick) return none;
  const { f, bx, by } = pick;
  const ox = bx ? bx.off : 0;
  const oy = by ? by.off : 0;
  const ow = rot(ox, oy, f.c, -f.s); // обратно: поворот на +angle
  const M = shift(pick.M, ox, oy);
  const back = (p) => rot(p.x, p.y, f.c, -f.s);
  const fmt = format || ((mm) => `${Math.round(mm)}`);
  const guides = [];
  const line = (cand, ax) => {
    if (cand.type === 'equal') {
      for (const [a, b] of cand.pair) {
        const A = a || M; const Bx = b || M;
        if (ax === 'x') {
          const y = (Math.max(A.minY, Bx.minY, M.minY) + Math.min(A.maxY, Bx.maxY, M.maxY)) / 2;
          guides.push({ type: 'gap', axis: 'x', from: back({ x: A.maxX, y }), to: back({ x: Bx.minX, y }), label: fmt(cand.gap) });
        } else {
          const x = (Math.max(A.minX, Bx.minX, M.minX) + Math.min(A.maxX, Bx.maxX, M.maxX)) / 2;
          guides.push({ type: 'gap', axis: 'y', from: back({ x, y: A.maxY }), to: back({ x, y: Bx.minY }), label: fmt(cand.gap) });
        }
      }
      return;
    }
    // Все цели на той же линии (в окрестности) — линия тянется через них.
    const [plo, phi] = ax === 'x' ? ['minY', 'maxY'] : ['minX', 'maxX'];
    let a0 = Math.min(M[plo], cand.box[plo]);
    let a1 = Math.max(M[phi], cand.box[phi]);
    const idx = ax === 'x' ? f.xs : f.ys;
    for (let j = lowerBound(idx.v, cand.at - 0.5); j < idx.v.length && idx.v[j] <= cand.at + 0.5; j += 1) {
      const b = f.boxes[idx.i[j]];
      if (gapOf(M[plo], M[phi], b[plo], b[phi]) > reach) continue;
      a0 = Math.min(a0, b[plo]); a1 = Math.max(a1, b[phi]);
    }
    const p0 = ax === 'x' ? { x: cand.at, y: a0 } : { x: a0, y: cand.at };
    const p1 = ax === 'x' ? { x: cand.at, y: a1 } : { x: a1, y: cand.at };
    const g = { type: 'align', axis: ax, kind: cand.type, from: back(p0), to: back(p1) };
    // Расстояние до ближайшего объекта на этой линии (по поперечной оси).
    const gap = gapOf(M[plo], M[phi], cand.box[plo], cand.box[phi]);
    if (gap > 0.5) {
      const mid = cand.box[phi] < M[plo] ? [cand.box[phi], M[plo]] : [M[phi], cand.box[plo]];
      g.gapFrom = back(ax === 'x' ? { x: cand.at, y: mid[0] } : { x: mid[0], y: cand.at });
      g.gapTo = back(ax === 'x' ? { x: cand.at, y: mid[1] } : { x: mid[1], y: cand.at });
      g.label = fmt(gap);
    }
    guides.push(g);
  };
  if (bx) line(bx, 'x');
  if (by) line(by, 'y');
  // Какие оси пространства привязаны (рамка совпадает с осями — угол 0).
  const aligned = Math.abs(f.angle) < 1e-6;
  return {
    delta: { x: delta.x + ow.x, y: delta.y + ow.y },
    snapped: true,
    angle: f.angle,
    snapU: Boolean(bx),
    snapV: Boolean(by),
    axes: aligned ? { x: Boolean(bx), y: Boolean(by) } : null,
    guides,
  };
}

// Итоговый сдвиг: направляющие приоритетнее сетки. grid — сдвиг по сетке.
// Рамка по осям пространства — по непривязанной оси остаётся сетка;
// повёрнутая рамка — сдвиг направляющих как есть.
export function mergeWithGrid(res, grid) {
  if (!res?.snapped) return { x: grid.x, y: grid.y };
  if (!res.axes) return { x: res.delta.x, y: res.delta.y };
  return { x: res.axes.x ? res.delta.x : grid.x, y: res.axes.y ? res.delta.y : grid.y };
}
