// Kepler Plan — редактор архитектурных концепций частных домов.
// Два режима: «План» (дом) и «Участок» (граница, зона застройки, топосъёмка,
// север, инсоляция). Мебель — свободные объекты. Выделение — левой кнопкой,
// рамка по пустому месту; панорама — правой/средней кнопкой или с пробелом.
//
// Точка входа: подключает модули ui/*.js, вешает обработчики и запускает
// редактор. Ядро без DOM — в core/, отрисовка — в render.js.

import { createProject, serializeProject } from './core/model.js';
import { loadVersion } from './core/storage.js';
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
import { bindProjects, openProjectChooser } from './ui/projects.js';
import { renderProps } from './ui/props.js';
import { state } from './ui/state.js';
import {
  AUTOSAVE_EVENT, BROKEN_KEY, PID_KEY, bindAutosaveLifecycle, loadAutosave,
  parseProjectText, refreshDerived, refreshIssues, refreshNorms, restoreHeavyRefs, tweak,
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
import { getBackend, prepareAccount } from './ui/cloud.js';
import {
  getScopedItem, setScopedItem, setStorageScope,
} from './ui/storage-scope.js';
import { shouldUseRemoteProject } from './ui/startup-cloud.js';

// Обработчики событий — в том же порядке, что и раньше.
bindCanvasInput();
bindKeyboard();
bindToolbar();
bindSelectionToolbar();
bindSplitInput();
bindMobile();
bind3d();
bindHelp();
bindFurnitureSearch();
bindView();
bindTheme();
bindSnapBar();
bindErgonomics(); // режим «Эргономика»: кнопка, счётчик, настройки

// Firebase восстанавливает Google-сессию асинхронно. До чтения локального
// черновика узнаём UID, чтобы на общем компьютере один человек не увидел
// автосохранение другого. Без настроенного Firebase это мгновенный guest.
(async function boot() {
  const account = await prepareAccount();
  setStorageScope(account.uid);
  try { state.pid = getScopedItem(PID_KEY) || null; } catch { state.pid = null; }
  bindProjects(account);
  loadTheme();
  loadLandscapeStyle();
  loadLandscapeSun();
  bindLandscapeSun(requestDraw);
  bindAutosaveLifecycle();
  // Автосохранение: проект с любым содержимым (комнаты, ландшафт, рельеф,
  // подложка…) продолжается. Битое не роняет запуск: копия — в резерв,
  // старт с пустого проекта и предупреждение в стартовом меню.
  let saved = loadAutosave();
  if (!saved.project) {
    state.pid = null;
    try { setScopedItem(PID_KEY, ''); } catch { /* хранилище недоступно */ }
  }
  let openedFromCloud = false;
  let localNeedsCloudSync = false;
  if (account.signedIn) {
    try {
      const cloud = await getBackend();
      if (cloud.mode === 'cloud') {
        // На старте больше не подставляем последний проект автоматически:
        // пользователь сначала выбирает его в окне проектов. Сравниваем с
        // облаком только уже известный локальный черновик этого PID.
        if (state.pid && saved.project) {
          const remote = await loadVersion(cloud.db, cloud.root, state.pid);
          const remoteAt = remote.version?.at || remote.meta?.updatedAt || null;
          if (saved.project && !saved.savedAt) {
            // Старый/частично записанный локальный черновик нельзя сравнить
            // по времени. Сохраняем его отдельным облачным проектом, а не
            // перезаписываем известный PID и не выбрасываем локальные данные.
            state.pid = null;
            setScopedItem(PID_KEY, '');
            localNeedsCloudSync = true;
          } else if (shouldUseRemoteProject(saved.project, saved.savedAt, remoteAt)) {
            saved = { project: parseProjectText(remote.text), refs: [], savedAt: remoteAt };
            openedFromCloud = true;
          } else if (saved.project) localNeedsCloudSync = true;
        } else if (saved.project) localNeedsCloudSync = true;
      }
    } catch (error) {
      // Офлайн или временный сбой облака не блокирует локальный редактор.
      console.warn('Облачный проект пока не загрузился:', error);
      localNeedsCloudSync = Boolean(saved.project);
    }
  }
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
  try {
    start(saved.project || createProject());
    // Если большая подложка лежала отдельно в IndexedDB, сначала возвращаем
    // её в проект и только потом отправляем первый облачный черновик.
    await restoreHeavyRefs(saved.project, saved.refs);
  } catch (error) {
    if (!saved.project) throw error; // пустой проект не открылся — это ошибка кода
    console.error('Автосохранение не открылось:', error);
    const text = serializeProject(saved.project, { pretty: false });
    try { setScopedItem(BROKEN_KEY, text); } catch { /* нет места */ }
    broken = { text, error };
    start(createProject());
  }
  refs.statusScale.textContent = scaleLabel();
  requestAnimationFrame(fitView);
  requestDraw();
  if (openedFromCloud) tweak(() => {}); // сохранить облачную копию и локально
  else if (localNeedsCloudSync && saved.project) {
    document.dispatchEvent(new CustomEvent(AUTOSAVE_EVENT, {
      detail: { text: serializeProject(saved.project, { pretty: false }) },
    }));
  }
  await openProjectChooser({ initial: true, broken });
  exposeDebugApi();
})().catch((error) => {
  console.error('Kepler Plan не запустился:', error);
  refs.toast.textContent = `Не удалось запустить редактор: ${error?.message || 'ошибка'}`;
  refs.toast.classList.add('show');
});
