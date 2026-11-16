// Интерфейс этапа «Зоны и маршруты».
//
// Сохраняются только явные решения пользователя: включённые сценарии,
// частота и привязка абстрактных якорей к конкретным помещениям. Сам анализ
// и экранный слой производные, поэтому в историю проекта не записываются.

import { roomType } from '../core/catalog.js';
import { analyzeHomeFlows } from '../core/home-flows.js';
import { ensureLayoutBrief } from '../core/layout-brief.js';
import { LAYOUT_SCENARIOS } from '../core/layout-knowledge.generated.js';
import { escapeHtml } from './dom.js';

const asArray = (value) => (Array.isArray(value) ? value : []);
const object = (value) => (value && typeof value === 'object' ? value : {});
const finite = (value) => value !== null && value !== undefined && value !== ''
  && Number.isFinite(Number(value));

const ZONE_LABELS = Object.freeze({
  living: 'Жилые',
  kitchen: 'Кухня и столовая',
  wet: 'Санузлы и гигиена',
  utility: 'Хозяйственные',
  circulation: 'Вход и проходы',
  outdoor: 'Наружные',
  unknown: 'Не классифицировано',
});

const STATUS_LABELS = Object.freeze({
  co_located: 'В одном помещении',
  direct: 'Есть прямой проход',
  reachable: 'Есть маршрут',
  adjacent_without_door: 'Граничат, но прохода нет',
  missing: 'Маршрута нет',
  unknown: 'Недостаточно данных',
  unknown_binding: 'Нужна привязка помещений',
});

const PERIOD_OPTIONS = Object.freeze([
  ['', 'Период не задан'],
  ['day', 'в день'],
  ['week', 'в неделю'],
  ['month', 'в месяц'],
  ['year', 'в год'],
  ['event', 'за событие'],
]);

// Якоря приходят из машиночитаемого реестра правил. В интерфейсе показываем
// понятные функции, а не внутренние английские идентификаторы.
const ANCHOR_ROLE_LABELS = Object.freeze({
  accessible_bathroom: 'доступный санузел',
  accessible_seat: 'доступное место для сидения',
  bathroom: 'санузел',
  bed_exit: 'выход от кровати',
  bed_exit_side: 'сторона выхода от кровати',
  bed_transfer_side: 'сторона пересадки у кровати',
  bedroom_exit: 'выход из спальни',
  breakfast_seat: 'место для завтрака',
  changing: 'место переодевания',
  child_room_entry: 'вход в детскую',
  clean_zone: 'чистая зона',
  cleaning_storage: 'хранение уборочного инвентаря',
  cleaning_targets: 'зоны уборки',
  coffee_station: 'кофейная зона',
  conversation_exit: 'выход из зоны общения',
  conversation_seats: 'места для общения',
  current_tasks: 'текущие дела',
  daily_activity: 'ежедневная активность',
  delivery_entry: 'вход для доставки',
  desk: 'рабочий стол',
  dining_seat: 'место за столом',
  dining_table: 'обеденный стол',
  dirty_collection: 'сбор белья',
  entry: 'вход',
  entry_seat: 'место у входа',
  equipment: 'оборудование',
  equipment_part: 'часть оборудования',
  folding_surface: 'поверхность для складывания',
  food_service: 'подача еды',
  future_tasks: 'будущие дела',
  guest_bathroom: 'гостевой санузел',
  guest_bed_exit: 'выход от гостевой кровати',
  guest_wc: 'гостевой туалет',
  linen_storage: 'хранение белья',
  living_entry: 'вход в гостиную',
  living_zone: 'зона гостиной',
  media_seat: 'место просмотра',
  media_seat_exit: 'выход от места просмотра',
  pet_bed: 'место питомца',
  pet_cleaning_storage: 'хранение ухода за питомцем',
  pet_food: 'кормление питомца',
  pet_toilet: 'туалет питомца',
  play_zone: 'игровая зона',
  pool_exit: 'выход из бассейна',
  prep_cook: 'подготовка и готовка',
  refrigerator: 'холодильник',
  resident_bathroom: 'санузел жильцов',
  resident_bed_exit: 'выход от кровати жильцов',
  robot_dock: 'станция робота-пылесоса',
  room_entry: 'вход в помещение',
  room_exit: 'выход из помещения',
  seasonal_furniture: 'сезонная мебель',
  seasonal_storage: 'сезонное хранение',
  service_entry: 'служебный вход',
  service_exit: 'служебный выход',
  service_storage: 'служебное хранение',
  service_target: 'обслуживаемая зона',
  shower: 'душ',
  staff_entry: 'вход персонала',
  terrace: 'терраса',
  towel_storage: 'хранение полотенец',
  toy_storage: 'хранение игрушек',
  unpacking_zone: 'зона распаковки',
  verified_exit: 'проверенный выход',
  wardrobe: 'гардероб',
  washer: 'стиральная машина',
  water_station: 'точка воды',
});

