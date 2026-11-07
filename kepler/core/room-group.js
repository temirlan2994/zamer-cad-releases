// Действия над группой помещений (мультивыделение): сдвиг, поворот на 90°,
// копия. Без DOM — вызывающий код (ui/plan-actions.js) после изменения
// вызывает reconcileOpenings, refreshDerived (стены, связность) и пишет одну
// запись истории.
//
// Груз группы: выбранные помещения + их вложенные помещения + мебель и
// лестницы, стоящие внутри них, + отдельно выбранная мебель. Проёмы хранятся
// относительно комнаты (side/offset) — при сдвиге едут сами, при повороте
// пересчитываются.

import { GRID_STEP } from './catalog.js';
import { createItem } from './model.js';
import { planRoomsCopy } from './duplicate-room.js';
import { roomBoundaryEdges, roomContainsPoint, roomPolygon } from './room-shape.js';
import { validateRoomPlacement } from './rooms.js';
import { turnSpans } from './wall-spans.js';

const clone = (value) => JSON.parse(JSON.stringify(value));

// carry — готовый набор мебели комнат (Set id): жест над съеденной комнатой
// берёт мебель по ВИДИМОЙ форме до того, как ей вернули номинал (иначе
// уехала бы мебель верхней комнаты, стоящая над «вырезом»).
export function groupCargo(project, roomIds = [], itemIds = [], carry = null) {
  const selected = new Set(roomIds);
  const rooms = project.rooms.filter((r) => selected.has(r.id) || (r.parentId && selected.has(r.parentId)));
  const pickedItems = new Set(itemIds);
  const items = (project.items || []).filter((item) => pickedItems.has(item.id)
    || (carry ? carry.has(item.id) : rooms.some((room) => roomContainsPoint(room, item.x, item.y))));
  return { rooms, items };
}

function validateGroup(project, roomIds) {
  let warning = null;
  for (const id of roomIds) {
    const room = project.rooms.find((r) => r.id === id);
    if (!room) continue;
    const verdict = validateRoomPlacement(project, room, room.id);
    if (!verdict.ok) return verdict;
    if (verdict.warning && !warning) warning = verdict.warning;
  }
  return warning ? { ok: true, warning } : { ok: true };
}

// Снимок изменяемых полей для отката при недопустимом результате.
function remember(project, cargo) {
  const roomIds = new Set(cargo.rooms.map((r) => r.id));
  return {
    rooms: cargo.rooms.map((room) => [room, clone(room)]),
    items: cargo.items.map((item) => [item, clone(item)]),
    openings: (project.openings || []).filter((o) => roomIds.has(o.roomId)).map((o) => [o, clone(o)]),
    overrides: clone(project.wallOverrides || {}),
  };
}

function rollback(project, saved) {
  for (const list of [saved.rooms, saved.items, saved.openings]) {
    for (const [target, copy] of list) {
      for (const key of Object.keys(target)) delete target[key];
      Object.assign(target, copy);
    }
  }
  if (project.wallOverrides) {
    for (const key of Object.keys(project.wallOverrides)) delete project.wallOverrides[key];
    Object.assign(project.wallOverrides, saved.overrides);
  }
}

// Сдвиг группы на (dx, dy). Возвращает { ok, reason?, warning?, rooms, items };
// при ok=false проект возвращается в исходное состояние.
export function moveRoomGroup(project, roomIds, itemIds, dx, dy, { carry = null } = {}) {
  const cargo = groupCargo(project, roomIds, itemIds, carry);
  if (!cargo.rooms.length && !cargo.items.length) return { ok: false, reason: 'Нечего сдвигать' };
  const saved = remember(project, cargo);
  for (const room of cargo.rooms) { room.x += dx; room.y += dy; }
  for (const item of cargo.items) { item.x += dx; item.y += dy; }
  const verdict = validateGroup(project, roomIds);
  if (!verdict.ok) { rollback(project, saved); return { ...verdict, rooms: [], items: [] }; }
  return { ...verdict, rooms: cargo.rooms.map((r) => r.id), items: cargo.items.map((i) => i.id) };
}

// Поворот по часовой (ось Y вниз): (x, y) → (cx − (y − cy), cy + (x − cx)).
const turnPoint = (p, cx, cy) => ({ x: cx - (p.y - cy), y: cy + (p.x - cx) });
const NOTCH_TURN = { nw: 'ne', ne: 'se', se: 'sw', sw: 'nw' };

