// Общая стена при растяжении блока ручкой (как в Revit: двигаешь стену —
// меняются обе комнаты). Чистый модуль, без DOM.
//
// Раньше ручка грани растягивала только выбранную комнату: зазор с соседом
// рос (общая перегородка толщиной = зазор, >450 мм — две свои стены с белой
// щелью) или уходил в перекрытие (съедание), магнит 300 мм то прижимал
// грань обратно, то отпускал — стена «то разделялась, то соединялась».
//
// Теперь у подвижной грани ищутся «попутчики»: встречные грани соседей того
// же уровня вложенности на расстоянии 0…MAX_SHARED_GAP (там derive ставит
// общую перегородку) с перекрытием вдоль стыка — и транзитивно встречные к
// ним (сосед длиннее стыка тянет за собой и тех, кто стоит напротив него
// дальше). Каждый кадр попутчики восстанавливаются из снимка начала жеста и
// их грань сдвигается на тот же сдвиг, что и грань выбранной комнаты, —
// зазор (толщина перегородки) не меняется, результат не зависит от пути.
// Сосед короче/длиннее по стыку двигает свою грань целиком (она и есть
// его сторона стены); Г-образный сосед — своё ребро (moveShapedEdge).

import { isShaft } from './catalog.js';
import { captureOpeningAnchors, reanchorOpenings } from './opening-anchor.js';
import { clampRoomNotch, roomBoundaryEdges } from './room-shape.js';
import { MIN_ROOM_SIZE, MIN_SHAFT_SIZE, validateRoomPlacement } from './rooms.js';
import { MAX_SHARED_GAP } from './v7/model.js';
import { moveRectEdge, moveShapedEdge, restoreRoom } from './wall-edit.js';

const EPS = 0.5;
const SIDE_OF = { n: 0, e: 1, s: 2, w: 3 };
const axisOf = (edge) => (edge.orient === 'v' ? 'x' : 'y');
const overlap = (a, b) => Math.min(a.to, b.to) - Math.max(a.from, b.from);

// Грани прямоугольной ручки ('e', 'ne', …) комнаты room.
export function handleEdges(room, handle) {
  const sides = [...String(handle)].map((c) => SIDE_OF[c]).filter((s) => s !== undefined);
  return roomBoundaryEdges(room).filter((e) => sides.includes(e.side));
}

// Ребро формы, на котором стоит ручка-середина (Г-комната, контур).
export function edgeAtPoint(room, point) {
  return roomBoundaryEdges(room).find((e) => (e.orient === 'h'
    ? Math.abs(point.y - e.edge) < EPS && point.x >= e.from - EPS && point.x <= e.to + EPS
    : Math.abs(point.x - e.edge) < EPS && point.y >= e.from - EPS && point.y <= e.to + EPS)) || null;
}

