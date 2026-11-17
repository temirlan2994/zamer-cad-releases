// Функциональные зоны и маршруты дома.
//
// Анализ намеренно разделяет два уровня доказательств:
// - программа дома даёт проверяемые требования между помещениями;
// - бытовой сценарий даёт маршрут только после явной привязки его якорей
//   к конкретным помещениям.
//
// Граф дверей подтверждает лишь топологическую связь комнат. Он не является
// навигационной сеткой, не доказывает ширину прохода и не описывает точную
// траекторию человека между мебелью.

import { ROOM_CATEGORIES, roomType } from './catalog.js';
import { analyzeHomeProgram } from './home-program.js';
import { activateLayoutScenarios } from './layout-scenarios.js';
import { levelProject } from './model.js';
import { analyzeConnectivity } from './rooms.js';
import {
  deriveWalls, doorLink, projectAdjacencies,
} from './walls.js';

const array = (value) => (Array.isArray(value) ? value : []);
const text = (value) => (typeof value === 'string' && value.trim() ? value.trim() : null);
const pairKey = (a, b) => a < b ? `${a}|${b}` : `${b}|${a}`;
const roomKey = (levelId, roomId) => `${levelId}:${roomId}`;
const resolvedStatus = (status) => ['co_located', 'direct', 'reachable'].includes(status);

function levelRecords(project) {
  return array(project?.levels).map((level) => {
    const view = levelProject(project, level.id);
    const walls = deriveWalls(view);
    const connectivity = analyzeConnectivity(view, walls);
    const rooms = new Map(array(level.rooms).map((room) => [room.id, room]));
    const adjacency = new Set(projectAdjacencies(view).map(({ a, b }) => pairKey(a.id, b.id)));
    const transitions = new Map();

    const ensureTransition = (a, b, kind, openingId = null) => {
      if (!rooms.has(a) || !rooms.has(b) || a === b) return;
      const key = pairKey(a, b);
      if (!transitions.has(key)) transitions.set(key, {
        levelId: level.id,
        aRoomId: a < b ? a : b,
        bRoomId: a < b ? b : a,
        openingIds: new Set(),
        evidenceKinds: new Set(),
      });
      const record = transitions.get(key);
      record.evidenceKinds.add(kind);
      if (openingId) record.openingIds.add(openingId);
    };

    // Двери и проёмы без полотна — явное доказательство перехода.
    for (const opening of array(view.openings).slice().sort((a, b) => String(a.id).localeCompare(String(b.id)))) {
      const link = doorLink(view, opening, walls);
      if (!link || link.includes('outside')) continue;
      ensureTransition(link[0], link[1], 'door', opening.id);
    }
    // Скрытая общая граница означает открытое объединение помещений.
    for (const wall of walls) {
      if (wall.hidden && wall.kind === 'shared' && wall.rooms?.length === 2) {
        ensureTransition(wall.rooms[0], wall.rooms[1], 'open_boundary');
      }
    }

    return {
      level, view, walls, connectivity, rooms, adjacency, transitions,
    };
  });
}
function deterministicPath(graph, fromId, toId, allowed) {
  if (fromId === toId) return [fromId];
  const queue = [fromId];
  const previous = new Map([[fromId, null]]);
  while (queue.length) {
    const current = queue.shift();
    const neighbors = [...(graph.get(current) || [])]
      .filter((id) => allowed.has(id))
      .sort((a, b) => String(a).localeCompare(String(b)));
    for (const next of neighbors) {
      if (previous.has(next)) continue;
      previous.set(next, current);
      if (next === toId) {
        const path = [next];
        let node = current;
        while (node != null) { path.push(node); node = previous.get(node); }
        return path.reverse();
      }
      queue.push(next);
    }
  }
  return null;
}

function transitionInfo(level, aRoomId, bRoomId) {
  const source = level?.transitions.get(pairKey(aRoomId, bRoomId));
  return {
    transitionKey: `${level?.level.id || ''}:${pairKey(aRoomId, bRoomId)}`,
    levelId: level?.level.id || null,
    aRoomKey: roomKey(level.level.id, aRoomId < bRoomId ? aRoomId : bRoomId),
    bRoomKey: roomKey(level.level.id, aRoomId < bRoomId ? bRoomId : aRoomId),
    openingIds: source ? [...source.openingIds].sort() : [],
    evidenceKinds: source ? [...source.evidenceKinds].sort() : [],
  };
}

