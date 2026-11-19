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

export function angularDimensionArtwork(geometry, scaleFactor) {
  if (!geometry) return null;
  const { vertex, arm1, arm2, startAngle, sweep } = geometry;
  const radius = Math.min(annotationWorldSize(84, scaleFactor), Math.min(Math.hypot(arm1.x - vertex.x, arm1.y - vertex.y),
    Math.hypot(arm2.x - vertex.x, arm2.y - vertex.y)) * 0.52);
  if (!Number.isFinite(radius) || radius <= 1e-6) return null;
  const middle = startAngle + sweep / 2;
  const atMiddle = (distance) => ({ x: vertex.x + Math.cos(middle) * distance, y: vertex.y + Math.sin(middle) * distance });
  return { radius, base: atMiddle(radius), label: atMiddle(radius + annotationWorldSize(18, scaleFactor)),
    textHeight: annotationWorldSize(12, scaleFactor) };
}
