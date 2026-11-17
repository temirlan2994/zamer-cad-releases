// Этап 6 «Свет и солнце».
//
// Панель объединяет уже существующие эскизные оценки дневного света и
// прямого солнца. Она не подменяет ими нормативный светотехнический расчёт,
// тепловую модель, расчёт воздухообмена или CFD.

import {
  analyzeHomeClimateOverview, analyzeHomeClimateRoom, homeClimateRoomKey,
} from '../core/home-climate.js';
import { escapeHtml } from './dom.js';
import {
  focusSolarRoom, setSolarAnalysis, setSolarMode,
} from './solar-analysis.js';
import { openSolarReport } from './solar-report-ui.js';

const array = (value) => (Array.isArray(value) ? value : []);
const object = (value) => (value && typeof value === 'object' ? value : {});
const finite = (value) => value !== null && value !== undefined && value !== ''
  && Number.isFinite(Number(value));

const SOURCE_LABELS = Object.freeze({
  solar: 'Солнце',
  daylight: 'Дневной свет',
  climate: 'Климатический файл',
  climateFile: 'Климатический файл',
  envelope: 'Ограждающие конструкции',
  ventilation: 'Вентиляционные точки',
});

const SOURCE_STATUS = Object.freeze({
  verified: ['Подтверждено', 'verified'],
  fact: ['Заданы факты', 'verified'],
  preliminary: ['Предварительно', 'estimated'],
  estimated: ['Ориентировочно', 'estimated'],
  candidate: ['Задано частично', 'estimated'],
  partial: ['Задано частично', 'estimated'],
  missing: ['Нет данных', 'unknown'],
  unknown: ['Не задано', 'unknown'],
});

function safeOverview(project) {
  try {
    return analyzeHomeClimateOverview(project) || {};
  } catch (error) {
    console.error('Обзор света и солнца не рассчитался:', error);
    return {
      status: 'unknown', rooms: [],
      warnings: ['Не удалось выполнить предварительный обзор света и солнца.'],
      sources: {}, summary: {}, preliminary: true, normative: false,
    };
  }
}

function safeRoom(project, room) {
  if (!room) return null;
  try {
    return analyzeHomeClimateRoom(project, {
      levelId: room.levelId,
      roomId: room.roomId,
      date: project?._homeClimateDate,
      maxCells: 120,
    }) || null;
  } catch (error) {
    console.error('Световой анализ помещения не рассчитался:', error);
    return {
      levelId: room.levelId, roomId: room.roomId,
      daylight: { status: 'unknown', normative: false },
      directSun: { status: 'missing' },
      thermal: { status: 'unknown', numericHours: null },
      warnings: ['Не удалось рассчитать выбранное помещение.'],
    };
  }
}

function keyOf(room) {
  return room?.key || `${room?.levelId || ''}::${room?.roomId || room?.id || ''}`;
}

function roomIdOf(room) { return room?.roomId || room?.id || null; }

function roomByKey(rooms, key) {
  return array(rooms).find((room) => keyOf(room) === key) || null;
}

function preferredRoom(project, state, rooms) {
  const stored = state?._homeClimateUI?.roomKey;
  const exact = roomByKey(rooms, stored);
  if (exact) return exact;
  const selected = state?.selection?.type === 'room' ? state.selection.id : null;
  return rooms.find((room) => roomIdOf(room) === selected
    && (!project?.activeLevel || room.levelId === project.activeLevel))
    || rooms.find((room) => room.levelId === project?.activeLevel)
    || rooms[0] || null;
}

function effectiveDate(project, state) {
  return state?.solarAnalysis?.date || project?.site?.sun?.date || '2026-06-21';
}

function analyzeView(project, state = {}) {
  const overview = safeOverview(project);
  const rooms = array(overview.rooms);
  const room = preferredRoom(project, state, rooms);
  // Дата хранится только в состоянии вида. В project временно не записываем
  // её: core получает её ниже отдельным аргументом.
  let detail = null;
  let detailKey = null;
  if (room) {
    const options = {
      levelId: room.levelId,
      roomId: roomIdOf(room),
      date: effectiveDate(project, state),
      maxCells: 120,
    };
    detailKey = homeClimateRoomKey(project, options);
    try {
      const previous = state?._homeClimateUI;
      detail = previous?.detailKey === detailKey && previous?.detail?.roomId === roomIdOf(room)
        ? previous.detail : analyzeHomeClimateRoom(project, options) || null;
    } catch (error) {
      console.error('Световой анализ помещения не рассчитался:', error);
      detail = safeRoom(project, room);
    }
  }
  return { overview, rooms, room, detail, detailKey };
}

