// Режимы «План» / «Участок» и поворот вида («Выровнять», север).

import { refs } from './dom.js';
import { applyLibraryTab, renderFurnitureBar } from './library.js';
import { renderProps } from './props.js';
import { state } from './state.js';
import { cancelTool } from './tools.js';
import { requestDraw, rotateViewTo, scaleLabel } from './view.js';

// Поворот камеры режима: «План» идёт по осям дома (комнаты всегда прямые),
// «Участок» — север вверх. Связь дома и участка одна и та же — это данные
// (project.building), меняется только ракурс.
export function modeRotation(mode = state.modeName) {
  const deg = mode === 'site' ? state.project.site?.north || 0 : state.project.building?.rotation || 0;
  return deg ? -(deg * Math.PI) / 180 : 0; // без «-0»
}

// pivot — мировая точка, которая остаётся на месте экрана (по умолчанию центр).
export function applyModeRotation(pivot = null) {
  rotateViewTo(modeRotation(), pivot);
}

export function setEditorMode(mode) {
  if (state.modeName === mode) return;
  state.views[state.modeName] = {
    scale: state.view.scale, panX: state.view.panX, panY: state.view.panY, rotation: state.view.rotation,
  };
  state.modeName = mode;
  const saved = state.views[mode];
  state.view.scale = saved.scale;
  state.view.panX = saved.panX;
  state.view.panY = saved.panY;
  state.view.rotation = saved.rotation ?? modeRotation(mode);
  applyModeRotation(); // если поворот дома/север поменялся — докрутить вокруг центра
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
