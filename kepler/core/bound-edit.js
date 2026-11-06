// Правка помещения по стенам «как обычного» (docs/walls-v2-architecture.md,
// раздел 2.7). Чистый модуль без DOM.
//
// Контур помещения по стенам — не истина, а заливка петли ручных стен
// (core/bound-rooms.js). Поэтому любая правка помещения транслируется в
// правку его стен, а контур пересчитывается заливкой:
//   • сторона/угол (ручки, ширина и глубина в свойствах) → moveManualWall
//     стен, чья грань лежит на этой стороне (примыкающие стены сдвигают
//     торцы — так работает moveManualWall); контур «в свету» следует за
//     гранью, т. е. за осью + половиной толщины;
//   • перенос и поворот группы → те же преобразования стен петли (проёмы
//     host едут сами — t от начала оси), seed и кеш контура;
//   • копия → копии стен петли с проёмами + новое помещение с новым seed.
// После каждой правки проверяется, что помещения остались замкнутыми и
// соседние не сломались; иначе правка откатывается с понятной причиной.

import { makeId } from './model.js';
import { MIN_LOOP_SIZE, followBoundRooms, resolveBoundRooms } from './bound-rooms.js';
import { isBoundRoom, roomContainsPoint, roomRects, roomShapeArea } from './room-shape.js';
import { deriveWalls, manualWallGeometry, wallRects } from './walls.js';
import { moveManualWall } from './wall-manual.js';

const EPS = 1; // мм
const clone = (value) => JSON.parse(JSON.stringify(value));

// ---------------------------------------------------------------- Снимок этажа

const LEVEL_LISTS = ['walls', 'rooms', 'openings', 'items'];

// Снимок активного этажа (стены, помещения, проёмы, мебель, параметры стен)
// для отката правки и для перетаскивания «от начала».
export function levelSnapshot(project) {
  return JSON.stringify({
    walls: project.walls || [], rooms: project.rooms || [], openings: project.openings || [],
    items: project.items || [], wallOverrides: project.wallOverrides || {},
  });
}

// Возврат к снимку: массивы этажа меняются на месте (объекты — новые копии).
export function restoreLevel(project, snap) {
  const data = JSON.parse(snap);
  for (const key of LEVEL_LISTS) {
    if (Array.isArray(project[key])) project[key].splice(0, project[key].length, ...data[key]);
    else project[key] = data[key];
  }
  if (project.wallOverrides) {
    for (const key of Object.keys(project.wallOverrides)) delete project.wallOverrides[key];
    Object.assign(project.wallOverrides, data.wallOverrides);
  }
}

// ---------------------------------------------------------------- Стороны и стены

// Стороны внешнего контура (ребро i: poly[i] → poly[i+1]). outward — знак
// наружной нормали по поперечной оси (+1: снаружи большая координата).
export function boundEdges(room) {
  const poly = isBoundRoom(room) && Array.isArray(room.poly) ? room.poly : [];
  const probe = { bound: room?.bound, poly };
  const out = [];
  for (let i = 0; i < poly.length; i += 1) {
    const a = poly[i]; const b = poly[(i + 1) % poly.length];
    const h = Math.abs(a.y - b.y) < 0.5;
    const v = Math.abs(a.x - b.x) < 0.5;
    if (h === v) continue;
    const orient = h ? 'h' : 'v';
    const edge = h ? a.y : a.x;
    const from = h ? Math.min(a.x, b.x) : Math.min(a.y, b.y);
    const to = h ? Math.max(a.x, b.x) : Math.max(a.y, b.y);
    const mid = (from + to) / 2;
    const plus = h ? roomContainsPoint(probe, mid, edge + 2) : roomContainsPoint(probe, edge + 2, mid);
    out.push({ index: i, orient, edge, from, to, outward: plus ? -1 : 1 });
  }
  return out;
}

const overlapLen = (a0, a1, b0, b1) => Math.min(a1, b1) - Math.max(a0, b0);

// Ручные стены, чья грань лежит на стороне e (тело — снаружи помещения).
function edgeWalls(project, e) {
  const out = [];
  for (const w of project.walls || []) {
    if (w.roomBounding === false) continue;
    const g = manualWallGeometry(w);
    if (!g || g.orient !== e.orient) continue;
    const face = e.outward > 0 ? g.lo : g.hi;
    if (Math.abs(face - e.edge) > EPS) continue;
    if (overlapLen(g.from, g.to, e.from, e.to) <= EPS) continue;
    out.push({ wall: w, g });
  }
  return out;
}

