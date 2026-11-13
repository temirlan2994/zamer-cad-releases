// Виды проекта, как диспетчер проекта Revit.
// Вкладка «Виды» правой панели — дерево видов: «Планы этажей» (по виду на
// этаж), «Участок», «Ландшафт», «3D», «Разрезы» (разрезы по линии на плане
// этажа — ui/plan-section.js, окно ui/elevation-view.js; под подзаголовком
// «Разрезы участка» — разрезы из «Ландшафта»), «Фасады» (Север, Юг, Запад,
// Восток — ui/elevation-view.js).
// Клик (и двойной клик) открывает вид; активный подсвечен.
// Настройки активного вида — во вкладке «Свойства», когда ничего не выбрано
// (ui/props.js): поворот вида (те же команды, что и панель ⟲ на колонке
// инструментов — ui/view-align.js), подложка-съёмка, наружные размеры,
// ландшафт под домом (ui/plan-landscape.js), 3D. Только вид: данные проекта
// меняет лишь «Оси дома по виду» и размеры (как кнопка «Размеры» на колонке).

import { sortedLevels } from '../core/model.js';
import {
  ROOF_PLAN_VIEW, VIEW_SCALES, facadeViews, sectionViews, userSheets, viewById, viewPlacement, viewScale,
} from '../core/views.js';
import { setRoofPlanOpener } from './plan-roofs.js';
import { setRoofPlan } from './roof-plan.js';
import { customViewAngle, isPlanEmpty, viewAngle } from '../core/view-angles.js';
import { el, escapeHtml } from './dom.js';
import {
  closeElevation, elevationView, isElevationOpen, openElevation, openElevationId, setElevationMarks, setElevationScale,
} from './elevation-view.js';
import { flipSectionView } from './plan-section.js';
import { landscapeSections, openSection, closeSection, openSectionId } from './landscape-section.js';
import { switchLevel } from './levels.js';
import { closeSheets, isPhone } from './mobile.js';
import { setEditorMode } from './modes.js';
import {
  PLAN_LS_GROUPS, planLandscapePref, planOnlyPref, setPlanLandscapePref,
} from './plan-landscape.js';
import { planMassPref, setPlanMassPref } from './plan-masses.js';
import { planRoofPref, setPlanRoofPref } from './render-roofs.js';
import { bindGridViewBlock, gridViewBlock } from './grids.js';
import { bindErgoViewBlock, ergoViewBlock } from './ergonomics.js';
import {
  VIEW_MIME, addUserSheet, closeSheet, isSheetOpen, notifyViewChange, openSheet, placeViewOnSheet, setViewOpener,
} from './sheet-view.js';
import { state } from './state.js';
import { requestDraw } from './view.js';
import { close3d, is3dOpen, open3d } from './view3d.js';
import { applyViewAngle, axesToViewCmd, resetViewAngleCmd, startAlignView } from './view-align.js';

const MODE_TITLES = { plan: '«План»', site: '«Участок»', landscape: '«Ландшафт»' };
const fmtAngle = (deg) => String(Math.round(deg * 10) / 10);
const openGroups = { plans: true, roof: true, site: true, landscape: true, '3d': true, sections: true, facades: true };

const sectionName = (sec) => `Разрез ${sec.name}–${sec.name}`;
// Вид в окне фасада: фасад ('elev-N'…) или разрез по линии на плане.
const isWindowView = (id) => id.startsWith('elev-') || sectionViews(state.project).some((v) => v.id === id);

// Идентификатор активного вида: 'plan:<этаж>' | 'site' | 'landscape' |
// 'section:<id>' | '3d' | 'elev-N'…; открытый лист — null (активен лист, не вид).
export function activeViewId() {
  if (isSheetOpen()) return null;
  if (isElevationOpen()) return openElevationId();
  if (is3dOpen()) return '3d';
  const mode = state.modeName || 'plan';
  if (mode === 'plan') return state.roofPlan ? ROOF_PLAN_VIEW : `plan:${state.project.activeLevel}`;
  if (mode === 'landscape' && openSectionId()) return `section:${openSectionId()}`;
  return mode;
}

