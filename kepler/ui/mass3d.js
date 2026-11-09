// Массы в 3D (core/masses.js): создание и правка боксов прямо в окне 3D —
// главный сценарий «концептуальной формы» (как «Масса» в Revit, «Тяни-
// толкай» в SketchUp). Окно 3D (ui/view3d.js) отдаёт сюда события и
// окружение env (луч, проекция осей, масштаб, перерисовка, подпись у курсора).
//
// Инструмент «Масса» (state.tool.kind === 'mass'), стадии:
//   'corner' — курсор скользит по плоскости основания: верх массы под
//              курсором («поставить на грань»), пол этажа или земля z = 0;
//              клик — первый угол;
//   'base'   — рамка-призрак основания на той же плоскости с живыми
//              размерами; привязка: шаг по масштабу, грани других масс,
//              комнат и стен; Shift — без привязки, Ctrl — квадрат; клик —
//              основание зафиксировано;
//   'height' — движение мыши вверх/вниз тянет высоту (проекция вертикали
//              на экран), шаг 100 мм (Shift — 10), привязка к отметкам
//              этажей и верху/низу других масс; клик — масса готова и
//              выбрана, инструмент остаётся (серия; Esc — выйти).
// Числа: во время 'base'/'height' цифры открывают поле у курсора: ширина →
// Tab → глубина → Enter → высота → Enter. Esc — стадия назад.
// Касание: тапы по шагам (третий тап — высота по положению пальца).
//
// Правка выбранной массы (core/mass-gizmo.js) — поверх сцены рисуются:
//   гизмо перемещения — стрелки X/Y/Z из центра (тянуть — перенос только
//   вдоль оси) и квадрат XY (перенос по плоскости основания); привязка —
//   грани других масс, отметки этажей, верх масс и земля (рельеф);
//   точки размера — центры 6 граней (грань по нормали) и 8 углов (ширина и
//   глубина сразу); противоположные грани стоят, не меньше 300 мм; двойной
//   клик по точке — число.
// Грань массы ничего не тянет: клик по телу — только выбор. Shift — без
// шага, Esc — отмена жеста, каждый жест — одна запись истории. Касание —
// те же ручки с увеличенной зоной попадания.

import {
  FACE_NORMAL, MASS_H_DEFAULT, MASS_MIN, createMass, faceSize, floorsLabel, massBox,
  massStep, setFaceSize, snapValue,
} from '../core/masses.js';
import {
  GIZMO_AXES, GIZMO_COLORS, GIZMO_PLANE_PX, GIZMO_PX, MASS_HANDLES, gizmoOrigin, gizmoPick,
  handleFacing, handlePick, handlePoint, massHandle, resizeByHandle, snapShift,
} from '../core/mass-gizmo.js';
import { basePlane, pickMass, rayPlaneZ } from '../core/pick3d.js';
import { massFaces } from '../core/mesh3d.js';
import { toast } from './dom.js';
import { MASS_HINT, addMass, massBaseSnap, massById, massLevelHeight, masses, updateMass } from './masses.js';
import { state } from './state.js';
import { afterChange, pushHistory, refreshDerived, snapshot } from './store.js';
import { selectObject } from './tools.js';

const GHOST = '#3d7fe0';
const SNAP_PX = 10; // px — радиус привязки к граням и отметкам

let env = null;
let drag = null; // жест правки массы
let hover = null; // { id, face } — грань выбранной массы под мышью
let lastCursor = null; // { x, y } клиентские координаты последнего движения
let numField = null; // { kind: 'w'|'d'|'h'|'face', face?, id? }

export function initMass3d(e) { env = e; }

const tool = () => (state.tool?.kind === 'mass' ? state.tool : null);
export const massToolOn = () => Boolean(tool());
export const massDragging = () => Boolean(drag);
export const massHover = () => hover;

export function massBoxes() {
  return masses().map((m) => ({ id: m.id, ...massBox(m) }));
}

// Отметки привязки высоты: этажи (низ и верх) и другие массы.
function zLines(skip = null) {
  const zs = [];
  for (const l of state.project?.levels || []) {
    const e = Number(l.elevation) || 0;
    zs.push(e, e + (Number(l.height) || 0));
  }
  for (const m of masses()) {
    if (m.id === skip) continue;
    const b = massBox(m);
    zs.push(b.z0, b.z1);
  }
  return zs;
}

