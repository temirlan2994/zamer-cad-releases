import { FACADE_ELEMENTS, isFacadeKind } from '../data/facade-catalog.js';
import { deriveWalls, ownKey, sideEdge, wallRects } from './walls.js';
import { levelProject } from './model.js';
import { wallZRange } from './wall-z-range.js';
import { createMass, massBox } from './masses.js';

// Точка и наружная нормаль в осях дома. Для обеих ориентаций ширина идёт
// вдоль стены, а вынос отсчитывается от её наружной грани.
export function createFacadeElement(kind, { point, normal, level, from, to } = {}, existing = []) {
  if (!isFacadeKind(kind) || !point || !normal || !level) return null;
  const { elevation, height } = level;
  if (![point.x, point.y, point.z, elevation, height, from, to].every(Number.isFinite) || height < 12 || to - from < 12) return null;
  const alongX = Math.abs(normal.y) === 1 && normal.x === 0;
  if (!alongX && !(Math.abs(normal.x) === 1 && normal.y === 0)) return null;
  const def = FACADE_ELEMENTS[kind];
  const w = Math.min(def.w, to - from);
  const h = Math.min(def.h ?? height, height);
  const center = Math.min(to - w / 2, Math.max(from + w / 2, alongX ? point.x : point.y));
  const z0 = Math.max(elevation, Math.min(elevation + height - h, point.z - h / 2));
  return createMass({
    facadeKind: kind, name: def.name, color: Object.values(def.finishes)[0],
    x: alongX ? center : point.x + normal.x * def.d / 2,
    y: alongX ? point.y + normal.y * def.d / 2 : center,
    w, d: def.d, h, z0, rotation: alongX ? (normal.y > 0 ? 0 : 180) : (normal.x < 0 ? 90 : 270),
  }, existing);
}

function tinted(hex, factor) {
  const bytes = hex.slice(1).match(/../g);
  return '#' + bytes.map((c) => Math.min(255, Math.round(parseInt(c, 16) * factor)).toString(16).padStart(2, '0')).join('');
}

// Отдельные планки и плиты остаются одним выбираемым элементом. Ограничение
// числа деталей оставляет длинный пояс пригодным для мобильного рендера.
export function facadeParts(m) {
  const b = massBox(m);
  const color = m.color || Object.values(FACADE_ELEMENTS[m.facadeKind].finishes)[0];
  const turned = m.rotation % 180 === 90;
  const axis = turned ? 'y' : 'x';
  const parts = [];
  const add = (u0, u1, z0, z1, tint) => parts.push({
    ...b, [axis + '0']: b[axis + '0'] + u0, [axis + '1']: b[axis + '0'] + u1,
    z0: b.z0 + z0, z1: b.z0 + z1, color: tint,
  });
  if (m.facadeKind === 'slats') {
    const n = Math.max(1, Math.min(48, Math.round(m.w / 85)));
    const pitch = m.w / n;
    const gap = Math.min(16, pitch * 0.16);
    for (let i = 0; i < n; i += 1) add(i * pitch + gap / 2, (i + 1) * pitch - gap / 2, 0, m.h, tinted(color, [1, 0.94, 1.04][i % 3]));
  } else if (m.facadeKind === 'stone') {
    const columns = Math.max(1, Math.min(12, Math.round(m.w / 1000)));
    const rows = Math.max(1, Math.min(10, Math.round(m.h / 740)));
    for (let r = 0; r < rows; r += 1) {
      for (let c = 0; c < columns; c += 1) {
        add(c * m.w / columns + 2, (c + 1) * m.w / columns - 2, r * m.h / rows + 2, (r + 1) * m.h / rows - 2, tinted(color, [1, 0.97, 1.02][(c + r) % 3]));
      }
    }
  } else if (m.facadeKind === 'decking') {
    const top = Math.min(8, m.h / 4);
    add(0, m.w, 0, m.h - top, tinted(color, 0.85));
    const n = Math.max(1, Math.min(60, Math.round(m.w / 140)));
    const pitch = m.w / n;
    for (let i = 0; i < n; i += 1) {
      add(i * pitch + 1, (i + 1) * pitch - 1, m.h - top, m.h, tinted(color, [1, 0.97, 1.02][i % 3]));
    }
  } else if (m.facadeKind === 'canopy') {
    const soffit = Math.min(36, m.h * 0.2);
    add(0, m.w, 0, soffit, '#8c694e');
    add(0, m.w, soffit, m.h, color);
  } else add(0, m.w, 0, m.h, color);
  return parts;
}

// Связь с наружной гранью хранится в координатах стороны комнаты. Старые
// свободные массы и отделка без хозяина продолжают использовать свои XYZ.
export function facadeHostFrame(project, level, room, side) {
  if (side == null) return null;
  const edge = sideEdge(room, side);
  if (!edge || !['h', 'v'].includes(edge.orient) || edge.to - edge.from < 12) return null;
  const key = ownKey(room.id, side);
  const lp = { activeLevel: level.id, levels: project.levels, wallOverrides: level.wallOverrides, rooms: [room] };
  const z = wallZRange(lp, { kind: 'own', key, rooms: [room.id] }, level.height);
  const thickness = level.wallOverrides?.[key]?.thickness || project.settings?.exterior || 250;
  return { ...edge, across: edge.edge + edge.outward * thickness, low: level.elevation + z.z0, high: level.elevation + z.z1 };
}

