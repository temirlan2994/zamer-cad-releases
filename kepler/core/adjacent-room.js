// Пристройка типовой комнаты к существующей наружной стене на активном этаже.
import { DEFAULT_PARTITION, DOOR_WIDTH, isOpenRoom, isShaft, roomType } from './catalog.js';
import { intersection } from './geom/clip.js';
import { rectRing } from './geom/poly.js';
import { activeLevel, createOpening, createRoom, levelProject } from './model.js';
import { fitOpeningOffset } from './opening-spacing.js';
import { roomRects } from './room-shape.js';
import { rectsOverlap, validateRoomPlacement } from './rooms.js';
import { levelWindowOpenings } from './spanning-windows.js';
import { deriveWalls, openingRect, wallRects } from './walls.js';

const blocked = (reason) => ({ ok: false, reason });

export function canAttachRoom(room) {
  return Boolean(room && !room.parentId && !isOpenRoom(room) && !isShaft(room));
}

function spaceForRoom(project, room, gap, walls) {
  const clearance = { x: room.x - gap, y: room.y - gap, w: room.w + 2 * gap, h: room.h + 2 * gap };
  const occupied = project.rooms.find((other) => !other.parentId && roomRects(other).some((r) => rectsOverlap(r, clearance)));
  if (occupied) return blocked(`Эту сторону занимает «${occupied.name}». Выберите другую сторону.`);
  const outline = rectRing(room.x, room.y, room.w, room.h);
  const manualWall = walls.some((w) => w.kind === 'manual' && (
    wallRects(w).some((r) => rectsOverlap(r, room)) ||
    (w.orient === 'a' && (w.polys || [w.poly]).some((poly) => intersection(poly, outline).length))
  ));
  if (manualWall) return blocked('Здесь проходит стена. Выберите другую сторону.');
  return validateRoomPlacement(project, room, null);
}

// Оба торца удобны для ровного фасада. Если они заняты, пробуем середину
// и границы свободных интервалов между окнами, стенами и другими комнатами.
function alongCandidates(host, length, depth, across, openings, obstacles, gap) {
  const start = host.from;
  const end = host.to - length;
  const min = Math.min(start, end);
  const max = Math.max(start, end);
  const positions = new Set([start, end, Math.round((start + end) / 2)]);
  const horizontal = host.orient === 'h';
  const addLimits = (rect, margin) => {
    const cross = horizontal ? rect.y : rect.x;
    const width = horizontal ? rect.h : rect.w;
    if (cross > across + depth + gap || cross + width < across - gap) return;
    const from = horizontal ? rect.x : rect.y;
    const to = from + (horizontal ? rect.w : rect.h);
    for (const pos of [to + margin, from - length - margin]) {
      if (pos >= min && pos <= max) positions.add(pos);
    }
  };
  for (const { placed } of openings) if (placed) addLimits(placed.rect, 50);
  for (const rect of obstacles) addLimits(rect, gap);
  return positions;
}

// Проецируем межэтажные и угловые окна до изменения фасада. После вставки
// две исходные стены могут иметь другой ключ, а проекция витража — исчезнуть.
function checkOpenings(shared, openings, sourceId, newRoomId) {
  let existingDoor = false;
  for (const wall of shared) {
    const other = wall.rooms.find((id) => id !== newRoomId);
    for (const { opening, placed } of openings) {
      if (!placed || placed.wall.kind !== 'own' || placed.wall.sides[other] !== wall.sides[other]) continue;
      const from = placed.absCenter - opening.width / 2;
      const to = placed.absCenter + opening.width / 2;
      if (to + 50 <= wall.from || from - 50 >= wall.to) continue;
      if (opening.kind === 'window') return blocked('Пристройка закроет окно. Выберите другую сторону.');
      if (from < wall.from + 50 || to > wall.to - 50) return blocked('Новая стена пересечёт дверь. Выберите другую сторону.');
      if (other === sourceId) existingDoor = true;
    }
  }
  return { ok: true, existingDoor };
}

function withCandidate(project, candidate) {
  const level = activeLevel(project);
  const levels = project.levels.map((l) => l === level ? { ...l, rooms: [...l.rooms, candidate] } : l);
  return levelProject({ ...project, levels }, level.id);
}

export function planAdjacentRoom(project, roomId, type, side, withDoor = true, walls = deriveWalls(project)) {
  const anchor = project.rooms.find((r) => r.id === roomId);
  const def = roomType(type);
  if (!canAttachRoom(anchor) || !def || def.open || def.shaft) return blocked('Выберите закрытое помещение этажа.');
  const available = walls.filter((w) => w.kind === 'own' && !w.hidden && w.sides[roomId] === side)
    .sort((a, b) => (b.to - b.from) - (a.to - a.from));
  if (!available.length) return blocked('На этой стороне нет свободной наружной стены.');
  const gap = project.settings?.partition || DEFAULT_PARTITION;
  const openings = levelWindowOpenings(project, walls).map((opening) => ({ opening, placed: openingRect(project, opening, walls) }));
  const obstacles = [...project.rooms.filter((r) => !r.parentId && r.id !== roomId).flatMap(roomRects),
    ...walls.filter((w) => w.kind === 'manual').map((w) => w.band)];
  let result = blocked('На этой стороне недостаточно места.');
  for (const host of available) {
    const horizontal = host.orient === 'h';
    const length = horizontal ? def.w : def.h;
    const depth = horizontal ? def.h : def.w;
    const across = host.outward > 0 ? host.edge + gap : host.edge - gap - depth;
    for (const along of alongCandidates(host, length, depth, across, openings, obstacles, gap)) {
      const room = createRoom(type, horizontal ? along : across, horizontal ? across : along, def.w, def.h);
      result = spaceForRoom(project, room, gap, walls);
      if (!result.ok) continue;
      const warning = result.warning;
      const trial = withCandidate(project, room);
      const nextWalls = deriveWalls(trial);
      const shared = nextWalls.filter((w) => w.kind === 'shared' && w.rooms.includes(room.id));
      const join = shared.find((w) => !w.hidden && w.sides[roomId] === side);
      if (!join) { result = blocked('Здесь не удаётся построить общую стену.'); continue; }
      result = checkOpenings(shared, openings, roomId, room.id);
      if (!result.ok) continue;
      const existingDoor = result.existingDoor;
      let door = null;
      if (withDoor && !existingDoor) {
        const base = horizontal ? room.x : room.y;
        door = createOpening('door', room.id, join.sides[room.id], (join.from + join.to) / 2 - base, DOOR_WIDTH);
        const offset = fitOpeningOffset(trial, door, nextWalls, door.offset);
        if (offset == null || base + offset - DOOR_WIDTH / 2 < join.from || base + offset + DOOR_WIDTH / 2 > join.to) {
          result = blocked('Для двери мало места. Снимите «Дверь между комнатами» или выберите другую сторону.');
          continue;
        }
        door.offset = offset;
      }
      return { ok: true, room, door, existingDoor, warning };
    }
  }
  return result;
}
