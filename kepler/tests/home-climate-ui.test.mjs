import test from 'node:test';
import assert from 'node:assert/strict';

import { createProject, createRoom } from '../core/model.js';
const previousDocument = globalThis.document;
globalThis.document = { getElementById: () => ({ getContext: () => ({}) }) };
const {
  handleHomeClimateClick,
  handleHomeClimateInput,
  homeClimateHtml,
  refreshHomeClimateView,
} = await import('../ui/home-climate.js');
if (previousDocument === undefined) delete globalThis.document;
else globalThis.document = previousDocument;

function roomProject() {
  const project = createProject('Свет');
  const room = createRoom('living', 0, 0, 5000, 4000);
  room.id = 'living-1';
  room.name = 'Гостиная';
  project.levels[0].rooms.push(room);
  return project;
}

function climateButton(dataset) {
  const button = {
    dataset,
    closest: (selector) => (selector === '[data-home-climate]' ? {} : null),
  };
  return {
    button,
    event: {
      target: {
        closest: (selector) => (selector === '[data-home-climate-action]' ? button : null),
      },
    },
  };
}

test('панель не выдаёт предварительную оценку за норму или микроклимат', () => {
  const project = roomProject();
  const state = { solarAnalysis: { on: false, mode: 'direct' } };
  const html = homeClimateHtml(project, state);
  assert.match(html, /data-home-climate/);
  assert.match(html, /Не нормативное заключение/i);
  assert.match(html, /не рассчитывают температуру, воздухообмен, перегрев или CFD/i);
  assert.match(html, /Нет наружных окон/i);
  assert.match(html, /Сезонная световая сводка/i);
  assert.doesNotMatch(html, /норма выполнена/i);
  assert.equal(state._homeClimateUI.roomId, 'living-1');
  assert.equal(state._homeClimateUI.detail.thermal.numericHours, null);
});

test('обычная отрисовка не запускает сезонный расчёт', () => {
  const project = roomProject();
  let reports = 0;
  const state = { solarAnalysis: { on: false, mode: 'direct' } };
  homeClimateHtml(project, state);
  assert.equal(reports, 0);

  const { event } = climateButton({ homeClimateAction: 'open-report' });
  const handled = handleHomeClimateClick(event, {
    project,
    state,
    openSolarReport: () => { reports += 1; return Promise.resolve(null); },
  });
  assert.equal(handled, true);
  assert.equal(reports, 1);
});

test('повторная отрисовка переиспользует подробный световой расчёт', () => {
  const project = roomProject();
  const state = { solarAnalysis: { on: false, mode: 'direct' } };
  homeClimateHtml(project, state);
  const first = state._homeClimateUI.detail;
  const firstKey = state._homeClimateUI.detailKey;
  homeClimateHtml(project, state);
  assert.equal(state._homeClimateUI.detail, first);
  assert.equal(state._homeClimateUI.detailKey, firstKey);
});

