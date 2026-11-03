// Рельеф участка по отметкам топосъёмки. Чистый модуль без DOM.
//
// site.terrain = {
//   points: [{ id, x, y, z }],   // x, y — координаты съёмки (мм, ось Y вниз),
//                                // z — абсолютная отметка, мм (123.45 м = 123450)
//   contourStep: 500,            // шаг горизонталей, мм
//   floorZ: null,                // отметка пола 1 этажа (мм); null — средняя под домом
//   show: { points, contours, labels, shade },
// }
//
// Расчёт: триангуляция Делоне (Bowyer–Watson), линейная интерполяция по
// треугольнику, горизонтали (marching triangles) со склейкой в полилинии,
// уклон, отметки под домом.

import { toWorld } from './building.js';
import { convexHull, nearestPointOnPolyline } from './site.js';

export const DEFAULT_CONTOUR_STEP = 500;
export const MAX_TERRAIN_POINTS = 5000;
export const HOUSE_DROP_WARN = 1000; // перепад под домом, после которого — предупреждение, мм
const DUP_TOL = 1; // точки ближе 1 мм — дубликаты

export function createTerrain() {
  return {
    points: [],
    contourStep: DEFAULT_CONTOUR_STEP,
    floorZ: null,
    show: { points: true, contours: true, labels: true, shade: false },
  };
}

const num = (v) => (typeof v === 'number' ? v : (typeof v === 'string' && v.trim() ? Number(v.replace(',', '.')) : NaN));

// Нормализация при загрузке: битые точки отбрасываются, недопустимые
// настройки заменяются умолчаниями. Нет поля — null (плоская земля).
export function normalizeTerrain(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const d = createTerrain();
  const points = [];
  const ids = new Set();
  for (const p of Array.isArray(raw.points) ? raw.points : []) {
    const x = num(p?.x); const y = num(p?.y); const z = num(p?.z);
    if (![x, y, z].every(Number.isFinite)) continue;
    if (Math.abs(x) > 1e10 || Math.abs(y) > 1e10 || Math.abs(z) > 1e8) continue;
    let id = typeof p.id === 'string' && p.id ? p.id : `tp-${points.length}`;
    while (ids.has(id)) id = `${id}-${points.length}`;
    ids.add(id);
    points.push({ id, x, y, z });
    if (points.length >= MAX_TERRAIN_POINTS) break;
  }
  const step = num(raw.contourStep);
  const floorZ = num(raw.floorZ);
  const show = raw.show && typeof raw.show === 'object' ? raw.show : {};
  return {
    points,
    contourStep: Number.isFinite(step) && step >= 50 && step <= 50000 ? step : d.contourStep,
    floorZ: raw.floorZ != null && Number.isFinite(floorZ) ? floorZ : null,
    show: Object.fromEntries(Object.entries(d.show).map(([k, def]) => [k, typeof show[k] === 'boolean' ? show[k] : def])),
  };
}

// ---------------------------------------------------------------- Триангуляция

// Убирает дубликаты (ближе DUP_TOL): остаётся первая точка.
export function dedupePoints(points) {
  const out = [];
  const grid = new Map();
  const key = (x, y) => `${Math.floor(x / DUP_TOL)},${Math.floor(y / DUP_TOL)}`;
  let duplicates = 0;
  for (const p of points) {
    if (![p?.x, p?.y, p?.z].every(Number.isFinite)) continue;
    const cx = Math.floor(p.x / DUP_TOL);
    const cy = Math.floor(p.y / DUP_TOL);
    let dup = false;
    for (let i = -1; i <= 1 && !dup; i += 1) {
      for (let j = -1; j <= 1 && !dup; j += 1) {
        for (const q of grid.get(`${cx + i},${cy + j}`) || []) {
          if (Math.hypot(q.x - p.x, q.y - p.y) < DUP_TOL) { dup = true; break; }
        }
      }
    }
    if (dup) { duplicates += 1; continue; }
    const k = key(p.x, p.y);
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(p);
    out.push(p);
  }
  return { points: out, duplicates };
}

