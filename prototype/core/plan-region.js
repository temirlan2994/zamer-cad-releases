import { distanceWorld, entityBounds, pointInPolygon, pointToSegmentDistance } from "./geometry.js";
import { isLinePoint, lineCrossing } from "./line-edits.js";
import { MAX_PLAN_ANNOTATION_POINTS, planAnnotationGeometry, planAnnotationPointsFromEntity, tessellatePolyline } from "./plan-annotations.js";
import { polylineBounds } from "./polyline.js";

const JOIN_TOLERANCE = 0.01;
const MAX_NEARBY_EDGES = 384;
const MAX_SPLIT_EDGES = 4096;

function appendEdges(edges, points, closed) {
  if (!points) return;
  for (let index = 0; index < points.length - Number(!closed); index++) {
    edges.push([points[index], points[(index + 1) % points.length]]);
  }
}

function nearbyEdges(point, entities) {
  const edges = [];
  const shapes = [];
  for (const entity of entities) {
    if (entity.type === "line" && !entity.dimensionKind && !["dimensions", "text", "axes"].includes(entity.layer)) {
      edges.push([{ x: entity.x1, y: entity.y1 }, { x: entity.x2, y: entity.y2 }]);
    } else if (["polyline", "rectangle", "circle"].includes(entity.type)) {
      const bounds = entity.type === "polyline" ? polylineBounds(entity) : entityBounds(entity);
      if (!bounds) continue;
      const dx = Math.max(bounds.minX - point.x, point.x - bounds.maxX, 0);
      const dy = Math.max(bounds.minY - point.y, point.y - bounds.maxY, 0);
      if (Number.isFinite(dx) && Number.isFinite(dy)) shapes.push({ entity, distance: Math.hypot(dx, dy) });
    }
  }
  shapes.sort((a, b) => a.distance - b.distance);
  for (const { entity } of shapes.slice(0, MAX_NEARBY_EDGES)) {
    if (entity.type === "polyline") {
      const budget = Math.min(MAX_PLAN_ANNOTATION_POINTS, Math.max(64, 2 * entity.points.length));
      appendEdges(edges, tessellatePolyline(entity, budget), entity.closed);
    } else {
      appendEdges(edges, planAnnotationPointsFromEntity(entity), true);
    }
  }
  return edges.filter(([a, b]) => isLinePoint(a) && isLinePoint(b) && distanceWorld(a, b) > JOIN_TOLERANCE)
    .map(([a, b]) => ({ a, b, distance: pointToSegmentDistance(point, a, b) }))
    .sort((a, b) => a.distance - b.distance).slice(0, MAX_NEARBY_EDGES)
    .map(({ a, b }) => ({ a, b, line: { x1: a.x, y1: a.y, x2: b.x, y2: b.y },
      minX: Math.min(a.x, b.x), maxX: Math.max(a.x, b.x), minY: Math.min(a.y, b.y), maxY: Math.max(a.y, b.y), cuts: [0, 1] }));
}

function addEndpoint(edge, point) {
  const dx = edge.b.x - edge.a.x;
  const dy = edge.b.y - edge.a.y;
  const t = ((point.x - edge.a.x) * dx + (point.y - edge.a.y) * dy) / (dx * dx + dy * dy);
  if (t > 0 && t < 1 && pointToSegmentDistance(point, edge.a, edge.b) <= JOIN_TOLERANCE) edge.cuts.push(t);
}

function splitAtIntersections(edges) {
  edges.sort((a, b) => a.minX - b.minX);
  for (const [index, first] of edges.entries()) {
    for (let next = index + 1; next < edges.length; next++) {
      const second = edges[next];
      if (second.minX > first.maxX + JOIN_TOLERANCE) break;
      if (second.minY > first.maxY + JOIN_TOLERANCE || first.minY > second.maxY + JOIN_TOLERANCE) continue;
      const crossing = lineCrossing(first.line, second.line);
      if (crossing) {
        first.cuts.push(crossing.t);
        second.cuts.push(crossing.u);
      }
      addEndpoint(first, second.a);
      addEndpoint(first, second.b);
      addEndpoint(second, first.a);
      addEndpoint(second, first.b);
    }
  }
}

