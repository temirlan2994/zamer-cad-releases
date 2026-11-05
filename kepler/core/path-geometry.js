// Геометрия линейных объектов ландшафта (дорожка, ограждение по линии):
// соединение в углах, контур полосы, участки («куски») и укладка плит и
// досок. Чистая геометрия: без DOM и без каталога (core/landscape.js
// передаёт ось, ширину и параметры).
//
// Ось — ломаная (мир, мм). Ширина width, полуширина hw. Сторона «+n» —
// нормаль (-u.y, u.x) к направлению u; на экране (ось Y вниз) это правая
// рука идущего по дорожке, «−n» — левая.
//
// Углы (тип соединения в изломе):
//   'miter' — срез по биссектрисе: стык по диагонали, острый внешний угол
//             (при очень остром изломе — подрезка, MITER_LIMIT);
//   'butt'  — встык: первый участок доходит до внешней кромки второго,
//             второй начинается от кромки первого (шов поперёк второго);
//   'slab'  — угловая плита/площадка: на изломе — свой кусок (при 90° —
//             квадрат шириной дорожки), участки примыкают к нему;
//   'round' — скругление: ось идёт по дуге радиуса radius (по умолчанию
//             = ширине), плиты и швы — по дуге.
// Контур полосы у первых трёх одинаковый (срез), отличаются швы и укладка.

export const PATH_CORNERS = [
  { id: 'miter', title: 'Срез', hint: 'Срез по биссектрисе: стык по диагонали' },
  { id: 'butt', title: 'Встык', hint: 'Второй участок начинается от кромки первого' },
  { id: 'slab', title: 'Угловая плита', hint: 'На изломе — квадратная плита шириной дорожки' },
  { id: 'round', title: 'Скругление', hint: 'Дуга по углу, плиты идут по дуге' },
];
export const CORNER_IDS = PATH_CORNERS.map((c) => c.id);
export const PATH_LAYINGS = [{ id: 'natural', title: 'Естественная' }, { id: 'strict', title: 'Строгая' }];
export const PATH_ALIGNS = [{ id: 'center', title: 'По центру' }, { id: 'left', title: 'По левому краю' }, { id: 'right', title: 'По правому краю' }];
export const DECK_PATTERNS = [{ id: 'straight', title: 'Прямая' }, { id: 'stagger', title: 'Со сдвигом стыков' }];

// Длина среза к полуширине, выше — подрезка угла (как stroke-miterlimit).
export const MITER_LIMIT = 2.6;
// «Встык» на пологом изломе (< 30°) вырождается — там стык срезом.
const BUTT_MIN = Math.PI / 6;

const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y });
const mul = (a, k) => ({ x: a.x * k, y: a.y * k });
const dot = (a, b) => a.x * b.x + a.y * b.y;
const cross = (a, b) => a.x * b.y - a.y * b.x;
const nrm = (u) => ({ x: -u.y, y: u.x });
const dist = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);
const unit = (a, b) => {
  const l = dist(a, b);
  return l > 1e-9 ? { x: (b.x - a.x) / l, y: (b.y - a.y) / l } : { x: 1, y: 0 };
};
const pt = (p) => ({ x: p.x, y: p.y });

function lineX(p, u, q, v) {
  const den = cross(u, v);
  if (Math.abs(den) < 1e-12) return null;
  const t = cross(sub(q, p), v) / den;
  return { x: p.x + u.x * t, y: p.y + u.y * t };
}

export function signedArea(pts) {
  let s = 0;
  for (let i = 0; i < pts.length; i += 1) {
    const a = pts[i]; const b = pts[(i + 1) % pts.length];
    s += a.x * b.y - b.x * a.y;
  }
  return s / 2;
}
export const areaOf = (pts) => Math.abs(signedArea(pts));

function dedupe(points, tol = 1) {
  const out = [];
  for (const p of points || []) {
    if (!Number.isFinite(p?.x) || !Number.isFinite(p?.y)) continue;
    if (!out.length || dist(out[out.length - 1], p) > tol) out.push(pt(p));
  }
  return out;
}

const turnAngle = (u1, u2) => Math.atan2(Math.abs(cross(u1, u2)), dot(u1, u2));

// ------------------------------------------------------------ Ось и участки

