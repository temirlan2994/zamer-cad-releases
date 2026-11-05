// Режимы «План» / «Участок» / «Ландшафт» и поворот вида («Выровнять», север).

import { panForMovedBuilding } from '../core/site-check.js';
import { refs } from './dom.js';
import { renderLandscapeLibrary } from './landscape.js';
import { renderLevelBar } from './levels.js';
import { applyLibraryTab, renderFurnitureBar } from './library.js';
import { renderProps } from './props.js';
import { state } from './state.js';
import { cancelTool } from './tools.js';
import { fitViewOnce, requestDraw, rotateViewTo, scaleLabel } from './view.js';

// Поворот камеры режима: «План» идёт по осям дома (комнаты всегда прямые),
// «Участок» — север вверх. Связь дома и участка одна и та же — это данные
// (project.building), меняется только ракурс.
// «Ландшафт» — вид и координаты участка, как «Участок».
export const isSiteView = (mode = state.modeName) => mode === 'site' || mode === 'landscape';

export function modeRotation(mode = state.modeName) {
  const deg = isSiteView(mode) ? state.project.site?.north || 0 : state.project.building?.rotation || 0;
  return deg ? -(deg * Math.PI) / 180 : 0; // без «-0»
}

// pivot — мировая точка, которая остаётся на месте экрана (по умолчанию центр).
export function applyModeRotation(pivot = null) {
  rotateViewTo(modeRotation(), pivot);
}

export function setEditorMode(mode) {
  if (state.modeName === mode) return;
  // Флаги touched/fitted (view.js) сохраняются вместе с видом.
  // origin — где стоял дом: если в «Участке» его сдвинули, вид «Плана»
  // едет следом, и дом остаётся на том же месте экрана.
  const origin = state.project.building?.origin || { x: 0, y: 0 };
  state.views[state.modeName] = {
    ...state.views[state.modeName],
    scale: state.view.scale, panX: state.view.panX, panY: state.view.panY, rotation: state.view.rotation,
    origin: { x: origin.x, y: origin.y },
  };
  state.modeName = mode;
  if (!state.views[mode]) state.views[mode] = { scale: 0.03, panX: 120, panY: 120 };
  const saved = state.views[mode];
  state.view.scale = saved.scale;
  state.view.panX = saved.panX;
  state.view.panY = saved.panY;
  state.view.rotation = saved.rotation ?? modeRotation(mode);
  if (mode === 'plan' && saved.origin && Number.isFinite(saved.scale)) {
    const pan = panForMovedBuilding(state.view, origin.x - saved.origin.x, origin.y - saved.origin.y);
    state.view.panX = pan.panX;
    state.view.panY = pan.panY;
  }
  applyModeRotation(); // если поворот дома/север поменялся — докрутить вокруг центра
  // «Участок» при первом входе вписывается целиком (граница, дороги, соседи),
  // если пользователь ещё не двигал там вид.
  if (isSiteView(mode)) fitViewOnce();
  cancelTool();
  state.selection = null;
  state.hover = null;
  state.ghostLandscape = null;
  refs.modePlan.classList.toggle('active', mode === 'plan');
  refs.modeSite.classList.toggle('active', mode === 'site');
  refs.roomCards.hidden = mode !== 'plan';
  refs.siteTools.hidden = mode !== 'site';
  refs.libraryTitle.hidden = mode === 'plan'; // в «Плане» заголовок задаёт вкладка
  refs.libraryTitle.textContent = mode === 'plan' ? 'Помещения' : 'Участок';
  document.body.classList.toggle('mode-landscape', mode === 'landscape');
  refs.libraryHint.textContent = mode === 'plan'
    ? 'Кликните тип, затем место на плане. Комнаты стыкуются сами.'
    : 'Топосъёмка, граница, красная линия, въезд, дорога, север.';
  renderProps();
  renderFurnitureBar();
  applyLibraryTab();
  renderLandscapeLibrary();
  renderLevelBar();
  refs.statusScale.textContent = scaleLabel();
  requestDraw();
}
