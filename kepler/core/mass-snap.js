// Магнит масс в 3D (чистый модуль без DOM): к чему липнет двигаемая масса
// (гизмо, точки размера, создание) — как в SketchUp / Revit.
//
// Цели по оси c ('x' | 'y' | 'z') — край двигаемого габарита (lo — min,
// hi — max, mid — середина) встаёт на координату value:
//   host-wall — наружный угол своей стены у связанного навеса;
//   face   — «грань к грани»: моя max = чужая min или моя min = чужая max,
//            и габариты перекрываются по двум другим осям (блоки касаются;
//            по z — стопка «на» / «под» массу);
//   align  — то же, но по другим осям блоки не касаются (просто плоскость);
//   flush  — «заподлицо»: моя min = чужая min, моя max = чужая max;
//   level  — отметки этажей (низ и верх этажа), только z;
//   ground — земля (z = 0 и рельеф под углами), только низ по z;
//   line   — грани комнат и стен (слабая цель), только x / y;
//   center — середина к середине (самая слабая), только x / y.
// Приоритет: host-wall > face > flush/align > level/ground > line > center; среди целей
// одного ранга — ближайшая.
//
// Радиус — в пикселях экрана (мышь 12 px, касание 20 px), переведённых в мм
// по масштабу вдоль оси движения, но в пределах 20…600 мм. Гистерезис:
// притянутая цель держит, пока курсор не отведён дальше ≈ 16 px (26 px —
// касание), — блок не дрожит на границе радиуса.

export const MASS_SNAP_PX = { mouse: 12, touch: 20 };
export const MASS_RELEASE_PX = { mouse: 16, touch: 26 };
export const MASS_SNAP_MM = [20, 600];
export const MASS_SNAP_RANK = { 'host-wall': -1, face: 0, flush: 1, align: 1, level: 2, ground: 2, line: 3, center: 4 };

// Центр — слабая цель: ловится в половине радиуса.
const WEAK = { center: 0.5 };
const AXES = ['x', 'y', 'z'];

// Радиус (мм) из пикселей: px × (мм на пиксель), в пределах 20…600 мм (k —
// множитель пределов, для радиуса отрыва).
export function snapRadius(px, mmPerPx, k = 1) {
  const v = (Number(px) || 0) * (Number(mmPerPx) || 0);
  const [lo, hi] = MASS_SNAP_MM;
  return Math.min(hi * k, Math.max(lo * k, v));
}

// Радиус притяжения и отрыва (мм) для указателя 'mouse' | 'touch' | 'pen'.
export function snapTolerances(mmPerPx, pointer = 'mouse') {
  const kind = pointer === 'touch' || pointer === 'pen' ? 'touch' : 'mouse';
  const tol = snapRadius(MASS_SNAP_PX[kind], mmPerPx);
  const k = MASS_RELEASE_PX[kind] / MASS_SNAP_PX[kind];
  const release = Math.max(tol + 1, snapRadius(MASS_RELEASE_PX[kind], mmPerPx, k));
  return { tol, release };
}

// Отрезки [a0, a1] и [b0, b1] перекрываются или касаются.
const meets = (a0, a1, b0, b1) => a0 <= b1 + 0.5 && b0 <= a1 + 0.5;

// Цели по оси c для габарита box ({ x0, y0, z0, x1, y1, z1 }).
// others — [{ id, name, box }] (другие массы, повёрнутые — их massBox);
// extra: { levels: [{ elevation, height, name }], ground: [z…] (рельеф),
// lines: [координаты граней комнат и стен], hostWall: { axis, from, to } }.
export function axisTargets(c, box, others = [], extra = {}) {
  const raw = [];
  if (extra.hostWall?.axis === c) {
    for (const value of [extra.hostWall.from, extra.hostWall.to]) for (const edge of ['lo', 'hi']) {
      raw.push({ edge, value, kind: 'host-wall' });
    }
  }
  const rest = AXES.filter((q) => q !== c);
  if (c === 'z') {
    for (const z of [0, ...(extra.ground || [])]) {
      if (Number.isFinite(z) && z >= 0) raw.push({ edge: 'lo', value: Math.round(z), kind: 'ground' });
    }
  }
  for (const o of others || []) {
    const b = o.box;
    if (!b) continue;
    const lo = b[`${c}0`]; const hi = b[`${c}1`];
    const touch = rest.every((q) => meets(box[`${q}0`], box[`${q}1`], b[`${q}0`], b[`${q}1`]));
    const face = touch ? 'face' : 'align';
    const who = { id: o.id, name: o.name || '' };
    raw.push(
      { edge: 'hi', value: lo, kind: face, ...who },
      { edge: 'lo', value: hi, kind: face, ...who },
      { edge: 'lo', value: lo, kind: 'flush', ...who },
      { edge: 'hi', value: hi, kind: 'flush', ...who },
    );
    if (c !== 'z') raw.push({ edge: 'mid', value: (lo + hi) / 2, kind: 'center', ...who });
  }
  if (c === 'z') {
    for (const l of extra.levels || []) {
      const e = Number(l.elevation) || 0;
      for (const z of [e, e + (Number(l.height) || 0)]) {
        for (const edge of ['lo', 'hi']) raw.push({ edge, value: z, kind: 'level', name: l.name || '' });
      }
    }
  } else {
    for (const v of extra.lines || []) {
      if (Number.isFinite(v)) raw.push({ edge: 'lo', value: v, kind: 'line' }, { edge: 'hi', value: v, kind: 'line' });
    }
  }
  // Один край и одна координата — одна цель, самая сильная (низ на z = 0
  // или на рельеф — всегда «на землю», а не «заподлицо» с массой на земле).
  const out = [];
  const seen = new Set();
  const order = (t) => (t.kind === 'ground' ? -1 : t.rank);
  const list = raw.map((q, i) => ({ ...q, order: i, rank: MASS_SNAP_RANK[q.kind] }));
  list.sort((a, b) => order(a) - order(b) || a.order - b.order);
  for (const t of list) {
    const k = `${t.edge}:${Math.round(t.value * 2) / 2}`;
    if (seen.has(k)) continue;
    seen.add(k);
    const { order: _o, ...tt } = t;
    out.push({ ...tt, axis: c, key: `${c}:${t.kind}:${t.id || ''}:${t.edge}:${t.value}` });
  }
  return out;
}

