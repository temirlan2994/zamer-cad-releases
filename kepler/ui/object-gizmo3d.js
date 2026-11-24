// Универсальный гизмо перемещения 3D: мебель и объекты участка. Визуально и
// по попаданию совпадает с гизмо масс (X/Y/Z + плоскость XY), но допустимые
// оси задаёт сам объект. Растения и обычные объекты участка двигаются только
// по земле; Z доступен мебели и объектам с проектной отметкой.

import { ELEV_KINDS, ELEV_LIMIT, PLATFORM_KINDS, platformTop } from '../core/landscape.js';
import { GIZMO_AXES, GIZMO_COLORS, GIZMO_PLANE_PX, GIZMO_PX, gizmoPick } from '../core/mass-gizmo.js';
import { toLocal, toWorld } from '../core/building.js';
import { platformLevelEdit, setPlatformLevel } from '../core/landscape-tools.js';
import { groundFn } from '../core/landscape-section.js';
import { state } from './state.js';
import { afterChange, pushHistory, snapshot } from './store.js';

let env = null;
let hover = null;
let drag = null;

export function initObjectGizmo3d(value) { env = value; }
export const objectGizmoDragging = () => Boolean(drag);

function target() {
  const sel = state.selection;
  if (sel?.type === 'item') {
    const object = state.project?.items?.find((entry) => entry.id === sel.id);
    return object ? { type: 'item', id: object.id, object, canZ: true } : null;
  }
  if (sel?.type === 'landscape' && sel.ids?.length === 1) {
    const object = state.project.site?.landscape?.objects?.find((entry) => entry.id === sel.ids[0]);
    return object && !object.locked
      ? { type: 'landscape', id: object.id, object, canZ: ELEV_KINDS.has(object.kind) }
      : null;
  }
  return null;
}

function bounds(t = target()) {
  if (!t || !env) return null;
  const list = env.faces().filter((face) => (t.type === 'item' ? face.itemId === t.id : face.landscapeId === t.id));
  const pts = list.flatMap((face) => face.pts || []);
  if (!pts.length) return null;
  return {
    x0: Math.min(...pts.map((p) => p.x)), x1: Math.max(...pts.map((p) => p.x)),
    y0: Math.min(...pts.map((p) => p.y)), y1: Math.max(...pts.map((p) => p.y)),
    z0: Math.min(...pts.map((p) => p.z)), z1: Math.max(...pts.map((p) => p.z)),
  };
}

const add = (p, v, k) => ({ x: p.x + v.x * k, y: p.y + v.y * k, z: p.z + v.z * k });
const cross = (a, b) => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
const unit = (p) => { const n = Math.hypot(p.x, p.y, p.z); return n > 1e-9 ? { x: p.x / n, y: p.y / n, z: p.z / n } : null; };
const origin = (b, t) => ({
  x: (b.x0 + b.x1) / 2,
  y: (b.y0 + b.y1) / 2,
  // У ландшафта pivot находится на земле: гизмо не висит в кроне дерева.
  z: t?.type === 'landscape' ? b.z0 : (b.z0 + b.z1) / 2,
});
const top = Object.freeze({ kind: 'overlay', onTop: true, flat: true, twoSided: true, normal: { x: 0, y: 0, z: 1 } });
const AXIS_RGBA = { x: [0.9, 0.28, 0.3, 1], y: [0.18, 0.62, 0.36, 1], z: [0.25, 0.39, 0.87, 1] };

function axisLetter(axis, center, k, basis) {
  const p = (x, y) => add(add(center, basis.r, x * 7 * k), basis.u, y * 7 * k);
  const glyph = axis === 'x'
    ? [[p(-0.45, -0.55), p(0.45, 0.55)], [p(-0.45, 0.55), p(0.45, -0.55)]]
    : axis === 'y'
      ? [[p(-0.45, -0.55), p(0, 0)], [p(0.45, -0.55), p(0, 0)], [p(0, 0), p(0, 0.6)]]
      : [[p(-0.45, -0.55), p(0.45, -0.55)], [p(0.45, -0.55), p(-0.45, 0.55)], [p(-0.45, 0.55), p(0.45, 0.55)]];
  return { ...top, pts: [p(-0.05, 0), p(0.05, 0), p(0, 0.05)], color: '#ffffff', alpha: 0, edges: glyph, edgeRgba: AXIS_RGBA[axis] };
}