function circum(a, b, c) {
  const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
  if (Math.abs(d) < 1e-12) return null;
  const a2 = a.x * a.x + a.y * a.y;
  const b2 = b.x * b.x + b.y * b.y;
  const c2 = c.x * c.x + c.y * c.y;
  const x = (a2 * (b.y - c.y) + b2 * (c.y - a.y) + c2 * (a.y - b.y)) / d;
  const y = (a2 * (c.x - b.x) + b2 * (a.x - c.x) + c2 * (b.x - a.x)) / d;
  return { x, y, r2: (a.x - x) ** 2 + (a.y - y) ** 2 };
}

// Триангуляция Делоне. points — [{x,y,z}]. Возвращает
// { pts, tris: [[i,j,k]], hull: [{x,y}], duplicates, error }.
// error — понятное сообщение для вырожденных случаев (tris тогда пуст).
export function triangulate(points) {
  const { points: pts, duplicates } = dedupePoints(points || []);
  const base = { pts, tris: [], hull: [], duplicates, error: null };
  if (pts.length < 3) {
    return { ...base, error: pts.length ? `Отметок ${pts.length} — для рельефа нужно минимум 3` : 'Отметок высот нет' };
  }
  // Нормализуем координаты (центр и масштаб) — для численной устойчивости.
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
  }
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const span = Math.max(maxX - minX, maxY - minY) || 1;
  const P = pts.map((p) => ({ x: (p.x - cx) / span, y: (p.y - cy) / span }));
  const hullN = convexHull(P);
  let hullArea = 0;
  for (let i = 0; i < hullN.length; i += 1) {
    const a = hullN[i]; const b = hullN[(i + 1) % hullN.length];
    hullArea += a.x * b.y - b.x * a.y;
  }
  if (hullN.length < 3 || Math.abs(hullArea / 2) < 1e-9) {
    return { ...base, error: 'Все отметки лежат на одной прямой — поверхность не построить' };
  }
  // Супер-треугольник.
  const M = 1000;
  const n = P.length;
  P.push({ x: -M, y: -M }, { x: M * 2, y: -M }, { x: -M, y: M * 2 });
  const make = (i, j, k) => {
    // Ориентация — против часовой в математических осях (для единообразия).
    const a = P[i]; const b = P[j]; const c = P[k];
    const cr = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    const t = cr < 0 ? [i, k, j] : [i, j, k];
    return { v: t, c: circum(P[t[0]], P[t[1]], P[t[2]]) };
  };
  let tris = [make(n, n + 1, n + 2)];
  // Вставка в случайном (но детерминированном) порядке — меньше вырождений
  // на регулярных сетках.
  const order = Array.from({ length: n }, (_, i) => i);
  let seed = 12345;
  for (let i = n - 1; i > 0; i -= 1) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    const j = seed % (i + 1);
    [order[i], order[j]] = [order[j], order[i]];
  }
  for (const pi of order) {
    const p = P[pi];
    const bad = [];
    const keep = [];
    for (const t of tris) {
      const c = t.c;
      if (c && (p.x - c.x) ** 2 + (p.y - c.y) ** 2 < c.r2 * (1 + 1e-12)) bad.push(t); else keep.push(t);
    }
    // Граница полости: рёбра, встречающиеся в «плохих» треугольниках один раз.
    const edges = new Map();
    for (const t of bad) {
      for (let e = 0; e < 3; e += 1) {
        const a = t.v[e]; const b = t.v[(e + 1) % 3];
        const k = a < b ? `${a}_${b}` : `${b}_${a}`;
        if (edges.has(k)) edges.set(k, null); else edges.set(k, [a, b]);
      }
    }
    tris = keep;
    for (const e of edges.values()) {
      if (e) tris.push(make(e[0], e[1], pi));
    }
  }
  const out = [];
  for (const t of tris) {
    if (t.v.some((i) => i >= n)) continue;
    const [a, b, c] = t.v.map((i) => P[i]);
    const area = Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)) / 2;
    if (area < 1e-14) continue; // вырожденные «щепки» на прямых участках оболочки
    out.push(t.v);
  }
  fillHullPockets(P, n, out);
  const hull = convexHull(pts.map((p) => ({ x: p.x, y: p.y })));
  return { ...base, tris: out, hull };
}

