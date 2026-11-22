// Перила открытых помещений (терраса, балкон, крыльцо) — объект плана.
//
// room.railings (необязательно) — сегменты вдоль сторон габарита комнаты:
//   { id, side: 0..3, from, to, type, height }
// from/to — мм от начала стороны (левого конца у горизонтальной 0/2,
// верхнего у вертикальной 1/3), type — RAILING_TYPES, height — мм.
// Поля нет (старые проекты, новые террасы) — перила по умолчанию: свободные
// стороны без участков примыкания к дому и соседям (core/walls.js
// openRoomRailingSegments). Первая правка материализует их в room.railings
// с теми же id (materializeRailings), выбор при этом не теряется.
// Перенос комнаты: сегменты едут вместе (отсчёт от начала стороны);
// растяжение: остаются на своей стороне и зажимаются по её длине;
// поворот на 90° — turnRailings (как core/wall-spans.js turnSpans).

import { DEFAULT_EXTERIOR, isOpenRoom } from './catalog.js';
import { openRoomRailingSegments, sideEdge } from './walls.js';

export const RAILING_TYPES = [
  { id: 'rails', title: 'Поручни' },
  { id: 'balusters', title: 'Балясины' },
  { id: 'glass', title: 'Стекло' },
];
export const RAILING_HEIGHT = 1000;
export const RAILING_MIN_HEIGHT = 500;
export const RAILING_MAX_HEIGHT = 1400;
export const RAILING_MIN_LEN = 50;
// Перила на плане: наружная линия по грани площадки, внутренняя — на INSET внутрь.
export const RAILING_INSET = 70;

const TYPE_IDS = new Set(RAILING_TYPES.map((t) => t.id));
const SIDES = [0, 1, 2, 3];
const round = (v) => Math.round(v);

export const sideLength = (room, side) => (side % 2 === 0 ? room.w : room.h);
export const railingTypeTitle = (type) => RAILING_TYPES.find((t) => t.id === type)?.title || type;

export function clampRailingHeight(h) {
  const v = Number(h);
  if (!(v > 0)) return RAILING_HEIGHT;
  return Math.min(RAILING_MAX_HEIGHT, Math.max(RAILING_MIN_HEIGHT, round(v)));
}

let seq = 0;
export function railingId() {
  seq += 1;
  return `rl-${Date.now().toString(36)}${seq.toString(36)}`;
}

// Список из файла (без комнаты): битые записи отбрасываются, поля
// приводятся к виду, лишние поля сохраняются. Не массив — null.
export function normalizeRailingList(list) {
  if (!Array.isArray(list)) return null;
  const out = [];
  const ids = new Set();
  for (const s of list) {
    if (!s || typeof s !== 'object') continue;
    const side = Number(s.side);
    if (!SIDES.includes(side)) continue;
    let from = Number(s.from);
    let to = Number(s.to);
    if (!Number.isFinite(from) || !Number.isFinite(to)) continue;
    if (to < from) [from, to] = [to, from];
    from = Math.max(0, from);
    if (to - from < RAILING_MIN_LEN) continue;
    let id = typeof s.id === 'string' && s.id ? s.id : railingId();
    if (ids.has(id)) id = railingId();
    ids.add(id);
    out.push({
      ...s, id, side, from: round(from), to: round(to),
      type: TYPE_IDS.has(s.type) ? s.type : 'rails', height: clampRailingHeight(s.height),
    });
  }
  return out;
}

// Перила по умолчанию: id стабильны (сторона + начало) — выбор переживает
// перерисовку и материализацию.
export function defaultRailings(room, rooms, settings) {
  const exterior = Number(settings?.exterior) || DEFAULT_EXTERIOR;
  return openRoomRailingSegments(room, rooms, { exterior }).map((s) => {
    const base = s.orient === 'h' ? room.x : room.y;
    const from = round(s.from - base);
    return { id: `auto-${s.side}-${from}`, side: s.side, from, to: round(s.to - base), type: 'rails', height: RAILING_HEIGHT };
  });
}

