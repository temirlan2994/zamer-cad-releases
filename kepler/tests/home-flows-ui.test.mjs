import test from 'node:test';
import assert from 'node:assert/strict';

import { createProject, createRoom } from '../core/model.js';

globalThis.document = {
  getElementById: () => ({ getContext: () => ({}) }),
};
const { handleHomeFlowsClick, homeFlowsHtml } = await import('../ui/home-flows.js');

test('включение слоя потоков сразу обновляет легенду интерфейса', () => {
  const project = createProject('Маршруты');
  project.levels[0].rooms.push(createRoom('living', 0, 0, 4000, 4000));
  const state = {
    homeProgramOverlay: { on: false },
    homeEngineeringOverlay: { on: true },
    _homeEngineeringUI: { active: true },
  };
  const calls = { close: 0, draw: 0, rerender: 0 };
  const button = {
    dataset: { homeFlowsAction: 'toggle-overlay' },
    closest: (selector) => (selector === '[data-home-flows]' ? {} : null),
  };
  const event = {
    target: {
      closest: (selector) => (selector === '[data-home-flows-action]' ? button : null),
    },
  };

  const handled = handleHomeFlowsClick(event, {
    project,
    state,
    closePanel: () => { calls.close += 1; },
    requestDraw: () => { calls.draw += 1; },
    rerender: () => { calls.rerender += 1; },
  });

  assert.equal(handled, true);
  assert.equal(state.homeProgramOverlay.on, true);
  assert.equal(state.homeProgramOverlay.mode, 'flows');
  assert.equal(state.homeEngineeringOverlay.on, false);
  assert.deepEqual(calls, { close: 1, draw: 1, rerender: 1 });
});

test('редактор показывает все экземпляры маршрута с отдельными статусами и русскими подписями', () => {
  const project = createProject('Экземпляры');
  const entry = createRoom('entrance', 0, 0, 3000, 3000);
  entry.id = 'entry';
  const living = createRoom('living', 3100, 0, 3000, 3000);
  living.id = 'living';
  project.levels[0].rooms.push(entry, living);
  project.layoutBrief = {
    scenarioSelections: [{
      scenarioId: 'SCN001', enabled: true, mandatory: false,
      actorPersonIds: [], frequencyValue: null, frequencyPeriod: null,
    }],
    scenarioRouteBindings: [
      {
        scenarioId: 'SCN001', routeId: 'entry_to_seat', instanceId: 'seat-a',
        from: { levelId: 'L1', roomId: 'entry' },
        to: { levelId: 'L1', roomId: 'entry' },
      },
      {
        scenarioId: 'SCN001', routeId: 'entry_to_seat', instanceId: 'seat-b',
        from: { levelId: 'L1', roomId: 'entry' },
        to: { levelId: 'L1', roomId: 'living' },
      },
      {
        scenarioId: 'SCN001', routeId: 'entry_to_clean', instanceId: 'clean-a',
        from: { levelId: 'L1', roomId: 'entry' },
        to: { levelId: 'L1', roomId: 'living' },
      },
    ],
  };

  const html = homeFlowsHtml(project, {});
  const statusBefore = (instanceId) => {
    const end = html.indexOf(`data-instance-id="${instanceId}"`);
    const start = html.lastIndexOf('<div class="home-flow-binding"', end);
    return html.slice(start, end).match(/data-status="([^"]+)"/)?.[1] || null;
  };
  assert.equal(statusBefore('seat-a'), 'co_located');
  assert.equal(statusBefore('seat-b'), 'missing');
  assert.equal(statusBefore('clean-a'), 'missing');
  assert.doesNotMatch(html, /data-instance-id="default"/);
  assert.match(html, /вход → место у входа · вариант 1/);
  assert.doesNotMatch(html, />entry → entry_seat</);
});

test('сводка показывает реальные группы зон и ошибку программы без сценария', () => {
  const project = createProject('Сводка');
  project.levels[0].rooms.push(
    createRoom('entrance', 0, 0, 3000, 3000),
    createRoom('living', 3100, 0, 3000, 3000),
  );
  project.layoutBrief = {
    homeProgram: {
      confirmed: true, socialMode: 'combined', bedroomCount: 1, bathroomCount: 1,
      options: {
        guestBedroom: false, office: false, laundry: false, pantry: false,
        wardrobe: false, guestWc: false, garage: false, terrace: false,
      },
    },
  };

  const html = homeFlowsHtml(project, {});
  assert.match(html, /<dt>Зон<\/dt><dd>2<\/dd>/);
  assert.match(html, /обязательных связей программы не подтверждено/);
});

test('переключатель зон очищает прежний слой программы без задержки', () => {
  const project = createProject('Программа');
  const state = {
    homeProgramOverlay: {
      on: true,
      mode: 'program',
      result: { functionalRoutes: [{ status: 'direct' }] },
    },
  };
  const calls = { draw: 0, rerender: 0 };
  const button = {
    dataset: { homeFlowsAction: 'toggle-zones' },
    closest: (selector) => (selector === '[data-home-flows]' ? {} : null),
  };
  const event = {
    target: {
      closest: (selector) => (selector === '[data-home-flows-action]' ? button : null),
    },
  };

  const handled = handleHomeFlowsClick(event, {
    project,
    state,
    requestDraw: () => { calls.draw += 1; },
    rerender: () => { calls.rerender += 1; },
  });

  assert.equal(handled, true);
  assert.equal(state.homeProgramOverlay.on, false);
  assert.equal(state.homeProgramOverlay.mode, 'flows');
  assert.deepEqual(calls, { draw: 1, rerender: 1 });
});
