// Доказательные метрики для дверей и маршрутов.
//
// В этом модуле нет DOM и скрытых допущений. Метрика появляется только когда
// вызывающая сторона передала достаточное геометрическое доказательство. Это
// важно для правил GEO008/PATH003/PATH005/PATH006/PATH020: отсутствие полного
// маршрута или профиля пользователя должно оставаться unknown, а не pass.

import { roomContainsPoint } from './room-shape.js';
import { doorLeaves, doorLink, openingRect } from './walls.js';

const VALID_WIDTH_MEASUREMENTS = new Set([
  'clearance_map_cross_section',
  'configuration_space_cross_section',
  'validated_navmesh_clearance',
]);

const check = (key, op, target = undefined) => Object.freeze({
  key, op, ...(target === undefined ? {} : { target }),
});

const binding = (id, title, severity, evaluator, checks, opts = {}) => Object.freeze({
  id,
  category: 'Маршруты и движение',
  title,
  severity,
  implementation: 'implemented',
  evaluator,
  checks: Object.freeze(checks),
  basis: opts.basis || 'design_heuristic',
  sourceIds: Object.freeze(opts.sourceIds || []),
  applies: Object.freeze(opts.applies || {}),
  requiresData: Object.freeze(opts.requiresData || []),
  parameters: Object.freeze(opts.parameters || {}),
});

// Новые curated bindings. Они вынесены отдельно, чтобы layout-rules.js мог
// подключать группы правил централизованно без дублирования порогов.
export const DOOR_ROUTE_RULE_BINDINGS = Object.freeze([
  binding('PATH003', 'Главный маршрут', 'soft', 'navmesh_connectivity', [
    check('main_route_graph_fresh', 'true'),
  ]),
  binding('PATH005', 'Встречное движение', 'soft', 'navmesh_connectivity', [
    check('two_way_route_min_width_mm', 'gte', 1400),
  ], { parameters: { comfortTargetMm: [1400, 1600] } }),
  binding('PATH006', 'Второстепенный подход', 'soft', 'navmesh_connectivity', [
    check('secondary_approaches_valid', 'true'),
  ]),
]);

// Уточнения двух уже подключённых правил. GEO008 не должен проходить только
// потому, что мебель не пересекла грубый квадрат двери: нужен достижимый
// подход к ручке. PATH020 требует сохранённую точку/длину bottleneck.
export const ENHANCED_DOOR_ROUTE_BINDINGS = Object.freeze([
  Object.freeze({
    id: 'GEO008',
    category: 'Геометрия и состояния объектов',
    title: 'Объем открывания дверей',
    severity: 'hard',
    implementation: 'implemented',
    evaluator: 'swept_opening',
    checks: Object.freeze([
      check('door_swing_collision_count', 'lte', 0),
      check('door_handle_approach_reachable', 'true'),
    ]),
    basis: 'derived_constraint',
    sourceIds: Object.freeze([]),
    applies: Object.freeze({}),
    requiresData: Object.freeze([]),
    parameters: Object.freeze({
      scope: 'Консервативная swept-AABB распашных створок и проверенный подход к ручке на текущем route graph.',
    }),
  }),
  binding('PATH020', 'Узкие места', 'hard', 'bottleneck', [
    check('route_bottleneck_evidence_complete', 'true'),
  ], { basis: 'derived_constraint' }),
]);

const finite = (value) => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
const rectOverlap = (a, b, eps = 1e-6) => a.x + a.w > b.x + eps && b.x + b.w > a.x + eps
  && a.y + a.h > b.y + eps && b.y + b.h > a.y + eps;

