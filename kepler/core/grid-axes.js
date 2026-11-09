// Координационные оси (как Grids в Revit / «Оси» в ArchiCAD): линии с марками
// «1, 2, 3…» (вертикальные) и «А, Б, В…» (горизонтальные). Чистый модуль без
// DOM.
//
// project.grids[] (необязательно) — { id, label, kind, at, from?, to?, hidden? }
// в осях ДОМА (как комнаты; поворот дома building.rotation учитывается при
// рисовании, как у комнат):
//   kind 'x' — вертикальная линия x = at (марки 1, 2, 3…);
//   kind 'y' — горизонтальная линия y = at (марки А, Б, В… по ГОСТ 21.101 —
//     без Ё, З, Й, О, Ч, Ы, Ь, Ъ; дальше А1, Б1…);
//   from, to — пределы линии вдоль неё (мм); нет — габарит дома + 1500 мм;
//   hidden — скрыта на плане.
// Наклонных осей в этом шаге нет.
//
// Нумерация «Осей по стенам»: вертикальные — слева направо, горизонтальные —
// снизу вверх (ось Y плана направлена вниз — «А» внизу).

import { isOpenRoom, isShaft } from './catalog.js';
import { roomRects } from './room-shape.js';

export const GRID_LETTERS = 'АБВГДЕЖИКЛМНПРСТУФХЦШЩЭЮЯ';
export const GRID_OVERHANG = 1500; // мм — выход оси за габарит дома
export const GRID_MERGE = 300; // мм — ближе сливаются в одну ось
export const GRID_MAX = 12; // осей одного направления у «Осей по стенам»
export const GRID_SNAP_MM = 300; // мм — радиус притяжения граней к оси
const LABEL_MAX = 8;

let counter = 0;
const newId = () => {
  counter += 1;
  return `grid-${Date.now().toString(36)}-${counter.toString(36)}`;
};

const num = (v) => {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
};
const round = (v) => Math.round(v);

// ------------------------------------------------------------- марки

// Марка по порядковому номеру i (с 0): 'x' → '1', '2'…; 'y' → 'А'…'Я', 'А1'….
export function gridLabelAt(kind, i) {
  if (kind === 'x') return String(i + 1);
  const n = GRID_LETTERS.length;
  const cycle = Math.floor(i / n);
  return GRID_LETTERS[i % n] + (cycle ? String(cycle) : '');
}

// Порядковый номер марки (обратное к gridLabelAt) или -1 — марка «своя».
export function gridLabelIndex(kind, label) {
  const s = String(label ?? '').trim();
  if (kind === 'x') return /^[1-9]\d*$/.test(s) ? Number(s) - 1 : -1;
  const m = /^([А-Я])(\d*)$/.exec(s);
  if (!m) return -1;
  const k = GRID_LETTERS.indexOf(m[1]);
  if (k < 0) return -1;
  const r = m[2] ? Number(m[2]) : 0;
  if (m[2] && !(r >= 1)) return -1;
  return r * GRID_LETTERS.length + k;
}

// Следующая свободная марка направления kind.
export function nextGridLabel(grids, kind) {
  const used = new Set((grids || []).filter((g) => g.kind === kind).map((g) => String(g.label)));
  for (let i = 0; ; i += 1) {
    const l = gridLabelAt(kind, i);
    if (!used.has(l)) return l;
  }
}

// ------------------------------------------------------------- создание

export function normalizeKind(kind) {
  if (kind === 'x' || kind === 'v') return 'x';
  if (kind === 'y' || kind === 'h') return 'y';
  return null;
}

// Новая ось; марка — следующая свободная, если не задана.
export function createGrid({ kind = 'x', at = 0, label = null, from = null, to = null } = {}, existing = []) {
  const k = normalizeKind(kind) || 'x';
  const g = { id: newId(), label: '', kind: k, at: round(num(at) ?? 0) };
  const l = typeof label === 'string' ? label.trim().slice(0, LABEL_MAX) : '';
  g.label = l || nextGridLabel(existing, k);
  const f = num(from); const t = num(to);
  if (f !== null && t !== null && Math.abs(t - f) >= 1) { g.from = round(Math.min(f, t)); g.to = round(Math.max(f, t)); }
  return g;
}

