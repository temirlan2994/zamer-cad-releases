// Производный вход в дом: наружная главная дверь нижнего занятого этажа,
// площадка и средства подъёма от земли к отметке пола. Модуль ничего не
// записывает в project: дверь, рельеф или ±0.000 меняются — результат при
// следующем вызове строится заново с теми же стабильными id.

import { stairRect, stairRectPolygon } from './stair-shape.js';
import { toWorld } from './building.js';
import { isOpenRoom } from './catalog.js';
import { resolvedZeroAboveGround } from './envelope.js';
import { levelProject, sortedLevels } from './model.js';
import { houseTerrain, interpolateZ, terrainModel } from './terrain.js';
import { deriveWalls, doorLink, hostOpeningRoom, openingRect } from './walls.js';

export const ENTRANCE_DEFAULTS = Object.freeze({
  enabled: true,
  mode: 'steps',
  landingDepth: 1500,
  landingThickness: 150,
  landingExtraWidth: 600,
  maxRiser: 150,
  tread: 300,
  stepMinWidth: 1200,
  rampWidth: 1200,
  rampSlope: 0.08,
  routeGap: 200,
  minimumRise: 20,
  maxStraightRampRun: 12000,
});

export const ENTRANCE_MATERIALS = Object.freeze([
  { id: 'concrete', title: 'Бетон', color: '#b7aea1' },
  { id: 'graphite', title: 'Графит', color: '#4d5254' },
  { id: 'stone', title: 'Камень', color: '#9a9890' },
  { id: 'wood', title: 'Дерево', color: '#a8794b' },
]);

const MODES = new Set(['steps', 'ramp', 'both', 'none']);
const ENTRY_ROLES = new Set(['main', 'service', 'terrace', 'none']);
const ENTRY_ROOM_TYPES = new Set(['entrance', 'vestibule', 'hall']);

const finite = (value) => {
  const number = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  return typeof number === 'number' && Number.isFinite(number) ? number : null;
};

const bounded = (value, min, max, fallback) => {
  const number = finite(value);
  return number == null ? fallback : Math.min(max, Math.max(min, number));
};

export function entranceSettings(project, opening) {
  const global = project?.envelope?.entrance;
  const local = opening?.entrance;
  const source = {
    ...(global && typeof global === 'object' ? global : {}),
    ...(local && typeof local === 'object' ? local : {}),
  };
  return {
    enabled: source.enabled !== false,
    shapeEdits: source.shapeEdits && typeof source.shapeEdits === 'object' ? source.shapeEdits : {},
    width: bounded(source.width, 600, 12000, 0),
    stepCount: Math.round(bounded(source.stepCount, 0, 100, 0)),
    material: ENTRANCE_MATERIALS.find((m) => m.id === source.material)?.id || 'concrete',
    mode: MODES.has(source.mode) ? source.mode : ENTRANCE_DEFAULTS.mode,
    landingDepth: bounded(source.landingDepth, 600, 6000, ENTRANCE_DEFAULTS.landingDepth),
    landingThickness: bounded(source.landingThickness, 80, 600, ENTRANCE_DEFAULTS.landingThickness),
    landingExtraWidth: bounded(
      source.landingExtraWidth ?? (finite(source.sideClearance) == null ? null : Number(source.sideClearance) * 2),
      0, 3000, ENTRANCE_DEFAULTS.landingExtraWidth,
    ),
    maxRiser: bounded(source.maxRiser ?? source.stepMaxRiser, 80, 250, ENTRANCE_DEFAULTS.maxRiser),
    tread: bounded(source.tread ?? source.stepTread, 200, 800, ENTRANCE_DEFAULTS.tread),
    stepMinWidth: bounded(source.stepMinWidth, 600, 4000, ENTRANCE_DEFAULTS.stepMinWidth),
    rampWidth: bounded(source.rampWidth, 900, 3000, ENTRANCE_DEFAULTS.rampWidth),
    rampSlope: bounded(source.rampSlope, 1 / 30, 1 / 6, ENTRANCE_DEFAULTS.rampSlope),
    routeGap: bounded(source.routeGap, 0, 1500, ENTRANCE_DEFAULTS.routeGap),
    minimumRise: bounded(source.minimumRise, 0, 100, ENTRANCE_DEFAULTS.minimumRise),
    maxStraightRampRun: bounded(source.maxStraightRampRun, 3000, 60000, ENTRANCE_DEFAULTS.maxStraightRampRun),
  };
}

