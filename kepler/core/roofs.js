// Крыши-плиты (плоская кровля с выносом, краем-фасцией и парапетом) —
// объект проекта, как массы и оси: project.roofs[] (необязательно, без смены
// схемы; пустой список не хранится). Чистый модуль, без DOM.
//
// Крыша = {
//   id, name ('Крыша 1'),
//   levelId — этаж, НАД которым лежит плита: низ плиты = level.elevation +
//             level.height + dz, верх = низ + thickness;
//   dz — поднять/опустить, мм (по умолчанию 0);
//   outline [{x, y}] — свой контур основания (без выноса) в осях дома, мм:
//             простой многоугольник — ортогональный (прямоугольник, Г, П…)
//             или с косыми рёбрами (трапеция, ромб, треугольник); с
//             помещениями не связан — двигается и правится сам (план крыши,
//             ui/roof-plan.js). Точки «излома» на прямой (без поворота)
//             допустимы — заготовка уступа. Старые крыши над помещениями
//             (roomIds) при открытии получают контур по помещениям (normalizeRoofs);
//   overhang { n, e, s, w } — вынос от контура по сторонам в осях дома (n — к
//             меньшим y, «верх» плана; e — к большим x), 0…3000 мм; на
//             Г-образном основании каждое ребро сдвигается по своей нормали
//             (сумма Минковского прямоугольников с коробкой выноса);
//   thickness — толщина плиты 150…600 (300);
//   edge { type: plain|fascia|cornice|drip, height 150…600 (250), color? };
//   parapet { type: none|wall|glass|rail|stepped, height, thickness, inset,
//             sides { n, e, s, w }: bool };
//   material: graphite|white|wood|concrete|metal; drain: bool (маркер);
//   autoMerge — необязательно; false — не сливаться с касающимися крышами
//             (mergeTouchingRoofs: этаж и верх плиты те же — один общий контур).
// }
// Геометрия ортогонального контура — на общей сетке прямоугольников (как
// перекрытия в core/mesh3d.js regionGrid): плита, кольцо фасции снаружи,
// кольцо парапета внутри (эрозия по включённым сторонам). Косой контур —
// многоугольником: каждое ребро сдвигается по своей нормали на вынос
// nx²·(e|w) + ny²·(n|s) (offsetOutline, угол — пересечение соседних линий,
// острый выпуклый — срез), плита — треугольники (triangulate).

import { DEFAULT_EXTERIOR, isOpenRoom, isShaft } from './catalog.js';
import { union as clipUnion } from './geom/clip.js';
import { polygonRects, roomLabelPoint, roomRects, roomShapeHandles } from './room-shape.js';

export const ROOF_SIDES = ['n', 'e', 's', 'w'];
export const SIDE_TITLES = { n: 'верх', e: 'право', s: 'низ', w: 'лево' };

export const OVERHANG_DEFAULT = 600;
export const OVERHANG_MAX = 3000;
export const OVERHANG_SNAPS = [0, 600, 1000, 1500];
export const ROOF_THICK = { def: 300, min: 150, max: 600 };
export const EDGE_HEIGHT = { def: 250, min: 150, max: 600 };
export const PARAPET_HEIGHT = { def: 600, min: 100, max: 2000 };
export const PARAPET_THICK = { def: 200, min: 20, max: 600 };
export const DEFAULT_FLAT_PARAPET_HEIGHT = 200;
export const DEFAULT_ROOF_MATERIAL = 'graphite';
export const INSET_MAX = 2000;
export const DZ_LIMIT = 10000;
export const FASCIA_T = 40; // толщина листа фасции, мм

export const EDGE_TYPES = [
  { id: 'plain', title: 'Тонкий', hint: 'торец плиты без обрамления' },
  { id: 'fascia', title: 'Фасция', hint: 'вертикальный борт по периметру выноса' },
  { id: 'cornice', title: 'Карниз', hint: 'профиль со ступенью' },
  { id: 'drip', title: 'Капельник', hint: 'слив-капельник по низу края' },
];
export const PARAPET_TYPES = [
  { id: 'none', title: 'Нет' },
  { id: 'wall', title: 'Стенка' },
  { id: 'glass', title: 'Стекло' },
  { id: 'rail', title: 'Перила' },
  { id: 'stepped', title: 'Ступенчатый' },
];
export const ROOF_MATERIALS = [
  { id: 'graphite', title: 'Графит', color: '#3d4148' },
  { id: 'white', title: 'Белый', color: '#ecebe6' },
  { id: 'wood', title: 'Дерево', color: '#a8794b' },
  { id: 'concrete', title: 'Бетон', color: '#b2afa7' },
  { id: 'metal', title: 'Металл', color: '#8a929b' },
];
const allSides = (v) => ({ n: v, e: v, s: v, w: v });
export const ROOF_PRESETS = [
  {
    id: 'modern', title: 'Как на фото', hint: 'современная плоская: вынос 1200, фасция 250 графит, без парапета',
    patch: { overhang: allSides(1200), thickness: 300, edge: { type: 'fascia', height: 250 }, parapet: { type: 'none' }, material: 'graphite' },
  },
  {
    id: 'terrace', title: 'Эксплуатируемая кровля', hint: 'парапет-стенка 1000, без выноса',
    patch: {
      overhang: allSides(0), thickness: 300, edge: { type: 'plain', height: 250 },
      parapet: { type: 'wall', height: 1000, thickness: 200, inset: 0, sides: allSides(true) }, material: 'white',
    },
  },
];

const EDGE_IDS = new Set(EDGE_TYPES.map((t) => t.id));
const PARAPET_IDS = new Set(PARAPET_TYPES.map((t) => t.id));
const MATERIAL_IDS = new Set(ROOF_MATERIALS.map((t) => t.id));

export const roofMaterial = (id) => MATERIAL_IDS.has(id) ? id : DEFAULT_ROOF_MATERIAL;
export const materialColor = (id) => (ROOF_MATERIALS.find((m) => m.id === id) || ROOF_MATERIALS[0]).color;
export const edgeTitle = (id) => EDGE_TYPES.find((t) => t.id === id)?.title || id;
export const parapetTitle = (id) => PARAPET_TYPES.find((t) => t.id === id)?.title || id;

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const num = (v, def) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Number(v) : def);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const range = (v, r) => Math.round(clamp(num(v, r.def), r.min, r.max));
export const clampOverhang = (v) => Math.round(clamp(num(v, OVERHANG_DEFAULT), 0, OVERHANG_MAX));

let seq = 0;
export function roofId() {
  seq += 1;
  return `rf-${Date.now().toString(36)}${seq.toString(36)}`;
}

// Следующее имя «Крыша N».
export function nextRoofName(existing = []) {
  let n = 0;
  for (const r of existing || []) {
    const m = /^Крыша (\d+)$/.exec(r?.name || '');
    if (m) n = Math.max(n, Number(m[1]));
  }
  return `Крыша ${Math.max(n, (existing || []).length) + 1}`;
}

const samePt = (a, b) => Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5;
// b на прямой ac (отклонение < 0,75 мм): 'straight' — по ходу, 'spike' — шип назад.
function lineKind(a, b, c) {
  const L = Math.hypot(c.x - a.x, c.y - a.y);
  const ux = b.x - a.x; const uy = b.y - a.y; const vx = c.x - b.x; const vy = c.y - b.y;
  if (L < 0.5) return Math.hypot(ux, uy) < 0.5 ? null : 'spike';
  if (Math.abs((c.x - a.x) * uy - (c.y - a.y) * ux) / L >= 0.75) return null;
  return ux * vx + uy * vy > 0 ? 'straight' : 'spike';
}

function cleanOutline(list) {
  if (!Array.isArray(list)) return null;
  const pts = list.filter((p) => isObj(p) && Number.isFinite(Number(p.x)) && Number.isFinite(Number(p.y)))
    .map((p) => ({ x: Math.round(Number(p.x)), y: Math.round(Number(p.y)) }));
  return pts.length >= 3 ? pts : null;
}

