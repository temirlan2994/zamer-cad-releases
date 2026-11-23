import test from 'node:test';
import assert from 'node:assert/strict';
import {
  floorAnalyticalViewById,
  floorAnalyticalViewId,
  floorAnalyticalViews,
  parseFloorAnalyticalViewId,
} from '../core/analytical-views.js';

const project = {
  levels: [
    { id: 'L1', name: '1 этаж' },
    { id: 'level:2', name: '2 этаж' },
  ],
};

test('каждый тип аналитики получает самостоятельный вид на каждом этаже', () => {
  const views = floorAnalyticalViews(project);
  assert.equal(views.length, 10);
  assert.deepEqual(views.filter((view) => view.analysis === 'light').map((view) => view.title), [
    'Освещение · 1 этаж', 'Освещение · 2 этаж',
  ]);
  assert.deepEqual(views.filter((view) => view.levelId === 'L1').map((view) => view.analysis), [
    'layout', 'ergonomics', 'circulation', 'light', 'engineering',
  ]);
});

test('id сохраняет произвольный id этажа и разбирается обратно', () => {
  const id = floorAnalyticalViewId('light', 'level:2');
  assert.equal(id, 'analysis:light:level%3A2');
  assert.deepEqual(parseFloorAnalyticalViewId(id), { analysis: 'light', levelId: 'level:2' });
  assert.equal(floorAnalyticalViewById(project, id)?.title, 'Освещение · 2 этаж');
  assert.equal(parseFloorAnalyticalViewId('analysis:unknown:L1'), null);
});

test('вид удалённого этажа не остаётся доступным', () => {
  const id = floorAnalyticalViewId('ergonomics', 'L1');
  assert.ok(floorAnalyticalViewById(project, id));
  assert.equal(floorAnalyticalViewById({ levels: project.levels.slice(1) }, id), null);
});
