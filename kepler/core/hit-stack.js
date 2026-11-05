// Стопка объектов под точкой плана — без DOM. Порядок соответствует
// отрисовке: мебель, проёмы, стены, затем помещения сверху вниз.

import { isOpenRoom, isShaft } from './catalog.js';
import { isFixedSizeComp, pointInComposite } from './composite.js';
import { itemRect } from './furnish.js';
import { roomContainsPoint } from './room-shape.js';
import { openingRect } from './walls.js';

function itemContains(item, point) {
  if (isFixedSizeComp(item)) return pointInComposite(item, point.x, point.y);
  const rect = itemRect(item);
  return point.x >= rect.x && point.x <= rect.x + rect.w && point.y >= rect.y && point.y <= rect.y + rect.h;
}

function openingContains(project, walls, opening, point, scale) {
  const placed = openingRect(project, opening, walls);
  if (!placed) return false;
  const pad = 8 / scale + 40;
  const rect = placed.rect;
  return point.x >= rect.x - pad && point.x <= rect.x + rect.w + pad &&
    point.y >= rect.y - pad && point.y <= rect.y + rect.h + pad;
}

export function planHitStack(project, walls, scale, point) {
  const hits = [];
  for (let i = project.items.length - 1; i >= 0; i -= 1) {
    const item = project.items[i];
    if (itemContains(item, point)) hits.push({ type: 'item', id: item.id, entity: item });
  }
  for (let i = project.openings.length - 1; i >= 0; i -= 1) {
    const opening = project.openings[i];
    if (openingContains(project, walls, opening, point, scale)) {
      hits.push({ type: 'opening', id: opening.id, entity: opening });
    }
  }
  for (let i = walls.length - 1; i >= 0; i -= 1) {
    const wall = walls[i];
    if (wall.kind === 'joint' || wall.kind === 'chamfer') continue;
    const band = wall.band;
    if (point.x >= band.x && point.x <= band.x + band.w && point.y >= band.y && point.y <= band.y + band.h) {
      hits.push({ type: 'wall', key: wall.key, from: wall.from, entity: wall });
    }
  }
  const roomLayer = (room) => (isShaft(room) ? 3 : room.parentId ? 2 : isOpenRoom(room) ? 0 : 1);
  const roomOrder = project.rooms.map((room, index) => ({ room, index }))
    .sort((a, b) => roomLayer(a.room) - roomLayer(b.room) || a.index - b.index)
    .reverse();
  for (const { room } of roomOrder) {
    if (roomContainsPoint(room, point.x, point.y)) hits.push({ type: 'room', id: room.id, entity: room });
  }
  return hits;
}

export function pickStackHit(stack, clickNumber = 1) {
  if (!stack.length) return null;
  const index = (Math.max(1, clickNumber) - 1) % stack.length;
  return stack[index];
}
