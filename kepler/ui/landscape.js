// Режим «Ландшафт»: каталог слева, постановка, рисование линий и контуров,
// выделение, ручки и вершины, правка с историей, панель свойств, помощники
// и шаблоны сада. Данные — project.site.landscape.objects (core/landscape.js),
// координаты участка (съёмки).

import { bindStairShapeFields, stairShapeFields } from './stair-shape.js';
import {
  LANDSCAPE_CATEGORIES, LANDSCAPE_VIS, TREE_HOUSE_MIN, clampWidth, createLandscapeObject,
  hitEdge, hitLandscape, hitVertex, insertVertex, isPathShape, landscapeByCategory, landscapeDef,
  landscapeSummary, landscapeWarnings, minVertices, moveVertex, objectCorner, objectCorners, objectPath, objectsInPolygon,
  polygonArea, polylineLength, removeVertex, resizeObject, rotateObjectAbout, searchLandscape, syncShape,
  translateObject, CURB_HOSTS, CURB_MATERIALS, PLANTER_FILLS, clampSize, normalizeCurb, planterWall, stairsInfo,
  syncStairs, ELEV_KINDS, MAX_STAIR_RISE, PLATFORM_KINDS, RETAINING_SIDES, applyStairsDrop, normalizeElev, platformTop, retainingInfo, stairsDrop,
  isLevelPath, objectAreaM2, objectLengthM, pathSlabThickness, pointAlong, screenPlaceRotation, toWorld as landscapeWorld,
} from '../core/landscape.js';
import {
  LS_GROUP_TITLES, LS_HANDLE_TITLES, edgeFrame, frameCorners, frameEdges, frameRotators, lsHandleInfo, lsStarts, moveEdgeLs,
  nextLsHandle, rotateLs, scaleLs, screenAngle, stretchLs,
} from '../core/landscape-handles.js';
import { inItemCore } from '../core/item-handles.js';
import { groupRotateDeg } from '../core/group-handles.js';
import { CALLOUT_SIZE_MAX, CALLOUT_SIZE_MIN, CALLOUT_TEXT_MAX, calloutLayout, syncCallout } from '../core/landscape-callout.js';
import { fmtMoney, fmtQty, plantDefaults, plantGroupOf, plantKey, plantSchedule, setPlantEntry } from '../core/landscape-plants.js';
import { balanceRows, buildLandscapeCsv, landscapeBalance, retainingRows, retainingTotals } from '../core/landscape-report.js';
import {
  PLANTER_PLANTS, childrenOf, plantInPlanter, cloneGroup, isPlanter, pruneParents, refitChildren, rotateChildren, settleInPlanter, settleMoved,
  withChildren,
} from '../core/landscape-build.js';
import {
  GARDEN_TEMPLATES, PLANT_KINDS, canExplode, composeGarden, entryPathObject, explodePath, fillArea, guideOf, houseFootprints,
  parkingAtEntry, plantAlong, platformLevelEdit, setPlatformLevel, stairsAtPlatformEdge, stairsBetween, walkingLevel,
} from '../core/landscape-tools.js';
import { DECK_PATTERNS, PATH_ALIGNS, PATH_CORNERS, PATH_LAYINGS, layingParams } from '../core/path-geometry.js';
import { buildingSiteCheck } from '../core/site-check.js';
import { saveFile } from './cloud.js';
import { LS_STYLES, drawLandscapePreview, landscapeMeasure, shapeHandles } from './render-landscape.js';
import { setLandscapeStyle, setSheetStylePref, sheetStylePref } from './landscape-style.js';
import { el, escapeHtml, toast } from './dom.js';
import { closeLibrarySheet, closeSheets } from './mobile.js';
import { groundFn } from '../core/landscape-section.js';
import { openView } from './props-views.js';
import { safeProjectFileName } from './project-name.js';
import { gridStep } from './snap.js';
import { chainsWithout, dragPrev, snapAt } from './draw-snap-ui.js';
import { guideDelta, landscapeShape, startGuideSession } from './guides-ui.js';
import { state } from './state.js';
import { afterChange, mutate, pushHistory, snapshot } from './store.js';
import { cancelTool, selectObject, setHint, setTool } from './tools.js';
import {
  arrayDblClick, arrayHover, arrayPointerDown, bindPlantFill, handleArrayKey, plantFillHtml, renderArrayProps, startLandscapeArray,
} from './landscape-array.js';
import { canFill } from '../core/landscape-array.js';
import { attachOutdoorStair, travelAnchorAt, travelHostLevel } from '../core/outdoor-stair-links.js';
import {
  addOutdoorRoutePoint, bindOutdoorLights, bindOutdoorRouteProfile, finishOutdoorRoute,
  handleOutdoorRouteKey, outdoorLightsHtml, outdoorRouteHover, renderOutdoorRouteProps, startOutdoorRoute,
} from './outdoor-route.js';
import {
  bindSectionsBlock, finishSection, handleSectionKey, isSectionTool, landscapeSections, openSection, refreshSectionView,
  renderSectionToolProps, sectionDblClick, sectionDragEnd, sectionDragMove, sectionHandleAt, sectionHandlePointerDown,
  sectionHover, sectionPointerDown, sectionsBlockHtml,
} from './landscape-section.js';
import { hitSection } from './render-section.js';
import { requestDraw, screenToWorld, worldToScreen } from './view.js';

export const LANDSCAPE_MIME = 'application/x-kepler-landscape';

let category = LANDSCAPE_CATEGORIES[0].id;
let clipboard = null;
// Параметры рисования по типу (вариант, ширина, сглаживание) — запоминаются.
const drawOpts = new Map();
// Параметры помощников панели — запоминаются между перерисовками.
const helper = {
  inside: 'flowers-clump', insideDensity: 0.6,
  plant: 'tree-thuja', step: 3, offset: 1, sides: 'left', density: 0.5,
  pathVariant: 'pavers', curved: false, spaces: 2, template: GARDEN_TEMPLATES[0].id,
};

// ------------------------------------------------------------ Данные

export function landscapeObjects() {
  const site = state.project.site;
  if (!site.landscape || !Array.isArray(site.landscape.objects)) site.landscape = { objects: [] };
  return site.landscape.objects;
}

export function selectedIds() {
  return state.selection?.type === 'landscape' ? state.selection.ids : [];
}

function selectedObjects() {
  const ids = new Set(selectedIds());
  return landscapeObjects().filter((o) => ids.has(o.id));
}

const editable = (list) => list.filter((o) => !o.locked);

export function selectLandscape(ids) {
  if (state.lsVertex && !ids.includes(state.lsVertex.id)) state.lsVertex = null;
  if (state.lsEdge && !ids.includes(state.lsEdge.id)) state.lsEdge = null;
  selectObject(ids.length ? { type: 'landscape', ids: [...ids] } : null);
}

const snapStep = () => Math.max(gridStep(), 1);
const snap = (val) => Math.round(val / snapStep()) * snapStep();
const isShapeKind = (kind) => isPathShape(landscapeDef(kind));

// Привязка точки рисования/вершины — общий модуль (core/draw-snap.js):
// конец/середина/пересечение/центр, перпендикуляр и параллель, выравнивание
// по X/Y, полярные лучи и орто от последней точки, затем сетка.
// Shift — без привязки, Ctrl — временно орто.
export function snapLs(world, event, opts = {}) {
  return snapAt(world, event, { grid: snapStep(), ...opts }).point;
}

export function snapPoint(world, free = false, excludeId = null) {
  return snapLs(world, { shiftKey: free }, { exclude: { landscapeId: excludeId } });
}

// Новые объекты одним действием истории (помощники, шаблоны).
export function addLandscapeObjects(list, { replace = false, select = true } = {}) {
  if (!list.length && !replace) return [];
  mutate(() => {
    const site = state.project.site;
    if (replace) site.landscape.objects = [];
    landscapeObjects().push(...list);
  });
  selectLandscape(select ? list.map((o) => o.id) : []);
  return list;
}

// ------------------------------------------------------------ Постановка

export function startPlaceLandscape(kind) {
  const def = landscapeDef(kind);
  if (!def) return;
  if (kind === 'stairs-out') { startOutdoorStairs(); return; }
  if (isPathShape(def)) { startDrawLandscape(kind); return; }
  setTool({ kind: 'place-landscape', lsKind: kind, rotation: 0 },
    `Кликните на участке — «${def.title}»; повторные клики — ещё · Пробел — повернуть · Esc — выйти`);
  state.selection = null;
  renderLandscapeLibrary();
  requestDraw();
}

// Новый объект (и призрак) стоит ровно по экрану: поворот компенсирует угол
// вида (core/landscape.js screenPlaceRotation); вид не повёрнут — 0, как раньше.
const placeRotation = (kind, rotation) => screenPlaceRotation(kind, state.view.rotation, rotation);
// Угол, при котором текст выноски горизонтален на экране.
const screenDeg = () => screenPlaceRotation('callout', state.view.rotation);

export function placeLandscapeAt(kind, world, rotation = 0) {
  const def = landscapeDef(kind);
  if (!def || def.stage !== 1) return null;
  const obj = createLandscapeObject(kind, snap(world.x), snap(world.y), { rotation: placeRotation(kind, rotation), ...(isPathShape(def) ? drawOptions(kind) : {}) });
  mutate(() => {
    // Растение на коробе — садится внутрь и привязывается к нему.
    settleInPlanter(landscapeObjects(), obj);
    landscapeObjects().push(obj);
    state.selection = { type: 'landscape', ids: [obj.id] };
  });
  return obj;
}

function ghostAt(world) {
  const tool = state.tool;
  if (tool.platform) {
    state.ghostLandscape = stairsAtPlatformEdge(tool.platform, world, { ...tool.stairLevels, id: '__ghost-ls__' });
    return;
  }
  state.ghostLandscape = createLandscapeObject(tool.lsKind, snap(world.x), snap(world.y), { id: '__ghost-ls__', rotation: placeRotation(tool.lsKind, tool.rotation || 0) });
}

// Пробел во время постановки — поворот призрака на 90°.
export function rotateLandscapeGhost() {
  const tool = state.tool;
  if (tool?.kind !== 'place-landscape') return false;
  if (tool.platform) return true;
  tool.rotation = ((tool.rotation || 0) + 90) % 360;
  if (state.ghostLandscape) state.ghostLandscape.rotation = placeRotation(tool.lsKind, tool.rotation);
  requestDraw();
  return true;
}

// ------------------------------------------------------------ Рисование

const STAIR_START = 'Укажите первый край лестницы';
const STAIR_END = 'Укажите второй край лестницы';
const stairOptions = { width: 2400, variant: 'graphite', landing: 0, aLevel: null, bLevel: null };
const PATH_PRESETS = {
  terrain: { variant: 'pavers', width: 1400, smooth: false, meta: { pathLevel: 'terrain' }, elev: null },
  floating: {
    variant: 'stepping', width: 2000, smooth: false, laying: 'strict', slabL: 1000, slabW: 2000, gap: 140,
    color: '#4d5254', meta: { pathLevel: 'fixed', slabThickness: 120 }, elev: null,
  },
};

function startOutdoorStairs() {
  setTool({ kind: 'ls-flight', lsKind: 'stairs-out', first: null, cursor: null, opts: { ...stairOptions }, ground: groundFn(state.project) }, STAIR_START);
  selectObject(null);
  renderLandscapeLibrary();
}

function flightAt(tool, point, id) {
  const aLevel = tool.opts.aLevel ?? tool.first.level;
  const bLevel = tool.opts.bLevel ?? point.level;
  return stairsBetween(tool.first, point, { ...tool.opts, aLevel, bLevel, id, assumeRise: tool.opts.aLevel == null && tool.opts.bLevel == null });
}

function snapFlightPoint(tool, world, event) {
  const point = snapLs(world, event, { prev: tool.first });
  const snap = event.shiftKey ? null : travelAnchorAt(point, landscapeObjects(), Math.min(450, 12 / state.view.scale));
  return snap ? { ...snap.point, level: travelHostLevel(snap.host, snap.point, tool.ground), anchor: snap.anchor }
    : { ...point, level: walkingLevel(point, landscapeObjects(), tool.ground) };
}

function flightHint(tool) {
  if (!tool.first) return STAIR_START;
  if (!tool.cursor) return STAIR_END;
  const result = flightAt(tool, tool.cursor, '__ghost-ls__');
  state.ghostLandscape = result.obj || null;
  if (result.error) return result.error;
  const info = stairsInfo(result.obj);
  const assumed = result.assumedRise ? ' · на ровном месте +450 мм' : '';
  return `Перепад ${info.rise} мм · ${info.steps} ступ. · ${Math.round(info.riser)} × ${info.tread} мм${assumed}`;
}

function updateFlight(tool) {
  const hint = flightHint(tool);
  setHint(hint);
  const readout = el('lsStDrawInfo');
  if (readout) readout.textContent = hint;
  requestDraw();
}

function placeFlightEnd(tool, point) {
  if (!tool.first) {
    tool.first = point;
    tool.cursor = null;
    updateFlight(tool);
    return;
  }
  const result = flightAt(tool, point);
  if (result.error) { toast(result.error, true); return; }
  if (!result.assumedRise) {
    const link = (p, manual) => ({
      point: { x: p.x, y: p.y },
      ...(p.anchor && manual == null ? { anchor: p.anchor } : { level: manual }),
    });
    attachOutdoorStair(result.obj, link(tool.first, tool.opts.aLevel), link(point, tool.opts.bLevel));
  }
  Object.assign(stairOptions, tool.opts, { aLevel: null, bLevel: null });
  cancelTool();
  addLandscapeObjects([result.obj]);
  renderLandscapeLibrary();
}

function defaultPathElev(point, exclude = null, clearance = 150) {
  const ground = groundFn(state.project);
  return normalizeElev(walkingLevel(point, landscapeObjects().filter((o) => o !== exclude), ground, clearance));
}

function drawOptions(kind) {
  const def = landscapeDef(kind);
  if (!drawOpts.has(kind)) {
    drawOpts.set(kind, {
      variant: def.variants[0].id,
      ...(def.shape === 'line' ? { width: def.h } : {}),
      smooth: kind === 'pond-area' || kind === 'path' && def.variants[0].id === 'stepping',
    });
  }
  return drawOpts.get(kind);
}

const DRAW_HINT = {
  line: 'Кликайте точки линии · Enter или двойной клик — завершить · Backspace — убрать точку · Shift — без привязки, F8 — орто, число + Enter — длина · Esc — отмена',
  poly: 'Кликайте вершины контура или протяните прямоугольник · клик по первой точке или Enter — замкнуть · Backspace — убрать точку · Shift — без привязки, F8 — орто, число + Enter — длина · Esc — отмена',
};

export function startDrawLandscape(kind, preset = null) {
  const def = landscapeDef(kind);
  if (!isPathShape(def)) return;
  const opts = preset ? { ...preset, meta: { ...preset.meta } } : { ...drawOptions(kind) };
  setTool({ kind: 'draw-landscape', lsKind: kind, points: [], cursor: null, rect: null, opts }, DRAW_HINT[def.shape]);
  state.lsVertex = null;
  selectObject(null);
  renderLandscapeLibrary();
}

// Прямоугольник по двум углам — в осях экрана (вид участка может быть
// повёрнут на север), вершины — в мире.
function screenRect(a, b) {
  const sa = worldToScreen(a.x, a.y);
  const sb = worldToScreen(b.x, b.y);
  const pts = [sa, { x: sb.x, y: sa.y }, sb, { x: sa.x, y: sb.y }].map((p, i) => {
    if (i === 0) return { x: a.x, y: a.y };
    if (i === 2) return { x: b.x, y: b.y };
    const w = screenToWorld(p.x, p.y);
    return { x: Math.round(w.x), y: Math.round(w.y) };
  });
  return { a, b, pts };
}

