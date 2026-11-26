// Самостоятельный 3D-вид всей модели: WebGL с буфером глубины (запасной путь —
// грани по глубине на canvas 2D), перспектива/параллельная проекция и простое освещение. Мышь: тянуть — вращать, колесо — масштаб,
// правой/средней или с Shift — сдвиг. Пальцы: один — вращать, два —
// масштаб и сдвиг. Esc или «✕» — закрыть.
//
// Стены — объекты (как в Revit): клик выбирает стену (общий выбор с планом,
// state.selection), выбранная подсвечивается; её грани — ручки: верх —
// высота, бок — сдвиг (Alt — толщина), торец ручной стены — длина; двойной
// клик по ручке — ввод числа. Касание: тап — выбор, удержание грани
// выбранной стены — перетаскивание. Попадание — луч на процессоре
// (core/pick3d.js), правка — core/wall-edit3d.js; во время жеста
// пересобирается только слой стен этажа, в историю — одна запись.
//
// Выбираются и другие объекты (срез 1): помещение — по полу, мебель,
// лестница, колонна — по своим граням, проём — по пустоте в стене; ближайшее
// к камере попадание побеждает (core/pick3d.js pickObject). Выбор общий с
// планом, объект другого этажа делает его активным. Слои: «Мебель» и «Этажи»
// (все / до активного / только активный) — запоминаются в localStorage.
//
// Модель — core/mesh3d.js (оси дома: x вправо, y вниз по плану, z вверх).
// Здесь она переводится в правую систему: X = x, Y = −y, Z = z.

import { W, LIGHT, EDGE_KINDS, createSceneGL, dot, drawSceneGL, hexRgb, polyNormal, sceneBuffers, sub } from './scene-gl.js';
import { GRID_STEP, isStructural } from '../core/catalog.js';
import {
  boxFaces, buildHouseMesh, buildLevelWalls, furnitureFaces, massFaces, massVoidFaces, shownLevelIds, facadeLevelBounds, terrainHeightFn,
} from '../core/mesh3d.js';
import { massGroundFaces } from '../core/mass-ground.js';
import { activeLevel, levelProject, LEVEL_KEYS, sortedLevels } from '../core/model.js';
import {
  axisDelta, cameraBasis, pickBoxes, pickFaces, pickObject, pickWall, projectPoint, rayPlaneZ, screenRay,
} from '../core/pick3d.js';
import {
  GRIP_LABEL, applyGrip, applyGripValue, findWallRecord, gripFor, gripValue,
} from '../core/wall-edit3d.js';
import { el, toast } from './dom.js';
import { PROJECT_REPLACED_EVENT } from './files.js';
import { walkPickFaces, walkSpawnAt, walkWorld } from '../core/walk3d.js';
import { createWalkController } from './walk3d.js';
import { syncLibraryOpen } from './library.js';
import { closeLibrarySheet } from './mobile.js';
import { closeElevation } from './elevation-view.js';
import { switchLevel } from './levels.js';
import { closeSection, openSectionId } from './landscape-section.js';
import { closeSheet } from './sheet-view.js';
import { addFurnitureAt, reconcileOpenings } from './plan-actions.js';
import { state } from './state.js';
import {
  afterChange, pushHistory, refreshDerived, reflowLayoutChanges, restoreFrom, snapshot,
} from './store.js';
import { cancelTool, selectObject, setTool } from './tools.js';
import {
  bindMassNum, cancelMassDrag, clearMassHover, closeMassNum, debugMass3d, finishMassDrag, initMass3d, massBoxes,
  massDblClick, massDragging, massHover, massHoverAt, massNumOpen, massOverlay, massPartAt, massToolBack, massVoidBoxes,
  massToolClick, massToolHint, massToolMove, massToolOn, moveMassDrag, resetMassTool, selectedMassHit, startMassDrag,
} from './mass3d.js';
import { bindFacadeToWall, createCanopyLight, createFacadeElement, fitFacadeBand } from '../core/facade.js';
import { composingFacade, compositionMenu, facadeComposer } from './facade-compositions.js';
import { FACADE_ELEMENTS } from '../data/facade-catalog.js';
import { massBox } from '../core/masses.js';
import { addMass, massById, massIsVoid } from './masses.js';
import { pickMass } from '../core/pick3d.js';
import {
  bindRoofNum, cancelRoofDrag, clearRoofHover, closeRoofNum, debugRoof3d, finishRoofDrag, initRoof3d, moveRoofDrag,
  resetRoofTool, roofDblClick, roofDragging, roofHoverAt, roofNumOpen, roofOverlay, roofPartAt, roofToolClick,
  roofToolMove, roofToolOn, startRoofDrag,
} from './roof3d.js';
import {
  cancelOpeningResize, debugOpening3d, finishOpeningResize, initOpening3d, moveOpeningResize, openingHandleAt,
  openingOverlay, openingResizeDragging, openingSelectionHint, openingToolClick, openingToolHint, openingToolMove, openingToolOn,
  rehoverOpeningTool, resetOpeningTool, startOpeningResize,
} from './opening3d.js';
import {
  cancelObjectGizmoDrag, clearObjectGizmoHover, debugObjectGizmo3d, finishObjectGizmoDrag, initObjectGizmo3d,
  moveObjectGizmoDrag, objectGizmoDragging, objectGizmoHover, objectGizmoOverlay, objectGizmoPartAt, startObjectGizmoDrag,
  visibleObjectGizmoAxes,
} from './object-gizmo3d.js';

import { cancelStairShapeDrag, initStairShape3d, stairShapeDragging, updateStairShapeHandles } from './stair-shape.js';
import { stairClickSelection } from '../core/stair-shape.js';

// dist — масштаб ортографического вида; eyeDist — физическое расстояние до
// камеры. Их нельзя связывать: при сильном приближении камера иначе входит в
// дом, и ближняя плоскость начинает срезать стены.
const cam = {
  yaw: -2.2, pitch: 0.62, dist: 25000, eyeDist: 50000,
  projection: 'orthographic', target: { x: 0, y: 0, z: 1500 },
};
const layerPreferences = { roof: true, site: true, terrainScale: 1, landscape: true, furniture: true, levels: 'all', masses: true, evening: false };
let opts = layerPreferences;
let interior = null;
let walk = null;
let walkPrevious = null;
let walkPlacement = null;
const LAYERS_KEY = 'kepler-3d-layers'; // запомненные слои: мебель, этажи, массы
const LEVEL_MODES = new Set(['all', 'upto', 'only']);
let frontFacade = null;
let pickedWindowFace = null;
const choosingFacadeWall = () => state.tool?.kind === 'choose-facade-wall';

function loadLayers() {
  try {
    const raw = JSON.parse(localStorage.getItem(LAYERS_KEY) || 'null');
    if (raw && typeof raw.furniture === 'boolean') opts.furniture = raw.furniture;
    if (raw && typeof raw.roof === 'boolean') opts.roof = raw.roof;
    if (raw && LEVEL_MODES.has(raw.levels)) opts.levels = raw.levels;
    if (raw && typeof raw.masses === 'boolean') opts.masses = raw.masses;
    if (raw && typeof raw.evening === 'boolean') opts.evening = raw.evening;
    if (raw && ['perspective', 'orthographic'].includes(raw.projection)) cam.projection = raw.projection;
  } catch { /* нет хранилища — по умолчанию */ }
}

function saveLayers() {
  if (interior || walk?.active || walk?.choosing) return; // временные настройки ракурса не меняют предпочтения пользователя
  try {
    const prev = JSON.parse(localStorage.getItem(LAYERS_KEY) || 'null') || {}; // и флажок «Магнит масс» (ui/mass3d.js)
    localStorage.setItem(LAYERS_KEY, JSON.stringify({
      ...prev, roof: opts.roof, furniture: opts.furniture, levels: opts.levels, masses: opts.masses, evening: opts.evening,
      projection: frontFacade?.previous.projection ?? cam.projection,
    }));
  } catch { /* нет хранилища */ }
}
let faces = [];
let facadeApertures = [];
let facadePreview = null;
let composer;
const facadeToolOn = () => state.tool?.kind === 'place-facade';
let active = false;
let gl = null; // WebGL-контекст (null — рисуем через canvas 2D)
let glState = null; // программа, атрибуты, буферы
let use2d = false;
let drawQueued = false;
let geomDirty = false; // перекраска выбора — пересобрать буферы перед кадром
let pendingSceneRefresh = null; // точечная причина следующего afterChange → refresh3d
const rebuildStats = { full: 0, furniture: 0 };
const pointers = new Map();
let gesture = null;

const camera = (width, height) => cameraBasis(cam, width, height);
const worldPerPixel = (width, height) => {
  const c = camera(width, height);
  return (cam.projection === 'perspective' ? cam.eyeDist : cam.dist) / c.focal;
};

// ---------------------------------------------------------------- выбор стен

const SEL_COLOR = '#a9c8ef'; // выбранная стена
const SEL_FILL = '#8db4e8'; // выбранные пол, предмет, лестница
const SEL_OPENING = '#5b94dd'; // коробка выбранного проёма (полупрозрачная)
const GRIP_COLOR = '#5b94dd'; // грань-ручка под мышью / в жесте
const HOVER_OBJECT = '#62b9ff'; // объект, который будет выбран кликом
const CLICK_SLOP = 5; // px — дальше это вращение, а не клик
const HOLD_MS = 450; // удержание пальцем — перетаскивание ручки
let sets = null; // коробки стен и проёмов, грани для луча (кеш до пересборки)
let hover = null; // { key, level, face, normal, kind } — ручка выбранной стены под мышью
let objectHover = null; // ближайший выбираемый объект под курсором
let massVoidHoverId = null; // невидимый cutter подсвечивается только под курсором
let edit = null; // жест правки стены

// Рабочая модель доступна из любого вида проекта.
const wallsEditable = () => !state.editLocked;

function selectedRef() {
  const sel = state.selection;
  return sel?.type === 'wall' && state.project ? { key: sel.key, level: state.project.activeLevel } : null;
}

const refMatches = (ref, sel) => Boolean(ref && sel && ref.level === sel.level && (ref.key === sel.key || ref.keys?.includes(sel.key)));
const sameNormal = (a, b) => a && b && a.x === b.x && a.y === b.y && a.z === b.z;

// Выбор активного этажа, кроме стены: { type, id, level }.
function selectedObject() {
  const sel = state.selection;
  if (!state.project || !sel || !['room', 'item', 'opening'].includes(sel.type)) return null;
  return { type: sel.type, id: sel.id, level: state.project.activeLevel };
}

const SEL_MASS = '#5b94dd'; // выбранная масса
const HOVER_MASS = '#ff9f1c'; // грань выбранной массы под мышью / в жесте

const massFaceHot = (face) => {
  const h = massHover();
  return Boolean(h && h.id === face.massId && h.face === face.face);
};

// Выбранная крыша-плита — цвет материала с примесью акцента.
function mixHex(a, b, t) {
  const p = hexRgb(a); const q = hexRgb(b);
  return `#${p.map((c, i) => Math.round(c + (q[i] - c) * t).toString(16).padStart(2, '0')).join('')}`;
}

function faceColor(face) {
  if (face.kind === 'overlay') return face.color;
  if (face.siteEntryId && state.selection?.type === 'site' && state.selection.kind === 'entry' && state.selection.id === face.siteEntryId) {
    return mixHex(face.color, '#66d39a', 0.58);
  }
  if (face.landscapeId && state.selection?.type === 'landscape' && state.selection.ids?.includes(face.landscapeId)) {
    return mixHex(face.color, '#66d39a', !state.selection.part || face.stairPart === state.selection.part ? 0.58 : 0.18);
  }
  if (face.entranceId && state.selection?.type === 'entrance' && state.selection.id === face.openingId) return mixHex(face.color, '#66d39a', !state.selection.part || face.stairPart === state.selection.part ? 0.58 : 0.18);
  if (face.roofId && state.selection?.type === 'roof' && state.selection.id === face.roofId) return mixHex(face.color, SEL_FILL, 0.5);
  if (face.kind === 'mass') {
    const sel = state.selection?.type === 'mass' && state.selection.id === face.massId;
    if (sel && face.facadeKind) return mixHex(face.color, SEL_MASS, 0.22);
    if (sel && massFaceHot(face)) return HOVER_MASS;
    if (objectHover?.type === 'mass' && objectHover.id === face.massId && !sel) return mixHex(face.color, HOVER_OBJECT, 0.5);
    return sel ? SEL_MASS : face.color;
  }
  const obj = selectedObject();
  if (obj && face.level === obj.level) {
    if (obj.type === 'room' && face.kind === 'floor' && face.roomId === obj.id) return SEL_FILL;
    if (obj.type === 'item' && face.itemId === obj.id) return SEL_FILL;
  }
  if (obj?.type === 'opening' && face.openingId === obj.id) return SEL_OPENING;
  const rsel = state.selection;
  if (rsel?.type === 'slab' && face.slabOpeningId === rsel.id && face.level === rsel.levelId) return SEL_FILL;
  if (rsel?.type === 'railing' && face.railing && face.railing.id === rsel.id && face.railing.roomId === rsel.roomId &&
    face.level === state.project?.activeLevel) return SEL_FILL;
  if (objectHover) {
    const hot = (objectHover.type === 'room' && face.kind === 'floor' && face.roomId === objectHover.id)
      || (objectHover.type === 'item' && face.itemId === objectHover.id)
      || (objectHover.type === 'opening' && face.openingId === objectHover.id)
      || (objectHover.type === 'entrance' && face.entranceId && face.openingId === objectHover.id)
      || (objectHover.type === 'landscape' && face.landscapeId === objectHover.id)
      || (objectHover.type === 'roof' && face.roofId === objectHover.id)
      || (objectHover.type === 'mass' && face.massId === objectHover.id)
      || (objectHover.type === 'slab' && face.slabOpeningId === objectHover.id && face.level === objectHover.levelId)
      || (objectHover.type === 'railing' && face.railing?.id === objectHover.id && face.railing?.roomId === objectHover.roomId);
    if (hot) return mixHex(face.color, HOVER_OBJECT, 0.62);
  }
  if (face.kind !== 'wall' || !face.ref) return face.color;
  const sel = selectedRef();
  if (!refMatches(face.ref, sel)) {
    return objectHover?.type === 'wall' && refMatches(face.ref, { key: objectHover.key, level: objectHover.levelId })
      ? mixHex(face.color, HOVER_OBJECT, 0.56) : face.color;
  }
  if (hover && refMatches(face.ref, hover) && face.ref.face === hover.face && sameNormal(face.normal, hover.normal)) return GRIP_COLOR;
  return SEL_COLOR;
}

