// Предварительный инженерный обзор дома.
//
// Панель намеренно разделяет существующие фиксированные точки и будущую
// проектируемую сеть. Она не прокладывает трубы/воздуховоды и не превращает
// геометрическую близость помещений в нормативное заключение.

import { analyzeHomeEngineering } from '../core/home-engineering.js';
import {
  ENGINEERING_KINDS, ensureLayoutBrief,
} from '../core/layout-brief.js';
import { makeId } from '../core/model.js';
import { escapeHtml } from './dom.js';

const KIND_LABELS = Object.freeze({
  cold_water: 'Холодная вода',
  hot_water: 'Горячая вода',
  drain: 'Канализация',
  gas: 'Газ',
  power: 'Силовое питание',
  outlet: 'Розетка',
  switch: 'Выключатель',
  vent_supply: 'Приточная вентиляция',
  vent_return: 'Возврат воздуха',
  vent_extract: 'Вытяжная вентиляция',
  radiator: 'Радиатор',
  fireplace: 'Камин / дымоход',
  other: 'Другая точка',
});

const DATA_STATUS_LABELS = Object.freeze({
  measured: 'Измерено',
  declared: 'Заявлено',
  assumed: 'Принято предварительно',
  unknown: 'Неизвестно',
});

const STATUS_LABELS = Object.freeze({
  proven: 'Доказано',
  fact: 'Доказано',
  verified: 'Доказано',
  ready: 'Доказано',
  known: 'Доказано',
  candidate: 'Кандидат',
  preliminary: 'Кандидат',
  partial: 'Кандидат',
  unknown: 'Не задано',
  missing: 'Не задано',
  not_set: 'Не задано',
  conflict: 'Противоречие',
  error: 'Противоречие',
  invalid: 'Противоречие',
});

const array = (value) => (Array.isArray(value) ? value : []);
const finite = (value) => value !== null && value !== undefined && value !== ''
  && Number.isFinite(Number(value));
const cleanText = (value) => (typeof value === 'string' ? value.trim() : '');

function safeAnalysis(project) {
  try {
    return analyzeHomeEngineering(project) || {};
  } catch (error) {
    console.error('Инженерный обзор не рассчитался:', error);
    return {
      status: 'unknown',
      warnings: ['Не удалось выполнить предварительный инженерный обзор.'],
    };
  }
}
function normalizedStatus(value, fallback = 'unknown') {
  const status = String(value || fallback).toLocaleLowerCase('ru-RU');
  if (['conflict', 'error', 'invalid'].includes(status)) return 'conflict';
  if (['proven', 'fact', 'verified', 'ready', 'known', 'done'].includes(status)) return 'proven';
  if (['candidate', 'preliminary', 'partial', 'warning'].includes(status)) return 'candidate';
  return 'unknown';
}

function aggregateStatus(items) {
  const statuses = array(items).map((item) => normalizedStatus(item?.status));
  if (!statuses.length) return 'unknown';
  if (statuses.includes('conflict')) return 'conflict';
  if (statuses.every((status) => status === 'proven')) return 'proven';
  if (statuses.some((status) => ['proven', 'candidate'].includes(status))) return 'candidate';
  return 'unknown';
}

function statusLabel(value) {
  const status = normalizedStatus(value);
  return STATUS_LABELS[status] || STATUS_LABELS.unknown;
}

function firstArray(...values) {
  return values.find(Array.isArray) || [];
}

function levelRooms(project) {
  return array(project?.levels).flatMap((level) => array(level?.rooms).map((room) => ({
    ...room,
    levelId: level.id,
    levelName: level.name || level.id,
  })));
}

function roomTitle(project, roomId, levelId = null) {
  const room = levelRooms(project).find((candidate) => candidate.id === roomId
    && (!levelId || candidate.levelId === levelId));
  return room?.name || room?.title || room?.type || roomId || 'Помещение не указано';
}

