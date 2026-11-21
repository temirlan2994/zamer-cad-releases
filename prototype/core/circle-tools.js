import { arcGeometry, normalizeAnglePositive } from "./geometry.js";
import { isLinePoint } from "./line-edits.js";
import { POLYLINE_ARC_GEOMETRY } from "./polyline.js";

const EPSILON = 1e-6;
const FULL_TURN = Math.PI * 2;

function circleGeometry(center, radius) {
  if (!isLinePoint(center) || !Number.isFinite(radius) || radius <= EPSILON) return null;
  if (!isLinePoint({ x: center.x - radius, y: center.y - radius }) ||
      !isLinePoint({ x: center.x + radius, y: center.y + radius })) return null;
  return { cx: center.x, cy: center.y, radius };
}

export function diameterCircle(first, second) {
  if (![first, second].every(isLinePoint)) return null;
  const dx = (second.x - first.x) / 2;
  const dy = (second.y - first.y) / 2;
  return circleGeometry({ x: first.x + dx, y: first.y + dy }, Math.hypot(dx, dy));
}

export function threePointCircle(first, second, third) {
  if (![first, second, third].every(isLinePoint)) return null;
  const arc = arcGeometry(first, second, third);
  return arc ? circleGeometry(arc.center, arc.radius) : null;
}

function offset(point, dx, dy) {
  return { x: point.x + dx, y: point.y + dy };
}

function circleBoundary(boundary) {
  if (boundary.type === "circle") {
    const center = { x: boundary.cx, y: boundary.cy };
    return isLinePoint(center) && Number.isFinite(boundary.radius) && boundary.radius > EPSILON
      ? { center, radius: boundary.radius } : null;
  }
  if (boundary.type === "arc") {
    if (![boundary.start, boundary.through, boundary.end].every(isLinePoint)) return null;
    const arc = boundary[POLYLINE_ARC_GEOMETRY] ? boundary : arcGeometry(boundary.start, boundary.through, boundary.end);
    if (!arc) return null;
    const direction = arc.counterClockwise ? 1 : -1;
    const span = Math.abs(arc.sweep ?? normalizeAnglePositive((arc.endAngle - arc.startAngle) * direction));
    return { center: arc.center, radius: arc.radius, startAngle: arc.startAngle, direction, span };
  }
  const a = { x: boundary.x1, y: boundary.y1 };
  const b = { x: boundary.x2, y: boundary.y2 };
  if (![a, b].every(isLinePoint)) return null;
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  if (length <= EPSILON) return null;
  return { a, b, length, ux: (b.x - a.x) / length, uy: (b.y - a.y) / length };
}

function onArc(boundary, point) {
  if (boundary.span === undefined) return true;
  const angle = Math.atan2(point.y - boundary.center.y, point.x - boundary.center.x);
  const traveled = normalizeAnglePositive((angle - boundary.startAngle) * boundary.direction);
  const tolerance = EPSILON / boundary.radius;
  return traveled <= boundary.span + tolerance || traveled >= FULL_TURN - tolerance;
}

function centerLoci(boundary, radius) {
  if (boundary.a) {
    return [-radius, radius].map((distance) => ({ ...boundary, origin: offset(boundary.a, -boundary.uy * distance, boundary.ux * distance) }));
  }
  const inner = Math.abs(boundary.radius - radius);
  return [
    { ...boundary, distance: boundary.radius + radius, contactSide: 1 },
    ...(inner > EPSILON ? [{ ...boundary, distance: inner, contactSide: boundary.radius >= radius ? 1 : -1 }] : []),
  ];
}

function projection(line, point, origin = line.a) {
  return (point.x - origin.x) * line.ux + (point.y - origin.y) * line.uy;
}

function lineLociIntersections(first, second, pick) {
  const dx = second.origin.x - first.origin.x;
  const dy = second.origin.y - first.origin.y;
  const cross = first.ux * second.uy - first.uy * second.ux;
  if (Math.abs(cross) > 1e-12) {
    const distance = (dx * second.uy - dy * second.ux) / cross;
    return [offset(first.origin, first.ux * distance, first.uy * distance)];
  }
  // Only distinct parallel supports exactly two radii apart share a valid center locus.
  if (Math.abs(dx * first.uy - dy * first.ux) > EPSILON) return [];
  const crossSpacing = (second.a.x - first.a.x) * first.uy - (second.a.y - first.a.y) * first.ux;
  if (Math.abs(crossSpacing) <= EPSILON) return [];
  const t0 = projection(first, second.a, first.origin);
  const t1 = projection(first, second.b, first.origin);
  const start = Math.max(0, Math.min(t0, t1));
  const end = Math.min(first.length, Math.max(t0, t1));
  if (start > end + EPSILON) return [];
  const distance = Math.max(start, Math.min(end, projection(first, pick, first.origin)));
  return [offset(first.origin, first.ux * distance, first.uy * distance)];
}