// Название активного вида — для заголовка «Вид: …» в «Свойствах».
export function activeViewTitle() {
  const id = activeViewId() || `plan:${state.project.activeLevel}`;
  if (id === '3d') return '3D';
  if (id === ROOF_PLAN_VIEW) return 'План крыши';
  if (isWindowView(id)) return elevationView(id)?.name || 'Фасад';
  if (id === 'site') return 'Участок';
  if (id === 'landscape') return 'Ландшафт';
  if (id.startsWith('section:')) {
    const sec = landscapeSections().find((s) => s.id === id.slice(8));
    return sec ? sectionName(sec) : 'Разрез';
  }
  const level = state.project.levels.find((l) => l.id === id.slice(5));
  return level?.name || 'План этажа';
}

// Открыть вид из дерева: этаж и режим «План», «Участок», «Ландшафт», разрез, 3D.
export function openView(id) {
  if (isPhone()) closeSheets(); // телефон: нижний лист уезжает, вид — во весь холст
  closeSheet();
  state.sheetSel = null;
  state.sheetReturn = null; // двойной клик на листе (ui/sheet-view.js) вернёт его сам
  if (isWindowView(id)) {
    if (is3dOpen()) close3d();
    openElevation(id);
    return;
  }
  closeElevation();
  if (id === '3d') {
    if (!is3dOpen()) open3d();
    notifyViewChange();
    return;
  }
  if (is3dOpen()) close3d();
  if (id === ROOF_PLAN_VIEW) {
    setEditorMode('plan');
    setRoofPlan(true);
  } else if (id.startsWith('plan:')) {
    setEditorMode('plan');
    setRoofPlan(false);
    switchLevel(id.slice(5));
  } else if (id === 'site') {
    setEditorMode('site');
  } else if (id === 'landscape') {
    setEditorMode('landscape');
    if (openSectionId()) closeSection();
  } else if (id.startsWith('section:')) {
    setEditorMode('landscape');
    openSection(id.slice(8));
  }
  notifyViewChange();
}

setViewOpener(openView); // двойной клик по виду на листе
setRoofPlanOpener(() => { if (activeViewId() !== ROOF_PLAN_VIEW) openView(ROOF_PLAN_VIEW); });

// ------------------------------------------------------------ дерево видов

// Вид можно перетащить на открытый лист (ui/sheet-view.js); вид, уже
// размещённый на листе, помечен «Л<лист>-<номер вида>».
function treeItem(id, name, active, extra = '', drag = true) {
  const placed = viewPlacement(state.project, id);
  const mark = placed ? `<small class="vt-sheet" title="${escapeHtml(placed.text)}">${escapeHtml(placed.mark)}</small>` : '';
  return `<li role="none"><button type="button" role="treeitem" class="vt-item${active === id ? ' active' : ''}" data-view="${escapeHtml(id)}" draggable="${drag}"
    aria-selected="${active === id}"${active === id ? ' aria-current="page"' : ''}>${extra}<span class="vt-name">${escapeHtml(name)}</span>${mark}</button></li>`;
}

function treeGroup(key, title, items, empty, count = false) {
  return `<details class="vt-group" data-vt-group="${key}"${openGroups[key] ? ' open' : ''}>
    <summary class="vt-head">${escapeHtml(title)}${count && items.length ? ` <small>${items.length}</small>` : ''}</summary>
    ${items.length ? `<ul class="vt-list" role="group">${items.join('')}</ul>` : `<p class="vt-empty hint">${escapeHtml(empty)}</p>`}
  </details>`;
}

