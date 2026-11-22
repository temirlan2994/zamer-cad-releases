// Детальные маршруты движения по текущей расстановке.
//
// Расчёт дискретный: путь строится по 50-мм (или явно заданной) сетке
// конфигурационного пространства. Стены, сложный контур комнаты и реальные
// напольные части мебели учитываются геометрически. Если конечная функция
// привязана только к помещению, маршрут остаётся приблизительным: центр
// подписи комнаты не выдаётся за фактическое место кровати, мойки и т. п.

import { furnitureDef } from './catalog.js';
import {
  buildRoomWalkGrid, ERGO_CELL, ERGO_NORMS,
} from './ergonomics.js';
import { analyzeHomeFlows } from './home-flows.js';
import { itemsInRoom } from './furnish.js';
import { levelProject } from './model.js';
import { roomContainsPoint, roomLabelPoint } from './room-shape.js';
import {
  deriveWalls, doorLink, openingRect, wallRects,
} from './walls.js';

const array = (value) => (Array.isArray(value) ? value : []);
const finite = (value) => value !== null && value !== undefined && value !== ''
  && Number.isFinite(Number(value));
const roomKey = (levelId, roomId) => `${levelId}:${roomId}`;
const splitRoomKey = (key) => {
  const separator = typeof key === 'string' ? key.indexOf(':') : -1;
  return separator < 0 ? { levelId: null, roomId: null }
    : { levelId: key.slice(0, separator), roomId: key.slice(separator + 1) };
};
const clampProfile = (value) => Math.max(300, Math.min(2400, Math.round(Number(value) || 600)));
const clampCell = (value) => Math.max(25, Math.min(200, Math.round(Number(value) || ERGO_CELL)));

function projectedCells(room, cell) {
  return (Math.ceil((Number(room?.w) || 0) / cell) + 2)
    * (Math.ceil((Number(room?.h) || 0) / cell) + 2);
}

function cellPoint(grid, index) {
  return {
    x: grid.x0 + ((index % grid.cols) + 0.5) * grid.cell,
    y: grid.y0 + (Math.floor(index / grid.cols) + 0.5) * grid.cell,
  };
}

