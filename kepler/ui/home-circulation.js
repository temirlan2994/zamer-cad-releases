// Этап 5 «Движение и проходы».
//
// Экран отделяет сохранённые факты (точные якоря сценариев) от производного
// расчёта. Ширина профиля и видимость слоёв относятся только к текущему виду
// и не превращаются в норматив или характеристику конкретного жильца.

import { furnitureDef } from '../core/catalog.js';
import { analyzeHomeCirculation } from '../core/home-circulation.js';
import { ensureLayoutBrief } from '../core/layout-brief.js';
import { LAYOUT_SCENARIOS } from '../core/layout-knowledge.generated.js';
import { levelProject } from '../core/model.js';
import { itemsInRoom } from '../core/furnish.js';
import { deriveWalls, doorLink } from '../core/walls.js';
import { escapeHtml } from './dom.js';

const array = (value) => (Array.isArray(value) ? value : []);
const object = (value) => (value && typeof value === 'object' ? value : {});
const finite = (value) => value !== null && value !== undefined && value !== ''
  && Number.isFinite(Number(value));

const PROFILE_WIDTHS = Object.freeze([600, 900, 1400]);
const PERIOD_LABELS = Object.freeze({
  day: 'в день',
  week: 'в неделю',
  month: 'в месяц',
  year: 'в год',
  event: 'за событие',
});

const STATUS_LABELS = Object.freeze({
  clear: 'Проходит',
  narrow: 'Тесно',
  approximate: 'Приблизительно',
  partial: 'Частично',
  blocked: 'Заблокировано',
  fail: 'Заблокировано',
  unknown: 'Недостаточно данных',
});

const EVIDENCE_LABELS = Object.freeze({
  exact: 'явные точки',
  explicit: 'явные точки',
  approximate: 'опорные точки помещений',
  candidate: 'предварительные точки',
  partial: 'неполная геометрия',
  unknown: 'нет доказательства',
});

const SCENARIOS = new Map(LAYOUT_SCENARIOS.map((scenario) => [scenario.scenario_id, scenario]));

function normalizedStatus(value) {
  const status = String(value || 'unknown').toLocaleLowerCase('ru-RU');
  if (['clear', 'pass', 'ready', 'proven'].includes(status)) return 'clear';
  if (['narrow', 'warning', 'warn'].includes(status)) return 'narrow';
  if (['approximate', 'candidate'].includes(status)) return 'approximate';
  if (['partial'].includes(status)) return 'partial';
  if (['blocked', 'fail', 'error', 'conflict'].includes(status)) return 'blocked';
  return 'unknown';
}

function defaultView(previous = {}) {
  const width = finite(previous.profileWidthMm)
    ? Math.max(300, Math.min(2000, Number(previous.profileWidthMm))) : 600;
  return {
    on: previous.on === true,
    routes: previous.routes !== false,
    heatmap: previous.heatmap === true,
    bottlenecks: previous.bottlenecks !== false,
    metric: previous.metric === 'frequency' ? 'frequency' : 'route_count',
    period: typeof previous.period === 'string' && previous.period ? previous.period : null,
    profileWidthMm: width,
    result: previous.result || null,
    signature: previous.signature || null,
  };
}

function resultRoutes(result) {
  if (Array.isArray(result?.routes)) return result.routes;
  return array(result?.levels).flatMap((level) => array(level?.routes));
}

function safeAnalysis(project, view = {}) {
  try {
    return analyzeHomeCirculation(project, {
      profileWidthMm: defaultView(view).profileWidthMm,
    }) || {};
  } catch (error) {
    console.error('Движение и проходы не рассчитались:', error);
    return {
      status: 'unknown', routes: [], levels: [],
      warnings: ['Не удалось выполнить расчёт движения и проходов.'],
    };
  }
}

