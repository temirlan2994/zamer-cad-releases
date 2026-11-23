import test from 'node:test';
import assert from 'node:assert/strict';

import { createItem, createProject, createRoom } from '../core/model.js';
import { normsReport } from '../core/norms.js';
import { deriveWalls } from '../core/walls.js';

const previousDocument = globalThis.document;
globalThis.document = { getElementById: () => ({ getContext: () => ({}) }) };
const {
  handleHomeReviewClick, homeReviewHtml, homeReviewReport,
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

test('итоговая сводка не принимает частичный снимок норм за полный', () => {
  const project = createProject('Частичный снимок');
  const room = createRoom('living', 0, 0, 3000, 3000);
  project.rooms.push(room);
  const partial = normsReport(project, { enabled: ['geometry'] });
  assert.equal(partial.problems.some((problem) => problem.kind === 'area'), false);

  const review = homeReviewReport(project, {
    norms: partial, walls: deriveWalls(project), gaps: [],
  });
  assert.ok(review.provenProblems.some((problem) => problem.sourceId === `area:${project.activeLevel}:${room.id}`));
  assert.ok(review.provenProblems.some((problem) => problem.sourceId === `light:${project.activeLevel}:${room.id}`));
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

test('этапы объёма и выпуска доступны из общей проверки', () => {
  const calls = [];
  for (const view of ['envelope', 'deliverables']) {
    const button = { dataset: { homeReviewAction: 'open-stage', homeReviewView: view } };
    assert.equal(handleHomeReviewClick(click(button), {
      openHomeView: (id) => calls.push(id),
    }), true);
  }
  assert.deepEqual(calls, ['envelope', 'deliverables']);
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

test('связанный лист имеет приоритет над видом, а вид — над объектом плана', () => {
  const calls = [];
  const sheet = {
    id: 'sheet-finding', action: 'open-sheets', sheetId: 'A-01', viewId: '3d',
    target: { type: 'room', id: 'R1' },
  };
  const view = {
    id: 'view-finding', viewId: 'elev-N', target: { type: 'room', id: 'R2' },
  };
  const review = { unknowns: [sheet, view] };
  assert.equal(handleHomeReviewClick(click({
    dataset: {
      homeReviewAction: 'open-finding-sheets', homeReviewKind: 'unknown', homeReviewItemId: sheet.id,
    },
  }), {
    review,
    closePanel: () => calls.push('close-sheet'),
    openSheets: (id) => calls.push(['sheet', id]),
  }), true);
  assert.equal(handleHomeReviewClick(click({
    dataset: {
      homeReviewAction: 'open-finding-view', homeReviewKind: 'unknown', homeReviewItemId: view.id,
    },
  }), {
    review,
    closePanel: () => calls.push('close-view'),
    openView: (id) => calls.push(['view', id]),
  }), true);
  assert.deepEqual(calls, [
    'close-sheet', ['sheet', 'A-01'], 'close-view', ['view', 'elev-N'],
  ]);
});

test('неизвестная команда не перехватывается', () => {
  const button = { dataset: { homeReviewAction: 'other' } };
  assert.equal(handleHomeReviewClick(click(button)), false);
});
