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
// Магнит (core/mass-snap.js): края двигаемой массы липнут к граням других
//   масс «вплотную» и «заподлицо» по трём осям, по z — к отметкам этажей,
//   земле и верху масс (стопка); радиус 12 px экрана (касание 20 px) в
//   пределах 20…600 мм, отрыв — за 16 px; цель подсвечивается оранжевым,
//   подпись у курсора и в подсказке; флажок «Магнит масс», Alt — без магнита.
// Грань массы ничего не тянет: клик по телу — только выбор. Shift — без
// шага, Esc — отмена жеста, каждый жест — одна запись истории. Касание —
// те же ручки с увеличенной зоной попадания.

import {
  FACE_NORMAL, MASS_H_DEFAULT, MASS_MIN, massMinimum, clipMassBoxZ, createMass, createMassVoid, faceSize, floorsLabel, massBox,
  massStep, setFaceSize,
} from '../core/masses.js';
import {
  GIZMO_AXES, GIZMO_COLORS, GIZMO_PLANE_PX, GIZMO_PX, MASS_GRIP_MIN, MASS_HANDLES, gizmoOrigin, gizmoPick,
  handleFacing, handlePick, handlePoint, massHandle, resizeByHandle,
} from '../core/mass-gizmo.js';
import { axisTargets, snapContact, snapLabel, snapMove, snapTolerances } from '../core/mass-snap.js';
import { basePlane, pickMass, rayPlaneZ } from '../core/pick3d.js';
import { facadeWallSpan, updateFacadeAttachment } from '../core/facade.js';
import { massFaces } from '../core/mesh3d.js';
import { toast } from './dom.js';
import {
  MASS_HINT, MASS_VOID_HINT, addMass, massBaseSnap, massById, massIsVoid, massLevelHeight, massVoids, masses,
  pruneUnusedMassVoidLive, replaceMassLive, solidMassList, updateMass,
} from './masses.js';
import { state } from './state.js';
import { afterChange, pushHistory, refreshDerived, snapshot } from './store.js';
import { selectObject } from './tools.js';

const GHOST = '#3d7fe0';
const VOID_GHOST = '#ef6c32';
const SNAP_COLOR = '#f76b15'; // подсветка цели магнита
const SNAP_EDGE = [0.97, 0.42, 0.08, 1];
const PREF_KEY = 'kepler-3d-layers'; // общий ключ слоёв 3D (ui/view3d.js), поле massSnap

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
  return solidMassList().flatMap((m) => {
    const box = visibleBox(m);
    return box ? [{ id: m.id, ...(m.facadeKind ? { facadeKind: m.facadeKind } : {}), ...box }] : [];
  });
}

// Отдельно для 3D-pick: cutter не считается опорой, но его каркас можно
// выбрать и править тем же гизмо.
export function massVoidBoxes() {
  return massVoids().map((m) => ({ id: m.id, ...massBox(m) }));
}

// ---------------------------------------------------------------- магнит
// Магнит масс (core/mass-snap.js): грани и рёбра других масс по трём осям,
// отметки этажей, земля; радиус — в пикселях экрана, с гистерезисом.
// Флажок «Магнит масс» (#v3MassSnap) запоминается в kepler-3d-layers.
// Shift — без магнита и без шага, Alt — без магнита (шаг остаётся).

let magnetPref = true;
try {
  const raw = JSON.parse(localStorage.getItem(PREF_KEY) || 'null');
  if (raw && typeof raw.massSnap === 'boolean') magnetPref = raw.massSnap;
} catch { /* нет хранилища — по умолчанию включён */ }

export const massSnapOn = () => magnetPref;
export function setMassSnap(on) {
  magnetPref = Boolean(on);
  try {
    const raw = JSON.parse(localStorage.getItem(PREF_KEY) || 'null') || {};
    localStorage.setItem(PREF_KEY, JSON.stringify({ ...raw, massSnap: magnetPref }));
  } catch { /* нет хранилища */ }
  const cb = document.getElementById('v3MassSnap');
  if (cb) cb.checked = magnetPref;
}