function draftMeasure(tool) {
  const def = landscapeDef(tool.lsKind);
  let pts = [...tool.points];
  if (tool.rect) pts = tool.rect.pts;
  else if (tool.cursor) pts.push(tool.cursor);
  if (def.shape === 'line') return pts.length >= 2 ? `Длина ${(polylineLength(pts) / 1000).toFixed(2).replace('.', ',')} м` : '';
  return pts.length >= 3 ? `Площадь ${(polygonArea(pts) / 1e6).toFixed(1).replace('.', ',')} м²` : '';
}

function updateDraftHint() {
  const tool = state.tool;
  if (tool?.kind !== 'draw-landscape') return;
  const def = landscapeDef(tool.lsKind);
  const m = draftMeasure(tool);
  setHint(m ? `${m} · ${DRAW_HINT[def.shape]}` : DRAW_HINT[def.shape]);
  const box = document.querySelector('#lsDrawMeasure');
  if (box) box.textContent = m || '—';
}

function addDraftPoint(p, screen) {
  const tool = state.tool;
  const def = landscapeDef(tool.lsKind);
  const pts = tool.points;
  if (def.shape === 'poly' && pts.length >= 3) {
    const first = worldToScreen(pts[0].x, pts[0].y);
    if (Math.hypot(first.x - screen.x, first.y - screen.y) <= 10) { finishLandscapeDraw(); return; }
  }
  const last = pts[pts.length - 1];
  if (last) {
    const ls = worldToScreen(last.x, last.y);
    if (Math.hypot(ls.x - screen.x, ls.y - screen.y) < 4) return; // повторный клик (двойной)
  }
  pts.push({ x: p.x, y: p.y });
  updateDraftHint();
  requestDraw();
}

// Убрать совпадающие подряд точки (двойной клик ставит две).
function dedupe(pts, tol) {
  const out = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (!last || Math.hypot(last.x - p.x, last.y - p.y) > tol) out.push({ x: p.x, y: p.y });
  }
  return out;
}

export function finishLandscapeDraw() {
  const tool = state.tool;
  if (tool?.kind !== 'draw-landscape') return null;
  const def = landscapeDef(tool.lsKind);
  const pts = tool.rect ? tool.rect.pts.map((p) => ({ ...p })) : dedupe(tool.points, 2 / state.view.scale);
  const min = def.shape === 'poly' ? 3 : 2;
  if (pts.length < min || (def.shape === 'poly' && polygonArea(pts) < 1e4)) {
    toast(def.shape === 'poly' ? 'Нужно минимум 3 точки контура' : 'Нужно минимум 2 точки линии');
    tool.rect = null;
    requestDraw();
    return null;
  }
  const opts = { ...tool.opts };
  if (def.kind === 'path' && opts.meta?.pathLevel === 'fixed' && opts.elev == null) opts.elev = defaultPathElev(pts[0]);
  if (def.kind === 'path' && opts.meta?.pathLevel === 'graded') {
    opts.elev ??= defaultPathElev(pts[0], null, 25);
    opts.elevTo ??= defaultPathElev(pts.at(-1), null, 25);
  }
  cancelTool();
  const obj = createLandscapeObject(def.kind, 0, 0, { ...opts, points: pts, smooth: opts.smooth && pts.length >= 3 });
  mutate(() => {
    landscapeObjects().push(obj);
    state.selection = { type: 'landscape', ids: [obj.id] };
  });
  renderLandscapeLibrary();
  return obj;
}

// Привязка точки черновика: лучи — от последней поставленной точки.
function snapDraft(world, event) {
  const pts = state.tool.points;
  return snapLs(world, event, { prev: pts[pts.length - 1] || null, points: pts });
}

// Последняя точка черновика (для динамического ввода) или null.
export function landscapeDraftPrev() {
  const tool = state.tool;
  if (tool?.kind !== 'draw-landscape' || tool.rect || !tool.points.length) return null;
  return tool.points[tool.points.length - 1];
}

// Точка из динамического ввода — ровно в заданном месте.
export function addLandscapeDraftExact(p) {
  if (state.tool?.kind !== 'draw-landscape') return;
  addDraftPoint(p, worldToScreen(p.x, p.y));
}

function backspaceDraft() {
  const tool = state.tool;
  if (tool.points.length) tool.points.pop();
  tool.rect = null;
  updateDraftHint();
  requestDraw();
}

// ------------------------------------------------------------ Мышь

// Наведение/призрак. Возвращает true — событие обработано.
export function landscapeHover(world, canvas, event) {
  if (state.tool?.kind === 'ls-route') return outdoorRouteHover(world, canvas, event);
  if (state.tool?.kind === 'ls-flight') {
    const tool = state.tool;
    canvas.style.cursor = 'crosshair';
    if (tool.first) {
      tool.cursor = snapFlightPoint(tool, world, event);
      updateFlight(tool);
    }
    return true;
  }
  if (state.tool?.kind === 'place-landscape') {
    ghostAt(world);
    canvas.style.cursor = 'copy';
    requestDraw();
    return true;
  }
  if (state.tool?.kind === 'draw-landscape') {
    if (!state.tool.rect) state.tool.cursor = snapDraft(world, event);
    canvas.style.cursor = 'crosshair';
    updateDraftHint();
    requestDraw();
    return true;
  }
  if (state.tool?.kind === 'ls-array') return arrayHover(world, canvas, event);
  if (isSectionTool()) return sectionHover(world, canvas, event);
  if (state.tool) return false;
  const screen = worldToScreen(world.x, world.y);
  const secH = sectionHandleAt(screen);
  if (secH) {
    canvas.style.cursor = secH.mode === 'mid' ? 'copy' : secH.mode === 'flip' ? 'pointer' : 'move';
    return true;
  }
  const sh = hitShapeHandle(screen);
  if (sh) {
    canvas.style.cursor = sh.mode === 'mid' ? 'copy' : 'move';
    setEdgeHover(null, sh.obj);
    return true;
  }
  const edge = hitShapeEdge(screen);
  if (edge) {
    setEdgeHover(edge, edge.obj);
    canvas.style.cursor = edge.cursor;
    return true;
  }
  const handle = hitLandscapeHandle(screen);
  const hit = handle ? null : hitLandscape(landscapeObjects(), world, 4 / state.view.scale);
  setEdgeHover(null, hit);
  const next = hit ? { type: 'landscape', id: hit.id } : null;
  const handleCursor = (h) => (h.mode.endsWith('rotate') ? 'grab' : h.mode.startsWith('note') ? 'move'
    : h.edge ? (h.edge === 'n' || h.edge === 's' ? 'ns-resize' : 'ew-resize') : 'nwse-resize');
  canvas.style.cursor = handle ? handleCursor(handle) : hit ? (hit.locked ? 'pointer' : 'move') : 'default';
  if (JSON.stringify(next) !== JSON.stringify(state.hover)) { state.hover = next; requestDraw(); }
  return true;
}

const HANDLE_TOL = () => (state.coarsePointer ? 22 : 9);

// Режим ручек выбранного (core/landscape-handles.js): рамка, набор режимов.
export function landscapeHandleInfo() {
  return lsHandleInfo(landscapeObjects(), state.selection, state.itemHandle, state.view.rotation);
}

// Повторный клик по выбранному объекту (группе) — следующий режим ручек.
function cycleLandscapeHandle() {
  const info = landscapeHandleInfo();
  if (!info || info.modes.length < 2) return;
  state.itemHandle = nextLsHandle(state.itemHandle, info.key, info.modes);
  toast((info.group ? LS_GROUP_TITLES : LS_HANDLE_TITLES)[state.itemHandle.mode]);
  requestDraw();
}

// Ручки текущего режима. Режим «Выбор» — без ручек (у линий и контуров —
// вершины, hitShapeHandle). Прямоугольник: поворот (rotate), растяжение
// (frame-stretch), масштаб за угол (resize); рамка линии/группы — frame-*.
export function hitLandscapeHandle(screen) {
  const objs = selectedObjects();
  if (!objs.length) return null;
  const o = objs[0];
  if (objs.length === 1 && o.locked) return null;
  if (objs.length === 1 && o.kind === 'callout') {
    // Выноска: ручки «указатель» (круг) и «текст» (квадрат у излома).
    const L = calloutLayout(o);
    for (const [mode, p] of [['note-anchor', L.anchor], ['note-text', L.elbow]]) {
      const s = worldToScreen(p.x, p.y);
      if (Math.hypot(s.x - screen.x, s.y - screen.y) <= HANDLE_TOL() + 1) return { mode, obj: o };
    }
    return null;
  }
  const info = landscapeHandleInfo();
  if (!info || info.mode === 'select' || !info.frame) return null;
  const f = info.frame;
  const tol = HANDLE_TOL();
  // Тело объекта важнее ручек: у мелкого иначе нельзя кликнуть (сменить режим, потащить).
  if (!info.framed && inItemCore(f, screenToWorld(screen.x, screen.y), tol / state.view.scale)) return null;
  const near = (p) => { const s = worldToScreen(p.x, p.y); return Math.abs(s.x - screen.x) <= tol && Math.abs(s.y - screen.y) <= tol; };
  const nearRound = (p) => { const s = worldToScreen(p.x, p.y); return Math.hypot(s.x - screen.x, s.y - screen.y) <= tol + 1; };
  if (info.mode === 'rotate') {
    const r = frameRotators(f, 20, state.view.scale).find(nearRound);
    if (r) return { mode: info.framed ? 'frame-rotate' : 'rotate', corner: r.id, obj: o, info };
  } else if (info.mode === 'stretch') {
    const e = frameEdges(f).find(near);
    if (e) return { mode: 'frame-stretch', edge: e.id, obj: o, info };
  } else if (info.mode === 'scale') {
    const c = frameCorners(f).find(near);
    if (c) return { mode: info.framed ? 'frame-scale' : 'resize', corner: c.id, obj: o, info };
  }
  return null;
}

// Вершины и середины рёбер выбранной фигуры (линия/контур).
export function hitShapeHandle(screen) {
  const objs = selectedObjects();
  if (objs.length !== 1) return null;
  const o = objs[0];
  if (o.locked || !isShapeKind(o.kind)) return null;
  if (landscapeHandleInfo()?.mode !== 'select') return null; // вершины — в режиме «Выбор»
  const { vertices, mids } = shapeHandles(o, worldToScreen);
  const tol = HANDLE_TOL();
  for (let i = vertices.length - 1; i >= 0; i -= 1) {
    const p = vertices[i];
    if (Math.abs(p.x - screen.x) <= tol && Math.abs(p.y - screen.y) <= tol) return { mode: 'vertex', index: i, obj: o };
  }
  for (const m of mids) {
    if (Math.hypot(m.x - screen.x, m.y - screen.y) <= tol - 2) return { mode: 'mid', index: m.index, obj: o };
  }
  return null;
}

// Ребро выбранного контура (площадка, покрытие, газон) под курсором — в
// узкой полосе у линии; ручки вершин и середин проверяются раньше. Курсор —
// по наклону ребра на экране (вид «Ландшафта» повёрнут).
const EDGE_TOL = () => (state.coarsePointer ? 14 : 7);
export const EDGE_HINT = 'Линия — тянуть ребро; точки — править вершины';

function edgeObject() {
  const objs = selectedObjects();
  if (objs.length !== 1) return null;
  const o = objs[0];
  if (o.locked || o.smooth || landscapeDef(o.kind)?.shape !== 'poly' || (o.points?.length || 0) < 3) return null;
  if (landscapeHandleInfo()?.mode !== 'select') return null;
  return o;
}

export function hitShapeEdge(screen) {
  const o = edgeObject();
  if (!o) return null;
  const pts = o.points.map((p) => worldToScreen(p.x, p.y));
  let best = null;
  for (let i = 0; i < pts.length; i += 1) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    if (len2 < 1) continue;
    const t = Math.max(0, Math.min(1, ((screen.x - a.x) * dx + (screen.y - a.y) * dy) / len2));
    const d = Math.hypot(a.x + dx * t - screen.x, a.y + dy * t - screen.y);
    if (d <= EDGE_TOL() && (!best || d < best.d)) best = { d, index: i, dx, dy };
  }
  if (!best) return null;
  const ang = Math.abs((Math.atan2(best.dy, best.dx) * 180) / Math.PI) % 180;
  const cursor = ang < 12 || ang > 168 ? 'ns-resize' : Math.abs(ang - 90) < 12 ? 'ew-resize' : 'move';
  return { mode: 'edge', index: best.index, obj: o, cursor };
}

// Подсветка ребра под курсором (state.lsEdge) и подсказка у выбранного контура.
function setEdgeHover(edge, o) {
  const next = edge ? { id: edge.obj.id, index: edge.index } : null;
  if (JSON.stringify(next) !== JSON.stringify(state.lsEdge || null)) { state.lsEdge = next; requestDraw(); }
  const own = Boolean(o && edgeObject() === o);
  const hint = document.getElementById('canvasHint');
  if (own && !state.tool) setHint(EDGE_HINT);
  else if (hint?.textContent === EDGE_HINT) setHint('');
}