function faceAlpha(face) {
  if (face.kind === 'mass' && !face.facadeKind && state.selection?.type === 'mass' && state.selection.id === face.massId) {
    return massFaceHot(face) ? 0.5 : 0.34; // выбранная масса — прозрачная
  }
  // Выбранная крыша — полупрозрачная: под ней читаются стены и свой контур.
  if (face.roofId && state.selection?.type === 'roof' && state.selection.id === face.roofId && !face.kind?.startsWith('overlay')) {
    return Math.min(face.alpha ?? 1, 0.45);
  }
  return face.alpha ?? 1;
}

function render(now) {
  drawQueued = false;
  const canvas = el('canvas3d');
  if (!active || !canvas) return;
  walk?.frame(now);
  if (!use2d && !gl) initGl(canvas);
  else if (gl && geomDirty) uploadGeometry();
  else if (gl && (['mass', 'roof', 'opening', 'item', 'landscape'].includes(state.selection?.type) || openingToolOn())) uploadOverlay(); // гизмо, призраки и точки — к камере
  if (gl) renderGl(canvas); else render2d(canvas);
  updateMassDims();
  updateStairShapeHandles();
}

// Размеры верхних рёбер и площадь верха выбранной массы (вертикальные — нет).
const massDimEls = [];
function updateMassDims() {
  const host = el('view3d');
  const sel = state.selection?.type === 'mass' && massToolOn() === false
    ? [...massBoxes(), ...massVoidBoxes()].find((b) => b.id === state.selection.id) : null;
  let items = [];
  if (host && sel) {
    const r = host.getBoundingClientRect();
    const z = sel.z1;
    const P = (x, y) => { const q = debug3dScreen({ x, y, z }); return { x: q.x - r.left, y: q.y - r.top }; };
    const cx = (sel.x0 + sel.x1) / 2;
    const cy = (sel.y0 + sel.y1) / 2;
    const w = sel.x1 - sel.x0;
    const d = sel.y1 - sel.y0;
    const mm = (v) => String(Math.round(v));
    items = [
      { p: P(cx, sel.y0), t: mm(w) }, { p: P(cx, sel.y1), t: mm(w) },
      { p: P(sel.x0, cy), t: mm(d) }, { p: P(sel.x1, cy), t: mm(d) },
      { p: P(cx, cy), t: `${(w * d / 1e6).toFixed(1)} м²`, area: true },
    ];
  }
  while (massDimEls.length < items.length) {
    const div = document.createElement('div');
    div.className = 'view3d-dim';
    host?.appendChild(div);
    massDimEls.push(div);
  }
  massDimEls.forEach((div, i) => {
    const it = items[i];
    div.hidden = !it;
    if (!it) return;
    div.textContent = it.t;
    div.classList.toggle('area', Boolean(it.area));
    div.style.left = `${Math.round(it.p.x)}px`;
    div.style.top = `${Math.round(it.p.y)}px`;
  });
}

// ---------------------------------------------------------------- WebGL

function initGl(canvas) {
  glState = createSceneGL(canvas);
  if (!glState) { use2d = true; return; }
  gl = glState.gl;
  uploadGeometry();
}

// Полая масса обычно полностью невидима. Её невидимый pick-box остаётся
// активным, а заливка и каркас появляются только под курсором либо после
// выбора (когда нужны гизмо и ручки правки).
function massVoidOverlay() {
  if (!opts.masses || !state.project?.massVoids?.length) return [];
  const selected = state.selection?.type === 'mass' ? state.selection.id : null;
  const visible = new Set([selected, massVoidHoverId].filter(Boolean));
  if (!visible.size) return [];
  const out = [];
  for (const f of massVoidFaces(state.project.massVoids)) {
    if (!visible.has(f.voidId)) continue;
    const hot = selected === f.voidId;
    out.push({
      ...f, kind: 'overlay', color: '#ef6c32', alpha: hot ? 0.11 : 0.075,
      twoSided: true, noEdges: true, edges: [],
    });
    out.push({
      ...f, kind: 'overlay', color: '#ef6c32', alpha: 0, onTop: true, flat: true, twoSided: true,
      edges: f.pts.map((p, i) => [p, f.pts[(i + 1) % f.pts.length]]),
      edgeRgba: hot ? [0.94, 0.31, 0.08, 1] : [0.94, 0.31, 0.08, 0.9],
    });
  }
  return out;
}

// Наложения поверх сетки: cutters, выбранный проём, призраки и ручки.
const overlays = () => massVoidOverlay().concat(
  facadeOverlay(), composer?.overlay() || [], selectionOverlay(), massOverlay(), roofOverlay(), openingOverlay(), objectGizmoOverlay(),
);

// Выбранный проём — полупрозрачная коробка акцентного цвета в его пустоте.
function selectionOverlay() {
  const obj = selectedObject();
  if (obj?.type !== 'opening') return [];
  const boxes = pickSets()?.openings.filter((q) => q.id === obj.id && q.levelId === obj.level) || [];
  const e = 8; // чуть шире пустоты — видна поверх откосов
  return boxes.flatMap((b) => boxFaces(b.x0 - e, b.y0 - e, b.x1 + e, b.y1 + e, b.z0, b.z1, SEL_OPENING, 'overlay'))
    .map((f) => ({ ...f, alpha: 0.4, twoSided: true }));
}

// Подземная часть массы и «ватерлиния» видны только у ВЫБРАННОЙ массы.
const groundShown = (f) => (f.kind !== 'massUnder' && f.kind !== 'massLine') ||
  (state.selection?.type === 'mass' && state.selection.id === f.massId);

function sceneColor(face) {
  const color = faceColor(face);
  if (!opts.evening || face.emissive || face.kind?.startsWith('overlay')) return color;
  return mixHex(color, '#1c2542', 0.58);
}

function uploadGeometry() {
  if (!gl) return;
  geomDirty = false;
  for (const set of [glState.buffers, glState.under]) if (set) for (const b of Object.values(set)) gl.deleteBuffer(b.buf);
  // Подземная часть масс — отдельно: рисуется сквозь землю (GREATER).
  glState.buffers = sceneBuffers(gl, faces.filter((f) => f.kind !== 'massUnder' && groundShown(f)), sceneColor, faceAlpha);
  glState.under = sceneBuffers(gl, faces.filter((f) => f.kind === 'massUnder' && groundShown(f)), faceColor, faceAlpha);
  uploadOverlay();
}

// Только наложения (призрак и ручки масс) — без пересборки всего дома;
// onTop (гизмо и точки массы) — отдельно, поверх сцены без теста глубины.
function uploadOverlay() {
  if (!gl) return;
  for (const set of [glState.over, glState.top]) if (set) for (const b of Object.values(set)) gl.deleteBuffer(b.buf);
  const list = overlays();
  glState.over = sceneBuffers(gl, list.filter((f) => !f.onTop), faceColor, faceAlpha);
  glState.top = sceneBuffers(gl, list.filter((f) => f.onTop), faceColor, faceAlpha);
}

function renderGl(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
  }
  drawSceneGL(glState, cam, width, height, opts.evening ? [0.11, 0.15, 0.23] : undefined);
}

// ---------------------------------------------------------------- canvas 2D

function render2d(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const sky = ctx.createLinearGradient(0, 0, 0, height);
  sky.addColorStop(0, opts.evening ? '#171d31' : '#dfe9f5');
  sky.addColorStop(1, opts.evening ? '#303c55' : '#f7f9fb');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, width, height);

  const c = camera(width, height);
  const near = 100;
  const list = [];
  geomDirty = false;
  for (const face of faces.concat(overlays())) {
    if (!groundShown(face)) continue; // подземная часть — только у выбранной массы
    let P = face.pts.map(W);
    const centroid = P.reduce((s, p) => ({ x: s.x + p.x / P.length, y: s.y + p.y / P.length, z: s.z + p.z / P.length }), { x: 0, y: 0, z: 0 });
    const toEye = sub(c.eye, centroid);
    let n;
    if (face.twoSided) {
      n = polyNormal(P);
      if (dot(n, toEye) < 0) n = { x: -n.x, y: -n.y, z: -n.z };
    } else {
      n = W(face.normal);
      if (dot(n, toEye) <= 0) continue; // задняя грань
    }
    const pts = [];
    let depth = 0;
    let behind = false;
    // Внутри комнаты большие стены пересекают ближнюю плоскость камеры.
    // В Canvas-fallback обрезаем многоугольник, сохраняя видимую часть стены.
    if (walk?.active) {
      const clipped = [];
      for (let i = 0; i < P.length; i++) {
        const a = P[i], b = P[(i + 1) % P.length];
        const da = dot(sub(a, c.eye), c.f), db = dot(sub(b, c.eye), c.f);
        if (da >= near) clipped.push(a);
        if ((da >= near) !== (db >= near)) {
          const t = (near - da) / (db - da);
          clipped.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t });
        }
      }
      P = clipped;
      if (P.length < 3) continue;
    }
    for (const p of P) {
      const d = sub(p, c.eye);
      const zc = dot(d, c.f);
      if (zc < near - 0.001) { behind = true; break; }
      pts.push(projectPoint(cam, width, height, W(p)));
      depth += zc;
    }
    if (behind) continue;
    const light = face.flat ? 1 : 0.6 + 0.4 * Math.max(0, dot(n, LIGHT));
    const [r, g, b] = hexRgb(sceneColor(face));
    const edgePts = !walk?.active && Array.isArray(face.edges) ? face.edges.map(([a0, b0]) => [a0, b0].map((raw) => {
      return projectPoint(cam, width, height, raw);
    })) : null;
    const er = face.edgeRgba;
    list.push({
      pts, edgePts, noEdges: face.noEdges, depth: depth / P.length, kind: face.kind, onTop: face.onTop, order: list.length,
      fill: `rgba(${Math.round(r * light)},${Math.round(g * light)},${Math.round(b * light)},${faceAlpha(face)})`,
      stroke: er ? `rgba(${Math.round(er[0] * 255)},${Math.round(er[1] * 255)},${Math.round(er[2] * 255)},${er[3]})` : null,
    });
  }
  // Земля, затем подземная часть масс (видна сквозь землю), граница, дом;
  // гизмо и точки массы — последними, в порядке списка.
  const layer = (it) => (it.onTop ? 4 : it.kind === 'ground' ? 0 : it.kind === 'massUnder' ? 1 : it.kind === 'boundary' ? 2 : 3);
  list.sort((a, b) => layer(a) - layer(b) || (a.onTop ? a.order - b.order : b.depth - a.depth));
  ctx.lineJoin = 'round';
  for (const it of list) {
    ctx.beginPath();
    it.pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.closePath();
    ctx.fillStyle = it.fill;
    ctx.fill();
    if (it.edgePts) {
      ctx.strokeStyle = it.stroke || 'rgba(30,38,48,0.48)';
      ctx.lineWidth = 0.75;
      ctx.beginPath();
      for (const [a, b] of it.edgePts) { ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); }
      ctx.stroke();
    } else if (EDGE_KINDS.has(it.kind) && !it.noEdges) {
      ctx.strokeStyle = 'rgba(30,38,48,0.22)';
      ctx.lineWidth = 0.6;
      ctx.stroke();
    }
  }
}

function requestRender() {
  if (drawQueued) return;
  drawQueued = true;
  requestAnimationFrame(render);
}