function pathTransitionInfo(level, pathRoomIds) {
  const records = [];
  for (let index = 0; index < pathRoomIds.length - 1; index += 1) {
    records.push(transitionInfo(level, pathRoomIds[index], pathRoomIds[index + 1]));
  }
  return records;
}

function functionalRouteRecords(program, levelsById) {
  const routes = [];
  for (const connection of array(program?.connections)) {
    const checks = array(connection?.checks).length ? connection.checks : [connection];
    checks.forEach((check, index) => {
      const level = levelsById.get(check?.levelId);
      let pathRoomIds = array(check?.pathRoomIds).filter((id) => level?.rooms.has(id));
      let status = check?.status || connection?.status || 'unknown';
      if (check?.fromRoomId && check?.fromRoomId === check?.toRoomId) {
        status = 'co_located';
        pathRoomIds = level?.rooms.has(check.fromRoomId) ? [check.fromRoomId] : [];
      }
      const transitions = level && resolvedStatus(status)
        ? pathTransitionInfo(level, pathRoomIds) : [];
      const acceptable = status === 'co_located' || status === 'direct'
        || (status === 'reachable' && connection?.directPreferred !== true);
      routes.push({
        id: `${connection?.id || 'connection'}:${check?.sourceRoomId || check?.fromRoomId || index + 1}`,
        connectionId: connection?.id || null,
        title: connection?.title || connection?.label || 'Функциональная связь',
        source: 'home_program',
        required: connection?.required === true,
        directPreferred: connection?.directPreferred === true,
        acceptable,
        status,
        levelId: check?.levelId || null,
        fromRoomKey: check?.levelId && check?.fromRoomId
          ? roomKey(check.levelId, check.fromRoomId) : null,
        toRoomKey: check?.levelId && check?.toRoomId
          ? roomKey(check.levelId, check.toRoomId) : null,
        fromEndpoint: check?.levelId && check?.fromRoomId
          ? { levelId: check.levelId, roomId: check.fromRoomId, anchorType: null, anchorId: null }
          : null,
        toEndpoint: check?.levelId && check?.toRoomId
          ? { levelId: check.levelId, roomId: check.toRoomId, anchorType: null, anchorId: null }
          : null,
        pathRoomKeys: check?.levelId
          ? pathRoomIds.map((id) => roomKey(check.levelId, id)) : [],
        transitionKeys: transitions.map(({ transitionKey }) => transitionKey),
        transitions,
        reason: check?.reason || connection?.reason || '',
      });
    });
  }
  return routes;
}

function selectionFrequency(selection) {
  const value = selection?.frequencyValue;
  const period = text(selection?.frequencyPeriod);
  const number = value !== null && value !== undefined && value !== '' ? Number(value) : NaN;
  const known = Number.isFinite(number) && number >= 0 && Boolean(period);
  return { value: known ? number : null, period: known ? period : null, known };
}

function normalizedEndpoint(endpoint) {
  if (!endpoint || typeof endpoint !== 'object') {
    return { levelId: null, roomId: null, anchorType: null, anchorId: null };
  }
  const anchor = endpoint.anchor && typeof endpoint.anchor === 'object' ? endpoint.anchor : {};
  return {
    levelId: text(endpoint.levelId),
    roomId: text(endpoint.roomId),
    anchorType: text(endpoint.anchorType ?? anchor.type),
    anchorId: text(endpoint.anchorId ?? anchor.id),
  };
}

