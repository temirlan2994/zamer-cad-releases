// Экранная схема функциональных зон и доказанных связей помещений.
// Линии соединяют смысловые точки комнат по комнатно-дверному графу. Это
// наглядная топология, а не измеренная траектория человека вокруг мебели.

import { roomLabelPoint, roomPolygon } from '../core/room-shape.js';

const PROVEN_STATUSES = new Set(['direct', 'reachable']);

const ZONE_STYLES = Object.freeze({
  living: Object.freeze({ fill: '#795bd7', stroke: '#6848c8' }),
  kitchen: Object.freeze({ fill: '#278fc1', stroke: '#167cae' }),
  wet: Object.freeze({ fill: '#14a1a4', stroke: '#078c91' }),
  utility: Object.freeze({ fill: '#ce8b2b', stroke: '#b87516' }),
  circulation: Object.freeze({ fill: '#7c899d', stroke: '#657287' }),
  outdoor: Object.freeze({ fill: '#5b9854', stroke: '#477f42' }),
  unknown: Object.freeze({ fill: '#8c96a5', stroke: '#737e8e' }),
});

const array = (value) => (Array.isArray(value) ? value : []);
const finite = (value) => Number.isFinite(Number(value));

function roomKey(levelId, roomId) {
  return levelId && roomId ? `${levelId}:${roomId}` : roomId || null;
}

function activeRoomMaps(st, levelId) {
  const qualified = new Map();
  const raw = new Map();
  for (const room of array(st?.project?.rooms)) {
    qualified.set(roomKey(levelId, room.id), room);
    raw.set(room.id, room);
  }
  return { qualified, raw };
}

function findRoom(key, maps, levelId) {
  if (!key) return null;
  if (maps.qualified.has(key)) return maps.qualified.get(key);
  if (maps.raw.has(key)) return maps.raw.get(key);
  const prefix = `${levelId}:`;
  return typeof key === 'string' && key.startsWith(prefix)
    ? maps.raw.get(key.slice(prefix.length)) || null : null;
}

function qualifiedPath(route, levelId) {
  if (array(route?.pathRoomKeys).length) return route.pathRoomKeys;
  if (array(route?.pathRoomIds).length) {
    const routeLevel = route.levelId || levelId;
    return route.pathRoomIds.map((id) => roomKey(routeLevel, id));
  }
  const from = route?.fromRoomKey || roomKey(route?.levelId || levelId, route?.fromRoomId);
  const to = route?.toRoomKey || roomKey(route?.levelId || levelId, route?.toRoomId);
  return from && to ? [from, to] : [];
}

function routeOnLevel(route, levelId, maps) {
  if (route?.levelId) return route.levelId === levelId;
  const keys = qualifiedPath(route, levelId);
  const prefix = `${levelId}:`;
  return keys.length > 0 && keys.every((key) => maps.qualified.has(key)
    || maps.raw.has(key)
    || (typeof key === 'string' && key.startsWith(prefix) && maps.raw.has(key.slice(prefix.length))));
}

function collectRoutes(result, levelId) {
  const routes = [];
  for (const route of array(result?.functionalRoutes)) {
    routes.push({
      ...route,
      id: route.id || `functional:${routes.length + 1}`,
      source: 'functional',
      problem: route.acceptable === false || route.problem === true,
      pathRoomKeys: qualifiedPath(route, levelId),
    });
  }
  for (const scenario of array(result?.scenarios)) {
    for (const route of array(scenario?.routes)) {
      routes.push({
        ...route,
        id: route.id || `${scenario.scenarioId || 'scenario'}:${route.routeId || routes.length + 1}`,
        source: 'scenario',
        scenarioId: scenario.scenarioId || route.scenarioId || null,
        scenarioTitle: scenario.title || null,
        mandatory: scenario.mandatory === true,
        problem: route.problem === true || route.status === 'missing',
        pathRoomKeys: qualifiedPath(route, levelId),
      });
    }
  }
  return routes;
}

function zoneStyle(zoneId) {
  return ZONE_STYLES[zoneId] || ZONE_STYLES.unknown;
}

function zoneForRoom(result, levelId, roomId) {
  return array(result?.zones?.rooms).find((zone) => zone?.levelId === levelId
    && zone?.roomId === roomId) || null;
}

function screenPolygon(room, p2s) {
  try {
    return roomPolygon(room).map((point) => p2s(point.x, point.y))
      .filter((point) => point && finite(point.x) && finite(point.y));
  } catch {
    return [];
  }
}

