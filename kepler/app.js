// Kepler Plan — редактор архитектурных концепций частных домов.
// Два режима: «План» (дом) и «Участок» (граница, зона застройки, топосъёмка,
// север, инсоляция). Мебель — свободные объекты. Выделение — левой кнопкой,
// рамка по пустому месту; панорама — правой/средней кнопкой или с пробелом.

import {
  createProject, createRoom, createOpening, createItem,
  serializeProject, deserializeProject, roomById, removeRoom,
} from './core/model.js';
import { ROOM_TYPES, roomType, furnitureDef, DOOR_WIDTH, WINDOW_WIDTH, GRID_STEP } from './core/catalog.js';
import {
  deriveWalls, openingRect, clampOpeningOffset, sideEdge, MAX_SHARED_GAP,
} from './core/walls.js';
import {
  validateRoomPlacement, snapRoomPosition, determineParent, moveRoomBy,
  roomNetAreaM2, totalAreaM2, analyzeConnectivity, suggestAccess, MIN_ROOM_SIZE,
} from './core/rooms.js';
import {
  arrangeRoom, defaultItemsFor, itemRect, itemTitle, itemsInRoom, reclaimItemsFromChild,
} from './core/furnish.js';
import { buildStructuredExport, buildProjectDxf } from './core/export.js';
import {
  ensureSite, polygonAreaM2, buildZonePolygon, nearestPointOnPolyline,
  distanceToPolyline, sunPosition, formatSunInfo, DEFAULT_ROAD_WIDTH,
} from './core/site.js';
import { pointInPolygon } from './core/zamer/geometry.js';
import {
  createRenderer, roomHandles, openingHandles, underlayHandles, HANDLE_SIZE,
  neighborCorners, neighborRotators, rotateVec, projectPoint, unprojectPoint,
} from './render.js';

const AUTOSAVE_KEY = 'kepler-plan-autosave';
const THEME_KEY = 'kepler-theme';
const PDFJS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174';

// --- Тема: система (по умолчанию) → светлая → тёмная ---
function prefersDark() {
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
}

function applyTheme(mode) {
  const root = document.documentElement;
  if (mode === 'light' || mode === 'dark') root.dataset.theme = mode;
  else delete root.dataset.theme;
  const btn = document.getElementById('themeBtn');
  if (btn) {
    const effectiveDark = mode === 'dark' || (mode === 'system' && prefersDark());
    btn.textContent = effectiveDark ? '☾' : '☀';
    btn.title = `Тема: ${mode === 'system' ? 'как в системе' : mode === 'light' ? 'светлая' : 'тёмная'} — нажмите, чтобы сменить`;
  }
}

function loadTheme() {
  let mode = 'system';
  try { mode = localStorage.getItem(THEME_KEY) || 'system'; } catch { /* нет доступа */ }
  applyTheme(mode);
  return mode;
}

function cycleTheme() {
  let current = 'system';
  try { current = localStorage.getItem(THEME_KEY) || 'system'; } catch { /* нет */ }
  const next = current === 'system' ? 'light' : current === 'light' ? 'dark' : 'system';
  try { localStorage.setItem(THEME_KEY, next); } catch { /* нет */ }
  applyTheme(next);
  requestDraw();
  toast(`Тема: ${next === 'system' ? 'как в системе' : next === 'light' ? 'светлая' : 'тёмная'}`);
}

// ---------------------------------------------------------------- Состояние

const canvas = document.getElementById('canvas');
const renderer = createRenderer(canvas);

const state = {
  project: null,
  walls: [],
  modeName: 'plan', // 'plan' | 'site'
  views: {
    plan: { scale: 0.08, panX: 120, panY: 120 },
    site: { scale: 0.03, panX: 120, panY: 120 },
  },
  view: { scale: 0.08, panX: 120, panY: 120, rotation: 0 },
  selection: null,
  hover: null,
  tool: null, // активный инструмент (размещение, рисование, калибровка...)
  ghost: null,
  ghostOpening: null,
  draft: null, // рисуемая ломаная участка
  marquee: null,
  guides: [],
  rejected: new Map(), // roomId -> причины отказов расстановки
  calibration: null, // {p1, p2, measured}
  underlayImg: null,
};

const history = { undo: [], redo: [] };
let autosaveTimer = null;
let drawQueued = false;
let spaceDown = false;
let drag = null;

// ---------------------------------------------------------------- DOM

const el = (id) => document.getElementById(id);
const refs = {
  projectName: el('projectName'),
  roomCards: el('roomCards'),
  siteTools: el('siteTools'),
  libraryTitle: el('libraryTitle'),
  libraryHint: el('libraryHint'),
  props: el('propsPanel'),
  hint: el('canvasHint'),
  statusCursor: el('cursorPos'),
  statusScale: el('scaleInfo'),
  connectivity: el('connectivityBar'),
  toast: el('toast'),
  fileInput: el('fileInput'),
  underlayInput: el('underlayInput'),
  exportDropdown: el('exportDropdown'),
  modePlan: el('modePlanBtn'),
  modeSite: el('modeSiteBtn'),
};

// ---------------------------------------------------------------- Утилиты

const screenToWorld = (sx, sy) => unprojectPoint(state.view, sx, sy);
const worldToScreen = (x, y) => projectPoint(state.view, x, y);

function pointerScreen(event) {
  const rect = canvas.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}

function pointerWorld(event) {
  const p = pointerScreen(event);
  return screenToWorld(p.x, p.y);
}

function requestDraw() {
  if (drawQueued) return;
  drawQueued = true;
  requestAnimationFrame(() => {
    drawQueued = false;
    renderer.draw(state);
  });
}

function toast(message, long = false) {
  refs.toast.textContent = message;
  refs.toast.classList.add('show');
  clearTimeout(refs.toast._timer);
  refs.toast._timer = setTimeout(() => refs.toast.classList.remove('show'), long ? 5200 : 2600);
}

function refreshDerived() {
  state.walls = deriveWalls(state.project);
}

function snapshot() {
  return serializeProject(state.project);
}

function pushHistory(before) {
  history.undo.push(before);
  if (history.undo.length > 40) history.undo.shift();
  history.redo.length = 0;
}

function mutate(fn, { arrange = [], skipHistory = false } = {}) {
  const before = snapshot();
  fn();
  refreshDerived();
  for (const roomId of new Set(arrange)) {
    const room = roomById(state.project, roomId);
    if (room) state.rejected.set(roomId, arrangeRoom(state.project, room, state.walls));
  }
  if (!skipHistory) pushHistory(before);
  afterChange();
}

// Лёгкое изменение без истории (настройки солнца, прозрачность подложки).
function tweak(fn) {
  fn();
  scheduleAutosave();
  requestDraw();
}

function afterChange() {
  syncUnderlayImage();
  updateConnectivity();
  renderProps();
  requestDraw();
  scheduleAutosave();
}

function scheduleAutosave() {
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => {
    try { localStorage.setItem(AUTOSAVE_KEY, serializeProject(state.project)); } catch { /* тихо */ }
  }, 500);
}

function restoreFrom(text) {
  state.project = deserializeProject(text);
  ensureSite(state.project);
  state.selection = null;
  refreshDerived();
  applyModeRotation();
  afterChange();
}

function undo() {
  if (!history.undo.length) return;
  history.redo.push(snapshot());
  restoreFrom(history.undo.pop());
}

function redo() {
  if (!history.redo.length) return;
  history.undo.push(snapshot());
  restoreFrom(history.redo.pop());
}

function syncUnderlayImage() {
  const src = state.project.site?.underlay?.src;
  if (!src) { state.underlayImg = null; return; }
  if (state.underlayImg?.dataset?.src === src) return;
  const img = new Image();
  img.dataset.src = src;
  img.onload = () => requestDraw();
  img.src = src;
  state.underlayImg = img;
}

function reconcileOpenings() {
  const walls = deriveWalls(state.project);
  const dropped = [];
  for (const opening of [...state.project.openings]) {
    const clamped = clampOpeningOffset(state.project, opening, walls, opening.offset);
    if (clamped === null) {
      state.project.openings = state.project.openings.filter((o) => o.id !== opening.id);
      dropped.push(opening);
    } else {
      opening.offset = clamped;
    }
  }
  if (dropped.length) toast(`Удалено проёмов без стены: ${dropped.length}`);
}

// ---------------------------------------------------------------- Режимы

function applyModeRotation() {
  state.view.rotation = state.modeName === 'site'
    ? -((state.project.site?.north || 0) * Math.PI) / 180
    : 0;
}

function setEditorMode(mode) {
  if (state.modeName === mode) return;
  state.views[state.modeName] = { scale: state.view.scale, panX: state.view.panX, panY: state.view.panY };
  state.modeName = mode;
  const saved = state.views[mode];
  state.view.scale = saved.scale;
  state.view.panX = saved.panX;
  state.view.panY = saved.panY;
  applyModeRotation();
  cancelTool();
  state.selection = null;
  refs.modePlan.classList.toggle('active', mode === 'plan');
  refs.modeSite.classList.toggle('active', mode === 'site');
  refs.roomCards.hidden = mode !== 'plan';
  refs.siteTools.hidden = mode !== 'site';
  refs.libraryTitle.textContent = mode === 'plan' ? 'Помещения' : 'Участок';
  refs.libraryHint.textContent = mode === 'plan'
    ? 'Кликните тип, затем место на плане. Комнаты стыкуются сами.'
    : 'Топосъёмка, граница, красная линия, въезд, дорога, север.';
  renderProps();
  refs.statusScale.textContent = scaleLabel();
  requestDraw();
}

// ---------------------------------------------------------------- Поиск под курсором

function hitRoomHandle(screen) {
  if (state.selection?.type !== 'room') return null;
  const room = roomById(state.project, state.selection.id);
  if (!room) return null;
  for (const handle of roomHandles(room)) {
    const p = worldToScreen(handle.x, handle.y);
    if (Math.abs(p.x - screen.x) <= HANDLE_SIZE && Math.abs(p.y - screen.y) <= HANDLE_SIZE) {
      return { room, handle: handle.id };
    }
  }
  return null;
}

function hitOpeningHandle(screen) {
  if (state.selection?.type !== 'opening') return null;
  const opening = state.project.openings.find((o) => o.id === state.selection.id);
  if (!opening) return null;
  for (const handle of openingHandles(state.project, opening, state.walls)) {
    const p = worldToScreen(handle.x, handle.y);
    if (Math.abs(p.x - screen.x) <= HANDLE_SIZE && Math.abs(p.y - screen.y) <= HANDLE_SIZE) {
      return { opening, end: handle.end };
    }
  }
  return null;
}

function hitUnderlayHandle(screen) {
  const site = state.project.site;
  if (state.selection?.type !== 'site' || state.selection.kind !== 'underlay') return null;
  if (!site.underlay || site.underlay.locked) return null;
  for (const handle of underlayHandles(site.underlay)) {
    const p = worldToScreen(handle.x, handle.y);
    if (Math.abs(p.x - screen.x) <= HANDLE_SIZE && Math.abs(p.y - screen.y) <= HANDLE_SIZE) {
      return { corner: handle.id };
    }
  }
  return null;
}

function hitNeighborHandle(screen) {
  if (state.selection?.type !== 'site' || state.selection.kind !== 'neighbor') return null;
  const n = state.project.site.neighbors.find((x) => x.id === state.selection.id);
  if (!n) return null;
  // Круги вращения — чуть снаружи углов (проверяем раньше квадратов).
  for (const r of neighborRotators(n, 22, state.view.scale)) {
    const p = worldToScreen(r.x, r.y);
    if (Math.hypot(p.x - screen.x, p.y - screen.y) <= HANDLE_SIZE) return { mode: 'rotate', corner: r.id };
  }
  for (const c of neighborCorners(n)) {
    const p = worldToScreen(c.x, c.y);
    if (Math.abs(p.x - screen.x) <= HANDLE_SIZE && Math.abs(p.y - screen.y) <= HANDLE_SIZE) {
      return { mode: 'resize', corner: c.id };
    }
  }
  return null;
}

function hitSiteVertex(screen) {
  const sel = state.selection;
  if (sel?.type !== 'site') return null;
  const site = state.project.site;
  const points = sel.kind === 'boundary' ? site.boundary
    : sel.kind === 'redline' ? site.redLine
      : sel.kind === 'road' ? site.roads.find((r) => r.id === sel.id)?.points : null;
  if (!points) return null;
  for (let i = 0; i < points.length; i += 1) {
    const p = worldToScreen(points[i].x, points[i].y);
    if (Math.abs(p.x - screen.x) <= HANDLE_SIZE && Math.abs(p.y - screen.y) <= HANDLE_SIZE) {
      return { kind: sel.kind, id: sel.id, index: i, points };
    }
  }
  return null;
}

function hitItem(world) {
  const items = state.project.items;
  for (let i = items.length - 1; i >= 0; i -= 1) {
    const r = itemRect(items[i]);
    if (world.x >= r.x && world.x <= r.x + r.w && world.y >= r.y && world.y <= r.y + r.h) return items[i];
  }
  return null;
}

function hitOpening(world) {
  const pad = 8 / state.view.scale + 40;
  for (const opening of state.project.openings) {
    const placed = openingRect(state.project, opening, state.walls);
    if (!placed) continue;
    const r = placed.rect;
    if (world.x >= r.x - pad && world.x <= r.x + r.w + pad && world.y >= r.y - pad && world.y <= r.y + r.h + pad) {
      return opening;
    }
  }
  return null;
}

function hitWall(world) {
  for (const wall of state.walls) {
    const b = wall.band;
    if (world.x >= b.x && world.x <= b.x + b.w && world.y >= b.y && world.y <= b.y + b.h) return wall;
  }
  return null;
}

