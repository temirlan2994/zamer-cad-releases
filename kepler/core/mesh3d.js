// Модель дома для 3D-просмотра. Чистый модуль без DOM.
//
// Грани — многоугольники в осях дома: x, y как на плане (мм, ось Y вниз),
// z — вверх от нуля нижнего этажа. Стены — полосы плана, выдавленные на
// высоту этажа и разрезанные проёмами (под окном — подоконная часть, над
// проёмом — перемычка); в окне — стекло. Полы — цветом типа помещения.
// Участок (по желанию): земля, граница и соседние дома — переведены из
// координат съёмки в оси дома.
//
// face: { pts: [{x,y,z}…], normal: {x,y,z} (наружу), color, alpha?, kind,
//   ref? — у стен и их стёкол: { type: 'wall', key, wallId, level, face } }

import { isOpenRoom, isRoundItem, isShaft, isStructural, roomColors } from './catalog.js';
import { toLocal, toWorld } from './building.js';
import { levelProject, sortedLevels } from './model.js';
import { neighborRectCorners } from './site.js';
import { landscapeFaces } from './mesh3d-landscape.js';
import { houseTerrain, interpolateZ, terrainModel } from './terrain.js';
import { deriveWalls, openingRect, wallJoinPatches, wallRects } from './walls.js';
import { gridAxis, mergeCells } from './ortho-grid.js';
import { roomRects } from './room-shape.js';
import { stairCalculation } from './stairs.js';

export const WALL_COLOR = '#ece8e1';
export const GLASS_COLOR = '#8fb8dc';
export const DOOR_COLOR = '#b98a5a';
const STAIR_COLOR = '#c9c2b7';

const v = (x, y, z) => ({ x, y, z });

// Коробка без нижней грани: верх + 4 стороны (нормали наружу).
export function boxFaces(x0, y0, x1, y1, z0, z1, color, kind) {
  if (x1 - x0 < 0.5 || y1 - y0 < 0.5 || z1 - z0 < 0.5) return [];
  return [
    { pts: [v(x0, y0, z1), v(x1, y0, z1), v(x1, y1, z1), v(x0, y1, z1)], normal: v(0, 0, 1), color, kind },
    { pts: [v(x0, y0, z0), v(x1, y0, z0), v(x1, y0, z1), v(x0, y0, z1)], normal: v(0, -1, 0), color, kind },
    { pts: [v(x1, y1, z0), v(x0, y1, z0), v(x0, y1, z1), v(x1, y1, z1)], normal: v(0, 1, 0), color, kind },
    { pts: [v(x0, y1, z0), v(x0, y0, z0), v(x0, y0, z1), v(x0, y1, z1)], normal: v(-1, 0, 0), color, kind },
    { pts: [v(x1, y0, z0), v(x1, y1, z0), v(x1, y1, z1), v(x1, y0, z1)], normal: v(1, 0, 0), color, kind },
  ];
}

// Кусок стены по оси: для горизонтальной стены ось — X, иначе — Y.
function wallPiece(band, orient, a0, a1, z0, z1) {
  const faces = orient === 'h'
    ? boxFaces(a0, band.y, a1, band.y + band.h, z0, z1, WALL_COLOR, 'wall')
    : boxFaces(band.x, a0, band.x + band.w, a1, z0, z1, WALL_COLOR, 'wall');
  // Контуры задаются один раз для всей стены: границы отдельных частей вокруг
  // проёма не должны превращать её в набор обведённых «кубиков».
  return faces.map((face) => ({ ...face, noEdges: true }));
}

// Стекло (окно) или полотно (дверь) посередине толщины стены, двустороннее.
function paneFace(band, orient, a0, a1, z0, z1, color, alpha, kind) {
  if (orient === 'h') {
    const y = band.y + band.h / 2;
    return { pts: [v(a0, y, z0), v(a1, y, z0), v(a1, y, z1), v(a0, y, z1)], normal: v(0, 1, 0), color, alpha, kind, twoSided: true };
  }
  const x = band.x + band.w / 2;
  return { pts: [v(x, a0, z0), v(x, a1, z0), v(x, a1, z1), v(x, a0, z1)], normal: v(1, 0, 0), color, alpha, kind, twoSided: true };
}

function wallRuns(walls, cuts) {
  const groups = new Map();
  const extras = [];
  const round = (n) => Math.round(n * 10) / 10;
  for (const wall of walls) {
    if (wall.hidden) continue;
    const b = wall.band;
    if (!b) continue;
    if (!['own', 'shared', 'manual'].includes(wall.kind)) continue; // заплатки — ниже, без двойного объёма
    const cross0 = wall.orient === 'h' ? b.y : b.x;
    const cross1 = cross0 + (wall.orient === 'h' ? b.h : b.w);
    const key = `${wall.orient}|${round(cross0)}|${round(cross1)}|${wall.wallType}`;
    // Стены v2: куски области. Кусок на всю толщину полосы — часть пробега
    // (с проёмами и контуром), остальные (углы, узлы) — как заплатки.
    const pieces = wall.rects
      ? wall.rects.filter((r) => {
        const c0 = wall.orient === 'h' ? r.y : r.x;
        const c1 = c0 + (wall.orient === 'h' ? r.h : r.w);
        if (Math.abs(c0 - cross0) < 0.6 && Math.abs(c1 - cross1) < 0.6) return true;
        const orient = r.w >= r.h ? 'h' : 'v';
        extras.push({ band: r, orient, start: orient === 'h' ? r.x : r.y, end: orient === 'h' ? r.x + r.w : r.y + r.h, holes: [], outlined: false });
        return false;
      })
      : [b];
    if (!groups.has(key)) groups.set(key, []);
    for (const r of pieces) {
      groups.get(key).push({
        wall,
        start: wall.orient === 'h' ? r.x : r.y,
        end: wall.orient === 'h' ? r.x + r.w : r.y + r.h,
        cross0,
        cross1,
      });
    }
  }

  // Стыки/фаски: только непокрытая полосами часть (иначе двойной объём).
  for (const { rect: b } of wallJoinPatches(walls)) {
    const orient = b.w >= b.h ? 'h' : 'v';
    extras.push({ band: b, orient, start: orient === 'h' ? b.x : b.y, end: orient === 'h' ? b.x + b.w : b.y + b.h, holes: [], outlined: false });
  }

  const runs = [];
  for (const entries of groups.values()) {
    entries.sort((a, b) => a.start - b.start);
    let run = null;
    for (const entry of entries) {
      if (!run || entry.start > run.end + 2) {
        if (run) runs.push(run);
        run = { orient: entry.wall.orient, wallType: entry.wall.wallType, start: entry.start, end: entry.end, cross0: entry.cross0, cross1: entry.cross1, members: [entry.wall] };
      } else {
        run.end = Math.max(run.end, entry.end);
        run.members.push(entry.wall);
      }
    }
    if (run) runs.push(run);
  }

  const crossesEnd = (run, at) => runs.some((other) => {
    if (other === run || other.orient === run.orient) return false;
    if (run.orient === 'h') {
      const crossesX = at >= other.cross0 - 2 && at <= other.cross1 + 2;
      const overlapsY = Math.min(run.cross1, other.end) - Math.max(run.cross0, other.start) > 2;
      return crossesX && overlapsY;
    }
    const crossesY = at >= other.cross0 - 2 && at <= other.cross1 + 2;
    const overlapsX = Math.min(run.cross1, other.end) - Math.max(run.cross0, other.start) > 2;
    return crossesY && overlapsX;
  });
  for (const run of runs) {
    // Revit-подобная очистка Т-стыка: торец внутренней стены, входящей в
    // другую стену, не оставляет линию на её поверхности. Наружные углы
    // сохраняем — их стены имеют тип exterior.
    run.joinedStart = run.wallType !== 'exterior' && crossesEnd(run, run.start);
    run.joinedEnd = run.wallType !== 'exterior' && crossesEnd(run, run.end);
  }

  return [...runs.map((run) => {
    const band = run.orient === 'h'
      ? { x: run.start, y: run.cross0, w: run.end - run.start, h: run.cross1 - run.cross0 }
      : { x: run.cross0, y: run.start, w: run.cross1 - run.cross0, h: run.end - run.start };
    const holes = run.members.flatMap((wall) => cuts.get(wall) || [])
      .sort((a, b) => a.a0 - b.a0);
    return { ...run, band, holes, outlined: true };
  }), ...extras];
}

