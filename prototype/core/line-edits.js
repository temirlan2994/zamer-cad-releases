import { arcGeometry, normalizeAnglePositive } from "./geometry.js";

const POINT_EPSILON = 0.000001;
const PARALLEL_EPSILON = 1e-12;

function lineFrame(line) {
  if (!line || ![line.x1, line.y1, line.x2, line.y2].every(Number.isFinite)) return null;
  const dx = line.x2 - line.x1;
  const dy = line.y2 - line.y1;
  const length = Math.hypot(dx, dy);
  if (!Number.isFinite(length) || length <= POINT_EPSILON) return null;
  return { x: line.x1, y: line.y1, dx: dx / length, dy: dy / length, length };
}

function validPoint(point) {
  return point && Number.isFinite(point.x) && Number.isFinite(point.y);
}

function cross(ax, ay, bx, by) {
  return ax * by - ay * bx;
}

function projection(frame, point) {
  return (point.x - frame.x) * frame.dx + (point.y - frame.y) * frame.dy;
}

function pointAt(frame, distance) {
  return { x: frame.x + distance * frame.dx, y: frame.y + distance * frame.dy };
}

function withinSegment(distance, frame) {
  return distance >= -POINT_EPSILON && distance <= frame.length + POINT_EPSILON;
}

function crossingDistances(first, second) {
  const determinant = cross(first.dx, first.dy, second.dx, second.dy);
  if (Math.abs(determinant) <= PARALLEL_EPSILON) return null;
  const dx = second.x - first.x;
  const dy = second.y - first.y;
  const firstDistance = cross(dx, dy, second.dx, second.dy) / determinant;
  const secondDistance = cross(dx, dy, first.dx, first.dy) / determinant;
  if (!Number.isFinite(firstDistance) || !Number.isFinite(secondDistance)) return null;
  return { firstDistance, secondDistance };
}

// Parameters t and u measure the point along the first and second segment.
// A parameter outside [0, 1] is only accepted for an extended segment.
export function lineCrossing(firstLine, secondLine, { extendFirst = false, extendSecond = false } = {}) {
  const first = lineFrame(firstLine);
  const second = lineFrame(secondLine);
  if (!first || !second) return null;
  const crossing = crossingDistances(first, second);
  if (!crossing) return null;
  const { firstDistance, secondDistance } = crossing;
  if (!extendFirst && !withinSegment(firstDistance, first)) return null;
  if (!extendSecond && !withinSegment(secondDistance, second)) return null;
  const t = firstDistance / first.length;
  const u = secondDistance / second.length;
  return {
    ...segmentPoint(firstLine, first, firstDistance),
    t: extendFirst ? t : Math.max(0, Math.min(1, t)),
    u: extendSecond ? u : Math.max(0, Math.min(1, u)),
  };
}

function segmentPoint(line, frame, distance) {
  if (Math.abs(distance) <= POINT_EPSILON) return { x: line.x1, y: line.y1 };
  if (Math.abs(distance - frame.length) <= POINT_EPSILON) return { x: line.x2, y: line.y2 };
  return pointAt(frame, distance);
}

function piece(line, frame, start, end) {
  const a = segmentPoint(line, frame, start);
  const b = segmentPoint(line, frame, end);
  return { x1: a.x, y1: a.y, x2: b.x, y2: b.y };
}

function circleDistances(frame, center, radius) {
  if (!validPoint(center) || !Number.isFinite(radius) || radius <= POINT_EPSILON) return [];
  const perpendicular = Math.abs(cross(center.x - frame.x, center.y - frame.y, frame.dx, frame.dy));
  if (perpendicular > radius + POINT_EPSILON) return [];
  const closest = projection(frame, center);
  const offset = Math.sqrt(Math.max(0, radius - perpendicular) * (radius + perpendicular));
  if (offset <= POINT_EPSILON) return [closest];
  return [closest - offset, closest + offset];
}

function arcDistances(frame, boundary) {
  const { start, through, end } = boundary;
  if (![start, through, end].every(validPoint)) return [];
  const arc = arcGeometry(start, through, end);
  if (!arc) return [];
  const direction = arc.counterClockwise ? 1 : -1;
  const span = normalizeAnglePositive((arc.endAngle - arc.startAngle) * direction);
  const tolerance = POINT_EPSILON / arc.radius;
  return circleDistances(frame, arc.center, arc.radius).filter((distance) => {
    const point = pointAt(frame, distance);
    const angle = Math.atan2(point.y - arc.center.y, point.x - arc.center.x);
    const along = normalizeAnglePositive((angle - arc.startAngle) * direction);
    return along <= span + tolerance || 2 * Math.PI - along <= tolerance;
  });
}

function boundaryDistances(frame, boundaries) {
  const distances = [];
  for (const boundary of boundaries) {
    if (boundary?.type === "circle") {
      distances.push(...circleDistances(frame, { x: boundary.cx, y: boundary.cy }, boundary.radius));
      continue;
    }
    if (boundary?.type === "arc") {
      distances.push(...arcDistances(frame, boundary));
      continue;
    }
    const edge = lineFrame(boundary);
    if (!edge) continue;
    const hit = crossingDistances(frame, edge);
    if (hit && withinSegment(hit.secondDistance, edge)) distances.push(hit.firstDistance);
  }
  return distances;
}