// Чистка одной оси из файла: битая — null (марку без текста дадут позже).
export function normalizeGrid(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const kind = normalizeKind(raw.kind);
  const at = num(raw.at);
  if (!kind || at === null) return null;
  const g = {
    id: typeof raw.id === 'string' && raw.id ? raw.id : newId(),
    label: typeof raw.label === 'string' || typeof raw.label === 'number' ? String(raw.label).trim().slice(0, LABEL_MAX) : '',
    kind,
    at: round(at),
  };
  const f = num(raw.from); const t = num(raw.to);
  if (f !== null && t !== null && Math.abs(t - f) >= 1) { g.from = round(Math.min(f, t)); g.to = round(Math.max(f, t)); }
  if (raw.hidden === true) g.hidden = true;
  return g;
}

// Список осей: битые отброшены, дубли id переименованы, пустые марки —
// следующие свободные.
export function normalizeGrids(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  const ids = new Set();
  for (const raw of list) {
    const g = normalizeGrid(raw);
    if (!g) continue;
    if (ids.has(g.id)) g.id = newId();
    ids.add(g.id);
    out.push(g);
  }
  for (const g of out) if (!g.label) g.label = nextGridLabel(out, g.kind);
  return out;
}

// Порядок: сначала вертикальные слева направо, затем горизонтальные снизу вверх.
export function sortGrids(grids) {
  return [...(grids || [])].sort((a, b) => (a.kind === b.kind
    ? (a.kind === 'x' ? a.at - b.at : b.at - a.at)
    : (a.kind === 'x' ? -1 : 1)));
}

// Перенумерация по порядку (1, 2, 3… слева направо; А, Б… снизу вверх).
export function renumberGrids(grids) {
  const idx = { x: 0, y: 0 };
  const labels = new Map();
  for (const g of sortGrids(grids)) { labels.set(g.id, gridLabelAt(g.kind, idx[g.kind])); idx[g.kind] += 1; }
  return grids.map((g) => ({ ...g, label: labels.get(g.id) }));
}

export const moveGrid = (g, at) => ({ ...g, at: round(at) });

// Пределы линии вдоль (from < to; меньше 300 мм не бывает).
export function setGridExtent(g, from, to) {
  const lo = Math.min(from, to); const hi = Math.max(from, to);
  if (hi - lo < 300) return { ...g };
  return { ...g, from: round(lo), to: round(hi) };
}

export function resetGridExtent(g) {
  const { from: _f, to: _t, ...rest } = g;
  return rest;
}

export const visibleGrids = (grids) => (grids || []).filter((g) => !g.hidden);

// ------------------------------------------------------------- геометрия

// Комнаты, дающие габарит дома (без открытых, шахт и вложенных).
function footprintRects(rooms) {
  return (rooms || []).filter((r) => r && !r.parentId && !isOpenRoom(r) && !isShaft(r))
    .flatMap((r) => roomRects(r));
}

function projectLevels(project) {
  const levels = Array.isArray(project?.levels) && project.levels.length ? project.levels : null;
  return levels ? levels.map((l) => l.rooms || []) : [project?.rooms || []];
}

// Габарит дома по всем этажам (по наружной грани стен) или null.
export function houseBox(project) {
  const ext = Number(project?.settings?.exterior) || 250;
  let box = null;
  for (const rooms of projectLevels(project)) {
    for (const r of footprintRects(rooms)) {
      const b = { minX: r.x - ext, minY: r.y - ext, maxX: r.x + r.w + ext, maxY: r.y + r.h + ext };
      box = box ? {
        minX: Math.min(box.minX, b.minX), minY: Math.min(box.minY, b.minY),
        maxX: Math.max(box.maxX, b.maxX), maxY: Math.max(box.maxY, b.maxY),
      } : b;
    }
  }
  return box;
}

// Пределы линии оси вдоль неё: свои from/to или габарит дома (вместе с
// положениями осей другого направления) + выступ.
export function gridExtent(project, g, overhang = GRID_OVERHANG) {
  if (num(g.from) !== null && num(g.to) !== null) return { from: g.from, to: g.to };
  const box = houseBox(project);
  let lo = box ? (g.kind === 'x' ? box.minY : box.minX) : Infinity;
  let hi = box ? (g.kind === 'x' ? box.maxY : box.maxX) : -Infinity;
  for (const o of visibleGrids(project?.grids)) {
    if (o.kind === g.kind) continue;
    lo = Math.min(lo, o.at); hi = Math.max(hi, o.at);
  }
  if (!(hi >= lo)) { lo = -3000; hi = 3000; }
  return { from: lo - overhang, to: hi + overhang };
}