// Контур без повторов и без точек посреди прямой (в т. ч. «шипов» назад).
// keepBreaks — точки излома на прямой (заготовки уступа) остаются.
export function tidyOutline(points, { keepBreaks = false } = {}) {
  const pts = (points || []).map((p) => ({ x: Math.round(p.x), y: Math.round(p.y) }));
  let changed = true;
  while (changed && pts.length >= 3) {
    changed = false;
    for (let i = 0; i < pts.length; i += 1) {
      const a = pts[(i - 1 + pts.length) % pts.length];
      const b = pts[i];
      const c = pts[(i + 1) % pts.length];
      const k = samePt(a, b) ? 'same' : lineKind(a, b, c);
      if (k === 'same' || k === 'spike' || (k === 'straight' && !keepBreaks)) { pts.splice(i, 1); changed = true; break; }
    }
  }
  return pts;
}

// Все рёбра по осям (прямоугольник, Г, П…) — геометрия на сетке прямоугольников.
export function isOrthoOutline(points) {
  const n = (points || []).length;
  for (let i = 0; i < n; i += 1) {
    const a = points[i]; const b = points[(i + 1) % n];
    if (Math.abs(a.x - b.x) > 0.5 && Math.abs(a.y - b.y) > 0.5) return false;
  }
  return true;
}

const signedArea2 = (pts) => {
  let s = 0;
  for (let i = 0; i < pts.length; i += 1) {
    const a = pts[i]; const b = pts[(i + 1) % pts.length];
    s += a.x * b.y - b.x * a.y;
  }
  return s;
};

// Нормали рёбер наружу (единичные; у нулевого ребра — null).
export function outlineNormals(points) {
  const s = signedArea2(points) >= 0 ? 1 : -1;
  return points.map((a, i) => {
    const b = points[(i + 1) % points.length];
    const L = Math.hypot(b.x - a.x, b.y - a.y);
    return L < 0.5 ? null : { x: (s * (b.y - a.y)) / L, y: (-s * (b.x - a.x)) / L };
  });
}

