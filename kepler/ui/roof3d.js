// Крыши-плиты в 3D (core/roofs.js): инструмент «Крыша» (клик по помещению —
// крыша по его форме, дальше без связи; Shift — добавить форму к выбранной,
// по накрытому — выбрать; наведение —
// подсветка и призрак плиты) и ручки выбранной крыши поверх сцены — белые
// точки выноса у верха плиты (середины сторон и углы; тянуть по плоскости
// плиты, rayPlaneZ) и синяя стрелка Z — высота (dz, шаг 50 мм, привязка к
// отметкам этажей). Двойной клик по точке — число. Shift — без привязки,
// Esc — отмена жеста, жест — одна запись истории. Как точки масс
// (ui/mass3d.js): постоянный экранный размер, попадание 10 px (палец — 20).

import { GIZMO_COLORS, GIZMO_PX, segDist } from '../core/mass-gizmo.js';
import { massStep } from '../core/masses.js';
import { rayPlaneZ } from '../core/pick3d.js';
import { roofFaces } from '../core/mesh3d.js';
import {
  ROOF_SIDES, dragOverhang, patchRoof, rectsBox, roofHandles, roofRects, roofZ, snapRoofDz,
} from '../core/roofs.js';
import { state } from './state.js';
import { afterChange, pushHistory, refreshDerived, snapshot } from './store.js';
import { selectObject } from './tools.js';
import { roofClickRoom, roofSnapper, updateRoof } from './roofs.js';
import { ghostRoofFor, roofById, roofs, selectedRoof } from './plan-roofs.js';

const GHOST = '#3d7fe0';
const HANDLE_PX = 5;
const HIT = { mouse: { axis: 8, handle: 10 }, touch: { axis: 22, handle: 20 } };
const ACCENT_EDGE = [0.24, 0.5, 0.88, 1];
const Z_AXIS = { x: 0, y: 0, z: 1 };

let env = null;
let drag = null; // { id, part, start, before, x0, y0, planeZ, p0, changed }
let hover = null; // часть ручек под мышью: id точки ('n'… 'nw'…) или 'gz'
let toolHover = null; // { levelId, roomId } — помещение под инструментом
let num = null; // { id, part }

export function initRoof3d(e) { env = e; }

export const roofToolOn = () => state.tool?.kind === 'roof';
export const roofDragging = () => Boolean(drag);
export const roofNumOpen = () => Boolean(num);
export const roofHover = () => hover;

const add = (p, a, s) => ({ x: p.x + a.x * s, y: p.y + a.y * s, z: p.z + a.z * s });

function disc(p, rad, B, n = 12) {
  const P = [];
  for (let i = 0; i < n; i += 1) {
    const a = (i / n) * Math.PI * 2;
    P.push(add(add(p, B.r, Math.cos(a) * rad), B.u, Math.sin(a) * rad));
  }
  return P;
}

// Точки и начало стрелки Z выбранной крыши (оси дома).
function grips(roof) {
  const z = roofZ(state.project, roof);
  if (!z) return null;
  const b = rectsBox(roofRects(state.project, roof));
  if (!b) return null;
  const top = z.z1 + 2;
  return {
    handles: roofHandles(state.project, roof).map((h) => ({ id: h.id, sides: h.sides, p: { x: h.x, y: h.y, z: top } })),
    origin: { x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2, z: top },
  };
}

const isHot = (part) => (drag ? drag.part === part : hover === part);

