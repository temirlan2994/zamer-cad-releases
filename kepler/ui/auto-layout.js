// Интерфейс многовариантной авторасстановки мебели.
//
// Поиск никогда не меняет проект: варианты лежат в эфемерном кеше
// state.layoutVariants. Проект меняется только по кнопке «Применить» через
// store.mutate(), поэтому вся расстановка отменяется одним Ctrl+Z.
// Автоматическая перестройка после изменения формы вызывается редактором
// через arrangeRoomsNow(); эта функция намеренно не создаёт историю сама.

import {
  applyFurnitureLayout, generateFurnitureLayouts, validateFurnitureLayout,
} from '../core/autolayout.js';
import { defaultItemsFor, itemsInRoom } from '../core/furnish.js';
import { furnitureDef } from '../core/catalog.js';
import {
  ensureLayoutBrief, layoutBriefReadiness,
} from '../core/layout-brief.js';
import { projectToLayoutInput } from '../core/layout-contract.js';
import { LAYOUT_SCENARIOS } from '../core/layout-knowledge.generated.js';
import {
  cloneProject, levelProject, makeId, roomById,
} from '../core/model.js';
import { deriveWalls } from '../core/walls.js';
import { escapeHtml, toast } from './dom.js';
import {
  LayoutSolveCancelledError, LayoutWorkerClient, StaleLayoutResultError,
} from './layout-worker-client.js';
import { state } from './state.js';
import {
  bindWholeHomeLayout, invalidateWholeHomeVariants, wholeHomeLayoutHtml,
} from './whole-home-layout.js';

const COUNT = 3;
const roomWorkerClient = new LayoutWorkerClient();
const roomTasks = new Map();

function cache() {
  // Старое состояние страницы может жить во вкладке во время обновления
  // модулей. Ленивая инициализация не ломает такие сессии и тесты ядра.
  if (!(state.layoutVariants instanceof Map)) state.layoutVariants = new Map();
  return state.layoutVariants;
}

const cleanNumber = (value) => (Number.isFinite(Number(value)) ? Math.round(Number(value) * 1000) / 1000 : null);

function itemSignature(item) {
  return {
    id: item.id,
    kind: item.kind,
    x: cleanNumber(item.x), y: cleanNumber(item.y),
    w: cleanNumber(item.w), h: cleanNumber(item.h),
    rotation: cleanNumber(item.rotation || 0),
    comp: item.comp || null,
    autoLayoutLocked: item.autoLayoutLocked === true,
    manufacturer: item.manufacturer || null,
    sku: item.sku || null,
    sourceUrl: item.sourceUrl || null,
    geometryStatus: item.geometryStatus || null,
    manualStatus: item.manualStatus || null,
    manualConstraints: item.manualConstraints || null,
  };
}

