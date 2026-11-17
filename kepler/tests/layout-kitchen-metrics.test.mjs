import test from 'node:test';
import assert from 'node:assert/strict';

import { collectKitchenLayoutMetrics } from '../core/layout-kitchen-metrics.js';
import { createItem, createRoom } from '../core/model.js';

function item(id, kind, x, y, w, h, rotation = 0, metadata = {}) {
  return { ...createItem(kind, x, y, w, h, rotation), id, ...metadata };
}

function verifiedItem(id, kind, x, y, w, h, rotation = 0, metadata = {}) {
  return item(id, kind, x, y, w, h, rotation, {
    planProjectionVerified: true,
    geometryStatus: 'parametric_custom',
    ...metadata,
  });
}

function recordOf(source, extra = {}) {
  return {
    itemId: source.id, x: source.x, y: source.y, rotation: source.rotation,
    shapes: [{ x: source.x - source.w / 2, y: source.y - source.h / 2, w: source.w, h: source.h }],
    ...extra,
  };
}

test('измеряет проход только по подтверждённым обращённым фронтам', () => {
  const room = createRoom('kitchen', 0, 0, 5000, 3000);
  const lower = verifiedItem('lower', 'kitchen-row', 2500, 300, 2400, 600, 0);
  const upper = verifiedItem('upper', 'kitchen-row', 2500, 1967, 2400, 600, 180);
  const metrics = collectKitchenLayoutMetrics({
    room, items: [lower, upper], simultaneousCooks: 1,
  });

  assert.equal(metrics.kitchen_work_aisle_mm, 1067);
  assert.equal(metrics.kitchen_work_aisle_required_mm, 1067);
  assert.equal(metrics.kitchen_opposing_front_pair_count, 1);
  assert.deepEqual(metrics.kitchen_work_aisle_pairs[0].itemIds, ['lower', 'upper']);
  assert.equal(metrics.kitchen_real_projection_clearance_valid, true);
  assert.equal(metrics.kitchen_full_projection_geometry_verified, true);
});
test('переданный records обязан содержать ровно по одной записи каждого item', () => {
  const room = createRoom('kitchen', 0, 0, 5000, 3000);
  const lower = verifiedItem('lower', 'kitchen-row', 2500, 300, 2400, 600, 0);
  const upper = verifiedItem('upper', 'kitchen-row', 2500, 1967, 2400, 600, 180);
  const incomplete = collectKitchenLayoutMetrics({
    room, items: [lower, upper], records: [recordOf(lower)], simultaneousCooks: 1,
  });

  assert.equal(incomplete.kitchen_records_complete, false);
  assert.equal(Object.hasOwn(incomplete, 'kitchen_work_aisle_mm'), false);
  assert.equal(Object.hasOwn(incomplete, 'kitchen_real_projection_clearance_valid'), false);
  assert.equal(Object.hasOwn(incomplete, 'kitchen_work_aisle_required_mm'), false);

  const duplicate = collectKitchenLayoutMetrics({
    room, items: [lower, upper], records: [recordOf(lower), recordOf(lower)],
  });
  assert.equal(duplicate.kitchen_records_complete, false);
});

test('hard-проекция публикуется только для подтверждённой геометрии', () => {
  const room = createRoom('kitchen', 0, 0, 5000, 3000);
  const proxy = item('proxy', 'kitchen-row', 1500, 300, 2400, 600, 0);
  const incompleteSku = item('sku', 'fridge', 3500, 325, 650, 650, 0, {
    planProjectionVerified: true, geometryStatus: 'verified_sku', sku: 'FR-1',
  });
  const unverified = collectKitchenLayoutMetrics({ room, items: [proxy, incompleteSku] });
  assert.equal(unverified.kitchen_plan_projections_verified, false);
  assert.equal(Object.hasOwn(unverified, 'kitchen_real_projection_clearance_valid'), false);
  assert.equal(Object.hasOwn(unverified, 'kitchen_full_projection_geometry_verified'), false);
  assert.equal(Object.hasOwn(unverified, 'kitchen_work_aisle_mm'), false);

  const row = verifiedItem('row', 'kitchen-row', 1500, 300, 2400, 600, 0);
  const fridge = item('fridge', 'fridge', 3500, 325, 650, 650, 0, {
    planProjectionVerified: true,
    geometryStatus: 'verified_sku',
    sku: 'FR-1',
    sourceUrl: 'https://example.test/fr-1',
  });
  const verified = collectKitchenLayoutMetrics({ room, items: [row, fridge] });
  assert.equal(verified.kitchen_plan_projections_verified, true);
  assert.equal(verified.kitchen_real_projection_clearance_valid, true);
  assert.equal(verified.kitchen_full_projection_geometry_verified, true);
});

