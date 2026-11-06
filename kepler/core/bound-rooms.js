// Помещения по стенам (этап C, docs/walls-v2-architecture.md, раздел 2).
// Чистый модуль без DOM.
//
// Помещение с room.bound = { mode: 'walls', seed } своих стен не порождает:
// его контур — связная компонента свободных клеток сжатой сетки
// (core/ortho-grid.js), содержащая seed. Препятствия — тела стен (комнатных и
// ручных, кроме roomBounding: false; «линии разделения» hidden — входят) и
// блок-комнаты. Компонента, касающаяся края сетки, — улица. Контур сразу
// «в свету»: площадь чистая, как у блок-комнат.
//
// Кеш в комнате (пересчитывается resolveBoundRooms после каждого
// deriveWalls): room.poly — внешний контур (абсолютные точки, оси дома),
// room.holes — дыры (колонна-стена внутри), x/y/w/h — габарит,
// room.boundIssue — 'open' (петля разомкнулась) | 'merged' (две петли
// слились, площадь — первому помещению) | нет. Всё, что читает комнату
// (нормы, ТЭП, площади, мебель), идёт через roomPolygon/roomRects
// (core/room-shape.js) — там единственная ветка.

import { makeId } from './model.js';
import { gridAxis, mergeCells, rectsCycles, traceCycles } from './ortho-grid.js';
import {
  isBoundRoom, roomBoundaryEdges, roomContainsPoint, roomLabelPoint, roomPolygon, roomRects,
} from './room-shape.js';
import { isOpenRoom, isShaft, roomType } from './catalog.js';
import {
  manualWallGeometry, openingRect, ownKey, sharedKey, sideEdge, wallRects, wallSegments,
} from './walls.js';

export { isBoundRoom };

export const MIN_LOOP_SIZE = 200; // мм — уже по любой оси — щель, а не помещение (MIN_SHAFT_SIZE)
const MARGIN = 1000; // поле вокруг всех препятствий: компонента улицы касается края

// ---------------------------------------------------------------- Поле петель

function obstacleRects(project, walls) {
  const out = [];
  for (const w of walls || []) {
    if (w.roomBounding === false) continue;
    for (const r of wallRects(w)) if (r.w > 0.25 && r.h > 0.25) out.push(r);
  }
  for (const room of project.rooms || []) {
    if (isBoundRoom(room)) continue;
    for (const r of roomRects(room)) if (r.w > 0.25 && r.h > 0.25) out.push(r);
  }
  return out;
}

// Сетка, препятствия и связные компоненты свободных клеток (4-связность).
// → { xs, ys, nx, ny, comp: Int32Array (−1 — препятствие), comps: [{ open, area, cells }] } | null.
export function loopField(project, walls) {
  const rects = obstacleRects(project, walls);
  if (!rects.length) return null;
  let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
  for (const r of rects) {
    x0 = Math.min(x0, r.x); y0 = Math.min(y0, r.y);
    x1 = Math.max(x1, r.x + r.w); y1 = Math.max(y1, r.y + r.h);
  }
  const xsRaw = [x0 - MARGIN, x1 + MARGIN];
  const ysRaw = [y0 - MARGIN, y1 + MARGIN];
  for (const r of rects) { xsRaw.push(r.x, r.x + r.w); ysRaw.push(r.y, r.y + r.h); }
  const ax = gridAxis(xsRaw);
  const ay = gridAxis(ysRaw);
  const xs = ax.coords; const ys = ay.coords;
  const nx = xs.length - 1; const ny = ys.length - 1;
  const N = nx * ny;
  const solid = new Uint8Array(N);
  for (const r of rects) {
    const i0 = ax.at(r.x); const i1 = ax.at(r.x + r.w); const j0 = ay.at(r.y); const j1 = ay.at(r.y + r.h);
    for (let j = j0; j < j1; j += 1) for (let i = i0; i < i1; i += 1) solid[j * nx + i] = 1;
  }
  const comp = new Int32Array(N).fill(-1);
  const comps = [];
  const queue = new Int32Array(N);
  for (let s = 0; s < N; s += 1) {
    if (solid[s] || comp[s] >= 0) continue;
    const id = comps.length;
    const info = { id, open: false, area: 0, cells: 0, x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
    comps.push(info);
    let head = 0; let tail = 0;
    queue[tail++] = s; comp[s] = id;
    while (head < tail) {
      const k = queue[head++];
      const i = k % nx; const j = (k - i) / nx;
      info.cells += 1;
      info.area += (xs[i + 1] - xs[i]) * (ys[j + 1] - ys[j]);
      info.x0 = Math.min(info.x0, xs[i]); info.x1 = Math.max(info.x1, xs[i + 1]);
      info.y0 = Math.min(info.y0, ys[j]); info.y1 = Math.max(info.y1, ys[j + 1]);
      if (i === 0 || j === 0 || i === nx - 1 || j === ny - 1) info.open = true;
      const visit = (q) => { if (!solid[q] && comp[q] < 0) { comp[q] = id; queue[tail++] = q; } };
      if (i > 0) visit(k - 1);
      if (i < nx - 1) visit(k + 1);
      if (j > 0) visit(k - nx);
      if (j < ny - 1) visit(k + nx);
    }
  }
  return { xs, ys, nx, ny, comp, comps };
}

// Индекс промежутка сетки, в котором лежит v (−1 — вне сетки).
function span(coords, v) {
  if (!(v > coords[0] && v < coords[coords.length - 1])) return -1;
  let lo = 0; let hi = coords.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (coords[mid] <= v) lo = mid; else hi = mid;
  }
  return lo;
}