// Конечный супер-треугольник иногда «съедает» треугольники у выпуклой
// оболочки (ребро оболочки не попадает в триангуляцию). Достраиваем: пока
// граница триангуляции где-то вогнута (правый поворот при обходе против
// часовой), закрываем «карман» треугольником без точек внутри.
function fillHullPockets(P, n, tris) {
  const cross = (o, a, b) => (P[a].x - P[o].x) * (P[b].y - P[o].y) - (P[a].y - P[o].y) * (P[b].x - P[o].x);
  const inside = (a, b, c, p) => {
    const d1 = cross(a, b, p); const d2 = cross(b, c, p); const d3 = cross(c, a, p);
    return d1 > 1e-14 && d2 > 1e-14 && d3 > 1e-14;
  };
  for (let iter = 0; iter < n * 2; iter += 1) {
    const edges = new Set();
    for (const t of tris) for (let e = 0; e < 3; e += 1) edges.add(`${t[e]}_${t[(e + 1) % 3]}`);
    const next = new Map();
    for (const t of tris) {
      for (let e = 0; e < 3; e += 1) {
        const a = t[e]; const b = t[(e + 1) % 3];
        if (!edges.has(`${b}_${a}`)) next.set(a, b); // граничное ребро a→b (внутри — слева)
      }
    }
    let added = false;
    for (const [a, b] of next) {
      const c = next.get(b);
      if (c == null || c === a) continue;
      if (cross(a, b, c) >= -1e-14) continue; // не вогнуто
      // Треугольник a, c, b (против часовой) должен быть пуст.
      let empty = true;
      for (let i = 0; i < n && empty; i += 1) {
        if (i !== a && i !== b && i !== c && inside(a, c, b, i)) empty = false;
      }
      if (!empty) continue;
      tris.push([a, c, b]);
      added = true;
      break;
    }
    if (!added) break;
  }
}

// ---------------------------------------------------------------- Модель (кэш)

// Модель рельефа: триангуляция + вспомогательные индексы. Кэш по содержимому
// точек: для отрисовки каждый кадр пересчёт не нужен.
let cache = { sig: null, model: null };

export function terrainModel(terrain) {
  const points = terrain?.points || [];
  let sig = String(points.length);
  for (const p of points) sig += `|${p.x},${p.y},${p.z}`;
  if (cache.sig === sig) return cache.model;
  const t = triangulate(points);
  const model = { ...t, triBoxes: [], minZ: null, maxZ: null, contoursByStep: new Map() };
  for (const tri of t.tris) {
    const [a, b, c] = tri.map((i) => t.pts[i]);
    model.triBoxes.push({
      minX: Math.min(a.x, b.x, c.x), maxX: Math.max(a.x, b.x, c.x),
      minY: Math.min(a.y, b.y, c.y), maxY: Math.max(a.y, b.y, c.y),
    });
  }
  for (const p of t.pts) {
    if (model.minZ == null || p.z < model.minZ) model.minZ = p.z;
    if (model.maxZ == null || p.z > model.maxZ) model.maxZ = p.z;
  }
  cache = { sig, model };
  return model;
}

