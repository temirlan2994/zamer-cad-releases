// Тени по времени суток для режима «Ландшафт». Чистый модуль без DOM.
//
// Солнце — core/site.js sunPosition (широта/долгота/пояс участка, по
// умолчанию Алматы). Тень точки на высоте z (мм) ложится на землю в
// p + d·k·z, где d — единичный вектор от солнца в мире плана, k = ctg(высоты
// солнца), но не больше SHADOW_MAX_RATIO (при низком солнце тень не длиннее
// N высот). Земля считается плоской (отметки elev и рельеф не учитываются).
//
// Отбрасыватели: дом (по прямоугольникам комнат с наружной стеной, до верха
// каждого этажа), соседние дома, деревья (крона — эллипсоид или конус у
// хвойных, ствол — полоса), кусты, изгороди, ограждения, подпорные стенки
// (к низу — на всю высоту, к верху — только парапет), короба, беседки,
// перголы и прочие малые формы — призмой по контуру и высоте.
//
// shadowPolys(project, sun) → [{ id, kind, z, poly }]: полигоны в мировых
// координатах (координаты съёмки, мм), все с одной ориентацией (площадь > 0,
// так что заливка одним путём nonzero объединяет их без «дыр»), по z (верх
// отбрасывателя) по возрастанию.

import { isOpenRoom, isShaft, DEFAULT_EXTERIOR } from './catalog.js';
import { rectCornersWorld } from './building.js';
import { roomRects } from './room-shape.js';
import { convexHull, neighborRectCorners, sunPosition } from './site.js';
import {
  isRoundObject, landscapeDef, objectOutline, objectPath, retainingInfo, retainingEdges, PLANTER_KINDS,
} from './landscape.js';
import { pointInPolygon } from './zamer/geometry.js';

export const SHADOW_MAX_RATIO = 6; // тень не длиннее 6 высот (солнце ниже ≈9,5°)
export const SUN_MIN_ALT = 0.5; // ниже — солнце за горизонтом, теней нет

const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const RUMBS = ['С', 'СВ', 'В', 'ЮВ', 'Ю', 'ЮЗ', 'З', 'СЗ'];

// Готовые даты: равноденствия и солнцестояния ('MM-DD').
export const SUN_DATES = [
  { id: '03-21', title: '21 марта' },
  { id: '06-21', title: '21 июня' },
  { id: '09-23', title: '23 сентября' },
  { id: '12-21', title: '21 декабря' },
];

export const pad2 = (n) => String(n).padStart(2, '0');
export const fmtClock = (minutes) => {
  const m = Math.max(0, Math.min(1439, Math.round(minutes)));
  return `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`;
};

// «21 июня, 15:30».
export function formatSunLabel(date, minutes) {
  const [, mm, dd] = String(date).split('-').map(Number);
  const month = MONTHS[(mm || 1) - 1] || '';
  return `${dd || 1} ${month}, ${fmtClock(minutes)}`;
}

// Румб по азимуту (от севера по часовой).
export const rumbOf = (azimuth) => RUMBS[Math.round((((azimuth % 360) + 360) % 360) / 45) % 8];

// Положение солнца для участка: { altitude, azimuth, up, dir, k }.
// dir — единичный вектор тени в мире плана (от солнца), k — длина тени на
// единицу высоты (с ограничением). north — север плана (градусы по часовой).
export function sunForSite(site, date, minutes) {
  const loc = site?.location || {};
  const lat = Number.isFinite(loc.lat) ? loc.lat : 43.238;
  const lon = Number.isFinite(loc.lon) ? loc.lon : 76.889;
  const tz = Number.isFinite(loc.tz) ? loc.tz : 5;
  const s = sunPosition(lat, lon, tz, date, minutes);
  return withDirection(s, site?.north || 0);
}

export function withDirection(s, north = 0) {
  const up = s.altitude > SUN_MIN_ALT;
  const ang = ((north + s.azimuth) * Math.PI) / 180;
  // Направление НА солнце: (sin, −cos); тень — в обратную сторону.
  const dir = { x: -Math.sin(ang), y: Math.cos(ang) };
  const k = up ? Math.min(SHADOW_MAX_RATIO, 1 / Math.tan((s.altitude * Math.PI) / 180)) : 0;
  return { altitude: s.altitude, azimuth: s.azimuth, up, dir, k };
}

