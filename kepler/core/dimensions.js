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

// Контур ортогонального многоугольника, смещённый наружу на толщину стены t:
// каждая вершина сдвигается на t·(n1 + n2) — нормали соседних рёбер. Работает
// и для выпуклых, и для вогнутых углов. Совпавшие вершины (после деления
// стены) схлопываются, иначе нормаль нулевого ребра не определена.
export function offsetOrthoPolygon(points, t) {
  const pts = points.filter((p, i) => {
    const q = points[(i + 1) % points.length];
    return Math.abs(p.x - q.x) > 0.5 || Math.abs(p.y - q.y) > 0.5;
  });
  if (!t || pts.length < 3) return pts;
  let area = 0;
  for (let i = 0; i < pts.length; i += 1) {
    const a = pts[i]; const b = pts[(i + 1) % pts.length];
    area += a.x * b.y - b.x * a.y;
  }
  const sign = area >= 0 ? 1 : -1;
  const normal = (a, b) => {
    const dx = b.x - a.x; const dy = b.y - a.y; const len = Math.hypot(dx, dy) || 1;
    return { x: sign * dy / len, y: -sign * dx / len };
  };
  return pts.map((p, i) => {
    const prev = pts[(i - 1 + pts.length) % pts.length];
    const next = pts[(i + 1) % pts.length];
    const n1 = normal(prev, p); const n2 = normal(p, next);
    return { x: p.x + t * (n1.x + n2.x), y: p.y + t * (n1.y + n2.y) };
  });
}

// Наружные цепочки для Г/Т/П-образного помещения. Горизонтальная цепочка
// собирает все вертикальные линии уступов, вертикальная — все горизонтальные.
// witness — ближайшая к размерной линии точка контура для выноски.
// expand > 0 — цепочки по НАРУЖНЫМ граням стен (контур смещён на толщину стены),
// как наружный пояс у прямоугольных помещений; 0 — по внутреннему контуру.
export function shapedRoomDimensionChains(room, expand = 0) {
  if (!room?.notch && !Array.isArray(room?.outline)) return null;
  const inner = roomPolygon(room);
  if (inner.length < 5) return null;
  const points = expand ? offsetOrthoPolygon(inner, expand) : inner;
  const unique = (values) => [...new Set(values.map((value) => Math.round(value * 1000) / 1000))]
    .sort((a, b) => a - b);
  const xs = unique(points.map((point) => point.x));
  const ys = unique(points.map((point) => point.y));
  if (xs.length <= 2 && ys.length <= 2) return null;
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
  // Горизонтальные рёбра: северные (внутренность снизу) и южные. Верхняя цепочка
  // берёт только северные стены, нижняя — только южные.
  const edgeStations = (wantTop) => {
    const map = new Map(); // x -> y стены (самой удалённой от центра)
    const put = (x, y) => {
      const key = Math.round(x * 1000) / 1000;
      const prev = map.get(key);
      if (prev === undefined || (wantTop ? y < prev : y > prev)) map.set(key, y);
    };
    for (let i = 0; i < points.length; i += 1) {
      const a = points[i]; const b = points[(i + 1) % points.length];
      if (Math.abs(a.y - b.y) > 0.5 || Math.abs(a.x - b.x) < 0.5) continue;
      const interiorPlusY = ((b.x - a.x) * sign) > 0;
      if (interiorPlusY !== wantTop) continue;
      put(a.x, a.y); put(b.x, b.y);
    }
    return [...map.entries()].sort((p, q) => p[0] - q[0])
      .map(([value, witness]) => ({ value, witness }));
  };
  return {
    minX: xs[0], maxX: xs.at(-1), minY: ys[0], maxY: ys.at(-1),
    horizontal: edgeStations(true), // север
    bottom: edgeStations(false), // юг
    vertical: sideStations(false),
    left: sideStations(true),
  };
}