// Сторона целиком закрыта ручными стенами (с их углами и узлами — куски
// тела из deriveWalls)? Проба — линия в 1 мм снаружи стороны.
function edgeCovered(e, derived) {
  const line = e.edge + e.outward;
  const spans = [];
  for (const w of derived || []) {
    if (w.kind !== 'manual') continue;
    for (const r of wallRects(w)) {
      if (e.orient === 'h' ? (r.y <= line && r.y + r.h >= line) : (r.x <= line && r.x + r.w >= line)) {
        spans.push(e.orient === 'h' ? [r.x, r.x + r.w] : [r.y, r.y + r.h]);
      }
    }
  }
  spans.sort((a, b) => a[0] - b[0]);
  let at = e.from;
  for (const [s0, s1] of spans) {
    if (s0 > at + EPS) return false;
    at = Math.max(at, s1);
  }
  return at >= e.to - EPS;
}

// Стены петли помещения: грани на его сторонах + стены-колонны внутри контура.
export function boundLoopWalls(project, room) {
  const ids = new Set();
  if (!isBoundRoom(room) || !Array.isArray(room.poly)) return ids;
  for (const e of boundEdges(room)) for (const { wall } of edgeWalls(project, e)) ids.add(wall.id);
  const outer = { bound: room.bound, poly: room.poly };
  for (const w of project.walls || []) {
    const g = manualWallGeometry(w);
    if (!g || w.roomBounding === false) continue;
    if (roomContainsPoint(outer, g.band.x + g.band.w / 2, g.band.y + g.band.h / 2)) ids.add(w.id);
  }
  return ids;
}

// Контур замыкают не только ручные стены (стены блок-комнат)?
function closedByBlocks(project, room, derived = deriveWalls(project)) {
  return boundEdges(room).some((e) => !edgeCovered(e, derived));
}

// ---------------------------------------------------------------- Проверка

function boundState(project) {
  const map = new Map();
  for (const r of project.rooms || []) {
    if (isBoundRoom(r)) map.set(r.id, { issue: r.boundIssue || null, area: roomShapeArea(r), name: r.name });
  }
  return map;
}

// Пересчёт контуров после правки стен и проверка: помещения правки
// (subjects: Map(id → { area, box } | null)) замкнуты, а с ожиданием — той
// же площади и на ожидаемом месте; остальные, бывшие замкнутыми, — тоже.
function settle(project, before, subjects, expected = new Map()) {
  const walls = deriveWalls(project);
  followBoundRooms(project, walls, expected);
  resolveBoundRooms(project, walls);
  for (const room of project.rooms) {
    if (!isBoundRoom(room)) continue;
    if (subjects.has(room.id)) {
      if (room.boundIssue === 'merged') {
        return { ok: false, reason: `«${room.name}» слилось бы с соседним помещением` };
      }
      if (room.boundIssue) {
        return {
          ok: false,
          reason: closedByBlocks(project, room) || before.get(room.id)?.blocks
            ? `Контур «${room.name}» замыкают стены других помещений — выделите их вместе или двигайте стены`
            : `«${room.name}» перестанет быть замкнутым`,
        };
      }
      // Перенос, поворот, копия: контур тот же и там, где ожидали.
      const want = subjects.get(room.id);
      if (!want) continue;
      const box = want.box;
      const off = box && Math.max(Math.abs(room.x - box.x), Math.abs(room.y - box.y), Math.abs(room.w - box.w), Math.abs(room.h - box.h));
      if (off > 2 || Math.abs(roomShapeArea(room) - want.area) > Math.max(10_000, want.area * 0.002)) {
        return {
          ok: false,
          reason: before.get(room.id)?.blocks
            ? `Контур «${room.name}» замыкают стены других помещений — выделите их вместе или двигайте стены`
            : `«${room.name}» наезжает на стены или помещения — выберите другое место`,
        };
      }
    } else {
      const was = before.get(room.id);
      if (was && !was.issue && room.boundIssue) {
        return { ok: false, reason: `Сломается помещение «${room.name}» — его контур перестанет быть замкнутым` };
      }
    }
  }
  return { ok: true };
}

// ---------------------------------------------------------------- Стороны и углы

// Ручка помещения по стенам (core/room-shape.js, kind: 'edge' | 'vertex',
// index) → сдвиги сторон [{ index, delta }] до точки p.
export function boundHandleMoves(room, handle, p) {
  const edges = boundEdges(room);
  const byIndex = new Map(edges.map((e) => [e.index, e]));
  const n = room.poly?.length || 0;
  const list = handle.kind === 'edge' ? [handle.index] : [(handle.index - 1 + n) % n, handle.index];
  const moves = [];
  for (const i of list) {
    const e = byIndex.get(i);
    if (!e) continue;
    const delta = (e.orient === 'h' ? p.y : p.x) - e.edge;
    if (Math.abs(delta) > 0.01) moves.push({ index: i, delta });
  }
  return moves;
}

