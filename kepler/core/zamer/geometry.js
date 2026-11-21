// Pure geometry/angle math. No DOM, no app state — safe to unit test and reuse
// in any future target (Flutter/Kotlin port, server-side export, tests).

export function radToDeg(angleRad) {
  return (angleRad * 180) / Math.PI;
}

export function degToRad(angleDeg) {
  return (angleDeg * Math.PI) / 180;
}

export function normalizeDegrees(degrees) {
  return ((degrees % 360) + 360) % 360;
}

export function normalizeAnglePositive(angleRad) {
  const full = Math.PI * 2;
  return ((angleRad % full) + full) % full;
}

// Returns the two parallel edges of a wall centerline offset by `distance`
// on each side. Used for two-line wall rendering and DXF export.
export function offsetWall(entity, distance) {
  const dx = entity.x2 - entity.x1;
  const dy = entity.y2 - entity.y1;
  const length = Math.hypot(dx, dy) || 1;
  const nx = (-dy / length) * distance;
  const ny = (dx / length) * distance;
  return {
    a: { x1: entity.x1 + nx, y1: entity.y1 + ny, x2: entity.x2 + nx, y2: entity.y2 + ny },
    b: { x1: entity.x1 - nx, y1: entity.y1 - ny, x2: entity.x2 - nx, y2: entity.y2 - ny },
  };
}

