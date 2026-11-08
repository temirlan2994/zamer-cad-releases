// Эскиз масс на плане этажа (core/masses.js): объединённый контур масс,
// пересекающих активный этаж, — подложка под комнатами и стенами; клики плана
// его не ловят. Настройка вида (вкладка «Свойства» без выбора): показывать
// эскиз, только контур. Только вид — в браузере (localStorage), на печать,
// листы и экспорт не влияет.
//
// Рёбра и вершины эскиза — цели привязки комнат (магнит, ui/block-gesture.js)
// и стен (ui/wall-tool.js).

import { massSketch, sketchLines } from '../core/masses.js';
import { state } from './state.js';

const KEY = 'kepler-plan-masses';
export const PLAN_MASS_DEFAULT = Object.freeze({ on: true, outlineOnly: false });

export function normalizePlanMass(v) {
  return {
    on: typeof v?.on === 'boolean' ? v.on : PLAN_MASS_DEFAULT.on,
    outlineOnly: typeof v?.outlineOnly === 'boolean' ? v.outlineOnly : PLAN_MASS_DEFAULT.outlineOnly,
  };
}

function read() {
  try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; }
}
function write(v) {
  try { localStorage.setItem(KEY, JSON.stringify(v)); } catch { /* только на сессию */ }
}

export function planMassPref() {
  if (!state.planMass) state.planMass = normalizePlanMass(read());
  return state.planMass;
}

export function setPlanMassPref(patch) {
  state.planMass = normalizePlanMass({ ...planMassPref(), ...patch });
  write(state.planMass);
  return state.planMass;
}

let cache = { key: null, sketch: null, lines: null };

// Эскиз активного этажа (кеш по массам и этажу).
export function activeMassSketch(project = state.project) {
  const masses = project?.masses;
  if (!masses?.length) return null;
  const level = (project.levels || []).find((l) => l.id === project.activeLevel);
  if (!level) return null;
  const key = `${level.id}|${level.elevation}|${level.height}|${JSON.stringify(masses)}`;
  if (cache.key !== key) {
    const sketch = massSketch(masses, level);
    cache = { key, sketch: sketch.rects.length ? sketch : null, lines: sketch.rects.length ? sketchLines(sketch) : null };
  }
  return cache.sketch;
}

// Линии привязки эскиза { xs, ys } или null (эскиз выключен или пуст).
export function massSnapLines(project = state.project) {
  if (!planMassPref().on) return null;
  return activeMassSketch(project) ? cache.lines : null;
}

// Вершины контура эскиза — точки привязки стен.
export function massSnapPoints(project = state.project) {
  if (!planMassPref().on) return [];
  return activeMassSketch(project)?.points || [];
}