// Нажатие в «Ландшафте». Возвращает описание перетаскивания для input.js
// (kind 'ls-*', 'marquee', 'pan') или null.
export function landscapePointerDown(event, screen, world) {
  const tool = state.tool;
  // Касание: объект или точка ставятся на тапе, свайп — панорама (ui/input.js, kind 'tap').
  const touch = event.pointerType === 'touch';
  const tap = (run) => (touch ? { kind: 'tap', run, start: screen, view: { ...state.view } } : (run(), null));
  if (tool?.kind === 'ls-route') return tap(() => addOutdoorRoutePoint(tool, world, event));
  if (tool?.kind === 'ls-flight') {
    const point = snapFlightPoint(tool, world, event);
    return tap(() => { if (state.tool === tool) placeFlightEnd(tool, point); });
  }
  if (tool?.kind === 'place-landscape') {
    return tap(() => {
      if (!tool.platform) { placeLandscapeAt(tool.lsKind, world, tool.rotation || 0); return; }
      const stair = stairsAtPlatformEdge(tool.platform, world, tool.stairLevels);
      if (!stair) { toast('Выберите край шириной от 500 мм'); return; }
      const bottom = landscapeWorld(stair, 0, stair.h / 2);
      const top = landscapeWorld(stair, 0, -stair.h / 2);
      const upper = travelAnchorAt(top, [tool.platform], 5)?.anchor;
      const lower = travelAnchorAt(bottom, landscapeObjects().filter((o) => o !== tool.platform), 65)?.anchor;
      attachOutdoorStair(stair, {
        point: bottom, ...(tool.stairLevels.surveyLower ? { anchor: lower } : { level: stair.elev }),
      }, { point: top, anchor: upper });
      cancelTool();
      addLandscapeObjects([stair]);
    });
  }
  if (tool?.kind === 'draw-landscape') {
    const def = landscapeDef(tool.lsKind);
    const p = snapDraft(world, event);
    if (def.shape === 'poly' && !tool.points.length) return { kind: 'ls-draw-rect', start: p, screen, moved: false };
    return tap(() => { if (state.tool === tool) addDraftPoint(p, screen); });
  }
  if (tool?.kind === 'ls-array') { arrayPointerDown(event, screen, world); return null; }
  if (isSectionTool()) { sectionPointerDown(event, screen, world); return null; }
  if (tool) return null;
  // Ручки открытого разреза — раньше объектов.
  const secDrag = sectionHandlePointerDown(event, screen);
  if (secDrag !== undefined) return secDrag;
  const sh = hitShapeHandle(screen);
  if (sh) {
    const o = sh.obj;
    if (sh.mode === 'vertex' && event.altKey) {
      removeVertexAt(o, sh.index);
      return null;
    }
    const prevVertex = state.lsVertex;
    state.lsVertex = sh.mode === 'vertex' ? { id: o.id, index: sh.index } : null;
    // Панель «Угол в вершине» — для выбранной вершины дорожки.
    if (o.kind === 'path' && (prevVertex?.index !== state.lsVertex?.index || prevVertex?.id !== state.lsVertex?.id)) selectObject(state.selection);
    requestDraw();
    return { kind: 'ls-vertex', id: o.id, index: sh.index, insert: sh.mode === 'mid', before: snapshot(), moved: false, screen };
  }
  // Ребро выбранного контура — тянуть как линию (moveEdgeLs).
  const edge = hitShapeEdge(screen);
  if (edge) {
    const o = edge.obj;
    state.lsVertex = null;
    state.lsEdge = { id: o.id, index: edge.index };
    return {
      kind: 'ls-edge', id: o.id, index: edge.index, start: { x: world.x, y: world.y }, points0: o.points.map((p) => ({ x: p.x, y: p.y })),
      before: snapshot(), moved: false, screen, detail: event.detail || 1,
    };
  }
  state.lsVertex = null;
  const handle = hitLandscapeHandle(screen);
  if (handle) {
    const o = handle.obj;
    if (handle.mode.startsWith('note')) {
      return { kind: 'ls-note', id: o.id, part: handle.mode === 'note-anchor' ? 'anchor' : 'text', before: snapshot(), moved: false, screen };
    }
    if (handle.mode.startsWith('frame-')) return frameDrag(handle, world);
    if (handle.mode === 'rotate') {
      return {
        kind: 'ls-rotate', id: o.id, startRot: o.rotation || 0, center: { x: o.x, y: o.y },
        startAngle: Math.atan2(world.y - o.y, world.x - o.x), before: snapshot(), moved: false, kids: childStarts(o),
      };
    }
    const opp = { nw: 'se', ne: 'sw', se: 'nw', sw: 'ne' }[handle.corner];
    const anchor = objectCorners(o).find((c) => c.id === opp);
    const sign = { nw: [-1, -1], ne: [1, -1], se: [1, 1], sw: [-1, 1] }[handle.corner];
    return {
      kind: 'ls-resize', id: o.id, anchor: { x: anchor.x, y: anchor.y }, sign, before: snapshot(), moved: false,
      box0: { ...o }, kids: childStarts(o),
    };
  }
  const hit = hitLandscape(landscapeObjects(), world, 4 / state.view.scale, event.shiftKey ? null : new Set(selectedIds()));
  if (hit) {
    let ids = selectedIds();
    // Клик без сдвига по уже выбранному — следующий режим ручек (landscapeDragEnd).
    const wasSelected = !event.shiftKey && ids.includes(hit.id);
    if (event.shiftKey) {
      ids = ids.includes(hit.id) ? ids.filter((id) => id !== hit.id) : [...ids, hit.id];
      selectLandscape(ids);
      if (!ids.includes(hit.id)) return null;
    } else if (!ids.includes(hit.id)) {
      ids = [hit.id];
      selectLandscape(ids);
    }
    const own = editable(landscapeObjects().filter((o) => ids.includes(o.id)));
    if (!own.length) return null; // закреплённые — только выбор
    // Короб едет вместе со своими растениями.
    const group = withChildren(landscapeObjects(), own.map((o) => o.id));
    const movable = landscapeObjects().filter((o) => group.has(o.id));
    const starts = new Map(movable.map((o) => [o.id, { x: o.x, y: o.y, points: o.points ? o.points.map((p) => ({ ...p })) : null }]));
    const primary = starts.has(hit.id) ? hit.id : movable[0].id;
    return { kind: 'ls-move', primary, starts, world, screen, before: snapshot(), moved: false, wasSelected, detail: event.detail || 1 };
  }
  // Клик по линии разреза — открыть разрез.
  const sec = hitSection(landscapeSections(), screen, worldToScreen, state.coarsePointer ? 12 : 6);
  if (sec && !event.shiftKey) { openSection(sec.id); return null; }
  if (!event.shiftKey) selectLandscape([]);
  if (event.pointerType === 'touch') return { kind: 'pan', start: screen, view: { ...state.view } };
  state.marquee = { x1: screen.x, y1: screen.y, x2: screen.x, y2: screen.y, add: event.shiftKey };
  return { kind: 'marquee', start: screen };
}

// Жест рамки (core/landscape-handles.js): поворот, растяжение, масштаб
// группы или линии/контура; одного прямоугольника — растяжение. Растения
// в коробах едут вместе с ним (только сдвиг, без изменения размера).
function frameDrag(handle, world) {
  const info = handle.info;
  const objects = landscapeObjects();
  const ids = withChildren(objects, editable(info.objs).map((o) => o.id));
  const members = objects.filter((o) => ids.has(o.id));
  const moveOnly = new Set(members.filter((o) => o.parent && ids.has(o.parent)).map((o) => o.id));
  const frame = { ...info.frame };
  return {
    kind: 'ls-frame', op: handle.mode.slice(6), edge: handle.edge, corner: handle.corner, frame,
    center: { x: frame.x, y: frame.y }, startPoint: { x: world.x, y: world.y },
    starts: lsStarts(members), moveOnly, about: info.group ? 'opposite' : 'center',
    before: snapshot(), moved: false,
  };
}

function applyFrameResult(objects, list) {
  const byId = new Map(objects.map((o) => [o.id, o]));
  for (const r of list) {
    const live = byId.get(r.id);
    if (!live) continue;
    for (const key of Object.keys(live)) delete live[key];
    Object.assign(live, r);
  }
}

// Направляющие перемещения: набор — движущиеся объекты в начале жеста,
// оси — экран и сам главный объект (если он повёрнут).
function landscapeGuideSession(objects, drag) {
  const moving = objects.filter((o) => drag.starts.has(o.id)).map(landscapeShape).filter(Boolean);
  if (!moving.length) return null; // одни выноски — только сетка
  const main = objects.find((o) => o.id === drag.primary);
  const own = main && !['point', 'circle'].includes(landscapeDef(main.kind)?.shape) && !isShapeKind(main.kind)
    ? [((main.rotation || 0) * Math.PI) / 180] : [];
  return startGuideSession({ space: 'world', moving, exclude: { ls: new Set(drag.starts.keys()) }, ownAngles: own });
}

// Исходные положения растений короба (поворот, размер).
function childStarts(o) {
  if (!isPlanter(o)) return null;
  return new Map(childrenOf(landscapeObjects(), o.id).map((c) => [c.id, { x: c.x, y: c.y, rotation: c.rotation || 0 }]));
}

const rotate = (x, y, deg) => {
  const a = (deg * Math.PI) / 180;
  return { x: x * Math.cos(a) - y * Math.sin(a), y: x * Math.sin(a) + y * Math.cos(a) };
};

function updateLiveMeasure(o) {
  const box = document.querySelector('#lsMeasure');
  if (box && o) box.textContent = landscapeMeasure(o);
}

export function landscapeDragMove(drag, world, screen, event) {
  if (drag.kind === 'ls-sec-vertex') { sectionDragMove(drag, world, screen, event); return; }
  const objects = landscapeObjects();
  if (drag.kind === 'ls-draw-rect') {
    const tool = state.tool;
    if (tool?.kind !== 'draw-landscape') return;
    if (!drag.moved && Math.hypot(screen.x - drag.screen.x, screen.y - drag.screen.y) < 6) return;
    drag.moved = true;
    tool.rect = screenRect(drag.start, snapLs(world, event));
    tool.cursor = null;
    updateDraftHint();
  } else if (drag.kind === 'ls-vertex') {
    const o = objects.find((x) => x.id === drag.id);
    if (!o) return;
    if (!drag.moved && Math.hypot(screen.x - drag.screen.x, screen.y - drag.screen.y) < 3) return;
    const closed = landscapeDef(o.kind).shape === 'poly';
    const p = drag.insert
      ? snapLs(world, event, { prev: o.points[drag.index], exclude: { landscapeId: o.id }, extraShapes: [{ points: o.points, closed }] })
      : snapLs(world, event, { prev: dragPrev(o.points, drag.index, closed), exclude: { landscapeId: o.id }, extraShapes: chainsWithout(o.points, drag.index, closed) });
    if (drag.insert) {
      insertVertex(o, drag.index, p);
      drag.index += 1;
      drag.insert = false;
    } else {
      moveVertex(o, drag.index, p);
    }
    drag.moved = true;
    state.lsVertex = { id: o.id, index: drag.index };
    updateLiveMeasure(o);
  } else if (drag.kind === 'ls-edge') {
    const o = objects.find((x) => x.id === drag.id);
    const f = edgeFrame(drag.points0, drag.index);
    if (!o || !f) return;
    if (!drag.moved && Math.hypot(screen.x - drag.screen.x, screen.y - drag.screen.y) < 3) return;
    drag.moved = true;
    const raw = (world.x - drag.start.x) * f.n.x + (world.y - drag.start.y) * f.n.y;
    const res = moveEdgeLs(drag.points0, drag.index, true, raw, { snap: event?.shiftKey ? 0 : snapStep() });
    if (!res) return;
    o.points = res.points;
    syncShape(o);
    drag.clamped = res.clamped;
    state.lsEdge = { id: o.id, index: drag.index };
    updateLiveMeasure(o);
  } else if (drag.kind === 'ls-note') {
    // Выноска: указатель — с привязкой к объектам, текст (излом) — по сетке.
    const o = objects.find((x) => x.id === drag.id);
    if (!o) return;
    if (!drag.moved && Math.hypot(screen.x - drag.screen.x, screen.y - drag.screen.y) < 3) return;
    drag.moved = true;
    if (drag.part === 'anchor') {
      const p = snapLs(world, event, { exclude: { landscapeId: o.id } });
      o.points = [{ x: Math.round(p.x), y: Math.round(p.y) }];
    } else {
      o.x = snap(world.x);
      o.y = snap(world.y);
    }
    syncCallout(o);
  } else if (drag.kind === 'ls-move') {
    if (!drag.moved && Math.hypot(screen.x - drag.screen.x, screen.y - drag.screen.y) < 3) return;
    drag.moved = true;
    const p0 = drag.starts.get(drag.primary);
    const raw = { x: world.x - drag.world.x, y: world.y - drag.world.y };
    const grid = { x: snap(p0.x + raw.x) - p0.x, y: snap(p0.y + raw.y) - p0.y };
    // Умные направляющие (core/guides.js) приоритетнее сетки; Shift — без них.
    if (drag.guides === undefined) drag.guides = landscapeGuideSession(objects, drag);
    const { x: dx, y: dy } = guideDelta(drag.guides, raw, grid, event);
    for (const o of objects) {
      const s = drag.starts.get(o.id);
      if (!s) continue;
      o.x = s.x + dx;
      o.y = s.y + dy;
      if (s.points) o.points = s.points.map((p) => ({ x: p.x + dx, y: p.y + dy }));
    }
  } else if (drag.kind === 'ls-rotate') {
    const o = objects.find((x) => x.id === drag.id);
    if (!o) return;
    drag.moved = true;
    const ang = Math.atan2(world.y - drag.center.y, world.x - drag.center.x);
    const raw = drag.startRot + ((ang - drag.startAngle) * 180) / Math.PI;
    const step = event?.shiftKey ? 1 : 15;
    // Шаг — от угла «по экрану»: объект, стоящий ровно на повёрнутом виде, им и остаётся.
    const base = screenAngle(state.view.rotation);
    o.rotation = Math.round(((((base + Math.round((raw - base) / step) * step) % 360) + 360) % 360) * 100) / 100;
    if (drag.kids) rotateChildren(objects, o, o.rotation - drag.startRot, drag.kids);
  } else if (drag.kind === 'ls-frame') {
    drag.moved = true;
    let res;
    if (drag.op === 'rotate') {
      const deg = groupRotateDeg(drag.center, drag.startPoint, world, event?.shiftKey ? 1 : 15);
      state.lsHandleDeg = deg;
      res = { objects: rotateLs(drag.starts, drag.center, deg) };
    } else if (drag.op === 'stretch') {
      res = stretchLs(drag.starts, drag.frame, drag.edge, world, { snap: snapStep(), moveOnly: drag.moveOnly });
    } else {
      res = scaleLs(drag.starts, drag.frame, drag.corner, world, { snap: snapStep(), about: drag.about, moveOnly: drag.moveOnly });
    }
    applyFrameResult(objects, res.objects);
    if (drag.starts.length === 1) updateLiveMeasure(objects.find((x) => x.id === drag.starts[0].id));
  } else if (drag.kind === 'ls-resize') {
    const o = objects.find((x) => x.id === drag.id);
    if (!o) return;
    const def = landscapeDef(o.kind);
    drag.moved = true;
    const d = rotate(world.x - drag.anchor.x, world.y - drag.anchor.y, -(o.rotation || 0));
    let w = Math.max(1, drag.sign[0] * d.x);
    let h = Math.max(1, drag.sign[1] * d.y);
    if (def.lockAspect) { w = Math.max(w, h); h = w; }
    resizeObject(o, snap(w), snap(h));
    const c = rotate((drag.sign[0] * o.w) / 2, (drag.sign[1] * o.h) / 2, o.rotation || 0);
    o.x = drag.anchor.x + c.x;
    o.y = drag.anchor.y + c.y;
    if (drag.kids) refitChildren(objects, o, drag.box0, drag.kids);
  }
  requestDraw();
}

// Esc во время жеста «тянуть ребро»: контур — как до жеста, без записи истории.
export function cancelLandscapeDrag(drag) {
  if (drag?.kind !== 'ls-edge') return false;
  const o = landscapeObjects().find((x) => x.id === drag.id);
  if (o && drag.moved) {
    o.points = drag.points0.map((p) => ({ x: p.x, y: p.y }));
    syncShape(o);
    updateLiveMeasure(o);
  }
  state.lsEdge = null;
  requestDraw();
  return true;
}

export function landscapeDragEnd(drag) {
  if (drag.kind === 'ls-sec-vertex') { sectionDragEnd(drag); return; }
  if (drag.kind === 'ls-draw-rect') {
    const tool = state.tool;
    if (tool?.kind !== 'draw-landscape') return;
    if (drag.moved && tool.rect) finishLandscapeDraw();
    else addDraftPoint(drag.start, drag.screen);
    return;
  }
  if (drag.kind === 'ls-vertex' && !drag.moved) {
    if (drag.insert) {
      // Клик по «+» на ребре — вершина в середине ребра.
      const o = landscapeObjects().find((x) => x.id === drag.id);
      if (!o) return;
      const a = o.points[drag.index];
      const b = o.points[(drag.index + 1) % o.points.length];
      mutate(() => { insertVertex(o, drag.index, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }); });
      state.lsVertex = { id: o.id, index: drag.index + 1 };
    }
    requestDraw();
    return;
  }
  if (drag.kind === 'ls-frame') state.lsHandleDeg = null;
  if (!drag.moved) {
    // Повторный клик по выбранному — следующий режим ручек (у линии/контура
    // второй клик двойного — правка вершин, режим не меняем).
    if (drag.kind === 'ls-move' && drag.wasSelected) {
      const o = landscapeObjects().find((x) => x.id === drag.primary);
      if (!(drag.detail >= 2 && o && isShapeKind(o.kind))) cycleLandscapeHandle();
    }
    // Клик по ребру без сдвига — как по самому контуру (двойной — вставка вершины).
    if (drag.kind === 'ls-edge' && drag.detail < 2) cycleLandscapeHandle();
    requestDraw();
    return;
  }
  const objects = landscapeObjects();
  if (drag.kind === 'ls-frame') {
    for (const s of drag.starts) {
      const o = objects.find((x) => x.id === s.id);
      if (isPlanter(o)) refitChildren(objects, o);
    }
  }
  // Растение, перетащенное на короб, садится в него; за борт — отвязывается.
  if (drag.kind === 'ls-move') settleMoved(objects, [...drag.starts.keys()]);
  if (drag.kind === 'ls-vertex' || drag.kind === 'ls-edge') {
    const o = objects.find((x) => x.id === drag.id);
    if (isPlanter(o)) refitChildren(objects, o);
  }
  pushHistory(drag.before);
  afterChange();
}

