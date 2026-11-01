// Операции над комнатами: проверка размещения, привязка/стыковка, вложение,
// перемещение, площади и анализ связности помещений. Чистый модуль.

import { DEFAULT_PARTITION, DEFAULT_EXTERIOR, GRID_STEP } from './catalog.js';
import { deriveWalls, doorLink, findAdjacencies } from './walls.js';
import { checkRectBuildable } from './site.js';
import { rectCornersWorld } from './building.js';
import { isUpperLevel } from './model.js';

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

  // Комнаты верхнего уровня могут перекрываться (одна «съедает» площадь другой);
  // вложенные комнаты пересекаться между собой не должны.
  const allowOverlap = !candidate.parentId;
  for (const other of siblings(project, candidate.parentId, excludeId)) {
    const o = roomRect(other);
    if (allowOverlap) continue;
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
    // Комнаты — в осях дома, участок — в координатах съёмки: проверяем
    // настоящие (повёрнутые) углы дома.
    const buildable = checkRectBuildable(project.site, outer, rectCornersWorld(project.building, outer));
    // Отступы от границы/соседа — МЯГКОЕ правило: ставить можно, но с
    // предупреждением (не жёсткий запрет).
    if (!buildable.ok) return { ok: true, warning: buildable.reason };
  }
  return { ok: true };
}