function anchorRoleLabel(role, fallback) {
  return ANCHOR_ROLE_LABELS[role] || fallback;
}
function safeAnalysis(project) {
  try {
    return analyzeHomeFlows(project, {
      routeBindings: asArray(project?.layoutBrief?.scenarioRouteBindings),
    });
  } catch (error) {
    console.error('Зоны и маршруты не рассчитались:', error);
    return {
      zones: { rooms: [], groups: [] },
      functionalRoutes: [], scenarios: [], unresolved: [],
      summary: {
        activeScenarioCount: 0, resolvedRouteCount: 0,
        missingRouteCount: 0, unknownRouteCount: 0,
      },
      warnings: ['Не удалось выполнить анализ зон и маршрутов.'],
    };
  }
}

function selectionMap(project) {
  return new Map(asArray(project?.layoutBrief?.scenarioSelections)
    .map((entry) => [entry?.scenarioId, entry]));
}

function bindingsByRoute(project) {
  const result = new Map();
  for (const entry of asArray(project?.layoutBrief?.scenarioRouteBindings)) {
    if (!entry?.scenarioId || !entry?.routeId) continue;
    const key = `${entry.scenarioId}\u0000${entry.routeId}`;
    if (!result.has(key)) result.set(key, []);
    result.get(key).push(entry);
  }
  return result;
}

function scenarioAnalysisMap(result) {
  return new Map(asArray(result?.scenarios).map((entry) => [entry?.scenarioId, entry]));
}

function selectOptions(options, selected) {
  return options.map(([value, label]) => `<option value="${escapeHtml(value)}"${String(selected ?? '') === String(value) ? ' selected' : ''}>${escapeHtml(label)}</option>`).join('');
}

function scenarioMode(selection) {
  if (selection?.enabled === false) return 'disabled';
  if (selection?.enabled === true && selection?.mandatory === true) return 'required';
  if (selection?.enabled === true) return 'optional';
  return '';
}

function roomValue(endpoint) {
  if (!endpoint?.levelId || !endpoint?.roomId) return '';
  return `${encodeURIComponent(endpoint.levelId)}|${encodeURIComponent(endpoint.roomId)}`;
}

function parseRoomValue(value) {
  if (!value) return null;
  const separator = value.indexOf('|');
  if (separator < 0) return null;
  try {
    const levelId = decodeURIComponent(value.slice(0, separator));
    const roomId = decodeURIComponent(value.slice(separator + 1));
    return levelId && roomId ? { levelId, roomId } : null;
  } catch {
    return null;
  }
}

function roomsOptions(project, selected) {
  const groups = asArray(project?.levels).map((level) => {
    const options = asArray(level?.rooms).map((room) => {
      const value = roomValue({ levelId: level.id, roomId: room.id });
      const title = room.name || roomType(room.type)?.title || room.type || room.id;
      return `<option value="${escapeHtml(value)}"${value === selected ? ' selected' : ''}>${escapeHtml(title)}</option>`;
    }).join('');
    return options ? `<optgroup label="${escapeHtml(level.name || level.id)}">${options}</optgroup>` : '';
  }).join('');
  return `<option value=""${selected ? '' : ' selected'}>Не привязано</option>${groups}`;
}