function pointInPolygon(point, polygon) {
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index, index += 1) {
    const a = polygon[index]; const b = polygon[previous];
    const cross = (a.x - b.x) * (point.y - b.y) - (a.y - b.y) * (point.x - b.x);
    const onEdge = Math.abs(cross) <= 1e-6
      && point.x >= Math.min(a.x, b.x) - 1e-6 && point.x <= Math.max(a.x, b.x) + 1e-6
      && point.y >= Math.min(a.y, b.y) - 1e-6 && point.y <= Math.max(a.y, b.y) + 1e-6;
    if (onEdge) return true;
    if ((a.y > point.y) !== (b.y > point.y)
      && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function orient(a, b, c) {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function onSegment(a, b, point) {
  return Math.abs(orient(a, b, point)) <= 1e-6
    && point.x >= Math.min(a.x, b.x) - 1e-6 && point.x <= Math.max(a.x, b.x) + 1e-6
    && point.y >= Math.min(a.y, b.y) - 1e-6 && point.y <= Math.max(a.y, b.y) + 1e-6;
}

function segmentsIntersect(a, b, c, d) {
  const abC = orient(a, b, c); const abD = orient(a, b, d);
  const cdA = orient(c, d, a); const cdB = orient(c, d, b);
  if (((abC > 0 && abD < 0) || (abC < 0 && abD > 0))
    && ((cdA > 0 && cdB < 0) || (cdA < 0 && cdB > 0))) return true;
  return onSegment(a, b, c) || onSegment(a, b, d)
    || onSegment(c, d, a) || onSegment(c, d, b);
}

function segmentHitsPolygon(from, to, polygon) {
  if (polygon.length < 3) return false;
  if (pointInPolygon(from, polygon) || pointInPolygon(to, polygon)) return true;
  for (let index = 0; index < polygon.length; index += 1) {
    if (segmentsIntersect(from, to, polygon[index], polygon[(index + 1) % polygon.length])) return true;
  }
  return false;
}

function pointSegmentDistance(point, a, b) {
  const dx = b.x - a.x; const dy = b.y - a.y;
  const length2 = dx * dx + dy * dy;
  const ratio = length2
    ? Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / length2)) : 0;
  return Math.hypot(point.x - (a.x + dx * ratio), point.y - (a.y + dy * ratio));
}

function polygonEdgeDistance(point, polygon) {
  if (polygon.length < 3) return Infinity;
  let distance = Infinity;
  for (let index = 0; index < polygon.length; index += 1) {
    distance = Math.min(distance, pointSegmentDistance(
      point, polygon[index], polygon[(index + 1) % polygon.length],
    ));
  }
  return distance;
}

function polygonDistance(point, polygon) {
  return pointInPolygon(point, polygon) ? 0 : polygonEdgeDistance(point, polygon);
}

function anchorCellVisible(grid, anchor, point, profileWidthMm) {
  const from = anchor?.point;
  if (!from || !finite(from.x) || !finite(from.y)) return false;
  const radius = profileWidthMm / 2;
  const corridor = {
    x0: Math.min(from.x, point.x) - radius,
    y0: Math.min(from.y, point.y) - radius,
    x1: Math.max(from.x, point.x) + radius,
    y1: Math.max(from.y, point.y) + radius,
  };
  const obstacles = array(grid.obstacles).filter((obstacle) => {
    const bounds = obstacle?.bounds;
    return !bounds || (bounds.x0 <= corridor.x1 && bounds.x1 >= corridor.x0
      && bounds.y0 <= corridor.y1 && bounds.y1 >= corridor.y0);
  });
  const distance = Math.hypot(point.x - from.x, point.y - from.y);
  const samples = Math.max(1, Math.ceil(distance / Math.max(10, grid.cell / 2)));
  for (let step = 0; step <= samples; step += 1) {
    const ratio = step / samples;
    const sample = {
      x: from.x + (point.x - from.x) * ratio,
      y: from.y + (point.y - from.y) * ratio,
    };
    if (typeof grid.containsPoint === 'function' && !grid.containsPoint(sample.x, sample.y)) return false;
    const insideOwnItem = anchor.type === 'item' && obstacles.some((obstacle) => (
      obstacle?.kind === 'item' && obstacle.id === anchor.id
      && pointInPolygon(sample, array(obstacle?.polygon))
    ));
    if (insideOwnItem) continue;
    if (polygonEdgeDistance(sample, array(grid.roomBoundary)) < radius - 1e-6) return false;
    for (const obstacle of obstacles) {
      if (anchor.type === 'item' && obstacle?.kind === 'item' && obstacle.id === anchor.id) continue;
      if (polygonDistance(sample, array(obstacle?.polygon)) < radius - 1e-6) return false;
    }
  }
  for (const obstacle of obstacles) {
    if (anchor.type === 'item' && obstacle?.kind === 'item' && obstacle.id === anchor.id) continue;
    if (segmentHitsPolygon(from, point, array(obstacle?.polygon))) return false;
  }
  return true;
}

function pointIndex(grid, point, mask, maxDistance = 1800) {
  if (!point || !finite(point.x) || !finite(point.y)) return -1;
  let best = -1;
  let bestD2 = maxDistance * maxDistance;
  for (let index = 0; index < mask.length; index += 1) {
    if (!mask[index]) continue;
    const candidate = cellPoint(grid, index);
    const distance = (candidate.x - point.x) ** 2 + (candidate.y - point.y) ** 2;
    if (distance < bestD2 - 1e-6 || (Math.abs(distance - bestD2) < 1e-6 && index < best)) {
      bestD2 = distance;
      best = index;
    }
  }
  return best;
}

function maskFor(grid, widthMm) {
  const result = new Uint8Array(grid.free.length);
  for (let index = 0; index < result.length; index += 1) {
    result[index] = grid.free[index] && grid.clearanceMm[index] >= widthMm ? 1 : 0;
  }
  return result;
}

class MinHeap {
  constructor() { this.values = []; }

  push(value) {
    const values = this.values;
    values.push(value);
    let index = values.length - 1;
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (values[parent].priority < value.priority
        || (values[parent].priority === value.priority && values[parent].index <= value.index)) break;
      values[index] = values[parent];
      index = parent;
    }
    values[index] = value;
  }

  pop() {
    const values = this.values;
    if (!values.length) return null;
    const root = values[0];
    const tail = values.pop();
    if (!values.length) return root;
    let index = 0;
    while (index * 2 + 1 < values.length) {
      let child = index * 2 + 1;
      if (child + 1 < values.length && (values[child + 1].priority < values[child].priority
        || (values[child + 1].priority === values[child].priority
          && values[child + 1].index < values[child].index))) child += 1;
      if (values[child].priority > tail.priority
        || (values[child].priority === tail.priority && values[child].index >= tail.index)) break;
      values[index] = values[child];
      index = child;
    }
    values[index] = tail;
    return root;
  }

  get length() { return this.values.length; }
}

const MOVES = Object.freeze([
  [1, 0, 1], [0, 1, 1], [-1, 0, 1], [0, -1, 1],
  [1, 1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2], [1, -1, Math.SQRT2],
]);
const SEARCH_BUDGET_EXCEEDED = Object.freeze({ budgetExceeded: true });

function restorePath(previous, start, goal) {
  const indices = [goal];
  let current = goal;
  while (current !== start) {
    current = previous[current];
    if (current < 0) return null;
    indices.push(current);
  }
  indices.reverse();
  return indices;
}

function collapseCollinear(grid, indices) {
  if (indices.length < 3) return indices.map((index) => cellPoint(grid, index));
  const result = [indices[0]];
  let previousDirection = null;
  for (let offset = 1; offset < indices.length; offset += 1) {
    const before = indices[offset - 1];
    const current = indices[offset];
    const direction = [
      (current % grid.cols) - (before % grid.cols),
      Math.floor(current / grid.cols) - Math.floor(before / grid.cols),
    ];
    if (previousDirection && (direction[0] !== previousDirection[0]
      || direction[1] !== previousDirection[1])) result.push(before);
    previousDirection = direction;
  }
  result.push(indices[indices.length - 1]);
  return result.map((index) => cellPoint(grid, index));
}