// Trim removes the interval containing the pick, bounded by the nearest
// intersections on either side of it. Outer intervals end at the line tips.
export function trimLine(line, boundaries, pick) {
  const frame = lineFrame(line);
  if (!frame || !validPoint(pick)) return null;
  const pickDistance = Math.max(0, Math.min(frame.length, projection(frame, pick)));
  let start = 0;
  let end = frame.length;
  for (const distance of boundaryDistances(frame, boundaries)) {
    if (distance <= POINT_EPSILON || distance >= frame.length - POINT_EPSILON) continue;
    if (Math.abs(distance - pickDistance) <= POINT_EPSILON) return null;
    if (distance < pickDistance) start = Math.max(start, distance);
    else end = Math.min(end, distance);
  }
  if (start === 0 && end === frame.length) return null;
  const result = [];
  if (start > 0) result.push(piece(line, frame, 0, start));
  if (end < frame.length) result.push(piece(line, frame, end, frame.length));
  return result;
}

// Pick the end to extend, then intersect that end's forward ray with the
// nearest actual cutting edge. The opposite end stays fixed.
export function extendLine(line, boundaries, pick) {
  const frame = lineFrame(line);
  if (!frame || !validPoint(pick)) return null;
  const fromStart = projection(frame, pick) < frame.length / 2;
  let nearest = fromStart ? -Infinity : Infinity;
  for (const distance of boundaryDistances(frame, boundaries)) {
    if (fromStart && distance < -POINT_EPSILON) nearest = Math.max(nearest, distance);
    if (!fromStart && distance > frame.length + POINT_EPSILON) nearest = Math.min(nearest, distance);
  }
  if (!Number.isFinite(nearest)) return null;
  return fromStart ? piece(line, frame, nearest, frame.length) : piece(line, frame, 0, nearest);
}

// A single point splits a line. Two separate points remove the interval
// between them. Projecting the picks allows for touch hit-testing tolerance.
export function splitLine(line, first, second = first) {
  const frame = lineFrame(line);
  if (!frame || !validPoint(first) || !validPoint(second)) return null;
  const a = Math.max(0, Math.min(frame.length, projection(frame, first)));
  const b = Math.max(0, Math.min(frame.length, projection(frame, second)));
  const start = Math.min(a, b);
  const end = Math.abs(a - b) <= POINT_EPSILON ? start : Math.max(a, b);
  if (start === end && (start <= POINT_EPSILON || start >= frame.length - POINT_EPSILON)) return null;
  const result = [];
  if (start > POINT_EPSILON) result.push(piece(line, frame, 0, start));
  if (end < frame.length - POINT_EPSILON) result.push(piece(line, frame, end, frame.length));
  return result;
}

// A join may bridge gaps or remove overlaps. Reject the entire operation
// if any selected line cannot be reduced to the source line's axis.
export function joinLines(line, others) {
  const frame = lineFrame(line);
  if (!frame || !others.length) return null;
  let start = 0;
  let end = frame.length;
  for (const other of others) {
    if (other === line || !lineFrame(other)) return null;
    const first = { x: other.x1, y: other.y1 };
    const second = { x: other.x2, y: other.y2 };
    for (const point of [first, second]) {
      if (Math.abs(cross(point.x - frame.x, point.y - frame.y, frame.dx, frame.dy)) > POINT_EPSILON) return null;
      const distance = projection(frame, point);
      start = Math.min(start, distance);
      end = Math.max(end, distance);
    }
  }
  return piece(line, frame, start, end);
}

// A null distance copies the line through the pick. A fixed distance uses
// the pick only to choose the side of the source line.
export function parallelLine(line, through, distance = null) {
  const frame = lineFrame(line);
  if (!frame || !validPoint(through)) return null;
  if (distance !== null && (!Number.isFinite(distance) || distance <= 0)) return null;
  const side = cross(frame.dx, frame.dy, through.x - frame.x, through.y - frame.y);
  if (!Number.isFinite(side) || Math.abs(side) <= POINT_EPSILON) return null;
  const offset = distance === null ? side : Math.sign(side) * distance;
  const dx = -frame.dy * offset;
  const dy = frame.dx * offset;
  const result = { x1: line.x1 + dx, y1: line.y1 + dy, x2: line.x2 + dx, y2: line.y2 + dy };
  return lineFrame(result) ? result : null;
}

export function mirrorLine(line, axisStart, axisEnd) {
  if (!lineFrame(line) || !validPoint(axisStart) || !validPoint(axisEnd)) return null;
  const axis = lineFrame({ x1: axisStart.x, y1: axisStart.y, x2: axisEnd.x, y2: axisEnd.y });
  if (!axis) return null;
  const reflect = (x, y) => {
    const twiceOffset = 2 * cross(axis.dx, axis.dy, x - axis.x, y - axis.y);
    return { x: x + axis.dy * twiceOffset, y: y - axis.dx * twiceOffset };
  };
  const start = reflect(line.x1, line.y1);
  const end = reflect(line.x2, line.y2);
  const result = { x1: start.x, y1: start.y, x2: end.x, y2: end.y };
  return lineFrame(result) ? result : null;
}

export function scaleLine(line, base, factor) {
  if (!lineFrame(line) || !validPoint(base) || !Number.isFinite(factor) || factor <= 0) return null;
  if (factor === 1) return { x1: line.x1, y1: line.y1, x2: line.x2, y2: line.y2 };
  const result = {
    x1: base.x + (line.x1 - base.x) * factor,
    y1: base.y + (line.y1 - base.y) * factor,
    x2: base.x + (line.x2 - base.x) * factor,
    y2: base.y + (line.y2 - base.y) * factor,
  };
  return lineFrame(result) ? result : null;
}
