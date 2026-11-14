// Контракты вычислителей пакета FURNITURE_RULES_PACKAGE_RU v1.0.0.
//
// Модуль намеренно не исполняет текстовые поля check из правил. Он задаёт
// стабильный API для 23 именованных вычислителей, реализует несколько чистых
// детерминированных примитивов и для отсутствующих/внешних расчётов возвращает
// unknown. Это не позволяет неполным данным случайно превратиться в pass.

import { furnitureDef } from './catalog.js';
import { compositeParts } from './composite.js';
import { itemShapes } from './clearance.js';
import { roomBoundaryEdges, roomContainsPoint, roomPolygon, roomRects } from './room-shape.js';

export const LAYOUT_EVALUATOR_STATUS = Object.freeze({
  PASS: 'pass',
  FAIL: 'fail',
  UNKNOWN: 'unknown',
});

const C = (id, exampleRuleIds, requiredInputs, returns, implementationKind, algorithmContract) => {
  const examples = Object.freeze(exampleRuleIds);
  const required = Object.freeze(requiredInputs);
  const outputs = Object.freeze(returns);
  return Object.freeze({
    id,
    // snake_case — исходный контракт пакета; camelCase — удобный JS API.
    example_rule_ids: examples,
    required_inputs: required,
    algorithm_contract: algorithmContract,
    implementation_kind: implementationKind,
    status: 'specification_only',
    exampleRuleIds: examples,
    requiredInputs: required,
    returns: outputs,
    implementationKind,
    algorithmContract,
  });
};

// Порядок и содержимое соответствуют EVALUATORS_RU.json из пакета правил.
export const LAYOUT_EVALUATORS = Object.freeze([
  C('polygon_validity', ['GEO001'], ['rings', 'coordinate_units'], ['validity', 'invalid_edges'], 'deterministic_geometry',
    'Проверить замкнутость, площадь, самопересечения, вложенность отверстий; точность не заменяет реальный допуск.'),
  C('support_and_containment', ['GEO006', 'GEO018'], ['room_floor_mesh', 'voids', 'object_support_contacts'], ['support_status', 'outside_parts'], 'deterministic_geometry',
    'Проверить опору каждого контакта и объем внутри доступного пространства; отверстия второго света вычтены.'),
  C('solid_collision_3d', ['GEO004', 'GEO005'], ['physical_volumes_per_state', 'transforms'], ['collision_pairs', 'intersection_geometry'], 'deterministic_geometry',
    'Broad-phase AABB, затем реальная 3D/многослойная narrow-phase; исключения сопряжений явные.'),
  C('swept_opening', ['GEO008', 'GEO009', 'KIT025'], ['kinematic_model', 'required_angle_or_extension', 'obstacles'], ['collision_intervals', 'reachable_open_fraction'], 'deterministic_geometry',
    'Проверить весь непрерывный ход либо консервативную ограниченную дискретизацию с доказанным запасом.'),
  C('activity_space', ['GEO013', 'GEO014', 'BED003'], ['actor_footprint', 'posture', 'item_state', 'approach_zones'], ['reachable', 'collision', 'clearance'], 'deterministic_geometry',
    'Совместить тело, позу, опоры и пространство действия; проверять вставание/посадку, не только позу.'),
  C('navmesh_connectivity', ['PATH001', 'PATH002'], ['free_space', 'agent_geometry', 'doors', 'level_connectors'], ['path_exists', 'path', 'path_length'], 'deterministic_geometry',
    'Configuration-space/navmesh либо search в SE(2) для ориентируемого тела. Учесть форму и этаж.'),
  C('bottleneck', ['PATH004', 'PATH020'], ['validated_path', 'occupied_obstacles', 'measurement_definition'], ['min_width', 'location', 'segment_length'], 'deterministic_geometry',
    'Найти минимум по пути, координату и длину сужения; средняя ширина не годится.'),
  C('time_expanded_access', ['GEO015', 'GEO016', 'KIT006'], ['states', 'transitions', 'actors', 'concurrency', 'profile_exclusions'], ['state_sequence', 'exit_reachable', 'conflicts'], 'deterministic_geometry',
    'Проверить доступную последовательность открытия/закрытия без trapping; не обходить запреты профиля.'),
  C('occupied_seating', ['DIN003', 'PATH007', 'KIT035'], ['table_edge', 'chair_and_user_state', 'obstacle'], ['total_depth', 'occupied_depth', 'residual_walkway'], 'deterministic_geometry',
    'Измерять table_to_obstruction и residual_walkway раздельно, с указанием позы.'),
  C('reachability', ['OFF006', 'WARD011'], ['body_model', 'working_pose', 'control_location', 'obstacles'], ['reachable', 'posture_cost'], 'deterministic_geometry',
    'Проверить досягаемость без пересечения тела и неудобной позы; применимые профили отдельно.'),
  C('visibility_rays', ['VIS001', 'LIV011', 'PRIV001'], ['eye_poses', 'targets', '3D_occluders'], ['visible_fraction', 'occluders', 'view_angle'], 'deterministic_geometry',
    'Лучевой тест по реальным глазам; доля видимой цели — проектная метрика без универсального порога.'),
  C('solar_and_glare', ['LGT004', 'LGT006'], ['geolocation', 'north', 'time', 'window_geometry', 'external_obstacles', 'reflectance', 'eye_pose'], ['sun_intervals', 'qualitative_glare_risk'], 'simulation',
    'Трассировка солнца и отражений. Без фотометрии только маркированный качественный риск, не расчет UGR/DGP.'),
  C('photometric_adapter', ['LGT018', 'LGT024'], ['IES_LDT', 'luminaire_flux', 'geometry', 'reflectances', 'task_planes'], ['illuminance', 'uniformity', 'glare_if_supported'], 'external_calculation',
    'Внешний светотехнический расчет с сохранением плоскостей, коэффициентов и версии входа.'),
  C('acoustic_adapter', ['ACOU004', 'ACOU005'], ['assembly_specs', 'source_levels', 'flanking_paths', 'absorptions'], ['supported_acoustic_metrics'], 'external_calculation',
    'Акустический расчет/измерение; отдельно реверберация и межкомнатная изоляция.'),
  C('manufacturer_clearances', ['SPA002', 'KIT018', 'CLIM005'], ['exact_model', 'manual_revision', 'installed_configuration'], ['clearance_checks', 'manual_reference'], 'catalog_and_geometry',
    'Извлечь требование из паспорта и проверить его конкретную геометрию. Без модели unknown.'),
  C('capacity', ['LIV002', 'DIN001'], ['seat_geometry', 'actor_profiles', 'mandatory_counts'], ['usable_count', 'unusable_seats'], 'deterministic_geometry',
    'Подсчитать только достижимые пригодные места; число иконок стульев не равно вместимости.'),
  C('storage_capacity', ['WARD001', 'STORE003'], ['inventory', 'usable_shelf_volumes', 'door_kinematics'], ['required_provided', 'unreachable_storage'], 'deterministic_geometry',
    'Проверить полезный объем и доступ по категории, массу/досягаемость отдельно.'),
  C('delivery_path', ['GEO019', 'SERV007'], ['package_geometry', 'approved_disassembly', 'route_3D'], ['transport_feasible', 'assembly_sequence'], 'deterministic_geometry',
    'Проверить перенос и повороты; для сложных лестниц SE(3) либо подтвержденная процедура.'),
  C('load_and_fixing', ['STORE005', 'SAFE001'], ['rated_load', 'actual_load', 'fixing_spec', 'substrate'], ['load_margin', 'fixing_status'], 'manufacturer_or_external',
    'Сверить нагрузку и проект крепления; неизвестное основание требует внешней проверки.'),
  C('profile_lookup', ['ACC001', 'IN020'], ['jurisdiction', 'building_scope', 'selected_profile', 'source_version'], ['active_constraints', 'missing_tables'], 'profile_engine',
    'Активировать только применимые пункты, их исключения и зависимые таблицы; не комбинировать версии.'),
  C('robust_threshold', ['GEO017', 'QA011'], ['measurement', 'uncertainty_bound', 'threshold'], ['status', 'lower_bound', 'upper_bound'], 'deterministic_geometry',
    'Для g±e: pass если g-e>=t; fail если g+e<t; иначе unknown. Статистические интервалы не подменять твердым bound.'),
  C('scenario_coordinator', ['SCN001', 'SCN004', 'SCN014'], ['actors', 'states', 'task_graph', 'concurrency'], ['required_results', 'comfort_results', 'unresolved_inputs'], 'orchestration',
    'Запустить связанные валидаторы для выбранных одновременных состояний; комфорт остается soft.'),
  C('score_composer', ['OPT001', 'OPT011', 'OPT012'], ['hard_results', 'soft_metrics', 'weights', 'fixed_scales', 'coverage'], ['rank', 'score', 'coverage', 'pareto_tradeoffs'], 'optimisation',
    'Сначала feasibility; затем нормированная utility с насыщением; одинаковая база сравнения, unknown отдельно.'),
]);

