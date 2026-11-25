// Предварительный инженерный обзор дома.
//
// Модуль анализирует только известную геометрию помещений и явно занесённые
// фиксированные точки. Он не прокладывает трубы/воздуховоды и не выдаёт
// геометрическую близость помещений или шахты за готовое инженерное решение.

import { roomType } from './catalog.js';
import { levelProject } from './model.js';
import {
  roomContainsPoint, roomLabelPoint, roomRects, roomShapeArea,
} from './room-shape.js';
import { projectAdjacencies } from './walls.js';

const WATER_ROOM_TYPES = new Set([
  'kitchen', 'kitchen-living', 'bathroom', 'guest-wc', 'shower-room',
  'tub-room', 'laundry',
]);
const EXTRACT_ROOM_TYPES = new Set([
  ...WATER_ROOM_TYPES, 'sauna', 'hammam',
]);
const TECHNICAL_ROOM_TYPES = new Set(['boiler', 'tech']);

const FIXTURE_SYSTEMS = Object.freeze({
  sink: ['water', 'drain'],
  washbasin: ['water', 'drain'],
  'washbasin-double': ['water', 'drain'],
  'vanity-unit': ['water', 'drain'],
  toilet: ['water', 'drain'],
  bidet: ['water', 'drain'],
  urinal: ['water', 'drain'],
  bath: ['water', 'drain'],
  'bath-corner': ['water', 'drain'],
  jacuzzi: ['water', 'drain'],
  shower: ['water', 'drain', 'extract'],
  washer: ['water', 'drain'],
  dishwasher: ['water', 'drain'],
  'kitchen-row': ['water', 'drain', 'extract'],
  'kitchen-corner': ['water', 'drain', 'extract'],
  'kitchen-u': ['water', 'drain', 'extract'],
  hood: ['extract'],
  'cooktop-hood': ['extract'],
});

const ENGINEERING_SYSTEM = Object.freeze({
  cold_water: 'water',
  hot_water: 'water',
  drain: 'drain',
  vent_extract: 'extract',
  vent_supply: 'supply',
  vent_return: 'return',
  gas: 'gas',
  power: 'power',
  outlet: 'power',
  switch: 'power',
  radiator: 'heating',
  fireplace: 'heating',
  other: 'other',
});

const SYSTEM_LABELS = Object.freeze({
  water: 'Водоснабжение',
  drain: 'Канализация',
  extract: 'Вытяжка',
  supply: 'Приток воздуха',
  return: 'Возврат воздуха',
  technical_review: 'Инженерное решение',
});

const array = (value) => (Array.isArray(value) ? value : []);
const finite = (value) => value !== null && value !== undefined && value !== ''
  && Number.isFinite(Number(value));
const keyOf = (levelId, roomId) => `${levelId}:${roomId}`;
const pairKey = (a, b) => a < b ? `${a}|${b}` : `${b}|${a}`;

function requirementSystems(room) {
  const systems = [];
  if (WATER_ROOM_TYPES.has(room.type)) systems.push('water', 'drain');
  if (EXTRACT_ROOM_TYPES.has(room.type)) systems.push('extract');
  if (roomType(room.type)?.living === true) systems.push('supply');
  if (TECHNICAL_ROOM_TYPES.has(room.type)) systems.push('technical_review');
  return [...new Set(systems)];
}
function roomRecords(project) {
  const result = [];
  for (const level of array(project?.levels)) {
    for (const room of array(level.rooms)) {
      const key = keyOf(level.id, room.id);
      const fixtures = array(level.items).filter((item) => roomContainsPoint(room, item.x, item.y)
        && Array.isArray(FIXTURE_SYSTEMS[item.kind]));
      const fixtureSystems = [...new Set(fixtures.flatMap((item) => FIXTURE_SYSTEMS[item.kind]))];
      const typeSystems = requirementSystems(room);
      const systems = [...new Set([...typeSystems, ...fixtureSystems])];
      result.push({
        key,
        levelId: level.id,
        levelName: level.name || level.id,
        roomId: room.id,
        roomName: room.name || roomType(room.type)?.title || room.type,
        type: room.type,
        systems: systems.map((id) => ({
          id,
          title: SYSTEM_LABELS[id] || id,
          status: 'candidate',
          basis: typeSystems.includes(id) ? 'room_type' : 'fixture',
          fixtureItemIds: fixtures.filter((item) => FIXTURE_SYSTEMS[item.kind]?.includes(id)).map((item) => item.id).sort(),
        })),
        fixtureItemIds: fixtures.map((item) => item.id).sort(),
        center: roomLabelPoint(room),
        areaM2: roomShapeArea(room) / 1_000_000,
        room,
      });
    }
  }
  return result.sort((a, b) => a.levelId.localeCompare(b.levelId) || a.roomId.localeCompare(b.roomId));
}

