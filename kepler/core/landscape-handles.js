// Режимы ручек объектов ландшафта — как у мебели (core/item-handles.js):
// повторный клик по выбранному переключает «выбор → поворот → растяжение →
// масштаб». Для группы (два и больше) — общая рамка, повёрнутая по экрану
// (вид «Ландшафта» повёрнут по северу участка), как у группы мебели
// (core/group-handles.js). Чистая логика без DOM; состояние —
// state.itemHandle = { id: 'ls:…' | 'lsgroup:…', mode }.
//
// Наборы режимов:
//   прямоугольник/овал — выбор, поворот, растяжение, масштаб (как мебель);
//   круг и растение (shape point/circle) — выбор, масштаб (диаметр);
//   линия/контур — выбор (вершины, как раньше), поворот, масштаб рамки;
//   выноска и закреплённый — только выбор;
//   группа — выбор, поворот, растяжение, масштаб.

import { itemHandleMode } from './item-handles.js';
import {
  isNoteShape, isPathShape, landscapeDef, objectOutline, resizeObject, rotateObjectAbout, syncShape, toLocal, toWorld,
  translateObject,
} from './landscape.js';

export const LS_HANDLE_TITLES = {
  select: 'Выбрано',
  rotate: 'Поворот — тяните круг у угла',
  stretch: 'Растяжение — тяните квадрат на стороне, противоположная остаётся на месте',
  scale: 'Масштаб — тяните угол',
};
export const LS_GROUP_TITLES = {
  select: 'Группа выбрана',
  rotate: 'Поворот группы — тяните круг у угла',
  stretch: 'Растяжение группы — тяните квадрат на стороне, противоположная остаётся на месте',
  scale: 'Масштаб группы — тяните угол, противоположный остаётся на месте',
};

const ALL = ['select', 'rotate', 'stretch', 'scale'];
const norm = (d) => {
  const n = ((Number(d) || 0) % 360 + 360) % 360;
  return Math.abs(n - 360) < 1e-9 ? 0 : n;
};
const clone = (o) => JSON.parse(JSON.stringify(o));

// Доступные режимы одного объекта.
export function lsHandleModes(o) {
  const def = landscapeDef(o?.kind);
  if (!def || o.locked || isNoteShape(def)) return ['select'];
  if (isPathShape(def)) return ['select', 'rotate', 'scale'];
  if (def.lockAspect || def.shape === 'point' || def.shape === 'circle') return ['select', 'scale'];
  return ALL;
}

// Ключ режима (state.itemHandle.id) по выбору ландшафта.
export function lsHandleKey(selection) {
  if (selection?.type !== 'landscape' || !selection.ids?.length) return null;
  if (selection.ids.length === 1) return `ls:${selection.ids[0]}`;
  return `lsgroup:${[...selection.ids].sort().join(',')}`;
}

export function lsModesFor(objs) {
  if (objs.length === 1) return lsHandleModes(objs[0]);
  return objs.filter((o) => !o.locked).length >= 2 ? ALL : ['select'];
}

export function lsHandleMode(handle, key, modes) {
  const m = itemHandleMode(handle, key);
  return modes.includes(m) ? m : 'select';
}

export function nextLsHandle(handle, key, modes) {
  const cur = lsHandleMode(handle, key, modes);
  return { id: key, mode: modes[(modes.indexOf(cur) + 1) % modes.length] };
}

// Угол «по экрану» (°): вид повёрнут на viewRad — рамка группы ровно на экране.
export function screenAngle(viewRad = 0) {
  return norm(Math.round(((-(viewRad || 0) * 180) / Math.PI) * 100) / 100);
}

