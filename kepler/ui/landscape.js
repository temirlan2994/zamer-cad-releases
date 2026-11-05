// Режим «Ландшафт»: каталог слева, постановка, рисование линий и контуров,
// выделение, ручки и вершины, правка с историей, панель свойств, помощники
// и шаблоны сада. Данные — project.site.landscape.objects (core/landscape.js),
// координаты участка (съёмки).

import {
  LANDSCAPE_CATEGORIES, LANDSCAPE_VIS, TREE_HOUSE_MIN, clampWidth, cloneLandscapeObject, createLandscapeObject,
  hitEdge, hitLandscape, hitVertex, insertVertex, isPathShape, landscapeByCategory, landscapeDef, landscapeHandles,
  landscapeSummary, landscapeWarnings, minVertices, moveVertex, objectCorners, objectPath, objectsInPolygon,
  polygonArea, polylineLength, removeVertex, resizeObject, rotateObjectAbout, searchLandscape, syncShape,
  translateObject,
} from '../core/landscape.js';
import { balanceRows, buildLandscapeCsv, landscapeBalance } from '../core/landscape-report.js';
import {
  GARDEN_TEMPLATES, PLANT_KINDS, composeGarden, entryPathObject, fillArea, guideOf, houseFootprints, parkingAtEntry,
  plantAlong,
} from '../core/landscape-tools.js';
import { buildingSiteCheck } from '../core/site-check.js';
import { saveFile } from './cloud.js';
import { drawLandscapePreview, landscapeMeasure, shapeHandles } from './render-landscape.js';
import { el, escapeHtml, toast } from './dom.js';
import { gridStep } from './snap.js';
import { chainsWithout, dragPrev, snapAt } from './draw-snap-ui.js';
import { state } from './state.js';
import { afterChange, mutate, pushHistory, snapshot } from './store.js';
import { cancelTool, selectObject, setHint, setTool } from './tools.js';
import { requestDraw, screenToWorld, worldToScreen } from './view.js';

export const LANDSCAPE_MIME = 'application/x-kepler-landscape';

let category = LANDSCAPE_CATEGORIES[0].id;
let clipboard = null;
// Параметры рисования по типу (вариант, ширина, сглаживание) — запоминаются.
const drawOpts = new Map();
// Параметры помощников панели — запоминаются между перерисовками.
const helper = {
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
  selectObject(ids.length ? { type: 'landscape', ids: [...ids] } : null);
}

const snapStep = () => Math.max(gridStep(), 1);
const snap = (val) => Math.round(val / snapStep()) * snapStep();
const isShapeKind = (kind) => isPathShape(landscapeDef(kind));

// Привязка точки рисования/вершины — общий модуль (core/draw-snap.js):
// конец/середина/пересечение/центр, перпендикуляр и параллель, выравнивание
// по X/Y, полярные лучи и орто от последней точки, затем сетка.
// Shift — без привязки, Ctrl — временно орто.
function snapLs(world, event, opts = {}) {
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
  if (isPathShape(def)) { startDrawLandscape(kind); return; }
  setTool({ kind: 'place-landscape', lsKind: kind, rotation: 0 },
    `Кликните на участке — «${def.title}»; повторные клики — ещё · Пробел — повернуть · Esc — выйти`);
  state.selection = null;
  renderLandscapeLibrary();
  requestDraw();
}

export function placeLandscapeAt(kind, world, rotation = 0) {
  const def = landscapeDef(kind);
  if (!def || def.stage !== 1) return null;
  const obj = createLandscapeObject(kind, snap(world.x), snap(world.y), { rotation, ...(isPathShape(def) ? drawOptions(kind) : {}) });
  mutate(() => {
    landscapeObjects().push(obj);
    state.selection = { type: 'landscape', ids: [obj.id] };
  });
  return obj;
}

function ghostAt(world) {
  const tool = state.tool;
  state.ghostLandscape = createLandscapeObject(tool.lsKind, snap(world.x), snap(world.y), { id: '__ghost-ls__', rotation: tool.rotation || 0 });
}