function scenarioRouteRecord({ scenario, definition, binding, instanceIndex, levelsById }) {
  const from = normalizedEndpoint(binding?.from);
  const to = normalizedEndpoint(binding?.to);
  const instanceId = text(binding?.instanceId) || `${definition.route_id}:${instanceIndex + 1}`;
  const base = {
    id: `${scenario.scenarioId}:${definition.route_id}:${instanceId}`,
    scenarioId: scenario.scenarioId,
    routeId: definition.route_id,
    instanceId,
    actorPersonId: text(binding?.actorPersonId ?? binding?.actorId),
    fromAnchorRole: definition.from_anchor_role,
    toAnchorRole: definition.to_anchor_role,
    fromRoomKey: from.levelId && from.roomId ? roomKey(from.levelId, from.roomId) : null,
    toRoomKey: to.levelId && to.roomId ? roomKey(to.levelId, to.roomId) : null,
    fromEndpoint: from,
    toEndpoint: to,
    levelId: from.levelId && from.levelId === to.levelId ? from.levelId : null,
    pathRoomKeys: [],
    transitionKeys: [],
    transitions: [],
    topologyEvidence: null,
    physicalPathStatus: 'unknown',
    sourceRef: text(binding?.sourceRef),
  };
  if (!binding) return {
    ...base, status: 'unknown', reasonCode: 'unknown_binding',
    reason: 'Маршрут сценария ещё не привязан к конкретным помещениям.',
  };
  const fromLevel = levelsById.get(from.levelId);
  const toLevel = levelsById.get(to.levelId);
  if (!fromLevel?.rooms.has(from.roomId) || !toLevel?.rooms.has(to.roomId)) return {
    ...base, status: 'missing', reasonCode: 'missing_endpoint',
    reason: 'Одно из привязанных помещений удалено или не найдено.',
  };
  if (from.levelId !== to.levelId) return {
    ...base, status: 'unknown', reasonCode: 'vertical_connector_unknown',
    reason: 'Помещения на разных этажах; подтверждённый межэтажный коннектор не задан.',
  };
  if (from.roomId === to.roomId) return {
    ...base,
    status: 'co_located', reasonCode: 'same_room',
    pathRoomKeys: [roomKey(from.levelId, from.roomId)],
    topologyEvidence: 'door_graph',
    reason: 'Обе функции находятся в одном помещении; внутренний путь не проверен.',
  };
  const allowed = new Set(fromLevel.rooms.keys());
  const path = deterministicPath(fromLevel.connectivity.graph, from.roomId, to.roomId, allowed);
  if (!path) {
    const adjacent = fromLevel.adjacency.has(pairKey(from.roomId, to.roomId));
    return {
      ...base,
      status: 'missing',
      reasonCode: adjacent ? 'adjacent_without_door' : 'no_passage',
      reason: adjacent
        ? 'Помещения граничат, но дверь или открытый проход не заданы.'
        : 'По графу дверей маршрут между помещениями не найден.',
    };
  }
  const transitions = pathTransitionInfo(fromLevel, path);
  return {
    ...base,
    status: path.length === 2 ? 'direct' : 'reachable',
    reasonCode: path.length === 2 ? 'direct_passage' : 'connected_passage',
    pathRoomKeys: path.map((id) => roomKey(from.levelId, id)),
    transitionKeys: transitions.map(({ transitionKey }) => transitionKey),
    transitions,
    topologyEvidence: 'door_graph',
    reason: path.length === 2
      ? 'Есть прямой переход между помещениями.'
      : `Маршрут проходит через ${path.length - 2} промежуточных помещений.`,
  };
}

function scenarioRecords(project, levelsById, bindings) {
  const activated = activateLayoutScenarios(project?.layoutBrief, project);
  const byScenarioRoute = new Map();
  for (const binding of bindings) {
    const scenarioId = text(binding?.scenarioId ?? binding?.scenario_id);
    const routeId = text(binding?.routeId ?? binding?.route_id);
    if (!scenarioId || !routeId) continue;
    const key = `${scenarioId}|${routeId}`;
    if (!byScenarioRoute.has(key)) byScenarioRoute.set(key, []);
    byScenarioRoute.get(key).push(binding);
  }
  const scenarios = [];
  const unresolved = [...array(activated.unresolvedInputs)];
  for (const scenario of activated.active) {
    const frequency = selectionFrequency(scenario.selection);
    const routes = [];
    for (const definition of array(scenario.definition?.route_pairs)) {
      const routeBindings = byScenarioRoute.get(`${scenario.scenarioId}|${definition.route_id}`) || [];
      if (!routeBindings.length) {
        routes.push(scenarioRouteRecord({
          scenario, definition, binding: null, instanceIndex: 0, levelsById,
        }));
      } else {
        routeBindings.forEach((binding, instanceIndex) => routes.push(scenarioRouteRecord({
          scenario, definition, binding, instanceIndex, levelsById,
        })));
      }
    }
    for (const route of routes) if (!resolvedStatus(route.status)) unresolved.push({
      kind: 'scenario_route', scenarioId: scenario.scenarioId, routeId: route.routeId,
      instanceId: route.instanceId, reason: route.reason,
    });
    scenarios.push({
      scenarioId: scenario.scenarioId,
      title: scenario.title,
      activation: scenario.activation,
      mandatory: scenario.mandatory,
      frequency,
      routes,
    });
  }
  return { activation: activated, scenarios, unresolved };
}

