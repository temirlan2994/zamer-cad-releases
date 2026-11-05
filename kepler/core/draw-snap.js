// Привязки при черчении линий (как в AutoCAD), без DOM: полярное
// отслеживание и орто от последней точки, выравнивание по X/Y от вершин,
// объектные привязки (конец, середина, пересечение, центр, перпендикуляр,
// параллель, ближайшая), сетка — последней. Используется всеми инструментами,
// где точки ставятся кликами (участок, ландшафт, калибровка, север).
//
// Координаты — мм (мир/съёмка, ось Y вниз). axis — угол оси X экрана в мире
// (радианы, = −view.rotation): орто, полярные лучи и выравнивание идут по осям
// экрана, даже если вид повёрнут на север. Допуски — в пикселях экрана.

export const SNAP_LABELS = {
  end: 'Конец', int: 'Пересечение', mid: 'Середина', center: 'Центр', perp: 'Перпендикуляр',
  parallel: 'Параллель', nearest: 'Ближайшая', track: 'Выравнивание', polar: 'Полярная',
  ortho: 'Орто', grid: 'Сетка', free: 'Без привязки', input: 'Ввод',
};

export const POLAR_STEPS = [90, 45, 30, 15];

export const DEFAULT_SNAP_OPTS = {
  ortho: false, // строго 0/90° от последней точки (F8)
  polar: true, // полярное отслеживание
  polarStep: 45, // шаг лучей, °
  objects: true, // объектные привязки
  tracking: true, // выравнивание по X/Y от вершин
};

const DEG = Math.PI / 180;
const EPS = 1e-9;

const rot = (p, a) => {
  if (!a) return { x: p.x, y: p.y };
  const c = Math.cos(a); const s = Math.sin(a);
  return { x: p.x * c - p.y * s, y: p.x * s + p.y * c };
};
const clean = (v) => (Math.abs(v - Math.round(v)) < 1e-6 ? Math.round(v) : v);
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

function footOnSegment(p, a, b) {
  const dx = b.x - a.x; const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  const t = l2 < EPS ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
  return { x: a.x + dx * t, y: a.y + dy * t, t };
}

// Пересечение прямых (p + u·t) и (q + v·s); null — параллельны.
function lineLine(p, u, q, v) {
  const den = u.x * v.y - u.y * v.x;
  if (Math.abs(den) < EPS) return null;
  const t = ((q.x - p.x) * v.y - (q.y - p.y) * v.x) / den;
  const s = ((q.x - p.x) * u.y - (q.y - p.y) * u.x) / den;
  return { x: p.x + u.x * t, y: p.y + u.y * t, t, s };
}

function segSeg(a, b, c, d) {
  const hit = lineLine(a, { x: b.x - a.x, y: b.y - a.y }, c, { x: d.x - c.x, y: d.y - c.y });
  if (!hit || hit.t < -1e-9 || hit.t > 1 + 1e-9 || hit.s < -1e-9 || hit.s > 1 + 1e-9) return null;
  return { x: hit.x, y: hit.y };
}

// Полилинии/контуры → вершины и отрезки. Вход: массив точек или { points, closed }.
function addShape(list, verts, segs, closedDefault) {
  for (const raw of list || []) {
    if (!raw) continue;
    const pts = Array.isArray(raw) ? raw : raw.points;
    if (!pts?.length) continue;
    const closed = Array.isArray(raw) ? closedDefault : Boolean(raw.closed);
    for (const p of pts) verts.push(p);
    for (let i = 0; i + 1 < pts.length; i += 1) segs.push({ a: pts[i], b: pts[i + 1] });
    if (closed && pts.length >= 3) segs.push({ a: pts[pts.length - 1], b: pts[0] });
  }
}

// Длина «3,45 м», угол «90°» (против часовой на экране, 0° — вправо).
export function formatLength(mm) {
  return `${(mm / 1000).toFixed(2).replace('.', ',')} м`;
}
export function formatAngle(deg) {
  const r = Math.round(deg * 10) / 10;
  return `${String(r % 1 === 0 ? r : r.toFixed(1)).replace('.', ',')}°`;
}
export function displayAngle(from, to, axis = 0) {
  const l = rot({ x: to.x - from.x, y: to.y - from.y }, -axis);
  const a = -Math.atan2(l.y, l.x) / DEG;
  return ((a % 360) + 360) % 360;
}