// Пробел во время постановки — поворот призрака на 90°.
export function rotateLandscapeGhost() {
  const tool = state.tool;
  if (tool?.kind !== 'place-landscape') return false;
  tool.rotation = ((tool.rotation || 0) + 90) % 360;
  if (state.ghostLandscape) state.ghostLandscape.rotation = tool.rotation;
  requestDraw();
  return true;
}

// ------------------------------------------------------------ Рисование

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

export function startDrawLandscape(kind) {
  const def = landscapeDef(kind);
  if (!isPathShape(def)) return;
  setTool({ kind: 'draw-landscape', lsKind: kind, points: [], cursor: null, rect: null, opts: drawOptions(kind) }, DRAW_HINT[def.shape]);
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
  if (state.tool) return false;
  const screen = worldToScreen(world.x, world.y);
  const sh = hitShapeHandle(screen);
  if (sh) {
    canvas.style.cursor = sh.mode === 'mid' ? 'copy' : 'move';
    return true;
  }
  const handle = hitLandscapeHandle(screen);
  const hit = handle ? null : hitLandscape(landscapeObjects(), world, 4 / state.view.scale);
  const next = hit ? { type: 'landscape', id: hit.id } : null;
  canvas.style.cursor = handle ? (handle.mode === 'rotate' ? 'grab' : 'nwse-resize') : hit ? (hit.locked ? 'pointer' : 'move') : 'default';
  if (JSON.stringify(next) !== JSON.stringify(state.hover)) { state.hover = next; requestDraw(); }
  return true;
}

const HANDLE_TOL = () => (state.coarsePointer ? 22 : 9);

export function hitLandscapeHandle(screen) {
  const objs = selectedObjects();
  if (objs.length !== 1) return null;
  const o = objs[0];
  if (o.locked || isShapeKind(o.kind)) return null;
  const { corners, rotators } = landscapeHandles(o, 20, state.view.scale);
  for (const c of corners) {
    const p = worldToScreen(c.x, c.y);
    if (Math.abs(p.x - screen.x) <= HANDLE_TOL() && Math.abs(p.y - screen.y) <= HANDLE_TOL()) return { mode: 'resize', corner: c.id, obj: o };
  }
  for (const r of rotators) {
    const p = worldToScreen(r.x, r.y);
    if (Math.hypot(p.x - screen.x, p.y - screen.y) <= HANDLE_TOL() + 1) return { mode: 'rotate', corner: r.id, obj: o };
  }
  return null;
}