// Двойной клик: завершить рисование, удалить вершину (по ней) или вставить вершину на ребре.
export function landscapeDblClick(world) {
  if (state.tool?.kind === 'ls-route') return finishOutdoorRoute();
  if (state.tool?.kind === 'draw-landscape') { finishLandscapeDraw(); return true; }
  if (state.tool?.kind === 'ls-array') return arrayDblClick();
  if (isSectionTool()) { finishSection(); return true; }
  if (state.tool) return false;
  if (sectionDblClick(world)) return true;
  const objs = selectedObjects();
  if (objs.length !== 1) return false;
  const o = objs[0];
  if (o.locked || !isShapeKind(o.kind)) return false;
  const tol = 8 / state.view.scale;
  // Двойной клик по линии/контуру — правка вершин: ручки — в режим «Выбор».
  if (state.itemHandle?.id === `ls:${o.id}`) state.itemHandle = null;
  const vertex = hitVertex(o, world, tol);
  if (vertex >= 0) { removeVertexAt(o, vertex); requestDraw(); return true; }
  const seg = hitEdge(o, world, Math.max(tol, (o.width || 0) / 2));
  if (seg < 0) return false;
  const p = snapPoint(world, false, o.id);
  state.drawSnap = null;
  mutate(() => { insertVertex(o, seg, p); });
  state.lsVertex = { id: o.id, index: seg + 1 };
  requestDraw();
  return true;
}

function removeVertexAt(o, index) {
  if (o.points.length <= minVertices(o)) {
    toast(`Меньше ${minVertices(o)} вершин нельзя — удалите объект целиком`);
    return false;
  }
  mutate(() => { removeVertex(o, index); });
  state.lsVertex = null;
  return true;
}

// Рамка: объекты, центр которых внутри (Shift — добавить к выделению).
export function applyLandscapeMarquee(m) {
  if (Math.abs(m.x2 - m.x1) < 6 && Math.abs(m.y2 - m.y1) < 6) return;
  const poly = [screenToWorld(m.x1, m.y1), screenToWorld(m.x2, m.y1), screenToWorld(m.x2, m.y2), screenToWorld(m.x1, m.y2)];
  const found = objectsInPolygon(landscapeObjects(), poly).map((o) => o.id);
  selectLandscape(m.add ? [...new Set([...selectedIds(), ...found])] : found);
}

// Перетаскивание карточки на холст.
export function dropLandscape(kind, world) {
  if (!landscapeDef(kind)) return false;
  cancelTool();
  placeLandscapeAt(kind, world);
  return true;
}

// ------------------------------------------------------------ Действия

export function deleteLandscapeSelection() {
  const all = selectedObjects();
  if (!all.length) return;
  const own = editable(all).map((o) => o.id);
  if (!own.length) { toast('Объект закреплён — снимите замок в свойствах'); return; }
  // Короб удаляется вместе с растениями внутри.
  const gone = withCallouts(landscapeObjects(), withChildren(landscapeObjects(), own));
  mutate(() => {
    const site = state.project.site;
    site.landscape.objects = landscapeObjects().filter((o) => !gone.has(o.id));
    pruneParents(site.landscape.objects);
  });
  state.lsVertex = null;
  selectLandscape(all.filter((o) => !gone.has(o.id)).map((o) => o.id));
}

// Выделение + растения выбранных коробов.
function selectionGroup() {
  const objs = editable(selectedObjects());
  const ids = withChildren(landscapeObjects(), objs.map((o) => o.id));
  return { objs, all: landscapeObjects().filter((o) => ids.has(o.id)) };
}

export function nudgeLandscape(dx, dy) {
  const { objs, all } = selectionGroup();
  if (!objs.length) return;
  mutate(() => {
    for (const o of all) translateObject(o, dx, dy);
    settleMoved(landscapeObjects(), all.map((o) => o.id));
  });
}

// R — поворот на 90°: одиночный — вокруг центра, группа — вокруг центра группы.
export function rotateLandscape90() {
  const { objs, all } = selectionGroup();
  if (!objs.length) return;
  const cx = objs.reduce((s, o) => s + o.x, 0) / objs.length;
  const cy = objs.reduce((s, o) => s + o.y, 0) / objs.length;
  mutate(() => { for (const o of all) rotateObjectAbout(o, cx, cy, 90); });
}

// Выделенные + растения выбранных коробов (копирование).
function withPlantings(objs) {
  const ids = withChildren(landscapeObjects(), objs.map((o) => o.id));
  return landscapeObjects().filter((o) => ids.has(o.id));
}

export function copyLandscapeSelection() {
  const objs = selectedObjects();
  if (!objs.length) return false;
  clipboard = { objects: JSON.parse(JSON.stringify(withPlantings(objs))), pastes: 0 };
  toast(objs.length > 1 ? `Скопировано объектов: ${objs.length}` : 'Скопировано — Ctrl+V вставит рядом');
  return true;
}

function pasteObjects(list, offset) {
  const copies = cloneGroup(list, offset, offset);
  mutate(() => {
    landscapeObjects().push(...copies);
    settleMoved(landscapeObjects(), copies.map((o) => o.id));
  });
  // Выделяются верхние объекты (растения едут с коробом).
  const ids = new Set(copies.map((o) => o.id));
  selectLandscape(copies.filter((o) => !o.parent || !ids.has(o.parent)).map((o) => o.id));
}

export function pasteLandscape() {
  if (!clipboard) { toast('Сначала выберите объект и нажмите Ctrl+C'); return false; }
  clipboard.pastes += 1;
  pasteObjects(clipboard.objects, 1000 * clipboard.pastes);
  return true;
}

export function duplicateLandscapeSelection() {
  const objs = selectedObjects();
  if (objs.length) pasteObjects(withPlantings(objs), 1000);
}

// «Разорвать» (как EXPLODE в AutoCAD): выбранные дорожки → отдельные плиты,
// доски или участки покрытия; одна запись истории, результат — выделен.
export function explodeLandscapeSelection() {
  const targets = editable(selectedObjects()).filter(canExplode);
  if (!targets.length) { toast('Разорвать можно дорожку (плиты, настил, брусчатку, гравий, бетон)'); return []; }
  const parts = targets.map((o) => ({ o, res: explodePath(o) })).filter((x) => x.res?.objects.length);
  if (!parts.length) { toast('Дорожка слишком короткая — нечего разрывать'); return []; }
  const gone = withCallouts(landscapeObjects(), new Set(parts.map((x) => x.o.id)));
  const added = parts.flatMap((x) => x.res.objects);
  mutate(() => {
    const site = state.project.site;
    const list = landscapeObjects();
    const at = list.findIndex((o) => gone.has(o.id));
    const rest = list.filter((o) => !gone.has(o.id));
    rest.splice(Math.max(0, Math.min(at, rest.length)), 0, ...added);
    site.landscape.objects = rest;
  });
  state.lsVertex = null;
  selectLandscape(added.map((o) => o.id));
  const kinds = new Set(parts.map((x) => x.res.kind));
  const word = kinds.size > 1 ? 'объектов' : { slab: 'плит', board: 'досок и кусков', area: 'участков' }[[...kinds][0]];
  toast(`Разорвано: ${added.length} ${word} · Ctrl+Z — вернуть дорожку`);
  return added;
}

// Клавиши режима; true — нажатие обработано.
export function handleLandscapeKey(event) {
  const mod = event.ctrlKey || event.metaKey;
  if (state.tool?.kind === 'ls-array' && !mod) return handleArrayKey(event);
  if (isSectionTool() && !mod) return handleSectionKey(event);
  if (state.tool?.kind === 'ls-route' && !mod) return handleOutdoorRouteKey(event);
  if (state.tool?.kind === 'ls-flight' && !mod && event.key === 'Backspace') {
    event.preventDefault();
    state.tool.first = null;
    state.tool.cursor = null;
    state.ghostLandscape = null;
    updateFlight(state.tool);
    return true;
  }
  if (state.tool?.kind === 'draw-landscape' && !mod) {
    if (event.key === 'Enter') { event.preventDefault(); finishLandscapeDraw(); return true; }
    if (event.key === 'Backspace') { event.preventDefault(); backspaceDraft(); return true; }
    if (event.key === 'Delete') return true;
    return false; // Esc — общий обработчик (cancelTool)
  }
  if (mod && event.code === 'KeyC') { event.preventDefault(); copyLandscapeSelection(); return true; }
  if (mod && event.code === 'KeyV') { event.preventDefault(); pasteLandscape(); return true; }
  if (mod && event.code === 'KeyD') { event.preventDefault(); duplicateLandscapeSelection(); return true; }
  if (mod) return false;
  if (event.key === 'Delete' || event.key === 'Backspace') {
    event.preventDefault();
    const v = state.lsVertex;
    const o = v && selectedIds().length === 1 ? landscapeObjects().find((x) => x.id === v.id && selectedIds()[0] === x.id) : null;
    if (o && !o.locked && o.points?.[v.index]) { removeVertexAt(o, v.index); return true; }
    deleteLandscapeSelection();
    return true;
  }
  // Shift+A — «Массив» выделенного (A и Shift+A больше нигде не заняты).
  if (event.shiftKey && event.code === 'KeyA' && !state.tool && selectedIds().length) {
    event.preventDefault();
    startLandscapeArray();
    return true;
  }
  if (event.code === 'KeyR') { rotateLandscape90(); return true; }
  if (event.code === 'KeyX' && selectedObjects().some(canExplode)) { explodeLandscapeSelection(); return true; }
  // T — «Подписать»: выноска к выделенным объектам.
  if (event.code === 'KeyT' && !state.tool && selectedIds().length) { labelLandscapeSelection(); return true; }
  if (event.code === 'KeyM') return true; // зеркало ландшафту не нужно
  const nudge = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
  if (nudge && selectedIds().length) {
    event.preventDefault();
    const step = event.shiftKey ? snapStep() * 10 : snapStep();
    nudgeLandscape(nudge[0] * step, nudge[1] * step);
    return true;
  }
  return false;
}

// ------------------------------------------------------------ Выноски

// Текст выноски по умолчанию: название вида/объекта, у площадей — площадь,
// у линий — длина (как пишут на эскизах генплана).
export function calloutTextFor(o) {
  const def = landscapeDef(o.kind);
  if (!def) return 'Выноска';
  // Вид растения (Яблоня, Сирень) — по справочнику, иначе короткое название типа.
  const d = plantGroupOf(o.kind) ? plantDefaults(plantKey(o)) : null;
  const name = d?.species ? d.name : def.title.replace(/ \(.*\)$/, '');
  if (def.shape === 'poly') return `${name}\n${fmt(objectAreaM2(o))} м²`;
  if (def.shape === 'line') return `${name}\nL ${fmt(objectLengthM(o))} м`;
  return name;
}

// Точка указания на объекте: середина оси линии, иначе центр.
function anchorOf(o) {
  const def = landscapeDef(o.kind);
  if (def?.shape === 'line') {
    const path = objectPath(o);
    const p = pointAlong(path, polylineLength(path) / 2);
    return { x: p.x, y: p.y };
  }
  return { x: o.x, y: o.y };
}

// Старые автоматические подписи не хранили id объекта. Сопоставляем их
// только при единственном совпадении текста и исходной точки указания.
function withCallouts(objects, ids) {
  const targets = objects.filter((o) => o.kind !== 'callout');
  for (const note of objects) {
    if (note.kind !== 'callout') continue;
    let targetId = note.meta?.targetId;
    if (targetId === undefined) {
      const anchor = note.points?.[0];
      if (!anchor) continue;
      const matches = targets.filter((o) => {
        const at = anchorOf(o);
        return Math.hypot(at.x - anchor.x, at.y - anchor.y) < 1
          && note.meta?.text === calloutTextFor(o);
      });
      if (matches.length === 1) targetId = matches[0].id;
    }
    if (ids.has(targetId)) ids.add(note.id);
  }
  return ids;
}

// «Подписать» (T): выноска к каждому выделенному объекту, одним шагом
// истории; новые выноски выделяются (текст — правится в панели).
export function labelLandscapeSelection() {
  const targets = selectedObjects().filter((o) => o.kind !== 'callout').slice(0, 50);
  if (!targets.length) { toast('Выберите объект, который нужно подписать'); return []; }
  const deg = screenDeg();
  const t = (deg * Math.PI) / 180;
  const list = targets.map((o) => {
    const a = anchorOf(o);
    const box = isShapeKind(o.kind) ? { w: 0, h: 0 } : o;
    // Текст — вверх-вправо от объекта на экране (смещение в осях экрана).
    const dx = Math.max(1500, Math.min(6000, box.w * 0.5 + 900));
    const dy = -Math.max(1200, Math.min(6000, box.h * 0.5 + 700));
    const ex = a.x + dx * Math.cos(t) - dy * Math.sin(t);
    const ey = a.y + dx * Math.sin(t) + dy * Math.cos(t);
    return createLandscapeObject('callout', snap(ex), snap(ey), {
      points: [a], rotation: deg, meta: { text: calloutTextFor(o), targetId: o.id },
    });
  });
  addLandscapeObjects(list);
  toast(list.length > 1 ? `Выносок: ${list.length} · Ctrl+Z — отменить` : 'Выноска добавлена — текст правится справа');
  return list;
}

function renderCalloutProps(panel, o) {
  const def = landscapeDef(o.kind);
  panel.innerHTML = `
    <h2>Выноска</h2>
    <div class="prop-block">
      <label class="prop-field"><span>Текст (Enter — новая строка)</span><textarea id="lsNoteText" rows="3" maxlength="${CALLOUT_TEXT_MAX}" ${o.locked ? 'disabled' : ''}>${escapeHtml(o.meta?.text || '')}</textarea></label>
      <div class="prop-grid">
        <label class="prop-field"><span>Знак на конце</span><select id="lsVariant">${variantOptions(def, o.variant)}</select></label>
        <label class="prop-field"><span>Высота букв, мм</span><input id="lsNoteSize" type="number" step="10" min="${CALLOUT_SIZE_MIN}" max="${CALLOUT_SIZE_MAX}" value="${Math.round(o.meta?.size || 300)}"></label>
      </div>
      <div class="prop-grid">
        <label class="prop-field"><span>Наклон текста, °</span><input id="lsRot" type="number" step="5" value="${Math.round(o.rotation || 0)}"></label>
        <button type="button" id="lsNoteLevel" class="ls-note-level" title="Текст горизонтально при текущем повороте вида">По экрану</button>
      </div>
      <label class="check-row"><input type="checkbox" id="lsLock" ${o.locked ? 'checked' : ''}><span>Замок</span></label>
      <p class="hint">Тяните круг — точку указания, квадрат — текст с полкой; за текст или линию — всю выноску. В 3D, ведомость и ТЭП выноска не входит.</p>
    </div>`;
  const text = panel.querySelector('#lsNoteText');
  text?.addEventListener('change', () => mutate(() => {
    o.meta = { ...(o.meta || {}), text: text.value.replace(/\r\n?/g, '\n').slice(0, CALLOUT_TEXT_MAX) };
    syncCallout(o);
  }));
  panel.querySelector('#lsVariant')?.addEventListener('change', (e) => mutate(() => { o.variant = e.target.value; }));
  panel.querySelector('#lsNoteSize')?.addEventListener('change', (e) => {
    const v = Number(e.target.value);
    if (!(v > 0)) return;
    mutate(() => {
      o.meta = { ...(o.meta || {}), size: Math.min(CALLOUT_SIZE_MAX, Math.max(CALLOUT_SIZE_MIN, Math.round(v))) };
      syncCallout(o);
    });
  });
  const setRot = (deg) => mutate(() => { o.rotation = deg; syncCallout(o); });
  panel.querySelector('#lsRot')?.addEventListener('change', (e) => {
    const v = Number(e.target.value);
    if (Number.isFinite(v)) setRot(Math.round(v));
  });
  panel.querySelector('#lsNoteLevel')?.addEventListener('click', () => setRot(screenDeg()));
  panel.querySelector('#lsLock')?.addEventListener('change', (e) => mutate(() => {
    if (e.target.checked) o.locked = true; else delete o.locked;
  }));
}

