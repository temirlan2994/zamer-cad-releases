// Взаимное положение проёмов на одной стене: дверь/окно не может налезать на
// соседний проём, между ними — зазор не меньше OPENING_GAP. «Одна стена» —
// одна физическая полоса: проёмы двух комнат в общей стене тоже соседи.
//
// fitOpeningOffset — как clampOpeningOffset, но ищет ближайшее СВОБОДНОЕ
// место (с учётом соседей); null — места на стене нет.
// resolveOpeningConflicts — раздвигает уже стоящие проёмы (после прижатия
// Б3, вставки копии и т. п.); не помещающиеся — удаляет.
// windowsOnSharedWalls — окна, оказавшиеся в общей стене или без стены.

import { openingRect, sideEdge } from './walls.js';

export const OPENING_GAP = 100;
const EDGE_MARGIN = 50; // отступ проёма от торца стены (как в clampOpeningOffset)

// Полосы двух стен лежат на одной линии (перекрываются поперёк).
function sameLine(a, b) {
  if (!a || !b || a.orient !== b.orient) return false;
  const p = a.band;
  const q = b.band;
  return a.orient === 'h'
    ? Math.min(p.y + p.h, q.y + q.h) - Math.max(p.y, q.y) > 1
    : Math.min(p.x + p.w, q.x + q.w) - Math.max(p.x, q.x) > 1;
}

// Отрезок [lo, hi] минус открытые интервалы blocked (концы допустимы).
function freeIntervals(lo, hi, blocked) {
  let rest = [{ from: lo, to: hi }];
  for (const b of blocked) {
    const next = [];
    for (const seg of rest) {
      if (b.to <= seg.from || b.from >= seg.to) { next.push(seg); continue; }
      if (b.from >= seg.from) next.push({ from: seg.from, to: b.from });
      if (b.to <= seg.to) next.push({ from: b.to, to: seg.to });
    }
    rest = next;
  }
  return rest.filter((seg) => seg.to >= seg.from);
}

// Занятые участки (абсолютные координаты вдоль стены) других проёмов.
function occupied(project, opening, walls, others) {
  const list = [];
  for (const other of others || project.openings || []) {
    if (!other || other.id === opening.id) continue;
    const placed = openingRect(project, other, walls);
    if (!placed) continue;
    const half = (Number(other.width) || 0) / 2;
    list.push({ wall: placed.wall, from: placed.absCenter - half, to: placed.absCenter + half });
  }
  return list;
}

export function fitOpeningOffset(project, opening, walls, desiredOffset, { gap = OPENING_GAP, others = null } = {}) {
  const room = project.rooms.find((r) => r.id === opening.roomId);
  if (!room) return desiredOffset;
  const edge = sideEdge(room, opening.side);
  if (!edge) return null;
  const base = edge.orient === 'h' ? room.x : room.y;
  const abs = base + desiredOffset;
  const half = (Number(opening.width) || 0) / 2;
  const taken = occupied(project, opening, walls, others);
  let best = null;
  let bestDist = Infinity;
  for (const wall of walls) {
    if (wall.sides?.[opening.roomId] !== opening.side) continue;
    const lo = wall.from + half + EDGE_MARGIN;
    const hi = wall.to - half - EDGE_MARGIN;
    if (lo > hi) continue;
    const blocked = taken
      .filter((t) => sameLine(wall, t.wall))
      .map((t) => ({ from: t.from - gap - half, to: t.to + gap + half }));
    for (const seg of freeIntervals(lo, hi, blocked)) {
      const at = Math.min(seg.to, Math.max(seg.from, abs));
      const dist = Math.abs(at - abs);
      if (dist < bestDist - 1e-6) { bestDist = dist; best = at; }
    }
  }
  return best === null ? null : best - base;
}

// Раздвигает проёмы в порядке массива: ранние стоят, поздние уступают.
// ids — если задано, двигаются только эти проёмы (остальные — неподвижные
// соседи). Возвращает { moved: [id], dropped: [id] }; удалённые убраны из
// project.openings.
export function resolveOpeningConflicts(project, walls, { gap = OPENING_GAP, ids = null } = {}) {
  const movable = ids ? new Set(ids) : null;
  const all = project.openings || [];
  const fixed = movable ? all.filter((o) => !movable.has(o.id)) : [];
  const queue = movable ? all.filter((o) => movable.has(o.id)) : all;
  const settled = [...fixed];
  const moved = [];
  const dropped = [];
  for (const opening of queue) {
    const fitted = fitOpeningOffset(project, opening, walls, Number(opening.offset), { gap, others: settled });
    if (fitted === null) { dropped.push(opening.id); continue; }
    if (Math.abs(fitted - opening.offset) > 0.5) moved.push(opening.id);
    opening.offset = fitted;
    settled.push(opening);
  }
  if (dropped.length) {
    const gone = new Set(dropped);
    project.openings = all.filter((o) => !gone.has(o.id));
  }
  return { moved, dropped };
}

// Окна (из ids или все), которые стоят в общей стене или потеряли стену.
export function windowsOnSharedWalls(project, walls, ids = null) {
  const only = ids ? new Set(ids) : null;
  return (project.openings || [])
    .filter((o) => o.kind === 'window' && (!only || only.has(o.id)))
    .filter((o) => {
      const placed = openingRect(project, o, walls);
      return !placed || placed.wall.kind === 'shared';
    })
    .map((o) => o.id);
}