function sourceSignature(project, view) {
  return JSON.stringify({
    profileWidthMm: defaultView(view).profileWidthMm,
    activeLevel: project?.activeLevel || null,
    geometrySettings: {
      partition: project?.settings?.partition ?? null,
      wallsEngine: project?.settings?.wallsEngine ?? null,
    },
    levels: array(project?.levels).map((level) => ({
      id: level.id,
      elevation: level.elevation,
      height: level.height,
      rooms: array(level.rooms).map((room) => [
        room.id, room.type, room.x, room.y, room.w, room.h, room.outline, room.parentId,
      ]),
      openings: array(level.openings).map((opening) => [
        opening.id, opening.kind, opening.roomId, opening.side, opening.offset,
        opening.width, opening.type, opening.host, opening.wallId, opening.wallRef,
        opening.requiredLeafIndices, opening.orphan,
      ]),
      items: array(level.items).map((item) => [
        item.id, item.kind, item.x, item.y, item.w, item.h, item.rotation, item.mirrored,
        item.toLevel, item.comp,
      ]),
      slabOpenings: level.slabOpenings || [],
      walls: level.walls || [],
      wallOverrides: level.wallOverrides || {},
    })),
    scenarios: project?.layoutBrief?.scenarioSelections || [],
    bindings: project?.layoutBrief?.scenarioRouteBindings || [],
  });
}

function overlayResult(project, previous = {}) {
  const view = defaultView(previous);
  const signature = sourceSignature(project, view);
  return {
    ...view,
    on: true,
    result: view.result && view.signature === signature
      ? view.result : safeAnalysis(project, view),
    signature,
  };
}

function periodSet(project, routes) {
  const result = new Set();
  for (const route of routes) {
    const frequency = object(route?.frequency);
    if ((frequency.known === true || finite(frequency.value)) && frequency.period) {
      result.add(String(frequency.period));
    }
  }
  for (const selection of array(project?.layoutBrief?.scenarioSelections)) {
    if (selection?.enabled === true && finite(selection.frequencyValue) && selection.frequencyPeriod) {
      result.add(String(selection.frequencyPeriod));
    }
  }
  return [...result].sort((a, b) => a.localeCompare(b));
}

function routeCounts(routes) {
  const counts = { clear: 0, narrow: 0, approximate: 0, partial: 0, blocked: 0, unknown: 0 };
  for (const route of routes) counts[normalizedStatus(route?.status)] += 1;
  return counts;
}

function overallStatus(result, counts) {
  const explicit = normalizedStatus(result?.status);
  if (explicit !== 'unknown') return explicit;
  if (counts.blocked) return 'blocked';
  if (counts.unknown) return 'unknown';
  if (counts.partial) return 'partial';
  if (counts.approximate) return 'approximate';
  if (counts.narrow) return 'narrow';
  return counts.clear ? 'clear' : 'unknown';
}

function statusNote(status, counts, width) {
  if (status === 'blocked') return `${counts.blocked} маршрутов не пропускают расчётный профиль ${width} мм.`;
  if (status === 'unknown') return 'Для части маршрутов не заданы помещения, точки или межэтажная связь.';
  if (status === 'partial') return 'Рассчитана только известная часть маршрутов.';
  if (status === 'approximate') return 'Маршруты опираются на приблизительные точки помещений.';
  if (status === 'narrow') return `Профиль ${width} мм проходит, но найден тесный участок.`;
  return `Рассчитанные маршруты пропускают профиль ${width} мм.`;
}

function formatMm(value) {
  return finite(value) ? `${Math.round(Number(value)).toLocaleString('ru-RU')} мм` : 'не измерено';
}

function formatLength(value) {
  return finite(value)
    ? `${(Number(value) / 1000).toLocaleString('ru-RU', { maximumFractionDigits: 1 })} м`
    : 'не измерена';
}

function frequencyLabel(route) {
  const frequency = object(route?.frequency);
  if (!(frequency.known === true || finite(frequency.value)) || !frequency.period) return 'частота не задана';
  return `${Number(frequency.value).toLocaleString('ru-RU', { maximumFractionDigits: 1 })} ${PERIOD_LABELS[frequency.period] || frequency.period}`;
}