// Треугольник, содержащий точку: { index, w: [wa, wb, wc] } или null.
function locate(model, x, y) {
  const eps = 1e-9;
  for (let i = 0; i < model.tris.length; i += 1) {
    const bx = model.triBoxes[i];
    if (x < bx.minX - 1e-6 || x > bx.maxX + 1e-6 || y < bx.minY - 1e-6 || y > bx.maxY + 1e-6) continue;
    const [a, b, c] = model.tris[i].map((k) => model.pts[k]);
    const d = (b.y - c.y) * (a.x - c.x) + (c.x - b.x) * (a.y - c.y);
    if (Math.abs(d) < 1e-12) continue;
    const wa = ((b.y - c.y) * (x - c.x) + (c.x - b.x) * (y - c.y)) / d;
    const wb = ((c.y - a.y) * (x - c.x) + (a.x - c.x) * (y - c.y)) / d;
    const wc = 1 - wa - wb;
    if (wa >= -eps && wb >= -eps && wc >= -eps) return { index: i, w: [wa, wb, wc] };
  }
  return null;
}

// Отметка в точке (мм). Внутри выпуклой оболочки — по треугольнику
// (барицентрически). Вне её: clamp=false — null, clamp=true — по ближайшей
// точке оболочки (линейно вдоль её ребра).
export function interpolateZ(model, x, y, { clamp = false } = {}) {
  if (!model?.tris?.length) return null;
  const hit = locate(model, x, y);
  if (hit) {
    const [a, b, c] = model.tris[hit.index].map((k) => model.pts[k]);
    return a.z * hit.w[0] + b.z * hit.w[1] + c.z * hit.w[2];
  }
  if (!clamp) return null;
  return zAtHullEdge(model, x, y);
}

function zAtHullEdge(model, x, y) {
  const near = nearestPointOnPolyline(model.hull, { x, y }, true);
  if (!near) return null;
  const hit = locate(model, near.x, near.y);
  if (hit) {
    const [a, b, c] = model.tris[hit.index].map((k) => model.pts[k]);
    return a.z * hit.w[0] + b.z * hit.w[1] + c.z * hit.w[2];
  }
  // Запас: ближайшая вершина.
  let best = null;
  for (const p of model.pts) {
    const d = Math.hypot(p.x - x, p.y - y);
    if (!best || d < best.d) best = { d, z: p.z };
  }
  return best ? best.z : null;
}

// Уклон в точке: плоскость треугольника z = ax + by + c.
// Возвращает { slope (доля), percent, downDeg } или null. downDeg — направление
// вниз по склону в координатах съёмки: градусы от оси X по часовой (ось Y вниз).
export function slopeAt(model, x, y) {
  if (!model?.tris?.length) return null;
  const hit = locate(model, x, y);
  if (!hit) return null;
  return trianglePlaneSlope(model.tris[hit.index].map((k) => model.pts[k]));
}

export function trianglePlaneSlope([p, q, r]) {
  const ux = q.x - p.x; const uy = q.y - p.y; const uz = q.z - p.z;
  const vx = r.x - p.x; const vy = r.y - p.y; const vz = r.z - p.z;
  const nz = ux * vy - uy * vx;
  if (Math.abs(nz) < 1e-12) return null;
  const nx = uy * vz - uz * vy;
  const ny = uz * vx - ux * vz;
  const a = -nx / nz; // dz/dx
  const b = -ny / nz; // dz/dy
  const slope = Math.hypot(a, b);
  return { slope, percent: slope * 100, downDeg: slope > 1e-9 ? (Math.atan2(-b, -a) * 180) / Math.PI : null, a, b };
}

// Направление (градусы на плане, от оси X по часовой) → румб с учётом севера.
export function compassName(planDeg, north = 0) {
  if (planDeg == null) return '';
  const bearing = (((planDeg + 90 - north) % 360) + 360) % 360;
  return ['С', 'СВ', 'В', 'ЮВ', 'Ю', 'ЮЗ', 'З', 'СЗ'][Math.round(bearing / 45) % 8];
}

// ---------------------------------------------------------------- Горизонтали