function analysisStatus(result) {
  const summary = object(result?.summary);
  const active = Number(summary.activeScenarioCount) || 0;
  const missing = Number(summary.missingRouteCount) || 0;
  const unknown = Number(summary.unknownRouteCount) || 0;
  const resolved = Number(summary.resolvedRouteCount) || 0;
  const functionalProblems = Number(summary.functionalProblemCount) || 0;
  const unknownFrequency = Number(summary.unknownFrequencyRouteCount) || 0;
  if (functionalProblems) return {
    id: 'incomplete', title: 'Есть проблемы',
    note: `${functionalProblems} обязательных связей программы не подтверждено.`,
  };
  if (!active) return { id: 'unknown', title: 'Не рассчитано', note: 'Выберите хотя бы один сценарий жизни.' };
  if (missing) return { id: 'incomplete', title: 'Есть проблемы', note: `${missing} маршрутов не имеют доказанного прохода.` };
  if (unknown || unknownFrequency) return {
    id: 'draft', title: 'Предварительно',
    note: unknown ? `${unknown} маршрутов требуют привязки или уточнения.` : 'Для части маршрутов не задана частота.',
  };
  if (resolved) return { id: 'ready', title: 'Проверено', note: 'Все выбранные маршруты доказаны графом дверей.' };
  return { id: 'draft', title: 'Предварительно', note: 'Недостаточно данных для проверки маршрутов.' };
}

function zoneCards(result) {
  const groups = asArray(result?.zones?.groups);
  const rooms = asArray(result?.zones?.rooms);
  const counts = new Map(groups.map((group) => [group.zoneId, Number(group.count) || asArray(group.roomKeys).length]));
  if (!groups.length) {
    for (const room of rooms) counts.set(room.zoneId || 'unknown', (counts.get(room.zoneId || 'unknown') || 0) + 1);
  }
  const ids = [...Object.keys(ZONE_LABELS).filter((id) => counts.has(id)), ...[...counts.keys()].filter((id) => !(id in ZONE_LABELS))];
  if (!ids.length) return '<p class="home-flows-empty">Начертите помещения — их функциональные зоны появятся здесь.</p>';
  return `<div class="home-flows-zones">${ids.map((id) => `<div class="home-flows-zone" data-zone="${escapeHtml(id)}"><i aria-hidden="true"></i><span>${escapeHtml(ZONE_LABELS[id] || id)}</span><strong>${counts.get(id)}</strong></div>`).join('')}</div>`;
}

function routeStatus(route) {
  return route?.status || 'unknown';
}

function routePath(route) {
  return asArray(route?.pathRoomKeys).length ? route.pathRoomKeys : asArray(route?.pathRoomIds);
}

function routeReason(route) {
  const status = routeStatus(route);
  const path = routePath(route);
  if (route?.reason) return route.reason;
  if (status === 'reachable') return `Маршрут проходит через ${Math.max(0, path.length - 2)} промежуточных помещений.`;
  return STATUS_LABELS[status] || STATUS_LABELS.unknown;
}

function functionalRoutesHtml(result) {
  const routes = asArray(result?.functionalRoutes);
  if (!routes.length) {
    return '<p class="home-flows-empty">Подтвердите программу дома — тогда появятся обязательные связи помещений.</p>';
  }
  return `<div class="home-flows-route-list">${routes.map((route) => {
    const status = routeStatus(route);
    const title = route.title || route.label || route.id || 'Функциональная связь';
    const required = route.required === true;
    return `<article class="home-flows-route" data-status="${escapeHtml(status)}">
      <div><strong>${escapeHtml(title)}</strong><span>${escapeHtml(STATUS_LABELS[status] || STATUS_LABELS.unknown)}</span></div>
      <p>${escapeHtml(routeReason(route))}</p>
      <small>${required ? 'Требование подтверждённой программы' : 'Предварительная связь; в нагрузку не включена'}</small>
    </article>`;
  }).join('')}</div>`;
}

function routeBindingEditor(project, scenario, route, binding, routeResult, instanceIndex, instanceCount) {
  const from = roomValue(binding?.from);
  const to = roomValue(binding?.to);
  const status = routeResult?.status || 'unknown';
  const instanceId = binding?.instanceId || 'default';
  const fromLabel = anchorRoleLabel(route.from_anchor_role, 'начальная функция');
  const toLabel = anchorRoleLabel(route.to_anchor_role, 'целевая функция');
  return `<div class="home-flow-binding" data-status="${escapeHtml(status)}">
    <div class="home-flow-binding-head">
      <span>${escapeHtml(fromLabel)} → ${escapeHtml(toLabel)}${instanceCount > 1 ? ` · вариант ${instanceIndex + 1}` : ''}</span>
      <small>${escapeHtml(STATUS_LABELS[status] || STATUS_LABELS.unknown)}</small>
    </div>
    <div class="home-flow-binding-grid">
      <label class="prop-field"><span>Откуда</span><select data-home-flow-binding="from" data-scenario-id="${escapeHtml(scenario.scenario_id)}" data-route-id="${escapeHtml(route.route_id)}" data-instance-id="${escapeHtml(instanceId)}">${roomsOptions(project, from)}</select></label>
      <label class="prop-field"><span>Куда</span><select data-home-flow-binding="to" data-scenario-id="${escapeHtml(scenario.scenario_id)}" data-route-id="${escapeHtml(route.route_id)}" data-instance-id="${escapeHtml(instanceId)}">${roomsOptions(project, to)}</select></label>
    </div>
    ${routeResult?.reason ? `<p>${escapeHtml(routeResult.reason)}</p>` : ''}
  </div>`;
}