function sourceSignature(project) {
  return JSON.stringify({
    activeLevel: project?.activeLevel || null,
    levels: array(project?.levels).map((level) => ({
      id: level.id,
      elevation: level.elevation,
      rooms: array(level.rooms).map((room) => ({
        id: room.id, type: room.type, x: room.x, y: room.y,
        w: room.w, h: room.h, outline: room.outline || null,
      })),
    })),
    fixedEngineering: project?.layoutBrief?.fixedEngineering ?? null,
  });
}

function options(entries, selected) {
  return entries.map(([value, label]) => `<option value="${escapeHtml(value)}"${String(selected ?? '') === String(value) ? ' selected' : ''}>${escapeHtml(label)}</option>`).join('');
}

function levelOptions(project, selected) {
  return options([
    ['', 'Этаж не указан'],
    ...array(project?.levels).map((level) => [level.id, level.name || level.id]),
  ], selected);
}

function roomOptions(project, selected, levelId) {
  const rows = levelRooms(project)
    .filter((room) => !levelId || room.levelId === levelId)
    .map((room) => [room.id, `${room.name || room.type || room.id} · ${room.levelName}`]);
  return options([['', 'Помещение не указано'], ...rows], selected);
}

function metric(value, fallback = '—') {
  return finite(value) ? Number(value).toLocaleString('ru-RU', { maximumFractionDigits: 1 }) : fallback;
}

function findingText(item, project) {
  if (typeof item === 'string') return item;
  const direct = item?.reason || item?.message || item?.summary || item?.description || item?.title;
  if (cleanText(direct)) return cleanText(direct);
  const issues = array(item?.issues).map((issue) => issue?.message).filter(cleanText);
  if (issues.length) return issues.join(' ');
  if (item?.roomId) return roomTitle(project, item.roomId, item.levelId);
  return 'Данные требуют уточнения.';
}

function findingsList(items, project, emptyText) {
  const rows = array(items);
  if (!rows.length) return `<p class="home-engineering-empty">${escapeHtml(emptyText)}</p>`;
  return `<ul class="home-engineering-findings">${rows.map((item) => {
    const status = normalizedStatus(item?.status);
    const detail = item?.distanceMm != null ? ` · ${metric(item.distanceMm)} мм`
      : item?.overlapAreaM2 != null ? ` · ${metric(item.overlapAreaM2)} м²` : '';
    return `<li data-status="${status}"><span>${escapeHtml(statusLabel(status))}</span><p>${escapeHtml(findingText(item, project))}${escapeHtml(detail)}</p></li>`;
  }).join('')}</ul>`;
}

function overviewCard({ id, title, status, value, hint, body }) {
  const normalized = normalizedStatus(status);
  return `<details class="home-engineering-card analysis-disclosure" data-analysis-fold="engineering-${escapeHtml(id)}" data-engineering-card="${escapeHtml(id)}" data-status="${normalized}"${normalized === 'conflict' ? ' open' : ''}>
    <summary>
      <strong>${escapeHtml(title)}</strong>
      <span class="home-engineering-status">${escapeHtml(statusLabel(normalized))}${value ? ` · ${escapeHtml(String(value))}` : ''}</span>
    </summary>
    <p>${escapeHtml(hint)}</p>
    ${body}
  </details>`;
}

