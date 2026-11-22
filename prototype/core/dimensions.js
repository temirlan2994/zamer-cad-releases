const POINT_EPSILON = 1e-6;

function finitePoint(point) {
  return Number.isFinite(point?.x) && Number.isFinite(point?.y);
}

function unitBetween(start, end) {
  const x = end.x - start.x;
  const y = end.y - start.y;
  const length = Math.hypot(x, y);
  return Number.isFinite(length) && length > POINT_EPSILON ? { x: x / length, y: y / length } : null;
}

function namedAxis(name) {
  if (name === "x") return { x: 1, y: 0 };
  if (name === "y") return { x: 0, y: 1 };
  return null;
}

function signedOffset(start, lineStart, axis) {
  return -(lineStart.x - start.x) * axis.y + (lineStart.y - start.y) * axis.x;
}

function geometryAlongAxis(start, end, axis, offset, mode, measurementAxis = null) {
  const projected = (end.x - start.x) * axis.x + (end.y - start.y) * axis.y;
  const measurement = mode === "aligned" ? Math.hypot(end.x - start.x, end.y - start.y) : Math.abs(projected);
  const lineStart = { x: start.x - axis.y * offset, y: start.y + axis.x * offset };
  const lineEnd = mode === "aligned"
    ? { x: end.x - axis.y * offset, y: end.y + axis.x * offset }
    : { x: lineStart.x + axis.x * projected, y: lineStart.y + axis.y * projected };
  if (!finitePoint(lineStart) || !finitePoint(lineEnd) || !Number.isFinite(measurement)) return null;
  return { start, end, lineStart, lineEnd, offset, measurement, mode, measurementAxis, axis };
}

// Stored endpoints are the measured features. The dimension line is derived
// from a signed distance and either their direction or a fixed X/Y axis.
export function dimensionGeometry(entity) {
  if (!entity || entity.dimensionKind === "angular" || entity.dimensionKind === "leader") return null;
  const start = { x: entity.x1, y: entity.y1 };
  const end = { x: entity.x2, y: entity.y2 };
  if (!finitePoint(start) || !finitePoint(end)) return null;
  const alignedAxis = unitBetween(start, end);
  const storedOffset = Number.isFinite(entity.offset) ? entity.offset : 360;
  if (entity.measurementType === "linear" && namedAxis(entity.measurementAxis)) {
    return geometryAlongAxis(start, end, namedAxis(entity.measurementAxis), storedOffset, "linear", entity.measurementAxis);
  }
  if (entity.measurementType === "aligned") {
    return geometryAlongAxis(start, end, alignedAxis ?? { x: 1, y: 0 }, storedOffset, "aligned");
  }

  const lineStart = { x: entity.dimX1, y: entity.dimY1 };
  const lineEnd = { x: entity.dimX2, y: entity.dimY2 };
  const lineAxis = finitePoint(lineStart) && finitePoint(lineEnd) ? unitBetween(lineStart, lineEnd) : null;
  if (!lineAxis) {
    const axis = alignedAxis ?? { x: 1, y: 0 };
    const offset = finitePoint(lineStart) ? signedOffset(start, lineStart, axis) : storedOffset;
    return geometryAlongAxis(start, end, axis, offset, "aligned");
  }
  // Older records do not identify the kind. Keep their anchors exactly as
  // saved and infer a kind for future changes to their referenced points.
  const parallel = alignedAxis && Math.abs(alignedAxis.x * lineAxis.y - alignedAxis.y * lineAxis.x) < 1e-8;
  const measurementAxis = !parallel && Math.abs(lineAxis.y) < 1e-8 ? "x" : !parallel && Math.abs(lineAxis.x) < 1e-8 ? "y" : null;
  const mode = parallel ? "aligned" : measurementAxis ? "linear" : "legacy";
  const axis = parallel ? alignedAxis : namedAxis(measurementAxis) ?? lineAxis;
  return {
    start, end, lineStart, lineEnd, axis, mode, measurementAxis,
    offset: signedOffset(start, lineStart, axis),
    measurement: Math.hypot(lineEnd.x - lineStart.x, lineEnd.y - lineStart.y),
  };
}

export function formatDimensionLength(geometryOrLength) {
  const length = typeof geometryOrLength === "number" ? geometryOrLength : geometryOrLength?.measurement;
  return Number.isFinite(length) ? String(Math.round(length)) : "";
}

export function angularDimensionGeometry(entity) {
  const { vertex, arm1, arm2 } = entity ?? {};
  if (![vertex, arm1, arm2].every(finitePoint)) return null;
  const first = unitBetween(vertex, arm1);
  const second = unitBetween(vertex, arm2);
  if (!first || !second) return null;
  const startAngle = Math.atan2(first.y, first.x);
  const sweep = Math.atan2(first.x * second.y - first.y * second.x, first.x * second.x + first.y * second.y);
  return { vertex, arm1, arm2, startAngle, sweep, measurement: Math.abs(sweep) * 180 / Math.PI };
}
