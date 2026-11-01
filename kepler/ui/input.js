// Ввод мышью на канвасе: выбор, перетаскивания, рамка, колесо, drag-and-drop.

import { GRID_STEP, furnitureDef, roomType } from '../core/catalog.js';
import { arrangeRoom, reclaimItemsFromChild } from '../core/furnish.js';
import { roomById } from '../core/model.js';
import { determineParent, snapRoomPosition, validateRoomPlacement } from '../core/rooms.js';
import { nearestPointOnPolyline } from '../core/site.js';
import { clampOpeningOffset, openingRect, sideEdge } from '../core/walls.js';
import { pointInPolygon } from '../core/zamer/geometry.js';
import {
  itemCorners, neighborCorners, projectPoint, rotateVec, underlayCenter, underlayHandles, unprojectPoint,
} from '../render.js';
import { hideDimInput, openDimInput } from './dim-input.js';
import { canvas, el, refs, toast } from './dom.js';
import {
  findWall, hitItem, hitItemHandle, hitNeighborHandle, hitOpening, hitOpeningHandle, hitRoom,
  hitRoomHandle, hitSiteObject, hitSiteVertex, hitUnderlayHandle, hitWall,
} from './hit.js';
import { spaceDown } from './keyboard.js';
import { closeLibrarySheet } from './mobile.js';
import {
  addFurnitureAt, bringRoomToTop, computeOpeningParams, overlappingTopRooms, placeOpeningAt,
  placeRoomAt, reconcileOpenings, selectGroup, toggleInMulti, toggleOpeningFlip,
} from './plan-actions.js';
import {
  addAlignPoint, addDraftPoint, addNorthPoint, computeEntryAt, finishDraft, placeNeighborAt,
} from './site-actions.js';
import { applyResize, resizeVerdict, snapItemToWalls } from './snap.js';
import { state } from './state.js';
import { afterChange, pushHistory, refreshDerived, restoreFrom, snapshot } from './store.js';
import { activeSiteLayer, cancelTool, positionWallButtons, selectObject } from './tools.js';
import { addCalibratePoint, hideCalInput, positionCalInput } from './underlay.js';
import {
  pointerScreen, pointerWorld, requestDraw, scaleLabel, screenToPlan, worldToPlan, worldToScreen, zoomAt,
} from './view.js';

let drag = null;
// Активные касания (pointerId → точка экрана): два пальца — щипок/панорама.
const touches = new Map();

// Второй палец: всё начатое одним пальцем отменяется, начинается щипок.
function startPinch() {
  if (drag?.before && drag.moved) restoreFrom(drag.before);
  state.marquee = null;
  state.ghost = null;
  state.guides = [];
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
  const anchor = unprojectPoint(v0, drag.mid.x, drag.mid.y);
  state.view.scale = Math.min(0.6, Math.max(0.004, (v0.scale * dist) / drag.dist));
  const p = projectPoint({ ...state.view, panX: 0, panY: 0 }, anchor.x, anchor.y);
  state.view.panX = mid.x - p.x;
  state.view.panY = mid.y - p.y;
  refs.statusScale.textContent = scaleLabel();
  positionCalInput();
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

function startMultiDrag(plan) {
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
    plan,
    before: snapshot(),
    moved: false,
    valid: true,
    roomIds: [...sel.roomIds],
    roomStarts: movedRooms,
    itemStarts: movedItems,
  };
}