function openingRole(opening) {
  if (opening?.mainEntrance === true) return 'main';
  if (opening?.mainEntrance === false) return 'none';
  const value = opening?.entryRole ?? opening?.entrance?.role ?? opening?.role;
  return ENTRY_ROLES.has(value) ? value : null;
}

function occupiedLevel(project) {
  if (!Array.isArray(project?.levels) || !project.levels.length) return null;
  return sortedLevels(project).find((level) => (level.rooms || [])
    .some((room) => !room.parentId && !isOpenRoom(room))) || null;
}

const centerOf = (rect) => ({ x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 });

function outwardGeometry(lp, opening, walls) {
  const placed = openingRect(lp, opening, walls);
  if (!placed || !['h', 'v'].includes(placed.wall?.orient)) return null;
  const owner = opening.host
    ? hostOpeningRoom(lp, opening, walls)
    : { room: lp.rooms.find((room) => room.id === opening.roomId), outward: placed.wall.outward };
  if (!owner?.room) return null;
  let sign = Number(owner.outward);
  if (sign !== -1 && sign !== 1) {
    const c = centerOf(placed.rect);
    sign = placed.wall.orient === 'h'
      ? (owner.room.y + owner.room.h / 2 > c.y ? -1 : 1)
      : (owner.room.x + owner.room.w / 2 > c.x ? -1 : 1);
  }
  const outward = placed.wall.orient === 'h' ? { x: 0, y: sign } : { x: sign, y: 0 };
  const center = centerOf(placed.rect);
  const halfWall = (placed.wall.orient === 'h' ? placed.rect.h : placed.rect.w) / 2;
  const threshold = {
    x: center.x + outward.x * halfWall,
    y: center.y + outward.y * halfWall,
  };
  return { ...placed, owner: owner.room, outward, threshold };
}

function exteriorDoorCandidates(project, level, preparedWalls = null) {
  const lp = levelProject(project, level.id);
  // Вход строится только по двери, которая вообще может стать главной.
  // Раньше deriveWalls() запускался даже у проекта без единой двери — и при
  // каждой 3D-сборке повторял уже выполненный расчёт стен всего этажа.
  const doors = (lp.openings || []).filter((opening) => {
    if (opening.kind !== 'door' || opening.type === 'none' || opening.orphan) return false;
    const role = openingRole(opening);
    return role == null || role === 'main';
  });
  if (!doors.length) return [];
  const walls = preparedWalls || deriveWalls(lp);
  const candidates = [];
  for (const opening of doors) {
    const link = doorLink(lp, opening, walls);
    if (!link?.includes('outside') || !link.some((id) => id !== 'outside')) continue;
    const geometry = outwardGeometry(lp, opening, walls);
    if (!geometry) continue;
    candidates.push({ opening, ...geometry });
  }
  return candidates;
}

function entrancePreset(opening) {
  const id = opening?.presetId ?? opening?.openingPresetId ?? opening?.preset;
  return typeof id === 'string' && id.startsWith('entry-');
}

function mainDoor(candidates, project) {
  const eligible = candidates.filter(({ opening }) => {
    const role = openingRole(opening);
    return role == null || role === 'main';
  });
  if (!eligible.length) return null;
  const explicit = eligible.filter(({ opening }) => openingRole(opening) === 'main');
  const pool = explicit.length ? explicit : eligible;
  const entry = project?.site?.entry;
  const score = (candidate) => {
    const { opening, owner } = candidate;
    if (openingRole(opening) === 'main') return 400;
    if (entrancePreset(opening)) return 300;
    if (owner.type === 'vestibule') return 230;
    if (owner.type === 'entrance') return 220;
    if (owner.type === 'hall') return 210;
    return eligible.length === 1 ? 200 : 100;
  };
  const distance = (candidate) => {
    if (!entry) return Infinity;
    const point = toWorld(project.building, candidate.threshold);
    return Math.hypot(point.x - entry.x, point.y - entry.y);
  };
  pool.sort((a, b) => score(b) - score(a)
    || distance(a) - distance(b)
    || String(a.opening.id).localeCompare(String(b.opening.id)));
  const chosen = pool[0];
  let source = 'fallback';
  if (openingRole(chosen.opening) === 'main') source = 'explicit';
  else if (entrancePreset(chosen.opening)) source = 'preset';
  else if (ENTRY_ROOM_TYPES.has(chosen.owner.type)) source = 'room';
  else if (eligible.length === 1) source = 'single';
  else if (entry) source = 'site-entry';
  return { chosen, source, multipleMain: explicit.length > 1, inferred: source === 'fallback' || source === 'site-entry' };
}