test('hard-проверка учитывает все предметы и фиксированные препятствия', () => {
  const room = createRoom('kitchen', 0, 0, 5000, 3000);
  const row = verifiedItem('row', 'kitchen-row', 1500, 300, 2400, 600, 0);
  const chair = verifiedItem('chair', 'chair', 1500, 300, 450, 450, 0);
  const itemCollision = collectKitchenLayoutMetrics({ room, items: [row, chair] });
  assert.ok(itemCollision.kitchen_projection_collision_count > 0);
  assert.equal(itemCollision.kitchen_real_projection_clearance_valid, false);

  const fixedCollision = collectKitchenLayoutMetrics({
    room,
    items: [row],
    obstacleRects: [{ x: 1200, y: 100, w: 300, h: 500 }],
  });
  assert.ok(fixedCollision.kitchen_projection_collision_count > 0);
  assert.equal(fixedCollision.kitchen_real_projection_clearance_valid, false);

  const incompleteRecord = collectKitchenLayoutMetrics({
    room,
    items: [row, chair],
    records: [recordOf(row), recordOf(chair, { shapes: [] })],
  });
  assert.equal(incompleteRecord.kitchen_all_plan_geometry_complete, false);
  assert.equal(Object.hasOwn(incompleteRecord, 'kitchen_real_projection_clearance_valid'), false);

  const invalidObstacle = collectKitchenLayoutMetrics({
    room, items: [row], obstacleRects: [{ x: 100, y: 100, w: null, h: 500 }],
  });
  assert.equal(invalidObstacle.kitchen_all_plan_geometry_complete, false);
  assert.equal(Object.hasOwn(invalidObstacle, 'kitchen_real_projection_clearance_valid'), false);
});

test('конструктивная колонна участвует в collision без мебельного SKU', () => {
  const room = createRoom('kitchen', 0, 0, 5000, 3000);
  const row = verifiedItem('row', 'kitchen-row', 1500, 300, 2400, 600, 0);
  const column = item('column', 'column', 4000, 1500, 400, 400, 0);
  const clear = collectKitchenLayoutMetrics({ room, items: [row, column] });
  assert.equal(clear.kitchen_plan_projections_verified, true);
  assert.equal(clear.kitchen_full_projection_geometry_verified, true);
  assert.equal(clear.kitchen_projection_collision_count, 0);

  column.x = 1500;
  column.y = 300;
  const collision = collectKitchenLayoutMetrics({ room, items: [row, column] });
  assert.ok(collision.kitchen_projection_collision_count > 0);
  assert.equal(collision.kitchen_real_projection_clearance_valid, false);
});

test('внешнее мебельное препятствие сохраняет provenance полной проекции', () => {
  const room = createRoom('kitchen', 0, 0, 5000, 3000);
  const row = verifiedItem('row', 'kitchen-row', 2500, 300, 2400, 600, 0);
  const externalChair = item('external', 'chair', -100, 1500, 450, 450, 0);
  const metrics = collectKitchenLayoutMetrics({
    room,
    items: [row],
    obstacleRects: [{ x: -325, y: 1275, w: 450, h: 450 }],
    obstacleItems: [externalChair],
  });
  assert.equal(metrics.kitchen_plan_projections_verified, false);
  assert.equal(Object.hasOwn(metrics, 'kitchen_full_projection_geometry_verified'), false);
  assert.equal(Object.hasOwn(metrics, 'kitchen_real_projection_clearance_valid'), false);
});

test('составной фронт не заменяется bbox и делает покрытие KIT004 неполным', () => {
  const room = createRoom('kitchen', 0, 0, 5000, 4000);
  const corner = verifiedItem('corner', 'kitchen-corner', 1500, 1000, 2400, 1800, 0);
  const other = verifiedItem('other', 'kitchen-row', 3000, 3400, 2400, 600, 180);
  const records = [{
    ...recordOf(corner),
    shapes: [
      { x: 300, y: 100, w: 2400, h: 600 },
      { x: 300, y: 700, w: 600, h: 1200 },
    ],
  }, recordOf(other)];
  const metrics = collectKitchenLayoutMetrics({ room, items: [corner, other], records });

  assert.equal(metrics.kitchen_geometry_complete, true);
  assert.equal(metrics.kitchen_measured_front_count, 1);
  assert.equal(metrics.kitchen_front_geometry_complete, false);
  assert.equal(Object.hasOwn(metrics, 'kitchen_work_aisle_mm'), false);
  assert.equal(metrics.kitchen_real_projection_clearance_valid, true);
});