// Точка внутри многоугольника (на границе — внутри).
export function pointInOutline(points, x, y) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
    const a = points[j]; const b = points[i];
    const L = Math.hypot(b.x - a.x, b.y - a.y);
    if (L > 0 && Math.abs((b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x)) / L < 0.5
      && x >= Math.min(a.x, b.x) - 0.5 && x <= Math.max(a.x, b.x) + 0.5
      && y >= Math.min(a.y, b.y) - 0.5 && y <= Math.max(a.y, b.y) + 0.5) return true;
    if ((a.y > y) !== (b.y > y) && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

// Вынос ребра с нормалью n по сторонам { n, e, s, w }: nx²·(e|w) + ny²·(n|s)
// (ребро по оси — ровно вынос своей стороны, под 45° — среднее).
export function edgeOverhang(oh, n) {
  if (!n) return 0;
  return n.x * n.x * (n.x > 0 ? oh.e : oh.w) + n.y * n.y * (n.y > 0 ? oh.s : oh.n);
}

// Сдвиг контура: ребро i — по своей нормали наружу на dist(n, i) (меньше
// нуля — внутрь). Угол — пересечение соседних линий; острый выпуклый угол
// (выступ длиннее 4 сдвигов) — срез двумя точками. Точки излома на прямой
// (соседние рёбра параллельны) сдвигаются по нормали.
export function offsetOutline(points, dist, { bevel = true } = {}) {
  const src = (points || []).filter((p, i, list) => !samePt(p, list[(i + 1) % list.length]));
  const n = src.length;
  if (n < 3) return [];
  const N = outlineNormals(src);
  const D = N.map((nn, i) => (typeof dist === 'function' ? dist(nn, i) : Number(dist) || 0));
  const out = [];
  for (let j = 0; j < n; j += 1) {
    const i = (j - 1 + n) % n;
    const a = src[j];
    const n1 = N[i]; const n2 = N[j]; const d1 = D[i]; const d2 = D[j];
    const det = n1.x * n2.y - n1.y * n2.x;
    const at = (nn, d) => ({ x: a.x + nn.x * d, y: a.y + nn.y * d });
    if (Math.abs(det) < 1e-6) {
      if (Math.abs(d1 - d2) < 0.5) out.push(at(n2, d2));
      else out.push(at(n1, d1), at(n2, d2));
      continue;
    }
    const q = { x: (d1 * n2.y - d2 * n1.y) / det, y: (n1.x * d2 - n2.x * d1) / det };
    const lim = 4 * Math.max(Math.abs(d1), Math.abs(d2));
    const outward = (q.x * (n1.x + n2.x) + q.y * (n1.y + n2.y)) * Math.sign(d1 + d2) > 0;
    if (bevel && lim > 0 && Math.hypot(q.x, q.y) > lim && outward) out.push(at(n1, d1), at(n2, d2));
    else out.push({ x: a.x + q.x, y: a.y + q.y });
  }
  return out;
}

// Простой многоугольник → треугольники [[a, b, c], …] (отсечение ушей).
export function triangulate(points) {
  const pts = (points || []).filter((p, i, list) => !samePt(p, list[(i + 1) % list.length]));
  if (pts.length < 3) return [];
  const s = signedArea2(pts) >= 0 ? 1 : -1;
  const idx = pts.map((_p, i) => i);
  const tris = [];
  const cr = (a, b, c) => ((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)) * s;
  let guard = 0;
  while (idx.length > 3 && guard < 10000) {
    guard += 1;
    let cut = false;
    for (let k = 0; k < idx.length; k += 1) {
      const a = pts[idx[(k - 1 + idx.length) % idx.length]];
      const b = pts[idx[k]];
      const c = pts[idx[(k + 1) % idx.length]];
      const turn = cr(a, b, c);
      if (turn < 0) continue;
      if (Math.abs(turn) < 1e-6) { idx.splice(k, 1); cut = true; break; } // на прямой
      const inside = idx.some((m) => {
        const p = pts[m];
        if (p === a || p === b || p === c) return false;
        return cr(a, b, p) >= 0 && cr(b, c, p) >= 0 && cr(c, a, p) >= 0;
      });
      if (inside) continue;
      tris.push([a, b, c]);
      idx.splice(k, 1);
      cut = true;
      break;
    }
    if (!cut) break; // негодный контур — сколько вышло
  }
  if (idx.length === 3) tris.push(idx.map((m) => pts[m]));
  return tris;
}

export function outlineArea(points) {
  let twice = 0;
  for (let i = 0; i < (points || []).length; i += 1) {
    const a = points[i]; const b = points[(i + 1) % points.length];
    twice += a.x * b.y - b.x * a.y;
  }
  return Math.abs(twice) / 2;
}

function segsTouch(p1, p2, p3, p4) {
  const o = (a, b, c) => {
    const v = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    return Math.abs(v) < 0.5 ? 0 : Math.sign(v);
  };
  const on = (a, b, c) => Math.min(a.x, b.x) - 0.5 <= c.x && c.x <= Math.max(a.x, b.x) + 0.5
    && Math.min(a.y, b.y) - 0.5 <= c.y && c.y <= Math.max(a.y, b.y) + 0.5;
  const d1 = o(p3, p4, p1); const d2 = o(p3, p4, p2); const d3 = o(p1, p2, p3); const d4 = o(p1, p2, p4);
  if (d1 * d2 < 0 && d3 * d4 < 0) return true;
  return (d1 === 0 && on(p3, p4, p1)) || (d2 === 0 && on(p3, p4, p2))
    || (d3 === 0 && on(p1, p2, p3)) || (d4 === 0 && on(p1, p2, p4));
}

// Годный контур крыши: ≥ 3 вершин (рёбра любые, излом на прямой можно),
// без повторов, шипов назад и самопересечений, площадь не меньше 0,01 м².
export function validOutline(points) {
  if (!Array.isArray(points) || points.length < 3) return false;
  const n = points.length;
  for (let i = 0; i < n; i += 1) {
    const a = points[i]; const b = points[(i + 1) % n];
    if (!Number.isFinite(a?.x) || !Number.isFinite(a?.y) || samePt(a, b)) return false;
    if (lineKind(points[(i - 1 + n) % n], a, b) === 'spike') return false;
  }
  if (outlineArea(points) < 1e4) return false;
  for (let i = 0; i < n; i += 1) {
    for (let j = i + 2; j < n; j += 1) {
      if (i === 0 && j === n - 1) continue;
      if (segsTouch(points[i], points[(i + 1) % n], points[j], points[(j + 1) % n])) return false;
    }
  }
  return true;
}

export const boxOutline = (b) => [{ x: b.x0, y: b.y0 }, { x: b.x1, y: b.y0 }, { x: b.x1, y: b.y1 }, { x: b.x0, y: b.y1 }];

// Рёбра контура области (gridEdges) → замкнутые обходы или null (у точки не 2 ребра).
function chainEdges(edges) {
  const key = (p) => `${Math.round(p.x)},${Math.round(p.y)}`;
  const at = new Map();
  edges.forEach((e, i) => {
    for (const p of [e.a, e.b]) {
      const k = key(p);
      if (!at.has(k)) at.set(k, []);
      at.get(k).push(i);
    }
  });
  if ([...at.values()].some((l) => l.length !== 2)) return null;
  const used = new Set();
  const loops = [];
  for (let s = 0; s < edges.length; s += 1) {
    if (used.has(s)) continue;
    const loop = [];
    let i = s;
    let p = edges[s].a;
    while (!used.has(i)) {
      used.add(i);
      loop.push({ x: p.x, y: p.y });
      const e = edges[i];
      const q = key(e.a) === key(p) ? e.b : e.a;
      const next = at.get(key(q)).find((j) => j !== i);
      p = q;
      i = next;
    }
    loops.push(loop);
  }
  return loops;
}

// Объединение прямоугольников → один ортогональный контур; несвязные куски
// или дворы — габарит (контур крыши — один многоугольник без дыр).
export function rectsOutline(rects) {
  const list = (rects || []).filter((r) => r.x1 - r.x0 > 0.5 && r.y1 - r.y0 > 0.5);
  if (!list.length) return null;
  const loops = chainEdges(gridEdges(rectGrid([list])));
  if (loops && loops.length === 1) {
    const t = tidyOutline(loops[0]);
    if (validOutline(t)) return t;
  }
  return boxOutline(rectsBox(list));
}

// Прямоугольники помещений этажа с наружной стеной (открытые — без стены).
export function roomsBaseRects(project, levelId, roomIds) {
  const l = (project?.levels || []).find((x) => x.id === levelId);
  if (!l) return [];
  const ids = new Set(roomIds || []);
  const t = Number(project?.settings?.exterior) || DEFAULT_EXTERIOR;
  return (l.rooms || []).filter((r) => ids.has(r.id))
    .flatMap((r) => roomRects(r).map((p) => box(p, isOpenRoom(r) ? 0 : t)));
}

// Автоматическая кровля принадлежит наружному объёму. Вложенные комнаты
// уже находятся под крышей своего хозяина, площадки и шахты её не создают.
export function canHaveLinkedRoof(room) {
  return Boolean(room && !room.parentId && !isOpenRoom(room) && !isShaft(room));
}

export function setLinkedRoofEnabled(project, levelId, roomIds, enabled) {
  const level = project?.levels?.find((l) => l.id === levelId);
  if (!level || typeof enabled !== 'boolean') return false;
  const ids = new Set(typeof roomIds === 'string' ? [roomIds] : roomIds);
  let changed = false;
  for (const room of level.rooms) {
    if (!ids.has(room.id) || !canHaveLinkedRoof(room) || enabled === (room.linkedRoof !== false)) continue;
    if (enabled) delete room.linkedRoof;
    else room.linkedRoof = false;
    changed = true;
  }
  return changed;
}

// Единый скат для прилегающих комнат, отдельные объекты для разных корпусов.
// Обход отрезков по X ограничивает сравнения близкими прямоугольниками;
// касание только в вершине не образует общий скат.
function linkedGroupsOfLevel(project, level) {
  const exterior = Number(project.settings?.exterior) || DEFAULT_EXTERIOR;
  const rooms = (level.rooms || []).filter((room) => canHaveLinkedRoof(room) && room.linkedRoof !== false);
  const parents = rooms.map((_, i) => i);
  const root = (i) => {
    while (i !== parents[i]) {
      parents[i] = parents[parents[i]];
      i = parents[i];
    }
    return i;
  };
  const footprints = rooms.map((room) => roomRects(room).map((rect) => box(rect, exterior)));
  const sorted = footprints.flatMap((rects, owner) => rects.map((rect) => ({ ...rect, owner })))
    .sort((a, b) => a.x0 - b.x0);
  for (let i = 0; i < sorted.length; i++) {
    const a = sorted[i];
    for (let j = i + 1; j < sorted.length && sorted[j].x0 <= a.x1; j++) {
      const b = sorted[j];
      if (a.owner === b.owner) continue;
      const dx = Math.min(a.x1, b.x1) - b.x0;
      const dy = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
      if (dy >= 0 && (dx > 0 || dy > 0)) parents[root(b.owner)] = root(a.owner);
    }
  }
  const groups = new Map();
  rooms.forEach((room, i) => {
    if (!footprints[i].length) return;
    const key = root(i);
    if (!groups.has(key)) groups.set(key, { rooms: [], baseRects: [] });
    const group = groups.get(key);
    group.rooms.push(room);
    group.baseRects.push(...footprints[i]);
  });
  return [...groups.values()].map(({ rooms: members, baseRects }) => {
    members.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    const anchor = members[0];
    // Длина первой части отделяет идентификаторы, даже если в них есть двоеточие.
    const id = 'auto-roof:' + level.id.length + ':' + level.id + ':' + anchor.id;
    return { id, levelId: level.id, roofSource: 'linked', roomIds: members.map((room) => room.id), baseRects,
      name: 'Связанная крыша · ' + (anchor.name || level.name || level.id) };
  });
}

export function linkedRoofGroups(project, levelId = null) {
  if (project?.envelope?.roofMode === 'manual') return [];
  const levels = (project?.levels || []).filter((level) => levelId == null || level.id === levelId);
  return levels.flatMap((level) => linkedGroupsOfLevel(project, level));
}

export function linkedRoofById(project, id, levelId = null) {
  if (typeof id !== 'string' || !id.startsWith('auto-roof:')) return null;
  return linkedRoofGroups(project, levelId).find((roof) => roof.id === id) || null;
}

// Контур по помещениям (стартовая форма новой крыши, перенос старых файлов).
export function roomsOutline(project, levelId, roomIds) {
  return rectsOutline(roomsBaseRects(project, levelId, roomIds));
}

// Крыша из файла или правки → приведённая (лишние поля сохраняются) или null.
// Без своего контура крыша не живёт (старые roomIds переводит normalizeRoofs).
export function normalizeRoof(raw) {
  if (!isObj(raw) || typeof raw.levelId !== 'string' || !raw.levelId) return null;
  const outline = cleanOutline(raw.outline);
  if (!outline) return null;
  const oh = isObj(raw.overhang) ? raw.overhang : {};
  const e = isObj(raw.edge) ? raw.edge : {};
  const p = isObj(raw.parapet) ? raw.parapet : {};
  const ps = isObj(p.sides) ? p.sides : {};
  const out = {
    ...raw,
    id: typeof raw.id === 'string' && raw.id ? raw.id : roofId(),
    name: typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim().slice(0, 60) : 'Крыша',
    levelId: raw.levelId,
    dz: Math.round(clamp(num(raw.dz, 0), -DZ_LIMIT, DZ_LIMIT)),
    outline,
    overhang: Object.fromEntries(ROOF_SIDES.map((s) => [s, clampOverhang(oh[s])])),
    thickness: range(raw.thickness, ROOF_THICK),
    edge: {
      ...e, type: EDGE_IDS.has(e.type) ? e.type : 'fascia', height: range(e.height, EDGE_HEIGHT),
    },
    parapet: {
      ...p,
      type: PARAPET_IDS.has(p.type) ? p.type : 'none',
      height: range(p.height, PARAPET_HEIGHT),
      thickness: range(p.thickness, PARAPET_THICK),
      inset: Math.round(clamp(num(p.inset, 0), 0, INSET_MAX)),
      sides: Object.fromEntries(ROOF_SIDES.map((s) => [s, typeof ps[s] === 'boolean' ? ps[s] : true])),
    },
    material: roofMaterial(raw.material),
    drain: Boolean(raw.drain),
  };
  delete out.roomIds;
  if (typeof raw.autoMerge !== 'boolean') delete out.autoMerge;
  if (typeof e.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(e.color)) delete out.edge.color;
  return out;
}

// Список из файла: битые отброшены, id уникальны. levels (необязательно) —
// этажи проекта: крыша без этажа отбрасывается; старая крыша над помещениями
// (roomIds без outline) получает контур по ним — объединение с наружной
// стеной (settings.exterior), несвязные — габарит; поле roomIds уходит.
export function normalizeRoofs(list, levels = null, settings = null) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const out = [];
  for (const raw of list) {
    let src = raw;
    if (isObj(raw) && !cleanOutline(raw.outline) && Array.isArray(raw.roomIds) && levels) {
      const outline = roomsOutline({ levels, settings }, raw.levelId, raw.roomIds);
      if (outline) src = { ...raw, outline };
    }
    const r = normalizeRoof(src);
    if (!r) continue;
    if (levels && !levels.some((l) => l.id === r.levelId)) continue;
    if (seen.has(r.id)) r.id = roofId();
    seen.add(r.id);
    out.push(r);
  }
  return out;
}

