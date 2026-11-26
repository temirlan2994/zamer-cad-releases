// Правая панель свойств: проект, комната, стена, проём, мебель, группа.

import { elevationView, isElevationOpen, refreshElevationView } from './elevation-view.js';
import { findView } from '../core/views.js';
import { floorAnalyticalViewById } from '../core/analytical-views.js';
import { renderAnalyticalProps } from './props-analytical.js';
import { deriveEntrances } from '../core/entrance.js';
import { renderEntranceProps } from './entrance-props.js';
import { renderEntryToolOptions } from './site-entry-menu.js';
import { renderSectionProps } from './plan-section.js';
import { renderSlabProps } from './slab-ui.js';
import { slabOpenings, stairRiseByLevels, stairTargetLevel } from '../core/slab-openings.js';
import { massById, renderMassProps } from './masses.js';
import { bindRoomRoof, renderRoofProps, visibleRoofById, roomRoofHtml } from './roofs.js';
import { gridById, renderGridProps, renderGridToolOptions } from './grids.js';
import { furnitureDef, isShaft, roomType, roomTypesByCategory } from '../core/catalog.js';
import { itemTitle, itemsInRoom } from '../core/furnish.js';
import {
  activeLevel, roomById, roomCeiling, setLevelTallWindowOffsets,
} from '../core/model.js';
import { MIN_ROOM_SIZE, MIN_SHAFT_SIZE, roomNetAreaM2 } from '../core/rooms.js';
import {
  DOOR_TYPES, WALL_T_MAX, WALL_T_MIN, WINDOW_TYPES, openingFrame, openingPos, openingRect,
  setOpeningPos, wallClassThickness,
} from '../core/walls.js';
import { moveManualWall, setManualWallJustify, setWallHeight } from '../core/wall-manual.js';
import { roomShapeArea } from '../core/room-shape.js';
import { canAttachRoom, planAdjacentRoom } from '../core/adjacent-room.js';
import { clearWindowSpan, levelWindowOpenings, nextWindowSpan, setWindowSpan, windowSpanTop } from '../core/spanning-windows.js';
import { CORNER_PRESET, cornerWindowGeometry } from '../core/corner-windows.js';
import { glazedOpeningMinWidth, isGlazedAssembly, resizeGlazedOpening } from '../core/glazed-openings.js';
import { bindGlazedOpeningFields, glazedElevationMarkup, glazedOpeningFields } from './glazed-opening-props.js';
import { wallZRange } from '../core/wall-z-range.js';
import { fitOpeningOffset } from '../core/opening-spacing.js';
import { setWallDefaults } from '../core/wall-thickness.js';
import { canvas, escapeHtml, refs, toast } from './dom.js';
import { findWall } from './hit.js';
import { addRoomAbove, deleteLevel, switchLevel } from './levels.js';
import { closeSheets, isPhone, syncMobileBar } from './mobile.js';
import { renderTepPanel } from './props-tep.js';
import {
  activeViewTitle, bindViewSettings, openView, renderViewsPanel, viewSettingsHtml,
} from './props-views.js';
import { renderSheetProps, renderSheetsPanel } from './props-sheets.js';
import { refreshSheetView } from './sheet-view.js';
import { renderToolstrip, toolContext } from './toolstrip.js';
import {
  addFurniture, autoDockAfterGesture, changeManualWall, changeWallKind, changeWallThickness, commitPlacedRoom, eatOverlapsAfter, overlappingTopRooms,
  reconcileOpenings,
} from './plan-actions.js';
import {
  bindBuildingRotation, buildingRotationField, renderSiteObjectProps, renderSiteSettings,
} from './props-site.js';
import { resizeVerdict } from './snap.js';
import {
  STAIR_BUILDS, STAIR_ENVIRONMENTS, STAIR_MATERIALS, STAIR_RAILINGS, STAIR_SHAPES, applyStairPreset, stairAppearance, stairBuild, materializeStair, setStairParam, setStairRise, stairCalculation, stairParamKeys, stairParamValue, stairShape,
} from '../core/stairs.js';
import {
  HIGH_WINDOW_TYPES, openingHeight, openingSill, presetWithType,
} from '../core/opening-preset.js';
import { fitView, planToScreen, requestDraw } from './view.js';
import { bindRoomRailings, renderRailingProps, roomRailingsHtml } from './railing-props.js';
import { renderOpeningLibrary } from './opening-library.js';
import { state } from './state.js';
import { isFixedSizeComp } from '../core/composite.js';
import { bindCompositeSection, compositeSection } from './props-composite.js';
import { bindErgoItemSection, ergoItemSection } from './ergonomics.js';
import { afterChange, mutate, pushHistory, refreshDerived, snapshot } from './store.js';
import { liftForEdit, liftRoom, nominalShape, reconcileEats } from '../core/v7/eat-bridge.js';
import { selectObject } from './tools.js';
import { renderLandscapeProps } from './landscape.js';
import { isIssuesOpen, setIssuesOpen } from './issues.js';
import { bindWallPinBlock, wallPinBlock } from './grid-pin-ui.js';
import {
  arrangeRoomsNow, AUTO_LAYOUT_AVAILABLE, autoLayoutHtml, bindAutoLayout,
} from './auto-layout.js';
import {
  bindSolarAnalysisPanel, focusSolarRoom, solarAnalysisHtml,
} from './solar-analysis.js';
import { bindEnvelopeSettings, envelopeSettingsHtml } from './envelope-settings.js';

// Вкладки над панелью (ряд значков), как в Revit: «Свойства» (выбранный
// объект; ничего не выбрано — настройки активного вида или выбранного листа,
// внизу — свёрнутая секция «Проект»), «Виды» (дерево видов,
// ui/props-views.js), «Листы» (список листов, ui/props-sheets.js), «ТЭП»
// (экспликация и показатели, ui/props-tep.js). Выбор нового объекта
// возвращает вкладку «Свойства».
const PROPS_TABS = ['props', 'views', 'sheets', 'tep'];
let lastSelKey = null;
let projectOpen = false; // секция «Проект» раскрыта
let viewOpen = false; // секция «Вид: …» в «Участке»/«Ландшафте» раскрыта

// Вкладки и тело — в разметке (index.html); третья вкладка «⚠ Замечания» —
// ui/issues.js (пока открыта, «Свойства»/«ТЭП» не подсвечены).
function propsBody() {
  const root = refs.props;
  const tabs = root.querySelector(':scope > .props-tabs');
  const body = root.querySelector(':scope > .props-body');
  if (!tabs.dataset.bound) {
    tabs.dataset.bound = '1';
    tabs.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-props-tab]');
      if (!btn) return;
      const wasIssues = isIssuesOpen();
      if (wasIssues) setIssuesOpen(false);
      if (btn.dataset.propsTab === state.propsTab && !wasIssues) return;
      state.propsTab = btn.dataset.propsTab;
      renderProps();
    });
    // Сменился активный вид или лист (дерево видов, 3D, разрез, лист на холсте).
    // Поле, в котором печатают, не перерисовываем. Несколько событий подряд —
    // одна перерисовка, после текущего обработчика (не внутри renderProps).
    let queued = false;
    document.addEventListener('kepler:view', () => {
      if (queued) return;
      queued = true;
      queueMicrotask(() => {
        queued = false;
        const a = document.activeElement;
        const typing = a && body.contains(a) && (/^(SELECT|TEXTAREA)$/.test(a.tagName)
          || (a.tagName === 'INPUT' && !['checkbox', 'radio', 'button'].includes(a.type)));
        if (typing) return;
        renderProps();
      });
    });
  }
  const issues = isIssuesOpen() && Boolean(root.querySelector('#issuesPanel'));
  for (const btn of tabs.querySelectorAll('[data-props-tab]')) {
    const on = !issues && btn.dataset.propsTab === state.propsTab;
    btn.classList.toggle('active', on);
    btn.setAttribute('aria-selected', String(on));
  }
  return body;
}

export function renderProps() {
  syncMobileBar();
  renderToolstrip(); // «Массив», «Выноска» ландшафта зависят от выделения
  const sel = state.selection;
  const selKey = sel ? JSON.stringify(sel) : null;
  if (selKey && selKey !== lastSelKey) {
    state.propsTab = 'props';
    state.sheetSel = state.sheetOpen; // выбран объект — «Свойства» уже не про лист
  }
  lastSelKey = selKey;
  if (!PROPS_TABS.includes(state.propsTab)) state.propsTab = 'props';
  const panel = propsBody();
  refreshSheetView();
  refreshElevationView();
  if (state.propsTab === 'tep') { renderTepPanel(panel); return; }
  if (state.propsTab === 'views') { renderViewsPanel(panel); return; }
  if (state.propsTab === 'sheets') { renderSheetsPanel(panel); return; }
  // Лист открыт или выбран в «Листах» — его настройки.
  if (!sel && (state.sheetOpen || state.sheetSel) && renderSheetProps(panel)) return;
  // Открыт фасад — его настройки (масштаб, отметки).
  if (!sel && isElevationOpen()) { renderElevationProps(panel); return; }
  if (!sel && toolContext() === 'model') { renderProjectProps(panel); return; }
  // Параметры двери/окна до вставки — в строке параметров над холстом (renderToolOptions).
  if ((state.modeName === 'landscape' && !sel) || sel?.type === 'landscape') {
    if (sel || landscapeToolActive()) renderLandscapeProps(panel);
    else withViewSection(panel, renderLandscapeProps);
    return;
  }
  if (!sel) {
    if (state.modeName === 'site') withViewSection(panel, renderSiteSettings);
    else renderProjectProps(panel);
    return;
  }
  if (sel.type === 'room') { renderRoomProps(panel, roomById(state.project, sel.id)); return; }
  if (sel.type === 'wall') { renderWallProps(panel, findWall(sel.key, sel.from)); return; }
  if (sel.type === 'railing' && renderRailingProps(panel)) return;
  if (sel.type === 'entrance') { renderEntranceProps(panel, sel.id); return; }
  if (sel.type === 'opening') { renderOpeningProps(panel, state.project.openings.find((o) => o.id === sel.id)); return; }
  if (sel.type === 'item') { renderItemProps(panel, state.project.items.find((i) => i.id === sel.id)); return; }
  if (sel.type === 'multi') { renderMultiProps(panel, sel); return; }
  if (sel.type === 'site') { renderSiteObjectProps(panel, sel); return; }
  if (sel.type === 'grid') {
    const grid = gridById(sel.id);
    if (grid) { renderGridProps(panel, grid); return; }
  }
  if (sel.type === 'mass') {
    const mass = massById(sel.id);
    if (mass) { renderMassProps(panel, mass); return; }
  }
  if (sel.type === 'roof') {
    const roof = visibleRoofById(sel.id);
    if (roof) { renderRoofProps(panel, roof); return; }
  }
  if (sel.type === 'slab' && renderSlabProps(panel, sel)) return;
  if (sel.type === 'section') {
    const view = findView(state.project, sel.id);
    if (view?.kind === 'section') { renderSectionProps(panel, view); return; }
  }
  renderProjectProps(panel);
}