// Ожидаемый контур после сдвига сторон; null — контур вывернулся бы или
// сторона стала бы короче MIN_LOOP_SIZE.
function shiftedPoly(room, moves) {
  const pts = room.poly.map((p) => ({ x: p.x, y: p.y }));
  const n = pts.length;
  const edges = new Map(boundEdges(room).map((e) => [e.index, e]));
  for (const { index, delta } of moves) {
    const e = edges.get(index);
    const key = e.orient === 'h' ? 'y' : 'x';
    pts[index][key] = e.edge + delta;
    pts[(index + 1) % n][key] = e.edge + delta;
  }
  for (let i = 0; i < n; i += 1) {
    const a0 = room.poly[i]; const b0 = room.poly[(i + 1) % n];
    const a1 = pts[i]; const b1 = pts[(i + 1) % n];
    const d0 = (b0.x - a0.x) + (b0.y - a0.y);
    const d1 = (b1.x - a1.x) + (b1.y - a1.y);
    if (Math.sign(d0) !== Math.sign(d1) || Math.abs(d1) < Math.min(MIN_LOOP_SIZE, Math.abs(d0))) return null;
  }
  return pts;
}

// Сдвиг сторон помещения по стенам: moves = [{ index, delta }] (ребро i
// контура room.poly, delta — мм по нормали, +x/+y). Двигаются ручные стены,
// чьи грани лежат на этих сторонах; общие стены сдвигают и соседей.
// → { ok, walls: [id] } | { ok: false, reason } (проект не изменён).
export function moveBoundRoomEdges(project, roomId, moves) {
  const room = (project.rooms || []).find((r) => r.id === roomId);
  if (!isBoundRoom(room)) return { ok: false, reason: 'Помещение не найдено' };
  if (room.boundIssue) return { ok: false, reason: `«${room.name}» не замкнуто — двигайте его стены` };
  const list = (moves || []).filter((m) => Number.isFinite(m.delta) && Math.abs(m.delta) > 0.01);
  if (!list.length) return { ok: true, walls: [] };
  const edges = new Map(boundEdges(room).map((e) => [e.index, e]));
  const shift = new Map();
  const derived = deriveWalls(project);
  for (const m of list) {
    const e = edges.get(m.index);
    if (!e) return { ok: false, reason: 'Сторона не найдена' };
    const walls = edgeWalls(project, e);
    if (!walls.length || !edgeCovered(e, derived)) {
      return { ok: false, reason: 'Эту сторону образует стена другого помещения или торец стены — двигайте её саму' };
    }
    for (const { wall } of walls) {
      const prev = shift.get(wall.id);
      if (prev !== undefined && Math.abs(prev - m.delta) > 0.01) {
        return { ok: false, reason: 'Одна стена образует обе стороны — двигайте стену' };
      }
      shift.set(wall.id, m.delta);
    }
  }
  const pts = shiftedPoly(room, list);
  if (!pts) return { ok: false, reason: `Помещение уже ${MIN_LOOP_SIZE} мм не бывает` };
  const snap = levelSnapshot(project);
  const before = boundState(project);
  for (const [id, delta] of shift) {
    const res = moveManualWall(project, id, delta);
    if (!res.ok) { restoreLevel(project, snap); return res; }
  }
  const verdict = settle(project, before, new Map([[room.id, null]]), new Map([[room.id, pts]]));
  if (!verdict.ok) { restoreLevel(project, snap); return verdict; }
  return { ok: true, walls: [...shift.keys()] };
}

// Ширина/глубина в свойствах: как у обычной комнаты — левая и верхняя
// стороны стоят, правая (x + w) и нижняя (y + h) сдвигаются.
export function resizeBoundRoom(project, roomId, { w, h } = {}) {
  const room = (project.rooms || []).find((r) => r.id === roomId);
  if (!isBoundRoom(room)) return { ok: false, reason: 'Помещение не найдено' };
  const moves = [];
  for (const e of boundEdges(room)) {
    if (e.outward < 0) continue;
    if (Number.isFinite(w) && e.orient === 'v' && Math.abs(e.edge - (room.x + room.w)) < EPS) moves.push({ index: e.index, delta: w - room.w });
    if (Number.isFinite(h) && e.orient === 'h' && Math.abs(e.edge - (room.y + room.h)) < EPS) moves.push({ index: e.index, delta: h - room.h });
  }
  return moveBoundRoomEdges(project, roomId, moves);
}

