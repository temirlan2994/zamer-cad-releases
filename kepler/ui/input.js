import { cornerWindowHandles } from '../core/corner-windows.js';
import { glazedOpeningMinWidth, isGlazedAssembly, resizeGlazedOpening } from '../core/glazed-openings.js';
import { atriumClick, atriumHover } from './atrium-ui.js';
// Ввод мышью на канвасе: выбор, перетаскивания, рамка, колесо, drag-and-drop.

import { furnitureDef, isOpenRoom, roomType } from '../core/catalog.js';
import { itemsEditable, pickStackHit } from '../core/hit-stack.js';
import { STAIR_FIELDS, applyStairPreset, applyStairStylePreset, dragStairHandle, stairHandleLabel } from '../core/stairs.js';
import { itemsInRoom, reclaimItemsFromChild } from '../core/furnish.js';
import { activeLevel, roomById } from '../core/model.js';
import { determineParent, snapRoomPosition, validateRoomPlacement } from '../core/rooms.js';
import { ensureSiteEntries, entryById, entryOverlaps, entryTitle, syncPrimaryEntry } from '../core/site-entries.js';
import { pointInBuilding, setBuildingOrigin } from '../core/site-check.js';
import {
  openingFrame, openingPos, openingPosAt, openingRect, setOpeningPos, wallRects,
} from '../core/walls.js';
import { dragManualWallEnd } from '../core/wall-manual.js';
import {
  boundRoomClick, boundRoomHover, finishWallChain, wallPointMagnet, wallToolClick, wallToolHover,
} from './wall-tool.js';
import { fitOpeningOffset, resizeCornerWing, snapOpeningOffset } from '../core/opening-spacing.js';
import { pointInPolygon } from '../core/zamer/geometry.js';
import {
  captureOpeningAnchors, finalizeRoomOutlineKeepOpenings, reanchorOpenings,
} from '../core/opening-anchor.js';
import { applyRoomShapeHandle, clampRoomNotch, roomBoundaryEdges, roomContainsPoint } from '../core/room-shape.js';
import { groupCargo } from '../core/room-group.js';
import { moveWallBy } from '../core/wall-edit.js';
import { clampDelta, edgeAtPoint, followLimits, followVerdict, handleEdges } from '../core/wall-follow.js';
import {
  itemCorners, neighborCorners, projectPoint, rotateVec, underlayCenter, underlayHandles, unprojectPoint,
} from '../render.js';
import { ITEM_HANDLE_TITLES, nextItemHandle, stretchItem } from '../core/item-handles.js';
import {
  GROUP_HANDLE_TITLES, groupCenter, groupHandleId, groupItems, groupRotateDeg, groupStarts, isItemGroup,
  rotateGroup, scaleGroup, stretchGroup,
} from '../core/group-handles.js';
import { hideDimInput, openDimInput, positionDimInput } from './dim-input.js';
import { hitTempDim } from './temp-dims.js';
import { pendingSplitHas, revertPendingSplit, splitLiveClick, splitLiveMove } from './split-input.js';
import { focusGap, gapMarkerAt } from './gaps.js';
import {
  KITCHEN_ELEMENTS, KITCHEN_SIDES, KITCHEN_SNAP, editKitchen, kitchenElementAt, kitchenHandleDrag, kitchenProject, withDefaultComp,
} from '../core/composite.js';
import { hideSofaMenu, openSofaMenu } from './props-composite.js';
import { canvas, el, refs, toast } from './dom.js';
import {
  findWall, hitGroupHandle, hitItem, hitItemHandle, hitManualWallEnd, hitNeighborHandle, hitOpening, hitOpeningHandle, hitRailingEnd, hitRoom,
  hitPlanStack, hitRoomHandle, hitSiteMidpoint, hitSiteObject, hitSiteVertex, hitUnderlayHandle, hitWall,
} from './hit.js';
import { spaceDown } from './keyboard.js';
import { massSnapPoints } from './plan-masses.js';
import { gridSnapPoints } from './plan-grids.js';
import {
  LANDSCAPE_MIME, applyLandscapeMarquee, cancelLandscapeDrag, dropLandscape, landscapeDblClick, landscapeDragEnd, landscapeDragMove,
  landscapeHover, landscapePointerDown,
} from './landscape.js';
import { switchLevel } from './levels.js';
import { closeLibrarySheet } from './mobile.js';
import {
  addBedsideNightstand, addFurnitureAt, autoDockAfterGesture, computeOpeningParams, eatOverlapsAfter, openingSnapOpts, placeOpeningAt,
  placeRoomAt, reconcileOpenings, roomPlacementContext, selectGroup, selectPlanObjects, toggleInMulti, toggleOpeningFlip,
} from './plan-actions.js';
import {
  addDraftPoint, addNorthPoint, computeEntryAt, finishDraft, placeNeighborAt, updateDraftCursor,
} from './site-actions.js';
import { addAlignViewPoint, snapAlignPoint } from './view-align.js';
import {
  planSectionClick, planSectionDblClick, planSectionDragEnd, planSectionDragMove, planSectionHover, planSectionHoverTarget,
  planSectionPointerDown,
} from './plan-section.js';
import { chainsWithout, dragPrev, setSnapRehover, snapAt } from './draw-snap-ui.js';
import { applyResize, gridStep, resizeVerdict, snapItemToWalls } from './snap.js';
import { guideDelta, itemShape, roomShape, startGuideSession } from './guides-ui.js';
import {
  cancelLiveDerived, captureFollow, followFrame, liftForGesture, liveEat, magnetMove, magnetResize,
  scheduleLiveDerived, sketchMagnet, wallGridMagnet,
} from './block-gesture.js';
import { hitGridLock } from './grid-locks.js';
import { hideLockTip, rememberGridSnap, showLockTip, toggleGridLock } from './grid-pin-ui.js';
import { massPlanClick, massPlanHover } from './masses.js';
import {
  finishSlabOpeningTool, slabDragEnd, slabDragMove, slabHoverTarget, slabPointerDown, slabToolClick, slabToolHover,
} from './slab-ui.js';
import {
  isRoofPlan, roofPlanDblClick, roofPlanDragCancel, roofPlanDragEnd, roofPlanDragMove, roofPlanHover, roofPlanPointerDown,
} from './roof-plan.js';
import {
  gridDragEnd, gridDragMove, gridHoverTarget, gridPointerDown, gridToolClick, gridToolHover,
} from './grids.js';
import { eatersOf, liftRoom } from '../core/v7/eat-bridge.js';
import { materializeRailings, moveRailingEnd } from '../core/railings.js';
import { state } from './state.js';
import { registerEditGestureCancel } from './edit-guard.js';
import { afterChange, pushHistory, refreshDerived, reflowLayoutChanges, restoreFrom, snapshot } from './store.js';
import { arrangeRoomsNow } from './auto-layout.js';
import { activeSiteLayer, cancelTool, positionWallButtons, selectObject, setHint } from './tools.js';
import { renderSelectionToolbar } from './selection-toolbar.js';
import { addCalibratePoint, hideCalInput, positionCalInput } from './underlay.js';
import {
  applyElevInput, hitTerrainPoint, openElevInput, positionElevInput, terrainStatus,
} from './terrain.js';
import {
  markViewTouched, pointerScreen, pointerWorld, requestDraw, scaleLabel, screenToPlan, screenToWorld, worldToPlan, worldToScreen,
  zoomAt,
} from './view.js';

// Перемещение объекта пальцем: долгое нажатие (мс), допуск дрожания (px).
const TOUCH_HOLD_MS = 420;
const TOUCH_HOLD_SLOP = 9;
const TOUCH_HOLD_KINDS = new Set(['building', 'neighbor', 'underlay', 'item', 'opening', 'room', 'multi', 'wall', 'entry', 'ls-move', 'grid-move']);
let drag = null;

const sameIdSet = (a = [], b = []) => a.length === b.length && a.every((id) => b.includes(id));

// На сенсорном экране объект правится только если он уже был выбран до
// pointerdown. Сравниваем смысл выбора, а не весь объект: у стены, например,
// поле `at` меняется в зависимости от точки касания, но стена остаётся той же.
function sameSelectedTarget(a, b) {
  if (a === b) return true;
  if (!a || !b || a.type !== b.type) return false;
  if (a.type === 'wall') {
    const sameFrom = a.from == null || b.from == null ? a.from == null && b.from == null : Math.abs(a.from - b.from) < 1;
    return a.key === b.key && sameFrom;
  }
  if (a.type === 'site') return a.kind === b.kind && (a.id ?? null) === (b.id ?? null);
  if (a.type === 'multi') return sameIdSet(a.roomIds, b.roomIds) && sameIdSet(a.itemIds, b.itemIds) && sameIdSet(a.wallIds, b.wallIds);
  if (a.type === 'landscape') return sameIdSet(a.ids, b.ids);
  if (a.type === 'railing') return a.roomId === b.roomId && a.id === b.id;
  if (a.type === 'slab') return a.levelId === b.levelId && a.id === b.id;
  if ('id' in a || 'id' in b) return a.id === b.id;
  return false;
}

// До изменения формы запоминаем принадлежность мебели комнатам. После
// уменьшения часть предметов может оказаться уже снаружи нового контура, но
// авторасстановка всё равно должна вернуть их внутрь, а не незаметно забыть.
function captureLayoutItemIds() {
  return new Map(state.project.rooms.map((room) => [
    room.id,
    itemsInRoom(state.project, room).map((item) => item.id),
  ]));
}

// Касание: действие (поставить объект, точку, открыть поле ввода) — только на
// тапе (отпускание без сдвига), свайп отдаётся панораме. Мышь — сразу.
function tapOrNow(event, screen, run) {
  if (event.pointerType !== 'touch') { run(); return; }
  drag = { kind: 'tap', run, start: screen, view: { ...state.view } };
}

// Номер объекта в стопке под курсором. Серия быстрых кликов (event.detail)
// перебирает стопку, но не по уже выбранному предмету сверху: повторный клик
// по нему переключает режим ручек. Alt — следующий под текущим выбором.
function stackPickNumber(stack, event) {
  if (event.shiftKey) return 1;
  const sel = state.selection;
  const at = sel ? stack.findIndex((h) => h.type === sel.type && (h.id ?? h.key) === (sel.id ?? sel.key)
    && (h.type !== 'wall' || Math.abs(h.from - sel.from) < 1)) : -1;
  if (event.altKey) return at >= 0 ? at + 2 : 1;
  if (at === 0 && sel.type === 'item') return 1;
  return Math.max(1, event.detail || 1);
}

// Повторный клик по выбранной мебели — следующий режим ручек.
function cycleItemHandle(id) {
  // Лестница: «выбор» (ручки маршей и площадок) ↔ «поворот»; растяжения нет —
  // габарит задают марши.
  if (state.project.items.find((i) => i.id === id)?.kind === 'stairs') {
    const rotate = state.itemHandle?.id === id && state.itemHandle.mode === 'rotate';
    state.itemHandle = { id, mode: rotate ? 'select' : 'rotate' };
    toast(rotate ? 'Лестница: круг с числом — ступени марша, ромб — ширина марша, квадрат — площадка' : ITEM_HANDLE_TITLES.rotate);
    requestDraw();
    return;
  }
  state.itemHandle = nextItemHandle(state.itemHandle, id);
  toast(ITEM_HANDLE_TITLES[state.itemHandle.mode]);
  requestDraw();
}

// Повторный клик по выбранной группе мебели — следующий режим ручек группы.
function cycleGroupHandle(sel = state.selection) {
  const id = groupHandleId(sel);
  if (!id) return;
  state.itemHandle = nextItemHandle(state.itemHandle, id);
  toast(GROUP_HANDLE_TITLES[state.itemHandle.mode]);
  requestDraw();
}

// Применить к предметам результат core/group-handles.js.
function applyGroupItems(list) {
  for (const r of list) {
    const item = state.project.items.find((i) => i.id === r.id);
    if (item) { item.x = r.x; item.y = r.y; item.w = r.w; item.h = r.h; item.rotation = r.rotation; }
  }
}
// Активные касания (pointerId → точка экрана): два пальца — щипок/панорама.
const touches = new Map();

function restoreWallDragRooms(wallDrag) {
  for (const entry of wallDrag.roomStarts) {
    const room = roomById(state.project, entry.id);
    if (!room) continue;
    for (const key of Object.keys(room)) delete room[key];
    Object.assign(room, structuredClone(entry.room));
  }
  // moveWallBy пересчитывает отступы проёмов — откатываем и их.
  for (const start of wallDrag.openingStarts || []) {
    const opening = state.project.openings.find((o) => o.id === start.id);
    if (!opening) continue;
    if (start.host) opening.host = { ...start.host };
    else { opening.side = start.side; opening.offset = start.offset; }
  }
  // Ручные стены: сдвиг двигает и примыкающие — откат всего массива.
  if (wallDrag.wallsStart) state.project.walls = structuredClone(wallDrag.wallsStart);
}