// Компонента в точке p (−1 — препятствие или вне сетки).
export function compAt(field, p) {
  if (!field || !p) return -1;
  const i = span(field.xs, p.x);
  const j = span(field.ys, p.y);
  if (i < 0 || j < 0) return -1;
  return field.comp[j * field.nx + i];
}

// Контур компоненты: { poly, holes, rects, area, bbox }.
export function compShape(field, c) {
  const { xs, ys, comp } = field;
  const mask = new Uint8Array(comp.length);
  const label = new Int32Array(comp.length).fill(-1);
  for (let k = 0; k < comp.length; k += 1) if (comp[k] === c) { mask[k] = 1; label[k] = 0; }
  const cycles = traceCycles(mask, xs, ys);
  const outer = cycles.filter((q) => q.area > 0).sort((a, b) => b.area - a.area)[0];
  if (!outer) return null;
  const holes = cycles.filter((q) => q.area < 0).map((q) => q.pts);
  const info = field.comps[c];
  return {
    poly: outer.pts, holes, rects: mergeCells(label, xs, ys).get(0) || [], area: info.area,
    bbox: { x: info.x0, y: info.y0, w: info.x1 - info.x0, h: info.y1 - info.y0 },
  };
}

function applyShape(room, shape) {
  room.poly = shape.poly.map((p) => ({ x: p.x, y: p.y }));
  if (shape.holes.length) room.holes = shape.holes.map((h) => h.map((p) => ({ x: p.x, y: p.y })));
  else delete room.holes;
  room.x = shape.bbox.x; room.y = shape.bbox.y; room.w = shape.bbox.w; room.h = shape.bbox.h;
  delete room.outline;
  delete room.notch;
  delete room.boundIssue;
  delete room.boundWith;
}

// Компонента с наибольшим пересечением с прошлым контуром помещения (seed
// попал в стену). −1 — пересечения нет.
function bestOverlap(field, room) {
  if (!Array.isArray(room.poly) || room.poly.length < 4) return -1;
  const { xs, ys, nx, comp, comps } = field;
  const xMin = Math.min(...room.poly.map((p) => p.x)); const xMax = Math.max(...room.poly.map((p) => p.x));
  const yMin = Math.min(...room.poly.map((p) => p.y)); const yMax = Math.max(...room.poly.map((p) => p.y));
  const score = new Map();
  for (let j = 0; j < ys.length - 1; j += 1) {
    const cy = (ys[j] + ys[j + 1]) / 2;
    if (cy < yMin || cy > yMax) continue;
    for (let i = 0; i < nx; i += 1) {
      const cx = (xs[i] + xs[i + 1]) / 2;
      if (cx < xMin || cx > xMax) continue;
      const c = comp[j * nx + i];
      if (c < 0 || comps[c].open || !roomContainsPoint(room, cx, cy)) continue;
      score.set(c, (score.get(c) || 0) + (xs[i + 1] - xs[i]) * (ys[j + 1] - ys[j]));
    }
  }
  let best = -1; let bestArea = 0;
  for (const [c, a] of score) if (a > bestArea) { bestArea = a; best = c; }
  return best;
}

function setIssue(room, issue, withId = null) {
  room.boundIssue = issue;
  if (withId) room.boundWith = withId; else delete room.boundWith;
}