function pointIssue(code, message, severity = 'unknown') {
  return { code, severity, message };
}

function engineeringPoints(project, rooms) {
  const raw = project?.layoutBrief?.fixedEngineering;
  const roomByKey = new Map(rooms.map((room) => [room.key, room]));
  const roomsById = new Map();
  for (const room of rooms) {
    const list = roomsById.get(room.roomId) || [];
    list.push(room);
    roomsById.set(room.roomId, list);
  }
  const levelIds = new Set(array(project?.levels).map((level) => level.id));
  const records = array(raw).map((point, index) => {
    const issues = [];
    const id = point?.id || `engineering-${index + 1}`;
    const levelId = typeof point?.levelId === 'string' && point.levelId ? point.levelId : null;
    const roomId = typeof point?.roomId === 'string' && point.roomId ? point.roomId : null;
    let room = levelId && roomId ? roomByKey.get(keyOf(levelId, roomId)) || null : null;
    if (levelId && !levelIds.has(levelId)) {
      issues.push(pointIssue('unknown_level', 'Указанный этаж не существует.', 'conflict'));
    }
    if (roomId && !room) {
      const matches = roomsById.get(roomId) || [];
      if (levelId && matches.length) {
        issues.push(pointIssue('room_on_other_level', 'Помещение существует, но находится на другом этаже.', 'conflict'));
      } else if (!levelId && matches.length === 1) {
        [room] = matches;
      } else {
        issues.push(pointIssue('unknown_room', 'Указанное помещение не существует.', 'conflict'));
      }
    }
    if (!levelId) issues.push(pointIssue('missing_level', 'Этаж точки не указан.'));
    if (!roomId) issues.push(pointIssue('missing_room', 'Помещение точки не указано.'));
    const hasCoordinates = finite(point?.x) && finite(point?.y);
    if (!hasCoordinates) issues.push(pointIssue('missing_coordinates', 'Координаты точки не заданы.'));
    if (room && hasCoordinates && !roomContainsPoint(room.room, Number(point.x), Number(point.y))) {
      issues.push(pointIssue('outside_room', 'Точка находится вне указанного помещения.', 'conflict'));
    }
    if (!['measured', 'declared', 'assumed'].includes(point?.dataStatus)) {
      issues.push(pointIssue('unknown_data_status', 'Статус исходных данных не подтверждён.'));
    } else if (point.dataStatus === 'assumed') {
      issues.push(pointIssue('assumed_data_status', 'Точка принята предварительно и требует подтверждения.', 'candidate'));
    }
    if (typeof point?.sourceRef !== 'string' || !point.sourceRef.trim()) {
      issues.push(pointIssue('missing_source', 'Источник точки не указан.'));
    }
    const status = issues.some((issue) => issue.severity === 'conflict')
      ? 'conflict'
      : issues.some((issue) => issue.severity === 'unknown') ? 'unknown'
        : issues.some((issue) => issue.severity === 'candidate') ? 'candidate'
          : 'fact';
    return {
      id,
      kind: point?.kind || 'other',
      system: ENGINEERING_SYSTEM[point?.kind] || 'other',
      levelId: levelId || room?.levelId || null,
      roomId: roomId || room?.roomId || null,
      roomKey: room?.key || null,
      x: finite(point?.x) ? Number(point.x) : null,
      y: finite(point?.y) ? Number(point.y) : null,
      zMm: finite(point?.zMm) ? Number(point.zMm) : null,
      dataStatus: point?.dataStatus || 'unknown',
      sourceRef: typeof point?.sourceRef === 'string' && point.sourceRef.trim() ? point.sourceRef.trim() : null,
      status,
      issues,
    };
  }).sort((a, b) => a.id.localeCompare(b.id));
  return {
    surveyStatus: raw == null ? 'unknown' : records.length ? 'available' : 'confirmed_empty',
    records,
  };
}

