// Kepler Plan — редактор архитектурных концепций частных домов.
// Сборка плана из готовых блоков-помещений, автоматическая меблировка,
// умные общие стены, анализ связности, экспорт JSON/DXF.

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
  roomNetAreaM2, totalAreaM2, analyzeConnectivity, suggestAccess,
  rectsOverlap, nestedOuterRect, MIN_ROOM_SIZE,
} from './core/rooms.js';
import { refurnishRoom, itemRect, itemTitle } from './core/furnish.js';
import { buildStructuredExport, buildProjectDxf } from './core/export.js';
import { createRenderer, roomHandles, HANDLE_SIZE } from './render.js';

const AUTOSAVE_KEY = 'kepler-plan-autosave';

// ---------------------------------------------------------------- Состояние

const canvas = document.getElementById('canvas');
const renderer = createRenderer(canvas);

const state = {
  project: null,
  walls: [],
  view: { scale: 0.08, panX: 80, panY: 80 },
  selection: null, // {type:'room'|'wall'|'opening'|'item', ...}
  hover: null,
  mode: { kind: 'idle' },
  ghost: null,
  ghostOpening: null,
  guides: [],
  rejected: new Map(), // roomId -> [{kind,title,reason}]
};

const history = { undo: [], redo: [] };
let autosaveTimer = null;
let drawQueued = false;

// ---------------------------------------------------------------- DOM

const el = (id) => document.getElementById(id);
const refs = {
  projectName: el('projectName'),
  roomCards: el('roomCards'),
  props: el('propsPanel'),
  hint: el('canvasHint'),
  statusCursor: el('cursorPos'),
  statusScale: el('scaleInfo'),
  connectivity: el('connectivityBar'),
  toast: el('toast'),
  fileInput: el('fileInput'),
  exportDropdown: el('exportDropdown'),
};

// ---------------------------------------------------------------- Утилиты

function screenToWorld(sx, sy) {
  return { x: (sx - state.view.panX) / state.view.scale, y: (sy - state.view.panY) / state.view.scale };
}

function worldToScreen(x, y) {
  return { x: x * state.view.scale + state.view.panX, y: y * state.view.scale + state.view.panY };
}

function pointerWorld(event) {
  const rect = canvas.getBoundingClientRect();
  return screenToWorld(event.clientX - rect.left, event.clientY - rect.top);
}

function pointerScreen(event) {
  const rect = canvas.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
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
  if (history.undo.length > 60) history.undo.shift();
  history.redo.length = 0;
  scheduleAutosave();
}

function mutate(fn, { refurnish = [], skipHistory = false } = {}) {
  const before = snapshot();
  fn();
  refreshDerived();
  for (const roomId of new Set(refurnish)) {
    const room = roomById(state.project, roomId);
    if (room) state.rejected.set(roomId, refurnishRoom(state.project, room, state.walls, createItem));
  }
  if (refurnish.length) refreshDerived();
  if (!skipHistory) pushHistory(before);
  afterChange();
}

function afterChange() {
  updateConnectivity();
  renderProps();
  requestDraw();
  scheduleAutosave();
}

function scheduleAutosave() {
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => {
    try { localStorage.setItem(AUTOSAVE_KEY, serializeProject(state.project)); } catch { /* приватный режим */ }
  }, 400);
}

function undo() {
  if (!history.undo.length) return;
  history.redo.push(snapshot());
  state.project = deserializeProject(history.undo.pop());
  state.selection = null;
  refreshDerived();
  afterChange();
}

function redo() {
  if (!history.redo.length) return;
  history.undo.push(snapshot());
  state.project = deserializeProject(history.redo.pop());
  state.selection = null;
  refreshDerived();
  afterChange();
}

// Проёмы, оставшиеся без стены (после перемещений), прижимаются или удаляются.
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

// ---------------------------------------------------------------- Поиск объектов под курсором

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
  // Вложенные комнаты проверяются раньше родителей.
  const nested = state.project.rooms.filter((r) => r.parentId);
  const top = state.project.rooms.filter((r) => !r.parentId);
  for (const room of [...nested, ...top]) {
    if (world.x >= room.x && world.x <= room.x + room.w && world.y >= room.y && world.y <= room.y + room.h) {
      return room;
    }
  }
  return null;
}