function emptyRoomLoad(zone) {
  return {
    roomKey: zone.key,
    levelId: zone.levelId,
    roomId: zone.roomId,
    requirementCount: 0,
    scenarioRouteCount: 0,
    originCount: 0,
    destinationCount: 0,
    transitCount: 0,
    frequencyByPeriod: {},
    unknownFrequencyRouteIds: [],
  };
}

function addFrequency(load, frequency, routeId) {
  if (frequency?.known) {
    load.frequencyByPeriod[frequency.period] = (load.frequencyByPeriod[frequency.period] || 0)
      + frequency.value;
  } else load.unknownFrequencyRouteIds.push(routeId);
}

function aggregateLoads(zones, levelsById, functionalRoutes, scenarios) {
  const roomLoads = new Map(zones.rooms.map((zone) => [zone.key, emptyRoomLoad(zone)]));
  const transitionLoads = new Map();

  const ensureTransition = (transitionKey) => {
    if (transitionLoads.has(transitionKey)) return transitionLoads.get(transitionKey);
    const separator = transitionKey.indexOf(':');
    const levelId = transitionKey.slice(0, separator);
    const pair = transitionKey.slice(separator + 1).split('|');
    const evidence = transitionInfo(levelsById.get(levelId), pair[0], pair[1]);
    const record = {
      ...evidence,
      requirementCount: 0,
      scenarioRouteCount: 0,
      scenarioIds: [],
      directionCounts: {},
      frequencyByPeriod: {},
      unknownFrequencyRouteIds: [],
    };
    transitionLoads.set(transitionKey, record);
    return record;
  };

  for (const route of functionalRoutes) {
    if (!route.required || !resolvedStatus(route.status)) continue;
    for (const key of route.pathRoomKeys) {
      const load = roomLoads.get(key);
      if (load) load.requirementCount += 1;
    }
    for (const key of route.transitionKeys) ensureTransition(key).requirementCount += 1;
  }

  for (const scenario of scenarios) {
    for (const route of scenario.routes) {
      if (!resolvedStatus(route.status)) continue;
      route.pathRoomKeys.forEach((key, index) => {
        const load = roomLoads.get(key);
        if (!load) return;
        load.scenarioRouteCount += 1;
        if (index === 0) load.originCount += 1;
        if (index === route.pathRoomKeys.length - 1) load.destinationCount += 1;
        if (index > 0 && index < route.pathRoomKeys.length - 1) load.transitCount += 1;
        addFrequency(load, scenario.frequency, route.id);
      });
      route.transitionKeys.forEach((key, index) => {
        const load = ensureTransition(key);
        load.scenarioRouteCount += 1;
        if (!load.scenarioIds.includes(scenario.scenarioId)) load.scenarioIds.push(scenario.scenarioId);
        const from = route.pathRoomKeys[index];
        const to = route.pathRoomKeys[index + 1];
        const direction = `${from}>${to}`;
        load.directionCounts[direction] = (load.directionCounts[direction] || 0) + 1;
        addFrequency(load, scenario.frequency, route.id);
      });
    }
  }

  const finish = (record) => ({
    ...record,
    unknownFrequencyRouteIds: [...new Set(record.unknownFrequencyRouteIds)].sort(),
  });
  return {
    roomLoads: [...roomLoads.values()].map(finish),
    transitionLoads: [...transitionLoads.values()]
      .map((record) => ({ ...finish(record), scenarioIds: record.scenarioIds.sort() }))
      .sort((a, b) => a.transitionKey.localeCompare(b.transitionKey)),
  };
}

function zoneRecords(project) {
  const rooms = [];
  for (const level of array(project?.levels)) {
    for (const room of array(level.rooms)) {
      const definition = roomType(room.type);
      rooms.push({
        key: roomKey(level.id, room.id),
        levelId: level.id,
        roomId: room.id,
        type: room.type || null,
        title: room.name || definition?.title || 'Помещение',
        zoneId: definition?.cat || 'unknown',
        status: definition ? 'known' : 'unknown',
      });
    }
  }
  const definitions = [
    ...ROOM_CATEGORIES.map(({ id, title }) => ({ zoneId: id, title })),
    { zoneId: 'unknown', title: 'Не классифицировано' },
  ];
  const groups = definitions.map((definition) => ({
    ...definition,
    roomKeys: rooms.filter((room) => room.zoneId === definition.zoneId).map((room) => room.key),
    count: rooms.filter((room) => room.zoneId === definition.zoneId).length,
  }));
  return { rooms, groups };
}