const landscapeToolActive = () => ['ls-section', 'draw-landscape', 'ls-array', 'ls-flight', 'ls-route'].includes(state.tool?.kind);

// «Участок» и «Ландшафт» без выбора: свои настройки режима, а настройки вида —
// свёрнутой секцией «Вид: …» под ними (раскрыта ли — помнится).
function withViewSection(panel, renderMode) {
  const prev = panel.querySelector(':scope > #viewSection');
  if (prev) viewOpen = prev.open;
  panel.innerHTML = '<div class="mode-props" id="modeProps"></div>';
  renderMode(panel.firstElementChild);
  panel.insertAdjacentHTML('beforeend', `
    <details class="view-section" id="viewSection"${viewOpen ? ' open' : ''}>
      <summary id="viewSummary">Вид: ${escapeHtml(activeViewTitle())} <small>поворот, отображение</small></summary>
      ${viewSettingsHtml()}
    </details>`);
  panel.querySelector('#viewSection').addEventListener('toggle', (e) => { viewOpen = e.target.open; });
  bindViewSettings(panel.querySelector('#viewSection'), renderProps);
}

// Чистая высота по умолчанию: высота этажа минус перекрытие (core/norms.js).
function defaultCeiling() {
  const level = activeLevel(state.project);
  return roomCeiling({}, level);
}

function windowCountLabel(count) {
  const n10 = count % 10; const n100 = count % 100;
  const word = n10 === 1 && n100 !== 11 ? 'окно'
    : n10 >= 2 && n10 <= 4 && (n100 < 12 || n100 > 14) ? 'окна' : 'окон';
  return `${count} ${word}`;
}

function renderElevationProps(panel) {
  panel.innerHTML = `
    <h2 id="viewPropsTitle">Вид: ${escapeHtml(activeViewTitle())}</h2>
    <p class="subtitle">${elevationView()?.kind === 'section' ? 'Разрез' : 'Фасад'} · свойства вида</p>
    ${viewSettingsHtml()}`;
  bindViewSettings(panel, renderProps);
}

function renderProjectProps(panel) {
  const analytical = floorAnalyticalViewById(state.project, state.analyticalView?.id);
  if (analytical) { renderAnalyticalProps(panel, analytical); return; }
  const site = state.project.site;
  const hasSite = Boolean(site?.boundary?.length || site?.underlay);
  const level = activeLevel(state.project);
  const multi = state.project.levels.length > 1;
  // Ничего не выбрано: подсказка, а настройки проекта — свёрнутой секцией
  // «Проект» внизу (раскрыта ли — помнится, пока открыта вкладка).
  const prev = panel.querySelector('#projectSection');
  if (prev) projectOpen = prev.open; // событие toggle приходит позже — читаем сразу
  const phone = isPhone();
  const levelSection = panel.querySelector('#levelSection');
  const keepLevelOpen = levelSection?.open && levelSection.dataset.level === level.id;
  const focusLevelSummary = keepLevelOpen && document.activeElement?.id === 'levelSummary';
  const linkedWindowProbe = { kind: 'window', heightMode: 'level' };
  const tallWindowBottom = openingSill(linkedWindowProbe, level);
  const tallWindowHeight = openingHeight(linkedWindowProbe, level);
  const tallWindowTop = Math.max(0, level.height - tallWindowBottom - tallWindowHeight);
  const linkedWindowCount = (level.openings || []).filter((opening) => (
    opening.kind === 'window' && opening.heightMode === 'level'
  )).length;
  const levelFields = `
    <div class="prop-block">
      <label class="prop-field"><span>Название</span><input id="levelName" value="${escapeHtml(level.name)}"></label>
      <div class="prop-grid">
        <label class="prop-field"><span>Отметка от ±0.000, м</span>
          <input id="levelElev" type="number" step="0.05" value="${(level.elevation / 1000).toFixed(2)}"></label>
        <label class="prop-field"><span>Высота этажа, м</span>
          <input id="levelHeight" type="number" step="0.05" min="2" value="${(level.height / 1000).toFixed(2)}"></label>
      </div>
      <div class="prop-grid">
        <label class="prop-field"><span>Чистая высота, м</span>
          <input value="${(defaultCeiling() / 1000).toFixed(2)}" disabled></label>
        <label class="prop-field"><span>Перекрытие, м</span>
          <input id="slabThickness" type="number" step="0.05" min="0.12" max="0.6" value="${((level.slabThickness || 300) / 1000).toFixed(2)}"></label>
      </div>
      <div class="prop-row"><strong>Окна в пол</strong></div>
      <label class="check-row"><input id="allLevelWindowGaps" type="checkbox" ${state.project.settings.linkTallWindowsAcrossLevels === true ? 'checked' : ''}>
        <span>Общие отступы для всех этажей</span></label>
      <div class="prop-grid">
        <label class="prop-field"><span>Снизу, мм</span>
          <input id="tallWindowBottomGap" type="number" inputmode="numeric" step="10" min="0" value="${Math.round(tallWindowBottom)}"></label>
        <label class="prop-field"><span>Сверху, мм</span>
          <input id="tallWindowTopGap" type="number" inputmode="numeric" step="10" min="0" value="${Math.round(tallWindowTop)}"></label>
      </div>
      <div class="prop-row" id="tallWindowComputedHeight"><span>Общая высота</span><strong>${Math.round(tallWindowHeight)} мм${linkedWindowCount ? ` · ${windowCountLabel(linkedWindowCount)}` : ''}</strong></div>
      ${multi ? '<button id="deleteLevel" class="danger">Удалить этаж</button>' : ''}
    </div>`;
  panel.innerHTML = `
    <h2 id="viewPropsTitle">Вид: ${escapeHtml(activeViewTitle())}</h2>
    ${envelopeSettingsHtml()}
    ${viewSettingsHtml()}
    ${phone ? `<details class="vs-sec" id="levelSection" data-level="${escapeHtml(level.id)}"${keepLevelOpen ? ' open' : ''}>
      <summary id="levelSummary">Параметры этажа</summary>${levelFields}
    </details>` : ''}
    <details class="project-section" id="projectSection"${projectOpen ? ' open' : ''}>
    <summary id="projectSummary">Настройки проекта</summary>
    <div class="prop-block">
      ${hasSite ? buildingRotationField() : ''}
      <label class="prop-field"><span>Размеры на плане</span>
        <select id="unitsSel">
          <option value="mm" ${state.project.settings.units !== 'm' ? 'selected' : ''}>в миллиметрах — 5000</option>
          <option value="m" ${state.project.settings.units === 'm' ? 'selected' : ''}>в метрах — 5,00</option>
        </select></label>
    </div>
    <h3>Стены по умолчанию, мм</h3>
    <div class="prop-block">
      <div class="prop-grid">
        <label class="prop-field"><span>Наружные</span>
          <input id="defExterior" data-wall-default="exterior" type="number" step="10" min="${WALL_T_MIN}" max="${WALL_T_MAX}" value="${wallClassThickness(state.project.settings, 'exterior')}"></label>
        <label class="prop-field"><span>Несущие</span>
          <input id="defBearing" data-wall-default="bearing" type="number" step="10" min="${WALL_T_MIN}" max="${WALL_T_MAX}" value="${wallClassThickness(state.project.settings, 'bearing')}"></label>
        <label class="prop-field"><span>Перегородки</span>
          <input id="defPartition" data-wall-default="partition" type="number" step="10" min="${WALL_T_MIN}" max="${WALL_T_MAX}" value="${wallClassThickness(state.project.settings, 'partition')}"></label>
      </div>
      <p class="empty-hint">Толщина наружных стен обновится сразу. Для перегородок новое значение действует при следующей стыковке.</p>
    </div>
    ${phone ? '' : `<h3>Этаж</h3>${levelFields}`}
    </details>`;
  if (focusLevelSummary) panel.querySelector('#levelSummary')?.focus({ preventScroll: true });
  panel.querySelector('#projectSection').addEventListener('toggle', (e) => { projectOpen = e.target.open; });
  bindViewSettings(panel, renderProps);
  bindEnvelopeSettings(panel);
  bindBuildingRotation(panel);
  panel.querySelector('#unitsSel').addEventListener('change', (e) => {
    mutate(() => { state.project.settings.units = e.target.value === 'm' ? 'm' : 'mm'; });
  });
  panel.querySelectorAll('[data-wall-default]').forEach((input) => {
    input.addEventListener('change', (e) => {
      mutate(() => { setWallDefaults(state.project, { [input.dataset.wallDefault]: e.target.value }); });
    });
  });
  panel.querySelector('#levelName').addEventListener('change', (e) => {
    const name = e.target.value.trim();
    if (name) mutate(() => { level.name = name; });
  });
  panel.querySelector('#levelElev').addEventListener('change', (e) => {
    mutate(() => { level.elevation = Math.round((Number(e.target.value) || 0) * 1000); });
  });
  panel.querySelector('#levelHeight').addEventListener('change', (e) => {
    mutate(() => {
      level.height = Math.max(2000, Math.round((Number(e.target.value) || 3) * 1000));
      setLevelTallWindowOffsets(level, {
        bottom: level.tallWindowBottomOffset,
        top: level.tallWindowTopOffset,
      });
    });
  });
  panel.querySelector('#slabThickness').addEventListener('change', (e) => {
    const next = Math.round((Number(e.target.value) || 0.3) * 1000);
    mutate(() => { level.slabThickness = Math.min(600, Math.max(120, next)); });
  });
  const updateGaps = (values) => {
    const gaps = setLevelTallWindowOffsets(level, values);
    if (state.project.settings.linkTallWindowsAcrossLevels === true) {
      for (const floor of state.project.levels) setLevelTallWindowOffsets(floor, gaps);
    }
  };
  panel.querySelector('#allLevelWindowGaps').addEventListener('change', (e) => {
    mutate(() => {
      state.project.settings.linkTallWindowsAcrossLevels = e.target.checked;
      if (e.target.checked) updateGaps({ top: tallWindowTop, bottom: tallWindowBottom });
    });
  });
  for (const [id, key] of [['tallWindowBottomGap', 'bottom'], ['tallWindowTopGap', 'top']]) {
    panel.querySelector(`#${id}`).addEventListener('change', (e) => {
      mutate(() => updateGaps({ [key]: Math.max(0, Math.round(Number(e.target.value) || 0)) }));
    });
  }
  panel.querySelector('#deleteLevel')?.addEventListener('click', () => deleteLevel(level.id));
}

// Тип помещения — список по категориям (optgroup). Шахта — вертикальный
// проём, а не помещение: в шахту и из шахты тип не меняется.
function roomTypeOptions(selected, accept) {
  return roomTypesByCategory().map((g) => {
    const opts = g.types.filter(accept)
      .map((t) => `<option value="${t.type}" ${t.type === selected ? 'selected' : ''}>${escapeHtml(t.title)}</option>`).join('');
    return opts ? `<optgroup label="${escapeHtml(g.title)}">${opts}</optgroup>` : '';
  }).join('');
}

