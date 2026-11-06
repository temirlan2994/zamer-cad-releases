// Выбор стены в 3D: луч из пикселя экрана и пересечение с коробками стен на
// процессоре (без ID-буфера — работает и в запасном режиме canvas 2D). Чистый
// модуль без DOM.
//
// Камера — как в ui/view3d.js: аксонометрия (ортографическая проекция) в
// правой системе X = x, Y = −y, Z = z; луч и коробки — в осях дома (как сетка
// core/mesh3d.js), поворот дома (building.rotation) на них не влияет.
//
// Коробка: куски прямоугольников записи стены (rects) × её высота минус
// проёмы (подоконная часть, перемычка, простенки — отдельными коробками).

import { levelProject, sortedLevels } from './model.js';
import { levelWallSolids } from './mesh3d.js';
import { deriveWalls } from './walls.js';

const W = (p) => ({ x: p.x, y: -p.y, z: p.z }); // оси дома ↔ правая система (сама себе обратна)
const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a, b) => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
const norm = (a) => { const l = Math.hypot(a.x, a.y, a.z) || 1; return { x: a.x / l, y: a.y / l, z: a.z / l }; };

// Базис камеры: глаз, направление взгляда f, право r, верх u (правая система),
// фокус и центр экрана; scale — пикселей на мм.
export function cameraBasis(cam, width, height) {
  const cp = Math.cos(cam.pitch);
  const eyeDist = cam.eyeDist || Math.max(25000, cam.dist);
  const eye = {
    x: cam.target.x + eyeDist * cp * Math.cos(cam.yaw),
    y: cam.target.y + eyeDist * cp * Math.sin(cam.yaw),
    z: cam.target.z + eyeDist * Math.sin(cam.pitch),
  };
  const f = norm(sub(cam.target, eye));
  const r = norm(cross(f, { x: 0, y: 0, z: 1 }));
  const u = cross(r, f);
  const focal = 0.95 * Math.min(width, height);
  return { eye, f, r, u, focal, cx: width / 2, cy: height / 2, scale: focal / cam.dist };
}

// Луч из пикселя (px, py) в осях дома: { o, d } (d — единичный).
export function screenRay(cam, width, height, px, py) {
  const c = cameraBasis(cam, width, height);
  const sx = (px - c.cx) / c.scale;
  const sy = (c.cy - py) / c.scale;
  const o = {
    x: c.eye.x + c.r.x * sx + c.u.x * sy,
    y: c.eye.y + c.r.y * sx + c.u.y * sy,
    z: c.eye.z + c.r.z * sx + c.u.z * sy,
  };
  return { o: W(o), d: W(c.f) };
}

// Точка в осях дома → пиксель экрана.
export function projectPoint(cam, width, height, p) {
  const c = cameraBasis(cam, width, height);
  const d = sub(W(p), c.eye);
  return { x: c.cx + dot(d, c.r) * c.scale, y: c.cy - dot(d, c.u) * c.scale };
}

// Сдвиг мыши (dx, dy, пиксели) → смещение вдоль оси axis (единичный вектор
// в осях дома), мм: проекция на экранный образ оси. Ось «в глаз» — 0.
export function axisDelta(cam, width, height, axis, dx, dy) {
  const c = cameraBasis(cam, width, height);
  const a = W(axis);
  const sx = dot(a, c.r) * c.scale;
  const sy = -dot(a, c.u) * c.scale;
  const len2 = sx * sx + sy * sy;
  if (len2 < 0.02 * c.scale * c.scale) return 0; // ось почти вдоль взгляда
  return (dx * sx + dy * sy) / len2;
}

// Прямоугольник стены r (orient — вдоль x для 'h') с высотой z0…z1 минус
// проёмы → коробки { x0, y0, z0, x1, y1, z1 }.
function solidPieces(r, h, z0, z1, voids) {
  const a0 = h ? r.x : r.y;
  const a1 = a0 + (h ? r.w : r.h);
  const holes = [];
  for (const q of voids) {
    const v = q.r;
    if (!(v.x < r.x + r.w && v.x + v.w > r.x && v.y < r.y + r.h && v.y + v.h > r.y)) continue;
    const va0 = Math.max(a0, h ? v.x : v.y);
    const va1 = Math.min(a1, h ? v.x + v.w : v.y + v.h);
    if (va1 - va0 > 0.5) holes.push({ a0: va0, a1: va1, z0: q.bottom, z1: q.top });
  }
  const cuts = [...new Set([a0, a1, ...holes.flatMap((q) => [q.a0, q.a1])])].sort((a, b) => a - b);
  const out = [];
  for (let i = 0; i < cuts.length - 1; i += 1) {
    const p = cuts[i]; const q = cuts[i + 1];
    if (q - p < 0.5) continue;
    const over = holes.filter((hole) => hole.a0 <= p + 0.01 && hole.a1 >= q - 0.01).sort((a, b) => a.z0 - b.z0);
    let z = z0;
    const spans = [];
    for (const hole of over) {
      if (hole.z0 > z) spans.push([z, Math.min(hole.z0, z1)]);
      z = Math.max(z, hole.z1);
    }
    if (z < z1) spans.push([z, z1]);
    for (const [s0, s1] of spans) {
      if (s1 - s0 < 0.5) continue;
      out.push(h
        ? { x0: p, x1: q, y0: r.y, y1: r.y + r.h, z0: s0, z1: s1 }
        : { x0: r.x, x1: r.x + r.w, y0: p, y1: q, z0: s0, z1: s1 });
    }
  }
  return out;
}

