import { arcGeometry, distanceWorld, normalizeAnglePositive } from "./geometry.js";
import { boundaryCrossingPoints, extendLine, isLinePoint, isValidLine, nearestBoundaryPoint, splitLine, trimLine } from "./line-edits.js";
import { POLYLINE_ARC_GEOMETRY, polylineArcPoint, polylineSegments, validPolylinePoints } from "./polyline.js";

const EPSILON = 1e-6;
const FULL_TURN = 2 * Math.PI;
const FIGURES = new Set(["line", "polyline", "rectangle", "arc", "circle"]);

export function editableFigure(entity, mode) {
  if (!entity || entity.dimensionKind || entity.layer === "dimensions" || !FIGURES.has(entity.type)) return false;
  if (mode !== "extend") return true;
  return entity.type === "line" || entity.type === "arc" || (entity.type === "polyline" && !entity.closed);
}

export function validFigurePiece(piece) {
  if (piece.type === "polyline") return validPolylinePoints(piece.points, piece.closed, piece.bulges) && piece.points.every(isLinePoint);
  if (piece.type === "arc") {
    if (![piece.start, piece.through, piece.end].every(isLinePoint)) return false;
    return isLinePoint(arcGeometry(piece.start, piece.through, piece.end)?.center);
  }
  if (piece.type === "rectangle") return isValidLine(piece) && piece.x1 !== piece.x2 && piece.y1 !== piece.y2;
  return (!piece.type || piece.type === "line") && isValidLine(piece);
}

function segment(a, b) {
  return { x1: a.x, y1: a.y, x2: b.x, y2: b.y };
}

function rectanglePath({ x1, y1, x2, y2 }) {
  return {
    closed: true,
    points: [{ x: x1, y: y1 }, { x: x2, y: y1 }, { x: x2, y: y2 }, { x: x1, y: y2 }],
  };
}

function polylinePath(entity) {
  const polyline = entity.type === "rectangle" ? rectanglePath(entity) : entity;
  const edges = [];
  let length = 0;
  for (const edge of polylineSegments(polyline)) {
    const { p1, p2, arc } = edge;
    const curve = arc ? curvePath(arc, arc) : null;
    if (arc && !curve) return null;
    const edgeLength = curve?.length ?? distanceWorld(p1, p2);
    const geometry = arc ?? segment(p1, p2);
    edges.push({ ...edge, geometry, curve, offset: length, length: edgeLength });
    length += edgeLength;
  }
  if (!edges.length || !Number.isFinite(length)) return null;

  function atEdge(edge, offset) {
    if (offset <= EPSILON) return edge.p1;
    if (offset >= edge.length - EPSILON) return edge.p2;
    if (edge.curve) return edge.curve.at(offset);
    const ratio = offset / edge.length;
    return {
      x: edge.p1.x + (edge.p2.x - edge.p1.x) * ratio,
      y: edge.p1.y + (edge.p2.y - edge.p1.y) * ratio,
    };
  }

  function at(position) {
    const edge = edges.find(edge => position < edge.offset + edge.length) ?? edges.at(-1);
    return atEdge(edge, position - edge.offset);
  }

  return {
    length, edges, at, closed: polyline.closed,
    project(point) {
      let bestDistance = Infinity;
      let position = 0;
      for (const edge of edges) {
        const projected = nearestBoundaryPoint(point, [edge.geometry], Infinity);
        if (!projected) continue;
        const distance = distanceWorld(projected, point);
        if (distance >= bestDistance) continue;
        bestDistance = distance;
        position = edge.offset + (edge.curve ? edge.curve.position(projected) : distanceWorld(edge.p1, projected));
      }
      return position;
    },
    cuts(boundaries) {
      return edges.flatMap(({ p1, offset, geometry, curve }) => boundaryCrossingPoints(geometry, boundaries)
        .map(point => offset + (curve ? curve.position(point) : distanceWorld(p1, point))));
    },
    piece(from, to) {
      const points = [];
      const bulges = [];
      for (const turn of [0, length]) {
        for (const edge of edges) {
          const start = Math.max(0, from - edge.offset - turn);
          const end = Math.min(edge.length, to - edge.offset - turn);
          if (end - start <= EPSILON) continue;
          if (!points.length) points.push(atEdge(edge, start));
          points.push(atEdge(edge, end));
          const wholeEdge = start <= EPSILON && end >= edge.length - EPSILON;
          const sweep = edge.curve ? edge.arc.sweep * ((end - start) / edge.length) : 0;
          bulges.push(wholeEdge ? edge.bulge : Math.tan(sweep / 4));
        }
      }
      return makePolylinePiece(points, bulges);
    },
  };
}

