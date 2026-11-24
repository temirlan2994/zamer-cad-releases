import { clipFace } from './geom/clip.js';
// Разрезы по линии на плане этажа (как в Revit). Чистый модуль без DOM.
//
// Вид-разрез (core/views.js, kind 'section'): line { a, b } — в осях дома,
// side = 1 | -1 — в какую сторону от линии смотрим, depth — глубина
// видимости (мм; нет — до габарита дома).
//
// Оси вида — как у фасада (core/elevation.js): view — направление взгляда,
// right — «вправо» для зрителя, u = (p − a)·right, z — вверх, d = (p − a)·view
// — расстояние от плоскости разреза. n = (−dir.y, dir.x) — левая нормаль
// линии a→b в осях плана (ось Y вниз); view = side·n.
//
// Сечение (плоскость через a–b, вертикальная; ширина — длина отрезка a–b):
//   стены — тела levelWallSolids (прямоугольники в плане × высота стены)
//     минус проёмы-пустоты (окна, двери) → прямоугольники (u, z);
//   перекрытия и кровля — верхние грани плит buildHouseMesh × толщина;
//   пол нижнего этажа — плита SLAB_T под полом (по комнатам и стенам);
//   колонны и свободные стены — контур × высота этажа; марши — ступени.
// Пересечение линии с контуром — чётно-нечётное правило (любой угол линии;
// под углом стена режется наискось — сечение длиннее толщины).
// Вид за плоскостью — грани buildHouseMesh, обрезанные плоскостями
// d ≥ 0, d ≤ depth и краями отрезка, затем алгоритм художника (paintOrder).
//
// Ограничения: стены — прямоугольные коробки (как в 3D и на фасадах), кровля
// плоская; контур сечения — объединение прямоугольников по группам (стены,
// плиты, кровля, пол, марши), между группами линия остаётся; мебель и
// ландшафт в разрез не попадают.

import {
  KIND_OF, area2, doorFaces, fmtMark, paintOrder, roofTint,
} from './elevation.js';
import { isStructural } from './catalog.js';
import {
  ROOF_T, SLAB_T, buildHouseMesh, levelWallSolids, structuralOutline, terrainHeightFn,
} from './mesh3d.js';
import { envelopeOf } from './envelope.js';
import { levelProject, sortedLevels } from './model.js';
import { deriveWalls } from './walls.js';

const EPS = 1e-6;

// Линия разреза годится: конечные точки, длина ≥ 1 мм.
export function validLine(line) {
  const ok = (p) => p && Number.isFinite(Number(p.x)) && Number.isFinite(Number(p.y));
  if (!line || !ok(line.a) || !ok(line.b)) return false;
  return Math.hypot(line.b.x - line.a.x, line.b.y - line.a.y) >= 1;
}

// Оси вида: { a, b, len, dir, n, view, right, u0, u1 } (u0 < u1 — края отрезка).
export function sectionFrame(view) {
  if (!validLine(view?.line)) return null;
  const a = { x: Number(view.line.a.x), y: Number(view.line.a.y) };
  const b = { x: Number(view.line.b.x), y: Number(view.line.b.y) };
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  const dir = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
  const n = { x: -dir.y, y: dir.x };
  const side = view.side === -1 ? -1 : 1;
  const v = { x: n.x * side, y: n.y * side };
  const right = { x: -v.y, y: v.x };
  const uB = (b.x - a.x) * right.x + (b.y - a.y) * right.y;
  return { a, b, len, dir, n, side, view: v, right, u0: Math.min(0, uB), u1: Math.max(0, uB), uA: 0, uB };
}

// Сторона взгляда по точке c: 1 — c слева от a→b (по n), иначе −1.
export function sideOfPoint(line, c) {
  const dx = line.b.x - line.a.x; const dy = line.b.y - line.a.y;
  const s = (c.x - line.a.x) * -dy + (c.y - line.a.y) * dx;
  return s < 0 ? -1 : 1;
}