function rectDistance(a, b) {
  const dx = Math.max(0, a.x - (b.x + b.w), b.x - (a.x + a.w));
  const dy = Math.max(0, a.y - (b.y + b.h), b.y - (a.y + a.h));
  return Math.hypot(dx, dy);
}

function shapeDistance(a, b) {
  let distance = Infinity;
  for (const first of roomRects(a)) {
    for (const second of roomRects(b)) distance = Math.min(distance, rectDistance(first, second));
  }
  return Number.isFinite(distance) ? distance : null;
}

function shapeOverlapArea(a, b) {
  let area = 0;
  for (const first of roomRects(a)) {
    for (const second of roomRects(b)) {
      const width = Math.max(0, Math.min(first.x + first.w, second.x + second.w) - Math.max(first.x, second.x));
      const height = Math.max(0, Math.min(first.y + first.h, second.y + second.h) - Math.max(first.y, second.y));
      area += width * height;
    }
  }
  return area;
}

function wetRooms(rooms) {
  return rooms.filter((room) => room.systems.some((system) => system.id === 'water' || system.id === 'drain'));
}

function sameLevelCandidates(project, rooms) {
  const candidates = [];
  const used = new Set();
  const add = (a, b, sharedWall) => {
    const key = pairKey(a.key, b.key);
    if (used.has(key)) return;
    used.add(key);
    const distanceMm = shapeDistance(a.room, b.room);
    candidates.push({
      id: `same:${key}`,
      kind: sharedWall ? 'shared_wall' : 'nearest_same_level',
      status: 'candidate',
      levelIds: [a.levelId],
      roomKeys: [a.key, b.key].sort(),
      distanceMm,
      sharedWall,
      reason: sharedWall
        ? 'Мокрые помещения имеют общую стену — это кандидат на компактный узел.'
        : `Ближайшие мокрые зоны находятся на расстоянии ${Math.round(distanceMm || 0)} мм. Это геометрическая подсказка, не трасса.`,
    });
  };
  for (const level of array(project?.levels)) {
    const levelWet = wetRooms(rooms).filter((room) => room.levelId === level.id);
    const byRoomId = new Map(levelWet.map((room) => [room.roomId, room]));
    const adjacent = projectAdjacencies(levelProject(project, level.id));
    const adjacentPairs = new Set();
    for (const entry of adjacent) {
      const a = byRoomId.get(entry.a.id); const b = byRoomId.get(entry.b.id);
      if (!a || !b) continue;
      adjacentPairs.add(pairKey(a.key, b.key));
      add(a, b, true);
    }
    for (const room of levelWet) {
      const nearest = levelWet.filter((other) => other.key !== room.key)
        .map((other) => ({ other, distance: shapeDistance(room.room, other.room) }))
        .sort((a, b) => a.distance - b.distance || a.other.key.localeCompare(b.other.key))[0];
      if (nearest && !adjacentPairs.has(pairKey(room.key, nearest.other.key))) add(room, nearest.other, false);
    }
  }
  return candidates.sort((a, b) => a.id.localeCompare(b.id));
}