// Вершины и середины рёбер выбранной фигуры (линия/контур).
export function hitShapeHandle(screen) {
  const objs = selectedObjects();
  if (objs.length !== 1) return null;
  const o = objs[0];
  if (o.locked || !isShapeKind(o.kind)) return null;
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

// Нажатие в «Ландшафте». Возвращает описание перетаскивания для input.js
// (kind 'ls-*', 'marquee', 'pan') или null.
export function landscapePointerDown(event, screen, world) {
  const tool = state.tool;
  if (tool?.kind === 'place-landscape') {
    placeLandscapeAt(tool.lsKind, world, tool.rotation || 0);
    return null;
  }
  if (tool?.kind === 'draw-landscape') {
    const def = landscapeDef(tool.lsKind);
    const p = snapDraft(world, event);
    if (def.shape === 'poly' && !tool.points.length) return { kind: 'ls-draw-rect', start: p, screen, moved: false };
    addDraftPoint(p, screen);
    return null;
  }
  if (tool) return null;
  const sh = hitShapeHandle(screen);
  if (sh) {
    const o = sh.obj;
    if (sh.mode === 'vertex' && event.altKey) {
      removeVertexAt(o, sh.index);
      return null;
    }
    state.lsVertex = sh.mode === 'vertex' ? { id: o.id, index: sh.index } : null;
    requestDraw();
    return { kind: 'ls-vertex', id: o.id, index: sh.index, insert: sh.mode === 'mid', before: snapshot(), moved: false, screen };
  }
  state.lsVertex = null;
  const handle = hitLandscapeHandle(screen);
  if (handle) {
    const o = handle.obj;
    if (handle.mode === 'rotate') {
      return {
        kind: 'ls-rotate', id: o.id, startRot: o.rotation || 0, center: { x: o.x, y: o.y },
        startAngle: Math.atan2(world.y - o.y, world.x - o.x), before: snapshot(), moved: false,
      };
    }
    const opp = { nw: 'se', ne: 'sw', se: 'nw', sw: 'ne' }[handle.corner];
    const anchor = objectCorners(o).find((c) => c.id === opp);
    const sign = { nw: [-1, -1], ne: [1, -1], se: [1, 1], sw: [-1, 1] }[handle.corner];
    return { kind: 'ls-resize', id: o.id, anchor: { x: anchor.x, y: anchor.y }, sign, before: snapshot(), moved: false };
  }
  const hit = hitLandscape(landscapeObjects(), world, 4 / state.view.scale);
  if (hit) {
    let ids = selectedIds();
    if (event.shiftKey) {
      ids = ids.includes(hit.id) ? ids.filter((id) => id !== hit.id) : [...ids, hit.id];
      selectLandscape(ids);
      if (!ids.includes(hit.id)) return null;
    } else if (!ids.includes(hit.id)) {
      ids = [hit.id];
      selectLandscape(ids);
    }
    const movable = editable(selectedObjects());
    if (!movable.length) return null; // закреплённые — только выбор
    const starts = new Map(movable.map((o) => [o.id, { x: o.x, y: o.y, points: o.points ? o.points.map((p) => ({ ...p })) : null }]));
    const primary = starts.has(hit.id) ? hit.id : movable[0].id;
    return { kind: 'ls-move', primary, starts, world, screen, before: snapshot(), moved: false };
  }
  if (!event.shiftKey) selectLandscape([]);
  if (event.pointerType === 'touch') return { kind: 'pan', start: screen, view: { ...state.view } };
  state.marquee = { x1: screen.x, y1: screen.y, x2: screen.x, y2: screen.y, add: event.shiftKey };
  return { kind: 'marquee', start: screen };
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
  } else if (drag.kind === 'ls-move') {
    if (!drag.moved && Math.hypot(screen.x - drag.screen.x, screen.y - drag.screen.y) < 3) return;
    drag.moved = true;
    const p0 = drag.starts.get(drag.primary);
    const dx = snap(p0.x + world.x - drag.world.x) - p0.x;
    const dy = snap(p0.y + world.y - drag.world.y) - p0.y;
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
    o.rotation = ((Math.round(raw / step) * step) % 360 + 360) % 360;
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
  }
  requestDraw();
}

export function landscapeDragEnd(drag) {
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
  if (!drag.moved) { requestDraw(); return; }
  pushHistory(drag.before);
  afterChange();
}

// Двойной клик: завершить рисование, удалить вершину (по ней) или вставить вершину на ребре.
export function landscapeDblClick(world) {
  if (state.tool?.kind === 'draw-landscape') { finishLandscapeDraw(); return true; }
  if (state.tool) return false;
  const objs = selectedObjects();
  if (objs.length !== 1) return false;
  const o = objs[0];
  if (o.locked || !isShapeKind(o.kind)) return false;
  const tol = 8 / state.view.scale;
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
  const gone = new Set(editable(all).map((o) => o.id));
  if (!gone.size) { toast('Объект закреплён — снимите замок в свойствах'); return; }
  mutate(() => {
    const site = state.project.site;
    site.landscape.objects = landscapeObjects().filter((o) => !gone.has(o.id));
  });
  state.lsVertex = null;
  selectLandscape(all.filter((o) => !gone.has(o.id)).map((o) => o.id));
}

export function nudgeLandscape(dx, dy) {
  const objs = editable(selectedObjects());
  if (!objs.length) return;
  mutate(() => { for (const o of objs) translateObject(o, dx, dy); });
}

// R — поворот на 90°: одиночный — вокруг центра, группа — вокруг центра группы.
export function rotateLandscape90() {
  const objs = editable(selectedObjects());
  if (!objs.length) return;
  const cx = objs.reduce((s, o) => s + o.x, 0) / objs.length;
  const cy = objs.reduce((s, o) => s + o.y, 0) / objs.length;
  mutate(() => { for (const o of objs) rotateObjectAbout(o, cx, cy, 90); });
}