// Восход и заход (минуты от полуночи, шаг 5 мин) — для подсказки ползунка.
export function sunRiseSet(site, date) {
  let rise = null;
  let set = null;
  for (let m = 0; m <= 1440; m += 5) {
    const up = sunForSite(site, date, m).up;
    if (up && rise === null) rise = m;
    if (up) set = m;
  }
  return { rise, set };
}

// ------------------------------------------------------------ Геометрия

function signedArea(poly) {
  let s = 0;
  for (let i = 0; i < poly.length; i += 1) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    s += a.x * b.y - b.x * a.y;
  }
  return s / 2;
}

// Одна ориентация для всех полигонов (площадь > 0); вырожденные — null.
function oriented(poly) {
  if (!poly || poly.length < 3) return null;
  const a = signedArea(poly);
  if (Math.abs(a) < 1) return null;
  return a > 0 ? poly : [...poly].reverse();
}

const shift = (p, sun, z) => ({ x: p.x + sun.dir.x * sun.k * z, y: p.y + sun.dir.y * sun.k * z });

// Призма выпуклого контура от z0 до z1 — выпуклая оболочка двух сдвигов.
function prismConvex(outline, sun, z0, z1) {
  const pts = [];
  for (const p of outline) { pts.push(shift(p, sun, z0)); pts.push(shift(p, sun, z1)); }
  return convexHull(pts);
}

// Призма произвольного (невыпуклого) контура: низ, верх и параллелограммы
// по рёбрам — набор полигонов (объединяются заливкой nonzero).
function prismPoly(outline, sun, z0, z1) {
  const lo = outline.map((p) => shift(p, sun, z0));
  const hi = outline.map((p) => shift(p, sun, z1));
  const out = [lo, hi];
  for (let i = 0; i < outline.length; i += 1) {
    const j = (i + 1) % outline.length;
    out.push([lo[i], lo[j], hi[j], hi[i]]);
  }
  return out;
}

// Эллипсоид: горизонтальные полуоси rx, ry (поворот rot, рад) вокруг c,
// вертикальная rz, центр на высоте hc. Тень — оболочка проекций точек.
function ellipsoid(c, rx, ry, rot, hc, rz, sun, simple) {
  const nLat = simple ? 3 : 6;
  const nLon = simple ? 10 : 20;
  const cs = Math.cos(rot);
  const sn = Math.sin(rot);
  const pts = [];
  for (let i = 0; i <= nLat; i += 1) {
    const phi = -Math.PI / 2 + (Math.PI * i) / nLat;
    const cp = Math.cos(phi);
    const z = hc + rz * Math.sin(phi);
    const ring = cp < 1e-6 ? 1 : nLon;
    for (let j = 0; j < ring; j += 1) {
      const t = (2 * Math.PI * j) / nLon;
      const lx = rx * cp * Math.cos(t);
      const ly = ry * cp * Math.sin(t);
      pts.push(shift({ x: c.x + lx * cs - ly * sn, y: c.y + lx * sn + ly * cs }, sun, z));
    }
  }
  return convexHull(pts);
}

// Конус (хвойные): основание-эллипс на zb, вершина на zt.
function cone(c, rx, ry, rot, zb, zt, sun, simple) {
  const n = simple ? 10 : 20;
  const cs = Math.cos(rot);
  const sn = Math.sin(rot);
  const pts = [shift(c, sun, zt)];
  for (let j = 0; j < n; j += 1) {
    const t = (2 * Math.PI * j) / n;
    const lx = rx * Math.cos(t);
    const ly = ry * Math.sin(t);
    pts.push(shift({ x: c.x + lx * cs - ly * sn, y: c.y + lx * sn + ly * cs }, sun, zb));
  }
  return convexHull(pts);
}

// Ствол: полоса шириной w от основания (z0) до z1 в сторону тени.
function trunk(c, w, sun, z0, z1) {
  const a = shift(c, sun, z0);
  const b = shift(c, sun, z1);
  const nx = -sun.dir.y * (w / 2);
  const ny = sun.dir.x * (w / 2);
  return [
    { x: a.x + nx, y: a.y + ny }, { x: b.x + nx, y: b.y + ny },
    { x: b.x - nx, y: b.y - ny }, { x: a.x - nx, y: a.y - ny },
  ];
}

