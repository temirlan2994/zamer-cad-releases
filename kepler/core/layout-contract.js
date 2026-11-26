// Адаптер проекта Kepler к проверяемому контракту задачи авторасстановки.
//
// В Kepler ось Y направлена вниз, углы положительны по часовой стрелке.
// Контракт использует правую систему XYZ (Z вверх), Y вверх и yaw против
// часовой стрелки. Поэтому точка (x, y) переходит в (x, -y), а yaw — в -yaw.
// Север Kepler задаётся от верха плана, поэтому его yaw от +X равен 90°-north.

// Модуль не меняет формат .kepler: он строит отдельный снимок для решателя и
// применяет placements результата обратно к существующим/новым предметам.

import { levelWindowOpenings } from './spanning-windows.js';
import { northInBuilding } from './building.js';
import { furnitureDef, isStructural } from './catalog.js';
import { isFixedSizeComp } from './composite.js';
import { furniture3d } from './furniture3d.js';
import { normalizeLayoutBrief } from './layout-brief.js';
import { createItem, levelProject, roomCeiling } from './model.js';
import { openingHeight, openingSill } from './opening-preset.js';
import { roomContainsPoint, roomPolygon } from './room-shape.js';
import {
  deriveWalls, doorLink, doorSwingRect, doorSymbol, openingOwnerId, openingRect,
} from './walls.js';

export const LAYOUT_CONTRACT_VERSION = '1.0.0';
export const LAYOUT_COORDINATE_CONVENTION = 'right_handed_z_up_yaw_ccw_local_origin_xy_center_at_support';
export const OUTSIDE_ROOM = 'OUTSIDE_ROOM';

const normDeg = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? ((n % 360) + 360) % 360 : 0;
};

export const keplerPointToContract = (point) => [Number(point?.x) || 0, -(Number(point?.y) || 0)];
export const contractPointToKepler = (point) => ({ x: Number(point?.[0]) || 0, y: -(Number(point?.[1]) || 0) });
export const keplerYawToContract = (yaw) => normDeg(-yaw);
export const contractYawToKepler = (yaw) => normDeg(-yaw);

const ringArea = (ring) => {
  let area = 0;
  for (let i = 0; i < ring.length; i += 1) {
    const a = ring[i]; const b = ring[(i + 1) % ring.length];
    area += a[0] * b[1] - b[0] * a[1];
  }
  return area / 2;
};

function closeRing(points, clockwise = false) {
  let ring = points.map(keplerPointToContract);
  if ((ringArea(ring) < 0) !== clockwise) ring = ring.reverse();
  if (ring.length) ring.push([...ring[0]]);
  return ring;
}

function rectPoints(rect) {
  return [
    { x: rect.x, y: rect.y }, { x: rect.x + rect.w, y: rect.y },
    { x: rect.x + rect.w, y: rect.y + rect.h }, { x: rect.x, y: rect.y + rect.h },
  ];
}

function rotatedItemPoints(item) {
  const angle = ((Number(item.rotation) || 0) * Math.PI) / 180;
  const c = Math.cos(angle); const s = Math.sin(angle);
  const local = [
    [-item.w / 2, -item.h / 2], [item.w / 2, -item.h / 2],
    [item.w / 2, item.h / 2], [-item.w / 2, item.h / 2],
  ];
  return local.map(([x, y]) => ({ x: item.x + x * c - y * s, y: item.y + x * s + y * c }));
}

function volume(points, zMin, zMax) {
  return {
    footprint_mm: { outer: closeRing(points), holes: [] },
    z_min_mm: zMin,
    z_max_mm: zMax,
  };
}

const PRIVACY = Object.freeze({
  living: 'family', 'kitchen-living': 'family', kitchen: 'family', dining: 'family',
  bedroom: 'private', 'master-bedroom': 'private', 'kids-room': 'private', 'guest-bedroom': 'private', cabinet: 'private',
  bathroom: 'private', 'guest-wc': 'private', 'shower-room': 'private', 'tub-room': 'private',
  boiler: 'service', laundry: 'service', storage: 'service', tech: 'service', garage: 'service',
  entrance: 'public', vestibule: 'public', hall: 'public', terrace: 'public', veranda: 'public',
});

