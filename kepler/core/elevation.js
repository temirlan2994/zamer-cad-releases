// Фасады: ортогональная проекция дома на вертикальную плоскость. Чистый
// модуль без DOM.
//
// Источник — те же грани, что и в 3D (core/mesh3d.js buildHouseMesh: стены с
// проёмами, стёкла, перекрытия, кровля, лестницы, конструкции); двери в 3D —
// пустые проёмы, для фасада полотно двери добавляется здесь (посередине
// толщины стены, как стекло).
//
// Сторона фасада. «Фасад Север» — сторона дома, обращённая на север: зритель
// стоит севернее дома и смотрит на юг. Как фасады проекта в Revit, сторона
// берётся по осям дома: из четырёх сторон (верх/право/низ/лево плана в осях
// дома) — та, чья наружная нормаль ближе всего к северу (site.north с учётом
// building.rotation — core/building.js northInBuilding); Восток, Юг, Запад —
// следующие по часовой. Вид всегда прямо на сторону дома (без ракурса), при
// повороте ровно на 45° — детерминированный выбор (округление к меньшей
// стороне по часовой).
//
// Проекция: u — вправо для зрителя, z — вверх (мм, от пола нижнего этажа),
// depth — расстояние от зрителя (больше — дальше).
//
// Скрытие невидимого — алгоритм художника: грани, обращённые от зрителя, и
// грани ребром к нему отбрасываются; остальные сортируются дальние→ближние;
// грань, целиком закрытая более близкими (проверка по пяти точкам), не
// выдаётся вовсе. Для прямоугольных коробок стен этого достаточно.
// Ограничения: пересекающиеся грани и косые объёмы (круглые колонны,
// лестницы) могут перекрываться неточно; контуры рисуются по граням (общие
// рёбра соседних граней одной плоскости убираются), силуэт отдельно не
// строится; кровля — только плоская (как в 3D); рельеф — линия земли по
// фронту дома и цоколь до неё одним прямоугольником.

import { northInBuilding } from './building.js';
import { buildHouseMesh, levelWallSolids, terrainHeightFn } from './mesh3d.js';
import { levelProject, sortedLevels } from './model.js';
import { deriveWalls } from './walls.js';

// Наружные нормали сторон дома в осях дома (ось Y вниз): 0 — верх плана.
const SIDES = [{ x: 0, y: -1 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 }];
const DIR_STEP = { N: 0, E: 1, S: 2, W: 3 };
export const KIND_OF = { wall: 'wall', glass: 'window', door: 'door', slab: 'slab', roof: 'roof', parapet: 'roof', fascia: 'roof', stair: 'stair', plinth: 'plinth', foundation: 'foundation' };
// Цвет материала крыши-плиты (core/roofs.js) на фасаде — tint полигона.
export const roofTint = (f) => (f.roofId ? f.color : undefined);
const EPS = 1e-6;

// Сторона дома для фасада dir: { side (0..3), out — наружная нормаль,
// view — направление взгляда, right — «вправо» для зрителя } в осях дома.
export function facadeSide(project, dir) {
  const north = northInBuilding(project?.site?.north, project?.building);
  const kN = Math.round((north - EPS) / 90);
  const side = (((kN + (DIR_STEP[dir] ?? 0)) % 4) + 4) % 4;
  const out = SIDES[side];
  const view = { x: -out.x, y: -out.y };
  return { side, out, view, right: { x: -view.y, y: view.x } };
}

// Полотна дверей этажа — грани посередине толщины стены.
export function doorFaces(project, level) {
  const lp = levelProject(project, level.id);
  const { voids } = levelWallSolids(lp, deriveWalls(lp), level.height);
  const faces = [];
  for (const q of voids) {
    if (q.kind !== 'door') continue;
    const z0 = level.elevation + q.bottom;
    const z1 = level.elevation + q.top;
    if (q.wall.orient === 'h') {
      const y = q.r.y + q.r.h / 2;
      faces.push({ pts: [{ x: q.r.x, y, z: z0 }, { x: q.r.x + q.r.w, y, z: z0 }, { x: q.r.x + q.r.w, y, z: z1 }, { x: q.r.x, y, z: z1 }], normal: { x: 0, y: 1, z: 0 }, kind: 'door', twoSided: true });
    } else {
      const x = q.r.x + q.r.w / 2;
      faces.push({ pts: [{ x, y: q.r.y, z: z0 }, { x, y: q.r.y + q.r.h, z: z0 }, { x, y: q.r.y + q.r.h, z: z1 }, { x, y: q.r.y, z: z1 }], normal: { x: 1, y: 0, z: 0 }, kind: 'door', twoSided: true });
    }
  }
  return faces;
}

function pointInPoly(pts, u, z) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i, i += 1) {
    const a = pts[i]; const b = pts[j];
    if ((a.z > z) !== (b.z > z) && u < ((b.u - a.u) * (z - a.z)) / (b.z - a.z) + a.u) inside = !inside;
  }
  return inside;
}