function wallOutlineEdges(band, orient, start, end, z0, z1, holes, { joinedStart = false, joinedEnd = false } = {}) {
  const cross0 = orient === 'h' ? band.y : band.x;
  const cross1 = cross0 + (orient === 'h' ? band.h : band.w);
  const p = (along, cross, z) => orient === 'h' ? v(along, cross, z) : v(cross, along, z);
  const edges = [];
  const add = (a0, c0, zz0, a1, c1, zz1) => edges.push([p(a0, c0, zz0), p(a1, c1, zz1)]);

  // Цельный внешний контур стены: верх, низ и четыре угловые вертикали.
  for (const z of [z0, z1]) {
    add(start, cross0, z, end, cross0, z);
    if (!joinedEnd) add(end, cross0, z, end, cross1, z);
    add(end, cross1, z, start, cross1, z);
    if (!joinedStart) add(start, cross1, z, start, cross0, z);
  }
  if (!joinedStart) for (const cross of [cross0, cross1]) add(start, cross, z0, start, cross, z1);
  if (!joinedEnd) for (const cross of [cross0, cross1]) add(end, cross, z0, end, cross, z1);

  // Реальные рёбра проёмов: периметр с обеих сторон и глубина откосов.
  for (const hole of holes) {
    const a0 = Math.max(start, hole.a0);
    const a1 = Math.min(end, hole.a1);
    const bottom = z0 + hole.bottom;
    const top = z0 + hole.top;
    if (a1 <= a0 || top <= bottom) continue;
    for (const cross of [cross0, cross1]) {
      add(a0, cross, bottom, a1, cross, bottom);
      add(a1, cross, bottom, a1, cross, top);
      add(a1, cross, top, a0, cross, top);
      add(a0, cross, top, a0, cross, bottom);
    }
    for (const along of [a0, a1]) for (const z of [bottom, top]) add(along, cross0, z, along, cross1, z);
  }
  return edges;
}

const SOLID_KINDS = new Set(['own', 'shared', 'manual']);

// Высота стены в 3D от пола этажа (мм): base.offset — низ; top.level —
// отметка другого этажа + offset; top.height — от низа; иначе — на всю
// высоту этажа (до перекрытия). Ручная стена — из объекта (level.walls),
// стена комнаты — из wallOverrides[key]. lp — проект на этаже стены.
export function wallZRange(lp, rec, levelHeight) {
  const src = rec?.kind === 'manual'
    ? (lp.walls || []).find((w) => w.id === rec.wallId)
    : lp.wallOverrides?.[rec?.key];
  const z0 = Number(src?.base?.offset) || 0;
  const top = src?.top;
  const levels = lp.levels || [];
  const topLevel = top?.level ? levels.find((l) => l.id === top.level) : null;
  let z1 = levelHeight;
  if (topLevel) {
    const own = levels.find((l) => l.id === lp.activeLevel);
    z1 = (Number(topLevel.elevation) || 0) - (Number(own?.elevation) || 0) + (Number(top.offset) || 0);
  } else if (Number(top?.height) > 0) z1 = z0 + Number(top.height);
  return { z0, z1: Math.max(z0 + 1, z1) };
}

// Тела стен этажа для 3D и выбора (core/pick3d.js): записи с прямоугольниками
// и своей высотой, проёмы-пустоты (низ/верх от пола этажа; верх проёма — не
// выше верха его стены − 50). В v1 высота — этажа (свои отметки — только v2).
export function levelWallSolids(lp, walls, height) {
  const v2 = walls.some((w) => w.rects);
  const recs = [];
  for (const w of walls) {
    if (w.hidden || !SOLID_KINDS.has(w.kind)) continue;
    const rects = wallRects(w).filter((r) => r.w >= 0.5 && r.h >= 0.5);
    if (!rects.length) continue;
    const z = v2 ? wallZRange(lp, w, height) : { z0: 0, z1: height };
    recs.push({ wall: w, rects, z0: z.z0, z1: z.z1 });
  }
  const byWall = new Map(recs.map((q, i) => [q.wall, i]));
  const voids = [];
  for (const o of lp.openings) {
    const placed = openingRect(lp, o, walls);
    if (!placed || placed.wall.hidden) continue;
    const r = placed.rect;
    const ri = byWall.get(placed.wall) ?? recs.findIndex((q) => q.wall.key === placed.wall.key);
    const wallTop = ri >= 0 ? recs[ri].z1 : height;
    const bottom = o.kind === 'door' ? 0 : Math.max(0, o.sill ?? 900);
    const top = Math.min(wallTop - 50, bottom + (o.height ?? (o.kind === 'door' ? 2100 : 1500)));
    if (top <= bottom || r.w < 0.5 || r.h < 0.5) continue;
    voids.push({ r, bottom, top, kind: o.kind, wall: placed.wall, rec: ri });
  }
  return { recs, voids };
}