function makePolylinePiece(points, bulges) {
  return { type: "polyline", closed: false, points, ...(bulges.some(Boolean) ? { bulges } : {}) };
}

function curvePath(entity, exactArc = entity[POLYLINE_ARC_GEOMETRY] ? entity : null) {
  const closed = entity.type === "circle";
  const arc = closed ? null : exactArc ?? arcGeometry(entity.start, entity.through, entity.end);
  if (!closed && !arc) return null;
  const center = closed ? { x: entity.cx, y: entity.cy } : arc.center;
  const radius = closed ? entity.radius : arc.radius;
  if (!center || !Number.isFinite(center.x) || !Number.isFinite(center.y) ||
      (!exactArc && !isLinePoint(center)) || !Number.isFinite(radius) || radius <= EPSILON) return null;
  const fullLength = FULL_TURN * radius;
  const startAngle = closed ? 0 : arc.startAngle;
  const direction = arc?.counterClockwise ? 1 : -1;
  const span = closed ? FULL_TURN : exactArc ? Math.abs(exactArc.sweep) : normalizeAnglePositive((arc.endAngle - startAngle) * direction);
  const length = span * radius;
  if (!Number.isFinite(length) || length <= EPSILON) return null;
  function position(point) {
    if (!closed && distanceWorld(point, entity.start) <= EPSILON) return 0;
    if (!closed && distanceWorld(point, entity.end) <= EPSILON) return length;
    return normalizeAnglePositive((Math.atan2(point.y - center.y, point.x - center.x) - startAngle) * direction) * radius;
  }
  function at(value) {
    if (value === 0 && arc) return entity.start;
    if (value === length && arc) return entity.end;
    if (exactArc && value > 0 && value < length) return polylineArcPoint(exactArc, value / length);
    const angle = startAngle + direction * (value / radius);
    return { x: center.x + radius * Math.cos(angle), y: center.y + radius * Math.sin(angle) };
  }
  return {
    length, fullLength, closed, at, direction, position,
    project(point) {
      const projected = nearestBoundaryPoint(point, [entity], Infinity);
      if (!projected || (!closed && distanceWorld(projected, entity.start) <= EPSILON)) return 0;
      if (!closed && distanceWorld(projected, entity.end) <= EPSILON) return length;
      return position(projected);
    },
    cuts(boundaries, extend = false) {
      const target = extend ? { type: "circle", cx: center.x, cy: center.y, radius } : entity;
      return boundaryCrossingPoints(target, boundaries).map(position).map(value => fullLength - value < EPSILON ? 0 : value);
    },
    piece(from, to) {
      return { type: "arc", start: at(from), through: at((from + to) / 2), end: at(to) };
    },
  };
}

function figurePath(entity) {
  return ["arc", "circle"].includes(entity.type) ? curvePath(entity) : polylinePath(entity);
}

export function projectFigurePoint(entity, point) {
  if (entity.type === "line") return nearestBoundaryPoint(point, [entity], Infinity);
  const path = figurePath(entity);
  return path ? path.at(path.project(point)) : null;
}

export function figureReferenceAt(entity, point) {
  if (entity.type === "polyline") {
    for (const { p1, p2, index, arc } of polylineSegments(entity)) {
      const onEdge = nearestBoundaryPoint(point, [arc ?? segment(p1, p2)], Infinity);
      if (onEdge && distanceWorld(point, onEdge) <= EPSILON) {
        const curve = arc && curvePath(arc, arc);
        if (arc && !curve) continue;
        const t = curve ? curve.position(onEdge) / curve.length : distanceWorld(p1, onEdge) / distanceWorld(p1, p2);
        return { pointKey: "edge-fraction", edge: index, t: Math.max(0, Math.min(1, t)) };
      }
    }
  } else if (entity.type === "arc") {
    const path = curvePath(entity);
    const position = path?.project(point);
    if (path && distanceWorld(point, path.at(position)) <= EPSILON) {
      return { pointKey: "arc-fraction", t: position / path.length };
    }
  }
  return null;
}