// Ось → участки (runs) и стыки между ними.
// run: { kind: 'straight' | 'arc' | 'curve', pts, u0, u1 (касательные на концах), seg }.
// joint: { type, vertex, V, ... } — между runs[k] и runs[k + 1].
export function pathRuns(points, { width = 1000, corners = [], smooth = false, radius } = {}) {
  const pts = dedupe(points);
  const hw = width / 2;
  if (pts.length < 2) return { runs: [], joints: [], hw, pts };
  if (smooth || pts.length === 2) {
    const kind = smooth && pts.length > 2 ? 'curve' : 'straight';
    return {
      runs: [{ kind, pts, u0: unit(pts[0], pts[1]), u1: unit(pts[pts.length - 2], pts[pts.length - 1]), seg: 0 }],
      joints: [], hw, pts,
    };
  }
  const n = pts.length;
  const dirs = []; const lens = [];
  for (let i = 0; i < n - 1; i += 1) { dirs.push(unit(pts[i], pts[i + 1])); lens.push(dist(pts[i], pts[i + 1])); }
  const R0 = Math.max(50, radius ?? width * 1.25);
  // Длина касательной скругления в каждой вершине.
  const tl = new Array(n).fill(0);
  const isRound = (i) => i > 0 && i < n - 1 && corners[i] === 'round';
  for (let i = 1; i < n - 1; i += 1) {
    if (!isRound(i)) continue;
    const a = turnAngle(dirs[i - 1], dirs[i]);
    if (a < 0.01 || a > Math.PI - 0.05) continue;
    const tan = Math.tan(a / 2);
    const availA = lens[i - 1] * (isRound(i - 1) ? 0.5 : i - 1 === 0 ? 0.95 : 0.6);
    const availB = lens[i] * (isRound(i + 1) ? 0.5 : i + 1 === n - 1 ? 0.95 : 0.6);
    tl[i] = Math.max(0, Math.min(R0 * tan, availA, availB));
  }
  const runs = [];
  const joints = [];
  let cur = pts[0];
  for (let i = 1; i < n; i += 1) {
    const u = dirs[i - 1];
    const last = i === n - 1;
    if (!last && tl[i] > 1) {
      const V = pts[i];
      const T1 = add(V, mul(u, -tl[i]));
      const T2 = add(V, mul(dirs[i], tl[i]));
      runs.push({ kind: 'straight', pts: [cur, T1], u0: u, u1: u, seg: i - 1 });
      joints.push({ type: 'perp', V: T1, u });
      // Дуга: центр на внутренней стороне.
      const a = turnAngle(u, dirs[i]);
      const s = cross(u, dirs[i]) > 0 ? 1 : -1;
      const R = tl[i] / Math.tan(a / 2);
      const C = add(T1, mul(nrm(u), s * R));
      const a0 = Math.atan2(T1.y - C.y, T1.x - C.x);
      const k = Math.max(4, Math.ceil(a / (Math.PI / 24)));
      const arc = [T1];
      for (let j = 1; j < k; j += 1) {
        const t = a0 + s * a * (j / k);
        arc.push({ x: C.x + Math.cos(t) * R, y: C.y + Math.sin(t) * R });
      }
      arc.push(T2);
      runs.push({ kind: 'arc', pts: arc, u0: u, u1: dirs[i], seg: i - 1, vertex: i, radius: R, center: C });
      joints.push({ type: 'perp', V: T2, u: dirs[i] });
      cur = T2;
    } else {
      runs.push({ kind: 'straight', pts: [cur, pts[i]], u0: u, u1: u, seg: i - 1 });
      if (!last) joints.push({ type: corners[i] && corners[i] !== 'round' ? corners[i] : 'miter', vertex: i, V: pts[i] });
      cur = pts[i];
    }
  }
  return { runs, joints, hw, pts };
}