function snapXY(p, e, skip = null) {
  if (e?.shiftKey) return { x: Math.round(p.x), y: Math.round(p.y) };
  const k = env.worldPerPx();
  const step = massStep(1 / k);
  const lines = massBaseSnap(skip);
  return { x: snapValue(p.x, lines.xs, SNAP_PX * k, step).value, y: snapValue(p.y, lines.ys, SNAP_PX * k, step).value };
}

function setStage(t, stage) {
  t.stage = stage;
  env.hint(stageHint(t));
}

function stageHint(t) {
  if (t.stage === 'base') return 'Масса: клик — противоположный угол · Shift — без привязки, Ctrl — квадрат · цифры — ширина, Tab — глубина · Esc — назад';
  if (t.stage === 'height' && t.touch) return 'Масса: тап выше основания — высота по пальцу, масса готова · Esc — назад';
  if (t.stage === 'height') return 'Масса: тяните вверх — высота, клик — готово · Shift — шаг 10 мм · цифры + Enter — высота · Esc — назад';
  return MASS_HINT;
}

export function massToolHint() {
  const t = tool();
  return t ? stageHint(t) : null;
}

// Сброс стадий (вход в 3D, выход из него).
export function resetMassTool() {
  const t = tool();
  if (t) Object.assign(t, { stage: 'corner', a: null, b: null, h: null, z: 0, cursor: null, screen2: null });
  hideNum();
  env?.label(null);
}

// ---------------------------------------------------------------- создание

function heightFrom(t, e) {
  let d = env.axisDelta({ x: 0, y: 0, z: 1 }, e.clientX - t.screen2.x, e.clientY - t.screen2.y);
  if (!d) d = -(e.clientY - t.screen2.y) * env.worldPerPx();
  let h = Math.max(MASS_MIN, d);
  if (e.shiftKey) return Math.max(MASS_MIN, Math.round(h / 10) * 10);
  const tol = SNAP_PX * env.worldPerPx();
  const top = snapValue(t.z + h, zLines(), tol, 0);
  if (top.line != null && top.line - t.z >= MASS_MIN) return top.line - t.z;
  h = Math.round(h / 100) * 100;
  return Math.max(MASS_MIN, h);
}

function squareB(a, b) {
  const s = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y));
  return { x: a.x + Math.sign(b.x - a.x || 1) * s, y: a.y + Math.sign(b.y - a.y || 1) * s };
}

// Движение мыши при включённом инструменте.
export function massToolMove(e) {
  const t = tool();
  if (!t || !env) return;
  lastCursor = { x: e.clientX, y: e.clientY };
  if (numField) return; // идёт ввод числа — призрак стоит
  const ray = env.ray(e);
  if (t.stage === 'corner' || !t.stage) {
    const plane = basePlane(massBoxes(), ray, { floor: env.floorHit(e) });
    if (!plane) { t.cursor = null; env.label(null); env.redraw(); return; }
    const p = snapXY(plane.point, e);
    t.cursor = { x: p.x, y: p.y, z: plane.z };
    const on = plane.massId ? massById(plane.massId) : null;
    env.label(on ? `на «${on.name}» · отм. ${Math.round(plane.z)}` : plane.z ? `отм. ${Math.round(plane.z)}` : null, e.clientX, e.clientY);
  } else if (t.stage === 'base') {
    const p = rayPlaneZ(ray, t.z);
    if (!p) return;
    let b = snapXY(p, e);
    if (e.ctrlKey || e.metaKey) b = squareB(t.a, b);
    t.b = b;
    env.label(`${Math.round(Math.abs(b.x - t.a.x))} × ${Math.round(Math.abs(b.y - t.a.y))} мм`, e.clientX, e.clientY);
  } else if (t.stage === 'height') {
    t.h = heightFrom(t, e);
    env.label(`${Math.round(t.h)} мм · ${floorsLabel(t.h, massLevelHeight())}`, e.clientX, e.clientY);
  }
  env.redraw();
}

