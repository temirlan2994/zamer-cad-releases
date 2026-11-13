// Правая панель свойств: проект, комната, стена, проём, мебель, группа.

import { elevationView, isElevationOpen, refreshElevationView } from './elevation-view.js';
import { findView } from '../core/views.js';
import { renderSectionProps } from './plan-section.js';
import { renderSlabProps } from './slab-ui.js';
import { slabOpenings, stairRiseByLevels, stairTargetLevel } from '../core/slab-openings.js';
import { massById, renderMassProps } from './masses.js';
import { bindRoomRoof, renderRoofProps, roofById, roomRoofHtml } from './roofs.js';
import { gridById, renderGridProps, renderGridToolOptions } from './grids.js';
import { furnitureDef, isShaft, roomType, roomTypesByCategory } from '../core/catalog.js';
import { itemTitle, itemsInRoom } from '../core/furnish.js';
import { activeLevel, roomById } from '../core/model.js';
import { SP55 } from '../core/norms.js';
import { MIN_ROOM_SIZE, MIN_SHAFT_SIZE, roomNetAreaM2 } from '../core/rooms.js';
import {
  DOOR_TYPES, WALL_T_MAX, WALL_T_MIN, WINDOW_TYPES, deriveWalls, openingFrame, openingPos, openingRect,
  setOpeningPos, wallClassThickness,
} from '../core/walls.js';
import { moveManualWall, setManualWallJustify, setWallHeight } from '../core/wall-manual.js';
import { roomShapeArea } from '../core/room-shape.js';
import { fitOpeningOffset } from '../core/opening-spacing.js';
import { setWallDefaults } from '../core/wall-thickness.js';
import { escapeHtml, refs, toast } from './dom.js';
import { findWall } from './hit.js';
import { deleteLevel, switchLevel } from './levels.js';
import { syncMobileBar } from './mobile.js';
import { renderTepPanel } from './props-tep.js';
import {
  activeViewTitle, bindViewSettings, renderViewsPanel, viewSettingsHtml,
} from './props-views.js';
import { renderSheetProps, renderSheetsPanel } from './props-sheets.js';
import { refreshSheetView } from './sheet-view.js';
import { renderToolstrip } from './toolstrip.js';
import {
  addFurniture, changeManualWall, changeWallKind, changeWallThickness, eatOverlapsAfter, overlappingTopRooms,
  reconcileOpenings,
} from './plan-actions.js';
import {
  bindBuildingRotation, buildingRotationField, renderSiteObjectProps, renderSiteSettings,
} from './props-site.js';
import { resizeVerdict } from './snap.js';
import {
  STAIR_BUILDS, STAIR_SHAPES, applyStairPreset, stairBuild, materializeStair, setStairParam, setStairRise, stairCalculation, stairParamKeys, stairParamValue, stairShape,
} from '../core/stairs.js';
import { presetWithType } from '../core/opening-preset.js';
import { requestDraw } from './view.js';
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
import { is3dOpen } from './view3d.js';
import { bindWallPinBlock, wallPinBlock } from './grid-pin-ui.js';

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
  // Параметры двери/окна до вставки — в строке параметров над холстом (renderToolOptions).
  if (state.modeName === 'landscape' && (!sel || sel.type === 'landscape')) {
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
    const roof = roofById(sel.id);
    if (roof) { renderRoofProps(panel, roof); return; }
  }
  if (sel.type === 'slab' && renderSlabProps(panel, sel)) return;
  if (sel.type === 'section') {
    const view = findView(state.project, sel.id);
    if (view?.kind === 'section') { renderSectionProps(panel, view); return; }
  }
  renderProjectProps(panel);
}

const landscapeToolActive = () => ['ls-section', 'draw-landscape', 'ls-array'].includes(state.tool?.kind);

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
  return activeLevel(state.project).height - SP55.slab;
}