// Новая плоская крыша, с тем же низким парапетом, что и у связанной.
export function createRoof({ levelId, outline, ...patch } = {}, existing = []) {
  return normalizeRoof({
    id: roofId(), name: nextRoofName(existing), levelId, outline, dz: 0,
    overhang: allSides(OVERHANG_DEFAULT), thickness: ROOF_THICK.def,
    edge: { type: 'fascia', height: EDGE_HEIGHT.def },
    parapet: { type: 'wall', height: DEFAULT_FLAT_PARAPET_HEIGHT, thickness: PARAPET_THICK.def, inset: 0, sides: allSides(true) },
    material: DEFAULT_ROOF_MATERIAL, drain: false,
    ...patch,
  });
}

// Новая крыша со стартовой формой по помещениям (дальше с ними не связана).
export function roofFromRooms(project, levelId, roomIds, patch = {}, existing = []) {
  const outline = roomsOutline(project, levelId, roomIds);
  return outline ? createRoof({ levelId, outline, ...patch }, existing) : null;
}

// Правка с вложенными полями (overhang/edge/parapet/sides сливаются).
export function patchRoof(roof, patch = {}) {
  const next = { ...roof, ...patch };
  if (patch.overhang) next.overhang = { ...roof.overhang, ...patch.overhang };
  if (patch.edge) next.edge = { ...roof.edge, ...patch.edge };
  if (patch.parapet) {
    next.parapet = { ...roof.parapet, ...patch.parapet };
    if (patch.parapet.sides) next.parapet.sides = { ...roof.parapet.sides, ...patch.parapet.sides };
  }
  return normalizeRoof(next) || roof;
}

export function applyRoofPreset(roof, presetId) {
  const p = ROOF_PRESETS.find((x) => x.id === presetId);
  return p ? patchRoof(roof, p.patch) : roof;
}

// ---------------------------------------------------------------- правка контура

// Перенос крыши целиком.
export function moveRoof(roof, dx, dy) {
  return { ...roof, outline: roof.outline.map((p) => ({ x: Math.round(p.x + dx), y: Math.round(p.y + dy) })) };
}

export function outlineBox(roof) {
  const xs = roof.outline.map((p) => p.x); const ys = roof.outline.map((p) => p.y);
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}

// Ручки контура (как у помещения с контуром, core/room-shape.js):
// вершины { id: 'outline-v-i', kind: 'vertex', index } и середины рёбер
// { id: 'outline-e-i', kind: 'edge', index } в осях дома.
// brk: true — вершина-излом на прямой (заготовка уступа).
export function roofOutlineHandles(roof) {
  const o = roof?.outline;
  if (!Array.isArray(o) || o.length < 3) return [];
  const hs = o.length >= 4 ? roomShapeHandles({ x: 0, y: 0, w: 0, h: 0, outline: o }) : [
    ...o.map((p, index) => ({ id: `outline-v-${index}`, kind: 'vertex', outline: true, index, x: p.x, y: p.y })),
    ...o.map((p, index) => ({ id: `outline-e-${index}`, kind: 'edge', outline: true, index, x: (p.x + o[(index + 1) % 3].x) / 2, y: (p.y + o[(index + 1) % 3].y) / 2 })),
  ];
  const n = o.length;
  for (const h of hs) {
    if (h.kind === 'vertex' && lineKind(o[(h.index - 1 + n) % n], o[h.index], o[(h.index + 1) % n]) === 'straight') h.brk = true;
  }
  return hs;
}

// Сдвиг ребра i (a→b) по его нормали на d (знак — по нормали (dy, −dx)/L).
// Концы скользят по линиям соседних рёбер (как стена помещения: соседние
// стены удлиняются); если сосед на одной прямой с ребром (точка излома),
// нулевой или почти параллелен — на конце встаёт уступ (новая точка, ребро
// по нормали). → { pts, ia, ib } — новый контур и индексы концов ребра.
export function shiftOutlineEdge(points, i, d) {
  const pts = points.map((p) => ({ x: p.x, y: p.y }));
  const n = pts.length;
  const ib0 = (i + 1) % n;
  const a = pts[i]; const b = pts[ib0];
  const L = Math.hypot(b.x - a.x, b.y - a.y);
  if (L < 0.5) return { pts, ia: i, ib: ib0 };
  const u = { x: (b.x - a.x) / L, y: (b.y - a.y) / L };
  const nn = { x: u.y, y: -u.x };
  const slide = (p, nb) => {
    const w = { x: nb.x - p.x, y: nb.y - p.y };
    const lw = Math.hypot(w.x, w.y);
    const sin = lw < 0.5 ? 0 : Math.abs(u.x * w.y - u.y * w.x) / lw;
    if (sin < 0.1) return null; // уступ
    const k = d / (nn.x * w.x + nn.y * w.y);
    return { x: p.x + w.x * k, y: p.y + w.y * k };
  };
  const moved = (p) => ({ x: p.x + nn.x * d, y: p.y + nn.y * d });
  const sa = slide(a, pts[(i - 1 + n) % n]);
  const sb = slide(b, pts[(i + 2) % n]);
  const out = [];
  let ia = -1; let ib = -1;
  for (let k = 0; k < n; k += 1) {
    if (k === i) {
      if (sa) { ia = out.length; out.push(sa); } else { out.push(a); ia = out.length; out.push(moved(a)); }
    } else if (k === ib0) {
      if (sb) { ib = out.length; out.push(sb); } else { ib = out.length; out.push(moved(b)); out.push(b); }
    } else out.push(pts[k]);
  }
  return { pts: out, ia, ib };
}