function commitTool(t) {
  const w = Math.abs(t.b.x - t.a.x);
  const d = Math.abs(t.b.y - t.a.y);
  const m = createMass({
    x: (t.a.x + t.b.x) / 2, y: (t.a.y + t.b.y) / 2, w, d, z0: t.z, h: t.h || MASS_H_DEFAULT,
  }, masses());
  Object.assign(t, { stage: 'corner', a: null, b: null, h: null, screen2: null });
  hideNum();
  env.label(null);
  addMass(m);
  env.hint(stageHint(t));
  return m;
}

// Клик (или тап) инструментом.
export function massToolClick(e) {
  const t = tool();
  if (!t || !env) return;
  t.touch = e.pointerType === 'touch';
  massToolMove(e);
  if (t.stage === 'corner' || !t.stage) {
    if (!t.cursor) return;
    t.a = { x: t.cursor.x, y: t.cursor.y };
    t.z = t.cursor.z || 0;
    t.b = { ...t.a };
    setStage(t, 'base');
  } else if (t.stage === 'base') {
    if (!t.b || Math.abs(t.b.x - t.a.x) < MASS_MIN || Math.abs(t.b.y - t.a.y) < MASS_MIN) {
      toast(`Основание массы — не меньше ${MASS_MIN} мм`, true);
      return;
    }
    t.screen2 = { x: e.clientX, y: e.clientY };
    t.h = MASS_MIN;
    setStage(t, 'height');
    // Касание: высота — следующим тапом; мышь — сразу тянется.
  } else if (t.stage === 'height') {
    commitTool(t);
  }
  env.redraw();
}

// Esc: стадия назад (true — съедено); на первой стадии — false (выйти).
export function massToolBack() {
  const t = tool();
  if (!t) return false;
  if (numField) { hideNum(); return true; }
  if (t.stage === 'height') { t.h = null; setStage(t, 'base'); env.redraw(); return true; }
  if (t.stage === 'base') { t.a = null; t.b = null; setStage(t, 'corner'); env.label(null); env.redraw(); return true; }
  return false;
}

// Призрак и ручки — грани-наложения для окна 3D (kind 'overlay').
export function massOverlay() {
  if (!env) return [];
  const out = [];
  const t = tool();
  const k = env.worldPerPx();
  if (t?.a && t.b && (t.stage === 'base' || t.stage === 'height')) {
    const x0 = Math.min(t.a.x, t.b.x); const x1 = Math.max(t.a.x, t.b.x);
    const y0 = Math.min(t.a.y, t.b.y); const y1 = Math.max(t.a.y, t.b.y);
    if (t.stage === 'height' && t.h > 0) {
      const ghost = massFaces([{ id: 'ghost', x: (x0 + x1) / 2, y: (y0 + y1) / 2, w: x1 - x0, d: y1 - y0, z0: t.z, h: t.h, rotation: 0, color: GHOST }], { alpha: 0.3 });
      for (const f of ghost) out.push({ ...f, kind: 'overlay', twoSided: true, edgeRgba: [0.15, 0.4, 0.85, 0.9] });
    } else if (x1 - x0 > 0.5 || y1 - y0 > 0.5) {
      const z = t.z + 2;
      const P = [{ x: x0, y: y0, z }, { x: x1, y: y0, z }, { x: x1, y: y1, z }, { x: x0, y: y1, z }];
      out.push({
        pts: P, normal: { x: 0, y: 0, z: 1 }, color: GHOST, alpha: 0.3, kind: 'overlay', twoSided: true,
        edges: P.map((p, i) => [p, P[(i + 1) % 4]]), edgeRgba: [0.15, 0.4, 0.85, 0.95],
      });
    }
  }
  // Сетка земли (шаг 1 м, 40 × 40 м) — ориентир, пока включён инструмент.
  if (t) {
    const c = t.a || t.cursor || { x: 0, y: 0 };
    const cx = Math.round(c.x / 5000) * 5000; const cy = Math.round(c.y / 5000) * 5000;
    const z = (t.a ? t.z : t.cursor?.z || 0) + 1;
    const R = 20000; const edges = [];
    for (let k = -R; k <= R; k += 1000) {
      edges.push([{ x: cx + k, y: cy - R, z }, { x: cx + k, y: cy + R, z }], [{ x: cx - R, y: cy + k, z }, { x: cx + R, y: cy + k, z }]);
    }
    out.push({ pts: [], normal: { x: 0, y: 0, z: 1 }, color: GHOST, alpha: 0, kind: 'overlay', edges, edgeRgba: [0.2, 0.32, 0.5, 0.16] });
  }
  if (t?.cursor && (t.stage === 'corner' || !t.stage)) {
    const s = 5 * k;
    const c = t.cursor;
    const z = (c.z || 0) + 2;
    const P = [{ x: c.x - s, y: c.y - s, z }, { x: c.x + s, y: c.y - s, z }, { x: c.x + s, y: c.y + s, z }, { x: c.x - s, y: c.y + s, z }];
    out.push({ pts: P, normal: { x: 0, y: 0, z: 1 }, color: GHOST, alpha: 0.85, kind: 'overlay', twoSided: true });
  }
  // Выбранная масса: точки размера и гизмо перемещения — поверх сцены.
  const sel = !t ? selectedMass() : null;
  if (sel) out.push(...gripOverlay(sel, k));
  return out;
}

