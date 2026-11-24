// A double-height space is a real opening in the floor above. Slab, room area,
// section and floor meshes all read the same contour. Its guard follows the
// current walkable gallery, including after editing the opening upstairs.
import { furnitureDef, isOpenRoom, isShaft } from './catalog.js';
import { area, bbox, boxesOverlap, difference, intersection, pointInPolygon, rectRing, transform } from './geom/index.js';
import { massBox } from './masses.js';
import { levelProject, sortedLevels } from './model.js';
import { eatersOf, nestedOuterRect } from './rooms.js';
import { roomPolygon } from './room-shape.js';
import { createSlabOpening, setSlabOpeningPolygon, setSlabOpeningRect, SLAB_OPENING_MIN, slabOpeningPolygon, slabOpenings, stairTargetLevel } from './slab-openings.js';
import { stairLayout, stairToPlan } from './stairs.js';
import { nextWindowSpan, setWindowSpan } from './spanning-windows.js';
import { deriveWalls, openingOwnerId, openingRect } from './walls.js';

const rectPolygon = (r) => rectRing(r.x, r.y, r.w, r.h);
const overlaps = (a, b) => boxesOverlap(bbox(a), bbox(b)) && intersection(a, b).length > 0;
const contains = (outer, inner) => area(outer) >= area(inner) - 1 && !difference(inner, outer).length;
const closed = (room) => !isShaft(room) && !isOpenRoom(room);
const edges = (ring) => ring.map((a, i) => ({ a, b: ring[(i + 1) % ring.length] }));

// Common portion of two collinear edges, returned in the direction of edge AB.
function sharedEdge({ a, b }, { a: c, b: d }) {
  const dx = b.x - a.x; const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len < 1) return null;
  const x = dx / len; const y = dy / len;
  const distance = (p) => Math.abs((p.x - a.x) * y - (p.y - a.y) * x);
  if (distance(c) > 0.6 || distance(d) > 0.6) return null;
  const project = (p) => (p.x - a.x) * x + (p.y - a.y) * y;
  const s = project(c); const t = project(d);
  const lo = Math.max(0, Math.min(s, t)); const hi = Math.min(len, Math.max(s, t));
  if (hi - lo < 1) return null;
  const at = (u) => ({ x: a.x + x * u, y: a.y + y * u });
  return { a: at(lo), b: at(hi) };
}

function galleryEdges(polygon, upperRoom, neighbours) {
  const bounds = bbox(polygon);
  const cuts = neighbours.filter((ring) => boxesOverlap(bounds, bbox(ring)));
  const walkable = difference(roomPolygon(upperRoom), polygon, ...cuts);
  const boundary = walkable.flatMap((poly) => poly.flatMap(edges));
  return edges(polygon).flatMap((edge) => boundary.map((side) => sharedEdge(edge, side)).filter(Boolean));
}

function roomExclusions(lp, room, floorZ) {
  const rooms = [...eatersOf(lp, room), ...lp.rooms.filter((r) => !r.parentId && isShaft(r))].map(roomPolygon);
  for (const child of lp.rooms.filter((r) => r.parentId === room.id)) {
    rooms.push(rectPolygon(nestedOuterRect(child, lp.settings?.partition)));
  }
  const voids = (lp.massVoids || []).map(massBox).filter((b) => b.z0 <= floorZ + 2 && b.z1 >= floorZ - 0.5);
  return [...rooms, ...voids.map((b) => rectRing(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0))];
}

function manualWallRings(walls) {
  return walls.filter((w) => w.kind === 'manual' && !w.hidden)
    .flatMap((w) => w.polys || (w.band ? [rectPolygon(w.band)] : []));
}

// Leave a passage only where the last tread actually reaches the opening edge
// from within the void and the stair lands at this particular floor elevation.
function stairExit(project, level, opening, polygon) {
  if (!opening.stairId) return null;
  const lower = project.levels.find((l) => l.id === opening.fromLevelId);
  const stair = lower?.items.find((it) => it.kind === 'stairs' && it.id === opening.stairId);
  if (!stair || stairTargetLevel(project, stair, lower)?.id !== level.id) return null;
  const layout = stairLayout(stair, lower.height);
  if (Math.abs(layout.floorH - (level.elevation - lower.elevation)) > 1) return null;
  const { end, dir } = layout.flights.at(-1);
  const behind = stairToPlan(stair, { x: end.x - dir.x * 2, y: end.y - dir.y * 2 });
  const ahead = stairToPlan(stair, { x: end.x + dir.x * 2, y: end.y + dir.y * 2 });
  if (!pointInPolygon(polygon, behind, 0.1) || pointInPolygon(polygon, ahead, 0.1)) return null;
  const half = layout.fw / 2;
  return {
    a: stairToPlan(stair, { x: end.x - dir.y * half, y: end.y + dir.x * half }),
    b: stairToPlan(stair, { x: end.x + dir.y * half, y: end.y - dir.x * half }),
  };
}

