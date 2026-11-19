import { pointInPolygon, pointToSegmentDistance, segmentsIntersect } from "./geometry.js";
import { annotationTextLines, annotationTextWidth, annotationWorldSize } from "./annotation-text.js";
import { isLinePoint } from "./line-edits.js";
import { polylineArcPoint, polylineSegments, validPolylinePoints } from "./polyline.js";

export const PLAN_ANNOTATION_LAYERS = Object.freeze({ area: "areas", elevation: "elevations" });
export const PLAN_AREA_COLOR = "#176f87";
export const PLAN_ELEVATION_STYLES = Object.freeze({
  ceiling: Object.freeze({ label: "Потолок", color: "#167d5c" }),
  beam: Object.freeze({ label: "Ригель", color: "#9a5b17" }),
  drop: Object.freeze({ label: "Перепад", color: "#7552ae" }),
});

// Import and editing both check simple rings in quadratic time.
export const MAX_PLAN_ANNOTATION_POINTS = 1024;
const POLYLINE_CHORD_ERROR_MM = 0.25;
const areaFormatter = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2, useGrouping: false });
const elevationFormatter = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 3, useGrouping: false, signDisplay: "exceptZero" });
// Zone edits replace the stored points array, allowing redraws to reuse the geometry.
const geometryByPoints = new WeakMap();
let lastLabelLayout;

function openRing(points) {
  if (!Array.isArray(points) || points.length < 3 || points.length > MAX_PLAN_ANNOTATION_POINTS + 1) return null;
  const first = points[0];
  const last = points.at(-1);
  const ring = first && last && first.x === last.x && first.y === last.y ? points.slice(0, -1) : points;
  if (ring.length > MAX_PLAN_ANNOTATION_POINTS || !validPolylinePoints(ring, true) || !ring.every(isLinePoint)) return null;
  return ring;
}

function hasCrossingEdges(edges) {
  edges.sort((a, b) => a.minX - b.minX);
  for (const [index, first] of edges.entries()) {
    for (let next = index + 1; next < edges.length && edges[next].minX <= first.maxX; next++) {
      const second = edges[next];
      const separation = Math.abs(first.index - second.index);
      if (separation === 1 || separation === edges.length - 1 || first.maxY < second.minY || second.maxY < first.minY) continue;
      if (segmentsIntersect(first.a, first.b, second.a, second.b)) return true;
    }
  }
  return false;
}

function ringGeometry(source) {
  const points = openRing(source);
  if (!points) return null;
  const origin = points[0];
  const bounds = { minX: origin.x, minY: origin.y, maxX: origin.x, maxY: origin.y };
  const edges = [];
  let twiceArea = 0;
  let centroidX = 0;
  let centroidY = 0;
  for (let index = 0; index < points.length; index++) {
    const a = points[index];
    const b = points[(index + 1) % points.length];
    const ax = a.x - origin.x;
    const ay = a.y - origin.y;
    const bx = b.x - origin.x;
    const by = b.y - origin.y;
    const cross = ax * by - ay * bx;
    twiceArea += cross;
    centroidX += (ax + bx) * cross;
    centroidY += (ay + by) * cross;
    bounds.minX = Math.min(bounds.minX, a.x);
    bounds.minY = Math.min(bounds.minY, a.y);
    bounds.maxX = Math.max(bounds.maxX, a.x);
    bounds.maxY = Math.max(bounds.maxY, a.y);

    const previous = points[(index + points.length - 1) % points.length];
    const incomingX = a.x - previous.x;
    const incomingY = a.y - previous.y;
    const outgoingX = b.x - a.x;
    const outgoingY = b.y - a.y;
    if (incomingX * outgoingY === incomingY * outgoingX && incomingX * outgoingX + incomingY * outgoingY < 0) return null;
    edges.push({ a, b, index, minX: Math.min(a.x, b.x), maxX: Math.max(a.x, b.x),
      minY: Math.min(a.y, b.y), maxY: Math.max(a.y, b.y) });
  }
  if (!Number.isFinite(twiceArea) || Math.abs(twiceArea) <= 1e-6 || hasCrossingEdges(edges)) return null;
  const areaMm2 = Math.abs(twiceArea) / 2;
  const centroid = { x: origin.x + centroidX / (3 * twiceArea), y: origin.y + centroidY / (3 * twiceArea) };
  return { points, areaMm2, areaM2: areaMm2 / 1e6, centroid, bounds };
}

function boundaryDistance(point, points) {
  let minimum = Infinity;
  for (let index = 0; index < points.length; index++) {
    minimum = Math.min(minimum, pointToSegmentDistance(point, points[index], points[(index + 1) % points.length]));
  }
  return minimum;
}

function scanlineBoundaries(points, y) {
  const boundaries = [];
  for (let index = 0; index < points.length; index++) {
    const a = points[index];
    const b = points[(index + 1) % points.length];
    if ((a.y > y) === (b.y > y)) continue;
    boundaries.push(a.x + (b.x - a.x) * ((y - a.y) / (b.y - a.y)));
  }
  return boundaries;
}

