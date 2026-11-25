// Ворота и калитки участка. entry остаётся главным автомобильным въездом
// для старых файлов, дорожек и расчётов; все объекты хранятся в entries.
import { nearestPointOnPolyline } from './site.js';
import { pointInPolygon } from './zamer/geometry.js';

const finite = (v) => v !== null && v !== '' && Number.isFinite(Number(v));
const clamp = (v, lo, hi, fallback) => finite(v) ? Math.max(lo, Math.min(hi, Number(v))) : fallback;
export const entryTitle = (e) => e.kind === 'wicket' ? 'Калитка' : e.opening === 'sliding' ? 'Ворота раздвижные' : 'Ворота распашные';
export function siteEntries(site) {
  return Array.isArray(site?.entries) && site.entries.length ? site.entries : site?.entry ? [{ ...site.entry, id: site.entry.id || 'entry-legacy', kind: 'gate' }] : [];
}
export function normalizeSiteEntries(site) {
  const seen = new Set();
  return siteEntries(site).flatMap((e, i) => {
    if (!e || !finite(e.x) || !finite(e.y)) return [];
    let id = typeof e.id === 'string' && e.id ? e.id : `entry-${i}`;
    while (seen.has(id)) id += '-copy';
    seen.add(id);
    const kind = e.kind === 'wicket' ? 'wicket' : 'gate';
    return [{ id, kind, opening: kind === 'gate' && e.opening === 'sliding' ? 'sliding' : 'swing', x: Number(e.x), y: Number(e.y), dir: clamp(e.dir ?? e.angle, -360, 360, 0),
      width: clamp(e.width, kind === 'wicket' ? 600 : 2000, kind === 'wicket' ? 2000 : 10000, kind === 'wicket' ? 1000 : 4000),
      height: clamp(e.height, 600, 4000, 1800), wicket: kind === 'gate' && e.wicket === true,
      wicketWidth: clamp(e.wicketWidth, 600, 2000, 1000), wicketSide: e.wicketSide === 'left' ? 'left' : 'right' }];
  });
}
export function syncPrimaryEntry(site) {
  site.entry = site.entries.find((e) => e.kind !== 'wicket') || null;
}
export function ensureSiteEntries(site) {
  site.entries = normalizeSiteEntries(site);
  syncPrimaryEntry(site);
  return site.entries;
}
export function entryById(site, id) {
  return siteEntries(site).find((e) => e.id === id) || (!id ? siteEntries(site)[0] : null);
}
export function entryParts(entry) {
  const width = Number(entry.width) || (entry.kind === 'wicket' ? 1000 : 4000);
  const parts = [{ offset: 0, width, kind: entry.kind === 'wicket' ? 'wicket' : 'gate', opening: entry.opening || 'swing' }];
  if (entry.kind !== 'wicket' && entry.wicket) {
    const w = Number(entry.wicketWidth) || 1000;
    parts.push({ offset: (entry.wicketSide === 'left' ? -1 : 1) * (width / 2 + 120 + w / 2), width: w, kind: 'wicket' });
  }
  return parts;
}
export function entrySpan(entry) {
  const parts = entryParts(entry);
  return { from: Math.min(...parts.map((p) => p.offset - p.width / 2)), to: Math.max(...parts.map((p) => p.offset + p.width / 2)) };
}
// Габарит целиком помещается на стороне участка, включая боковую калитку.
export function entryAt(site, world, entry = {}) {
  if (site?.boundary?.length < 3 || !site?.boundary) return null;
  const near = nearestPointOnPolyline(site.boundary, world, true);
  if (!near) return null;
  const a = site.boundary[near.segment]; const b = site.boundary[(near.segment + 1) % site.boundary.length];
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  const dx = (b.x - a.x) / length; const dy = (b.y - a.y) / length;
  let dir = near.angle + 90;
  if (!pointInPolygon({ x: near.x - dy * 500, y: near.y + dx * 500 }, site.boundary)) dir -= 180;
  const rad = dir * Math.PI / 180;
  const tx = Math.sin(rad); const ty = -Math.cos(rad);
  const sign = tx * dx + ty * dy >= 0 ? 1 : -1;
  const span = entrySpan(entry);
  const from = sign > 0 ? span.from : -span.to;
  const to = sign > 0 ? span.to : -span.from;
  if (length < to - from + 240) return null;
  const along = Math.max(120 - from, Math.min(length - 120 - to, (near.x - a.x) * dx + (near.y - a.y) * dy));
  return { x: a.x + dx * along, y: a.y + dy * along, dir, dist: near.dist };
}
export function entryOverlaps(site, candidate, ignoreId) {
  const rad = candidate.dir * Math.PI / 180;
  const tx = Math.sin(rad); const ty = -Math.cos(rad);
  const span = entrySpan(candidate);
  return siteEntries(site).some((other) => {
    if (other.id === ignoreId) return false;
    const dx = other.x - candidate.x; const dy = other.y - candidate.y;
    if (Math.abs(dx * Math.cos(rad) + dy * Math.sin(rad)) > 200) return false;
    if (Math.abs(Math.cos((other.dir - candidate.dir) * Math.PI / 180)) < .99) return false;
    const s = entrySpan(other); const at = dx * tx + dy * ty;
    const sign = Math.cos((other.dir - candidate.dir) * Math.PI / 180) > 0 ? 1 : -1;
    const lo = at + (sign > 0 ? s.from : -s.to); const hi = at + (sign > 0 ? s.to : -s.from);
    return Math.min(span.to, hi) > Math.max(span.from, lo) - 240;
  });
}
// Геометрия для 3D/разрезов: створки и стойки без второго хранимого объекта.
export function entryLandscapeObjects(site) {
  return siteEntries(site).flatMap((e) => {
    const rad = (e.dir ?? e.angle ?? 0) * Math.PI / 180;
    const at = (offset) => ({ x: e.x + Math.sin(rad) * offset, y: e.y - Math.cos(rad) * offset });
    const parts = entryParts(e); const height = e.height || 1800;
    const common = { kind: 'gate', rotation: (e.dir ?? e.angle ?? 0) - 90, height, h: 100, variant: 'gate', siteEntryId: e.id, colors: ['#454d53', '#30383f', '#657079'] };
    const objects = [];
    for (const [i, p] of parts.entries()) {
      const n = p.kind === 'gate' && p.opening !== 'sliding' ? 2 : 1;
      for (let j = 0; j < n; j += 1) objects.push({ ...common, id: `${e.id}-leaf-${i}-${j}`, ...at(p.offset - p.width / 2 + p.width / n * (j + .5)), w: p.width / n - 35 });
      for (const side of [-1, 1]) objects.push({ ...common, id: `${e.id}-post-${i}-${side}`, entryPost: true, ...at(p.offset + side * (p.width / 2 + 60)), w: 120, h: 180, height: height + 120 });
    }
    return objects;
  });
}