function analysisStatus(program, scenarios) {
  const requiredProgramIssue = array(program?.connections)
    .some((connection) => connection.required === true && connection.acceptable !== true);
  if (requiredProgramIssue) return 'incomplete';
  if (!scenarios.length) return 'unknown';
  const routes = scenarios.flatMap((scenario) => scenario.routes.map((route) => ({ scenario, route })));
  const blocking = routes.some(({ scenario, route }) => scenario.mandatory === true
    && !resolvedStatus(route.status));
  if (blocking) return 'incomplete';
  const uncertain = routes.some(({ scenario, route }) => !resolvedStatus(route.status)
    || !scenario.frequency.known || scenario.mandatory == null);
  return uncertain ? 'draft' : 'ready';
}

/**
 * Проанализировать функциональные зоны и доказанные переходы между комнатами.
 * Настройки отображения в результат не входят; проект не мутируется.
 */
export function analyzeHomeFlows(project = {}, { routeBindings } = {}) {
  const levels = levelRecords(project);
  const levelsById = new Map(levels.map((level) => [level.level.id, level]));
  const zones = zoneRecords(project);
  const program = analyzeHomeProgram(project);
  const functionalRoutes = functionalRouteRecords(program, levelsById);
  const bindings = Array.isArray(routeBindings)
    ? routeBindings : array(project?.layoutBrief?.scenarioRouteBindings);
  const scenarioResult = scenarioRecords(project, levelsById, bindings);
  const loads = aggregateLoads(zones, levelsById, functionalRoutes, scenarioResult.scenarios);
  const scenarioRoutes = scenarioResult.scenarios.flatMap((scenario) => scenario.routes);
  const resolvedRoutes = scenarioRoutes.filter((route) => resolvedStatus(route.status));
  const missingRoutes = scenarioRoutes.filter((route) => route.status === 'missing');
  const unknownRoutes = scenarioRoutes.filter((route) => route.status === 'unknown');
  const functionalProblems = functionalRoutes.filter((route) => route.required && !route.acceptable);
  const resolvedFunctionalRoutes = functionalRoutes.filter((route) => route.acceptable);
  const knownFrequencyRoutes = scenarioResult.scenarios.reduce((sum, scenario) => (
    sum + (scenario.frequency.known ? scenario.routes.length : 0)
  ), 0);
  const warnings = [
    'Схема подтверждает только связи помещений по дверям и открытым границам; точная траектория среди мебели не рассчитана.',
  ];
  if (unknownRoutes.some((route) => route.reasonCode === 'unknown_binding')) {
    warnings.push('Часть маршрутов сценариев не привязана к конкретным помещениям.');
  }
  if (scenarioResult.scenarios.some((scenario) => !scenario.frequency.known)) {
    warnings.push('Не для всех выбранных сценариев задана частота; числовая нагрузка для них оставлена неизвестной.');
  }
  return {
    status: analysisStatus(program, scenarioResult.scenarios),
    zones,
    functionalRoutes,
    scenarios: scenarioResult.scenarios,
    roomLoads: loads.roomLoads,
    transitionLoads: loads.transitionLoads,
    unresolved: scenarioResult.unresolved,
    summary: {
      roomCount: zones.rooms.length,
      classifiedRoomCount: zones.rooms.filter((room) => room.status === 'known').length,
      unknownZoneCount: zones.rooms.filter((room) => room.status === 'unknown').length,
      zoneCount: zones.groups.filter((group) => group.zoneId !== 'unknown' && group.count > 0).length,
      functionalRouteCount: functionalRoutes.length,
      resolvedFunctionalRouteCount: resolvedFunctionalRoutes.length,
      functionalProblemCount: functionalProblems.length,
      activeScenarioCount: scenarioResult.scenarios.length,
      selectedRouteTemplateCount: scenarioRoutes.length,
      resolvedRouteCount: resolvedRoutes.length,
      missingRouteCount: missingRoutes.length,
      unknownRouteCount: unknownRoutes.length,
      knownFrequencyRouteCount: knownFrequencyRoutes,
      unknownFrequencyRouteCount: scenarioRoutes.length - knownFrequencyRoutes,
    },
    warnings,
  };
}
