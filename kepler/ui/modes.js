// Режимы «План» / «Участок» / «Ландшафт» и поворот вида («Выровнять», север).

import { panForMovedBuilding } from '../core/site-check.js';
import { viewRotation } from '../core/view-angles.js';
import { refs } from './dom.js';
import { renderLandscapeLibrary } from './landscape.js';
import { refreshLandscapeSun } from './landscape-sun.js';
import { renderLevelBar } from './levels.js';
import { applyLibraryTab, renderFurnitureBar } from './library.js';
import { renderProps } from './props.js';
import { state } from './state.js';
import { cancelTool } from './tools.js';
import { fitViewOnce, requestDraw, rotateViewTo, scaleLabel } from './view.js';
import { renderViewPanel } from './view-align.js';
import { closeSheet } from './sheet-view.js';
import { closeElevation } from './elevation-view.js';

// Поворот камеры режима (core/view-angles.js): у каждого режима свой угол
// вида (project.settings.viewAngles). Не задан — «План» идёт по осям дома
// (комнаты прямые), «Участок» и «Ландшафт» — север вверх. Связь дома и
// участка — данные (project.building), вид меняет только ракурс.
// «Ландшафт» — координаты участка, как «Участок».
export const isSiteView = (mode = state.modeName) => mode === 'site' || mode === 'landscape';

export function modeRotation(mode = state.modeName) {
  return viewRotation(state.project, mode);
}

// pivot — мировая точка, которая остаётся на месте экрана (по умолчанию центр).
export function applyModeRotation(pivot = null) {
  rotateViewTo(modeRotation(), pivot);
}

export function setEditorMode(mode) {
  closeSheet(); // лист на холсте закрывается при переходе к виду
  closeElevation(); // и фасад
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
  document.body.classList.toggle('mode-site', mode === 'site'); // библиотеки нет (styles.css)
  if (mode === 'landscape') refreshLandscapeSun(); // участок мог смениться (широта, граница)
  refs.libraryHint.textContent = mode === 'plan'
    ? 'Кликните тип, затем место на плане. Комнаты стыкуются сами.'
    : 'Топосъёмка, граница, красная линия, въезд, дорога, север.';
  renderProps();
  renderFurnitureBar();
  applyLibraryTab();
  renderLandscapeLibrary();
  renderLevelBar();
  renderViewPanel(); // у режима свой угол вида
  refs.statusScale.textContent = scaleLabel();
  requestDraw();
}
