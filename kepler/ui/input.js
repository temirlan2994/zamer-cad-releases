// Ввод мышью на канвасе: выбор, перетаскивания, рамка, колесо, drag-and-drop.

import { furnitureDef, isOpenRoom, roomType } from '../core/catalog.js';
import { pickStackHit } from '../core/hit-stack.js';
import { arrangeRoom, reclaimItemsFromChild } from '../core/furnish.js';
import { roomById } from '../core/model.js';
import { determineParent, snapRoomPosition, validateRoomPlacement } from '../core/rooms.js';
import { nearestPointOnPolyline } from '../core/site.js';
import { pointInBuilding, setBuildingOrigin } from '../core/site-check.js';
import {
  openingFrame, openingPosAt, openingRect, setOpeningPos,
} from '../core/walls.js';
import { dragManualWallEnd, snapWallPoint } from '../core/wall-manual.js';
import {
  boundRoomClick, boundRoomHover, finishWallChain, wallToolClick, wallToolHover,
} from './wall-tool.js';
import { fitOpeningOffset } from '../core/opening-spacing.js';
import { pointInPolygon } from '../core/zamer/geometry.js';
import {
  captureOpeningAnchors, finalizeRoomOutlineKeepOpenings, keepOpenings, reanchorOpenings,
} from '../core/opening-anchor.js';
import { applyRoomShapeHandle, clampRoomNotch } from '../core/room-shape.js';
import { groupCargo } from '../core/room-group.js';
import { moveWallBy } from '../core/wall-edit.js';
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
import { hideSplitInput } from './split-input.js';
import { focusGap, gapMarkerAt } from './gaps.js';
import {
  KITCHEN_ELEMENTS, KITCHEN_SIDES, KITCHEN_SNAP, editKitchen, kitchenElementAt, kitchenHandleDrag, kitchenProject, withDefaultComp,
} from '../core/composite.js';
import { hideSofaMenu, openSofaMenu } from './props-composite.js';
import { canvas, el, refs, toast } from './dom.js';
import {
  findWall, hitGroupHandle, hitItem, hitItemHandle, hitManualWallEnd, hitNeighborHandle, hitOpening, hitOpeningHandle, hitRoom,
  hitPlanStack, hitRoomHandle, hitSiteObject, hitSiteVertex, hitUnderlayHandle, hitWall,
} from './hit.js';
import { spaceDown } from './keyboard.js';
import {
  LANDSCAPE_MIME, applyLandscapeMarquee, dropLandscape, landscapeDblClick, landscapeDragEnd, landscapeDragMove,
  landscapeHover, landscapePointerDown,
} from './landscape.js';
import { closeLibrarySheet } from './mobile.js';
import {
  addFurnitureAt, computeOpeningParams, eatOverlapsAfter, placeOpeningAt,
  placeRoomAt, reconcileOpenings, selectGroup, toggleInMulti, toggleOpeningFlip,
} from './plan-actions.js';
import {
  addDraftPoint, addNorthPoint, computeEntryAt, finishDraft, placeNeighborAt, updateDraftCursor,
} from './site-actions.js';
import { addAlignViewPoint, snapAlignPoint } from './view-align.js';
import { chainsWithout, dragPrev, setSnapRehover, snapAt } from './draw-snap-ui.js';
import { applyResize, gridStep, resizeVerdict, snapItemToWalls } from './snap.js';
import { guideDelta, itemShape, roomShape, startGuideSession } from './guides-ui.js';
import { state } from './state.js';
import { afterChange, pushHistory, refreshDerived, restoreFrom, snapshot } from './store.js';
import { activeSiteLayer, cancelTool, positionWallButtons, selectObject } from './tools.js';
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
const TOUCH_HOLD_KINDS = new Set(['building', 'neighbor', 'underlay', 'item', 'opening', 'room', 'multi', 'wall', 'entry', 'ls-move']);
let drag = null;

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

