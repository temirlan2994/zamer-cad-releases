// Привязка стен к координационным осям «как в Revit» (замок у стыка стены и
// оси). Чистый модуль без DOM. Формат полей — core/grid-pins-model.js.
//
// • Стена комнаты не хранится (её выводит deriveWalls), поэтому привязка —
//   у граней НОМИНАЛЬНЫХ форм комнат: room.axisPins [{ dir, gridId, off }].
//   Прикрепить стену = прикрепить грани всех её комнат (у общей — обеих):
//   грань = ось.at + off. Грань ищется по стороне и месту, а не по номеру
//   ребра/ключу стены — переживает перенос, растяжение, деление общей стены
//   и съедание (номинал съеденной комнаты не меняется).
// • Сдвиг оси (moveGridWithPins) двигает прикреплённые грани на тот же шаг;
//   встречные грани неприкреплённых соседей по общей стене едут с ними
//   (core/wall-follow.js) — перегородка не рвётся. Не получилось (комната
//   меньше минимума, налезает) — всё возвращается, ok: false.
// • Ручная стена: wall.axisPins { line, a, b } — линия оси (параллельная
//   ось) и торцы (перпендикулярные оси).
// • После любой правки syncGridPins снимает привязки, грань которых ушла с
//   оси (стену утащили дальше магнита, Alt — «оторвать»), и привязки к
//   удалённым осям. Ось сменила направление — привязка снимается.

import { levelProject } from './model.js';
import { roomBoundaryEdges } from './room-shape.js';
import { isShaft } from './catalog.js';
import { MIN_ROOM_SIZE, MIN_SHAFT_SIZE, validateRoomPlacement } from './rooms.js';
import { captureOpeningAnchors, reanchorOpenings } from './opening-anchor.js';
import { moveRectEdge, moveShapedEdge, moveWallBy } from './wall-edit.js';
import { dragManualWallEnd, moveManualWall } from './wall-manual.js';
import { manualWallGeometry } from './walls.js';
import { applyFollow, findFollowers, followVerdict, startFollow } from './wall-follow.js';
import { liftRoom, nominalShape, reconcileEats } from './v7/eat-bridge.js';

export const PIN_TOL = 1; // мм — грань «на месте привязки»
export const LOCK_TOL = 5; // мм — стена «лежит на оси» (замок показывается)

const clone = (v) => structuredClone(v);

// ------------------------------------------------------------- стороны

// Сторона ребра контура: 'n' | 's' (горизонтальные), 'w' | 'e' (вертикальные).
export function dirOf(edge) {
  if (edge.orient === 'h') return edge.outward < 0 ? 'n' : 's';
  return edge.outward < 0 ? 'w' : 'e';
}
export const dirOrient = (dir) => (dir === 'n' || dir === 's' ? 'h' : 'v');
// Ось, параллельная стене ориентации orient: горизонтальная стена — ось y (kind 'y').
export const gridKindFor = (orient) => (orient === 'h' ? 'y' : 'x');

const gridOf = (project, id) => (project?.grids || []).find((g) => g.id === id) || null;

// Этажи проекта: [{ level, view }] — view видит этаж как активный.
function levelsOf(project) {
  if (Array.isArray(project?.levels) && project.levels.length && project.activeLevel !== undefined) {
    return project.levels.map((level) => ({ level, view: levelProject(project, level.id) }));
  }
  return [{ level: project, view: project }];
}

// Ребро номинальной формы, которое держит привязка pin при положении оси at.
export function pinEdge(room, pin, at, tol = PIN_TOL) {
  const target = at + pin.off;
  const found = roomBoundaryEdges(nominalShape(room))
    .filter((e) => dirOf(e) === pin.dir && Math.abs(e.edge - target) <= tol)
    .sort((a, b) => (b.to - b.from) - (a.to - a.from));
  return found[0] || null;
}

// ------------------------------------------------------------- тело стены

