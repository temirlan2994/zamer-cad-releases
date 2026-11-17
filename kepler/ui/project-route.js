// «Маршрут проекта»: проверяемая последовательность подготовки участка.
// Статусы всегда заново выводятся из project.site (core/site-planning.js),
// а в проект записываются только явные решения пользователя.

import { contextNeighborSignature } from '../core/site.js';
import { analyzeHomeProgram } from '../core/home-program.js';
import { siteOpportunity, sitePassport, sitePlanningRoute } from '../core/site-planning.js';
import { escapeHtml, refs, toast } from './dom.js';
import {
  handleHomeProgramClick, handleHomeProgramInput, homeProgramHtml,
  refreshHomeProgramOverlay,
} from './home-program.js';
import {
  handleHomeFlowsClick, handleHomeFlowsInput, homeFlowsHtml,
  refreshHomeFlowsOverlay,
} from './home-flows.js';
import {
  handleHomeEngineeringClick, handleHomeEngineeringInput, homeEngineeringHtml,
  refreshHomeEngineeringOverlay,
} from './home-engineering.js';
import {
  handleHomeCirculationClick, handleHomeCirculationInput, homeCirculationHtml,
  refreshHomeCirculationOverlay,
} from './home-circulation.js';
import {
  handleHomeClimateClick, handleHomeClimateInput, homeClimateHtml,
} from './home-climate.js';
import { handleHomeReviewClick, homeReviewHtml } from './home-review.js';
import { handleHomeEnvelopeClick, homeEnvelopeHtml } from './home-envelope.js';
import { handleHomeDeliverablesClick, homeDeliverablesHtml } from './home-deliverables.js';
import { handleExport } from './files.js';
import { goToIssue } from './issues.js';
import { switchLevel } from './levels.js';
import { closeSheets, isPhone, toggleSheet } from './mobile.js';
import { setEditorMode } from './modes.js';
import { startPlanSectionTool } from './plan-section.js';
import { renderProps } from './props.js';
import { openView } from './props-views.js';
import { setSolarAnalysis } from './solar-analysis.js';
import { state } from './state.js';
import { mutate, PROJECT_CHANGE_EVENT } from './store.js';
import { activateSiteTool } from './toolstrip.js';
import { cancelTool } from './tools.js';
import { requestDraw } from './view.js';

const STAGES = Object.freeze([
  Object.freeze({
    id: 'foundation',
    title: 'Основа',
    short: 'Основа',
    intro: 'Подготовьте исходную съёмку и замкнутую границу участка.',
    aliases: ['foundation', 'basis', 'base', 'source', 'source-data', 'основа'],
    tasks: ['underlay', 'boundary'],
  }),
  Object.freeze({
    id: 'access',
    title: 'Доступ и окружение',
    short: 'Доступ',
    intro: 'Укажите, как попадают на участок, и внесите известное окружение.',
    aliases: ['access', 'access-context', 'доступ'],
    tasks: ['road', 'entry', 'neighbor'],
  }),
  Object.freeze({
    id: 'conditions',
    title: 'Солнце и рельеф',
    short: 'Условия',
    intro: 'Подтвердите ориентацию по северу и задайте поверхность участка.',
    aliases: ['conditions', 'environment', 'sun-terrain', 'solar-terrain', 'terrain-solar', 'условия'],
    tasks: ['north', 'terrain'],
  }),
  Object.freeze({
    id: 'constraints',
    title: 'Ограничения',
    short: 'Пятно',
    intro: 'Проверьте проектные отступы и рабочее пятно для размещения дома.',
    aliases: ['constraints', 'envelope', 'placement', 'build-zone', 'ограничения', 'пятно'],
    tasks: ['constraints', 'zone'],
  }),
]);

const TASKS = Object.freeze({
  underlay: Object.freeze({
    title: 'Топосъёмка или подложка',
    why: 'Помогает сверять границы, существующие объекты и размеры.',
    tool: 'underlay',
    aliases: ['underlay', 'survey', 'topography', 'base-map', 'подложка', 'топосъёмка'],
  }),
  boundary: Object.freeze({
    title: 'Граница участка',
    why: 'От неё считаются площадь, отступы и доступное рабочее пятно.',
    tool: 'boundary',
    aliases: ['boundary', 'site-boundary', 'parcel', 'граница'],
  }),
  road: Object.freeze({
    title: 'Дорога',
    why: 'Нужна для оценки подъезда и положения входной группы.',
    tool: 'road',
    aliases: ['road', 'roads', 'street', 'дорога'],
  }),
  entry: Object.freeze({
    title: 'Въезд на участок',
    why: 'Связывает дорогу с будущими маршрутами автомобиля и пешеходов.',
    tool: 'entry',
    aliases: ['entry', 'entrance', 'gate', 'driveway', 'въезд'],
  }),
  neighbor: Object.freeze({
    title: 'Соседние здания',
    why: 'Их положение влияет на приватность, тени и проектные ограничения.',
    tool: 'neighbor',
    aliases: ['neighbor', 'neighbors', 'context', 'surroundings', 'соседи'],
  }),
  north: Object.freeze({
    title: 'Север и координаты',
    why: 'Без подтверждённой ориентации нельзя честно сравнивать освещённость.',
    tool: 'north',
    aliases: ['north', 'solar', 'location', 'orientation', 'север', 'солнце'],
  }),
  terrain: Object.freeze({
    title: 'Рельеф',
    why: 'Отметки высот позволяют учитывать уклон и перепады участка.',
    tool: 'terrain',
    aliases: ['terrain', 'relief', 'elevation', 'рельеф', 'высоты'],
  }),
  constraints: Object.freeze({
    title: 'Проектные отступы',
    why: 'Значения задаёт и подтверждает пользователь для конкретного проекта.',
    aliases: ['constraints', 'setbacks', 'constraint-confirmation', 'отступы'],
  }),
  zone: Object.freeze({
    title: 'Рабочее пятно',
    why: 'Показывает область по введённым ограничениям и буферам соседних зданий.',
    aliases: ['zone', 'buildable', 'build-zone', 'working-zone', 'envelope', 'рабочее-пятно'],
  }),
});

const STATUS_LABEL = Object.freeze({
  done: 'Готово',
  warning: 'Нужно проверить',
  error: 'Есть проблема',
  unknown: 'Нет данных',
});

const STATUS_MARK = Object.freeze({ done: '✓', warning: '!', error: '×', unknown: '?' });
const HOME_PROGRAM_STATUS = Object.freeze({
  unknown: 'Не задана',
  draft: 'Черновик',
  incomplete: 'Не хватает',
  ready: 'Готова',
});
const CIRCULATION_PERIOD_LABEL = Object.freeze({
  day: 'проходов в день',
  week: 'проходов в неделю',
  month: 'проходов в месяц',
  year: 'проходов в год',
  event: 'проходов за событие',
});

let bound = false;
let panelOpen = false;
let panelView = 'stage';
let activeStage = STAGES[0].id;
let lastOpener = null;
let lastOpenerStage = null;
let latestModel = null;
let footprintDraft = null;
let footprintDraftProject = null;
let footprintDraftDirty = false;

