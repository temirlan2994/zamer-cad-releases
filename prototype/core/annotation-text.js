export const ANNOTATION_LINE_SPACING = 1.2;

export function annotationTextLines(text) {
  return String(text || "Текст").split(/\r\n|\r|\n/u);
}

export function annotationTextWidth(lines, height) {
  const longest = lines.reduce((width, line) => Math.max(width, [...line].length), 0);
  return Math.max(height * 0.8, longest * height * 0.64);
}

export function leaderPlanPath(arrow, rect, style, landingLength) {
  const center = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  const dx = arrow.x - center.x;
  const dy = arrow.y - center.y;
  if (!dx && !dy) return [arrow, center];
  const side = dx < 0 ? -1 : 1;
  const horizontalGap = Math.abs(dx) - rect.width / 2;

  if (style === "landing" && horizontalGap > 0) {
    const connector = { x: center.x + side * rect.width / 2, y: center.y };
    const elbow = { x: connector.x + side * Math.min(landingLength, horizontalGap), y: center.y };
    return [arrow, elbow, connector];
  }

  const ratio = Math.min(dx ? Math.abs(rect.width / (2 * dx)) : Infinity, dy ? Math.abs(rect.height / (2 * dy)) : Infinity);
  return [arrow, { x: center.x + dx * ratio, y: center.y + dy * ratio }];
}
