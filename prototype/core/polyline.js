const POINT_EPSILON = 1e-6;

function finitePoint(point) {
  return Number.isFinite(point?.x) && Number.isFinite(point?.y);
}

function validEdge(start, end) {
  const length = Math.hypot(end.x - start.x, end.y - start.y);
  return Number.isFinite(length) && length > POINT_EPSILON;
}

export function validPolylinePoints(points, closed = false) {
  if (!Array.isArray(points) || points.length < (closed ? 3 : 2)) return false;
  let previous;
  for (const point of points) {
    if (!finitePoint(point) || (previous && !validEdge(previous, point))) return false;
    previous = point;
  }
  return !closed || validEdge(previous, points[0]);
}

export function createPolyline(id, points, { closed = false, layer = "measure" } = {}) {
  if (!validPolylinePoints(points, closed)) return null;
  return { id, type: "polyline", layer, closed, points: points.map(({ x, y }) => ({ x, y })) };
}

export function polylineSegments(entity) {
  const { points, closed } = entity ?? {};
  if (!validPolylinePoints(points, closed)) return [];
  const edgeCount = closed ? points.length : points.length - 1;
  return Array.from({ length: edgeCount }, (_, index) => ({
    p1: points[index],
    p2: points[(index + 1) % points.length],
  }));
}

export function polylineBounds(entity) {
  const { points, closed } = entity ?? {};
  if (!validPolylinePoints(points, closed)) return null;
  let { x: minX, y: minY } = points[0];
  let maxX = minX;
  let maxY = minY;
  for (const { x, y } of points) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return { minX, minY, maxX, maxY };
}
