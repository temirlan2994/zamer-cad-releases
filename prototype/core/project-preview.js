import { annotationTextLines, annotationTextWidth, leaderAppearance, leaderElbowPoint, leaderFrameSize, leaderPlanPath } from "./annotation-text.js";
import { blockSegments } from "./blocks.js";
import { angularDimensionArtwork, linearDimensionArtwork } from "./dimension-artwork.js";
import { angularDimensionGeometry, dimensionGeometry } from "./dimensions.js";
import { arcGeometry, normalizeAnglePositive, offsetWall } from "./geometry.js";
import { isLinePoint, MAX_LINE_COORDINATE } from "./line-edits.js";
import { polylineArc, polylineArcPoint } from "./polyline.js";

const TONES = ["area", "elevation", "wall", "geometry", "furniture", "annotation"];
const TYPES = new Set(["line", "wall", "rectangle", "circle", "polyline", "arc", "block", "text", "area", "elevation"]);
const QUADRANTS = [0, Math.PI / 2, Math.PI, Math.PI * 1.5];
const MAX_ENTITIES = 640;
const MAX_VERTICES = 192;
const MAX_PATH_LENGTH = 96000;

function endpoints({ x1, y1, x2, y2 }) {
  return [{ x: x1, y: y1 }, { x: x2, y: y2 }];
}

function trace(points, tone, { closed = false, fill = false, curves = [] } = {}) {
  return { points, tone, closed, fill, curves };
}

function arcExtent(center, radius, startAngle, sweep, pointAt) {
  const magnitude = Math.abs(sweep);
  const extrema = [];
  for (const angle of QUADRANTS) {
    const offset = normalizeAnglePositive((angle - startAngle) * Math.sign(sweep));
    if (offset <= magnitude) extrema.push(pointAt ? pointAt(offset / magnitude) : {
      x: center.x + radius * Math.cos(angle), y: center.y + radius * Math.sin(angle),
    });
  }
  return extrema;
}

function arcCurve(center, radius, startAngle, sweep, through, pointAt) {
  const extrema = arcExtent(center, radius, startAngle, sweep, pointAt);
  if (through) extrema.push(through);
  return { radius, sweep, extrema };
}

function ringCorners(a, b) {
  return [a, { x: b.x, y: a.y }, b, { x: a.x, y: b.y }];
}

function rememberExtremes(extremes, point, item) {
  if (!isLinePoint(point)) return;
  const coordinates = [point.x, -point.x, point.y, -point.y];
  for (const [axis, coordinate] of coordinates.entries()) {
    if (!extremes[axis] || coordinate > extremes[axis].coordinate) extremes[axis] = { coordinate, item };
  }
}

// Preserve endpoints and the four coordinate extrema when reducing a dense path.
function representativeVertices(points, budget = MAX_VERTICES) {
  if (!Array.isArray(points) || !points.length) return [];
  if (points.length <= budget) return points.map((point, index) => ({ point, index }));
  const indices = new Set();
  for (let sample = 0; sample < budget; sample++) {
    indices.add(Math.round(sample * (points.length - 1) / (budget - 1)));
  }
  const extremes = [];
  for (let index = 0; index < points.length; index++) {
    rememberExtremes(extremes, points[index], index);
  }
  for (const { item } of extremes) indices.add(item);
  return [...indices].sort((a, b) => a - b).map(index => ({ point: points[index], index }));
}

function polylineTrace(entity, budget) {
  const vertices = representativeVertices(entity.points, budget);
  const points = vertices.map(({ point }) => point);
  const curves = vertices.map(({ point, index }, position) => {
    const next = vertices[(position + 1) % vertices.length];
    if (!next || ((!entity.closed || next.index !== 0) && next.index !== index + 1)) return null;
    const arc = polylineArc(point, next.point, entity.bulges?.[index]);
    return arc ? arcCurve(arc.center, arc.radius, arc.startAngle, arc.sweep, arc.through,
      fraction => polylineArcPoint(arc, fraction)) : null;
  });
  return trace(points, "geometry", { closed: Boolean(entity.closed), curves });
}