// Горизонтали с шагом step (мм): [{ z, major, lines: [{ pts:[{x,y}], closed }] }].
// Каждая 5-я (кратная 5·step) — утолщённая (major).
export function contours(model, step = DEFAULT_CONTOUR_STEP) {
  if (!model?.tris?.length || !(step > 0)) return [];
  const cached = model.contoursByStep?.get(step);
  if (cached) return cached;
  const out = [];
  const first = Math.ceil(model.minZ / step);
  let last = Math.floor(model.maxZ / step);
  if (last * step === model.maxZ) last -= 1; // вершина ровно на уровне — горизонталь вырождается в точку
  if (last - first > 2000) return []; // слишком мелкий шаг для такого перепада
  for (let k = first; k <= last; k += 1) {
    const level = k * step;
    const lines = contourLevel(model, level);
    if (lines.length) out.push({ z: level, major: k % 5 === 0, lines });
  }
  model.contoursByStep?.set(step, out);
  return out;
}

function contourLevel(model, level) {
  // Вершина ровно на уровне смещается чуть вверх — нет вырожденных случаев.
  const zOf = (i) => { const z = model.pts[i].z; return z === level ? z + 1e-7 : z; };
  const segs = []; // [{a: edgeKey, b: edgeKey, pa, pb}]
  const edgePoint = (i, j) => {
    const p = model.pts[i]; const q = model.pts[j];
    const zi = zOf(i); const zj = zOf(j);
    const t = (level - zi) / (zj - zi);
    return { x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t };
  };
  const key = (i, j) => (i < j ? `${i}_${j}` : `${j}_${i}`);
  for (const tri of model.tris) {
    const cut = [];
    for (let e = 0; e < 3; e += 1) {
      const i = tri[e]; const j = tri[(e + 1) % 3];
      if ((zOf(i) - level) * (zOf(j) - level) < 0) cut.push([i, j]);
    }
    if (cut.length === 2) {
      segs.push({
        a: key(...cut[0]), b: key(...cut[1]),
        pa: edgePoint(...cut[0]), pb: edgePoint(...cut[1]),
      });
    }
  }
  // Склейка отрезков по общим рёбрам триангуляции.
  const byEdge = new Map();
  segs.forEach((s, idx) => {
    for (const k of [s.a, s.b]) {
      if (!byEdge.has(k)) byEdge.set(k, []);
      byEdge.get(k).push(idx);
    }
  });
  const used = new Array(segs.length).fill(false);
  const lines = [];
  const walk = (startIdx, fromKey) => {
    // Идём от отрезка startIdx через его конец, отличный от fromKey.
    const pts = [];
    let idx = startIdx;
    let enter = fromKey;
    while (idx != null && !used[idx]) {
      used[idx] = true;
      const s = segs[idx];
      const exit = s.a === enter ? s.b : s.a;
      pts.push(exit === s.b ? s.pb : s.pa);
      const next = (byEdge.get(exit) || []).find((j) => j !== idx && !used[j]);
      enter = exit;
      idx = next ?? null;
    }
    return { pts, endKey: enter };
  };
  for (let i = 0; i < segs.length; i += 1) {
    if (used[i]) continue;
    const s = segs[i];
    // Вперёд от конца b, затем назад от конца a.
    const fwd = walk(i, s.a);
    const back = (byEdge.get(s.a) || []).find((j) => j !== i && !used[j]);
    let backPts = [];
    if (back != null) backPts = walk(back, s.a).pts.reverse();
    const pts = [...backPts, s.pa, ...fwd.pts];
    const closed = fwd.endKey === s.a && backPts.length === 0;
    if (closed) pts.pop(); // последняя точка совпадает с первой
    lines.push({ pts, closed });
  }
  return lines;
}

// ---------------------------------------------------------------- Дом на рельефе

