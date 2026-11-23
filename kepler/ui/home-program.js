// Компактный редактор «Программы дома» для общего маршрута проекта.
// Расчёт остаётся в core/home-program.js; здесь только локальный черновик,
// явное сохранение и запуск существующего инструмента помещения.

import { roomType } from '../core/catalog.js';
import { analyzeHomeFlows } from '../core/home-flows.js';
import { analyzeHomeProgram, suggestHomeProgram } from '../core/home-program.js';
import {
  ensureLayoutBrief, HOME_PROGRAM_OPTION_KEYS,
} from '../core/layout-brief.js';
import { makeId } from '../core/model.js';
import { escapeHtml, toast } from './dom.js';
import { setEditorMode } from './modes.js';
import { state } from './state.js';
import { mutate } from './store.js';
import { requestDraw } from './view.js';

const OPTION_LABELS = Object.freeze({
  guestBedroom: 'Гостевая спальня',
  office: 'Кабинет',
  laundry: 'Постирочная',
  pantry: 'Кладовая продуктов',
  wardrobe: 'Общая гардеробная',
  guestWc: 'Гостевой санузел',
  garage: 'Гараж',
  terrace: 'Терраса',
});

const BEDROOM_KIND_LABELS = Object.freeze({
  main: 'Основная',
  adult: 'Обычная',
  child: 'Детская',
  guest: 'Гостевая',
});

const GUEST_FREQUENCIES = Object.freeze([
  ['rare', 'Редко', 'несколько раз в год'],
  ['monthly', 'Иногда', '1–2 раза в месяц'],
  ['weekly', 'Часто', 'каждую неделю'],
]);

const VISIBLE_OPTION_KEYS = HOME_PROGRAM_OPTION_KEYS.filter((key) => key !== 'guestBedroom');

const STATUS_LABELS = Object.freeze({
  unknown: 'Не задана',
  draft: 'Предварительно',
  incomplete: 'Не хватает',
  ready: 'Готова',
});

const CONNECTION_LABELS = Object.freeze({
  direct: 'Есть прямой проход',
  reachable: 'Есть маршрут через помещения',
  adjacent_without_door: 'Граничит, но нет прохода',
  missing: 'Нет маршрута',
  unknown: 'Недостаточно данных',
});

const DRAWABLE_CONNECTION_STATUSES = new Set([
  'direct', 'reachable', 'adjacent_without_door',
]);

let draftProject = null;
let draftSource = '';
let draft = null;
let draftDirty = false;
let draftError = '';
let activeMission = 'residents';

const PROGRAM_MISSIONS = Object.freeze([
  ['residents', 'Жильцы'],
  ['rooms', 'Комнаты'],
  ['extras', 'Опции'],
  ['plan', 'На плане'],
  ['result', 'Итог'],
]);

const array = (value) => (Array.isArray(value) ? value : []);
const finite = (value) => value !== null && value !== undefined && value !== ''
  && Number.isFinite(Number(value));

function safeCall(fn, fallback) {
  try { return fn(); } catch (error) {
    console.error('Программа дома не рассчиталась:', error);
    return fallback;
  }
}

function sourceSignature(project) {
  const brief = project?.layoutBrief || {};
  return JSON.stringify({
    actors: array(brief.actors).map((actor) => ({
      id: actor?.id, alias: actor?.alias, dataStatus: actor?.dataStatus,
      heightMm: actor?.heightMm, mobilityProfile: actor?.mobilityProfile,
      bodyWidthMm: actor?.bodyWidthMm, bodyDepthMm: actor?.bodyDepthMm,
      sourceRef: actor?.sourceRef,
    })),
    capacity: brief.capacity || null,
    homeProgram: brief.homeProgram || null,
  });
}

function suggestedProgram(project) {
  const result = safeCall(() => suggestHomeProgram(project), {});
  return result?.program || result?.homeProgram || result?.suggestion || result || {};
}

function inputValue(value) {
  return value == null ? '' : String(value);
}

function countValue(value, fallback = 0) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : fallback;
}

function bedroomDrafts(source, suggestion, count, childCount, { useSuggestion = true, legacyGuest = false } = {}) {
  const existing = array(source?.bedrooms).length
    ? source.bedrooms
    : useSuggestion ? array(suggestion?.bedrooms) : [];
  if (existing.length) return existing.slice(0, 30).map((bedroom, index) => ({
    id: String(bedroom?.id || `bedroom-${index + 1}`),
    kind: BEDROOM_KIND_LABELS[bedroom?.kind] ? bedroom.kind : (index === 0 ? 'main' : 'adult'),
    ensuite: typeof bedroom?.ensuite === 'boolean' ? bedroom.ensuite : null,
    wardrobe: typeof bedroom?.wardrobe === 'boolean' ? bedroom.wardrobe : null,
  }));
  const total = Math.max(1, Math.min(30, countValue(count, 1)));
  const childRooms = Math.min(Math.max(0, total - 1), Math.ceil(countValue(childCount) / 2));
  const result = Array.from({ length: total }, (_, index) => ({
    id: `bedroom-${index + 1}`,
    kind: index === 0 ? 'main' : index <= childRooms ? 'child' : 'adult',
    ensuite: null,
    wardrobe: null,
  }));
  // В старой модели «гостевая спальня» была отдельной опцией поверх числа
  // спален жильцов. Не заменяем ею последнюю жилую комнату.
  if (legacyGuest && result.length < 30) result.push({
    id: `bedroom-${result.length + 1}`, kind: 'guest', ensuite: null, wardrobe: null,
  });
  return result;
}