function analysisSections(project, analysis) {
  const analyzedRooms = array(analysis?.rooms);
  const wetRooms = firstArray(
    analysis?.wetRooms,
    analysis?.wetZones,
    analysis?.needs?.wetRooms,
    analyzedRooms.filter((room) => room?.needsWater || room?.wet
      || array(room?.systems).some((system) => ['water', 'drain'].includes(system?.id))),
  );
  const vertical = firstArray(
    analysis?.verticalCandidates,
    analysis?.candidates?.vertical,
    analysis?.vertical?.candidates,
  );
  let ventilationRows = firstArray(
    analysis?.ventilation?.rooms,
    analysis?.ventilationNeeds,
    analysis?.needs?.ventilation,
  );
  if (!ventilationRows.length && analysis?.ventilation) {
    const supply = new Set(array(analysis.ventilation.supplyRoomKeys));
    const extract = new Set(array(analysis.ventilation.extractRoomKeys));
    const pointRecords = array(analysis?.points?.records);
    ventilationRows = analyzedRooms.filter((room) => supply.has(room.key) || extract.has(room.key)).map((room) => {
      const modes = [supply.has(room.key) ? 'приток' : '', extract.has(room.key) ? 'вытяжка' : ''].filter(Boolean);
      const requiredSystems = [supply.has(room.key) ? 'supply' : '', extract.has(room.key) ? 'extract' : ''].filter(Boolean);
      const matchingSystems = new Set(pointRecords.filter((point) => point.roomKey === room.key
        && point.status === 'fact' && requiredSystems.includes(point.system)).map((point) => point.system));
      const complete = requiredSystems.every((system) => matchingSystems.has(system));
      const partial = matchingSystems.size > 0;
      return {
        ...room,
        status: complete ? 'fact' : partial ? 'candidate' : 'unknown',
        reason: complete
          ? `${room.roomName || room.name || room.roomId}: для выявленной потребности есть подтверждённая исходная точка (${modes.join(' и ')}).`
          : partial
            ? `${room.roomName || room.name || room.roomId}: подтверждена только часть потребностей — ${modes.join(' и ')}.`
            : `${room.roomName || room.name || room.roomId}: нужно принять решение — ${modes.join(' и ')}.`,
      };
    });
  }
  const pointFindings = firstArray(
    analysis?.fixedPoints,
    analysis?.engineeringPoints,
    analysis?.points?.records,
    analysis?.points,
  );
  const rawPoints = project?.layoutBrief?.fixedEngineering;
  const conflicts = firstArray(
    analysis?.conflicts,
    analysis?.issues?.filter?.((issue) => normalizedStatus(issue?.status) === 'conflict'),
    pointFindings.filter((point) => normalizedStatus(point?.status) === 'conflict'),
  );

  const wetStatus = wetRooms.length ? 'candidate' : 'unknown';
  const verticalStatus = vertical.length ? 'candidate' : 'unknown';
  const ventilationStatus = aggregateStatus(ventilationRows);
  const pointsStatus = conflicts.length ? 'conflict'
    : rawPoints == null ? 'unknown'
      : rawPoints.length ? aggregateStatus(pointFindings)
        : 'proven';

  return [
    overviewCard({
      id: 'wet', title: 'Мокрые зоны', status: wetStatus,
      value: wetRooms.length || '',
      hint: 'Потребность определяется по назначению помещений и приборам, а не по наличию готовой трубы.',
      body: findingsList(wetRooms, project, 'Помещения с инженерной потребностью пока не найдены.'),
    }),
    overviewCard({
      id: 'vertical', title: 'Вертикальное совмещение', status: verticalStatus,
      value: vertical.length || '',
      hint: 'Совпадение по плану — только кандидат на компактный узел. Шахта сама по себе не является стояком.',
      body: findingsList(vertical, project, 'Кандидаты между соседними этажами не найдены или этажей недостаточно.'),
    }),
    overviewCard({
      id: 'ventilation', title: 'Вентиляция', status: ventilationStatus,
      value: ventilationRows.length || '',
      hint: 'Показаны помещения, где нужно принять решение о притоке или вытяжке. Расход воздуха не рассчитывается.',
      body: findingsList(ventilationRows, project, 'Решения о притоке и вытяжке ещё не заданы.'),
    }),
    overviewCard({
      id: 'points', title: 'Исходные точки', status: pointsStatus,
      value: rawPoints == null ? '' : rawPoints.length,
      hint: rawPoints == null
        ? 'Существующие фиксированные точки ещё не обследованы.'
        : rawPoints.length
          ? 'Проверяются только явно введённые существующие точки.'
          : 'Подтверждено отсутствие существующих фиксированных точек. Будущую сеть всё равно нужно спроектировать.',
      body: conflicts.length
        ? findingsList(conflicts, project, '')
        : findingsList(pointFindings, project, rawPoints == null ? 'Данные не обследованы.' : 'Противоречий явных данных не найдено.'),
    }),
  ].join('');
}