// ---------------------------------------------------------------- гизмо и точки

const HANDLE_PX = 5; // радиус точки на экране, px (≈ 10 px в поперечнике)
const HIT = { mouse: { axis: 8, handle: 10 }, touch: { axis: 22, handle: 20 } };
const ACCENT_EDGE = [0.24, 0.5, 0.88, 1];

function selectedMass() {
  return state.selection?.type === 'mass' ? massById(state.selection.id) : null;
}

const add = (p, a, s) => ({ x: p.x + a.x * s, y: p.y + a.y * s, z: p.z + a.z * s });
const vcross = (a, b) => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
const vnorm = (a) => { const l = Math.hypot(a.x, a.y, a.z); return l > 1e-9 ? { x: a.x / l, y: a.y / l, z: a.z / l } : null; };

const isHot = (id, part) => (drag?.id === id && drag.part === part) || (!drag && hover?.id === id && hover.part === part);

// Круг-точка, развёрнутый к камере (r, u — оси экрана в осях дома).
function disc(p, rad, B, n = 12) {
  const P = [];
  for (let i = 0; i < n; i += 1) {
    const a = (i / n) * Math.PI * 2;
    P.push(add(add(p, B.r, Math.cos(a) * rad), B.u, Math.sin(a) * rad));
  }
  return P;
}

function gripOverlay(m, k) {
  const out = [];
  const B = env.basis();
  const box = massBox(m);
  const top = { kind: 'overlay', onTop: true, flat: true, twoSided: true, normal: { x: 0, y: 0, z: 1 } };
  // Точки размера (сначала невидимые стороны — ниже в стопке).
  const list = MASS_HANDLES.map((h) => ({ h, p: handlePoint(box, h.s), front: handleFacing(h.s, B.f) }))
    .sort((a, b) => Number(a.front) - Number(b.front));
  for (const { h, p, front } of list) {
    const hot = isHot(m.id, h.id);
    const P = disc(p, (hot ? HANDLE_PX + 1.5 : HANDLE_PX) * k, B);
    out.push({
      ...top, pts: P, color: hot ? GIZMO_COLORS.hot : '#ffffff', alpha: front || hot ? 1 : 0.55,
      edges: P.map((q, i) => [q, P[(i + 1) % P.length]]), edgeRgba: front || hot ? ACCENT_EDGE : [0.24, 0.5, 0.88, 0.5],
    });
  }
  // Гизмо: квадрат XY, затем стрелки (горячая — последней, поверх).
  const O = gizmoOrigin(box);
  const [s0, s1] = GIZMO_PLANE_PX.map((v) => v * k);
  const X = GIZMO_AXES.x; const Y = GIZMO_AXES.y;
  const Q = [add(add(O, X, s0), Y, s0), add(add(O, X, s1), Y, s0), add(add(O, X, s1), Y, s1), add(add(O, X, s0), Y, s1)];
  const hotXY = isHot(m.id, 'gxy');
  out.push({
    ...top, pts: Q, color: hotXY ? GIZMO_COLORS.hot : GIZMO_COLORS.xy, alpha: hotXY ? 0.75 : 0.45,
    edges: Q.map((q, i) => [q, Q[(i + 1) % 4]]), edgeRgba: [0.75, 0.5, 0.05, 0.95],
  });
  const L = GIZMO_PX * k;
  const axes = ['x', 'y', 'z'].sort((a, b) => Number(isHot(m.id, `g${a}`)) - Number(isHot(m.id, `g${b}`)));
  for (const axis of axes) {
    const a = GIZMO_AXES[axis];
    const side = vnorm(vcross(a, B.f));
    if (!side) continue; // ось «в глаз»
    const hot = isHot(m.id, `g${axis}`);
    const color = hot ? GIZMO_COLORS.hot : GIZMO_COLORS[axis];
    const w = (hot ? 2.2 : 1.5) * k;
    const head = 14 * k;
    const p0 = add(O, a, 6 * k);
    const p1 = add(O, a, L - head);
    out.push({ ...top, pts: [add(p0, side, -w), add(p1, side, -w), add(p1, side, w), add(p0, side, w)], color, alpha: 1 });
    const hw = (hot ? 7 : 5.5) * k;
    out.push({ ...top, pts: [add(p1, side, -hw), add(O, a, L), add(p1, side, hw)], color, alpha: 1 });
  }
  return out;
}