// Ссылка грани на стену (выбор и подсветка в 3D): key записи, wallId ручной
// стены, этаж и вид грани — top/bottom (горизонтальные), side (вдоль стены),
// end (торец).
export function wallFaceName(orient, normal) {
  if (normal.z > 0.5) return 'top';
  if (normal.z < -0.5) return 'bottom';
  return (orient === 'h') === (Math.abs(normal.y) > 0.5) ? 'side' : 'end';
}

function wallRef(wall, levelId, face) {
  return { type: 'wall', key: wall.key, wallId: wall.wallId ?? null, level: levelId ?? null, face };
}

// Стены v2 (у записей есть rects): одно тело на этаж. Сетка по кускам стен и
// проёмам, по высоте — слои между отметками низа/верха стен и проёмов. В
// каждом слое область = стены, чья высота покрывает слой, минус проёмы слоя;
// боковые грани — по её контуру (с дырами-дворами), горизонтальные — где
// область слоя меняется. Внутренних граней между кусками одной высоты нет;
// рёбра — только по контуру и кромкам проёмов. Каждая грань — со ссылкой ref
// на свою стену (клетка помнит запись-владельца).
function levelWallsV2(lp, walls, z0, height, levelId) {
  const faces = [];
  const { recs, voids } = levelWallSolids(lp, walls, height);
  if (!recs.length || height < 0.5) return faces;
  for (const q of voids) {
    if (q.kind !== 'window') continue;
    const orient = q.wall.orient;
    const a0 = orient === 'h' ? q.r.x : q.r.y;
    const a1 = a0 + (orient === 'h' ? q.r.w : q.r.h);
    faces.push({ ...paneFace(q.wall.band, orient, a0, a1, z0 + q.bottom, z0 + q.top, GLASS_COLOR, 0.45, 'glass'), ref: wallRef(q.wall, levelId, 'glass') });
  }
  const allRects = [...recs.flatMap((q) => q.rects), ...voids.map((q) => q.r)];
  const ax = gridAxis(allRects.flatMap((r) => [r.x, r.x + r.w]));
  const ay = gridAxis(allRects.flatMap((r) => [r.y, r.y + r.h]));
  const xs = ax.coords; const ys = ay.coords;
  const nx = xs.length - 1; const ny = ys.length - 1;
  if (nx < 1 || ny < 1) return faces;
  const N = nx * ny;
  const owner = new Int32Array(N).fill(-1); // запись-владелец клетки
  recs.forEach((q, ri) => {
    for (const r of q.rects) {
      for (let j = ay.at(r.y); j < ay.at(r.y + r.h); j += 1) {
        for (let i = ax.at(r.x); i < ax.at(r.x + r.w); i += 1) owner[j * nx + i] = ri;
      }
    }
  });
  // Профиль клетки — владелец и набор проёмов над ней: верх стены делится по
  // проёмам и по стенам.
  const cellVoids = new Array(N);
  voids.forEach((q, vi) => {
    for (let j = ay.at(q.r.y); j < ay.at(q.r.y + q.r.h); j += 1) {
      for (let i = ax.at(q.r.x); i < ax.at(q.r.x + q.r.w); i += 1) {
        const k = j * nx + i;
        if (owner[k] < 0) continue;
        (cellVoids[k] ||= []).push(vi);
      }
    }
  });
  const profileIds = new Map();
  const profileOwner = [];
  const profile = new Int32Array(N);
  for (let k = 0; k < N; k += 1) {
    const key = `${owner[k]}|${cellVoids[k] ? cellVoids[k].join(',') : ''}`;
    if (!profileIds.has(key)) { profileIds.set(key, profileIds.size); profileOwner.push(owner[k]); }
    profile[k] = profileIds.get(key);
  }
  const zMin = Math.min(...recs.map((q) => q.z0));
  const zMax = Math.max(...recs.map((q) => q.z1));
  const zs = [...new Set([...recs.flatMap((q) => [q.z0, q.z1]), ...voids.flatMap((q) => [q.bottom, q.top])])]
    .filter((z) => z >= zMin && z <= zMax).sort((a, b) => a - b);
  const L = zs.length - 1;
  const layers = [];
  for (let s = 0; s < L; s += 1) {
    const m = new Uint8Array(N);
    for (let k = 0; k < N; k += 1) {
      const ri = owner[k];
      if (ri < 0 || recs[ri].z0 > zs[s] || recs[ri].z1 < zs[s + 1]) continue;
      m[k] = cellVoids[k]?.some((vi) => voids[vi].bottom <= zs[s] && voids[vi].top >= zs[s + 1]) ? 0 : 1;
    }
    layers.push(m);
  }
  const at = (m, i, j) => (m && i >= 0 && j >= 0 && i < nx && j < ny ? m[j * nx + i] : 0);
  const edges = [];
  const wallFace = (pts, normal, ri) => {
    const wall = recs[ri].wall;
    faces.push({ pts, normal, color: WALL_COLOR, kind: 'wall', noEdges: true, ref: wallRef(wall, levelId, wallFaceName(wall.orient, normal)) });
  };
  const first = faces.length;

  // Горизонтальные грани: верх там, где слой ниже есть, а выше нет; низ
  // (под перемычкой) — наоборот. Метка — профиль, чтобы верх делился по проёмам.
  for (let b = 1; b <= L; b += 1) {
    const below = layers[b - 1];
    const above = b < L ? layers[b] : null;
    const z = z0 + zs[b];
    const up = new Int32Array(N).fill(-1);
    const down = new Int32Array(N).fill(-1);
    for (let k = 0; k < N; k += 1) {
      const lo = below[k]; const hi = above ? above[k] : 0;
      if (lo && !hi) up[k] = profile[k];
      else if (hi && !lo) down[k] = profile[k];
    }
    for (const [id, list] of mergeCells(up, xs, ys)) {
      for (const r of list) wallFace([v(r.x, r.y, z), v(r.x + r.w, r.y, z), v(r.x + r.w, r.y + r.h, z), v(r.x, r.y + r.h, z)], v(0, 0, 1), profileOwner[id]);
    }
    for (const [id, list] of mergeCells(down, xs, ys)) {
      for (const r of list) wallFace([v(r.x, r.y + r.h, z), v(r.x + r.w, r.y + r.h, z), v(r.x + r.w, r.y, z), v(r.x, r.y, z)], v(0, 0, -1), profileOwner[id]);
    }
  }
  // Низ стен, поднятых над полом этажа (base.offset > 0), на нижней отметке
  // слоёв; выше неё низы даёт цикл выше (слой ниже пуст, выше — есть).
  if (zMin > 0) {
    const z = z0 + zs[0];
    const down = new Int32Array(N).fill(-1);
    for (let k = 0; k < N; k += 1) if (layers[0]?.[k]) down[k] = profile[k];
    for (const [id, list] of mergeCells(down, xs, ys)) {
      for (const r of list) wallFace([v(r.x, r.y + r.h, z), v(r.x + r.w, r.y + r.h, z), v(r.x + r.w, r.y, z), v(r.x, r.y, z)], v(0, 0, -1), profileOwner[id]);
    }
  }

  // Боковые грани слоя — по контуру его области (слитые прямые участки одной
  // стены). Знак границы: −1 — область по «плюсовую» сторону линии, +1 — по
  // «минусовую»; владелец — клетка с областью.
  const hSign = (m, i, j) => (at(m, i, j) && !at(m, i, j - 1) ? -1 : (!at(m, i, j) && at(m, i, j - 1) ? 1 : 0));
  const vSign = (m, i, j) => (at(m, i, j) && !at(m, i - 1, j) ? -1 : (!at(m, i, j) && at(m, i - 1, j) ? 1 : 0));
  for (let s = 0; s < L; s += 1) {
    const m = layers[s];
    const za = z0 + zs[s]; const zb = z0 + zs[s + 1];
    const side = (a, b2, normal, ri) => wallFace([v(a.x, a.y, za), v(b2.x, b2.y, za), v(b2.x, b2.y, zb), v(a.x, a.y, zb)], normal, ri);
    for (let j = 0; j <= ny; j += 1) {
      let run = null;
      const flush = () => { if (run) side({ x: xs[run.i0], y: ys[j] }, { x: xs[run.i1], y: ys[j] }, v(0, run.s, 0), run.o); run = null; };
      for (let i = 0; i < nx; i += 1) {
        const sg = hSign(m, i, j);
        const o = sg ? owner[(sg < 0 ? j : j - 1) * nx + i] : -1;
        if (sg && run?.s === sg && run.o === o) run.i1 = i + 1;
        else { flush(); if (sg) run = { s: sg, o, i0: i, i1: i + 1 }; }
      }
      flush();
    }
    for (let i = 0; i <= nx; i += 1) {
      let run = null;
      const flush = () => { if (run) side({ x: xs[i], y: ys[run.j0] }, { x: xs[i], y: ys[run.j1] }, v(run.s, 0, 0), run.o); run = null; };
      for (let j = 0; j < ny; j += 1) {
        const sg = vSign(m, i, j);
        const o = sg ? owner[j * nx + (sg < 0 ? i : i - 1)] : -1;
        if (sg && run?.s === sg && run.o === o) run.j1 = j + 1;
        else { flush(); if (sg) run = { s: sg, o, j0: j, j1: j + 1 }; }
      }
      flush();
    }
  }

  // Горизонтальные рёбра на отметке: там, где граница слоя ниже и выше разная
  // (низ и верх стены, подоконник, перемычка, откосы).
  for (let b = 0; b <= L; b += 1) {
    const below = b > 0 ? layers[b - 1] : null;
    const above = b < L ? layers[b] : null;
    const z = z0 + zs[b];
    for (let j = 0; j <= ny; j += 1) {
      let i0 = -1;
      for (let i = 0; i <= nx; i += 1) {
        const diff = i < nx && hSign(below, i, j) !== hSign(above, i, j);
        if (diff && i0 < 0) i0 = i;
        if (!diff && i0 >= 0) { edges.push([v(xs[i0], ys[j], z), v(xs[i], ys[j], z)]); i0 = -1; }
      }
    }
    for (let i = 0; i <= nx; i += 1) {
      let j0 = -1;
      for (let j = 0; j <= ny; j += 1) {
        const diff = j < ny && vSign(below, i, j) !== vSign(above, i, j);
        if (diff && j0 < 0) j0 = j;
        if (!diff && j0 >= 0) { edges.push([v(xs[i], ys[j0], z), v(xs[i], ys[j], z)]); j0 = -1; }
      }
    }
  }
  // Вертикальные рёбра — в углах контура слоя (1 или 3 занятые клетки вокруг
  // вершины, либо две по диагонали); соседние по высоте слои сливаются.
  const corner = (m, i, j) => {
    const a = at(m, i - 1, j - 1); const b2 = at(m, i, j - 1); const c = at(m, i - 1, j); const d = at(m, i, j);
    const n = a + b2 + c + d;
    return n === 1 || n === 3 || (n === 2 && a === d);
  };
  for (let j = 0; j <= ny; j += 1) {
    for (let i = 0; i <= nx; i += 1) {
      let s0 = -1;
      for (let s = 0; s <= L; s += 1) {
        const on = s < L && corner(layers[s], i, j);
        if (on && s0 < 0) s0 = s;
        if (!on && s0 >= 0) { edges.push([v(xs[i], ys[j], z0 + zs[s0]), v(xs[i], ys[j], z0 + zs[s])]); s0 = -1; }
      }
    }
  }
  if (faces.length > first) faces[first].edges = edges;
  return faces;
}

