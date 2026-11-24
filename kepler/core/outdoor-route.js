import {
  createLandscapeObject, gradedPathLevel, isGradedPath, isLevelPath, objectPath, pathSurfaceThickness,
  pointAlong, polylineLength, stairTreads, toWorld,
} from './landscape.js';
import { stairsBetween, walkingLevel } from './landscape-tools.js';
import { attachOutdoorStair, travelAnchorAt, travelHostLevel } from './outdoor-stair-links.js';
import { convexHull } from './site.js';

export const ROUTE_KINDS = [
  { id: 'auto', title: 'Авто' }, { id: 'path', title: 'Дорожка' },
  { id: 'stairs', title: 'Лестница' }, { id: 'slabs', title: 'Плиты над водой' },
];
export const ROUTE_LIMIT = 32;
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const offset = (p, u, d) => ({ x: p.x + u.x * d, y: p.y + u.y * d });
const normal = (u) => ({ x: -u.y, y: u.x });
const dot = (a, b) => a.x * b.x + a.y * b.y;
const vec = (a, b) => ({ x: b.x - a.x, y: b.y - a.y });
const lerp = (a, b, t) => a + (b - a) * t;
const groundZ = (ground, p) => Math.round(ground(p.x, p.y) - (ground.siteDatum ?? 0));
const widthOf = (x) => Math.max(500, Math.min(6000, Number(x) || 1800));

function routeNodes(points, objects, ground, tolerance) {
  return points.map((p) => {
    const snap = p.free ? null : travelAnchorAt(p, objects, tolerance);
    const point = snap?.point ?? { x: p.x, y: p.y };
    const level = p.level ?? Math.round(snap ? travelHostLevel(snap.host, point, ground) : walkingLevel(point, objects, ground, 25));
    return { ...point, level, manual: p.level != null, anchor: snap?.anchor, ground: groundZ(ground, point) };
  });
}

// У смежных участков плит одна отметка. Отмеченные вручную высоты и
// примыкания к платформам учитываем до того, как считать соседние марши.
function levelSlabs(nodes, runs, errors) {
  for (let i = 0; i < runs.length;) {
    if (runs[i].kind !== 'slabs') { i += 1; continue; }
    const first = i;
    while (runs[i]?.kind === 'slabs') i += 1;
    const group = nodes.slice(first, i + 1);
    const fixed = group.filter((n) => n.manual || n.anchor).map((n) => n.level);
    if (fixed.some((level) => level !== fixed[0])) {
      errors.push('У плит на одном уровне отметки начала и конца должны совпадать');
      continue;
    }
    const level = fixed[0] ?? Math.max(...group.map((n) => n.level)) + 120;
    group.forEach((n) => { n.level = level; });
  }
}

function cap(point, direction, width) {
  const n = normal(direction);
  return [offset(point, n, -width / 2), offset(point, n, width / 2)];
}

function turnLandings(nodes, runs, id, makeObject) {
  const landings = [];
  for (let i = 1; i < runs.length; i += 1) {
    const before = runs[i - 1]; const after = runs[i];
    if (before.kind !== 'stairs' && after.kind !== 'stairs' && before.width === after.width) continue;
    const cosine = dot(before.direction, after.direction);
    if (cosine > 0.995 && before.width === after.width) continue;
    const node = nodes[i];
    const turn = Math.sqrt((1 - cosine) / Math.max(0.1, 1 + cosine));
    const radius = Math.max(before.width, after.width) / 2;
    const trim = Math.max(250, radius * Math.min(1.5, turn));
    before.trimEnd = Math.min(before.length * 0.28, trim);
    after.trimStart = Math.min(after.length * 0.28, trim);
    const a = offset(node, before.direction, -before.trimEnd);
    const b = offset(node, after.direction, after.trimStart);
    const aCap = cap(a, before.direction, before.width);
    const bCap = cap(b, after.direction, after.width);
    const n1 = normal(before.direction); const n2 = normal(after.direction);
    const outside = n1.x * after.direction.x + n1.y * after.direction.y > 0 ? -1 : 1;
    const corner = offset(offset(node, n1, outside * before.width / 2), n2, outside * after.width / 2);
    const betweenCaps = dot(vec(a, corner), before.direction) >= -1 && dot(vec(corner, b), after.direction) >= -1;
    const outline = convexHull([...aCap, ...bCap, ...(betweenCaps ? [corner] : [])]);
    const object = makeObject('paving-area', {
      id: id + ':landing:' + i, points: outline, variant: 'concrete', color: '#666963', elev: node.level,
    });
    landings.push(object);
    before.toLanding = object; after.fromLanding = object;
  }
  return landings;
}