// ---------------------------------------------------------------- Перенос и поворот

function mapBoundRoom(room, fn) {
  const pts = (list) => list.map((p) => fn(p));
  room.poly = pts(room.poly || []);
  if (Array.isArray(room.holes)) room.holes = room.holes.map(pts);
  room.bound = { ...room.bound, seed: fn(room.bound.seed) };
  if (room.poly.length) {
    const xs = room.poly.map((p) => p.x); const ys = room.poly.map((p) => p.y);
    room.x = Math.min(...xs); room.y = Math.min(...ys);
    room.w = Math.max(...xs) - room.x; room.h = Math.max(...ys) - room.y;
  }
}

// Преобразование группы с помещениями по стенам: fn (точка → точка) —
// сдвиг или поворот на 90°; other — правка остального груза (блок-комнаты,
// мебель, проёмы), validate — проверка блок-комнат. Стены петель едут вместе
// с помещениями; стена, общая с невыбранным помещением по стенам, — отказ.
// → { ok, reason?, warning? }; при отказе проект не изменён.
export function transformBoundGroup(project, cargo, fn, { apply = () => {}, validate = () => ({ ok: true }) } = {}) {
  const bound = cargo.rooms.filter(isBoundRoom);
  for (const room of bound) {
    if (room.boundIssue) return { ok: false, reason: `«${room.name}» не замкнуто — двигайте его стены` };
  }
  const ids = new Set(cargo.rooms.map((r) => r.id));
  const wallIds = new Set();
  for (const room of bound) for (const id of boundLoopWalls(project, room)) wallIds.add(id);
  for (const near of project.rooms) {
    if (!isBoundRoom(near) || ids.has(near.id) || near.boundIssue) continue;
    for (const id of boundLoopWalls(project, near)) {
      if (wallIds.has(id)) {
        return { ok: false, reason: `Стена общая с «${near.name}» — выделите и его или двигайте стены` };
      }
    }
  }
  const snap = levelSnapshot(project);
  const before = boundState(project);
  const derived = deriveWalls(project);
  for (const room of bound) if (closedByBlocks(project, room, derived)) before.get(room.id).blocks = true;
  const area = new Map(bound.map((r) => [r.id, roomShapeArea(r)]));
  for (const w of project.walls || []) {
    if (!wallIds.has(w.id)) continue;
    w.axis = { ...w.axis, a: fn(w.axis.a), b: fn(w.axis.b) };
  }
  for (const room of bound) mapBoundRoom(room, fn);
  const subjects = new Map(bound.map((r) => [r.id, { area: area.get(r.id), box: { x: r.x, y: r.y, w: r.w, h: r.h } }]));
  apply();
  const expected = new Map(bound.map((r) => [r.id, r.poly]));
  const blocks = validate();
  if (!blocks.ok) { restoreLevel(project, snap); return blocks; }
  const verdict = settle(project, before, subjects, expected);
  if (!verdict.ok) { restoreLevel(project, snap); return verdict; }
  return blocks.warning ? { ok: true, warning: blocks.warning } : { ok: true };
}

// ---------------------------------------------------------------- Копия

// Стены петель и их проёмы — для буфера и копии группы.
export function captureBoundWalls(project, rooms) {
  const ids = new Set();
  for (const room of rooms) for (const id of boundLoopWalls(project, room)) ids.add(id);
  return {
    walls: clone((project.walls || []).filter((w) => ids.has(w.id))),
    wallOpenings: clone((project.openings || []).filter((o) => o.host && ids.has(o.host.wallId))),
  };
}

const rectsHit = (a, b) => overlapLen(a.x, a.x + a.w, b.x, b.x + b.w) > EPS && overlapLen(a.y, a.y + a.h, b.y, b.y + b.h) > EPS;
const shiftRect = (r, dx, dy) => ({ x: r.x + dx, y: r.y + dy, w: r.w, h: r.h });

function footprint(source) {
  const rects = [];
  for (const w of source.walls || []) { const g = manualWallGeometry(w); if (g) rects.push(g.band); }
  for (const r of source.rooms) if (!r.parentId) rects.push(...roomRects(r));
  return rects;
}

function obstacles(project) {
  const rects = [];
  for (const w of project.walls || []) { const g = manualWallGeometry(w); if (g) rects.push(g.band); }
  for (const r of project.rooms || []) if (!r.parentId) rects.push(...roomRects(r));
  return rects;
}

