// Furniture/symbol block sizing and footprint geometry. Pure domain logic.

import { transformBlockPoint } from "./geometry.js";

export const DEFAULT_BLOCK_SIZE = {
  sofa: { width: 2200, height: 950 },
  sectional: { width: 2600, height: 1600 },
  bed: { width: 1800, height: 2000 },
  table: { width: 1400, height: 800 },
  chair: { width: 550, height: 550 },
  cabinet: { width: 1200, height: 550 },
  tv: { width: 1600, height: 420 },
  door: { width: 900, height: 900 },
  window: { width: 1800, height: 180 },
  sink: { width: 600, height: 500 },
  toilet: { width: 700, height: 450 },
  tub: { width: 1700, height: 750 },
  lamp: { width: 450, height: 450 },
};

const FALLBACK_BLOCK_SIZE = { width: 900, height: 900 };

export function defaultBlockSize(kind) {
  return DEFAULT_BLOCK_SIZE[kind] || FALLBACK_BLOCK_SIZE;
}

export function entitySize(entity) {
  const fallback = defaultBlockSize(entity.kind);
  return {
    width: entity.width || fallback.width,
    height: entity.height || fallback.height,
  };
}

// Four world-space edges of the block's rectangular footprint.
export function blockSegments(entity) {
  const size = entitySize(entity);
  const w = size.width;
  const h = size.height;
  const corners = [
    transformBlockPoint(entity, -w / 2, -h / 2),
    transformBlockPoint(entity, w / 2, -h / 2),
    transformBlockPoint(entity, w / 2, h / 2),
    transformBlockPoint(entity, -w / 2, h / 2),
  ];
  return [
    { x1: corners[0].x, y1: corners[0].y, x2: corners[1].x, y2: corners[1].y },
    { x1: corners[1].x, y1: corners[1].y, x2: corners[2].x, y2: corners[2].y },
    { x1: corners[2].x, y1: corners[2].y, x2: corners[3].x, y2: corners[3].y },
    { x1: corners[3].x, y1: corners[3].y, x2: corners[0].x, y2: corners[0].y },
  ];
}