function shortLabel(anchor, width, radians = 0, centered = true) {
  const x = Math.cos(radians) * width;
  const y = Math.sin(radians) * width;
  const offset = centered ? 0.5 : 0;
  return trace([
    { x: anchor.x - x * offset, y: anchor.y - y * offset },
    { x: anchor.x + x * (1 - offset), y: anchor.y + y * (1 - offset) },
  ], "annotation");
}

function leaderTraces(entity) {
  const [arrow, center] = endpoints(entity);
  if (![arrow, center].every(isLinePoint)) return [];
  const lines = annotationTextLines(typeof entity.text === "string" ? entity.text.slice(0, 240) : "");
  const height = Math.abs([entity.textHeight, entity.height].find(value => Number.isFinite(value) && value !== 0) || 200);
  if (height > MAX_LINE_COORDINATE) return [];
  const { line, frame } = leaderAppearance(entity);
  const shape = leaderFrameSize(height, annotationTextWidth(lines, height), lines.length, frame);
  const rect = { x: center.x - shape.width / 2, y: center.y - shape.height / 2, ...shape };
  const label = shortLabel(center, shape.width * 0.55);
  const path = leaderPlanPath(arrow, rect, line, height * 1.1, leaderElbowPoint(entity));
  return [trace(path, "annotation"), label,
    ...(frame ? [trace(ringCorners(rect, { x: rect.x + rect.width, y: rect.y + rect.height }), "annotation", { closed: true })] : [])];
}

function dimensionTraces(entity, annotationScale) {
  if (entity.dimensionKind === "angular") {
    const geometry = angularDimensionGeometry(entity);
    const art = angularDimensionArtwork(geometry, annotationScale, entity.arcRadius);
    if (!art) return [];
    const { vertex, startAngle, sweep } = geometry;
    const curves = [arcCurve(vertex, art.radius, startAngle, sweep, art.base)];
    return [trace([art.firstLegEnd, vertex, art.secondLegEnd], "annotation"),
      trace([art.firstArcEnd, art.secondArcEnd], "annotation", { curves }), shortLabel(art.label, art.textHeight * 1.5)];
  }
  const art = linearDimensionArtwork(dimensionGeometry(entity), annotationScale);
  return art ? [trace([art.start, art.extensionStart], "annotation"), trace([art.end, art.extensionEnd], "annotation"),
    trace([art.lineStart, art.lineEnd], "annotation"), shortLabel(art.label, art.textHeight * 2, art.rotation)] : [];
}