// Более явное имя удобно потребителям, которые хранят рядом реестр правил.
export const LAYOUT_EVALUATOR_CONTRACTS = LAYOUT_EVALUATORS;
export const LAYOUT_EVALUATORS_METADATA = Object.freeze({
  status: 'partial_runtime_implementation',
  count: 23,
  locallyImplementedCount: 17,
});

const EVALUATOR_INDEX = new Map(LAYOUT_EVALUATORS.map((entry) => [entry.id, entry]));

export function layoutEvaluatorById(id) {
  return EVALUATOR_INDEX.get(id) || null;
}

const hasValue = (object, key) => Object.hasOwn(object || {}, key) && object[key] !== null && object[key] !== undefined;
const finite = (value) => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
const pointOf = (raw) => Array.isArray(raw)
  ? { x: Number(raw[0]), y: Number(raw[1]) }
  : { x: Number(raw?.x), y: Number(raw?.y) };
const samePoint = (a, b, eps = 1e-9) => Math.abs(a.x - b.x) <= eps && Math.abs(a.y - b.y) <= eps;
const cross = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);

function ringArea(points) {
  let sum = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i]; const b = points[(i + 1) % points.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return sum / 2;
}

function onSegment(a, b, p, eps = 1e-9) {
  return Math.abs(cross(a, b, p)) <= eps && p.x >= Math.min(a.x, b.x) - eps && p.x <= Math.max(a.x, b.x) + eps &&
    p.y >= Math.min(a.y, b.y) - eps && p.y <= Math.max(a.y, b.y) + eps;
}

function segmentsIntersect(a, b, c, d) {
  const abC = cross(a, b, c); const abD = cross(a, b, d);
  const cdA = cross(c, d, a); const cdB = cross(c, d, b);
  if (((abC > 0 && abD < 0) || (abC < 0 && abD > 0)) && ((cdA > 0 && cdB < 0) || (cdA < 0 && cdB > 0))) return true;
  return onSegment(a, b, c) || onSegment(a, b, d) || onSegment(c, d, a) || onSegment(c, d, b);
}

