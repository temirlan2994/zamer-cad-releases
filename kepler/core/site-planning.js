// Проверяемый маршрут подготовки участка и объяснимая карта возможностей.
// Модуль чистый: он читает проект, но не сохраняет вычисляемые статусы в модель.

import {
  area, bbox, difference, erode, interiorPoint, pointInPolygon,
} from './geom/index.js';
import {
  DEFAULT_SETBACK_BOUNDARY,
  DEFAULT_SETBACK_NEIGHBOR,
  DEFAULT_ROAD_WIDTH,
  contextNeighborSignature,
  distanceToPolyline,
  neighborBuffers,
  neighborRectCorners,
  polygonAreaM2,
} from './site.js';
import { sunHoursAt, sunHoursGrid } from './landscape-shadow.js';
import { slopeAt, terrainModel } from './terrain.js';

const MAX_CELLS = 500;
const MIN_BOUNDARY_AREA_M2 = 1;
const ENTRY_BOUNDARY_TOLERANCE = 50;
const ROAD_ENTRY_TOLERANCE = 500;
const MIN_PATH_LENGTH = 0.5;
const MAX_SITE_COORDINATE = 1e10;
const SMOOTH_DECIMATION_TOLERANCE = 25;
const SCORE_EPSILON = 1e-9;

const DEFAULT_WEIGHTS = Object.freeze({
  access: 25,
  slope: 20,
  sun: 20,
  privacy: 15,
  reserve: 20,
});

const finiteNumber = (value) => value !== null
  && value !== undefined
  && !(typeof value === 'string' && value.trim() === '')
  && Number.isFinite(Number(value));
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function planningOf(site) {
  return site?.planning && typeof site.planning === 'object' ? site.planning : {};
}

function setbackValue(value, fallback) {
  if (value === null || value === undefined
    || (typeof value === 'string' && value.trim() === '')) return fallback;
  return Number(value);
}

function setbackValues(site = {}) {
  return {
    boundary: setbackValue(site.setbackBoundary, DEFAULT_SETBACK_BOUNDARY),
    neighbor: setbackValue(site.setbackNeighbor, DEFAULT_SETBACK_NEIGHBOR),
  };
}

function validPoint(point) {
  return point && finiteNumber(point.x) && finiteNumber(point.y);
}

function cross(a, b, c) {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function pointOnSegment(point, a, b) {
  const epsilon = 1e-6;
  return Math.abs(cross(a, b, point)) <= epsilon
    && point.x >= Math.min(a.x, b.x) - epsilon
    && point.x <= Math.max(a.x, b.x) + epsilon
    && point.y >= Math.min(a.y, b.y) - epsilon
    && point.y <= Math.max(a.y, b.y) + epsilon;
}

function segmentsIntersect(a, b, c, d) {
  const abC = cross(a, b, c);
  const abD = cross(a, b, d);
  const cdA = cross(c, d, a);
  const cdB = cross(c, d, b);
  if (((abC > 0 && abD < 0) || (abC < 0 && abD > 0))
    && ((cdA > 0 && cdB < 0) || (cdA < 0 && cdB > 0))) return true;
  return (Math.abs(abC) <= 1e-6 && pointOnSegment(c, a, b))
    || (Math.abs(abD) <= 1e-6 && pointOnSegment(d, a, b))
    || (Math.abs(cdA) <= 1e-6 && pointOnSegment(a, c, d))
    || (Math.abs(cdB) <= 1e-6 && pointOnSegment(b, c, d));
}

function simpleBoundary(boundary) {
  const count = boundary.length;
  for (let i = 0; i < count; i += 1) {
    const a = boundary[i];
    const b = boundary[(i + 1) % count];
    if (Math.hypot(b.x - a.x, b.y - a.y) < 0.5) return false;
    for (let j = i + 1; j < count; j += 1) {
      const adjacent = j === i + 1 || (i === 0 && j === count - 1);
      if (adjacent) continue;
      const c = boundary[j];
      const d = boundary[(j + 1) % count];
      if (segmentsIntersect(a, b, c, d)) return false;
    }
  }
  return true;
}

function validBoundary(boundary) {
  if (!Array.isArray(boundary) || boundary.length < 3
    || !boundary.every((point) => validPoint(point)
      && Math.abs(Number(point.x)) <= MAX_SITE_COORDINATE
      && Math.abs(Number(point.y)) <= MAX_SITE_COORDINATE)) return false;
  const areaM2 = polygonAreaM2(boundary);
  return Number.isFinite(areaM2)
    && areaM2 >= MIN_BOUNDARY_AREA_M2
    && simpleBoundary(boundary);
}

function constraintsConfirmation(site) {
  const confirmation = planningOf(site).constraintsConfirmed;
  const setbacks = setbackValues(site);
  const valid = confirmation
    && finiteNumber(confirmation.setbackBoundary)
    && finiteNumber(confirmation.setbackNeighbor)
    && Math.abs(Number(confirmation.setbackBoundary) - setbacks.boundary) < SCORE_EPSILON
    && Math.abs(Number(confirmation.setbackNeighbor) - setbacks.neighbor) < SCORE_EPSILON;
  return {
    confirmed: Boolean(valid),
    current: {
      setbackBoundary: setbacks.boundary,
      setbackNeighbor: setbacks.neighbor,
    },
    saved: confirmation || null,
  };
}

function validNeighbor(neighbor) {
  return neighbor
    && finiteNumber(neighbor.x)
    && finiteNumber(neighbor.y)
    && finiteNumber(neighbor.w)
    && finiteNumber(neighbor.h)
    && Number(neighbor.w) > 0
    && Number(neighbor.h) > 0
    && [neighbor.x, neighbor.y, neighbor.w, neighbor.h]
      .every((value) => Math.abs(Number(value)) <= MAX_SITE_COORDINATE)
    && (neighbor.rot == null || finiteNumber(neighbor.rot));
}

function uniqueStrings(values) {
  return [...new Set(values.filter(Boolean))];
}

function decimateSmoothBoundary(boundary) {
  const result = [];
  for (let i = 0; i < boundary.length; i += 1) {
    const point = boundary[i];
    if (i % 2 === 0) {
      result.push(point);
      continue;
    }
    const previous = boundary[(i - 1 + boundary.length) % boundary.length];
    const next = boundary[(i + 1) % boundary.length];
    const chord = Math.hypot(next.x - previous.x, next.y - previous.y);
    const deviation = chord ? Math.abs(cross(previous, next, point)) / chord : Infinity;
    if (deviation > SMOOTH_DECIMATION_TOLERANCE) result.push(point);
  }
  return result;
}

// Детальные плавные контуры иногда перегружают snap-rounding в geom.erode.
// При ложном пустом результате повторяем расчёт на безопасно прореженном
// контуре: удаляются только чередующиеся точки с отклонением не более 25 мм,
// углы и изломы сохраняются.
function robustBoundaryErosion(boundary, distance) {
  let candidate = boundary;
  let lastError = null;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      const geometry = erode(candidate, distance);
      if (geometry.length) {
        return {
          geometry,
          error: null,
          sourcePoints: boundary.length,
          usedPoints: candidate.length,
        };
      }
    } catch (error) {
      lastError = error;
    }
    if (candidate.length <= 128) break;
    const next = decimateSmoothBoundary(candidate);
    if (next.length < 3 || next.length >= candidate.length || !validBoundary(next)) break;
    candidate = next;
  }
  return {
    geometry: [],
    error: lastError,
    sourcePoints: boundary.length,
    usedPoints: candidate.length,
  };
}