function roomTypeSelect(room, shaft) {
  const groups = roomTypeOptions(room.type, (t) => Boolean(t.shaft) === shaft);
  const unknown = roomType(room.type) ? '' : `<option value="${escapeHtml(room.type)}" selected>${escapeHtml(room.type)}</option>`;
  return `<label class="prop-field"><span>Тип</span><select id="roomType" ${shaft ? 'disabled' : ''}>${unknown}${groups}</select></label>`;
}

function adjacentSideOptions() {
  const origin = planToScreen(0, 0);
  const names = ['Справа', 'Справа внизу', 'Снизу', 'Слева внизу', 'Слева', 'Слева вверху', 'Сверху', 'Справа вверху'];
  return [[0, -1], [1, 0], [0, 1], [-1, 0]].map(([dx, dy], side) => {
    const p = planToScreen(dx, dy);
    const angle = Math.atan2(p.y - origin.y, p.x - origin.x);
    const index = (Math.round(angle / (Math.PI / 4)) + 8) % 8;
    return `<option value="${side}" ${side === 1 ? 'selected' : ''}>${names[index]}</option>`;
  }).join('');
}

function bindAdjacentRoom(panel, source) {
  const details = panel.querySelector('#adjacentRoom');
  if (!details) return;
  details.addEventListener('toggle', () => {
    if (!details.open || details.querySelector('#adjacentType')) return;
    const typeOptions = roomTypeOptions(source.type === 'bedroom' ? 'living' : 'bedroom', (t) => !t.shaft && !t.open);
    details.insertAdjacentHTML('beforeend', `<div class="prop-block">
      <div class="prop-grid"><label class="prop-field"><span>Помещение</span><select id="adjacentType">${typeOptions}</select></label>
      <label class="prop-field"><span>Сторона на плане</span><select id="adjacentSide">${adjacentSideOptions()}</select></label></div>
      <label class="check-row"><input id="adjacentDoor" type="checkbox" checked><span>Дверь между комнатами</span></label>
      <div id="adjacentStatus" class="hint" role="status"></div>
      <button type="button" id="adjacentApply" class="primary">Пристроить</button></div>`);
    const type = details.querySelector('#adjacentType');
    const side = details.querySelector('#adjacentSide');
    const door = details.querySelector('#adjacentDoor');
    const status = details.querySelector('#adjacentStatus');
    const apply = details.querySelector('#adjacentApply');
    const preview = () => {
      const result = planAdjacentRoom(state.project, source.id, type.value, Number(side.value), door.checked, state.walls);
      apply.disabled = !result.ok || state.editLocked;
      status.textContent = result.ok ? [`${result.room.w} × ${result.room.h} мм`, result.existingDoor ? 'Существующая дверь сохранится' : '', result.warning].filter(Boolean).join(' · ') : result.reason;
      return result;
    };
    details.addEventListener('change', preview);
    apply.addEventListener('click', () => {
      const result = preview();
      if (!result.ok || state.editLocked) return;
      state.libraryPinned = false;
      closeSheets();
      const { room } = result;
      if (!commitPlacedRoom(room, { verdict: result, door: result.door })) return;
      const center = planToScreen(room.x + room.w / 2, room.y + room.h / 2);
      const outside = (p) => p.x < 40 || p.y < 60 || p.x > canvas.clientWidth - 40 || p.y > canvas.clientHeight - 60;
      const corners = [[0, 0], [room.w, 0], [0, room.h], [room.w, room.h]];
      if (state.project.rooms.length === 2 && corners.some(([dx, dy]) => outside(planToScreen(room.x + dx, room.y + dy)))) fitView();
      else if (outside(center)) {
        state.view.panX += canvas.clientWidth / 2 - center.x;
        state.view.panY += canvas.clientHeight / 2 - center.y;
        requestDraw();
      }
      if (!result.warning) toast(`Добавлено помещение «${room.name}»`);
      const next = isPhone() ? document.getElementById('mobileCardProps') : panel.querySelector('#adjacentRoom summary');
      next?.focus({ preventScroll: true });
    });
    preview();
  });
}

// Смена типа: цвет, нормы, ТЭП и набор мебели — по новому типу. Название
// меняется, только если было типовым («Кухня», «Кухня 2»), своё — остаётся.
function changeRoomType(room, type) {
  const next = roomType(type);
  if (!next || type === room.type || next.shaft) return;
  const prevTitle = roomType(room.type)?.title || room.type;
  mutate(() => {
    const m = room.name.match(/^(.*?)(\s+\d+)?$/);
    if (m && m[1] === prevTitle) room.name = next.title + (m[2] || '');
    room.type = type;
  });
}

function renderRoomProps(panel, room) {
  if (!room) { renderProjectProps(panel); return; }
  focusSolarRoom(room.id);
  const def = roomType(room.type);
  const shaft = isShaft(room);
  const minRoomSize = shaft ? MIN_SHAFT_SIZE : MIN_ROOM_SIZE;
  const parent = room.parentId ? roomById(state.project, room.parentId) : null;
  const rejected = AUTO_LAYOUT_AVAILABLE ? state.rejected.get(room.id) || [] : [];
  const insideCount = itemsInRoom(state.project, room).length;
  // Ширина/глубина — по номиналу (полная форма блока), площадь, мебель,
  // нормы и ТЭП — по видимой форме (комната моста = результат carve).
  const nominal = nominalShape(room);
  const eaten = Boolean(room.eatBase?.base);
  const datumPending = state.project.envelope?.zeroAboveGround == null
    && !Number.isFinite(state.project.site?.terrain?.floorZ);

  const furnitureRows = (def?.furniture || []).map((entry) => {
    const fd = furnitureDef(entry.kind);
    return `<div class="add-row">
      <span>${fd.title}</span><em>${fd.w}×${fd.h}</em>
      <button class="add-btn" data-add="${entry.kind}" title="Добавить в центр комнаты" aria-label="Добавить в комнату: ${escapeHtml(fd.title)}">+</button>
    </div>`;
  }).join('');

  const areaControl = parent && !shaft ? `
    <h3>Площадь</h3>
    <div class="prop-block">
      <label class="check-row"><input type="radio" name="areaFrom" id="areaFromParent" ${room.takesArea !== false ? 'checked' : ''}>
        <span>«${escapeHtml(room.name)}» отнимает у «${escapeHtml(parent.name)}»</span></label>
      <label class="check-row"><input type="radio" name="areaFrom" id="areaFromSelf" ${room.takesArea === false ? 'checked' : ''}>
        <span>«${escapeHtml(parent.name)}» показывается полной</span></label>
    </div>` : '';

  // Пересечения с другими комнатами: кто у кого забирает площадь (по z-порядку).
  const overlaps = overlappingTopRooms(room);
  const myIdx = state.project.rooms.indexOf(room);
  const overlapControl = overlaps.length ? `
    <h3>Пересечения</h3>
    <div class="prop-block">
      ${overlaps.map((o) => {
    const eats = myIdx > state.project.rooms.indexOf(o); // эта комната выше → съедает o
    return `<div class="prop-row overlap-row" data-other="${o.id}">
          <span>Площадь у «${escapeHtml(eats ? room.name : o.name)}»</span>
          <button class="link" data-swap="${o.id}" title="Передать площадь пересечения другой комнате">Передать «${escapeHtml(eats ? o.name : room.name)}»</button>
        </div>`;
  }).join('')}
    </div>` : '';

  const rejectedHtml = rejected.length
    ? `<div class="rejected"><h4>Не удалось расставить</h4>${rejected.map((r) => `<p>⚠ ${r.reason}</p>`).join('')}</div>`
    : '';

  panel.innerHTML = `
    <h2>${def?.title || 'Комната'}${parent ? `<span class="badge">внутри «${escapeHtml(parent.name)}»</span>` : ''}</h2>
    ${canAttachRoom(room) && state.modeName === 'plan' && !document.body.classList.contains('v3-open') ? '<details class="vs-sec" id="adjacentRoom"><summary>Пристроить комнату</summary></details>' : ''}
    <div class="prop-block">
      <label class="prop-field"><span>Название</span><input id="roomName" value="${escapeHtml(room.name)}"></label>
      ${roomTypeSelect(room, shaft)}
      <div class="prop-grid">
        <label class="prop-field"><span>Ширина, мм</span><input id="roomW" type="number" step="50" min="${minRoomSize}" value="${nominal.w}"></label>
        <label class="prop-field"><span>Глубина, мм</span><input id="roomH" type="number" step="50" min="${minRoomSize}" value="${nominal.h}"></label>
      </div>
      ${eaten ? '<p class="empty-hint" id="roomNominalHint">Размеры заданы до пересечения. Площадь учитывает границы соседних комнат.</p>' : ''}
      ${shaft ? '' : `<label class="check-row"><input id="roomCeilLinked" type="checkbox" ${room.ceiling ? '' : 'checked'}>
        <span>Высота связана с этажом</span></label>
        <label class="prop-field"><span>Чистая высота, м</span>
        <input id="roomCeil" type="number" step="0.05" min="2" value="${(roomCeiling(room, activeLevel(state.project)) / 1000).toFixed(2)}" ${room.ceiling ? '' : 'disabled'}></label>
      `}
      <div class="prop-row"><span>${shaft ? 'Площадь отверстия' : 'Площадь (чистая)'}</span><strong>${(shaft ? roomShapeArea(room) / 1_000_000 : roomNetAreaM2(state.project, room)).toFixed(2)} м²</strong></div>
      ${shaft || room.type === 'stairs-room' ? '' : '<button type="button" class="secondary" id="roomAbove" title="Повторить контур на следующем этаже">Добавить комнату этажом выше</button>'}
    </div>
    ${datumPending ? envelopeSettingsHtml() : ''}
    ${areaControl}
    ${overlapControl}
    ${roomRailingsHtml(room)}
    ${shaft ? '' : roomRoofHtml(room)}
    ${shaft ? '<div class="prop-block"><p class="empty-hint">Вертикальный проём без пола. Стены шахты строятся на всю высоту этажа.</p></div>' : ''}
    ${shaft ? '' : solarAnalysisHtml(room)}
    ${shaft ? '' : `<h3>Мебель <span class="count-badge">${insideCount} шт.</span></h3>
    <div class="prop-block add-list">${furnitureRows || '<p class="empty-hint">Для этого типа нет набора</p>'}</div>`}
    ${rejectedHtml}
    ${shaft ? '' : autoLayoutHtml(room)}`;

  if (datumPending) bindEnvelopeSettings(panel);
  bindAdjacentRoom(panel, room);
  panel.querySelector('#roomAbove')?.addEventListener('click', () => addRoomAbove(room));
  panel.querySelector('#roomName').addEventListener('change', (e) => {
    mutate(() => { room.name = e.target.value.trim() || room.name; });
  });
  bindRoomRoof(panel);
  bindRoomRailings(panel, room);
  if (!shaft) bindSolarAnalysisPanel(panel, room, renderProps);
  if (!shaft) bindAutoLayout(panel, room);
  panel.querySelector('#roomType')?.addEventListener('change', (e) => changeRoomType(room, e.target.value));
  // Размеры правят НОМИНАЛЬНУЮ форму (у съеденной — полную, до съедания):
  // номинал возвращается, правится, видимую форму заново даёт съедание
  // (core/v7/eat-bridge.js liftForEdit). Угол x/y номинала остаётся на месте.
  const applySize = () => {
    const w = Math.max(minRoomSize, Number(panel.querySelector('#roomW').value) || nominal.w);
    const h = Math.max(minRoomSize, Number(panel.querySelector('#roomH').value) || nominal.h);
    if (w === nominal.w && h === nominal.h) return;
    const layoutItemIds = itemsInRoom(state.project, room).map((item) => item.id);
    const before = snapshot();
    const edit = liftForEdit(state.project, room.id);
    const old = { w: room.w, h: room.h };
    room.w = w; room.h = h;
    const verdict = resizeVerdict(room);
    if (!verdict.ok) {
      room.w = old.w; room.h = old.h;
      reconcileEats(state.project);
      reconcileOpenings();
      refreshDerived();
      toast(verdict.reason, true);
      renderProps();
      requestDraw();
      return;
    }
    if (!room.parentId) eatOverlapsAfter([room.id], { under: edit.under, prev: edit.prev });
    reconcileOpenings();
    refreshDerived();
    arrangeRoomsNow([room.id], { itemIdsByRoom: new Map([[room.id, layoutItemIds]]) });
    pushHistory(before);
    afterChange();
    // Ввели размер, и сторона встала в 1–60 мм от «нужной» толщины стены соседа — стыкуется.
    autoDockAfterGesture([room.id], 'stretch', { before });
  };
  panel.querySelector('#roomW').addEventListener('change', applySize);
  panel.querySelector('#roomH').addEventListener('change', applySize);
  panel.querySelector('#roomCeil')?.addEventListener('change', (e) => {
    const v = Number(String(e.target.value).replace(',', '.'));
    mutate(() => { room.ceiling = v >= 2 ? Math.round(v * 1000) : roomCeiling(room, activeLevel(state.project)); });
  });
  panel.querySelector('#roomCeilLinked')?.addEventListener('change', (e) => {
    const linked = e.target.checked;
    mutate(() => {
      if (linked) delete room.ceiling;
      else room.ceiling = roomCeiling(room, activeLevel(state.project));
    });
  });
  panel.querySelectorAll('[data-add]').forEach((btn) => {
    btn.addEventListener('click', () => addFurniture(btn.dataset.add, room));
  });
  const fromParent = panel.querySelector('#areaFromParent');
  const fromSelf = panel.querySelector('#areaFromSelf');
  if (fromParent && fromSelf) {
    fromParent.addEventListener('change', () => mutate(() => { room.takesArea = true; }));
    fromSelf.addEventListener('change', () => mutate(() => { room.takesArea = false; }));
  }
  panel.querySelectorAll('[data-swap]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const other = roomById(state.project, btn.dataset.swap);
      if (!other) return;
      mutate(() => {
        const rooms = state.project.rooms;
        const i = rooms.indexOf(room);
        const j = rooms.indexOf(other);
        [rooms[i], rooms[j]] = [rooms[j], rooms[i]];
      });
      selectObject({ type: 'room', id: room.id });
    });
  });
}

