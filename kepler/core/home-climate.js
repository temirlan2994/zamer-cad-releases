// Предварительный обзор света и климатических исходных данных дома.
//
// Модуль намеренно разделяет дешёвую сводку всего дома и подробный расчёт
// одной выбранной комнаты. Он не рассчитывает температуру, воздухообмен,
// теплопотери или CFD и не превращает эскизные световые ориентиры в нормы.

import { roomDaylightAnalysis, roomDaylightAnalysisKey } from './daylight-analysis.js';
import { isOpenRoom, isShaft } from './catalog.js';
import { analyzeHomeEngineering } from './home-engineering.js';
import { insolationReport, windowsOf } from './insolation.js';
import { levelProject } from './model.js';
import { roomNetAreaM2 } from './rooms.js';
import { roomSunlightAnalysis, roomSunlightAnalysisKey } from './solar-analysis.js';

const THERMAL_MISSING = Object.freeze([
  'climate_file',
  'envelope',
  'glass_shgc',
  'airtightness',
  'internal_loads',
  'hvac',
]);

const array = (value) => (Array.isArray(value) ? value : []);
const hasFiniteValue = (value) => value !== null && value !== undefined && value !== ''
  && Number.isFinite(Number(value));
const roomKey = (levelId, roomId) => `${levelId}:${roomId}`;

function solarSource(project) {
  const site = project?.site || {};
  const location = site.location || {};
  const coordinatesKnown = hasFiniteValue(location.lat) && Number(location.lat) >= -90 && Number(location.lat) <= 90
    && hasFiniteValue(location.lon) && Number(location.lon) >= -180 && Number(location.lon) <= 180
    && hasFiniteValue(location.tz) && Number(location.tz) >= -14 && Number(location.tz) <= 14
    && hasFiniteValue(site.north);
  const verified = coordinatesKnown && site.solarVerified === true;
  return {
    status: verified ? 'verified' : (coordinatesKnown ? 'estimated' : 'missing'),
    verified,
    coordinatesKnown,
    reason: verified
      ? 'Координаты, часовой пояс и направление севера подтверждены пользователем.'
      : coordinatesKnown
        ? 'Координаты заданы, но направление и положение участка не подтверждены.'
        : 'Не хватает координат, часового пояса или направления севера.',
  };
}

function ventilationForRoom(engineering, key) {
  const room = array(engineering?.rooms).find((entry) => entry.key === key);
  const required = array(room?.systems).map((system) => system.id)
    .filter((id) => id === 'supply' || id === 'extract');
  const coverage = array(engineering?.coverage).find((entry) => entry.roomKey === key);
  const covered = array(coverage?.systems).filter((system) => required.includes(system.system));
  const facts = covered.filter((system) => system.status === 'fact');
  const candidates = array(engineering?.points?.records).filter((point) =>
    point.roomKey === key && required.includes(point.system) && point.status === 'candidate');
  const status = required.length === 0 ? 'not_required'
    : facts.length === required.length ? 'fact'
      : facts.length || candidates.length ? 'candidate' : 'unknown';
  return {
    status,
    required,
    pointIds: facts.flatMap((system) => array(system.pointIds)),
    candidatePointIds: candidates.map((point) => point.id),
    // Явно null: наличие точки не является расчётом расхода воздуха.
    airChangePerHour: null,
    airflowM3h: null,
  };
}

function safeWindows(project) {
  if (!array(project?.levels).length) return [];
  try { return windowsOf(project); } catch { return []; }
}

/**
 * Дешёвая сводка исходных данных всего дома. Не запускает лучевые карты.
 */