function buildGraph(edges) {
  const nodes = [];
  const cells = new Map();
  const edgeKeys = new Set();
  function nodeForPoint(point) {
    const cellX = Math.floor(point.x / JOIN_TOLERANCE);
    const cellY = Math.floor(point.y / JOIN_TOLERANCE);
    for (let x = cellX - 1; x <= cellX + 1; x++) {
      for (let y = cellY - 1; y <= cellY + 1; y++) {
        const existing = cells.get(`${x}:${y}`)?.find((node) => distanceWorld(node.point, point) <= JOIN_TOLERANCE);
        if (existing) return existing;
      }
    }
    const key = `${cellX}:${cellY}`;
    const node = { id: nodes.length, point, edges: [], degree: 0 };
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key).push(node);
    nodes.push(node);
    return node;
  }

  for (const { a, b, cuts } of edges) {
    cuts.sort((x, y) => x - y);
    let from = nodeForPoint(a);
    for (const t of cuts.slice(1)) {
      const to = nodeForPoint(t === 1 ? b : { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
      if (to === from) continue;
      const key = `${Math.min(from.id, to.id)}:${Math.max(from.id, to.id)}`;
      if (!edgeKeys.has(key)) {
        edgeKeys.add(key);
        if (edgeKeys.size > MAX_SPLIT_EDGES) return null;
        const forward = { from, to };
        const reverse = { from: to, to: from, twin: forward };
        forward.twin = reverse;
        from.edges.push(forward);
        to.edges.push(reverse);
        from.degree++;
        to.degree++;
      }
      from = to;
    }
  }
  return nodes;
}

function pruneDeadEnds(nodes) {
  const pending = nodes.filter((node) => node.degree === 1);
  while (pending.length) {
    const node = pending.pop();
    const edge = node.edges.find((candidate) => !candidate.removed);
    if (!edge) continue;
    edge.removed = edge.twin.removed = true;
    node.degree--;
    if (--edge.to.degree === 1) pending.push(edge.to);
  }
  for (const node of nodes) {
    node.edges = node.edges.filter((edge) => !edge.removed).sort((a, b) =>
      Math.atan2(a.to.point.y - node.point.y, a.to.point.x - node.point.x) -
      Math.atan2(b.to.point.y - node.point.y, b.to.point.x - node.point.x));
  }
}

function faceAt(start) {
  const ring = [];
  let edge = start;
  let twiceArea = 0;
  const origin = start.from.point;
  while (!edge.visited) {
    edge.visited = true;
    const a = edge.from.point;
    const b = edge.to.point;
    ring.push(a);
    twiceArea += (a.x - origin.x) * (b.y - origin.y) - (a.y - origin.y) * (b.x - origin.x);
    const neighbors = edge.to.edges;
    edge = neighbors[(neighbors.indexOf(edge.twin) + neighbors.length - 1) % neighbors.length];
  }
  return edge === start && twiceArea > 0 && ring.length >= 3 ? ring : null;
}

// Find the bounded face containing the tap after splitting boundaries at joins and crossings.
export function planRegionAtPoint(point, entities) {
  if (!isLinePoint(point)) return null;
  const edges = nearbyEdges(point, entities);
  splitAtIntersections(edges);
  const nodes = buildGraph(edges);
  if (!nodes) return null;
  pruneDeadEnds(nodes);
  let closest = null;
  for (const node of nodes) {
    for (const edge of node.edges) {
      if (edge.visited) continue;
      const ring = faceAt(edge);
      if (!ring || !pointInPolygon(point, ring)) continue;
      const geometry = planAnnotationGeometry({ type: "area", points: ring });
      if (geometry && (!closest || geometry.areaMm2 < closest.areaMm2)) closest = geometry;
    }
  }
  return closest?.points ?? null;
}
