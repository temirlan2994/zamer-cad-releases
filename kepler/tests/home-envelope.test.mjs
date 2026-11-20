import test from 'node:test';
import assert from 'node:assert/strict';

import { analyzeHomeEnvelope } from '../core/home-envelope.js';
import {
  createItem, createLevel, createOpening, createProject, createRoom,
} from '../core/model.js';
import { createRoof, roofFromRooms } from '../core/roofs.js';
import { addSectionView } from '../core/views.js';

function oneStorey() {
  const project = createProject('Оболочка');
  const room = createRoom('living', 0, 0, 5000, 4000);
  room.id = 'living-1';
  project.rooms.push(room);
  project.openings.push(
    createOpening('window', room.id, 0, 2500, 1600),
    createOpening('door', room.id, 2, 2500, 900),
  );
  return { project, room };
}

function twoStorey() {
  const { project } = oneStorey();
  const stair = createItem('stairs', 2500, 2000, 1000, 3000);
  stair.id = 'stair-1';
  project.items.push(stair);
  const upper = createLevel('2 этаж', 3000, 3000, 'L2');
  const bedroom = createRoom('bedroom', 0, 0, 5000, 4000);
  bedroom.id = 'bedroom-2';
  upper.rooms.push(bedroom);
  project.levels.push(upper);
  return { project, stair, upper };
}

test('пустой проект остаётся неизвестным и не получает ложных выводов', () => {
  const result = analyzeHomeEnvelope(createProject('Пустой'));
  assert.equal(result.schema, 'kepler-home-envelope/1');
  assert.equal(result.preliminary, true);
  assert.equal(result.normative, false);
  assert.equal(result.status, 'unknown');
  assert.equal(result.indicators.buildingVolumeM3, 0);
  assert.equal(result.indicators.storeys, null);
  assert.equal(result.facades.availableCount, 0);
  assert.equal(result.roofs.explicitCount, 0);
  assert.ok(result.unknowns.some((item) => item.id === 'envelope:empty'));
  assert.equal(result.conclusions.structural.value, null);
  assert.equal(result.conclusions.thermal.value, null);
  assert.equal('score' in result, false);
  assert.equal('ready' in result, false);
});

test('ТЭП, этаж, четыре фасада и связанная автокровля — факты модели', () => {
  const { project } = oneStorey();
  const before = JSON.stringify(project);
  const result = analyzeHomeEnvelope(project);

  assert.equal(result.status, 'candidate');
  assert.equal(result.levels.length, 1);
  assert.equal(result.levels[0].roomCount, 1);
  assert.equal(result.levels[0].windowCount, 1);
  assert.equal(result.levels[0].doorCount, 1);
  assert.ok(result.levels[0].footprintM2 > 20);
  assert.equal(result.indicators.totalAreaM2, 20);
  assert.ok(result.indicators.buildingVolumeM3 > 0);
  assert.equal(result.indicators.volumeIncludesRoof, false);
  assert.equal(result.indicators.volumeMethod, 'sum-level-footprint-x-level-height');
  assert.equal(result.facades.availableCount, 4);
  assert.ok(result.facades.records.every((facade) => facade.status === 'available'));
  assert.ok(result.facades.records.every((facade) => facade.roofRepresentation === 'linked-automatic'));
  assert.equal(result.roofs.status, 'linked');
  assert.equal(result.roofs.autoLinked, true);
  assert.ok(result.facts.some((item) => item.id === 'roof:linked'));
  assert.equal(result.unknowns.some((item) => item.id === 'roof:unspecified'), false);
  assert.ok(result.limitations.some((text) => /объём кровли/i.test(text)));
  assert.ok(result.limitations.some((text) => /несущая способность/i.test(text)));
  assert.ok(result.limitations.some((text) => /теплотехнические/i.test(text)));
  assert.equal(JSON.stringify(project), before, 'анализатор не мутирует проект');
});

