import assert from 'node:assert/strict';
import test from 'node:test';

import { drawHomeCirculationOverlay } from '../ui/render-home-circulation.js';

function contextSpy() {
  const calls = [];
  return {
    calls,
    save() { calls.push(['save']); },
    restore() { calls.push(['restore']); },
    beginPath() { calls.push(['beginPath']); },
    closePath() { calls.push(['closePath']); },
    moveTo(x, y) { calls.push(['moveTo', x, y]); },
    lineTo(x, y) { calls.push(['lineTo', x, y]); },
    arc(x, y, r) { calls.push(['arc', x, y, r]); },
    fill() { calls.push(['fill']); },
    stroke() { calls.push(['stroke']); },
    setLineDash(value) { calls.push(['setLineDash', [...value]]); },
    fillText(value, x, y) { calls.push(['fillText', value, x, y]); },
  };
}

const tokens = {
  accent: '#1677ff', surface: '#fff', warn: '#ad6700', danger: '#c22',
};

test('выключенный и печатный слой очищают диагностику и ничего не рисуют', () => {
  const ctx = contextSpy();
  const state = {
    modeName: 'plan',
    project: { activeLevel: 'L1' },
    homeCirculationOverlay: { on: true, result: { levels: [] } },
    _homeCirculationUI: { active: true },
  };

  assert.equal(drawHomeCirculationOverlay(ctx, {
    st: state, p2s: (x, y) => ({ x, y }), tokens, print: true,
  }), null);
  assert.equal(state._homeCirculationUI, null);
  assert.deepEqual(ctx.calls, []);

  state.homeCirculationOverlay.on = false;
  state._homeCirculationUI = { active: true };
  assert.equal(drawHomeCirculationOverlay(ctx, {
    st: state, p2s: (x, y) => ({ x, y }), tokens,
  }), null);
  assert.equal(state._homeCirculationUI, null);
});

test('рисует только рассчитанные пути активного этажа без линий blocked и unknown', () => {
  const result = {
    levels: [
      {
        levelId: 'L1',
        routes: [
          {
            id: 'clear', status: 'clear', evidence: 'exact',
            points: [{ x: 0, y: 0 }, { x: 400, y: 250 }, { x: 900, y: 250 }],
            minWidthMm: 820,
            bottleneck: { x: 400, y: 250, minWidthMm: 820 },
          },
          {
            id: 'candidate', status: 'approximate', evidence: 'approximate',
            segments: [{ path: [{ x: 100, y: 600 }, { x: 700, y: 650 }] }],
            minWidthMm: 670,
            bottleneck: { x: 500, y: 640, clearanceMm: 670 },
          },
          {
            id: 'blocked', status: 'blocked',
            points: [{ x: 0, y: 1000 }, { x: 800, y: 1000 }],
            minWidthMm: 540,
            bottleneck: { x: 400, y: 1000, clearanceMm: 540 },
          },
          { id: 'unknown', status: 'unknown', points: [{ x: 0, y: 1200 }, { x: 800, y: 1200 }] },
        ],
      },
      {
        levelId: 'L2',
        routes: [{ id: 'other-floor', status: 'clear', points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] }],
      },
    ],
  };
  const state = {
    modeName: 'plan', project: { activeLevel: 'L1' },
    homeCirculationOverlay: {
      on: true, routes: true, heatmap: false, bottlenecks: true, result,
    },
  };
  const before = structuredClone(result);
  const ctx = contextSpy();

  const summary = drawHomeCirculationOverlay(ctx, {
    st: state, p2s: (x, y) => ({ x, y }), tokens,
  });

  assert.equal(summary.levelId, 'L1');
  assert.equal(summary.routeCount, 4);
  assert.equal(summary.drawnRouteCount, 2);
  assert.equal(summary.clearRouteCount, 1);
  assert.equal(summary.approximateRouteCount, 1);
  assert.equal(summary.blockedRouteCount, 1);
  assert.equal(summary.unknownRouteCount, 1);
  assert.equal(summary.bottleneckCount, 3);
  assert.deepEqual(summary.paths.map((path) => path.id), ['clear', 'candidate']);
  assert.ok(ctx.calls.some((call) => call[0] === 'setLineDash' && call[1].length > 0), 'приблизительный путь пунктирный');
  assert.equal(ctx.calls.filter((call) => call[0] === 'fillText').length, 3, 'подписаны только реальные bottleneck');
  assert.deepEqual(result, before, 'renderer не мутирует результат core');
});

