// Формализованное ядро правил авторасстановки.
//
// Исходные ID, обязательность и пороги взяты из пакета
// FURNITURE_RULES_PACKAGE_RU v1.0.0. Текстовое поле check из пакета здесь
// намеренно не исполняется: каждому поддержанному правилу соответствует
// явная метрика и детерминированный оператор сравнения.

import {
  FURNITURE_RULE_CATALOG, FURNITURE_RULE_CATALOG_METADATA,
} from './layout-rule-catalog.generated.js';

export const RULE_IMPLEMENTATION = Object.freeze({
  IMPLEMENTED: 'implemented',
  REQUIRES_EXTERNAL_DATA: 'requires_external_data',
  UNSUPPORTED: 'unsupported',
});

export const RULE_STATUS = Object.freeze({
  PASS: 'pass',
  FAIL: 'fail',
  UNKNOWN: 'unknown',
  NOT_APPLICABLE: 'not_applicable',
});

const BEDROOMS = ['bedroom', 'master-bedroom', 'kids-room', 'guest-bedroom'];
const LIVING = ['living', 'kitchen-living'];
const DINING = ['dining', 'kitchen-living', 'kitchen'];
const KITCHENS = ['kitchen', 'kitchen-living'];
const BATHROOMS = ['bathroom', 'guest-wc', 'shower-room', 'tub-room'];

const BEDS = ['bed-double', 'bed-king', 'bed-queen', 'bed-single', 'bed-bunk', 'kids-bed', 'crib'];
const SOFAS = ['sofa', 'sofa-2', 'sofa-corner', 'sofa-u', 'loveseat', 'sofa-bed', 'daybed'];
const DINING_TABLES = ['dining-table', 'dining-table-6', 'table-round', 'conference-table'];
const KITCHEN_ITEMS = ['kitchen-row', 'kitchen-corner', 'kitchen-u', 'kitchen-island', 'stove', 'cooktop-hood', 'sink', 'oven', 'dishwasher', 'fridge', 'fridge-side'];
const BATH_ITEMS = ['toilet', 'bidet', 'washbasin', 'washbasin-double', 'vanity-unit', 'bath', 'bath-corner', 'jacuzzi', 'shower', 'urinal'];

const check = (key, op, target = undefined) => Object.freeze({ key, op, ...(target === undefined ? {} : { target }) });
const rule = (id, category, title, severity, implementation, evaluator, checks, opts = {}) => Object.freeze({
  id, category, title, severity, implementation, evaluator,
  checks: Object.freeze(checks),
  basis: opts.basis || 'derived_constraint',
  sourceIds: Object.freeze(opts.sourceIds || []),
  applies: Object.freeze(opts.applies || {}),
  requiresData: Object.freeze(opts.requiresData || []),
  parameters: Object.freeze(opts.parameters || {}),
});