export function figureReferencePoint(entity, ref) {
  if (!Number.isFinite(ref.t) || ref.t < 0 || ref.t > 1) return null;
  if (entity.type === "arc" && ref.pointKey === "arc-fraction") {
    const path = curvePath(entity);
    return path?.at(path.length * ref.t) ?? null;
  }
  if (entity.type === "polyline" && ref.pointKey === "edge-fraction" && Number.isInteger(ref.edge)) {
    const edge = polylineSegments(entity)[ref.edge];
    if (!edge) return null;
    if (edge.arc) return polylineArcPoint(edge.arc, ref.t);
    return { x: edge.p1.x + (edge.p2.x - edge.p1.x) * ref.t, y: edge.p1.y + (edge.p2.y - edge.p1.y) * ref.t };
  }
  return null;
}

function retainedPieces(path, spans) {
  const pieces = spans.filter(([from, to]) => to - from > EPSILON).map(([from, to]) => path.piece(from, to));
  return pieces.every(validFigurePiece) ? pieces : null;
}

export function trimFigure(entity, boundaries, point) {
  if (entity.type === "line") return trimLine(entity, boundaries, point);
  const path = figurePath(entity);
  if (!path) return null;
  const pick = path.project(point);
  const cuts = path.cuts(boundaries)
    .map(cut => path.closed && path.length - cut <= EPSILON ? 0 : cut)
    .filter(cut => path.closed || (cut > EPSILON && cut < path.length - EPSILON))
    .sort((a, b) => a - b)
    .filter((cut, index, sorted) => index === 0 || cut - sorted[index - 1] > EPSILON);
  if (cuts.length < (path.closed ? 2 : 1) || cuts.some(cut => Math.abs(pick - cut) <= EPSILON ||
      (path.closed && path.length - Math.abs(pick - cut) <= EPSILON))) return null;
  const previous = cuts.findLast(cut => cut < pick);
  const following = cuts.find(cut => cut > pick);
  if (!path.closed) return retainedPieces(path, [[0, previous ?? 0], [following ?? path.length, path.length]]);
  const start = following ?? cuts[0];
  const end = previous ?? cuts.at(-1);
  return retainedPieces(path, [[start, end < start ? end + path.length : end]]);
}

export function extendFigure(entity, boundaries, point) {
  if (!editableFigure(entity, "extend")) return null;
  if (entity.type === "line") return extendLine(entity, boundaries, point);
  const path = figurePath(entity);
  if (!path) return null;
  const fromStart = path.project(point) < path.length / 2;
  if (entity.type === "polyline") {
    const edge = fromStart ? path.edges[0] : path.edges.at(-1);
    const points = entity.points.slice();
    const bulges = path.edges.map(({ bulge }) => bulge);
    const index = fromStart ? 0 : points.length - 1;
    if (edge.curve) {
      const span = extendedCurveSpan(edge.curve, boundaries, fromStart);
      if (!span) return null;
      points[index] = edge.curve.at(fromStart ? span[0] : span[1]);
      const sweep = edge.curve.direction * (span[1] - span[0]) / edge.arc.radius;
      bulges[edge.index] = Math.tan(sweep / 4);
    } else {
      const extended = extendLine(edge.geometry, boundaries, fromStart ? edge.p1 : edge.p2);
      if (!extended) return null;
      points[index] = fromStart ? { x: extended.x1, y: extended.y1 } : { x: extended.x2, y: extended.y2 };
    }
    const result = makePolylinePiece(points, bulges);
    return validFigurePiece(result) ? result : null;
  }
  const span = extendedCurveSpan(path, boundaries, fromStart);
  return span ? retainedPieces(path, [span])?.[0] ?? null : null;
}

function extendedCurveSpan(path, boundaries, fromStart) {
  const cuts = path.cuts(boundaries, true).filter(cut => cut > path.length + EPSILON && cut < path.fullLength - EPSILON);
  if (!cuts.length) return null;
  const closest = cuts.reduce((best, cut) => fromStart ? Math.max(best, cut) : Math.min(best, cut));
  return fromStart ? [closest - path.fullLength, path.length] : [0, closest];
}

export function splitFigure(entity, first, second = first) {
  if (entity.type === "line") return splitLine(entity, first, second);
  const path = figurePath(entity);
  if (!path) return null;
  const a = path.project(first);
  const b = path.project(second);
  if (path.closed) {
    if (Math.abs(a - b) <= EPSILON || path.length - Math.abs(a - b) <= EPSILON) return null;
    return retainedPieces(path, [[b, a < b ? a + path.length : a]]);
  }
  const start = Math.min(a, b);
  const end = Math.max(a, b);
  if (end - start <= EPSILON && (start <= EPSILON || end >= path.length - EPSILON)) return null;
  return retainedPieces(path, [[0, start], [end, path.length]]);
}