// Земля в локальных осях дома, z относительно проектного ±0.000.
// Реализация намеренно не импортирует mesh3d.js: entrance.js затем можно
// безопасно использовать в сборке общей 3D-сетки без циклического импорта.
function groundSampler(project) {
  const model = terrainModel(project.site?.terrain);
  let house = null;
  if (model?.tris?.length) house = houseTerrain(project, model);
  const zero = resolvedZeroAboveGround(project, house);
  if (zero == null) return { zero: null, at: null };
  if (!model?.tris?.length) return { zero, at: () => -zero };
  const average = model.pts.reduce((sum, point) => sum + point.z, 0) / model.pts.length;
  const floorZ = house?.floorZ
    ?? (Number.isFinite(project.site?.terrain?.floorZ) ? project.site.terrain.floorZ : average);
  return {
    zero,
    at(point) {
      const world = toWorld(project.building, point);
      const absolute = interpolateZ(model, world.x, world.y, { clamp: true });
      return (absolute ?? floorZ) - floorZ;
    },
  };
}

const moved = (point, direction, distance, lateral = 0) => {
  const side = { x: -direction.y, y: direction.x };
  return {
    x: point.x + direction.x * distance + side.x * lateral,
    y: point.y + direction.y * distance + side.y * lateral,
  };
};

function stripPolygon(start, direction, width, depth, lateral = 0) {
  const side = { x: -direction.y, y: direction.x };
  const a = moved(start, direction, 0, lateral);
  const b = moved(start, direction, depth, lateral);
  const half = width / 2;
  return [
    { x: a.x - side.x * half, y: a.y - side.y * half },
    { x: a.x + side.x * half, y: a.y + side.y * half },
    { x: b.x + side.x * half, y: b.y + side.y * half },
    { x: b.x - side.x * half, y: b.y - side.y * half },
  ];
}

function stepMetrics(start, direction, lateral, topZ, groundAt, settings) {
  let run = 0;
  let groundZ = groundAt(moved(start, direction, run, lateral));
  for (let iteration = 0; iteration < 4; iteration += 1) {
    const rise = Math.max(0, topZ - groundZ);
    const count = rise > settings.minimumRise ? (settings.stepCount || Math.max(1, Math.ceil(rise / settings.maxRiser))) : 0;
    const nextRun = count * settings.tread;
    const nextGround = groundAt(moved(start, direction, nextRun, lateral));
    if (Math.abs(nextRun - run) < 0.5 && Math.abs(nextGround - groundZ) < 0.5) break;
    run = nextRun;
    groundZ = nextGround;
  }
  const rawRise = topZ - groundZ;
  const rise = Math.max(0, rawRise);
  const count = rise > settings.minimumRise ? (settings.stepCount || Math.max(1, Math.ceil(rise / settings.maxRiser))) : 0;
  run = count * settings.tread;
  return { count, run, groundZ, rawRise, rise, riser: count ? rise / count : 0 };
}

function rampMetrics(start, direction, lateral, topZ, groundAt, settings) {
  let run = 0;
  let groundZ = groundAt(moved(start, direction, run, lateral));
  for (let iteration = 0; iteration < 6; iteration += 1) {
    const rise = Math.max(0, topZ - groundZ);
    const nextRun = rise > settings.minimumRise ? rise / settings.rampSlope : 0;
    const nextGround = groundAt(moved(start, direction, nextRun, lateral));
    if (Math.abs(nextRun - run) < 0.5 && Math.abs(nextGround - groundZ) < 0.5) {
      groundZ = nextGround;
      break;
    }
    run = nextRun;
    groundZ = nextGround;
  }
  const rawRise = topZ - groundZ;
  const rise = Math.max(0, rawRise);
  run = rise > settings.minimumRise ? rise / settings.rampSlope : 0;
  return { run, groundZ, rawRise, rise, slope: run ? rise / run : 0 };
}

