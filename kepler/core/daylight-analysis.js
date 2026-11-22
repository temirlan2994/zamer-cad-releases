// Предварительная оценка естественного света на рабочей плоскости.
// Это не светотехническая экспертиза: расчёт использует стандартное
// пасмурное небо CIE, геометрию окон и упрощённые коэффициенты материалов.
// Результат полезен для сравнения вариантов на концептуальной стадии.

import { toWorld } from './building.js';
import { solarObstaclesOf, sunRayBlocked, windowsOf } from './insolation.js';
import { levelProject, roomCeiling } from './model.js';
import { openPlanZone } from './norms.js';
import { roomSunGrid, roomSunlightAnalysisKey } from './solar-analysis.js';
import { roomNetAreaM2, roomNetRects } from './rooms.js';
import { deriveWalls } from './walls.js';

const DEFAULT_WORKPLANE = 800;
const DEFAULT_EXTERIOR_LUX = 10_000;
const DEFAULT_TRANSMITTANCE = 0.70;
const DEFAULT_FRAME = 0.80;
const DEFAULT_MAINTENANCE = 0.90;
const DEFAULT_REFLECTANCE = 0.50;
const DEFAULT_DF_TARGET = 2;
const DEFAULT_LUX_TARGET = 300;
const MAX_CELLS = 400;
const PATH_STEP = 100;
const FACING_EPS = 1e-8;
// Интеграл яркости CIE overcast по горизонтальной полусфере: 7π/9 · Lz.
const CIE_HORIZONTAL = 7 * Math.PI / 9;

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const dot = (a, b) => a.x * b.x + a.y * b.y;
const hasFiniteValue = (value) => value !== null && value !== '' && Number.isFinite(Number(value));
const finiteOr = (value, fallback) => hasFiniteValue(value) ? Number(value) : fallback;

function pointInRect(rect, point) {
  return point.x >= rect.x - 0.5 && point.x <= rect.x + rect.w + 0.5 &&
    point.y >= rect.y - 0.5 && point.y <= rect.y + rect.h + 0.5;
}

function pathInsideZone(zoneRects, links, from, to) {
  const length = Math.hypot(to.x - from.x, to.y - from.y);
  const count = Math.max(1, Math.ceil(length / PATH_STEP));
  for (let i = 1; i < count; i += 1) {
    const k = i / count;
    const point = { x: from.x + (to.x - from.x) * k, y: from.y + (to.y - from.y) * k };
    if (!zoneRects.some((rect) => pointInRect(rect, point)) &&
      !links.some((wall) => pointInRect(wall.band, point))) return false;
  }
  return true;
}

function vectorToWorld(building, vector) {
  const angle = (finiteOr(building?.rotation, 0) * Math.PI) / 180;
  const c = Math.cos(angle); const s = Math.sin(angle);
  return { x: vector.x * c - vector.y * s, y: vector.x * s + vector.y * c };
}

function openingRecord(project, openingId) {
  for (const level of project.levels || []) {
    const opening = (level.openings || []).find((candidate) => candidate.id === openingId);
    if (opening) return opening;
  }
  return null;
}

function apertureTransmission(project, aperture, fallback) {
  const opening = openingRecord(project, aperture.openingId);
  const own = opening?.transmittance ?? opening?.glassTransmission;
  return clamp(hasFiniteValue(own) ? Number(own) : fallback, 0, 1);
}

function apertureSamples(aperture, alongCount, verticalCount) {
  const out = [];
  const widthStep = aperture.width / alongCount;
  const heightStep = aperture.height / verticalCount;
  const area = widthStep * heightStep;
  for (let yi = 0; yi < verticalCount; yi += 1) {
    const z = aperture.elevation + aperture.sill + (yi + 0.5) * heightStep;
    for (let xi = 0; xi < alongCount; xi += 1) {
      const along = -aperture.width / 2 + (xi + 0.5) * widthStep;
      out.push({
        x: aperture.planeLocal.x + aperture.tangentLocal.x * along,
        y: aperture.planeLocal.y + aperture.tangentLocal.y * along,
        z,
        area,
      });
    }
  }
  return out;
}

