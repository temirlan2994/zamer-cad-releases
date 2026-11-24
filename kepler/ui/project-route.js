// «Маршрут проекта»: проверяемая последовательность подготовки участка.
// Статусы всегда заново выводятся из project.site (core/site-planning.js),
// а в проект записываются только явные решения пользователя.

import { contextNeighborSignature } from '../core/site.js';
import { siteOpportunity, sitePassport, sitePlanningRoute } from '../core/site-planning.js';
import { panForMovedBuilding } from '../core/site-check.js';
import { floorAnalyticalViewById, floorAnalyticalViewId } from '../core/analytical-views.js';
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
import {
  handleHomeReviewClick, homeReviewHtml, homeReviewReport,
} from './home-review.js';
import { handleHomeEnvelopeClick, homeEnvelopeHtml } from './home-envelope.js';
import { handleHomeDeliverablesClick, homeDeliverablesHtml } from './home-deliverables.js';
import { handleExport, PROJECT_REPLACED_EVENT } from './files.js';
import { goToIssue, setIssuesOpen } from './issues.js';
import { bindErgoViewBlock, ergoViewBlock } from './ergonomics.js';
import { setErgoPref } from './render-ergonomics.js';
import { restorePlanCamera, savePlanCamera, switchLevel } from './levels.js';
import { closeSheets, isPhone, toggleSheet } from './mobile.js';
import { applyModeRotation } from './modes.js';
import { startPlanSectionTool } from './plan-section.js';
import { renderProps } from './props.js';
import { activeViewId, openView } from './props-views.js';
import {
  focusSolarRoom, refreshSolarLevelAnalysis, setSolarAnalysis, setSolarLevelAnalysis,
} from './solar-analysis.js';
import { state } from './state.js';
import { getScopedItem, setScopedItem } from './storage-scope.js';
import {
  ANALYTICS_READY_EVENT, flushAnalytics, mutate, PROJECT_CHANGE_EVENT,
} from './store.js';
import { activateSiteTool } from './toolstrip.js';
import { cancelTool } from './tools.js';
import { requestDraw, scaleLabel } from './view.js';
import { analyzeWorkflowStatus, workflowStageStatus } from '../core/workflow-status.js';

const STAGES = Object.freeze([
  Object.freeze({
    id: 'foundation',
    title: 'Съёмка и границы',
    short: 'Границы',
    aliases: ['foundation', 'basis', 'base', 'source', 'source-data', 'основа'],
    tasks: ['underlay', 'boundary'],
  }),
  Object.freeze({
    id: 'access',
    title: 'Доступ и окружение',
    short: 'Подъезд',
    aliases: ['access', 'access-context', 'доступ'],
    tasks: ['road', 'entry', 'neighbor'],
  }),
  Object.freeze({
    id: 'conditions',
    title: 'Солнце и рельеф',
    short: 'Солнце и рельеф',
    aliases: ['conditions', 'environment', 'sun-terrain', 'solar-terrain', 'terrain-solar', 'условия'],
    tasks: ['north', 'terrain'],
  }),
  Object.freeze({
    id: 'constraints',
    title: 'Ограничения',
    short: 'Застройка',
    aliases: ['constraints', 'envelope', 'placement', 'build-zone', 'ограничения', 'пятно'],
    tasks: ['constraints', 'zone'],
  }),
]);