// ------------------------------------------------------------ Ведомость растений

// Раскрытая строка ведомости (переживает перерисовку панели).
let openPlant = null;

function plantTableHtml(sch) {
  if (!sch.rows.length) return '<p class="hint">Растений пока нет — ведомость заполнится сама.</p>';
  const unitPrice = (r) => (r.unit === 'шт' ? 'Цена за шт.' : `Цена за ${r.unit}`);
  const groups = sch.groups.map((g) => `
    <div class="ls-plant-group"><span>${escapeHtml(g.title)}</span>${g.total ? `<strong>${fmtMoney(g.total)}</strong>` : ''}</div>
    ${g.rows.map((r) => `
    <details class="ls-plant" data-plant="${escapeHtml(r.key)}" ${openPlant === r.key ? 'open' : ''}>
      <summary>
        <span class="ls-plant-name">${escapeHtml(r.title)}${r.note ? `<small>${escapeHtml(r.note)}</small>` : ''}</span>
        <span class="ls-plant-qty">${fmtQty(r)} ${r.unit}</span>
        <span class="ls-plant-sum">${r.sum != null ? fmtMoney(r.sum) : '—'}</span>
      </summary>
      <div class="prop-grid">
        <label class="prop-field"><span>${r.unit === 'м²' ? 'Размер посадки' : 'Высота посадки'}, мм</span><input type="number" data-pf="size" min="0" step="50" placeholder="—" value="${r.size ?? ''}"></label>
        <label class="prop-field"><span>${unitPrice(r)}</span><input type="number" data-pf="price" min="0" step="any" placeholder="нет" value="${r.price ?? ''}"></label>
      </div>
      <label class="prop-field"><span>Цветение / примечание</span><input type="text" data-pf="note" maxlength="200" placeholder="${escapeHtml(r.noteDefault || '')}" value="${escapeHtml(r.note || '')}"></label>
    </details>`).join('')}`).join('');
  return `${groups}
    <div class="prop-row ls-plant-total"><span>Итого озеленение</span><strong id="lsPlantTotal">${fmtMoney(sch.total)}</strong></div>
    ${sch.unpriced ? `<p class="hint">Без цены: ${sch.unpriced} поз. — откройте строку и впишите цену.</p>` : ''}`;
}

function bindPlantTable(panel) {
  panel.querySelectorAll('details.ls-plant').forEach((d) => d.addEventListener('toggle', () => {
    if (d.open) openPlant = d.dataset.plant; else if (openPlant === d.dataset.plant) openPlant = null;
  }));
  panel.querySelectorAll('details.ls-plant [data-pf]').forEach((input) => input.addEventListener('change', () => {
    const key = input.closest('details').dataset.plant;
    openPlant = key;
    const field = input.dataset.pf;
    const raw = input.value.trim();
    mutate(() => { setPlantEntry(state.project.site.landscape, key, { [field]: field === 'note' ? raw : raw === '' ? null : Number(raw) }); });
  }));
}

// ------------------------------------------------------------ Каталог слева

export function bindLandscapeLibrary() {
  const tabs = el('lsTabs');
  const search = el('lsSearch');
  const items = el('lsItems');
  bindOutdoorRouteProfile();
  el('lsQuickTools').addEventListener('click', (event) => {
    const key = event.target.closest('[data-ls-quick]')?.dataset.lsQuick;
    if (!key) return;
    if (key === 'stairs') startOutdoorStairs();
    else if (key === 'route') startOutdoorRoute();
    else startDrawLandscape('path', PATH_PRESETS[key]);
    closeLibrarySheet();
  });
  search.addEventListener('input', () => {
    items.scrollTop = 0;
    renderLandscapeItems();
  });
  for (const cat of LANDSCAPE_CATEGORIES) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.dataset.lsCat = cat.id;
    btn.textContent = cat.title;
    btn.addEventListener('click', () => {
      category = cat.id;
      search.value = '';
      items.scrollTop = 0;
      renderLandscapeItems();
    });
    tabs.appendChild(btn);
  }
}

export function renderLandscapeLibrary() {
  if (state.modeName === 'landscape') renderLandscapeItems();
}

function renderLandscapeItems() {
  const box = el('lsItems');
  if (!box) return;
  const q = (el('lsSearch')?.value || '').trim();
  el('lsQuickTools').hidden = Boolean(q);
  const rail = el('lsTabs');
  rail.hidden = Boolean(q);
  for (const button of rail.children) {
    const active = !q && button.dataset.lsCat === category;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  }
  const list = q ? searchLandscape(q) : landscapeByCategory(category);
  box.innerHTML = '';
  if (!list.length) { box.innerHTML = '<p class="empty-hint">Ничего не нашлось</p>'; return; }
  let group = null;
  for (const def of list) {
    if (!q && def.group !== group) {
      group = def.group;
      const h = document.createElement('div');
      h.className = 'ls-group';
      h.textContent = group;
      box.appendChild(h);
    }
    const shape = isPathShape(def);
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'furniture-chip ls-chip';
    chip.draggable = true;
    chip.dataset.lsKind = def.kind;
    chip.title = shape
      ? `«${def.title}»: клик — рисовать ${def.shape === 'line' ? 'линию по точкам' : 'контур по точкам или прямоугольником'}`
      : `«${def.title}»: клик — ставить курсором, или перетащите на участок`;
    const active = state.tool?.lsKind === def.kind;
    chip.classList.toggle('active', active);
    chip.setAttribute('aria-pressed', String(active));
    const preview = document.createElement('canvas');
    preview.width = 240;
    preview.height = 132;
    chip.appendChild(preview);
    const name = document.createElement('span');
    name.className = 'chip-name';
    name.textContent = def.title;
    chip.appendChild(name);
    const size = document.createElement('span');
    size.className = 'chip-size';
    size.textContent = shape
      ? (def.shape === 'line' ? `рисовать · ${(def.h / 1000).toFixed(2)} м` : 'рисовать контур')
      : def.lockAspect ? `⌀ ${(def.w / 1000).toFixed(1)} м` : `${(def.w / 1000).toFixed(1)}×${(def.h / 1000).toFixed(1)} м`;
    chip.appendChild(size);
    try { drawLandscapePreview(preview, def.kind, { style: state.lsStyle }); } catch { /* превью не критично */ }
    chip.addEventListener('dragstart', (e) => {
      chip.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'copy';
      e.dataTransfer.setData(LANDSCAPE_MIME, def.kind);
    });
    chip.addEventListener('dragend', () => chip.classList.remove('dragging'));
    chip.addEventListener('click', () => {
      if (active) { cancelTool(); selectObject(state.selection); renderLandscapeLibrary(); }
      else { startPlaceLandscape(def.kind); closeLibrarySheet(); }
    });
    box.appendChild(chip);
  }
}

// ------------------------------------------------------------ Свойства

const m = (mm) => (mm / 1000).toFixed(2);
const fmt = (v, d = 1) => v.toFixed(d).replace('.', ',');

// Замечания по текущим данным (рисунок считает их сам, на каждом кадре).
function currentWarnings() {
  const footprints = buildingSiteCheck(state.project).footprint.map((f) => f.corners);
  return landscapeWarnings(landscapeObjects(), { boundary: state.project.site.boundary, footprints });
}

const plantOptions = (value) => PLANT_KINDS.map((k) => `<option value="${k}" ${k === value ? 'selected' : ''}>${escapeHtml(landscapeDef(k).title)}</option>`).join('');
const variantOptions = (def, value) => def.variants.map((v) => `<option value="${v.id}" ${v.id === value ? 'selected' : ''}>${escapeHtml(v.title)}</option>`).join('');

// ------------------------------------------------------------ Дорожка: углы и укладка

// Мини-иконки типа угла (Г-образная полоса, 20×20).
const CORNER_ICON = {
  miter: '<path d="M2 4H14V18H8V10H2Z"/><path d="M8 10L14 4"/>',
  butt: '<path d="M2 4H14V18H8V10H2Z"/><path d="M8 10H14"/>',
  slab: '<path d="M2 4H14V18H8V10H2Z"/><path d="M8 4V10H14"/>',
  round: '<path d="M2 4H8A6 6 0 0 1 14 10V18H8V10H2Z"/>',
};
const cornerIcon = (id) => `<svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round">${CORNER_ICON[id]}</svg>`;
const options = (list, value) => list.map((x) => `<option value="${x.id}" ${x.id === value ? 'selected' : ''}>${escapeHtml(x.title)}</option>`).join('');

const EXPLODE_TEXT = { stepping: 'Разорвать на плиты', deck: 'Разорвать на доски' };
const PATH_LEVELS = [
  { id: 'terrain', title: 'По рельефу' }, { id: 'fixed', title: 'На одной отметке' },
  { id: 'graded', title: 'Уклон между отметками' },
];

function pathLevelFields(o, thickness = false) {
  const mode = o.meta?.pathLevel || 'terrain';
  return `<label class="prop-field"><span>Посадка дорожки</span><select id="lsPathLevel">${options(PATH_LEVELS, mode)}</select></label>
    ${elevField('lsElev', mode === 'graded' ? 'Начало, мм от нуля участка' : mode === 'fixed' ? 'Верх покрытия, мм от нуля участка' : 'Подъём над землёй, мм', o.elev, 'авто')}
    ${mode === 'graded' ? elevField('lsElevTo', 'Конец, мм от нуля участка', o.elevTo, 'авто') : ''}
    ${thickness && o.variant === 'stepping' ? mmField('lsSlabThickness', 'Толщина плиты, мм', pathSlabThickness(o), 40, 300) : ''}`;
}

// Поля углов и укладки линейного объекта (дорожка; у ограждения — только угол).
function pathPropsHtml(o, def) {
  if (def.shape !== 'line' || (o.kind !== 'path' && o.kind !== 'fence-line')) return '';
  const corner = objectCorner(o);
  const list = o.kind === 'path' ? PATH_CORNERS : PATH_CORNERS.filter((c) => c.id === 'miter' || c.id === 'round');
  const smooth = o.smooth && o.points.length >= 3;
  const cornerBlock = smooth ? '<p class="hint">Сглаженная линия — углов нет</p>' : `
    <div class="prop-field"><span>Угол</span>
      <div class="seg ls-corner" role="radiogroup" aria-label="Тип угла">
        ${list.map((c) => `<label class="seg-opt${c.id === corner ? ' active' : ''}" title="${escapeHtml(c.hint)}"><input type="radio" name="lsCorner" value="${c.id}" ${c.id === corner ? 'checked' : ''}>${cornerIcon(c.id)}<span>${escapeHtml(c.title)}</span></label>`).join('')}
      </div>
    </div>`;
  const v = state.lsVertex?.id === o.id ? state.lsVertex.index : -1;
  const vertexBlock = !smooth && v > 0 && v < o.points.length - 1 ? `
    <label class="prop-field"><span>Угол в вершине ${v + 1}</span><select id="lsVCorner">
      <option value="">Как у всей линии</option>${options(list, o.vcorners?.[v] || '')}
    </select></label>` : '';
  if (o.kind !== 'path') return cornerBlock + vertexBlock;
  const P = layingParams(o, o.width || def.h);
  const strict = P.strict;
  let laying = '';
  if (o.variant === 'stepping') {
    laying = `
      <div class="prop-grid">
        <label class="prop-field"><span>Плита вдоль, мм</span><input id="lsSlabL" type="number" step="10" min="100" max="5000" value="${P.along}"></label>
        <label class="prop-field"><span>Поперёк, мм</span><input id="lsSlabW" type="number" step="10" min="100" max="6000" value="${P.across ?? o.width}"></label>
      </div>
      <div class="prop-grid">
        <label class="prop-field"><span>Зазор, мм</span><input id="lsGap" type="number" step="10" min="0" max="2000" value="${P.gap}"></label>
        <label class="prop-field"><span>Шаг от начала, мм</span><input id="lsOffset" type="number" step="10" value="${P.offset}" ${strict ? '' : 'disabled title="Только для строгой укладки"'}></label>
      </div>
      <label class="check-row"><input type="checkbox" id="lsStaggerSlabs"${o.meta?.staggerSlabs ? ' checked' : ''}><span>Чередовать размер и смещение плит</span></label>
      <label class="prop-field"><span>Выравнивание</span><select id="lsAlign">${options(PATH_ALIGNS, P.align)}</select></label>
      ${strict ? `<label class="check-row"><input type="checkbox" id="lsChecker" ${P.checker ? 'checked' : ''}><span>Тон в шахматном порядке</span></label>` : ''}`;
  } else if (o.variant === 'deck') {
    laying = `
      <label class="prop-field"><span>Раскладка досок</span><select id="lsDeck">${options(DECK_PATTERNS, P.pattern)}</select></label>
      <div class="prop-grid">
        <label class="prop-field"><span>Доска, мм</span><input id="lsBoardW" type="number" step="5" min="40" max="400" value="${P.along}"></label>
        <label class="prop-field"><span>Длина доски, мм</span><input id="lsBoardL" type="number" step="50" min="200" max="6000" value="${P.boardL}" ${P.pattern === 'stagger' ? '' : 'disabled title="Для раскладки со сдвигом стыков"'}></label>
      </div>
      <div class="prop-grid">
        <label class="prop-field"><span>Зазор, мм</span><input id="lsGap" type="number" step="1" min="0" max="50" value="${P.gap}"></label>
        <label class="prop-field"><span>Шаг от начала, мм</span><input id="lsOffset" type="number" step="5" value="${P.offset}" ${strict ? '' : 'disabled title="Только для строгой укладки"'}></label>
      </div>
      ${strict ? `<label class="check-row"><input type="checkbox" id="lsChecker" ${P.checker ? 'checked' : ''}><span>Тон через доску</span></label>` : ''}`;
  }
  const layingBlock = o.variant === 'stepping' || o.variant === 'deck' ? `
    <label class="prop-field"><span>Укладка</span><select id="lsLaying">${options(PATH_LAYINGS, strict ? 'strict' : 'natural')}</select></label>
    ${laying}` : '';
  return `${cornerBlock}${vertexBlock}${layingBlock}
    ${o.locked ? '' : `<button type="button" id="lsExplode" title="Каждая плита/доска/участок станет отдельным объектом">${escapeHtml(EXPLODE_TEXT[o.variant] || 'Разорвать на участки')} (X)</button>`}`;
}