/**
 * Рабочее пятно по введённым ограничениям проекта.
 * Красная линия намеренно не вычитается: у неё пока нет разрешённой стороны.
 */
export function workingBuildableGeometry(site = {}) {
  const warnings = [];
  const evidence = [];
  const confirmation = constraintsConfirmation(site);
  const setbacks = confirmation.current;
  const boundary = site?.boundary;

  if (!Array.isArray(boundary) || boundary.length < 3) {
    return {
      status: 'unknown',
      geometry: [],
      areaM2: 0,
      confirmed: false,
      setbacks,
      warnings: ['Не задана замкнутая граница участка'],
      evidence,
    };
  }
  if (!validBoundary(boundary)) {
    return {
      status: 'error',
      geometry: [],
      areaM2: 0,
      confirmed: false,
      setbacks,
      warnings: ['Граница участка вырождена или содержит некорректные точки'],
      evidence,
    };
  }
  if (!finiteNumber(setbacks.setbackBoundary) || !finiteNumber(setbacks.setbackNeighbor)
    || setbacks.setbackBoundary < 0 || setbacks.setbackNeighbor < 0) {
    return {
      status: 'error',
      geometry: [],
      areaM2: 0,
      confirmed: false,
      setbacks,
      warnings: ['Проектные отступы должны быть конечными неотрицательными числами'],
      evidence,
    };
  }

  evidence.push({
    id: 'boundary-setback',
    value: setbacks.setbackBoundary,
    label: 'Отступ от границы, мм',
  });
  const erosion = robustBoundaryErosion(boundary, setbacks.setbackBoundary);
  if (erosion.error && !erosion.geometry.length) {
    return {
      status: 'error',
      geometry: [],
      areaM2: 0,
      confirmed: false,
      setbacks,
      warnings: ['Не удалось устойчиво рассчитать отступ от границы участка'],
      evidence,
    };
  }
  let geometry = erosion.geometry;
  if (erosion.usedPoints < erosion.sourcePoints) {
    warnings.push(`Для устойчивого расчёта плавный контур прорежен с ${erosion.sourcePoints} до ${erosion.usedPoints} точек`);
    evidence.push({
      id: 'boundary-decimation',
      sourcePoints: erosion.sourcePoints,
      usedPoints: erosion.usedPoints,
      tolerance: SMOOTH_DECIMATION_TOLERANCE,
      label: 'Устойчивое прореживание плавного контура',
    });
  }

  const neighbors = Array.isArray(site.neighbors) ? site.neighbors : [];
  const usableNeighbors = neighbors.filter(validNeighbor);
  if (usableNeighbors.length !== neighbors.length) {
    warnings.push('Часть соседних зданий пропущена: не заданы корректные габариты');
  }
  const buffers = neighborBuffers({
    ...site,
    setbackNeighbor: setbacks.setbackNeighbor,
    neighbors: usableNeighbors,
  });
  if (geometry.length && buffers.length) {
    try {
      geometry = difference(geometry, ...buffers.map(({ poly }) => poly));
    } catch {
      return {
        status: 'error',
        geometry: [],
        areaM2: 0,
        confirmed: false,
        setbacks,
        warnings: ['Не удалось устойчиво применить ограничения соседних зданий'],
        evidence,
      };
    }
  }
  evidence.push({
    id: 'neighbor-setback',
    value: setbacks.setbackNeighbor,
    count: buffers.length,
    label: 'Буферы соседних зданий, мм',
  });

  if (Array.isArray(site.redLine) && site.redLine.length >= 2) {
    warnings.push('Красная линия показана справочно и пока не вычитается из рабочего пятна');
  }
  if (!confirmation.confirmed) {
    warnings.push('Проектные ограничения ещё не подтверждены пользователем');
  }

  const areaM2 = Math.max(0, area(geometry) / 1_000_000);
  if (!geometry.length || areaM2 < 0.001) {
    return {
      status: 'empty',
      geometry: [],
      areaM2: 0,
      confirmed: confirmation.confirmed,
      setbacks,
      warnings: uniqueStrings([
        ...warnings,
        'После применения проектных ограничений рабочее пятно отсутствует',
      ]),
      evidence,
    };
  }

  return {
    status: confirmation.confirmed && usableNeighbors.length === neighbors.length
      ? 'verified' : 'preliminary',
    geometry,
    areaM2,
    confirmed: confirmation.confirmed,
    setbacks,
    warnings: uniqueStrings(warnings),
    evidence,
  };
}