// Пересчёт контуров всех помещений по стенам активного этажа (вызывается
// после deriveWalls). Мутирует кеш комнат (poly/holes/x/y/w/h/boundIssue);
// seed, попавший в стену, переставляется в новую компоненту.
// → { field, owner: Map(comp → roomId), free: [shape] — замкнутые петли без помещения }.
export function resolveBoundRooms(project, walls) {
  const bound = (project.rooms || []).filter(isBoundRoom);
  const field = (bound.length || (project.walls || []).length) ? loopField(project, walls) : null;
  const owner = new Map();
  for (const room of bound) {
    let c = compAt(field, room.bound.seed);
    let moved = false;
    if (c < 0 && field) { c = bestOverlap(field, room); moved = c >= 0; }
    if (c < 0) { setIssue(room, 'open'); continue; }
    if (field.comps[c].open) { setIssue(room, 'open'); continue; }
    if (owner.has(c)) { setIssue(room, 'merged', owner.get(c)); continue; }
    const shape = compShape(field, c);
    if (!shape) { setIssue(room, 'open'); continue; }
    owner.set(c, room.id);
    applyShape(room, shape);
    if (moved) {
      const p = roomLabelPoint(room);
      room.bound = { ...room.bound, seed: { x: p.x, y: p.y } };
    }
  }
  const free = [];
  if (field) {
    for (const info of field.comps) {
      if (info.open || owner.has(info.id)) continue;
      if (info.x1 - info.x0 < MIN_LOOP_SIZE || info.y1 - info.y0 < MIN_LOOP_SIZE) continue;
      // Петля только из блок-комнат (двор между ними) тоже «свободна» — но
      // показываем её, лишь если её касается ручная стена.
      if (!(project.walls || []).length) continue;
      const shape = compShape(field, info.id);
      if (shape) free.push({ comp: info.id, ...shape });
    }
  }
  return { field, owner, free };
}

// Помещения следуют за своей площадью после правки стен: seed каждого
// помещения по стенам переставляется в компоненту, сильнее всего
// пересекающуюся с ожидаемым контуром (expected: Map(roomId → poly); иначе —
// прошлый кеш room.poly). Без этого seed, оставшийся за сдвинутой стеной,
// «перескочил» бы в соседнее помещение или на улицу.
export function followBoundRooms(project, walls, expected = new Map()) {
  const bound = (project.rooms || []).filter(isBoundRoom);
  if (!bound.length) return;
  const field = loopField(project, walls);
  if (!field) return;
  const taken = new Set();
  for (const room of bound) {
    const poly = expected.get(room.id) || room.poly;
    const probe = { bound: room.bound, poly };
    const best = bestOverlap(field, probe);
    if (best < 0 || taken.has(best)) continue;
    taken.add(best);
    if (compAt(field, room.bound.seed) === best) continue;
    const shape = compShape(field, best);
    const rect = shape && [...shape.rects].sort((a, b) => b.w * b.h - a.w * a.h)[0];
    if (!rect) continue;
    room.bound = { ...room.bound, seed: { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 } };
  }
}

// Что получится, если создать помещение в точке p.
// → { ok, shape } | { ok: false, reason }.
export function findLoopAt(project, walls, p) {
  const block = (project.rooms || []).find((r) => !isBoundRoom(r) && roomContainsPoint(r, p.x, p.y));
  if (block) return { ok: false, reason: `Здесь уже помещение «${block.name}»` };
  const field = loopField(project, walls);
  const c = compAt(field, p);
  const outside = !field || span(field.xs, p.x) < 0 || span(field.ys, p.y) < 0;
  if (outside) return { ok: false, reason: 'Стены здесь не замкнуты — помещение «вытечет» на улицу' };
  if (c < 0) return { ok: false, reason: 'Кликните внутри петли стен, а не по стене' };
  const info = field.comps[c];
  if (info.open) return { ok: false, reason: 'Стены здесь не замкнуты — помещение «вытечет» на улицу' };
  if (info.x1 - info.x0 < MIN_LOOP_SIZE || info.y1 - info.y0 < MIN_LOOP_SIZE) return { ok: false, reason: 'Петля слишком узкая для помещения' };
  const taken = (project.rooms || []).find((r) => isBoundRoom(r) && compAt(field, r.bound.seed) === c);
  if (taken) return { ok: false, reason: `Здесь уже есть помещение «${taken.name}»` };
  const shape = compShape(field, c);
  return shape ? { ok: true, shape } : { ok: false, reason: 'Контур не найден' };
}