function renderElevationProps(panel) {
  panel.innerHTML = `
    <h2 id="viewPropsTitle">Вид: ${escapeHtml(activeViewTitle())}</h2>
    <p class="subtitle">${elevationView()?.kind === 'section' ? 'Разрез' : 'Фасад'} · свойства вида</p>
    ${viewSettingsHtml()}`;
  bindViewSettings(panel, renderProps);
}

function renderProjectProps(panel) {
  const rooms = state.project.rooms;
  const site = state.project.site;
  const hasSite = Boolean(site?.boundary?.length || site?.underlay);
  const level = activeLevel(state.project);
  const multi = state.project.levels.length > 1;
  // Ничего не выбрано: подсказка, а настройки проекта — свёрнутой секцией
  // «Проект» внизу (раскрыта ли — помнится, пока открыта вкладка).
  const prev = panel.querySelector('#projectSection');
  if (prev) projectOpen = prev.open; // событие toggle приходит позже — читаем сразу
  panel.innerHTML = `
    <h2 id="viewPropsTitle">Вид: ${escapeHtml(activeViewTitle())}</h2>
    <p class="subtitle">${is3dOpen() ? '3D-вид дома' : 'План этажа'} · свойства вида</p>
    ${viewSettingsHtml()}
    <div class="props-empty">
      <p class="empty-hint">Ничего не выбрано. Кликните помещение, стену, проём или мебель на плане — здесь будут их свойства.</p>
      ${rooms.length ? '<p class="empty-hint">Площади и экспликация — вкладка «ТЭП».</p>' : `
      <p class="empty-hint">Начните с инструмента «Помещение» слева: тип комнаты из библиотеки — и клик на плане. Комнаты стыкуются сами; маленькая внутри большой — вложится и отнимет площадь.</p>`}
    </div>
    <details class="project-section" id="projectSection"${projectOpen ? ' open' : ''}>
    <summary id="projectSummary">Проект <small>поворот, единицы, стены, этаж</small></summary>
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
      <p class="empty-hint">Наружные стены без своей толщины меняются сразу. Новая перегородка — для новых стыковок: уже построенные сохраняют свою толщину.</p>
    </div>
    <h3>Этаж</h3>
    <div class="prop-block">
      <label class="prop-field"><span>Название</span><input id="levelName" value="${escapeHtml(level.name)}"></label>
      <div class="prop-grid">
        <label class="prop-field"><span>Отметка пола, м</span>
          <input id="levelElev" type="number" step="0.05" value="${(level.elevation / 1000).toFixed(2)}"></label>
        <label class="prop-field"><span>Высота этажа, м</span>
          <input id="levelHeight" type="number" step="0.05" min="2" value="${(level.height / 1000).toFixed(2)}"></label>
      </div>
      ${multi ? '<button id="deleteLevel" class="danger">Удалить этаж</button>' : '<p class="empty-hint">Второй этаж — кнопка «+» внизу слева на плане.</p>'}
    </div>
    </details>`;
  panel.querySelector('#projectSection').addEventListener('toggle', (e) => { projectOpen = e.target.open; });
  bindViewSettings(panel, renderProps);
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
    mutate(() => { level.height = Math.max(2000, Math.round((Number(e.target.value) || 3) * 1000)); });
  });
  panel.querySelector('#deleteLevel')?.addEventListener('click', () => deleteLevel(level.id));
}

