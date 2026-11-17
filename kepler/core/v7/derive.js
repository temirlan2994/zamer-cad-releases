// derive(project) — всё производное v7 одной чистой функцией от истины
// (docs/architecture-v7.md, «Конвейер»):
//   блоки → видимые формы (carve) → стены блоков (block-walls) + ручные
//   стены → тела стен со стыками и проёмами (wall-body) → объединение тел →
//   помещения = ограниченные области свободного пространства (дыры
//   объединения минус островки) + открытые площадки → имя/тип из блока или
//   «семени».
// Детерминирована (порядок массивов не влияет), кешируется по входу.
// Результат НЕ мутировать — он может быть общим для нескольких вызовов.

import {
  area, bbox, boxesOverlap, difference, interiorPoint, outerArea, perimeter, pointInPolygon, union,
} from '../geom/poly.js';
import { blockWalls } from './block-walls.js';
import { carveLevel } from './carve.js';
import { activeLevel7, blockEdges, blockIsOpen, blockIsShaft, blockOrder } from './model.js';
import { snapPt, wallBodies, wallFrame } from './wall-body.js';

const MIN_ROOM_MM2 = 50_000; // меньше 0,05 м² — щель между стенами, не помещение
const MIN_ROOM_THICK = 90; // «толщина» 2A/P меньше — щель

// ---------------------------------------------------------------- кеш

const CACHE_MAX = 32;
const cache = new Map();

function cacheKey(project, level) {
  const s = project.settings || {};
  return JSON.stringify([level, s.partition, s.exterior, s.bearing]);
}

export function clearDeriveCache() { cache.clear(); }

export function derive(project, { levelId, cache: useCache = true } = {}) {
  const level = activeLevel7(project, levelId);
  if (!level) return null;
  if (!useCache) return deriveLevel(project, level);
  const k = cacheKey(project, level);
  const hit = cache.get(k);
  if (hit) { cache.delete(k); cache.set(k, hit); return hit; }
  const res = deriveLevel(project, level);
  cache.set(k, res);
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
  return res;
}

// ---------------------------------------------------------------- ручные стены

function realWallRecords(level) {
  return (level.walls || []).filter((w) => w?.from && w?.to).map((w) => ({
    id: w.id, a: snapPt(w.from), b: snapPt(w.to), thickness: Number(w.thickness) || 100,
    justify: w.justify || 'center', hidden: Boolean(w.hidden), roomBounding: w.roomBounding !== false,
    source: 'wall', kind: w.wallType || 'partition',
  })).filter((w) => Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y) >= 1);
}

// ---------------------------------------------------------------- проёмы

const dot = (a, b) => a.x * b.x + a.y * b.y;

// Стена, на которой стоит точка P (ось или тело с допуском 1 мм).
function wallAtPoint(records, P, prefer) {
  let best = null;
  for (const w of records) {
    const f = w.frame || wallFrame(w);
    const v = { x: P.x - w.a.x, y: P.y - w.a.y };
    const s = dot(v, f.d); const o = dot(v, f.L);
    if (s < -0.5 || s > f.len + 0.5 || o < f.lo - 1 || o > f.hi + 1) continue;
    const score = (prefer(w) ? 0 : 10) + Math.abs(o - (f.lo + f.hi) / 2) / 1000;
    if (!best || score < best.score) best = { w, s, score };
  }
  return best;
}

function resolveOpenings(level, records) {
  const byId = new Map(records.map((w) => [w.id, w]));
  const blocks = new Map((level.blocks || []).map((b) => [b.id, b]));
  const out = []; const issues = [];
  for (const o of level.openings || []) {
    const h = o.host || {};
    let wall = null; let t = null; let point = null;
    if (h.wallId) {
      wall = byId.get(h.wallId) || null;
      if (wall) { t = Number(h.t); const f = wall.frame; point = { x: wall.a.x + f.d.x * t, y: wall.a.y + f.d.y * t }; }
    } else if (h.blockId && blocks.has(h.blockId)) {
      const e = blockEdges(blocks.get(h.blockId))[h.edge];
      if (e) {
        const len = Math.hypot(e.b.x - e.a.x, e.b.y - e.a.y) || 1;
        const off = Number(h.offset) || 0;
        point = { x: e.a.x + ((e.b.x - e.a.x) / len) * off, y: e.a.y + ((e.b.y - e.a.y) / len) * off };
        const hit = wallAtPoint(records, point, (w) => w.blockId === h.blockId || w.pair?.includes(h.blockId));
        if (hit) { wall = hit.w; t = hit.s; }
      }
    }
    if (!wall || !Number.isFinite(t)) { issues.push({ kind: 'opening-orphan', opening: o.id }); continue; }
    out.push({ id: o.id, kind: o.kind, wallId: wall.id, t, width: Number(o.width) || 0, point });
  }
  out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  issues.sort((a, b) => (a.opening < b.opening ? -1 : 1));
  return { list: out, issues };
}

// ---------------------------------------------------------------- помещения

function isGap(poly) {
  const a = area(poly);
  return a < MIN_ROOM_MM2 || (2 * a) / perimeter(poly) < MIN_ROOM_THICK;
}