// Стены этажа с проёмами.
function levelWalls(lp, z0, height, levelId) {
  const faces = [];
  const walls = deriveWalls(lp);
  if (walls.some((w) => w.rects)) return levelWallsV2(lp, walls, z0, height, levelId);
  const cuts = new Map(); // стена → [{ a0, a1, bottom, top, kind }]
  for (const o of lp.openings) {
    const placed = openingRect(lp, o, walls);
    if (!placed) continue;
    const r = placed.rect;
    const along = placed.wall.orient === 'h' ? [r.x, r.x + r.w] : [r.y, r.y + r.h];
    const bottom = o.kind === 'door' ? 0 : Math.max(0, o.sill ?? 900);
    const top = Math.min(height - 50, bottom + (o.height ?? (o.kind === 'door' ? 2100 : 1500)));
    if (!cuts.has(placed.wall)) cuts.set(placed.wall, []);
    cuts.get(placed.wall).push({ a0: along[0], a1: along[1], bottom, top, kind: o.kind });
  }
  for (const run of wallRuns(walls, cuts)) {
    const { band: b, orient, start, end, holes } = run;
    const wallFaces = [];
    const addPiece = (a0, a1, pieceZ0, pieceZ1) => wallFaces.push(...wallPiece(b, orient, a0, a1, pieceZ0, pieceZ1));
    let cursor = start;
    for (const h of holes) {
      const a0 = Math.max(start, h.a0);
      const a1 = Math.min(end, h.a1);
      if (a1 <= a0) continue;
      if (a0 > cursor) addPiece(cursor, a0, z0, z0 + height);
      if (h.bottom > 0) addPiece(a0, a1, z0, z0 + h.bottom);
      if (h.top < height) addPiece(a0, a1, z0 + h.top, z0 + height);
      if (h.kind === 'window') {
        const pane = paneFace(b, orient, a0, a1, z0 + h.bottom, z0 + h.top, GLASS_COLOR, 0.45, 'glass');
        if (run.members?.[0]) pane.ref = wallRef(run.members[0], levelId, 'glass');
        faces.push(pane);
      }
      cursor = Math.max(cursor, a1);
    }
    if (cursor < end) addPiece(cursor, end, z0, z0 + height);
    if (run.outlined && wallFaces.length) {
      wallFaces[0].edges = wallOutlineEdges(b, orient, start, end, z0, z0 + height, holes, run);
    }
    // v1: пробег может объединять несколько стен — ссылка на первую, keys — все.
    const member = run.members?.[0];
    if (member) {
      const keys = run.members.map((m) => m.key);
      for (const f of wallFaces) f.ref = { ...wallRef(member, levelId, wallFaceName(orient, f.normal)), keys };
    }
    faces.push(...wallFaces);
  }
  return faces;
}