// Геометрия стыка двух прямых участков: торцы (cap, от «+n» к «−n»),
// точки контура по сторонам и кусок угла.
function jointGeometry(j, A, B, hw) {
  const V = j.V;
  if (j.type === 'perp') {
    const n = nrm(j.u);
    const cap = [add(V, mul(n, hw)), add(V, mul(n, -hw))];
    return { capA: cap, capB: cap, plus: [cap[0]], minus: [cap[1]], corner: null };
  }
  const u1 = A.u1; const u2 = B.u0;
  const n1 = nrm(u1); const n2 = nrm(u2);
  const alpha = turnAngle(u1, u2);
  if (alpha < 1e-3 || alpha > Math.PI - 0.02) {
    // Прямо (или разворот назад): торцы поперёк в вершине.
    const capA = [add(V, mul(n1, hw)), add(V, mul(n1, -hw))];
    const capB = [add(V, mul(n2, hw)), add(V, mul(n2, -hw))];
    return { capA, capB, plus: [capA[0], capB[0]], minus: [capA[1], capB[1]], corner: null };
  }
  const s = cross(u1, u2) > 0 ? 1 : -1; // внутренняя сторона: s·n
  const m0 = add(n1, n2);
  const m = mul(m0, 1 / Math.hypot(m0.x, m0.y));
  const cosh = dot(m, n1); // cos(α/2)
  const k = hw / cosh;
  const I = add(V, mul(m, s * Math.min(k, hw * 6)));
  const bevel = 1 / cosh > MITER_LIMIT;
  const O = add(V, mul(m, -s * k));
  const footA = add(V, mul(n1, -s * hw));
  const footB = add(V, mul(n2, -s * hw));
  const O1 = bevel ? add(footA, mul(u1, hw)) : O;
  const O2 = bevel ? add(footB, mul(u2, -hw)) : O;
  const outer = bevel ? [O1, O2] : [O];
  const order = (inner, outerPts) => (s > 0 ? [inner, ...outerPts] : [...outerPts].reverse().concat([inner]));
  const sides = s > 0 ? { plus: [I], minus: outer } : { plus: outer, minus: [I] };
  let type = j.type;
  if (type === 'butt' && (alpha < BUTT_MIN || bevel)) type = 'miter';
  if (type === 'butt') {
    const C = lineX(add(V, mul(n1, s * hw)), u1, footB, u2);
    if (C) {
      // Кусок A: внешняя кромка до O, по внешней кромке B до C, назад по внутренней.
      const capA = s > 0 ? [C, O] : [O, C];
      const capB = s > 0 ? [I, C] : [C, I];
      return { capA, capB, ...sides, corner: null, type };
    }
    type = 'miter';
  }
  if (type === 'slab') {
    const Fa = add(I, mul(n1, -s * 2 * hw));
    const Fb = add(I, mul(n2, -s * 2 * hw));
    const capA = order(I, [Fa]);
    const capB = order(I, [Fb]);
    const corner = [I, Fa, ...outer, Fb];
    return { capA, capB, ...sides, corner, type, u: u1, I, Fa, Fb };
  }
  // Срез.
  const capA = order(I, [O1]);
  const capB = order(I, [O2]);
  return { capA, capB, ...sides, corner: bevel ? [I, O1, O2] : null, type: 'miter' };
}

// Смещения внутренних точек участка-кривой (дуга, сглаженная линия).
function curveOffsets(pts, hw) {
  const plus = []; const minus = [];
  for (let i = 1; i < pts.length - 1; i += 1) {
    const na = nrm(unit(pts[i - 1], pts[i]));
    const nb = nrm(unit(pts[i], pts[i + 1]));
    const m0 = add(na, nb);
    const l = Math.hypot(m0.x, m0.y);
    const mm = l > 1e-9 ? mul(m0, 1 / l) : na;
    const k = hw / Math.max(0.5, dot(mm, na));
    plus.push(add(pts[i], mul(mm, k)));
    minus.push(add(pts[i], mul(mm, -k)));
  }
  return { plus, minus };
}