const ROOM_FUNCTIONS = Object.freeze({
  bedroom: ['sleep_two', 'clothing_storage'],
  'master-bedroom': ['sleep_two', 'bedside_storage', 'clothing_storage'],
  'kids-room': ['sleep_child', 'study', 'clothing_storage'],
  'guest-bedroom': ['sleep_guest', 'clothing_storage'],
  living: ['seating_daily', 'conversation'],
  'kitchen-living': ['prepare_food', 'seating_daily', 'dining'],
  kitchen: ['prepare_food', 'food_storage'],
  dining: ['dining'],
  cabinet: ['desk_work', 'document_storage'],
  bathroom: ['toilet', 'washing', 'bathing'],
  'guest-wc': ['toilet', 'hand_washing'],
  'shower-room': ['toilet', 'washing', 'showering'],
  'tub-room': ['toilet', 'washing', 'bathing'],
  laundry: ['laundry'],
  'wardrobe-room': ['clothing_storage', 'dressing'],
  entrance: ['outerwear_storage', 'shoe_storage'],
});

const unique = (list) => [...new Set(list.filter(Boolean))];
const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object || {}, key);

function roomForItem(rooms, item) {
  const ordered = [...rooms].sort((a, b) => Number(Boolean(b.parentId)) - Number(Boolean(a.parentId)));
  return ordered.find((room) => roomContainsPoint(room, item.x, item.y)) || null;
}

function roomRecord(level, room, rooms, structures, options) {
  const children = rooms.filter((candidate) => candidate.parentId === room.id);
  const fixed = structures.filter((item) => roomContainsPoint(room, item.x, item.y)).map((item) => {
    const spec = furniture3d(item.kind);
    return volume(rotatedItemPoints(item), spec.z0 || 0, (spec.z0 || 0) + (spec.h || 0));
  });
  const explicit = options.roomFunctions?.[room.id] || options.roomFunctions?.[room.type];
  const required = explicit || ROOM_FUNCTIONS[room.type] || [];
  return {
    id: room.id,
    floor_id: level.id,
    type: room.type,
    privacy: options.roomPrivacy?.[room.id] || PRIVACY[room.type] || 'unknown',
    geometry: {
      footprint_mm: {
        outer: closeRing(roomPolygon(room)),
        holes: children.map((child) => closeRing(roomPolygon(child), true)),
      },
      z_base_mm: Number(level.elevation) || 0,
      ceiling_height_mm: roomCeiling(room, level),
      fixed_obstacle_volumes: fixed,
    },
    source_ref: options.sourceRef || 'kepler_project_geometry',
    linear_uncertainty_mm: options.linearUncertaintyMm ?? 0,
    required_functions: [...required],
  };
}

function openingKind(opening) {
  if (opening.kind === 'window') return 'window';
  if (opening.type === 'sliding') return 'sliding_door';
  if (opening.type === 'none') return 'doorless';
  return 'hinged_door';
}

function openingRooms(project, opening, walls) {
  if (opening.kind === 'door') {
    const link = doorLink(project, opening, walls) || [openingOwnerId(project, opening, walls) || opening.roomId, 'outside'];
    return unique(link.map((id) => (id === 'outside' ? OUTSIDE_ROOM : id)));
  }
  const owner = openingOwnerId(project, opening, walls) || opening.roomId;
  return unique([owner, OUTSIDE_ROOM]);
}

function openingSegment(placed) {
  if (!placed) return null;
  const { rect, wall } = placed;
  if (wall.orient === 'h') {
    const y = rect.y + rect.h / 2;
    return [{ x: rect.x, y }, { x: rect.x + rect.w, y }];
  }
  const x = rect.x + rect.w / 2;
  return [{ x, y: rect.y }, { x, y: rect.y + rect.h }];
}