// Тело стены (запись state.walls или ручная стена проекта):
// { orient, lo, hi, mid, from, to } — поперёк lo…hi, вдоль from…to.
export function wallBody(wall) {
  const b = wall?.band;
  if (!b || (wall.orient !== 'h' && wall.orient !== 'v')) return null;
  const [lo, hi] = wall.orient === 'h' ? [b.y, b.y + b.h] : [b.x, b.x + b.w];
  return { orient: wall.orient, lo, hi, mid: (lo + hi) / 2, from: wall.from, to: wall.to };
}

// Грани номинальной формы комнаты на теле стены (смотрят на тело).
export function facesOnBody(room, body) {
  return roomBoundaryEdges(nominalShape(room)).filter((e) => {
    if (e.orient !== body.orient) return false;
    if (e.edge < body.lo - PIN_TOL || e.edge > body.hi + PIN_TOL) return false;
    if (Math.min(e.to, body.to) - Math.max(e.from, body.from) <= 1) return false;
    return Math.abs(body.mid - e.edge) < 0.5 || Math.sign(body.mid - e.edge) === e.outward;
  });
}

// Опорные линии тела для привязки: 'axis' — ось стены, 'face' — грани.
export const wallRefs = (body, mode) => (mode === 'axis' ? [body.mid] : [body.lo, body.hi]);

// Магнит стены к осям при сдвиге поперёк на raw (мм): опорная линия тела
// встаёт на ближайшую ось своего направления в радиусе radius.
// extent(g) → { from, to } — пределы линии оси (стена должна их задевать).
// pinned { gridId, ref } — прикреплённая стена липнет к своей оси той же
// линией (иначе на 300 мм перескочила бы на другую грань тела).
// → { delta, grid, ref, dist } | null.
export function wallMagnet(body, raw, grids, { mode = 'face', radius = 300, extent = null, pinned = null } = {}) {
  if (!body) return null;
  const kind = gridKindFor(body.orient);
  let best = null;
  for (const g of grids || []) {
    if (g.hidden || g.kind !== kind) continue;
    if (extent) {
      const e = extent(g);
      if (Math.min(e.to, body.to) - Math.max(e.from, body.from) < 0) continue;
    }
    const refs = pinned?.gridId === g.id ? [pinned.ref] : wallRefs(body, mode);
    for (const ref of refs) {
      const dist = Math.abs(g.at - (ref + raw));
      if (dist > radius) continue;
      if (!best || dist < best.dist) best = { delta: g.at - ref, grid: g, ref, dist };
    }
  }
  return best;
}

// Ближайшая параллельная ось без ограничения радиуса (кнопка «Прикрепить»).
export function nearestWallGrid(body, grids, mode = 'face') {
  return wallMagnet(body, 0, grids, { mode, radius: Infinity });
}

// ------------------------------------------------------------- состояние

// Привязки стены (запись state.walls): [{ gridId, part, mode }].
export function wallPins(project, wall) {
  const out = [];
  if (!wall) return out;
  if (wall.kind === 'manual') {
    const mw = (project.walls || []).find((w) => w.id === wall.wallId);
    for (const part of ['line', 'a', 'b']) {
      const p = mw?.axisPins?.[part];
      if (p && gridOf(project, p.gridId)) out.push({ gridId: p.gridId, part, mode: p.mode || 'face' });
    }
    return out;
  }
  const body = wallBody(wall);
  if (!body) return out;
  const seen = new Set();
  for (const id of wall.rooms || []) {
    const room = (project.rooms || []).find((r) => r.id === id);
    for (const p of room?.axisPins || []) {
      if (dirOrient(p.dir) !== body.orient || seen.has(p.gridId)) continue;
      const g = gridOf(project, p.gridId);
      if (!g) continue;
      const at = g.at + p.off;
      if (at < body.lo - PIN_TOL || at > body.hi + PIN_TOL) continue;
      seen.add(p.gridId);
      out.push({ gridId: p.gridId, part: 'line', mode: p.mode || 'face' });
    }
  }
  return out;
}

