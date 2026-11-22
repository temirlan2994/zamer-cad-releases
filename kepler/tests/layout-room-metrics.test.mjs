import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BEDROOM_BATHROOM_METRIC_IDS,
  collectBedroomBathroomMetrics,
} from '../core/layout-room-metrics.js';

const room = (w = 5000, h = 5000) => ({ id: 'room-1', type: 'bedroom', x: 0, y: 0, w, h });
const item = (id, kind, x, y, w, h, rotation = 0) => ({ id, kind, x, y, w, h, rotation });

test('спальня: измеряет опору изголовья, боковой и ножной проход без AABB-догадок', () => {
  const bed = item('bed', 'bed-double', 2500, 1000, 1600, 2000);
  const result = collectBedroomBathroomMetrics({ room: room(), items: [bed] });

  assert.equal(result.bed_headboard_wall_gap_mm, 0);
  assert.equal(result.bed_headboard_supported, true);
  assert.equal(Object.hasOwn(result, 'required_sleep_surface_preserved'), false);
  assert.equal(result.bed_side_clearance_mm, 1700);
  assert.equal(result.bed_foot_clearance_mm, 3000);
  assert.equal(result.required_bedside_surface_count, 1);
  assert.equal(result.bedside_surface_count, 0);
});

test('BED004: односпальная кровать использует лучшую сторону, двуспальная — обе только для двух жильцов', () => {
  const single = item('single', 'bed-single', 450, 1000, 900, 2000);
  const singleResult = collectBedroomBathroomMetrics({ room: room(4000, 4000), items: [single] });
  assert.equal(singleResult.bed_side_clearance_mm, 3100);

  const double = item('double', 'bed-double', 800, 1000, 1600, 2000);
  const oneUser = collectBedroomBathroomMetrics({ room: room(), items: [double] });
  assert.equal(oneUser.bed_side_clearance_mm, 3400);

  double.userActorIds = ['adult-1', 'adult-2'];
  const twoUsers = collectBedroomBathroomMetrics({ room: room(), items: [double] });
  assert.equal(twoUsers.bed_side_clearance_mm, 0);
});

test('BED020: сохраняемость спального места известна только из explicit requirement, actual и provenance', () => {
  const bed = item('bed', 'bed-double', 2500, 1000, 1600, 2000);
  bed.requiredSleepSurfaceMm = { width: 1600, depth: 2000 };
  bed.sleepSurfaceMm = { width: 1600, depth: 2000 };
  let result = collectBedroomBathroomMetrics({ room: room(), items: [bed] });
  assert.equal(Object.hasOwn(result, 'required_sleep_surface_preserved'), false);

  bed.requiredSleepSurfaceProvenance = 'brief:adult-1';
  result = collectBedroomBathroomMetrics({ room: room(), items: [bed] });
  assert.equal(result.required_sleep_surface_preserved, true);

  bed.sleepSurfaceMm.width = 1500;
  result = collectBedroomBathroomMetrics({ room: room(), items: [bed] });
  assert.equal(result.required_sleep_surface_preserved, false);
});

test('проём за изголовьем не считается непрозрачной опорной стеной', () => {
  const bed = item('bed', 'bed-double', 2500, 1000, 1600, 2000);
  const result = collectBedroomBathroomMetrics({
    room: room(),
    items: [bed],
    supportVoids: [{ x: 2200, y: -100, w: 600, h: 200 }],
  });

  assert.equal(result.bed_headboard_wall_gap_mm, 0);
  assert.equal(result.bed_headboard_supported, false);
});

test('спальня: узкое место на части рабочего бока кровати становится bottleneck', () => {
  const bed = item('bed', 'bed-double', 2500, 1000, 1600, 2000);
  bed.occupancyCount = 2;
  const wardrobe = item('wardrobe', 'wardrobe', 3700, 1200, 600, 600);
  const result = collectBedroomBathroomMetrics({ room: room(), items: [bed, wardrobe] });

  assert.equal(result.bed_side_clearance_mm, 100);
  assert.equal(result.bed_foot_clearance_mm, 3000);
});

test('спальня: проверяет каждую тумбу, а неодинаковые зазоры не сводит к ложному скаляру', () => {
  const bed = item('bed', 'bed-double', 2500, 1000, 1600, 2000);
  const left = item('left', 'nightstand', 1425, 200, 450, 400);
  const right = item('right', 'nightstand', 3625, 200, 450, 400);
  const result = collectBedroomBathroomMetrics({ room: room(), items: [bed, left, right] });

  assert.equal(result.bed_nightstand_min_gap_mm, 50);
  assert.equal(result.bed_nightstand_max_gap_mm, 100);
  assert.equal(result.bed_nightstand_gaps_valid, true);
  assert.equal(Object.hasOwn(result, 'bed_nightstand_gap_mm'), false);

  right.x = 3725;
  const invalid = collectBedroomBathroomMetrics({ room: room(), items: [bed, left, right] });
  assert.equal(invalid.bed_nightstand_max_gap_mm, 200);
  assert.equal(invalid.bed_nightstand_gaps_valid, false);
});

test('BED007: тумба у изножья не подменяет боковую тумбу', () => {
  const bed = item('bed', 'bed-double', 2500, 1000, 1600, 2000);
  const foot = item('foot', 'nightstand', 2500, 2250, 450, 400);
  const result = collectBedroomBathroomMetrics({ room: room(), items: [bed, foot] });

  assert.equal(result.bed_nightstand_gaps_valid, false);
  assert.equal(Object.hasOwn(result, 'bed_nightstand_min_gap_mm'), false);
});