function scenarioCards(project, result) {
  const selections = selectionMap(project);
  const bindings = bindingsByRoute(project);
  const analyzed = scenarioAnalysisMap(result);
  return `<div class="home-flow-scenarios">${LAYOUT_SCENARIOS.map((scenario) => {
    const selection = selections.get(scenario.scenario_id);
    const mode = scenarioMode(selection);
    const active = selection?.enabled === true;
    const scenarioResult = analyzed.get(scenario.scenario_id);
    const routeResults = new Map(asArray(scenarioResult?.routes).map((route) => [
      `${route.routeId}\u0000${route.instanceId || 'default'}`, route,
    ]));
    const firstRouteResult = new Map();
    for (const routeResult of asArray(scenarioResult?.routes)) {
      if (!firstRouteResult.has(routeResult.routeId)) firstRouteResult.set(routeResult.routeId, routeResult);
    }
    const routeEditors = active ? asArray(scenario.route_pairs).map((route) => {
      const routeBindings = bindings.get(`${scenario.scenario_id}\u0000${route.route_id}`) || [];
      const instances = routeBindings.length ? routeBindings : [null];
      return instances.map((binding, instanceIndex) => {
        const routeResult = binding
          ? routeResults.get(`${route.route_id}\u0000${binding.instanceId || 'default'}`)
            || firstRouteResult.get(route.route_id)
          : firstRouteResult.get(route.route_id);
        return routeBindingEditor(
          project, scenario, route, binding, routeResult, instanceIndex, instances.length,
        );
      }).join('');
    }).join('') : '';
    return `<details class="home-flow-scenario" data-home-flow-scenario-id="${escapeHtml(scenario.scenario_id)}" data-active="${active}"${active ? ' open' : ''}>
      <summary>
        <span><small>${escapeHtml(scenario.scenario_id)}</small><strong>${escapeHtml(scenario.title)}</strong></span>
        <em>${active ? `${asArray(scenario.route_pairs).length} маршрута` : mode === 'disabled' ? 'не применяется' : 'не выбран'}</em>
      </summary>
      <div class="home-flow-scenario-body">
        <p>${escapeHtml(scenario.description)}</p>
        <label class="prop-field"><span>Статус сценария</span><select data-home-flow-scenario="${escapeHtml(scenario.scenario_id)}">${selectOptions([
    ['', 'Не определён'], ['required', 'Обязательный'], ['optional', 'Желательный'], ['disabled', 'Не применяется'],
  ], mode)}</select></label>
        ${active ? `<div class="home-flow-frequency">
          <label class="prop-field"><span>Частота</span><input type="number" min="0" step="0.1" inputmode="decimal" data-home-flow-frequency-value="${escapeHtml(scenario.scenario_id)}" value="${finite(selection.frequencyValue) ? escapeHtml(selection.frequencyValue) : ''}" placeholder="не задана"></label>
          <label class="prop-field"><span>Период</span><select data-home-flow-frequency-period="${escapeHtml(scenario.scenario_id)}">${selectOptions(PERIOD_OPTIONS, selection.frequencyPeriod || '')}</select></label>
        </div>
        <p class="home-flow-hint">Частота используется только когда заданы оба поля; разные периоды не складываются.</p>
        <div class="home-flow-bindings">${routeEditors || '<p class="home-flows-empty">В сценарии нет маршрутов для привязки.</p>'}</div>` : '<p class="home-flow-hint">Сценарий не влияет на анализ, пока его явно не включить.</p>'}
      </div>
    </details>`;
  }).join('')}</div>`;
}

