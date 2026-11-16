// Компактный редактор «Программы дома» для общего маршрута проекта.
// Расчёт остаётся в core/home-program.js; здесь только локальный черновик,
// явное сохранение и запуск существующего инструмента помещения.

import { roomType } from '../core/catalog.js';
import { analyzeHomeProgram, suggestHomeProgram } from '../core/home-program.js';
import {
  ensureLayoutBrief, HOME_PROGRAM_OPTION_KEYS,
} from '../core/layout-brief.js';
import { makeId } from '../core/model.js';
import { escapeHtml, toast } from './dom.js';
import { setEditorMode } from './modes.js';
import { state } from './state.js';
import { mutate } from './store.js';
import { startPlaceRoom } from './tools.js';
import { requestDraw } from './view.js';

const OPTION_LABELS = Object.freeze({
  guestBedroom: 'Гостевая спальня',
  office: 'Кабинет',
  laundry: 'Постирочная',
  pantry: 'Кладовая продуктов',
  wardrobe: 'Гардеробная',
  guestWc: 'Гостевой санузел',
  garage: 'Гараж',
  terrace: 'Терраса',
});

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

function seedDraft(project) {
  const signature = sourceSignature(project);
  if (project !== draftProject) {
    draftProject = project;
    draft = null;
    draftDirty = false;
    draftError = '';
  }
  if (draft && (draftDirty || signature === draftSource)) return draft;

  const brief = project?.layoutBrief || {};
  const saved = brief.homeProgram || null;
  const suggestion = suggestedProgram(project);
  const source = saved || suggestion;
  draft = {
    actorCount: inputValue(array(brief.actors).length || suggestion.actorCount || suggestion.occupantCount || ''),
    dailySeats: inputValue(brief.capacity?.dailySeats),
    guestSeats: inputValue(brief.capacity?.guestSeats),
    simultaneousCooks: inputValue(brief.capacity?.simultaneousCooks),
    socialMode: source.socialMode || 'unknown',
    bedroomCount: inputValue(source.bedroomCount),
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

function triStateOptions(value) {
  return selectOptions(triStateValue(value), [
    ['unknown', 'Не решено'], ['yes', 'Нужно'], ['no', 'Не нужно'],
  ]);
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
      ${missing > 0 && type ? `<button type="button" data-home-program-action="add-room" data-room-type="${escapeHtml(type)}">Добавить ${escapeHtml(String(title).toLocaleLowerCase('ru-RU'))} на план</button>` : ''}
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

export function homeProgramHtml(project) {
  const currentDraft = seedDraft(project);
  const analysis = analysisOf(project);
  const status = analysis?.status || 'unknown';
  const saved = project?.layoutBrief?.homeProgram;
  const suggestion = suggestedProgram(project);
  const proposedBedrooms = suggestion.bedroomCount;
  const proposedBathrooms = suggestion.bathroomCount;
  const overlayOn = Boolean(state.homeProgramOverlay?.on);
  const optionFields = HOME_PROGRAM_OPTION_KEYS.map((key) => `<label class="prop-field"><span>${escapeHtml(OPTION_LABELS[key] || key)}</span><select data-home-program-option="${escapeHtml(key)}">${triStateOptions(currentDraft.options[key])}</select></label>`).join('');

  return `<div class="home-program" data-home-program>
    <div class="home-program-summary" data-status="${escapeHtml(status)}">
      <div><strong>${statusLabel(status)}</strong><span>${escapeHtml(analysis?.summary?.text || analysis?.summary?.label || 'Программа сравнивает пожелания с фактическим планом.')}</span></div>
      <span>${Number(analysis?.summary?.present ?? analysis?.summary?.complete ?? 0) || 0} / ${Number(analysis?.summary?.total ?? array(analysis?.targets).length) || 0}</span>
    </div>
    ${currentDraft.preliminary || saved?.confirmed !== true ? `<p class="home-program-preliminary"><strong>Предварительно предложено системой.</strong> Проверьте значения и сохраните — до этого они не считаются требованиями.</p>` : ''}
    ${draftError ? `<p class="home-program-error" role="alert" tabindex="-1">${escapeHtml(draftError)}</p>` : ''}
    <form id="homeProgramForm" novalidate>
      <fieldset class="home-program-fieldset">
        <legend>Состав и сценарий</legend>
        <div class="home-program-grid">
          <label class="prop-field"><span>Жильцов</span><input type="number" min="1" max="30" step="1" data-home-program-field="actorCount" value="${escapeHtml(currentDraft.actorCount)}"></label>
          <label class="prop-field"><span>Ежедневных мест</span><input type="number" min="0" max="100" step="1" data-home-program-field="dailySeats" value="${escapeHtml(currentDraft.dailySeats)}"></label>
          <label class="prop-field"><span>Гостевых мест</span><input type="number" min="0" max="100" step="1" data-home-program-field="guestSeats" value="${escapeHtml(currentDraft.guestSeats)}"></label>
          <label class="prop-field"><span>Одновременно готовят</span><input type="number" min="1" max="20" step="1" data-home-program-field="simultaneousCooks" value="${escapeHtml(currentDraft.simultaneousCooks)}"></label>
        </div>
      </fieldset>
      <fieldset class="home-program-fieldset">
        <legend>Основные помещения</legend>
        <div class="home-program-grid">
          <label class="prop-field"><span>Кухня и гостиная</span><select data-home-program-field="socialMode">${selectOptions(currentDraft.socialMode, [
    ['unknown', 'Не решено'], ['combined', 'Вместе'], ['separate', 'Раздельно'],
  ])}</select></label>
          <label class="prop-field"><span>Спален${finite(proposedBedrooms) ? ` · предложено ${Number(proposedBedrooms)}` : ''}</span><input type="number" min="1" max="30" step="1" data-home-program-field="bedroomCount" value="${escapeHtml(currentDraft.bedroomCount)}"></label>
          <label class="prop-field"><span>Основных санузлов${finite(proposedBathrooms) ? ` · предложено ${Number(proposedBathrooms)}` : ''}</span><input type="number" min="1" max="20" step="1" data-home-program-field="bathroomCount" value="${escapeHtml(currentDraft.bathroomCount)}"></label>
        </div>
      </fieldset>
      <fieldset class="home-program-fieldset">
        <legend>Дополнительные помещения</legend>
        <div class="home-program-grid home-program-options">${optionFields}</div>
      </fieldset>
      <div class="home-program-savebar">
        <button type="button" class="primary" data-home-program-action="save">Сохранить программу</button>
      </div>
    </form>
    <section class="home-program-section" aria-labelledby="homeProgramTargetsTitle">
      <div class="home-program-section-head"><div><h3 id="homeProgramTargetsTitle">Помещения</h3><p>Сравнение программы с комнатами на всех этажах.</p></div></div>
      ${renderTargets(analysis)}
    </section>
    <section class="home-program-section" aria-labelledby="homeProgramLinksTitle">
      <div class="home-program-section-head"><div><h3 id="homeProgramLinksTitle">Связи дома</h3><p>Логические связи по реальным дверям и проёмам, не траектории ходьбы.</p></div>
        <button type="button" class="project-route-switch" role="switch" aria-checked="${overlayOn}" data-home-program-action="toggle-overlay"><span aria-hidden="true"></span>${overlayOn ? 'Показаны' : 'Показать на плане'}</button>
      </div>
      ${renderConnections(analysis)}
    </section>
    ${warningsHtml(analysis)}
  </div>`;
}

export function handleHomeProgramInput(event) {
  const field = event.target?.closest?.('[data-home-program-field], [data-home-program-option]');
  if (!field || !field.closest('[data-home-program]') || !state.project) return false;
  const currentDraft = seedDraft(state.project);
  if (field.dataset.homeProgramOption) {
    currentDraft.options[field.dataset.homeProgramOption] = field.value === 'yes'
      ? true : field.value === 'no' ? false : null;
  } else if (field.dataset.homeProgramField) {
    currentDraft[field.dataset.homeProgramField] = field.value;
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
    actorCount: optionalInteger(currentDraft.actorCount, { min: 1, max: 30 }),
    dailySeats: optionalInteger(currentDraft.dailySeats, { min: 0, max: 100 }),
    guestSeats: optionalInteger(currentDraft.guestSeats, { min: 0, max: 100 }),
    simultaneousCooks: optionalInteger(currentDraft.simultaneousCooks, { min: 1, max: 20 }),
    bedroomCount: optionalInteger(currentDraft.bedroomCount, { min: 1, max: 30 }),
    bathroomCount: optionalInteger(currentDraft.bathroomCount, { min: 1, max: 20 }),
  };
  if (Object.values(values).some(Number.isNaN)) {
    return { ok: false, message: 'Проверьте количества: нужны целые числа в указанных диапазонах.' };
  }
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
    brief.capacity.dailySeats = validation.values.dailySeats;
    brief.capacity.guestSeats = validation.values.guestSeats;
    brief.capacity.simultaneousCooks = validation.values.simultaneousCooks;
    brief.homeProgram = {
      confirmed: true,
      socialMode: currentDraft.socialMode || 'unknown',
      bedroomCount: validation.values.bedroomCount,
      bathroomCount: validation.values.bathroomCount,
      options: Object.fromEntries(HOME_PROGRAM_OPTION_KEYS.map((key) => [key, currentDraft.options[key] ?? null])),
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

function addRoom(button, { closePanel, announce } = {}) {
  const type = button.dataset.roomType;
  const definition = roomType(type);
  if (!definition) {
    toast('Не удалось определить тип помещения', true);
    return false;
  }
  closePanel?.({ restoreFocus: false });
  setEditorMode('plan');
  startPlaceRoom(type);
  toast(`Разместите «${definition.title}» на плане`);
  announce?.(`Включён инструмент: ${definition.title}`);
  return true;
}

function toggleOverlay({ closePanel, announce, rerender } = {}) {
  const on = Boolean(state.homeProgramOverlay?.on);
  if (on) {
    state.homeProgramOverlay = { on: false, result: null, signature: null };
    state._homeProgramUI = null;
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
  state.homeProgramOverlay = { on: true, result, signature: sourceSignature(state.project) };
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
  if (action === 'save') return saveProgram(callbacks);
  if (action === 'add-room') return addRoom(button, callbacks);
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
  if (!state.project || !state.homeProgramOverlay?.on) return null;
  const result = analysisOf(state.project);
  const availability = overlayAvailability(result, state.project);
  if (!availability.active.length) {
    state.homeProgramOverlay = { on: false, result: null, signature: null };
    state._homeProgramUI = null;
    requestDraw();
    return result;
  }
  state.homeProgramOverlay = { on: true, result, signature: sourceSignature(state.project) };
  requestDraw();
  return result;
}
