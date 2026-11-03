// Рельеф в режиме «Участок»: инструмент «Отметка высоты» (клик — ввод
// отметки на плане, перетаскивание точки), импорт отметок из DXF подложки и
// из списка «x, y, z». Расчёты — core/terrain.js.

import {
  compassName, createTerrain, formatElevation, interpolateZ, parseElevationM, parseXyzList, slopeAt,
  terrainModel, underlayMarksToWorld,
} from '../core/terrain.js';
import { canvas, el, toast } from './dom.js';
import { state } from './state.js';
import { mutate } from './store.js';
import { selectObject, setTool } from './tools.js';
import { requestDraw, screenToWorld, worldToScreen } from './view.js';

function makeId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
}

export function ensureTerrain(site) {
  if (!site.terrain) site.terrain = createTerrain();
  return site.terrain;
}

export function startTerrainTool() {
  setTool({ kind: 'terrain' }, 'Клик — новая отметка (в метрах, например 123.45) · тяните точку — переместить · Delete — удалить · Esc — выйти');
}

// Точка рельефа под курсором (экранные координаты).
export function hitTerrainPoint(screen) {
  const points = state.project.site?.terrain?.points || [];
  const tol = state.coarsePointer ? 16 : 9;
  let best = null;
  for (const p of points) {
    const s = worldToScreen(p.x, p.y);
    const d = Math.hypot(s.x - screen.x, s.y - screen.y);
    if (d <= tol && (!best || d < best.d)) best = { d, p };
  }
  return best ? best.p : null;
}

// --- Поле ввода отметки прямо на плане (как длина отрезка калибровки) ---

export function openElevInput(world) {
  const model = terrainModel(state.project.site?.terrain);
  const guess = interpolateZ(model, world.x, world.y) ?? state.lastElev ?? null;
  state.elevEdit = { x: Math.round(world.x / 10) * 10, y: Math.round(world.y / 10) * 10 };
  const input = el('elevInput');
  input.value = guess != null ? formatElevation(guess) : '';
  el('elevOverlay').hidden = false;
  positionElevInput();
  requestDraw();
  setTimeout(() => { input.focus(); input.select(); }, 20);
}

export function positionElevInput() {
  const overlay = el('elevOverlay');
  if (!overlay || overlay.hidden || !state.elevEdit) return;
  const p = worldToScreen(state.elevEdit.x, state.elevEdit.y);
  overlay.style.left = `${p.x}px`;
  overlay.style.top = `${p.y - 30}px`;
}

export function hideElevInput() {
  const overlay = el('elevOverlay');
  if (overlay) overlay.hidden = true;
  state.elevEdit = null;
  requestDraw();
}

// Enter: добавить точку. quiet — при клике мимо: пустое/неверное поле просто
// закрывается без сообщения.
export function applyElevInput({ quiet = false } = {}) {
  const edit = state.elevEdit;
  if (!edit) return false;
  const z = parseElevationM(el('elevInput').value);
  if (z == null) {
    if (quiet) { hideElevInput(); return false; }
    toast('Введите отметку в метрах, например 123.45');
    return false;
  }
  const point = { id: makeId('tp'), x: edit.x, y: edit.y, z };
  mutate(() => { ensureTerrain(state.project.site).points.push(point); });
  state.lastElev = z;
  hideElevInput();
  selectObject({ type: 'site', kind: 'terrain-point', id: point.id });
  const n = state.project.site.terrain.points.length;
  if (n < 3) toast(`Отметка ${formatElevation(z)} добавлена. Для рельефа нужно минимум 3 точки (сейчас ${n})`);
  return true;
}

export function bindElevInput() {
  const input = el('elevInput');
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); applyElevInput(); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); hideElevInput(); }
  });
}

// --- Строка статуса: отметка и уклон под курсором ---

export function terrainStatus(world) {
  const model = terrainModel(state.project.site?.terrain);
  if (!model?.tris?.length) return '';
  const z = interpolateZ(model, world.x, world.y);
  if (z == null) return ' · отм. —';
  const s = slopeAt(model, world.x, world.y);
  const slope = s && s.percent >= 0.05 ? ` · уклон ${s.percent.toFixed(1)}% ${compassName(s.downDeg, state.project.site.north)}` : '';
  return ` · отм. ${formatElevation(z)}${slope}`;
}

// --- Импорт ---

// Отметки, найденные в DXF подложки (underlay.marks), → рельеф. Ранее
// импортированные из DXF точки заменяются, поставленные вручную — остаются.
export function importUnderlayMarks() {
  const u = state.project.site?.underlay;
  const pts = underlayMarksToWorld(u);
  if (!pts.length) { toast('В подложке нет отметок высот'); return 0; }
  mutate(() => {
    const terrain = ensureTerrain(state.project.site);
    terrain.points = terrain.points.filter((p) => !String(p.id).startsWith('dxf-'));
    pts.forEach((p, i) => terrain.points.push({ id: `dxf-${i}-${Math.floor(Math.random() * 1e6).toString(36)}`, x: Math.round(p.x), y: Math.round(p.y), z: p.z }));
  });
  toast(`Рельеф: добавлено ${pts.length} отметок из DXF. Отметки привязаны к текущему положению подложки`, true);
  return pts.length;
}

// Список «x, y, z». mode: 'kepler' — координаты как в строке статуса (ось Y
// вниз); 'cad' — из CAD/съёмки (ось Y вверх), облако точек переносится
// центром в центр участка (или экрана).
export function importXyzText(text, units = 'm', mode = 'cad') {
  const { points, errors } = parseXyzList(text, units);
  if (!points.length) {
    toast(errors.length ? `Не распознано ни одной строки «x, y, z» (ошибки в строках ${errors.slice(0, 5).join(', ')})` : 'Список пуст');
    return 0;
  }
  let pts = points;
  if (mode === 'cad') {
    pts = points.map((p) => ({ ...p, y: -p.y }));
    const cx = (Math.min(...pts.map((p) => p.x)) + Math.max(...pts.map((p) => p.x))) / 2;
    const cy = (Math.min(...pts.map((p) => p.y)) + Math.max(...pts.map((p) => p.y))) / 2;
    const b = state.project.site?.boundary;
    const target = b?.length >= 3
      ? { x: b.reduce((t, p) => t + p.x, 0) / b.length, y: b.reduce((t, p) => t + p.y, 0) / b.length }
      : screenToWorld(canvas.clientWidth / 2, canvas.clientHeight / 2);
    pts = pts.map((p) => ({ ...p, x: p.x - cx + target.x, y: p.y - cy + target.y }));
  }
  mutate(() => {
    const terrain = ensureTerrain(state.project.site);
    pts.forEach((p, i) => terrain.points.push({ id: `xyz-${i}-${Math.floor(Math.random() * 1e6).toString(36)}`, x: Math.round(p.x), y: Math.round(p.y), z: p.z }));
  });
  toast(`Добавлено отметок: ${pts.length}${errors.length ? `; пропущены строки ${errors.slice(0, 5).join(', ')}${errors.length > 5 ? '…' : ''}` : ''}`, true);
  return pts.length;
}