function tracePolygon(ctx, points) {
  if (points.length < 3) return false;
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let index = 1; index < points.length; index += 1) {
    ctx.lineTo(points[index].x, points[index].y);
  }
  ctx.closePath();
  return true;
}

function drawZones(ctx, result, rooms, levelId, p2s) {
  const counts = {};
  let drawn = 0;
  ctx.save();
  ctx.lineJoin = 'round';
  for (const room of rooms.raw.values()) {
    const record = zoneForRoom(result, levelId, room.id);
    const zoneId = record?.zoneId || record?.categoryId || record?.zone || 'unknown';
    counts[zoneId] = (counts[zoneId] || 0) + 1;
    const points = screenPolygon(room, p2s);
    if (!tracePolygon(ctx, points)) continue;
    const style = zoneStyle(zoneId);
    ctx.globalAlpha = 0.1;
    ctx.fillStyle = style.fill;
    ctx.fill();
    ctx.globalAlpha = 0.55;
    ctx.strokeStyle = style.stroke;
    ctx.lineWidth = 1.15;
    ctx.stroke();
    drawn += 1;
  }
  ctx.restore();
  return { counts, drawn };
}

function routePoints(route, rooms, p2s) {
  const points = [];
  const keys = [];
  for (const key of array(route?.pathRoomKeys)) {
    const room = findRoom(key, rooms.maps, rooms.levelId);
    if (!room) return { points: [], keys: [] };
    const anchor = roomLabelPoint(room);
    const point = p2s(anchor.x, anchor.y);
    if (!point || !finite(point.x) || !finite(point.y)) return { points: [], keys: [] };
    const previous = points.at(-1);
    if (!previous || Math.hypot(point.x - previous.x, point.y - previous.y) > 0.5) {
      points.push(point);
      keys.push(roomKey(rooms.levelId, room.id));
    }
  }
  return { points, keys };
}

