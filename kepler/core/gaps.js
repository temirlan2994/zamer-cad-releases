// Нестандартные зазоры между комнатами: пары, стоящие напротив друг друга
// почти «впритык», но с зазором, не равным толщине общей стены. Общая стена
// (core/walls.js findAdjacencies) возникает только при точном зазоре —
// здесь такие промахи находятся и предлагается сдвиг, который их исправит.
// Без DOM: UI (ui/gaps.js) рисует маркеры и выполняет сдвиг.

import { isOpenRoom, isShaft } from './catalog.js';
import { moveRoomGroup } from './room-group.js';
import { roomBoundaryEdges, roomRects, roomShapeArea } from './room-shape.js';
import { MAX_SHARED_GAP, projectAdjacencies, sharedKey, sharedWallThickness } from './walls.js';

export const NEAR_MISS_MIN_OVERLAP = 300; // мм — минимальное перекрытие сторон по длине
const GAP_EPS = 1;

function rectsOverlapArea(a, b) {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

function overlapAreaOfRects(aRects, bRects) {
  let sum = 0;
  for (const a of aRects) for (const b of bRects) sum += rectsOverlapArea(a, b);
  return sum;
}

function roomsOverlapArea(a, b) {
  return overlapAreaOfRects(roomRects(a), roomRects(b));
}

function boundsOfRects(rects, room) {
  if (!rects.length) return {
    x0: Number(room?.x) || 0,
    y0: Number(room?.y) || 0,
    x1: (Number(room?.x) || 0) + (Number(room?.w) || 0),
    y1: (Number(room?.y) || 0) + (Number(room?.h) || 0),
  };
  let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
  for (const rect of rects) {
    x0 = Math.min(x0, rect.x); y0 = Math.min(y0, rect.y);
    x1 = Math.max(x1, rect.x + rect.w); y1 = Math.max(y1, rect.y + rect.h);
  }
  return { x0, y0, x1, y1 };
}

function boundsMayHaveNearMiss(a, b) {
  const sepX = Math.max(0, Math.max(a.x0, b.x0) - Math.min(a.x1, b.x1));
  const sepY = Math.max(0, Math.max(a.y0, b.y0) - Math.min(a.y1, b.y1));
  const overlapX = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
  const overlapY = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
  return (overlapY >= NEAR_MISS_MIN_OVERLAP && sepX <= MAX_SHARED_GAP)
    || (overlapX >= NEAR_MISS_MIN_OVERLAP && sepY <= MAX_SHARED_GAP);
}

function participates(room) {
  return !isOpenRoom(room) && !isShaft(room);
}

// Ближайшая пара противостоящих сторон двух комнат с промахом зазора.
function pairNearMiss(a, b, target, edgesA = roomBoundaryEdges(a), edgesB = roomBoundaryEdges(b)) {
  let best = null;
  for (const edgeA of edgesA) {
    for (const edgeB of edgesB) {
      if (edgeA.orient !== edgeB.orient || edgeA.outward === edgeB.outward) continue;
      const gap = (edgeB.edge - edgeA.edge) * edgeA.outward;
      if (gap <= GAP_EPS || gap > MAX_SHARED_GAP) continue;
      if (Math.abs(gap - target) <= GAP_EPS) continue;
      const from = Math.max(edgeA.from, edgeB.from);
      const to = Math.min(edgeA.to, edgeB.to);
      if (to - from < NEAR_MISS_MIN_OVERLAP) continue;
      if (!best || gap < best.gap || (gap === best.gap && to - from > best.to - best.from)) {
        best = { edgeA, edgeB, gap, from, to };
      }
    }
  }
  return best;
}

// Ключи общих стен комнаты (по парам), чтобы заметить разорванную стыковку.
function sharedPairsOf(project, roomId) {
  const keys = new Set();
  for (const adj of projectAdjacencies(project)) {
    if (adj.a.id === roomId || adj.b.id === roomId) keys.add(sharedKey(adj.a.id, adj.b.id));
  }
  return keys;
}

function cloneForTrial(project) {
  return {
    ...project,
    rooms: project.rooms.map((r) => structuredClone(r)),
    items: (project.items || []).map((i) => structuredClone(i)),
    openings: (project.openings || []).map((o) => structuredClone(o)),
    wallOverrides: structuredClone(project.wallOverrides || {}),
  };
}

// Проба изменения комнаты roomId на копии проекта: change(trial) делает правку
// и возвращает { ok, reason?, warning? }. Годится, если комната не наложилась
// на соседей, образовала общую стену с otherId и не потеряла другие стыковки.
// { ok } или { ok: false, reason }.
export function trialRoomChange(project, roomId, otherId, change) {
  const trial = cloneForTrial(project);
  const before = trial.rooms.find((r) => r.id === roomId);
  const siblingsBefore = new Map(trial.rooms
    .filter((r) => r.id !== roomId && (r.parentId || null) === (before.parentId || null))
    .map((r) => [r.id, roomsOverlapArea(before, r)]));
  const pairsBefore = sharedPairsOf(trial, roomId);
  const res = change(trial);
  if (!res.ok) return { ok: false, reason: res.reason || 'изменение недопустимо' };
  const moved = trial.rooms.find((r) => r.id === roomId);
  for (const other of trial.rooms) {
    if (!siblingsBefore.has(other.id)) continue;
    if (roomsOverlapArea(moved, other) > siblingsBefore.get(other.id) + 1) {
      return { ok: false, reason: `«${moved.name}» наложится на «${other.name}»` };
    }
  }
  const pairsAfter = sharedPairsOf(trial, roomId);
  if (!pairsAfter.has(sharedKey(roomId, otherId))) return { ok: false, reason: 'общая стена не образуется' };
  for (const key of pairsBefore) {
    if (pairsAfter.has(key)) continue;
    const lostId = key.split('|').slice(1).find((id) => id !== roomId);
    const lost = trial.rooms.find((r) => r.id === lostId);
    return { ok: false, lost: true, reason: `разорвётся стыковка «${moved.name}» с «${lost?.name || '?'}»` };
  }
  return { ok: true, warning: res.warning };
}

// Проба сдвига комнаты roomId на (dx, dy).
function tryMove(project, roomId, otherId, dx, dy) {
  return trialRoomChange(project, roomId, otherId, (trial) => moveRoomGroup(trial, [roomId], [], dx, dy));
}

// План сдвига для найденного зазора: сначала меньшая (не «якорная») комната,
// при неудаче — большая. move = null, если любой сдвиг ведёт к наложению или
// разрыву существующей стыковки; тогда reason объясняет почему.
// opts.prefer — id комнаты, которую пробовать первой (например, той, что только
// что двигали); opts.only — пробовать только её.
export function planGapMove(project, gap, opts = {}) {
  const delta = gap.target - gap.gap; // >0 — раздвинуть, <0 — сблизить
  const a = project.rooms.find((r) => r.id === gap.a);
  const b = project.rooms.find((r) => r.id === gap.b);
  if (!a || !b) return { move: null, reason: 'Комната не найдена' };
  // Пара уже стыкуется другой стороной (Г-комнаты): сдвиг разорвал бы её.
  if (projectAdjacencies(project).some((adj) => sharedKey(adj.a.id, adj.b.id) === sharedKey(a.id, b.id))) {
    return { move: null, reason: 'пара уже стыкуется по другой стороне — сдвиг разорвал бы общую стену' };
  }
  const outward = gap.outward; // внешняя нормаль стороны A к B
  const shiftFor = (roomId) => {
    const sign = roomId === gap.b ? 1 : -1;
    const d = delta * outward * sign;
    return gap.axis === 'x' ? { dx: d, dy: 0 } : { dx: 0, dy: d };
  };
  let order = roomShapeArea(b) <= roomShapeArea(a) ? [b, a] : [a, b];
  if (opts.prefer === a.id || opts.prefer === b.id) {
    const first = opts.prefer === a.id ? a : b;
    order = opts.only ? [first] : [first, first === a ? b : a];
  }
  const reasons = [];
  for (const room of order) {
    const other = room === a ? b : a;
    const { dx, dy } = shiftFor(room.id);
    const verdict = tryMove(project, room.id, other.id, dx, dy);
    if (verdict.ok) {
      return {
        move: {
          roomId: room.id, name: room.name, dx, dy,
          distance: Math.abs(delta), direction: delta > 0 ? 'apart' : 'closer',
          ...(verdict.warning ? { warning: verdict.warning } : {}),
        },
        reason: null,
      };
    }
    reasons.push(`сдвиг «${room.name}»: ${verdict.reason}`);
  }
  return { move: null, reason: reasons.join('; ') };
}

// Все промахи стыковки активного этажа. Каждая пара — один раз (ближайшая
// пара сторон). opts.move = false — без расчёта сдвига (дёшево, для отрисовки
// во время перетаскивания).
export function findNearMissGaps(project, opts = {}) {
  const withMove = opts.move !== false;
  const rooms = (project.rooms || []).filter(participates);
  const prepared = rooms.map((room) => {
    const rects = roomRects(room);
    return { room, rects, edges: roomBoundaryEdges(room), bounds: boundsOfRects(rects, room) };
  });
  const result = [];
  for (let i = 0; i < rooms.length; i += 1) {
    for (let j = i + 1; j < rooms.length; j += 1) {
      const pa = prepared[i];
      const pb = prepared[j];
      const a = pa.room;
      const b = pb.room;
      if ((a.parentId || null) !== (b.parentId || null)) continue;
      // Далёкая пара не может образовать зазор ≤ MAX_SHARED_GAP с нужным
      // перекрытием сторон. Точные контуры проверяются только у кандидатов.
      if (!boundsMayHaveNearMiss(pa.bounds, pb.bounds)) continue;
      // Перекрывающиеся комнаты (верхний уровень это допускает) — не промах стыковки.
      if (overlapAreaOfRects(pa.rects, pb.rects) > 1) continue;
      const target = sharedWallThickness(project, a.id, b.id);
      const hit = pairNearMiss(a, b, target, pa.edges, pb.edges);
      if (!hit) continue;
      const axis = hit.edgeA.orient === 'v' ? 'x' : 'y';
      const mid = hit.edgeA.edge + hit.edgeA.outward * (hit.gap / 2);
      const along = (hit.from + hit.to) / 2;
      const entry = {
        key: sharedKey(a.id, b.id),
        a: a.id, b: b.id, aName: a.name, bName: b.name,
        gap: hit.gap,
        target,
        overlap: { from: hit.from, to: hit.to },
        axis,
        outward: hit.edgeA.outward,
        edges: { a: hit.edgeA.edge, b: hit.edgeB.edge }, // координаты обращённых друг к другу граней
        at: axis === 'x' ? { x: mid, y: along } : { x: along, y: mid },
      };
      if (withMove) {
        const plan = planGapMove(project, entry);
        entry.move = plan.move;
        entry.reason = plan.reason;
      }
      result.push(entry);
    }
  }
  return result;
}
