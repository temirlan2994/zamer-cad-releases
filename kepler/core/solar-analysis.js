// Прямое солнце внутри выбранной комнаты. В отличие от нормативной
// инсоляции фасада (insolation.js), здесь луч должен пройти через настоящую
// апертуру окна и попасть на рабочую плоскость помещения. Поэтому ширина,
// высота, подоконник и положение окна меняют карту.

import { toWorld } from './building.js';
import { solarObstaclesOf, sunRayBlocked, windowsOf } from './insolation.js';
import { levelProject, roomCeiling } from './model.js';
import { openPlanZone } from './norms.js';
import { roomRects, roomShapeArea } from './room-shape.js';
import { roomNetAreaM2, roomNetRects } from './rooms.js';
import { sunPosition } from './site.js';
import { deriveWalls } from './walls.js';

const DEFAULT_CELL = 500;
const DEFAULT_MAX_CELLS = 400;
const DEFAULT_STEP = 10;
const DEFAULT_WORKPLANE = 800;
const LIGHT_RATIO = 1 / 8;
const FACADE_EPS = 1e-8;
const PATH_SAMPLE = 100;

// Публичные допущения модели: UI/отчёт может показывать их без дублирования
// формулировок. Это карта прямого солнца, не расчёт КЕО/рассеянного света.
export const SOLAR_OCCLUDER_ASSUMPTIONS = Object.freeze([
  'Крыши и сплошные массы считаются непрозрачными; пересекающая их вычитающая масса вырезает отверстие в пределах своего 3D-объёма и сама тени не даёт.',
  'Кроны деревьев считаются непрозрачными круглый год; сезонность листвы не учитывается.',
  'Пергола консервативно считается сплошной верхней решёткой.',
  'Рельеф для ландшафтных препятств считается плоским; явные отметки объектов учитываются.',
]);

const clamp = (value, lo, hi) => Math.max(lo, Math.min(hi, value));
const dot = (a, b) => a.x * b.x + a.y * b.y;

function roundedStep(value) {
  return Math.max(50, Math.ceil(value / 50) * 50);
}

function gridAt(room, size, parts) {
  const points = [];
  const cols = Math.max(1, Math.ceil(room.w / size));
  const rows = Math.max(1, Math.ceil(room.h / size));
  for (let row = 0; row < rows; row += 1) {
    const y0 = room.y + row * size;
    const h = Math.min(size, room.y + room.h - y0);
    for (let col = 0; col < cols; col += 1) {
      const x0 = room.x + col * size;
      const w = Math.min(size, room.x + room.w - x0);
      if (!(w > 0 && h > 0)) continue;
      const intersections = parts.map((part) => {
        const ix0 = Math.max(x0, part.x); const iy0 = Math.max(y0, part.y);
        const ix1 = Math.min(x0 + w, part.x + part.w); const iy1 = Math.min(y0 + h, part.y + part.h);
        const iw = Math.max(0, ix1 - ix0); const ih = Math.max(0, iy1 - iy0);
        return { x0: ix0, y0: iy0, w: iw, h: ih, area: iw * ih };
      }).filter((part) => part.area > 0);
      const area = intersections.reduce((sum, part) => sum + part.area, 0);
      if (!area) continue;
      const sample = intersections.reduce((best, part) => (part.area > best.area ? part : best));
      points.push({
        x: sample.x0 + sample.w / 2,
        y: sample.y0 + sample.h / 2,
        x0, y0, w, h, area,
        rects: intersections.map((part) => ({ x: part.x0, y: part.y0, w: part.w, h: part.h })),
        minutes: 0,
      });
    }
  }
  return { points, cols, rows };
}

// Адаптивный размер сохраняет заданный минимум, но не даёт большой комнате
// породить тысячи лучей. Повторный проход нужен для вытянутых/Г-контуров.
export function roomSunGrid(room, { cell = DEFAULT_CELL, maxCells = DEFAULT_MAX_CELLS, rects = null } = {}) {
  const parts = rects || roomRects(room);
  const requested = roundedStep(clamp(Number(cell) || DEFAULT_CELL, 100, 5000));
  const limit = Math.round(clamp(Number(maxCells) || DEFAULT_MAX_CELLS, 16, 2000));
  const area = Math.max(1, parts.reduce((sum, part) => sum + part.w * part.h, 0) || roomShapeArea(room));
  let size = Math.max(requested, roundedStep(Math.sqrt(area / limit)));
  let grid = gridAt(room, size, parts);
  for (let attempt = 0; grid.points.length > limit && attempt < 6; attempt += 1) {
    size = roundedStep(size * Math.sqrt(grid.points.length / limit) * 1.01);
    grid = gridAt(room, size, parts);
  }
  return { ...grid, cell: size, maxCells: limit };
}