// Гизмо и точки выбранной массы в пикселях клиента (для попадания).
function gripScreen(m) {
  const k = env.worldPerPx();
  const box = massBox(m);
  const B = env.basis();
  const O = gizmoOrigin(box);
  const [s0, s1] = GIZMO_PLANE_PX.map((v) => v * k);
  const X = GIZMO_AXES.x; const Y = GIZMO_AXES.y;
  const L = GIZMO_PX * k;
  return {
    gizmo: {
      origin: env.project(O),
      tips: { x: env.project(add(O, X, L)), y: env.project(add(O, Y, L)), z: env.project(add(O, GIZMO_AXES.z, L)) },
      plane: [add(add(O, X, s0), Y, s0), add(add(O, X, s1), Y, s0), add(add(O, X, s1), Y, s1), add(add(O, X, s0), Y, s1)].map(env.project),
    },
    handles: MASS_HANDLES.map((h) => ({ id: h.id, p: env.project(handlePoint(box, h.s)), back: !handleFacing(h.s, B.f) })),
  };
}

// Часть ручек выбранной массы под указателем: 'gx' | 'gy' | 'gz' | 'gxy' |
// id точки (грань 'top'… или угол 'cpnp'…) или null. Порядок: видимые
// точки, гизмо, точки на невидимой стороне.
export function massPartAt(e) {
  if (!env || tool()) return null;
  const m = selectedMass();
  if (!m) return null;
  const hit = e?.pointerType === 'touch' || e?.pointerType === 'pen' ? HIT.touch : HIT.mouse;
  const p = { x: e.clientX, y: e.clientY };
  const scr = gripScreen(m);
  const front = handlePick(scr.handles.filter((h) => !h.back), p, hit.handle);
  if (front) return { id: m.id, part: front };
  const g = gizmoPick(scr.gizmo, p, hit.axis);
  if (g) return { id: m.id, part: `g${g}` };
  const back = handlePick(scr.handles.filter((h) => h.back), p, hit.handle);
  return back ? { id: m.id, part: back } : null;
}

const HANDLE_CURSOR = { top: 'ns-resize', bottom: 'ns-resize', px: 'ew-resize', nx: 'ew-resize', py: 'ew-resize', ny: 'ew-resize' };
const partCursor = (part) => (part.startsWith('g') ? 'move' : HANDLE_CURSOR[part] || 'nwse-resize');

// Наведение: подсветка части гизмо/точки и курсор.
export function massHoverAt(e) {
  const at = massPartAt(e);
  const next = at ? { id: at.id, part: at.part, face: massHandle(at.part)?.face || null } : null;
  const changed = (next?.part || null) !== (hover?.part || null) || (next?.id || null) !== (hover?.id || null);
  hover = next;
  return { changed, cursor: next ? partCursor(next.part) : null };
}

export function clearMassHover() {
  const had = Boolean(hover);
  hover = null;
  return had;
}

// ---------------------------------------------------------------- правка