function searchGrid(grid, fromPoint, toPoint, widthMm, budget = null) {
  if (budget && (budget.searches >= budget.maxSearches
    || budget.expandedCells + grid.free.length > budget.maxExpandedCells)) {
    budget.exceeded = true;
    return SEARCH_BUDGET_EXCEEDED;
  }
  if (budget) {
    budget.searches += 1;
    // Считаем детерминированную верхнюю оценку вместо машинно-зависимого
    // времени A*: так один и тот же проект везде получает одинаковый ответ.
    budget.expandedCells += grid.free.length;
  }
  const mask = widthMm > 0 ? maskFor(grid, widthMm) : grid.free;
  const start = pointIndex(grid, fromPoint, mask);
  const goal = pointIndex(grid, toPoint, mask);
  if (start < 0 || goal < 0) return null;
  if (start === goal) return {
    indices: [start], points: [cellPoint(grid, start)], lengthMm: 0,
  };
  const count = mask.length;
  const distance = new Float64Array(count);
  distance.fill(Infinity);
  const previous = new Int32Array(count);
  previous.fill(-1);
  const closed = new Uint8Array(count);
  const heap = new MinHeap();
  const gx = goal % grid.cols;
  const gy = Math.floor(goal / grid.cols);
  distance[start] = 0;
  heap.push({ index: start, priority: 0 });
  while (heap.length) {
    const current = heap.pop();
    const index = current.index;
    if (closed[index]) continue;
    if (index === goal) break;
    closed[index] = 1;
    const x = index % grid.cols;
    const y = Math.floor(index / grid.cols);
    for (const [dx, dy, factor] of MOVES) {
      const nx = x + dx; const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= grid.cols || ny >= grid.rows) continue;
      const next = ny * grid.cols + nx;
      if (!mask[next]) continue;
      // Диагональ не срезает заблокированный угол.
      if (dx && dy && (!mask[y * grid.cols + nx] || !mask[ny * grid.cols + x])) continue;
      const clearance = Math.max(grid.cell, grid.clearanceMm[next]);
      const comfortPenalty = widthMm > 0 ? Math.min(0.35, (widthMm / clearance) * 0.18) : 0;
      const step = grid.cell * factor * (1 + comfortPenalty);
      const candidate = distance[index] + step;
      if (candidate >= distance[next] - 1e-6) continue;
      distance[next] = candidate;
      previous[next] = index;
      const heuristic = Math.hypot(nx - gx, ny - gy) * grid.cell;
      heap.push({ index: next, priority: candidate + heuristic });
    }
  }
  if (!Number.isFinite(distance[goal])) return null;
  const indices = restorePath(previous, start, goal);
  if (!indices) return null;
  let lengthMm = 0;
  for (let offset = 1; offset < indices.length; offset += 1) {
    const a = cellPoint(grid, indices[offset - 1]);
    const b = cellPoint(grid, indices[offset]);
    lengthMm += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return { indices, points: collapseCollinear(grid, indices), lengthMm };
}

function effectiveOpeningWidth(opening) {
  const width = Number(opening?.width);
  if (!(width > 0)) return null;
  if (opening?.type !== 'double' || !Array.isArray(opening.requiredLeafIndices)) return width;
  const leaves = [...new Set(opening.requiredLeafIndices.filter((index) => index === 0 || index === 1))];
  if (leaves.length === 1) return width / 2;
  if (leaves.length === 2) return width;
  return null;
}

