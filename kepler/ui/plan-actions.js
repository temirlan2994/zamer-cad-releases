// Действия режима «План»: комнаты, проёмы, мебель, удаление, группы.

import { DOOR_WIDTH, GRID_STEP, WINDOW_WIDTH, furnitureDef, roomType } from '../core/catalog.js';
import { reclaimItemsFromChild } from '../core/furnish.js';
import { createItem, createOpening, createRoom, removeRoom, roomById } from '../core/model.js';
import {
  determineParent, moveRoomBy, rectsOverlap, snapRoomPosition, validateRoomPlacement,
} from '../core/rooms.js';
import { clampOpeningOffset, deriveWalls, sideEdge } from '../core/walls.js';
import { canvas, toast } from './dom.js';
import { findWall, nearestWall } from './hit.js';
import { renderProps } from './props.js';
import { state } from './state.js';
import {
  afterChange, mutate, pushHistory, refreshDerived, restoreFrom, snapshot,
} from './store.js';
import { cancelTool, selectObject } from './tools.js';
import { requestDraw, screenToWorld } from './view.js';

export function reconcileOpenings() {
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

export function placeRoomAt(world, typeOverride = null) {
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
    // Новая комната создаётся ПУСТОЙ — мебель пользователь добавляет сам из
    // панели «Мебель» (клик по карточке или перетаскиванием).
  }, { arrange: parentId ? [room.id, parentId] : [room.id] });
  cancelTool();
  selectObject({ type: 'room', id: room.id });
  if (parentId) toast(`«${room.name}» вложена в «${roomById(state.project, parentId).name}» и отнимает её площадь`);
  else if (verdict.warning) toast(`⚠ ${verdict.warning} — поставлено, проверьте отступы`, true);
}

// Расчёт параметров проёма под курсором: позиция, сторона открывания и петли
// зависят от того, с какой стороны стены и ближе к какому концу стоит мышь.
export function computeOpeningParams(world) {
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

export function placeOpeningAt(world) {
  const res = computeOpeningParams(world);
  if (!res) { toast('Кликните ближе к стене'); return; }
  if (res.error) { toast(res.error); return; }
  const { opening } = res;
  mutate(() => { state.project.openings.push(opening); });
  cancelTool();
  selectObject({ type: 'opening', id: opening.id });
}

export function addFurniture(kind, room) {
  const fd = furnitureDef(kind);
  if (!fd) return;
  const item = createItem(kind, Math.round((room.x + room.w / 2) / GRID_STEP) * GRID_STEP,
    Math.round((room.y + room.h / 2) / GRID_STEP) * GRID_STEP, fd.w, fd.h);
  mutate(() => { state.project.items.push(item); });
  selectObject({ type: 'item', id: item.id });
  toast(`«${fd.title}» в центре комнаты — перетащите на место`);
}

export function deleteSelection() {
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
export function overlappingTopRooms(room) {
  if (room.parentId) return [];
  const rect = { x: room.x, y: room.y, w: room.w, h: room.h };
  return state.project.rooms.filter((o) => o !== room && !o.parentId
    && rectsOverlap(rect, { x: o.x, y: o.y, w: o.w, h: o.h }));
}

// Переместить комнату в конец массива (поверх всех по z — она «съедает»).
export function bringRoomToTop(roomId) {
  const idx = state.project.rooms.findIndex((r) => r.id === roomId);
  if (idx < 0) return;
  const [room] = state.project.rooms.splice(idx, 1);
  state.project.rooms.push(room);
}

// Добавить/убрать объект в мультивыбор по Shift-клику.
export function toggleInMulti(kind, id) {
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
export function selectGroup(groupId) {
  const itemIds = state.project.items.filter((i) => i.group === groupId).map((i) => i.id);
  if (itemIds.length <= 1) { selectObject(itemIds.length ? { type: 'item', id: itemIds[0] } : null); return; }
  selectObject({ type: 'multi', roomIds: [], itemIds });
}

// Повернуть выбранную мебель группой на 90° вокруг общего центра.
export function rotateMulti90() {
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

export function rotateSelectedItem() {
  if (state.selection?.type !== 'item') return;
  const item = state.project.items.find((i) => i.id === state.selection.id);
  if (!item) return;
  mutate(() => { item.rotation = ((item.rotation || 0) + 90) % 360; });
}

// Добавляет предмет мебели в указанную мировую точку (центр предмета).
export function addFurnitureAt(kind, worldX, worldY) {
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

// Клик по карточке мебели: кладём в выбранную комнату (или центр экрана),
// каскадом — чтобы можно было быстро накликать много и потом растащить.
// Панель мебели при этом не перерисовывается, список остаётся на месте.
export function addFurnitureToSelection(kind) {
  const sel = state.selection;
  const room = sel?.type === 'room' ? roomById(state.project, sel.id)
    : sel?.type === 'item' ? containingRoom(state.project.items.find((i) => i.id === sel.id)) : null;
  let cx;
  let cy;
  if (room) { cx = room.x + room.w / 2; cy = room.y + room.h / 2; }
  else { const c = screenToWorld(canvas.clientWidth / 2, canvas.clientHeight / 2); cx = c.x; cy = c.y; }
  const k = state.project.items.length % 6; // каскад, чтобы не ложились стопкой
  addFurnitureAt(kind, cx + k * 180, cy + k * 180);
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

export function changeWallThickness(wall, newT) {
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

export function toggleOpeningFlip(kind) {
  const opening = state.project.openings.find((o) => o.id === state.selection.id);
  if (!opening) return;
  mutate(() => {
    if (kind === 'swing') opening.swingIn = !opening.swingIn;
    else opening.hingeStart = !opening.hingeStart;
  });
  selectObject({ type: 'opening', id: opening.id });
}
