// Kepler Plan — редактор архитектурных концепций частных домов.
// Два режима: «План» (дом) и «Участок» (граница, зона застройки, топосъёмка,
// север, инсоляция). Мебель — свободные объекты. Выделение — левой кнопкой,
// рамка по пустому месту; панорама — правой/средней кнопкой или с пробелом.

import {
  createProject, createRoom, createOpening, createItem,
  serializeProject, deserializeProject, roomById, removeRoom,
} from './core/model.js';
import {
  ROOM_TYPES, roomType, furnitureDef, furnitureByCategory, FURNITURE_CATEGORIES,
  DOOR_WIDTH, WINDOW_WIDTH, GRID_STEP,
} from './core/catalog.js';
import {
  deriveWalls, openingRect, clampOpeningOffset, sideEdge, MAX_SHARED_GAP,
} from './core/walls.js';
import {
  validateRoomPlacement, snapRoomPosition, determineParent, moveRoomBy,
  roomNetAreaM2, totalAreaM2, analyzeConnectivity, suggestAccess, rectsOverlap, MIN_ROOM_SIZE,
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
import { parseDxf, dxfToImage, dxfTypeSummary } from './core/dxf.js';
import {
  createRenderer, roomHandles, openingHandles, underlayHandles, underlayRotators,
  underlayCenter, HANDLE_SIZE, drawGlyphPreview,
  neighborCorners, neighborRotators, itemCorners, itemRotators, rotateVec,
  projectPoint, unprojectPoint,
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
  libraryTab: 'rooms', // 'rooms' | 'furniture' — вкладка левой панели (в режиме «План»)
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
  furnitureBar: el('furnitureBar'),
  furnitureCats: el('furnitureCats'),
  furnitureItems: el('furnitureItems'),
  libraryTop: el('libraryTop'),
  libraryTabs: el('libraryTabs'),
  libTabRooms: el('libTabRooms'),
  libTabFurniture: el('libTabFurniture'),
};

let furnitureCat = FURNITURE_CATEGORIES[0].id;

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
  updateDimModeBtn();
  el('alignBtn')?.classList.toggle('active', Boolean(state.project?.planSiteRot));
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

// Вкладки левой панели: в режиме «План» переключают «Помещения» / «Мебель»
// (как вкладки обозревателя в Revit). В режиме «Участок» вкладок нет — там
// только инструменты участка.
function applyLibraryTab() {
  const plan = state.modeName === 'plan';
  refs.libraryTabs.hidden = !plan;
  if (!plan) {
    refs.libraryTop.hidden = false;
    refs.furnitureBar.hidden = true;
    return;
  }
  const furn = state.libraryTab === 'furniture';
  refs.libTabRooms.classList.toggle('active', !furn);
  refs.libTabFurniture.classList.toggle('active', furn);
  refs.libraryTop.hidden = furn;
  refs.furnitureBar.hidden = !furn;
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
  refs.libraryTitle.hidden = mode === 'plan'; // в «Плане» заголовок задаёт вкладка
  refs.libraryTitle.textContent = mode === 'plan' ? 'Помещения' : 'Участок';
  refs.libraryHint.textContent = mode === 'plan'
    ? 'Кликните тип, затем место на плане. Комнаты стыкуются сами.'
    : 'Топосъёмка, граница, красная линия, въезд, дорога, север.';
  renderProps();
  renderFurnitureBar();
  applyLibraryTab();
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
  // Круги вращения — чуть снаружи углов (проверяем раньше квадратов).
  for (const r of underlayRotators(site.underlay, 22, state.view.scale)) {
    const p = worldToScreen(r.x, r.y);
    if (Math.hypot(p.x - screen.x, p.y - screen.y) <= HANDLE_SIZE) return { mode: 'rotate', corner: r.id };
  }
  for (const handle of underlayHandles(site.underlay)) {
    const p = worldToScreen(handle.x, handle.y);
    if (Math.abs(p.x - screen.x) <= HANDLE_SIZE && Math.abs(p.y - screen.y) <= HANDLE_SIZE) {
      return { mode: 'resize', corner: handle.id };
    }
  }
  return null;
}

function hitItemHandle(screen) {
  if (state.selection?.type !== 'item') return null;
  const item = state.project.items.find((i) => i.id === state.selection.id);
  if (!item) return null;
  for (const r of itemRotators(item, 20, state.view.scale)) {
    const p = worldToScreen(r.x, r.y);
    if (Math.hypot(p.x - screen.x, p.y - screen.y) <= HANDLE_SIZE) return { mode: 'rotate', corner: r.id };
  }
  for (const c of itemCorners(item)) {
    const p = worldToScreen(c.x, c.y);
    if (Math.abs(p.x - screen.x) <= HANDLE_SIZE && Math.abs(p.y - screen.y) <= HANDLE_SIZE) {
      return { mode: 'resize', corner: c.id };
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
    if (wall.kind === 'joint' || wall.kind === 'chamfer') continue; // заплатки/фаски не выбираются
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
  if (u) {
    const w = u.widthPx * u.mmPerPx;
    const h = u.heightPx * u.mmPerPx;
    const c = underlayCenter(u);
    const loc = rotateVec(world.x - c.x, world.y - c.y, -(u.rot || 0));
    if (Math.abs(loc.x) <= w / 2 && Math.abs(loc.y) <= h / 2) {
      return { type: 'site', kind: 'underlay' };
    }
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
    if (wall.kind === 'joint' || wall.kind === 'chamfer') continue;
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
  updateWallButtons();
  requestDraw();
}

// Плавающие кнопки «+ дверь / + окно» у середины выбранной стены.
function updateWallButtons() {
  const panel = el('wallButtons');
  if (state.selection?.type !== 'wall') { panel.hidden = true; return; }
  const wall = findWall(state.selection.key, state.selection.from);
  if (!wall) { panel.hidden = true; return; }
  positionWallButtons(wall);
  const roomA = roomById(state.project, wall.rooms[0]);
  const windowBtn = el('wallAddWindow');
  const canWindow = wall.kind !== 'shared' && !roomA?.parentId;
  windowBtn.disabled = !canWindow;
  windowBtn.style.opacity = canWindow ? '1' : '0.4';
  panel.hidden = false;
}

function positionWallButtons(wall) {
  const panel = el('wallButtons');
  if (panel.hidden && state.selection?.type !== 'wall') return;
  const mid = worldToScreen((wall.center.x1 + wall.center.x2) / 2, (wall.center.y1 + wall.center.y2) / 2);
  panel.style.left = `${mid.x}px`;
  panel.style.top = `${mid.y}px`;
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
  el('wallButtons').hidden = true; // при активном инструменте кнопки стены прячем
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
  state.ghostDoor = null;
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

// Включить правку существующего слоя (вершины/перемещение) — объект выделяется.
function startEditLayer(target, selection, hint) {
  setTool({ kind: 'edit', target }, hint);
  selectObject(selection);
}

// Какой слой участка сейчас редактируется (по активному инструменту).
function activeSiteLayer() {
  const t = state.tool;
  if (!t) return null;
  if (t.kind === 'underlay-edit') return 'underlay';
  if (t.kind === 'entry') return 'entry';
  if (t.kind === 'neighbor') return 'neighbor';
  if (t.kind === 'draw' || t.kind === 'edit') return t.target;
  return null;
}

// ---------------------------------------------------------------- Действия: план

function placeRoomAt(world, typeOverride = null) {
  const type = typeOverride || state.tool.type;
  const def = roomType(type);
  const w = def.w;
  const h = def.h;
  let x = world.x - w / 2;
  let y = world.y - h / 2;
  const parentId = determineParent(state.project, { x, y, w, h }, null);
  const snapped = snapRoomPosition(state.project, { id: '__ghost__', w, h }, x, y, 14 / state.view.scale, parentId);
  x = snapped.x; y = snapped.y;
  const verdict = validateRoomPlacement(state.project, { x, y, w, h, parentId }, null);
  if (!verdict.ok) { toast(verdict.reason, true); return; }
  const room = createRoom(type, x, y, w, h);
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
  else if (verdict.warning) toast(`⚠ ${verdict.warning} — поставлено, проверьте отступы`, true);
}

// Расчёт параметров проёма под курсором: позиция, сторона открывания и петли
// зависят от того, с какой стороны стены и ближе к какому концу стоит мышь.
function computeOpeningParams(world) {
  const openKind = state.tool.openKind;
  const wall = state.tool.presetWall ? findWall(state.tool.presetWall.key, state.tool.presetWall.from) : nearestWall(world);
  if (!wall) return null;
  const roomId = wall.rooms[0];
  const side = wall.sides[roomId];
  const room = roomById(state.project, roomId);
  if (!room) return null;
  if (openKind === 'window' && (wall.kind === 'shared' || room.parentId)) return { error: 'Окно можно разместить только на наружной стене' };
  const edge = sideEdge(room, side);
  const base = edge.orient === 'h' ? room.x : room.y;
  const along = wall.orient === 'h' ? world.x : world.y;
  const width = openKind === 'door' ? DOOR_WIDTH : WINDOW_WIDTH;
  const opening = createOpening(openKind, roomId, side, along - base, width);
  const clamped = clampOpeningOffset(state.project, opening, state.walls, along - base);
  if (clamped === null) return { error: 'На этом участке стены проём не помещается' };
  opening.offset = clamped;
  if (openKind === 'door') {
    // Сторона открывания — та, где мышь относительно линии стены.
    const perpRoomCenter = wall.orient === 'h' ? room.y + room.h / 2 : room.x + room.w / 2;
    const mousePerp = wall.orient === 'h' ? world.y : world.x;
    const roomSign = Math.sign(perpRoomCenter - wall.edge) || 1;
    const mouseSign = Math.sign(mousePerp - wall.edge) || roomSign;
    opening.swingIn = mouseSign === roomSign; // открывается в сторону курсора
    // Петли — на дальнем от курсора конце, створка «смотрит» к курсору.
    const center = base + opening.offset;
    opening.hingeStart = along > center;
  }
  return { opening, wall };
}

function placeOpeningAt(world) {
  const res = computeOpeningParams(world);
  if (!res) { toast('Кликните ближе к стене'); return; }
  if (res.error) { toast(res.error); return; }
  const { opening } = res;
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

// Комнаты верхнего уровня, перекрывающиеся с данной (любой порядок z).
function overlappingTopRooms(room) {
  if (room.parentId) return [];
  const rect = { x: room.x, y: room.y, w: room.w, h: room.h };
  return state.project.rooms.filter((o) => o !== room && !o.parentId
    && rectsOverlap(rect, { x: o.x, y: o.y, w: o.w, h: o.h }));
}

// Переместить комнату в конец массива (поверх всех по z — она «съедает»).
function bringRoomToTop(roomId) {
  const idx = state.project.rooms.findIndex((r) => r.id === roomId);
  if (idx < 0) return;
  const [room] = state.project.rooms.splice(idx, 1);
  state.project.rooms.push(room);
}

// Добавить/убрать объект в мультивыбор по Shift-клику.
function toggleInMulti(kind, id) {
  const sel = state.selection;
  const roomIds = new Set(sel?.type === 'multi' ? sel.roomIds : sel?.type === 'room' ? [sel.id] : []);
  const itemIds = new Set(sel?.type === 'multi' ? sel.itemIds : sel?.type === 'item' ? [sel.id] : []);
  const set = kind === 'room' ? roomIds : itemIds;
  if (set.has(id)) set.delete(id); else set.add(id);
  const rooms = [...roomIds];
  const items = [...itemIds];
  const total = rooms.length + items.length;
  if (total === 0) { selectObject(null); return; }
  if (total === 1) {
    selectObject(rooms.length ? { type: 'room', id: rooms[0] } : { type: 'item', id: items[0] });
    return;
  }
  selectObject({ type: 'multi', roomIds: rooms, itemIds: items });
}

// Выбрать всю группу мебели как мультивыбор.
function selectGroup(groupId) {
  const itemIds = state.project.items.filter((i) => i.group === groupId).map((i) => i.id);
  if (itemIds.length <= 1) { selectObject(itemIds.length ? { type: 'item', id: itemIds[0] } : null); return; }
  selectObject({ type: 'multi', roomIds: [], itemIds });
}

// Повернуть выбранную мебель группой на 90° вокруг общего центра.
function rotateMulti90() {
  const sel = state.selection;
  if (sel?.type !== 'multi' || !sel.itemIds.length) return;
  const items = sel.itemIds.map((id) => state.project.items.find((i) => i.id === id)).filter(Boolean);
  const cx = items.reduce((s, i) => s + i.x, 0) / items.length;
  const cy = items.reduce((s, i) => s + i.y, 0) / items.length;
  mutate(() => {
    for (const item of items) {
      const dx = item.x - cx;
      const dy = item.y - cy;
      item.x = cx - dy;
      item.y = cy + dx;
      item.rotation = ((item.rotation || 0) + 90) % 360;
    }
  });
  selectObject(sel);
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

// Инструмент «Въезд» активен: клик создаёт въезд (если нет) и сразу тянет
// его по границе; существующий — просто тянется.
function startEntryDrag(world) {
  const site = state.project.site;
  if (!site.boundary || site.boundary.length < 3) { toast('Сначала начертите границу участка'); return; }
  const before = snapshot();
  let created = false;
  if (!site.entry) {
    const spot = computeEntryAt(world);
    if (!spot) { toast('Кликните ближе к границе участка'); return; }
    site.entry = { x: spot.x, y: spot.y, dir: spot.dir };
    created = true;
  }
  selectObject({ type: 'site', kind: 'entry' });
  drag = { kind: 'entry', before, moved: created }; // создание сразу коммитится
  if (created) requestDraw();
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
  // Инструмент остаётся активным — дом можно сразу двигать/крутить/масштабировать.
  selectObject({ type: 'site', kind: 'neighbor', id: neighbor.id });
  toast('Соседний дом добавлен: тяните углы — размер и поворот; вокруг зона 6 м');
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

// Выравнивание ПОКАЗА участка по 2 точкам: кликнутая линия участка становится
// горизонтальной (минимальным поворотом показа) — чтобы по наклонному участку
// строить дом ровно. Сам участок/съёмка не меняются, крутится только вид.
function addAlignPoint(world) {
  const points = state.tool.points;
  points.push({ x: world.x, y: world.y });
  state.alignCursor = { x: world.x, y: world.y };
  if (points.length < 2) { setHint('Теперь кликните вторую точку вдоль той же линии'); requestDraw(); return; }
  const dx = points[1].x - points[0].x;
  const dy = points[1].y - points[0].y;
  if (Math.hypot(dx, dy) < 10) { toast('Точки слишком близко'); state.tool.points = []; return; }
  const clicked = (Math.atan2(dy, dx) * 180) / Math.PI; // экранный угол линии
  let delta = -clicked; // довернуть показ до горизонтали
  delta = ((delta % 180) + 180) % 180; // 0..180
  if (delta > 90) delta -= 180; // минимальный поворот −90..90
  state.alignCursor = null;
  mutate(() => { state.project.planSiteRot = ((((state.project.planSiteRot || 0) + delta) % 360) + 360) % 360; });
  cancelTool();
  toast(`Участок выровнен для чертежа (поворот показа ${delta > 0 ? '+' : ''}${delta.toFixed(1)}°). Дом теперь ставится ровно.`);
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
  if (name.endsWith('.dwg')) {
    toast('DWG (бинарный) в браузере не читается. Сохраните как DXF (в CAD: Save As → DXF) или PDF/JPG и загрузите.', true);
    return;
  }
  try {
    if (name.endsWith('.dxf')) {
      const text = await file.text();
      const parsed = parseDxf(text);
      const summary = dxfTypeSummary(parsed);
      let info;
      try {
        info = dxfToImage(parsed);
      } catch (e) {
        toast(`DXF прочитан, но рисовать нечего (${summary || 'нет поддерживаемых объектов'}). Возможно, чертёж из блоков INSERT или это бинарный DXF — пришлите файл, добавлю поддержку.`, true);
        return;
      }
      placeUnderlay(info.dataUrl, info.size, info.reliableScale ? info.worldWidthMm : null);
      if (state.modeName === 'site') fitView(); // сразу вписываем в экран
      const proxy = /PROXY/i.test(summary);
      const base = `DXF: ${info.entityCount} объектов${summary ? ` (${summary})` : ''}`;
      if (proxy) {
        // Часть/вся геометрия — в проприетарных proxy-объектах, их не прочитать.
        toast(`${base}. Если пусто/мало — геометрия в проприетарных proxy-объектах: в CAD расчлените чертёж (EXPLODE / «Расчленить») и «Сохранить как» DXF R12/2000, либо импортируйте PDF.`, true);
      } else if (info.reliableScale) {
        toast(`${base}, ширина ≈ ${info.worldWidthM.toFixed(1)} м${info.hadUnits ? '' : ' (единицы приняты за метры)'}. Масштаб — справа.`, true);
      } else {
        toast(`${base}. Единицы непонятны — поставил удобный размер. Задайте масштаб: «Ширина, м» или «по отрезку» справа.`, true);
      }
      return;
    }
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

function placeUnderlay(dataUrl, size, worldWidthMm = null) {
  const center = screenToWorld(canvas.clientWidth / 2, canvas.clientHeight / 2);
  // Если известна реальная ширина (из DXF) — масштаб 1:1; иначе картинка
  // занимает ~70% ширины видимой области.
  const visibleWorldWidth = canvas.clientWidth / state.view.scale;
  const mmPerPx = worldWidthMm && worldWidthMm > 0
    ? worldWidthMm / size.w
    : (visibleWorldWidth * 0.7) / size.w;
  mutate(() => {
    state.project.site.underlay = {
      src: dataUrl,
      x: center.x - (size.w * mmPerPx) / 2,
      y: center.y - (size.h * mmPerPx) / 2,
      widthPx: size.w,
      heightPx: size.h,
      mmPerPx,
      rot: 0,
      opacity: 0.7,
      locked: false,
    };
  });
  selectObject({ type: 'site', kind: 'underlay' });
  toast('Топосъёмка загружена. Задайте масштаб справа: впишите ширину в метрах, или тяните углы картинки', true);
}

// ---------------------------------------------------------------- Ввод мыши

canvas.addEventListener('contextmenu', (e) => e.preventDefault());

// Перетаскивание мебели из панели на план.
canvas.addEventListener('dragover', (e) => {
  if (state.modeName !== 'plan') return;
  const t = e.dataTransfer?.types || [];
  if (!t.includes('application/x-kepler-furn') && !t.includes('application/x-kepler-room')) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'copy';
});
canvas.addEventListener('drop', (e) => {
  if (state.modeName !== 'plan') return;
  const rect = canvas.getBoundingClientRect();
  const roomType = e.dataTransfer?.getData('application/x-kepler-room');
  if (roomType) {
    e.preventDefault();
    cancelTool();
    const world = screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
    placeRoomAt(world, roomType);
    return;
  }
  const kind = e.dataTransfer?.getData('application/x-kepler-furn') || e.dataTransfer?.getData('text/plain');
  if (!kind || !furnitureDef(kind)) return;
  e.preventDefault();
  const world = screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
  addFurnitureAt(kind, world.x, world.y);
});

canvas.addEventListener('pointerdown', (event) => {
  const screen = pointerScreen(event);
  const world = pointerWorld(event);
  canvas.setPointerCapture(event.pointerId);

  // Панорама: правая/средняя кнопка или зажатый пробел.
  if (event.button === 1 || event.button === 2 || spaceDown) {
    drag = { kind: 'pan', start: screen, view: { ...state.view } };
    return;
  }

  // --- Правка слоя участка: доступна только при активном его инструменте ---
  const layer = activeSiteLayer();
  if (layer === 'neighbor') {
    const hh = hitNeighborHandle(screen);
    if (hh) {
      const n = state.project.site.neighbors.find((x) => x.id === state.selection.id);
      if (hh.mode === 'rotate') {
        drag = { kind: 'neighbor-rotate', id: n.id, startRot: n.rot || 0, startAngle: Math.atan2(world.y - n.y, world.x - n.x), center: { x: n.x, y: n.y }, before: snapshot(), moved: false };
      } else {
        const opp = { nw: 'se', ne: 'sw', se: 'nw', sw: 'ne' }[hh.corner];
        const anchor = neighborCorners(n).find((c) => c.id === opp);
        drag = { kind: 'neighbor-resize', id: n.id, corner: hh.corner, anchor: { x: anchor.x, y: anchor.y }, rot: n.rot || 0, before: snapshot(), moved: false };
      }
      return;
    }
    const hit = hitSiteObject(world);
    if (hit?.kind === 'neighbor') {
      const n = state.project.site.neighbors.find((x) => x.id === hit.id);
      selectObject(hit);
      drag = { kind: 'neighbor', id: hit.id, start: { x: n.x, y: n.y }, world, before: snapshot(), moved: false };
      return;
    }
    placeNeighborAt(world); // пустое место — новый дом
    return;
  }
  if (layer === 'underlay') {
    const hh = hitUnderlayHandle(screen);
    if (hh) {
      const u = state.project.site.underlay;
      const c = underlayCenter(u);
      if (hh.mode === 'rotate') {
        drag = { kind: 'underlay-rotate', startRot: u.rot || 0, startAngle: Math.atan2(world.y - c.y, world.x - c.x), center: c, before: snapshot(), moved: false };
        return;
      }
      const opp = { nw: 'se', ne: 'sw', se: 'nw', sw: 'ne' }[hh.corner];
      const anchor = underlayHandles(u).find((h) => h.id === opp);
      const sign = { nw: [-1, -1], ne: [1, -1], se: [1, 1], sw: [-1, 1] }[opp];
      drag = { kind: 'underlay-resize', corner: hh.corner, anchor, anchorSign: sign, rot: u.rot || 0, startW: u.widthPx * u.mmPerPx, startH: u.heightPx * u.mmPerPx, startMmPerPx: u.mmPerPx, before: snapshot(), moved: false };
      return;
    }
    const hit = hitSiteObject(world);
    if (hit?.kind === 'underlay' && !state.project.site.underlay?.locked) {
      const u = state.project.site.underlay;
      selectObject(hit);
      drag = { kind: 'underlay', start: { x: u.x, y: u.y }, world, before: snapshot(), moved: false };
      return;
    }
    selectObject({ type: 'site', kind: 'underlay' });
    return;
  }
  if (layer === 'entry') { startEntryDrag(world); return; }
  if (layer === 'boundary' || layer === 'redline' || layer === 'road') {
    const v = hitSiteVertex(screen);
    if (v) {
      drag = { kind: 'site-vertex', siteKind: v.kind, id: v.id, index: v.index, points: v.points, before: snapshot(), moved: false };
      return;
    }
    if (state.draft) { addDraftPoint(world); return; } // режим черчения нового контура
    return;
  }

  // --- Прочие инструменты плана ---
  if (state.tool) {
    const t = state.tool;
    if (t.kind === 'place-room') { placeRoomAt(world); return; }
    if (t.kind === 'place-opening') { placeOpeningAt(world); return; }
    if (t.kind === 'north') { addNorthPoint(world); return; }
    if (t.kind === 'align-underlay') { addAlignPoint(world); return; }
    if (t.kind === 'calibrate') { addCalibratePoint(world); return; }
    return;
  }

  // Клик мимо поля калибровки — отменяем калибровку.
  if (state.calibration && !el('calOverlay').hidden) { hideCalInput(); }
  if (!el('dimInput').hidden) hideDimInput();

  // Стрелки-перевороты и размерные подписи выбранного проёма.
  if (state.selection?.type === 'opening' && state._openingUI) {
    for (const f of state._openingUI.flips) {
      if (Math.hypot(f.x - screen.x, f.y - screen.y) <= 15) { toggleOpeningFlip(f.kind); return; }
    }
    for (const d of state._openingUI.dims) {
      if (Math.hypot(d.x - screen.x, d.y - screen.y) <= 20) { openDimInput(d); return; }
    }
  }

  // Ручки плановых объектов.
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
  const itemHandleHit = hitItemHandle(screen);
  if (itemHandleHit) {
    const item = state.project.items.find((i) => i.id === state.selection.id);
    if (itemHandleHit.mode === 'rotate') {
      drag = {
        kind: 'item-rotate', id: item.id, startRot: item.rotation || 0,
        startAngle: Math.atan2(world.y - item.y, world.x - item.x), center: { x: item.x, y: item.y },
        before: snapshot(), moved: false,
      };
    } else {
      const opposite = { nw: 'se', ne: 'sw', se: 'nw', sw: 'ne' }[itemHandleHit.corner];
      const anchor = itemCorners(item).find((c) => c.id === opposite);
      drag = {
        kind: 'item-resize', id: item.id, corner: itemHandleHit.corner,
        anchor: { x: anchor.x, y: anchor.y }, rot: item.rotation || 0,
        before: snapshot(), moved: false,
      };
    }
    return;
  }

  const item = hitItem(world);
  if (item) {
    if (event.shiftKey) { toggleInMulti('item', item.id); return; }
    if (state.selection?.type === 'multi' && state.selection.itemIds.includes(item.id)) {
      startMultiDrag(world);
      return;
    }
    if (item.group) { selectGroup(item.group); startMultiDrag(world); return; }
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
    if (event.shiftKey) { toggleInMulti('room', room.id); return; }
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
    positionCalInput();
    if (state.selection?.type === 'wall') { const w = findWall(state.selection.key, state.selection.from); if (w) positionWallButtons(w); }
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
    if (!event.shiftKey) snapItemToWalls(item); // Shift отключает привязку к стенам
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
    width = Math.max(300, Math.round(width / 50) * 50);
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

  if (drag.kind === 'item-rotate') {
    const item = state.project.items.find((i) => i.id === drag.id);
    if (!item) return;
    drag.moved = true;
    const ang = Math.atan2(world.y - drag.center.y, world.x - drag.center.x);
    let deg = drag.startRot + ((ang - drag.startAngle) * 180) / Math.PI;
    const stepDeg = event.shiftKey ? 15 : 5; // по умолчанию шаг 5°, Shift — 15°
    deg = Math.round(deg / stepDeg) * stepDeg;
    item.rotation = ((deg % 360) + 360) % 360;
    requestDraw();
    return;
  }

  if (drag.kind === 'item-resize') {
    const item = state.project.items.find((i) => i.id === drag.id);
    if (!item) return;
    drag.moved = true;
    const dLocal = rotateVec(world.x - drag.anchor.x, world.y - drag.anchor.y, -drag.rot);
    const snap = (v) => Math.max(200, Math.round(Math.abs(v) / 50) * 50);
    const newW = snap(dLocal.x);
    const newH = snap(dLocal.y);
    const half = rotateVec((Math.sign(dLocal.x) || 1) * newW / 2, (Math.sign(dLocal.y) || 1) * newH / 2, drag.rot);
    item.w = newW;
    item.h = newH;
    item.x = drag.anchor.x + half.x;
    item.y = drag.anchor.y + half.y;
    requestDraw();
    return;
  }

  if (drag.kind === 'neighbor-rotate') {
    const n = state.project.site.neighbors.find((x) => x.id === drag.id);
    if (!n) return;
    drag.moved = true;
    const ang = Math.atan2(world.y - drag.center.y, world.x - drag.center.x);
    let deg = drag.startRot + ((ang - drag.startAngle) * 180) / Math.PI;
    const stepDeg = event.shiftKey ? 15 : 5; // по умолчанию шаг 5°, Shift — 15°
    deg = Math.round(deg / stepDeg) * stepDeg;
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

  if (drag.kind === 'underlay-rotate') {
    const u = state.project.site.underlay;
    if (!u || u.locked) return;
    drag.moved = true;
    const ang = Math.atan2(world.y - drag.center.y, world.x - drag.center.x);
    let deg = drag.startRot + ((ang - drag.startAngle) * 180) / Math.PI;
    const stepDeg = event.shiftKey ? 15 : 5; // по умолчанию шаг 5°, Shift — 15°
    deg = Math.round(deg / stepDeg) * stepDeg;
    u.rot = ((deg % 360) + 360) % 360;
    requestDraw();
    return;
  }

  if (drag.kind === 'underlay-resize') {
    const u = state.project.site.underlay;
    if (!u) return;
    drag.moved = true;
    // Пропорциональный масштаб в собственной (повёрнутой) системе: курсор
    // переводим в локальные оси, ширина — расстояние от закреплённого угла.
    const anchor = drag.anchor;
    const dLocal = rotateVec(world.x - anchor.x, world.y - anchor.y, -drag.rot);
    const newW = Math.max(1000, Math.abs(dLocal.x));
    const k = newW / (drag.startW || 1);
    u.mmPerPx = Math.max(0.5, drag.startMmPerPx * k);
    const w = u.widthPx * u.mmPerPx;
    const h = u.heightPx * u.mmPerPx;
    // Якорный угол неподвижен; восстанавливаем центр, затем левый-верхний.
    const [asx, asy] = drag.anchorSign;
    const half = rotateVec(asx * w / 2, asy * h / 2, drag.rot);
    const cx = anchor.x - half.x;
    const cy = anchor.y - half.y;
    u.x = cx - w / 2;
    u.y = cy - h / 2;
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
      } else if (room && !room.parentId) {
        // Перетащенная комната, перекрывшая другую, становится «съедающей»
        // (наверх по z). Кто у кого забирает площадь — переключается в панели.
        const over = overlappingTopRooms(room);
        if (over.length) {
          bringRoomToTop(room.id);
          toast(`«${room.name}» перекрывает «${over[0].name}» и забирает площадь — поменять можно в панели`, true);
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
  if (state.selection?.type === 'wall') { const w = findWall(state.selection.key, state.selection.from); if (w) positionWallButtons(w); }
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
      warn: Boolean(verdict.warning),
      label: parentId ? `Вложить в «${roomById(state.project, parentId)?.name}»` : undefined,
      reason: verdict.ok ? (verdict.warning || '') : verdict.reason,
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
  if (state.tool?.kind === 'align-underlay' && state.tool.points.length === 1) {
    state.alignCursor = { x: world.x, y: world.y };
    requestDraw();
    return;
  }
  if (state.tool?.kind === 'place-opening') {
    state.ghostOpening = null;
    state.ghostDoor = null;
    const res = computeOpeningParams(world);
    if (res && res.opening && !res.error) {
      if (state.tool.openKind === 'door') {
        state.ghostDoor = res.opening; // превью двери со створкой и направлением
      } else {
        const placed = openingRect(state.project, res.opening, state.walls);
        if (placed) state.ghostOpening = { rect: placed.rect };
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

// Линии привязки: грани стен и кромки других комнат.
function collectSnapLines(excludeRoomId) {
  const xs = [];
  const ys = [];
  for (const wall of state.walls) {
    if (excludeRoomId && wall.rooms.includes(excludeRoomId) && wall.kind === 'own') continue;
    xs.push(wall.band.x, wall.band.x + wall.band.w);
    ys.push(wall.band.y, wall.band.y + wall.band.h);
  }
  for (const r of state.project.rooms) {
    if (r.id === excludeRoomId) continue;
    xs.push(r.x, r.x + r.w);
    ys.push(r.y, r.y + r.h);
  }
  return { xs, ys };
}

function snapValue(value, candidates, tol) {
  let best = null;
  for (const c of candidates) {
    const d = Math.abs(value - c);
    if (d <= tol && (!best || d < best.d)) best = { c, d };
  }
  return best ? best.c : null;
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
  // Привязка подвижной грани к стенам/кромкам соседних комнат.
  const tol = 14 / state.view.scale;
  const lines = dragState.snapLines || (dragState.snapLines = collectSnapLines(room.id));
  if (h.includes('w')) { const s = snapValue(x, lines.xs, tol); if (s !== null) { w += x - s; x = s; } }
  if (h.includes('e')) { const s = snapValue(x + w, lines.xs, tol); if (s !== null) w = s - x; }
  if (h.includes('n')) { const s = snapValue(y, lines.ys, tol); if (s !== null) { hh += y - s; y = s; } }
  if (h.includes('s')) { const s = snapValue(y + hh, lines.ys, tol); if (s !== null) hh = s - y; }
  if (w < MIN_ROOM_SIZE) { if (h.includes('w')) x -= MIN_ROOM_SIZE - w; w = MIN_ROOM_SIZE; }
  if (hh < MIN_ROOM_SIZE) { if (h.includes('n')) y -= MIN_ROOM_SIZE - hh; hh = MIN_ROOM_SIZE; }
  room.x = x; room.y = y; room.w = w; room.h = hh;
}

// Привязка мебели к стенам: кромки/центр предмета липнут к граням стен.
function snapItemToWalls(item) {
  const tol = 12 / state.view.scale;
  const lines = collectSnapLines(null);
  const rect = itemRect(item);
  const sx = snapValue(rect.x, lines.xs, tol);
  const ex = snapValue(rect.x + rect.w, lines.xs, tol);
  const cx = snapValue(item.x, lines.xs, tol);
  if (sx !== null) item.x += sx - rect.x;
  else if (ex !== null) item.x += ex - (rect.x + rect.w);
  else if (cx !== null) item.x = cx;
  const r2 = itemRect(item);
  const sy = snapValue(r2.y, lines.ys, tol);
  const ey = snapValue(r2.y + r2.h, lines.ys, tol);
  const cy = snapValue(item.y, lines.ys, tol);
  if (sy !== null) item.y += sy - r2.y;
  else if (ey !== null) item.y += ey - (r2.y + r2.h);
  else if (cy !== null) item.y = cy;
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
  if (event.code === 'KeyR') {
    if (state.selection?.type === 'multi') rotateMulti90(); else rotateSelectedItem();
    return;
  }
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
  // План: карточки помещений — только названия, без размеров.
  refs.roomCards.innerHTML = '';
  for (const def of ROOM_TYPES) {
    const card = document.createElement('button');
    card.className = 'room-card names-only';
    card.draggable = true;
    if (state.tool?.kind === 'place-room' && state.tool.type === def.type) card.classList.add('active');
    card.innerHTML = `<span class="room-card-name">${def.title}</span>`;
    card.addEventListener('click', () => {
      if (state.tool?.kind === 'place-room' && state.tool.type === def.type) cancelTool();
      else startPlaceRoom(def.type);
    });
    card.addEventListener('dragstart', (e) => {
      card.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'copy';
      e.dataTransfer.setData('application/x-kepler-room', def.type);
      e.dataTransfer.setData('text/plain', def.type);
    });
    card.addEventListener('dragend', () => card.classList.remove('dragging'));
    refs.roomCards.appendChild(card);
  }

  // Участок: инструменты-слои. Правка слоя доступна, только пока его кнопка
  // активна (подсвечена). Повторный клик по активной — выключает.
  const site = state.project?.site;
  const layer = activeSiteLayer();
  const editHint = (name) => `Правка: ${name}. Тяните точки/объект. Esc — выйти`;
  const tools = [
    { id: 'underlay', title: 'Топосъёмка', note: site?.underlay ? 'двигать / масштаб' : 'импорт PDF/JPG/DXF',
      action: () => setTool({ kind: 'underlay-edit' }, site?.underlay
        ? editHint('топосъёмка — двигайте, тяните углы')
        : 'Нажмите «Импортировать топосъёмку» в панели справа · PDF / JPG / PNG / DXF') },
    { id: 'boundary', title: 'Граница участка', note: site?.boundary ? `${polygonAreaM2(site.boundary).toFixed(0)} м² · правка` : 'полигон по точкам',
      action: () => (site?.boundary ? startEditLayer('boundary', { type: 'site', kind: 'boundary' }, editHint('граница — тяните вершины')) : startDraw('boundary')) },
    { id: 'redline', title: 'Красная линия', note: site?.redLine ? 'правка' : 'линия застройки',
      action: () => (site?.redLine ? startEditLayer('redline', { type: 'site', kind: 'redline' }, editHint('красная линия — тяните вершины')) : startDraw('redline')) },
    { id: 'road', title: 'Дорога', note: site?.roads?.length ? 'правка / новая' : 'ось + ширина',
      action: () => (site?.roads?.length ? startEditLayer('road', { type: 'site', kind: 'road', id: site.roads[site.roads.length - 1].id }, editHint('дорога — тяните вершины')) : startDraw('road')) },
    { id: 'entry', title: 'Въезд', note: 'точка на границе', action: () => setTool({ kind: 'entry' }, 'Кликните/тяните по границе участка — там будет въезд · Esc — выйти') },
    { id: 'neighbor', title: 'Соседний дом', note: 'зона 6 м вокруг', action: () => setTool({ kind: 'neighbor' }, 'Кликните — новый дом; тяните углы для размера и поворота · Esc — выйти') },
    { id: 'north', title: 'Север по 2 точкам', note: `сейчас ${Math.round(site?.north || 0)}°`, action: () => setTool({ kind: 'north', points: [] }, 'Кликните первую точку стрелки на север') },
  ];
  refs.siteTools.innerHTML = '';
  for (const tool of tools) {
    const btn = document.createElement('button');
    btn.className = 'room-card';
    const active = layer === tool.id || (tool.id === 'north' && state.tool?.kind === 'north');
    if (active) btn.classList.add('active');
    btn.innerHTML = `<span class="room-card-name">${tool.title}</span><span class="room-card-size">${tool.note}</span>`;
    btn.addEventListener('click', () => { if (active) cancelTool(); else tool.action(); });
    refs.siteTools.appendChild(btn);
  }
}

// ---------------------------------------------------------------- Нижняя панель мебели

function renderFurnitureBar() {
  // Содержимое строится только в режиме «План»; видимость задаёт вкладка
  // (applyLibraryTab).
  if (state.modeName !== 'plan') return;

  refs.furnitureCats.innerHTML = '';
  for (const cat of FURNITURE_CATEGORIES) {
    const btn = document.createElement('button');
    btn.innerHTML = CATEGORY_ICONS[cat.id] || '';
    btn.title = cat.title;
    btn.setAttribute('aria-label', cat.title);
    if (cat.id === furnitureCat) btn.classList.add('active');
    btn.addEventListener('click', () => { furnitureCat = cat.id; renderFurnitureBar(); });
    refs.furnitureCats.appendChild(btn);
  }

  const stroke = getComputedStyle(document.documentElement).getPropertyValue('--muted').trim() || '#7f90a5';
  refs.furnitureItems.innerHTML = '';
  for (const item of furnitureByCategory(furnitureCat)) {
    const chip = document.createElement('div');
    chip.className = 'furniture-chip';
    chip.draggable = true;
    chip.title = `Перетащите «${item.title}» на план (${item.w}×${item.h} мм)`;
    const preview = document.createElement('canvas');
    preview.width = 240;
    preview.height = 132;
    chip.appendChild(preview);
    const name = document.createElement('span');
    name.className = 'chip-name';
    name.textContent = item.title;
    chip.appendChild(name);
    const size = document.createElement('span');
    size.className = 'chip-size';
    size.textContent = `${item.w}×${item.h}`;
    chip.appendChild(size);
    try { drawGlyphPreview(preview, item.kind, item.w, item.h, stroke); } catch { /* превью не критично */ }
    chip.addEventListener('dragstart', (e) => {
      chip.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'copy';
      e.dataTransfer.setData('application/x-kepler-furn', item.kind);
      e.dataTransfer.setData('text/plain', item.kind);
    });
    chip.addEventListener('dragend', () => chip.classList.remove('dragging'));
    chip.addEventListener('click', () => toast('Перетащите карточку мебели на план'));
    refs.furnitureItems.appendChild(chip);
  }
}

// Чёткие контурные иконки категорий мебели (монохром, наследуют цвет).
const svgIcon = (inner) => `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
const CATEGORY_ICONS = {
  seating: svgIcon('<path d="M5 11V8.5A2.5 2.5 0 0 1 7.5 6h9A2.5 2.5 0 0 1 19 8.5V11"/><path d="M4 11.5A1.5 1.5 0 0 1 5.5 13v3h13v-3A1.5 1.5 0 0 1 20 11.5"/><path d="M6.5 16v2M17.5 16v2"/>'),
  beds: svgIcon('<path d="M3 18V7h13a4 4 0 0 1 4 4v7"/><path d="M3 13h17"/><path d="M6.5 10.5h3"/>'),
  tables: svgIcon('<rect x="3" y="7" width="18" height="3.5" rx="1"/><path d="M5.5 10.5V17M18.5 10.5V17"/>'),
  chairs: svgIcon('<path d="M8 3v9M16 3v9M7 12h10l-1 9M8 21l-.7-9M7 12l-.5-9"/><path d="M8.5 16h7"/>'),
  storage: svgIcon('<rect x="5" y="3" width="14" height="18" rx="1.5"/><path d="M5 9h14M5 15h14"/><path d="M11 6h1M11 12h1M11 18h1"/>'),
  kitchen: svgIcon('<rect x="4" y="4" width="16" height="16" rx="2"/><circle cx="9" cy="9" r="1.8"/><circle cx="15" cy="9" r="1.8"/><path d="M5 14.5h14"/>'),
  bath: svgIcon('<path d="M4 12h16v3a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3z"/><path d="M6 12V7.5A2.2 2.2 0 0 1 8.2 5.3a2.2 2.2 0 0 1 2.1 1.5"/><path d="M7 18l-.8 2M17 18l.8 2"/>'),
  appliance: svgIcon('<rect x="5" y="3" width="14" height="18" rx="2"/><circle cx="12" cy="13" r="4"/><path d="M8.5 6h0M11 6h0"/>'),
  decor: svgIcon('<path d="M8.5 3h7l2 7h-11z"/><path d="M12 10v8M9 21h6"/>'),
  office: svgIcon('<rect x="3" y="4" width="18" height="12" rx="1.5"/><path d="M8.5 20h7M12 16v4"/>'),
  kids: svgIcon('<circle cx="12" cy="13.5" r="5.5"/><circle cx="7" cy="7" r="2.3"/><circle cx="17" cy="7" r="2.3"/><path d="M10 13h0M14 13h0"/>'),
  gym: svgIcon('<path d="M6.5 8.5v7M4 10v4M17.5 8.5v7M20 10v4M8 12h8"/>'),
  hall: svgIcon('<rect x="6" y="3" width="12" height="18" rx="1.5"/><circle cx="14.5" cy="12" r="1"/>'),
  outdoor: svgIcon('<path d="M12 21v-6"/><path d="M12 15a5 5 0 1 0-4.6-7A4 4 0 0 0 7 15z"/>'),
  misc: svgIcon('<rect x="4" y="4" width="7" height="7" rx="1.2"/><rect x="13" y="4" width="7" height="7" rx="1.2"/><rect x="4" y="13" width="7" height="7" rx="1.2"/><rect x="13" y="13" width="7" height="7" rx="1.2"/>'),
};

// Добавляет предмет мебели в указанную мировую точку (центр предмета).
function addFurnitureAt(kind, worldX, worldY) {
  const fd = furnitureDef(kind);
  if (!fd) return;
  const item = createItem(
    kind,
    Math.round(worldX / GRID_STEP) * GRID_STEP,
    Math.round(worldY / GRID_STEP) * GRID_STEP,
    fd.w, fd.h,
  );
  mutate(() => { state.project.items.push(item); });
  selectObject({ type: 'item', id: item.id });
  toast(`«${fd.title}» добавлен — тяните углы для размера, круг — поворот`);
}

function containingRoom(item) {
  if (!item) return null;
  const nested = state.project.rooms.filter((r) => r.parentId);
  const top = state.project.rooms.filter((r) => !r.parentId);
  for (const room of [...nested, ...top]) {
    if (item.x >= room.x && item.x <= room.x + room.w && item.y >= room.y && item.y <= room.y + room.h) return room;
  }
  return null;
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

  // Пересечения с другими комнатами: кто у кого забирает площадь (по z-порядку).
  const overlaps = overlappingTopRooms(room);
  const myIdx = state.project.rooms.indexOf(room);
  const overlapControl = overlaps.length ? `
    <h3>Пересечения</h3>
    <div class="prop-block">
      ${overlaps.map((o) => {
    const eats = myIdx > state.project.rooms.indexOf(o); // эта комната выше → съедает o
    return `<div class="prop-row overlap-row" data-other="${o.id}">
          <span>${eats ? `съедает «${escapeHtml(o.name)}»` : `«${escapeHtml(o.name)}» съедает эту`}</span>
          <button class="link" data-swap="${o.id}">поменять</button>
        </div>`;
  }).join('')}
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
    ${overlapControl}
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
  panel.querySelectorAll('[data-swap]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const other = roomById(state.project, btn.dataset.swap);
      if (!other) return;
      mutate(() => {
        const rooms = state.project.rooms;
        const i = rooms.indexOf(room);
        const j = rooms.indexOf(other);
        [rooms[i], rooms[j]] = [rooms[j], rooms[i]];
      });
      selectObject({ type: 'room', id: room.id });
    });
  });
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

// Фасад проёма (вид на стену) — SVG с размерами ширины, высоты и отступа
// от пола. Чисто параметрический, масштабируется.
function elevationSVG(opening) {
  const isDoor = opening.kind === 'door';
  const sill = isDoor ? 0 : (opening.sill || 0);
  const height = opening.height || (isDoor ? 2100 : 1500);
  const width = opening.width;
  const ceil = Math.max(2700, sill + height + 350);
  const margin = Math.max(500, width * 0.35);
  const W = width + margin * 2;
  const ox = margin;
  const oy = ceil - sill - height;
  const sw = Math.max(14, W / 90); // толщина линий в единицах viewBox
  const dim = (x1, y1, x2, y2, label, tx, ty, rot) => `
    <line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" class="elev-dim"/>
    <text x="${tx}" y="${ty}" class="elev-txt" ${rot ? `transform="rotate(${rot} ${tx} ${ty})"` : ''}>${label}</text>`;
  const glass = isDoor
    ? `<rect x="${ox + sw * 1.5}" y="${oy + sw * 1.5}" width="${width - sw * 3}" height="${height - sw * 3}" class="elev-door"/>
       <circle cx="${ox + width - sw * 5}" cy="${oy + height / 2}" r="${sw * 1.5}" class="elev-dim"/>`
    : `<rect x="${ox}" y="${oy}" width="${width}" height="${height}" class="elev-glass"/>
       <line x1="${ox + width / 2}" y1="${oy}" x2="${ox + width / 2}" y2="${oy + height}" class="elev-dim"/>
       <line x1="${ox}" y1="${oy + height / 2}" x2="${ox + width}" y2="${oy + height / 2}" class="elev-dim"/>`;
  return `<svg viewBox="0 0 ${W} ${ceil}" class="elev" preserveAspectRatio="xMidYMid meet" style="--sw:${sw}px">
    <rect x="0" y="0" width="${W}" height="${ceil}" class="elev-wall"/>
    <rect x="${ox}" y="${oy}" width="${width}" height="${height}" class="elev-open"/>
    ${glass}
    <line x1="0" y1="${ceil}" x2="${W}" y2="${ceil}" class="elev-floor"/>
    ${dim(ox, oy - sw * 6, ox + width, oy - sw * 6, `${width}`, ox + width / 2, oy - sw * 8)}
    ${dim(ox + width + sw * 6, oy, ox + width + sw * 6, oy + height, `${height}`, ox + width + sw * 10, oy + height / 2, -90)}
    ${sill > 0 ? dim(ox - sw * 6, oy + height, ox - sw * 6, ceil, `${sill}`, ox - sw * 10, oy + height + sill / 2, -90) : ''}
  </svg>`;
}

function toggleOpeningFlip(kind) {
  const opening = state.project.openings.find((o) => o.id === state.selection.id);
  if (!opening) return;
  mutate(() => {
    if (kind === 'swing') opening.swingIn = !opening.swingIn;
    else opening.hingeStart = !opening.hingeStart;
  });
  selectObject({ type: 'opening', id: opening.id });
}

// Инлайн-ввод размера (отступа до стены) прямо на размерной линии.
function openDimInput(dim) {
  const overlay = el('dimInput');
  const input = el('dimInputField');
  state.dimEdit = { openingId: state.selection.id, kind: dim.kind };
  input.value = Math.round(dim.gap);
  overlay.style.left = `${dim.x}px`;
  overlay.style.top = `${dim.y}px`;
  overlay.hidden = false;
  setTimeout(() => { input.focus(); input.select(); }, 20);
}

function hideDimInput() {
  el('dimInput').hidden = true;
  state.dimEdit = null;
}

function applyDimInput() {
  const edit = state.dimEdit;
  if (!edit) return;
  const opening = state.project.openings.find((o) => o.id === edit.openingId);
  if (!opening) { hideDimInput(); return; }
  const value = Math.max(0, Number(el('dimInputField').value) || 0);
  const walls = deriveWalls(state.project);
  const placed = openingRect(state.project, opening, walls);
  if (!placed) { hideDimInput(); return; }
  const { wall } = placed;
  const room = roomById(state.project, opening.roomId);
  const base = wall.orient === 'h' ? room.x : room.y;
  const half = opening.width / 2;
  const desired = edit.kind === 'left'
    ? (wall.from - base) + value + half
    : (wall.to - base) - value - half;
  mutate(() => {
    const clamped = clampOpeningOffset(state.project, opening, deriveWalls(state.project), desired);
    if (clamped !== null) opening.offset = clamped;
    else toast('Сюда проём не помещается');
  });
  hideDimInput();
  selectObject({ type: 'opening', id: opening.id });
}

function renderOpeningProps(panel, opening) {
  if (!opening) { renderProjectProps(panel); return; }
  const room = roomById(state.project, opening.roomId);
  const isDoor = opening.kind === 'door';
  const walls = state.walls;
  const placed = openingRect(state.project, opening, walls);
  let leftGap = null;
  let rightGap = null;
  let wall = null;
  if (placed) {
    wall = placed.wall;
    const centerAlong = wall.orient === 'h' ? placed.rect.x + placed.rect.w / 2 : placed.rect.y + placed.rect.h / 2;
    leftGap = Math.round((centerAlong - opening.width / 2) - wall.from);
    rightGap = Math.round(wall.to - (centerAlong + opening.width / 2));
  }

  panel.innerHTML = `
    <h2>${isDoor ? 'Дверь' : 'Окно'}</h2>
    <p class="subtitle">Стена «${room?.name}»</p>
    <div class="elev-wrap">${elevationSVG(opening)}</div>
    <div class="prop-block">
      <div class="prop-grid">
        <label class="prop-field"><span>Ширина, мм</span>
          <input id="openW" type="number" step="50" min="300" value="${opening.width}"></label>
        <label class="prop-field"><span>Высота, мм</span>
          <input id="openH" type="number" step="50" min="300" value="${opening.height || (isDoor ? 2100 : 1500)}"></label>
      </div>
      ${isDoor ? '' : `<label class="prop-field"><span>Отступ от пола (подоконник), мм</span>
        <input id="openSill" type="number" step="50" min="0" value="${opening.sill || 0}"></label>`}
    </div>
    <h3>Положение на стене</h3>
    <div class="prop-block">
      <div class="prop-grid">
        <label class="prop-field"><span>Отступ слева, мм</span>
          <input id="gapL" type="number" step="50" value="${leftGap ?? ''}" ${leftGap === null ? 'disabled' : ''}></label>
        <label class="prop-field"><span>Отступ справа, мм</span>
          <input id="gapR" type="number" step="50" value="${rightGap ?? ''}" ${rightGap === null ? 'disabled' : ''}></label>
      </div>
      <label class="prop-field"><span>От начала стены, мм</span>
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
    const width = Math.max(300, Number(e.target.value) || opening.width);
    commitOpening(() => {
      opening.width = width;
      const clamped = clampOpeningOffset(state.project, opening, deriveWalls(state.project), opening.offset);
      if (clamped !== null) opening.offset = clamped;
      else toast('Проём шире стены — уменьшите ширину');
    });
  });
  panel.querySelector('#openH').addEventListener('change', (e) => {
    commitOpening(() => { opening.height = Math.max(300, Number(e.target.value) || opening.height); });
  });
  const sillInput = panel.querySelector('#openSill');
  if (sillInput) sillInput.addEventListener('change', (e) => commitOpening(() => { opening.sill = Math.max(0, Number(e.target.value) || 0); }));

  const setByGap = (fromLeft) => (e) => {
    if (!wall) return;
    const base = wall.orient === 'h'
      ? roomById(state.project, opening.roomId).x
      : roomById(state.project, opening.roomId).y;
    const value = Math.max(0, Number(e.target.value) || 0);
    const desired = fromLeft
      ? (wall.from - base) + opening.width / 2 + value
      : (wall.to - base) - opening.width / 2 - value;
    commitOpening(() => {
      const clamped = clampOpeningOffset(state.project, opening, deriveWalls(state.project), desired);
      if (clamped !== null) opening.offset = clamped;
      else toast('Сюда проём не помещается');
    });
  };
  if (leftGap !== null) panel.querySelector('#gapL').addEventListener('change', setByGap(true));
  if (rightGap !== null) panel.querySelector('#gapR').addEventListener('change', setByGap(false));
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

// Расчёт лестницы по высоте этажа и длине марша (как калькулятор в Revit).
function stairCalc(item) {
  const floorH = item.floorHeight || 3000;
  const run = item.h; // длина марша (глубина предмета)
  const idealRiser = 170; // комфортный подступенок
  const risers = Math.max(2, Math.round(floorH / idealRiser));
  const riserH = floorH / risers;
  const treads = risers - 1; // проступей на один меньше подступенков
  const treadD = treads > 0 ? run / treads : run;
  // Правило удобства: 2·подступенок + проступь ≈ 600–640 мм.
  const comfort = 2 * riserH + treadD;
  const neededRun = treads * 280; // при проступи 280 мм
  const okRiser = riserH >= 150 && riserH <= 190;
  const okTread = treadD >= 230 && treadD <= 340;
  return { floorH, run, risers, riserH, treads, treadD, comfort, neededRun, okRiser, okTread };
}

function renderItemProps(panel, item) {
  if (!item) { renderProjectProps(panel); return; }
  const isStairs = item.kind === 'stairs';
  let stairsBlock = '';
  if (isStairs) {
    const c = stairCalc(item);
    const diff = Math.round(c.neededRun - c.run);
    const diffText = Math.abs(diff) < 50 ? 'длина марша оптимальна'
      : diff > 0 ? `марш короче нужного на ${diff} мм — добавьте длину` : `марш длиннее нужного на ${-diff} мм`;
    stairsBlock = `
      <h3>Расчёт лестницы</h3>
      <div class="prop-block">
        <label class="prop-field"><span>Высота этажа, мм</span>
          <input id="floorH" type="number" step="50" min="2000" value="${c.floorH}"></label>
        <div class="prop-row"><span>Подступенков</span><strong>${c.risers}</strong></div>
        <div class="prop-row"><span>Проступей</span><strong>${c.treads}</strong></div>
        <div class="prop-row"><span>Высота ступени</span><strong class="${c.okRiser ? '' : 'bad'}">${Math.round(c.riserH)} мм</strong></div>
        <div class="prop-row"><span>Глубина проступи</span><strong class="${c.okTread ? '' : 'bad'}">${Math.round(c.treadD)} мм</strong></div>
        <div class="prop-row"><span>Формула удобства</span><strong>${Math.round(c.comfort)} мм</strong></div>
        <p class="empty-hint">${diffText}. Комфортно: ступень 150–190, проступь 230–340, формула 600–640 мм.</p>
      </div>`;
  }
  panel.innerHTML = `
    <h2>${itemTitle(item.kind)}</h2>
    <p class="subtitle">${isStairs ? 'Длина предмета = длина марша; тяните углы или меняйте ниже' : 'Свободный объект: перетаскивается куда угодно, едет вместе с комнатой'}</p>
    <div class="prop-block">
      <div class="prop-grid">
        <label class="prop-field"><span>Ширина, мм</span><input id="itemW" type="number" step="50" min="200" value="${item.w}"></label>
        <label class="prop-field"><span>${isStairs ? 'Длина марша, мм' : 'Глубина, мм'}</span><input id="itemH" type="number" step="50" min="200" value="${item.h}"></label>
      </div>
      <div class="prop-row"><span>Поворот</span><strong>${item.rotation || 0}°</strong></div>
    </div>
    ${stairsBlock}
    <div class="prop-actions">
      <button id="rotateItem">Повернуть на 90° (R)</button>
      <button id="deleteItem" class="danger">Удалить</button>
    </div>`;
  const applySize = () => {
    const w = Math.max(200, Number(panel.querySelector('#itemW').value) || item.w);
    const h = Math.max(200, Number(panel.querySelector('#itemH').value) || item.h);
    mutate(() => { item.w = w; item.h = h; });
    if (isStairs) selectObject({ type: 'item', id: item.id });
  };
  panel.querySelector('#itemW').addEventListener('change', applySize);
  panel.querySelector('#itemH').addEventListener('change', applySize);
  const fh = panel.querySelector('#floorH');
  if (fh) fh.addEventListener('change', (e) => {
    mutate(() => { item.floorHeight = Math.max(2000, Number(e.target.value) || 3000); });
    selectObject({ type: 'item', id: item.id });
  });
  panel.querySelector('#rotateItem').addEventListener('click', rotateSelectedItem);
  panel.querySelector('#deleteItem').addEventListener('click', deleteSelection);
}

function renderMultiProps(panel, sel) {
  const items = sel.itemIds.map((id) => state.project.items.find((i) => i.id === id)).filter(Boolean);
  const groups = new Set(items.map((i) => i.group).filter(Boolean));
  const grouped = items.length >= 2 && groups.size === 1 && items.every((i) => i.group) && groups.size;
  panel.innerHTML = `
    <h2>Выделено</h2>
    <div class="prop-block">
      <div class="prop-row"><span>Комнат</span><strong>${sel.roomIds.length}</strong></div>
      <div class="prop-row"><span>Мебели</span><strong>${sel.itemIds.length}</strong></div>
    </div>
    <p class="empty-hint">Shift-клик добавляет/убирает объект. Перетащите любой — поедут все. R — повернуть мебель группой на 90°. Del — удалить.</p>
    <div class="prop-actions">
      ${items.length >= 2 ? `<button id="rotateMulti">Повернуть мебель на 90° (R)</button>` : ''}
      ${items.length >= 2 && !grouped ? `<button id="groupBtn">Объединить в группу</button>` : ''}
      ${grouped ? `<button id="ungroupBtn">Разгруппировать</button>` : ''}
      <button id="deleteMulti" class="danger">Удалить выделенное</button>
    </div>`;
  const rot = panel.querySelector('#rotateMulti');
  if (rot) rot.addEventListener('click', rotateMulti90);
  const groupBtn = panel.querySelector('#groupBtn');
  if (groupBtn) groupBtn.addEventListener('click', () => {
    const gid = `grp-${Date.now().toString(36)}`;
    mutate(() => { for (const i of items) i.group = gid; });
    selectObject(sel);
    toast('Мебель объединена в группу — клик по любому выделит всю группу');
  });
  const ungroupBtn = panel.querySelector('#ungroupBtn');
  if (ungroupBtn) ungroupBtn.addEventListener('click', () => {
    mutate(() => { for (const i of items) delete i.group; });
    selectObject(sel);
    toast('Группа расформирована');
  });
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
      <button id="importUnderlay" class="primary-inline" style="width:100%">📁 ${site.underlay ? 'Заменить топосъёмку' : 'Импортировать топосъёмку'}</button>
      <p class="empty-hint">PDF · JPG · PNG · DXF. DWG — сохраните из CAD как DXF.</p>
    </div>
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

  panel.querySelector('#importUnderlay').addEventListener('click', () => refs.underlayInput.click());
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
      <p class="empty-hint">Тяните квадраты по углам — масштаб, круглые ручки снаружи углов — поворот (шаг 5°, с Shift — 15°). Вокруг дома держится отступ ${(site.setbackNeighbor / 1000).toLocaleString('ru-RU')} м (красная штриховка).</p>
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
        <label class="prop-field"><span>Поворот, °</span>
          <input id="uRot" type="number" step="1" value="${Math.round(u.rot || 0)}"></label>
        <label class="prop-field"><span>Прозрачность</span>
          <input id="uOpacity" type="range" min="0.1" max="1" step="0.05" value="${u.opacity}"></label>
        <label class="check-row"><input type="checkbox" id="uLocked" ${u.locked ? 'checked' : ''}><span>Закрепить (не двигать и не масштабировать мышью)</span></label>
        <p class="empty-hint">Поворот также тянется круглыми ручками у углов картинки.</p>
      </div>
      <div class="prop-actions">
        <button id="replaceUnderlay">📁 Заменить файл</button>
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
    panel.querySelector('#uRot').addEventListener('change', (e) => {
      const deg = Number(e.target.value);
      if (Number.isNaN(deg)) return;
      mutate(() => { u.rot = ((deg % 360) + 360) % 360; });
      selectObject(sel);
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
    panel.querySelector('#replaceUnderlay').addEventListener('click', () => refs.underlayInput.click());
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
    bar.title = '';
  } else {
    bar.hidden = false;
    bar.className = 'status-strip warn';
    const text = `⚠ ${problems.join(' · ')}`;
    bar.textContent = problems.length > 1 ? `⚠ ${problems.length}: ${problems[0]}…` : text;
    bar.title = problems.join('\n'); // полный список по наведению
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
  refs.libraryTitle.hidden = true;
  refs.libraryTitle.textContent = 'Помещения';
  state.libraryTab = 'rooms';
  applyLibraryTab();
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
refs.libTabRooms.addEventListener('click', () => { state.libraryTab = 'rooms'; applyLibraryTab(); });
refs.libTabFurniture.addEventListener('click', () => { state.libraryTab = 'furniture'; applyLibraryTab(); });
el('undoBtn').addEventListener('click', undo);
el('redoBtn').addEventListener('click', redo);
el('fitBtn').addEventListener('click', fitView);
el('alignBtn').addEventListener('click', () => {
  const site = state.project.site;
  if (!site?.underlay && !(site?.boundary?.length)) { toast('Сначала загрузите топосъёмку или начертите границу участка (режим «Участок»)', true); return; }
  if (state.project.planSiteRot) {
    // Уже повёрнуто — повторный клик сбрасывает выравнивание.
    mutate(() => { state.project.planSiteRot = 0; });
    toast('Выравнивание сброшено');
    return;
  }
  setTool({ kind: 'align-underlay', points: [] }, 'Кликните две точки вдоль ровной линии участка (например, длинный край) — показ участка повернётся так, чтобы строить дом ровно');
});
function updateDimModeBtn() {
  const outer = state.project?.settings?.dimOuter !== false;
  const b = el('dimModeBtn');
  if (!b) return;
  b.textContent = outer ? '⟺ Снаружи' : '⟺ По оси';
  b.classList.toggle('active', outer);
}
el('dimModeBtn').addEventListener('click', () => {
  const cur = state.project.settings.dimOuter !== false;
  tweak(() => { state.project.settings.dimOuter = !cur; });
  updateDimModeBtn();
  toast(cur ? 'Наружные размеры — по оси стен' : 'Наружные размеры — по внешней грани');
});
el('zoomInBtn').addEventListener('click', () => zoomAt({ x: canvas.clientWidth / 2, y: canvas.clientHeight / 2 }, 1.25));
el('zoomOutBtn').addEventListener('click', () => zoomAt({ x: canvas.clientWidth / 2, y: canvas.clientHeight / 2 }, 0.8));
el('dimInputField').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); applyDimInput(); }
  else if (e.key === 'Escape') { e.preventDefault(); hideDimInput(); }
});
el('wallAddDoor').addEventListener('click', () => {
  if (state.selection?.type === 'wall') startPlaceOpening('door', { key: state.selection.key, from: state.selection.from });
});
el('wallAddWindow').addEventListener('click', () => {
  if (el('wallAddWindow').disabled) return;
  if (state.selection?.type === 'wall') startPlaceOpening('window', { key: state.selection.key, from: state.selection.from });
});
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
  renderFurnitureBar();
  applyLibraryTab();
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
  select: (sel) => selectObject(sel),
  openingCenter: (id) => {
    const o = state.project.openings.find((x) => x.id === id);
    if (!o) return null;
    const p = openingRect(state.project, o, state.walls);
    return p ? { x: p.rect.x + p.rect.w / 2, y: p.rect.y + p.rect.h / 2 } : null;
  },
  openingRectOf: (id) => {
    const o = state.project.openings.find((x) => x.id === id);
    if (!o) return null;
    const p = openingRect(state.project, o, state.walls);
    if (!p) return null;
    return { rect: p.rect, band: p.wall.band, thickness: p.wall.thickness, kind: p.wall.kind };
  },
};