function pointInRing(point, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const a = ring[i]; const b = ring[j];
    if (onSegment(a, b, point)) return true;
    if ((a.y > point.y) !== (b.y > point.y) && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function polygonValidity(input) {
  const raw = input.rings;
  const list = Array.isArray(raw) && raw.length && (Array.isArray(raw[0]) || typeof raw[0] === 'object')
    && (finite(raw[0]?.[0]) || finite(raw[0]?.x)) ? [raw] : raw;
  if (!Array.isArray(list) || !list.length) return {
    status: 'fail', output: { validity: false, invalid_edges: [{ ring: 0, edge: null, reason: 'rings_empty' }] },
  };
  const invalid = [];
  const rings = [];
  list.forEach((source, ri) => {
    if (!Array.isArray(source)) { invalid.push({ ring: ri, edge: null, reason: 'ring_not_array' }); rings.push([]); return; }
    const points = source.map(pointOf);
    if (points.some((p) => !finite(p.x) || !finite(p.y))) invalid.push({ ring: ri, edge: null, reason: 'non_finite_coordinate' });
    const explicitlyClosed = points.length > 1 && samePoint(points[0], points[points.length - 1]);
    if (!explicitlyClosed && input.implicit_close !== true) invalid.push({ ring: ri, edge: points.length - 1, reason: 'ring_open' });
    if (explicitlyClosed) points.pop();
    rings.push(points);
    if (points.length < 3 || new Set(points.map((p) => `${p.x}:${p.y}`)).size < 3) {
      invalid.push({ ring: ri, edge: null, reason: 'too_few_unique_points' });
      return;
    }
    if (Math.abs(ringArea(points)) <= 1e-9) invalid.push({ ring: ri, edge: null, reason: 'zero_area' });
    for (let i = 0; i < points.length; i += 1) {
      const a = points[i]; const b = points[(i + 1) % points.length];
      if (samePoint(a, b)) invalid.push({ ring: ri, edge: i, reason: 'zero_length_edge' });
      for (let j = i + 1; j < points.length; j += 1) {
        if (j === i || j === (i + 1) % points.length || i === (j + 1) % points.length) continue;
        if (segmentsIntersect(a, b, points[j], points[(j + 1) % points.length])) {
          invalid.push({ ring: ri, edge: i, other_edge: j, reason: 'self_intersection' });
        }
      }
    }
  });
  if (rings[0]?.length >= 3) {
    for (let i = 1; i < rings.length; i += 1) {
      if (rings[i].length >= 3 && !pointInRing(rings[i][0], rings[0])) invalid.push({ ring: i, edge: 0, reason: 'hole_outside_outer_ring' });
    }
  }
  const validity = invalid.length === 0;
  return { status: validity ? 'pass' : 'fail', output: { validity, invalid_edges: invalid } };
}

function box3(raw, transform = null) {
  const poly = Array.isArray(raw?.poly) ? raw.poly.map(pointOf) : null;
  const xs = poly?.map((p) => p.x); const ys = poly?.map((p) => p.y);
  let x0 = Array.isArray(raw?.min) ? Number(raw.min[0]) : Number(raw?.x0 ?? raw?.x ?? (xs?.length ? Math.min(...xs) : NaN));
  let y0 = Array.isArray(raw?.min) ? Number(raw.min[1]) : Number(raw?.y0 ?? raw?.y ?? (ys?.length ? Math.min(...ys) : NaN));
  let z0 = Array.isArray(raw?.min) ? Number(raw.min[2]) : Number(raw?.z0 ?? raw?.z ?? 0);
  let x1 = Array.isArray(raw?.max) ? Number(raw.max[0]) : Number(raw?.x1 ?? (finite(raw?.w) ? x0 + Number(raw.w) : (xs?.length ? Math.max(...xs) : NaN)));
  let y1 = Array.isArray(raw?.max) ? Number(raw.max[1]) : Number(raw?.y1 ?? (finite(raw?.h) ? y0 + Number(raw.h) : (ys?.length ? Math.max(...ys) : NaN)));
  let z1 = Array.isArray(raw?.max) ? Number(raw.max[2]) : Number(raw?.z1 ?? (finite(raw?.depth) ? z0 + Number(raw.depth) : NaN));
  const t = transform || {};
  x0 += Number(t.x) || 0; x1 += Number(t.x) || 0;
  y0 += Number(t.y) || 0; y1 += Number(t.y) || 0;
  z0 += Number(t.z) || 0; z1 += Number(t.z) || 0;
  if (![x0, y0, z0, x1, y1, z1].every(Number.isFinite) || x1 < x0 || y1 < y0 || z1 < z0) return null;
  return { x0, y0, z0, x1, y1, z1 };
}

function intersect3(a, b) {
  const x0 = Math.max(a.x0, b.x0); const y0 = Math.max(a.y0, b.y0); const z0 = Math.max(a.z0, b.z0);
  const x1 = Math.min(a.x1, b.x1); const y1 = Math.min(a.y1, b.y1); const z1 = Math.min(a.z1, b.z1);
  return x1 > x0 && y1 > y0 && z1 > z0 ? { x0, y0, z0, x1, y1, z1 } : null;
}

function solidCollision3d(input) {
  const source = Array.isArray(input.physical_volumes_per_state)
    ? { default: input.physical_volumes_per_state } : input.physical_volumes_per_state;
  if (!source || typeof source !== 'object') return null;
  const pairs = []; const geometry = [];
  for (const [state, rawVolumes] of Object.entries(source)) {
    if (!Array.isArray(rawVolumes)) continue;
    const volumes = rawVolumes.map((raw, index) => {
      const id = raw?.id ?? raw?.objectId ?? raw?.itemId ?? `volume-${index}`;
      const owner = raw?.objectId ?? raw?.itemId ?? id;
      const byState = input.transforms?.[state];
      const transform = byState?.[id] || input.transforms?.[id] || null;
      return { id, owner, box: box3(raw, transform) };
    }).filter((entry) => entry.box);
    for (let i = 0; i < volumes.length; i += 1) {
      for (let j = i + 1; j < volumes.length; j += 1) {
        if (volumes[i].owner === volumes[j].owner) continue;
        const intersection = intersect3(volumes[i].box, volumes[j].box);
        if (!intersection) continue;
        pairs.push({ state, a: volumes[i].id, b: volumes[j].id });
        geometry.push({ state, a: volumes[i].id, b: volumes[j].id, ...intersection });
      }
    }
  }
  return {
    status: pairs.length ? 'fail' : 'pass',
    output: { collision_pairs: pairs, intersection_geometry: geometry },
  };
}

function rectPolygon(rect) {
  if (!rect || ![rect.x, rect.y, rect.w, rect.h].every(finite) || !(Number(rect.w) >= 0) || !(Number(rect.h) >= 0)) return null;
  const x = Number(rect.x); const y = Number(rect.y); const w = Number(rect.w); const h = Number(rect.h);
  return [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }];
}

function circlePolygon(circle) {
  if (!finite(circle?.radius) || !(Number(circle.radius) > 0)) return null;
  const cx = Number(circle.x) || 0; const cy = Number(circle.y) || 0; const radius = Number(circle.radius);
  return Array.from({ length: 16 }, (_, index) => {
    const angle = (index * Math.PI * 2) / 16;
    return { x: cx + Math.cos(angle) * radius, y: cy + Math.sin(angle) * radius };
  });
}

function polygonOf(raw) {
  if (!raw) return null;
  const pointLike = (point) => Array.isArray(point)
    ? point.length >= 2 && finite(point[0]) && finite(point[1])
    : point && finite(point.x) && finite(point.y) && !hasValue(point, 'w') && !hasValue(point, 'h');
  if (Array.isArray(raw) && raw.length >= 3 && raw.every(pointLike)) {
    const points = raw.map(pointOf);
    if (points.length > 3 && samePoint(points[0], points[points.length - 1])) points.pop();
    return points;
  }
  if (raw.zone) return polygonOf(raw.zone);
  if (raw.poly) return polygonOf(raw.poly);
  if (raw.polygon) return polygonOf(raw.polygon);
  if (raw.points) return polygonOf(raw.points);
  if (raw.rect) return polygonOf(raw.rect);
  return rectPolygon(raw) || circlePolygon(raw);
}

function regionsOf(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    if (polygonOf(raw)) return [polygonOf(raw)];
    return raw.flatMap((entry) => regionsOf(entry));
  }
  for (const key of ['regions', 'polygons', 'triangles', 'rects', 'zones']) {
    if (Array.isArray(raw[key])) return raw[key].flatMap((entry) => regionsOf(entry));
  }
  const polygon = polygonOf(raw);
  return polygon ? [polygon] : [];
}

function polygonIntersects(a, b) {
  for (let i = 0; i < a.length; i += 1) {
    for (let j = 0; j < b.length; j += 1) {
      if (segmentsIntersect(a[i], a[(i + 1) % a.length], b[j], b[(j + 1) % b.length])) return true;
    }
  }
  return pointInRing(a[0], b) || pointInRing(b[0], a);
}

function polygonContained(inner, outer) {
  return inner.every((point) => pointInRing(point, outer));
}

function transformedPolygon(poly, pose = {}) {
  const rotation = ((Number(pose.rotation) || 0) * Math.PI) / 180;
  const c = Math.cos(rotation); const s = Math.sin(rotation);
  const x = Number(pose.x) || 0; const y = Number(pose.y) || 0;
  return poly.map((point) => ({ x: x + point.x * c - point.y * s, y: y + point.x * s + point.y * c }));
}

function polygonBounds(poly) {
  const xs = poly.map((point) => point.x); const ys = poly.map((point) => point.y);
  return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
}

function polygonGap(a, b) {
  if (polygonIntersects(a, b)) return 0;
  const A = polygonBounds(a); const B = polygonBounds(b);
  return rectGap(A, B);
}

function supportAndContainment(input) {
  const floor = regionsOf(input.room_floor_mesh);
  const voids = regionsOf(input.voids);
  if (!floor.length || !Array.isArray(input.object_support_contacts) || !input.object_support_contacts.length) return null;
  const contacts = [];
  const outside = [];
  for (let index = 0; index < input.object_support_contacts.length; index += 1) {
    const contact = input.object_support_contacts[index];
    const id = contact?.id ?? contact?.itemId ?? `contact-${index}`;
    const regions = regionsOf(contact);
    const explicitPoints = contact?.point
      ? [pointOf(contact.point)]
      : Array.isArray(contact?.points) ? contact.points.map(pointOf) : [];
    if (!regions.length && !explicitPoints.length) return null;
    const outsidePoints = [];
    for (const point of explicitPoints) {
      if (![point.x, point.y].every(Number.isFinite)) return null;
      const onFloor = floor.some((floorRegion) => pointInRing(point, floorRegion));
      const inVoid = voids.some((voidRegion) => pointInRing(point, voidRegion));
      if (!onFloor || inVoid) outsidePoints.push({ ...point });
    }
    for (const region of regions) {
      const onFloor = floor.some((floorRegion) => polygonContained(region, floorRegion));
      const inVoid = voids.some((voidRegion) => polygonIntersects(region, voidRegion));
      if (!onFloor || inVoid) outsidePoints.push(...region.map((point) => ({ ...point })));
    }
    const supported = outsidePoints.length === 0;
    contacts.push({ id, supported });
    if (!supported) outside.push({ id, outside_points: outsidePoints });
  }
  return {
    status: outside.length ? 'fail' : 'pass',
    output: { support_status: { valid: outside.length === 0, contacts }, outside_parts: outside },
  };
}