// Привязка сдвига v отрезка [lo, hi] к целям: { value, snap } (snap — цель
// или null). tol — радиус притяжения, release — отрыва (гистерезис), held —
// key цели, притянутой на прошлом шаге; step — шаг без цели (0 — до мм);
// free — магнит выключен (только шаг); accept(value, t) — цель допустима
// (например, минимальный размер). Притянутый край встаёт на цель точно.
export function snapMove({ lo, hi, v, targets = [], tol = 0, release = tol, held = null, step = 0, free = false, accept = null }) {
  const edgeAt = (t) => (t.edge === 'lo' ? lo : t.edge === 'hi' ? hi : (lo + hi) / 2);
  const shiftTo = (t) => t.value - edgeAt(t);
  const ok = (t) => !accept || accept(shiftTo(t), t);
  if (!free) {
    // У связанного навеса угол своей стены важнее отделки, даже если
    // предыдущий кадр ещё удерживает магнит на рейках или облицовке.
    const corner = targets.filter((t) => t.kind === 'host-wall' && Math.abs(shiftTo(t) - v) <= tol && ok(t))
      .sort((a, b) => Math.abs(shiftTo(a) - v) - Math.abs(shiftTo(b) - v))[0];
    if (corner) return { value: shiftTo(corner), snap: corner };
    if (held) {
      const t = targets.find((q) => q.key === held);
      if (t && Math.abs(shiftTo(t) - v) <= release && ok(t)) return { value: shiftTo(t), snap: t };
    }
    let best = null;
    for (const t of targets) {
      const d = Math.abs(shiftTo(t) - v);
      if (d > tol * (WEAK[t.kind] || 1) || !ok(t)) continue;
      if (!best || t.rank < best.t.rank || (t.rank === best.t.rank && d < best.d)) best = { t, d };
    }
    if (best) return { value: shiftTo(best.t), snap: best.t };
  }
  return { value: step > 0 ? Math.round(v / step) * step : Math.round(v), snap: null };
}

// Подпись цели у курсора.
export function snapLabel(t) {
  if (!t) return '';
  const n = t.name ? `«${t.name}»` : '';
  switch (t.kind) {
    case 'host-wall': return 'по углу стены';
    case 'face':
      if (t.axis === 'z') return t.edge === 'lo' ? `на ${n}` : `под ${n}`;
      return `к грани ${n}`;
    case 'align': return `по грани ${n}`;
    case 'flush': return `заподлицо с ${n}`;
    case 'center': return `по центру ${n}`;
    case 'level': return `отметка ${Math.round(t.value)}`;
    case 'ground': return 'на землю';
    case 'line': return `по линии ${Math.round(t.value)}`;
    default: return '';
  }
}

// Плоскость стыка для подсветки: ось, координата и пределы по двум другим
// осям — пересечение габаритов, если они касаются, иначе объединение (цель
// без массы — габарит box). → { axis, value, ranges: { [ось]: [lo, hi] } }.
export function snapContact(box, t, targetBox = null) {
  const ranges = {};
  for (const q of AXES.filter((a) => a !== t.axis)) {
    const a0 = box[`${q}0`]; const a1 = box[`${q}1`];
    if (!targetBox) { ranges[q] = [a0, a1]; continue; }
    const b0 = targetBox[`${q}0`]; const b1 = targetBox[`${q}1`];
    const lo = Math.max(a0, b0); const hi = Math.min(a1, b1);
    ranges[q] = hi - lo > 1 ? [lo, hi] : [Math.min(a0, b0), Math.max(a1, b1)];
  }
  return { axis: t.axis, value: t.value, ranges };
}
