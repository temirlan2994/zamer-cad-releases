// Деление стены точкой (чистый модуль, без DOM). Собственная стена — в контур
// её комнаты, общая — в контуры ОБЕИХ комнат в одной и той же точке вдоль стыка
// вставляются две совпадающие вершины: форма не меняется, а грань каждой
// комнаты на стене становится двумя рёбрами. Дальше половину тянут ручкой
// (жест 'shape-resize'), встречное ребро соседа едет с ней (core/wall-follow.js:
// у соседа это отдельное ребро той же длины на той же линии).
// Атомарно: сначала проверка на копиях, потом правка; если правка задела
// проёмы (точка деления на двери/окне) — всё возвращается как было.

import { isShaft } from './catalog.js';
import { keepOpenings } from './opening-anchor.js';
import { roomBoundaryEdges, roomPolygon, WALL_SPLIT_MIN_GAP } from './room-shape.js';
import { liftRoom, nominalShape } from './v7/eat-bridge.js';
import { restoreRoom } from './wall-edit.js';

const EPS = 0.5;
const clone = (value) => structuredClone(value);

// Поперечный интервал тела стены: грани комнат лежат на его краях.
function wallAcross(wall) {
  const b = wall.band;
  if (b) return wall.orient === 'h' ? { lo: b.y, hi: b.y + b.h } : { lo: b.x, hi: b.x + b.w };
  const t = Number(wall.thickness) || 0;
  const mid = wall.center ? (wall.orient === 'h' ? (wall.center.y1 + wall.center.y2) / 2 : (wall.center.x1 + wall.center.x2) / 2) : wall.edge;
  return { lo: Math.min(wall.edge, mid - t / 2), hi: Math.max(wall.edge, mid + t / 2) };
}

// Грань формы shape на теле стены, внутри которой (с отступом minGap от её
// концов) лежит точка at. Предпочтение — грани, обращённой к стене.
export function wallFaceAt(shape, wall, at, minGap = WALL_SPLIT_MIN_GAP) {
  const { lo, hi } = wallAcross(wall);
  const mid = (lo + hi) / 2;
  const faces = (e) => Math.abs(mid - e.edge) < EPS || Math.sign(mid - e.edge) === e.outward;
  return roomBoundaryEdges(shape)
    .filter((e) => e.orient === wall.orient && e.edge >= lo - 1 && e.edge <= hi + 1 &&
      at >= e.from + minGap - EPS && at <= e.to - minGap + EPS)
    .sort((a, b) => Number(faces(b)) - Number(faces(a)))[0] || null;
}

// Две совпадающие вершины в точке at на ребре линии line (строго: точка не
// ближе minGap к концам ребра, иначе false и комната не меняется).
export function insertSplitVertices(room, orient, line, at, minGap = WALL_SPLIT_MIN_GAP) {
  const points = roomPolygon(room);
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i]; const b = points[(i + 1) % points.length];
    const onLine = orient === 'h'
      ? Math.abs(a.y - b.y) < EPS && Math.abs(a.y - line) < EPS
      : Math.abs(a.x - b.x) < EPS && Math.abs(a.x - line) < EPS;
    if (!onLine) continue;
    const from = orient === 'h' ? Math.min(a.x, b.x) : Math.min(a.y, b.y);
    const to = orient === 'h' ? Math.max(a.x, b.x) : Math.max(a.y, b.y);
    if (at < from + minGap - EPS || at > to - minGap + EPS) continue;
    const p = orient === 'h' ? { x: at, y: a.y } : { x: a.x, y: at };
    points.splice(i + 1, 0, { ...p }, { ...p });
    room.outline = points.map((q) => ({ x: q.x - room.x, y: q.y - room.y }));
    delete room.notch;
    return true;
  }
  return false;
}

// Деление стены wall (own | shared) в точке at (координата вдоль оси стены,
// в осях дома). Съеденные комнаты поднимаются до номинала (как в жесте).
// → { ok: true, roomIds } | { ok: false, reason } (при отказе проект не тронут).
export function splitWallRooms(project, wall, at, { minGap = WALL_SPLIT_MIN_GAP } = {}) {
  if (!wall || !['own', 'shared'].includes(wall.kind) || !Number.isFinite(at)) {
    return { ok: false, reason: 'Эту стену разделить нельзя' };
  }
  const rooms = (wall.rooms || []).map((id) => project.rooms.find((r) => r.id === id));
  if (!rooms.length || rooms.some((r) => !r)) return { ok: false, reason: 'Помещение стены не найдено' };
  const shared = wall.kind === 'shared';
  if (shared && rooms.length !== 2) return { ok: false, reason: 'Эту стену разделить нельзя' };
  if (shared) {
    const odd = rooms.find((r) => isShaft(r) || r.parentId);
    if (odd) return { ok: false, reason: `«${odd.name}» — ${isShaft(odd) ? 'шахта' : 'вложенное помещение'}: общую стену с ним разделить нельзя` };
  }
  // Проверка на номиналах (копии): у каждой комнаты есть ребро на стене,
  // точка не ближе minGap к его концам.
  const plan = [];
  for (const room of rooms) {
    const shape = clone(nominalShape(room));
    const face = wallFaceAt(shape, wall, at, minGap);
    if (!face || !insertSplitVertices(shape, wall.orient, face.edge, at, minGap)) {
      return {
        ok: false,
        reason: shared
          ? `У «${room.name}» в этом месте нет участка стены длиннее ${minGap} мм по обе стороны — разделить нельзя`
          : 'На этом коротком участке стену разделить нельзя',
      };
    }
    plan.push({ room, face });
  }
  if (shared && plan[0].face.outward !== -plan[1].face.outward) {
    return { ok: false, reason: 'Грани помещений на этой стене не встречные — разделить нельзя' };
  }
  // Правка. Снимки — для отката, если точка деления попала на проём.
  const backups = rooms.map((r) => clone(r));
  const openings = clone(project.openings || []);
  const rollback = () => {
    rooms.forEach((r, i) => restoreRoom(r, backups[i]));
    if (Array.isArray(project.openings)) project.openings.splice(0, project.openings.length, ...openings);
  };
  for (const { room, face } of plan) {
    liftRoom(project, room.id);
    const report = keepOpenings(project, room, () => insertSplitVertices(room, wall.orient, face.edge, at, minGap));
    if (!report.result) { rollback(); return { ok: false, reason: 'На этом коротком участке стену разделить нельзя' }; }
    if (report.clamped.length || report.lost.length) {
      rollback();
      return { ok: false, reason: 'Точка деления попадает на дверь или окно — сдвиньте её' };
    }
  }
  return { ok: true, roomIds: rooms.map((r) => r.id) };
}
