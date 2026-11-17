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
// общую перегородку) с перекрытием вдоль стыка. Каждый кадр попутчики
// восстанавливаются из снимка начала жеста и их грань сдвигается на тот же
// сдвиг, что и грань выбранной комнаты, — зазор (толщина перегородки) не
// меняется, результат не зависит от пути.
// • Сосед равный или короче по стыку двигает свою грань целиком (она и есть
//   его сторона стены); Г-образный сосед — своё ребро (moveShapedEdge). От
//   таких граней поиск идёт дальше (транзитивно).
// • Сосед ДЛИННЕЕ стыка (грань выходит за конец тянущейся грани) — уступ:
//   едет только участок его грани в пределах стыка, на концах участка две
//   вершины, контур становится Г/Т-образным (movePartialEdge). Остальная
//   грань и те, кто стоит напротив неё дальше (кухня рядом с санузлом под
//   общим коридором), не трогаются. Уступ стоит на продолжении боковой
//   стены тянущейся комнаты: сосед растёт — ровно по её грани, сосед
//   уменьшается — отнесён на толщину перегородки (как offsetSplitSteps).
//   Остаток грани у конца короче зазора + 100 мм или сосед — шахта — как
//   раньше: грань целиком.

import { isShaft } from './catalog.js';
import { captureOpeningAnchors, reanchorOpenings } from './opening-anchor.js';
import { clampRoomNotch, roomBoundaryEdges, roomPolygon, WALL_SPLIT_MIN_GAP } from './room-shape.js';
import { MIN_ROOM_SIZE, MIN_SHAFT_SIZE, validateRoomPlacement } from './rooms.js';
import { MAX_SHARED_GAP } from './v7/model.js';
import { moveRectEdge, moveShapedEdge, restoreRoom } from './wall-edit.js';