export const area2 = (pts) => pts.reduce((s, p, i) => { const q = pts[(i + 1) % pts.length]; return s + p.u * q.z - q.u * p.z; }, 0);

// Пробы грани: центр и вершины, сдвинутые на 10% к центру.
function probes(poly) {
  const c = { u: (poly.u0 + poly.u1) / 2, z: (poly.z0 + poly.z1) / 2 };
  const pts = poly.pts.length === 4 ? poly.pts : [
    { u: poly.u0, z: poly.z0 }, { u: poly.u1, z: poly.z0 }, { u: poly.u1, z: poly.z1 }, { u: poly.u0, z: poly.z1 },
  ];
  const cu = pts.reduce((s, p) => s + p.u, 0) / pts.length;
  const cz = pts.reduce((s, p) => s + p.z, 0) / pts.length;
  return [{ u: cu, z: cz }, c, ...pts.map((p) => ({ u: p.u + (cu - p.u) * 0.1, z: p.z + (cz - p.z) * 0.1 }))];
}

// Видимые рёбра: у соседних граней одной плоскости общие отрезки
// (горизонтальные и вертикальные) взаимно вычитаются — шов между кусками
// стены (слои по отметкам проёмов) не рисуется, откос проёма остаётся.
function visibleEdges(polys) {
  const lines = new Map();
  polys.forEach((poly, fi) => {
    poly.edges = [];
    poly.pts.forEach((a, i) => {
      const b = poly.pts[(i + 1) % poly.pts.length];
      let key = null; let lo; let hi; let fixed;
      if (Math.abs(a.z - b.z) < 0.5) { key = `h${Math.round(a.z)}`; lo = Math.min(a.u, b.u); hi = Math.max(a.u, b.u); fixed = a.z; }
      else if (Math.abs(a.u - b.u) < 0.5) { key = `v${Math.round(a.u)}`; lo = Math.min(a.z, b.z); hi = Math.max(a.z, b.z); fixed = a.u; }
      if (!key) { poly.edges.push([a, b]); return; }
      const k = `${poly.plane}|${key}`;
      if (!lines.has(k)) lines.set(k, []);
      lines.get(k).push({ fi, lo, hi, fixed, h: key[0] === 'h' });
    });
  });
  for (const segs of lines.values()) {
    for (const s of segs) {
      let parts = [[s.lo, s.hi]];
      for (const o of segs) {
        if (o.fi === s.fi || o.hi <= s.lo + 0.5 || o.lo >= s.hi - 0.5) continue;
        parts = parts.flatMap(([p, q]) => {
          if (o.hi <= p || o.lo >= q) return [[p, q]];
          const out = [];
          if (o.lo > p + 0.5) out.push([p, o.lo]);
          if (o.hi < q - 0.5) out.push([o.hi, q]);
          return out;
        });
        if (!parts.length) break;
      }
      for (const [p, q] of parts) {
        polys[s.fi].edges.push(s.h ? [{ u: p, z: s.fixed }, { u: q, z: s.fixed }] : [{ u: s.fixed, z: p }, { u: s.fixed, z: q }]);
      }
    }
  }
}

// Алгоритм художника для граней в осях вида { pts: [{u, z}], depth, kind,
// u0, u1, z0, z1, plane }: дальние → ближние (при равной глубине — стекло и
// двери поверх стен), закрытые целиком более близкими — прочь, контуры —
// visibleEdges. Общий для фасадов и разрезов (core/section.js).
export function paintOrder(polys) {
  const rank = (p) => (p.kind === 'window' || p.kind === 'door' ? 1 : 0);
  polys.sort((a, b) => (b.depth - a.depth) || (rank(a) - rank(b)));
  const visible = polys.filter((p, i) => {
    const near = [];
    for (let j = i + 1; j < polys.length; j += 1) {
      const q = polys[j];
      if (q.depth > p.depth - 1) continue;
      if (q.u1 < p.u0 || q.u0 > p.u1 || q.z1 < p.z0 || q.z0 > p.z1) continue;
      near.push(q);
    }
    if (!near.length) return true;
    return probes(p).some((pt) => !near.some((q) => pt.u >= q.u0 && pt.u <= q.u1 && pt.z >= q.z0 && pt.z <= q.z1 && pointInPoly(q.pts, pt.u, pt.z)));
  });
  visibleEdges(visible);
  return visible;
}

export const fmtMark = (mm) => (Math.abs(mm) < 0.5
  ? '±0.000'
  : `${mm < 0 ? '−' : '+'}${(Math.abs(mm) / 1000).toFixed(3)}`);