function houseBounds() {
  const isHouse = (face) => ['wall', 'floor', 'mass', 'roof'].includes(face.kind);
  const subjects = faces.some(isHouse) ? isHouse : (face) => face.kind !== 'ground';
  const hasSubjects = faces.some(subjects);
  let x0 = Infinity, y0 = Infinity, z0 = Infinity;
  let x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
  for (const face of faces) {
    if (hasSubjects && !subjects(face)) continue;
    for (const p of face.pts) {
      x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x);
      y0 = Math.min(y0, -p.y); y1 = Math.max(y1, -p.y);
      z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z);
    }
  }
  if (!Number.isFinite(x0)) return null;
  return { x: (x0 + x1) / 2, y: (y0 + y1) / 2, z: (z0 + z1) / 2, w: x1 - x0, d: y1 - y0, h: z1 - z0, top: z1 };
}

function frameHouse() {
  const bounds = houseBounds();
  if (!bounds) return;
  cam.target = { x: bounds.x, y: bounds.y, z: bounds.top / 3 };
  const span = Math.hypot(bounds.w, bounds.d, bounds.h);
  cam.dist = Math.min(400000, Math.max(8000, span * 1.1));
  cam.eyeDist = Math.max(15000, span * 1.8);
}

// Вид изнутри использует обычную сцену и тот же выбор объектов. Меняются
// только её слои и камера; геометрия и настройки проекта остаются общими.
function enterInterior() {
  if (interior) return;
  if (state.tool) cancelTool();
  selectObject(null);
  interior = { camera: structuredClone(cam), entryLevel: state.project.activeLevel, framedLevel: null };
  opts = { ...layerPreferences, roof: false, levels: 'only', furniture: true, site: false, masses: false };
  cam.projection = 'orthographic';
  cam.pitch = 1.22;
  cam.yaw = -1.82;
  hover = objectHover = null;
  syncLayerControls();
  refresh3d();
  el('v3InteriorLevel').focus();
}

function frameInterior() {
  const b = houseBounds();
  if (!b) {
    const level = activeLevel(state.project);
    cam.target = { ...cam.target, z: level.elevation + level.height / 2 };
    return;
  }
  const canvas = el('canvas3d');
  const w = Math.max(1, canvas.clientWidth), h = Math.max(1, canvas.clientHeight);
  const sin = Math.abs(Math.sin(cam.yaw)), cos = Math.abs(Math.cos(cam.yaw));
  const across = b.w * sin + b.d * cos;
  const vertical = (b.w * cos + b.d * sin) * Math.abs(Math.sin(cam.pitch)) + b.h * Math.abs(Math.cos(cam.pitch));
  cam.target = { x: b.x, y: b.y, z: b.z };
  cam.dist = Math.max(1600, camera(w, h).focal * Math.max(across / (w * 0.83), vertical / (h * 0.72)));
  cam.eyeDist = Math.max(15000, 2 * Math.hypot(b.w, b.d, b.h));
}

function leaveInterior({ restoreFloor = true } = {}) {
  if (!interior) return;
  const { camera: previous, entryLevel } = interior;
  interior = null;
  opts = layerPreferences;
  cameraProject = state.project;
  Object.assign(cam, previous);
  hover = objectHover = null;
  syncLayerControls();
  syncCameraControls();
  if (restoreFloor && entryLevel !== state.project.activeLevel && state.project.levels.some((l) => l.id === entryLevel)) {
    switchLevel(entryLevel, { planView: false }); // пересобирает вид и снимает выбор
  } else {
    releaseHiddenFurnitureSelection();
    refresh3d();
  }
}

function releaseHiddenFurnitureSelection() {
  if (opts.furniture || state.selection?.type !== 'item') return;
  const item = state.project.items.find((i) => i.id === state.selection.id);
  if (item && item.kind !== 'stairs' && !isStructural(item.kind)) selectObject(null);
}

export function view3dScopeLabel() {
  const name = activeLevel(state.project)?.name || '';
  if (interior) return `Интерьер · ${name}`;
  if (opts.levels === 'only') return name;
  if (opts.levels === 'upto') return `До уровня «${name}»`;
  return 'Вся модель';
}

function syncInteriorControls() {
  const scope = el('v3Scope');
  if (scope) scope.textContent = view3dScopeLabel();
  el('v3InteriorControls').hidden = !interior;
  el('view3d').classList.toggle('editing-interior', Boolean(interior));
  if (!interior) return;
  const select = el('v3InteriorLevel');
  const levels = sortedLevels(state.project);
  if (levels.length !== select.length || levels.some((l, i) => l.id !== select[i].value || l.name !== select[i].text)) {
    select.replaceChildren(...levels.map((l) => new Option(l.name, l.id)));
  }
  select.value = state.project.activeLevel;
}

// Ось камеры совпадает с наружной нормалью. По высоте в кадр входят все
// видимые этажи, чтобы окно можно было потянуть до следующего перекрытия.
function frameFacade(box) {
  const canvas = el('canvas3d');
  const width = canvas.clientWidth || 1, height = canvas.clientHeight || 1;
  const focal = camera(width, height).focal;
  const bounds = houseBounds();
  const along = (box.alongMin + box.alongMax) / 2;
  const horizontal = box.orient === 'h';
  const outside = box.facadeOutward > 0 ? '1' : '0';
  cam.target = {
    x: horizontal ? along : box['x' + outside],
    y: horizontal ? -box['y' + outside] : -along,
    z: bounds?.z ?? (box.wallZ0 + box.wallZ1) / 2,
  };
  cam.yaw = horizontal ? -box.facadeOutward * Math.PI / 2 : box.facadeOutward > 0 ? 0 : Math.PI;
  cam.pitch = 0;
  cam.projection = 'orthographic';
  cam.dist = Math.max(3000, focal * (box.alongMax - box.alongMin) / (width * 0.78),
    focal * (bounds?.h || box.wallZ1 - box.wallZ0) / (height * 0.62));
  cam.eyeDist = Math.max(15000, bounds ? 2 * Math.hypot(bounds.w, bounds.d) : cam.eyeDist);
}

function facadeWallFor(hit, levelId) {
  if (!hit || !state.project) return null;
  if (hit.type === 'wall' && hit.box) {
    const { box, face, normal } = hit;
    return face === 'side' && normal[box.orient === 'h' ? 'y' : 'x'] === box.facadeOutward ? box : null;
  }
  let host = null;
  if (hit.type === 'opening') {
    // Обе створки углового окна и этажи витража выбираются одним ID.
    // Для вида используем ту поверхность, по которой пользователь нажал.
    const surface = hit.box ?? (pickedWindowFace?.id === hit.id && pickedWindowFace.levelId === levelId ? pickedWindowFace : null);
    const wall = surface && pickSets().walls.find((b) => b.facadeOutward && b.key === surface.wallKey &&
      b.levelId === surface.wallLevelId && b.from === surface.wallFrom);
    if (wall) return wall;
    const opening = levelProject(state.project, levelId).openings.find((o) => o.id === hit.id);
    if (opening) host = { ...opening, levelId };
  } else if (hit.type === 'mass') {
    const part = massById(hit.id);
    host = part?.facadeHost ?? (part?.canopyId && massById(part.canopyId)?.facadeHost);
  }
  if (!host && hit.type !== 'wall') return null;
  return pickSets().walls.find((box) => box.facadeOutward && (host
    ? box.levelId === host.levelId && box.facadeRoom === host.roomId && box.facadeSide === host.side
    : box.levelId === levelId && box.key === hit.key && (hit.from == null || hit.from === box.from))) || null;
}

// Монтажный отрезок можно начать и на стекле или на облицовке этой стены.
function compositionSurface(event) {
  const hit = pickAt(event);
  if (!hit || (hit.type === 'mass' && !['stone', 'slats'].includes(massById(hit.id)?.facadeKind))) return null;
  const box = facadeWallFor(hit, hit.levelId);
  if (!box?.facadeOutward) return null;
  const ray = rayAt(event);
  const across = box.orient === 'h' ? 'y' : 'x';
  if (ray.d[across] * box.facadeOutward >= -0.000001) return null;
  const plane = box[across + (box.facadeOutward > 0 ? '1' : '0')];
  const t = (plane - ray.o[across]) / ray.d[across];
  const axis = box.orient === 'h' ? 'x' : 'y';
  return t >= 0 ? { box, along: Math.round(ray.o[axis] + t * ray.d[axis]) } : null;
}

function enterFacade(box) {
  frontFacade = { previous: structuredClone(cam), box };
  if (choosingFacadeWall()) cancelTool();
  hover = null;
  objectHover = null;
  frameFacade(box);
  syncCameraControls();
  refreshHighlight();
}

function leaveFacade() {
  if (!frontFacade) return;
  Object.assign(cam, frontFacade.previous);
  frontFacade = null;
  hover = null;
  objectHover = null;
  syncCameraControls();
  refreshHighlight();
}

// Положение наблюдателя над землёй в точке камеры, включая уклон участка.
export function viewFromEyeHeight(yaw = cam.yaw) {
  const bounds = houseBounds();
  if (!active || !bounds) return;
  const canvas = el('canvas3d');
  const w = canvas.clientWidth || 1, h = canvas.clientHeight || 1;
  const focal = camera(w, h).focal;
  const along = Math.cos(yaw), across = Math.sin(yaw);
  const depth = Math.abs(along) * bounds.w + Math.abs(across) * bounds.d;
  const width = Math.abs(across) * bounds.w + Math.abs(along) * bounds.d;
  const distance = depth / 2 + Math.max(4000, focal * width / (w * 0.84), focal * bounds.h / (h * 0.64));
  const ground = terrainHeightFn(state.project, opts.terrainScale);
  const eyeZ = 1650 + (ground?.(bounds.x + along * distance, -bounds.y - across * distance) || 0);
  cam.target = { x: bounds.x, y: bounds.y, z: bounds.z };
  cam.yaw = yaw;
  cam.pitch = Math.atan2(eyeZ - bounds.z, distance);
  cam.eyeDist = Math.hypot(distance, eyeZ - bounds.z);
  cam.projection = 'perspective';
  sets = null;
  syncCameraControls();
  uploadOverlay();
  requestRender();
}

// Ползунок рельефа виден, только когда есть отметки высот.
function syncReliefControl() {
  const wrap = el('v3ReliefWrap');
  if (wrap) wrap.hidden = !(state.project?.site?.terrain?.points?.length >= 3);
}


const HINT_IDLE = 'Тяните, чтобы вращать · Нажмите на объект, чтобы выбрать';
const HINT_OBJ = 'Delete — удалить · Ctrl+C/V/D — копировать/вставить/дублировать · R — повернуть мебель · Esc — снять выбор';
const HINT_SEL = 'Тяните верх стены — высота, бок — сдвиг (Alt — толщина), торец ручной стены — длина · двойной клик по грани — число · Ctrl — без привязки';
const HINT_SEL_TOUCH = 'Удерживайте грань выбранной стены и тяните: верх — высота, бок — сдвиг';
const HINT_SITE = 'Редактирование приостановлено';
const HINT_MASS = 'Масса: стрелки гизмо — переместить · точки — размер · R — повернуть · Delete';
const HINT_MASS_TOUCH = HINT_MASS;
const HINT_ROOF = 'Крыша: точки — вынос (по плоскости плиты), синяя стрелка — высота · двойной клик — число · Shift — без привязки · Delete';
const HINT_ROOF_TOOL = 'Ручная крыша: клик по помещению — накрыть · Shift+клик — добавить к выбранной · клик по крыше — выбрать · Esc — выйти';
const HINT_FURNITURE_TOOL = 'Нажмите на пол, чтобы поставить объект · Пробел — повернуть · Esc — закончить';
let touchUsed = false;

function objectGizmoHint() {
  const axes = visibleObjectGizmoAxes();
  if (!axes) return state.selection?.type === 'landscape' && state.selection.ids?.length > 1
    ? 'Для перемещения в 3D выберите один объект' : '';
  const movement = axes.includes('z')
    ? 'X/Y — по горизонтали · Z — высота · Квадрат — обе оси X/Y'
    : 'X/Y — по участку · Квадрат — обе оси X/Y';
  const touch = touchUsed || window.matchMedia('(pointer: coarse)').matches;
  return movement + (touch ? '' : ' · Shift — без шага · Delete — удалить');
}

