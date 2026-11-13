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
//             ортогональный многоугольник (прямоугольник, Г, П…), с
//             помещениями не связан — двигается и правится сам (план крыши,
//             ui/roof-plan.js). Старые крыши над помещениями (roomIds) при
//             открытии получают контур по помещениям (normalizeRoofs);
//   overhang { n, e, s, w } — вынос от контура по сторонам в осях дома (n — к
//             меньшим y, «верх» плана; e — к большим x), 0…3000 мм; на
//             Г-образном основании каждое ребро сдвигается по своей нормали
//             (сумма Минковского прямоугольников с коробкой выноса);
//   thickness — толщина плиты 150…600 (300);
//   edge { type: plain|fascia|cornice|drip, height 150…600 (250), color? };
//   parapet { type: none|wall|glass|rail|stepped, height, thickness, inset,
//             sides { n, e, s, w }: bool };
//   material: graphite|white|wood|concrete|metal; drain: bool (маркер).
// }
// Геометрия — на общей сетке прямоугольников (как перекрытия в
// core/mesh3d.js regionGrid): плита, кольцо фасции снаружи, кольцо
// парапета внутри (эрозия по включённым сторонам).

import { DEFAULT_EXTERIOR, isOpenRoom, isShaft } from './catalog.js';
import {
  applyRoomShapeHandle, polygonRects, roomLabelPoint, roomRects, roomShapeHandles,
} from './room-shape.js';

export const ROOF_SIDES = ['n', 'e', 's', 'w'];
export const SIDE_TITLES = { n: 'верх', e: 'право', s: 'низ', w: 'лево' };

export const OVERHANG_DEFAULT = 600;
export const OVERHANG_MAX = 3000;
export const OVERHANG_SNAPS = [0, 600, 1000, 1500];
export const ROOF_THICK = { def: 300, min: 150, max: 600 };
export const EDGE_HEIGHT = { def: 250, min: 150, max: 600 };
export const PARAPET_HEIGHT = { def: 600, min: 100, max: 2000 };
export const PARAPET_THICK = { def: 200, min: 20, max: 600 };
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
const collinear = (a, b, c) => (Math.abs(a.x - b.x) < 0.5 && Math.abs(b.x - c.x) < 0.5)
  || (Math.abs(a.y - b.y) < 0.5 && Math.abs(b.y - c.y) < 0.5);

function cleanOutline(list) {
  if (!Array.isArray(list)) return null;
  const pts = list.filter((p) => isObj(p) && Number.isFinite(Number(p.x)) && Number.isFinite(Number(p.y)))
    .map((p) => ({ x: Math.round(Number(p.x)), y: Math.round(Number(p.y)) }));
  return pts.length >= 3 ? pts : null;
}