function swingDirection(symbol) {
  if (!symbol) return null;
  const hinge = contractPointToKepler(keplerPointToContract(symbol.hinge));
  // Векторы считаем уже в координатах контракта; явное преобразование ниже
  // оставляет формулу читаемой и защищает от смены соглашения координат.
  const h = keplerPointToContract(hinge);
  const closed = keplerPointToContract(symbol.closed);
  const open = keplerPointToContract(symbol.open);
  const ax = closed[0] - h[0]; const ay = closed[1] - h[1];
  const bx = open[0] - h[0]; const by = open[1] - h[1];
  return ax * by - ay * bx >= 0 ? 'ccw' : 'cw';
}

function openingRecord(project, opening, walls, level) {
  const placed = openingRect(project, opening, walls);
  const type = openingKind(opening);
  const segment = openingSegment(placed);
  const single = type === 'hinged_door' && (opening.type || 'single') === 'single';
  const symbol = single ? doorSymbol(project, opening, walls) : null;
  const swing = type === 'hinged_door' ? doorSwingRect(project, opening, walls) : null;
  const height = openingHeight(opening, level);
  const sill = openingSill(opening, level);
  const result = {
    id: opening.assemblyPart ? `${opening.id}-${opening.assemblyPart}` : opening.id,
    kind: type,
    room_ids: unique([...openingRooms(project, opening, walls), ...(opening.spanPart ? opening.spanTargetRoomIds || [opening.spanTargetRoomId] : [])]),
    clear_width_mm: opening.width ?? null,
    sill_height_mm: sill,
    head_height_mm: opening.spanTop ?? (sill + height),
    pivot_mm: symbol ? keplerPointToContract(symbol.hinge) : null,
    required_open_angle_deg: type === 'hinged_door' ? 90 : null,
    swing_direction: single ? swingDirection(symbol) : null,
    fixed: true,
    zones: swing ? [{
      id: `${opening.id}:swing`,
      type: 'opening_zone',
      geometry: volume(rectPoints(swing), Number(level.elevation) || 0, (Number(level.elevation) || 0) + height),
      active_state_ids: ['open'],
      scope: 'Полный ход створки двери',
      required_by_profile: 'geometry_and_states',
    }] : [],
    data_status: placed ? 'imported' : 'unknown',
  };
  if (segment) result.segment_mm = segment.map(keplerPointToContract);
  return result;
}

const catalogId = (item) => `kepler-item:${item.id}`;

function manualConstraintRecord(constraint) {
  const out = { ...constraint };
  const sourceRef = constraint.source_ref ?? constraint.sourceRef ?? null;
  if (sourceRef) out.source_ref = sourceRef; else delete out.source_ref;
  delete out.sourceRef;
  out.status = constraint.status === 'verified' ? 'verified' : 'unknown';
  out.requirement = constraint.requirement || 'Паспортные ограничения изделия';
  return out;
}

function catalogRecord(item) {
  const def = furnitureDef(item.kind);
  const spec = furniture3d(item.kind);
  const z0 = spec.z0 || 0;
  return {
    id: catalogId(item),
    kind: item.kind,
    // Строка SKU сама по себе не доказывает, что габарит сверен с карточкой.
    geometry_status: ['verified_sku', 'parametric_custom', 'proxy'].includes(item.geometryStatus)
      ? item.geometryStatus : 'parametric_custom',
    geometry_confirmed: ['verified_sku', 'parametric_custom', 'proxy'].includes(item.geometryStatus),
    plan_projection_verified: item.planProjectionVerified === true,
    manufacturer: item.manufacturer || null,
    sku: item.sku || null,
    source_url: item.sourceUrl || null,
    outer_dimensions_mm: [item.w, item.h, spec.h || 1],
    // Лицо предмета в Kepler — локальная +Y; после смены оси это -Y.
    local_front_direction: [0, -1],
    resizable: !isFixedSizeComp(item),
    states: [{
      id: 'default',
      physical_volumes: [volume([
        { x: -item.w / 2, y: item.h / 2 }, { x: item.w / 2, y: item.h / 2 },
        { x: item.w / 2, y: -item.h / 2 }, { x: -item.w / 2, y: -item.h / 2 },
      ], z0, z0 + (spec.h || 1))],
      zones: [],
    }],
    manual_status: ['verified', 'not_required'].includes(item.manualStatus) ? item.manualStatus : 'unknown',
    manual_constraints: Array.isArray(item.manualConstraints)
      ? item.manualConstraints.map(manualConstraintRecord) : [],
    price: item.price || null,
    assembly_data: item.assemblyData || null,
    title: def?.title || item.kind,
  };
}