function renderWallProps(panel, wall) {
  if (!wall) { renderProjectProps(panel); return; }
  if (wall.kind === 'manual') { renderManualWallProps(panel, wall); return; }
  const roomA = roomById(state.project, wall.rooms[0]);
  const roomB = wall.rooms[1] ? roomById(state.project, wall.rooms[1]) : null;
  const length = Math.round(wall.to - wall.from);
  const subtitle = wall.kind === 'shared'
    ? `Общая стена: «${roomA?.name}» + «${roomB?.name}»`
    : roomA?.parentId ? `Перегородка «${roomA?.name}»` : `Наружная стена «${roomA?.name}»`;
  const set = state.project.settings;
  panel.innerHTML = `
    <h2>Стена</h2>
    <p class="subtitle">${escapeHtml(subtitle)}</p>
    <div class="prop-block">
      <div class="prop-row"><span>Длина</span><strong>${length} мм</strong></div>
      <label class="prop-field"><span>Толщина, мм (${WALL_T_MIN}–${WALL_T_MAX})</span>
        <input id="wallT" type="number" step="10" min="${WALL_T_MIN}" max="${WALL_T_MAX}" value="${Math.round(wall.thickness)}"></label>
      <label class="prop-field"><span>Тип</span>
        <select id="wallKind">
          <option value="partition" ${wall.wallType === 'partition' ? 'selected' : ''}>Перегородка (${wallClassThickness(set, 'partition')})</option>
          <option value="bearing" ${wall.wallType === 'bearing' ? 'selected' : ''}>Несущая (${wallClassThickness(set, 'bearing')})</option>
          <option value="exterior" ${wall.wallType === 'exterior' ? 'selected' : ''}>Наружная (${wallClassThickness(set, 'exterior')})</option>
        </select></label>
      <label class="prop-field"><span>Высота, мм (пусто — по этажу)</span>
        <input id="wallH" type="number" step="50" min="100" value="${state.project.wallOverrides?.[wall.key]?.top?.height ?? ''}"></label>
    </div>
    ${wall.kind === 'shared' ? '<p class="empty-hint">При изменении толщины сдвинутся примыкающие комнаты.</p>' : ''}
    ${wallPinBlock(wall)}`;
  bindWallPinBlock(panel, wall);

  panel.querySelector('#wallT').addEventListener('change', (e) => {
    changeWallThickness(wall, Number(e.target.value) || wall.thickness);
  });
  panel.querySelector('#wallKind').addEventListener('change', (e) => {
    changeWallKind(wall, e.target.value);
  });
  // Своя высота стены комнаты — в wallOverrides[key] (видна в 3D).
  panel.querySelector('#wallH').addEventListener('change', (e) => {
    const v = e.target.value.trim();
    changeManualWall(wall, (project) => setWallHeight(project, wall, { height: v === '' ? null : Number(v) }));
  });
}

// Ручная стена (схема 6): объект с осью — толщина, класс, привязка оси,
// сдвиг оси, высота; проёмы ставятся кнопками «Дверь»/«Окно» над планом.
function renderManualWallProps(panel, wall) {
  const own = (state.project.walls || []).find((w) => w.id === wall.wallId);
  if (!own) { renderProjectProps(panel); return; }
  const set = state.project.settings;
  const length = Math.round(wall.to - wall.from);
  const height = own.top?.height ?? '';
  const levelH = Math.round(wall.z1 - wall.z0);
  const wallDirection = wall.orient === 'h' ? 'горизонтальная' : wall.orient === 'v' ? 'вертикальная' : 'свободный угол';
  const shiftDirection = wall.orient === 'h' ? '+ вниз' : wall.orient === 'v' ? '+ вправо' : '+ по нормали';
  panel.innerHTML = `
    <h2>Стена</h2>
    <p class="subtitle">Ручная стена · ${wallDirection}</p>
    <div class="prop-block">
      <div class="prop-row"><span>Длина по оси</span><strong>${length} мм</strong></div>
      <label class="prop-field"><span>Толщина, мм (${WALL_T_MIN}–${WALL_T_MAX})</span>
        <input id="wallT" type="number" step="10" min="${WALL_T_MIN}" max="${WALL_T_MAX}" value="${Math.round(wall.thickness)}"></label>
      <label class="prop-field"><span>Тип</span>
        <select id="wallKind">
          <option value="partition" ${wall.wallType === 'partition' ? 'selected' : ''}>Перегородка (${wallClassThickness(set, 'partition')})</option>
          <option value="bearing" ${wall.wallType === 'bearing' ? 'selected' : ''}>Несущая (${wallClassThickness(set, 'bearing')})</option>
          <option value="exterior" ${wall.wallType === 'exterior' ? 'selected' : ''}>Наружная (${wallClassThickness(set, 'exterior')})</option>
        </select></label>
      <label class="prop-field"><span>Ось стены</span>
        <select id="wallJustify">
          <option value="center" ${own.justify === 'center' ? 'selected' : ''}>По центру</option>
          <option value="left" ${own.justify === 'left' ? 'selected' : ''}>По левой грани</option>
          <option value="right" ${own.justify === 'right' ? 'selected' : ''}>По правой грани</option>
        </select></label>
      <label class="prop-field"><span>Сдвинуть ось на, мм (${shiftDirection})</span>
        <input id="wallShift" type="number" step="10" value="0"></label>
      <label class="prop-field"><span>Высота, мм (пусто — по этажу, ${levelH})</span>
        <input id="wallH" type="number" step="50" min="100" value="${height}"></label>
    </div>
    <p class="empty-hint">Перетащите конец стены, чтобы изменить длину.</p>
    ${wallPinBlock(wall)}`;
  bindWallPinBlock(panel, wall);

  panel.querySelector('#wallT').addEventListener('change', (e) => changeWallThickness(wall, Number(e.target.value) || wall.thickness));
  panel.querySelector('#wallKind').addEventListener('change', (e) => changeWallKind(wall, e.target.value));
  panel.querySelector('#wallJustify').addEventListener('change', (e) => {
    changeManualWall(wall, (project, id) => setManualWallJustify(project, id, e.target.value));
  });
  panel.querySelector('#wallShift').addEventListener('change', (e) => {
    const delta = Number(e.target.value) || 0;
    if (delta) changeManualWall(wall, (project, id) => moveManualWall(project, id, delta));
  });
  panel.querySelector('#wallH').addEventListener('change', (e) => {
    const v = e.target.value.trim();
    changeManualWall(wall, (project) => setWallHeight(project, wall, { height: v === '' ? null : Number(v) }));
  });
}