function warningsHtml(result) {
  const warnings = asArray(result?.warnings).filter((item) => typeof item === 'string' && item.trim());
  return warnings.length ? `<ul class="home-flows-warnings">${warnings.slice(0, 8).map((warning) => `<li>${escapeHtml(warning)}</li>`).join('')}</ul>` : '';
}

function overlaySetting(state, key, fallback) {
  const view = object(state?.homeProgramOverlay);
  return view.mode === 'flows' && typeof view[key] === 'boolean' ? view[key] : fallback;
}

/** Рендер содержимого внутреннего этапа «Зоны и маршруты». */
export function homeFlowsHtml(project, state = {}) {
  const result = safeAnalysis(project);
  const status = analysisStatus(result);
  const summary = object(result.summary);
  const zonesOn = overlaySetting(state, 'zones', true);
  const routesOn = overlaySetting(state, 'routes', true);
  const problemsOnly = overlaySetting(state, 'problemsOnly', false);
  const overlayOn = state?.homeProgramOverlay?.on === true && state?.homeProgramOverlay?.mode === 'flows';
  const functionalProblems = Number(summary.functionalProblemCount) || 0;
  return `<div class="home-flows" data-home-flows>
    <div class="home-flows-summary" data-status="${escapeHtml(status.id)}">
      <div><strong>${escapeHtml(status.title)}</strong><span>${escapeHtml(status.note)}</span></div>
      <dl>
        <div><dt>Зон</dt><dd>${Number(summary.zoneCount) || 0}</dd></div>
        <div><dt>Маршрутов</dt><dd>${(Number(summary.resolvedRouteCount) || 0) + (Number(summary.resolvedFunctionalRouteCount) || 0)}</dd></div>
        <div><dt>Проблем</dt><dd>${(Number(summary.missingRouteCount) || 0) + functionalProblems}</dd></div>
        <div><dt>Неизвестно</dt><dd>${Number(summary.unknownRouteCount) || 0}</dd></div>
      </dl>
    </div>
    <p class="home-flow-disclaimer"><strong>Это схема функциональных связей.</strong> Она проверяет граф помещений и дверей, но пока не измеряет точную траекторию человека вокруг мебели, ширину прохода или столкновения. Толщина линии означает число явных требований и выбранных сценариев, а не число проходящих людей.</p>
    <div class="home-flow-layer-controls" aria-label="Слои анализа">
      <button type="button" class="project-route-switch" role="switch" aria-checked="${zonesOn}" data-home-flows-action="toggle-zones"><span aria-hidden="true"></span>Зоны</button>
      <button type="button" class="project-route-switch" role="switch" aria-checked="${routesOn}" data-home-flows-action="toggle-routes"><span aria-hidden="true"></span>Маршруты</button>
      <button type="button" class="project-route-switch" role="switch" aria-checked="${problemsOnly}" data-home-flows-action="toggle-problems"><span aria-hidden="true"></span>Только проблемы</button>
      <button type="button" class="primary home-flow-show" data-home-flows-action="toggle-overlay">${overlayOn ? 'Скрыть с плана' : 'Показать на плане'}</button>
    </div>
    <section class="home-flows-section" aria-labelledby="homeFlowsZonesTitle">
      <div class="home-program-section-head"><div><h3 id="homeFlowsZonesTitle">Функциональные зоны</h3><p>Классификация следует типам помещений каталога.</p></div></div>
      ${zoneCards(result)}
    </section>
    <section class="home-flows-section" aria-labelledby="homeFlowsFunctionalTitle">
      <div class="home-program-section-head"><div><h3 id="homeFlowsFunctionalTitle">Связи программы</h3><p>Проверяются по реальным дверям и открытым границам.</p></div></div>
      ${functionalRoutesHtml(result)}
    </section>
    <section class="home-flows-section" aria-labelledby="homeFlowsScenariosTitle">
      <div class="home-program-section-head"><div><h3 id="homeFlowsScenariosTitle">Сценарии жизни</h3><p>Включите нужный сценарий и явно укажите помещения его маршрутов.</p></div></div>
      ${scenarioCards(project, result)}
    </section>
    ${warningsHtml(result)}
  </div>`;
}

