// Изменения проекта: транзакции с историей, отмена/повтор, автосохранение.

import { arrangeRoom } from '../core/furnish.js';
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
import { syncUnderlayImage } from './underlay.js';
import { requestDraw } from './view.js';

export const AUTOSAVE_KEY = 'kepler-plan-autosave';

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

export function pushHistory(before) {
  history.undo.push(before);
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

export function afterChange() {
  syncUnderlayImage();
  updateConnectivity();
  renderProps();
  updateDimModeBtn();
  renderLevelBar();
  el('alignBtn')?.classList.toggle('active', Boolean(state.project?.building?.rotation));
  requestDraw();
  scheduleAutosave();
}

function scheduleAutosave() {
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => {
    try { localStorage.setItem(AUTOSAVE_KEY, serializeProject(state.project)); } catch { /* тихо */ }
  }, 500);
}

export function restoreFrom(text) {
  state.project = deserializeProject(text);
  state.selection = null;
  refreshDerived();
  applyModeRotation();
  afterChange();
}

export function undo() {
  if (!history.undo.length) return;
  history.redo.push(snapshot());
  restoreFrom(history.undo.pop());
}

export function redo() {
  if (!history.redo.length) return;
  history.undo.push(snapshot());
  restoreFrom(history.redo.pop());
}