function fact(id, label, status, reason, extra = {}) {
  return { id, label, status, reason, ...extra };
}

function underlayFact(site, planning) {
  if (site.underlay) {
    return fact('underlay', 'Основа участка', 'done', 'Подложка загружена', {
      source: 'underlay',
    });
  }
  if (planning.withoutUnderlay) {
    return fact('underlay', 'Основа участка', 'done', 'Явно выбрана работа без подложки', {
      source: 'confirmation',
    });
  }
  return fact('underlay', 'Основа участка', 'unknown', 'Подложка не загружена и решение работать без неё не подтверждено');
}

function boundaryFact(site) {
  if (!Array.isArray(site.boundary) || site.boundary.length < 3) {
    return fact('boundary', 'Граница участка', 'missing', 'Начертите замкнутую границу участка');
  }
  if (!validBoundary(site.boundary)) {
    return fact('boundary', 'Граница участка', 'error', 'Граница вырождена или содержит некорректные точки');
  }
  return fact('boundary', 'Граница участка', 'done', 'Граница пригодна для расчёта', {
    areaM2: polygonAreaM2(site.boundary),
    points: site.boundary.length,
  });
}

function roadWidth(road) {
  if (road?.width == null) return DEFAULT_ROAD_WIDTH;
  return finiteNumber(road.width) && Number(road.width) > 0 ? Number(road.width) : null;
}

function roadLength(road) {
  const points = road?.points;
  if (!Array.isArray(points) || points.length < 2) return 0;
  let length = 0;
  for (let i = 1; i < points.length; i += 1) {
    length += Math.hypot(Number(points[i].x) - Number(points[i - 1].x), Number(points[i].y) - Number(points[i - 1].y));
  }
  if (road.closed) {
    length += Math.hypot(Number(points[0].x) - Number(points.at(-1).x), Number(points[0].y) - Number(points.at(-1).y));
  }
  return length;
}

function validRoad(road) {
  const length = roadLength(road);
  return Array.isArray(road?.points)
    && road.points.length >= 2
    && road.points.every(validPoint)
    && Number.isFinite(length)
    && length >= MIN_PATH_LENGTH
    && roadWidth(road) != null;
}

function roadReachesEntry(road, entry) {
  const distance = distanceToPolyline(road.points, entry, Boolean(road.closed));
  return distance <= roadWidth(road) / 2 + ROAD_ENTRY_TOLERANCE;
}

function roadsFact(site) {
  const roads = Array.isArray(site.roads) ? site.roads : [];
  const valid = roads.filter(validRoad);
  if (!roads.length) return fact('roads', 'Дорога', 'missing', 'Укажите прилегающую дорогу');
  if (valid.length !== roads.length) return fact('roads', 'Дорога', 'error', 'Часть линий дорог не содержит корректной геометрии');
  if (validPoint(site.entry) && !valid.some((road) => roadReachesEntry(road, site.entry))) {
    return fact('roads', 'Дорога', 'error', 'Ни одна дорога не соединена с указанным въездом', {
      count: valid.length,
    });
  }
  return fact('roads', 'Дорога', 'done', 'Дорога указана', { count: valid.length });
}

function entryFact(site) {
  if (!site.entry) return fact('entry', 'Въезд', 'missing', 'Укажите въезд на участок');
  if (!validPoint(site.entry)) return fact('entry', 'Въезд', 'error', 'Координаты въезда некорректны');
  if (!validBoundary(site.boundary)) {
    return fact('entry', 'Въезд', 'unknown', 'Въезд указан, но без корректной границы нельзя проверить его положение');
  }
  const distance = distanceToPolyline(site.boundary, site.entry, true);
  if (distance > ENTRY_BOUNDARY_TOLERANCE) {
    return fact('entry', 'Въезд', 'error', 'Въезд должен находиться на границе участка', {
      distanceToBoundary: distance,
    });
  }
  return fact('entry', 'Въезд', 'done', 'Въезд привязан к границе участка', {
    distanceToBoundary: distance,
  });
}