// Рамка ручек: { x, y (центр), w, h, rotation° }. Один прямоугольный объект —
// он сам; линия/контур и группа — описывающий прямоугольник, повёрнутый по экрану.
export function lsFrame(objs, viewRad = 0) {
  if (!objs.length) return null;
  if (objs.length === 1) {
    const o = objs[0];
    const def = landscapeDef(o.kind);
    if (!isPathShape(def) && !isNoteShape(def)) return { x: o.x, y: o.y, w: o.w, h: o.h, rotation: o.rotation || 0 };
  }
  const rotation = screenAngle(viewRad);
  const axes = { x: 0, y: 0, rotation };
  let x1 = Infinity; let y1 = Infinity; let x2 = -Infinity; let y2 = -Infinity;
  for (const o of objs) {
    for (const p of objectOutline(o)) {
      const l = toLocal(axes, p);
      x1 = Math.min(x1, l.x); y1 = Math.min(y1, l.y); x2 = Math.max(x2, l.x); y2 = Math.max(y2, l.y);
    }
  }
  if (!Number.isFinite(x1)) return null;
  const c = toWorld(axes, (x1 + x2) / 2, (y1 + y2) / 2);
  return { x: c.x, y: c.y, w: Math.max(1, x2 - x1), h: Math.max(1, y2 - y1), rotation };
}

const SIGN = { nw: [-1, -1], ne: [1, -1], se: [1, 1], sw: [-1, 1] };

export function frameCorners(f) {
  return Object.entries(SIGN).map(([id, [sx, sy]]) => ({ id, ...toWorld(f, (sx * f.w) / 2, (sy * f.h) / 2) }));
}

export function frameEdges(f) {
  return [['n', 0, -f.h / 2], ['e', f.w / 2, 0], ['s', 0, f.h / 2], ['w', -f.w / 2, 0]]
    .map(([id, lx, ly]) => ({ id, ...toWorld(f, lx, ly) }));
}

// Круги поворота — снаружи углов на outPx экранных пикселей.
export function frameRotators(f, outPx, scale) {
  const out = outPx / (scale || 1);
  const k = Math.SQRT1_2;
  return Object.entries(SIGN).map(([id, [sx, sy]]) => ({ id, ...toWorld(f, sx * (f.w / 2 + out * k), sy * (f.h / 2 + out * k)) }));
}

// Состояние ручек для отрисовки и попадания.
export function lsHandleInfo(objects, selection, handle, viewRad = 0) {
  const key = lsHandleKey(selection);
  if (!key) return null;
  const ids = new Set(selection.ids);
  const objs = objects.filter((o) => ids.has(o.id));
  if (!objs.length) return null;
  if (objs.length === 1 && objs[0].kind === 'stairs-out' && selection.part) return null;
  const modes = lsModesFor(objs);
  const mode = lsHandleMode(handle, key, modes);
  const group = objs.length > 1;
  const def = landscapeDef(objs[0].kind);
  // Рамка нужна группе и линии/контуру; у прямоугольника — сам объект.
  const framed = group || isPathShape(def);
  return { key, modes, mode, group, objs, framed, frame: lsFrame(objs, viewRad) };
}

// ----------------------------------------------------------- Преобразования
// starts — снимки объектов в начале жеста (lsStarts); результат — новые
// объекты (копии) без мутации снимков. moveOnly — id, которые только едут
// (растения в коробе): их размер не меняется.

export function lsStarts(objs) {
  return objs.map(clone);
}

const isShape = (o) => isPathShape(landscapeDef(o.kind));
const isNote = (o) => isNoteShape(landscapeDef(o.kind));

// Поворот на deg (по часовой, ось Y вниз) вокруг center.
export function rotateLs(starts, center, deg) {
  return starts.map((s) => rotateObjectAbout(clone(s), center.x, center.y, deg));
}

// Какая сторона объекта лежит вдоль оси рамки ('w' | 'h' | null — косо).
function sideAlong(o, frame, axis) {
  const d = norm(Math.round(((o.rotation || 0) - frame.rotation) * 1e6) / 1e6) % 180;
  if (Math.abs(d) < 1e-6 || Math.abs(d - 180) < 1e-6) return axis === 'x' ? 'w' : 'h';
  if (Math.abs(d - 90) < 1e-6) return axis === 'x' ? 'h' : 'w';
  return null;
}

