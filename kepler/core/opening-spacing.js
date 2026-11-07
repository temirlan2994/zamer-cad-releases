// Взаимное положение проёмов на одной стене: дверь/окно не может налезать на
// соседний проём, между ними — зазор не меньше OPENING_GAP. «Одна стена» —
// одна физическая полоса: проёмы двух комнат в общей стене тоже соседи.
//
// fitOpeningOffset — как clampOpeningOffset, но ищет ближайшее СВОБОДНОЕ
// место (с учётом соседей); null — места на стене нет.
// resolveOpeningConflicts — раздвигает уже стоящие проёмы (после прижатия
// Б3, вставки копии и т. п.); не помещающиеся — удаляет.
// windowsOnSharedWalls — окна, оказавшиеся в общей стене или без стены.

import { openingFrame, openingPos, openingRect, setOpeningPos } from './walls.js';

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

// Расстояния проёма до ближайшего слева и справа препятствия на той же
// стене: торец стены или соседний проём (дверь/окно). Координаты — вдоль
// стены в осях дома. Для превью при вставке и размеров у проёма.
// → { wall, from, to, left, right } | null (нет стены).
export function openingGaps(project, opening, walls) {
  const placed = openingRect(project, opening, walls);
  if (!placed) return null;
  const half = (Number(opening.width) || 0) / 2;
  const from = placed.absCenter - half;
  const to = placed.absCenter + half;
  const wall = placed.wall;
  let left = Math.min(wall.from, wall.to);
  let right = Math.max(wall.from, wall.to);
  for (const t of occupied(project, opening, walls, null)) {
    if (!sameLine(wall, t.wall)) continue;
    if (t.to <= from + 0.5) left = Math.max(left, t.to);
    else if (t.from >= to - 0.5) right = Math.min(right, t.from);
  }
  return { wall, from, to, left, right };
}

// Шаговая привязка проёма при вставке и перетаскивании. Позиция (offset или
// host.t) → позиция, при которой расстояния, что показаны на плане (до торца
// стены или соседнего проёма), кратны step; ближняя сторона «круглая».
// Если центр проёма в пределах tol от середины свободного участка стены —
// проём встаёт ровно по центру. step ≤ 1 — без привязки (Shift).
export function snapOpeningOffset(project, opening, walls, desired, { step = 50, tol = 0 } = {}) {
  if (!(step > 1) && !(tol > 0)) return desired;
  const probe = structuredClone(opening);
  setOpeningPos(probe, desired);
  const g = openingGaps(project, probe, walls);
  if (!g) return desired;
  const frame = openingFrame(project, probe, walls);
  if (!frame) return desired;
  const half = (Number(opening.width) || 0) / 2;
  const center = (g.from + g.to) / 2;
  const mid = (g.left + g.right) / 2;
  let target = center;
  if (tol > 0 && Math.abs(center - mid) <= tol) target = mid;
  else if (step > 1) {
    const gl = g.from - g.left;
    const gr = g.right - g.to;
    target = gl <= gr
      ? g.left + Math.round(gl / step) * step + half
      : g.right - Math.round(gr / step) * step - half;
  }
  return desired + (target - center) * frame.dir;
}

// Позиция — offset (проём комнаты) или host.t (проём ручной стены).
export function fitOpeningOffset(project, opening, walls, desiredOffset, { gap = OPENING_GAP, others = null } = {}) {
  const frame = openingFrame(project, opening, walls);
  if (frame === undefined) return desiredOffset;
  if (!frame) return null;
  const { base, dir } = frame;
  const abs = base + dir * desiredOffset;
  const half = (Number(opening.width) || 0) / 2;
  const taken = occupied(project, opening, walls, others);
  let best = null;
  let bestDist = Infinity;
  for (const wall of frame.walls) {
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
  return best === null ? null : (best - base) * dir;
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
    const current = openingPos(opening);
    const fitted = fitOpeningOffset(project, opening, walls, current, { gap, others: settled });
    if (fitted === null) { dropped.push(opening.id); continue; }
    if (Math.abs(fitted - current) > 0.5) moved.push(opening.id);
    setOpeningPos(opening, fitted);
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