function contextConfirmation(site, planning = planningOf(site)) {
  const current = contextNeighborSignature(site.neighbors);
  const saved = typeof planning.contextSnapshot === 'string' ? planning.contextSnapshot : null;
  const changed = saved != null && saved !== current;
  if (planning.contextReviewed !== true) {
    return {
      confirmed: false, changed, current, saved,
    };
  }
  // Старые проекты хранили только boolean. После нормализации site.js у них
  // появляется снимок; прямой legacy-объект всё ещё считается совместимым.
  return {
    confirmed: saved == null || saved === current,
    changed,
    current,
    saved,
  };
}

function contextFact(site, planning) {
  const neighbors = Array.isArray(site.neighbors) ? site.neighbors : [];
  const valid = neighbors.filter(validNeighbor);
  if (neighbors.length && valid.length !== neighbors.length) {
    return fact('context', 'Окружение', 'error', 'У части соседних зданий нет корректных габаритов', {
      count: valid.length,
    });
  }
  const confirmation = contextConfirmation(site, planning);
  if (confirmation.changed) {
    return fact('context', 'Окружение', 'unknown', 'Соседние здания изменились после проверки — подтвердите окружение ещё раз', {
      count: valid.length,
      source: 'stale-confirmation',
    });
  }
  if (confirmation.confirmed) {
    return fact('context', 'Окружение', 'done', valid.length
      ? 'Внесённое окружение проверено пользователем'
      : 'Отсутствие известных соседних зданий явно подтверждено', {
      count: valid.length,
      source: 'confirmation',
    });
  }
  return fact('context', 'Окружение', 'unknown', valid.length
    ? 'Соседние здания нанесены, но полнота окружения не подтверждена'
    : 'Неизвестно, все ли соседние здания учтены', {
    count: valid.length,
  });
}

function solarFact(site) {
  if (!site.solarVerified) {
    return fact('solar', 'Север и координаты', 'unknown', 'Направление севера и координаты не подтверждены');
  }
  const { lat, lon, tz } = site.location || {};
  if (!validSolarData(site)) {
    return fact('solar', 'Север и координаты', 'error', 'Подтверждённые солнечные данные некорректны');
  }
  return fact('solar', 'Север и координаты', 'done', 'Координаты и направление севера подтверждены', {
    location: { lat: Number(lat), lon: Number(lon), tz: Number(tz) },
    north: Number(site.north),
  });
}

function validSolarData(site) {
  const { lat, lon, tz } = site.location || {};
  return [lat, lon, tz, site.north].every(finiteNumber)
    && Number(lat) >= -90 && Number(lat) <= 90
    && Number(lon) >= -180 && Number(lon) <= 180
    && Number(tz) >= -14 && Number(tz) <= 14;
}

function terrainFact(site, planning) {
  const points = Array.isArray(site.terrain?.points) ? site.terrain.points : [];
  const valid = points.filter((point) => validPoint(point) && finiteNumber(point.z));
  if (points.length !== valid.length) {
    return fact('terrain', 'Рельеф', 'error', 'Отметки рельефа содержат некорректные значения', {
      points: valid.length,
    });
  }
  if (valid.length < 3) {
    if (planning.flatTerrain) {
      return fact('terrain', 'Рельеф', 'done', 'Участок явно принят плоским', {
        source: 'confirmation',
        points: valid.length,
      });
    }
    return fact('terrain', 'Рельеф', 'unknown', 'Недостаточно отметок рельефа и плоский участок не подтверждён', {
      points: valid.length,
    });
  }
  const model = terrainModel({ points: valid });
  if (!model?.tris?.length) {
    return fact('terrain', 'Рельеф', 'error', model?.error || 'По отметкам не удалось построить поверхность', {
      points: valid.length,
    });
  }
  if (validBoundary(site.boundary)) {
    const inside = interiorPoint(site.boundary);
    const samples = [...site.boundary, ...(inside ? [inside] : [])];
    if (samples.some(({ x, y }) => !slopeAt(model, x, y))) {
      return fact('terrain', 'Рельеф', 'unknown', 'Поверхность рельефа не покрывает весь участок', {
        source: 'terrain',
        points: valid.length,
      });
    }
  }
  return fact('terrain', 'Рельеф', 'done', 'Поверхность рельефа рассчитана', {
    source: 'terrain',
    points: valid.length,
    minZ: model.minZ,
    maxZ: model.maxZ,
  });
}

function constraintsFact(site) {
  const confirmation = constraintsConfirmation(site);
  if (!finiteNumber(confirmation.current.setbackBoundary)
    || !finiteNumber(confirmation.current.setbackNeighbor)
    || confirmation.current.setbackBoundary < 0 || confirmation.current.setbackNeighbor < 0) {
    return fact('constraints', 'Проектные ограничения', 'error', 'Проектные отступы должны быть конечными неотрицательными числами');
  }
  if (!confirmation.confirmed) {
    const changed = confirmation.saved != null;
    return fact(
      'constraints',
      'Проектные ограничения',
      'unknown',
      changed
        ? 'Отступы изменились после подтверждения — проверьте их ещё раз'
        : 'Введённые отступы ещё не подтверждены',
      { setbacks: confirmation.current },
    );
  }
  return fact('constraints', 'Проектные ограничения', 'done', 'Введённые отступы подтверждены', {
    setbacks: confirmation.current,
  });
}