function bindPathProps(panel, o) {
  panel.querySelector('#lsStaggerSlabs')?.addEventListener('change', (event) => {
    mutate(() => { o.meta.staggerSlabs = event.target.checked; });
  });
  const set = (key, value) => mutate(() => {
    if (value === null || value === undefined || value === '') delete o[key]; else o[key] = value;
  });
  panel.querySelectorAll('input[name="lsCorner"]').forEach((input) => input.addEventListener('change', (e) => set('corner', e.target.value)));
  panel.querySelector('#lsVCorner')?.addEventListener('change', (e) => mutate(() => {
    const v = state.lsVertex?.index ?? -1;
    if (v < 0) return;
    if (!Array.isArray(o.vcorners) || o.vcorners.length !== o.points.length) o.vcorners = o.points.map(() => null);
    o.vcorners[v] = e.target.value || null;
    if (!o.vcorners.some(Boolean)) delete o.vcorners;
  }));
  panel.querySelector('#lsLaying')?.addEventListener('change', (e) => set('laying', e.target.value === 'strict' ? 'strict' : null));
  panel.querySelector('#lsAlign')?.addEventListener('change', (e) => set('align', e.target.value === 'center' ? null : e.target.value));
  panel.querySelector('#lsDeck')?.addEventListener('change', (e) => set('deck', e.target.value === 'stagger' ? 'stagger' : null));
  panel.querySelector('#lsChecker')?.addEventListener('change', (e) => set('checker', e.target.checked ? true : null));
  const numField = (id, key, lo, hi) => panel.querySelector(id)?.addEventListener('change', (e) => {
    const raw = e.target.value.trim();
    const v = Number(raw);
    if (raw === '') set(key, null);
    else if (Number.isFinite(v)) set(key, Math.min(hi, Math.max(lo, Math.round(v))));
  });
  numField('#lsSlabL', 'slabL', 100, 5000);
  numField('#lsSlabW', 'slabW', 100, 6000);
  numField('#lsGap', 'gap', 0, 2000);
  numField('#lsOffset', 'offset', -100000, 100000);
  numField('#lsBoardW', 'boardW', 40, 400);
  numField('#lsBoardL', 'boardL', 200, 6000);
  panel.querySelector('#lsExplode')?.addEventListener('click', () => explodeLandscapeSelection());
}

// ---------------------------------------- Лестница, короб, бордюр, посадки

const CURB_TITLES = { concrete: 'Бетон', stone: 'Камень', metal: 'Сталь', wood: 'Дерево' };
const mmField = (id, title, value, min, max, step = 10) => `<label class="prop-field"><span>${title}</span><input id="${id}" type="number" step="${step}" min="${min}" max="${max}" value="${Math.round(value)}"></label>`;

// Отметка уровня (необязательно): пусто — объект на земле.
const elevField = (id, title, value, placeholder = 'по земле') => `<label class="prop-field"><span>${title}</span><input id="${id}" type="number" step="10" min="-20000" max="20000" placeholder="${placeholder}" value="${Number.isFinite(value) ? Math.round(value) : ''}"></label>`;

function elevHtml(o) {
  if (!ELEV_KINDS.has(o.kind)) return '';
  if (o.kind === 'path') return pathLevelFields(o, true);
  if (['slab', 'board'].includes(o.kind) && !isLevelPath(o)) return '';
  if (o.kind === 'sunken-lounge') {
    return `<div class="prop-grid">${elevField('lsElev', 'Пол лаунжа, мм от нуля участка', o.elev, 'авто')}
      ${elevField('lsElevTo', 'Вход, мм от нуля участка', o.elevTo, 'авто')}</div>
      <p class="hint">По умолчанию пол на 600 мм ниже земли. Верхняя ступень примыкает к настилу или земле у входа.</p>`;
  }
  if (o.kind === 'stairs-out') {
    return `<div class="prop-grid">
        ${elevField('lsElev', 'Отметка низа, мм', o.elev)}
        ${elevField('lsElevTo', 'Отметка верха, мм', o.elevTo, 'по высоте подъёма')}
      </div>`;
  }
  const title = o.kind === 'retaining-wall' ? 'Отметка низа, мм' : 'Отметка поверхности, мм от нуля участка';
  return elevField('lsElev', title, o.elev) + (PLATFORM_KINDS.has(o.kind) && o.kind !== 'sunken-lounge' ? `
    <details><summary>Лестница к краю площадки</summary>
      ${elevField('lsStLower', 'Нижняя площадка, мм от нуля участка', null)}
      <button type="button" id="lsAttachStairs">Указать край на плане</button>
    </details>` : '');
}

function retainingHtml(o) {
  const ri = retainingInfo(o);
  return `
      <div class="prop-grid">
        ${mmField('lsRwH', 'Высота над низом, мм', ri.height, 100, 6000)}
        ${mmField('lsRwDrop', 'Перепад грунта, мм', ri.drop, 0, 6000)}
      </div>
      <label class="prop-field"><span>Сторона верха (грунт выше)</span><select id="lsRwUpper">${options(RETAINING_SIDES, ri.upper)}</select></label>
      <label class="check-row"><input type="checkbox" id="lsRwCap" ${ri.cap ? 'checked' : ''}><span>Капа (парапетный камень) со свесом 30 мм</span></label>
      ${ri.cap ? mmField('lsRwCapH', 'Толщина капы, мм', ri.capH, 20, 300) : ''}
      <div class="prop-row"><span>Парапет над верхом грунта</span><strong>${Math.round(ri.parapet)} мм</strong></div>
      <div class="prop-row"><span>Объём ${o.variant === 'concrete' || o.variant === 'corten' ? 'бетона' : 'кладки'}</span><strong id="lsRwVol">${ri.volume.toFixed(2).replace('.', ',')} м³</strong></div>
      <p class="hint">Штрихи на «Чертеже» — от кромки низа в сторону низа · фундамент в объём не входит</p>`;
}

function buildPropsHtml(o, def) {
  return elevHtml(o) + buildPropsCore(o, def);
}

function buildPropsCore(o, def) {
  const objects = landscapeObjects();
  if (o.kind === 'retaining-wall') return retainingHtml(o);
  if (o.kind === 'stairs-out') {
    const st = stairsInfo(o);
    const blondel = Math.round(2 * st.riser + st.tread);
    return `
      <div class="prop-grid">
        ${stairsDrop(o) === null ? mmField('lsStRise', 'Высота подъёма, мм', o.height || 0, 0, MAX_STAIR_RISE) : `<div class="prop-row"><span>Перепад</span><strong>${o.height} мм</strong></div>`}
        ${mmField('lsStSteps', 'Ступеней', st.steps, 1, 60, 1)}
        ${mmField('lsStTread', 'Проступь, мм', st.tread, 200, 1200)}
        ${mmField('lsStFlight', 'Ширина марша, мм', st.flight, 300, 12000, 50)}
        ${mmField('lsStLanding', 'Доп. длина площадки, мм', st.landing, 0, 6000, 50)}
      </div>
      <label class="check-row"><input type="checkbox" id="lsStAuto" ${st.auto ? 'checked' : ''}><span>Число ступеней — авто (подступенок ≈ 150 мм)</span></label>
      <label class="check-row"><input type="checkbox" id="lsStCheeks" ${st.cheek ? 'checked' : ''}><span>Боковые подпорные борта</span></label>
      ${st.cheek ? mmField('lsStCheekW', 'Толщина борта, мм', st.cheek, 50, 600) : ''}
      <div class="prop-row"><span>Подступенок</span><strong id="lsStRiser">${Math.round(st.riser)} мм</strong></div>
      <div class="prop-row"><span>Длина в плане × ширина</span><strong>${m(o.h)} × ${m(o.w)} м</strong></div>
      ${o.meta?.measured ? '<button type="button" id="lsStResample">Считать отметки заново</button>' : ''}
      ${o.meta?.stairLinks ? '<div class="prop-row"><span>Привязана к площадке или дорожке</span><button type="button" id="lsDetachStair">Отвязать</button></div>' : ''}
      <p class="hint">2h + b = ${blondel} мм${blondel < 600 || blondel > 680 ? ' — удобно 600–660' : ' — удобно'} · стрелка — «вверх»</p>`;
  }
  if (isPlanter(o)) {
    const fill = o.meta?.fill || 'soil';
    const kids = childrenOf(objects, o.id).length;
    return `
      <div class="prop-grid">
        ${mmField('lsPlWall', 'Толщина борта, мм', planterWall(o), 40, 600)}
        ${mmField('lsPlHeight', 'Высота борта, мм', o.height || 0, 0, 1500)}
      </div>
      <label class="prop-field"><span>Засыпка</span><select id="lsPlFill">${options(PLANTER_FILLS, fill)}</select></label>
      <div class="prop-row"><span>Растений внутри</span><strong id="lsPlKids">${kids}</strong></div>`;
  }
  let out = '';
  if (o.parent) {
    const box = objects.find((x) => x.id === o.parent);
    if (box) {
      out += `<div class="prop-row"><span>В коробе</span><strong>${escapeHtml(landscapeDef(box.kind).title)}</strong></div>
        <button type="button" class="link" id="lsUnparent">Отвязать от короба</button>`;
    }
  }
  if (CURB_HOSTS.has(o.kind)) {
    const c = o.curb;
    out += `<label class="check-row"><input type="checkbox" id="lsCurb" ${c ? 'checked' : ''}><span>Бордюр по ${def.shape === 'line' ? 'краям' : 'периметру'}</span></label>`;
    if (c) {
      out += `<div class="prop-grid">
          ${mmField('lsCurbW', 'Ширина бордюра, мм', c.width, 20, 400)}
          ${mmField('lsCurbH', 'Над землёй, мм', c.height, 0, 600)}
        </div>
        <label class="prop-field"><span>Материал бордюра</span><select id="lsCurbVar">${options(CURB_MATERIALS.map((id) => ({ id, title: CURB_TITLES[id] })), c.variant)}</select></label>`;
    }
  }
  return out;
}

function planterFillHtml(o) {
  if (!isPlanter(o)) return '';
  const plants = PLANTER_PLANTS.map((id) => ({ id, title: landscapeDef(id).title }));
  return `
    <h3>Посадить внутрь</h3>
    <div class="prop-block">
      <label class="prop-field"><span>Растение</span><select id="lsInKind">${options(plants, helper.inside)}</select></label>
      <label class="prop-field"><span>Густота</span><input id="lsInDensity" type="range" min="0.1" max="1" step="0.05" value="${helper.insideDensity}"></label>
      <button type="button" id="lsInGo">Посадить в короб</button>
      <p class="hint">Перетащите растение из каталога на короб — оно сядет внутрь и будет двигаться, поворачиваться и удаляться вместе с коробом. Вытащите за борт — отвяжется.</p>
    </div>`;
}

function changePlatformSurface(panel, object, changes) {
  const terrain = groundFn(state.project);
  const ground = terrain(object.x, object.y) - terrain.siteDatum;
  const edit = platformLevelEdit(landscapeObjects(), object, ground);
  const next = { ...object, ...changes };
  const level = Math.round(platformTop(next, ground));
  if (level < edit.min || level > edit.max) {
    toast(`Допустимая отметка: ${edit.min}…${edit.max} мм`);
    renderLandscapeProps(panel);
    return;
  }
  mutate(() => {
    setPlatformLevel(edit, level);
    Object.assign(object, changes);
    if (next.elev == null) delete object.elev;
  });
}

function keepStairLanding(o, update) {
  if (!o.meta?.measured) { update(); return; }
  const before = landscapeWorld(o, 0, -o.h / 2);
  update();
  const after = landscapeWorld(o, 0, -o.h / 2);
  o.x = Math.round(o.x + before.x - after.x);
  o.y = Math.round(o.y + before.y - after.y);
}