// Фасад dir ('N' | 'S' | 'E' | 'W'):
// { dir, side, polys: [{ pts: [{u, z}], depth, kind, edges: [[a, b]] }] —
//   дальние→ближние (kind: wall | window | door | slab | roof | stair | plinth | other),
//   levels: [{ id, name, z, height, label }], ground: [{u, z}],
//   bounds: { u0, u1, z0, z1 } — габарит дома, width, height }.
export function buildElevation(project, dir, { roof = true, terrain = true } = {}) {
  const { side, view, right } = facadeSide(project, dir);
  const faces = buildHouseMesh(project, { roof, site: false });
  const levels = sortedLevels(project);
  for (const level of levels) faces.push(...doorFaces(project, level));
  const polys = [];
  for (const f of faces) {
    // На фасаде подземная часть скрыта землёй; она остаётся в 3D и разрезе.
    if (f.kind === 'foundation') continue;
    if (!f.pts || f.pts.length < 3) continue;
    // Объёмные алюминиевые профили нужны в 3D, но на ортогональном фасаде
    // их четыре узкие грани закрывали контрольные точки стеклопакета. Само
    // окно здесь остаётся одним фасадным элементом с чистым контуром.
    if (f.kind === 'window-frame') continue;
    const n = f.normal || { x: 0, y: 0, z: 0 };
    if (Math.abs(n.z) > 0.5) continue; // горизонтальная — на фасаде линия
    const facing = n.x * view.x + n.y * view.y;
    if (Math.abs(facing) < 1e-3 && !(n.x === 0 && n.y === 0)) continue; // ребром к зрителю
    if (facing > 0 && !f.twoSided) continue; // обращена от зрителя
    const pts = f.pts.map((p) => ({ u: p.x * right.x + p.y * right.y, z: p.z }));
    if (Math.abs(area2(pts)) < 1) continue;
    const depth = f.pts.reduce((s, p) => s + p.x * view.x + p.y * view.y, 0) / f.pts.length;
    const us = pts.map((p) => p.u); const zs = pts.map((p) => p.z);
    const nn = Math.abs(facing) > 0.999 ? `${Math.sign(facing)}` : `${n.x.toFixed(3)},${n.y.toFixed(3)}`;
    const offset = Math.round(f.pts[0].x * n.x + f.pts[0].y * n.y);
    polys.push({
      pts, depth, kind: KIND_OF[f.kind] || 'other', tint: roofTint(f),
      u0: Math.min(...us), u1: Math.max(...us), z0: Math.min(...zs), z1: Math.max(...zs),
      plane: f.twoSided ? `t${Math.round(depth)}` : `${nn}|${offset}|${Math.round(depth)}`,
    });
  }
  const visible = paintOrder(polys);

  const empty = !visible.length;
  const bounds = empty ? { u0: 0, u1: 0, z0: 0, z1: 0 } : {
    u0: Math.min(...visible.map((p) => p.u0)), u1: Math.max(...visible.map((p) => p.u1)),
    z0: Math.min(0, ...visible.map((p) => p.z0)), z1: Math.max(...visible.map((p) => p.z1)),
  };

  // Земля: по фронту дома (рельеф — отметки под линией чуть перед домом).
  const pad = 2000;
  let ground = [{ u: bounds.u0 - pad, z: 0 }, { u: bounds.u1 + pad, z: 0 }];
  const hz = terrain && !empty ? terrainHeightFn(project) : null;
  if (hz) {
    const front = Math.min(...visible.map((p) => p.depth)) - 300;
    const steps = 40;
    ground = [];
    for (let k = 0; k <= steps; k += 1) {
      const u = bounds.u0 - pad + ((bounds.u1 - bounds.u0 + 2 * pad) * k) / steps;
      // Точка плана: u·right + front·view.
      const z = hz(u * right.x + front * view.x, u * right.y + front * view.y);
      ground.push({ u, z: Number.isFinite(z) ? z : 0 });
    }
    const under = ground.filter((g) => g.u >= bounds.u0 && g.u <= bounds.u1);
    const low = Math.min(...under.map((g) => g.z));
    const plinthBottoms = visible.filter((poly) => poly.kind === 'plinth').map((poly) => poly.z0);
    const visibleBase = plinthBottoms.length ? Math.min(...plinthBottoms) : 0;
    const foundationOn = project.envelope?.foundation?.enabled !== false;
    if (foundationOn && low < visibleBase - 20) {
      const z0 = low - 50;
      const z1 = visibleBase;
      const pts = [{ u: bounds.u0, z: z0 }, { u: bounds.u1, z: z0 }, { u: bounds.u1, z: z1 }, { u: bounds.u0, z: z1 }];
      const base = {
        pts, depth: Infinity, kind: plinthBottoms.length ? 'foundation' : 'plinth',
        u0: bounds.u0, u1: bounds.u1, z0, z1,
        edges: pts.map((p, i) => [p, pts[(i + 1) % 4]]),
      };
      visible.unshift(base);
      bounds.z0 = Math.min(bounds.z0, z0);
    }
    bounds.z0 = Math.min(bounds.z0, ...ground.map((g) => g.z));
  }
  return {
    dir, side,
    polys: visible.map(({ pts, depth, kind, edges, tint }) => ({ pts, depth, kind, edges, ...(tint ? { tint } : {}) })),
    levels: levels.map((l) => ({ id: l.id, name: l.name, z: l.elevation, height: l.height, label: fmtMark(l.elevation) })),
    ground,
    bounds,
    width: bounds.u1 - bounds.u0,
    height: bounds.z1 - bounds.z0,
  };
}
