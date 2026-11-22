import test from 'node:test';
import assert from 'node:assert/strict';

import { analyzeHomeReview } from '../core/home-review.js';
import { collectIssues } from '../core/issues.js';
import { createProject, createRoom } from '../core/model.js';

function stubOptions(overrides = {}) {
  return {
    program: { status: 'unknown', unresolvedFields: [], targets: [], summary: {} },
    flows: { status: 'unknown', scenarios: [], summary: {} },
    engineering: { status: 'unknown', conflicts: [], summary: {} },
    circulation: { status: 'unknown', routes: [], summary: {} },
    climate: {
      status: 'unknown', rooms: [], summary: { roomCount: 0 },
      sources: {
        solar: { status: 'missing' }, climate: { status: 'missing' },
        envelope: { status: 'missing' }, ventilation: { status: 'unknown' },
      },
    },
    envelope: {
      status: 'unknown', conflicts: [], unknowns: [], facts: [], summary: {},
    },
    deliverables: {
      status: 'missing', checks: [], warnings: [], summary: {},
    },
    readiness: { sections: [] },
    issues: { groups: [], hidden: [] },
    ...overrides,
  };
}

test('пустой проект остаётся неизвестным и не получает общий балл', () => {
  const result = analyzeHomeReview(createProject('Пустой'));
  assert.equal(result.schema, 'kepler-home-review/1');
  assert.equal(result.preliminary, true);
  assert.equal(result.normative, false);
  assert.equal(result.status, 'unknown');
  assert.equal('score' in result, false);
  assert.equal('percent' in result, false);
  assert.deepEqual(result.stages.map((stage) => stage.id), [
    'site', 'program', 'flows', 'engineering', 'circulation', 'climate',
    'envelope', 'deliverables',
  ]);
  assert.ok(result.stages.every((stage) => stage.status !== 'checked'));
  assert.ok(result.unknowns.length > 0);
});

test('скрытое замечание остаётся отдельным и не считается исправленным', () => {
  const project = createProject('Скрытие');
  project.rooms.push(
    createRoom('living', 0, 0, 5000, 4000),
    createRoom('kitchen', 4000, 1000, 3000, 3000),
  );
  const overlap = collectIssues(project).groups.flatMap((group) => group.items)
    .find((issue) => issue.id.startsWith('overlap:'));
  assert.ok(overlap);
  project.settings.dismissedIssues = [overlap.id];

  const result = analyzeHomeReview(project);
  const hidden = result.hidden.find((item) => item.sourceId === overlap.id);
  assert.ok(hidden);
  assert.match(hidden.text, /не означает, что оно исправлено/i);
  assert.equal(result.provenProblems.some((item) => item.sourceId === overlap.id), false);
  assert.equal(result.counts.hidden, result.hidden.length);
});

test('живое замечание сохраняет стабильный id и статус внимания', () => {
  const project = createProject('Замечание');
  const room = createRoom('living', 0, 0, 3000, 3000);
  project.rooms.push(room);
  const issue = collectIssues(project).groups.flatMap((group) => group.items)
    .find((item) => item.severity === 'warn' && item.group !== 'insolation');
  assert.ok(issue);

  const result = analyzeHomeReview(project);
  const problem = result.provenProblems.find((item) => item.sourceId === issue.id);
  assert.ok(problem);
  assert.equal(problem.severity, 'warning');
  assert.equal(problem.target?.id || null, issue.target?.id || null);
  assert.equal(result.counts.provenProblems, result.provenProblems.length);
});

test('инженерный candidate остаётся неизвестным, а не проверенным', () => {
  const project = createProject('Кандидат');
  const options = stubOptions({
    engineering: {
      status: 'candidate', conflicts: [],
      summary: { verifiedPointCount: 0, candidateCount: 2 },
    },
  });
  const result = analyzeHomeReview(project, options);
  const stage = result.stages.find((item) => item.id === 'engineering');
  assert.equal(stage.status, 'unknown');
  assert.ok(result.unknowns.some((item) => item.id === 'engineering:candidate'));
  assert.equal(result.checkedFacts.some((item) => item.stageId === 'engineering'), false);
});

test('неподтверждённые координаты не дают зелёный этап света', () => {
  const project = createProject('Солнце');
  project.rooms.push(createRoom('living', 0, 0, 5000, 4000));
  assert.equal(project.site.solarVerified, false);
  const result = analyzeHomeReview(project);
  const stage = result.stages.find((item) => item.id === 'climate');
  assert.equal(stage.status, 'unknown');
  assert.ok(result.unknowns.some((item) => item.id === 'climate:solar-strong-gate'));
  assert.equal(result.checkedFacts.some((item) => item.id === 'climate:solar-source'), false);
});