function hitRoom(world) {
  const nested = state.project.rooms.filter((r) => r.parentId);
  const top = state.project.rooms.filter((r) => !r.parentId);
  for (const room of [...nested, ...top]) {
    if (world.x >= room.x && world.x <= room.x + room.w && world.y >= room.y && world.y <= room.y + room.h) {
      return room;
    }
  }
  return null;
}

function hitSiteObject(world) {
  const site = state.project.site;
  if (!site) return null;
  const tol = 9 / state.view.scale;
  if (site.entry && Math.hypot(site.entry.x - world.x, site.entry.y - world.y) < tol + 900) {
    return { type: 'site', kind: 'entry' };
  }
  for (const n of site.neighbors || []) {
    if (Math.abs(world.x - n.x) <= n.w / 2 && Math.abs(world.y - n.y) <= n.h / 2) {
      return { type: 'site', kind: 'neighbor', id: n.id };
    }
  }
  if (site.boundary?.length >= 2 && distanceToPolyline(site.boundary, world, true) < tol + 60) {
    return { type: 'site', kind: 'boundary' };
  }
  if (site.redLine?.length >= 2 && distanceToPolyline(site.redLine, world, Boolean(site.redLineClosed)) < tol + 80) {
    return { type: 'site', kind: 'redline' };
  }
  for (const road of site.roads || []) {
    if (road.points.length >= 2 && distanceToPolyline(road.points, world, Boolean(road.closed)) < road.width / 2 + tol) {
      return { type: 'site', kind: 'road', id: road.id };
    }
  }
  const u = site.underlay;
  if (u && world.x >= u.x && world.x <= u.x + u.widthPx * u.mmPerPx && world.y >= u.y && world.y <= u.y + u.heightPx * u.mmPerPx) {
    return { type: 'site', kind: 'underlay' };
  }
  return null;
}

function findWall(key, from) {
  return state.walls.find((w) => w.key === key && (from === undefined || Math.abs(w.from - from) < 1)) || null;
}

function nearestWall(world, maxScreenDist = 26) {
  const maxDist = maxScreenDist / state.view.scale;
  let best = null;
  for (const wall of state.walls) {
    const b = wall.band;
    const cx = Math.min(Math.max(world.x, b.x), b.x + b.w);
    const cy = Math.min(Math.max(world.y, b.y), b.y + b.h);
    const d = Math.hypot(world.x - cx, world.y - cy);
    if (d <= maxDist && (!best || d < best.dist)) best = { wall, dist: d };
  }
  return best?.wall || null;
}

// ---------------------------------------------------------------- Инструменты

function selectObject(selection) {
  state.selection = selection;
  renderProps();
  requestDraw();
}

function setHint(text) {
  refs.hint.textContent = text;
  refs.hint.hidden = !text;
}

function setTool(tool, hint) {
  state.tool = tool;
  state.draft = null;
  state.ghost = null;
  state.ghostOpening = null;
  setHint(hint || '');
  renderLibrary();
  requestDraw();
}

function cancelTool() {
  state.tool = null;
  state.draft = null;
  state.ghost = null;
  state.ghostOpening = null;
  state.calibration = null;
  state.entryGhost = null;
  state.calCursor = null;
  state.northCursor = null;
  state.guides = [];
  if (!el('calOverlay').hidden) el('calOverlay').hidden = true;
  setHint('');
  renderLibrary();
  requestDraw();
}

function startPlaceRoom(type) {
  setTool({ kind: 'place-room', type }, `Кликните на плане, чтобы разместить «${roomType(type).title}» · Esc — отмена`);
  state.selection = null;
  renderProps();
}

function startPlaceOpening(openKind, presetWall = null) {
  setTool({ kind: 'place-opening', openKind, presetWall }, openKind === 'door'
    ? 'Кликните по стене, чтобы добавить дверь · Esc — отмена'
    : 'Кликните по наружной стене, чтобы добавить окно · Esc — отмена');
}

function startDraw(target) {
  const names = { boundary: 'границу участка', redline: 'красную линию', road: 'ось дороги' };
  const finish = target === 'boundary'
    ? 'клик по первой точке или Enter — замкнуть'
    : 'двойной клик или Enter — завершить';
  setTool({ kind: 'draw', target }, `Кликами наметьте ${names[target]} · ${finish} · Esc — отмена`);
  state.draft = { kind: target, points: [], cursor: null, closeHint: target === 'boundary' };
}

// ---------------------------------------------------------------- Действия: план

function placeRoomAt(world) {
  const def = roomType(state.tool.type);
  const w = def.w;
  const h = def.h;
  let x = world.x - w / 2;
  let y = world.y - h / 2;
  const parentId = determineParent(state.project, { x, y, w, h }, null);
  const snapped = snapRoomPosition(state.project, { id: '__ghost__', w, h }, x, y, 14 / state.view.scale, parentId);
  x = snapped.x; y = snapped.y;
  const verdict = validateRoomPlacement(state.project, { x, y, w, h, parentId }, null);
  if (!verdict.ok) { toast(verdict.reason, true); return; }
  const room = createRoom(state.tool.type, x, y, w, h);
  room.parentId = parentId;
  const sameType = state.project.rooms.filter((r) => r.type === room.type).length;
  if (sameType > 0) room.name = `${def.title} ${sameType + 1}`;
  mutate(() => {
    state.project.rooms.push(room);
    // Мебель родителя из-под нового помещения вытаскивается.
    if (parentId) reclaimItemsFromChild(state.project, roomById(state.project, parentId), room);
    // Типовой набор мебели сразу в комнату — дальше пользователь двигает сам.
    for (const item of defaultItemsFor(room)) state.project.items.push(item);
  }, { arrange: parentId ? [room.id, parentId] : [room.id] });
  cancelTool();
  selectObject({ type: 'room', id: room.id });
  if (parentId) toast(`«${room.name}» вложена в «${roomById(state.project, parentId).name}» и отнимает её площадь`);
}

function placeOpeningAt(world) {
  const openKind = state.tool.openKind;
  const wall = state.tool.presetWall ? findWall(state.tool.presetWall.key, state.tool.presetWall.from) : nearestWall(world);
  if (!wall) { toast('Кликните ближе к стене'); return; }
  const roomId = wall.rooms[0];
  const side = wall.sides[roomId];
  const room = roomById(state.project, roomId);
  if (openKind === 'window' && (wall.kind === 'shared' || room.parentId)) {
    toast('Окно можно разместить только на наружной стене');
    return;
  }
  const edge = sideEdge(room, side);
  const base = edge.orient === 'h' ? room.x : room.y;
  const desired = (wall.orient === 'h' ? world.x : world.y) - base;
  const width = openKind === 'door' ? DOOR_WIDTH : WINDOW_WIDTH;
  const opening = createOpening(openKind, roomId, side, desired, width);
  const clamped = clampOpeningOffset(state.project, opening, state.walls, desired);
  if (clamped === null) { toast('На этом участке стены проём не помещается'); return; }
  opening.offset = clamped;
  mutate(() => { state.project.openings.push(opening); });
  cancelTool();
  selectObject({ type: 'opening', id: opening.id });
}

function addFurniture(kind, room) {
  const fd = furnitureDef(kind);
  if (!fd) return;
  const item = createItem(kind, Math.round((room.x + room.w / 2) / GRID_STEP) * GRID_STEP,
    Math.round((room.y + room.h / 2) / GRID_STEP) * GRID_STEP, fd.w, fd.h);
  mutate(() => { state.project.items.push(item); });
  selectObject({ type: 'item', id: item.id });
  toast(`«${fd.title}» в центре комнаты — перетащите на место`);
}

function deleteSelection() {
  const sel = state.selection;
  if (!sel) return;
  if (sel.type === 'room') {
    const room = roomById(state.project, sel.id);
    if (!room) return;
    mutate(() => { removeRoom(state.project, sel.id); reconcileOpenings(); });
    state.selection = null;
    toast(`«${room.name}» удалена`);
  } else if (sel.type === 'opening') {
    mutate(() => {
      state.project.openings = state.project.openings.filter((o) => o.id !== sel.id);
    });
    state.selection = null;
  } else if (sel.type === 'item') {
    mutate(() => {
      state.project.items = state.project.items.filter((i) => i.id !== sel.id);
    });
    state.selection = null;
  } else if (sel.type === 'multi') {
    mutate(() => {
      state.project.items = state.project.items.filter((i) => !sel.itemIds.includes(i.id));
      for (const roomId of sel.roomIds) removeRoom(state.project, roomId);
      reconcileOpenings();
    });
    state.selection = null;
    toast('Выделенные объекты удалены');
  } else if (sel.type === 'site') {
    const site = state.project.site;
    mutate(() => {
      if (sel.kind === 'boundary') { site.boundary = null; site.entry = null; }
      if (sel.kind === 'redline') site.redLine = null;
      if (sel.kind === 'road') site.roads = site.roads.filter((r) => r.id !== sel.id);
      if (sel.kind === 'neighbor') site.neighbors = site.neighbors.filter((n) => n.id !== sel.id);
      if (sel.kind === 'entry') site.entry = null;
      if (sel.kind === 'underlay') site.underlay = null;
    });
    state.selection = null;
  }
  renderProps();
  requestDraw();
}

function rotateSelectedItem() {
  if (state.selection?.type !== 'item') return;
  const item = state.project.items.find((i) => i.id === state.selection.id);
  if (!item) return;
  mutate(() => { item.rotation = ((item.rotation || 0) + 90) % 360; });
}

// ---------------------------------------------------------------- Действия: участок