test('теплокарта частоты использует только выбранный период и typed arrays', () => {
  const heat = {
    x0: 100, y0: 200, cols: 2, rows: 2, cell: 50,
    routeCount: new Uint16Array([1, 8, 2, 9]),
    frequencyByPeriod: {
      day: new Float32Array([3, 0, 5, 0]),
      week: new Float32Array([100, 100, 100, 100]),
    },
  };
  const state = {
    modeName: 'plan', project: { activeLevel: 'L1' },
    homeCirculationOverlay: {
      on: true, routes: false, heatmap: true, metric: 'frequency', period: 'day',
      result: { levels: [{ levelId: 'L1', routes: [], heat }] },
    },
  };
  const ctx = contextSpy();
  let projected = 0;

  const summary = drawHomeCirculationOverlay(ctx, {
    st: state,
    p2s: (x, y) => { projected += 1; return { x: x * 2, y: y * 2 }; },
    tokens,
  });

  assert.equal(summary.metric, 'frequency');
  assert.equal(summary.period, 'day');
  assert.equal(summary.heatCellCount, 2);
  assert.equal(summary.heatSourceCellCount, 2);
  assert.equal(summary.heatMax, 5, 'недельные значения не попали в максимум дня');
  assert.equal(projected, 8, 'каждая ячейка преобразована четырьмя углами через p2s');
  assert.equal(ctx.calls.filter((call) => call[0] === 'fill').length, 2);
  assert.equal(summary.drawnRouteCount, 0);
});

test('без выбранного периода frequency-слой не подменяется числом маршрутов', () => {
  const state = {
    modeName: 'plan', project: { activeLevel: 'L1' },
    homeCirculationOverlay: {
      on: true, routes: false, heatmap: true, metric: 'frequency', period: null,
      result: {
        levels: [{
          levelId: 'L1', routes: [],
          heat: { cells: [{ x: 0, y: 0, w: 50, h: 50, routeCount: 9, frequencyByPeriod: { day: 4 } }] },
        }],
      },
    },
  };
  const ctx = contextSpy();

  const summary = drawHomeCirculationOverlay(ctx, {
    st: state, p2s: (x, y) => ({ x, y }), tokens,
  });

  assert.equal(summary.metric, 'frequency');
  assert.equal(summary.period, null);
  assert.equal(summary.heatCellCount, 0);
  assert.equal(summary.heatMax, 0);
  assert.equal(ctx.calls.filter((call) => call[0] === 'fill').length, 0);
});

test('узкие места можно показать отдельно от линий маршрутов', () => {
  const state = {
    modeName: 'plan', project: { activeLevel: 'L1' },
    homeCirculationOverlay: {
      on: true, routes: false, heatmap: false, bottlenecks: true,
      result: {
        levels: [{
          levelId: 'L1',
          routes: [{
            id: 'narrow-only', status: 'narrow',
            points: [{ x: 0, y: 0 }, { x: 500, y: 0 }],
            bottleneck: { x: 250, y: 0, clearanceMm: 650 },
          }],
        }],
      },
    },
  };
  const ctx = contextSpy();
  const summary = drawHomeCirculationOverlay(ctx, {
    st: state, p2s: (x, y) => ({ x, y }), tokens,
  });

  assert.equal(summary.drawnRouteCount, 0);
  assert.equal(summary.bottleneckCount, 1);
  assert.equal(ctx.calls.filter((call) => call[0] === 'lineTo').length, 0);
  assert.ok(ctx.calls.some((call) => call[0] === 'fillText' && call[1] === '650 мм'));
});

test('core heat cells используют локальный cell и координату центра', () => {
  const state = {
    modeName: 'plan', project: { activeLevel: 'L1' },
    homeCirculationOverlay: {
      on: true, routes: false, heatmap: true, metric: 'route_count',
      result: {
        levels: [{
          levelId: 'L1', routes: [],
          heat: { cells: [{ x: 125, y: 225, cell: 50, routeCount: 2, approximateRouteCount: 1, frequencyByPeriod: {} }] },
        }],
      },
    },
  };
  const ctx = contextSpy();

  const summary = drawHomeCirculationOverlay(ctx, {
    st: state, p2s: (x, y) => ({ x, y }), tokens,
  });

  assert.equal(summary.heatCellCount, 1);
  assert.deepEqual(ctx.calls.find((call) => call[0] === 'moveTo').slice(1), [100, 200]);
  assert.deepEqual(ctx.calls.filter((call) => call[0] === 'lineTo').map((call) => call.slice(1)), [
    [150, 200], [150, 250], [100, 250],
  ]);
});