// Отметки под домом: углы габарита нижнего этажа (с наружными стенами),
// углы комнат и центр — в координатах съёмки. Возвращает null, если рельефа
// или дома нет.
export function houseTerrain(project, model = terrainModel(project.site?.terrain)) {
  if (!model?.tris?.length) return null;
  // Нижний этаж (без импорта model.js — нет цикла site → terrain → model).
  const ground = Array.isArray(project.levels) && project.levels.length
    ? [...project.levels].sort((a, b) => a.elevation - b.elevation)[0] : project;
  const rooms = (ground.rooms || []).filter((r) => !r.parentId);
  if (!rooms.length) return null;
  const t = project.settings?.exterior ?? 0;
  const minX = Math.min(...rooms.map((r) => r.x)) - t;
  const minY = Math.min(...rooms.map((r) => r.y)) - t;
  const maxX = Math.max(...rooms.map((r) => r.x + r.w)) + t;
  const maxY = Math.max(...rooms.map((r) => r.y + r.h)) + t;
  const b = project.building;
  const names = ['СЗ', 'СВ', 'ЮВ', 'ЮЗ'];
  let outside = false;
  const at = (local) => {
    const w = toWorld(b, local);
    let z = interpolateZ(model, w.x, w.y);
    if (z == null) { outside = true; z = interpolateZ(model, w.x, w.y, { clamp: true }); }
    return { ...w, z };
  };
  const corners = [
    { x: minX, y: minY }, { x: maxX, y: minY }, { x: maxX, y: maxY }, { x: minX, y: maxY },
  ].map((p, i) => ({ ...at(p), name: names[i] }));
  const center = at({ x: (minX + maxX) / 2, y: (minY + maxY) / 2 });
  const samples = [...corners, center];
  for (const r of rooms) {
    for (const p of [{ x: r.x, y: r.y }, { x: r.x + r.w, y: r.y }, { x: r.x + r.w, y: r.y + r.h }, { x: r.x, y: r.y + r.h }]) {
      samples.push(at(p));
    }
  }
  const zs = samples.map((s) => s.z).filter(Number.isFinite);
  const min = Math.min(...zs);
  const max = Math.max(...zs);
  const avg = corners.reduce((s, c) => s + c.z, 0) / corners.length;
  const floorAuto = Math.round(avg / 10) * 10;
  const floorZ = Number.isFinite(project.site?.terrain?.floorZ) ? project.site.terrain.floorZ : floorAuto;
  return {
    corners, center, min, max, drop: max - min, avg, floorAuto, floorZ, outside,
    warn: max - min > HOUSE_DROP_WARN,
    localBox: { minX, minY, maxX, maxY },
  };
}

// Сводка для панели: число точек, мин/макс, средний уклон.
export function terrainSummary(model) {
  if (!model) return null;
  let slopeSum = 0; let areaSum = 0; let maxSlope = 0;
  for (const tri of model.tris) {
    const p = tri.map((k) => model.pts[k]);
    const s = trianglePlaneSlope(p);
    if (!s) continue;
    const area = Math.abs((p[1].x - p[0].x) * (p[2].y - p[0].y) - (p[1].y - p[0].y) * (p[2].x - p[0].x)) / 2;
    slopeSum += s.slope * area; areaSum += area;
    // Максимум — без «щепок» у края оболочки (узкие треугольники дают
    // ложные крутые уклоны). Качество: 4√3·S / Σ рёбер² (1 — равносторонний).
    const e2 = [[0, 1], [1, 2], [2, 0]].reduce((t, [i, j]) => t + (p[i].x - p[j].x) ** 2 + (p[i].y - p[j].y) ** 2, 0);
    const quality = e2 ? (4 * Math.sqrt(3) * area) / e2 : 0;
    if (quality > 0.2 && s.slope > maxSlope) maxSlope = s.slope;
  }
  return {
    count: model.pts.length,
    triangles: model.tris.length,
    minZ: model.minZ,
    maxZ: model.maxZ,
    meanSlope: areaSum ? slopeSum / areaSum : 0,
    maxSlope,
    error: model.error,
    duplicates: model.duplicates,
  };
}

