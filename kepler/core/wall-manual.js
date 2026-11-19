// Ручные стены (схема 6, level.walls[]): создание и правка. Чистый модуль
// без DOM. Стена хранится объектом (ось a→b, толщина, привязка justify,
// низ/верх); тело и узлы строит движок v2 (core/walls-v2.js). Проёмы на
// стене — opening.host { wallId, t }, t — центр проёма от axis.a.
//
// Связность узлов не хранится: при сдвиге стены торцы других ручных стен,
// лежащие на её теле, едут вместе с ней (вычисляется из геометрии).

import { DEFAULT_PARTITION } from './catalog.js';
import { makeId } from './model.js';
import { roomContainsPoint, roomShapeArea } from './room-shape.js';
import { WALL_T_MAX, WALL_T_MIN, manualWallGeometry, wallClassThickness } from './walls.js';

export const MANUAL_WALL_MIN = 100; // мм — короче стену не строим
const JUSTIFY = ['center', 'left', 'right'];

const clampT = (value, fallback) => {
  const t = Math.round(Number(value));
  if (!Number.isFinite(t) || t <= 0) return fallback;
  return Math.min(WALL_T_MAX, Math.max(WALL_T_MIN, t));
};

// Ось строго ортогональна (этап B): точка b прижимается к горизонтали или
// вертикали через a — по большей проекции.
export function orthoPoint(a, p) {
  return Math.abs(p.x - a.x) >= Math.abs(p.y - a.y) ? { x: p.x, y: a.y } : { x: a.x, y: p.y };
}

// Привязка точки инструмента «Стена»: к предыдущей точке — ортогонально;
// по каждой свободной оси — к ближайшей линии привязки (грани и углы стен,
// оси и торцы ручных стен, points — доп. точки: вершины эскиза масс) в
// пределах tol, иначе к сетке grid. gridPoints — координационные оси (как
// points, вторая координата NaN) со своим радиусом gridTol (магнит 300 мм):
// ось берёт верх, если она ближе линии привязки стен; пересечение двух осей —
// угол. → { point, snapX, snapY, gridX, gridY } (snapX/snapY — координата
// линии привязки или null; gridX/gridY — true, если это координационная ось).
// Центр стены (centers): осевая линия тела каждой стены — луч по её
// направлению (у наружной — середина толщины, у общей — середина зазора, у
// ручной — её ось); mids — середина стены (центр отрезка) рядом с телом.
// centerX/centerY — 'center' | 'mid' | null, label — «центр стены» /
// «середина стены» или ''.
export function snapWallPoint({
  p, prev = null, walls = [], manual = [], points = [], gridPoints = [], gridTol = 0, tol = 0, grid = 0, free = false,
  centers = true, mids = true,
}) {
  const q = prev ? orthoPoint(prev, p) : { x: p.x, y: p.y };
  if (free) return { point: q, snapX: null, snapY: null, gridX: false, gridY: false, centerX: null, centerY: null, label: '' };
  const xs = []; const ys = [];
  for (const w of walls) {
    for (const r of w.polys ? w.polys.flat() : (w.band ? [{ x: w.band.x, y: w.band.y }, { x: w.band.x + w.band.w, y: w.band.y + w.band.h }] : [])) {
      xs.push(r.x); ys.push(r.y);
    }
  }
  for (const m of manual) for (const e of [m.axis.a, m.axis.b]) { xs.push(e.x); ys.push(e.y); }
  for (const e of points) { xs.push(e.x); ys.push(e.y); }
  // Цели «центр стены»: { v, tag } (берут верх только если строго ближе).
  const cx = []; const cy = [];
  if (centers || mids) {
    for (const c of wallCenterTargets(walls)) {
      const across = c.orient === 'v' ? q.x : q.y;
      const along = c.orient === 'v' ? q.y : q.x;
      if (centers) (c.orient === 'v' ? cx : cy).push({ v: c.at, tag: 'center' });
      // Середина — только у самого тела стены (иначе вся сетка в линиях).
      if (mids && Math.abs(across - c.at) <= c.half + tol && along >= c.from - tol && along <= c.to + tol) {
        (c.orient === 'v' ? cy : cx).push({ v: c.mid, tag: 'mid' });
      }
    }
  }
  const near = (v, list) => {
    let best = null; let d = tol;
    for (const c of list) { const dd = Math.abs(c - v); if (dd <= d) { d = dd; best = c; } }
    return best;
  };
  const nearCenter = (v, list, than) => {
    let best = null; let d = than === null ? tol : Math.abs(than - v) - 1e-6;
    for (const c of list) { const dd = Math.abs(c.v - v); if (dd <= d) { d = dd; best = c; } }
    return best;
  };
  const gx = gridPoints.map((e) => e.x).filter(Number.isFinite);
  const gy = gridPoints.map((e) => e.y).filter(Number.isFinite);
  const nearGrid = (v, list) => {
    let best = null; let d = Math.max(tol, gridTol);
    for (const c of list) { const dd = Math.abs(c - v); if (dd <= d) { d = dd; best = c; } }
    return best;
  };
  // Линия стен, центр стены или ось — что ближе (ось — в своём радиусе).
  const pick = (v, list, clist, glist) => {
    let a = near(v, list); let center = null;
    const c = nearCenter(v, clist, a);
    if (c) { a = c.v; center = c.tag; }
    const b = nearGrid(v, glist);
    if (b === null) return { at: a, grid: false, center };
    if (a === null || Math.abs(b - v) < Math.abs(a - v)) return { at: b, grid: true, center: null };
    return { at: a, grid: false, center };
  };
  const lockX = Boolean(prev) && q.x === prev.x;
  const lockY = Boolean(prev) && q.y === prev.y;
  let snapX = null; let snapY = null; let gridX = false; let gridY = false; let centerX = null; let centerY = null;
  if (!lockX) { const s = pick(q.x, xs, cx, gx); snapX = s.at; gridX = s.grid; centerX = s.center; q.x = snapX ?? (grid ? Math.round(q.x / grid) * grid : q.x); }
  if (!lockY) { const s = pick(q.y, ys, cy, gy); snapY = s.at; gridY = s.grid; centerY = s.center; q.y = snapY ?? (grid ? Math.round(q.y / grid) * grid : q.y); }
  const tags = [centerX, centerY];
  const label = tags.includes('mid') ? 'середина стены' : (tags.includes('center') ? 'центр стены' : '');
  return { point: q, snapX, snapY, gridX, gridY, centerX, centerY, label };
}