// Второй палец: всё начатое одним пальцем отменяется, начинается щипок.
function startPinch() {
  if (drag?.before && drag.moved) restoreFrom(drag.before);
  state.planPinching = true;
  state.marquee = null;
  state.ghost = null;
  state.guides = [];
  state.objGuides = null;
  state.kitchenLabel = null;
  const [a, b] = [...touches.values()];
  drag = {
    kind: 'pinch',
    dist: Math.hypot(a.x - b.x, a.y - b.y) || 1,
    mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
    view: { ...state.view },
  };
  requestDraw();
}

// Щипок: масштаб по расстоянию между пальцами, сдвиг — за серединой; точка
// под серединой в начале жеста остаётся под пальцами.
function movePinch() {
  const pts = [...touches.values()];
  if (pts.length < 2) return;
  const mid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
  const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1;
  const v0 = drag.view;
  markViewTouched();
  const anchor = unprojectPoint(v0, drag.mid.x, drag.mid.y);
  state.view.scale = Math.min(0.6, Math.max(0.004, (v0.scale * dist) / drag.dist));
  const p = projectPoint({ ...state.view, panX: 0, panY: 0 }, anchor.x, anchor.y);
  state.view.panX = mid.x - p.x;
  state.view.panY = mid.y - p.y;
  refs.statusScale.textContent = scaleLabel();
  positionCalInput();
  positionElevInput();
  positionDimInput();
  if (state.selection?.type === 'wall') { const w = findWall(state.selection.key, state.selection.from); if (w) positionWallButtons(w); }
  requestDraw();
}

// Пустое место — новый объект; попадание в существующий — его перемещение.
function startEntryDrag(world, hit = null) {
  const site = state.project.site;
  if (!site.boundary || site.boundary.length < 3) { toast('Сначала начертите границу участка'); return; }
  const before = snapshot();
  const list = ensureSiteEntries(site);
  let entry = hit ? entryById(site, hit.id) : null;
  const created = !entry;
  if (created) {
    const kind = state.tool?.entryKind || 'gate';
    entry = { id: `entry-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`, kind,
      opening: state.tool?.opening === 'sliding' ? 'sliding' : 'swing',
      swingSide: state.tool?.swingSide || 'inside', hinge: state.tool?.hinge || 'left', slideDirection: state.tool?.slideDirection || 'right',
      wicketOpening: state.tool?.wicketOpening || 'swing', wicketSwingSide: state.tool?.wicketSwingSide || 'inside',
      wicketHinge: state.tool?.wicketHinge || 'left', wicketSlideDirection: state.tool?.wicketSlideDirection || 'right',
      width: state.tool?.width || (kind === 'wicket' ? 1000 : 4000), height: state.tool?.height || 1800,
      wicket: kind !== 'wicket' && Boolean(state.tool?.wicket), wicketWidth: state.tool?.wicketWidth || 1000, wicketSide: state.tool?.wicketSide || 'right' };
    const spot = computeEntryAt(world, entry);
    if (!spot) { toast('На этой стороне недостаточно места для ворот или калитки'); return; }
    Object.assign(entry, { x: spot.x, y: spot.y, dir: spot.dir });
    if (entryOverlaps(site, entry)) { toast('Здесь уже есть ворота или калитка'); return; }
    list.push(entry);
    syncPrimaryEntry(site);
  }
  selectObject({ type: 'site', kind: 'entry', id: entry.id });
  drag = { kind: 'entry', id: entry.id, before, moved: created };
  if (created) toast(`${entryTitle(entry)} ${entry.kind === 'wicket' ? 'добавлена' : 'добавлены'} · Размеры — в свойствах`);
  if (created) requestDraw();
}

// sel — выбор, который тянем: передаётся явно, потому что на касании
// selectObject откладывается до тапа и state.selection ещё старый.
function startMultiDrag(plan, sel = state.selection, wasSelected = false) {
  if (sel?.type !== 'multi') return;
  // Груз фиксируется при захвате: выбранные комнаты с их вложенными
  // помещениями и мебелью внутри + отдельно выбранная мебель.
  // Состав груза — как у стрелок и поворота группы (core/room-group.js).
  const cargo = groupCargo(state.project, sel.roomIds, sel.itemIds, null, sel.wallIds);
  const movedRooms = new Map(cargo.rooms.map((room) => [room.id, { x: room.x, y: room.y }])); // id -> старт
  const movedItems = new Map(cargo.items.map((item) => [item.id, { x: item.x, y: item.y }])); // id -> старт
  const movedWalls = new Map(cargo.walls.map((wall) => [wall.id, structuredClone(wall.axis)]));
  drag = {
    kind: 'multi',
    plan,
    before: snapshot(),
    moved: false,
    valid: true,
    roomIds: [...sel.roomIds],
    itemIds: [...sel.itemIds],
    roomStarts: movedRooms,
    itemStarts: movedItems,
    wallStarts: movedWalls,
    wasSelected, // клик без сдвига по уже выбранной группе мебели — смена режима ручек
  };
}

// Направляющие группы (комнаты + мебель) в осях дома.
function groupGuideSession(d) {
  const rooms = [...(d.roomStarts?.keys() || [])];
  const items = [...(d.itemStarts?.keys() || [])];
  const roomSet = new Set(rooms);
  const moving = [
    ...state.project.rooms.filter((r) => roomSet.has(r.id)).map((r) => roomShape(r)),
    ...state.project.items.filter((i) => items.includes(i.id)).map((i) => itemShape(i)),
    ...[...(d.wallStarts?.values() || [])].map((axis) => ({ pts: [axis.a, axis.b] })),
  ];
  return startGuideSession({
    space: 'plan', moving, frames: rooms.length ? [0] : null, ownAngles: [0],
    exclude: { rooms: roomSet, items: new Set(items), walls: (w) => d.wallStarts?.has(w.wallId) || (w.rooms || []).some((id) => roomSet.has(id)) },
  });
}