// Слой стен одного этажа (для быстрой пересборки при правке в 3D): грани
// помечены wallsOf = id этажа.
export function buildLevelWalls(project, levelId) {
  const level = (project.levels || []).find((l) => l.id === levelId);
  if (!level) return [];
  const faces = levelWalls(levelProject(project, levelId), level.elevation, level.height, levelId);
  for (const f of faces) f.wallsOf = levelId;
  return faces;
}

function subtractFloorRect(base, cut) {
  const x0 = Math.max(base.x, cut.x);
  const y0 = Math.max(base.y, cut.y);
  const x1 = Math.min(base.x + base.w, cut.x + cut.w);
  const y1 = Math.min(base.y + base.h, cut.y + cut.h);
  if (x1 <= x0 || y1 <= y0) return [base];
  return [
    { x: base.x, y: base.y, w: base.w, h: y0 - base.y },
    { x: base.x, y: y1, w: base.w, h: base.y + base.h - y1 },
    { x: base.x, y: y0, w: x0 - base.x, h: y1 - y0 },
    { x: x1, y: y0, w: base.x + base.w - x1, h: y1 - y0 },
  ].filter((rect) => rect.w > 0.5 && rect.h > 0.5);
}

function levelFloors(lp, z) {
  const faces = [];
  // Сначала комнаты верхнего уровня, вложенные — чуть выше (видны поверх).
  const order = [...lp.rooms].sort((a, b) => Number(Boolean(a.parentId)) - Number(Boolean(b.parentId)));
  for (const r of order) {
    if (isShaft(r)) continue;
    const zz = z + (isOpenRoom(r) ? 0 : r.parentId ? 2 : 1);
    const color = roomColors(r.type).floor3d; // цвет типа помещения (как на плане)
    const shaftCuts = lp.rooms.filter((shaft) => isShaft(shaft) &&
      (shaft.parentId === r.id || (!shaft.parentId && !r.parentId))).flatMap(roomRects);
    let floorParts = roomRects(r);
    for (const cut of shaftCuts) floorParts = floorParts.flatMap((part) => subtractFloorRect(part, cut));
    for (const part of floorParts) {
      faces.push({
        pts: [v(part.x, part.y, zz), v(part.x + part.w, part.y, zz), v(part.x + part.w, part.y + part.h, zz), v(part.x, part.y + part.h, zz)],
        normal: v(0, 0, 1), color, kind: 'floor', roomId: r.id,
      });
    }
  }
  return faces;
}

// Контур конструкции в плане: повёрнутый прямоугольник или 12-угольник.
export function structuralOutline(item) {
  const r = ((item.rotation || 0) * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  const local = isRoundItem(item.kind)
    ? Array.from({ length: 12 }, (_, i) => {
      const a = (i / 12) * Math.PI * 2;
      return { x: (Math.cos(a) * item.w) / 2, y: (Math.sin(a) * item.h) / 2 };
    })
    : [{ x: -item.w / 2, y: -item.h / 2 }, { x: item.w / 2, y: -item.h / 2 }, { x: item.w / 2, y: item.h / 2 }, { x: -item.w / 2, y: item.h / 2 }];
  return local.map((p) => ({ x: item.x + p.x * c - p.y * s, y: item.y + p.x * s + p.y * c }));
}

// Призма над многоугольником: верх и боковые грани (нормали — от центра).
function prismFaces(poly, z0, z1, color, kind) {
  const cx = poly.reduce((t, p) => t + p.x, 0) / poly.length;
  const cy = poly.reduce((t, p) => t + p.y, 0) / poly.length;
  const faces = [{ pts: poly.map((p) => v(p.x, p.y, z1)), normal: v(0, 0, 1), color, kind }];
  for (let i = 0; i < poly.length; i += 1) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    let nx = b.y - a.y;
    let ny = -(b.x - a.x);
    if (nx * ((a.x + b.x) / 2 - cx) + ny * ((a.y + b.y) / 2 - cy) < 0) { nx = -nx; ny = -ny; }
    const len = Math.hypot(nx, ny) || 1;
    faces.push({ pts: [v(a.x, a.y, z0), v(b.x, b.y, z0), v(b.x, b.y, z1), v(a.x, a.y, z1)], normal: v(nx / len, ny / len, 0), color, kind });
  }
  return faces;
}

// Свободные стены и колонны этажа — на всю высоту этажа.
function levelStructures(lp, z0, height) {
  return lp.items.filter((i) => isStructural(i.kind))
    .flatMap((i) => prismFaces(structuralOutline(i), z0, z0 + height, WALL_COLOR, 'wall'));
}

function stairBox(item, x0, y0, x1, y1, z0, z1) {
  const angle = ((item.rotation || 0) * Math.PI) / 180;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return boxFaces(Math.min(x0, x1), Math.min(y0, y1), Math.max(x0, x1), Math.max(y0, y1), z0, z1, STAIR_COLOR, 'stairs').map((face) => ({
    ...face,
    itemId: item.id,
    pts: face.pts.map((p) => ({ x: item.x + p.x * c - p.y * s, y: item.y + p.x * s + p.y * c, z: p.z })),
    normal: { x: face.normal.x * c - face.normal.y * s, y: face.normal.x * s + face.normal.y * c, z: face.normal.z },
  }));
}