function turnSideName(side) {
  if (typeof side === 'number') return (side + 1) % 4;
  if (side === 'notch-h') return 'notch-v';
  if (side === 'notch-v') return 'notch-h';
  return side; // outline-i: порядок вершин при повороте сохраняется
}

function distToRange(v, from, to) {
  return v < from ? from - v : v > to ? v - to : 0;
}

// Точка проёма на линии стены и внешняя нормаль — до поворота.
function openingAnchor(room, opening) {
  const edges = roomBoundaryEdges(room).filter((edge) => edge.side === opening.side);
  const base = (orient) => (orient === 'h' ? room.x : room.y);
  const along = (edge) => base(edge.orient) + Number(opening.offset);
  const edge = edges.sort((a, b) => distToRange(along(a), a.from, a.to) - distToRange(along(b), b.from, b.to))[0];
  if (!edge) return null;
  const at = along(edge);
  const point = edge.orient === 'h' ? { x: at, y: edge.edge } : { x: edge.edge, y: at };
  return { point, orient: edge.orient, outward: edge.outward };
}

function turnRoomShape(room, cx, cy) {
  if (Array.isArray(room.outline) && room.outline.length >= 4) {
    const points = roomPolygon(room).map((p) => turnPoint(p, cx, cy));
    const minX = Math.min(...points.map((p) => p.x));
    const minY = Math.min(...points.map((p) => p.y));
    room.x = minX; room.y = minY;
    room.w = Math.max(...points.map((p) => p.x)) - minX;
    room.h = Math.max(...points.map((p) => p.y)) - minY;
    room.outline = points.map((p) => ({ x: p.x - minX, y: p.y - minY }));
    return;
  }
  const corner = turnPoint({ x: room.x, y: room.y + room.h }, cx, cy); // левый-нижний → левый-верхний
  const { w, h } = room;
  room.x = corner.x; room.y = corner.y; room.w = h; room.h = w;
  if (room.notch && NOTCH_TURN[room.notch.corner]) {
    room.notch = { ...room.notch, corner: NOTCH_TURN[room.notch.corner], w: room.notch.h, h: room.notch.w };
  }
}

// Центр поворота — центр габарита группы, привязанный к сетке: при
// координатах на сетке результат тоже остаётся на сетке.
export function groupCenter(cargo, grid = GRID_STEP) {
  const boxes = [
    ...cargo.rooms.map((r) => ({ x1: r.x, y1: r.y, x2: r.x + r.w, y2: r.y + r.h })),
    ...(cargo.rooms.length ? [] : cargo.items.map((i) => ({ x1: i.x, y1: i.y, x2: i.x, y2: i.y }))),
  ];
  if (!boxes.length) return null;
  const cx = (Math.min(...boxes.map((b) => b.x1)) + Math.max(...boxes.map((b) => b.x2))) / 2;
  const cy = (Math.min(...boxes.map((b) => b.y1)) + Math.max(...boxes.map((b) => b.y2))) / 2;
  return { x: Math.round(cx / grid) * grid, y: Math.round(cy / grid) * grid };
}

// Поворот группы на 90° по часовой вокруг центра группы. Проёмы остаются на
// тех же (повёрнутых) местах стен, переопределения своих стен (толщина,
// тип, скрытие) переходят на повёрнутые стороны. Возвращает как moveRoomGroup.
export function rotateRoomGroup(project, roomIds, itemIds, { grid = GRID_STEP, carry = null } = {}) {
  const cargo = groupCargo(project, roomIds, itemIds, carry);
  const center = groupCenter(cargo, grid);
  if (!center) return { ok: false, reason: 'Нечего поворачивать' };
  const { x: cx, y: cy } = center;
  const saved = remember(project, cargo);
  turnCargo(project, cargo, cx, cy);
  const verdict = validateGroup(project, roomIds);
  if (!verdict.ok) { rollback(project, saved); return { ...verdict, rooms: [], items: [] }; }
  return { ...verdict, center, rooms: cargo.rooms.map((r) => r.id), items: cargo.items.map((i) => i.id) };
}