function resizeDraftBedrooms(currentDraft, count) {
  const desired = Math.max(1, Math.min(30, countValue(count, 1)));
  while (currentDraft.bedrooms.length < desired) {
    let suffix = currentDraft.bedrooms.length + 1;
    const used = new Set(currentDraft.bedrooms.map(({ id }) => id));
    while (used.has(`bedroom-${suffix}`)) suffix += 1;
    currentDraft.bedrooms.push({
      id: `bedroom-${suffix}`, kind: currentDraft.bedrooms.length ? 'adult' : 'main',
      ensuite: null, wardrobe: null,
    });
  }
  currentDraft.bedrooms.length = desired;
  currentDraft.bedroomCount = String(desired);
}

function seedDraft(project) {
  const signature = sourceSignature(project);
  if (project !== draftProject) {
    draftProject = project;
    draft = null;
    draftDirty = false;
    draftError = '';
    activeMission = 'residents';
  }
  if (draft && (draftDirty || signature === draftSource)) return draft;

  const brief = project?.layoutBrief || {};
  const saved = brief.homeProgram || null;
  const suggestion = suggestedProgram(project);
  const source = saved || suggestion;
  const actors = array(brief.actors);
  const capacity = brief.capacity || {};
  const profiledChildren = actors.filter((actor) => actor?.mobilityProfile === 'child'
    || actor?.householdGroup === 'child').length;
  const childCount = countValue(capacity.childCount, profiledChildren);
  const adultFallback = actors.length ? Math.max(1, actors.length - childCount) : 2;
  const adultCount = Math.max(1, countValue(capacity.adultCount, adultFallback));
  const dailySeats = adultCount + childCount;
  const guestCount = countValue(capacity.guestCount,
    Math.max(0, countValue(capacity.guestSeats) - countValue(capacity.dailySeats, dailySeats)));
  const legacyGuest = Boolean(saved && !array(saved.bedrooms).length && saved.options?.guestBedroom === true);
  const baseBedroomCount = source.bedroomCount || suggestion.bedroomCount || 1;
  const bedroomCount = Math.min(30, countValue(baseBedroomCount, 1) + (legacyGuest ? 1 : 0));
  draft = {
    adultCount: String(adultCount),
    childCount: String(childCount),
    guestCount: String(guestCount),
    guestFrequency: GUEST_FREQUENCIES.some(([id]) => id === capacity.guestFrequency)
      ? capacity.guestFrequency : 'rare',
    simultaneousCooks: inputValue(capacity.simultaneousCooks ?? 1),
    socialMode: source.socialMode || 'unknown',
    bedroomCount: inputValue(bedroomCount),
    bedrooms: bedroomDrafts(source, suggestion, baseBedroomCount, childCount, {
      useSuggestion: !saved,
      legacyGuest,
    }),
    bathroomCount: inputValue(source.bathroomCount),
    options: Object.fromEntries(HOME_PROGRAM_OPTION_KEYS.map((key) => [
      key, typeof source.options?.[key] === 'boolean' ? source.options[key] : null,
    ])),
    preliminary: saved?.confirmed !== true,
  };
  draftSource = signature;
  draftDirty = false;
  draftError = '';
  return draft;
}

function selectOptions(value, options) {
  return options.map(([id, label]) => `<option value="${escapeHtml(id)}"${String(value) === id ? ' selected' : ''}>${escapeHtml(label)}</option>`).join('');
}

function triStateValue(value) {
  return value === true ? 'yes' : value === false ? 'no' : 'unknown';
}

function statusLabel(status) {
  return STATUS_LABELS[status] || STATUS_LABELS.unknown;
}

function analysisOf(project) {
  return safeCall(() => analyzeHomeProgram(project), {
    status: 'unknown', summary: {}, targets: [], connections: [], levels: [],
    warnings: ['Не удалось выполнить анализ программы дома'],
  });
}

function flowsAnalysisOf(project) {
  return safeCall(() => analyzeHomeFlows(project), {
    zones: { rooms: [], groups: [] }, functionalRoutes: [], scenarios: [],
    summary: {}, warnings: ['Не удалось рассчитать схему связей дома'],
  });
}

function targetRequired(target) {
  return Number(target?.required ?? target?.target ?? target?.count ?? 0) || 0;
}

function targetPresent(target) {
  return Number(target?.present ?? target?.actual ?? target?.existing ?? target?.presentCount ?? 0) || 0;
}

function targetMissing(target) {
  if (finite(target?.missingCount)) return Math.max(0, Number(target.missingCount));
  if (finite(target?.missing)) return Math.max(0, Number(target.missing));
  return Math.max(0, targetRequired(target) - targetPresent(target));
}

function targetRoomType(target) {
  return target?.canonicalType || target?.addType || target?.roomType
    || target?.type || target?.suggestedType || null;
}

function targetArea(target) {
  const value = target?.targetAreaM2 ?? target?.areaM2 ?? target?.recommendedAreaM2;
  return finite(value) ? Number(value) : null;
}

function renderTargets(analysis) {
  const targets = array(analysis?.targets);
  if (!targets.length) {
    return '<p class="home-program-empty">Сначала сохраните состав семьи и программу помещений.</p>';
  }
  return `<div class="home-program-targets">${targets.map((target) => {
    const required = targetRequired(target);
    const present = targetPresent(target);
    const missing = targetMissing(target);
    const type = targetRoomType(target);
    const title = target.title || target.label || roomType(type)?.title || target.id || 'Помещение';
    const area = targetArea(target);
    const stateName = target.source === 'suggested'
      ? 'preliminary' : missing > 0 ? 'missing' : target.status || 'ready';
    return `<article class="home-program-target" data-status="${escapeHtml(stateName)}">
      <div><strong>${escapeHtml(title)}</strong><span>нужно ${required} · есть ${present}${area == null ? '' : ` · площадь ≈ ${area.toLocaleString('ru-RU', { maximumFractionDigits: 1 })} м²`}</span></div>
    </article>`;
  }).join('')}</div>`;
}