// Ступени в 3D: прямая, Г- или П-образная лестница из параметров плана.
function levelStairs(lp, z0, levelHeight) {
  const faces = [];
  for (const item of lp.items.filter((candidate) => candidate.kind === 'stairs')) {
    const calc = stairCalculation(item, levelHeight);
    const w = item.w;
    const h = item.h;
    const addFlightY = (x0, x1, yStart, yEnd, count, startStep) => {
      const depth = (yEnd - yStart) / Math.max(1, count);
      for (let i = 0; i < count; i += 1) {
        const top = z0 + Math.min(calc.floorH - calc.riserH, (startStep + i + 1) * calc.riserH);
        faces.push(...stairBox(item, x0, yStart + i * depth, x1, yStart + (i + 1) * depth, z0, top));
      }
    };
    const addFlightX = (xStart, xEnd, y0, y1, count, startStep) => {
      const depth = (xEnd - xStart) / Math.max(1, count);
      for (let i = 0; i < count; i += 1) {
        const top = z0 + Math.min(calc.floorH - calc.riserH, (startStep + i + 1) * calc.riserH);
        faces.push(...stairBox(item, xStart + i * depth, y0, xStart + (i + 1) * depth, y1, z0, top));
      }
    };
    if (calc.shape === 'u') {
      const gap = Math.min(200, w * 0.1);
      const flightW = (w - gap) / 2;
      const landingD = Math.min(flightW, h * 0.36);
      addFlightY(-w / 2, -gap / 2, h / 2, -h / 2 + landingD, calc.firstTreads, 0);
      const landingTop = z0 + (calc.firstTreads + 1) * calc.riserH;
      faces.push(...stairBox(item, -w / 2, -h / 2, w / 2, -h / 2 + landingD, z0, landingTop));
      addFlightY(gap / 2, w / 2, -h / 2 + landingD, h / 2, calc.secondTreads, calc.firstTreads + 1);
    } else if (calc.shape === 'l') {
      const flightW = Math.min(1000, w * 0.42, h * 0.42);
      addFlightY(-w / 2, -w / 2 + flightW, h / 2, -h / 2 + flightW, calc.firstTreads, 0);
      const landingTop = z0 + (calc.firstTreads + 1) * calc.riserH;
      faces.push(...stairBox(item, -w / 2, -h / 2, -w / 2 + flightW, -h / 2 + flightW, z0, landingTop));
      addFlightX(-w / 2 + flightW, w / 2, -h / 2, -h / 2 + flightW, calc.secondTreads, calc.firstTreads + 1);
    } else {
      addFlightY(-w / 2, w / 2, h / 2, -h / 2, calc.treads, 0);
    }
  }
  return faces;
}

const ROOF_COLOR = '#9aa3ad';
const SLAB_COLOR = '#b9b4ab';
const ROOF_T = 250;
const SLAB_T = 200;
const SLAB_OUTSET = 20; // торец перекрытия чуть выступает из стены (без мерцания)

// Пятно этажа: прямоугольники комнат (с частями Г/outline) с наружной стеной.
function levelFootprint(lp, offset) {
  return lp.rooms.filter((r) => !r.parentId && !isOpenRoom(r) && !isShaft(r))
    .flatMap(roomRects)
    .map((p) => ({ x0: p.x - offset, y0: p.y - offset, x1: p.x + p.w + offset, y1: p.y + p.h + offset }));
}

// Проём в перекрытии: лестничные помещения и шахты обоих этажей, марши нижнего.
function slabCuts(lower, upper) {
  const cuts = [];
  for (const lp of [lower, upper]) {
    for (const r of lp.rooms.filter((room) => isShaft(room) || room.type === 'stairs-room')) {
      for (const p of roomRects(r)) cuts.push({ x0: p.x, y0: p.y, x1: p.x + p.w, y1: p.y + p.h });
    }
  }
  for (const item of lower.items.filter((i) => i.kind === 'stairs')) {
    const o = structuralOutline(item);
    cuts.push({
      x0: Math.min(...o.map((p) => p.x)), y0: Math.min(...o.map((p) => p.y)),
      x1: Math.max(...o.map((p) => p.x)), y1: Math.max(...o.map((p) => p.y)),
    });
  }
  return cuts;
}

const snap = (a) => Math.round(a * 10) / 10;
const uniqSorted = (list) => [...new Set(list.map(snap))].sort((a, b) => a - b);
const inRects = (rects, x, y) => rects.some((r) => x > r.x0 && x < r.x1 && y > r.y0 && y < r.y1);

// Область на общей сетке: клетка входит, если лежит во всех группах all и ни в
// одном прямоугольнике none. Сетка — по всем координатам прямоугольников.
export function regionGrid(all, none = []) {
  const rects = [...all.flat(), ...none];
  const xs = uniqSorted(rects.flatMap((r) => [r.x0, r.x1]));
  const ys = uniqSorted(rects.flatMap((r) => [r.y0, r.y1]));
  const nx = Math.max(0, xs.length - 1);
  const ny = Math.max(0, ys.length - 1);
  const mask = new Uint8Array(nx * ny);
  if (!all.length || all.some((g) => !g.length)) return { xs, ys, nx, ny, mask };
  for (let j = 0; j < ny; j += 1) {
    const cy = (ys[j] + ys[j + 1]) / 2;
    for (let i = 0; i < nx; i += 1) {
      const cx = (xs[i] + xs[i + 1]) / 2;
      if (xs[i + 1] - xs[i] < 0.5 || ys[j + 1] - ys[j] < 0.5) continue;
      if (all.every((g) => inRects(g, cx, cy)) && !inRects(none, cx, cy)) mask[j * nx + i] = 1;
    }
  }
  return { xs, ys, nx, ny, mask };
}