// Полная геометрия полосы: участки с торцами, куски (участки + углы),
// контур. corners — тип угла в каждой вершине (индекс вершины).
export function pathLayout(points, opts = {}) {
  const width = Math.max(1, opts.width || 1000);
  const base = pathRuns(points, { ...opts, width });
  const { runs, joints, hw } = base;
  if (!runs.length) return { ...base, pieces: [], outline: [], width };
  const geo = joints.map((j, k) => ({ ...j, ...jointGeometry(j, runs[k], runs[k + 1], hw) }));
  const pieces = [];
  const plus = []; const minus = [];
  runs.forEach((r, k) => {
    const first = r.pts[0]; const lastP = r.pts[r.pts.length - 1];
    const n0 = nrm(r.u0); const n1 = nrm(r.u1);
    r.capStart = k > 0 ? geo[k - 1].capB : [add(first, mul(n0, hw)), add(first, mul(n0, -hw))];
    r.capEnd = k < runs.length - 1 ? geo[k].capA : [add(lastP, mul(n1, hw)), add(lastP, mul(n1, -hw))];
    r.startEnd = k === 0; // торец у начала дорожки
    r.endEnd = k === runs.length - 1;
    const off = r.kind === 'straight' ? { plus: [], minus: [] } : curveOffsets(r.pts, hw);
    r.poly = [...[...r.capStart].reverse(), ...off.plus, ...r.capEnd, ...[...off.minus].reverse()];
    r.len = r.pts.reduce((s, p, i) => (i ? s + dist(r.pts[i - 1], p) : 0), 0);
    pieces.push({ kind: 'run', run: k, runKind: r.kind, poly: r.poly, u: r.u0 });
    if (k === 0) { plus.push(r.capStart[0]); minus.push(r.capStart[r.capStart.length - 1]); }
    plus.push(...off.plus); minus.push(...off.minus);
    if (k < runs.length - 1) {
      const g = geo[k];
      plus.push(...g.plus); minus.push(...g.minus);
      if (g.corner) pieces.push({ kind: 'corner', joint: k, type: g.type, poly: g.corner, u: r.u1 });
    } else {
      plus.push(r.capEnd[0]); minus.push(r.capEnd[r.capEnd.length - 1]);
    }
  });
  const outline = [...plus, ...[...minus].reverse()];
  // plus / minus — кромки слева и справа от оси (бордюр вдоль дорожки).
  return { runs, joints: geo, hw, width, pieces, outline, plus, minus };
}

// Контур полосы (замкнутый многоугольник).
export function pathOutline(points, opts) {
  return pathLayout(points, opts).outline;
}

// ------------------------------------------------------------ Прямоугольники

// Углы прямоугольника { x, y, angle, along, across } (вдоль — по angle).
export function rectCorners(r) {
  const c = Math.cos(r.angle); const s = Math.sin(r.angle);
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([kx, ky]) => {
    const x = (kx * r.along) / 2; const y = (ky * r.across) / 2;
    return { x: r.x + x * c - y * s, y: r.y + x * s + y * c };
  });
}

// Пересекаются ли два прямоугольника (теорема о разделяющей оси);
// margin > 0 — требуемый зазор между ними.
export function rectsOverlap(a, b, margin = 0) {
  const A = rectCorners(a); const B = rectCorners(b);
  for (const r of [a, b]) {
    for (const ang of [r.angle, r.angle + Math.PI / 2]) {
      const ax = { x: Math.cos(ang), y: Math.sin(ang) };
      const pa = A.map((p) => dot(p, ax)); const pb = B.map((p) => dot(p, ax));
      if (Math.max(...pa) + margin <= Math.min(...pb) || Math.max(...pb) + margin <= Math.min(...pa)) return false;
    }
  }
  return true;
}

// Отсечение многоугольника выпуклым (Сазерленд — Ходжмен).
export function clipConvex(subject, clip) {
  const sign = signedArea(clip) >= 0 ? 1 : -1;
  let out = subject;
  for (let i = 0; i < clip.length && out.length; i += 1) {
    const a = clip[i]; const b = clip[(i + 1) % clip.length];
    const e = sub(b, a);
    const inside = (p) => sign * cross(e, sub(p, a)) >= -1e-6;
    const input = out;
    out = [];
    for (let k = 0; k < input.length; k += 1) {
      const p = input[k]; const q = input[(k + 1) % input.length];
      const pin = inside(p); const qin = inside(q);
      if (pin) out.push(p);
      if (pin !== qin) {
        const x = lineX(p, sub(q, p), a, e);
        if (x) out.push(x);
      }
    }
  }
  return out;
}

// ------------------------------------------------------------ Укладка

function seeded(seed) {
  let h = 2166136261;
  const s = String(seed);
  for (let i = 0; i < s.length; i += 1) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  let t = h >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

// Точка и касательная на расстоянии s вдоль ломаной.
function along(pts, s) {
  let rest = s;
  for (let i = 0; i < pts.length - 1; i += 1) {
    const a = pts[i]; const b = pts[i + 1];
    const l = dist(a, b);
    if (rest <= l || i === pts.length - 2) {
      const t = l ? Math.min(1, Math.max(0, rest / l)) : 0;
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, angle: Math.atan2(b.y - a.y, b.x - a.x) };
    }
    rest -= l;
  }
  return { x: pts[0].x, y: pts[0].y, angle: 0 };
}