// Наложения: призрак инструмента и ручки выбранной крыши.
export function roofOverlay() {
  if (!env || !state.project) return [];
  const out = [];
  if (roofToolOn() && toolHover) {
    const ghost = ghostRoofFor(toolHover.levelId, toolHover.roomId);
    if (ghost) {
      for (const f of roofFaces(state.project, [ghost], { color: GHOST, alpha: 0.32 })) {
        out.push({ ...f, kind: 'overlay', roofId: undefined, edgeRgba: [0.15, 0.4, 0.85, 0.9] });
      }
    }
  }
  const roof = !roofToolOn() ? selectedRoof() : null;
  const g = roof ? grips(roof) : null;
  if (!g) return out;
  const k = env.worldPerPx();
  const B = env.basis();
  const top = { kind: 'overlay', onTop: true, flat: true, twoSided: true, normal: { x: 0, y: 0, z: 1 } };
  for (const h of g.handles) {
    const hot = isHot(h.id);
    const P = disc(h.p, (hot ? HANDLE_PX + 1.5 : HANDLE_PX) * k, B);
    out.push({ ...top, pts: P, color: hot ? GIZMO_COLORS.hot : '#ffffff', alpha: 1, edges: P.map((q, i) => [q, P[(i + 1) % P.length]]), edgeRgba: ACCENT_EDGE });
  }
  // Стрелка Z (высота плиты).
  const side = norm3({ x: B.r.x, y: B.r.y, z: 0 }) || { x: 1, y: 0, z: 0 };
  const hot = isHot('gz');
  const color = hot ? GIZMO_COLORS.hot : GIZMO_COLORS.z;
  const L = GIZMO_PX * k; const w = (hot ? 2.2 : 1.5) * k; const head = 14 * k;
  const p0 = add(g.origin, Z_AXIS, 6 * k); const p1 = add(g.origin, Z_AXIS, L - head);
  out.push({ ...top, pts: [add(p0, side, -w), add(p1, side, -w), add(p1, side, w), add(p0, side, w)], color, alpha: 1 });
  const hw = (hot ? 7 : 5.5) * k;
  out.push({ ...top, pts: [add(p1, side, -hw), add(g.origin, Z_AXIS, L), add(p1, side, hw)], color, alpha: 1 });
  return out;
}

function norm3(a) {
  const l = Math.hypot(a.x, a.y, a.z);
  return l > 1e-9 ? { x: a.x / l, y: a.y / l, z: a.z / l } : null;
}

// Ручки на экране (клиентские координаты).
function gripScreen(roof) {
  const g = grips(roof);
  if (!g) return null;
  const k = env.worldPerPx();
  return {
    handles: g.handles.map((h) => ({ id: h.id, sides: h.sides, s: env.project(h.p) })),
    origin: env.project(g.origin),
    tip: env.project(add(g.origin, Z_AXIS, GIZMO_PX * k)),
  };
}

// Часть ручек выбранной крыши под указателем: { id, part } или null.
export function roofPartAt(e) {
  if (!env || roofToolOn()) return null;
  const roof = selectedRoof();
  if (!roof) return null;
  const scr = gripScreen(roof);
  if (!scr) return null;
  const hit = e?.pointerType === 'touch' || e?.pointerType === 'pen' ? HIT.touch : HIT.mouse;
  const p = { x: e.clientX, y: e.clientY };
  let best = null; let bd = hit.handle;
  for (const h of scr.handles) {
    const d = Math.hypot(h.s.x - p.x, h.s.y - p.y);
    if (d <= bd) { bd = d; best = h.id; }
  }
  if (best) return { id: roof.id, part: best };
  if (segDist(p, scr.origin, scr.tip) <= hit.axis) return { id: roof.id, part: 'gz' };
  return null;
}

export function roofHoverAt(e) {
  const at = roofPartAt(e);
  const next = at ? at.part : null;
  const changed = next !== hover;
  hover = next;
  return { changed, cursor: next ? (next === 'gz' ? 'ns-resize' : 'move') : null };
}

export function clearRoofHover() {
  const had = Boolean(hover);
  hover = null;
  return had;
}

// ---------------------------------------------------------------- жест