const TASKS = Object.freeze({
  underlay: Object.freeze({
    title: 'Топосъёмка или подложка',
    tool: 'underlay',
    aliases: ['underlay', 'survey', 'topography', 'base-map', 'подложка', 'топосъёмка'],
  }),
  boundary: Object.freeze({
    title: 'Граница участка',
    tool: 'boundary',
    aliases: ['boundary', 'site-boundary', 'parcel', 'граница'],
  }),
  road: Object.freeze({
    title: 'Дорога',
    tool: 'road',
    aliases: ['road', 'roads', 'street', 'дорога'],
  }),
  entry: Object.freeze({
    title: 'Въезд на участок',
    tool: 'entry',
    aliases: ['entry', 'entrance', 'gate', 'driveway', 'въезд'],
  }),
  neighbor: Object.freeze({
    title: 'Соседние здания',
    tool: 'neighbor',
    aliases: ['neighbor', 'neighbors', 'context', 'surroundings', 'соседи'],
  }),
  north: Object.freeze({
    title: 'Север и координаты',
    tool: 'north',
    aliases: ['north', 'solar', 'location', 'orientation', 'север', 'солнце'],
  }),
  terrain: Object.freeze({
    title: 'Рельеф',
    tool: 'terrain',
    aliases: ['terrain', 'relief', 'elevation', 'рельеф', 'высоты'],
  }),
  constraints: Object.freeze({
    title: 'Проектные отступы',
    aliases: ['constraints', 'setbacks', 'constraint-confirmation', 'отступы'],
  }),
  zone: Object.freeze({
    title: 'Рабочее пятно',
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

const CIRCULATION_PERIOD_LABEL = Object.freeze({
  day: 'проходов в день',
  week: 'проходов в неделю',
  month: 'проходов в месяц',
  year: 'проходов в год',
  event: 'проходов за событие',
});
const HOME_WORKFLOW_STORAGE_KEY = 'kepler-home-workflow-position/v1';
const HOME_REVIEW_STATUS_LABEL = Object.freeze({
  checked: 'Проверено',
  attention: 'Требует внимания',
  blocked: 'Есть препятствие',
  unknown: 'Недостаточно данных',
  pending: 'Ещё не проверено',
});
const HOME_REVIEW_STATUS_MARK = Object.freeze({
  checked: '✓', attention: '!', blocked: '×', unknown: '?', pending: '…',
});
const MISSION_ROUTE_STATUS = Object.freeze({ '✓': 'checked', '!': 'attention', '×': 'blocked', '?': 'unknown' });
const missionStatusesByView = new Map();

let bound = false;
let panelOpen = false;
let panelView = 'stage';
let activeStage = STAGES[0].id;
let activeTask = STAGES[0].tasks[0];
let lastOpener = null;
let lastOpenerView = null;
let latestModel = null;
let footprintDraft = null;
let footprintDraftProject = null;
let footprintDraftDirty = false;
let workflowIdentity = null;
let workflowProjectRef = null;
let workflowPid = null;
let lastWorkflowView = 'site';
let workflowReviewCache = null;
let workflowReviewProject = null;
let workflowReviewDirty = false;
let workflowBadges = null;
let workflowBadgeTimer = null;
let workflowBadgeWorker = null;
let workflowBadgeBusy = false;
let workflowBadgeRequest = 0;
let routeHoverTimer = null;
let routeMenuPinnedView = null;
let routeMenuOpener = null;
let routeFocusPreviewSuppressed = false;
let panelDrag = null;
let routeRenderQueued = false;

function queueProjectRouteRender() {
  if (routeRenderQueued) return;
  routeRenderQueued = true;
  queueMicrotask(() => {
    routeRenderQueued = false;
    if (bound) renderProjectRoute();
  });
}

const HOME_VIEW_ITEMS = Object.freeze({
  program: [
    ['Жильцы', 'residents'], ['Комнаты', 'rooms'], ['Опции', 'extras'],
    ['На плане', 'plan'], ['Итог', 'result'],
  ],
  flows: [['Зоны', 'zones'], ['Сценарии', 'scenarios'], ['Маршруты', 'routes']],
  engineering: [
    ['Точки', 'engineering-connections'], ['Вода', 'engineering-wet'],
    ['Этажи', 'engineering-vertical'], ['Вентиляция', 'engineering-ventilation'],
    ['Исходные', 'engineering-points'], ['Уточнить', 'engineering-warnings'],
  ],
  circulation: [
    ['Проход', 'circulation-check'], ['Маршруты', 'circulation-routes'],
    ['Точки', 'circulation-anchors'], ['Карта', 'circulation-map'],
  ],
  climate: [['Комната', 'climate-room'], ['Солнце', 'location'], ['Данные', 'sources']],
  review: [
    ['Исправить', 'problems'], ['Уточнить', 'unknowns'],
    ['Готово', 'checked'], ['Итоги', 'stages'],
  ],
  envelope: [
    ['Этажи', 'envelope-levels'], ['Крыша', 'envelope-roofs'],
    ['Проёмы', 'envelope-vertical'], ['Чертежи', 'envelope-views'],
    ['Проверка', 'envelope-warnings'],
  ],
  deliverables: [
    ['Комплект', 'deliverables-checks'], ['Листы', 'deliverables-sheets'],
    ['Экспорт', 'deliverables-export'],
  ],
});

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
    html: (project, currentState) => `${ergoViewBlock()}${homeCirculationHtml(project, currentState)}`,
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
    html: (project, currentState, review) => homeReviewHtml(project, currentState, { review }),
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
const HOME_NAV_DEFS = Object.freeze([
  Object.freeze({
    id: 'site', step: 1, label: 'Участок',
    announce: 'Открыт этап участка и исходных данных',
  }),
  ...HOME_VIEW_DEFS,
]);
const HOME_VIEW_BY_ID = new Map(HOME_VIEW_DEFS.map((view) => [view.id, view]));
const HOME_VIEWS = new Set(HOME_VIEW_DEFS.map((view) => view.id));
const HOME_NAV_VIEWS = new Set(HOME_NAV_DEFS.map((view) => view.id));

// Соответствие внутренних панелей нижней аналитической палитры. Полноценные
// поэтажные виды строятся отдельно в core/analytical-views.js; эти записи
// нужны только для заголовка/типа компактного инспектора.
const ANALYTICAL_PANEL_VIEWS = Object.freeze([
  Object.freeze({ id: 'analysis:summary', title: 'Сводка', kind: 'analysis', panel: 'review' }),
  Object.freeze({ id: 'analysis:ergonomics', title: 'Эргономика', kind: 'ergonomics', panel: 'circulation' }),
  Object.freeze({ id: 'analysis:light', title: 'Свет и солнце', kind: 'light', panel: 'climate' }),
  Object.freeze({ id: 'analysis:engineering', title: 'Инженерия', kind: 'engineering', panel: 'engineering' }),
  Object.freeze({ id: 'analysis:site', title: 'Участок и ограничения', kind: 'site', panel: 'stage' }),
  Object.freeze({ id: 'analysis:volume', title: 'Объём здания', kind: 'volume', panel: 'envelope' }),
]);
const ANALYTICAL_VIEW_BY_PANEL = new Map(ANALYTICAL_PANEL_VIEWS.map((view) => [view.panel, view]));
const HOME_FOCUS_ATTRIBUTES = Object.freeze([
  'data-home-view', 'data-route-action', 'data-route-stage', 'data-climate-setting',
  'data-route-confirm', 'data-route-footprint', 'data-route-tool',
  'data-home-program-field', 'data-home-program-option', 'data-home-program-action',
  'data-home-program-bedroom', 'data-bedroom-field', 'data-home-program-step',
  'data-home-program-preset', 'data-delta',
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

function workflowProjectIdentity() {
  if (!state.project) return null;
  return state.pid ? `pid:${state.pid}` : state.project;
}

function workflowStorageKey(pid = state.pid) {
  return `${HOME_WORKFLOW_STORAGE_KEY}:${encodeURIComponent(pid ? String(pid) : 'draft')}`;
}

function saveWorkflowPosition() {
  if (!state.project) return;
  const view = panelView === 'stage' ? 'site'
    : HOME_VIEWS.has(panelView) ? panelView : lastWorkflowView;
  if (HOME_NAV_VIEWS.has(view)) lastWorkflowView = view;
  const key = workflowStorageKey();
  if (!key) return;
  try {
    setScopedItem(key, JSON.stringify({
      view: lastWorkflowView,
      siteStage: STAGES.some((stage) => stage.id === activeStage) ? activeStage : STAGES[0].id,
    }));
  } catch { /* localStorage может быть отключён; маршрут остаётся рабочим в памяти */ }
}

function restoreWorkflowPosition() {
  const identity = workflowProjectIdentity();
  if (identity === workflowIdentity) return;
  // Новый локальный проект получает pid при первом облачном/локальном
  // сохранении. Это тот же открытый проект: переносим текущую позицию в его
  // собственный scoped-ключ, а не сбрасываем открытый этап.
  if (state.project && state.project === workflowProjectRef && !workflowPid && state.pid) {
    workflowIdentity = identity;
    workflowPid = state.pid;
    saveWorkflowPosition();
    return;
  }
  workflowIdentity = identity;
  workflowProjectRef = state.project;
  workflowPid = state.pid || null;
  invalidateWorkflowReview({ clear: true });
  lastWorkflowView = 'site';
  activeStage = STAGES[0].id;
  activeTask = STAGES[0].tasks[0];
  if (!state.project) return;
  const key = workflowStorageKey();
  if (key) {
    try {
      const saved = JSON.parse(getScopedItem(key) || 'null');
      if (HOME_NAV_VIEWS.has(saved?.view)) lastWorkflowView = saved.view;
      if (STAGES.some((stage) => stage.id === saved?.siteStage)) activeStage = saved.siteStage;
    } catch { /* повреждённая локальная настройка не влияет на проект */ }
  }
  if (!panelOpen || panelView === 'stage' || HOME_VIEWS.has(panelView)) {
    panelView = lastWorkflowView === 'site' ? 'stage' : lastWorkflowView;
  }
}

function scheduleWorkflowBadges() {
  clearTimeout(workflowBadgeTimer);
  if (workflowBadgeBusy) {
    workflowBadgeWorker?.terminate();
    workflowBadgeWorker = null;
    workflowBadgeBusy = false;
  }
  workflowBadges = null;
  const request = ++workflowBadgeRequest;
  const source = state.project;
  if (!source) return;
  const current = () => request === workflowBadgeRequest && source === state.project;
  const apply = (result) => {
    if (!current()) return;
    workflowBadges = result;
    renderStageBar();
    syncRouteMenuStatuses();
  };
  workflowBadgeTimer = setTimeout(() => {
    const options = {
      profileWidthMm: state.homeCirculationOverlay?.profileWidthMm,
      heatmap: state.homeCirculationOverlay?.heatmap === true,
      roomKey: state._homeClimateUI?.roomKey
        || (state.selection?.type === 'room' ? `${source.activeLevel}:${state.selection.id}` : null),
    };
    // Отчёту нужен факт наличия подложки, её изображение в Worker не копируем.
    const project = { ...source, variants: [], site: { ...source.site, underlay: source.site?.underlay ? {} : null } };
    const fallback = () => {
      try {
        if (current()) apply(analyzeWorkflowStatus(source, options));
      } catch (error) {
        if (current()) console.error('Статусы этапов не рассчитались:', error);
      }
    };
    const runFallback = () => {
      if (!current()) return;
      if (typeof globalThis.requestIdleCallback === 'function') globalThis.requestIdleCallback(fallback, { timeout: 800 });
      else setTimeout(fallback, 0);
    };
    try {
      const worker = workflowBadgeWorker ??= new Worker(
        new URL('../workers/workflow-status-worker.js', import.meta.url), { type: 'module' },
      );
      workflowBadgeBusy = true;
      worker.onmessage = ({ data }) => {
        if (workflowBadgeWorker === worker) workflowBadgeBusy = false;
        apply(data);
      };
      worker.onerror = (event) => {
        event.preventDefault();
        worker.terminate();
        if (workflowBadgeWorker === worker) {
          workflowBadgeWorker = null;
          workflowBadgeBusy = false;
        }
        runFallback();
      };
      worker.postMessage({ project, options });
    } catch {
      workflowBadgeWorker?.terminate();
      workflowBadgeWorker = null;
      workflowBadgeBusy = false;
      runFallback();
    }
  }, 160);
}

function cachedWorkflowReview() {
  if (!state.project) return null;
  if (workflowReviewProject !== state.project || !workflowReviewCache || workflowReviewDirty) {
    workflowReviewCache = homeReviewReport(state.project, state);
    workflowReviewProject = state.project;
    workflowReviewDirty = false;
  }
  return workflowReviewCache;
}

function invalidateWorkflowReview({ clear = false } = {}) {
  workflowReviewDirty = true;
  if (!clear) return;
  missionStatusesByView.clear();
  workflowReviewCache = null;
  workflowReviewProject = null;
  scheduleWorkflowBadges();
}

function resetWorkflowForReplacement() {
  closeRouteMenu();
  // Самостоятельный аналитический вид относится к прежней модели. Новый
  // проект открывается с обычного плана, а не молча меняет «Свет» на «Участок».
  panelOpen = false;
  state.analyticalView = null;
  disableWorkspaceAnalyticalLayers();
  // Ключи этажей могут совпасть у двух разных файлов. Камера старого дома
  // не должна внезапно применяться к новому проекту с тем же `level-1`.
  for (const key of Object.keys(state.views || {})) {
    if (key.startsWith('plan:') || key.startsWith('analysis:')) delete state.views[key];
  }
  lastOpener = null;
  lastOpenerView = null;
  byId('projectRouteSteps')?.replaceChildren();
  workflowIdentity = null;
  workflowProjectRef = null;
  workflowPid = null;
  invalidateWorkflowReview({ clear: true });
  lastWorkflowView = 'site';
  activeStage = STAGES[0].id;
  activeTask = STAGES[0].tasks[0];
  if (panelView === 'stage' || HOME_VIEWS.has(panelView)) panelView = 'stage';
  // Событие означает явное «Новый/Пример/Открыть». Для нового локального
  // черновика старую позицию draft не наследуем; сохранённый pid, напротив,
  // будет лениво восстановлен своим ключом при следующем render.
  if (state.project && !state.pid) saveWorkflowPosition();
  renderProjectRoute();
}

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
  const foldId = element.closest?.('[data-analysis-fold]')?.dataset.analysisFold || null;
  if (!attributes.length && !pointId && !scenarioId && !(foldId && element.tagName === 'SUMMARY')) return null;
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
    foldId,
    selectionStart,
    selectionEnd,
  };
}

function captureHomePanelState(body, view) {
  const rendered = renderedHomeView(body);
  const renderedSite = view === 'site'
    && body.querySelector('.home-system-nav [data-home-view="site"][aria-current="page"]');
  if (rendered !== view && !renderedSite) return null;
  const panel = body.closest('.project-route-panel');
  return {
    scrollTop: panel?.scrollTop || 0,
    navScrollLeft: body.querySelector('.home-system-nav')?.scrollLeft || 0,
    focus: focusedHomeControl(body),
    folds: [...body.querySelectorAll('details[data-analysis-fold]')].map((node) => [node.dataset.analysisFold, node.open]),
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
  const foldId = element.closest?.('[data-analysis-fold]')?.dataset.analysisFold || null;
  return pointId === identity.pointId && scenarioId === identity.scenarioId && foldId === identity.foldId;
}

function restoreHomePanelState(body, snapshot) {
  if (!snapshot) return;
  const folds = new Map(snapshot.folds);
  for (const node of body.querySelectorAll('details[data-analysis-fold]')) {
    if (folds.has(node.dataset.analysisFold)) node.open = folds.get(node.dataset.analysisFold);
  }
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

function primaryMissionSections(body) {
  const root = body.querySelector('[data-home-program], [data-home-flows], [data-home-engineering], [data-home-circulation], [data-home-climate], [data-home-review], [data-home-envelope], [data-home-deliverables]');
  if (!root) return { root: null, sections: [] };
  const sections = [...root.querySelectorAll('details.home-mission-section')].filter((section) => {
    if (section.classList.contains('home-mission-secondary')) return false;
    if (section.closest('.home-mission-hero')) return false;
    if (section.closest('[data-home-deliverables-check]')) return false;
    return !section.parentElement?.closest('details.home-mission-section');
  });
  return { root, sections };
}

function missionStatus(section) {
  return section.dataset.status
    || section.querySelector(':scope > summary .home-mission-state')?.dataset.status
    || 'unknown';
}

function missionStatusMark(status) {
  if (['done', 'ready', 'checked', 'observed', 'complete', 'proven', 'fact'].includes(status)) return '✓';
  if (['error', 'blocked', 'missing', 'conflict'].includes(status)) return '×';
  if (['attention', 'warning', 'partial', 'candidate'].includes(status)) return '!';
  return '?';
}

function missionStatusLabel(status) {
  if (['done', 'ready', 'checked', 'observed', 'complete', 'proven', 'fact'].includes(status)) return 'готово';
  if (['error', 'blocked', 'missing', 'conflict'].includes(status)) return 'есть проблема';
  if (['attention', 'warning', 'partial', 'candidate'].includes(status)) return 'нужно проверить';
  return 'нет данных';
}

const MISSION_SHORT_LABELS = Object.freeze({
  'Точки подключения': 'Точки',
  'Мокрые зоны': 'Вода',
  'Вертикальное совмещение': 'Этажи',
  'Исходные точки': 'Исходные',
  'Что уточнить': 'Уточнить',
  'Проверка прохода': 'Проход',
  'Точки маршрута': 'Точки',
  'Карта нагрузки': 'Карта',
  'Свет в помещении': 'Комната',
  'Координаты и солнце': 'Солнце',
  'Исходные данные': 'Данные',
  'Что исправить': 'Исправить',
  'Проверенные факты': 'Готово',
  'Итоги по разделам': 'Итоги',
  'Этажи и отметки': 'Этажи',
  'Лестницы и проёмы': 'Проёмы',
  'Открыть чертёж': 'Чертежи',
  'Состав комплекта': 'Комплект',
  'Состав листов': 'Листы',
});

function missionShortLabel(label) {
  return MISSION_SHORT_LABELS[label] || label;
}

function setActiveMission(root, key, { focus = false } = {}) {
  const sections = [...root.querySelectorAll('[data-analysis-mission-panel]')];
  if (!sections.length) return;
  const selected = sections.find((section) => section.dataset.analysisMissionPanel === key) || sections[0];
  sections.forEach((section) => {
    const active = section === selected;
    section.hidden = !active;
    section.open = active;
  });
  root.querySelectorAll('[data-analysis-mission]').forEach((button) => {
    const active = button.dataset.analysisMission === selected.dataset.analysisMissionPanel;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', String(active));
    button.tabIndex = active ? 0 : -1;
    if (active) button.setAttribute('aria-current', 'step');
    else button.removeAttribute('aria-current');
  });
  const actions = root.querySelector('.home-mission-actions');
  if (actions) {
    const index = sections.indexOf(selected);
    const back = actions.querySelector('[data-analysis-back]');
    const next = actions.querySelector('[data-analysis-next]');
    if (back) {
      back.hidden = index <= 0;
      back.dataset.analysisBack = sections[Math.max(0, index - 1)]?.dataset.analysisMissionPanel || '';
    }
    if (next) {
      next.hidden = index >= sections.length - 1;
      next.dataset.analysisNext = sections[Math.min(sections.length - 1, index + 1)]?.dataset.analysisMissionPanel || '';
    }
  }
  if (focus) {
    requestAnimationFrame(() => selected.querySelector('summary')?.focus({ preventScroll: true }));
  }
}

function enhanceMissionPanel(body) {
  // Native exclusive <details name="…"> is unstable when the focused panel is
  // replaced through innerHTML in Chromium. Exclusivity is managed here.
  body.querySelectorAll('details[name]').forEach((details) => details.removeAttribute('name'));
  const { root, sections } = primaryMissionSections(body);
  if (!root || sections.length < 2) return;
  sections.forEach((section, index) => {
    const key = section.dataset.analysisFold || `mission-${index + 1}`;
    section.dataset.analysisMissionPanel = key;
    section.id ||= `analysisMission-${panelView}-${cleanKey(key) || index + 1}`;
    section.setAttribute('role', 'tabpanel');
    const summary = section.querySelector(':scope > summary');
    if (summary) {
      summary.tabIndex = 0;
      summary.setAttribute('aria-controls', section.id);
    }
  });
  const active = sections.find((section) => section.open && !section.hidden) || sections[0];
  const existingTrail = root.querySelector('.home-mission-trail, .home-mission-track');
  const trail = document.createElement('nav');
  trail.className = 'home-mission-trail';
  trail.dataset.analysisMissions = '';
  trail.setAttribute('role', 'tablist');
  trail.setAttribute('aria-label', 'Шаги раздела');
  for (const [index, section] of sections.entries()) {
    const key = section.dataset.analysisMissionPanel;
    const summary = section.querySelector(':scope > summary');
    const label = summary?.querySelector('strong')?.textContent?.trim() || `Шаг ${index + 1}`;
    const status = missionStatus(section);
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.analysisMission = key;
    button.dataset.status = status;
    button.id = `${section.id}-tab`;
    button.setAttribute('role', 'tab');
    button.setAttribute('aria-controls', section.id);
    button.setAttribute('aria-label', `${index + 1}. ${label} · ${missionStatusLabel(status)}`);
    button.title = label;
    button.innerHTML = `<i aria-hidden="true">${missionStatusMark(status)}</i><span>${escapeHtml(missionShortLabel(label))}</span>`;
    if (root.matches('[data-home-program]')) {
      button.dataset.homeProgramAction = 'next-mission';
      button.dataset.homeProgramMission = key;
    }
    trail.append(button);
    section.setAttribute('aria-labelledby', button.id);
  }
  if (existingTrail) existingTrail.replaceWith(trail);
  else sections[0].parentElement?.insertBefore(trail, sections[0]);

  if (!root.matches('[data-home-program]')) {
    root.querySelector('.home-mission-actions')?.remove();
    const actions = document.createElement('div');
    actions.className = 'home-mission-actions';
    actions.innerHTML = '<button type="button" class="secondary" data-analysis-back>← Назад</button><button type="button" class="primary" data-analysis-next>Далее <span aria-hidden="true">→</span></button>';
    root.append(actions);
  }
  setActiveMission(root, active.dataset.analysisMissionPanel);
}

function handleMissionNavigation(event) {
  const control = event.target.closest('[data-analysis-mission], [data-analysis-back], [data-analysis-next]');
  const summary = event.target.closest('[data-analysis-mission-panel] > summary');
  const target = control || summary;
  if (!target) return false;
  const root = target.closest('[data-home-program], [data-home-flows], [data-home-engineering], [data-home-circulation], [data-home-climate], [data-home-review], [data-home-envelope], [data-home-deliverables]');
  if (!root) return false;
  // The program owns its active mission because it also swaps the sticky
  // Next/Save action. Let its existing handler perform the rerender.
  if (root.matches('[data-home-program]')) {
    if (summary) {
      event.preventDefault();
      return true;
    }
    return false;
  }
  event.preventDefault();
  const key = control?.dataset.analysisMission
    || control?.dataset.analysisBack
    || control?.dataset.analysisNext
    || summary?.parentElement?.dataset.analysisMissionPanel;
  if (!key) return true;
  setActiveMission(root, key, { focus: Boolean(control) });
  const panel = root.closest('.project-route-panel');
  if (panel) panel.scrollTop = Math.min(panel.scrollTop, 104);
  return true;
}

function safeHomePanelHtml(html) {
  return String(html || '').replace(/(<details\b[^>]*?)\sname="[^"]+"([^>]*>)/g, '$1$2');
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
  if (!project) return { stages: [], passport: null };
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
  return { stages, passport };
}

function statusLabel(status) { return STATUS_LABEL[status] || STATUS_LABEL.unknown; }
function statusMark(status) { return STATUS_MARK[status] || STATUS_MARK.unknown; }

const ROUTE_ICON = Object.freeze({
  site: 'M3 6l6-3 6 3 6-3v15l-6 3-6-3-6 3z M9 3v15 M15 6v15',
  program: 'M3 10l9-7 9 7 M5 9v12h14V9 M10 21v-7h4v7',
  flows: 'M3 4h6v5H3z M15 15h6v5h-6z M6 9v8h9 M9 6h9v9',
  engineering: 'M3 7h7v5h5V7h6 M5 4v6 M19 4v6 M10 14v5h5v-5',
  circulation: 'M3 18h9a3 3 0 0 0 0-6h-1a3 3 0 0 1 0-6h9 M17 3l3 3-3 3',
  climate: 'M12 2v2 M12 20v2 M2 12h2 M20 12h2 M5 5l1.5 1.5 M17.5 17.5L19 19 M5 19l1.5-1.5 M17.5 6.5L19 5 M17 12a5 5 0 1 1-10 0 5 5 0 1 1 10 0',
  review: 'M8 3h8v3H8z M8 5H5v16h14V5h-3 M8 13l3 3 5-6',
  envelope: 'M3 7l9-5 9 5v10l-9 5-9-5z M3 7l9 5 9-5 M12 12v10',
  deliverables: 'M6 3h9l4 4v14H6z M14 3v5h5 M9 12h7 M9 16h5',
});

function stageIcon(view) {
  return `<svg class="route-symbol" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${ROUTE_ICON[view.id]}"/></svg>`;
}

function renderStageBar() {
  const steps = byId('projectRouteSteps');
  if (!steps) return;
  // «…» означает, что результат ещё не получен. «?» ставится после
  // проверки, которая обнаружила недостаточные исходные данные.
  const rows = homeWorkflowRows();
  for (const view of rows) {
    let button = steps.querySelector(`[data-route-view="${view.id}"]`);
    if (!button) {
      button = document.createElement('button');
      button.type = 'button';
      button.className = 'project-route-step';
      button.dataset.routeView = view.id;
      button.id = `homeViewTab-${view.id}`;
      button.setAttribute('role', 'tab');
      button.setAttribute('aria-haspopup', 'menu');
      button.setAttribute('aria-controls', 'projectRouteHover');
      button.setAttribute('aria-expanded', 'false');
      button.innerHTML = `${stageIcon(view)}<span>${escapeHtml(view.label)}</span><i class="route-status" aria-hidden="true"></i>`;
      steps.append(button);
    }
    button.disabled = !state.project;
    const current = panelOpen && (panelView === 'stage' ? view.id === 'site' : panelView === view.id);
    button.setAttribute('aria-selected', String(current));
    if (current) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
    button.classList.toggle('active', current);
    button.classList.toggle('menu-open', routeMenuPinnedView === view.id);
    button.setAttribute('aria-expanded', String(routeMenuPinnedView === view.id));
    const previous = button.dataset.status;
    if (previous === view.status) continue;
    const label = `${view.step}. ${view.label} · ${HOME_REVIEW_STATUS_LABEL[view.status]}`;
    button.setAttribute('aria-label', label);
    button.title = label;
    button.dataset.status = view.status;
    const mark = button.querySelector('.route-status');
    mark.textContent = HOME_REVIEW_STATUS_MARK[view.status];
    if (previous && view.status === 'checked' && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      mark.animate([{ transform: 'scale(.85)' }, { transform: 'scale(1.2)' }, { transform: 'scale(1)' }], { duration: 260 });
    }
  }
}

function routeHoverRows(viewId) {
  if (viewId === 'site') {
    return asArray(latestModel?.stages).flatMap((stage) => asArray(stage.tasks).map((task) => ({
      id: task.id,
      stageId: stage.id,
      label: task.definition?.title || TASKS[task.id]?.title || task.id,
      status: task.status || 'unknown',
    })));
  }
  if (viewId === 'envelope') {
    const status = workflowBadges?.missions.envelope;
    const labels = { datum: '±0.000', foundation: 'Основание', roof: 'Крыша', drainage: 'Водоотвод', entrance: 'Вход' };
    return Object.entries(labels).map(([id, label]) => ({ id: `envelope-${id}`, label, status: status?.[id] || 'pending' }));
  }
  const statuses = workflowMissionStatuses(viewId);
  return asArray(HOME_VIEW_ITEMS[viewId]).map((item, index) => {
    const [label, mission] = Array.isArray(item) ? item : [String(item), null];
    return {
      id: `${viewId}-${mission || index}`,
      label,
      mission,
      status: statuses[mission] || 'pending',
    };
  });
}

function syncRouteMenuStatuses(rows = null) {
  const menu = byId('projectRouteHover');
  const view = menu?.dataset.routeMenuView;
  if (!view || menu.hidden) return;
  const byKey = new Map((rows || routeHoverRows(view)).map((row) => [row.id, row]));
  for (const button of menu.querySelectorAll('[data-route-menu-item]')) {
    const row = byKey.get(button.dataset.routeMenuItem);
    if (!row) continue;
    button.dataset.status = row.status;
    if (view === 'site') button.dataset.routeStatus = row.status;
    const label = view === 'site' ? statusLabel(row.status) : HOME_REVIEW_STATUS_LABEL[row.status];
    button.setAttribute('aria-label', `${row.label}. ${label}`);
    button.querySelector('i').textContent = view === 'site' ? statusMark(row.status) : HOME_REVIEW_STATUS_MARK[row.status];
  }
}

function setRouteMenuButtons(viewId = null) {
  byId('projectRouteSteps')?.querySelectorAll('[data-route-view]').forEach((button) => {
    const expanded = Boolean(viewId && button.dataset.routeView === viewId);
    button.classList.toggle('menu-open', expanded);
    button.setAttribute('aria-expanded', String(expanded));
  });
}

function hideRouteHover(delay = 0, { force = false } = {}) {
  clearTimeout(routeHoverTimer);
  if (routeMenuPinnedView && !force) return;
  const hover = byId('projectRouteHover');
  const hide = () => {
    if (!hover || (routeMenuPinnedView && !force)) return;
    hover.hidden = true;
    hover.removeAttribute('data-pinned');
    hover.removeAttribute('data-route-menu-view');
  };
  if (delay) routeHoverTimer = setTimeout(hide, delay); else hide();
}

function closeRouteMenu({ restoreFocus = false } = {}) {
  const opener = routeMenuOpener;
  routeMenuPinnedView = null;
  routeMenuOpener = null;
  setRouteMenuButtons();
  hideRouteHover(0, { force: true });
  if (restoreFocus && opener?.isConnected) {
    routeFocusPreviewSuppressed = true;
    opener.focus({ preventScroll: true });
    routeFocusPreviewSuppressed = false;
  }
}

function showRouteHover(button, { pin = false } = {}) {
  const hover = byId('projectRouteHover');
  const viewId = button?.dataset?.routeView;
  const view = HOME_NAV_DEFS.find((item) => item.id === viewId);
  if (!hover || !view) return;
  if (panelOpen && !pin) return;
  if (routeMenuPinnedView && !pin && routeMenuPinnedView !== viewId) return;
  clearTimeout(routeHoverTimer);
  if (pin) {
    routeMenuPinnedView = viewId;
    routeMenuOpener = button;
    setRouteMenuButtons(viewId);
  }
  const rows = routeHoverRows(viewId);
  hover.innerHTML = `<header><strong>${escapeHtml(view.label)}</strong><small>Выберите пункт</small></header><div>${rows.map((row) => {
    const attrs = viewId === 'site'
      ? `data-route-task="${row.id}" data-route-task-stage="${row.stageId}" data-route-stage="${row.stageId}"`
      : `data-route-hover-view="${viewId}"${row.mission ? ` data-route-hover-mission="${escapeHtml(row.mission)}"` : ''}`;
    return `<button type="button" role="menuitem" tabindex="-1" data-route-menu-item="${escapeHtml(row.id)}" ${attrs}><i aria-hidden="true"></i><span>${escapeHtml(row.label)}</span></button>`;
  }).join('')}</div>`;
  hover.hidden = false;
  hover.dataset.routeMenuView = viewId;
  syncRouteMenuStatuses(rows);
  if (routeMenuPinnedView === viewId) hover.dataset.pinned = 'true';
  else hover.removeAttribute('data-pinned');
  const rect = button.getBoundingClientRect();
  const box = hover.getBoundingClientRect();
  const left = Math.max(8, Math.min(innerWidth - box.width - 8, rect.left + rect.width / 2 - box.width / 2));
  hover.style.left = `${left}px`;
  hover.style.top = `${Math.max(8, rect.top - box.height - 9)}px`;
  if (pin) {
    const first = hover.querySelector('[role="menuitem"]');
    if (first) {
      first.tabIndex = 0;
      requestAnimationFrame(() => {
        if (!hover.hidden && routeMenuPinnedView === viewId) first.focus({ preventScroll: true });
      });
    }
  }
}

function checked(value) { return value ? ' checked' : ''; }

function confirmationControl(taskId, site) {
  const planning = site?.planning || {};
  if (taskId === 'underlay' && !site?.underlay) {
    return `<label class="project-route-confirm"><input type="checkbox" data-route-confirm="withoutUnderlay"${checked(planning.withoutUnderlay)}> <span><strong>Внести данные вручную, без подложки</strong></span></label>`;
  }
  if (taskId === 'neighbor') {
    return `<label class="project-route-confirm"><input type="checkbox" data-route-confirm="contextReviewed"${checked(contextReviewMatches(site))}> <span><strong>Все известные дороги и соседние здания нанесены</strong></span></label>`;
  }
  if (taskId === 'terrain' && asArray(site?.terrain?.points).length < 3) {
    return `<label class="project-route-confirm"><input type="checkbox" data-route-confirm="flatTerrain"${checked(planning.flatTerrain)}> <span><strong>Считать участок плоским</strong><small>Для эскиза, пока нет отметок высот.</small></span></label>`;
  }
  if (taskId === 'constraints') {
    return `<label class="project-route-confirm"><input type="checkbox" data-route-confirm="constraintsConfirmed"${checked(constraintsMatch(site))}> <span><strong>Значения отступов проверены</strong></span></label>`;
  }
  return '';
}

function toolActionLabel(taskId, site) {
  if (taskId === 'underlay') return site?.underlay ? 'Изменить' : 'Импортировать';
  if (taskId === 'boundary') return site?.boundary ? 'Изменить' : 'Начертить границу';
  if (taskId === 'road') return asArray(site?.roads).length ? 'Изменить' : 'Добавить дорогу';
  if (taskId === 'entry') return site?.entry ? 'Изменить' : 'Поставить въезд';
  if (taskId === 'neighbor') return 'Начертить здание';
  if (taskId === 'north') return 'Задать север';
  if (taskId === 'terrain') return 'Добавить отметки';
  return '';
}

function renderTask(task, site, { showTitle = true } = {}) {
  let action = '';
  if (task.definition.tool) action = `<button type="button" class="project-route-task-action" data-route-tool="${task.definition.tool}">${toolActionLabel(task.id, site)}</button>`;
  else if (task.id === 'constraints') action = '<button type="button" class="project-route-task-action" data-route-action="open-constraints">Настроить отступы</button>';
  else if (task.id === 'zone') action = '<button type="button" class="project-route-task-action" data-route-action="show-zone">Показать на плане</button>';
  if (task.id === 'north' && !site?.solarVerified) {
    action += '<button type="button" class="project-route-task-action secondary" data-route-action="open-solar-settings">Указать координаты</button>';
  }
  return `<article class="project-route-task" data-route-task="${task.id}" data-status="${task.status}" data-route-status="${task.status}">
    <span class="project-route-task-mark" aria-hidden="true">${statusMark(task.status)}</span>
    <div class="project-route-task-main">
      <div class="project-route-task-title">${showTitle ? `<h3>${escapeHtml(task.definition.title)}</h3>` : ''}<span>${statusLabel(task.status)}</span></div>
      <p>${escapeHtml(task.reason)}</p>
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
      <div><h3 id="projectRouteFootprintTitle">Габариты дома</h3><p>По ним рассчитывается карта возможного размещения.</p></div>
    </div>
    <form class="project-route-footprint-form" id="projectRouteFootprintForm">
      <label>Ширина, м<input name="width" data-route-footprint="width" type="number" min="2" max="100" step="0.1" inputmode="decimal" value="${escapeHtml(draft.width)}" placeholder="12"></label>
      <label>Глубина, м<input name="depth" data-route-footprint="depth" type="number" min="2" max="100" step="0.1" inputmode="decimal" value="${escapeHtml(draft.depth)}" placeholder="10"></label>
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
  const allTasks = stage?.tasks || [];
  const tasks = allTasks.filter((task) => task.id === activeTask);
  const visible = tasks.length ? tasks : allTasks.slice(0, 1);
  if (visible[0]) activeTask = visible[0].id;
  const task = visible[0];
  return `<div class="project-route-task-list">${visible.map((item) => renderTask(item, site, { showTitle: false })).join('')}</div>
  ${task?.id === 'zone' ? renderFootprint(site) : ''}
  <button type="button" class="route-passport-link" data-route-action="passport">Паспорт участка <span aria-hidden="true">↗</span></button>`;
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
  return `<div class="project-route-facts">${facts.join('')}</div>
    <section class="project-route-unknowns" aria-labelledby="projectRouteUnknownTitle">
      <h3 id="projectRouteUnknownTitle">Что ещё проверить</h3>
      ${unknown.length ? `<ul>${unknown.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>` : '<p>Обязательные исходные данные для текущего маршрута собраны.</p>'}
    </section>
    <p class="project-route-disclaimer"><strong>Эскизная проверка, не нормативное заключение.</strong> Значения отступов и полноту исходных данных нужно проверить по документам участка и правилам вашего региона.</p>`;
}

function renderPanel(model) {
  const body = byId('projectRouteBody');
  const title = byId('projectRoutePanelTitle');
  const kicker = byId('projectRoutePanelKicker');
  const panelIcon = byId('projectRoutePanelIcon');
  if (!body || !title || !kicker) return;
  const iconView = panelView === 'stage' || panelView === 'passport'
    ? HOME_NAV_DEFS[0] : HOME_VIEW_BY_ID.get(panelView);
  if (panelIcon) panelIcon.innerHTML = iconView ? stageIcon(iconView) : '';
  if (panelView === 'passport') {
    kicker.textContent = 'Участок / Исходные данные';
    title.textContent = 'Паспорт участка';
    body.innerHTML = `<button type="button" class="route-passport-link" data-route-action="open-home-view" data-home-view="site">← Участок</button>${renderPassport(model.passport)}`;
    return;
  }
  if (HOME_VIEWS.has(panelView)) {
    const preserved = captureHomePanelState(body, panelView);
    const current = HOME_VIEW_BY_ID.get(panelView) || HOME_VIEW_DEFS[0];
    const review = panelView === 'review' ? cachedWorkflowReview() : null;
    kicker.textContent = ANALYTICAL_VIEW_BY_PANEL.has(panelView)
      ? 'Аналитический вид'
      : `Проект / Этап ${current.step} из ${HOME_NAV_DEFS.length}`;
    title.textContent = current.title;
    body.querySelectorAll('details[name]').forEach((details) => details.removeAttribute('name'));
    body.innerHTML = state.project
      ? `<div class="home-system-panel" id="homeSystemPanel">${safeHomePanelHtml(current.html(state.project, state, review))}</div>`
      : '<p class="project-route-panel-empty">Откройте или создайте проект, чтобы продолжить проектирование дома.</p>';
    if (panelView === 'circulation') bindErgoViewBlock(body, renderProjectRoute);
    restoreHomePanelState(body, preserved);
    enhanceMissionPanel(body);
    const { sections } = primaryMissionSections(body);
    missionStatusesByView.set(panelView, new Map(sections.map((section) => [
      section.dataset.analysisFold, MISSION_ROUTE_STATUS[missionStatusMark(missionStatus(section))],
    ])));
    return;
  }
  const stage = model.stages.find((item) => item.id === activeStage) || model.stages[0];
  if (!stage) {
    kicker.textContent = 'Маршрут проекта';
    title.textContent = 'Нет открытого проекта';
    body.innerHTML = '<p class="project-route-panel-empty">Откройте или создайте проект, чтобы начать подготовку участка.</p>';
    return;
  }
  kicker.textContent = `Аналитика / Этап 1 из ${HOME_NAV_DEFS.length}`;
  const stageTask = stage.tasks?.find((task) => task.id === activeTask) || stage.tasks?.[0];
  if (stageTask) activeTask = stageTask.id;
  title.textContent = stageTask?.definition?.title || 'Участок';
  const preserved = captureHomePanelState(body, 'site');
  body.innerHTML = `<div class="home-system-panel" id="homeSystemPanel">${renderStagePanel(stage)}</div>`;
  restoreHomePanelState(body, preserved);
}

function workflowMissionStatuses(view) {
  return {
    ...workflowBadges?.missions[view],
    ...Object.fromEntries(missionStatusesByView.get(view) || []),
  };
}

function homeWorkflowRows() {
  return HOME_NAV_DEFS.map((view) => {
    const statuses = routeHoverRows(view.id).map(({ status }) => (
      view.id === 'site' ? MISSION_ROUTE_STATUS[statusMark(status)] : status
    ));
    return { ...view, status: workflowStageStatus(statuses) };
  });
}

function syncOpenState() {
  const panel = byId('projectRoutePanel');
  const scrim = byId('projectRouteScrim');
  if (!panel || !scrim) return;
  panel.hidden = !panelOpen;
  scrim.hidden = true;
  byId('projectRouteSteps').hidden = false;
  const breadcrumb = byId('routeCurrentSection');
  breadcrumb.hidden = true;
  breadcrumb.textContent = byId('projectRoutePanelTitle').textContent;
  panel.setAttribute('aria-modal', 'false');
  if (!panelOpen) {
    byId('projectRouteSteps')?.querySelectorAll('[data-route-view]').forEach((button) => {
      button.classList.remove('active');
      button.removeAttribute('aria-current');
      button.setAttribute('aria-selected', 'false');
    });
  }
  document.body.classList.toggle('project-route-open', panelOpen);
}

function announce(text) {
  const live = byId('projectRouteLive');
  if (live) live.textContent = text;
}

function notifyWorkspaceViewChange() {
  document.dispatchEvent(new CustomEvent('kepler:view'));
}

function disableWorkspaceAnalyticalLayers() {
  if (state.solarAnalysis?.on) setSolarAnalysis(false);
  if (state.ergo?.on) setErgoPref({ on: false });
  state.homeProgramOverlay = {
    ...state.homeProgramOverlay, on: false, result: null, signature: null,
  };
  state.homeEngineeringOverlay = {
    ...state.homeEngineeringOverlay, on: false, result: null, signature: null,
  };
  state.homeCirculationOverlay = {
    ...state.homeCirculationOverlay, on: false, result: null, signature: null,
  };
  state._homeProgramUI = null;
  state._homeFlowsUI = null;
  state._homeEngineeringUI = null;
  state._homeCirculationUI = null;
}

function workspaceCameraKey() {
  if (state.analyticalView?.id) return state.analyticalView.id;
  return state.modeName || 'plan';
}

function saveWorkspaceCamera(key = workspaceCameraKey()) {
  const origin = state.project?.building?.origin || { x: 0, y: 0 };
  state.views[key] = {
    ...state.views[key],
    scale: state.view.scale,
    panX: state.view.panX,
    panY: state.view.panY,
    rotation: state.view.rotation,
    origin: { x: origin.x, y: origin.y },
  };
}

function loadWorkspaceCamera(key, fallback = null) {
  const saved = state.views[key] || fallback;
  if (!saved) return;
  const origin = state.project?.building?.origin || { x: 0, y: 0 };
  const camera = { ...saved };
  if (saved.origin && Number.isFinite(saved.scale)) {
    Object.assign(camera, panForMovedBuilding(camera,
      origin.x - (Number(saved.origin.x) || 0),
      origin.y - (Number(saved.origin.y) || 0)));
    camera.origin = { x: origin.x, y: origin.y };
  }
  state.views[key] = camera;
  for (const field of ['scale', 'panX', 'panY', 'rotation']) {
    if (Number.isFinite(camera[field])) state.view[field] = camera[field];
  }
  const scale = byId('scaleInfo');
  if (scale) scale.textContent = scaleLabel();
}

function enableWorkspaceAnalyticalLayer(view, { lightMode = 'daylight' } = {}) {
  if (view.analysis === 'light') {
    setSolarLevelAnalysis(view.levelId, lightMode, requestDraw);
  } else if (view.analysis === 'ergonomics') {
    setErgoPref({ on: true });
  } else if (view.analysis === 'layout') {
    state.homeProgramOverlay = {
      ...state.homeProgramOverlay,
      on: true,
      mode: 'flows',
      zones: true,
      routes: true,
      result: null,
      signature: null,
    };
    refreshHomeFlowsOverlay(state.project, state, requestDraw);
  } else if (view.analysis === 'circulation') {
    state.homeCirculationOverlay = {
      ...state.homeCirculationOverlay,
      on: true,
      result: null,
      signature: null,
    };
    refreshHomeCirculationOverlay(state.project, state, requestDraw);
  } else if (view.analysis === 'engineering') {
    state.homeEngineeringOverlay = {
      ...state.homeEngineeringOverlay,
      on: true,
      result: null,
      signature: null,
    };
    refreshHomeEngineeringOverlay(state.project, state, requestDraw);
  }
}

function workspaceAnalyticalLayerIsOn(view) {
  if (!view) return false;
  if (view.analysis === 'light') {
    return state.solarAnalysis?.on === true && state.solarAnalysis.scope === 'level'
      && state.solarAnalysis.levelId === view.levelId;
  }
  if (view.analysis === 'ergonomics') return state.ergo?.on === true;
  if (view.analysis === 'layout') {
    return state.homeProgramOverlay?.on === true && state.homeProgramOverlay.mode === 'flows';
  }
  if (view.analysis === 'circulation') return state.homeCirculationOverlay?.on === true;
  if (view.analysis === 'engineering') return state.homeEngineeringOverlay?.on === true;
  return false;
}

function syncManualAnalyticalLayer(analysis, on) {
  const current = floorAnalyticalViewById(state.project, state.analyticalView?.id);
  if (on) {
    openAnalyticalView(floorAnalyticalViewId(analysis, state.project.activeLevel), {
      // Команда «Прямое солнце» должна открыть этот же режим для всего
      // этажа, а не незаметно заменить его на карту пасмурного неба.
      lightMode: analysis === 'light' ? state.solarAnalysis?.mode : undefined,
      detailRoomId: analysis === 'light' ? state.solarAnalysis?.roomId : undefined,
    });
  } else if (current?.analysis === analysis) {
    closeAnalyticalView({ restoreFocus: false });
  }
}

// Активный аналитический вид принадлежит холсту и этажу. Плавающая панель
// является только инспектором и больше не определяет, какой вид открыт.
export function activeAnalyticalViewId() {
  const id = state.analyticalView?.id || null;
  if (!id || !floorAnalyticalViewById(state.project, id)) return null;
  return id;
}

export function openAnalyticalView(id, { lightMode, detailRoomId = null, showProperties = false } = {}) {
  const view = floorAnalyticalViewById(state.project, id);
  if (!view) return false;
  if (showProperties) {
    state.propsTab = 'props';
    setIssuesOpen(false);
  }
  const nextLightMode = lightMode ?? (state.analyticalView?.analysis === 'light' ? state.solarAnalysis?.mode : 'daylight');
  if (activeAnalyticalViewId() === view.id && state.project.activeLevel === view.levelId
    && workspaceAnalyticalLayerIsOn(view)) {
    if (panelOpen) closePanel({ restoreFocus: false });
    if (showProperties) renderProps();
    requestDraw();
    return true;
  }
  const previousLevelId = state.analyticalView?.levelId || state.project.activeLevel;
  const hadAnalyticalView = Boolean(state.analyticalView?.id);
  if (hadAnalyticalView) saveWorkspaceCamera();
  else if (activeViewId() === `plan:${state.project.activeLevel}`) {
    savePlanCamera(state.project, state.project.activeLevel, state.view);
  }
  closeRouteMenu();
  if (panelOpen) closePanel({ restoreFocus: false });
  state.analyticalView = null;
  disableWorkspaceAnalyticalLayers();
  if (hadAnalyticalView) restorePlanCamera(state.project, previousLevelId);
  openView(`plan:${view.levelId}`);
  // levelBar мог уже поменять activeLevel, поэтому openView иногда не зовёт
  // switchLevel. Камеру настоящего плана целевого этажа берём из одного
  // project-scoped хранилища levels.js, а не из устаревающего дубля.
  restorePlanCamera(state.project, view.levelId);
  const planCamera = { ...state.view };
  savePlanCamera(state.project, view.levelId, planCamera);
  state.selection = null;
  state.analyticalView = { id: view.id, analysis: view.analysis, levelId: view.levelId };
  loadWorkspaceCamera(view.id, planCamera);
  enableWorkspaceAnalyticalLayer(view, { lightMode: nextLightMode });
  if (view.analysis === 'light' && detailRoomId
    && state.project.rooms.some((room) => room.id === detailRoomId)) {
    focusSolarRoom(detailRoomId);
    state.selection = { type: 'room', id: detailRoomId };
  }
  requestDraw();
  renderProjectRoute();
  renderProps();
  announce(`Открыт вид «${view.title}»`);
  notifyWorkspaceViewChange();
  return true;
}

export function closeAnalyticalView({ restoreFocus = false } = {}) {
  const hadView = Boolean(state.analyticalView?.id);
  const ownPanel = panelView === 'passport' ? 'stage' : panelView;
  const hadPanel = panelOpen && ANALYTICAL_VIEW_BY_PANEL.has(ownPanel);
  if (!hadView && !hadPanel) return false;
  if (hadView) {
    saveWorkspaceCamera();
    state.analyticalView = null;
    disableWorkspaceAnalyticalLayers();
    restorePlanCamera(state.project, state.project.activeLevel);
  }
  if (hadPanel) closePanel({ restoreFocus });
  if (hadView) {
    requestDraw();
    renderProjectRoute();
    renderProps();
    notifyWorkspaceViewChange();
  }
  return true;
}

export function openHomeMission(view, mission, opener) {
  openPanel(view, null, opener);
  if (mission) {
    byId('projectRouteBody')?.querySelector(`[data-analysis-mission="${mission}"]`)?.click();
  }
}

function openPanel(view, stageId, opener) {
  closeRouteMenu();
  closeSheets();
  panelView = view;
  if (stageId) activeStage = stageId;
  if (view === 'stage') lastWorkflowView = 'site';
  else if (HOME_VIEWS.has(view)) lastWorkflowView = view;
  if (view === 'stage' || HOME_VIEWS.has(view)) saveWorkflowPosition();
  // Нижняя палитра и workspace-меню открывают одни аналитические виды.
  // Все входы должны получить свежий снимок одинаково.
  if (ANALYTICAL_VIEW_BY_PANEL.has(view) && state.analytics?.dirty) flushAnalytics();
  if (!panelOpen) {
    lastOpener = opener || document.activeElement;
    lastOpenerView = lastOpener?.dataset?.routeView || null;
  }
  panelOpen = true;
  renderProjectRoute();
  syncOpenState();
  announce(view === 'passport' ? 'Открыт паспорт участка'
    : HOME_VIEW_BY_ID.get(view)?.announce || 'Открыт этап маршрута проекта');
  notifyWorkspaceViewChange();
}

function openSiteTask(stageId, taskId, opener) {
  activeTask = taskId;
  closeRouteMenu();
  openPanel('stage', stageId, opener);
}

function closePanel({ restoreFocus = true } = {}) {
  if (!panelOpen) return;
  panelOpen = false;
  closeRouteMenu();
  syncOpenState();
  announce('Маршрут проекта закрыт');
  const opener = lastOpenerView
    ? byId('projectRouteSteps')?.querySelector(`[data-route-view="${lastOpenerView}"]`)
    : lastOpener;
  if (restoreFocus && opener?.dataset.floorMission) {
    // Закрытие панели перерисует инспектор, а на телефоне оставит его свёрнутым.
    const mission = opener.dataset.floorMission;
    requestAnimationFrame(() => {
      const source = isPhone() ? byId('mobileBar')?.querySelector('[data-sheet="props"]')
        : byId('propsBody')?.querySelector(`[data-floor-mission="${mission}"]`);
      source?.focus({ preventScroll: true });
    });
  } else if (restoreFocus) {
    const fallback = byId('projectRouteSteps')?.querySelector(`[data-route-view="${lastWorkflowView}"]`)
      || byId('projectRouteSteps')?.querySelector('[data-route-view]');
    routeFocusPreviewSuppressed = true;
    (opener?.isConnected ? opener : fallback)?.focus({ preventScroll: true });
    routeFocusPreviewSuppressed = false;
  }
  notifyWorkspaceViewChange();
}

function switchHomeView(view) {
  if (!HOME_NAV_VIEWS.has(view)) return;
  if (view === 'site') {
    panelView = 'stage';
    activeStage = firstIncompleteStage(latestModel);
  } else panelView = view;
  lastWorkflowView = view;
  saveWorkflowPosition();
  renderProjectRoute();
  byId('projectRoutePanel').scrollTop = 0;
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
  announce(view === 'site' ? HOME_NAV_DEFS[0].announce
    : HOME_VIEW_BY_ID.get(view)?.announce || 'Открыт этап проектирования дома');
  notifyWorkspaceViewChange();
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
  openView('site');
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
  openView('site');
  requestDraw();
  toast('Показано рабочее пятно по введённым ограничениям', true);
}

function openConstraintSettings() {
  closePanel({ restoreFocus: false });
  closeSheets();
  cancelTool();
  state.selection = null;
  state.propsTab = 'props';
  openView('site');
  renderProps();
  requestAnimationFrame(() => {
    if (isPhone()) byId('mobileBar')?.querySelector('[data-sheet="props"]')?.click();
    else byId('setbackB')?.focus({ preventScroll: true });
  });
}

function openSolarSettings(opener = document.activeElement) {
  openPanel('climate', null, opener);
  const body = byId('projectRouteBody');
  const climate = body?.querySelector('[data-home-climate]');
  if (climate) setActiveMission(climate, 'location');
  const location = body?.querySelector('[data-climate-location]');
  if (location) {
    location.open = true;
    requestAnimationFrame(() => location.querySelector('#lat')?.focus());
  }
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
  openView('site');
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

function openSheetsPanel(sheetId = null) {
  if (sheetId) state.sheetSel = String(sheetId).startsWith('user:')
    ? String(sheetId) : `user:${sheetId}`;
  if (isPhone()) toggleSheet('sheets');
  else {
    state.propsTab = 'sheets';
    renderProps();
  }
}

function openAnalysisView(mode) {
  openView(mode === 'plan' ? `plan:${state.project.activeLevel}` : mode);
}

function handleBodyClick(event) {
  if (handleMissionNavigation(event)) return;
  const destination = event.target.closest('[data-analysis-open]')?.dataset.analysisOpen;
  if (destination) {
    closePanel({ restoreFocus: false });
    closeSheets();
    if (destination === 'ergo-plan') openView(`plan:${state.project.activeLevel}`);
    if (destination === 'issues') {
      event.stopPropagation();
      setIssuesOpen(true);
      byId('issuesPanel')?.querySelector('button')?.focus();
    }
    if (destination === 'tep') {
      if (isPhone()) toggleSheet('props');
      byId('propsTabTep')?.click();
      byId('tepTabRooms')?.click();
      byId('tepTabRooms')?.focus();
    }
    return;
  }
  if (handleHomeDeliverablesClick(event, {
    openView: (viewId) => {
      closePanel({ restoreFocus: false });
      openView(viewId);
    },
    openSheets: () => {
      closePanel({ restoreFocus: false });
      openSheetsPanel();
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
    openView: (viewId) => openView(viewId),
    openSheets: (sheetId) => openSheetsPanel(sheetId),
    goToIssue: (entry) => {
      closePanel({ restoreFocus: false });
      goToIssue(entry);
    },
    closePanel,
    announce,
  })) return;
  const solarWasOn = state.solarAnalysis?.on === true;
  const handledClimate = handleHomeClimateClick(event, {
    project: state.project,
    state,
    closePanel,
    announce,
    rerender: renderProjectRoute,
    requestDraw,
    toast,
    setEditorMode: openAnalysisView,
    switchLevel,
  });
  if (handledClimate) {
    const solarOn = state.solarAnalysis?.on === true;
    if (solarOn !== solarWasOn) syncManualAnalyticalLayer('light', solarOn);
    return;
  }
  const circulationWasOn = state.homeCirculationOverlay?.on === true;
  if (handleHomeCirculationClick(event, {
    project: state.project,
    state,
    mutate,
    closePanel,
    announce,
    rerender: queueProjectRouteRender,
    requestDraw,
    toast,
    setEditorMode: openAnalysisView,
  })) {
    const circulationOn = state.homeCirculationOverlay?.on === true;
    if (circulationOn !== circulationWasOn) syncManualAnalyticalLayer('circulation', circulationOn);
    disableSolarForAnotherOverlay(state.homeCirculationOverlay?.on === true);
    return;
  }
  const flowsWereOn = state.homeProgramOverlay?.on === true;
  const handledFlows = handleHomeFlowsClick(event, {
    project: state.project,
    state,
    mutate,
    closePanel,
    announce,
    rerender: queueProjectRouteRender,
    requestDraw,
    toast,
    setEditorMode: openAnalysisView,
  });
  if (handledFlows) {
    const flowsOn = state.homeProgramOverlay?.on === true;
    if (flowsOn !== flowsWereOn) syncManualAnalyticalLayer('layout', flowsOn);
    disableCirculationForAnotherOverlay(state.homeProgramOverlay?.on === true);
    disableSolarForAnotherOverlay(state.homeProgramOverlay?.on === true);
    return;
  }
  const engineeringWasOn = state.homeEngineeringOverlay?.on === true;
  const handledEngineering = handleHomeEngineeringClick(event, {
    project: state.project,
    state,
    mutate,
    closePanel,
    announce,
    rerender: queueProjectRouteRender,
    requestDraw,
    toast,
    setEditorMode: openAnalysisView,
  });
  if (handledEngineering) {
    const engineeringOn = state.homeEngineeringOverlay?.on === true;
    if (engineeringOn !== engineeringWasOn) syncManualAnalyticalLayer('engineering', engineeringOn);
    disableCirculationForAnotherOverlay(state.homeEngineeringOverlay?.on === true);
    disableSolarForAnotherOverlay(state.homeEngineeringOverlay?.on === true);
    return;
  }
  const programWasOn = state.homeProgramOverlay?.on === true;
  const handledProgram = handleHomeProgramClick(event, {
    closePanel,
    announce,
    rerender: renderProjectRoute,
  });
  if (handledProgram) {
    if (state.analyticalView && (state.homeProgramOverlay?.on === true) !== programWasOn) {
      closeAnalyticalView({ restoreFocus: false });
    }
    disableCirculationForAnotherOverlay(state.homeProgramOverlay?.on === true);
    disableSolarForAnotherOverlay(state.homeProgramOverlay?.on === true);
    return;
  }
  const group = event.target.closest('[data-route-stage]');
  if (group) {
    activeStage = group.dataset.routeStage;
    saveWorkflowPosition();
    renderProjectRoute();
    byId('projectRouteBody')?.querySelector('[data-route-stage][aria-current="step"]')?.focus({ preventScroll: true });
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
  else if (action === 'continue-home-view') switchHomeView(actionButton.dataset.homeView || 'program');
  else if (action === 'show-zone') showWorkingZone();
  else if (action === 'open-constraints') openConstraintSettings();
  else if (action === 'open-solar-settings') openSolarSettings(actionButton);
  else if (action === 'passport') {
    panelView = 'passport';
    renderProjectRoute();
    byId('projectRouteClose').focus();
  }
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
  if (event.key === 'Escape' && routeMenuPinnedView) {
    event.preventDefault();
    event.stopImmediatePropagation();
    closeRouteMenu({ restoreFocus: true });
    announce('Меню аналитики закрыто');
    return;
  }
  if (!panelOpen) return;
  if (event.key === 'Escape') {
    event.preventDefault();
    event.stopImmediatePropagation();
    closePanel();
    return;
  }
  const missionTab = event.target?.closest?.('[data-analysis-mission]');
  if (missionTab && ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
    const tabs = [...missionTab.closest('[data-analysis-missions]')?.querySelectorAll('[data-analysis-mission]') || []];
    if (tabs.length) {
      const current = Math.max(0, tabs.indexOf(missionTab));
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1
        : (current + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
      event.preventDefault();
      tabs[next].click();
    }
    return;
  }
  const homeTab = event.target?.closest?.('.home-system-nav [data-home-view]');
  const homeNavKeys = ['ArrowLeft', 'ArrowRight', 'Home', 'End'];
  if (!isPhone()) homeNavKeys.push('ArrowUp', 'ArrowDown');
  if (homeTab && homeNavKeys.includes(event.key)) {
    const tabs = HOME_NAV_DEFS.map((view) => view.id);
    const current = Math.max(0, tabs.indexOf(homeTab.dataset.homeView));
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1
      : (current + (event.key === 'ArrowRight' ? 1
        : event.key === 'ArrowLeft' ? -1
          : event.key === 'ArrowDown' ? 1 : -1) + tabs.length) % tabs.length;
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

function beginPanelDrag(event) {
  if (event.button !== 0 || event.target.closest('button, input, select, textarea, a')) return;
  const panel = byId('projectRoutePanel');
  if (!panel || panel.hidden) return;
  const rect = panel.getBoundingClientRect();
  panel.style.left = `${rect.left}px`;
  panel.style.top = `${rect.top}px`;
  panel.style.right = 'auto';
  panel.style.bottom = 'auto';
  panel.style.transform = 'none';
  panelDrag = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, left: rect.left, top: rect.top };
  event.currentTarget.setPointerCapture?.(event.pointerId);
  event.preventDefault();
}

function movePanel(event) {
  if (!panelDrag || panelDrag.pointerId !== event.pointerId) return;
  const panel = byId('projectRoutePanel');
  if (!panel) return;
  const maxLeft = Math.max(8, innerWidth - panel.offsetWidth - 8);
  const maxTop = Math.max(8, innerHeight - Math.min(panel.offsetHeight, innerHeight - 16) - 8);
  panel.style.left = `${Math.max(8, Math.min(maxLeft, panelDrag.left + event.clientX - panelDrag.x))}px`;
  panel.style.top = `${Math.max(8, Math.min(maxTop, panelDrag.top + event.clientY - panelDrag.y))}px`;
}

function endPanelDrag(event) {
  if (!panelDrag || panelDrag.pointerId !== event.pointerId) return;
  panelDrag = null;
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
  restoreWorkflowPosition();
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
  root.classList.toggle('has-project', Boolean(state.project));
  if (panelOpen) renderPanel(latestModel);
  renderStageBar();
  syncRouteMenuStatuses();
  syncOpenState();
}

export function bindProjectRoute() {
  if (bound) {
    renderProjectRoute();
    return;
  }
  const root = byId('projectRoute');
  const steps = byId('projectRouteSteps');
  const body = byId('projectRouteBody');
  if (!root || !steps || !body) return;
  bound = true;
  document.addEventListener('kepler:open-climate', (event) => {
    if (event.detail?.location) openSolarSettings(event.detail.opener);
    else openPanel('climate', null, event.detail?.opener);
  });
  steps.addEventListener('click', (event) => {
    const button = event.target.closest('[data-route-view]');
    if (!button) return;
    event.preventDefault();
    if (routeMenuPinnedView === button.dataset.routeView) {
      closeRouteMenu({ restoreFocus: true });
      announce('Меню аналитики закрыто');
      return;
    }
    if (panelOpen) closePanel({ restoreFocus: false });
    showRouteHover(button, { pin: true });
    announce(`Открыто меню «${HOME_NAV_DEFS.find((item) => item.id === button.dataset.routeView)?.label || 'Аналитика'}»`);
  });
  steps.addEventListener('pointerover', (event) => {
    const button = event.target.closest('[data-route-view]');
    if (button) showRouteHover(button);
  });
  steps.addEventListener('pointerout', (event) => {
    if (!event.relatedTarget?.closest?.('#projectRouteHover, [data-route-view]')) hideRouteHover(180);
  });
  steps.addEventListener('focusin', (event) => {
    const button = event.target.closest('[data-route-view]');
    if (button && !routeFocusPreviewSuppressed) showRouteHover(button);
  });
  steps.addEventListener('keydown', (event) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const buttons = [...steps.querySelectorAll('[data-route-view]')];
    if (!buttons.length) return;
    const current = Math.max(0, buttons.indexOf(document.activeElement));
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
      : (current + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length;
    event.preventDefault();
    buttons[next].focus();
  });
  byId('projectRouteClose')?.addEventListener('click', () => closePanel());
  byId('projectRouteScrim')?.addEventListener('click', () => closePanel());
  const hover = byId('projectRouteHover');
  hover?.addEventListener('pointerenter', () => clearTimeout(routeHoverTimer));
  hover?.addEventListener('pointerleave', () => hideRouteHover(180));
  hover?.addEventListener('keydown', (event) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
    const items = [...hover.querySelectorAll('[role="menuitem"]')];
    const current = event.target.closest('[role="menuitem"]');
    if (!current || !items.length) return;
    const index = Math.max(0, items.indexOf(current));
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
      : (index + (['ArrowRight', 'ArrowDown'].includes(event.key) ? 1 : -1) + items.length) % items.length;
    event.preventDefault();
    items.forEach((item, itemIndex) => { item.tabIndex = itemIndex === next ? 0 : -1; });
    items[next].focus({ preventScroll: true });
  });
  hover?.addEventListener('click', (event) => {
    const task = event.target.closest('[data-route-task]');
    if (task) {
      const opener = routeMenuOpener || task;
      openSiteTask(task.dataset.routeTaskStage, task.dataset.routeTask, opener);
      return;
    }
    const view = event.target.closest('[data-route-hover-view]');
    if (view) {
      const opener = routeMenuOpener || view;
      openHomeMission(view.dataset.routeHoverView, view.dataset.routeHoverMission, opener);
    }
  });
  document.addEventListener('pointerdown', (event) => {
    if (!routeMenuPinnedView) return;
    if (event.target?.closest?.('#projectRouteHover, [data-route-view]')) return;
    closeRouteMenu();
  });
  const panelHead = byId('projectRoutePanel')?.querySelector('.project-route-panel-head');
  panelHead?.addEventListener('pointerdown', beginPanelDrag);
  document.addEventListener('pointermove', movePanel);
  document.addEventListener('pointerup', endPanelDrag);
  document.addEventListener('pointercancel', endPanelDrag);
  body.addEventListener('click', handleBodyClick);
  body.addEventListener('input', (event) => {
    handleFootprintInput(event);
    handleHomeProgramInput(event);
    handleHomeCirculationInput(event, {
      project: state.project, state, mutate,
      rerender: queueProjectRouteRender, requestDraw, toast,
    });
  });
  body.addEventListener('change', (event) => {
    handleHomeProgramInput(event);
    handleHomeFlowsInput(event, {
      project: state.project, state, mutate,
      rerender: queueProjectRouteRender, requestDraw, toast,
    });
    handleHomeEngineeringInput(event, {
      project: state.project, state, mutate,
      rerender: queueProjectRouteRender, requestDraw, toast,
    });
    handleHomeCirculationInput(event, {
      project: state.project, state, mutate,
      rerender: queueProjectRouteRender, requestDraw, toast,
    });
    handleHomeClimateInput(event, {
      project: state.project, state, mutate, applyModeRotation,
      rerender: renderProjectRoute, requestDraw, toast,
    });
    const input = event.target.closest('[data-route-confirm]');
    if (input) handleConfirmation(input);
  });
  document.addEventListener('keydown', handleDocumentKeydown, true);
  document.addEventListener(PROJECT_CHANGE_EVENT, () => {
    missionStatusesByView.clear();
    invalidateWorkflowReview();
    scheduleWorkflowBadges();
    const analytical = floorAnalyticalViewById(state.project, state.analyticalView?.id);
    if (state.analyticalView && !analytical) {
      closeAnalyticalView({ restoreFocus: false });
    }
    if (analytical && state.project.activeLevel !== analytical.levelId) {
      const next = floorAnalyticalViewId(analytical.analysis, state.project.activeLevel);
      if (openAnalyticalView(next)) return;
      closeAnalyticalView({ restoreFocus: false });
    }
    if (analytical && !workspaceAnalyticalLayerIsOn(analytical)) {
      disableWorkspaceAnalyticalLayers();
      enableWorkspaceAnalyticalLayer(analytical, { lightMode: state.solarAnalysis?.mode || 'daylight' });
    }
    if (state.homeProgramOverlay?.on && state.homeProgramOverlay.mode === 'flows') {
      refreshHomeFlowsOverlay(state.project, state, requestDraw);
    } else if (state.homeProgramOverlay?.on) refreshHomeProgramOverlay();
    if (state.homeEngineeringOverlay?.on) {
      refreshHomeEngineeringOverlay(state.project, state, requestDraw);
    }
    if (state.homeCirculationOverlay?.on) {
      refreshHomeCirculationOverlay(state.project, state, requestDraw);
    }
    if (analytical?.analysis === 'light' && state.solarAnalysis?.on) {
      // Геометрическая правка должна пересчитать весь этаж, включая комнаты
      // вне текущего viewport. Иначе progress навсегда замирал на N−1.
      refreshSolarLevelAnalysis(requestDraw);
    } else if (state.solarAnalysis?.on) requestDraw();
    if (state.siteOpportunity?.on) refreshSiteOpportunity();
    else {
      // Ошибка предварительного запуска относится к прежнему набору
      // исходных данных; после правки пользователь запускает карту заново.
      if (state.siteOpportunity?.result) {
        state.siteOpportunity = { on: false, result: null, signature: null };
      }
      // Изменение проекта может прийти прямо из blur/change обработчика поля.
      // Не заменяем его DOM синхронно, пока браузер завершает событие.
      queueProjectRouteRender();
    }
  });
  document.addEventListener(ANALYTICS_READY_EVENT, () => {
    // Кеш мог быть построен между PROJECT_CHANGE и завершением отложенного
    // снимка. Инвалидируем его по фактической ревизии аналитики.
    invalidateWorkflowReview();
    if (bound) renderProjectRoute();
  });
  document.addEventListener('kepler:open-analytical-view', (event) => {
    openAnalyticalView(event.detail?.id);
  });
  document.addEventListener('kepler:close-analytical-view', () => {
    closeAnalyticalView({ restoreFocus: false });
  });
  document.addEventListener('kepler:view', () => {
    if (state.sheetOpen) {
      if (panelOpen) closePanel({ restoreFocus: false });
      else closeRouteMenu();
    }
    const current = floorAnalyticalViewById(state.project, state.analyticalView?.id);
    if (!current) return;
    if (activeViewId() !== `plan:${current.levelId}`) {
      closeAnalyticalView({ restoreFocus: false });
      return;
    }
    if (state.project.activeLevel !== current.levelId) {
      const next = floorAnalyticalViewId(current.analysis, state.project.activeLevel);
      if (!openAnalyticalView(next)) closeAnalyticalView({ restoreFocus: false });
    }
  });
  document.addEventListener(PROJECT_REPLACED_EVENT, resetWorkflowForReplacement);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') saveWorkflowPosition();
  });
  globalThis.addEventListener?.('pagehide', saveWorkflowPosition);
  globalThis.addEventListener?.('resize', () => {
    if (panelOpen) syncOpenState();
  });
  renderProjectRoute();
}
