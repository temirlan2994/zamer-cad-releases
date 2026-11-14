// Формализованный реестр правил авторасстановки: стабильные ID, честная
// применимость/unknown, обязательность и робастные численные пороги.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LAYOUT_RULES, RULE_IMPLEMENTATION, RULE_STATUS, evaluateLayoutRule,
  evaluateLayoutRules, layoutRuleById, layoutRuleCoverage, summarizeLayoutRuleResults,
} from '../core/layout-rules.js';

test('реестр: ID уникальны, типы и покрытие согласованы', () => {
  assert.ok(LAYOUT_RULES.length >= 35, `правил первой группы: ${LAYOUT_RULES.length}`);
  assert.equal(new Set(LAYOUT_RULES.map((r) => r.id)).size, LAYOUT_RULES.length);
  for (const r of LAYOUT_RULES) {
    assert.match(r.id, /^(GEO|PATH|BED|LIV|DIN|KIT|BATH)\d{3}$/);
    assert.ok(['hard', 'conditional_hard', 'soft'].includes(r.severity));
    assert.ok(Object.values(RULE_IMPLEMENTATION).includes(r.implementation));
    assert.ok(r.checks.length > 0);
  }
  const c = layoutRuleCoverage();
  assert.equal(c.total, LAYOUT_RULES.length);
  assert.equal(Object.values(c.byImplementation).reduce((a, b) => a + b, 0), c.total);
  assert.equal(c.executable, c.byImplementation.implemented);
  for (const category of ['Геометрия и состояния объектов', 'Маршруты и движение', 'Спальня', 'Гостиная и медиа', 'Столовая', 'Кухня', 'Санузлы']) {
    assert.ok(c.byCategory[category] > 0, `есть раздел «${category}»`);
  }
});

test('поиск по ID возвращает исходное правило, неизвестное — null', () => {
  assert.equal(layoutRuleById('BED004')?.title, 'Боковой проход у взрослой кровати');
  assert.equal(layoutRuleById('NOPE999'), null);
  assert.throws(() => evaluateLayoutRule('NOPE999'), /Неизвестное правило/);
});

test('применимость: другая комната → not_applicable, неизвестный контекст → unknown', () => {
  const no = evaluateLayoutRule('BED004', { roomType: 'living', itemKinds: ['sofa'], metrics: {} });
  assert.equal(no.status, RULE_STATUS.NOT_APPLICABLE);
  const unknownRoom = evaluateLayoutRule('BED004', { itemKinds: ['bed-double'], metrics: {} });
  assert.equal(unknownRoom.status, RULE_STATUS.UNKNOWN);
  const noBed = evaluateLayoutRule('BED004', { roomType: 'bedroom', itemKinds: ['wardrobe'], metrics: {} });
  assert.equal(noBed.status, RULE_STATUS.NOT_APPLICABLE);
});

test('hard fail блокирует вариант, soft fail только снижает оценку', () => {
  const hard = evaluateLayoutRule('GEO004', { metrics: { solid_collision_count: 1 } });
  assert.equal(hard.status, RULE_STATUS.FAIL);
  assert.equal(hard.blocking, true);

  const soft = evaluateLayoutRule('BED004', {
    roomType: 'bedroom', itemKinds: ['bed-double'], metrics: { bed_side_clearance_mm: 550 },
  });
  assert.equal(soft.status, RULE_STATUS.FAIL);
  assert.equal(soft.blocking, false);
});

test('порог с погрешностью даёт pass / fail / unknown по границам', () => {
  const context = (value, uncertainty) => ({
    roomType: 'bedroom', itemKinds: ['bed-double'],
    metrics: { bed_side_clearance_mm: { value, uncertainty } },
  });
  assert.equal(evaluateLayoutRule('BED004', context(620, 20)).status, RULE_STATUS.PASS);
  assert.equal(evaluateLayoutRule('BED004', context(579, 20)).status, RULE_STATUS.FAIL);
  assert.equal(evaluateLayoutRule('BED004', context(600, 20)).status, RULE_STATUS.UNKNOWN);
});

test('диапазон и зависимый порог используют уже вычисленные метрики', () => {
  const bed = { roomType: 'bedroom', itemKinds: ['bed-double', 'nightstand'] };
  assert.equal(evaluateLayoutRule('BED007', { ...bed, metrics: { bed_nightstand_gap_mm: 75 } }).status, 'pass');
  assert.equal(evaluateLayoutRule('BED007', { ...bed, metrics: { bed_nightstand_gap_mm: 130 } }).status, 'fail');

  const living = { roomType: 'living', itemKinds: ['sofa'] };
  assert.equal(evaluateLayoutRule('LIV002', { ...living, metrics: { usable_seat_count: 4, required_seat_count: 4 } }).status, 'pass');
  assert.equal(evaluateLayoutRule('LIV002', { ...living, metrics: { usable_seat_count: 3, required_seat_count: 4 } }).status, 'fail');
});

test('внешние данные и отсутствующий вычислитель не превращаются в ложный pass', () => {
  const context = {
    roomType: 'kitchen', itemKinds: ['fridge'], metrics: { fridge_full_use_valid: true },
  };
  const missing = evaluateLayoutRule('KIT014', context);
  assert.equal(missing.status, RULE_STATUS.UNKNOWN);
  assert.match(missing.reason, /appliance_manuals/);

  const ready = evaluateLayoutRule('KIT014', {
    ...context, externalData: { appliance_manuals: true },
  });
  assert.equal(ready.status, RULE_STATUS.PASS);

  const unsupported = evaluateLayoutRule('LIV011', {
    roomType: 'living', itemKinds: ['sofa', 'tv'], metrics: { screen_visible_from_required_seats: true },
  });
  assert.equal(unsupported.status, RULE_STATUS.UNKNOWN);
  assert.match(unsupported.reason, /не реализован/);
});

test('пакетная оценка и сводка сохраняют unknown отдельно', () => {
  const results = evaluateLayoutRules({
    roomType: 'bedroom', itemKinds: ['bed-double'],
    metrics: {
      room_polygon_valid: true,
      solid_collision_count: 0,
      door_swing_collision_count: 0,
      furniture_support_valid: true,
      required_routes_reachable: true,
      agent_body_route_valid: true,
      main_route_min_width_mm: 1000,
      route_bottleneck_valid: true,
      independent_bed_access: false,
      bed_side_clearance_mm: 700,
      bed_foot_clearance_mm: 900,
    },
  }, { ruleIds: ['GEO001', 'GEO004', 'PATH004', 'BED003', 'BED004', 'BED013'] });
  const s = summarizeLayoutRuleResults(results);
  assert.deepEqual(s.blocking, ['BED003']);
  assert.equal(s.feasible, false);
  assert.equal(s.byStatus.pass, 4);
  assert.equal(s.byStatus.fail, 1);
  assert.equal(s.byStatus.unknown, 1);
  assert.equal(s.applicable, 6);
  assert.equal(s.known, 5);
  assert.equal(s.unknown, 1);
  assert.equal(s.notApplicable, 0);
  assert.deepEqual(s.hardUnknown, []);
  assert.deepEqual(s.unknownByImplementation, { requires_external_data: 1 });
  assert.equal(s.coverage, 5 / 6);
});