// sel — выбор, который тянем: передаётся явно, потому что на касании
// selectObject откладывается до тапа и state.selection ещё старый.
function startMultiDrag(plan, sel = state.selection, wasSelected = false) {
  if (sel?.type !== 'multi') return;
  // Груз фиксируется при захвате: выбранные комнаты с их вложенными
  // помещениями и мебелью внутри + отдельно выбранная мебель.
  // Состав груза — как у стрелок и поворота группы (core/room-group.js).
  const cargo = groupCargo(state.project, sel.roomIds, sel.itemIds);
  const movedRooms = new Map(cargo.rooms.map((room) => [room.id, { x: room.x, y: room.y }])); // id -> старт
  const movedItems = new Map(cargo.items.map((item) => [item.id, { x: item.x, y: item.y }])); // id -> старт
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
  ];
  return startGuideSession({
    space: 'plan', moving, frames: rooms.length ? [0] : null, ownAngles: [0],
    exclude: { rooms: roomSet, items: new Set(items), walls: (w) => (w.rooms || []).some((id) => roomSet.has(id)) },
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
  const total = roomIds.length + itemIds.length;
  if (total === 0) { selectObject(null); return; }
  if (total === 1) {
    selectObject(roomIds.length ? { type: 'room', id: roomIds[0] } : { type: 'item', id: itemIds[0] });
    return;
  }
  selectObject({ type: 'multi', roomIds, itemIds });
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
  if (state.tool?.kind === 'align-view') {
    // «Выровнять вид»: привязка к рёбрам/углам стен, комнат, участка, соседей.
    const p = snapAlignPoint(world, event);
    state.alignCursor = state.tool.points.length === 1 ? p : null;
    requestDraw();
    return;
  }
  if (state.modeName === 'landscape' && landscapeHover(world, canvas, event)) return;
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
    state.ghostItem = item;
    requestDraw();
    return;
  }
  if (state.tool?.kind === 'place-room') {
    const def = roomType(state.tool.type);
    const turned = (state.tool.rotation || 0) % 180 !== 0;
    const w = turned ? def.h : def.w;
    const h = turned ? def.w : def.h;
    let x = plan.x - w / 2;
    let y = plan.y - h / 2;
    const parentId = def.open ? null : determineParent(state.project, { x, y, w, h }, null);
    const snapped = snapRoomPosition(state.project, { id: '__ghost__', w, h }, x, y, 14 / state.view.scale, parentId, gridStep());
    x = snapped.x; y = snapped.y;
    const verdict = validateRoomPlacement(state.project, { type: def.type, x, y, w, h, parentId }, null);
    state.guides = snapped.guides;
    state.ghost = {
      rect: { x, y, w, h },
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
    state.ghostDoor = null;
    const res = computeOpeningParams(plan);
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
    // Возврат к первой точке (от 3 точек) — замыкание; иначе привязки черчения.
    updateDraftCursor(world, event);
    return;
  }
  if (state.tool?.kind === 'wall') { wallToolHover(plan, event); return; }
  if (state.tool?.kind === 'bound-room') { boundRoomHover(plan); return; }
  if (state.tool?.kind === 'terrain') {
    const s = worldToScreen(world.x, world.y);
    const tp = hitTerrainPoint(s);
    const next = tp ? { type: 'site-obj', kind: 'terrain-point', id: tp.id } : null;
    canvas.style.cursor = tp ? 'move' : 'crosshair';
    if (JSON.stringify(next) !== JSON.stringify(state.hover)) { state.hover = next; requestDraw(); }
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

  // Подсветка под курсором: мебель, проёмы, стены, комнаты, объекты участка.
  let nextHover = null;
  const item = hitItem(plan);
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
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('selectstart', (e) => e.preventDefault()); // долгое нажатие не выделяет холст
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
    if (layer === 'entry') {
      // Касанием: новый въезд — тапом, существующий двигается после удержания.
      if (state.project.site.entry) startEntryDrag(world);
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
        const { itemKind, rotation = 0 } = t;
        tapOrNow(event, screen, () => { cancelTool(); addFurnitureAt(itemKind, plan.x, plan.y, rotation); });
        return;
      }
      if (t.kind === 'place-opening') { tapOrNow(event, screen, () => placeOpeningAt(plan)); return; }
      if (t.kind === 'wall') {
        const mods = { shiftKey: event.shiftKey };
        tapOrNow(event, screen, () => wallToolClick(plan, mods));
        return;
      }
      if (t.kind === 'bound-room') { tapOrNow(event, screen, () => boundRoomClick(plan)); return; }
      if (t.kind === 'north') { const p = snapTwoPointTool(world, event); tapOrNow(event, screen, () => addNorthPoint(p)); return; }
      if (t.kind === 'calibrate') { const p = snapTwoPointTool(world, event); tapOrNow(event, screen, () => addCalibratePoint(p)); return; }
      touchPan();
      return;
    }

    // «Участок» без инструмента: мебель, комнаты и проёмы не выбираются —
    // дом хватается только целиком (за любую комнату) и едет по участку.
    if (state.modeName === 'site') {
      if (state.calibration && !el('calOverlay').hidden) hideCalInput();
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
    if (state.splitEdit) hideSplitInput();
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
    if (state.selection?.type === 'wall' && state._wallUI) {
      for (const d of state._wallUI.dims) {
        if (Math.hypot(d.x - screen.x, d.y - screen.y) <= 20) { tapOrNow(event, screen, () => openDimInput(d)); return; }
      }
    }
    // Подпись временного размера мебели — раньше ручек и перетаскивания предмета.
    // На телефоне поле открывается на тапе (отпускании пальца): focus() из
    // жеста открывает клавиатуру, а свайп по подписи — панорама.
    const tempDimHit = hitTempDim(screen);
    if (tempDimHit) { tapOrNow(event, screen, () => openDimInput(tempDimHit)); return; }

    // Маркер нестандартного зазора «≠ N мм» — выделить пару и предложить стыковку.
    const gapHit = gapMarkerAt(screen.x, screen.y);
    if (gapHit) { focusGap(gapHit); return; }

    // Кнопки «+» выделенного дивана-конструктора — раньше ручек и перетаскивания.
    if (state.selection?.type === 'item' && state._sofaUI?.itemId === state.selection.id) {
      const tolPx = state.coarsePointer ? 6 : 3;
      const spot = state._sofaUI.spots.find((sp) => Math.hypot(sp.x - screen.x, sp.y - screen.y) <= sp.r + tolPx);
      const item = spot && state.project.items.find((i) => i.id === state.selection.id);
      if (item) { openSofaMenu(item, spot); return; }
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
    const openingHandleHit = hitOpeningHandle(screen);
    if (openingHandleHit) {
      drag = { kind: 'opening-handle', id: openingHandleHit.opening.id, end: openingHandleHit.end, before: snapshot(), moved: false };
      return;
    }
    const handleHit = hitRoomHandle(screen);
    if (handleHit) {
      if (handleHit.shapeHandle?.kind) {
        const pending = state.pendingRoomSplit?.roomId === handleHit.room.id ? state.pendingRoomSplit : null;
        drag = {
          kind: 'shape-resize', roomId: handleHit.room.id, handle: handleHit.shapeHandle,
          before: pending?.before || snapshot(), moved: false, valid: true, merged: false,
          anchors: captureOpeningAnchors(state.project, handleHit.room),
        };
      } else {
        drag = {
          kind: 'resize', roomId: handleHit.room.id, handle: handleHit.handle, start: structuredClone(handleHit.room),
          before: snapshot(), plan, valid: true, anchors: captureOpeningAnchors(state.project, handleHit.room),
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
      selectObject({ type: 'opening', id: opening.id });
      drag = { kind: 'opening', id: opening.id, before: snapshot(), moved: false };
      return;
    }

    if (picked?.type === 'wall') {
      const wall = picked.entity;
      const manual = wall.kind === 'manual';
      // Ручная стена выбирается по ключу: её начало (from) меняется при правке.
      selectObject({ type: 'wall', key: wall.key, from: manual ? undefined : wall.from, at: wall.orient === 'h' ? plan.x : plan.y });
      drag = {
        kind: 'wall', key: wall.key, from: wall.from, wall: structuredClone(wall),
        plan, before: snapshot(), moved: false, valid: true,
        roomStarts: wall.rooms.map((id) => ({ id, room: structuredClone(roomById(state.project, id)) })).filter((entry) => entry.room),
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
      const carried = state.project.items
        .filter((i) => i.x >= room.x && i.x <= room.x + room.w && i.y >= room.y && i.y <= room.y + room.h)
        .map((i) => ({ id: i.id, x: i.x, y: i.y }));
      drag = {
        kind: 'room', id: room.id, plan, start: { x: room.x, y: room.y },
        childStarts: children.map((c) => ({ id: c.id, x: c.x, y: c.y })),
        carried,
        startParent: room.parentId, before: snapshot(), moved: false, valid: true,
      };
      return;
    }

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
    const touch = event.pointerType === 'touch';
    state.touchDeferSelect = touch;
    state.touchDeferred = null;
    try { onCanvasPointerDown(event); } finally { state.touchDeferSelect = false; }
    const pending = state.touchDeferred;
    state.touchDeferred = null;
    const holdable = touch && drag && (TOUCH_HOLD_KINDS.has(drag.kind) || drag.kind === 'pan');
    if (!holdable) { if (pending) selectObject(pending.selection); return; }
    // Касанием выбор — только тапом, перемещение — после долгого нажатия.
    const hold = { kind: 'touch-hold', inner: drag, pending, start: pointerScreen(event), view: { ...state.view }, timer: 0 };
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
    drag = hold;
  });
  canvas.addEventListener('pointermove', (event) => {
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
      const rawX = drag.start.x + (plan.x - drag.plan.x);
      const rawY = drag.start.y + (plan.y - drag.plan.y);
      // Вложение перетаскиванием: родителем становится комната, внутрь которой
      // попадает прямоугольник; вытащили наружу — комната снова самостоятельная.
      const candidateParent = isOpenRoom(room)
        ? null : determineParent(state.project, { x: rawX, y: rawY, w: room.w, h: room.h }, room.id);
      room.parentId = candidateParent;
      // Shift — без магнита стыковки и выравнивания: только сетка.
      const snapped = event.shiftKey
        ? { x: Math.round(rawX / gridStep()) * gridStep(), y: Math.round(rawY / gridStep()) * gridStep(), guides: [] }
        : snapRoomPosition(state.project, room, rawX, rawY, 14 / state.view.scale, candidateParent, gridStep());
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
      const raw = { x: plan.x - drag.plan.x, y: plan.y - drag.plan.y };
      const grid = { x: Math.round(raw.x / gridStep()) * gridStep(), y: Math.round(raw.y / gridStep()) * gridStep() };
      if (!grid.x && !grid.y && !drag.moved) return; // дрожание при клике — не перенос
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

    if (drag.kind === 'shape-resize') {
      const room = roomById(state.project, drag.roomId);
      if (!room?.notch && !room?.outline) return;
      drag.moved = true;
      if (state.pendingRoomSplit?.roomId === room.id) state.pendingRoomSplit.moved = true;
      const snap = (value) => Math.round(value / gridStep()) * gridStep();
      const result = applyRoomShapeHandle(room, drag.handle, { x: snap(plan.x), y: snap(plan.y) }, {
        mergeTolerance: Math.max(gridStep(), 14 / state.view.scale),
      });
      drag.merged = result.merged;
      drag.clamped = reanchorOpenings(state.project, room, drag.anchors).clamped;
      if (result.merged) reconcileOpenings();
      const verdict = resizeVerdict(room);
      drag.valid = verdict.ok;
      drag.reason = verdict.reason;
      refreshDerived();
      requestDraw();
      return;
    }

    if (drag.kind === 'resize') {
      const room = roomById(state.project, drag.roomId);
      if (!room) return;
      drag.moved = true;
      drag.noSnap = event.shiftKey; // Shift — без магнита стыковки
      applyResize(room, drag, plan);
      if (drag.start.notch) room.notch = structuredClone(drag.start.notch);
      clampRoomNotch(room);
      // Отступы проёмов — от room.x/y: пересчёт от снимка начала (Б3).
      drag.clamped = reanchorOpenings(state.project, room, drag.anchors).clamped;
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
      const desired = openingPosAt(state.project, opening, state.walls, placedNow.wall.orient === 'h' ? plan.x : plan.y);
      // Сначала шаг сетки, потом поиск свободного места: округление не должно
      // загонять проём на соседний (зазор ≥ OPENING_GAP).
      const clamped = fitOpeningOffset(state.project, opening, state.walls, Math.round(desired / gridStep()) * gridStep());
      if (clamped !== null) setOpeningPos(opening, clamped);
      requestDraw();
      return;
    }

    if (drag.kind === 'wall') {
      const raw = drag.wall.orient === 'h' ? plan.y - drag.plan.y : plan.x - drag.plan.x;
      const delta = Math.round(raw / gridStep()) * gridStep();
      restoreWallDragRooms(drag);
      drag.moved = delta !== 0;
      if (!drag.moved) {
        drag.valid = true;
        refreshDerived();
        requestDraw();
        return;
      }
      const verdict = moveWallBy(state.project, drag.wall, delta);
      drag.clamped = verdict.clamped || [];
      drag.valid = verdict.ok;
      drag.reason = verdict.reason;
      refreshDerived();
      requestDraw();
      return;
    }

    if (drag.kind === 'opening-handle') {
      const opening = state.project.openings.find((o) => o.id === drag.id);
      if (!opening) return;
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
      width = Math.max(300, Math.round(width / 50) * 50);
      const center = drag.end === 'start' ? fixed - width / 2 : fixed + width / 2;
      const probe = { ...opening, width };
      const clamped = fitOpeningOffset(state.project, probe, state.walls, (center - base) * frame.dir);
      if (clamped !== null) {
        opening.width = width;
        setOpeningPos(opening, clamped);
      }
      requestDraw();
      return;
    }

    if (drag.kind === 'mwall-end') {
      // Торец ручной стены: только вдоль оси, с привязками (Shift — без них).
      const wall = state.project.walls.find((w) => w.id === drag.id);
      if (!wall) return;
      Object.assign(wall, structuredClone(drag.start));
      for (const h of drag.hostStarts) {
        const o = state.project.openings.find((x) => x.id === h.id);
        if (o) o.host = { ...h.host };
      }
      const fixed = drag.start.axis[drag.end === 'a' ? 'b' : 'a'];
      const others = state.project.walls.filter((w) => w.id !== wall.id);
      const p = snapWallPoint({
        p: plan, prev: fixed, walls: (state.walls || []).filter((w) => w.wallId !== wall.id), manual: others,
        tol: 12 / state.view.scale, grid: gridStep(), free: event.shiftKey,
      }).point;
      drag.moved = dragManualWallEnd(state.project, wall.id, drag.end, p).ok || drag.moved;
      refreshDerived();
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
  });
  canvas.addEventListener('pointerup', (event) => {
    touches.delete(event.pointerId);
    if (drag?.kind === 'pinch') {
      if (touches.size < 2) { drag = null; requestDraw(); }
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
    const finished = drag;
    drag = null;
    state.guides = [];
    state.objGuides = null;
    state.kitchenLabel = null;
    if (finished.kind === 'site-vertex' || finished.kind === 'ls-vertex') state.drawSnap = null;

    if (finished.kind === 'pan') { requestDraw(); return; }
    if (finished.kind === 'item' && !finished.moved && finished.wasSelected) { cycleItemHandle(finished.id); return; }
    if (finished.kind === 'multi' && !finished.moved && finished.wasSelected && isItemGroup(state.selection)) { cycleGroupHandle(); return; }
    if (finished.kind.startsWith('group-')) state.groupRotateDeg = null;
    if (finished.kind.startsWith('ls-')) { landscapeDragEnd(finished); return; }

    if (finished.kind === 'marquee') {
      applyMarquee();
      state.marquee = null;
      requestDraw();
      return;
    }

    if (finished.kind === 'wall') {
      if (!finished.moved) { requestDraw(); return; }
      if (!finished.valid) {
        restoreFrom(finished.before);
        toast(finished.reason || 'Так переместить стену нельзя', true);
        return;
      }
      for (const entry of finished.roomStarts) {
        const room = roomById(state.project, entry.id);
        if (room?.outline) finalizeRoomOutlineKeepOpenings(state.project, room);
      }
      reconcileOpenings();
      refreshDerived();
      pushHistory(finished.before);
      afterChange();
      if (finished.clamped?.length) toast(`Проёмы прижаты к краю укороченной стены: ${finished.clamped.length}`, true);
      return;
    }

    if (finished.kind === 'mwall-end') {
      if (!finished.moved) { requestDraw(); return; }
      reconcileOpenings(); // проёмы за новым торцом прижимаются или удаляются
      refreshDerived();
      pushHistory(finished.before);
      afterChange();
      return;
    }

    if (finished.kind === 'room' || finished.kind === 'resize' || finished.kind === 'shape-resize' || finished.kind === 'multi') {
      state.ghost = null;
      if (!finished.moved) {
        if (finished.kind === 'shape-resize' && state.pendingRoomSplit?.roomId === finished.roomId) {
          const pending = state.pendingRoomSplit;
          const room = roomById(state.project, pending.roomId);
          if (room) {
            keepOpenings(state.project, room, () => {
              if (pending.outline) room.outline = structuredClone(pending.outline); else delete room.outline;
              if (pending.notch) room.notch = structuredClone(pending.notch); else delete room.notch;
            });
          }
          state.pendingRoomSplit = null;
          refreshDerived();
        }
        requestDraw(); return;
      }
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
      if (finished.kind === 'shape-resize') {
        const room = roomById(state.project, finished.roomId);
        const finalized = room?.outline ? finalizeRoomOutlineKeepOpenings(state.project, room) : { merged: finished.merged };
        finished.merged = finished.merged || finalized.merged;
        state.pendingRoomSplit = null;
      }
      // Сдвинутая/растянутая комната «съедает» перекрытые: нижняя
      // уменьшается, между ними перегородка (core/room-eat.js). Тот же шаг
      // отмены, что и сам жест.
      const movedIds = finished.kind === 'multi' ? finished.roomIds
        : [finished.kind === 'room' ? finished.id : finished.roomId];
      const eaten = eatOverlapsAfter(movedIds.filter(Boolean));
      if (eaten.eaten.length || eaten.failed.length || eaten.restored.length) finished.clamped = null;
      reconcileOpenings();
      refreshDerived();
      pushHistory(finished.before);
      afterChange();
      if (finished.kind === 'shape-resize' && finished.merged) {
        toast('Стены выровнены и объединены в одну');
      } else if (finished.clamped?.length) {
        toast(`Проёмы прижаты к краю укороченной стены: ${finished.clamped.length}`, true);
      }
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
  canvas.addEventListener('pointercancel', (event) => {
    touches.delete(event.pointerId);
    canvas.parentElement?.classList.remove('move-armed');
    if (drag?.kind === 'touch-hold') clearTimeout(drag.timer);
    if (drag && drag.kind !== 'pinch' && drag.before && drag.moved) restoreFrom(drag.before);
    drag = null;
    state.marquee = null;
    state.ghost = null;
    state.kitchenLabel = null;
    state.groupRotateDeg = null;
    state.guides = [];
    state.objGuides = null;
    requestDraw();
  });
  canvas.addEventListener('dblclick', (event) => {
    if (state.modeName === 'landscape') { landscapeDblClick(pointerWorld(event)); return; }
    if (state.draft && (state.draft.kind === 'redline' || state.draft.kind === 'road')) finishDraft();
    if (state.tool?.kind === 'wall') finishWallChain();
  });
  canvas.addEventListener('wheel', (event) => {
    event.preventDefault();
    const screen = pointerScreen(event);
    const factor = event.deltaY < 0 ? 1.12 : 1 / 1.12;
    zoomAt(screen, factor);
    positionDimInput();
  }, { passive: false });
}
