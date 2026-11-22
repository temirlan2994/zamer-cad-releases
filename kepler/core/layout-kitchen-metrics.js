// Доказуемые 2D-метрики кухни для реестра правил авторасстановки.
//
// Модуль намеренно не делает выводов о высоте, паспортах техники, свободной
// столешнице или траекториях створок: таких данных в обычной модели Kepler
// нет. Метрика отсутствует, если геометрия неполна или фронт нельзя надежно
// восстановить. Это сохраняет политику unknown вместо ложного pass.

import { isStructural } from './catalog.js';
import { itemShapes } from './clearance.js';
import { roomRects } from './room-shape.js';

export const KITCHEN_PHYSICAL_KINDS = Object.freeze([
  'kitchen-row', 'kitchen-corner', 'kitchen-u', 'kitchen-island',
  'stove', 'cooktop-hood', 'sink', 'bar-counter', 'oven', 'microwave',
  'dishwasher', 'fridge', 'fridge-side', 'pantry',
]);

const KITCHEN_KIND_SET = new Set(KITCHEN_PHYSICAL_KINDS);
const WORK_FRONT_KINDS = new Set([
  'kitchen-row', 'kitchen-corner', 'kitchen-u', 'kitchen-island',
  'stove', 'cooktop-hood', 'sink', 'oven', 'dishwasher',
  'fridge', 'fridge-side', 'pantry',
]);
const COMPOSITE_FRONT_KINDS = new Set(['kitchen-corner', 'kitchen-u']);
const EPS = 1e-6;

const finite = (value) => Number.isFinite(Number(value));
const round = (value) => Math.round(value * 1000) / 1000;
const overlapLength = (a0, a1, b0, b1) => Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
const overlapArea = (a, b) => overlapLength(a.x, a.x + a.w, b.x, b.x + b.w)
  * overlapLength(a.y, a.y + a.h, b.y, b.y + b.h);
const rectGap = (a, b) => Math.hypot(
  Math.max(a.x - (b.x + b.w), b.x - (a.x + a.w), 0),
  Math.max(a.y - (b.y + b.h), b.y - (a.y + a.h), 0),
);
const validRect = (rect) => rect && finite(rect.x) && finite(rect.y)
  && finite(rect.w) && finite(rect.h) && Number(rect.w) > 0 && Number(rect.h) > 0;

function normalizedCardinal(rotation) {
  const angle = ((Number(rotation) % 360) + 360) % 360;
  const cardinal = Math.round(angle / 90) * 90 % 360;
  return Math.abs(angle - cardinal) <= 1e-6 ? cardinal : null;
}
function posedEntries(items, records) {
  const strictRecords = Array.isArray(records);
  const byId = new Map();
  if (strictRecords) {
    for (const record of records) {
      if (!record?.itemId || byId.has(record.itemId)) return null;
      byId.set(record.itemId, record);
    }
    if (records.length !== items.length || items.some((item) => !byId.has(item.id))) return null;
  }
  return (items || []).map((item) => {
    const record = strictRecords ? byId.get(item.id) : null;
    const posed = record ? {
      ...item,
      x: record.x,
      y: record.y,
      rotation: record.rotation,
    } : item;
    // В runtime запись валидатора является единственным доказательством
    // фактически проверенной позы. Не подменяем отсутствующие shapes
    // номинальным контуром исходного item.
    const shapes = strictRecords ? record?.shapes : itemShapes(posed);
    return {
      id: item.id,
      kind: item.kind,
      item: posed,
      shapes: Array.isArray(shapes) ? shapes.map((shape) => ({ ...shape })) : [],
    };
  });
}

function hasVerifiedPlanProjection(entry) {
  const item = entry.item;
  if (item.planProjectionVerified !== true) return false;
  if (item.geometryStatus === 'parametric_custom') return true;
  return item.geometryStatus === 'verified_sku'
    && typeof item.sku === 'string' && item.sku.trim().length > 0
    && typeof item.sourceUrl === 'string' && item.sourceUrl.trim().length > 0;
}