function verticalCandidates(project, rooms) {
  const candidates = [];
  const levels = [...array(project?.levels)].sort((a, b) =>
    (Number(a?.elevation) || 0) - (Number(b?.elevation) || 0)
      || String(a?.id || '').localeCompare(String(b?.id || '')));
  const wet = wetRooms(rooms);
  for (let index = 1; index < levels.length; index += 1) {
    const lower = levels[index - 1]; const upper = levels[index];
    const lowerRooms = wet.filter((room) => room.levelId === lower.id);
    const upperRooms = wet.filter((room) => room.levelId === upper.id);
    for (const above of upperRooms) {
      const nearest = lowerRooms.map((below) => ({
        below,
        distance: shapeDistance(above.room, below.room),
        overlap: shapeOverlapArea(above.room, below.room),
      })).sort((a, b) => b.overlap - a.overlap || a.distance - b.distance || a.below.key.localeCompare(b.below.key))[0];
      if (!nearest) continue;
      const centerOffsetMm = Math.hypot(
        above.center.x - nearest.below.center.x,
        above.center.y - nearest.below.center.y,
      );
      candidates.push({
        id: `vertical:${nearest.below.key}|${above.key}`,
        kind: nearest.overlap > 0 ? 'vertical_overlap' : 'vertical_nearest',
        status: 'candidate',
        levelIds: [lower.id, upper.id],
        roomKeys: [nearest.below.key, above.key],
        overlapAreaM2: nearest.overlap / 1_000_000,
        horizontalGapMm: nearest.distance,
        centerOffsetMm,
        reason: nearest.overlap > 0
          ? 'Контуры мокрых помещений перекрываются по вертикали. Это кандидат, а не подтверждённый стояк.'
          : 'Показана ближайшая мокрая зона соседнего этажа. Межэтажная трасса не рассчитана.',
      });
    }
  }
  return candidates.sort((a, b) => a.id.localeCompare(b.id));
}

function shaftCandidates(rooms) {
  const candidates = [];
  const wet = wetRooms(rooms);
  const shafts = rooms.filter((room) => room.type === 'shaft');
  for (const room of wet) {
    const nearest = shafts.filter((shaft) => shaft.levelId === room.levelId)
      .map((shaft) => ({
        shaft,
        distance: shapeDistance(room.room, shaft.room),
        overlap: shapeOverlapArea(room.room, shaft.room),
      })).sort((a, b) => a.distance - b.distance || b.overlap - a.overlap || a.shaft.key.localeCompare(b.shaft.key))[0];
    if (!nearest) continue;
    candidates.push({
      id: `shaft:${room.key}|${nearest.shaft.key}`,
      kind: 'geometric_shaft',
      status: 'candidate',
      levelIds: [room.levelId],
      roomKeys: [room.key, nearest.shaft.key],
      distanceMm: nearest.distance,
      overlapAreaM2: nearest.overlap / 1_000_000,
      confirmedRiser: false,
      reason: 'Это ближайший геометрический проём-шахта. Его инженерное назначение не подтверждено.',
    });
  }
  return candidates.sort((a, b) => a.id.localeCompare(b.id));
}

function coverage(rooms, points) {
  const facts = points.records.filter((point) => point.status === 'fact');
  return rooms.map((room) => ({
    roomKey: room.key,
    systems: room.systems.map((need) => {
      const matching = facts.filter((point) => point.roomKey === room.key && point.system === need.id);
      return {
        system: need.id,
        status: matching.length ? 'fact' : 'unknown',
        pointIds: matching.map((point) => point.id),
        reason: matching.length
          ? 'Есть явно заданная подтверждённая точка.'
          : 'Подключение не задано; это не считается ошибкой.',
      };
    }),
  }));
}

/**
 * Выполняет предварительный, ненормативный инженерный обзор.
 * Возвращаемые кандидаты описывают только геометрическую близость.
 */