export const hasOwnRailings = (room) => Array.isArray(room?.railings);

// Сегмент, зажатый по длине стороны (не меняет исходный); короче минимума — null.
function clampToRoom(room, seg) {
  const len = sideLength(room, seg.side);
  const from = Math.max(0, Math.min(seg.from, len));
  const to = Math.max(0, Math.min(seg.to, len));
  if (to - from < RAILING_MIN_LEN) return null;
  return from === seg.from && to === seg.to ? seg : { ...seg, from, to };
}

// Сегменты комнаты (свои или по умолчанию), зажатые по сторонам.
export function railingList(room, rooms, settings) {
  if (!room || !isOpenRoom(room)) return [];
  const list = hasOwnRailings(room) ? room.railings : defaultRailings(room, rooms, settings);
  return list.map((s) => clampToRoom(room, s)).filter(Boolean);
}

// Геометрия сегмента в плане: ориентация, линия грани, наружу, концы a…b.
export function railingGeometry(room, seg) {
  const e = sideEdge(room, seg.side);
  return {
    ...seg, orient: e.orient, edge: e.edge, outward: e.outward,
    a: e.from + seg.from, b: e.from + seg.to, sideFrom: e.from, sideTo: e.to,
  };
}

export function roomRailings(room, rooms, settings) {
  return railingList(room, rooms, settings).map((s) => railingGeometry(room, s));
}

// Все перила этажа (project — проект/этаж с rooms и settings).
export function projectRailings(project) {
  const out = [];
  for (const room of project.rooms || []) {
    if (!isOpenRoom(room)) continue;
    for (const seg of roomRailings(room, project.rooms, project.settings)) out.push({ room, seg });
  }
  return out;
}

export function materializeRailings(room, rooms, settings) {
  if (!hasOwnRailings(room)) room.railings = defaultRailings(room, rooms, settings);
  else room.railings = room.railings.map((s) => clampToRoom(room, s)).filter(Boolean);
  return room.railings;
}

export function findRailing(room, id) {
  return hasOwnRailings(room) ? room.railings.find((s) => s.id === id) || null : null;
}

// Новые границы сегмента (мм от начала стороны), зажатые по стороне;
// длина не меньше RAILING_MIN_LEN. → сегмент или null.
export function setRailingRange(room, id, from, to) {
  const seg = findRailing(room, id);
  if (!seg) return null;
  const len = sideLength(room, seg.side);
  let a = Math.max(0, Math.min(len, Number(from)));
  let b = Math.max(0, Math.min(len, Number(to)));
  if (b < a) [a, b] = [b, a];
  if (b - a < RAILING_MIN_LEN) {
    if (a + RAILING_MIN_LEN <= len) b = a + RAILING_MIN_LEN; else a = b - RAILING_MIN_LEN;
  }
  seg.from = round(a);
  seg.to = round(b);
  return seg;
}

// Сдвиг одного конца ('a' — начало, 'b' — конец) к позиции at (мм от
// начала стороны); второй конец на месте.
export function moveRailingEnd(room, id, end, at) {
  const seg = findRailing(room, id);
  if (!seg) return null;
  const len = sideLength(room, seg.side);
  const v = Math.max(0, Math.min(len, Number(at)));
  if (end === 'a') seg.from = round(Math.min(v, seg.to - RAILING_MIN_LEN));
  else seg.to = round(Math.max(v, seg.from + RAILING_MIN_LEN));
  seg.from = Math.max(0, seg.from);
  seg.to = Math.min(len, seg.to);
  return seg;
}