// Допустимый интервал центров прямоугольника на прямом участке по
// торцам: [lo, hi] (расстояние от начала участка). a — длина вдоль,
// d — смещение поперёк, b — ширина поперёк. Зазор gap у стыков.
function runBounds(r, a, d, b, gap, sign) {
  const P0 = r.pts[0]; const u = r.u0; const n = nrm(u);
  let lo = -Infinity; let hi = Infinity;
  const edges = (cap) => cap.slice(0, -1).map((p, i) => [p, cap[i + 1]]);
  const caps = [
    { list: edges([...r.capStart].reverse()), ext: r.startEnd ? 0 : gap },
    { list: edges(r.capEnd), ext: r.endEnd ? 0 : gap },
  ];
  for (const { list, ext } of caps) {
    const aa = (a + ext) / 2;
    for (const [p, q] of list) {
      const e = sub(q, p);
      const B = sign * cross(e, u);
      for (const [kx, ky] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        const base = add(P0, add(mul(u, kx * aa), mul(n, d + (ky * b) / 2)));
        const A = sign * cross(e, sub(base, p));
        if (Math.abs(B) < 1e-9) { if (A < -1) return null; continue; }
        const c = -A / B;
        if (B > 0) lo = Math.max(lo, c); else hi = Math.min(hi, c);
      }
    }
  }
  return { lo, hi };
}

// Параметры укладки дорожки (поля объекта — необязательные).
export function layingParams(o, width) {
  const strict = o.laying === 'strict';
  const deck = o.variant === 'deck';
  const num = (v, lo, hi) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Math.min(hi, Math.max(lo, Number(v))) : null);
  const along = deck
    ? num(o.boardW, 40, 400) ?? 145
    : num(o.slabL, 100, 5000) ?? Math.round(Math.min(650, Math.max(300, width * 0.45)));
  const gapRaw = Number(o.gap);
  const gap = Number.isFinite(gapRaw) && gapRaw >= 0 && o.gap !== null && o.gap !== ''
    ? Math.min(2000, gapRaw)
    : deck ? 6 : Math.round(Math.min(300, Math.max(120, width * 0.18)));
  const across = deck ? width : num(o.slabW, 100, 6000) ?? null;
  return {
    strict, along, gap, across,
    align: ['left', 'right'].includes(o.align) ? o.align : 'center',
    offset: Number.isFinite(Number(o.offset)) ? Number(o.offset) : 0,
    checker: o.checker === true,
    pattern: o.deck === 'stagger' ? 'stagger' : 'straight',
    boardL: num(o.boardL, 200, 6000) ?? Math.max(400, Math.round(width * 0.6)),
  };
}

// Смещение поперёк по выравниванию («−n» — левая рука на экране).
const alignShift = (align, width, across) => {
  const free = Math.max(0, (width - across) / 2);
  return align === 'left' ? -free : align === 'right' ? free : 0;
};