function zoneFact(buildable) {
  if (buildable.status === 'unknown') {
    return fact('zone', 'Рабочее пятно', 'unknown', 'Сначала нужна корректная граница участка');
  }
  if (buildable.status === 'error' || buildable.status === 'empty') {
    return fact('zone', 'Рабочее пятно', 'error', buildable.warnings.at(-1), {
      areaM2: buildable.areaM2,
    });
  }
  if (buildable.status === 'preliminary') {
    return fact('zone', 'Рабочее пятно', 'unknown', 'Рабочее пятно рассчитано предварительно — подтвердите ограничения', {
      areaM2: buildable.areaM2,
      verified: false,
    });
  }
  return fact('zone', 'Рабочее пятно', 'done', 'Рабочее пятно по введённым ограничениям рассчитано', {
    areaM2: buildable.areaM2,
    verified: buildable.status === 'verified',
  });
}

function normalizeFootprint(value) {
  if (!value || typeof value !== 'object') return null;
  const width = Number(value.width ?? value.w);
  const depth = Number(value.depth ?? value.height ?? value.h);
  const rotation = Number(value.rotation ?? value.rot ?? 0);
  if (!Number.isFinite(width) || !Number.isFinite(depth) || !Number.isFinite(rotation)
    || width < 2_000 || depth < 2_000 || width > 100_000 || depth > 100_000) return null;
  return {
    width,
    depth,
    rotation: ((rotation % 360) + 360) % 360,
  };
}

function footprintFact(planning) {
  if (!planning.referenceFootprint) {
    return fact('footprint', 'Ориентировочное пятно дома', 'missing', 'Задайте ширину и глубину ориентировочного пятна', {
      required: false,
    });
  }
  const footprint = normalizeFootprint(planning.referenceFootprint);
  if (!footprint) {
    return fact('footprint', 'Ориентировочное пятно дома', 'error', 'Габариты ориентировочного пятна некорректны', {
      required: false,
    });
  }
  return fact('footprint', 'Ориентировочное пятно дома', 'done', 'Ориентировочное пятно задано', {
    footprint,
    required: false,
  });
}

function overallStatus(facts) {
  const values = Object.values(facts).filter(({ required }) => required !== false);
  if (values.some(({ status }) => status === 'error')) return 'error';
  if (values.every(({ status }) => status === 'done')) return 'ready';
  return 'incomplete';
}

/** Фактический паспорт участка. Пустые данные не считаются подтверждением. */
export function sitePassport(project = {}) {
  const site = project?.site || {};
  const planning = planningOf(site);
  const buildable = workingBuildableGeometry(site);
  const facts = {
    underlay: underlayFact(site, planning),
    boundary: boundaryFact(site),
    roads: roadsFact(site),
    entry: entryFact(site),
    context: contextFact(site, planning),
    solar: solarFact(site),
    terrain: terrainFact(site, planning),
    constraints: constraintsFact(site),
    zone: zoneFact(buildable),
    footprint: footprintFact(planning),
  };
  const list = Object.values(facts);
  return {
    status: overallStatus(facts),
    facts,
    unknowns: list.filter(({ status }) => status === 'unknown').map(({ id }) => id),
    missing: list.filter(({ status }) => status === 'missing').map(({ id }) => id),
    errors: list.filter(({ status }) => status === 'error').map(({ id }) => id),
    buildable,
  };
}

function stageStatus(tasks) {
  if (tasks.some(({ status }) => status === 'error')) return 'error';
  if (tasks.some(({ status }) => status === 'missing')) return 'missing';
  if (tasks.some(({ status }) => status === 'unknown')) return 'unknown';
  return 'done';
}

/** Четыре стабильных этапа маршрута, полностью производные от паспорта. */
export function sitePlanningRoute(project = {}) {
  const passport = sitePassport(project);
  const { facts } = passport;
  const definitions = [
    { id: 'foundation', title: 'Основа', taskIds: ['underlay', 'boundary'] },
    { id: 'access', title: 'Доступ и окружение', taskIds: ['roads', 'entry', 'context'] },
    { id: 'conditions', title: 'Солнце и рельеф', taskIds: ['solar', 'terrain'] },
    { id: 'constraints', title: 'Ограничения', taskIds: ['constraints', 'zone'] },
  ];
  const stages = definitions.map(({ id, title, taskIds }) => {
    const tasks = taskIds.map((taskId) => ({ ...facts[taskId], stageId: id }));
    return { id, title, status: stageStatus(tasks), tasks };
  });
  const tasks = stages.flatMap((stage) => stage.tasks);
  const completed = tasks.filter(({ status }) => status === 'done').length;
  const total = tasks.length;
  const status = stageStatus(tasks);
  return {
    status,
    stages,
    completed,
    total,
    progress: total ? completed / total : 0,
    progressPercent: total ? Math.round((completed / total) * 100) : 0,
    nextTask: tasks.find(({ status: taskStatus }) => taskStatus !== 'done') || null,
    passport,
  };
}

function footprintCorners(center, footprint) {
  const rad = footprint.rotation * Math.PI / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const halfWidth = footprint.width / 2;
  const halfDepth = footprint.depth / 2;
  return [
    { x: -halfWidth, y: -halfDepth },
    { x: halfWidth, y: -halfDepth },
    { x: halfWidth, y: halfDepth },
    { x: -halfWidth, y: halfDepth },
  ].map(({ x, y }) => ({
    x: center.x + x * cos - y * sin,
    y: center.y + x * sin + y * cos,
  }));
}