function openingProgress(pose, required) {
  if (finite(pose?.fraction)) return Number(pose.fraction);
  if (finite(pose?.progress)) return Number(pose.progress);
  if (finite(pose?.angle) && required > 0) return Math.abs(Number(pose.angle)) / required;
  if (finite(pose?.extension) && required > 0) return Math.abs(Number(pose.extension)) / required;
  return null;
}

function sweptOpening(input) {
  const poses = Array.isArray(input.kinematic_model) ? input.kinematic_model : input.kinematic_model?.poses;
  const required = Number(typeof input.required_angle_or_extension === 'object'
    ? input.required_angle_or_extension?.value : input.required_angle_or_extension);
  const obstacles = (Array.isArray(input.obstacles) ? input.obstacles : []).map((obstacle, index) => ({
    id: obstacle?.id ?? `obstacle-${index}`, regions: regionsOf(obstacle),
  }));
  if (!Array.isArray(poses) || !poses.length || !(required > 0) || obstacles.some((obstacle) => !obstacle.regions.length)) return null;
  const samples = poses.map((pose, index) => ({
    index,
    progress: openingProgress(pose, required),
    regions: regionsOf(pose?.zones ?? pose?.zone ?? pose?.geometry ?? pose?.parts),
  })).filter((sample) => sample.progress !== null && sample.regions.length);
  if (!samples.length) return null;
  samples.sort((a, b) => a.progress - b.progress || a.index - b.index);
  const tested = samples.map((sample) => {
    const hitIds = obstacles.filter((obstacle) => sample.regions.some((zone) =>
      obstacle.regions.some((region) => polygonIntersects(zone, region)))).map((obstacle) => obstacle.id);
    return { ...sample, hitIds };
  });
  const colliding = tested.filter((sample) => sample.hitIds.length && sample.progress <= 1 + 1e-9);
  const intervals = [];
  for (const sample of colliding) {
    const sortedIndex = tested.indexOf(sample);
    const previous = intervals[intervals.length - 1];
    if (previous && sortedIndex === previous.lastIndex + 1) {
      previous.to = sample.progress; previous.lastIndex = sortedIndex;
      previous.obstacle_ids = [...new Set([...previous.obstacle_ids, ...sample.hitIds])];
    } else intervals.push({ from: sample.progress, to: sample.progress, lastIndex: sortedIndex, obstacle_ids: [...sample.hitIds] });
  }
  for (const interval of intervals) delete interval.lastIndex;
  const firstHit = colliding[0];
  const clearPrefix = tested.filter((sample) => sample.progress <= 1 + 1e-9 && (!firstHit || sample.progress < firstHit.progress) && !sample.hitIds.length);
  const reached = clearPrefix.length ? Math.max(...clearPrefix.map((sample) => sample.progress)) : 0;
  const covered = tested[0].progress <= 1e-9 && tested[tested.length - 1].progress >= 1 - 1e-9;
  const reachable = colliding.length ? Math.max(0, Math.min(1, reached)) : covered ? 1 : Math.max(0, Math.min(1, reached));
  return {
    status: colliding.length ? 'fail' : covered ? 'pass' : 'unknown',
    reason: covered || colliding.length ? '' : 'Дискретные позы не покрывают весь требуемый ход',
    output: { collision_intervals: intervals, reachable_open_fraction: reachable },
  };
}

function activitySpace(input) {
  const footprint = polygonOf(input.actor_footprint);
  const poses = Array.isArray(input.posture)
    ? input.posture
    : Array.isArray(input.posture?.poses) ? input.posture.poses : input.posture && typeof input.posture === 'object' ? [input.posture] : null;
  const zones = regionsOf(input.approach_zones);
  const obstacles = regionsOf(input.item_state?.obstacles ?? input.item_state?.occupied ?? []);
  if (!footprint || !Array.isArray(poses) || !poses.length || !zones.length) return null;
  const candidates = poses.map((pose, index) => {
    const body = polygonOf(pose?.footprint) || transformedPolygon(footprint, pose);
    const inZone = zones.some((zone) => polygonContained(body, zone));
    const collision = obstacles.some((obstacle) => polygonIntersects(body, obstacle));
    const gaps = obstacles.map((obstacle) => polygonGap(body, obstacle));
    return {
      id: pose?.id ?? index,
      valid: inZone && !collision,
      inZone,
      collision,
      clearance: gaps.length ? Math.min(...gaps) : null,
    };
  });
  const valid = candidates.filter((candidate) => candidate.valid)
    .sort((a, b) => (b.clearance ?? Infinity) - (a.clearance ?? Infinity) || String(a.id).localeCompare(String(b.id)));
  const selected = valid[0] || null;
  const reachable = Boolean(selected);
  return {
    status: reachable ? 'pass' : 'fail',
    output: {
      reachable,
      collision: !reachable && candidates.some((candidate) => candidate.collision),
      clearance: selected?.clearance ?? null,
    },
  };
}

function graphNodeId(value) {
  const raw = value && typeof value === 'object' ? value.node ?? value.cell ?? value.id : value;
  return raw === null || raw === undefined ? null : String(raw);
}

function addGraphEdge(graph, from, to, length = 1, bidirectional = true) {
  const a = graphNodeId(from); const b = graphNodeId(to);
  if (a === null || b === null) return false;
  if (!graph.has(a)) graph.set(a, []);
  if (!graph.has(b)) graph.set(b, []);
  graph.get(a).push({ to: b, length: finite(length) ? Number(length) : 1 });
  if (bidirectional) graph.get(b).push({ to: a, length: finite(length) ? Number(length) : 1 });
  return true;
}

function suppliedGraph(freeSpace, levelConnectors) {
  const graph = new Map();
  const source = freeSpace?.graph;
  if (source instanceof Map) {
    for (const [from, neighbors] of source) {
      for (const neighbor of neighbors || []) {
        const object = neighbor && typeof neighbor === 'object';
        addGraphEdge(graph, from, object ? neighbor.to : neighbor, object ? neighbor.length : 1, false);
      }
    }
  } else if (Array.isArray(source)) {
    for (const edge of source) {
      if (Array.isArray(edge)) addGraphEdge(graph, edge[0], edge[1], edge[2], edge[3] !== false);
      else addGraphEdge(graph, edge?.from, edge?.to, edge?.length, edge?.bidirectional !== false);
    }
  } else if (source && typeof source === 'object') {
    for (const [from, neighbors] of Object.entries(source)) {
      if (!graph.has(from)) graph.set(from, []);
      for (const neighbor of neighbors || []) {
        const object = neighbor && typeof neighbor === 'object';
        addGraphEdge(graph, from, object ? neighbor.to : neighbor, object ? neighbor.length : 1, false);
      }
    }
  }
  if (!graph.size && finite(freeSpace?.cols) && finite(freeSpace?.rows) && freeSpace?.free != null) {
    const cols = Number(freeSpace.cols); const rows = Number(freeSpace.rows); const mask = freeSpace.free;
    if (!(cols > 0 && rows > 0 && mask.length >= cols * rows)) return null;
    for (let index = 0; index < cols * rows; index += 1) {
      if (!mask[index]) continue;
      if (!graph.has(String(index))) graph.set(String(index), []);
      const x = index % cols; const y = Math.floor(index / cols);
      for (const [nx, ny] of [[x + 1, y], [x, y + 1]]) {
        const next = ny * cols + nx;
        if (nx < cols && ny < rows && mask[next]) addGraphEdge(graph, index, next, Number(freeSpace.cell) || 1, true);
      }
    }
  }
  for (const connector of levelConnectors || []) {
    if (Array.isArray(connector)) addGraphEdge(graph, connector[0], connector[1], connector[2], connector[3] !== false);
    else addGraphEdge(graph, connector?.from, connector?.to, connector?.length, connector?.bidirectional !== false);
  }
  for (const neighbors of graph.values()) neighbors.sort((a, b) => a.to.localeCompare(b.to) || a.length - b.length);
  return graph.size ? graph : null;
}

