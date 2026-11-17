// Действия режима «План»: комнаты, проёмы, мебель, удаление, группы.

import { applyOpeningPreset } from '../core/opening-preset.js';
import { DOOR_WIDTH, GRID_STEP, WINDOW_WIDTH, furnitureDef, gridStepForScale, isOpenRoom, roomType } from '../core/catalog.js';
import { itemsInRoom, reclaimItemsFromChild } from '../core/furnish.js';
import {
  activeLevel, createItem, createOpening, createRoom, levelProject, removeRoom, roomById,
} from '../core/model.js';
import { buildingContentCenter, toLocal, toWorld } from '../core/building.js';
import { buildingAlignedToView } from '../core/view-angles.js';
import { isFixedSizeComp, withDefaultComp } from '../core/composite.js';
import { editKitchen } from '../core/kitchen.js';
import { OPENING_GAP, fitOpeningOffset, resolveOpeningConflicts, snapOpeningOffset } from '../core/opening-spacing.js';
import { planRoomDuplicate } from '../core/duplicate-room.js';
import { findNearMissGaps, planGapMove } from '../core/gaps.js';
import { applyGapStretch, applyGapThicken, autoDockFix, planGapStretch, planGapThicken } from '../core/gap-fix.js';
import {
  captureRoomGroup, groupCargo, moveRoomGroup, planGroupCopy, rotateRoomGroup,
} from '../core/room-group.js';
import { roomContainsPoint } from '../core/room-shape.js';
import { eatSummary, liftRoom, nominalShape, reconcileEats, roomsIntersect } from '../core/v7/eat-bridge.js';
import {
  determineParent, snapRoomPosition, validateRoomPlacement,
} from '../core/rooms.js';
import {
  clampOpeningOffset, deriveWalls, openingPos, setOpeningPos, sideEdge,
} from '../core/walls.js';
import { manualWallById, removeManualWall, setManualWallThickness } from '../core/wall-manual.js';
import { applyStairPreset, applyStairStylePreset } from '../core/stairs.js';
import { bedsideNightstand, bedsideTarget, supportsBedsideNightstands } from '../core/bedside.js';
import { clampWallThickness, setSharedWallThickness, setWallKind, setWallSpan } from '../core/wall-thickness.js';
import { toast } from './dom.js';
import { findWall, nearestWall } from './hit.js';
import { renderProps } from './props.js';
import { openSplitInput } from './split-input.js';
import { state } from './state.js';
import {
  afterChange, mutate, parseProjectText, pushHistory, refreshDerived, reflowLayoutChanges, restoreFrom, snapshot,
} from './store.js';
import { cancelTool, selectObject } from './tools.js';
import { deleteSectionView } from './plan-section.js';
import { deleteSlab } from './slab-ui.js';
import { deleteSelectedRailing } from './railing-actions.js';
import { addMass, deleteMass, duplicateMass, massById, massVoids, masses, rotateMass } from './masses.js';
import { copyMass, createMassVoid } from '../core/masses.js';
import { deleteRoof } from './roofs.js';
import { deleteGrid } from './grids.js';
import { requestDraw } from './view.js';
import { arrangeRoomsNow } from './auto-layout.js';

// Проёмы после правки стен: прижать к краю укороченной стены и раздвинуть.
// Проём НЕ удаляется: если стены нет или на ней нет места, он остаётся в
// проекте «сиротой» (opening.orphan — не рисуется, замечание в «⚠») на
// прежнем месте и возвращается, как только стена снова есть.
export function reconcileOpenings() {
  const walls = deriveWalls(state.project);
  const wasOrphan = new Set(state.project.openings.filter((o) => o.orphan).map((o) => o.id));
  for (const opening of state.project.openings) {
    const clamped = clampOpeningOffset(state.project, opening, walls, openingPos(opening));
    if (clamped === null) {
      opening.orphan = true;
    } else {
      delete opening.orphan;
      setOpeningPos(opening, clamped);
    }
  }
  // Прижатые к краю (Б3) или вставленные проёмы не должны налезать друг на
  // друга: раздвигаем с зазором OPENING_GAP, не помещающиеся — в сироты.
  const spaced = resolveOpeningConflicts(state.project, walls, { keep: true });
  const lost = state.project.openings.filter((o) => o.orphan && !wasOrphan.has(o.id)).length;
  const back = [...wasOrphan].filter((id) => state.project.openings.some((o) => o.id === id && !o.orphan)).length;
  if (lost) toast(`Проёмов без места на стене: ${lost} — сохранены и вернутся вместе со стеной (см. «⚠»)`, true);
  else if (spaced.moved.length) toast(`Проёмы раздвинуты, чтобы не налезали друг на друга: ${spaced.moved.length}`);
  if (back) toast(`Проёмы вернулись на стену: ${back}`);
}

// «Разделить»: сначала плашка у стены — торец отсчёта и расстояние от него
// (по умолчанию — до точки клика от ближайшего торца). Enter вставляет две
// совпадающие вершины; уступ появляется, когда пользователь потянет половину.
export function splitSelectedWall() {
  const sel = state.selection;
  if (sel?.type !== 'wall') return;
  openSplitInput(findWall(sel.key, sel.from), sel.at);
}

export function toggleSelectedWallHidden() {
  const sel = state.selection;
  if (sel?.type !== 'wall') return;
  const wall = findWall(sel.key, sel.from);
  if (!wall || !['own', 'shared', 'manual'].includes(wall.kind)) return;
  const hidden = !wall.hidden;
  mutate(() => {
    if (wall.kind === 'manual') {
      const own = manualWallById(state.project, wall.wallId);
      if (own) own.hidden = hidden;
      return;
    }
    setWallSpan(state.project, wall, { hidden }); // только выделенный участок
  });
  selectObject({ ...sel });
  toast(hidden ? 'Стена скрыта · Ctrl+Z — вернуть' : 'Стена снова показана');
}