// Замки у выделенной стены: оси, на которых она лежит (±tol), и её привязки.
// → [{ gridId, part, mode, closed, at: {x, y}, side, clear }] (план, оси дома):
//   at — точка на оси у стены, side — куда отодвинуть значок (±1 поперёк
//   для линии, вдоль стены наружу для торца), clear — мм от оси до края тела
//   в сторону side (значок не ложится на штриховку стены).
export function wallLocks(project, wall, grids, { tol = LOCK_TOL } = {}) {
  const body = wallBody(wall);
  if (!body) return [];
  const closed = new Map(wallPins(project, wall).map((p) => [`${p.part}|${p.gridId}`, p]));
  const out = [];
  const kind = gridKindFor(body.orient);
  // Вдоль — на четверти длины: середину занимает ручка сдвига стены.
  const along = body.from + (body.to - body.from) * 0.25;
  for (const g of grids || []) {
    if (g.hidden || g.kind !== kind) continue;
    const pin = closed.get(`line|${g.id}`);
    const ref = [body.lo, body.mid, body.hi].find((r) => Math.abs(g.at - r) <= tol);
    if (ref === undefined && !pin) continue;
    const side = Math.sign(g.at - body.mid) || (wall.outward || 1);
    const clear = Math.max(0, side > 0 ? body.hi - g.at : g.at - body.lo);
    const at = body.orient === 'h' ? { x: along, y: g.at } : { x: g.at, y: along };
    out.push({ gridId: g.id, part: 'line', mode: pin?.mode || (ref === body.mid ? 'axis' : 'face'), closed: Boolean(pin), at, side, clear });
  }
  if (wall.kind === 'manual') {
    const mw = (project.walls || []).find((w) => w.id === wall.wallId);
    const geo = mw && manualWallGeometry(mw);
    if (geo) {
      const ax = geo.orient === 'h' ? 'x' : 'y';
      const perp = geo.orient === 'h' ? 'x' : 'y'; // kind перпендикулярных осей
      for (const end of ['a', 'b']) {
        const p = mw.axis[end];
        const other = mw.axis[end === 'a' ? 'b' : 'a'];
        for (const g of grids || []) {
          if (g.hidden || g.kind !== perp) continue;
          const pin = mw.axisPins?.[end]?.gridId === g.id;
          if (!pin && Math.abs(g.at - p[ax]) > tol) continue;
          out.push({ gridId: g.id, part: end, mode: 'face', closed: pin, at: { x: p.x, y: p.y }, side: Math.sign(p[ax] - other[ax]) || 1, clear: 0 });
        }
      }
    }
  }
  return out;
}

// ------------------------------------------------------------- прикрепить

function setRoomPin(project, room, dir, coord, grid, mode) {
  const at = (p) => (gridOf(project, p.gridId)?.at ?? NaN) + p.off;
  const rest = (room.axisPins || []).filter((p) => !(p.dir === dir && Math.abs(at(p) - coord) <= PIN_TOL));
  room.axisPins = [...rest, { dir, gridId: grid.id, off: Math.round((coord - grid.at) * 100) / 100, mode }];
}

// Прикрепить стену (запись state.walls) к оси grid: стена сначала встаёт на
// ось (опорная линия по mode), потом запоминаются грани. part — 'line' или
// торец ручной стены 'a' | 'b'. → { ok, reason?, moved }.
export function pinWallToGrid(project, wall, grid, { mode = 'face', part = 'line' } = {}) {
  if (!wall || !grid) return { ok: false, reason: 'Нет стены или оси' };
  if (wall.kind === 'manual') return pinManualWall(project, wall.wallId, grid, { mode, part });
  if (!['own', 'shared'].includes(wall.kind)) return { ok: false, reason: 'Эту стену нельзя прикрепить' };
  const body = wallBody(wall);
  if (!body || grid.kind !== gridKindFor(body.orient)) return { ok: false, reason: 'Ось не параллельна стене' };
  const refs = wallRefs(body, mode);
  const ref = refs.reduce((a, b) => (Math.abs(b - grid.at) < Math.abs(a - grid.at) ? b : a));
  const delta = grid.at - ref;
  for (const id of wall.rooms) liftRoom(project, id);
  if (Math.abs(delta) >= 0.5) {
    const res = moveWallBy(project, wall, delta);
    if (!res.ok) { reconcileEats(project, { touched: wall.rooms }); return res; }
  }
  const moved = { ...body, lo: body.lo + delta, hi: body.hi + delta, mid: body.mid + delta };
  let count = 0;
  for (const id of wall.rooms) {
    const room = project.rooms.find((r) => r.id === id);
    if (!room) continue;
    for (const e of facesOnBody(room, moved)) {
      setRoomPin(project, room, dirOf(e), e.edge, grid, mode);
      count += 1;
    }
  }
  reconcileEats(project, { touched: wall.rooms });
  if (!count) return { ok: false, reason: 'Не найдена грань помещения у этой стены' };
  return { ok: true, moved: Math.abs(delta) >= 0.5 };
}