// Полоса шириной w вдоль отрезка ab (выпуклый прямоугольник).
function bandRect(a, b, w) {
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const nx = (-(b.y - a.y) / len) * (w / 2);
  const ny = ((b.x - a.x) / len) * (w / 2);
  return [
    { x: a.x + nx, y: a.y + ny }, { x: b.x + nx, y: b.y + ny },
    { x: b.x - nx, y: b.y - ny }, { x: a.x - nx, y: a.y - ny },
  ];
}

// ------------------------------------------------------------ Отбрасыватели

const CONE_LOOKS = new Set(['pine', 'spruce']);
const PLANT_SHAPES = new Set(['point', 'circle']);

// Подъём основания: растение в коробе стоит на его засыпке.
function baseOf(o, byId) {
  if (!o.parent) return 0;
  const p = byId.get(o.parent);
  return p && PLANTER_KINDS.has(p.kind) ? Math.max(0, p.height || 0) : 0;
}

// Растения: деревья (крона-эллипсоид или конус + ствол) и кусты (эллипсоид).
function plantShadows(o, def, H, z0, sun, simple) {
  const c = { x: o.x, y: o.y };
  const rx = Math.max(50, (o.w || def.w) / 2);
  const ry = Math.max(50, (o.h || o.w || def.h) / 2);
  const rot = ((o.rotation || 0) * Math.PI) / 180;
  const r = Math.max(rx, ry);
  const tree = H >= 2500;
  if (CONE_LOOKS.has(def.look)) {
    const zb = z0 + H * 0.12;
    return [cone(c, rx, ry, rot, zb, z0 + H, sun, simple), trunk(c, Math.max(120, r * 0.08), sun, z0, zb)];
  }
  if (!tree || def.look === 'thuja' || def.look === 'hedge') {
    // Куст, туя, валун: эллипсоид на всю высоту.
    return [ellipsoid(c, rx, ry, rot, z0 + H / 2, H / 2, sun, simple)];
  }
  // Лиственное дерево: крона в верхней части, ствол до её низа.
  const rz = Math.min(H * 0.32, Math.max(r * 0.9, H * 0.2));
  const hc = z0 + H - rz;
  return [
    ellipsoid(c, rx, ry, rot, hc, rz, sun, simple),
    trunk(c, Math.min(500, Math.max(120, r * 0.1)), sun, z0, hc - rz * 0.6),
  ];
}

// Линейные: по отрезкам оси полосой ширины объекта.
function lineShadows(o, def, H, sun) {
  const path = objectPath(o);
  const w = Math.max(50, o.width || def.h || 150);
  const out = [];
  if (o.kind === 'retaining-wall') {
    const ri = retainingInfo(o);
    const e = retainingEdges(o);
    for (let i = 0; i < path.length - 1; i += 1) {
      const a = path[i];
      const b = path[i + 1];
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      if (len < 1) continue;
      // Нормаль к низу (lowSign — знак нормали (−u.y, u.x) в сторону низа).
      const nx = (-(b.y - a.y) / len) * e.lowSign;
      const ny = ((b.x - a.x) / len) * e.lowSign;
      const toLow = nx * sun.dir.x + ny * sun.dir.y > 0;
      const h = toLow ? ri.height : ri.parapet;
      if (h > 0) out.push(prismConvex(bandRect(a, b, ri.thick), sun, 0, h));
    }
    return out;
  }
  for (let i = 0; i < path.length - 1; i += 1) {
    const a = path[i];
    const b = path[i + 1];
    if (Math.hypot(b.x - a.x, b.y - a.y) < 1) continue;
    out.push(prismConvex(bandRect(a, b, w), sun, 0, H));
  }
  return out;
}

// Отбрасывает ли объект тень (ветка «Солнце»).
export function castsShadow(o) {
  const def = landscapeDef(o.kind);
  if (!def || def.shape === 'note') return false;
  if (o.kind === 'retaining-wall' || PLANTER_KINDS.has(o.kind)) return true;
  return Boolean(def.shadow) && (o.height ?? def.height) > 0;
}

