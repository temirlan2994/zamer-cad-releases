// Проект как файл: новый, пример, открыть, сохранить, экспорт.

import { buildProjectDxf, buildSitePlanDxf, buildStructuredExport } from '../core/export.js';
import { buildIfc } from '../core/ifc.js';
import { buildLandscapeCsv } from '../core/landscape-report.js';
import { autoNumberGrids } from '../core/grid-axes.js';
import { createProject, levelProject, serializeProject } from '../core/model.js';
import { reconcileEats } from '../core/v7/eat-bridge.js';
import { buildRoomScheduleCsv } from '../core/schedule.js';
import { buildTemplate } from '../core/templates.js';
import { getBackend, saveFile, saveZip } from './cloud.js';
import { refs, toast } from './dom.js';
import { applyLibraryTab } from './library.js';
import { applyModeRotation } from './modes.js';
import { planGridPref } from './plan-grids.js';
import { fileWithProjectHistory, importProjectHistory } from './project-history.js';
import { safeProjectFileName, syncProjectNameUi } from './project-name.js';
import { exportSolarReport, openSolarReport } from './solar-report-ui.js';
import { buildSample } from './sample.js';
import { buildCurrentSheetPng, buildSheetsPdf } from './sheet.js';
import { state } from './state.js';
import { GUEST_STORAGE_SCOPE, getStorageScope } from './storage-scope.js';
import {
  afterChange, flushAutosave, pushHistory, refreshDerived, restoreFrom, snapshotIfContent,
} from './store.js';
import { fitView } from './view.js';

const download = (filename, data, mime) => saveFile(filename, data, mime);
export const PROJECT_REPLACED_EVENT = 'kepler:project-replaced';
let fileRequest = 0;

function announceProjectReplaced(previousPid, previousText = null) {
  document.dispatchEvent(new CustomEvent(PROJECT_REPLACED_EVENT, {
    detail: { previousPid: previousPid || null, previousText, pid: state.pid || null },
  }));
}

export function safeFileName() {
  return safeProjectFileName();
}

async function portableProject(project, pid) {
  const context = { pid, fileId: project.fileHistoryId, scope: getStorageScope() };
  const text = serializeProject(project, { pretty: false });
  const target = pid ? await getBackend() : null;
  const targetScope = target?.mode === 'cloud' ? target.uid : GUEST_STORAGE_SCOPE;
  const result = await fileWithProjectHistory(text, context, targetScope === context.scope ? target : null);
  if (pid && targetScope !== context.scope) result.partial = true;
  return result;
}

function historyDownloadWarning({ partial }) {
  if (partial) toast('Файл сохранён. Часть истории недоступна или превышает лимит файла (50 МиБ).', true);
}

