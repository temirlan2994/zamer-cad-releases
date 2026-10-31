// Производный граф стен Kepler Plan.
// Стены не хранятся в проекте — они каждый раз выводятся из прямоугольников
// комнат. Общая стена двух состыкованных комнат — ОДИН объект (kind: 'shared'),
// заполняющий зазор между их внутренними прямоугольниками. Остальные участки
// сторон — собственные стены комнаты (kind: 'own').
//
// Ключи стен стабильны: '
//   s|<idA>|<idB>'      — общая стена пары комнат,
//   'e|<roomId>|<side>' — собственные стены стороны комнаты (для overrides).

import { DEFAULT_PARTITION, DEFAULT_EXTERIOR } from './catalog.js';

export const MAX_SHARED_GAP = 450; // максимальный зазор, считающийся общей стеной

// Каноническое описание стороны: горизонтальные — интервал по X, вертикальные — по Y.
// side: 0 верх, 1 право, 2 низ, 3 лево.
export function sideEdge(room, side) {
  if (side === 0) return { orient: 'h', edge: room.y, from: room.x, to: room.x + room.w, outward: -1 };
  if (side === 1) return { orient: 'v', edge: room.x + room.w, from: room.y, to: room.y + room.h, outward: 1 };
  if (side === 2) return { orient: 'h', edge: room.y + room.h, from: room.x, to: room.x + room.w, outward: 1 };
  return { orient: 'v', edge: room.x, from: room.y, to: room.y + room.h, outward: -1 };
}

export function oppositeSide(side) {
  return (side + 2) % 4;
}

function overlap1d(a1, a2, b1, b2) {
  const from = Math.max(a1, b1);
  const to = Math.min(a2, b2);
  return to - from > 1 ? { from, to } : null;
}

function subtractIntervals(from, to, subs) {
  let rest = [{ from, to }];
  for (const sub of subs) {
    const next = [];
    for (const seg of rest) {
      const cut = overlap1d(seg.from, seg.to, sub.from, sub.to);
      if (!cut) { next.push(seg); continue; }
      if (cut.from - seg.from > 1) next.push({ from: seg.from, to: cut.from });
      if (seg.to - cut.to > 1) next.push({ from: cut.to, to: seg.to });
    }
    rest = next;
  }
  return rest;
}

export function sharedKey(idA, idB) {
  return idA < idB ? `s|${idA}|${idB}` : `s|${idB}|${idA}`;
}

export function ownKey(roomId, side) {
  return `e|${roomId}|${side}`;
}

// Находит стыковки: пары комнат-соседей с перекрытием проекций и малым зазором.
// Соседями считаются комнаты одного уровня вложенности (одинаковый parentId).
export function findAdjacencies(rooms) {
  const result = [];
  for (let i = 0; i < rooms.length; i += 1) {
    for (let j = i + 1; j < rooms.length; j += 1) {
      const a = rooms[i];
      const b = rooms[j];
      if ((a.parentId || null) !== (b.parentId || null)) continue;
      for (const side of [1, 2]) { // достаточно проверить право и низ комнаты A в обе стороны
        for (const [first, second] of [[a, b], [b, a]]) {
          const edgeA = sideEdge(first, side);
          const edgeB = sideEdge(second, oppositeSide(side));
          const gap = edgeB.edge - edgeA.edge;
          if (gap <= 1 || gap > MAX_SHARED_GAP) continue;
          const span = overlap1d(edgeA.from, edgeA.to, edgeB.from, edgeB.to);
          if (!span) continue;
          result.push({ a: first, b: second, sideA: side, gap, from: span.from, to: span.to });
        }
      }
    }
  }
  return result;
}

function wallTypeOf(override, fallback) {
  return (override && override.kind) || fallback;
}