function flowSignature(project) {
  return JSON.stringify({
    activeLevel: project?.activeLevel || null,
    levels: asArray(project?.levels).map((level) => ({
      id: level.id,
      rooms: asArray(level.rooms).map((room) => [room.id, room.type, room.x, room.y, room.w, room.h, room.outline]),
      openings: asArray(level.openings).map((opening) => [opening.id, opening.kind, opening.roomId, opening.side, opening.offset, opening.width, opening.host, opening.orphan]),
    })),
    program: project?.layoutBrief?.homeProgram || null,
    scenarios: project?.layoutBrief?.scenarioSelections || [],
    bindings: project?.layoutBrief?.scenarioRouteBindings || [],
  });
}

function overlayResult(project, state, previous = {}) {
  const settings = previous?.mode === 'flows' ? previous : {};
  return {
    on: true,
    mode: 'flows',
    zones: typeof settings.zones === 'boolean' ? settings.zones : true,
    routes: typeof settings.routes === 'boolean' ? settings.routes : true,
    problemsOnly: settings.problemsOnly === true,
    selectedScenarioId: settings.selectedScenarioId || null,
    result: safeAnalysis(project),
    signature: flowSignature(project),
  };
}

function refreshAfterStoredChange(project, state, rerender, requestDraw) {
  if (state?.homeProgramOverlay?.on && state.homeProgramOverlay.mode === 'flows') {
    state.homeProgramOverlay = overlayResult(project, state, state.homeProgramOverlay);
    requestDraw?.();
  }
  rerender?.();
}

function mutateBrief(project, mutate, callback) {
  if (!project || typeof mutate !== 'function') return false;
  return mutate(() => callback(ensureLayoutBrief(project)));
}

function updateScenario(input, dependencies) {
  const { project, mutate, rerender, requestDraw } = dependencies;
  const scenarioId = input.dataset.homeFlowScenario;
  const mode = input.value;
  const changed = mutateBrief(project, mutate, (brief) => {
    const previous = asArray(brief.scenarioSelections).find((entry) => entry.scenarioId === scenarioId);
    brief.scenarioSelections = asArray(brief.scenarioSelections).filter((entry) => entry.scenarioId !== scenarioId);
    if (!mode) return;
    brief.scenarioSelections.push({
      scenarioId,
      enabled: mode !== 'disabled',
      mandatory: mode === 'required' ? true : mode === 'optional' ? false : null,
      actorPersonIds: asArray(previous?.actorPersonIds),
      frequencyValue: finite(previous?.frequencyValue) ? Number(previous.frequencyValue) : null,
      frequencyPeriod: previous?.frequencyPeriod || null,
      specificRequirements: previous?.specificRequirements || null,
      sourceRef: previous?.sourceRef || null,
    });
  });
  if (changed !== false) refreshAfterStoredChange(project, dependencies.state, rerender, requestDraw);
  return true;
}

function updateFrequency(input, dependencies) {
  if (dependencies.eventType === 'input') return false;
  const { project, mutate, rerender, requestDraw } = dependencies;
  const scenarioId = input.dataset.homeFlowFrequencyValue || input.dataset.homeFlowFrequencyPeriod;
  const isValue = Boolean(input.dataset.homeFlowFrequencyValue);
  const changed = mutateBrief(project, mutate, (brief) => {
    const selection = asArray(brief.scenarioSelections).find((entry) => entry.scenarioId === scenarioId);
    if (!selection || selection.enabled !== true) return;
    if (isValue) {
      const number = input.value.trim() === '' ? null : Number(input.value);
      selection.frequencyValue = Number.isFinite(number) && number >= 0 ? number : null;
    } else selection.frequencyPeriod = input.value || null;
  });
  if (changed !== false) refreshAfterStoredChange(project, dependencies.state, rerender, requestDraw);
  return true;
}

function updateBinding(input, dependencies) {
  const { project, mutate, rerender, requestDraw } = dependencies;
  const scenarioId = input.dataset.scenarioId;
  const routeId = input.dataset.routeId;
  const instanceId = input.dataset.instanceId || 'default';
  const end = input.dataset.homeFlowBinding;
  const endpoint = parseRoomValue(input.value);
  const changed = mutateBrief(project, mutate, (brief) => {
    const bindings = asArray(brief.scenarioRouteBindings);
    const index = bindings.findIndex((entry) => entry.scenarioId === scenarioId
      && entry.routeId === routeId && (entry.instanceId || 'default') === instanceId);
    const binding = index >= 0 ? { ...bindings[index] } : {
      scenarioId, routeId, instanceId, from: null, to: null, sourceRef: 'user',
    };
    binding[end] = endpoint;
    if (!binding.from && !binding.to) {
      if (index >= 0) bindings.splice(index, 1);
    } else if (index >= 0) bindings[index] = binding;
    else bindings.push(binding);
    brief.scenarioRouteBindings = bindings;
  });
  if (changed !== false) refreshAfterStoredChange(project, dependencies.state, rerender, requestDraw);
  return true;
}