function makeSiteId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e4).toString(36)}`;
}

function finishDraft() {
  const draft = state.draft;
  if (!draft) return;
  const site = state.project.site;
  if (draft.kind === 'boundary') {
    if (draft.points.length < 3) { toast('Нужно минимум 3 точки'); return; }
    mutate(() => { site.boundary = draft.points.map((p) => ({ ...p })); });
    selectObject({ type: 'site', kind: 'boundary' });
    toast(`Граница участка: ${polygonAreaM2(site.boundary).toFixed(1)} м². Красная зона — отступ ${(site.setbackBoundary / 1000).toLocaleString('ru-RU')} м`);
  } else if (draft.kind === 'redline') {
    if (draft.points.length < 2) { toast('Нужно минимум 2 точки'); return; }
    mutate(() => {
      site.redLine = draft.points.map((p) => ({ ...p }));
      site.redLineClosed = Boolean(draft.closed);
    });
    selectObject({ type: 'site', kind: 'redline' });
  } else if (draft.kind === 'road') {
    if (draft.points.length < 2) { toast('Нужно минимум 2 точки'); return; }
    const road = {
      id: makeSiteId('road'), points: draft.points.map((p) => ({ ...p })),
      width: DEFAULT_ROAD_WIDTH, closed: Boolean(draft.closed),
    };
    mutate(() => { site.roads.push(road); });
    selectObject({ type: 'site', kind: 'road', id: road.id });
  }
  cancelTool();
}

function addDraftPoint(world) {
  const draft = state.draft;
  const snap = (v) => Math.round(v / 100) * 100;
  const point = { x: snap(world.x), y: snap(world.y) };
  // Клик по начальной точке (когда к ней привязались) — замкнуть контур.
  if (draft.points.length >= 3) {
    const first = worldToScreen(draft.points[0].x, draft.points[0].y);
    const here = worldToScreen(point.x, point.y);
    if (Math.hypot(first.x - here.x, first.y - here.y) < 15) { draft.closed = true; finishDraft(); return; }
  }
  draft.points.push(point);
  requestDraw();
}

// Точка въезда на границе, ближайшая к курсору, со стрелкой внутрь участка.
function computeEntryAt(world) {
  const site = state.project.site;
  if (!site.boundary || site.boundary.length < 3) return null;
  const near = nearestPointOnPolyline(site.boundary, world, true);
  if (!near) return null;
  const candidates = [near.angle + 90, near.angle - 90];
  let dir = candidates[0];
  const rad = (candidates[0] * Math.PI) / 180;
  const probe = { x: near.x + Math.cos(rad) * 500, y: near.y + Math.sin(rad) * 500 };
  if (!pointInPolygon(probe, site.boundary)) dir = candidates[1];
  return { x: near.x, y: near.y, dir, dist: near.dist };
}

function placeEntryAt(world) {
  const site = state.project.site;
  if (!site.boundary || site.boundary.length < 3) { toast('Сначала начертите границу участка'); return; }
  const spot = computeEntryAt(world);
  if (!spot) { toast('Кликните ближе к границе участка'); return; }
  mutate(() => { site.entry = { x: spot.x, y: spot.y, dir: spot.dir }; });
  state.entryGhost = null;
  cancelTool();
  selectObject({ type: 'site', kind: 'entry' });
}

function placeNeighborAt(world) {
  const site = state.project.site;
  const neighbor = {
    id: makeSiteId('nbr'),
    x: Math.round(world.x / 100) * 100,
    y: Math.round(world.y / 100) * 100,
    w: 8000,
    h: 8000,
    rot: 0,
    height: 6000,
  };
  mutate(() => { site.neighbors.push(neighbor); });
  cancelTool();
  selectObject({ type: 'site', kind: 'neighbor', id: neighbor.id });
  toast('Соседний дом добавлен: вокруг него зона 6 м, строить в ней нельзя');
}

function addNorthPoint(world) {
  const points = state.tool.points;
  points.push({ x: world.x, y: world.y });
  if (points.length < 2) { setHint('Теперь кликните вторую точку — конец стрелки на север'); requestDraw(); return; }
  const dx = points[1].x - points[0].x;
  const dy = points[1].y - points[0].y;
  if (Math.hypot(dx, dy) < 200) { toast('Точки слишком близко'); state.tool.points = []; return; }
  const north = ((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360;
  mutate(() => { state.project.site.north = Math.round(north * 10) / 10; });
  state.northCursor = null;
  applyModeRotation();
  cancelTool();
  toast(`Север задан: ${Math.round(north)}°`);
}

function addCalibratePoint(world) {
  const points = state.tool.points;
  points.push({ x: world.x, y: world.y });
  if (points.length < 2) {
    setHint('Теперь кликните вторую точку отрезка');
    requestDraw();
    return;
  }
  const measured = Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y);
  if (measured < 1) { toast('Точки слишком близко — кликните дальше'); state.tool.points = [points[0]]; return; }
  // Отрезок начерчен — показываем поле прямо на линии (как в Revit/ArchiCAD).
  state.calibration = { p1: points[0], p2: points[1], measured };
  state.tool = null;
  state.calCursor = null;
  setHint('');
  renderLibrary();
  requestDraw();
  showCalInput();
}

function showCalInput() {
  const overlay = el('calOverlay');
  const input = el('calInput');
  input.value = '';
  overlay.hidden = false;
  positionCalInput();
  setTimeout(() => input.focus(), 30);
}

function positionCalInput() {
  const overlay = el('calOverlay');
  if (overlay.hidden || !state.calibration) return;
  const c = state.calibration;
  const mid = worldToScreen((c.p1.x + c.p2.x) / 2, (c.p1.y + c.p2.y) / 2);
  // Смещаем чуть выше линии, чтобы не перекрывать её.
  overlay.style.left = `${mid.x}px`;
  overlay.style.top = `${mid.y - 26}px`;
}

function hideCalInput() {
  el('calOverlay').hidden = true;
  state.calibration = null;
  requestDraw();
}

function applyCalibration(realMeters) {
  const site = state.project.site;
  const cal = state.calibration;
  if (!site.underlay || !cal) return;
  const realMm = realMeters * 1000;
  if (!(realMm > 10)) { toast('Введите длину отрезка в метрах'); return; }
  const k = realMm / cal.measured;
  mutate(() => {
    const u = site.underlay;
    u.mmPerPx *= k;
    u.x = cal.p1.x - (cal.p1.x - u.x) * k;
    u.y = cal.p1.y - (cal.p1.y - u.y) * k;
  });
  hideCalInput();
  selectObject({ type: 'site', kind: 'underlay' });
  toast('Масштаб топосъёмки задан по отрезку');
}

// --- Загрузка топосъёмки ---

async function loadUnderlayFile(file) {
  const name = file.name.toLowerCase();
  if (name.endsWith('.dwg') || name.endsWith('.dxf')) {
    toast('DWG/DXF в браузере не читаются. Сохраните топосъёмку как PDF или JPG (в CAD: печать в PDF) и загрузите её.', true);
    return;
  }
  try {
    let dataUrl;
    let size;
    if (name.endsWith('.pdf') || file.type === 'application/pdf') {
      ({ dataUrl, size } = await renderPdfToImage(file));
    } else {
      ({ dataUrl, size } = await downscaleImage(file));
    }
    placeUnderlay(dataUrl, size);
  } catch (error) {
    toast(`Не удалось загрузить: ${error.message}`, true);
  }
}

function downscaleImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('файл не прочитался'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('это не изображение'));
      img.onload = () => {
        const maxDim = 2200;
        const k = Math.min(1, maxDim / Math.max(img.width, img.height));
        const w = Math.round(img.width * k);
        const h = Math.round(img.height * k);
        const cnv = document.createElement('canvas');
        cnv.width = w; cnv.height = h;
        const c = cnv.getContext('2d');
        c.fillStyle = '#ffffff';
        c.fillRect(0, 0, w, h);
        c.drawImage(img, 0, 0, w, h);
        resolve({ dataUrl: cnv.toDataURL('image/jpeg', 0.85), size: { w, h } });
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

async function ensurePdfJs() {
  if (window.pdfjsLib) return window.pdfjsLib;
  await new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = `${PDFJS}/pdf.min.js`;
    script.onload = resolve;
    script.onerror = () => reject(new Error('библиотека PDF недоступна (нужен интернет)'));
    document.head.appendChild(script);
  });
  window.pdfjsLib.GlobalWorkerOptions.workerSrc = `${PDFJS}/pdf.worker.min.js`;
  return window.pdfjsLib;
}

async function renderPdfToImage(file) {
  const pdfjs = await ensurePdfJs();
  const buffer = await file.arrayBuffer();
  const pdf = await pdfjs.getDocument({ data: buffer }).promise;
  const page = await pdf.getPage(1);
  const base = page.getViewport({ scale: 1 });
  const scale = Math.min(3, 2200 / Math.max(base.width, base.height));
  const viewport = page.getViewport({ scale });
  const cnv = document.createElement('canvas');
  cnv.width = Math.round(viewport.width);
  cnv.height = Math.round(viewport.height);
  const c = cnv.getContext('2d');
  c.fillStyle = '#ffffff';
  c.fillRect(0, 0, cnv.width, cnv.height);
  await page.render({ canvasContext: c, viewport }).promise;
  return { dataUrl: cnv.toDataURL('image/jpeg', 0.85), size: { w: cnv.width, h: cnv.height } };
}

function placeUnderlay(dataUrl, size) {
  const center = screenToWorld(canvas.clientWidth / 2, canvas.clientHeight / 2);
  // Картинка занимает ~70% ширины видимой области — сразу видна и по центру.
  const visibleWorldWidth = canvas.clientWidth / state.view.scale;
  const mmPerPx = (visibleWorldWidth * 0.7) / size.w;
  mutate(() => {
    state.project.site.underlay = {
      src: dataUrl,
      x: center.x - (size.w * mmPerPx) / 2,
      y: center.y - (size.h * mmPerPx) / 2,
      widthPx: size.w,
      heightPx: size.h,
      mmPerPx,
      opacity: 0.7,
      locked: false,
    };
  });
  selectObject({ type: 'site', kind: 'underlay' });
  toast('Топосъёмка загружена. Задайте масштаб справа: впишите ширину в метрах, или тяните углы картинки', true);
}

// ---------------------------------------------------------------- Ввод мыши

canvas.addEventListener('contextmenu', (e) => e.preventDefault());

canvas.addEventListener('pointerdown', (event) => {
  const screen = pointerScreen(event);
  const world = pointerWorld(event);
  canvas.setPointerCapture(event.pointerId);

  // Панорама: правая/средняя кнопка или зажатый пробел.
  if (event.button === 1 || event.button === 2 || spaceDown) {
    drag = { kind: 'pan', start: screen, view: { ...state.view } };
    return;
  }

  // Активный инструмент.
  if (state.tool) {
    const t = state.tool;
    if (t.kind === 'place-room') { placeRoomAt(world); return; }
    if (t.kind === 'place-opening') { placeOpeningAt(world); return; }
    if (t.kind === 'draw') { addDraftPoint(world); return; }
    if (t.kind === 'entry') { placeEntryAt(world); return; }
    if (t.kind === 'neighbor') { placeNeighborAt(world); return; }
    if (t.kind === 'north') { addNorthPoint(world); return; }
    if (t.kind === 'calibrate') { addCalibratePoint(world); return; }
    return;
  }

  // Клик мимо поля калибровки — отменяем калибровку.
  if (state.calibration && !el('calOverlay').hidden) { hideCalInput(); }

  // Ручки.
  const openingHandleHit = hitOpeningHandle(screen);
  if (openingHandleHit) {
    drag = { kind: 'opening-handle', id: openingHandleHit.opening.id, end: openingHandleHit.end, before: snapshot(), moved: false };
    return;
  }
  const handleHit = hitRoomHandle(screen);
  if (handleHit) {
    drag = { kind: 'resize', roomId: handleHit.room.id, handle: handleHit.handle, start: { ...handleHit.room }, before: snapshot(), world, valid: true };
    return;
  }
  const neighborHandleHit = hitNeighborHandle(screen);
  if (neighborHandleHit) {
    const n = state.project.site.neighbors.find((x) => x.id === state.selection.id);
    if (neighborHandleHit.mode === 'rotate') {
      drag = {
        kind: 'neighbor-rotate', id: n.id, startRot: n.rot || 0,
        startAngle: Math.atan2(world.y - n.y, world.x - n.x), center: { x: n.x, y: n.y },
        before: snapshot(), moved: false,
      };
    } else {
      // Якорь — противоположный угол (мировые координаты, фиксирован).
      const opposite = { nw: 'se', ne: 'sw', se: 'nw', sw: 'ne' }[neighborHandleHit.corner];
      const anchor = neighborCorners(n).find((c) => c.id === opposite);
      drag = {
        kind: 'neighbor-resize', id: n.id, corner: neighborHandleHit.corner,
        anchor: { x: anchor.x, y: anchor.y }, rot: n.rot || 0,
        before: snapshot(), moved: false,
      };
    }
    return;
  }
  const underlayHandleHit = hitUnderlayHandle(screen);
  if (underlayHandleHit) {
    const u = state.project.site.underlay;
    // Фиксированный угол — противоположный тянущемуся.
    const opposite = { nw: 'se', ne: 'sw', se: 'nw', sw: 'ne' }[underlayHandleHit.corner];
    const anchor = underlayHandles(u).find((h) => h.id === opposite);
    drag = {
      kind: 'underlay-resize', corner: underlayHandleHit.corner, anchor,
      startW: u.widthPx * u.mmPerPx, startH: u.heightPx * u.mmPerPx,
      startMmPerPx: u.mmPerPx, world, before: snapshot(), moved: false,
    };
    return;
  }
  const vertexHit = hitSiteVertex(screen);
  if (vertexHit) {
    // Важно не затереть kind='site-vertex' полем kind из vertexHit.
    drag = {
      kind: 'site-vertex', siteKind: vertexHit.kind, id: vertexHit.id,
      index: vertexHit.index, points: vertexHit.points, before: snapshot(), moved: false,
    };
    return;
  }

  const siteFirst = state.modeName === 'site';
  const trySite = () => {
    const hit = hitSiteObject(world);
    if (!hit) return false;
    if (hit.kind === 'underlay' && state.project.site.underlay?.locked) {
      selectObject(hit);
      return true;
    }
    selectObject(hit);
    if (hit.kind === 'entry') drag = { kind: 'entry', before: snapshot(), moved: false };
    else if (hit.kind === 'neighbor') {
      const n = state.project.site.neighbors.find((x) => x.id === hit.id);
      drag = { kind: 'neighbor', id: hit.id, start: { x: n.x, y: n.y }, world, before: snapshot(), moved: false };
    } else if (hit.kind === 'underlay') {
      const u = state.project.site.underlay;
      drag = { kind: 'underlay', start: { x: u.x, y: u.y }, world, before: snapshot(), moved: false };
    }
    return true;
  };

  if (siteFirst && trySite()) return;

  const item = hitItem(world);
  if (item) {
    if (state.selection?.type === 'multi' && state.selection.itemIds.includes(item.id)) {
      startMultiDrag(world);
      return;
    }
    selectObject({ type: 'item', id: item.id });
    drag = { kind: 'item', id: item.id, start: { x: item.x, y: item.y }, world, before: snapshot(), moved: false };
    return;
  }

  const opening = hitOpening(world);
  if (opening) {
    selectObject({ type: 'opening', id: opening.id });
    drag = { kind: 'opening', id: opening.id, before: snapshot(), moved: false };
    return;
  }

  const wall = hitWall(world);
  if (wall) {
    selectObject({ type: 'wall', key: wall.key, from: wall.from });
    return;
  }

  const room = hitRoom(world);
  if (room) {
    if (state.selection?.type === 'multi' && state.selection.roomIds.includes(room.id)) {
      startMultiDrag(world);
      return;
    }
    selectObject({ type: 'room', id: room.id });
    // Перевозимый груз фиксируется в момент захвата: вложенные помещения и
    // мебель, стоящая внутри, — чтобы комната не «сметала» чужую мебель по пути.
    const children = state.project.rooms.filter((r) => r.parentId === room.id);
    const carried = state.project.items
      .filter((i) => i.x >= room.x && i.x <= room.x + room.w && i.y >= room.y && i.y <= room.y + room.h)
      .map((i) => ({ id: i.id, x: i.x, y: i.y }));
    drag = {
      kind: 'room', id: room.id, world, start: { x: room.x, y: room.y },
      childStarts: children.map((c) => ({ id: c.id, x: c.x, y: c.y })),
      carried,
      startParent: room.parentId, before: snapshot(), moved: false, valid: true,
    };
    return;
  }

  if (!siteFirst && trySite()) return;

  // Пустое место: рамка выделения левой кнопкой.
  selectObject(null);
  drag = { kind: 'marquee', start: screen };
  state.marquee = { x1: screen.x, y1: screen.y, x2: screen.x, y2: screen.y };
});

function startMultiDrag(world) {
  const sel = state.selection;
  // Груз фиксируется при захвате: выбранные комнаты с их вложенными
  // помещениями и мебелью внутри + отдельно выбранная мебель.
  const roomIds = new Set(sel.roomIds);
  const movedRooms = new Map(); // id -> старт
  for (const id of sel.roomIds) {
    const room = roomById(state.project, id);
    if (!room) continue;
    movedRooms.set(id, { x: room.x, y: room.y });
    for (const child of state.project.rooms) {
      if (child.parentId === id && !movedRooms.has(child.id)) movedRooms.set(child.id, { x: child.x, y: child.y });
    }
  }
  const movedItems = new Map(); // id -> старт
  for (const item of state.project.items) {
    if (sel.itemIds.includes(item.id)) { movedItems.set(item.id, { x: item.x, y: item.y }); continue; }
    for (const id of roomIds) {
      const room = roomById(state.project, id);
      if (room && item.x >= room.x && item.x <= room.x + room.w && item.y >= room.y && item.y <= room.y + room.h) {
        movedItems.set(item.id, { x: item.x, y: item.y });
        break;
      }
    }
  }
  drag = {
    kind: 'multi',
    world,
    before: snapshot(),
    moved: false,
    valid: true,
    roomIds: [...sel.roomIds],
    roomStarts: movedRooms,
    itemStarts: movedItems,
  };
}

canvas.addEventListener('pointermove', (event) => {
  const screen = pointerScreen(event);
  const world = pointerWorld(event);
  refs.statusCursor.textContent = `${(world.x / 1000).toFixed(2)}; ${(world.y / 1000).toFixed(2)} м`;

  if (!drag) { updateHoverAndGhost(world); return; }

  if (drag.kind === 'pan') {
    state.view.panX = drag.view.panX + (screen.x - drag.start.x);
    state.view.panY = drag.view.panY + (screen.y - drag.start.y);
    requestDraw();
    return;
  }

  if (drag.kind === 'marquee') {
    state.marquee.x2 = screen.x;
    state.marquee.y2 = screen.y;
    requestDraw();
    return;
  }

  if (drag.kind === 'room') {
    const room = roomById(state.project, drag.id);
    if (!room) return;
    drag.moved = true;
    const rawX = drag.start.x + (world.x - drag.world.x);
    const rawY = drag.start.y + (world.y - drag.world.y);
    // Вложение перетаскиванием: родителем становится комната, внутрь которой
    // попадает прямоугольник; вытащили наружу — комната снова самостоятельная.
    const candidateParent = determineParent(state.project, { x: rawX, y: rawY, w: room.w, h: room.h }, room.id);
    room.parentId = candidateParent;
    const snapped = snapRoomPosition(state.project, room, rawX, rawY, 14 / state.view.scale, candidateParent);
    const dx = snapped.x - drag.start.x;
    const dy = snapped.y - drag.start.y;
    // Абсолютные позиции от стартовых: груз зафиксирован при захвате.
    room.x = snapped.x;
    room.y = snapped.y;
    for (const entry of drag.childStarts) {
      const child = roomById(state.project, entry.id);
      if (child) { child.x = entry.x + dx; child.y = entry.y + dy; }
    }
    for (const entry of drag.carried) {
      const item = state.project.items.find((i) => i.id === entry.id);
      if (item) { item.x = entry.x + dx; item.y = entry.y + dy; }
    }
    state.guides = snapped.guides;
    const verdict = validateRoomPlacement(state.project, room, room.id);
    drag.valid = verdict.ok;
    drag.reason = verdict.reason;
    const nestLabel = candidateParent && candidateParent !== drag.startParent
      ? `Вложить в «${roomById(state.project, candidateParent)?.name}»`
      : !candidateParent && drag.startParent ? 'Отделить от родителя' : ' ';
    state.ghost = { rect: { x: room.x, y: room.y, w: room.w, h: room.h }, valid: verdict.ok, label: nestLabel, reason: verdict.ok ? '' : verdict.reason };
    refreshDerived();
    requestDraw();
    return;
  }

  if (drag.kind === 'multi') {
    drag.moved = true;
    const dx = Math.round((world.x - drag.world.x) / GRID_STEP) * GRID_STEP;
    const dy = Math.round((world.y - drag.world.y) / GRID_STEP) * GRID_STEP;
    for (const [id, start] of drag.roomStarts) {
      const room = roomById(state.project, id);
      if (room) { room.x = start.x + dx; room.y = start.y + dy; }
    }
    for (const [id, start] of drag.itemStarts) {
      const item = state.project.items.find((i) => i.id === id);
      if (item) { item.x = start.x + dx; item.y = start.y + dy; }
    }
    let valid = true;
    let reason = '';
    for (const id of drag.roomIds) {
      const room = roomById(state.project, id);
      const verdict = validateRoomPlacement(state.project, room, room.id);
      if (!verdict.ok) { valid = false; reason = verdict.reason; break; }
    }
    drag.valid = valid;
    drag.reason = reason;
    refreshDerived();
    requestDraw();
    return;
  }

  if (drag.kind === 'resize') {
    const room = roomById(state.project, drag.roomId);
    if (!room) return;
    drag.moved = true;
    applyResize(room, drag, world);
    const verdict = resizeVerdict(room);
    drag.valid = verdict.ok;
    drag.reason = verdict.reason;
    state.ghost = { rect: { x: room.x, y: room.y, w: room.w, h: room.h }, valid: verdict.ok, label: `${(room.w / 1000).toFixed(2)} × ${(room.h / 1000).toFixed(2)} м`, reason: verdict.ok ? '' : verdict.reason };
    refreshDerived();
    requestDraw();
    return;
  }

  if (drag.kind === 'item') {
    const item = state.project.items.find((i) => i.id === drag.id);
    if (!item) return;
    drag.moved = true;
    item.x = Math.round((drag.start.x + (world.x - drag.world.x)) / GRID_STEP) * GRID_STEP;
    item.y = Math.round((drag.start.y + (world.y - drag.world.y)) / GRID_STEP) * GRID_STEP;
    requestDraw();
    return;
  }

  if (drag.kind === 'opening') {
    const opening = state.project.openings.find((o) => o.id === drag.id);
    if (!opening) return;
    drag.moved = true;
    const room = roomById(state.project, opening.roomId);
    const edge = sideEdge(room, opening.side);
    const base = edge.orient === 'h' ? room.x : room.y;
    const desired = (edge.orient === 'h' ? world.x : world.y) - base;
    const clamped = clampOpeningOffset(state.project, opening, state.walls, desired);
    if (clamped !== null) opening.offset = Math.round(clamped / GRID_STEP) * GRID_STEP;
    requestDraw();
    return;
  }

  if (drag.kind === 'opening-handle') {
    const opening = state.project.openings.find((o) => o.id === drag.id);
    if (!opening) return;
    drag.moved = true;
    const room = roomById(state.project, opening.roomId);
    const edge = sideEdge(room, opening.side);
    const base = edge.orient === 'h' ? room.x : room.y;
    const pos = (edge.orient === 'h' ? world.x : world.y) - base;
    const startEdge = opening.offset - opening.width / 2;
    const endEdge = opening.offset + opening.width / 2;
    const fixed = drag.end === 'start' ? endEdge : startEdge;
    const movingEdge = Math.round(pos / 50) * 50; // шаг 50 мм
    let width = Math.abs(fixed - movingEdge);
    width = Math.min(3000, Math.max(400, Math.round(width / 50) * 50));
    const center = drag.end === 'start' ? fixed - width / 2 : fixed + width / 2;
    const probe = { ...opening, width };
    const clamped = clampOpeningOffset(state.project, probe, state.walls, center);
    if (clamped !== null) {
      opening.width = width;
      opening.offset = clamped;
    }
    requestDraw();
    return;
  }

  if (drag.kind === 'neighbor-rotate') {
    const n = state.project.site.neighbors.find((x) => x.id === drag.id);
    if (!n) return;
    drag.moved = true;
    const ang = Math.atan2(world.y - drag.center.y, world.x - drag.center.x);
    let deg = drag.startRot + ((ang - drag.startAngle) * 180) / Math.PI;
    if (event.shiftKey) deg = Math.round(deg / 15) * 15; // шаг 15° с Shift
    n.rot = ((deg % 360) + 360) % 360;
    requestDraw();
    return;
  }

  if (drag.kind === 'neighbor-resize') {
    const n = state.project.site.neighbors.find((x) => x.id === drag.id);
    if (!n) return;
    drag.moved = true;
    // Размер в собственной (повёрнутой) системе дома, якорь-угол зафиксирован.
    const dLocal = rotateVec(world.x - drag.anchor.x, world.y - drag.anchor.y, -drag.rot);
    const newW = Math.max(2000, Math.abs(dLocal.x));
    const newH = Math.max(2000, Math.abs(dLocal.y));
    const half = rotateVec((Math.sign(dLocal.x) || 1) * newW / 2, (Math.sign(dLocal.y) || 1) * newH / 2, drag.rot);
    n.w = newW;
    n.h = newH;
    n.x = drag.anchor.x + half.x;
    n.y = drag.anchor.y + half.y;
    requestDraw();
    return;
  }

  if (drag.kind === 'underlay-resize') {
    const u = state.project.site.underlay;
    if (!u) return;
    drag.moved = true;
    // Пропорциональный масштаб: новая ширина = расстояние от закреплённого
    // угла до курсора по горизонтали; высота тянется пропорционально.
    const anchor = drag.anchor;
    const newW = Math.max(1000, Math.abs(world.x - anchor.x));
    const k = newW / (drag.startW || 1);
    u.mmPerPx = Math.max(0.5, drag.startMmPerPx * k);
    const w = u.widthPx * u.mmPerPx;
    const h = u.heightPx * u.mmPerPx;
    u.x = drag.corner.includes('w') ? anchor.x - w : anchor.x;
    u.y = drag.corner.includes('n') ? anchor.y - h : anchor.y;
    requestDraw();
    return;
  }

  if (drag.kind === 'site-vertex') {
    drag.moved = true;
    const point = drag.points[drag.index];
    point.x = Math.round(world.x / 100) * 100;
    point.y = Math.round(world.y / 100) * 100;
    requestDraw();
    return;
  }

  if (drag.kind === 'entry') {
    const site = state.project.site;
    if (!site.boundary) return;
    drag.moved = true;
    const near = nearestPointOnPolyline(site.boundary, world, true);
    if (near) {
      const candidates = [near.angle + 90, near.angle - 90];
      let dir = candidates[0];
      const rad = (candidates[0] * Math.PI) / 180;
      const probe = { x: near.x + Math.cos(rad) * 500, y: near.y + Math.sin(rad) * 500 };
      if (!pointInPolygon(probe, site.boundary)) dir = candidates[1];
      site.entry = { x: near.x, y: near.y, dir };
      requestDraw();
    }
    return;
  }

  if (drag.kind === 'neighbor') {
    const n = state.project.site.neighbors.find((x) => x.id === drag.id);
    if (!n) return;
    drag.moved = true;
    n.x = Math.round((drag.start.x + (world.x - drag.world.x)) / 100) * 100;
    n.y = Math.round((drag.start.y + (world.y - drag.world.y)) / 100) * 100;
    requestDraw();
    return;
  }

  if (drag.kind === 'underlay') {
    const u = state.project.site.underlay;
    if (!u || u.locked) return;
    drag.moved = true;
    u.x = drag.start.x + (world.x - drag.world.x);
    u.y = drag.start.y + (world.y - drag.world.y);
    requestDraw();
  }
});

canvas.addEventListener('pointerup', () => {
  if (!drag) return;
  const finished = drag;
  drag = null;
  state.guides = [];

  if (finished.kind === 'pan') { requestDraw(); return; }

  if (finished.kind === 'marquee') {
    applyMarquee();
    state.marquee = null;
    requestDraw();
    return;
  }

  if (finished.kind === 'room' || finished.kind === 'resize' || finished.kind === 'multi') {
    state.ghost = null;
    if (!finished.moved) { requestDraw(); return; }
    if (!finished.valid) {
      restoreFrom(finished.before);
      toast(finished.reason || 'Так разместить нельзя', true);
      return;
    }
    if (finished.kind === 'room') {
      const room = roomById(state.project, finished.id);
      if (room && (room.parentId || null) !== (finished.startParent || null)) {
        if (room.parentId) {
          const parent = roomById(state.project, room.parentId);
          // Мебель родителя из-под вложенной комнаты вытаскивается и
          // расставляется заново; привезённая мебель остаётся на месте.
          const carriedIds = new Set(finished.carried.map((c) => c.id));
          reclaimItemsFromChild(state.project, parent, room, carriedIds);
          refreshDerived();
          state.rejected.set(parent.id, arrangeRoom(state.project, parent, state.walls));
          toast(`«${room.name}» вложена в «${parent?.name}» и отнимает её площадь — можно поменять в панели справа`, true);
        } else {
          toast(`«${room.name}» отделена — снова самостоятельная комната`);
        }
      }
    }
    reconcileOpenings();
    refreshDerived();
    pushHistory(finished.before);
    afterChange();
    return;
  }

  if (finished.moved) {
    if (finished.kind === 'site-vertex' || finished.kind === 'entry') {
      // Граница изменилась — въезд заново садится на неё и ориентируется
      // перпендикулярно отрезку границы (стрелка внутрь участка).
      const site = state.project.site;
      if (site.boundary && site.entry) {
        const spot = computeEntryAt(site.entry);
        if (spot) { site.entry.x = spot.x; site.entry.y = spot.y; site.entry.dir = spot.dir; }
      }
    }
    refreshDerived();
    pushHistory(finished.before);
    afterChange();
    return;
  }
  requestDraw();
});

function applyMarquee() {
  const m = state.marquee;
  if (!m || (Math.abs(m.x2 - m.x1) < 6 && Math.abs(m.y2 - m.y1) < 6)) return;
  const poly = [
    screenToWorld(m.x1, m.y1), screenToWorld(m.x2, m.y1),
    screenToWorld(m.x2, m.y2), screenToWorld(m.x1, m.y2),
  ];
  const contains = (x, y) => pointInPolygon({ x, y }, poly);
  const roomIds = [];
  for (const room of state.project.rooms) {
    const inside = contains(room.x, room.y) && contains(room.x + room.w, room.y)
      && contains(room.x + room.w, room.y + room.h) && contains(room.x, room.y + room.h);
    if (inside) roomIds.push(room.id);
  }
  const itemIds = [];
  for (const item of state.project.items) {
    if (contains(item.x, item.y)) itemIds.push(item.id);
  }
  const total = roomIds.length + itemIds.length;
  if (total === 0) { selectObject(null); return; }
  if (total === 1) {
    selectObject(roomIds.length ? { type: 'room', id: roomIds[0] } : { type: 'item', id: itemIds[0] });
    return;
  }
  selectObject({ type: 'multi', roomIds, itemIds });
}

canvas.addEventListener('dblclick', () => {
  if (state.draft && (state.draft.kind === 'redline' || state.draft.kind === 'road')) finishDraft();
});

canvas.addEventListener('wheel', (event) => {
  event.preventDefault();
  const screen = pointerScreen(event);
  const factor = event.deltaY < 0 ? 1.12 : 1 / 1.12;
  zoomAt(screen, factor);
}, { passive: false });

function zoomAt(screen, factor) {
  const world = screenToWorld(screen.x, screen.y);
  state.view.scale = Math.min(0.6, Math.max(0.004, state.view.scale * factor));
  const projected = worldToScreen(world.x, world.y);
  state.view.panX += screen.x - projected.x;
  state.view.panY += screen.y - projected.y;
  refs.statusScale.textContent = scaleLabel();
  positionCalInput();
  requestDraw();
}

function scaleLabel() {
  const denominator = Math.round(96 / 25.4 / state.view.scale);
  return `≈ 1:${denominator}`;
}

function updateHoverAndGhost(world) {
  if (state.tool?.kind === 'place-room') {
    const def = roomType(state.tool.type);
    let x = world.x - def.w / 2;
    let y = world.y - def.h / 2;
    const parentId = determineParent(state.project, { x, y, w: def.w, h: def.h }, null);
    const snapped = snapRoomPosition(state.project, { id: '__ghost__', w: def.w, h: def.h }, x, y, 14 / state.view.scale, parentId);
    x = snapped.x; y = snapped.y;
    const verdict = validateRoomPlacement(state.project, { x, y, w: def.w, h: def.h, parentId }, null);
    state.guides = snapped.guides;
    state.ghost = {
      rect: { x, y, w: def.w, h: def.h },
      valid: verdict.ok,
      label: parentId ? `Вложить в «${roomById(state.project, parentId)?.name}»` : undefined,
      reason: verdict.ok ? '' : verdict.reason,
    };
    requestDraw();
    return;
  }
  if (state.tool?.kind === 'calibrate' && state.tool.points.length === 1) {
    state.calCursor = { x: world.x, y: world.y };
    requestDraw();
    return;
  }
  if (state.tool?.kind === 'entry') {
    // Предпросмотр: стрелка скользит по границе за курсором.
    state.entryGhost = computeEntryAt(world);
    requestDraw();
    return;
  }
  if (state.tool?.kind === 'north' && state.tool.points.length === 1) {
    state.northCursor = { x: world.x, y: world.y };
    requestDraw();
    return;
  }
  if (state.tool?.kind === 'place-opening') {
    const wall = nearestWall(world);
    state.ghostOpening = null;
    if (wall) {
      const width = state.tool.openKind === 'door' ? DOOR_WIDTH : WINDOW_WIDTH;
      const along = wall.orient === 'h' ? world.x : world.y;
      const lo = wall.from + width / 2;
      const hi = wall.to - width / 2;
      if (hi > lo) {
        const center = Math.min(hi, Math.max(lo, along));
        state.ghostOpening = {
          rect: wall.orient === 'h'
            ? { x: center - width / 2, y: wall.band.y, w: width, h: wall.band.h }
            : { x: wall.band.x, y: center - width / 2, w: wall.band.w, h: width },
        };
      }
    }
    requestDraw();
    return;
  }
  if (state.draft) {
    const snap = (v) => Math.round(v / 100) * 100;
    let cursor = { x: snap(world.x), y: snap(world.y) };
    const pts = state.draft.points;
    state.draft.snapStart = false;
    // Возврат к первой точке (от 3 точек) — привязка и замыкание контура.
    if (pts.length >= 3) {
      const first = worldToScreen(pts[0].x, pts[0].y);
      const cur = worldToScreen(cursor.x, cursor.y);
      if (Math.hypot(first.x - cur.x, first.y - cur.y) < 15) {
        cursor = { x: pts[0].x, y: pts[0].y };
        state.draft.snapStart = true;
      }
    }
    state.draft.cursor = cursor;
    state.draft.snapLabel = 'Замкнуть';
    requestDraw();
    return;
  }
  if (state.tool) return;

  // Подсветка под курсором: мебель, проёмы, стены, комнаты, объекты участка.
  let nextHover = null;
  const item = hitItem(world);
  if (item) nextHover = { type: 'item', id: item.id };
  if (!nextHover) {
    const opening = hitOpening(world);
    if (opening) nextHover = { type: 'opening', id: opening.id };
  }
  if (!nextHover) {
    const wall = hitWall(world);
    if (wall) nextHover = { type: 'wall', key: wall.key, from: wall.from };
  }
  if (!nextHover) {
    const room = hitRoom(world);
    if (room) nextHover = { type: 'room', id: room.id };
  }
  if (!nextHover && state.modeName === 'site') {
    const site = hitSiteObject(world);
    if (site) nextHover = { type: 'site-obj', kind: site.kind, id: site.id };
  }
  canvas.style.cursor = nextHover ? 'pointer' : 'crosshair';
  if (JSON.stringify(nextHover) !== JSON.stringify(state.hover)) {
    state.hover = nextHover;
    requestDraw();
  }
}

function applyResize(room, dragState, world) {
  const start = dragState.start;
  const dx = world.x - dragState.world.x;
  const dy = world.y - dragState.world.y;
  const snap = (v) => Math.round(v / GRID_STEP) * GRID_STEP;
  const h = dragState.handle;
  let { x, y, w, h: hh } = start;
  if (h.includes('w')) { const nx = snap(start.x + dx); w = start.x + start.w - nx; x = nx; }
  if (h.includes('e')) { w = snap(start.w + dx); }
  if (h.includes('n')) { const ny = snap(start.y + dy); hh = start.y + start.h - ny; y = ny; }
  if (h.includes('s')) { hh = snap(start.h + dy); }
  if (w < MIN_ROOM_SIZE) { if (h.includes('w')) x -= MIN_ROOM_SIZE - w; w = MIN_ROOM_SIZE; }
  if (hh < MIN_ROOM_SIZE) { if (h.includes('n')) y -= MIN_ROOM_SIZE - hh; hh = MIN_ROOM_SIZE; }
  room.x = x; room.y = y; room.w = w; room.h = hh;
}

function resizeVerdict(room) {
  const verdict = validateRoomPlacement(state.project, room, room.id);
  if (!verdict.ok) return verdict;
  for (const child of state.project.rooms) {
    if (child.parentId !== room.id) continue;
    const childVerdict = validateRoomPlacement(state.project, child, child.id);
    if (!childVerdict.ok) return { ok: false, reason: `«${child.name}» перестаёт помещаться: ${childVerdict.reason}` };
  }
  return { ok: true };
}

// ---------------------------------------------------------------- Клавиатура

window.addEventListener('keydown', (event) => {
  if (event.code === 'Space') {
    const tag = event.target.tagName;
    if (tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'SELECT') {
      spaceDown = true;
      canvas.style.cursor = 'grab';
      event.preventDefault();
    }
    return;
  }
  const tag = event.target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
  if ((event.ctrlKey || event.metaKey) && event.code === 'KeyZ') {
    event.preventDefault();
    if (event.shiftKey) redo(); else undo();
    return;
  }
  if ((event.ctrlKey || event.metaKey) && event.code === 'KeyY') { event.preventDefault(); redo(); return; }
  if (event.key === 'Enter' && state.draft) { finishDraft(); return; }
  if (event.key === 'Escape') { cancelTool(); selectObject(null); return; }
  if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); deleteSelection(); return; }
  if (event.code === 'KeyR') { rotateSelectedItem(); return; }
  const nudge = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
  if (nudge && state.selection) {
    event.preventDefault();
    const step = (event.shiftKey ? 500 : 50);
    const [dx, dy] = [nudge[0] * step, nudge[1] * step];
    if (state.selection.type === 'room') {
      const room = roomById(state.project, state.selection.id);
      if (!room) return;
      const before = snapshot();
      moveRoomBy(state.project, room.id, dx, dy);
      const verdict = validateRoomPlacement(state.project, room, room.id);
      if (!verdict.ok) { restoreFrom(before); toast(verdict.reason); return; }
      reconcileOpenings();
      refreshDerived();
      pushHistory(before);
      afterChange();
    } else if (state.selection.type === 'item') {
      const item = state.project.items.find((i) => i.id === state.selection.id);
      if (!item) return;
      mutate(() => { item.x += dx; item.y += dy; });
    }
  }
});

window.addEventListener('keyup', (event) => {
  if (event.code === 'Space') { spaceDown = false; canvas.style.cursor = 'crosshair'; }
});

// ---------------------------------------------------------------- Левая панель

function renderLibrary() {
  // План: карточки помещений.
  refs.roomCards.innerHTML = '';
  for (const def of ROOM_TYPES) {
    const card = document.createElement('button');
    card.className = 'room-card';
    if (state.tool?.kind === 'place-room' && state.tool.type === def.type) card.classList.add('active');
    card.innerHTML = `
      <span class="room-card-name">${def.title}</span>
      <span class="room-card-size">${(def.w / 1000).toFixed(1)} × ${(def.h / 1000).toFixed(1)} м</span>`;
    card.addEventListener('click', () => {
      if (state.tool?.kind === 'place-room' && state.tool.type === def.type) cancelTool();
      else startPlaceRoom(def.type);
    });
    refs.roomCards.appendChild(card);
  }

  // Участок: инструменты.
  const site = state.project?.site;
  const tools = [
    { id: 'underlay', title: 'Топосъёмка', note: site?.underlay ? 'загружена' : 'PDF / JPG / PNG', action: () => refs.underlayInput.click() },
    { id: 'boundary', title: site?.boundary ? 'Граница участка ↻' : 'Граница участка', note: site?.boundary ? `${polygonAreaM2(site.boundary).toFixed(0)} м²` : 'полигон по точкам', action: () => startDraw('boundary') },
    { id: 'redline', title: site?.redLine ? 'Красная линия ↻' : 'Красная линия', note: 'линия застройки улицы', action: () => startDraw('redline') },
    { id: 'road', title: 'Дорога', note: 'ось + ширина', action: () => startDraw('road') },
    { id: 'entry', title: 'Въезд', note: 'точка на границе', action: () => setTool({ kind: 'entry' }, 'Кликните на границе участка, где въезд · Esc — отмена') },
    { id: 'neighbor', title: 'Соседний дом', note: 'зона 6 м вокруг', action: () => setTool({ kind: 'neighbor' }, 'Кликните, где стоит соседний дом · Esc — отмена') },
    { id: 'north', title: 'Север по 2 точкам', note: `сейчас ${Math.round(site?.north || 0)}°`, action: () => setTool({ kind: 'north', points: [] }, 'Кликните первую точку стрелки на север') },
  ];
  refs.siteTools.innerHTML = '';
  for (const tool of tools) {
    const btn = document.createElement('button');
    btn.className = 'room-card';
    const active = (state.tool?.kind === 'draw' && state.tool.target === tool.id)
      || state.tool?.kind === tool.id || (tool.id === 'north' && state.tool?.kind === 'north');
    if (active) btn.classList.add('active');
    btn.innerHTML = `<span class="room-card-name">${tool.title}</span><span class="room-card-size">${tool.note}</span>`;
    btn.addEventListener('click', () => { if (active) cancelTool(); else tool.action(); });
    refs.siteTools.appendChild(btn);
  }
}

// ---------------------------------------------------------------- Панель свойств

function renderProps() {
  const sel = state.selection;
  const panel = refs.props;
  if (!sel) {
    if (state.modeName === 'site') renderSiteSettings(panel);
    else renderProjectProps(panel);
    return;
  }
  if (sel.type === 'room') { renderRoomProps(panel, roomById(state.project, sel.id)); return; }
  if (sel.type === 'wall') { renderWallProps(panel, findWall(sel.key, sel.from)); return; }
  if (sel.type === 'opening') { renderOpeningProps(panel, state.project.openings.find((o) => o.id === sel.id)); return; }
  if (sel.type === 'item') { renderItemProps(panel, state.project.items.find((i) => i.id === sel.id)); return; }
  if (sel.type === 'multi') { renderMultiProps(panel, sel); return; }
  if (sel.type === 'site') { renderSiteObjectProps(panel, sel); return; }
  renderProjectProps(panel);
}

function renderProjectProps(panel) {
  const rooms = state.project.rooms;
  const list = rooms.map((r) => {
    const area = roomNetAreaM2(state.project, r).toFixed(1);
    const nested = r.parentId ? ' ↳ ' : '';
    return `<li><button class="link" data-room="${r.id}">${nested}${escapeHtml(r.name)}</button><span>${area} м²</span></li>`;
  }).join('');
  panel.innerHTML = `
    <h2>Проект</h2>
    <div class="prop-block">
      <div class="prop-row"><span>Помещений</span><strong>${rooms.length}</strong></div>
      <div class="prop-row"><span>Общая площадь</span><strong>${totalAreaM2(state.project).toFixed(1)} м²</strong></div>
    </div>
    ${rooms.length ? `<h3>Состав</h3><ul class="room-list">${list}</ul>` : `
    <p class="empty-hint">Выберите тип помещения слева и кликните на плане. Комнаты стыкуются автоматически — общая стена становится единой. Перетащите маленькую комнату внутрь большой — она вложится и отнимет площадь.</p>`}
    <h3>Управление</h3>
    <ul class="hotkeys">
      <li><b>ЛКМ</b> — выделение, рамка по пустому месту</li>
      <li><b>ПКМ / средняя / пробел</b> — панорама, <b>колесо</b> — масштаб</li>
      <li><b>Del</b> — удалить, <b>R</b> — повернуть мебель</li>
      <li><b>Ctrl+Z / Ctrl+Shift+Z</b> — отмена / повтор</li>
      <li><b>Стрелки</b> — сдвиг на 50 мм (Shift — 500)</li>
    </ul>`;
  panel.querySelectorAll('[data-room]').forEach((btn) => {
    btn.addEventListener('click', () => selectObject({ type: 'room', id: btn.dataset.room }));
  });
}

function renderRoomProps(panel, room) {
  if (!room) { renderProjectProps(panel); return; }
  const def = roomType(room.type);
  const parent = room.parentId ? roomById(state.project, room.parentId) : null;
  const rejected = state.rejected.get(room.id) || [];
  const insideCount = itemsInRoom(state.project, room).length;

  const furnitureRows = (def?.furniture || []).map((entry) => {
    const fd = furnitureDef(entry.kind);
    return `<div class="add-row">
      <span>${fd.title}</span><em>${fd.w}×${fd.h}</em>
      <button class="add-btn" data-add="${entry.kind}" title="Добавить в центр комнаты">+</button>
    </div>`;
  }).join('');

  const areaControl = parent ? `
    <h3>Площадь</h3>
    <div class="prop-block">
      <label class="check-row"><input type="radio" name="areaFrom" id="areaFromParent" ${room.takesArea !== false ? 'checked' : ''}>
        <span>«${escapeHtml(room.name)}» отнимает у «${escapeHtml(parent.name)}»</span></label>
      <label class="check-row"><input type="radio" name="areaFrom" id="areaFromSelf" ${room.takesArea === false ? 'checked' : ''}>
        <span>«${escapeHtml(parent.name)}» показывается полной</span></label>
    </div>` : '';

  const rejectedHtml = rejected.length
    ? `<div class="rejected"><h4>Не удалось расставить</h4>${rejected.map((r) => `<p>⚠ ${r.reason}</p>`).join('')}</div>`
    : '';

  panel.innerHTML = `
    <h2>${def?.title || 'Комната'}${parent ? `<span class="badge">внутри «${escapeHtml(parent.name)}»</span>` : ''}</h2>
    <div class="prop-block">
      <label class="prop-field"><span>Название</span><input id="roomName" value="${escapeHtml(room.name)}"></label>
      <div class="prop-grid">
        <label class="prop-field"><span>Ширина, мм</span><input id="roomW" type="number" step="50" min="${MIN_ROOM_SIZE}" value="${room.w}"></label>
        <label class="prop-field"><span>Глубина, мм</span><input id="roomH" type="number" step="50" min="${MIN_ROOM_SIZE}" value="${room.h}"></label>
      </div>
      <div class="prop-row"><span>Площадь (чистая)</span><strong>${roomNetAreaM2(state.project, room).toFixed(2)} м²</strong></div>
    </div>
    ${areaControl}
    <h3>Мебель <span class="count-badge">${insideCount} шт.</span></h3>
    <div class="prop-block add-list">${furnitureRows || '<p class="empty-hint">Для этого типа нет набора</p>'}</div>
    ${rejectedHtml}
    <div class="prop-actions">
      <button id="arrangeBtn">Расставить мебель автоматически</button>
      <button id="addDoorBtn">+ Дверь</button>
      <button id="addWindowBtn">+ Окно</button>
      <button id="deleteRoomBtn" class="danger">Удалить комнату</button>
    </div>`;

  panel.querySelector('#roomName').addEventListener('change', (e) => {
    mutate(() => { room.name = e.target.value.trim() || room.name; });
  });
  const applySize = () => {
    const w = Math.max(MIN_ROOM_SIZE, Number(panel.querySelector('#roomW').value) || room.w);
    const h = Math.max(MIN_ROOM_SIZE, Number(panel.querySelector('#roomH').value) || room.h);
    if (w === room.w && h === room.h) return;
    const before = snapshot();
    const old = { w: room.w, h: room.h };
    room.w = w; room.h = h;
    const verdict = resizeVerdict(room);
    if (!verdict.ok) {
      room.w = old.w; room.h = old.h;
      toast(verdict.reason, true);
      renderProps();
      return;
    }
    reconcileOpenings();
    refreshDerived();
    pushHistory(before);
    afterChange();
  };
  panel.querySelector('#roomW').addEventListener('change', applySize);
  panel.querySelector('#roomH').addEventListener('change', applySize);
  panel.querySelectorAll('[data-add]').forEach((btn) => {
    btn.addEventListener('click', () => addFurniture(btn.dataset.add, room));
  });
  panel.querySelector('#arrangeBtn').addEventListener('click', () => {
    mutate(() => {}, { arrange: [room.id] });
    const problems = state.rejected.get(room.id) || [];
    toast(problems.length ? 'Расставлено, но есть замечания — смотрите панель' : 'Мебель расставлена');
    selectObject({ type: 'room', id: room.id });
  });
  panel.querySelector('#addDoorBtn').addEventListener('click', () => startPlaceOpening('door'));
  panel.querySelector('#addWindowBtn').addEventListener('click', () => startPlaceOpening('window'));
  panel.querySelector('#deleteRoomBtn').addEventListener('click', deleteSelection);
  const fromParent = panel.querySelector('#areaFromParent');
  const fromSelf = panel.querySelector('#areaFromSelf');
  if (fromParent && fromSelf) {
    fromParent.addEventListener('change', () => mutate(() => { room.takesArea = true; }));
    fromSelf.addEventListener('change', () => mutate(() => { room.takesArea = false; }));
  }
}

function renderWallProps(panel, wall) {
  if (!wall) { renderProjectProps(panel); return; }
  const roomA = roomById(state.project, wall.rooms[0]);
  const roomB = wall.rooms[1] ? roomById(state.project, wall.rooms[1]) : null;
  const length = Math.round(wall.to - wall.from);
  const subtitle = wall.kind === 'shared'
    ? `Общая стена: «${roomA?.name}» + «${roomB?.name}»`
    : roomA?.parentId ? `Перегородка «${roomA?.name}»` : `Наружная стена «${roomA?.name}»`;
  const maxT = wall.kind === 'shared' ? MAX_SHARED_GAP : 600;
  panel.innerHTML = `
    <h2>Стена</h2>
    <p class="subtitle">${subtitle}</p>
    <div class="prop-block">
      <div class="prop-row"><span>Длина</span><strong>${length} мм</strong></div>
      <label class="prop-field"><span>Толщина, мм (50–${maxT})</span>
        <input id="wallT" type="number" step="10" min="50" max="${maxT}" value="${Math.round(wall.thickness)}"></label>
      <label class="prop-field"><span>Тип</span>
        <select id="wallKind">
          <option value="partition" ${wall.wallType === 'partition' ? 'selected' : ''}>Перегородка</option>
          <option value="bearing" ${wall.wallType === 'bearing' ? 'selected' : ''}>Несущая</option>
          <option value="exterior" ${wall.wallType === 'exterior' ? 'selected' : ''}>Наружная</option>
        </select></label>
    </div>
    <div class="prop-actions">
      <button id="wallDoorBtn">+ Дверь в этой стене</button>
      <button id="wallWindowBtn" ${wall.kind === 'shared' || roomA?.parentId ? 'disabled title="Окна — только на наружных стенах"' : ''}>+ Окно в этой стене</button>
    </div>
    <p class="empty-hint">Общая стена двух комнат — единый объект: толщина меняется сразу для обеих, соседняя комната сдвигается.</p>`;

  panel.querySelector('#wallT').addEventListener('change', (e) => {
    const newT = Math.min(maxT, Math.max(50, Number(e.target.value) || wall.thickness));
    changeWallThickness(wall, newT);
  });
  panel.querySelector('#wallKind').addEventListener('change', (e) => {
    mutate(() => {
      state.project.wallOverrides[wall.key] = { ...(state.project.wallOverrides[wall.key] || {}), kind: e.target.value };
    });
    selectObject({ type: 'wall', key: wall.key, from: wall.from });
  });
  panel.querySelector('#wallDoorBtn').addEventListener('click', () => startPlaceOpening('door', { key: wall.key, from: wall.from }));
  const windowBtn = panel.querySelector('#wallWindowBtn');
  if (!windowBtn.disabled) windowBtn.addEventListener('click', () => startPlaceOpening('window', { key: wall.key, from: wall.from }));
}

function changeWallThickness(wall, newT) {
  const before = snapshot();
  if (wall.kind === 'shared') {
    const delta = newT - wall.thickness;
    const mover = roomById(state.project, wall.rooms[1]);
    moveRoomBy(state.project, mover.id, wall.orient === 'v' ? delta : 0, wall.orient === 'h' ? delta : 0);
    const verdict = validateRoomPlacement(state.project, mover, mover.id);
    if (!verdict.ok) {
      restoreFrom(before);
      toast(`Нельзя: ${verdict.reason}`, true);
      return;
    }
  } else {
    state.project.wallOverrides[wall.key] = { ...(state.project.wallOverrides[wall.key] || {}), thickness: newT };
  }
  reconcileOpenings();
  refreshDerived();
  pushHistory(before);
  afterChange();
  selectObject({ type: 'wall', key: wall.key, from: wall.from });
}

function renderOpeningProps(panel, opening) {
  if (!opening) { renderProjectProps(panel); return; }
  const room = roomById(state.project, opening.roomId);
  const isDoor = opening.kind === 'door';
  panel.innerHTML = `
    <h2>${isDoor ? 'Дверь' : 'Окно'}</h2>
    <p class="subtitle">Стена «${room?.name}» · тяните за точки на торцах — ширина меняется с шагом 50 мм</p>
    <div class="prop-block">
      <label class="prop-field"><span>Ширина, мм</span>
        <input id="openW" type="number" step="50" min="400" max="3000" value="${opening.width}"></label>
      <label class="prop-field"><span>Положение от начала стены, мм</span>
        <input id="openOff" type="number" step="50" value="${Math.round(opening.offset)}"></label>
    </div>
    ${isDoor ? `
    <div class="prop-actions">
      <button id="flipSwing">Открывание: ${opening.swingIn ? 'внутрь' : 'наружу'}</button>
      <button id="flipHinge">Петли: ${opening.hingeStart ? 'слева' : 'справа'}</button>
    </div>` : ''}
    <div class="prop-actions">
      <button id="deleteOpening" class="danger">Удалить ${isDoor ? 'дверь' : 'окно'}</button>
    </div>`;

  const commitOpening = (fn) => {
    mutate(fn);
    selectObject({ type: 'opening', id: opening.id });
  };
  panel.querySelector('#openW').addEventListener('change', (e) => {
    const width = Math.min(3000, Math.max(400, Number(e.target.value) || opening.width));
    commitOpening(() => {
      opening.width = width;
      const clamped = clampOpeningOffset(state.project, opening, deriveWalls(state.project), opening.offset);
      if (clamped !== null) opening.offset = clamped;
    });
  });
  panel.querySelector('#openOff').addEventListener('change', (e) => {
    commitOpening(() => {
      const clamped = clampOpeningOffset(state.project, opening, deriveWalls(state.project), Number(e.target.value) || opening.offset);
      if (clamped !== null) opening.offset = clamped;
      else toast('Сюда проём не помещается');
    });
  });
  if (isDoor) {
    panel.querySelector('#flipSwing').addEventListener('click', () => commitOpening(() => { opening.swingIn = !opening.swingIn; }));
    panel.querySelector('#flipHinge').addEventListener('click', () => commitOpening(() => { opening.hingeStart = !opening.hingeStart; }));
  }
  panel.querySelector('#deleteOpening').addEventListener('click', deleteSelection);
}

function renderItemProps(panel, item) {
  if (!item) { renderProjectProps(panel); return; }
  panel.innerHTML = `
    <h2>${itemTitle(item.kind)}</h2>
    <p class="subtitle">Свободный объект: перетаскивается куда угодно, едет вместе с комнатой, в которой стоит</p>
    <div class="prop-block">
      <div class="prop-grid">
        <label class="prop-field"><span>Ширина, мм</span><input id="itemW" type="number" step="50" min="200" value="${item.w}"></label>
        <label class="prop-field"><span>Глубина, мм</span><input id="itemH" type="number" step="50" min="200" value="${item.h}"></label>
      </div>
      <div class="prop-row"><span>Поворот</span><strong>${item.rotation || 0}°</strong></div>
    </div>
    <div class="prop-actions">
      <button id="rotateItem">Повернуть на 90° (R)</button>
      <button id="deleteItem" class="danger">Удалить</button>
    </div>`;
  const applySize = () => {
    const w = Math.max(200, Number(panel.querySelector('#itemW').value) || item.w);
    const h = Math.max(200, Number(panel.querySelector('#itemH').value) || item.h);
    mutate(() => { item.w = w; item.h = h; });
  };
  panel.querySelector('#itemW').addEventListener('change', applySize);
  panel.querySelector('#itemH').addEventListener('change', applySize);
  panel.querySelector('#rotateItem').addEventListener('click', rotateSelectedItem);
  panel.querySelector('#deleteItem').addEventListener('click', deleteSelection);
}

function renderMultiProps(panel, sel) {
  panel.innerHTML = `
    <h2>Выделено рамкой</h2>
    <div class="prop-block">
      <div class="prop-row"><span>Комнат</span><strong>${sel.roomIds.length}</strong></div>
      <div class="prop-row"><span>Мебели</span><strong>${sel.itemIds.length}</strong></div>
    </div>
    <p class="empty-hint">Перетащите любой выделенный объект — группа поедет вместе. Del — удалить всё выделенное.</p>
    <div class="prop-actions">
      <button id="deleteMulti" class="danger">Удалить выделенное</button>
    </div>`;
  panel.querySelector('#deleteMulti').addEventListener('click', deleteSelection);
}

// --- Свойства участка ---

function renderSiteSettings(panel) {
  const site = state.project.site;
  const sun = sunPosition(site.location.lat, site.location.lon, site.location.tz, site.sun.date, site.sun.time);
  const zone = site.boundary ? buildZonePolygon(site) : null;
  const hours = Math.floor(site.sun.time / 60);
  const mins = site.sun.time % 60;
  panel.innerHTML = `
    <h2>Участок</h2>
    <div class="prop-block">
      <div class="prop-row"><span>Площадь участка</span><strong>${site.boundary ? `${polygonAreaM2(site.boundary).toFixed(1)} м²` : '—'}</strong></div>
      <div class="prop-row"><span>Зона застройки</span><strong>${zone ? `${polygonAreaM2(zone).toFixed(1)} м²` : '—'}</strong></div>
      <label class="prop-field"><span>Север, ° по часовой (0 = вверх плана)</span>
        <input id="northDeg" type="number" step="1" value="${Math.round(site.north)}"></label>
    </div>
    <h3>Отступы застройки</h3>
    <div class="prop-block">
      <label class="prop-field"><span>От границы участка, м</span>
        <input id="setbackB" type="number" step="0.1" min="0" value="${(site.setbackBoundary / 1000).toFixed(1)}"></label>
      <label class="prop-field"><span>От соседнего дома, м</span>
        <input id="setbackN" type="number" step="0.5" min="0" value="${(site.setbackNeighbor / 1000).toFixed(1)}"></label>
      <label class="check-row"><input type="checkbox" id="showZone" ${site.showBuildZone ? 'checked' : ''}><span>Показывать зону застройки</span></label>
    </div>
    <h3>Инсоляция</h3>
    <div class="prop-block">
      <label class="check-row"><input type="checkbox" id="sunEnabled" ${site.sun.enabled ? 'checked' : ''}><span>Показывать солнце и тени</span></label>
      <div class="prop-grid">
        <label class="prop-field"><span>Широта</span><input id="lat" type="number" step="0.001" value="${site.location.lat}"></label>
        <label class="prop-field"><span>Долгота</span><input id="lon" type="number" step="0.001" value="${site.location.lon}"></label>
      </div>
      <div class="prop-grid">
        <label class="prop-field"><span>Пояс UTC+</span><input id="tz" type="number" step="1" value="${site.location.tz}"></label>
        <label class="prop-field"><span>Высота дома, м</span><input id="bh" type="number" step="0.5" min="2" value="${(site.buildingHeight / 1000).toFixed(1)}"></label>
      </div>
      <label class="prop-field"><span>Дата</span><input id="sunDate" type="date" value="${site.sun.date}"></label>
      <label class="prop-field"><span>Время: <b id="sunTimeLabel">${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}</b></span>
        <input id="sunTime" type="range" min="0" max="1440" step="15" value="${site.sun.time}"></label>
      <div class="prop-row"><span>Солнце</span><strong id="sunInfo">${formatSunInfo(sun)}</strong></div>
    </div>
    <p class="empty-hint">Границу, красную линию, въезд и дорогу добавляйте инструментами слева. В этом режиме север всегда вверх; вернитесь в «План» — камера станет прежней.</p>`;

  panel.querySelector('#northDeg').addEventListener('change', (e) => {
    mutate(() => { site.north = ((Number(e.target.value) || 0) % 360 + 360) % 360; });
    applyModeRotation();
    requestDraw();
  });
  panel.querySelector('#setbackB').addEventListener('change', (e) => {
    mutate(() => { site.setbackBoundary = Math.max(0, Number(e.target.value) || 0) * 1000; });
  });
  panel.querySelector('#setbackN').addEventListener('change', (e) => {
    mutate(() => { site.setbackNeighbor = Math.max(0, Number(e.target.value) || 0) * 1000; });
  });
  panel.querySelector('#showZone').addEventListener('change', (e) => {
    mutate(() => { site.showBuildZone = e.target.checked; });
  });
  panel.querySelector('#sunEnabled').addEventListener('change', (e) => {
    tweak(() => { site.sun.enabled = e.target.checked; });
  });
  const updateSun = () => {
    const s = sunPosition(site.location.lat, site.location.lon, site.location.tz, site.sun.date, site.sun.time);
    const info = panel.querySelector('#sunInfo');
    if (info) info.textContent = formatSunInfo(s);
  };
  for (const [id, apply] of [
    ['lat', (v) => { site.location.lat = Number(v) || 0; }],
    ['lon', (v) => { site.location.lon = Number(v) || 0; }],
    ['tz', (v) => { site.location.tz = Number(v) || 0; }],
    ['bh', (v) => { site.buildingHeight = Math.max(2000, (Number(v) || 6) * 1000); }],
    ['sunDate', (v) => { if (/^\d{4}-\d{2}-\d{2}$/.test(v)) site.sun.date = v; }],
  ]) {
    panel.querySelector(`#${id}`).addEventListener('change', (e) => {
      tweak(() => apply(e.target.value));
      updateSun();
    });
  }
  panel.querySelector('#sunTime').addEventListener('input', (e) => {
    tweak(() => { site.sun.time = Number(e.target.value); });
    const h = Math.floor(site.sun.time / 60);
    const m = site.sun.time % 60;
    panel.querySelector('#sunTimeLabel').textContent = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    updateSun();
  });
}