// Отрезок оси { a, b } в осях дома.
export function gridSegment(project, g) {
  const e = gridExtent(project, g);
  return g.kind === 'x'
    ? { a: { x: g.at, y: e.from }, b: { x: g.at, y: e.to } }
    : { a: { x: e.from, y: g.at }, b: { x: e.to, y: g.at } };
}

// Размерная цепочка между соседними осями направления kind:
// [{ a, b, distance }] (a левее/ниже b по координате).
export function gridChain(grids, kind) {
  const list = visibleGrids(grids).filter((g) => g.kind === kind).sort((p, q) => p.at - q.at);
  const out = [];
  for (let i = 0; i + 1 < list.length; i += 1) {
    const d = list[i + 1].at - list[i].at;
    if (d >= 1) out.push({ a: list[i], b: list[i + 1], distance: d });
  }
  return out;
}

// Ближайшая видимая ось направления kind к значению в пределах tol или null.
export function nearestGrid(grids, kind, value, tol = Infinity) {
  let best = null;
  for (const g of visibleGrids(grids)) {
    if (g.kind !== kind) continue;
    const d = Math.abs(g.at - value);
    if (d <= tol && (!best || d < best.d)) best = { grid: g, d };
  }
  return best;
}

// Привязка значения к ближайшей линии из list (числа) в пределах tol,
// иначе к шагу step. → { value, line }.
export function snapGridValue(v, list, tol, step) {
  let best = null; let d = tol;
  for (const c of list || []) {
    const dd = Math.abs(c - v);
    if (dd <= d) { d = dd; best = c; }
  }
  if (best !== null) return { value: best, line: best };
  return { value: step > 0 ? Math.round(v / step) * step : Math.round(v), line: null };
}

// Точки привязки инструмента «Стена» (core/wall-manual.js snapWallPoint):
// у вертикальной оси задан только x, у горизонтальной — только y (вторая
// координата NaN — с ней ничего не совпадает).
export function gridWallPoints(grids) {
  return visibleGrids(grids).map((g) => (g.kind === 'x' ? { x: g.at, y: NaN } : { x: NaN, y: g.at }));
}

// Смещения грани комнаты от оси (внутрь комнаты), при которых срабатывает
// притяжение: 'face' — грань комнаты на оси или наружная грань стены на оси
// (грань комнаты отступает от оси на толщину наружной стены); 'axis' — ось
// стены на оси (отступ — полтолщины).
export function gridOffsets(mode, exterior = 250) {
  const t = Number(exterior) || 250;
  return mode === 'axis' ? [t / 2] : [0, t];
}

