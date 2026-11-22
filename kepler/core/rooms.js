// Операции над комнатами: проверка размещения, привязка/стыковка, вложение,
// перемещение, площади и анализ связности помещений. Чистый модуль.

import { DEFAULT_PARTITION, DEFAULT_EXTERIOR, GRID_STEP, isOpenRoom, isShaft } from './catalog.js';
import {
  deriveWalls, doorLink, MAX_SHARED_GAP, projectAdjacencies, projectHasManualWalls, sharedWallThickness, wallRects,
} from './walls.js';
import { checkRectBuildable } from './site.js';
import { rectCornersWorld } from './building.js';
import { isUpperLevel } from './model.js';
import { massBox } from './masses.js';
import { slabOpeningCutRects, slabOpenings } from './slab-openings.js';
import {
  roomBoundaryEdges, roomContainsPoint, roomNotchRect, roomRects,
} from './room-shape.js';

export const MIN_ROOM_SIZE = 900;
export const MIN_SHAFT_SIZE = 200;

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
    if (room.id === excludeId || room.parentId || isOpenRoom(room)) continue;
    const needed = { x: rect.x - margin, y: rect.y - margin, w: rect.w + margin * 2, h: rect.h + margin * 2 };
    if (rectInsideRoomShape(needed, room)) return room.id;
  }
  return null;
}

