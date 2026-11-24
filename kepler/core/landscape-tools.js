// Помощники ландшафта (без DOM): посадка вдоль линии, заполнение области,
// дорожка от въезда до входа, парковка у въезда, шаблоны сада.
// Все координаты — мир (участок, мм). Результат — новые объекты; запись в
// проект и история — в ui/landscape.js (одним действием).

import { toWorld } from './building.js';
import {
  createLandscapeObject, distanceToPolygon, isPathShape, landscapeDef, lineLayout, objectColors, objectOutline,
  ELEV_LIMIT, MAX_STAIR_RISE, PLATFORM_KINDS, applyStairsDrop, objectPath, pathBoards, platformTop, pointAlong, polygonArea, polylineLength, seededRandom, steppingSlabs, toWorld as landscapeWorld,
} from './landscape.js';
import { groundLevel, levelProject } from './model.js';
import { buildingFootprint } from './site-check.js';
import { deriveWalls, doorLink, openingRect } from './walls.js';
import { pointInPolygon, segmentsIntersect } from './zamer/geometry.js';

// Растения для помощников «посадить вдоль» и «заполнить».
export const PLANT_KINDS = ['tree-pine', 'tree-spruce', 'tree-birch', 'tree-oak', 'tree-fruit', 'tree-thuja', 'tree-bonsai', 'shrub-box', 'shrub-flower', 'shrub-juniper', 'grass-clump', 'boulder'];

const closedPath = (path) => [...path, path[0]];

// Snap the upper landing of an outdoor stair to the chosen side of a platform.
// Both elevations are site-datum levels. +Y in the stair's axes points downhill.
export function stairsAtPlatformEdge(platform, point, { lower = 0, ground = 0, id } = {}) {
  if (!PLATFORM_KINDS.has(platform?.kind)) return null;
  const upper = platformTop(platform, ground);
  if (!(upper > lower && upper - lower <= MAX_STAIR_RISE)) return null;
  const outline = objectOutline(platform);
  let signedArea = 0;
  let best = null;
  for (let i = 0; i < outline.length; i += 1) {
    const a = outline[i];
    const b = outline[(i + 1) % outline.length];
    signedArea += a.x * b.y - b.x * a.y;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len < 1) continue;
    const ux = dx / len;
    const uy = dy / len;
    const pos = Math.max(0, Math.min(len, (point.x - a.x) * ux + (point.y - a.y) * uy));
    const dist = Math.hypot(point.x - a.x - pos * ux, point.y - a.y - pos * uy);
    if (!best || dist < best.dist) best = { a, len, ux, uy, pos, dist };
  }
  if (!best || !signedArea) return null;
  const { a, ux, uy, len, pos } = best;
  const curved = platform.smooth || platform.kind === 'pad-round';
  if (!curved && len < 500) return null;
  const width = curved ? Math.min(1800, platform.w / 2) : Math.min(1800, len);
  const offset = curved ? pos : Math.max(width / 2, Math.min(len - width / 2, pos));
  const nx = Math.sign(signedArea) * uy;
  const ny = -Math.sign(signedArea) * ux;
  const stair = createLandscapeObject('stairs-out', 0, 0, {
    id, elev: lower, elevTo: upper, w: width,
    rotation: Math.atan2(-nx, ny) * 180 / Math.PI,
    variant: platform.variant === 'concrete' ? 'concrete' : 'stone',
  });
  stair.x = Math.round(a.x + ux * offset + nx * stair.h / 2);
  stair.y = Math.round(a.y + uy * offset + ny * stair.h / 2);
  return stair;
}