// Создаёт помещение по стенам в точке p (тип и имя — как у новой комнаты по
// умолчанию). → { ok, room } | { ok: false, reason }.
export function createBoundRoom(project, walls, p, { type = 'living', name = null } = {}) {
  const found = findLoopAt(project, walls, p);
  if (!found.ok) return found;
  const room = {
    id: makeId('room'), type, name: name || roomType(type)?.title || type,
    x: 0, y: 0, w: 1, h: 1, parentId: null,
    bound: { mode: 'walls', seed: { x: p.x, y: p.y } },
  };
  applyShape(room, found.shape);
  project.rooms.push(room);
  return { ok: true, room };
}

// ---------------------------------------------------------------- Стена через блок-комнату

function overlapRect(a, b) {
  const x0 = Math.max(a.x, b.x); const y0 = Math.max(a.y, b.y);
  const x1 = Math.min(a.x + a.w, b.x + b.w); const y1 = Math.min(a.y + a.h, b.y + b.h);
  return x1 - x0 > 1 && y1 - y0 > 1 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
}

// Ручные стены, проходящие через блок-комнаты. → [{ wallId, roomId, divides }].
export function wallsInsideRooms(project) {
  const out = [];
  const blocks = (project.rooms || []).filter((r) => !isBoundRoom(r) && !isShaft(r) && !isOpenRoom(r));
  for (const w of project.walls || []) {
    if (w.roomBounding === false) continue;
    const g = manualWallGeometry(w);
    if (!g) continue;
    for (const room of blocks) {
      if (!roomRects(room).some((r) => overlapRect(r, g.band))) continue;
      out.push({ wallId: w.id, roomId: room.id, divides: Boolean(splitPlan(room, g)) });
    }
  }
  return out;
}

// Две части комнаты по обе стороны тела стены g (manualWallGeometry), или
// null: стена не пересекает комнату насквозь, часть пуста/несвязна/мала.
function splitPlan(room, g, minSize = 500) {
  const h = g.orient === 'h';
  const lowRects = []; const highRects = [];
  for (const r of roomRects(room)) {
    const a0 = h ? r.y : r.x; const a1 = a0 + (h ? r.h : r.w); // поперёк стены
    const b0 = h ? r.x : r.y; const b1 = b0 + (h ? r.w : r.h); // вдоль стены
    if (a1 > g.lo + 0.5 && a0 < g.hi - 0.5) {
      // Полоса стены внутри этого прямоугольника — стена должна перекрыть его целиком.
      if (g.from > b0 + 1 || g.to < b1 - 1) return null;
    }
    const cut = (from, to) => {
      if (to - from <= 0.5) return null;
      return h ? { x: r.x, y: from, w: r.w, h: to - from } : { x: from, y: r.y, w: to - from, h: r.h };
    };
    const low = cut(a0, Math.min(a1, g.lo));
    const high = cut(Math.max(a0, g.hi), a1);
    if (low) lowRects.push(low);
    if (high) highRects.push(high);
  }
  const part = (rects) => {
    if (!rects.length) return null;
    const cycles = rectsCycles(rects);
    if (cycles.length !== 1 || cycles[0].area <= 0) return null;
    const pts = cycles[0].pts;
    const w = Math.max(...pts.map((p) => p.x)) - Math.min(...pts.map((p) => p.x));
    const hh = Math.max(...pts.map((p) => p.y)) - Math.min(...pts.map((p) => p.y));
    return w >= minSize && hh >= minSize ? pts : null;
  };
  const low = part(lowRects);
  const high = part(highRects);
  return low && high ? { low, high } : null;
}

function setRoomPolygon(room, pts) {
  const xs = pts.map((p) => p.x); const ys = pts.map((p) => p.y);
  const minX = Math.min(...xs); const minY = Math.min(...ys);
  room.x = minX; room.y = minY; room.w = Math.max(...xs) - minX; room.h = Math.max(...ys) - minY;
  delete room.notch;
  if (pts.length === 4) delete room.outline;
  else room.outline = pts.map((p) => ({ x: p.x - minX, y: p.y - minY }));
}

const alongBase = (room, orient) => (orient === 'h' ? room.x : room.y);

// Ребро комнаты на линии (orient, edge, outward), содержащее координату at.
function edgeAt(room, orient, edge, outward, at) {
  return roomBoundaryEdges(room).find((e) => e.orient === orient && e.outward === outward
    && Math.abs(e.edge - edge) < 1 && at >= e.from - 1 && at <= e.to + 1) || null;
}