// Интервалы параметра t ∈ [0, len] линии a + t·dir внутри многоугольника
// (чётно-нечётное правило; точка на границе — внутри).
export function lineIntervals(poly, a, dir, len) {
  const ts = [];
  for (let i = 0; i < poly.length; i += 1) {
    const p = poly[i]; const q = poly[(i + 1) % poly.length];
    const sp = (p.x - a.x) * dir.y - (p.y - a.y) * dir.x;
    const sq = (q.x - a.x) * dir.y - (q.y - a.y) * dir.x;
    if ((sp > EPS) === (sq > EPS)) continue;
    const k = sp / (sp - sq);
    const x = p.x + (q.x - p.x) * k; const y = p.y + (q.y - p.y) * k;
    ts.push((x - a.x) * dir.x + (y - a.y) * dir.y);
  }
  ts.sort((x, y) => x - y);
  const out = [];
  for (let i = 0; i + 1 < ts.length; i += 2) {
    const t0 = Math.max(0, ts[i]); const t1 = Math.min(len, ts[i + 1]);
    if (t1 - t0 > 0.5) out.push([t0, t1]);
  }
  return out;
}

const rectPoly = (r) => [{ x: r.x, y: r.y }, { x: r.x + r.w, y: r.y }, { x: r.x + r.w, y: r.y + r.h }, { x: r.x, y: r.y + r.h }];

// Интервалы u на отрезке разреза для контура в плане.
function uIntervals(fr, poly) {
  return lineIntervals(poly, fr.a, fr.dir, fr.len).map(([t0, t1]) => {
    const p = -fr.side * t0; const q = -fr.side * t1;
    return [Math.min(p, q), Math.max(p, q)];
  });
}

// Точное пересечение линии разреза с плоской 3D-гранью. В отличие от
// uIntervals сохраняет высоту на обоих концах — скат в разрезе остаётся
// наклонным, а не превращается в прямоугольник по первой точке.
export function faceLineSegments(fr, face) {
  const { pts, normal } = face;
  if (!normal || Math.abs(normal.z) < EPS) return [];
  const p = pts[0];
  const at = (t) => ({
    t, z: p.z - ((fr.a.x + fr.dir.x * t - p.x) * normal.x + (fr.a.y + fr.dir.y * t - p.y) * normal.y) / normal.z,
  });
  return lineIntervals(pts, fr.a, fr.dir, fr.len).map(([from, to]) => [at(from), at(to)]);
}

// Вычесть прямоугольник o из прямоугольника r (u0, u1, z0, z1).
function subtractBox(r, o) {
  if (o.u1 <= r.u0 + EPS || o.u0 >= r.u1 - EPS || o.z1 <= r.z0 + EPS || o.z0 >= r.z1 - EPS) return [r];
  const out = [];
  const z0 = Math.max(r.z0, o.z0); const z1 = Math.min(r.z1, o.z1);
  if (o.u0 > r.u0 + 0.5) out.push({ ...r, u1: o.u0 });
  if (o.u1 < r.u1 - 0.5) out.push({ ...r, u0: o.u1 });
  const u0 = Math.max(r.u0, o.u0); const u1 = Math.min(r.u1, o.u1);
  if (z0 > r.z0 + 0.5) out.push({ ...r, u0, u1, z1: z0 });
  if (z1 < r.z1 - 0.5) out.push({ ...r, u0, u1, z0: z1 });
  return out;
}

// Объединение 1D-интервалов.
function unionIntervals(list) {
  const s = [...list].sort((x, y) => x[0] - y[0]);
  const out = [];
  for (const [p, q] of s) {
    if (out.length && p <= out[out.length - 1][1] + 0.5) out[out.length - 1][1] = Math.max(out[out.length - 1][1], q);
    else out.push([p, q]);
  }
  return out;
}

// Контур объединения прямоугольников: сетка по их краям, ребро — где
// заполненность соседних клеток разная (общие швы не рисуются).
function unionEdges(boxes) {
  if (!boxes.length) return [];
  const r = (v) => Math.round(v * 10) / 10;
  const us = [...new Set(boxes.flatMap((b) => [r(b.u0), r(b.u1)]))].sort((x, y) => x - y);
  const zs = [...new Set(boxes.flatMap((b) => [r(b.z0), r(b.z1)]))].sort((x, y) => x - y);
  const nu = us.length - 1; const nz = zs.length - 1;
  const fill = new Uint8Array(Math.max(0, nu * nz));
  for (let j = 0; j < nz; j += 1) {
    const cz = (zs[j] + zs[j + 1]) / 2;
    for (let i = 0; i < nu; i += 1) {
      const cu = (us[i] + us[i + 1]) / 2;
      if (boxes.some((b) => cu > b.u0 && cu < b.u1 && cz > b.z0 && cz < b.z1)) fill[j * nu + i] = 1;
    }
  }
  const at = (i, j) => (i >= 0 && j >= 0 && i < nu && j < nz ? fill[j * nu + i] : 0);
  const edges = [];
  for (let j = 0; j <= nz; j += 1) {
    let i0 = -1;
    for (let i = 0; i <= nu; i += 1) {
      const diff = i < nu && at(i, j) !== at(i, j - 1);
      if (diff && i0 < 0) i0 = i;
      if (!diff && i0 >= 0) { edges.push([{ u: us[i0], z: zs[j] }, { u: us[i], z: zs[j] }]); i0 = -1; }
    }
  }
  for (let i = 0; i <= nu; i += 1) {
    let j0 = -1;
    for (let j = 0; j <= nz; j += 1) {
      const diff = j < nz && at(i, j) !== at(i - 1, j);
      if (diff && j0 < 0) j0 = j;
      if (!diff && j0 >= 0) { edges.push([{ u: us[i], z: zs[j0] }, { u: us[i], z: zs[j] }]); j0 = -1; }
    }
  }
  return edges;
}