// Коробки стен всех этажей (z — абсолютные, от нуля нижнего этажа).
// Коробка помнит стену: key, wallId (ручная), from (кусок у шахты), этаж,
// ориентацию, полную высоту стены (wallZ0/wallZ1) и её крайние координаты
// вдоль оси (alongMin/alongMax) — по ним грань попадания делится на ручки.
export function wallBoxes(project) {
  const boxes = [];
  for (const level of sortedLevels(project)) {
    const lp = levelProject(project, level.id);
    const walls = deriveWalls(lp);
    const { recs, voids } = levelWallSolids(lp, walls, level.height);
    const elev = Number(level.elevation) || 0;
    for (const q of recs) {
      const w = q.wall;
      const h = w.orient === 'h';
      const alongMin = Math.min(...q.rects.map((r) => (h ? r.x : r.y)));
      const alongMax = Math.max(...q.rects.map((r) => (h ? r.x + r.w : r.y + r.h)));
      for (const r of q.rects) {
        for (const p of solidPieces(r, h, q.z0, q.z1, voids)) {
          boxes.push({
            ...p, z0: p.z0 + elev, z1: p.z1 + elev,
            key: w.key, wallId: w.wallId ?? null, from: w.from, kind: w.kind, orient: w.orient,
            levelId: level.id, wallZ0: q.z0 + elev, wallZ1: q.z1 + elev, alongMin, alongMax,
          });
        }
      }
    }
  }
  return boxes;
}

// Пересечение луча с коробкой (slab-тест): { t, axis, sign } входа или null.
// sign — знак нормали грани входа по оси axis.
export function rayBox(ray, b) {
  let tmin = -Infinity;
  let tmax = Infinity;
  let axis = null;
  let sign = 0;
  for (const k of ['x', 'y', 'z']) {
    const o = ray.o[k];
    const d = ray.d[k];
    const lo = b[`${k}0`];
    const hi = b[`${k}1`];
    if (Math.abs(d) < 1e-12) {
      if (o < lo || o > hi) return null;
      continue;
    }
    let t0 = (lo - o) / d;
    let t1 = (hi - o) / d;
    let s = -1;
    if (t0 > t1) { [t0, t1] = [t1, t0]; s = 1; }
    if (t0 > tmin) { tmin = t0; axis = k; sign = s; }
    if (t1 < tmax) tmax = t1;
    if (tmin > tmax) return null;
  }
  if (tmax < 0 || tmin < 0 || !axis) return null;
  return { t: tmin, axis, sign };
}

// Ближайшее попадание луча в стены → { key, wallId, from, levelId, kind,
// orient, face, normal, point, t, box } или null. face: 'top' — верх стены,
// 'side' — боковая грань, 'end' — торец, 'reveal' — откос/подоконник/низ
// перемычки и прочие грани без ручки.
export function pickWall(boxes, ray) {
  let best = null;
  for (const b of boxes) {
    const hit = rayBox(ray, b);
    if (!hit || (best && hit.t >= best.t)) continue;
    best = { ...hit, box: b };
  }
  if (!best) return null;
  const { box: b, axis, sign, t } = best;
  const normal = { x: 0, y: 0, z: 0 };
  normal[axis] = sign;
  const along = b.orient === 'h' ? 'x' : 'y';
  let face;
  if (axis === 'z') face = sign > 0 && Math.abs(b.z1 - b.wallZ1) < 0.5 ? 'top' : 'reveal';
  else if (axis !== along) face = 'side';
  else {
    const at = sign > 0 ? b[`${along}1`] : b[`${along}0`];
    face = Math.abs(at - (sign > 0 ? b.alongMax : b.alongMin)) < 0.5 ? 'end' : 'reveal';
  }
  const point = { x: ray.o.x + ray.d.x * t, y: ray.o.y + ray.d.y * t, z: ray.o.z + ray.d.z * t };
  return {
    key: b.key, wallId: b.wallId, from: b.from, levelId: b.levelId, kind: b.kind, orient: b.orient,
    face, normal, point, t, box: b,
  };
}
