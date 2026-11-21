import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createItem, createProject, createRoom,
} from '../core/model.js';

const previousDocument = globalThis.document;
globalThis.document = { getElementById: () => ({ getContext: () => ({}) }) };
const {
  handleHomeCirculationClick,
  handleHomeCirculationInput,
  homeCirculationHtml,
} = await import('../ui/home-circulation.js');
if (previousDocument === undefined) delete globalThis.document;
else globalThis.document = previousDocument;

function roomProject() {
  const project = createProject('Движение');
  const room = createRoom('living', 0, 0, 5000, 4000);
  room.id = 'living';
  project.levels[0].rooms.push(room);
  return project;
}

function inputEvent(input, type = 'change') {
  return {
    type,
    target: {
      closest: (selector) => (selector.includes('[data-circulation-') ? input : null),
    },
  };
}

test('неизвестный расчёт не окрашивается как свободный маршрут', () => {
  const html = homeCirculationHtml(createProject('Пусто'), {
    homeCirculationOverlay: { profileWidthMm: 600 },
  });
  assert.match(html, /class="home-circulation-summary" data-status="unknown"/);
  assert.doesNotMatch(html, /class="home-circulation-summary" data-status="clear"/);
  assert.match(html, /не является нормативной проверкой/i);
});

test('разные периоды частоты остаются отдельными', () => {
  const project = roomProject();
  project.layoutBrief = {
    scenarioSelections: [
      { scenarioId: 'SCN001', enabled: true, frequencyValue: 2, frequencyPeriod: 'day' },
      { scenarioId: 'SCN015', enabled: true, frequencyValue: 3, frequencyPeriod: 'week' },
    ],
  };
  const html = homeCirculationHtml(project, {
    homeCirculationOverlay: { metric: 'frequency', period: null, profileWidthMm: 600 },
  });
  assert.match(html, /value="day"/);
  assert.match(html, /value="week"/);
  assert.match(html, /разных периодов показаны раздельно/i);
  assert.match(html, /Период не выбран/i);
});

test('выбранная мебель сохраняется как точный якорь маршрута', () => {
  const project = roomProject();
  const item = createItem('sofa', 2500, 2000, 1800, 900);
  item.id = 'sofa-1';
  project.levels[0].items.push(item);
  project.layoutBrief = {
    scenarioSelections: [{ scenarioId: 'SCN001', enabled: true }],
    scenarioRouteBindings: [{
      scenarioId: 'SCN001', routeId: 'entry_to_seat', instanceId: 'main',
      from: { levelId: 'L1', roomId: 'living' },
      to: { levelId: 'L1', roomId: 'living' },
    }],
  };
  const state = { homeCirculationOverlay: { on: false } };
  const calls = { mutate: 0, rerender: 0, draw: 0 };
  const input = {
    value: 'item:sofa-1',
    dataset: {
      circulationAnchor: 'from', scenarioId: 'SCN001', routeId: 'entry_to_seat', instanceId: 'main',
    },
    closest: (selector) => (selector === '[data-home-circulation]' ? {} : null),
    hasAttribute: () => false,
  };
  const handled = handleHomeCirculationInput(inputEvent(input), {
    project,
    state,
    mutate: (change) => { calls.mutate += 1; change(); return true; },
    rerender: () => { calls.rerender += 1; },
    requestDraw: () => { calls.draw += 1; },
  });
  const endpoint = project.layoutBrief.scenarioRouteBindings[0].from;
  assert.equal(handled, true);
  assert.equal(endpoint.anchorType, 'item');
  assert.equal(endpoint.anchorId, 'sofa-1');
  assert.deepEqual(calls, { mutate: 1, rerender: 1, draw: 0 });

  input.value = '';
  handleHomeCirculationInput(inputEvent(input), {
    project,
    state,
    mutate: (change) => { change(); return true; },
  });
  assert.equal('anchorType' in project.layoutBrief.scenarioRouteBindings[0].from, false);
  assert.equal('anchorId' in project.layoutBrief.scenarioRouteBindings[0].from, false);
});

test('включение слоя отключает прежние аналитические слои', () => {
  const project = roomProject();
  const state = {
    homeCirculationOverlay: { on: false, profileWidthMm: 600 },
    homeProgramOverlay: { on: true, mode: 'flows', result: {} },
    homeEngineeringOverlay: { on: true, result: {} },
    _homeProgramUI: {},
    _homeFlowsUI: {},
    _homeEngineeringUI: {},
    ergo: { on: true, heat: true },
  };
  const calls = { close: 0, draw: 0, rerender: 0 };
  const button = {
    dataset: { homeCirculationAction: 'toggle-overlay' },
    closest: (selector) => (selector === '[data-home-circulation]' ? {} : null),
  };
  const event = {
    target: {
      closest: (selector) => (selector === '[data-home-circulation-action]' ? button : null),
    },
  };
  const handled = handleHomeCirculationClick(event, {
    project,
    state,
    closePanel: () => { calls.close += 1; },
    requestDraw: () => { calls.draw += 1; },
    rerender: () => { calls.rerender += 1; },
  });
  assert.equal(handled, true);
  assert.equal(state.homeCirculationOverlay.on, true);
  assert.equal(state.homeProgramOverlay.on, false);
  assert.equal(state.homeEngineeringOverlay.on, false);
  assert.equal(state.ergo.on, false);
  assert.equal(state._homeFlowsUI, null);
  assert.deepEqual(calls, { close: 1, draw: 1, rerender: 1 });
});