function pinManualWall(project, wallId, grid, { mode = 'face', part = 'line' } = {}) {
  const mw = (project.walls || []).find((w) => w.id === wallId);
  const geo = mw && manualWallGeometry(mw);
  if (!geo) return { ok: false, reason: 'Стена не найдена' };
  const key = geo.orient === 'h' ? 'y' : 'x';
  const along = geo.orient === 'h' ? 'x' : 'y';
  if (part === 'line') {
    if (grid.kind !== gridKindFor(geo.orient)) return { ok: false, reason: 'Ось не параллельна стене' };
    const refs = mode === 'axis' ? [(geo.lo + geo.hi) / 2] : [geo.lo, geo.hi];
    const ref = refs.reduce((a, b) => (Math.abs(b - grid.at) < Math.abs(a - grid.at) ? b : a));
    const delta = grid.at - ref;
    if (Math.abs(delta) >= 0.5) {
      const res = moveManualWall(project, mw.id, delta);
      if (!res.ok) return res;
    }
    mw.axisPins = { ...(mw.axisPins || {}), line: { gridId: grid.id, off: Math.round((mw.axis.a[key] - grid.at) * 100) / 100, mode } };
    return { ok: true, moved: Math.abs(delta) >= 0.5 };
  }
  if (part !== 'a' && part !== 'b') return { ok: false, reason: 'Нет такого торца' };
  if (grid.kind !== along) return { ok: false, reason: 'Ось не пересекает стену' };
  const p = mw.axis[part];
  if (Math.abs(p[along] - grid.at) >= 0.5) {
    const res = dragManualWallEnd(project, mw.id, part, { ...p, [along]: grid.at });
    if (!res.ok) return res;
  }
  mw.axisPins = { ...(mw.axisPins || {}), [part]: { gridId: grid.id, off: Math.round((mw.axis[part][along] - grid.at) * 100) / 100 } };
  return { ok: true };
}

// Открепить стену от оси gridId (part — 'line' | 'a' | 'b').
export function unpinWallFromGrid(project, wall, gridId, part = 'line') {
  if (!wall) return false;
  if (wall.kind === 'manual') {
    const mw = (project.walls || []).find((w) => w.id === wall.wallId);
    if (!mw?.axisPins?.[part] || mw.axisPins[part].gridId !== gridId) return false;
    const { [part]: _gone, ...rest } = mw.axisPins;
    if (Object.keys(rest).length) mw.axisPins = rest; else delete mw.axisPins;
    return true;
  }
  const body = wallBody(wall);
  const g = gridOf(project, gridId);
  let changed = false;
  for (const id of wall.rooms || []) {
    const room = (project.rooms || []).find((r) => r.id === id);
    if (!room?.axisPins) continue;
    const keep = room.axisPins.filter((p) => {
      if (p.gridId !== gridId || dirOrient(p.dir) !== body?.orient) return true;
      const at = (g ? g.at : NaN) + p.off;
      return g && (at < body.lo - PIN_TOL || at > body.hi + PIN_TOL);
    });
    if (keep.length !== room.axisPins.length) changed = true;
    if (keep.length) room.axisPins = keep; else delete room.axisPins;
  }
  return changed;
}