// Recognise the actual landing shared by an outdoor flight and a platform. This
// also works for saved projects that contain no explicit attachment identifier.
export function platformLevelEdit(objects, platform, ground = 0) {
  if (!PLATFORM_KINDS.has(platform?.kind) || platform.kind === 'sunken-lounge') return null;
  const level = Math.round(platformTop(platform, ground));
  const outline = objectOutline(platform);
  const stairs = objects.filter((stair) => {
    if (stair.kind !== 'stairs-out' || !Number.isFinite(stair.elev) || Math.abs(stair.elevTo - level) > 1 || !Number.isFinite(stair.elevTo)) return false;
    // Probe either side of the upper landing. A neighbouring flight whose
    // upper edge stops short or faces into the deck remains independent.
    const inside = landscapeWorld(stair, 0, -stair.h / 2 - 2);
    const outside = landscapeWorld(stair, 0, -stair.h / 2 + 2);
    return pointInPolygon(inside, outline) && !pointInPolygon(outside, outline);
  });
  const locked = platform.locked || stairs.some((stair) => stair.locked);
  return {
    platform, level, stairs,
    min: locked ? level : Math.max(-ELEV_LIMIT, ...stairs.map((stair) => stair.elev + 1)),
    max: locked ? level : Math.min(ELEV_LIMIT, ...stairs.map((stair) => stair.elev + MAX_STAIR_RISE)),
  };
}

// Changing the number of treads changes the footprint downhill. Keep the
// upper landing exactly at the platform edge through round trips and undo.
export function setPlatformLevel(edit, level) {
  if (!edit || !Number.isInteger(level) || level < edit.min || level > edit.max) return false;
  edit.platform.elev = level;
  for (const stair of edit.stairs) {
    const landing = landscapeWorld(stair, 0, -stair.h / 2);
    stair.elevTo = level;
    applyStairsDrop(stair);
    const moved = landscapeWorld(stair, 0, -stair.h / 2);
    stair.x = Math.round(stair.x + landing.x - moved.x);
    stair.y = Math.round(stair.y + landing.y - moved.y);
  }
  return true;
}

// ------------------------------------------------------------ Посадить вдоль

// Растения вдоль ломаной/контура с шагом step и отступом offset от оси.
// sides: 'left' | 'right' | 'both' | 'center'; inside — для замкнутого
// контура: отступ внутрь (сторона выбирается сама).
export function plantAlong(points, { kind, step = 3000, offset = 0, closed = false, sides = 'left', inside = false, variant } = {}) {
  if (!landscapeDef(kind) || !Array.isArray(points) || points.length < 2) return [];
  const path = closed ? closedPath(points) : points;
  const total = polylineLength(path);
  const st = Math.max(200, step);
  const count = closed ? Math.max(1, Math.floor(total / st)) : Math.floor(total / st) + 1;
  const lead = closed ? st / 2 : (total - (count - 1) * st) / 2;
  const signs = sides === 'both' ? [1, -1] : sides === 'right' ? [-1] : sides === 'center' || !offset ? [0] : [1];
  const out = [];
  for (let i = 0; i < count && out.length < 2000; i += 1) {
    const p = pointAlong(path, lead + i * st);
    const n = { x: -Math.sin(p.angle), y: Math.cos(p.angle) };
    for (const sign0 of signs) {
      let sign = sign0;
      if (inside && closed && offset) {
        const probe = { x: p.x + n.x * offset, y: p.y + n.y * offset };
        sign = pointInPolygon(probe, points) ? 1 : -1;
      }
      out.push(createLandscapeObject(kind, Math.round(p.x + n.x * offset * sign), Math.round(p.y + n.y * offset * sign), { variant }));
    }
  }
  return out;
}

// Линия-основа объекта для «посадить вдоль»: ось дорожки/ограждения или контур.
export function guideOf(obj) {
  const def = landscapeDef(obj?.kind);
  if (!isPathShape(def)) return null;
  return { points: objectPath(obj).map(({ x, y }) => ({ x, y })), closed: def.shape === 'poly' };
}

// ------------------------------------------------------------ Заполнить