// Первая производственная группа: геометрия и наиболее частые жилые комнаты.
// unsupported означает не «правило неважно», а честное отсутствие нужного
// вычислителя. requires_external_data — вычислитель есть/понятен, но без
// паспорта, инженерных точек или солнечных данных результат остаётся unknown.
const CURATED_LAYOUT_RULES = Object.freeze([
  rule('GEO001', 'Геометрия и состояния объектов', 'Валидные полигоны', 'hard', 'implemented', 'polygon_validity', [
    check('room_polygon_valid', 'true'),
  ]),
  rule('GEO004', 'Геометрия и состояния объектов', 'Столкновения твердых объемов', 'hard', 'implemented', 'solid_collision_2d', [
    check('solid_collision_count', 'lte', 0),
  ], { parameters: { scope: 'Поддерживаемая в плане проекция физических тел; полная 3D narrow-phase ещё не реализована.' } }),
  rule('GEO008', 'Геометрия и состояния объектов', 'Объем открывания дверей', 'hard', 'implemented', 'swept_opening', [
    check('door_swing_collision_count', 'lte', 0),
  ]),
  rule('GEO016', 'Геометрия и состояния объектов', 'Обязательный выход при раскрытии', 'hard', 'unsupported', 'time_expanded_access', [
    check('exit_reachable_in_required_states', 'true'),
  ]),
  rule('GEO017', 'Геометрия и состояния объектов', 'Учет погрешности', 'hard', 'requires_external_data', 'robust_threshold', [
    check('uncertainty_policy_applied', 'true'),
  ], { requiresData: ['measurement_uncertainty'] }),
  rule('GEO018', 'Геометрия и состояния объектов', 'Реальные опоры', 'hard', 'implemented', 'support_and_containment', [
    check('furniture_support_valid', 'true'),
  ]),

  rule('PATH001', 'Маршруты и движение', 'Граф доступности', 'hard', 'implemented', 'navmesh_connectivity', [
    check('required_routes_reachable', 'true'),
  ]),
  rule('PATH002', 'Маршруты и движение', 'Проверка телом', 'hard', 'implemented', 'body_route_2d', [
    check('agent_body_route_valid', 'true'),
  ], { parameters: { scope: 'Круглый агент на плане; ориентируемые тела SE(2) отмечаются unknown вызывающей стороной.' } }),
  rule('PATH004', 'Маршруты и движение', 'Ширина главного прохода', 'soft', 'implemented', 'bottleneck', [
    check('main_route_min_width_mm', 'gte', 900),
  ], { basis: 'design_heuristic', parameters: { preferredFloorMm: 900, comfortTargetMm: [1100, 1200] } }),
  rule('PATH007', 'Маршруты и движение', 'Проход за сидящими', 'hard', 'implemented', 'occupied_seating', [
    check('occupied_seating_route_valid', 'true'),
  ], { applies: { anyItemKinds: DINING_TABLES } }),
  rule('PATH020', 'Маршруты и движение', 'Узкие места', 'hard', 'implemented', 'bottleneck', [
    check('route_bottleneck_valid', 'true'),
  ]),

  rule('BED001', 'Спальня', 'Размер каркаса вместо размера матраса', 'hard', 'requires_external_data', 'catalog_geometry', [
    check('bed_frame_geometry_verified', 'true'),
  ], { applies: { roomTypes: BEDROOMS, anyItemKinds: BEDS }, requiresData: ['catalog_geometry'], sourceIds: ['ROOM-S17'] }),
  rule('BED003', 'Спальня', 'Независимый выход двух спящих', 'conditional_hard', 'implemented', 'activity_space', [
    check('independent_bed_access', 'true'),
  ], { applies: { roomTypes: BEDROOMS, anyItemKinds: ['bed-double', 'bed-king', 'bed-queen'] } }),
  rule('BED004', 'Спальня', 'Боковой проход у взрослой кровати', 'soft', 'implemented', 'clearance', [
    check('bed_side_clearance_mm', 'gte', 600),
  ], { basis: 'design_heuristic', applies: { roomTypes: BEDROOMS, anyItemKinds: BEDS }, parameters: { recommendationFloorMm: 600, comfortTargetMm: [800, 900] } }),
  rule('BED005', 'Спальня', 'Проход в ногах', 'soft', 'implemented', 'clearance', [
    check('bed_foot_clearance_mm', 'gte', 800),
  ], { basis: 'design_heuristic', applies: { roomTypes: BEDROOMS, anyItemKinds: BEDS }, parameters: { comfortTargetMm: [800, 1000] } }),
  rule('BED006', 'Спальня', 'Поверхность для каждого спящего', 'soft', 'implemented', 'capacity', [
    check('bedside_surface_count', 'gteMetric', 'required_bedside_surface_count'),
  ], { basis: 'design_heuristic', applies: { roomTypes: BEDROOMS, anyItemKinds: BEDS } }),
  rule('BED007', 'Спальня', 'Зазор тумбы у кровати', 'soft', 'implemented', 'clearance', [
    check('bed_nightstand_gap_mm', 'between', [50, 100]),
  ], { basis: 'published_guideline', applies: { roomTypes: BEDROOMS, anyItemKinds: ['nightstand'] }, sourceIds: ['ROOM-S09'], parameters: { comfortTargetMm: [50, 100] } }),
  rule('BED013', 'Спальня', 'Утреннее солнце как предпочтение', 'soft', 'requires_external_data', 'solar_and_glare', [
    check('bed_morning_sun_preference_satisfied', 'true'),
  ], { basis: 'design_heuristic', applies: { roomTypes: BEDROOMS, anyItemKinds: BEDS }, requiresData: ['north_and_solar_geometry'] }),

  rule('LIV002', 'Гостиная и медиа', 'Количество реальных мест', 'conditional_hard', 'implemented', 'capacity', [
    check('usable_seat_count', 'gteMetric', 'required_seat_count'),
  ], { applies: { roomTypes: LIVING } }),
  rule('LIV003', 'Гостиная и медиа', 'Связная группа для разговора', 'soft', 'implemented', 'conversation_group', [
    check('conversation_group_connected', 'true'),
  ], { basis: 'design_heuristic', applies: { roomTypes: LIVING, anyItemKinds: SOFAS } }),
  rule('LIV004', 'Гостиная и медиа', 'Дистанция беседы', 'soft', 'implemented', 'clearance', [
    check('conversation_distance_mm', 'between', [1200, 2400]),
  ], { basis: 'design_heuristic', applies: { roomTypes: LIVING, anyItemKinds: SOFAS }, parameters: { comfortTargetMm: [1200, 2400] } }),
  rule('LIV005', 'Гостиная и медиа', 'Главный поток вне беседы', 'soft', 'implemented', 'navmesh_connectivity', [
    check('main_route_crosses_conversation', 'false'),
  ], { basis: 'design_heuristic', applies: { roomTypes: LIVING, anyItemKinds: SOFAS } }),
  rule('LIV007', 'Гостиная и медиа', 'Столик в зоне досягаемости', 'soft', 'implemented', 'clearance', [
    check('sofa_coffee_table_gap_mm', 'between', [400, 500]),
  ], { basis: 'design_heuristic', applies: { roomTypes: LIVING, anyItemKinds: ['coffee-table', 'coffee-table-2'] }, sourceIds: ['ROOM-S10'], parameters: { comfortTargetMm: [400, 500] } }),
  rule('LIV011', 'Гостиная и медиа', 'Полезная видимость экрана', 'conditional_hard', 'unsupported', 'visibility_rays', [
    check('screen_visible_from_required_seats', 'true'),
  ], { applies: { roomTypes: LIVING, anyItemKinds: ['tv', 'tv-stand'] } }),
  rule('LIV012', 'Гостиная и медиа', 'Расстояние ТВ из угла обзора', 'soft', 'unsupported', 'visibility_rays', [
    check('tv_horizontal_fov_deg', 'between', [30, 40]),
  ], { basis: 'design_heuristic', applies: { roomTypes: LIVING, anyItemKinds: ['tv', 'tv-stand'] }, sourceIds: ['ROOM-S15'], parameters: { comfortTargetDeg: [30, 40] } }),

  rule('DIN001', 'Столовая', 'Повседневная и праздничная вместимость', 'conditional_hard', 'implemented', 'capacity', [
    check('usable_dining_seat_count', 'gteMetric', 'required_dining_seat_count'),
  ], { applies: { roomTypes: DINING, anyItemKinds: DINING_TABLES } }),
  rule('DIN002', 'Столовая', 'Ширина места за столом', 'soft', 'implemented', 'occupied_seating', [
    check('dining_frontage_per_person_mm', 'gte', 600),
  ], { basis: 'published_guideline', applies: { roomTypes: DINING, anyItemKinds: DINING_TABLES }, sourceIds: ['ROOM-S07'], parameters: { recommendationMm: 600, comfortTargetMm: [650, 750] } }),
  rule('DIN003', 'Столовая', 'Обход за сидящим', 'soft', 'implemented', 'occupied_seating', [
    check('dining_table_to_obstruction_mm', 'gte', 813),
  ], { basis: 'published_guideline', applies: { roomTypes: DINING, anyItemKinds: DINING_TABLES }, sourceIds: ['ROOM-S06'], parameters: { noThroughTrafficMm: 813, edgePastMm: 914, walkPastMm: 1118 } }),
  rule('DIN004', 'Столовая', 'Комфортная столовая большого дома', 'soft', 'implemented', 'occupied_seating', [
    check('dining_table_to_obstruction_mm', 'gte', 1300),
  ], { basis: 'published_guideline', applies: { roomTypes: DINING, anyItemKinds: DINING_TABLES }, sourceIds: ['ROOM-S08'], parameters: { comfortTargetMm: [1300, 1500] } }),
  rule('DIN011', 'Столовая', 'Доступ ко всем местам', 'conditional_hard', 'implemented', 'navmesh_connectivity', [
    check('all_dining_seats_reachable', 'true'),
  ], { applies: { roomTypes: DINING, anyItemKinds: DINING_TABLES } }),

  rule('KIT003', 'Кухня', 'Транзит вне горячей станции', 'soft', 'implemented', 'navmesh_connectivity', [
    check('main_route_crosses_hot_zone', 'false'),
  ], { basis: 'design_heuristic', applies: { roomTypes: KITCHENS, anyItemKinds: KITCHEN_ITEMS } }),
  rule('KIT004', 'Кухня', 'Рабочий проход', 'soft', 'implemented', 'clearance', [
    check('kitchen_work_aisle_mm', 'gte', 1067),
  ], { basis: 'published_guideline', applies: { roomTypes: KITCHENS, anyItemKinds: KITCHEN_ITEMS }, sourceIds: ['ROOM-S06'], parameters: { oneCookMm: 1067, multipleCooksMm: 1219, comfortTargetMm: [1200, 1400] } }),
  rule('KIT005', 'Кухня', 'Размеры прохода с реальными выступами', 'hard', 'implemented', 'clearance', [
    check('kitchen_real_projection_clearance_valid', 'true'),
  ], { applies: { roomTypes: KITCHENS, anyItemKinds: KITCHEN_ITEMS } }),
  rule('KIT006', 'Кухня', 'Одновременное открытие техники', 'hard', 'unsupported', 'time_expanded_access', [
    check('kitchen_required_open_states_valid', 'true'),
  ], { applies: { roomTypes: KITCHENS, anyItemKinds: KITCHEN_ITEMS } }),
  rule('KIT014', 'Кухня', 'Полное использование холодильника', 'conditional_hard', 'requires_external_data', 'manufacturer_clearances', [
    check('fridge_full_use_valid', 'true'),
  ], { basis: 'manufacturer', applies: { roomTypes: KITCHENS, anyItemKinds: ['fridge', 'fridge-side'] }, requiresData: ['appliance_manuals'], sourceIds: ['SERVICE-S06'] }),
  rule('KIT018', 'Кухня', 'Высота и совместимость вытяжки', 'conditional_hard', 'requires_external_data', 'manufacturer_clearances', [
    check('hood_installation_valid', 'true'),
  ], { basis: 'manufacturer', applies: { roomTypes: KITCHENS, anyItemKinds: ['cooktop-hood', 'hood'] }, requiresData: ['appliance_manuals'], sourceIds: ['SERVICE-S08'] }),
  rule('KIT031', 'Кухня', 'Закрепленные подключения', 'hard', 'requires_external_data', 'engineering_constraints', [
    check('fixed_engineering_connections_satisfied', 'true'),
  ], { applies: { roomTypes: KITCHENS, anyItemKinds: KITCHEN_ITEMS }, requiresData: ['fixed_engineering'] }),
  rule('KIT035', 'Кухня', 'Зазор позади посадки', 'soft', 'implemented', 'occupied_seating', [
    check('kitchen_seating_clearance_mm', 'gte', 813),
  ], { basis: 'published_guideline', applies: { roomTypes: KITCHENS, anyItemKinds: ['bar-counter', 'kitchen-island'] }, sourceIds: ['ROOM-S06'], parameters: { withoutTrafficMm: 813, edgePastMm: 914, walkPastMm: 1118, comfortTargetMm: [1200, 1400] } }),

  rule('BATH001', 'Санузлы', 'Исходные санитарные точки', 'hard', 'requires_external_data', 'engineering_constraints', [
    check('sanitary_connections_satisfied', 'true'),
  ], { applies: { roomTypes: BATHROOMS, anyItemKinds: BATH_ITEMS }, requiresData: ['fixed_engineering'] }),
  rule('BATH002', 'Санузлы', 'Свободное место спереди', 'soft', 'implemented', 'clearance', [
    check('bath_fixture_front_clearance_mm', 'gte', 762),
  ], { basis: 'published_guideline', applies: { roomTypes: BATHROOMS, anyItemKinds: BATH_ITEMS }, sourceIds: ['SERVICE-S02'], parameters: { recommendationMm: 762, comfortTargetMm: [900, 1200] } }),
  rule('BATH003', 'Санузлы', 'Боковой запас у унитаза', 'soft', 'implemented', 'clearance', [
    check('toilet_axis_side_clearance_mm', 'gte', 457),
  ], { basis: 'published_guideline', applies: { roomTypes: BATHROOMS, anyItemKinds: ['toilet'] }, sourceIds: ['SERVICE-S02'], parameters: { recommendationMm: 457 } }),
  rule('BATH005', 'Санузлы', 'Внутренний размер душа', 'soft', 'implemented', 'clearance', [
    check('shower_inner_width_mm', 'gte', 914), check('shower_inner_depth_mm', 'gte', 914),
  ], { basis: 'published_guideline', applies: { roomTypes: BATHROOMS, anyItemKinds: ['shower'] }, sourceIds: ['SERVICE-S02'], parameters: { recommendationMm: [914, 914] } }),
  rule('BATH006', 'Санузлы', 'Комфорт просторного душа', 'soft', 'implemented', 'clearance', [
    check('shower_inner_width_mm', 'gte', 1000), check('shower_inner_depth_mm', 'gte', 1200),
  ], { basis: 'design_heuristic', applies: { roomTypes: BATHROOMS, anyItemKinds: ['shower'] }, parameters: { comfortTargetMm: [1000, 1200] } }),
  rule('BATH010', 'Санузлы', 'Кинематика санузла', 'hard', 'implemented', 'swept_opening', [
    check('bath_kinematics_valid', 'true'),
  ], { applies: { roomTypes: BATHROOMS, anyItemKinds: BATH_ITEMS } }),
]);