/** Обрабатывает change/input внутри редактора маршрутов. */
export function handleHomeFlowsInput(event, dependencies = {}) {
  const input = event.target?.closest?.('[data-home-flow-scenario], [data-home-flow-frequency-value], [data-home-flow-frequency-period], [data-home-flow-binding]');
  if (!input || !input.closest('[data-home-flows]')) return false;
  const args = { ...dependencies, eventType: event.type };
  if (input.dataset.homeFlowScenario) return event.type === 'change' ? updateScenario(input, args) : false;
  if (input.dataset.homeFlowFrequencyValue || input.dataset.homeFlowFrequencyPeriod) return updateFrequency(input, args);
  if (input.dataset.homeFlowBinding) return event.type === 'change' ? updateBinding(input, args) : false;
  return false;
}

function updateView(state, action) {
  const previous = object(state?.homeProgramOverlay);
  const view = previous.mode === 'flows' ? previous : {
    on: false, mode: 'flows', zones: true, routes: true, problemsOnly: false,
    selectedScenarioId: null, result: null, signature: null,
  };
  if (action === 'toggle-zones') view.zones = view.zones === false;
  if (action === 'toggle-routes') view.routes = view.routes === false;
  if (action === 'toggle-problems') view.problemsOnly = view.problemsOnly !== true;
  state.homeProgramOverlay = { ...view };
}

/** Обрабатывает кнопки слоёв. Геометрию проекта не меняет. */
export function handleHomeFlowsClick(event, dependencies = {}) {
  const button = event.target?.closest?.('[data-home-flows-action]');
  if (!button || !button.closest('[data-home-flows]')) return false;
  const {
    project, state, rerender, requestDraw, closePanel, toast, announce,
  } = dependencies;
  if (!project || !state) return false;
  const action = button.dataset.homeFlowsAction;
  if (['toggle-zones', 'toggle-routes', 'toggle-problems'].includes(action)) {
    updateView(state, action);
    if (state.homeProgramOverlay.on) {
      state.homeProgramOverlay = overlayResult(project, state, state.homeProgramOverlay);
    }
    requestDraw?.();
    rerender?.();
    return true;
  }
  if (action !== 'toggle-overlay') return false;
  if (state.homeProgramOverlay?.on && state.homeProgramOverlay.mode === 'flows') {
    state.homeProgramOverlay = { ...state.homeProgramOverlay, on: false, result: null, signature: null };
    state._homeProgramUI = null;
    state._homeFlowsUI = null;
    requestDraw?.();
    rerender?.();
    announce?.('Зоны и маршруты скрыты');
    return true;
  }
  const result = safeAnalysis(project);
  if (!asArray(result?.zones?.rooms).length) {
    toast?.('Сначала добавьте помещения на план', true);
    announce?.('Зоны и маршруты пока нельзя показать');
    return false;
  }
  state.homeProgramOverlay = {
    ...overlayResult(project, state, state.homeProgramOverlay), result,
  };
  state.homeEngineeringOverlay = { on: false, result: null, signature: null };
  state._homeEngineeringUI = null;
  closePanel?.({ restoreFocus: false });
  dependencies.setEditorMode?.('plan');
  requestDraw?.();
  rerender?.();
  toast?.('Зоны и схема маршрутов показаны на плане');
  announce?.('Зоны и схема маршрутов показаны на плане');
  return true;
}

/** Пересчитывает включённый производный слой после изменения проекта. */
export function refreshHomeFlowsOverlay(project, state, requestDraw) {
  if (!project || !state?.homeProgramOverlay?.on || state.homeProgramOverlay.mode !== 'flows') return null;
  const result = safeAnalysis(project);
  if (!asArray(result?.zones?.rooms).length) {
    state.homeProgramOverlay = { ...state.homeProgramOverlay, on: false, result: null, signature: null };
    state._homeProgramUI = null;
    state._homeFlowsUI = null;
  } else {
    state.homeProgramOverlay = {
      ...overlayResult(project, state, state.homeProgramOverlay), result,
    };
  }
  requestDraw?.();
  return result;
}