// Разрыв: сегмент делится в точке at (по умолчанию — посередине) на два;
// gap — ширина разрыва. → id новой (второй) части или null.
export function splitRailing(room, id, at = null, gap = 0) {
  const seg = findRailing(room, id);
  if (!seg) return null;
  const mid = at == null ? (seg.from + seg.to) / 2 : Number(at);
  const g = Math.max(0, Number(gap) || 0);
  const leftTo = round(mid - g / 2);
  const rightFrom = round(mid + g / 2);
  if (leftTo - seg.from < RAILING_MIN_LEN || seg.to - rightFrom < RAILING_MIN_LEN) return null;
  const part = { ...seg, id: railingId(), from: rightFrom };
  seg.to = leftTo;
  room.railings.splice(room.railings.indexOf(seg) + 1, 0, part);
  return part.id;
}

export function removeRailing(room, id) {
  if (!hasOwnRailings(room)) return false;
  const n = room.railings.length;
  room.railings = room.railings.filter((s) => s.id !== id);
  return room.railings.length < n;
}

export function setRailingProps(room, id, patch = {}) {
  const seg = findRailing(room, id);
  if (!seg) return null;
  if (patch.type !== undefined && TYPE_IDS.has(patch.type)) seg.type = patch.type;
  if (patch.height !== undefined) seg.height = clampRailingHeight(patch.height);
  return seg;
}

export function nextRailingType(type) {
  const i = RAILING_TYPES.findIndex((t) => t.id === type);
  return RAILING_TYPES[(i + 1) % RAILING_TYPES.length].id;
}

export const sideHasRailing = (list, side) => list.some((s) => s.side === side);

// «Перила на этой стороне»: on — сторона целиком (вместо прежних кусков),
// тип и высота — как у соседних перил; off — все сегменты стороны убираются.
export function setSideRailing(room, rooms, settings, side, on) {
  const list = materializeRailings(room, rooms, settings);
  const sample = list.find((s) => s.side === side) || list[0];
  room.railings = list.filter((s) => s.side !== side);
  if (!on) return null;
  const seg = {
    id: railingId(), side, from: 0, to: round(sideLength(room, side)),
    type: sample?.type || 'rails', height: sample?.height || RAILING_HEIGHT,
  };
  room.railings.push(seg);
  room.railings.sort((p, q) => p.side - q.side || p.from - q.from);
  return seg.id;
}

// Поворот комнаты на 90° по часовой (ось Y вниз): сторона s → s+1;
// горизонтальная сторона становится вертикальной с тем же отсчётом,
// вертикальная — горизонтальной с отсчётом от другого конца (oldH — высота
// комнаты до поворота).
export function turnRailings(list, oldH) {
  if (!Array.isArray(list)) return list;
  return list.map((s) => (s.side % 2 === 0
    ? { ...s, side: (s.side + 1) % 4 }
    : { ...s, side: (s.side + 1) % 4, from: round(oldH - s.to), to: round(oldH - s.from) }));
}

// Попадание точки p (мм плана) в перила комнаты: полоса между наружной и
// внутренней линией, допуск tol. → { room, seg, at } (at — мм от начала стороны).
export function railingHit(project, p, tol = 60) {
  let best = null;
  for (const { room, seg } of projectRailings(project)) {
    const along = seg.orient === 'h' ? p.x : p.y;
    const across = seg.orient === 'h' ? p.y : p.x;
    const inner = seg.edge - seg.outward * RAILING_INSET;
    const lo = Math.min(seg.edge, inner);
    const hi = Math.max(seg.edge, inner);
    const dAcross = across < lo ? lo - across : across > hi ? across - hi : 0;
    const dAlong = along < seg.a ? seg.a - along : along > seg.b ? along - seg.b : 0;
    if (dAcross > tol || dAlong > tol) continue;
    const score = dAcross + dAlong;
    if (!best || score < best.score) {
      best = { room, seg, score, at: Math.max(seg.from, Math.min(seg.to, along - seg.sideFrom)) };
    }
  }
  return best;
}

// Длина перил этажа, мм (ТЭП, спецификация).
export function railingsLength(project) {
  return projectRailings(project).reduce((t, { seg }) => t + (seg.to - seg.from), 0);
}
