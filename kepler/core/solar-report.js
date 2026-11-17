// Годовой световой отчёт по помещениям. Это быстрая эскизная сводка по
// 12 реперным дням (21-е число каждого месяца), а не почасовая симуляция
// всего года и не экспертный расчёт КЕО. Прямое солнце считает
// solar-analysis.js; внешний daylightAnalyzer может один раз на помещение
// добавить предварительные КЕО/люксы без зависимости этого модуля от UI.

import { isOpenRoom, isShaft } from './catalog.js';
import { solarObstaclesOf, windowsOf } from './insolation.js';
import { levelProject, sortedLevels } from './model.js';
import { SP55 } from './norms.js';
import { roomNetAreaM2 } from './rooms.js';
import { roomSchedule } from './schedule.js';
import { roomSunlightAnalysis } from './solar-analysis.js';

export const SOLAR_REPORT_SCHEMA = 'kepler-solar-report/1';
export const SOLAR_REPORT_MONTHS = Object.freeze([
  'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь',
]);

const clamp = (value, lo, hi) => Math.max(lo, Math.min(hi, value));
const mean = (values) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;

function reportYear(project, requested) {
  const direct = Math.round(Number(requested));
  if (direct >= 2000 && direct <= 2100) return direct;
  const stored = Number(String(project?.site?.sun?.date || '').slice(0, 4));
  return stored >= 2000 && stored <= 2100 ? stored : 2026;
}

function reportMonths(requested) {
  const source = Array.isArray(requested) && requested.length ? requested : Array.from({ length: 12 }, (_v, i) => i + 1);
  const normalized = [...new Set(source.map(Number).filter((month) => Number.isInteger(month) && month >= 1 && month <= 12))]
    .sort((a, b) => a - b);
  return normalized.length ? normalized : Array.from({ length: 12 }, (_v, i) => i + 1);
}

function monthDate(year, month) {
  return `${year}-${String(month).padStart(2, '0')}-21`;
}

function scheduleIndex(project) {
  const index = new Map();
  for (const block of roomSchedule(project)) {
    for (const row of block.rows) index.set(`${block.level.id}:${row.id}`, row);
  }
  return index;
}

function daylightSummary(value) {
  if (!value || typeof value !== 'object') return null;
  // Отчёту нужны только конечные показатели: не переносим тяжёлую сетку и
  // произвольные значения стороннего анализатора в JSON/CSV.
  const meanDaylightFactor = Number(value.meanDaylightFactor ?? value.daylightFactor?.mean);
  const meanLux = Number(value.meanLux ?? value.estimatedLux?.mean);
  const coverage300 = Number(value.coverage300 ?? value.coverage?.lux300);
  const sourceConfidence = value.confidence;
  const confidence = sourceConfidence && typeof sourceConfidence === 'object'
    ? {
      level: sourceConfidence.level == null ? null : String(sourceConfidence.level),
      score: sourceConfidence.score !== null && sourceConfidence.score !== '' &&
        Number.isFinite(Number(sourceConfidence.score)) ? Number(sourceConfidence.score) : null,
      reasons: Array.isArray(sourceConfidence.reasons) ? sourceConfidence.reasons.map(String) : [],
    }
    : sourceConfidence == null ? null : { level: String(sourceConfidence), score: null, reasons: [] };
  const sourceAssumptions = value.assumptions && typeof value.assumptions === 'object'
    ? value.assumptions
    : {};
  const sourceTransmission = sourceAssumptions.transmission && typeof sourceAssumptions.transmission === 'object'
    ? sourceAssumptions.transmission
    : {};
  const sourceModel = value.model ?? value.method;
  const optionalNumber = (candidate) => candidate !== null && candidate !== '' && Number.isFinite(Number(candidate))
    ? Number(candidate)
    : null;
  return {
    meanDaylightFactor: Number.isFinite(meanDaylightFactor) ? meanDaylightFactor : null,
    meanLux: Number.isFinite(meanLux) ? meanLux : null,
    coverage300: Number.isFinite(coverage300) ? coverage300 : null,
    preliminary: value.preliminary !== false,
    normative: value.normative === true,
    confidence,
    model: sourceModel == null ? null : String(sourceModel),
    assumptions: {
      sky: sourceAssumptions.sky == null ? null : String(sourceAssumptions.sky),
      externalLux: optionalNumber(sourceAssumptions.externalLux ?? value.externalLux ?? value.exteriorLux),
      workplane: optionalNumber(sourceAssumptions.workplane ?? value.workplane),
      transmission: {
        defaultGlass: optionalNumber(sourceTransmission.defaultGlass),
        frameFactor: optionalNumber(sourceTransmission.frameFactor),
        maintenanceFactor: optionalNumber(sourceTransmission.maintenanceFactor),
        windows: Array.isArray(sourceTransmission.windows) ? sourceTransmission.windows.map((window) => ({
          openingId: window?.openingId == null ? null : String(window.openingId),
          glass: optionalNumber(window?.glass),
          effective: optionalNumber(window?.effective),
        })) : [],
      },
      interiorReflectance: optionalNumber(sourceAssumptions.interiorReflectance),
      samplesPerWindow: optionalNumber(sourceAssumptions.samplesPerWindow),
      reflections: sourceAssumptions.reflections == null ? null : String(sourceAssumptions.reflections),
      shading: sourceAssumptions.shading == null ? null : String(sourceAssumptions.shading),
      skyVisibility: sourceAssumptions.skyVisibility == null ? null : String(sourceAssumptions.skyVisibility),
    },
    thresholds: {
      daylightFactor: optionalNumber(value.thresholds?.daylightFactor),
      lux: optionalNumber(value.thresholds?.lux),
    },
  };
}

