// Проект как файл: новый, пример, открыть, сохранить, экспорт.

import { buildProjectDxf, buildSitePlanDxf, buildStructuredExport } from '../core/export.js';
import { buildIfc } from '../core/ifc.js';
import { buildLandscapeCsv } from '../core/landscape-report.js';
import { createProject, serializeProject } from '../core/model.js';
import { buildRoomScheduleCsv } from '../core/schedule.js';
import { buildTemplate } from '../core/templates.js';
import { saveFile, saveZip } from './cloud.js';
import { refs, toast } from './dom.js';
import { applyLibraryTab } from './library.js';
import { applyModeRotation } from './modes.js';
import { buildSample } from './sample.js';
import { buildCurrentSheetPng, buildSheetsPdf } from './sheet.js';
import { state } from './state.js';
import {
  afterChange, pushHistory, refreshDerived, restoreFrom, snapshotIfContent,
} from './store.js';
import { fitView } from './view.js';

const download = (filename, data, mime) => saveFile(filename, data, mime);

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
  } else if (kind === 'sheet-pdf') {
    const pdf = buildSheetsPdf(state.project);
    if (!pdf) { toast('Нечего печатать: добавьте комнаты или границу участка', true); return; }
    download(`${safeFileName()}-листы.pdf`, pdf, 'application/pdf');
    toast('PDF: листы A3 с рамкой, штампом и экспликацией');
  } else if (kind === 'sheet-png') {
    const png = buildCurrentSheetPng(state.project, state.modeName === 'landscape' ? 'site' : state.modeName);
    if (!png) { toast(state.modeName !== 'plan' ? 'Для генплана нужна граница участка' : 'На этом этаже нет комнат', true); return; }
    png.then((blob) => download(`${safeFileName()}-лист.png`, blob, 'image/png'));
    toast('PNG: лист A3, 150 dpi');
  } else if (kind === 'schedule-csv') {
    download(`${safeFileName()}-экспликация.csv`, buildRoomScheduleCsv(state.project), 'text/csv;charset=utf-8');
    toast('Экспликация помещений (CSV) — откроется в Excel');
  } else if (kind === 'landscape-csv') {
    if (!state.project.site?.landscape?.objects?.length) { toast('Ландшафт пуст — добавьте объекты в режиме «Ландшафт»', true); return; }
    download(`${safeFileName()}-ландшафт.csv`, buildLandscapeCsv(state.project), 'text/csv;charset=utf-8');
    toast('Ведомость озеленения и малых форм (CSV)');
  } else if (kind === 'ifc') {
    const { text, counts } = buildIfc(state.project);
    download(`${safeFileName()}.ifc`, text, 'application/x-step');
    toast(`IFC4: стен ${counts.walls}, дверей ${counts.doors}, окон ${counts.windows}, помещений ${counts.spaces}, мебели ${counts.furniture}`, true);
  } else if (kind === 'dxf-site') {
    if (!state.project.site?.boundary) { toast('Для генплана нужна граница участка (режим «Участок»)', true); return; }
    download(`${safeFileName()}-genplan.dxf`, buildSitePlanDxf(state.project), 'application/dxf');
    toast('Генплан DXF: дом на участке в координатах съёмки');
  } else if (kind === 'dxf-revit') {
    download(`${safeFileName()}-revit.dxf`, buildProjectDxf(state.project, { profile: 'revit' }), 'application/dxf');
    toast('DXF с Revit-слоями (ZAMER_*) сохраняется');
  } else if (kind === 'zip') {
    const { text } = buildIfc(state.project);
    const name = safeFileName();
    saveZip(`${name}.zip`, [
      { name: `${name}.kepler.json`, data: serializeProject(state.project) },
      { name: `${name}.dxf`, data: buildProjectDxf(state.project) },
      { name: `${name}-revit.dxf`, data: buildProjectDxf(state.project, { profile: 'revit' }) },
      { name: `${name}.ifc`, data: text },
      { name: `${name}-экспликация.csv`, data: buildRoomScheduleCsv(state.project) },
      ...(state.project.site?.landscape?.objects?.length ? [{ name: `${name}-ландшафт.csv`, data: buildLandscapeCsv(state.project) }] : []),
    ]);
    toast('Архив: проект, DXF, DXF для Revit, IFC, экспликация');
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
      const before = snapshotIfContent();
      const beforePid = state.pid;
      restoreFrom(String(reader.result));
      state.pid = null;
      if (before) pushHistory(before, beforePid);
      fitView();
      refs.projectName.value = state.project.name;
      toast(`Открыт проект «${state.project.name}»`);
    } catch (error) {
      toast(`Не удалось открыть: ${error.message}`, true);
    }
  };
  reader.readAsText(file);
}

// Шаблон дома (core/templates.js) — как пример: текущий проект уходит в
// историю (Ctrl+Z вернёт).
export function loadTemplate(id) {
  const before = snapshotIfContent();
  const beforePid = state.pid;
  state.project = buildTemplate(id);
  state.pid = null;
  state.rejected = new Map();
  state.selection = null;
  refreshDerived();
  applyModeRotation();
  if (before) pushHistory(before, beforePid);
  refs.projectName.value = state.project.name;
  afterChange();
  fitView();
}

export function loadSample() {
  const before = snapshotIfContent();
  const beforePid = state.pid;
  const { project, rejected } = buildSample();
  state.project = project;
  state.pid = null;
  state.rejected = rejected;
  state.selection = null;
  refreshDerived();
  applyModeRotation();
  if (before) pushHistory(before, beforePid);
  refs.projectName.value = project.name;
  afterChange();
  fitView();
}

export function newProject() {
  const before = snapshotIfContent();
  const beforePid = state.pid;
  state.pid = null;
  state.project = createProject(); // чистый участок: без топосъёмки, границы, соседей
  state.selection = null;
  state.tool = null;
  state.rejected.clear();
  state.underlayImg = null; // убрать картинку топосъёмки из прошлого проекта
  state.modeName = 'plan';
  state.views = {
    plan: { scale: 0.08, panX: 120, panY: 120 },
    site: { scale: 0.03, panX: 120, panY: 120 },
    landscape: { scale: 0.03, panX: 120, panY: 120 },
  };
  document.body.classList.remove('mode-landscape');
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
  if (before) pushHistory(before, beforePid);
  refs.projectName.value = state.project.name;
  afterChange();
  fitView();
}
