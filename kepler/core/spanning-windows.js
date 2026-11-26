// Двухэтажный витраж хранится на нижнем этаже как один проём. Для верхнего
// этажа по геометрии находим вторую стену. Высоты — мм от пола нижнего этажа.
import { cornerWindowProjections } from './corner-windows.js';
import { glazedOpeningProjections } from './glazed-openings.js';
import { activeLevel, levelProject, roomCeiling, sortedLevels } from './model.js';
import { openingSill } from './opening-preset.js';
import { EDGE_MARGIN, fitOpeningOffset } from './opening-spacing.js';
import { deriveWalls, hostOpeningRoom, openingPos, openingRect, wallsEngine } from './walls.js';
import { wallZRange } from './wall-z-range.js';

// При наведении на проём и перерисовке нужны стены соседнего этажа.
// Во время перетаскивания геометрия меняется до фиксации ревизии проекта.
const geometryCache = new WeakMap();

function spanWalls(project) {
  const level = activeLevel(project);
  const settings = project.settings || {};
  const key = JSON.stringify([wallsEngine(project), settings.partition, settings.exterior, settings.bearing,
    level.rooms, level.walls, level.wallOverrides, project.levels.map((l) => [l.id, l.elevation, l.height])]);
  const entry = geometryCache.get(level);
  if (entry?.key === key) return entry.walls;
  const walls = deriveWalls(project);
  geometryCache.set(level, { key, walls });
  return walls;
}

function faceOf(wall, outward) {
  const { x, y, w, h } = wall.band;
  const lo = wall.orient === 'h' ? y : x;
  const hi = lo + (wall.orient === 'h' ? h : w);
  return { lo, hi, center: (lo + hi) / 2, outer: outward > 0 ? hi : lo, inner: outward > 0 ? lo : hi };
}

function facadeHost(project, opening, wall, walls) {
  if (wall.hidden || !['h', 'v'].includes(wall.orient)) return null;
  if (wall.kind === 'manual') return hostOpeningRoom(project, opening, walls);
  if (wall.kind !== 'own' || wall.wallType !== 'exterior') return null;
  const room = project.rooms.find((r) => r.id === opening.roomId);
  return room && !room.parentId ? { room, outward: wall.outward } : null;
}

function targetOpening(opening, wall, project, center) {
  if (wall.kind === 'manual') {
    return { ...opening, roomId: null, side: undefined, offset: undefined,
      host: { wallId: wall.wallId, t: (center - wall.axisStart) * wall.axisDir } };
  }
  const room = project.rooms.find((r) => r.id === wall.rooms[0]);
  if (!room) return null;
  return { ...opening, host: undefined, roomId: room.id, side: wall.sides[room.id],
    offset: center - (wall.orient === 'h' ? room.x : room.y) };
}

function spanHost(project, levelId, opening, wallsByLevel = new Map()) {
  if (opening?.corner) return null;
  if (opening?.kind !== 'window' || opening.orphan || !(opening.width > 0)) return null;
  const levels = sortedLevels(project);
  const i = levels.findIndex((level) => level.id === levelId);
  if (i < 0 || !levels[i + 1]) return null;
  const base = levels[i];
  const upper = levels[i + 1];
  const delta = upper.elevation - base.elevation;
  const lp = levelProject(project, base.id);
  const up = levelProject(project, upper.id);
  const wallsOf = (p) => {
    if (!wallsByLevel.has(p.activeLevel)) wallsByLevel.set(p.activeLevel, spanWalls(p));
    return wallsByLevel.get(p.activeLevel);
  };
  const placed = openingRect(lp, opening, wallsOf(lp));
  const source = placed && facadeHost(lp, opening, placed.wall, wallsOf(lp));
  if (!source) return null;
  const lowerWall = placed.wall;
  const lowerZ = wallZRange(lp, lowerWall, base.height);
  const sill = openingSill(opening, base);
  if (delta <= sill || lowerZ.z1 < delta - 1 || lowerZ.z0 > sill) return null;
  const from = placed.absCenter - opening.width / 2;
  const to = placed.absCenter + opening.width / 2;
  if (lowerWall.from > from || lowerWall.to < to) return null;
  const lowerFace = faceOf(lowerWall, source.outward);
  const upperWalls = wallsOf(up);
  const candidates = [];
  for (const wall of upperWalls) {
    if (wall.hidden || !['own', 'manual'].includes(wall.kind) || wall.orient !== lowerWall.orient
      || wall.to <= from || wall.from >= to) continue;
    const center = (Math.max(from, wall.from) + Math.min(to, wall.to)) / 2;
    const probe = targetOpening(opening, wall, up, center);
    const host = probe && facadeHost(up, probe, wall, upperWalls);
    if (!host || source.outward !== host.outward) continue;
    const face = faceOf(wall, host.outward);
    // Толщина стен может отличаться. Общая плоскость стекла должна входить в обе стены.
    if (Math.abs(face.outer - lowerFace.outer) > 1 && Math.abs(face.inner - lowerFace.inner) > 1) continue;
    if (lowerFace.center < face.lo + 15 || lowerFace.center > face.hi - 15) continue;
    const upperZ = wallZRange(up, wall, upper.height);
    if (upperZ.z0 > .5) continue;
    const maxTop = delta + Math.min(roomCeiling(host.room, upper), upperZ.z1);
    if (maxTop < delta + 1) continue;
    // rects включают заполнение стыка комнат, которого нет в номинальном
    // отрезке стены. Покрытие проверяем в общей плоскости стекла.
    for (const rect of wall.rects || [wall.band]) {
      const cross = wall.orient === 'h' ? rect.y : rect.x;
      const crossEnd = cross + (wall.orient === 'h' ? rect.h : rect.w);
      if (lowerFace.center < cross + 1 || lowerFace.center > crossEnd - 1) continue;
      const lo = Math.max(from, wall.orient === 'h' ? rect.x : rect.y);
      const hi = Math.min(to, wall.orient === 'h' ? rect.x+rect.w : rect.y+rect.h);
      if (hi > lo + .5) candidates.push({ wall, roomId: host.room.id, lo, hi, maxTop });
    }
  }
  const targets = [];
  let cursor = from;
  while (cursor < to - .5) {
    const available = candidates.filter((part) => part.lo <= cursor + .5 && part.hi > cursor + .5)
      .sort((a, b) => b.hi-a.hi);
    const part = available[0];
    if (!part) return null; // разрыв или отступ фасада нельзя перекрывать витражом
    const end = part.hi;
    const target = targetOpening({ ...opening, width: end-cursor }, part.wall, up, (cursor+end)/2);
    if (!target || !openingRect(up, target, upperWalls)) return null;
    // На внутренних стыках нужен единый проём без обязательного простенка.
    // По внешним краям и у соседних окон прежние отступы сохраняются.
    const joined = { ...part.wall,
      from: cursor > from+.5 ? Math.min(part.wall.from, cursor)-EDGE_MARGIN : part.wall.from,
      to: end < to-.5 ? Math.max(part.wall.to, end)+EDGE_MARGIN : part.wall.to };
    const fitted = fitOpeningOffset(up, target, upperWalls.map((wall) => wall === part.wall ? joined : wall), openingPos(target), { others: upper.openings });
    if (fitted == null || Math.abs(fitted-openingPos(target)) > .5) return null;
    targets.push({ target, roomId: part.roomId, maxTop: part.maxTop });
    cursor = end;
  }
  if (!targets.length) return null;
  return { targets, targetRoomId: targets[0].roomId, targetLevelId: upper.id, minTop: delta+1,
    maxTop: Math.min(...targets.map((part) => part.maxTop)), delta, sill, frameBand: lowerWall.band, outward: source.outward, from, to };
}