function number(value, digits = 1) {
  if (!finite(value)) return '—';
  return Number(value).toLocaleString('ru-RU', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function percent(value, digits = 0) {
  return finite(value) ? `${number(Number(value) * 100, digits)} %` : '—';
}

function duration(minutes) {
  if (!finite(minutes)) return '—';
  const total = Math.max(0, Math.round(Number(minutes)));
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  return hours ? `${hours} ч${rest ? ` ${rest} мин` : ''}` : `${rest} мин`;
}

function sourceCard(id, source) {
  const status = String(source?.status || 'unknown');
  const [label, css] = SOURCE_STATUS[status] || SOURCE_STATUS.unknown;
  const reason = source?.reason || source?.summary || '';
  return `<li data-source="${escapeHtml(id)}" data-status="${css}">
    <span>${escapeHtml(SOURCE_LABELS[id] || id)}</span>
    <strong>${escapeHtml(label)}</strong>
    ${reason ? `<small>${escapeHtml(reason)}</small>` : ''}
  </li>`;
}

function sourceCards(overview) {
  const sources = object(overview?.sources);
  const order = ['solar', 'daylight', 'climate', 'climateFile', 'envelope', 'ventilation'];
  const used = new Set();
  const cards = [];
  for (const id of order) {
    if (!(id in sources)) continue;
    const semantic = id === 'climateFile' ? 'climate' : id;
    if (used.has(semantic)) continue;
    used.add(semantic);
    cards.push(sourceCard(id, sources[id]));
  }
  for (const [id, source] of Object.entries(sources)) {
    if (used.has(id)) continue;
    cards.push(sourceCard(id, source));
  }
  return cards.join('');
}

function roomTitle(room) {
  return room?.name || room?.roomName || room?.type || roomIdOf(room) || 'Помещение';
}

function roomOptions(rooms, active) {
  const byLevel = new Map();
  for (const room of rooms) {
    const label = room.levelName || room.levelTitle || room.levelId || 'Этаж';
    if (!byLevel.has(label)) byLevel.set(label, []);
    byLevel.get(label).push(room);
  }
  return [...byLevel.entries()].map(([level, entries]) => `<optgroup label="${escapeHtml(level)}">${entries.map((room) => `<option value="${escapeHtml(keyOf(room))}"${keyOf(room) === keyOf(active) ? ' selected' : ''}>${escapeHtml(roomTitle(room))}</option>`).join('')}</optgroup>`).join('');
}

function roomCards(rooms, active) {
  if (!rooms.length) return '<p class="home-climate-empty">Сначала добавьте помещения на план.</p>';
  return `<div class="home-climate-rooms">${rooms.map((room) => {
    const activeRoom = keyOf(room) === keyOf(active);
    const windows = Number(room.windowCount || 0);
    const glazing = finite(room.glazingAreaM2) ? `${number(room.glazingAreaM2, 2)} м² остекления`
      : windows ? `${windows} окон` : 'нет наружных окон';
    return `<button type="button" data-home-climate-action="select-room" data-home-climate-room-key="${escapeHtml(keyOf(room))}" aria-pressed="${activeRoom}">
      <strong>${escapeHtml(roomTitle(room))}</strong>
      <span>${escapeHtml(room.levelName || room.levelId || '')}${room.levelId || room.levelName ? ' · ' : ''}${escapeHtml(glazing)}</span>
    </button>`;
  }).join('')}</div>`;
}

function statusText(status, kind) {
  if (kind === 'daylight') {
    if (status === 'no_windows') return ['Нет наружных окон', 'unknown'];
    if (status === 'preliminary') return ['Предварительная оценка', 'estimated'];
  }
  if (kind === 'direct') {
    if (status === 'verified') return ['По подтверждённым исходным данным', 'verified'];
    if (status === 'estimated') return ['Ориентировочно', 'estimated'];
    if (status === 'missing') return ['Не хватает координат или севера', 'unknown'];
  }
  return ['Недостаточно данных', 'unknown'];
}

function metric(label, value, note = '') {
  return `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd>${note ? `<small>${escapeHtml(note)}</small>` : ''}</div>`;
}

function roomDetail(project, state, room, detail) {
  if (!room || !detail) return '';
  const daylight = detail.daylight || {};
  const direct = detail.directSun || detail.direct || {};
  const glazing = detail.glazing || {};
  const insolation = detail.insolation || {};
  const thermal = detail.thermal || detail.thermalRisk || {};
  const [dayLabel, dayCss] = statusText(daylight.status, 'daylight');
  const [sunLabel, sunCss] = statusText(direct.status, 'direct');
  const ratio = Number(glazing.ratio);
  const ratioText = ratio > 0 ? `1:${number(1 / ratio, 1)}` : '—';
  const confidence = daylight.confidence?.level === 'medium' ? 'средняя уверенность' : 'низкая уверенность';
  const directOn = state?.solarAnalysis?.on === true && state.solarAnalysis.mode === 'direct'
    && state.solarAnalysis.roomId === roomIdOf(room);
  const daylightOn = state?.solarAnalysis?.on === true && state.solarAnalysis.mode === 'daylight'
    && state.solarAnalysis.roomId === roomIdOf(room);
  const assumptions = array(detail.assumptions).map((item) => typeof item === 'string' ? item : item?.text).filter(Boolean);
  const warnings = array(detail.warnings).map((item) => typeof item === 'string' ? item : item?.text).filter(Boolean);
  return `<section class="home-climate-detail" aria-labelledby="homeClimateRoomTitle">
    <header><div><h3 id="homeClimateRoomTitle">${escapeHtml(roomTitle(room))}</h3><p>${escapeHtml(room.levelName || room.levelId || '')}</p></div><span>Эскизная оценка</span></header>
    <div class="home-climate-analysis-grid">
      <article data-analysis="daylight" data-status="${dayCss}">
        <div class="home-climate-card-head"><h4>Дневной свет</h4><span>${escapeHtml(dayLabel)}</span></div>
        <dl>
          ${metric('Средний КЕО (DF)', finite(daylight.meanDaylightFactor) ? `${number(daylight.meanDaylightFactor, 2)} %` : '—')}
          ${metric('Средняя освещённость', finite(daylight.meanLux) ? `${number(daylight.meanLux, 0)} лк` : '—')}
          ${metric('Площадь ≥ 300 лк', percent(daylight.coverage300), confidence)}
          ${metric('Остекление', `${finite(glazing.areaM2 ?? glazing.area) ? `${number(glazing.areaM2 ?? glazing.area, 2)} м² · ` : ''}${ratioText}`, 'Ориентир 1:8, не нормативный вывод')}
        </dl>
        <button type="button" aria-pressed="${daylightOn}" data-home-climate-action="toggle-map" data-home-climate-map="daylight" data-home-climate-room-id="${escapeHtml(roomIdOf(room))}" data-home-climate-level-id="${escapeHtml(room.levelId || '')}">${daylightOn ? 'Скрыть карту освещённости' : 'Карта КЕО и люксов'}</button>
      </article>
      <article data-analysis="direct" data-status="${sunCss}">
        <div class="home-climate-card-head"><h4>Прямое солнце</h4><span>${escapeHtml(sunLabel)}</span></div>
        <label><span>Расчётный день</span><input type="date" data-home-climate-date value="${escapeHtml(effectiveDate(project, state))}"></label>
        <dl>
          ${metric('Максимум в комнате', duration(direct.maxMinutes))}
          ${metric('В среднем по площади', duration(direct.meanMinutes))}
          ${metric('Освещённая площадь', percent(direct.litShare))}
          ${metric('Площадь с ≥ 2 ч', percent(direct.coverage2h), 'Порог отображения, не заключение о норме')}
        </dl>
        <button type="button" aria-pressed="${directOn}" data-home-climate-action="toggle-map" data-home-climate-map="direct" data-home-climate-room-id="${escapeHtml(roomIdOf(room))}" data-home-climate-level-id="${escapeHtml(room.levelId || '')}">${directOn ? 'Скрыть карту прямого солнца' : 'Карта прямого солнца'}</button>
      </article>
    </div>
    <div class="home-climate-context">
      <div><strong>Инсоляционный ориентир</strong><span>${insolation.status && insolation.status !== 'unknown' ? escapeHtml(insolation.label || insolation.summary || 'Рассчитан по настройкам проекта') : 'Не хватает подтверждённых координат, часового пояса или севера'}</span></div>
      <div><strong>Тепловой комфорт</strong><span>${thermal.status === 'screening_hint' ? escapeHtml(thermal.summary || 'Есть скрининговый сигнал — требуется теплотехнический расчёт') : 'Не рассчитан: нужны климатический файл, ограждения, стекло, нагрузки и HVAC'}</span></div>
    </div>
    ${warnings.length ? `<ul class="home-climate-warnings">${warnings.map((warning) => `<li>${escapeHtml(warning)}</li>`).join('')}</ul>` : ''}
    ${assumptions.length ? `<details><summary>Допущения расчёта</summary><ul>${assumptions.map((assumption) => `<li>${escapeHtml(assumption)}</li>`).join('')}</ul></details>` : ''}
  </section>`;
}

/** Разметка этапа 6. Тяжёлая сезонная сводка здесь не запускается. */
export function homeClimateHtml(project, state = {}) {
  const view = analyzeView(project, state);
  if (state && typeof state === 'object') {
    state._homeClimateUI = {
      roomKey: view.room ? keyOf(view.room) : null,
      roomId: view.room ? roomIdOf(view.room) : null,
      levelId: view.room?.levelId || null,
      overview: view.overview,
      detail: view.detail,
      detailKey: view.detailKey,
    };
  }
  const warnings = array(view.overview?.warnings).filter(Boolean);
  return `<div class="home-climate" data-home-climate>
    <section class="home-climate-intro">
      <div><strong>Свет и солнце</strong><span>Предварительная оценка по геометрии проекта</span></div>
      <p><strong>Не нормативное заключение.</strong> Карты не рассчитывают температуру, воздухообмен, перегрев или CFD.</p>
    </section>
    <ul class="home-climate-sources" aria-label="Качество исходных данных">${sourceCards(view.overview)}</ul>
    ${view.rooms.length ? `<label class="home-climate-room-select"><span>Помещение</span><select data-home-climate-room>${roomOptions(view.rooms, view.room)}</select></label>` : ''}
    ${roomCards(view.rooms, view.room)}
    ${roomDetail(project, state, view.room, view.detail)}
    ${warnings.length ? `<section class="home-climate-warnings" aria-labelledby="homeClimateWarnings"><h3 id="homeClimateWarnings">Что нужно уточнить</h3><ul>${warnings.map((warning) => `<li>${escapeHtml(typeof warning === 'string' ? warning : warning.text || warning.reason || '')}</li>`).join('')}</ul></section>` : ''}
    <div class="home-climate-actions">
      <button type="button" data-home-climate-action="open-solar-settings" data-route-action="open-solar-settings">Настроить координаты и север</button>
      <button type="button" data-home-climate-action="open-report">Сезонная световая сводка…</button>
    </div>
    <p class="home-climate-disclaimer">Сезонная сводка запускается отдельно и использует 12 реперных дней. Это не годовая почасовая симуляция и не экспертиза.</p>
  </div>`;
}

function selectClimateRoom(project, state, roomKey) {
  const overview = safeOverview(project);
  const room = roomByKey(array(overview.rooms), roomKey);
  if (!room) return null;
  state._homeClimateUI = {
    ...object(state._homeClimateUI),
    roomKey: keyOf(room), roomId: roomIdOf(room), levelId: room.levelId,
  };
  return room;
}

function disableOtherOverlays(state) {
  state.siteOpportunity = { on: false, result: null, signature: null };
  state._siteOpportunityUI = null;
  state.homeProgramOverlay = {
    ...object(state.homeProgramOverlay), on: false, result: null, signature: null,
  };
  state.homeEngineeringOverlay = { on: false, result: null, signature: null };
  state.homeCirculationOverlay = {
    ...object(state.homeCirculationOverlay), on: false, result: null, signature: null,
  };
  state._homeProgramUI = null;
  state._homeFlowsUI = null;
  state._homeEngineeringUI = null;
  state._homeCirculationUI = null;
  if (state.ergo?.on) state.ergo = { ...state.ergo, on: false };
}

function solarApis(deps) {
  return {
    focus: deps.focusSolarRoom || focusSolarRoom,
    mode: deps.setSolarMode || setSolarMode,
    analysis: deps.setSolarAnalysis || setSolarAnalysis,
    report: deps.openSolarReport || openSolarReport,
  };
}

/** Обрабатывает кнопки этапа 6. */
export function handleHomeClimateClick(event, deps = {}) {
  const button = event?.target?.closest?.('[data-home-climate-action]');
  if (!button || !button.closest?.('[data-home-climate]')) return false;
  const { project, state } = deps;
  if (!project || !state) return false;
  const action = button.dataset.homeClimateAction;
  if (action === 'open-solar-settings') return false; // общий обработчик маршрута
  const apis = solarApis(deps);
  if (action === 'select-room') {
    const room = selectClimateRoom(project, state, button.dataset.homeClimateRoomKey);
    if (!room) return false;
    apis.focus(roomIdOf(room));
    deps.rerender?.();
    deps.announce?.(`Выбрано помещение ${roomTitle(room)}`);
    return true;
  }
  if (action === 'open-report') {
    deps.closePanel?.({ restoreFocus: false });
    void apis.report();
    deps.announce?.('Запущена сезонная световая сводка');
    return true;
  }
  if (action !== 'toggle-map') return false;
  const mode = button.dataset.homeClimateMap === 'daylight' ? 'daylight' : 'direct';
  const roomId = button.dataset.homeClimateRoomId || state._homeClimateUI?.roomId;
  const levelId = button.dataset.homeClimateLevelId || state._homeClimateUI?.levelId;
  if (!roomId) return false;
  const active = state.solarAnalysis?.on === true
    && state.solarAnalysis.mode === mode && state.solarAnalysis.roomId === roomId;
  if (active) {
    apis.analysis(false, roomId);
    deps.requestDraw?.();
    deps.rerender?.();
    deps.announce?.('Световая карта скрыта');
    return true;
  }
  disableOtherOverlays(state);
  if (levelId && project.activeLevel !== levelId) deps.switchLevel?.(levelId);
  state.selection = { type: 'room', id: roomId };
  apis.focus(roomId);
  apis.mode(mode, deps.requestDraw);
  apis.analysis(true, roomId);
  deps.closePanel?.({ restoreFocus: false });
  deps.setEditorMode?.('plan');
  deps.requestDraw?.();
  deps.rerender?.();
  deps.announce?.(mode === 'daylight'
    ? 'Показана предварительная карта КЕО и освещённости'
    : 'Показана карта прямого солнца');
  return true;
}

/** Обрабатывает выбор помещения и расчётного дня. */
export function handleHomeClimateInput(event, deps = {}) {
  const input = event?.target?.closest?.('[data-home-climate-room], [data-home-climate-date]');
  if (!input || !input.closest?.('[data-home-climate]')) return false;
  const { project, state } = deps;
  if (!project || !state) return false;
  if (input.hasAttribute?.('data-home-climate-room')) {
    const room = selectClimateRoom(project, state, input.value);
    if (!room) return false;
    solarApis(deps).focus(roomIdOf(room));
    deps.rerender?.();
    return true;
  }
  if (input.hasAttribute?.('data-home-climate-date')) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(input.value || ''))) return true;
    state.solarAnalysis = { ...object(state.solarAnalysis), date: input.value };
    deps.requestDraw?.();
    deps.rerender?.();
    return true;
  }
  return false;
}

/** Обновляет производную сводку после изменения геометрии проекта. */
export function refreshHomeClimateView(project, state, requestDraw) {
  if (!project || !state) return null;
  const view = analyzeView(project, state);
  state._homeClimateUI = {
    ...object(state._homeClimateUI),
    roomKey: view.room ? keyOf(view.room) : null,
    roomId: view.room ? roomIdOf(view.room) : null,
    levelId: view.room?.levelId || null,
    overview: view.overview,
    detail: view.detail,
    detailKey: view.detailKey,
  };
  if (state.solarAnalysis?.on) requestDraw?.();
  return view;
}