function openingPoint(level, opening, room) {
  const placed = openingRect(level.view, opening, level.walls);
  if (!placed) return null;
  const rect = placed.rect;
  const center = { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
  const horizontal = placed.wall?.orient === 'h'
    || (placed.wall?.orient !== 'v' && rect.w >= rect.h);
  const normal = horizontal ? { x: 0, y: 1 } : { x: 1, y: 0 };
  const offset = Math.max(level.cell, (level.profileWidthMm || 600) / 2 + level.cell);
  const candidates = [-1, 1].map((sign) => ({
    x: center.x + normal.x * offset * sign,
    y: center.y + normal.y * offset * sign,
  }));
  return candidates.find((point) => roomContainsPoint(room, point.x, point.y)) || center;
}

function hiddenBoundary(level, transition) {
  const roomIds = [splitRoomKey(transition.aRoomKey).roomId, splitRoomKey(transition.bRoomKey).roomId];
  const wall = level.walls.find((candidate) => candidate.hidden
    && roomIds.every((id) => array(candidate.rooms).includes(id)));
  if (!wall) return null;
  const rect = wallRects(wall).sort((a, b) => b.w * b.h - a.w * a.h)[0];
  if (!rect) return null;
  const center = { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
  return {
    id: transition.transitionKey,
    openingId: null,
    widthMm: Math.max(rect.w, rect.h),
    ambiguous: false,
    pointFor: () => center,
  };
}

function transitionPortal(level, transition) {
  const ids = array(transition?.openingIds).slice().sort();
  if (!ids.length) return hiddenBoundary(level, transition);
  const opening = level.openings.get(ids[0]);
  if (!opening || opening.kind !== 'door') return null;
  return {
    id: opening.id,
    openingId: opening.id,
    widthMm: effectiveOpeningWidth(opening),
    ambiguous: ids.length > 1,
    pointFor: (room) => openingPoint(level, opening, room),
  };
}

function endpointAnchor(level, room, endpoint) {
  const type = endpoint?.anchorType || endpoint?.anchor?.type || null;
  const id = endpoint?.anchorId || endpoint?.anchor?.id || null;
  if (type === 'item' && id) {
    const item = level.items.get(id);
    if (!item || !itemsInRoom(level.view, room).some((candidate) => candidate.id === id)) {
      return { status: 'unknown', reason: 'anchor_item_missing' };
    }
    return {
      status: 'exact', type, id,
      point: { x: Number(item.x), y: Number(item.y) },
      title: furnitureDef(item.kind)?.title || item.kind,
    };
  }
  if (type === 'opening' && id) {
    const opening = level.openings.get(id);
    const link = opening ? doorLink(level.view, opening, level.walls) : null;
    if (!opening || opening.kind !== 'door' || !array(link).includes(room.id)) {
      return { status: 'unknown', reason: 'anchor_opening_missing' };
    }
    return {
      status: 'exact', type, id,
      point: openingPoint(level, opening, room),
      widthMm: effectiveOpeningWidth(opening),
      title: 'Дверь',
    };
  }
  return {
    status: 'candidate', type: 'room_reference', id: room.id,
    point: roomLabelPoint(room), title: 'Опорная точка помещения',
  };
}

function anchorPointForGrid(grid, anchor, profileWidthMm, towardPoint = null, budget = null) {
  if (!anchor?.point) return null;
  if (anchor.type !== 'item' && anchor.type !== 'opening') return anchor.point;
  if (!grid.anchorCandidateCache) grid.anchorCandidateCache = new Map();
  const cacheKey = `${anchor.type}:${anchor.id}:${profileWidthMm}`;
  let cached = grid.anchorCandidateCache.get(cacheKey);
  if (!cached) {
    const mask = maskFor(grid, profileWidthMm);
    const local = [];
    const candidates = [];
    let nearestDistance = Infinity;
    const reach = anchor.type === 'item' ? 1400 : Math.max(900, profileWidthMm + grid.cell * 2);
    const reach2 = reach ** 2;
    const minCol = Math.max(0, Math.floor((anchor.point.x - reach - grid.x0) / grid.cell - 0.5));
    const maxCol = Math.min(grid.cols - 1, Math.ceil((anchor.point.x + reach - grid.x0) / grid.cell - 0.5));
    const minRow = Math.max(0, Math.floor((anchor.point.y - reach - grid.y0) / grid.cell - 0.5));
    const maxRow = Math.min(grid.rows - 1, Math.ceil((anchor.point.y + reach - grid.y0) / grid.cell - 0.5));
    for (let row = minRow; row <= maxRow; row += 1) {
      for (let col = minCol; col <= maxCol; col += 1) {
        const index = row * grid.cols + col;
        if (!mask[index]) continue;
        const point = cellPoint(grid, index);
        const distance2 = (point.x - anchor.point.x) ** 2 + (point.y - anchor.point.y) ** 2;
        if (distance2 <= reach2) local.push({ index, distance: Math.sqrt(distance2) });
      }
    }
    local.sort((a, b) => a.distance - b.distance || a.index - b.index);
    for (const candidate of local) {
      if (candidate.distance > nearestDistance + grid.cell + 1e-6) break;
      if (budget && budget.anchorChecks >= budget.maxAnchorChecks) {
        budget.exceeded = true;
        return SEARCH_BUDGET_EXCEEDED;
      }
      if (budget) budget.anchorChecks += 1;
      const point = cellPoint(grid, candidate.index);
      // Сервисная клетка точного якоря должна быть видима из самого объекта.
      // Иначе ближайшая клетка за стеной превращает закрытый объект в ложный
      // свободный маршрут.
      if (!anchorCellVisible(grid, anchor, point, profileWidthMm)) continue;
      nearestDistance = Math.min(nearestDistance, candidate.distance);
      candidates.push(candidate);
    }
    cached = { candidates, nearestDistance };
    grid.anchorCandidateCache.set(cacheKey, cached);
  }
  // Берём один из ближайших подходов, а среди равноценных — обращённый к
  // второй точке маршрута. Это не позволяет перепрыгнуть горлышко, но и не
  // заводит путь на глухую сторону предмета из-за порядка индексов сетки.
  let selected = null;
  let selectedToward = Infinity;
  for (const candidate of cached.candidates) {
    if (candidate.distance > cached.nearestDistance + grid.cell + 1e-6) continue;
    const point = cellPoint(grid, candidate.index);
    const towardDistance = towardPoint
      ? Math.hypot(point.x - towardPoint.x, point.y - towardPoint.y) : 0;
    if (!selected || towardDistance < selectedToward - 1e-6
      || (Math.abs(towardDistance - selectedToward) <= 1e-6
        && (candidate.distance < selected.distance - 1e-6
          || (Math.abs(candidate.distance - selected.distance) <= 1e-6
            && candidate.index < selected.index)))) {
      selected = candidate;
      selectedToward = towardDistance;
    }
  }
  return selected ? cellPoint(grid, selected.index) : null;
}

function bottleneckOf(grid, path) {
  if (!path?.indices?.length) return null;
  let index = path.indices[0];
  let width = grid.clearanceMm[index];
  for (const candidate of path.indices) {
    const value = grid.clearanceMm[candidate];
    if (value < width) { width = value; index = candidate; }
  }
  const tolerance = grid.cell * 2;
  let cells = 0;
  for (const candidate of path.indices) if (grid.clearanceMm[candidate] <= width + tolerance) cells += 1;
  return {
    ...cellPoint(grid, index),
    clearanceMm: width,
    segmentLengthMm: cells * grid.cell,
    measurementDefinition: 'configuration_space_cross_section',
  };
}

function routeBase(route, frequency, source) {
  return {
    id: route.id,
    source,
    scenarioId: route.scenarioId || null,
    routeId: route.routeId || route.connectionId || null,
    title: route.title || route.routeId || route.connectionId || 'Маршрут',
    levelId: route.levelId || splitRoomKey(route.fromRoomKey).levelId || null,
    status: 'unknown',
    evidence: 'unknown',
    points: [], segments: [],
    lengthMm: null, minWidthMm: null, bottleneck: null,
    frequency: frequency || { known: false, value: null, period: null },
    reasonCode: null, reason: '',
  };
}

function analyzeRoute(route, frequency, source, levels, profileWidthMm, searchBudget = null) {
  const result = routeBase(route, frequency, source);
  if (route.status === 'missing') {
    const missingData = route.reasonCode === 'missing_endpoint';
    return {
      ...result,
      status: missingData ? 'unknown' : 'blocked',
      evidence: missingData ? 'unknown' : 'topology',
      reasonCode: route.reasonCode || 'no_passage',
      reason: route.reason || (missingData
        ? 'Одно из помещений маршрута не найдено.'
        : 'Между помещениями нет подтверждённого прохода.'),
    };
  }
  if (!['co_located', 'direct', 'reachable'].includes(route.status)) return {
    ...result, reasonCode: route.reasonCode || 'topology_unknown',
    reason: route.reason || 'Топология маршрута не подтверждена.',
  };
  const pathKeys = array(route.pathRoomKeys);
  if (!pathKeys.length) return { ...result, reasonCode: 'rooms_unknown', reason: 'Помещения маршрута не заданы.' };
  const levelIds = new Set(pathKeys.map((key) => splitRoomKey(key).levelId).filter(Boolean));
  if (levelIds.size !== 1) return {
    ...result, reasonCode: 'vertical_connector_unknown',
    reason: 'Межэтажная геометрия лестницы или лифта не задана.',
  };
  const levelId = [...levelIds][0];
  const level = levels.get(levelId);
  if (!level) return { ...result, reasonCode: 'level_missing', reason: 'Этаж маршрута не найден.' };
  if (level.budgetExceeded) return {
    ...result, levelId, reasonCode: 'analysis_budget_exceeded',
    reason: 'Сетка этажа превышает безопасный бюджет анализа.',
  };
  const rooms = pathKeys.map((key) => level.rooms.get(splitRoomKey(key).roomId));
  if (rooms.some((room) => !room)) return {
    ...result, levelId, reasonCode: 'room_missing', reason: 'Одно из помещений маршрута не найдено.',
  };
  const minimumSearchCost = rooms.reduce((sum, room) => (
    sum + (level.grids.get(room.id)?.free.length || 0)
  ), 0);
  if (searchBudget && (searchBudget.searches + rooms.length > searchBudget.maxSearches
    || searchBudget.expandedCells + minimumSearchCost > searchBudget.maxExpandedCells)) {
    searchBudget.exceeded = true;
    return {
      ...result, levelId, reasonCode: 'analysis_budget_exceeded',
      reason: 'Маршрут оставлен неизвестным: исчерпан безопасный бюджет поиска пути.',
    };
  }
  const transitions = array(route.transitions);
  if (pathKeys.length > 1 && transitions.length !== pathKeys.length - 1) return {
    ...result, levelId, reasonCode: 'transition_geometry_missing',
    reason: 'Для части переходов нет геометрии двери или открытой границы.',
  };
  const portals = transitions.map((transition) => transitionPortal(level, transition));
  if (portals.some((portal) => !portal)) return {
    ...result, levelId, reasonCode: 'transition_geometry_missing',
    reason: 'Один из переходов не имеет подтверждённого дверного портала.',
  };
  if (portals.some((portal) => !finite(portal.widthMm))) return {
    ...result, levelId, reasonCode: 'door_width_unknown',
    reason: 'Чистая ширина одного из дверных порталов неизвестна.',
  };

  const fromAnchor = endpointAnchor(level, rooms[0], route.fromEndpoint || splitRoomKey(route.fromRoomKey));
  const toAnchor = endpointAnchor(level, rooms[rooms.length - 1], route.toEndpoint || splitRoomKey(route.toRoomKey));
  if (fromAnchor.status === 'unknown' || toAnchor.status === 'unknown') return {
    ...result, levelId, reasonCode: fromAnchor.reason || toAnchor.reason,
    reason: 'Выбранная конечная точка маршрута не найдена в помещении.',
  };
  if ([fromAnchor, toAnchor].some((anchor) => anchor.type === 'opening' && !finite(anchor.widthMm))) {
    return {
      ...result, levelId, reasonCode: 'door_width_unknown',
      reason: 'Чистая ширина выбранной двери неизвестна.',
    };
  }
  if (rooms.length === 1 && fromAnchor.status !== 'exact' && toAnchor.status !== 'exact') return {
    ...result, levelId, reasonCode: 'anchor_position_unknown',
    reason: 'Для маршрута внутри одного помещения нужны точные конечные объекты.',
  };

  const evidenceCandidate = fromAnchor.status !== 'exact' || toAnchor.status !== 'exact'
    || portals.some((portal) => portal.ambiguous);
  const endpointOpenings = [fromAnchor, toAnchor]
    .filter((anchor) => anchor.type === 'opening' && finite(anchor.widthMm))
    .map((anchor) => ({
      widthMm: Number(anchor.widthMm),
      point: anchor.point,
      openingId: anchor.id,
    }));
  const transitionOpenings = portals.map((portal, index) => ({
    widthMm: Number(portal.widthMm),
    point: portal.pointFor(rooms[index]),
    openingId: portal.openingId,
  }));
  const limitingOpening = [...transitionOpenings, ...endpointOpenings]
    .filter((opening) => finite(opening.widthMm))
    .sort((a, b) => a.widthMm - b.widthMm)[0];
  if (limitingOpening?.widthMm < profileWidthMm) return {
    ...result,
    levelId,
    status: 'blocked',
    evidence: evidenceCandidate ? 'candidate' : 'exact',
    minWidthMm: Math.round(limitingOpening.widthMm),
    bottleneck: {
      ...limitingOpening.point,
      clearanceMm: limitingOpening.widthMm,
      segmentLengthMm: level.cell,
      measurementDefinition: 'opening_clear_width',
      openingId: limitingOpening.openingId,
    },
    reasonCode: 'profile_does_not_fit',
    reason: `Расчётный профиль ${profileWidthMm} мм шире дверного прохода.`,
  };
  const segments = [];
  let blocked = false;
  let totalLength = 0;
  let minimum = Infinity;
  let bottleneck = null;
  const allPoints = [];
  for (let index = 0; index < rooms.length; index += 1) {
    const room = rooms[index];
    const key = pathKeys[index];
    const grid = level.grids.get(room.id);
    if (!grid) return {
      ...result, levelId, reasonCode: 'analysis_budget_exceeded',
      reason: 'Для помещения не построена безопасная сетка анализа.',
    };
    const rawStart = index === 0 ? fromAnchor.point : portals[index - 1].pointFor(room);
    const rawEnd = index === rooms.length - 1 ? toAnchor.point : portals[index].pointFor(room);
    const start = index === 0
      ? anchorPointForGrid(grid, fromAnchor, profileWidthMm, rawEnd, searchBudget)
      : anchorPointForGrid(grid, {
        type: 'opening', id: `portal:${portals[index - 1].id}`, point: rawStart,
      }, profileWidthMm, rawEnd, searchBudget);
    const end = index === rooms.length - 1
      ? anchorPointForGrid(grid, toAnchor, profileWidthMm, rawStart, searchBudget)
      : anchorPointForGrid(grid, {
        type: 'opening', id: `portal:${portals[index].id}`, point: rawEnd,
      }, profileWidthMm, rawStart, searchBudget);
    if (start?.budgetExceeded || end?.budgetExceeded) return {
      ...result, levelId, reasonCode: 'analysis_budget_exceeded',
      reason: 'Маршрут оставлен неизвестным: исчерпан безопасный бюджет поиска точек подхода.',
    };
    if (!start || !end) {
      const portalApproachMissing = (index > 0 && !start)
        || (index < rooms.length - 1 && !end);
      return {
        ...result,
        levelId,
        status: portalApproachMissing ? 'blocked' : 'unknown',
        evidence: evidenceCandidate ? 'candidate' : 'exact',
        reasonCode: portalApproachMissing ? 'portal_approach_blocked' : 'endpoint_geometry_missing',
        reason: portalApproachMissing
          ? 'Подход расчётного профиля к дверному порталу перекрыт.'
          : 'Не удалось определить точку подхода внутри помещения.',
      };
    }
    const profilePath = searchGrid(grid, start, end, profileWidthMm, searchBudget);
    if (profilePath?.budgetExceeded) return {
      ...result, levelId, reasonCode: 'analysis_budget_exceeded',
      reason: 'Маршрут оставлен неизвестным: исчерпан безопасный бюджет поиска пути.',
    };
    const pointPath = profilePath || searchGrid(grid, start, end, 0, searchBudget);
    if (pointPath?.budgetExceeded) return {
      ...result, levelId, reasonCode: 'analysis_budget_exceeded',
      reason: 'Маршрут оставлен неизвестным: исчерпан безопасный бюджет поиска пути.',
    };
    if (!pointPath) {
      blocked = true;
      segments.push({ roomKey: key, status: 'blocked', points: [], lengthMm: null, minWidthMm: 0 });
      continue;
    }
    const neck = bottleneckOf(grid, pointPath);
    const segment = {
      roomKey: key,
      status: profilePath ? 'clear' : 'blocked',
      points: pointPath.points,
      cellIndices: pointPath.indices,
      lengthMm: Math.round(pointPath.lengthMm),
      minWidthMm: neck?.clearanceMm ?? null,
      bottleneck: neck,
      fromPortalId: index ? portals[index - 1].id : null,
      toPortalId: index < portals.length ? portals[index].id : null,
    };
    segments.push(segment);
    if (!profilePath) blocked = true;
    totalLength += pointPath.lengthMm;
    if (finite(neck?.clearanceMm) && neck.clearanceMm < minimum) {
      minimum = neck.clearanceMm;
      bottleneck = neck;
    }
    allPoints.push(...pointPath.points);
  }
  portals.forEach((portal) => {
    if (portal.widthMm < minimum) {
      minimum = portal.widthMm;
      const transitionIndex = portals.indexOf(portal);
      const point = portal.pointFor(rooms[transitionIndex]);
      bottleneck = {
        ...point, clearanceMm: portal.widthMm, segmentLengthMm: level.cell,
        measurementDefinition: 'configuration_space_cross_section',
        openingId: portal.openingId,
      };
    }
  });
  endpointOpenings.forEach((opening) => {
    if (opening.widthMm < minimum) {
      minimum = opening.widthMm;
      bottleneck = {
        ...opening.point,
        clearanceMm: opening.widthMm,
        segmentLengthMm: level.cell,
        measurementDefinition: 'opening_clear_width',
        openingId: opening.openingId,
      };
    }
  });
  if (blocked) return {
    ...result, levelId, status: 'blocked', evidence: evidenceCandidate ? 'candidate' : 'exact',
    points: [], segments, lengthMm: Math.round(totalLength),
    minWidthMm: Number.isFinite(minimum) ? Math.round(minimum) : 0, bottleneck,
    reasonCode: 'profile_does_not_fit',
    reason: `Расчётный профиль ${profileWidthMm} мм не проходит по текущей геометрии.`,
  };
  const minWidthMm = Number.isFinite(minimum) ? Math.round(minimum) : null;
  const status = evidenceCandidate ? 'approximate'
    : minWidthMm < Math.max(profileWidthMm, ERGO_NORMS.passage.need) ? 'narrow' : 'clear';
  return {
    ...result, levelId, status, evidence: evidenceCandidate ? 'candidate' : 'exact',
    points: allPoints, segments, lengthMm: Math.round(totalLength), minWidthMm, bottleneck,
    reasonCode: evidenceCandidate ? 'anchor_position_approximate' : status === 'narrow' ? 'narrow' : 'clear',
    reason: evidenceCandidate
      ? 'Конечная функция привязана только к помещению; путь до опорной точки приблизительный.'
      : status === 'narrow'
        ? `Маршрут проходит для профиля ${profileWidthMm} мм, но остаётся тесным.`
        : `Маршрут рассчитан для профиля ${profileWidthMm} мм.`,
  };
}

function flattenRoutes(flows) {
  const result = array(flows?.functionalRoutes).map((route) => ({
    route, source: 'functional', frequency: { known: false, value: null, period: null },
  }));
  for (const scenario of array(flows?.scenarios)) {
    for (const route of array(scenario.routes)) result.push({
      route, source: 'scenario',
      frequency: scenario.frequency || { known: false, value: null, period: null },
    });
  }
  return result.sort((a, b) => String(a.route.id).localeCompare(String(b.route.id)));
}

function publicGrid(grid) {
  return {
    x0: grid.x0, y0: grid.y0, cols: grid.cols, rows: grid.rows, cell: grid.cell,
    free: grid.free, clearanceMm: grid.clearanceMm,
  };
}

function aggregateHeat(level, routes) {
  const cells = new Map();
  let unknownFrequencyRouteCount = 0;
  for (const route of routes) {
    if (!['clear', 'narrow', 'approximate'].includes(route.status)) continue;
    const exactFrequency = route.source === 'scenario' && route.evidence === 'exact';
    if (exactFrequency && !route.frequency?.known) unknownFrequencyRouteCount += 1;
    for (const segment of route.segments) {
      const grid = level.grids.get(splitRoomKey(segment.roomKey).roomId);
      if (!grid) continue;
      for (const index of array(segment.cellIndices)) {
        const key = `${segment.roomKey}:${index}`;
        if (!cells.has(key)) cells.set(key, {
          key, roomKey: segment.roomKey, index,
          ...cellPoint(grid, index), cell: grid.cell,
          routeCount: 0, approximateRouteCount: 0, frequencyByPeriod: {},
        });
        const cell = cells.get(key);
        cell.routeCount += 1;
        if (route.evidence !== 'exact') cell.approximateRouteCount += 1;
        if (exactFrequency && route.frequency.known) {
          const period = route.frequency.period;
          cell.frequencyByPeriod[period] = (cell.frequencyByPeriod[period] || 0)
            + route.frequency.value;
        }
      }
    }
  }
  const list = [...cells.values()].sort((a, b) => a.roomKey.localeCompare(b.roomKey) || a.index - b.index);
  const periods = [...new Set(list.flatMap((cell) => Object.keys(cell.frequencyByPeriod)))].sort();
  return {
    cells: list,
    periods,
    unknownFrequencyRouteCount,
    maxRouteCount: Math.max(0, ...list.map((cell) => cell.routeCount)),
    maxFrequencyByPeriod: Object.fromEntries(periods.map((period) => [
      period, Math.max(0, ...list.map((cell) => cell.frequencyByPeriod[period] || 0)),
    ])),
  };
}

/**
 * Построить детальные внутрипомещенные маршруты по текущей расстановке.
 * Производный результат не мутирует проект и не должен сохраняться в файл.
 */
export function analyzeHomeCirculation(project = {}, {
  flows = null,
  profileWidthMm = 600,
  cellMm = ERGO_CELL,
  maxCells = 250000,
  maxRouteSearches = 256,
  maxExpandedCells = 1_000_000,
  maxAnchorChecks = 20_000,
} = {}) {
  const width = clampProfile(profileWidthMm);
  const cell = clampCell(cellMm);
  const flowResult = flows || analyzeHomeFlows(project);
  const routeInputs = flattenRoutes(flowResult);
  const referencedRooms = new Set(routeInputs.flatMap(({ route }) => array(route?.pathRoomKeys)));
  const levels = new Map();
  const searchBudget = {
    searches: 0,
    expandedCells: 0,
    anchorChecks: 0,
    maxSearches: Math.max(1, Math.floor(Number(maxRouteSearches) || 256)),
    maxExpandedCells: Math.max(1, Math.floor(Number(maxExpandedCells) || 1_000_000)),
    maxAnchorChecks: Math.max(1, Math.floor(Number(maxAnchorChecks) || 20_000)),
    exceeded: false,
  };
  let usedCells = 0;
  let budgetExceeded = false;
  for (const sourceLevel of array(project?.levels)) {
    const view = levelProject(project, sourceLevel.id);
    const walls = deriveWalls(view);
    const record = {
      levelId: sourceLevel.id,
      view,
      walls,
      cell,
      profileWidthMm: width,
      rooms: new Map(array(sourceLevel.rooms).map((room) => [room.id, room])),
      items: new Map(array(sourceLevel.items).map((item) => [item.id, item])),
      openings: new Map(array(sourceLevel.openings).map((opening) => [opening.id, opening])),
      grids: new Map(),
      budgetExceeded: false,
    };
    for (const room of array(sourceLevel.rooms)
      .filter((candidate) => referencedRooms.has(roomKey(sourceLevel.id, candidate.id)))
      .slice().sort((a, b) => String(a.id).localeCompare(String(b.id)))) {
      const count = projectedCells(room, cell);
      if (usedCells + count > maxCells) {
        record.budgetExceeded = true;
        budgetExceeded = true;
        break;
      }
      const grid = buildRoomWalkGrid(view, room, walls, { cellMm: cell });
      usedCells += grid.free.length;
      record.grids.set(room.id, grid);
    }
    levels.set(sourceLevel.id, record);
  }

  const routes = routeInputs.map(({ route, source, frequency }) => (
    analyzeRoute(route, frequency, source, levels, width, searchBudget)
  ));
  const levelResults = [...levels.values()].map((level) => {
    const levelRoutes = routes.filter((route) => route.levelId === level.levelId);
    return {
      levelId: level.levelId,
      rooms: [...level.grids.entries()].map(([roomId, grid]) => ({
        roomKey: roomKey(level.levelId, roomId),
        grid: publicGrid(grid),
      })),
      routes: levelRoutes,
      heat: aggregateHeat(level, levelRoutes),
      budgetExceeded: level.budgetExceeded,
    };
  });
  const counts = Object.fromEntries(['clear', 'narrow', 'approximate', 'blocked', 'unknown']
    .map((status) => [status, routes.filter((route) => route.status === status).length]));
  const knownWidths = routes.map((route) => route.minWidthMm).filter(finite).map(Number);
  const warnings = [
    `Ширина и путь рассчитаны по сетке ${cell} мм; это геометрическая оценка, а не нормативный обмер.`,
    'Динамические состояния дверей и перемещаемой мебели требуют отдельной проверки.',
  ];
  if (routes.some((route) => route.status === 'approximate')) {
    warnings.push('Часть конечных функций не привязана к конкретной мебели или двери; такие маршруты приблизительные.');
  }
  if (levelResults.some((level) => level.heat.unknownFrequencyRouteCount)) {
    warnings.push('Маршруты с неизвестной частотой не включены в числовую нагрузку.');
  }
  if (budgetExceeded) warnings.push('Часть этажей превышает безопасный бюджет сетки и оставлена неизвестной.');
  if (searchBudget.exceeded) warnings.push('Часть маршрутов оставлена неизвестной из-за безопасного бюджета поиска пути.');
  const status = counts.blocked ? 'blocked'
    : counts.unknown || counts.approximate ? 'unknown'
      : counts.narrow ? 'narrow'
        : counts.clear ? 'clear' : 'unknown';
  return {
    status,
    profile: {
      widthMm: width,
      cellMm: cell,
      comfortableWidthMm: ERGO_NORMS.passage.need,
      source: 'analysis_setting',
    },
    levels: levelResults,
    routes,
    summary: {
      routeCount: routes.length,
      ...counts,
      minWidthMm: knownWidths.length ? Math.min(...knownWidths) : null,
      analyzedCellCount: usedCells,
      routeSearchCount: searchBudget.searches,
      expandedCellBudgetUsed: searchBudget.expandedCells,
      anchorCandidateCheckCount: searchBudget.anchorChecks,
      budgetExceeded: budgetExceeded || searchBudget.exceeded,
    },
    warnings,
  };
}