function connectionPaths(connection) {
  const paths = array(connection?.paths);
  if (paths.length) return paths;
  const checks = array(connection?.checks);
  return checks.length ? checks : [connection];
}

function connectionPathValue(path, connection, key) {
  return path && Object.prototype.hasOwnProperty.call(path, key)
    ? path[key] : connection?.[key];
}

function resolvedConnectionPaths(result) {
  return array(result?.connections).flatMap((connection) => connectionPaths(connection).map((path) => ({
    status: connectionPathValue(path, connection, 'status'),
    levelId: connectionPathValue(path, connection, 'levelId'),
    fromRoomId: connectionPathValue(path, connection, 'fromRoomId'),
    toRoomId: connectionPathValue(path, connection, 'toRoomId'),
  })));
}

function levelRoomIds(project, levelId) {
  const level = array(project?.levels).find((candidate) => candidate?.id === levelId);
  const rooms = level ? array(level.rooms)
    : levelId === project?.activeLevel ? array(project?.rooms) : [];
  return new Set(rooms.map((room) => room?.id).filter(Boolean));
}

function overlayAvailability(result, project) {
  const activeLevelId = project?.activeLevel || array(project?.levels)[0]?.id || null;
  const roomIdsByLevel = new Map();
  const realPaths = resolvedConnectionPaths(result).filter((path) => {
    if (!DRAWABLE_CONNECTION_STATUSES.has(path.status) || !path.levelId
        || !path.fromRoomId || !path.toRoomId || path.fromRoomId === path.toRoomId) return false;
    if (!roomIdsByLevel.has(path.levelId)) {
      roomIdsByLevel.set(path.levelId, levelRoomIds(project, path.levelId));
    }
    const roomIds = roomIdsByLevel.get(path.levelId);
    return roomIds.has(path.fromRoomId) && roomIds.has(path.toRoomId);
  });
  return {
    active: realPaths.filter((path) => path.levelId === activeLevelId),
    other: realPaths.filter((path) => path.levelId !== activeLevelId),
  };
}

function renderConnections(analysis) {
  const connections = array(analysis?.connections);
  if (!connections.length) {
    return '<p class="home-program-empty">Связи появятся после подтверждения программы и добавления помещений.</p>';
  }
  return `<ul class="home-program-connections">${connections.map((connection) => {
    const paths = connectionPaths(connection);
    const status = connection.status || (paths.every((path) => path.status === 'direct') ? 'direct' : 'unknown');
    const title = connection.title || connection.label || connection.id || 'Функциональная связь';
    const requiredIssue = connection.required === true && connection.acceptable !== true;
    const details = paths.length > 1 ? `<ul>${paths.map((path) => {
      const pathStatus = path.status || 'unknown';
      const hops = Math.max(0, array(path.pathRoomIds).length - 2);
      const text = path.reason || CONNECTION_LABELS[pathStatus] || CONNECTION_LABELS.unknown;
      return `<li data-status="${escapeHtml(pathStatus)}"><span>${escapeHtml(text)}${pathStatus === 'reachable' && hops ? ` · через ${hops}` : ''}</span></li>`;
    }).join('')}</ul>` : '';
    return `<li data-status="${escapeHtml(status)}" data-acceptable="${!requiredIssue}">
      <div><strong>${escapeHtml(title)}</strong><span>${escapeHtml(connection.reason || CONNECTION_LABELS[status] || CONNECTION_LABELS.unknown)}</span>${requiredIssue ? '<span class="home-program-connection-issue">Требует исправления</span>' : ''}</div>
      ${details}
    </li>`;
  }).join('')}</ul>`;
}

function warningsHtml(analysis) {
  const warnings = array(analysis?.warnings).filter((item) => typeof item === 'string' && item.trim());
  return warnings.length ? `<ul class="home-program-warnings">${warnings.map((warning) => `<li>${escapeHtml(warning)}</li>`).join('')}</ul>` : '';
}

const personIcon = (kind) => kind === 'child'
  ? '<svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="13" r="6"/><path d="M15 42l3-14h12l3 14M24 19v15M14 26h20"/></svg>'
  : '<svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="10" r="7"/><path d="M13 43l4-18h14l4 18M24 17v18M12 25h24"/></svg>';

const guestIcon = '<svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="18" cy="14" r="6"/><circle cx="32" cy="17" r="5"/><path d="M8 42l3-17h14l3 17M26 42l2-14h10l3 14"/></svg>';
const cookIcon = '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M10 20h28v20H10zM14 20v-5h20v5M17 29h14M17 35h8"/><circle cx="17" cy="10" r="3"/><circle cx="24" cy="8" r="3"/><circle cx="31" cy="10" r="3"/></svg>';