// Главная функция. Возвращает { point, kind, label, guides, markers, tooltip, nearSeg }.
// guides: [{ type: 'polar'|'ortho'|'align'|'parallel'|'perp'|'seg', from, to, label? }]
// markers: [{ kind: 'end'|'mid'|'int'|'center'|'perp'|'parallel'|'nearest'|'track'|'source', at }]
export function snapDrawPoint({
  cursor, prev = null, points = [], closed = false, otherShapes = [], houseCorners = [], boundary = null,
  circles = [], scale = 1, grid = 0, axis = 0, hoverSeg = null, opts = {},
} = {}) {
  const o = { ...DEFAULT_SNAP_OPTS, ...opts };
  const tol = (o.tolPx ?? 10) / (scale || 1);
  const toL = (p) => rot(p, -axis);
  const toW = (p) => { const w = rot(p, axis); return { x: clean(w.x), y: clean(w.y) }; };
  const ortho = Boolean(o.ortho || o.tempOrtho);

  const finish = (pointL, kind, guides = [], markers = [], extra = {}) => {
    const point = toW(pointL);
    const gw = guides.map((g) => ({ ...g, from: toW(g.from), to: toW(g.to) }));
    const mw = markers.map((m) => ({ ...m, at: toW(m.at) }));
    let tooltip = '';
    if (prev) {
      const len = dist(prev, point);
      tooltip = len > 0.5 ? `${formatLength(len)} · ${formatAngle(displayAngle(prev, point, axis))}` : '';
    }
    return {
      point, kind, label: kind === 'grid' || kind === 'free' ? '' : SNAP_LABELS[kind] || '',
      guides: gw, markers: mw, tooltip, nearSeg: extra.nearSeg ? { a: toW(extra.nearSeg.a), b: toW(extra.nearSeg.b) } : null,
    };
  };

  if (o.free) return finish(toL({ x: Math.round(cursor.x), y: Math.round(cursor.y) }), 'free');

  const c = toL(cursor);
  const P = prev ? toL(prev) : null;
  const verts = [];
  const segs = [];
  addShape([{ points: points.map(toL), closed }], verts, segs, false);
  addShape(otherShapes.map((s) => (Array.isArray(s) ? s.map(toL) : { points: (s.points || []).map(toL), closed: s.closed })), verts, segs, false);
  const house = (houseCorners || []).length && !Array.isArray(houseCorners[0]) && houseCorners[0]?.x !== undefined
    ? [houseCorners] : houseCorners || [];
  addShape(house.map((poly) => poly.map(toL)), verts, segs, true);
  if (boundary?.length) addShape([boundary.map(toL)], verts, segs, true);
  const centers = (circles || []).map(toL);

  // Ближайшие к курсору отрезки (в пределах допуска).
  const near = [];
  for (const s of segs) {
    const f = footOnSegment(c, s.a, s.b);
    const d = dist(f, c);
    if (d <= tol) near.push({ ...s, foot: f, d });
  }
  near.sort((a, b) => a.d - b.d);
  const nearSeg = near[0] ? { a: near[0].a, b: near[0].b } : null;

  const best = (cands) => cands.reduce((m, x) => (!m || x.d < m.d ? x : m), null);

  // --- Направление от последней точки: орто или полярный луч ---
  let ray = null; // { dir, angleDeg, t, foot, d }
  if (P) {
    const step = ortho ? 90 : Math.max(1, Number(o.polarStep) || 45);
    if (ortho || o.polar) {
      const v = { x: c.x - P.x, y: c.y - P.y };
      const cands = [];
      for (let k = 0; k * step < 360 - 1e-9; k += 1) {
        const a = k * step * DEG;
        const dir = { x: Math.cos(a), y: -Math.sin(a) }; // против часовой на экране
        const t = v.x * dir.x + v.y * dir.y;
        if (t <= 0) continue;
        const d = Math.abs(v.x * dir.y - v.y * dir.x);
        cands.push({ dir, angleDeg: k * step, t: Math.max(0, t), d });
      }
      const r = best(cands);
      if (r && (ortho || r.d <= tol)) ray = { ...r, foot: { x: P.x + r.dir.x * r.t, y: P.y + r.dir.y * r.t } };
    }
  }
  const rayGuide = () => ({ type: ortho ? 'ortho' : 'polar', from: P, to: { x: P.x + ray.dir.x * Math.max(ray.t, 1), y: P.y + ray.dir.y * Math.max(ray.t, 1) } });
  const roundAlong = (t) => (grid > 0 ? Math.max(grid, Math.round(t / grid) * grid) : t);
  const onRay = (t) => ({ x: P.x + ray.dir.x * t, y: P.y + ray.dir.y * t });

  // Линии выравнивания: вертикали x = v.x и горизонтали y = v.y (в осях экрана).
  const trackSources = o.tracking ? verts.filter((v) => !P || dist(v, P) > 1e-6) : [];
  const nearestLine = (axisName) => {
    let m = null;
    for (const v of trackSources) {
      const d = Math.abs((axisName === 'v' ? c.x - v.x : c.y - v.y));
      if (d <= tol && (!m || d < m.d)) m = { v, d, axis: axisName };
    }
    return m;
  };
  const alignGuide = (line, at) => ({ type: 'align', from: line.v, to: at });

  // --- Орто: точка всегда на оси от последней точки ---
  if (ray && ortho) {
    const guides = [rayGuide()];
    // Пересечение оси с отрезками рядом с курсором.
    if (o.objects) {
      const hits = [];
      for (const s of segs) {
        const h = lineLine(P, ray.dir, s.a, { x: s.b.x - s.a.x, y: s.b.y - s.a.y });
        if (!h || h.t <= 0 || h.s < -1e-9 || h.s > 1 + 1e-9) continue;
        const d = dist(h, ray.foot);
        if (d <= tol) hits.push({ p: { x: h.x, y: h.y }, d });
      }
      const h = best(hits);
      if (h) { return finish(h.p, 'int', [{ ...guides[0], to: h.p }], [{ kind: 'int', at: h.p }], { nearSeg }); }
    }
    // Выравнивание: линия, поперечная оси, от вершины.
    const cross = nearestLine(Math.abs(ray.dir.x) > 0.5 ? 'v' : 'h');
    if (cross) {
      const p = cross.axis === 'v' ? { x: cross.v.x, y: P.y } : { x: P.x, y: cross.v.y };
      if ((p.x - P.x) * ray.dir.x + (p.y - P.y) * ray.dir.y > 0) {
        return finish(p, 'track', [{ ...guides[0], to: p }, alignGuide(cross, p)],
          [{ kind: 'track', at: p }, { kind: 'source', at: cross.v }], { nearSeg });
      }
    }
    const p = onRay(roundAlong(ray.t));
    return finish(p, 'ortho', [{ ...guides[0], to: p }], [], { nearSeg });
  }

  // --- Объектные привязки ---
  if (o.objects) {
    const end = best(verts.map((v) => ({ p: v, d: dist(v, c) })).filter((x) => x.d <= tol));
    if (end) return finish(end.p, 'end', [], [{ kind: 'end', at: end.p }], { nearSeg });
    const ctr = best(centers.map((v) => ({ p: v, d: dist(v, c) })).filter((x) => x.d <= tol));
    if (ctr) return finish(ctr.p, 'center', [], [{ kind: 'center', at: ctr.p }], { nearSeg });
    const ints = [];
    for (let i = 0; i < near.length; i += 1) {
      for (let j = i + 1; j < near.length; j += 1) {
        const h = segSeg(near[i].a, near[i].b, near[j].a, near[j].b);
        if (h && dist(h, c) <= tol) ints.push({ p: h, d: dist(h, c) });
      }
    }
    const int = best(ints);
    if (int) return finish(int.p, 'int', [], [{ kind: 'int', at: int.p }], { nearSeg });
    const mid = best(segs.map((s) => {
      const m = { x: (s.a.x + s.b.x) / 2, y: (s.a.y + s.b.y) / 2 };
      return { p: m, d: dist(m, c) };
    }).filter((x) => x.d <= tol));
    if (mid) return finish(mid.p, 'mid', [], [{ kind: 'mid', at: mid.p }], { nearSeg });
    if (P) {
      const perps = [];
      for (const s of segs) {
        const dx = s.b.x - s.a.x; const dy = s.b.y - s.a.y;
        const l2 = dx * dx + dy * dy;
        if (l2 < EPS) continue;
        const t = ((P.x - s.a.x) * dx + (P.y - s.a.y) * dy) / l2;
        if (t < 0 || t > 1) continue;
        const f = { x: s.a.x + dx * t, y: s.a.y + dy * t };
        if (dist(f, P) < 1) continue;
        const d = dist(f, c);
        if (d <= tol) perps.push({ p: f, d });
      }
      const perp = best(perps);
      if (perp) return finish(perp.p, 'perp', [{ type: 'perp', from: P, to: perp.p }], [{ kind: 'perp', at: perp.p }], { nearSeg });
      if (hoverSeg) {
        const a = toL(hoverSeg.a); const b = toL(hoverSeg.b);
        const len = dist(a, b);
        if (len > EPS) {
          const u = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
          const t0 = (c.x - P.x) * u.x + (c.y - P.y) * u.y;
          const d = Math.abs((c.x - P.x) * u.y - (c.y - P.y) * u.x);
          if (d <= tol && Math.abs(t0) > EPS) {
            const t = Math.sign(t0) * roundAlong(Math.abs(t0));
            const p = { x: P.x + u.x * t, y: P.y + u.y * t };
            return finish(p, 'parallel', [{ type: 'parallel', from: P, to: p }, { type: 'seg', from: a, to: b }],
              [{ kind: 'parallel', at: p }], { nearSeg });
          }
        }
      }
    }
  }

  // --- Выравнивание (два направления или направление + полярный луч) ---
  const vLine = nearestLine('v');
  const hLine = nearestLine('h');
  if (vLine && hLine) {
    const p = { x: vLine.v.x, y: hLine.v.y };
    return finish(p, 'track', [alignGuide(vLine, p), alignGuide(hLine, p)],
      [{ kind: 'track', at: p }, { kind: 'source', at: vLine.v }, { kind: 'source', at: hLine.v }], { nearSeg });
  }
  const single = vLine || hLine;
  if (ray && single) {
    const lineDir = single.axis === 'v' ? { x: 0, y: 1 } : { x: 1, y: 0 };
    const h = lineLine(P, ray.dir, single.v, lineDir);
    if (h && h.t > 0 && dist(h, c) <= tol * 1.5) {
      const p = { x: h.x, y: h.y };
      return finish(p, 'track', [{ ...rayGuide(), to: p }, alignGuide(single, p)],
        [{ kind: 'track', at: p }, { kind: 'source', at: single.v }], { nearSeg });
    }
  }
  // Полярный луч пересекает отрезок у курсора — точка пересечения.
  if (ray && o.objects) {
    const hits = [];
    for (const s of near) {
      const h = lineLine(P, ray.dir, s.a, { x: s.b.x - s.a.x, y: s.b.y - s.a.y });
      if (!h || h.t <= 0 || h.s < -1e-9 || h.s > 1 + 1e-9) continue;
      const d = dist(h, c);
      if (d <= tol * 1.5) hits.push({ p: { x: h.x, y: h.y }, d });
    }
    const h = best(hits);
    if (h) return finish(h.p, 'int', [{ ...rayGuide(), to: h.p }], [{ kind: 'int', at: h.p }], { nearSeg });
  }
  if (o.objects && near[0]) {
    const p = { x: near[0].foot.x, y: near[0].foot.y };
    return finish(p, 'nearest', [], [{ kind: 'nearest', at: p }], { nearSeg });
  }
  // Линия выравнивания, не параллельная активному лучу (иначе луч от последней точки важнее).
  if (single) {
    const parallelToRay = ray && (single.axis === 'v' ? Math.abs(ray.dir.x) < 1e-6 : Math.abs(ray.dir.y) < 1e-6);
    if (!parallelToRay) {
      const g = grid > 0 && !axis ? (v) => Math.round(v / grid) * grid : (v) => v;
      const p = single.axis === 'v' ? { x: single.v.x, y: g(c.y) } : { x: g(c.x), y: single.v.y };
      return finish(p, 'track', [alignGuide(single, p)], [{ kind: 'source', at: single.v }], { nearSeg });
    }
  }
  if (ray) {
    const p = onRay(roundAlong(ray.t));
    return finish(p, 'polar', [{ ...rayGuide(), to: p }], [], { nearSeg });
  }
  // Сетка — в осях мира (так рисуется сетка участка).
  if (grid > 0) {
    const w = { x: Math.round(cursor.x / grid) * grid, y: Math.round(cursor.y / grid) * grid };
    return finish(toL(w), 'grid', [], [], { nearSeg });
  }
  return finish(c, 'free', [], [], { nearSeg });
}