function routeTitle(route) {
  return route?.title || route?.scenarioTitle || route?.label
    || (route?.scenarioId ? `Сценарий ${route.scenarioId}` : null)
    || route?.id || 'Маршрут';
}

function routeReason(route, status) {
  return route?.reason || route?.message || route?.unknownReason
    || array(route?.unknownReasons)[0]
    || (status === 'blocked' ? 'Свободный путь для выбранного профиля не найден.'
      : status === 'unknown' ? 'Недостаточно исходных данных для расчёта.'
        : status === 'approximate' ? 'Начало или конец заданы опорной точкой помещения.'
          : 'Путь рассчитан по текущей геометрии и мебели.');
}

function routeCards(routes) {
  if (!routes.length) {
    return '<p class="home-circulation-empty">Сначала включите сценарии жизни и привяжите их маршруты к помещениям на этапе 3.</p>';
  }
  return `<div class="home-circulation-routes">${routes.map((route) => {
    const status = normalizedStatus(route?.status);
    const evidence = route?.evidence || route?.evidenceLevel || 'unknown';
    return `<article class="home-circulation-route" data-status="${escapeHtml(status)}">
      <header><strong>${escapeHtml(routeTitle(route))}</strong><span>${escapeHtml(STATUS_LABELS[status])}</span></header>
      <dl>
        <div><dt>Длина</dt><dd>${escapeHtml(formatLength(route?.lengthMm))}</dd></div>
        <div><dt>Узкое место</dt><dd>${escapeHtml(formatMm(route?.minWidthMm ?? route?.bottleneck?.widthMm ?? route?.bottleneck?.clearanceMm))}</dd></div>
        <div><dt>Основание</dt><dd>${escapeHtml(EVIDENCE_LABELS[evidence] || EVIDENCE_LABELS.unknown)}</dd></div>
        <div><dt>Частота</dt><dd>${escapeHtml(frequencyLabel(route))}</dd></div>
      </dl>
      <p>${escapeHtml(routeReason(route, status))}</p>
    </article>`;
  }).join('')}</div>`;
}

function profileControls(view) {
  const preset = PROFILE_WIDTHS.includes(view.profileWidthMm);
  return `<fieldset class="home-circulation-profile">
    <legend>Расчётный профиль прохода</legend>
    <div role="group" aria-label="Ширина расчётного профиля">${PROFILE_WIDTHS.map((width) => `<button type="button" data-home-circulation-action="set-profile" data-circulation-profile="${width}" aria-pressed="${view.profileWidthMm === width}">${width} мм</button>`).join('')}</div>
    <label class="prop-field"><span>Свой размер, мм</span><input type="number" min="300" max="2000" step="10" inputmode="decimal" data-circulation-width value="${escapeHtml(preset ? '' : view.profileWidthMm)}" placeholder="например, 750"></label>
    <p>Это размер тестового профиля для геометрического расчёта, а не автоматически назначенная норма или габарит жильца.</p>
  </fieldset>`;
}

function metricControls(view, periods, unknownFrequencyCount) {
  const period = periods.includes(view.period) ? view.period : '';
  const mixed = periods.length > 1;
  return `<div class="home-circulation-metric">
    <label class="prop-field"><span>Карта нагрузки</span><select data-circulation-metric>
      <option value="route_count"${view.metric === 'route_count' ? ' selected' : ''}>Число рассчитанных маршрутов</option>
      <option value="frequency"${view.metric === 'frequency' ? ' selected' : ''}>Явная частота</option>
    </select></label>
    <label class="prop-field"><span>Период частоты</span><select data-circulation-period${view.metric === 'frequency' ? '' : ' disabled'}>
      <option value="">Выберите период</option>
      ${periods.map((id) => `<option value="${escapeHtml(id)}"${period === id ? ' selected' : ''}>${escapeHtml(PERIOD_LABELS[id] || id)}</option>`).join('')}
    </select></label>
    ${view.metric === 'frequency' && !period ? '<p class="home-circulation-warning">Период не выбран: числовая теплокарта частоты не строится.</p>' : ''}
    ${mixed ? '<p class="home-circulation-hint">Частоты разных периодов показаны раздельно и никогда не складываются.</p>' : ''}
    ${unknownFrequencyCount ? `<p class="home-circulation-hint">Без частоты: ${unknownFrequencyCount}. Они остаются неизвестными, а не нулевыми.</p>` : ''}
  </div>`;
}