export function bindFacadeToWall(project, m, levelId, roomId, side) {
  const level = project.levels.find((l) => l.id === levelId);
  const room = level?.rooms.find((r) => r.id === roomId);
  const frame = room && facadeHostFrame(project, level, room, side);
  if (!frame || !m.facadeKind) return m;
  const alongX = frame.orient === 'h';
  const along = (alongX ? m.x : m.y) - frame.from;
  const offset = (alongX ? m.y : m.x) - frame.outward * m.d / 2 - frame.across;
  const full = ['slats', 'stone'].includes(m.facadeKind) && Math.abs(m.z0 - frame.low) < 2 && Math.abs(m.h - (frame.high - frame.low)) < 2;
  const top = !full && m.z0 + m.h / 2 > (frame.low + frame.high) / 2;
  m.facadeHost = { levelId, roomId, side, along, offset, span: frame.to - frame.from, width: m.w, vertical: full ? 'full' : top ? 'top' : 'base',
    inset: top ? frame.high - m.z0 - m.h : m.z0 - frame.low };
  return m;
}

function bandContext(project, levelId, derived) {
  const lp = levelProject(project, levelId);
  const rooms = new Set(lp.rooms.filter((r) => !r.parentId).map((r) => r.id));
  return { lp, walls: (derived || deriveWalls(lp)).filter((w) => !w.hidden && w.kind === 'own' && rooms.has(w.rooms[0])) };
}

// Лицевая сторона стены включает торцы примыкающих стен в углах. Собираем
// касающиеся интервалы; разрыв или уступ завершает непрерывный фасад.
export function facadeWallSpan(project, m, anchor = null, contexts = new Map(), activeWalls = null) {
  const host = m.facadeHost;
  if (!host) return null;
  const level = project.levels.find((l) => l.id === host.levelId);
  const room = level?.rooms.find((r) => r.id === host.roomId);
  const frame = room && sideEdge(room, host.side);
  if (!frame) return null;
  if (!contexts.has(level.id)) contexts.set(level.id, bandContext(project, level.id, level.id === project.activeLevel ? activeWalls : null));
  const { lp, walls } = contexts.get(level.id);
  const axis = frame.orient === 'h' ? 'x' : 'y';
  const across = axis === 'x' ? 'y' : 'x';
  const extent = axis === 'x' ? 'w' : 'h';
  const depth = axis === 'x' ? 'h' : 'w';
  const at = anchor ?? m[axis];
  const plane = m[across] - frame.outward * m.d / 2 - host.offset;
  const intervals = [];
  for (const wall of walls) {
    if (wall.orient === frame.orient && wall.outward !== frame.outward) continue;
    const z = wallZRange(lp, wall, level.height);
    if (m.z0 + m.h / 2 < level.elevation + z.z0 || m.z0 + m.h / 2 > level.elevation + z.z1) continue;
    for (const r of wallRects(wall)) {
      if (Math.abs(r[across] + (frame.outward > 0 ? r[depth] : 0) - plane) > 1) continue;
      intervals.push([r[axis], r[axis] + r[extent]]);
    }
  }
  const runs = [];
  for (const [lo, hi] of intervals.sort((a, b) => a[0] - b[0])) {
    const last = runs.at(-1);
    if (last && lo <= last[1] + 1) last[1] = Math.max(last[1], hi);
    else runs.push([lo, hi]);
  }
  const run = runs.find(([lo, hi]) => lo <= at + 1 && hi >= at - 1);
  return run && run[1] - run[0] >= 12 ? { axis, from: run[0], to: run[1] } : null;
}

export function fitFacadeBand(project, m, ratio = 0.5, contexts = new Map(), activeWalls = null) {
  const host = m.facadeHost;
  if (m.facadeKind !== 'band' || !host) return false;
  const level = project.levels.find((l) => l.id === host.levelId);
  const room = level?.rooms.find((r) => r.id === host.roomId);
  const frame = room && sideEdge(room, host.side);
  if (!frame) return false;
  const anchor = frame.from + Math.max(0, Math.min(1, ratio)) * (frame.to - frame.from);
  const run = facadeWallSpan(project, m, anchor, contexts, activeWalls);
  if (!run) return false;
  m[run.axis] = (run.from + run.to) / 2;
  m.w = run.to - run.from;
  host.bandAnchor = Math.max(0, Math.min(1, ratio));
  return true;
}

export function fitSoffitLight(m, canopy) {
  m.d = Math.min(FACADE_ELEMENTS.light.d, canopy.d);
  const sign = [0, 270].includes(canopy.rotation) ? 1 : -1;
  const alongX = canopy.rotation % 180 === 0;
  const inset = sign * (canopy.d - m.d) / 2;
  Object.assign(m, { w: canopy.w, rotation: canopy.rotation, z0: canopy.z0 - m.h,
    x: canopy.x + (alongX ? 0 : inset), y: canopy.y + (alongX ? inset : 0) });
}

