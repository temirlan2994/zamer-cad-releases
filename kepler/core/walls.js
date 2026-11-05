// Производный граф стен Kepler Plan.
// Стены не хранятся в проекте — они каждый раз выводятся из прямоугольников
// комнат. Общая стена двух состыкованных комнат — ОДИН объект (kind: 'shared'),
// заполняющий зазор между их внутренними прямоугольниками. Остальные участки
// сторон — собственные стены комнаты (kind: 'own').
//
// Ключи стен стабильны: '
//   s|<idA>|<idB>'      — общая стена пары комнат,
//   'e|<roomId>|<side>' — собственные стены стороны комнаты (для overrides).

import { DEFAULT_BEARING, DEFAULT_PARTITION, DEFAULT_EXTERIOR, isOpenRoom, isShaft } from './catalog.js';
import {
  roomBoundaryEdges, roomNotchEdges, roomNotchInnerPoint, roomNotchSideCuts, roomPolygon, roomRects,
} from './room-shape.js';

// Радиус поиска соседней стены для магнитной стыковки. Самой общей стеной
// становится только точный конструктивный зазор — толщина этой стены
// (sharedWallThickness: своя толщина пары или перегородка по умолчанию).
export const MAX_SHARED_GAP = 450;
const SHARED_GAP_EPS = 1;

// Допустимая толщина любой стены, мм.
export const WALL_T_MIN = 50;
export const WALL_T_MAX = 600;

// Три класса толщины: наружная, внутренняя несущая, перегородка.
// Значения по умолчанию — в project.settings (exterior / bearing / partition).
export function wallClassThickness(settings, kind) {
  if (kind === 'exterior') return settings?.exterior || DEFAULT_EXTERIOR;
  if (kind === 'bearing') return settings?.bearing || DEFAULT_BEARING;
  return settings?.partition || DEFAULT_PARTITION;
}

// Толщина общей стены пары комнат — единственный источник правды для
// зазора стыковки: своя толщина в wallOverrides[s|a|b], иначе перегородка.
export function sharedWallThickness(project, idA, idB) {
  const own = project.wallOverrides?.[sharedKey(idA, idB)]?.thickness;
  return Number(own) > 0 ? Number(own) : (project.settings?.partition || DEFAULT_PARTITION);
}

// Каноническое описание стороны: горизонтальные — интервал по X, вертикальные — по Y.
// side: 0 верх, 1 право, 2 низ, 3 лево.
export function sideEdge(room, side) {
  if (typeof side === 'string') return roomBoundaryEdges(room).find((edge) => edge.side === side) || null;
  if (side === 0) return { orient: 'h', edge: room.y, from: room.x, to: room.x + room.w, outward: -1 };
  if (side === 1) return { orient: 'v', edge: room.x + room.w, from: room.y, to: room.y + room.h, outward: 1 };
  if (side === 2) return { orient: 'h', edge: room.y + room.h, from: room.x, to: room.x + room.w, outward: 1 };
  return { orient: 'v', edge: room.x, from: room.y, to: room.y + room.h, outward: -1 };
}

export function oppositeSide(side) {
  return (side + 2) % 4;
}

function overlap1d(a1, a2, b1, b2) {
  const from = Math.max(a1, b1);
  const to = Math.min(a2, b2);
  return to - from > 1 ? { from, to } : null;
}

function subtractIntervals(from, to, subs) {
  let rest = [{ from, to }];
  for (const sub of subs) {
    const next = [];
    for (const seg of rest) {
      const cut = overlap1d(seg.from, seg.to, sub.from, sub.to);
      if (!cut) { next.push(seg); continue; }
      if (cut.from - seg.from > 1) next.push({ from: seg.from, to: cut.from });
      if (seg.to - cut.to > 1) next.push({ from: cut.to, to: seg.to });
    }
    rest = next;
  }
  return rest;
}

export function sharedKey(idA, idB) {
  return idA < idB ? `s|${idA}|${idB}` : `s|${idB}|${idA}`;
}

export function ownKey(roomId, side) {
  return `e|${roomId}|${side}`;
}