function renderSiteObjectProps(panel, sel) {
  const site = state.project.site;
  if (sel.kind === 'boundary' && site.boundary) {
    panel.innerHTML = `
      <h2>Граница участка</h2>
      <div class="prop-block">
        <div class="prop-row"><span>Площадь</span><strong>${polygonAreaM2(site.boundary).toFixed(1)} м²</strong></div>
        <div class="prop-row"><span>Вершин</span><strong>${site.boundary.length}</strong></div>
      </div>
      <p class="empty-hint">Тяните белые точки-вершины, чтобы поправить контур. Красная штриховка — запретная полоса отступа.</p>
      <div class="prop-actions">
        <button id="redraw">Перечертить заново</button>
        <button id="del" class="danger">Удалить границу</button>
      </div>`;
    panel.querySelector('#redraw').addEventListener('click', () => startDraw('boundary'));
    panel.querySelector('#del').addEventListener('click', deleteSelection);
    return;
  }
  if (sel.kind === 'redline' && site.redLine) {
    panel.innerHTML = `
      <h2>Красная линия</h2>
      <p class="empty-hint">Линия регулирования застройки со стороны улицы. Тяните вершины, чтобы поправить.</p>
      <div class="prop-actions">
        <button id="redraw">Перечертить</button>
        <button id="del" class="danger">Удалить</button>
      </div>`;
    panel.querySelector('#redraw').addEventListener('click', () => startDraw('redline'));
    panel.querySelector('#del').addEventListener('click', deleteSelection);
    return;
  }
  if (sel.kind === 'road') {
    const road = site.roads.find((r) => r.id === sel.id);
    if (!road) { renderSiteSettings(panel); return; }
    panel.innerHTML = `
      <h2>Дорога</h2>
      <div class="prop-block">
        <label class="prop-field"><span>Ширина, м</span>
          <input id="roadW" type="number" step="0.5" min="1" value="${(road.width / 1000).toFixed(1)}"></label>
      </div>
      <div class="prop-actions"><button id="del" class="danger">Удалить дорогу</button></div>`;
    panel.querySelector('#roadW').addEventListener('change', (e) => {
      mutate(() => { road.width = Math.max(1000, (Number(e.target.value) || 3.5) * 1000); });
      selectObject(sel);
    });
    panel.querySelector('#del').addEventListener('click', deleteSelection);
    return;
  }
  if (sel.kind === 'neighbor') {
    const n = site.neighbors.find((x) => x.id === sel.id);
    if (!n) { renderSiteSettings(panel); return; }
    panel.innerHTML = `
      <h2>Соседний дом</h2>
      <div class="prop-block">
        <div class="prop-grid">
          <label class="prop-field"><span>Ширина, м</span><input id="nw" type="number" step="0.5" min="2" value="${(n.w / 1000).toFixed(1)}"></label>
          <label class="prop-field"><span>Глубина, м</span><input id="nh" type="number" step="0.5" min="2" value="${(n.h / 1000).toFixed(1)}"></label>
        </div>
        <label class="prop-field"><span>Высота (для теней), м</span><input id="nht" type="number" step="0.5" min="2" value="${((n.height || 6000) / 1000).toFixed(1)}"></label>
      </div>
      <label class="prop-field"><span>Поворот, °</span><input id="nrot" type="number" step="5" value="${Math.round(n.rot || 0)}"></label>
      <p class="empty-hint">Тяните квадраты по углам — масштаб, круглые ручки снаружи углов — поворот (Shift — шаг 15°). Вокруг дома держится отступ ${(site.setbackNeighbor / 1000).toLocaleString('ru-RU')} м (красная штриховка).</p>
      <div class="prop-actions"><button id="del" class="danger">Удалить</button></div>`;
    const apply = () => {
      mutate(() => {
        n.w = Math.max(2000, (Number(panel.querySelector('#nw').value) || 8) * 1000);
        n.h = Math.max(2000, (Number(panel.querySelector('#nh').value) || 8) * 1000);
        n.height = Math.max(2000, (Number(panel.querySelector('#nht').value) || 6) * 1000);
        n.rot = ((Number(panel.querySelector('#nrot').value) || 0) % 360 + 360) % 360;
      });
      selectObject(sel);
    };
    panel.querySelector('#nw').addEventListener('change', apply);
    panel.querySelector('#nh').addEventListener('change', apply);
    panel.querySelector('#nht').addEventListener('change', apply);
    panel.querySelector('#nrot').addEventListener('change', apply);
    panel.querySelector('#del').addEventListener('click', deleteSelection);
    return;
  }
  if (sel.kind === 'entry' && site.entry) {
    panel.innerHTML = `
      <h2>Въезд</h2>
      <p class="empty-hint">Перетащите стрелку вдоль границы, чтобы передвинуть въезд.</p>
      <div class="prop-actions"><button id="del" class="danger">Удалить въезд</button></div>`;
    panel.querySelector('#del').addEventListener('click', deleteSelection);
    return;
  }
  if (sel.kind === 'underlay' && site.underlay) {
    const u = site.underlay;
    const cal = state.calibration;
    const widthM = (u.widthPx * u.mmPerPx) / 1000;
    const heightM = (u.heightPx * u.mmPerPx) / 1000;
    panel.innerHTML = `
      <h2>Топосъёмка</h2>
      <p class="subtitle">Размер картинки: ${widthM.toFixed(1)} × ${heightM.toFixed(1)} м</p>
      <h3>Масштаб — 3 способа</h3>
      <div class="prop-block">
        <label class="prop-field"><span>1. Ширина топосъёмки, м (если знаете)</span>
          <input id="uWidth" type="number" step="0.5" min="1" value="${widthM.toFixed(1)}"></label>
        <div class="scale-row">
          <span>2. Подогнать кнопками</span>
          <div class="scale-btns">
            <button id="scaleDown" title="Меньше">−</button>
            <button id="scaleUp" title="Больше">+</button>
          </div>
        </div>
        <p class="empty-hint">3. Или тяните угловые белые квадраты прямо на картинке.</p>
      </div>
      ${cal ? `
      <div class="prop-block cal-active">
        <strong>Отрезок отмечен.</strong>
        <label class="prop-field"><span>Его реальная длина, м</span>
          <input id="calDist" type="number" step="0.1" min="0.1" placeholder="например 20" autofocus></label>
        <button id="calApply" class="primary-inline">Применить</button>
      </div>` : `
      <div class="prop-actions">
        <button id="calibrate">4. Точно: масштаб по отрезку</button>
      </div>`}
      <h3>Вид</h3>
      <div class="prop-block">
        <label class="prop-field"><span>Прозрачность</span>
          <input id="uOpacity" type="range" min="0.1" max="1" step="0.05" value="${u.opacity}"></label>
        <label class="check-row"><input type="checkbox" id="uLocked" ${u.locked ? 'checked' : ''}><span>Закрепить (не двигать и не масштабировать мышью)</span></label>
      </div>
      <div class="prop-actions">
        <button id="del" class="danger">Удалить подложку</button>
      </div>
      <p class="empty-hint">Совет: начертите границу участка по топосъёмке, затем подгоните масштаб так, чтобы известная сторона совпала с реальной длиной.</p>`;

    const rescale = (factor) => {
      mutate(() => {
        const cx = u.x + (u.widthPx * u.mmPerPx) / 2;
        const cy = u.y + (u.heightPx * u.mmPerPx) / 2;
        u.mmPerPx = Math.max(0.5, u.mmPerPx * factor);
        u.x = cx - (u.widthPx * u.mmPerPx) / 2;
        u.y = cy - (u.heightPx * u.mmPerPx) / 2;
      });
      selectObject(sel);
    };
    panel.querySelector('#uWidth').addEventListener('change', (e) => {
      const targetM = Number(e.target.value);
      if (!(targetM > 0)) return;
      const factor = (targetM * 1000) / (u.widthPx * u.mmPerPx);
      rescale(factor);
    });
    panel.querySelector('#scaleUp').addEventListener('click', () => rescale(1.1));
    panel.querySelector('#scaleDown').addEventListener('click', () => rescale(1 / 1.1));
    panel.querySelector('#uOpacity').addEventListener('input', (e) => {
      tweak(() => { u.opacity = Number(e.target.value); });
    });
    panel.querySelector('#uLocked').addEventListener('change', (e) => {
      mutate(() => { u.locked = e.target.checked; });
      selectObject(sel);
    });
    const calibrateBtn = panel.querySelector('#calibrate');
    if (calibrateBtn) {
      calibrateBtn.addEventListener('click', () => {
        setTool({ kind: 'calibrate', points: [] }, 'Кликните две точки на топосъёмке с известным расстоянием (например, сторону участка)');
      });
    }
    panel.querySelector('#del').addEventListener('click', deleteSelection);
    if (cal) {
      panel.querySelector('#calApply').addEventListener('click', () => {
        applyCalibration(Number(panel.querySelector('#calDist').value));
      });
    }
    return;
  }
  renderSiteSettings(panel);
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// ---------------------------------------------------------------- Связность

function updateConnectivity() {
  const bar = refs.connectivity;
  if (!state.project.rooms.length) { bar.hidden = true; return; }
  const analysis = analyzeConnectivity(state.project, state.walls);
  const problems = [];
  if (!analysis.hasEntrance) problems.push('Нет входной двери — добавьте дверь на наружной стене');
  for (const roomId of analysis.unreachable) {
    const hint = suggestAccess(state.project, roomId, analysis);
    if (hint) problems.push(hint.text);
  }
  if (!problems.length) {
    bar.hidden = false;
    bar.className = 'status-strip ok';
    bar.textContent = '✓ Все помещения доступны от входа';
  } else {
    bar.hidden = false;
    bar.className = 'status-strip warn';
    bar.textContent = `⚠ ${problems.join(' · ')}`;
  }
}

// ---------------------------------------------------------------- Вид

function fitView() {
  const site = state.project.site;
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  const extend = (x, y) => {
    minX = Math.min(minX, x); minY = Math.min(minY, y);
    maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
  };
  for (const room of state.project.rooms) {
    extend(room.x - 400, room.y - 400);
    extend(room.x + room.w + 400, room.y + room.h + 400);
  }
  if (state.modeName === 'site' && site) {
    for (const p of site.boundary || []) extend(p.x, p.y);
    for (const road of site.roads || []) for (const p of road.points) extend(p.x, p.y);
    for (const n of site.neighbors || []) { extend(n.x - n.w / 2, n.y - n.h / 2); extend(n.x + n.w / 2, n.y + n.h / 2); }
    const u = site.underlay;
    if (u) { extend(u.x, u.y); extend(u.x + u.widthPx * u.mmPerPx, u.y + u.heightPx * u.mmPerPx); }
  }
  if (minX === Infinity) {
    state.view.scale = state.modeName === 'site' ? 0.02 : 0.08;
    state.view.panX = canvas.clientWidth / 2;
    state.view.panY = canvas.clientHeight / 2;
    requestDraw();
    return;
  }
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  // Учитываем поворот: вписываем диагональ.
  const span = Math.max(maxX - minX, maxY - minY) * (state.view.rotation ? 1.2 : 1);
  const scale = Math.min(0.6, Math.max(0.004, Math.min(width / (state.view.rotation ? span : maxX - minX), height / (state.view.rotation ? span : maxY - minY)) * 0.9));
  state.view.scale = scale;
  const projected = projectPoint({ ...state.view, panX: 0, panY: 0 }, cx, cy);
  state.view.panX = width / 2 - projected.x;
  state.view.panY = height / 2 - projected.y;
  refs.statusScale.textContent = scaleLabel();
  requestDraw();
}

// ---------------------------------------------------------------- Файлы

function download(filename, text, mime) {
  try {
    const blob = new Blob([text], { type: mime });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  } catch {
    toast('Скачивание недоступно в этом окружении — используйте «Копировать»', true);
  }
}

function safeFileName() {
  return (state.project.name || 'kepler-plan').replace(/[^\wа-яА-ЯёЁ -]/g, '').trim().replace(/\s+/g, '-') || 'kepler-plan';
}

function handleExport(kind) {
  refs.exportDropdown.hidden = true;
  if (kind === 'project') {
    download(`${safeFileName()}.kepler.json`, serializeProject(state.project), 'application/json');
    toast('Файл проекта сохраняется (.kepler.json)');
  } else if (kind === 'json') {
    download(`${safeFileName()}.export.json`, JSON.stringify(buildStructuredExport(state.project), null, 2), 'application/json');
    toast('Структурированный JSON для Revit-плагина');
  } else if (kind === 'dxf') {
    download(`${safeFileName()}.dxf`, buildProjectDxf(state.project), 'application/dxf');
    toast('DXF сохраняется');
  } else if (kind === 'dxf-revit') {
    download(`${safeFileName()}-revit.dxf`, buildProjectDxf(state.project, { profile: 'revit' }), 'application/dxf');
    toast('DXF с Revit-слоями (ZAMER_*) сохраняется');
  } else if (kind === 'copy') {
    const text = serializeProject(state.project);
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text)
        .then(() => toast('Проект скопирован в буфер обмена'))
        .catch(() => toast('Не удалось скопировать — сохраните файлом', true));
    } else {
      toast('Буфер обмена недоступен', true);
    }
  }
}

function openProjectFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const before = snapshot();
      restoreFrom(String(reader.result));
      pushHistory(before);
      fitView();
      refs.projectName.value = state.project.name;
      toast(`Открыт проект «${state.project.name}»`);
    } catch (error) {
      toast(`Не удалось открыть: ${error.message}`, true);
    }
  };
  reader.readAsText(file);
}

// ---------------------------------------------------------------- Пример

function buildSample() {
  const project = createProject('Дом · 1 этаж');
  const site = ensureSite(project);
  const bedroom = createRoom('bedroom', 0, 0, 5000, 4000);
  bedroom.name = 'Спальня';
  const bath = createRoom('bathroom', 2900, 1900, 2000, 2000);
  bath.parentId = bedroom.id;
  bath.name = 'Санузел';
  const living = createRoom('living', 5100, 0, 5000, 4200);
  const kitchen = createRoom('kitchen', 5100, 4300, 3600, 3000);
  const hall = createRoom('hall', 0, 4100, 3000, 2400);
  project.rooms.push(bedroom, bath, living, kitchen, hall);

  project.openings.push(createOpening('door', hall.id, 2, 1500, 900));
  project.openings.push(createOpening('door', bedroom.id, 2, 1200, 800));
  project.openings.push(createOpening('door', bedroom.id, 1, 700, 800));
  project.openings.push(createOpening('door', bath.id, 0, 1000, 700));
  project.openings.push(createOpening('door', living.id, 2, 1800, 900));
  project.openings.push(createOpening('window', bedroom.id, 0, 2500, 1500));
  project.openings.push(createOpening('window', living.id, 0, 2500, 1800));
  project.openings.push(createOpening('window', kitchen.id, 1, 1500, 1200));

  // Участок вокруг дома: граница, въезд, дорога, север и сосед.
  site.boundary = [
    { x: -5000, y: -6000 }, { x: 16000, y: -6000 },
    { x: 16000, y: 12000 }, { x: -5000, y: 12000 },
  ];
  site.entry = { x: 5000, y: 12000, dir: -90 };
  site.roads.push({ id: 'road-sample', points: [{ x: 5000, y: 12000 }, { x: 5000, y: 16000 }], width: 3500 });
  site.neighbors.push({ id: 'nbr-sample', x: 24000, y: 2000, w: 8000, h: 9000, height: 6500 });
  site.north = 20;
  site.sun.enabled = true;

  const rejected = new Map();
  const walls = deriveWalls(project);
  for (const room of project.rooms) {
    for (const item of defaultItemsFor(room)) project.items.push(item);
  }
  for (const room of project.rooms) {
    rejected.set(room.id, arrangeRoom(project, room, walls));
  }
  return { project, rejected };
}