function stairLevelAt(o, local) {
  const y = o.h / 2 - Math.max(0, Math.min(o.h, local));
  const step = stairTreads(o).find((s) => y >= s.top - 0.01);
  return (o.elev || 0) + (step?.z ?? o.height);
}

function runLevel(run, d, ground) {
  if (d < run.trimStart) return run.start.level;
  if (d > run.length - run.trimEnd) return run.end.level;
  const along = d - run.trimStart;
  const span = Math.max(1, run.length - run.trimStart - run.trimEnd);
  if (run.object?.kind === 'stairs-out') {
    const forward = run.start.level < run.end.level;
    return stairLevelAt(run.object, (forward ? along : span - along) * run.object.h / span);
  }
  if (run.kind === 'slabs') return run.start.level;
  if (run.graded) return lerp(run.start.level, run.end.level, along / span);
  return groundZ(ground, offset(run.start, run.direction, d)) + 25;
}

function modelRun(run, ground, id, makeObject, errors) {
  const a = offset(run.start, run.direction, run.trimStart);
  const b = offset(run.end, run.direction, -run.trimEnd);
  if (run.kind === 'stairs') {
    const result = stairsBetween(a, b, {
      aLevel: run.start.level, bLevel: run.end.level, width: run.width,
      landing: run.landing, assumeRise: false, id,
    });
    if (!result.obj) { errors.push(`Участок ${run.index + 1} · ${result.error}`); return null; }
    return result.obj;
  }
  if (run.kind === 'slabs') {
    const length = distance(a, b);
    const slab = Math.min(1000, Math.floor(length));
    return makeObject('path', {
      id, points: [a, b], width: run.width, variant: 'stepping', color: '#4d5254',
      elev: run.start.level, laying: 'strict', slabL: slab, slabW: run.width, gap: 140,
      meta: { pathLevel: 'fixed', slabThickness: 120, staggerSlabs: run.stagger },
    });
  }
  const elevated = (node, p) => Math.abs(node.level - groundZ(ground, p)) >= 40;
  run.graded = run.start.manual || run.end.manual || Boolean(run.start.anchor || run.end.anchor ||
    run.fromLanding || run.toLanding) || elevated(run.start, a) || elevated(run.end, b);
  return makeObject('path', {
    id, points: [a, b], width: run.width, variant: 'pavers',
    meta: { pathLevel: run.graded ? 'graded' : 'terrain' },
    ...(run.graded ? { elev: run.start.level, elevTo: run.end.level } : {}),
  });
}

