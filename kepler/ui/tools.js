// Выделение и активный инструмент (размещение, рисование, правка слоя).

import { roomType } from '../core/catalog.js';
import { roomById } from '../core/model.js';
import { deriveWalls } from '../core/walls.js';
import { el, refs } from './dom.js';
import { renderLibrary } from './library.js';
import { renderProps } from './props.js';
import { state } from './state.js';
import { renderSelectionToolbar } from './selection-toolbar.js';
import { closeLibrarySheet } from './mobile.js';
import { requestDraw } from './view.js';

export function selectObject(selection) {
  const pending = state.pendingRoomSplit;
  if (pending && (!selection || selection.type !== 'room' || selection.id !== pending.roomId)) {
    const room = roomById(state.project, pending.roomId);
    if (room && !pending.moved) {
      if (pending.outline) room.outline = structuredClone(pending.outline); else delete room.outline;
      if (pending.notch) room.notch = structuredClone(pending.notch); else delete room.notch;
      state.walls = deriveWalls(state.project);
    }
    state.pendingRoomSplit = null;
  }
  state.selection = selection;
  renderProps();
  updateWallButtons();
  renderSelectionToolbar();
  requestDraw();
}

// Плавающие кнопки «+ дверь / + окно» у середины выбранной стены.
function updateWallButtons() {
  // Оставлена точка вызова для старых обработчиков вида; плавающей панели
  // стены больше нет — все команды находятся в selectionToolbar.
}

export function positionWallButtons() {
  // Панель закреплена сверху, позиционирование относительно стены не нужно.
}

export function setHint(text) {
  refs.hint.textContent = text;
  refs.hint.hidden = !text;
}

export function setTool(tool, hint) {
  state.tool = tool;
  state.draft = null;
  state.ghost = null;
  state.ghostItem = null;
  state.ghostOpening = null;
  state.ghostDoor = null;
  setHint(hint || '');
  renderLibrary();
  renderSelectionToolbar();
  requestDraw();
}

export function cancelTool() {
  state.tool = null;
  state.draft = null;
  state.ghost = null;
  state.ghostItem = null;
  state.ghostOpening = null;
  state.calibration = null;
  state.entryGhost = null;
  state.calCursor = null;
  state.northCursor = null;
  state.ghostDoor = null;
  state.guides = [];
  state.elevEdit = null;
  if (!el('calOverlay').hidden) el('calOverlay').hidden = true;
  if (!el('elevOverlay').hidden) el('elevOverlay').hidden = true;
  setHint('');
  renderLibrary();
  renderSelectionToolbar();
  requestDraw();
}

export function startPlaceRoom(type) {
  closeLibrarySheet(); // телефон: освободить план для касания
  setTool({ kind: 'place-room', type, rotation: 0 }, `Кликните на плане, чтобы разместить «${roomType(type).title}» · Пробел — повернуть · Esc — отмена`);
  state.selection = null;
  renderProps();
}

export function startPlaceOpening(openKind, presetWall = null) {
  setTool({ kind: 'place-opening', openKind, presetWall, doorTurns: 0 }, openKind === 'door'
    ? 'Кликните по стене, чтобы добавить дверь · Пробел — петли / направление · Esc — отмена'
    : 'Кликните по наружной стене, чтобы добавить окно · Esc — отмена');
}

export function startPlaceFurniture(kind, title = 'мебель') {
  closeLibrarySheet();
  setTool({ kind: 'place-furniture', itemKind: kind, rotation: 0 },
    `Двигайте по плану и кликните, чтобы поставить «${title}» · Пробел — повернуть · Esc — отмена`);
  state.selection = null;
  renderProps();
}

// Пробел во время размещения меняет предпросмотр, а не включает панораму.
export function rotatePlacementPreview() {
  const tool = state.tool;
  if (!tool) return false;
  if (tool.kind === 'place-furniture') {
    tool.rotation = ((tool.rotation || 0) + 90) % 360;
    if (state.ghostItem) state.ghostItem.rotation = tool.rotation;
  } else if (tool.kind === 'place-room') {
    tool.rotation = ((tool.rotation || 0) + 90) % 360;
    if (state.ghost?.rect) {
      const rect = state.ghost.rect;
      const cx = rect.x + rect.w / 2;
      const cy = rect.y + rect.h / 2;
      [rect.w, rect.h] = [rect.h, rect.w];
      rect.x = cx - rect.w / 2;
      rect.y = cy - rect.h / 2;
    }
  } else if (tool.kind === 'place-opening' && tool.openKind === 'door') {
    const previous = tool.doorTurns || 0;
    tool.doorTurns = (previous + 1) % 4;
    if (state.ghostDoor) {
      if (previous === 0 || previous === 2) state.ghostDoor.hingeStart = !state.ghostDoor.hingeStart;
      else state.ghostDoor.swingIn = !state.ghostDoor.swingIn;
    }
  } else return false;
  requestDraw();
  return true;
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
  if (t.kind === 'terrain') return 'terrain';
  if (t.kind === 'draw' || t.kind === 'edit') return t.target;
  return null;
}