// Фасад проёма (вид на стену) — SVG с размерами ширины, высоты и отступа
// от пола. Чисто параметрический, масштабируется.
function elevationSVG(opening) {
  const isDoor = opening.kind === 'door';
  const sill = isDoor ? 0 : (opening.sill || 0);
  const height = opening.height || (isDoor ? 2100 : 1500);
  const width = opening.width;
  const ceil = Math.max(2700, sill + height + 350);
  const margin = Math.max(500, width * 0.35);
  const W = width + margin * 2;
  const ox = margin;
  const oy = ceil - sill - height;
  const sw = Math.max(14, W / 90); // толщина линий в единицах viewBox
  const dim = (x1, y1, x2, y2, label, tx, ty, rot) => `
    <line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" class="elev-dim"/>
    <text x="${tx}" y="${ty}" class="elev-txt" ${rot ? `transform="rotate(${rot} ${tx} ${ty})"` : ''}>${label}</text>`;
  const glass = isGlazedAssembly(opening) ? glazedElevationMarkup(opening, ox, oy, sw) : isDoor
    ? `<rect x="${ox + sw * 1.5}" y="${oy + sw * 1.5}" width="${width - sw * 3}" height="${height - sw * 3}" class="elev-door"/>
       <circle cx="${ox + width - sw * 5}" cy="${oy + height / 2}" r="${sw * 1.5}" class="elev-dim"/>`
    : `<rect x="${ox}" y="${oy}" width="${width}" height="${height}" class="elev-glass"/>
       <line x1="${ox + width / 2}" y1="${oy}" x2="${ox + width / 2}" y2="${oy + height}" class="elev-dim"/>
       <line x1="${ox}" y1="${oy + height / 2}" x2="${ox + width}" y2="${oy + height / 2}" class="elev-dim"/>`;
  return `<svg viewBox="0 0 ${W} ${ceil}" class="elev" preserveAspectRatio="xMidYMid meet" style="--sw:${sw}px">
    <rect x="0" y="0" width="${W}" height="${ceil}" class="elev-wall"/>
    <rect x="${ox}" y="${oy}" width="${width}" height="${height}" class="elev-open"/>
    ${glass}
    <line x1="0" y1="${ceil}" x2="${W}" y2="${ceil}" class="elev-floor"/>
    ${dim(ox, oy - sw * 6, ox + width, oy - sw * 6, `${width}`, ox + width / 2, oy - sw * 8)}
    ${dim(ox + width + sw * 6, oy, ox + width + sw * 6, oy + height, `${height}`, ox + width + sw * 10, oy + height / 2, -90)}
    ${sill > 0 ? dim(ox - sw * 6, oy + height, ox - sw * 6, ceil, `${sill}`, ox - sw * 10, oy + height + sill / 2, -90) : ''}
  </svg>`;
}

// Параметры двери/окна ДО вставки: активный инструмент «Дверь»/«Окно»
// (state.tool.preset) — тип, ширина, высота, подоконник; каждый следующий
// проём ставится с ними. compact — строка параметров над холстом (без
// заголовка и фасада).
function renderPlaceOpeningProps(panel, compact = false) {
  const tool = state.tool;
  const isDoor = tool.openKind === 'door';
  const preset = tool.preset;
  const assembly = isGlazedAssembly(preset);
  if (preset.presetId === CORNER_PRESET) { renderCornerWindowProps(panel, preset, { preset: true, compact }); return; }
  const level = activeLevel(state.project);
  const sampleSource = { kind: tool.openKind, ...preset };
  const sample = {
    ...sampleSource,
    sill: openingSill(sampleSource, level),
    height: openingHeight(sampleSource, level),
  };
  panel.innerHTML = `
    ${compact ? `<strong class="to-title">${isDoor ? 'Дверь' : 'Окно'}</strong>` : `<h2>${isDoor ? 'Дверь' : 'Окно'} — параметры вставки</h2>
    <p class="subtitle">Задайте размеры и кликайте по стенам: можно ставить несколько. Esc — выход.</p>
    <div class="elev-wrap">${elevationSVG(sample)}</div>`}
    <div class="prop-block">
      <label class="prop-field"><span>Тип</span>
        <select id="presetType">${Object.entries(isDoor ? DOOR_TYPES : WINDOW_TYPES).map(([id, title]) => `
          <option value="${id}" ${preset.type === id ? 'selected' : ''}>${title}</option>`).join('')}
        </select></label>
      <div class="prop-grid">
        <label class="prop-field"><span>${assembly ? 'Ширина блока' : 'Ширина'}, мм</span>
          <input id="presetW" type="number" step="50" min="300" value="${preset.width}"></label>
        <label class="prop-field"><span>${assembly ? 'Высота блока' : 'Высота'}, мм</span>
          <input id="presetH" type="number" step="50" min="300" value="${sample.height}" ${assembly || (!isDoor && preset.heightMode === 'level') ? 'disabled' : ''}></label>
      </div>
      ${glazedOpeningFields(preset, 'preset')}
      ${isDoor || assembly ? '' : `<label class="check-row"><input id="presetHeightLinked" type="checkbox" ${preset.heightMode === 'level' ? 'checked' : ''}>
        <span>Общие отступы этажа</span></label>`}
      ${isDoor || assembly ? '' : `<label class="prop-field"><span>Снизу от пола, мм</span>
        <input id="presetSill" type="number" step="50" min="0" value="${sample.sill}" ${preset.heightMode === 'level' ? 'disabled' : ''}></label>`}
    </div>`;
  // Библиотека проёмов подсвечивает карточку по новым параметрам.
  const save = (next) => {
    Object.assign(preset, next);
    renderPlaceOpeningProps(panel, compact);
    renderOpeningLibrary();
    document.dispatchEvent(new CustomEvent('kepler:opening-tool'));
    requestDraw();
  };
  panel.querySelector('#presetType').addEventListener('change', (e) => {
    save(presetWithType(tool.openKind, preset, e.target.value, activeLevel(state.project).height));
  });
  panel.querySelector('#presetW').addEventListener('change', (e) => {
    const width = Math.max(glazedOpeningMinWidth(preset), Number(e.target.value) || preset.width);
    save(assembly ? resizeGlazedOpening(preset, { width }) : { width });
  });
  bindGlazedOpeningFields(panel, preset, 'preset', save);
  panel.querySelector('#presetH').addEventListener('change', (e) => save({
    height: Math.max(300, Number(e.target.value) || preset.height), heightMode: 'custom',
  }));
  panel.querySelector('#presetHeightLinked')?.addEventListener('change', (e) => {
    save(e.target.checked
      ? {
        heightMode: 'level', height: sample.height, sill: sample.sill,
        frameMaterial: 'aluminum', frameColor: 'anthracite',
      }
      : { heightMode: 'custom', height: sample.height, sill: sample.sill });
  });
  panel.querySelector('#presetSill')?.addEventListener('change', (e) => save({ sill: Math.max(0, Number(e.target.value) || 0) }));
}

// --- Строка параметров активного инструмента (#toolOptions над холстом) ---
// Дверь/окно — та же форма, что и раньше в «Свойствах» (renderPlaceOpeningProps,
// компактно); стена — тип и толщина следующих участков; помещение и мебель —
// что выбрано в библиотеке. Справа — подсказка инструмента с клавишами
// (#canvasHint переезжает сюда; на телефоне остаётся на холсте). «Выбор» —
// без параметров. Перестраивается только при смене инструмента: поле под
// курсором не сбрасывается.
let toolOptionsKey = null;
const phoneQuery = () => window.matchMedia?.('(max-width: 640px)');

function placeCanvasHint() {
  const hint = refs.hint;
  const bar = document.getElementById('toolOptions');
  const wrap = document.querySelector('.canvas-wrap');
  if (!hint || !bar || !wrap) return;
  if (phoneQuery()?.matches) { if (hint.parentElement !== wrap) wrap.insertBefore(hint, wrap.children[1] || null); }
  else if (hint.parentElement !== bar) bar.appendChild(hint);
}

export function renderToolOptions(force = false) {
  const bar = document.getElementById('toolOptions');
  const body = document.getElementById('toolOptionsBody');
  const keys = document.getElementById('toolOptionsKeys');
  if (!bar || !body || !keys || !state.project) return;
  if (!bar.dataset.bound) {
    bar.dataset.bound = '1';
    placeCanvasHint();
    phoneQuery()?.addEventListener?.('change', () => { placeCanvasHint(); renderProps(); });
  }
  const t = state.tool;
  const furnLib = !t && state.libraryPinned && state.libraryTab === 'furniture' && state.modeName === 'plan';
  const roomLib = !t && state.libraryPinned && state.libraryTab === 'rooms' && state.modeName === 'plan';
  const key = t || (furnLib ? 'furn' : roomLib ? 'rooms' : null);
  if (!force && key === toolOptionsKey) return;
  toolOptionsKey = key;
  let html = '';
  if (t?.kind === 'entry') {
    renderEntryToolOptions(body);
    html = null;
  } else if (t?.kind === 'place-opening') {
    renderPlaceOpeningProps(body, true);
    html = null;
  } else if (t?.kind === 'wall') {
    const set = state.project.settings;
    html = `<strong class="to-title">Стена</strong>
      <label class="prop-field"><span>Тип</span>
        <select id="toWallType">${['partition', 'bearing', 'exterior'].map((k) => `
          <option value="${k}" ${t.wallType === k ? 'selected' : ''}>${{ partition: 'Перегородка', bearing: 'Несущая', exterior: 'Наружная' }[k]} (${wallClassThickness(set, k)})</option>`).join('')}
        </select></label>
      <label class="prop-field"><span>Толщина, мм</span>
        <input id="toWallT" type="number" inputmode="numeric" step="10" min="${WALL_T_MIN}" max="${WALL_T_MAX}" value="${Math.round(t.thickness)}"></label>
      <label class="prop-field"><span>Ось</span>
        <select id="toWallJustify">
          <option value="center" ${t.justify === 'center' ? 'selected' : ''}>По центру</option>
          <option value="left" ${t.justify === 'left' ? 'selected' : ''}>Левая грань</option>
          <option value="right" ${t.justify === 'right' ? 'selected' : ''}>Правая грань</option>
        </select></label>`;
  } else if (t?.kind === 'place-room') {
    html = `<strong class="to-title">Помещение</strong><span class="to-value">${escapeHtml(roomType(t.type)?.title || t.type)}</span>`;
  } else if (t?.kind === 'bound-room' || roomLib) {
    html = '<strong class="to-title">Помещение</strong><span class="to-note">клик внутри замкнутой петли стен — или тип из библиотеки слева</span>';
  } else if (t?.kind === 'place-furniture' && t.itemKind === 'stairs') {
    html = `<strong class="to-title">Лестница</strong>
      <label class="prop-field"><span>Форма</span>
        <select id="toStairShape">${STAIR_SHAPES.map((s) => `
          <option value="${s.id}" ${(t.stairShape || 'straight') === s.id ? 'selected' : ''}>${s.title}</option>`).join('')}
        </select></label>`;
  } else if (t?.kind === 'place-furniture') {
    html = `<strong class="to-title">${t.itemKind === 'stairs' ? 'Лестница' : 'Мебель'}</strong><span class="to-value">${escapeHtml(furnitureDef(t.itemKind)?.title || t.itemKind)}</span>`;
  } else if (t?.kind === 'grid') {
    renderGridToolOptions(body);
    html = null;
  } else if (t?.kind === 'psec') {
    html = `<strong class="to-title">Разрез</strong><span class="to-note">${['клик — начало линии', 'клик — конец линии', 'клик — сторона взгляда или Enter'][Math.min(2, t.points.length)]} · Ctrl — орто, Shift — без привязки</span>`;
  } else if (furnLib) {
    html = '<strong class="to-title">Мебель</strong><span class="to-note">выберите предмет в каталоге слева или перетащите на план</span>';
  }
  if (html !== null) body.innerHTML = html;
  keys.textContent = t ? '' : (furnLib || roomLib
    ? 'Esc — закрыть библиотеку'
    : 'Выбор: клик — объект, рамка по пустому месту — несколько · Esc — снять выбор');
  // Телефон: строка — только когда есть что задать (дверь, окно, стена).
  bar.classList.toggle('empty', !body.querySelector('input, select'));
  body.querySelector('#toStairShape')?.addEventListener('change', (e) => {
    t.stairShape = e.target.value; // следующая лестница — этой формы
    requestDraw();
  });
  if (t?.kind === 'wall') {
    body.querySelector('#toWallType').addEventListener('change', (e) => {
      t.wallType = e.target.value;
      t.thickness = wallClassThickness(state.project.settings, t.wallType);
      renderToolOptions(true);
      requestDraw();
    });
    const changeThickness = (e) => {
      const v = Math.round(Number(e.target.value));
      if (Number.isFinite(v) && v > 0) t.thickness = Math.min(WALL_T_MAX, Math.max(WALL_T_MIN, v));
      requestDraw();
    };
    body.querySelector('#toWallT').addEventListener('input', changeThickness);
    body.querySelector('#toWallT').addEventListener('change', (e) => {
      changeThickness(e);
      e.target.value = String(Math.round(t.thickness));
    });
    body.querySelector('#toWallJustify').addEventListener('change', (e) => {
      t.justify = e.target.value;
      requestDraw();
    });
  }
}

