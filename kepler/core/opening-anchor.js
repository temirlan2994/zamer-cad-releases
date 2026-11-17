// Проёмы при изменении формы комнаты. Отступ проёма хранится от room.x
// (горизонтальные стены) или room.y (вертикальные), поэтому любое изменение
// room.x/y или нумерации сторон контура без пересчёта сдвигает окна и двери.
//
// Порядок: captureOpeningAnchors(project, room) ДО правки → правка формы →
// reanchorOpenings(project, room, anchors). Пересчёт идёт от снимка, поэтому
// его можно вызывать многократно при перетаскивании.
//
// Правило: проём на стене, которая сама сдвинулась (её линия ушла), остаётся
// на ней с тем же отступом от её начала; проём на стене, линия которой не
// сдвинулась, сохраняет абсолютное положение (или map[ось](положение), если
// задано отображение — так растяжение общей стеной везёт дальнюю часть).
// Если проём больше не помещается на стене — прижимается к её краю (clamped).

import { finalizeRoomOutline, roomBoundaryEdges, roomPolygon } from './room-shape.js';
import { sideEdge } from './walls.js';

const EPS = 0.5;
const alongBase = (room, orient) => (orient === 'h' ? room.x : room.y);
const alongAxis = (orient) => (orient === 'h' ? 'x' : 'y');

function distToRange(v, from, to) {
  if (v < from) return from - v;
  if (v > to) return v - to;
  return 0;
}

function openingEdge(room, opening, abs) {
  const edges = roomBoundaryEdges(room).filter((edge) => edge.side === opening.side);
  if (edges.length) {
    return edges.sort((a, b) => distToRange(abs(a), a.from, a.to) - distToRange(abs(b), b.from, b.to))[0];
  }
  if (typeof opening.side === 'number') return { ...sideEdge(room, opening.side), side: opening.side, index: null };
  return null;
}

// Снимок абсолютных положений проёмов комнаты и её контура.
export function captureOpeningAnchors(project, room) {
  const poly = roomPolygon(room).map((p) => ({ x: p.x, y: p.y }));
  const list = [];
  for (const opening of project.openings || []) {
    if (opening.roomId !== room.id) continue;
    const absFor = (edge) => alongBase(room, edge.orient) + Number(opening.offset);
    const edge = openingEdge(room, opening, absFor);
    if (!edge) continue;
    list.push({
      id: opening.id,
      offset: opening.offset,
      side: opening.side,
      abs: absFor(edge),
      orient: edge.orient, edge: edge.edge, from: edge.from, to: edge.to, outward: edge.outward,
      index: Number.isInteger(edge.index) ? edge.index : null,
    });
  }
  return { roomId: room.id, poly, list };
}

// Ребро того же номера в новом контуре (если число вершин не изменилось).
function edgeByIndex(room, anchors, a) {
  if (a.index === null) return null;
  const poly = roomPolygon(room);
  if (poly.length !== anchors.poly.length) return null;
  const edge = roomBoundaryEdges(room).find((candidate) => candidate.index === a.index);
  return edge && edge.orient === a.orient && edge.outward === a.outward ? edge : null;
}

// Ребро на той же линии с той же внешней стороной, ближайшее к точке.
function edgeOnLine(room, a, at) {
  return roomBoundaryEdges(room)
    .filter((edge) => edge.orient === a.orient && edge.outward === a.outward && Math.abs(edge.edge - a.edge) < 1)
    .sort((p, q) => distToRange(at, p.from, p.to) - distToRange(at, q.from, q.to))[0] || null;
}

// Пересчитывает side/offset проёмов комнаты по снимку. map — необязательные
// отображения абсолютных координат { x: (v) => v', y: (v) => v' } для стен,
// линия которых не сдвинулась. Возвращает { clamped: [id], lost: [id] }.
export function reanchorOpenings(project, room, anchors, map = {}) {
  const clamped = [];
  const lost = [];
  const byId = new Map((project.openings || []).map((o) => [o.id, o]));
  for (const a of anchors?.list || []) {
    const opening = byId.get(a.id);
    if (!opening || opening.roomId !== room.id) continue;
    const mapAlong = map[alongAxis(a.orient)] || ((v) => v);
    let edge = edgeByIndex(room, anchors, a);
    let at;
    if (edge && Math.abs(edge.edge - a.edge) > EPS) {
      at = edge.from + (a.abs - a.from); // стена сдвинулась — едем вместе с ней
    } else {
      at = mapAlong(a.abs);
      if (!edge) edge = edgeOnLine(room, a, at);
    }
    if (!edge) {
      // Стена исчезла: оставляем как было, решит reconcileOpenings.
      opening.side = a.side; opening.offset = a.offset;
      lost.push(a.id);
      continue;
    }
    const half = (Number(opening.width) || 0) / 2;
    const lo = edge.from + half;
    const hi = edge.to - half;
    const pos = lo > hi ? (edge.from + edge.to) / 2 : Math.max(lo, Math.min(hi, at));
    if (Math.abs(pos - at) > EPS) clamped.push(a.id);
    opening.side = edge.side;
    opening.offset = pos - alongBase(room, edge.orient);
  }
  return { clamped, lost };
}

// Выполняет правку формы fn() и сохраняет проёмы комнаты.
export function keepOpenings(project, room, fn, map) {
  const anchors = captureOpeningAnchors(project, room);
  const result = fn();
  return { result, ...reanchorOpenings(project, room, anchors, map) };
}

// finalizeRoomOutline меняет room.x/y (габарит) и номера сторон контура —
// проёмы остаются на месте.
export function finalizeRoomOutlineKeepOpenings(project, room) {
  return keepOpenings(project, room, () => finalizeRoomOutline(room)).result;
}