const magnetFree = (e) => !magnetPref || Boolean(e?.altKey) || Boolean(e?.shiftKey);
const UNIT = { x: { x: 1, y: 0, z: 0 }, y: { x: 0, y: 1, z: 0 }, z: { x: 0, y: 0, z: 1 } };

function otherBoxes(skip = null) {
  return masses().filter((m) => m.id !== skip).map((m) => ({ id: m.id, name: m.name, box: massBox(m) }));
}

function levelList() {
  return (state.project?.levels || []).map((l) => ({ elevation: l.elevation, height: l.height, name: l.name }));
}

// Миллиметров на пиксель вдоль оси c у точки p (с учётом ракурса и
// перспективы): ось, идущая «в глубину», на экране короче — радиус в мм больше.
function mmPerPxAlong(p, c) {
  const k = env.worldPerPx();
  try {
    const s0 = env.project(p);
    const s1 = env.project(add(p, UNIT[c], 1000));
    const len = s0 && s1 ? Math.hypot(s1.x - s0.x, s1.y - s0.y) : 0;
    return Number.isFinite(len) && len > 1 ? 1000 / len : k;
  } catch { return k; }
}

// Привязка по оси c: край габарита box (сдвиг v) к целям; cur — габарит с
// сырым сдвигом по всем осям (для проверки «касаются ли»); held — объект
// гистерезиса { x, y, z } (key притянутой цели). → { value, snap }.
function snapAlong(c, box, cur, v, e, held, { skip = null, ground = [], step = 0, accept = null, edges = null, at = null } = {}) {
  let targets = axisTargets(c, cur, otherBoxes(skip), {
    levels: c === 'z' ? levelList() : [], ground: c === 'z' ? ground : [], lines: c === 'z' ? [] : massBaseSnap(skip)[`${c}s`],
    hostWall: drag?.id === skip ? drag.hostWall : null,
  });
  if (edges) targets = targets.filter((t) => edges.includes(t.edge));
  const { tol, release } = snapTolerances(mmPerPxAlong(at || gizmoOrigin(cur), c), drag?.pointer || (tool()?.touch ? 'touch' : 'mouse'));
  const r = snapMove({
    lo: box[`${c}0`], hi: box[`${c}1`], v, targets, tol, release, held: held[c] || null, step, free: magnetFree(e), accept,
  });
  held[c] = r.snap?.key || null;
  return r;
}

// Точка основания при создании: x и y липнут к граням масс, комнат и стен.
function snapXY(p, e, z = 0) {
  const t = tool();
  const held = t ? (t.held ||= {}) : {};
  if (t) t.snaps = [];
  if (e?.shiftKey) { held.x = null; held.y = null; return { x: Math.round(p.x), y: Math.round(p.y) }; }
  const step = massStep(1 / env.worldPerPx());
  const pt = { x0: p.x, x1: p.x, y0: p.y, y1: p.y, z0: z, z1: z };
  const at = { x: p.x, y: p.y, z };
  const out = {};
  for (const c of ['x', 'y']) {
    const r = snapAlong(c, pt, pt, 0, e, held, { edges: ['lo', 'hi'], at });
    if (r.snap) {
      out[c] = p[c] + r.value;
      t?.snaps.push({ t: r.snap, box: pt });
    } else out[c] = step > 0 ? Math.round(p[c] / step) * step : Math.round(p[c]);
  }
  return out;
}

const snapText = (list) => [...new Set((list || []).map((s) => snapLabel(s.t)).filter(Boolean))].join(', ');

// Подсказка в #v3Hint при срабатывании магнита.
function snapHint(list) {
  const text = snapText(list);
  if (text) env.hint(`Магнит: ${text} · Alt или Shift — без магнита`);
}

