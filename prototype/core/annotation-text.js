export const ANNOTATION_LINE_SPACING = 1.2;
const REFERENCE_VIEW_SCALE = 0.085;

export const ANNOTATION_SCALE_PRESETS = [
  { denominator: 10, factor: 0.65 },
  { denominator: 20, factor: 0.72 },
  { denominator: 25, factor: 0.76 },
  { denominator: 50, factor: 0.85 },
  { denominator: 75, factor: 0.93 },
  { denominator: 100, factor: 1 },
  { denominator: 150, factor: 1.15 },
  { denominator: 200, factor: 1.3 },
  { denominator: 250, factor: 1.4 },
  { denominator: 500, factor: 1.55 },
  { denominator: 1000, factor: 1.7 },
  { denominator: 2000, factor: 1.8 },
];

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

function wrapAnnotationLine(line, maxCharacters) {
  if (line.length <= maxCharacters) return [line];
  const result = [];
  let rest = line;
  while (rest.length > maxCharacters) {
    const slice = rest.slice(0, maxCharacters + 1);
    const breakAt = Math.max(slice.lastIndexOf(" "), slice.lastIndexOf("\t"));
    const take = breakAt > 0 ? breakAt : maxCharacters;
    result.push(rest.slice(0, take).trimEnd());
    rest = rest.slice(take).trimStart();
  }
  result.push(rest);
  return result;
}

export function annotationTextLines(text, width = null, height = null) {
  const explicit = String(text || "Текст").split(/\r\n|\r|\n/u);
  if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) return explicit;
  const maxCharacters = Math.max(1, Math.floor(width / (height * 0.64)));
  return explicit.flatMap((line) => wrapAnnotationLine(line, maxCharacters));
}

export function annotationTextWidth(lines, height) {
  const longest = lines.reduce((width, line) => Math.max(width, [...line].length), 0);
  return Math.max(height * 0.8, longest * height * 0.64);
}

export function textBlockLayout(entity = {}) {
  const height = Math.max(1, Math.abs(entity.height || 260));
  const constrainedWidth = Number.isFinite(entity.textWidth) && entity.textWidth > 0 ? entity.textWidth : null;
  const lines = annotationTextLines(entity.text, constrainedWidth, height);
  return {
    height,
    lines,
    width: constrainedWidth ?? annotationTextWidth(lines, height),
    frame: Boolean(entity.textFrame),
  };
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
    const offset = Number.isFinite(elbow?.x) ? elbow.x - center.x : 0;
    const side = Math.sign(dx) || Math.sign(offset) || -1;
    const halfWidth = rect.width / 2;
    const distance = Math.abs(offset);
    const edgeX = center.x + side * halfWidth;
    const bendX = distance > halfWidth
      ? (Math.sign(offset) === side ? elbow.x : 2 * center.x - elbow.x)
      : edgeX + side * landingLength;
    const bend = { x: bendX, y: center.y };
    const connector = { x: edgeX, y: center.y };
    return [arrow, bend, connector];
  }
  return [arrow, leaderLabelConnection(center, rect, dx, dy)];
}