// Притяжение прямоугольника { x, y, w, h } к осям (магнит, как у эскиза
// масс). edges — подвижные грани ('w','e','n','s') при растяжении, без —
// перенос целиком. → { x, y, w, h, snappedX, snappedY, guides }; направляющая
// идёт по самой оси (gridId — какая ось сработала).
export function snapRectToGrids(rect, grids, {
  distance = GRID_SNAP_MM, offsets = [0], edges = null, skipX = false, skipY = false, extent = null,
} = {}) {
  const out = { ...rect, snappedX: false, snappedY: false, guides: [] };
  const list = visibleGrids(grids);
  if (!list.length || !(distance > 0)) return out;
  const move = !edges;
  const can = (e) => move || edges.includes(e);
  for (const axis of ['x', 'y']) {
    if ((axis === 'x' && skipX) || (axis === 'y' && skipY)) continue;
    const [p, s] = axis === 'x' ? ['x', 'w'] : ['y', 'h'];
    const lo = rect[p]; const hi = rect[p] + rect[s];
    let best = null;
    for (const g of list) {
      if (g.kind !== axis) continue;
      for (const o of offsets) {
        for (const [edge, cur, sign] of [[axis === 'x' ? 'w' : 'n', lo, 1], [axis === 'x' ? 'e' : 's', hi, -1]]) {
          if (!can(edge)) continue;
          // Смещение внутрь комнаты: у левой/верхней грани +o, у правой/нижней −o.
          const at = g.at + sign * o;
          const dd = Math.abs(at - cur);
          if (dd > distance) continue;
          const score = dd + Math.abs(o) * 1e-6;
          if (!best || score < best.score) best = { score, edge, at, grid: g };
        }
      }
    }
    if (!best) continue;
    const hiSide = best.edge === 'e' || best.edge === 's';
    if (move) out[p] = hiSide ? best.at - out[s] : best.at;
    else if (hiSide) out[s] = Math.max(1, best.at - out[p]);
    else { out[s] = Math.max(1, out[p] + out[s] - best.at); out[p] = best.at; }
    if (axis === 'x') out.snappedX = true; else out.snappedY = true;
    const [q, t] = axis === 'x' ? ['y', 'h'] : ['x', 'w'];
    const ext = extent ? extent(best.grid) : null;
    out.guides.push({
      type: 'magnet', kind: 'align', axis: axis === 'x' ? 'v' : 'h', at: best.grid.at, gridId: best.grid.id,
      from: Math.min(out[q], ext ? ext.from : out[q]), to: Math.max(out[q] + out[t], ext ? ext.to : out[q] + out[t]),
    });
  }
  return out;
}

// ------------------------------------------------------------- «Оси по стенам»

// Рёбра объединения прямоугольников: { v: [{at, len}], h: [{at, len}] }.
function unionEdges(rects) {
  const xs = [...new Set(rects.flatMap((r) => [r.x, r.x + r.w]))].sort((a, b) => a - b);
  const ys = [...new Set(rects.flatMap((r) => [r.y, r.y + r.h]))].sort((a, b) => a - b);
  const nx = xs.length - 1; const ny = ys.length - 1;
  const cells = [];
  for (let i = 0; i < nx; i += 1) {
    cells.push([]);
    for (let j = 0; j < ny; j += 1) {
      const cx = (xs[i] + xs[i + 1]) / 2; const cy = (ys[j] + ys[j + 1]) / 2;
      cells[i].push(rects.some((r) => cx > r.x && cx < r.x + r.w && cy > r.y && cy < r.y + r.h));
    }
  }
  const inside = (i, j) => i >= 0 && j >= 0 && i < nx && j < ny && cells[i][j];
  const v = []; const h = [];
  for (let i = 0; i <= nx; i += 1) {
    for (let j = 0; j < ny; j += 1) if (inside(i - 1, j) !== inside(i, j)) v.push({ at: xs[i], len: ys[j + 1] - ys[j] });
  }
  for (let j = 0; j <= ny; j += 1) {
    for (let i = 0; i < nx; i += 1) if (inside(i, j - 1) !== inside(i, j)) h.push({ at: ys[j], len: xs[i + 1] - xs[i] });
  }
  return { v, h };
}

// Наружные грани дома по этажам: { v: [{at, len}], h } на отступе expand
// от граней комнат (exterior — наружная грань стен, exterior/2 — ось).
export function outerFaces(project, expand = 0) {
  const v = []; const h = [];
  for (const rooms of projectLevels(project)) {
    const rects = footprintRects(rooms).map((r) => ({ x: r.x - expand, y: r.y - expand, w: r.w + 2 * expand, h: r.h + 2 * expand }));
    if (!rects.length) continue;
    const e = unionEdges(rects);
    v.push(...e.v); h.push(...e.h);
  }
  return { v, h };
}

// Ось внутренней стены (state.walls / deriveWalls): { orient, at, len } или null.
function wallLine(w) {
  const pts = [];
  if (Array.isArray(w.polys)) for (const poly of w.polys) for (const p of poly) pts.push(p);
  else if (w.band) pts.push({ x: w.band.x, y: w.band.y }, { x: w.band.x + w.band.w, y: w.band.y + w.band.h });
  if (pts.length < 2) return null;
  const minX = Math.min(...pts.map((p) => p.x)); const maxX = Math.max(...pts.map((p) => p.x));
  const minY = Math.min(...pts.map((p) => p.y)); const maxY = Math.max(...pts.map((p) => p.y));
  const vert = w.orient ? w.orient === 'v' : (maxY - minY) >= (maxX - minX);
  return vert
    ? { orient: 'v', at: (minX + maxX) / 2, len: maxY - minY }
    : { orient: 'h', at: (minY + maxY) / 2, len: maxX - minX };
}