// Находит стыковки: пары комнат-соседей с перекрытием проекций и малым зазором.
// Соседями считаются комнаты одного уровня вложенности (одинаковый parentId).
// overrides — wallOverrides этажа: если у пары задана своя толщина общей
// стены, зазором стыковки считается она, а не перегородка по умолчанию.
export function findAdjacencies(rooms, sharedGap = DEFAULT_PARTITION, overrides = null) {
  const result = [];
  for (let i = 0; i < rooms.length; i += 1) {
    for (let j = i + 1; j < rooms.length; j += 1) {
      const a = rooms[i];
      const b = rooms[j];
      if ((a.parentId || null) !== (b.parentId || null)) continue;
      const own = Number(overrides?.[sharedKey(a.id, b.id)]?.thickness);
      const pairGap = own > 0 ? own : sharedGap;
      for (const [first, second] of [[a, b], [b, a]]) {
        for (const edgeA of roomBoundaryEdges(first)) {
          for (const edgeB of roomBoundaryEdges(second)) {
            if (edgeA.orient !== edgeB.orient || edgeA.outward === edgeB.outward) continue;
            const gap = (edgeB.edge - edgeA.edge) * edgeA.outward;
            // Общая стена существует только при настоящем конструктивном
            // зазоре. Раньше любой зазор 2…450 мм превращался в перегородку
            // переменной толщины, а при нулевом зазоре снова возникали две
            // наружные стены. Это и давало ступени при приближении помещений.
            if (Math.abs(gap - pairGap) > SHARED_GAP_EPS) continue;
            const span = overlap1d(edgeA.from, edgeA.to, edgeB.from, edgeB.to);
            if (!span) continue;
            result.push({
              a: first, b: second, sideA: edgeA.side, sideB: edgeB.side,
              edgeA, edgeB, gap, from: span.from, to: span.to,
            });
          }
        }
      }
    }
  }
  return result;
}

// Стыковки активного этажа проекта с учётом своих толщин общих стен.
export function projectAdjacencies(project) {
  return findAdjacencies(project.rooms, project.settings?.partition || DEFAULT_PARTITION, project.wallOverrides);
}

// Свободные участки ограждения террасы/балкона. Там, где открытое помещение
// примыкает к любой комнате (включая другую террасу), перила не нужны: стена
// закрытой комнаты при этом остаётся обычной наружной стеной.
export function openRoomRailingSegments(room, rooms) {
  if (!isOpenRoom(room)) return [];
  const cutsBySide = new Map();
  for (const other of rooms) {
    if (other.id === room.id || (other.parentId || null) !== (room.parentId || null)) continue;
    for (const side of [0, 1, 2, 3]) {
      const edge = sideEdge(room, side);
      const facing = sideEdge(other, oppositeSide(side));
      const gap = (facing.edge - edge.edge) * edge.outward;
      if (gap < -1 || gap > MAX_SHARED_GAP) continue;
      const span = overlap1d(edge.from, edge.to, facing.from, facing.to);
      if (!span) continue;
      if (!cutsBySide.has(side)) cutsBySide.set(side, []);
      cutsBySide.get(side).push(span);
    }
  }
  const result = [];
  for (const side of [0, 1, 2, 3]) {
    const edge = sideEdge(room, side);
    for (const segment of subtractIntervals(edge.from, edge.to, cutsBySide.get(side) || [])) {
      result.push({ side, ...edge, from: segment.from, to: segment.to });
    }
  }
  return result;
}

function wallTypeOf(override, fallback) {
  return (override && override.kind) || fallback;
}