function graphSearch(graph, start) {
  const seen = new Set([start]); const queue = [start]; const parent = new Map();
  for (let index = 0; index < queue.length; index += 1) {
    const node = queue[index];
    for (const edge of graph.get(node) || []) {
      if (seen.has(edge.to)) continue;
      seen.add(edge.to); queue.push(edge.to); parent.set(edge.to, { node, length: edge.length });
    }
  }
  return { seen, parent };
}

function restorePath(parent, start, goal) {
  if (goal === start) return { path: [start], length: 0 };
  const path = [goal]; let length = 0; let node = goal;
  while (node !== start) {
    const edge = parent.get(node);
    if (!edge) return null;
    length += edge.length; node = edge.node; path.push(node);
  }
  return { path: path.reverse(), length };
}

function navmeshConnectivity(input) {
  const graph = suppliedGraph(input.free_space, input.level_connectors);
  const doors = Array.isArray(input.doors) ? input.doors : [];
  if (!graph) return null;
  const doorNodes = doors.map(graphNodeId).filter((node) => node !== null);
  const start = graphNodeId(input.free_space?.start) ?? doorNodes[0] ?? null;
  const explicitGoals = Array.isArray(input.free_space?.goals)
    ? input.free_space.goals : hasValue(input.free_space, 'goal') ? [input.free_space.goal] : null;
  const goals = (explicitGoals || doors.slice(1).filter((door) => door?.required !== false)).map(graphNodeId).filter((node) => node !== null);
  if (start === null || !goals.length || !graph.has(start)) return null;
  const search = graphSearch(graph, start);
  const missing = goals.filter((goal) => !search.seen.has(goal));
  const target = goals[goals.length - 1];
  const restored = missing.length ? null : restorePath(search.parent, start, target);
  return {
    status: missing.length ? 'fail' : 'pass',
    output: {
      path_exists: missing.length === 0,
      path: restored?.path || [],
      path_length: restored?.length ?? null,
    },
  };
}

function timeExpandedAccess(input) {
  const rawStates = Array.isArray(input.states) ? input.states : input.states?.nodes;
  const transitions = Array.isArray(input.transitions) ? input.transitions : input.transitions?.edges;
  if (!Array.isArray(rawStates) || !rawStates.length || !Array.isArray(transitions)) return null;
  const states = rawStates.map((state) => typeof state === 'object' ? state : { id: state });
  const initial = graphNodeId(input.states?.initial) ?? graphNodeId(states.find((state) => state.initial));
  const explicitGoals = Array.isArray(input.states?.goals) ? input.states.goals.map(graphNodeId) : [];
  const goals = explicitGoals.length ? explicitGoals : states.filter((state) => state.exit_reachable === true || state.goal === true).map(graphNodeId);
  if (initial === null || !goals.length) return null;
  const actorIds = new Set((input.actors || []).map((actor) => graphNodeId(actor)).filter((id) => id !== null));
  const excludedStates = new Set(Array.isArray(input.profile_exclusions)
    ? input.profile_exclusions.map(graphNodeId)
    : (input.profile_exclusions?.states || []).map(graphNodeId));
  const excludedTransitions = new Set(Array.isArray(input.profile_exclusions?.transitions)
    ? input.profile_exclusions.transitions.map(graphNodeId) : []);
  const forbidden = new Set((input.concurrency?.forbidden_transitions || []).map(graphNodeId));
  const graph = new Map(states.map((state) => [graphNodeId(state), []]));
  const conflicts = [];
  transitions.forEach((transition, index) => {
    const edge = Array.isArray(transition) ? { from: transition[0], to: transition[1], id: transition[2] } : transition;
    const id = graphNodeId(edge?.id) ?? `transition-${index}`;
    const from = graphNodeId(edge?.from); const to = graphNodeId(edge?.to);
    let reason = null;
    if (!graph.has(from) || !graph.has(to)) reason = 'unknown_state';
    else if (edge?.allowed === false || excludedTransitions.has(id) || forbidden.has(id)) reason = 'excluded';
    else if (excludedStates.has(from) || excludedStates.has(to)) reason = 'excluded_state';
    else if (Array.isArray(edge?.actors) && edge.actors.some((actor) => !actorIds.has(graphNodeId(actor)))) reason = 'missing_actor';
    else if (edge?.conflict === true) reason = 'concurrency_conflict';
    if (reason) { conflicts.push({ transition: id, reason }); return; }
    graph.get(from).push({ to, length: 1 });
    if (edge?.bidirectional === true) graph.get(to).push({ to: from, length: 1 });
  });
  if (excludedStates.has(initial) || !graph.has(initial)) {
    return { status: 'fail', output: { state_sequence: [], exit_reachable: false, conflicts } };
  }
  const search = graphSearch(graph, initial);
  const goal = goals.find((candidate) => search.seen.has(candidate));
  const path = goal ? restorePath(search.parent, initial, goal)?.path || [] : [];
  return {
    status: goal ? 'pass' : 'fail',
    output: { state_sequence: path, exit_reachable: Boolean(goal), conflicts },
  };
}

function point3(raw) {
  if (Array.isArray(raw)) return { x: Number(raw[0]), y: Number(raw[1]), z: Number(raw[2]) || 0 };
  return { x: Number(raw?.x), y: Number(raw?.y), z: Number(raw?.z) || 0 };
}

function reachability(input) {
  const poses = Array.isArray(input.working_pose)
    ? input.working_pose
    : Array.isArray(input.working_pose?.poses) ? input.working_pose.poses
      : input.working_pose && typeof input.working_pose === 'object' ? [input.working_pose] : null;
  const controls = Array.isArray(input.control_location) && input.control_location.length && typeof input.control_location[0] !== 'number'
    ? input.control_location : [input.control_location];
  const maxReach = Number(input.body_model?.max_reach ?? input.body_model?.reach);
  const obstacles = (Array.isArray(input.obstacles) ? input.obstacles : []).filter((obstacle) => obstacle?.blocks_reach !== false)
    .map((obstacle) => polygonOf(obstacle)).filter(Boolean);
  if (!Array.isArray(poses) || !poses.length || !controls.length || !(maxReach > 0)) return null;
  const candidates = [];
  for (const [poseIndex, pose] of poses.entries()) {
    const originRaw = pose?.hand ?? pose?.anchor ?? pose?.position;
    if (!originRaw) continue;
    const origin = point3(originRaw);
    if (![origin.x, origin.y, origin.z].every(Number.isFinite)) continue;
    const poseReach = Number(pose?.max_reach ?? maxReach);
    for (const [controlIndex, controlRaw] of controls.entries()) {
      const control = point3(controlRaw);
      if (![control.x, control.y, control.z].every(Number.isFinite)) continue;
      const distance = Math.hypot(control.x - origin.x, control.y - origin.y, control.z - origin.z);
      const blocked = obstacles.some((obstacle) => {
        if (pointInRing(origin, obstacle) || pointInRing(control, obstacle)) return true;
        for (let i = 0; i < obstacle.length; i += 1) {
          if (segmentsIntersect(origin, control, obstacle[i], obstacle[(i + 1) % obstacle.length])) return true;
        }
        return false;
      });
      candidates.push({
        pose: pose?.id ?? poseIndex,
        control: controlRaw?.id ?? controlIndex,
        reachable: distance <= poseReach + 1e-9 && !blocked,
        cost: Number(pose?.posture_cost ?? pose?.cost ?? 0),
      });
    }
  }
  if (!candidates.length) return null;
  const reached = candidates.filter((candidate) => candidate.reachable).sort((a, b) => a.cost - b.cost || String(a.pose).localeCompare(String(b.pose)));
  return {
    status: reached.length ? 'pass' : 'fail',
    output: { reachable: reached.length > 0, posture_cost: reached[0]?.cost ?? null },
  };
}