function stepperHtml(field, value, { min, max, label }) {
  return `<div class="home-program-stepper" role="group" aria-label="${escapeHtml(label)}">
    <button type="button" data-home-program-action="step" data-home-program-step="${escapeHtml(field)}" data-delta="-1" aria-label="Уменьшить: ${escapeHtml(label)}"${Number(value) <= min ? ' disabled' : ''}>−</button>
    <input type="number" inputmode="numeric"${field === 'bedroomCount' ? ' readonly tabindex="-1"' : ''} min="${min}" max="${max}" value="${escapeHtml(String(value))}" data-home-program-field="${escapeHtml(field)}" aria-label="${escapeHtml(label)}">
    <button type="button" data-home-program-action="step" data-home-program-step="${escapeHtml(field)}" data-delta="1" aria-label="Добавить: ${escapeHtml(label)}"${Number(value) >= max ? ' disabled' : ''}>+</button>
  </div>`;
}

function triStateHtml(value, { name, label, attributes }) {
  const current = triStateValue(value);
  const states = [
    ['yes', '✓', 'Нужно'],
    ['no', '×', 'Не нужно'],
    ['unknown', '?', 'Ещё не решено'],
  ];
  return `<fieldset class="home-program-tristate"><legend>${escapeHtml(label)}</legend><div role="radiogroup" aria-label="${escapeHtml(label)}">
    ${states.map(([id, symbol, title]) => `<label data-state="${id}" title="${escapeHtml(title)}">
      <input type="radio" name="${escapeHtml(name)}" value="${id}" ${attributes}${current === id ? ' checked' : ''} aria-label="${escapeHtml(`${label}: ${title}`)}">
      <span aria-hidden="true">${symbol}</span><span class="sr-only">${escapeHtml(title)}</span>
    </label>`).join('')}
  </div></fieldset>`;
}

function scenarioHtml(currentDraft) {
  const adults = countValue(currentDraft.adultCount, 1);
  const children = countValue(currentDraft.childCount);
  const guests = countValue(currentDraft.guestCount);
  const residents = adults + children;
  const totalAtTable = residents + guests;
  const guestFrequency = GUEST_FREQUENCIES.find(([id]) => id === currentDraft.guestFrequency)?.[1]
    ?.toLocaleLowerCase('ru-RU') || 'редко';
  return `<div class="home-program-scenario-grid home-program-people-grid">
    <article class="home-program-person-card">
      <span class="home-program-scenario-icon">${personIcon('adult')}</span>
      <div class="home-program-scenario-copy"><strong>Взрослые</strong></div>
      ${stepperHtml('adultCount', adults, { min: 1, max: 20, label: 'Количество взрослых' })}
    </article>
    <article class="home-program-person-card">
      <span class="home-program-scenario-icon child">${personIcon('child')}</span>
      <div class="home-program-scenario-copy"><strong>Дети</strong></div>
      ${stepperHtml('childCount', children, { min: 0, max: 20, label: 'Количество детей' })}
    </article>
    <article class="home-program-person-card home-program-guests">
      <span class="home-program-scenario-icon">${guestIcon}</span>
      <div class="home-program-scenario-copy"><strong>Гости <small>(${escapeHtml(guestFrequency)})</small></strong></div>
      ${stepperHtml('guestCount', guests, { min: 0, max: 30, label: 'Количество гостей одновременно' })}
    </article>
  </div>
  <details class="home-program-more">
    <summary>Подробнее</summary>
    <div class="home-program-more-body">
      <div class="home-program-capacity-summary">
        <span>Мест за столом в будни <strong data-program-seats="daily">${residents}</strong></span>
        <span${guests ? '' : ' hidden'}>С гостями <strong data-program-seats="guests">${totalAtTable}</strong></span>
      </div>
      <div class="home-program-presets" aria-label="Быстрый выбор количества гостей">
        ${[0, 2, 5, 10].map((value) => `<button type="button" data-home-program-action="guest-preset" data-home-program-preset="${value}" aria-pressed="${guests === value}">${value === 0 ? 'Без гостей' : `до ${value}`}</button>`).join('')}
        <button type="button" data-home-program-action="guest-preset" data-home-program-preset="11" aria-pressed="${guests > 10}">10+</button>
      </div>
      <fieldset class="home-program-frequency"${guests ? '' : ' hidden'}><legend>Как часто принимаете гостей</legend><div>
        ${GUEST_FREQUENCIES.map(([id, title, note]) => `<label><input type="radio" name="home-program-guest-frequency" value="${id}" data-home-program-field="guestFrequency"${currentDraft.guestFrequency === id ? ' checked' : ''}><span><strong>${title}</strong><small>${note}</small></span></label>`).join('')}
      </div></fieldset>
      <article class="home-program-scenario-card home-program-cooks">
        <span class="home-program-scenario-icon">${cookIcon}</span>
        <div class="home-program-scenario-copy"><strong>Готовят вместе</strong></div>
        ${stepperHtml('simultaneousCooks', countValue(currentDraft.simultaneousCooks, 1), { min: 1, max: 6, label: 'Количество одновременно готовящих' })}
      </article>
    </div>
  </details>`;
}

function missionStatus(id, { currentDraft, analysis, saved }) {
  if (id === 'residents') return countValue(currentDraft.adultCount, 0) > 0 ? 'done' : 'unknown';
  if (id === 'rooms') {
    return currentDraft.socialMode !== 'unknown' && finite(currentDraft.bathroomCount)
      && currentDraft.bedrooms.length ? 'done' : 'unknown';
  }
  if (id === 'extras') {
    return VISIBLE_OPTION_KEYS.every((key) => typeof currentDraft.options[key] === 'boolean') ? 'done' : 'unknown';
  }
  if (id === 'plan') return analysis?.status === 'ready' ? 'done' : analysis?.status === 'incomplete' ? 'attention' : 'unknown';
  return saved?.confirmed === true ? 'done' : 'unknown';
}