const HOME_VIEW_DEFS = Object.freeze([
  Object.freeze({
    id: 'program', step: 2, label: 'Программа',
    kicker: 'Этап 2 · сценарий жизни', title: 'Программа дома',
    announce: 'Открыта программа дома',
    html: (project) => homeProgramHtml(project),
  }),
  Object.freeze({
    id: 'flows', step: 3, label: 'Связи',
    kicker: 'Этап 3 · связи дома', title: 'Зоны и маршруты',
    announce: 'Открыты зоны и маршруты',
    html: (project, currentState) => homeFlowsHtml(project, currentState),
  }),
  Object.freeze({
    id: 'engineering', step: 4, label: 'Инженерия',
    kicker: 'Этап 4 · предварительная схема', title: 'Инженерные связи',
    announce: 'Открыт предварительный инженерный обзор',
    html: (project, currentState) => homeEngineeringHtml(project, currentState),
  }),
  Object.freeze({
    id: 'circulation', step: 5, label: 'Движение',
    kicker: 'Этап 5 · маршруты внутри помещений', title: 'Движение и проходы',
    announce: 'Открыты движение и проходы',
    html: (project, currentState) => homeCirculationHtml(project, currentState),
  }),
  Object.freeze({
    id: 'climate', step: 6, label: 'Свет',
    kicker: 'Этап 6 · предварительная оценка', title: 'Свет и солнце',
    announce: 'Открыт предварительный анализ света и солнца',
    html: (project, currentState) => homeClimateHtml(project, currentState),
  }),
  Object.freeze({
    id: 'review', step: 7, label: 'Проверка',
    kicker: 'Этап 7 · сводка проекта', title: 'Проверка проекта',
    announce: 'Открыта сводная проверка проекта',
    html: (project, currentState) => homeReviewHtml(project, currentState),
  }),
  Object.freeze({
    id: 'envelope', step: 8, label: 'Объём',
    kicker: 'Этап 8 · геометрия здания', title: 'Объём и фасады',
    announce: 'Открыта геометрическая сводка здания',
    html: (project) => homeEnvelopeHtml(project),
  }),
  Object.freeze({
    id: 'deliverables', step: 9, label: 'Выпуск',
    kicker: 'Этап 9 · концептуальный комплект', title: 'Листы и выдача',
    announce: 'Открыт концептуальный комплект проекта',
    html: (project) => homeDeliverablesHtml(project),
  }),
]);
const HOME_VIEW_BY_ID = new Map(HOME_VIEW_DEFS.map((view) => [view.id, view]));
const HOME_VIEWS = new Set(HOME_VIEW_DEFS.map((view) => view.id));
const HOME_FOCUS_ATTRIBUTES = Object.freeze([
  'data-home-view', 'data-route-action',
  'data-home-program-field', 'data-home-program-option', 'data-home-program-action',
  'data-home-flow-scenario', 'data-home-flow-frequency-value',
  'data-home-flow-frequency-period', 'data-home-flow-binding',
  'data-home-flows-action', 'data-home-engineering-action',
  'data-engineering-field', 'data-point-id', 'data-scenario-id',
  'data-route-id', 'data-instance-id',
  'data-home-circulation-action', 'data-circulation-profile',
  'data-circulation-width', 'data-circulation-layer',
  'data-circulation-metric', 'data-circulation-period',
  'data-circulation-anchor',
  'data-home-climate-action', 'data-home-climate-room',
  'data-home-climate-room-key', 'data-home-climate-room-id',
  'data-home-climate-level-id', 'data-home-climate-map',
  'data-home-climate-date', 'data-home-climate-mode',
  'data-home-review-action', 'data-home-review-view',
  'data-home-review-issue', 'data-home-review-kind',
  'data-home-review-item-id',
  'data-home-envelope-action', 'data-home-envelope-view',
  'data-home-deliverables-action', 'data-home-deliverables-view',
  'data-home-deliverables-kind',
]);

const byId = (id) => document.getElementById(id);
const finite = (value) => value !== null && value !== undefined
  && !(typeof value === 'string' && value.trim() === '') && Number.isFinite(Number(value));
const asArray = (value) => (Array.isArray(value) ? value : []);
const cleanKey = (value) => String(value ?? '').toLocaleLowerCase('ru-RU').replace(/[^a-zа-яё0-9]+/g, '-').replace(/^-|-$/g, '');

function renderedHomeView(body) {
  if (body.querySelector('[data-home-program]')) return 'program';
  if (body.querySelector('[data-home-flows]')) return 'flows';
  if (body.querySelector('[data-home-engineering]')) return 'engineering';
  if (body.querySelector('[data-home-circulation]')) return 'circulation';
  if (body.querySelector('[data-home-climate]')) return 'climate';
  if (body.querySelector('[data-home-review]')) return 'review';
  if (body.querySelector('[data-home-envelope]')) return 'envelope';
  if (body.querySelector('[data-home-deliverables]')) return 'deliverables';
  return null;
}

function focusedHomeControl(body) {
  const element = document.activeElement;
  if (!element || !body.contains(element)) return null;
  const attributes = HOME_FOCUS_ATTRIBUTES
    .filter((name) => element.hasAttribute?.(name))
    .map((name) => [name, element.getAttribute(name)]);
  const pointId = element.closest?.('[data-engineering-point]')?.dataset.engineeringPoint || null;
  const scenarioId = element.closest?.('[data-home-flow-scenario-id]')?.dataset.homeFlowScenarioId || null;
  if (!attributes.length && !pointId && !scenarioId) return null;
  let selectionStart = null;
  let selectionEnd = null;
  try {
    selectionStart = element.selectionStart;
    selectionEnd = element.selectionEnd;
  } catch {
    // number/select не поддерживают выделение текста — фокус всё равно сохраняем.
  }
  return {
    tagName: element.tagName,
    attributes,
    pointId,
    scenarioId,
    selectionStart,
    selectionEnd,
  };
}

function captureHomePanelState(body, view) {
  if (renderedHomeView(body) !== view) return null;
  const panel = body.closest('.project-route-panel');
  return {
    scrollTop: panel?.scrollTop || 0,
    navScrollLeft: body.querySelector('.home-system-nav')?.scrollLeft || 0,
    focus: focusedHomeControl(body),
    scenarios: [...body.querySelectorAll('[data-home-flow-scenario-id]')].map((details) => ({
      id: details.dataset.homeFlowScenarioId,
      open: details.open === true,
    })),
  };
}

function matchesHomeControl(element, identity) {
  if (element.tagName !== identity.tagName) return false;
  if (identity.attributes.some(([name, value]) => element.getAttribute(name) !== value)) return false;
  const pointId = element.closest?.('[data-engineering-point]')?.dataset.engineeringPoint || null;
  const scenarioId = element.closest?.('[data-home-flow-scenario-id]')?.dataset.homeFlowScenarioId || null;
  return pointId === identity.pointId && scenarioId === identity.scenarioId;
}

function restoreHomePanelState(body, snapshot) {
  if (!snapshot) return;
  for (const item of snapshot.scenarios) {
    const details = [...body.querySelectorAll('[data-home-flow-scenario-id]')]
      .find((candidate) => candidate.dataset.homeFlowScenarioId === item.id);
    if (details) details.open = item.open;
  }
  const panel = body.closest('.project-route-panel');
  if (panel) panel.scrollTop = snapshot.scrollTop;
  const nav = body.querySelector('.home-system-nav');
  if (nav) nav.scrollLeft = snapshot.navScrollLeft || 0;
  const identity = snapshot.focus;
  if (!identity) return;
  const target = [...body.querySelectorAll(identity.tagName.toLocaleLowerCase('en-US'))]
    .find((candidate) => matchesHomeControl(candidate, identity));
  if (!target) return;
  target.focus({ preventScroll: true });
  if (Number.isInteger(identity.selectionStart) && Number.isInteger(identity.selectionEnd)) {
    try { target.setSelectionRange(identity.selectionStart, identity.selectionEnd); } catch { /* не текстовое поле */ }
  }
  if (panel) panel.scrollTop = snapshot.scrollTop;
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
}

function opportunityInputSignature(project, footprint) {
  const site = project?.site || {};
  const planning = site.planning || {};
  // Дом, мебель и тяжёлая подложка не входят: расчёт возможностей участка
  // от них не зависит. Полная строка вместо хеша исключает коллизии кеша.
  return JSON.stringify(stableValue({
    boundary: site.boundary || null,
    redLine: site.redLine || null,
    setbacks: [site.setbackBoundary, site.setbackNeighbor],
    roads: site.roads || [],
    entry: site.entry || null,
    neighbors: site.neighbors || [],
    north: site.north,
    location: site.location || null,
    solarVerified: site.solarVerified === true,
    terrain: site.terrain || null,
    landscapeObjects: site.landscape?.objects || [],
    planning: {
      flatTerrain: planning.flatTerrain === true,
      contextReviewed: planning.contextReviewed === true,
      contextSnapshot: planning.contextSnapshot || null,
      constraintsConfirmed: planning.constraintsConfirmed || null,
      weights: planning.weights || null,
      referenceFootprint: planning.referenceFootprint || null,
    },
    footprint,
  }));
}

function safeCall(fn, fallback) {
  try { return fn(); } catch (error) {
    console.error('Маршрут проекта не рассчитался:', error);
    return fallback;
  }
}

function polygonAreaM2(points) {
  if (!Array.isArray(points) || points.length < 3) return 0;
  let sum = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    sum += Number(a?.x || 0) * Number(b?.y || 0) - Number(b?.x || 0) * Number(a?.y || 0);
  }
  return Math.abs(sum) / 2_000_000;
}

function normalizeStatus(value) {
  const key = cleanKey(value);
  if (['done', 'complete', 'completed', 'pass', 'passed', 'ready', 'ok', 'valid', 'verified'].includes(key)) return 'done';
  if (['fail', 'failed', 'error', 'blocked', 'invalid', 'empty'].includes(key)) return 'error';
  if (['warning', 'warn', 'partial', 'preliminary', 'skipped', 'review', 'incomplete'].includes(key)) return 'warning';
  return 'unknown';
}

function constraintsMatch(site) {
  const confirmed = site?.planning?.constraintsConfirmed;
  if (!confirmed) return false;
  return Number(confirmed.setbackBoundary) === Number(site.setbackBoundary)
    && Number(confirmed.setbackNeighbor) === Number(site.setbackNeighbor);
}

function contextReviewMatches(site) {
  const planning = site?.planning || {};
  if (planning.contextReviewed !== true) return false;
  return typeof planning.contextSnapshot !== 'string'
    || planning.contextSnapshot === contextNeighborSignature(site?.neighbors);
}

