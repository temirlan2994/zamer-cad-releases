import { arcGeometry } from "./geometry.js";
import { isLinePoint, isValidLine, lineCrossing } from "./line-edits.js";

const POINT_EPSILON = 0.000001;

function finitePoint(point) {
  return Number.isFinite(point?.x) && Number.isFinite(point?.y);
}

function legFromPick(line, intersection, pick) {
  const dx = line.x2 - line.x1;
  const dy = line.y2 - line.y1;
  const length = Math.hypot(dx, dy);
  const x = dx / length;
  const y = dy / length;
  const projection = (px, py) => (px - intersection.x) * x + (py - intersection.y) * y;
  const start = projection(line.x1, line.y1);
  const end = projection(line.x2, line.y2);
  const picked = projection(pick.x, pick.y);
  const reachesStart = start < -POINT_EPSILON;
  const reachesEnd = end > POINT_EPSILON;
  if (Math.abs(picked) <= POINT_EPSILON && reachesStart && reachesEnd) return null;
  const preserveStart = Math.abs(picked) <= POINT_EPSILON ? reachesStart : picked < 0;
  const distance = preserveStart ? -start : end;
  if (!Number.isFinite(distance) || distance <= POINT_EPSILON) return null;
  return {
    direction: { x: preserveStart ? -x : x, y: preserveStart ? -y : y },
    distance,
    preserveStart,
  };
}

function pointAlong(intersection, direction, distance) {
  return { x: intersection.x + distance * direction.x, y: intersection.y + distance * direction.y };
}

function replaceNearestEnd(line, leg, point) {
  return leg.preserveStart
    ? { x1: line.x1, y1: line.y1, x2: point.x, y2: point.y }
    : { x1: point.x, y1: point.y, x2: line.x2, y2: line.y2 };
}

function filletResult(first, second, arc = null) {
  return isValidLine(first) && isValidLine(second) ? { first, second, arc } : null;
}

// A pick on each line selects the branch to keep. Radius zero replaces the
// two near endpoints with the virtual corner, extending them when required.
export function filletLines(first, second, firstPick, secondPick, radius) {
  if (!finitePoint(firstPick) || !finitePoint(secondPick) || !Number.isFinite(radius) || radius < 0) return null;
  const intersection = lineCrossing(first, second, { extendFirst: true, extendSecond: true });
  if (!finitePoint(intersection)) return null;
  const firstLeg = legFromPick(first, intersection, firstPick);
  const secondLeg = legFromPick(second, intersection, secondPick);
  if (!firstLeg || !secondLeg) return null;
  if (radius === 0) {
    return filletResult(
      replaceNearestEnd(first, firstLeg, intersection),
      replaceNearestEnd(second, secondLeg, intersection),
    );
  }

  const a = firstLeg.direction;
  const b = secondLeg.direction;
  const cosine = a.x * b.x + a.y * b.y;
  const sine = Math.abs(a.x * b.y - a.y * b.x);
  // Use the half-angle expression that avoids subtracting near-equal values.
  const cotangentHalfAngle = cosine >= 0 ? (1 + cosine) / sine : sine / (1 - cosine);
  const tangentDistance = radius * cotangentHalfAngle;
  if (!(tangentDistance > 0 && tangentDistance + POINT_EPSILON < Math.min(firstLeg.distance, secondLeg.distance))) return null;

  const start = pointAlong(intersection, a, tangentDistance);
  const end = pointAlong(intersection, b, tangentDistance);
  const bisectorLength = Math.hypot(a.x + b.x, a.y + b.y);
  const bisector = { x: (a.x + b.x) / bisectorLength, y: (a.y + b.y) / bisectorLength };
  const centerDistance = Math.hypot(tangentDistance, radius);
  // centerDistance - radius, computed without subtracting near-equal values.
  const throughDistance = tangentDistance * (tangentDistance / centerDistance) / (1 + radius / centerDistance);
  const through = pointAlong(intersection, bisector, throughDistance);
  if (![start, through, end].every(isLinePoint) || !arcGeometry(start, through, end)) return null;
  return filletResult(
    replaceNearestEnd(first, firstLeg, start),
    replaceNearestEnd(second, secondLeg, end),
    { start, through, end },
  );
}