// Сечение: { cuts: [{ kind, u0, u1, z0, z1, pts }], edges, openings }.
function cutSolids(project, fr, faces, levels) {
  const envelope = envelopeOf(project);
  const groundLevelId = faces.find((face) => face.slabRole === 'ground')?.level;
  const groups = { wall: [], slab: [], roof: [], floor: [], stair: [], foundation: [] };
  const shaped = [];
  const openings = [];
  levels.forEach((level) => {
    const lp = levelProject(project, level.id);
    const walls = deriveWalls(lp);
    const { recs, voids } = levelWallSolids(lp, walls, level.height);
    const z = level.elevation;
    let boxes = [];
    const wallIv = [];
    for (const q of recs) {
      for (const r of q.rects) {
        for (const [u0, u1] of uIntervals(fr, rectPoly(r))) {
          boxes.push({ u0, u1, z0: z + q.z0, z1: z + q.z1 });
          wallIv.push([u0, u1]);
        }
      }
    }
    for (const q of voids) {
      for (const [u0, u1] of uIntervals(fr, rectPoly(q.r))) {
        const hole = { u0, u1, z0: z + q.bottom, z1: z + q.top };
        const before = boxes.length;
        let touched = false;
        boxes = boxes.flatMap((b) => {
          const res = subtractBox(b, hole);
          if (res.length !== 1 || res[0] !== b) touched = true;
          return res;
        });
        if (touched || boxes.length !== before) openings.push({ kind: q.kind, ...hole });
      }
    }
    groups.wall.push(...boxes);
    // Колонны и свободные стены — на всю высоту этажа.
    for (const item of lp.items.filter((i) => isStructural(i.kind))) {
      for (const [u0, u1] of uIntervals(fr, structuralOutline(item))) groups.wall.push({ u0, u1, z0: z, z1: z + level.height });
    }
    // Пол нижнего этажа — плита под полом по комнатам и стенам.
    if (level.id === groundLevelId && envelope.slabs.enabled) {
      const slabThickness = Math.min(800, Math.max(120, Number(envelope.slabs.groundThickness) || SLAB_T));
      const iv = [...wallIv];
      for (const f of faces) {
        if (f.kind !== 'floor' || Math.abs(f.pts[0].z - z) > 5) continue;
        iv.push(...uIntervals(fr, f.pts));
      }
      for (const [u0, u1] of unionIntervals(iv)) groups.floor.push({ u0, u1, z0: z - slabThickness, z1: z });
    }
  });
  // Перекрытия и кровля — по верхним граням плит.
  // Крыши-плиты (core/roofs.js): плита, борт края и парапет — в группе кровли,
  // низ тела — cutZ0 верхней грани.
  for (const f of faces) {
    const roofish = f.kind === 'roof' || f.kind === 'parapet' || f.kind === 'fascia';
    const foundationish = f.kind === 'foundation' || f.kind === 'plinth';
    const slopedRoof = roofish && f.roofSurface === 'top'
      && (f.roofType !== 'flat' || Math.hypot(f.normal?.x || 0, f.normal?.y || 0) > 1e-6);
    if (slopedRoof) {
      const thickness = Number(f.roofThickness) || ROOF_T;
      for (const [a, b] of faceLineSegments(fr, f)) {
        const pa = { u: -fr.side * a.t, z: a.z }; const pb = { u: -fr.side * b.t, z: b.z };
        const [left, right] = pa.u <= pb.u ? [pa, pb] : [pb, pa];
        const pts = [
          { u: left.u, z: left.z - thickness }, { u: right.u, z: right.z - thickness },
          { u: right.u, z: right.z }, { u: left.u, z: left.z },
        ];
        shaped.push({ kind: 'roof', pts, u0: left.u, u1: right.u, z0: Math.min(left.z, right.z) - thickness, z1: Math.max(left.z, right.z) });
      }
      continue;
    }
    if (roofish && f.roofSurface && f.roofSurface !== 'top') continue;
    // Нижняя плита уже собирается выше по чистой отметке пола. В 3D её верх
    // опущен на 1 мм против z-fighting, но на разрезе должен доходить до ±0.
    if (f.kind === 'slab' && f.slabRole === 'ground') continue;
    if ((f.kind !== 'slab' && !roofish && !foundationish) || !(f.normal?.z > 0.5)) continue;
    if (f.alpha != null && f.alpha < 1) continue; // стекло ограждения — не тело
    const z1 = f.pts[0].z;
    const z0 = Number.isFinite(f.cutZ0) ? f.cutZ0 : (f.kind === 'slab' ? z1 - SLAB_T + 1 : z1 - ROOF_T);
    const group = foundationish ? 'foundation' : (roofish ? 'roof' : 'slab');
    for (const [u0, u1] of uIntervals(fr, f.pts)) groups[group].push({ u0, u1, z0, z1 });
  }
  // Марши: верх ступени × от пола своего этажа (монолит) или до низа плиты
  // проступи/площадки (cutZ0 — открытая и консольная); тетивы и перила — нет.
  for (const f of faces) {
    if (!['stairs', 'entrance'].includes(f.kind) || f.noCut || !(f.normal?.z > 0.5)) continue;
    const z1 = f.pts[0].z;
    const base = [...levels].reverse().find((l) => l.elevation < z1 - 1);
    const z0 = Number.isFinite(f.cutZ0) ? f.cutZ0 : (base ? base.elevation : 0);
    if (z1 - z0 < 1) continue;
    for (const [u0, u1] of uIntervals(fr, f.pts)) groups.stair.push({ u0, u1, z0, z1 });
  }
  const cuts = [];
  const edges = [];
  for (const [kind, boxes] of Object.entries(groups)) {
    for (const b of boxes) {
      if (b.u1 - b.u0 < 0.5 || b.z1 - b.z0 < 0.5) continue;
      cuts.push({ kind, ...b, pts: [{ u: b.u0, z: b.z0 }, { u: b.u1, z: b.z0 }, { u: b.u1, z: b.z1 }, { u: b.u0, z: b.z1 }] });
    }
    edges.push(...unionEdges(boxes.filter((b) => b.u1 - b.u0 >= 0.5 && b.z1 - b.z0 >= 0.5)));
  }
  for (const shape of shaped) {
    cuts.push(shape);
    for (let i = 0; i < shape.pts.length; i += 1) edges.push([shape.pts[i], shape.pts[(i + 1) % shape.pts.length]]);
  }
  return { cuts, edges, openings };
}

