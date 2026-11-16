import assert from 'node:assert/strict';
import test from 'node:test';

import { drawHomeEngineeringOverlay } from '../ui/render-home-engineering.js';
import { drawHomeFlowsOverlay } from '../ui/render-home-flows.js';

function room(id, x, y, w = 2000, h = 1800) {
  return { id, type: 'living', name: id, x, y, w, h };
}

function contextSpy() {
  const calls = [];
  const ctx = {
    calls,
    save() { calls.push('save'); },
    restore() { calls.push('restore'); },
    beginPath() { calls.push('beginPath'); },
    closePath() { calls.push('closePath'); },
    moveTo() { calls.push('moveTo'); },
    lineTo() { calls.push('lineTo'); },
    arc() { calls.push('arc'); },
    fill() { calls.push('fill'); },
    stroke() { calls.push('stroke'); },
    clip() { calls.push('clip'); },
    setLineDash() { calls.push('setLineDash'); },
    fillText() { calls.push('fillText'); },
  };
  return ctx;
}

const p2s = (x, y) => ({ x: Number(x), y: Number(y) });
const tokens = {
  accent: '#1677ff', surface: '#fff', warn: '#ad6700', danger: '#c22',
};

test('слой зон не рисуется в печати и очищает прежнюю диагностику', () => {
  const project = { activeLevel: 'L1', rooms: [room('r1', 0, 0)] };
  const state = {
    modeName: 'plan',
    project,
    homeProgramOverlay: {
      on: true,
      zones: true,
      routes: true,
      result: { zones: { rooms: [{ levelId: 'L1', roomId: 'r1', zoneId: 'living' }] } },
    },
    _homeFlowsUI: { active: true },
    _homeProgramUI: { active: true },
  };
  const ctx = contextSpy();

  const summary = drawHomeFlowsOverlay(ctx, {
    st: state, p2s, tokens, print: true,
  });

  assert.equal(summary, null);
  assert.equal(state._homeFlowsUI, null);
  assert.equal(state._homeProgramUI, null);
  assert.deepEqual(ctx.calls, []);
});

test('зоны и маршруты ограничены активным этажом, unknown-линия не придумывается', () => {
  const r1 = room('r1', 0, 0);
  const r2 = room('r2', 2600, 0);
  const project = { activeLevel: 'L1', rooms: [r1, r2] };
  const result = {
    zones: {
      rooms: [
        { levelId: 'L1', roomId: 'r1', zoneId: 'living' },
        { levelId: 'L1', roomId: 'r2', zoneId: 'wet' },
        { levelId: 'L2', roomId: 'r3', zoneId: 'utility' },
      ],
    },
    functionalRoutes: [
      {
        id: 'functional-ok', status: 'direct', acceptable: true, levelId: 'L1',
        pathRoomKeys: ['L1:r1', 'L1:r2'],
      },
      {
        id: 'functional-other-floor', status: 'direct', acceptable: true, levelId: 'L2',
        pathRoomKeys: ['L2:r3', 'L2:r4'],
      },
    ],
    scenarios: [{
      scenarioId: 'SCN001', title: 'Сценарий', mandatory: true,
      routes: [{
        id: 'scenario-unknown', routeId: 'route-1', status: 'unknown',
        levelId: 'L1', fromRoomKey: 'L1:r1', toRoomKey: 'L1:r2', pathRoomKeys: [],
      }],
    }],
  };
  const state = {
    modeName: 'plan',
    project,
    homeProgramOverlay: {
      on: true, mode: 'flows', zones: true, routes: true,
      problemsOnly: false, result,
    },
  };
  const beforeProject = structuredClone(project);
  const beforeResult = structuredClone(result);
  const ctx = contextSpy();

  const summary = drawHomeFlowsOverlay(ctx, { st: state, p2s, tokens });

  assert.equal(summary.levelId, 'L1');
  assert.equal(summary.drawnZoneCount, 2);
  assert.deepEqual(summary.zoneCounts, { living: 1, wet: 1 });
  assert.equal(summary.routeCounts.total, 3);
  assert.equal(summary.routeCounts.eligible, 1);
  assert.equal(summary.routeCounts.drawn, 1);
  assert.equal(summary.routeCounts.unknown, 1);
  assert.equal(summary.transitionCount, 1);
  assert.deepEqual(summary.paths[0].roomKeys, ['L1:r1', 'L1:r2']);
  assert.ok(ctx.calls.includes('stroke'));
  assert.deepEqual(project, beforeProject, 'renderer не меняет проект');
  assert.deepEqual(result, beforeResult, 'renderer не меняет результат анализа');
});

