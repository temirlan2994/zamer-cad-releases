// Операции над комнатами: проверка размещения, привязка/стыковка, вложение,
// перемещение, площади и анализ связности помещений. Чистый модуль.

import { DEFAULT_PARTITION, DEFAULT_EXTERIOR, GRID_STEP } from './catalog.js';
import { deriveWalls, doorLink, findAdjacencies } from './walls.js';
import { checkRectBuildable } from './site.js';

export const MIN_ROOM_SIZE = 900;

export function rectsOverlap(a, b, eps = 1) {
  return a.x + a.w > b.x + eps && b.x + b.w > a.x + eps && a.y + a.h > b.y + eps && b.y + b.h > a.y + eps;
}

export function rectInside(inner, outer, eps = 1) {
  return inner.x >= outer.x - eps && inner.y >= outer.y - eps &&
    inner.x + inner.w <= outer.x + outer.w + eps && inner.y + inner.h <= outer.y + outer.h + eps;
}

function roomRect(room) {
  return { x: room.x, y: room.y, w: room.w, h: room.h };
}

// Внешний габарит вложенной комнаты (с её стенами) — занимает место в родителе.
export function nestedOuterRect(room, partition = DEFAULT_PARTITION) {
  return { x: room.x - partition, y: room.y - partition, w: room.w + partition * 2, h: room.h + partition * 2 };
}

function siblings(project, parentId, excludeId) {
  return project.rooms.filter((r) => (r.parentId || null) === (parentId || null) && r.id !== excludeId);
}

// Определяет родителя для прямоугольника: комната верхнего уровня, целиком
// вмещающая rect с запасом на стены. Вложенность только в один уровень.
export function determineParent(project, rect, excludeId, partition = DEFAULT_PARTITION) {
  const margin = partition;
  for (const room of project.rooms) {
    if (room.id === excludeId || room.parentId) continue;
    const inner = roomRect(room);
    const needed = { x: rect.x - margin, y: rect.y - margin, w: rect.w + margin * 2, h: rect.h + margin * 2 };
    if (rectInside(needed, inner)) return room.id;
  }
  return null;
}

// Проверка размещения комнаты. candidate: {x, y, w, h, parentId}.
export function validateRoomPlacement(project, candidate, excludeId) {
  const partition = project.settings?.partition || DEFAULT_PARTITION;
  if (candidate.w < MIN_ROOM_SIZE || candidate.h < MIN_ROOM_SIZE) {
    return { ok: false, reason: `Минимальный размер помещения — ${MIN_ROOM_SIZE} мм` };
  }
  const rect = { x: candidate.x, y: candidate.y, w: candidate.w, h: candidate.h };

  if (candidate.parentId) {
    const parent = project.rooms.find((r) => r.id === candidate.parentId);
    if (!parent) return { ok: false, reason: 'Родительская комната не найдена' };
    if (parent.parentId) return { ok: false, reason: 'Вложенность глубже одного уровня не поддерживается' };
    const outer = nestedOuterRect(candidate, partition);
    if (!rectInside(outer, roomRect(parent))) {
      return { ok: false, reason: `Не помещается внутри «${parent.name}» вместе со стенами` };
    }
  }

  for (const other of siblings(project, candidate.parentId, excludeId)) {
    const o = roomRect(other);
    if (rectsOverlap(rect, o)) {
      return { ok: false, reason: `Пересекается с «${other.name}»` };
    }
    // Узкая щель между комнатами (меньше толщины стены) недопустима.
    const gapX = Math.max(o.x - (rect.x + rect.w), rect.x - (o.x + o.w));
    const gapY = Math.max(o.y - (rect.y + rect.h), rect.y - (o.y + o.h));
    const overlapX = Math.min(rect.x + rect.w, o.x + o.w) - Math.max(rect.x, o.x);
    const overlapY = Math.min(rect.y + rect.h, o.y + o.h) - Math.max(rect.y, o.y);
    if (overlapY > 1 && gapX > 0.5 && gapX < partition - 0.5) {
      return { ok: false, reason: `Слишком узкий зазор до «${other.name}» (минимум ${partition} мм — толщина стены)` };
    }
    if (overlapX > 1 && gapY > 0.5 && gapY < partition - 0.5) {
      return { ok: false, reason: `Слишком узкий зазор до «${other.name}» (минимум ${partition} мм — толщина стены)` };
    }
  }

  // Зона застройки участка: дом (комнаты верхнего уровня вместе с наружными
  // стенами) можно чертить только внутри неё.
  if (!candidate.parentId && project.site?.boundary) {
    const t = project.settings?.exterior || DEFAULT_EXTERIOR;
    const outer = { x: rect.x - t, y: rect.y - t, w: rect.w + t * 2, h: rect.h + t * 2 };
    const buildable = checkRectBuildable(project.site, outer);
    if (!buildable.ok) return buildable;
  }
  return { ok: true };
}

