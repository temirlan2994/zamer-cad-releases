// Этап 6 «Свет и солнце».
//
// Панель объединяет уже существующие эскизные оценки дневного света и
// прямого солнца. Она не подменяет ими нормативный светотехнический расчёт,
// тепловую модель, расчёт воздухообмена или CFD.

import {
  analyzeHomeClimateOverview, analyzeHomeClimateRoom, homeClimateRoomKey,
} from '../core/home-climate.js';
import { insolationZone } from '../core/insolation.js';
import { formatSunInfo, sunPosition } from '../core/site.js';
import { escapeHtml } from './dom.js';
import {
  focusSolarRoom, setSolarAnalysis, setSolarMode,
} from './solar-analysis.js';
import { setLandscapeSun } from './landscape-style.js';
import { refreshLandscapeSun } from './landscape-sun.js';
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
      date: effectiveDate(project),
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
  return room?.key || `${room?.levelId || ''}:${room?.roomId || room?.id || ''}`;
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

function effectiveDate(project) {
  return project?.site?.sun?.date || '2026-06-21';
}

function analyzeView(project, state = {}) {
  const overview = safeOverview(project);
  const rooms = array(overview.rooms);
  const room = preferredRoom(project, state, rooms);
  let detail = null;
  let detailKey = null;
  if (room) {
    const options = {
      ...state.solarAnalysis,
      levelId: room.levelId,
      roomId: roomIdOf(room),
      date: effectiveDate(project),
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
    if (id === 'climateFile' && sources.climate) { used.add(id); continue; }
    used.add(id);
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

function locationPanel(site, state) {
  if (!site) return '';
  const { location, sun } = site;
  const auto = insolationZone(location.lat);
  const clock = [Math.floor(sun.time / 60) % 24, sun.time % 60].map((n) => String(n).padStart(2, '0')).join(':');
  const field = (id, title, attributes, value) => `<label><span>${title}</span><input id="${id}" data-climate-setting="${id}" ${attributes} value="${escapeHtml(String(value ?? ''))}"></label>`;
  return `<details data-climate-location data-analysis-fold="location" class="climate-fold">
    <summary>⌖ &nbsp; Координаты и солнце <small>${site.solarVerified ? '✓ Проверены' : 'Уточнить'}</small></summary>
    <div class="climate-fields">
      ${field('lat', 'Широта, °', 'type="number" required min="-90" max="90" step="any"', location.lat)}
      ${field('lon', 'Долгота, °', 'type="number" required min="-180" max="180" step="any"', location.lon)}
      ${field('tz', 'Часовой пояс UTC', 'type="number" required min="-12" max="14" step="0.25"', location.tz)}
      ${field('northDeg', 'Север, ° от верха съёмки ↻', 'type="number" required step="any"', site.north)}
      ${field('sunTime', 'Местное время', 'type="time" required', clock)}
      <label><span>Тени ландшафта</span><select data-climate-setting="landscapeMode">${[['default', 'Условные'], ['sun', 'По солнцу'], ['off', 'Скрыты']].map(([mode, label]) => `<option value="${mode}" ${state.lsSun?.mode === mode ? 'selected' : ''}>${label}</option>`).join('')}</select></label>
      ${field('bh', 'Высота дома для тени, м', 'type="number" required min="2" step="any"', site.buildingHeight / 1000)}
    </div>
    <div class="climate-switches">
      <label><input data-climate-setting="verified" type="checkbox" ${site.solarVerified ? 'checked' : ''}> Координаты и север проверены</label>
      <label><input data-climate-setting="enabled" type="checkbox" ${sun.enabled ? 'checked' : ''}> Тень дома на участке</label>
    </div>
    <button type="button" class="climate-map-site" data-home-climate-action="landscape-map" aria-pressed="${state.lsSun?.mode === 'sun' && state.lsSun?.analysis === true}">${state.lsSun?.mode === 'sun' && state.lsSun?.analysis ? 'Скрыть карту солнца на участке' : 'Карта солнца на участке'}</button>
    <p>${escapeHtml(formatSunInfo(sunPosition(location.lat, location.lon, location.tz, sun.date, sun.time)))}</p>
    <details data-analysis-fold="norm"><summary>Ориентир инсоляции</summary>
      <div class="climate-fields">${field('normHours','Продолжительность, ч', `type="number" min="0.5" step="0.5" placeholder="${auto.hours}"`,site.norms?.hours)}
      ${field('normDay','Месяц и день', `pattern="[0-9]{2}-[0-9]{2}" placeholder="${auto.day}"`,site.norms?.day)}</div>
    </details>
  </details>`;
}

function statusText(status, kind) {
  if (kind === 'daylight') {
    if (status === 'no_windows') return ['Нет наружных окон', 'unknown'];
    if (status === 'preliminary') return ['Предварительная оценка', 'estimated'];
  }
  if (kind === 'direct') {
    if (status === 'verified') return ['Проверенные данные', 'verified'];
    if (status === 'estimated') return ['Ориентировочно', 'estimated'];
    if (status === 'missing') return ['Не хватает координат или севера', 'unknown'];
  }
  return ['Недостаточно данных', 'unknown'];
}

function metric(label, value, note = '') {
  return `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd>${note ? `<small>${escapeHtml(note)}</small>` : ''}</div>`;
}

function lightHeading(title, status, kind) {
  const symbol = kind === 'daylight'
    ? '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M12 4v16M4 12h16"/>'
    : '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/>';
  return `<div class="home-climate-card-head"><i aria-hidden="true"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round">${symbol}</svg></i><div><h4>${title}</h4><span>${escapeHtml(status)}</span></div></div>`;
}

function roomDetail(state, room, detail) {
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
  const directOn = state?.solarAnalysis?.on === true && state.solarAnalysis.mode === 'direct'
    && state.solarAnalysis.roomId === roomIdOf(room);
  const daylightOn = state?.solarAnalysis?.on === true && state.solarAnalysis.mode === 'daylight'
    && state.solarAnalysis.roomId === roomIdOf(room);
  const assumptions = array(detail.assumptions).map((item) => typeof item === 'string' ? item : item?.text).filter(Boolean);
  const warnings = array(detail.warnings).map((item) => typeof item === 'string' ? item : item?.text).filter(Boolean);
  return `<section class="home-climate-detail" aria-labelledby="homeClimateRoomTitle">
    <h3 id="homeClimateRoomTitle" class="sr-only">${escapeHtml(roomTitle(room))}</h3>
    <div class="home-climate-analysis-grid">
      <article data-analysis="daylight" data-status="${dayCss}">
        ${lightHeading('Дневной свет', dayLabel, 'daylight')}
        <p class="climate-value">${number(daylight.meanLux, 0)} <small>лк в среднем</small></p>
        <button type="button" aria-pressed="${daylightOn}" data-home-climate-action="toggle-map" data-home-climate-map="daylight" data-home-climate-room-id="${escapeHtml(roomIdOf(room))}" data-home-climate-level-id="${escapeHtml(room.levelId || '')}">${daylightOn ? 'Скрыть карту освещённости' : 'Карта освещённости'}</button>
      </article>
      <article data-analysis="direct" data-status="${sunCss}">
        ${lightHeading('Прямое солнце', sunLabel, 'direct')}
        <p class="climate-value">${duration(direct.meanMinutes)} <small>в среднем</small></p>
        <button type="button" aria-pressed="${directOn}" data-home-climate-action="toggle-map" data-home-climate-map="direct" data-home-climate-room-id="${escapeHtml(roomIdOf(room))}" data-home-climate-level-id="${escapeHtml(room.levelId || '')}">${directOn ? 'Скрыть карту прямого солнца' : 'Карта прямого солнца'}</button>
      </article>
    </div>
    <details data-analysis-fold="detail" class="climate-fold"><summary>Показатели и допущения</summary>
      <label class="climate-glass">Светопропускание стекла, % <input type="number" id="daylightTransmittance" data-climate-setting="glass" min="10" max="100" value="${Math.round((state.solarAnalysis?.transmittance ?? 0.7) * 100)}"></label>
      <dl class="climate-metrics">
        ${metric('Средний КЕО', `${number(daylight.meanDaylightFactor, 2)} %`)}${metric('Минимальный КЕО', `${number(daylight.minDaylightFactor, 2)} %`)}
        ${metric('Площадь ≥ 300 лк', percent(daylight.coverage300))}${metric('Площадь ≥ 2 % КЕО', percent(daylight.coverageDaylightFactor))}
        ${metric('Видимость неба', percent(daylight.meanWindowSkyVisibility))}${metric('Остекление', `${number(glazing.areaM2, 2)} м² · ${ratioText}`)}
        ${metric('Солнце · максимум', duration(direct.maxMinutes))}${metric('Освещённая площадь', percent(direct.litShare))}${metric('Солнце ≥ 2 ч', percent(direct.coverage2h))}
      </dl>
      <div class="home-climate-context">
      <div><strong>Инсоляционный ориентир</strong><span>${insolation.status && insolation.status !== 'unknown' ? escapeHtml(insolation.label || insolation.summary || 'Рассчитан по настройкам проекта') : 'Не хватает подтверждённых координат, часового пояса или севера'}</span></div>
      <div><strong>Тепловой комфорт</strong><span>${thermal.status === 'screening_hint' ? escapeHtml(thermal.summary || 'Есть скрининговый сигнал — требуется теплотехнический расчёт') : 'Не рассчитан: нужны климатический файл, ограждения, стекло, нагрузки и HVAC'}</span></div>
    </div>
    ${(daylight.recommendations || []).length ? `<ul>${daylight.recommendations.map((r) => `<li>${escapeHtml(r.text)}</li>`).join('')}</ul>` : ''}
    ${warnings.length ? `<ul class="home-climate-warnings">${warnings.map((warning) => `<li>${escapeHtml(warning)}</li>`).join('')}</ul>` : ''}
    ${assumptions.length ? `<details><summary>Допущения расчёта</summary><ul>${assumptions.map((assumption) => `<li>${escapeHtml(assumption)}</li>`).join('')}</ul></details>` : ''}
    </details>
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
    <div class="climate-target">
      ${view.rooms.length ? `<label><span>Помещение</span><select data-home-climate-room>${roomOptions(view.rooms, view.room)}</select></label>` : '<p>Добавьте помещение на план.</p>'}
      <label><span>Дата</span><input type="date" required data-home-climate-date value="${escapeHtml(effectiveDate(project))}"></label>
    </div>
    ${roomDetail(state, view.room, view.detail)}
    ${locationPanel(project.site, state)}
    <details data-analysis-fold="sources" class="climate-fold"><summary>Исходные данные и точность</summary>
      <ul class="home-climate-sources">${sourceCards(view.overview)}</ul>
      ${warnings.length ? `<ul>${warnings.map((w) => `<li>${escapeHtml(typeof w === 'string' ? w : w.text || w.reason || '')}</li>`).join('')}</ul>` : ''}
      <p>Не нормативное заключение. Карты не рассчитывают температуру, воздухообмен, перегрев или CFD.</p>
    </details>
    <button type="button" id="solarAnnualRun" class="climate-report" data-solar-report-open data-home-climate-action="open-report">▤ &nbsp; Сезонная световая сводка</button>
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
  if (action === 'landscape-map') {
    const enabled = !(state.lsSun?.mode === 'sun' && state.lsSun?.analysis);
    setLandscapeSun({ mode: 'sun', analysis: enabled });
    if (enabled) {
      disableOtherOverlays(state);
      if (state.solarAnalysis?.on) solarApis(deps).analysis(false, state.solarAnalysis.roomId);
      deps.closePanel?.({ restoreFocus: false });
      deps.setEditorMode?.('landscape');
    }
    refreshLandscapeSun();
    deps.requestDraw?.();
    deps.rerender?.();
    return true;
  }
  const apis = solarApis(deps);
  if (action === 'open-report') {
    deps.closePanel?.({ restoreFocus: false });
    void apis.report({ returnToClimate: true });
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
  deps.closePanel?.({ restoreFocus: false });
  deps.setEditorMode?.('plan');
  disableOtherOverlays(state);
  if (levelId && project.activeLevel !== levelId) deps.switchLevel?.(levelId);
  state.selection = { type: 'room', id: roomId };
  apis.focus(roomId);
  apis.mode(mode, deps.requestDraw);
  apis.analysis(true, roomId);
  deps.requestDraw?.();
  deps.rerender?.();
  deps.announce?.(mode === 'daylight'
    ? 'Показана предварительная карта КЕО и освещённости'
    : 'Показана карта прямого солнца');
  return true;
}

/** Обрабатывает выбор помещения и расчётного дня. */
export function handleHomeClimateInput(event, deps = {}) {
  const input = event?.target?.closest?.('[data-home-climate-room], [data-home-climate-date], [data-climate-setting]');
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
    deps.mutate?.(() => { project.site.sun.date = input.value; });
    if (state.solarAnalysis) delete state.solarAnalysis.date;
    refreshLandscapeSun();
    deps.requestDraw?.();
    deps.rerender?.();
    return true;
  }
  const key = input.dataset?.climateSetting;
  if (!key || !project.site) return false;
  if (!input.reportValidity()) return true;
  const site = project.site;
  const value = input.value;
  if (key === 'glass') {
    state.solarAnalysis = { ...object(state.solarAnalysis), transmittance: Number(value) / 100 };
  } else if (key === 'landscapeMode') {
    setLandscapeSun({ mode: value });
  } else {
    deps.mutate?.(() => {
      if (['lat', 'lon', 'tz'].includes(key)) {
        site.location[key] = Number(value);
        site.solarVerified = false;
      } else if (key === 'northDeg') {
        site.north = ((Number(value) % 360) + 360) % 360;
        site.solarVerified = false;
      } else if (key === 'verified') site.solarVerified = input.checked;
      else if (key === 'enabled') site.sun.enabled = input.checked;
      else if (key === 'sunTime') {
        const [hours, minutes] = value.split(':').map(Number);
        site.sun.time = hours * 60 + minutes;
      } else if (key === 'bh') site.buildingHeight = Math.round(Number(value) * 1000);
      else if (key === 'normHours') site.norms = { ...site.norms, hours: value ? Number(value) : null };
      else if (key === 'normDay') site.norms = { ...site.norms, day: value || null };
    });
    if (key === 'northDeg') deps.applyModeRotation?.();
  }
  refreshLandscapeSun();
  deps.requestDraw?.();
  deps.rerender?.();
  return true;
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