export function renderViewsPanel(panel) {
  const project = state.project;
  const active = activeViewId();
  const levels = sortedLevels(project);
  const sections = landscapeSections();
  const planSecs = sectionViews(project);
  const secItems = [
    ...planSecs.map((v) => treeItem(v.id, v.name, active)),
    ...(sections.length ? [`<li role="none" class="vt-sub">Разрезы участка</li>`] : []),
    ...sections.map((s) => treeItem(`section:${s.id}`, sectionName(s), active)),
  ];
  panel.innerHTML = `
    <h2>Виды</h2>
    <p class="subtitle">Виды проекта, как в диспетчере Revit: клик — открыть. Настройки вида — во вкладке «Свойства».</p>
    <div class="view-tree" id="viewTree" role="tree" aria-label="Виды проекта">
      ${treeGroup('plans', 'Планы этажей', levels.map((l) => treeItem(`plan:${l.id}`, l.name, active)), 'Этажей нет', true)}
      ${treeGroup('roof', 'Кровля', [treeItem(ROOF_PLAN_VIEW, 'План крыши', active, '', false)])}
      ${treeGroup('site', 'Участок', [treeItem('site', 'Участок', active)])}
      ${treeGroup('landscape', 'Ландшафт', [treeItem('landscape', 'Ландшафт', active)])}
      ${treeGroup('3d', '3D', [treeItem('3d', '3D-вид', active)])}
      ${treeGroup('sections', 'Разрезы', secItems,
    'Разрезов нет: инструмент «Разрез» (S) на плане этажа; разрезы участка — в режиме «Ландшафт».')}
      ${treeGroup('facades', 'Фасады', facadeViews(project).map((v) => treeItem(v.id, v.name, active)), 'Фасадов нет')}
    </div>`;
  panel.querySelectorAll('[data-vt-group]').forEach((d) => d.addEventListener('toggle', () => { openGroups[d.dataset.vtGroup] = d.open; }));
  panel.querySelectorAll('[data-view]').forEach((b) => {
    b.addEventListener('click', () => { if (b.dataset.view !== activeViewId()) openView(b.dataset.view); });
    b.addEventListener('dblclick', () => { if (b.dataset.view !== activeViewId()) openView(b.dataset.view); });
    b.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData(VIEW_MIME, b.dataset.view);
      e.dataTransfer.setData('text/plain', b.dataset.view);
      e.dataTransfer.effectAllowed = 'copy';
      b.classList.add('dragging');
    });
    b.addEventListener('dragend', () => b.classList.remove('dragging'));
  });
}

// ------------------------------------------------------------ вид на лист

// «На лист…» (касание и мышь): лист, на котором вид уже стоит, или выбор
// листа пользователя / новый лист.
function placeBlockHtml(viewId) {
  if (!viewId || viewId === ROOF_PLAN_VIEW || !viewById(state.project, viewId)) return '';
  const where = viewPlacement(state.project, viewId);
  if (where) {
    const placed = where.sheet;
    return `
    <h3>Лист</h3>
    <div class="prop-block" id="viewPlace">
      <div class="prop-row" id="viewPlacedNo"><span>Размещён</span><strong>${escapeHtml(where.text)}</strong></div>
      <p class="hint" id="viewPlacedOn">Вид ${escapeHtml(where.no)} на листе ${escapeHtml(placed.no)} — ${escapeHtml(placed.name)}.</p>
      <button type="button" id="viewPlaceOpen" data-place-open="${escapeHtml(placed.id)}">${state.sheetReturn === `user:${placed.id}` ? '↩ Назад к листу' : 'Открыть лист'} ${escapeHtml(placed.no)}</button>
    </div>`;
  }
  const sheets = userSheets(state.project);
  return `
    <h3>Лист</h3>
    <div class="prop-block" id="viewPlace">
      <button type="button" id="viewPlaceBtn" aria-expanded="false">На лист…</button>
      <div class="view-place-menu" id="viewPlaceMenu" hidden>
        ${sheets.map((s) => `<button type="button" data-place-sheet="${escapeHtml(s.id)}">Лист ${escapeHtml(s.no)} — ${escapeHtml(s.name)}</button>`).join('')}
        <button type="button" data-place-sheet="" id="viewPlaceNew">+ Новый лист</button>
      </div>
      <p class="hint">Или перетащите вид из вкладки «Виды» на открытый лист.</p>
    </div>`;
}