const CURATED_INDEX = new Map(CURATED_LAYOUT_RULES.map((entry) => [entry.id, entry]));

function hasExternalValidationFlag(value) {
  if (!value || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some(hasExternalValidationFlag);
  return Object.entries(value).some(([key, nested]) => (
    (key === 'requires_external_validation' || key === 'model_manual_required' || key === 'lookup_required')
      && nested === true
  ) || hasExternalValidationFlag(nested));
}

function externalRequirements(canonical) {
  const required = [];
  if (canonical.basis === 'manufacturer') required.push('manufacturer_documentation');
  if (canonical.basis === 'regulation_profile') required.push('regulatory_profile');
  if (hasExternalValidationFlag(canonical.parameters)) required.push('external_validation');
  return [...new Set(required)];
}

function canonicalMetadata(canonical) {
  return {
    categoryCode: canonical.categoryCode,
    requirement: canonical.requirement,
    appliesWhen: canonical.appliesWhen,
    checkText: canonical.checkText,
    exceptions: canonical.exceptions,
    confidence: canonical.confidence,
    relatedRuleIds: canonical.relatedRuleIds,
    version: canonical.version,
    missingDataResult: canonical.missingDataResult,
  };
}

function catalogRule(canonical) {
  const curated = CURATED_INDEX.get(canonical.id);
  if (curated) return Object.freeze({
    ...curated,
    category: canonical.category,
    title: canonical.title,
    severity: canonical.severity,
    basis: canonical.basis,
    sourceIds: canonical.sourceIds,
    parameters: Object.freeze({ ...canonical.parameters, ...curated.parameters }),
    ...canonicalMetadata(canonical),
    binding: 'curated',
  });

  const requiresData = externalRequirements(canonical);
  return Object.freeze({
    id: canonical.id,
    category: canonical.category,
    title: canonical.title,
    severity: canonical.severity,
    implementation: requiresData.length ? 'requires_external_data' : 'unsupported',
    evaluator: 'declarative_specification',
    checks: Object.freeze([]),
    basis: canonical.basis,
    sourceIds: canonical.sourceIds,
    // applies_when — спецификация на русском языке, а не исполняемое условие.
    // До явной привязки применимость обязана оставаться unknown.
    applies: Object.freeze({ unresolved: true }),
    requiresData: Object.freeze(requiresData),
    parameters: canonical.parameters,
    ...canonicalMetadata(canonical),
    binding: 'canonical_only',
  });
}

// Полный каталог пакета. 44 записи имеют вручную проверенные привязки к
// метрикам; остальные сохранены как канонические спецификации и честно дают
// unknown, пока для них не появится исполняемый evaluator binding.
export const LAYOUT_RULES = Object.freeze(FURNITURE_RULE_CATALOG.map(catalogRule));

const INDEX = new Map(LAYOUT_RULES.map((entry) => [entry.id, entry]));

export function layoutRuleById(id) {
  return INDEX.get(id) || null;
}

function applicability(ruleEntry, context) {
  const supplied = context.ruleApplicability instanceof Map
    ? context.ruleApplicability.get(ruleEntry.id)
    : context.ruleApplicability?.[ruleEntry.id];
  if (supplied === true || supplied === false || supplied === 'unknown') return supplied;
  const { roomTypes = null, anyItemKinds = null, profiles = null } = ruleEntry.applies;
  if (roomTypes) {
    if (context.roomType == null) return 'unknown';
    if (!roomTypes.includes(context.roomType)) return false;
  }
  if (anyItemKinds) {
    if (!Array.isArray(context.itemKinds)) return 'unknown';
    if (!context.itemKinds.some((kind) => anyItemKinds.includes(kind))) return false;
  }
  if (profiles) {
    if (!Array.isArray(context.activeProfiles)) return 'unknown';
    if (!profiles.every((profile) => context.activeProfiles.includes(profile))) return false;
  }
  if (ruleEntry.applies.unresolved === true) return 'unknown';
  return true;
}

function suppliedRuleResult(entry, context) {
  const source = context.ruleResults || context.evaluatorResults;
  let supplied = null;
  if (source instanceof Map) supplied = source.get(entry.id);
  else if (Array.isArray(source)) supplied = source.find((result) => result?.ruleId === entry.id);
  else if (source && typeof source === 'object') supplied = source[entry.id];
  if (supplied == null) return null;
  const result = typeof supplied === 'string' ? { status: supplied } : supplied;
  if (!Object.values(RULE_STATUS).includes(result.status)) return null;
  return {
    ...result,
    ruleId: entry.id,
    status: result.status,
    severity: entry.severity,
    implementation: entry.implementation,
    blocking: result.status === 'fail'
      && (entry.severity === 'hard' || entry.severity === 'conditional_hard'),
    metricResults: Array.isArray(result.metricResults) ? result.metricResults : [],
    reason: result.reason || '',
  };
}

function sample(metrics, key) {
  if (!metrics || !Object.hasOwn(metrics, key)) return null;
  const raw = metrics[key];
  if (raw == null) return null;
  if (typeof raw === 'object' && !Array.isArray(raw)) {
    if (raw.known === false || raw.value == null) return null;
    return { value: raw.value, uncertainty: Math.max(0, Number(raw.uncertainty) || 0) };
  }
  return { value: raw, uncertainty: 0 };
}

function compare(measurement, spec, metrics) {
  if (!measurement) return { status: 'unknown', metric: spec.key, reason: `Нет метрики «${spec.key}»` };
  const { value, uncertainty: e } = measurement;
  const numeric = Number(value);
  let status = 'unknown';
  let threshold = spec.target;

  if (spec.op === 'true' || spec.op === 'false') {
    const wanted = spec.op === 'true';
    if (typeof value === 'boolean') status = value === wanted ? 'pass' : 'fail';
  } else if (spec.op === 'gteMetric') {
    const other = sample(metrics, spec.target);
    if (other && Number.isFinite(numeric) && Number.isFinite(Number(other.value))) {
      threshold = Number(other.value);
      const combined = e + other.uncertainty;
      if (numeric - combined >= threshold) status = 'pass';
      else if (numeric + combined < threshold) status = 'fail';
    }
  } else if (Number.isFinite(numeric)) {
    if (spec.op === 'gte') {
      if (numeric - e >= spec.target) status = 'pass';
      else if (numeric + e < spec.target) status = 'fail';
    } else if (spec.op === 'lte') {
      if (numeric + e <= spec.target) status = 'pass';
      else if (numeric - e > spec.target) status = 'fail';
    } else if (spec.op === 'between') {
      const [lo, hi] = spec.target;
      if (numeric - e >= lo && numeric + e <= hi) status = 'pass';
      else if (numeric + e < lo || numeric - e > hi) status = 'fail';
    }
  }
  return { status, metric: spec.key, value, uncertainty: e, op: spec.op, threshold };
}

export function evaluateLayoutRule(ruleOrId, context = {}) {
  const entry = typeof ruleOrId === 'string' ? layoutRuleById(ruleOrId) : ruleOrId;
  if (!entry) throw new Error(`Неизвестное правило авторасстановки: ${ruleOrId}`);
  const supplied = suppliedRuleResult(entry, context);
  if (supplied) return supplied;
  const applies = applicability(entry, context);
  if (applies === false) return {
    ruleId: entry.id, status: 'not_applicable', severity: entry.severity,
    implementation: entry.implementation, blocking: false, metricResults: [], reason: 'Правило неприменимо к этому контексту',
  };
  if (applies === 'unknown') return {
    ruleId: entry.id, status: 'unknown', severity: entry.severity,
    implementation: entry.implementation, blocking: false, metricResults: [], reason: 'Недостаточно данных для определения применимости',
  };
  if (entry.implementation === 'unsupported') return {
    ruleId: entry.id, status: 'unknown', severity: entry.severity,
    implementation: entry.implementation, blocking: false, metricResults: [], reason: `Проверяющий модуль «${entry.evaluator}» пока не реализован`,
  };
  const missing = entry.requiresData.filter((key) => !context.externalData?.[key]);
  if (missing.length) return {
    ruleId: entry.id, status: 'unknown', severity: entry.severity,
    implementation: entry.implementation, blocking: false, metricResults: [], reason: `Нужны внешние данные: ${missing.join(', ')}`,
  };
  const metricResults = entry.checks.map((spec) => compare(sample(context.metrics, spec.key), spec, context.metrics));
  const status = metricResults.some((result) => result.status === 'fail')
    ? 'fail'
    : metricResults.some((result) => result.status === 'unknown') ? 'unknown' : 'pass';
  return {
    ruleId: entry.id,
    status,
    severity: entry.severity,
    implementation: entry.implementation,
    blocking: status === 'fail' && (entry.severity === 'hard' || entry.severity === 'conditional_hard'),
    metricResults,
    reason: status === 'unknown' ? 'Не все требуемые метрики рассчитаны' : '',
  };
}

export function evaluateLayoutRules(context = {}, { ruleIds = null } = {}) {
  const entries = ruleIds == null
    ? LAYOUT_RULES
    : ruleIds.map((id) => {
      const entry = layoutRuleById(id);
      if (!entry) throw new Error(`Неизвестное правило авторасстановки: ${id}`);
      return entry;
    });
  return entries.map((entry) => evaluateLayoutRule(entry, context));
}

function countBy(entries, keyOf) {
  const out = {};
  for (const entry of entries) {
    const key = keyOf(entry);
    out[key] = (out[key] || 0) + 1;
  }
  return out;
}

export function layoutRuleCoverage(rules = LAYOUT_RULES) {
  const byImplementation = countBy(rules, (entry) => entry.implementation);
  const byBinding = countBy(rules, (entry) => entry.binding || 'unknown');
  return {
    total: rules.length,
    executable: byImplementation.implemented || 0,
    byImplementation,
    byBinding,
    bound: byBinding.curated || 0,
    canonicalOnly: byBinding.canonical_only || 0,
    bySeverity: countBy(rules, (entry) => entry.severity),
    byCategory: countBy(rules, (entry) => entry.category),
    catalogVersion: FURNITURE_RULE_CATALOG_METADATA.version,
    sourceSha256: FURNITURE_RULE_CATALOG_METADATA.sourceSha256,
  };
}

export function summarizeLayoutRuleResults(results) {
  const byStatus = countBy(results, (result) => result.status);
  const blocking = results.filter((result) => result.blocking).map((result) => result.ruleId);
  const unknownResults = results.filter((result) => result.status === 'unknown');
  const hardUnknown = unknownResults
    .filter((result) => result.severity === 'hard' || result.severity === 'conditional_hard')
    .map((result) => result.ruleId);
  const known = (byStatus.pass || 0) + (byStatus.fail || 0);
  const applicable = known + (byStatus.unknown || 0);
  return {
    total: results.length,
    byStatus,
    applicable,
    known,
    unknown: byStatus.unknown || 0,
    notApplicable: byStatus.not_applicable || 0,
    hardUnknown,
    unknownByImplementation: countBy(unknownResults, (result) => result.implementation),
    blocking,
    feasible: blocking.length === 0,
    verificationStatus: blocking.length
      ? 'invalid'
      : hardUnknown.length ? 'conceptual_only' : 'verified_for_known_rules',
    coverage: applicable ? known / applicable : 1,
  };
}