function setHint(text) {
  const hint = el('v3Hint');
  if (!hint) return;
  if (walk?.active) { hint.textContent = ''; return; }
  if (walk?.choosing && text === undefined) text = 'Нажмите на землю, пол, балкон или ступень — начать прогулку здесь · Тяните для поворота вида · Esc — отменить';
  if (text === undefined) {
    if (choosingFacadeWall()) text = 'Нажмите на наружную стену или её окно, чтобы открыть фасад';
    else if (!wallsEditable()) text = HINT_SITE;
    else if (composingFacade()) text = composer.prompt();
    else if (facadeToolOn()) text = facadePlacementHint();
    else if (openingToolOn()) text = openingToolHint();
    else if (state.tool?.kind === 'place-furniture') text = HINT_FURNITURE_TOOL;
    else if (massToolOn()) text = massToolHint();
    else if (roofToolOn()) text = HINT_ROOF_TOOL;
    else if (state.selection?.type === 'roof') text = state.selection.id.startsWith('auto-roof:')
      ? 'Связанная крыша · Форма и удаление в свойствах · Для работы внутри скройте слой «Крыша»' : HINT_ROOF;
    else if (state.selection?.type === 'mass') text = touchUsed ? HINT_MASS_TOUCH : HINT_MASS;
    else if (state.selection?.type === 'opening') text = openingSelectionHint();
    else if ((state.selection?.type === 'entrance' || state.selection?.type === 'landscape') && state.selection.part) text = 'Точки в центрах граней — размер · Shift — без шага · Esc — отменить';
    else if (state.selection?.type === 'entrance') text = 'Выбрана вся лестница · нажмите ещё раз на ступень или площадку для её редактирования';
    else if (frontFacade && (!state.selection || selectedRef())) text = 'Выберите окно или отделку для правки · Тяните фон, чтобы сдвинуть вид';
    else if (selectedRef()) text = touchUsed ? HINT_SEL_TOUCH : HINT_SEL;
    else if (state.selection?.type === 'item' || state.selection?.type === 'landscape') text = objectGizmoHint();
    else if (selectedObject()) text = HINT_OBJ;
    else text = HINT_IDLE;
  }
  const menu = el('view3d').querySelector('.v3-facade');
  const frontAction = menu.querySelector('[data-facade-front]');
  frontAction.textContent = choosingFacadeWall() ? 'Отменить выбор стены' : 'Редактировать фасад';
  menu.classList.toggle('placing', facadeToolOn() || composingFacade());
  menu.querySelector('[data-facade-cancel]').hidden = !facadeToolOn() && !composingFacade();
  hint.textContent = text;
  if (composingFacade()) composer.showFit(hint);
  else composer?.reset();
}

// Подсветка выбора и ручки: перекраска граней (к следующему кадру).
function refreshHighlight() {
  geomDirty = true;
  requestRender();
  setHint();
}

// Выбор сменился (план, «Свойства», клавиши) — открытый 3D перекрашивается.
export function refresh3dSelection() {
  if (!active || edit || massDragging() || roofDragging() || openingResizeDragging() || objectGizmoDragging()) return;
  refreshHighlight();
}

// Esc в 3D: сначала ввод числа, жест правки, стадия инструмента «Масса»,
// выбор; true — Esc поглощён, иначе (выбора нет) вид можно закрыть.
export function escape3d() {
  if (!active) return false;
  if (walk?.active || walk?.choosing) { leaveWalk(); return true; }
  if (stairShapeDragging()) { cancelStairShapeDrag(); return true; }
  if (numTarget) { hideNumber(); setHint(); return true; }
  if (massNumOpen()) { closeMassNum(); setHint(); return true; }
  if (roofNumOpen()) { closeRoofNum(); setHint(); return true; }
  if (choosingFacadeWall()) { cancelTool(); setHint(); return true; }
  if (openingResizeDragging()) { cancelOpeningResize(); return true; }
  if (openingToolOn()) {
    cancelTool();
    resetOpeningTool();
    document.dispatchEvent(new CustomEvent('kepler:opening-tool'));
    setHint();
    uploadOverlay();
    requestRender();
    return true;
  }
  if (facadeToolOn() || composingFacade() || state.tool?.kind === 'place-furniture') {
    facadePreview = null;
    cancelTool();
    uploadOverlay();
    requestRender();
    setHint();
    return true;
  }
  if (roofDragging()) { cancelRoofDrag(); return true; }
  if (objectGizmoDragging()) { cancelObjectGizmoDrag(); return true; }
  if (roofToolOn()) {
    cancelTool();
    resetRoofTool();
    setMassLabel(null);
    document.dispatchEvent(new CustomEvent('kepler:roof-tool'));
    setHint();
    uploadOverlay();
    requestRender();
    return true;
  }
  if (edit) { cancelEdit(); return true; }
  if (massDragging()) { cancelMassDrag(); return true; }
  if (massToolOn()) {
    if (!massToolBack()) {
      cancelTool();
      document.dispatchEvent(new CustomEvent('kepler:mass-tool'));
    }
    setHint();
    uploadOverlay();
    requestRender();
    return true;
  }
  if (frontFacade) { leaveFacade(); return true; }
  if (interior && !state.selection) { leaveInterior(); el('view3d').querySelector('.v3-views summary').focus(); return true; }
  if (state.selection) {
    selectObject(null);
    hover = null;
    refreshHighlight();
    return true;
  }
  return false;
}

function syncLayerControls() {
  const roof = el('v3Roof');
  if (roof) roof.checked = opts.roof;
  const furn = el('v3Furniture');
  if (furn) furn.checked = opts.furniture;
  const lv = el('v3Levels');
  if (lv) lv.value = opts.levels;
  const ms = el('v3Masses');
  if (ms) ms.checked = opts.masses;
  const evening = el('v3Evening');
  if (evening) evening.checked = opts.evening;
}

function syncCameraControls() {
  syncInteriorControls();
  el('view3d').classList.toggle('editing-facade', Boolean(frontFacade));
  el('v3ExitFacade').hidden = !frontFacade;
  for (const button of document.querySelectorAll('[data-v3-projection]')) {
    const activeProjection = button.dataset.v3Projection === cam.projection;
    button.classList.toggle('active', activeProjection);
    button.setAttribute('aria-pressed', String(activeProjection));
  }
}

// Флажок «Массы» виден, когда массы есть или идёт инструмент «Масса».
function syncMassControl() {
  const hasMasses = Boolean(state.project?.masses?.length || state.project?.massVoids?.length);
  const wrap = el('v3MassesWrap');
  if (wrap) wrap.hidden = !(hasMasses || massToolOn());
  const snap = el('v3MassSnapWrap');
  if (snap) snap.hidden = !(hasMasses || massToolOn());
}

// Пересобрать только грани масс (жест правки массы).
// Подземная часть (рельеф и «Участок») пересобирается вместе с ними.
const MASS_KINDS = new Set(['mass', 'massUnder', 'massLine']);
function rebuildMasses() {
  const facadeClip = facadeLevelBounds(state.project, opts.levels);
  const list = state.project?.masses || [];
  sets = null;
  const hz = opts.masses && opts.site && list?.length ? terrainHeightFn(state.project, opts.terrainScale) : null;
  faces = faces.filter((f) => !MASS_KINDS.has(f.kind))
    .concat(opts.masses ? massFaces(list, { voids: state.project?.massVoids || [], apertures: facadeApertures, facadeClip }) : [], hz ? massGroundFaces(list, hz, { facadeClip }) : []);
}

// Полая масса влияет не только на слой масс, но и на стены, полы и плиты,
// поэтому во время её жеста перестраивается вся сцена.
function rebuildScene() {
  facadeApertures = [];
  faces = buildHouseMesh(state.project, { ...opts, roofs: opts.roof, facades: opts.masses, facadeApertures });
  sets = null;
  rebuildStats.full += 1;
  if (walk?.active) walk.scene(walkWorld(faces, terrainHeightFn(state.project, opts.terrainScale)));
  if (walk?.choosing) updateWalkPlacementScene();
}

function updateWalkPlacementScene() {
  walkPlacement = { world: walkWorld(faces, terrainHeightFn(state.project, opts.terrainScale)), faces: walkPickFaces(faces) };
  el('v3WalkStart').hidden = true;
}

function previewWalkPlacement(event) {
  if (!walk?.choosing || !walkPlacement) return null;
  const start = walkSpawnAt(walkPlacement.world, walkPlacement.faces, rayAt(event), cam.yaw);
  const marker = el('v3WalkStart');
  marker.hidden = !start;
  if (start) {
    setHint();
    const p = debug3dScreen(start), rect = el('view3d').getBoundingClientRect();
    marker.style.left = `${p.x-rect.left}px`; marker.style.top = `${p.y-rect.top}px`;
  }
  el('canvas3d').style.cursor = start ? 'crosshair' : 'not-allowed';
  return start;
}

function startWalkAt(event) {
  const start = previewWalkPlacement(event);
  if (!start) { setHint('Здесь нельзя встать. Выберите свободное место на земле, полу, балконе или ступени · Esc — отменить'); return; }
  const previous = { opts, interior, frontFacade };
  interior = null; frontFacade = null;
  opts = { ...opts, levels: 'all', roof: true, site: true, landscape: true, furniture: true, masses: true };
  rebuildScene();
  const world = walkWorld(faces, terrainHeightFn(state.project, opts.terrainScale));
  if (world.blocked(start.x, start.y, start.z)) {
    ({ opts, interior, frontFacade } = previous); rebuildScene(); uploadGeometry(); requestRender();
    setHint('В этом месте недостаточно пространства для персонажа. Выберите другую точку · Esc — отменить'); return;
  }
  walkPlacement = null; el('v3WalkStart').hidden = true;
  for (const details of el('view3d').querySelectorAll('details')) details.open = false;
  walk.start(world, start);
  el('canvas3d').style.cursor = '';
  syncLayerControls(); syncCameraControls(); uploadGeometry(); requestRender(); setHint();
}

function enterWalk() {
  if (walk.active || walk.choosing) { leaveWalk(); return; }
  cancelStairShapeDrag();
  if (edit) cancelEdit();
  if (massDragging()) cancelMassDrag();
  if (roofDragging()) cancelRoofDrag();
  if (objectGizmoDragging()) cancelObjectGizmoDrag();
  if (openingResizeDragging()) cancelOpeningResize();
  if (gesture?.hold) clearTimeout(gesture.hold);
  gesture = null; pointers.clear();
  cancelTool(); resetMassTool(); resetRoofTool(); resetOpeningTool();
  hideNumber(); closeMassNum(); closeRoofNum();
  selectObject(null);
  hover = null; objectHover = null; facadePreview = null; massVoidHoverId = null;
  setMassLabel(null);
  walkPrevious = { cam: { ...cam, target: { ...cam.target } }, opts, interior, frontFacade };
  opts = { ...opts, site: true };
  rebuildScene();
  for (const details of el('view3d').querySelectorAll('details')) details.open = false;
  walk.choose(); updateWalkPlacementScene();
  el('canvas3d').style.cursor = 'crosshair';
  syncLayerControls(); syncCameraControls(); uploadGeometry(); requestRender(); setHint();
}

function leaveWalk({ focus = true } = {}) {
  if (!walk?.active && !walk?.choosing) return;
  walk.stop();
  walkPlacement = null; el('v3WalkStart').hidden = true;
  gesture = null; pointers.clear(); el('canvas3d').style.cursor = '';
  Object.assign(cam, walkPrevious.cam);
  ({ opts, interior, frontFacade } = walkPrevious); walkPrevious = null;
  syncLayerControls(); refresh3d();
  if (focus) el('v3Walk').focus({ preventScroll: true });
}

// Обычная мебель не меняет стены, полы, крышу и участок. При постановке из
// 3D обновляем только её слой текущего этажа; полный buildHouseMesh на
// большом доме здесь был заметно дороже самой операции добавления.
function rebuildFurnitureLevel(levelId) {
  faces = faces.filter((face) => !(face.kind === 'furniture' && face.level === levelId));
  const shown = new Set(shownLevelIds(state.project, opts.levels));
  const level = (state.project?.levels || []).find((candidate) => candidate.id === levelId);
  if (opts.furniture && level && shown.has(levelId)) {
    const lp = levelProject(state.project, levelId);
    faces.push(...furnitureFaces(lp, Number(level.elevation) || 0, Number(level.height) || 3000, levelId));
  }
  sets = null;
  rebuildStats.furniture += 1;
}

// Ручная крыша вырезает связанную автокровлю, поэтому во время жеста они
// пересобираются вместе. Иначе до отпускания мыши оставались дубль или дыра.
function rebuildRoofs() {
  rebuildScene();
}

export function refresh3d() {
  if (!active || edit || massDragging() || roofDragging() || objectGizmoDragging()) return;
  if (interior) cameraProject = state.project; // Undo заменяет объект проекта, камера продолжает показывать его этаж
  syncCameraControls();
  syncReliefControl();
  syncMassControl();
  const pending = pendingSceneRefresh;
  pendingSceneRefresh = null;
  if (pending?.kind === 'furniture') rebuildFurnitureLevel(pending.levelId);
  else rebuildScene();
  if (interior && interior.framedLevel !== state.project.activeLevel) {
    interior.framedLevel = state.project.activeLevel;
    frameInterior();
  }
  uploadGeometry();
  requestRender();
  setHint();
}

