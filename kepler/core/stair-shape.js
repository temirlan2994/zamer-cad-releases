// Независимые края ступеней в локальных осях лестницы. Смещения сохраняют
// форму при изменении общего размера, положения или поворота лестницы.
export const STAIR_EDGES = ['left', 'right', 'back', 'front'];
export const STAIR_HEIGHT_EDGES = ['upper', 'lower'];
export const STAIR_MIN_THICKNESS = 20;
const finite = (v) => Number.isFinite(Number(v)) ? Number(v) : 0;
export function stairRect(base, edits = {}) {
  const out = Object.fromEntries(STAIR_EDGES.map((edge) => [edge, base[edge] + Math.max(-48000, Math.min(48000, finite(edits?.[edge])))]));
  out.right = Math.max(out.left + 100, Math.min(out.left + 24000, out.right));
  out.front = Math.max(out.back + 100, Math.min(out.back + 24000, out.front));
  return out;
}
export function stairRectPolygon(rect, origin, xAxis, yAxis) {
  return [[rect.left, rect.back], [rect.right, rect.back], [rect.right, rect.front], [rect.left, rect.front]]
    .map(([x, y]) => ({ x: origin.x + xAxis.x * x + yAxis.x * y, y: origin.y + xAxis.y * x + yAxis.y * y }));
}

// Верх и низ независимы от контура и от соседних ступеней. Старые проекты
// без правок высоты сохраняют исходную геометрию, включая нулевой подъём.
export function stairHeights(base, edits = {}) {
  const offsets = Object.fromEntries(STAIR_HEIGHT_EDGES.map((edge) => [edge, Math.max(-48000, Math.min(48000, finite(edits?.[edge])))]));
  if (!offsets.upper && !offsets.lower) return { ...base };
  const lower = base.lower + offsets.lower;
  const upper = Math.max(lower + STAIR_MIN_THICKNESS, Math.min(lower + 24000, base.upper + offsets.upper));
  return { lower, upper };
}