// Привязка позиции при перетаскивании: стыковка к соседям (зазор = стена),
// выравнивание кромок, затем сетка. Возвращает новые x, y и направляющие.
export function snapRoomPosition(project, moving, x, y, snapDist, parentId) {
  const partition = project.settings?.partition || DEFAULT_PARTITION;
  const guides = [];
  let bestX = null;
  let bestY = null;

  const considerX = (value, dist, guide) => {
    if (dist <= snapDist && (!bestX || dist < bestX.dist)) bestX = { value, dist, guide };
  };
  const considerY = (value, dist, guide) => {
    if (dist <= snapDist && (!bestY || dist < bestY.dist)) bestY = { value, dist, guide };
  };

  for (const other of siblings(project, parentId, moving.id)) {
    const o = roomRect(other);
    // Стыковка: кромка к кромке через толщину стены.
    considerX(o.x + o.w + partition, Math.abs(x - (o.x + o.w + partition)), { type: 'dock', other });
    considerX(o.x - moving.w - partition, Math.abs(x - (o.x - moving.w - partition)), { type: 'dock', other });
    considerY(o.y + o.h + partition, Math.abs(y - (o.y + o.h + partition)), { type: 'dock', other });
    considerY(o.y - moving.h - partition, Math.abs(y - (o.y - moving.h - partition)), { type: 'dock', other });
    // Выравнивание кромок.
    considerX(o.x, Math.abs(x - o.x), { type: 'align', axis: 'v', at: o.x });
    considerX(o.x + o.w - moving.w, Math.abs(x - (o.x + o.w - moving.w)), { type: 'align', axis: 'v', at: o.x + o.w });
    considerY(o.y, Math.abs(y - o.y), { type: 'align', axis: 'h', at: o.y });
    considerY(o.y + o.h - moving.h, Math.abs(y - (o.y + o.h - moving.h)), { type: 'align', axis: 'h', at: o.y + o.h });
  }

  if (parentId) {
    const parent = project.rooms.find((r) => r.id === parentId);
    if (parent) {
      // Прижать к внутренним граням родителя (стены вложенной комнаты внутри).
      considerX(parent.x + partition, Math.abs(x - (parent.x + partition)), { type: 'parent' });
      considerX(parent.x + parent.w - moving.w - partition, Math.abs(x - (parent.x + parent.w - moving.w - partition)), { type: 'parent' });
      considerY(parent.y + partition, Math.abs(y - (parent.y + partition)), { type: 'parent' });
      considerY(parent.y + parent.h - moving.h - partition, Math.abs(y - (parent.y + parent.h - moving.h - partition)), { type: 'parent' });
    }
  }

  const outX = bestX ? bestX.value : Math.round(x / GRID_STEP) * GRID_STEP;
  const outY = bestY ? bestY.value : Math.round(y / GRID_STEP) * GRID_STEP;
  if (bestX?.guide) guides.push(bestX.guide);
  if (bestY?.guide) guides.push(bestY.guide);
  return { x: outX, y: outY, guides };
}