// Грань выбранной массы под лучом (только выбранной): { id, face, point, t } или null.
export function selectedMassHit(ray) {
  const sel = selectedMass();
  if (!sel) return null;
  return pickMass([{ id: sel.id, ...massBox(sel) }], ray);
}

// Начало жеста по гизмо или точке выбранной массы. true — жест начат.
export function startMassDrag(e, at = massPartAt(e)) {
  if (!at) return false;
  const m = massById(at.id);
  if (!m) return false;
  const box = massBox(m);
  const handle = massHandle(at.part);
  drag = {
    id: m.id, part: at.part, handle, start: { ...m }, x0: e.clientX, y0: e.clientY,
    before: snapshot(), changed: false,
  };
  // Перенос по плоскости и углы — по горизонтальной плоскости.
  if (at.part === 'gxy' || (handle && !handle.face)) {
    drag.planeZ = at.part === 'gxy' ? gizmoOrigin(box).z : handlePoint(box, handle.s).z;
    drag.p0 = rayPlaneZ(env.ray(e), drag.planeZ);
  }
  hover = { id: m.id, part: at.part, face: handle?.face || null };
  env.redraw();
  return true;
}

// Отметки земли под основанием (рельеф): центр и углы.
function groundZs(m) {
  const hz = env.ground?.();
  if (!hz) return [];
  const b = massBox(m);
  return [[b.x0, b.y0], [b.x1, b.y0], [b.x1, b.y1], [b.x0, b.y1], [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2]]
    .map(([x, y]) => Math.round(hz(x, y))).filter((z) => z >= 0);
}

// Сдвиг (мм, оси дома) с привязкой: край габарита к линиям, иначе шаг.
function snapAxis(coord, box, v, e, skip, extraZ = []) {
  if (e.shiftKey) return Math.round(v);
  const k = env.worldPerPx();
  const lines = coord === 'z' ? zLines(skip).concat(extraZ) : massBaseSnap(skip)[`${coord}s`];
  return snapShift(box[`${coord}0`], box[`${coord}1`], v, lines, SNAP_PX * k, massStep(1 / k)).value;
}

// Сдвиг мыши → смещение вдоль оси (мм).
function axisMove(axis, e) {
  const dx = e.clientX - drag.x0; const dy = e.clientY - drag.y0;
  let d = env.axisDelta(axis, dx, dy);
  if (!d && axis.z) d = -dy * env.worldPerPx();
  return d;
}

function dragGizmo(e) {
  const d = drag;
  const b = massBox(d.start);
  const shift = { x: 0, y: 0, z: 0 };
  if (d.part === 'gxy') {
    const p = d.p0 ? rayPlaneZ(env.ray(e), d.planeZ) : null;
    if (p) { shift.x = p.x - d.p0.x; shift.y = p.y - d.p0.y; } else {
      shift.x = axisMove(GIZMO_AXES.x, e);
      shift.y = -axisMove(GIZMO_AXES.y, e);
    }
    shift.x = snapAxis('x', b, shift.x, e, d.id);
    shift.y = snapAxis('y', b, shift.y, e, d.id);
  } else {
    const axis = d.part.slice(1);
    const a = GIZMO_AXES[axis];
    const v = axisMove(a, e);
    for (const c of ['x', 'y', 'z']) if (a[c]) shift[c] = snapAxis(c, b, a[c] * v, e, d.id, c === 'z' ? groundZs(d.start) : []);
  }
  shift.z = Math.max(-d.start.z0, shift.z);
  return { ...d.start, x: d.start.x + shift.x, y: d.start.y + shift.y, z0: Math.round(d.start.z0 + shift.z) };
}