// Применить отображение точек map (мир → мир) к объекту-копии.
function mapObject(o, map, size, moveOnly) {
  if (isShape(o)) {
    o.points = o.points.map((p) => { const q = map(p); return { x: Math.round(q.x), y: Math.round(q.y) }; });
    return syncShape(o);
  }
  const c = map(o);
  if (isNote(o) || moveOnly) return translateObject(o, Math.round(c.x) - o.x, Math.round(c.y) - o.y);
  if (size) {
    const { w, h } = size(o);
    if (w !== o.w || h !== o.h) resizeObject(o, w, h);
  }
  o.x = Math.round(c.x);
  o.y = Math.round(c.y);
  return o;
}

// Растяжение со стороны edge ('n'|'e'|'s'|'w') рамки: противоположная
// сторона неподвижна; центры и (у объектов вдоль оси) размеры — пропорционально.
export function stretchLs(starts, frame, edge, point, { snap = 50, moveOnly = new Set() } = {}) {
  const axis = edge === 'e' || edge === 'w' ? 'x' : 'y';
  const sign = edge === 'e' || edge === 's' ? 1 : -1;
  const len0 = axis === 'x' ? frame.w : frame.h;
  const fixed = -sign * (len0 / 2);
  const cur = toLocal(frame, point)[axis];
  // Пределы: размеры типа у деформируемых объектов.
  let kMin = len0 > 0 ? Math.min(1, snap / len0) : 0;
  let kMax = Infinity;
  for (const s of starts) {
    if (isShape(s) || isNote(s) || moveOnly.has(s.id)) continue;
    const def = landscapeDef(s.kind);
    const side = def.lockAspect ? null : sideAlong(s, frame, axis);
    if (!side || !(s[side] > 0)) continue;
    kMin = Math.max(kMin, Math.min(1, def.min[side] / s[side]));
    kMax = Math.min(kMax, Math.max(1, def.max[side] / s[side]));
  }
  const raw = (cur - fixed) * sign;
  let len = Math.max(snap, Math.round(raw / snap) * snap);
  let k = len0 > 0 ? len / len0 : 1;
  k = Math.min(kMax, Math.max(kMin, k));
  len = len0 * k;
  const map = (p) => {
    const l = toLocal(frame, p);
    if (axis === 'x') l.x = fixed + (l.x - fixed) * k; else l.y = fixed + (l.y - fixed) * k;
    return toWorld(frame, l.x, l.y);
  };
  const size = (o) => {
    const def = landscapeDef(o.kind);
    const side = def.lockAspect ? null : sideAlong(o, frame, axis);
    return { w: side === 'w' ? Math.round(o.w * k) : o.w, h: side === 'h' ? Math.round(o.h * k) : o.h };
  };
  const objects = starts.map((s) => mapObject(clone(s), map, size, moveOnly.has(s.id)));
  const mid = fixed + (sign * len) / 2;
  const c = axis === 'x' ? toWorld(frame, mid, 0) : toWorld(frame, 0, mid);
  const box = { ...frame, x: c.x, y: c.y, ...(axis === 'x' ? { w: len } : { h: len }) };
  return { objects, k, frame: box };
}

