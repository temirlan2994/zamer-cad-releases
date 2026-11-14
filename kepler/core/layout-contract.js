// Адаптер проекта Kepler к проверяемому контракту задачи авторасстановки.
//
// В Kepler ось Y направлена вниз, углы положительны по часовой стрелке.
// Контракт использует правую систему XYZ (Z вверх), Y вверх и yaw против
// часовой стрелки. Поэтому точка (x, y) переходит в (x, -y), а yaw — в -yaw.
// Север Kepler задаётся от верха плана, поэтому его yaw от +X равен 90°-north.

// Модуль не меняет формат .kepler: он строит отдельный снимок для решателя и
// применяет placements результата обратно к существующим/новым предметам.

import { northInBuilding } from './building.js';
import { furnitureDef, isStructural } from './catalog.js';
import { isFixedSizeComp } from './composite.js';
import { furniture3d } from './furniture3d.js';
import { createItem, levelProject, roomCeiling } from './model.js';
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
  const height = opening.height ?? (opening.kind === 'door' ? 2100 : 1500);
  const result = {
    id: opening.id,
    kind: type,
    room_ids: openingRooms(project, opening, walls),
    clear_width_mm: opening.width ?? null,
    sill_height_mm: opening.kind === 'door' ? 0 : opening.sill ?? 900,
    head_height_mm: (opening.kind === 'door' ? 0 : opening.sill ?? 900) + height,
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

function catalogRecord(item) {
  const def = furnitureDef(item.kind);
  const spec = furniture3d(item.kind);
  const z0 = spec.z0 || 0;
  return {
    id: catalogId(item),
    kind: item.kind,
    geometry_status: item.sku ? 'verified_sku' : 'parametric_custom',
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
    manual_constraints: Array.isArray(item.manualConstraints) ? item.manualConstraints : [],
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
  return {
    ...actor,
    id: String(actor.id),
    height_mm: actor.height_mm ?? null,
    mobility_profile: actor.mobility_profile ?? null,
    body_footprint_local_mm: actor.body_footprint_local_mm ?? null,
    carried_object_ids: actor.carried_object_ids || [],
    data_status: actor.data_status || 'unknown',
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
    for (const opening of level.openings) openings.push(openingRecord(lp, opening, walls, level));
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
  const actors = (opts.actors || []).map(actorRecord);
  const unknown = [...(opts.unknownInputs || [])];
  if (!actors.length) unknown.push('Состав, размеры и мобильность пользователей не заданы');
  if (catalog.some((entry) => entry.geometry_status !== 'verified_sku')) unknown.push('Точные модели и паспортные состояния части мебели не заданы');
  if (!locationVerified) unknown.push('Координаты участка и направление севера требуют подтверждения');
  if (!opts.storageInventory) unknown.push('Инвентарь хранения не задан');

  const brief = opts.functionalBrief || {};
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
    fixed_engineering: opts.fixedEngineering || [],
    actors,
    catalog,
    locked_placements: locked,
    functional_brief: {
      mandatory_functions: unique(brief.mandatory_functions || allFunctions),
      daily_seats: brief.daily_seats ?? null,
      guest_seats: brief.guest_seats ?? null,
      storage_inventory: brief.storage_inventory ?? opts.storageInventory ?? null,
      privacy_requirements: brief.privacy_requirements || [],
      preferences: brief.preferences || [],
      budget: brief.budget ?? null,
    },
    scenarios: opts.scenarios || [],
    unknown_inputs: unique(unknown),
    assumptions: opts.assumptions || [
      'Контуры, проёмы и положения взяты из текущего проекта Kepler.',
      'Мебель без SKU представлена параметрической геометрией редактора.',
    ],
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