export function createCanopyLight(canopy, existing = []) {
  if (canopy?.facadeKind !== 'canopy') return null;
  const def = FACADE_ELEMENTS.light;
  const m = createMass({ facadeKind: 'light', name: def.name, d: Math.min(canopy.d, def.d), h: def.h,
    color: Object.values(def.finishes)[0] }, existing);
  m.canopyId = canopy.id;
  fitSoffitLight(m, canopy);
  return m;
}

// Перенос вдоль той же стены и правка выноса с сохранением монтажной грани
// оставляют связь. Перенос в сторону от стены и поворот освобождают элемент.
export function updateFacadeAttachment(project, previous, next) {
  const host = previous.facadeHost;
  if (!next || (previous.x === next.x && previous.y === next.y && previous.z0 === next.z0 &&
      previous.w === next.w && previous.d === next.d && previous.h === next.h && previous.rotation === next.rotation)) return next;
  if (previous.canopyId) delete next.canopyId;
  if (!host) return next;
  const level = project.levels.find((l) => l.id === host.levelId);
  const room = level?.rooms.find((r) => r.id === host.roomId);
  const frame = room && facadeHostFrame(project, level, room, host.side);
  delete next.facadeHost;
  if (!frame || previous.rotation !== next.rotation) return next;
  const across = frame.orient === 'h' ? next.y : next.x;
  const along = frame.orient === 'h' ? next.x : next.y;
  const gap = across - frame.outward * next.d / 2 - frame.across;
  const fullBand = Number.isFinite(host.bandAnchor) && previous.w === next.w &&
    along === (frame.orient === 'h' ? previous.x : previous.y);
  if (Math.abs(gap - host.offset) > 1 || (!fullBand && (along < frame.from || along > frame.to)) ||
      next.z0 >= frame.high || next.z0 + next.h < frame.low - (next.facadeKind === 'decking' ? 1 : 0)) return next;
  bindFacadeToWall(project, next, level.id, room.id, host.side);
  if (fullBand) next.facadeHost.bandAnchor = host.bandAnchor;
  if (host.headGap && previous.h === next.h && previous.z0 === next.z0) {
    Object.assign(next.facadeHost, { vertical: 'full', inset: host.inset, headGap: host.headGap });
  }
  return next;
}

export function syncFacadeHosts(project, activeWalls = null) {
  const masses = project?.masses;
  if (!masses?.some((m) => m.facadeHost || m.canopyId)) return [];
  const levels = new Map(project.levels.map((level) => [level.id, level]));
  const rooms = new Map();
  const removed = new Set();
  const bandContexts = new Map();
  for (const m of masses) {
    const host = m.facadeHost;
    if (!host) continue;
    const level = levels.get(host.levelId);
    if (level && !rooms.has(level.id)) rooms.set(level.id, new Map(level.rooms.map((r) => [r.id, r])));
    const room = rooms.get(host.levelId)?.get(host.roomId);
    const frame = room && facadeHostFrame(project, level, room, host.side);
    if (!frame) { removed.add(m.id); continue; }
    // Полоса во всю сторону повторяет её длину. Крайние панели сохраняют
    // расстояние от ближайшего угла, центральная — середину фасада.
    const length = frame.to - frame.from;
    let center = host.along;
    if (host.span && host.width && host.width <= host.span + 1) {
      m.w = Math.abs(host.width - host.span) < 1 ? length : Math.min(length, host.width);
      if (Math.abs(host.along - host.span / 2) < 1) center = length / 2;
      else if (host.along > host.span / 2) center += length - host.span;
      // Навес может доходить до наружного угла стены за пределом чистого
      // контура комнаты. После жеста сохраняем его монтажное положение.
      if (m.facadeKind !== 'canopy') center = Math.min(length - m.w / 2, Math.max(m.w / 2, center));
    }
    const along = frame.from + center;
    const across = frame.across + host.offset + frame.outward * m.d / 2;
    m.x = frame.orient === 'h' ? along : across;
    m.y = frame.orient === 'h' ? across : along;
    if (host.vertical === 'full') m.h = Math.max(12, frame.high - frame.low - (host.headGap || 0));
    m.z0 = host.vertical === 'top' ? frame.high - host.inset - m.h : frame.low + host.inset;
    if (Number.isFinite(host.bandAnchor) && !fitFacadeBand(project, m, host.bandAnchor, bandContexts, activeWalls)) removed.add(m.id);
  }
  const canopies = new Map(masses.filter((m) => m.facadeKind === 'canopy' && !removed.has(m.id)).map((m) => [m.id, m]));
  for (const light of masses) {
    if (!light.canopyId) continue;
    const canopy = canopies.get(light.canopyId);
    if (canopy) fitSoffitLight(light, canopy);
    else removed.add(light.id);
  }
  if (removed.size) {
    project.masses = masses.filter((m) => !removed.has(m.id));
    if (!project.masses.length) delete project.masses;
  }
  return [...removed];
}