// Масштаб за угол corner: один коэффициент; about = 'opposite' — неподвижен
// противоположный угол, 'center' — центр рамки. Шаг — по ширине рамки.
export function scaleLs(starts, frame, corner, point, { snap = 50, about = 'opposite', moveOnly = new Set() } = {}) {
  const [sx, sy] = SIGN[corner];
  const anchor = about === 'center' ? { x: 0, y: 0 } : { x: (-sx * frame.w) / 2, y: (-sy * frame.h) / 2 };
  const c0 = { x: (sx * frame.w) / 2, y: (sy * frame.h) / 2 };
  const d = { x: c0.x - anchor.x, y: c0.y - anchor.y };
  const d2 = d.x * d.x + d.y * d.y || 1;
  const l = toLocal(frame, point);
  let k = ((l.x - anchor.x) * d.x + (l.y - anchor.y) * d.y) / d2;
  const span = Math.abs(d.x) || frame.w;
  if (span > 0 && snap > 0) k = (Math.round((span * k) / snap) * snap) / span;
  let kMin = span > 0 ? Math.min(1, snap / span) : 0;
  let kMax = Infinity;
  for (const s of starts) {
    if (isShape(s) || isNote(s) || moveOnly.has(s.id)) continue;
    const def = landscapeDef(s.kind);
    if (s.w > 0) { kMin = Math.max(kMin, Math.min(1, def.min.w / s.w)); kMax = Math.min(kMax, Math.max(1, def.max.w / s.w)); }
    if (s.h > 0 && !def.lockAspect) { kMin = Math.max(kMin, Math.min(1, def.min.h / s.h)); kMax = Math.min(kMax, Math.max(1, def.max.h / s.h)); }
  }
  k = Math.min(kMax, Math.max(kMin, k));
  const map = (p) => {
    const q = toLocal(frame, p);
    return toWorld(frame, anchor.x + (q.x - anchor.x) * k, anchor.y + (q.y - anchor.y) * k);
  };
  const size = (o) => ({ w: Math.round(o.w * k), h: Math.round(o.h * k) });
  const objects = starts.map((s) => mapObject(clone(s), map, size, moveOnly.has(s.id)));
  const c = toWorld(frame, anchor.x * (1 - k), anchor.y * (1 - k));
  return { objects, k, frame: { ...frame, x: c.x, y: c.y, w: frame.w * k, h: frame.h * k } };
}

// ----------------------------------------------------------- Сдвиг ребра
// Ребро index (вершины index → index+1) контура/линии points едет как линия
// на d мм вдоль своей нормали n = (−u.y, u.x), u — направление ребра. Концы
// скользят по своим смежным рёбрам (те остаются на своих прямых и
// пересекаются с новым положением ребра); смежное ребро, параллельное
// сдвигаемому, или его отсутствие (конец линии) — конец едет ровно по нормали.

const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
const dot = (a, b) => a.x * b.x + a.y * b.y;
const cross = (a, b) => a.x * b.y - a.y * b.x;

export function edgeFrame(points, index) {
  const n = points.length;
  const a = points[index];
  const b = points[(index + 1) % n];
  if (!a || !b) return null;
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  if (len < 1e-9) return null;
  const u = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
  return { a, b, u, n: { x: -u.y, y: u.x }, len };
}

function shiftedEdge(points, index, closed, d) {
  const cnt = points.length;
  const f = edgeFrame(points, index);
  const ib = (index + 1) % cnt;
  const out = points.map((p) => ({ x: p.x, y: p.y }));
  // Конец p скользит вдоль направления v (смежное ребро) до прямой ребра + d·n.
  const slide = (p, v) => {
    const vn = v ? dot(v, f.n) : 0;
    if (!v || Math.abs(vn) < 0.05) return { x: p.x + f.n.x * d, y: p.y + f.n.y * d };
    const t = d / vn;
    return { x: p.x + v.x * t, y: p.y + v.y * t };
  };
  const hasPrev = closed || index > 0;
  const hasNext = closed || ib < cnt - 1;
  const unit = (v) => { const l = Math.hypot(v.x, v.y); return l > 1e-9 ? { x: v.x / l, y: v.y / l } : null; };
  const prev = hasPrev ? unit(sub(f.a, points[(index - 1 + cnt) % cnt])) : null;
  const next = hasNext ? unit(sub(points[(ib + 1) % cnt], f.b)) : null;
  const a = slide(f.a, prev);
  const b = slide(f.b, next);
  out[index] = { x: Math.round(a.x), y: Math.round(a.y) };
  out[ib] = { x: Math.round(b.x), y: Math.round(b.y) };
  return out;
}