function bindPlaceBlock(panel, viewId) {
  const btn = panel.querySelector('#viewPlaceBtn');
  const menu = panel.querySelector('#viewPlaceMenu');
  btn?.addEventListener('click', () => {
    menu.hidden = !menu.hidden;
    btn.setAttribute('aria-expanded', String(!menu.hidden));
  });
  panel.querySelectorAll('[data-place-sheet]').forEach((b) => b.addEventListener('click', () => {
    const sheetId = b.dataset.placeSheet || addUserSheet().id;
    if (placeViewOnSheet(sheetId, viewId)) openSheet(`user:${sheetId}`);
  }));
  panel.querySelector('[data-place-open]')?.addEventListener('click', (e) => openSheet(`user:${e.currentTarget.dataset.placeOpen}`));
}

// ------------------------------------------------------------ настройки вида

function landscapeBlock() {
  const pref = planLandscapePref();
  const count = state.project.site?.landscape?.objects?.length || 0;
  return `
    <h3>Ландшафт на плане</h3>
    <div class="prop-block views-ls" id="viewsLandscape">
      <label class="check-row"><input type="checkbox" id="viewsLsOn" ${pref.on ? 'checked' : ''}><span>Показывать ландшафт на плане</span><em>${count}</em></label>
      <div class="views-ls-groups${pref.on ? '' : ' off'}">
        ${PLAN_LS_GROUPS.map((g) => `<label class="check-row"><input type="checkbox" data-plan-ls="${g.id}" ${pref[g.id] ? 'checked' : ''} ${pref.on ? '' : 'disabled'}><span>${escapeHtml(g.title)}</span></label>`).join('')}
      </div>
      <button type="button" id="viewsLsPlanOnly">Только планировки</button>
      <p class="hint">Ландшафт — приглушённо под домом, чтобы видеть, куда чертить. На плане он не выбирается; правка — в режиме «Ландшафт». На листы и экспорт не влияет.</p>
    </div>`;
}

// Эскиз масс (ui/plan-masses.js) — только когда в проекте есть массы.
function massBlock() {
  const count = state.project.masses?.length || 0;
  if (!count) return '';
  const pref = planMassPref();
  return `
    <h3>Эскиз масс</h3>
    <div class="prop-block" id="viewsMasses">
      <label class="check-row"><input type="checkbox" id="viewsMassOn" ${pref.on ? 'checked' : ''}><span>Показывать эскиз масс на плане</span><em>${count}</em></label>
      <label class="check-row"><input type="checkbox" id="viewsMassOutline" ${pref.outlineOnly ? 'checked' : ''} ${pref.on ? '' : 'disabled'}><span>Только контур</span></label>
      <p class="hint">Сечение масс на высоте окна этажа (1650 мм над полом) — под комнатами и стенами; комнаты и стены липнут к его рёбрам. На плане не выбирается, на листы и экспорт не влияет.</p>
    </div>`;
}

// Контур кровли (ui/render-roofs.js) — только когда в проекте есть крыши-плиты.
function roofBlock() {
  const count = state.project.roofs?.length || 0;
  if (!count) return '';
  const pref = planRoofPref();
  return `
    <h3>Крыши</h3>
    <div class="prop-block" id="viewsRoofs">
      ${state.roofPlan ? '' : '<button type="button" id="viewsRoofPlanBtn">Открыть «План крыши»</button>'}
      <label class="check-row"><input type="checkbox" id="viewsRoofOn" ${pref.on ? 'checked' : ''}><span>Показывать контур кровли на плане этажа</span><em>${count}</em></label>
      <label class="check-row"><input type="checkbox" id="viewsRoofPrint" ${pref.print ? 'checked' : ''}><span>Контур кровли на листах</span></label>
      <p class="hint">Крыши чертятся и правятся на «Плане крыши» (дерево «Виды» → «Кровля», K). На плане этажа — только бледный штрих по этой настройке, клики он не ловит.</p>
    </div>`;
}