// Ограниченные области свободного пространства: дыры объединения тел минус
// островки (тела, стоящие внутри дыры: колонна, отдельная стенка).
function freeRegions(U) {
  const boxes = U.map((poly) => bbox([poly]));
  const regions = [];
  U.forEach((poly, pi) => {
    for (const hole of poly.slice(1)) {
      const hp = [hole.slice().reverse()];
      const hb = bbox(hp);
      const islands = U.filter((q, qi) => qi !== pi && boxes[qi].x0 >= hb.x0 && boxes[qi].x1 <= hb.x1
        && boxes[qi].y0 >= hb.y0 && boxes[qi].y1 <= hb.y1);
      const parts = islands.length ? difference(hp, islands) : union(hp);
      regions.push(...parts);
    }
  });
  return regions;
}

function matchSource(level, carved, poly) {
  const p = interiorPoint([poly]);
  if (!p) return null;
  const cands = (level.blocks || []).filter((b) => !blockIsOpen(b) && carved[b.id]
    && pointInPolygon(carved[b.id].shape, p, 0)).sort(blockOrder);
  if (cands.length) return { kind: 'block', id: cands[cands.length - 1].id, block: cands[cands.length - 1] };
  const seed = (level.seeds || []).filter((s) => pointInPolygon([poly], s, 0)).sort((a, b) => (a.id < b.id ? -1 : 1))[0];
  if (seed) return { kind: 'seed', id: seed.id, seed };
  return null;
}

const m2 = (mm2) => Math.round(mm2 / 100) / 10_000; // м², 4 знака

function roomRecord(id, src, poly, extra = {}) {
  const block = src?.block; const seed = src?.seed;
  const named = block || seed || {};
  return {
    id,
    source: src ? { kind: src.kind, id: src.id } : null,
    name: named.name ?? null,
    type: named.type ?? null,
    polygon: poly,
    areaNet: m2(area([poly])), // минус островки/колонны
    areaGross: m2(outerArea([poly])), // по внешнему контуру
    shaft: Boolean(block && blockIsShaft(block)),
    open: false,
    label: interiorPoint([poly]),
    ...extra,
  };
}

function assignIds(rooms) {
  const groups = new Map();
  for (const r of rooms) {
    const k = r.source ? r.source.id : null;
    if (!k) { r.id = `void:${Math.round(r.label.x)},${Math.round(r.label.y)}`; continue; }
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }
  for (const [k, list] of groups) {
    list.sort((a, b) => (b.areaNet - a.areaNet) || (a.label.x - b.label.x) || (a.label.y - b.label.y));
    list.forEach((r, i) => { r.id = i === 0 ? k : `${k}#${i + 1}`; });
  }
  return rooms.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

// ---------------------------------------------------------------- конвейер

function deriveLevel(project, level) {
  const settings = project.settings || {};
  const { byId: carved, issues: carveIssues } = carveLevel(level, settings);
  const real = realWallRecords(level);
  for (const w of real) w.frame = wallFrame(w);
  const virtual = blockWalls(level, settings, carved, real);
  const records = [...real, ...virtual].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const w of records) if (!w.frame) w.frame = wallFrame(w);
  const ops = resolveOpenings(level, records);
  const byWall = new Map();
  for (const o of ops.list) {
    if (!byWall.has(o.wallId)) byWall.set(o.wallId, []);
    byWall.get(o.wallId).push(o);
  }
  const bodies = wallBodies(records, byWall);
  const bounding = bodies.filter((w) => w.roomBounding !== false);
  const U = union(...bounding.map((w) => w.polygon));
  const outline = union(...bodies.filter((w) => !w.hidden).map((w) => w.cut));

  const rooms = [];
  const gaps = [];
  for (const poly of freeRegions(U)) {
    if (isGap(poly)) { gaps.push(poly); continue; }
    rooms.push(roomRecord(null, matchSource(level, carved, poly), poly));
  }
  // Открытые площадки: видимая форма минус стены и закрытые помещения.
  const closed = [...U, ...rooms.map((r) => r.polygon)];
  const cb = closed.map((p) => bbox([p]));
  for (const b of (level.blocks || []).filter(blockIsOpen).sort((p, q) => (p.id < q.id ? -1 : 1))) {
    const shape = carved[b.id].shape;
    const box = bbox(shape);
    const cut = closed.filter((_, i) => boxesOverlap(cb[i], box));
    const parts = cut.length ? difference(shape, cut) : shape;
    for (const poly of parts) {
      if (isGap(poly)) continue;
      rooms.push(roomRecord(null, { kind: 'block', id: b.id, block: b }, poly, { open: true }));
    }
  }
  assignIds(rooms);
  const issues = [...carveIssues, ...ops.issues];
  return {
    schema: 'kepler-derive/7',
    levelId: level.id,
    carved,
    walls: records.map(({ frame: _f, ...w }) => w),
    wallBodies: bodies.map(({ frame: _f, ...w }) => w),
    outline,
    rooms,
    gaps,
    openings: ops.list,
    issues,
  };
}

// Сумма чистых площадей помещений (м²): без шахт и безымянных пустот.
export function totalArea(res, { open = true } = {}) {
  let s = 0;
  for (const r of res.rooms) if (r.source && !r.shaft && (open || !r.open)) s += r.areaNet;
  return Math.round(s * 10_000) / 10_000;
}
