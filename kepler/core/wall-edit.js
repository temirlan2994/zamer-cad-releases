// Перемещение производной стены через изменение границ связанных помещений.
// Сама стена в проекте не хранится: после правки deriveWalls построит её заново.

import { GRID_STEP, isShaft } from './catalog.js';
import { captureOpeningAnchors, finalizeRoomOutlineKeepOpenings, reanchorOpenings } from './opening-anchor.js';
import {
  applyRoomShapeHandle, clampRoomNotch, roomBoundaryEdges, roomShapeHandles,
} from './room-shape.js';
import { MIN_ROOM_SIZE, MIN_SHAFT_SIZE, validateRoomPlacement } from './rooms.js';

const clone = (value) => structuredClone(value);

function edgeForWall(room, wall) {
  const side = wall.sides?.[room.id];
  const candidates = roomBoundaryEdges(room).filter((edge) => edge.side === side && edge.orient === wall.orient);
  if (!candidates.length) return null;
  return candidates.sort((a, b) => {
    const overlap = (edge) => Math.max(0, Math.min(edge.to, wall.to) - Math.max(edge.from, wall.from));
    return overlap(b) - overlap(a);
  })[0];
}

function restoreRoom(room, backup) {
  for (const key of Object.keys(room)) delete room[key];
  Object.assign(room, clone(backup));
}

function moveRectEdge(room, side, target) {
  const right = room.x + room.w;
  const bottom = room.y + room.h;
  if (side === 0) { room.y = target; room.h = bottom - target; }
  else if (side === 1) room.w = target - room.x;
  else if (side === 2) room.h = target - room.y;
  else if (side === 3) { room.x = target; room.w = right - target; }
  else return false;
  clampRoomNotch(room);
  return true;
}

function moveShapedEdge(room, edge, target) {
  const handle = roomShapeHandles(room).find((candidate) => candidate.kind === 'edge' &&
    (candidate.index === edge.index || candidate.id.endsWith(`-${edge.index}`)));
  if (!handle) return false;
  const point = edge.orient === 'h'
    ? { x: (edge.from + edge.to) / 2, y: target }
    : { x: target, y: (edge.from + edge.to) / 2 };
  applyRoomShapeHandle(room, handle, point, {
    minArm: isShaft(room) ? MIN_SHAFT_SIZE : MIN_ROOM_SIZE,
    mergeTolerance: GRID_STEP,
  });
  return true;
}

// Перемещает стену на delta перпендикулярно её оси. Для общей стены обе
// внутренние грани едут вместе, поэтому толщина перегородки не меняется.
export function moveWallBy(project, wall, delta, { finalize = false } = {}) {
  if (!wall || !['own', 'shared'].includes(wall.kind) || !Number.isFinite(delta)) {
    return { ok: false, reason: 'Эту стену нельзя переместить' };
  }
  const affected = wall.rooms.map((id) => project.rooms.find((room) => room.id === id)).filter(Boolean);
  const backups = new Map(affected.map((room) => [room.id, clone(room)]));
  // Отступы проёмов считаются от room.x/y: снимок до правки (блокер Б3).
  const anchors = new Map(affected.map((room) => [room.id, captureOpeningAnchors(project, room)]));

  for (const room of affected) {
    const edge = edgeForWall(room, wall);
    if (!edge) {
      for (const current of affected) restoreRoom(current, backups.get(current.id));
      return { ok: false, reason: 'Не найдена граница помещения для этой стены' };
    }
    const target = edge.edge + delta;
    const shaped = Boolean(room.outline || (room.notch && typeof edge.side === 'string'));
    const moved = shaped ? moveShapedEdge(room, edge, target) : moveRectEdge(room, edge.side, target);
    if (!moved) {
      for (const current of affected) restoreRoom(current, backups.get(current.id));
      return { ok: false, reason: 'Форму этой стены пока нельзя изменить' };
    }
  }

  for (const room of affected) {
    const min = isShaft(room) ? MIN_SHAFT_SIZE : MIN_ROOM_SIZE;
    const verdict = room.w >= min && room.h >= min
      ? validateRoomPlacement(project, room, room.id)
      : { ok: false, reason: `Минимальный размер помещения — ${min} мм` };
    if (!verdict.ok) {
      for (const current of affected) restoreRoom(current, backups.get(current.id));
      return verdict;
    }
  }

  const clamped = [];
  const lost = [];
  for (const room of affected) {
    const report = reanchorOpenings(project, room, anchors.get(room.id));
    clamped.push(...report.clamped); lost.push(...report.lost);
  }
  if (finalize) {
    for (const room of affected) if (room.outline) finalizeRoomOutlineKeepOpenings(project, room);
  }
  return { ok: true, roomIds: affected.map((room) => room.id), clamped, lost };
}

// Размеры от выбранной стены до противоположной внутренней грани каждого
// соседнего помещения. Для общей стены возвращаются два независимых размера.
export function wallRoomDimensions(project, wall) {
  if (!wall || !['own', 'shared'].includes(wall.kind)) return [];
  const result = [];
  for (const roomId of wall.rooms) {
    const room = project.rooms.find((candidate) => candidate.id === roomId);
    if (!room) continue;
    const edge = edgeForWall(room, wall);
    if (!edge) continue;
    const along = Math.max(edge.from, Math.min(edge.to, (wall.from + wall.to) / 2));
    const opposites = roomBoundaryEdges(room).map((candidate) => ({
      edge: candidate,
      distance: (candidate.edge - edge.edge) * -edge.outward,
    })).filter(({ edge: candidate, distance }) => candidate.orient === edge.orient && candidate !== edge &&
      distance > 1 && along >= candidate.from - 1 && along <= candidate.to + 1)
      .sort((a, b) => a.distance - b.distance);
    if (!opposites.length) continue;
    result.push({
      roomId, side: edge.side, orient: edge.orient, along,
      edge, opposite: opposites[0].edge, distance: opposites[0].distance,
    });
  }
  return result;
}