function renderCornerWindowProps(panel, target, { preset = false, compact = false } = {}) {
  const level = activeLevel(state.project);
  const spec = preset ? { joint: target.cornerJoint || 'post', returnWidth: target.returnWidth || 1800 } : target.corner;
  const linked = target.heightMode === 'level';
  const sample = { ...target, kind: 'window' };
  const height = openingHeight(sample, level);
  const sill = openingSill(sample, level);
  const field = (id, label, value, min, disabled = false) => `<label class="prop-field"><span>${label}, мм</span>
    <input id="${id}" type="number" min="${min}" step="10" value="${value}" ${disabled ? 'disabled' : ''}></label>`;
  panel.innerHTML = `${compact ? '<strong class="to-title">Угловой витраж</strong>' : '<h2>Угловой витраж</h2>'}
    ${preset && !compact ? '<p class="subtitle">Нажмите на наружную стену ближе к нужному углу.</p>' : ''}
    <div class="prop-block"><div class="prop-grid">
      ${field('cornerMain', 'Первое крыло', target.width, 600)}
      ${field('cornerReturn', 'Второе крыло', spec.returnWidth, 600)}
    </div><label class="prop-field"><span>Стык</span><select id="cornerJoint">
      <option value="post" ${spec.joint !== 'pier' ? 'selected' : ''}>Тонкая алюминиевая стойка</option>
      <option value="pier" ${spec.joint === 'pier' ? 'selected' : ''}>Простенок · 350 мм</option></select></label>
    ${compact ? '' : `<label class="prop-field"><span>Рама обоих крыльев</span><select id="cornerColor">
      ${Object.entries({ anthracite: 'Антрацит', black: 'Чёрная', bronze: 'Бронза' }).map(([id, label]) =>
        `<option value="${id}" ${(target.frameColor || 'anthracite') === id ? 'selected' : ''}>${label}</option>`).join('')}</select></label>
      <label class="check-row"><input type="checkbox" id="cornerLinked" ${linked ? 'checked' : ''}><span>Общие отступы этажа</span></label>
      <div class="prop-grid">${field('cornerHeight', 'Высота', height, 300, linked)}${field('cornerSill', 'Снизу от пола', sill, 0, linked)}</div>`}
    </div>`;
  panel.querySelectorAll('input, select').forEach((control) => control.addEventListener('change', () => {
    const next = { ...target, corner: { ...spec } };
    const n = control.valueAsNumber;
    if (control.id === 'cornerMain') next.width = n;
    if (control.id === 'cornerReturn') next.corner.returnWidth = n;
    if (control.id === 'cornerJoint') next.corner.joint = control.value;
    if (control.id === 'cornerColor') next.frameColor = control.value;
    if (control.id === 'cornerHeight') next.height = n;
    if (control.id === 'cornerSill') next.sill = n;
    if (control.id === 'cornerLinked') {
      next.heightMode = control.checked ? 'level' : 'custom';
      next.height = height;
      next.sill = sill;
    }
    const windows = { ...next, kind: 'window' };
    const bottom = openingSill(windows, level);
    const top = bottom + openingHeight(windows, level);
    const wings = !preset && cornerWindowGeometry(state.project, next, state.walls);
    const fitsHeight = (!wings || wings.every(({ wall }) => {
      const range = wallZRange(state.project, wall, level.height);
      return bottom >= range.z0 && top <= range.z1;
    })) && top <= level.height;
    if (!preset) next.offset = fitOpeningOffset(state.project, next, state.walls, next.offset);
    if (control.validity?.badInput || (control.type === 'number' && (!Number.isFinite(n) || n < Number(control.min)))
      || !fitsHeight || (!preset && next.offset == null)) {
      toast('Проверьте размеры и свободное место на обеих стенах', true);
      renderCornerWindowProps(panel, target, { preset, compact });
      return;
    }
    if (preset) {
      next.returnWidth = next.corner.returnWidth;
      next.cornerJoint = next.corner.joint;
      delete next.corner;
      Object.assign(target, next);
      renderToolOptions(true);
      document.dispatchEvent(new CustomEvent('kepler:opening-tool'));
      requestDraw();
    } else {
      mutate(() => Object.assign(target, next));
      selectObject({ type: 'opening', id: target.id });
    }
  }));
}