function entityTraces(entity, annotationScale, budget) {
  switch (entity.type) {
    case "wall": {
      const points = endpoints(entity);
      if (!points.every(isLinePoint)) return [];
      const { width } = entity;
      if (!(Number.isFinite(width) && width > 0 && width <= MAX_LINE_COORDINATE)) return [trace(points, "wall")];
      const { a, b } = offsetWall(entity, width / 2);
      return [trace([...endpoints(a), ...endpoints(b).reverse()], "wall", { closed: true })];
    }
    case "rectangle": return [trace(ringCorners(...endpoints(entity)), "geometry", { closed: true })];
    case "circle": {
      const { cx, cy, radius } = entity;
      if (!isLinePoint({ x: cx, y: cy }) || !Number.isFinite(radius) || radius <= 0 || radius > MAX_LINE_COORDINATE) return [];
      const center = { x: cx, y: cy };
      const curves = [arcCurve(center, radius, 0, Math.PI), arcCurve(center, radius, Math.PI, Math.PI)];
      return [trace([{ x: cx + radius, y: cy }, { x: cx - radius, y: cy }], "geometry", { closed: true, curves })];
    }
    case "polyline": return [polylineTrace(entity, budget)];
    case "arc": {
      const { start, through, end } = entity;
      if (![start, through, end].every(isLinePoint)) return [];
      const arc = arcGeometry(start, through, end);
      if (!arc) return [];
      const sign = arc.counterClockwise ? 1 : -1;
      const sweep = sign * normalizeAnglePositive((arc.endAngle - arc.startAngle) * sign);
      return [trace([start, end], "geometry", { curves: [arcCurve(arc.center, arc.radius, arc.startAngle, sweep, through)] })];
    }
    case "block": {
      if (!isLinePoint(entity)) return [];
      const kind = typeof entity.kind === "string" ? entity.kind : null;
      const { width, height, rotation } = entity;
      const points = blockSegments({ x: entity.x, y: entity.y, kind,
        width: Number.isFinite(width) ? width : 0, height: Number.isFinite(height) ? height : 0,
        rotation: Number.isFinite(rotation) ? rotation : 0 })
        .map(({ x1, y1 }) => ({ x: x1, y: y1 }));
      return [trace(points, "furniture", { closed: true })];
    }
    case "area":
    case "elevation": {
      const contours = Array.isArray(entity.contours) && entity.contours.length ? entity.contours.slice(0, 32) : [entity.points];
      const ringBudget = Math.max(8, Math.floor(budget / contours.length));
      return contours.map(ring => trace(representativeVertices(ring, ringBudget).map(({ point }) => point), entity.type, { closed: true, fill: true }));
    }
    case "text": {
      if (!isLinePoint(entity) || typeof entity.text !== "string" || !entity.text.trim()) return [];
      const lines = annotationTextLines(entity.text.slice(0, 240)).slice(0, 12);
      const height = Number.isFinite(entity.height) && entity.height > 0 ? entity.height : 260;
      const radians = Number.isFinite(entity.rotation) ? entity.rotation % 360 * Math.PI / 180 : 0;
      const anchor = { x: entity.x + Math.sin(radians) * height / 3, y: entity.y - Math.cos(radians) * height / 3 };
      return lines.flatMap((line, index) => line.trim() ? [shortLabel({ x: anchor.x - Math.sin(radians) * height * 1.2 * index,
        y: anchor.y + Math.cos(radians) * height * 1.2 * index }, annotationTextWidth([line], height), radians, false)] : []);
    }
    case "line": {
      if (entity.dimensionKind === "leader") return leaderTraces(entity);
      if (entity.layer === "dimensions" || entity.dimensionKind === "angular") return dimensionTraces(entity, annotationScale);
      return [trace(endpoints(entity), "geometry")];
    }
    default: return [];
  }
}

function representativeEntityPoints(entity) {
  if (entity.type === "circle") {
    const { cx, cy, radius } = entity;
    return Number.isFinite(radius) && radius > 0 ? [{ x: cx - radius, y: cy - radius }, { x: cx + radius, y: cy + radius }] : [];
  }
  if (entity.type === "block" || entity.type === "text") return [entity];
  if (entity.type === "arc") return [entity.start, entity.through, entity.end];
  if (entity.type === "polyline" || entity.type === "area" || entity.type === "elevation") {
    const points = Array.isArray(entity.points) ? entity.points : entity.contours?.[0];
    return Array.isArray(points) ? [points[0], points[Math.floor(points.length / 2)], points.at(-1)] : [];
  }
  if (entity.dimensionKind === "angular") return [entity.vertex, entity.arm1, entity.arm2];
  return [...endpoints(entity), entity.dimensionKind === "leader" ? leaderElbowPoint(entity) : null];
}

function visiblePreviewEntities(entities, layers) {
  let output = [];
  let step = 1;
  let count = 0;
  let last;
  const extremes = [];
  for (const entity of entities) {
    if (!TYPES.has(entity?.type) || (layers && !layers.has(entity.layer || "measure"))) continue;
    if (count++ % step === 0) output.push(entity);
    if (output.length > MAX_ENTITIES) {
      output = output.filter((_, index) => index % 2 === 0);
      step *= 2;
    }
    last = entity;
    if (entities.length > MAX_ENTITIES) for (const point of representativeEntityPoints(entity)) rememberExtremes(extremes, point, entity);
  }
  return [...new Set([...output, ...(last ? [last] : []), ...extremes.map(({ item }) => item)])];
}