function findWall(key, from) {
  return state.walls.find((w) => w.key === key && (from === undefined || Math.abs(w.from - from) < 1)) || null;
}

// Ближайшая стена к точке (для размещения проёмов).
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

// ---------------------------------------------------------------- Действия

function selectObject(selection) {
  state.selection = selection;
  renderProps();
  requestDraw();
}

function startPlaceRoom(type) {
  state.mode = { kind: 'place-room', type };
  state.selection = null;
  setHint(`Кликните на плане, чтобы разместить «${roomType(type).title}» · Esc — отмена`);
  renderLibrary();
  renderProps();
}

function startPlaceOpening(openKind, presetWall = null) {
  state.mode = { kind: 'place-opening', openKind, presetWall };
  setHint(openKind === 'door'
    ? 'Кликните по стене, чтобы добавить дверь · Esc — отмена'
    : 'Кликните по наружной стене, чтобы добавить окно · Esc — отмена');
  requestDraw();
}

function cancelMode() {
  state.mode = { kind: 'idle' };
  state.ghost = null;
  state.ghostOpening = null;
  state.guides = [];
  setHint('');
  renderLibrary();
  requestDraw();
}

function placeRoomAt(world) {
  const def = roomType(state.mode.type);
  const w = def.w;
  const h = def.h;
  let x = world.x - w / 2;
  let y = world.y - h / 2;
  const parentId = determineParent(state.project, { x, y, w, h }, null);
  const probe = { id: '__ghost__', w, h };
  const snapped = snapRoomPosition(state.project, probe, x, y, 14 / state.view.scale, parentId);
  x = snapped.x; y = snapped.y;
  const candidate = { x, y, w, h, parentId };
  const verdict = validateRoomPlacement(state.project, candidate, null);
  if (!verdict.ok) {
    toast(verdict.reason, true);
    return;
  }
  const room = createRoom(state.mode.type, x, y, w, h);
  room.parentId = parentId;
  // Уникальное имя: Спальня, Спальня 2, ...
  const sameType = state.project.rooms.filter((r) => r.type === room.type).length;
  if (sameType > 0) room.name = `${def.title} ${sameType + 1}`;
  mutate(() => { state.project.rooms.push(room); }, { refurnish: [room.id, parentId].filter(Boolean) });
  cancelMode();
  selectObject({ type: 'room', id: room.id });
  if (parentId) toast(`«${room.name}» вложена в «${roomById(state.project, parentId).name}»`);
}

function placeOpeningAt(world) {
  const openKind = state.mode.openKind;
  const wall = state.mode.presetWall ? findWall(state.mode.presetWall.key, state.mode.presetWall.from) : nearestWall(world);
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
  const walls = state.walls;
  const clamped = clampOpeningOffset(state.project, opening, walls, desired);
  if (clamped === null) { toast('На этом участке стены проём не помещается'); return; }
  opening.offset = clamped;
  const affected = [roomId];
  if (wall.kind === 'shared') affected.push(wall.rooms[1]);
  if (room.parentId) affected.push(room.parentId);
  mutate(() => { state.project.openings.push(opening); }, { refurnish: affected });
  cancelMode();
  selectObject({ type: 'opening', id: opening.id });
}

function deleteSelection() {
  const sel = state.selection;
  if (!sel) return;
  if (sel.type === 'room') {
    const room = roomById(state.project, sel.id);
    if (!room) return;
    const parentId = room.parentId;
    mutate(() => { removeRoom(state.project, sel.id); reconcileOpenings(); },
      { refurnish: parentId ? [parentId] : [] });
    state.selection = null;
    toast(`«${room.name}» удалена`);
  } else if (sel.type === 'opening') {
    const opening = state.project.openings.find((o) => o.id === sel.id);
    if (!opening) return;
    const affected = openingAffectedRooms(opening);
    mutate(() => {
      state.project.openings = state.project.openings.filter((o) => o.id !== sel.id);
    }, { refurnish: affected });
    state.selection = null;
  } else if (sel.type === 'item') {
    const item = state.project.items.find((i) => i.id === sel.id);
    if (!item) return;
    const room = roomById(state.project, item.roomId);
    mutate(() => {
      state.project.items = state.project.items.filter((i) => i.id !== sel.id);
      if (room && room.checklist[item.kind] !== undefined && item.auto) room.checklist[item.kind] = false;
    });
    state.selection = null;
    if (item.auto && room) toast(`«${itemTitle(item.kind)}» снята с галочки в «${room.name}»`);
  }
  renderProps();
  requestDraw();
}