function renderOpeningProps(panel, opening) {
  if (opening?.corner) { renderCornerWindowProps(panel, opening); return; }
  if (!opening) { renderProjectProps(panel); return; }
  const room = roomById(state.project, opening.roomId);
  const isDoor = opening.kind === 'door';
  const assembly = isGlazedAssembly(opening);
  const level = activeLevel(state.project);
  const hasUpperFloor = !isDoor && !assembly && state.project.levels.some((candidate) => candidate.elevation > level.elevation);
  const spanOption = hasUpperFloor && nextWindowSpan(state.project, level.id, opening);
  const upper = spanOption && state.project.levels.find((l) => l.id === spanOption.targetLevelId);
  const spanTop = opening.span && windowSpanTop(state.project, level.id, opening);
  const effectiveSill = openingSill(opening, level);
  const effectiveHeight = spanTop ? spanTop - effectiveSill : openingHeight(opening, level);
  const walls = state.walls;
  const frame = openingFrame(state.project, opening, walls);
  const placed = openingRect(state.project, opening, walls);
  let leftGap = null;
  let rightGap = null;
  let wall = null;
  if (placed) {
    wall = placed.wall;
    const centerAlong = wall.orient === 'h' ? placed.rect.x + placed.rect.w / 2 : placed.rect.y + placed.rect.h / 2;
    leftGap = Math.round((centerAlong - opening.width / 2) - wall.from);
    rightGap = Math.round(wall.to - (centerAlong + opening.width / 2));
  }

  panel.innerHTML = `
    <h2>${assembly ? 'Дверь с боковыми окнами' : isDoor ? 'Дверь' : 'Окно'}</h2>
    <p class="subtitle">${opening.host ? 'Ручная стена' : room ? `Стена «${escapeHtml(room.name)}»` : 'Стена'}</p>
    <div class="elev-wrap">${elevationSVG({ ...opening, height: effectiveHeight, sill: effectiveSill })}</div>
    <div class="prop-block">
      <label class="prop-field"><span>Тип</span>
        <select id="openType">${Object.entries(isDoor ? DOOR_TYPES : WINDOW_TYPES).map(([id, title]) => `
          <option value="${id}" ${(opening.type || (isDoor ? 'single' : 'standard')) === id ? 'selected' : ''}>${title}</option>`).join('')}
        </select></label>
      ${isDoor || (!hasUpperFloor && !opening.span) ? '' : `<label class="prop-field"><span>Верх окна</span>
        <select id="openTopLevel" ${!upper && !opening.span ? 'disabled' : ''}>
          <option value="">В пределах этажа · ${escapeHtml(level.name)}</option>
          ${upper ? `<option value="${escapeHtml(upper.id)}" ${spanTop ? 'selected' : ''}>До потолка · ${escapeHtml(upper.name)}</option>` : ''}
          ${opening.span && !spanTop ? '<option value="detached" selected disabled>Этаж или верхняя стена изменены</option>' : ''}
        </select></label>
        ${!upper ? '<p class="subtitle">Для второго света нужна свободная наружная стена на той же линии этажом выше.</p>' : ''}
        ${spanTop && upper ? `<label class="prop-field"><span>Отступ от потолка · ${escapeHtml(upper.name)}, мм</span>
          <input id="openTopGap" type="number" step="50" min="0" max="${spanOption.maxTop - spanOption.minTop}" value="${Math.round(spanOption.maxTop - spanTop)}"></label>` : ''}`}
      <div class="prop-grid">
        <label class="prop-field"><span>${assembly ? 'Ширина блока' : 'Ширина'}, мм</span>
          <input id="openW" type="number" step="50" min="300" value="${opening.width}"></label>
        <label class="prop-field"><span>${assembly ? 'Высота блока' : 'Высота'}, мм</span>
          <input id="openH" type="number" step="50" min="300" value="${effectiveHeight}" ${assembly || (!isDoor && (opening.heightMode === 'level' || spanTop)) ? 'disabled' : ''}></label>
      </div>
      ${glazedOpeningFields(opening, 'open')}
      ${isDoor || assembly ? '' : `<label class="check-row"><input id="openHeightLinked" type="checkbox" ${opening.heightMode === 'level' ? 'checked' : ''}>
        <span>${spanTop ? 'Общий отступ от пола' : 'Общие отступы этажа'}</span></label>
        <div class="prop-row"><span>Рама</span><strong>Алюминий · антрацит</strong></div>`}
      ${isDoor ? `<label class="prop-field"><span>Роль наружной двери</span><select id="entryRole">
        <option value="auto" ${!opening.entryRole ? 'selected' : ''}>Определять автоматически</option>
        <option value="main" ${opening.entryRole === 'main' ? 'selected' : ''}>Главный вход</option>
        <option value="service" ${opening.entryRole === 'service' ? 'selected' : ''}>Служебный вход</option>
        <option value="terrace" ${opening.entryRole === 'terrace' ? 'selected' : ''}>Выход на террасу</option>
        <option value="none" ${opening.entryRole === 'none' ? 'selected' : ''}>Без автокрыльца</option>
      </select></label>` : ''}
      ${isDoor || assembly ? '' : `<label class="prop-field"><span>Снизу от пола, мм</span>
        <input id="openSill" type="number" step="50" min="0" value="${effectiveSill}" ${opening.heightMode === 'level' ? 'disabled' : ''}></label>`}
    </div>
    ${isDoor && (deriveEntrances(state.project).some((entry) => entry.openingId === opening.id) || opening.entrance || opening.entryRole === 'main') ? '<button type="button" id="editEntrance">Крыльцо и наружная лестница</button>' : ''}
    <h3>Положение на стене</h3>
    <div class="prop-block">
      <div class="prop-grid">
        <label class="prop-field"><span>Отступ слева, мм</span>
          <input id="gapL" type="number" step="50" value="${leftGap ?? ''}" ${leftGap === null ? 'disabled' : ''}></label>
        <label class="prop-field"><span>Отступ справа, мм</span>
          <input id="gapR" type="number" step="50" value="${rightGap ?? ''}" ${rightGap === null ? 'disabled' : ''}></label>
      </div>
      <label class="prop-field"><span>От начала стены, мм</span>
        <input id="openOff" type="number" step="50" value="${Math.round(openingPos(opening))}"></label>
    </div>`;

  panel.querySelector('#editEntrance')?.addEventListener('click', () => {
    if (state.modeName === 'plan' && !document.body.classList.contains('v3-open')) openView('landscape');
    selectObject({ type: 'entrance', id: opening.id });
  });
  const commitOpening = (fn) => {
    const before = structuredClone(opening);
    mutate(() => {
      fn();
      if (isGlazedAssembly(opening)) {
        const at = fitOpeningOffset(state.project, opening, walls, openingPos(opening), { others: levelWindowOpenings(state.project, walls) });
        if (at === null) {
          for (const key of Object.keys(opening)) delete opening[key];
          Object.assign(opening, before);
          toast('Для такого блока нет свободного места на стене', true);
        } else setOpeningPos(opening, at);
      }
      if (before.span && spanTop && opening.span && !nextWindowSpan(state.project, level.id, opening)) {
        for (const key of Object.keys(opening)) delete opening[key];
        Object.assign(opening, before);
        toast('На верхней стене для такого положения или ширины нет места', true);
      }
    });
    selectObject({ type: 'opening', id: opening.id });
  };
  panel.querySelector('#openTopLevel')?.addEventListener('change', (e) => {
    const target = e.target.value;
    commitOpening(() => {
      if (!target) clearWindowSpan(opening);
      else if (spanOption && target === spanOption.targetLevelId) {
        setWindowSpan(state.project, level.id, opening, spanOption.maxTop);
      }
    });
  });
  panel.querySelector('#openTopGap')?.addEventListener('change', (e) => {
    const gap = Math.max(0, Number(e.target.value) || 0);
    commitOpening(() => setWindowSpan(state.project, level.id, opening, Math.max(spanOption.minTop, spanOption.maxTop - gap)));
  });
  const fit = (pos) => fitOpeningOffset(state.project, opening, walls, pos, { others: levelWindowOpenings(state.project, walls) });
  bindGlazedOpeningFields(panel, opening, 'open', (next) => commitOpening(() => Object.assign(opening, next)));
  panel.querySelector('#openW').addEventListener('change', (e) => {
    const width = Math.max(glazedOpeningMinWidth(opening), Number(e.target.value) || opening.width);
    commitOpening(() => {
      if (assembly) { Object.assign(opening, resizeGlazedOpening(opening, { width })); return; }
      const oldWidth = opening.width;
      opening.width = width;
      const clamped = fit(openingPos(opening));
      if (clamped !== null) setOpeningPos(opening, clamped);
      else { opening.width = oldWidth; toast('Проём шире свободного участка стены — уменьшите ширину', true); }
    });
  });
  panel.querySelector('#openType').addEventListener('change', (e) => {
    const type = e.target.value;
    commitOpening(() => {
      const previous = { ...opening };
      opening.type = type;
      if (!isGlazedAssembly(opening)) delete opening.assembly;
      if (!isDoor) {
        // Высокие окна следуют единой отметке этажа, обычные — индивидуальны.
        const top = activeLevel(state.project).height - 400;
        if (isGlazedAssembly(opening)) {
          Object.assign(opening, presetWithType('window', previous, type, level.height));
          delete opening.span;
        } else if (HIGH_WINDOW_TYPES.has(type)) {
          opening.heightMode = 'level';
          opening.sill = openingSill(opening, level);
          opening.height = openingHeight(opening, level);
        } else {
          opening.sill = type === 'clerestory' ? 1700 : 900;
          opening.height = type === 'clerestory' ? 600 : Math.min(1500, top - 900);
          opening.heightMode = 'custom';
        }
        opening.frameMaterial = 'aluminum';
        opening.frameColor = opening.frameColor || 'anthracite';
      } else if (type === 'double' && opening.width < 1200) {
        opening.width = 1200; // двустворчатой нужна ширина
      }
    });
  });
  panel.querySelector('#entryRole')?.addEventListener('change', (e) => {
    commitOpening(() => {
      if (e.target.value === 'auto') delete opening.entryRole;
      else opening.entryRole = e.target.value;
    });
  });
  panel.querySelector('#openH').addEventListener('change', (e) => {
    commitOpening(() => {
      opening.height = Math.max(300, Number(e.target.value) || opening.height);
      if (!isDoor) opening.heightMode = 'custom';
    });
  });
  panel.querySelector('#openHeightLinked')?.addEventListener('change', (e) => {
    commitOpening(() => {
      const height = openingHeight(opening, level);
      const sill = openingSill(opening, level);
      if (e.target.checked) {
        opening.heightMode = 'level';
        opening.sill = openingSill(opening, level);
        opening.height = openingHeight(opening, level);
      } else {
        opening.height = height;
        opening.sill = sill;
        opening.heightMode = 'custom';
      }
    });
  });
  const sillInput = panel.querySelector('#openSill');
  if (sillInput) sillInput.addEventListener('change', (e) => commitOpening(() => {
    opening.sill = Math.max(0, Number(e.target.value) || 0);
    opening.heightMode = 'custom';
  }));

  const setByGap = (fromLeft) => (e) => {
    if (!wall || !frame) return;
    const value = Math.max(0, Number(e.target.value) || 0);
    const along = fromLeft ? wall.from + opening.width / 2 + value : wall.to - opening.width / 2 - value;
    const desired = (along - frame.base) * frame.dir;
    commitOpening(() => {
      const clamped = fit(desired);
      if (clamped !== null) setOpeningPos(opening, clamped);
      else toast('Сюда проём не помещается: мало места или налезает на соседний проём');
    });
  };
  if (leftGap !== null) panel.querySelector('#gapL').addEventListener('change', setByGap(true));
  if (rightGap !== null) panel.querySelector('#gapR').addEventListener('change', setByGap(false));
  panel.querySelector('#openOff').addEventListener('change', (e) => {
    commitOpening(() => {
      const clamped = fit(Number(e.target.value) || openingPos(opening));
      if (clamped !== null) setOpeningPos(opening, clamped);
      else toast('Сюда проём не помещается: мало места или налезает на соседний проём');
    });
  });
}

// Лестничная зона следует за габаритом марша: смена формы остаётся операцией
// в один клик и никогда не выпускает ступени сквозь стены.
function fitStairRoom(item, margin = 200) {
  const room = state.project.rooms.find((candidate) => candidate.type === 'stairs-room'
    && item.x >= candidate.x && item.x <= candidate.x + candidate.w
    && item.y >= candidate.y && item.y <= candidate.y + candidate.h);
  if (!room) return;
  // Габарит зоны — номинал (съеденной возвращается полная форма); видимую
  // форму пересчитает съедание в mutate.
  liftRoom(state.project, room.id);
  room.w = item.w + margin * 2;
  room.h = item.h + margin * 2;
  room.x = item.x - room.w / 2;
  room.y = item.y - room.h / 2;
}