function placementRecord(item, floorId, roomId) {
  return {
    instance_id: item.id,
    catalog_id: catalogId(item),
    room_id: roomId,
    floor_id: floorId,
    pose: { position_mm: [item.x, -item.y, 0], yaw_deg: keplerYawToContract(item.rotation) },
    state_id: item.layoutState || 'default',
  };
}

function actorRecord(actor) {
  const width = Number(actor.bodyWidthMm);
  const depth = Number(actor.bodyDepthMm);
  const footprint = actor.body_footprint_local_mm ?? actor.bodyFootprintLocalMm
    ?? (width > 0 && depth > 0 ? {
      outer: [
        [-width / 2, -depth / 2], [width / 2, -depth / 2],
        [width / 2, depth / 2], [-width / 2, depth / 2], [-width / 2, -depth / 2],
      ],
      holes: [],
    } : null);
  return {
    ...actor,
    id: String(actor.id),
    alias: actor.alias || null,
    height_mm: actor.height_mm ?? actor.heightMm ?? null,
    mobility_profile: actor.mobility_profile ?? actor.mobilityProfile ?? null,
    body_footprint_local_mm: footprint,
    carried_object_ids: actor.carried_object_ids || actor.carriedObjectIds || [],
    data_status: actor.data_status || actor.dataStatus || 'unknown',
    source_ref: actor.source_ref || actor.sourceRef || null,
  };
}

function engineeringRecord(point) {
  return {
    point_id: point.id,
    system_type: point.kind,
    room_id: point.roomId ?? null,
    floor_id: point.levelId ?? null,
    position_xyz_mm: point.x != null && point.y != null
      ? [point.x, -point.y, point.zMm ?? 0] : null,
    movability: point.fixed === false ? 'movable' : 'fixed',
    service_clearance_mm: point.clearanceMm ?? null,
    equipment_ids: point.equipmentItemIds || [],
    data_status: point.dataStatus || 'unknown',
    source_id: point.sourceRef || null,
    notes: point.notes || null,
  };
}

function storageRecord(entry) {
  return {
    item_group_id: entry.id,
    owner_person_ids: entry.ownerActorIds || [],
    category: entry.category || null,
    description: entry.label || entry.notes || null,
    count: entry.count ?? null,
    storage_mode: entry.storageMode || null,
    frequency_of_use: entry.frequency || null,
    preferred_zone: entry.preferredZone || null,
    seasonality: entry.seasonality || null,
    source_id: entry.sourceRef || null,
    data_status: entry.dataStatus || 'unknown',
    item_dimensions_mm: entry.dimensionsMm ? {
      width: entry.dimensionsMm.width ?? null,
      depth: entry.dimensionsMm.depth ?? null,
      height: entry.dimensionsMm.height ?? null,
    } : null,
    required_volume_liters: entry.requiredVolumeLiters ?? null,
    weight_kg: entry.weightKg ?? null,
  };
}

function uncertaintyRecord(entry) {
  return {
    id: entry.id,
    scope: entry.scope,
    target_id: entry.targetId ?? null,
    field_path: entry.fieldPath ?? null,
    status: entry.status,
    lower_bound: entry.lowerBound ?? null,
    upper_bound: entry.upperBound ?? null,
    unit: entry.unit ?? null,
    source_ref: entry.sourceRef ?? null,
    note: entry.note ?? null,
  };
}

