// Шапка, панель инструментов и кнопки поверх канваса.

import { applyDimInput, hideDimInput } from './dim-input.js';
import { canvas, el, refs, toast } from './dom.js';
import { handleExport, loadSample, openProjectFile } from './files.js';
import { applyLibraryTab } from './library.js';
import { setEditorMode } from './modes.js';
import { finishDraft } from './site-actions.js';
import { closeStartMenu, openStartMenu, requestNewProject } from './start-menu.js';
import { state } from './state.js';
import { mutate, redo, tweak, undo } from './store.js';
import { cycleTheme } from './theme.js';
import { applyCalibration, hideCalInput, loadUnderlayFile } from './underlay.js';
import { bindViewPanel } from './view-align.js';
import { bindIssues } from './issues.js';
import { bindElevInput } from './terrain.js';
import { finishWallChain, startBoundRoomTool, startWallTool } from './wall-tool.js';
import { closeSheets, isPhone } from './mobile.js';
import { cancelTool } from './tools.js';
import { bindToolstrip, setTip } from './toolstrip.js';
import { fitView, zoomAt } from './view.js';

// Кнопка на панели инструментов: иконка и короткая подпись режима.
export function updateDimModeBtn() {
  const outer = state.project?.settings?.dimOuter !== false;
  const b = el('dimModeBtn');
  if (!b) return;
  const label = b.querySelector('.tb-label');
  if (label) label.textContent = outer ? 'Снаружи' : 'Ось';
  setTip(b, 'Размеры', outer
    ? 'наружные — по внешней грани стен (клик — по оси)'
    : 'наружные — по оси стен (клик — по внешней грани)');
  b.classList.toggle('active', outer);
  b.setAttribute('aria-pressed', String(outer));
}

export function bindToolbar() {
  refs.modePlan.addEventListener('click', () => setEditorMode('plan'));
  refs.modeSite.addEventListener('click', () => setEditorMode('site'));
  el('landscapeBtn')?.addEventListener('click', () => setEditorMode('landscape'));
  // Вкладки библиотеки: открыта — остаётся открытой на выбранной вкладке.
  const libTab = (tab) => {
    state.libraryTab = tab;
    if (state.modeName === 'plan') {
      const k = state.tool?.kind;
      if ((tab === 'rooms' && k === 'place-furniture') || (tab === 'furniture' && (k === 'bound-room' || k === 'place-room'))) cancelTool();
      state.libraryPinned = !isPhone(); // телефон: библиотека — нижний лист
    }
    applyLibraryTab();
  };
  refs.libTabRooms.addEventListener('click', () => libTab('rooms'));
  refs.libTabFurniture.addEventListener('click', () => libTab('furniture'));
  el('undoBtn').addEventListener('click', undo);
  el('redoBtn').addEventListener('click', redo);
  el('fitBtn').addEventListener('click', fitView);
  // Повторный клик по активному инструменту — выйти из него.
  el('wallToolBtn')?.addEventListener('click', () => {
    if (state.modeName !== 'plan') setEditorMode('plan');
    if (!finishWallChain()) startWallTool();
    closeSheets();
  });
  el('boundRoomBtn')?.addEventListener('click', () => {
    if (state.modeName !== 'plan') setEditorMode('plan');
    // Вместе с инструментом выезжает библиотека типов комнат; повторный клик — выйти и закрыть.
    if (state.tool?.kind === 'bound-room') { state.libraryPinned = false; cancelTool(); } else {
      if (state.tool?.kind === 'wall') finishWallChain();
      state.libraryTab = 'rooms';
      state.libraryPinned = !isPhone(); // телефон: библиотека — нижний лист
      startBoundRoomTool();
    }
    closeSheets();
    applyLibraryTab();
  });
  bindToolstrip(); // остальные кнопки панели инструментов (ui/toolstrip.js)
  bindViewPanel(); // «Вид» на панели инструментов — поворот вида (ui/view-align.js)
  bindIssues(); // «⚠ N» — замечания и нормы в левом верхнем углу холста (ui/issues.js)
  el('dimModeBtn').addEventListener('click', () => {
    const cur = state.project.settings.dimOuter !== false;
    tweak(() => { state.project.settings.dimOuter = !cur; });
    updateDimModeBtn();
    toast(cur ? 'Наружные размеры — по оси стен' : 'Наружные размеры — по внешней грани');
  });
  el('zoomInBtn').addEventListener('click', () => zoomAt({ x: canvas.clientWidth / 2, y: canvas.clientHeight / 2 }, 1.25));
  el('zoomOutBtn').addEventListener('click', () => zoomAt({ x: canvas.clientWidth / 2, y: canvas.clientHeight / 2 }, 0.8));
  el('dimInputField').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); applyDimInput(); }
    else if (e.key === 'Escape') { e.preventDefault(); hideDimInput(); }
  });
  el('dimInputOk').addEventListener('click', () => applyDimInput());
  el('draftDone').addEventListener('click', () => finishDraft());
  bindElevInput();
  el('calInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); applyCalibration(Number(el('calInput').value)); }
    else if (e.key === 'Escape') { e.preventDefault(); hideCalInput(); toast('Калибровка отменена'); }
  });
  el('themeBtn').addEventListener('click', cycleTheme);
  el('menuBtn').addEventListener('click', () => openStartMenu());
  el('startClose').addEventListener('click', closeStartMenu);
  el('startContinue').addEventListener('click', closeStartMenu);
  el('startNew').addEventListener('click', requestNewProject);
  el('startSample').addEventListener('click', () => { loadSample(); closeStartMenu(); });
  el('startOpen').addEventListener('click', () => refs.fileInput.click());
  refs.fileInput.addEventListener('change', () => {
    if (refs.fileInput.files?.[0]) { openProjectFile(refs.fileInput.files[0]); closeStartMenu(); }
    refs.fileInput.value = '';
  });
  refs.underlayInput.addEventListener('change', () => {
    if (refs.underlayInput.files?.[0]) loadUnderlayFile(refs.underlayInput.files[0]);
    refs.underlayInput.value = '';
  });
  el('saveBtn').addEventListener('click', () => handleExport('project'));
  el('exportBtn').addEventListener('click', (event) => {
    event.stopPropagation();
    refs.exportDropdown.hidden = !refs.exportDropdown.hidden;
  });
  document.addEventListener('click', (event) => {
    if (!refs.exportDropdown.hidden && !refs.exportDropdown.contains(event.target)) {
      refs.exportDropdown.hidden = true;
    }
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !refs.exportDropdown.hidden) refs.exportDropdown.hidden = true;
  });
  refs.exportDropdown.querySelectorAll('[data-export]').forEach((btn) => {
    btn.addEventListener('click', () => handleExport(btn.dataset.export));
  });
  refs.projectName.addEventListener('change', () => {
    mutate(() => { state.project.name = refs.projectName.value.trim() || state.project.name; });
  });
}
