// Шапка и кнопки поверх канваса.

import { applyDimInput, hideDimInput } from './dim-input.js';
import { canvas, el, refs, toast } from './dom.js';
import { handleExport, loadSample, openProjectFile } from './files.js';
import { applyLibraryTab } from './library.js';
import { setEditorMode } from './modes.js';
import { setBuildingRotation } from './site-actions.js';
import { closeStartMenu, openStartMenu, requestNewProject } from './start-menu.js';
import { state } from './state.js';
import { mutate, redo, tweak, undo } from './store.js';
import { cycleTheme } from './theme.js';
import { setTool, startPlaceOpening } from './tools.js';
import { applyCalibration, hideCalInput, loadUnderlayFile } from './underlay.js';
import { fitView, zoomAt } from './view.js';

export function updateDimModeBtn() {
  const outer = state.project?.settings?.dimOuter !== false;
  const b = el('dimModeBtn');
  if (!b) return;
  b.textContent = outer ? '⟺ Снаружи' : '⟺ По оси';
  b.classList.toggle('active', outer);
}

export function bindToolbar() {
  refs.modePlan.addEventListener('click', () => setEditorMode('plan'));
  refs.modeSite.addEventListener('click', () => setEditorMode('site'));
  refs.libTabRooms.addEventListener('click', () => { state.libraryTab = 'rooms'; applyLibraryTab(); });
  refs.libTabFurniture.addEventListener('click', () => { state.libraryTab = 'furniture'; applyLibraryTab(); });
  el('undoBtn').addEventListener('click', undo);
  el('redoBtn').addEventListener('click', redo);
  el('fitBtn').addEventListener('click', fitView);
  el('alignBtn').addEventListener('click', () => {
    const site = state.project.site;
    if (!site?.underlay && !(site?.boundary?.length)) { toast('Сначала загрузите топосъёмку или начертите границу участка (режим «Участок»)', true); return; }
    if (state.project.building.rotation) {
      // Дом уже повёрнут — повторный клик возвращает его к 0° (тоже на месте).
      setBuildingRotation(0);
      toast('Поворот дома сброшен (0°). Ctrl+Z — вернуть');
      return;
    }
    setTool({ kind: 'align-underlay', points: [] }, 'Кликните две точки вдоль ровной линии участка (край, красная линия) — дом встанет вдоль неё, вид «План» повернётся вслед за домом');
  });
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
  el('wallAddDoor').addEventListener('click', () => {
    if (state.selection?.type === 'wall') startPlaceOpening('door', { key: state.selection.key, from: state.selection.from });
  });
  el('wallAddWindow').addEventListener('click', () => {
    if (el('wallAddWindow').disabled) return;
    if (state.selection?.type === 'wall') startPlaceOpening('window', { key: state.selection.key, from: state.selection.from });
  });
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
  refs.exportDropdown.querySelectorAll('[data-export]').forEach((btn) => {
    btn.addEventListener('click', () => handleExport(btn.dataset.export));
  });
  refs.projectName.addEventListener('change', () => {
    mutate(() => { state.project.name = refs.projectName.value.trim() || state.project.name; });
  });
}
