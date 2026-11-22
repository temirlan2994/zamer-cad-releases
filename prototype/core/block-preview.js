import { normalizeCustomLineLayers } from "./line-layers.js";
import { buildProjectPreview } from "./project-preview.js";
import { reusableBlockBounds } from "./reusable-blocks.js";

export function buildBlockPreview(definition, { customLineLayers = [], width = 64, height = 48 } = {}) {
  const parts = definition?.parts;
  const bounds = reusableBlockBounds({ type: "block", kind: "reusable", x: 0, y: 0, parts });
  if (!bounds) return null;

  const layerColors = new Map(normalizeCustomLineLayers(customLineLayers).map(({ id, color }) => [id, color]));
  const groups = new Map();
  for (const part of parts) {
    const color = layerColors.get(part.layer);
    if (!groups.has(color)) groups.set(color, []);
    groups.get(color).push(part);
  }

  // The separate area trace supplies a common fit for every stroke color.
  const { minX, minY, maxX, maxY } = bounds;
  const fit = { type: "area", points: [{ x: minX, y: minY }, { x: maxX, y: minY }, { x: maxX, y: maxY }] };
  const paths = [];
  for (const [color, shapes] of groups) {
    const preview = buildProjectPreview({ entities: [...shapes, fit] }, { width, height });
    for (const path of preview?.paths ?? []) {
      if (path.tone === "geometry") paths.push({ d: path.d, ...(color ? { color } : {}) });
    }
  }
  return paths.length ? { viewBox: `0 0 ${width} ${height}`, paths } : null;
}