function roomRecord(project, endpoint) {
  if (!endpoint?.levelId || !endpoint?.roomId) return null;
  const level = array(project?.levels).find((candidate) => candidate.id === endpoint.levelId);
  const room = array(level?.rooms).find((candidate) => candidate.id === endpoint.roomId);
  return level && room ? { level, room } : null;
}

function roomName(project, endpoint) {
  const record = roomRecord(project, endpoint);
  return record?.room?.name || record?.room?.type || endpoint?.roomId || 'помещение не привязано';
}

function endpointAnchor(endpoint) {
  const nested = object(endpoint?.anchor);
  const type = endpoint?.anchorType || nested.type || null;
  const id = endpoint?.anchorId || nested.id || null;
  return type && id ? `${type}:${id}` : '';
}

function anchorOptions(project, endpoint) {
  const record = roomRecord(project, endpoint);
  const selected = endpointAnchor(endpoint);
  if (!record) return '<option value="">Сначала привяжите помещение на этапе 3</option>';
  const view = levelProject(project, record.level.id);
  const walls = deriveWalls(view);
  const items = itemsInRoom(view, record.room).map((item) => [
    `item:${item.id}`,
    `Мебель: ${furnitureDef(item.kind)?.title || item.kind || item.id}`,
  ]);
  const doors = array(view.openings).filter((opening) => opening.kind === 'door'
    && !opening.orphan && doorLink(view, opening, walls)?.includes(record.room.id))
    .map((opening, index) => [
      `opening:${opening.id}`,
      `Дверь${opening.name ? `: ${opening.name}` : ` ${index + 1}`}`,
    ]);
  const rows = [
    ['', 'Опорная точка помещения · приблизительно'],
    ...items,
    ...doors,
  ];
  return rows.map(([value, label]) => `<option value="${escapeHtml(value)}"${value === selected ? ' selected' : ''}>${escapeHtml(label)}</option>`).join('');
}

function routeDefinition(binding) {
  return array(SCENARIOS.get(binding.scenarioId)?.route_pairs)
    .find((route) => route.route_id === binding.routeId) || null;
}

function anchorEditors(project) {
  const active = new Set(array(project?.layoutBrief?.scenarioSelections)
    .filter((selection) => selection?.enabled === true).map((selection) => selection.scenarioId));
  const bindings = array(project?.layoutBrief?.scenarioRouteBindings)
    .filter((binding) => active.has(binding?.scenarioId));
  if (!bindings.length) {
    return '<p class="home-circulation-empty">На этапе 3 включите сценарий и привяжите его маршруты к помещениям. После этого здесь можно уточнить мебель или дверь.</p>';
  }
  return `<div class="home-circulation-anchors">${bindings.map((binding) => {
    const scenario = SCENARIOS.get(binding.scenarioId);
    const definition = routeDefinition(binding);
    const instanceId = binding.instanceId || 'default';
    const complete = binding.from?.roomId && binding.to?.roomId;
    return `<article class="home-circulation-anchor" data-status="${complete ? 'ready' : 'unknown'}">
      <header><strong>${escapeHtml(scenario?.title || binding.scenarioId || 'Сценарий')}</strong><span>${escapeHtml(definition?.title || binding.routeId || 'маршрут')}</span></header>
      <div class="home-circulation-anchor-grid">
        <label class="prop-field"><span>Откуда · ${escapeHtml(roomName(project, binding.from))}</span><select data-circulation-anchor="from" data-scenario-id="${escapeHtml(binding.scenarioId)}" data-route-id="${escapeHtml(binding.routeId)}" data-instance-id="${escapeHtml(instanceId)}"${binding.from?.roomId ? '' : ' disabled'}>${anchorOptions(project, binding.from)}</select></label>
        <label class="prop-field"><span>Куда · ${escapeHtml(roomName(project, binding.to))}</span><select data-circulation-anchor="to" data-scenario-id="${escapeHtml(binding.scenarioId)}" data-route-id="${escapeHtml(binding.routeId)}" data-instance-id="${escapeHtml(instanceId)}"${binding.to?.roomId ? '' : ' disabled'}>${anchorOptions(project, binding.to)}</select></label>
      </div>
      ${complete ? '<p>Без выбранного объекта используется приблизительная опорная точка помещения.</p>' : '<p>Сначала укажите оба помещения на этапе 3 «Зоны и маршруты».</p>'}
    </article>`;
  }).join('')}</div>`;
}

