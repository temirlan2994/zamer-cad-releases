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
import { openingHeight, openingSill } from './opening-preset.js';
import { neighborRectCorners } from './site.js';
import { cutLandscapeGround, landscapeFaces } from './mesh3d-landscape.js';
import { objectOutline } from './landscape.js';
import { houseTerrain, interpolateZ, terrainModel } from './terrain.js';
import { levelWindowOpenings } from './spanning-windows.js';
import { isGlazing } from './glazed-openings.js';
import { wallZRange } from './wall-z-range.js';
import { deriveWalls, openingRect, wallJoinPatches, wallRects } from './walls.js';
import { difference } from './geom/clip.js';
import { gridAxis, mergeCells } from './ortho-grid.js';
import { isFixedSizeComp, partsInHouse } from './composite.js';
import { facadeParts } from './facade.js';
import { furniture3d } from './furniture3d.js';
import { COFFEE_TABLE_DUO } from './furniture-design.js';
import { roomContainsPoint, roomRects } from './room-shape.js';
import { stairAppearance, stairBuild, stairLayout } from './stairs.js';
import { slabOpeningCutRects, slabOpenings } from './slab-openings.js';
import { atriumRails } from './atrium.js';
import { RAILING_INSET, projectRailings } from './railings.js';
import { MASS_COLOR_3D, massBox, clipMassBoxZ } from './masses.js';
import { massGroundFaces } from './mass-ground.js';
import { envelopeOf, resolvedZeroAboveGround } from './envelope.js';
import { clipLinkedRoofFaces, convexStrips, freeDrainageEdges, slopedRoofFaces } from './linked-roof.js';
import { gridOutline, gridRoofRects, linkedRoofRegions } from './linked-roof-regions.js';
export { linkedRoofRegions };
import { deriveFoundation } from './foundation-system.js';
import { deriveEntrances, entranceParts } from './entrance.js';
import {
  EDGE_HEIGHT, FASCIA_T, PARAPET_THICK, edgeSide, expandRects, gridEdges, materialColor, offsetOutline, outlineNormals, ringSpec,
  roofCutRects, roofIsSlanted, roofRects, roofSlabOutline, roofZ, sideDist, triangulate,
} from './roofs.js';

export const WALL_COLOR = '#ece8e1';
export const GLASS_COLOR = '#8fb8dc';
export const DOOR_COLOR = '#b98a5a';
export const WINDOW_FRAME_COLOR = '#353a3f';
const STAIR_COLOR = '#c9c2b7';

const v = (x, y, z) => ({ x, y, z });

export { wallZRange };

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

const boxOverlap3d = (a, b) => Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) > 0.5 &&
  Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0) > 0.5 && Math.min(a.z1, b.z1) - Math.max(a.z0, b.z0) > 0.5;