// Расстояние сдвига ребра i до точки, с притяжением к линиям других вершин
// (в пределах tol — ребро встаёт заподлицо с ними).
function edgeShift(pts, i, point, tol) {
  const n = pts.length;
  const a = pts[i]; const b = pts[(i + 1) % n];
  const L = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const nn = { x: (b.y - a.y) / L, y: -(b.x - a.x) / L };
  const along = (p) => nn.x * (p.x - a.x) + nn.y * (p.y - a.y);
  let d = along(point);
  if (tol > 0) {
    let best = tol;
    pts.forEach((p, k) => {
      if (k === i || k === (i + 1) % n) return;
      const v = along(p);
      if (Math.abs(v - d) <= best && Math.abs(v) > 0.5) { best = Math.abs(v - d); d = v; }
    });
  }
  return d;
}

const roundPts = (pts) => pts.map((p) => ({ x: Math.round(p.x), y: Math.round(p.y) }));
const finishOutline = (roof, pts) => {
  const t = tidyOutline(roundPts(pts), { keepBreaks: true });
  return validOutline(t) ? { ...roof, outline: t } : null;
};

// Ручка контура в точку. Ребро — сдвиг по нормали (концы скользят по
// соседям, у излома — уступ). Вершина: free — свободно в точку (косые
// рёбра; притяжение к x/y других вершин в пределах mergeTolerance — прямой
// угол), иначе — оба ребра параллельно (прямоугольник остаётся
// прямоугольником). → новая крыша или null (самопересечение, вырождение).
export function applyRoofOutlineHandle(roof, handle, point, { mergeTolerance = 0, free = false } = {}) {
  const pts = roof.outline.map((p) => ({ x: p.x, y: p.y }));
  const n = pts.length;
  const i = handle.index;
  if (!pts[i]) return null;
  const tol = mergeTolerance;
  if (handle.kind === 'edge') {
    return finishOutline(roof, shiftOutlineEdge(pts, i, edgeShift(pts, i, point, tol)).pts);
  }
  if (free) {
    const p = { x: point.x, y: point.y };
    if (tol > 0) {
      for (const axis of ['x', 'y']) {
        let best = tol;
        pts.forEach((q, k) => {
          if (k !== i && Math.abs(q[axis] - point[axis]) <= best) { best = Math.abs(q[axis] - point[axis]); p[axis] = q[axis]; }
        });
      }
    }
    pts[i] = p;
    return finishOutline(roof, pts);
  }
  const prev = (i - 1 + n) % n;
  const first = shiftOutlineEdge(pts, prev, edgeShift(pts, prev, point, tol));
  const second = shiftOutlineEdge(first.pts, first.ib, edgeShift(first.pts, first.ib, point, tol));
  return finishOutline(roof, second.pts);
}

// Проекция точки на ребро i → { t (0…1), along, len, p }.
function onEdge(pts, i, point) {
  const a = pts[i]; const b = pts[(i + 1) % pts.length];
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  const t = len > 0 ? clamp(((point.x - a.x) * (b.x - a.x) + (point.y - a.y) * (b.y - a.y)) / (len * len), 0, 1) : 0;
  return { t, along: t * len, len, p: { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t } };
}

// Излом на ребре: точка на прямой ребра (потянуть часть ребра — уступ,
// потянуть саму точку — косой излом). → крыша или null (у конца ребра).
export function insertRoofVertex(roof, edgeIndex, point, minGap = 100) {
  const pts = roof.outline.map((p) => ({ x: p.x, y: p.y }));
  if (!pts[edgeIndex]) return null;
  const e = onEdge(pts, edgeIndex, point);
  if (e.along < minGap || e.along > e.len - minGap) return null;
  pts.splice(edgeIndex + 1, 0, { x: Math.round(e.p.x), y: Math.round(e.p.y) });
  return { ...roof, outline: pts };
}

// «Сломать ребро как стену»: часть ребра i от точки нажатия at до
// ближнего конца уходит в точку point — уступ (Г, П, Т-формы). Нажатие у
// конца (ближе minGap) — сдвиг всего ребра. → крыша или null.
export function pushRoofEdgePart(roof, edgeIndex, at, point, { minGap = 100, mergeTolerance = 0 } = {}) {
  const pts = roof.outline.map((p) => ({ x: p.x, y: p.y }));
  if (!pts[edgeIndex]) return null;
  const e = onEdge(pts, edgeIndex, at);
  if (e.along < minGap || e.along > e.len - minGap) {
    return finishOutline(roof, shiftOutlineEdge(pts, edgeIndex, edgeShift(pts, edgeIndex, point, mergeTolerance)).pts);
  }
  pts.splice(edgeIndex + 1, 0, e.p);
  const part = e.t < 0.5 ? edgeIndex : edgeIndex + 1;
  return finishOutline(roof, shiftOutlineEdge(pts, part, edgeShift(pts, part, point, mergeTolerance)).pts);
}

// Удалить вершину. Излом на прямой — просто убрать. Угол ортогонального
// контура — срезается до соседей (вогнутый — уступ заполняется, у
// прямоугольника нельзя). Иначе — соседи соединяются прямо (из квадрата —
// треугольник нельзя: только у косого контура). → крыша или null.
export function removeRoofVertex(roof, index) {
  const src = roof.outline;
  const at = src[index];
  if (!at) return null;
  const n = src.length;
  if (lineKind(src[(index - 1 + n) % n], at, src[(index + 1) % n]) === 'straight') {
    const pts = src.filter((_p, k) => k !== index);
    return validOutline(pts) ? { ...roof, outline: pts } : null;
  }
  if (isOrthoOutline(src)) {
    const pts = tidyOutline(src);
    index = pts.findIndex((p) => samePt(p, at));
    if (index < 0 || pts.length <= 4) return null;
    const m = pts.length;
    const a = pts[(index - 1 + m) % m]; const b = pts[index]; const c = pts[(index + 1) % m];
    pts[index] = Math.abs(a.y - b.y) < 0.5 ? { x: a.x, y: c.y } : { x: c.x, y: a.y };
    const t = tidyOutline(pts);
    return validOutline(t) ? { ...roof, outline: t } : null;
  }
  const pts = src.filter((_p, k) => k !== index);
  const t = tidyOutline(pts, { keepBreaks: true });
  return validOutline(t) ? { ...roof, outline: t } : null;
}

// Ближайшее ребро контура к точке → { index, dist }.
export function nearestOutlineEdge(roof, p) {
  let best = { index: -1, dist: Infinity };
  const pts = roof.outline;
  for (let i = 0; i < pts.length; i += 1) {
    const a = pts[i]; const b = pts[(i + 1) % pts.length];
    const dx = b.x - a.x; const dy = b.y - a.y;
    const L = dx * dx + dy * dy;
    const t = L > 0 ? clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / L, 0, 1) : 0;
    const d = Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
    if (d < best.dist) best = { index: i, dist: d };
  }
  return best;
}

// Привязка координаты: к ближайшей линии в пределах tol, иначе к шагу.
export function snapCoord(v, lines = [], tol = 0, step = 0) {
  let best = null; let d = tol;
  for (const c of lines) {
    const dd = Math.abs(c - v);
    if (dd <= d) { d = dd; best = c; }
  }
  if (best != null) return { value: Math.round(best), snapped: true };
  return { value: step > 0 ? Math.round(v / step) * step : Math.round(v), snapped: false };
}

// Сдвиг крыши с привязкой граней габарита контура к линиям (иначе шаг).
export function snapRoofMove(roof, dx, dy, { xs = [], ys = [], tol = 0, step = 0 } = {}) {
  const b = outlineBox(roof);
  const axis = (d, a0, a1, lines) => {
    let best = null; let bd = tol;
    for (const c of lines) {
      for (const a of [a0, a1]) {
        const dd = Math.abs(c - (a + d));
        if (dd <= bd) { bd = dd; best = c - a; }
      }
    }
    if (best != null) return { value: Math.round(best), snapped: true };
    return { value: step > 0 ? Math.round(d / step) * step : Math.round(d), snapped: false };
  };
  const sx = axis(dx, b.x0, b.x1, xs);
  const sy = axis(dy, b.y0, b.y1, ys);
  return { dx: sx.value, dy: sy.value, snapped: sx.snapped || sy.snapped };
}