// Первое предупреждение участка (зона застройки, отступы от соседей) для
// дома целиком или null — например, после поворота дома.
export function siteWarning(project) {
  for (const room of project.rooms) {
    if (room.parentId) continue;
    const verdict = validateRoomPlacement(project, room, room.id);
    if (verdict.warning) return verdict.warning;
  }
  return null;
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

// Площадь объединения набора прямоугольников (координатное сжатие).
function rectUnionArea(rects) {
  if (!rects.length) return 0;
  const xs = [...new Set(rects.flatMap((r) => [r.x, r.x + r.w]))].sort((a, b) => a - b);
  let total = 0;
  for (let i = 0; i < xs.length - 1; i += 1) {
    const x1 = xs[i];
    const x2 = xs[i + 1];
    const stripW = x2 - x1;
    if (stripW <= 0) continue;
    const ys = [];
    for (const r of rects) {
      if (r.x <= x1 + 0.001 && r.x + r.w >= x2 - 0.001) ys.push([r.y, r.y + r.h]);
    }
    ys.sort((a, b) => a[0] - b[0]);
    let covered = 0;
    let curStart = null;
    let curEnd = null;
    for (const [a, b] of ys) {
      if (curStart === null) { curStart = a; curEnd = b; }
      else if (a > curEnd) { covered += curEnd - curStart; curStart = a; curEnd = b; }
      else curEnd = Math.max(curEnd, b);
    }
    if (curStart !== null) covered += curEnd - curStart;
    total += stripW * covered;
  }
  return total;
}

function intersectRect(a, b) {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const w = Math.min(a.x + a.w, b.x + b.w) - x;
  const h = Math.min(a.y + a.h, b.y + b.h) - y;
  return w > 0 && h > 0 ? { x, y, w, h } : null;
}

// Комнаты верхнего уровня, которые «съедают» данную (идут выше по z = позже в
// массиве и перекрываются с ней).
export function eatersOf(project, room) {
  const idx = project.rooms.indexOf(room);
  const rect = roomRect(room);
  const result = [];
  for (let i = idx + 1; i < project.rooms.length; i += 1) {
    const other = project.rooms[i];
    if (other.parentId || room.parentId) continue;
    const clip = intersectRect(rect, roomRect(other));
    if (clip) result.push(other);
  }
  return result;
}

// Чистая площадь: внутренняя минус габариты вложенных помещений (со стенами)
// и минус область, «съеденная» перекрывающими комнатами поверх этой.
export function roomNetAreaM2(project, room) {
  const partition = project.settings?.partition || DEFAULT_PARTITION;
  let area = room.w * room.h;
  const subtractRects = [];
  for (const child of project.rooms) {
    if (child.parentId !== room.id) continue;
    if (child.takesArea === false) continue; // площадь родителя не уменьшается
    const outer = nestedOuterRect(child, partition);
    const clip = intersectRect(roomRect(room), outer);
    if (clip) subtractRects.push(clip);
  }
  // Перекрытие комнатами, стоящими поверх (eaters).
  for (const eater of eatersOf(project, room)) {
    const clip = intersectRect(roomRect(room), roomRect(eater));
    if (clip) subtractRects.push(clip);
  }
  area -= rectUnionArea(subtractRects);
  return Math.max(0, area) / 1_000_000;
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

  // На верхних этажах вход — лестница: помещения «Лестница» ведут на этаж
  // ниже, поэтому служат точкой входа наравне с наружной дверью.
  if (project.levels && isUpperLevel(project)) {
    for (const room of project.rooms) if (room.type === 'stairs-room') addEdge('stairs', room.id);
  }
  const sources = ['outside', 'stairs'].filter((n) => graph.has(n));
  const hasEntrance = sources.length > 0;
  if (!hasEntrance && project.rooms[0]) sources.push(project.rooms[0].id);
  const reachable = new Set();
  if (sources.length) {
    const queue = [...sources];
    for (const s of sources) reachable.add(s);
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

// Рёбра реального внутреннего контура комнаты (прямоугольник минус области,
// «съеденные» перекрывающими комнатами и вложенными помещениями). Для Г- и
// Т-образных комнат даёт все стороны с их настоящими длинами.
// Возвращает { rectangular, edges:[{orient:'v'|'h', at, from, to, inSide}] }.
export function computeRoomEdges(project, room) {
  const partition = project.settings?.partition || DEFAULT_PARTITION;
  const rect = roomRect(room);
  const subs = [];
  if (!room.parentId) {
    for (const eater of eatersOf(project, room)) {
      const clip = intersectRect(rect, roomRect(eater));
      if (clip) subs.push(clip);
    }
  }
  for (const child of project.rooms) {
    if (child.parentId !== room.id || child.takesArea === false) continue;
    const clip = intersectRect(rect, nestedOuterRect(child, partition));
    if (clip) subs.push(clip);
  }
  const rectangular = subs.length === 0;

  const xs = [...new Set([rect.x, rect.x + rect.w, ...subs.flatMap((s) => [s.x, s.x + s.w])])]
    .filter((v) => v >= rect.x - 0.5 && v <= rect.x + rect.w + 0.5).sort((a, b) => a - b);
  const ys = [...new Set([rect.y, rect.y + rect.h, ...subs.flatMap((s) => [s.y, s.y + s.h])])]
    .filter((v) => v >= rect.y - 0.5 && v <= rect.y + rect.h + 0.5).sort((a, b) => a - b);
  const nx = xs.length - 1;
  const ny = ys.length - 1;
  const inside = (i, j) => {
    if (i < 0 || j < 0 || i >= nx || j >= ny) return false;
    const cx = (xs[i] + xs[i + 1]) / 2;
    const cy = (ys[j] + ys[j + 1]) / 2;
    for (const s of subs) {
      if (cx > s.x + 0.5 && cx < s.x + s.w - 0.5 && cy > s.y + 0.5 && cy < s.y + s.h - 0.5) return false;
    }
    return true;
  };

  // Единичные граничные рёбра.
  const vert = []; // {at, from, to, inSide}
  for (let i = 0; i <= nx; i += 1) {
    for (let j = 0; j < ny; j += 1) {
      const left = inside(i - 1, j);
      const right = inside(i, j);
      if (left === right) continue;
      vert.push({ at: xs[i], from: ys[j], to: ys[j + 1], inSide: right ? 1 : -1 });
    }
  }
  const horiz = [];
  for (let j = 0; j <= ny; j += 1) {
    for (let i = 0; i < nx; i += 1) {
      const up = inside(i, j - 1);
      const down = inside(i, j);
      if (up === down) continue;
      horiz.push({ at: ys[j], from: xs[i], to: xs[i + 1], inSide: down ? 1 : -1 });
    }
  }

  const merge = (list) => {
    const groups = new Map();
    for (const e of list) {
      const key = `${Math.round(e.at)}|${e.inSide}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(e);
    }
    const out = [];
    for (const [, segs] of groups) {
      segs.sort((a, b) => a.from - b.from);
      let cur = null;
      for (const s of segs) {
        if (cur && Math.abs(s.from - cur.to) < 1) cur.to = s.to;
        else { if (cur) out.push(cur); cur = { ...s }; }
      }
      if (cur) out.push(cur);
    }
    return out;
  };

  const edges = [
    ...merge(vert).map((e) => ({ orient: 'v', ...e })),
    ...merge(horiz).map((e) => ({ orient: 'h', ...e })),
  ];
  return { rectangular, edges };
}

// Рёбра внешнего контура всего дома (объединение прямоугольников комнат
// верхнего уровня, кроме открытых площадок). Для общих наружных размеров.
// expand — выдвижение контура наружу (мм). 0 — по внутренней грани комнат,
// exterior — по наружной грани стен, exterior/2 — по оси наружных стен.
// Раздвигание прямоугольников наружу заодно закрывает зазоры межкомнатных
// стен: соседние комнаты перекрываются, и общий размер включает их толщину.
export function computeBuildingOutline(project, expand = 0) {
  const rects = project.rooms
    .filter((r) => !r.parentId && !r.open)
    .map((r) => {
      const rc = roomRect(r);
      return expand
        ? { x: rc.x - expand, y: rc.y - expand, w: rc.w + 2 * expand, h: rc.h + 2 * expand }
        : rc;
    });
  if (!rects.length) return [];
  return unionEdges(rects);
}

function unionEdges(rects) {
  const xs = [...new Set(rects.flatMap((r) => [r.x, r.x + r.w]))].sort((a, b) => a - b);
  const ys = [...new Set(rects.flatMap((r) => [r.y, r.y + r.h]))].sort((a, b) => a - b);
  const nx = xs.length - 1;
  const ny = ys.length - 1;
  const inside = (i, j) => {
    if (i < 0 || j < 0 || i >= nx || j >= ny) return false;
    const cx = (xs[i] + xs[i + 1]) / 2;
    const cy = (ys[j] + ys[j + 1]) / 2;
    return rects.some((r) => cx > r.x - 0.5 && cx < r.x + r.w + 0.5 && cy > r.y - 0.5 && cy < r.y + r.h + 0.5);
  };
  const vert = [];
  for (let i = 0; i <= nx; i += 1) {
    for (let j = 0; j < ny; j += 1) {
      const left = inside(i - 1, j);
      const right = inside(i, j);
      if (left === right) continue;
      vert.push({ at: xs[i], from: ys[j], to: ys[j + 1], inSide: right ? 1 : -1 });
    }
  }
  const horiz = [];
  for (let j = 0; j <= ny; j += 1) {
    for (let i = 0; i < nx; i += 1) {
      const up = inside(i, j - 1);
      const down = inside(i, j);
      if (up === down) continue;
      horiz.push({ at: ys[j], from: xs[i], to: xs[i + 1], inSide: down ? 1 : -1 });
    }
  }
  const merge = (list) => {
    const groups = new Map();
    for (const e of list) {
      const key = `${Math.round(e.at)}|${e.inSide}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(e);
    }
    const out = [];
    for (const [, segs] of groups) {
      segs.sort((a, b) => a.from - b.from);
      let cur = null;
      for (const s of segs) {
        if (cur && Math.abs(s.from - cur.to) < 1) cur.to = s.to;
        else { if (cur) out.push(cur); cur = { ...s }; }
      }
      if (cur) out.push(cur);
    }
    return out;
  };
  return [
    ...merge(vert).map((e) => ({ orient: 'v', ...e })),
    ...merge(horiz).map((e) => ({ orient: 'h', ...e })),
  ];
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