// ---------------------------------------------------------------- Ввод

// Отметка «123.45» / «123,45» (метры) → мм; null, если не число.
export function parseElevationM(text) {
  const s = String(text ?? '').trim().replace(/\s/g, '').replace(',', '.');
  if (!/^[+-]?\d+(\.\d+)?$/.test(s)) return null;
  const v = Number(s);
  return Number.isFinite(v) && Math.abs(v) < 100000 ? Math.round(v * 1000 * 100) / 100 : null;
}

export function formatElevation(zMm) {
  return Number.isFinite(zMm) ? (zMm / 1000).toFixed(2) : '—';
}

// Список «x, y, z» (строка на точку; разделители — запятая, точка с запятой,
// табуляция, пробелы; десятичная запятая допустима, если поле разделено
// табуляцией/«;»/пробелом). units: 'm' | 'mm'. Возвращает
// { points: [{x,y,z}] (мм, как в тексте), errors: [номера строк] }.
export function parseXyzList(text, units = 'm') {
  const k = units === 'mm' ? 1 : 1000;
  const points = [];
  const errors = [];
  String(text || '').split(/\r\n|\r|\n/).forEach((line, i) => {
    const s = line.trim();
    if (!s || s.startsWith('#')) return;
    let parts;
    if (/[\t;]/.test(s)) parts = s.split(/[\t;]+/);
    else if (/,\s/.test(s) || (s.match(/,/g) || []).length === 2) parts = s.split(/,/);
    else parts = s.split(/\s+/);
    const nums = parts.map((p) => p.trim()).filter(Boolean).map((p) => Number(p.replace(',', '.')));
    // Допускается номер точки первым столбцом: «1  10.0  20.0  123.45».
    const vals = nums.length === 4 ? nums.slice(1) : nums;
    if (vals.length !== 3 || !vals.every(Number.isFinite)) {
      if (!(i === 0 && /[a-zа-я]/i.test(s))) errors.push(i + 1); // заголовок таблицы — не ошибка
      return;
    }
    points.push({ x: vals[0] * k, y: vals[1] * k, z: vals[2] * k });
  });
  return { points, errors };
}

// Отметки, извлечённые из DXF подложки, хранятся в пикселях картинки
// (underlay.marks: [{px, py, z}]), поэтому переживают калибровку, сдвиг и
// поворот подложки. Перевод в координаты съёмки — по текущему положению.
export function underlayPxToWorld(u, px, py) {
  const w = u.widthPx * u.mmPerPx;
  const h = u.heightPx * u.mmPerPx;
  const cx = u.x + w / 2;
  const cy = u.y + h / 2;
  const lx = (px - u.widthPx / 2) * u.mmPerPx;
  const ly = (py - u.heightPx / 2) * u.mmPerPx;
  const r = ((u.rot || 0) * Math.PI) / 180;
  const c = Math.cos(r); const s = Math.sin(r);
  return { x: cx + lx * c - ly * s, y: cy + lx * s + ly * c };
}

export function underlayMarksToWorld(u) {
  if (!u || !Array.isArray(u.marks)) return [];
  return u.marks
    .filter((m) => [m?.px, m?.py, m?.z].every(Number.isFinite))
    .map((m) => ({ ...underlayPxToWorld(u, m.px, m.py), z: m.z }));
}

// DXF-отметки (единицы чертежа) → пиксели картинки по transform из dxfToImage.
export function dxfMarksToPx(marks, transform) {
  const { bx, by, k, H } = transform;
  return marks.map((m) => ({
    px: Math.round((m.x - bx) * k * 100) / 100,
    py: Math.round((H - (m.y - by) * k) * 100) / 100,
    z: m.z,
  }));
}