// «Разделить на два»: блок-комната делится по телу ручной стены на две
// блок-комнаты, стена становится их общей стеной s|a|b (толщина и класс —
// из ручной стены), ручная стена удаляется, её проёмы переходят на общую
// стену. Проёмы наружных стен остаются на месте в мире.
// → { ok, roomIds: [a, b], lost: [openingId] } | { ok: false, reason }.
export function splitRoomByWall(project, walls, roomId, wallId) {
  const room = (project.rooms || []).find((r) => r.id === roomId);
  const wall = (project.walls || []).find((w) => w.id === wallId);
  if (!room || isBoundRoom(room) || !wall) return { ok: false, reason: 'Комната или стена не найдена' };
  const g = manualWallGeometry(wall);
  const plan = g && splitPlan(room, g);
  if (!plan) return { ok: false, reason: 'Стена не делит комнату насквозь на две части' };

  // Положения проёмов до правки (мир).
  const anchors = [];
  for (const o of project.openings || []) {
    if (o.roomId === room.id) {
      const e = sideEdge(room, o.side);
      const placed = openingRect(project, o, walls);
      const abs = placed ? placed.absCenter : (e ? alongBase(room, e.orient) + Number(o.offset) : null);
      if (e && abs !== null) anchors.push({ o, orient: e.orient, edge: e.edge, outward: e.outward, abs });
    } else if (o.host?.wallId === wall.id) {
      anchors.push({ o, host: true, abs: g.axisStart + g.dir * Number(o.host.t) });
    }
  }
  const overrides = project.wallOverrides || (project.wallOverrides = {});
  const ownOverrides = Object.keys(overrides).filter((k) => k.startsWith(`e|${room.id}|`)).map((k) => [k.split('|')[2], overrides[k]]);

  const second = structuredClone(room);
  second.id = makeId('room');
  second.name = `${room.name} 2`;
  setRoomPolygon(room, plan.low);
  setRoomPolygon(second, plan.high);
  project.rooms.splice(project.rooms.indexOf(room) + 1, 0, second);
  for (const child of project.rooms) {
    if (child.parentId !== room.id) continue;
    if (roomContainsPoint(second, child.x + child.w / 2, child.y + child.h / 2)) child.parentId = second.id;
  }
  // Наружные стены: прежние свои параметры у числовых сторон — обеим частям.
  for (const [side, value] of ownOverrides) if (/^[0-3]$/.test(side)) overrides[ownKey(second.id, Number(side))] = structuredClone(value);
  overrides[sharedKey(room.id, second.id)] = { thickness: g.thickness, kind: wall.wallType || 'partition', ...(wall.hidden ? { hidden: true } : {}) };

  const lost = [];
  // Владелец проёма ручной стены — помещение слева от оси (ownerInward).
  const leftRoom = g.leftSign < 0 ? room : second;
  for (const a of anchors) {
    const o = a.o;
    let target = null; let edge = null;
    if (a.host) {
      target = leftRoom;
      edge = edgeAt(target, g.orient, target === room ? g.lo : g.hi, target === room ? 1 : -1, a.abs);
    } else {
      for (const r of [room, second]) {
        edge = edgeAt(r, a.orient, a.edge, a.outward, a.abs);
        if (edge) { target = r; break; }
      }
    }
    if (!edge) { lost.push(o.id); continue; }
    o.roomId = target.id;
    o.side = edge.side;
    o.offset = a.abs - alongBase(target, edge.orient);
    delete o.host;
  }
  project.openings = (project.openings || []).filter((o) => !lost.includes(o.id));
  project.walls = project.walls.filter((w) => w.id !== wall.id);
  return { ok: true, roomIds: [room.id, second.id], lost };
}

// ---------------------------------------------------------------- Отвязать стены