export const roofsOf = (project) => (Array.isArray(project?.roofs) ? project.roofs : []);
export const roofById = (project, id) => roofsOf(project).find((r) => r.id === id) || null;

// Крыша этажа, основание которой накрывает точку (последняя сверху), или null.
export function roofAtPoint(project, levelId, x, y) {
  const list = roofsOf(project).filter((r) => r.levelId === levelId);
  for (let i = list.length - 1; i >= 0; i -= 1) {
    if (pointInOutline(list[i].outline || [], x, y)) return list[i];
  }
  return null;
}

// Крыша над помещением (по точке подписи помещения) или null — связи нет,
// только геометрия.
export function roofOverRoom(project, levelId, room) {
  if (!room) return null;
  const p = roomLabelPoint(room);
  return roofAtPoint(project, levelId, p.x, p.y);
}

// ---------------------------------------------------------------- геометрия

export function roofLevel(project, roof) {
  return (project?.levels || []).find((l) => l.id === roof.levelId) || null;
}

// Отметки плиты: низ z0 = elevation + height + dz, верх z1 = z0 + thickness.
export function roofZ(project, roof) {
  const l = roofLevel(project, roof);
  if (!l) return null;
  const base = Number(l.elevation) + Number(l.height);
  const z0 = base + (roof.dz || 0);
  return { base, z0, z1: z0 + roof.thickness };
}

const box = (p, o = 0) => ({ x0: p.x - o, y0: p.y - o, x1: p.x + p.w + o, y1: p.y + p.h + o });

const ptsBox = (pts) => ({
  x0: Math.min(...pts.map((p) => p.x)), y0: Math.min(...pts.map((p) => p.y)),
  x1: Math.max(...pts.map((p) => p.x)), y1: Math.max(...pts.map((p) => p.y)),
});

// Основание без выноса: прямоугольники своего контура (косой контур — габарит).
export function roofBaseRects(_project, roof) {
  if (!Array.isArray(roof?.outline) || roof.outline.length < 3) return [];
  return isOrthoOutline(roof.outline) ? polygonRects(roof.outline).map((p) => box(p)) : [ptsBox(roof.outline)];
}

// Пятно этажа над крышей (как core/mesh3d.js levelFootprint: закрытые
// помещения с наружной стеной): там плита — перекрытие верхнего этажа,
// крыша-плита его не дублирует (нижняя крыша становится козырьком вокруг).
export function roofCutRects(project, roof) {
  const levels = [...(project?.levels || [])].sort((a, b) => a.elevation - b.elevation);
  const k = levels.findIndex((l) => l.id === roof.levelId);
  const above = k >= 0 ? levels[k + 1] : null;
  if (!above) return [];
  const t = Number(project?.settings?.exterior) || DEFAULT_EXTERIOR;
  return (above.rooms || []).filter((r) => !r.parentId && !isOpenRoom(r) && !isShaft(r))
    .flatMap((r) => roomRects(r).map((p) => box(p, t)));
}

// Прямоугольники, расширенные по сторонам: d = число или { n, e, s, w }.
export function expandRects(rects, d) {
  const o = typeof d === 'number' ? allSides(d) : { ...allSides(0), ...d };
  return rects.map((r) => ({ x0: r.x0 - o.w, y0: r.y0 - o.n, x1: r.x1 + o.e, y1: r.y1 + o.s }));
}

// Плита с выносом (косой контур — габарит многоугольника плиты).
export function roofRects(project, roof) {
  if (Array.isArray(roof?.outline) && roof.outline.length >= 3 && !isOrthoOutline(roof.outline)) {
    const poly = roofSlabOutline(project, roof);
    return poly.length >= 3 ? [ptsBox(poly)] : [];
  }
  return expandRects(roofBaseRects(project, roof), roof.overhang);
}

// Контур плиты с выносом (многоугольник): ортогональный — по сетке
// прямоугольников (сумма Минковского; несвязное — []), косой — сдвиг рёбер.
export function roofSlabOutline(project, roof) {
  const o = roof?.outline;
  if (!Array.isArray(o) || o.length < 3) return [];
  if (!isOrthoOutline(o)) return offsetOutline(tidyOutline(o), (n) => edgeOverhang(roof.overhang, n));
  const loops = chainEdges(gridEdges(rectGrid([roofRects(project, roof)])));
  return loops && loops.length === 1 ? tidyOutline(loops[0]) : [];
}

// Рёбра плиты { a, b, n } (n — нормаль наружу) для рисования и ручек выноса.
export function roofSlabEdges(project, roof) {
  const o = roof?.outline;
  if (!Array.isArray(o) || o.length < 3) return [];
  if (isOrthoOutline(o)) {
    const rects = roofRects(project, roof);
    return rects.length ? gridEdges(rectGrid([rects])) : [];
  }
  const poly = roofSlabOutline(project, roof);
  const N = outlineNormals(poly);
  return poly.map((a, i) => ({ a, b: poly[(i + 1) % poly.length], n: N[i] })).filter((e) => e.n);
}

// Косой контур (не все рёбра по осям) — 3D, фасады, площадь — многоугольником.
export const roofIsSlanted = (roof) => Array.isArray(roof?.outline) && roof.outline.length >= 3 && !isOrthoOutline(roof.outline);

export function rectsBox(rects) {
  if (!rects.length) return null;
  return {
    x0: Math.min(...rects.map((r) => r.x0)), y0: Math.min(...rects.map((r) => r.y0)),
    x1: Math.max(...rects.map((r) => r.x1)), y1: Math.max(...rects.map((r) => r.y1)),
  };
}

const snapC = (a) => Math.round(a * 10) / 10;
const uniq = (list) => [...new Set(list.map(snapC))].sort((a, b) => a - b);
const inRects = (rects, x, y) => rects.some((r) => x > r.x0 && x < r.x1 && y > r.y0 && y < r.y1);

// Область на общей сетке (как core/mesh3d.js regionGrid): клетка входит, если
// лежит во всех группах all и ни в одном прямоугольнике none.
export function rectGrid(all, none = []) {
  const rects = [...all.flat(), ...none];
  const xs = uniq(rects.flatMap((r) => [r.x0, r.x1]));
  const ys = uniq(rects.flatMap((r) => [r.y0, r.y1]));
  const nx = Math.max(0, xs.length - 1);
  const ny = Math.max(0, ys.length - 1);
  const mask = new Uint8Array(nx * ny);
  if (!all.length || all.some((g) => !g.length)) return { xs, ys, nx, ny, mask };
  for (let j = 0; j < ny; j += 1) {
    const cy = (ys[j] + ys[j + 1]) / 2;
    for (let i = 0; i < nx; i += 1) {
      if (xs[i + 1] - xs[i] < 0.5 || ys[j + 1] - ys[j] < 0.5) continue;
      const cx = (xs[i] + xs[i + 1]) / 2;
      if (all.every((g) => inRects(g, cx, cy)) && !inRects(none, cx, cy)) mask[j * nx + i] = 1;
    }
  }
  return { xs, ys, nx, ny, mask };
}

export function gridArea(grid) {
  let a = 0;
  for (let j = 0; j < grid.ny; j += 1) {
    for (let i = 0; i < grid.nx; i += 1) {
      if (grid.mask[j * grid.nx + i]) a += (grid.xs[i + 1] - grid.xs[i]) * (grid.ys[j + 1] - grid.ys[j]);
    }
  }
  return a;
}