// Разрез вида view: { id, side, polys (вид за плоскостью, как у фасада),
// cuts, cutEdges, openings: [{ kind, u0, u1, z0, z1 }], levels, ground,
// bounds, width, height, range: { u0, u1 } } или null (битая линия).
export function buildSection(project, view, { roof = true, terrain = true } = {}) {
  const fr = sectionFrame(view);
  if (!fr) return null;
  const depth = Number(view.depth) > 0 ? Number(view.depth) : Infinity;
  const faces = buildHouseMesh(project, { roof, site: false });
  const levels = sortedLevels(project);
  const { cuts, edges: cutEdges, openings } = cutSolids(project, fr, faces, levels);
  for (const level of levels) faces.push(...doorFaces(project, level));

  const dOf = (p) => (p.x - fr.a.x) * fr.view.x + (p.y - fr.a.y) * fr.view.y;
  const uOf = (p) => (p.x - fr.a.x) * fr.right.x + (p.y - fr.a.y) * fr.right.y;
  const planes = [dOf, (p) => uOf(p) - fr.u0, (p) => fr.u1 - uOf(p)];
  if (Number.isFinite(depth)) planes.push((p) => depth - dOf(p));
  const polys = [];
  for (const f of faces) {
    if (!f.pts || f.pts.length < 3 || f.kind === 'floor') continue;
    const n = f.normal || { x: 0, y: 0, z: 0 };
    const slopedRoof = f.roofSurface === 'top'
      && (f.roofType !== 'flat' || Math.hypot(n.x, n.y) > 1e-6);
    if (Math.abs(n.z) > 0.999 && !slopedRoof) continue;
    const facing = n.x * fr.view.x + n.y * fr.view.y;
    if (Math.abs(facing) < 1e-3 && !(n.x === 0 && n.y === 0)) continue;
    if (facing > 0 && !f.twoSided) continue;
    let pts3 = f.pts;
    for (const g of planes) { pts3 = clipFace(pts3, g); if (pts3.length < 3) break; }
    if (pts3.length < 3) continue;
    const pts = pts3.map((p) => ({ u: uOf(p), z: p.z }));
    if (Math.abs(area2(pts)) < 1) continue;
    const d = pts3.reduce((s, p) => s + dOf(p), 0) / pts3.length;
    const us = pts.map((p) => p.u); const zs = pts.map((p) => p.z);
    const nn = Math.abs(facing) > 0.999 ? `${Math.sign(facing)}` : `${n.x.toFixed(3)},${n.y.toFixed(3)}`;
    const offset = Math.round(f.pts[0].x * n.x + f.pts[0].y * n.y);
    polys.push({
      pts, depth: d, kind: KIND_OF[f.kind] || 'other', tint: roofTint(f),
      u0: Math.min(...us), u1: Math.max(...us), z0: Math.min(...zs), z1: Math.max(...zs),
      plane: f.twoSided ? `t${Math.round(d)}` : `${nn}|${offset}|${Math.round(d)}`,
    });
  }
  const visible = paintOrder(polys);

  const all = [...visible, ...cuts];
  const empty = !all.length;
  const bounds = empty ? { u0: fr.u0, u1: fr.u1, z0: 0, z1: 0 } : {
    u0: Math.min(...all.map((p) => p.u0)), u1: Math.max(...all.map((p) => p.u1)),
    z0: Math.min(0, ...all.map((p) => p.z0)), z1: Math.max(...all.map((p) => p.z1)),
  };
  // Земля — по линии разреза (рельеф — отметки на линии), за краями дома.
  const pad = 2000;
  const hz = terrain && !empty ? terrainHeightFn(project) : null;
  const ground = [];
  const steps = hz ? 40 : 1;
  for (let k = 0; k <= steps; k += 1) {
    const u = bounds.u0 - pad + ((bounds.u1 - bounds.u0 + 2 * pad) * k) / steps;
    let z = 0;
    if (hz) {
      const t = -fr.side * u; // u = −side·t на линии
      const zz = hz(fr.a.x + fr.dir.x * t, fr.a.y + fr.dir.y * t);
      z = Number.isFinite(zz) ? zz : 0;
    }
    ground.push({ u, z });
  }
  if (hz) bounds.z0 = Math.min(bounds.z0, ...ground.map((g) => g.z));
  return {
    id: view.id, side: fr.side,
    polys: visible.map(({ pts, depth: d, kind, edges, tint }) => ({ pts, depth: d, kind, edges, ...(tint ? { tint } : {}) })),
    cuts: cuts.map(({ kind, pts, u0, u1, z0, z1 }) => ({ kind, pts, u0, u1, z0, z1 })),
    cutEdges,
    openings,
    levels: levels.map((l) => ({ id: l.id, name: l.name, z: l.elevation, height: l.height, label: fmtMark(l.elevation) })),
    ground,
    bounds,
    width: bounds.u1 - bounds.u0,
    height: bounds.z1 - bounds.z0,
    range: { u0: fr.u0, u1: fr.u1 },
  };
}

// Глубина «до габарита дома»: от линии до дальней точки стен в сторону взгляда.
export function houseDepth(project, view) {
  const fr = sectionFrame(view);
  if (!fr) return 0;
  let far = 0;
  for (const level of sortedLevels(project)) {
    const lp = levelProject(project, level.id);
    for (const q of levelWallSolids(lp, deriveWalls(lp), level.height).recs) {
      for (const r of q.rects) {
        for (const p of rectPoly(r)) far = Math.max(far, (p.x - fr.a.x) * fr.view.x + (p.y - fr.a.y) * fr.view.y);
      }
    }
  }
  return Math.ceil(far / 100) * 100;
}