export function handleExport(kind) {
  refs.exportDropdown.hidden = true;
  document.getElementById('exportBtn').setAttribute('aria-expanded', 'false');
  if (kind === 'project') {
    const filename = `${safeFileName()}.kepler.json`;
    if (state.pid || state.project.fileHistoryId) toast('Собираем файл проекта с историей…');
    return portableProject(state.project, state.pid).then(async (result) => {
      if (!await download(filename, result.text, 'application/json')) return;
      if (result.partial) historyDownloadWarning(result);
      else toast(result.count ? `Файл проекта сохранён с историей · версий: ${result.count}` : 'Файл проекта сохраняется (.kepler.json)');
    }).catch((error) => toast(`Не удалось скачать файл: ${error.message}`, true));
  } else if (kind === 'json') {
    download(`${safeFileName()}.export.json`, JSON.stringify(buildStructuredExport(state.project), null, 2), 'application/json');
    toast('Структурированный JSON для Revit-плагина');
  } else if (kind === 'dxf') {
    download(`${safeFileName()}.dxf`, buildProjectDxf(state.project), 'application/dxf');
    toast('DXF сохраняется');
  } else if (kind === 'sheet-pdf') {
    const name = safeFileName();
    buildSheetsPdf(state.project).then((pdf) => {
      if (!pdf) { toast('Нечего печатать: добавьте комнаты или границу участка', true); return; }
      download(`${name}-листы.pdf`, pdf, 'application/pdf');
      toast('PDF всего альбома готов');
    });
  } else if (kind === 'sheet-png') {
    const png = buildCurrentSheetPng(state.project, state.modeName === 'landscape' ? 'site' : state.modeName, {
      sheetId: state.sheetOpen,
      sectionId: state.modeName === 'landscape' ? state.lsSectionId : null,
    });
    if (!png) { toast(state.modeName !== 'plan' ? 'Для генплана нужна граница участка' : 'На этом этаже нет комнат', true); return; }
    png.then((blob) => download(`${safeFileName()}-лист.png`, blob, 'image/png'));
    toast('Подготовка листа PNG');
  } else if (kind === 'schedule-csv') {
    download(`${safeFileName()}-экспликация.csv`, buildRoomScheduleCsv(state.project), 'text/csv;charset=utf-8');
    toast('Экспликация помещений (CSV) — откроется в Excel');
  } else if (kind === 'solar-report') {
    openSolarReport();
  } else if (kind === 'solar-report-csv') {
    exportSolarReport('csv');
  } else if (kind === 'solar-report-json') {
    exportSolarReport('json');
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
    const project = state.project;
    const { text } = buildIfc(project);
    const name = safeFileName();
    return portableProject(project, state.pid).then(async (result) => {
      const saved = await saveZip(`${name}.zip`, [
        { name: `${name}.kepler.json`, data: result.text },
        { name: `${name}.dxf`, data: buildProjectDxf(project) },
        { name: `${name}-revit.dxf`, data: buildProjectDxf(project, { profile: 'revit' }) },
        { name: `${name}.ifc`, data: text },
        { name: `${name}-экспликация.csv`, data: buildRoomScheduleCsv(project) },
        ...(project.site?.landscape?.objects?.length ? [{ name: `${name}-ландшафт.csv`, data: buildLandscapeCsv(project) }] : []),
      ]);
      if (!saved) return;
      if (result.partial) historyDownloadWarning(result);
      else toast('Архив: проект, DXF, DXF для Revit, IFC, экспликация');
    }).catch((error) => toast(`Не удалось скачать архив: ${error.message}`, true));
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
  const request = ++fileRequest;
  const previous = state.project;
  const reader = new FileReader();
  reader.onload = async () => {
    try {
      if (request !== fileRequest || state.project !== previous) return;
      const raw = JSON.parse(String(reader.result));
      let projectData = raw;
      let historyError = null;
      if (raw?.projectHistory || raw?.fileHistoryId) {
        try {
          projectData = await importProjectHistory(raw, getStorageScope());
        } catch (error) {
          const { projectHistory: _history, fileHistoryId: _id, ...project } = raw;
          projectData = project;
          historyError = error;
        }
      }
      if (request !== fileRequest || state.project !== previous) return;
      const before = snapshotIfContent();
      const beforePid = state.pid;
      const previousText = before ? serializeProject(state.project, { pretty: false }) : null;
      flushAutosave({ cloudImmediate: true });
      restoreFrom(projectData);
      // Оси из файла — по порядку (автонумерация; ручные марки сохраняются).
      if (planGridPref().auto && state.project.grids?.length) state.project.grids = autoNumberGrids(state.project.grids);
      state.pid = null;
      announceProjectReplaced(beforePid, previousText);
      if (before) pushHistory(before, beforePid);
      fitView();
      syncProjectNameUi();
      if (historyError) toast(`Проект открыт. История осталась в файле: ${historyError.message}`, true);
      else toast(`Открыт проект «${state.project.name}»`);
    } catch (error) {
      if (request === fileRequest) toast(`Не удалось открыть: ${error.message}`, true);
    }
  };
  reader.onerror = () => { if (request === fileRequest) toast('Не удалось прочитать файл проекта', true); };
  reader.readAsText(file);
}

// Шаблон дома (core/templates.js) — как пример: текущий проект уходит в
// историю (Ctrl+Z вернёт).
export function loadTemplate(id) {
  const before = snapshotIfContent();
  const beforePid = state.pid;
  const previousText = before ? serializeProject(state.project, { pretty: false }) : null;
  flushAutosave({ cloudImmediate: true });
  state.project = buildTemplate(id);
  // Шаблон — как любая правка: съедание по номиналам (core/v7/eat-bridge.js).
  for (const l of state.project.levels || []) reconcileEats(levelProject(state.project, l.id));
  state.pid = null;
  announceProjectReplaced(beforePid, previousText);
  state.rejected = new Map();
  state.selection = null;
  refreshDerived();
  applyModeRotation();
  if (before) pushHistory(before, beforePid);
  afterChange();
  fitView();
}

export function loadSample() {
  const before = snapshotIfContent();
  const beforePid = state.pid;
  const previousText = before ? serializeProject(state.project, { pretty: false }) : null;
  flushAutosave({ cloudImmediate: true });
  const { project, rejected } = buildSample();
  state.project = project;
  state.pid = null;
  announceProjectReplaced(beforePid, previousText);
  state.rejected = rejected;
  state.selection = null;
  refreshDerived();
  applyModeRotation();
  if (before) pushHistory(before, beforePid);
  afterChange();
  fitView();
}

export function newProject() {
  const before = snapshotIfContent();
  const beforePid = state.pid;
  const previousText = before ? serializeProject(state.project, { pretty: false }) : null;
  flushAutosave({ cloudImmediate: true });
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
  state.libraryPinned = false;
  applyLibraryTab();
  refreshDerived();
  applyModeRotation();
  if (before) pushHistory(before, beforePid);
  afterChange();
  announceProjectReplaced(beforePid, previousText);
  fitView();
}