function objectShadows(o, byId, sun, simple) {
  const def = landscapeDef(o.kind);
  const H = Math.max(0, Number(o.height ?? def.height) || 0);
  if (H <= 0) return [];
  const z0 = baseOf(o, byId);
  const green = def.cat === 'green' && o.kind !== 'hedge' && o.kind !== 'hedge-box';
  if (def.shape === 'line') return lineShadows(o, def, H, sun);
  if (def.shape === 'poly') {
    const outline = objectPath(o).map(({ x, y }) => ({ x, y }));
    return outline.length >= 3 ? prismPoly(outline, sun, z0, z0 + H) : [];
  }
  if (green && (PLANT_SHAPES.has(def.shape) || isRoundObject(o, def) || o.kind === 'boulder')) {
    return plantShadows(o, def, H, z0, sun, simple);
  }
  return [prismConvex(objectOutline(o, simple ? 12 : 24), sun, z0, z0 + H)];
}

// Дом: каждый прямоугольник комнаты (с наружной стеной) до верха своего
// этажа; открытые помещения (террасы) и шахты тени не дают.
function houseShadows(project, sun) {
  const out = [];
  const t = project.settings?.exterior || DEFAULT_EXTERIOR;
  for (const level of project.levels || []) {
    const top = (level.elevation || 0) + (level.height || 3000);
    if (top <= 0) continue;
    for (const r of level.rooms || []) {
      if (r.parentId || isOpenRoom(r) || isShaft(r)) continue;
      for (const rect of roomRects(r)) {
        const corners = rectCornersWorld(project.building, { x: rect.x - t, y: rect.y - t, w: rect.w + t * 2, h: rect.h + t * 2 });
        out.push({ poly: prismConvex(corners, sun, 0, top), z: top });
      }
    }
  }
  return out;
}

// Полигоны теней. sun — из sunForSite (или {up:false} — пусто).
// opts: { objects — свой список объектов (видимые слои), simple — грубее
// (перетаскивание ползунка), house — учитывать дом (по умолчанию да) }.
export function shadowPolys(project, sun, opts = {}) {
  if (!sun?.up || !(sun.k > 0)) return [];
  const site = project.site || {};
  const objects = opts.objects || site.landscape?.objects || [];
  const byId = new Map(objects.map((o) => [o.id, o]));
  const out = [];
  const push = (id, kind, z, poly) => {
    const p = oriented(poly);
    if (p) out.push({ id, kind, z, poly: p });
  };
  if (opts.house !== false) {
    for (const h of houseShadows(project, sun)) push('house', 'house', h.z, h.poly);
  }
  for (const n of site.neighbors || []) {
    const H = n.height || 6000;
    push(n.id || 'neighbor', 'neighbor', H, prismConvex(neighborRectCorners(n), sun, 0, H));
  }
  for (const o of objects) {
    if (!castsShadow(o)) continue;
    const def = landscapeDef(o.kind);
    const H = (o.height ?? def.height) + baseOf(o, byId);
    const kind = def.cat === 'green' ? (H >= 2500 ? 'tree' : 'plant') : 'object';
    for (const poly of objectShadows(o, byId, sun, Boolean(opts.simple))) push(o.id, kind, H, poly);
  }
  return out.sort((a, b) => a.z - b.z);
}