function warningsHtml(result) {
  const warnings = array(result?.warnings).filter((warning) => typeof warning === 'string' && warning.trim());
  return warnings.length
    ? `<ul class="home-circulation-warnings">${warnings.slice(0, 10).map((warning) => `<li>${escapeHtml(warning)}</li>`).join('')}</ul>`
    : '';
}

/** Разметка этапа 5. */
export function homeCirculationHtml(project, state = {}) {
  const initial = defaultView(state?.homeCirculationOverlay);
  const signature = sourceSignature(project, initial);
  const result = initial.result && initial.signature === signature
    ? initial.result : safeAnalysis(project, initial);
  const view = { ...initial, result, signature };
  // Перерисовка панели происходит после каждого переключателя. Держим
  // производный результат только в UI-state и не строим сетку повторно,
  // пока геометрия, сценарии и профиль не изменились.
  if (state && typeof state === 'object') state.homeCirculationOverlay = view;
  const routes = resultRoutes(result);
  const counts = routeCounts(routes);
  const status = overallStatus(result, counts);
  const periods = periodSet(project, routes);
  const unknownFrequencyCount = routes.filter((route) => {
    const frequency = object(route?.frequency);
    return route?.source === 'scenario' && !(frequency.known === true
      || (finite(frequency.value) && frequency.period));
  }).length;
  return `<div class="home-circulation" data-home-circulation>
    <div class="home-circulation-summary" data-status="${escapeHtml(status)}">
      <div><strong>${escapeHtml(STATUS_LABELS[status])}</strong><span>${escapeHtml(statusNote(status, counts, view.profileWidthMm))}</span></div>
      <dl>
        <div><dt>Проходит</dt><dd>${counts.clear}</dd></div>
        <div><dt>Тесно</dt><dd>${counts.narrow}</dd></div>
        <div><dt>Приблизительно</dt><dd>${counts.approximate + counts.partial}</dd></div>
        <div><dt>Нет пути</dt><dd>${counts.blocked}</dd></div>
        <div><dt>Неизвестно</dt><dd>${counts.unknown}</dd></div>
      </dl>
    </div>
    <p class="home-circulation-disclaimer"><strong>Дискретный геометрический расчёт.</strong> Он учитывает текущие стены, двери и напольную мебель, но не является нормативной проверкой эвакуации или доступности. Разрешение сетки и уровень доказательства указаны в результате.</p>
    ${profileControls(view)}
    <div class="home-circulation-layer-controls" aria-label="Слои анализа движения">
      <button type="button" class="project-route-switch" role="switch" aria-checked="${view.routes}" data-home-circulation-action="toggle-routes"><span aria-hidden="true"></span>Маршруты</button>
      <button type="button" class="project-route-switch" role="switch" aria-checked="${view.heatmap}" data-home-circulation-action="toggle-heatmap"><span aria-hidden="true"></span>Нагрузка</button>
      <button type="button" class="project-route-switch" role="switch" aria-checked="${view.bottlenecks}" data-home-circulation-action="toggle-bottlenecks"><span aria-hidden="true"></span>Узкие места</button>
      <button type="button" class="primary home-circulation-show" data-home-circulation-action="toggle-overlay">${view.on ? 'Скрыть с плана' : 'Показать на плане'}</button>
    </div>
    ${metricControls(view, periods, unknownFrequencyCount)}
    <section class="home-circulation-section" aria-labelledby="homeCirculationRoutesTitle">
      <div class="home-program-section-head"><div><h3 id="homeCirculationRoutesTitle">Рассчитанные маршруты</h3><p>Линия строится вокруг мебели; заблокированные и неизвестные пути не дорисовываются.</p></div></div>
      ${routeCards(routes)}
    </section>
    <section class="home-circulation-section" aria-labelledby="homeCirculationAnchorsTitle">
      <div class="home-program-section-head"><div><h3 id="homeCirculationAnchorsTitle">Точные точки сценариев</h3><p>Выберите мебель или дверь. Без выбора маршрут остаётся приблизительным.</p></div></div>
      ${anchorEditors(project)}
    </section>
    ${warningsHtml(result)}
  </div>`;
}

