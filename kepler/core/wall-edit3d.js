// Правка стены в 3D: ручки по граням (core/pick3d.js) и запись в модель
// теми же функциями, что и на плане (wall-edit / wall-thickness /
// wall-manual). Чистый модуль без DOM; проект — на этаже стены.
//
// Ручки: верх → высота (setWallHeight); бок → сдвиг (moveWallBy), с Alt —
// толщина, противоположная грань на месте; торец ручной стены → длина
// (dragManualWallEnd). Число (двойной клик): высота / толщина / длина.

import { GRID_STEP } from './catalog.js';
import { wallZRange } from './mesh3d.js';
import { moveWallBy } from './wall-edit.js';
import {
  dragManualWallEnd, manualWallById, moveManualWall, setManualWallThickness, setWallHeight,
} from './wall-manual.js';
import { clampWallThickness, setSharedWallThickness, setWallSpan } from './wall-thickness.js';
import { deriveWalls, manualWallGeometry } from './walls.js';

export const WALL_H_MIN = 100; // мм — ниже стену не делаем
export const WALL_H_MAX = 30000;

const snapTo = (value, step) => (step > 0 ? Math.round(value / step) * step : value);

// Ручка по попаданию луча (pickWall): { kind, axis } или null.
// kind: 'height' | 'move' | 'thickness' | 'length'; axis — направление
// ручки в осях дома (наружу от грани).
export function gripFor(hit, { alt = false } = {}) {
  if (!hit) return null;
  if (hit.face === 'top') return { kind: 'height', axis: { x: 0, y: 0, z: 1 } };
  if (hit.face === 'side') return { kind: alt ? 'thickness' : 'move', axis: { ...hit.normal } };
  if (hit.face === 'end' && hit.kind === 'manual') return { kind: 'length', axis: { ...hit.normal } };
  return null;
}

// Запись стены по ключу (и началу куска для стен у шахт).
export function findWallRecord(project, key, from) {
  const walls = deriveWalls(project);
  return walls.find((w) => w.key === key && (from === undefined || from === null || Math.abs(w.from - from) < 1))
    || walls.find((w) => w.key === key) || null;
}

function levelHeight(project) {
  const level = (project.levels || []).find((l) => l.id === project.activeLevel);
  return Number(level?.height) > 0 ? Number(level.height) : 3000;
}

// Высота стены в 3D (от низа до верха, мм) и её низ от пола этажа.
export function wallHeight3d(project, rec) {
  const z = wallZRange(project, rec, levelHeight(project));
  return { base: z.z0, top: z.z1, height: z.z1 - z.z0 };
}

// Текущее значение ручки (для подсказки и поля ввода): мм.
export function gripValue(project, rec, grip) {
  if (!rec || !grip) return null;
  if (grip.kind === 'height') return Math.round(wallHeight3d(project, rec).height);
  if (grip.kind === 'length') return Math.round(rec.to - rec.from);
  return Math.round(rec.thickness);
}

export const GRIP_LABEL = { height: 'Высота', thickness: 'Толщина', move: 'Толщина', length: 'Длина' };

// Знак оси ручки поперёк стены (+1/−1).
const acrossSign = (rec, axis) => Math.sign(rec.orient === 'h' ? axis.y : axis.x) || 1;
const alongSign = (rec, axis) => Math.sign(rec.orient === 'h' ? axis.x : axis.y) || 1;

function applyHeight(project, rec, height) {
  if (!Number.isFinite(height)) return { ok: false, reason: 'Высота не задана' };
  const h = Math.min(WALL_H_MAX, Math.max(WALL_H_MIN, Math.round(height)));
  return setWallHeight(project, rec, { height: h });
}

// Толщина; у ручной стены противоположная ручке грань остаётся на месте.
function applyThickness(project, rec, t, axis) {
  if (rec.kind === 'manual') {
    const wall = manualWallById(project, rec.wallId);
    const g0 = wall && manualWallGeometry(wall);
    if (!g0) return { ok: false, reason: 'Стена не найдена' };
    const res = setManualWallThickness(project, rec.wallId, t);
    if (!res.ok) return res;
    const g1 = manualWallGeometry(wall);
    const shift = acrossSign(rec, axis) > 0 ? g0.lo - g1.lo : g0.hi - g1.hi;
    if (Math.abs(shift) > 0.01) moveManualWall(project, rec.wallId, shift);
    return res;
  }
  const value = clampWallThickness(t, rec.thickness);
  if (rec.kind === 'shared') return setSharedWallThickness(project, rec, value);
  return setWallSpan(project, rec, { thickness: value }); // только этот участок
}

function applyLength(project, rec, endValue, axis) {
  if (rec.kind !== 'manual') return { ok: false, reason: 'Длину в 3D меняют только у ручной стены' };
  const wall = manualWallById(project, rec.wallId);
  const g = wall && manualWallGeometry(wall);
  if (!g) return { ok: false, reason: 'Стена не найдена' };
  const along = g.orient === 'h' ? 'x' : 'y';
  const endCoord = alongSign(rec, axis) > 0 ? g.to : g.from;
  const end = Math.abs(wall.axis.a[along] - endCoord) <= Math.abs(wall.axis.b[along] - endCoord) ? 'a' : 'b';
  return dragManualWallEnd(project, rec.wallId, end, { ...wall.axis[end], [along]: endValue });
}

// Перетаскивание ручки на d мм вдоль её оси от исходного состояния (проект —
// в состоянии начала жеста, rec — запись стены из него). snap — шаг привязки
// (сетка плана; 0 — без привязки), finalize — последний кадр (как на плане).
export function applyGrip(project, rec, grip, d, { snap = GRID_STEP, finalize = false } = {}) {
  if (!rec || !grip || !Number.isFinite(d)) return { ok: false, reason: 'Нет ручки' };
  if (grip.kind === 'height') {
    const z = wallHeight3d(project, rec);
    return applyHeight(project, rec, snapTo(z.top + d, snap) - z.base);
  }
  if (grip.kind === 'move') {
    const delta = snapTo(d, snap) * acrossSign(rec, grip.axis);
    if (Math.abs(delta) < 0.5) return { ok: true, unchanged: true };
    return moveWallBy(project, rec, delta, { finalize });
  }
  if (grip.kind === 'thickness') {
    const t = snapTo(rec.thickness + d, snap ? 10 : 0);
    if (Math.abs(t - rec.thickness) < 0.5) return { ok: true, unchanged: true };
    return applyThickness(project, rec, t, grip.axis);
  }
  if (grip.kind === 'length') {
    const s = alongSign(rec, grip.axis);
    const endCoord = s > 0 ? rec.to : rec.from;
    return applyLength(project, rec, snapTo(endCoord + s * d, snap), grip.axis);
  }
  return { ok: false, reason: 'Нет ручки' };
}

// Ввод числа по ручке: высота, толщина (бок) или длина (торец; противоположный
// торец на месте), мм.
export function applyGripValue(project, rec, grip, value) {
  const v = Number(value);
  if (!rec || !grip || !Number.isFinite(v) || v <= 0) return { ok: false, reason: 'Нужно число больше нуля' };
  if (grip.kind === 'height') return applyHeight(project, rec, v);
  if (grip.kind === 'move' || grip.kind === 'thickness') return applyThickness(project, rec, v, grip.axis);
  if (grip.kind === 'length') {
    const s = alongSign(rec, grip.axis);
    const other = s > 0 ? rec.from : rec.to;
    return applyLength(project, rec, other + s * v, grip.axis);
  }
  return { ok: false, reason: 'Нет ручки' };
}
