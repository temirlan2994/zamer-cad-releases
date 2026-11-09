// Координационные оси на плане (core/grid-axes.js): настройки вида и цели
// привязки. Настройки (вкладка «Свойства» без выбора, блок «Координационные
// оси») — в браузере (localStorage), в файл не идут:
//   on — показывать оси на плане (выключено — оси и не притягивают);
//   dims — размерная цепочка между осями;
//   sheets — оси на листах планов этажей;
//   snap — 'face' (грань комнаты или наружная грань стены на оси) или
//          'axis' (ось стены на оси).
// Лёгкий модуль: только core и state (его читает render.js).

import { DEFAULT_EXTERIOR } from '../core/catalog.js';
import { gridExtent, gridOffsets, gridWallPoints, visibleGrids } from '../core/grid-axes.js';
import { state } from './state.js';

const KEY = 'kepler-plan-grids';
export const PLAN_GRID_DEFAULT = Object.freeze({ on: true, dims: false, sheets: true, snap: 'face' });

export function normalizePlanGrid(v) {
  const b = (k) => (typeof v?.[k] === 'boolean' ? v[k] : PLAN_GRID_DEFAULT[k]);
  return { on: b('on'), dims: b('dims'), sheets: b('sheets'), snap: v?.snap === 'axis' ? 'axis' : 'face' };
}

function read() {
  try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; }
}
function write(v) {
  try { localStorage.setItem(KEY, JSON.stringify(v)); } catch { /* только на сессию */ }
}

export function planGridPref() {
  if (!state.planGrid) state.planGrid = normalizePlanGrid(read());
  return state.planGrid;
}

export function setPlanGridPref(patch) {
  state.planGrid = normalizePlanGrid({ ...planGridPref(), ...patch });
  write(state.planGrid);
  return state.planGrid;
}

export const projectGrids = (project = state.project) => project?.grids || [];

// Оси — цели привязки (видимые и включённые) или пустой список.
export function activeGrids(project = state.project) {
  if (state.modeName && state.modeName !== 'plan') return [];
  if (!planGridPref().on) return [];
  return visibleGrids(projectGrids(project));
}

// Точки привязки инструмента «Стена» (только своя координата у каждой оси).
export const gridSnapPoints = (project = state.project) => gridWallPoints(activeGrids(project));

// Смещения граней комнаты от оси по настройке привязки.
export function gridSnapOffsets(project = state.project) {
  const ext = Number(project?.settings?.exterior) || DEFAULT_EXTERIOR;
  return gridOffsets(planGridPref().snap, ext);
}

export const gridExtentOf = (g, project = state.project) => gridExtent(project, g);
