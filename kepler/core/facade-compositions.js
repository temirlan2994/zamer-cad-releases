// Шаблон задаёт монтажные размеры. После вставки окно и детали остаются
// обычными объектами проекта со своими свойствами, выбором и историей.
import { FACADE_ELEMENTS } from '../data/facade-catalog.js';
import { bindFacadeToWall, facadeHostFrame } from './facade.js';
import { createMass } from './masses.js';
import { createOpening, levelProject, levelTallWindowOffsets } from './model.js';
import { applyOpeningPreset } from './opening-preset.js';
import { fitOpeningOffset } from './opening-spacing.js';
import { deriveWalls } from './walls.js';

export const FACADE_COMPOSITIONS = Object.freeze({
  panorama: { title: 'Панорамное окно с рейками', minWidth: 1600 },
  terrace: { title: 'Терраса под навесом', minWidth: 2200 },
});

// Выбираем один открытый отрезок. У одной стороны комнаты может быть
// несколько таких отрезков, разделённых примыкающим помещением.
export function compositionWall(project, levelId, roomId, side, along) {
  const level = project.levels.find((l) => l.id === levelId);
  const room = level?.rooms.find((r) => r.id === roomId);
  if (!room || room.parentId || !Number.isFinite(along)) return null;
  const local = levelProject(project, levelId);
  const walls = deriveWalls(local);
  const wall = walls.find((w) => w.kind === 'own' && !w.hidden && w.sides?.[roomId] === side &&
    along >= w.from - 1 && along <= w.to + 1);
  const frame = wall && facadeHostFrame(project, level, room, side);
  if (!frame) return null;
  const horizontal = frame.orient === 'h';
  const across = horizontal ? wall.band.y + (wall.outward > 0 ? wall.band.h : 0)
    : wall.band.x + (wall.outward > 0 ? wall.band.w : 0);
  return { ...frame, across, from: wall.from, to: wall.to, side, level, room, local, walls, horizontal };
}

export function layoutComposition(kind, host, first, last) {
  const def = FACADE_COMPOSITIONS[kind];
  if (!def || !host || ![first, last].every(Number.isFinite)) return { error: 'Выберите наружную стену' };
  const from = Math.max(host.from, Math.round(Math.min(first, last)));
  const to = Math.min(host.to, Math.round(Math.max(first, last)));
  const width = to - from;
  if (width < def.minWidth) return { error: 'Укажите ширину от ' + def.minWidth + ' мм' };
  const center = (from + to) / 2;
  const wallHeight = host.high - host.low;
  const parts = [];
  const part = (type, along, w, d, z0, h, gap = 0) => {
    const entry = FACADE_ELEMENTS[type];
    const across = host.across + host.outward * (gap + d / 2);
    return { facadeKind: type, name: entry.name, color: Object.values(entry.finishes)[0],
      x: host.horizontal ? along : across, y: host.horizontal ? across : along,
      w, d, h, z0, rotation: host.horizontal ? (host.outward > 0 ? 0 : 180) : (host.outward < 0 ? 90 : 270) };
  };
  if (kind === 'terrace') {
    if (wallHeight < 2200) return { error: 'Для навеса нужна стена высотой от 2200 мм' };
    const depth = Math.min(3200, Math.round(width * 0.6 / 50) * 50);
    const canopy = part('canopy', center, width, depth, host.high - 200, 200);
    const decking = part('decking', center, width, depth, host.low - 140, 140);
    const posts = [from + 190, to - 190].map((at) => part('post', at, 180, 180, host.low, wallHeight - canopy.h, depth - 280));
    parts.push(canopy, decking, ...posts);
    return { parts, width };
  }
  const margin = Math.min(650, Math.round(width * 0.15));
  const glassWidth = width - 2 * margin;
  const offsets = levelTallWindowOffsets(host.level);
  const floor = host.level.elevation;
  if (floor + offsets.bottom < host.low || floor + offsets.bottom + offsets.height > host.high + 1) {
    return { error: 'Высота панорамных окон этажа превышает доступную высоту этой стены' };
  }
  parts.push(part('slats', from + margin / 2, margin, 65, host.low, wallHeight),
    part('slats', to - margin / 2, margin, 65, host.low, wallHeight));
  const opening = { center, width: glassWidth, height: offsets.height, sill: offsets.bottom };
  const glass = part('slats', center, glassWidth, 16, floor + offsets.bottom, offsets.height);
  return { parts, opening, glass, width };
}

export function prepareComposition(project, kind, host, first, last) {
  const draft = layoutComposition(kind, host, first, last);
  if (draft.error) return draft;
  const { level, room, side } = host;
  let opening = null;
  if (draft.opening) {
    const { center, width, sill, height } = draft.opening;
    const offset = center - (host.horizontal ? room.x : room.y);
    opening = applyOpeningPreset(createOpening('window', room.id, side, offset, width),
      { type: 'panoramic', width, sill, height, heightMode: 'level' });
    const fitted = fitOpeningOffset(host.local, opening, host.walls, offset);
    if (fitted == null || Math.abs(fitted - offset) > 0.5) return { error: 'Здесь уже есть проём. Выберите свободный участок стены' };
  }
  const masses = draft.parts.map((part) => {
    const m = bindFacadeToWall(project, createMass(part), level.id, room.id, side);
    if (part.facadeKind === 'post') {
      m.facadeHost.vertical = 'full';
      m.facadeHost.inset = 0;
      m.facadeHost.headGap = host.high - m.z0 - m.h;
    }
    return m;
  });
  const deck = masses.find((m) => m.facadeKind === 'decking');
  if (deck && project.masses?.some((m) => m.facadeKind === 'decking' && m.facadeHost?.levelId === level.id &&
    m.facadeHost.roomId === room.id && m.facadeHost.side === side &&
    Math.abs(host.horizontal ? m.x - deck.x : m.y - deck.y) < (m.w + deck.w) / 2 - 1)) {
    return { error: 'На этом участке уже есть настил террасы' };
  }
  return { masses, opening, levelId: level.id };
}