function applyMarquee() {
  const m = state.marquee;
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

function updateHoverAndGhost(world, plan) {
  if (state.tool?.kind === 'place-room') {
    const def = roomType(state.tool.type);
    let x = plan.x - def.w / 2;
    let y = plan.y - def.h / 2;
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
  const item = hitItem(plan);
  if (item) nextHover = { type: 'item', id: item.id };
  if (!nextHover) {
    const opening = hitOpening(plan);
    if (opening) nextHover = { type: 'opening', id: opening.id };
  }
  if (!nextHover) {
    const wall = hitWall(plan);
    if (wall) nextHover = { type: 'wall', key: wall.key, from: wall.from };
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
  if (JSON.stringify(nextHover) !== JSON.stringify(state.hover)) {
    state.hover = nextHover;
    requestDraw();
  }
}

export function bindCanvasInput() {
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
  canvas.addEventListener('pointerdown', (event) => {
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
      if (t.kind === 'place-room') { placeRoomAt(plan); return; }
      if (t.kind === 'place-opening') { placeOpeningAt(plan); return; }
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
      drag = { kind: 'resize', roomId: handleHit.room.id, handle: handleHit.handle, start: { ...handleHit.room }, before: snapshot(), plan, valid: true };
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

    const item = hitItem(plan);
    if (item) {
      if (event.shiftKey) { toggleInMulti('item', item.id); return; }
      if (state.selection?.type === 'multi' && state.selection.itemIds.includes(item.id)) {
        startMultiDrag(plan);
        return;
      }
      if (item.group) { selectGroup(item.group); startMultiDrag(plan); return; }
      selectObject({ type: 'item', id: item.id });
      drag = { kind: 'item', id: item.id, start: { x: item.x, y: item.y }, plan, before: snapshot(), moved: false };
      return;
    }

    const opening = hitOpening(plan);
    if (opening) {
      selectObject({ type: 'opening', id: opening.id });
      drag = { kind: 'opening', id: opening.id, before: snapshot(), moved: false };
      return;
    }

    const wall = hitWall(plan);
    if (wall) {
      selectObject({ type: 'wall', key: wall.key, from: wall.from });
      return;
    }

    const room = hitRoom(plan);
    if (room) {
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
  });
  canvas.addEventListener('pointermove', (event) => {
    const screen = pointerScreen(event);
    if (event.pointerType === 'touch' && touches.has(event.pointerId)) touches.set(event.pointerId, screen);
    if (drag?.kind === 'pinch') { movePinch(); return; }
    const world = pointerWorld(event);
    const plan = worldToPlan(world);
    // В «Плане» — координаты в осях дома, в «Участке» — координаты съёмки.
    const shown = state.modeName === 'plan' ? plan : world;
    refs.statusCursor.textContent = `${(shown.x / 1000).toFixed(2)}; ${(shown.y / 1000).toFixed(2)} м`;

    if (!drag) { updateHoverAndGhost(world, plan); return; }

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
      const rawX = drag.start.x + (plan.x - drag.plan.x);
      const rawY = drag.start.y + (plan.y - drag.plan.y);
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
      const dx = Math.round((plan.x - drag.plan.x) / GRID_STEP) * GRID_STEP;
      const dy = Math.round((plan.y - drag.plan.y) / GRID_STEP) * GRID_STEP;
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
      applyResize(room, drag, plan);
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
      item.x = Math.round((drag.start.x + (plan.x - drag.plan.x)) / GRID_STEP) * GRID_STEP;
      item.y = Math.round((drag.start.y + (plan.y - drag.plan.y)) / GRID_STEP) * GRID_STEP;
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
      const desired = (edge.orient === 'h' ? plan.x : plan.y) - base;
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
      const pos = (edge.orient === 'h' ? plan.x : plan.y) - base;
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
      const ang = Math.atan2(plan.y - drag.center.y, plan.x - drag.center.x);
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
  canvas.addEventListener('pointerup', (event) => {
    touches.delete(event.pointerId);
    if (drag?.kind === 'pinch') {
      if (touches.size < 2) { drag = null; requestDraw(); }
      return;
    }
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
  canvas.addEventListener('pointercancel', (event) => {
    touches.delete(event.pointerId);
    if (drag && drag.kind !== 'pinch' && drag.before && drag.moved) restoreFrom(drag.before);
    drag = null;
    state.marquee = null;
    state.ghost = null;
    state.guides = [];
    requestDraw();
  });
  canvas.addEventListener('dblclick', () => {
    if (state.draft && (state.draft.kind === 'redline' || state.draft.kind === 'road')) finishDraft();
  });
  canvas.addEventListener('wheel', (event) => {
    event.preventDefault();
    const screen = pointerScreen(event);
    const factor = event.deltaY < 0 ? 1.12 : 1 / 1.12;
    zoomAt(screen, factor);
  }, { passive: false });
}