function fallbackTaskStatus(id, site, passport) {
  const terrainPoints = asArray(site?.terrain?.points);
  switch (id) {
    case 'underlay': return site?.underlay ? 'done' : (site?.planning?.withoutUnderlay ? 'warning' : 'unknown');
    case 'boundary': return polygonAreaM2(site?.boundary) > 0 ? 'done' : 'error';
    case 'road': return asArray(site?.roads).some((road) => asArray(road?.points).length >= 2) ? 'done' : 'unknown';
    case 'entry': return site?.entry ? 'done' : 'unknown';
    case 'neighbor': return contextReviewMatches(site) ? 'done' : 'unknown';
    case 'north': return site?.solarVerified ? 'done' : 'unknown';
    case 'terrain': return terrainPoints.length >= 3 ? 'done' : (site?.planning?.flatTerrain ? 'warning' : 'unknown');
    case 'constraints': return constraintsMatch(site) ? 'done' : 'warning';
    case 'zone': {
      const status = passport?.workingZone?.status ?? passport?.buildable?.status
        ?? passport?.workingBuildable?.status ?? passport?.zone?.status;
      return status ? normalizeStatus(status) : 'unknown';
    }
    default: return 'unknown';
  }
}

function fallbackReason(id, site) {
  const planning = site?.planning || {};
  const points = asArray(site?.terrain?.points);
  switch (id) {
    case 'underlay':
      if (site?.underlay) return site.underlay.mmPerPx ? 'Подложка импортирована и имеет масштаб.' : 'Подложка импортирована; проверьте её масштаб.';
      return planning.withoutUnderlay ? 'Вы явно выбрали работу без подложки.' : 'Подложка не импортирована и работа без неё не подтверждена.';
    case 'boundary': {
      const area = polygonAreaM2(site?.boundary);
      return area > 0 ? `Замкнутая граница, площадь ${area.toLocaleString('ru-RU', { maximumFractionDigits: 1 })} м².` : 'Нужен замкнутый контур минимум из трёх точек.';
    }
    case 'road': {
      const count = asArray(site?.roads).length;
      return count ? `Добавлено дорог: ${count}.` : 'Дорога пока не указана.';
    }
    case 'entry': return site?.entry ? 'Точка въезда задана.' : 'Поставьте въезд на границе участка.';
    case 'neighbor': {
      const count = asArray(site?.neighbors).length;
      if (planning.contextReviewed && !contextReviewMatches(site)) return 'Соседние здания изменились после проверки — подтвердите окружение ещё раз.';
      if (contextReviewMatches(site)) return count
        ? `Внесённое окружение проверено; соседних зданий: ${count}.`
        : 'Окружение просмотрено; известные соседние здания не добавлены.';
      return count ? `Внесено соседних зданий: ${count}; полнота ещё не подтверждена.` : 'Пустой список ещё не означает, что соседних зданий нет.';
    }
    case 'north': return site?.solarVerified ? `Север и координаты подтверждены; север ${Math.round(Number(site.north) || 0)}°.` : 'Направление севера и координаты ещё не подтверждены.';
    case 'terrain':
      if (points.length >= 3) return `Расчёт выполняется по ${points.length} отметкам высоты.`;
      return planning.flatTerrain ? 'Вы явно приняли плоскую поверхность для этого эскиза.' : `Есть отметок: ${points.length}; для поверхности нужно минимум три.`;
    case 'constraints': {
      const boundary = (Number(site?.setbackBoundary || 0) / 1000).toLocaleString('ru-RU');
      const neighbor = (Number(site?.setbackNeighbor || 0) / 1000).toLocaleString('ru-RU');
      return constraintsMatch(site)
        ? `Подтверждены текущие значения: ${boundary} м от границы и ${neighbor} м от соседнего здания.`
        : `Сейчас введено: ${boundary} м от границы и ${neighbor} м от соседнего здания. Требуется ваше подтверждение.`;
    }
    case 'zone': return 'Рабочее пятно рассчитывается по границе, введённым отступам и буферам соседних зданий.';
    default: return '';
  }
}

function listsFromReport(report) {
  if (Array.isArray(report)) return report;
  return asArray(report?.stages).length ? report.stages
    : asArray(report?.steps).length ? report.steps
      : asArray(report?.route);
}

function idOf(value) {
  return cleanKey(value?.id ?? value?.key ?? value?.kind ?? value?.slug ?? value?.name ?? value?.title);
}

function findAliased(list, aliases) {
  const keys = aliases.map(cleanKey);
  return list.find((item) => {
    const id = idOf(item);
    return keys.some((key) => id === key || id.includes(key) || key.includes(id));
  }) || null;
}

function tasksFromStage(stage) {
  return asArray(stage?.tasks).length ? stage.tasks
    : asArray(stage?.checks).length ? stage.checks
      : asArray(stage?.items);
}

function evidenceText(task) {
  const direct = task?.reason ?? task?.summary ?? task?.detail ?? task?.message ?? task?.evidenceText;
  if (typeof direct === 'string' && direct.trim()) return direct.trim();
  for (const item of asArray(task?.evidence)) {
    if (typeof item === 'string' && item.trim()) return item.trim();
    const text = item?.text ?? item?.label ?? item?.message;
    if (typeof text === 'string' && text.trim()) return text.trim();
  }
  return '';
}

function aggregateStatus(tasks) {
  if (tasks.some((task) => task.status === 'error')) return 'error';
  if (tasks.length && tasks.every((task) => task.status === 'done')) return 'done';
  if (tasks.some((task) => task.status === 'done' || task.status === 'warning')) return 'warning';
  return 'unknown';
}

function routeModel() {
  const project = state.project;
  if (!project) return { stages: [], route: null, passport: null, homeProgram: null };
  const site = project.site || {};
  const route = safeCall(() => sitePlanningRoute(project), null);
  // sitePlanningRoute уже возвращает тот же паспорт. Повторный тяжёлый
  // геометрический расчёт нужен только как fallback для старого core.
  const passport = route?.passport ?? safeCall(() => sitePassport(project), null);
  const reportedStages = listsFromReport(route);
  const stages = STAGES.map((definition, stageIndex) => {
    const reported = findAliased(reportedStages, definition.aliases) || reportedStages[stageIndex] || null;
    const reportedTasks = tasksFromStage(reported);
    const reportedTasksHaveIds = reportedTasks.some((item) => idOf(item));
    const tasks = definition.tasks.map((id, taskIndex) => {
      const taskDefinition = TASKS[id];
      const source = findAliased(reportedTasks, taskDefinition.aliases)
        || (!reportedTasksHaveIds ? reportedTasks[taskIndex] : null) || null;
      const coreStatus = source?.status ?? source?.state ?? source?.result;
      return {
        id,
        definition: taskDefinition,
        status: coreStatus == null ? fallbackTaskStatus(id, site, passport) : normalizeStatus(coreStatus),
        reason: evidenceText(source) || fallbackReason(id, site),
        source,
      };
    });
    return {
      ...definition,
      tasks,
      // Панель показывает стабильный набор задач, поэтому статус этапа
      // агрегируется из тех же карточек и не расходится с видимой причиной.
      status: aggregateStatus(tasks),
    };
  });
  const homeProgram = safeCall(() => analyzeHomeProgram(project), {
    status: 'unknown', summary: {}, targets: [], connections: [], warnings: [],
  });
  return { stages, route, passport, homeProgram };
}

function statusLabel(status) { return STATUS_LABEL[status] || STATUS_LABEL.unknown; }
function statusMark(status) { return STATUS_MARK[status] || STATUS_MARK.unknown; }

function renderStageBar(model) {
  const steps = byId('projectRouteSteps');
  const summary = byId('projectRouteSummary');
  const program = byId('projectHomeProgram');
  const programStatus = byId('projectHomeProgramStatus');
  if (!steps || !summary) return;
  const homeStatus = model?.homeProgram?.status || 'unknown';
  const homeLabel = HOME_PROGRAM_STATUS[homeStatus] || HOME_PROGRAM_STATUS.unknown;
  if (program) {
    program.dataset.status = homeStatus;
    program.disabled = !state.project;
    program.setAttribute('aria-label', `Программа дома: ${homeLabel.toLocaleLowerCase('ru-RU')}`);
  }
  if (programStatus) programStatus.textContent = homeLabel;
  if (!state.project) {
    summary.textContent = 'Маршрут станет доступен после открытия проекта';
    steps.replaceChildren();
    return;
  }
  const done = model.stages.filter((stage) => stage.status === 'done').length;
  summary.textContent = `Участок · ${done} из ${model.stages.length} этапов`;
  steps.innerHTML = model.stages.map((stage, index) => {
    const current = panelOpen && panelView === 'stage' && activeStage === stage.id;
    return `<button type="button" class="project-route-step${current ? ' active' : ''}" data-route-stage="${stage.id}" data-status="${stage.status}" data-route-status="${stage.status}"${current ? ' aria-current="step"' : ''} aria-label="Этап ${index + 1}: ${escapeHtml(stage.title)}. ${statusLabel(stage.status)}">
      <span class="project-route-step-mark" aria-hidden="true">${stage.status === 'unknown' ? index + 1 : statusMark(stage.status)}</span>
      <span class="project-route-step-copy"><strong>${escapeHtml(stage.short)}</strong><small>${statusLabel(stage.status)}</small></span>
    </button>`;
  }).join('<span class="project-route-connector" aria-hidden="true"></span>');
}

