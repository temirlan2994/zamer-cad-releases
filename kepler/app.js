// Kepler Plan — редактор архитектурных концепций частных домов.
// Два режима: «План» (дом) и «Участок» (граница, зона застройки, топосъёмка,
// север, инсоляция). Мебель — свободные объекты. Выделение — левой кнопкой,
// рамка по пустому месту; панорама — правой/средней кнопкой или с пробелом.
//
// Точка входа: подключает модули ui/*.js, вешает обработчики и запускает
// редактор. Ядро без DOM — в core/, отрисовка — в render.js.

import { createProject, serializeProject } from './core/model.js';
import { exposeDebugApi } from './ui/debug.js';
import { refs } from './ui/dom.js';
import { bindCanvasInput } from './ui/input.js';
import { bindHelp } from './ui/help.js';
import { bindKeyboard } from './ui/keyboard.js';
import { renderLevelBar } from './ui/levels.js';
import { bindMobile } from './ui/mobile.js';
import { bind3d } from './ui/view3d.js';
import {
  applyLibraryTab, bindFurnitureSearch, renderFurnitureBar, renderLibrary,
} from './ui/library.js';
import { applyModeRotation } from './ui/modes.js';
import { bindProjects } from './ui/projects.js';
import { renderProps } from './ui/props.js';
import { openStartMenu } from './ui/start-menu.js';
import { state } from './ui/state.js';
import {
  BROKEN_KEY, bindAutosaveLifecycle, loadAutosave, refreshDerived, refreshIssues, refreshNorms, restoreHeavyRefs,
} from './ui/store.js';
import { bindTheme, loadTheme } from './ui/theme.js';
import { loadLandscapeStyle, loadLandscapeSun } from './ui/landscape-style.js';
import { bindLandscapeSun } from './ui/landscape-sun.js';
import { bindToolbar } from './ui/toolbar.js';
import { bindSelectionToolbar, renderSelectionToolbar } from './ui/selection-toolbar.js';
import { bindSplitInput } from './ui/split-input.js';
import { syncUnderlayImage } from './ui/underlay.js';
import { bindView, fitView, requestDraw, scaleLabel } from './ui/view.js';
import { bindSnapBar } from './ui/draw-snap-ui.js';
import { bindErgonomics } from './ui/ergonomics.js';

// Обработчики событий — в том же порядке, что и раньше.
bindCanvasInput();
bindKeyboard();
bindToolbar();
bindSelectionToolbar();
bindSplitInput();
bindMobile();
bind3d();
bindHelp();
bindProjects();
bindFurnitureSearch();
bindView();
bindTheme();
bindSnapBar();
bindErgonomics(); // режим «Эргономика»: кнопка, счётчик, настройки

(function boot() {
  loadTheme();
  loadLandscapeStyle();
  loadLandscapeSun();
  bindLandscapeSun(requestDraw);
  bindAutosaveLifecycle();
  // Автосохранение: проект с любым содержимым (комнаты, ландшафт, рельеф,
  // подложка…) продолжается. Битое не роняет запуск: копия — в резерв,
  // старт с пустого проекта и предупреждение в стартовом меню.
  const saved = loadAutosave();
  let broken = saved.broken ? { text: saved.broken, error: saved.error } : null;
  const start = (project) => {
    state.project = project;
    refreshDerived();
    applyModeRotation();
    syncUnderlayImage();
    refs.projectName.value = state.project.name;
    refreshNorms();
    refreshIssues();
    renderLibrary();
    renderLevelBar();
    renderFurnitureBar();
    applyLibraryTab();
    renderProps();
    renderSelectionToolbar();
  };
  let showStart = !saved.project;
  try {
    start(saved.project || createProject());
    restoreHeavyRefs(saved.project, saved.refs);
  } catch (error) {
    if (!saved.project) throw error; // пустой проект не открылся — это ошибка кода
    console.error('Автосохранение не открылось:', error);
    const text = serializeProject(saved.project, { pretty: false });
    try { localStorage.setItem(BROKEN_KEY, text); } catch { /* нет места */ }
    broken = { text, error };
    showStart = true;
    start(createProject());
  }
  refs.statusScale.textContent = scaleLabel();
  requestAnimationFrame(fitView);
  requestDraw();
  if (showStart) openStartMenu({ initial: true, broken });
})();

exposeDebugApi();