function footprintInside(corners, geometry) {
  if (!corners.every((corner) => pointInPolygon(geometry, corner))) return false;
  return area(difference(corners, geometry)) <= 1;
}

function pointSegmentDistance(point, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length2 = dx * dx + dy * dy;
  const t = length2
    ? clamp(((point.x - a.x) * dx + (point.y - a.y) * dy) / length2, 0, 1)
    : 0;
  return Math.hypot(point.x - (a.x + dx * t), point.y - (a.y + dy * t));
}

function boundaryDistance(a, b) {
  let best = Infinity;
  for (let i = 0; i < a.length; i += 1) {
    for (let j = 0; j < b.length; j += 1) {
      best = Math.min(
        best,
        pointSegmentDistance(a[i], b[j], b[(j + 1) % b.length]),
        pointSegmentDistance(b[j], a[i], a[(i + 1) % a.length]),
      );
    }
  }
  return best;
}

function accessFactor(site, center, entryEvidence, roadEvidence) {
  if (entryEvidence?.status !== 'done') {
    return {
      known: false,
      score: null,
      raw: null,
      explanation: entryEvidence?.reason || 'Въезд не указан',
    };
  }
  if (roadEvidence?.status !== 'done') {
    return {
      known: false,
      score: null,
      raw: null,
      explanation: roadEvidence?.reason || 'Дорога к въезду не указана',
    };
  }
  const distance = Math.hypot(center.x - Number(site.entry.x), center.y - Number(site.entry.y));
  return {
    known: true,
    score: clamp(100 * (1 - distance / 40_000), 0, 100),
    raw: { distance },
    explanation: `До въезда ${Math.round(distance)} мм`,
  };
}

function slopeFactor(site, center, corners, model, terrainAttempted) {
  if (!model?.tris?.length && !terrainAttempted && planningOf(site).flatTerrain) {
    return {
      known: true,
      score: 100,
      raw: { averagePercent: 0, maxPercent: 0 },
      explanation: 'Участок принят плоским',
    };
  }
  if (!model?.tris?.length) {
    return {
      known: false,
      score: null,
      raw: null,
      explanation: 'Нет достоверной модели рельефа',
    };
  }
  const values = [center, ...corners].map(({ x, y }) => slopeAt(model, x, y));
  if (values.some((value) => !value || !finiteNumber(value.percent))) {
    return {
      known: false,
      score: null,
      raw: null,
      explanation: 'Пятно выходит за область рассчитанного рельефа',
    };
  }
  const percents = values.map(({ percent }) => Number(percent));
  const averagePercent = percents.reduce((sum, value) => sum + value, 0) / percents.length;
  const maxPercent = Math.max(...percents);
  return {
    known: true,
    score: clamp(100 * (1 - maxPercent / 15), 0, 100),
    raw: { averagePercent, maxPercent },
    explanation: `Максимальный уклон ${maxPercent.toFixed(1)}%`,
  };
}

function privacyFactor(site, corners) {
  const neighbors = Array.isArray(site.neighbors) ? site.neighbors.filter(validNeighbor) : [];
  if (!contextConfirmation(site).confirmed) {
    return {
      known: false,
      score: null,
      raw: { neighbors: neighbors.length },
      explanation: neighbors.length
        ? 'Полнота окружения не подтверждена'
        : 'Окружение участка не проверено',
    };
  }
  if (!neighbors.length) {
    return {
      known: true,
      score: 100,
      raw: { distance: null, neighbors: 0 },
      explanation: 'Отсутствие известных соседних зданий подтверждено',
    };
  }
  const distance = Math.min(...neighbors.map((neighbor) => {
    const polygon = neighborRectCorners(neighbor);
    if (corners.some((point) => pointInPolygon(polygon, point))
      || polygon.some((point) => pointInPolygon(corners, point))) return 0;
    return boundaryDistance(corners, polygon);
  }));
  return {
    known: true,
    score: clamp(100 * distance / 15_000, 0, 100),
    raw: { distance, neighbors: neighbors.length },
    explanation: `До ближайшего соседнего здания ${Math.round(distance)} мм`,
  };
}

function containingPolygon(geometry, point) {
  return geometry.find((polygon) => pointInPolygon([polygon], point)) || null;
}

function reserveFactor(geometry, center, corners) {
  const polygon = containingPolygon(geometry, center);
  if (!polygon) {
    return {
      known: false,
      score: null,
      raw: null,
      explanation: 'Не удалось определить компонент рабочего пятна',
    };
  }
  const distance = Math.min(...polygon.map((ring) => boundaryDistance(corners, ring)));
  return {
    known: true,
    score: clamp(100 * distance / 5_000, 0, 100),
    raw: { distance },
    explanation: `Запас до края рабочего пятна ${Math.round(distance)} мм`,
  };
}

function unavailableSunFactor() {
  return {
    known: false,
    score: null,
    raw: null,
    explanation: 'Координаты и направление севера не подтверждены',
  };
}