export function analyzeHomeClimateOverview(project = {}) {
  const engineering = analyzeHomeEngineering(project);
  const solar = solarSource(project);
  const windows = safeWindows(project);
  const byRoom = new Map();
  for (const window of windows) {
    const key = roomKey(window.levelId, window.roomId);
    const list = byRoom.get(key) || [];
    list.push(window);
    byRoom.set(key, list);
  }

  const rooms = [];
  for (const level of array(project?.levels)) {
    const levelView = levelProject(project, level.id);
    for (const room of array(level?.rooms)) {
      if (isShaft(room) || isOpenRoom(room) || !(roomNetAreaM2(levelView, room) > 0)) continue;
      const key = roomKey(level.id, room.id);
      const roomWindows = byRoom.get(key) || [];
      const glazingAreaM2 = roomWindows.reduce((sum, window) =>
        sum + Math.max(0, Number(window.width) || 0) * Math.max(0, Number(window.height) || 0), 0) / 1_000_000;
      const ventilation = ventilationForRoom(engineering, key);
      const missing = [];
      if (!roomWindows.length) missing.push('exterior_window');
      if (solar.status === 'missing') missing.push('solar_context');
      if (ventilation.status === 'unknown') missing.push('ventilation_points');
      rooms.push({
        key,
        levelId: level.id,
        levelName: level.name || level.id,
        roomId: room.id,
        name: room.name || room.type || 'Помещение',
        type: room.type || 'room',
        windowCount: roomWindows.length,
        windowIds: roomWindows.map((window) => window.openingId),
        glazingAreaM2,
        ventilation,
        missing,
      });
    }
  }

  const warnings = [];
  if (!rooms.length) warnings.push('Сначала добавьте помещения, чтобы оценить световые условия.');
  if (rooms.some((room) => room.windowCount === 0)) {
    warnings.push('Есть помещения без наружных окон; это известный геометрический факт, но не нормативное заключение.');
  }
  if (solar.status === 'estimated') warnings.push('Солнечные результаты будут ориентировочными, пока координаты и север не подтверждены.');
  if (solar.status === 'missing') warnings.push('Для прямого солнца задайте координаты, часовой пояс и направление севера.');
  if (engineering.ventilation?.status !== 'fact') {
    warnings.push('Вентиляция отражает только наличие явно заданных точек; расходы воздуха и воздухообмен не рассчитаны.');
  }
  warnings.push('Температура и риск перегрева не рассчитываются: нет климатического файла и характеристик ограждений.');

  const summary = {
    roomCount: rooms.length,
    windowCount: new Set(rooms.flatMap((room) => room.windowIds)).size,
    windowlessRoomCount: rooms.filter((room) => room.windowCount === 0).length,
    roomsWithVentilationNeed: rooms.filter((room) => room.ventilation.required.length).length,
    ventilationFactRoomCount: rooms.filter((room) => room.ventilation.status === 'fact').length,
    ventilationCandidateRoomCount: rooms.filter((room) => room.ventilation.status === 'candidate').length,
    ventilationUnknownRoomCount: rooms.filter((room) => room.ventilation.status === 'unknown').length,
  };

  return {
    schema: 'kepler-home-climate/1',
    preliminary: true,
    normative: false,
    status: engineering.status === 'conflict' ? 'conflict' : (rooms.length ? 'candidate' : 'unknown'),
    sources: {
      solar,
      daylight: {
        status: 'preliminary',
        model: 'cie-overcast-concept/1',
        reason: 'Эскизная модель пасмурного неба; не светотехническая экспертиза.',
      },
      climate: { status: 'missing', reason: 'Климатический файл не подключён.' },
      envelope: { status: 'missing', reason: 'Теплотехнические свойства ограждений не заданы.' },
      ventilation: {
        status: engineering.ventilation?.status || 'unknown',
        reason: engineering.ventilation?.reason || 'Вентиляционные точки не обследованы.',
      },
    },
    rooms,
    summary,
    warnings,
    assumptions: [
      'Световые значения являются предварительной оценкой концепции, а не нормативным заключением.',
      'Инженерные точки не доказывают расход воздуха и работоспособность вентиляции.',
    ],
  };
}

/** Ключ подробной сводки: обе световые модели и инженерные исходные данные. */
export function homeClimateRoomKey(project = {}, options = {}) {
  const levelId = options.levelId || project?.activeLevel;
  const opts = { ...options, levelId };
  return JSON.stringify({
    overview: homeClimateOverviewKey(project),
    daylight: roomDaylightAnalysisKey(project, opts),
    direct: roomSunlightAnalysisKey(project, opts),
    engineering: project?.layoutBrief?.fixedEngineering ?? null,
  });
}

/**
 * Подробная эскизная оценка одной комнаты. Тяжёлые сетки остаются внутри
 * базовых анализаторов и наружу не копируются.
 */
