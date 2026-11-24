// Гизмо и точки-ручки выбранной массы в 3D (чистый модуль без DOM).
//
// Гизмо перемещения (как в Blender / Revit): три стрелки из центра массы —
// X (красная, +x дома), Y (зелёная, «на север» плана: −y дома, ось y дома
// идёт вниз) и Z (синяя, вверх) — и квадрат XY у центра (перенос по плоскости
// основания). Тянуть стрелку — перенос только вдоль неё.
//
// Точки размера: центр каждой из 6 граней (тянет эту грань по нормали) и 8
// углов (тянут две смежные боковые грани — ширину и глубину; верхние/нижние
// углы — по горизонтальной плоскости своей отметки). Противоположные грани
// стоят, размер не меньше MASS_GRIP_MIN.
//
// Попадание — в экранных координатах (пиксели): UI проецирует точки сам и
// отдаёт сюда отрезки стрелок, квадрат и точки.

import { massBox, massFromBox } from './masses.js';

export const MASS_GRIP_MIN = 300; // мм — меньше точками не сжимаем

// Оси гизмо в осях дома (единичные векторы).
export const GIZMO_AXES = {
  x: { x: 1, y: 0, z: 0 },
  y: { x: 0, y: -1, z: 0 },
  z: { x: 0, y: 0, z: 1 },
};
export const GIZMO_COLORS = { x: '#e5484d', y: '#2f9e5b', z: '#3e63dd', xy: '#f5a524', hot: '#ffc53d' };
export const GIZMO_PX = 84; // длина стрелки на экране, px
export const GIZMO_PLANE_PX = [16, 36]; // квадрат XY: от и до, px вдоль X и Y

const FACE_S = {
  top: { x: 0, y: 0, z: 1 }, bottom: { x: 0, y: 0, z: -1 },
  px: { x: 1, y: 0, z: 0 }, nx: { x: -1, y: 0, z: 0 },
  py: { x: 0, y: 1, z: 0 }, ny: { x: 0, y: -1, z: 0 },
};
const ch = (s) => (s > 0 ? 'p' : 'n');

// Все ручки: { id, s: { x, y, z } } — знаки по осям (−1, 0, 1). Грань — одна
// ненулевая ось, угол — все три (id вида 'cpnp': x+, y−, z+).
export const MASS_HANDLES = [
  ...Object.entries(FACE_S).map(([id, s]) => ({ id, s, face: id })),
  ...[-1, 1].flatMap((sz) => [-1, 1].flatMap((sy) => [-1, 1].map((sx) => ({
    id: `c${ch(sx)}${ch(sy)}${ch(sz)}`, s: { x: sx, y: sy, z: sz }, face: null,
  })))),
];
const BY_ID = new Map(MASS_HANDLES.map((h) => [h.id, h]));
export const massHandle = (id) => BY_ID.get(id) || null;

// Точка ручки на габарите { x0, y0, z0, x1, y1, z1 }.
export function handlePoint(box, s) {
  const pick = (v, lo, hi) => (v > 0 ? hi : v < 0 ? lo : (lo + hi) / 2);
  return { x: pick(s.x, box.x0, box.x1), y: pick(s.y, box.y0, box.y1), z: pick(s.z, box.z0, box.z1) };
}

// Центр гизмо — центр массы.
export function gizmoOrigin(box) {
  return { x: (box.x0 + box.x1) / 2, y: (box.y0 + box.y1) / 2, z: (box.z0 + box.z1) / 2 };
}

// Размер за точку: ручка s сдвинута на d = { x, y, z } (мм, оси дома).
// Двигаются только стороны, где знак ручки ненулевой; противоположные стоят;
// размер не меньше min; низ — не ниже 0.
export function resizeByHandle(m, s, d, min = MASS_GRIP_MIN) {
  const b = massBox(m);
  const dx = Number(d?.x) || 0; const dy = Number(d?.y) || 0; const dz = Number(d?.z) || 0;
  if (s.x > 0) b.x1 = Math.max(b.x0 + min, b.x1 + dx);
  else if (s.x < 0) b.x0 = Math.min(b.x1 - min, b.x0 + dx);
  if (s.y > 0) b.y1 = Math.max(b.y0 + min, b.y1 + dy);
  else if (s.y < 0) b.y0 = Math.min(b.y1 - min, b.y0 + dy);
  if (s.z > 0) b.z1 = Math.max(b.z0 + min, b.z1 + dz);
  else if (s.z < 0) {
    const lower = Math.min(b.z1 - min, b.z0 + dz);
    b.z0 = m.facadeKind ? lower : Math.max(0, lower);
  }
  return massFromBox(m, b);
}

