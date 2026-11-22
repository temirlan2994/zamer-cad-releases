import { arcGeometry, entityBounds, normalizeAnglePositive } from "./geometry.js";
import { editableFigure, validFigurePiece } from "./figure-edits.js";
import { isLinePoint, MAX_LINE_COORDINATE } from "./line-edits.js";
import { polylineBounds, polylineSegments } from "./polyline.js";

export const MAX_REUSABLE_BLOCKS = 64;
export const MAX_BLOCK_NAME_LENGTH = 48;
const MAX_PARTS = 256;
const MAX_VERTICES = 4096;
const expandedBlocks = new WeakMap();

export function isReusableBlock(entity) {
  return entity?.type === "block" && entity.kind === "reusable";
}

export function normalizeBlockName(name) {
  return typeof name === "string" ? name.normalize("NFC").replace(/[\p{Cc}\p{Cs}]+/gu, " ").trim()
    .slice(0, MAX_BLOCK_NAME_LENGTH).replace(/[\uD800-\uDBFF]$/u, "").trimEnd() : "";
}

function rectanglePoints(entity) {
  const { x1, y1, x2, y2 } = entity;
  return [{ x: x1, y: y1 }, { x: x2, y: y1 }, { x: x2, y: y2 }, { x: x1, y: y2 }];
}

function endpoints(entity) {
  return [{ x: entity.x1, y: entity.y1 }, { x: entity.x2, y: entity.y2 }];
}

function partBounds(entity) {
  if (entity.type === "polyline") return polylineBounds(entity);
  if (entity.type !== "arc") return entityBounds(entity);
  const arc = arcGeometry(entity.start, entity.through, entity.end);
  if (!arc) return null;
  const sign = arc.counterClockwise ? 1 : -1;
  const sweep = normalizeAnglePositive((arc.endAngle - arc.startAngle) * sign);
  const points = [entity.start, entity.through, entity.end];
  for (const angle of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) {
    if (normalizeAnglePositive((angle - arc.startAngle) * sign) <= sweep) {
      points.push({ x: arc.center.x + arc.radius * Math.cos(angle), y: arc.center.y + arc.radius * Math.sin(angle) });
    }
  }
  return pointBounds(points);
}

function pointBounds(points) {
  return {
    minX: Math.min(...points.map(({ x }) => x)), maxX: Math.max(...points.map(({ x }) => x)),
    minY: Math.min(...points.map(({ y }) => y)), maxY: Math.max(...points.map(({ y }) => y)),
  };
}

function partsBounds(parts) {
  const bounds = parts.map(partBounds);
  if (bounds.some(value => !value)) return null;
  return {
    minX: Math.min(...bounds.map(value => value.minX)), maxX: Math.max(...bounds.map(value => value.maxX)),
    minY: Math.min(...bounds.map(value => value.minY)), maxY: Math.max(...bounds.map(value => value.maxY)),
  };
}

function validPart(part) {
  return editableFigure(part) && validFigurePiece(part) && (part.layer == null || typeof part.layer === "string") &&
    (part.type !== "circle" || part.radius <= MAX_LINE_COORDINATE);
}

function validParts(parts) {
  if (!Array.isArray(parts) || parts.length < 1 || parts.length > MAX_PARTS) return false;
  let vertices = 0;
  return parts.every(part => {
    vertices += part?.type === "polyline" ? (Array.isArray(part.points) ? part.points.length : 0) : 4;
    return vertices <= MAX_VERTICES && validPart(part);
  });
}

function mapPart(entity, transform, { reflected = false, scale = 1, axisAligned = true } = {}) {
  const type = entity.type;
  const layer = entity.layer ?? undefined;
  if (type === "arc") return { type, layer, start: transform(entity.start), through: transform(entity.through), end: transform(entity.end) };
  if (type === "circle") {
    const center = transform({ x: entity.cx, y: entity.cy });
    return { type, layer, cx: center.x, cy: center.y, radius: entity.radius * scale };
  }
  if (type === "polyline") {
    const result = { type, layer, points: entity.points.map(transform), closed: Boolean(entity.closed) };
    if (entity.bulges) result.bulges = entity.bulges.map(bulge => reflected ? -bulge : bulge);
    return result;
  }
  if (type === "rectangle" && !axisAligned) {
    return { type: "polyline", layer, points: rectanglePoints(entity).map(transform), closed: true };
  }
  const [start, end] = endpoints(entity).map(transform);
  return { type, layer, x1: start.x, y1: start.y, x2: end.x, y2: end.y };
}

function copyPart(entity) {
  return mapPart(entity, ({ x, y }) => ({ x, y }));
}