function scenarioRecord(selection, index) {
  return {
    id: `brief-${String(selection.scenarioId).toLowerCase()}-${index + 1}`,
    template_id: selection.scenarioId,
    enabled: selection.enabled,
    required: selection.mandatory,
    actor_ids: selection.actorPersonIds || [],
    state_assignments: {},
    route_pairs: [],
    concurrency: {},
    required_checks: [],
    comfort_checks: [],
    frequency_per_week: selection.frequencyPeriod === 'week' ? selection.frequencyValue : null,
    specific_requirements: selection.specificRequirements || null,
    source_id: selection.sourceRef || null,
  };
}

// Полный снимок входа по project_input.schema.json из пакета правил.
// opts.lockedItemIds — Iterable id закреплённых предметов; сами предметы в
// Kepler пока не получают нового сохраняемого поля.
export function projectToLayoutInput(project, opts = {}) {
  const lockedIds = new Set(opts.lockedItemIds || []);
  const floors = project.levels.map((level) => ({ id: level.id, elevation_mm: Number(level.elevation) || 0 }));
  const rooms = [];
  const openings = [];
  const catalog = [];
  const locked = [];
  const allFunctions = [];

  for (const level of project.levels) {
    const lp = levelProject(project, level.id);
    const walls = deriveWalls(lp);
    const structures = level.items.filter((item) => isStructural(item.kind));
    const furniture = level.items.filter((item) => !isStructural(item.kind));
    for (const room of level.rooms) {
      const record = roomRecord(level, room, level.rooms, structures, opts);
      rooms.push(record);
      allFunctions.push(...record.required_functions);
    }
    for (const opening of levelWindowOpenings(lp, walls)) {
      if (opening.spanPart !== 'upper') openings.push(openingRecord(lp, opening, walls, level));
    }
    for (const item of furniture) {
      const room = roomForItem(level.rooms, item);
      catalog.push(catalogRecord(item));
      if (lockedIds.has(item.id) || item.autoLayoutLocked === true || item.layoutLocked === true) {
        locked.push(placementRecord(item, level.id, room?.id || OUTSIDE_ROOM));
      }
    }
  }

  const site = project.site || {};
  const location = site.location || {};
  const localNorth = northInBuilding(site.north, project.building);
  const locationVerified = opts.locationVerified === true || (opts.locationVerified == null && site.solarVerified === true);
  const storedBrief = normalizeLayoutBrief(project.layoutBrief, {
    levelIds: project.levels.map((level) => level.id),
    roomIds: project.levels.flatMap((level) => level.rooms.map((room) => room.id)),
    itemIds: project.levels.flatMap((level) => level.items.map((item) => item.id)),
    openingIds: project.levels.flatMap((level) => level.openings.map((opening) => opening.id)),
  });
  const actorSource = hasOwn(opts, 'actors') ? opts.actors : storedBrief.actors;
  const actors = (Array.isArray(actorSource) ? actorSource : []).map(actorRecord);
  const engineeringSource = hasOwn(opts, 'fixedEngineering') ? opts.fixedEngineering : storedBrief.fixedEngineering;
  const fixedEngineering = hasOwn(opts, 'fixedEngineering')
    ? (Array.isArray(engineeringSource) ? engineeringSource : [])
    : (engineeringSource || []).map(engineeringRecord);
  const brief = opts.functionalBrief || {};
  let storageSource;
  let storageInventory;
  if (hasOwn(brief, 'storage_inventory')) {
    storageSource = brief.storage_inventory;
    storageInventory = Array.isArray(storageSource) ? storageSource : null;
  } else if (hasOwn(opts, 'storageInventory')) {
    storageSource = opts.storageInventory;
    storageInventory = Array.isArray(storageSource) ? storageSource : null;
  } else {
    storageSource = storedBrief.storageInventory;
    storageInventory = Array.isArray(storageSource) ? storageSource.map(storageRecord) : null;
  }
  const dailySeats = hasOwn(brief, 'daily_seats') ? brief.daily_seats : storedBrief.capacity.dailySeats;
  const guestSeats = hasOwn(brief, 'guest_seats') ? brief.guest_seats : storedBrief.capacity.guestSeats;
  const simultaneousCooks = hasOwn(brief, 'simultaneous_cooks')
    ? brief.simultaneous_cooks : storedBrief.capacity.simultaneousCooks;
  const uncertainty = storedBrief.uncertainty.map(uncertaintyRecord);
  const scenarios = hasOwn(opts, 'scenarios')
    ? (Array.isArray(opts.scenarios) ? opts.scenarios : [])
    : storedBrief.scenarioSelections.map(scenarioRecord);
  const unknown = [...(opts.unknownInputs || [])];
  const actorsConfirmed = actors.length > 0 && actors.every((actor) => actor.height_mm != null
    && actor.mobility_profile && actor.mobility_profile !== 'unknown' && actor.data_status !== 'unknown');
  if (!actorsConfirmed) unknown.push('Состав, рост и мобильность пользователей не подтверждены полностью');
  const catalogConfirmed = catalog.every((entry) => {
    const geometryReady = entry.geometry_status === 'verified_sku'
      ? Boolean(entry.geometry_confirmed && entry.sku && entry.source_url)
      : entry.geometry_status === 'parametric_custom' && entry.geometry_confirmed;
    const manualReady = entry.manual_status === 'not_required'
      || (entry.manual_status === 'verified'
        && entry.manual_constraints.every((constraint) => constraint.status === 'verified'));
    return geometryReady && entry.plan_projection_verified === true && manualReady;
  });
  if (!catalogConfirmed) unknown.push('Точные модели, источники или паспортные зазоры части мебели не подтверждены');
  if (!locationVerified) unknown.push('Координаты участка и направление севера требуют подтверждения');
  const engineeringConfirmed = Array.isArray(engineeringSource) && engineeringSource.every((point) => {
    const positionKnown = Array.isArray(point.position_xyz_mm)
      || (Number.isFinite(Number(point.x)) && Number.isFinite(Number(point.y)));
    const status = point.data_status || point.dataStatus;
    return positionKnown && status && status !== 'unknown';
  });
  if (!engineeringConfirmed) unknown.push('Фиксированные инженерные точки не подтверждены');
  const storageConfirmed = Array.isArray(storageSource) && storageSource.every((entry) => {
    const status = entry.data_status || entry.dataStatus;
    const amountKnown = entry.count != null || entry.required_volume_liters != null
      || entry.requiredVolumeLiters != null || entry.item_dimensions_mm || entry.dimensionsMm;
    return (entry.category || entry.description || entry.label) && amountKnown && status && status !== 'unknown';
  });
  if (!storageConfirmed) unknown.push('Инвентарь хранения не подтверждён');
  if (dailySeats == null || guestSeats == null || simultaneousCooks == null) {
    unknown.push('Ежедневная, гостевая вместимость и число одновременно готовящих заданы не полностью');
  }
  for (const entry of uncertainty) {
    if (entry.status === 'resolved') continue;
    const label = entry.note || entry.field_path || entry.target_id || entry.id;
    unknown.push(`Неопределённость: ${label}`);
  }

  const storedAssumptions = uncertainty
    .filter((entry) => entry.status === 'assumed')
    .map((entry) => `Допущение: ${entry.note || entry.field_path || entry.target_id || entry.id}`);
  const assumptions = opts.assumptions || [
    'Контуры, проёмы и положения взяты из текущего проекта Kepler.',
    'Мебель без подтверждённой модели представлена параметрической геометрией редактора.',
  ];
  return {
    project_id: String(opts.projectId || project.id || project.name || 'kepler-project'),
    units: 'mm',
    angle_unit: 'degree',
    mode: opts.mode || 'furniture_only',
    coordinate_convention: LAYOUT_COORDINATE_CONVENTION,
    metric_geometry_verified: opts.metricGeometryVerified !== false,
    source_plan_refs: opts.sourcePlanRefs || ['kepler_project_geometry'],
    location: {
      country: opts.country || location.country || null,
      latitude: Number.isFinite(location.lat) ? location.lat : null,
      longitude: Number.isFinite(location.lon) ? location.lon : null,
      north_yaw_deg: normDeg(90 - localNorth),
    },
    active_profiles: opts.activeProfiles || ['geometry_and_states', 'large_house_comfort'],
    profile_overrides: opts.profileOverrides || [],
    floors,
    rooms,
    openings,
    fixed_engineering: fixedEngineering,
    actors,
    catalog,
    locked_placements: locked,
    functional_brief: {
      mandatory_functions: unique(brief.mandatory_functions || allFunctions),
      daily_seats: dailySeats ?? null,
      guest_seats: guestSeats ?? null,
      simultaneous_cooks: simultaneousCooks ?? null,
      storage_inventory: storageInventory,
      privacy_requirements: brief.privacy_requirements || [],
      preferences: brief.preferences || [],
      budget: brief.budget ?? null,
      uncertainty_records: uncertainty,
    },
    scenarios,
    unknown_inputs: unique(unknown),
    assumptions: unique([...assumptions, ...storedAssumptions]),
  };
}