// Контур без повторов и без точек посреди прямой (в т. ч. «шипов» назад).
export function tidyOutline(points) {
  const pts = (points || []).map((p) => ({ x: Math.round(p.x), y: Math.round(p.y) }));
  let changed = true;
  while (changed && pts.length >= 3) {
    changed = false;
    for (let i = 0; i < pts.length; i += 1) {
      const a = pts[(i - 1 + pts.length) % pts.length];
      const b = pts[i];
      const c = pts[(i + 1) % pts.length];
      if (samePt(a, b) || collinear(a, b, c)) { pts.splice(i, 1); changed = true; break; }
    }
  }
  return pts;
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

// Годный контур крыши: ≥ 4 вершин, рёбра по осям, без самопересечений,
// площадь не меньше 0,01 м².
export function validOutline(points) {
  if (!Array.isArray(points) || points.length < 4) return false;
  const n = points.length;
  for (let i = 0; i < n; i += 1) {
    const a = points[i]; const b = points[(i + 1) % n];
    if (Math.abs(a.x - b.x) > 0.5 && Math.abs(a.y - b.y) > 0.5) return false;
    if (samePt(a, b)) return false;
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
    material: MATERIAL_IDS.has(raw.material) ? raw.material : 'graphite',
    drain: Boolean(raw.drain),
  };
  delete out.roomIds;
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

// Новая крыша по контуру: вынос 600, фасция 250, графит.
export function createRoof({ levelId, outline, ...patch } = {}, existing = []) {
  return normalizeRoof({
    id: roofId(), name: nextRoofName(existing), levelId, outline, dz: 0,
    overhang: allSides(OVERHANG_DEFAULT), thickness: ROOF_THICK.def,
    edge: { type: 'fascia', height: EDGE_HEIGHT.def },
    parapet: { type: 'none', height: PARAPET_HEIGHT.def, thickness: PARAPET_THICK.def, inset: 0, sides: allSides(true) },
    material: 'graphite', drain: false,
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
export function roofOutlineHandles(roof) {
  if (!Array.isArray(roof?.outline) || roof.outline.length < 4) return [];
  return roomShapeHandles({ x: 0, y: 0, w: 0, h: 0, outline: roof.outline });
}

// Ручка контура в точку (ребро — сдвиг по нормали, вершина — два ребра).
// → новая крыша или null (контур вышел негодным: самопересечение, вырождение).
export function applyRoofOutlineHandle(roof, handle, point, { mergeTolerance = 0 } = {}) {
  const room = { x: 0, y: 0, outline: roof.outline.map((p) => ({ x: p.x, y: p.y })) };
  applyRoomShapeHandle(room, { ...handle, outline: true }, point, { mergeTolerance });
  const t = tidyOutline(room.outline);
  return validOutline(t) ? { ...roof, outline: t } : null;
}

// Деление ребра в точке: две совпадающие вершины (потянуть половину ребра —
// получится уступ, Г-форма). → крыша или null (точка у конца ребра).
export function insertRoofVertex(roof, edgeIndex, point, minGap = 100) {
  const pts = roof.outline.map((p) => ({ x: p.x, y: p.y }));
  const n = pts.length;
  const a = pts[edgeIndex]; const b = pts[(edgeIndex + 1) % n];
  if (!a || !b) return null;
  const horiz = Math.abs(a.y - b.y) < 0.5;
  const lo = horiz ? Math.min(a.x, b.x) : Math.min(a.y, b.y);
  const hi = horiz ? Math.max(a.x, b.x) : Math.max(a.y, b.y);
  const v = Math.round(horiz ? point.x : point.y);
  if (v < lo + minGap || v > hi - minGap) return null;
  const p = horiz ? { x: v, y: a.y } : { x: a.x, y: v };
  pts.splice(edgeIndex + 1, 0, { ...p }, { ...p });
  return { ...roof, outline: pts };
}

// Удалить вершину: угол срезается до соседей (вогнутый — уступ заполняется).
// → крыша или null (прямоугольник, негодный результат).
export function removeRoofVertex(roof, index) {
  const at = roof.outline[index];
  if (!at) return null;
  const pts = tidyOutline(roof.outline);
  index = pts.findIndex((p) => samePt(p, at));
  // Вершина деления ребра (на прямой) — просто убрать деление.
  if (index < 0) return validOutline(pts) && pts.length < roof.outline.length ? { ...roof, outline: pts } : null;
  const n = pts.length;
  if (n <= 4) return null;
  const a = pts[(index - 1 + n) % n]; const b = pts[index]; const c = pts[(index + 1) % n];
  pts[index] = Math.abs(a.y - b.y) < 0.5 ? { x: a.x, y: c.y } : { x: c.x, y: a.y };
  const t = tidyOutline(pts);
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
    if (roofBaseRects(project, list[i]).some((b) => x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1)) return list[i];
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

// Основание без выноса: прямоугольники своего контура.
export function roofBaseRects(_project, roof) {
  return Array.isArray(roof?.outline) && roof.outline.length >= 3 ? polygonRects(roof.outline).map((p) => box(p)) : [];
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

// Плита с выносом.
export function roofRects(project, roof) {
  return expandRects(roofBaseRects(project, roof), roof.overhang);
}

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

export const edgeSide = (n) => (n.y < 0 ? 'n' : n.y > 0 ? 's' : n.x > 0 ? 'e' : 'w');

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
  const rects = roofRects(project, roof);
  if (!rects.length) return [];
  const edges = gridEdges(rectGrid([rects]));
  const out = [];
  for (const s of ROOF_SIDES) {
    let best = null; let len = -1;
    for (const e of edges) {
      if (edgeSide(e.n) !== s) continue;
      const l = Math.hypot(e.b.x - e.a.x, e.b.y - e.a.y);
      if (l > len) { len = l; best = e; }
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
  const area = rects.length ? gridArea(rectGrid([rects])) / 1e6 : 0;
  const b = rectsBox(rects);
  const z = roofZ(project, roof);
  return { area, box: b, z0: z?.z0 ?? 0, z1: z?.z1 ?? 0 };
}