// Тип помещения — список по категориям (optgroup). Шахта — вертикальный
// проём, а не помещение: в шахту и из шахты тип не меняется.
function roomTypeSelect(room, shaft) {
  const groups = roomTypesByCategory().map((g) => {
    const opts = g.types.filter((t) => Boolean(t.shaft) === shaft)
      .map((t) => `<option value="${t.type}" ${t.type === room.type ? 'selected' : ''}>${escapeHtml(t.title)}</option>`).join('');
    return opts ? `<optgroup label="${escapeHtml(g.title)}">${opts}</optgroup>` : '';
  }).join('');
  const unknown = roomType(room.type) ? '' : `<option value="${escapeHtml(room.type)}" selected>${escapeHtml(room.type)}</option>`;
  return `<label class="prop-field"><span>Тип</span><select id="roomType" ${shaft ? 'disabled' : ''}>${unknown}${groups}</select></label>`;
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
  const def = roomType(room.type);
  const shaft = isShaft(room);
  const minRoomSize = shaft ? MIN_SHAFT_SIZE : MIN_ROOM_SIZE;
  const parent = room.parentId ? roomById(state.project, room.parentId) : null;
  const rejected = state.rejected.get(room.id) || [];
  const insideCount = itemsInRoom(state.project, room).length;
  // Ширина/глубина — по номиналу (полная форма блока), площадь, мебель,
  // нормы и ТЭП — по видимой форме (комната моста = результат carve).
  const nominal = nominalShape(room);
  const eaten = Boolean(room.eatBase?.base);

  const furnitureRows = (def?.furniture || []).map((entry) => {
    const fd = furnitureDef(entry.kind);
    return `<div class="add-row">
      <span>${fd.title}</span><em>${fd.w}×${fd.h}</em>
      <button class="add-btn" data-add="${entry.kind}" title="Добавить в центр комнаты">+</button>
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
          <span>${eats ? `съедает «${escapeHtml(o.name)}»` : `«${escapeHtml(o.name)}» съедает эту`}</span>
          <button class="link" data-swap="${o.id}">поменять</button>
        </div>`;
  }).join('')}
    </div>` : '';

  const rejectedHtml = rejected.length
    ? `<div class="rejected"><h4>Не удалось расставить</h4>${rejected.map((r) => `<p>⚠ ${r.reason}</p>`).join('')}</div>`
    : '';

  panel.innerHTML = `
    <h2>${def?.title || 'Комната'}${parent ? `<span class="badge">внутри «${escapeHtml(parent.name)}»</span>` : ''}</h2>
    <div class="prop-block">
      <label class="prop-field"><span>Название</span><input id="roomName" value="${escapeHtml(room.name)}"></label>
      ${roomTypeSelect(room, shaft)}
      <div class="prop-grid">
        <label class="prop-field"><span>Ширина, мм</span><input id="roomW" type="number" step="50" min="${minRoomSize}" value="${nominal.w}"></label>
        <label class="prop-field"><span>Глубина, мм</span><input id="roomH" type="number" step="50" min="${minRoomSize}" value="${nominal.h}"></label>
      </div>
      ${eaten ? '<p class="empty-hint" id="roomNominalHint">Размеры — полной формы блока; площадь — видимой части (без съеденного соседями).</p>' : ''}
      ${shaft ? '' : `<label class="prop-field"><span>Высота потолка, м (пусто — по этажу)</span>
        <input id="roomCeil" type="number" step="0.05" min="2" placeholder="${(defaultCeiling() / 1000).toFixed(2)}" value="${room.ceiling ? (room.ceiling / 1000).toFixed(2) : ''}"></label>
      `}
      <div class="prop-row"><span>${shaft ? 'Площадь отверстия' : 'Площадь (чистая)'}</span><strong>${(shaft ? roomShapeArea(room) / 1_000_000 : roomNetAreaM2(state.project, room)).toFixed(2)} м²</strong></div>
    </div>
    ${areaControl}
    ${overlapControl}
    ${roomRailingsHtml(room)}
    ${shaft ? '' : roomRoofHtml(room)}
    ${shaft ? '<div class="prop-block"><p class="empty-hint">Вертикальный проём без пола. Стены шахты строятся на всю высоту этажа.</p></div>' : ''}
    ${shaft ? '' : `<h3>Мебель <span class="count-badge">${insideCount} шт.</span></h3>
    <div class="prop-block add-list">${furnitureRows || '<p class="empty-hint">Для этого типа нет набора</p>'}</div>`}
    ${rejectedHtml}
    ${shaft ? '' : '<div class="prop-actions"><button id="arrangeBtn">Расставить мебель автоматически</button></div>'}`;

  panel.querySelector('#roomName').addEventListener('change', (e) => {
    mutate(() => { room.name = e.target.value.trim() || room.name; });
  });
  bindRoomRoof(panel);
  bindRoomRailings(panel, room);
  panel.querySelector('#roomType')?.addEventListener('change', (e) => changeRoomType(room, e.target.value));
  // Размеры правят НОМИНАЛЬНУЮ форму (у съеденной — полную, до съедания):
  // номинал возвращается, правится, видимую форму заново даёт съедание
  // (core/v7/eat-bridge.js liftForEdit). Угол x/y номинала остаётся на месте.
  const applySize = () => {
    const w = Math.max(minRoomSize, Number(panel.querySelector('#roomW').value) || nominal.w);
    const h = Math.max(minRoomSize, Number(panel.querySelector('#roomH').value) || nominal.h);
    if (w === nominal.w && h === nominal.h) return;
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
    pushHistory(before);
    afterChange();
  };
  panel.querySelector('#roomW').addEventListener('change', applySize);
  panel.querySelector('#roomH').addEventListener('change', applySize);
  panel.querySelector('#roomCeil')?.addEventListener('change', (e) => {
    const v = Number(String(e.target.value).replace(',', '.'));
    mutate(() => { room.ceiling = v >= 2 ? Math.round(v * 1000) : null; });
  });
  panel.querySelectorAll('[data-add]').forEach((btn) => {
    btn.addEventListener('click', () => addFurniture(btn.dataset.add, room));
  });
  panel.querySelector('#arrangeBtn')?.addEventListener('click', () => {
    mutate(() => {}, { arrange: [room.id] });
    const problems = state.rejected.get(room.id) || [];
    toast(problems.length ? 'Расставлено, но есть замечания — смотрите панель' : 'Мебель расставлена');
    selectObject({ type: 'room', id: room.id });
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
    <p class="subtitle">${subtitle}</p>
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
    <p class="empty-hint">${wall.kind === 'shared'
    ? 'Тип и скрытие — только у выделенного участка. Толщина общей стены — зазор между комнатами: меняется для пары, соседняя комната (и всё за ней) сдвигается, стыковка сохраняется.'
    : 'Толщина, тип и скрытие меняются только у выделенного участка. Смена типа даёт толщину этого класса, если толщина не задавалась вручную.'}</p>
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
  panel.innerHTML = `
    <h2>Стена</h2>
    <p class="subtitle">Ручная стена · ${wall.orient === 'h' ? 'горизонтальная' : 'вертикальная'}</p>
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
      <label class="prop-field"><span>Сдвинуть ось на, мм (${wall.orient === 'h' ? '+ вниз' : '+ вправо'})</span>
        <input id="wallShift" type="number" step="10" value="0"></label>
      <label class="prop-field"><span>Высота, мм (пусто — по этажу, ${levelH})</span>
        <input id="wallH" type="number" step="50" min="100" value="${height}"></label>
    </div>
    <p class="empty-hint">Тяните стену — сдвиг, круглые ручки на концах — длина. Примыкающие ручные стены едут вместе. Del — удалить вместе с проёмами.</p>
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
  const glass = isDoor
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
  const sample = { kind: tool.openKind, ...preset };
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
        <label class="prop-field"><span>Ширина, мм</span>
          <input id="presetW" type="number" step="50" min="300" value="${preset.width}"></label>
        <label class="prop-field"><span>Высота, мм</span>
          <input id="presetH" type="number" step="50" min="300" value="${preset.height}"></label>
      </div>
      ${isDoor ? '' : `<label class="prop-field"><span>Отступ от пола (подоконник), мм</span>
        <input id="presetSill" type="number" step="50" min="0" value="${preset.sill}"></label>`}
    </div>`;
  // Библиотека проёмов подсвечивает карточку по новым параметрам.
  const save = (next) => { Object.assign(preset, next); renderPlaceOpeningProps(panel, compact); renderOpeningLibrary(); requestDraw(); };
  panel.querySelector('#presetType').addEventListener('change', (e) => {
    save(presetWithType(tool.openKind, preset, e.target.value, activeLevel(state.project).height));
  });
  panel.querySelector('#presetW').addEventListener('change', (e) => save({ width: Math.max(300, Number(e.target.value) || preset.width) }));
  panel.querySelector('#presetH').addEventListener('change', (e) => save({ height: Math.max(300, Number(e.target.value) || preset.height) }));
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
    phoneQuery()?.addEventListener?.('change', placeCanvasHint);
  }
  const t = state.tool;
  const furnLib = !t && state.libraryPinned && state.libraryTab === 'furniture' && state.modeName === 'plan';
  const roomLib = !t && state.libraryPinned && state.libraryTab === 'rooms' && state.modeName === 'plan';
  const key = t || (furnLib ? 'furn' : roomLib ? 'rooms' : null);
  if (!force && key === toolOptionsKey) return;
  toolOptionsKey = key;
  let html = '';
  if (t?.kind === 'place-opening') {
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
        <input id="toWallT" type="number" step="10" min="${WALL_T_MIN}" max="${WALL_T_MAX}" value="${Math.round(t.thickness)}"></label>`;
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
    body.querySelector('#toWallT').addEventListener('change', (e) => {
      const v = Math.round(Number(e.target.value));
      if (Number.isFinite(v) && v > 0) t.thickness = Math.min(WALL_T_MAX, Math.max(WALL_T_MIN, v));
      e.target.value = String(Math.round(t.thickness));
      requestDraw();
    });
  }
}