test('проверенные факты появляются только из явных известных результатов', () => {
  const project = createProject('Известные факты');
  project.site.solarVerified = true;
  const result = analyzeHomeReview(project, stubOptions({
    program: {
      status: 'ready', unresolvedFields: [], targets: [],
      summary: { text: 'Программа подтверждена.' },
    },
    flows: { status: 'ready', scenarios: [], summary: { resolvedRouteCount: 3 } },
    engineering: {
      status: 'fact', conflicts: [], summary: { verifiedPointCount: 2 },
    },
    circulation: {
      status: 'clear', routes: [{ id: 'r1', status: 'clear' }], summary: { clear: 1 },
    },
    climate: {
      status: 'candidate',
      rooms: [{ key: 'L1:R1' }], summary: { roomCount: 1, windowlessRoomCount: 0 },
      sources: {
        solar: { status: 'verified' }, climate: { status: 'provided' },
        envelope: { status: 'provided' }, ventilation: { status: 'fact' },
      },
    },
  }));

  assert.ok(result.checkedFacts.some((item) => item.id === 'program:ready'));
  assert.ok(result.checkedFacts.some((item) => item.id === 'flows:ready'));
  assert.ok(result.checkedFacts.some((item) => item.id === 'engineering:fixed-points'));
  assert.ok(result.checkedFacts.some((item) => item.id === 'circulation:clear'));
  assert.ok(result.checkedFacts.some((item) => item.id === 'climate:solar-source'));
  assert.equal(result.unknowns.some((item) => item.id === 'engineering:candidate'), false);
  assert.equal(result.counts.checkedFacts, result.checkedFacts.length);
});

test('конфликты оболочки входят в итоговую проверку и сохраняют переход к объекту', () => {
  const project = createProject('Конфликт оболочки');
  const result = analyzeHomeReview(project, stubOptions({
    envelope: {
      status: 'conflict',
      conflicts: [{
        id: 'roof:invalid:r1', area: 'roof', title: 'Крыша 1',
        text: 'Крыша ссылается на отсутствующий этаж.',
        roofId: 'r1', levelId: 'deleted-level',
      }],
      unknowns: [],
      facts: [],
      summary: { conflictCount: 1 },
    },
  }));

  const stage = result.stages.find((item) => item.id === 'envelope');
  const conflict = result.provenProblems.find((item) => item.sourceId === 'roof:invalid:r1');
  assert.equal(stage.status, 'blocked');
  assert.equal(stage.problemCount, 1);
  assert.equal(result.status, 'blocked');
  assert.deepEqual(conflict.target, { type: 'roof', id: 'r1' });
  assert.equal(conflict.viewId, 'roofplan');
  assert.equal(conflict.levelId, 'deleted-level');
  assert.equal(conflict.severity, 'error');
});

test('факты объёма не превращают концепцию в нормативно проверенный этап', () => {
  const project = createProject('Объём');
  const result = analyzeHomeReview(project, stubOptions({
    envelope: {
      status: 'candidate', conflicts: [], unknowns: [],
      facts: [{
        id: 'envelope:levels', area: 'levels', title: 'Этажи и площади',
        text: 'Этажей с замкнутым пятном: 1.',
      }],
      summary: { factCount: 1 },
    },
  }));

  const stage = result.stages.find((item) => item.id === 'envelope');
  assert.equal(stage.status, 'attention');
  assert.match(stage.summary, /не рассчитаны/i);
  assert.equal(stage.factCount, 1);
  assert.ok(result.checkedFacts.some((item) => item.sourceId === 'envelope:levels'));
  assert.notEqual(result.status, 'checked');
});

test('комплект выдачи добавляет факты, пробелы и переход к доступному виду', () => {
  const project = createProject('Выдача');
  const result = analyzeHomeReview(project, stubOptions({
    deliverables: {
      status: 'partial',
      checks: [
        {
          id: 'plans', title: 'Планы', status: 'ready',
          summary: 'Содержимое есть на одном плане.', viewIds: ['plan:L1'],
        },
        {
          id: 'sections', title: 'Разрезы', status: 'missing',
          summary: 'Ни одного разреза не создано.', viewIds: [],
        },
      ],
      sheets: {
        user: {
          items: [{
            id: 'sheet-1', title: 'Лист 1', status: 'partial',
            emptyViewIds: ['3d'], invalidViewIds: [],
          }],
        },
      },
      warnings: ['На пользовательском листе есть пустой вид.'],
      summary: { ready: 1, missing: 1, total: 2 },
    },
  }));

  const stage = result.stages.find((item) => item.id === 'deliverables');
  const plan = result.checkedFacts.find((item) => item.sourceId === 'plans');
  const sections = result.unknowns.find((item) => item.sourceId === 'sections');
  assert.equal(stage.status, 'attention');
  assert.equal(stage.factCount, 1);
  assert.equal(stage.unknownCount, 3);
  assert.equal(plan.viewId, 'plan:L1');
  assert.deepEqual(plan.viewIds, ['plan:L1']);
  assert.match(sections.text, /разреза/i);
  assert.equal(result.unknowns.find((item) => item.sheetId === 'sheet-1')?.viewId, '3d');
  assert.equal(result.unknowns.find((item) => item.sheetId === 'sheet-1')?.action, 'open-sheets');
  assert.ok(result.unknowns.some((item) => item.id === 'deliverables:warning:1'));
});

test('полностью собранный концептуальный комплект остаётся вниманием, а не pass', () => {
  const project = createProject('Концептуальный комплект');
  const result = analyzeHomeReview(project, stubOptions({
    deliverables: {
      status: 'ready',
      checks: [{ id: 'plans', title: 'Планы', status: 'ready', summary: 'Планы собраны.' }],
      warnings: [],
      summary: { ready: 1, missing: 0, total: 1 },
    },
  }));

  const stage = result.stages.find((item) => item.id === 'deliverables');
  assert.equal(stage.status, 'attention');
  assert.match(stage.summary, /не готовность рабочей документации/i);
  assert.notEqual(result.status, 'checked');
});