function glazingSummary(value, floorArea) {
  const area = finite(value?.area);
  const areaOfFloor = finite(value?.floorArea, finite(floorArea));
  const ratio = finite(value?.ratio, areaOfFloor > 0 ? area / areaOfFloor : 0);
  const requiredRatio = finite(value?.requiredRatio, 1 / 8);
  return {
    area,
    floorArea: areaOfFloor,
    ratio,
    requiredRatio,
    meets: value?.meets === true,
  };
}

function annualOf(months) {
  const byMean = [...months].sort((a, b) => a.meanMinutes - b.meanMinutes || a.month - b.month);
  const worst = byMean[0] || null;
  const best = byMean[byMean.length - 1] || null;
  return {
    representativeDays: months.length,
    averageMeanMinutes: mean(months.map((item) => item.meanMinutes)),
    averageMaxMinutes: mean(months.map((item) => item.maxMinutes)),
    averageCoverage2h: mean(months.map((item) => item.coverage2h)),
    minimumCoverage2h: months.length ? Math.min(...months.map((item) => item.coverage2h)) : 0,
    averageLitShare: mean(months.map((item) => item.litShare)),
    representativeExposureM2h: months.reduce((sum, item) => sum + item.solarExposureM2h, 0),
    monthsWithSun: months.filter((item) => item.meanMinutes > 0).length,
    bestMonth: best ? { month: best.month, label: best.label, meanMinutes: best.meanMinutes } : null,
    worstMonth: worst ? { month: worst.month, label: worst.label, meanMinutes: worst.meanMinutes } : null,
  };
}

function qualityOf(analyses) {
  if (!analyses.length || analyses.every((value) => !value?.available)) return 'unavailable';
  return analyses.every((value) => value?.verified) ? 'verified' : 'estimated';
}

function statusOf(regulated, glazing, quality) {
  return {
    directSunData: quality,
    glazing: !regulated ? 'not-regulated' : glazing?.meets ? 'meets-guideline' : 'below-guideline',
  };
}