function checked(value) { return value ? ' checked' : ''; }

function confirmationControl(taskId, site) {
  const planning = site?.planning || {};
  if (taskId === 'underlay' && !site?.underlay) {
    return `<label class="project-route-confirm"><input type="checkbox" data-route-confirm="withoutUnderlay"${checked(planning.withoutUnderlay)}> <span><strong>Работать без подложки</strong><small>Осознанное допущение; исходные объекты придётся вносить вручную.</small></span></label>`;
  }
  if (taskId === 'neighbor') {
    return `<label class="project-route-confirm"><input type="checkbox" data-route-confirm="contextReviewed"${checked(contextReviewMatches(site))}> <span><strong>Окружение просмотрено</strong><small>Все известные сейчас дороги и соседние здания внесены. После их изменения потребуется повторная проверка.</small></span></label>`;
  }
  if (taskId === 'terrain' && asArray(site?.terrain?.points).length < 3) {
    return `<label class="project-route-confirm"><input type="checkbox" data-route-confirm="flatTerrain"${checked(planning.flatTerrain)}> <span><strong>Считать участок плоским</strong><small>Использовать только как эскизное допущение до получения отметок.</small></span></label>`;
  }
  if (taskId === 'constraints') {
    return `<label class="project-route-confirm"><input type="checkbox" data-route-confirm="constraintsConfirmed"${checked(constraintsMatch(site))}> <span><strong>Я проверил(а) текущие отступы</strong><small>Повторное подтверждение потребуется после изменения значений.</small></span></label>`;
  }
  return '';
}

function toolActionLabel(taskId, site) {
  if (taskId === 'underlay') return site?.underlay ? 'Показать и поправить' : 'Импортировать';
  if (taskId === 'boundary') return site?.boundary ? 'Показать и поправить' : 'Начертить границу';
  if (taskId === 'road') return asArray(site?.roads).length ? 'Показать и поправить' : 'Добавить дорогу';
  if (taskId === 'entry') return site?.entry ? 'Показать и поправить' : 'Поставить въезд';
  if (taskId === 'neighbor') return 'Открыть инструмент';
  if (taskId === 'north') return 'Задать север';
  if (taskId === 'terrain') return 'Добавить отметки';
  return '';
}

function renderTask(task, site) {
  let action = '';
  if (task.definition.tool) action = `<button type="button" class="project-route-task-action" data-route-tool="${task.definition.tool}">${toolActionLabel(task.id, site)}</button>`;
  else if (task.id === 'constraints') action = '<button type="button" class="project-route-task-action" data-route-action="open-constraints">Открыть настройки отступов</button>';
  else if (task.id === 'zone') action = '<button type="button" class="project-route-task-action" data-route-action="show-zone">Показать на плане</button>';
  if (task.id === 'north' && !site?.solarVerified) {
    action += '<button type="button" class="project-route-task-action secondary" data-route-action="open-solar-settings">Ввести координаты и подтвердить</button>';
  }
  return `<article class="project-route-task" data-route-task="${task.id}" data-status="${task.status}" data-route-status="${task.status}">
    <span class="project-route-task-mark" aria-hidden="true">${statusMark(task.status)}</span>
    <div class="project-route-task-main">
      <div class="project-route-task-title"><h3>${escapeHtml(task.definition.title)}</h3><span>${statusLabel(task.status)}</span></div>
      <p>${escapeHtml(task.reason)}</p>
      <p class="project-route-why"><strong>Зачем:</strong> ${escapeHtml(task.definition.why)}</p>
      ${confirmationControl(task.id, site)}
      ${action}
    </div>
  </article>`;
}

function footprintSignature(footprint) {
  return footprint ? `${Number(footprint.width) || 0}:${Number(footprint.depth) || 0}:${Number(footprint.rotation) || 0}` : '';
}

function seedFootprintDraft() {
  const project = state.project;
  const footprint = project?.site?.planning?.referenceFootprint || null;
  if (footprintDraftProject !== project) {
    footprintDraftProject = project;
    footprintDraftDirty = false;
    footprintDraft = null;
  }
  if (!footprintDraftDirty && footprintSignature(footprintDraft?._source) !== footprintSignature(footprint)) {
    footprintDraft = {
      width: footprint ? String(Number(footprint.width) / 1000) : '',
      depth: footprint ? String(Number(footprint.depth) / 1000) : '',
      rotation: footprint ? String(Number(footprint.rotation) || 0) : '0',
      _source: footprint,
    };
  }
  return footprintDraft || { width: '', depth: '', rotation: '0', _source: null };
}

function firstFinite(...values) {
  return values.find((value) => finite(value));
}

const FACTOR_LABELS = Object.freeze({
  access: 'Доступ',
  slope: 'Уклон',
  sun: 'Солнце',
  solar: 'Солнце',
  privacy: 'Приватность',
  reserve: 'Запас до ограничений',
  boundaryReserve: 'Запас до ограничений',
});

function factorLabel(key) {
  return FACTOR_LABELS[key] || String(key).replace(/[-_]+/g, ' ');
}

function opportunitySummary(result) {
  if (!result) return '<p class="project-route-opportunity-empty">Расчёт ещё не выполнен.</p>';
  const candidates = asArray(result.candidates).length ? result.candidates : asArray(result.suggestions);
  const best = result.best || candidates[0] || null;
  const score = firstFinite(best?.score, result.bestScore, result.score);
  const coverage = firstFinite(best?.coverage, result.coverage, result.confidence);
  const cells = asArray(result.cells).length || asArray(result.grid?.cells).length || Number(result.cellCount || 0);
  const warnings = [...asArray(result.warnings), ...asArray(result.unknown)].filter((item) => typeof item === 'string').slice(0, 3);
  const factors = best?.factors && typeof best.factors === 'object' ? best.factors
    : result.factors && typeof result.factors === 'object' ? result.factors : {};
  const factorRows = Object.entries(factors).map(([key, factor]) => ({
    key,
    known: factor?.known !== false && (finite(factor?.score) || typeof factor === 'number'),
    score: typeof factor === 'number' ? factor : factor?.score,
    explanation: factor?.explanation ?? factor?.reason ?? '',
  }));
  const unknownFactors = [
    ...factorRows.filter((factor) => !factor.known).map((factor) => factor.key),
    ...asArray(best?.unknownFactors), ...asArray(result.unknownFactors),
  ].map((item) => (typeof item === 'string' ? item : item?.id ?? item?.key ?? item?.label)).filter(Boolean);
  const knownFactors = factorRows.filter((factor) => factor.known).slice(0, 6);
  const rawStatus = cleanKey(result.status);
  const status = normalizeStatus(result.status);
  const validPositions = candidates.length > 0
    || asArray(result.cells).some((cell) => !cell?.blocked);
  const insufficient = ['error', 'unknown', 'missing', 'invalid'].includes(rawStatus);
  const empty = ['empty', 'blocked'].includes(rawStatus) || (!validPositions && !insufficient);
  const headline = insufficient
    ? 'Недостаточно исходных данных для карты.'
    : empty
      ? 'Подходящее положение для введённого габарита не найдено.'
      : 'Предварительное сравнение положений готово.';
  return `<div class="project-route-opportunity-result" data-status="${insufficient || empty ? 'error' : status}">
    <strong>${headline}</strong>
    <dl>
      <div><dt>Кандидаты</dt><dd>${candidates.length}</dd></div>
      ${score == null ? '' : `<div><dt>Лучший относительный балл</dt><dd>${Math.round(Number(score))} / 100</dd></div>`}
      ${coverage == null ? '' : `<div><dt>Полнота факторов</dt><dd>${Math.round(Number(coverage) <= 1 ? Number(coverage) * 100 : Number(coverage))}%</dd></div>`}
      ${cells ? `<div><dt>Проверено положений</dt><dd>${Math.round(cells).toLocaleString('ru-RU')}</dd></div>` : ''}
    </dl>
    ${knownFactors.length ? `<div class="project-route-factors"><span>Вклад факторов</span><ul>${knownFactors.map((factor) => `<li><span>${escapeHtml(factorLabel(factor.key))}</span><strong>${Math.round(Number(factor.score))} / 100</strong>${factor.explanation ? `<small>${escapeHtml(factor.explanation)}</small>` : ''}</li>`).join('')}</ul></div>` : ''}
    ${unknownFactors.length ? `<p class="project-route-unknown-factors"><strong>Не рассчитано:</strong> ${[...new Set(unknownFactors)].map((key) => escapeHtml(factorLabel(key))).join(', ')}.</p>` : ''}
    ${warnings.length ? `<ul>${warnings.map((warning) => `<li>${escapeHtml(warning)}</li>`).join('')}</ul>` : ''}
  </div>`;
}