// Плиты-ступени: прямоугольники { x, y, angle, along, across, tone, ci,
// run, corner? }. Ни одна плита не пересекает другую: на углах стыки по
// типу угла, лишние плиты пропускаются (проверка по OBB).
export function layoutSlabs(points, o, opts = {}) {
  const width = Math.max(1, o.width || 1000);
  const L = opts.layout || pathLayout(points, { width, corners: opts.corners, smooth: opts.smooth, radius: o.radius });
  const P = layingParams(o, width);
  const { strict, along: a, gap } = P;
  const step = a + gap;
  const rand = seeded(o.id);
  const out = [];
  let idx = 0;
  const tone = (r) => {
    if (strict) return P.checker ? (idx % 2 ? 1 : 0) : 0;
    return r > 0.66 ? 2 : r > 0.33 ? 0 : 1;
  };
  // Угловые плиты — первыми (у них приоритет).
  const pads = [];
  for (const piece of L.pieces) {
    if (piece.kind !== 'corner' || piece.type !== 'slab') continue;
    const j = L.joints[piece.joint];
    const ang = Math.atan2(j.u.y, j.u.x);
    // Центр квадрата: между внутренней точкой и её парой на внешней кромке,
    // сдвинут на полширины вдоль A (при 90° — ровно в изломе).
    const side = width - gap;
    const mid = mul(add(j.I, j.Fa), 0.5);
    const c = add(mid, mul(j.u, width / 2));
    const pr = seeded(`${o.id}:pad${piece.joint}`);
    const jit = strict ? 0 : (pr() - 0.5) * 0.06;
    const t = pr();
    pads.push({ x: c.x, y: c.y, angle: ang + jit, along: side, across: side, tone: t, ci: strict ? 0 : t > 0.5 ? 0 : 2, corner: true, run: piece.joint + 0.5 });
  }
  const placed = [...pads];
  L.runs.forEach((r, k) => {
    const nominal = P.across ?? Math.round(width * 0.95);
    const d0 = alignShift(P.align, width, nominal);
    const first = k === 0;
    let centers = [];
    const curve = r.kind !== 'straight';
    let lo; let hi;
    if (!curve) {
      const sign = signedArea(r.poly) >= 0 ? 1 : -1;
      const bnd = runBounds(r, a, d0, Math.min(nominal, width), gap, sign);
      if (!bnd) return;
      ({ lo, hi } = bnd);
    } else {
      lo = (r.startEnd ? a : a + gap) / 2;
      hi = r.len - (r.endEnd ? a : a + gap) / 2;
    }
    if (!(hi >= lo - 1e-6)) {
      // Места на целую плиту нет — «естественная» кладёт укороченную.
      if (!strict && Number.isFinite(lo) && Number.isFinite(hi) && hi + a - lo > a * 0.45) {
        centers = [{ c: (lo + hi) / 2, len: hi + a - lo }];
      }
    } else if (strict && r.kind !== 'arc') {
      const off = first ? ((P.offset % step) + step) % step : 0;
      for (let c = lo + off; c <= hi + 1e-6; c += step) centers.push({ c, len: a });
    } else {
      // На дуге шаг по оси больше: у внутренней кромки плиты сходятся.
      const st = r.kind === 'arc' ? (a + gap * 0.35) * r.radius / Math.max(r.radius - nominal / 2, r.radius * 0.25) : step;
      const span = hi - lo + a;
      const count = Math.max(1, Math.floor((span - a) / st) + 1);
      const lead = (span - ((count - 1) * st + a)) / 2;
      for (let i = 0; i < count; i += 1) centers.push({ c: lo + lead + i * st, len: a });
    }
    let prev = null;
    for (const { c: c0, len } of centers) {
      let c = c0;
      const jitter = strict ? 0 : (rand() - 0.5) * 0.08;
      const shift = strict ? 0 : (rand() - 0.5) * width * 0.08;
      const across = strict ? (P.across ?? width) : Math.round((P.across ?? width) * (0.9 + rand() * 0.1));
      const tr = strict ? 0 : rand();
      const make = (cc) => {
        const p = curve ? along(r.pts, cc) : { ...add(r.pts[0], mul(r.u0, cc)), angle: Math.atan2(r.u0.y, r.u0.x) };
        const d = d0 + shift;
        return {
          x: p.x - Math.sin(p.angle) * d, y: p.y + Math.cos(p.angle) * d, angle: p.angle + jitter,
          along: Math.round(len), across, tone: tr, run: k,
        };
      };
      let slab = make(c);
      if (curve && prev) {
        // На дуге внутренняя кромка сходится — плиту сдвигаем вперёд.
        let guard = 0;
        while (rectsOverlap(prev, slab, gap * 0.3) && guard < 200 && c < hi + a * 0.25) { c += 10; slab = make(c); guard += 1; }
        if (c > hi + a * 0.25) break;
      }
      prev = slab;
      slab.ci = tone(tr);
      idx += 1;
      out.push({ slab, make: curve ? make : null, c, lo, hi });
    }
  });
  // Итог: плита, задевающая уже уложенную (углы, дуги), пропускается.
  const result = [...pads];
  const hits = (q) => placed.some((x) => rectsOverlap(x, q, 0.5));
  for (const { slab, make, c, lo, hi } of out) {
    let s = slab;
    if (hits(s) && make) {
      // На дуге плиту у стыка с прямым участком сдвигаем по дуге, пока не встанет.
      s = null;
      for (let k = 1; k <= 12 && !s; k += 1) {
        for (const sign of [-1, 1]) {
          const cc = c + sign * k * Math.max(10, gap * 0.25);
          if (cc < lo - a * 0.25 || cc > hi + a * 0.25) continue;
          const q = { ...make(cc), ci: slab.ci };
          if (!hits(q)) { s = q; break; }
        }
      }
    }
    if (!s || hits(s)) continue;
    placed.push(s);
    result.push(s);
  }
  // Порядок вдоль дорожки: угловая плита — между своими участками.
  return result.map((s, i) => ({ s, i })).sort((p, q) => p.s.run - q.s.run || p.i - q.i).map((x) => x.s);
}