// Динамический ввод: точка на расстоянии length от prev — по направлению на
// toward (текущая привязка курсора) или под углом angle (°, против часовой
// на экране, 0° — вправо). Без направления — вправо по экрану.
export function dynamicPoint({ prev, toward = null, length, angle = null, axis = 0 }) {
  const L = Number(length);
  if (!prev || !Number.isFinite(L) || L <= 0) return null;
  let dir;
  if (angle !== null && angle !== '' && Number.isFinite(Number(angle))) {
    const a = axis - Number(angle) * DEG;
    dir = { x: Math.cos(a), y: Math.sin(a) };
  } else if (toward && dist(toward, prev) > 1e-6) {
    const d = dist(toward, prev);
    dir = { x: (toward.x - prev.x) / d, y: (toward.y - prev.y) / d };
  } else {
    dir = { x: Math.cos(axis), y: Math.sin(axis) };
  }
  return { x: clean(prev.x + dir.x * L), y: clean(prev.y + dir.y * L) };
}

// Число из поля ввода: «3,5» / «3500»; units — 'm' или 'mm' (как в настройках проекта).
export function parseDynamicLength(text, units = 'mm') {
  const v = Number(String(text ?? '').trim().replace(',', '.'));
  if (!Number.isFinite(v) || v <= 0) return null;
  return units === 'm' ? v * 1000 : v;
}