function missionSection(id, note, html, context) {
  const index = PROGRAM_MISSIONS.findIndex(([missionId]) => missionId === id);
  const label = PROGRAM_MISSIONS[index]?.[1] || id;
  const status = missionStatus(id, context);
  const statusLabel = status === 'done' ? 'Готово' : status === 'attention' ? 'Нужно проверить' : 'Не заполнено';
  return `<details class="home-mission-section home-program-mission" data-analysis-fold="${id}" data-status="${status}"${activeMission === id ? ' open' : ''}>
    <summary class="home-mission-summary" data-home-program-action="mission" data-home-program-mission="${id}">
      <span class="home-mission-index">${index + 1}</span>
      <span><strong>${escapeHtml(label)}</strong><small>${escapeHtml(note)}</small></span>
      <i class="home-mission-state" aria-label="${statusLabel}">${status === 'done' ? '✓' : status === 'attention' ? '!' : '?'}</i>
    </summary>
    <div class="home-mission-body">${html}</div>
  </details>`;
}

function bedroomsHtml(currentDraft) {
  return `<section class="home-program-bedrooms">
    <header><div><strong>Спальни</strong></div>
      ${stepperHtml('bedroomCount', currentDraft.bedrooms.length, { min: 1, max: 30, label: 'Количество спален' })}
    </header>
    <div class="home-program-bedroom-list" role="list">
      ${currentDraft.bedrooms.map((bedroom, index) => `<article class="home-program-bedroom-row" role="listitem" data-bedroom-id="${escapeHtml(bedroom.id)}">
        <label class="home-program-bedroom-type"><span>Спальня ${index + 1}</span><select data-home-program-bedroom="${escapeHtml(bedroom.id)}" data-bedroom-field="kind" aria-label="Тип спальни ${index + 1}">
          ${selectOptions(bedroom.kind, Object.entries(BEDROOM_KIND_LABELS))}
        </select></label>
        ${triStateHtml(bedroom.ensuite, {
    name: `${bedroom.id}-ensuite`, label: 'Свой санузел',
    attributes: `data-home-program-bedroom="${escapeHtml(bedroom.id)}" data-bedroom-field="ensuite"`,
  })}
        ${triStateHtml(bedroom.wardrobe, {
    name: `${bedroom.id}-wardrobe`, label: 'Гардеробная',
    attributes: `data-home-program-bedroom="${escapeHtml(bedroom.id)}" data-bedroom-field="wardrobe"`,
  })}
      </article>`).join('')}
    </div>
  </section>`;
}

function optionsHtml(currentDraft) {
  return `<div class="home-program-option-cards">${VISIBLE_OPTION_KEYS.map((key) => `<article class="home-program-option-card">
    <strong>${escapeHtml(OPTION_LABELS[key] || key)}</strong>
    ${triStateHtml(currentDraft.options[key], {
    name: `home-program-option-${key}`, label: OPTION_LABELS[key] || key,
    attributes: `data-home-program-option="${escapeHtml(key)}"`,
  })}
  </article>`).join('')}</div>`;
}

export function homeProgramHtml(project) {
  const currentDraft = seedDraft(project);
  const analysis = analysisOf(project);
  const summary = analysis?.summary || {};
  const status = analysis?.status || 'unknown';
  const saved = project?.layoutBrief?.homeProgram;
  const suggestion = suggestedProgram(project);
  const proposedBathrooms = suggestion.bathroomCount;
  const overlayOn = Boolean(state.homeProgramOverlay?.on
    && state.homeProgramOverlay?.mode !== 'flows');
  const missionContext = { currentDraft, analysis, saved };
  const activeIndex = Math.max(0, PROGRAM_MISSIONS.findIndex(([id]) => id === activeMission));
  const nextMission = PROGRAM_MISSIONS[Math.min(PROGRAM_MISSIONS.length - 1, activeIndex + 1)]?.[0] || 'result';
  const summaryHtml = summary.total ? `<div class="home-program-summary" data-status="${escapeHtml(status)}">
    <div><strong>${statusLabel(status)}</strong><span>Помещения на плане</span>
      ${summary.accessIssueCount ? `<small>Проблем с доступом · ${Number(summary.accessIssueCount)}</small>` : ''}
      ${summary.connectionIssues ? `<small>Проблем со связями · ${Number(summary.connectionIssues)}</small>` : ''}
    </div>
    <span>${Number(summary.present ?? summary.complete ?? 0) || 0} / ${Number(summary.total ?? array(analysis?.targets).length) || 0}</span>
  </div>` : '';
  return `<div class="home-program" data-home-program>
    ${draftError ? `<p class="home-program-error" role="alert" tabindex="-1">${escapeHtml(draftError)}</p>` : ''}
    <form id="homeProgramForm" novalidate>
      ${missionSection('residents', 'Кто будет жить в доме', `
        <div class="home-mission-callout home-program-mission-callout">
          <span class="home-program-scenario-icon" aria-hidden="true">${personIcon('adult')}</span>
          <div><strong>Миссия</strong><span>Укажите, кто будет жить в доме.</span></div>
        </div>
        <fieldset class="home-program-fieldset home-program-residents"><legend class="sr-only">Жильцы и гости</legend>${scenarioHtml(currentDraft)}</fieldset>
      `, missionContext)}
      ${missionSection('rooms', 'Основной состав помещений', `
        <fieldset class="home-program-fieldset"><legend class="sr-only">Основные помещения</legend>
          <div class="home-program-grid home-program-main-grid">
            <label class="prop-field"><span>Кухня и гостиная</span><select data-home-program-field="socialMode">${selectOptions(currentDraft.socialMode, [
    ['unknown', 'Не решено'], ['combined', 'Вместе'], ['separate', 'Раздельно'],
  ])}</select></label>
            <label class="prop-field"><span>Общих санузлов${finite(proposedBathrooms) ? ` · предложено ${Number(proposedBathrooms)}` : ''}</span><input type="number" min="1" max="20" step="1" data-home-program-field="bathroomCount" value="${escapeHtml(currentDraft.bathroomCount)}"></label>
          </div>
          ${bedroomsHtml(currentDraft)}
        </fieldset>
      `, missionContext)}
      ${missionSection('extras', 'Необязательные комнаты', `
        <fieldset class="home-program-fieldset"><legend class="sr-only">Дополнительные помещения</legend>${optionsHtml(currentDraft)}</fieldset>
      `, missionContext)}
      ${missionSection('plan', 'Что уже есть на плане', `
        <section class="home-program-section" aria-labelledby="homeProgramTargetsTitle">
          <div class="home-program-section-head"><h3 id="homeProgramTargetsTitle">Помещения на плане</h3></div>
          ${renderTargets(analysis)}
        </section>
      `, missionContext)}
      ${missionSection('result', 'Проверка и сохранение', `
        ${summaryHtml}
        ${currentDraft.preliminary || saved?.confirmed !== true ? '<p class="home-program-preliminary"><strong>Черновик.</strong> Проверьте решения и сохраните программу.</p>' : ''}
        <section class="home-program-section" aria-labelledby="homeProgramLinksTitle">
          <div class="home-program-section-head"><h3 id="homeProgramLinksTitle">Проходы между комнатами</h3>
            <button type="button" class="project-route-switch" role="switch" aria-checked="${overlayOn}" data-home-program-action="toggle-overlay"><span aria-hidden="true"></span>${overlayOn ? 'Показаны' : 'Показать на плане'}</button>
          </div>
          ${renderConnections(analysis)}
        </section>
        ${warningsHtml(analysis)}
      `, missionContext)}
      <div class="home-program-savebar">
        ${activeMission === 'result'
    ? '<button type="button" class="primary" data-home-program-action="save">Сохранить программу</button>'
    : `<button type="button" class="primary" data-home-program-action="next-mission" data-home-program-mission="${nextMission}">Далее <span aria-hidden="true">→</span></button>`}
      </div>
    </form>
  </div>`;
}