test('явная крыша и сохранённый разрез возвращаются с измеримыми фактами', () => {
  const { project, room } = oneStorey();
  const roof = roofFromRooms(project, 'L1', [room.id]);
  project.roofs = [roof];
  addSectionView(project, {
    levelId: 'L1',
    a: { x: 2500, y: -1000 }, b: { x: 2500, y: 5000 },
    name: 'Разрез А',
  });

  const result = analyzeHomeEnvelope(project);
  assert.equal(result.roofs.status, 'explicit');
  assert.equal(result.roofs.explicitCount, 1);
  assert.ok(result.roofs.totalAreaM2 > result.levels[0].footprintM2);
  assert.deepEqual(result.roofs.records.map((record) => [record.id, record.levelId, record.status]), [
    [roof.id, 'L1', 'explicit'],
  ]);
  assert.equal(result.sections.status, 'available');
  assert.equal(result.sections.availableCount, 1);
  assert.ok(result.sections.records[0].cutCount > 0);
  assert.ok(result.sections.records[0].widthMm > 0);
  assert.ok(result.facades.records.every((facade) => facade.roofRepresentation === 'explicit-plus-linked-automatic'));
  assert.ok(result.facts.some((item) => item.id === 'roof:coverage-linked'));
});

test('лёгкий режим регистрирует виды, но строит их только после открытия', () => {
  const { project } = oneStorey();
  const section = addSectionView(project, {
    levelId: 'L1',
    a: { x: 2500, y: -1000 }, b: { x: 2500, y: 5000 },
    name: 'Разрез быстрый',
  });

  const result = analyzeHomeEnvelope(project, { inspectViewGeometry: false });
  assert.equal(result.facades.status, 'registered');
  assert.equal(result.facades.registeredCount, 4);
  assert.equal(result.facades.availableCount, 0);
  assert.ok(result.facades.records.every((facade) => facade.status === 'registered'));
  assert.ok(result.facades.records.every((facade) => facade.widthMm === null));
  assert.equal(result.sections.status, 'registered');
  assert.equal(result.sections.registeredCount, 1);
  assert.equal(result.sections.records[0].id, section.id);
  assert.equal(result.sections.records[0].status, 'registered');
  assert.equal(result.sections.records[0].cutCount, null);
  assert.equal(result.facts.some((item) => item.id === 'facade:four-views'), false);
});

test('лестница и авто-проём описываются, но автоматическая цель остаётся unknown', () => {
  const { project, stair, upper } = twoStorey();
  const result = analyzeHomeEnvelope(project);
  const record = result.vertical.stairs.find((item) => item.id === stair.id);

  assert.equal(record.status, 'automatic');
  assert.equal(record.targetMode, 'automatic');
  assert.equal(record.targetLevelId, upper.id);
  assert.equal(record.riseMm, 3000);
  assert.deepEqual(record.openingLevelIds, [upper.id]);
  assert.equal(result.vertical.slabOpenings.length, 1);
  assert.equal(result.vertical.slabOpenings[0].source, 'automatic-from-stair');
  assert.equal(result.vertical.slabOpenings[0].sourceLevelId, 'L1');
  assert.ok(result.vertical.slabOpenings[0].areaM2 > 0);
  assert.equal(result.vertical.status, 'candidate');
  assert.ok(result.unknowns.some((item) => item.id === `vertical:stair-auto-target:${stair.id}`));
  assert.equal(result.unknowns.some((item) => item.id === `vertical:access:${upper.id}`), false);
});

test('явная ссылка лестницы на отсутствующий этаж — конфликт, а не догадка', () => {
  const { project, stair } = twoStorey();
  stair.toLevel = 'missing-level';
  const result = analyzeHomeEnvelope(project);

  assert.equal(result.status, 'conflict');
  assert.equal(result.vertical.status, 'conflict');
  assert.equal(result.vertical.stairs[0].status, 'conflict');
  const conflict = result.conflicts.find((item) => item.id === `vertical:stair-target:${stair.id}`);
  assert.ok(conflict);
  assert.equal(conflict.targetLevelId, 'missing-level');
  assert.equal(result.unknowns.some((item) => item.id.startsWith('vertical:stair-auto-target:')), false);
});

test('битая явная крыша фиксируется как конфликт без падения фасадов', () => {
  const { project } = oneStorey();
  const roof = createRoof({
    levelId: 'L1',
    outline: [
      { x: -250, y: -250 }, { x: 5250, y: -250 },
      { x: 5250, y: 4250 }, { x: -250, y: 4250 },
    ],
  });
  roof.levelId = 'deleted-level';
  project.roofs = [roof];
  const result = analyzeHomeEnvelope(project);

  assert.equal(result.status, 'conflict');
  assert.equal(result.roofs.status, 'conflict');
  assert.equal(result.roofs.invalidCount, 1);
  assert.ok(result.conflicts.some((item) => item.id === `roof:invalid:${roof.id}`));
  assert.equal(result.facades.records.length, 4);
});
