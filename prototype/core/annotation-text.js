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

export function leaderPlanPath(arrow, rect, line, landingLength) {
  const center = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  const dx = arrow.x - center.x;
  const dy = arrow.y - center.y;
  if (!dx && !dy) return [arrow, center];
  const side = dx < 0 ? -1 : 1;
  const horizontalGap = Math.abs(dx) - rect.width / 2;

  if (line === "bent" && horizontalGap > 0) {
    const connector = { x: center.x + side * rect.width / 2, y: center.y };
    const elbow = { x: connector.x + side * Math.min(landingLength, horizontalGap), y: center.y };
    return [arrow, elbow, connector];
  }
  const verticalGap = Math.abs(dy) - rect.height / 2;
  if (line === "bent" && verticalGap > 0) {
    const side = dy < 0 ? -1 : 1;
    const connector = { x: center.x, y: center.y + side * rect.height / 2 };
    const elbow = { x: center.x, y: connector.y + side * Math.min(landingLength, verticalGap) };
    return [arrow, elbow, connector];
  }

  const ratio = Math.min(dx ? Math.abs(rect.width / (2 * dx)) : Infinity, dy ? Math.abs(rect.height / (2 * dy)) : Infinity);
  return [arrow, { x: center.x + dx * ratio, y: center.y + dy * ratio }];
}