function loadSample() {
  const before = state.project ? snapshot() : null;
  const { project, rejected } = buildSample();
  state.project = project;
  state.rejected = rejected;
  state.selection = null;
  refreshDerived();
  applyModeRotation();
  if (before) pushHistory(before);
  refs.projectName.value = project.name;
  afterChange();
  fitView();
}

function newProject() {
  const before = state.project ? snapshot() : null;
  state.project = createProject();
  ensureSite(state.project); // чистый участок: без топосъёмки, границы, соседей
  state.selection = null;
  state.tool = null;
  state.rejected.clear();
  state.underlayImg = null; // убрать картинку топосъёмки из прошлого проекта
  state.modeName = 'plan';
  state.views = {
    plan: { scale: 0.08, panX: 120, panY: 120 },
    site: { scale: 0.03, panX: 120, panY: 120 },
  };
  refs.modePlan.classList.add('active');
  refs.modeSite.classList.remove('active');
  refs.roomCards.hidden = false;
  refs.siteTools.hidden = true;
  refs.libraryTitle.textContent = 'Помещения';
  refreshDerived();
  applyModeRotation();
  if (before) pushHistory(before);
  refs.projectName.value = state.project.name;
  afterChange();
  fitView();
}

// ---------------------------------------------------------------- Стартовое меню