test('BED007: две тумбы не могут одновременно занять один боковой slot', () => {
  const bed = item('bed', 'bed-double', 2500, 1000, 1600, 2000);
  const first = item('first', 'nightstand', 1425, 200, 450, 400);
  const second = item('second', 'nightstand', 1425, 300, 450, 400);
  const result = collectBedroomBathroomMetrics({ room: room(), items: [bed, first, second] });

  assert.equal(result.bed_nightstand_gaps_valid, false);
});

test('BED006: несколько поверхностей не занимают один slot и не маскируют пустую вторую кровать', () => {
  const first = item('bed-1', 'bed-double', 1500, 1000, 1600, 2000);
  const second = item('bed-2', 'bed-double', 5500, 1000, 1600, 2000);
  const left = item('left', 'nightstand', 425, 200, 450, 400);
  const right = item('right', 'side-table', 2575, 200, 450, 400);
  const result = collectBedroomBathroomMetrics({
    room: room(7000, 5000), items: [first, second, left, right],
  });

  assert.equal(result.required_bedside_surface_count, 2);
  assert.equal(result.bedside_surface_count, 1);
});

test('BED006: явно пустая кровать не требует прикроватную поверхность', () => {
  const occupied = item('bed-1', 'bed-double', 1500, 1000, 1600, 2000);
  occupied.occupancyCount = 2;
  const empty = item('bed-2', 'bed-double', 5500, 1000, 1600, 2000);
  empty.occupancyCount = 0;
  const left = item('left', 'nightstand', 425, 200, 450, 400);
  const right = item('right', 'side-table', 2575, 200, 450, 400);
  const result = collectBedroomBathroomMetrics({
    room: room(7000, 5000), items: [occupied, empty, left, right],
  });

  assert.equal(result.required_bedside_surface_count, 2);
  assert.equal(result.bedside_surface_count, 2);
});

test('санузел: фронтальный зазор учитывает препятствие на части ширины', () => {
  const toilet = item('toilet', 'toilet', 700, 325, 400, 650);
  const cabinet = item('cabinet', 'dresser', 700, 1500, 200, 300);
  const result = collectBedroomBathroomMetrics({
    room: { ...room(3000, 3000), type: 'bathroom' },
    items: [toilet, cabinet],
  });

  assert.equal(result.bath_fixture_front_clearance_mm, 700);
  assert.equal(result.toilet_axis_side_clearance_mm, 700);
});

test('BATH002: сторона подхода к душу не выдумывается', () => {
  const shower = item('shower', 'shower', 450, 450, 900, 900);
  let result = collectBedroomBathroomMetrics({
    room: { ...room(3000, 3000), type: 'bathroom' }, items: [shower],
  });
  assert.equal(Object.hasOwn(result, 'bath_fixture_front_clearance_mm'), false);

  shower.approachSide = 'front';
  result = collectBedroomBathroomMetrics({
    room: { ...room(3000, 3000), type: 'bathroom' }, items: [shower],
  });
  assert.equal(result.bath_fixture_front_clearance_mm, 2100);
});

test('поворот на 90° сохраняет локальные стороны, произвольный угол оставляет метрики unknown', () => {
  const toilet = item('toilet', 'toilet', 2675, 700, 400, 650, 90);
  const rotated = collectBedroomBathroomMetrics({
    room: { ...room(3000, 3000), type: 'bathroom' }, items: [toilet],
  });
  assert.equal(rotated.bath_fixture_front_clearance_mm, 2350);
  assert.equal(rotated.toilet_axis_side_clearance_mm, 700);

  toilet.rotation = 45;
  const unknown = collectBedroomBathroomMetrics({
    room: { ...room(3000, 3000), type: 'bathroom' }, items: [toilet],
  });
  assert.equal(Object.hasOwn(unknown, 'bath_fixture_front_clearance_mm'), false);
  assert.equal(Object.hasOwn(unknown, 'toilet_axis_side_clearance_mm'), false);
});

test('неполный набор records не даёт ложных известных метрик', () => {
  const bed = item('bed', 'bed-double', 2500, 1000, 1600, 2000);
  const wardrobe = item('wardrobe', 'wardrobe', 3700, 1200, 600, 600);
  const result = collectBedroomBathroomMetrics({
    room: room(),
    items: [bed, wardrobe],
    records: [{ itemId: bed.id, x: bed.x, y: bed.y, rotation: 0, shapes: [{ x: 1700, y: 0, w: 1600, h: 2000 }] }],
  });
  assert.deepEqual(result, {});
});

test('публичный список метрик не содержит случайных или невычисляемых полей', () => {
  assert.deepEqual(BEDROOM_BATHROOM_METRIC_IDS, [
    'bed_side_clearance_mm',
    'bed_foot_clearance_mm',
    'bed_verified_foot_route_clearance_mm',
    'bed_headboard_wall_gap_mm',
    'bed_headboard_supported',
    'required_sleep_surface_preserved',
    'bedside_surface_count',
    'required_bedside_surface_count',
    'bed_nightstand_min_gap_mm',
    'bed_nightstand_max_gap_mm',
    'bed_nightstand_gaps_valid',
    'bed_nightstand_gap_mm',
    'bath_fixture_front_clearance_mm',
    'toilet_axis_side_clearance_mm',
  ]);
});