function refreshVisible(project, state, rerender, requestDraw) {
  if (state?.homeCirculationOverlay?.on) {
    state.homeCirculationOverlay = overlayResult(project, state.homeCirculationOverlay);
    requestDraw?.();
  }
  rerender?.();
}

function updateAnchor(input, deps) {
  const { project, state, mutate, rerender, requestDraw } = deps;
  if (!project || typeof mutate !== 'function') return false;
  const scenarioId = input.dataset.scenarioId;
  const routeId = input.dataset.routeId;
  const instanceId = input.dataset.instanceId || 'default';
  const end = input.dataset.circulationAnchor;
  const [anchorType, ...idParts] = String(input.value || '').split(':');
  const anchorId = idParts.join(':') || null;
  const changed = mutate(() => {
    const brief = ensureLayoutBrief(project);
    const binding = array(brief.scenarioRouteBindings).find((entry) => (
      entry.scenarioId === scenarioId && entry.routeId === routeId
      && (entry.instanceId || 'default') === instanceId
    ));
    const endpoint = binding?.[end];
    if (!endpoint) return;
    delete endpoint.anchor;
    if (['item', 'opening'].includes(anchorType) && anchorId) {
      endpoint.anchorType = anchorType;
      endpoint.anchorId = anchorId;
    } else {
      delete endpoint.anchorType;
      delete endpoint.anchorId;
    }
  });
  if (changed !== false) refreshVisible(project, state, rerender, requestDraw);
  return true;
}

function updateAnalysisView(project, state, patch, rerender, requestDraw, { recalculate = false } = {}) {
  const view = { ...defaultView(state?.homeCirculationOverlay), ...patch };
  state.homeCirculationOverlay = view;
  if (view.on && recalculate) state.homeCirculationOverlay = overlayResult(project, view);
  requestDraw?.();
  rerender?.();
}