function boundedSketchPoint(point) {
  const limit = MAX_LINE_COORDINATE * 3;
  return Number.isFinite(point?.x) && Number.isFinite(point?.y) && Math.abs(point.x) <= limit && Math.abs(point.y) <= limit;
}

function sketchBounds(paths) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const include = ({ x, y }) => {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  };
  for (const { points, curves } of paths) {
    points.forEach(include);
    for (const curve of curves) curve?.extrema.forEach(include);
  }
  return { minX, minY, maxX, maxY };
}

function pathData({ points, curves, closed }, position, scale) {
  const mapped = points.map(position);
  const command = [`M${mapped[0]}`];
  const count = mapped.length - (closed ? 0 : 1);
  for (let index = 0; index < count; index++) {
    const end = mapped[(index + 1) % mapped.length];
    if (end === mapped[index]) continue;
    const arc = curves[index];
    const radius = arc ? arc.radius * scale : 0;
    if (arc && 2 * radius * Math.sin(arc.sweep / 4) ** 2 >= 0.12 && radius < 1e7) {
      const r = Math.round(radius * 100) / 100;
      command.push(`A${r} ${r} 0 ${Number(Math.abs(arc.sweep) > Math.PI)} ${Number(arc.sweep > 0)} ${end}`);
    } else if (!closed || index !== count - 1) {
      command.push(`L${end}`);
    }
  }
  if (command.length === 1) return "";
  if (closed) command.push("Z");
  return command.join("");
}

export function buildProjectPreview(project, { width = 160, height = 96 } = {}) {
  if (!Array.isArray(project?.entities) || ![width, height].every(value => Number.isFinite(value) && value >= 16 && value <= 1024)) return null;
  const layers = Array.isArray(project.visibleLayers) ? new Set(project.visibleLayers) : null;
  const entities = visiblePreviewEntities(project.entities, layers);
  if (project.draft?.tool === "polyline" && (!layers || layers.has(project.draft.layer || "measure"))) {
    entities.push({ ...project.draft, type: "polyline" });
  }
  const annotationScale = Number.isFinite(project.annotationScale) ? project.annotationScale : 1;
  const vertexBudget = Math.max(16, Math.min(MAX_VERTICES, Math.floor(8000 / (entities.length || 1))));
  const paths = entities.flatMap(entity => entityTraces(entity, annotationScale, vertexBudget)).filter(({ points, curves, fill }) =>
    points.length >= (fill ? 3 : 2) && points.every(boundedSketchPoint) && curves.every(curve => !curve || curve.extrema.every(boundedSketchPoint)));
  if (!paths.length) return null;

  const { minX, minY, maxX, maxY } = sketchBounds(paths);
  const spanX = maxX - minX;
  const spanY = maxY - minY;
  if (!(Math.max(spanX, spanY) > 0)) return null;
  const padding = Math.min(width, height) / 10;
  const scale = Math.min(spanX ? (width - padding * 2) / spanX : Infinity,
    spanY ? (height - padding * 2) / spanY : Infinity);
  if (!(scale > 0 && Number.isFinite(scale))) return null;
  const x = (width - spanX * scale) / 2;
  const y = (height - spanY * scale) / 2;
  const coordinate = (value) => Math.round(value * 100) / 100;
  const position = (point) => `${coordinate(x + (point.x - minX) * scale)} ${coordinate(y + (point.y - minY) * scale)}`;
  const combined = new Map();
  for (const path of paths) {
    const d = pathData(path, position, scale);
    if (!d) continue;
    const group = combined.get(path.tone) ?? { d: "", tone: path.tone, ...(path.fill ? { fill: true } : {}) };
    if (group.d.length + d.length <= MAX_PATH_LENGTH) group.d += d;
    combined.set(path.tone, group);
  }
  const output = TONES.map(tone => combined.get(tone)).filter(path => path?.d);
  return output.length ? { viewBox: `0 0 ${width} ${height}`, paths: output } : null;
}