function openingAffectedRooms(opening) {
  const placed = openingRect(state.project, opening, state.walls);
  const affected = [opening.roomId];
  const room = roomById(state.project, opening.roomId);
  if (room?.parentId) affected.push(room.parentId);
  if (placed?.wall.kind === 'shared') affected.push(...placed.wall.rooms);
  return affected;
}

function rotateSelectedItem() {
  if (state.selection?.type !== 'item') return;
  const item = state.project.items.find((i) => i.id === state.selection.id);
  if (!item) return;
  const next = ((item.rotation || 0) + 90) % 360;
  const rect = { ...itemRect({ ...item, rotation: next }) };
  const verdict = validateItemRect(item, rect);
  if (!verdict.ok) { toast(verdict.reason); return; }
  mutate(() => { item.rotation = next; item.auto = false; });
}

function validateItemRect(item, rect) {
  const room = roomById(state.project, item.roomId);
  if (!room) return { ok: false, reason: 'Комната не найдена' };
  const inner = { x: room.x, y: room.y, w: room.w, h: room.h };
  if (rect.x < inner.x - 1 || rect.y < inner.y - 1 ||
    rect.x + rect.w > inner.x + inner.w + 1 || rect.y + rect.h > inner.y + inner.h + 1) {
    return { ok: false, reason: `«${itemTitle(item.kind)}» выходит за пределы комнаты` };
  }
  for (const other of state.project.items) {
    if (other.id === item.id || other.roomId !== item.roomId) continue;
    if (rectsOverlap(rect, itemRect(other))) {
      return { ok: false, reason: `Пересекается с «${itemTitle(other.kind)}»` };
    }
  }
  for (const child of state.project.rooms) {
    if (child.parentId !== item.roomId) continue;
    if (rectsOverlap(rect, nestedOuterRect(child))) {
      return { ok: false, reason: `Пересекается с «${child.name}»` };
    }
  }
  return { ok: true };
}

// ---------------------------------------------------------------- Ввод мыши

let drag = null; // активное перетаскивание

canvas.addEventListener('pointerdown', (event) => {
  if (event.button === 1 || event.button === 2) {
    drag = { kind: 'pan', start: pointerScreen(event), view: { ...state.view } };
    canvas.setPointerCapture(event.pointerId);
    return;
  }
  const screen = pointerScreen(event);
  const world = pointerWorld(event);
  canvas.setPointerCapture(event.pointerId);

  if (state.mode.kind === 'place-room') { placeRoomAt(world); return; }
  if (state.mode.kind === 'place-opening') { placeOpeningAt(world); return; }

  const handleHit = hitRoomHandle(screen);
  if (handleHit) {
    drag = {
      kind: 'resize', roomId: handleHit.room.id, handle: handleHit.handle,
      start: { ...handleHit.room }, before: snapshot(), world,
      valid: true,
    };
    return;
  }

  const item = hitItem(world);
  if (item) {
    selectObject({ type: 'item', id: item.id });
    drag = { kind: 'item', id: item.id, start: { x: item.x, y: item.y }, world, before: snapshot(), moved: false, valid: true };
    return;
  }

  const opening = hitOpening(world);
  if (opening) {
    selectObject({ type: 'opening', id: opening.id });
    drag = { kind: 'opening', id: opening.id, before: snapshot(), startOffset: opening.offset, moved: false };
    return;
  }

  const wall = hitWall(world);
  if (wall) {
    selectObject({ type: 'wall', key: wall.key, from: wall.from });
    drag = null;
    return;
  }

  const room = hitRoom(world);
  if (room) {
    selectObject({ type: 'room', id: room.id });
    drag = {
      kind: 'room', id: room.id, world, start: { x: room.x, y: room.y },
      before: snapshot(), moved: false, valid: true,
    };
    return;
  }

  selectObject(null);
  drag = { kind: 'pan', start: screen, view: { ...state.view } };
});