function renderItemProps(panel, item) {
  if (!item) { renderProjectProps(panel); return; }
  const isStairs = item.kind === 'stairs';
  const fixed = isFixedSizeComp(item);
  let stairsBlock = '';
  if (isStairs) {
    const c = stairCalculation(item, activeLevel(state.project)?.height || 3000);
    const comfortable = c.okRiser && c.okTread && c.okComfort;
    const byLevels = Boolean(item.toLevel && item.toLevel !== 'none');
    const appearance = stairAppearance(item);
    const opts = (list, value) => list.map((entry) => `<option value="${entry.id}" ${entry.id === value ? 'selected' : ''}>${entry.title}</option>`).join('');
    stairsBlock = `
      <h3>Назначение и отделка</h3>
      <div class="prop-block">
        <label class="prop-field"><span>Размещение</span><select id="stairEnvironment">${opts(STAIR_ENVIRONMENTS, appearance.environment)}</select></label>
        <label class="prop-field"><span>Материал</span><select id="stairMaterial">${opts(STAIR_MATERIALS, appearance.material)}</select></label>
        <label class="prop-field"><span>Ограждение</span><select id="stairRailing">${opts(STAIR_RAILINGS, appearance.railing)}</select></label>
      </div>
      <h3>Форма лестницы</h3>
      <div class="stair-shape">
        ${STAIR_SHAPES.map((shape) => `<button type="button" data-stair-shape="${shape.id}" class="${c.shape === shape.id ? 'active' : ''}">${shape.title}</button>`).join('')}
      </div>
      <button id="stairFit" type="button">Подогнать автоматически</button>
      <label class="prop-field"><span>Конструкция (3D)</span>
        <select id="stairBuild">${STAIR_BUILDS.map((b) => `<option value="${b.id}" ${stairBuild(item) === b.id ? 'selected' : ''}>${b.title}</option>`).join('')}</select></label>
      ${stairLevelBlock(item)}
      <h3>Простой расчёт</h3>
      <div class="prop-block">
        <label class="prop-field"><span>${byLevels ? 'Высота подъёма (по этажам), мм' : 'Высота этажа, мм'}</span>
          <input id="floorH" type="number" step="50" min="2000" value="${c.floorH}" ${byLevels ? 'readonly' : ''}></label>
        <div class="prop-row"><span>Подступенков</span><strong>${c.risers}</strong></div>
        <div class="prop-row"><span>Проступей</span><strong>${c.treads}</strong></div>
        <div class="prop-row"><span>Высота ступени</span><strong class="${c.okRiser ? '' : 'bad'}">${Math.round(c.riserH)} мм</strong></div>
        <div class="prop-row"><span>Глубина проступи</span><strong class="${c.okTread ? '' : 'bad'}">${Math.round(c.treadD)} мм</strong></div>
        <div class="prop-row"><span>Формула удобства</span><strong class="${c.okComfort ? '' : 'bad'}">${Math.round(c.comfort)} мм</strong></div>
        <p class="empty-hint">${comfortable ? '✓ Размеры лестницы удобные.' : 'Нажмите «Подогнать автоматически» — размеры станут удобными.'} Норма: ступень 150–190, проступь 230–340 мм.</p>
      </div>
      ${stairParamsBlock(item, c)}`;
  }
  panel.innerHTML = `
    <h2>${itemTitle(item.kind)}</h2>
    ${fixed ? '<p class="subtitle">Размер определяется модулями.</p>' : item.comp ? '<p class="subtitle">Размеры столешницы</p>' : ''}
    <div class="prop-block">
      <div class="prop-grid">
        <label class="prop-field"><span>${isStairs ? 'Габарит по X, мм' : fixed ? 'Общая ширина, мм' : 'Ширина, мм'}</span><input id="itemW" type="number" step="50" min="200" value="${item.w}" ${fixed ? 'readonly' : ''}></label>
        <label class="prop-field"><span>${isStairs ? 'Габарит по Y, мм' : fixed ? 'Общая глубина, мм' : 'Глубина, мм'}</span><input id="itemH" type="number" step="50" min="200" value="${item.h}" ${fixed ? 'readonly' : ''}></label>
      </div>
      <div class="prop-row"><span>Поворот</span><strong>${item.rotation || 0}°</strong></div>
      ${isStairs || !AUTO_LAYOUT_AVAILABLE ? '' : `<label class="check-row"><input id="itemAutoLayoutLocked" type="checkbox" ${item.autoLayoutLocked ? 'checked' : ''}>
        <span>Закрепить при авторасстановке</span></label>`}
    </div>
    ${stairsBlock}
    ${compositeSection(item)}
    ${ergoItemSection(item)}`;
  const applySize = () => {
    if (fixed) return; // диван-конструктор: размер — по модулям
    const w = Math.max(200, Number(panel.querySelector('#itemW').value) || item.w);
    const h = Math.max(200, Number(panel.querySelector('#itemH').value) || item.h);
    mutate(() => {
      item.w = w; item.h = h;
      // Лестница раскладывается по новому габариту (ступени по маршам — свои).
      if (isStairs) Object.assign(item, materializeStair(item, activeLevel(state.project)?.height || 3000));
      if (isStairs) fitStairRoom(item);
    });
    if (isStairs || item.comp) selectObject({ type: 'item', id: item.id });
  };
  panel.querySelector('#itemW').addEventListener('change', applySize);
  panel.querySelector('#itemH').addEventListener('change', applySize);
  panel.querySelector('#itemAutoLayoutLocked')?.addEventListener('change', (e) => {
    mutate(() => {
      if (e.target.checked) item.autoLayoutLocked = true;
      else delete item.autoLayoutLocked;
    });
    selectObject({ type: 'item', id: item.id });
  });
  const fh = panel.querySelector('#floorH');
  if (fh && !fh.readOnly) fh.addEventListener('change', (e) => {
    mutate(() => {
      applyStairPreset(item, stairShape(item), Math.max(2000, Number(e.target.value) || 3000));
      fitStairRoom(item);
      reconcileOpenings();
    });
    selectObject({ type: 'item', id: item.id });
  });
  panel.querySelectorAll('[data-stair-shape]').forEach((button) => {
    button.addEventListener('click', () => {
      mutate(() => {
        applyStairPreset(item, button.dataset.stairShape, item.floorHeight || activeLevel(state.project)?.height || 3000);
        fitStairRoom(item);
        reconcileOpenings();
      });
      selectObject({ type: 'item', id: item.id });
    });
  });
  panel.querySelector('#stairBuild')?.addEventListener('change', (e) => {
    mutate(() => { item.stairBuild = e.target.value; delete item.stairStyle; });
    selectObject({ type: 'item', id: item.id });
  });
  for (const [id, field] of [['stairEnvironment', 'stairEnvironment'], ['stairMaterial', 'stairMaterial'], ['stairRailing', 'stairRailing']]) {
    panel.querySelector(`#${id}`)?.addEventListener('change', (e) => {
      mutate(() => { item[field] = e.target.value; delete item.stairStyle; });
      selectObject({ type: 'item', id: item.id });
    });
  }
  panel.querySelector('#stairFit')?.addEventListener('click', () => {
    mutate(() => {
      applyStairPreset(item, stairShape(item), item.floorHeight || activeLevel(state.project)?.height || 3000);
      fitStairRoom(item);
      reconcileOpenings();
    });
    selectObject({ type: 'item', id: item.id });
    toast('Лестница подогнана под высоту этажа');
  });
  if (isStairs) bindStairParams(panel, item);
  if (isStairs) bindStairLevel(panel, item);
  bindCompositeSection(panel, item);
  bindErgoItemSection(panel, item);
}

// «Ведёт на этаж»: следующий (по умолчанию), выбранный этаж выше или никуда.
// Явный этаж — высота подъёма по разнице отметок (core/slab-openings.js); над
// лестницей в перекрытии — авто-проём.
function stairLevelBlock(item) {
  const project = state.project;
  const own = activeLevel(project);
  const above = [...project.levels].filter((l) => l.elevation > own.elevation + 1).sort((a, b) => a.elevation - b.elevation);
  const target = stairTargetLevel(project, item, own);
  const value = item.toLevel === 'none' ? 'none' : item.toLevel && above.some((l) => l.id === item.toLevel) ? item.toLevel : '';
  const next = above[0];
  const rise = stairRiseByLevels(project, item, own);
  const hole = target ? slabOpenings(project, target.id).find((o) => o.stairId === item.id) : null;
  const fmt = (mm) => (mm / 1000).toFixed(2).replace('.', ',');
  const opts = [
    `<option value="" ${value === '' ? 'selected' : ''}>${next ? `Следующий: ${escapeHtml(next.name)}` : 'Следующий (этажа выше нет)'}</option>`,
    ...above.map((l) => `<option value="${l.id}" ${value === l.id ? 'selected' : ''}>${escapeHtml(l.name)} · +${fmt(l.elevation - own.elevation)} м</option>`),
    `<option value="none" ${value === 'none' ? 'selected' : ''}>Никуда (без проёма)</option>`,
  ];
  let hint;
  if (!target) hint = above.length ? 'Проём в перекрытии не делается.' : 'Добавьте этаж сверху («+» у этажей) — над лестницей появится проём в перекрытии.';
  else {
    const mode = hole ? (hole.auto ? ' — авто по лестнице' : ' — изменён вручную') : '';
    hint = `Подъём ${Math.round(rise)} мм${item.toLevel ? ' — по отметкам этажей' : ''}. Проём в перекрытии на «${escapeHtml(target.name)}»${mode}.`;
  }
  return `
      <h3>Ведёт на этаж</h3>
      <div class="prop-block">
        <label class="prop-field"><span>Куда ведёт</span>
          <select id="stairToLevel">${opts.join('')}</select></label>
        <p class="empty-hint" id="stairToLevelHint">${hint}</p>
        ${hole ? '<button id="stairShowHole" type="button">Показать проём на этаже выше</button>' : ''}
      </div>`;
}

function bindStairLevel(panel, item) {
  panel.querySelector('#stairToLevel')?.addEventListener('change', (e) => {
    const v = e.target.value;
    mutate(() => {
      if (v) item.toLevel = v; else delete item.toLevel;
      const own = activeLevel(state.project);
      // Явный этаж: подъём по отметкам — ступени и подступенки пересчитаются.
      const rise = v && v !== 'none' ? stairRiseByLevels(state.project, item, own) : null;
      if (rise) setStairRise(item, rise, own?.height || 3000);
      fitStairRoom(item);
      reconcileOpenings();
    });
    selectObject({ type: 'item', id: item.id });
  });
  panel.querySelector('#stairShowHole')?.addEventListener('click', () => {
    const target = stairTargetLevel(state.project, item, activeLevel(state.project));
    const hole = target && slabOpenings(state.project, target.id).find((o) => o.stairId === item.id);
    if (!hole) return;
    switchLevel(target.id);
    selectObject({ type: 'slab', levelId: target.id, id: hole.id });
  });
}

// Параметры лестницы числами: ширина марша, проступь, подъёмы, ступени по
// маршам (сумма сохраняется — разница уходит в соседний марш), площадки.
const STAIR_PARAM_TITLES = {
  width: 'Ширина марша, мм', going: 'Проступь, мм', depth: 'Глубина площадки, мм', gap: 'Зазор между маршами, мм',
  l0w: 'Площадка 1: по X, мм', l0h: 'Площадка 1: по Y, мм', l1w: 'Площадка 2: по X, мм', l1h: 'Площадка 2: по Y, мм',
};
function stairParamsBlock(item, c) {
  const fh = activeLevel(state.project)?.height || 3000;
  const field = (key) => {
    const flight = /^n:(\d)$/.exec(key);
    const title = flight ? `Ступеней в марше ${Number(flight[1]) + 1}` : STAIR_PARAM_TITLES[key];
    const v = stairParamValue(item, key, fh);
    const bad = (key === 'width' && !c.okWidth) || (key === 'going' && !c.okTread) || (flight && !c.okFlights);
    return `<label class="prop-field"><span>${title}</span><input data-stair-param="${key}" class="${bad ? 'bad' : ''}" type="number" step="${flight ? 1 : 10}" min="${flight ? 1 : 0}" value="${Math.round(v)}"></label>`;
  };
  const keys = stairParamKeys(c.shape);
  return `
      <h3>Марши и площадки</h3>
      <div class="prop-block stair-params">
        <div class="prop-grid">
          ${field('width')}${field('going')}
          <label class="prop-field"><span>Подъёмов</span><input data-stair-param="risers" type="number" step="1" min="3" value="${c.risers}"></label>
          ${keys.filter((k) => /^n:/.test(k)).map(field).join('')}
          ${keys.filter((k) => !['width', 'going'].includes(k) && !/^n:/.test(k)).map(field).join('')}
        </div>
        ${c.warnings.length ? `<ul class="stair-warn">${c.warnings.map((w) => `<li>${escapeHtml(w)}</li>`).join('')}</ul>` : ''}
        <p class="empty-hint">На плане: круг с числом у конца марша — ступени (сумма не меняется), ромб — ширина марша, квадрат — угол площадки. Shift — без шага.</p>
      </div>`;
}

function bindStairParams(panel, item) {
  panel.querySelectorAll('[data-stair-param]').forEach((input) => {
    input.addEventListener('change', (e) => {
      const v = Number(e.target.value);
      if (!Number.isFinite(v)) return;
      mutate(() => {
        setStairParam(item, e.target.dataset.stairParam, v, activeLevel(state.project)?.height || 3000);
        fitStairRoom(item);
        reconcileOpenings();
      });
      selectObject({ type: 'item', id: item.id });
    });
  });
}

function renderMultiProps(panel, sel) {
  panel.innerHTML = `
    <h2>Выделено</h2>
    <div class="prop-block">
      <div class="prop-row"><span>Комнат</span><strong>${sel.roomIds.length}</strong></div>
      <div class="prop-row"><span>Мебели</span><strong>${sel.itemIds.length}</strong></div>
      ${sel.wallIds?.length ? `<div class="prop-row"><span>Ручных стен</span><strong>${sel.wallIds.length}</strong></div>` : ''}
    </div>
    <p class="empty-hint desktop-selection-hint">Shift + клик меняет состав выделения.</p>`;
}
