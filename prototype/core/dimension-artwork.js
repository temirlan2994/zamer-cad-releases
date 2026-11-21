import { annotationWorldSize } from "./annotation-text.js";
import { arcGeometry, normalizeAnglePositive } from "./geometry.js";

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
  const direction = entity.radialRim ?? label;
  const directionLength = Math.hypot(direction.x - x1, direction.y - y1);
  const ux = directionLength ? (direction.x - x1) / directionLength : 1;
  const uy = directionLength ? (direction.y - y1) / directionLength : 0;
  const rim = { x: x1 + ux * radius, y: y1 + uy * radius };
  const opposite = { x: x1 - ux * radius, y: y1 - uy * radius };
  const inside = distance <= radius;
  const landing = Boolean(entity.radialRim) &&
    (Math.abs((label.x - x1) * uy - (label.y - y1) * ux) > 1e-6 || (label.x - x1) * ux + (label.y - y1) * uy < 0);
  return {
    label, rim, opposite, inside, diameter, ux, uy, landing,
    start: diameter ? opposite : center,
    end: inside || landing ? rim : label,
    measurement: diameter ? radius * 2 : radius,
    textHeight: annotationWorldSize(13, scaleFactor),
    arrowSize: Math.min(radius * 0.27, annotationWorldSize(8, scaleFactor)),
  };
}

export const additionalDimensionKinds = ["arc-length", "ordinate", "jogged-radius", "rotated"];

export function additionalDimensionArtwork(entity, scaleFactor) {
  const start = { x: entity.x1, y: entity.y1 };
  const label = { x: entity.x2, y: entity.y2 };
  const textHeight = annotationWorldSize(13, scaleFactor);
  const arrowSize = annotationWorldSize(8, scaleFactor);
  if (![start.x, start.y, label.x, label.y].every(Number.isFinite)) return null;
  const text = { textHeight, label, arrowSize, arrows: [] };
  if (entity.dimensionKind === "ordinate") {
    const xAxis = entity.ordinateAxis === "x";
    const corner = xAxis ? { x: start.x, y: label.y } : { x: label.x, y: start.y };
    return { ...text, prefix: xAxis ? "X " : "Y ", measurement: xAxis ? start.x : -start.y,
      paths: [[start, corner, label]] };
  }
  if (entity.dimensionKind === "jogged-radius") {
    const { jogCenter, jogRim, circleRadius } = entity;
    if (!jogCenter || !jogRim || !Number.isFinite(circleRadius) || circleRadius <= 0) return null;
    const dx = jogCenter.x - jogRim.x;
    const dy = jogCenter.y - jogRim.y;
    const length = Math.hypot(dx, dy);
    if (length <= 1e-6) return null;
    const ux = dx / length;
    const uy = dy / length;
    const span = Math.min(length * 0.23, textHeight * 1.5);
    const point = (along, normal = 0) => ({
      x: jogRim.x + along * ux - normal * uy, y: jogRim.y + along * uy + normal * ux,
    });
    return { ...text, prefix: "R ", measurement: circleRadius,
      paths: [[jogRim, point(length / 2 - span), point(length / 2 - span / 2, span / 2),
        point(length / 2 + span / 2, -span / 2), point(length / 2 + span), jogCenter, label]],
      arrows: [{ point: jogRim, ux, uy }], arrowSize: Math.min(arrowSize, length * 0.22) };
  }
  if (entity.dimensionKind === "rotated") {
    const feature = entity.measureEnd;
    if (!feature || !Number.isFinite(entity.measureAngle)) return null;
    const ux = Math.cos(entity.measureAngle);
    const uy = Math.sin(entity.measureAngle);
    const delta = (feature.x - start.x) * ux + (feature.y - start.y) * uy;
    if (Math.abs(delta) <= 1e-6) return null;
    const offset = (label.x - start.x) * -uy + (label.y - start.y) * ux;
    const a = { x: start.x - uy * offset, y: start.y + ux * offset };
    const b = { x: a.x + ux * delta, y: a.y + uy * delta };
    const sign = Math.sign(delta);
    return { ...text, label: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 - textHeight * .8 },
      prefix: "", measurement: Math.abs(delta), paths: [[start, a], [a, b], [feature, b]],
      arrowSize: Math.min(arrowSize, Math.abs(delta) * .24),
      arrows: [{ point: a, ux: ux * sign, uy: uy * sign }, { point: b, ux: -ux * sign, uy: -uy * sign }] };
  }
  if (entity.dimensionKind !== "arc-length" || !entity.arcStart || !entity.arcThrough || !entity.arcEnd) return null;
  const arc = arcGeometry(entity.arcStart, entity.arcThrough, entity.arcEnd);
  if (!arc) return null;
  const sweep = arc.counterClockwise
    ? normalizeAnglePositive(arc.endAngle - arc.startAngle)
    : -normalizeAnglePositive(arc.startAngle - arc.endAngle);
  const radius = Math.max(arc.radius * 0.08, Math.hypot(label.x - arc.center.x, label.y - arc.center.y));
  const point = (angle, r = radius) => ({
    x: arc.center.x + Math.cos(angle) * r, y: arc.center.y + Math.sin(angle) * r,
  });
  const a = point(arc.startAngle);
  const b = point(arc.endAngle);
  const sign = Math.sign(sweep);
  return { ...text, label: point(arc.startAngle + sweep / 2, radius + textHeight * .8),
    prefix: "⌒ ", measurement: arc.radius * Math.abs(sweep),
    paths: [[entity.arcStart, a], [entity.arcEnd, b]],
    arc: { ...arc, radius, sweep },
    arrowSize: Math.min(arrowSize, radius * Math.abs(sweep) * .24),
    arrows: [
      { point: a, ux: -Math.sin(arc.startAngle) * sign, uy: Math.cos(arc.startAngle) * sign },
      { point: b, ux: Math.sin(arc.endAngle) * sign, uy: -Math.cos(arc.endAngle) * sign },
    ] };
}

export function additionalDimensionPaths(art) {
  if (!art.arc) return art.paths;
  const { center, radius, startAngle, sweep } = art.arc;
  const steps = Math.ceil(Math.abs(sweep) / (Math.PI / 24));
  const curve = Array.from({ length: steps + 1 }, (_, index) => {
    const angle = startAngle + sweep * index / steps;
    return { x: center.x + Math.cos(angle) * radius, y: center.y + Math.sin(angle) * radius };
  });
  return [...art.paths, curve];
}