function screen(t, b) {
  const k = env.worldPerPx();
  const O = origin(b, t);
  const [s0, s1] = GIZMO_PLANE_PX.map((value) => value * k);
  const X = GIZMO_AXES.x; const Y = GIZMO_AXES.y;
  const L = GIZMO_PX * k;
  const tips = { x: env.project(add(O, X, L)), y: env.project(add(O, Y, L)) };
  if (t.canZ) tips.z = env.project(add(O, GIZMO_AXES.z, L));
  return {
    origin: env.project(O), tips,
    plane: [add(add(O, X, s0), Y, s0), add(add(O, X, s1), Y, s0), add(add(O, X, s1), Y, s1), add(add(O, X, s0), Y, s1)].map(env.project),
  };
}

export function objectGizmoOverlay() {
  const t = target(); const b = bounds(t);
  if (!t || !b) return [];
  const k = env.worldPerPx();
  const O = origin(b, t);
  const [s0, s1] = GIZMO_PLANE_PX.map((value) => value * k);
  const X = GIZMO_AXES.x; const Y = GIZMO_AXES.y;
  const Q = [add(add(O, X, s0), Y, s0), add(add(O, X, s1), Y, s0), add(add(O, X, s1), Y, s1), add(add(O, X, s0), Y, s1)];
  const out = [{
    ...top, pts: Q, color: hover === 'xy' ? GIZMO_COLORS.hot : GIZMO_COLORS.xy, alpha: hover === 'xy' ? 0.8 : 0.45,
    edges: Q.map((p, i) => [p, Q[(i + 1) % Q.length]]), edgeRgba: [0.75, 0.5, 0.05, 0.95],
  }];
  const B = env.basis();
  const axes = t.canZ ? ['x', 'y', 'z'] : ['x', 'y'];
  for (const axis of axes) {
    const a = GIZMO_AXES[axis];
    const side = unit(cross(a, B.f));
    if (!side) continue;
    const hot = hover === axis;
    const L = GIZMO_PX * k; const head = 14 * k; const w = (hot ? 2.4 : 1.6) * k;
    const p0 = add(O, a, 6 * k); const p1 = add(O, a, L - head);
    const color = hot ? GIZMO_COLORS.hot : GIZMO_COLORS[axis];
    out.push({ ...top, pts: [add(p0, side, -w), add(p1, side, -w), add(p1, side, w), add(p0, side, w)], color, alpha: 1 });
    const hw = (hot ? 7.5 : 5.5) * k;
    out.push({ ...top, pts: [add(p1, side, -hw), add(O, a, L), add(p1, side, hw)], color, alpha: 1 });
    out.push(axisLetter(axis, add(O, a, L + 12 * k), k, B));
  }
  return out;
}

export function objectGizmoPartAt(event) {
  const t = target(); const b = bounds(t);
  if (!t || !b || drag) return null;
  const part = gizmoPick(screen(t, b), { x: event.clientX, y: event.clientY }, event.pointerType === 'mouse' ? 9 : 18);
  if (!part || (part === 'z' && !t.canZ)) return null;
  return { part, target: t, bounds: b };
}

export function objectGizmoHover(event) {
  const hit = objectGizmoPartAt(event);
  const next = hit?.part || null;
  const changed = next !== hover;
  hover = next;
  return { changed, cursor: next ? 'move' : null };
}

export function clearObjectGizmoHover() { const changed = hover !== null; hover = null; return changed; }

export function startObjectGizmoDrag(event, hit = objectGizmoPartAt(event)) {
  if (!hit) return false;
  const O = origin(hit.bounds, hit.target);
  const object = hit.target.object;
  let startElev = Number(object.elev) || 0;
  let platformEdit = null;
  if (hit.part === 'z' && hit.target.type === 'landscape' && (PLATFORM_KINDS.has(object.kind) || object.kind === 'stairs-out')) {
    // The cut view and the 3D Z arrow use the same site-datum height.
    const ground = Number.isFinite(object.elev) ? null : groundFn(state.project);
    const base = ground ? ground(object.x, object.y) - ground.siteDatum : 0;
    startElev = platformTop(object, base);
    platformEdit = platformLevelEdit(state.project.site.landscape.objects, object, base);
  }
  drag = {
    startElev, platformEdit, stairStarts: platformEdit?.stairs.map((stair) => ({ ...stair })),
    ...hit, before: snapshot(), start: structuredClone(hit.target.object), x0: event.clientX, y0: event.clientY,
    planeZ: O.z, p0: hit.part === 'xy' ? env.rayPlaneZ(env.ray(event), O.z) : null, changed: false,
  };
  hover = hit.part;
  return true;
}