function pendingEntrance(level, selection, settings) {
  const { chosen, source, multipleMain, inferred } = selection;
  const id = `auto-entry:${chosen.opening.id}`;
  const issues = [];
  if (multipleMain) issues.push({ code: 'multiple-main-doors', severity: 'conflict' });
  if (inferred) issues.push({ code: 'main-door-inferred', severity: 'warning' });
  return {
    id,
    source: 'linked',
    openingId: chosen.opening.id,
    levelId: level.id,
    role: 'main',
    mainSource: source,
    status: 'pending',
    reason: 'building-datum-required',
    issues,
    topZ: Number(level.elevation) || 0,
    groundZ: null,
    rise: null,
    outward: { ...chosen.outward },
    threshold: { ...chosen.threshold, z: Number(level.elevation) || 0 },
    mode: settings.mode,
    shapeEdits: settings.shapeEdits,
    material: settings.material,
    color: ENTRANCE_MATERIALS.find((m) => m.id === settings.material).color,
    landing: null,
    steps: null,
    ramp: null,
    components: [],
  };
}

function readyEntrance(project, level, selection, groundAt, settings) {
  const { chosen, source, multipleMain, inferred } = selection;
  const id = `auto-entry:${chosen.opening.id}`;
  const topZ = Number(level.elevation) || 0;
  const stepsOn = settings.mode === 'steps' || settings.mode === 'both';
  const rampOn = settings.mode === 'ramp' || settings.mode === 'both';
  const baseWidth = settings.width || Math.max(settings.stepMinWidth, chosen.opening.width + settings.landingExtraWidth);
  const landingWidth = settings.mode === 'both'
    ? baseWidth + settings.routeGap + settings.rampWidth
    : Math.max(baseWidth, rampOn ? settings.rampWidth : 0);
  const stepsOffset = settings.mode === 'both' ? -(settings.rampWidth + settings.routeGap) / 2 : 0;
  const rampOffset = settings.mode === 'both' ? (baseWidth + settings.routeGap) / 2 : 0;
  const landingOuter = moved(chosen.threshold, chosen.outward, settings.landingDepth);
  const stepData = stepMetrics(landingOuter, chosen.outward, stepsOffset, topZ, groundAt, settings);
  const rampData = rampMetrics(landingOuter, chosen.outward, rampOffset, topZ, groundAt, settings);
  const landingRect = stairRect({ left: -landingWidth / 2, right: landingWidth / 2, back: 0, front: settings.landingDepth }, settings.shapeEdits.landing);
  const landingPolygon = stairRectPolygon(landingRect, chosen.threshold,
    { x: -chosen.outward.y, y: chosen.outward.x }, chosen.outward);
  const landingGround = landingPolygon.map(groundAt);
  const landing = {
    id: `${id}:landing`,
    kind: 'landing',
    enabled: true,
    width: landingWidth,
    depth: settings.landingDepth,
    thickness: settings.landingThickness,
    z: topZ,
    minGroundZ: Math.min(...landingGround),
    maxGroundZ: Math.max(...landingGround),
    polygon: landingPolygon,
  };
  const steps = {
    id: `${id}:steps`,
    kind: 'steps',
    enabled: stepsOn && stepData.count > 0,
    count: stepData.count,
    width: baseWidth,
    tread: settings.tread,
    riser: stepData.riser,
    run: stepData.run,
    rise: stepData.rise,
    groundZ: stepData.groundZ,
    topZ,
    direction: { ...chosen.outward },
    lateralOffset: stepsOffset,
    topCenter: moved(landingOuter, chosen.outward, 0, stepsOffset),
    bottomCenter: moved(landingOuter, chosen.outward, stepData.run, stepsOffset),
    polygon: stripPolygon(landingOuter, chosen.outward, baseWidth, stepData.run, stepsOffset),
  };
  const ramp = {
    id: `${id}:ramp`,
    kind: 'ramp',
    enabled: rampOn && rampData.rise > settings.minimumRise,
    width: settings.rampWidth,
    run: rampData.run,
    rise: rampData.rise,
    slope: rampData.slope,
    maxSlope: settings.rampSlope,
    groundZ: rampData.groundZ,
    topZ,
    direction: { ...chosen.outward },
    lateralOffset: rampOffset,
    topCenter: moved(landingOuter, chosen.outward, 0, rampOffset),
    bottomCenter: moved(landingOuter, chosen.outward, rampData.run, rampOffset),
    polygon: stripPolygon(landingOuter, chosen.outward, settings.rampWidth, rampData.run, rampOffset),
  };
  const issues = [];
  if (multipleMain) issues.push({ code: 'multiple-main-doors', severity: 'conflict' });
  if (inferred) issues.push({ code: 'main-door-inferred', severity: 'warning' });
  const activeData = [stepsOn ? stepData : null, rampOn ? rampData : null].filter(Boolean);
  if (activeData.some((data) => data.rawRise < -settings.minimumRise)) {
    issues.push({ code: 'ground-above-threshold', severity: 'conflict' });
  }
  if (ramp.enabled && ramp.run > settings.maxStraightRampRun) {
    issues.push({ code: 'straight-ramp-too-long', severity: 'warning', requiredRun: ramp.run });
  }
  const status = issues.some((issue) => issue.severity === 'conflict') ? 'conflict' : 'ready';
  const primary = stepsOn ? stepData : rampOn ? rampData : {
    groundZ: groundAt(landingOuter), rise: Math.max(0, topZ - groundAt(landingOuter)),
  };
  const components = [landing];
  if (steps.enabled) components.push(steps);
  if (ramp.enabled) components.push(ramp);
  return {
    id,
    source: 'linked',
    openingId: chosen.opening.id,
    levelId: level.id,
    role: 'main',
    mainSource: source,
    status,
    reason: status === 'conflict' ? issues.find((issue) => issue.severity === 'conflict')?.code : null,
    issues,
    topZ,
    groundZ: primary.groundZ,
    rise: primary.rise,
    outward: { ...chosen.outward },
    threshold: { ...chosen.threshold, z: topZ },
    mode: settings.mode,
    shapeEdits: settings.shapeEdits,
    material: settings.material,
    color: ENTRANCE_MATERIALS.find((m) => m.id === settings.material).color,
    landing,
    steps,
    ramp,
    components,
  };
}

