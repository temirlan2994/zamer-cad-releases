// Режимы «План» / «Участок» и поворот вида («Выровнять», север).

import { refs } from './dom.js';
import { applyLibraryTab, renderFurnitureBar } from './library.js';
import { renderProps } from './props.js';
import { state } from './state.js';
import { cancelTool } from './tools.js';
import { requestDraw, scaleLabel } from './view.js';

export function applyModeRotation() {
  // «Выровнять» = поворот всего вида (ракурса) целиком, одинаково в обоих
  // режимах. В «Участке» добавляется север (север вверх).
  const viewRot = ((state.project.viewRotation || 0) * Math.PI) / 180;
  state.view.rotation = state.modeName === 'site'
    ? viewRot - ((state.project.site?.north || 0) * Math.PI) / 180
    : viewRot;
}

export function setEditorMode(mode) {
  if (state.modeName === mode) return;
  state.views[state.modeName] = { scale: state.view.scale, panX: state.view.panX, panY: state.view.panY };
  state.modeName = mode;
  const saved = state.views[mode];
  state.view.scale = saved.scale;
  state.view.panX = saved.panX;
  state.view.panY = saved.panY;
  applyModeRotation();
  cancelTool();
  state.selection = null;
  refs.modePlan.classList.toggle('active', mode === 'plan');
  refs.modeSite.classList.toggle('active', mode === 'site');
  refs.roomCards.hidden = mode !== 'plan';
  refs.siteTools.hidden = mode !== 'site';
  refs.libraryTitle.hidden = mode === 'plan'; // в «Плане» заголовок задаёт вкладка
  refs.libraryTitle.textContent = mode === 'plan' ? 'Помещения' : 'Участок';
  refs.libraryHint.textContent = mode === 'plan'
    ? 'Кликните тип, затем место на плане. Комнаты стыкуются сами.'
    : 'Топосъёмка, граница, красная линия, въезд, дорога, север.';
  renderProps();
  renderFurnitureBar();
  applyLibraryTab();
  refs.statusScale.textContent = scaleLabel();
  requestDraw();
}
