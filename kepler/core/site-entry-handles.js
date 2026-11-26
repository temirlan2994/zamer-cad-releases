// Редактирование въезда в собственных осях: dir — нормаль внутрь участка,
// касательная направлена вправо при взгляде из участка на улицу.
import { entryAt, entryOverlaps, entryParts } from './site-entries.js';

export function entryWorldPoint(entry, along, inward = 0) {
  const rad = (entry.dir ?? entry.angle ?? 0) * Math.PI / 180;
  return { x: entry.x + Math.sin(rad) * along + Math.cos(rad) * inward,
    y: entry.y - Math.cos(rad) * along + Math.sin(rad) * inward };
}

export function siteEntryHandles(entry) {
  return entryParts(entry).flatMap((part, index) => ['start', 'end'].flatMap((end) => {
    // У пристроенной калитки внутренняя стойка связана с воротами;
    // ширина растёт от неё наружу, не двигая и не меняя сами ворота.
    if (index && end !== (entry.wicketSide === 'left' ? 'start' : 'end')) return [];
    return [{ part: index, end, ...entryWorldPoint(entry, part.offset + (end === 'start' ? -1 : 1) * part.width / 2) }];
  }));
}

export function toggleEntryOpening(entry, partIndex, action) {
  const part = entryParts(entry)[partIndex];
  if (!part || (action !== 'direction' && action !== 'hinge')) return null;
  let field; let value;
  if (action === 'hinge') {
    if (part.kind !== 'wicket' || part.opening === 'sliding') return null;
    field = 'hinge'; value = part.hinge === 'right' ? 'left' : 'right';
  } else if (part.opening === 'sliding') {
    field = 'slideDirection'; value = part.slideDirection === 'left' ? 'right' : 'left';
  } else {
    field = 'swingSide'; value = part.swingSide === 'outside' ? 'inside' : 'outside';
  }
  if (partIndex) field = `wicket${field[0].toUpperCase()}${field.slice(1)}`;
  return { ...entry, [field]: value };
}

export function resizeSiteEntry(site, start, partIndex, end, point, step = 50) {
  if (!['start', 'end'].includes(end) || !Number.isFinite(point?.x) || !Number.isFinite(point?.y)) return null;
  const part = entryParts(start)[partIndex];
  if (!part) return null;
  const rad = (start.dir ?? start.angle ?? 0) * Math.PI / 180;
  const tx = Math.sin(rad); const ty = -Math.cos(rad);
  const snap = (v, min, max) => Math.max(min, Math.min(max, Math.round(v / step) * step));
  let next;
  if (partIndex) {
    const side = start.wicketSide === 'left' ? -1 : 1;
    if (end !== (side < 0 ? 'start' : 'end')) return null;
    const inner = part.offset - side * part.width / 2;
    const along = (point.x - start.x) * tx + (point.y - start.y) * ty;
    next = { ...start, wicketWidth: snap((along - inner) * side, 600, 2000) };
  } else {
    const sign = end === 'start' ? -1 : 1;
    const anchor = entryWorldPoint(start, -sign * part.width / 2);
    const width = snap(((point.x - anchor.x) * tx + (point.y - anchor.y) * ty) * sign, start.kind === 'wicket' ? 600 : 2000, start.kind === 'wicket' ? 2000 : 10000);
    next = { ...start, width, x: anchor.x + tx * sign * width / 2, y: anchor.y + ty * sign * width / 2 };
  }
  const fitted = entryAt(site, next, next);
  // Угол участка и соседние въезды ограничивают размер; неподвижный торец
  // не должен прыгать от автоматического переноса центра на соседнее ребро.
  if (!fitted || Math.hypot(fitted.x - next.x, fitted.y - next.y) > 1 || entryOverlaps(site, next, start.id)) return null;
  return next;
}