canvas.addEventListener('pointermove', (event) => {
  const screen = pointerScreen(event);
  const world = pointerWorld(event);
  refs.statusCursor.textContent = `${(world.x / 1000).toFixed(2)}; ${(world.y / 1000).toFixed(2)} м`;

  if (!drag) {
    updateHoverAndGhost(world);
    return;
  }

  if (drag.kind === 'pan') {
    state.view.panX = drag.view.panX + (screen.x - drag.start.x);
    state.view.panY = drag.view.panY + (screen.y - drag.start.y);
    requestDraw();
    return;
  }

  if (drag.kind === 'room') {
    const room = roomById(state.project, drag.id);
    if (!room) return;
    drag.moved = true;
    const rawX = drag.start.x + (world.x - drag.world.x);
    const rawY = drag.start.y + (world.y - drag.world.y);
    const snapped = snapRoomPosition(state.project, room, rawX, rawY, 14 / state.view.scale, room.parentId);
    const dx = snapped.x - room.x;
    const dy = snapped.y - room.y;
    moveRoomBy(state.project, room.id, dx, dy);
    state.guides = snapped.guides;
    const verdict = validateRoomPlacement(state.project, room, room.id);
    drag.valid = verdict.ok;
    drag.reason = verdict.reason;
    state.ghost = { rect: { x: room.x, y: room.y, w: room.w, h: room.h }, valid: verdict.ok, label: ' ', reason: verdict.ok ? '' : verdict.reason };
    refreshDerived();
    requestDraw();
    return;
  }

  if (drag.kind === 'resize') {
    const room = roomById(state.project, drag.id || drag.roomId);
    if (!room) return;
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
    const verdict = validateItemRect(item, itemRect(item));
    drag.valid = verdict.ok;
    drag.reason = verdict.reason;
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
  }
});

canvas.addEventListener('pointerup', (event) => {
  if (!drag) return;
  const finished = drag;
  drag = null;
  state.guides = [];

  if (finished.kind === 'pan') { requestDraw(); return; }

  if (finished.kind === 'room' || finished.kind === 'resize') {
    const room = roomById(state.project, finished.id || finished.roomId);
    state.ghost = null;
    if (!finished.moved && finished.kind === 'room') { requestDraw(); return; }
    if (!finished.valid) {
      state.project = deserializeProject(finished.before);
      refreshDerived();
      toast(finished.reason || 'Так разместить нельзя', true);
      afterChange();
      return;
    }
    reconcileOpenings();
    refreshDerived();
    const refurnish = finished.kind === 'resize' && room ? [room.id] : [];
    for (const roomId of refurnish) {
      const target = roomById(state.project, roomId);
      if (target) state.rejected.set(roomId, refurnishRoom(state.project, target, state.walls, createItem));
    }
    refreshDerived();
    pushHistory(finished.before);
    afterChange();
    return;
  }

  if (finished.kind === 'item') {
    const item = state.project.items.find((i) => i.id === finished.id);
    if (!finished.moved || !item) { requestDraw(); return; }
    if (!finished.valid) {
      state.project = deserializeProject(finished.before);
      refreshDerived();
      toast(finished.reason || 'Мебель так поставить нельзя');
      afterChange();
      return;
    }
    item.auto = false; // предмет закреплён вручную
    pushHistory(finished.before);
    afterChange();
    return;
  }

  if (finished.kind === 'opening') {
    if (!finished.moved) { requestDraw(); return; }
    const opening = state.project.openings.find((o) => o.id === finished.id);
    if (opening) {
      const affected = openingAffectedRooms(opening);
      for (const roomId of new Set(affected)) {
        const room = roomById(state.project, roomId);
        if (room) state.rejected.set(roomId, refurnishRoom(state.project, room, state.walls, createItem));
      }
      refreshDerived();
    }
    pushHistory(finished.before);
    afterChange();
  }
});

canvas.addEventListener('wheel', (event) => {
  event.preventDefault();
  const screen = pointerScreen(event);
  const factor = event.deltaY < 0 ? 1.12 : 1 / 1.12;
  zoomAt(screen, factor);
}, { passive: false });

function zoomAt(screen, factor) {
  const world = screenToWorld(screen.x, screen.y);
  state.view.scale = Math.min(0.6, Math.max(0.008, state.view.scale * factor));
  state.view.panX = screen.x - world.x * state.view.scale;
  state.view.panY = screen.y - world.y * state.view.scale;
  refs.statusScale.textContent = scaleLabel();
  requestDraw();
}