// Один пошаговый расчёт используют sync API и UI: async-путь
// уступает event loop, но не дублирует физику и формат отчёта.
function* solarReportSteps(project, options = {}, { responsiveCancel = false } = {}) {
  const year = reportYear(project, options.year);
  const monthNumbers = reportMonths(options.months);
  const monthDefs = monthNumbers.map((month) => ({
    month, label: SOLAR_REPORT_MONTHS[month - 1], date: monthDate(year, month),
  }));
  const levelFilter = options.levelId ? new Set([options.levelId]) : null;
  const roomFilter = Array.isArray(options.roomIds) ? new Set(options.roomIds) : null;
  const stepMin = Math.round(clamp(Number(options.stepMin) || 30, 5, 60));
  const cell = Math.round(clamp(Number(options.cell) || 1000, 250, 5000));
  const maxCells = Math.round(clamp(Number(options.maxCells) || 120, 16, 600));
  const requestedWorkplane = Number(options.workplane);
  const workplane = Number.isFinite(requestedWorkplane) ? Math.max(0, requestedWorkplane) : 800;
  const requestedFrom = Number(options.from);
  const from = Math.round(clamp(Number.isFinite(requestedFrom) ? requestedFrom : 0, 0, 1440));
  const requestedTo = Number(options.to);
  const to = Math.round(clamp(Number.isFinite(requestedTo) ? requestedTo : 1440, from, 1440));
  const rowsByRoom = scheduleIndex(project);
  const targets = [];
  for (const level of sortedLevels(project)) {
    if (levelFilter && !levelFilter.has(level.id)) continue;
    const lp = levelProject(project, level.id);
    const orderedRooms = [...lp.rooms].sort((a, b) => {
      const an = rowsByRoom.get(`${level.id}:${a.id}`)?.number || '';
      const bn = rowsByRoom.get(`${level.id}:${b.id}`)?.number || '';
      return an.localeCompare(bn) || String(a.id).localeCompare(String(b.id));
    });
    for (const room of orderedRooms) {
      if (roomFilter && !roomFilter.has(room.id)) continue;
      if (isShaft(room) || isOpenRoom(room) || !(roomNetAreaM2(lp, room) > 0)) continue;
      targets.push({ level, room });
    }
  }

  const total = targets.length * monthDefs.length;
  // Геометрия окон и затеняющих объектов не меняется между комнатами и
  // реперными датами: один раз подготавливаем её для всего отчёта.
  const solarContext = targets.length ? {
    obstacles: solarObstaclesOf(project),
    windows: windowsOf(project),
  } : { obstacles: [], windows: [] };
  let done = 0;
  let cancelled = false;
  const rooms = [];
  for (const { level, room } of targets) {
    if (options.shouldCancel?.()) { cancelled = true; break; }
    const monthly = [];
    const analyses = [];
    for (const month of monthDefs) {
      if (options.shouldCancel?.()) { cancelled = true; break; }
      const analysis = roomSunlightAnalysis(project, {
        levelId: level.id, roomId: room.id, date: month.date,
        from, to, stepMin, cell, maxCells, workplane, solarContext,
      });
      analyses.push(analysis);
      monthly.push({
        ...month,
        available: Boolean(analysis?.available),
        verified: Boolean(analysis?.verified),
        meanMinutes: finite(analysis?.meanMinutes),
        maxMinutes: finite(analysis?.maxMinutes),
        coverage2h: finite(analysis?.coverage2h),
        litShare: finite(analysis?.litShare),
        litAreaM2: finite(analysis?.litAreaM2),
        solarExposureM2h: finite(analysis?.solarExposureM2h),
      });
      done += 1;
      const progress = { done, total, levelId: level.id, roomId: room.id, month: month.month };
      options.onProgress?.(progress);
      yield { phase: 'direct', progress };
    }
    if (!monthly.length) break;
    const roomArea = roomNetAreaM2(levelProject(project, level.id), room);
    const sample = analyses.find(Boolean);
    const glazing = glazingSummary(sample?.glazing, roomArea);
    const zoneRoomIds = Array.isArray(sample?.zoneRoomIds) && sample.zoneRoomIds.length
      ? [...sample.zoneRoomIds]
      : [room.id];
    const quality = qualityOf(analyses);
    const scheduled = rowsByRoom.get(`${level.id}:${room.id}`);
    let daylight = null;
    if (!cancelled && typeof options.daylightAnalyzer === 'function') {
      const progress = { done, total, levelId: level.id, roomId: room.id };
      yield { phase: 'before-daylight', progress };
      if (responsiveCancel && options.shouldCancel?.()) cancelled = true;
      if (!cancelled) {
        daylight = daylightSummary(options.daylightAnalyzer(project, {
          levelId: level.id, roomId: room.id, cell, maxCells, workplane,
        }));
        yield { phase: 'after-daylight', progress };
        if (responsiveCancel && options.shouldCancel?.()) cancelled = true;
      }
    }
    const regulated = SP55.lightTypes.has(room.type);
    rooms.push({
      levelId: level.id,
      levelName: level.name,
      roomId: room.id,
      number: scheduled?.number || '',
      name: room.name,
      type: room.type,
      area: finite(roomArea),
      regulated,
      quality,
      status: statusOf(regulated, glazing, quality),
      zoneRoomIds,
      glazingScope: zoneRoomIds.length > 1 ? 'open-plan-zone' : 'room',
      glazing,
      sampling: {
        stepMin: finite(sample?.stepMin, stepMin),
        cell: finite(sample?.cell, cell),
        maxCells,
        workplane: finite(sample?.workplane, workplane),
      },
      daylight,
      months: monthly,
      annual: annualOf(monthly),
    });
    if (cancelled) break;
  }

  const regulated = rooms.filter((room) => room.regulated);
  const location = project?.site?.location || {};
  const locationKnown = [location.lat, location.lon, location.tz].every(Number.isFinite);
  const rawNorth = project?.site?.north;
  const north = rawNorth !== null && rawNorth !== '' && Number.isFinite(Number(rawNorth))
    ? Number(rawNorth) : null;
  const site = {
    lat: Number.isFinite(location.lat) ? location.lat : null,
    lon: Number.isFinite(location.lon) ? location.lon : null,
    tz: Number.isFinite(location.tz) ? location.tz : null,
    north,
    verified: locationKnown && north !== null && project?.site?.solarVerified === true,
  };
  return {
    schema: SOLAR_REPORT_SCHEMA,
    version: 1,
    model: {
      id: 'monthly-representative-direct-sun',
      version: 1,
      method: 'ray-traced-direct-sun-on-room-workplane',
    },
    generatedAt: typeof options.generatedAt === 'string' ? options.generatedAt : null,
    projectName: project?.name || 'Проект',
    year,
    site,
    representativeDates: monthDefs,
    units: {
      length: 'mm', area: 'm²', time: 'min', exposure: 'm²·h', ratio: 'fraction',
      percentage: '%', daylightFactor: '%', illuminance: 'lux',
    },
    assumptions: {
      method: 'monthly-representative-days', dayOfMonth: 21,
      directSun: {
        from, to, stepMin,
        requestedGridCell: cell,
        maxCells,
        requestedWorkplane: workplane,
        occluders: {
          treatment: 'opaque-year-round',
          roofsAndMasses: 'opaque',
          massVoids: 'subtract-overlap-from-solid-mass-shadow-and-never-cast-alone',
          treeCrowns: 'opaque-without-seasonality',
          translucentStructures: 'conservatively-opaque',
          terrain: 'flat-without-terrain-shadowing',
        },
      },
      // Плоские поля оставлены для простого чтения и совместимости экспортёров.
      stepMin, cell, maxCells, workplane,
      daylight: {
        enabled: typeof options.daylightAnalyzer === 'function',
        source: typeof options.daylightAnalyzer === 'function' ? 'external-analyzer-hook' : null,
        note: typeof options.daylightAnalyzer === 'function'
          ? 'КЕО/люксы получены внешним анализатором; модель и уверенность указаны по помещениям.'
          : 'КЕО и люксы не рассчитывались.',
      },
      note: 'Эскизная оценка по реперным дням; не заменяет экспертизу КЕО и инсоляции.',
    },
    cancelled,
    progress: { done, total },
    summary: {
      rooms: rooms.length,
      regulatedRooms: regulated.length,
      glazingMeets: regulated.filter((room) => room.glazing.meets).length,
      glazingBelow: regulated.filter((room) => !room.glazing.meets).length,
      verifiedRooms: rooms.filter((room) => room.quality === 'verified').length,
      estimatedRooms: rooms.filter((room) => room.quality === 'estimated').length,
      unavailableRooms: rooms.filter((room) => room.quality === 'unavailable').length,
    },
    rooms,
  };
}