function pointEditor(project, point) {
  return `<article class="home-engineering-point" data-engineering-point="${escapeHtml(point.id)}">
    <header><strong>${escapeHtml(KIND_LABELS[point.kind] || point.label || 'Инженерная точка')}</strong><button type="button" class="link danger" data-home-engineering-action="remove-point" data-point-id="${escapeHtml(point.id)}">Удалить</button></header>
    <div class="home-engineering-grid">
      <label class="prop-field"><span>Тип</span><select data-engineering-field="kind">${options(ENGINEERING_KINDS.map((kind) => [kind, KIND_LABELS[kind] || kind]), point.kind)}</select></label>
      <label class="prop-field"><span>Этаж</span><select data-engineering-field="levelId">${levelOptions(project, point.levelId)}</select></label>
      <label class="prop-field home-engineering-room-field"><span>Помещение</span><select data-engineering-field="roomId">${roomOptions(project, point.roomId, point.levelId)}</select></label>
      <label class="prop-field"><span>X, мм</span><input data-engineering-field="x" data-number type="number" step="10" inputmode="decimal" value="${escapeHtml(point.x ?? '')}"></label>
      <label class="prop-field"><span>Y, мм</span><input data-engineering-field="y" data-number type="number" step="10" inputmode="decimal" value="${escapeHtml(point.y ?? '')}"></label>
      <label class="prop-field"><span>Высота, мм</span><input data-engineering-field="zMm" data-number type="number" step="10" inputmode="decimal" value="${escapeHtml(point.zMm ?? '')}"></label>
      <label class="prop-field"><span>Статус данных</span><select data-engineering-field="dataStatus">${options(Object.entries(DATA_STATUS_LABELS), point.dataStatus || 'unknown')}</select></label>
      <label class="prop-field home-engineering-source-field"><span>Источник / примечание</span><input data-engineering-field="sourceRef" value="${escapeHtml(point.sourceRef || '')}" placeholder="Обмер, фото, проект…"></label>
    </div>
  </article>`;
}

function pointsEditor(project) {
  const points = project?.layoutBrief?.fixedEngineering;
  const stateText = points == null ? 'Не обследовано'
    : points.length ? `${points.length} ${points.length === 1 ? 'точка' : 'точек'}`
      : 'Подтверждено отсутствие';
  return `<section class="home-engineering-editor" aria-labelledby="homeEngineeringPointsTitle">
    <header class="home-engineering-section-head">
      <div><h3 id="homeEngineeringPointsTitle">Точки подключения</h3><p>${escapeHtml(stateText)}</p></div>
    </header>
    <div class="home-engineering-points">${array(points).map((point) => pointEditor(project, point)).join('')}</div>
    <div class="home-engineering-actions">
      <button type="button" class="primary" data-home-engineering-action="add-point">+ Добавить точку</button>
      <button type="button" data-home-engineering-action="mark-none">Подтвердить: точек нет</button>
      <button type="button" class="link" data-home-engineering-action="mark-unknown">Ещё не обследовано</button>
    </div>
  </section>`;
}

/**
 * Разметка следующего этапа «Инженерные связи».
 * Настройки экранного слоя не сохраняются в проекте.
 */