// Главная функция: выводит все сегменты стен проекта.
export function deriveWalls(project) {
  const walls = [];
  const overrides = project.wallOverrides || {};
  const partition = project.settings?.partition || DEFAULT_PARTITION;
  const exterior = project.settings?.exterior || DEFAULT_EXTERIOR;
  const adjacencies = findAdjacencies(project.rooms);
  const sharedByRoomSide = new Map(); // `${roomId}|${side}` -> intervals

  const noteShared = (roomId, side, from, to) => {
    const key = `${roomId}|${side}`;
    if (!sharedByRoomSide.has(key)) sharedByRoomSide.set(key, []);
    sharedByRoomSide.get(key).push({ from, to });
  };

  const seenPairs = new Set();
  for (const adj of adjacencies) {
    const key = sharedKey(adj.a.id, adj.b.id);
    if (seenPairs.has(key)) continue;
    seenPairs.add(key);
    const edgeA = sideEdge(adj.a, adj.sideA);
    const override = overrides[key];
    const orient = edgeA.orient;
    const band = orient === 'h'
      ? { x: adj.from, y: edgeA.edge, w: adj.to - adj.from, h: adj.gap }
      : { x: edgeA.edge, y: adj.from, w: adj.gap, h: adj.to - adj.from };
    const mid = edgeA.edge + adj.gap / 2;
    walls.push({
      key,
      kind: 'shared',
      orient,
      rooms: [adj.a.id, adj.b.id],
      sides: { [adj.a.id]: adj.sideA, [adj.b.id]: oppositeSide(adj.sideA) },
      from: adj.from,
      to: adj.to,
      edge: edgeA.edge,
      thickness: adj.gap,
      band,
      center: orient === 'h'
        ? { x1: adj.from, y1: mid, x2: adj.to, y2: mid }
        : { x1: mid, y1: adj.from, x2: mid, y2: adj.to },
      wallType: wallTypeOf(override, 'partition'),
    });
    noteShared(adj.a.id, adj.sideA, adj.from, adj.to);
    noteShared(adj.b.id, oppositeSide(adj.sideA), adj.from, adj.to);
  }

  // Собственные стены: стороны комнат за вычетом общих участков.
  const byId = new Map(project.rooms.map((r) => [r.id, r]));
  for (const room of project.rooms) {
    const nested = Boolean(room.parentId && byId.has(room.parentId));
    for (let side = 0; side < 4; side += 1) {
      const edge = sideEdge(room, side);
      const subs = sharedByRoomSide.get(`${room.id}|${side}`) || [];
      const rest = subtractIntervals(edge.from, edge.to, subs);
      const key = ownKey(room.id, side);
      const override = overrides[key];
      const thickness = (override && override.thickness) || (nested ? partition : exterior);
      for (const seg of rest) {
        const inner = edge.edge;
        const outer = edge.edge + edge.outward * thickness;
        const lo = Math.min(inner, outer);
        const band = edge.orient === 'h'
          ? { x: seg.from, y: lo, w: seg.to - seg.from, h: thickness }
          : { x: lo, y: seg.from, w: thickness, h: seg.to - seg.from };
        const mid = inner + edge.outward * (thickness / 2);
        walls.push({
          key,
          kind: 'own',
          orient: edge.orient,
          rooms: [room.id],
          sides: { [room.id]: side },
          from: seg.from,
          to: seg.to,
          edge: inner,
          outward: edge.outward,
          thickness,
          band,
          center: edge.orient === 'h'
            ? { x1: seg.from, y1: mid, x2: seg.to, y2: mid }
            : { x1: mid, y1: seg.from, x2: mid, y2: seg.to },
          wallType: wallTypeOf(override, nested ? 'partition' : 'exterior'),
        });
      }
    }
  }

  extendOwnCorners(walls, byId);
  return walls;
}