function sunFactor(site, solar, center, corners) {
  if (!site.solarVerified) return unavailableSunFactor();
  const grid = solar?.grid;
  if (!grid) {
    return {
      known: false,
      score: null,
      raw: null,
      explanation: 'Не удалось рассчитать зимнюю освещённость',
    };
  }
  const hours = [center, ...corners].map((point) => sunHoursAt(grid, point));
  if (hours.some((value) => !Number.isFinite(value))) {
    return {
      known: false,
      score: null,
      raw: null,
      explanation: 'Пятно выходит за область расчёта зимней освещённости',
    };
  }
  const averageHours = hours.reduce((sum, value) => sum + value, 0) / hours.length;
  const minHours = Math.min(...hours);
  const dayHours = Math.max(0, Number(grid.dayHours) || 0);
  return {
    known: true,
    score: dayHours > 0 ? clamp(100 * averageHours / dayHours, 0, 100) : 0,
    raw: { averageHours, minHours, dayHours, date: solar.date },
    explanation: dayHours > 0
      ? `Зимой в среднем ${averageHours.toFixed(1)} ч солнца`
      : 'В выбранную зимнюю дату солнце не поднимается над горизонтом',
  };
}

function opportunitySunData(project, site, step) {
  if (!site.solarVerified || !validSolarData(site) || !validBoundary(site.boundary)) return null;
  const date = Number(site.location.lat) < 0 ? '2025-06-21' : '2025-12-21';
  const grid = sunHoursGrid(
    { ...project, site, levels: [] }, date,
    { cell: Math.max(1_000, step), stepMin: 60, bounds: site.boundary },
  );
  return { date, grid };
}

function normalizeWeights(input = {}) {
  const weights = {};
  for (const [id, fallback] of Object.entries(DEFAULT_WEIGHTS)) {
    const value = finiteNumber(input[id]) ? Number(input[id]) : fallback;
    weights[id] = Math.max(0, value);
  }
  if (!Object.values(weights).some((value) => value > 0)) return { ...DEFAULT_WEIGHTS };
  return weights;
}

function scoreFactors(factors, weights) {
  const totalWeight = Object.values(weights).reduce((sum, value) => sum + value, 0);
  let knownWeight = 0;
  let weightedScore = 0;
  for (const [id, weight] of Object.entries(weights)) {
    const factorValue = factors[id];
    if (!weight || !factorValue?.known || !finiteNumber(factorValue.score)) continue;
    knownWeight += weight;
    weightedScore += weight * clamp(Number(factorValue.score), 0, 100);
  }
  return {
    score: totalWeight ? weightedScore / totalWeight : 0,
    coverage: totalWeight ? knownWeight / totalWeight : 0,
  };
}

function cellLimit(options = {}) {
  const requested = finiteNumber(options.maxCells) ? Math.floor(Number(options.maxCells)) : MAX_CELLS;
  return clamp(requested, 1, MAX_CELLS);
}

function adaptiveGrid(bounds, options = {}) {
  const width = Math.max(0, bounds.x1 - bounds.x0);
  const height = Math.max(0, bounds.y1 - bounds.y0);
  const maxCells = cellLimit(options);
  const requestedStep = finiteNumber(options.step ?? options.cellSize)
    ? Math.max(1, Number(options.step ?? options.cellSize)) : 0;
  let step = Math.max(requestedStep, Math.sqrt((width * height) / maxCells), 250);
  step = Math.ceil(step / 100) * 100;
  let columns = Math.max(1, Math.ceil(width / step));
  let rows = Math.max(1, Math.ceil(height / step));
  while (columns * rows > maxCells) {
    step += 100;
    columns = Math.max(1, Math.ceil(width / step));
    rows = Math.max(1, Math.ceil(height / step));
  }
  return { step, columns, rows, maxCells };
}

function terrainFor(site) {
  const points = Array.isArray(site.terrain?.points)
    ? site.terrain.points.filter((point) => validPoint(point) && finiteNumber(point.z)) : [];
  if (points.length < 3) return { model: null, attempted: false };
  const model = terrainModel({ points });
  return {
    model: model?.tris?.length ? model : null,
    attempted: true,
  };
}

function componentSeedCenters(geometry) {
  return geometry
    .map((polygon) => interiorPoint([polygon]))
    .filter(validPoint);
}

function blockedCell(center, corners, step, reason) {
  return {
    x: center.x,
    y: center.y,
    step,
    corners,
    blocked: true,
    reason,
    score: null,
    coverage: 0,
    factors: null,
  };
}

function selectCandidates(cells, footprint, step) {
  const sorted = cells
    .filter((cell) => !cell.blocked)
    .sort((a, b) => b.score - a.score
      || b.coverage - a.coverage
      || a.y - b.y
      || a.x - b.x);
  const separation = Math.max(step * 1.5, Math.min(footprint.width, footprint.depth) * 0.6);
  const selected = [];
  for (const cell of sorted) {
    if (selected.every((other) => Math.hypot(other.x - cell.x, other.y - cell.y) >= separation)) {
      selected.push({
        ...cell,
        width: footprint.width,
        depth: footprint.depth,
        rotation: footprint.rotation,
        rank: selected.length + 1,
      });
    }
    if (selected.length >= 3) break;
  }
  return selected;
}

function gridCoordinate(min, max, index, count, step) {
  if (count <= 1 || max - min <= step) return (min + max) / 2;
  return Math.min(min + (index + 0.5) * step, max - step / 2);
}

/**
 * Карта возможных центров ориентировочного пятна дома.
 * Неизвестный фактор имеет нулевой вклад, но остаётся видимым через coverage.
 */