export function normalizeReusableBlocks(value) {
  if (!Array.isArray(value)) return [];
  const ids = new Set();
  const names = new Set();
  const blocks = [];
  for (const definition of value.slice(0, MAX_REUSABLE_BLOCKS)) {
    const name = normalizeBlockName(definition?.name);
    const id = definition?.id;
    const nameKey = name.toLowerCase();
    if (typeof id !== "string" || !id.trim() || ids.has(id) || !name || names.has(nameKey) || !validParts(definition.parts)) continue;
    ids.add(id);
    names.add(nameKey);
    blocks.push({ id, name, parts: definition.parts.map(copyPart) });
  }
  return blocks;
}

export function createReusableBlockDefinition(id, name, selection) {
  const parts = selection.flatMap(entity => isReusableBlock(entity) ? expandReusableBlock(entity) ?? [entity] : [entity]);
  if (!validParts(parts)) return null;
  const bounds = partsBounds(parts);
  if (!bounds) return null;
  const x = (bounds.minX + bounds.maxX) / 2;
  const y = (bounds.minY + bounds.maxY) / 2;
  return normalizeReusableBlocks([{ id, name, parts: parts.map(part => mapPart(part, point => ({ x: point.x - x, y: point.y - y }))) }])[0] ?? null;
}

export function createReusableBlockInstance(definition, id, point, layer = "measure") {
  if (!definition || !isLinePoint(point) || !validParts(definition.parts)) return null;
  const bounds = partsBounds(definition.parts);
  if (!bounds) return null;
  const width = Math.max(1, bounds.maxX - bounds.minX);
  const height = Math.max(1, bounds.maxY - bounds.minY);
  const instance = { id, type: "block", kind: "reusable", name: definition.name, definitionId: definition.id,
    x: point.x, y: point.y, rotation: 0, scale: 1, flipX: false, width, height, layer, parts: definition.parts };
  return expandReusableBlock(instance) ? instance : null;
}

export function reusableBlockTransform(entity) {
  const rotation = entity.rotation ?? 0;
  const scale = entity.scale ?? 1;
  const radians = (rotation % 360) * Math.PI / 180;
  const axisAligned = rotation % 90 === 0;
  const cos = axisAligned ? Math.round(Math.cos(radians)) : Math.cos(radians);
  const sin = axisAligned ? Math.round(Math.sin(radians)) : Math.sin(radians);
  const direction = entity.flipX ? -1 : 1;
  return ({ x, y }) => {
    const localX = x * scale * direction;
    const localY = y * scale;
    return { x: entity.x + (localX * cos - localY * sin), y: entity.y + (localX * sin + localY * cos) };
  };
}

export function expandReusableBlock(entity) {
  if (!isReusableBlock(entity) || !isLinePoint(entity)) return null;
  const rotation = entity.rotation ?? 0;
  const scale = entity.scale ?? 1;
  if (!Number.isFinite(rotation) || !Number.isFinite(scale) || scale <= 0) return null;
  const reflected = Boolean(entity.flipX);
  const previous = expandedBlocks.get(entity);
  if (previous?.source === entity.parts && previous.x === entity.x && previous.y === entity.y &&
      previous.rotation === rotation && previous.scale === scale && previous.reflected === reflected) return previous.parts;
  if (!validParts(entity.parts)) return null;
  const axisAligned = rotation % 90 === 0;
  const transform = reusableBlockTransform(entity);
  const parts = entity.parts.map(part => mapPart(part, transform, { reflected, scale, axisAligned }));
  if (!parts.every(validPart)) return null;
  expandedBlocks.set(entity, { source: entity.parts, x: entity.x, y: entity.y, rotation, scale, reflected, parts });
  return parts;
}

export function reusableBlockBounds(entity) {
  const parts = expandReusableBlock(entity);
  if (!parts) return null;
  const record = expandedBlocks.get(entity);
  record.bounds ??= partsBounds(parts);
  return record.bounds;
}

export function expandDrawingBlocks(entities, include = () => true) {
  return entities.flatMap(entity => !isReusableBlock(entity) ? [entity] :
    (expandReusableBlock(entity) ?? []).flatMap((part, index) => include(part)
      ? [{ ...part, id: `${entity.id}-part-${index}` }] : []));
}

export function canExplodeEntity(entity) {
  return isReusableBlock(entity) || (editableFigure(entity) && (entity.type === "polyline" || entity.type === "rectangle"));
}

export function explodeEntity(entity) {
  if (!canExplodeEntity(entity)) return null;
  if (isReusableBlock(entity)) return expandReusableBlock(entity)?.map(copyPart) ?? null;
  const { layer } = entity;
  const segments = entity.type === "polyline" ? polylineSegments(entity) : polylineSegments({ points: rectanglePoints(entity), closed: true });
  const parts = segments.map(({ p1, p2, arc }) => arc
    ? { type: "arc", layer, start: { ...arc.start }, through: { ...arc.through }, end: { ...arc.end } }
    : { type: "line", layer, x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y });
  return parts.length && parts.every(validPart) ? parts : null;
}