test('слой программы не смешивает функциональные связи со сценарными маршрутами', () => {
  const r1 = room('r1', 0, 0);
  const r2 = room('r2', 2600, 0);
  const r3 = room('r3', 5200, 0);
  const project = { activeLevel: 'L1', rooms: [r1, r2, r3] };
  const result = {
    functionalRoutes: [{
      id: 'functional-only', status: 'direct', acceptable: true, levelId: 'L1',
      pathRoomKeys: ['L1:r1', 'L1:r2'],
    }],
    scenarios: [{
      scenarioId: 'SCN001', title: 'Активный сценарий',
      routes: [{
        id: 'scenario-must-stay-hidden', status: 'direct', levelId: 'L1',
        pathRoomKeys: ['L1:r2', 'L1:r3'],
      }],
    }],
  };
  const state = {
    modeName: 'plan',
    project,
    homeProgramOverlay: {
      on: true, mode: 'program', zones: false, routes: true, result,
    },
  };

  const summary = drawHomeFlowsOverlay(contextSpy(), { st: state, p2s, tokens });

  assert.equal(summary.routeCounts.total, 1);
  assert.equal(summary.routeCounts.functional, 1);
  assert.equal(summary.routeCounts.scenario, 0);
  assert.equal(summary.transitionCount, 1);
  assert.deepEqual(summary.paths.map((path) => path.id), ['functional-only']);
  assert.equal(state._homeProgramUI.eligibleConnectionCount, 1);
  assert.equal(state._homeProgramUI.drawnConnectionCount, 1);
});

test('инженерный слой показывает только активный этаж, точки и кандидаты без трасс', () => {
  const r1 = room('r1', 0, 0);
  const r2 = room('r2', 2600, 0);
  const project = { activeLevel: 'L1', rooms: [r1, r2] };
  const result = {
    rooms: [
      {
        levelId: 'L1', roomId: 'r1',
        systems: [{ id: 'water' }, { id: 'drain' }, { id: 'extract' }],
      },
      { levelId: 'L1', roomId: 'r2', systems: [{ id: 'supply' }] },
      { levelId: 'L2', roomId: 'r3', systems: [{ id: 'water' }] },
    ],
    points: {
      records: [
        { id: 'p-fact', levelId: 'L1', roomId: 'r1', kind: 'cold_water', x: 900, y: 900, status: 'fact' },
        { id: 'p-conflict', levelId: 'L1', roomId: 'r2', kind: 'drain', x: 3200, y: 900, status: 'conflict' },
        { id: 'p-other-floor', levelId: 'L2', roomId: 'r3', kind: 'vent_supply', x: 100, y: 100, status: 'fact' },
      ],
    },
    candidates: {
      sameLevel: [{
        id: 'same', levelIds: ['L1'], roomKeys: ['L1:r1', 'L1:r2'], status: 'candidate',
      }],
      vertical: [{
        id: 'vertical', levelIds: ['L1', 'L2'], roomKeys: ['L1:r1', 'L2:r3'], status: 'candidate',
      }],
      shafts: [],
    },
  };
  const state = {
    modeName: 'plan', project,
    homeEngineeringOverlay: { on: true, result },
  };
  const beforeProject = structuredClone(project);
  const beforeResult = structuredClone(result);
  const ctx = contextSpy();

  const summary = drawHomeEngineeringOverlay(ctx, { st: state, p2s, tokens });

  assert.equal(summary.levelId, 'L1');
  assert.equal(summary.roomNeedCount, 2);
  assert.equal(summary.wetRoomCount, 1);
  assert.equal(summary.extractRoomCount, 1);
  assert.equal(summary.supplyRoomCount, 1);
  assert.equal(summary.explicitPointCount, 2);
  assert.equal(summary.conflictCount, 1);
  assert.equal(summary.candidateLinkCount, 1);
  assert.equal(summary.verticalCandidateCount, 1);
  assert.ok(ctx.calls.includes('setLineDash'), 'кандидат показан пунктиром');
  assert.ok(ctx.calls.includes('fillText'), 'явные точки имеют символ');
  assert.deepEqual(project, beforeProject, 'renderer не меняет проект');
  assert.deepEqual(result, beforeResult, 'renderer не меняет результат анализа');
});

test('выключенный инженерный слой ничего не рисует', () => {
  const state = {
    modeName: 'plan',
    project: { activeLevel: 'L1', rooms: [room('r1', 0, 0)] },
    homeEngineeringOverlay: { on: false, result: { rooms: [] } },
    _homeEngineeringUI: { active: true },
  };
  const ctx = contextSpy();

  assert.equal(drawHomeEngineeringOverlay(ctx, { st: state, p2s, tokens }), null);
  assert.equal(state._homeEngineeringUI, null);
  assert.deepEqual(ctx.calls, []);
});