// Transforms a local block-space point (x, y) into world coordinates,
// applying the block's rotation (degrees) and translation.
export function transformBlockPoint(entity, x, y) {
  const radians = (entity.rotation * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return {
    x: entity.x + x * cos - y * sin,
    y: entity.y + x * sin + y * cos,
  };
}

export function distanceWorld(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function angleBetweenPoints(a, b) {
  return Math.atan2(b.y - a.y, b.x - a.x);
}

// Circle through three points -> arc descriptor (center, radius, start/end
// angles, winding). Returns null for (near-)collinear points. Shared by the
// renderer and DXF export so the drawn arc and the exported arc stay identical.
export function arcGeometry(start, through, end) {
  const d = 2 * (start.x * (through.y - end.y) + through.x * (end.y - start.y) + end.x * (start.y - through.y));
  if (Math.abs(d) < 0.001) return null;
  const startSq = start.x * start.x + start.y * start.y;
  const throughSq = through.x * through.x + through.y * through.y;
  const endSq = end.x * end.x + end.y * end.y;
  const center = {
    x: (startSq * (through.y - end.y) + throughSq * (end.y - start.y) + endSq * (start.y - through.y)) / d,
    y: (startSq * (end.x - through.x) + throughSq * (start.x - end.x) + endSq * (through.x - start.x)) / d,
  };
  const radius = distanceWorld(center, start);
  const startAngle = angleBetweenPoints(center, start);
  const throughAngle = angleBetweenPoints(center, through);
  const endAngle = angleBetweenPoints(center, end);
  const ccwSpan = normalizeAnglePositive(endAngle - startAngle);
  const ccwThrough = normalizeAnglePositive(throughAngle - startAngle);
  return { center, radius, startAngle, endAngle, counterClockwise: ccwThrough <= ccwSpan };
}

// --- Measurement & hit-testing primitives (pure predicates) ---

// length (rounded mm) + angle (rounded deg, 0..359) of a segment.
export function segmentMetrics(x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const length = Math.round(Math.hypot(dx, dy));
  let angle = Math.round((Math.atan2(dy, dx) * 180) / Math.PI);
  if (angle < 0) angle += 360;
  return { length, angle };
}

export function normalizeScreenVector(dx, dy, fallbackX, fallbackY) {
  const length = Math.hypot(dx, dy);
  if (length < 0.5) return { x: fallbackX, y: fallbackY };
  return { x: dx / length, y: dy / length };
}

// Axis-aligned bounding box of any entity, in world coordinates.
export function entityBounds(entity) {
  if (entity.layer === "dimensions" && entity.type === "line") {
    if (entity.dimensionKind === "angular") {
      const radius = Math.max(distanceWorld(entity.vertex, entity.arm1), distanceWorld(entity.vertex, entity.arm2));
      return {minX:entity.vertex.x-radius, maxX:entity.vertex.x+radius, minY:entity.vertex.y-radius, maxY:entity.vertex.y+radius};
    }
    const points = [{x:entity.x1,y:entity.y1}, {x:entity.x2,y:entity.y2}];
    if ([entity.dimX1, entity.dimY1, entity.dimX2, entity.dimY2].every(Number.isFinite)) {
      points.push({x:entity.dimX1,y:entity.dimY1}, {x:entity.dimX2,y:entity.dimY2});
    } else if (entity.dimensionKind !== "leader") {
      const length = Math.hypot(entity.x2-entity.x1, entity.y2-entity.y1) || 1;
      const offset = entity.offset ?? 360;
      const dx = -(entity.y2-entity.y1)/length*offset, dy = (entity.x2-entity.x1)/length*offset;
      points.push({x:entity.x1+dx,y:entity.y1+dy}, {x:entity.x2+dx,y:entity.y2+dy});
    }
    return {minX:Math.min(...points.map(p=>p.x)), maxX:Math.max(...points.map(p=>p.x)), minY:Math.min(...points.map(p=>p.y)), maxY:Math.max(...points.map(p=>p.y))};
  }
  if (entity.type === "text") {
    const height = Math.max(1, Math.abs(entity.height || 260));
    const width = Math.max(height * 0.8, String(entity.text || "").length * height * 0.58);
    return { minX: entity.x, maxX: entity.x + width, minY: entity.y - height, maxY: entity.y };
  }
  if (entity.type === "circle") return { minX: entity.cx - entity.radius, maxX: entity.cx + entity.radius, minY: entity.cy - entity.radius, maxY: entity.cy + entity.radius };
  if (entity.type === "rectangle") return { minX: Math.min(entity.x1, entity.x2), maxX: Math.max(entity.x1, entity.x2), minY: Math.min(entity.y1, entity.y2), maxY: Math.max(entity.y1, entity.y2) };
  if (entity.type === "arc") { const pts = [entity.start, entity.through, entity.end]; return { minX: Math.min(...pts.map((p) => p.x)), maxX: Math.max(...pts.map((p) => p.x)), minY: Math.min(...pts.map((p) => p.y)), maxY: Math.max(...pts.map((p) => p.y)) }; }
  return { minX: Math.min(entity.x1, entity.x2), maxX: Math.max(entity.x1, entity.x2), minY: Math.min(entity.y1, entity.y2), maxY: Math.max(entity.y1, entity.y2) };
}

export function pointInSelectionRect(point, rect) {
  return point.x >= rect.minX && point.x <= rect.maxX && point.y >= rect.minY && point.y <= rect.maxY;
}

export function rectEdges(rect) {
  const a = { x: rect.minX, y: rect.minY };
  const b = { x: rect.maxX, y: rect.minY };
  const c = { x: rect.maxX, y: rect.maxY };
  const d = { x: rect.minX, y: rect.maxY };
  return [[a, b], [b, c], [c, d], [d, a]];
}

// Robust segment-segment intersection (handles collinear/touching cases).
export function segmentsIntersect(a, b, c, d) {
  const direction = (p, q, r) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const onSegment = (p, q, r) =>
    Math.min(p.x, q.x) <= r.x + 0.001 &&
    r.x <= Math.max(p.x, q.x) + 0.001 &&
    Math.min(p.y, q.y) <= r.y + 0.001 &&
    r.y <= Math.max(p.y, q.y) + 0.001;
  const d1 = direction(a, b, c);
  const d2 = direction(a, b, d);
  const d3 = direction(c, d, a);
  const d4 = direction(c, d, b);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
  return (
    (Math.abs(d1) < 0.001 && onSegment(a, b, c)) ||
    (Math.abs(d2) < 0.001 && onSegment(a, b, d)) ||
    (Math.abs(d3) < 0.001 && onSegment(c, d, a)) ||
    (Math.abs(d4) < 0.001 && onSegment(c, d, b))
  );
}

// Even-odd ray-casting point-in-polygon test.
export function pointInPolygon(point, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const a = polygon[i];
    const b = polygon[j];
    const crosses = a.y > point.y !== b.y > point.y;
    if (crosses && point.x < ((b.x - a.x) * (point.y - a.y)) / ((b.y - a.y) || 1) + a.x) inside = !inside;
  }
  return inside;
}

export function pointToSegmentDistance(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq));
  const x = a.x + t * dx;
  const y = a.y + t * dy;
  return Math.hypot(p.x - x, p.y - y);
}