function replaceObject(next) {
  if (drag.target.type === 'item') {
    const at = state.project.items.findIndex((entry) => entry.id === drag.target.id);
    if (at >= 0) state.project.items[at] = next;
  } else {
    const list = state.project.site?.landscape?.objects || [];
    const at = list.findIndex((entry) => entry.id === drag.target.id);
    if (at >= 0) list[at] = next;
  }
  drag.target.object = next;
}

function movedLandscape(start, dx, dy, dz) {
  const local = toLocal(state.project.building, start);
  const world = toWorld(state.project.building, { x: local.x + dx, y: local.y + dy });
  const sx = world.x - start.x; const sy = world.y - start.y;
  const next = { ...start, x: Math.round(start.x + sx), y: Math.round(start.y + sy) };
  if (start.points) next.points = start.points.map((p) => ({ x: Math.round(p.x + sx), y: Math.round(p.y + sy) }));
  if (drag.target.canZ && dz) {
    const top = Number.isFinite(start.elevTo) ? start.elevTo : drag.startElev;
    const delta = Math.max(-ELEV_LIMIT - drag.startElev, Math.min(ELEV_LIMIT - top, dz));
    next.elev = Math.round(drag.startElev + delta);
    if (Number.isFinite(start.elevTo)) next.elevTo = Math.round(start.elevTo + delta);
  }
  return next;
}

export function moveObjectGizmoDrag(event) {
  if (!drag) return;
  let delta;
  if (drag.part === 'xy') {
    const p = env.rayPlaneZ(env.ray(event), drag.planeZ);
    if (!p || !drag.p0) return;
    delta = { dx: p.x - drag.p0.x, dy: p.y - drag.p0.y, dz: 0 };
  } else {
    const axis = GIZMO_AXES[drag.part];
    const amount = env.axisDelta(axis, event.clientX - drag.x0, event.clientY - drag.y0);
    delta = { dx: axis.x * amount, dy: axis.y * amount, dz: axis.z * amount };
  }
  const step = event.shiftKey ? 1 : 50;
  const dx = Math.round(delta.dx / step) * step;
  const dy = Math.round(delta.dy / step) * step;
  const dz = Math.round(delta.dz / step) * step;
  const start = drag.start;
  const next = drag.target.type === 'item'
    ? {
      ...start,
      x: Math.round(start.x + dx),
      y: Math.round(start.y + dy),
      elev3d: Math.max(0, Math.round((Number(start.elev3d) || 0) + dz)),
    }
    : movedLandscape(start, dx, dy, dz);
  let changed = dx !== 0 || dy !== 0 || dz !== 0;
  if (drag.platformEdit) {
    const edit = drag.platformEdit;
    edit.stairs.forEach((stair, index) => Object.assign(stair, drag.stairStarts[index]));
    const level = Math.round(Math.max(edit.min, Math.min(edit.max, drag.startElev + dz)));
    changed = level !== edit.level;
    if (changed) setPlatformLevel({ ...edit, platform: next }, level);
    else if (Number.isFinite(start.elev)) next.elev = start.elev;
    else delete next.elev;
  }
  replaceObject(next);
  drag.changed = changed;
  const signed = (v) => `${v > 0 ? '+' : ''}${Math.round(v)}`;
  env.hint(`${drag.part.toUpperCase()}: ${signed(dx)}, ${signed(dy)}${drag.target.canZ ? `, ${signed(dz)}` : ''} мм · Shift — без шага`);
  env.rebuild();
}

export function finishObjectGizmoDrag() {
  const current = drag;
  drag = null; hover = null;
  if (!current?.changed) { env.redraw(); return; }
  pushHistory(current.before);
  afterChange();
  env.rebuild();
}

export function cancelObjectGizmoDrag() {
  const current = drag;
  if (!current) return;
  current.platformEdit?.stairs.forEach((stair, index) => Object.assign(stair, current.stairStarts[index]));
  replaceObject(current.start);
  drag = null; hover = null;
  env.rebuild();
}

// Для e2e: реальные экранные точки и допустимые оси выбранного объекта.
export function debugObjectGizmo3d() {
  if (!env) return null;
  const t = target(); const b = bounds(t);
  if (!t || !b) return null;
  const scr = screen(t, b);
  return {
    target: { type: t.type, id: t.id },
    axes: t.canZ ? ['x', 'y', 'z'] : ['x', 'y'],
    origin: scr.origin,
    tips: scr.tips,
    plane: scr.plane,
    dragging: Boolean(drag),
  };
}