// Удлиняет собственные стены на углах комнаты, чтобы угол замыкался без щели.
function extendOwnCorners(walls, roomsById) {
  const ownByRoom = new Map();
  for (const wall of walls) {
    if (wall.kind !== 'own') continue;
    const roomId = wall.rooms[0];
    if (!ownByRoom.has(roomId)) ownByRoom.set(roomId, []);
    ownByRoom.get(roomId).push(wall);
  }
  for (const [roomId, list] of ownByRoom) {
    const room = roomsById.get(roomId);
    if (!room) continue;
    const corners = [
      { x: room.x, y: room.y },
      { x: room.x + room.w, y: room.y },
      { x: room.x + room.w, y: room.y + room.h },
      { x: room.x, y: room.y + room.h },
    ];
    for (const wall of list) {
      for (const end of ['from', 'to']) {
        const pos = wall[end];
        const point = wall.orient === 'h' ? { x: pos, y: wall.edge } : { x: wall.edge, y: pos };
        const isCorner = corners.some((c) => Math.abs(c.x - point.x) < 1 && Math.abs(c.y - point.y) < 1);
        if (!isCorner) continue;
        // Перпендикулярная собственная стена, касающаяся того же угла.
        const perp = list.find((w) => w !== wall && w.orient !== wall.orient &&
          (Math.abs(w.from - (wall.orient === 'h' ? point.y : point.x)) < 1 ||
           Math.abs(w.to - (wall.orient === 'h' ? point.y : point.x)) < 1) &&
          Math.abs(w.edge - (wall.orient === 'h' ? point.x : point.y)) < 1);
        if (!perp) continue;
        const grow = perp.thickness;
        if (wall.orient === 'h') {
          if (end === 'from') { wall.band.x -= grow; wall.band.w += grow; }
          else { wall.band.w += grow; }
        } else if (end === 'from') { wall.band.y -= grow; wall.band.h += grow; }
        else { wall.band.h += grow; }
      }
    }
  }
}

// Сегмент стены, на котором лежит сторона/offset (для проёмов).
export function wallAt(walls, roomId, side, offset) {
  const room = { id: roomId };
  for (const wall of walls) {
    const wallSide = wall.sides?.[roomId];
    if (wallSide !== side) continue;
    if (offset >= wall.from - 1 && offset <= wall.to + 1) return wall;
  }
  return null;
}

// Мировая геометрия проёма: прямоугольник поперёк полотна стены.
export function openingRect(project, opening, walls) {
  const room = project.rooms.find((r) => r.id === opening.roomId);
  if (!room) return null;
  const edge = sideEdge(room, opening.side);
  const absCenter = (edge.orient === 'h' ? room.x : room.y) + opening.offset;
  const wall = wallAt(walls, opening.roomId, opening.side, absCenter);
  if (!wall) return null;
  const half = opening.width / 2;
  const rect = wall.orient === 'h'
    ? { x: absCenter - half, y: wall.band.y, w: opening.width, h: wall.band.h }
    : { x: wall.band.x, y: absCenter - half, w: wall.band.w, h: opening.width };
  return { rect, wall, absCenter };
}

// Зона открывания двери: квадрат width×width внутри комнаты, в которую она открывается.
export function doorSwingRect(project, opening, walls) {
  if (opening.kind !== 'door') return null;
  const placed = openingRect(project, opening, walls);
  if (!placed) return null;
  const { rect, wall } = placed;
  const room = project.rooms.find((r) => r.id === opening.roomId);
  // Куда открывается: swingIn — внутрь комнаты-владельца, иначе наружу/в соседнюю.
  let dir;
  if (wall.orient === 'h') {
    const inwardOfOwner = room.y > rect.y ? 1 : -1; // владелец ниже стены => внутрь это +y
    dir = opening.swingIn ? inwardOfOwner : -inwardOfOwner;
    const y = dir > 0 ? rect.y + rect.h : rect.y - opening.width;
    return { x: rect.x, y, w: opening.width, h: opening.width };
  }
  const inwardOfOwner = room.x > rect.x ? 1 : -1;
  dir = opening.swingIn ? inwardOfOwner : -inwardOfOwner;
  const x = dir > 0 ? rect.x + rect.w : rect.x - opening.width;
  return { x, y: rect.y, w: opening.width, h: opening.width };
}

