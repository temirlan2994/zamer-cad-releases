import { annotationWorldSize } from "./annotation-text.js";

function toward(from, to, distance, fallback) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  const { x, y } = length > 1e-6 ? { x: dx / length, y: dy / length } : fallback;
  return { x: to.x + x * distance, y: to.y + y * distance };
}

export function linearDimensionArtwork(geometry, scaleFactor) {
  if (!geometry) return null;
  let { start, end, lineStart, lineEnd } = geometry;
  const dx = lineEnd.x - lineStart.x;
  const dy = lineEnd.y - lineStart.y;
  const length = Math.hypot(dx, dy);
  if (!Number.isFinite(length) || length <= 1e-6) return null;
  if (Math.abs(dx) >= Math.abs(dy) ? dx < 0 : dy < 0) {
    [start, end] = [end, start];
    [lineStart, lineEnd] = [lineEnd, lineStart];
  }
  const ux = (lineEnd.x - lineStart.x) / length;
  const uy = (lineEnd.y - lineStart.y) / length;
  const vertical = Math.abs(ux) <= 0.08;
  const gap = annotationWorldSize(15, scaleFactor);
  const extension = annotationWorldSize(12, scaleFactor);
  const fromLine = { x: -uy * Math.sign(geometry.offset || 1), y: ux * Math.sign(geometry.offset || 1) };
  const side = ux > 0 ? -1 : 1;
  const mid = { x: lineStart.x + (lineEnd.x - lineStart.x) / 2, y: lineStart.y + (lineEnd.y - lineStart.y) / 2 };
  const label = { x: mid.x + (vertical ? -gap : -uy * gap * side), y: mid.y + (vertical ? 0 : ux * gap * side) };
  const angle = Math.atan2(uy, ux);
  return {
    start, end, lineStart, lineEnd, ux, uy, label,
    extensionStart: toward(start, lineStart, extension, fromLine),
    extensionEnd: toward(end, lineEnd, extension, fromLine),
    arrowSize: Math.min(annotationWorldSize(9, scaleFactor), length * 0.22),
    textHeight: annotationWorldSize(12, scaleFactor),
    rotation: vertical ? -Math.PI / 2 : (angle > Math.PI / 2 ? angle - Math.PI : angle),
  };
}

export function angularDimensionArtwork(geometry, scaleFactor, arcRadius) {
  if (!geometry) return null;
  const { vertex, arm1, arm2, startAngle, sweep } = geometry;
  const firstLength = Math.hypot(arm1.x - vertex.x, arm1.y - vertex.y);
  const secondLength = Math.hypot(arm2.x - vertex.x, arm2.y - vertex.y);
  const radius = Number.isFinite(arcRadius) && arcRadius > 1e-6
    ? arcRadius : Math.min(annotationWorldSize(84, scaleFactor), Math.min(firstLength, secondLength) * 0.52);
  if (!Number.isFinite(radius) || radius <= 1e-6) return null;
  const endAngle = startAngle + sweep;
  const middle = startAngle + sweep / 2;
  const pointAt = (angle, distance) => ({ x: vertex.x + Math.cos(angle) * distance, y: vertex.y + Math.sin(angle) * distance });
  const firstArcEnd = pointAt(startAngle, radius);
  const secondArcEnd = pointAt(endAngle, radius);
  return {
    radius, firstArcEnd, secondArcEnd,
    firstLegEnd: firstLength >= radius ? arm1 : firstArcEnd,
    secondLegEnd: secondLength >= radius ? arm2 : secondArcEnd,
    base: pointAt(middle, radius),
    label: pointAt(middle, radius + annotationWorldSize(18, scaleFactor)),
    textHeight: annotationWorldSize(12, scaleFactor),
  };
}

export function radialDimensionArtwork(entity, scaleFactor) {
  const { x1, y1, x2, y2, circleRadius: radius, dimensionKind } = entity;
  if (![x1, y1, x2, y2, radius].every(Number.isFinite) || radius <= 0) return null;
  const diameter = dimensionKind === "diameter";
  const center = { x: x1, y: y1 };
  const label = { x: x2, y: y2 };
  const distance = Math.hypot(x2 - x1, y2 - y1);
  const ux = distance ? (x2 - x1) / distance : 1;
  const uy = distance ? (y2 - y1) / distance : 0;
  const rim = { x: x1 + ux * radius, y: y1 + uy * radius };
  const opposite = { x: x1 - ux * radius, y: y1 - uy * radius };
  const inside = distance <= radius;
  return {
    label, rim, opposite, inside, diameter, ux, uy,
    start: diameter ? opposite : center,
    end: inside ? rim : label,
    measurement: diameter ? radius * 2 : radius,
    textHeight: annotationWorldSize(13, scaleFactor),
    arrowSize: Math.min(radius * 0.27, annotationWorldSize(8, scaleFactor)),
  };
}