// Подпись проекта для кеша: дешёвый хеш геометрии и высот (дом, соседи,
// ландшафт). Меняется при любой правке, влияющей на тени.
export function shadowSignature(project) {
  let h = 2166136261;
  const mix = (v) => {
    const n = Number.isFinite(v) ? Math.round(v) : 0;
    h = Math.imul(h ^ (n & 0xffff), 16777619);
    h = Math.imul(h ^ (n >>> 16), 16777619);
  };
  const site = project.site || {};
  mix(site.north || 0); mix((site.location?.lat || 0) * 1000); mix((site.location?.lon || 0) * 1000); mix(site.location?.tz || 0);
  const b = project.building || {};
  mix(b.x); mix(b.y); mix((b.rotation || 0) * 100); mix(project.settings?.exterior);
  for (const level of project.levels || []) {
    mix(level.elevation); mix(level.height); mix((level.rooms || []).length);
    for (const r of level.rooms || []) {
      mix(r.x); mix(r.y); mix(r.w); mix(r.h);
      mix(r.notch ? r.notch.w + r.notch.h * 7 : 0);
      mix(r.outline?.length || 0);
      for (const p of r.outline || []) { mix(p.x); mix(p.y); }
    }
  }
  for (const n of site.neighbors || []) { mix(n.x); mix(n.y); mix(n.w); mix(n.h); mix(n.height); mix(n.rot); }
  const objs = site.landscape?.objects || [];
  mix(objs.length);
  for (const o of objs) {
    mix(o.x); mix(o.y); mix(o.w); mix(o.h); mix((o.rotation || 0) * 10); mix(o.height); mix(o.width);
    mix(o.kind.length * 31 + o.kind.charCodeAt(0));
    mix(o.parent ? o.parent.length : 0);
    for (const p of o.points || []) { mix(p.x); mix(p.y); }
    if (o.meta?.upper) mix(o.meta.upper === 'right' ? 1 : 2);
    if (o.meta?.drop) mix(o.meta.drop);
  }
  return h >>> 0;
}

// ------------------------------------------------------------ Освещённость

function bbox(poly) {
  let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
  for (const p of poly) {
    if (p.x < x0) x0 = p.x;
    if (p.y < y0) y0 = p.y;
    if (p.x > x1) x1 = p.x;
    if (p.y > y1) y1 = p.y;
  }
  return { x0, y0, x1, y1 };
}

// Растровая сетка участка: сколько часов в день ячейка на солнце.
// opts: { cell — шаг сетки (мм, 1000), stepMin — шаг по времени (мин, 30),
// bounds — полигон (по умолчанию граница участка), objects }.
// Возвращает { x0, y0, cell, cols, rows, hours: Float32Array (NaN — вне
// участка или под домом), stepMin, dayHours, maxHours } или null.
export function sunHoursGrid(project, date, opts = {}) {
  const site = project.site || {};
  const bounds = opts.bounds || site.boundary;
  if (!bounds || bounds.length < 3) return null;
  const cell = opts.cell || 1000;
  const stepMin = opts.stepMin || 30;
  const bb = bbox(bounds);
  let cols = Math.ceil((bb.x1 - bb.x0) / cell);
  let rows = Math.ceil((bb.y1 - bb.y0) / cell);
  let size = cell;
  // Не больше ~40 000 ячеек: на огромном участке сетка крупнее.
  while (cols * rows > 40000) { size *= 2; cols = Math.ceil((bb.x1 - bb.x0) / size); rows = Math.ceil((bb.y1 - bb.y0) / size); }
  const n = cols * rows;
  const hours = new Float32Array(n);
  const inside = new Uint8Array(n);
  const cx = (i) => bb.x0 + (i + 0.5) * size;
  const cy = (j) => bb.y0 + (j + 0.5) * size;
  const house = houseShadows(project, { up: true, dir: { x: 0, y: 0 }, k: 0 }).map((h) => h.poly);
  for (let j = 0; j < rows; j += 1) {
    for (let i = 0; i < cols; i += 1) {
      const p = { x: cx(i), y: cy(j) };
      if (!pointInPolygon(p, bounds)) continue;
      if (house.some((poly) => pointInPolygon(p, poly))) continue;
      inside[j * cols + i] = 1;
    }
  }
  // Короба не затеняют собственную засыпку (их тень-призма включает пятно).
  const own = new Map();
  for (const o of opts.objects || site.landscape?.objects || []) {
    if (PLANTER_KINDS.has(o.kind)) own.set(o.id, objectOutline(o, 16));
  }
  const stamp = new Uint16Array(n);
  let step = 0;
  let dayHours = 0;
  for (let m = stepMin / 2; m < 1440; m += stepMin) {
    const sun = sunForSite(site, date, m);
    if (!sun.up) continue;
    step += 1;
    dayHours += stepMin / 60;
    for (const s of shadowPolys(project, sun, { objects: opts.objects, simple: true })) {
      const b = bbox(s.poly);
      const i0 = Math.max(0, Math.floor((b.x0 - bb.x0) / size));
      const i1 = Math.min(cols - 1, Math.floor((b.x1 - bb.x0) / size));
      const j0 = Math.max(0, Math.floor((b.y0 - bb.y0) / size));
      const j1 = Math.min(rows - 1, Math.floor((b.y1 - bb.y0) / size));
      for (let j = j0; j <= j1; j += 1) {
        for (let i = i0; i <= i1; i += 1) {
          const idx = j * cols + i;
          if (!inside[idx] || stamp[idx] === step) continue;
          const p = { x: cx(i), y: cy(j) };
          if (!pointInPolygon(p, s.poly)) continue;
          const self = own.get(s.id);
          if (self && pointInPolygon(p, self)) continue;
          stamp[idx] = step;
        }
      }
    }
    for (let idx = 0; idx < n; idx += 1) if (inside[idx] && stamp[idx] !== step) hours[idx] += stepMin / 60;
  }
  let maxHours = 0;
  for (let idx = 0; idx < n; idx += 1) {
    if (!inside[idx]) hours[idx] = NaN;
    else if (hours[idx] > maxHours) maxHours = hours[idx];
  }
  return { x0: bb.x0, y0: bb.y0, cell: size, cols, rows, hours, stepMin, dayHours, maxHours };
}