let cameraProject = null;
let lastSheetCamera = null;
export function open3d() {
  if (active) return;
  closeSheet();
  if (openSectionId()) closeSection();
  closeElevation();
  if (state.libraryTab === 'rooms') {
    state.libraryPinned = false;
    closeLibrarySheet();
  }
  const supportedTool = massToolOn() || roofToolOn() || openingToolOn() || state.tool?.kind === 'place-furniture';
  if (state.tool && !supportedTool) cancelTool();
  active = true;
  el('view3d').hidden = false;
  document.body.classList.add('v3-open');
  syncLibraryOpen();
  el('view3dBtn')?.classList.add('active');
  syncReliefControl();
  resetMassTool();
  resetOpeningTool();
  if (massToolOn()) opts.masses = true;
  syncLayerControls();
  syncCameraControls();
  syncMassControl();
  rebuildScene();
  hover = null;
  massVoidHoverId = null;
  uploadGeometry();
  if (cameraProject !== state.project) {
    frameHouse();
    cameraProject = state.project;
  }
  requestRender();
  setHint();
  document.dispatchEvent(new CustomEvent('kepler:view')); // дерево видов, «Свойства»
}

export function close3d() {
  cancelStairShapeDrag();
  if (!active) return;
  leaveWalk({ focus: false });
  if (choosingFacadeWall()) cancelTool();
  leaveFacade();
  lastSheetCamera = camera3dSnapshot(); // на лист попадает вид, который был на экране
  leaveInterior();
  pickedWindowFace = null;
  if (edit) cancelEdit();
  if (massDragging()) cancelMassDrag();
  if (roofDragging()) cancelRoofDrag();
  if (objectGizmoDragging()) cancelObjectGizmoDrag();
  resetMassTool();
  resetRoofTool();
  resetOpeningTool();
  if (facadeToolOn() || composingFacade() || state.tool?.kind === 'place-furniture') cancelTool();
  facadePreview = null;
  composer?.reset();
  el('view3d').querySelector('.v3-facade').open = false;
  hideNumber();
  active = false;
  hover = null;
  massVoidHoverId = null;
  el('view3d').hidden = true;
  el('view3d').querySelector('.v3-layers').open = false;
  el('view3d').querySelector('.v3-views').open = false;
  document.body.classList.remove('v3-open');
  el('view3dBtn')?.classList.remove('active');
  document.dispatchEvent(new CustomEvent('kepler:view'));
}

export const is3dOpen = () => active;

export function set3dRoofVisibility(visible) {
  if (visible && interior) leaveInterior({ restoreFloor: false });
  if (opts.roof === visible) return;
  opts.roof = visible;
  if (!visible && state.selection?.type === 'roof') selectObject(null);
  if (objectHover?.type === 'roof') objectHover = null;
  saveLayers();
  syncLayerControls();
  refresh3d();
}

// Снимок камеры для 3D-вида на листе (viewport.cam, core/views.js): углы,
// масштаб окна и крыша. Окно 3D ни разу не открывали — камера по умолчанию.
export function camera3dSnapshot({ capturedOnly = false } = {}) {
  if (!active || cameraProject !== state.project) {
    if (cameraProject === state.project && lastSheetCamera) return structuredClone(lastSheetCamera);
    return capturedOnly ? null : { yaw: -2.2, pitch: 0.62, roof: true };
  }
  const canvas = el('canvas3d');
  return { ...cam, target: { ...cam.target }, ...opts, aspect: canvas.clientWidth / Math.max(1, canvas.clientHeight),
    levelId: state.project.activeLevel };
}

// ---------------------------------------------------------------- луч и ручки

function canvasPoint(e) {
  const r = el('canvas3d').getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top, w: r.width, h: r.height };
}

// Наборы для луча — по показанным этажам; грани — из текущей сетки.
function pickSets() {
  if (!state.project) return null;
  if (!sets) {
    const { walls, openings } = pickBoxes(state.project, shownLevelIds(state.project, opts.levels));
    sets = { walls, openings, faces: pickFaces(faces) };
  }
  return sets;
}

function pickAt(e) {
  if (!state.project || !wallsEditable()) return null;
  const c = canvasPoint(e);
  return pickObject(pickSets(), screenRay(cam, c.w, c.h, c.x, c.y));
}

function rayAt(e) {
  const c = canvasPoint(e);
  return screenRay(cam, c.w, c.h, c.x, c.y);
}

// Размещение использует видимый наружный бок стены и высоту этого участка.
function facadePlacementHint() {
  const kind = state.tool.facadeKind;
  if (kind === 'band') return 'Пояс от угла до угла · Нажмите на фасад на нужной высоте';
  if (kind === 'light') return 'Подсветка · Нажмите на навес для линии под кромкой или на стену для отдельной полосы';
  return FACADE_ELEMENTS[kind].name + ' · Нажмите на наружную сторону стены';
}

const bandPreviewContexts = new WeakMap();
function facadeAt(e, attach = false) {
  const visible = pickAt(e);
  let wall = visible;
  let point = visible?.point;
  if (visible?.type === 'mass') {
    const finish = massById(visible.id);
    if (finish?.facadeKind === 'canopy' && state.tool.facadeKind === 'light') {
      return createCanopyLight(finish);
    }
    if (!['slats', 'stone'].includes(finish?.facadeKind) || !finish.facadeHost ||
        !['canopy', 'band', 'light'].includes(state.tool.facadeKind)) return null;
    const ray = rayAt(e);
    wall = pickWall(pickSets().walls, ray);
    if (!wall || wall.box.facadeRoom !== finish.facadeHost.roomId || wall.box.facadeSide !== finish.facadeHost.side ||
        visible.normal?.[wall.orient === 'h' ? 'y' : 'x'] !== wall.box.facadeOutward) return null;
    point = { x: ray.o.x + ray.d.x * visible.t, y: ray.o.y + ray.d.y * visible.t, z: ray.o.z + ray.d.z * visible.t };
  } else if (visible?.type !== 'wall') return null;
  if (wall.face !== 'side' || !wall.box.facadeOutward || wall.normal[wall.orient === 'h' ? 'y' : 'x'] !== wall.box.facadeOutward) return null;
  const m = createFacadeElement(state.tool.facadeKind, {
    point, normal: wall.normal, from: wall.box.alongMin, to: wall.box.alongMax,
    level: { elevation: wall.box.wallZ0, height: wall.box.wallZ1 - wall.box.wallZ0 },
  });
  if (!m || (!attach && m.facadeKind !== 'band')) return m;
  bindFacadeToWall(state.project, m, wall.levelId, wall.box.facadeRoom, wall.box.facadeSide);
  if (m.facadeKind === 'band' && m.facadeHost) {
    if (!bandPreviewContexts.has(sets)) bandPreviewContexts.set(sets, new Map());
    const along = wall.orient === 'h' ? point.x : point.y;
    const center = wall.orient === 'h' ? m.x : m.y;
    const ratio = (m.facadeHost.along + along - center) / m.facadeHost.span;
    if (!fitFacadeBand(state.project, m, ratio, bandPreviewContexts.get(sets), state.walls)) return null;
  }
  return m;
}

function facadeOverlay() {
  if (!facadePreview || !facadeToolOn()) return [];
  const b = massBox(facadePreview);
  const soffit = Boolean(facadePreview.canopyId);
  return boxFaces(b.x0, b.y0, b.x1, b.y1, b.z0, b.z1, soffit ? '#ffe199' : '#69bd91', 'overlay')
    .map((f) => ({ ...f, alpha: soffit ? 0.85 : 0.32, onTop: soffit, flat: soffit, twoSided: true }));
}

function placeFacade(e) {
  const m = facadeAt(e, true);
  if (!m) { setHint(facadePlacementHint()); return; }
  facadePreview = null;
  cancelTool();
  if (m.canopyId) {
    const existing = state.project.masses?.find((light) => light.canopyId === m.canopyId);
    if (existing) {
      selectObject({ type: 'mass', id: existing.id });
      setHint('Здесь уже есть подсветка · Цвет света можно изменить в свойствах');
      return;
    }
  }
  addMass(m);
  setHint(m.name + ' · Стрелки — положение, точки — размер');
}

function furniturePoint(e) {
  const hit = pickAt(e);
  if (hit?.levelId && hit.levelId !== state.project.activeLevel) switchLevel(hit.levelId, { planView: false });
  const level = activeLevel(state.project);
  return rayPlaneZ(rayAt(e), Number(level?.elevation) || 0);
}

function placeFurniture3d(e, kind = state.tool?.itemKind, options = state.tool || {}) {
  const point = furniturePoint(e);
  if (!kind || !point) return false;
  // addFurnitureAt → mutate → afterChange сам вызывает refresh3d. Помечаем
  // безопасный частичный сценарий до mutate, чтобы не собирать всю сцену;
  // лестница и конструктивные элементы по-прежнему требуют полной сборки.
  const levelId = state.project.activeLevel;
  if (kind !== 'stairs' && !isStructural(kind)) pendingSceneRefresh = { kind: 'furniture', levelId };
  try {
    addFurnitureAt(kind, point.x, point.y, options.rotation || 0, options);
  } finally {
    pendingSceneRefresh = null;
  }
  setHint('Объект добавлен · выберите следующий в каталоге или нажмите Esc');
  return true;
}

// Массы полупрозрачны и не мешают выбору дома: грань выбранной массы —
// первой, иначе объект дома (ближайший не-масса), масса — когда под курсором
// только она.
function pickWithMass(e) {
  const hit = pickAt(e);
  const solid = massBoxes().filter((m) => !m.facadeKind);
  const voids = massVoidBoxes();
  if ((!solid.length && !voids.length) || !opts.masses || !wallsEditable()) return hit;
  const ray = rayAt(e);
  const own = selectedMassHit(ray);
  if (own && !massById(own.id)?.facadeKind) return { type: 'mass', id: own.id, face: own.face, t: own.t };
  // Cutter приоритетнее геометрии дома: его каркас специально служит
  // постоянной ручкой выбора внутри уже вырезанного объёма.
  const cut = pickMass(voids, ray);
  if (cut) return { type: 'mass', id: cut.id, face: cut.face, t: cut.t };
  if (hit) return hit;
  const m = pickMass(solid, ray);
  return m ? { type: 'mass', id: m.id, face: m.face, t: m.t } : null;
}

const onSelectedWall = (hit) => {
  const sel = selectedRef();
  return Boolean(hit?.type === 'wall' && sel && hit.key === sel.key && hit.levelId === sel.level);
};

function gripAt(hit, e) {
  const grip = onSelectedWall(hit) ? gripFor(hit, { alt: e.altKey }) : null;
  return frontFacade && grip?.kind !== 'height' ? null : grip;
}

const GRIP_CURSOR = { height: 'ns-resize', move: 'move', thickness: 'col-resize', length: 'ew-resize' };

function updateHover(e) {
  if (walk?.choosing) { previewWalkPlacement(e); return; }
  const openingHandle = wallsEditable() ? openingHandleAt(e) : null;
  if (openingHandle) {
    const changed = massVoidHoverId !== null;
    massVoidHoverId = null;
    if (changed) { uploadOverlay(); requestRender(); }
    el('canvas3d').style.cursor = openingHandle.id === 'top' || openingHandle.id === 'bottom' ? 'ns-resize' : 'ew-resize';
    return;
  }
  if (state.selection?.type === 'roof' && wallsEditable()) {
    const r = roofHoverAt(e);
    if (r.changed) { uploadOverlay(); requestRender(); }
    if (r.cursor) {
      if (massVoidHoverId !== null) { massVoidHoverId = null; uploadOverlay(); requestRender(); }
      el('canvas3d').style.cursor = r.cursor;
      return;
    }
  } else if (clearRoofHover()) { uploadOverlay(); requestRender(); }
  if (state.selection?.type === 'mass' && wallsEditable()) {
    const r = massHoverAt(e);
    if (r.changed) { uploadGeometry(); requestRender(); }
    if (r.cursor) {
      if (massVoidHoverId !== null) { massVoidHoverId = null; uploadOverlay(); requestRender(); }
      el('canvas3d').style.cursor = r.cursor;
      return;
    }
  } else if (clearMassHover()) { uploadGeometry(); requestRender(); }
  if (['item', 'landscape'].includes(state.selection?.type) && wallsEditable()) {
    const r = objectGizmoHover(e);
    if (r.changed) { uploadOverlay(); requestRender(); }
    if (r.cursor) {
      if (massVoidHoverId !== null) { massVoidHoverId = null; uploadOverlay(); requestRender(); }
      el('canvas3d').style.cursor = r.cursor;
      return;
    }
  } else if (clearObjectGizmoHover()) { uploadOverlay(); requestRender(); }
  let hit = choosingFacadeWall() ? pickObject(pickSets(), rayAt(e)) : pickWithMass(e);
  if (choosingFacadeWall() && !facadeWallFor(hit, hit?.levelId)) hit = null;
  const nextVoid = hit?.type === 'mass' && massIsVoid(hit.id) ? hit.id : null;
  const voidChanged = nextVoid !== massVoidHoverId;
  massVoidHoverId = nextVoid;
  const grip = gripAt(hit, e);
  const next = grip ? { key: hit.key, level: hit.levelId, face: hit.face, normal: hit.normal, kind: grip.kind } : null;
  const nextObject = hit && SELECTABLE.has(hit.type) ? hit : null;
  const objectSame = (!nextObject && !objectHover) || (nextObject && objectHover
    && nextObject.type === objectHover.type && nextObject.id === objectHover.id
    && nextObject.key === objectHover.key && nextObject.roomId === objectHover.roomId);
  objectHover = nextObject;
  el('canvas3d').style.cursor = grip ? GRIP_CURSOR[grip.kind] : (hit ? 'pointer' : '');
  const same = (!next && !hover) || (next && hover && next.key === hover.key && next.face === hover.face && sameNormal(next.normal, hover.normal));
  hover = next;
  if (!same || !objectSame) uploadGeometry();
  else if (voidChanged) uploadOverlay();
  if (!same || !objectSame || voidChanged) requestRender();
}