function renderOpeningProps(panel, opening) {
  if (!opening) { renderProjectProps(panel); return; }
  const room = roomById(state.project, opening.roomId);
  const isDoor = opening.kind === 'door';
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
    <h2>${isDoor ? 'Дверь' : 'Окно'}</h2>
    <p class="subtitle">${opening.host ? 'Ручная стена' : `Стена «${room?.name}»`}</p>
    <div class="elev-wrap">${elevationSVG(opening)}</div>
    <div class="prop-block">
      <label class="prop-field"><span>Тип</span>
        <select id="openType">${Object.entries(isDoor ? DOOR_TYPES : WINDOW_TYPES).map(([id, title]) => `
          <option value="${id}" ${(opening.type || (isDoor ? 'single' : 'standard')) === id ? 'selected' : ''}>${title}</option>`).join('')}
        </select></label>
      <div class="prop-grid">
        <label class="prop-field"><span>Ширина, мм</span>
          <input id="openW" type="number" step="50" min="300" value="${opening.width}"></label>
        <label class="prop-field"><span>Высота, мм</span>
          <input id="openH" type="number" step="50" min="300" value="${opening.height || (isDoor ? 2100 : 1500)}"></label>
      </div>
      ${isDoor ? '' : `<label class="prop-field"><span>Отступ от пола (подоконник), мм</span>
        <input id="openSill" type="number" step="50" min="0" value="${opening.sill || 0}"></label>`}
    </div>
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
    </div>
    ${isDoor ? '<p class="empty-hint">Петли и направление открывания меняются в единой панели над планом.</p>' : ''}`;

  const commitOpening = (fn) => {
    mutate(fn);
    selectObject({ type: 'opening', id: opening.id });
  };
  panel.querySelector('#openW').addEventListener('change', (e) => {
    const width = Math.max(300, Number(e.target.value) || opening.width);
    commitOpening(() => {
      opening.width = width;
      const clamped = fitOpeningOffset(state.project, opening, deriveWalls(state.project), openingPos(opening));
      if (clamped !== null) setOpeningPos(opening, clamped);
      else toast('Проём шире свободного участка стены (с зазором 100 мм до соседних) — уменьшите ширину');
    });
  });
  panel.querySelector('#openType').addEventListener('change', (e) => {
    const type = e.target.value;
    commitOpening(() => {
      opening.type = type;
      if (!isDoor) {
        // Панорамное — почти от пола и выше; обычное — подоконник 900, 1500.
        const top = activeLevel(state.project).height - 400;
        if (type === 'panoramic') { opening.sill = 100; opening.height = Math.min(2400, top - 100); }
        else { opening.sill = 900; opening.height = Math.min(1500, top - 900); }
      } else if (type === 'double' && opening.width < 1200) {
        opening.width = 1200; // двустворчатой нужна ширина
      }
    });
  });
  panel.querySelector('#openH').addEventListener('change', (e) => {
    commitOpening(() => { opening.height = Math.max(300, Number(e.target.value) || opening.height); });
  });
  const sillInput = panel.querySelector('#openSill');
  if (sillInput) sillInput.addEventListener('change', (e) => commitOpening(() => { opening.sill = Math.max(0, Number(e.target.value) || 0); }));

  const setByGap = (fromLeft) => (e) => {
    if (!wall || !frame) return;
    const value = Math.max(0, Number(e.target.value) || 0);
    const along = fromLeft ? wall.from + opening.width / 2 + value : wall.to - opening.width / 2 - value;
    const desired = (along - frame.base) * frame.dir;
    commitOpening(() => {
      const clamped = fitOpeningOffset(state.project, opening, deriveWalls(state.project), desired);
      if (clamped !== null) setOpeningPos(opening, clamped);
      else toast('Сюда проём не помещается: мало места или налезает на соседний проём');
    });
  };
  if (leftGap !== null) panel.querySelector('#gapL').addEventListener('change', setByGap(true));
  if (rightGap !== null) panel.querySelector('#gapR').addEventListener('change', setByGap(false));
  panel.querySelector('#openOff').addEventListener('change', (e) => {
    commitOpening(() => {
      const clamped = fitOpeningOffset(state.project, opening, deriveWalls(state.project), Number(e.target.value) || openingPos(opening));
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
    stairsBlock = `
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
    <p class="subtitle">${isStairs ? 'Выберите форму — размеры и ступени рассчитаются автоматически. Стрелка показывает подъём.' : fixed && item.comp?.type === 'kitchen' ? 'Кухня-конструктор: форма, длины и элементы — ниже; элементы тянутся на плане' : fixed ? 'Собирается из модулей: «+» на концах дивана или список ниже' : item.comp ? 'Размер — столешница; стулья расставляются по сторонам сами' : 'Свободный объект: перетаскивается куда угодно, едет вместе с комнатой'}</p>
    <div class="prop-block">
      <div class="prop-grid">
        <label class="prop-field"><span>${isStairs ? 'Габарит по X, мм' : fixed ? 'Общая ширина, мм' : 'Ширина, мм'}</span><input id="itemW" type="number" step="50" min="200" value="${item.w}" ${fixed ? 'readonly' : ''}></label>
        <label class="prop-field"><span>${isStairs ? 'Габарит по Y, мм' : fixed ? 'Общая глубина, мм' : 'Глубина, мм'}</span><input id="itemH" type="number" step="50" min="200" value="${item.h}" ${fixed ? 'readonly' : ''}></label>
      </div>
      <div class="prop-row"><span>Поворот</span><strong>${item.rotation || 0}°</strong></div>
    </div>
    ${stairsBlock}
    ${compositeSection(item)}
    ${ergoItemSection(item)}
    <p class="empty-hint">Копирование, поворот, отражение и удаление — в единой панели над планом.</p>`;
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
    mutate(() => { item.stairBuild = e.target.value; });
    selectObject({ type: 'item', id: item.id });
  });
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
    </div>
    <p class="empty-hint">Shift-клик добавляет или убирает объект. Все действия с выделением находятся в панели над планом.</p>`;
}