// Перемещение комнаты вместе с вложенными помещениями и мебелью, которая
// фактически стоит внутри (мебель свободна и не привязана к комнате — едет
// то, что находится внутри на момент перемещения). Проёмы хранятся
// относительно комнаты, их двигать не нужно.
export function moveRoomBy(project, roomId, dx, dy) {
  const moved = new Set([roomId]);
  for (const r of project.rooms) if (r.parentId === roomId) moved.add(r.id);
  const rects = project.rooms
    .filter((r) => moved.has(r.id))
    .map((r) => ({ x: r.x, y: r.y, w: r.w, h: r.h }));
  for (const r of project.rooms) {
    if (moved.has(r.id)) { r.x += dx; r.y += dy; }
  }
  for (const item of project.items) {
    const inside = rects.some((r) => item.x >= r.x && item.x <= r.x + r.w && item.y >= r.y && item.y <= r.y + r.h);
    if (inside) { item.x += dx; item.y += dy; }
  }
}

// Чистая площадь: внутренняя минус габариты вложенных помещений (со стенами).
export function roomNetAreaM2(project, room) {
  const partition = project.settings?.partition || DEFAULT_PARTITION;
  let area = room.w * room.h;
  for (const child of project.rooms) {
    if (child.parentId !== room.id) continue;
    if (child.takesArea === false) continue; // площадь родителя не уменьшается
    const outer = nestedOuterRect(child, partition);
    const ix = Math.min(room.x + room.w, outer.x + outer.w) - Math.max(room.x, outer.x);
    const iy = Math.min(room.y + room.h, outer.y + outer.h) - Math.max(room.y, outer.y);
    if (ix > 0 && iy > 0) area -= ix * iy;
  }
  return area / 1_000_000;
}

export function totalAreaM2(project) {
  let total = 0;
  for (const room of project.rooms) total += roomNetAreaM2(project, room);
  return total;
}

// Анализ связности: каждая комната должна быть достижима от входной двери.
// Двери создают рёбра графа (комната-комната или комната-улица).
export function analyzeConnectivity(project, walls = null) {
  const graph = new Map(); // id -> Set(id)
  const addEdge = (a, b) => {
    if (!graph.has(a)) graph.set(a, new Set());
    if (!graph.has(b)) graph.set(b, new Set());
    graph.get(a).add(b);
    graph.get(b).add(a);
  };
  const resolvedWalls = walls || deriveWalls(project);
  for (const opening of project.openings) {
    const link = doorLink(project, opening, resolvedWalls);
    if (link) addEdge(link[0], link[1]);
  }

  const hasEntrance = graph.has('outside');
  const start = hasEntrance ? 'outside' : project.rooms[0]?.id;
  const reachable = new Set();
  if (start !== undefined) {
    const queue = [start];
    reachable.add(start);
    while (queue.length) {
      const node = queue.shift();
      for (const next of graph.get(node) || []) {
        if (!reachable.has(next)) { reachable.add(next); queue.push(next); }
      }
    }
  }

  const unreachable = project.rooms.filter((r) => !reachable.has(r.id)).map((r) => r.id);
  return { hasEntrance, reachable, unreachable, graph };
}

// Подсказка, где добавить дверь для недостижимой комнаты: самая длинная общая
// стена с достижимой комнатой (или родителем). Коридоры программа только
// предлагает — никогда не строит сама.
export function suggestAccess(project, roomId, analysis) {
  const room = project.rooms.find((r) => r.id === roomId);
  if (!room) return null;
  if (room.parentId) {
    const parent = project.rooms.find((r) => r.id === room.parentId);
    return { targetId: room.parentId, text: `Добавьте дверь между «${room.name}» и «${parent?.name || 'родителем'}»` };
  }
  const adjacencies = findAdjacencies(project.rooms)
    .filter((a) => a.a.id === roomId || a.b.id === roomId)
    .sort((p, q) => (q.to - q.from) - (p.to - p.from));
  for (const adj of adjacencies) {
    const other = adj.a.id === roomId ? adj.b : adj.a;
    return { targetId: other.id, text: `Добавьте дверь между «${room.name}» и «${other.name}»` };
  }
  return { targetId: null, text: `«${room.name}» ни с чем не граничит — пристыкуйте её к дому или добавьте коридор` };
}
