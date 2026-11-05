// Дубликат помещения (Ctrl+D): куда поставить копию и что делать с её
// проёмами. Копия встаёт вплотную (через перегородку) справа, слева, снизу
// или сверху — первое место, где она ни на кого не налезает и не загоняет
// окна СУЩЕСТВУЮЩИХ комнат в общую стену. Если вплотную места нет — копия
// ставится отдельно справа от дома. Окна копии, оказавшиеся в общей стене,
// удаляются; остальные проёмы копии раздвигаются с соседями (opening-spacing).

import { createOpening, createRoom } from './model.js';
import { rectsOverlap, validateRoomPlacement } from './rooms.js';
import { deriveWalls } from './walls.js';
import { resolveOpeningConflicts, windowsOnSharedWalls } from './opening-spacing.js';

const DETACHED_GAP = 1000; // больше MAX_SHARED_GAP — отдельная копия не стыкуется

const clone = (value) => JSON.parse(JSON.stringify(value));

function buildCopies(project, sourceRooms, dx, dy) {
  const roomMap = new Map();
  const rooms = sourceRooms.map((room) => {
    const copy = createRoom(room.type, room.x + dx, room.y + dy, room.w, room.h);
    const id = copy.id;
    Object.assign(copy, clone(room), { id, x: room.x + dx, y: room.y + dy });
    roomMap.set(room.id, id);
    return copy;
  });
  sourceRooms.forEach((room, i) => {
    const oldParent = room.parentId;
    rooms[i].parentId = roomMap.get(oldParent) || oldParent || null;
  });
  const openings = (project.openings || []).filter((o) => roomMap.has(o.roomId)).map((o) => {
    const roomId = roomMap.get(o.roomId);
    const copy = createOpening(o.kind, roomId, o.side, o.offset, o.width);
    const id = copy.id;
    return Object.assign(copy, clone(o), { id, roomId });
  });
  return { rooms, openings };
}

function trialProject(project, rooms, openings) {
  // rooms/openings/items/wallOverrides — неперечисляемые аксессоры этажа,
  // spread их не копирует: переносим явно.
  return {
    ...project,
    wallOverrides: project.wallOverrides || {},
    items: project.items || [],
    rooms: [...project.rooms, ...rooms],
    openings: [...(project.openings || []), ...openings],
  };
}

// Возвращает { ok, reason?, dx, dy, rooms, openings, removedWindows, movedOpenings, detached }.
// Проект не меняется: rooms/openings — готовые копии для вставки.
export function planRoomDuplicate(project, sourceId) {
  const source = project.rooms.find((r) => r.id === sourceId);
  if (!source) return { ok: false, reason: 'Помещение не найдено' };
  const partition = project.settings?.partition || 100;
  const sourceRooms = [source, ...project.rooms.filter((r) => !source.parentId && r.parentId === source.id)];
  const candidates = [
    { dx: source.w + partition, dy: 0 },
    { dx: -(source.w + partition), dy: 0 },
    { dx: 0, dy: source.h + partition },
    { dx: 0, dy: -(source.h + partition) },
  ];
  const fits = (dx, dy) => {
    const rect = { x: source.x + dx, y: source.y + dy, w: source.w, h: source.h };
    if (source.parentId) return validateRoomPlacement(project, { ...source, ...rect }, null).ok;
    return !project.rooms.some((r) => !r.parentId && rectsOverlap(rect, r));
  };
  const existingWindows = (project.openings || []).filter((o) => o.kind === 'window').map((o) => o.id);
  const baseline = new Set(windowsOnSharedWalls(project, deriveWalls(project), existingWindows));

  let best = null;
  for (const c of candidates) {
    if (!fits(c.dx, c.dy)) continue;
    const built = buildCopies(project, sourceRooms, c.dx, c.dy);
    const trial = trialProject(project, built.rooms, built.openings);
    const walls = deriveWalls(trial);
    const spoiled = windowsOnSharedWalls(trial, walls, existingWindows).filter((id) => !baseline.has(id));
    if (spoiled.length) continue; // окна соседей в общую стену не загоняем
    const lost = windowsOnSharedWalls(trial, walls, built.openings.map((o) => o.id));
    if (!best || lost.length < best.lost.length) best = { ...c, built, trial, walls, lost };
    if (!lost.length) break;
  }
  let detached = false;
  if (!best) {
    if (source.parentId) return { ok: false, reason: 'Рядом нет места для копии вложенного помещения' };
    const top = project.rooms.filter((r) => !r.parentId);
    const maxX = Math.max(...top.map((r) => r.x + r.w));
    const c = { dx: maxX + DETACHED_GAP - source.x, dy: 0 };
    const built = buildCopies(project, sourceRooms, c.dx, c.dy);
    const trial = trialProject(project, built.rooms, built.openings);
    const walls = deriveWalls(trial);
    best = { ...c, built, trial, walls, lost: windowsOnSharedWalls(trial, walls, built.openings.map((o) => o.id)) };
    detached = true;
  }
  const gone = new Set(best.lost);
  best.trial.openings = best.trial.openings.filter((o) => !gone.has(o.id));
  const copyIds = best.built.openings.filter((o) => !gone.has(o.id)).map((o) => o.id);
  const conflicts = resolveOpeningConflicts(best.trial, best.walls, { ids: copyIds });
  const dropped = new Set(conflicts.dropped);
  return {
    ok: true,
    dx: best.dx,
    dy: best.dy,
    detached,
    rooms: best.built.rooms,
    openings: best.built.openings.filter((o) => !gone.has(o.id) && !dropped.has(o.id)),
    removedWindows: best.lost.length,
    removedOpenings: best.lost.length + conflicts.dropped.length,
    movedOpenings: conflicts.moved.length,
  };
}