// Рёбра габарита (12 отрезков).
function boxEdges(b) {
  const P = (i, j, k) => ({ x: i ? b.x1 : b.x0, y: j ? b.y1 : b.y0, z: k ? b.z1 : b.z0 });
  const E = [];
  for (const [i, j, k] of [[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1], [1, 1, 0], [1, 0, 1], [0, 1, 1], [1, 1, 1]]) {
    if (!i) E.push([P(i, j, k), P(1, j, k)]);
    if (!j) E.push([P(i, j, k), P(i, 1, k)]);
    if (!k) E.push([P(i, j, k), P(i, j, 1)]);
  }
  return E;
}

// Подсветка цели магнита: оранжевая плоскость стыка и рёбра целевой массы.
function snapOverlay(list) {
  const out = [];
  const lit = new Set();
  for (const { t, box } of list || []) {
    const tm = t.id ? massById(t.id) : null;
    const tbox = tm ? massBox(tm) : null;
    if (t.kind !== 'center') {
      const c = snapContact(box, t, tbox);
      const [u, w] = Object.keys(c.ranges);
      const [u0, u1] = c.ranges[u]; const [w0, w1] = c.ranges[w];
      const pt = (a, b) => ({ [t.axis]: c.value, [u]: a, [w]: b });
      const P = [pt(u0, w0), pt(u1, w0), pt(u1, w1), pt(u0, w1)];
      out.push({
        pts: P, normal: { ...UNIT[t.axis] }, color: SNAP_COLOR, alpha: 0.35, kind: 'overlay', onTop: true, flat: true, twoSided: true,
        edges: P.map((q, i) => [q, P[(i + 1) % 4]]), edgeRgba: SNAP_EDGE,
      });
    }
    if (tbox && !lit.has(t.id)) {
      lit.add(t.id);
      out.push({ pts: [], normal: { x: 0, y: 0, z: 1 }, color: SNAP_COLOR, alpha: 0, kind: 'overlay', edges: boxEdges(tbox), edgeRgba: [0.97, 0.42, 0.08, 0.85] });
    }
  }
  return out;
}

function setStage(t, stage) {
  t.stage = stage;
  t.held = {};
  t.snaps = [];
  env.hint(stageHint(t));
}

function stageHint(t) {
  const name = t.void ? 'Полая масса' : 'Масса';
  if (t.stage === 'base') return `${name}: клик — противоположный угол · Shift — без привязки, Ctrl — квадрат · цифры — ширина, Tab — глубина · Esc — назад`;
  if (t.stage === 'height' && t.touch) return `${name}: тап выше основания — высота по пальцу, объём готов · Esc — назад`;
  if (t.stage === 'height') return `${name}: тяните вверх — высота, клик — готово · Shift — шаг 10 мм · цифры + Enter — высота · Esc — назад`;
  return t.void ? MASS_VOID_HINT : MASS_HINT;
}

export function massToolHint() {
  const t = tool();
  return t ? stageHint(t) : null;
}

// Сброс стадий (вход в 3D, выход из него).
export function resetMassTool() {
  const t = tool();
  if (t) Object.assign(t, { stage: 'corner', a: null, b: null, h: null, z: 0, cursor: null, screen2: null, held: {}, snaps: [] });
  hideNum();
  env?.label(null);
}

// ---------------------------------------------------------------- создание