// Выбор кликом/тапом: стена, помещение, проём, предмет (пусто — снять
// выбор). Объект другого этажа делает его активным.
const SELECTABLE = new Set(['wall', 'room', 'item', 'opening', 'multi', 'railing', 'slab', 'mass', 'roof', 'landscape', 'site', 'entrance']);

function clickSelect(hit) {
  if (!wallsEditable()) return;
  pickedWindowFace = hit?.type === 'opening' ? hit.box : null;
  const defer = state.touchDeferSelect;
  state.touchDeferSelect = false;
  try {
    if (!hit) {
      if (SELECTABLE.has(state.selection?.type)) selectObject(null);
    } else {
      if (hit.levelId && hit.levelId !== state.project.activeLevel) switchLevel(hit.levelId, { planView: false });
      if (hit.type === 'mass') selectObject({ type: 'mass', id: hit.id });
      else if (hit.type === 'roof') selectObject({ type: 'roof', id: hit.id });
      else if (hit.type === 'landscape' || hit.type === 'entrance') selectObject(stairClickSelection(state.selection, hit));
      else if (hit.type === 'site') selectObject({ type: 'site', kind: 'entry', id: hit.id });
      else if (hit.type === 'wall') selectObject({ type: 'wall', key: hit.key, from: hit.kind === 'manual' ? undefined : hit.from });
      else if (hit.type === 'slab') selectObject({ type: 'slab', levelId: hit.levelId, id: hit.id });
      else if (hit.type === 'railing') selectObject({ type: 'railing', roomId: hit.roomId, id: hit.id });
      else selectObject({ type: hit.type, id: hit.id });
    }
  } finally {
    state.touchDeferSelect = defer;
  }
  hover = null;
  objectHover = null;
  massVoidHoverId = null;
  clearMassHover();
  refreshHighlight();
}

function restoreStart(e) {
  for (const k of LEVEL_KEYS) state.project[k] = structuredClone(e.start[k]);
}

function startEdit(hit, grip, x0, y0) {
  const rec = findWallRecord(state.project, hit.key, hit.kind === 'manual' ? undefined : hit.from);
  if (!rec) return false;
  const levelId = state.project.activeLevel;
  edit = {
    rec, grip, levelId, x0, y0, d: 0, snap: GRID_STEP, changed: false,
    before: snapshot(),
    start: Object.fromEntries(LEVEL_KEYS.map((k) => [k, structuredClone(state.project[k])])),
    base: faces.filter((f) => f.wallsOf !== levelId),
  };
  hover = { key: hit.key, level: hit.levelId, face: hit.face, normal: hit.normal, kind: grip.kind };
  gesture = { kind: 'edit' };
  el('canvas3d').style.cursor = GRIP_CURSOR[grip.kind];
  setHint(`${GRIP_LABEL[grip.kind]}: ${gripValue(state.project, rec, grip)} мм`);
  uploadGeometry();
  requestRender();
  return true;
}

// Кадр жеста: модель — от состояния начала жеста + полное смещение;
// пересобирается только слой стен этажа.
function moveEdit(e) {
  const c = canvasPoint(e);
  const d = axisDelta(cam, c.w, c.h, edit.grip.axis, e.clientX - edit.x0, e.clientY - edit.y0);
  restoreStart(edit);
  edit.snap = e.ctrlKey || e.metaKey ? 0 : GRID_STEP;
  const res = applyGrip(state.project, edit.rec, edit.grip, d, { snap: edit.snap });
  edit.d = d;
  edit.changed = res.ok && !res.unchanged;
  faces = edit.base.concat(buildLevelWalls(state.project, edit.levelId));
  sets = null;
  uploadGeometry();
  requestRender();
  if (!res.ok) { setHint(`Нельзя: ${res.reason}`); return; }
  const g = edit.grip;
  if (g.kind === 'move') {
    const shift = Math.round(edit.snap ? Math.round(d / edit.snap) * edit.snap : d);
    setHint(`Сдвиг: ${shift > 0 ? '+' : ''}${shift} мм`);
  } else {
    const rec = g.kind === 'height' ? edit.rec : findWallRecord(state.project, edit.rec.key, edit.rec.kind === 'manual' ? undefined : edit.rec.from);
    setHint(`${GRIP_LABEL[g.kind]}: ${gripValue(state.project, rec || edit.rec, g)} мм`);
  }
}

// Запись правки: проёмы, производные, одна запись истории, выбор той же стены.
function commitWallChange(before, rec) {
  reconcileOpenings();
  refreshDerived();
  reflowLayoutChanges(before);
  pushHistory(before);
  afterChange();
  const moved = state.walls.find((w) => w.key === rec.key);
  selectObject({ type: 'wall', key: rec.key, from: rec.kind === 'manual' ? undefined : (moved?.from ?? rec.from) });
  refreshHighlight();
}

function finishEdit() {
  const e = edit;
  edit = null;
  gesture = null;
  restoreStart(e);
  if (!e.changed) { refresh3d(); return; }
  const res = applyGrip(state.project, e.rec, e.grip, e.d, { snap: e.snap, finalize: true });
  if (!res.ok || res.unchanged) {
    restoreStart(e);
    if (!res.ok) toast(`Нельзя: ${res.reason}`, true);
    refresh3d();
    return;
  }
  commitWallChange(e.before, e.rec);
}

function cancelEdit() {
  const e = edit;
  edit = null;
  gesture = null;
  restoreStart(e);
  refresh3d();
}

// ---------------------------------------------------------------- ввод числа

let numTarget = null;

function hideNumber() {
  const input = el('v3Num');
  if (input) input.hidden = true;
  numTarget = null;
}

function openNumber(e, hit, grip) {
  const input = el('v3Num');
  if (!input) return;
  const rec = findWallRecord(state.project, hit.key, hit.kind === 'manual' ? undefined : hit.from);
  if (!rec) return;
  numTarget = { rec, grip };
  const c = canvasPoint(e);
  input.style.left = `${Math.round(c.x)}px`;
  input.style.top = `${Math.round(c.y)}px`;
  input.title = `${GRIP_LABEL[grip.kind]}, мм — Enter применить, Esc отмена`;
  input.setAttribute('aria-label', `${GRIP_LABEL[grip.kind]} стены, мм`);
  input.value = String(gripValue(state.project, rec, grip));
  input.hidden = false;
  setHint(`${GRIP_LABEL[grip.kind]}, мм — Enter применить, Esc отмена`);
  input.focus();
  input.select();
}

function applyNumber() {
  const t = numTarget;
  const input = el('v3Num');
  hideNumber();
  if (!t || !input) return;
  const before = snapshot();
  const res = applyGripValue(state.project, t.rec, t.grip, input.value);
  if (!res.ok) {
    restoreFrom(before);
    toast(`Нельзя: ${res.reason}`, true);
    setHint();
    return;
  }
  commitWallChange(before, t.rec);
}

// ---------------------------------------------------------------- жесты

function onDown(e) {
  if (walk?.active) return;
  const canvas = el('canvas3d');
  canvas.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (e.pointerType === 'touch') touchUsed = true;
  hideNumber();
  const pan = e.button === 1 || e.button === 2 || (e.shiftKey && !openingToolOn());
  if (pointers.size === 2) {
    if (gesture?.hold) clearTimeout(gesture.hold);
    if (edit) cancelEdit();
    if (openingResizeDragging()) cancelOpeningResize();
    if (massDragging()) cancelMassDrag();
    if (roofDragging()) cancelRoofDrag();
    if (gesture?.kind === 'object-gizmo') cancelObjectGizmoDrag();
    const [a, b] = [...pointers.values()];
    gesture = {
      kind: 'pinch', dist0: Math.hypot(a.x - b.x, a.y - b.y) || 1,
      camZoom: cam.projection === 'perspective' ? cam.eyeDist : cam.dist,
      mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
    };
    return;
  }
  if (walk?.choosing) {
    gesture = { kind: pan ? 'pan' : 'orbit', x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, click: e.button === 0 && !pan, walkStart: true };
    return;
  }
  const openingHandle = wallsEditable() && e.button === 0 && pointers.size === 1 ? openingHandleAt(e) : null;
  if (choosingFacadeWall() && e.button === 0 && !pan) {
    gesture = { kind: 'orbit', x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, click: true, chooseFacade: true };
    return;
  }
  if (openingHandle && startOpeningResize(e, openingHandle)) {
    gesture = { kind: 'opening-resize' };
    setHint();
    return;
  }
  // Точка выноса или стрелка Z выбранной крыши — сразу жест (и с Shift —
  // «без привязки», а не сдвиг вида).
  const roofPart = wallsEditable() && e.button === 0 && pointers.size === 1 ? roofPartAt(e) : null;
  if (roofPart && startRoofDrag(e, roofPart)) {
    gesture = { kind: 'roof' };
    setHint();
    return;
  }
  // Shift на ручке снимает шаг. На свободном фоне он перемещает камеру.
  const objectPart = e.button === 0 && pointers.size === 1 ? objectGizmoPartAt(e) : null;
  if (objectPart && startObjectGizmoDrag(e, objectPart)) {
    gesture = { kind: 'object-gizmo' };
    canvas.style.cursor = 'grabbing';
    setHint();
    return;
  }
  // Инструмент «Масса»: клик (без сдвига) — шаг жеста; потянули — вращение
  // (с Shift — сдвиг вида), как обычно.
  const massTool = massToolOn() && wallsEditable() && e.button === 0 && pointers.size === 1;
  const openingTool = openingToolOn() && wallsEditable() && e.button === 0 && pointers.size === 1;
  if (pan || e.button !== 0 || pointers.size > 2) {
    gesture = { kind: pan ? 'pan' : 'orbit', x: e.clientX, y: e.clientY,
      ...(massTool ? { x0: e.clientX, y0: e.clientY, click: true, massTool } : {}),
      ...(openingTool ? { x0: e.clientX, y0: e.clientY, click: true, openingTool } : {}) };
    return;
  }
  if (state.tool?.kind === 'place-furniture' && placeFurniture3d(e)) {
    gesture = { kind: 'place' };
    return;
  }
  if (composingFacade() && wallsEditable()) {
    gesture = { kind: 'composition', x: e.clientX, y: e.clientY, moved: false };
    return;
  }
  if (facadeToolOn() && wallsEditable()) {
    facadePreview = facadeToolOn() ? facadeAt(e) : null;
    uploadOverlay();
    requestRender();
    gesture = { kind: 'orbit', x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, click: true, facadeTool: true };
    return;
  }
  if (openingTool) {
    gesture = { kind: 'orbit', x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, click: true, openingTool };
    return;
  }
  if (massTool) {
    gesture = { kind: 'orbit', x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, click: true, massTool };
    return;
  }
  // Инструмент «Крыша»: клик (без сдвига) — накрыть помещение; потянули — вращение.
  if (roofToolOn() && wallsEditable()) {
    gesture = { kind: 'orbit', x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, click: true, roofTool: true };
    return;
  }
  // Гизмо или точка выбранной массы — сразу жест (мышь и палец; у пальца
  // зона попадания шире). Тело массы — только выбор.
  const massPart = wallsEditable() ? massPartAt(e) : null;
  if (massPart && startMassDrag(e, massPart)) {
    gesture = { kind: 'mass' };
    el('canvas3d').style.cursor = massPart.part.startsWith('g') ? 'grabbing' : el('canvas3d').style.cursor;
    setHint();
    return;
  }
  const hit = pickWithMass(e);
  const grip = gripAt(hit, e);
  // Мышь: нажатие на грань выбранной стены — сразу ручка.
  if (grip && e.pointerType === 'mouse' && startEdit(hit, grip, e.clientX, e.clientY)) return;
  gesture = { kind: 'orbit', x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, click: true, hit };
  // Палец/перо: удержание грани выбранной стены — ручка (как на плане).
  if (grip) {
    const g = gesture;
    g.hold = setTimeout(() => {
      if (gesture !== g || !g.click || pointers.size !== 1) return;
      if (startEdit(hit, grip, g.x0, g.y0)) navigator.vibrate?.(15);
    }, HOLD_MS);
  }
}

function panBy(dx, dy) {
  const canvas = el('canvas3d');
  const c = camera(canvas.clientWidth, canvas.clientHeight);
  const k = worldPerPixel(canvas.clientWidth, canvas.clientHeight);
  cam.target = {
    x: cam.target.x - (c.r.x * dx - c.u.x * dy) * k,
    y: cam.target.y - (c.r.y * dx - c.u.y * dy) * k,
    z: cam.target.z - (c.r.z * dx - c.u.z * dy) * k,
  };
}