// Поворот комнат и мебели груза вокруг (cx, cy) с проёмами и
// переопределениями стен.
function turnCargo(project, cargo, cx, cy) {
  const cargoIds = new Set(cargo.rooms.map((r) => r.id));
  const openings = (project.openings || []).filter((o) => cargoIds.has(o.roomId));
  const anchors = new Map();
  for (const opening of openings) {
    const room = cargo.rooms.find((r) => r.id === opening.roomId);
    const anchor = openingAnchor(room, opening);
    if (anchor) anchors.set(opening.id, anchor);
  }
  // Высоты до поворота — для участков стен (core/wall-spans.js turnSpans).
  const oldH = new Map(cargo.rooms.map((r) => [r.id, (r.eatBase?.base || r).h]));
  for (const room of cargo.rooms) turnRoomShape(room, cx, cy);
  for (const item of cargo.items) {
    const p = turnPoint(item, cx, cy);
    item.x = p.x; item.y = p.y;
    item.rotation = ((item.rotation || 0) + 90) % 360;
  }
  for (const opening of openings) {
    const anchor = anchors.get(opening.id);
    if (!anchor) continue;
    const room = cargo.rooms.find((r) => r.id === opening.roomId);
    const p = turnPoint(anchor.point, cx, cy);
    // Нормаль (0,−1)→(1,0): горизонтальная стена становится вертикальной с
    // outward = −o; вертикальная — горизонтальной с тем же outward.
    const orient = anchor.orient === 'h' ? 'v' : 'h';
    const outward = anchor.orient === 'h' ? -anchor.outward : anchor.outward;
    const line = orient === 'h' ? p.y : p.x;
    const at = orient === 'h' ? p.x : p.y;
    const edge = roomBoundaryEdges(room)
      .filter((e) => e.orient === orient && e.outward === outward && Math.abs(e.edge - line) < 1)
      .sort((a, b) => distToRange(at, a.from, a.to) - distToRange(at, b.from, b.to))[0];
    if (!edge) continue;
    opening.side = edge.side;
    opening.offset = at - (orient === 'h' ? room.x : room.y);
    // Вдоль вертикальной стены направление «от начала» после поворота
    // меняется на обратное — петли остаются у того же косяка.
    if (anchor.orient === 'v' && typeof opening.hingeStart === 'boolean') opening.hingeStart = !opening.hingeStart;
  }
  const overrides = project.wallOverrides;
  if (overrides) {
    const moved = {};
    for (const key of Object.keys(overrides)) {
      const [tag, roomId, ...rest] = key.split('|');
      // Общая стена пары внутри группы: участки (тип/скрытие) — от комнаты a.
      if (tag === 's' && cargoIds.has(roomId) && cargoIds.has(rest[0])) {
        overrides[key] = turnSpans(overrides[key], oldH.get(roomId));
        continue;
      }
      if (tag !== 'e' || !cargoIds.has(roomId) || !rest.length) continue;
      const raw = rest.join('|');
      const side = /^\d+$/.test(raw) ? Number(raw) : raw;
      moved[`e|${roomId}|${turnSideName(side)}`] = turnSpans(overrides[key], oldH.get(roomId));
      delete overrides[key];
    }
    Object.assign(overrides, moved);
  }
}

// Снимок группы для буфера (Ctrl+C): помещения, их проёмы и мебель.
export function captureRoomGroup(project, roomIds, itemIds = []) {
  const cargo = groupCargo(project, roomIds, itemIds);
  const ids = new Set(cargo.rooms.map((r) => r.id));
  return {
    rooms: clone(cargo.rooms),
    openings: clone((project.openings || []).filter((o) => ids.has(o.roomId))),
    items: clone(cargo.items),
  };
}

// План копии группы (Ctrl+D, Ctrl+V): место ищется как у копии помещения
// (core/duplicate-room.js) по габариту группы, окна копий в общих стенах
// убираются, мебель едет с тем же смещением. source — снимок captureRoomGroup.
// Проект не меняется. Возвращает план planRoomsCopy + items.
export function planGroupCopy(project, source) {
  const plan = planRoomsCopy(project, source.rooms, source.openings);
  if (!plan.ok) return plan;
  const ids = new Set(source.rooms.map((r) => r.id));
  const anchorIds = new Set(source.rooms.filter((r) => !r.parentId || !ids.has(r.parentId)).map((r) => plan.roomMap.get(r.id)));
  if (anchorIds.size === 1) {
    for (const room of plan.rooms) if (anchorIds.has(room.id)) room.name = `${room.name} — копия`;
  }
  const groupMap = new Map();
  const items = source.items.map((item) => {
    const copy = createItem(item.kind, item.x + plan.dx, item.y + plan.dy, item.w, item.h, item.rotation || 0);
    const id = copy.id;
    Object.assign(copy, clone(item), { id, x: item.x + plan.dx, y: item.y + plan.dy });
    if (item.group) {
      if (!groupMap.has(item.group)) groupMap.set(item.group, `grp-${Date.now().toString(36)}-${groupMap.size}`);
      copy.group = groupMap.get(item.group);
    }
    return copy;
  });
  return { ...plan, items };
}