function interiorAnchor(geometry, obstacles = []) {
  const { points, centroid, bounds } = geometry;
  const height = bounds.maxY - bounds.minY;
  let anchor = null;
  let bestClearance = 0;
  function consider(point) {
    if (!isLinePoint(point) || !pointInPolygon(point, points) || obstacles.some(({ points }) => pointInPolygon(point, points))) return;
    let distance = boundaryDistance(point, points);
    for (const obstacle of obstacles) distance = Math.min(distance, boundaryDistance(point, obstacle.points));
    if (distance > bestClearance) {
      bestClearance = distance;
      anchor = point;
    }
  }

  function scan(y) {
    if (y <= bounds.minY || y >= bounds.maxY) return;
    const cuts = [geometry, ...obstacles].flatMap(({ points }) => scanlineBoundaries(points, y)).sort((a, b) => a - b);
    for (let index = 1; index < cuts.length; index++) {
      consider({ x: cuts[index - 1] + (cuts[index] - cuts[index - 1]) / 2, y });
    }
  }

  consider(centroid);
  const maximumClearance = Math.min(bounds.maxX - bounds.minX, height) / 2;
  if (bestClearance >= maximumClearance * 0.995) return anchor;
  for (let part = 1; part < 8; part++) scan(bounds.minY + height * (part / 8));
  for (const obstacle of obstacles) {
    scan(bounds.minY + (obstacle.bounds.minY - bounds.minY) / 2);
    scan(bounds.maxY + (obstacle.bounds.maxY - bounds.maxY) / 2);
  }
  // Across two distinct vertex heights a simple ring has an interior span.
  // Probe all such bands only as a fallback for thin or highly irregular zones.
  if (!anchor) {
    const heights = [...new Set([geometry, ...obstacles].flatMap(({ points }) => points.map(({ y }) => y)))].sort((a, b) => a - b);
    for (let index = 1; !anchor && index < heights.length; index++) {
      scan(heights[index - 1] + (heights[index] - heights[index - 1]) / 2);
    }
  }
  return anchor;
}

export function planAnnotationGeometry(entity) {
  if (!Object.hasOwn(PLAN_ANNOTATION_LAYERS, entity?.type) || !Array.isArray(entity.points)) return null;
  const source = entity.points;
  if (!geometryByPoints.has(source)) geometryByPoints.set(source, calculatePlanGeometry(source));
  return geometryByPoints.get(source);
}

function calculatePlanGeometry(source) {
  const ring = ringGeometry(source);
  if (!ring) return null;
  const anchor = interiorAnchor(ring);
  if (!anchor) return null;
  const { points, areaMm2, areaM2, bounds } = ring;
  return { points, areaMm2, areaM2, anchor, bounds };
}

export function planAnnotationAnchors(entities) {
  const zones = entities.filter((entity) => Object.hasOwn(PLAN_ANNOTATION_LAYERS, entity?.type));
  if (lastLabelLayout && zones.length === lastLabelLayout.zones.length && zones.every(({ id, type, points }, index) => {
    const previous = lastLabelLayout.zones[index];
    return id === previous.id && type === previous.type && points === previous.points;
  })) return lastLabelLayout.anchors;

  const shapes = [];
  for (const entity of zones) {
    const geometry = planAnnotationGeometry(entity);
    if (geometry) shapes.push({ entity, geometry });
  }
  const elevations = shapes.filter(({ entity }) => entity.type === "elevation");
  const anchors = new Map();
  for (const { entity, geometry } of shapes) {
    let anchor = geometry.anchor;
    if (entity.type === "elevation") {
      const { bounds } = geometry;
      const candidates = elevations.map((entry) => entry.geometry).filter((other) =>
        other.areaMm2 < geometry.areaMm2 &&
        other.bounds.minX >= bounds.minX && other.bounds.maxX <= bounds.maxX &&
        other.bounds.minY >= bounds.minY && other.bounds.maxY <= bounds.maxY);
      if (candidates.some((other) => pointInPolygon(anchor, other.points))) {
        const nested = candidates.filter((other) => other.points.every((point) =>
          pointInPolygon(point, geometry.points) || boundaryDistance(point, geometry.points) <= 1e-6));
        if (nested.length) anchor = interiorAnchor({ ...geometry, centroid: anchor }, nested) ?? anchor;
      }
    }
    anchors.set(entity.id, anchor);
  }
  lastLabelLayout = { zones: zones.map(({ id, type, points }) => ({ id, type, points })), anchors };
  return anchors;
}

function copyValidatedPoints(geometry) {
  const points = geometry.points.map(({ x, y }) => ({ x, y }));
  geometryByPoints.set(points, { ...geometry, points });
  return points;
}