// Доски настила: поперёк дорожки (прямая — целиком на ширину, «со
// сдвигом» — кусками длиной boardL со сдвигом стыков через ряд). Доски у
// стыков участков подрезаются по контуру куска (поле poly).
export function layoutBoards(points, o, opts = {}) {
  const width = Math.max(1, o.width || 1000);
  const L = opts.layout || pathLayout(points, { width, corners: opts.corners, smooth: opts.smooth, radius: o.radius });
  const P = layingParams(o, width);
  const bw = P.along; const gap = P.gap; const step = bw + gap;
  const rand = seeded(o.id);
  const out = [];
  let row = 0;
  const tone = () => {
    if (P.strict) return P.checker ? (row % 2 ? 1 : 0) : 0;
    return rand() > 0.6 ? 2 : 1;
  };
  // Куски одной доски поперёк: [from, to] от −hw до hw.
  const pieces = (k, lo, hi) => {
    if (P.pattern !== 'stagger') return [[lo, hi]];
    const res = [];
    const sh = k % 2 ? P.boardL / 2 : 0;
    let x = lo - sh;
    while (x < hi) {
      const a = Math.max(lo, x); const b = Math.min(hi, x + P.boardL);
      if (b - a > 20) res.push([a, b - (b < hi ? gap : 0)]);
      x += P.boardL;
    }
    return res;
  };
  const emit = (center, u, k, latLo, latHi, clip) => {
    const n = nrm(u);
    for (const [p0, p1] of pieces(k, latLo, latHi)) {
      const mid = (p0 + p1) / 2;
      const c = add(center, mul(n, mid));
      const rect = { x: c.x, y: c.y, angle: Math.atan2(u.y, u.x), along: bw, across: p1 - p0 };
      const t = tone();
      if (clip) {
        const corners = rectCorners(rect);
        const poly = clipConvex(corners, clip);
        const ar = poly.length >= 3 ? areaOf(poly) : 0;
        if (ar < bw * rect.across * 0.04) continue;
        const full = ar > bw * rect.across * 0.995;
        out.push(full ? { ...rect, ci: t } : { ...rect, ci: t, poly });
      } else out.push({ ...rect, ci: t });
    }
    row += 1;
  };
  for (const piece of L.pieces) {
    const u = piece.u;
    const n = nrm(u);
    if (piece.kind === 'run' && piece.runKind !== 'straight') {
      const r = L.runs[piece.run];
      const count = Math.max(1, Math.floor((r.len + gap) / step));
      const lead = (r.len - (count * step - gap)) / 2;
      let prev = null;
      for (let i = 0; i < count; i += 1) {
        let c = lead + i * step + bw / 2;
        let p = along(r.pts, c);
        let rect = { x: p.x, y: p.y, angle: p.angle + Math.PI / 2, along: width, across: bw };
        let guard = 0;
        while (prev && rectsOverlap(prev, rect, gap * 0.3) && guard < 100) { c += 5; p = along(r.pts, c); rect = { ...rect, x: p.x, y: p.y, angle: p.angle + Math.PI / 2 }; guard += 1; }
        if (c > r.len - bw / 2 + 1) break;
        prev = rect;
        const uu = { x: Math.cos(p.angle), y: Math.sin(p.angle) };
        emit({ x: p.x, y: p.y }, uu, row, -width / 2, width / 2, null);
      }
      continue;
    }
    // Прямой участок или кусок угла: доски поперёк u, подрезка по куску.
    const origin = piece.kind === 'run' ? L.runs[piece.run].pts[0] : piece.poly[0];
    const projU = piece.poly.map((p) => dot(sub(p, origin), u));
    const projN = piece.poly.map((p) => dot(sub(p, origin), n));
    const u0 = Math.min(...projU); const u1 = Math.max(...projU);
    const n0 = Math.min(...projN); const n1 = Math.max(...projN);
    // «Шаг от начала» (строгая укладка) — сдвиг рядов на первом участке.
    const off = piece.kind === 'run' && piece.run === 0 && P.strict ? ((P.offset % step) + step) % step : 0;
    for (let c = u0 + off - (off ? step : 0) + bw / 2; c < u1 + bw / 2; c += step) {
      const center = add(origin, mul(u, c));
      emit(center, u, row, n0, n1, piece.poly);
    }
  }
  return out;
}