// Цели привязки «центр стены» по записям стен (state.walls / deriveWalls):
// [{ orient, at, half, from, to, mid, key }] — at — осевая линия тела
// (поперёк), half — полтолщины, from…to — вдоль, mid — середина стены.
// Узлы, фаски и скрытые стены не дают целей; совпадающие — один раз.
export function wallCenterTargets(walls) {
  const out = [];
  const seen = new Set();
  for (const w of walls || []) {
    if (!w || w.hidden || !['own', 'shared', 'manual'].includes(w.kind)) continue;
    const b = w.band;
    if (!b || (w.orient !== 'h' && w.orient !== 'v')) continue;
    const h = w.orient === 'h';
    const lo = h ? b.y : b.x; const hi = h ? b.y + b.h : b.x + b.w;
    const from = h ? b.x : b.y; const to = h ? b.x + b.w : b.y + b.h;
    if (hi - lo < 1 || to - from < 1) continue;
    const at = (lo + hi) / 2;
    const key = `${w.orient}|${at}|${from}|${to}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ orient: w.orient, at, half: (hi - lo) / 2, from, to, mid: (from + to) / 2, key: w.key });
  }
  return out;
}

export function createWall(a, b, {
  thickness = DEFAULT_PARTITION, wallType = 'partition', justify = 'center', height = null, ownerRoomId = null,
} = {}) {
  return {
    id: makeId('wall'),
    axis: { kind: 'line', a: { x: a.x, y: a.y }, b: { x: b.x, y: b.y } },
    justify: JUSTIFY.includes(justify) ? justify : 'center',
    thickness: clampT(thickness, DEFAULT_PARTITION),
    typeId: null,
    wallType,
    base: { offset: 0 },
    top: { level: null, offset: 0, height: Number(height) > 0 ? Number(height) : null },
    hidden: false,
    roomBounding: true,
    ...(ownerRoomId ? { ownerRoomId } : {}),
  };
}

// Помещение-владелец внутренней стены. При вложенных помещениях выбирается
// самое маленькое: стена санузла должна ехать с санузлом, а не со спальней.
export function manualWallOwner(project, a, b) {
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  return (project.rooms || [])
    .filter((room) => roomContainsPoint(room, mid.x, mid.y))
    .sort((left, right) => roomShapeArea(left) - roomShapeArea(right))[0]?.id || null;
}

export function manualWallById(project, id) {
  return (project.walls || []).find((w) => w.id === id) || null;
}

function wallLength(w) {
  return Math.hypot(w.axis.b.x - w.axis.a.x, w.axis.b.y - w.axis.a.y);
}

// Проверка оси: ортогональна и не короче MANUAL_WALL_MIN.
export function wallAxisVerdict(a, b) {
  if (!manualWallGeometry({ axis: { a, b }, thickness: 100 })) return { ok: false, reason: 'Стена — только по горизонтали или вертикали' };
  if (Math.hypot(b.x - a.x, b.y - a.y) < MANUAL_WALL_MIN) return { ok: false, reason: `Стена короче ${MANUAL_WALL_MIN} мм` };
  return { ok: true };
}

// Добавляет стену на активный этаж. → стена или null (ось негодна).
export function addManualWall(project, a, b, opts = {}) {
  if (!wallAxisVerdict(a, b).ok) return null;
  const ownerRoomId = opts.ownerRoomId === undefined ? manualWallOwner(project, a, b) : opts.ownerRoomId;
  const wall = createWall(a, b, { ...opts, ownerRoomId });
  if (!Array.isArray(project.walls)) project.walls = [];
  project.walls.push(wall);
  return wall;
}

// Позиция проёмов (host.t) сохраняется в мире при смене начала оси a.
function keepHostOpenings(project, wall, before) {
  const g0 = manualWallGeometry(before);
  const g1 = manualWallGeometry(wall);
  if (!g0 || !g1) return;
  for (const o of project.openings || []) {
    if (o.host?.wallId !== wall.id) continue;
    const abs = g0.axisStart + g0.dir * Number(o.host.t);
    o.host = { ...o.host, t: (abs - g1.axisStart) * g1.dir };
  }
}

// Сдвиг стены по нормали на delta (мм, +x/+y). Торцы других ручных стен,
// примыкающие к телу этой стены, едут вместе с ней.
export function moveManualWall(project, id, delta) {
  const wall = manualWallById(project, id);
  const g = wall && manualWallGeometry(wall);
  if (!g || !Number.isFinite(delta)) return { ok: false, reason: 'Эту стену нельзя переместить' };
  if (Math.abs(delta) < 1e-9) return { ok: true, moved: [] };
  const key = g.orient === 'h' ? 'y' : 'x';
  const along = g.orient === 'h' ? 'x' : 'y';
  const carried = [];
  for (const other of project.walls) {
    if (other === wall) continue;
    const og = manualWallGeometry(other);
    if (!og || og.orient === g.orient) continue;
    for (const end of ['a', 'b']) {
      const p = other.axis[end];
      const onBody = p[key] >= g.lo - 1 && p[key] <= g.hi + 1 && p[along] >= g.from - 1 && p[along] <= g.to + 1;
      if (!onBody) continue;
      const before = structuredClone(other);
      other.axis[end] = { ...p, [key]: p[key] + delta };
      if (wallLength(other) < MANUAL_WALL_MIN) { Object.assign(other, before); continue; }
      keepHostOpenings(project, other, before);
      carried.push(other.id);
    }
  }
  wall.axis.a = { ...wall.axis.a, [key]: wall.axis.a[key] + delta };
  wall.axis.b = { ...wall.axis.b, [key]: wall.axis.b[key] + delta };
  return { ok: true, moved: carried };
}

// Перенос торца end ('a' | 'b') в точку p: стена остаётся ортогональной
// (меняется только координата вдоль оси), не короче MANUAL_WALL_MIN и не
// разворачивается. Проёмы остаются на месте в мире.
export function dragManualWallEnd(project, id, end, p) {
  const wall = manualWallById(project, id);
  const g = wall && manualWallGeometry(wall);
  if (!g || (end !== 'a' && end !== 'b')) return { ok: false, reason: 'Торец не найден' };
  const along = g.orient === 'h' ? 'x' : 'y';
  const before = structuredClone(wall);
  const fixed = wall.axis[end === 'a' ? 'b' : 'a'];
  const value = p[along];
  const sign = Math.sign(end === 'b' ? value - fixed[along] : fixed[along] - value);
  if (sign !== g.dir || Math.abs(value - fixed[along]) < MANUAL_WALL_MIN) {
    return { ok: false, reason: `Стена короче ${MANUAL_WALL_MIN} мм` };
  }
  wall.axis[end] = { ...wall.axis[end], [along]: value };
  keepHostOpenings(project, wall, before);
  return { ok: true };
}

// Толщина: ось (линия привязки) остаётся на месте, тело растёт от неё.
export function setManualWallThickness(project, id, t) {
  const wall = manualWallById(project, id);
  if (!wall) return { ok: false, reason: 'Стена не найдена' };
  wall.thickness = clampT(t, wall.thickness);
  return { ok: true, thickness: wall.thickness };
}

// Класс стены; толщина по умолчанию нового класса, если своя не задавалась.
export function setManualWallKind(project, id, kind) {
  const wall = manualWallById(project, id);
  if (!wall) return { ok: false, reason: 'Стена не найдена' };
  const wasDefault = Math.abs(wall.thickness - wallClassThickness(project.settings, wall.wallType)) <= 1;
  wall.wallType = kind;
  if (wasDefault) wall.thickness = wallClassThickness(project.settings, kind);
  return { ok: true, thickness: wall.thickness };
}

// Привязка оси (грань/центр). keepBody — тело остаётся на месте, сдвигается
// ось (иначе тело «перескакивает» на другую сторону оси).
export function setManualWallJustify(project, id, justify, { keepBody = true } = {}) {
  const wall = manualWallById(project, id);
  if (!wall || !JUSTIFY.includes(justify)) return { ok: false, reason: 'Стена не найдена' };
  const g0 = manualWallGeometry(wall);
  wall.justify = justify;
  const g1 = manualWallGeometry(wall);
  if (keepBody && g0 && g1) {
    const shift = g0.lo - g1.lo;
    const key = g0.orient === 'h' ? 'y' : 'x';
    wall.axis.a = { ...wall.axis.a, [key]: wall.axis.a[key] + shift };
    wall.axis.b = { ...wall.axis.b, [key]: wall.axis.b[key] + shift };
  }
  return { ok: true };
}

// Высота стены: { height } — от низа до верха, мм (null — по этажу);
// { base } — отметка низа от пола этажа. Ручная стена — в объекте, стена
// комнаты — в wallOverrides[key] (общий вход для обоих источников).
export function setWallHeight(project, wallOrKey, { height, base } = {}) {
  const key = typeof wallOrKey === 'string' ? wallOrKey : wallOrKey?.key;
  const manualId = typeof wallOrKey === 'object' && wallOrKey?.wallId
    ? wallOrKey.wallId : (key?.startsWith('m|') ? key.slice(2) : null);
  const h = height === null ? null : (Number(height) > 0 ? Math.round(Number(height)) : undefined);
  if (manualId) {
    const wall = manualWallById(project, manualId);
    if (!wall) return { ok: false, reason: 'Стена не найдена' };
    if (h !== undefined) wall.top = { ...(wall.top || {}), level: null, height: h };
    if (Number.isFinite(Number(base))) wall.base = { ...(wall.base || {}), offset: Number(base) };
    return { ok: true };
  }
  if (!key) return { ok: false, reason: 'Стена не найдена' };
  const cur = project.wallOverrides[key] || {};
  const next = { ...cur };
  if (h !== undefined) next.top = { ...(cur.top || {}), height: h };
  if (Number.isFinite(Number(base))) next.base = { ...(cur.base || {}), offset: Number(base) };
  project.wallOverrides[key] = next;
  return { ok: true };
}

// Удаление стены вместе с её проёмами.
export function removeManualWall(project, id) {
  const before = (project.walls || []).length;
  project.walls = (project.walls || []).filter((w) => w.id !== id);
  project.openings = (project.openings || []).filter((o) => o.host?.wallId !== id);
  return project.walls.length !== before;
}