function segmentsCross(p1, p2, p3, p4) {
  const d1 = cross(sub(p4, p3), sub(p1, p3));
  const d2 = cross(sub(p4, p3), sub(p2, p3));
  const d3 = cross(sub(p2, p1), sub(p3, p1));
  const d4 = cross(sub(p2, p1), sub(p4, p1));
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

const signedArea = (pts) => pts.reduce((s, p, i) => s + cross(p, pts[(i + 1) % pts.length]), 0) / 2;

// Форма цела: ребро и смежные не вывернулись и не схлопнулись, контур без
// самопересечений, площадь того же знака и не нулевая.
function edgeShapeOk(before, after, index, closed) {
  const cnt = before.length;
  const ib = (index + 1) % cnt;
  const sameDir = (i, j) => {
    const v0 = sub(before[j], before[i]);
    const v1 = sub(after[j], after[i]);
    return Math.hypot(v1.x, v1.y) >= 1 && dot(v0, v1) > 0;
  };
  if (!sameDir(index, ib)) return false;
  if ((closed || index > 0) && !sameDir((index - 1 + cnt) % cnt, index)) return false;
  if ((closed || ib < cnt - 1) && !sameDir(ib, (ib + 1) % cnt)) return false;
  const segs = closed ? cnt : cnt - 1;
  for (let i = 0; i < segs; i += 1) {
    for (let j = i + 2; j < segs; j += 1) {
      if (closed && i === 0 && j === segs - 1) continue; // соседи через замыкание
      if (segmentsCross(after[i], after[(i + 1) % cnt], after[j], after[(j + 1) % cnt])) return false;
    }
  }
  if (closed) {
    const s0 = signedArea(before);
    const s1 = signedArea(after);
    if (Math.abs(s1) < 1 || Math.sign(s1) !== Math.sign(s0)) return false;
  }
  return true;
}

// Сдвиг ребра: raw — желаемый сдвиг (мм) вдоль нормали ребра. snap > 0 —
// шаг: у ребра вдоль оси X/Y на сетку встаёт сама линия, у наклонного —
// величина сдвига кратна шагу. Если форма ломается — упор в последнее
// допустимое положение (по шагу). Возвращает { points, d, clamped } или null.
export function moveEdgeLs(points, index, closed, raw, { snap = 0 } = {}) {
  const f = edgeFrame(points, index);
  if (!f || !Number.isFinite(raw)) return null;
  const axisY = Math.abs(f.u.y) < 1e-9; // ребро горизонтально — линия по y
  const axisX = Math.abs(f.u.x) < 1e-9;
  const toGrid = (d) => {
    if (!(snap > 0)) return d;
    if (axisY) return (Math.round((f.a.y + d * f.n.y) / snap) * snap - f.a.y) / f.n.y;
    if (axisX) return (Math.round((f.a.x + d * f.n.x) / snap) * snap - f.a.x) / f.n.x;
    return Math.round(d / snap) * snap;
  };
  const ok = (d) => edgeShapeOk(points, shiftedEdge(points, index, closed, d), index, closed);
  let d = toGrid(raw);
  let clamped = false;
  if (Math.abs(d) > 1e-9 && !ok(d)) {
    clamped = true;
    // Граница допустимого — делением пополам между 0 и d.
    let lo = 0;
    let hi = d;
    for (let k = 0; k < 40; k += 1) {
      const mid = (lo + hi) / 2;
      if (ok(mid)) lo = mid; else hi = mid;
    }
    d = lo;
    if (snap > 0) {
      const sign = Math.sign(d) || Math.sign(raw);
      let g = toGrid(d);
      if (Math.sign(g) === sign && Math.abs(g) > Math.abs(d)) g -= sign * snap;
      while (Math.abs(g) > 1e-9 && (Math.sign(g) !== sign || !ok(g))) {
        if (Math.sign(g) !== sign) { g = 0; break; }
        g -= sign * snap;
      }
      d = Math.sign(g) === sign ? g : 0;
    }
  }
  if (Math.abs(d) < 1e-9) return { points: points.map((p) => ({ x: p.x, y: p.y })), d: 0, clamped };
  return { points: shiftedEdge(points, index, closed, d), d, clamped };
}