// Кластеры кандидатов: соседние ближе merge сливаются; положение кластера —
// у самого «весомого» кандидата (наружные важнее).
function clusters(cands, merge) {
  const list = [...cands].sort((a, b) => a.at - b.at);
  const out = [];
  let cur = null;
  for (const c of list) {
    if (cur && c.at - cur.first < merge) {
      cur.items.push(c);
    } else {
      cur = { first: c.at, items: [c] };
      out.push(cur);
    }
  }
  return out.map((cl) => {
    const outer = cl.items.filter((c) => c.outer);
    const pool = outer.length ? outer : cl.items;
    const best = pool.reduce((a, b) => (b.weight > a.weight ? b : a));
    return {
      at: Math.round(best.at),
      outer: outer.length > 0,
      weight: cl.items.reduce((s, c) => s + c.weight, 0) + (outer.length ? 1e9 : 0),
    };
  });
}

// Сетка осей по наружным и несущим стенам: { x: [at…], y: [at…] } (без
// марок). walls — стены активного этажа (необязательно): несущие дают оси
// в полную силу, длинные перегородки — слабее. mode 'face' — оси по
// наружной грани наружных стен, 'axis' — по оси стен.
export function gridLinesByWalls(project, { walls = [], mode = 'face', max = GRID_MAX, merge = GRID_MERGE } = {}) {
  const ext = Number(project?.settings?.exterior) || 250;
  const faces = outerFaces(project, mode === 'axis' ? ext / 2 : ext);
  const cand = { x: [], y: [] };
  for (const e of faces.v) cand.x.push({ at: e.at, weight: e.len, outer: true });
  for (const e of faces.h) cand.y.push({ at: e.at, weight: e.len, outer: true });
  for (const w of walls || []) {
    if (!w || w.kind === 'joint' || w.kind === 'chamfer' || w.hidden) continue;
    if (w.wallType === 'exterior' || w.kind === 'own') continue; // наружные — по контуру выше
    const l = wallLine(w);
    if (!l || l.len < 1) continue;
    const bearing = w.wallType === 'bearing';
    (l.orient === 'v' ? cand.x : cand.y).push({ at: l.at, weight: bearing ? l.len : l.len * 0.25, outer: false });
  }
  const pick = (list) => {
    // Сначала наружные грани, затем внутренние стены дальше merge от них;
    // короткие перегородки (суммарно < 2 м) осей не дают.
    const outer = clusters(list.filter((c) => c.outer), merge);
    const inner = clusters(list.filter((c) => !c.outer && !outer.some((o) => Math.abs(o.at - c.at) < merge)), merge)
      .filter((c) => c.weight >= 2000);
    let cl = [...outer, ...inner];
    if (cl.length > max) cl = [...cl].sort((a, b) => b.weight - a.weight).slice(0, max);
    return cl.map((c) => c.at).sort((a, b) => a - b);
  };
  return { x: pick(cand.x), y: pick(cand.y) };
}

// «Оси по стенам»: новые оси (только недостающие — у существующих осей того
// же направления ближе merge новая не ставится). Без существующих — марки
// по порядку (1, 2… слева направо; А, Б… снизу вверх), иначе — следующие
// свободные. → массив новых осей.
export function autoGrids(project, opts = {}) {
  const merge = opts.merge || GRID_MERGE;
  const existing = normalizeGrids(project?.grids || []);
  const lines = gridLinesByWalls(project, opts);
  const fresh = [];
  for (const kind of ['x', 'y']) {
    for (const at of lines[kind]) {
      if (existing.some((g) => g.kind === kind && Math.abs(g.at - at) < merge)) continue;
      fresh.push({ id: newId(), label: '', kind, at });
    }
  }
  if (!existing.length) return renumberGrids(fresh);
  const all = [...existing];
  for (const g of sortGrids(fresh)) {
    g.label = nextGridLabel(all, g.kind);
    all.push(g);
  }
  return fresh;
}