function keepOutsideExit(edge, exit) {
  const gap = sharedEdge(edge, exit);
  if (!gap) return [edge];
  return [{ a: edge.a, b: gap.a }, { a: gap.b, b: edge.b }]
    .filter(({ a, b }) => Math.hypot(a.x - b.x, a.y - b.y) >= 1);
}

const railCache = new WeakMap();

export function atriumRails(project, levelId, opening, holes, preparedWalls) {
  if (!opening.atrium?.railing) return [];
  const level = project.levels.find((l) => l.id === levelId);
  const host = level?.rooms.find((r) => r.id === opening.atrium.upperRoomId);
  if (!host) return [];
  const lp = project.activeLevel === levelId ? project : levelProject(project, levelId);
  const others = (holes || slabOpenings(project, levelId)).filter((o) => o.id !== opening.id);
  const polygon = slabOpeningPolygon(opening);
  const excluded = [...others.map(slabOpeningPolygon), ...roomExclusions(lp, host, level.elevation)];
  if (level.walls?.length) excluded.push(...manualWallRings(preparedWalls || deriveWalls(lp)));
  // Rendering a plan repeatedly during pan/zoom must not re-clip the polygons.
  const record = level.slabOpenings.find((o) => o.id === opening.id);
  const exit = stairExit(project, level, opening, polygon);
  const key = JSON.stringify([polygon, roomPolygon(host), excluded, exit]);
  const previous = railCache.get(record);
  if (previous?.key === key) return previous.rails;
  const gallery = galleryEdges(polygon, host, excluded);
  const rails = exit ? gallery.flatMap((edge) => keepOutsideExit(edge, exit)) : gallery;
  if (record) railCache.set(record, { key, rails });
  return rails;
}

// A window can grow only where its whole width borders this particular void.
// This also accommodates a window hosted on an aligned manual facade wall.
function openingEdge(placed, polygon, fullWidth) {
  const sides = edges(rectPolygon(placed.rect)).filter(({ a, b }) =>
    placed.wall.orient === 'h' ? a.y === b.y : a.x === b.x);
  return edges(polygon).some((edge) => sides.some((side) => {
    const common = sharedEdge(edge, side);
    return common && (!fullWidth || Math.hypot(common.b.x - common.a.x, common.b.y - common.a.y) >= fullWidth - 1);
  }));
}

function geometryPreview(project, levelId, roomId, polygon, excludedId, railing) {
  const levels = sortedLevels(project);
  const idx = levels.findIndex((level) => level.id === levelId);
  const lower = levels[idx];
  const upper = idx < 0 ? null : levels[idx + 1];
  const room = lower?.rooms.find((r) => r.id === roomId);
  const result = { ok: false, reason: '', polygon, area: area(polygon), rails: [], windows: [], upperLevelId: upper?.id ?? null };
  const fail = (reason) => ({ ...result, reason });
  if (!room || !closed(room)) return fail('Выберите закрытое помещение на нижнем этаже.');
  if (!upper || upper.elevation <= lower.elevation) return fail('Добавьте этаж выше и разместите над этой зоной помещение.');
  const b = bbox(polygon);
  if (result.area < 1 || b.x1 - b.x0 < SLAB_OPENING_MIN || b.y1 - b.y0 < SLAB_OPENING_MIN) {
    return fail('Ширина и глубина проёма должны быть хотя бы 300 мм.');
  }
  if (!contains(roomPolygon(room), polygon)) return fail('Разместите проём внутри выбранного помещения.');
  const low = levelProject(project, levelId);
  if (roomExclusions(low, room, lower.elevation).some((obstacle) => overlaps(polygon, obstacle))) {
    return fail('Разместите проём над свободной частью комнаты, вне шахт и вложенных помещений.');
  }
  // Prefer the innermost containing room. A void must not cut a partition
  // between two rooms or the floor of a shaft or open terrace.
  const hosts = upper.rooms.filter((r) => closed(r) && r.x <= b.x0 && r.y <= b.y0 &&
    r.x + r.w >= b.x1 && r.y + r.h >= b.y1 && contains(roomPolygon(r), polygon));
  const host = hosts.sort((a, c) => area(roomPolygon(a)) - area(roomPolygon(c)))[0];
  if (!host) return fail('Разместите проём под одним закрытым помещением верхнего этажа.');
  result.upperRoomId = host.id;
  const up = levelProject(project, upper.id);
  const excluded = roomExclusions(up, host, upper.elevation);
  if (excluded.some((obstacle) => overlaps(polygon, obstacle))) {
    return fail('Здесь проходит шахта, полая масса или другое помещение верхнего этажа.');
  }
  const others = slabOpenings(project, upper.id).filter((o) => o.id !== excludedId);
  const holes = others.map(slabOpeningPolygon);
  if (holes.some((hole) => overlaps(polygon, hole))) return fail('Здесь уже есть проём в перекрытии. Выберите свободное место.');
  const item = upper.items.find((it) => {
    const footprint = transform(rectRing(-it.w / 2, -it.h / 2, it.w, it.h), it);
    return overlaps(polygon, footprint);
  });
  if (item) return fail(`На верхнем этаже здесь стоит «${furnitureDef(item.kind)?.title || item.kind}». Передвиньте предмет или проём.`);
  const walls = upper.walls?.length || upper.openings.some((o) => o.kind === 'door') ? deriveWalls(up) : [];
  const manual = manualWallRings(walls);
  if (manual.some((poly) => overlaps(polygon, poly))) {
    return fail('Проём пересекает стену верхнего этажа.');
  }
  if (upper.openings.some((o) => {
    if (o.kind !== 'door') return false;
    const placed = openingRect(up, o, walls);
    return placed && (overlaps(polygon, rectPolygon(placed.rect)) || openingEdge(placed, polygon, 0));
  })) return fail('Дверь верхнего этажа выходит в проём. Оставьте перед ней площадку.');
  result.rails = railing ? galleryEdges(polygon, host, [...holes, ...excluded, ...manual]) : [];
  result.ok = true;
  return result;
}