function symbolEnvelope(symbol, padding = 0) {
  const points = [symbol?.hinge, symbol?.closed, symbol?.open, symbol?.through]
    .filter((point) => finite(point?.x) && finite(point?.y));
  if (points.length < 3) return null;
  const safePadding = Math.max(0, Number(padding) || 0);
  const x0 = Math.min(...points.map((point) => Number(point.x))) - safePadding;
  const x1 = Math.max(...points.map((point) => Number(point.x))) + safePadding;
  const y0 = Math.min(...points.map((point) => Number(point.y))) - safePadding;
  const y1 = Math.max(...points.map((point) => Number(point.y))) + safePadding;
  if (!(x1 > x0) || !(y1 > y0)) return null;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
function handlePoint(symbol, insetMm) {
  if (![symbol?.hinge?.x, symbol?.hinge?.y, symbol?.closed?.x, symbol?.closed?.y].every(finite)) return null;
  const length = Math.hypot(symbol.closed.x - symbol.hinge.x, symbol.closed.y - symbol.hinge.y);
  if (!(length > 0) || !finite(insetMm)) return null;
  // Паспортный inset отсчитывается от свободного края к петле.
  const ratio = Math.max(0, Math.min(length, Number(insetMm))) / length;
  return {
    x: Number(symbol.closed.x) + (Number(symbol.hinge.x) - Number(symbol.closed.x)) * ratio,
    y: Number(symbol.closed.y) + (Number(symbol.hinge.y) - Number(symbol.closed.y)) * ratio,
  };
}

function approachPoints(room, symbol, offsetMm, insetMm) {
  const handle = handlePoint(symbol, insetMm);
  if (!handle || !symbol.wall) return [];
  const normal = symbol.wall.orient === 'h' ? { x: 0, y: 1 } : { x: 1, y: 0 };
  return [-1, 1]
    .map((sign) => ({
      x: handle.x + normal.x * offsetMm * sign,
      y: handle.y + normal.y * offsetMm * sign,
    }))
    .filter((point) => roomContainsPoint(room, point.x, point.y));
}

function openMidpoint(symbol) {
  if (![symbol?.hinge?.x, symbol?.hinge?.y, symbol?.open?.x, symbol?.open?.y].every(finite)) return null;
  return {
    x: (Number(symbol.hinge.x) + Number(symbol.open.x)) / 2,
    y: (Number(symbol.hinge.y) + Number(symbol.open.y)) / 2,
  };
}

function verifiedSwingGeometry(opening) {
  return opening?.swingGeometryStatus === 'verified'
    && finite(opening.leafThicknessMm) && Number(opening.leafThicknessMm) > 0
    && finite(opening.handleProjectionMm) && Number(opening.handleProjectionMm) >= 0
    && finite(opening.handleInsetMm) && Number(opening.handleInsetMm) >= 0;
}

function obstacleEntry(value, index) {
  const wrapped = value?.rect && typeof value.rect === 'object';
  const rect = wrapped ? value.rect : value;
  if (![rect?.x, rect?.y, rect?.w, rect?.h].every(finite) || !(Number(rect.w) > 0) || !(Number(rect.h) > 0)) return null;
  return {
    index,
    rect: { x: Number(rect.x), y: Number(rect.y), w: Number(rect.w), h: Number(rect.h) },
    type: wrapped && typeof value.type === 'string' ? value.type : 'solid',
    roomId: wrapped && typeof value.roomId === 'string' ? value.roomId : null,
    wallId: wrapped && typeof value.wallId === 'string' ? value.wallId : null,
  };
}

function hostWallRooms(opening, walls) {
  const wallId = opening?.host?.wallId;
  if (!wallId) return [];
  const wall = walls.find((entry) => entry?.id === wallId || entry?.wallId === wallId || entry?.key === wallId);
  if (!wall) return [];
  return Array.isArray(wall.rooms) ? wall.rooms.filter((id) => typeof id === 'string') : [];
}

function linkedToRoom(opening, link, room, walls) {
  if (Array.isArray(link)) return link.includes(room.id);
  if (opening?.roomId) return opening.roomId === room.id;
  return hostWallRooms(opening, walls).includes(room.id);
}

function applicability(doors, type) {
  const matching = doors.filter(type);
  if (!matching.length) return false;
  if (matching.some((door) => door.scopeLeafCount > 0 && door.status === 'computed')) return true;
  return 'unknown';
}

/**
 * Проверить распашные двери конкретного помещения.
 *
 * obstacleRects — реальные проекции твердых предметов текущего варианта.
 * isReachable(point, opening) — проверка точки тем же route graph, который
 * использован для PATH001/2. Без callback подход к ручке не выдумывается.
 */
export function collectRoomDoorRouteEvidence({
  project,
  room,
  walls,
  obstacleRects = [],
  isReachable = null,
  handleApproachOffsetMm = 450,
  modeledScopeComplete = false,
} = {}) {
  if (!project || !room || !Array.isArray(walls)) return {
    metrics: {}, ruleApplicability: {}, doors: [],
  };
  const doors = [];
  const obstacles = (Array.isArray(obstacleRects) ? obstacleRects : [])
    .map(obstacleEntry)
    .filter(Boolean);
  for (const opening of project.openings || []) {
    if (opening?.kind !== 'door') continue;
    const link = doorLink(project, opening, walls);
    if (!linkedToRoom(opening, link, room, walls)) continue;
    const type = opening.type || 'single';
    const placed = openingRect(project, opening, walls);
    const record = {
      openingId: opening.id,
      type,
      link: Array.isArray(link) ? [...link] : null,
      placed: Boolean(placed),
      status: 'unknown',
      envelopes: [],
      leaves: [],
      scopeLeafCount: 0,
      approachPoints: [],
      collisions: [],
      handleApproachReachable: null,
    };
    if (type === 'none') {
      record.status = placed ? 'not_applicable' : 'unknown';
    } else if (type === 'sliding') {
      // В модели пока нет track/panel_stack/handle; отсутствие дуги не равно
      // доказанной кинематике раздвижной системы.
      record.status = 'unknown';
      record.reason = placed ? 'sliding_hardware_geometry_missing' : 'opening_unplaced';
    } else if (placed && (type === 'single' || type === 'double')) {
      const symbols = doorLeaves(project, opening, walls);
      const verified = verifiedSwingGeometry(opening);
      const padding = verified
        ? Number(opening.leafThicknessMm) / 2 + Number(opening.handleProjectionMm)
        : 0;
      const explicitlyRequired = Array.isArray(opening.requiredLeafIndices)
        ? new Set(opening.requiredLeafIndices.filter((index) => Number.isInteger(index) && index >= 0))
        : null;
      record.leaves = symbols.map((symbol, leafIndex) => {
        const midpoint = openMidpoint(symbol);
        const inCurrentRoom = Boolean(midpoint && roomContainsPoint(room, midpoint.x, midpoint.y));
        const required = !explicitlyRequired || explicitlyRequired.has(leafIndex);
        const baseEnvelope = symbolEnvelope(symbol);
        const envelope = symbolEnvelope(symbol, padding);
        const points = verified && inCurrentRoom && required
          ? approachPoints(room, symbol, handleApproachOffsetMm, opening.handleInsetMm)
          : [];
        const collisions = !inCurrentRoom || !required || !baseEnvelope ? [] : obstacles.flatMap((obstacle) => {
          if (obstacle.type === 'child' && record.link?.includes(obstacle.roomId)) return [];
          if (obstacle.type === 'wall' && obstacle.wallId
            && (obstacle.wallId === opening.host?.wallId || obstacle.wallId === placed.wall?.wallId)) return [];
          // Без паспортных данных уже найденное пересечение базовой swept-AABB
          // является достаточным fail evidence. Для доказательства нуля ниже
          // требуется padded envelope и полный modeled scope.
          const testedEnvelope = verified ? envelope : baseEnvelope;
          return testedEnvelope && rectOverlap(testedEnvelope, obstacle.rect)
            ? [{ obstacleIndex: obstacle.index, leafIndex, type: obstacle.type, roomId: obstacle.roomId }]
            : [];
        });
        let reachable = null;
        if (verified && inCurrentRoom && required && typeof isReachable === 'function' && points.length) {
          reachable = points.some((point) => isReachable(point, opening, leafIndex) === true);
        }
        return {
          leafIndex, required, inCurrentRoom, midpoint, baseEnvelope, envelope,
          approachPoints: points, collisions, handleApproachReachable: reachable,
        };
      });
      const scoped = record.leaves.filter((leaf) => leaf.required && leaf.inCurrentRoom);
      record.scopeLeafCount = scoped.length;
      record.envelopes = scoped.map((leaf) => leaf.envelope || leaf.baseEnvelope).filter(Boolean);
      record.approachPoints = scoped.flatMap((leaf) => leaf.approachPoints);
      record.collisions = scoped.flatMap((leaf) => leaf.collisions);
      if (typeof isReachable === 'function' && scoped.length
        && scoped.every((leaf) => typeof leaf.handleApproachReachable === 'boolean')) {
        record.handleApproachReachable = scoped.every((leaf) => leaf.handleApproachReachable);
      }
      record.zeroProofReady = Boolean(modeledScopeComplete) && verified && scoped.length > 0
        && scoped.every((leaf) => leaf.envelope);
      record.status = symbols.length > 0 && scoped.every((leaf) => leaf.baseEnvelope) ? 'computed' : 'unknown';
      if (record.status === 'unknown') record.reason = 'door_leaf_geometry_missing';
      else if (!scoped.length) {
        record.status = record.link?.includes('outside') ? 'unknown' : 'not_applicable';
        record.reason = record.link?.includes('outside') ? 'swing_scope_not_modeled' : 'swing_opens_into_linked_room';
      }
    } else {
      record.reason = 'opening_unplaced_or_type_unsupported';
    }
    doors.push(record);
  }

  const hinged = doors.filter((door) => door.type === 'single' || door.type === 'double');
  const sliding = doors.filter((door) => door.type === 'sliding');
  const unsupported = doors.filter((door) => !['single', 'double', 'sliding', 'none'].includes(door.type));
  const scopedHinged = hinged.filter((door) => door.scopeLeafCount > 0);
  const metrics = {};
  const collisionCount = scopedHinged.reduce((sum, door) => sum + door.collisions.length, 0);
  if (collisionCount > 0) {
    metrics.door_swing_collision_count = collisionCount;
  } else if (scopedHinged.length && scopedHinged.every((door) => door.zeroProofReady === true)
    && !hinged.some((door) => door.status === 'unknown')) {
    metrics.door_swing_collision_count = 0;
  }
  if (scopedHinged.length && scopedHinged.every((door) => typeof door.handleApproachReachable === 'boolean')
    && !hinged.some((door) => door.status === 'unknown')) {
    metrics.door_handle_approach_reachable = scopedHinged.every((door) => door.handleApproachReachable);
  }
  return {
    metrics,
    ruleApplicability: {
      GEO008: (() => {
        const known = applicability(hinged, (door) => door.type === 'single' || door.type === 'double');
        // Найденная collision — достаточное fail evidence даже при другой
        // неподдержанной двери. Но чистая известная створка не доказывает
        // отсутствие collision во всём scope, если часть кинематики unknown.
        if (collisionCount > 0) return true;
        return unsupported.length ? 'unknown' : known;
      })(),
      GEO009: (() => {
        const known = applicability(sliding, (door) => door.type === 'sliding');
        return unsupported.length ? 'unknown' : known;
      })(),
    },
    doors,
  };
}

function completeBottleneck(value) {
  return value && finite(value.minWidthMm) && finite(value.x) && finite(value.y)
    && finite(value.lengthMm) && value.lengthMm >= 0 && typeof value.state === 'string' && value.state.trim();
}

function actorProfileKnown(actor) {
  if (!actor || !['measured', 'declared'].includes(actor.dataStatus) || actor.mobilityProfile === 'unknown') return false;
  if (actor.mobilityProfile === 'standard') return true;
  return finite(actor.bodyWidthMm) && finite(actor.bodyDepthMm);
}

/**
 * Собрать маршрутные метрики только из проверенного route evidence.
 * Старое поле route.minWidth без measurementDefinition намеренно игнорируется:
 * в прежнем решателе оно означало диаметр тестового агента, а не измеренную
 * ширину прохода.
 */
export function collectVerifiedRouteMetrics({
  route,
  currentInputSignature = null,
  actors = [],
} = {}) {
  if (!route || route.unknown === true) return {};
  const metrics = {};
  const fresh = route.computedFromCurrentLayout === true
    || (typeof route.inputSignature === 'string' && route.inputSignature
      && route.inputSignature === currentInputSignature);
  if (fresh) metrics.main_route_graph_fresh = true;

  const bottleneck = route.bottleneck;
  if (completeBottleneck(bottleneck)
    && VALID_WIDTH_MEASUREMENTS.has(bottleneck.measurementDefinition)) {
    metrics.main_route_min_width_mm = Number(bottleneck.minWidthMm);
    metrics.route_bottleneck_evidence_complete = true;
  }

  const twoWay = route.twoWay;
  if (twoWay && finite(twoWay.minWidthMm)
    && VALID_WIDTH_MEASUREMENTS.has(twoWay.measurementDefinition)
    && Array.isArray(actors) && actors.length >= 2 && actors.every(actorProfileKnown)) {
    metrics.two_way_route_min_width_mm = Number(twoWay.minWidthMm);
  }

  const approaches = route.secondaryApproaches;
  if (Array.isArray(approaches) && approaches.length
    && approaches.every((entry) => typeof entry?.reachable === 'boolean' && entry.profileVerified === true)) {
    metrics.secondary_approaches_valid = approaches.every((entry) => entry.reachable);
  }
  return metrics;
}