// Рёбра контура области: слитые отрезки { a, b, n } (n — нормаль наружу,
// n.y = −1 — сторона «n», верх плана).
export function gridEdges(grid) {
  const { xs, ys, nx, ny, mask } = grid;
  const at = (i, j) => (i >= 0 && j >= 0 && i < nx && j < ny ? mask[j * nx + i] : 0);
  const out = [];
  for (let j = 0; j <= ny; j += 1) {
    let run = null;
    const flush = () => { if (run) out.push({ a: { x: xs[run.i0], y: ys[j] }, b: { x: xs[run.i1], y: ys[j] }, n: { x: 0, y: run.s } }); run = null; };
    for (let i = 0; i < nx; i += 1) {
      const s = at(i, j) && !at(i, j - 1) ? -1 : (!at(i, j) && at(i, j - 1) ? 1 : 0);
      if (s && run?.s === s) run.i1 = i + 1;
      else { flush(); if (s) run = { s, i0: i, i1: i + 1 }; }
    }
    flush();
  }
  for (let i = 0; i <= nx; i += 1) {
    let run = null;
    const flush = () => { if (run) out.push({ a: { x: xs[i], y: ys[run.j0] }, b: { x: xs[i], y: ys[run.j1] }, n: { x: run.s, y: 0 } }); run = null; };
    for (let j = 0; j < ny; j += 1) {
      const s = at(i, j) && !at(i - 1, j) ? -1 : (!at(i, j) && at(i - 1, j) ? 1 : 0);
      if (s && run?.s === s) run.j1 = j + 1;
      else { flush(); if (s) run = { s, j0: j, j1: j + 1 }; }
    }
    flush();
  }
  return out;
}

export const edgeSide = (n) => (Math.abs(n.y) >= Math.abs(n.x) ? (n.y < 0 ? 'n' : 's') : (n.x > 0 ? 'e' : 'w'));

// Дополнение области (клетки сетки вне её + рамка вокруг габарита).
function complementRects(rects, margin) {
  const g = rectGrid([rects]);
  const b = rectsBox(rects);
  if (!b) return [];
  const M = margin;
  const out = [
    { x0: b.x0 - M, y0: b.y0 - M, x1: b.x1 + M, y1: b.y0 },
    { x0: b.x0 - M, y0: b.y1, x1: b.x1 + M, y1: b.y1 + M },
    { x0: b.x0 - M, y0: b.y0, x1: b.x0, y1: b.y1 },
    { x0: b.x1, y0: b.y0, x1: b.x1 + M, y1: b.y1 },
  ];
  for (let j = 0; j < g.ny; j += 1) {
    for (let i = 0; i < g.nx; i += 1) {
      if (!g.mask[j * g.nx + i]) out.push({ x0: g.xs[i], y0: g.ys[j], x1: g.xs[i + 1], y1: g.ys[j + 1] });
    }
  }
  return out;
}

// Дополнение, «вдавленное» в область на d по сторонам — то, что эрозия
// снимает: клетки области вне него = область, сжатая на d (рёбра стороны n
// сдвигаются вниз на d.n и т.д.).
function shrinkCover(comp, d) {
  return comp.map((c) => ({ x0: c.x0 - d.e, x1: c.x1 + d.w, y0: c.y0 - d.s, y1: c.y1 + d.n }));
}

// Кольцо между эрозиями области на outer и inner (inner ≥ outer по сторонам)
// → { all, none } для rectGrid / regionGrid. Сторона с 0 — без кольца.
export function ringSpec(rects, outer, inner) {
  const o = { ...allSides(0), ...outer };
  const i = { ...allSides(0), ...inner };
  const comp = complementRects(rects, 4 * Math.max(1000, ...Object.values(i)));
  return { all: [rects, shrinkCover(comp, i)], none: shrinkCover(comp, o) };
}

// Стороны парапета → расстояния (выключенная — 0).
export function sideDist(sides, d) {
  return Object.fromEntries(ROOF_SIDES.map((s) => [s, sides?.[s] === false ? 0 : d]));
}

// ---------------------------------------------------------------- ручки и привязки

// Точки выноса: середины самых длинных рёбер сторон и крайние углы
// → [{ id: 'n'|'e'|'s'|'w'|'nw'|'ne'|'se'|'sw', x, y, sides }].
export function roofHandles(project, roof) {
  const edges = roofSlabEdges(project, roof);
  if (!edges.length) return [];
  const out = [];
  for (const s of ROOF_SIDES) {
    // Ребро, смотрящее в сторону s сильнее всех (длина × косинус²; у косых —
    // и ромб получает все четыре точки).
    const dir = { n: { x: 0, y: -1 }, e: { x: 1, y: 0 }, s: { x: 0, y: 1 }, w: { x: -1, y: 0 } }[s];
    let best = null; let len = 0;
    for (const e of edges) {
      const c = e.n.x * dir.x + e.n.y * dir.y;
      if (c < 0.5) continue;
      const l = Math.hypot(e.b.x - e.a.x, e.b.y - e.a.y) * c * c;
      if (l > len + 1e-6) { len = l; best = e; }
    }
    if (best) out.push({ id: s, x: (best.a.x + best.b.x) / 2, y: (best.a.y + best.b.y) / 2, sides: [s] });
  }
  const pts = edges.flatMap((e) => [e.a, e.b]);
  const corner = (id, f) => {
    const p = pts.reduce((m, q) => (f(q) > f(m) ? q : m), pts[0]);
    out.push({ id, x: p.x, y: p.y, sides: [id[0], id[1]] });
  };
  corner('nw', (p) => -p.x - p.y);
  corner('ne', (p) => p.x - p.y);
  corner('se', (p) => p.x + p.y);
  corner('sw', (p) => -p.x + p.y);
  return out;
}

// Знак стороны: на сколько растёт вынос при сдвиге по оси (x для e/w, y для n/s).
export const SIDE_SIGN = { n: -1, e: 1, s: 1, w: -1 };
export const sideAxis = (s) => (s === 'e' || s === 'w' ? 'x' : 'y');

// Привязка выноса: к 0/600/1000/1500 мм и к линиям (грани других крыш,
// масс, оси) в пределах tol, иначе шаг. base — координата грани основания
// этой стороны. → { value, label }.
export function snapOverhang(raw, { side = 'n', base = null, lines = [], tol = 0, step = 0 } = {}) {
  if (tol > 0) {
    let best = null; let d = tol;
    for (const v of OVERHANG_SNAPS) {
      const dd = Math.abs(v - raw);
      if (dd <= d) { d = dd; best = { value: v, label: `${v} мм` }; }
    }
    if (base != null) {
      for (const c of lines || []) {
        const v = (c - base) * SIDE_SIGN[side];
        const dd = Math.abs(v - raw);
        if (v >= 0 && v <= OVERHANG_MAX && dd < d) { d = dd; best = { value: Math.round(v), label: 'по грани' }; }
      }
    }
    if (best) return best;
  }
  const v = step > 0 ? Math.round(raw / step) * step : Math.round(raw);
  return { value: clampOverhang(v), label: null };
}

// Вынос после сдвига ручки на (dx, dy) от начала жеста.
export function dragOverhang(roof, handleSides, dx, dy, snap = null) {
  const overhang = { ...roof.overhang };
  const labels = [];
  for (const s of handleSides) {
    const delta = (sideAxis(s) === 'x' ? dx : dy) * SIDE_SIGN[s];
    const raw = roof.overhang[s] + delta;
    const r = snap ? snap(s, raw) : { value: clampOverhang(raw), label: null };
    overhang[s] = clampOverhang(r.value);
    if (r.label) labels.push(r.label);
  }
  return { roof: { ...roof, overhang }, labels };
}

// Координата грани основания по стороне.
export function baseEdge(project, roof, side) {
  const b = rectsBox(roofBaseRects(project, roof));
  if (!b) return null;
  return { n: b.y0, e: b.x1, s: b.y1, w: b.x0 }[side];
}