function visibilityRays(input) {
  const rays = [];
  for (const eye of input.eye_poses || []) {
    for (const ray of eye?.rays || []) rays.push({ ...ray, eye_id: ray.eye_id ?? eye.id });
  }
  for (const target of input.targets || []) {
    for (const ray of target?.rays || []) rays.push({ ...ray, target_id: ray.target_id ?? target.id });
  }
  const explicit = rays.filter((ray) => typeof ray.visible === 'boolean' || typeof ray.blocked === 'boolean' || ray.hit != null);
  if (!explicit.length) return null;
  const targetIds = (input.targets || []).map((target) => target?.id).filter((id) => id !== null && id !== undefined);
  if (targetIds.some((id) => !explicit.some((ray) => ray.target_id === id))) return null;
  const isVisible = (ray) => typeof ray.visible === 'boolean' ? ray.visible : typeof ray.blocked === 'boolean' ? !ray.blocked : false;
  const visible = explicit.filter(isVisible).length;
  const occluders = [...new Set(explicit.filter((ray) => !isVisible(ray)).map((ray) =>
    ray.occluder_id ?? ray.hit?.id ?? ray.hit).filter((id) => id !== null && id !== undefined))];
  const angles = explicit.map((ray) => Number(ray.view_angle)).filter(Number.isFinite);
  return {
    status: 'pass',
    output: {
      visible_fraction: visible / explicit.length,
      occluders,
      view_angle: angles.length ? angles.reduce((sum, angle) => sum + angle, 0) / angles.length : null,
    },
  };
}

function storageCapacity(input) {
  const inventory = Array.isArray(input.inventory)
    ? input.inventory
    : Object.entries(input.inventory || {}).map(([category, required]) => ({ category, required }));
  const shelves = Array.isArray(input.usable_shelf_volumes) ? input.usable_shelf_volumes : [];
  if (!inventory.length || !shelves.length) return null;
  const required = new Map();
  for (const entry of inventory) {
    const category = String(entry?.category ?? 'all');
    const amount = Number(entry?.required ?? (finite(entry?.volume) ? Number(entry.volume) * (Number(entry.count) || 1) : NaN));
    if (!Number.isFinite(amount) || amount < 0) return null;
    required.set(category, (required.get(category) || 0) + amount);
  }
  const doorMap = new Map();
  if (Array.isArray(input.door_kinematics)) {
    for (const door of input.door_kinematics) doorMap.set(String(door?.shelf_id ?? door?.id), door?.accessible ?? door?.reachable);
  } else if (input.door_kinematics && typeof input.door_kinematics === 'object') {
    for (const [id, value] of Object.entries(input.door_kinematics)) doorMap.set(id, typeof value === 'object' ? value.accessible ?? value.reachable : value);
  }
  const provided = new Map(); const unreachable = []; const unresolved = [];
  shelves.forEach((shelf, index) => {
    const id = String(shelf?.id ?? `shelf-${index}`);
    const amount = Number(shelf?.usable_volume ?? shelf?.volume);
    if (!Number.isFinite(amount) || amount < 0) { unresolved.push(id); return; }
    const accessible = typeof shelf?.reachable === 'boolean' ? shelf.reachable : doorMap.get(id);
    if (accessible === false) { unreachable.push(id); return; }
    if (accessible !== true) { unresolved.push(id); return; }
    if (shelf?.allocations && typeof shelf.allocations === 'object') {
      const allocations = Object.entries(shelf.allocations);
      const total = allocations.reduce((sum, [, value]) => sum + (finite(value) ? Number(value) : NaN), 0);
      if (!Number.isFinite(total) || total > amount + 1e-9) { unresolved.push(id); return; }
      for (const [category, value] of allocations) provided.set(category, (provided.get(category) || 0) + Number(value));
      return;
    }
    const categories = Array.isArray(shelf?.categories) ? shelf.categories.map(String) : [String(shelf?.category ?? 'all')];
    if (categories.length !== 1) { unresolved.push(id); return; }
    provided.set(categories[0], (provided.get(categories[0]) || 0) + amount);
  });
  const result = {};
  let short = false;
  let generic = provided.get('all') || 0;
  for (const [category, amount] of required) {
    const dedicated = provided.get(category) || 0;
    const usedGeneric = category === 'all' ? 0 : Math.min(generic, Math.max(0, amount - dedicated));
    if (category !== 'all') generic -= usedGeneric;
    const available = dedicated + usedGeneric;
    result[category] = { required: amount, provided: available, ok: available >= amount };
    if (available < amount) short = true;
  }
  const status = unresolved.length ? 'unknown' : short ? 'fail' : 'pass';
  return {
    status,
    reason: unresolved.length && !short ? `Неизвестна доступность хранения: ${unresolved.join(', ')}` : '',
    output: { required_provided: result, unreachable_storage: unreachable, unresolved_storage: unresolved },
  };
}

function sampleFits3d(sample) {
  if (typeof sample?.fits === 'boolean') return sample.fits;
  if (typeof sample?.collision === 'boolean') return !sample.collision;
  const item = box3(sample?.package_box || sample?.package, null);
  const free = box3(sample?.free_box || sample?.clearance_box, null);
  if (!item || !free) return null;
  return item.x0 >= free.x0 && item.y0 >= free.y0 && item.z0 >= free.z0 &&
    item.x1 <= free.x1 && item.y1 <= free.y1 && item.z1 <= free.z1;
}

function route3dResult(route) {
  const samples = Array.isArray(route) ? route : route?.samples;
  if (!Array.isArray(samples) || !samples.length) return null;
  const fits = samples.map(sampleFits3d);
  if (fits.some((value) => value === null)) return null;
  if (fits.some((value) => value === false)) return { feasible: false, complete: route?.complete === true };
  return { feasible: true, complete: Array.isArray(route) ? false : route.complete === true };
}

function deliveryPath(input) {
  const direct = route3dResult(input.route_3D);
  if (!direct) return null;
  const sequence = Array.isArray(input.approved_disassembly)
    ? input.approved_disassembly
    : Array.isArray(input.approved_disassembly?.sequence) ? input.approved_disassembly.sequence : [];
  if (direct.feasible && direct.complete) {
    return { status: 'pass', output: { transport_feasible: true, assembly_sequence: sequence } };
  }
  if (direct.feasible && !direct.complete) {
    return {
      status: 'unknown', reason: 'Маршрут не помечен как полный',
      output: { transport_feasible: null, assembly_sequence: sequence },
    };
  }
  const approved = input.approved_disassembly?.approved === true;
  const partRoutes = input.route_3D?.part_routes;
  if (approved && partRoutes && typeof partRoutes === 'object') {
    const results = Object.values(partRoutes).map(route3dResult);
    if (results.length && results.every((result) => result?.feasible && result.complete)) {
      return { status: 'pass', output: { transport_feasible: true, assembly_sequence: sequence } };
    }
    if (results.some((result) => result?.feasible === false)) {
      return { status: 'fail', output: { transport_feasible: false, assembly_sequence: sequence } };
    }
    return {
      status: 'unknown', reason: 'Не все маршруты разобранных частей подтверждены',
      output: { transport_feasible: null, assembly_sequence: sequence },
    };
  }
  return { status: 'fail', output: { transport_feasible: false, assembly_sequence: sequence } };
}

