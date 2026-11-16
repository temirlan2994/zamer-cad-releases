import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeHomeEngineering } from '../core/home-engineering.js';
import { createLevel, createProject, createRoom } from '../core/model.js';

const previousDocument = globalThis.document;
globalThis.document = { getElementById: () => ({ getContext: () => ({}) }) };
const { homeEngineeringHtml } = await import('../ui/home-engineering.js');
if (previousDocument === undefined) delete globalThis.document;
else globalThis.document = previousDocument;

function room(type, id, x = 0, y = 0, w = 3000, h = 3000) {
  return { ...createRoom(type, x, y, w, h), id };
}

test('пустой ввод остаётся неизвестным и не падает', () => {
  const result = analyzeHomeEngineering({});
  assert.equal(result.status, 'unknown');
  assert.equal(result.summary.roomCount, 0);
  assert.equal(result.points.surveyStatus, 'unknown');
});
test('различает не обследованные точки и подтверждённое отсутствие', () => {
  const unknown = createProject('Не обследовано');
  unknown.levels[0].rooms.push(room('bathroom', 'bath'));
  assert.equal(analyzeHomeEngineering(unknown).points.surveyStatus, 'unknown');

  const empty = createProject('Точек нет');
  empty.levels[0].rooms.push(room('bathroom', 'bath'));
  empty.layoutBrief = { fixedEngineering: [] };
  const result = analyzeHomeEngineering(empty);
  assert.equal(result.points.surveyStatus, 'confirmed_empty');
  assert.equal(result.summary.conflictCount, 0);
  assert.ok(result.warnings.some((warning) => /не отменяет проектирование/i.test(warning)));
});

test('потребности выводятся как решения к проектированию, а отсутствие точек не ошибка', () => {
  const project = createProject('Системы');
  project.levels[0].rooms.push(
    room('kitchen', 'kitchen', 0, 0),
    room('bedroom', 'bedroom', 3100, 0),
    room('sauna', 'sauna', 6200, 0),
  );
  project.layoutBrief = { fixedEngineering: [] };
  const result = analyzeHomeEngineering(project);
  const kitchen = result.rooms.find((entry) => entry.roomId === 'kitchen');
  const bedroom = result.rooms.find((entry) => entry.roomId === 'bedroom');
  const sauna = result.rooms.find((entry) => entry.roomId === 'sauna');
  assert.deepEqual(kitchen.systems.map(({ id }) => id), ['water', 'drain', 'extract']);
  assert.deepEqual(bedroom.systems.map(({ id }) => id), ['supply']);
  assert.deepEqual(sauna.systems.map(({ id }) => id), ['extract']);
  assert.equal(result.ventilation.status, 'unknown');
  assert.equal(result.conflicts.length, 0);
  assert.ok(result.coverage.every((entry) => entry.systems.every((system) => system.status === 'unknown')));
});

test('подтверждённая точка покрывает только свою систему и помещение', () => {
  const project = createProject('Точка');
  project.levels[0].rooms.push(room('bathroom', 'bath', 100, 200, 2000, 1800));
  project.layoutBrief = { fixedEngineering: [{
    id: 'water-1', kind: 'cold_water', levelId: 'L1', roomId: 'bath',
    x: 500, y: 600, zMm: 300, dataStatus: 'measured', sourceRef: 'обмер 1',
  }] };
  const result = analyzeHomeEngineering(project);
  assert.equal(result.points.records[0].status, 'fact');
  const systems = result.coverage.find((entry) => entry.roomKey === 'L1:bath').systems;
  assert.equal(systems.find((entry) => entry.system === 'water').status, 'fact');
  assert.equal(systems.find((entry) => entry.system === 'drain').status, 'unknown');
  assert.equal(result.summary.conflictCount, 0);
});

test('предварительно принятая точка остаётся кандидатом, а не доказанным фактом', () => {
  const project = createProject('Предварительная точка');
  project.levels[0].rooms.push(room('bathroom', 'bath', 100, 200, 2000, 1800));
  project.layoutBrief = { fixedEngineering: [{
    id: 'water-assumed', kind: 'cold_water', levelId: 'L1', roomId: 'bath',
    x: 500, y: 600, zMm: 300, dataStatus: 'assumed', sourceRef: 'эскизное предположение',
  }] };
  const result = analyzeHomeEngineering(project);
  assert.equal(result.points.records[0].status, 'candidate');
  assert.equal(result.coverage[0].systems.find((entry) => entry.system === 'water').status, 'unknown');
  assert.equal(result.summary.verifiedPointCount, 0);
  assert.equal(result.summary.candidatePointCount, 1);
});

