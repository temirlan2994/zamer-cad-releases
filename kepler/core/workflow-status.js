import { deriveEnvelopeStatus } from './envelope-status.js';
import { analyzeHomeCirculation } from './home-circulation.js';
import { analyzeHomeClimateOverview } from './home-climate.js';
import { analyzeHomeDeliverables } from './home-deliverables.js';
import { analyzeHomeEngineering, engineeringMissionStatuses } from './home-engineering.js';
import { analyzeHomeFlows } from './home-flows.js';
import { analyzeHomeProgram, suggestHomeProgram } from './home-program.js';
import { analyzeHomeReview } from './home-review.js';
import { HOME_PROGRAM_OPTION_KEYS } from './layout-brief.js';

const array = (value) => (Array.isArray(value) ? value : []);

export function flowsMissionStatuses(flows) {
  const summary = flows.summary || {};
  return {
    zones: summary.zoneCount ? 'checked' : 'unknown',
    scenarios: summary.activeScenarioCount ? 'checked' : 'attention',
    routes: summary.missingRouteCount || summary.functionalProblemCount ? 'blocked'
      : summary.unknownRouteCount ? 'attention'
        : summary.resolvedRouteCount || summary.resolvedFunctionalRouteCount ? 'checked' : 'unknown',
  };
}

function programMissions(project, program) {
  const saved = project.layoutBrief?.homeProgram;
  const draft = saved || suggestHomeProgram(project).program;
  const bathroom = draft?.bathroomCount;
  return {
    residents: 'checked', // Панель начинает с предложенного числа взрослых.
    rooms: ['combined', 'separate'].includes(draft?.socialMode)
      && bathroom != null && Number.isFinite(Number(bathroom)) ? 'checked' : 'unknown',
    extras: HOME_PROGRAM_OPTION_KEYS.filter((key) => key !== 'guestBedroom')
      .every((key) => typeof draft?.options?.[key] === 'boolean') ? 'checked' : 'unknown',
    plan: program.status === 'ready' ? 'checked'
      : program.status === 'incomplete' ? 'attention' : 'unknown',
    result: saved?.confirmed === true ? 'checked' : 'unknown',
  };
}

function circulationMissions(circulation, heatmap) {
  const routes = array(circulation.routes);
  const status = circulation.status;
  const check = status === 'clear' ? 'checked' : status === 'blocked' ? 'blocked'
    : ['narrow', 'approximate', 'partial'].includes(status) ? 'attention' : 'unknown';
  return {
    'circulation-check': check,
    'circulation-routes': check,
    'circulation-anchors': !routes.length ? 'unknown'
      : routes.some((route) => ['approximate', 'partial', 'unknown'].includes(route.status)) ? 'attention' : 'checked',
    'circulation-map': heatmap ? 'checked' : 'unknown',
  };
}

function climateMissions(project, climate, roomKey) {
  const rooms = array(climate.rooms);
  const room = rooms.find((entry) => entry.key === roomKey)
    || rooms.find((entry) => entry.levelId === project.activeLevel) || rooms[0];
  const solar = climate.sources?.solar?.status;
  const sources = Object.values(climate.sources || {}).map((source) => source.status);
  return {
    'climate-room': !room ? 'unknown' : !room.windowCount ? 'blocked'
      : solar === 'missing' ? 'unknown' : 'attention',
    location: solar === 'verified' ? 'checked' : 'unknown',
    sources: !sources.length || sources.some((status) => ['missing', 'unknown'].includes(status)) ? 'unknown'
      : sources.every((status) => ['verified', 'fact'].includes(status)) ? 'checked' : 'attention',
  };
}

function deliverablesMissions(deliverables) {
  return {
    'deliverables-checks': deliverables.status === 'ready' ? 'checked'
      : deliverables.status === 'partial' ? 'attention' : 'blocked',
    'deliverables-sheets': deliverables.sheets?.total > 0 ? 'checked' : 'blocked',
    'deliverables-export': array(deliverables.exports).some((entry) => entry.available !== false && entry.kind) ? 'checked' : 'blocked',
  };
}

function reviewMissions(review) {
  return {
    problems: review.provenProblems.length ? 'blocked' : 'checked',
    unknowns: review.unknowns.length ? 'attention' : 'checked',
    checked: review.checkedFacts.length ? 'checked' : 'unknown',
    stages: review.stages.some((stage) => stage.status === 'blocked') ? 'blocked' : 'unknown',
  };
}

export function workflowStageStatus(status, missions = {}) {
  const values = Object.values(missions);
  if (status === 'blocked' || values.includes('blocked')) return 'blocked';
  if (status === 'attention' || values.includes('attention')) return 'attention';
  if (status === 'checked' || (values.length && values.every((value) => value === 'checked'))) return 'checked';
  return status || (values.length ? 'unknown' : 'pending');
}

// Возвращаем только статусы. Тяжёлые сетки и подробный отчёт остаются внутри
// Worker, так что открытие меню не требует строить и пересылать их разметку.
export function analyzeWorkflowStatus(project, options = {}) {
  const program = analyzeHomeProgram(project);
  const flows = analyzeHomeFlows(project, { program });
  const engineering = analyzeHomeEngineering(project);
  const climate = analyzeHomeClimateOverview(project, { engineering });
  const circulation = analyzeHomeCirculation(project, { flows, profileWidthMm: options.profileWidthMm });
  const deliverables = analyzeHomeDeliverables(project);
  const review = analyzeHomeReview(project, { program, flows, engineering, climate, circulation, deliverables });
  const stages = Object.fromEntries(review.stages.map(({ id, status }) => [id, status]));
  stages.review = review.status;
  return {
    stages,
    missions: {
      program: programMissions(project, program),
      flows: flowsMissionStatuses(flows),
      engineering: engineeringMissionStatuses(project, engineering),
      circulation: circulationMissions(circulation, options.heatmap),
      climate: climateMissions(project, climate, options.roomKey),
      review: reviewMissions(review),
      envelope: deriveEnvelopeStatus(project),
      deliverables: deliverablesMissions(deliverables),
    },
  };
}