export function copyLandscapeSelection() {
  const objs = selectedObjects();
  if (!objs.length) return false;
  clipboard = { objects: JSON.parse(JSON.stringify(objs)), pastes: 0 };
  toast(objs.length > 1 ? `Скопировано объектов: ${objs.length}` : 'Скопировано — Ctrl+V вставит рядом');
  return true;
}

function pasteObjects(list, offset) {
  const copies = list.map((o) => cloneLandscapeObject(o, offset, offset));
  mutate(() => { landscapeObjects().push(...copies); });
  selectLandscape(copies.map((o) => o.id));
}

export function pasteLandscape() {
  if (!clipboard) { toast('Сначала выберите объект и нажмите Ctrl+C'); return false; }
  clipboard.pastes += 1;
  pasteObjects(clipboard.objects, 1000 * clipboard.pastes);
  return true;
}

export function duplicateLandscapeSelection() {
  const objs = selectedObjects();
  if (objs.length) pasteObjects(objs, 1000);
}

// Клавиши режима; true — нажатие обработано.
export function handleLandscapeKey(event) {
  const mod = event.ctrlKey || event.metaKey;
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
  if (event.code === 'KeyR') { rotateLandscape90(); return true; }
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

// ------------------------------------------------------------ Каталог слева

export function bindLandscapeLibrary() {
  el('lsSearch')?.addEventListener('input', () => renderLandscapeItems());
}

export function renderLandscapeLibrary() {
  const tabs = el('lsTabs');
  if (!tabs || state.modeName !== 'landscape') return;
  tabs.innerHTML = '';
  for (const cat of LANDSCAPE_CATEGORIES) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'lib-tab';
    btn.dataset.lsCat = cat.id;
    btn.textContent = cat.title;
    btn.classList.toggle('active', cat.id === category);
    btn.addEventListener('click', () => {
      category = cat.id;
      if (el('lsSearch')) el('lsSearch').value = '';
      renderLandscapeLibrary();
    });
    tabs.appendChild(btn);
  }
  renderLandscapeItems();
}