export function createPlanAnnotation(id, type, points, options) {
  if (typeof id !== "string" || !id.trim() || !Object.hasOwn(PLAN_ANNOTATION_LAYERS, type)) return null;
  const { height, label, zoneStyle } = options ?? {};
  if (label != null && typeof label !== "string") return null;
  if (type === "elevation" && (!Number.isFinite(height) || (zoneStyle != null && !Object.hasOwn(PLAN_ELEVATION_STYLES, zoneStyle)))) return null;
  const geometry = calculatePlanGeometry(points);
  if (!geometry) return null;
  const entity = { id, type, layer: PLAN_ANNOTATION_LAYERS[type], points: copyValidatedPoints(geometry) };
  if (label?.trim()) entity.label = label.trim();
  if (type === "elevation") {
    entity.height = height === 0 ? 0 : height;
    entity.zoneStyle = zoneStyle ?? "ceiling";
  }
  return entity;
}

export function normalizePlanAnnotation(entity) {
  const layer = PLAN_ANNOTATION_LAYERS[entity?.type];
  if (!layer || (entity.layer != null && entity.layer !== layer)) return null;
  return createPlanAnnotation(entity.id, entity.type, entity.points, entity);
}

function arcSubdivisionCount(arc) {
  const step = Math.min(Math.PI / 18, 4 * Math.asin(Math.sqrt(Math.min(1, POLYLINE_CHORD_ERROR_MM / (2 * arc.radius)))));
  return Math.min(MAX_PLAN_ANNOTATION_POINTS, Math.max(2, Math.ceil(Math.abs(arc.sweep) / step)));
}

export function tessellatePolyline(entity, maxPoints = MAX_PLAN_ANNOTATION_POINTS) {
  const vertices = entity?.points;
  if (!Number.isSafeInteger(maxPoints) || maxPoints < 2 || maxPoints > MAX_PLAN_ANNOTATION_POINTS) return null;
  if (!Array.isArray(vertices) || vertices.length > maxPoints) return null;
  const segments = polylineSegments(entity);
  if (!segments.length) return null;

  const counts = segments.map(({ arc }) => arc ? arcSubdivisionCount(arc) : 1);
  const minimum = segments.reduce((sum, { arc }) => sum + (arc ? 2 : 1), entity.closed ? 0 : 1);
  if (minimum > maxPoints) return null;
  let desiredExtra = counts.reduce((sum, count) => sum + count, entity.closed ? 0 : 1) - minimum;
  let availableExtra = Math.min(desiredExtra, maxPoints - minimum);
  const points = [];
  for (const [index, { p1, arc }] of segments.entries()) {
    points.push(p1);
    if (!arc) continue;
    const requested = counts[index] - 2;
    const extra = requested > 0 ? Math.round(availableExtra * requested / desiredExtra) : 0;
    desiredExtra -= requested;
    availableExtra -= extra;
    const count = 2 + extra;
    for (let part = 1; part < count; part++) points.push(polylineArcPoint(arc, part / count));
  }
  if (!entity.closed) points.push(segments.at(-1).p2);
  return points;
}

export function planAnnotationPointsFromEntity(entity) {
  let points;
  if (entity?.type === "polyline" && entity.closed === true) {
    points = tessellatePolyline(entity);
  } else if (entity?.type === "rectangle") {
    const { x1, y1, x2, y2 } = entity;
    points = [{ x: x1, y: y1 }, { x: x2, y: y1 }, { x: x2, y: y2 }, { x: x1, y: y2 }];
  } else if (entity?.type === "circle" && Number.isFinite(entity.radius) && entity.radius > 0) {
    const { cx, cy, radius } = entity;
    if (!isLinePoint({ x: cx, y: cy })) return null;
    // Keep cardinal vertices and increase resolution with the drawing radius.
    const count = Math.min(MAX_PLAN_ANNOTATION_POINTS, Math.max(64, Math.ceil(radius / 20) * 4));
    points = Array.from({ length: count }, (_, index) => {
      const angle = index * Math.PI * 2 / count;
      return { x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle) };
    });
  }
  const geometry = calculatePlanGeometry(points);
  return geometry ? geometry.points.map(({ x, y }) => ({ x, y })) : null;
}

export function formatPlanArea(areaM2) {
  if (!Number.isFinite(areaM2) || areaM2 < 0) return "—";
  return areaM2 > 0 && areaM2 < 0.005 ? "<0,01 м²" : `${areaFormatter.format(areaM2)} м²`;
}

export function formatPlanElevation(height) {
  return Number.isFinite(height) ? `${elevationFormatter.format(height)} мм` : "—";
}

export function planZoneLabelLines(entity, geometry) {
  const value = entity.type === "area" ? formatPlanArea(geometry.areaM2) : `Z ${formatPlanElevation(entity.height)}`;
  const label = typeof entity.label === "string" ? entity.label.trim() : "";
  return label ? [value, ...annotationTextLines(label)] : [value];
}

export function planZoneLabelHeight(lines, bounds, scaleFactor) {
  const { minX, maxX, minY, maxY } = bounds;
  const width = annotationTextWidth(lines, 1) * 1.2 + 1.2;
  const height = (lines.length - 1) * 1.4 + 1.7;
  return Math.min(annotationWorldSize(12, scaleFactor), (maxX - minX) * 0.75 / width,
    (maxY - minY) * 0.75 / height);
}
