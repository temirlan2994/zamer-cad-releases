// Проект как файл: новый, пример, открыть, сохранить, экспорт.

import { buildProjectDxf, buildStructuredExport } from '../core/export.js';
import { createProject, serializeProject } from '../core/model.js';
import { refs, toast } from './dom.js';
import { applyLibraryTab } from './library.js';
import { applyModeRotation } from './modes.js';
import { buildSample } from './sample.js';
import { state } from './state.js';
import { afterChange, pushHistory, refreshDerived, restoreFrom, snapshot } from './store.js';
import { fitView } from './view.js';

function download(filename, text, mime) {
  try {
    const blob = new Blob([text], { type: mime });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  } catch {
    toast('Скачивание недоступно в этом окружении — используйте «Копировать»', true);
  }
}

function safeFileName() {
  return (state.project.name || 'kepler-plan').replace(/[^\wа-яА-ЯёЁ -]/g, '').trim().replace(/\s+/g, '-') || 'kepler-plan';
}

export function handleExport(kind) {
  refs.exportDropdown.hidden = true;
  if (kind === 'project') {
    download(`${safeFileName()}.kepler.json`, serializeProject(state.project), 'application/json');
    toast('Файл проекта сохраняется (.kepler.json)');
  } else if (kind === 'json') {
    download(`${safeFileName()}.export.json`, JSON.stringify(buildStructuredExport(state.project), null, 2), 'application/json');
    toast('Структурированный JSON для Revit-плагина');
  } else if (kind === 'dxf') {
    download(`${safeFileName()}.dxf`, buildProjectDxf(state.project), 'application/dxf');
    toast('DXF сохраняется');
  } else if (kind === 'dxf-revit') {
    download(`${safeFileName()}-revit.dxf`, buildProjectDxf(state.project, { profile: 'revit' }), 'application/dxf');
    toast('DXF с Revit-слоями (ZAMER_*) сохраняется');
  } else if (kind === 'copy') {
    const text = serializeProject(state.project);
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text)
        .then(() => toast('Проект скопирован в буфер обмена'))
        .catch(() => toast('Не удалось скопировать — сохраните файлом', true));
    } else {
      toast('Буфер обмена недоступен', true);
    }
  }
}

export function openProjectFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const before = snapshot();
      restoreFrom(String(reader.result));
      pushHistory(before);
      fitView();
      refs.projectName.value = state.project.name;
      toast(`Открыт проект «${state.project.name}»`);
    } catch (error) {
      toast(`Не удалось открыть: ${error.message}`, true);
    }
  };
  reader.readAsText(file);
}

export function loadSample() {
  const before = state.project ? snapshot() : null;
  const { project, rejected } = buildSample();
  state.project = project;
  state.rejected = rejected;
  state.selection = null;
  refreshDerived();
  applyModeRotation();
  if (before) pushHistory(before);
  refs.projectName.value = project.name;
  afterChange();
  fitView();
}

export function newProject() {
  const before = state.project ? snapshot() : null;
  state.project = createProject(); // чистый участок: без топосъёмки, границы, соседей
  state.selection = null;
  state.tool = null;
  state.rejected.clear();
  state.underlayImg = null; // убрать картинку топосъёмки из прошлого проекта
  state.modeName = 'plan';
  state.views = {
    plan: { scale: 0.08, panX: 120, panY: 120 },
    site: { scale: 0.03, panX: 120, panY: 120 },
  };
  refs.modePlan.classList.add('active');
  refs.modeSite.classList.remove('active');
  refs.roomCards.hidden = false;
  refs.siteTools.hidden = true;
  refs.libraryTitle.hidden = true;
  refs.libraryTitle.textContent = 'Помещения';
  state.libraryTab = 'rooms';
  applyLibraryTab();
  refreshDerived();
  applyModeRotation();
  if (before) pushHistory(before);
  refs.projectName.value = state.project.name;
  afterChange();
  fitView();
}