function sampleKernel(project, point, pointZ, aperture, sample, zoneRects, links, obstacles) {
  const delta = { x: sample.x - point.x, y: sample.y - point.y };
  const horizontal = Math.hypot(delta.x, delta.y);
  const dz = sample.z - pointZ;
  if (!(horizontal > 1) || !(dz > 1)) return { potential: 0, visible: 0 };
  const localDir = { x: delta.x / horizontal, y: delta.y / horizontal };
  const facing = dot(localDir, aperture.normalLocal);
  if (facing <= FACING_EPS) return { potential: 0, visible: 0 };

  // Проверяем обе грани откоса: луч не должен попасть в бок, подоконник
  // или перемычку на внутренней плоскости стены.
  const wallThickness = Math.max(0, finiteOr(aperture.wallThickness, 0));
  const innerDistance = horizontal - wallThickness / facing;
  if (!(innerDistance > 0)) return { potential: 0, visible: 0 };
  const innerPlane = {
    x: aperture.planeLocal.x - aperture.normalLocal.x * wallThickness,
    y: aperture.planeLocal.y - aperture.normalLocal.y * wallThickness,
  };
  const innerHit = {
    x: point.x + localDir.x * innerDistance,
    y: point.y + localDir.y * innerDistance,
  };
  const innerAlong = dot({ x: innerHit.x - innerPlane.x, y: innerHit.y - innerPlane.y }, aperture.tangentLocal);
  const innerZ = pointZ + dz * (innerDistance / horizontal);
  const bottom = aperture.elevation + aperture.sill;
  if (Math.abs(innerAlong) > aperture.width / 2 + 0.5 ||
    innerZ < bottom - 0.5 || innerZ > bottom + aperture.height + 0.5 ||
    !pathInsideZone(zoneRects, links, point, innerHit)) return { potential: 0, visible: 0 };

  const distance3d = Math.hypot(horizontal, dz);
  const sinAltitude = dz / distance3d;
  const cosWindow = facing * horizontal / distance3d;
  const skyWeight = (1 + 2 * sinAltitude) / 3;
  const potential = skyWeight * sinAltitude * cosWindow * sample.area /
    (distance3d * distance3d * CIE_HORIZONTAL);
  if (!(potential > 0)) return { potential: 0, visible: 0 };

  // Продолжаем тот же луч от наружной грани окна к небу.
  const advance = 20 / facing;
  const outsideLocal = { x: sample.x + localDir.x * advance, y: sample.y + localDir.y * advance };
  const outside = toWorld(project.building, outsideLocal);
  const worldDir = vectorToWorld(project.building, localDir);
  const tanAlt = dz / horizontal;
  const outsideZ = sample.z + advance * tanAlt;
  const blocked = sunRayBlocked(outside, outsideZ, { dir: worldDir, tanAlt }, obstacles, aperture);
  return { potential, visible: blocked ? 0 : potential };
}

function confidenceOf(project, apertures, options) {
  const explicitGlobal = hasFiniteValue(options.transmittance);
  const explicitAll = apertures.length > 0 && apertures.every((aperture) => {
    const opening = openingRecord(project, aperture.openingId);
    return hasFiniteValue(opening?.transmittance ?? opening?.glassTransmission);
  });
  const materialsKnown = apertures.length > 0 && (explicitGlobal || explicitAll);
  const score = materialsKnown ? 0.65 : 0.50;
  return {
    level: materialsKnown ? 'medium' : 'low',
    score,
    reasons: materialsKnown
      ? ['Геометрия и светопропускание заданы', 'Отражения поверхностей усреднены']
      : ['Светопропускание стекла принято по умолчанию', 'Отражения поверхностей усреднены'],
  };
}

function recommendationsOf(result) {
  const list = [];
  if (!result.windows) {
    list.push({ code: 'NO_WINDOWS', severity: 'error', text: 'Добавьте наружное окно или объедините помещение с освещённой открытой зоной.' });
    return list;
  }
  if (!result.glazing.meets) {
    list.push({ code: 'GLAZING_RATIO', severity: 'warn', text: 'Увеличьте площадь остекления: ориентир — не менее 1:8 площади пола.' });
  }
  if (result.coverageLux < 0.5) {
    list.push({
      code: 'LOW_COVERAGE',
      severity: 'warn',
      text: `Менее половины площади получает ${Math.round(result.thresholds.lux)} лк: рассмотрите более высокое или второе окно.`,
    });
  }
  if (result.uniformity < 0.2 && result.meanLux > 0) {
    list.push({ code: 'LOW_UNIFORMITY', severity: 'info', text: 'Свет распределён неравномерно: полезно второе направление света или светлые поверхности.' });
  }
  if (result.meanWindowSkyVisibility < 0.5) {
    list.push({ code: 'SKY_BLOCKED', severity: 'info', text: 'Значительная часть неба перекрыта внешними объектами.' });
  }
  return list;
}

