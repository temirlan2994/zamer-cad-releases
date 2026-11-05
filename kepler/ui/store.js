// Изменения проекта: транзакции с историей, отмена/повтор, автосохранение.

import { arrangeRoom } from '../core/furnish.js';
import { normsReport } from '../core/norms.js';
import {
  deserializeProject, levelBelow, levelProject, roomById, serializeProject,
} from '../core/model.js';
import { deriveWalls } from '../core/walls.js';
import { el } from './dom.js';
import { renderLevelBar } from './levels.js';
import { applyModeRotation } from './modes.js';
import { renderProps } from './props.js';
import { history, state } from './state.js';
import { updateConnectivity } from './status.js';
import { updateDimModeBtn } from './toolbar.js';
import { renderSelectionToolbar } from './selection-toolbar.js';
import { syncUnderlayImage } from './underlay.js';
import { requestDraw } from './view.js';
import { refresh3d } from './view3d.js';

export const AUTOSAVE_KEY = 'kepler-plan-autosave';
export const PID_KEY = 'kepler-plan-pid'; // какой проект из «Проектов» сейчас открыт

let autosaveTimer = null;

export function refreshDerived() {
  state.walls = deriveWalls(state.project);
  // Стены этажа ниже — бледная подложка, чтобы ставить стены над стенами.
  const below = levelBelow(state.project);
  state.belowWalls = below ? deriveWalls(levelProject(state.project, below.id)) : null;
}

export function snapshot() {
  return serializeProject(state.project);
}

// Снимок для истории при замене проекта целиком (пример, шаблон, файл,
// «Новый»). Пустой проект в историю не кладём: Ctrl+Z после загрузки не
// должен подменять результат пустым «Новым домом».
export function snapshotIfContent() {
  const p = state.project;
  if (!p) return null;
  const filled = (p.levels || []).some((l) => l.rooms?.length || l.items?.length) || p.rooms?.length;
  return filled ? snapshot() : null;
}

// Запись истории = снимок + идентификатор проекта из «Проектов»: отмена после
// открытия другого проекта возвращает и содержимое, и привязку (pid), иначе
// «Сохранить версию» записала бы чужой проект поверх своего.
export function pushHistory(before, pid = state.pid) {
  history.undo.push({ text: before, pid });
  if (history.undo.length > 40) history.undo.shift();
  history.redo.length = 0;
}

export function mutate(fn, { arrange = [], skipHistory = false } = {}) {
  const before = snapshot();
  fn();
  refreshDerived();
  for (const roomId of new Set(arrange)) {
    const room = roomById(state.project, roomId);
    if (room) state.rejected.set(roomId, arrangeRoom(state.project, room, state.walls));
  }
  if (!skipHistory) pushHistory(before);
  afterChange();
}

// Лёгкое изменение без истории (настройки солнца, прозрачность подложки).
export function tweak(fn) {
  fn();
  scheduleAutosave();
  requestDraw();
}

// Нормы (инсоляция, площади, свет, высота) — пересчёт после изменений.
export function refreshNorms() {
  try {
    state.norms = normsReport(state.project);
  } catch (error) {
    state.norms = null;
    console.error('Нормы не посчитались:', error);
  }
}

export function afterChange() {
  syncUnderlayImage();
  updateConnectivity();
  refreshNorms();
  renderProps();
  renderSelectionToolbar();
  updateDimModeBtn();
  renderLevelBar();
  refresh3d(); // открытый 3D-вид следует за правками
  el('alignBtn')?.classList.toggle('active', Boolean(state.project?.building?.rotation));
  requestDraw();
  scheduleAutosave();
}

function scheduleAutosave() {
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => {
    try {
      localStorage.setItem(AUTOSAVE_KEY, serializeProject(state.project));
      localStorage.setItem(PID_KEY, state.pid || '');
    } catch { /* тихо */ }
  }, 500);
}

export function restoreFrom(text) {
  state.project = deserializeProject(text);
  const name = el('projectName');
  if (name) name.value = state.project.name;
  state.selection = null;
  refreshDerived();
  applyModeRotation();
  afterChange();
}

export function undo() {
  if (!history.undo.length) return;
  history.redo.push({ text: snapshot(), pid: state.pid });
  const entry = history.undo.pop();
  restoreFrom(entry.text);
  state.pid = entry.pid;
}

export function redo() {
  if (!history.redo.length) return;
  history.undo.push({ text: snapshot(), pid: state.pid });
  const entry = history.redo.pop();
  restoreFrom(entry.text);
  state.pid = entry.pid;
}
