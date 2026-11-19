import { arcGeometry, normalizeAnglePositive } from "./geometry.js";
import { POLYLINE_ARC_GEOMETRY } from "./polyline.js";

const POINT_EPSILON = 0.000001;
const PARALLEL_EPSILON = 1e-12;
// At this magnitude a double still resolves thousandths of a millimeter.
export const MAX_LINE_COORDINATE = 1e12;

export function isLinePoint(point) {
  return validPoint(point) && Math.abs(point.x) <= MAX_LINE_COORDINATE && Math.abs(point.y) <= MAX_LINE_COORDINATE;
}

export function isValidLine(line) {
  return Boolean(lineFrame(line)) && isLinePoint({ x: line.x1, y: line.y1 }) && isLinePoint({ x: line.x2, y: line.y2 });
}

function lineFrame(line) {
  if (!line || ![line.x1, line.y1, line.x2, line.y2].every(Number.isFinite)) return null;
  const dx = line.x2 - line.x1;
  const dy = line.y2 - line.y1;
  const length = Math.hypot(dx, dy);
  if (!Number.isFinite(length) || length <= POINT_EPSILON) return null;
  return { x: line.x1, y: line.y1, dx: dx / length, dy: dy / length, length };
}

function validPoint(point) {
  return Number.isFinite(point?.x) && Number.isFinite(point?.y);
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
  const point = segmentPoint(firstLine, first, firstDistance);
  if (!validPoint(point)) return null;
  return {
    ...point,
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
  if (!Number.isFinite(perpendicular) || perpendicular > radius + POINT_EPSILON) return [];
  const closest = projection(frame, center);
  const ratio = perpendicular / radius;
  const offset = radius * Math.sqrt(Math.max(0, 1 - ratio) * (1 + ratio));
  if (!Number.isFinite(closest) || !Number.isFinite(offset)) return [];
  if (offset <= POINT_EPSILON) return [closest];
  return [closest - offset, closest + offset].filter(Number.isFinite);
}

function circleGeometry(boundary) {
  if (boundary?.type === "circle") {
    const { cx: x, cy: y, radius } = boundary;
    const center = { x, y };
    return validPoint(center) && Number.isFinite(radius) && radius > POINT_EPSILON ? { center, radius } : null;
  }
  if (boundary?.type !== "arc") return null;
  const { start, through, end } = boundary;
  if (![start, through, end].every(validPoint)) return null;
  const analytic = boundary[POLYLINE_ARC_GEOMETRY];
  const arc = analytic ? boundary : arcGeometry(start, through, end);
  if (!arc || !validPoint(arc.center) || !Number.isFinite(arc.radius) || arc.radius <= POINT_EPSILON) return null;
  const direction = arc.counterClockwise ? 1 : -1;
  const span = analytic ? Math.abs(arc.sweep) : normalizeAnglePositive((arc.endAngle - arc.startAngle) * direction);
  return { center: arc.center, radius: arc.radius, start, end, startAngle: arc.startAngle, span, direction };
}

function onCircleSpan(circle, point) {
  if (!circle.start) return true;
  const angle = Math.atan2(point.y - circle.center.y, point.x - circle.center.x);
  const along = normalizeAnglePositive((angle - circle.startAngle) * circle.direction);
  const tolerance = POINT_EPSILON / circle.radius;
  return along <= circle.span + tolerance || 2 * Math.PI - along <= tolerance;
}

function boundaryDistances(frame, boundaries) {
  const distances = [];
  for (const boundary of boundaries) {
    if (boundary?.type === "circle" || boundary?.type === "arc") {
      const circle = circleGeometry(boundary);
      if (circle) {
        const crossings = circleDistances(frame, circle.center, circle.radius);
        distances.push(...crossings.filter((distance) => onCircleSpan(circle, pointAt(frame, distance))));
      }
      continue;
    }
    const edge = lineFrame(boundary);
    if (!edge) continue;
    const hit = crossingDistances(frame, edge);
    if (hit && withinSegment(hit.secondDistance, edge)) distances.push(hit.firstDistance);
  }
  return distances;
}

function snapShape(boundary) {
  const circle = circleGeometry(boundary);
  if (circle) return { circle };
  const frame = lineFrame(boundary);
  return frame ? { frame, boundary } : null;
}

function radialPoint(circle, point, side = 1) {
  const dx = point.x - circle.center.x;
  const dy = point.y - circle.center.y;
  const length = Math.hypot(dx, dy);
  if (!(length > POINT_EPSILON)) return circle.start ?? { x: circle.center.x + circle.radius, y: circle.center.y };
  return {
    x: circle.center.x + (dx / length) * circle.radius * side,
    y: circle.center.y + (dy / length) * circle.radius * side,
  };
}

function nearestOnShape(shape, point) {
  if (shape.frame) {
    const { boundary, frame } = shape;
    const distance = Math.max(0, Math.min(frame.length, projection(frame, point)));
    return segmentPoint(boundary, frame, distance);
  }
  const { circle } = shape;
  const projected = radialPoint(circle, point);
  if (onCircleSpan(circle, projected)) return projected;
  const fromStart = Math.hypot(point.x - circle.start.x, point.y - circle.start.y);
  const fromEnd = Math.hypot(point.x - circle.end.x, point.y - circle.end.y);
  return fromStart <= fromEnd ? circle.start : circle.end;
}

function boundedSnaps(point, threshold, type, limit) {
  const hits = [];
  const maxDistance = () => hits.length === limit ? hits.at(-1)?.distance ?? threshold : threshold;
  return {
    consider(candidate) {
      if (!validPoint(candidate)) return;
      const distance = Math.hypot(point.x - candidate.x, point.y - candidate.y);
      if (distance > maxDistance() || hits.some(hit =>
        Math.hypot(hit.x - candidate.x, hit.y - candidate.y) <= POINT_EPSILON)) return;
      const position = hits.findIndex(hit => distance < hit.distance);
      if (position === -1 && hits.length === limit) return;
      hits.splice(position === -1 ? hits.length : position, 0, { x: candidate.x, y: candidate.y, distance });
      if (hits.length > limit) hits.pop();
    },
    get found() { return hits.length > 0; },
    get points() { return hits.map(({ x, y }) => ({ x, y, type })); },
    get distance() { return maxDistance(); },
  };
}

export function nearbyBoundaryPoints(point, boundaries, threshold, limit = 8) {
  if (!validPoint(point) || !(threshold >= 0)) return [];
  const snap = boundedSnaps(point, threshold, "nearest", limit);
  for (const boundary of boundaries) {
    const shape = snapShape(boundary);
    if (shape) snap.consider(nearestOnShape(shape, point));
  }
  return snap.points;
}

export function nearestBoundaryPoint(point, boundaries, threshold) {
  return nearbyBoundaryPoints(point, boundaries, threshold, 1)[0] ?? null;
}

export function nearbyPerpendiculars(point, start, boundaries, threshold, limit = 8) {
  if (!validPoint(point) || !validPoint(start) || !(threshold >= 0)) return [];
  const snap = boundedSnaps(point, threshold, "perpendicular", limit);
  for (const boundary of boundaries) {
    const shape = snapShape(boundary);
    if (!shape) continue;
    if (shape.frame) {
      const { frame } = shape;
      const foot = projection(frame, start);
      if (withinSegment(foot, frame)) {
        const candidate = segmentPoint(boundary, frame, foot);
        if (Math.hypot(candidate.x - start.x, candidate.y - start.y) > POINT_EPSILON) snap.consider(candidate);
      }
      continue;
    }
    const { circle } = shape;
    if (Math.hypot(start.x - circle.center.x, start.y - circle.center.y) <= POINT_EPSILON) {
      snap.consider(nearestOnShape(shape, point));
      continue;
    }
    for (const side of [1, -1]) {
      const candidate = radialPoint(circle, start, side);
      if (onCircleSpan(circle, candidate) && Math.hypot(candidate.x - start.x, candidate.y - start.y) > POINT_EPSILON) {
        snap.consider(candidate);
      }
    }
  }
  return snap.points;
}

export function nearestPerpendicular(point, start, boundaries, threshold) {
  return nearbyPerpendiculars(point, start, boundaries, threshold, 1)[0] ?? null;
}

function intersectCircles(first, second, consider) {
  const dx = second.center.x - first.center.x;
  const dy = second.center.y - first.center.y;
  const distance = Math.hypot(dx, dy);
  const r1 = first.radius;
  const r2 = second.radius;
  const sum = r1 + r2;
  const difference = r1 - r2;
  if (!(distance > POINT_EPSILON && distance <= sum + POINT_EPSILON && distance + POINT_EPSILON >= Math.abs(difference))) return;
  const along = ((difference / distance) * sum + distance) / 2;
  const ratio = along / r1;
  const offset = r1 * Math.sqrt(Math.max(0, (1 - ratio) * (1 + ratio)));
  const ux = dx / distance;
  const uy = dy / distance;
  const x = first.center.x + along * ux;
  const y = first.center.y + along * uy;
  for (const side of offset <= POINT_EPSILON ? [0] : [1, -1]) {
    const candidate = { x: x - side * uy * offset, y: y + side * ux * offset };
    if (onCircleSpan(first, candidate) && onCircleSpan(second, candidate)) consider(candidate);
  }
}

function intersectShapes(first, second, consider) {
  if (first.frame && second.frame) {
    const hit = crossingDistances(first.frame, second.frame);
    if (hit && withinSegment(hit.firstDistance, first.frame) && withinSegment(hit.secondDistance, second.frame)) {
      consider(segmentPoint(first.boundary, first.frame, hit.firstDistance));
    }
    return;
  }
  if (first.circle && second.circle) {
    intersectCircles(first.circle, second.circle, consider);
    return;
  }
  const { frame, boundary } = first.frame ? first : second;
  const circle = first.circle ?? second.circle;
  for (const distance of circleDistances(frame, circle.center, circle.radius)) {
    if (!withinSegment(distance, frame)) continue;
    const candidate = segmentPoint(boundary, frame, distance);
    if (onCircleSpan(circle, candidate)) consider(candidate);
  }
}

export function boundaryCrossingPoints(target, boundaries) {
  const first = snapShape(target);
  const points = [];
  if (!first) return points;
  for (const edge of boundaries) {
    const second = snapShape(edge);
    if (second) intersectShapes(first, second, point => points.push(point));
  }
  return points;
}

// A boundary farther than our last retained crossing cannot improve the selection.
export function nearbyIntersections(point, boundaries, threshold, limit = 8) {
  if (!validPoint(point) || !(threshold >= 0)) return [];
  const candidates = [];
  for (const boundary of boundaries) {
    const shape = snapShape(boundary);
    if (!shape) continue;
    const nearest = nearestOnShape(shape, point);
    const distance = Math.hypot(point.x - nearest.x, point.y - nearest.y);
    if (distance <= threshold + POINT_EPSILON) candidates.push({ shape, distance });
  }
  if (candidates.length < 2) return [];
  const direction = candidates[0].shape.frame;
  if (direction && candidates.every(({ shape: { frame } }) =>
    frame && cross(direction.dx, direction.dy, frame.dx, frame.dy) === 0)) return [];
  candidates.sort((a, b) => a.distance - b.distance);
  const snap = boundedSnaps(point, threshold, "intersection", limit);
  for (let i = 0; i < candidates.length - 1; i += 1) {
    if (candidates[i].distance > snap.distance + POINT_EPSILON) break;
    for (let j = i + 1; j < candidates.length; j += 1) {
      if (candidates[j].distance > snap.distance + POINT_EPSILON) break;
      intersectShapes(candidates[i].shape, candidates[j].shape, snap.consider);
      if (limit === 1 && snap.found && snap.distance <= POINT_EPSILON) return snap.points;
    }
  }
  return snap.points;
}

export function nearestIntersection(point, boundaries, threshold) {
  return nearbyIntersections(point, boundaries, threshold, 1)[0] ?? null;
}

// Trim removes the interval containing the pick, bounded by the nearest
// intersections on either side of it. Outer intervals end at the line tips.
export function trimLine(line, boundaries, pick) {
  const frame = lineFrame(line);
  if (!frame || !validPoint(pick)) return null;
  const pickDistance = Math.max(0, Math.min(frame.length, projection(frame, pick)));
  if (!Number.isFinite(pickDistance)) return null;
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
  const pickDistance = projection(frame, pick);
  if (!Number.isFinite(pickDistance)) return null;
  const fromStart = pickDistance < frame.length / 2;
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
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
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
      if (!Number.isFinite(distance)) return null;
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