// Главная функция: выводит все сегменты стен проекта.
export function deriveWalls(project) {
  const walls = [];
  const overrides = project.wallOverrides || {};
  const partition = project.settings?.partition || DEFAULT_PARTITION;
  const exterior = project.settings?.exterior || DEFAULT_EXTERIOR;
  const adjacencies = findAdjacencies(project.rooms, partition, overrides);
  const sharedByRoomSide = new Map(); // `${roomId}|${side}` -> intervals

  const noteShared = (roomId, side, from, to) => {
    const key = `${roomId}|${side}`;
    if (!sharedByRoomSide.has(key)) sharedByRoomSide.set(key, []);
    sharedByRoomSide.get(key).push({ from, to });
  };

  const seenPairs = new Set();
  for (const adj of adjacencies) {
    // Терраса/балкон не участвует в конструкции стен: её примыкание лишь
    // убирает перила на этом участке, но не заменяет стену дома перегородкой.
    if (isOpenRoom(adj.a) || isOpenRoom(adj.b)) continue;
    const key = sharedKey(adj.a.id, adj.b.id);
    const edgeA = adj.edgeA || sideEdge(adj.a, adj.sideA);
    const edgeB = adj.edgeB || sideEdge(adj.b, adj.sideB);
    const seenKey = `${key}|${edgeA.orient}|${Math.round(Math.min(edgeA.edge, edgeB.edge))}|` +
      `${Math.round(Math.max(edgeA.edge, edgeB.edge))}|${Math.round(adj.from)}|${Math.round(adj.to)}`;
    if (seenPairs.has(seenKey)) continue;
    seenPairs.add(seenKey);
    const override = overrides[key];
    const orient = edgeA.orient;
    const oppositeEdge = edgeA.edge + edgeA.outward * adj.gap;
    const acrossFrom = Math.min(edgeA.edge, oppositeEdge);
    const band = orient === 'h'
      ? { x: adj.from, y: acrossFrom, w: adj.to - adj.from, h: adj.gap }
      : { x: acrossFrom, y: adj.from, w: adj.gap, h: adj.to - adj.from };
    // edgeA может принадлежать как левому/верхнему, так и правому/нижнему
    // помещению. Направление outward обязательно: без него стена для второй
    // ориентации уезжала внутрь комнаты и оставляла белую щель в зазоре.
    const mid = edgeA.edge + edgeA.outward * (adj.gap / 2);
    walls.push({
      key,
      kind: 'shared',
      orient,
      rooms: [adj.a.id, adj.b.id],
      sides: { [adj.a.id]: adj.sideA, [adj.b.id]: adj.sideB },
      from: adj.from,
      to: adj.to,
      edge: edgeA.edge,
      thickness: adj.gap,
      band,
      center: orient === 'h'
        ? { x1: adj.from, y1: mid, x2: adj.to, y2: mid }
        : { x1: mid, y1: adj.from, x2: mid, y2: adj.to },
      wallType: wallTypeOf(override, 'partition'),
      hidden: Boolean(override?.hidden),
    });
    noteShared(adj.a.id, adj.sideA, adj.from, adj.to);
    noteShared(adj.b.id, adj.sideB, adj.from, adj.to);
  }

  // Собственные стены: стороны комнат за вычетом общих участков.
  const byId = new Map(project.rooms.map((r) => [r.id, r]));
  const topRooms = project.rooms.filter((r) => !r.parentId && !isOpenRoom(r));
  for (const room of project.rooms) {
    if (isOpenRoom(room)) continue; // открытые помещения (терраса/балкон) — без стен
    const nested = Boolean(room.parentId && byId.has(room.parentId));
    const internal = nested || isShaft(room);
    const notchCuts = roomNotchSideCuts(room);
    const edges = room.outline
      ? roomBoundaryEdges(room)
      : [0, 1, 2, 3, ...roomNotchEdges(room).map((edge) => edge.side)]
        .map((side) => ({ ...sideEdge(room, side), side }));
    for (const edge of edges) {
      if (!edge) continue;
      const side = edge.side;
      const subs = [...(sharedByRoomSide.get(`${room.id}|${side}`) || []), ...(notchCuts[side] || [])];
      const rest = subtractIntervals(edge.from, edge.to, subs);
      const key = ownKey(room.id, side);
      const override = overrides[key];
      const baseThick = (override && override.thickness) || (internal ? partition : exterior);
      const baseType = wallTypeOf(override, internal ? 'partition' : 'exterior');

      // Участки, попадающие внутрь другой комнаты верхнего уровня (перекрытие),
      // становятся тонкой перегородкой.
      const covered = [];
      if (!internal) {
        for (const other of topRooms) {
          if (other.id === room.id) continue;
          // По фактической форме соседа (Г, ступени, контур), а не по габариту:
          // вырез ступенчатой комнаты не «перекрывает» чужие стены.
          for (const o of roomRects(other)) {
            const pLo = edge.orient === 'h' ? o.y : o.x;
            const pHi = edge.orient === 'h' ? o.y + o.h : o.x + o.w;
            if (edge.edge <= pLo + 1 || edge.edge >= pHi - 1) continue; // грань не внутри o
            const aLo = edge.orient === 'h' ? o.x : o.y;
            const aHi = edge.orient === 'h' ? o.x + o.w : o.y + o.h;
            const f = Math.max(edge.from, aLo);
            const t = Math.min(edge.to, aHi);
            if (t - f > 1) covered.push({ from: f, to: t });
          }
        }
      }

      // Напротив грани ближе толщины стены стоит другая комната того же уровня:
      // терраса/балкон (общей стены с ними нет) или комната на нестандартном
      // зазоре (не равном перегородке — тогда это не общая стена). Стена
      // сужается до зазора: иначе она заходит внутрь соседа бугром.
      const facing = [];
      for (const other of project.rooms) {
        if (other.id === room.id || isShaft(other) || (other.parentId || null) !== (room.parentId || null)) continue;
        for (const o of roomRects(other)) {
          const lo = edge.orient === 'h' ? o.y : o.x;
          const hi = edge.orient === 'h' ? o.y + o.h : o.x + o.w;
          const gap = edge.outward > 0 ? lo - edge.edge : edge.edge - hi;
          if (gap <= 1 || gap >= baseThick - 1) continue;
          const aLo = edge.orient === 'h' ? o.x : o.y;
          const aHi = edge.orient === 'h' ? o.x + o.w : o.y + o.h;
          const f = Math.max(edge.from, aLo);
          const t = Math.min(edge.to, aHi);
          if (t - f > 1) facing.push({ from: f, to: t, thickness: gap });
        }
      }

      const emit = (segFrom, segTo, thickness, type) => {
        const inner = edge.edge;
        const outer = inner + edge.outward * thickness;
        const lo = Math.min(inner, outer);
        const band = edge.orient === 'h'
          ? { x: segFrom, y: lo, w: segTo - segFrom, h: thickness }
          : { x: lo, y: segFrom, w: thickness, h: segTo - segFrom };
        const mid = inner + edge.outward * (thickness / 2);
        walls.push({
          key, kind: 'own', orient: edge.orient, rooms: [room.id], sides: { [room.id]: side },
          from: segFrom, to: segTo, edge: inner, outward: edge.outward, thickness, band,
          center: edge.orient === 'h'
            ? { x1: segFrom, y1: mid, x2: segTo, y2: mid }
            : { x1: mid, y1: segFrom, x2: mid, y2: segTo },
          wallType: type,
          hidden: Boolean(override?.hidden),
        });
      };

      // Полная толщина, кроме участков напротив близкого соседа (facing).
      const emitThick = (segFrom, segTo) => {
        const cuts = facing
          .map((c) => ({ from: Math.max(segFrom, c.from), to: Math.min(segTo, c.to), thickness: c.thickness }))
          .filter((c) => c.to - c.from > 1);
        if (!cuts.length) { emit(segFrom, segTo, baseThick, baseType); return; }
        const xs = [...new Set([segFrom, segTo, ...cuts.flatMap((c) => [c.from, c.to])])].sort((a, b) => a - b);
        const parts = [];
        for (let i = 0; i + 1 < xs.length; i += 1) {
          const a = xs[i];
          const b = xs[i + 1];
          const mid = (a + b) / 2;
          let thick = baseThick;
          for (const c of cuts) if (mid > c.from && mid < c.to) thick = Math.min(thick, c.thickness);
          const last = parts[parts.length - 1];
          if (last && (last.thick === thick || b - a <= 1)) last.to = b;
          else parts.push({ from: a, to: b, thick });
        }
        for (const p of parts) emit(p.from, p.to, p.thick, baseType);
      };

      for (const seg of rest) {
        if (!covered.length) { emitThick(seg.from, seg.to); continue; }
        const thinParts = covered
          .map((c) => ({ from: Math.max(seg.from, c.from), to: Math.min(seg.to, c.to) }))
          .filter((c) => c.to - c.from > 1);
        const thickParts = subtractIntervals(seg.from, seg.to, thinParts);
        for (const p of thickParts) emitThick(p.from, p.to);
        for (const p of thinParts) emit(p.from, p.to, Math.min(baseThick, partition), 'partition');
      }
    }
  }

  extendOwnCorners(walls, byId);
  cutWallsInsideShafts(walls, project.rooms);
  fillWallJoints(walls);
  addThicknessChamfers(walls, project.rooms);
  return walls;
}