const EPS = 0.5;
const SIDE_OF = { n: 0, e: 1, s: 2, w: 3 };
const axisOf = (edge) => (edge.orient === 'v' ? 'x' : 'y');
const overlap = (a, b) => Math.min(a.to, b.to) - Math.max(a.from, b.from);
// Уступ соседа: остаток его грани за концом стыка — не короче зазора + этого;
// в оставшейся части соседа над уступом — не тоньше MIN_STEP_ARM.
const MIN_STUB = WALL_SPLIT_MIN_GAP;
export const MIN_STEP_ARM = 300;

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
// → [{ id, edges: [{ side, orient, edge, from, to, outward, axis, gap, partial? }] }]
// partial = { lo, hi, stepLo, stepHi } — уступ: едет только участок lo…hi
// (stepLo/stepHi — грань соседа выходит за этот конец, там ступенька).
export function findFollowers(rooms, movingId, movingEdges, { shapeOf = (r) => r, maxGap = MAX_SHARED_GAP } = {}) {
  const moving = rooms.find((r) => r.id === movingId);
  if (!moving || !movingEdges?.length) return [];
  const ctx = moving.parentId || null;
  const others = rooms.filter((r) => r.id !== movingId && (r.parentId || null) === ctx)
    .map((r) => ({ id: r.id, shaft: isShaft(r), edges: roomBoundaryEdges(shapeOf(r)) }));
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
        const gap = Math.max(0, dist);
        const entry = {
          side: f.side, orient: f.orient, edge: f.edge, from: f.from, to: f.to, outward: f.outward, axis: axisOf(f),
          gap,
        };
        // Грань соседа длиннее стыка — уступ (если остатки у концов достаточны).
        const beyondLo = e.from - f.from; const beyondHi = f.to - e.to;
        const stepLo = beyondLo > EPS; const stepHi = beyondHi > EPS;
        const enough = (b) => b <= EPS || b >= gap + MIN_STUB - EPS;
        const partial = (stepLo || stepHi) && !o.shaft && enough(beyondLo) && enough(beyondHi);
        if (partial) {
          entry.partial = { lo: Math.max(e.from, f.from), hi: Math.min(e.to, f.to), stepLo, stepHi };
        }
        if (!picked.has(o.id)) picked.set(o.id, []);
        picked.get(o.id).push(entry);
        if (!partial) queue.push({ ...entry, owner: o.id });
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

// Участок уступа вдоль грани при сдвиге d: сосед растёт (грань уходит
// наружу) — ровно по стыку; уменьшается — отнесён на толщину перегородки.
function stepSpan(e, d) {
  const off = d * e.outward > 0 ? 0 : (e.gap || 0);
  return {
    s1: e.partial.stepLo ? e.partial.lo - off : e.from,
    s2: e.partial.stepHi ? e.partial.hi + off : e.to,
  };
}

// Толщина соседа room за его гранью e на участке s1…s2 (до ближайшего
// параллельного ребра внутрь).
function depthBehind(room, e, s1, s2) {
  let depth = Infinity;
  for (const c of roomBoundaryEdges(room)) {
    if (c.orient !== e.orient || Math.min(c.to, s2) - Math.max(c.from, s1) <= EPS) continue;
    const dist = (e.edge - c.edge) * e.outward;
    if (dist > EPS) depth = Math.min(depth, dist);
  }
  return depth;
}

// Уступ: у соседа едет только участок грани e (в осях дома) на сдвиг d.
// На концах участка, где грань выходит за стык, — ступенька (две вершины),
// где не выходит — угол соседа едет вместе с участком. Габарит x/y/w/h —
// по новому контуру. → { s1, s2 } | null (контур схлопнулся бы).
export function movePartialEdge(room, e, d) {
  const { s1, s2 } = stepSpan(e, d);
  if (s2 - s1 < MIN_STUB) return null;
  if (e.partial.stepLo && s1 < e.from + MIN_STUB - EPS) return null;
  if (e.partial.stepHi && s2 > e.to - MIN_STUB + EPS) return null;
  if (d * e.outward < 0 && depthBehind(room, e, s1, s2) - Math.abs(d) < MIN_STEP_ARM - EPS) return null;
  const across = e.orient === 'h' ? 'y' : 'x';
  const along = e.orient === 'h' ? 'x' : 'y';
  const P = (v, c) => (e.orient === 'h' ? { x: v, y: c } : { x: c, y: v });
  const pts = roomPolygon(room);
  const n = pts.length;
  const i = pts.findIndex((a, k) => {
    const b = pts[(k + 1) % n];
    return Math.abs(a[across] - e.edge) < EPS && Math.abs(b[across] - e.edge) < EPS &&
      Math.min(a[along], b[along]) <= e.from + EPS && Math.max(a[along], b[along]) >= e.to - EPS;
  });
  if (i < 0) return null;
  const a = pts[i]; const b = pts[(i + 1) % n];
  const inc = b[along] > a[along];
  const low = inc ? a : b; const high = inc ? b : a;
  const line = e.edge; const moved = e.edge + d;
  const seq = [
    ...(e.partial.stepLo ? [{ ...low }, P(s1, line), P(s1, moved)] : [P(low[along], moved)]),
    ...(e.partial.stepHi ? [P(s2, moved), P(s2, line), { ...high }] : [P(high[along], moved)]),
  ];
  if (!inc) seq.reverse();
  const turned = [...pts.slice(i), ...pts.slice(0, i)]; // ребро a→b — первое
  const next = [...seq, ...turned.slice(2)];
  const xs = next.map((p) => p.x); const ys = next.map((p) => p.y);
  room.x = Math.min(...xs); room.y = Math.min(...ys);
  room.w = Math.max(...xs) - room.x; room.h = Math.max(...ys) - room.y;
  room.outline = next.map((p) => ({ x: p.x - room.x, y: p.y - room.y }));
  delete room.notch;
  return { s1, s2 };
}

// Допустимый сдвиг по осям, чтобы прямоугольные попутчики не стали меньше
// минимума, а у соседа с уступом осталось не меньше MIN_STEP_ARM над ним.
// → { x: { lo, hi }, y: { lo, hi } } (lo ≤ 0 ≤ hi).
export function followLimits(follow) {
  const lim = { x: { lo: -Infinity, hi: Infinity }, y: { lo: -Infinity, hi: Infinity } };
  for (const f of follow) {
    for (const e of f.edges) {
      if (!e.partial) continue;
      // Сосед уменьшается при d·outward < 0 (уступ — с отступом на перегородку).
      const { s1, s2 } = stepSpan(e, -e.outward);
      const bound = Math.max(0, depthBehind(f.start, e, s1, s2) - MIN_STEP_ARM);
      if (e.outward > 0) lim[e.axis].lo = Math.max(lim[e.axis].lo, -bound);
      else lim[e.axis].hi = Math.min(lim[e.axis].hi, bound);
    }
    for (const axis of ['x', 'y']) {
      const c = f.edges.filter((e) => e.axis === axis && typeof e.side === 'number' && !e.partial)
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

// Проём соседа на сдвинутом участке уступа (дверь в общей стене над
// санузлом) едет вместе с участком: та же точка вдоль стены, новая линия.
// reanchorOpenings оставил бы его на старой линии (число вершин сменилось).
// → Set id поправленных проёмов.
function followSteps(project, room, anchors, steps) {
  const fixed = new Set();
  const byId = new Map((project.openings || []).map((o) => [o.id, o]));
  for (const a of anchors?.list || []) {
    const opening = byId.get(a.id);
    if (!opening || opening.roomId !== room.id) continue;
    const half = (Number(opening.width) || 0) / 2;
    const s = steps.find(({ e, s1, s2 }) => a.orient === e.orient && a.outward === e.outward &&
      Math.abs(a.edge - e.edge) < 1 && a.abs - half >= s1 - EPS && a.abs + half <= s2 + EPS);
    if (!s) continue;
    const edge = roomBoundaryEdges(room).find((c) => c.orient === a.orient && c.outward === a.outward &&
      Math.abs(c.edge - (s.e.edge + s.d)) < EPS && a.abs - half >= c.from - EPS && a.abs + half <= c.to + EPS);
    if (!edge) continue;
    opening.side = edge.side;
    opening.offset = a.abs - (a.orient === 'h' ? room.x : room.y);
    fixed.add(a.id);
  }
  return fixed;
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
    const steps = []; // сдвинутые участки уступов — проёмы на них едут с ними
    for (const e of f.edges) {
      const d = delta ? delta[e.axis] || 0 : 0;
      if (!d) continue;
      if (e.partial) {
        const span = movePartialEdge(room, e, d);
        if (span) steps.push({ e, d, ...span }); else out.ok = false;
        continue;
      }
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
    const fixed = steps.length ? followSteps(project, room, f.anchors, steps) : new Set();
    out.clamped.push(...report.clamped.filter((id) => !fixed.has(id)));
    out.lost.push(...report.lost.filter((id) => !fixed.has(id)));
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