export function roomDaylightAnalysisKey(project, options = {}) {
  if (!project) return '';
  // Пасмурное небо не зависит от даты, координат, севера или верификации
  // солнца. В ключе сохраняются только геометрия участка и препятствия.
  const daylightProject = {
    ...project,
    site: {
      ...(project.site || {}),
      sun: null,
      location: {},
      north: 0,
      solarVerified: false,
    },
  };
  const base = roomSunlightAnalysisKey(daylightProject, {
    levelId: options.levelId,
    roomId: options.roomId,
    cell: options.cell,
    maxCells: Math.min(MAX_CELLS, Math.max(16, Math.round(finiteOr(options.maxCells, MAX_CELLS)))),
    workplane: options.workplane,
    date: 'daylight-overcast',
  });
  const glass = (project.levels || []).flatMap((level) => (level.openings || [])
    .filter((opening) => opening.kind === 'window')
    .map((opening) => [opening.id, opening.transmittance ?? '', opening.glassTransmission ?? '']));
  return JSON.stringify([base, options.transmittance ?? '', options.frameFactor ?? '', options.maintenanceFactor ?? '',
    options.interiorReflectance ?? '', options.externalLux ?? options.exteriorLux ?? '',
    options.daylightFactorTarget ?? '', options.luxTarget ?? '', options.samplesAlong ?? '',
    options.samplesVertical ?? '', glass]);
}