// «Отвязать стены»: стены блок-комнаты становятся ручными, комната —
// помещением по стенам (контур — тот же «в свету»). Свои стены → ручные
// (ось по грани комнаты, тело наружу, та же толщина и класс). Общие стены с
// соседом остаются его стенами: у соседа своя стена этой стороны получает
// толщину и класс общей. Проёмы своих стен → host той же мировой позиции;
// проёмы общих стен → проёмы соседа.
// → { ok, wallIds } | { ok: false, reason }.
export function unbindRoomWalls(project, walls, roomId) {
  const room = (project.rooms || []).find((r) => r.id === roomId);
  if (!room) return { ok: false, reason: 'Комната не найдена' };
  if (isBoundRoom(room)) return { ok: false, reason: 'Стены уже отвязаны' };
  if (isShaft(room) || isOpenRoom(room) || room.parentId) return { ok: false, reason: 'У шахты, террасы и вложенного помещения стены не отвязываются' };
  const { walls: segs } = wallSegments(project, { covered: false });
  const own = segs.filter((s) => s.kind === 'own' && s.rooms[0] === room.id && s.to - s.from > 1);
  const shared = segs.filter((s) => s.kind === 'shared' && s.rooms.includes(room.id));
  const overrides = project.wallOverrides || (project.wallOverrides = {});
  if (!Array.isArray(project.walls)) project.walls = [];

  // Проёмы — до правки (мир).
  const anchors = [];
  for (const o of project.openings || []) {
    if (o.roomId !== room.id) continue;
    const placed = openingRect(project, o, walls);
    const e = sideEdge(room, o.side);
    if (!placed || !e) continue;
    anchors.push({ o, abs: placed.absCenter, orient: e.orient, edge: e.edge, outward: e.outward });
  }

  const made = [];
  for (const s of own) {
    const a = s.orient === 'h' ? { x: s.from, y: s.edge } : { x: s.edge, y: s.from };
    const b = s.orient === 'h' ? { x: s.to, y: s.edge } : { x: s.edge, y: s.to };
    const wall = {
      id: makeId('wall'), axis: { kind: 'line', a, b }, justify: 'left', thickness: Math.round(s.thickness),
      typeId: null, wallType: s.wallType || 'exterior', base: { offset: 0 }, top: { level: null, offset: 0, height: null },
      hidden: Boolean(s.hidden), roomBounding: true,
    };
    // Тело — наружу от комнаты (по outward грани).
    const g = manualWallGeometry(wall);
    const bodySide = Math.sign((g.lo + g.hi) / 2 - s.edge);
    if (bodySide !== s.outward) wall.justify = 'right';
    const key = ownKey(room.id, s.sides[room.id]);
    const top = overrides[key]?.top;
    if (top?.height) wall.top.height = top.height;
    project.walls.push(wall);
    made.push({ wall, seg: s });
  }
  for (const s of shared) {
    const other = s.rooms.find((id) => id !== room.id);
    const key = ownKey(other, s.sides[other]);
    if (!overrides[key]) overrides[key] = { thickness: Math.round(s.thickness), kind: s.wallType || 'partition', ...(s.hidden ? { hidden: true } : {}) };
  }

  const lost = [];
  for (const a of anchors) {
    const o = a.o;
    const hit = made.find(({ seg }) => seg.orient === a.orient && Math.abs(seg.edge - a.edge) < 1
      && a.abs >= seg.from - 1 && a.abs <= seg.to + 1);
    if (hit) {
      const g = manualWallGeometry(hit.wall);
      // Владелец host-проёма — сторона слева от оси; комната — со стороны −outward.
      const roomOnLeft = g.leftSign === -hit.seg.outward;
      if (!roomOnLeft && o.kind === 'door') o.swingIn = !o.swingIn;
      o.host = { wallId: hit.wall.id, t: (a.abs - g.axisStart) * g.dir };
      o.roomId = null;
      delete o.side;
      delete o.offset;
      continue;
    }
    const sh = shared.find((s) => s.orient === a.orient && a.abs >= s.from - 1 && a.abs <= s.to + 1
      && Math.abs(s.edge - a.edge) < s.thickness + 1);
    const other = sh && project.rooms.find((r) => r.id === sh.rooms.find((id) => id !== room.id));
    const e = other && sideEdge(other, sh.sides[other.id]);
    if (other && e) {
      o.roomId = other.id;
      o.side = sh.sides[other.id];
      o.offset = a.abs - alongBase(other, e.orient);
      if (o.kind === 'door') o.swingIn = !o.swingIn;
      continue;
    }
    lost.push(o.id);
  }
  project.openings = (project.openings || []).filter((o) => !lost.includes(o.id));
  for (const k of Object.keys(overrides)) {
    const parts = k.split('|');
    if ((parts[0] === 'e' && parts[1] === room.id) || (parts[0] === 's' && parts.slice(1).includes(room.id))) delete overrides[k];
  }
  const poly = roomPolygon(room).map((p) => ({ x: p.x, y: p.y }));
  const seed = roomLabelPoint(room);
  room.bound = { mode: 'walls', seed: { x: seed.x, y: seed.y } };
  room.poly = poly;
  delete room.outline;
  delete room.notch;
  return { ok: true, wallIds: made.map((m) => m.wall.id), lost };
}