test('номинальный bbox Г-/П-кухни не превращается в доказанный прямой фронт', () => {
  const room = createRoom('kitchen', 0, 0, 6000, 4000);
  const corner = verifiedItem('corner', 'kitchen-corner', 1800, 900, 3000, 1800, 0);
  const opposite = verifiedItem('opposite', 'kitchen-row', 1800, 3000, 2400, 600, 180);
  const metrics = collectKitchenLayoutMetrics({ room, items: [corner, opposite], simultaneousCooks: 1 });

  assert.equal(metrics.kitchen_front_geometry_complete, false);
  assert.equal(Object.hasOwn(metrics, 'kitchen_work_aisle_mm'), false);
});

test('подтверждённый локальный фронт острова участвует в проходе напротив ряда', () => {
  const room = createRoom('kitchen', 0, 0, 6000, 4000);
  const row = verifiedItem('row', 'kitchen-row', 2500, 300, 2400, 600, 0);
  const island = verifiedItem('island', 'kitchen-island', 2500, 2167, 2000, 1000, 180);
  const metrics = collectKitchenLayoutMetrics({ room, items: [row, island], simultaneousCooks: 1 });

  assert.equal(metrics.kitchen_front_geometry_complete, true);
  assert.equal(metrics.kitchen_opposing_front_pair_count, 1);
  assert.equal(metrics.kitchen_work_aisle_mm, 1067);
});

test('проход не публикуется, если коридор вышел из комнаты или пересёк obstacle', () => {
  const lower = verifiedItem('lower', 'kitchen-row', 2500, 300, 2400, 600, 0);
  const upper = verifiedItem('upper', 'kitchen-row', 2500, 1967, 2400, 600, 180);
  const lRoom = createRoom('kitchen', 0, 0, 5000, 3000);
  lRoom.notch = { corner: 'ne', w: 1500, h: 1500 };
  const outside = collectKitchenLayoutMetrics({ room: lRoom, items: [lower, upper] });
  assert.equal(outside.kitchen_aisle_evidence_complete, false);
  assert.equal(Object.hasOwn(outside, 'kitchen_work_aisle_mm'), false);

  const room = createRoom('kitchen', 0, 0, 5000, 3000);
  const blocked = collectKitchenLayoutMetrics({
    room,
    items: [lower, upper],
    obstacleRects: [{ x: 2200, y: 900, w: 600, h: 300 }],
  });
  assert.equal(blocked.kitchen_aisle_evidence_complete, false);
  assert.equal(Object.hasOwn(blocked, 'kitchen_work_aisle_mm'), false);
});

test('требуемый проход зависит только от явно положительного числа поваров', () => {
  const room = createRoom('kitchen', 0, 0, 5000, 3000);
  const row = verifiedItem('row', 'kitchen-row', 1500, 300, 2400, 600, 0);
  const required = (simultaneousCooks) => collectKitchenLayoutMetrics({
    room, items: [row], simultaneousCooks,
  }).kitchen_work_aisle_required_mm;

  assert.equal(required(null), undefined);
  assert.equal(required(0), undefined);
  assert.equal(required(-2), undefined);
  assert.equal(required('unknown'), undefined);
  assert.equal(required(1), 1067);
  assert.equal(required(2), 1219);
  assert.equal(required(3), 1219);
});

test('KIT035 не публикуется без явной связи seat↔counter и traffic evidence', () => {
  const room = createRoom('kitchen', 0, 0, 5000, 4000);
  const counter = verifiedItem('counter', 'bar-counter', 1800, 1250, 1600, 500, 0);
  const stool = verifiedItem('stool', 'bar-stool', 1800, 1800, 420, 420, 0);
  const cabinet = verifiedItem('cabinet', 'pantry', 1800, 2900, 600, 600, 0);
  const metrics = collectKitchenLayoutMetrics({ room, items: [counter, stool, cabinet] });

  assert.equal(Object.hasOwn(metrics, 'kitchen_seating_clearance_mm'), false);
  assert.equal(Object.hasOwn(metrics, 'kitchen_seating_clearances'), false);
});

test('без кухонных объектов не заявляет кухонные метрики', () => {
  const room = createRoom('living', 0, 0, 5000, 4000);
  const sofa = item('sofa', 'sofa', 1500, 1000, 2200, 950, 0);
  assert.deepEqual(collectKitchenLayoutMetrics({ room, items: [sofa] }), {});
});