// Часы солнца в точке (ближайшая ячейка), NaN — вне сетки.
export function sunHoursAt(grid, p) {
  if (!grid) return NaN;
  const i = Math.floor((p.x - grid.x0) / grid.cell);
  const j = Math.floor((p.y - grid.y0) / grid.cell);
  if (i < 0 || j < 0 || i >= grid.cols || j >= grid.rows) return NaN;
  return grid.hours[j * grid.cols + i];
}

// Сводка: участок (среднее, площадь «тень > половины дня») и посадочные
// поверхности (газоны, клумбы, грядки) — средние солнечные часы.
const BED_KINDS = new Set(['lawn-patch', 'lawn-area', 'bed-round', 'bed-rect', 'bed-strip', 'planter-box', 'planter-area', 'vegbeds', 'flowers-clump']);
export function sunHoursSummary(grid, objects = []) {
  if (!grid) return null;
  let sum = 0;
  let count = 0;
  let shady = 0;
  for (const v of grid.hours) {
    if (Number.isNaN(v)) continue;
    sum += v; count += 1;
    if (v < grid.dayHours / 2) shady += 1;
  }
  const cellM2 = (grid.cell / 1000) ** 2;
  const beds = [];
  for (const o of objects) {
    if (!BED_KINDS.has(o.kind)) continue;
    const outline = objectOutline(o, 16);
    if (outline.length < 3) continue;
    const b = bbox(outline);
    let s = 0;
    let c = 0;
    for (let j = Math.max(0, Math.floor((b.y0 - grid.y0) / grid.cell)); j <= Math.min(grid.rows - 1, Math.floor((b.y1 - grid.y0) / grid.cell)); j += 1) {
      for (let i = Math.max(0, Math.floor((b.x0 - grid.x0) / grid.cell)); i <= Math.min(grid.cols - 1, Math.floor((b.x1 - grid.x0) / grid.cell)); i += 1) {
        const v = grid.hours[j * grid.cols + i];
        if (Number.isNaN(v)) continue;
        if (!pointInPolygon({ x: grid.x0 + (i + 0.5) * grid.cell, y: grid.y0 + (j + 0.5) * grid.cell }, outline)) continue;
        s += v; c += 1;
      }
    }
    // Мелкая клумба меньше ячейки — по центру.
    const hours = c ? s / c : sunHoursAt(grid, { x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2 });
    if (Number.isFinite(hours)) beds.push({ id: o.id, kind: o.kind, title: landscapeDef(o.kind)?.title || o.kind, hours });
  }
  return {
    mean: count ? sum / count : 0,
    dayHours: grid.dayHours,
    shadyM2: shady * cellM2,
    areaM2: count * cellM2,
    beds,
  };
}

// Характер места по часам солнца (для клумб).
export function sunClass(hours) {
  if (hours >= 6) return 'солнце';
  if (hours >= 3) return 'полутень';
  return 'тень';
}