function projectHasContent() {
  const p = state.project;
  if (!p) return false;
  return p.rooms.length > 0 || p.items.length > 0 || Boolean(p.site?.boundary) || Boolean(p.site?.underlay);
}

function openStartMenu({ initial = false } = {}) {
  const screen = el('startScreen');
  const warn = el('startWarn');
  const closeBtn = el('startClose');
  const continueBtn = el('startContinue');
  warn.hidden = true;
  warn.innerHTML = '';
  const hasContent = projectHasContent();
  closeBtn.hidden = initial && !hasContent;
  continueBtn.hidden = initial && !hasContent;
  screen.hidden = false;
}

function closeStartMenu() {
  el('startScreen').hidden = true;
}

function requestNewProject() {
  const warn = el('startWarn');
  if (projectHasContent()) {
    // Спрашиваем подтверждение, прежде чем стереть текущий проект.
    warn.hidden = false;
    warn.innerHTML = `
      <span>⚠ Текущий проект «${escapeHtml(state.project.name)}» будет закрыт. Сохранить его в файл перед этим?</span>
      <div class="warn-actions">
        <button id="warnSave" class="primary-inline">Сохранить и создать</button>
        <button id="warnDiscard" class="danger">Создать без сохранения</button>
        <button id="warnCancel">Отмена</button>
      </div>`;
    warn.querySelector('#warnSave').addEventListener('click', () => {
      handleExport('project');
      newProject();
      closeStartMenu();
      toast('Новый проект создан, старый сохранён в файл');
    });
    warn.querySelector('#warnDiscard').addEventListener('click', () => {
      newProject();
      closeStartMenu();
      toast('Новый проект. Прежний можно вернуть через Ctrl+Z');
    });
    warn.querySelector('#warnCancel').addEventListener('click', () => { warn.hidden = true; });
    return;
  }
  newProject();
  closeStartMenu();
}