// Кадр будущего помещения: при повернутом пользовательском виде возвращает
// координаты и копию проекта уже в тех осях, которые применятся по клику.
// Используется и предпросмотром, и самой вставкой — поэтому призрак не меняет
// ориентацию в последний момент.
export function roomPlacementContext(at) {
  // Комнаты живут в единых локальных осях дома. Если пользователь повернул
  // сам вид «Плана», при вставке без отдельной команды подстраиваем под него
  // оси всего дома. Поворот и новая комната входят в одну Undo-операцию.
  // Точку курсора переводим через мир, поэтому помещение не «прыгает».
  const pivot = buildingContentCenter(state.project) || at;
  const alignedBuilding = state.modeName === 'plan'
    ? buildingAlignedToView(state.project, 'plan', pivot)
    : null;
  const placementAt = alignedBuilding
    ? toLocal(alignedBuilding, toWorld(state.project.building, at))
    : at;
  const placementProject = alignedBuilding
    ? levelProject({ ...state.project, building: alignedBuilding }, state.project.activeLevel)
    : state.project;
  return { at: placementAt, project: placementProject, building: alignedBuilding };
}

// Точки — в локальных координатах дома (см. core/building.js).
export function placeRoomAt(at, typeOverride = null) {
  const placement = roomPlacementContext(at);
  const { building: alignedBuilding, project: placementProject } = placement;
  const placementAt = placement.at;
  const type = typeOverride || state.tool.type;
  const def = roomType(type);
  const turned = !typeOverride && (state.tool?.rotation || 0) % 180 !== 0;
  const w = turned ? def.h : def.w;
  const h = turned ? def.w : def.h;
  let x = placementAt.x - w / 2;
  let y = placementAt.y - h / 2;
  const parentId = def.open ? null : determineParent(placementProject, { x, y, w, h }, null);
  const snapped = snapRoomPosition(placementProject, { id: '__ghost__', type, w, h }, x, y, 14 / state.view.scale, parentId);
  x = snapped.x; y = snapped.y;
  const verdict = validateRoomPlacement(placementProject, { type, x, y, w, h, parentId }, null);
  if (!verdict.ok) { toast(verdict.reason, true); return; }
  const room = createRoom(type, x, y, w, h);
  room.parentId = parentId;
  if (def.shaft) room.takesArea = true;
  const sameType = state.project.rooms.filter((r) => r.type === room.type).length;
  if (sameType > 0) room.name = `${def.title} ${sameType + 1}`;
  let stair = null;
  if (type === 'stairs-room') {
    stair = createItem('stairs', room.x + room.w / 2, room.y + room.h / 2, 2200, 3200);
    applyStairPreset(stair, 'u', activeLevel(state.project)?.height || 3000);
  }
  let eaten = null;
  mutate(() => {
    if (alignedBuilding) state.project.building = alignedBuilding;
    state.project.rooms.push(room);
    if (stair) state.project.items.push(stair);
    // Мебель родителя из-под нового помещения вытаскивается.
    if (parentId) reclaimItemsFromChild(state.project, roomById(state.project, parentId), room);
    // Поверх другой комнаты — новая «съедает» её (перегородка между ними).
    else eaten = eatOverlapsAfter([room.id], { silent: true });
    // Новая комната создаётся ПУСТОЙ — мебель пользователь добавляет сам из
    // панели «Мебель» (клик по карточке или перетаскиванием).
  }, { arrange: stair ? (parentId ? [parentId] : []) : parentId ? [room.id, parentId] : [room.id] });
  cancelTool();
  selectObject(stair ? { type: 'item', id: stair.id } : { type: 'room', id: room.id });
  const eatText = eatSummary(eaten);
  const alignedText = alignedBuilding ? 'Оси дома автоматически развёрнуты по текущему виду.' : '';
  if (verdict.warning) toast(`${alignedText ? `${alignedText} ` : ''}⚠ ${verdict.warning} — поставлено, проверьте отступы${eatText ? `. ${eatText}` : ''}`, true);
  else if (eatText) toast(`${alignedText ? `${alignedText} ` : ''}${eatText}`, Boolean(alignedBuilding || eaten.failed.length || eaten.lost.length));
  else if (stair) toast(`${alignedText ? `${alignedText} ` : ''}Лестница создана и рассчитана по высоте этажа — выберите форму справа`, Boolean(alignedBuilding));
  else if (parentId) toast(`${alignedText ? `${alignedText} ` : ''}«${room.name}» вложена в «${roomById(state.project, parentId).name}» и отнимает её площадь`, Boolean(alignedBuilding));
  else if (alignedText) toast(`${alignedText} Ctrl+Z вернёт и помещение, и поворот.`, true);
}

// Расчёт параметров проёма под курсором: позиция, сторона открывания и петли
// зависят от того, с какой стороны стены и ближе к какому концу стоит мышь.
// Привязка проёма при вставке/перетаскивании: шаг по зуму, середина стены;
// Shift (state.openingFree) — свободно, с точностью до мм.
export function openingSnapOpts() {
  if (state.openingFree) return { step: 1, tol: 0 };
  const scale = state.view?.scale || 0.08;
  return { step: gridStepForScale(scale), tol: 12 / scale };
}

export function computeOpeningParams(at) {
  const openKind = state.tool.openKind;
  const wall = state.tool.presetWall ? findWall(state.tool.presetWall.key, state.tool.presetWall.from) : nearestWall(at);
  if (!wall) return null;
  if (wall.kind === 'manual') return computeHostOpening(at, wall, openKind);
  const roomId = wall.rooms[0];
  const side = wall.sides[roomId];
  const room = roomById(state.project, roomId);
  if (!room) return null;
  if (openKind === 'window' && (wall.kind === 'shared' || room.parentId)) return { error: 'Окно можно разместить только на наружной стене' };
  const edge = sideEdge(room, side);
  const base = edge.orient === 'h' ? room.x : room.y;
  const along = wall.orient === 'h' ? at.x : at.y;
  const width = openKind === 'door' ? DOOR_WIDTH : WINDOW_WIDTH;
  const opening = applyOpeningPreset(createOpening(openKind, roomId, side, along - base, width), state.tool.preset);
  const clamped = clampOpeningOffset(state.project, opening, state.walls, along - base);
  if (clamped === null) return { error: 'На этом участке стены проём не помещается' };
  // Ближайшее место, где проём не налезает на соседние (зазор ≥ OPENING_GAP).
  const free = fitOpeningOffset(state.project, opening, state.walls,
    snapOpeningOffset(state.project, opening, state.walls, along - base, openingSnapOpts()));
  if (free === null) return { error: `На этой стене нет места: проём пересёкся бы с соседними (нужен зазор ≥ ${OPENING_GAP} мм)` };
  opening.offset = free;
  if (openKind === 'door') {
    // Сторона открывания — та, где мышь относительно линии стены.
    const perpRoomCenter = wall.orient === 'h' ? room.y + room.h / 2 : room.x + room.w / 2;
    const mousePerp = wall.orient === 'h' ? at.y : at.x;
    const roomSign = Math.sign(perpRoomCenter - wall.edge) || 1;
    const mouseSign = Math.sign(mousePerp - wall.edge) || roomSign;
    opening.swingIn = mouseSign === roomSign; // открывается в сторону курсора
    // Петли — на дальнем от курсора конце, створка «смотрит» к курсору.
    // Петли — строго с одной стороны: её выбирает только Пробел (state.tool.hingeStart),
    // положение мыши вдоль стены на неё не влияет (иначе дверь мерцает слева/справа).
    opening.hingeStart = state.tool?.hingeStart !== false;
  }
  return { opening, wall };
}