export function siteOpportunity(project = {}, options = {}) {
  const site = project?.site || {};
  const buildable = workingBuildableGeometry(site);
  const footprint = normalizeFootprint(
    options.footprint || options.referenceFootprint || planningOf(site).referenceFootprint,
  );
  const weights = normalizeWeights(options.weights || planningOf(site).weights);
  const base = {
    geometry: buildable.geometry,
    footprint,
    referenceFootprint: footprint,
    weights,
    step: null,
    cells: [],
    candidates: [],
    coverage: 0,
    warnings: [...buildable.warnings],
  };

  if (!footprint) {
    return {
      ...base,
      status: 'missing',
      warnings: uniqueStrings([
        ...base.warnings,
        'Задайте ориентировочную ширину и глубину дома',
      ]),
    };
  }
  if (!buildable.geometry.length) {
    return {
      ...base,
      status: buildable.status === 'error'
        ? 'error' : buildable.status === 'unknown' ? 'unknown' : 'empty',
      warnings: uniqueStrings(base.warnings),
    };
  }

  const bounds = bbox(buildable.geometry);
  if (![bounds.x0, bounds.y0, bounds.x1, bounds.y1].every(Number.isFinite)
    || bounds.x1 <= bounds.x0 || bounds.y1 <= bounds.y0) {
    return {
      ...base,
      status: 'error',
      warnings: uniqueStrings([...base.warnings, 'Не удалось определить границы рабочего пятна']),
    };
  }

  const componentCount = buildable.geometry.length;
  const seedCenters = componentSeedCenters(buildable.geometry.slice(0, MAX_CELLS));
  const totalCellLimit = Math.min(MAX_CELLS, Math.max(cellLimit(options), seedCenters.length));
  const gridBudget = Math.max(0, totalCellLimit - seedCenters.length);
  const grid = adaptiveGrid(bounds, {
    ...options,
    maxCells: Math.max(1, gridBudget || totalCellLimit),
  });
  const terrain = terrainFor(site);
  const entryEvidence = entryFact(site);
  const roadEvidence = roadsFact(site);
  const solar = opportunitySunData(project, site, grid.step);
  const cells = [];
  const samples = seedCenters.map((center) => ({ center, seed: true }));
  const seen = new Set(seedCenters.map(({ x, y }) => `${x}:${y}`));
  if (gridBudget) {
    for (let row = 0; row < grid.rows; row += 1) {
      const y = gridCoordinate(bounds.y0, bounds.y1, row, grid.rows, grid.step);
      for (let column = 0; column < grid.columns; column += 1) {
        const x = gridCoordinate(bounds.x0, bounds.x1, column, grid.columns, grid.step);
        const key = `${x}:${y}`;
        if (!seen.has(key)) {
          seen.add(key);
          samples.push({ center: { x, y }, seed: false });
        }
      }
    }
  }
  for (const { center, seed } of samples) {
    const sampleStep = seed
      ? Math.min(grid.step, footprint.width, footprint.depth) : grid.step;
    const corners = footprintCorners(center, footprint);
    if (!footprintInside(corners, buildable.geometry)) {
      cells.push({
        ...blockedCell(center, corners, sampleStep, 'Пятно дома не помещается целиком'),
        seed,
      });
      continue;
    }
    const factors = {
      access: accessFactor(site, center, entryEvidence, roadEvidence),
      slope: slopeFactor(site, center, corners, terrain.model, terrain.attempted),
      sun: sunFactor(site, solar, center, corners),
      privacy: privacyFactor(site, corners),
      reserve: reserveFactor(buildable.geometry, center, corners),
    };
    const scores = scoreFactors(factors, weights);
    cells.push({
      x: center.x,
      y: center.y,
      step: sampleStep,
      corners,
      blocked: false,
      reason: null,
      score: scores.score,
      coverage: scores.coverage,
      factors,
      seed,
    });
  }

  const validCells = cells.filter(({ blocked }) => !blocked);
  const coverage = validCells.length
    ? validCells.reduce((sum, cell) => sum + cell.coverage, 0) / validCells.length
    : 0;
  const candidates = selectCandidates(validCells, footprint, grid.step);
  const warnings = [...base.warnings];
  if (componentCount > MAX_CELLS) {
    warnings.push('Карта содержит больше 500 разрозненных участков; часть из них не проверена');
  }
  if (!validCells.length) warnings.push('Ориентировочное пятно дома не помещается в рабочей зоне');
  if (validCells.some((cell) => !cell.factors.access.known)) warnings.push('Фактор доступа не рассчитан: проверьте положение въезда');
  if (validCells.some((cell) => !cell.factors.slope.known)) warnings.push('Фактор уклона рассчитан не для всей карты');
  if (validCells.some((cell) => !cell.factors.sun.known)) warnings.push('Фактор зимнего солнца рассчитан не для всей карты');
  if (validCells.some((cell) => !cell.factors.privacy.known)) warnings.push('Фактор приватности неизвестен: окружение не подтверждено');

  return {
    ...base,
    status: validCells.length
      ? buildable.status === 'verified' && coverage >= 1 - SCORE_EPSILON
        ? 'ready'
        : buildable.status === 'preliminary' ? 'preliminary' : 'partial'
      : 'empty',
    step: grid.step,
    cells,
    candidates,
    coverage,
    warnings: uniqueStrings(warnings),
  };
}