export function analyzeHomeEngineering(project = {}) {
  const roomsWithGeometry = roomRecords(project);
  const points = engineeringPoints(project, roomsWithGeometry);
  const rooms = roomsWithGeometry.map(({ room: _room, ...room }) => room);
  const engineeringCoverage = coverage(rooms, points);
  const ventilationCoverage = engineeringCoverage.flatMap((entry) => entry.systems
    .filter((system) => ['supply', 'extract'].includes(system.system)));
  const ventilationStatus = ventilationCoverage.length
    && ventilationCoverage.every((system) => system.status === 'fact')
    ? 'fact'
    : ventilationCoverage.some((system) => system.status === 'fact') ? 'candidate' : 'unknown';
  const candidates = {
    sameLevel: sameLevelCandidates(project, roomsWithGeometry),
    vertical: verticalCandidates(project, roomsWithGeometry),
    shafts: shaftCandidates(roomsWithGeometry),
  };
  const conflicts = points.records.flatMap((point) => point.issues
    .filter((issue) => issue.severity === 'conflict')
    .map((issue) => ({ pointId: point.id, ...issue })));
  const needCount = rooms.reduce((sum, room) => sum + room.systems.length, 0);
  const warnings = [];
  if (points.surveyStatus === 'unknown') {
    warnings.push('Существующие фиксированные инженерные точки не обследованы.');
  } else if (points.surveyStatus === 'confirmed_empty') {
    warnings.push('Подтверждено отсутствие существующих фиксированных точек. Это не отменяет проектирование будущих систем.');
  }
  if (candidates.shafts.length) {
    warnings.push('Геометрическая шахта не считается инженерным стояком без явного назначения.');
  }
  warnings.push('Обзор не рассчитывает трассы, диаметры, уклоны, расходы воздуха, гидравлику или CFD.');
  const candidateCount = candidates.sameLevel.length + candidates.vertical.length + candidates.shafts.length;
  const status = conflicts.length ? 'conflict'
    : needCount || candidateCount ? 'candidate'
      : points.records.some((point) => point.status === 'fact') ? 'fact' : 'unknown';
  return {
    status,
    rooms,
    points,
    coverage: engineeringCoverage,
    candidates,
    conflicts,
    ventilation: {
      supplyRoomKeys: rooms.filter((room) => room.systems.some((need) => need.id === 'supply')).map((room) => room.key),
      extractRoomKeys: rooms.filter((room) => room.systems.some((need) => need.id === 'extract')).map((room) => room.key),
      explicitSupplyPointIds: points.records.filter((point) => point.kind === 'vent_supply' && point.status === 'fact').map((point) => point.id),
      explicitReturnPointIds: points.records.filter((point) => point.kind === 'vent_return' && point.status === 'fact').map((point) => point.id),
      explicitExtractPointIds: points.records.filter((point) => point.kind === 'vent_extract' && point.status === 'fact').map((point) => point.id),
      status: ventilationStatus,
      reason: ventilationStatus === 'fact'
        ? 'Для каждой выявленной потребности есть подтверждённая точка в соответствующем помещении.'
        : ventilationStatus === 'candidate'
          ? 'Подтверждена только часть выявленных потребностей в притоке и вытяжке.'
          : 'Отсутствие явных вентиляционных точек означает «не задано», а не ошибку.',
    },
    summary: {
      roomCount: rooms.length,
      wetRoomCount: wetRooms(roomsWithGeometry).length,
      requirementCount: needCount,
      fixedPointCount: points.records.length,
      verifiedPointCount: points.records.filter((point) => point.status === 'fact').length,
      candidatePointCount: points.records.filter((point) => point.status === 'candidate').length,
      unknownPointCount: points.records.filter((point) => point.status === 'unknown').length,
      conflictCount: conflicts.length,
      candidateCount,
    },
    warnings,
  };
}

export function engineeringMissionStatuses(project, analysis) {
  const points = project?.layoutBrief?.fixedEngineering;
  const findings = array(analysis.points?.records);
  const conflicts = array(analysis.conflicts).length > 0;
  const surveyed = Array.isArray(points);
  const sources = conflicts ? 'blocked' : !surveyed ? 'unknown'
    : !points.length || (findings.length && findings.every((point) => point.status === 'fact')) ? 'checked'
      : findings.some((point) => ['fact', 'candidate'].includes(point.status)) ? 'attention' : 'unknown';
  const ventilation = analysis.ventilation?.status;
  const hasUncertainty = analysis.summary?.roomCount > 0
    && (!surveyed || analysis.points?.surveyStatus === 'confirmed_empty'
      || array(analysis.candidates?.shafts).length > 0);
  return {
    'engineering-connections': conflicts ? 'blocked' : !surveyed ? 'unknown'
      : sources === 'checked' ? 'checked' : 'attention',
    'engineering-wet': analysis.summary?.wetRoomCount ? 'attention' : 'unknown',
    'engineering-vertical': array(analysis.candidates?.vertical).length ? 'attention' : 'unknown',
    'engineering-ventilation': ventilation === 'fact' ? 'checked' : ventilation === 'candidate' ? 'attention' : 'unknown',
    'engineering-points': sources,
    'engineering-warnings': conflicts ? 'blocked' : hasUncertainty ? 'attention' : 'checked',
  };
}