test('световая карта переключает этаж, выбирает комнату и выключает конфликтующие слои', () => {
  const project = roomProject();
  const upper = {
    ...project.levels[0],
    id: 'L2', name: '2 этаж', elevation: 3000,
    rooms: [], openings: [], items: [], slabOpenings: [],
  };
  const room = createRoom('bedroom', 0, 0, 4000, 3500);
  room.id = 'bedroom-2';
  upper.rooms.push(room);
  project.levels.push(upper);
  const state = {
    solarAnalysis: { on: false, mode: 'direct', roomId: null },
    homeProgramOverlay: { on: true, result: {} },
    homeEngineeringOverlay: { on: true, result: {} },
    homeCirculationOverlay: { on: true, result: {} },
    siteOpportunity: { on: true, result: {} },
    _homeProgramUI: {}, _homeFlowsUI: {}, _homeEngineeringUI: {}, _homeCirculationUI: {},
    ergo: { on: true },
  };
  const calls = { level: [], focus: [], mode: [], analysis: [], close: 0, draw: 0 };
  const { event } = climateButton({
    homeClimateAction: 'toggle-map', homeClimateMap: 'daylight',
    homeClimateRoomId: 'bedroom-2', homeClimateLevelId: 'L2',
  });
  const handled = handleHomeClimateClick(event, {
    project,
    state,
    switchLevel: (id) => { calls.level.push(id); project.activeLevel = id; },
    focusSolarRoom: (id) => calls.focus.push(id),
    setSolarMode: (mode) => { calls.mode.push(mode); state.solarAnalysis.mode = mode; },
    setSolarAnalysis: (on, id) => {
      calls.analysis.push([on, id]);
      state.solarAnalysis.on = on;
      state.solarAnalysis.roomId = id;
    },
    closePanel: () => { calls.close += 1; },
    requestDraw: () => { calls.draw += 1; },
  });
  assert.equal(handled, true);
  assert.deepEqual(calls.level, ['L2']);
  assert.deepEqual(calls.focus, ['bedroom-2']);
  assert.deepEqual(calls.mode, ['daylight']);
  assert.deepEqual(calls.analysis, [[true, 'bedroom-2']]);
  assert.deepEqual(state.selection, { type: 'room', id: 'bedroom-2' });
  assert.equal(state.homeProgramOverlay.on, false);
  assert.equal(state.homeEngineeringOverlay.on, false);
  assert.equal(state.homeCirculationOverlay.on, false);
  assert.equal(state.siteOpportunity.on, false);
  assert.equal(state.ergo.on, false);
  assert.equal(calls.close, 1);
  assert.ok(calls.draw >= 1);
});

test('повторное нажатие скрывает уже открытую карту', () => {
  const project = roomProject();
  const state = {
    solarAnalysis: { on: true, mode: 'direct', roomId: 'living-1' },
  };
  const calls = [];
  const { event } = climateButton({
    homeClimateAction: 'toggle-map', homeClimateMap: 'direct',
    homeClimateRoomId: 'living-1', homeClimateLevelId: project.activeLevel,
  });
  assert.equal(handleHomeClimateClick(event, {
    project, state,
    setSolarAnalysis: (on, id) => calls.push([on, id]),
  }), true);
  assert.deepEqual(calls, [[false, 'living-1']]);
});

test('выбор комнаты и даты остаётся состоянием вида', () => {
  const project = roomProject();
  const state = { solarAnalysis: { on: false } };
  const roomInput = {
    value: `${project.activeLevel}:living-1`,
    hasAttribute: (name) => name === 'data-home-climate-room',
    closest: (selector) => (selector === '[data-home-climate]' ? {} : null),
  };
  const event = {
    target: {
      closest: (selector) => selector.includes('[data-home-climate-room]') ? roomInput : null,
    },
  };
  let focused = null;
  assert.equal(handleHomeClimateInput(event, {
    project, state, focusSolarRoom: (id) => { focused = id; },
  }), true);
  assert.equal(focused, 'living-1');
  assert.equal(state._homeClimateUI.roomId, 'living-1');

  const dateInput = {
    value: '2026-12-21',
    hasAttribute: (name) => name === 'data-home-climate-date',
    closest: (selector) => (selector === '[data-home-climate]' ? {} : null),
  };
  event.target.closest = (selector) => selector.includes('[data-home-climate-date]') ? dateInput : null;
  assert.equal(handleHomeClimateInput(event, { project, state, mutate: (change) => change() }), true);
  assert.equal(state.solarAnalysis.date, undefined);
  assert.equal(project.site.sun.date, '2026-12-21');
});

test('refresh обновляет только производную сводку', () => {
  const project = roomProject();
  const state = { solarAnalysis: { on: false } };
  const result = refreshHomeClimateView(project, state);
  assert.equal(result.room.roomId, 'living-1');
  assert.equal(state._homeClimateUI.overview.normative, false);
  assert.equal(state._homeClimateUI.detail.normative, false);
});