// Попутчики подвижных граней movingEdges комнаты movingId.
// shapeOf(room) — номинальная форма (у съеденной — eatBase.base).
// → [{ id, edges: [{ side, orient, edge, from, to, outward, axis }] }]
export function findFollowers(rooms, movingId, movingEdges, { shapeOf = (r) => r, maxGap = MAX_SHARED_GAP } = {}) {
  const moving = rooms.find((r) => r.id === movingId);
  if (!moving || !movingEdges?.length) return [];
  const ctx = moving.parentId || null;
  const others = rooms.filter((r) => r.id !== movingId && (r.parentId || null) === ctx)
    .map((r) => ({ id: r.id, edges: roomBoundaryEdges(shapeOf(r)) }));
  const picked = new Map(); // id → edges
  const seen = new Set();
  const queue = movingEdges.map((e) => ({ ...e, axis: axisOf(e), owner: movingId }));
  while (queue.length) {
    const e = queue.shift();
    for (const o of others) {
      for (const f of o.edges) {
        if (f.orient !== e.orient || f.outward !== -e.outward) continue;
        const dist = (f.edge - e.edge) * e.outward;
        if (dist < -EPS || dist > maxGap + EPS || overlap(e, f) <= 1) continue;
        const key = `${o.id}|${f.index}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const entry = {
          side: f.side, orient: f.orient, edge: f.edge, from: f.from, to: f.to, outward: f.outward, axis: axisOf(f),
          gap: Math.max(0, dist),
        };
        if (!picked.has(o.id)) picked.set(o.id, []);
        picked.get(o.id).push(entry);
        queue.push({ ...entry, owner: o.id });
      }
    }
  }
  return [...picked].map(([id, edges]) => ({ id, edges }));
}

// Начало жеста: снимки попутчиков (комнаты уже с номинальной формой).
export function startFollow(project, followers) {
  return followers.map((f) => {
    const room = project.rooms.find((r) => r.id === f.id);
    return room && { ...f, start: structuredClone(room), anchors: captureOpeningAnchors(project, room) };
  }).filter(Boolean);
}

const minOf = (room) => (isShaft(room) ? MIN_SHAFT_SIZE : MIN_ROOM_SIZE);

// Допустимый сдвиг по осям, чтобы прямоугольные попутчики не стали меньше
// минимума. → { x: { lo, hi }, y: { lo, hi } } (lo ≤ 0 ≤ hi).
export function followLimits(follow) {
  const lim = { x: { lo: -Infinity, hi: Infinity }, y: { lo: -Infinity, hi: Infinity } };
  for (const f of follow) {
    for (const axis of ['x', 'y']) {
      const c = f.edges.filter((e) => e.axis === axis && typeof e.side === 'number')
        .reduce((sum, e) => sum + e.outward, 0);
      if (!c) continue;
      const size = axis === 'x' ? f.start.w : f.start.h;
      const bound = (minOf(f.start) - size) / c; // size + delta·c ≥ min
      if (c > 0) lim[axis].lo = Math.max(lim[axis].lo, Math.min(0, bound));
      else lim[axis].hi = Math.min(lim[axis].hi, Math.max(0, bound));
    }
  }
  return lim;
}

export const clampDelta = (value, { lo, hi }) => Math.max(lo, Math.min(hi, value));

// Деление общей стены (core/wall-split.js): у соседа на концах ребра-половины
// стоят пары совпадающих вершин. Когда половина сдвинута, пара становится
// ступенькой — её линию надо отнести на толщину перегородки от ступеньки
// тянущей комнаты (та — ровно в точке деления), иначе в углу уступа зазор
// меньше перегородки и сосед «съедается». Ступенька смотрит на ступеньку
// тянущей комнаты, поэтому её линия = точка деления − outward·gap.
function offsetSplitSteps(room, start, e, gap) {
  if (!gap || !Array.isArray(room.outline) || !Array.isArray(start?.outline)) return;
  if (room.outline.length !== start.outline.length) return;
  const was = start.outline.map((p) => ({ x: start.x + Number(p.x), y: start.y + Number(p.y) }));
  const pts = room.outline.map((p) => ({ x: room.x + Number(p.x), y: room.y + Number(p.y) }));
  const n = pts.length;
  const across = e.orient === 'v' ? 'x' : 'y'; // ось сдвига ребра
  const along = e.orient === 'v' ? 'y' : 'x'; // ось ступеньки (её линия)
  let changed = false;
  for (let i = 0; i < n; i += 1) {
    const j = (i + 1) % n;
    const a = was[i]; const b = was[j];
    // В начале жеста — пара совпадающих вершин на линии ребра e, в его конце.
    if (Math.abs(a.x - b.x) > EPS || Math.abs(a.y - b.y) > EPS) continue;
    if (Math.abs(a[across] - e.edge) > EPS) continue;
    if (Math.abs(a[along] - e.from) > EPS && Math.abs(a[along] - e.to) > EPS) continue;
    const p = pts[i]; const q = pts[j];
    if (Math.abs(p[across] - q[across]) < EPS) continue; // ступеньки нет (сдвиг 0)
    // outward ступеньки: наружу от комнаты (обход контура, как roomBoundaryEdges).
    const outward = e.orient === 'v' ? (q.x > p.x ? -1 : 1) : (q.y > p.y ? 1 : -1);
    p[along] = q[along] = a[along] - outward * gap;
    changed = true;
  }
  if (changed) room.outline = pts.map((p) => ({ x: p.x - room.x, y: p.y - room.y }));
}

// Кадр жеста: попутчики — из снимка, их грани сдвинуты на delta { x, y }.
// delta = null — оторвать (попутчики стоят как в начале жеста).
// → { ok, clamped: [], lost: [] } (ok = false — ребро сложной формы не сдвинулось).
export function applyFollow(project, follow, delta) {
  const out = { ok: true, clamped: [], lost: [] };
  for (const f of follow) {
    const room = project.rooms.find((r) => r.id === f.id);
    if (!room) continue;
    restoreRoom(room, f.start);
    for (const e of f.edges) {
      const d = delta ? delta[e.axis] || 0 : 0;
      if (!d) continue;
      const shaped = Boolean(room.outline || (room.notch && typeof e.side === 'string'));
      if (!shaped) {
        // Г-сосед (вырез у этой стороны): внутренняя линия выреза не стыкуется
        // с этой стеной — стоит на месте, меняется размер выреза.
        const n = room.notch && { ...room.notch };
        moveRectEdge(room, e.side, e.edge + d);
        if (n) {
          if (e.side === 3 && n.corner.endsWith('w')) n.w -= d;
          if (e.side === 1 && n.corner.endsWith('e')) n.w += d;
          if (e.side === 0 && n.corner.startsWith('n')) n.h -= d;
          if (e.side === 2 && n.corner.startsWith('s')) n.h += d;
          if (n.w >= 1 && n.h >= 1) room.notch = n; else delete room.notch;
          clampRoomNotch(room);
        }
        continue;
      }
      // Индексы рёбер формы могли смениться после прошлого ребра — ищем по месту.
      const cur = roomBoundaryEdges(room).find((c) => c.orient === e.orient && c.outward === e.outward &&
        Math.abs(c.edge - e.edge) < EPS && overlap(c, e) > 1);
      if (!cur || !moveShapedEdge(room, cur, e.edge + d)) out.ok = false;
      else offsetSplitSteps(room, f.start, e, e.gap || 0);
    }
    const report = reanchorOpenings(project, room, f.anchors);
    out.clamped.push(...report.clamped); out.lost.push(...report.lost);
  }
  return out;
}

// Проверка попутчиков после кадра (размер, вложенные в них помещения).
export function followVerdict(project, follow) {
  for (const f of follow) {
    const room = project.rooms.find((r) => r.id === f.id);
    if (!room) continue;
    const v = validateRoomPlacement(project, room, room.id);
    if (!v.ok) return { ok: false, reason: `Соседнее помещение «${room.name}»: ${v.reason}` };
    for (const child of project.rooms) {
      if (child.parentId !== room.id) continue;
      const cv = validateRoomPlacement(project, child, child.id);
      if (!cv.ok) return { ok: false, reason: `«${child.name}» перестаёт помещаться: ${cv.reason}` };
    }
  }
  return { ok: true };
}