// Шахта находится выше помещений в плане и проходит через этаж насквозь.
// Поэтому стены комнат, пересекающие её внутренний прямоугольник, физически
// обрываются у граней шахты. Стены самой шахты сохраняются целиком.
function cutWallsInsideShafts(walls, rooms) {
  const shafts = rooms.filter((room) => isShaft(room));
  if (!shafts.length) return;
  const shaftIds = new Set(shafts.map((room) => room.id));
  const result = [];

  for (const wall of walls) {
    if (!['own', 'shared'].includes(wall.kind) || wall.rooms.some((id) => shaftIds.has(id))) {
      result.push(wall);
      continue;
    }
    const band = wall.band;
    const alongFrom = wall.orient === 'h' ? band.x : band.y;
    const alongTo = alongFrom + (wall.orient === 'h' ? band.w : band.h);
    const cuts = [];
    for (const shaft of shafts) {
      const crossOverlap = wall.orient === 'h'
        ? Math.min(band.y + band.h, shaft.y + shaft.h) - Math.max(band.y, shaft.y)
        : Math.min(band.x + band.w, shaft.x + shaft.w) - Math.max(band.x, shaft.x);
      if (crossOverlap <= 1) continue;
      cuts.push(wall.orient === 'h'
        ? { from: shaft.x, to: shaft.x + shaft.w }
        : { from: shaft.y, to: shaft.y + shaft.h });
    }
    const parts = subtractIntervals(alongFrom, alongTo, cuts);
    for (const part of parts) {
      const clone = { ...wall, band: { ...band }, center: { ...wall.center }, from: part.from, to: part.to };
      if (wall.orient === 'h') {
        clone.band.x = part.from;
        clone.band.w = part.to - part.from;
        clone.center.x1 = part.from;
        clone.center.x2 = part.to;
      } else {
        clone.band.y = part.from;
        clone.band.h = part.to - part.from;
        clone.center.y1 = part.from;
        clone.center.y2 = part.to;
      }
      result.push(clone);
    }
  }

  walls.splice(0, walls.length, ...result);
}