export function startRoofDrag(e, at = roofPartAt(e)) {
  if (!at) return false;
  const roof = roofById(at.id);
  if (!roof) return false;
  const z = roofZ(state.project, roof);
  drag = { id: roof.id, part: at.part, start: structuredClone(roof), before: snapshot(), x0: e.clientX, y0: e.clientY, changed: false };
  if (at.part !== 'gz') {
    drag.sides = roofHandles(state.project, roof).find((h) => h.id === at.part)?.sides || [];
    drag.planeZ = z.z1;
    drag.p0 = rayPlaneZ(env.ray(e), z.z1);
  }
  hover = at.part;
  env.redraw();
  return true;
}

const setRoof = (next) => {
  state.project.roofs = roofs().map((r) => (r.id === next.id ? next : r));
};

export function moveRoofDrag(e) {
  if (!drag) return;
  const d = drag;
  const k = env.worldPerPx();
  let next; let text;
  if (d.part === 'gz') {
    const dx = e.clientX - d.x0; const dy = e.clientY - d.y0;
    let v = env.axisDelta(Z_AXIS, dx, dy);
    if (!v) v = -dy * k;
    const s = snapRoofDz(state.project, d.start, d.start.dz + v, e.shiftKey ? { tol: 0, step: 1 } : { tol: 10 * k, step: 50 });
    next = patchRoof(d.start, { dz: s.value });
    text = `Высота ${next.dz > 0 ? '+' : next.dz < 0 ? '−' : ''}${Math.abs(next.dz)} мм${s.label ? ` · ${s.label}` : ''}`;
  } else {
    const p = d.p0 ? rayPlaneZ(env.ray(e), d.planeZ) : null;
    if (!p) return;
    const base = roofSnapper(d.start, e, 1 / k);
    const snap = base ? (side, raw) => {
      const r = base(side, raw);
      return r.label ? r : { value: Math.round(raw / massStep(1 / k)) * massStep(1 / k), label: null };
    } : (side, raw) => ({ value: Math.round(raw), label: null });
    const res = dragOverhang(d.start, d.sides, p.x - d.p0.x, p.y - d.p0.y, snap);
    next = res.roof;
    text = `вынос ${d.sides.map((s) => next.overhang[s]).join(' / ')} мм${res.labels.length ? ` · ${res.labels[0]}` : ''}`;
  }
  setRoof(next);
  d.changed = JSON.stringify(next) !== JSON.stringify(d.start);
  env.label(text, e.clientX, e.clientY);
  env.redraw(true);
}

export function finishRoofDrag() {
  const d = drag;
  drag = null;
  env.label(null);
  if (!d) return;
  if (!d.changed) { env.redraw(true); return; }
  refreshDerived();
  pushHistory(d.before);
  afterChange();
  selectObject({ type: 'roof', id: d.id });
}

export function cancelRoofDrag() {
  const d = drag;
  drag = null;
  env?.label(null);
  if (!d) return;
  setRoof(d.start);
  env.redraw(true);
}

// ---------------------------------------------------------------- инструмент

export function resetRoofTool() { toolHover = null; }

// Помещение под лучом инструмента: пол помещения или его стена (ключ стены
// 'e|комната|сторона' / 's|a|b' — первая комната).
function roomOfHit(hit) {
  if (hit?.type === 'room') return { levelId: hit.levelId, roomId: hit.id };
  if (hit?.type === 'wall' && typeof hit.key === 'string') {
    const parts = hit.key.split('|');
    const lv = (state.project.levels || []).find((l) => l.id === hit.levelId);
    const id = parts.slice(1).find((p) => lv?.rooms?.some((r) => r.id === p));
    if (id) return { levelId: hit.levelId, roomId: id };
  }
  return null;
}