export function homeEngineeringHtml(project, state = {}) {
  const analysis = safeAnalysis(project);
  const overlayOn = state?.homeEngineeringOverlay?.on === true;
  const warnings = array(analysis?.warnings).filter((warning) => cleanText(warning));
  const conflicts = firstArray(analysis?.conflicts).length;
  const overall = conflicts ? 'conflict' : normalizedStatus(analysis?.status);
  return `<div class="home-engineering" data-home-engineering>
    <div class="home-engineering-summary" data-status="${overall}">
      <div><strong>${escapeHtml(statusLabel(overall))}</strong><span>Вода и вентиляция</span></div>
      <button type="button" class="project-route-switch" role="switch" aria-checked="${overlayOn}" data-home-engineering-action="toggle-overlay"><span aria-hidden="true"></span>${overlayOn ? 'Показано на плане' : 'Показать на плане'}</button>
    </div>
    ${pointsEditor(project)}
    <div class="home-engineering-cards">${analysisSections(project, analysis)}</div>
    ${warnings.length ? `<section class="home-engineering-warnings" aria-labelledby="homeEngineeringWarnings"><h3 id="homeEngineeringWarnings">Что нужно уточнить</h3><ul>${warnings.map((warning) => `<li>${escapeHtml(warning)}</li>`).join('')}</ul></section>` : ''}
    <details class="analysis-disclosure" data-analysis-fold="limitations"><summary>Границы расчёта</summary>
      <p class="home-engineering-disclaimer">Предварительная проверка сопоставляет комнаты и точки подключения. Трассировку труб и воздуховодов, диаметры, уклоны и расходы определяют при проектировании сетей.</p>
    </details>
  </div>`;
}

function currentProject(deps) {
  return deps?.project || deps?.state?.project || null;
}

function runMutation(deps, change) {
  const project = currentProject(deps);
  if (!project || typeof change !== 'function') return false;
  if (typeof deps?.mutate === 'function') deps.mutate((draftProject) => change(draftProject || project));
  else change(project);
  deps?.rerender?.();
  return true;
}

function pointById(project, id) {
  return array(project?.layoutBrief?.fixedEngineering).find((point) => point.id === id) || null;
}

function selectRoomForPoint(project, point) {
  const level = array(project?.levels).find((candidate) => candidate.id === point.levelId)
    || array(project?.levels)[0];
  const room = array(level?.rooms).find((candidate) => candidate.id === point.roomId)
    || array(level?.rooms)[0];
  return { level, room };
}

function newPoint(project) {
  const level = array(project?.levels).find((candidate) => candidate.id === project?.activeLevel)
    || array(project?.levels)[0];
  const room = array(level?.rooms)[0] || null;
  return {
    id: makeId('engineering'),
    kind: 'cold_water',
    label: null,
    levelId: level?.id || null,
    roomId: room?.id || null,
    // Координаты нельзя подставлять из центра bbox: у сложной комнаты он может
    // оказаться снаружи, а предположение позднее будет выглядеть как обмер.
    x: null,
    y: null,
    zMm: 0,
    fixed: true,
    dataStatus: 'unknown',
    sourceRef: null,
    clearanceMm: null,
    equipmentItemIds: [],
    notes: null,
  };
}

function notify(deps, message, long = false) {
  deps?.toast?.(message, long);
}