function bottleneck(input) {
  const points = Array.isArray(input.validated_path) ? input.validated_path : input.validated_path?.points;
  const widths = Array.isArray(input.measurement_definition?.widths) ? input.measurement_definition.widths : null;
  if (!Array.isArray(points) || !points.length) return null;
  const samples = points.map((point, index) => ({
    point,
    width: Number(point?.width ?? widths?.[index]),
    segmentLength: Number(point?.segment_length ?? input.measurement_definition?.segment_length ?? 0),
  })).filter((entry) => Number.isFinite(entry.width));
  if (!samples.length) return null;
  samples.sort((a, b) => a.width - b.width);
  const best = samples[0];
  return {
    status: 'pass',
    output: { min_width: best.width, location: pointOf(best.point), segment_length: best.segmentLength },
  };
}

function occupiedSeating(input) {
  const total = Number(input.table_edge?.to_obstacle ?? input.table_edge?.total_depth ?? input.obstacle?.distance);
  const occupied = Number(input.chair_and_user_state?.occupied_depth);
  if (!Number.isFinite(total) || !Number.isFinite(occupied)) return null;
  return {
    status: 'pass',
    output: { total_depth: total, occupied_depth: occupied, residual_walkway: total - occupied },
  };
}

function capacity(input) {
  const rawSeats = Array.isArray(input.seat_geometry) ? input.seat_geometry : input.seat_geometry?.seats;
  const required = finite(input.mandatory_counts)
    ? Number(input.mandatory_counts)
    : Object.values(input.mandatory_counts || {}).reduce((sum, value) => sum + (finite(value) ? Number(value) : 0), 0);
  if (!Array.isArray(rawSeats)) return null;
  const unusable = rawSeats.filter((seat) => seat?.usable === false || seat?.reachable === false || seat?.collision === true)
    .map((seat, index) => seat?.id ?? index);
  const usable = rawSeats.length - unusable.length;
  return {
    status: usable >= required ? 'pass' : 'fail',
    output: { usable_count: usable, unusable_seats: unusable },
  };
}

function robustThreshold(input) {
  const measurement = Number(typeof input.measurement === 'object' ? input.measurement?.value : input.measurement);
  const uncertainty = Number(input.uncertainty_bound);
  const threshold = Number(typeof input.threshold === 'object' ? input.threshold?.value : input.threshold);
  if (![measurement, uncertainty, threshold].every(Number.isFinite) || uncertainty < 0) return null;
  const lower = measurement - uncertainty; const upper = measurement + uncertainty;
  const status = lower >= threshold ? 'pass' : upper < threshold ? 'fail' : 'unknown';
  return { status, output: { status, lower_bound: lower, upper_bound: upper } };
}

function loadAndFixing(input) {
  const rated = Number(input.rated_load); const actual = Number(input.actual_load);
  if (!Number.isFinite(rated) || !Number.isFinite(actual)) return null;
  const fixing = input.fixing_spec?.verified === true && input.substrate?.verified === true
    ? 'verified' : input.fixing_spec?.verified === false || input.substrate?.verified === false ? 'invalid' : 'unknown';
  const margin = rated - actual;
  const status = margin < 0 || fixing === 'invalid' ? 'fail' : fixing === 'verified' ? 'pass' : 'unknown';
  return { status, output: { load_margin: margin, fixing_status: fixing } };
}

function scoreComposer(input) {
  const hard = Array.isArray(input.hard_results) ? input.hard_results : [];
  const hardFail = hard.some((entry) => (entry?.status || entry) === 'fail');
  const hardUnknown = hard.some((entry) => (entry?.status || entry) === 'unknown');
  const metrics = Array.isArray(input.soft_metrics)
    ? input.soft_metrics
    : Object.entries(input.soft_metrics || {}).map(([id, value]) => ({ id, value }));
  let weighted = 0; let weightSum = 0;
  for (const metric of metrics) {
    const id = metric.id || metric.key;
    const value = Number(metric.value);
    const weight = Number(metric.weight ?? input.weights?.[id] ?? 1);
    const scaleRaw = metric.scale ?? input.fixed_scales?.[id] ?? 1;
    const scale = typeof scaleRaw === 'object' ? Number(scaleRaw.max ?? scaleRaw.range ?? 1) : Number(scaleRaw);
    if (!Number.isFinite(value) || !(weight > 0) || !(scale > 0)) continue;
    const utility = Math.max(0, Math.min(1, value / scale));
    weighted += utility * weight; weightSum += weight;
  }
  const coverage = Number(input.coverage);
  const score = hardFail || !weightSum ? (hardFail ? null : 0) : weighted / weightSum;
  const status = hardFail ? 'fail' : hardUnknown || !Number.isFinite(coverage) ? 'unknown' : 'pass';
  return {
    status,
    output: {
      rank: input.rank ?? null,
      score,
      coverage: Number.isFinite(coverage) ? coverage : null,
      pareto_tradeoffs: Array.isArray(input.pareto_tradeoffs) ? input.pareto_tradeoffs : [],
    },
  };
}

const LOCAL_EVALUATORS = Object.freeze({
  polygon_validity: polygonValidity,
  support_and_containment: supportAndContainment,
  solid_collision_3d: solidCollision3d,
  swept_opening: sweptOpening,
  activity_space: activitySpace,
  navmesh_connectivity: navmeshConnectivity,
  bottleneck,
  time_expanded_access: timeExpandedAccess,
  occupied_seating: occupiedSeating,
  reachability,
  visibility_rays: visibilityRays,
  capacity,
  storage_capacity: storageCapacity,
  delivery_path: deliveryPath,
  load_and_fixing: loadAndFixing,
  robust_threshold: robustThreshold,
  score_composer: scoreComposer,
});

function resultOf(contract, status, output = {}, details = {}) {
  return {
    evaluator: contract.id,
    status,
    known: status !== 'unknown',
    output,
    missingInputs: details.missingInputs || [],
    source: details.source || 'kepler',
    reason: details.reason || '',
  };
}

function normalizeAdapterResult(contract, raw) {
  if (!raw || typeof raw !== 'object') return null;
  const status = Object.values(LAYOUT_EVALUATOR_STATUS).includes(raw.status) ? raw.status : null;
  if (!status) return null;
  const output = raw.output && typeof raw.output === 'object'
    ? raw.output : Object.fromEntries(contract.returns.filter((key) => Object.hasOwn(raw, key)).map((key) => [key, raw[key]]));
  return resultOf(contract, status, output, { source: raw.source || 'adapter', reason: raw.reason || '' });
}

/**
 * Выполнить именованный evaluator.
 *
 * input содержит поля requiredInputs контракта. context может передать
 * evaluatorAdapters[id](input, context) для внешнего или более точного
 * расчёта. Адаптер обязан вернуть { status, output }; Promise не принимается,
 * поэтому сам API остаётся синхронным и детерминированным.
 */