// ------------------------------------------------------------- сдвиг оси

export function hasGridPins(project, gridId) {
  return levelsOf(project).some(({ level }) => (level.rooms || []).some((r) => (r.axisPins || []).some((p) => p.gridId === gridId))
    || (level.walls || []).some((w) => Object.values(w.axisPins || {}).some((p) => p?.gridId === gridId)));
}

// Снимок этажей (комнаты, проёмы, ручные стены) — для отката и жеста.
export function captureLevels(project) {
  return levelsOf(project).map(({ level }) => ({
    level, rooms: clone(level.rooms || []), openings: clone(level.openings || []), walls: clone(level.walls || []),
  }));
}

export function restoreLevels(saved) {
  for (const s of saved) {
    s.level.rooms = clone(s.rooms);
    s.level.openings = clone(s.openings);
    s.level.walls = clone(s.walls);
  }
}

const minOf = (room) => (isShaft(room) ? MIN_SHAFT_SIZE : MIN_ROOM_SIZE);

// Сдвинуть ось gridId в положение at вместе с прикреплёнными стенами
// (все этажи). → { ok, reason?, rooms: [id], walls: [id] }; при отказе
// проект и ось — как были.
export function moveGridWithPins(project, gridId, at) {
  const grid = gridOf(project, gridId);
  if (!grid || !Number.isFinite(at)) return { ok: false, reason: 'Ось не найдена', rooms: [], walls: [] };
  const oldAt = grid.at;
  const newAt = Math.round(at);
  const d = newAt - oldAt;
  const saved = captureLevels(project);
  const savedGrids = project.grids;
  project.grids = project.grids.map((g) => (g.id === gridId ? { ...g, at: newAt } : g));
  const out = { ok: true, rooms: [], walls: [] };
  if (!d) return out;
  const fail = (reason) => {
    restoreLevels(saved);
    project.grids = savedGrids;
    return { ok: false, reason, rooms: [], walls: [] };
  };
  for (const { level, view } of levelsOf(project)) {
    const rooms = level.rooms || [];
    const pinned = rooms.filter((r) => (r.axisPins || []).some((p) => p.gridId === gridId));
    const walls = (level.walls || []).filter((w) => Object.values(w.axisPins || {}).some((p) => p?.gridId === gridId));
    if (!pinned.length && !walls.length) continue;
    const touched = new Set();
    // Комнаты: номинал, грани сдвигаются на d; соседи по общей стене — следом.
    for (const r of pinned) liftRoom(view, r.id);
    const pinnedIds = new Set(pinned.map((r) => r.id));
    const jobs = [];
    for (const room of pinned) {
      for (const pin of room.axisPins.filter((p) => p.gridId === gridId)) {
        const e = pinEdge(room, pin, oldAt);
        if (e) jobs.push({ room, edge: e });
      }
    }
    const followIds = new Set();
    const followers = [];
    for (const job of jobs) {
      for (const f of findFollowers(rooms, job.room.id, [job.edge], { shapeOf: nominalShape })) {
        if (pinnedIds.has(f.id) || followIds.has(f.id)) continue;
        followIds.add(f.id);
        followers.push(f);
      }
    }
    for (const f of followers) liftRoom(view, f.id);
    const follow = startFollow(view, followers);
    const anchors = new Map(pinned.map((r) => [r.id, captureOpeningAnchors(view, r)]));
    for (const job of jobs) {
      const { room, edge } = job;
      // Индексы рёбер могли смениться после прошлой грани — ищем по месту.
      const cur = roomBoundaryEdges(room).find((c) => c.orient === edge.orient && c.outward === edge.outward &&
        Math.abs(c.edge - edge.edge) < 0.5 && Math.min(c.to, edge.to) - Math.max(c.from, edge.from) > 1) || edge;
      const shaped = Boolean(room.outline || (room.notch && typeof cur.side === 'string'));
      const ok = shaped ? moveShapedEdge(room, cur, cur.edge + d) : moveRectEdge(room, cur.side, cur.edge + d);
      if (!ok) return fail(`«${room.name}»: форму этой стены пока нельзя изменить`);
      touched.add(room.id);
    }
    for (const room of pinned) {
      if (!touched.has(room.id)) continue;
      if (room.w < minOf(room) || room.h < minOf(room)) return fail(`«${room.name}»: минимальный размер помещения — ${minOf(room)} мм`);
      const v = validateRoomPlacement(view, room, room.id);
      if (!v.ok) return fail(`«${room.name}»: ${v.reason}`);
      reanchorOpenings(view, room, anchors.get(room.id));
    }
    if (follow.length) {
      const rep = applyFollow(view, follow, edgeAxis(jobs) === 'x' ? { x: d, y: 0 } : { x: 0, y: d });
      if (!rep.ok) return fail('Соседнее помещение сложной формы так не растянуть');
      const fv = followVerdict(view, follow);
      if (!fv.ok) return fail(fv.reason);
      for (const f of follow) touched.add(f.id);
    }
    // Ручные стены: линия и торцы.
    for (const w of walls) {
      const geo = manualWallGeometry(w);
      if (!geo) continue;
      const key = geo.orient === 'h' ? 'y' : 'x';
      const along = geo.orient === 'h' ? 'x' : 'y';
      const line = w.axisPins.line;
      if (line?.gridId === gridId) {
        const res = moveManualWall(view, w.id, newAt + line.off - w.axis.a[key]);
        if (!res.ok) return fail(res.reason);
      }
      for (const end of ['a', 'b']) {
        const p = w.axisPins[end];
        if (p?.gridId !== gridId) continue;
        const res = dragManualWallEnd(view, w.id, end, { ...w.axis[end], [along]: newAt + p.off });
        if (!res.ok) return fail(res.reason);
      }
      out.walls.push(w.id);
    }
    if (touched.size) reconcileEats(view, { touched: [...touched] });
    out.rooms.push(...touched);
  }
  return out;
}