function consumeSolarReport(iterator) {
  let item = iterator.next();
  while (!item.done) item = iterator.next();
  return item.value;
}

/**
 * Синхронная детерминированная сводка. По умолчанию: 12 месяцев,
 * шаг времени 30 мин, сетка 1000 мм / до 120 ячеек на помещение.
 * shouldCancel() прерывает между расчётами; onProgress не входит в result.
 */
export function buildSolarReport(project, options = {}) {
  return consumeSolarReport(solarReportSteps(project, options));
}

function reportProjectSnapshot(project) {
  if (typeof globalThis.structuredClone === 'function') {
    try { return globalThis.structuredClone(project); } catch { /* JSON fallback ниже */ }
  }
  return JSON.parse(JSON.stringify(project));
}

function macrotaskYield() {
  return new Promise((resolve) => { setTimeout(resolve, 0); });
}

const clockNow = () => globalThis.performance?.now?.() ?? Date.now();

/**
 * Неблокирующий UI-вариант той же сводки. Проект фиксируется
 * до первой паузы, поэтому в отчёте не смешиваются две версии модели.
 * yieldControl — инъекция для тестов; по умолчанию это реальный macrotask.
 */
export async function buildSolarReportAsync(project, options = {}) {
  const snapshot = reportProjectSnapshot(project);
  const iterator = solarReportSteps(snapshot, options, { responsiveCancel: true });
  const yieldControl = typeof options.yieldControl === 'function' ? options.yieldControl : macrotaskYield;
  const yieldEvery = Math.round(clamp(Number(options.yieldEvery) || 4, 1, 48));
  const yieldBudgetMs = clamp(Number(options.yieldBudgetMs) || 32, 4, 250);
  let directSteps = 0;
  let lastYieldAt = clockNow();

  while (true) {
    const item = iterator.next();
    if (item.done) return item.value;
    const phaseBoundary = item.value?.phase !== 'direct';
    if (!phaseBoundary) directSteps += 1;
    const due = phaseBoundary || directSteps >= yieldEvery || clockNow() - lastYieldAt >= yieldBudgetMs;
    if (!due) continue;
    await yieldControl(item.value);
    directSteps = 0;
    lastYieldAt = clockNow();
  }
}