// Настройки активного вида (разметка). У 3D — свои настройки над видом.
export function viewSettingsHtml() {
  const project = state.project;
  if (isElevationOpen()) {
    const view = elevationView();
    const scale = viewScale(view);
    const sec = view?.kind === 'section';
    return `
    <div class="prop-block" id="viewsSettings">
      ${sec ? '<button type="button" id="elevFlipBtn" title="Смотреть в другую сторону от линии; Ctrl+Z — вернуть">⇄ Развернуть</button>' : ''}
      <div class="prop-row"><span>Масштаб</span><strong id="elevScaleVal">1:${scale}</strong></div>
      <div class="elev-scale" id="elevScale" role="radiogroup" aria-label="Масштаб фасада">
        ${VIEW_SCALES.map((s) => `<button type="button" role="radio" data-elev-scale="${s}" aria-checked="${s === scale}"${s === scale ? ' class="active"' : ''}>1:${s}</button>`).join('')}
      </div>
      <label class="check-row"><input type="checkbox" id="elevMarks" ${view?.marks !== false ? 'checked' : ''}><span>Отметки уровней</span></label>
      <p class="hint">Только просмотр: колесо — масштаб, тяните — сдвиг. ${sec ? 'Линия, глубина и название — выберите линию разреза на плане.' : 'Сторона — по северу участка и повороту дома.'}</p>
      <button type="button" id="elevCloseBtn">✕ Закрыть вид</button>
    </div>${placeBlockHtml(openElevationId())}`;
  }
  if (is3dOpen()) {
    return `
    <div class="prop-block" id="viewsSettings">
      <p class="hint">Слои, рельеф и «Вписать» — на панели над 3D-видом.</p>
      <button type="button" id="views3dBtn">Закрыть 3D-вид</button>
    </div>${placeBlockHtml('3d')}`;
  }
  const mode = state.modeName || 'plan';
  const custom = customViewAngle(project, mode);
  const outer = project.settings?.dimOuter !== false;
  return `
    <div id="viewsSettings">
    <h3>Поворот вида ${MODE_TITLES[mode] || ''}</h3>
    <div class="prop-block" id="viewsRotation">
      <button type="button" id="viewsAlignBtn"${state.tool?.kind === 'align-view' ? ' class="armed"' : ''}>⟲ Выровнять вид по двум точкам</button>
      <label class="prop-field"><span>Поворот вида, ° (по часовой)</span>
        <input id="viewsAngleInput" type="number" step="0.5" inputmode="decimal" value="${fmtAngle(viewAngle(project, mode))}"></label>
      <div class="prop-grid">
        <button type="button" id="viewsAngleReset" ${custom == null ? 'disabled' : ''}>Сбросить</button>
        <button type="button" id="viewsAxesBtn" ${isPlanEmpty(project) ? 'disabled' : ''} title="Повернуть оси дома (данные) по экрану этого вида; Ctrl+Z — вернуть">Оси дома по виду</button>
      </div>
      <p class="hint">У «Плана», «Участка» и «Ландшафта» — свой угол; данные проекта не меняются.</p>
    </div>
    <h3>Отображение</h3>
    <div class="prop-block">
      ${project.site?.underlay ? `<label class="check-row"><input type="checkbox" id="viewsUnderlay" ${state.underlayHidden ? '' : 'checked'}><span>Подложка (съёмка)</span></label>` : ''}
      <label class="check-row"><input type="checkbox" id="viewsDimOuter" ${outer ? 'checked' : ''}><span>Наружные размеры — по внешней грани стен</span></label>
      <button type="button" id="views3dBtn">Открыть 3D-вид</button>
    </div>
    ${mode === 'plan' ? gridViewBlock() : ''}
    ${mode === 'plan' ? ergoViewBlock() : ''}
    ${mode === 'plan' ? massBlock() : ''}
    ${mode === 'plan' ? roofBlock() : ''}
    ${mode === 'plan' ? landscapeBlock() : ''}
    ${placeBlockHtml(activeViewId() || (mode === 'plan' ? `plan:${project.activeLevel}` : mode))}
    </div>`;
}

// Поворот вида поменялся снаружи (панель ⟲, выравнивание по точкам).
export function refreshViewsPanel() {
  if (!state.project) return;
  const mode = state.modeName || 'plan';
  // Узлы — из «Свойств» (их нет в index.html, панель рисуется кодом).
  const $ = (sel) => document.querySelector(`#propsBody ${sel}`);
  const input = $('#viewsAngleInput');
  if (input && document.activeElement !== input) input.value = fmtAngle(viewAngle(state.project, mode));
  const reset = $('#viewsAngleReset');
  if (reset) reset.disabled = customViewAngle(state.project, mode) == null;
  $('#viewsAlignBtn')?.classList.toggle('armed', state.tool?.kind === 'align-view');
}

