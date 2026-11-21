// Исправление зазора между комнатами, «≠ N мм» (core/gaps.js): общая стена
// возникает, только когда зазор равен толщине перегородки пары. Три способа:
//   move    — сдвинуть комнату целиком (planGapMove);
//   stretch — растянуть (или сузить) только обращённую сторону комнаты:
//             остальные стороны и стыковки не двигаются;
//   thicken — оставить комнаты на месте, а щель сделать общей стеной такой
//             толщины (wallOverrides пары); не больше MAX_SHARED_GAP.
// Автостыковка (autoDockFix): после жеста, если зазор отличается от толщины
// перегородки не больше чем на AUTO_DOCK_MM, исправляется комнатой, которую
// только что двигали или растягивали: перетаскивание — сдвиг, растягивание —
// растяжение стороны. Без DOM: UI — ui/plan-actions.js.

import { findNearMissGaps, planGapMove, trialRoomChange } from './gaps.js';
import { MIN_ROOM_SIZE } from './rooms.js';
import { clampWallThickness, stretchRoomShape } from './wall-thickness.js';
import { MAX_SHARED_GAP } from './walls.js';

export const AUTO_DOCK_MM = 60;

const roomOf = (project, id) => (project.rooms || []).find((r) => r.id === id);

// Растянуть сторону комнаты r, обращённую к соседу (координата edge, внешняя
// нормаль o вдоль оси axis), на shift наружу (shift < 0 — сузить).
function stretchFacingEdge(r, axis, edge, o, shift) {
  const size = axis === 'x' ? 'w' : 'h';
  const was = r[size];
  stretchRoomShape(r, axis, edge - o, o, shift);
  if (!(r[size] >= MIN_ROOM_SIZE) && r[size] < was) return { ok: false, reason: `«${r.name}» станет уже ${MIN_ROOM_SIZE} мм` };
  return { ok: true };
}

// План растяжения: { move: { roomId, name, shift, axis, edge, outward, target }, reason }.
// opts.prefer / opts.only — как у planGapMove; без prefer сначала меньшая комната.
export function planGapStretch(project, gap, opts = {}) {
  const a = roomOf(project, gap.a);
  const b = roomOf(project, gap.b);
  if (!a || !b) return { move: null, reason: 'Комната не найдена' };
  const delta = gap.gap - gap.target; // >0 — щель шире: сторона идёт наружу, <0 — уже: внутрь
  const area = (r) => (r.w || 0) * (r.h || 0);
  let order = area(b) <= area(a) ? [b, a] : [a, b];
  if (opts.prefer === a.id || opts.prefer === b.id) {
    const first = opts.prefer === a.id ? a : b;
    order = opts.only ? [first] : [first, first === a ? b : a];
  }
  const reasons = [];
  for (const room of order) {
    const other = room === a ? b : a;
    const isA = room === a;
    const outward = isA ? gap.outward : -gap.outward;
    const edge = gap.edges?.[isA ? 'a' : 'b'];
    if (!Number.isFinite(edge)) { reasons.push('нет координаты стороны'); continue; }
    const shift = outward * delta;
    const verdict = trialRoomChange(project, room.id, other.id, (trial) => stretchFacingEdge(
      trial.rooms.find((r) => r.id === room.id), gap.axis, edge, outward, shift,
    ));
    if (verdict.ok) {
      return {
        move: { roomId: room.id, name: room.name, shift, axis: gap.axis, edge, outward, distance: Math.abs(delta), direction: delta > 0 ? 'out' : 'in' },
        reason: null,
      };
    }
    reasons.push(`«${room.name}»: ${verdict.reason}`);
  }
  return { move: null, reason: reasons.join('; ') };
}

// Применить план растяжения к проекту (активный этаж). { ok, reason? }.
export function applyGapStretch(project, move) {
  const room = roomOf(project, move.roomId);
  if (!room) return { ok: false, reason: 'Комната не найдена' };
  return stretchFacingEdge(room, move.axis, move.edge, move.outward, move.shift);
}

// План «стена толщиной N мм»: { thickness, reason } (thickness = null — нельзя).
export function planGapThicken(project, gap) {
  const t = Math.round(gap.gap);
  if (gap.gap > MAX_SHARED_GAP) return { thickness: null, reason: `щель больше ${MAX_SHARED_GAP} мм` };
  if (clampWallThickness(t) !== t) return { thickness: null, reason: `стена ${t} мм — вне допустимой толщины` };
  const trial = { ...project, wallOverrides: { ...(project.wallOverrides || {}), [gap.key]: { ...(project.wallOverrides?.[gap.key] || {}), thickness: t } } };
  const still = findNearMissGaps(trial, { move: false }).some((g) => g.key === gap.key);
  if (still) return { thickness: null, reason: 'общая стена не образуется' };
  return { thickness: t, reason: null };
}

export function applyGapThicken(project, gap, thickness) {
  project.wallOverrides = { ...(project.wallOverrides || {}) };
  project.wallOverrides[gap.key] = { ...(project.wallOverrides[gap.key] || {}), thickness };
  return { ok: true };
}

// Обычный прямоугольник: без контура и выреза. У «съеденных» и Г-образных комнат
// грань зазора сдвинута самим съеданием (core/v7/eat-bridge.js) — их автоматически
// не стыкуем, только кнопками: иначе сторона уйдёт дальше, чем остановил палец.
const plain = (project, id) => {
  const r = roomOf(project, id);
  return Boolean(r) && !(Array.isArray(r.outline) && r.outline.length) && !r.notch;
};

// Автостыковка после правки комнат roomIds. kind: 'move' | 'stretch'.
// opts.changed — Map «ключ пары → зазор до правки»: стыкуются только зазоры, которые
// появились или изменились этой правкой, а не прежние.
// Возвращает { gap, fix: 'move' | 'stretch', plan } или null.
export function autoDockFix(project, roomIds, kind, opts = {}) {
  const ids = new Set(roomIds);
  const gaps = findNearMissGaps(project, { move: false })
    .filter((g) => (ids.has(g.a) || ids.has(g.b)) && Math.abs(g.gap - g.target) <= AUTO_DOCK_MM
      && plain(project, g.a) && plain(project, g.b) && (!opts.changed || opts.changed.get(g.key) !== g.gap))
    .sort((x, y) => Math.abs(x.gap - x.target) - Math.abs(y.gap - y.target));
  for (const gap of gaps) {
    const prefer = ids.has(gap.a) ? gap.a : gap.b;
    if (kind === 'stretch') {
      const plan = planGapStretch(project, gap, { prefer, only: true });
      if (plan.move) return { gap, fix: 'stretch', plan: plan.move };
    } else {
      const plan = planGapMove(project, gap, { prefer, only: true });
      if (plan.move) return { gap, fix: 'move', plan: plan.move };
    }
  }
  return null;
}
