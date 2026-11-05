// Геометрия второго пояса наружных размеров.
// Ближняя к фасаду цепочка проходит через грани наружных проёмов и оси
// внутренних стен, которые примыкают к этому фасаду.

import { openingRect, sideEdge } from './walls.js';
import { roomPolygon } from './room-shape.js';

const EPS = 2;

function inside(value, from, to, eps = EPS) {
  return value >= from - eps && value <= to + eps;
}

function addClipped(points, value, from, to) {
  if (inside(value, from, to)) points.push(Math.max(from, Math.min(to, value)));
}

// edge — ребро computeBuildingOutline(project, expand).
// Возвращает координаты вдоль фасада: крайние точки, косяки окон/дверей и
// оси примыкающих внутренних стен. Координаты отсортированы и без дублей.
export function facadeDimensionStations(project, walls, edge, expand) {
  const points = [edge.from, edge.to];
  const horizontal = edge.orient === 'h';
  const rooms = new Map(project.rooms.map((room) => [room.id, room]));

  for (const opening of project.openings || []) {
    const room = rooms.get(opening.roomId);
    if (!room || room.parentId) continue;
    const side = sideEdge(room, opening.side);
    if (side.orient !== edge.orient) continue;
    const facadeAt = side.edge + side.outward * expand;
    if (Math.abs(facadeAt - edge.at) > EPS) continue;

    const placed = openingRect(project, opening, walls);
    if (!placed) continue;
    const start = horizontal ? placed.rect.x : placed.rect.y;
    const end = start + (horizontal ? placed.rect.w : placed.rect.h);
    if (end < edge.from - EPS || start > edge.to + EPS) continue;
    addClipped(points, start, edge.from, edge.to);
    addClipped(points, end, edge.from, edge.to);
  }

  // Внутренняя грань наружной стены в принятой системе общих размеров.
  const innerAt = edge.at + edge.inSide * expand;
  for (const wall of walls) {
    if (!wall.band || !wall.center || wall.orient === edge.orient) continue;
    if (!['own', 'shared'].includes(wall.kind) || wall.wallType === 'exterior') continue;
    const crossFrom = horizontal ? wall.band.y : wall.band.x;
    const crossTo = crossFrom + (horizontal ? wall.band.h : wall.band.w);
    if (!inside(innerAt, crossFrom, crossTo)) continue;
    const station = horizontal
      ? (wall.center.x1 + wall.center.x2) / 2
      : (wall.center.y1 + wall.center.y2) / 2;
    addClipped(points, station, edge.from, edge.to);
  }

  points.sort((a, b) => a - b);
  return points.filter((point, index) => index === 0 || Math.abs(point - points[index - 1]) > EPS);
}

// Наружные цепочки для Г/Т/П-образного помещения. Горизонтальная цепочка
// собирает все вертикальные линии уступов, вертикальная — все горизонтальные.
// witness — ближайшая к размерной линии точка контура для выноски.
export function shapedRoomDimensionChains(room) {
  if (!room?.notch && !Array.isArray(room?.outline)) return null;
  const points = roomPolygon(room);
  if (points.length < 5) return null;
  const unique = (values) => [...new Set(values.map((value) => Math.round(value * 1000) / 1000))]
    .sort((a, b) => a - b);
  const xs = unique(points.map((point) => point.x));
  const ys = unique(points.map((point) => point.y));
  if (xs.length <= 2 && ys.length <= 2) return null;
  const atX = (x) => points.filter((point) => Math.abs(point.x - x) < 0.5);
  // Вертикальные рёбра: левые (внутренность справа) и правые. Левая цепочка
  // размеров берёт только левые стены, правая — только правые.
  let area = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i]; const b = points[(i + 1) % points.length];
    area += a.x * b.y - b.x * a.y;
  }
  const sign = area >= 0 ? 1 : -1;
  const sideStations = (wantLeft) => {
    const map = new Map(); // y -> x стены (ближайшей к краю)
    const put = (y, x) => {
      const key = Math.round(y * 1000) / 1000;
      const prev = map.get(key);
      if (prev === undefined || (wantLeft ? x < prev : x > prev)) map.set(key, x);
    };
    for (let i = 0; i < points.length; i += 1) {
      const a = points[i]; const b = points[(i + 1) % points.length];
      if (Math.abs(a.x - b.x) > 0.5 || Math.abs(a.y - b.y) < 0.5) continue;
      const interiorPlusX = (-(b.y - a.y) * sign) > 0;
      if (interiorPlusX !== wantLeft) continue;
      put(a.y, a.x); put(b.y, b.x);
    }
    return [...map.entries()].sort((p, q) => p[0] - q[0])
      .map(([value, witness]) => ({ value, witness }));
  };
  return {
    minX: xs[0], maxX: xs.at(-1), minY: ys[0], maxY: ys.at(-1),
    horizontal: xs.map((value) => ({
      value,
      witness: Math.min(...atX(value).map((point) => point.y)),
    })),
    vertical: sideStations(false),
    left: sideStations(true),
  };
}