// Плита по области без швов: верх (и низ) — из слитых прямоугольников сетки
// без собственных рёбер; торцы и рёбра — только по контуру области.
export function slabFaces(grid, z0, z1, color, kind, { bottom = false } = {}) {
  const { xs, ys, nx, ny, mask } = grid;
  const at = (i, j) => (i >= 0 && j >= 0 && i < nx && j < ny ? mask[j * nx + i] : 0);
  const faces = [];
  const edges = [];
  // Слитые прямоугольники: полосы по строкам, одинаковые полосы — вниз.
  const used = new Uint8Array(nx * ny);
  for (let j = 0; j < ny; j += 1) {
    for (let i = 0; i < nx; i += 1) {
      if (!at(i, j) || used[j * nx + i]) continue;
      let i1 = i;
      while (i1 + 1 < nx && at(i1 + 1, j) && !used[j * nx + i1 + 1]) i1 += 1;
      let j1 = j;
      const rowFree = (jj) => { for (let k = i; k <= i1; k += 1) if (!at(k, jj) || used[jj * nx + k]) return false; return true; };
      while (j1 + 1 < ny && rowFree(j1 + 1)) j1 += 1;
      for (let jj = j; jj <= j1; jj += 1) for (let k = i; k <= i1; k += 1) used[jj * nx + k] = 1;
      const x0 = xs[i]; const x1 = xs[i1 + 1]; const y0 = ys[j]; const y1 = ys[j1 + 1];
      faces.push({ pts: [v(x0, y0, z1), v(x1, y0, z1), v(x1, y1, z1), v(x0, y1, z1)], normal: v(0, 0, 1), color, kind, edges: [] });
      if (bottom) faces.push({ pts: [v(x0, y1, z0), v(x1, y1, z0), v(x1, y0, z0), v(x0, y0, z0)], normal: v(0, 0, -1), color, kind, edges: [] });
    }
  }
  if (!faces.length) return faces;
  const side = (a, b, normal) => {
    faces.push({ pts: [v(a.x, a.y, z0), v(b.x, b.y, z0), v(b.x, b.y, z1), v(a.x, a.y, z1)], normal, color, kind, edges: [] });
    edges.push([v(a.x, a.y, z1), v(b.x, b.y, z1)], [v(a.x, a.y, z0), v(b.x, b.y, z0)],
      [v(a.x, a.y, z0), v(a.x, a.y, z1)], [v(b.x, b.y, z0), v(b.x, b.y, z1)]);
  };
  // Горизонтальные торцы: граница между строками j-1 и j; соседние — сливаются.
  for (let j = 0; j <= ny; j += 1) {
    let run = null;
    const flush = () => { if (run) side(v(xs[run.i0], ys[j], 0), v(xs[run.i1], ys[j], 0), v(0, run.s, 0)); run = null; };
    for (let i = 0; i < nx; i += 1) {
      const s = at(i, j) && !at(i, j - 1) ? -1 : (!at(i, j) && at(i, j - 1) ? 1 : 0);
      if (s && run?.s === s) run.i1 = i + 1;
      else { flush(); if (s) run = { s, i0: i, i1: i + 1 }; }
    }
    flush();
  }
  for (let i = 0; i <= nx; i += 1) {
    let run = null;
    const flush = () => { if (run) side(v(xs[i], ys[run.j0], 0), v(xs[i], ys[run.j1], 0), v(run.s, 0, 0)); run = null; };
    for (let j = 0; j < ny; j += 1) {
      const s = at(i, j) && !at(i - 1, j) ? -1 : (!at(i, j) && at(i - 1, j) ? 1 : 0);
      if (s && run?.s === s) run.j1 = j + 1;
      else { flush(); if (s) run = { s, j0: j, j1: j + 1 }; }
    }
    flush();
  }
  faces[0].edges = edges;
  return faces;
}

// Крыша этажа: плоская плита над частью этажа, не закрытой этажом выше.
function roofFaces(lp, above, z) {
  const t = lp.settings?.exterior || 250;
  const grid = regionGrid([levelFootprint(lp, t)], above ? levelFootprint(above, t) : []);
  return slabFaces(grid, z, z + ROOF_T, ROOF_COLOR, 'roof');
}

// Перекрытие под этажом: где он стоит на нижнем, кроме проёмов лестниц и шахт.
function interfloorFaces(lower, upper, z) {
  const t = (upper.settings?.exterior || 250) + SLAB_OUTSET;
  const grid = regionGrid([levelFootprint(lower, t), levelFootprint(upper, t)], slabCuts(lower, upper));
  return slabFaces(grid, z - SLAB_T, z - 1, SLAB_COLOR, 'slab', { bottom: true });
}

const GROUND_LOW = [0xb9, 0xc9, 0xa6];
const GROUND_HIGH = [0xd9, 0xd2, 0xb4];
const hex = (rgb) => `#${rgb.map((c) => Math.round(c).toString(16).padStart(2, '0')).join('')}`;

// Рельеф для 3D: функция «отметка в осях дома → z над полом 1 этажа».
// Отметка пола — site.terrain.floorZ или средняя под домом (core/terrain.js).
// scale — вертикальное усиление рельефа (дом не масштабируется).
export function terrainHeightFn(project, scale = 1) {
  const model = terrainModel(project.site?.terrain);
  if (!model?.tris?.length) return null;
  const house = houseTerrain(project, model);
  const avg = model.pts.reduce((t, p) => t + p.z, 0) / model.pts.length;
  const floorZ = house ? house.floorZ
    : (Number.isFinite(project.site.terrain.floorZ) ? project.site.terrain.floorZ : avg);
  const b = project.building;
  const fn = (x, y) => {
    const w = toWorld(b, { x, y });
    const z = interpolateZ(model, w.x, w.y, { clamp: true });
    return ((z ?? floorZ) - floorZ) * scale;
  };
  fn.minRel = (model.minZ - floorZ) * scale;
  fn.maxRel = (model.maxZ - floorZ) * scale;
  return fn;
}

