// Kepler Plan — редактор архитектурных концепций частных домов.
// Два режима: «План» (дом) и «Участок» (граница, зона застройки, топосъёмка,
// север, инсоляция). Мебель — свободные объекты. Выделение — левой кнопкой,
// рамка по пустому месту; панорама — правой/средней кнопкой или с пробелом.
//
// Точка входа: подключает модули ui/*.js, вешает обработчики и запускает
// редактор. Ядро без DOM — в core/, отрисовка — в render.js.

import { createProject, deserializeProject } from './core/model.js';
import { exposeDebugApi } from './ui/debug.js';
import { refs } from './ui/dom.js';
import { bindCanvasInput } from './ui/input.js';
import { bindKeyboard } from './ui/keyboard.js';
import { renderLevelBar } from './ui/levels.js';
import { applyLibraryTab, renderFurnitureBar, renderLibrary } from './ui/library.js';
import { applyModeRotation } from './ui/modes.js';
import { renderProps } from './ui/props.js';
import { openStartMenu } from './ui/start-menu.js';
import { state } from './ui/state.js';
import { updateConnectivity } from './ui/status.js';
import { AUTOSAVE_KEY, refreshDerived, refreshNorms } from './ui/store.js';
import { bindTheme, loadTheme } from './ui/theme.js';
import { bindToolbar } from './ui/toolbar.js';
import { syncUnderlayImage } from './ui/underlay.js';
import { bindView, fitView, requestDraw, scaleLabel } from './ui/view.js';

// Обработчики событий — в том же порядке, что и раньше.
bindCanvasInput();
bindKeyboard();
bindToolbar();
bindView();
bindTheme();

(function boot() {
  loadTheme();
  let restored = null;
  try {
    const saved = localStorage.getItem(AUTOSAVE_KEY);
    if (saved) restored = deserializeProject(saved);
  } catch { /* нет сохранения */ }
  let showStart = false;
  if (restored && (restored.levels.some((l) => l.rooms.length) || restored.site?.boundary)) {
    // Есть сохранённый проект — продолжаем его.
    state.project = restored;
  } else {
    // Пустой старт: чистый проект и стартовое меню поверх.
    state.project = createProject();
    showStart = true;
  }
  refreshDerived();
  applyModeRotation();
  syncUnderlayImage();
  refs.projectName.value = state.project.name;
  updateConnectivity();
  refreshNorms();
  renderLibrary();
  renderLevelBar();
  renderFurnitureBar();
  applyLibraryTab();
  renderProps();
  refs.statusScale.textContent = scaleLabel();
  requestAnimationFrame(fitView);
  requestDraw();
  if (showStart) openStartMenu({ initial: true });
})();

exposeDebugApi();
