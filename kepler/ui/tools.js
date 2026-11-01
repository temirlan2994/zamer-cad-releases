// Выделение и активный инструмент (размещение, рисование, правка слоя).

import { roomType } from '../core/catalog.js';
import { roomById } from '../core/model.js';
import { el, refs } from './dom.js';
import { findWall } from './hit.js';
import { renderLibrary } from './library.js';
import { renderProps } from './props.js';
import { state } from './state.js';
import { planToScreen, requestDraw } from './view.js';

export function selectObject(selection) {
  state.selection = selection;
  renderProps();
  updateWallButtons();
  requestDraw();
}

// Плавающие кнопки «+ дверь / + окно» у середины выбранной стены.
function updateWallButtons() {
  const panel = el('wallButtons');
  if (state.selection?.type !== 'wall') { panel.hidden = true; return; }
  const wall = findWall(state.selection.key, state.selection.from);
  if (!wall) { panel.hidden = true; return; }
  positionWallButtons(wall);
  const roomA = roomById(state.project, wall.rooms[0]);
  const windowBtn = el('wallAddWindow');
  const canWindow = wall.kind !== 'shared' && !roomA?.parentId;
  windowBtn.disabled = !canWindow;
  windowBtn.style.opacity = canWindow ? '1' : '0.4';
  panel.hidden = false;
}

export function positionWallButtons(wall) {
  const panel = el('wallButtons');
  if (panel.hidden && state.selection?.type !== 'wall') return;
  const mid = planToScreen((wall.center.x1 + wall.center.x2) / 2, (wall.center.y1 + wall.center.y2) / 2);
  panel.style.left = `${mid.x}px`;
  panel.style.top = `${mid.y}px`;
}

export function setHint(text) {
  refs.hint.textContent = text;
  refs.hint.hidden = !text;
}

export function setTool(tool, hint) {
  state.tool = tool;
  state.draft = null;
  state.ghost = null;
  state.ghostOpening = null;
  el('wallButtons').hidden = true; // при активном инструменте кнопки стены прячем
  setHint(hint || '');
  renderLibrary();
  requestDraw();
}

export function cancelTool() {
  state.tool = null;
  state.draft = null;
  state.ghost = null;
  state.ghostOpening = null;
  state.calibration = null;
  state.entryGhost = null;
  state.calCursor = null;
  state.northCursor = null;
  state.ghostDoor = null;
  state.guides = [];
  if (!el('calOverlay').hidden) el('calOverlay').hidden = true;
  setHint('');
  renderLibrary();
  requestDraw();
}

export function startPlaceRoom(type) {
  setTool({ kind: 'place-room', type }, `Кликните на плане, чтобы разместить «${roomType(type).title}» · Esc — отмена`);
  state.selection = null;
  renderProps();
}

export function startPlaceOpening(openKind, presetWall = null) {
  setTool({ kind: 'place-opening', openKind, presetWall }, openKind === 'door'
    ? 'Кликните по стене, чтобы добавить дверь · Esc — отмена'
    : 'Кликните по наружной стене, чтобы добавить окно · Esc — отмена');
}

export function startDraw(target) {
  const names = { boundary: 'границу участка', redline: 'красную линию', road: 'ось дороги' };
  const finish = target === 'boundary'
    ? 'клик по первой точке или Enter — замкнуть'
    : 'двойной клик или Enter — завершить';
  setTool({ kind: 'draw', target }, `Кликами наметьте ${names[target]} · ${finish} · Esc — отмена`);
  state.draft = { kind: target, points: [], cursor: null, closeHint: target === 'boundary' };
}

// Включить правку существующего слоя (вершины/перемещение) — объект выделяется.
export function startEditLayer(target, selection, hint) {
  setTool({ kind: 'edit', target }, hint);
  selectObject(selection);
}

// Какой слой участка сейчас редактируется (по активному инструменту).
export function activeSiteLayer() {
  const t = state.tool;
  if (!t) return null;
  if (t.kind === 'underlay-edit') return 'underlay';
  if (t.kind === 'entry') return 'entry';
  if (t.kind === 'neighbor') return 'neighbor';
  if (t.kind === 'draw' || t.kind === 'edit') return t.target;
  return null;
}