// ---------------------------------------------------------------- Шапка

refs.modePlan.addEventListener('click', () => setEditorMode('plan'));
refs.modeSite.addEventListener('click', () => setEditorMode('site'));
el('undoBtn').addEventListener('click', undo);
el('redoBtn').addEventListener('click', redo);
el('fitBtn').addEventListener('click', fitView);
el('zoomInBtn').addEventListener('click', () => zoomAt({ x: canvas.clientWidth / 2, y: canvas.clientHeight / 2 }, 1.25));
el('zoomOutBtn').addEventListener('click', () => zoomAt({ x: canvas.clientWidth / 2, y: canvas.clientHeight / 2 }, 0.8));
el('calInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); applyCalibration(Number(el('calInput').value)); }
  else if (e.key === 'Escape') { e.preventDefault(); hideCalInput(); toast('Калибровка отменена'); }
});
el('themeBtn').addEventListener('click', cycleTheme);
el('menuBtn').addEventListener('click', () => openStartMenu());
el('startClose').addEventListener('click', closeStartMenu);
el('startContinue').addEventListener('click', closeStartMenu);
el('startNew').addEventListener('click', requestNewProject);
el('startSample').addEventListener('click', () => { loadSample(); closeStartMenu(); });
el('startOpen').addEventListener('click', () => refs.fileInput.click());
refs.fileInput.addEventListener('change', () => {
  if (refs.fileInput.files?.[0]) { openProjectFile(refs.fileInput.files[0]); closeStartMenu(); }
  refs.fileInput.value = '';
});
refs.underlayInput.addEventListener('change', () => {
  if (refs.underlayInput.files?.[0]) loadUnderlayFile(refs.underlayInput.files[0]);
  refs.underlayInput.value = '';
});
el('saveBtn').addEventListener('click', () => handleExport('project'));
el('exportBtn').addEventListener('click', (event) => {
  event.stopPropagation();
  refs.exportDropdown.hidden = !refs.exportDropdown.hidden;
});
document.addEventListener('click', (event) => {
  if (!refs.exportDropdown.hidden && !refs.exportDropdown.contains(event.target)) {
    refs.exportDropdown.hidden = true;
  }
});
refs.exportDropdown.querySelectorAll('[data-export]').forEach((btn) => {
  btn.addEventListener('click', () => handleExport(btn.dataset.export));
});
refs.projectName.addEventListener('change', () => {
  mutate(() => { state.project.name = refs.projectName.value.trim() || state.project.name; });
});

new ResizeObserver(() => requestDraw()).observe(canvas);
window.matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => {
  let mode = 'system';
  try { mode = localStorage.getItem(THEME_KEY) || 'system'; } catch { /* нет */ }
  if (mode === 'system') applyTheme('system');
  requestDraw();
});

// ---------------------------------------------------------------- Старт

(function boot() {
  loadTheme();
  let restored = null;
  try {
    const saved = localStorage.getItem(AUTOSAVE_KEY);
    if (saved) restored = deserializeProject(saved);
  } catch { /* нет сохранения */ }
  let showStart = false;
  if (restored && (restored.rooms.length || restored.site?.boundary)) {
    // Есть сохранённый проект — продолжаем его.
    state.project = restored;
    ensureSite(state.project);
  } else {
    // Пустой старт: чистый проект и стартовое меню поверх.
    state.project = createProject();
    ensureSite(state.project);
    showStart = true;
  }
  refreshDerived();
  applyModeRotation();
  syncUnderlayImage();
  refs.projectName.value = state.project.name;
  updateConnectivity();
  renderLibrary();
  renderProps();
  refs.statusScale.textContent = scaleLabel();
  requestAnimationFrame(fitView);
  requestDraw();
  if (showStart) openStartMenu({ initial: true });
})();

// Отладочный доступ для автотестов.
window.__kepler = {
  state,
  worldToScreen,
  screenToWorld,
  fitView,
  loadSample,
  setEditorMode,
  selectRoom: (id) => selectObject({ type: 'room', id }),
};