/** Обрабатывает select/input этапа 5. */
export function handleHomeCirculationInput(event, deps = {}) {
  const input = event?.target?.closest?.('[data-circulation-anchor], [data-circulation-width], [data-circulation-metric], [data-circulation-period]');
  if (!input || !input.closest('[data-home-circulation]')) return false;
  const { project, state, rerender, requestDraw } = deps;
  if (!project || !state) return false;
  if (input.dataset.circulationAnchor) {
    return event.type === 'change' ? updateAnchor(input, deps) : false;
  }
  if (input.hasAttribute('data-circulation-width')) {
    if (String(input.value ?? '').trim() === '') return true;
    const width = Math.max(300, Math.min(2000, Number(input.value)));
    if (!Number.isFinite(width)) return true;
    // Во время ввода не заменяем всю панель: иначе потеряется курсор.
    state.homeCirculationOverlay = {
      ...defaultView(state.homeCirculationOverlay), profileWidthMm: width,
    };
    if (event.type === 'change') {
      updateAnalysisView(project, state, { profileWidthMm: width }, rerender, requestDraw, { recalculate: true });
    }
    return true;
  }
  if (input.hasAttribute('data-circulation-metric')) {
    updateAnalysisView(project, state, { metric: input.value === 'frequency' ? 'frequency' : 'route_count' }, rerender, requestDraw);
    return true;
  }
  if (input.hasAttribute('data-circulation-period')) {
    updateAnalysisView(project, state, { period: input.value || null }, rerender, requestDraw);
    return true;
  }
  return false;
}

function disableOtherOverlays(state) {
  state.homeProgramOverlay = {
    ...object(state.homeProgramOverlay), on: false, result: null, signature: null,
  };
  state.homeEngineeringOverlay = { on: false, result: null, signature: null };
  state._homeProgramUI = null;
  state._homeFlowsUI = null;
  state._homeEngineeringUI = null;
  if (state.ergo?.on) state.ergo = { ...state.ergo, on: false };
}

/** Обрабатывает кнопки этапа 5. */
export function handleHomeCirculationClick(event, deps = {}) {
  const button = event?.target?.closest?.('[data-home-circulation-action]');
  if (!button || !button.closest('[data-home-circulation]')) return false;
  const {
    project, state, rerender, requestDraw, closePanel, setEditorMode, toast, announce,
  } = deps;
  if (!project || !state) return false;
  const action = button.dataset.homeCirculationAction;
  if (action === 'set-profile') {
    const width = Number(button.dataset.circulationProfile);
    if (PROFILE_WIDTHS.includes(width)) {
      updateAnalysisView(project, state, { profileWidthMm: width }, rerender, requestDraw, { recalculate: true });
    }
    return true;
  }
  const flag = {
    'toggle-routes': 'routes',
    'toggle-heatmap': 'heatmap',
    'toggle-bottlenecks': 'bottlenecks',
  }[action];
  if (flag) {
    const view = defaultView(state.homeCirculationOverlay);
    updateAnalysisView(project, state, { [flag]: !view[flag] }, rerender, requestDraw);
    return true;
  }
  if (action !== 'toggle-overlay') return false;
  const current = defaultView(state.homeCirculationOverlay);
  if (current.on) {
    state.homeCirculationOverlay = {
      ...current, on: false, result: null, signature: null,
    };
    state._homeCirculationUI = null;
    requestDraw?.();
    rerender?.();
    announce?.('Маршруты движения скрыты');
    return true;
  }
  const hasRooms = array(project.levels).some((level) => array(level.rooms).length);
  if (!hasRooms) {
    toast?.('Сначала добавьте помещения на план', true);
    announce?.('Движение и проходы пока нельзя рассчитать');
    return false;
  }
  disableOtherOverlays(state);
  state.homeCirculationOverlay = overlayResult(project, current);
  closePanel?.({ restoreFocus: false });
  setEditorMode?.('plan');
  requestDraw?.();
  rerender?.();
  toast?.(`Маршруты рассчитаны для профиля ${state.homeCirculationOverlay.profileWidthMm} мм`);
  announce?.('Маршруты движения показаны на плане');
  return true;
}

/** Пересчитывает включённый слой после изменения модели. */
export function refreshHomeCirculationOverlay(project, state, requestDraw) {
  if (!project || !state?.homeCirculationOverlay?.on) return null;
  const result = safeAnalysis(project, state.homeCirculationOverlay);
  state.homeCirculationOverlay = {
    ...defaultView(state.homeCirculationOverlay),
    on: true,
    result,
    signature: sourceSignature(project, state.homeCirculationOverlay),
  };
  requestDraw?.();
  return result;
}