export function roofToolMove(e) {
  const hit = env.pick(e);
  const next = roomOfHit(hit);
  const same = (next?.roomId || null) === (toolHover?.roomId || null) && (next?.levelId || null) === (toolHover?.levelId || null);
  toolHover = next;
  if (hit?.type === 'roof') env.label(`Выбрать «${roofById(hit.id)?.name || 'крышу'}»`, e.clientX, e.clientY);
  else if (next) {
    const lv = (state.project.levels || []).find((l) => l.id === next.levelId);
    const room = lv?.rooms?.find((r) => r.id === next.roomId);
    env.label(`Крыша по форме «${room?.name || 'помещение'}»${e.shiftKey ? ' · добавить к выбранной' : ''}`, e.clientX, e.clientY);
  } else env.label(null);
  el3d().style.cursor = next || hit?.type === 'roof' ? 'pointer' : '';
  if (!same) env.redraw();
}

const el3d = () => document.getElementById('canvas3d');

export function roofToolClick(e) {
  const hit = env.pick(e);
  if (hit?.type === 'roof') {
    env.switchLevel(hit.levelId);
    selectObject({ type: 'roof', id: hit.id });
  } else if (roomOfHit(hit)) {
    const at = roomOfHit(hit);
    // Сначала этаж (смена этажа снимает выбор), потом крыша — она выбирается.
    const keep = state.selection;
    const tool = state.tool;
    env.switchLevel(at.levelId);
    if (keep?.type === 'roof' && !state.selection) state.selection = keep;
    if (tool && !state.tool) state.tool = { ...tool, hover: null }; // смена этажа сняла инструмент — серия продолжается
    roofClickRoom(at.levelId, at.roomId, { add: e.shiftKey });
  }
  env.label(null);
  env.redraw(true);
}

// ---------------------------------------------------------------- число

const numInput = () => document.getElementById('v3RoofNum');

function hideNum() {
  num = null;
  const inp = numInput();
  if (inp) inp.hidden = true;
}

export function closeRoofNum() { hideNum(); }

export function roofDblClick(e) {
  const at = roofPartAt(e);
  if (!at) return false;
  const roof = roofById(at.id);
  const inp = numInput();
  if (!roof || !inp) return false;
  num = { id: roof.id, part: at.part };
  const side = at.part === 'gz' ? null : at.part[0];
  inp.value = String(at.part === 'gz' ? roof.dz : roof.overhang[side]);
  inp.title = at.part === 'gz' ? 'Поднять плиту, мм' : `Вынос (${at.part}), мм`;
  const box = document.getElementById('view3d').getBoundingClientRect();
  inp.style.left = `${Math.round(e.clientX - box.left + 12)}px`;
  inp.style.top = `${Math.round(e.clientY - box.top + 12)}px`;
  inp.hidden = false;
  inp.focus();
  inp.select();
  return true;
}

function applyNum() {
  const n = num;
  const v = Number(String(numInput()?.value || '').replace(',', '.'));
  hideNum();
  if (!n || !Number.isFinite(v)) return;
  const roof = roofById(n.id);
  if (!roof) return;
  if (n.part === 'gz') updateRoof(n.id, (r) => patchRoof(r, { dz: v }));
  else {
    const sides = roofHandles(state.project, roof).find((h) => h.id === n.part)?.sides || [n.part[0]];
    updateRoof(n.id, (r) => patchRoof(r, { overhang: Object.fromEntries(sides.map((s) => [s, v])) }));
  }
  selectObject({ type: 'roof', id: n.id });
}

export function bindRoofNum() {
  const inp = numInput();
  if (!inp) return;
  inp.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); applyNum(); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); hideNum(); }
  });
  inp.addEventListener('blur', () => { if (num) hideNum(); });
}

// Для автотестов: инструмент, жест, наведение, точки выбранной крыши (экран).
export function debugRoof3d() {
  const roof = env && !roofToolOn() ? selectedRoof() : null;
  const scr = roof ? gripScreen(roof) : null;
  return {
    tool: roofToolOn(), toolHover, dragging: Boolean(drag), part: drag?.part || null, hover, num: Boolean(num),
    handles: scr ? Object.fromEntries(scr.handles.map((h) => [h.id, h.s])) : null,
    zAxis: scr ? { origin: scr.origin, tip: scr.tip } : null,
    sides: ROOF_SIDES,
  };
}