/** Обрабатывает кнопки панели. Возвращает true, если событие принято. */
export function handleHomeEngineeringClick(event, deps = {}) {
  const button = event?.target?.closest?.('[data-home-engineering-action]');
  if (!button) return false;
  const action = button.dataset.homeEngineeringAction;
  const project = currentProject(deps);
  if (!project) return false;

  if (action === 'toggle-overlay') {
    const view = deps.state?.homeEngineeringOverlay;
    if (!deps.state) return true;
    if (view?.on) {
      deps.state.homeEngineeringOverlay = { on: false, result: null, signature: null };
      deps.state._homeEngineeringUI = null;
    } else {
      deps.state.homeProgramOverlay = {
        ...deps.state.homeProgramOverlay, on: false, result: null, signature: null,
      };
      deps.state._homeProgramUI = null;
      deps.state._homeFlowsUI = null;
      deps.state.homeEngineeringOverlay = {
        on: true,
        result: safeAnalysis(project),
        signature: sourceSignature(project),
      };
      deps.closePanel?.({ restoreFocus: false });
      deps.setEditorMode?.('plan');
    }
    deps.requestDraw?.();
    deps.rerender?.();
    deps.announce?.(view?.on ? 'Инженерный обзор скрыт' : 'Инженерный обзор показан на плане');
    return true;
  }

  if (action === 'add-point') {
    runMutation(deps, (draftProject) => {
      const brief = ensureLayoutBrief(draftProject);
      if (!Array.isArray(brief.fixedEngineering)) brief.fixedEngineering = [];
      brief.fixedEngineering.push(newPoint(draftProject));
    });
    notify(deps, 'Добавлена исходная инженерная точка. Уточните её тип и источник.');
    return true;
  }
  if (action === 'remove-point') {
    const id = button.dataset.pointId || button.closest('[data-engineering-point]')?.dataset.engineeringPoint;
    runMutation(deps, (draftProject) => {
      const brief = ensureLayoutBrief(draftProject);
      brief.fixedEngineering = array(brief.fixedEngineering).filter((point) => point.id !== id);
    });
    return true;
  }
  if (action === 'mark-none') {
    runMutation(deps, (draftProject) => { ensureLayoutBrief(draftProject).fixedEngineering = []; });
    notify(deps, 'Подтверждено отсутствие существующих фиксированных точек. Это не отменяет проектирование будущих сетей.', true);
    return true;
  }
  if (action === 'mark-unknown') {
    runMutation(deps, (draftProject) => { ensureLayoutBrief(draftProject).fixedEngineering = null; });
    notify(deps, 'Инженерные точки отмечены как не обследованные.');
    return true;
  }
  return false;
}

/** Обрабатывает поля исходной точки. Возвращает true, если событие принято. */
export function handleHomeEngineeringInput(event, deps = {}) {
  const input = event?.target?.closest?.('[data-engineering-field]');
  const card = input?.closest?.('[data-engineering-point]');
  if (!input || !card) return false;
  const id = card.dataset.engineeringPoint;
  const field = input.dataset.engineeringField;
  const numeric = input.hasAttribute('data-number');
  const value = numeric ? (input.value === '' || !Number.isFinite(Number(input.value)) ? null : Number(input.value))
    : (input.value.trim() || null);
  runMutation(deps, (draftProject) => {
    const brief = ensureLayoutBrief(draftProject);
    const point = pointById(draftProject, id);
    if (!point) return;
    point[field] = value;
    if (field === 'levelId') {
      const { level, room } = selectRoomForPoint(draftProject, point);
      point.levelId = level?.id || null;
      point.roomId = room?.id || null;
      point.x = null;
      point.y = null;
    } else if (field === 'roomId') {
      const selected = point.roomId
        ? levelRooms(draftProject).find((room) => room.id === point.roomId)
        : null;
      if (selected) point.levelId = selected.levelId;
      point.x = null;
      point.y = null;
    }
    // ensureLayoutBrief вернул тот же объект brief; явная ссылка сохраняет
    // намерение и защищает интеграцию с альтернативным mutate.
    draftProject.layoutBrief = brief;
  });
  return true;
}

/** Пересчитать включённый экранный слой после изменения модели. */
export function refreshHomeEngineeringOverlay(project, state, requestDraw) {
  if (!project || !state?.homeEngineeringOverlay?.on) return null;
  const result = safeAnalysis(project);
  state.homeEngineeringOverlay = {
    ...state.homeEngineeringOverlay,
    on: true,
    result,
    signature: sourceSignature(project),
  };
  requestDraw?.();
  return result;
}
