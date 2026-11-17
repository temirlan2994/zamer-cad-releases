import test from 'node:test';
import assert from 'node:assert/strict';

import { createItem, createProject, createRoom } from '../core/model.js';
import { deriveWalls } from '../core/walls.js';

const previousDocument = globalThis.document;
globalThis.document = { getElementById: () => ({ getContext: () => ({}) }) };
const {
  handleHomeReviewClick, homeReviewHtml,
} = await import('../ui/home-review.js');
if (previousDocument === undefined) delete globalThis.document;
else globalThis.document = previousDocument;

function click(button) {
  return { target: { closest: (selector) => (selector === '[data-home-review-action]' ? button : null) } };
}

test('пустой проект не получает зелёный итог и не показывает общий балл', () => {
  const html = homeReviewHtml(createProject('Пустой проект'));
  assert.match(html, /data-home-review/);
  assert.match(html, /Недостаточно данных|Требует внимания|Есть препятствие/);
  assert.doesNotMatch(html, /\d+\s*%|балл/i);
  assert.match(html, /не экспертиза/i);
});

test('скрытое замечание явно не считается исправленным', () => {
  const project = createProject('Скрытое');
  project.levels[0].rooms.push(createRoom('living', 0, 0, 4000, 3500));
  project.settings = { ...(project.settings || {}), dismissedIssues: ['access:L1:entrance'] };
  const html = homeReviewHtml(project);
  assert.match(html, /Скрытые пользователем/);
  assert.match(html, /не исправлено/);
});

test('итоговая проверка включает эргономические находки независимо от фильтра замечаний', () => {
  const project = createProject('Эргономика');
  project.levels[0].rooms.push(createRoom('bedroom', 0, 0, 2100, 4000));
  project.levels[0].items.push(createItem('bed-double', 800, 1000, 1600, 2000));
  const html = homeReviewHtml(project, {
    walls: deriveWalls(project), gaps: [], norms: null,
    issues: { groups: [], hidden: [] },
  });
  assert.match(html, /500 мм|проход|кроват/i);
});

test('кнопка этапа передаёт точный id представления', () => {
  const calls = [];
  const button = { dataset: { homeReviewAction: 'open-stage', homeReviewView: 'climate' } };
  const handled = handleHomeReviewClick(click(button), {
    openHomeView: (view) => calls.push(view),
  });
  assert.equal(handled, true);
  assert.deepEqual(calls, ['climate']);
});

test('этап участка возвращает в маршрут исходных данных', () => {
  let calls = 0;
  const button = { dataset: { homeReviewAction: 'open-stage', homeReviewView: 'site' } };
  assert.equal(handleHomeReviewClick(click(button), {
    openSiteStage: () => { calls += 1; },
  }), true);
  assert.equal(calls, 1);
});

test('замечание передаётся существующему переходу на план', () => {
  const issue = { id: 'wall-1', levelId: 'L1', target: { type: 'room', id: 'R1' }, focus: { x: 0, y: 0, w: 10, h: 10 } };
  const review = { provenProblems: [{ id: 'problem-1', issue }] };
  const calls = [];
  const button = {
    dataset: {
      homeReviewAction: 'show-issue', homeReviewKind: 'problem', homeReviewItemId: 'problem-1',
    },
  };
  const handled = handleHomeReviewClick(click(button), {
    review,
    closePanel: (options) => calls.push(['close', options]),
    goToIssue: (entry) => calls.push(['go', entry]),
  });
  assert.equal(handled, true);
  assert.equal(calls[0][0], 'close');
  assert.deepEqual(calls[1], ['go', issue]);
});

test('неизвестная команда не перехватывается', () => {
  const button = { dataset: { homeReviewAction: 'other' } };
  assert.equal(handleHomeReviewClick(click(button)), false);
});