// Выравнивает ступеньку на стыке колинеарных стен разной толщины (например
// тонкая перегородка 100 встречает наружную стену 250 на одной линии): тонкую
// стену «добирают» прямоугольной заплаткой до наружной грани толстой — так
// линия стены остаётся прямой, без ступеньки-бугорка и без скоса.
function addThicknessChamfers(walls, allRooms = []) {
  const solid = walls.filter((w) => !w.hidden && (w.kind === 'own' || w.kind === 'shared'));
  const rooms = allRooms;
  // Заплатку нельзя заводить внутрь комнаты (в том числе террасы/балкона:
  // стена напротив них сужена до зазора) — только в наружное/зазорное
  // пространство. Иначе «ровная» стена полезет внутрь помещения бугром.
  const intrudesRoom = (x, y, w, h) => rooms.some((room) => roomRects(room).some((r) => {
    const ox = Math.min(x + w, r.x + r.w) - Math.max(x, r.x);
    const oy = Math.min(y + h, r.y + r.h) - Math.max(y, r.y);
    return ox > 10 && oy > 10;
  }));
  const EPS = 2;
  const MIN_STEP = 20; // меньше — не считаем ступенькой
  const out = [];
  const makeRect = (x, y, w, h, src) => {
    if (intrudesRoom(x, y, w, h)) return null;
    return {
      key: `chamfer-${Math.round(x)}|${Math.round(y)}|${Math.round(w)}|${Math.round(h)}`,
      kind: 'chamfer', orient: src.orient, rooms: [], sides: {}, from: 0, to: 0, edge: 0, thickness: 0,
      poly: [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }],
      band: { x, y, w, h },
      wallType: src.wallType,
    };
  };
  for (let i = 0; i < solid.length; i += 1) {
    for (let j = 0; j < solid.length; j += 1) {
      if (i === j) continue;
      const A = solid[i];
      const B = solid[j];
      if (A.orient !== B.orient) continue;
      const a = A.band;
      const b = B.band;
      if (A.orient === 'h') {
        if (Math.abs(a.x + a.w - b.x) > EPS) continue; // A слева, B справа, встык по X
        const topA = a.y;
        const botA = a.y + a.h;
        const topB = b.y;
        const botB = b.y + b.h;
        if (Math.abs(topA - topB) < EPS && Math.abs(botA - botB) > MIN_STEP) {
          // общая верхняя грань, ступенька снизу — тонкую добираем вниз до толстой
          const thin = botA < botB ? A : B;
          const deep = Math.max(botA, botB);
          const shallow = Math.min(botA, botB);
          out.push(makeRect(thin.band.x, shallow, thin.band.w, deep - shallow, deep === botB ? B : A));
        } else if (Math.abs(botA - botB) < EPS && Math.abs(topA - topB) > MIN_STEP) {
          // общая нижняя грань, ступенька сверху — тонкую добираем вверх
          const thin = topA > topB ? A : B;
          const deep = Math.min(topA, topB);
          const shallow = Math.max(topA, topB);
          out.push(makeRect(thin.band.x, deep, thin.band.w, shallow - deep, deep === topB ? B : A));
        }
      } else {
        if (Math.abs(a.y + a.h - b.y) > EPS) continue; // A сверху, B снизу, встык по Y
        const leftA = a.x;
        const rightA = a.x + a.w;
        const leftB = b.x;
        const rightB = b.x + b.w;
        if (Math.abs(leftA - leftB) < EPS && Math.abs(rightA - rightB) > MIN_STEP) {
          const thin = rightA < rightB ? A : B;
          const deep = Math.max(rightA, rightB);
          const shallow = Math.min(rightA, rightB);
          out.push(makeRect(shallow, thin.band.y, deep - shallow, thin.band.h, deep === rightB ? B : A));
        } else if (Math.abs(rightA - rightB) < EPS && Math.abs(leftA - leftB) > MIN_STEP) {
          const thin = leftA > leftB ? A : B;
          const deep = Math.min(leftA, leftB);
          const shallow = Math.max(leftA, leftB);
          out.push(makeRect(deep, thin.band.y, shallow - deep, thin.band.h, deep === leftB ? B : A));
        }
      }
    }
  }
  for (const c of out) if (c) walls.push(c);
}

