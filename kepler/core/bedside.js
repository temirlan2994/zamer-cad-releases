// Быстрые прикроватные тумбы: геометрия двух мест у изголовья и связь
// комплекта. UI хранит общий bedsideSet у кровати и тумб, а обычное поле
// group заставляет комплект перемещаться, поворачиваться и удаляться вместе.

import { furnitureDef } from './catalog.js';

export const BEDSIDE_GAP = 50;

const BED_KINDS = new Set(['bed-double', 'bed-king', 'bed-queen', 'bed-single', 'kids-bed']);
const SIDES = new Set(['left', 'right']);

export function supportsBedsideNightstands(item) {
  return Boolean(item && BED_KINDS.has(item.kind));
}

// Локальные оси кровати: +X вправо, −Y к изголовью (там нарисованы подушки).
function localToPlan(item, x, y) {
  const a = ((item.rotation || 0) * Math.PI) / 180;
  const c = Math.cos(a); const s = Math.sin(a);
  return { x: item.x + x * c - y * s, y: item.y + x * s + y * c };
}

export function bedsideTarget(bed, side, { gap = BEDSIDE_GAP, w, h } = {}) {
  if (!supportsBedsideNightstands(bed) || !SIDES.has(side)) return null;
  const def = furnitureDef('nightstand');
  const nw = Number.isFinite(w) && w > 0 ? w : def.w;
  const nh = Number.isFinite(h) && h > 0 ? h : def.h;
  const sign = side === 'left' ? -1 : 1;
  const at = localToPlan(bed, sign * (bed.w / 2 + gap + nw / 2), -bed.h / 2 + nh / 2);
  return { side, x: Math.round(at.x), y: Math.round(at.y), w: nw, h: nh, rotation: bed.rotation || 0 };
}

// Тумба считается занятой стороной только внутри того же связанного комплекта.
// bedsideSet переживает сохранение и копирование, а group отделяет копию
// комплекта от исходника, даже если их bedsideSet пока одинаков.
export function bedsideNightstand(items, bed, side) {
  if (!bed?.bedsideSet || !SIDES.has(side)) return null;
  return (items || []).find((item) => item.kind === 'nightstand'
    && item.bedsideSet === bed.bedsideSet
    && item.bedsideSide === side
    && (bed.group ? item.group === bed.group : !item.group)) || null;
}

export function missingBedsideSpots(items, bed) {
  if (!supportsBedsideNightstands(bed)) return [];
  return ['left', 'right']
    .filter((side) => !bedsideNightstand(items, bed, side))
    .map((side) => bedsideTarget(bed, side));
}