// Проверка размещения комнаты. candidate: {x, y, w, h, parentId}.
export function validateRoomPlacement(project, candidate, excludeId) {
  const partition = project.settings?.partition || DEFAULT_PARTITION;
  const minSize = isShaft(candidate) ? MIN_SHAFT_SIZE : MIN_ROOM_SIZE;
  if (candidate.w < minSize || candidate.h < minSize) {
    return { ok: false, reason: `Минимальный размер ${isShaft(candidate) ? 'шахты' : 'помещения'} — ${minSize} мм` };
  }
  const rect = { x: candidate.x, y: candidate.y, w: candidate.w, h: candidate.h };

  if (candidate.parentId) {
    const parent = project.rooms.find((r) => r.id === candidate.parentId);
    if (!parent) return { ok: false, reason: 'Родительская комната не найдена' };
    if (parent.parentId) return { ok: false, reason: 'Вложенность глубже одного уровня не поддерживается' };
    const outer = nestedOuterRect(candidate, partition);
    if (!rectInsideRoomShape(outer, parent)) {
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
    // Минимум — толщина общей стены этой пары (своя или перегородка).
    const wallT = sharedWallThickness(project, candidate.id || excludeId, other.id);
    if (overlapY > 1 && gapX > 0.5 && gapX < wallT - 0.5) {
      return { ok: false, reason: `Слишком узкий зазор до «${other.name}» (минимум ${wallT} мм — толщина стены)` };
    }
    if (overlapX > 1 && gapY > 0.5 && gapY < wallT - 0.5) {
      return { ok: false, reason: `Слишком узкий зазор до «${other.name}» (минимум ${wallT} мм — толщина стены)` };
    }
  }

  // Зона застройки участка: дом (комнаты верхнего уровня вместе с наружными
  // стенами) можно чертить только внутри неё.
  if (!candidate.parentId && !isShaft(candidate) && project.site?.boundary) {
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
// Радиус магнита стыковки для пары с зазором target: любой зазор 0…MAX_SHARED_GAP
// притягивается к target (помещение перескакивает сразу в корректный зазор,
// не проходя через временные «двойные стены» 400, 300, 200 мм).
export function dockSnapRadius(target, snapDist = 0) {
  return Math.max(snapDist, MAX_SHARED_GAP - target, target);
}

export function snapRoomPosition(project, moving, x, y, snapDist, parentId, grid = GRID_STEP) {
  const partition = project.settings?.partition || DEFAULT_PARTITION;
  const guides = [];
  let bestX = null;
  let bestY = null;

  const considerX = (value, dist, guide, limit = snapDist) => {
    if (dist <= limit && (!bestX || dist < bestX.dist)) bestX = { value, dist, guide };
  };
  const considerY = (value, dist, guide, limit = snapDist) => {
    if (dist <= limit && (!bestY || dist < bestY.dist)) bestY = { value, dist, guide };
  };

  for (const other of siblings(project, parentId, moving.id)) {
    const o = roomRect(other);
    // Стыковка: кромка к кромке через толщину стены.
    const overlapY = Math.min(y + moving.h, o.y + o.h) - Math.max(y, o.y) > 1;
    const overlapX = Math.min(x + moving.w, o.x + o.w) - Math.max(x, o.x) > 1;
    // Зазор стыковки — толщина общей стены этой пары (своя или перегородка).
    // Терраса/балкон общей стены не получает: к закрытой комнате — к
    // наружной грани её стены, к другой открытой площадке — вплотную.
    const movingOpen = isOpenRoom(moving);
    const otherOpen = isOpenRoom(other);
    const gap = movingOpen || otherOpen
      ? (movingOpen && otherOpen ? 0 : Number((movingOpen ? other : moving).walls?.exterior) || project.settings?.exterior || DEFAULT_EXTERIOR)
      : sharedWallThickness(project, moving.id, other.id);
    const dockSnapDist = dockSnapRadius(gap, snapDist);
    if (overlapY) {
      considerX(o.x + o.w + gap, Math.abs(x - (o.x + o.w + gap)), { type: 'dock', other }, dockSnapDist);
      considerX(o.x - moving.w - gap, Math.abs(x - (o.x - moving.w - gap)), { type: 'dock', other }, dockSnapDist);
    }
    if (overlapX) {
      considerY(o.y + o.h + gap, Math.abs(y - (o.y + o.h + gap)), { type: 'dock', other }, dockSnapDist);
      considerY(o.y - moving.h - gap, Math.abs(y - (o.y - moving.h - gap)), { type: 'dock', other }, dockSnapDist);
    }
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

  const outX = bestX ? bestX.value : Math.round(x / grid) * grid;
  const outY = bestY ? bestY.value : Math.round(y / grid) * grid;
  if (bestX?.guide) guides.push(bestX.guide);
  if (bestY?.guide) guides.push(bestY.guide);
  return { x: outX, y: outY, guides, snappedX: Boolean(bestX), snappedY: Boolean(bestY) };
}

// Перемещение комнаты вместе с вложенными помещениями и мебелью, которая
// фактически стоит внутри (мебель свободна и не привязана к комнате — едет
// то, что находится внутри на момент перемещения). Проёмы хранятся
// относительно комнаты, их двигать не нужно.
export function moveRoomBy(project, roomId, dx, dy) {
  const moved = new Set([roomId]);
  for (const r of project.rooms) if (r.parentId === roomId) moved.add(r.id);
  const movedRooms = project.rooms
    .filter((r) => moved.has(r.id))
    .map((r) => ({ ...r, notch: r.notch ? { ...r.notch } : null }));
  for (const r of project.rooms) {
    if (moved.has(r.id)) { r.x += dx; r.y += dy; }
  }
  for (const item of project.items) {
    const inside = movedRooms.some((r) => roomContainsPoint(r, item.x, item.y));
    if (inside) { item.x += dx; item.y += dy; }
  }
  for (const wall of project.walls || []) {
    if (!moved.has(wall.ownerRoomId)) continue;
    wall.axis.a.x += dx; wall.axis.a.y += dy;
    wall.axis.b.x += dx; wall.axis.b.y += dy;
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

// Прямоугольник целиком внутри формы комнаты (с учётом выреза Г/контура).
export function rectInsideRoomShape(rect, room, eps = 1) {
  if (!rectInside(rect, roomRect(room), eps)) return false;
  if (!room.outline && !room.notch) return true;
  const grown = roomRects(room).map((p) => ({ x: p.x - eps, y: p.y - eps, w: p.w + eps * 2, h: p.h + eps * 2 }));
  return rectUnionArea(shapeClips([rect], grown)) >= rect.w * rect.h - eps * (rect.w + rect.h) * 2;
}

// Пересечения формы комнаты (Г/контур — набор прямоугольников) с другой
// формой: вырез габарита не участвует.
function shapeClips(roomParts, otherParts) {
  const out = [];
  for (const a of roomParts) {
    for (const b of otherParts) {
      const clip = intersectRect(a, b);
      if (clip) out.push(clip);
    }
  }
  return out;
}

// Комнаты верхнего уровня, которые «съедают» данную. Обычно выше стоит более
// поздняя комната, но дом всегда выше открытых террас и балконов.
export function eatersOf(project, room) {
  const idx = project.rooms.indexOf(room);
  const parts = roomRects(room);
  const result = [];
  const open = isOpenRoom(room);
  for (let i = 0; i < project.rooms.length; i += 1) {
    const other = project.rooms[i];
    if (other.id === room.id) continue;
    if (other.parentId || room.parentId) continue;
    // Закрытое помещение всегда выше террасы/балкона независимо от порядка
    // создания. Открытые площадки никогда не отнимают площадь дома.
    if (open && !isOpenRoom(other)) {
      if (shapeClips(parts, roomRects(other)).length) result.push(other);
      continue;
    }
    if (!open && isOpenRoom(other)) continue;
    if (i <= idx) continue;
    if (shapeClips(parts, roomRects(other)).length) result.push(other);
  }
  return result;
}

function subtractRect(rect, cut) {
  const clip = intersectRect(rect, cut);
  if (!clip) return [rect];
  const out = [];
  const right = rect.x + rect.w;
  const bottom = rect.y + rect.h;
  const clipRight = clip.x + clip.w;
  const clipBottom = clip.y + clip.h;
  if (clip.y > rect.y) out.push({ x: rect.x, y: rect.y, w: rect.w, h: clip.y - rect.y });
  if (clipBottom < bottom) out.push({ x: rect.x, y: clipBottom, w: rect.w, h: bottom - clipBottom });
  if (clip.x > rect.x) out.push({ x: rect.x, y: clip.y, w: clip.x - rect.x, h: clip.h });
  if (clipRight < right) out.push({ x: clipRight, y: clip.y, w: right - clipRight, h: clip.h });
  return out.filter((part) => part.w > 0.001 && part.h > 0.001);
}

function roomNetCuts(project, room) {
  const partition = project.settings?.partition || DEFAULT_PARTITION;
  const parts = roomRects(room);
  const subtractRects = [];
  for (const child of project.rooms) {
    if (child.parentId !== room.id) continue;
    if (isOpenRoom(child)) continue;
    if (child.takesArea === false) continue; // площадь родителя не уменьшается
    subtractRects.push(...shapeClips(parts, [nestedOuterRect(child, partition)]));
  }
  // Шахта верхнего уровня может проходить сразу через несколько помещений.
  // Она вырезает площадь каждого пересечённого помещения независимо от
  // порядка комнат в массиве.
  if (!room.parentId) {
    for (const shaft of project.rooms) {
      if (shaft.id === room.id || shaft.parentId || !isShaft(shaft)) continue;
      subtractRects.push(...shapeClips(parts, roomRects(shaft)));
    }
  }
  // Перекрытие комнатами, стоящими поверх (eaters).
  for (const eater of eatersOf(project, room)) {
    if (isShaft(eater)) continue; // уже учтена выше независимо от z-порядка
    subtractRects.push(...shapeClips(parts, roomRects(eater)));
  }
  // Проём в перекрытии под этим этажом (над лестницей) — не пол помещения.
  const slabCuts = slabOpenings(project, project.activeLevel).flatMap((o) => slabOpeningCutRects(o));
  subtractRects.push(...shapeClips(parts, slabCuts));
  // Полая масса, проходящая через отметку пола, удаляет ту же площадь и в
  // расчётах — иначе 3D показывал бы отверстие, а свойства и ведомость нет.
  const level = (project.levels || []).find((l) => l.id === project.activeLevel);
  const floorZ = Number(level?.elevation) || 0;
  const voidCuts = (project.massVoids || []).map(massBox)
    .filter((b) => b.z0 <= floorZ + 2.5 && b.z1 >= floorZ - 0.5)
    .map((b) => ({ x: b.x0, y: b.y0, w: b.x1 - b.x0, h: b.y1 - b.y0 }));
  subtractRects.push(...shapeClips(parts, voidCuts));
  return subtractRects;
}

// Чистая геометрия пола как набор неперекрывающихся прямоугольников.
// Это та же геометрия, что и roomNetAreaM2: без вложенных комнат,
// шахт, перекрывающих помещений, проёмов и полых масс.
export function roomNetRects(project, room) {
  if (isShaft(room)) return [];
  let result = roomRects(room).map((part) => ({ ...part }));
  for (const cut of roomNetCuts(project, room)) result = result.flatMap((part) => subtractRect(part, cut));
  return result;
}

// Чистая площадь: внутренняя минус габариты вложенных помещений (со стенами)
// и минус область, «съеденная» перекрывающими комнатами поверх этой.
export function roomNetAreaM2(project, room) {
  return rectUnionArea(roomNetRects(project, room)) / 1_000_000;
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
  for (const wall of resolvedWalls) {
    if (wall.hidden && wall.kind === 'shared' && wall.rooms.length === 2) addEdge(wall.rooms[0], wall.rooms[1]);
  }
  for (const opening of project.openings) {
    const link = doorLink(project, opening, resolvedWalls);
    if (link) addEdge(link[0], link[1]);
  }

  // На верхних этажах вход — лестница: помещения «Лестница» ведут на этаж
  // ниже, поэтому служат точкой входа наравне с наружной дверью.
  const upper = Boolean(project.levels && isUpperLevel(project));
  if (upper) {
    for (const room of project.rooms) if (room.type === 'stairs-room') addEdge('stairs', room.id);
  }
  // Терраса на земле — уже улица: дверь на неё ведёт наружу.
  if (!upper) {
    for (const room of project.rooms) if (!room.parentId && isOpenRoom(room) && !isShaft(room)) addEdge('outside', room.id);
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

  // Помещения, которым отдельный вход не нужен (needsOwnAccess), в
  // недоступные не попадают — о них замечаний нет.
  const exempt = [];
  const unreachable = [];
  for (const r of project.rooms) {
    if (reachable.has(r.id)) continue;
    if (needsOwnAccess(project, r)) unreachable.push(r.id); else exempt.push(r.id);
  }
  return { hasEntrance, reachable, unreachable, exempt, graph };
}

// Типы, которым отдельная дверь не нужна: шахта; кладовые, техпомещение и
// котельная (вход бывает с улицы или через шкаф) — по месту, на усмотрение автора.
const NO_ACCESS_TYPES = new Set(['shaft', 'storage', 'pantry', 'tech', 'boiler']);
const BEDROOM_TYPES = new Set(['bedroom', 'master-bedroom', 'kids-room', 'guest-bedroom']);

// Нужен ли помещению свой вход (дверь или проём) для проверки связности.
// Не нужен: шахте и служебным типам; террасе/балкону (открытые — выход на
// них решает автор); вложенному помещению (parentId — внутри родителя,
// проход в нём по месту); гардеробной, примыкающей к спальне (вход из
// спальни аркой или без двери — обычное решение).
export function needsOwnAccess(project, room) {
  if (!room) return false;
  if (isShaft(room) || NO_ACCESS_TYPES.has(room.type)) return false;
  if (isOpenRoom(room)) return false;
  if (room.parentId) return false;
  if (room.type === 'wardrobe-room') {
    const bedrooms = new Set(project.rooms.filter((r) => BEDROOM_TYPES.has(r.type)).map((r) => r.id));
    if (bedrooms.size && projectAdjacencies(project).some((a) => (a.a.id === room.id && bedrooms.has(a.b.id)) || (a.b.id === room.id && bedrooms.has(a.a.id)))) return false;
  }
  return true;
}

// Связная группа недоступных помещений, в которую входит roomId (по дверям
// и проёмам между ними): одна подсказка на группу, а не на каждую комнату.
export function unreachableCluster(analysis, roomId) {
  const bad = new Set([...(analysis.unreachable || []), ...(analysis.exempt || [])]);
  const out = new Set([roomId]);
  const queue = [roomId];
  while (queue.length) {
    const id = queue.shift();
    for (const next of analysis.graph?.get(id) || []) {
      if (bad.has(next) && !out.has(next)) { out.add(next); queue.push(next); }
    }
  }
  return out;
}

// Рёбра реального внутреннего контура комнаты (прямоугольник минус области,
// «съеденные» перекрывающими комнатами и вложенными помещениями). Для Г- и
// Т-образных комнат даёт все стороны с их настоящими длинами.
// Возвращает { rectangular, edges:[{orient:'v'|'h', at, from, to, inSide}] }.
export function computeRoomEdges(project, room) {
  if (room.outline) {
    return {
      rectangular: false,
      edges: roomBoundaryEdges(room).map((edge) => ({
        orient: edge.orient, at: edge.edge, from: edge.from, to: edge.to, inSide: -edge.outward,
      })),
    };
  }
  const partition = project.settings?.partition || DEFAULT_PARTITION;
  const rect = roomRect(room);
  const subs = [];
  const notch = roomNotchRect(room);
  if (notch) subs.push(notch);
  if (!room.parentId) {
    for (const shaft of project.rooms) {
      if (shaft.id === room.id || shaft.parentId || !isShaft(shaft)) continue;
      const clip = intersectRect(rect, roomRect(shaft));
      if (clip) subs.push(clip);
    }
    for (const eater of eatersOf(project, room)) {
      if (isShaft(eater)) continue;
      const clip = intersectRect(rect, roomRect(eater));
      if (clip) subs.push(clip);
    }
  }
  for (const child of project.rooms) {
    if (child.parentId !== room.id || isOpenRoom(child) || child.takesArea === false) continue;
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
// Площадь объединения прямоугольников (сжатие координат по X).
export function rectsUnionArea(rects) {
  const xs = [...new Set(rects.flatMap((r) => [r.x, r.x + r.w]))].sort((a, b) => a - b);
  let area = 0;
  for (let i = 0; i < xs.length - 1; i += 1) {
    const mid = (xs[i] + xs[i + 1]) / 2;
    const spans = rects.filter((r) => r.x <= mid && mid <= r.x + r.w)
      .map((r) => [r.y, r.y + r.h]).sort((a, b) => a[0] - b[0]);
    let len = 0;
    let cur = null;
    for (const [a, b] of spans) {
      if (!cur || a > cur[1]) { if (cur) len += cur[1] - cur[0]; cur = [a, b]; } else cur[1] = Math.max(cur[1], b);
    }
    if (cur) len += cur[1] - cur[0];
    area += len * (xs[i + 1] - xs[i]);
  }
  return area;
}

// Пятно застройки этажа: комнаты верхнего уровня вместе с наружными стенами
// (без террас и балконов), м².
// Дом из ручных стен: толщина наружных стен своя у каждой стены, поэтому
// пятно — объединение области стен W и помещений (комнаты + куски rects
// движка v2), а не контур помещения + settings.exterior.
const footprintRooms = (project) => project.rooms.filter((r) => !r.parentId && !isOpenRoom(r) && !isShaft(r));

function wallAreaRects(project, walls) {
  if (!projectHasManualWalls(project)) return null;
  const list = walls || deriveWalls(project);
  if (!list.some((w) => w.rects)) return null;
  return list.flatMap((w) => wallRects(w)).filter((r) => r.w > 0 && r.h > 0);
}

export function buildingFootprintM2(project, walls = null) {
  const own = wallAreaRects(project, walls);
  if (own) {
    return rectsUnionArea([...own, ...footprintRooms(project).flatMap((r) => roomRects(r))]) / 1_000_000;
  }
  const t = project.settings?.exterior || DEFAULT_EXTERIOR;
  const rects = footprintRooms(project)
    .flatMap((r) => roomRects(r).map((part) => ({ x: part.x - t, y: part.y - t, w: part.w + t * 2, h: part.h + t * 2 })));
  return rectsUnionArea(rects) / 1_000_000;
}

// walls — готовые стены (render передаёт state.walls), иначе выводятся.
// Дом из ручных стен при expand ≥ exterior — по наружной грани объединения W
// и помещений (плюс выдвижение сверх exterior); меньший expand (ось стен) —
// по-старому от помещений.
export function computeBuildingOutline(project, expand = 0, walls = null) {
  const exterior = project.settings?.exterior || DEFAULT_EXTERIOR;
  const own = expand > 0 && expand >= exterior ? wallAreaRects(project, walls) : null;
  if (own) {
    const d = expand - exterior;
    const grow = (rc) => (d > 0 ? { x: rc.x - d, y: rc.y - d, w: rc.w + 2 * d, h: rc.h + 2 * d } : rc);
    const rects = [...own, ...footprintRooms(project).flatMap((r) => roomRects(r))].map(grow);
    return rects.length ? unionEdges(rects) : [];
  }
  const rects = footprintRooms(project)
    .flatMap((r) => roomRects(r).map((rc) => {
      return expand
        ? { x: rc.x - expand, y: rc.y - expand, w: rc.w + 2 * expand, h: rc.h + 2 * expand }
        : rc;
    }));
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
// Недоступные помещения, связанные между собой дверями или проёмами, — одна
// группа: дверь предлагается из любой её комнаты в ДОСТУПНУЮ (раньше бралась
// самая длинная стена с кем угодно — и выходило «добавьте дверь» туда, где
// проём уже есть, или в такую же недоступную комнату).
// → { roomId, targetId, members, text } | null (помещению вход не нужен).
export function suggestAccess(project, roomId, analysis) {
  const room = project.rooms.find((r) => r.id === roomId);
  if (!room) return null;
  if (!needsOwnAccess(project, room)) return null;
  const reachable = analysis?.reachable || new Set();
  const members = analysis ? unreachableCluster(analysis, roomId) : new Set([roomId]);
  const nameOf = (id) => project.rooms.find((r) => r.id === id)?.name || '';
  const adjacencies = projectAdjacencies(project)
    .filter((a) => members.has(a.a.id) !== members.has(a.b.id))
    .sort((p, q) => (q.to - q.from) - (p.to - p.from));
  // Сначала — стена с доступной комнатой (без шахт и открытых площадок
  // верхних этажей), иначе — с любой соседней вне группы.
  const pick = adjacencies.find((a) => reachable.has(members.has(a.a.id) ? a.b.id : a.a.id))
    || adjacencies.find((a) => !isShaft(members.has(a.a.id) ? a.b : a.a));
  if (pick) {
    const [mine, other] = members.has(pick.a.id) ? [pick.a, pick.b] : [pick.b, pick.a];
    return { roomId: mine.id, targetId: other.id, members: [...members], text: `Добавьте дверь между «${mine.name}» и «${other.name}»` };
  }
  const list = [...members].map(nameOf).filter(Boolean);
  return {
    roomId, targetId: null, members: [...members],
    text: list.length > 1
      ? `«${list.join('», «')}» не связаны с остальным домом — пристыкуйте их или добавьте коридор`
      : `«${room.name}» ни с чем не граничит — пристыкуйте её к дому или добавьте коридор`,
  };
}