function localSunDirection(project, world) {
  const angle = -((Number(project.building?.rotation) || 0) * Math.PI) / 180;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return { x: world.x * c - world.y * s, y: world.x * s + world.y * c };
}

const pointInRect = (rect, point) => point.x >= rect.x - 0.5 && point.x <= rect.x + rect.w + 0.5 &&
  point.y >= rect.y - 0.5 && point.y <= rect.y + rect.h + 0.5;

function pathStaysInZone(zoneRects, links, from, to) {
  const length = Math.hypot(to.x - from.x, to.y - from.y);
  const count = Math.max(1, Math.ceil(length / PATH_SAMPLE));
  for (let i = 1; i < count; i += 1) {
    const k = i / count;
    const point = { x: from.x + (to.x - from.x) * k, y: from.y + (to.y - from.y) * k };
    const inside = zoneRects.some((rect) => pointInRect(rect, point)) ||
      links.some((wall) => pointInRect(wall.band, point));
    if (!inside) return false;
  }
  return true;
}

function exteriorClear(project, aperture, hit, z, sun, obstacles) {
  const outsideLocal = {
    x: hit.x + aperture.normalLocal.x * 20,
    y: hit.y + aperture.normalLocal.y * 20,
  };
  const outside = toWorld(project.building, outsideLocal);
  return !sunRayBlocked(outside, z, sun, obstacles, aperture);
}

function rayPassesAperture(project, zoneRects, links, point, pointZ, aperture, sun, obstacles) {
  const facing = dot(sun.localDir, aperture.normalLocal);
  if (facing <= FACADE_EPS) return false;
  const delta = {
    x: aperture.planeLocal.x - point.x,
    y: aperture.planeLocal.y - point.y,
  };
  const distance = dot(delta, aperture.normalLocal) / facing;
  if (!(distance > 0)) return false;
  const wallThickness = Math.max(0, Number(aperture.wallThickness) || 0);
  const innerDistance = distance - wallThickness / facing;
  if (!(innerDistance > 0)) return false;
  const outerHit = { x: point.x + sun.localDir.x * distance, y: point.y + sun.localDir.y * distance };
  const innerHit = { x: point.x + sun.localDir.x * innerDistance, y: point.y + sun.localDir.y * innerDistance };
  const innerPlane = {
    x: aperture.planeLocal.x - aperture.normalLocal.x * wallThickness,
    y: aperture.planeLocal.y - aperture.normalLocal.y * wallThickness,
  };
  const bottom = aperture.elevation + aperture.sill;
  for (const [hit, plane, rayDistance] of [
    [innerHit, innerPlane, innerDistance], [outerHit, aperture.planeLocal, distance],
  ]) {
    const along = dot({ x: hit.x - plane.x, y: hit.y - plane.y }, aperture.tangentLocal);
    if (Math.abs(along) > aperture.width / 2 + 0.5) return false;
    const z = pointZ + rayDistance * sun.tanAlt;
    if (z < bottom - 0.5 || z > bottom + aperture.height + 0.5) return false;
  }
  if (!pathStaysInZone(zoneRects, links, point, innerHit)) return false;
  const outerZ = pointZ + distance * sun.tanAlt;
  return exteriorClear(project, aperture, outerHit, outerZ, sun, obstacles);
}

function sunlightTable(project, date, from, to, stepMin) {
  const site = project.site || {};
  const location = site.location || {};
  const north = ((Number(site.north) || 0) * Math.PI) / 180;
  const out = [];
  for (let minute = from; minute < to; minute += stepMin) {
    const duration = Math.min(stepMin, to - minute);
    const position = sunPosition(location.lat, location.lon, location.tz, date, minute + duration / 2);
    if (!(position.altitude > 0)) continue;
    const angle = north + (position.azimuth * Math.PI) / 180;
    const dir = { x: Math.sin(angle), y: -Math.cos(angle) };
    out.push({
      minute,
      duration,
      dir,
      localDir: localSunDirection(project, dir),
      tanAlt: Math.tan((position.altitude * Math.PI) / 180),
    });
  }
  return out;
}

function glazingSummary(project, level, zone, apertures) {
  const area = apertures.reduce((sum, aperture) => sum + aperture.width * aperture.height, 0) / 1_000_000;
  const lp = levelProject(project, level.id);
  const floorArea = zone.reduce((sum, room) => sum + roomNetAreaM2(lp, room), 0);
  const ratio = floorArea > 0 ? area / floorArea : 0;
  return { area, floorArea, ratio, requiredRatio: LIGHT_RATIO, meets: ratio >= LIGHT_RATIO - 1e-9 };
}

