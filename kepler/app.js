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
import { bindWorkspaceViews } from './ui/workspace-views.js';
import {
  applyLibraryTab, bindFurnitureSearch, renderFurnitureBar, renderLibrary,
} from './ui/library.js';
import { applyModeRotation } from './ui/modes.js';
import { bindProjects, continueCurrentProject, openProjectChooser } from './ui/projects.js';
import { editorBeforeReload } from './ui/start-menu.js';
import { renderProps } from './ui/props.js';
import { state } from './ui/state.js';
import {
  AUTOSAVE_EVENT, BROKEN_KEY, PID_KEY, bindAutosaveLifecycle, loadAutosave,
  mutate, parseProjectText, refreshDerived, refreshIssues, refreshNorms, restoreHeavyRefs, tweak,
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
import { bindSolarAnalysis } from './ui/solar-analysis.js';
import { bindSolarReport } from './ui/solar-report-ui.js';
import { getBackend, prepareAccount } from './ui/cloud.js';
import {
  getScopedItem, getStorageScope, setScopedItem, setStorageScope,
} from './ui/storage-scope.js';
import { shouldUseRemoteProject } from './ui/startup-cloud.js';
import { syncProjectNameUi } from './ui/project-name.js';
import { bindPwa } from './ui/pwa.js';
import { bindProjectRoute, renderProjectRoute } from './ui/project-route.js';

// Firebase восстанавливает Google-сессию асинхронно. До чтения локального
// черновика узнаём UID, чтобы на общем компьютере один человек не увидел
// автосохранение другого. Без настроенного Firebase это мгновенный guest.
(async function boot() {
  bindCanvasInput();
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
  bindSolarAnalysis(() => { // выбранная комната: прямое солнце и остекление
    renderProps();
    requestDraw();
  });
  bindSolarReport(); // сезонная сводка по помещениям и экспорт CSV/JSON
  bindPwa(); // установка на телефон, офлайн-копия и автоматические обновления
  bindProjectRoute(); // этапы подготовки участка, паспорт и карта возможностей

  const account = await prepareAccount();
  const previousScope = getStorageScope();
  setStorageScope(account.uid);
  try { state.pid = getScopedItem(PID_KEY) || null; } catch { state.pid = null; }
  bindProjects(account);
  loadTheme();
  loadLandscapeStyle();
  loadLandscapeSun();
  bindLandscapeSun(requestDraw, mutate);
  bindAutosaveLifecycle();
  // Автосохранение: проект с любым содержимым (комнаты, ландшафт, рельеф,
  // подложка…) продолжается. Битое не роняет запуск: копия — в резерв,
  // старт с пустого проекта и предупреждение в стартовом меню.
  const editor = editorBeforeReload(previousScope);
  let saved = loadAutosave({ includeEmpty: Boolean(editor) });
  const sameDraft = editor && saved.project && editor.pid === state.pid;
  const restoreById = editor?.pid && !sameDraft;
  if (!saved.project) {
    state.pid = null;
    if (!restoreById) {
      try { setScopedItem(PID_KEY, ''); } catch { /* хранилище недоступно */ }
    }
  }
  let openedFromCloud = false;
  let localNeedsCloudSync = false;
  const resumeWithLease = sameDraft && account.provider === 'firebase' && state.pid;
  if (account.signedIn && !resumeWithLease && !restoreById) {
    try {
      const cloud = await getBackend();
      if (cloud.mode === 'cloud') {
        // Сравниваем только известный проект этого аккаунта. При возврате
        // в облачный редактор читаем модель после получения права редактирования.
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
    syncProjectNameUi();
    refreshNorms();
    refreshIssues();
    renderLibrary();
    renderLevelBar();
    renderFurnitureBar();
    applyLibraryTab();
    renderProps();
    renderSelectionToolbar();
    renderProjectRoute();
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
  bindWorkspaceViews();
  refs.statusScale.textContent = scaleLabel();
  requestAnimationFrame(fitView);
  requestDraw();
  if (!broken && openedFromCloud) tweak(() => {}); // сохранить облачную копию и локально
  else if (!broken && localNeedsCloudSync && saved.project) {
    document.dispatchEvent(new CustomEvent(AUTOSAVE_EVENT, {
      detail: { text: serializeProject(saved.project, { pretty: false }) },
    }));
  }
  const resumed = !broken && (restoreById || sameDraft)
    && await continueCurrentProject({ reloading: true, savedAt: saved.savedAt, pid: editor.pid, restoreTab: start });
  // Стартовое окно доступно сразу, пока список и миниатюры ещё загружаются.
  const chooser = !resumed && document.getElementById('startScreen').hidden
    ? openProjectChooser({ initial: true, broken }) : null;
  bindKeyboard();
  document.getElementById('editorBoot').hidden = true;
  if (document.getElementById('startScreen').hidden && document.getElementById('editLockScreen').hidden) {
    document.querySelector('.app').inert = false;
  }
  await chooser;
  exposeDebugApi();
})().catch((error) => {
  console.error('kep•ler 3D не запустился:', error);
  const message = `Не удалось открыть редактор. ${error?.message || ''}`.trim();
  const bootScreen = document.getElementById('editorBoot');
  bootScreen.querySelector('span').textContent = message;
  bootScreen.querySelector('a').hidden = false;
  if (!document.getElementById('startScreen').hidden || !document.getElementById('editLockScreen').hidden) {
    refs.toast.textContent = message;
    refs.toast.classList.add('show');
  } else {
    bootScreen.hidden = false;
    document.querySelector('.app').inert = true;
  }
});