export function roomDaylightAnalysis(project, options = {}) {
  const levelId = options.levelId || project?.activeLevel;
  const level = project?.levels?.find((candidate) => candidate.id === levelId) || null;
  const room = level?.rooms?.find((candidate) => candidate.id === options.roomId) || null;
  if (!project || !level || !room) return null;

  const lp = levelProject(project, level.id);
  const walls = deriveWalls(lp);
  const zone = room.parentId ? [room] : openPlanZone(lp, room, walls);
  const zoneIds = new Set(zone.map((candidate) => candidate.id));
  const zoneRects = zone.flatMap((candidate) => roomNetRects(lp, candidate));
  const links = walls.filter((wall) => wall.hidden && wall.kind === 'shared' && wall.band &&
    wall.rooms?.length === 2 && wall.rooms.every((id) => zoneIds.has(id)));
  const roomRects = roomNetRects(lp, room);
  const maxCells = Math.min(MAX_CELLS, Math.max(16, Math.round(finiteOr(options.maxCells, MAX_CELLS))));
  const grid = roomSunGrid(room, { ...options, maxCells, rects: roomRects });
  const apertures = windowsOf(project).filter((window) =>
    window.levelId === level.id && zoneIds.has(window.roomId) && window.width > 0 && window.height > 0);
  const obstacles = apertures.length ? solarObstaclesOf(project) : [];

  const ceiling = Math.max(100, roomCeiling(room, level));
  const requestedWorkplane = Number(options.workplane);
  const workplane = clamp(Number.isFinite(requestedWorkplane) ? requestedWorkplane : DEFAULT_WORKPLANE, 0, Math.max(0, ceiling - 100));
  const pointZ = (Number(level.elevation) || 0) + workplane;
  const transmittance = clamp(finiteOr(options.transmittance, DEFAULT_TRANSMITTANCE), 0, 1);
  const frameFactor = clamp(finiteOr(options.frameFactor, DEFAULT_FRAME), 0, 1);
  const maintenanceFactor = clamp(finiteOr(options.maintenanceFactor, DEFAULT_MAINTENANCE), 0, 1);
  const interiorReflectance = clamp(finiteOr(options.interiorReflectance, DEFAULT_REFLECTANCE), 0, 0.9);
  const externalLux = clamp(finiteOr(options.externalLux ?? options.exteriorLux, DEFAULT_EXTERIOR_LUX), 1000, 100_000);
  const daylightFactorTarget = clamp(finiteOr(options.daylightFactorTarget, DEFAULT_DF_TARGET), 0.1, 20);
  const luxTarget = clamp(finiteOr(options.luxTarget, DEFAULT_LUX_TARGET), 10, 5000);
  const samplesAlong = Math.round(clamp(finiteOr(options.samplesAlong, 4), 2, 8));
  const samplesVertical = Math.round(clamp(finiteOr(options.samplesVertical, 4), 2, 8));
  const sampleSets = apertures.map((aperture) => {
    const glassTransmission = apertureTransmission(project, aperture, transmittance);
    return {
      aperture,
      samples: apertureSamples(aperture, samplesAlong, samplesVertical),
      glassTransmission,
      effectiveTransmission: glassTransmission * frameFactor * maintenanceFactor,
    };
  });

  const floorArea = zone.reduce((sum, candidate) => sum + roomNetAreaM2(lp, candidate), 0);
  const glazingArea = apertures.reduce((sum, aperture) => sum + aperture.width * aperture.height, 0) / 1_000_000;
  const effectiveArea = sampleSets.reduce((sum, set) =>
    sum + set.aperture.width * set.aperture.height * set.effectiveTransmission, 0) / 1_000_000;
  const glazingRatio = floorArea > 0 ? glazingArea / floorArea : 0;
  const effectiveRatio = floorArea > 0 ? effectiveArea / floorArea : 0;

  for (const point of grid.points) {
    let potential = 0;
    let visible = 0;
    let transmitted = 0;
    for (const set of sampleSets) {
      for (const sample of set.samples) {
        const kernel = sampleKernel(project, point, pointZ, set.aperture, sample, zoneRects, links, obstacles);
        potential += kernel.potential;
        visible += kernel.visible;
        transmitted += kernel.visible * set.effectiveTransmission;
      }
    }
    const skyView = potential > 0 ? clamp(visible / potential, 0, 1) : 0;
    const directDf = 100 * clamp(transmitted, 0, 1);
    const reflectedDf = effectiveRatio * interiorReflectance * 2.5 * skyView;
    // Это видимость участков пасмурного неба через данное окно, а не
    // полный hemispherical sky-view factor для точки.
    point.windowSkyVisibility = skyView;
    point.daylightFactor = clamp(directDf + reflectedDf, 0, 25);
    // Определение daylight factor: DF = Ein / Eout × 100 %.
    point.estimatedLux = point.daylightFactor / 100 * externalLux;
  }

  let area = 0;
  let weightedDf = 0;
  let weightedWindowSkyVisibility = 0;
  let coverageDfArea = 0;
  let coverageLuxArea = 0;
  let coverage300Area = 0;
  let minDf = Infinity;
  let maxDf = 0;
  for (const point of grid.points) {
    area += point.area;
    weightedDf += point.daylightFactor * point.area;
    weightedWindowSkyVisibility += point.windowSkyVisibility * point.area;
    if (point.daylightFactor >= daylightFactorTarget) coverageDfArea += point.area;
    if (point.estimatedLux >= luxTarget) coverageLuxArea += point.area;
    if (point.estimatedLux >= 300) coverage300Area += point.area;
    minDf = Math.min(minDf, point.daylightFactor);
    maxDf = Math.max(maxDf, point.daylightFactor);
  }
  const meanDaylightFactor = area > 0 ? weightedDf / area : 0;
  // Выводим из уже усреднённого DF, чтобы тождество оставалось точным и в API.
  const meanLux = meanDaylightFactor / 100 * externalLux;
  const coverageDaylightFactor = area > 0 ? coverageDfArea / area : 0;
  const coverageLux = area > 0 ? coverageLuxArea / area : 0;
  const result = {
    key: roomDaylightAnalysisKey(project, options),
    method: 'cie-overcast-concept/1',
    preliminary: true,
    available: true,
    estimated: true,
    normative: false,
    label: 'Предварительная оценка дневного света при пасмурном небе',
    levelId: level.id,
    roomId: room.id,
    zoneRoomIds: zone.map((candidate) => candidate.id),
    workplane,
    externalLux,
    // Совместимый с ранним прототипом alias.
    exteriorLux: externalLux,
    windows: apertures.length,
    cell: grid.cell,
    cols: grid.cols,
    rows: grid.rows,
    points: grid.points,
    glazing: {
      area: glazingArea,
      effectiveArea,
      floorArea,
      ratio: glazingRatio,
      requiredRatio: 1 / 8,
      meets: glazingRatio >= 1 / 8 - 1e-9,
    },
    assumptions: {
      sky: 'CIE overcast',
      externalLux,
      exteriorLux: externalLux,
      workplane,
      transmission: {
        defaultGlass: transmittance,
        frameFactor,
        maintenanceFactor,
        windows: sampleSets.map((set) => ({
          openingId: set.aperture.openingId,
          glass: set.glassTransmission,
          effective: set.effectiveTransmission,
        })),
      },
      interiorReflectance,
      reflections: 'Усреднённая добавка от внутренних поверхностей',
      shading: 'Непрозрачные внешние объёмы, проверка лучом к участкам окна',
      skyVisibility: 'Взвешенная видимость неба только через оконную апертуру, не полный SVF полусферы',
      samplesPerWindow: samplesAlong * samplesVertical,
    },
    confidence: confidenceOf(project, apertures, options),
    thresholds: { daylightFactor: daylightFactorTarget, lux: luxTarget },
    meanDaylightFactor,
    minDaylightFactor: Number.isFinite(minDf) ? minDf : 0,
    maxDaylightFactor: maxDf,
    meanLux,
    coverageDaylightFactor,
    coverageLux,
    coverage300: area > 0 ? coverage300Area / area : 0,
    coverage: { daylightFactor: coverageDaylightFactor, lux: coverageLux },
    meanWindowSkyVisibility: area > 0 ? weightedWindowSkyVisibility / area : 0,
    uniformity: meanDaylightFactor > 0 && Number.isFinite(minDf) ? minDf / meanDaylightFactor : 0,
    formula: 'daylightFactor = indoorLux / externalLux * 100; estimatedLux = daylightFactor / 100 * externalLux',
    physicalCapDaylightFactor: 25,
  };
  result.recommendations = recommendationsOf(result);
  return result;
}