function scaleLabel() {
  // 1 мм модели = scale px; масштаб ~ 1:(3.78/scale) при 96 dpi.
  const denominator = Math.round(96 / 25.4 / state.view.scale);
  return `≈ 1:${denominator}`;
}

function updateHoverAndGhost(world) {
  if (state.mode.kind === 'place-room') {
    const def = roomType(state.mode.type);
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
  if (state.mode.kind === 'place-opening') {
    const wall = nearestWall(world);
    state.ghostOpening = null;
    if (wall) {
      const width = state.mode.openKind === 'door' ? DOOR_WIDTH : WINDOW_WIDTH;
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
  // Подсветка стены под курсором.
  const wall = hitItem(world) || hitOpening(world) ? null : hitWall(world);
  const nextHover = wall ? { type: 'wall', key: wall.key, from: wall.from } : null;
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
  // Вложенные помещения должны остаться внутри.
  for (const child of state.project.rooms) {
    if (child.parentId !== room.id) continue;
    const childVerdict = validateRoomPlacement(state.project, child, child.id);
    if (!childVerdict.ok) return { ok: false, reason: `«${child.name}» перестаёт помещаться: ${childVerdict.reason}` };
  }
  return { ok: true };
}

// ---------------------------------------------------------------- Клавиатура

window.addEventListener('keydown', (event) => {
  const tag = event.target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
  if ((event.ctrlKey || event.metaKey) && event.code === 'KeyZ') {
    event.preventDefault();
    if (event.shiftKey) redo(); else undo();
    return;
  }
  if ((event.ctrlKey || event.metaKey) && event.code === 'KeyY') { event.preventDefault(); redo(); return; }
  if (event.key === 'Escape') { cancelMode(); selectObject(null); return; }
  if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); deleteSelection(); return; }
  if (event.code === 'KeyR') { rotateSelectedItem(); return; }
  // Стрелки: сдвиг выбранной комнаты или мебели.
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
      if (!verdict.ok) { state.project = deserializeProject(before); toast(verdict.reason); refreshDerived(); requestDraw(); return; }
      reconcileOpenings();
      refreshDerived();
      pushHistory(before);
      afterChange();
    } else if (state.selection.type === 'item') {
      const item = state.project.items.find((i) => i.id === state.selection.id);
      if (!item) return;
      const before = snapshot();
      item.x += dx; item.y += dy;
      const verdict = validateItemRect(item, itemRect(item));
      if (!verdict.ok) { state.project = deserializeProject(before); toast(verdict.reason); requestDraw(); return; }
      item.auto = false;
      pushHistory(before);
      afterChange();
    }
  }
});

// ---------------------------------------------------------------- Панель библиотеки

function renderLibrary() {
  refs.roomCards.innerHTML = '';
  for (const def of ROOM_TYPES) {
    const card = document.createElement('button');
    card.className = 'room-card';
    if (state.mode.kind === 'place-room' && state.mode.type === def.type) card.classList.add('active');
    card.innerHTML = `
      <span class="room-card-name">${def.title}</span>
      <span class="room-card-size">${(def.w / 1000).toFixed(1)} × ${(def.h / 1000).toFixed(1)} м</span>`;
    card.addEventListener('click', () => {
      if (state.mode.kind === 'place-room' && state.mode.type === def.type) cancelMode();
      else startPlaceRoom(def.type);
    });
    refs.roomCards.appendChild(card);
  }
}

// ---------------------------------------------------------------- Панель свойств

function renderProps() {
  const sel = state.selection;
  const panel = refs.props;
  if (!sel) { renderProjectProps(panel); return; }
  if (sel.type === 'room') { renderRoomProps(panel, roomById(state.project, sel.id)); return; }
  if (sel.type === 'wall') { renderWallProps(panel, findWall(sel.key, sel.from)); return; }
  if (sel.type === 'opening') { renderOpeningProps(panel, state.project.openings.find((o) => o.id === sel.id)); return; }
  if (sel.type === 'item') { renderItemProps(panel, state.project.items.find((i) => i.id === sel.id)); return; }
  renderProjectProps(panel);
}