// Поверхность рельефа: регулярная сетка по габариту участка; отметки узлов —
// по триангуляции (вне оболочки отметок — по ближайшему её краю).
function terrainGround(minX, minY, maxX, maxY, hz) {
  const faces = [];
  const span = Math.max(maxX - minX, maxY - minY);
  const cell = Math.max(1000, span / 48);
  const nx = Math.max(1, Math.ceil((maxX - minX) / cell));
  const ny = Math.max(1, Math.ceil((maxY - minY) / cell));
  const dx = (maxX - minX) / nx;
  const dy = (maxY - minY) / ny;
  const z = [];
  for (let i = 0; i <= nx; i += 1) {
    z.push([]);
    for (let j = 0; j <= ny; j += 1) z[i].push(hz(minX + i * dx, minY + j * dy) - 5);
  }
  const range = (hz.maxRel - hz.minRel) || 1;
  const color = (zz) => {
    const t = Math.max(0, Math.min(1, (zz - hz.minRel) / range));
    return hex(GROUND_LOW.map((c, k) => c + (GROUND_HIGH[k] - c) * t));
  };
  const tri = (a, b, c) => {
    // Нормаль вверх (в осях дома: y вниз — порядок обхода не важен, берём z>0).
    const ux = b.x - a.x; const uy = b.y - a.y; const uz = b.z - a.z;
    const vx = c.x - a.x; const vy = c.y - a.y; const vz = c.z - a.z;
    let n = v(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
    if (n.z < 0) n = v(-n.x, -n.y, -n.z);
    const len = Math.hypot(n.x, n.y, n.z) || 1;
    faces.push({ pts: [a, b, c], normal: v(n.x / len, n.y / len, n.z / len), color: color((a.z + b.z + c.z) / 3), kind: 'ground' });
  };
  for (let i = 0; i < nx; i += 1) {
    for (let j = 0; j < ny; j += 1) {
      const p00 = v(minX + i * dx, minY + j * dy, z[i][j]);
      const p10 = v(minX + (i + 1) * dx, minY + j * dy, z[i + 1][j]);
      const p11 = v(minX + (i + 1) * dx, minY + (j + 1) * dy, z[i + 1][j + 1]);
      const p01 = v(minX + i * dx, minY + (j + 1) * dy, z[i][j + 1]);
      tri(p00, p10, p11);
      tri(p00, p11, p01);
    }
  }
  return faces;
}

// «Юбка» (цоколь): если рельеф под домом ниже пола 1 этажа — от рельефа до
// пола по контуру каждой комнаты нижнего этажа (с наружной стеной).
function plinthFaces(project, hz) {
  const faces = [];
  const ground = sortedLevels(project)[0];
  if (!ground) return faces;
  const t = project.settings?.exterior || 250;
  for (const r of ground.rooms.filter((room) => !room.parentId && !isOpenRoom(room) && !isShaft(room))) {
    const poly = [
      { x: r.x - t, y: r.y - t }, { x: r.x + r.w + t, y: r.y - t },
      { x: r.x + r.w + t, y: r.y + r.h + t }, { x: r.x - t, y: r.y + r.h + t },
    ];
    const samples = [...poly, { x: r.x + r.w / 2, y: r.y + r.h / 2 }];
    const low = Math.min(...samples.map((p) => hz(p.x, p.y)));
    if (low < -20) faces.push(...prismFaces(poly, low - 50, 0, '#a59d92', 'plinth'));
  }
  return faces;
}

function siteFaces(project, { terrainScale = 1 } = {}) {
  const faces = [];
  const site = project.site;
  const b = project.building;
  const local = (p) => toLocal(b, p);
  const hz = terrainHeightFn(project, terrainScale);
  const zAt = (p) => (hz ? hz(p.x, p.y) : 0);
  const pts = [...(site?.boundary || []).map(local)];
  for (const level of project.levels) for (const r of level.rooms) pts.push(v(r.x, r.y, 0), v(r.x + r.w, r.y + r.h, 0));
  for (const n of site?.neighbors || []) pts.push(...neighborRectCorners(n).map(local));
  if (hz) for (const p of site.terrain.points) pts.push(local(p));
  if (!pts.length) return faces;
  const pad = 15000;
  const minX = Math.min(...pts.map((p) => p.x)) - pad;
  const maxX = Math.max(...pts.map((p) => p.x)) + pad;
  const minY = Math.min(...pts.map((p) => p.y)) - pad;
  const maxY = Math.max(...pts.map((p) => p.y)) + pad;
  if (hz) faces.push(...terrainGround(minX, minY, maxX, maxY, hz));
  else faces.push({ pts: [v(minX, minY, -5), v(maxX, minY, -5), v(maxX, maxY, -5), v(minX, maxY, -5)], normal: v(0, 0, 1), color: '#cfd8c4', kind: 'ground' });
  if (site?.boundary?.length >= 3) {
    // Граница — тонкая полоса чуть над землёй (иначе мерцает при отдалении).
    // На рельефе ребро режется на куски ≤ 2 м, чтобы полоса шла по земле.
    const loc = site.boundary.map(local);
    for (let i = 0; i < loc.length; i += 1) {
      const a0 = loc[i];
      const c0 = loc[(i + 1) % loc.length];
      const len = Math.hypot(c0.x - a0.x, c0.y - a0.y) || 1;
      const nx = (-(c0.y - a0.y) / len) * 120;
      const ny = ((c0.x - a0.x) / len) * 120;
      const parts = hz ? Math.max(1, Math.ceil(len / 2000)) : 1;
      for (let k = 0; k < parts; k += 1) {
        const a = { x: a0.x + ((c0.x - a0.x) * k) / parts, y: a0.y + ((c0.y - a0.y) * k) / parts };
        const c = { x: a0.x + ((c0.x - a0.x) * (k + 1)) / parts, y: a0.y + ((c0.y - a0.y) * (k + 1)) / parts };
        const za = zAt(a) + 20;
        const zc = zAt(c) + 20;
        faces.push({
          pts: [v(a.x - nx, a.y - ny, za), v(c.x - nx, c.y - ny, zc), v(c.x + nx, c.y + ny, zc), v(a.x + nx, a.y + ny, za)],
          normal: v(0, 0, 1), color: '#3a4552', kind: 'boundary', twoSided: true,
        });
      }
    }
  }
  for (const n of site?.neighbors || []) {
    const c = neighborRectCorners(n).map(local);
    const h = n.height || 6000;
    // Соседний дом — призма по повёрнутому прямоугольнику; на рельефе низ —
    // по самому низкому углу, высота — от земли в центре.
    const z0 = hz ? Math.min(...c.map(zAt)) : 0;
    const zTop = (hz ? zAt(local(n)) : 0) + h;
    faces.push({ pts: c.map((p) => v(p.x, p.y, zTop)), normal: v(0, 0, 1), color: '#b8bec6', kind: 'neighbor', twoSided: true });
    for (let i = 0; i < 4; i += 1) {
      const a = c[i];
      const d = c[(i + 1) % 4];
      faces.push({ pts: [v(a.x, a.y, z0), v(d.x, d.y, z0), v(d.x, d.y, zTop), v(a.x, a.y, zTop)], normal: v(0, 0, 0), color: '#b8bec6', kind: 'neighbor', twoSided: true });
    }
  }
  if (hz) faces.push(...plinthFaces(project, hz));
  return faces;
}

// Все грани дома: этажи снизу вверх, перекрытия между ними; roof — плоская
// кровля над каждой частью этажа, не закрытой этажом выше;
// site — земля (с рельефом, если есть отметки), граница и соседи;
// terrainScale — вертикальное усиление рельефа (1×–5×); landscape — объекты
// ландшафта (только вместе с site).
export function buildHouseMesh(project, { roof = false, site = false, terrainScale = 1, landscape = true } = {}) {
  const faces = [];
  const levels = sortedLevels(project);
  for (const level of levels) {
    const lp = levelProject(project, level.id);
    faces.push(...levelFloors(lp, level.elevation));
    faces.push(...buildLevelWalls(project, level.id));
    faces.push(...levelStructures(lp, level.elevation, level.height));
    faces.push(...levelStairs(lp, level.elevation, level.height));
  }
  const lps = levels.map((level) => levelProject(project, level.id));
  for (let k = 1; k < levels.length; k += 1) faces.push(...interfloorFaces(lps[k - 1], lps[k], levels[k].elevation));
  if (roof) {
    levels.forEach((level, k) => faces.push(...roofFaces(lps[k], lps[k + 1], level.elevation + level.height)));
  }
  if (site) faces.push(...siteFaces(project, { terrainScale }));
  // Благоустройство (core/mesh3d-landscape.js): деревья, покрытия, вода, постройки.
  if (site && landscape) faces.push(...landscapeFaces(project, terrainHeightFn(project, terrainScale)));
  return faces;
}