// Какие два пространства соединяет дверь: ['outside'|roomId, roomId].
export function doorLink(project, opening, walls) {
  if (opening.kind !== 'door') return null;
  const placed = openingRect(project, opening, walls);
  if (!placed) return null;
  const { wall } = placed;
  if (wall.kind === 'shared') return [wall.rooms[0], wall.rooms[1]];
  const room = project.rooms.find((r) => r.id === opening.roomId);
  if (room && room.parentId) return [room.id, room.parentId];
  return [opening.roomId, 'outside'];
}

// Геометрия символа двери (петля, закрытое/открытое положение створки, точка
// дуги). Используется и рендером, и DXF-экспортом — чертёж и экспорт совпадают.
export function doorSymbol(project, opening, walls) {
  const placed = openingRect(project, opening, walls);
  if (!placed) return null;
  const { rect, wall } = placed;
  const room = project.rooms.find((r) => r.id === opening.roomId);
  if (!room) return null;
  const width = opening.width;
  let hinge;
  let closed;
  let open;
  if (wall.orient === 'h') {
    const inwardOfOwner = room.y > rect.y ? 1 : -1;
    const dir = opening.swingIn ? inwardOfOwner : -inwardOfOwner;
    const faceY = dir > 0 ? rect.y + rect.h : rect.y;
    const hx = opening.hingeStart ? rect.x : rect.x + rect.w;
    const cx = opening.hingeStart ? rect.x + rect.w : rect.x;
    hinge = { x: hx, y: faceY };
    closed = { x: cx, y: faceY };
    open = { x: hx, y: faceY + dir * width };
  } else {
    const inwardOfOwner = room.x > rect.x ? 1 : -1;
    const dir = opening.swingIn ? inwardOfOwner : -inwardOfOwner;
    const faceX = dir > 0 ? rect.x + rect.w : rect.x;
    const hy = opening.hingeStart ? rect.y : rect.y + rect.h;
    const cy = opening.hingeStart ? rect.y + rect.h : rect.y;
    hinge = { x: faceX, y: hy };
    closed = { x: faceX, y: cy };
    open = { x: faceX + dir * width, y: hy };
  }
  const ux = (closed.x - hinge.x) / width;
  const uy = (closed.y - hinge.y) / width;
  const vx = (open.x - hinge.x) / width;
  const vy = (open.y - hinge.y) / width;
  const k = Math.SQRT1_2;
  const through = { x: hinge.x + (ux + vx) * k * width, y: hinge.y + (uy + vy) * k * width };
  return { hinge, closed, open, through, rect, wall };
}

// Допустимый диапазон offset для проёма на данной стороне (центр проёма).
export function clampOpeningOffset(project, opening, walls, desiredOffset) {
  const room = project.rooms.find((r) => r.id === opening.roomId);
  if (!room) return desiredOffset;
  const edge = sideEdge(room, opening.side);
  const base = edge.orient === 'h' ? room.x : room.y;
  const abs = base + desiredOffset;
  // Ищем сегмент, которому принадлежит желаемая позиция (или ближайший).
  let best = null;
  let bestDist = Infinity;
  for (const wall of walls) {
    if (wall.sides?.[opening.roomId] !== opening.side) continue;
    const lo = wall.from + opening.width / 2 + 50;
    const hi = wall.to - opening.width / 2 - 50;
    if (lo > hi) continue;
    const clamped = Math.min(hi, Math.max(lo, abs));
    const dist = Math.abs(clamped - abs);
    if (dist < bestDist) { bestDist = dist; best = clamped; }
  }
  if (best === null) return null; // нет стены, куда помещается проём
  return best - base;
}