function heightFrom(t, e) {
  let d = env.axisDelta({ x: 0, y: 0, z: 1 }, e.clientX - t.screen2.x, e.clientY - t.screen2.y);
  if (!d) d = -(e.clientY - t.screen2.y) * env.worldPerPx();
  let h = Math.max(MASS_MIN, d);
  t.held ||= {};
  t.snaps = [];
  if (e.shiftKey) { t.held.z = null; return Math.max(MASS_MIN, Math.round(h / 10) * 10); }
  // Верх призрака липнет к отметкам этажей и верху/низу других масс.
  const top = t.z + h;
  const ghost = {
    x0: Math.min(t.a.x, t.b.x), x1: Math.max(t.a.x, t.b.x), y0: Math.min(t.a.y, t.b.y), y1: Math.max(t.a.y, t.b.y), z0: t.z, z1: top,
  };
  const at = { x: (ghost.x0 + ghost.x1) / 2, y: (ghost.y0 + ghost.y1) / 2, z: top };
  const pt = { ...ghost, z0: top, z1: top };
  const r = snapAlong('z', pt, ghost, 0, e, t.held, { edges: ['hi'], at, accept: (v) => top + v - t.z >= MASS_MIN });
  if (r.snap) {
    t.snaps = [{ t: r.snap, box: ghost }];
    return top + r.value - t.z;
  }
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
    const p = snapXY(plane.point, e, plane.z);
    t.cursor = { x: p.x, y: p.y, z: plane.z };
    const on = plane.massId ? massById(plane.massId) : null;
    const text = [on ? `на «${on.name}» · отм. ${Math.round(plane.z)}` : plane.z ? `отм. ${Math.round(plane.z)}` : '', snapText(t.snaps)].filter(Boolean).join(' · ');
    env.label(text || null, e.clientX, e.clientY);
  } else if (t.stage === 'base') {
    const p = rayPlaneZ(ray, t.z);
    if (!p) return;
    let b = snapXY(p, e, t.z);
    if (e.ctrlKey || e.metaKey) { b = squareB(t.a, b); t.snaps = []; }
    t.b = b;
    const s = snapText(t.snaps);
    env.label(`${Math.round(Math.abs(b.x - t.a.x))} × ${Math.round(Math.abs(b.y - t.a.y))} мм${s ? ` · ${s}` : ''}`, e.clientX, e.clientY);
  } else if (t.stage === 'height') {
    t.h = heightFrom(t, e);
    const s = snapText(t.snaps);
    env.label(`${Math.round(t.h)} мм · ${floorsLabel(t.h, massLevelHeight())}${s ? ` · ${s}` : ''}`, e.clientX, e.clientY);
  }
  if (t.snaps?.length) snapHint(t.snaps); else env.hint(stageHint(t));
  env.redraw();
}

