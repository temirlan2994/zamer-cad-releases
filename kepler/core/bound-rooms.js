// Петли ручных стен → обычные комнаты (docs/walls-v2-architecture.md,
// раздел 2). Чистый модуль без DOM.
//
// Замкнутая петля ручных стен ищется заливкой сжатой сетки
// (core/ortho-grid.js): препятствия — тела стен (кроме roomBounding: false)
// и комнаты; компонента свободных клеток, касающаяся края сетки, — улица.
// Контур петли сразу «в свету».
//
// Инструмент «Помещение» (createLoopRoom) превращает петлю в ОБЫЧНУЮ
// комнату — такую же, как нарисованная инструментом «Комната»: контур «в
// свету» (прямоугольник или outline), стены дальше выводит движок. Ручные
// стены, чьё тело целиком лежит в кольце стен контура (той же толщины, что и
// сторона), удаляются: их толщина, класс, скрытие и высота переходят в
// wallOverrides стороны комнаты, проёмы host — в обычные проёмы комнаты
// (side/offset). Стены, выходящие за кольцо (торчащие концы, Т-примыкания),
// остаются ручными; сторона комнаты получает их толщину — тела совпадают,
// объединение v2 их не удваивает. Сосед-комната на зазоре толщины стены —
// общая стена (wallOverrides[s|a|b]), как у состыкованных магнитом комнат.
//
// Старые «помещения по стенам» (room.bound, схема 6 до этой правки)
// конвертируются тем же алгоритмом при открытии файла (convertBoundRooms из
// normalizeProject).

import { createRoom, makeId } from './model.js';
import { gridAxis, mergeCells, rectsCycles, traceCycles } from './ortho-grid.js';
import {
  finalizeRoomOutline, roomBoundaryEdges, roomContainsPoint, roomPolygon, roomRects,
} from './room-shape.js';
import { DEFAULT_EXTERIOR, DEFAULT_PARTITION, isOpenRoom, isShaft } from './catalog.js';
import {
  MAX_SHARED_GAP, deriveWalls, manualWallGeometry, openingRect, ownKey, sharedKey, sideEdge, wallRects,
} from './walls.js';

export const MIN_LOOP_SIZE = 200; // мм — уже по любой оси — щель, а не помещение (MIN_SHAFT_SIZE)
const MARGIN = 1000; // поле вокруг всех препятствий: компонента улицы касается края
const EPS = 1; // мм

// Только для миграции старых файлов: признак устаревшего «помещения по стенам».
const isBoundRoom = (room) => room?.bound?.mode === 'walls';

// ---------------------------------------------------------------- Поле петель

