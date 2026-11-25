import {
  PLATFORM_KINDS, gradedPathLevel, isGradedPath, isLevelPath, objectOutline, objectPath,
  pathSurfaceThickness, platformTop,
} from './landscape.js';
import { stairsBetween } from './landscape-tools.js';

const isPlatform = (o) => PLATFORM_KINDS.has(o.kind) && o.kind !== 'sunken-lounge';
const outline = (o) => o.kind === 'path' ? objectPath(o) : objectOutline(o);
const interpolate = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

export function travelHostLevel(o, point, ground) {
  const datum = ground.siteDatum ?? 0;
  if (isPlatform(o)) return platformTop(o, ground(o.x, o.y) - datum);
  if (isLevelPath(o)) return o.elev;
  if (isGradedPath(o)) return gradedPathLevel(o, point.x, point.y);
  return ground(point.x, point.y) - datum + (o.elev || 0) + pathSurfaceThickness(o);
}

// Площадка цепляется за кромку, дорожка — за ось. Храним индекс звена
// и долю длины, поэтому привязка следует за сдвигом, поворотом и размером.
export function travelAnchorAt(point, objects, tolerance) {
  let best = null;
  for (const o of objects) {
    if (!isPlatform(o) && o.kind !== 'path') continue;
    const pts = outline(o);
    const edges = o.kind === 'path' ? pts.length - 1 : pts.length;
    for (let edge = 0; edge < edges; edge += 1) {
      const a = pts[edge]; const b = pts[(edge + 1) % pts.length];
      const dx = b.x - a.x; const dy = b.y - a.y;
      const length2 = dx * dx + dy * dy;
      if (!length2) continue;
      const t = Math.min(1, Math.max(0, ((point.x - a.x) * dx + (point.y - a.y) * dy) / length2));
      const p = interpolate(a, b, t);
      const distance = Math.hypot(point.x - p.x, point.y - p.y);
      if (distance > tolerance || (best && distance >= best.distance)) continue;
      best = { point: p, host: o, anchor: { id: o.id, edge, t }, distance };
    }
  }
  return best;
}

const stairRevision = (o) => [o.x, o.y, o.w, o.h, o.rotation, o.elev, o.elevTo, o.meta.steps, o.meta.tread, o.meta.landing || 0].join('|');

export function attachOutdoorStair(obj, a, b) {
  if (!a.anchor && !b.anchor) return;
  obj.meta.stairLinks = { ends: [a, b], revision: stairRevision(obj) };
}

function resolveEnd(end, objects, ground) {
  if (!end?.point || !Number.isFinite(end.point.x) || !Number.isFinite(end.point.y)) return null;
  if (!end.anchor) return {
    point: end.point,
    level: end.level ?? ground(end.point.x, end.point.y) - (ground.siteDatum ?? 0) + (Number(end.clearance) || 0),
  };
  const host = objects.get(end.anchor.id);
  if (!host || (!isPlatform(host) && host.kind !== 'path')) return null;
  const pts = outline(host);
  const edge = end.anchor.edge;
  const t = end.anchor.t;
  if (!Number.isInteger(edge) || !Number.isFinite(t) || edge < 0 || edge >= pts.length - Number(host.kind === 'path')) return null;
  const point = interpolate(pts[edge], pts[(edge + 1) % pts.length], Math.max(0, Math.min(1, t)));
  return { point, level: travelHostLevel(host, point, ground) };
}

export function syncOutdoorStairs(list, ground) {
  const objects = new Map(list.map((o) => [o.id, o]));
  let invalid = 0;
  for (const o of list) {
    const link = o.kind === 'stairs-out' ? o.meta?.stairLinks : null;
    if (!link || o.locked) continue;
    // Прямой перенос или изменение геометрии лестницы отвязывает её.
    if (link.revision !== stairRevision(o)) { delete o.meta.stairLinks; continue; }
    const resolved = link.ends?.map((end) => resolveEnd(end, objects, ground));
    if (resolved?.length !== 2 || resolved.some((end) => !end)) { delete o.meta.stairLinks; continue; }
    const [a, b] = resolved;
    const { obj } = stairsBetween(a.point, b.point, {
      aLevel: a.level, bLevel: b.level, width: o.w, variant: o.variant,
      landing: o.meta.landing, assumeRise: false, id: o.id,
    });
    if (!obj) { invalid += 1; continue; }
    const meta = { ...obj.meta, cheeks: o.meta.cheeks, cheekW: o.meta.cheekW, stairLinks: link };
    Object.assign(o, obj, { meta });
    link.revision = stairRevision(o);
  }
  return invalid;
}