// rerender — перерисовать панель целиком (после смены угла, флажков ландшафта).
export function bindViewSettings(panel, rerender) {
  bindPlaceBlock(panel, activeViewId());
  bindGridViewBlock(panel, rerender);
  bindErgoViewBlock(panel, rerender);
  panel.querySelectorAll('[data-elev-scale]').forEach((b) => b.addEventListener('click', () => {
    setElevationScale(Number(b.dataset.elevScale));
    rerender();
  }));
  panel.querySelector('#elevMarks')?.addEventListener('change', (e) => { setElevationMarks(e.target.checked); rerender(); });
  panel.querySelector('#elevCloseBtn')?.addEventListener('click', () => closeElevation());
  panel.querySelector('#elevFlipBtn')?.addEventListener('click', () => { flipSectionView(openElevationId()); rerender(); });
  panel.querySelector('#viewsAlignBtn')?.addEventListener('click', () => { startAlignView(); refreshViewsPanel(); });
  panel.querySelector('#viewsAngleInput')?.addEventListener('change', (e) => {
    const v = Number(String(e.target.value).replace(',', '.'));
    if (Number.isFinite(v)) applyViewAngle(v);
    rerender();
  });
  panel.querySelector('#viewsAngleReset')?.addEventListener('click', () => { resetViewAngleCmd(); rerender(); });
  panel.querySelector('#viewsAxesBtn')?.addEventListener('click', () => { axesToViewCmd(); rerender(); });
  panel.querySelector('#viewsUnderlay')?.addEventListener('change', (e) => {
    state.underlayHidden = !e.target.checked;
    requestDraw();
  });
  // Как кнопка «Размеры» на колонке инструментов — тот же обработчик.
  panel.querySelector('#viewsDimOuter')?.addEventListener('change', (e) => {
    const outer = state.project.settings?.dimOuter !== false;
    if (outer !== e.target.checked) el('dimModeBtn')?.click();
  });
  panel.querySelector('#views3dBtn')?.addEventListener('click', () => openView(is3dOpen() ? activeBaseView() : '3d'));
  panel.querySelector('#viewsLsOn')?.addEventListener('change', (e) => {
    const pref = planLandscapePref();
    // Включили после «Только планировки» — вернуть группы по умолчанию.
    const empty = PLAN_LS_GROUPS.every((g) => !pref[g.id]);
    setPlanLandscapePref(e.target.checked && empty
      ? { on: true, plants: true, covers: true, objects: true }
      : { on: e.target.checked });
    requestDraw();
    rerender();
  });
  panel.querySelector('#viewsMassOn')?.addEventListener('change', (e) => { setPlanMassPref({ on: e.target.checked }); requestDraw(); rerender(); });
  panel.querySelector('#viewsRoofPlanBtn')?.addEventListener('click', () => openView(ROOF_PLAN_VIEW));
  panel.querySelector('#viewsRoofOn')?.addEventListener('change', (e) => { setPlanRoofPref({ on: e.target.checked }); requestDraw(); });
  panel.querySelector('#viewsRoofPrint')?.addEventListener('change', (e) => { setPlanRoofPref({ print: e.target.checked }); requestDraw(); });
  panel.querySelector('#viewsMassOutline')?.addEventListener('change', (e) => { setPlanMassPref({ outlineOnly: e.target.checked }); requestDraw(); });
  panel.querySelectorAll('[data-plan-ls]').forEach((box) => box.addEventListener('change', () => {
    setPlanLandscapePref({ [box.dataset.planLs]: box.checked });
    requestDraw();
  }));
  panel.querySelector('#viewsLsPlanOnly')?.addEventListener('click', () => {
    planOnlyPref();
    requestDraw();
    rerender();
  });
}

// Вид под 3D (режим редактора): куда вернуться, закрыв 3D.
function activeBaseView() {
  const mode = state.modeName || 'plan';
  return mode === 'plan' ? `plan:${state.project.activeLevel}` : mode;
}