// Сигнатура только тех данных, которые влияют на расстановку. Она не даёт
// применить вариант после правки комнаты, проёма или мебели.
export function layoutSignature(project, room) {
  if (!project || !room) return '';
  const children = project.rooms
    .filter((candidate) => candidate.parentId === room.id)
    .map((candidate) => ({
      id: candidate.id, x: candidate.x, y: candidate.y, w: candidate.w, h: candidate.h,
      outline: candidate.outline || null, notch: candidate.notch || null,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
  const openings = (project.openings || []).map((opening) => ({
    id: opening.id, kind: opening.kind, roomId: opening.roomId || null,
    host: opening.host || null, side: opening.side ?? null, offset: opening.offset ?? null,
    width: opening.width ?? null, height: opening.height ?? null, sill: opening.sill ?? null,
    hingeStart: opening.hingeStart ?? null, swingIn: opening.swingIn ?? null,
  })).sort((a, b) => a.id.localeCompare(b.id));
  const manualWalls = (project.walls || []).map((wall) => ({
    id: wall.id,
    axis: wall.axis || null,
    thickness: wall.thickness ?? null,
    justify: wall.justify || null,
    hidden: wall.hidden === true,
    roomBounding: wall.roomBounding !== false,
  })).sort((a, b) => String(a.id).localeCompare(String(b.id)));
  const solarContext = {
    building: project.building || null,
    settings: {
      exterior: project.settings?.exterior ?? null,
      wallsEngine: project.settings?.wallsEngine || null,
    },
    site: {
      north: project.site?.north ?? null,
      location: project.site?.location || null,
      solarVerified: project.site?.solarVerified === true,
      sun: project.site?.sun || null,
      norms: project.site?.norms || null,
      boundary: project.site?.boundary || null,
      neighbors: project.site?.neighbors || [],
    },
    levels: (project.levels || []).map((level) => ({
      id: level.id, elevation: level.elevation, height: level.height,
      rooms: level.rooms,
      openings: (level.openings || []).filter((opening) => opening.kind === 'window'),
      walls: level.walls || [],
      wallOverrides: level.wallOverrides || {},
    })),
  };
  const items = itemsInRoom(project, room).map(itemSignature).sort((a, b) => a.id.localeCompare(b.id));
  return JSON.stringify({
    room: {
      id: room.id, type: room.type, x: room.x, y: room.y, w: room.w, h: room.h,
      outline: room.outline || null, notch: room.notch || null, eatBase: room.eatBase || null,
    },
    children, openings, manualWalls, items, solarContext,
    layoutBrief: project.layoutBrief || null,
    partition: project.settings?.partition || 100,
  });
}

function layoutItems(project, room, itemIds = null) {
  if (itemIds == null) return itemsInRoom(project, room);
  const wanted = new Set(itemIds);
  return project.items.filter((item) => wanted.has(item.id));
}

function lockedIds(project, room, itemIds = null) {
  return layoutItems(project, room, itemIds).filter((item) => item.autoLayoutLocked === true).map((item) => item.id);
}

function seededTask(project, room) {
  const existing = itemsInRoom(project, room);
  if (existing.length) return { project, room, walls: state.walls, seedItems: [] };
  const seedItems = defaultItemsFor(room, { layoutBrief: project.layoutBrief });
  if (!seedItems.length) return { project, room, walls: state.walls, seedItems: [] };
  // Пустая комната получает типовой набор только в копии. В настоящий проект
  // он попадёт вместе с выбранным вариантом, а не во время предпросмотра.
  const copy = cloneProject(project);
  const copyRoom = roomById(copy, room.id);
  copy.items.push(...seedItems.map((item) => structuredClone(item)));
  return { project: copy, room: copyRoom, walls: deriveWalls(copy), seedItems };
}

async function findLayouts(project, room, onProgress = null) {
  const signature = layoutSignature(project, room);
  const task = seededTask(project, room);
  const locked = task.seedItems.length ? [] : lockedIds(task.project, task.room);
  const levelId = task.project.activeLevel;
  const solveTask = roomWorkerClient.startSolve({
    project: task.project,
    inputSignature: signature,
    scope: { kind: 'room', levelId, roomId: task.room.id },
    options: {
      count: COUNT,
      lockedIds: locked,
      beamWidth: 16,
      candidatesPerItem: 16,
      maxBasePoses: 72,
    },
    onProgress,
    getCurrentInputSignature: () => {
      const currentProject = state.project.activeLevel === levelId
        ? state.project : levelProject(state.project, levelId);
      const currentRoom = roomById(currentProject, room.id);
      return currentRoom ? layoutSignature(currentProject, currentRoom) : '';
    },
  });
  roomTasks.set(room.id, solveTask);
  let result;
  try {
    result = await solveTask.promise;
  } finally {
    if (roomTasks.get(room.id) === solveTask) roomTasks.delete(room.id);
  }
  const input = projectToLayoutInput(task.project, { lockedItemIds: locked });
  const record = {
    signature,
    result,
    contractUnknowns: input.unknown_inputs.length,
    seedItems: task.seedItems.map((item) => structuredClone(item)),
  };
  cache().set(room.id, record);
  return record;
}

function activeRecord(room) {
  const record = cache().get(room.id);
  if (!record) return null;
  if (record.signature !== layoutSignature(state.project, room)) {
    cache().delete(room.id);
    return null;
  }
  return record;
}

const metric = (value, suffix = '') => (value == null ? '—' : `${Math.round(value).toLocaleString('ru-RU')}${suffix}`);

function checksSummary(layout) {
  if (layout.ruleSummary) {
    return {
      passed: layout.ruleSummary.byStatus?.pass || 0,
      failed: layout.ruleSummary.byStatus?.fail || 0,
      unknown: layout.ruleSummary.unknown || 0,
      hardUnknown: layout.ruleSummary.hardUnknown?.length || 0,
      known: layout.ruleSummary.known || 0,
      applicable: layout.ruleSummary.applicable || 0,
    };
  }
  const checks = layout.checks || [];
  const passed = checks.filter((check) => check.status === 'pass').length;
  const failed = checks.filter((check) => check.status === 'fail').length;
  const unknown = checks.filter((check) => check.status === 'unknown').length + (layout.unknowns?.length || 0);
  return { passed, failed, unknown, hardUnknown: 0, known: passed + failed, applicable: passed + failed + unknown };
}

function variantsHtml(record) {
  if (!record) return '<p class="empty-hint auto-layout-hint">Нажмите «Подобрать варианты» — проект пока не изменится.</p>';
  const { result } = record;
  if (result.status !== 'feasible' || !result.layouts?.length) {
    const diagnostics = result.diagnostics?.length ? result.diagnostics : ['Подходящий вариант не найден'];
    return `<div class="auto-layout-empty" role="status">
      <strong>Не удалось подобрать расстановку</strong>
      ${diagnostics.slice(0, 4).map((text) => `<p>${escapeHtml(text)}</p>`).join('')}
    </div>`;
  }
  const coverage = result.coverage || {};
  return `<div class="layout-variants" aria-label="Варианты расстановки">
    <p class="empty-hint auto-layout-coverage">Полный реестр: ${coverage.total || 0} правил · привязано ${coverage.bound || 0}${record.contractUnknowns ? ` · входов для уточнения: ${record.contractUnknowns}` : ''}</p>
    ${result.layouts.map((layout, index) => {
    const checks = checksSummary(layout);
    return `<article class="layout-variant" data-layout-variant="${escapeHtml(layout.id)}">
        <div class="layout-variant-head">
          <strong>${index + 1}. ${escapeHtml(layout.label || 'Вариант')}</strong>
          <span>${Math.round(layout.score || 0)} баллов</span>
        </div>
        <div class="layout-metrics">
          <span title="Проверка маршрута круглым телом диаметром 600 мм">Проверен проход ${metric(layout.metrics?.routeWidthMm, ' мм')}</span>
          <span title="Среднее перемещение мебели">Сдвиг ${metric(layout.metrics?.averageMoveMm, ' мм')}</span>
          <span>По расчётным данным ${checks.known} из ${checks.applicable} применимых</span>
          ${checks.failed ? `<span>Компромиссов: ${checks.failed}</span>` : ''}
          ${checks.unknown ? `<span>Пока неизвестны: ${checks.unknown}${checks.hardUnknown ? `, обязательных ${checks.hardUnknown}` : ''}</span>` : ''}
        </div>
        <button type="button" data-layout-apply="${escapeHtml(layout.id)}">Применить вариант</button>
      </article>`;
  }).join('')}
  </div>`;
}

const MOBILITY_OPTIONS = [
  ['unknown', 'Неизвестно'], ['standard', 'Без особых требований'], ['child', 'Ребёнок'],
  ['wheelchair', 'Кресло-коляска'], ['walker', 'Ходунки'], ['crutches', 'Костыли'], ['custom', 'Другой профиль'],
];
const DATA_STATUS_OPTIONS = [
  ['unknown', 'Неизвестно'], ['declared', 'Со слов'], ['measured', 'Измерено'], ['assumed', 'Предположение'],
];
const ENGINEERING_OPTIONS = [
  ['outlet', 'Розетка'], ['power', 'Электропитание'], ['switch', 'Выключатель'],
  ['cold_water', 'Холодная вода'], ['hot_water', 'Горячая вода'], ['drain', 'Канализация'],
  ['gas', 'Газ'], ['vent_supply', 'Приток'], ['vent_return', 'Возврат воздуха'],
  ['vent_extract', 'Вытяжка'], ['radiator', 'Радиатор'], ['fireplace', 'Камин'], ['other', 'Другое'],
];
const STORAGE_FREQUENCY_OPTIONS = [
  ['unknown', 'Неизвестно'], ['daily', 'Ежедневно'], ['weekly', 'Еженедельно'],
  ['seasonal', 'Сезонно'], ['rare', 'Редко'],
];
const GEOMETRY_OPTIONS = [
  ['', 'Не проверена'], ['verified_sku', 'Проверенный SKU'],
  ['parametric_custom', 'Точные заказные размеры'], ['proxy', 'Условный габарит'],
];
const MANUAL_OPTIONS = [
  ['', 'Не проверен'], ['unknown', 'Данных нет'], ['verified', 'Паспорт проверен'], ['not_required', 'Зазоры не требуются'],
];
const UNCERTAINTY_OPTIONS = [
  ['unknown', 'Неизвестно'], ['assumed', 'Принято допущение'], ['bounded', 'Задан диапазон'], ['resolved', 'Уточнено'],
];
let layoutBriefOpen = false;
const layoutBriefSectionsOpen = new Set();

const briefSectionAttrs = (id) => `data-brief-section="${id}"${layoutBriefSectionsOpen.has(id) ? ' open' : ''}`;

function optionsHtml(options, value) {
  return options.map(([id, title]) => `<option value="${escapeHtml(id)}" ${id === value ? 'selected' : ''}>${escapeHtml(title)}</option>`).join('');
}

const fieldValue = (value) => escapeHtml(value == null ? '' : String(value));

function actorsEditorHtml(actors) {
  const rows = actors.map((actor) => `
    <div class="layout-brief-card" data-brief-actor="${escapeHtml(actor.id)}">
      <div class="layout-brief-card-head">
        <strong>${escapeHtml(actor.alias)}</strong>
        <button type="button" class="link danger" data-brief-action="remove-actor">Удалить</button>
      </div>
      <label class="prop-field"><span>Обозначение без ФИО</span>
        <input data-actor-field="alias" value="${fieldValue(actor.alias)}"></label>
      <label class="prop-field"><span>Мобильность</span>
        <select data-actor-field="mobilityProfile">${optionsHtml(MOBILITY_OPTIONS, actor.mobilityProfile)}</select></label>
      <div class="prop-grid">
        <label class="prop-field"><span>Рост, мм</span><input data-actor-field="heightMm" data-number type="number" min="400" step="10" value="${fieldValue(actor.heightMm)}"></label>
        <label class="prop-field"><span>Статус данных</span><select data-actor-field="dataStatus">${optionsHtml(DATA_STATUS_OPTIONS, actor.dataStatus)}</select></label>
        <label class="prop-field"><span>Габарит по ширине, мм</span><input data-actor-field="bodyWidthMm" data-number type="number" min="100" step="10" value="${fieldValue(actor.bodyWidthMm)}"></label>
        <label class="prop-field"><span>Габарит по глубине, мм</span><input data-actor-field="bodyDepthMm" data-number type="number" min="100" step="10" value="${fieldValue(actor.bodyDepthMm)}"></label>
      </div>
      <label class="prop-field"><span>Источник / примечание</span><input data-actor-field="sourceRef" value="${fieldValue(actor.sourceRef)}"></label>
    </div>`).join('');
  return `<details class="layout-brief-subsection" ${briefSectionAttrs('actors')}>
    <summary>Жильцы и мобильность <small>${actors.length || 'не задано'}</small></summary>
    <div class="layout-brief-stack">
      ${rows || '<p class="empty-hint">Состав семьи не выводится из комнат. Добавьте только функциональные обозначения, без ФИО и диагнозов.</p>'}
      <button type="button" data-brief-action="add-actor">+ Добавить жильца</button>
    </div>
  </details>`;
}

function engineeringEditorHtml(points, room) {
  const rows = (points || []).map((point) => `
    <div class="layout-brief-card" data-brief-engineering="${escapeHtml(point.id)}">
      <div class="layout-brief-card-head">
        <strong>${escapeHtml(ENGINEERING_OPTIONS.find(([id]) => id === point.kind)?.[1] || point.kind)}</strong>
        <button type="button" class="link danger" data-brief-action="remove-engineering">Удалить</button>
      </div>
      <label class="prop-field"><span>Тип</span><select data-engineering-field="kind">${optionsHtml(ENGINEERING_OPTIONS, point.kind)}</select></label>
      <div class="prop-grid">
        <label class="prop-field"><span>X, мм</span><input data-engineering-field="x" data-number type="number" step="10" value="${fieldValue(point.x)}"></label>
        <label class="prop-field"><span>Y, мм</span><input data-engineering-field="y" data-number type="number" step="10" value="${fieldValue(point.y)}"></label>
        <label class="prop-field"><span>Высота, мм</span><input data-engineering-field="zMm" data-number type="number" step="10" value="${fieldValue(point.zMm)}"></label>
        <label class="prop-field"><span>Зона доступа, мм</span><input data-engineering-field="clearanceMm" data-number type="number" min="0" step="10" value="${fieldValue(point.clearanceMm)}"></label>
      </div>
      <label class="prop-field"><span>Статус данных</span><select data-engineering-field="dataStatus">${optionsHtml(DATA_STATUS_OPTIONS, point.dataStatus)}</select></label>
      <label class="prop-field"><span>Источник</span><input data-engineering-field="sourceRef" value="${fieldValue(point.sourceRef)}"></label>
    </div>`).join('');
  const stateHint = points == null ? 'Не обследованы' : points.length ? `${points.length} точек` : 'Подтверждено: фиксированных точек нет';
  return `<details class="layout-brief-subsection" ${briefSectionAttrs('engineering')}>
    <summary>Инженерные точки <small>${stateHint}</small></summary>
    <div class="layout-brief-stack">
      ${rows || '<p class="empty-hint">Точка добавляется в центр текущей комнаты; затем задайте координаты и источник.</p>'}
      <div class="layout-brief-actions">
        <button type="button" data-brief-action="add-engineering">+ Точка в центре «${escapeHtml(room.name)}»</button>
        <button type="button" data-brief-action="no-engineering">Точек нет</button>
        <button type="button" class="link" data-brief-action="unknown-engineering">Не обследовано</button>
      </div>
    </div>
  </details>`;
}

function storageEditorHtml(inventory) {
  const rows = (inventory || []).map((entry) => `
    <div class="layout-brief-card" data-brief-storage="${escapeHtml(entry.id)}">
      <div class="layout-brief-card-head">
        <strong>${escapeHtml(entry.label || entry.category || 'Группа вещей')}</strong>
        <button type="button" class="link danger" data-brief-action="remove-storage">Удалить</button>
      </div>
      <div class="prop-grid">
        <label class="prop-field"><span>Название</span><input data-storage-field="label" value="${fieldValue(entry.label)}"></label>
        <label class="prop-field"><span>Категория</span><input data-storage-field="category" value="${fieldValue(entry.category)}"></label>
        <label class="prop-field"><span>Количество</span><input data-storage-field="count" data-number data-integer type="number" min="0" step="1" value="${fieldValue(entry.count)}"></label>
        <label class="prop-field"><span>Нужный объём, л</span><input data-storage-field="requiredVolumeLiters" data-number type="number" min="0" step="1" value="${fieldValue(entry.requiredVolumeLiters)}"></label>
      </div>
      <label class="prop-field"><span>Частота доступа</span><select data-storage-field="frequency">${optionsHtml(STORAGE_FREQUENCY_OPTIONS, entry.frequency)}</select></label>
      <label class="prop-field"><span>Статус данных</span><select data-storage-field="dataStatus">${optionsHtml(DATA_STATUS_OPTIONS, entry.dataStatus)}</select></label>
      <label class="prop-field"><span>Источник</span><input data-storage-field="sourceRef" value="${fieldValue(entry.sourceRef)}"></label>
    </div>`).join('');
  const stateHint = inventory == null ? 'неизвестен' : inventory.length ? `${inventory.length} групп` : 'подтверждено отсутствие';
  return `<details class="layout-brief-subsection" ${briefSectionAttrs('storage')}>
    <summary>Инвентарь хранения <small>${stateHint}</small></summary>
    <div class="layout-brief-stack">
      ${rows || '<p class="empty-hint">Пустой подтверждённый список отличается от ещё не собранных данных.</p>'}
      <div class="layout-brief-actions">
        <button type="button" data-brief-action="add-storage">+ Добавить группу</button>
        <button type="button" data-brief-action="no-storage">Хранить нечего</button>
        <button type="button" class="link" data-brief-action="unknown-storage">Неизвестно</button>
      </div>
    </div>
  </details>`;
}

function manualConstraint(item) {
  return (item.manualConstraints || []).find((constraint) => constraint.id === `${item.id}:clearances`)
    || (item.manualConstraints || []).find((constraint) => constraint.clearances) || null;
}

function manualsEditorHtml(room) {
  const items = itemsInRoom(state.project, room);
  const rows = items.map((item) => {
    const constraint = manualConstraint(item);
    const clearances = constraint?.clearances || {};
    return `<div class="layout-brief-card" data-brief-item="${escapeHtml(item.id)}">
      <div class="layout-brief-card-head"><strong>${escapeHtml(furnitureDef(item.kind)?.title || item.kind)}</strong><small>${Math.round(item.w)}×${Math.round(item.h)} мм</small></div>
      <div class="prop-grid">
        <label class="prop-field"><span>Производитель</span><input data-item-meta="manufacturer" value="${fieldValue(item.manufacturer)}"></label>
        <label class="prop-field"><span>SKU / модель</span><input data-item-meta="sku" value="${fieldValue(item.sku)}"></label>
      </div>
      <label class="prop-field"><span>Ссылка на карточку/паспорт</span><input data-item-meta="sourceUrl" value="${fieldValue(item.sourceUrl)}"></label>
      <div class="prop-grid">
        <label class="prop-field"><span>Геометрия</span><select data-item-meta="geometryStatus">${optionsHtml(GEOMETRY_OPTIONS, item.geometryStatus || '')}</select></label>
        <label class="prop-field"><span>Паспорт</span><select data-item-meta="manualStatus">${optionsHtml(MANUAL_OPTIONS, item.manualStatus || '')}</select></label>
      </div>
      <div class="layout-clearance-grid">
        ${[['frontMm', 'Спереди'], ['backMm', 'Сзади'], ['leftMm', 'Слева'], ['rightMm', 'Справа'], ['topMm', 'Сверху']]
    .map(([key, title]) => `<label class="prop-field"><span>${title}, мм</span><input data-item-clearance="${key}" type="number" min="0" step="10" value="${fieldValue(clearances[key])}"></label>`).join('')}
      </div>
      <label class="prop-field"><span>Источник зазоров (страница/раздел)</span><input data-item-manual-source value="${fieldValue(constraint?.sourceRef)}"></label>
    </div>`;
  }).join('');
  return `<details class="layout-brief-subsection" ${briefSectionAttrs('manuals')}>
    <summary>Модели и паспортные зазоры <small>${items.length || 'нет мебели'}</small></summary>
    <div class="layout-brief-stack">${rows || '<p class="empty-hint">В текущей комнате пока нет мебели.</p>'}</div>
  </details>`;
}

function uncertaintyEditorHtml(entries) {
  const rows = entries.map((entry) => `
    <div class="layout-brief-card" data-brief-uncertainty="${escapeHtml(entry.id)}">
      <div class="layout-brief-card-head">
        <strong>${escapeHtml(entry.note || entry.fieldPath || 'Неопределённость')}</strong>
        <button type="button" class="link danger" data-brief-action="remove-uncertainty">Удалить</button>
      </div>
      <label class="prop-field"><span>Что неизвестно</span><input data-uncertainty-field="note" value="${fieldValue(entry.note)}"></label>
      <label class="prop-field"><span>Поле / объект</span><input data-uncertainty-field="fieldPath" value="${fieldValue(entry.fieldPath)}"></label>
      <label class="prop-field"><span>Статус</span><select data-uncertainty-field="status">${optionsHtml(UNCERTAINTY_OPTIONS, entry.status)}</select></label>
    </div>`).join('');
  return `<details class="layout-brief-subsection" ${briefSectionAttrs('uncertainty')}>
    <summary>Неопределённости <small>${entries.filter((entry) => entry.status !== 'resolved').length} открыто</small></summary>
    <div class="layout-brief-stack">
      ${rows || '<p class="empty-hint">Здесь можно явно отметить допущение — решатель не выдаст его за измеренный факт.</p>'}
      <button type="button" data-brief-action="add-uncertainty">+ Зафиксировать неопределённость</button>
    </div>
  </details>`;
}

function scenariosEditorHtml(selections) {
  const byId = new Map((selections || []).map((entry) => [entry.scenarioId, entry]));
  const active = (selections || []).filter((entry) => entry.enabled === true).length;
  const rows = LAYOUT_SCENARIOS.map((scenario) => {
    const selection = byId.get(scenario.scenario_id);
    const mode = selection?.enabled === false ? 'disabled'
      : selection?.enabled === true && selection.mandatory === true ? 'required'
        : selection?.enabled === true ? 'optional' : '';
    return `<label class="layout-scenario-row">
      <span><small>${escapeHtml(scenario.scenario_id)}</small>${escapeHtml(scenario.title)}</span>
      <select data-scenario-id="${escapeHtml(scenario.scenario_id)}">
        ${optionsHtml([
    ['', 'Не определён'], ['required', 'Обязательный'], ['optional', 'Желательный'], ['disabled', 'Не применяется'],
  ], mode)}
      </select>
    </label>`;
  }).join('');
  return `<details class="layout-brief-subsection" ${briefSectionAttrs('scenarios')}>
    <summary>Сценарии жизни <small>${active ? `${active} активных` : 'не выбраны'}</small></summary>
    <div class="layout-brief-stack">
      <p class="empty-hint">Сценарий включается только явно. «Не определён» останется unknown, а не будет придуман программой.</p>
      <div class="layout-scenario-list">${rows}</div>
    </div>
  </details>`;
}

function layoutBriefEditorHtml(room) {
  const roomItems = itemsInRoom(state.project, room);
  const readiness = layoutBriefReadiness(state.project, { itemIds: roomItems.map((item) => item.id) });
  const brief = readiness.brief;
  const location = state.project.site?.location || {};
  const statusRows = readiness.sections.map((section) => `
    <div class="layout-readiness-row" data-status="${section.status}">
      <span>${section.status === 'ready' || section.status === 'not_applicable' ? '✓' : section.status === 'partial' ? '◐' : '○'} ${escapeHtml(section.label)}</span>
      <small>${escapeHtml(section.summary)}</small>
    </div>`).join('');
  return `<details class="layout-brief-editor" data-layout-brief${layoutBriefOpen ? ' open' : ''}>
    <summary>Исходные данные <small>${readiness.ready} из ${readiness.total}</small></summary>
    <div class="layout-readiness-list">${statusRows}</div>
    <details class="layout-brief-subsection" ${briefSectionAttrs('solar')}>
      <summary>Север и солнце <small>${state.project.site?.solarVerified ? 'подтверждены' : 'нужно подтвердить'}</small></summary>
      <div class="layout-brief-stack">
        <p class="empty-hint">Широта ${fieldValue(location.lat)}, долгота ${fieldValue(location.lon)}, север ${fieldValue(state.project.site?.north)}°. Изменяются в режиме «Участок».</p>
        <label class="check-row"><input type="checkbox" data-layout-solar ${state.project.site?.solarVerified ? 'checked' : ''}>
          <span>Координаты и направление севера проверены</span></label>
      </div>
    </details>
    ${actorsEditorHtml(brief.actors)}
    <details class="layout-brief-subsection" ${briefSectionAttrs('capacity')}>
      <summary>Вместимость <small>${brief.capacity.dailySeats ?? '—'} + ${brief.capacity.guestSeats ?? '—'}</small></summary>
      <div class="prop-grid layout-brief-capacity">
        <label class="prop-field"><span>Ежедневных мест</span><input data-capacity="dailySeats" type="number" min="0" step="1" value="${fieldValue(brief.capacity.dailySeats)}"></label>
        <label class="prop-field"><span>Гостевых мест</span><input data-capacity="guestSeats" type="number" min="0" step="1" value="${fieldValue(brief.capacity.guestSeats)}"></label>
      </div>
    </details>
    ${scenariosEditorHtml(brief.scenarioSelections)}
    ${engineeringEditorHtml(brief.fixedEngineering, room)}
    ${storageEditorHtml(brief.storageInventory)}
    ${manualsEditorHtml(room)}
    ${uncertaintyEditorHtml(brief.uncertainty)}
  </details>`;
}

export function autoLayoutHtml(room) {
  const record = activeRecord(room);
  const enabled = state.project?.settings?.autoArrangeFurniture !== false;
  return `<h3>Авторасстановка</h3>
    <div class="prop-block auto-layout-block">
      ${layoutBriefEditorHtml(room)}
      <label class="check-row">
        <input id="autoArrangeFurniture" type="checkbox" ${enabled ? 'checked' : ''}>
        <span>Перестраивать после изменения формы</span>
      </label>
      <button id="arrangeBtn" type="button">Подобрать ${COUNT} варианта</button>
      <div class="auto-layout-results" aria-live="polite">${variantsHtml(record)}</div>
      ${wholeHomeLayoutHtml()}
    </div>`;
}

function putResults(panel, record) {
  const box = panel.querySelector('.auto-layout-results');
  if (box) box.innerHTML = variantsHtml(record);
}

function commitProjectChange(apply) {
  import('./store.js').then(({ mutate }) => mutate(() => apply(state.project))).catch((error) => {
    console.error('Исходные данные авторасстановки не сохранились:', error);
    toast('Не удалось сохранить исходные данные', true);
  });
}

function commitBriefChange(apply) {
  commitProjectChange((project) => apply(ensureLayoutBrief(project), project));
}

function optionalNumber(input, integer = false) {
  if (input.value.trim() === '') return null;
  const value = Number(String(input.value).replace(',', '.'));
  if (!Number.isFinite(value)) return null;
  return integer ? Math.max(0, Math.round(value)) : value;
}

function findItem(project, id) {
  for (const level of project.levels || []) {
    const item = (level.items || []).find((candidate) => candidate.id === id);
    if (item) return item;
  }
  return null;
}

function ensureClearanceConstraint(item) {
  if (!Array.isArray(item.manualConstraints)) item.manualConstraints = [];
  let constraint = item.manualConstraints.find((entry) => entry.id === `${item.id}:clearances`)
    || item.manualConstraints.find((entry) => entry.clearances);
  if (!constraint) {
    constraint = {
      id: `${item.id}:clearances`, status: 'unknown', requirement: 'Паспортные зазоры изделия', clearances: {},
    };
    item.manualConstraints.push(constraint);
  }
  if (!constraint.clearances || typeof constraint.clearances !== 'object') constraint.clearances = {};
  return constraint;
}

function bindLayoutBriefEditor(panel, room) {
  const editor = panel.querySelector('[data-layout-brief]');
  if (!editor) return;
  editor.addEventListener('toggle', () => { layoutBriefOpen = editor.open; });
  editor.querySelectorAll('[data-brief-section]').forEach((details) => {
    details.addEventListener('toggle', (event) => {
      event.stopPropagation();
      if (details.open) layoutBriefSectionsOpen.add(details.dataset.briefSection);
      else layoutBriefSectionsOpen.delete(details.dataset.briefSection);
    });
  });

  editor.addEventListener('click', (event) => {
    const button = event.target.closest('[data-brief-action]');
    if (!button) return;
    const action = button.dataset.briefAction;
    const actorId = button.closest('[data-brief-actor]')?.dataset.briefActor;
    const engineeringId = button.closest('[data-brief-engineering]')?.dataset.briefEngineering;
    const storageId = button.closest('[data-brief-storage]')?.dataset.briefStorage;
    const uncertaintyId = button.closest('[data-brief-uncertainty]')?.dataset.briefUncertainty;
    commitBriefChange((brief, project) => {
      if (action === 'add-actor') {
        brief.actors.push({
          id: makeId('actor'), alias: `Жилец ${brief.actors.length + 1}`,
          heightMm: null, mobilityProfile: 'unknown', bodyWidthMm: null, bodyDepthMm: null,
          carriedObjectIds: [], dataStatus: 'unknown', sourceRef: null,
        });
      } else if (action === 'remove-actor') {
        brief.actors = brief.actors.filter((actor) => actor.id !== actorId);
        if (Array.isArray(brief.storageInventory)) {
          for (const entry of brief.storageInventory) {
            entry.ownerActorIds = (entry.ownerActorIds || []).filter((id) => id !== actorId);
          }
        }
      } else if (action === 'add-engineering') {
        if (!Array.isArray(brief.fixedEngineering)) brief.fixedEngineering = [];
        brief.fixedEngineering.push({
          id: makeId('engineering'), kind: 'outlet', levelId: project.activeLevel, roomId: room.id,
          x: Math.round(room.x + room.w / 2), y: Math.round(room.y + room.h / 2), zMm: 0,
          fixed: true, dataStatus: 'unknown', sourceRef: null, clearanceMm: null,
        });
      } else if (action === 'no-engineering') brief.fixedEngineering = [];
      else if (action === 'unknown-engineering') brief.fixedEngineering = null;
      else if (action === 'remove-engineering') {
        brief.fixedEngineering = (brief.fixedEngineering || []).filter((point) => point.id !== engineeringId);
      } else if (action === 'add-storage') {
        if (!Array.isArray(brief.storageInventory)) brief.storageInventory = [];
        brief.storageInventory.push({
          id: makeId('storage'), label: null, category: null, count: null,
          requiredVolumeLiters: null, frequency: 'unknown', dataStatus: 'unknown', sourceRef: null,
          ownerActorIds: [], roomIds: [room.id],
        });
      } else if (action === 'no-storage') brief.storageInventory = [];
      else if (action === 'unknown-storage') brief.storageInventory = null;
      else if (action === 'remove-storage') {
        brief.storageInventory = (brief.storageInventory || []).filter((entry) => entry.id !== storageId);
      } else if (action === 'add-uncertainty') {
        brief.uncertainty.push({
          id: makeId('uncertainty'), scope: 'other', targetId: null,
          fieldPath: null, status: 'unknown', note: null, sourceRef: null,
        });
      } else if (action === 'remove-uncertainty') {
        brief.uncertainty = brief.uncertainty.filter((entry) => entry.id !== uncertaintyId);
      }
    });
  });

  editor.addEventListener('change', (event) => {
    const input = event.target;
    if (input.matches('[data-layout-solar]')) {
      const checked = input.checked;
      commitProjectChange((project) => { project.site.solarVerified = checked; });
      return;
    }
    if (input.dataset.capacity) {
      const field = input.dataset.capacity;
      const value = optionalNumber(input, true);
      commitBriefChange((brief) => { brief.capacity[field] = value; });
      return;
    }
    if (input.dataset.scenarioId) {
      const scenarioId = input.dataset.scenarioId;
      const mode = input.value;
      commitBriefChange((brief) => {
        brief.scenarioSelections = (brief.scenarioSelections || [])
          .filter((entry) => entry.scenarioId !== scenarioId);
        if (!mode) return;
        brief.scenarioSelections.push({
          scenarioId,
          enabled: mode !== 'disabled',
          mandatory: mode === 'required' ? true : mode === 'optional' ? false : null,
          actorPersonIds: [], frequencyValue: null, frequencyPeriod: null,
          specificRequirements: null, sourceRef: null,
        });
      });
      return;
    }
    const actorCard = input.closest('[data-brief-actor]');
    if (actorCard && input.dataset.actorField) {
      const field = input.dataset.actorField;
      const value = input.hasAttribute('data-number') ? optionalNumber(input) : (input.value.trim() || null);
      commitBriefChange((brief) => {
        const actor = brief.actors.find((candidate) => candidate.id === actorCard.dataset.briefActor);
        if (actor) actor[field] = value;
      });
      return;
    }
    const engineeringCard = input.closest('[data-brief-engineering]');
    if (engineeringCard && input.dataset.engineeringField) {
      const field = input.dataset.engineeringField;
      const value = input.hasAttribute('data-number') ? optionalNumber(input) : (input.value.trim() || null);
      commitBriefChange((brief) => {
        const point = (brief.fixedEngineering || []).find((candidate) => candidate.id === engineeringCard.dataset.briefEngineering);
        if (point) point[field] = value;
      });
      return;
    }
    const storageCard = input.closest('[data-brief-storage]');
    if (storageCard && input.dataset.storageField) {
      const field = input.dataset.storageField;
      const value = input.hasAttribute('data-number')
        ? optionalNumber(input, input.hasAttribute('data-integer')) : (input.value.trim() || null);
      commitBriefChange((brief) => {
        const entry = (brief.storageInventory || []).find((candidate) => candidate.id === storageCard.dataset.briefStorage);
        if (entry) entry[field] = value;
      });
      return;
    }
    const uncertaintyCard = input.closest('[data-brief-uncertainty]');
    if (uncertaintyCard && input.dataset.uncertaintyField) {
      const field = input.dataset.uncertaintyField;
      const value = input.value.trim() || null;
      commitBriefChange((brief) => {
        const entry = brief.uncertainty.find((candidate) => candidate.id === uncertaintyCard.dataset.briefUncertainty);
        if (entry) entry[field] = value;
      });
      return;
    }
    const itemCard = input.closest('[data-brief-item]');
    if (!itemCard) return;
    const itemId = itemCard.dataset.briefItem;
    if (input.dataset.itemMeta) {
      const field = input.dataset.itemMeta;
      const value = input.value.trim();
      commitProjectChange((project) => {
        const item = findItem(project, itemId);
        if (!item) return;
        if (value) item[field] = value; else delete item[field];
        if (field === 'manualStatus' && Array.isArray(item.manualConstraints)) {
          for (const constraint of item.manualConstraints) {
            if (value === 'verified') constraint.status = 'verified';
            else if (value === 'unknown' || !value) constraint.status = 'unknown';
          }
        }
      });
      return;
    }
    if (input.dataset.itemClearance) {
      const field = input.dataset.itemClearance;
      const value = optionalNumber(input);
      commitProjectChange((project) => {
        const item = findItem(project, itemId);
        if (!item) return;
        const constraint = ensureClearanceConstraint(item);
        if (value == null) delete constraint.clearances[field]; else constraint.clearances[field] = Math.max(0, value);
        constraint.status = item.manualStatus === 'verified' ? 'verified' : 'unknown';
      });
      return;
    }
    if (input.hasAttribute('data-item-manual-source')) {
      const value = input.value.trim();
      commitProjectChange((project) => {
        const item = findItem(project, itemId);
        if (!item) return;
        const constraint = ensureClearanceConstraint(item);
        if (value) constraint.sourceRef = value; else delete constraint.sourceRef;
        constraint.status = item.manualStatus === 'verified' ? 'verified' : 'unknown';
      });
    }
  });
}

function applyVariant(room, record, layout) {
  if (record.signature !== layoutSignature(state.project, room)) {
    invalidateLayoutVariants([room.id]);
    toast('Комната изменилась — подберите варианты заново', true);
    return;
  }
  // Валидация результата уже выполнялась ядром. Перед применением достаточно
  // проверить неизменность входа; mutate создаст ровно один снимок истории.
  import('./store.js').then(({ mutate }) => {
    if (record.signature !== layoutSignature(state.project, room)) {
      invalidateLayoutVariants([room.id]);
      toast('Комната изменилась — подберите варианты заново', true);
      return;
    }
    const validationProject = record.seedItems.length ? cloneProject(state.project) : state.project;
    if (record.seedItems.length) validationProject.items.push(...record.seedItems.map((item) => structuredClone(item)));
    const validationRoom = roomById(validationProject, room.id);
    const validationWalls = deriveWalls(validationProject);
    const validationLocked = lockedIds(validationProject, validationRoom);
    const validation = validateFurnitureLayout(validationProject, validationRoom, validationWalls, layout, {
      lockedIds: validationLocked,
    });
    if (!validation.ok) {
      invalidateLayoutVariants([room.id]);
      toast('Вариант больше не проходит проверку — подберите заново', true);
      return;
    }
    // Удаляем предпросмотр до mutate: его afterChange() сразу перерисует
    // свойства уже без устаревших карточек применённого решения.
    invalidateLayoutVariants([room.id]);
    mutate(() => {
      if (record.seedItems.length) {
        const present = new Set(state.project.items.map((item) => item.id));
        for (const item of record.seedItems) if (!present.has(item.id)) state.project.items.push(structuredClone(item));
      }
      applyFurnitureLayout(state.project, layout);
      state.rejected.set(room.id, []);
    });
    toast(`Применён вариант «${layout.label || 'Авторасстановка'}» · Ctrl+Z — отменить`);
  }).catch((error) => {
    console.error('Авторасстановка не применилась:', error);
    toast('Не удалось применить вариант', true);
  });
}

export function bindAutoLayout(panel, room) {
  if (!panel || !room) return;
  bindLayoutBriefEditor(panel, room);
  bindWholeHomeLayout(panel, { onApplied: () => invalidateLayoutVariants() });
  const arrange = panel.querySelector('#arrangeBtn');
  arrange?.addEventListener('click', () => {
    const running = roomTasks.get(room.id);
    if (running) {
      running.cancel();
      return;
    }
    arrange.textContent = 'Подбираем…';
    // Первый кадр показывает состояние кнопки, сам поиск идёт в Worker.
    requestAnimationFrame(async () => {
      try {
        const record = await findLayouts(state.project, room, (progress) => {
          if (progress?.phase === 'restore') arrange.textContent = 'Подготавливаем…';
          else if (progress?.phase === 'solve') arrange.textContent = 'Отменить подбор';
          else if (progress?.phase === 'validate') arrange.textContent = 'Проверяем…';
        });
        putResults(panel, record);
      } catch (error) {
        if (error instanceof LayoutSolveCancelledError) putResults(panel, null);
        else if (error instanceof StaleLayoutResultError) {
          putResults(panel, null);
          toast('Комната изменилась — подберите варианты заново', true);
        } else {
          console.error('Авторасстановка не посчиталась:', error);
          putResults(panel, {
            result: { status: 'search_budget_exhausted', diagnostics: ['Ошибка расчёта — проект не изменён'], layouts: [] },
          });
        }
      } finally {
        arrange.textContent = `Подобрать ${COUNT} варианта`;
      }
    });
  });

  panel.querySelector('#autoArrangeFurniture')?.addEventListener('change', (event) => {
    const checked = event.target.checked;
    import('./store.js').then(({ mutate }) => mutate(() => {
      state.project.settings.autoArrangeFurniture = checked;
    }));
  });

  panel.querySelector('.auto-layout-results')?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-layout-apply]');
    if (!button) return;
    const record = activeRecord(room);
    const layout = record?.result.layouts?.find((candidate) => candidate.id === button.dataset.layoutApply);
    if (!record || !layout) {
      toast('Вариант устарел — подберите заново', true);
      return;
    }
    button.disabled = true;
    applyVariant(room, record, layout);
  });
}