function renderProjectProps(panel) {
  const rooms = state.project.rooms;
  const list = rooms.map((r) => {
    const area = roomNetAreaM2(state.project, r).toFixed(1);
    const nested = r.parentId ? ' ↳ ' : '';
    return `<li><button class="link" data-room="${r.id}">${nested}${r.name}</button><span>${area} м²</span></li>`;
  }).join('');
  panel.innerHTML = `
    <h2>Проект</h2>
    <div class="prop-block">
      <div class="prop-row"><span>Помещений</span><strong>${rooms.length}</strong></div>
      <div class="prop-row"><span>Общая площадь</span><strong>${totalAreaM2(state.project).toFixed(1)} м²</strong></div>
    </div>
    ${rooms.length ? `<h3>Состав</h3><ul class="room-list">${list}</ul>` : `
    <p class="empty-hint">Выберите тип помещения слева и кликните на плане. Комнаты стыкуются автоматически — общая стена становится единой.</p>`}
    <h3>Управление</h3>
    <ul class="hotkeys">
      <li><b>Колесо</b> — масштаб, <b>пустое место</b> — панорама</li>
      <li><b>Перетаскивание</b> — перемещение комнат и мебели</li>
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
  const checklistHtml = (def?.furniture || []).map((entry) => {
    const fd = furnitureDef(entry.kind);
    const checked = room.checklist?.[entry.kind] ? 'checked' : '';
    return `<label class="check-row"><input type="checkbox" data-kind="${entry.kind}" ${checked}>
      <span>${fd.title}</span><em>${fd.w}×${fd.h}</em></label>`;
  }).join('');
  const rejectedHtml = rejected.length
    ? `<div class="rejected"><h4>Не удалось расставить</h4>${rejected.map((r) => `<p>⚠ ${r.reason}</p>`).join('')}</div>`
    : '';

  panel.innerHTML = `
    <h2>${def?.title || 'Комната'}${parent ? `<span class="badge">внутри «${parent.name}»</span>` : ''}</h2>
    <div class="prop-block">
      <label class="prop-field"><span>Название</span><input id="roomName" value="${escapeHtml(room.name)}"></label>
      <div class="prop-grid">
        <label class="prop-field"><span>Ширина, мм</span><input id="roomW" type="number" step="50" min="${MIN_ROOM_SIZE}" value="${room.w}"></label>
        <label class="prop-field"><span>Глубина, мм</span><input id="roomH" type="number" step="50" min="${MIN_ROOM_SIZE}" value="${room.h}"></label>
      </div>
      <div class="prop-row"><span>Площадь (чистая)</span><strong>${roomNetAreaM2(state.project, room).toFixed(2)} м²</strong></div>
    </div>
    <h3>Мебель</h3>
    <div class="prop-block checklist">${checklistHtml || '<p class="empty-hint">Для этого типа нет набора мебели</p>'}</div>
    ${rejectedHtml}
    <div class="prop-actions">
      <button id="refurnishBtn">Расставить заново</button>
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
    state.rejected.set(room.id, refurnishRoom(state.project, room, state.walls, createItem));
    refreshDerived();
    pushHistory(before);
    afterChange();
  };
  panel.querySelector('#roomW').addEventListener('change', applySize);
  panel.querySelector('#roomH').addEventListener('change', applySize);
  panel.querySelectorAll('input[data-kind]').forEach((box) => {
    box.addEventListener('change', () => {
      mutate(() => { room.checklist[box.dataset.kind] = box.checked; }, { refurnish: [room.id] });
    });
  });
  panel.querySelector('#refurnishBtn').addEventListener('click', () => {
    mutate(() => {
      for (const item of state.project.items) if (item.roomId === room.id) item.auto = true;
    }, { refurnish: [room.id] });
    const rejected = state.rejected.get(room.id) || [];
    toast(rejected.length ? 'Расставлено, но есть замечания — смотрите панель' : 'Мебель расставлена заново');
  });
  panel.querySelector('#addDoorBtn').addEventListener('click', () => startPlaceOpening('door'));
  panel.querySelector('#addWindowBtn').addEventListener('click', () => startPlaceOpening('window'));
  panel.querySelector('#deleteRoomBtn').addEventListener('click', deleteSelection);
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
    // Толщина общей стены = зазор между комнатами: соседняя комната сдвигается.
    const delta = newT - wall.thickness;
    const mover = roomById(state.project, wall.rooms[1]);
    const dx = wall.orient === 'v' ? delta : 0;
    const dy = wall.orient === 'h' ? delta : 0;
    moveRoomBy(state.project, mover.id, dx, dy);
    const verdict = validateRoomPlacement(state.project, mover, mover.id);
    if (!verdict.ok) {
      state.project = deserializeProject(before);
      refreshDerived();
      toast(`Нельзя: ${verdict.reason}`, true);
      renderProps();
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
    <p class="subtitle">Стена «${room?.name}»</p>
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
    const affected = openingAffectedRooms(opening);
    mutate(fn, { refurnish: affected });
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
  const room = roomById(state.project, item.roomId);
  panel.innerHTML = `
    <h2>${itemTitle(item.kind)}</h2>
    <p class="subtitle">${room ? `В «${room.name}»` : ''} · ${item.auto ? 'расставлено автоматически' : 'закреплено вручную'}</p>
    <div class="prop-block">
      <div class="prop-grid">
        <label class="prop-field"><span>Ширина, мм</span><input id="itemW" type="number" step="50" min="200" value="${item.w}"></label>
        <label class="prop-field"><span>Глубина, мм</span><input id="itemH" type="number" step="50" min="200" value="${item.h}"></label>
      </div>
      <div class="prop-row"><span>Поворот</span><strong>${item.rotation || 0}°</strong></div>
    </div>
    <div class="prop-actions">
      <button id="rotateItem">Повернуть на 90° (R)</button>
      ${!item.auto ? '<button id="autoItem">Вернуть в авторасстановку</button>' : ''}
      <button id="deleteItem" class="danger">Удалить</button>
    </div>`;
  const applySize = () => {
    const w = Math.max(200, Number(panel.querySelector('#itemW').value) || item.w);
    const h = Math.max(200, Number(panel.querySelector('#itemH').value) || item.h);
    const before = snapshot();
    const old = { w: item.w, h: item.h };
    item.w = w; item.h = h;
    const verdict = validateItemRect(item, itemRect(item));
    if (!verdict.ok) { item.w = old.w; item.h = old.h; toast(verdict.reason); renderProps(); return; }
    item.auto = false;
    pushHistory(before);
    afterChange();
  };
  panel.querySelector('#itemW').addEventListener('change', applySize);
  panel.querySelector('#itemH').addEventListener('change', applySize);
  panel.querySelector('#rotateItem').addEventListener('click', rotateSelectedItem);
  panel.querySelector('#deleteItem').addEventListener('click', deleteSelection);
  const autoBtn = panel.querySelector('#autoItem');
  if (autoBtn) {
    autoBtn.addEventListener('click', () => {
      mutate(() => { item.auto = true; }, { refurnish: [item.roomId] });
    });
  }
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

function setHint(text) {
  refs.hint.textContent = text;
  refs.hint.hidden = !text;
}

// ---------------------------------------------------------------- Вид

function fitView() {
  const rooms = state.project.rooms;
  if (!rooms.length) {
    state.view = { scale: 0.08, panX: 120, panY: 120 };
    requestDraw();
    return;
  }
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  for (const room of rooms) {
    minX = Math.min(minX, room.x - 400);
    minY = Math.min(minY, room.y - 400);
    maxX = Math.max(maxX, room.x + room.w + 400);
    maxY = Math.max(maxY, room.y + room.h + 400);
  }
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  const scale = Math.min(0.6, Math.max(0.008, Math.min(width / (maxX - minX), height / (maxY - minY)) * 0.92));
  state.view.scale = scale;
  state.view.panX = (width - (maxX + minX) * scale) / 2;
  state.view.panY = (height - (maxY + minY) * scale) / 2;
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
    toast('Скачивание недоступно в этом окружении — используйте «Копировать JSON»', true);
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
      const project = deserializeProject(String(reader.result));
      const before = snapshot();
      state.project = project;
      state.selection = null;
      state.rejected.clear();
      refreshDerived();
      pushHistory(before);
      afterChange();
      fitView();
      refs.projectName.value = project.name;
      toast(`Открыт проект «${project.name}»`);
    } catch (error) {
      toast(`Не удалось открыть: ${error.message}`, true);
    }
  };
  reader.readAsText(file);
}