function sourceCatalog(source) {
  if (Array.isArray(source)) return source;
  return source?.catalog || [];
}

function lockedSet(source) {
  return new Set((source?.locked_placements || []).map((placement) => placement.instance_id));
}

// Применить candidate из layout_output.schema.json обратно к проекту.
// По умолчанию закреплённые входом предметы не двигаются; неизвестные
// instance_id создаются из каталога, если opts.createMissing !== false.
export function applyLayoutCandidate(project, candidate, source = null, opts = {}) {
  const placements = Array.isArray(candidate) ? candidate : candidate?.placements || [];
  const catalog = new Map(sourceCatalog(source).map((entry) => [entry.id, entry]));
  const locked = lockedSet(source);
  const result = { updated: [], created: [], skipped: [] };

  for (const placement of placements) {
    if (opts.respectLocks !== false && locked.has(placement.instance_id)) {
      result.skipped.push({ id: placement.instance_id, reason: 'locked' });
      continue;
    }
    const level = project.levels.find((entry) => entry.id === placement.floor_id) || project.levels[0];
    if (!level || !placement.pose?.position_mm) {
      result.skipped.push({ id: placement.instance_id, reason: 'invalid_pose' });
      continue;
    }
    const currentLevel = project.levels.find((entry) => entry.items.some((candidate) => candidate.id === placement.instance_id));
    let item = currentLevel?.items.find((entry) => entry.id === placement.instance_id);
    if (!item) {
      if (opts.createMissing === false) {
        result.skipped.push({ id: placement.instance_id, reason: 'missing_item' });
        continue;
      }
      const entry = catalog.get(placement.catalog_id);
      if (!entry) {
        result.skipped.push({ id: placement.instance_id, reason: 'missing_catalog' });
        continue;
      }
      const [w, h] = entry.outer_dimensions_mm;
      item = createItem(entry.kind, 0, 0, w, h, 0);
      item.id = placement.instance_id;
      level.items.push(item);
      result.created.push(item.id);
    } else {
      if (currentLevel !== level) {
        currentLevel.items.splice(currentLevel.items.indexOf(item), 1);
        level.items.push(item);
      }
      result.updated.push(item.id);
    }
    const point = contractPointToKepler(placement.pose.position_mm);
    item.x = point.x;
    item.y = point.y;
    item.rotation = contractYawToKepler(placement.pose.yaw_deg);
    if (placement.state_id && placement.state_id !== 'default') item.layoutState = placement.state_id;
    else delete item.layoutState;
  }
  return result;
}