const csvNumber = (value, digits = 2) => finite(value).toFixed(digits).replace('.', ',');
const csvCell = (value) => {
  const raw = String(value ?? '');
  // Excel исполняет ячейки, начинающиеся с = + - @, как формулы. Любой
  // пользовательский текст экранируем апострофом до кавычек CSV.
  const text = /^\s*[=+\-@]/u.test(raw) ? `'${raw}` : raw;
  return /[;"\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};
const csvPercent = (value) => csvNumber((Number(value) || 0) * 100, 1);
const csvHours = (minutes) => csvNumber((Number(minutes) || 0) / 60, 2);

function representativeDaysLabel(count) {
  const mod100 = count % 100;
  const mod10 = count % 10;
  const word = mod10 === 1 && mod100 !== 11 ? 'день'
    : mod10 >= 2 && mod10 <= 4 && !(mod100 >= 12 && mod100 <= 14) ? 'дня' : 'дней';
  return `${count} реперных ${word}`;
}

/** Excel-friendly CSV: сводка по помещениям и затем помесячные строки. */
export function buildSolarReportCsv(report) {
  const lines = [];
  const representativeDays = report.representativeDates?.length || 0;
  lines.push([
    `Сезонная световая сводка (${representativeDaysLabel(representativeDays)})`,
    csvCell(report.projectName),
    csvCell(report.year),
  ].join(';'));
  lines.push(['Площадка', 'Широта', 'Долгота', 'Часовой пояс UTC', 'Север, °', 'Координаты и север подтверждены'].join(';'));
  lines.push([
    '',
    report.site?.lat == null ? '' : csvNumber(report.site.lat, 6),
    report.site?.lon == null ? '' : csvNumber(report.site.lon, 6),
    report.site?.tz == null ? '' : csvNumber(report.site.tz, 2),
    report.site?.north == null ? '' : csvNumber(report.site.north, 1),
    report.site?.verified ? 'да' : 'нет',
  ].join(';'));
  lines.push(['Метод', csvCell(report.assumptions?.note || '')].join(';'));
  lines.push([
    'Схема', csvCell(report.schema || ''), 'Модель солнца', csvCell(report.model?.id || ''),
    'Версия', csvCell(report.model?.version ?? report.version ?? ''),
  ].join(';'));
  lines.push(['Сформировано', csvCell(report.generatedAt || 'не указано')].join(';'));
  lines.push([
    'Параметры прямого солнца',
    `шаг ${finite(report.assumptions?.directSun?.stepMin)} мин`,
    `сетка от ${finite(report.assumptions?.directSun?.requestedGridCell)} мм`,
    `до ${finite(report.assumptions?.directSun?.maxCells)} ячеек/помещение`,
    `рабочая плоскость ${finite(report.assumptions?.directSun?.requestedWorkplane)} мм`,
  ].map(csvCell).join(';'));
  lines.push(['Препятствия', csvCell('Консервативно непрозрачные круглый год: кровли, массы, кроны деревьев, перголы, навесы и теплицы; сезонность листвы, прозрачность и тени рельефа не моделируются. Пересекающая сплошную массу вычитающая масса вырезает отверстие в пределах своего 3D-объёма и сама тени не даёт.')].join(';'));
  const daylight = (report.rooms || []).find((room) => room.daylight)?.daylight || null;
  if (daylight) {
    const assumptions = daylight.assumptions || {};
    const transmission = assumptions.transmission || {};
    lines.push([
      'Дневной свет', csvCell(daylight.model || ''),
      csvCell('Предварительная оценка по стандартному пасмурному небу; не экспертиза.'),
    ].join(';'));
    lines.push([
      'Допущения дневного света', csvCell(assumptions.sky || ''),
      `снаружи ${csvNumber(assumptions.externalLux, 0)} лк`,
      `плоскость ${csvNumber(assumptions.workplane, 0)} мм`,
      `стекло ${csvNumber(transmission.defaultGlass, 2)}`,
      `рама ${csvNumber(transmission.frameFactor, 2)}`,
      `запас ${csvNumber(transmission.maintenanceFactor, 2)}`,
      `отражение ${csvNumber(assumptions.interiorReflectance, 2)}`,
      `уверенность ${csvCell(daylight.confidence?.level || '')}`,
    ].map(csvCell).join(';'));
  }
  lines.push('');
  lines.push([
    'Этаж', '№', 'Помещение', 'Площадь помещения, м²', 'Площадь зоны света, м²', 'Область остекления',
    'Остекление, м²', 'Остекление, 1:N', 'Ориентир 1:8',
    'Среднее прямое солнце, ч/реп. день', 'Минимальный охват ≥2 ч, %', 'Месяцев с солнцем',
    'Лучший месяц', 'Худший месяц', 'КЕО, %', 'Освещённость, лк', 'Охват ≥300 лк, %',
    'Качество исходных данных',
  ].join(';'));
  for (const room of report.rooms || []) {
    const ratio = room.glazing?.ratio > 0 ? 1 / room.glazing.ratio : 0;
    const directAvailable = room.quality !== 'unavailable';
    lines.push([
      csvCell(room.levelName), csvCell(room.number), csvCell(room.name), csvNumber(room.area), csvNumber(room.glazing?.floorArea),
      room.glazingScope === 'open-plan-zone' ? 'общая открытая зона' : 'помещение', csvNumber(room.glazing?.area),
      ratio ? csvNumber(ratio, 1) : '', room.regulated ? (room.glazing?.meets ? 'да' : 'нет') : 'не нормируется',
      directAvailable ? csvHours(room.annual?.averageMeanMinutes) : '',
      directAvailable ? csvPercent(room.annual?.minimumCoverage2h) : '',
      directAvailable ? room.annual?.monthsWithSun || 0 : '',
      directAvailable ? csvCell(room.annual?.bestMonth?.label || '') : '',
      directAvailable ? csvCell(room.annual?.worstMonth?.label || '') : '',
      room.daylight?.meanDaylightFactor == null ? '' : csvNumber(room.daylight.meanDaylightFactor, 2),
      room.daylight?.meanLux == null ? '' : csvNumber(room.daylight.meanLux, 0),
      room.daylight?.coverage300 == null ? '' : csvPercent(room.daylight.coverage300),
      room.quality === 'verified' ? 'координаты подтверждены'
        : room.quality === 'estimated' ? 'расчётная оценка' : 'нет координат',
    ].join(';'));
  }
  lines.push('');
  lines.push([
    'Этаж', '№', 'Помещение', 'Месяц', 'Дата', 'Среднее солнце, ч', 'Максимум, ч',
    'Охват ≥2 ч, %', 'Площадь с солнцем, %', 'Экспозиция, м²·ч', 'Качество исходных данных',
  ].join(';'));
  for (const room of report.rooms || []) {
    for (const month of room.months || []) {
      lines.push([
        csvCell(room.levelName), csvCell(room.number), csvCell(room.name), csvCell(month.label), csvCell(month.date),
        month.available ? csvHours(month.meanMinutes) : '',
        month.available ? csvHours(month.maxMinutes) : '',
        month.available ? csvPercent(month.coverage2h) : '',
        month.available ? csvPercent(month.litShare) : '',
        month.available ? csvNumber(month.solarExposureM2h) : '',
        !month.available ? 'нет данных' : month.verified ? 'координаты подтверждены' : 'расчётная оценка',
      ].join(';'));
    }
  }
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

export function buildSolarReportJson(report, { pretty = true } = {}) {
  return JSON.stringify(report, (_key, value) => (
    typeof value === 'number' && !Number.isFinite(value) ? null : value
  ), pretty ? 2 : 0);
}