function commitTool(t) {
  const w = Math.abs(t.b.x - t.a.x);
  const d = Math.abs(t.b.y - t.a.y);
  const spec = {
    x: (t.a.x + t.b.x) / 2, y: (t.a.y + t.b.y) / 2, w, d, z0: t.z, h: t.h || MASS_H_DEFAULT,
  };
  const m = t.void ? createMassVoid(spec, massVoids()) : createMass(spec, solidMassList());
  Object.assign(t, { stage: 'corner', a: null, b: null, h: null, screen2: null, held: {}, snaps: [] });
  hideNum();
  env.label(null);
  const added = addMass(m);
  env.hint(stageHint(t));
  return added;
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
  const ghostColor = t?.void ? VOID_GHOST : GHOST;
  const k = env.worldPerPx();
  if (t?.a && t.b && (t.stage === 'base' || t.stage === 'height')) {
    const x0 = Math.min(t.a.x, t.b.x); const x1 = Math.max(t.a.x, t.b.x);
    const y0 = Math.min(t.a.y, t.b.y); const y1 = Math.max(t.a.y, t.b.y);
    if (t.stage === 'height' && t.h > 0) {
      const ghost = massFaces([{ id: 'ghost', x: (x0 + x1) / 2, y: (y0 + y1) / 2, w: x1 - x0, d: y1 - y0, z0: t.z, h: t.h, rotation: 0, color: ghostColor }], { alpha: t.void ? 0.14 : 0.3 });
      for (const f of ghost) out.push({ ...f, kind: 'overlay', twoSided: true, edgeRgba: t.void ? [0.94, 0.31, 0.08, 1] : [0.15, 0.4, 0.85, 0.9] });
    } else if (x1 - x0 > 0.5 || y1 - y0 > 0.5) {
      const z = t.z + 2;
      const P = [{ x: x0, y: y0, z }, { x: x1, y: y0, z }, { x: x1, y: y1, z }, { x: x0, y: y1, z }];
      out.push({
        pts: P, normal: { x: 0, y: 0, z: 1 }, color: ghostColor, alpha: t.void ? 0.14 : 0.3, kind: 'overlay', twoSided: true,
        edges: P.map((p, i) => [p, P[(i + 1) % 4]]), edgeRgba: t.void ? [0.94, 0.31, 0.08, 1] : [0.15, 0.4, 0.85, 0.95],
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
    out.push({ pts: [], normal: { x: 0, y: 0, z: 1 }, color: ghostColor, alpha: 0, kind: 'overlay', edges, edgeRgba: t.void ? [0.94, 0.31, 0.08, 0.18] : [0.2, 0.32, 0.5, 0.16] });
  }
  if (t?.cursor && (t.stage === 'corner' || !t.stage)) {
    const s = 5 * k;
    const c = t.cursor;
    const z = (c.z || 0) + 2;
    const P = [{ x: c.x - s, y: c.y - s, z }, { x: c.x + s, y: c.y - s, z }, { x: c.x + s, y: c.y + s, z }, { x: c.x - s, y: c.y + s, z }];
    out.push({ pts: P, normal: { x: 0, y: 0, z: 1 }, color: ghostColor, alpha: 0.85, kind: 'overlay', twoSided: true });
  }
  // Магнит: плоскость стыка и целевая масса.
  if (t?.snaps?.length && t.stage) out.push(...snapOverlay(t.snaps));
  if (drag?.snaps?.length) out.push(...snapOverlay(drag.snaps));
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

function visibleBox(m) {
  return m.facadeKind ? clipMassBoxZ(massBox(m), env?.facadeClip?.()) : massBox(m);
}
function visibleHandles(m, box) {
  const original = massBox(m);
  return MASS_HANDLES.map((h) => ({ h, p: handlePoint(original, h.s) }))
    .filter(({ p }) => p.z >= box.z0 - .01 && p.z <= box.z1 + .01);
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
  const box = visibleBox(m);
  if (!box) return [];
  const top = { kind: 'overlay', onTop: true, flat: true, twoSided: true, normal: { x: 0, y: 0, z: 1 } };
  // Лёгкий каркас куба поверх сцены: виден, даже когда масса частично
  // спрятана внутри соседней.
  const cz = [box.z0, box.z1];
  const C = (i, j, l) => ({ x: i ? box.x1 : box.x0, y: j ? box.y1 : box.y0, z: cz[l] });
  const wire = [];
  for (const [a, b] of [[[0, 0], [1, 0]], [[1, 0], [1, 1]], [[1, 1], [0, 1]], [[0, 1], [0, 0]]]) {
    for (const l of [0, 1]) wire.push([C(a[0], a[1], l), C(b[0], b[1], l)]);
    wire.push([C(a[0], a[1], 0), C(a[0], a[1], 1)]);
  }
  const voidMode = massIsVoid(m.id);
  out.push({ ...top, pts: [C(0, 0, 0), C(1, 0, 0), C(1, 1, 0)], color: '#ffffff', alpha: 0, edges: wire, edgeRgba: voidMode ? [0.94, 0.31, 0.08, 0.9] : [0.24, 0.5, 0.88, 0.55] });
  // Точки размера (сначала невидимые стороны — ниже в стопке).
  const list = visibleHandles(m, box).map(({ h, p }) => ({ h, p, front: handleFacing(h.s, B.f) }))
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
  const box = visibleBox(m);
  if (!box) return null;
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
    handles: visibleHandles(m, box).map(({ h, p }) => ({ id: h.id, p: env.project(p), back: !handleFacing(h.s, B.f) })),
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
  if (!scr) return null;
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
  const box = visibleBox(sel);
  return box ? pickMass([{ id: sel.id, ...box }], ray) : null;
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
    pointer: e.pointerType === 'touch' || e.pointerType === 'pen' ? 'touch' : 'mouse',
    held: {}, snaps: [], // магнит: притянутые цели (гистерезис) и подсветка
    hostWall: m.facadeKind === 'canopy' ? facadeWallSpan(state.project, m, null, new Map(), state.walls) : null,
  };
  // Перенос по плоскости и углы — по горизонтальной плоскости.
  if (at.part === 'gxy' || (handle && !handle.face)) {
    drag.planeZ = at.part === 'gxy' ? gizmoOrigin(visibleBox(m) || box).z : handlePoint(box, handle.s).z;
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

const shifted = (b, s) => ({ x0: b.x0 + s.x, x1: b.x1 + s.x, y0: b.y0 + s.y, y1: b.y1 + s.y, z0: b.z0 + s.z, z1: b.z1 + s.z });

// Сдвиг мыши → смещение вдоль оси (мм).
function axisMove(axis, e) {
  const dx = e.clientX - drag.x0; const dy = e.clientY - drag.y0;
  let d = env.axisDelta(axis, dx, dy);
  if (!d && axis.z) d = -dy * env.worldPerPx();
  return d;
}

// Гизмо: стрелка — одна ось, квадрат XY — x и y независимо. Края габарита
// липнут к граням других масс (вплотную или заподлицо), по z — к верху/низу
// масс, отметкам этажей и земле; иначе — шаг по масштабу (Shift — без шага).
function dragGizmo(e) {
  const d = drag;
  const b = massBox(d.start);
  const raw = { x: 0, y: 0, z: 0 };
  const axes = [];
  if (d.part === 'gxy') {
    const p = d.p0 ? rayPlaneZ(env.ray(e), d.planeZ) : null;
    if (p) { raw.x = p.x - d.p0.x; raw.y = p.y - d.p0.y; } else {
      raw.x = axisMove(GIZMO_AXES.x, e);
      raw.y = -axisMove(GIZMO_AXES.y, e);
    }
    axes.push('x', 'y');
  } else {
    const a = GIZMO_AXES[d.part.slice(1)];
    const v = axisMove(a, e);
    for (const c of ['x', 'y', 'z']) if (a[c]) { raw[c] = a[c] * v; axes.push(c); }
  }
  raw.z = Math.max(-d.start.z0, raw.z);
  const cur = shifted(b, raw);
  const step = e.shiftKey ? 0 : massStep(1 / env.worldPerPx());
  const shift = { x: 0, y: 0, z: 0 };
  const snaps = [];
  for (const c of axes) {
    const r = snapAlong(c, b, cur, raw[c], e, d.held, {
      skip: d.id, ground: c === 'z' ? groundZs(d.start) : [], step, accept: c === 'z' && !d.start.facadeKind ? (v) => b.z0 + v >= 0 : null,
    });
    shift[c] = r.value;
    if (r.snap) snaps.push({ t: r.snap, c });
  }
  if (!d.start.facadeKind) shift.z = Math.max(-d.start.z0, shift.z);
  const next = { ...d.start, x: d.start.x + shift.x, y: d.start.y + shift.y, z0: Math.round(d.start.z0 + shift.z) };
  const nb = massBox(next);
  d.snaps = snaps.map((s) => ({ t: s.t, box: nb }));
  return next;
}

// Точка размера: двигаемая грань (центр грани — по нормали, угол — две
// боковые) липнет к граням других масс, отметкам и земле по своей оси; размер
// не меньше MASS_GRIP_MIN, низ не ниже 0. Без цели — абсолютный шаг.
function dragHandle(e) {
  const d = drag;
  const b = massBox(d.start);
  const s = d.handle.s;
  const p0 = handlePoint(b, s);
  const minimum = d.start.facadeKind ? massMinimum(d.start) : MASS_GRIP_MIN;
  const shift = { x: 0, y: 0, z: 0 };
  const snaps = [];
  const step = massStep(1 / env.worldPerPx());
  const snapTo = (c, v) => {
    const p = p0[c];
    const hi = s[c] > 0;
    const accept = (dv) => {
      const q = p + dv;
      if (hi) return q - b[`${c}0`] >= minimum;
      return b[`${c}1`] - q >= minimum && (c !== 'z' || d.start.facadeKind || q >= 0);
    };
    const pt = { ...b, [`${c}0`]: p, [`${c}1`]: p };
    const r = snapAlong(c, pt, b, v, e, d.held, {
      skip: d.id, ground: c === 'z' ? groundZs(d.start) : [], edges: [hi ? 'hi' : 'lo'], accept, at: p0,
    });
    if (r.snap) { snaps.push(r.snap); return r.value; }
    if (e.shiftKey) return Math.round(p + v) - p;
    return Math.round((p + v) / step) * step - p;
  };
  if (d.handle.face) {
    const n = FACE_NORMAL[d.handle.face];
    const v = axisMove(n, e);
    for (const c of ['x', 'y', 'z']) if (n[c]) shift[c] = snapTo(c, n[c] * v);
  } else {
    const p = d.p0 ? rayPlaneZ(env.ray(e), d.planeZ) : null;
    if (!p) return null;
    shift.x = snapTo('x', p.x - d.p0.x);
    shift.y = snapTo('y', p.y - d.p0.y);
  }
  const next = resizeByHandle(d.start, s, shift, minimum);
  const nb = massBox(next);
  d.snaps = snaps.map((t) => ({ t, box: nb }));
  return next;
}

const signed = (v) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(Math.round(v))}`;

export function moveMassDrag(e) {
  if (!drag) return;
  const next = drag.handle ? dragHandle(e) : dragGizmo(e);
  if (!next) return;
  updateFacadeAttachment(state.project, drag.start, next);
  replaceMassLive(drag.id, next);
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
  const s = snapText(drag.snaps);
  if (s) { text += ` · ${s}`; snapHint(drag.snaps); } else env.hint();
  env.label(text, e.clientX, e.clientY);
  env.redraw(true);
}

export function finishMassDrag() {
  const d = drag;
  drag = null;
  env.label(null);
  if (!d) return;
  if (d.snaps?.length) env.hint();
  const removedSelf = pruneUnusedMassVoidLive(d.id);
  if (!d.changed && !removedSelf) { env.redraw(true); return; }
  refreshDerived();
  pushHistory(d.before);
  afterChange();
  if (removedSelf) toast('Полая масса больше ничего не пересекает и удалена', true);
  else selectObject({ type: 'mass', id: d.id });
}

export function cancelMassDrag() {
  const d = drag;
  drag = null;
  env?.label(null);
  if (!d) return;
  env.hint();
  replaceMassLive(d.id, d.start);
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
  input.min = String(kind === 'face' ? massMinimum(massById(extra.id)) : MASS_MIN);
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
  const minimum = f.kind === 'face' ? massMinimum(massById(f.id)) : MASS_MIN;
  if (!Number.isFinite(v) || v < minimum) { toast(`Нужно число от ${minimum} мм`, true); return; }
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
  const cb = document.getElementById('v3MassSnap');
  if (cb) {
    cb.checked = magnetPref;
    cb.addEventListener('change', () => setMassSnap(cb.checked));
  }
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

const snapDebug = (list) => (list?.length
  ? { kind: list[0].t.kind, axis: list[0].t.axis, target: list[0].t.id || null, name: list[0].t.name || null, value: list[0].t.value, text: snapText(list), count: list.length }
  : null);

// Для автотестов: стадия инструмента, жест, наведение, ввод числа, гизмо и
// точки выбранной массы (экранные координаты клиента).
export function debugMass3d() {
  const t = tool();
  const m = !t && env ? selectedMass() : null;
  const scr = m ? gripScreen(m) : null;
  return {
    tool: Boolean(t), void: Boolean(t?.void), stage: t?.stage || null, a: t?.a || null, b: t?.b || null, z: t?.z ?? null, h: t?.h ?? null,
    dragging: Boolean(drag), part: drag?.part || null, hover, num: numField?.kind || null,
    gizmo: scr ? scr.gizmo : null,
    // Магнит: первая притянутая цель жеста или инструмента и все подписи.
    snap: snapDebug(drag?.snaps || t?.snaps), magnet: magnetPref,
    snapTol: m ? Object.fromEntries(['x', 'y', 'z'].map((c) => [c, snapTolerances(mmPerPxAlong(gizmoOrigin(massBox(m)), c))])) : null,
    handles: scr ? Object.fromEntries(scr.handles.map((h) => [h.id, { ...h.p, back: h.back }])) : null,
  };
}