// ---------------------------------------------------------------- Пример

function buildSample() {
  const project = createProject('Дом · 1 этаж');
  const bedroom = createRoom('bedroom', 0, 0, 5000, 4000);
  bedroom.name = 'Спальня';
  const bath = createRoom('bathroom', 2900, 1900, 2000, 2000);
  bath.parentId = bedroom.id;
  bath.name = 'Санузел';
  const living = createRoom('living', 5100, 0, 5000, 4200);
  const kitchen = createRoom('kitchen', 5100, 4300, 3600, 3000);
  const hall = createRoom('hall', 0, 4100, 3000, 2400);
  project.rooms.push(bedroom, bath, living, kitchen, hall);

  project.openings.push(createOpening('door', hall.id, 2, 1500, 900)); // входная
  project.openings.push(createOpening('door', bedroom.id, 2, 1200, 800)); // спальня ↔ холл
  project.openings.push(createOpening('door', bedroom.id, 1, 700, 800)); // спальня ↔ гостиная
  project.openings.push(createOpening('door', bath.id, 0, 1000, 700)); // санузел ↔ спальня
  project.openings.push(createOpening('door', living.id, 2, 1800, 900)); // гостиная ↔ кухня
  project.openings.push(createOpening('window', bedroom.id, 0, 2500, 1500));
  project.openings.push(createOpening('window', living.id, 0, 2500, 1800));
  project.openings.push(createOpening('window', kitchen.id, 1, 1500, 1200));

  const walls = deriveWalls(project);
  const rejected = new Map();
  for (const room of project.rooms) {
    rejected.set(room.id, refurnishRoom(project, room, walls, createItem));
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
  if (before) pushHistory(before);
  refs.projectName.value = project.name;
  afterChange();
  fitView();
}

function newProject() {
  const before = snapshot();
  state.project = createProject();
  state.selection = null;
  state.rejected.clear();
  refreshDerived();
  pushHistory(before);
  refs.projectName.value = state.project.name;
  afterChange();
  fitView();
  toast('Новый проект. Старый можно вернуть через Ctrl+Z');
}

// ---------------------------------------------------------------- Шапка

el('undoBtn').addEventListener('click', undo);
el('redoBtn').addEventListener('click', redo);
el('fitBtn').addEventListener('click', fitView);
el('zoomInBtn').addEventListener('click', () => zoomAt({ x: canvas.clientWidth / 2, y: canvas.clientHeight / 2 }, 1.25));
el('zoomOutBtn').addEventListener('click', () => zoomAt({ x: canvas.clientWidth / 2, y: canvas.clientHeight / 2 }, 0.8));
el('sampleBtn').addEventListener('click', loadSample);
el('newBtn').addEventListener('click', newProject);
el('openBtn').addEventListener('click', () => refs.fileInput.click());
refs.fileInput.addEventListener('change', () => {
  if (refs.fileInput.files?.[0]) openProjectFile(refs.fileInput.files[0]);
  refs.fileInput.value = '';
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
window.matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => requestDraw());

// ---------------------------------------------------------------- Старт

(function boot() {
  let restored = null;
  try {
    const saved = localStorage.getItem(AUTOSAVE_KEY);
    if (saved) restored = deserializeProject(saved);
  } catch { /* нет сохранения */ }
  if (restored && restored.rooms.length) {
    state.project = restored;
    state.selection = null;
    refreshDerived();
    // Повторная меблировка не нужна — мебель в файле.
    refs.projectName.value = state.project.name;
    updateConnectivity();
    renderLibrary();
    renderProps();
    requestAnimationFrame(fitView);
  } else {
    state.project = createProject();
    const { project, rejected } = buildSample();
    state.project = project;
    state.rejected = rejected;
    refreshDerived();
    refs.projectName.value = project.name;
    updateConnectivity();
    renderLibrary();
    renderProps();
    requestAnimationFrame(fitView);
  }
  refs.statusScale.textContent = scaleLabel();
  requestDraw();
})();

// Отладочный доступ для автотестов (браузерный smoke-тест читает состояние).
window.__kepler = {
  state,
  worldToScreen,
  fitView,
  loadSample,
};