export function handleHomeProgramInput(event) {
  const field = event.target?.closest?.('[data-home-program-field], [data-home-program-option], [data-home-program-bedroom]');
  if (!field || !field.closest('[data-home-program]') || !state.project) return false;
  const currentDraft = seedDraft(state.project);
  if (field.dataset.homeProgramOption) {
    currentDraft.options[field.dataset.homeProgramOption] = field.value === 'yes'
      ? true : field.value === 'no' ? false : null;
  } else if (field.dataset.homeProgramBedroom) {
    const bedroom = currentDraft.bedrooms.find(({ id }) => id === field.dataset.homeProgramBedroom);
    if (!bedroom) return false;
    const key = field.dataset.bedroomField;
    if (key === 'kind' && BEDROOM_KIND_LABELS[field.value]) bedroom.kind = field.value;
    else if (key === 'ensuite' || key === 'wardrobe') {
      bedroom[key] = field.value === 'yes' ? true : field.value === 'no' ? false : null;
    } else return false;
  } else if (field.dataset.homeProgramField) {
    currentDraft[field.dataset.homeProgramField] = field.value;
    const stepper = field.closest('.home-program-stepper');
    if (stepper) {
      stepper.querySelector('[data-delta="-1"]').disabled = Number(field.value) <= Number(field.min);
      stepper.querySelector('[data-delta="1"]').disabled = Number(field.value) >= Number(field.max);
    }
    if (['adultCount', 'childCount', 'guestCount'].includes(field.dataset.homeProgramField)) {
      const panel = field.closest('[data-home-program]');
      const guests = countValue(currentDraft.guestCount);
      const residents = countValue(currentDraft.adultCount) + countValue(currentDraft.childCount);
      const guestSeats = panel.querySelector('[data-program-seats="guests"]');
      panel.querySelector('[data-program-seats="daily"]').textContent = residents;
      guestSeats.textContent = guests + residents;
      guestSeats.parentElement.hidden = !guests;
      panel.querySelector('.home-program-frequency').hidden = !guests;
      for (const preset of panel.querySelectorAll('[data-home-program-preset]')) {
        const value = Number(preset.dataset.homeProgramPreset);
        preset.setAttribute('aria-pressed', String(value === 11 ? guests > 10 : value === guests));
      }
    }
  }
  currentDraft.preliminary = true;
  draftDirty = true;
  draftError = '';
  return true;
}

function optionalInteger(value, { min = 0, max = 100 } = {}) {
  if (String(value ?? '').trim() === '') return null;
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) return NaN;
  return number;
}

function isPlaceholderActor(actor) {
  const defaultAlias = /^Жилец\s+\d+$/u.test(String(actor?.alias || ''));
  return (actor?.dataStatus == null || actor.dataStatus === 'unknown')
    && (actor?.mobilityProfile == null || actor.mobilityProfile === 'unknown')
    && actor?.heightMm == null && actor?.bodyWidthMm == null && actor?.bodyDepthMm == null
    && actor?.bodyFootprintLocalMm == null
    && !actor?.sourceRef && !array(actor?.carriedObjectIds).length && defaultAlias;
}