function bindBuildProps(panel, o) {
  const val = (id) => Number(panel.querySelector(id)?.value);
  const on = (id, fn, ev = 'change') => panel.querySelector(id)?.addEventListener(ev, fn);
  if (o.kind === 'stairs-out') {
    const setMeta = (patch) => { o.meta = { ...(o.meta || {}), ...patch }; };
    const syncFlight = () => keepStairLanding(o, () => syncStairs(o));
    // Ширина марша сохраняется при смене бортов.
    const keepFlight = (fn) => mutate(() => {
      const flight = stairsInfo(o).flight;
      fn();
      o.w = flight + stairsInfo(o).cheek * 2;
      clampSize(o);
    });
    on('#lsStRise', () => {
      const v = val('#lsStRise');
      if (Number.isFinite(v) && v >= 0) mutate(() => { o.height = Math.min(6000, Math.round(v)); syncFlight(); });
    });
    on('#lsStSteps', () => {
      const v = Math.round(val('#lsStSteps'));
      if (v >= 1) mutate(() => { setMeta({ steps: Math.min(60, v) }); syncFlight(); });
    });
    on('#lsStAuto', (e) => mutate(() => { setMeta({ steps: e.target.checked ? 0 : stairsInfo(o).steps }); syncFlight(); }));
    on('#lsStTread', () => {
      const v = val('#lsStTread');
      if (v > 0) mutate(() => { setMeta({ tread: Math.min(1200, Math.max(200, Math.round(v))) }); syncFlight(); });
    });
    on('#lsStLanding', () => {
      const v = val('#lsStLanding');
      if (Number.isFinite(v)) mutate(() => { setMeta({ landing: Math.min(6000, Math.max(0, Math.round(v))) }); syncFlight(); });
    });
    on('#lsStResample', () => {
      const ground = groundFn(state.project);
      const a = landscapeWorld(o, 0, o.h / 2);
      const b = landscapeWorld(o, 0, -o.h / 2);
      const rest = landscapeObjects().filter((other) => other !== o);
      const { obj, error } = stairsBetween(a, b, {
        id: o.id, aLevel: walkingLevel(a, rest, ground), bLevel: walkingLevel(b, rest, ground),
        width: o.w, variant: o.variant, landing: stairsInfo(o).landing,
      });
      if (error) { toast(error, true); return; }
      mutate(() => Object.assign(o, obj, { meta: { ...obj.meta, cheeks: o.meta.cheeks, cheekW: o.meta.cheekW } }));
    }, 'click');
    on('#lsDetachStair', () => mutate(() => { delete o.meta.stairLinks; }), 'click');
    on('#lsStFlight', () => {
      const v = val('#lsStFlight');
      if (v > 0) mutate(() => { o.w = Math.round(v) + stairsInfo(o).cheek * 2; clampSize(o); });
    });
    on('#lsStCheeks', (e) => keepFlight(() => setMeta({ cheeks: e.target.checked })));
    on('#lsStCheekW', () => {
      const v = val('#lsStCheekW');
      if (v > 0) keepFlight(() => setMeta({ cheekW: Math.min(600, Math.max(50, Math.round(v))) }));
    });
  }
  if (isPlanter(o)) {
    on('#lsPlWall', () => {
      const v = val('#lsPlWall');
      if (v > 0) {
        mutate(() => {
          o.meta = { ...(o.meta || {}), wall: Math.min(600, Math.max(40, Math.round(v))) };
          refitChildren(landscapeObjects(), o);
        });
      }
    });
    on('#lsPlHeight', () => {
      const v = val('#lsPlHeight');
      if (Number.isFinite(v) && v >= 0) mutate(() => { o.height = Math.min(1500, Math.round(v)); });
    });
    on('#lsPlFill', (e) => mutate(() => { o.meta = { ...(o.meta || {}), fill: e.target.value }; }));
    on('#lsInGo', () => {
      helper.inside = panel.querySelector('#lsInKind')?.value || helper.inside;
      helper.insideDensity = val('#lsInDensity') || helper.insideDensity;
      const list = plantInPlanter(landscapeObjects(), o, { kind: helper.inside, density: helper.insideDensity });
      if (!list.length) { toast('Нет места — уменьшите растение или густоту'); return; }
      mutate(() => { landscapeObjects().push(...list); });
      toast(`Посажено в короб: ${list.length}`);
    }, 'click');
  }
  on('#lsUnparent', () => mutate(() => { delete o.parent; }), 'click');
  if (o.kind === 'retaining-wall') {
    const setMeta = (patch) => mutate(() => { o.meta = { ...(o.meta || {}), ...patch }; });
    on('#lsRwH', () => {
      const v = val('#lsRwH');
      if (Number.isFinite(v) && v > 0) mutate(() => { o.height = Math.min(6000, Math.max(100, Math.round(v))); });
    });
    // Перепад, равный высоте, хранится как 0 (следует за высотой).
    on('#lsRwDrop', () => {
      const v = val('#lsRwDrop');
      if (Number.isFinite(v) && v >= 0) setMeta({ drop: v >= (o.height || 0) ? 0 : Math.round(v) });
    });
    on('#lsRwUpper', (e) => setMeta({ upper: e.target.value === 'right' ? 'right' : 'left' }));
    on('#lsRwCap', (e) => setMeta({ cap: e.target.checked }));
    on('#lsRwCapH', () => {
      const v = val('#lsRwCapH');
      if (v > 0) setMeta({ capH: Math.min(300, Math.max(20, Math.round(v))) });
    });
  }
  if (ELEV_KINDS.has(o.kind)) {
    on('#lsPathLevel', (e) => mutate(() => {
      o.meta.pathLevel = e.target.value;
      delete o.elevTo;
      if (e.target.value === 'fixed') o.elev = defaultPathElev(o.points[0], o);
      else if (e.target.value === 'graded') {
        o.elev = defaultPathElev(o.points[0], o, 25);
        o.elevTo = defaultPathElev(o.points.at(-1), o, 25);
      }
      else delete o.elev;
    }));
    on('#lsSlabThickness', () => {
      const v = val('#lsSlabThickness');
      if (v >= 40 && v <= 300) mutate(() => { o.meta.slabThickness = Math.round(v); });
    });
    const setElev = (key, raw) => {
      let value = normalizeElev(raw);
      if (value === null && o.kind === 'path') {
        if (o.meta?.pathLevel === 'fixed') value = defaultPathElev(o.points[0], o);
        if (o.meta?.pathLevel === 'graded') value = defaultPathElev(key === 'elevTo' ? o.points.at(-1) : o.points[0], o, 25);
      }
      if (key === 'elev' && PLATFORM_KINDS.has(o.kind) && o.kind !== 'sunken-lounge') {
        changePlatformSurface(panel, o, { elev: value });
        return;
      }
      const next = { ...o, [key]: value };
      if (o.kind === 'stairs-out' && Number.isFinite(next.elevTo) && next.elev == null) next.elev = 0;
      if (o.kind === 'stairs-out' && next.elevTo != null && stairsDrop(next) === null) {
        toast('Верх лестницы должен быть выше низа на 1–6000 мм');
        renderLandscapeProps(panel);
        return;
      }
      mutate(() => {
        if (value === null) delete o[key]; else o[key] = value;
        if (o.kind === 'stairs-out' && Number.isFinite(next.elevTo)) {
          o.elev = next.elev;
          keepStairLanding(o, () => applyStairsDrop(o));
        }
      });
    };
    on('#lsElev', (e) => setElev('elev', e.target.value));
    on('#lsElevTo', (e) => setElev('elevTo', e.target.value));
    on('#lsAttachStairs', () => {
      const terrain = groundFn(state.project);
      const ground = Math.round(terrain(o.x, o.y) - terrain.siteDatum);
      const explicit = normalizeElev(panel.querySelector('#lsStLower').value);
      const lower = explicit ?? ground;
      const rise = platformTop(o, ground) - lower;
      if (rise < 1 || rise > MAX_STAIR_RISE) { toast('Задайте перепад между площадками от 1 до 6000 мм'); return; }
      openView('landscape');
      closeSheets();
      selectLandscape([]);
      setTool({ kind: 'place-landscape', lsKind: 'stairs-out', platform: o, stairLevels: { lower, ground, surveyLower: explicit == null } },
        'Нажмите на край террасы, где нужен спуск');
    }, 'click');
  }
  if (CURB_HOSTS.has(o.kind)) {
    on('#lsCurb', (e) => mutate(() => { if (e.target.checked) o.curb = normalizeCurb(true); else delete o.curb; }));
    const setCurb = (patch) => mutate(() => { o.curb = normalizeCurb({ ...(o.curb || {}), ...patch }); });
    on('#lsCurbW', () => setCurb({ width: val('#lsCurbW') }));
    on('#lsCurbH', () => setCurb({ height: val('#lsCurbH') }));
    on('#lsCurbVar', (e) => setCurb({ variant: e.target.value }));
  }
}

export function renderLandscapeProps(panel) {
  refreshSectionView();
  if (isSectionTool()) { renderSectionToolProps(panel); return; }
  if (state.tool?.kind === 'ls-route') { renderOutdoorRouteProps(panel); return; }
  if (state.tool?.kind === 'ls-flight') { renderFlightProps(panel); return; }
  if (state.tool?.kind === 'draw-landscape') { renderDrawProps(panel); return; }
  if (state.tool?.kind === 'ls-array') { renderArrayProps(panel); return; }
  const objs = selectedObjects();
  if (!objs.length) { renderLandscapeSummary(panel); return; }
  if (objs.length === 1 && objs[0].kind === 'callout') { renderCalloutProps(panel, objs[0]); return; }
  if (objs.length > 1) {
    panel.innerHTML = `
      <h2>Ландшафт</h2>
      <div class="prop-block">
        <div class="prop-row"><span>Выбрано объектов</span><strong>${objs.length}</strong></div>
        <p class="hint">Тяните мышью или стрелками · R — повернуть группу · Ctrl+D — копия · Shift+A — массив · T — подписать выносками${objs.some(canExplode) ? ' · X — разорвать дорожки' : ''}</p>
      </div>`;
    bindCommon(panel);
    return;
  }
  const o = objs[0];
  const def = landscapeDef(o.kind);
  const shape = isPathShape(def);
  const notes = currentWarnings().get(o.id) || [];
  const built = o.kind === 'stairs-out' || o.kind === 'retaining-wall' || isPlanter(o);
  const variants = def.variants.length > 1
    ? `<label class="prop-field"><span>${built || o.kind === 'curb' ? 'Материал' : shape ? 'Материал / вариант' : 'Вариант'}</span><select id="lsVariant">${variantOptions(def, o.variant)}</select></label>`
    : '';
  let size;
  if (shape) {
    size = `
      ${def.shape === 'line' ? `<label class="prop-field"><span>${o.kind === 'retaining-wall' ? 'Толщина' : 'Ширина'}, м</span><input id="lsWidth" type="number" step="0.05" min="0.05" max="10" value="${m(o.width || def.h)}"></label>` : ''}
      <label class="check-row"><input type="checkbox" id="lsSmooth" ${o.smooth ? 'checked' : ''}><span>Сглаженная (изогнутая)</span></label>
      <div class="prop-row"><span>${def.shape === 'line' ? 'Длина × ширина' : 'Площадь · периметр'}</span><strong id="lsMeasure">${landscapeMeasure(o, def)}</strong></div>
      <div class="prop-row"><span>Вершин</span><strong>${o.points.length}</strong></div>`;
  } else if (o.kind === 'stairs-out') {
    size = '';
  } else if (def.lockAspect) {
    size = `<label class="prop-field"><span>${def.shape === 'point' && def.group === 'Деревья' ? 'Диаметр кроны, м' : 'Диаметр, м'}</span>
        <input id="lsW" type="number" step="0.1" min="${m(def.min.w)}" max="${m(def.max.w)}" value="${m(o.w)}"></label>`;
  } else {
    size = `<div class="prop-grid">
        <label class="prop-field"><span>Длина, м</span><input id="lsW" type="number" step="0.1" min="${m(def.min.w)}" max="${m(def.max.w)}" value="${m(o.w)}"></label>
        <label class="prop-field"><span>Ширина, м</span><input id="lsH" type="number" step="0.1" min="${m(def.min.h)}" max="${m(def.max.h)}" value="${m(o.h)}"></label>
      </div>`;
  }
  const color = o.color || def.colors[0];
  const helpers = shape && !isPlanter(o) ? `
    <h3>Посадить вдоль</h3>
    <div class="prop-block">
      <label class="prop-field"><span>Растение</span><select id="lsAlongKind">${plantOptions(helper.plant)}</select></label>
      <div class="prop-grid">
        <label class="prop-field"><span>Шаг, м</span><input id="lsAlongStep" type="number" step="0.1" min="0.3" value="${helper.step}"></label>
        <label class="prop-field"><span>Отступ, м</span><input id="lsAlongOffset" type="number" step="0.1" min="0" value="${helper.offset}"></label>
      </div>
      <label class="prop-field"><span>Сторона</span><select id="lsAlongSides">
        ${[['left', 'Слева'], ['right', 'Справа'], ['both', 'С двух сторон'], ['center', 'По оси']].map(([k, t]) => `<option value="${k}" ${k === helper.sides ? 'selected' : ''}>${t}</option>`).join('')}
      </select></label>
      <button type="button" id="lsAlongGo">Посадить вдоль</button>
    </div>
    ${def.shape === 'poly' && !canFill(o) ? `
    <h3>Заполнить растениями</h3>
    <div class="prop-block">
      <label class="prop-field"><span>Растение</span><select id="lsFillKind">${plantOptions(helper.plant)}</select></label>
      <label class="prop-field"><span>Густота</span><input id="lsFillDensity" type="range" min="0.1" max="1" step="0.05" value="${helper.density}"></label>
      <button type="button" id="lsFillGo">Заполнить область</button>
    </div>` : ''}` : '';
  panel.innerHTML = `
    <h2>${escapeHtml(def.title)}</h2>
    ${o.kind === 'stairs-out' ? stairShapeFields() : ''}
    <div class="prop-block">
      <div class="prop-row"><span>${escapeHtml(def.group)}</span><span>${def.tall ? 'высокий' : def.cover ? 'покрытие' : ''}</span></div>
      ${variants}
      ${size}
      ${buildPropsHtml(o, def)}
      ${pathPropsHtml(o, def)}
      ${outdoorLightsHtml(o)}
      ${built || (PLATFORM_KINDS.has(o.kind) && o.kind !== 'sunken-lounge' && Number.isFinite(o.elev)) ? '' : `<label class="prop-field"><span>${o.kind === 'sunken-lounge' ? 'Высота спинки, м' : 'Высота, м'}</span><input id="lsHeight" type="number" step="0.1" min="${o.kind === 'sunken-lounge' ? '0.3' : '0'}" max="${o.kind === 'sunken-lounge' ? '2' : '40'}" value="${m(o.height || 0)}"></label>`}
      ${shape ? '' : `<label class="prop-field"><span>Поворот, °</span><input id="lsRot" type="number" step="5" value="${Math.round(o.rotation || 0)}"></label>`}
      <div class="prop-grid">
        <label class="prop-field"><span>Цвет</span><input id="lsColor" type="color" value="${/^#[0-9a-f]{6}$/i.test(color) ? color : '#6aa84f'}"></label>
        <label class="check-row"><input type="checkbox" id="lsLock" ${o.locked ? 'checked' : ''}><span>Замок</span></label>
      </div>
      ${o.color ? '<button type="button" class="link" id="lsColorReset">Цвет по умолчанию</button>' : ''}
      <button type="button" id="lsLabel" title="Выноска с названием объекта (T)">Подписать выноской</button>
      ${shape && !o.locked ? '<p class="hint">Тяните вершины · «+» на ребре или двойной клик по ребру — новая вершина · двойной клик по вершине, Alt+клик или Delete — удалить</p>' : ''}
      ${notes.map((t) => `<p class="ls-note">${escapeHtml(t)}</p>`).join('')}
    </div>
    ${helpers}
    ${planterFillHtml(o)}
    ${plantFillHtml(o)}`;
  bindCommon(panel);
  if (o.kind === 'stairs-out') bindStairShapeFields(panel);
  bindPathProps(panel, o);
  bindBuildProps(panel, o);
  bindOutdoorLights(panel, o);
  bindPlantFill(panel, o);
  const num = (id) => Number(panel.querySelector(id)?.value);
  panel.querySelector('#lsVariant')?.addEventListener('change', (e) => mutate(() => { o.variant = e.target.value; }));
  const applySize = () => {
    const w = Math.round(num('#lsW') * 1000);
    const h = def.lockAspect ? w : Math.round(num('#lsH') * 1000);
    if (!(w > 0) || !(h > 0)) return;
    mutate(() => {
      const before = { ...o };
      resizeObject(o, w, h);
      if (isPlanter(o)) refitChildren(landscapeObjects(), o, before);
    });
  };
  panel.querySelector('#lsW')?.addEventListener('change', applySize);
  panel.querySelector('#lsH')?.addEventListener('change', applySize);
  panel.querySelector('#lsWidth')?.addEventListener('change', () => {
    const v = num('#lsWidth');
    if (Number.isFinite(v) && v > 0) mutate(() => {
      const followsWidth = o.kind === 'path' && o.variant === 'stepping' && o.slabW === o.width;
      o.width = clampWidth(v * 1000);
      if (followsWidth) o.slabW = Math.min(6000, o.width);
      syncShape(o);
    });
  });
  panel.querySelector('#lsSmooth')?.addEventListener('change', (e) => mutate(() => {
    if (e.target.checked) o.smooth = true; else delete o.smooth;
    syncShape(o);
  }));
  panel.querySelector('#lsHeight')?.addEventListener('change', () => {
    const v = num('#lsHeight');
    if (!Number.isFinite(v) || v < 0) return;
    const mm = Math.round(v * 1000);
    if (PLATFORM_KINDS.has(o.kind) && o.kind !== 'sunken-lounge') changePlatformSurface(panel, o, { height: mm });
    else mutate(() => { o.height = o.kind === 'sunken-lounge' ? Math.min(2000, Math.max(300, mm)) : mm; });
  });
  panel.querySelector('#lsRot')?.addEventListener('change', () => {
    const v = num('#lsRot');
    if (!Number.isFinite(v)) return;
    mutate(() => {
      const rot = ((Math.round(v) % 360) + 360) % 360;
      // Растения короба поворачиваются вместе с ним.
      if (isPlanter(o)) rotateChildren(landscapeObjects(), o, rot - (o.rotation || 0));
      o.rotation = rot;
    });
  });
  panel.querySelector('#lsColor')?.addEventListener('change', (e) => mutate(() => { o.color = e.target.value; }));
  panel.querySelector('#lsColorReset')?.addEventListener('click', () => mutate(() => { delete o.color; }));
  panel.querySelector('#lsLabel')?.addEventListener('click', () => labelLandscapeSelection());
  panel.querySelector('#lsLock')?.addEventListener('change', (e) => mutate(() => {
    if (e.target.checked) o.locked = true; else delete o.locked;
    state.lsVertex = null;
  }));
  // Помощники фигуры.
  const readHelper = () => {
    helper.plant = panel.querySelector('#lsAlongKind')?.value || helper.plant;
    helper.step = num('#lsAlongStep') || helper.step;
    helper.offset = Number.isFinite(num('#lsAlongOffset')) ? num('#lsAlongOffset') : helper.offset;
    helper.sides = panel.querySelector('#lsAlongSides')?.value || helper.sides;
  };
  panel.querySelector('#lsAlongGo')?.addEventListener('click', () => {
    readHelper();
    const guide = guideOf(o);
    const list = plantAlong(guide.points, {
      kind: helper.plant, step: helper.step * 1000, offset: helper.offset * 1000 + (o.width || 0) / 2 * (helper.sides === 'center' ? 0 : 1),
      closed: guide.closed, sides: helper.sides,
    });
    if (!list.length) { toast('Линия короче шага — нечего сажать'); return; }
    addLandscapeObjects(list);
    toast(`Посажено: ${list.length}`);
  });
  panel.querySelector('#lsFillGo')?.addEventListener('click', () => {
    helper.plant = panel.querySelector('#lsFillKind')?.value || helper.plant;
    helper.density = num('#lsFillDensity') || helper.density;
    const contour = objectPath(o).map(({ x, y }) => ({ x, y }));
    const circles = landscapeObjects().filter((x) => x.id !== o.id && !isShapeKind(x.kind)).map((x) => ({ x: x.x, y: x.y, r: Math.max(x.w, x.h) / 2 }));
    const list = fillArea(contour, {
      kind: helper.plant, density: helper.density, seed: o.id, circles, avoid: houseFootprints(state.project),
    });
    if (!list.length) { toast('Область мала для этого растения'); return; }
    addLandscapeObjects(list);
    toast(`Посажено: ${list.length}`);
  });
}

