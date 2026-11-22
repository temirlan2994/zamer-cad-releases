// Reference points use the same length, angle and snapping as ordinary lines.
// Saved geometry stays on the wall axis for rendering, editing and DXF export.
export function wallFromReference(id, start, end, settings = {}) {
  const width = Math.min(2000, Math.max(20, Number(settings.width) || 180));
  const length = Math.hypot(end.x - start.x, end.y - start.y);
  if (!Number.isFinite(length) || length < 0.001) return null;
  const side = settings.flipped ? -1 : 1;
  const shift = settings.location === "left" ? -width / 2 : settings.location === "right" ? width / 2 : 0;
  const offset = (Number(settings.offset) || 0) + shift * side;
  const nx = -(end.y - start.y) / length;
  const ny = (end.x - start.x) / length;
  return { id, type: "wall", layer: "walls", width,
    x1: start.x + nx * offset, y1: start.y + ny * offset,
    x2: end.x + nx * offset, y2: end.y + ny * offset };
}