function addPlaceholderActor(brief) {
  brief.actors.push({
    id: makeId('actor'), alias: `Жилец ${brief.actors.length + 1}`,
    heightMm: null, mobilityProfile: 'unknown', bodyWidthMm: null, bodyDepthMm: null,
    carriedObjectIds: [], dataStatus: 'unknown', sourceRef: null,
  });
}

function removeActorReferences(brief, removedIds) {
  if (!removedIds.size) return;
  for (const entry of array(brief.storageInventory)) {
    entry.ownerActorIds = array(entry.ownerActorIds).filter((id) => !removedIds.has(id));
  }
  for (const entry of array(brief.scenarioSelections)) {
    entry.actorPersonIds = array(entry.actorPersonIds).filter((id) => !removedIds.has(id));
  }
  for (const entry of array(brief.uncertainty)) {
    if (removedIds.has(entry.targetId)) entry.targetId = null;
  }
}

function resizeActors(brief, desired) {
  if (desired == null) return { ok: true };
  while (brief.actors.length < desired) addPlaceholderActor(brief);
  if (brief.actors.length <= desired) return { ok: true };
  const need = brief.actors.length - desired;
  const trailing = [];
  for (let index = brief.actors.length - 1; index >= 0; index -= 1) {
    if (!isPlaceholderActor(brief.actors[index])) break;
    trailing.push(brief.actors[index]);
  }
  if (trailing.length < need) {
    return { ok: false, message: 'Нельзя уменьшить число жильцов: у части записей уже есть подробные данные. Удалите их в расширенных исходных данных.' };
  }
  const removed = brief.actors.splice(desired, need);
  const removedIds = new Set(removed.map((actor) => actor.id));
  removeActorReferences(brief, removedIds);
  return { ok: true };
}

function validateDraft(currentDraft) {
  const values = {
    adultCount: optionalInteger(currentDraft.adultCount, { min: 1, max: 20 }),
    childCount: optionalInteger(currentDraft.childCount, { min: 0, max: 20 }),
    guestCount: optionalInteger(currentDraft.guestCount, { min: 0, max: 30 }),
    simultaneousCooks: optionalInteger(currentDraft.simultaneousCooks, { min: 1, max: 6 }),
    bedroomCount: currentDraft.bedrooms.length,
    bathroomCount: optionalInteger(currentDraft.bathroomCount, { min: 1, max: 20 }),
  };
  if (Object.values(values).some(Number.isNaN)) {
    return { ok: false, message: 'Проверьте количества: нужны целые числа в указанных диапазонах.' };
  }
  if (!GUEST_FREQUENCIES.some(([id]) => id === currentDraft.guestFrequency)) {
    return { ok: false, message: 'Укажите, как часто вы принимаете гостей.' };
  }
  values.actorCount = values.adultCount + values.childCount;
  values.dailySeats = values.actorCount;
  values.guestSeats = values.actorCount + values.guestCount;
  values.guestFrequency = currentDraft.guestFrequency;
  return { ok: true, values };
}

function saveProgram({ rerender } = {}) {
  if (!state.project) return false;
  const currentDraft = seedDraft(state.project);
  const validation = validateDraft(currentDraft);
  if (!validation.ok) {
    draftError = validation.message;
    rerender?.();
    requestAnimationFrame(() => document.querySelector('.home-program-error')?.focus({ preventScroll: true }));
    return false;
  }
  const currentActors = array(state.project.layoutBrief?.actors);
  if (validation.values.actorCount != null && validation.values.actorCount < currentActors.length) {
    let trailingPlaceholders = 0;
    for (let index = currentActors.length - 1; index >= 0; index -= 1) {
      if (!isPlaceholderActor(currentActors[index])) break;
      trailingPlaceholders += 1;
    }
    if (validation.values.actorCount < currentActors.length - trailingPlaceholders) {
      draftError = 'Можно удалить только пустые записи «Жилец» в конце списка. Подробные записи не удалены.';
      rerender?.();
      requestAnimationFrame(() => document.querySelector('.home-program-error')?.focus({ preventScroll: true }));
      return false;
    }
  }

  let resizeError = '';
  const changed = mutate(() => {
    const brief = ensureLayoutBrief(state.project);
    const resized = resizeActors(brief, validation.values.actorCount);
    if (!resized.ok) { resizeError = resized.message; return; }
    brief.capacity.adultCount = validation.values.adultCount;
    brief.capacity.childCount = validation.values.childCount;
    brief.capacity.dailySeats = validation.values.dailySeats;
    brief.capacity.guestCount = validation.values.guestCount;
    brief.capacity.guestSeats = validation.values.guestSeats;
    brief.capacity.guestFrequency = validation.values.guestFrequency;
    brief.capacity.simultaneousCooks = validation.values.simultaneousCooks;
    brief.homeProgram = {
      confirmed: true,
      socialMode: currentDraft.socialMode || 'unknown',
      bedroomCount: validation.values.bedroomCount,
      bedrooms: currentDraft.bedrooms.map((bedroom) => ({ ...bedroom })),
      bathroomCount: validation.values.bathroomCount,
      options: Object.fromEntries(HOME_PROGRAM_OPTION_KEYS.map((key) => [
        key, key === 'guestBedroom'
          ? currentDraft.bedrooms.some(({ kind }) => kind === 'guest')
          : currentDraft.options[key] ?? null,
      ])),
    };
  });
  if (!changed || resizeError) {
    draftError = resizeError || 'Не удалось сохранить программу дома.';
    rerender?.();
    requestAnimationFrame(() => document.querySelector('.home-program-error')?.focus({ preventScroll: true }));
    return false;
  }
  draftDirty = false;
  draft = null;
  draftSource = '';
  draftError = '';
  refreshHomeProgramOverlay();
  toast('Программа дома сохранена');
  rerender?.();
  requestAnimationFrame(() => document.querySelector('[data-home-program-action="save"]')?.focus({ preventScroll: true }));
  return true;
}