// Параметры рисования (пока активен инструмент draw-landscape).
function renderFlightProps(panel) {
  const tool = state.tool;
  const o = tool.opts;
  panel.innerHTML = `
    <h2>Наружная лестница</h2>
    <div class="prop-block">
      <div class="prop-grid">
        ${mmField('lsFlightWidth', 'Ширина марша, мм', o.width, 500, 12000, 50)}
        ${mmField('lsFlightLanding', 'Доп. длина площадки, мм', o.landing, 0, 6000, 50)}
        ${elevField('lsFlightA', 'Начало, мм от нуля участка', o.aLevel, 'авто')}
        ${elevField('lsFlightB', 'Конец, мм от нуля участка', o.bLevel, 'авто')}
      </div>
      <label class="prop-field"><span>Ступени</span><select id="lsFlightMaterial">${variantOptions(landscapeDef('stairs-out'), o.variant)}</select></label>
      <output id="lsStDrawInfo">${escapeHtml(flightHint(tool))}</output>
    </div>
    <button type="button" id="lsFlightCancel">Отмена</button>`;
  const bind = (id, key, parse) => panel.querySelector('#' + id).addEventListener('change', (e) => {
    o[key] = parse(e.target.value);
    e.target.value = o[key] ?? '';
    updateFlight(tool);
  });
  bind('lsFlightWidth', 'width', (v) => Math.min(12000, Math.max(500, Math.round(Number(v) || 2400))));
  bind('lsFlightLanding', 'landing', (v) => Math.min(6000, Math.max(0, Math.round(Number(v) || 0))));
  bind('lsFlightA', 'aLevel', normalizeElev);
  bind('lsFlightB', 'bLevel', normalizeElev);
  bind('lsFlightMaterial', 'variant', (v) => v);
  panel.querySelector('#lsFlightCancel').addEventListener('click', () => { cancelTool(); selectObject(null); renderLandscapeLibrary(); });
}

function renderDrawProps(panel) {
  const tool = state.tool;
  const def = landscapeDef(tool.lsKind);
  const o = tool.opts;
  panel.innerHTML = `
    <h2>Рисование: ${escapeHtml(def.title)}</h2>
    <div class="prop-block">
      ${def.variants.length > 1 ? `<label class="prop-field"><span>Материал / вариант</span><select id="lsDrawVariant">${variantOptions(def, o.variant)}</select></label>` : ''}
      ${def.shape === 'line' ? `<label class="prop-field"><span>Ширина, м</span><input id="lsDrawWidth" type="number" step="0.05" min="0.05" max="10" value="${m(o.width || def.h)}"></label>` : ''}
      ${def.kind === 'path' ? pathLevelFields(o) : ''}
      ${PLATFORM_KINDS.has(def.kind) ? elevField('lsDrawElev', 'Отметка поверхности, мм от нуля участка', o.elev) : ''}
      <label class="check-row"><input type="checkbox" id="lsDrawSmooth" ${o.smooth ? 'checked' : ''}><span>Сглаженная (изогнутая)</span></label>
      <div class="prop-row"><span>Сейчас</span><strong id="lsDrawMeasure">${draftMeasure(tool) || '—'}</strong></div>
      <p class="hint">${escapeHtml(DRAW_HINT[def.shape])}</p>
    </div>
    <div class="prop-actions">
      <button type="button" id="lsDrawFinish">Завершить (Enter)</button>
      <button type="button" id="lsDrawCancel">Отмена (Esc)</button>
    </div>`;
  const remember = () => { drawOpts.set(def.kind, { ...o }); requestDraw(); };
  panel.querySelector('#lsDrawVariant')?.addEventListener('change', (e) => { o.variant = e.target.value; remember(); });
  panel.querySelector('#lsDrawWidth')?.addEventListener('change', (e) => {
    const v = Number(e.target.value);
    if (Number.isFinite(v) && v > 0) {
      o.width = clampWidth(v * 1000);
      if (o.slabW) o.slabW = Math.min(6000, o.width);
      remember();
    }
  });
  panel.querySelector('#lsPathLevel')?.addEventListener('change', (e) => {
    o.meta = { ...o.meta, pathLevel: e.target.value };
    o.elev = null;
    o.elevTo = null;
    remember();
    renderDrawProps(panel);
  });
  panel.querySelector('#lsElev')?.addEventListener('change', (e) => {
    o.elev = normalizeElev(e.target.value);
    if (def.kind === 'path') o.meta = { ...o.meta, pathLevel: o.meta?.pathLevel || 'terrain' };
    remember();
  });
  panel.querySelector('#lsElevTo')?.addEventListener('change', (e) => { o.elevTo = normalizeElev(e.target.value); remember(); });
  panel.querySelector('#lsDrawElev')?.addEventListener('change', (e) => {
    o.elev = normalizeElev(e.target.value); remember();
  });
  panel.querySelector('#lsDrawSmooth')?.addEventListener('change', (e) => { o.smooth = e.target.checked; remember(); });
  panel.querySelector('#lsDrawFinish')?.addEventListener('click', () => finishLandscapeDraw());
  panel.querySelector('#lsDrawCancel')?.addEventListener('click', () => { cancelTool(); selectObject(null); renderLandscapeLibrary(); });
}

function bindCommon(panel) {
}

export function downloadLandscapeCsv() {
  if (!landscapeObjects().length) { toast('Ландшафт пуст — ведомость нечего выгружать', true); return; }
  saveFile(`${safeProjectFileName()}-ландшафт.csv`, buildLandscapeCsv(state.project), 'text/csv;charset=utf-8');
  toast('Ведомость озеленения и малых форм (CSV)');
}

// Шаблон сада: добавить или заменить (подтверждение, если ландшафт не пуст).
export function applyGardenTemplate(id, { replace = false, confirmFn = (t) => window.confirm(t) } = {}) {
  const res = composeGarden(state.project, id);
  if (res.error) { toast(res.error, true); return null; }
  const count = landscapeObjects().length;
  if (count && !confirmFn(replace
    ? `Заменить ${count} объект(ов) ландшафта шаблоном «${res.title}»?`
    : `Добавить шаблон «${res.title}» к ${count} существующим объектам?`)) return null;
  addLandscapeObjects(res.objects, { replace, select: false });
  toast(`«${res.title}»: объектов ${res.objects.length} · Ctrl+Z — отменить`);
  return res.objects;
}

function renderLandscapeSummary(panel) {
  const objs = landscapeObjects();
  const sum = landscapeSummary(objs);
  const warn = [...currentWarnings().values()].flat();
  const near = warn.length;
  const site = state.project.site;
  const balance = site.boundary?.length >= 3 ? landscapeBalance(state.project) : null;
  const vis = state.lsVis;
  const pathDef = landscapeDef('path');
  panel.innerHTML = `
    <h2>Ландшафт</h2>
    <div class="prop-block">
      <div class="prop-row"><span>Объектов</span><strong>${sum.count}</strong></div>
      <div class="prop-row"><span>Деревьев</span><strong>${sum.trees}</strong></div>
      <div class="prop-row"><span>Покрытия и площадки</span><strong>${fmt(sum.coverM2)} м²</strong></div>
      ${retainingRows(retainingTotals(objs)).map(([k, v]) => `<div class="prop-row"><span>${escapeHtml(k)}</span><strong>${escapeHtml(v)}</strong></div>`).join('')}
      ${near ? `<p class="ls-note">Деревья ближе ${TREE_HOUSE_MIN / 1000} м к дому: ${near}</p>` : ''}
      ${site.boundary?.length ? '' : '<p class="hint">Границу участка можно начертить в режиме «Участок».</p>'}
      <p class="hint">Выберите объект слева: клик — ставить курсором (Esc — выйти), или перетащите на участок. Дорожки, ограждения и контуры — рисуются по точкам. Shift — несколько, рамка — выделить группу.</p>
    </div>
    ${balance ? `
    <h3>Баланс территории</h3>
    <div class="prop-block" id="lsBalance">
      ${balanceRows(balance).map(([k, v]) => `<div class="prop-row"><span>${escapeHtml(k)}</span><strong>${escapeHtml(v)}</strong></div>`).join('')}
    </div>` : ''}
    <h3>Ведомость растений</h3>
    <div class="prop-block ls-plants" id="lsPlants">
      ${plantTableHtml(plantSchedule(objs, site.landscape?.plants))}
    </div>
    ${sectionsBlockHtml()}
    <h3>Слои</h3>
    <div class="prop-block ls-vis">
      <div class="prop-field"><span>Графика</span>
        <div class="seg ls-style" role="radiogroup" aria-label="Стиль графики ландшафта">
          ${LS_STYLES.map((st) => `<label class="seg-opt${state.lsStyle === st.id ? ' active' : ''}"><input type="radio" name="lsStyle" value="${st.id}" ${state.lsStyle === st.id ? 'checked' : ''}><span>${st.title}</span></label>`).join('')}
        </div>
      </div>
      ${LANDSCAPE_VIS.map((g) => `<label class="check-row"><input type="checkbox" data-ls-vis="${g.id}" ${vis[g.id] !== false ? 'checked' : ''}><span>${g.title}</span></label>`).join('')}
      <label class="check-row"><input type="checkbox" id="lsSheetScreen" ${sheetStylePref() === 'screen' ? 'checked' : ''}><span>Генплан на листе — как на экране (иначе «Чертёж»)</span></label>
    </div>
    <h3>Помощники</h3>
    <div class="prop-block">
      <label class="prop-field"><span>Дорожка от въезда до входа</span><select id="lsEntryVariant">${variantOptions(pathDef, helper.pathVariant)}</select></label>
      <label class="check-row"><input type="checkbox" id="lsEntryCurved" ${helper.curved ? 'checked' : ''}><span>Изогнутая</span></label>
      <button type="button" id="lsEntryGo">Проложить дорожку</button>
      <div class="prop-grid">
        <label class="prop-field"><span>Парковка, мест</span><input id="lsParkN" type="number" min="1" max="12" step="1" value="${helper.spaces}"></label>
        <button type="button" id="lsParkGo">У въезда</button>
      </div>
      ${site.boundary?.length >= 3 ? `
      <label class="prop-field"><span>Вдоль границы участка</span><select id="lsAlongKind">${plantOptions(helper.plant)}</select></label>
      <div class="prop-grid">
        <label class="prop-field"><span>Шаг, м</span><input id="lsAlongStep" type="number" step="0.1" min="0.3" value="${helper.step}"></label>
        <label class="prop-field"><span>Отступ внутрь, м</span><input id="lsAlongOffset" type="number" step="0.1" min="0" value="${helper.offset}"></label>
      </div>
      <button type="button" id="lsBoundaryGo">Посадить вдоль границы</button>` : ''}
    </div>
    <h3>Шаблон озеленения</h3>
    <div class="prop-block">
      <label class="prop-field"><span>Композиция</span><select id="lsTemplate">${GARDEN_TEMPLATES.map((t) => `<option value="${t.id}" ${t.id === helper.template ? 'selected' : ''}>${escapeHtml(t.title)}</option>`).join('')}</select></label>
      <p class="hint" id="lsTemplateHint">${escapeHtml(GARDEN_TEMPLATES.find((t) => t.id === helper.template)?.hint || '')}</p>
      <div class="prop-actions">
        <button type="button" id="lsTplAdd">Добавить</button>
        <button type="button" id="lsTplReplace">Заменить всё</button>
      </div>
    </div>
    <div class="prop-actions">
      <button type="button" id="lsCsv">Ведомость (CSV)</button>
    </div>`;
  panel.querySelectorAll('input[name="lsStyle"]').forEach((r) => r.addEventListener('change', () => {
    if (!r.checked) return;
    setLandscapeStyle(r.value);
    panel.querySelectorAll('.ls-style .seg-opt').forEach((l) => l.classList.toggle('active', l.querySelector('input').checked));
    renderLandscapeLibrary();
    requestDraw();
  }));
  panel.querySelector('#lsSheetScreen')?.addEventListener('change', (e) => setSheetStylePref(e.target.checked ? 'screen' : 'drawing'));
  bindPlantTable(panel);
  bindSectionsBlock(panel);
  panel.querySelectorAll('[data-ls-vis]').forEach((box) => box.addEventListener('change', () => {
    state.lsVis = { ...state.lsVis, [box.dataset.lsVis]: box.checked };
    requestDraw();
  }));
  panel.querySelector('#lsEntryVariant')?.addEventListener('change', (e) => { helper.pathVariant = e.target.value; });
  panel.querySelector('#lsEntryCurved')?.addEventListener('change', (e) => { helper.curved = e.target.checked; });
  panel.querySelector('#lsEntryGo')?.addEventListener('click', () => {
    const res = entryPathObject(state.project, {
      variant: helper.pathVariant, curved: helper.curved, width: helper.pathVariant === 'stepping' ? 900 : 1200,
    });
    if (res.error) { toast(res.error, true); return; }
    addLandscapeObjects([res.obj]);
    toast(`Дорожка ${fmt(polylineLength(objectPath(res.obj)) / 1000, 1)} м от въезда до входа`);
  });
  panel.querySelector('#lsParkGo')?.addEventListener('click', () => {
    helper.spaces = Math.max(1, Math.min(12, Math.round(Number(panel.querySelector('#lsParkN').value) || 2)));
    const list = parkingAtEntry(state.project, helper.spaces);
    if (!list.length) { toast('Нет въезда: поставьте его в режиме «Участок»', true); return; }
    addLandscapeObjects(list);
    toast(`Парковка: ${list.length} мест у въезда`);
  });
  panel.querySelector('#lsBoundaryGo')?.addEventListener('click', () => {
    helper.plant = panel.querySelector('#lsAlongKind').value;
    helper.step = Number(panel.querySelector('#lsAlongStep').value) || helper.step;
    helper.offset = Number(panel.querySelector('#lsAlongOffset').value) || 0;
    const list = plantAlong(site.boundary, {
      kind: helper.plant, step: helper.step * 1000, offset: helper.offset * 1000, closed: true, inside: true,
    });
    addLandscapeObjects(list);
    toast(`Посажено вдоль границы: ${list.length}`);
  });
  panel.querySelector('#lsTemplate')?.addEventListener('change', (e) => {
    helper.template = e.target.value;
    const hint = panel.querySelector('#lsTemplateHint');
    if (hint) hint.textContent = GARDEN_TEMPLATES.find((t) => t.id === helper.template)?.hint || '';
  });
  panel.querySelector('#lsTplAdd')?.addEventListener('click', () => applyGardenTemplate(helper.template));
  panel.querySelector('#lsTplReplace')?.addEventListener('click', () => applyGardenTemplate(helper.template, { replace: true }));
  panel.querySelector('#lsCsv')?.addEventListener('click', downloadLandscapeCsv);
}
