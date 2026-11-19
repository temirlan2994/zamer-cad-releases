import { normalizeAnglePositive } from "./geometry.js";

const POINT_EPSILON = 1e-6;
const FULL_TURN = 2 * Math.PI;
export const POLYLINE_ARC_GEOMETRY = Symbol("polyline arc geometry");

function finitePoint(point) {
  return Number.isFinite(point?.x) && Number.isFinite(point?.y);
}

function validEdge(start, end) {
  const length = Math.hypot(end.x - start.x, end.y - start.y);
  return Number.isFinite(length) && length > POINT_EPSILON;
}

export function polylineArc(start, end, bulge) {
  if (!Number.isFinite(bulge) || !bulge || !finitePoint(start) || !finitePoint(end)) return null;
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const chord = Math.hypot(dx, dy);
  if (!(chord > POINT_EPSILON && Number.isFinite(chord))) return null;
  const middle = { x: start.x + dx / 2, y: start.y + dy / 2 };
  const centerShift = (1 / bulge - bulge) / 4;
  const center = { x: middle.x - dy * centerShift, y: middle.y + dx * centerShift };
  const through = { x: middle.x + dy * bulge / 2, y: middle.y - dx * bulge / 2 };
  const radius = Math.hypot(start.x - center.x, start.y - center.y);
  const sweep = 4 * Math.atan(bulge);
  if (!finitePoint(center) || !finitePoint(through) || !Number.isFinite(radius) ||
      radius <= POINT_EPSILON || Math.abs(sweep) >= FULL_TURN) return null;
  // A distinct midpoint must survive storage in the drawing's precision.
  const sagitta = ((through.x - middle.x) * dy - (through.y - middle.y) * dx) / chord;
  if (!(sagitta * Math.sign(bulge) > 0)) return null;
  const startAngle = Math.atan2(start.y - center.y, start.x - center.x);
  return {
    type: "arc", start, through, end, center, radius, startAngle,
    endAngle: startAngle + sweep, counterClockwise: sweep > 0, sweep,
    [POLYLINE_ARC_GEOMETRY]: true,
  };
}

export function polylineArcPoint(arc, fraction) {
  if (fraction <= 0) return arc.start;
  if (fraction >= 1) return arc.end;
  if (fraction === 0.5) return arc.through;
  const angle = fraction * arc.sweep;
  const dx = arc.start.x - arc.center.x;
  const dy = arc.start.y - arc.center.y;
  const sine = Math.sin(angle);
  const cosineDelta = -2 * Math.sin(angle / 2) ** 2;
  return {
    x: arc.start.x + dx * cosineDelta - dy * sine,
    y: arc.start.y + dx * sine + dy * cosineDelta,
  };
}

export function validPolylinePoints(points, closed = false, bulges) {
  if (!Array.isArray(points) || points.length < 2) return false;
  if (closed && points.length === 2 &&
      (!Array.isArray(bulges) || bulges.length !== 2 || bulges[0] === -bulges[1])) return false;
  let previous;
  for (const point of points) {
    if (!finitePoint(point) || (previous && !validEdge(previous, point))) return false;
    previous = point;
  }
  if (closed && !validEdge(previous, points[0])) return false;
  if (bulges === undefined) return true;
  const edgeCount = closed ? points.length : points.length - 1;
  if (!Array.isArray(bulges) || bulges.length !== edgeCount) return false;
  for (const [index, bulge] of bulges.entries()) {
    if (!Number.isFinite(bulge) || (bulge !== 0 && !polylineArc(points[index], points[(index + 1) % points.length], bulge))) return false;
  }
  return true;
}

export function createPolyline(id, points, { closed = false, layer = "measure", bulges } = {}) {
  if (!validPolylinePoints(points, closed, bulges)) return null;
  const entity = { id, type: "polyline", layer, closed, points: points.map(({ x, y }) => ({ x, y })) };
  if (bulges?.some(Boolean)) entity.bulges = bulges.slice();
  return entity;
}

export function polylineSegments(entity) {
  const { points, closed, bulges } = entity ?? {};
  if (!validPolylinePoints(points, closed, bulges)) return [];
  const edgeCount = closed ? points.length : points.length - 1;
  return Array.from({ length: edgeCount }, (_, index) => {
    const p1 = points[index];
    const p2 = points[(index + 1) % points.length];
    const bulge = bulges?.[index] || 0;
    return { p1, p2, index, bulge, arc: polylineArc(p1, p2, bulge) };
  });
}

export function polylineBounds(entity) {
  const { points, closed, bulges } = entity ?? {};
  if (!validPolylinePoints(points, closed, bulges)) return null;
  let { x: minX, y: minY } = points[0];
  let maxX = minX;
  let maxY = minY;
  const include = ({ x, y }) => {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  };
  for (const point of points) include(point);
  if (bulges?.some(Boolean)) for (const { arc } of polylineSegments(entity)) {
    if (!arc) continue;
    include(arc.through);
    const magnitude = Math.abs(arc.sweep);
    for (const angle of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) {
      const offset = normalizeAnglePositive((angle - arc.startAngle) * Math.sign(arc.sweep));
      if (offset <= magnitude) include(polylineArcPoint(arc, offset / magnitude));
    }
  }
  return { minX, minY, maxX, maxY };
}