// Линии привязки: грани других крыш, масс (massBox), оси; geometry — ещё
// вершины контуров других крыш и грани помещений всех этажей (внутренние и
// наружные с толщиной стены) — только привязка, не связь.
export function roofSnapLines(project, skipId = null, massBoxFn = null, { geometry = false } = {}) {
  const xs = []; const ys = [];
  for (const r of roofsOf(project)) {
    if (r.id === skipId) continue;
    const b = rectsBox(roofRects(project, r));
    if (b) { xs.push(b.x0, b.x1); ys.push(b.y0, b.y1); }
    if (geometry) for (const p of r.outline || []) { xs.push(p.x); ys.push(p.y); }
  }
  if (geometry) {
    const t = Number(project?.settings?.exterior) || DEFAULT_EXTERIOR;
    for (const l of project?.levels || []) {
      for (const room of l.rooms || []) {
        if (isShaft(room)) continue;
        for (const q of roomRects(room)) {
          xs.push(q.x, q.x + q.w); ys.push(q.y, q.y + q.h);
          if (!isOpenRoom(room)) { xs.push(q.x - t, q.x + q.w + t); ys.push(q.y - t, q.y + q.h + t); }
        }
      }
    }
  }
  if (massBoxFn) {
    for (const m of project?.masses || []) {
      const b = massBoxFn(m);
      xs.push(b.x0, b.x1); ys.push(b.y0, b.y1);
    }
  }
  for (const g of project?.grids || []) {
    if (!Number.isFinite(g?.at)) continue;
    if (g.kind === 'x') xs.push(g.at); else if (g.kind === 'y') ys.push(g.at);
  }
  return { xs, ys };
}

// Высота плиты: dz с шагом и привязкой низа плиты к отметкам этажей
// (пол и верх каждого этажа). → { value, label }.
export function snapRoofDz(project, roof, rawDz, { tol = 0, step = 50 } = {}) {
  const z = roofZ(project, roof);
  if (!z) return { value: Math.round(rawDz), label: null };
  if (tol > 0) {
    let best = null; let d = tol;
    for (const l of project.levels || []) {
      for (const [mark, name] of [[l.elevation, `пол «${l.name}»`], [l.elevation + l.height, `верх «${l.name}»`]]) {
        const v = mark - z.base;
        const dd = Math.abs(v - rawDz);
        if (dd <= d) { d = dd; best = { value: Math.round(v), label: name }; }
      }
    }
    if (best) return { value: clamp(best.value, -DZ_LIMIT, DZ_LIMIT), label: best.label };
  }
  const v = step > 0 ? Math.round(rawDz / step) * step : Math.round(rawDz);
  return { value: clamp(v, -DZ_LIMIT, DZ_LIMIT), label: null };
}

// Прямоугольники всех явных крыш этажа (с выносом) — автокровля над ними не строится.
export function explicitRoofRects(project, levelId) {
  return roofsOf(project).filter((r) => r.levelId === levelId).flatMap((r) => roofRects(project, r));
}

// Подпись выноса: «вынос 1200» или «вынос 600–1200».
export function overhangLabel(roof) {
  const v = ROOF_SIDES.map((s) => roof.overhang[s]);
  const lo = Math.min(...v); const hi = Math.max(...v);
  return lo === hi ? `вынос ${lo}` : `вынос ${lo}–${hi}`;
}

// Сводка для «Свойств»: площадь плиты (м²), габарит, отметки.
export function roofStats(project, roof) {
  const rects = roofRects(project, roof);
  const area = roofIsSlanted(roof) ? outlineArea(roofSlabOutline(project, roof)) / 1e6
    : (rects.length ? gridArea(rectGrid([rects])) / 1e6 : 0);
  const b = rectsBox(rects);
  const z = roofZ(project, roof);
  return { area, box: b, z0: z?.z0 ?? 0, z1: z?.z1 ?? 0 };
}

// ---------------------------------------------------------------- слияние крыш

export const MERGE_TOL = 5; // зазор между контурами, который считается касанием, мм

// Ближайшая точка отрезка ab к p.
function nearestOnSeg(p, a, b) {
  const vx = b.x - a.x; const vy = b.y - a.y;
  const L2 = vx * vx + vy * vy;
  const t = L2 > 0 ? clamp(((p.x - a.x) * vx + (p.y - a.y) * vy) / L2, 0, 1) : 0;
  return { x: a.x + vx * t, y: a.y + vy * t };
}

// Вершины контура pts, лежащие в пределах tol от другого контура, — на него
// (сначала на вершину, иначе на ребро): зазор в 1–5 мм закрывается.
function snapOutlineTo(pts, other, tol) {
  if (!(tol > 0)) return pts;
  return pts.map((p) => {
    let best = null; let bd = tol + 1e-9;
    for (const q of other) {
      const d = Math.hypot(q.x - p.x, q.y - p.y);
      if (d <= bd) { bd = d; best = q; }
    }
    if (best) return { x: best.x, y: best.y };
    for (let i = 0; i < other.length; i += 1) {
      const q = nearestOnSeg(p, other[i], other[(i + 1) % other.length]);
      const d = Math.hypot(q.x - p.x, q.y - p.y);
      if (d <= bd) { bd = d; best = q; }
    }
    return best ? { x: best.x, y: best.y } : p;
  });
}

const boxesNear = (a, b, tol) => a.x0 <= b.x1 + tol && b.x0 <= a.x1 + tol && a.y0 <= b.y1 + tol && b.y0 <= a.y1 + tol;

// Объединение двух контуров (перекрытие или касание по отрезку, зазор ≤ tol)
// → { outline, filled } или null: части не связаны (касание в точке, зазор),
// итог негоден. Дыра в объединении (кольцо, двор) заливается — filled: true.
export function unionOutlines(a, b, { tol = MERGE_TOL } = {}) {
  if (!validOutline(a) || !validOutline(b)) return null;
  if (!boxesNear(ptsBox(a), ptsBox(b), tol)) return null;
  const A = snapOutlineTo(a, b, tol);
  const B = snapOutlineTo(b, A, tol);
  const res = clipUnion([A], [B]);
  if (res.length !== 1 || !res[0][0]) return null;
  const outline = tidyOutline(res[0][0]);
  if (!validOutline(outline)) return null;
  // Объединение не меньше большей части (защита от вырожденного итога).
  if (outlineArea(outline) + 1 < Math.max(outlineArea(a), outlineArea(b))) return null;
  return { outline, filled: res[0].length > 1 };
}

// Крыши можно слить: один этаж, одинаковая отметка верха плиты (dz + толщина),
// у обеих не выключено autoMerge (force — ручное «Соединить», флаги не важны).
export function roofsMergeable(a, b, { force = false } = {}) {
  if (!a || !b || a.id === b.id || a.levelId !== b.levelId) return false;
  if (Math.abs((a.dz || 0) + a.thickness - (b.dz || 0) - b.thickness) > 0.5) return false;
  return force || (a.autoMerge !== false && b.autoMerge !== false);
}

// Крыша id (активная — созданная или изменённая последней) поглощает все
// касающиеся/перекрывающиеся крыши своего этажа и высоты (по цепочке).
// Свойства — от активной (id тоже), имя — самой ранней из слитых.
// → { list, roof, merged: [id поглощённых], filled } или null (сливать нечего).
export function mergeTouchingRoofs(list, id, { tol = MERGE_TOL, force = false } = {}) {
  const all = Array.isArray(list) ? list : [];
  const act = all.find((r) => r.id === id);
  if (!act || (!force && act.autoMerge === false)) return null;
  let outline = act.outline;
  let filled = false;
  const merged = new Set();
  let grew = true;
  while (grew) {
    grew = false;
    for (const r of all) {
      if (merged.has(r.id) || !roofsMergeable(act, r, { force })) continue;
      const u = unionOutlines(outline, r.outline, { tol });
      if (!u) continue;
      outline = u.outline;
      filled = filled || u.filled;
      merged.add(r.id);
      grew = true;
    }
  }
  if (!merged.size) return null;
  const first = all.find((r) => r.id === id || merged.has(r.id));
  const roof = { ...act, outline, name: first?.name || act.name };
  const out = all.filter((r) => !merged.has(r.id)).map((r) => (r.id === id ? roof : r));
  return { list: out, roof, merged: [...merged], filled };
}