// Растения в многоугольнике с густотой density (0…1): решётка с
// детерминированным разбросом, без наложения крон друг на друга и на avoid
// (многоугольники — дом, площадки) и circles ({x, y, r} — уже стоящие).
export function fillArea(polygon, { kind, density = 0.5, seed = 'fill', avoid = [], circles = [], variant, max = 1500, w } = {}) {
  const def = landscapeDef(kind);
  if (!def || !Array.isArray(polygon) || polygon.length < 3) return [];
  const d = w || Math.max(def.w, def.h);
  const k = Math.min(1, Math.max(0.05, density));
  const spacing = d * (1 + (1 - k) * 2.2);
  const rand = seededRandom(`${seed}:${kind}`);
  const xs = polygon.map((p) => p.x);
  const ys = polygon.map((p) => p.y);
  const minX = Math.min(...xs); const maxX = Math.max(...xs);
  const minY = Math.min(...ys); const maxY = Math.max(...ys);
  const taken = circles.map((c) => ({ ...c }));
  const out = [];
  for (let y = minY + spacing / 2; y < maxY; y += spacing) {
    for (let x = minX + spacing / 2; x < maxX; x += spacing) {
      if (out.length >= max) return out;
      const p = { x: x + (rand() - 0.5) * spacing * 0.8, y: y + (rand() - 0.5) * spacing * 0.8 };
      if (!pointInPolygon(p, polygon) || distanceToEdges(p, polygon) < d * 0.5) continue;
      if (avoid.some((poly) => distanceToPolygon(p, poly) < d / 2)) continue;
      if (taken.some((c) => Math.hypot(c.x - p.x, c.y - p.y) < c.r + d * 0.47)) continue;
      const obj = createLandscapeObject(kind, Math.round(p.x), Math.round(p.y), { variant, ...(w ? { w, h: w } : {}) });
      out.push(obj);
      taken.push({ x: p.x, y: p.y, r: d / 2 });
    }
  }
  return out;
}

function distanceToEdges(p, polygon) {
  let best = Infinity;
  for (let i = 0; i < polygon.length; i += 1) {
    const a = polygon[i]; const b = polygon[(i + 1) % polygon.length];
    const dx = b.x - a.x; const dy = b.y - a.y;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
    best = Math.min(best, Math.hypot(a.x + dx * t - p.x, a.y + dy * t - p.y));
  }
  return best;
}

// ------------------------------------------------------------ Дом и двери

export function houseFootprints(project) {
  return buildingFootprint(project).map((f) => f.corners);
}