const edgeAxis = (jobs) => (jobs[0]?.edge.orient === 'v' ? 'x' : 'y');

// ------------------------------------------------------------- проверка

// После правки: привязки, грань которых ушла с оси, и привязки к удалённым
// осям (или сменившим направление) снимаются. → { dropped, orphans }:
// dropped — стену увели с оси (стоит сказать), orphans — оси больше нет.
export function syncGridPins(project) {
  const res = { dropped: 0, orphans: 0 };
  if (!project) return res;
  for (const { level } of levelsOf(project)) {
    for (const room of level.rooms || []) {
      if (!room.axisPins) continue;
      const keep = room.axisPins.filter((p) => {
        const g = gridOf(project, p.gridId);
        if (!g || g.kind !== gridKindFor(dirOrient(p.dir))) { res.orphans += 1; return false; }
        if (!pinEdge(room, p, g.at)) { res.dropped += 1; return false; }
        return true;
      });
      if (keep.length !== room.axisPins.length) {
        if (keep.length) room.axisPins = keep; else delete room.axisPins;
      }
    }
    for (const w of level.walls || []) {
      if (!w.axisPins) continue;
      const geo = manualWallGeometry(w);
      const next = {};
      for (const [part, p] of Object.entries(w.axisPins)) {
        const g = gridOf(project, p?.gridId);
        const want = part === 'line' ? gridKindFor(geo?.orient) : (geo?.orient === 'h' ? 'x' : 'y');
        if (!g || !geo || g.kind !== want) { res.orphans += 1; continue; }
        const cur = part === 'line' ? w.axis.a[geo.orient === 'h' ? 'y' : 'x'] : w.axis[part]?.[geo.orient === 'h' ? 'x' : 'y'];
        if (!Number.isFinite(cur) || Math.abs(cur - (g.at + p.off)) > PIN_TOL) { res.dropped += 1; continue; }
        next[part] = p;
      }
      if (Object.keys(next).length) w.axisPins = next; else delete w.axisPins;
    }
  }
  return res;
}