function obstacleRects(project, walls) {
  const out = [];
  for (const w of walls || []) {
    if (w.roomBounding === false) continue;
    for (const r of wallRects(w)) if (r.w > 0.25 && r.h > 0.25) out.push(r);
  }
  for (const room of project.rooms || []) {
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

const tooSmall = (info) => info.x1 - info.x0 < MIN_LOOP_SIZE || info.y1 - info.y0 < MIN_LOOP_SIZE;

// Замкнутые петли ручных стен без комнаты — для штриховки «не назначено».
// → [{ comp, poly, holes, rects, area, bbox }].
export function freeLoops(project, walls) {
  if (!(project.walls || []).length) return [];
  const field = loopField(project, walls);
  if (!field) return [];
  const out = [];
  for (const info of field.comps) {
    if (info.open || tooSmall(info)) continue;
    const shape = compShape(field, info.id);
    if (shape) out.push({ comp: info.id, ...shape });
  }
  return out;
}

const LEAK = 'Стены здесь не замкнуты — помещение «вытечет» на улицу';

// Что получится, если создать помещение в точке p.
// → { ok, shape } | { ok: false, reason }.
export function findLoopAt(project, walls, p) {
  const block = (project.rooms || []).find((r) => roomContainsPoint(r, p.x, p.y));
  if (block) return { ok: false, reason: `Здесь уже помещение «${block.name}»` };
  const field = loopField(project, walls);
  if (!field || span(field.xs, p.x) < 0 || span(field.ys, p.y) < 0) return { ok: false, reason: LEAK };
  const c = compAt(field, p);
  if (c < 0) return { ok: false, reason: 'Кликните внутри петли стен, а не по стене' };
  const info = field.comps[c];
  if (info.open) return { ok: false, reason: LEAK };
  if (tooSmall(info)) return { ok: false, reason: 'Петля слишком узкая для помещения' };
  const shape = compShape(field, c);
  return shape ? { ok: true, shape } : { ok: false, reason: 'Контур не найден' };
}

// ---------------------------------------------------------------- Петля → комната

const overlapLen = (a0, a1, b0, b1) => Math.min(a1, b1) - Math.max(a0, b0);
const distToRange = (v, from, to) => (v < from ? from - v : v > to ? v - to : 0);
const alongBase = (room, orient) => (orient === 'h' ? room.x : room.y);

// Контур (абсолютные точки) → x/y/w/h + outline; коллинеарные точки
// убираются, прямоугольник — без outline (как у нарисованной комнаты).
function setContour(room, pts) {
  const xs = pts.map((p) => p.x); const ys = pts.map((p) => p.y);
  room.x = Math.min(...xs); room.y = Math.min(...ys);
  room.w = Math.max(...xs) - room.x; room.h = Math.max(...ys) - room.y;
  delete room.notch;
  room.outline = pts.map((p) => ({ x: p.x - room.x, y: p.y - room.y }));
  finalizeRoomOutline(room);
}

// Ручные стены, чья грань лежит на стороне e (тело — снаружи комнаты).
function faceWalls(project, e) {
  const out = [];
  for (const wall of project.walls || []) {
    if (wall.roomBounding === false) continue;
    const g = manualWallGeometry(wall);
    if (!g || g.orient !== e.orient) continue;
    if (Math.abs((e.outward > 0 ? g.lo : g.hi) - e.edge) > EPS) continue;
    const len = overlapLen(g.from, g.to, e.from, e.to);
    if (len > EPS) out.push({ wall, g, len });
  }
  return out;
}

// Внешний контур кольца стен: каждая сторона сдвинута наружу на свою толщину
// (ортогональный контур — вершина = пересечение двух сдвинутых линий).
function ringOuter(room, edges, thick) {
  const pts = roomPolygon(room);
  const n = pts.length;
  const byIndex = new Map(edges.map((e) => [e.index, e]));
  const line = (e) => e.edge + e.outward * thick.get(e.index);
  return pts.map((p, i) => {
    const prev = byIndex.get((i - 1 + n) % n); const next = byIndex.get(i);
    if (!prev || !next || prev.orient === next.orient) return { x: p.x, y: p.y };
    const h = prev.orient === 'h' ? prev : next;
    const v = prev.orient === 'v' ? prev : next;
    return { x: line(v), y: line(h) };
  });
}

// Прямоугольник целиком внутри объединения прямоугольников (допуск 1 мм по краю).
function rectInside(rect, rects) {
  let covered = 0;
  for (const r of rects) {
    const w = overlapLen(rect.x, rect.x + rect.w, r.x, r.x + r.w);
    const h = overlapLen(rect.y, rect.y + rect.h, r.y, r.y + r.h);
    if (w > 0 && h > 0) covered += w * h;
  }
  return covered >= rect.w * rect.h - (rect.w + rect.h) * EPS;
}

// Параметры стены комнаты из ручной стены; null — всё по умолчанию.
function overrideFrom(wall, t, project) {
  const exterior = project.settings?.exterior || DEFAULT_EXTERIOR;
  const kind = wall.wallType || 'partition';
  const out = {};
  if (Math.abs(t - exterior) > 0.5) out.thickness = Math.round(t);
  if (kind !== 'exterior') out.kind = kind;
  if (wall.hidden) out.hidden = true;
  if (wall.top?.level || Number(wall.top?.height) > 0) {
    out.top = wall.top.level
      ? { level: wall.top.level, offset: Number(wall.top.offset) || 0 }
      : { height: Number(wall.top.height) };
  }
  if (Number(wall.base?.offset)) out.base = { offset: Number(wall.base.offset) };
  return Object.keys(out).length ? out : null;
}

// Своя стена комнаты-соседа на стороне f (как в wallSegments): толщина и класс.
function ownWall(project, other, f) {
  const own = project.wallOverrides?.[ownKey(other.id, f.side)];
  const t = Number(own?.thickness) > 0 ? Number(own.thickness) : (project.settings?.exterior || DEFAULT_EXTERIOR);
  return { thickness: t, kind: own?.kind || 'exterior' };
}

// Соседи стороны e: стороны других комнат напротив на зазоре, который
// занимает стена (своя стена соседа или ручная стена этой стороны, mine).
// → [{ other, f, gap, kind }].
function edgeNeighbours(project, room, e, mine) {
  const out = [];
  for (const other of project.rooms || []) {
    if (other.id === room.id || other.parentId || isOpenRoom(other) || isShaft(other)) continue;
    for (const f of roomBoundaryEdges(other)) {
      if (f.orient !== e.orient || f.outward !== -e.outward) continue;
      const gap = (f.edge - e.edge) * e.outward;
      if (gap <= EPS || gap > MAX_SHARED_GAP || overlapLen(e.from, e.to, f.from, f.to) <= EPS) continue;
      const theirs = ownWall(project, other, f);
      if (mine && Math.abs(mine.g.thickness - gap) <= EPS) out.push({ other, f, gap, kind: mine.wall.wallType || 'partition' });
      else if (Math.abs(theirs.thickness - gap) <= EPS) out.push({ other, f, gap, kind: theirs.kind });
    }
  }
  return out;
}

// Общие стены с соседями: пара получает wallOverrides[s|a|b] с толщиной
// зазора и классом стены — findAdjacencies признаёт стыковку (перегородка
// по умолчанию на зазоре перегородки — общая и без записи).
function linkNeighbours(project, room, neighbours) {
  const overrides = project.wallOverrides;
  const partition = project.settings?.partition || DEFAULT_PARTITION;
  for (const list of neighbours.values()) {
    for (const { other, gap, kind } of list) {
      const key = sharedKey(room.id, other.id);
      if (overrides[key]) continue;
      if (Math.abs(gap - partition) > EPS || kind !== 'partition') overrides[key] = { thickness: Math.round(gap), kind };
    }
  }
}

// Петля ручных стен с контуром poly («в свету», ортогональный) → обычная
// комната (base — поля комнаты: id, type, name…). Мутирует project.
// walls — выведенные стены до правки (позиции проёмов host).
// → { room, removed: [wallId], lost: [openingId] }.
export function loopToRoom(project, walls, poly, base) {
  const room = { ...base, parentId: null };
  setContour(room, poly);
  const edges = roomBoundaryEdges(room);
  if (!project.wallOverrides) project.wallOverrides = {};
  const overrides = project.wallOverrides;

  // Стена каждой стороны — ручная с гранью на ней (самая длинная по стороне).
  const onEdge = new Map(edges.map((e) => [e.index, faceWalls(project, e)]));
  const chosen = new Map();
  for (const e of edges) {
    const best = [...onEdge.get(e.index)].sort((a, b) => b.len - a.len)[0];
    if (best) chosen.set(e.index, best);
  }
  // Кольцо будущих стен комнаты: ручная стена стороны, иначе стена соседа
  // на зазоре, иначе своя наружная стена по умолчанию.
  const neighbours = new Map(edges.map((e) => [e.index, edgeNeighbours(project, room, e, chosen.get(e.index))]));
  const exterior = project.settings?.exterior || DEFAULT_EXTERIOR;
  const thick = new Map();
  for (const e of edges) {
    const c = chosen.get(e.index);
    const gaps = neighbours.get(e.index).map((n) => n.gap);
    thick.set(e.index, c ? c.g.thickness : (gaps.length ? Math.max(...gaps) : exterior));
  }
  const ring = roomRects({ x: 0, y: 0, w: 0, h: 0, outline: ringOuter(room, edges, thick) });

  // Стены кольца: тело целиком в кольце и та же толщина, что у стороны.
  const removed = new Map(); // wallId → { g, edges }
  for (const e of edges) {
    for (const { wall, g } of onEdge.get(e.index)) {
      if (Math.abs(g.thickness - thick.get(e.index)) > 0.5 || !rectInside(g.band, ring)) continue;
      if (!removed.has(wall.id)) removed.set(wall.id, { g, edges: [] });
      removed.get(wall.id).edges.push(e);
    }
  }

  // Своя стена стороны — параметры её ручной стены.
  for (const e of edges) {
    const c = chosen.get(e.index);
    const key = ownKey(room.id, e.side);
    if (!c || overrides[key]) continue;
    const value = overrideFrom(c.wall, c.g.thickness, project);
    if (value) overrides[key] = value;
  }

  // Проёмы удаляемых стен → проёмы комнаты на той же мировой позиции.
  const lost = [];
  for (const o of project.openings || []) {
    const hit = o.host && removed.get(o.host.wallId);
    if (!hit) continue;
    const { g } = hit;
    const abs = g.axisStart + g.dir * Number(o.host.t);
    const e = [...hit.edges].sort((a, b) => distToRange(abs, a.from, a.to) - distToRange(abs, b.from, b.to))[0];
    if (!e || distToRange(abs, e.from, e.to) > Number(o.width) / 2) { lost.push(o.id); continue; }
    if (o.kind === 'door') {
      // Открывание — в ту же сторону мира: у проёма host «внутрь» — по оси стены.
      const placed = openingRect(project, o, walls);
      if (placed) {
        const inward = placed.wall.outward || 1;
        const dir = o.swingIn ? inward : -inward;
        o.swingIn = dir === -e.outward;
      }
    }
    o.roomId = room.id;
    o.side = e.side;
    o.offset = abs - alongBase(room, e.orient);
    delete o.host;
  }
  project.openings = (project.openings || []).filter((o) => !lost.includes(o.id));
  project.walls = (project.walls || []).filter((w) => !removed.has(w.id));
  project.rooms.push(room);
  linkNeighbours(project, room, neighbours);
  return { room, removed: [...removed.keys()], lost };
}

// Инструмент «Помещение»: петля в точке p → обычная комната (тип и имя — как
// у новой комнаты по умолчанию). → { ok, room, removed, lost } | { ok: false, reason }.
export function createLoopRoom(project, walls, p, { type = 'living', name = null } = {}) {
  const found = findLoopAt(project, walls, p);
  if (!found.ok) return found;
  const fresh = createRoom(type, 0, 0, 1, 1);
  if (name) fresh.name = name;
  return { ok: true, ...loopToRoom(project, walls, found.shape.poly, fresh) };
}

// ---------------------------------------------------------------- Старые помещения по стенам

// Ортогональный контур из ≥ 4 точек.
function orthoPoly(pts) {
  if (!Array.isArray(pts) || pts.length < 4) return null;
  for (let i = 0; i < pts.length; i += 1) {
    const a = pts[i]; const b = pts[(i + 1) % pts.length];
    if (Math.abs(a.x - b.x) > 0.5 && Math.abs(a.y - b.y) > 0.5) return null;
  }
  return pts;
}

// Миграция: помещения room.bound этажа lp (вид проекта: rooms, walls,
// openings, wallOverrides, settings, levels, activeLevel) → обычные комнаты.
// Замкнутая петля у seed — по ней; разомкнутая/слитая или seed в стене — по
// последнему кешу контура room.poly (иначе габарит x/y/w/h): недостающие
// стороны получают обычные стены комнаты — комната становится замкнутой.
// Порядок комнат сохраняется. → число конвертированных.
export function convertBoundRooms(lp) {
  const bound = (lp.rooms || []).filter(isBoundRoom);
  if (!bound.length) return 0;
  const order = new Map(lp.rooms.map((r, i) => [r.id, i]));
  // Неконвертированные не мешают заливке (как и раньше, они не препятствия).
  lp.rooms = lp.rooms.filter((r) => !isBoundRoom(r));
  if (!Array.isArray(lp.walls)) lp.walls = [];
  if (!Array.isArray(lp.openings)) lp.openings = [];
  for (const old of bound) {
    const walls = deriveWalls(lp);
    const found = findLoopAt(lp, walls, old.bound.seed);
    const poly = found.ok ? found.shape.poly : orthoPoly(old.poly) || [
      { x: old.x, y: old.y }, { x: old.x + old.w, y: old.y },
      { x: old.x + old.w, y: old.y + old.h }, { x: old.x, y: old.y + old.h },
    ];
    const {
      bound: _bound, poly: _poly, holes: _holes, boundIssue: _issue, boundWith: _with, outline: _outline, notch: _notch, ...base
    } = old;
    loopToRoom(lp, walls, poly, { ...base, id: base.id || makeId('room') });
  }
  lp.rooms.sort((a, b) => (order.get(a.id) ?? Infinity) - (order.get(b.id) ?? Infinity));
  return bound.length;
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
  const blocks = (project.rooms || []).filter((r) => !isShaft(r) && !isOpenRoom(r));
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
  if (!room || !wall) return { ok: false, reason: 'Комната или стена не найдена' };
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