// Проём на ручной стене: host { wallId, t }, t — центр от начала оси.
function computeHostOpening(at, wall, openKind) {
  const width = openKind === 'door' ? DOOR_WIDTH : WINDOW_WIDTH;
  const opening = applyOpeningPreset(createOpening(openKind, null, 0, 0, width), state.tool.preset);
  delete opening.side;
  delete opening.offset;
  opening.roomId = null;
  const along = wall.orient === 'h' ? at.x : at.y;
  opening.host = { wallId: wall.wallId, t: (along - wall.axisStart) * wall.axisDir };
  if (clampOpeningOffset(state.project, opening, state.walls, opening.host.t) === null) return { error: 'На этой стене проём не помещается' };
  const free = fitOpeningOffset(state.project, opening, state.walls,
    snapOpeningOffset(state.project, opening, state.walls, opening.host.t, openingSnapOpts()));
  if (free === null) return { error: `На этой стене нет места: проём пересёкся бы с соседними (нужен зазор ≥ ${OPENING_GAP} мм)` };
  opening.host.t = free;
  if (openKind === 'door') {
    // Открывание — в сторону курсора: «внутрь» — слева от оси a→b.
    const mid = wall.orient === 'h' ? wall.band.y + wall.band.h / 2 : wall.band.x + wall.band.w / 2;
    const mouseSign = Math.sign((wall.orient === 'h' ? at.y : at.x) - mid) || wall.outward;
    opening.swingIn = mouseSign === wall.outward;
    opening.hingeStart = state.tool?.hingeStart !== false; // см. выше: только Пробел
  }
  return { opening, wall };
}

export function placeOpeningAt(at) {
  const res = computeOpeningParams(at);
  if (!res) { toast('Кликните ближе к стене'); return; }
  if (res.error) { toast(res.error); return; }
  const { opening } = res;
  mutate(() => { state.project.openings.push(opening); });
  // Инструмент остаётся активным: можно ставить следующий проём подряд.
  // Esc — выход; проём правится кликом по нему после выхода.
  state.ghostOpening = null; state.ghostOpeningFull = null; state.ghostDoor = null;
  toast(`${opening.kind === 'door' ? 'Дверь' : 'Окно'} поставлена · кликайте дальше или Esc`);
  requestDraw();
}

export function addFurniture(kind, room) {
  const fd = furnitureDef(kind);
  if (!fd) return;
  const item = createItem(kind, Math.round((room.x + room.w / 2) / GRID_STEP) * GRID_STEP,
    Math.round((room.y + room.h / 2) / GRID_STEP) * GRID_STEP, fd.w, fd.h);
  withDefaultComp(item); // стол — сразу со стульями, диван — из модулей
  mutate(() => { state.project.items.push(item); });
  // Выделение остаётся на комнате: можно сразу добавлять следующую мебель «+».
  toast(`«${fd.title}» добавлена в центр комнаты — выберите её на плане, чтобы переместить`);
}

export function deleteSelection() {
  const sel = state.selection;
  if (!sel) return;
  if (sel.type === 'site' && sel.kind === 'building') return; // дом с участка не удаляется
  if (sel.type === 'section') { deleteSectionView(sel.id); return; }
  if (sel.type === 'slab') { deleteSlab(sel); return; }
  if (sel.type === 'railing') { deleteSelectedRailing(); return; }
  if (sel.type === 'mass') { deleteMass(sel.id); return; }
  if (sel.type === 'roof') { deleteRoof(sel.id); return; }
  if (sel.type === 'grid') { deleteGrid(sel.id); return; }
  if (sel.type === 'room') {
    const room = roomById(state.project, sel.id);
    if (!room) return;
    mutate(() => { removeRoom(state.project, sel.id); reconcileEats(state.project); reconcileOpenings(); });
    state.selection = null;
    toast(`«${room.name}» удалена`);
  } else if (sel.type === 'wall' && String(sel.key).startsWith('m|')) {
    mutate(() => { removeManualWall(state.project, sel.key.slice(2)); });
    state.selection = null;
    toast('Стена удалена вместе с её проёмами · Ctrl+Z — вернуть');
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
      reconcileEats(state.project);
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
      if (sel.kind === 'terrain-point' && site.terrain) site.terrain.points = site.terrain.points.filter((p) => p.id !== sel.id);
    });
    state.selection = null;
  }
  renderProps();
  requestDraw();
}

// Комнаты верхнего уровня, чья НОМИНАЛЬНАЯ форма перекрывается с данной
// (любой порядок z): съеденные пары тоже — «поменять» меняет порядок, и
// съедание моста пересчитывает, кто кого ест.
export function overlappingTopRooms(room) {
  // Открытые помещения (терраса, балкон) лежат под домом и не съедают.
  if (room.parentId || isOpenRoom(room)) return [];
  const mine = nominalShape(room);
  return state.project.rooms.filter((o) => o !== room && !o.parentId && !isOpenRoom(o) && roomsIntersect(mine, nominalShape(o)));
}