function lineCircularLociIntersections(line, circle) {
  const dx = circle.center.x - line.origin.x;
  const dy = circle.center.y - line.origin.y;
  const perpendicular = Math.abs(dx * line.uy - dy * line.ux);
  if (perpendicular > circle.distance + EPSILON) return [];
  const along = dx * line.ux + dy * line.uy;
  const delta = Math.sqrt(Math.max(0, (circle.distance - perpendicular) * (circle.distance + perpendicular)));
  return [along - delta, along + delta].map((distance) => offset(line.origin, line.ux * distance, line.uy * distance));
}

function circularLociIntersections(first, second, picks) {
  const dx = second.center.x - first.center.x;
  const dy = second.center.y - first.center.y;
  const distance = Math.hypot(dx, dy);
  if (distance <= EPSILON) {
    if (Math.abs(first.distance - second.distance) > EPSILON || Math.abs(first.radius - second.radius) <= EPSILON) return [];
    const angles = [first, second].flatMap((locus, index) => {
      const pick = picks[index];
      const opposite = locus.contactSide < 0 ? Math.PI : 0;
      const pickedAngle = Math.atan2(pick.y - locus.center.y, pick.x - locus.center.x) + opposite;
      if (locus.span === undefined) return [pickedAngle];
      const start = locus.startAngle + opposite;
      return [pickedAngle, start, start + locus.span * locus.direction];
    });
    return angles.map((angle) => offset(first.center, Math.cos(angle) * first.distance, Math.sin(angle) * first.distance));
  }
  if (distance > first.distance + second.distance + EPSILON || distance < Math.abs(first.distance - second.distance) - EPSILON) return [];
  const along = (distance * distance + (first.distance - second.distance) * (first.distance + second.distance)) / (2 * distance);
  const delta = Math.sqrt(Math.max(0, (first.distance - along) * (first.distance + along)));
  const ux = dx / distance;
  const uy = dy / distance;
  const middle = offset(first.center, ux * along, uy * along);
  return [offset(middle, -uy * delta, ux * delta), offset(middle, uy * delta, -ux * delta)];
}

function tangentPoint(locus, center) {
  if (locus.a) {
    const t = projection(locus, center);
    if (t < -EPSILON || t > locus.length + EPSILON) return null;
    return offset(locus.a, locus.ux * t, locus.uy * t);
  }
  const dx = center.x - locus.center.x;
  const dy = center.y - locus.center.y;
  const length = Math.hypot(dx, dy);
  if (length <= EPSILON) return null;
  const distance = locus.radius * locus.contactSide;
  const point = offset(locus.center, dx / length * distance, dy / length * distance);
  return onArc(locus, point) ? point : null;
}

// The picks prefer one of the possible tangencies on the finite drawn boundaries.
export function tangentRadiusCircle(firstSource, secondSource, radius, firstPick, secondPick) {
  if (!firstSource || !secondSource || ![firstPick, secondPick].every(isLinePoint) ||
      !Number.isFinite(radius) || radius <= EPSILON) return null;
  const first = circleBoundary(firstSource);
  const second = circleBoundary(secondSource);
  if (!first || !second) return null;
  let best = null;
  let bestScore = Infinity;
  for (const a of centerLoci(first, radius)) {
    for (const b of centerLoci(second, radius)) {
      const centers = a.a && b.a
        ? lineLociIntersections(a, b, { x: (firstPick.x + secondPick.x) / 2, y: (firstPick.y + secondPick.y) / 2 })
        : a.a || b.a ? lineCircularLociIntersections(a.a ? a : b, a.a ? b : a) : circularLociIntersections(a, b, [firstPick, secondPick]);
      for (const center of centers) {
        const circle = circleGeometry(center, radius);
        if (!circle) continue;
        const contact1 = tangentPoint(a, center);
        const contact2 = tangentPoint(b, center);
        if (!contact1 || !contact2) continue;
        const score = Math.hypot(contact1.x - firstPick.x, contact1.y - firstPick.y) +
          Math.hypot(contact2.x - secondPick.x, contact2.y - secondPick.y);
        if (score >= bestScore) continue;
        best = { ...circle, contacts: [contact1, contact2] };
        bestScore = score;
      }
    }
  }
  return best;
}