function renderFootprint(site) {
  const draft = seedFootprintDraft();
  const on = Boolean(state.siteOpportunity?.on);
  const result = state.siteOpportunity?.result || null;
  return `<section class="project-route-footprint" aria-labelledby="projectRouteFootprintTitle">
    <div class="project-route-section-head">
      <div><h3 id="projectRouteFootprintTitle">Проверочный габарит дома</h3><p>Введите ориентировочный прямоугольник. Без размеров нельзя проверить, помещается ли дом целиком.</p></div>
    </div>
    <form class="project-route-footprint-form" id="projectRouteFootprintForm">
      <label>Ширина, м<input name="width" data-route-footprint="width" type="number" min="2" max="100" step="0.1" inputmode="decimal" value="${escapeHtml(draft.width)}" placeholder="например, 12"></label>
      <label>Глубина, м<input name="depth" data-route-footprint="depth" type="number" min="2" max="100" step="0.1" inputmode="decimal" value="${escapeHtml(draft.depth)}" placeholder="например, 10"></label>
      <label>Поворот, °<input name="rotation" data-route-footprint="rotation" type="number" step="1" value="${escapeHtml(draft.rotation)}"></label>
      <button type="button" data-route-action="save-footprint">Сохранить габарит</button>
    </form>
    <div class="project-route-opportunity-head">
      <div><strong>Карта возможностей</strong><small>Рабочее пятно по введённым ограничениям</small></div>
      <button type="button" class="project-route-switch" role="switch" aria-checked="${on}" data-route-action="toggle-opportunity" data-route-opportunity="toggle"><span aria-hidden="true"></span>${on ? 'Показана' : 'Показать'}</button>
    </div>
    ${on || result ? opportunitySummary(result) : ''}
    ${on && result ? `<div class="project-route-opportunity-legend" aria-label="Легенда карты возможностей">
      <span><i data-tone="low"></i>Ниже балл</span>
      <span><i data-tone="high"></i>Выше балл</span>
      <span><i data-tone="unknown"></i>Мало данных</span>
      <span><i data-tone="candidate"></i>A–C · варианты</span>
    </div>` : ''}
    <p class="project-route-disclaimer"><strong>Эскизная проверка, не нормативное заключение.</strong> Проверьте значения по правилам вашего региона. Красная линия пока показывается как исходная линия и автоматически не вычитается: для неё не задана разрешённая сторона.</p>
  </section>`;
}

function renderStagePanel(stage) {
  const site = state.project?.site || {};
  const tasks = stage?.tasks || [];
  const done = tasks.filter((task) => task.status === 'done').length;
  return `<div class="project-route-stage-intro">
    <p>${escapeHtml(stage?.intro || '')}</p>
    <span>${done} из ${tasks.length}</span>
  </div>
  <div class="project-route-task-list">${tasks.map((task) => renderTask(task, site)).join('')}</div>
  ${stage?.id === 'constraints' ? renderFootprint(site) : ''}`;
}

function terrainRange(site) {
  const values = asArray(site?.terrain?.points).map((point) => Number(point?.z)).filter(Number.isFinite);
  if (!values.length) return null;
  return Math.max(...values) - Math.min(...values);
}

function passportArea(passport) {
  return firstFinite(
    passport?.workingAreaM2, passport?.buildableAreaM2, passport?.workingZone?.areaM2,
    passport?.buildable?.areaM2, passport?.workingBuildable?.areaM2, passport?.zone?.areaM2,
  );
}

function passportUnknowns(passport, site) {
  const fromCore = [
    ...asArray(passport?.unknown), ...asArray(passport?.unknowns), ...asArray(passport?.missing),
    ...asArray(passport?.errors),
  ].map((item) => {
    if (typeof item !== 'string') return item?.message ?? item?.reason ?? item?.label ?? item?.text;
    return passport?.facts?.[item]?.reason || passport?.facts?.[item]?.label || item;
  }).filter(Boolean);
  const result = [...fromCore];
  const facts = passport?.facts && typeof passport.facts === 'object' ? passport.facts : {};
  // Ручные формулировки нужны только для совместимости со старым отчётом.
  // Когда core уже вернул факт, не дублируем его вторым текстом.
  if (!facts.underlay && !site?.underlay && !site?.planning?.withoutUnderlay) result.push('Нет топосъёмки и не принято решение работать без неё.');
  if (!facts.boundary && !site?.boundary) result.push('Не задана граница участка.');
  if (!facts.context && !contextReviewMatches(site)) result.push('Полнота сведений об окружении не подтверждена.');
  if (!facts.solar && !site?.solarVerified) result.push('Север и координаты не подтверждены.');
  if (!facts.terrain && asArray(site?.terrain?.points).length < 3 && !site?.planning?.flatTerrain) result.push('Рельеф неизвестен.');
  if (!facts.constraints && !constraintsMatch(site)) result.push('Введённые проектные отступы не подтверждены.');
  return [...new Set(result)].slice(0, 12);
}

function factCard(label, value, note, status = 'unknown') {
  return `<article class="project-route-fact" data-status="${status}" data-route-status="${status}"><span class="project-route-fact-mark" aria-hidden="true">${statusMark(status)}</span><div><h3>${escapeHtml(label)}</h3><strong>${escapeHtml(value)}</strong>${note ? `<p>${escapeHtml(note)}</p>` : ''}</div></article>`;
}