function applyMarquee() {
  const m = state.marquee;
  if (m && state.modeName === 'landscape') { applyLandscapeMarquee(m); return; }
  if (!m || (Math.abs(m.x2 - m.x1) < 6 && Math.abs(m.y2 - m.y1) < 6)) return;
  const poly = [
    screenToPlan(m.x1, m.y1), screenToPlan(m.x2, m.y1),
    screenToPlan(m.x2, m.y2), screenToPlan(m.x1, m.y2),
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
  const wallIds = (state.project.walls || [])
    .filter((wall) => !wall.hidden && contains(wall.axis.a.x, wall.axis.a.y) && contains(wall.axis.b.x, wall.axis.b.y))
    .map((wall) => wall.id);
  selectPlanObjects(roomIds, itemIds, wallIds);
}

// Калибровка и «Север по 2 точкам»: привязка второй точки к лучам от первой.
function snapTwoPointTool(world, event) {
  const pts = state.tool.points;
  return snapAt(world, event, { prev: pts[0] || null, points: pts, grid: 0 }).point;
}

// Перетаскивание вершины границы/красной линии/дороги — с привязками.
function snapSiteVertex(d, world, event) {
  const site = state.project.site;
  const closed = d.siteKind === 'boundary' ? true
    : d.siteKind === 'redline' ? Boolean(site.redLineClosed)
      : Boolean(site.roads.find((r) => r.id === d.id)?.closed);
  return snapAt(world, event, {
    prev: dragPrev(d.points, d.index, closed), grid: 100,
    exclude: { siteKind: d.siteKind, siteId: d.id }, extraShapes: chainsWithout(d.points, d.index, closed),
  }).point;
}

// Последнее положение указателя — для пересчёта привязки по Shift/Ctrl/F8.
let lastHover = null;
setSnapRehover((mods) => {
  if (!lastHover || drag) return;
  updateHoverAndGhost(lastHover.world, lastHover.plan, mods);
});

function updateHoverAndGhost(world, plan, event) {
  lastHover = { world, plan };
  if (state.tool?.kind === 'move-furniture') { canvas.style.cursor = 'crosshair'; return; }
  if (state.tool?.kind === 'align-view') {
    // «Выровнять вид»: привязка к рёбрам/углам стен, комнат, участка, соседей.
    const p = snapAlignPoint(world, event);
    state.alignCursor = state.tool.points.length === 1 ? p : null;
    requestDraw();
    return;
  }
  if (state.modeName === 'landscape' && landscapeHover(world, canvas, event)) return;
  // «План крыши»: наведение — только крыши (ui/roof-plan.js).
  if (isRoofPlan()) { roofPlanHover(plan, event?.clientX !== undefined ? pointerScreen(event) : null, event); return; }
  if (state.tool?.kind === 'place-furniture') {
    const def = furnitureDef(state.tool.itemKind);
    if (!def) return;
    const item = {
      id: '__ghost-item__', kind: state.tool.itemKind,
      x: Math.round(plan.x / gridStep()) * gridStep(),
      y: Math.round(plan.y / gridStep()) * gridStep(),
      w: def.w, h: def.h, rotation: state.tool.rotation || 0,
    };
    withDefaultComp(item);
    // Лестница — сразу рассчитанная по высоте этажа, выбранной формы.
    if (item.kind === 'stairs') {
      applyStairPreset(item, state.tool.stairShape || 'straight', activeLevel(state.project)?.height || 3000);
      applyStairStylePreset(item, state.tool.stairPreset);
    }
    state.ghostItem = item;
    requestDraw();
    return;
  }
  if (state.tool?.kind === 'place-room') {
    const placement = roomPlacementContext(plan);
    const placementPlan = placement.at;
    const placementProject = placement.project;
    const def = roomType(state.tool.type);
    const turned = (state.tool.rotation || 0) % 180 !== 0;
    const w = turned ? def.h : def.w;
    const h = turned ? def.w : def.h;
    let x = placementPlan.x - w / 2;
    let y = placementPlan.y - h / 2;
    const parentId = def.open ? null : determineParent(placementProject, { x, y, w, h }, null);
    let snapped = snapRoomPosition(placementProject, { id: '__ghost__', type: def.type, w, h }, x, y, 14 / state.view.scale, parentId, gridStep());
    // Эскиз масс: свободные оси липнут к рёбрам контура (ui/block-gesture.js).
    if (!event?.shiftKey && !event?.altKey) snapped = sketchMagnet({ ...snapped, guides: [...snapped.guides] }, { x, y, w, h });
    x = snapped.x; y = snapped.y;
    const verdict = validateRoomPlacement(placementProject, { type: def.type, x, y, w, h, parentId }, null);
    // Пока сам дом ещё не повернут, его старые направляющие визуально не
    // совпали бы с предпросмотром будущих осей.
    state.guides = placement.building ? [] : snapped.guides;
    state.ghost = {
      rect: { x, y, w, h },
      building: placement.building,
      valid: verdict.ok,
      warn: Boolean(verdict.warning),
      label: parentId ? `Вложить в «${roomById(state.project, parentId)?.name}»` : undefined,
      reason: verdict.ok ? (verdict.warning || '') : verdict.reason,
    };
    requestDraw();
    return;
  }
  if (state.tool?.kind === 'calibrate' || state.tool?.kind === 'north') {
    // Две точки по клику — с привязками черчения (лучи, объекты; без сетки).
    const p = snapTwoPointTool(world, event);
    if (state.tool.kind === 'calibrate') state.calCursor = state.tool.points.length === 1 ? p : null;
    else state.northCursor = state.tool.points.length === 1 ? p : null;
    requestDraw();
    return;
  }
  if (state.tool?.kind === 'entry') {
    // Предпросмотр: стрелка скользит по границе за курсором.
    state.entryGhost = computeEntryAt(world);
    requestDraw();
    return;
  }
  if (state.tool?.kind === 'place-opening') {
    state.ghostOpening = null;
    state.ghostOpeningFull = null;
    state.ghostDoor = null;
    state.openingFree = event.shiftKey;
    const res = computeOpeningParams(plan);
    if (res && res.opening && !res.error) {
      if (state.tool.openKind === 'door') {
        state.ghostDoor = res.opening; // превью двери со створкой и направлением
      } else {
        const placed = openingRect(state.project, res.opening, state.walls);
        if (placed) state.ghostOpening = { rect: placed.rect };
        state.ghostOpeningFull = res.opening; // для размеров до соседей
      }
    }
    requestDraw();
    return;
  }
  if (state.tool?.kind === 'atrium') { atriumHover(plan); return; }
  if (state.tool?.kind === 'slab-opening') { slabToolHover(plan, event); return; }
  if (state.draft) {
    // Возврат к первой точке (от 3 точек) — замыкание; иначе привязки черчения.
    updateDraftCursor(world, event);
    return;
  }
  if (state.tool?.kind === 'wall') { wallToolHover(plan, event); return; }
  if (state.tool?.kind === 'psec') { planSectionHover(plan, event); return; }
  if (state.tool?.kind === 'mass') { massPlanHover(plan, event); return; }
  if (state.tool?.kind === 'grid') { gridToolHover(plan, event); return; }
  if (state.tool?.kind === 'bound-room') { boundRoomHover(plan); return; }
  if (state.tool?.kind === 'terrain') {
    const s = worldToScreen(world.x, world.y);
    const tp = hitTerrainPoint(s);
    const next = tp ? { type: 'site-obj', kind: 'terrain-point', id: tp.id } : null;
    canvas.style.cursor = tp ? 'move' : 'crosshair';
    if (JSON.stringify(next) !== JSON.stringify(state.hover)) { state.hover = next; requestDraw(); }
    return;
  }
  if (state.tool?.kind === 'edit') {
    const screen = event?.clientX !== undefined ? pointerScreen(event) : worldToScreen(world.x, world.y);
    const vertex = hitSiteVertex(screen);
    const midpoint = state.tool.target === 'boundary' ? hitSiteMidpoint(screen) : null;
    canvas.style.cursor = midpoint && (!vertex || midpoint.distance < vertex.distance)
      ? 'copy' : vertex ? 'move' : 'crosshair';
    return;
  }
  if (state.tool) return;

  // «Участок»: внутренности дома не подсвечиваются — дом целиком (тянуть).
  if (state.modeName === 'site') {
    const onHouse = pointInBuilding(state.project, world);
    let next = onHouse ? { type: 'site-obj', kind: 'building' } : null;
    if (!next) {
      const site = hitSiteObject(world);
      if (site) next = { type: 'site-obj', kind: site.kind, id: site.id };
    }
    canvas.style.cursor = onHouse ? 'move' : 'grab';
    if (JSON.stringify(next) !== JSON.stringify(state.hover)) { state.hover = next; requestDraw(); }
    return;
  }

  // Замок «стена — ось»: мгновенная подсказка, курсор-рука.
  // На ручке грани выбранной комнаты — ручка (её курсор), а не замок.
  const lockHover = event?.clientX !== undefined && !hitRoomHandle(pointerScreen(event)) ? hitGridLock(state, pointerScreen(event)) : null;
  showLockTip(lockHover, event);
  if (lockHover) { canvas.style.cursor = 'pointer'; return; }

  // Подсветка под курсором: линии разрезов, мебель, проёмы, стены, комнаты, объекты участка.
  let nextHover = event?.clientX !== undefined ? planSectionHoverTarget(pointerScreen(event)) : null;
  // Проём в перекрытии — по контуру, диагоналям и подписи (ui/slab-ui.js).
  if (!nextHover && event?.clientX !== undefined) nextHover = slabHoverTarget(pointerScreen(event));
  // Координационные оси: кружки — везде, линия — вне комнат и стен (ui/grids.js).
  if (!nextHover && event?.clientX !== undefined && state._gridUI?.length) {
    nextHover = gridHoverTarget(pointerScreen(event), !hitRoom(plan) && !hitWall(plan));
  }
  const item = nextHover ? null : hitItem(plan);
  if (item) nextHover = { type: 'item', id: item.id };
  if (!nextHover) {
    const opening = hitOpening(plan);
    if (opening) nextHover = { type: 'opening', id: opening.id };
  }
  if (!nextHover) {
    const wall = hitWall(plan);
    if (wall) nextHover = { type: 'wall', key: wall.key, from: wall.kind === 'manual' ? undefined : wall.from };
  }
  if (!nextHover) {
    const room = hitRoom(plan);
    if (room) nextHover = { type: 'room', id: room.id };
  }
  if (!nextHover && state.modeName === 'site') {
    const site = hitSiteObject(world);
    if (site) nextHover = { type: 'site-obj', kind: site.kind, id: site.id };
  }
  canvas.style.cursor = nextHover ? 'pointer' : 'crosshair';
  if (event?.clientX !== undefined && state._tempDimsUI && hitTempDim(pointerScreen(event))) canvas.style.cursor = 'text';
  if (JSON.stringify(nextHover) !== JSON.stringify(state.hover)) {
    state.hover = nextHover;
    requestDraw();
  }
}

export function bindCanvasInput() {
  let splitCursor = null;
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('pointerleave', () => hideLockTip()); // подсказка замка «стена — ось»
  canvas.addEventListener('selectstart', (e) => e.preventDefault()); // долгое нажатие не выделяет холст
  // Esc во время жеста «тянуть ребро» ландшафта — отмена (раньше общих клавиш).
  window.addEventListener('keydown', (e) => {
    if (state.tool?.kind === 'move-furniture') {
      if (e.key === 'Escape' || ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ')) {
        e.preventDefault();
        e.stopImmediatePropagation();
        cancelTool();
        return;
      }
      // Иная команда сначала отменяет предпросмотр переноса.
      if (!['Shift', 'Control', 'Alt', 'Meta', 'CapsLock'].includes(e.key)) cancelTool();
    }
    // Esc во время жеста на «Плане крыши» — отмена жеста.
    if (e.key === 'Escape' && drag?.kind?.startsWith('roofplan-')) {
      e.preventDefault();
      e.stopImmediatePropagation();
      const finished = drag;
      drag = null;
      roofPlanDragCancel(finished);
      return;
    }
    // Esc во время перетаскивания оси — отмена жеста (ui/grids.js).
    if (e.key === 'Escape' && drag?.kind?.startsWith('grid-')) {
      e.preventDefault();
      e.stopImmediatePropagation();
      const finished = drag;
      drag = null;
      if (finished.moved) restoreFrom(finished.before);
      selectObject({ type: 'grid', id: finished.id });
      requestDraw();
      return;
    }
    // Esc во время ручки лестницы — отмена жеста целиком.
    if (e.key === 'Escape' && drag?.kind === 'stair-handle') {
      e.preventDefault();
      e.stopImmediatePropagation();
      const finished = drag;
      drag = null;
      state.stairLabel = null;
      if (finished.moved) restoreFrom(finished.before);
      selectObject({ type: 'item', id: finished.id });
      requestDraw();
      return;
    }
    // Esc во время растяжения комнаты ручкой — отмена жеста целиком (и
    // соседей по общей стене, и уступа у них): проект — как до жеста.
    if (e.key === 'Escape' && (drag?.kind === 'resize' || drag?.kind === 'shape-resize')) {
      e.preventDefault();
      e.stopImmediatePropagation();
      const finished = drag;
      drag = null;
      cancelLiveDerived(finished);
      state.ghost = null;
      state.guides = [];
      if (finished.moved) {
        if (finished.kind === 'shape-resize') state.pendingRoomSplit = null; // снимок до деления
        restoreFrom(finished.before);
        if (roomById(state.project, finished.roomId)) selectObject({ type: 'room', id: finished.roomId });
      } else if (finished.kind === 'shape-resize' && pendingSplitHas(finished.roomId)) revertPendingSplit();
      refreshDerived();
      requestDraw();
      return;
    }
    // Esc во время перетаскивания конца перил — перила как до жеста.
    if (e.key === 'Escape' && drag?.kind === 'railing-end') {
      e.preventDefault();
      e.stopImmediatePropagation();
      const finished = drag;
      drag = null;
      if (finished.moved) {
        restoreFrom(finished.before);
        selectObject({ type: 'railing', roomId: finished.roomId, id: finished.id });
      }
      requestDraw();
      return;
    }
    if (e.key !== 'Escape' || !drag || !cancelLandscapeDrag(drag)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    drag = null;
  }, true);
  // Перетаскивание мебели из панели на план.
  canvas.addEventListener('dragover', (e) => {
    if (state.modeName === 'landscape' && (e.dataTransfer?.types || []).includes(LANDSCAPE_MIME)) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      return;
    }
    if (state.modeName !== 'plan') return;
    const t = e.dataTransfer?.types || [];
    if (!t.includes('application/x-kepler-furn') && !t.includes('application/x-kepler-room')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  });
  canvas.addEventListener('drop', (e) => {
    const rect = canvas.getBoundingClientRect();
    if (state.modeName === 'landscape') {
      const kind = e.dataTransfer?.getData(LANDSCAPE_MIME);
      if (kind) {
        e.preventDefault();
        dropLandscape(kind, screenToWorld(e.clientX - rect.left, e.clientY - rect.top));
      }
      return;
    }
    if (state.modeName !== 'plan') return;
    const roomType = e.dataTransfer?.getData('application/x-kepler-room');
    if (roomType) {
      e.preventDefault();
      cancelTool();
      const at = screenToPlan(e.clientX - rect.left, e.clientY - rect.top);
      placeRoomAt(at, roomType);
      return;
    }
    const kind = e.dataTransfer?.getData('application/x-kepler-furn') || e.dataTransfer?.getData('text/plain');
    if (!kind || !furnitureDef(kind)) return;
    e.preventDefault();
    const at = screenToPlan(e.clientX - rect.left, e.clientY - rect.top);
    addFurnitureAt(kind, at.x, at.y);
  });
  const onCanvasPointerDown = (event) => {
    const screen = pointerScreen(event);
    state.coarsePointer = event.pointerType === 'touch';
    closeLibrarySheet(); // телефон: нажали на план — библиотека уезжает
    if (event.pointerType === 'touch') {
      touches.set(event.pointerId, screen);
      if (touches.size === 2) { canvas.setPointerCapture(event.pointerId); startPinch(); return; }
      if (touches.size > 2) return;
    }
    const world = pointerWorld(event); // участок — координаты съёмки
    const plan = worldToPlan(world); // дом — его собственные оси
    canvas.setPointerCapture(event.pointerId);
    if (state.tool?.kind === 'move-furniture') {
      if (event.button === 2) { cancelTool(); return; }
      if (event.button !== 0) return;
      if (drag?.clickMove) {
        drag.placing = true;
        onCanvasPointerMove(event);
        return;
      }
      const item = hitItem(plan);
      if (!item || !state.tool.itemIds.includes(item.id)) return;
      tapOrNow(event, screen, () => {
        if (state.tool?.kind !== 'move-furniture') return;
        if (state.tool.itemIds.length > 1) startMultiDrag(plan);
        else drag = {
          kind: 'item', id: item.id, start: { x: item.x, y: item.y }, plan,
          before: snapshot(), moved: false,
        };
        drag.clickMove = true;
        state.tool.stage = 'place';
        setHint('Мебель следует за указателем · Нажмите, чтобы поставить · Esc — отмена');
        renderSelectionToolbar();
        canvas.style.cursor = 'grabbing';
        requestDraw();
      });
      return;
    }
    // Деление стены: клик режет по линии деления.
    if (state.splitEdit && event.button === 0 && !spaceDown) {
      if (splitLiveClick(plan, screen, event.pointerType === 'touch')) return;
    }

    // Правый клик по замку «стена — ось» — сменить режим (по грани ↔ по центру).
    if (event.button === 2 && !spaceDown) {
      const lockR = hitGridLock(state, screen);
      if (lockR) { toggleGridLock(lockR, { switchMode: true }); return; }
    }
    // Панорама: правая/средняя кнопка или зажатый пробел.
    if (event.button === 1 || event.button === 2 || spaceDown) {
      drag = { kind: 'pan', start: screen, view: { ...state.view } };
      return;
    }

    // «Выровнять вид» — в любом режиме (на касании — по тапу).
    if (state.tool?.kind === 'align-view') {
      const p = snapAlignPoint(world, event);
      tapOrNow(event, screen, () => addAlignViewPoint(p));
      return;
    }

    // --- «План крыши»: только крыши (ui/roof-plan.js); этажи — подложка ---
    if (isRoofPlan()) {
      drag = roofPlanPointerDown(event, screen, plan);
      return;
    }

    // --- «Ландшафт»: свои объекты, ручки, рамка (ui/landscape.js) ---
    if (state.modeName === 'landscape') {
      drag = landscapePointerDown(event, screen, world);
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
      tapOrNow(event, screen, () => placeNeighborAt(world)); // пустое место — новый дом
      return;
    }
    const touchPan = () => {
      if (event.pointerType === 'touch') drag = { kind: 'pan', start: screen, view: { ...state.view } };
    };
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
      touchPan();
      return;
    }
    if (layer === 'entry' || layer === 'wicket') {
      // Касанием: новый въезд — тапом, существующий двигается после удержания.
      const hit = hitSiteObject(world);
      if (hit?.kind === 'entry') startEntryDrag(world, hit);
      else tapOrNow(event, screen, () => startEntryDrag(world));
      return;
    }
    if (layer === 'terrain') {
      const tp = hitTerrainPoint(screen);
      if (tp) {
        // Открытое поле с введённым числом — сохраняем, пустое — закрываем.
        if (state.elevEdit) applyElevInput({ quiet: true });
        selectObject({ type: 'site', kind: 'terrain-point', id: tp.id });
        drag = { kind: 'terrain-point', id: tp.id, start: { x: tp.x, y: tp.y }, world, screen, before: snapshot(), moved: false };
        return;
      }
      tapOrNow(event, screen, () => {
        if (state.elevEdit) applyElevInput({ quiet: true });
        openElevInput(world);
      });
      return;
    }
    if (layer === 'boundary' || layer === 'redline' || layer === 'road') {
      const v = hitSiteVertex(screen);
      const midpoint = layer === 'boundary' ? hitSiteMidpoint(screen) : null;
      // На короткой стороне мобильные зоны попадания вершины и средней
      // ручки пересекаются. Выбираем действительно ближайший значок.
      if (midpoint && (!v || midpoint.distance < v.distance)) {
        const before = snapshot();
        midpoint.points.splice(midpoint.index, 0, { x: midpoint.x, y: midpoint.y });
        drag = {
          kind: 'site-vertex', siteKind: midpoint.kind, index: midpoint.index,
          points: midpoint.points, before, moved: true, inserted: true,
        };
        requestDraw();
        return;
      }
      if (v) {
        drag = { kind: 'site-vertex', siteKind: v.kind, id: v.id, index: v.index, points: v.points, before: snapshot(), moved: false };
        return;
      }
      // Режим черчения нового контура: точка — на тапе.
      if (state.draft) { tapOrNow(event, screen, () => { if (state.draft) addDraftPoint(world, event); }); return; }
      touchPan();
      return;
    }

    // --- Прочие инструменты плана (на касании — по тапу) ---
    if (state.tool) {
      const t = state.tool;
      if (t.kind === 'place-room') { tapOrNow(event, screen, () => placeRoomAt(plan)); return; }
      if (t.kind === 'place-furniture') {
        const { itemKind, rotation = 0, stairShape, stairPreset } = t;
        tapOrNow(event, screen, () => { cancelTool(); addFurnitureAt(itemKind, plan.x, plan.y, rotation, { stairShape, stairPreset }); });
        return;
      }
      if (t.kind === 'place-opening') { state.openingFree = event.shiftKey; tapOrNow(event, screen, () => placeOpeningAt(plan)); return; }
      if (t.kind === 'atrium') { tapOrNow(event, screen, () => atriumClick(plan)); return; }
      if (t.kind === 'slab-opening') { tapOrNow(event, screen, () => slabToolClick(plan, event)); return; }
      if (t.kind === 'wall') {
        const mods = { shiftKey: event.shiftKey };
        tapOrNow(event, screen, () => wallToolClick(plan, mods));
        return;
      }
      if (t.kind === 'bound-room') { tapOrNow(event, screen, () => boundRoomClick(plan)); return; }
      if (t.kind === 'psec') {
        const mods = { shiftKey: event.shiftKey, ctrlKey: event.ctrlKey };
        tapOrNow(event, screen, () => planSectionClick(plan, mods));
        return;
      }
      if (t.kind === 'mass') {
        const mods = { shiftKey: event.shiftKey, ctrlKey: event.ctrlKey };
        tapOrNow(event, screen, () => massPlanClick(plan, mods));
        return;
      }
      if (t.kind === 'grid') {
        const mods = { shiftKey: event.shiftKey };
        tapOrNow(event, screen, () => gridToolClick(plan, mods));
        return;
      }
      if (t.kind === 'north') { const p = snapTwoPointTool(world, event); tapOrNow(event, screen, () => addNorthPoint(p)); return; }
      if (t.kind === 'calibrate') { const p = snapTwoPointTool(world, event); tapOrNow(event, screen, () => addCalibratePoint(p)); return; }
      touchPan();
      return;
    }

    // «Участок» без инструмента: мебель, комнаты и проёмы не выбираются —
    // дом хватается только целиком (за любую комнату) и едет по участку.
    if (state.modeName === 'site') {
      if (state.calibration && !el('calOverlay').hidden) hideCalInput();
      const hit = hitSiteObject(world);
      if (hit?.kind === 'entry') { startEntryDrag(world, hit); return; }
      if (pointInBuilding(state.project, world)) {
        selectObject({ type: 'site', kind: 'building' });
        const o = state.project.building?.origin || { x: 0, y: 0 };
        drag = { kind: 'building', start: { x: o.x, y: o.y }, world, before: snapshot(), moved: false };
        return;
      }
      selectObject(null);
      drag = { kind: 'pan', start: screen, view: { ...state.view } };
      return;
    }

    // Клик мимо поля калибровки — отменяем калибровку.
    if (state.calibration && !el('calOverlay').hidden) { hideCalInput(); }
    if (!el('dimInput').hidden) hideDimInput();
    if (state.sofaMenu) hideSofaMenu();

    // Стрелки-перевороты и размерные подписи выбранного проёма.
    if (state.selection?.type === 'opening' && state._openingUI) {
      for (const f of state._openingUI.flips) {
        if (Math.hypot(f.x - screen.x, f.y - screen.y) <= 15) { tapOrNow(event, screen, () => toggleOpeningFlip(f.kind)); return; }
      }
      for (const d of state._openingUI.dims) {
        if (Math.hypot(d.x - screen.x, d.y - screen.y) <= 20) { tapOrNow(event, screen, () => openDimInput(d)); return; }
      }
    }
    // Ручка ↕ выбранной стены важнее подписи размера рядом: нажатие на неё —
    // сдвиг стены (ниже), а не поле ввода.
    const wallGrip = state.selection?.type === 'wall' ? state._wallUI?.grip : null;
    const onWallGrip = wallGrip && Math.hypot(wallGrip.x - screen.x, wallGrip.y - screen.y) <= wallGrip.r;
    if (state.selection?.type === 'wall' && state._wallUI && !onWallGrip) {
      for (const d of state._wallUI.dims) {
        if (Math.hypot(d.x - screen.x, d.y - screen.y) <= 20) { tapOrNow(event, screen, () => openDimInput(d)); return; }
      }
    }
    // Подпись временного размера мебели — раньше ручек и перетаскивания предмета.
    // На телефоне поле открывается на тапе (отпускании пальца): focus() из
    // жеста открывает клавиатуру, а свайп по подписи — панорама.
    // Замок «стена — ось» (ui/grid-locks.js): клик прикрепляет/открепляет —
    // раньше стены и оси под ним.
    // Ручка грани выбранной комнаты важнее замка, подписи и маркера зазора,
    // лежащих на ней (у общей стены «≈250 мм» стоит ровно на ручке грани).
    const onRoomHandle = Boolean(hitRoomHandle(screen));
    const lockHit = onRoomHandle ? null : hitGridLock(state, screen);
    if (lockHit) { const sw = Boolean(event.shiftKey); tapOrNow(event, screen, () => toggleGridLock(lockHit, { switchMode: sw })); return; }
    // Shift расширяет выделение, даже если подпись размера лежит над мебелью.
    const tempDimHit = onRoomHandle || event.shiftKey ? null : hitTempDim(screen);
    if (tempDimHit) { tapOrNow(event, screen, () => openDimInput(tempDimHit)); return; }

    // Маркер нестандартного зазора «≠ N мм» — выделить пару и предложить стыковку.
    const gapHit = onRoomHandle ? null : gapMarkerAt(screen.x, screen.y);
    if (gapHit) { focusGap(gapHit); return; }

    // «+» слева/справа у кровати — раньше обычных ручек группы и выбора
    // предметов, потому что кнопка лежит как раз в месте будущей тумбы.
    if (state._bedsideUI?.spots?.length) {
      const tolPx = state.coarsePointer ? 6 : 3;
      const spot = state._bedsideUI.spots.find((entry) => Math.hypot(entry.x - screen.x, entry.y - screen.y) <= entry.r + tolPx);
      if (spot) {
        addBedsideNightstand(state._bedsideUI.bedId, spot.side);
        return;
      }
    }

    // Кнопки «+» выделенного дивана-конструктора — раньше ручек и перетаскивания.
    if (state.selection?.type === 'item' && state._sofaUI?.itemId === state.selection.id) {
      const tolPx = state.coarsePointer ? 6 : 3;
      const spot = state._sofaUI.spots.find((sp) => Math.hypot(sp.x - screen.x, sp.y - screen.y) <= sp.r + tolPx);
      const item = spot && state.project.items.find((i) => i.id === state.selection.id);
      if (item) { tapOrNow(event, screen, () => openSofaMenu(item, spot)); return; }
    }

    // Элементы выделенной кухни-конструктора (ручка или сам элемент) —
    // перетаскиваются вдоль стороны раньше, чем вся кухня целиком.
    if (state.selection?.type === 'item' && state._kitchenUI?.itemId === state.selection.id) {
      const item = state.project.items.find((i) => i.id === state.selection.id);
      const tolPx = state.coarsePointer ? 6 : 3;
      let h = null; let hd = Infinity;
      for (const hh of state._kitchenUI.handles) {
        const d = Math.hypot(hh.x - screen.x, hh.y - screen.y);
        if (d <= hh.r + tolPx && d < hd) { h = hh; hd = d; }
      }
      // Длина стороны, глубина, ширина элемента — правка по смещению указателя.
      if (item && h && h.op !== 'move') {
        drag = {
          kind: 'kitchen-handle', id: item.id, handle: h.h, plan,
          start: { comp: structuredClone(item.comp), x: item.x, y: item.y },
          before: snapshot(), moved: false,
        };
        return;
      }
      const type = h?.type || (item && kitchenElementAt(item, plan.x, plan.y)?.type);
      const el = type && item.comp.items.find((e) => e.type === type);
      const at = el && kitchenProject(item, plan.x, plan.y);
      if (el && at) {
        drag = {
          kind: 'kitchen-elem', id: item.id, type,
          grab: at.side === el.side ? at.t - el.x : el.w / 2,
          start: { comp: structuredClone(item.comp), x: item.x, y: item.y },
          before: snapshot(), moved: false,
        };
        return;
      }
    }

    // Ручки выделенной лестницы: ступени по маршам, ширина марша, площадки.
    if (state.selection?.type === 'item' && state._stairUI?.itemId === state.selection.id && itemsEditable(state.view.scale)) {
      const item = state.project.items.find((i) => i.id === state.selection.id);
      const tolPx = state.coarsePointer ? 6 : 3;
      let h = null; let hd = Infinity;
      for (const hh of state._stairUI.handles) {
        const d = Math.hypot(hh.x - screen.x, hh.y - screen.y);
        if (d <= hh.r + tolPx && d < hd) { h = hh; hd = d; }
      }
      if (item && h) {
        // Ручка нарисована чуть снаружи кромки: тянем от точки захвата.
        const grab = h.plan ? { x: plan.x - h.plan.x, y: plan.y - h.plan.y } : { x: 0, y: 0 };
        drag = { kind: 'stair-handle', id: item.id, handle: h.id, grab, start: structuredClone(item), before: snapshot(), moved: false };
        return;
      }
    }

    // Проём в перекрытии (ui/slab-ui.js): ручки выбранного, контур — выбор и сдвиг.
    if (!onRoomHandle || state.selection?.type === 'slab') {
      const slabDrag = slabPointerDown(event, screen, plan);
      if (slabDrag) { drag = slabDrag; return; }
    }
    // Линия разреза: ручки концов, сдвиг, выбор (поверх комнат и стен).
    const secDrag = planSectionPointerDown(event, screen, plan);
    if (secDrag) { drag = secDrag; return; }
    // Координационная ось: кружок любой оси или линия выбранной (ui/grids.js).
    const gridDrag = gridPointerDown(event, screen, plan);
    if (gridDrag) { drag = gridDrag; return; }

    // Ручки плановых объектов.
    const wallEndHit = hitManualWallEnd(screen);
    if (wallEndHit) {
      drag = {
        kind: 'mwall-end', id: wallEndHit.wall.id, end: wallEndHit.end, before: snapshot(), moved: false,
        start: structuredClone(wallEndHit.wall),
        hostStarts: state.project.openings.filter((o) => o.host?.wallId === wallEndHit.wall.id)
          .map((o) => ({ id: o.id, host: { ...o.host } })),
      };
      return;
    }
    // Ручка конца выбранных перил: укоротить/удлинить вдоль стороны.
    const railEndHit = hitRailingEnd(screen);
    if (railEndHit) {
      drag = {
        kind: 'railing-end', roomId: railEndHit.room.id, id: railEndHit.seg.id, end: railEndHit.end,
        before: snapshot(), moved: false,
      };
      return;
    }
    const openingHandleHit = hitOpeningHandle(screen);
    if (openingHandleHit) {
      drag = { kind: 'opening-handle', id: openingHandleHit.opening.id, end: openingHandleHit.end, before: snapshot(), moved: false };
      return;
    }
    const handleHit = hitRoomHandle(screen);
    if (handleHit) {
      if (handleHit.shapeHandle?.kind) {
        const pending = pendingSplitHas(handleHit.room.id) ? state.pendingRoomSplit : null;
        drag = {
          kind: 'shape-resize', roomId: handleHit.room.id, handle: handleHit.shapeHandle,
          before: pending?.before || snapshot(), moved: false, valid: true, merged: false,
          anchors: captureOpeningAnchors(state.project, handleHit.room),
          under: { [handleHit.room.id]: eatersOf(handleHit.room) },
          layoutItemIdsByRoom: captureLayoutItemIds(),
        };
      } else {
        drag = {
          kind: 'resize', roomId: handleHit.room.id, handle: handleHit.handle, start: structuredClone(handleHit.room),
          before: snapshot(), plan, valid: true, anchors: captureOpeningAnchors(state.project, handleHit.room),
          under: { [handleHit.room.id]: eatersOf(handleHit.room) },
          layoutItemIdsByRoom: captureLayoutItemIds(),
        };
      }
      return;
    }
    const itemHandleHit = hitItemHandle(screen);
    if (itemHandleHit) {
      const item = state.project.items.find((i) => i.id === state.selection.id);
      if (itemHandleHit.mode === 'rotate') {
        drag = {
          kind: 'item-rotate', id: item.id, startRot: item.rotation || 0,
          startAngle: Math.atan2(plan.y - item.y, plan.x - item.x), center: { x: item.x, y: item.y },
          before: snapshot(), moved: false,
        };
      } else if (itemHandleHit.mode === 'stretch') {
        drag = { kind: 'item-stretch', id: item.id, edge: itemHandleHit.edge, before: snapshot(), moved: false };
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
    const groupHandleHit = hitGroupHandle(screen);
    if (groupHandleHit) {
      const items = groupItems(state.project, state.selection);
      const box = groupHandleHit.box;
      drag = {
        kind: `group-${groupHandleHit.mode}`, edge: groupHandleHit.edge, corner: groupHandleHit.corner,
        box, center: groupCenter(box), startPoint: { x: plan.x, y: plan.y },
        starts: groupStarts(items), before: snapshot(), moved: false,
      };
      return;
    }

    // Серия кликов в одной точке перебирает все лежащие здесь объекты:
    // первый — верхний, второй — следующий под ним, третий — ещё ниже.
    const stack = hitPlanStack(plan);
    const picked = pickStackHit(stack, stackPickNumber(stack, event));

    if (picked?.type === 'item') {
      const item = picked.entity;
      if (event.shiftKey) { toggleInMulti('item', item.id); return; }
      if (state.selection?.type === 'multi' && state.selection.itemIds.includes(item.id)) {
        startMultiDrag(plan, state.selection, true);
        return;
      }
      const wasSelected = state.selection?.type === 'item' && state.selection.id === item.id;
      const groupSel = item.group ? selectGroup(item.group) : null;
      if (groupSel?.type === 'multi') { startMultiDrag(plan, groupSel); return; }
      selectObject({ type: 'item', id: item.id });
      drag = { kind: 'item', id: item.id, start: { x: item.x, y: item.y }, plan, before: snapshot(), moved: false, wasSelected };
      return;
    }

    if (picked?.type === 'opening') {
      const opening = picked.entity;
      if (opening.spanPart === 'upper') {
        switchLevel(opening.spanOwnerLevelId, { planView: false });
        selectObject({ type: 'opening', id: opening.id });
        toast(`Витраж на два этажа · ${activeLevel(state.project).name}`);
        return;
      }
      selectObject({ type: 'opening', id: opening.id });
      if (opening.corner) return;
      drag = { kind: 'opening', id: opening.id, before: snapshot(), moved: false };
      const stored = state.project.openings.find((o) => o.id === opening.id);
      if (isGlazedAssembly(stored)) {
        const placed = openingRect(state.project, stored, state.walls);
        if (placed) drag.grabOffset = openingPosAt(state.project, stored, state.walls,
          placed.wall.orient === 'h' ? plan.x : plan.y) - openingPos(stored);
      }
      return;
    }

    if (picked?.type === 'railing') {
      selectObject({ type: 'railing', roomId: picked.roomId, id: picked.id, at: Math.round(picked.at) });
      return;
    }

    if (picked?.type === 'wall') {
      const wall = picked.entity;
      const manual = wall.kind === 'manual';
      if (manual && event.shiftKey) { toggleInMulti('wall', wall.wallId); return; }
      if (manual && state.selection?.type === 'multi' && state.selection.wallIds?.includes(wall.wallId)) {
        startMultiDrag(plan, state.selection, true);
        return;
      }
      // Ручная стена выбирается по ключу: её начало (from) меняется при правке.
      selectObject({ type: 'wall', key: wall.key, from: manual ? undefined : wall.from, at: wall.orient === 'h' ? plan.x : plan.y });
      drag = {
        kind: 'wall', key: wall.key, from: wall.from, wall: structuredClone(wall),
        plan, before: snapshot(), moved: false, valid: true,
        roomStarts: wall.rooms.map((id) => ({ id, room: structuredClone(roomById(state.project, id)) })).filter((entry) => entry.room),
        layoutItemIdsByRoom: captureLayoutItemIds(),
        openingStarts: state.project.openings.filter((o) => (manual ? Boolean(o.host) : wall.rooms.includes(o.roomId)))
          .map((o) => (o.host ? { id: o.id, host: { ...o.host } } : { id: o.id, side: o.side, offset: o.offset })),
        wallsStart: manual ? structuredClone(state.project.walls) : null,
      };
      return;
    }

    if (picked?.type === 'room') {
      const room = picked.entity;
      if (event.shiftKey) { toggleInMulti('room', room.id); return; }
      if (state.selection?.type === 'multi' && state.selection.roomIds.includes(room.id)) {
        startMultiDrag(plan);
        return;
      }
      selectObject({ type: 'room', id: room.id });
      // Перевозимый груз фиксируется в момент захвата: вложенные помещения и
      // мебель, стоящая внутри, — чтобы комната не «сметала» чужую мебель по пути.
      const children = state.project.rooms.filter((r) => r.parentId === room.id);
      // Внутри — по видимой форме (у Г/съеденной габарит шире формы: мебель
      // верхней комнаты, стоящая в «вырезе», не должна уезжать) и вложенных.
      const carriers = [room, ...children];
      const carried = state.project.items
        .filter((i) => carriers.some((r) => roomContainsPoint(r, i.x, i.y)))
        .map((i) => ({ id: i.id, x: i.x, y: i.y }));
      const carrierIds = new Set(carriers.map((candidate) => candidate.id));
      const carriedWalls = (state.project.walls || [])
        .filter((wall) => carrierIds.has(wall.ownerRoomId))
        .map((wall) => ({ id: wall.id, axis: structuredClone(wall.axis) }));
      drag = {
        kind: 'room', id: room.id, plan, start: { x: room.x, y: room.y },
        childStarts: children.map((c) => ({ id: c.id, x: c.x, y: c.y })),
        carried,
        carriedWalls,
        startParent: room.parentId, before: snapshot(), moved: false, valid: true,
        layoutItemIdsByRoom: captureLayoutItemIds(),
      };
      return;
    }

    // Линия оси вне комнат и стен — выбор и сдвиг оси.
    const gridLine = !picked && gridPointerDown(event, screen, plan, { lineAll: true });
    if (gridLine) { drag = gridLine; return; }

    // Пустое место: пальцем — панорама, мышью — рамка выделения.
    selectObject(null);
    if (event.pointerType === 'touch') {
      drag = { kind: 'pan', start: screen, view: { ...state.view } };
      return;
    }
    drag = { kind: 'marquee', start: screen };
    state.marquee = { x1: screen.x, y1: screen.y, x2: screen.x, y2: screen.y };
  };
  // Касанием объект двигается только после долгого нажатия: быстрое
  // перетаскивание — панорама (иначе объекты уезжают при случайных касаниях).
  // Ручки (размер, поворот, вершины) срабатывают сразу.
  canvas.addEventListener('pointerdown', (event) => {
    if (state.editLocked) {
      event.preventDefault();
      return;
    }
    const touch = event.pointerType === 'touch';
    const selectionBefore = touch && state.selection ? structuredClone(state.selection) : state.selection;
    state.touchDeferSelect = touch;
    state.touchDeferred = null;
    try { onCanvasPointerDown(event); } finally { state.touchDeferSelect = false; }
    const pending = state.touchDeferred;
    state.touchDeferred = null;
    if (drag?.clickMove) return;
    // Первое касание другого объекта — только выбор. Даже долгое удержание не
    // должно сразу сдвигать его; если палец пошёл в сторону, это панорама.
    // Ручки уже выбранного объекта сохраняют прежнее непосредственное действие.
    const selectFirst = touch && drag && pending
      && drag.kind !== 'tap' && drag.kind !== 'pan'
      && !sameSelectedTarget(selectionBefore, pending.selection);
    const holdable = touch && drag && (selectFirst || TOUCH_HOLD_KINDS.has(drag.kind) || drag.kind === 'pan');
    if (!holdable) { if (pending) selectObject(pending.selection); return; }
    // Касанием выбор — только тапом. Уже выбранное перемещается после долгого
    // нажатия; пустое место тем же жестом начинает рамку выделения.
    const hold = { kind: 'touch-hold', inner: drag, pending, start: pointerScreen(event), view: { ...state.view }, timer: 0 };
    if (!selectFirst) {
      hold.timer = setTimeout(() => {
        if (drag !== hold) return;
        if (hold.inner.kind === 'pan') {
          // Долгое нажатие на пустом месте — рамка выделения (затем копировать, удалить, двигать).
          const p = hold.start;
          drag = { kind: 'marquee', start: p };
          state.marquee = { x1: p.x, y1: p.y, x2: p.x, y2: p.y };
          requestDraw();
        } else {
          if (pending) selectObject(pending.selection);
          drag = hold.inner;
        }
        canvas.parentElement?.classList.add('move-armed');
        try { navigator.vibrate?.(18); } catch { /* нет вибрации */ }
      }, TOUCH_HOLD_MS);
    }
    drag = hold;
  });
  const onCanvasPointerMove = (event) => {
    const screen = pointerScreen(event);
    if (event.pointerType === 'touch' && touches.has(event.pointerId)) touches.set(event.pointerId, screen);
    if (drag?.kind === 'pinch') { movePinch(); return; }
    if (drag?.kind === 'touch-hold' || drag?.kind === 'tap') {
      if (Math.hypot(screen.x - drag.start.x, screen.y - drag.start.y) < TOUCH_HOLD_SLOP) return;
      clearTimeout(drag.timer); // свайп — панорама, отложенное действие отменяется
      drag = { kind: 'pan', start: drag.start, view: drag.view };
    }
    const world = pointerWorld(event);
    const plan = worldToPlan(world);
    // В «Плане» — координаты в осях дома, в «Участке» — координаты съёмки.
    const shown = state.modeName === 'plan' ? plan : world;
    refs.statusCursor.textContent = `${(shown.x / 1000).toFixed(2)}; ${(shown.y / 1000).toFixed(2)} м`
      + (state.modeName !== 'plan' ? terrainStatus(world) : '');

    if (!drag && state.splitEdit) {
      splitCursor = screen;
      splitLiveMove(plan);
      return;
    }
    if (!drag) { updateHoverAndGhost(world, plan, event); return; }

    if (drag.kind === 'pan') {
      markViewTouched();
      state.view.panX = drag.view.panX + (screen.x - drag.start.x);
      state.view.panY = drag.view.panY + (screen.y - drag.start.y);
      positionCalInput();
      positionElevInput();
      positionDimInput();
      if (state.selection?.type === 'wall') { const w = findWall(state.selection.key, state.selection.from); if (w) positionWallButtons(w); }
      requestDraw();
      return;
    }

    if (drag.kind.startsWith('ls-')) { landscapeDragMove(drag, world, screen, event); return; }
    if (drag.kind.startsWith('psec-')) { planSectionDragMove(drag, plan, event); return; }
    if (drag.kind.startsWith('slab-')) { slabDragMove(drag, plan, event); return; }
    if (drag.kind.startsWith('grid-')) { gridDragMove(drag, plan, event); return; }
    if (drag.kind.startsWith('roofplan-')) { roofPlanDragMove(drag, plan, screen, event); return; }

    if (drag.kind === 'terrain-point') {
      const p = state.project.site.terrain?.points.find((x) => x.id === drag.id);
      if (!p) return;
      // Порог 3 px: простой клик по точке не создаёт записи в истории.
      if (!drag.moved && Math.hypot(screen.x - drag.screen.x, screen.y - drag.screen.y) < 3) return;
      drag.moved = true;
      p.x = Math.round((drag.start.x + (world.x - drag.world.x)) / 10) * 10;
      p.y = Math.round((drag.start.y + (world.y - drag.world.y)) / 10) * 10;
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
      // Съеденная — едет её номинальная форма (целая); видимые формы
      // соседей считаются вживую, а на большом плане — при pointerup
      // (ui/block-gesture.js), чтобы курсор не замирал на каждом кадре.
      if (liftForGesture(drag, [room.id])) drag.start = { x: room.x, y: room.y };
      const rawX = drag.start.x + (plan.x - drag.plan.x);
      const rawY = drag.start.y + (plan.y - drag.plan.y);
      // Вложение перетаскиванием: родителем становится комната, внутрь которой
      // попадает прямоугольник; вытащили наружу — комната снова самостоятельная.
      const candidateParent = isOpenRoom(room)
        ? null : determineParent(state.project, { x: rawX, y: rawY, w: room.w, h: room.h }, room.id);
      room.parentId = candidateParent;
      // Магнит блоков (core/v7/magnet.js, 300 мм): грань к грани соседа с
      // зазором перегородки или выравнивание; Shift/Alt — без магнита.
      // Свободные от магнита оси — по сетке.
      const snapped = magnetMove(drag, room.id, { x: rawX, y: rawY, w: room.w, h: room.h }, candidateParent, event);
      if (!snapped.snappedX) snapped.x = Math.round(rawX / gridStep()) * gridStep();
      if (!snapped.snappedY) snapped.y = Math.round(rawY / gridStep()) * gridStep();
      // Умные направляющие — по осям, не занятым магнитом стыковки/выравнивания
      // комнат (он приоритетнее), к мебели, стенам, ландшафту и границе.
      if (!drag.guides) {
        drag.guides = startGuideSession({
          space: 'plan', moving: [roomShape(room, drag.start)], frames: [0],
          exclude: {
            rooms: new Set([room.id, ...drag.childStarts.map((c) => c.id)]),
            items: new Set(drag.carried.map((c) => c.id)),
            walls: (w) => w.rooms?.includes(room.id),
          },
        });
      }
      {
        const g = { x: snapped.x - drag.start.x, y: snapped.y - drag.start.y };
        const gd = guideDelta(drag.guides, { x: rawX - drag.start.x, y: rawY - drag.start.y }, g, event,
          { x: Boolean(snapped.snappedX), y: Boolean(snapped.snappedY) });
        snapped.x = Math.round(drag.start.x + gd.x);
        snapped.y = Math.round(drag.start.y + gd.y);
      }
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
      for (const entry of drag.carriedWalls) {
        const wall = state.project.walls.find((candidate) => candidate.id === entry.id);
        if (!wall) continue;
        wall.axis.a = { x: entry.axis.a.x + dx, y: entry.axis.a.y + dy };
        wall.axis.b = { x: entry.axis.b.x + dx, y: entry.axis.b.y + dy };
      }
      state.guides = snapped.guides;
      liveEat(drag, { touched: [room.id] });
      const verdict = validateRoomPlacement(state.project, room, room.id);
      drag.valid = verdict.ok;
      drag.reason = verdict.reason;
      const nestLabel = candidateParent && candidateParent !== drag.startParent
        ? `Вложить в «${roomById(state.project, candidateParent)?.name}»`
        : !candidateParent && drag.startParent ? 'Отделить от родителя' : ' ';
      state.ghost = { rect: { x: room.x, y: room.y, w: room.w, h: room.h }, valid: verdict.ok, label: nestLabel, reason: verdict.ok ? '' : verdict.reason };
      scheduleLiveDerived(drag, refreshDerived);
      requestDraw();
      return;
    }

    if (drag.kind === 'multi') {
      const raw = { x: plan.x - drag.plan.x, y: plan.y - drag.plan.y };
      const grid = { x: Math.round(raw.x / gridStep()) * gridStep(), y: Math.round(raw.y / gridStep()) * gridStep() };
      if (!grid.x && !grid.y && !drag.moved) return; // дрожание при клике — не перенос
      if (liftForGesture(drag, [...drag.roomStarts.keys()])) {
        for (const id of drag.roomStarts.keys()) {
          const r = roomById(state.project, id);
          if (r) drag.roomStarts.set(id, { x: r.x, y: r.y });
        }
      }
      if (!drag.guides) drag.guides = groupGuideSession(drag);
      const gd = guideDelta(drag.guides, raw, grid, event);
      const dx = Math.round(gd.x);
      const dy = Math.round(gd.y);
      drag.moved = true;
      for (const [id, start] of drag.roomStarts) {
        const room = roomById(state.project, id);
        if (room) { room.x = start.x + dx; room.y = start.y + dy; }
      }
      for (const [id, start] of drag.itemStarts) {
        const item = state.project.items.find((i) => i.id === id);
        if (item) { item.x = start.x + dx; item.y = start.y + dy; }
      }
      for (const [id, axis] of drag.wallStarts) {
        const wall = state.project.walls.find((candidate) => candidate.id === id);
        if (!wall) continue;
        wall.axis.a = { x: axis.a.x + dx, y: axis.a.y + dy };
        wall.axis.b = { x: axis.b.x + dx, y: axis.b.y + dy };
      }
      liveEat(drag, { touched: drag.roomIds });
      let valid = true;
      let reason = '';
      for (const id of drag.roomIds) {
        const room = roomById(state.project, id);
        const verdict = validateRoomPlacement(state.project, room, room.id);
        if (!verdict.ok) { valid = false; reason = verdict.reason; break; }
      }
      drag.valid = valid;
      drag.reason = reason;
      scheduleLiveDerived(drag, refreshDerived);
      requestDraw();
      return;
    }

    if (drag.kind === 'shape-resize') {
      const room = roomById(state.project, drag.roomId);
      if (!room) return;
      // Ручки — на номинальной форме (render.js roomHandles): жест правит номинал.
      if (liftForGesture(drag, [room.id])) drag.anchors = captureOpeningAnchors(state.project, room);
      liftRoom(state.project, room.id); // съели на прошлом кадре — снова номинал
      if (!room.notch && !room.outline) return;
      drag.moved = true;
      if (pendingSplitHas(room.id)) state.pendingRoomSplit.moved = true;
      // Ребро Г-комнаты на общей стене: встречные грани соседей едут с ним
      // (core/wall-follow.js); угловая ручка Г-контура — без попутчиков.
      if (drag.followEdge === undefined) {
        drag.followEdge = drag.handle.kind === 'edge' ? edgeAtPoint(room, drag.handle) : null;
        captureFollow(drag, room.id, drag.followEdge ? [drag.followEdge] : []);
      }
      const snap = (value) => Math.round(value / gridStep()) * gridStep();
      const target = { x: snap(plan.x), y: snap(plan.y) };
      const result = applyRoomShapeHandle(room, drag.handle, target, {
        mergeTolerance: Math.max(gridStep(), 14 / state.view.scale),
      });
      drag.merged = result.merged;
      drag.clamped = reanchorOpenings(state.project, room, drag.anchors).clamped;
      if (result.merged) reconcileOpenings();
      let followVerdictNow = { ok: true };
      if (drag.follow.length) {
        const e0 = drag.followEdge;
        const at = e0.orient === 'v' ? target.x : target.y;
        const cur = roomBoundaryEdges(room).filter((e) => e.orient === e0.orient && e.outward === e0.outward &&
          Math.min(e.to, e0.to) - Math.max(e.from, e0.from) > 1)
          .sort((a, b) => Math.abs(a.edge - at) - Math.abs(b.edge - at))[0];
        const d = cur ? cur.edge - e0.edge : 0;
        const rep = followFrame(drag, event.altKey ? null : (e0.orient === 'v' ? { x: d, y: 0 } : { x: 0, y: d }));
        drag.clamped.push(...rep.clamped);
        followVerdictNow = rep.ok ? followVerdict(state.project, drag.follow)
          : { ok: false, reason: 'Соседнее помещение сложной формы так не растянуть — Alt: оторвать стену' };
      }
      liveEat(drag, { touched: [room.id], under: drag.under });
      const verdict = followVerdictNow.ok ? resizeVerdict(room) : followVerdictNow;
      drag.valid = verdict.ok;
      drag.reason = verdict.reason;
      scheduleLiveDerived(drag, refreshDerived);
      requestDraw();
      return;
    }

    if (drag.kind === 'resize') {
      const room = roomById(state.project, drag.roomId);
      if (!room) return;
      if (liftForGesture(drag, [room.id])) {
        drag.start = structuredClone(room);
        drag.anchors = captureOpeningAnchors(state.project, room);
      }
      liftRoom(state.project, room.id); // съели на прошлом кадре — снова номинал
      drag.moved = true;
      drag.noSnap = event.shiftKey; // Shift — без привязок: только сетка
      // Общая стена: встречные грани соседей едут вместе с гранью ручки
      // (core/wall-follow.js) — перегородка остаётся одной, зазор не меняется.
      // Alt — «оторвать»: тянется только эта комната (и без магнита).
      captureFollow(drag, room.id, handleEdges(drag.start, drag.handle));
      const detach = event.altKey;
      applyResize(room, drag, plan);
      // Магнит блоков: подвижные грани — к граням соседей (Alt/Shift — без).
      if (!drag.noSnap) {
        const m = magnetResize(drag, room.id, { x: room.x, y: room.y, w: room.w, h: room.h }, drag.handle, event);
        Object.assign(room, m.rect);
        state.guides = m.guides;
      } else state.guides = [];
      let followDelta = null;
      if (drag.follow.length && !detach) {
        // Сдвиг грани ограничен минимумом соседей — грань упирается, а не рвёт стену.
        const s = drag.start;
        const h = drag.handle;
        const lim = followLimits(drag.follow);
        followDelta = { x: 0, y: 0 };
        if (h.includes('e')) {
          followDelta.x = clampDelta(room.x + room.w - (s.x + s.w), lim.x);
          room.w = s.x + s.w + followDelta.x - room.x;
        } else if (h.includes('w')) {
          followDelta.x = clampDelta(room.x - s.x, lim.x);
          const right = room.x + room.w;
          room.x = s.x + followDelta.x; room.w = right - room.x;
        }
        if (h.includes('s')) {
          followDelta.y = clampDelta(room.y + room.h - (s.y + s.h), lim.y);
          room.h = s.y + s.h + followDelta.y - room.y;
        } else if (h.includes('n')) {
          followDelta.y = clampDelta(room.y - s.y, lim.y);
          const bottom = room.y + room.h;
          room.y = s.y + followDelta.y; room.h = bottom - room.y;
        }
      }
      if (drag.start.notch) room.notch = structuredClone(drag.start.notch);
      clampRoomNotch(room);
      // Отступы проёмов — от room.x/y: пересчёт от снимка начала (Б3).
      drag.clamped = reanchorOpenings(state.project, room, drag.anchors).clamped;
      let followVerdictNow = { ok: true };
      if (drag.follow.length) {
        const rep = followFrame(drag, followDelta);
        drag.clamped.push(...rep.clamped);
        followVerdictNow = rep.ok ? followVerdict(state.project, drag.follow)
          : { ok: false, reason: 'Соседнее помещение сложной формы так не растянуть — Alt: оторвать стену' };
      }
      liveEat(drag, { touched: [room.id], under: drag.under });
      const verdict = followVerdictNow.ok ? resizeVerdict(room) : followVerdictNow;
      drag.valid = verdict.ok;
      drag.reason = verdict.reason;
      state.ghost = { rect: { x: room.x, y: room.y, w: room.w, h: room.h }, valid: verdict.ok, label: `${(room.w / 1000).toFixed(2)} × ${(room.h / 1000).toFixed(2)} м`, reason: verdict.ok ? '' : verdict.reason };
      scheduleLiveDerived(drag, refreshDerived);
      requestDraw();
      return;
    }

    if (drag.kind === 'item') {
      const item = state.project.items.find((i) => i.id === drag.id);
      if (!item) return;
      drag.moved = true;
      const raw = { x: plan.x - drag.plan.x, y: plan.y - drag.plan.y };
      const g = gridStep();
      const grid = { x: Math.round((drag.start.x + raw.x) / g) * g - drag.start.x, y: Math.round((drag.start.y + raw.y) / g) * g - drag.start.y };
      // Умные направляющие (ui/guides-ui.js) приоритетнее сетки и магнита стен.
      if (!drag.guides) {
        drag.guides = startGuideSession({
          space: 'plan', moving: [itemShape(item, drag.start)], exclude: { items: new Set([item.id]) },
          ownAngles: [((item.rotation || 0) * Math.PI) / 180],
        });
      }
      const d = guideDelta(drag.guides, raw, grid, event);
      item.x = drag.start.x + d.x;
      item.y = drag.start.y + d.y;
      if (!event.shiftKey && !d.snapped) snapItemToWalls(item); // Shift отключает привязку к стенам
      requestDraw();
      return;
    }

    if (drag.kind === 'kitchen-elem') {
      const item = state.project.items.find((i) => i.id === drag.id);
      if (!item) return;
      const base = { ...item, comp: drag.start.comp, x: drag.start.x, y: drag.start.y };
      const at = kitchenProject(base, plan.x, plan.y);
      const step = event.shiftKey ? 1 : Math.min(KITCHEN_SNAP, gridStep()); // Shift — без привязки
      const x = Math.round((at.t - drag.grab) / step) * step;
      const next = editKitchen(base, { op: 'move', type: drag.type, side: at.side, x });
      if (next) {
        Object.assign(item, next);
        drag.moved = JSON.stringify(next.comp) !== JSON.stringify(drag.start.comp);
      }
      const el = item.comp.items.find((e) => e.type === drag.type);
      if (el) {
        const side = item.comp.shape === 'line' ? '' : `${KITCHEN_SIDES[el.side].toLowerCase()}, `;
        state.kitchenLabel = { itemId: item.id, x: plan.x, y: plan.y, text: `${KITCHEN_ELEMENTS[el.type].title}: ${side}${el.x} мм от начала`, stop: !next };
      }
      requestDraw();
      return;
    }

    if (drag.kind === 'stair-handle') {
      const item = state.project.items.find((i) => i.id === drag.id);
      if (!item) return;
      const step = event.shiftKey ? 1 : gridStep(); // Shift — без привязки
      const fallback = activeLevel(state.project)?.height || 3000;
      const at = { x: plan.x - drag.grab.x, y: plan.y - drag.grab.y };
      const next = dragStairHandle(drag.start, drag.handle, at, { snap: step, fallbackHeight: fallback });
      if (next) {
        for (const key of STAIR_FIELDS) delete item[key];
        Object.assign(item, next);
        drag.moved = STAIR_FIELDS.some((key) => JSON.stringify(item[key]) !== JSON.stringify(drag.start[key]))
          || item.x !== drag.start.x || item.y !== drag.start.y;
        state.stairLabel = { itemId: item.id, x: plan.x, y: plan.y, text: stairHandleLabel(item, drag.handle, fallback) };
      }
      requestDraw();
      return;
    }

    if (drag.kind === 'kitchen-handle') {
      const item = state.project.items.find((i) => i.id === drag.id);
      if (!item) return;
      const base = { ...item, comp: drag.start.comp, x: drag.start.x, y: drag.start.y };
      const step = event.shiftKey ? 1 : Math.min(KITCHEN_SNAP, gridStep()); // Shift — без привязки
      const res = kitchenHandleDrag(base, drag.handle, plan.x - drag.plan.x, plan.y - drag.plan.y, step);
      if (res) {
        const { comp, x, y, w, h } = res.next;
        Object.assign(item, { comp, x, y, w, h });
        drag.moved = JSON.stringify(comp) !== JSON.stringify(drag.start.comp);
        state.kitchenLabel = { itemId: item.id, x: plan.x, y: plan.y, text: res.label, stop: res.stop };
      }
      requestDraw();
      return;
    }

    if (drag.kind === 'opening') {
      const opening = state.project.openings.find((o) => o.id === drag.id);
      if (!opening) return;
      const placedNow = openingRect(state.project, opening, state.walls);
      if (!placedNow) return;
      drag.moved = true;
      const desired = openingPosAt(state.project, opening, state.walls, placedNow.wall.orient === 'h' ? plan.x : plan.y) - (drag.grabOffset || 0);
      // Сначала шаг сетки, потом поиск свободного места: округление не должно
      // загонять проём на соседний (зазор ≥ OPENING_GAP).
      state.openingFree = event.shiftKey; // Shift — без шага и без привязки к центру
      const clamped = fitOpeningOffset(state.project, opening, state.walls,
        snapOpeningOffset(state.project, opening, state.walls, desired, openingSnapOpts()));
      if (clamped !== null) setOpeningPos(opening, clamped);
      requestDraw();
      return;
    }

    if (drag.kind === 'wall') {
      let raw;
      if (drag.wall.orient === 'a') {
        const base = drag.wall.normal || { x: 0, y: 1 };
        const n = Math.abs(base.x) > 1e-6
          ? (base.x < 0 ? { x: -base.x, y: -base.y } : base)
          : (base.y < 0 ? { x: -base.x, y: -base.y } : base);
        raw = (plan.x - drag.plan.x) * n.x + (plan.y - drag.plan.y) * n.y;
      } else raw = drag.wall.orient === 'h' ? plan.y - drag.plan.y : plan.x - drag.plan.x;
      // Координационные оси (ui/block-gesture.js): грань или ось стены липнет к
      // оси в радиусе 300 мм (подсветка оси и подпись); иначе — шаг сетки.
      const gm = drag.wall.orient === 'a' ? null : wallGridMagnet(drag, raw, event);
      drag.gridSnap = gm ? { gridId: gm.grid.id, mode: gm.mode } : null;
      const delta = gm ? gm.delta : Math.round(raw / gridStep()) * gridStep();
      state.guides = gm ? [gm.guide] : [];
      state.gridSnapTag = gm ? { x: plan.x, y: plan.y, text: `Ось ${gm.grid.label} · ${gm.mode === 'axis' ? 'по центру' : 'по грани'}` } : null;
      // Стену двигаем по НОМИНАЛАМ комнат: съеденной (стоящей под соседом) комнате
      // возвращается полная форма, иначе её видимая грань двигалась бы, а номинал
      // оставался на месте — и между комнатами оставалась щель.
      const wallIds = drag.roomStarts.map((entry) => entry.id);
      if (liftForGesture(drag, wallIds)) {
        drag.roomStarts = wallIds.map((id) => ({ id, room: structuredClone(roomById(state.project, id)) })).filter((entry) => entry.room);
        drag.openingStarts = state.project.openings.filter((o) => (drag.wall.kind === 'manual' ? Boolean(o.host) : drag.wall.rooms.includes(o.roomId)))
          .map((o) => (o.host ? { id: o.id, host: { ...o.host } } : { id: o.id, side: o.side, offset: o.offset }));
      }
      restoreWallDragRooms(drag);
      drag.moved = delta !== 0;
      if (!drag.moved) {
        drag.valid = true;
        liveEat(drag, { touched: wallIds });
        scheduleLiveDerived(drag, refreshDerived);
        requestDraw();
        return;
      }
      const verdict = moveWallBy(state.project, drag.wall, delta);
      drag.clamped = verdict.clamped || [];
      drag.valid = verdict.ok;
      drag.reason = verdict.reason;
      liveEat(drag, { touched: wallIds });
      scheduleLiveDerived(drag, refreshDerived);
      requestDraw();
      return;
    }

    if (drag.kind === 'railing-end') {
      // Конец перил — только вдоль своей стороны, шаг сетки по зуму (Shift — без шага).
      const room = roomById(state.project, drag.roomId);
      if (!room) return;
      if (!drag.moved) {
        materializeRailings(room, state.project.rooms, state.project.settings);
        drag.moved = true;
      }
      const seg = room.railings.find((s) => s.id === drag.id);
      if (!seg) return;
      const vertical = seg.side % 2 === 1;
      const base = vertical ? room.y : room.x;
      let at = (vertical ? plan.y : plan.x) - base;
      if (!event.shiftKey) { const g = gridStep(); at = Math.round(at / g) * g; }
      moveRailingEnd(room, drag.id, drag.end, at);
      requestDraw();
      return;
    }

    if (drag.kind === 'opening-handle') {
      const opening = state.project.openings.find((o) => o.id === drag.id);
      if (!opening) return;
      if (opening.corner) {
        const handle = cornerWindowHandles(state.project, opening, state.walls).find((h) => h.end === drag.end);
        if (!handle) return;
        const along = handle.wall.orient === 'h' ? plan.x : plan.y;
        const step = event.shiftKey ? 1 : 50;
        const width = Math.max(600, Math.round((along - handle.start) * handle.sign / step) * step);
        if (resizeCornerWing(state.project, opening, state.walls, drag.end, width)) drag.moved = true;
        requestDraw();
        return;
      }
      const placedNow = openingRect(state.project, opening, state.walls);
      const frame = openingFrame(state.project, opening, state.walls);
      if (!placedNow || !frame) return;
      drag.moved = true;
      // В координатах плана вдоль стены: start — нижний по оси торец проёма.
      const base = frame.base;
      const along = placedNow.wall.orient === 'h' ? plan.x : plan.y;
      const startEdge = placedNow.absCenter - opening.width / 2;
      const endEdge = placedNow.absCenter + opening.width / 2;
      const fixed = drag.end === 'start' ? endEdge : startEdge;
      const movingEdge = base + Math.round((along - base) / 50) * 50; // шаг 50 мм
      let width = Math.abs(fixed - movingEdge);
      width = Math.max(glazedOpeningMinWidth(opening), Math.round(width / 50) * 50);
      const center = drag.end === 'start' ? fixed - width / 2 : fixed + width / 2;
      const resized = isGlazedAssembly(opening) ? resizeGlazedOpening(opening, { width }) : { width };
      const probe = { ...opening, ...resized };
      const clamped = fitOpeningOffset(state.project, probe, state.walls, (center - base) * frame.dir);
      if (clamped !== null) {
        Object.assign(opening, resized);
        setOpeningPos(opening, clamped);
      }
      requestDraw();
      return;
    }

    if (drag.kind === 'mwall-end') {
      // Торец ручной стены: свободный угол с теми же привязками, что у линии.
      const wall = state.project.walls.find((w) => w.id === drag.id);
      if (!wall) return;
      Object.assign(wall, structuredClone(drag.start));
      for (const h of drag.hostStarts) {
        const o = state.project.openings.find((x) => x.id === h.id);
        if (o) o.host = { ...h.host };
      }
      const fixed = drag.start.axis[drag.end === 'a' ? 'b' : 'a'];
      const shapes = [];
      for (const other of (state.walls || []).filter((w) => w.wallId !== wall.id)) {
        if (other.polys?.length) for (const poly of other.polys) shapes.push({ points: poly, closed: true });
        else for (const r of wallRects(other)) shapes.push({
          points: [{ x: r.x, y: r.y }, { x: r.x + r.w, y: r.y }, { x: r.x + r.w, y: r.y + r.h }, { x: r.x, y: r.y + r.h }], closed: true,
        });
      }
      let snapRes = snapAt(plan, event, {
        prev: fixed, points: [...massSnapPoints(), ...gridSnapPoints()], extraShapes: shapes, grid: gridStep(), space: 'plan',
      });
      // Магнит торца к оси и к центру/середине соседней стены, как у инструмента «Стена».
      const magnet = wallPointMagnet(plan, event, { prev: fixed, excludeId: wall.id });
      state.guides = magnet ? magnet.guides : [];
      if (magnet) snapRes = magnet.res;
      const p = snapRes.point;
      state.gridSnapTag = snapRes.label ? { x: p.x, y: p.y, text: snapRes.label } : null;
      drag.moved = dragManualWallEnd(state.project, wall.id, drag.end, p).ok || drag.moved;
      scheduleLiveDerived(drag, refreshDerived);
      requestDraw();
      return;
    }

    if (drag.kind === 'item-rotate') {
      const item = state.project.items.find((i) => i.id === drag.id);
      if (!item) return;
      drag.moved = true;
      const ang = Math.atan2(plan.y - drag.center.y, plan.x - drag.center.x);
      let deg = drag.startRot + ((ang - drag.startAngle) * 180) / Math.PI;
      const stepDeg = event.shiftKey ? 15 : 5; // по умолчанию шаг 5°, Shift — 15°
      deg = Math.round(deg / stepDeg) * stepDeg;
      item.rotation = ((deg % 360) + 360) % 360;
      requestDraw();
      return;
    }

    if (drag.kind === 'group-rotate' || drag.kind === 'group-stretch' || drag.kind === 'group-scale') {
      drag.moved = true;
      if (drag.kind === 'group-rotate') {
        const stepDeg = event.shiftKey ? 15 : 5; // как у одного предмета: 5°, Shift — 15°
        const deg = groupRotateDeg(drag.center, drag.startPoint, plan, stepDeg);
        state.groupRotateDeg = deg;
        applyGroupItems(rotateGroup(drag.starts, drag.center, deg));
      } else if (drag.kind === 'group-stretch') {
        applyGroupItems(stretchGroup(drag.starts, drag.box, drag.edge, plan).items);
      } else {
        applyGroupItems(scaleGroup(drag.starts, drag.box, drag.corner, plan).items);
      }
      requestDraw();
      return;
    }

    if (drag.kind === 'item-stretch') {
      const item = state.project.items.find((i) => i.id === drag.id);
      if (!item) return;
      drag.moved = true;
      Object.assign(item, stretchItem(item, drag.edge, plan));
      requestDraw();
      return;
    }

    if (drag.kind === 'item-resize') {
      const item = state.project.items.find((i) => i.id === drag.id);
      if (!item) return;
      drag.moved = true;
      const dLocal = rotateVec(plan.x - drag.anchor.x, plan.y - drag.anchor.y, -drag.rot);
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
      const p = snapSiteVertex(drag, world, event);
      point.x = p.x;
      point.y = p.y;
      requestDraw();
      return;
    }

    if (drag.kind === 'entry') {
      const site = state.project.site;
      if (!site.boundary) return;
      const entry = entryById(site, drag.id);
      if (!entry) return;
      const near = computeEntryAt(world, entry);
      if (near && !entryOverlaps(site, { ...entry, ...near }, entry.id)) {
        drag.moved = true;
        Object.assign(entry, { x: near.x, y: near.y, dir: near.dir });
        syncPrimaryEntry(site);
        requestDraw();
      }
      return;
    }

    if (drag.kind === 'building') {
      // Сдвиг дома целиком: шаг сетки, с Shift — 0,5 м. Поворот не меняется.
      const step = event.shiftKey ? gridStep() * 10 : gridStep();
      const dx = Math.round((world.x - drag.world.x) / step) * step;
      const dy = Math.round((world.y - drag.world.y) / step) * step;
      if (!dx && !dy && !drag.moved) return;
      drag.moved = true;
      state.project.building = setBuildingOrigin(state.project.building, drag.start.x + dx, drag.start.y + dy);
      requestDraw();
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
  };
  canvas.addEventListener('pointermove', onCanvasPointerMove);
  canvas.addEventListener('pointerup', (event) => {
    touches.delete(event.pointerId);
    if (drag?.kind === 'pinch') {
      if (touches.size < 2) {
        drag = null;
        state.planPinching = false;
        requestDraw();
      }
      return;
    }
    canvas.parentElement?.classList.remove('move-armed');
    if (drag?.kind === 'touch-hold') { // тап: выбираем то, на что нажали
      clearTimeout(drag.timer);
      const hold = drag;
      const pending = drag.pending;
      drag = null;
      const sel = pending?.selection;
      if (sel?.type === 'item' && state.selection?.type === 'item' && state.selection.id === sel.id) cycleItemHandle(sel.id);
      else if (pending) selectObject(sel);
      else if (hold.inner?.kind === 'multi' && hold.inner.wasSelected && isItemGroup(state.selection)) cycleGroupHandle();
      return;
    }
    if (drag?.kind === 'tap') { // тап без сдвига — выполняем отложенное действие
      const { run } = drag;
      drag = null;
      run();
      // Действие могло начать перетаскивание (новый въезд) — завершаем его ниже.
      if (!drag) { requestDraw(); return; }
    }
    if (!drag) return;
    if (drag.clickMove && !drag.placing) return;
    const finished = drag;
    drag = null;
    if (finished.clickMove) cancelTool();
    cancelLiveDerived(finished);
    state.guides = [];
    state.gridSnapTag = null;
    state.objGuides = null;
    state.kitchenLabel = null;
    state.stairLabel = null;
    if (finished.kind === 'site-vertex' || finished.kind === 'ls-vertex') state.drawSnap = null;

    if (finished.kind === 'pan') { requestDraw(); return; }
    if (finished.kind === 'item' && !finished.moved && finished.wasSelected) { cycleItemHandle(finished.id); return; }
    if (finished.kind === 'multi' && !finished.moved && finished.wasSelected && isItemGroup(state.selection)) { cycleGroupHandle(); return; }
    if (finished.kind.startsWith('group-')) state.groupRotateDeg = null;
    if (finished.kind.startsWith('ls-')) { landscapeDragEnd(finished); return; }
    if (finished.kind.startsWith('psec-')) { planSectionDragEnd(finished); return; }
    if (finished.kind.startsWith('slab-')) { slabDragEnd(finished); return; }
    if (finished.kind.startsWith('grid-')) { gridDragEnd(finished); return; }
    if (finished.kind.startsWith('roofplan-')) { roofPlanDragEnd(finished); return; }

    if (finished.kind === 'marquee') {
      applyMarquee();
      state.marquee = null;
      requestDraw();
      return;
    }

    if (finished.kind === 'wall') {
      const wallIds = finished.roomStarts.map((entry) => entry.id);
      if (!finished.moved) {
        // Комнатам возвращали номинал на время жеста — снова съедание.
        if (finished.lifted) { eatOverlapsAfter(wallIds, { silent: true, prev: finished.eatPrev }); refreshDerived(); }
        requestDraw();
        return;
      }
      if (!finished.valid) {
        restoreFrom(finished.before);
        toast(finished.reason || 'Так переместить стену нельзя', true);
        return;
      }
      for (const entry of finished.roomStarts) {
        const room = roomById(state.project, entry.id);
        if (room?.outline && !room.eatBase) finalizeRoomOutlineKeepOpenings(state.project, room);
      }
      eatOverlapsAfter(wallIds, { silent: true, prev: finished.eatPrev });
      reconcileOpenings();
      refreshDerived();
      reflowLayoutChanges(finished.before, { roomIds: wallIds });
      // «Запоминать привязку при магните» (блок «Координационные оси»): стена,
      // притянутая к оси, сразу прикрепляется (тем же шагом истории).
      if (finished.gridSnap) rememberGridSnap(finished);
      pushHistory(finished.before);
      afterChange();
      if (finished.clamped?.length) toast(`Проёмы прижаты к краю укороченной стены: ${finished.clamped.length}`, true);
      return;
    }

    if (finished.kind === 'railing-end') {
      if (!finished.moved) { requestDraw(); return; }
      refreshDerived();
      pushHistory(finished.before); // жест — один шаг отмены
      afterChange();
      return;
    }

    if (finished.kind === 'mwall-end') {
      if (!finished.moved) { requestDraw(); return; }
      reconcileOpenings(); // проёмы за новым торцом прижимаются или удаляются
      refreshDerived();
      reflowLayoutChanges(finished.before);
      pushHistory(finished.before);
      afterChange();
      return;
    }

    if (finished.kind === 'room' || finished.kind === 'resize' || finished.kind === 'shape-resize' || finished.kind === 'multi') {
      state.ghost = null;
      if (!finished.moved) {
        // Деление без сдвига — откат (у общей стены — обе комнаты).
        if (finished.kind === 'shape-resize' && pendingSplitHas(finished.roomId)) revertPendingSplit();
        requestDraw(); return;
      }
      if (!finished.valid) {
        restoreFrom(finished.before);
        if (finished.kind === 'shape-resize') state.pendingRoomSplit = null; // снимок до деления
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
            arrangeRoomsNow([parent.id], { force: true });
            toast(`«${room.name}» вложена в «${parent?.name}» и отнимает её площадь — можно поменять в панели справа`, true);
          } else {
            toast(`«${room.name}» отделена — снова самостоятельная комната`);
          }
        }
      }
      for (const f of finished.follow || []) {
        const r = roomById(state.project, f.id);
        if (r?.outline && !r.eatBase) finalizeRoomOutlineKeepOpenings(state.project, r);
      }
      if (finished.kind === 'shape-resize') {
        const room = roomById(state.project, finished.roomId);
        const finalized = room?.outline ? finalizeRoomOutlineKeepOpenings(state.project, room) : { merged: finished.merged };
        finished.merged = finished.merged || finalized.merged;
        // Комнаты деления, которые жест не тронул (тянули не ту ручку, Alt),
        // — без лишних совпадающих вершин.
        for (const id of state.pendingRoomSplit?.roomIds || []) {
          const r = id !== finished.roomId && roomById(state.project, id);
          if (r?.outline && !r.eatBase) finalizeRoomOutlineKeepOpenings(state.project, r);
        }
        state.pendingRoomSplit = null;
      }
      // Сдвинутая/растянутая комната «съедает» перекрытые: нижняя
      // уменьшается, между ними перегородка (core/v7/eat-bridge.js). Тот же шаг
      // отмены, что и сам жест.
      const movedIds = finished.kind === 'multi' ? finished.roomIds
        : [finished.kind === 'room' ? finished.id : finished.roomId];
      const eaten = eatOverlapsAfter(movedIds.filter(Boolean), { under: finished.under, prev: finished.eatPrev });
      if (eaten.eaten.length || eaten.failed.length || eaten.restored.length) finished.clamped = null;
      reconcileOpenings();
      refreshDerived();
      const reflowIds = new Set(finished.kind === 'resize' || finished.kind === 'shape-resize' ? movedIds : []);
      for (const follower of finished.follow || []) if (follower.id) reflowIds.add(follower.id);
      for (const entry of [...(eaten.eaten || []), ...(eaten.restored || [])]) if (entry.lower?.id) reflowIds.add(entry.lower.id);
      arrangeRoomsNow([...reflowIds], { itemIdsByRoom: finished.layoutItemIdsByRoom });
      pushHistory(finished.before);
      afterChange();
      let noted = true;
      if (finished.kind === 'shape-resize' && finished.merged) {
        toast('Стены выровнены и объединены в одну');
      } else if (finished.clamped?.length) {
        toast(`Проёмы прижаты к краю укороченной стены: ${finished.clamped.length}`, true);
      } else noted = false;
      // Зазор от толщины перегородки до AUTO_DOCK_MM: комната прилипает сама (отдельный шаг
      // истории); тянули сторону — растяжением, двигали — сдвигом; Alt и кнопка «Магнит» — без неё.
      if (!noted && (finished.kind === 'room' || finished.kind === 'resize')) {
        autoDockAfterGesture(movedIds.filter(Boolean), finished.kind === 'resize' ? 'stretch' : 'move', { magnet: !event.altKey, before: finished.before });
      }
      return;
    }

    if (finished.moved) {
      if (finished.kind === 'site-vertex' || finished.kind === 'entry') {
        // Граница изменилась — въезд заново садится на неё и ориентируется
        // перпендикулярно отрезку границы (стрелка внутрь участка).
        const site = state.project.site;
        if (site.boundary) {
          for (const entry of ensureSiteEntries(site)) {
            const spot = computeEntryAt(entry, entry);
            if (spot) Object.assign(entry, { x: spot.x, y: spot.y, dir: spot.dir });
          }
          syncPrimaryEntry(site);
        }
      }
      refreshDerived();
      if (finished.kind === 'opening' || finished.kind === 'opening-handle') reflowLayoutChanges(finished.before);
      pushHistory(finished.before);
      afterChange();
      return;
    }
    requestDraw();
  });
  canvas.addEventListener('pointercancel', (event) => {
    touches.delete(event.pointerId);
    cancelActiveGesture();
  });
  document.addEventListener('pointerdown', (event) => {
    if (state.tool?.kind === 'move-furniture' && event.target !== canvas &&
      !event.target.closest?.('[data-selection-action="cancel-move"]')) cancelTool();
  }, true);
  window.addEventListener('blur', () => {
    if (state.tool?.kind === 'move-furniture') cancelTool();
  });
  canvas.addEventListener('dblclick', (event) => {
    if (isRoofPlan()) { roofPlanDblClick(pointerScreen(event), worldToPlan(pointerWorld(event))); return; }
    if (state.modeName === 'landscape') { landscapeDblClick(pointerWorld(event)); return; }
    if (state.tool?.kind === 'slab-opening') { finishSlabOpeningTool(); return; }
    if (state.draft && (state.draft.kind === 'redline' || state.draft.kind === 'road')) finishDraft();
    if (state.tool?.kind === 'wall') finishWallChain();
    if (state.modeName === 'plan' && !state.tool) planSectionDblClick(pointerScreen(event));
  });
  let wheelDirection = 0;
  let wheelTime = -Infinity;
  let reverseDelta = 0;
  const syncSplitZoom = () => {
    if (state.splitEdit && !state.splitEdit.typed && splitCursor) {
      splitLiveMove(screenToPlan(splitCursor.x, splitCursor.y));
    }
  };
  canvas.addEventListener('wheel', (event) => {
    event.preventDefault();
    // У тачпада события могут содержать доли пикселя или только deltaX.
    // Сохраняем шаг колеса для крупных событий, мелкие масштабируем пропорционально.
    const unit = [1, 16, 100][event.deltaMode] ?? 1;
    let delta = Math.max(-100, Math.min(100, event.deltaY * unit));
    if (!delta) return;
    const direction = Math.sign(delta);
    const sameGesture = event.timeStamp - wheelTime < 150;
    wheelTime = event.timeStamp;
    // Короткий обратный импульс не разворачивает зум посреди жеста.
    // Намеренный разворот сразу учитывает весь накопившийся ход.
    if (sameGesture && wheelDirection !== direction) {
      reverseDelta += delta;
      if (Math.abs(reverseDelta) < 4) return;
      delta = reverseDelta;
    }
    reverseDelta = 0;
    wheelDirection = direction;
    const screen = pointerScreen(event);
    // Масштаб меняется под неподвижным курсором: линия деления остаётся под ним, а не прыгает на следующем движении.
    splitCursor = screen;
    zoomAt(screen, 1.12 ** (-delta / 100), syncSplitZoom);
  }, { passive: false });
}

// Потеря облачного lease может прийти во время pointer capture. Откатываем
// незавершённый жест тем же способом, что системный pointercancel, прежде
// чем показать блокирующее окно другого устройства.
export function cancelActiveGesture() {
  const furnitureSelection = drag?.clickMove ? state.selection : null;
  touches.clear();
  state.planPinching = false;
  canvas.parentElement?.classList.remove('move-armed');
  if (drag?.kind === 'touch-hold') clearTimeout(drag.timer);
  cancelLiveDerived(drag);
  if (drag && drag.kind !== 'pinch' && drag.before && drag.moved) {
    restoreFrom(drag.before);
    if (drag.kind === 'shape-resize') state.pendingRoomSplit = null;
  }
  drag = null;
  state.marquee = null;
  state.ghost = null;
  state.kitchenLabel = null;
  state.groupRotateDeg = null;
  state.guides = [];
  state.objGuides = null;
  state.slabLabel = null;
  state.slabEdge = null;
  state.slabEdgeHover = null;
  if (state.tool?.kind === 'move-furniture') cancelTool();
  if (furnitureSelection) selectObject(furnitureSelection);
  requestDraw();
}

registerEditGestureCancel(cancelActiveGesture);