function dragHandle(e) {
  const d = drag;
  const b = massBox(d.start);
  const s = d.handle.s;
  const p0 = handlePoint(b, s);
  const shift = { x: 0, y: 0, z: 0 };
  const snapTo = (c, raw) => {
    if (e.shiftKey) return Math.round(raw);
    const k = env.worldPerPx();
    const lines = c === 'z' ? zLines(d.id).concat(groundZs(d.start)) : massBaseSnap(d.id)[`${c}s`];
    return snapValue(raw, lines, SNAP_PX * k, massStep(1 / k)).value;
  };
  if (d.handle.face) {
    const n = FACE_NORMAL[d.handle.face];
    const v = axisMove(n, e);
    for (const c of ['x', 'y', 'z']) if (n[c]) shift[c] = snapTo(c, p0[c] + n[c] * v) - p0[c];
  } else {
    const p = d.p0 ? rayPlaneZ(env.ray(e), d.planeZ) : null;
    if (!p) return null;
    shift.x = snapTo('x', p0.x + p.x - d.p0.x) - p0.x;
    shift.y = snapTo('y', p0.y + p.y - d.p0.y) - p0.y;
  }
  return resizeByHandle(d.start, s, shift);
}

const signed = (v) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(Math.round(v))}`;

export function moveMassDrag(e) {
  if (!drag) return;
  const next = drag.handle ? dragHandle(e) : dragGizmo(e);
  if (!next) return;
  state.project.masses = masses().map((m) => (m.id === drag.id ? next : m));
  drag.changed = JSON.stringify(next) !== JSON.stringify(drag.start);
  const b = massBox(next);
  let text;
  if (drag.handle) {
    text = `${Math.round(b.x1 - b.x0)} × ${Math.round(b.y1 - b.y0)} × ${Math.round(b.z1 - b.z0)} мм`;
    if (drag.handle.face === 'top' || drag.handle.face === 'bottom') text += ` · ${floorsLabel(b.z1 - b.z0, massLevelHeight())}`;
  } else {
    const at = `x ${Math.round(next.x)}, y ${Math.round(next.y)}, z ${Math.round(next.z0)}`;
    if (drag.part === 'gxy') text = `Перенос ${signed(next.x - drag.start.x)}, ${signed(next.y - drag.start.y)} мм · ${at}`;
    else {
      const axis = drag.part.slice(1);
      const a = GIZMO_AXES[axis];
      const along = (next.x - drag.start.x) * a.x + (next.y - drag.start.y) * a.y + (next.z0 - drag.start.z0) * a.z;
      text = `${axis.toUpperCase()} ${signed(along)} мм · ${at}`;
    }
  }
  env.label(text, e.clientX, e.clientY);
  env.redraw(true);
}

export function finishMassDrag() {
  const d = drag;
  drag = null;
  env.label(null);
  if (!d) return;
  if (!d.changed) { env.redraw(true); return; }
  refreshDerived();
  pushHistory(d.before);
  afterChange();
  selectObject({ type: 'mass', id: d.id });
}

export function cancelMassDrag() {
  const d = drag;
  drag = null;
  env?.label(null);
  if (!d) return;
  state.project.masses = masses().map((m) => (m.id === d.id ? d.start : m));
  env.redraw(true);
}

// ---------------------------------------------------------------- числа

function numInput() { return document.getElementById('v3MassNum'); }

function hideNum() {
  const input = numInput();
  if (input) input.hidden = true;
  numField = null;
}

const FIELD_LABEL = { w: 'Ширина', d: 'Глубина', h: 'Высота' };

function showNum(kind, value, extra = {}) {
  const input = numInput();
  if (!input) return;
  numField = { kind, ...extra };
  const at = lastCursor || { x: innerWidth / 2, y: innerHeight / 2 };
  const r = input.parentElement.getBoundingClientRect();
  input.style.left = `${Math.round(at.x - r.left)}px`;
  input.style.top = `${Math.round(at.y - r.top)}px`;
  const label = kind === 'face' ? (extra.face === 'top' ? 'Высота' : 'Размер') : FIELD_LABEL[kind];
  input.setAttribute('aria-label', `${label} массы, мм`);
  input.placeholder = label;
  input.title = `${label}, мм — Enter применить${kind === 'w' ? ', Tab — глубина' : ''}, Esc отмена`;
  input.value = value == null ? '' : String(Math.round(value));
  input.hidden = false;
  env.hint(`${label}, мм — Enter${kind === 'w' ? ' · Tab — глубина' : ''} · Esc — отмена`);
  input.focus();
  if (value != null) input.select();
}

function curDims(t) {
  return { w: t.b ? Math.abs(t.b.x - t.a.x) : 0, d: t.b ? Math.abs(t.b.y - t.a.y) : 0 };
}

function fixBase(t, w, d) {
  const sx = Math.sign((t.b?.x ?? t.a.x + 1) - t.a.x) || 1;
  const sy = Math.sign((t.b?.y ?? t.a.y + 1) - t.a.y) || 1;
  t.b = { x: t.a.x + sx * w, y: t.a.y + sy * d };
  t.screen2 = lastCursor ? { ...lastCursor } : { x: innerWidth / 2, y: innerHeight / 2 };
  t.h = t.h || MASS_H_DEFAULT;
  setStage(t, 'height');
  env.redraw();
}

// Клавиша в окне 3D для масс. true — съедена.
export function massKey(event) {
  const t = tool();
  if (!t) return false;
  const digit = /^[0-9]$/.test(event.key);
  if ((t.stage === 'base' || t.stage === 'height') && (digit || event.key === 'Enter')) {
    event.preventDefault();
    if (t.stage === 'base') showNum('w', digit ? null : curDims(t).w);
    else showNum('h', digit ? null : t.h || MASS_H_DEFAULT);
    if (digit) numInput().value = event.key;
    return true;
  }
  return false;
}

function applyNum(e) {
  const input = numInput();
  const f = numField;
  if (!f || !input) return;
  const v = Number(String(input.value).replace(',', '.'));
  if (!Number.isFinite(v) || v < MASS_MIN) { toast(`Нужно число от ${MASS_MIN} мм`, true); return; }
  const t = tool();
  if (f.kind === 'face') {
    hideNum();
    const next = updateMass(f.id, (m) => setFaceSize(m, f.face, v) || m);
    if (next) selectObject({ type: 'mass', id: next.id });
    env.hint();
    return;
  }
  if (!t) { hideNum(); return; }
  if (f.kind === 'w') {
    t.typedW = v;
    if (e?.key === 'Tab') { showNum('d', curDims(t).d || null); return; }
    hideNum();
    fixBase(t, v, curDims(t).d || v);
    showNum('h', MASS_H_DEFAULT);
  } else if (f.kind === 'd') {
    const w = t.typedW || curDims(t).w || v;
    hideNum();
    fixBase(t, w, v);
    showNum('h', MASS_H_DEFAULT);
  } else if (f.kind === 'h') {
    hideNum();
    if (!t.b || t.stage !== 'height') return;
    t.h = v;
    t.typedW = null;
    commitTool(t);
    env.redraw();
  }
}

export function bindMassNum() {
  const input = numInput();
  if (!input) return;
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || (e.key === 'Tab' && numField?.kind === 'w')) { e.preventDefault(); e.stopPropagation(); applyNum(e); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); hideNum(); env.hint(); }
  });
  input.addEventListener('blur', () => { setTimeout(() => { if (numField && document.activeElement !== input) { hideNum(); env.hint(); } }, 0); });
}

export const massNumOpen = () => Boolean(numField);
export function closeMassNum() { hideNum(); }

// Двойной клик по точке выбранной массы — точный размер её оси (угол —
// ширина по x; противоположная грань стоит). Грань — ничего.
export function massDblClick(e) {
  const at = massPartAt(e);
  const handle = at ? massHandle(at.part) : null;
  if (!handle) return false;
  const m = massById(at.id);
  const face = handle.face || (handle.s.x > 0 ? 'px' : 'nx');
  lastCursor = { x: e.clientX, y: e.clientY };
  showNum('face', faceSize(m, face), { face, id: m.id });
  return true;
}

// Для автотестов: стадия инструмента, жест, наведение, ввод числа, гизмо и
// точки выбранной массы (экранные координаты клиента).
export function debugMass3d() {
  const t = tool();
  const m = !t && env ? selectedMass() : null;
  const scr = m ? gripScreen(m) : null;
  return {
    tool: Boolean(t), stage: t?.stage || null, a: t?.a || null, b: t?.b || null, z: t?.z ?? null, h: t?.h ?? null,
    dragging: Boolean(drag), part: drag?.part || null, hover, num: numField?.kind || null,
    gizmo: scr ? scr.gizmo : null,
    handles: scr ? Object.fromEntries(scr.handles.map((h) => [h.id, { ...h.p, back: h.back }])) : null,
  };
}