test('смешанные инженерные данные не окрашивают целую карточку как доказанную', () => {
  const project = createProject('Частичные данные');
  project.levels[0].rooms.push(
    room('bedroom', 'bedroom', 0, 0),
    room('bathroom', 'bath', 3100, 0),
  );
  project.layoutBrief = { fixedEngineering: [
    {
      id: 'supply-known', kind: 'vent_supply', levelId: 'L1', roomId: 'bedroom',
      x: 1000, y: 1000, dataStatus: 'measured', sourceRef: 'обмер',
    },
    {
      id: 'water-unknown', kind: 'cold_water', levelId: 'L1', roomId: 'bath',
      x: 4000, y: 1000, dataStatus: 'unknown', sourceRef: null,
    },
  ] };
  const analysis = analyzeHomeEngineering(project);
  assert.equal(analysis.ventilation.status, 'candidate');

  const html = homeEngineeringHtml(project);
  assert.match(html, /data-engineering-card="ventilation" data-status="candidate"/);
  assert.match(html, /data-engineering-card="points" data-status="candidate"/);
  assert.doesNotMatch(html, /data-engineering-card="(?:ventilation|points)" data-status="proven"/);
});

test('явная точка вне заявленного помещения является противоречием', () => {
  const project = createProject('Конфликт');
  project.levels[0].rooms.push(room('bathroom', 'bath', 0, 0, 2000, 1800));
  project.layoutBrief = { fixedEngineering: [{
    id: 'drain-1', kind: 'drain', levelId: 'L1', roomId: 'bath',
    x: 5000, y: 5000, dataStatus: 'measured', sourceRef: 'обмер 1',
  }] };
  const result = analyzeHomeEngineering(project);
  assert.equal(result.status, 'conflict');
  assert.equal(result.points.records[0].status, 'conflict');
  assert.ok(result.conflicts.some(({ code }) => code === 'outside_room'));
});

test('геометрическая шахта остаётся кандидатом, а не подтверждённым стояком', () => {
  const project = createProject('Шахта');
  project.levels[0].rooms.push(
    room('bathroom', 'bath', 0, 0, 2000, 1800),
    room('shaft', 'shaft', 500, 500, 600, 600),
  );
  const result = analyzeHomeEngineering(project);
  assert.equal(result.rooms.find((entry) => entry.roomId === 'shaft').systems.length, 0);
  assert.equal(result.candidates.shafts.length, 1);
  assert.equal(result.candidates.shafts[0].confirmedRiser, false);
  assert.equal(result.candidates.shafts[0].status, 'candidate');
  assert.ok(result.warnings.some((warning) => /не считается инженерным стояком/i.test(warning)));
});

test('совмещение мокрых зон соседних этажей выдаётся только как кандидат', () => {
  const project = createProject('Два этажа');
  project.levels[0].rooms.push(room('bathroom', 'bath-lower', 0, 0, 2200, 2000));
  const upper = createLevel('2 этаж', 3000, 3000, 'L2');
  upper.rooms.push(room('laundry', 'laundry-upper', 500, 300, 2200, 1800));
  project.levels.push(upper);
  const result = analyzeHomeEngineering(project);
  assert.equal(result.candidates.vertical.length, 1);
  assert.equal(result.candidates.vertical[0].kind, 'vertical_overlap');
  assert.equal(result.candidates.vertical[0].status, 'candidate');
  assert.ok(result.candidates.vertical[0].overlapAreaM2 > 0);
  assert.match(result.candidates.vertical[0].reason, /не подтверждённый стояк/i);
});

test('окно и отсутствие вентиляционных точек не доказывают и не опровергают вентиляцию', () => {
  const project = createProject('Вентиляция');
  const bedroom = room('bedroom', 'bedroom');
  project.levels[0].rooms.push(bedroom);
  project.levels[0].openings.push({
    id: 'window-1', kind: 'window', roomId: bedroom.id, side: 0, offset: 1000, width: 1200,
  });
  project.layoutBrief = { fixedEngineering: [] };
  const result = analyzeHomeEngineering(project);
  assert.equal(result.ventilation.status, 'unknown');
  assert.deepEqual(result.ventilation.supplyRoomKeys, ['L1:bedroom']);
  assert.equal(result.summary.conflictCount, 0);
});
