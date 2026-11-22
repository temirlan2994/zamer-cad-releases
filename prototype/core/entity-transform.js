function scalePoint(point, base, factor) {
  return {
    x: base.x + (point.x - base.x) * factor,
    y: base.y + (point.y - base.y) * factor,
  };
}

function rotatePoint(point, base, radians) {
  const dx = point.x - base.x;
  const dy = point.y - base.y;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return {
    x: base.x + dx * cos - dy * sin,
    y: base.y + dx * sin + dy * cos,
  };
}

function normalizeDegrees(value) {
  return ((value % 360) + 360) % 360;
}

const pointKeys = [
  "start", "through", "end", "vertex", "arm1", "arm2", "arcStart", "arcThrough", "arcEnd",
  "jogCenter", "jogRim", "measureEnd", "radialRim", "leaderElbow",
];

const coordinatePairs = [
  ["x1", "y1"], ["x2", "y2"], ["dimX1", "dimY1"], ["dimX2", "dimY2"],
  ["x", "y"], ["cx", "cy"],
];

/** Возвращает независимую копию объекта, масштабированную относительно базовой точки. */
export function scaleStoredEntity(entity, base, factor) {
  if (!entity || !Number.isFinite(base?.x) || !Number.isFinite(base?.y) ||
      !Number.isFinite(factor) || factor <= 0) return null;
  let copy;
  try {
    copy = JSON.parse(JSON.stringify(entity));
  } catch {
    return null;
  }

  for (const key of pointKeys) {
    if (Number.isFinite(copy[key]?.x) && Number.isFinite(copy[key]?.y)) copy[key] = scalePoint(copy[key], base, factor);
  }
  for (const [xKey, yKey] of coordinatePairs) {
    if (!Number.isFinite(copy[xKey]) || !Number.isFinite(copy[yKey])) continue;
    const point = scalePoint({ x: copy[xKey], y: copy[yKey] }, base, factor);
    copy[xKey] = point.x;
    copy[yKey] = point.y;
  }
  if (Array.isArray(copy.points)) copy.points = copy.points.map((point) => scalePoint(point, base, factor));
  if (Array.isArray(copy.contours)) {
    copy.contours = copy.contours.map((ring) => ring.map((point) => scalePoint(point, base, factor)));
    copy.points = copy.contours[0];
  }

  if (copy.type === "circle") copy.radius *= factor;
  if (copy.type === "wall" && Number.isFinite(copy.width)) copy.width *= factor;
  if (copy.type === "block") {
    if (Number.isFinite(copy.width)) copy.width *= factor;
    if (Number.isFinite(copy.height)) copy.height *= factor;
    if (copy.kind === "reusable") copy.scale = (copy.scale ?? 1) * factor;
  }
  if (copy.type === "text" && Number.isFinite(copy.height)) copy.height *= factor;
  for (const key of ["offset", "textHeight", "arcRadius", "circleRadius"]) {
    if (Number.isFinite(copy[key])) copy[key] *= factor;
  }
  return copy;
}

/** Возвращает независимую копию объекта, повёрнутую относительно базовой точки. */
export function rotateStoredEntity(entity, base, radians) {
  if (!entity || !Number.isFinite(base?.x) || !Number.isFinite(base?.y) || !Number.isFinite(radians)) return null;
  let copy;
  try {
    copy = JSON.parse(JSON.stringify(entity));
  } catch {
    return null;
  }

  if (copy.type === "rectangle" && [copy.x1, copy.y1, copy.x2, copy.y2].every(Number.isFinite)) {
    copy.type = "polyline";
    copy.points = [
      { x: copy.x1, y: copy.y1 }, { x: copy.x2, y: copy.y1 },
      { x: copy.x2, y: copy.y2 }, { x: copy.x1, y: copy.y2 },
    ].map((point) => rotatePoint(point, base, radians));
    copy.closed = true;
    delete copy.x1;
    delete copy.y1;
    delete copy.x2;
    delete copy.y2;
    return copy;
  }

  for (const key of pointKeys) {
    if (Number.isFinite(copy[key]?.x) && Number.isFinite(copy[key]?.y)) copy[key] = rotatePoint(copy[key], base, radians);
  }
  for (const [xKey, yKey] of coordinatePairs) {
    if (!Number.isFinite(copy[xKey]) || !Number.isFinite(copy[yKey])) continue;
    const point = rotatePoint({ x: copy[xKey], y: copy[yKey] }, base, radians);
    copy[xKey] = point.x;
    copy[yKey] = point.y;
  }
  if (Array.isArray(copy.points)) copy.points = copy.points.map((point) => rotatePoint(point, base, radians));
  if (Array.isArray(copy.contours)) {
    copy.contours = copy.contours.map((ring) => ring.map((point) => rotatePoint(point, base, radians)));
    copy.points = copy.contours[0];
  }
  if (["block", "text"].includes(copy.type)) {
    copy.rotation = normalizeDegrees((copy.rotation || 0) + radians * 180 / Math.PI);
  }
  return copy;
}