function toggleOverlay({ closePanel, announce, rerender } = {}) {
  const on = Boolean(state.homeProgramOverlay?.on
    && state.homeProgramOverlay?.mode !== 'flows');
  if (on) {
    state.homeProgramOverlay = {
      on: false, mode: 'program', zones: false, routes: true, problemsOnly: false,
      selectedScenarioId: null, result: null, signature: null,
    };
    state._homeProgramUI = null;
    state._homeFlowsUI = null;
    requestDraw();
    rerender?.();
    requestAnimationFrame(() => document.querySelector('[data-home-program-action="toggle-overlay"]')?.focus({ preventScroll: true }));
    announce?.('Схема функциональных связей скрыта');
    return true;
  }
  const result = analysisOf(state.project);
  const availability = overlayAvailability(result, state.project);
  if (!availability.active.length) {
    if (availability.other.length) {
      toast('Связи есть на другом этаже — переключитесь на нужный этаж', true);
      announce?.('Связи есть только на другом этаже; переключитесь на нужный этаж');
      return false;
    }
    toast('Сначала добавьте связанные помещения и двери', true);
    announce?.('Схему связей пока нельзя показать');
    return false;
  }
  state.homeEngineeringOverlay = { on: false, result: null, signature: null };
  state._homeEngineeringUI = null;
  state.homeProgramOverlay = {
    on: true, mode: 'program', zones: false, routes: true, problemsOnly: false,
    selectedScenarioId: null, result: flowsAnalysisOf(state.project),
    signature: sourceSignature(state.project),
  };
  closePanel?.({ restoreFocus: false });
  setEditorMode('plan');
  requestDraw();
  rerender?.();
  toast('Показана схема функциональных связей');
  announce?.('Схема функциональных связей показана на плане');
  return true;
}

export function handleHomeProgramClick(event, callbacks = {}) {
  const button = event.target?.closest?.('[data-home-program-action]');
  if (!button || !button.closest('[data-home-program]')) return false;
  const action = button.dataset.homeProgramAction;
  if (action === 'mission' || action === 'next-mission') {
    const mission = button.dataset.homeProgramMission;
    if (!PROGRAM_MISSIONS.some(([id]) => id === mission)) return false;
    activeMission = mission;
    const panel = button.closest('[data-home-program]');
    for (const section of panel?.querySelectorAll('.home-program-mission') || []) {
      if (section.dataset.analysisFold !== mission) section.open = false;
    }
    if (action === 'next-mission') {
      const target = panel?.querySelector(`[data-analysis-fold="${mission}"]`);
      if (target) target.open = true;
      callbacks.rerender?.();
      requestAnimationFrame(() => document.querySelector(`[data-home-program-mission="${mission}"]`)?.focus({ preventScroll: true }));
    }
    return true;
  }
  if (action === 'step' || action === 'guest-preset') {
    const currentDraft = seedDraft(state.project);
    const field = action === 'step' ? button.dataset.homeProgramStep : 'guestCount';
    const bounds = {
      adultCount: [1, 20], childCount: [0, 20], guestCount: [0, 30],
      simultaneousCooks: [1, 6], bedroomCount: [1, 30],
    }[field];
    if (!bounds) return false;
    const current = field === 'bedroomCount'
      ? currentDraft.bedrooms.length : countValue(currentDraft[field], bounds[0]);
    const requested = action === 'guest-preset'
      ? countValue(button.dataset.homeProgramPreset, current)
      : current + Number(button.dataset.delta || 0);
    const next = Math.max(bounds[0], Math.min(bounds[1], requested));
    if (field === 'bedroomCount') resizeDraftBedrooms(currentDraft, next);
    else currentDraft[field] = String(next);
    currentDraft.preliminary = true;
    draftDirty = true;
    draftError = '';
    callbacks.rerender?.();
    requestAnimationFrame(() => {
      const selector = action === 'guest-preset'
        ? `[data-home-program-preset="${button.dataset.homeProgramPreset}"]`
        : `[data-home-program-step="${field}"][data-delta="${button.dataset.delta}"]`;
      document.querySelector(selector)?.focus({ preventScroll: true });
    });
    return true;
  }
  if (action === 'save') return saveProgram(callbacks);
  if (action === 'toggle-overlay') return toggleOverlay(callbacks);
  return false;
}

export function resetHomeProgramDraft(project = null) {
  draftProject = project;
  draftSource = '';
  draft = null;
  draftDirty = false;
  draftError = '';
}

export function refreshHomeProgramOverlay() {
  if (!state.project || !state.homeProgramOverlay?.on
    || state.homeProgramOverlay?.mode === 'flows') return null;
  const programResult = analysisOf(state.project);
  const availability = overlayAvailability(programResult, state.project);
  if (!availability.active.length) {
    state.homeProgramOverlay = {
      ...state.homeProgramOverlay, on: false, result: null, signature: null,
    };
    state._homeProgramUI = null;
    state._homeFlowsUI = null;
    requestDraw();
    return programResult;
  }
  const result = flowsAnalysisOf(state.project);
  state.homeProgramOverlay = {
    ...state.homeProgramOverlay,
    on: true,
    mode: 'program',
    zones: false,
    routes: true,
    result,
    signature: sourceSignature(state.project),
  };
  requestDraw();
  return result;
}
