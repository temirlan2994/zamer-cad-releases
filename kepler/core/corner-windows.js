// One hosted object, two read-only wall projections. The anchor follows the
// room boundary when the room moves or either end of a wall is resized.
import { roomBoundaryEdges } from './room-shape.js';

export const CORNER_PRESET = 'corner-glazing';
export const CORNER_PIER = 350;
const same = (a, b) => Math.abs(a - b) < 1;

export function cornerWindowGeometry(project, opening, walls) {
  const spec = opening.corner;
  const room = project.rooms.find((r) => r.id === opening.roomId);
  if (!room || room.parentId || !spec || !['from', 'to'].includes(spec.end)) return null;
  const edges = roomBoundaryEdges(room);
  const first = edges.find((edge) => edge.side === opening.side);
  if (!first) return null;
  const vertex = first[spec.end];
  const second = edges.find((e) => e.orient !== first.orient && same(e.edge, vertex)
    && e.outward === (spec.end === 'from' ? -1 : 1)
    && same(first.edge, e[first.outward < 0 ? 'from' : 'to']));
  if (!second) return null;
  const ends = [spec.end, first.outward < 0 ? 'from' : 'to'];
  const sides = [first, second];
  const hosts = sides.map((edge, i) => walls.find((w) => !w.hidden && w.kind === 'own'
    && w.sides?.[room.id] === edge.side && same(w[ends[i]], edge[ends[i]])));
  if (hosts.some((w) => !w)) return null;
  const h = hosts.find((w) => w.orient === 'h').band;
  const v = hosts.find((w) => w.orient === 'v').band;
  const junction = { x: v.x, y: h.y, w: v.w, h: h.h };
  const wings = [];
  for (const [i, wall] of hosts.entries()) {
    const width = i ? spec.returnWidth : opening.width;
    const sign = ends[i] === 'from' ? 1 : -1;
    const horizontal = wall.orient === 'h';
    const start = spec.joint === 'pier' ? wall[ends[i]] + sign * CORNER_PIER
      : horizontal ? v.x + v.w / 2 : h.y + h.h / 2;
    const end = start + sign * width;
    if (!Number.isFinite(width) || width < 600 || end < wall.from + 50 || end > wall.to - 50) return null;
    const wing = { ...opening, side: sides[i].side, offset: (start + end) / 2 - (horizontal ? room.x : room.y),
      width, cornerAtStart: sign > 0, cornerWing: i ? 'return' : 'main' };
    if (!i && spec.joint !== 'pier') wing.cornerJunction = junction;
    wings.push({ wall, opening: wing, start, end, sign });
  }
  return wings;
}

export function cornerWindowProjections(project, originals, walls) {
  if (!originals.some((o) => o.corner && !o.cornerWing)) return originals;
  return originals.flatMap((o) => {
    if (!o.corner || o.cornerWing) return [o];
    return o.orphan ? [] : (cornerWindowGeometry(project, o, walls) || []).map((wing) => wing.opening);
  });
}

export function cornerWindowHandles(project, opening, walls) {
  return (cornerWindowGeometry(project, opening, walls) || []).map(({ wall, opening: projection, start, end, sign }) => {
    const horizontal = wall.orient === 'h';
    const across = horizontal ? wall.band.y + wall.band.h / 2 : wall.band.x + wall.band.w / 2;
    return { end: projection.cornerWing, wall, start, sign, x: horizontal ? end : across, y: horizontal ? across : end };
  });
}