export function evaluateLayoutEvaluator(name, input = {}, context = {}) {
  const contract = layoutEvaluatorById(name);
  if (!contract) throw new Error(`Неизвестный evaluator расстановки: ${name}`);
  // Допустим и единый envelope evaluate(name, { input, context }).
  if (input && typeof input === 'object' && hasValue(input, 'input')) {
    context = input.context && typeof input.context === 'object' ? input.context : context;
    input = input.input;
  }
  const missingInputs = contract.requiredInputs.filter((key) => !hasValue(input, key));
  if (missingInputs.length) {
    return resultOf(contract, 'unknown', {}, {
      missingInputs,
      source: 'missing_input',
      reason: `Не хватает входных данных: ${missingInputs.join(', ')}`,
    });
  }
  const local = LOCAL_EVALUATORS[name]?.(input, context);
  if (local) return resultOf(contract, local.status, local.output, { source: 'kepler', reason: local.reason || '' });
  const adapter = context?.evaluatorAdapters?.[name];
  if (typeof adapter === 'function') {
    const raw = adapter(input, context);
    if (raw && typeof raw.then === 'function') throw new Error(`Evaluator «${name}» вернул Promise; требуется синхронный адаптер`);
    const normalized = normalizeAdapterResult(contract, raw);
    if (normalized) return normalized;
  }
  return resultOf(contract, 'unknown', {}, {
    source: 'not_implemented',
    reason: `Вычислитель «${name}» требует отдельной реализации или проверенного внешнего адаптера`,
  });
}

// Короткий алиас соответствует формулировке публичного API evaluate(name,…).
export const evaluate = evaluateLayoutEvaluator;

const overlapArea = (a, b) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x))
  * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));

function rectInsideRoom(room, rect) {
  if (!(rect?.w > 0 && rect?.h > 0)) return false;
  const covered = roomRects(room).reduce((sum, part) => sum + overlapArea(part, rect), 0);
  return rect.w * rect.h - covered <= Math.max(1, rect.w * rect.h * 1e-9);
}

function rectGap(a, b) {
  const dx = Math.max(a.x - (b.x + b.w), b.x - (a.x + a.w), 0);
  const dy = Math.max(a.y - (b.y + b.h), b.y - (a.y + a.h), 0);
  return Math.hypot(dx, dy);
}

function nominalSeats(item) {
  let parts;
  try { parts = item.comp ? compositeParts(item) : []; } catch { parts = []; }
  if (item.comp?.type === 'dining') {
    const count = parts.filter((part) => furnitureDef(part.kind)?.cat === 'chairs').length;
    return { all: count, dining: count };
  }
  if (item.comp?.type === 'sofa') {
    const count = parts.reduce((sum, part) => {
      const type = String(part.kind || '').replace('sofa:', '');
      if (type === 'seat') return sum + Math.max(1, Math.floor((Number(part.w) || 0) / 600));
      if (type === 'corner' || type === 'chaise') return sum + 1;
      return sum;
    }, 0);
    return { all: count, dining: 0 };
  }
  if (furnitureDef(item.kind)?.cat === 'chairs') return { all: 1, dining: 1 };
  const fixed = {
    sofa: 3, 'sofa-2': 2, 'sofa-corner': 4, 'sofa-u': 6, loveseat: 2,
    'sofa-bed': 3, daybed: 1, armchair: 1, 'armchair-lounge': 1, recliner: 1,
  }[item.kind] || 0;
  return { all: fixed, dining: 0 };
}

/**
 * Собрать только фактически доступные в Kepler сырые метрики.
 *
 * Аргумент: { project, room, items?, records?, route?, context? }.
 * records — позы валидатора ({ itemId, x, y, rotation, shapes? }); без них
 * используются текущие позы items. Геометрические результаты явно помечены
 * `aabb_*`: это broad phase, а не обещание полной 3D/кинематической проверки.
 * Функция ничего не меняет в project/items/records.
 */
export function collectLayoutEvaluatorMetrics({ project, room, items = null, records = null, route = null, context = {} } = {}) {
  if (!project || !room) return {};
  const selected = Array.isArray(items)
    ? items
    : (project.items || []).filter((item) => roomContainsPoint(room, item.x, item.y));
  const recordById = new Map((records || []).map((record) => [record.itemId, record]));
  const placed = selected.map((item) => {
    const record = recordById.get(item.id);
    const posed = record ? { ...item, x: record.x, y: record.y, rotation: record.rotation } : item;
    return { item: posed, shapes: Array.isArray(record?.shapes) ? record.shapes.map((shape) => ({ ...shape })) : itemShapes(posed) };
  });

  const collisionPairs = [];
  const pairClearances = [];
  for (let i = 0; i < placed.length; i += 1) {
    for (let j = i + 1; j < placed.length; j += 1) {
      const a = placed[i]; const b = placed[j];
      let overlap = 0; let gap = Infinity;
      for (const ra of a.shapes) for (const rb of b.shapes) {
        overlap += overlapArea(ra, rb);
        gap = Math.min(gap, rectGap(ra, rb));
      }
      if (overlap > 1) collisionPairs.push([a.item.id, b.item.id]);
      pairClearances.push({ a: a.item.id, b: b.item.id, gapMm: Number.isFinite(gap) ? Math.round(gap * 1000) / 1000 : null });
    }
  }
  const outsideParts = placed.flatMap((entry) => entry.shapes
    .filter((shape) => !rectInsideRoom(room, shape))
    .map((shape, index) => ({ itemId: entry.item.id, part: index, rect: { ...shape } })));

  const doorZones = Array.isArray(context.doorZones) ? context.doorZones : [];
  const doorPairs = [];
  for (const entry of placed) {
    if (entry.shapes.some((shape) => doorZones.some((zone) => overlapArea(shape, zone) > 1))) doorPairs.push(entry.item.id);
  }

  const validity = evaluateLayoutEvaluator('polygon_validity', {
    rings: [roomPolygon(room)], coordinate_units: 'mm', implicit_close: true,
  });
  let usableSeatCount = 0; let usableDiningSeatCount = 0;
  for (const item of selected) {
    const count = nominalSeats(item);
    usableSeatCount += count.all; usableDiningSeatCount += count.dining;
  }
  const metrics = {
    room_polygon_valid: validity.output.validity === true && roomBoundaryEdges(room).length >= 3,
    room_polygon_invalid_edges: validity.output.invalid_edges || [],
    aabb_solid_collision_count: collisionPairs.length,
    aabb_collision_pairs: collisionPairs,
    solid_collision_count: collisionPairs.length,
    aabb_support_valid: outsideParts.length === 0,
    aabb_outside_parts: outsideParts,
    furniture_support_valid: outsideParts.length === 0,
    door_swing_aabb_collision_count: doorPairs.length,
    door_swing_aabb_item_ids: doorPairs,
    door_swing_collision_count: doorPairs.length,
    aabb_pair_clearances: pairClearances,
    min_aabb_gap_mm: pairClearances.length ? Math.min(...pairClearances.map((entry) => entry.gapMm)) : null,
    nominal_usable_seat_count: usableSeatCount,
    nominal_usable_dining_seat_count: usableDiningSeatCount,
    usable_seat_count: usableSeatCount,
    usable_dining_seat_count: usableDiningSeatCount,
  };
  if (route && route.unknown !== true && typeof route.ok === 'boolean') {
    metrics.required_routes_reachable = route.ok;
    metrics.agent_body_route_valid = route.ok;
    metrics.route_path_exists = route.ok;
  }
  if (finite(route?.minWidth)) {
    metrics.route_min_width_mm = Number(route.minWidth);
    metrics.main_route_min_width_mm = Number(route.minWidth);
  }
  if (route?.zoneAccess instanceof Map) {
    metrics.route_zone_access = Object.fromEntries([...route.zoneAccess].map(([id, value]) => [id, [...value]]));
  }
  if (finite(context.requiredSeatCount)) metrics.required_seat_count = Number(context.requiredSeatCount);
  if (finite(context.requiredDiningSeatCount)) metrics.required_dining_seat_count = Number(context.requiredDiningSeatCount);
  return metrics;
}