// Ортогональный solid − union(cuts). Используется для вычитающих масс и
// частичных ниш в плитах. Ячейки одной плоскости пока не сливаются: noEdges
// не даёт внутренних линий, а геометрия и нормали остаются точными.
export function orthoCutFaces(solids, cuts, { color = '#cccccc', kind = 'solid', meta = () => ({}) } = {}) {
  const src = (solids || []).filter((b) => b && b.x1 - b.x0 > 0.5 && b.y1 - b.y0 > 0.5 && b.z1 - b.z0 > 0.5);
  if (!src.length) return [];
  const relevant = (cuts || []).filter((c) => src.some((s) => boxOverlap3d(s, c)));
  const ax = gridAxis([...src, ...relevant].flatMap((b) => [b.x0, b.x1]));
  const ay = gridAxis([...src, ...relevant].flatMap((b) => [b.y0, b.y1]));
  const az = gridAxis([...src, ...relevant].flatMap((b) => [b.z0, b.z1]));
  const xs = ax.coords; const ys = ay.coords; const zs = az.coords;
  const nx = xs.length - 1; const ny = ys.length - 1; const nz = zs.length - 1;
  const owner = new Int32Array(nx * ny * nz).fill(-1);
  const key = (i, j, k) => (k * ny + j) * nx + i;
  // Границы каждого бокса уже входят в сжатые оси: заполняем его диапазон
  // напрямую, без поиска по всем solid/cut для каждой клетки.
  const range = (b) => ({
    i0: ax.at(b.x0), i1: ax.at(b.x1), j0: ay.at(b.y0), j1: ay.at(b.y1), k0: az.at(b.z0), k1: az.at(b.z1),
  });
  src.forEach((b, si) => {
    const r = range(b);
    for (let k = r.k0; k < r.k1; k += 1) for (let j = r.j0; j < r.j1; j += 1) for (let i = r.i0; i < r.i1; i += 1) {
      const at = key(i, j, k);
      if (owner[at] < 0) owner[at] = si;
    }
  });
  for (const b of relevant) {
    const r = range(b);
    for (let k = r.k0; k < r.k1; k += 1) for (let j = r.j0; j < r.j1; j += 1) for (let i = r.i0; i < r.i1; i += 1) {
      owner[key(i, j, k)] = -1;
    }
  }
  const at = (i, j, k) => (i >= 0 && j >= 0 && k >= 0 && i < nx && j < ny && k < nz ? owner[key(i, j, k)] : -1);
  const out = [];
  const add = (pts, normal, face, si) => out.push({ pts, normal, color, kind, face, noEdges: true, ...meta(src[si], si, face) });
  for (let k = 0; k < nz; k += 1) for (let j = 0; j < ny; j += 1) for (let i = 0; i < nx; i += 1) {
    const si = at(i, j, k);
    if (si < 0) continue;
    const x0 = xs[i]; const x1 = xs[i + 1]; const y0 = ys[j]; const y1 = ys[j + 1]; const z0 = zs[k]; const z1 = zs[k + 1];
    if (at(i, j, k + 1) < 0) add([v(x0, y0, z1), v(x1, y0, z1), v(x1, y1, z1), v(x0, y1, z1)], v(0, 0, 1), 'top', si);
    if (at(i, j, k - 1) < 0) add([v(x0, y1, z0), v(x1, y1, z0), v(x1, y0, z0), v(x0, y0, z0)], v(0, 0, -1), 'bottom', si);
    if (at(i + 1, j, k) < 0) add([v(x1, y0, z0), v(x1, y1, z0), v(x1, y1, z1), v(x1, y0, z1)], v(1, 0, 0), 'px', si);
    if (at(i - 1, j, k) < 0) add([v(x0, y1, z0), v(x0, y0, z0), v(x0, y0, z1), v(x0, y1, z1)], v(-1, 0, 0), 'nx', si);
    if (at(i, j + 1, k) < 0) add([v(x1, y1, z0), v(x0, y1, z0), v(x0, y1, z1), v(x1, y1, z1)], v(0, 1, 0), 'py', si);
    if (at(i, j - 1, k) < 0) add([v(x0, y0, z0), v(x1, y0, z0), v(x1, y0, z1), v(x0, y0, z1)], v(0, -1, 0), 'ny', si);
  }
  return out;
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

// Стеклопакет и реальная алюминиевая рама: наружный профиль + импосты.
// Профиль лежит внутри проёма, поэтому не перекрывает стену и корректно
// выглядит и снаружи, и из помещения.
function windowAssemblyFaces(band, orient, a0, a1, z0, z1, opening, ref) {
  if (opening.spanFrameBand) band = opening.spanFrameBand;
  const faces = [];
  const width = a1 - a0;
  const height = z1 - z0;
  if (width < 1 || height < 1) return faces;
  const frame = Math.max(35, Math.min(70, width / 7, (opening.spanPart ? opening.spanTop : height) / 7));
  const cross = orient === 'h' ? band.h : band.w;
  const depth = Math.max(30, Math.min(80, cross * 0.55));
  const mid = orient === 'h' ? band.y + band.h / 2 : band.x + band.w / 2;
  const cross0 = mid - depth / 2;
  const cross1 = mid + depth / 2;
  const color = opening?.frameColor === 'black' ? '#17191c'
    : opening?.frameColor === 'bronze' ? '#5a4a3c' : WINDOW_FRAME_COLOR;
  const addBox = (lo, hi, bottom, top) => {
    if (top <= bottom || hi <= lo) return;
    const list = orient === 'h'
      ? boxFaces(lo, cross0, hi, cross1, bottom, top, color, 'window-frame')
      : boxFaces(cross0, lo, cross1, hi, bottom, top, color, 'window-frame');
    faces.push(...list.map((face) => ({ ...face, openingId: opening.id, ref })));
  };
  faces.push({
    ...paneFace(band, orient, a0, a1, z0, z1, GLASS_COLOR, 0.38, 'glass'),
    openingId: opening.id, openingKind: opening.kind, ref,
  });
  const bottomRail = opening.spanPart === 'upper' ? 0 : frame;
  const topRail = opening.spanPart === 'lower' ? 0 : Math.min(frame, height - bottomRail);
  if (bottomRail) addBox(a0, a1, z0, z0 + bottomRail);
  if (topRail) addBox(a0, a1, z1 - topRail, z1);
  const cornerPost = opening.cornerWing && opening.corner.joint !== 'pier';
  if (!cornerPost || !opening.cornerAtStart) addBox(a0, a0 + frame, z0 + bottomRail, z1 - topRail);
  if (!cornerPost || opening.cornerAtStart) addBox(a1 - frame, a1, z0 + bottomRail, z1 - topRail);
  if (opening.cornerJunction) {
    const junction = opening.cornerJunction;
    const x = junction.x + junction.w / 2;
    const y = junction.y + junction.h / 2;
    const half = depth / 2;
    faces.push(...boxFaces(x - half, y - half, x + half, y + half, z0, z1, color, 'window-frame')
      .map((face) => ({ ...face, openingId: opening.id, ref })));
  }
  const type = opening.type || 'standard';
  let sashes = 1;
  if (type === 'lift-slide' || type === 'sliding') sashes = Math.max(2, Math.round(width / 1600));
  else if (!['awning', 'clerestory'].includes(type)) sashes = Math.max(1, Math.round(width / (type === 'panoramic' ? 1200 : 800)));
  for (let i = 1; i < sashes; i += 1) {
    const x = a0 + (width * i) / sashes;
    addBox(x - frame / 2, x + frame / 2, z0 + bottomRail, z1 - topRail);
  }
  if (type === 'awning' || type === 'clerestory') {
    const z = z0 + height * 0.55;
    addBox(a0 + frame, a1 - frame, z - frame / 2, z + frame / 2);
  }
  if (opening.glazed && opening.kind === 'door') {
    const handle = type === 'double' ? (a0 + a1) / 2 - 110 : a1 - 120;
    const bottom = z0 + Math.min(950, height * .45);
    addBox(handle - 15, handle + 15, bottom, Math.min(z1 - frame, bottom + 250));
  }
  return faces;
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
  for (const o of levelWindowOpenings(lp, walls)) {
    const placed = openingRect(lp, o, walls);
    if (!placed || placed.wall.hidden) continue;
    const r = placed.rect;
    const ri = byWall.get(placed.wall) ?? recs.findIndex((q) => q.wall.key === placed.wall.key);
    const level = (lp.levels || []).find((l) => l.id === lp.activeLevel);
    const wallTop = ri >= 0 ? recs[ri].z1 : height;
    const bottom = openingSill(o, level);
    const top = Math.min(wallTop, bottom + openingHeight(o, level));
    if (top <= bottom || r.w < 0.5 || r.h < 0.5) continue;
    if (o.cornerJunction) voids.push({ r: o.cornerJunction, bottom, top, kind: 'corner-junction', wall: null, rec: -1 });
    voids.push({ r, bottom, top, kind: o.kind, wall: placed.wall, rec: ri, id: o.id, opening: o });
  }
  const level = (lp.levels || []).find((l) => l.id === lp.activeLevel);
  const elevation = Number(level?.elevation) || 0;
  for (const m of lp.massVoids || []) {
    const b = massBox(m);
    const bottom = Math.max(0, b.z0 - elevation);
    const top = Math.min(height, b.z1 - elevation);
    if (top - bottom < 0.5) continue;
    voids.push({
      r: { x: b.x0, y: b.y0, w: b.x1 - b.x0, h: b.y1 - b.y0 },
      bottom, top, kind: 'mass-void', wall: null, rec: -1, id: m.id,
    });
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
function levelWallsV2(lp, walls, z0, height, levelId, apertures) {
  const faces = [];
  // Косые ручные стены живут полигональными телами и не входят в
  // ортогональную сетку ниже. Выдавливаем их точный плановый контур.
  for (const wall of walls) {
    if (wall.hidden || wall.orient !== 'a' || !wall.poly?.length) continue;
    const z = wallZRange(lp, wall, height);
    const list = polySlabFaces(wall.poly, z0 + z.z0, z0 + z.z1, WALL_COLOR, 'wall');
    for (const face of list) faces.push({
      ...face, noEdges: true,
      ref: wallRef(wall, levelId, face.normal.z > 0.5 ? 'top' : face.normal.z < -0.5 ? 'bottom' : 'side'),
    });
  }
  const { recs, voids } = levelWallSolids(lp, walls, height);
  if (apertures) {
    for (const q of voids) if (q.wall) apertures.push({ rect: q.r, orient: q.wall.orient, z0: z0 + q.bottom, z1: z0 + q.top });
  }
  if (!recs.length || height < 0.5) return faces;
  for (const q of voids) {
    if (!isGlazing(q.opening)) continue;
    const orient = q.wall.orient;
    const a0 = orient === 'h' ? q.r.x : q.r.y;
    const a1 = a0 + (orient === 'h' ? q.r.w : q.r.h);
    const opening = q.opening;
    if (opening) faces.push(...windowAssemblyFaces(q.wall.band, orient, a0, a1,
      z0 + q.bottom, z0 + q.top, opening, wallRef(q.wall, levelId, 'glass')));
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
function levelWalls(lp, z0, height, levelId, preparedWalls = null, apertures = null) {
  const faces = [];
  const walls = preparedWalls || deriveWalls(lp);
  if (walls.some((w) => w.rects) || lp.massVoids?.length || lp.openings?.some((o) => o.corner)) return levelWallsV2(lp, walls, z0, height, levelId, apertures);
  const cuts = new Map(); // стена → [{ a0, a1, bottom, top, kind }]
  for (const o of levelWindowOpenings(lp, walls)) {
    const placed = openingRect(lp, o, walls);
    if (!placed) continue;
    const r = placed.rect;
    const along = placed.wall.orient === 'h' ? [r.x, r.x + r.w] : [r.y, r.y + r.h];
    const level = (lp.levels || []).find((l) => l.id === lp.activeLevel);
    const bottom = openingSill(o, level);
    const top = Math.min(height, bottom + openingHeight(o, level));
    if (apertures && !placed.wall.hidden) apertures.push({ rect: r, orient: placed.wall.orient, z0: z0 + bottom, z1: z0 + top });
    if (!cuts.has(placed.wall)) cuts.set(placed.wall, []);
    cuts.get(placed.wall).push({ a0: along[0], a1: along[1], bottom, top, kind: o.kind, id: o.id, opening: o });
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
      if (isGlazing(h.opening)) {
        const opening = h.opening;
        const ref = run.members?.[0] ? wallRef(run.members[0], levelId, 'glass') : null;
        if (opening) faces.push(...windowAssemblyFaces(b, orient, a0, a1,
          z0 + h.bottom, z0 + h.top, opening, ref));
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
export function buildLevelWalls(project, levelId, preparedWalls = null, apertures = null) {
  const level = (project.levels || []).find((l) => l.id === levelId);
  if (!level) return [];
  const faces = levelWalls(levelProject(project, levelId), level.elevation, level.height, levelId, preparedWalls, apertures);
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

function levelFloors(lp, z, levelId) {
  const faces = [];
  // Проём в перекрытии под этажом (над лестницей) — пол вырезан.
  const holes = slabOpenings(lp, levelId).flatMap((o) => slabOpeningCutRects(o));
  // Сначала комнаты верхнего уровня, вложенные — чуть выше (видны поверх).
  const order = [...lp.rooms].sort((a, b) => Number(Boolean(a.parentId)) - Number(Boolean(b.parentId)));
  for (const r of order) {
    if (isShaft(r)) continue;
    const zz = z + (isOpenRoom(r) ? 0 : r.parentId ? 2 : 1);
    const color = roomColors(r.type).floor3d; // цвет типа помещения (как на плане)
    const shaftCuts = lp.rooms.filter((shaft) => isShaft(shaft) &&
      (shaft.parentId === r.id || (!shaft.parentId && !r.parentId))).flatMap(roomRects);
    let floorParts = roomRects(r);
    const massCuts = (lp.massVoids || []).map(massBox)
      .filter((b) => b.z0 <= zz + 0.5 && b.z1 >= zz - 0.5)
      .map((b) => ({ x: b.x0, y: b.y0, w: b.x1 - b.x0, h: b.y1 - b.y0 }));
    for (const cut of [...shaftCuts, ...holes, ...massCuts]) floorParts = floorParts.flatMap((part) => subtractFloorRect(part, cut));
    for (const part of floorParts) {
      faces.push({
        pts: [v(part.x, part.y, zz), v(part.x + part.w, part.y, zz), v(part.x + part.w, part.y + part.h, zz), v(part.x, part.y + part.h, zz)],
        normal: v(0, 0, 1), color, kind: 'floor', roomId: r.id, level: levelId,
      });
    }
  }
  return faces;
}

export const RAILING_COLOR = '#6f6a63';

// Перила открытых помещений (core/railings.js) по сегментам: поручень
// сверху, стойки; «Поручни» — ещё две промежуточные планки, «Балясины» —
// частые стойки, «Стекло» — полупрозрачное полотно. Ось перил — посередине
// полосы перил плана. Грани: kind 'railing', railing { roomId, id }, level.
function railingSegmentFaces(seg, z0) {
  const faces = [];
  const T = 50;
  const axis = seg.edge - seg.outward * (RAILING_INSET / 2);
  const a = seg.a; const b = seg.b;
  if (b - a < 1) return faces;
  const top = z0 + seg.height;
  const bar = (lo, hi, zLo, zHi, color = RAILING_COLOR, t = T) => (seg.orient === 'h'
    ? boxFaces(lo, axis - t / 2, hi, axis + t / 2, zLo, zHi, color, 'railing')
    : boxFaces(axis - t / 2, lo, axis + t / 2, hi, zLo, zHi, color, 'railing'));
  faces.push(...bar(a, b, top - T, top));
  const len = b - a;
  const step = seg.type === 'balusters' ? 150 : seg.type === 'glass' ? 1500 : 1200;
  const n = Math.max(1, Math.round(len / step));
  for (let i = 0; i <= n; i += 1) {
    const c = Math.min(b - T / 2, Math.max(a + T / 2, a + (len * i) / n));
    const t = seg.type === 'balusters' && i > 0 && i < n ? 25 : T;
    faces.push(...bar(c - t / 2, c + t / 2, z0, top - T, RAILING_COLOR, t));
  }
  if (seg.type === 'rails') {
    for (const k of [1 / 3, 2 / 3]) {
      const z = z0 + (seg.height - T) * k;
      faces.push(...bar(a, b, z - 15, z + 15, RAILING_COLOR, 30));
    }
  } else if (seg.type === 'glass') {
    const zLo = z0 + 100; const zHi = top - T;
    const pts = seg.orient === 'h'
      ? [v(a, axis, zLo), v(b, axis, zLo), v(b, axis, zHi), v(a, axis, zHi)]
      : [v(axis, a, zLo), v(axis, b, zLo), v(axis, b, zHi), v(axis, a, zHi)];
    faces.push({
      pts, normal: seg.orient === 'h' ? v(0, 1, 0) : v(1, 0, 0), color: GLASS_COLOR, alpha: 0.35, kind: 'railing', twoSided: true,
    });
  }
  return faces;
}

export function railingFaces(lp, z0, levelId, preparedWalls = null) {
  const faces = projectRailings(lp).flatMap(({ room, seg }) =>
    railingSegmentFaces(seg, z0).map((f) => ({ ...f, railing: { roomId: room.id, id: seg.id }, level: levelId })));
  if (!lp.levels?.find((l) => l.id === levelId)?.slabOpenings?.some((o) => o.atrium?.railing)) return faces;
  const holes = slabOpenings(lp, levelId);
  for (const hole of holes) {
    for (const { a, b } of atriumRails(lp, levelId, hole, holes, preparedWalls)) {
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      const x = (b.x - a.x) / len; const y = (b.y - a.y) / len;
      const rotate = (p) => v(p.x * x - p.y * y, p.x * y + p.y * x, p.z);
      const local = { orient: 'h', a: 0, b: len, edge: 0, outward: 1, height: 1100, type: 'glass' };
      for (const f of railingSegmentFaces(local, z0)) {
        const pts = f.pts.map(rotate).map((p) => v(a.x + p.x, a.y + p.y, p.z));
        faces.push({ ...f, pts, normal: rotate(f.normal), slabOpeningId: hole.id, level: levelId });
      }
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

// Свободные стены и колонны этажа — на всю высоту этажа (выбираются как предмет).
function levelStructures(lp, z0, height, levelId) {
  return lp.items.filter((i) => isStructural(i.kind))
    .flatMap((i) => prismFaces(structuralOutline(i), z0, z0 + height, WALL_COLOR, 'wall')
      .map((f) => ({ ...f, itemId: i.id, level: levelId })));
}

// Прямоугольник в локальных осях предмета (центр — 0, 0; до поворота) → в оси дома.
function localRect(p, x0, y0, x1, y1) {
  const r = ((p.rotation || 0) * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].map(([x, y]) => ({ x: p.x + x * c - y * s, y: p.y + x * s + y * c }));
}

// Эллипс в локальных осях предмета. В 3D он становится аккуратной
// многогранной столешницей и остаётся лёгким для canvas/WebGL-совместимой сетки.
function localEllipse(p, cx, cy, rx, ry, steps = 24) {
  const r = ((p.rotation || 0) * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return Array.from({ length: steps }, (_, i) => {
    const a = (Math.PI * 2 * i) / steps;
    const x = cx + Math.cos(a) * rx;
    const y = cy + Math.sin(a) * ry;
    return { x: p.x + x * c - y * s, y: p.y + x * s + y * c };
  });
}

// Контур коробки мебели: повёрнутый прямоугольник или эллипс (круглый стол, ковёр).
function furnitureOutline(p) {
  const round = /round/.test(p.kind || '');
  return structuralOutline(round ? { ...p, kind: 'column-round' } : { ...p, kind: '' });
}

const FURNITURE_LIFT = 3; // мм над гранью пола (пол — +1/+2), без мерцания

// Объёмы мебели этажа (не конструкции и не лестницы): коробки по габаритам
// предмета (x, y — центр, w×h, поворот) на высоту по виду (core/furniture3d.js),
// низ — на полу (z0 — от пола: верхние шкафы висят). Мягкая мебель — сиденье на
// всю площадь и спинка вдоль задней кромки (−Y; у угла — и вдоль +X).
// Составная мебель — по своим частям (core/composite.js partsInHouse): стол —
// столешница и стулья, диван и кухня — только модули. Верх не выше top.
// { poly, z0, z1, color, itemId } в осях дома — для 3D и теней на плане
// (core/plan-shadows.js).
export function furnitureVolumes(items, top = Infinity, detailed = false) {
  const out = [];
  const box = (poly, lo, hi, item, color) => out.push({ poly, z0: lo, z1: hi, color, itemId: item.id });
  const add = (p, item, spec) => {
    const lift = Number(item.elev3d) || 0;
    const lo = Math.min(top - 1, Math.max(0, (spec.z0 || 0) + lift));
    const hi = Math.min(top, lo + Math.max(1, spec.h));
    if (spec.model === 'upholstered-bed') {
      const d = spec.design;
      const sx = p.w / d.w;
      const sy = p.h / d.h;
      const head = Math.max(120, (d.h - d.mattressH) * 0.6) * sy;
      const mattressW = d.mattressW * sx;
      const mattressH = d.mattressH * sy;
      const mattressY = -p.h / 2 + head;
      box(localRect(p, -p.w / 2, -p.h / 2, p.w / 2, p.h / 2), lo, Math.min(top, lo + d.baseH), item, spec.color);
      box(localRect(p, -mattressW / 2, mattressY, mattressW / 2, mattressY + mattressH),
        Math.min(top, lo + d.mattressZ), Math.min(top, lo + d.mattressZ + d.mattressT), item, '#d7d0c6');
      box(localRect(p, -p.w / 2, -p.h / 2, p.w / 2, -p.h / 2 + head), lo, Math.min(top, lo + d.headboardH), item, '#9d8f80');
      const pillowGap = Math.max(30, mattressW * 0.025);
      const pillowW = d.mattressW > 1000 ? (mattressW - pillowGap * 3) / 2 : mattressW - pillowGap * 2;
      const pillowY = mattressY + 80 * sy;
      const pillowH = Math.min(420 * sy, mattressH * 0.22);
      const pillowZ = Math.min(top, lo + d.mattressZ + d.mattressT);
      const pillowTop = Math.min(top, pillowZ + 100);
      if (d.mattressW > 1000) {
        box(localRect(p, -mattressW / 2 + pillowGap, pillowY, -mattressW / 2 + pillowGap + pillowW, pillowY + pillowH), pillowZ, pillowTop, item, '#eee9e1');
        box(localRect(p, mattressW / 2 - pillowGap - pillowW, pillowY, mattressW / 2 - pillowGap, pillowY + pillowH), pillowZ, pillowTop, item, '#eee9e1');
      } else {
        box(localRect(p, -pillowW / 2, pillowY, pillowW / 2, pillowY + pillowH), pillowZ, pillowTop, item, '#eee9e1');
      }
      return;
    }
    if (spec.model === 'coffee-duo') {
      for (const part of Object.values(COFFEE_TABLE_DUO)) {
        const poly = localEllipse(p, part.cx * p.w, part.cy * p.h, part.rx * p.w, part.ry * p.h);
        const z1 = Math.min(top, lo + part.z);
        box(poly, Math.max(lo, z1 - 70), z1, item, part === COFFEE_TABLE_DUO.large ? '#8f7358' : '#b7a38e');
      }
      return;
    }
    if (detailed && spec.model === 'premium-seat') {
      const back = spec.back === 'part' ? Number(p.back) || 0 : Number(spec.back) || 0;
      const pad = Math.max(25, Math.min(70, p.w * 0.035, p.h * 0.04));
      const baseTop = Math.min(hi, lo + 180);
      const seatTop = Math.min(hi, lo + (Number(spec.seat) || 450));
      // Утопленный цоколь и отдельная мягкая подушка убирают вид «куба».
      box(localRect(p, -p.w / 2 + pad, -p.h / 2 + pad, p.w / 2 - pad, p.h / 2 - pad),
        lo, baseTop, item, '#686762');
      const seatBack = -p.h / 2 + Math.max(back, pad);
      box(localRect(p, -p.w / 2 + pad, seatBack + pad * 0.35, p.w / 2 - pad, p.h / 2 - pad),
        baseTop, seatTop, item, spec.color);
      if (back > 0) {
        box(localRect(p, -p.w / 2 + pad * 0.4, -p.h / 2 + pad * 0.25,
          p.w / 2 - pad * 0.4, -p.h / 2 + back),
        Math.max(baseTop, lo + 300), hi, item, '#817d77');
      }
      if (spec.corner && back > 0) {
        box(localRect(p, p.w / 2 - back, -p.h / 2 + back,
          p.w / 2 - pad * 0.25, p.h / 2 - pad * 0.4),
        Math.max(baseTop, lo + 300), hi, item, '#817d77');
      }
      // У самостоятельного дивана/кресла есть мягкие боковины; у модульного
      // дивана подлокотники приходят отдельными частями sofa:arm.
      if (!String(p.kind).startsWith('sofa:') && p.w > 700) {
        const arm = Math.max(90, Math.min(180, p.w * 0.09));
        const armTop = Math.min(hi, lo + Math.max(620, spec.seat || 450));
        box(localRect(p, -p.w / 2 + pad * 0.2, -p.h / 2 + pad, -p.w / 2 + arm, p.h / 2 - pad),
          baseTop, armTop, item, '#7d7973');
        box(localRect(p, p.w / 2 - arm, -p.h / 2 + pad, p.w / 2 - pad * 0.2, p.h / 2 - pad),
          baseTop, armTop, item, '#7d7973');
      }
      return;
    }
    if (detailed && spec.model === 'sofa-arm') {
      const pad = Math.max(18, Math.min(45, p.w * 0.12));
      box(localRect(p, -p.w / 2 + pad, -p.h / 2 + 35, p.w / 2 - pad, p.h / 2 - 35),
        lo, Math.min(hi, lo + 170), item, '#66645f');
      box(localRect(p, -p.w / 2, -p.h / 2 + 20, p.w / 2, p.h / 2 - 20),
        Math.min(hi, lo + 120), hi, item, spec.color);
      return;
    }
    if (detailed && spec.model === 'table') {
      const slab = Math.max(45, Math.min(90, spec.h * 0.12));
      const leg = Math.max(45, Math.min(90, Math.min(p.w, p.h) * 0.12));
      const inset = Math.max(60, Math.min(180, Math.min(p.w, p.h) * 0.16));
      box(furnitureOutline(p), Math.max(lo, hi - slab), hi, item, spec.color);
      for (const [x, y] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        const cx = x * (p.w / 2 - inset); const cy = y * (p.h / 2 - inset);
        box(localRect(p, cx - leg / 2, cy - leg / 2, cx + leg / 2, cy + leg / 2),
          lo, Math.max(lo + 1, hi - slab), item, '#665444');
      }
      return;
    }
    if (detailed && spec.model === 'cabinet') {
      const plinth = Math.min(120, spec.h * 0.16);
      const inset = Math.max(20, Math.min(60, Math.min(p.w, p.h) * 0.08));
      box(localRect(p, -p.w / 2 + inset, -p.h / 2 + inset, p.w / 2 - inset, p.h / 2 - inset),
        lo, Math.min(hi, lo + plinth), item, '#71675c');
      box(localRect(p, -p.w / 2, -p.h / 2, p.w / 2, p.h / 2),
        Math.min(hi, lo + plinth), hi, item, spec.color);
      // Тонкие фасады читаются в перспективе как двери/ящики, а не монолит.
      const front = Math.max(12, Math.min(30, p.h * 0.08));
      const doors = p.w > 1100 ? 3 : p.w > 650 ? 2 : 1;
      for (let i = 0; i < doors; i += 1) {
        const x0 = -p.w / 2 + (p.w * i) / doors + 8;
        const x1 = -p.w / 2 + (p.w * (i + 1)) / doors - 8;
        box(localRect(p, x0, p.h / 2 - front, x1, p.h / 2),
          Math.min(hi, lo + plinth + 15), Math.max(lo + plinth + 16, hi - 15), item, '#bdab94');
      }
      return;
    }
    if (detailed && spec.model === 'toilet') {
      const bowl = localEllipse(p, 0, p.h * 0.08, p.w * 0.38, p.h * 0.37, 20);
      box(localEllipse(p, 0, p.h * 0.16, p.w * 0.24, p.h * 0.25, 18), lo, Math.min(hi, lo + 230), item, '#d7dde0');
      box(bowl, Math.min(hi, lo + 230), hi, item, '#eef2f4');
      box(localRect(p, -p.w * 0.38, -p.h / 2, p.w * 0.38, -p.h * 0.2), lo, Math.min(hi, lo + 650), item, '#e3e8eb');
      return;
    }
    if (detailed && spec.model === 'vanity') {
      box(localRect(p, -p.w / 2 + 30, -p.h / 2 + 30, p.w / 2 - 30, p.h / 2 - 30),
        lo, Math.max(lo + 1, hi - 90), item, '#b8a996');
      box(furnitureOutline(p), Math.max(lo, hi - 90), hi, item, '#eef1f2');
      box(localEllipse(p, 0, 0, p.w * 0.3, p.h * 0.28, 18), hi - 70, Math.min(top, hi + 5), item, '#cbd9de');
      return;
    }
    const back = spec.back === 'part' ? Number(p.back) || 0 : Number(spec.back) || 0;
    if (!(spec.seat && back > 0 && back < p.h && !/round/.test(p.kind || ''))) {
      box(furnitureOutline(p), lo, hi, item, spec.color);
      return;
    }
    const seat = Math.min(hi, lo + spec.seat);
    box(localRect(p, -p.w / 2, -p.h / 2, p.w / 2, p.h / 2), lo, seat, item, spec.color);
    box(localRect(p, -p.w / 2, -p.h / 2, p.w / 2, -p.h / 2 + back), seat, hi, item, spec.color);
    if (spec.corner) box(localRect(p, p.w / 2 - back, -p.h / 2 + back, p.w / 2, p.h / 2), seat, hi, item, spec.color);
  };
  for (const item of items || []) {
    if (isStructural(item.kind) || item.kind === 'stairs') continue;
    if (!(item.w > 0 && item.h > 0)) continue;
    const parts = item.comp ? partsInHouse(item) : [];
    if (!isFixedSizeComp(item)) add(item, item, furniture3d(item.kind));
    for (const p of parts) add(p, item, furniture3d(p.kind, p.layer));
  }
  return out;
}

// Мебель этажа в 3D — призмы по объёмам (furnitureVolumes). Верх не выше
// перекрытия. Грани: kind 'furniture', itemId, level.
export function furnitureFaces(lp, z0, levelHeight, levelId) {
  const faces = [];
  const top = Math.max(1, levelHeight - 10);
  for (const b of furnitureVolumes(lp.items, top, true)) {
    for (const f of prismFaces(b.poly, z0 + FURNITURE_LIFT + b.z0, z0 + FURNITURE_LIFT + b.z1, b.color, 'furniture')) {
      faces.push({ ...f, itemId: b.itemId, level: levelId });
    }
  }
  return faces;
}

// Лестница в 3D — по конструкции (core/stairs.js stairBuild):
//   closed — монолит: каждая ступень и площадка — коробка от пола;
//   open — проступи-плиты между двумя тетивами, площадка-плита на стойках,
//     под маршем пусто; перила по открытой стороне;
//   cantilever — толстые проступи от стены без тетив, перила со свободной стороны.
// Грани: kind 'stairs', itemId, level, part (tread | riser | stringer | landing |
// post | rail); у верха проступи и площадки — cutZ0 (низ плиты для разреза
// core/section.js), у тетив, стоек и перил — noCut (в разрез не идут).
const STAIR_RISER_COLOR = '#b1a99d';
const TREAD_COLOR = '#d3b68e';
const STRINGER_COLOR = '#8e867b';
const LANDING_COLOR = '#c2bbb0';
const STAIR_PALETTES = {
  wood: { body: '#b9895f', riser: '#9f704c', tread: '#d3a370', stringer: '#76523d', landing: '#c49368' },
  concrete: { body: '#b9bab8', riser: '#9fa09e', tread: '#c9cac7', stringer: '#8f918f', landing: '#b5b6b3' },
  metal: { body: '#73808a', riser: '#59656e', tread: '#929ea6', stringer: '#4d5861', landing: '#7e8a92' },
};
const STAIR_RAIL_COLORS = { wood: '#845b3b', metal: '#5b6670', glass: '#86bdcc' };
const STAIR = {
  tread: 50, nose: 30, stringer: 60, stringerUp: 40, stringerDepth: 300, landing: 180,
  post: 80, cantTread: 80, railH: 900, rail: 50, baluster: 25, railInset: 40,
};

// Коробка с низом (видна снизу у открытой лестницы).
function solidBox(x0, y0, x1, y1, z0, z1, color, kind) {
  const faces = boxFaces(x0, y0, x1, y1, z0, z1, color, kind);
  if (faces.length) faces.push({ pts: [v(x0, y0, z0), v(x0, y1, z0), v(x1, y1, z0), v(x1, y0, z0)], normal: v(0, 0, -1), color, kind });
  return faces;
}

// Локальные оси лестницы → оси дома (отражение по x до поворота).
function stairPlacer(item, levelId) {
  const angle = ((item.rotation || 0) * Math.PI) / 180;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const m = item.mirrored ? -1 : 1;
  const P = (p) => v(item.x + p.x * m * c - p.y * s, item.y + p.x * m * s + p.y * c, p.z);
  const N = (n) => v(n.x * m * c - n.y * s, n.x * m * s + n.y * c, n.z);
  return (face, extra) => ({ ...face, ...extra, pts: face.pts.map(P), normal: N(face.normal), itemId: item.id, level: levelId });
}

// Рамка марша: s — вдоль подъёма от начала (0…L), t — поперёк (0…W).
function flightFrame(f) {
  const along = f.dir.x === 0;
  const o = f.dir.y < 0 ? { x: f.x, y: f.y + f.h } : { x: f.x, y: f.y };
  const d = f.dir;
  const e = along ? { x: 1, y: 0 } : { x: 0, y: 1 };
  const L = along ? f.h : f.w;
  const W = along ? f.w : f.h;
  const at = (s, t, z) => v(o.x + d.x * s + e.x * t, o.y + d.y * s + e.y * t, z);
  return { d, e, L, W, at };
}

// Коробка в рамке марша (оси марша параллельны осям лестницы).
function frameBox(fr, s0, s1, t0, t1, z0, z1, color, bottom = true) {
  const a = fr.at(s0, t0, 0);
  const b = fr.at(s1, t1, 0);
  const make = bottom ? solidBox : boxFaces;
  return make(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.max(a.x, b.x), Math.max(a.y, b.y), z0, z1, color, 'stairs');
}

// Призма с профилем в плоскости (s, z) марша, толщиной t0…t1 поперёк.
function framePrism(fr, profile, t0, t1, color) {
  const faces = [];
  const n = profile.length;
  if (n < 3 || t1 - t0 < 0.5) return faces;
  const cs = profile.reduce((a, p) => a + p.s, 0) / n;
  const cz = profile.reduce((a, p) => a + p.z, 0) / n;
  const side = (t, sign) => {
    const pts = profile.map((p) => fr.at(p.s, t, p.z));
    faces.push({ pts: sign > 0 ? pts : pts.reverse(), normal: v(fr.e.x * sign, fr.e.y * sign, 0), color, kind: 'stairs' });
  };
  side(t0, -1);
  side(t1, 1);
  for (let i = 0; i < n; i += 1) {
    const a = profile[i];
    const b = profile[(i + 1) % n];
    const ds = b.s - a.s;
    const dz = b.z - a.z;
    const len = Math.hypot(ds, dz);
    if (len < 0.5) continue;
    let ns = dz / len;
    let nz = -ds / len;
    if (ns * ((a.s + b.s) / 2 - cs) + nz * ((a.z + b.z) / 2 - cz) < 0) { ns = -ns; nz = -nz; }
    faces.push({
      pts: [fr.at(a.s, t0, a.z), fr.at(b.s, t0, b.z), fr.at(b.s, t1, b.z), fr.at(a.s, t1, a.z)],
      normal: v(fr.d.x * ns, fr.d.y * ns, nz), color, kind: 'stairs',
    });
  }
  return faces;
}

// Сторона марша, обращённая к середине лестницы (к «колодцу»): 0 или W.
function innerSide(fr) {
  const p0 = fr.at(fr.L / 2, 0, 0);
  const p1 = fr.at(fr.L / 2, fr.W, 0);
  return Math.hypot(p1.x, p1.y) < Math.hypot(p0.x, p0.y) ? fr.W : 0;
}

// Перила марша вдоль стороны tc: наклонный поручень над линией носков,
// балясины по проступям, стойки на концах. top — потолок поручня.
function flightRailing(fr, f, zFrom, riserH, tc, top, color = RAILING_COLOR) {
  const S = STAIR;
  const g = fr.L / f.n;
  const nose = (s) => zFrom + riserH + (s * riserH) / g;
  const sa = S.rail / 2;
  let sb = fr.L - S.rail / 2;
  if (Number.isFinite(top)) sb = Math.min(sb, ((top - S.railH - zFrom - riserH) * g) / riserH);
  if (sb - sa < 300) return [];
  const t0 = tc - S.rail / 2;
  const t1 = tc + S.rail / 2;
  const tread = (s) => zFrom + (Math.min(f.n - 1, Math.max(0, Math.floor(s / g))) + 1) * riserH;
  const faces = framePrism(fr, [
    { s: sa, z: nose(sa) + S.railH - S.rail }, { s: sb, z: nose(sb) + S.railH - S.rail },
    { s: sb, z: nose(sb) + S.railH }, { s: sa, z: nose(sa) + S.railH },
  ], t0, t1, color);
  for (const s of [sa, sb]) {
    faces.push(...frameBox(fr, s - S.rail / 2, s + S.rail / 2, t0, t1, tread(s), nose(s) + S.railH - S.rail, color, false));
  }
  const b = S.baluster / 2;
  for (let k = 0; k < f.n; k += 1) {
    const s = (k + 0.5) * g;
    if (s - sa < 2 * S.rail || sb - s < 2 * S.rail) continue;
    faces.push(...frameBox(fr, s - b, s + b, tc - b, tc + b, tread(s), nose(s) + S.railH - S.rail, color, false));
  }
  return faces;
}

// Свободные отрезки краёв площадки, обращённых к середине лестницы (не занятые маршами).
function landingFreeEdges(l, flights) {
  const out = [];
  const edges = [
    { axis: 'y', c: l.y, a: l.x, b: l.x + l.w, out: -1 }, { axis: 'y', c: l.y + l.h, a: l.x, b: l.x + l.w, out: 1 },
    { axis: 'x', c: l.x, a: l.y, b: l.y + l.h, out: -1 }, { axis: 'x', c: l.x + l.w, a: l.y, b: l.y + l.h, out: 1 },
  ];
  for (const e of edges) {
    if (e.out * (0 - e.c) <= 0) continue; // край смотрит наружу, не к середине
    let free = [[e.a, e.b]];
    for (const f of flights) {
      const lo = e.axis === 'y' ? f.y : f.x;
      const hi = e.axis === 'y' ? f.y + f.h : f.x + f.w;
      if (e.c < lo - 0.5 || e.c > hi + 0.5) continue;
      const fa = e.axis === 'y' ? f.x : f.y;
      const fb = e.axis === 'y' ? f.x + f.w : f.y + f.h;
      free = free.flatMap(([a, b]) => [[a, Math.min(b, fa)], [Math.max(a, fb), b]]).filter(([a, b]) => b - a > 1);
    }
    for (const [a, b] of free) out.push({ ...e, a, b });
  }
  return out;
}

// Перила площадки по свободному краю (горизонтальный поручень, балясины).
function landingRailing(e, zL, color = RAILING_COLOR) {
  const S = STAIR;
  const faces = [];
  const c = e.c - e.out * S.railInset;
  const box = (a0, a1, w, z0, z1) => (e.axis === 'y'
    ? boxFaces(a0, c - w / 2, a1, c + w / 2, z0, z1, color, 'stairs')
    : boxFaces(c - w / 2, a0, c + w / 2, a1, z0, z1, color, 'stairs'));
  const top = zL + S.railH;
  faces.push(...box(e.a, e.b, S.rail, top - S.rail, top));
  const len = e.b - e.a;
  const n = Math.max(1, Math.round(len / 150));
  for (let i = 0; i <= n; i += 1) {
    const p = e.a + (len * i) / n;
    const w = i === 0 || i === n ? S.rail : S.baluster;
    const a0 = Math.min(e.b - w, Math.max(e.a, p - w / 2));
    faces.push(...box(a0, a0 + w, w, zL, top - S.rail));
  }
  return faces;
}

// Ступени в 3D: марши и площадки из раскладки лестницы (core/stairs.js).
// Проступь k марша — на высоте (startStep + k) подъёмов, площадка — на своей.
// hasAbove — над этажом есть этаж: иначе поручень не выше перекрытия.
function levelStairs(lp, z0, levelHeight, levelId, hasAbove = false) {
  const faces = [];
  const S = STAIR;
  for (const item of lp.items.filter((candidate) => candidate.kind === 'stairs')) {
    const lay = stairLayout(item, levelHeight);
    const build = stairBuild(item);
    const appearance = stairAppearance(item);
    const legacy = !(item.stairStyle || item.stairMaterial || item.stairRailing || item.stairEnvironment);
    const colors = !legacy && STAIR_PALETTES[appearance.material] ? STAIR_PALETTES[appearance.material] : {
      body: STAIR_COLOR, riser: STAIR_RISER_COLOR, tread: TREAD_COLOR, stringer: STRINGER_COLOR, landing: LANDING_COLOR,
    };
    const railColor = legacy ? RAILING_COLOR : STAIR_RAIL_COLORS[appearance.railing] || RAILING_COLOR;
    const hasRailing = appearance.railing !== 'none';
    const rH = lay.riserH;
    const place = stairPlacer(item, levelId);
    const add = (list, extra) => { for (const f of list) faces.push(place(f, extra)); };
    const addCut = (list, part, cutZ0) => {
      for (const f of list) faces.push(place(f, f.normal.z > 0.5 ? { part, cutZ0 } : { part }));
    };
    const top = hasAbove ? Infinity : z0 + levelHeight - 1;
    const straight = lay.flights.length === 1;
    for (const f of lay.flights) {
      const fr = flightFrame(f);
      const g = fr.L / f.n;
      const zFrom = z0 + (f.startStep - 1) * rH;
      const zTo = z0 + (f.startStep + f.n) * rH;
      const inner = innerSide(fr);
      for (let k = 0; k < f.n; k += 1) {
        const zk = z0 + (f.startStep + k) * rH;
        if (build === 'closed') {
          // Монолит: ступень от пола; подступенок — тоном темнее.
          for (const face of frameBox(fr, k * g, (k + 1) * g, 0, fr.W, z0, zk, colors.body, false)) {
            const riser = face.normal.z < 0.5 && face.normal.x === -fr.d.x && face.normal.y === -fr.d.y;
            faces.push(place(riser ? { ...face, color: colors.riser } : face, { part: face.normal.z > 0.5 ? 'tread' : riser ? 'riser' : 'side' }));
          }
          continue;
        }
        const T = build === 'cantilever' ? S.cantTread : S.tread;
        const t0 = build === 'open' ? S.stringer : 0;
        const t1 = build === 'open' ? fr.W - S.stringer : fr.W;
        addCut(frameBox(fr, Math.max(0, k * g - S.nose), (k + 1) * g, t0, t1, zk - T, zk, colors.tread), 'tread', zk - T);
      }
      if (build === 'open') {
        // Тетивы: верх — на stringerUp над линией носков, низ параллелен, упирается в пол/площадку.
        const up = S.stringerUp;
        const D = S.stringerDepth;
        const sC = Math.max(0, fr.L - (up * g) / rH);
        const s0 = Math.max(0, ((D - up - rH) * g) / rH);
        const profile = [
          { s: 0, z: zFrom }, ...(s0 > 0.5 ? [{ s: Math.min(s0, fr.L), z: zFrom }] : []),
          { s: fr.L, z: Math.max(zFrom, zTo + up - D) }, { s: fr.L, z: zTo }, ...(sC < fr.L - 0.5 ? [{ s: sC, z: zTo }] : []),
          { s: 0, z: zFrom + rH + up },
        ];
        if (s0 <= 0.5) profile[0] = { s: 0, z: zFrom + rH + up - D > zFrom ? zFrom + rH + up - D : zFrom };
        for (const t of [0, fr.W - S.stringer]) add(framePrism(fr, profile, t, t + S.stringer, colors.stringer), { part: 'stringer', noCut: true });
      }
      // Перила: у прямой открытой — с обеих сторон; иначе — со стороны колодца.
      if (hasRailing) {
        const inset = build === 'open' ? S.stringer / 2 : S.railInset;
        const sides = build === 'open' && straight ? [0, fr.W] : [straight ? fr.W : inner];
        for (const side of sides) {
          const tc = side === 0 ? inset : fr.W - inset;
          add(flightRailing(fr, f, zFrom, rH, tc, top, railColor), { part: 'rail', noCut: true, noEdges: true });
        }
      }
    }
    for (const l of lay.landings) {
      const zL = z0 + l.step * rH;
      if (build === 'closed') {
        add(boxFaces(l.x, l.y, l.x + l.w, l.y + l.h, z0, zL, colors.body, 'stairs'), { part: 'landing' });
        if (hasRailing) for (const e of landingFreeEdges(l, lay.flights)) add(landingRailing(e, zL, railColor), { part: 'rail', noCut: true, noEdges: true });
        continue;
      }
      addCut(solidBox(l.x, l.y, l.x + l.w, l.y + l.h, zL - S.landing, zL, colors.landing, 'stairs'), 'landing', zL - S.landing);
      if (build === 'open' && zL - S.landing - z0 > 100) {
        const p = S.post;
        for (const [x, y] of [[l.x, l.y], [l.x + l.w - p, l.y], [l.x, l.y + l.h - p], [l.x + l.w - p, l.y + l.h - p]]) {
          add(boxFaces(x, y, x + p, y + p, z0, zL - S.landing, colors.stringer, 'stairs'), { part: 'post', noCut: true });
        }
      }
      if (hasRailing) for (const e of landingFreeEdges(l, lay.flights)) add(landingRailing(e, zL, railColor), { part: 'rail', noCut: true, noEdges: true });
    }
  }
  return faces;
}

const SLAB_COLOR = '#b9b4ab';
export const ROOF_T = 250;
export const SLAB_T = 300;
const SLAB_OUTSET = 20; // торец перекрытия чуть выступает из стены (без мерцания)

// Пятно плиты: закрытые комнаты со стеной и балконы до их наружного края.
// Балкон объединяется с перекрытием, чтобы у примыкания не было второго торца.
function levelFootprint(lp, offset) {
  return lp.rooms.filter((r) => r.type === 'balcony' || (!r.parentId && !isOpenRoom(r) && !isShaft(r)))
    .flatMap((room) => {
      const margin = isOpenRoom(room) ? 0 : offset;
      return roomRects(room).map((p) => ({ x0: p.x - margin, y0: p.y - margin, x1: p.x + p.w + margin, y1: p.y + p.h + margin }));
    });
}

// Проём в перекрытии: лестничные помещения и шахты обоих этажей и проёмы в
// перекрытии верхнего (над лестницами — авто, ручные; core/slab-openings.js).
function slabCuts(lower, upper) {
  const cuts = [];
  if (lower.openings.some((opening) => opening.span?.levelId === upper.activeLevel)) {
    const walls = deriveWalls(upper);
    for (const opening of levelWindowOpenings(upper, walls)) {
      if (opening.spanPart !== 'upper') continue;
      const { rect, wall } = openingRect(upper, opening, walls);
      // Вырез доходит до внешней грани выступающей плиты.
      const margin = Math.max(0, (upper.settings?.exterior || 250) - wall.thickness) + SLAB_OUTSET;
      const h = wall.orient === 'h';
      const outward = opening.spanOutward;
      cuts.push({
        x0: rect.x - (!h && outward < 0 ? margin : 0),
        x1: rect.x + rect.w + (!h && outward > 0 ? margin : 0),
        y0: rect.y - (h && outward < 0 ? margin : 0),
        y1: rect.y + rect.h + (h && outward > 0 ? margin : 0),
      });
    }
  }
  const linkedOpenings = slabOpenings(upper, upper.activeLevel);
  // Новая лестница создаёт точный связанный проём. Полный legacy-вырез
  // отключаем только у того лестничного помещения, внутри которого находится
  // именно этот проём. Иначе одна новая лестница ошибочно отменяла бы вырезы
  // всех остальных старых stairs-room на этаже.
  const hasLinkedOpening = (room) => linkedOpenings.some((opening) => (
    (opening.stairId && roomContainsPoint(room, opening.x + opening.w / 2, opening.y + opening.h / 2))
    || (opening.atrium && [opening.atrium.upperRoomId, opening.atrium.roomId].includes(room.id))
  ));
  for (const lp of [lower, upper]) {
    for (const r of lp.rooms.filter((room) => isShaft(room)
      || (room.type === 'stairs-room' && !hasLinkedOpening(room)))) {
      for (const p of roomRects(r)) cuts.push({ x0: p.x, y0: p.y, x1: p.x + p.w, y1: p.y + p.h });
    }
  }
  for (const o of linkedOpenings) {
    for (const r of slabOpeningCutRects(o)) cuts.push({ x0: r.x, y0: r.y, x1: r.x + r.w, y1: r.y + r.h });
  }
  return cuts;
}

// Нижняя плита не является межэтажным перекрытием: лестница, ведущая вверх,
// не должна вырезать в ней всё лестничное помещение. Оставляем только шахты
// и явно принадлежащие этому уровню проёмы (например, технический приямок).
function groundSlabCuts(lp) {
  const cuts = lp.rooms.filter(isShaft).flatMap((room) => roomRects(room)
    .map((rect) => ({ x0: rect.x, y0: rect.y, x1: rect.x + rect.w, y1: rect.y + rect.h })));
  for (const opening of slabOpenings(lp, lp.activeLevel)) {
    for (const rect of slabOpeningCutRects(opening)) cuts.push({
      x0: rect.x, y0: rect.y, x1: rect.x + rect.w, y1: rect.y + rect.h,
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

function fasciaRange(z0, z1, height) {
  const top = z1 + 50;
  return { low: Math.min(z0, top - height), top };
}

function fasciaSpec(rects) {
  return { all: [expandRects(rects, FASCIA_T)], none: rects };
}

function linkedSlabFaces(grid, z0, z1, color, kind, oblique, clippedOutline) {
  if (!oblique.length) return slabFaces(grid, z0, z1, color, kind, { bottom: true });
  const outline = clippedOutline || difference(gridOutline(grid), ...oblique);
  return outline.flatMap((polygon) => polygonSlabFaces(polygon, convexStrips(polygon), z0, z1, color, kind, true));
}

// Декор строим по свободным краям, затем обрезаем косыми ручными крышами.
// В месте, где верхний этаж примыкает к кровле, бортик не нужен.
function linkedFlatRoofDetails(region, color, meta) {
  const rects = gridRoofRects(region.grid);
  const { parapetHeight, z, thickness } = region;
  const blocked = region.trimBlocked || region.blocked;
  const oblique = region.trimOblique || region.oblique;
  const deckTop = z + thickness;
  const details = [];
  const part = (spec, lo, hi, kind) => {
    const grid = regionGrid(spec.all, [...(spec.none || []), ...blocked]);
    for (const face of linkedSlabFaces(grid, lo, hi, color, kind, oblique)) {
      Object.assign(face, meta);
      if (face.normal.z > 0.5) face.cutZ0 = lo;
      details.push(face);
    }
  };
  const { low, top } = fasciaRange(z, deckTop, EDGE_HEIGHT.def);
  part(fasciaSpec(rects), low, top, 'fascia');
  if (parapetHeight > 0) {
    // Занятая верхними помещениями часть продолжает основание для расчёта
    // внутреннего отступа. Оставляем только бортик над самой кровлей.
    const width = PARAPET_THICK.def;
    const base = rects.concat(blocked);
    // У косой ручной крыши всё же может быть сторона, точно совпавшая
    // с прямым краем автокрыши. Продолжаем здесь опору на ширину бортика.
    for (const polygon of oblique) {
      const normals = outlineNormals(polygon);
      polygon.forEach((a, i) => {
        const b = polygon[(i + 1) % polygon.length];
        const n = normals[i];
        if (!n || (Math.abs(a.x - b.x) > 0.01 && Math.abs(a.y - b.y) > 0.01)) return;
        const dx = -n.x * width;
        const dy = -n.y * width;
        base.push({ x0: Math.min(a.x, b.x) + Math.min(0, dx), x1: Math.max(a.x, b.x) + Math.max(0, dx),
          y0: Math.min(a.y, b.y) + Math.min(0, dy), y1: Math.max(a.y, b.y) + Math.max(0, dy) });
      });
    }
    const ring = ringSpec(base, {}, sideDist(null, width));
    part({ all: [rects, ring.all[1]], none: ring.none }, deckTop, deckTop + parapetHeight, 'parapet');
  }
  return details;
}

function hasExteriorRoofDrain(region) {
  return region.drainage === 'external' || (region.drainage === 'auto' && region.roofType !== 'flat');
}

// Одна наружная оболочка для соседних помещений без швов по их стыкам.
function autoRoofFaces(region, groundAt) {
  const { grid, id, levelId, z, thickness, roofType: type } = region;
  const meta = { autoRoofId: id, roofId: id, roofSource: 'linked', level: levelId };
  const color = materialColor(region.material);
  const exteriorDrain = hasExteriorRoofDrain(region);
  let faces;
  if (type === 'flat') {
    faces = linkedSlabFaces(grid, z, z + thickness, color, 'roof', region.oblique, region.outline).map((face) => ({
      ...face,
      kind: face.normal.z < -0.5 ? 'roof-soffit' : face.kind,
      roofSurface: face.normal.z > 0.5 ? 'top' : (face.normal.z < -0.5 ? 'bottom' : 'edge'),
      roofThickness: thickness,
      roofType: 'flat', pitchDeg: 0, roofDirection: 'auto',
      ...meta,
      ...(face.normal.z > 0.5 ? { cutZ0: z } : {}),
    }));
    if (exteriorDrain) faces.drainageEdges = gridEdges(grid).map((edge) => ({
      a: { ...edge.a, z: z + thickness }, b: { ...edge.b, z: z + thickness },
      normal: edge.n, kind: 'roof-drain', ...meta,
    }));
  } else {
    faces = slopedRoofFaces(region.slopeGrid, {
      type, pitchDeg: region.pitchDeg, direction: region.direction,
      thickness, z, color,
      kind: 'roof', soffitKind: 'roof-soffit',
      drainage: exteriorDrain,
      ...meta,
    });
  }
  // Наружный водоотвод — настоящая производная геометрия, а не отметка в
  // данных крыши. Изменение уклона сразу переносит желоба и стояки.
  const drainage = faces.drainageEdges || [];
  if (type === 'flat') faces.push(...linkedFlatRoofDetails(region, color, meta));
  else if (region.oblique.length || region.slopeGrid !== grid) faces = clipLinkedRoofFaces(faces, region);
  if (exteriorDrain) {
    const gutters = [];
    const down = new Map();
    const obstacles = { outline: region.outline, blocked: region.trimBlocked || region.blocked,
      oblique: region.trimOblique || region.oblique };
    for (const edge of freeDrainageEdges(drainage, obstacles)) {
      const z0 = Math.min(edge.a.z, edge.b.z) - 90;
      const z1 = Math.max(edge.a.z, edge.b.z) - 10;
      const horizontal = Math.abs(edge.a.x - edge.b.x) >= Math.abs(edge.a.y - edge.b.y);
      const box = horizontal
        ? boxFaces(Math.min(edge.a.x, edge.b.x), edge.a.y - 45, Math.max(edge.a.x, edge.b.x), edge.a.y + 45, z0, z1, '#55626a', 'roof-drain')
        : boxFaces(edge.a.x - 45, Math.min(edge.a.y, edge.b.y), edge.a.x + 45, Math.max(edge.a.y, edge.b.y), z0, z1, '#55626a', 'roof-drain');
      gutters.push(...box.map((face) => ({ ...face, ...meta, roofDrain: 'gutter' })));
      for (const point of [edge.a, edge.b]) {
        const key = `${Math.round(point.x)}:${Math.round(point.y)}`;
        if (!down.has(key) || down.get(key).z < point.z) down.set(key, point);
      }
    }
    for (const point of down.values()) {
      const sampledGround = Number(groundAt?.(point.x, point.y));
      const bottom = Number.isFinite(sampledGround) ? sampledGround : Math.min(0, z);
      const top = point.z - 40;
      if (top - bottom <= 0.5) continue;
      gutters.push(...boxFaces(point.x - 45, point.y - 45, point.x + 45, point.y + 45,
        bottom, top, '#55626a', 'roof-drain')
        .map((face) => ({ ...face, ...meta, roofDrain: 'downpipe' })));
    }
    faces.push(...gutters);
  }
  return faces;
}

// Только производная кровля без сборки стен, полов, мебели и участка.
// Используется 3D и планом кровли, чтобы оба вида показывали один результат.
export function linkedRoofFaces(project, regions = linkedRoofRegions(project)) {
  if (!regions.length) return [];
  // Стояк заканчивается у реальной поверхности земли в локальных осях дома.
  // Без топосъёмки terrainHeightFn использует заданную отметку ±0.000.
  const groundAt = regions.some(hasExteriorRoofDrain) ? (terrainHeightFn(project) || (() => 0)) : null;
  return regions.flatMap((region) => autoRoofFaces(region, groundAt));
}

const FOUNDATION_COLOR = '#8d8982';
const PLINTH_COLOR = '#aaa297';

// Концептуальное основание по объединённому пятну нижнего занятого этажа.
// Геометрия производная: комнаты двигаются — основание обновляется без
// записей в истории. zeroAboveGround задаёт землю относительно ±0.000.
export function foundationFaces(project) {
  const system = deriveFoundation(project);
  if (!system.enabled || !system.levelId) return [];
  const faces = [];
  for (const component of system.components) {
    const kind = component.renderKind === 'plinth' ? 'plinth' : 'foundation';
    const color = kind === 'plinth' ? PLINTH_COLOR
      : component.kind === 'pile' ? '#777570'
        : component.kind === 'basement-wall' ? '#817d76' : FOUNDATION_COLOR;
    const source = component.shape === 'grid'
      ? slabFaces(component.grid, component.z0, component.z1, color, kind, { bottom: true })
      : polySlabFaces(component.points, component.z0, component.z1, color, kind, { bottom: true });
    faces.push(...source.map((face) => ({
      ...face,
      kind,
      level: system.levelId,
      foundationSource: 'linked',
      foundationType: system.type,
      foundationComponentId: component.id,
      foundationComponentKind: component.kind,
      ...(face.normal.z > 0.5 ? { cutZ0: component.z0 } : {}),
    })));
  }
  return faces;
}

const ENTRANCE_COLOR = '#b7aea1';

function faceNormal3d(points) {
  if (points.length < 3) return v(0, 0, 1);
  const a = points[0]; const b = points[1]; const c = points[2];
  const ab = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z };
  const ac = { x: c.x - a.x, y: c.y - a.y, z: c.z - a.z };
  const n = { x: ab.y * ac.z - ab.z * ac.y, y: ab.z * ac.x - ab.x * ac.z, z: ab.x * ac.y - ab.y * ac.x };
  const length = Math.hypot(n.x, n.y, n.z) || 1;
  return v(n.x / length, n.y / length, n.z / length);
}

function rampComponentFaces(ramp, color = ENTRANCE_COLOR) {
  const poly = ramp.polygon || [];
  if (poly.length !== 4 || !(ramp.run > 0.5)) return [];
  const topByIndex = poly.map((point, index) => v(point.x, point.y, index < 2 ? ramp.topZ : ramp.groundZ));
  const top = faceNormal3d(topByIndex).z < 0 ? [...topByIndex].reverse() : topByIndex;
  const baseZ = Math.min(ramp.groundZ - 100, ramp.topZ - 100);
  const bottom = [...poly].reverse().map((point) => v(point.x, point.y, baseZ));
  const faces = [{ pts: top, normal: faceNormal3d(top), color, kind: 'entrance', edges: [] },
    { pts: bottom, normal: v(0, 0, -1), color, kind: 'entrance', edges: [] }];
  for (let i = 0; i < 4; i += 1) {
    const j = (i + 1) % 4;
    const side = [v(poly[i].x, poly[i].y, baseZ), v(poly[j].x, poly[j].y, baseZ), topByIndex[j], topByIndex[i]];
    faces.push({ pts: side, normal: faceNormal3d(side), color, kind: 'entrance', edges: [] });
  }
  faces[0].cutZ0 = baseZ;
  return faces;
}

// Производное крыльцо главного наружного входа. В проекте хранится только
// дверь и параметры оболочки; площадка, ступени и пандус следуют за ними.
export function entranceFaces(project, options = {}) {
  const faces = [];
  for (const entrance of deriveEntrances(project, options)) {
    if (entrance.status === 'pending') continue;
    const color = entrance.color || ENTRANCE_COLOR;
    const tag = (source, component) => source.map((face) => ({
      ...face,
      entranceId: entrance.id,
      entranceComponentId: component.id,
      entranceComponentKind: component.kind,
      openingId: entrance.openingId,
      level: entrance.levelId,
      entranceSource: 'linked',
    }));
    for (const part of entranceParts(entrance)) {
      const landing = part.key === 'landing';
      const base = part.z0;
      const component = { id: landing ? entrance.landing.id : `${entrance.steps.id}:${part.key.slice(5)}`, kind: landing ? 'landing' : 'steps' };
      faces.push(...tag(polySlabFaces(part.polygon, base, part.z, color, landing ? 'entrance' : 'stairs', { bottom: true })
        .map((face) => ({ ...face, stairPart: part.key, ...(face.normal.z > 0.5 ? { cutZ0: base } : {}) })), component));
    }
    if (entrance.ramp?.enabled) faces.push(...tag(rampComponentFaces(entrance.ramp, color), entrance.ramp));
  }
  return faces;
}

// Крыши-плиты (core/roofs.js): плита с выносом (kind 'roof'), край (фасция,
// карниз, капельник — kind 'fascia'), парапет (стенка, стекло, перила,
// ступенчатый — kind 'parapet'). Грани: roofId, level; верхние грани несут
// cutZ0 — низ тела в разрезе (core/section.js). roofs — список (по умолчанию
// project.roofs); color/alpha — призрак инструмента «Крыша».
// Призма над многоугольником (косой контур крыши): верх и низ —
// треугольники (без внутренних рёбер), бока — по рёбрам; рёбра контура — у
// первой грани.
export function polySlabFaces(poly, z0, z1, color, kind, { bottom = true } = {}) {
  return polygonSlabFaces([poly], triangulate(poly), z0, z1, color, kind, bottom);
}

function polygonSlabFaces(rings, caps, z0, z1, color, kind, bottom) {
  const faces = [];
  for (const cap of caps) {
    if (cap.length < 3) continue;
    faces.push({ pts: cap.map((p) => v(p.x, p.y, z1)), normal: v(0, 0, 1), color, kind, edges: [] });
    if (bottom) faces.push({ pts: [...cap].reverse().map((p) => v(p.x, p.y, z0)), normal: v(0, 0, -1), color, kind, edges: [] });
  }
  if (!faces.length) return faces;
  const edges = [];
  rings.forEach((ring, index) => {
    const normals = outlineNormals(ring);
    const sign = index === 0 ? 1 : -1;
    ring.forEach((a, i) => {
      const b = ring[(i + 1) % ring.length];
      const n = normals[i];
      if (!n) return;
      const a0 = v(a.x, a.y, z0); const a1 = v(a.x, a.y, z1);
      const b0 = v(b.x, b.y, z0); const b1 = v(b.x, b.y, z1);
      faces.push({ pts: [a0, b0, b1, a1], normal: v(sign * n.x, sign * n.y, 0), color, kind, edges: [] });
      edges.push([a1, b1], [a0, b0], [a0, a1]);
    });
  });
  faces[0].edges = edges;
  return faces;
}

// Кольцо между контурами outer и inner (одинаковое число точек, ребро i к
// ребру i): верх, низ, наружная и внутренняя стенки, торцы там, где ширина
// кольца обрывается в ноль (on[i] = false — выключенная сторона парапета).
export function polyRingFaces(outer, inner, z0, z1, color, kind, on = null) {
  const n = outer.length;
  if (n < 3 || inner.length !== n) return [];
  const faces = [];
  const edges = [];
  const N = outlineNormals(outer);
  const gap = (i) => {
    const j = (i + 1) % n;
    return Math.hypot(outer[i].x - inner[i].x, outer[i].y - inner[i].y) + Math.hypot(outer[j].x - inner[j].x, outer[j].y - inner[j].y);
  };
  const wide = outer.map((_p, i) => (on ? on[i] : gap(i) > 1) && N[i]);
  const P = (p, z) => v(p.x, p.y, z);
  for (let i = 0; i < n; i += 1) {
    if (!wide[i]) continue;
    const j = (i + 1) % n;
    const o0 = outer[i]; const o1 = outer[j]; const i0 = inner[i]; const i1 = inner[j];
    faces.push({ pts: [P(o0, z1), P(o1, z1), P(i1, z1), P(i0, z1)], normal: v(0, 0, 1), color, kind, edges: [] });
    faces.push({ pts: [P(i0, z0), P(i1, z0), P(o1, z0), P(o0, z0)], normal: v(0, 0, -1), color, kind, edges: [] });
    faces.push({ pts: [P(o0, z0), P(o1, z0), P(o1, z1), P(o0, z1)], normal: v(N[i].x, N[i].y, 0), color, kind, edges: [] });
    faces.push({ pts: [P(i1, z0), P(i0, z0), P(i0, z1), P(i1, z1)], normal: v(-N[i].x, -N[i].y, 0), color, kind, edges: [] });
    edges.push([P(o0, z1), P(o1, z1)], [P(i0, z1), P(i1, z1)], [P(o0, z0), P(o1, z0)], [P(i0, z0), P(i1, z0)]);
    const prev = (i - 1 + n) % n;
    if (!wide[prev]) {
      faces.push({ pts: [P(o0, z0), P(i0, z0), P(i0, z1), P(o0, z1)], normal: v(N[prev]?.x || 0, N[prev]?.y || 0, 0), color, kind, edges: [] });
    }
    if (!wide[j]) {
      faces.push({ pts: [P(i1, z0), P(o1, z0), P(o1, z1), P(i1, z1)], normal: v(N[j]?.x || 0, N[j]?.y || 0, 0), color, kind, edges: [] });
    }
    edges.push([P(o0, z0), P(o0, z1)], [P(i0, z0), P(i0, z1)]);
  }
  if (faces.length) faces[0].edges = edges;
  return faces;
}

// Косая крыша: те же части, что на сетке прямоугольников, но многоугольником
// (пятно этажа выше не вырезается — у косой плиты своей формы его нет).
function slantedRoofParts(roof, slab, z, mat, edgeColor, add) {
  const { z0, z1 } = z;
  const T = roof.thickness;
  const off = (d, base = slab) => offsetOutline(base, d, { bevel: false });
  add(polySlabFaces(slab, z0, z1, mat, 'roof'), 'roof', z0);
  const e = roof.edge;
  if (e.type === 'fascia') {
    const { low, top } = fasciaRange(z0, z1, e.height);
    add(polyRingFaces(off(FASCIA_T), slab, low, top, edgeColor, 'fascia'), 'fascia', low);
  } else if (e.type === 'cornice') {
    const lo = z1 - Math.max(80, Math.round(T * 0.45));
    add(polyRingFaces(off(90), slab, lo, z1, edgeColor, 'fascia'), 'fascia', lo);
  } else if (e.type === 'drip') {
    add(polyRingFaces(slab, off(-40), z0 - 40, z0, edgeColor, 'fascia'), 'fascia', z0 - 40);
  }
  const p = roof.parapet;
  if (p.type === 'none') return;
  const on = (n) => p.sides?.[edgeSide(n)] !== false;
  const inset = (d) => off((n) => (on(n) ? -d : 0));
  const sideOn = outlineNormals(slab).map((n) => Boolean(n) && on(n));
  const ring = (from, to, zz0, zz1, c, extra) => add(polyRingFaces(inset(from), inset(to), zz0, zz1, c, 'parapet', sideOn), 'parapet', zz0, extra);
  const pt = p.thickness;
  if (p.type === 'wall') ring(p.inset, p.inset + pt, z1, z1 + p.height, mat);
  else if (p.type === 'stepped') {
    ring(p.inset, p.inset + pt, z1, z1 + p.height, mat);
    ring(p.inset + pt, p.inset + 2 * pt, z1, z1 + Math.round(p.height / 2), mat);
  } else if (p.type === 'glass') {
    ring(p.inset, p.inset + 60, z1, z1 + 80, edgeColor);
    ring(p.inset + 20, p.inset + 40, z1 + 80, z1 + p.height, GLASS_COLOR, { glass: true });
  } else if (p.type === 'rail') {
    const R = 50;
    const top = z1 + p.height;
    ring(p.inset, p.inset + R, top - R, top, RAILING_COLOR);
    for (const k of [1 / 3, 2 / 3]) {
      const zz = z1 + (p.height - R) * k;
      ring(p.inset + 10, p.inset + 40, zz - 15, zz + 15, RAILING_COLOR);
    }
    const line = inset(p.inset + R / 2);
    const N = outlineNormals(slab);
    if (line.length !== slab.length) return;
    line.forEach((a, i) => {
      if (!N[i] || !on(N[i])) return;
      const b = line[(i + 1) % line.length];
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      const cnt = Math.max(1, Math.round(len / 1200));
      for (let k = 0; k <= cnt; k += 1) {
        const cx = a.x + ((b.x - a.x) * k) / cnt;
        const cy = a.y + ((b.y - a.y) * k) / cnt;
        add(boxFaces(cx - R / 2, cy - R / 2, cx + R / 2, cy + R / 2, z1, top - R, RAILING_COLOR, 'parapet'), 'parapet', null);
      }
    });
  }
}

export function roofFaces(project, roofs = project?.roofs, { color = null, alpha = null } = {}) {
  const out = [];
  for (const roof of roofs || []) {
    const z = roofZ(project, roof);
    const rects = z ? roofRects(project, roof) : [];
    if (!rects.length) continue;
    const mat = color || materialColor(roof.material);
    const edgeColor = color || roof.edge.color || mat;
    const tag = (list, kind, cutZ0, extra = {}) => {
      for (const f of list) {
        const g = { ...f, kind, roofId: roof.id, level: roof.levelId, ...extra };
        if (f.normal.z > 0.5 && cutZ0 != null) g.cutZ0 = cutZ0;
        if (alpha != null) { g.alpha = alpha; g.twoSided = true; }
        out.push(g);
      }
    };
    if (roofIsSlanted(roof)) {
      const slab = roofSlabOutline(project, roof);
      if (slab.length < 3) continue;
      slantedRoofParts(roof, slab, z, mat, edgeColor, (list, kind, cutZ0, extra = {}) => {
        const more = extra.glass ? (alpha == null ? { alpha: 0.35, twoSided: true } : {}) : extra;
        tag(list, kind, cutZ0, more);
      });
      continue;
    }
    // Над пятном этажа выше плиты нет — там перекрытие (козырёк вокруг верхнего этажа).
    const cut = roofCutRects(project, roof);
    const slab = (spec, z0, z1, c, kind, extra) => tag(slabFaces(regionGrid(spec.all, [...(spec.none || []), ...cut]), z0, z1, c, kind, { bottom: true }), kind, z0, extra);
    const { z0, z1 } = z;
    const T = roof.thickness;
    slab({ all: [rects] }, z0, z1, mat, 'roof');
    // Край плиты.
    const e = roof.edge;
    if (e.type === 'fascia') {
      const { low, top } = fasciaRange(z0, z1, e.height);
      slab(fasciaSpec(rects), low, top, edgeColor, 'fascia');
    } else if (e.type === 'cornice') {
      slab({ all: [expandRects(rects, 90)], none: rects }, z1 - Math.max(80, Math.round(T * 0.45)), z1, edgeColor, 'fascia');
    } else if (e.type === 'drip') {
      slab(ringSpec(rects, {}, sideDist(null, 40)), z0 - 40, z0, edgeColor, 'fascia');
    }
    // Парапет.
    const p = roof.parapet;
    const ring = (from, to) => ringSpec(rects, sideDist(p.sides, from), sideDist(p.sides, to));
    const pt = p.thickness;
    if (p.type === 'wall') slab(ring(p.inset, p.inset + pt), z1, z1 + p.height, mat, 'parapet');
    else if (p.type === 'stepped') {
      slab(ring(p.inset, p.inset + pt), z1, z1 + p.height, mat, 'parapet');
      slab(ring(p.inset + pt, p.inset + 2 * pt), z1, z1 + Math.round(p.height / 2), mat, 'parapet');
    } else if (p.type === 'glass') {
      slab(ring(p.inset, p.inset + 60), z1, z1 + 80, edgeColor, 'parapet');
      slab(ring(p.inset + 20, p.inset + 40), z1 + 80, z1 + p.height, GLASS_COLOR, 'parapet', alpha == null ? { alpha: 0.35, twoSided: true } : {});
    } else if (p.type === 'rail') {
      const R = 50;
      const top = z1 + p.height;
      slab(ring(p.inset, p.inset + R), top - R, top, RAILING_COLOR, 'parapet');
      for (const k of [1 / 3, 2 / 3]) {
        const zz = z1 + (p.height - R) * k;
        slab(ring(p.inset + 10, p.inset + 40), zz - 15, zz + 15, RAILING_COLOR, 'parapet');
      }
      // Стойки — по рёбрам контура, сжатого на отступ + полстойки (только включённые стороны).
      const inner = ringSpec(rects, {}, sideDist(p.sides, p.inset + R / 2));
      const posts = regionGrid([rects], inner.all[1]);
      for (const ed of gridEdges(posts)) {
        if (p.sides?.[edgeSide(ed.n)] === false) continue;
        const len = Math.hypot(ed.b.x - ed.a.x, ed.b.y - ed.a.y);
        const n = Math.max(1, Math.round(len / 1200));
        for (let i = 0; i <= n; i += 1) {
          const cx = ed.a.x + ((ed.b.x - ed.a.x) * i) / n;
          const cy = ed.a.y + ((ed.b.y - ed.a.y) * i) / n;
          tag(boxFaces(cx - R / 2, cy - R / 2, cx + R / 2, cy + R / 2, z1, top - R, RAILING_COLOR, 'parapet'), 'parapet', null);
        }
      }
    }
  }
  return out;
}

// Перекрытие под этажом: где он стоит на нижнем, кроме проёмов лестниц и шахт.
function interfloorFaces(lower, upper, z) {
  const t = (upper.settings?.exterior || 250) + SLAB_OUTSET;
  // Плита принадлежит верхнему этажу. Поэтому консоль верхнего объёма тоже
  // получает перекрытие; наличие опоры ниже проверяется отдельно аналитикой.
  const grid = regionGrid([levelFootprint(upper, t)], slabCuts(lower, upper));
  const level = upper.levels?.find((candidate) => candidate.id === upper.activeLevel);
  const thickness = Math.min(600, Math.max(120, Number(level?.slabThickness) || SLAB_T));
  const z0 = z - thickness; const z1 = z - 1;
  const voids = (upper.massVoids || []).map(massBox).filter((b) => b.z0 < z1 - 0.5 && b.z1 > z0 + 0.5);
  if (!voids.length) return slabFaces(grid, z0, z1, SLAB_COLOR, 'slab', { bottom: true })
    .map((face) => ({
      ...face,
      level: upper.activeLevel,
      slabRole: 'interfloor',
      cutZ0: face.normal.z > 0.5 ? z0 : undefined,
    }));
  const solids = [];
  for (let j = 0; j < grid.ny; j += 1) for (let i = 0; i < grid.nx; i += 1) {
    if (!grid.mask[j * grid.nx + i]) continue;
    solids.push({ x0: grid.xs[i], y0: grid.ys[j], x1: grid.xs[i + 1], y1: grid.ys[j + 1], z0, z1 });
  }
  return orthoCutFaces(solids, voids, {
    color: SLAB_COLOR, kind: 'slab',
    meta: (_solid, _index, face) => ({
      level: upper.activeLevel,
      slabRole: 'interfloor',
      ...(face === 'top' ? { cutZ0: z0 } : {}),
    }),
  });
}

// Плита под нижним этажом — отдельное связанное тело, а не только условная
// штриховка в разрезе. Верх опущен на 1 мм относительно чистого пола, чтобы
// цветная поверхность помещения не мерцала с бетоном в 3D.
function groundSlabFaces(lp, z, thickness) {
  const t = (lp.settings?.exterior || 250) + SLAB_OUTSET;
  const grid = regionGrid([levelFootprint(lp, t)], groundSlabCuts(lp));
  const z0 = z - thickness;
  return slabFaces(grid, z0, z - 1, SLAB_COLOR, 'slab', { bottom: true })
    .map((face) => ({
      ...face,
      level: lp.activeLevel,
      slabRole: 'ground',
      cutZ0: face.normal.z > 0.5 ? z0 : undefined,
    }));
}

// Плита относится к этажу над ней. Её геометрия общая у модели дома и разреза участка.
export function floorSlabFaces(project, levels = sortedLevels(project), lps = levels.map((l) => levelProject(project, l.id)), shown = null) {
  const { slabs } = envelopeOf(project);
  if (!slabs.enabled) return [];
  const ground = lps.findIndex((lp) => levelFootprint(lp, lp.settings?.exterior || 250).length);
  return levels.flatMap((level, k) => {
    if (shown && !shown.has(level.id)) return [];
    if (k === ground) {
      return groundSlabFaces(lps[k], level.elevation, Math.min(800, Math.max(120, Number(slabs.groundThickness) || SLAB_T)));
    }
    return k > 0 ? interfloorFaces(lps[k - 1], lps[k], level.elevation) : [];
  });
}

const GROUND_LOW = [0xb9, 0xc9, 0xa6];
const GROUND_HIGH = [0xd9, 0xd2, 0xb4];
const hex = (rgb) => `#${rgb.map((c) => Math.round(c).toString(16).padStart(2, '0')).join('')}`;

// Рельеф для 3D: функция «отметка в осях дома → z над полом 1 этажа».
// Отметка пола — site.terrain.floorZ или средняя под домом (core/terrain.js).
// scale — вертикальное усиление рельефа (дом не масштабируется).
export function terrainHeightFn(project, scale = 1) {
  const model = terrainModel(project.site?.terrain);
  if (!model?.tris?.length) {
    const zero = resolvedZeroAboveGround(project);
    if (zero == null) return null;
    const flat = () => -zero;
    flat.minRel = -zero;
    flat.maxRel = -zero;
    flat.flat = true;
    flat.siteDatum = -zero;
    return flat;
  }
  const house = houseTerrain(project, model);
  const avg = model.pts.reduce((t, p) => t + p.z, 0) / model.pts.length;
  const floorZ = house ? house.floorZ
    : (Number.isFinite(project.site.terrain.floorZ) ? project.site.terrain.floorZ : avg);
  const b = project.building;
  const relativeDatum = project.envelope?.zeroAboveGround != null;
  const zero = relativeDatum ? resolvedZeroAboveGround(project, house) : null;
  const reference = house?.groundReferenceZ ?? avg;
  const rel = (z) => (relativeDatum ? (z - reference) * scale - zero : (z - floorZ) * scale);
  const fn = (x, y) => {
    const w = toWorld(b, { x, y });
    const z = interpolateZ(model, w.x, w.y, { clamp: true });
    return rel(z ?? floorZ);
  };
  fn.siteDatum = rel(reference);
  fn.minRel = rel(model.minZ);
  fn.maxRel = rel(model.maxZ);
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

function siteFaces(project, { terrainScale = 1, landscape = true } = {}) {
  let faces = [];
  const site = project.site;
  const b = project.building;
  const local = (p) => toLocal(b, p);
  const hz = terrainHeightFn(project, terrainScale);
  const zAt = (p) => (hz ? hz(p.x, p.y) : 0);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const include = ({ x, y }) => {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  };
  for (const p of site?.boundary || []) include(local(p));
  for (const level of project.levels) for (const r of level.rooms) {
    include(r);
    include({ x: r.x + r.w, y: r.y + r.h });
  }
  for (const n of site?.neighbors || []) for (const p of neighborRectCorners(n)) include(local(p));
  for (const p of site?.terrain?.points || []) include(local(p));
  for (const o of site?.landscape?.objects || []) {
    for (const p of objectOutline(o, 8)) include(local(p));
  }
  if (!Number.isFinite(minX)) return faces;
  const pad = 15000;
  minX -= pad; minY -= pad; maxX += pad; maxY += pad;
  if (hz && !hz.flat) faces.push(...terrainGround(minX, minY, maxX, maxY, hz));
  else {
    const groundZ = hz ? hz(0, 0) : 0;
    faces.push({ pts: [v(minX, minY, groundZ - 5), v(maxX, minY, groundZ - 5), v(maxX, maxY, groundZ - 5), v(minX, maxY, groundZ - 5)], normal: v(0, 0, 1), color: '#cfd8c4', kind: 'ground' });
  }
  if (landscape) faces = cutLandscapeGround(faces, project, hz);
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
      const parts = hz && !hz.flat ? Math.max(1, Math.ceil(len / 2000)) : 1;
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
  const hasDatum = project.envelope?.zeroAboveGround != null || Number.isFinite(site?.terrain?.floorZ);
  if (hz && !hasDatum) faces.push(...plinthFaces(project, hz));
  return faces;
}

// Все грани дома: этажи снизу вверх, перекрытия между ними; roof — плоская
// кровля над каждой частью этажа, не закрытой этажом выше;
// site — земля (с рельефом, если есть отметки), граница и соседи;
// terrainScale — вертикальное усиление рельефа (1×–5×); landscape — объекты
// ландшафта (только вместе с site).
// furniture — мебель (грани kind 'furniture'; только для окна 3D: фасады,
// разрезы, листы и габарит её не берут — по умолчанию выключена).
// masses — массы (core/masses.js), как мебель — только для окна 3D.
// roofs — крыши-плиты (core/roofs.js), по умолчанию включены везде (3D,
// фасады, разрезы, листы).
// levels — какие этажи показывать: 'all' (по умолчанию), 'upto' — до
// активного (project.activeLevel) включительно, 'only' — только активный;
// связанная кровля (флажок roof) принадлежит своему этажу. При скрытии
// этажа сверху вырез под ним сохраняется.
export function shownLevelIds(project, mode = 'all') {
  const levels = sortedLevels(project);
  if (mode !== 'upto' && mode !== 'only') return levels.map((l) => l.id);
  const k = Math.max(0, levels.findIndex((l) => l.id === project.activeLevel));
  return mode === 'only' ? [levels[k].id] : levels.slice(0, k + 1).map((l) => l.id);
}

// Фасад может пересекать несколько этажей. Отбор по пересечению недостаточен:
// в ограниченном виде режем его по верху показанного этажа и низу текущего.
// У нижнего этажа сохраняется цоколь ниже ±0.000.
export function facadeLevelBounds(project, mode = 'all') {
  if (mode !== 'only' && mode !== 'upto') return null;
  const levels = sortedLevels(project);
  const index = Math.max(0, levels.findIndex((l) => l.id === project.activeLevel));
  const level = levels[index];
  return level ? { z0: mode === 'only' && index > 0 ? level.elevation : -Infinity, z1: level.elevation + level.height } : null;
}

// Массы (core/masses.js) — боксы с контурами (обычные — непрозрачные белые;
// прозрачной становится только выбранная, см. faceAlpha в ui/view3d.js): 6 граней kind
// 'mass' с massId и face ('top' | 'bottom' | 'px' | 'nx' | 'py' | 'ny').
// Только для окна 3D (опция masses у buildHouseMesh).
export function massFaces(masses, { alpha = 1, voids = [], apertures = [], facadeClip = null } = {}) {
  const out = [];
  for (const m of masses || []) {
    const b = massBox(m);
    const color = m.color || MASS_COLOR_3D;
    const cuts = (voids || []).map(massBox).filter((cut) => boxOverlap3d(b, cut));
    if (m.facadeKind) {
      if (['slats', 'stone'].includes(m.facadeKind)) {
        const alongX = m.rotation % 180 === 0;
        for (const hole of apertures) {
          if ((hole.orient === 'h') !== alongX) continue;
          const r = hole.rect;
          const lo = alongX ? r.y : r.x;
          const hi = lo + (alongX ? r.h : r.w);
          const near = alongX ? b.y0 : b.x0;
          const far = alongX ? b.y1 : b.x1;
          if (near > hi + 2 || far < lo - 2) continue;
          cuts.push({ x0: alongX ? r.x : b.x0, x1: alongX ? r.x + r.w : b.x1,
            y0: alongX ? b.y0 : r.y, y1: alongX ? b.y1 : r.y + r.h, z0: hole.z0, z1: hole.z1 });
        }
      }
      for (const original of facadeParts(m)) {
        const part = clipMassBoxZ(original, facadeClip);
        if (!part) continue;
        const meta = () => ({ massId: m.id, facadeKind: m.facadeKind, alpha, flat: m.facadeKind === 'light' });
        const relevant = cuts.filter((cut) => boxOverlap3d(part, cut));
        if (relevant.length) out.push(...orthoCutFaces([part], relevant, { color: part.color, kind: 'mass', meta }));
        else {
          const { x0, y0, x1, y1, z0, z1 } = part;
          const sides = boxFaces(x0, y0, x1, y1, z0, z1, part.color, 'mass');
          sides.push({ pts: [v(x0,y0,z0), v(x0,y1,z0), v(x1,y1,z0), v(x1,y0,z0)], normal: v(0,0,-1), color: part.color, kind: 'mass' });
          for (const side of sides) out.push({ ...side, ...meta(), noEdges: true });
        }
      }
      continue;
    }
    if (cuts.length) {
      out.push(...orthoCutFaces([{ ...b, mass: m }], cuts, {
        color, kind: 'mass', meta: () => ({ massId: m.id, alpha }),
      }));
      continue;
    }
    const P = {
      a: v(b.x0, b.y0, b.z0), b: v(b.x1, b.y0, b.z0), c: v(b.x1, b.y1, b.z0), d: v(b.x0, b.y1, b.z0),
      A: v(b.x0, b.y0, b.z1), B: v(b.x1, b.y0, b.z1), C: v(b.x1, b.y1, b.z1), D: v(b.x0, b.y1, b.z1),
    };
    const quad = (face, k, normal, edges) => out.push({
      pts: k.map((n) => P[n]), normal, color, kind: 'mass', massId: m.id, face, alpha,
      edges: edges.map(([p, q]) => [P[p], P[q]]),
    });
    quad('top', ['A', 'B', 'C', 'D'], v(0, 0, 1), [['A', 'B'], ['B', 'C'], ['C', 'D'], ['D', 'A']]);
    quad('bottom', ['a', 'd', 'c', 'b'], v(0, 0, -1), [['a', 'b'], ['b', 'c'], ['c', 'd'], ['d', 'a']]);
    quad('ny', ['a', 'b', 'B', 'A'], v(0, -1, 0), [['a', 'A'], ['b', 'B']]);
    quad('py', ['c', 'd', 'D', 'C'], v(0, 1, 0), [['c', 'C'], ['d', 'D']]);
    quad('nx', ['d', 'a', 'A', 'D'], v(-1, 0, 0), []);
    quad('px', ['b', 'c', 'C', 'B'], v(1, 0, 0), []);
  }
  return out;
}

// Полупрозрачные боксы cutter-ов: UI может показывать их при выборе/правке,
// при этом они не участвуют в solid/pick без явного использования функции.
export function massVoidFaces(voids, { alpha = 0.12 } = {}) {
  return massFaces(voids, { alpha }).map((f) => ({ ...f, kind: 'massVoid', voidId: f.massId }));
}

// Крыши, видимые при режиме этажей: этаж крыши показан и этаж над ним тоже
// (иначе плита закрыла бы показанный верхний этаж).
export function shownRoofs(project, mode = 'all') {
  const levels = sortedLevels(project);
  const shown = new Set(shownLevelIds(project, mode));
  const k = new Map(levels.map((l, i) => [l.id, i]));
  return (project.roofs || []).filter((r) => {
    const above = levels[(k.get(r.levelId) ?? -2) + 1];
    return shown.has(r.levelId) && (!above || shown.has(above.id));
  });
}

export function buildHouseMesh(project, {
  roof = false, site = false, terrainScale = 1, landscape = true, furniture = false, levels: levelMode = 'all',
  masses = false, facades = true, facadeApertures = [], roofs = true, evening = false,
} = {}) {
  const faces = [];
  const levels = sortedLevels(project);
  const envelope = envelopeOf(project);
  const shown = new Set(shownLevelIds(project, levelMode));
  const lps = levels.map((level) => levelProject(project, level.id));
  // Одна 3D-сборка использует одни и те же стены для тела дома и входной
  // группы. Карта устраняет второй deriveWalls() у занятого нижнего этажа.
  const wallsByLevel = new Map();
  const collectApertures = facades && project.masses?.some((m) => m.facadeKind);
  levels.forEach((level, k) => {
    if (!shown.has(level.id)) return;
    const lp = lps[k];
    const walls = deriveWalls(lp);
    wallsByLevel.set(level.id, walls);
    faces.push(...levelFloors(lp, level.elevation, level.id));
    faces.push(...railingFaces(lp, level.elevation, level.id, walls));
    faces.push(...buildLevelWalls(project, level.id, walls, collectApertures ? facadeApertures : null));
    faces.push(...levelStructures(lp, level.elevation, level.height, level.id));
    faces.push(...levelStairs(lp, level.elevation, level.height, level.id, k < levels.length - 1));
    if (furniture) faces.push(...furnitureFaces(lp, level.elevation, level.height, level.id));
  });
  faces.push(...floorSlabFaces(project, levels, lps, shown));
  const foundation = foundationFaces(project);
  if (foundation.some((face) => shown.has(face.level))) faces.push(...foundation.filter((face) => shown.has(face.level)));
  const entrances = entranceFaces(project, { wallsByLevel });
  if (entrances.some((face) => shown.has(face.level))) faces.push(...entrances.filter((face) => shown.has(face.level)));
  if (roof && envelope.roofMode === 'linked') {
    const regions = linkedRoofRegions(project).filter((r) => shown.has(r.levelId));
    faces.push(...linkedRoofFaces(project, regions));
  }
  // Крыши-плиты (core/roofs.js) — над показанными этажами; как и автокровля,
  // не закрывают показанный верхний этаж: только когда показан и этаж выше.
  if (roofs && project.roofs?.length) faces.push(...roofFaces(project, shownRoofs(project, levelMode)));
  if (site) faces.push(...siteFaces(project, { terrainScale, landscape }));
  // Благоустройство (core/mesh3d-landscape.js): деревья, покрытия, вода, постройки.
  if (site && landscape) faces.push(...landscapeFaces(project, terrainHeightFn(project, terrainScale), { evening }));
  if (masses || facades) {
    const facadeClip = facadeLevelBounds(project, levelMode);
    const list = (project.masses || []).filter((m) => m.facadeKind ? facades && clipMassBoxZ(massBox(m), facadeClip) : masses);
    faces.push(...massFaces(list, { voids: project.massVoids || [], apertures: facadeApertures, facadeClip }));
  }
  // Часть масс под землёй (рельеф и слой «Участок») — бледно сквозь землю.
  if (masses && site && project.masses?.length) faces.push(...massGroundFaces(project.masses, terrainHeightFn(project, terrainScale), { facadeClip: facadeLevelBounds(project, levelMode) }));
  return faces;
}

// Делает ли cutter хоть один реальный вырез в геометрии проекта. Сравниваем
// только те слои, которые massVoids действительно умеют вычитать: стены,
// полы, межэтажные перекрытия и обычные массы. Так полностью пустой или уже
// перекрытый другим cutter объём не остаётся в проекте невидимым объектом.
//
// Проверка вызывается только по завершении создания/правки, поэтому две
// детерминированные сборки сетки здесь предпочтительнее приблизительной AABB-
// проверки: она корректно видит и cutter, целиком находящийся внутри тела.
const MASS_VOID_TARGET_KINDS = new Set(['wall', 'floor', 'slab', 'mass']);
const MASS_VOID_IMPACT_SENTINEL = Object.freeze({
  id: 'void-impact-sentinel', name: '', x: 1e9, y: 1e9,
  w: 100, d: 100, z0: 1e9, h: 100, rotation: 0,
});

// Дешёвая сигнатура только той геометрии, которую умеет резать massVoid.
// Нужна UI-слою, чтобы после обычной правки комнаты/стены/перекрытия не
// запускать тяжёлое сравнение сеток, если цели cutter-ов не менялись.
// massVoids намеренно исключены: правка самого cutter проверяется отдельно.
export function massVoidTargetGeometryKey(project) {
  if (!project) return '';
  const settings = project.settings || {};
  const massShape = (mass) => [mass.id, mass.x, mass.y, mass.w, mass.d, mass.z0, mass.h, mass.rotation || 0];
  const stairShape = (item) => [item.id, item.x, item.y, item.w, item.h, item.rotation || 0, item.toLevel || ''];
  return JSON.stringify({
    settings: [settings.partition, settings.exterior, settings.bearing, settings.wallsEngine || ''],
    masses: (project.masses || []).map(massShape),
    levels: (project.levels || []).map((level) => ({
      id: level.id,
      elevation: level.elevation,
      height: level.height,
      rooms: level.rooms || [],
      openings: level.openings || [],
      wallOverrides: level.wallOverrides || {},
      walls: level.walls || [],
      slabOpenings: level.slabOpenings || [],
      stairs: (level.items || []).filter((item) => item.kind === 'stairs').map(stairShape),
    })),
  });
}

function faceAreaOnAxis(points, axis) {
  const [a, b] = axis === 'x' ? ['y', 'z'] : axis === 'y' ? ['x', 'z'] : ['x', 'y'];
  let twice = 0;
  for (let i = 0; i < points.length; i += 1) {
    const p = points[i]; const q = points[(i + 1) % points.length];
    twice += p[a] * q[b] - q[a] * p[b];
  }
  return Math.abs(twice) / 2;
}

// Cutter может лишь разбить ту же плоскость на большее число граней, даже
// когда геометрически ничего не вырезал. Поэтому сравниваем не массив граней,
// а суммарную площадь каждой ориентированной плоскости каждого объекта.
function massVoidTargetFingerprint(project) {
  const areas = new Map();
  for (const face of buildHouseMesh(project, {
    roof: false, site: false, landscape: false, furniture: false,
    levels: 'all', masses: true, roofs: false,
  })) {
    if (!MASS_VOID_TARGET_KINDS.has(face.kind) || !face.pts?.length) continue;
    const n = face.normal || {};
    const axis = ['x', 'y', 'z'].reduce((best, key) => (Math.abs(n[key] || 0) > Math.abs(n[best] || 0) ? key : best), 'x');
    if (Math.abs(n[axis] || 0) < 0.5) continue;
    const plane = face.pts.reduce((sum, point) => sum + point[axis], 0) / face.pts.length;
    const owner = face.massId || face.roomId || face.ref?.key || '';
    const key = [face.kind, owner, face.level || '', axis, n[axis] > 0 ? 1 : -1, Math.round(plane * 1000) / 1000].join('|');
    areas.set(key, (areas.get(key) || 0) + faceAreaOnAxis(face.pts, axis));
  }
  return JSON.stringify([...areas].sort(([a], [b]) => a.localeCompare(b)).map(([key, area]) => [key, Math.round(area * 1000) / 1000]));
}

export function massVoidCutsProject(project, cutter) {
  if (!project || !cutter) return false;
  const others = (project.massVoids || []).filter((item) => item?.id !== cutter.id);
  // Наличие massVoids включает точный v2-построитель и у старых v1-стен.
  // Один одинаковый cutter далеко от модели держит обе сравниваемые сцены в
  // одном режиме и не даёт ложного «пересечения» из-за смены алгоритма.
  const stable = [...others, MASS_VOID_IMPACT_SENTINEL];
  const without = { ...project, massVoids: stable };
  const withCutter = { ...project, massVoids: [...stable, cutter] };
  return massVoidTargetFingerprint(without) !== massVoidTargetFingerprint(withCutter);
}

// Убирает orphan/redundant cutters после любого изменения геометрии. Идём
// по порядку: первый полезный cutter остаётся, последующие полностью
// дублирующие его вырез удаляются, но частично добавляющие вырез сохраняются.
export function pruneOrphanMassVoids(project) {
  const source = Array.isArray(project?.massVoids) ? project.massVoids : [];
  if (!source.length) return [];
  const kept = [];
  const removed = [];
  const stable = [MASS_VOID_IMPACT_SENTINEL];
  let fingerprint = massVoidTargetFingerprint({ ...project, massVoids: stable });
  for (const cutter of source) {
    const nextStable = [...stable, cutter];
    const next = massVoidTargetFingerprint({ ...project, massVoids: nextStable });
    if (next !== fingerprint) {
      kept.push(cutter);
      stable.push(cutter);
      fingerprint = next;
    } else removed.push(cutter.id);
  }
  if (removed.length) {
    if (kept.length) project.massVoids = kept;
    else delete project.massVoids;
  }
  return removed;
}