// Дешёвый ключ исключает мебель, подложки и оформление: они не участвуют в
// лучах. UI может не пересчитывать карту при переименовании или меблировке.
export function roomSunlightAnalysisKey(project, options = {}) {
  if (!project) return '';
  const site = project.site || {};
  const roomShape = (room) => [
    room.id, room.type, room.x, room.y, room.w, room.h, room.parentId || '', room.ceiling || '',
    room.outline || null, room.notch || null, room.takesArea ?? '', room.open ?? '', room.shaft ?? '', room.walls || null,
  ];
  const windowShape = (opening) => opening.kind === 'window' ? [
    opening.id, opening.roomId || '', opening.side ?? '', opening.offset ?? '', opening.width,
    opening.height, opening.heightMode || '', opening.sill, opening.orphan || false, opening.host || null,
  ] : null;
  const wallShape = (wall) => [
    wall.id, wall.axis || null, wall.justify || '', wall.thickness, wall.typeId || '', wall.wallType || '',
    wall.base || null, wall.top || null,
  ];
  return JSON.stringify({
    target: [options.levelId || project.activeLevel, options.roomId || '', options.date || site.sun?.date || '',
      options.from ?? '', options.to ?? '', options.stepMin ?? '', options.cell ?? '', options.maxCells ?? '', options.workplane ?? ''],
    building: project.building || null,
    settings: [project.settings?.partition, project.settings?.exterior, project.settings?.bearing, project.settings?.wallsEngine || ''],
    sun: [site.location?.lat, site.location?.lon, site.location?.tz, site.north, site.solarVerified, site.norms || null],
    neighbors: (site.neighbors || []).map((neighbor) => [
      neighbor.id, neighbor.x, neighbor.y, neighbor.w, neighbor.h, neighbor.height,
      neighbor.elevation ?? neighbor.base ?? 0, neighbor.rot || 0,
    ]),
    massVoids: (project.massVoids || []).map((mass) => [
      mass.id, mass.x, mass.y, mass.w, mass.d, mass.z0, mass.h, mass.rotation || 0,
    ]),
    masses: (project.masses || []).map((mass) => [
      mass.id, mass.x, mass.y, mass.w, mass.d, mass.z0, mass.h, mass.rotation || 0,
    ]),
    roofs: (project.roofs || []).map((roof) => [
      roof.id, roof.levelId, roof.dz || 0, roof.thickness,
      roof.outline || null, roof.overhang || null,
    ]),
    landscape: (site.landscape?.objects || []).map((object) => [
      object.id, object.kind, object.x, object.y, object.w, object.h, object.rotation || 0,
      object.height, object.elev || 0, object.parent || '', object.variant || '',
      object.width || 0, object.points || null, object.meta || null,
    ]),
    levels: (project.levels || []).map((level) => ({
      id: level.id,
      elevation: level.elevation,
      height: level.height,
      tallWindowHeight: level.tallWindowHeight,
      rooms: (level.rooms || []).map(roomShape),
      windows: (level.openings || []).map(windowShape).filter(Boolean),
      wallOverrides: level.wallOverrides || {},
      walls: (level.walls || []).map(wallShape),
      slabOpenings: level.slabOpenings || [],
      stairs: (level.items || []).filter((item) => item.kind === 'stairs').map((item) => [
        item.id, item.x, item.y, item.w, item.h, item.rotation || 0, item.toLevel || '',
      ]),
    })),
  });
}