function frontOf(entry) {
  const { item, shapes } = entry;
  if (COMPOSITE_FRONT_KINDS.has(entry.kind)) return null;
  // Г-/П-образный или иной составной контур нельзя заменять габаритным
  // прямоугольником: его рабочие фронты должны быть переданы явно в будущем.
  if (shapes.length !== 1 || !validRect(shapes[0])) return null;
  const rotation = normalizedCardinal(item.rotation || 0);
  if (rotation === null || !finite(item.x) || !finite(item.y) || !finite(item.w) || !finite(item.h)) return null;
  const angle = rotation * Math.PI / 180;
  const tangent = { x: Math.cos(angle), y: Math.sin(angle) };
  const normal = { x: -Math.sin(angle), y: Math.cos(angle) };
  const center = {
    x: Number(item.x) + normal.x * Number(item.h) / 2,
    y: Number(item.y) + normal.y * Number(item.h) / 2,
  };
  const half = Number(item.w) / 2;
  const along = Math.abs(normal.y) > 0.5 ? center.x : center.y;
  return {
    entry,
    center,
    normal,
    tangent,
    range: [along - half, along + half],
  };
}

function corridorBetween(a, b, overlap) {
  const vertical = Math.abs(a.normal.y) > 0.5;
  if (vertical) {
    const x0 = Math.max(a.range[0], b.range[0]);
    const y0 = Math.min(a.center.y, b.center.y);
    return { x: x0, y: y0, w: overlap, h: Math.abs(a.center.y - b.center.y) };
  }
  const y0 = Math.max(a.range[0], b.range[0]);
  const x0 = Math.min(a.center.x, b.center.x);
  return { x: x0, y: y0, w: Math.abs(a.center.x - b.center.x), h: overlap };
}

function rectCoveredByRoom(room, rect) {
  const area = rect.w * rect.h;
  if (area <= EPS) return true;
  const covered = roomRects(room).reduce((sum, part) => sum + overlapArea(part, rect), 0);
  return area - covered <= Math.max(EPS, area * 1e-9);
}

function opposingAisles(fronts, entries, room, obstacleRects) {
  const pairs = [];
  let complete = true;
  for (let i = 0; i < fronts.length; i += 1) {
    for (let j = i + 1; j < fronts.length; j += 1) {
      const a = fronts[i]; const b = fronts[j];
      const dot = a.normal.x * b.normal.x + a.normal.y * b.normal.y;
      if (dot > -0.999999) continue;
      const overlap = overlapLength(a.range[0], a.range[1], b.range[0], b.range[1]);
      if (overlap <= EPS) continue;
      const dx = b.center.x - a.center.x; const dy = b.center.y - a.center.y;
      const gap = dx * a.normal.x + dy * a.normal.y;
      // Оба фронта должны смотреть друг на друга, а не наружу.
      if (gap < -EPS) continue;
      const corridor = corridorBetween(a, b, overlap);
      const blockedByItem = entries.some((entry) => entry.id !== a.entry.id && entry.id !== b.entry.id
        && entry.shapes.some((shape) => validRect(shape) && overlapArea(shape, corridor) > EPS));
      const blockedByFixedObstacle = obstacleRects.some((rect) => validRect(rect) && overlapArea(rect, corridor) > EPS);
      if (!rectCoveredByRoom(room, corridor) || blockedByItem || blockedByFixedObstacle) {
        complete = false;
        continue;
      }
      pairs.push({
        itemIds: [a.entry.id, b.entry.id],
        clearanceMm: round(Math.max(0, gap)),
        overlapMm: round(overlap),
      });
    }
  }
  return { pairs, complete };
}

/**
 * Собрать только известные кухонные метрики.
 *
 * records имеет формат валидатора авторасстановки
 * `{ itemId, x, y, rotation, shapes }`. obstacleRects может содержать ручные
 * стены/вложенные помещения, если вызывающая сторона ими располагает.
 */