// Заполняет уголки на стыках стен (например, общая стена ↔ наружная):
// там, где перпендикулярная стена не доходит до соседней, добавляется
// маленький прямоугольник-заплатка того же типа.
function fillWallJoints(walls) {
  const fillers = [];
  const seen = new Set();
  for (const wall of walls) {
    // Скрытую стену не рисуем, но заплатку в перпендикулярной (наружной)
    // стене на её торце оставляем: иначе контур дома рвётся щелью в зазор.
    // Перпендикулярные полосы, чья грань совпадает с концом этой стены.
    const perpOrient = wall.orient === 'h' ? 'v' : 'h';
    for (const end of [wall.from, wall.to]) {
      for (const other of walls) {
        if (other === wall || other.hidden || other.orient !== perpOrient) continue;
        // Грань перпендикулярной стены на уровне конца нашей стены.
        if (Math.abs(other.edge - end) > 2) continue;
        const b = other.band;
        const wb = wall.band;
        // other примыкает к торцу wall по поперечной оси?
        const touchesX = Math.abs(b.x + b.w - wb.x) < 2 || Math.abs(b.x - (wb.x + wb.w)) < 2;
        const touchesY = Math.abs(b.y + b.h - wb.y) < 2 || Math.abs(b.y - (wb.y + wb.h)) < 2;
        const adjacent = wall.orient === 'v' ? touchesX : touchesY;
        if (!adjacent) continue;
        // Заплатка: ширина полотна wall × толщина other (в зоне зазора).
        const rect = wall.orient === 'v'
          ? { x: wb.x, y: b.y, w: wb.w, h: b.h }
          : { x: b.x, y: wb.y, w: b.w, h: wb.h };
        const key = `${Math.round(rect.x)}|${Math.round(rect.y)}|${Math.round(rect.w)}|${Math.round(rect.h)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        fillers.push({
          key: `joint-${key}`, kind: 'joint', orient: wall.orient, rooms: [],
          sides: {}, from: 0, to: 0, edge: 0, thickness: 0, band: rect,
          center: { x1: rect.x, y1: rect.y, x2: rect.x, y2: rect.y },
          wallType: other.wallType,
        });
      }
    }
  }
  for (const f of fillers) walls.push(f);
}

// Прямоугольник a минус прямоугольник b — до четырёх непересекающихся кусков.
function rectMinus(a, b) {
  const x0 = Math.max(a.x, b.x);
  const y0 = Math.max(a.y, b.y);
  const x1 = Math.min(a.x + a.w, b.x + b.w);
  const y1 = Math.min(a.y + a.h, b.y + b.h);
  if (x1 - x0 <= 0.5 || y1 - y0 <= 0.5) return [a];
  const out = [];
  if (y0 - a.y > 0.5) out.push({ x: a.x, y: a.y, w: a.w, h: y0 - a.y });
  if (a.y + a.h - y1 > 0.5) out.push({ x: a.x, y: y1, w: a.w, h: a.y + a.h - y1 });
  if (x0 - a.x > 0.5) out.push({ x: a.x, y: y0, w: x0 - a.x, h: y1 - y0 });
  if (a.x + a.w - x1 > 0.5) out.push({ x: x1, y: y0, w: a.x + a.w - x1, h: y1 - y0 });
  return out;
}

// Заплатки стыков (joint/chamfer) для объёмных выводов (IFC, 3D): только та
// часть, что не покрыта видимыми полосами own/shared и предыдущими заплатками
// (без двойного объёма), с «хозяином» — видимой стеной own/shared, к которой
// кусок примыкает (предпочтительно того же типа). → [{ rect, wallType, host }]
export function wallJoinPatches(walls) {
  const solid = walls.filter((w) => !w.hidden && w.band && (w.kind === 'own' || w.kind === 'shared'));
  const taken = solid.map((w) => w.band);
  const result = [];
  const touches = (a, b) => {
    const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
    const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
    return (ox > 0.5 && oy > -0.5) || (oy > 0.5 && ox > -0.5);
  };
  for (const w of walls) {
    if (w.hidden || !w.band || (w.kind !== 'joint' && w.kind !== 'chamfer')) continue;
    let pieces = [w.band];
    for (const t of taken) pieces = pieces.flatMap((p) => rectMinus(p, t));
    for (const rect of pieces) {
      if (rect.w <= 0.5 || rect.h <= 0.5) continue;
      taken.push(rect);
      const near = solid.filter((s) => touches(rect, s.band));
      const host = near.find((s) => s.wallType === w.wallType) || near[0] || null;
      result.push({ rect, wallType: w.wallType, host });
    }
  }
  return result;
}

// Удлиняет собственные стены на углах комнаты, чтобы угол замыкался без щели.
function extendOwnCorners(walls, roomsById) {
  const ownByRoom = new Map();
  for (const wall of walls) {
    if (wall.kind !== 'own') continue;
    const roomId = wall.rooms[0];
    if (!ownByRoom.has(roomId)) ownByRoom.set(roomId, []);
    ownByRoom.get(roomId).push(wall);
  }
  for (const [roomId, list] of ownByRoom) {
    const room = roomsById.get(roomId);
    if (!room) continue;
    const corners = roomPolygon(room);
    const legacyConcave = roomNotchInnerPoint(room);
    const concaves = corners.filter((point, index) => {
      const prev = corners[(index - 1 + corners.length) % corners.length];
      const next = corners[(index + 1) % corners.length];
      return (point.x - prev.x) * (next.y - point.y) - (point.y - prev.y) * (next.x - point.x) < 0;
    });
    if (legacyConcave) concaves.push(legacyConcave);
    for (const wall of list) {
      for (const end of ['from', 'to']) {
        const pos = wall[end];
        const point = wall.orient === 'h' ? { x: pos, y: wall.edge } : { x: wall.edge, y: pos };
        const isCorner = corners.some((c) => Math.abs(c.x - point.x) < 1 && Math.abs(c.y - point.y) < 1);
        const isConcave = concaves.some((c) => Math.abs(c.x - point.x) < 1 && Math.abs(c.y - point.y) < 1);
        if (!isCorner || isConcave) continue;
        // Перпендикулярная собственная стена, касающаяся того же угла.
        const perp = list.find((w) => w !== wall && w.orient !== wall.orient &&
          (Math.abs(w.from - (wall.orient === 'h' ? point.y : point.x)) < 1 ||
           Math.abs(w.to - (wall.orient === 'h' ? point.y : point.x)) < 1) &&
          Math.abs(w.edge - (wall.orient === 'h' ? point.x : point.y)) < 1);
        if (!perp) continue;
        const grow = perp.thickness;
        if (wall.orient === 'h') {
          if (end === 'from') { wall.band.x -= grow; wall.band.w += grow; }
          else { wall.band.w += grow; }
        } else if (end === 'from') { wall.band.y -= grow; wall.band.h += grow; }
        else { wall.band.h += grow; }
      }
    }
  }
}

// Сегмент стены, на котором лежит сторона/offset (для проёмов).
export function wallAt(walls, roomId, side, offset) {
  for (const wall of walls) {
    const wallSide = wall.sides?.[roomId];
    if (wallSide !== side) continue;
    if (offset >= wall.from - 1 && offset <= wall.to + 1) return wall;
  }
  return null;
}

// Мировая геометрия проёма: прямоугольник поперёк полотна стены.
export function openingRect(project, opening, walls) {
  const room = project.rooms.find((r) => r.id === opening.roomId);
  if (!room) return null;
  const edge = sideEdge(room, opening.side);
  if (!edge) return null;
  const absCenter = (edge.orient === 'h' ? room.x : room.y) + opening.offset;
  const wall = wallAt(walls, opening.roomId, opening.side, absCenter);
  if (!wall) return null;
  const half = opening.width / 2;
  const rect = wall.orient === 'h'
    ? { x: absCenter - half, y: wall.band.y, w: opening.width, h: wall.band.h }
    : { x: wall.band.x, y: absCenter - half, w: wall.band.w, h: opening.width };
  return { rect, wall, absCenter };
}

// Зона открывания двери: квадрат width×width внутри комнаты, в которую она открывается.
export function doorSwingRect(project, opening, walls) {
  if (opening.kind !== 'door') return null;
  const placed = openingRect(project, opening, walls);
  if (!placed) return null;
  const { rect, wall } = placed;
  const room = project.rooms.find((r) => r.id === opening.roomId);
  // Куда открывается: swingIn — внутрь комнаты-владельца, иначе наружу/в соседнюю.
  let dir;
  if (wall.orient === 'h') {
    const inwardOfOwner = room.y > rect.y ? 1 : -1; // владелец ниже стены => внутрь это +y
    dir = opening.swingIn ? inwardOfOwner : -inwardOfOwner;
    const y = dir > 0 ? rect.y + rect.h : rect.y - opening.width;
    return { x: rect.x, y, w: opening.width, h: opening.width };
  }
  const inwardOfOwner = room.x > rect.x ? 1 : -1;
  dir = opening.swingIn ? inwardOfOwner : -inwardOfOwner;
  const x = dir > 0 ? rect.x + rect.w : rect.x - opening.width;
  return { x, y: rect.y, w: opening.width, h: opening.width };
}

// Какие два пространства соединяет дверь: ['outside'|roomId, roomId].
export function doorLink(project, opening, walls) {
  if (opening.kind !== 'door') return null;
  const placed = openingRect(project, opening, walls);
  if (!placed) return null;
  const { wall } = placed;
  if (wall.kind === 'shared') return [wall.rooms[0], wall.rooms[1]];
  const room = project.rooms.find((r) => r.id === opening.roomId);
  if (room && room.parentId) return [room.id, room.parentId];
  return [opening.roomId, 'outside'];
}

// Геометрия символа двери (петля, закрытое/открытое положение створки, точка
// дуги). Используется и рендером, и DXF-экспортом — чертёж и экспорт совпадают.
// Типы дверей и окон (opening.type; нет поля — первый тип).
export const DOOR_TYPES = {
  single: 'Одностворчатая',
  double: 'Двустворчатая',
  sliding: 'Раздвижная',
  none: 'Проём без двери',
};
export const WINDOW_TYPES = {
  standard: 'Обычное',
  panoramic: 'Панорамное (в пол)',
};

// Четыре варианта двери при установке пробелом: петли с двух сторон ×
// открывание внутрь/наружу. Вариант 4 снова равен исходному.
export function doorPlacementVariant(opening, turns = 0) {
  const variant = ((turns % 4) + 4) % 4;
  return {
    ...opening,
    hingeStart: variant === 1 || variant === 2 ? !opening.hingeStart : opening.hingeStart,
    swingIn: variant === 2 || variant === 3 ? !opening.swingIn : opening.swingIn,
  };
}

// Распашные створки двери: одна (single) или две половины от обоих косяков
// (double); у раздвижной и проёма без двери створок-дуг нет.
export function doorLeaves(project, opening, walls) {
  const type = opening.type || 'single';
  if (type === 'double') {
    const half = opening.width / 2;
    return [
      doorSymbol(project, { ...opening, width: half, offset: opening.offset - half / 2, hingeStart: true }, walls),
      doorSymbol(project, { ...opening, width: half, offset: opening.offset + half / 2, hingeStart: false }, walls),
    ].filter(Boolean);
  }
  if (type !== 'single') return [];
  const one = doorSymbol(project, opening, walls);
  return one ? [one] : [];
}

export function doorSymbol(project, opening, walls) {
  const placed = openingRect(project, opening, walls);
  if (!placed) return null;
  const { rect, wall } = placed;
  const room = project.rooms.find((r) => r.id === opening.roomId);
  if (!room) return null;
  const width = opening.width;
  let hinge;
  let closed;
  let open;
  if (wall.orient === 'h') {
    const inwardOfOwner = room.y > rect.y ? 1 : -1;
    const dir = opening.swingIn ? inwardOfOwner : -inwardOfOwner;
    const faceY = dir > 0 ? rect.y + rect.h : rect.y;
    const hx = opening.hingeStart ? rect.x : rect.x + rect.w;
    const cx = opening.hingeStart ? rect.x + rect.w : rect.x;
    hinge = { x: hx, y: faceY };
    closed = { x: cx, y: faceY };
    open = { x: hx, y: faceY + dir * width };
  } else {
    const inwardOfOwner = room.x > rect.x ? 1 : -1;
    const dir = opening.swingIn ? inwardOfOwner : -inwardOfOwner;
    const faceX = dir > 0 ? rect.x + rect.w : rect.x;
    const hy = opening.hingeStart ? rect.y : rect.y + rect.h;
    const cy = opening.hingeStart ? rect.y + rect.h : rect.y;
    hinge = { x: faceX, y: hy };
    closed = { x: faceX, y: cy };
    open = { x: faceX + dir * width, y: hy };
  }
  const ux = (closed.x - hinge.x) / width;
  const uy = (closed.y - hinge.y) / width;
  const vx = (open.x - hinge.x) / width;
  const vy = (open.y - hinge.y) / width;
  const k = Math.SQRT1_2;
  const through = { x: hinge.x + (ux + vx) * k * width, y: hinge.y + (uy + vy) * k * width };
  return { hinge, closed, open, through, rect, wall };
}

// Допустимый диапазон offset для проёма на данной стороне (центр проёма).
export function clampOpeningOffset(project, opening, walls, desiredOffset) {
  const room = project.rooms.find((r) => r.id === opening.roomId);
  if (!room) return desiredOffset;
  const edge = sideEdge(room, opening.side);
  if (!edge) return null;
  const base = edge.orient === 'h' ? room.x : room.y;
  const abs = base + desiredOffset;
  // Ищем сегмент, которому принадлежит желаемая позиция (или ближайший).
  let best = null;
  let bestDist = Infinity;
  for (const wall of walls) {
    if (wall.sides?.[opening.roomId] !== opening.side) continue;
    const lo = wall.from + opening.width / 2 + 50;
    const hi = wall.to - opening.width / 2 - 50;
    if (lo > hi) continue;
    const clamped = Math.min(hi, Math.max(lo, abs));
    const dist = Math.abs(clamped - abs);
    if (dist < bestDist) { bestDist = dist; best = clamped; }
  }
  if (best === null) return null; // нет стены, куда помещается проём
  return best - base;
}