function onMove(e) {
  if (walk?.active) return;
  if (walk?.choosing) {
    if (!gesture) { previewWalkPlacement(e); return; }
    el('v3WalkStart').hidden = true;
  }
  if (!pointers.has(e.pointerId) || !gesture) {
    if (e.pointerType === 'mouse' && !gesture && active) {
      if (composingFacade() && wallsEditable()) {
        composer.move(e);
        el('canvas3d').style.cursor = 'crosshair';
      } else if (facadeToolOn() && wallsEditable()) {
        facadePreview = facadeAt(e);
        el('canvas3d').style.cursor = facadePreview ? 'crosshair' : 'default';
        uploadOverlay();
        requestRender();
      } else if (openingToolOn() && wallsEditable()) openingToolMove(e);
      else if (massToolOn() && wallsEditable()) massToolMove(e);
      else if (roofToolOn() && wallsEditable()) roofToolMove(e);
      else updateHover(e);
    }
    return;
  }
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (gesture.kind === 'composition') {
    if (!composingFacade() || !wallsEditable()) return;
    if (!gesture.moved) {
      if (Math.hypot(e.clientX - gesture.x, e.clientY - gesture.y) <= CLICK_SLOP) return;
      gesture.moved = true;
      if (!composer.started()) composer.click({ clientX: gesture.x, clientY: gesture.y });
    }
    composer.move(e);
    return;
  }
  if (gesture.kind === 'edit') { moveEdit(e); return; }
  if (gesture.kind === 'opening-resize') { moveOpeningResize(e); return; }
  if (gesture.kind === 'mass') { moveMassDrag(e); return; }
  if (gesture.kind === 'roof') { moveRoofDrag(e); return; }
  if (gesture.kind === 'object-gizmo') { moveObjectGizmoDrag(e); return; }
  if (gesture.kind === 'pinch') {
    if (massVoidHoverId !== null) { massVoidHoverId = null; uploadOverlay(); }
    const [a, b] = [...pointers.values()];
    if (!b) return;
    const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
    const zoom = Math.min(400000, Math.max(3000, (gesture.camZoom * gesture.dist0) / d));
    if (cam.projection === 'perspective') cam.eyeDist = zoom; else cam.dist = zoom;
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    panBy(mid.x - gesture.mid.x, mid.y - gesture.mid.y);
    gesture.mid = mid;
  } else {
    if (gesture.click) {
      if (Math.hypot(e.clientX - gesture.x0, e.clientY - gesture.y0) <= CLICK_SLOP) return;
      gesture.click = false;
      if (facadePreview) { facadePreview = null; uploadOverlay(); }
      clearTimeout(gesture.hold);
    }
    // После сдвига/вращения камеры прежняя точка попадания уже невалидна.
    // Сразу прячем cutter, а на pointerup заново проверяем объект под мышью.
    if (massVoidHoverId !== null) { massVoidHoverId = null; uploadOverlay(); }
    const dx = e.clientX - gesture.x;
    const dy = e.clientY - gesture.y;
    gesture.x = e.clientX;
    gesture.y = e.clientY;
    if (gesture.kind === 'pan' || frontFacade) panBy(dx, dy);
    else {
      cam.yaw -= dx * 0.008;
      cam.pitch = Math.min(1.5, Math.max(-0.35, cam.pitch + dy * 0.006));
    }
  }
  requestRender();
}

function onUp(e) {
  if (walk?.active) return;
  const g = gesture;
  pointers.delete(e.pointerId);
  if (walk?.choosing && g?.walkStart && !pointers.size) {
    gesture = null;
    if (g.click) startWalkAt(e); else previewWalkPlacement(e);
    return;
  }
  if (g?.kind === 'composition') {
    gesture = null;
    if (composingFacade() && wallsEditable() && (!g.moved || composer.started())) composer.click(e);
    return;
  }
  if (g?.kind === 'edit') {
    if (!pointers.size) finishEdit();
    return;
  }
  if (g?.kind === 'opening-resize') {
    if (!pointers.size) {
      gesture = null;
      finishOpeningResize();
      refreshHighlight();
    }
    return;
  }
  if (g?.kind === 'mass') {
    if (!pointers.size) {
      gesture = null;
      finishMassDrag();
      refreshHighlight();
    }
    return;
  }
  if (g?.kind === 'roof') {
    if (!pointers.size) {
      gesture = null;
      finishRoofDrag();
      refreshHighlight();
    }
    return;
  }
  if (g?.kind === 'object-gizmo') {
    if (!pointers.size) {
      gesture = null;
      finishObjectGizmoDrag();
      refreshHighlight();
    }
    return;
  }
  if (g?.hold) clearTimeout(g.hold);
  if (g?.click && !pointers.size) {
    gesture = null;
    if (g.chooseFacade && choosingFacadeWall()) {
      const hit = pickObject(pickSets(), rayAt(e));
      const box = facadeWallFor(hit, hit?.levelId);
      if (box) enterFacade(box);
      else setHint('Выберите наружную грань стены, окно или облицовку');
      return;
    }
    if (g.facadeTool && facadeToolOn()) { placeFacade(e); return; }
    if (g.openingTool) {
      openingToolClick(e);
      setHint();
      return;
    }
    if (g.massTool) {
      massToolClick(e);
      syncMassControl();
      setHint();
      return;
    }
    if (g.roofTool) {
      roofToolClick(e);
      setHint();
      return;
    }
    clickSelect(g.hit);
    return;
  }
  if (!pointers.size) {
    gesture = null;
    if (e.pointerType === 'mouse' && active) updateHover(e);
  }
  else if (gesture?.kind === 'pinch') {
    const [p] = [...pointers.values()];
    gesture = { kind: 'orbit', x: p.x, y: p.y };
  }
}

function onCancel(e) {
  if (walk?.active) return;
  if (gesture?.kind === 'composition') {
    pointers.delete(e.pointerId);
    gesture = null;
    composer.reset();
    setHint(); uploadOverlay(); requestRender();
    return;
  }
  if (facadePreview) { facadePreview = null; uploadOverlay(); requestRender(); }
  if (gesture?.kind === 'edit') {
    pointers.delete(e.pointerId);
    cancelEdit();
    return;
  }
  if (gesture?.kind === 'opening-resize') {
    pointers.delete(e.pointerId);
    gesture = null;
    cancelOpeningResize();
    return;
  }
  if (gesture?.kind === 'mass') {
    pointers.delete(e.pointerId);
    gesture = null;
    cancelMassDrag();
    return;
  }
  if (gesture?.kind === 'roof') {
    pointers.delete(e.pointerId);
    gesture = null;
    cancelRoofDrag();
    return;
  }
  if (gesture?.kind === 'object-gizmo') {
    pointers.delete(e.pointerId);
    gesture = null;
    cancelObjectGizmoDrag();
    return;
  }
  if (gesture?.hold) clearTimeout(gesture.hold);
  if (gesture) gesture.click = false;
  onUp(e);
}

function onDblClick(e) {
  if (walk?.active || walk?.choosing) return;
  if (!massToolOn() && wallsEditable() && massDblClick(e)) return;
  if (wallsEditable() && roofDblClick(e)) return;
  const hit = pickAt(e);
  const grip = gripAt(hit, e);
  if (grip) openNumber(e, hit, grip);
}