// Наружные двери нижнего этажа (мир): { x, y } — середина проёма снаружи,
// { nx, ny } — наружу от дома.
export function exteriorDoors(project) {
  const lp = project.levels?.length ? levelProject(project, groundLevel(project).id) : project;
  const walls = deriveWalls(lp);
  const out = [];
  for (const op of lp.openings || []) {
    if (op.kind !== 'door') continue;
    const link = doorLink(lp, op, walls);
    if (!link || !link.includes('outside')) continue;
    const placed = openingRect(lp, op, walls);
    if (!placed) continue;
    const { rect, wall } = placed;
    const room = lp.rooms.find((r) => r.id === op.roomId);
    const c = { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
    let n;
    if (wall.orient === 'h') n = { x: 0, y: room && room.y + room.h / 2 > c.y ? -1 : 1 };
    else n = { x: room && room.x + room.w / 2 > c.x ? -1 : 1, y: 0 };
    const half = (wall.orient === 'h' ? rect.h : rect.w) / 2;
    const outside = { x: c.x + n.x * (half + 50), y: c.y + n.y * (half + 50) };
    const ahead = { x: outside.x + n.x * 1000, y: outside.y + n.y * 1000 };
    const p = toWorld(project.building, outside);
    const q = toWorld(project.building, ahead);
    const len = Math.hypot(q.x - p.x, q.y - p.y) || 1;
    out.push({ id: op.id, x: p.x, y: p.y, nx: (q.x - p.x) / len, ny: (q.y - p.y) / len, width: op.width });
  }
  return out;
}

const segHitsPolys = (a, b, polys) => polys.some((poly) => {
  for (let i = 0; i < poly.length; i += 1) {
    if (segmentsIntersect(a, b, poly[i], poly[(i + 1) % poly.length])) return true;
  }
  return pointInPolygon({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, poly);
});

// Убрать совпадающие и лежащие на одной прямой промежуточные точки.
export function simplifyPoints(pts, tol = 30) {
  const out = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (last && Math.hypot(last.x - p.x, last.y - p.y) < tol) continue;
    out.push({ x: Math.round(p.x), y: Math.round(p.y) });
  }
  for (let i = out.length - 2; i >= 1; i -= 1) {
    const a = out[i - 1]; const b = out[i]; const c = out[i + 1];
    const cross = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    const len = Math.hypot(c.x - a.x, c.y - a.y) || 1;
    if (Math.abs(cross) / len < tol) out.splice(i, 1);
  }
  return out;
}

// Дорожка от въезда (site.entry) до ближайшей наружной двери: ортогональная
// ломаная в обход пятна дома или короткая изогнутая (curved — сглаженная).
// Возвращает { obj } или { error }.
export function entryPathObject(project, { variant = 'pavers', width = 1200, curved = false } = {}) {
  const site = project.site || {};
  if (!site.entry) return { error: 'Нет въезда: поставьте его в режиме «Участок»' };
  const doors = exteriorDoors(project);
  if (!doors.length) return { error: 'В доме нет наружной двери' };
  const e = site.entry;
  const rad = ((e.dir || 0) * Math.PI) / 180;
  const d = { x: Math.cos(rad), y: Math.sin(rad) };
  const door = doors.reduce((best, x) => (Math.hypot(x.x - e.x, x.y - e.y) < Math.hypot(best.x - e.x, best.y - e.y) ? x : best));
  const polys = houseFootprints(project);
  const start = { x: e.x, y: e.y };
  const s = { x: e.x + d.x * 1500, y: e.y + d.y * 1500 };
  const t = { x: door.x + door.nx * 1500, y: door.y + door.ny * 1500 };
  const end = { x: door.x, y: door.y };
  let pts;
  if (curved) {
    pts = [start, s, t, end];
  } else {
    // Два варианта «Г» между s и t; берём тот, что не режет дом.
    const options = [{ x: s.x, y: t.y }, { x: t.x, y: s.y }].map((c) => [start, s, c, t, end]);
    const clear = (route) => route.slice(0, -2).every((p, i) => !segHitsPolys(p, route[i + 1], polys));
    pts = options.find(clear) || options[0];
  }
  pts = simplifyPoints(pts);
  if (pts.length < 2) return { error: 'Вход слишком близко к въезду' };
  const obj = createLandscapeObject('path', 0, 0, { points: pts, width, variant, smooth: curved && pts.length >= 3 });
  return { obj, door };
}

// ------------------------------------------------------------ Парковка

// N мест (parking-1) рядом с въездом: ряд поперёк въезда, сбоку от проезда,
// внутри участка и не на доме. Возвращает [] без въезда.
export function parkingAtEntry(project, n = 2) {
  const site = project.site || {};
  const e = site.entry;
  if (!e) return [];
  const def = landscapeDef('parking-1');
  const count = Math.max(1, Math.min(12, Math.round(n)));
  const rad = ((e.dir || 0) * Math.PI) / 180;
  const d = { x: Math.cos(rad), y: Math.sin(rad) };
  const tdir = { x: -d.y, y: d.x };
  const rotation = (((e.dir || 0) - 90) % 360 + 360) % 360;
  const rowW = count * def.w;
  const polys = houseFootprints(project);
  const make = (side) => {
    const off = side ? (rowW / 2 + 1800) * side : 0;
    const cx = e.x + d.x * (def.h / 2 + 400) + tdir.x * off;
    const cy = e.y + d.y * (def.h / 2 + 400) + tdir.y * off;
    return Array.from({ length: count }, (_, i) => {
      const k = (i - (count - 1) / 2) * def.w;
      return createLandscapeObject('parking-1', Math.round(cx + tdir.x * k), Math.round(cy + tdir.y * k), { rotation });
    });
  };
  const fits = (list) => list.every((o) => objectOutline(o).every((p) => (!site.boundary || site.boundary.length < 3 || pointInPolygon(p, site.boundary))
    && !polys.some((poly) => pointInPolygon(p, poly))));
  for (const side of [1, -1, 0]) {
    const list = make(side);
    if (fits(list)) return list;
  }
  return make(1);
}

// ------------------------------------------------------------ Шаблоны сада

export const GARDEN_TEMPLATES = [
  { id: 'japanese', title: 'Японский сад', hint: 'валуны, белый гравий, бонсай, шары, туи, дорожка из плит-ступеней' },
  { id: 'pine', title: 'Сосновый участок', hint: 'сосны вразброс, мох, деревянная изогнутая дорожка, яма для костра' },
  { id: 'family', title: 'Семейный двор', hint: 'терраса, бассейн, парковка на 2 места, газон, сад, детская площадка, грядки' },
];

// Расстановщик: объект встаёт в первую подходящую точку (по убыванию
// оценки): внутри участка, не ближе margin к дому, без наложений.
function makePlacer(boundary, footprints, margin = 600) {
  const outlines = [];
  const xs = boundary.map((p) => p.x);
  const ys = boundary.map((p) => p.y);
  const box = { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
  const area = (box.maxX - box.minX) * (box.maxY - box.minY);
  const step = Math.max(500, Math.sqrt(area / 2500));
  const candidates = [];
  for (let y = box.minY + step / 2; y < box.maxY; y += step) {
    for (let x = box.minX + step / 2; x < box.maxX; x += step) {
      if (pointInPolygon({ x, y }, boundary)) candidates.push({ x: Math.round(x), y: Math.round(y) });
    }
  }
  const overlaps = (a, b) => a.some((p) => pointInPolygon(p, b)) || b.some((p) => pointInPolygon(p, a));
  const fits = (obj) => {
    const out = objectOutline(obj, 12);
    if (!out.every((p) => pointInPolygon(p, boundary))) return false;
    if (footprints.some((f) => overlaps(out, f) || out.some((p) => distanceToPolygon(p, f) < margin))) return false;
    return !outlines.some((o) => overlaps(out, o));
  };
  return {
    box,
    reserve(obj) { outlines.push(objectOutline(obj, 12)); },
    place(kind, opts = {}, score = () => 0) {
      const ranked = candidates.map((c) => ({ c, s: score(c) })).sort((a, b) => b.s - a.s);
      for (const { c } of ranked) {
        for (const rotation of opts.rotations || [opts.rotation || 0]) {
          const obj = createLandscapeObject(kind, c.x, c.y, { ...opts, rotation });
          if (fits(obj)) { outlines.push(objectOutline(obj, 12)); return obj; }
        }
      }
      return null;
    },
    outlines,
  };
}

// Неровный контур (пятно) вокруг центра: n вершин, радиусы rx, ry.
function blob(cx, cy, rx, ry, rand, n = 9) {
  return Array.from({ length: n }, (_, i) => {
    const t = (i / n) * Math.PI * 2;
    const k = 0.82 + rand() * 0.3;
    return { x: Math.round(cx + Math.cos(t) * rx * k), y: Math.round(cy + Math.sin(t) * ry * k) };
  });
}

// Композиция по шаблону: список объектов (мир) для участка с домом.
// Требуется граница участка; въезд и двери — по возможности.
export function composeGarden(project, templateId) {
  const site = project.site || {};
  const boundary = site.boundary;
  if (!Array.isArray(boundary) || boundary.length < 3) return { error: 'Нужна граница участка (режим «Участок»)' };
  const tpl = GARDEN_TEMPLATES.find((t) => t.id === templateId);
  if (!tpl) return { error: 'Нет такого шаблона' };
  const footprints = houseFootprints(project);
  const placer = makePlacer(boundary, footprints);
  const rand = seededRandom(`garden:${templateId}`);
  const objects = [];
  const add = (obj) => { if (obj) objects.push(obj); return obj; };
  const house = footprints.flat();
  const hc = house.length
    ? { x: house.reduce((s, p) => s + p.x, 0) / house.length, y: house.reduce((s, p) => s + p.y, 0) / house.length }
    : { x: (placer.box.minX + placer.box.maxX) / 2, y: (placer.box.minY + placer.box.maxY) / 2 };
  const entry = site.entry || null;
  const distHouse = (c) => (footprints.length ? Math.min(...footprints.map((f) => distanceToPolygon(c, f))) : Math.hypot(c.x - hc.x, c.y - hc.y));
  const distEntry = (c) => (entry ? Math.hypot(c.x - entry.x, c.y - entry.y) : 0);
  const near = (c) => -distHouse(c);
  const far = (c) => distHouse(c) + distEntry(c) * 0.5;
  const nearTo = (o, k = 1) => (c) => -Math.hypot(c.x - o.x, c.y - o.y) * k;

  // Дорожка от въезда до входа (если есть оба) — резерв полосы.
  const pathStyle = { japanese: ['stepping', 900, true], pine: ['deck', 1100, true], family: ['pavers', 1400, false] }[templateId];
  const route = entryPathObject(project, { variant: pathStyle[0], width: pathStyle[1], curved: pathStyle[2] });
  if (route.obj) { add(route.obj); placer.reserve(route.obj); }

  if (templateId === 'japanese') {
    add(createLandscapeObject('lawn-area', 0, 0, { variant: 'moss', points: boundary }));
    // Сухой сад: место под гравий — самое большое из 7 / 5,5 / 4 м, что встаёт.
    let spot = null;
    let size = 0;
    for (const w of [7000, 5500, 4000]) {
      spot = placer.place('pad-round', { w }, (c) => far(c) * 0.3 + near(c) * 0.7 + (distHouse(c) > 2500 ? 1e6 : 0));
      if (spot) { size = w; break; }
    }
    const center = spot ? { x: spot.x, y: spot.y } : hc;
    if (spot) {
      placer.outlines.pop(); // площадка — только разметка места под гравий
      const k = size / 7000;
      const gravel = add(createLandscapeObject('gravel-area', 0, 0, { variant: 'white', smooth: true, points: blob(center.x, center.y, 3000 * k, 2600 * k, rand) }));
      placer.reserve(gravel);
      const rocks = [[-1200, -500, 'trio'], [1300, 600, 'one'], [200, 1300, 'one']];
      for (const [dx, dy, variant] of rocks) {
        add(createLandscapeObject('boulder', center.x + dx * k, center.y + dy * k, { variant, rotation: Math.round(rand() * 60) }));
      }
    }
    add(placer.place('tree-bonsai', {}, nearTo(center)));
    add(placer.place('tree-bonsai', { variant: 'cloud' }, (c) => nearTo(center)(c) - Math.abs(distHouse(c) - 3000)));
    for (let i = 0; i < 6; i += 1) add(placer.place('shrub-box', { w: 800 + Math.round(rand() * 500) }, (c) => nearTo(center)(c) + rand() * 2500));
    add(placer.place('pond', { w: 3200, h: 2000 }, (c) => nearTo(center)(c) * 0.6 + rand() * 1500));
    for (const o of plantAlong(boundary, { kind: 'tree-thuja', step: 3200, offset: 900, closed: true, inside: true })) {
      if (!fitsLoose(o, footprints) || placer.outlines.some((poly) => pointInPolygon(o, poly))) continue;
      add(o);
    }
    add(placer.place('lamp', {}, (c) => (route.obj ? -distanceToPolygon(c, objectOutline(route.obj)) : 0)));
    add(placer.place('bench', {}, nearTo(center)));
  } else if (templateId === 'pine') {
    add(createLandscapeObject('lawn-area', 0, 0, { variant: 'moss', points: boundary }));
    const pit = add(placer.place('firepit', {}, (c) => far(c) - Math.abs(distHouse(c) - 8000)));
    if (pit) {
      add(placer.place('bench', { rotation: 0 }, nearTo({ x: pit.x + 4000, y: pit.y })));
      add(placer.place('bench', { rotation: 90 }, nearTo({ x: pit.x, y: pit.y + 4000 })));
    }
    add(placer.place('gazebo', {}, (c) => near(c) + (distHouse(c) > 3000 ? 1e5 : 0) + rand() * 2000));
    const circles = objects.filter((o) => !isPathShape(landscapeDef(o.kind))).map((o) => ({ x: o.x, y: o.y, r: Math.max(o.w, o.h) / 2 + 600 }));
    const avoid = [...footprints.map((f) => inflate(f, 1500)), ...placer.outlines];
    for (const o of fillArea(boundary, { kind: 'tree-pine', density: 0.8, seed: 'pine', avoid, circles, w: 3200 })) add(o);
    for (const o of fillArea(boundary, { kind: 'tree-pine', density: 0.3, seed: 'pine-mugo', avoid, variant: 'mugo', w: 1800, circles: objects.map((o) => ({ x: o.x, y: o.y, r: Math.max(o.w, o.h) / 2 })), max: 10 })) add(o);
    for (const o of fillArea(boundary, { kind: 'shrub-juniper', density: 0.12, seed: 'juniper', avoid: [...avoid], circles: objects.map((o) => ({ x: o.x, y: o.y, r: Math.max(o.w, o.h) / 2 })) })) add(o);
    for (const o of fillArea(boundary, { kind: 'boulder', density: 0.08, seed: 'stones', avoid: [...avoid], circles: objects.map((o) => ({ x: o.x, y: o.y, r: Math.max(o.w, o.h) / 2 })), max: 6 })) add(o);
  } else if (templateId === 'family') {
    add(createLandscapeObject('lawn-area', 0, 0, { variant: 'mown', points: boundary }));
    for (const o of parkingAtEntry(project, 2)) { add(o); placer.reserve(o); }
    // Терраса у дома со стороны, противоположной въезду, рядом — бассейн.
    const terrace = placer.place('terrace-deck', { w: 6000, h: 3500, rotations: [0, 90] }, (c) => near(c) * 2 + distEntry(c));
    if (terrace) add(terrace);
    const anchor = terrace || hc;
    const pool = placer.place('pool', { w: 7000, h: 4200, variant: 'loungers', rotations: [0, 90] }, (c) => nearTo(anchor)(c) + (distHouse(c) > 4000 ? 1e5 : 0));
    add(pool);
    add(placer.place('playground', { w: 5000, h: 4000 }, (c) => far(c) + rand() * 1000));
    add(placer.place('vegbeds', { rotations: [0, 90] }, (c) => far(c) * 0.5 + distEntry(c)));
    add(placer.place('greenhouse', { rotations: [0, 90] }, (c) => far(c) * 0.4 + distEntry(c)));
    add(placer.place('bbq-zone', {}, nearTo(anchor, 0.8)));
    const circles = objects.filter((o) => !isPathShape(landscapeDef(o.kind)) && o.kind !== 'lawn-area').map((o) => ({ x: o.x, y: o.y, r: Math.max(o.w, o.h) / 2 }));
    const avoid = [...footprints.map((f) => inflate(f, 2000)), ...placer.outlines];
    for (const o of fillArea(boundary, { kind: 'tree-fruit', density: 0.6, seed: 'fruit', avoid, circles, max: 8, w: 3200 })) add(o);
    const varieties = ['apple', 'pear', 'cherry', 'apricot'];
    objects.filter((o) => o.kind === 'tree-fruit').forEach((o, i) => { o.variant = varieties[i % varieties.length]; });
    for (const o of plantAlong(boundary, { kind: 'tree-thuja', step: 3500, offset: 900, closed: true, inside: true })) {
      if (!fitsLoose(o, footprints) || placer.outlines.some((poly) => pointInPolygon(o, poly))) continue;
      add(o);
    }
  }
  return { objects: objects.filter(Boolean), title: tpl.title };
}

// Растение не на доме и не вплотную к нему.
function fitsLoose(o, footprints) {
  return !footprints.some((f) => distanceToPolygon(o, f) < Math.max(o.w, o.h) / 2 + 500);
}

// Расширить выпуклый многоугольник на d (по центру масс — приближённо).
function inflate(poly, d) {
  const cx = poly.reduce((s, p) => s + p.x, 0) / poly.length;
  const cy = poly.reduce((s, p) => s + p.y, 0) / poly.length;
  return poly.map((p) => {
    const len = Math.hypot(p.x - cx, p.y - cy) || 1;
    return { x: p.x + ((p.x - cx) / len) * d * Math.SQRT2, y: p.y + ((p.y - cy) / len) * d * Math.SQRT2 };
  });
}

// ------------------------------------------------------------ Разорвать

// Можно ли «разорвать» объект (дорожку) на отдельные элементы.
export const canExplode = (o) => o?.kind === 'path' && Array.isArray(o.points) && o.points.length >= 2;

// Сплошные материалы дорожки → площадной тип и вариант.
const AREA_OF = { pavers: ['paving-area', 'pavers'], concrete: ['paving-area', 'concrete'], gravel: ['gravel-area', 'gravel'] };

const deg = (rad) => ((((rad * 180) / Math.PI) % 360) + 360) % 360;

// «Разорвать» (как EXPLODE): дорожка → набор самостоятельных объектов.
// Плиты-ступени — плиты `slab`, настил — доски `board` (подрезанные у
// стыков — куски настила `deck-area`), брусчатка/бетон/гравий — площадные
// контуры по участкам и углам. Тон и цвет сохраняются (поле color).
// Результат: { objects, kind: 'slab' | 'board' | 'area' } или null.
export function explodePath(o) {
  if (!canExplode(o)) return null;
  const colors = objectColors(o);
  const height = o.height || 0;
  const round = (p) => ({ x: Math.round(p.x), y: Math.round(p.y) });
  if (o.variant === 'stepping') {
    const objects = steppingSlabs(o).map((s) => createLandscapeObject('slab', s.x, s.y, {
      w: s.along, h: s.across, rotation: deg(s.angle), color: colors[s.ci ?? 0], height: 40,
    }));
    return { objects, kind: 'slab' };
  }
  if (o.variant === 'deck') {
    const objects = pathBoards(o).map((b) => (b.poly
      ? createLandscapeObject('deck-area', 0, 0, { points: b.poly.map(round), color: colors[b.ci ?? 0], height: 40 })
      : createLandscapeObject('board', b.x, b.y, { w: b.along, h: b.across, rotation: deg(b.angle), color: colors[b.ci ?? 0], height: 40 })));
    return { objects, kind: 'board' };
  }
  const [kind, variant] = AREA_OF[o.variant] || AREA_OF.pavers;
  const objects = lineLayout(o).pieces
    .map((pc) => pc.poly.map(round))
    .filter((poly) => poly.length >= 3 && polygonArea(poly) > 100)
    .map((poly) => createLandscapeObject(kind, 0, 0, { points: poly, variant, height, ...(o.color ? { color: o.color } : {}) }));
  return { objects, kind: 'area' };
}