function renderPassport(passport) {
  const site = state.project?.site || {};
  const area = polygonAreaM2(site.boundary);
  const terrainPoints = asArray(site?.terrain?.points);
  const range = terrainRange(site);
  const location = site?.location || {};
  const buildableRawStatus = cleanKey(passport?.buildable?.status);
  const buildableStatus = normalizeStatus(passport?.buildable?.status);
  // Нулевую площадь показываем только как честный результат для валидной
  // границы. При unknown/error это отсутствие расчёта, а не участок 0 м².
  const workingArea = ['unknown', 'missing', 'error', 'invalid'].includes(buildableRawStatus)
    ? null : passportArea(passport);
  const unknown = passportUnknowns(passport, site);
  const coreFact = (id) => passport?.facts?.[id] || {};
  const factStatus = (id) => normalizeStatus(coreFact(id).status);
  const factReason = (id, fallback = '') => coreFact(id).reason || fallback;
  const accessStatus = aggregateStatus(['roads', 'entry'].map((id) => ({ status: factStatus(id) })));
  const accessReason = [coreFact('roads').reason, coreFact('entry').reason].filter(Boolean).join(' · ');
  const boundaryValue = factStatus('boundary') === 'done'
    ? `${Number(coreFact('boundary').areaM2 ?? area).toLocaleString('ru-RU', { maximumFractionDigits: 1 })} м²`
    : asArray(site.boundary).length ? 'Требует исправления' : 'Не задана';
  const facts = [
    factCard('Граница', boundaryValue, factReason('boundary', `${asArray(site.boundary).length} вершин`), factStatus('boundary')),
    factCard('Топосъёмка', site?.underlay ? 'Импортирована' : (site?.planning?.withoutUnderlay ? 'Работа без подложки' : 'Нет данных'), factReason('underlay', site?.underlay?.mmPerPx ? `Масштаб ${Number(site.underlay.mmPerPx).toLocaleString('ru-RU', { maximumFractionDigits: 2 })} мм/px` : ''), factStatus('underlay')),
    factCard('Север и координаты', site?.solarVerified ? `${Number(location.lat).toFixed(4)}, ${Number(location.lon).toFixed(4)}` : 'Не подтверждены', factReason('solar', `Север ${Math.round(Number(site?.north) || 0)}°`), factStatus('solar')),
    factCard('Доступ', `${asArray(site?.roads).length} дорог · ${site?.entry ? 'въезд задан' : 'нет въезда'}`, accessReason, accessStatus),
    factCard('Окружение', `${asArray(site?.neighbors).length} соседних зданий`, factReason('context'), factStatus('context')),
    factCard('Рельеф', terrainPoints.length >= 3 ? `${terrainPoints.length} отметок` : (site?.planning?.flatTerrain ? 'Принят плоским' : `${terrainPoints.length} отметок`), factReason('terrain', range == null ? '' : `Перепад ${range.toLocaleString('ru-RU', { maximumFractionDigits: 0 })} мм`), factStatus('terrain')),
    factCard('Проектные отступы', `${(Number(site?.setbackBoundary || 0) / 1000).toLocaleString('ru-RU')} м / ${(Number(site?.setbackNeighbor || 0) / 1000).toLocaleString('ru-RU')} м`, factReason('constraints', 'От границы / от соседнего здания.'), factStatus('constraints')),
    factCard('Рабочее пятно', workingArea == null ? 'Не рассчитано' : `${Number(workingArea).toLocaleString('ru-RU', { maximumFractionDigits: 1 })} м²`, `${factReason('zone')} По введённым ограничениям; не юридическая разрешённая зона.`.trim(), buildableStatus),
  ];
  return `<div class="project-route-passport-intro"><p>Фактическая сводка исходных данных. Она обновляется вместе с моделью и не дублирует значения проекта.</p></div>
    <div class="project-route-facts">${facts.join('')}</div>
    <section class="project-route-unknowns" aria-labelledby="projectRouteUnknownTitle">
      <h3 id="projectRouteUnknownTitle">Что неизвестно или требует исправления</h3>
      ${unknown.length ? `<ul>${unknown.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>` : '<p>Обязательные исходные данные для текущего маршрута собраны.</p>'}
    </section>
    <p class="project-route-disclaimer"><strong>Эскизная проверка, не нормативное заключение.</strong> Значения отступов и полноту исходных данных нужно проверить по документам участка и правилам вашего региона.</p>`;
}

function renderPanel(model) {
  const body = byId('projectRouteBody');
  const title = byId('projectRoutePanelTitle');
  const kicker = byId('projectRoutePanelKicker');
  if (!body || !title || !kicker) return;
  if (panelView === 'passport') {
    kicker.textContent = 'Факты без предположений';
    title.textContent = 'Паспорт участка';
    body.innerHTML = renderPassport(model.passport);
    return;
  }
  if (HOME_VIEWS.has(panelView)) {
    const preserved = captureHomePanelState(body, panelView);
    const current = HOME_VIEW_BY_ID.get(panelView) || HOME_VIEW_DEFS[0];
    kicker.textContent = current.kicker;
    title.textContent = current.title;
    body.innerHTML = state.project
      ? `${homeSystemNav(panelView)}<div class="home-system-panel" id="homeSystemPanel" role="tabpanel" aria-labelledby="homeViewTab-${current.id}">${current.html(state.project, state)}</div>`
      : '<p class="project-route-panel-empty">Откройте или создайте проект, чтобы продолжить проектирование дома.</p>';
    restoreHomePanelState(body, preserved);
    return;
  }
  const stage = model.stages.find((item) => item.id === activeStage) || model.stages[0];
  if (!stage) {
    kicker.textContent = 'Маршрут проекта';
    title.textContent = 'Нет открытого проекта';
    body.innerHTML = '<p class="project-route-panel-empty">Откройте или создайте проект, чтобы начать подготовку участка.</p>';
    return;
  }
  kicker.textContent = `Этап ${model.stages.indexOf(stage) + 1} из ${model.stages.length} · ${statusLabel(stage.status)}`;
  title.textContent = stage.title;
  body.innerHTML = renderStagePanel(stage);
}

function homeSystemNav(active) {
  return `<nav class="home-system-nav" role="tablist" aria-label="Этапы проектирования дома">${HOME_VIEW_DEFS.map((view) => `<button type="button" id="homeViewTab-${view.id}" role="tab" aria-controls="homeSystemPanel" aria-selected="${active === view.id}" tabindex="${active === view.id ? '0' : '-1'}" data-route-action="open-home-view" data-home-view="${view.id}"${active === view.id ? ' aria-current="page"' : ''}><span>${view.step}</span>${view.label}</button>`).join('')}</nav>`;
}

function syncOpenState() {
  const panel = byId('projectRoutePanel');
  const scrim = byId('projectRouteScrim');
  const toggle = byId('projectRouteToggle');
  const passport = byId('projectRoutePassport');
  const program = byId('projectHomeProgram');
  if (!panel || !scrim || !toggle || !passport || !program) return;
  panel.hidden = !panelOpen;
  scrim.hidden = !panelOpen;
  panel.setAttribute('aria-modal', String(panelOpen && isPhone()));
  toggle.setAttribute('aria-expanded', String(panelOpen && panelView === 'stage'));
  passport.setAttribute('aria-expanded', String(panelOpen && panelView === 'passport'));
  program.setAttribute('aria-expanded', String(panelOpen && HOME_VIEWS.has(panelView)));
  document.body.classList.toggle('project-route-open', panelOpen);
}

function announce(text) {
  const live = byId('projectRouteLive');
  if (live) live.textContent = text;
}

function openPanel(view, stageId, opener) {
  closeSheets();
  panelView = view;
  if (stageId) activeStage = stageId;
  panelOpen = true;
  lastOpener = opener || document.activeElement;
  lastOpenerStage = opener?.dataset?.routeStage || null;
  renderProjectRoute();
  syncOpenState();
  const close = byId('projectRouteClose');
  requestAnimationFrame(() => close?.focus({ preventScroll: true }));
  announce(view === 'passport' ? 'Открыт паспорт участка'
    : HOME_VIEW_BY_ID.get(view)?.announce || 'Открыт этап маршрута проекта');
}

function closePanel({ restoreFocus = true } = {}) {
  if (!panelOpen) return;
  panelOpen = false;
  syncOpenState();
  announce('Маршрут проекта закрыт');
  const opener = lastOpenerStage
    ? byId('projectRouteSteps')?.querySelector(`[data-route-stage="${lastOpenerStage}"]`)
    : lastOpener;
  if (restoreFocus && opener?.isConnected) opener.focus({ preventScroll: true });
}

function switchHomeView(view) {
  if (!HOME_VIEWS.has(view)) return;
  panelView = view;
  renderProjectRoute();
  requestAnimationFrame(() => {
    const tab = byId('projectRouteBody')?.querySelector(`[data-home-view="${view}"]`);
    const nav = tab?.closest('.home-system-nav');
    if (tab && nav && nav.scrollWidth > nav.clientWidth) {
      // На телефоне вкладки образуют собственную горизонтальную ленту.
      // scrollIntoView у некоторых Chromium прокручивает внешний экран,
      // поэтому центрируем кнопку именно внутри nav.
      nav.scrollTo({
        left: tab.offsetLeft - (nav.clientWidth - tab.offsetWidth) / 2,
        behavior: 'auto',
      });
    } else {
      tab?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    }
    tab?.focus({ preventScroll: true });
  });
  announce(HOME_VIEW_BY_ID.get(view)?.announce || 'Открыт этап проектирования дома');
}

function firstIncompleteStage(model) {
  return model?.stages?.find((stage) => stage.status !== 'done')?.id || model?.stages?.[0]?.id || STAGES[0].id;
}

function planningMutation(fn, focusSelector = '') {
  const changed = mutate(() => {
    const site = state.project?.site;
    if (!site) return;
    if (!site.planning || typeof site.planning !== 'object') site.planning = {};
    fn(site.planning, site);
  });
  if (!changed) renderProjectRoute();
  if (focusSelector && panelOpen) {
    requestAnimationFrame(() => {
      byId('projectRouteBody')?.querySelector(focusSelector)?.focus({ preventScroll: true });
    });
  }
}

function handleConfirmation(input) {
  const key = input.dataset.routeConfirm;
  const on = input.checked;
  planningMutation((planning, site) => {
    if (key === 'constraintsConfirmed') {
      planning.constraintsConfirmed = on ? {
        setbackBoundary: Math.max(0, Number(site.setbackBoundary) || 0),
        setbackNeighbor: Math.max(0, Number(site.setbackNeighbor) || 0),
      } : null;
    } else if (['withoutUnderlay', 'contextReviewed', 'flatTerrain'].includes(key)) {
      planning[key] = on;
    }
  }, `[data-route-confirm="${key}"]`);
}

function parseDecimal(value) {
  const number = Number(String(value ?? '').trim().replace(',', '.'));
  return Number.isFinite(number) ? number : NaN;
}

function saveFootprint() {
  const form = byId('projectRouteFootprintForm');
  if (!form) return false;
  const width = parseDecimal(form.elements.width?.value);
  const depth = parseDecimal(form.elements.depth?.value);
  const rotationRaw = parseDecimal(form.elements.rotation?.value || 0);
  if (width < 2 || width > 100 || depth < 2 || depth > 100 || !Number.isFinite(rotationRaw)) {
    toast('Введите ширину и глубину дома от 2 до 100 м', true);
    return false;
  }
  const rotation = ((rotationRaw % 360) + 360) % 360;
  footprintDraftDirty = false;
  planningMutation((planning) => {
    planning.referenceFootprint = { width: width * 1000, depth: depth * 1000, rotation };
  }, '[data-route-action="save-footprint"]');
  toast(`Проверочный габарит: ${width.toLocaleString('ru-RU')} × ${depth.toLocaleString('ru-RU')} м`);
  return true;
}

function showSiteTool(id) {
  if (!state.project?.site) return;
  closePanel({ restoreFocus: false });
  closeSheets();
  setEditorMode('site');
  if (id === 'underlay' && !state.project.site.underlay) {
    refs.underlayInput?.click();
    return;
  }
  activateSiteTool(id);
}

function showWorkingZone() {
  if (!asArray(state.siteBuildable?.geometry).length) {
    toast('Сначала начертите корректную границу участка и проверьте отступы', true);
    announce('Рабочее пятно не построено: недостаточно исходных данных');
    return;
  }
  if (!state.project?.site?.showBuildZone) {
    mutate(() => { if (state.project?.site) state.project.site.showBuildZone = true; });
  }
  closePanel({ restoreFocus: false });
  closeSheets();
  setEditorMode('site');
  requestDraw();
  toast('Показано рабочее пятно по введённым ограничениям', true);
}

function openConstraintSettings() {
  closePanel({ restoreFocus: false });
  closeSheets();
  cancelTool();
  state.selection = null;
  state.propsTab = 'props';
  setEditorMode('site');
  // setEditorMode ничего не делает при уже открытом «Участке», поэтому
  // общие свойства участка обновляем явно после снятия выбора.
  renderProps();
  requestAnimationFrame(() => {
    if (isPhone()) byId('mobileBar')?.querySelector('[data-sheet="props"]')?.click();
    else byId('setbackB')?.focus({ preventScroll: true });
  });
}

function openSolarSettings() {
  closePanel({ restoreFocus: false });
  closeSheets();
  cancelTool();
  state.selection = null;
  state.propsTab = 'props';
  setEditorMode('site');
  renderProps();
  requestAnimationFrame(() => {
    if (isPhone()) byId('mobileBar')?.querySelector('[data-sheet="props"]')?.click();
    else byId('lat')?.focus({ preventScroll: true });
  });
}

function hasOpportunityPositions(result) {
  if (!result) return false;
  const cells = asArray(result.cells).length ? result.cells : asArray(result.grid?.cells);
  return cells.some((cell) => !cell?.blocked) && asArray(result.candidates).length > 0;
}

function toggleOpportunity() {
  if (state.siteOpportunity?.on) {
    state.siteOpportunity = { on: false, result: null, signature: null };
    requestDraw();
    renderProjectRoute();
    requestAnimationFrame(() => {
      byId('projectRouteBody')?.querySelector('[data-route-action="toggle-opportunity"]')?.focus({ preventScroll: true });
    });
    announce('Карта возможностей скрыта');
    return;
  }
  if (!state.project?.site?.planning?.referenceFootprint) {
    toast('Сначала сохраните ширину и глубину проверочного габарита', true);
    return;
  }
  const footprint = state.project.site.planning.referenceFootprint;
  const signature = opportunityInputSignature(state.project, footprint);
  const result = safeCall(() => siteOpportunity(state.project, { footprint }), {
    status: 'error',
    warnings: ['Не удалось рассчитать карту возможностей для текущих исходных данных.'],
  });
  if (!hasOpportunityPositions(result)) {
    state.siteOpportunity = { on: false, result, signature };
    requestDraw();
    renderProjectRoute();
    const warning = asArray(result?.warnings).find((item) => typeof item === 'string');
    toast(warning || 'Сначала задайте корректную границу и ограничения участка', true);
    announce('Карта возможностей не построена: недостаточно исходных данных');
    return;
  }
  if (state.solarAnalysis?.on) setSolarAnalysis(false);
  state.siteOpportunity = { on: true, result, signature };
  closePanel({ restoreFocus: false });
  closeSheets();
  setEditorMode('site');
  requestDraw();
  renderProjectRoute();
  toast('Показана карта возможностей участка');
  announce('Карта возможностей показана');
}

function disableCirculationForAnotherOverlay(otherOverlayOn) {
  if (!otherOverlayOn || !state.homeCirculationOverlay?.on) return;
  state.homeCirculationOverlay = {
    ...state.homeCirculationOverlay, on: false, result: null, signature: null,
  };
  state._homeCirculationUI = null;
  requestDraw();
  renderProjectRoute();
}

function disableSolarForAnotherOverlay(otherOverlayOn) {
  if (!otherOverlayOn || !state.solarAnalysis?.on) return;
  setSolarAnalysis(false);
  requestDraw();
}

function handleBodyClick(event) {
  if (handleHomeDeliverablesClick(event, {
    openView: (viewId) => {
      closePanel({ restoreFocus: false });
      openView(viewId);
    },
    openSheets: () => {
      closePanel({ restoreFocus: false });
      if (isPhone()) toggleSheet('sheets');
      else {
        state.propsTab = 'sheets';
        renderProps();
      }
    },
    handleExport: (kind) => {
      closePanel({ restoreFocus: false });
      handleExport(kind);
    },
    announce,
  })) return;
  if (handleHomeEnvelopeClick(event, {
    open3d: () => openView('3d'),
    openRoofPlan: () => openView('roofplan'),
    openView,
    startSection: () => {
      openView(`plan:${state.project.activeLevel}`);
      startPlanSectionTool();
    },
    closePanel,
    announce,
  })) return;
  if (handleHomeReviewClick(event, {
    project: state.project,
    state,
    openHomeView: switchHomeView,
    openSiteStage: () => openPanel('stage', firstIncompleteStage(latestModel), null),
    goToIssue: (entry) => {
      closePanel({ restoreFocus: false });
      goToIssue(entry);
    },
    closePanel,
    announce,
  })) return;
  if (handleHomeClimateClick(event, {
    project: state.project,
    state,
    closePanel,
    announce,
    rerender: renderProjectRoute,
    requestDraw,
    toast,
    setEditorMode,
    switchLevel,
  })) return;
  if (handleHomeCirculationClick(event, {
    project: state.project,
    state,
    mutate,
    closePanel,
    announce,
    rerender: renderProjectRoute,
    requestDraw,
    toast,
    setEditorMode,
  })) {
    disableSolarForAnotherOverlay(state.homeCirculationOverlay?.on === true);
    return;
  }
  const handledFlows = handleHomeFlowsClick(event, {
    project: state.project,
    state,
    mutate,
    closePanel,
    announce,
    rerender: renderProjectRoute,
    requestDraw,
    toast,
    setEditorMode,
  });
  if (handledFlows) {
    disableCirculationForAnotherOverlay(state.homeProgramOverlay?.on === true);
    disableSolarForAnotherOverlay(state.homeProgramOverlay?.on === true);
    return;
  }
  const handledEngineering = handleHomeEngineeringClick(event, {
    project: state.project,
    state,
    mutate,
    closePanel,
    announce,
    rerender: renderProjectRoute,
    requestDraw,
    toast,
    setEditorMode,
  });
  if (handledEngineering) {
    disableCirculationForAnotherOverlay(state.homeEngineeringOverlay?.on === true);
    disableSolarForAnotherOverlay(state.homeEngineeringOverlay?.on === true);
    return;
  }
  const handledProgram = handleHomeProgramClick(event, {
    closePanel,
    announce,
    rerender: renderProjectRoute,
  });
  if (handledProgram) {
    disableCirculationForAnotherOverlay(state.homeProgramOverlay?.on === true);
    disableSolarForAnotherOverlay(state.homeProgramOverlay?.on === true);
    return;
  }
  const toolButton = event.target.closest('[data-route-tool]');
  if (toolButton) {
    showSiteTool(toolButton.dataset.routeTool);
    return;
  }
  const actionButton = event.target.closest('[data-route-action]');
  if (!actionButton) return;
  const action = actionButton.dataset.routeAction;
  if (action === 'open-home-view') switchHomeView(actionButton.dataset.homeView || 'program');
  else if (action === 'show-zone') showWorkingZone();
  else if (action === 'open-constraints') openConstraintSettings();
  else if (action === 'open-solar-settings') openSolarSettings();
  else if (action === 'save-footprint') saveFootprint();
  else if (action === 'toggle-opportunity') toggleOpportunity();
}

function handleFootprintInput(event) {
  const input = event.target.closest('[data-route-footprint]');
  if (!input) return;
  const draft = seedFootprintDraft();
  draft[input.dataset.routeFootprint] = input.value;
  footprintDraft = draft;
  footprintDraftDirty = true;
}

function focusableInPanel() {
  const panel = byId('projectRoutePanel');
  if (!panel) return [];
  return [...panel.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])')]
    .filter((element) => !element.hidden && element.getClientRects().length);
}