export function nextWindowSpan(project, levelId, opening) {
  const host = spanHost(project, levelId, opening);
  return host ? { targetLevelId: host.targetLevelId, minTop: host.minTop, maxTop: host.maxTop } : null;
}

export function setWindowSpan(project, levelId, opening, topMm) {
  const host = spanHost(project, levelId, opening);
  if (!host || !Number.isFinite(topMm) || topMm < host.minTop) return false;
  opening.span = { levelId: host.targetLevelId, topGap: Math.max(0, host.maxTop - Math.round(topMm)) };
  return true;
}

export function clearWindowSpan(opening) {
  delete opening.span;
}

function topOf(host, opening) {
  if (!host || host.targetLevelId !== opening.span?.levelId) return null;
  const gap = Number(opening.span.topGap);
  if (!Number.isFinite(gap) || gap < 0) return null;
  return Math.max(host.minTop, host.maxTop - gap);
}

export function windowSpanTop(project, levelId, opening) {
  return opening?.span ? topOf(spanHost(project, levelId, opening), opening) : null;
}

// Проекции только для чтения. Файл и история хранят исходные проёмы.
export function levelWindowOpenings(project, walls = null) {
  const current = project.levels?.length ? activeLevel(project) : null;
  const stored = current?.openings || project.openings || [];
  const originals = glazedOpeningProjections(!walls && stored.some((o) => o.corner)
    ? cornerWindowProjections(project, stored, deriveWalls(project)) : cornerWindowProjections(project, stored, walls));
  if (!current || project.levels.length < 2) return originals;
  const levels = sortedLevels(project);
  const below = levels[levels.indexOf(current) - 1];
  const incoming = below?.openings?.some((o) => o.span?.levelId === current.id);
  if (!incoming && !originals.some((o) => o.span)) return originals;
  const candidates = incoming ? [current, below] : [current];
  const wallsByLevel = new Map(walls ? [[current.id, walls]] : []);
  const slices = new Map();
  const projected = [];
  for (const level of candidates) {
    for (const opening of level.openings || []) {
      if (!opening.span || (level.id !== current.id && opening.span.levelId !== current.id)) continue;
      const host = spanHost(project, level.id, opening, wallsByLevel);
      const top = topOf(host, opening);
      if (top == null) continue;
      const props = { heightMode: 'custom', spanOwnerLevelId: level.id, spanTop: top,
        spanTargetRoomId: host.targetRoomId, spanTargetRoomIds: [...new Set(host.targets.map((part) => part.roomId))],
        spanFrameBand: host.frameBand, spanOutward: host.outward, spanAlongFrom: host.from, spanAlongTo: host.to };
      if (level.id === current.id) {
        slices.set(opening.id, { ...opening, ...props, sill: host.sill, height: host.delta - host.sill, spanPart: 'lower' });
      } else {
        host.targets.forEach((part, index) => projected.push({ ...part.target, ...props, spanTargetRoomId: part.roomId,
          ...(host.targets.length > 1 ? { spanSlice: index } : {}), sill: 0, height: top-host.delta, spanPart: 'upper' }));
      }
    }
  }
  return [...originals.map((o) => slices.get(o.id) || o), ...projected];
}