export function analyzeHomeClimateRoom(project = {}, options = {}) {
  const levelId = options.levelId || project?.activeLevel;
  const level = array(project?.levels).find((candidate) => candidate.id === levelId);
  const room = array(level?.rooms).find((candidate) => candidate.id === options.roomId);
  if (!level || !room) return null;

  const opts = { ...options, levelId, roomId: room.id };
  const daylightRaw = roomDaylightAnalysis(project, opts);
  const directRaw = roomSunlightAnalysis(project, opts);
  if (!daylightRaw || !directRaw) return null;
  const solar = solarSource(project);
  let insolation = null;
  if (project?.site) {
    try {
      const report = insolationReport(project);
      insolation = array(report?.rooms).find((entry) => entry.levelId === levelId && entry.id === room.id) || null;
      if (insolation) insolation = { ...insolation, targetHours: report.norm?.hours ?? null };
    } catch { insolation = null; }
  }
  const overview = analyzeHomeClimateOverview(project);
  const roomOverview = overview.rooms.find((entry) => entry.key === roomKey(levelId, room.id));
  const hasWindows = daylightRaw.windows > 0;
  const referenceStatus = !hasWindows ? 'none'
    : daylightRaw.glazing.ratio >= daylightRaw.glazing.requiredRatio - 1e-9
      ? 'above_reference' : 'below_reference';

  return {
    schema: 'kepler-home-climate-room/1',
    preliminary: true,
    normative: false,
    levelId,
    roomId: room.id,
    name: room.name || room.type || 'Помещение',
    type: room.type || 'room',
    zoneRoomIds: array(daylightRaw.zoneRoomIds),
    glazing: {
      areaM2: daylightRaw.glazing.area,
      floorAreaM2: daylightRaw.glazing.floorArea,
      ratio: daylightRaw.glazing.ratio,
      referenceRatio: daylightRaw.glazing.requiredRatio,
      referenceStatus,
      normative: false,
    },
    daylight: {
      status: hasWindows ? 'preliminary' : 'no_windows',
      method: daylightRaw.method,
      preliminary: true,
      estimated: true,
      normative: false,
      windows: daylightRaw.windows,
      meanDaylightFactor: daylightRaw.meanDaylightFactor,
      meanLux: daylightRaw.meanLux,
      minDaylightFactor: daylightRaw.minDaylightFactor,
      coverageDaylightFactor: daylightRaw.coverageDaylightFactor,
      coverage300: daylightRaw.coverage300,
      coverageLux: daylightRaw.coverageLux,
      uniformity: daylightRaw.uniformity,
      meanWindowSkyVisibility: daylightRaw.meanWindowSkyVisibility,
      confidence: daylightRaw.confidence,
      recommendations: array(daylightRaw.recommendations),
    },
    directSun: {
      status: !directRaw.available ? 'missing' : (solar.verified ? 'verified' : 'estimated'),
      available: directRaw.available,
      verified: solar.verified,
      estimated: !solar.verified,
      date: directRaw.date,
      windows: directRaw.windows,
      meanMinutes: directRaw.available ? directRaw.meanMinutes : null,
      maxMinutes: directRaw.available ? directRaw.maxMinutes : null,
      litShare: directRaw.available ? directRaw.litShare : null,
      coverage2h: directRaw.available ? directRaw.coverage2h : null,
      exposureM2h: directRaw.available ? directRaw.solarExposureM2h : null,
    },
    insolation: {
      status: !solar.verified || !insolation ? 'unknown'
        : (insolation.meets ? 'meets_reference' : 'below_reference'),
      totalMinutes: insolation?.total ?? null,
      longestMinutes: insolation?.longest ?? null,
      targetHours: insolation?.targetHours ?? null,
      normative: false,
      reason: solar.verified
        ? 'Сравнение с ориентиром из настроек проекта; не нормативное заключение.'
        : 'Ориентир не сравнивается до подтверждения координат и направления севера.',
    },
    ventilation: roomOverview?.ventilation || {
      status: 'unknown', required: [], pointIds: [], candidatePointIds: [],
      airChangePerHour: null, airflowM3h: null,
    },
    thermal: {
      status: 'unknown',
      numericHours: null,
      temperatureC: null,
      missing: [...THERMAL_MISSING],
      reason: 'Нет достаточных исходных данных для расчёта температуры или часов перегрева.',
    },
    assumptions: [
      'Дневной свет рассчитан для стандартного пасмурного неба CIE с усреднёнными отражениями.',
      ...array(directRaw.assumptions),
      'Порог 300 лк, коэффициент 2%, ориентир остекления 1:8 и два часа солнца используются только для отображения.',
    ],
    warnings: [
      'Предварительная эскизная оценка, не нормативное или светотехническое заключение.',
      ...(solar.status === 'estimated' ? ['Прямое солнце рассчитано по неподтверждённым координатам или северу.'] : []),
      ...(solar.status === 'missing' ? ['Для прямого солнца не хватает исходных данных участка.'] : []),
      ...(!hasWindows ? ['У выбранной комнаты нет наружных окон.'] : []),
    ],
  };
}

/** Дешёвый ключ только для сводки, без результатов лучевых сеток. */
export function homeClimateOverviewKey(project = {}) {
  return JSON.stringify({
    levels: array(project?.levels).map((level) => ({
      id: level.id,
      name: level.name,
      elevation: level.elevation,
      height: level.height,
      slabThickness: level.slabThickness,
      tallWindowHeight: level.tallWindowHeight,
      tallWindowTopOffset: level.tallWindowTopOffset,
      tallWindowBottomOffset: level.tallWindowBottomOffset,
      rooms: array(level.rooms).map((room) => [
        room.id, room.name, room.type, room.x, room.y, room.w, room.h,
        room.parentId || '', room.outline || null, room.notch || null, room.ceiling || null,
      ]),
      openings: array(level.openings).filter((opening) => opening.kind === 'window').map((opening) => [
        opening.id, opening.roomId, opening.side, opening.offset, opening.width,
        opening.height, opening.heightMode || '', opening.sill, opening.host || null, opening.orphan || false, opening.span || null,
      ]),
      items: array(level.items).map((item) => [item.id, item.kind, item.x, item.y]),
      walls: array(level.walls),
      wallOverrides: level.wallOverrides || null,
    })),
    building: project?.building || null,
    solar: {
      location: project?.site?.location || null,
      north: project?.site?.north ?? null,
      verified: project?.site?.solarVerified === true,
    },
    fixedEngineering: project?.layoutBrief?.fixedEngineering ?? null,
  });
}