// Карта часов прямого солнца на горизонтальной рабочей плоскости. Значения
// остаются расчётными и при неподтверждённых координатах, но estimated=true
// не позволяет интерфейсу выдать их за проверенный результат.
export function roomSunlightAnalysis(project, options = {}) {
  const levelId = options.levelId || project?.activeLevel;
  const level = project?.levels?.find((candidate) => candidate.id === levelId) || null;
  const room = level?.rooms?.find((candidate) => candidate.id === options.roomId) || null;
  if (!project || !level || !room) return null;

  const site = project.site || {};
  const location = site.location || {};
  const available = [location.lat, location.lon, location.tz].every(Number.isFinite);
  const northKnown = site.north !== null && site.north !== '' && Number.isFinite(Number(site.north));
  const verified = available && northKnown && site.solarVerified === true;
  const date = String(options.date || site.sun?.date || '2026-06-21');
  const stepMin = Math.round(clamp(Number(options.stepMin) || DEFAULT_STEP, 1, 60));
  const from = Math.round(clamp(Number.isFinite(Number(options.from)) ? Number(options.from) : 0, 0, 1440));
  const to = Math.round(clamp(Number.isFinite(Number(options.to)) ? Number(options.to) : 1440, from, 1440));
  const ceiling = Math.max(100, roomCeiling(room, level));
  const requestedWorkplane = Number(options.workplane);
  const workplane = clamp(Number.isFinite(requestedWorkplane) ? requestedWorkplane : DEFAULT_WORKPLANE, 0, Math.max(0, ceiling - 100));
  const lp = levelProject(project, level.id);
  const solarContext = options.solarContext && typeof options.solarContext === 'object' ? options.solarContext : null;
  const walls = solarContext?.wallsByLevel instanceof Map
    ? (solarContext.wallsByLevel.get(level.id) || deriveWalls(lp))
    : deriveWalls(lp);
  const zone = room.parentId ? [room] : openPlanZone(lp, room, walls);
  const zoneIds = new Set(zone.map((candidate) => candidate.id));
  const zoneRects = zone.flatMap((candidate) => roomNetRects(lp, candidate));
  const links = walls.filter((wall) => wall.hidden && wall.kind === 'shared' && wall.band &&
    wall.rooms?.length === 2 && wall.rooms.every((id) => zoneIds.has(id)));
  const grid = roomSunGrid(room, { ...options, rects: roomNetRects(lp, room) });
  // Пакетный/годовой расчёт может один раз подготовить эти две дорогие
  // производные структуры и передавать их всем комнатам и датам. Снимок не
  // входит в key: вызывающая сторона пересобирает его при изменении проекта.
  const projectWindows = Array.isArray(solarContext?.windows) ? solarContext.windows : windowsOf(project);
  const apertures = projectWindows.filter((window) => window.levelId === level.id && zoneIds.has(window.roomId));
  const glazing = glazingSummary(project, level, zone, apertures);
  const preparedObstacles = Array.isArray(solarContext?.obstacles) ? solarContext.obstacles : null;
  const obstacles = available && apertures.length
    ? (preparedObstacles || solarObstaclesOf(project))
    : [];
  const table = available && apertures.length && to > from ? sunlightTable(project, date, from, to, stepMin) : [];
  const pointZ = (Number(level.elevation) || 0) + workplane;

  for (const sun of table) {
    for (const point of grid.points) {
      if (apertures.some((aperture) => rayPassesAperture(project, zoneRects, links, point, pointZ, aperture, sun, obstacles))) {
        point.minutes += sun.duration;
      }
    }
  }

  let weightedMinutes = 0;
  let sampledArea = 0;
  let litArea = 0;
  let coverage2hArea = 0;
  let maxMinutes = 0;
  for (const point of grid.points) {
    point.hours = point.minutes / 60;
    const area = point.area;
    sampledArea += area;
    weightedMinutes += point.minutes * area;
    if (point.minutes > 0) litArea += area;
    if (point.minutes >= 120) coverage2hArea += area;
    maxMinutes = Math.max(maxMinutes, point.minutes);
  }
  const meanMinutes = sampledArea > 0 ? weightedMinutes / sampledArea : 0;
  const litShare = sampledArea > 0 ? litArea / sampledArea : 0;
  const coverage2h = sampledArea > 0 ? coverage2hArea / sampledArea : 0;

  return {
    // Пакетный расчёт этажа уже построил общий fingerprint геометрии. Его
    // компактный ключ не заставляет повторно сериализовать весь дом для
    // каждой комнаты; одиночные вызовы сохраняют прежнее поведение API.
    key: options.analysisKey || roomSunlightAnalysisKey(project, options),
    available,
    verified,
    estimated: !verified,
    date,
    from,
    to,
    stepMin,
    workplane,
    levelId: level.id,
    roomId: room.id,
    zoneRoomIds: zone.map((candidate) => candidate.id),
    cell: grid.cell,
    cols: grid.cols,
    rows: grid.rows,
    points: grid.points,
    windows: apertures.length,
    occluders: {
      total: obstacles.length,
      kinds: obstacles.reduce((counts, obstacle) => {
        const kind = obstacle.kind || 'unknown';
        counts[kind] = (counts[kind] || 0) + 1;
        return counts;
      }, {}),
    },
    assumptions: [...SOLAR_OCCLUDER_ASSUMPTIONS],
    glazing,
    meanMinutes,
    maxMinutes,
    litShare,
    coverage2h,
    litAreaM2: litArea / 1_000_000,
    solarExposureM2h: weightedMinutes / 60 / 1_000_000,
  };
}