// Конец жеста над комнатами roomIds (поставлены, сдвинуты, растянуты): они
// поднимаются наверх и «съедают» перекрытые комнаты. Съедание считается с
// нуля по номинальным формам (core/v7/eat-bridge.js, ядро v7 carve) — нижняя
// уменьшается, между ними перегородка; ушла верхняя — нижняя снова целая.
// Вызывать до pushHistory: один шаг отмены. Тост — итог.
export function eatOverlapsAfter(roomIds, { silent = false, under = null, prev = null } = {}) {
  const res = reconcileEats(state.project, { touched: roomIds, under, prev });
  if (res.eaten.length || res.failed.length || res.restored.length) reconcileOpenings();
  const text = eatSummary(res);
  if (text && !silent) toast(text, Boolean(res.failed.length || res.lost.length));
  return res;
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

// Выбрать всю группу мебели как мультивыбор. Возвращает этот выбор: на
// касании selectObject откладывается, и state.selection ещё старый.
export function selectGroup(groupId) {
  const itemIds = state.project.items.filter((i) => i.group === groupId).map((i) => i.id);
  const sel = itemIds.length <= 1
    ? (itemIds.length ? { type: 'item', id: itemIds[0] } : null)
    : { type: 'multi', roomIds: [], itemIds };
  selectObject(sel);
  return sel;
}

// Применить групповое действие core/room-group.js одной записью истории:
// проёмы приводятся к стенам, стены и связность пересчитываются.
// roomIds — комнаты, которые действие двигает/поворачивает: съеденным из них
// возвращается номинал (жест над блоком — по номиналу), мебель — по видимой
// форме (carry), после действия съедание считается заново (тронутые — наверх).
function applyGroupChange(action, failText, roomIds = [], { reflow = false } = {}) {
  const before = snapshot();
  const carry = new Set(groupCargo(state.project, roomIds, []).items.map((i) => i.id));
  for (const id of roomIds) liftRoom(state.project, id);
  const res = action(state.project, carry);
  if (!res.ok) {
    restoreFrom(before);
    toast(res.reason || failText, true);
    return false;
  }
  reconcileEats(state.project, { touched: roomIds });
  reconcileOpenings();
  refreshDerived();
  if (reflow) reflowLayoutChanges(before);
  pushHistory(before);
  afterChange();
  if (res.warning) toast(`⚠ ${res.warning}`, true);
  return true;
}

// Сдвиг мультивыделения (стрелки): помещения с вложенными, мебелью,
// лестницами и проёмами.
export function moveMultiBy(dx, dy) {
  const sel = state.selection;
  if (sel?.type !== 'multi') return false;
  const ok = applyGroupChange((project, carry) => moveRoomGroup(project, sel.roomIds, sel.itemIds, dx, dy, { carry }), 'Так сдвинуть нельзя', sel.roomIds);
  if (ok) selectObject(sel);
  return ok;
}

// «Пристыковать»: сдвиг одной комнаты пары с нестандартным зазором так, чтобы
// зазор стал толщиной общей стены. Комната едет с вложенными, мебелью и
// проёмами; одна запись истории.
export function dockGapPair(gap) {
  const plan = planGapMove(state.project, gap);
  if (!plan.move) { toast(`Пристыковать нельзя: ${plan.reason}`, true); return false; }
  const { roomId, dx, dy, name, distance } = plan.move;
  const ok = applyGroupChange((project, carry) => moveRoomGroup(project, [roomId], [], dx, dy, { carry }), 'Так сдвинуть нельзя', [roomId]);
  if (ok) {
    state.gapFocus = null;
    selectObject({ type: 'multi', roomIds: [gap.a, gap.b], itemIds: [] });
    toast(`«${name}» сдвинута на ${Math.round(distance)} мм — общая стена ${gap.target} мм · Ctrl+Z — отменить`);
  }
  return ok;
}

// Сколько мм написать в сообщении: целые, без «-0».
const mm = (v) => Math.round(Math.abs(v));

// Исправить зазор «≠ N мм» (core/gap-fix.js): 'move' — сдвинуть комнату,
// 'stretch' — растянуть (сузить) сторону, 'thicken' — щель станет общей стеной.
// Одна запись истории; проёмы, вложенные комнаты и мебель — как при жесте.
export function applyGapFix(gap, fix) {
  if (fix === 'move') return dockGapPair(gap);
  if (fix === 'stretch') {
    const plan = planGapStretch(state.project, gap);
    if (!plan.move) { toast(`Растянуть нельзя: ${plan.reason}`, true); return false; }
    const { roomId, name, distance, direction } = plan.move;
    const ok = applyGroupChange((project) => applyGapStretch(project, plan.move), 'Так растянуть нельзя', [roomId], { reflow: true });
    if (ok) {
      state.gapFocus = null;
      selectObject({ type: 'multi', roomIds: [gap.a, gap.b], itemIds: [] });
      toast(`Сторона «${name}» ${direction === 'out' ? 'продлена' : 'сужена'} на ${mm(distance)} мм — общая стена ${gap.target} мм · Ctrl+Z — отменить`);
    }
    return ok;
  }
  if (fix === 'thicken') {
    const plan = planGapThicken(state.project, gap);
    if (plan.thickness == null) { toast(`Сделать стену нельзя: ${plan.reason}`, true); return false; }
    mutate(() => applyGapThicken(state.project, gap, plan.thickness));
    state.gapFocus = null;
    selectObject({ type: 'multi', roomIds: [gap.a, gap.b], itemIds: [] });
    toast(`Щель стала общей стеной ${plan.thickness} мм · Ctrl+Z — отменить`);
    return true;
  }
  return false;
}

// Автостыковка после правки комнат: перетащили (kind 'move') — сдвиг, тянули сторону или
// ввели размер ('stretch') — растяжение; если зазор появился или изменился этой правкой и
// отличается от толщины перегородки не больше чем на AUTO_DOCK_MM. before — снимок до правки
// (snapshot()). Отдельный шаг истории: Ctrl+Z возвращает ровно то, что получилось у пальца
// или было введено. Выключена вместе с магнитом блоков (кнопка «Магнит», Alt).
export function autoDockAfterGesture(roomIds, kind, { magnet = true, before: beforeText = null } = {}) {
  if (!magnet || !roomIds?.length || state.snapSettings?.magnet === false) return false;
  let changed = null;
  let originalProject = null;
  if (beforeText) {
    try {
      originalProject = parseProjectText(beforeText);
      changed = new Map(findNearMissGaps(originalProject, { move: false }).map((g) => [g.key, g.gap]));
    } catch { changed = null; originalProject = null; }
  }
  const found = autoDockFix(state.project, roomIds, kind, { changed });
  if (!found) return false;
  const { gap, fix, plan } = found;
  const before = snapshot();
  const room = roomById(state.project, plan.roomId);
  if (!room) return false;
  const originalRoom = originalProject && roomById(originalProject, room.id);
  const layoutItemIds = fix === 'stretch'
    ? itemsInRoom(originalProject && originalRoom ? originalProject : state.project, originalRoom || room).map((item) => item.id)
    : [];
  const carry = new Set(groupCargo(state.project, [room.id], []).items.map((i) => i.id));
  liftRoom(state.project, room.id);
  const res = fix === 'stretch'
    ? applyGapStretch(state.project, plan)
    : moveRoomGroup(state.project, [room.id], [], plan.dx, plan.dy, { carry });
  if (!res.ok) { restoreFrom(before); return false; }
  reconcileEats(state.project, { touched: [room.id] });
  reconcileOpenings();
  refreshDerived();
  if (fix === 'stretch') arrangeRoomsNow([room.id], {
    itemIdsByRoom: new Map([[room.id, layoutItemIds]]),
  });
  pushHistory(before);
  afterChange();
  const d = fix === 'stretch' ? Math.abs(plan.shift) : Math.hypot(plan.dx, plan.dy);
  toast(`Состыковано: общая стена ${gap.target} мм (${mm(d)} мм) · Ctrl+Z — как было`);
  return true;
}

// Повернуть выбранную мебель группой на 90° вокруг общего центра.
// С помещениями — поворот всей группы (core/room-group.js).
export function rotateMulti90() {
  const sel = state.selection;
  if (sel?.type === 'multi' && sel.roomIds.length) {
    if (applyGroupChange((project, carry) => rotateRoomGroup(project, sel.roomIds, sel.itemIds, { carry }), 'Так повернуть нельзя', sel.roomIds)) {
      selectObject(sel);
      toast('Группа повёрнута на 90° · Ctrl+Z — отменить');
    }
    return;
  }
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

// Единые действия контекстной панели ---------------------------------------

function cloneItem(item, dx, dy, group = null) {
  const copy = createItem(item.kind, item.x + dx, item.y + dy, item.w, item.h, item.rotation || 0);
  const id = copy.id;
  Object.assign(copy, JSON.parse(JSON.stringify(item)), { id, x: item.x + dx, y: item.y + dy });
  if (group) copy.group = group; else delete copy.group;
  return copy;
}

const cloneData = (value) => JSON.parse(JSON.stringify(value));
let objectClipboard = null;

function selectedItems(sel) {
  if (sel.type === 'item') {
    return [state.project.items.find((item) => item.id === sel.id)].filter(Boolean);
  }
  if (sel.type === 'multi' && !sel.roomIds.length) {
    return sel.itemIds.map((id) => state.project.items.find((item) => item.id === id)).filter(Boolean);
  }
  return [];
}

function groupClipboard(sel) {
  return {
    kind: 'group',
    ...cloneData(captureRoomGroup(state.project, sel.roomIds, sel.itemIds)),
    selectedRoomIds: [...sel.roomIds],
    selectedItemIds: [...sel.itemIds],
    pastes: 0,
  };
}

// Вставка группы: место — как у копии помещения (рядом, без окон в общих
// стенах), взаимное положение сохраняется. Одна запись истории.
function pasteGroup(clipboard) {
  const plan = planGroupCopy(state.project, clipboard);
  if (!plan.ok) { toast(plan.reason, true); return false; }
  mutate(() => {
    state.project.rooms.push(...plan.rooms);
    state.project.openings.push(...plan.openings);
    state.project.items.push(...plan.items);
    reconcileOpenings();
  });
  clipboard.pastes += 1;
  const itemIndex = new Map(clipboard.items.map((item, index) => [item.id, index]));
  const roomIds = clipboard.selectedRoomIds.map((id) => plan.roomMap.get(id)).filter(Boolean);
  const itemIds = clipboard.selectedItemIds.filter((id) => itemIndex.has(id)).map((id) => plan.items[itemIndex.get(id)].id);
  const single = roomIds.length === 1 && !itemIds.length;
  selectObject(single ? { type: 'room', id: roomIds[0] } : { type: 'multi', roomIds, itemIds });
  const where = !plan.dx && !plan.dy ? 'на том же месте'
    : plan.detached ? 'отдельно справа от дома (вплотную места нет)'
      : plan.dx > 0 ? 'справа' : plan.dx < 0 ? 'слева' : plan.dy > 0 ? 'снизу' : 'сверху';
  const notes = [];
  if (plan.removedOpenings) notes.push(`проёмов удалено: ${plan.removedOpenings}`);
  if (plan.movedOpenings) notes.push(`сдвинуто: ${plan.movedOpenings}`);
  toast(`${single ? 'Копия помещения' : 'Копия группы'} — ${where}${notes.length ? ` · ${notes.join(', ')}` : ''}`, plan.removedOpenings > 0);
  return true;
}

function roomClipboard(room) {
  const rooms = [room, ...state.project.rooms.filter((candidate) => !room.parentId && candidate.parentId === room.id)];
  const roomIds = new Set(rooms.map((candidate) => candidate.id));
  return {
    kind: 'room',
    rooms: cloneData(rooms),
    openings: cloneData(state.project.openings.filter((opening) => roomIds.has(opening.roomId))),
    items: cloneData(state.project.items.filter((item) => roomContainsPoint(room, item.x, item.y))),
    pastes: 0,
  };
}

// Внутренний буфер объектов редактора: не затрагивает системный буфер текста.
export function copySelection() {
  const sel = state.selection;
  if (!sel) return false;
  if (sel.type === 'mass') {
    const mass = massById(sel.id);
    if (!mass) return false;
    objectClipboard = { kind: 'mass', mass: cloneData(mass), pastes: 0 };
    toast('Масса скопирована · Ctrl+V — вставить');
    return true;
  }
  const items = selectedItems(sel);
  if (items.length) {
    objectClipboard = { kind: 'items', items: cloneData(items), pastes: 0 };
  } else if (sel.type === 'opening') {
    const opening = state.project.openings.find((candidate) => candidate.id === sel.id);
    if (!opening) return false;
    objectClipboard = { kind: 'opening', opening: cloneData(opening), pastes: 0 };
  } else if (sel.type === 'room') {
    const room = roomById(state.project, sel.id);
    if (!room) return false;
    objectClipboard = roomClipboard(room);
  } else if (sel.type === 'multi' && sel.roomIds.length) {
    objectClipboard = groupClipboard(sel);
    toast(`Скопирована группа: помещений ${sel.roomIds.length} · Ctrl+V — вставить`);
    return true;
  } else {
    toast('Этот тип выделения нельзя скопировать', true);
    return false;
  }
  toast(items.length > 1 ? `Скопировано объектов: ${items.length}` : 'Объект скопирован · Ctrl+V — вставить');
  return true;
}

function pasteItems(clipboard) {
  const offset = 300 * (clipboard.pastes + 1);
  const groupMap = new Map();
  const copies = clipboard.items.map((item) => {
    let group = null;
    if (clipboard.items.length > 1 && item.group) {
      if (!groupMap.has(item.group)) groupMap.set(item.group, `grp-${Date.now().toString(36)}-${groupMap.size}`);
      group = groupMap.get(item.group);
    }
    return cloneItem(item, offset, offset, group);
  });
  mutate(() => { state.project.items.push(...copies); });
  clipboard.pastes += 1;
  selectObject(copies.length === 1
    ? { type: 'item', id: copies[0].id }
    : { type: 'multi', roomIds: [], itemIds: copies.map((item) => item.id) });
  return true;
}

function pasteOpening(clipboard) {
  const source = clipboard.opening;
  if (source.host ? !manualWallById(state.project, source.host.wallId) : !roomById(state.project, source.roomId)) {
    toast('Исходного помещения уже нет — проём вставить некуда', true);
    return false;
  }
  const copy = createOpening(source.kind, source.roomId, source.side, source.offset, source.width);
  const id = copy.id;
  Object.assign(copy, cloneData(source), { id });
  const walls = deriveWalls(state.project);
  const step = (source.width + 300) * (clipboard.pastes + 1);
  const pos = openingPos(source);
  const right = fitOpeningOffset(state.project, copy, walls, pos + step);
  const left = fitOpeningOffset(state.project, copy, walls, pos - step);
  if (right === null && left === null) {
    toast(`На стене нет места для копии проёма (зазор между проёмами ≥ ${OPENING_GAP} мм)`, true);
    return false;
  }
  setOpeningPos(copy, right === null ? left : left === null ? right
    : Math.abs(right - pos - step) <= Math.abs(left - pos + step) ? right : left);
  mutate(() => { state.project.openings.push(copy); });
  clipboard.pastes += 1;
  selectObject({ type: 'opening', id: copy.id });
  return true;
}

function pasteRoom(clipboard) {
  const source = clipboard.rooms[0];
  const partition = state.project.settings?.partition || 100;
  const distance = (source.w + partition) * (clipboard.pastes + 1);
  let dx = distance;
  if (source.parentId) {
    let candidate = { ...source, id: '', x: source.x + dx };
    if (!validateRoomPlacement(state.project, candidate, null).ok) {
      dx = -distance;
      candidate = { ...source, id: '', x: source.x + dx };
      if (!validateRoomPlacement(state.project, candidate, null).ok) {
        toast('В родительском помещении нет места для вставки', true);
        return false;
      }
    }
  }
  const roomMap = new Map();
  const rooms = clipboard.rooms.map((room) => {
    const copy = createRoom(room.type, room.x + dx, room.y, room.w, room.h);
    const id = copy.id;
    Object.assign(copy, cloneData(room), { id, x: room.x + dx });
    roomMap.set(room.id, copy.id);
    return copy;
  });
  rooms.forEach((room, index) => {
    const oldParent = clipboard.rooms[index].parentId;
    room.parentId = roomMap.get(oldParent) || oldParent || null;
  });
  rooms[0].name = `${source.name} — копия`;
  const openings = clipboard.openings.map((opening) => {
    const roomId = roomMap.get(opening.roomId);
    const copy = createOpening(opening.kind, roomId, opening.side, opening.offset, opening.width);
    const id = copy.id;
    return Object.assign(copy, cloneData(opening), { id, roomId });
  });
  const items = clipboard.items.map((item) => cloneItem(item, dx, 0));
  mutate(() => {
    state.project.rooms.push(...rooms);
    state.project.openings.push(...openings);
    state.project.items.push(...items);
  });
  clipboard.pastes += 1;
  selectObject({ type: 'room', id: rooms[0].id });
  return true;
}

export function pasteSelection() {
  if (!objectClipboard) {
    toast('Сначала выберите объект и нажмите Ctrl+C');
    return false;
  }
  if (objectClipboard.kind === 'items') return pasteItems(objectClipboard);
  if (objectClipboard.kind === 'opening') return pasteOpening(objectClipboard);
  if (objectClipboard.kind === 'room') return pasteRoom(objectClipboard);
  if (objectClipboard.kind === 'group') return pasteGroup(objectClipboard);
  if (objectClipboard.kind === 'mass') {
    const c = objectClipboard;
    c.pastes += 1;
    const step = 1000 * c.pastes;
    const copy = c.mass.id.startsWith('void-')
      ? createMassVoid({ ...c.mass, id: undefined, name: `${c.mass.name} копия`, x: c.mass.x + step, y: c.mass.y + step }, massVoids())
      : copyMass(c.mass, masses(), { x: step, y: step });
    addMass(copy);
    return true;
  }
  return false;
}

function duplicateItemSelection(sel) {
  const source = sel.type === 'item'
    ? [state.project.items.find((item) => item.id === sel.id)].filter(Boolean)
    : sel.itemIds.map((id) => state.project.items.find((item) => item.id === id)).filter(Boolean);
  if (!source.length) return;
  const groupMap = new Map();
  const copies = source.map((item) => {
    let group = null;
    if (source.length > 1 && item.group) {
      if (!groupMap.has(item.group)) groupMap.set(item.group, `grp-${Date.now().toString(36)}-${groupMap.size}`);
      group = groupMap.get(item.group);
    }
    return cloneItem(item, 300, 300, group);
  });
  mutate(() => { state.project.items.push(...copies); });
  selectObject(copies.length === 1
    ? { type: 'item', id: copies[0].id }
    : { type: 'multi', roomIds: [], itemIds: copies.map((item) => item.id) });
  toast(copies.length === 1 ? 'Создана копия — перетащите её на место' : `Создано копий: ${copies.length}`);
}

function duplicateOpeningSelection(sel) {
  const source = state.project.openings.find((opening) => opening.id === sel.id);
  if (!source) return;
  const copy = createOpening(source.kind, source.roomId, source.side, source.offset, source.width);
  const id = copy.id;
  Object.assign(copy, JSON.parse(JSON.stringify(source)), { id });
  const walls = deriveWalls(state.project);
  const step = source.width + 300;
  const pos = openingPos(source);
  const right = fitOpeningOffset(state.project, copy, walls, pos + step);
  const left = fitOpeningOffset(state.project, copy, walls, pos - step);
  if (right === null && left === null) {
    toast(`На стене нет места для копии проёма (зазор между проёмами ≥ ${OPENING_GAP} мм)`, true);
    return false;
  }
  setOpeningPos(copy, right === null ? left : left === null ? right
    : Math.abs(right - pos - step) <= Math.abs(left - pos + step) ? right : left);
  mutate(() => { state.project.openings.push(copy); });
  selectObject({ type: 'opening', id: copy.id });
  toast(`Создана копия ${source.kind === 'door' ? 'двери' : 'окна'}`);
}

function duplicateRoomSelection(sel) {
  const source = roomById(state.project, sel.id);
  if (!source) return;
  // Мебель — по видимой форме; копия — с НОМИНАЛЬНОЙ формы съеденной
  // (копируется блок, а не его остаток). Видимую форму вернёт reconcileEats.
  const items = state.project.items.filter((item) => roomContainsPoint(source, item.x, item.y));
  const before = snapshot();
  const lifted = liftRoom(state.project, source.id);
  // Место копии и судьба её проёмов — в core/duplicate-room.js: окна копии
  // в общей стене удаляются, остальные проёмы раздвигаются с соседями.
  const plan = planRoomDuplicate(state.project, source.id);
  if (!plan.ok) {
    if (lifted) { reconcileEats(state.project); refreshDerived(); }
    toast(plan.reason, true);
    return;
  }
  const { dx, dy, rooms: copies, openings } = plan;
  copies[0].name = `${source.name} — копия`;
  for (const c of copies) delete c.eatBase;
  const copiedItems = items.map((item) => cloneItem(item, dx, dy));
  mutate(() => {
    state.project.rooms.push(...copies);
    state.project.openings.push(...openings);
    state.project.items.push(...copiedItems);
  }, { skipHistory: true });
  pushHistory(before);
  selectObject({ type: 'room', id: copies[0].id });
  const where = plan.detached ? 'отдельно справа от дома (вплотную места нет)'
    : dx > 0 ? 'справа от исходного' : dx < 0 ? 'слева от исходного' : dy > 0 ? 'снизу от исходного' : 'сверху от исходного';
  const notes = [];
  if (plan.removedOpenings) notes.push(`Проёмов удалено: ${plan.removedOpenings}`);
  if (plan.movedOpenings) notes.push(`сдвинуто: ${plan.movedOpenings}`);
  toast(`Создана копия помещения ${where}${notes.length ? ` · ${notes.join(', ')}` : ''}`, plan.removedOpenings > 0);
}

export function duplicateSelection() {
  const sel = state.selection;
  if (!sel) return;
  if (sel.type === 'mass') { duplicateMass(sel.id); return; }
  if (sel.type === 'item' || (sel.type === 'multi' && !sel.roomIds.length)) duplicateItemSelection(sel);
  else if (sel.type === 'opening') duplicateOpeningSelection(sel);
  else if (sel.type === 'room') duplicateRoomSelection(sel);
  else if (sel.type === 'multi' && sel.roomIds.length) pasteGroup(groupClipboard(sel));
}

export function rotateSelection90() {
  if (state.selection?.type === 'mass') rotateMass(state.selection.id);
  else if (state.selection?.type === 'multi') rotateMulti90();
  else if (state.selection?.type === 'room') rotateRoom90();
  else rotateSelectedItem();
}

// Повернуть выбранное помещение на 90° по часовой вокруг его центра — с
// вложенными, мебелью и проёмами (core/room-group.js). Одна запись истории.
export function rotateRoom90() {
  const sel = state.selection;
  if (sel?.type !== 'room') return false;
  const ok = applyGroupChange((project, carry) => rotateRoomGroup(project, [sel.id], [], { carry }), 'Так повернуть нельзя', [sel.id]);
  if (ok) {
    selectObject(sel);
    toast('Помещение повёрнуто на 90° · Ctrl+Z — отменить');
  }
  return ok;
}

function mirrorItem(item) {
  if (item.comp?.type === 'kitchen') {
    const next = editKitchen(item, { op: 'mirror', value: !item.comp.mirror });
    if (next) Object.assign(item, next);
    return Boolean(next);
  }
  item.mirrored = !item.mirrored;
  return true;
}

export function mirrorSelection() {
  const sel = state.selection;
  if (sel?.type === 'item') {
    const item = state.project.items.find((candidate) => candidate.id === sel.id);
    if (!item) return;
    let ok = false;
    mutate(() => { ok = mirrorItem(item); });
    if (!ok) toast('Этот конструктор пока нельзя отразить', true);
    selectObject(sel);
    return;
  }
  if (sel?.type !== 'multi' || sel.roomIds.length) return;
  const items = sel.itemIds.map((id) => state.project.items.find((item) => item.id === id)).filter(Boolean);
  if (!items.length) return;
  const cx = items.reduce((sum, item) => sum + item.x, 0) / items.length;
  mutate(() => {
    for (const item of items) {
      item.x = cx * 2 - item.x;
      mirrorItem(item);
    }
  });
  selectObject(sel);
}

export function flipSelectedOpening(part) {
  const opening = state.selection?.type === 'opening'
    ? state.project.openings.find((candidate) => candidate.id === state.selection.id) : null;
  if (!opening || opening.kind !== 'door') return;
  mutate(() => {
    if (part === 'hinge') opening.hingeStart = !opening.hingeStart;
    else opening.swingIn = !opening.swingIn;
  });
  selectObject({ type: 'opening', id: opening.id });
}

export function reverseSelectedStair() {
  const item = state.selection?.type === 'item'
    ? state.project.items.find((candidate) => candidate.id === state.selection.id) : null;
  if (!item || item.kind !== 'stairs') return;
  mutate(() => { item.rotation = ((item.rotation || 0) + 180) % 360; });
  selectObject({ type: 'item', id: item.id });
}

export function groupSelectedItems() {
  const sel = state.selection;
  if (sel?.type !== 'multi' || sel.itemIds.length < 2) return;
  const gid = `grp-${Date.now().toString(36)}`;
  mutate(() => {
    for (const item of state.project.items) if (sel.itemIds.includes(item.id)) item.group = gid;
  });
  selectObject(sel);
  toast('Объекты сгруппированы');
}

export function ungroupSelectedItems() {
  const sel = state.selection;
  if (sel?.type !== 'multi') return;
  mutate(() => {
    for (const item of state.project.items) if (sel.itemIds.includes(item.id)) delete item.group;
  });
  selectObject(sel);
  toast('Группа расформирована');
}

// Добавляет предмет мебели в указанную мировую точку (центр предмета).
export function addFurnitureAt(kind, x, y, rotation = 0, { stairShape = 'straight', stairPreset = null } = {}) {
  const fd = furnitureDef(kind);
  if (!fd) return;
  const item = createItem(
    kind,
    Math.round(x / GRID_STEP) * GRID_STEP,
    Math.round(y / GRID_STEP) * GRID_STEP,
    fd.w, fd.h, rotation,
  );
  withDefaultComp(item); // стол — сразу со стульями, диван — из модулей
  // Лестница — рассчитана по высоте этажа (марши, площадки, ступени).
  if (kind === 'stairs') {
    applyStairPreset(item, stairShape || 'straight', activeLevel(state.project)?.height || 3000);
    applyStairStylePreset(item, stairPreset);
  }
  mutate(() => { state.project.items.push(item); });
  selectObject({ type: 'item', id: item.id });
  toast(item.comp?.type === 'kitchen'
    ? `«${fd.title}» добавлена — форма и элементы в панели справа, элементы тянутся по кухне`
    : kind === 'stairs'
    ? 'Лестница добавлена — круг с числом у марша тянет ступени, ромб — ширину, квадрат — площадку; форма — справа'
    : isFixedSizeComp(item)
    ? `«${fd.title}» добавлен — «+» на концах добавляет модули, круг — поворот`
    : `«${fd.title}» добавлен — тяните углы для размера, круг — поворот`);
}

// «+» у изголовья добавляет настоящую тумбу, а не условный рисунок: так её
// видят проверки спальни, спецификации и 3D. Обычная group связывает комплект
// со всеми уже готовыми действиями перемещения, поворота, копии и удаления.
export function addBedsideNightstand(bedId, side) {
  const bed = state.project.items.find((item) => item.id === bedId);
  if (!supportsBedsideNightstands(bed) || !['left', 'right'].includes(side)) return false;
  // Не подмешиваем тумбы в пользовательскую группу с другой мебелью:
  // сначала её можно явно разгруппировать. Наш комплект помечен bedsideSet.
  if (bed.group && !bed.bedsideSet) return false;
  if (bedsideNightstand(state.project.items, bed, side)) return false;
  const def = furnitureDef('nightstand');
  const target = bedsideTarget(bed, side, { w: def.w, h: def.h });
  if (!target) return false;
  const item = createItem('nightstand', target.x, target.y, target.w, target.h, target.rotation);
  const setId = bed.bedsideSet || `bedset-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const groupId = bed.group || `grp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  mutate(() => {
    bed.bedsideSet = setId;
    bed.group = groupId;
    item.bedsideSet = setId;
    item.bedsideSide = side;
    item.group = groupId;
    state.project.items.push(item);
  });
  selectGroup(groupId);
  toast(`Прикроватная тумба добавлена ${side === 'left' ? 'слева' : 'справа'} · комплект двигается вместе`);
  return true;
}

// Толщина стены. Общая стена остаётся общей: сторона соседа сдвигается так,
// чтобы зазор был равен новой толщине (core/wall-thickness.js).
export function changeWallThickness(wall, newT) {
  if (wall.kind === 'manual') { applyWallChange(wall, (project) => setManualWallThickness(project, wall.wallId, newT)); return; }
  applyWallChange(wall, (project) => (wall.kind === 'shared'
    ? setSharedWallThickness(project, wall, newT)
    : (setOwnWallThickness(project, wall, newT), { ok: true })));
}

// Тип стены: наружная / несущая / перегородка; толщина по умолчанию — класса.
export function changeWallKind(wall, kind) {
  applyWallChange(wall, (project) => setWallKind(project, wall, kind));
}

// Своя стена: толщина только выделенного участка (core/wall-thickness.js setWallSpan).
function setOwnWallThickness(project, wall, newT) {
  setWallSpan(project, wall, { thickness: clampWallThickness(newT, wall.thickness) });
}

function applyWallChange(wall, apply) {
  const before = snapshot();
  const result = apply(state.project);
  if (!result.ok) {
    restoreFrom(before);
    toast(`Нельзя: ${result.reason}`, true);
    return;
  }
  reconcileOpenings();
  refreshDerived();
  reflowLayoutChanges(before);
  pushHistory(before);
  afterChange();
  if (result.broken?.length) toast(`Внимание: разорвано стыковок — ${result.broken.length}, проверьте план`, true);
  // У ключа может быть несколько участков — выделение остаётся на том же.
  const at = (wall.from + wall.to) / 2;
  const moved = state.walls.find((w) => w.key === wall.key && w.orient === wall.orient && w.from <= at && w.to >= at) ||
    state.walls.find((w) => w.key === wall.key) || wall;
  selectObject({ type: 'wall', key: wall.key, from: wall.kind === 'manual' ? undefined : moved.from });
}

// Правка ручной стены из панели свойств (привязка, высота, сдвиг оси):
// apply(project, wallId) → { ok, reason? }, одна запись истории.
export function changeManualWall(wall, apply) {
  applyWallChange(wall, (project) => apply(project, wall.wallId));
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