function renderLandscapeItems() {
  const box = el('lsItems');
  if (!box) return;
  const q = (el('lsSearch')?.value || '').trim();
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
    const chip = document.createElement('div');
    chip.className = 'furniture-chip ls-chip';
    chip.draggable = true;
    chip.dataset.lsKind = def.kind;
    chip.title = shape
      ? `«${def.title}»: клик — рисовать ${def.shape === 'line' ? 'линию по точкам' : 'контур по точкам или прямоугольником'}`
      : `«${def.title}»: клик — ставить курсором, или перетащите на участок`;
    const active = (state.tool?.kind === 'place-landscape' || state.tool?.kind === 'draw-landscape') && state.tool.lsKind === def.kind;
    if (active) chip.classList.add('active');
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
    try { drawLandscapePreview(preview, def.kind); } catch { /* превью не критично */ }
    chip.addEventListener('dragstart', (e) => {
      chip.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'copy';
      e.dataTransfer.setData(LANDSCAPE_MIME, def.kind);
    });
    chip.addEventListener('dragend', () => chip.classList.remove('dragging'));
    chip.addEventListener('click', () => {
      if (active) { cancelTool(); selectObject(state.selection); renderLandscapeLibrary(); } else startPlaceLandscape(def.kind);
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

export function renderLandscapeProps(panel) {
  if (state.tool?.kind === 'draw-landscape') { renderDrawProps(panel); return; }
  const objs = selectedObjects();
  if (!objs.length) { renderLandscapeSummary(panel); return; }
  if (objs.length > 1) {
    panel.innerHTML = `
      <h2>Ландшафт</h2>
      <div class="prop-block">
        <div class="prop-row"><span>Выбрано объектов</span><strong>${objs.length}</strong></div>
        <p class="hint">Тяните мышью или стрелками · R — повернуть группу · Ctrl+D — копия</p>
      </div>`;
    bindCommon(panel);
    return;
  }
  const o = objs[0];
  const def = landscapeDef(o.kind);
  const shape = isPathShape(def);
  const notes = currentWarnings().get(o.id) || [];
  const variants = def.variants.length > 1
    ? `<label class="prop-field"><span>${shape ? 'Материал / вариант' : 'Вариант'}</span><select id="lsVariant">${variantOptions(def, o.variant)}</select></label>`
    : '';
  let size;
  if (shape) {
    size = `
      ${def.shape === 'line' ? `<label class="prop-field"><span>Ширина, м</span><input id="lsWidth" type="number" step="0.05" min="0.05" max="10" value="${m(o.width || def.h)}"></label>` : ''}
      <label class="check-row"><input type="checkbox" id="lsSmooth" ${o.smooth ? 'checked' : ''}><span>Сглаженная (изогнутая)</span></label>
      <div class="prop-row"><span>${def.shape === 'line' ? 'Длина × ширина' : 'Площадь · периметр'}</span><strong id="lsMeasure">${landscapeMeasure(o, def)}</strong></div>
      <div class="prop-row"><span>Вершин</span><strong>${o.points.length}</strong></div>`;
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
  const helpers = shape ? `
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
    ${def.shape === 'poly' ? `
    <h3>Заполнить растениями</h3>
    <div class="prop-block">
      <label class="prop-field"><span>Растение</span><select id="lsFillKind">${plantOptions(helper.plant)}</select></label>
      <label class="prop-field"><span>Густота</span><input id="lsFillDensity" type="range" min="0.1" max="1" step="0.05" value="${helper.density}"></label>
      <button type="button" id="lsFillGo">Заполнить область</button>
    </div>` : ''}` : '';
  panel.innerHTML = `
    <h2>${escapeHtml(def.title)}</h2>
    <div class="prop-block">
      <div class="prop-row"><span>${escapeHtml(def.group)}</span><span>${def.tall ? 'высокий' : def.cover ? 'покрытие' : ''}</span></div>
      ${variants}
      ${size}
      <label class="prop-field"><span>Высота, м</span><input id="lsHeight" type="number" step="0.1" min="0" max="40" value="${m(o.height || 0)}"></label>
      ${shape ? '' : `<label class="prop-field"><span>Поворот, °</span><input id="lsRot" type="number" step="5" value="${Math.round(o.rotation || 0)}"></label>`}
      <div class="prop-grid">
        <label class="prop-field"><span>Цвет</span><input id="lsColor" type="color" value="${/^#[0-9a-f]{6}$/i.test(color) ? color : '#6aa84f'}"></label>
        <label class="check-row"><input type="checkbox" id="lsLock" ${o.locked ? 'checked' : ''}><span>Замок</span></label>
      </div>
      ${o.color ? '<button type="button" class="link" id="lsColorReset">Цвет по умолчанию</button>' : ''}
      ${shape && !o.locked ? '<p class="hint">Тяните вершины · «+» на ребре или двойной клик по ребру — новая вершина · двойной клик по вершине, Alt+клик или Delete — удалить</p>' : ''}
      ${notes.map((t) => `<p class="ls-note">${escapeHtml(t)}</p>`).join('')}
    </div>
    ${helpers}`;
  bindCommon(panel);
  const num = (id) => Number(panel.querySelector(id)?.value);
  panel.querySelector('#lsVariant')?.addEventListener('change', (e) => mutate(() => { o.variant = e.target.value; }));
  const applySize = () => {
    const w = Math.round(num('#lsW') * 1000);
    const h = def.lockAspect ? w : Math.round(num('#lsH') * 1000);
    if (!(w > 0) || !(h > 0)) return;
    mutate(() => { resizeObject(o, w, h); });
  };
  panel.querySelector('#lsW')?.addEventListener('change', applySize);
  panel.querySelector('#lsH')?.addEventListener('change', applySize);
  panel.querySelector('#lsWidth')?.addEventListener('change', () => {
    const v = num('#lsWidth');
    if (Number.isFinite(v) && v > 0) mutate(() => { o.width = clampWidth(v * 1000); syncShape(o); });
  });
  panel.querySelector('#lsSmooth')?.addEventListener('change', (e) => mutate(() => {
    if (e.target.checked) o.smooth = true; else delete o.smooth;
    syncShape(o);
  }));
  panel.querySelector('#lsHeight')?.addEventListener('change', () => {
    const v = num('#lsHeight');
    if (Number.isFinite(v) && v >= 0) mutate(() => { o.height = Math.round(v * 1000); });
  });
  panel.querySelector('#lsRot')?.addEventListener('change', () => {
    const v = num('#lsRot');
    if (Number.isFinite(v)) mutate(() => { o.rotation = ((Math.round(v) % 360) + 360) % 360; });
  });
  panel.querySelector('#lsColor')?.addEventListener('change', (e) => mutate(() => { o.color = e.target.value; }));
  panel.querySelector('#lsColorReset')?.addEventListener('click', () => mutate(() => { delete o.color; }));
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
function renderDrawProps(panel) {
  const tool = state.tool;
  const def = landscapeDef(tool.lsKind);
  const o = tool.opts;
  panel.innerHTML = `
    <h2>Рисование: ${escapeHtml(def.title)}</h2>
    <div class="prop-block">
      ${def.variants.length > 1 ? `<label class="prop-field"><span>Материал / вариант</span><select id="lsDrawVariant">${variantOptions(def, o.variant)}</select></label>` : ''}
      ${def.shape === 'line' ? `<label class="prop-field"><span>Ширина, м</span><input id="lsDrawWidth" type="number" step="0.05" min="0.05" max="10" value="${m(o.width || def.h)}"></label>` : ''}
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
    if (Number.isFinite(v) && v > 0) { o.width = clampWidth(v * 1000); remember(); }
  });
  panel.querySelector('#lsDrawSmooth')?.addEventListener('change', (e) => { o.smooth = e.target.checked; remember(); });
  panel.querySelector('#lsDrawFinish')?.addEventListener('click', () => finishLandscapeDraw());
  panel.querySelector('#lsDrawCancel')?.addEventListener('click', () => { cancelTool(); selectObject(null); renderLandscapeLibrary(); });
}

function bindCommon(panel) {
}

function safeName() {
  return (state.project.name || 'kepler-plan').replace(/[^\wа-яА-ЯёЁ -]/g, '').trim().replace(/\s+/g, '-') || 'kepler-plan';
}

export function downloadLandscapeCsv() {
  if (!landscapeObjects().length) { toast('Ландшафт пуст — ведомость нечего выгружать', true); return; }
  saveFile(`${safeName()}-ландшафт.csv`, buildLandscapeCsv(state.project), 'text/csv;charset=utf-8');
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
  const outside = warn.filter((t) => t.startsWith('За границей')).length;
  const near = warn.length - outside;
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
      ${outside ? `<p class="ls-note">За границей участка: ${outside}</p>` : ''}
      ${near ? `<p class="ls-note">Деревья ближе ${TREE_HOUSE_MIN / 1000} м к дому: ${near}</p>` : ''}
      ${site.boundary?.length ? '' : '<p class="hint">Границу участка можно начертить в режиме «Участок».</p>'}
      <p class="hint">Выберите объект слева: клик — ставить курсором (Esc — выйти), или перетащите на участок. Дорожки, ограждения и контуры — рисуются по точкам. Shift — несколько, рамка — выделить группу.</p>
    </div>
    ${balance ? `
    <h3>Баланс территории</h3>
    <div class="prop-block" id="lsBalance">
      ${balanceRows(balance).map(([k, v]) => `<div class="prop-row"><span>${escapeHtml(k)}</span><strong>${escapeHtml(v)}</strong></div>`).join('')}
    </div>` : ''}
    <h3>Слои</h3>
    <div class="prop-block ls-vis">
      ${LANDSCAPE_VIS.map((g) => `<label class="check-row"><input type="checkbox" data-ls-vis="${g.id}" ${vis[g.id] !== false ? 'checked' : ''}><span>${g.title}</span></label>`).join('')}
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