// Автоперестройка для store/input: меняет текущий проект, но не вызывает
// mutate(), pushHistory() или afterChange(). Вызывающая сторона включает её
// в собственную транзакцию жеста/поля размера.
export function arrangeRoomsNow(roomIds, { force = false, itemIdsByRoom = null, levelId = null } = {}) {
  const rootProject = state.project;
  const reports = [];
  if (!rootProject || (!force && rootProject.settings?.autoArrangeFurniture === false)) return { applied: 0, reports };
  const targetLevelId = levelId || rootProject.activeLevel;
  const project = targetLevelId === rootProject.activeLevel ? rootProject : levelProject(rootProject, targetLevelId);
  const walls = targetLevelId === rootProject.activeLevel ? state.walls : deriveWalls(project);
  let applied = 0;
  for (const roomId of new Set(roomIds || [])) {
    const room = roomById(project, roomId);
    const included = itemIdsByRoom instanceof Map ? itemIdsByRoom.get(roomId) : itemIdsByRoom?.[roomId];
    if (!room || !layoutItems(project, room, included).length) continue;
    const locked = lockedIds(project, room, included);
    const result = generateFurnitureLayouts(project, room, walls, {
      count: 1,
      lockedIds: locked,
      itemIds: included,
      beamWidth: 8,
      candidatesPerItem: 8,
      maxBasePoses: 40,
    });
    const layout = result.layouts?.[0] || null;
    let accepted = false;
    if (layout) {
      const validation = validateFurnitureLayout(project, room, walls, layout, { lockedIds: locked, itemIds: included });
      if (validation.ok) {
        applied += applyFurnitureLayout(project, layout);
        accepted = true;
      }
      else result.diagnostics = [...(result.diagnostics || []), 'Независимая проверка отклонила лучший вариант'];
    }
    state.rejected.set(room.id, accepted
      ? []
      : (result.diagnostics?.length ? result.diagnostics : ['Подходящий вариант не найден']).map((reason) => ({ reason })));
    reports.push({ levelId: targetLevelId, roomId, result, layout: accepted ? layout : null });
    cache().delete(room.id);
  }
  return { applied, reports };
}

export function invalidateLayoutVariants(roomIds = null) {
  invalidateWholeHomeVariants();
  if (roomIds == null) {
    roomWorkerClient.cancelAll();
    roomTasks.clear();
    cache().clear();
    return;
  }
  for (const roomId of roomIds) {
    roomTasks.get(roomId)?.cancel();
    roomTasks.delete(roomId);
    cache().delete(roomId);
  }
}