export function bind3d() {
  const canvas = el('canvas3d');
  walk = createWalkController({ canvas, cam, repaint: requestRender, exit: leaveWalk });
  el('v3Walk').addEventListener('click', enterWalk);
  // После обзора свайпом браузер может подавить совместимый mouse-click.
  el('v3Walk').addEventListener('touchend', (event) => {
    event.preventDefault(); enterWalk();
  }, { passive: false });
  const facade = el('view3d').querySelector('.v3-facade');
  const panel = facade.querySelector('.v3-facade-panel');
  composer = facadeComposer({ pick: compositionSurface, ray: rayAt, hint: setHint,
    repaint: () => { uploadOverlay(); requestRender(); },
    switchFloor: (id) => switchLevel(id, { planView: false }) });
  panel.innerHTML = Object.entries(FACADE_ELEMENTS).filter(([, def]) => !def.compositionOnly).map(([kind, def]) =>
    `<button type="button" data-facade-kind="${kind}"><i class="swatch" aria-hidden="true" style="--finish:${Object.values(def.finishes)[0]}"></i>${def.name}</button>`
  ).join('') + '<div class="v3-facade-group">Композиции</div>' + compositionMenu() + '<button type="button" data-facade-cancel hidden>Отменить размещение</button>';
  panel.addEventListener('click', (e) => {
    const button = e.target.closest('button');
    if (!button) return;
    facade.open = false;
    facadePreview = null;
    const wasChoosing = choosingFacadeWall();
    cancelTool();
    if (button.hasAttribute('data-facade-front')) {
      const box = facadeWallFor(state.selection, state.project.activeLevel);
      if (box) enterFacade(box);
      else if (!wasChoosing) {
        selectObject(null);
        setTool({ kind: 'choose-facade-wall' });
      }
    }
    if ((button.dataset.facadeKind || button.dataset.facadeComposition) && wallsEditable()) {
      selectObject(null);
      composer.reset();
      setTool(button.dataset.facadeComposition
        ? { kind: 'place-facade-composition', compositionKind: button.dataset.facadeComposition }
        : { kind: 'place-facade', facadeKind: button.dataset.facadeKind });
      if (!opts.masses) { opts.masses = true; saveLayers(); syncLayerControls(); refresh3d(); }
    }
    setHint();
    uploadOverlay();
    requestRender();
  });
  const layers = el('view3d').querySelector('.v3-layers');
  panel.insertAdjacentHTML('afterbegin', '<button type="button" data-facade-front>Редактировать фасад</button>');
  el('v3ExitFacade').addEventListener('click', () => {
    if (state.tool) cancelTool();
    facadePreview = null;
    leaveFacade();
    facade.querySelector('summary').focus();
  });
  const views = el('view3d').querySelector('.v3-views');
  el('v3EnterInterior').addEventListener('click', () => { views.open = false; enterInterior(); });
  el('v3InteriorLevel').addEventListener('change', (e) => switchLevel(e.target.value, { planView: false }));
  el('v3ExitInterior').addEventListener('click', () => { leaveInterior(); views.querySelector('summary').focus(); });
  document.addEventListener(PROJECT_REPLACED_EVENT, () => {
    leaveWalk({ focus: false });
    if (!interior) return;
    leaveInterior({ restoreFloor: false });
    frameHouse();
    cameraProject = state.project;
    requestRender();
  });
  const bar = views.parentElement;
  const projection = bar.querySelector('.v3-projection');
  const phone = matchMedia('(max-width: 640px)');
  const arrangeCameraControls = () => {
    if (phone.matches) views.querySelector('.v3-views-panel').prepend(projection);
    else bar.prepend(projection);
  };
  arrangeCameraControls();
  phone.addEventListener('change', arrangeCameraControls);
  document.addEventListener('pointerdown', (event) => {
    if (facade.open && !facade.contains(event.target)) facade.open = false;
    if (layers.open && !layers.contains(event.target)) layers.open = false;
    if (views.open && !views.contains(event.target)) views.open = false;
  });
  for (const details of [layers, views, facade]) {
    details.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape' || !details.open) return;
      event.preventDefault();
      event.stopPropagation();
      details.open = false;
      details.querySelector('summary').focus();
    });
  }
  el('v3Close')?.addEventListener('click', close3d);
  document.querySelectorAll('[data-v3-projection]').forEach((button) => button.addEventListener('click', () => {
    const next = button.dataset.v3Projection;
    if (!['perspective', 'orthographic'].includes(next) || next === cam.projection) return;
    cam.projection = next;
    saveLayers();
    syncCameraControls();
    sets = null;
    uploadOverlay();
    requestRender();
  }));
  const presets = {
    iso: { yaw: -2.2, pitch: 0.62 },
    top: { yaw: -Math.PI / 2, pitch: 1.5 },
    front: { yaw: -Math.PI / 2, pitch: 0.16 },
    right: { yaw: Math.PI, pitch: 0.16 },
  };
  document.querySelectorAll('[data-v3-preset]').forEach((button) => button.addEventListener('click', () => {
    if (button.dataset.v3Preset === 'eye') {
      viewFromEyeHeight();
      saveLayers();
    } else {
      const preset = presets[button.dataset.v3Preset];
      if (!preset) return;
      Object.assign(cam, preset);
    }
    el('view3d')?.querySelector('.v3-views')?.removeAttribute('open');
    uploadOverlay();
    requestRender();
  }));
  el('v3Roof')?.addEventListener('change', (e) => set3dRoofVisibility(e.target.checked));
  el('v3Site')?.addEventListener('change', (e) => { opts.site = e.target.checked; refresh3d(); });
  el('v3Landscape')?.addEventListener('change', (e) => { opts.landscape = e.target.checked; refresh3d(); });
  el('v3Evening')?.addEventListener('change', (e) => { opts.evening = e.target.checked; saveLayers(); refresh3d(); });
  loadLayers();
  syncLayerControls();
  el('v3Furniture')?.addEventListener('change', (e) => {
    opts.furniture = e.target.checked;
    releaseHiddenFurnitureSelection();
    saveLayers();
    refresh3d();
  });
  el('v3Masses')?.addEventListener('change', (e) => { opts.masses = e.target.checked; saveLayers(); refresh3d(); });
  initOpening3d({
    pick: (e) => pickAt(e),
    axisDelta: (axis, dx, dy) => axisDelta(cam, canvas.clientWidth || 1, canvas.clientHeight || 1, axis, dx, dy),
    worldPerPx: () => worldPerPixel(canvas.clientWidth || 1, canvas.clientHeight || 1),
    redraw: (geom = false) => {
      if (geom) refresh3d(); else uploadOverlay();
      requestRender();
    },
    label: setMassLabel,
    project: (p) => debug3dScreen(p),
  });
  initMass3d({
    facadeClip: () => facadeLevelBounds(state.project, opts.levels),
    ray: rayAt,
    axisDelta: (axis, dx, dy) => axisDelta(cam, canvas.clientWidth || 1, canvas.clientHeight || 1, axis, dx, dy),
    worldPerPx: () => worldPerPixel(canvas.clientWidth || 1, canvas.clientHeight || 1),
    floorHit: (e) => {
      const hit = pickAt(e);
      if (hit?.type !== 'room') return null;
      const r = rayAt(e);
      return { t: hit.t, z: Math.round(r.o.z + r.d.z * hit.t) };
    },
    redraw: (geom = false) => {
      if (geom) {
        if (state.selection?.type === 'mass' && massIsVoid(state.selection.id)) rebuildScene();
        else rebuildMasses();
        uploadGeometry();
      } else uploadOverlay();
      requestRender();
    },
    label: setMassLabel,
    hint: (text) => setHint(text),
    // Точка в осях дома → клиентские координаты; оси экрана для «точек к камере».
    project: (p) => debug3dScreen(p),
    basis: () => {
      const c = camera(canvas.clientWidth || 1, canvas.clientHeight || 1);
      return { r: W(c.r), u: W(c.u), f: W(c.f) };
    },
    ground: () => (opts.site ? terrainHeightFn(state.project, opts.terrainScale) : null),
  });
  initStairShape3d({
    canvas: () => canvas, faces: () => faces, ray: rayAt, rayPlaneZ,
    project: (p) => debug3dScreen(p),
    rebuild: () => { rebuildScene(); uploadGeometry(); requestRender(); },
    hint: (text) => setHint(text),
  });
  initObjectGizmo3d({
    faces: () => faces,
    ray: rayAt,
    rayPlaneZ,
    axisDelta: (axis, dx, dy) => axisDelta(cam, canvas.clientWidth || 1, canvas.clientHeight || 1, axis, dx, dy),
    worldPerPx: () => worldPerPixel(canvas.clientWidth || 1, canvas.clientHeight || 1),
    project: (p) => debug3dScreen(p),
    basis: () => {
      const c = camera(canvas.clientWidth || 1, canvas.clientHeight || 1);
      return { r: W(c.r), u: W(c.u), f: W(c.f) };
    },
    rebuild: () => { rebuildScene(); uploadGeometry(); requestRender(); },
    redraw: () => { uploadOverlay(); requestRender(); },
    hint: (text) => setHint(text),
  });
  bindMassNum();
  initRoof3d({
    ray: rayAt,
    axisDelta: (axis, dx, dy) => axisDelta(cam, canvas.clientWidth || 1, canvas.clientHeight || 1, axis, dx, dy),
    worldPerPx: () => worldPerPixel(canvas.clientWidth || 1, canvas.clientHeight || 1),
    pick: (e) => pickAt(e),
    switchLevel: (id) => { if (id && id !== state.project.activeLevel) switchLevel(id); },
    redraw: (geom = false) => {
      if (geom) { rebuildRoofs(); uploadGeometry(); } else uploadOverlay();
      requestRender();
    },
    label: setMassLabel,
    project: (p) => debug3dScreen(p),
    basis: () => {
      const c = camera(canvas.clientWidth || 1, canvas.clientHeight || 1);
      return { r: W(c.r), u: W(c.u), f: W(c.f) };
    },
  });
  bindRoofNum();
  document.addEventListener('kepler:roof-tool', () => {
    if (!active) return;
    if (interior && roofToolOn()) leaveInterior({ restoreFloor: false });
    resetRoofTool();
    setMassLabel(null);
    setHint();
    uploadOverlay();
    requestRender();
  });
  document.addEventListener('kepler:mass-tool', () => {
    if (!active) return;
    if (interior && massToolOn()) leaveInterior({ restoreFloor: false });
    resetMassTool();
    if (massToolOn() && !opts.masses) { opts.masses = true; syncLayerControls(); refresh3d(); }
    syncMassControl();
    setHint();
    uploadGeometry();
    requestRender();
  });
  document.addEventListener('kepler:opening-tool', () => {
    if (!active) return;
    if (openingToolOn()) rehoverOpeningTool();
    else { resetOpeningTool(); setMassLabel(null); }
    setHint();
    uploadOverlay();
    requestRender();
  });
  el('v3Levels')?.addEventListener('change', (e) => {
    opts.levels = LEVEL_MODES.has(e.target.value) ? e.target.value : 'all';
    saveLayers();
    refresh3d();
  });
  el('v3Relief')?.addEventListener('input', (e) => {
    opts.terrainScale = Math.max(1, Math.min(5, Number(e.target.value) || 1));
    const label = el('v3ReliefVal');
    if (label) label.textContent = String(opts.terrainScale);
    refresh3d();
  });
  el('v3Fit')?.addEventListener('click', () => {
    if (frontFacade) {
      const { box } = frontFacade;
      const current = facadeWallFor({ type: 'wall', key: box.key, from: box.from }, box.levelId);
      if (current) frameFacade(current);
      else { leaveFacade(); frameHouse(); }
    } else if (interior) frameInterior();
    else frameHouse();
    requestRender();
  });
  const num = el('v3Num');
  num?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); applyNumber(); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); hideNumber(); setHint(); }
  });
  num?.addEventListener('blur', () => { if (numTarget) { hideNumber(); setHint(); } });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('dragover', (e) => {
    if (!(e.dataTransfer?.types || []).includes('application/x-kepler-furn')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  });
  canvas.addEventListener('drop', (e) => {
    if (walk?.active || walk?.choosing) { e.preventDefault(); return; }
    const kind = e.dataTransfer?.getData('application/x-kepler-furn');
    if (!kind) return;
    e.preventDefault();
    placeFurniture3d(e, kind, {});
  });
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onCancel);
  canvas.addEventListener('pointerleave', () => {
    if (walk?.choosing) { el('v3WalkStart').hidden = true; return; }
    if (facadePreview) { facadePreview = null; uploadOverlay(); requestRender(); }
    const hadMass = !gesture && clearMassHover();
    const hadObject = !gesture && clearObjectGizmoHover();
    const hadVoid = massVoidHoverId !== null;
    massVoidHoverId = null;
    if (massToolOn() && !gesture) setMassLabel(null);
    if (openingToolOn() && !gesture) { resetOpeningTool(); uploadOverlay(); requestRender(); }
    if (gesture) {
      if (hadVoid) { uploadOverlay(); requestRender(); }
      return;
    }
    if (!hover && !objectHover && !hadMass && !hadObject && !hadVoid) return;
    const hadGeometryHover = Boolean(hover) || Boolean(objectHover) || hadMass;
    hover = null;
    objectHover = null;
    canvas.style.cursor = '';
    if (hadGeometryHover) uploadGeometry();
    else uploadOverlay();
    requestRender();
  });
  canvas.addEventListener('dblclick', onDblClick);
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (walk?.active) return;
    const key = cam.projection === 'perspective' ? 'eyeDist' : 'dist';
    cam[key] = Math.min(400000, Math.max(3000, cam[key] * Math.exp(e.deltaY * 0.0012)));
    if (['mass', 'opening', 'item', 'landscape'].includes(state.selection?.type) || massToolOn() || openingToolOn()) uploadOverlay(); // ручки и призраки — в пикселях экрана
    if (walk?.choosing) previewWalkPlacement(e);
    else updateHover(e); // камера изменилась — заново проверяем cutter под курсором
    requestRender();
  }, { passive: false });
  new ResizeObserver(() => requestRender()).observe(canvas);
}

// Подпись у курсора (размеры массы при создании и правке).
function setMassLabel(text, x, y) {
  const lab = el('v3Label');
  if (!lab) return;
  if (!text) { lab.hidden = true; return; }
  const r = el('view3d').getBoundingClientRect();
  lab.textContent = text;
  lab.style.left = `${Math.round(x - r.left + 16)}px`;
  lab.style.top = `${Math.round(y - r.top + 14)}px`;
  lab.hidden = false;
}

// Для автотестов: камера, число граней, выбранная стена, слои.
export function debug3d() {
  const levelsShown = [...new Set(faces.filter((f) => f.kind === 'floor').map((f) => f.level))];
  return {
    active, faces: faces.length, webgl: Boolean(gl), cam: { ...cam, target: { ...cam.target } },
    walk: walk?.debug() ?? null,
    walkChoosing: Boolean(walk?.choosing),
    rebuilds: { ...rebuildStats },
    selectedKey: selectedRef()?.key ?? null, editing: Boolean(edit),
    hovered: objectHover ? { type: objectHover.type, id: objectHover.id ?? null, key: objectHover.key ?? null } : null,
    highlighted: faces.filter((f) => f.kind === 'wall' && faceColor(f) !== f.color).length,
    highlightedAll: faces.filter((f) => faceColor(f) !== f.color).length + selectionOverlay().length,
    furniture: faces.filter((f) => f.kind === 'furniture').length,
    railings: faces.filter((f) => f.kind === 'railing').length,
    levels: opts.levels, levelsShown, roof: faces.some((f) => f.kind === 'roof'),
    masses: new Set(faces.filter((f) => f.kind === 'mass').map((f) => f.massId)).size, massLayer: opts.masses,
    massVoids: state.project?.massVoids?.length || 0,
    massVoidOverlayFaces: massVoidOverlay().length,
    massVoidHoverId,
    undergroundFaces: faces.filter((f) => f.kind === 'massUnder' && f.pts.length).length,
    waterline: faces.filter((f) => f.kind === 'massLine').reduce((t, f) => t + f.edges.length, 0),
    roofs: new Set(faces.filter((f) => f.roofId).map((f) => f.roofId)).size,
    roofFaces: faces.filter((f) => f.roofId && f.kind === 'roof').length,
    parapetFaces: faces.filter((f) => f.kind === 'parapet').length,
    fasciaFaces: faces.filter((f) => f.kind === 'fascia').length,
    roofColors: [...new Set(faces.filter((f) => f.roofId && f.kind === 'roof').map((f) => f.color))],
    roofTop: Math.max(-Infinity, ...faces.filter((f) => f.roofId && f.kind === 'roof').flatMap((f) => f.pts.map((p) => p.z))),
    roof3d: debugRoof3d(),
    mass: debugMass3d(), objectGizmo: debugObjectGizmo3d(), openingTool: debugOpening3d(),
    label: el('v3Label')?.hidden === false ? el('v3Label').textContent : null,
  };
}

// Для автотестов: грани перекрытия и пола (верх), накрывающие точку плана
// (оси дома) — проём в перекрытии (core/slab-openings.js) их не имеет.
export function debug3dCovered(x, y) {
  const hit = (f) => {
    const xs = f.pts.map((p) => p.x); const ys = f.pts.map((p) => p.y);
    return Math.min(...xs) < x && Math.max(...xs) > x && Math.min(...ys) < y && Math.max(...ys) > y;
  };
  const top = faces.filter((f) => (f.kind === 'slab' || f.kind === 'floor') && f.normal?.z > 0.5 && f.pts?.length >= 3);
  return { slab: top.filter((f) => f.kind === 'slab' && hit(f)).length, floor: top.filter((f) => f.kind === 'floor' && hit(f)).map((f) => f.level) };
}

// Для автотестов: что под точкой экрана (clientX/Y): стена (key, face) или
// помещение / предмет / проём (type, id).
export function debug3dPick(x, y) {
  const hit = pickWithMass({ clientX: x, clientY: y });
  if (!hit) return null;
  if (hit.type === 'mass') return { type: 'mass', id: hit.id, face: hit.face };
  return hit.type === 'wall'
    ? { type: 'wall', key: hit.key, face: hit.face, levelId: hit.levelId }
    : { type: hit.type, id: hit.id, levelId: hit.levelId, ...(hit.part ? { part: hit.part } : {}) };
}

// Для автотестов: точка в осях дома → экранные координаты (clientX/Y).
export function debug3dScreen(p) {
  const canvas = el('canvas3d');
  const r = canvas.getBoundingClientRect();
  const q = projectPoint(cam, r.width, r.height, p);
  return { x: r.left + q.x, y: r.top + q.y };
}