// Копии стен, проёмов и помещений со сдвигом (dx, dy) — новые id, помещения
// по стенам — с новым seed и без статуса (open/merged).
function buildCopy(source, dx, dy) {
  const move = (p) => ({ x: p.x + dx, y: p.y + dy });
  const wallMap = new Map();
  const walls = (source.walls || []).map((w) => {
    const copy = clone(w);
    copy.id = makeId('wall');
    copy.axis = { ...copy.axis, a: move(w.axis.a), b: move(w.axis.b) };
    wallMap.set(w.id, copy.id);
    return copy;
  });
  const roomMap = new Map();
  const rooms = source.rooms.map((r) => {
    const copy = clone(r);
    copy.id = makeId('room');
    roomMap.set(r.id, copy.id);
    if (isBoundRoom(copy)) {
      mapBoundRoom(copy, move);
      delete copy.boundIssue;
      delete copy.boundWith;
    } else {
      copy.x += dx; copy.y += dy;
    }
    return copy;
  });
  for (const r of rooms) r.parentId = roomMap.get(r.parentId) || r.parentId || null;
  const openings = [
    ...(source.openings || []).filter((o) => roomMap.has(o.roomId)).map((o) => ({ ...clone(o), id: makeId(o.kind), roomId: roomMap.get(o.roomId) })),
    ...(source.wallOpenings || []).filter((o) => wallMap.has(o.host?.wallId)).map((o) => ({
      ...clone(o), id: makeId(o.kind), host: { ...o.host, wallId: wallMap.get(o.host.wallId) },
    })),
  ];
  return { walls, rooms, openings, roomMap };
}

// План копии группы с помещениями по стенам (Ctrl+D, Ctrl+V, вставка на
// другой этаж): место — то же (с другого этажа), иначе вплотную справа,
// слева, снизу, сверху, иначе отдельно справа. Стены петель копируются с
// проёмами; копия должна замкнуться и не задеть соседей. Проект не меняется.
// source — снимок captureRoomGroup (rooms, openings, walls, wallOpenings, levelId).
// → { ok, dx, dy, detached, rooms, openings, walls, roomMap } | { ok: false, reason }.
export function planBoundCopy(project, source) {
  const open = source.rooms.find((r) => isBoundRoom(r) && r.boundIssue);
  if (open) return { ok: false, reason: `«${open.name}» не замкнуто — копируйте его стены` };
  const foot = footprint(source);
  if (!foot.length) return { ok: false, reason: 'Нет помещений для копии' };
  const x0 = Math.min(...foot.map((r) => r.x)); const y0 = Math.min(...foot.map((r) => r.y));
  const bw = Math.max(...foot.map((r) => r.x + r.w)) - x0;
  const bh = Math.max(...foot.map((r) => r.y + r.h)) - y0;
  const busy = obstacles(project);
  const candidates = [];
  if (source.levelId && source.levelId !== project.activeLevel) candidates.push({ dx: 0, dy: 0 });
  candidates.push({ dx: bw, dy: 0 }, { dx: -bw, dy: 0 }, { dx: 0, dy: bh }, { dx: 0, dy: -bh });
  const maxX = busy.length ? Math.max(...busy.map((r) => r.x + r.w)) : x0 + bw;
  candidates.push({ dx: maxX + 1000 - x0, dy: 0, detached: true });
  let lastReason = null;
  for (const c of candidates) {
    if (!c.detached && foot.some((r) => busy.some((b) => rectsHit(shiftRect(r, c.dx, c.dy), b)))) continue;
    const built = buildCopy(source, c.dx, c.dy);
    const verdict = tryCopy(project, source, built);
    if (verdict.ok) return { ok: true, dx: c.dx, dy: c.dy, detached: Boolean(c.detached), ...built };
    lastReason = verdict.reason;
  }
  return { ok: false, reason: lastReason || 'Нет места для копии' };
}

// Пробная вставка копии и откат: копии помещений замкнуты, площадь та же.
function tryCopy(project, source, built) {
  if (!Array.isArray(project.walls)) project.walls = [];
  const before = boundState(project);
  const subjects = new Map();
  source.rooms.forEach((r, i) => {
    const c = built.rooms[i];
    if (isBoundRoom(r)) subjects.set(c.id, { area: roomShapeArea(r), box: { x: c.x, y: c.y, w: c.w, h: c.h } });
  });
  const counts = LEVEL_LISTS.map((k) => [k, (project[k] || []).length]);
  project.walls.push(...built.walls);
  project.rooms.push(...built.rooms);
  project.openings.push(...built.openings);
  const verdict = settle(project, before, subjects);
  for (const [k, n] of counts) project[k].splice(n);
  resolveBoundRooms(project, deriveWalls(project)); // кеш контуров — как до пробы
  for (const r of built.rooms) { delete r.boundIssue; delete r.boundWith; }
  return verdict;
}