export function collectKitchenLayoutMetrics({
  room, items = [], records = null, obstacleRects = [], obstacleItems = [], simultaneousCooks = null,
} = {}) {
  if (!room || !Array.isArray(items)) return {};
  const kitchenItemCount = items.filter((item) => KITCHEN_KIND_SET.has(item.kind)).length;
  if (!kitchenItemCount) return {};
  const entries = posedEntries(items, records);
  if (!entries) return {
    kitchen_item_count: kitchenItemCount,
    kitchen_records_complete: false,
    kitchen_geometry_complete: false,
  };
  const kitchen = entries.filter((entry) => KITCHEN_KIND_SET.has(entry.kind));
  const geometryKnown = kitchen.every((entry) => entry.shapes.length > 0 && entry.shapes.every(validRect));
  const metrics = {
    kitchen_item_count: kitchen.length,
    kitchen_records_complete: true,
    kitchen_geometry_complete: geometryKnown,
  };
  const allPlanGeometryComplete = entries.every((entry) => (
    entry.shapes.length > 0 && entry.shapes.every(validRect)
  )) && obstacleRects.every(validRect);
  // Колонны и другие конструктивные элементы приходят из геометрии проекта,
  // а не из каталога мебели. Для них не существует SKU/паспорта изделия, но
  // их проверенный прямоугольник всё равно обязан участвовать в collision.
  const allPlanProjectionsVerified = entries
    .filter((entry) => !isStructural(entry.kind))
    .every(hasVerifiedPlanProjection)
    && (Array.isArray(obstacleItems) ? obstacleItems : [])
      .filter((item) => !isStructural(item.kind))
      .every((item) => hasVerifiedPlanProjection({ item }));
  metrics.kitchen_all_plan_geometry_complete = allPlanGeometryComplete;
  metrics.kitchen_plan_projections_verified = allPlanProjectionsVerified;
  if (geometryKnown && allPlanGeometryComplete && allPlanProjectionsVerified) {
    metrics.kitchen_full_projection_geometry_verified = true;
    let collisionCount = 0;
    let minimumGap = Infinity;
    const seen = new Set();
    for (const a of kitchen) {
      for (const b of entries) {
        if (a.id === b.id) continue;
        const key = [a.id, b.id].sort().join(':');
        if (seen.has(key)) continue;
        seen.add(key);
        for (const ra of a.shapes) for (const rb of b.shapes) {
          if (!validRect(rb)) continue;
          if (overlapArea(ra, rb) > EPS) collisionCount += 1;
          minimumGap = Math.min(minimumGap, rectGap(ra, rb));
        }
      }
      for (const rect of obstacleRects) {
        if (!validRect(rect)) continue;
        for (const shape of a.shapes) if (overlapArea(shape, rect) > EPS) collisionCount += 1;
      }
    }
    metrics.kitchen_projection_collision_count = collisionCount;
    metrics.kitchen_real_projection_clearance_valid = collisionCount === 0;
    if (Number.isFinite(minimumGap)) metrics.kitchen_min_full_body_gap_mm = round(minimumGap);
  }

  const applicableFrontEntries = kitchen.filter((entry) => WORK_FRONT_KINDS.has(entry.kind));
  const fronts = applicableFrontEntries.filter(hasVerifiedPlanProjection).map(frontOf).filter(Boolean);
  const frontGeometryComplete = fronts.length === applicableFrontEntries.length;
  metrics.kitchen_measured_front_count = fronts.length;
  metrics.kitchen_front_geometry_complete = frontGeometryComplete;
  if (frontGeometryComplete) {
    const aisles = opposingAisles(fronts, entries, room, obstacleRects);
    metrics.kitchen_opposing_front_pair_count = aisles.pairs.length;
    metrics.kitchen_aisle_evidence_complete = aisles.complete;
    if (aisles.complete && aisles.pairs.length) {
      metrics.kitchen_work_aisle_mm = Math.min(...aisles.pairs.map((pair) => pair.clearanceMm));
      metrics.kitchen_work_aisle_pairs = aisles.pairs;
    }
  }
  const cooks = Number(simultaneousCooks);
  if (simultaneousCooks !== null && simultaneousCooks !== '' && Number.isFinite(cooks) && cooks > 0) {
    metrics.kitchen_work_aisle_required_mm = cooks > 1 ? 1219 : 1067;
  }
  return metrics;
}