function handleDocumentKeydown(event) {
  if (!panelOpen) return;
  if (event.key === 'Escape') {
    event.preventDefault();
    event.stopImmediatePropagation();
    closePanel();
    return;
  }
  const homeTab = event.target?.closest?.('.home-system-nav [data-home-view]');
  const homeNavKeys = ['ArrowLeft', 'ArrowRight', 'Home', 'End'];
  if (!isPhone()) homeNavKeys.push('ArrowUp', 'ArrowDown');
  if (homeTab && homeNavKeys.includes(event.key)) {
    const tabs = HOME_VIEW_DEFS.map((view) => view.id);
    const current = Math.max(0, tabs.indexOf(homeTab.dataset.homeView));
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1
      : (current + (event.key === 'ArrowRight' ? 1
        : event.key === 'ArrowLeft' ? -1
          : event.key === 'ArrowDown' ? 4 : -4) + tabs.length) % tabs.length;
    event.preventDefault();
    switchHomeView(tabs[next]);
    return;
  }
  if (event.key !== 'Tab' || !isPhone()) return;
  const focusable = focusableInPanel();
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

// Пересчитывает только эфемерный слой: проект не мутирует и история не меняется.
export function refreshSiteOpportunity() {
  if (!state.siteOpportunity?.on || !state.project) {
    state.siteOpportunity = { on: false, result: null, signature: null };
    requestDraw();
    if (bound) renderProjectRoute();
    return null;
  }
  const footprint = state.project.site?.planning?.referenceFootprint || null;
  if (!footprint) {
    state.siteOpportunity = { on: false, result: null, signature: null };
    requestDraw();
    if (bound) renderProjectRoute();
    return null;
  }
  const signature = opportunityInputSignature(state.project, footprint);
  if (state.siteOpportunity.signature === signature && state.siteOpportunity.result) {
    requestDraw();
    if (bound) renderProjectRoute();
    return state.siteOpportunity.result;
  }
  const result = safeCall(() => siteOpportunity(state.project, { footprint }), {
    status: 'error',
    warnings: ['Не удалось рассчитать карту возможностей для текущих исходных данных.'],
  });
  const available = hasOpportunityPositions(result);
  state.siteOpportunity = { on: available, result, signature };
  requestDraw();
  if (bound) renderProjectRoute();
  if (!available) {
    const warning = asArray(result?.warnings).find((item) => typeof item === 'string');
    toast(warning || 'Карта скрыта: после изменений подходящих положений не осталось', true);
    announce('Карта возможностей скрыта после изменения исходных данных');
  }
  return result;
}

export function renderProjectRoute() {
  const root = byId('projectRoute');
  if (!root) return;
  latestModel = routeModel();
  state.siteBuildable = latestModel.passport?.buildable || null;
  const canvasLegend = byId('siteOpportunityLegend');
  if (canvasLegend) canvasLegend.hidden = !state.siteOpportunity?.on;
  // restore/undo сбрасывают экранное состояние без обращения к DOM. Здесь
  // синхронизируем общую кнопку и легенду, чтобы старая карта не оставалась
  // визуально включённой после открытия другой версии проекта.
  const solarOn = state.solarAnalysis?.on === true;
  const solarLegend = byId('solarLegend');
  if (solarLegend && !solarOn) solarLegend.hidden = true;
  const solarButton = byId('sunAnalysisBtn');
  if (solarButton) {
    solarButton.classList.toggle('active', solarOn);
    solarButton.setAttribute('aria-pressed', String(solarOn));
    solarButton.setAttribute('aria-label', state.solarAnalysis?.mode === 'daylight'
      ? 'Карта освещённости' : 'Карта прямого солнца');
  }
  const homeProgramLegend = byId('homeProgramLegend');
  if (homeProgramLegend) {
    const flowsMode = state.homeProgramOverlay?.mode === 'flows';
    homeProgramLegend.hidden = !state.homeProgramOverlay?.on;
    const heading = homeProgramLegend.querySelector('strong');
    if (heading) heading.textContent = flowsMode ? 'Зоны и схема связей' : 'Связи дома';
    for (const item of homeProgramLegend.querySelectorAll('[data-layer="zone"]')) {
      item.hidden = !flowsMode || state.homeProgramOverlay?.zones === false;
    }
    const routeItem = homeProgramLegend.querySelector('[data-layer="route"]');
    if (routeItem) routeItem.hidden = state.homeProgramOverlay?.routes === false;
  }
  const homeEngineeringLegend = byId('homeEngineeringLegend');
  if (homeEngineeringLegend) homeEngineeringLegend.hidden = !state.homeEngineeringOverlay?.on;
  const homeCirculationLegend = byId('homeCirculationLegend');
  if (homeCirculationLegend) {
    const view = state.homeCirculationOverlay || {};
    homeCirculationLegend.hidden = !view.on;
    const routeItem = homeCirculationLegend.querySelector('[data-layer="route"]');
    const heatItem = homeCirculationLegend.querySelector('[data-layer="heat"]');
    const bottleneckItem = homeCirculationLegend.querySelector('[data-layer="bottleneck"]');
    if (routeItem) routeItem.hidden = view.routes === false;
    if (heatItem) heatItem.hidden = view.heatmap === false;
    if (bottleneckItem) bottleneckItem.hidden = view.bottlenecks === false;
    const metric = homeCirculationLegend.querySelector('[data-circulation-legend-metric]');
    if (metric) metric.textContent = view.metric === 'frequency'
      ? CIRCULATION_PERIOD_LABEL[view.period] || 'частота выбранного периода'
      : 'число рассчитанных маршрутов';
  }
  renderStageBar(latestModel);
  root.classList.toggle('has-project', Boolean(state.project));
  if (panelOpen) renderPanel(latestModel);
  syncOpenState();
}

export function bindProjectRoute() {
  if (bound) {
    renderProjectRoute();
    return;
  }
  const root = byId('projectRoute');
  const steps = byId('projectRouteSteps');
  const toggle = byId('projectRouteToggle');
  const passport = byId('projectRoutePassport');
  const program = byId('projectHomeProgram');
  const body = byId('projectRouteBody');
  if (!root || !steps || !toggle || !passport || !program || !body) return;
  bound = true;

  toggle.addEventListener('click', () => {
    if (panelOpen && panelView === 'stage') closePanel();
    else openPanel('stage', firstIncompleteStage(latestModel), toggle);
  });
  passport.addEventListener('click', () => {
    if (panelOpen && panelView === 'passport') closePanel();
    else openPanel('passport', null, passport);
  });
  program.addEventListener('click', () => {
    if (panelOpen && HOME_VIEWS.has(panelView)) closePanel();
    else openPanel('program', null, program);
  });
  steps.addEventListener('click', (event) => {
    const button = event.target.closest('[data-route-stage]');
    if (button) openPanel('stage', button.dataset.routeStage, button);
  });
  steps.addEventListener('keydown', (event) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const buttons = [...steps.querySelectorAll('[data-route-stage]')];
    if (!buttons.length) return;
    const current = Math.max(0, buttons.indexOf(document.activeElement));
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
      : (current + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length;
    event.preventDefault();
    buttons[next].focus();
  });
  byId('projectRouteClose')?.addEventListener('click', () => closePanel());
  byId('projectRouteScrim')?.addEventListener('click', () => closePanel());
  body.addEventListener('click', handleBodyClick);
  body.addEventListener('input', (event) => {
    handleFootprintInput(event);
    handleHomeProgramInput(event);
    handleHomeCirculationInput(event, {
      project: state.project, state, mutate,
      rerender: renderProjectRoute, requestDraw, toast,
    });
    handleHomeClimateInput(event, {
      project: state.project, state,
      rerender: renderProjectRoute, requestDraw, toast,
    });
  });
  body.addEventListener('change', (event) => {
    handleHomeProgramInput(event);
    handleHomeFlowsInput(event, {
      project: state.project, state, mutate,
      rerender: renderProjectRoute, requestDraw, toast,
    });
    handleHomeEngineeringInput(event, {
      project: state.project, state, mutate,
      rerender: renderProjectRoute, requestDraw, toast,
    });
    handleHomeCirculationInput(event, {
      project: state.project, state, mutate,
      rerender: renderProjectRoute, requestDraw, toast,
    });
    handleHomeClimateInput(event, {
      project: state.project, state,
      rerender: renderProjectRoute, requestDraw, toast,
    });
    const input = event.target.closest('[data-route-confirm]');
    if (input) handleConfirmation(input);
  });
  document.addEventListener('pointerdown', (event) => {
    if (panelOpen && !root.contains(event.target)) closePanel({ restoreFocus: false });
  });
  document.addEventListener('keydown', handleDocumentKeydown, true);
  document.addEventListener(PROJECT_CHANGE_EVENT, () => {
    if (state.homeProgramOverlay?.on && state.homeProgramOverlay.mode === 'flows') {
      refreshHomeFlowsOverlay(state.project, state, requestDraw);
    } else if (state.homeProgramOverlay?.on) refreshHomeProgramOverlay();
    if (state.homeEngineeringOverlay?.on) {
      refreshHomeEngineeringOverlay(state.project, state, requestDraw);
    }
    if (state.homeCirculationOverlay?.on) {
      refreshHomeCirculationOverlay(state.project, state, requestDraw);
    }
    if (state.solarAnalysis?.on) requestDraw();
    if (state.siteOpportunity?.on) refreshSiteOpportunity();
    else {
      // Ошибка предварительного запуска относится к прежнему набору
      // исходных данных; после правки пользователь запускает карту заново.
      if (state.siteOpportunity?.result) {
        state.siteOpportunity = { on: false, result: null, signature: null };
      }
      renderProjectRoute();
    }
  });
  globalThis.addEventListener?.('resize', () => {
    if (panelOpen) syncOpenState();
  });
  renderProjectRoute();
}
