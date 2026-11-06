// Геометрия второго пояса наружных размеров.
// Ближняя к фасаду цепочка проходит через грани наружных проёмов и оси
// внутренних стен, которые примыкают к этому фасаду.

import { openingRect, sideEdge, wallBounds } from './walls.js';

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
    if (!side || side.orient !== edge.orient) continue; // у ломаных помещений сторона может не найтись
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
    // v1 — полоса band; v2 — габарит кусков rects (стена без тела пропускается).
    const body = wallBounds(wall);
    if (!body) continue;
    const crossFrom = horizontal ? body.y : body.x;
    const crossTo = crossFrom + (horizontal ? body.h : body.w);
    if (!inside(innerAt, crossFrom, crossTo)) continue;
    const station = horizontal
      ? (wall.center.x1 + wall.center.x2) / 2
      : (wall.center.y1 + wall.center.y2) / 2;
    addClipped(points, station, edge.from, edge.to);
  }

  points.sort((a, b) => a - b);
  return points.filter((point, index) => index === 0 || Math.abs(point - points[index - 1]) > EPS);
}