function transitionKey(a, b) {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function aggregateTransitions(routes, rooms, p2s) {
  const transitions = new Map();
  const routeDiagnostics = [];
  for (const route of routes) {
    const path = routePoints(route, rooms, p2s);
    if (path.points.length < 2) continue;
    routeDiagnostics.push({
      id: route.id || null,
      source: route.source,
      scenarioId: route.scenarioId || null,
      status: route.status,
      problem: route.problem === true,
      roomKeys: path.keys,
      pointCount: path.points.length,
    });
    for (let index = 0; index < path.points.length - 1; index += 1) {
      const aKey = path.keys[index];
      const bKey = path.keys[index + 1];
      const key = transitionKey(aKey, bKey);
      const current = transitions.get(key) || {
        key,
        aKey,
        bKey,
        a: path.points[index],
        b: path.points[index + 1],
        routeIds: new Set(),
        scenarioIds: new Set(),
        requirementCount: 0,
        problemCount: 0,
      };
      current.routeIds.add(route.id || `${route.source}:${index}`);
      if (route.scenarioId) current.scenarioIds.add(route.scenarioId);
      if (route.source === 'functional') current.requirementCount += 1;
      if (route.problem) current.problemCount += 1;
      transitions.set(key, current);
    }
  }
  return { transitions: [...transitions.values()], routeDiagnostics };
}

function drawTransition(ctx, transition, tokens) {
  const routeCount = transition.routeIds.size;
  const problem = transition.problemCount > 0;
  const color = problem ? (tokens?.warn || '#b36b00') : (tokens?.accent || '#1f75ff');
  const width = 2.1 + Math.min(4.4, Math.log2(Math.max(1, routeCount)) * 1.25);
  const trace = () => {
    ctx.beginPath();
    ctx.moveTo(transition.a.x, transition.a.y);
    ctx.lineTo(transition.b.x, transition.b.y);
  };
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = tokens?.surface || '#fff';
  ctx.globalAlpha = 0.86;
  ctx.lineWidth = width + 3.6;
  trace();
  ctx.stroke();
  ctx.strokeStyle = color;
  ctx.globalAlpha = 0.9;
  ctx.lineWidth = width;
  trace();
  ctx.stroke();
  ctx.restore();
}

function drawRouteNodes(ctx, transitions, tokens) {
  const nodes = new Map();
  for (const transition of transitions) {
    nodes.set(transition.aKey, transition.a);
    nodes.set(transition.bKey, transition.b);
  }
  ctx.save();
  ctx.fillStyle = tokens?.surface || '#fff';
  ctx.strokeStyle = tokens?.accent || '#1f75ff';
  ctx.lineWidth = 1.6;
  for (const point of nodes.values()) {
    ctx.beginPath();
    ctx.arc(point.x, point.y, 3.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * Рисует зоны и схему связей активного этажа в экранных координатах.
 * Толщина означает число явно анализируемых требований/сценариев на одном
 * переходе. Она не означает число людей или фактическую частоту ходьбы.
 */
export function drawHomeFlowsOverlay(ctx, {
  st, p2s, tokens, print = false,
} = {}) {
  const view = st?.homeProgramOverlay;
  const result = view?.result;
  if (!st || !ctx || typeof p2s !== 'function' || print
    || st.modeName !== 'plan' || view?.on !== true || !result) {
    if (st) {
      st._homeFlowsUI = null;
      st._homeProgramUI = null;
    }
    return null;
  }

  const levelId = st.project?.activeLevel || null;
  const maps = activeRoomMaps(st, levelId);
  const rooms = { maps, levelId };
  const zonesOn = view.zones !== false;
  const routesOn = view.routes !== false;
  const problemsOnly = view.problemsOnly === true;

  const zoneSummary = zonesOn
    ? drawZones(ctx, result, { ...maps, maps }, levelId, p2s)
    : { counts: {}, drawn: 0 };

  // Прежний слой «Программа» отвечает только на вопрос о требуемых
  // функциональных связях. Активированные бытовые сценарии относятся к
  // отдельному этапу «Зоны и маршруты» и не должны незаметно менять линии или
  // их толщину в старом слое.
  const collectedRoutes = collectRoutes(result, levelId);
  const allRoutes = view.mode === 'program'
    ? collectedRoutes.filter((route) => route.source === 'functional')
    : collectedRoutes;
  const unknownPathCount = allRoutes.filter((route) => !PROVEN_STATUSES.has(route.status)).length;
  const eligibleRoutes = routesOn ? allRoutes.filter((route) => {
    if (!PROVEN_STATUSES.has(route.status)) return false;
    if (problemsOnly && !route.problem) return false;
    return routeOnLevel(route, levelId, maps);
  }) : [];
  const aggregated = aggregateTransitions(eligibleRoutes, rooms, p2s);
  for (const transition of aggregated.transitions) drawTransition(ctx, transition, tokens);
  if (aggregated.transitions.length) drawRouteNodes(ctx, aggregated.transitions, tokens);

  const summary = {
    active: true,
    levelId,
    zonesOn,
    routesOn,
    problemsOnly,
    zoneCounts: zoneSummary.counts,
    drawnZoneCount: zoneSummary.drawn,
    routeCounts: {
      total: allRoutes.length,
      functional: allRoutes.filter((route) => route.source === 'functional').length,
      scenario: allRoutes.filter((route) => route.source === 'scenario').length,
      eligible: eligibleRoutes.length,
      drawn: aggregated.routeDiagnostics.length,
      unknown: unknownPathCount,
    },
    transitionCount: aggregated.transitions.length,
    paths: aggregated.routeDiagnostics,
    transitions: aggregated.transitions.map((transition) => ({
      key: transition.key,
      aRoomKey: transition.aKey,
      bRoomKey: transition.bKey,
      routeCount: transition.routeIds.size,
      scenarioCount: transition.scenarioIds.size,
      requirementCount: transition.requirementCount,
      problemCount: transition.problemCount,
    })),
  };
  st._homeFlowsUI = summary;
  // Совместимость диагностики прежнего слоя «Связи дома»: новый renderer
  // показывает те же functional routes, но уже из общего анализа потоков.
  if (view.mode === 'program') {
    const statusCounts = {};
    for (const route of allRoutes.filter((entry) => entry.source === 'functional')) {
      statusCounts[route.status] = (statusCounts[route.status] || 0) + 1;
      if (route.status === 'co_located') {
        // Прежний анализ называл совмещённые функции direct. Сохраняем этот
        // агрегат только в legacy-диагностике; линия нулевой длины не рисуется.
        statusCounts.direct = (statusCounts.direct || 0) + 1;
      }
    }
    st._homeProgramUI = {
      active: true,
      levelId,
      eligibleConnectionCount: eligibleRoutes.length,
      drawnConnectionCount: aggregated.routeDiagnostics.length,
      statusCounts,
      paths: aggregated.routeDiagnostics,
    };
  } else st._homeProgramUI = null;
  return summary;
}