export function previewAtrium(project, levelId, roomId, { rect = null, railing = true, windowId = null } = {}) {
  const lower = project.levels.find((l) => l.id === levelId);
  const room = lower?.rooms.find((r) => r.id === roomId);
  const validRect = rect && [rect.x, rect.y, rect.w, rect.h].every(Number.isFinite) && rect.w > 0 && rect.h > 0;
  const polygon = rect ? validRect ? rectPolygon(rect) : [] : room ? roomPolygon(room) : [];
  const result = geometryPreview(project, levelId, roomId, polygon, null, railing);
  if (!result.ok) return result;
  const lp = levelProject(project, levelId);
  const candidates = lower.openings.filter((o) => o.kind === 'window' && !o.span && !o.corner && (o.roomId === roomId || o.host));
  const walls = candidates.length ? deriveWalls(lp) : [];
  for (const opening of candidates) {
    if (openingOwnerId(lp, opening, walls) !== roomId) continue;
    const placed = openingRect(lp, opening, walls);
    if (!placed || !openingEdge(placed, polygon, opening.width)) continue;
    const span = nextWindowSpan(project, levelId, opening);
    if (span) result.windows.push({ id: opening.id, width: opening.width, side: opening.side, top: span.maxTop });
  }
  if (windowId && !result.windows.some((w) => w.id === windowId)) {
    return { ...result, ok: false, reason: 'Это окно нельзя продлить в выбранный проём.' };
  }
  return result;
}

// Validate a new contour during a slab-handle drag against the current floors
// (including the other openings), without treating the edited void as a clash.
export function reshapeAtrium(project, levelId, opening, { rect, polygon }) {
  const current = slabOpeningPolygon(opening);
  const points = polygon || current.map((p) => ({
    x: rect.x + (p.x - opening.x) * rect.w / opening.w,
    y: rect.y + (p.y - opening.y) * rect.h / opening.h,
  }));
  const result = geometryPreview(project, opening.fromLevelId, opening.atrium.roomId, points, opening.id, false);
  if (!result.ok) return result;
  if (levelId !== result.upperLevelId) return { ...result, ok: false, reason: 'Между помещениями появился другой этаж.' };
  const lp = levelProject(project, opening.fromLevelId);
  const window = lp.openings.find((o) => o.id === opening.atrium.windowId && o.span?.levelId === levelId);
  if (window) {
    const placed = openingRect(lp, window, deriveWalls(lp));
    if (placed && !openingEdge(placed, points, window.width)) {
      return { ...result, ok: false, reason: 'Оставьте двухэтажное окно вдоль края проёма.' };
    }
  }
  const updated = polygon ? setSlabOpeningPolygon(project, levelId, opening.id, points)
    : setSlabOpeningRect(project, levelId, opening.id, rect);
  if (!updated) return { ...result, ok: false, reason: 'Проверьте размер и пересечения сторон контура.' };
  updated.atrium.upperRoomId = result.upperRoomId;
  return { ...result, opening: updated };
}

export function applyAtrium(project, levelId, roomId, options = {}) {
  const result = previewAtrium(project, levelId, roomId, options);
  if (!result.ok) return result;
  const candidate = result.windows.find((w) => w.id === options.windowId);
  const window = candidate && project.levels.find((l) => l.id === levelId).openings.find((o) => o.id === candidate.id);
  // Prepare the optional window on a copy: neither half of the operation can
  // survive a failed apply. The UI wraps this single mutation in its history.
  const draft = window && { ...window };
  if (draft && !setWindowSpan(project, levelId, draft, candidate.top)) {
    return { ...result, ok: false, reason: 'Верхняя стена окна изменилась. Выберите окно ещё раз.' };
  }
  const hole = createSlabOpening(project, result.upperLevelId, result.polygon);
  if (!hole) return { ...result, ok: false, reason: 'Не удалось создать проём по этому контуру.' };
  hole.fromLevelId = levelId;
  hole.atrium = { roomId, upperRoomId: result.upperRoomId, railing: options.railing !== false };
  if (draft) {
    window.span = draft.span;
    hole.atrium.windowId = window.id;
  }
  return { ...result, openingId: hole.id };
}
