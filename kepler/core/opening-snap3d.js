// Межэтажная привязка окон и дверей в 3D. Чистый модуль: собирает линии
// проёмов нижних этажей на той же физической стене и выбирает ближайшее
// совпадение центра/края. Размеры проёма не связываются навсегда — это
// одноразовая привязка при создании.

import { levelProject } from './model.js';
import { cornerWindowProjections } from './corner-windows.js';
import { openingHeight, openingSill } from './opening-preset.js';
import { isGlazedAssembly } from './glazed-openings.js';
import { windowSpanTop } from './spanning-windows.js';
import { deriveWalls, hostOpeningRoom, openingRect } from './walls.js';

const wallAcross = (wall) => (wall.orient === 'h'
  ? wall.band.y + wall.band.h / 2
  : wall.band.x + wall.band.w / 2);

const intervalsOverlap = (a0, a1, b0, b1, eps = 1) => Math.min(a1, b1) >= Math.max(a0, b0) - eps;

function exteriorPlane(project, opening, wall, walls) {
  if (wall.hidden || !['h', 'v'].includes(wall.orient)) return null;
  const outward = opening.host ? hostOpeningRoom(project, opening, walls)?.outward
    : wall.kind === 'own' && wall.wallType === 'exterior' && project.rooms.some((r) => r.id === opening.roomId && !r.parentId) ? wall.outward : 0;
  if (!outward) return null;
  const across = wall.orient === 'h' ? wall.band.y : wall.band.x;
  const thickness = wall.orient === 'h' ? wall.band.h : wall.band.w;
  return { orient: wall.orient, outward, across: across + (outward > 0 ? thickness : 0) };
}

// Собирается один раз в начале перетаскивания. На одной фасадной плоскости
// могут быть разные комнаты и этажные отметки. Верха сравниваются в мировых Z.
export function facadeWindowHeads(project, source, sourceWall, sourceWalls, minZ, maxZ) {
  if (source.kind !== 'window') return [];
  const plane = exteriorPlane(project, source, sourceWall, sourceWalls);
  if (!plane) return [];
  const heads = [];
  for (const level of project.levels) {
    if (level.elevation >= maxZ || !level.openings.length) continue;
    const lp = levelProject(project, level.id);
    const walls = level.id === project.activeLevel ? sourceWalls : deriveWalls(lp);
    for (const opening of cornerWindowProjections(lp, level.openings, walls)) {
      if (opening.kind !== 'window' || opening.id === source.id || opening.orphan) continue;
      const z = level.elevation + (windowSpanTop(lp, level.id, opening) ?? openingSill(opening, level) + openingHeight(opening, level));
      if (z < minZ || z > maxZ) continue;
      const p = openingRect(lp, opening, walls);
      const other = p && exteriorPlane(lp, opening, p.wall, walls);
      if (!other || other.orient !== plane.orient || other.outward !== plane.outward || Math.abs(other.across - plane.across) > 1) continue;
      heads.push({ id: opening.id, levelName: level.name, z, from: p.absCenter - opening.width / 2,
        to: p.absCenter + opening.width / 2, orient: plane.orient, across: plane.across });
    }
  }
  return heads;
}

function samePhysicalWall(active, lower) {
  if (!active || !lower || active.orient !== lower.orient) return false;
  const acrossTol = Math.max(150, (active.thickness || 0) / 2 + (lower.thickness || 0) / 2);
  if (Math.abs(wallAcross(active) - wallAcross(lower)) > acrossTol) return false;
  return intervalsOverlap(Math.min(active.from, active.to), Math.max(active.from, active.to),
    Math.min(lower.from, lower.to), Math.max(lower.from, lower.to));
}

// [{ center, from, to, width, height, sill, kind, levelId, levelName }]
// Ближайший этаж идёт первым.
export function lowerOpeningTargets(project, activeLevelId, activeWall) {
  const active = (project.levels || []).find((l) => l.id === activeLevelId);
  if (!active || !activeWall) return [];
  const lower = (project.levels || []).filter((l) => l.elevation < active.elevation - 1)
    .sort((a, b) => b.elevation - a.elevation);
  const out = [];
  for (const level of lower) {
    const lp = levelProject(project, level.id);
    const walls = deriveWalls(lp);
    for (const opening of cornerWindowProjections(lp, lp.openings || [], walls)) {
      const placed = openingRect(lp, opening, walls);
      if (!placed || !samePhysicalWall(activeWall, placed.wall)) continue;
      const half = opening.width / 2;
      const sill = openingSill(opening, level);
      const height = openingHeight(opening, level);
      out.push({
        id: opening.id, kind: opening.kind, center: placed.absCenter,
        from: placed.absCenter - half, to: placed.absCenter + half,
        width: opening.width, height, sill,
        levelId: level.id, levelName: level.name, elevation: level.elevation,
        box: {
          x0: placed.rect.x, y0: placed.rect.y,
          x1: placed.rect.x + placed.rect.w, y1: placed.rect.y + placed.rect.h,
          z0: level.elevation + sill, z1: level.elevation + sill + height,
        },
      });
    }
  }
  return out;
}

const modeTitle = { center: 'по центру', from: 'по левому краю', to: 'по правому краю' };

// opening — новый проём; center — желаемая абсолютная координата вдоль
// стены. Совпавший проём того же типа отдаёт также свои width/height/sill.
export function snapOpeningToLower(opening, center, targets, tolerance = 200) {
  if (!opening || !Number.isFinite(center) || !targets?.length || !(tolerance > 0)) {
    return { opening, center, snapped: false, label: '' };
  }
  const half = opening.width / 2;
  const probes = [
    { mode: 'center', at: center, key: 'center' },
    { mode: 'from', at: center - half, key: 'from' },
    { mode: 'to', at: center + half, key: 'to' },
  ];
  let best = null;
  targets.forEach((target, order) => {
    for (const p of probes) {
      const dist = Math.abs(p.at - target[p.key]);
      if (dist > tolerance) continue;
      const score = dist + order * 0.01 + (target.kind === opening.kind ? 0 : tolerance * 0.35);
      if (!best || score < best.score) best = { target, mode: p.mode, score };
    }
  });
  if (!best) return { opening, center, snapped: false, label: '' };
  const target = best.target;
  const sameKind = target.kind === opening.kind && !isGlazedAssembly(opening);
  const next = sameKind ? {
    ...opening,
    width: target.width,
    height: target.height,
    sill: opening.kind === 'door' ? 0 : target.sill,
  } : { ...opening };
  const nextHalf = next.width / 2;
  const snappedCenter = best.mode === 'center' ? target.center
    : best.mode === 'from' ? target.from + nextHalf
      : target.to - nextHalf;
  const noun = target.kind === 'window' ? 'окна' : 'двери';
  const dims = sameKind ? ` · размер как у ${noun}` : '';
  return {
    opening: next,
    center: snappedCenter,
    snapped: true,
    sourceLevelId: target.levelId,
    sourceOpeningId: target.id,
    mode: best.mode,
    label: `${modeTitle[best.mode]} ${noun} · ${target.levelName}${dims}`,
  };
}
