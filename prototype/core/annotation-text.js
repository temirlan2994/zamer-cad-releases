export const ANNOTATION_LINE_SPACING = 1.2;
const REFERENCE_VIEW_SCALE = 0.085;

export function annotationScaleFactor(value) {
  return Math.min(1.8, Math.max(0.65, Number(value) || 1));
}

export function annotationWorldSize(referencePixels, scaleFactor) {
  return referencePixels * annotationScaleFactor(scaleFactor) / REFERENCE_VIEW_SCALE;
}

export function auxiliaryAnnotationSize(referencePixels, viewScale) {
  const zoom = Math.min(1.25, Math.max(0.72, Math.sqrt(viewScale / REFERENCE_VIEW_SCALE)));
  return referencePixels * zoom;
}

export function annotationTextLines(text) {
  return String(text || "Текст").split(/\r\n|\r|\n/u);
}

export function annotationTextWidth(lines, height) {
  const longest = lines.reduce((width, line) => Math.max(width, [...line].length), 0);
  return Math.max(height * 0.8, longest * height * 0.64);
}

export function leaderTextHeight(entity) {
  return Math.abs(entity.textHeight || entity.height || 200);
}

export function leaderAppearance(entity = {}) {
  const legacy = entity.leaderStyle || "boxed";
  const line = entity.leaderLine === "straight" || entity.leaderLine === "bent"
    ? entity.leaderLine : legacy === "landing" ? "bent" : "straight";
  const frame = typeof entity.leaderFrame === "boolean" ? entity.leaderFrame : legacy === "boxed";
  return { line, frame };
}

export function leaderFrameSize(height, textWidth, count, frame, spacing = ANNOTATION_LINE_SPACING) {
  const horizontalPadding = height * (frame ? 2 / 3 : 0.25);
  return {
    width: Math.max(height * 1.6, textWidth + horizontalPadding * 2),
    height: height * (1.7 + (count - 1) * spacing),
  };
}

export function leaderElbowPoint(entity) {
  const point = entity.leaderElbow;
  return Number.isFinite(point?.x) && Number.isFinite(point?.y) ? point : null;
}

function leaderLabelConnection(center, rect, dx, dy) {
  if (!dx && !dy) return center;
  const ratio = Math.min(dx ? Math.abs(rect.width / (2 * dx)) : Infinity, dy ? Math.abs(rect.height / (2 * dy)) : Infinity);
  return { x: center.x + dx * ratio, y: center.y + dy * ratio };
}

export function leaderPlanPath(arrow, rect, line, landingLength, elbow = null) {
  const center = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  const dx = arrow.x - center.x;
  const dy = arrow.y - center.y;
  if (line === "bent") {
    const side = (Number.isFinite(elbow?.x) ? elbow.x - center.x : dx) <= 0 ? -1 : 1;
    const edgeX = center.x + side * rect.width / 2;
    const bend = { x: Number.isFinite(elbow?.x) ? elbow.x : edgeX + side * landingLength, y: center.y };
    const connector = { x: Math.abs(bend.x - center.x) < rect.width / 2 ? center.x : edgeX, y: center.y };
    return [arrow, bend, connector];
  }
  return [arrow, leaderLabelConnection(center, rect, dx, dy)];
}