// Возвращается массив для совместимости с возможными несколькими входными
// группами в будущем. Сейчас в нём максимум одна производная main-группа.
export function deriveEntrances(project, { wallsByLevel = null } = {}) {
  const level = occupiedLevel(project);
  if (!level) return [];
  const preparedWalls = wallsByLevel?.get?.(level.id) ?? wallsByLevel?.[level.id] ?? null;
  const selection = mainDoor(exteriorDoorCandidates(project, level, preparedWalls), project);
  if (!selection) return [];
  const settings = entranceSettings(project, selection.chosen.opening);
  if (!settings.enabled) return [];
  const ground = groundSampler(project);
  if (!ground.at) return [pendingEntrance(level, selection, settings)];
  return [readyEntrance(project, level, selection, ground.at, settings)];
}

// Площадка и каждая проступь имеют свой прямоугольник и стабильный ключ.
export function entranceParts(entry) {
  if (!entry?.landing) return [];
  const yAxis = entry.outward;
  const xAxis = { x: -yAxis.y, y: yAxis.x };
  const make = (key, title, origin, base, z) => {
    const rect = stairRect(base, entry.shapeEdits?.[key]);
    return { key, title, origin, xAxis, yAxis, base, rect, z,
      polygon: stairRectPolygon(rect, origin, xAxis, yAxis) };
  };
  const parts = [make('landing', 'Площадка', entry.threshold,
    { left: -entry.landing.width / 2, right: entry.landing.width / 2, back: 0, front: entry.landing.depth }, entry.topZ)];
  const steps = entry.steps;
  if (steps?.enabled) for (let i = 0; i < steps.count; i += 1) {
    parts.push(make(`step-${i + 1}`, `Ступень ${i + 1} (от верха)`, steps.topCenter,
      { left: -steps.width / 2, right: steps.width / 2, back: i * steps.tread, front: (i + 1) * steps.tread },
      steps.topZ - steps.riser * (i + 1)));
  }
  return parts;
}