export function plotOutdoorRoute(points, { sections = [], ground, objects = [], tolerance = 0, id = 'draft-route' } = {}) {
  const nodes = routeNodes(points, objects, ground, tolerance);
  const runs = [];
  const errors = [];
  const makeObject = (kind, opts) => createLandscapeObject(kind, 0, 0, opts);
  let total = 0;
  for (let i = 1; i < nodes.length; i += 1) {
    const start = nodes[i - 1]; const end = nodes[i];
    const length = distance(start, end);
    if (length < 200) { errors.push(`Участок ${i} короче 200 мм`); continue; }
    const section = sections[i - 1] || {};
    const delta = Math.abs(start.level - end.level);
    const automatic = delta >= 250 && delta / length > 0.12 ? 'stairs' : 'path';
    const kind = ROUTE_KINDS.slice(1).some((k) => k.id === section.kind) ? section.kind : automatic;
    runs.push({
      index: i - 1, start, end, length, offset: total, kind,
      direction: offset({ x: 0, y: 0 }, vec(start, end), 1 / length), width: widthOf(section.width),
      landing: section.landing || 0, stagger: section.stagger === true, trimStart: 0, trimEnd: 0,
    });
    total += length;
  }
  if (errors.length) return { nodes, runs, total, objects: [], samples: [], errors };
  levelSlabs(nodes, runs, errors);
  const turnPads = turnLandings(nodes, runs, id, makeObject);
  const pieces = runs.map((r) => {
    r.object = modelRun(r, ground, id + ':leg:' + r.index, makeObject, errors);
    return r.object;
  }).filter(Boolean);
  for (const run of runs) {
    if (run.object?.kind !== 'stairs-out') continue;
    const linkEnd = (node, point, neighbour) => {
      const anchor = (neighbour ? travelAnchorAt(point, [neighbour], 20)?.anchor : null) || (node.manual ? null : node.anchor);
      return { point, ...(anchor ? { anchor } : { level: node.manual ? node.level : null, clearance: 25 }) };
    };
    const a = offset(run.start, run.direction, run.trimStart);
    const b = offset(run.end, run.direction, -run.trimEnd);
    attachOutdoorStair(run.object,
      linkEnd(run.start, a, run.fromLanding || runs[run.index - 1]?.object),
      linkEnd(run.end, b, run.toLanding || runs[run.index + 1]?.object));
  }
  const samples = runs.flatMap((run) => {
    const count = Math.min(100, Math.max(8, Math.ceil(run.length / 150)));
    return Array.from({ length: count + 1 }, (_, i) => {
      const d = run.length * i / count;
      return { s: run.offset + d, ground: groundZ(ground, offset(run.start, run.direction, d)), top: runLevel(run, d, ground) };
    });
  });
  return { nodes, runs, total, objects: [...pieces, ...turnPads], samples, errors };
}

function pathLampTop(o, point, ground) {
  if (o.kind === 'stairs-out') {
    return Number.isFinite(o.elev) ? stairLevelAt(o, point.s) : groundZ(ground, point) + (point.s / o.h) * o.height;
  }
  if (isLevelPath(o)) return o.elev;
  if (isGradedPath(o)) return gradedPathLevel(o, point.x, point.y);
  return groundZ(ground, point) + (o.elev || 0) + pathSurfaceThickness(o);
}

export function outdoorLights(objects, { ground, step = 2200, side = 'left', id = '' } = {}) {
  const hosts = objects.filter((o) => o.kind === 'path' || o.kind === 'stairs-out');
  const rows = side === 'both' ? [-1, 1] : [side === 'right' ? 1 : -1];
  const result = [];
  for (const o of hosts) {
    const stair = o.kind === 'stairs-out';
    const nodes = stair ? [toWorld(o, 0, o.h / 2), toWorld(o, 0, -o.h / 2)] : objectPath(o);
    const length = polylineLength(nodes);
    if (length < 300) continue;
    const count = Math.min(80, Math.max(1, Math.floor(length / Math.max(500, step))));
    const width = stair ? o.w : o.width;
    for (let i = 0; i < count; i += 1) {
      const s = (i + 0.5) * length / count;
      const p = pointAlong(nodes, s);
      const top = Math.round(pathLampTop(o, { ...p, s }, ground));
      for (const row of rows) {
        const q = offset(p, { x: -Math.sin(p.angle), y: Math.cos(p.angle) }, row * (width / 2 + 120));
        if (result.some((lamp) => distance(lamp, q) < 200) || result.length >= 160) continue;
        result.push(createLandscapeObject('lamp', q.x, q.y, {
          ...(id ? { id: id + ':lamp:' + result.length } : {}),
          w: 200, height: 340, elev: top, meta: { routeLight: true },
        }));
      }
    }
  }
  return result;
}