// Перенос вдоль оси гизмо ('x' | 'y' | 'z') на delta мм по стрелке (y —
// стрелка на −y дома). Низ — не ниже 0.
export function moveAlongAxis(m, axis, delta) {
  const a = GIZMO_AXES[axis];
  const v = Number(delta) || 0;
  if (!a) return { ...m };
  return {
    ...m,
    x: m.x + a.x * v,
    y: m.y + a.y * v,
    z0: Math.max(0, Math.round(m.z0 + a.z * v)),
  };
}

// Привязка сдвига v отрезка [lo, hi]: край встаёт на ближайшую линию из list
// в пределах tol, иначе сдвиг — кратный step (0 — без шага).
// → { value, line } (line — координата линии или null).
export function snapShift(lo, hi, v, list, tol, step) {
  let best = null;
  for (const L of list || []) {
    for (const edge of [lo, hi]) {
      const dd = L - (edge + v);
      if (Math.abs(dd) <= tol && (best == null || Math.abs(dd) < Math.abs(best.d))) best = { d: dd, line: L };
    }
  }
  if (best) return { value: v + best.d, line: best.line };
  return { value: step > 0 ? Math.round(v / step) * step : Math.round(v), line: null };
}

// ---------------------------------------------------------------- попадание (px)

// Расстояние от точки p до отрезка ab (экран).
export function segDist(p, a, b) {
  const vx = b.x - a.x; const vy = b.y - a.y;
  const len2 = vx * vx + vy * vy;
  const t = len2 ? Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / len2)) : 0;
  return Math.hypot(p.x - (a.x + vx * t), p.y - (a.y + vy * t));
}

export function pointInPoly(p, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) {
    const a = poly[i]; const b = poly[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

// Часть гизмо под точкой p: 'x' | 'y' | 'z' | 'xy' | null. scr — { origin,
// tips: { x, y, z }, plane: [4 точки] } в пикселях; r — радиус попадания.
// Стрелка короче 12 px на экране (ось почти «в глаз») не ловится.
export function gizmoPick(scr, p, r = 8) {
  if (!scr) return null;
  if (scr.plane?.length >= 3 && pointInPoly(p, scr.plane)) return 'xy';
  let best = null;
  for (const axis of ['x', 'y', 'z']) {
    const tip = scr.tips?.[axis];
    if (!tip) continue;
    const len = Math.hypot(tip.x - scr.origin.x, tip.y - scr.origin.y);
    if (len < 12) continue;
    // Стрелка — от трети длины до кончика (у центра — квадрат и пусто).
    const k = Math.min(0.3, 12 / len);
    const from = { x: scr.origin.x + (tip.x - scr.origin.x) * k, y: scr.origin.y + (tip.y - scr.origin.y) * k };
    const d = segDist(p, from, tip);
    if (d <= r && (!best || d < best.d)) best = { axis, d };
  }
  if (best) return best.axis;
  if (scr.plane?.length >= 3) {
    for (let i = 0; i < scr.plane.length; i += 1) {
      if (segDist(p, scr.plane[i], scr.plane[(i + 1) % scr.plane.length]) <= Math.min(r, 6)) return 'xy';
    }
  }
  return null;
}

// Ближайшая ручка в пределах r: list — [{ id, p: { x, y }, back }] (back —
// на невидимой стороне: ловится, только если рядом нет видимой). → id | null.
export function handlePick(list, p, r = 10) {
  let best = null;
  for (const h of list || []) {
    const d = Math.hypot(h.p.x - p.x, h.p.y - p.y);
    if (d > r) continue;
    const score = d + (h.back ? r : 0);
    if (!best || score < best.score) best = { id: h.id, score };
  }
  return best ? best.id : null;
}

// Сторона ручки «к камере»: сумма нормалей её граней · направление взгляда
// f (оси дома) < 0. Центр массы — всегда видна.
export function handleFacing(s, f) {
  const dotv = s.x * f.x + s.y * f.y + s.z * f.z;
  return dotv < 1e-9;
}
