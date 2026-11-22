// Производный главный вход: наружная дверь, площадка и подъём от земли к
// отметке пола. Геометрия не сохраняется в проекте и всегда пересчитывается.
import test from 'node:test';
import assert from 'node:assert/strict';

import { deriveEntrances } from '../core/entrance.js';
import { createLevel, createOpening, createProject, createRoom } from '../core/model.js';

function house({ zero = 1000, side = 0, role = 'main' } = {}) {
  const project = createProject();
  project.settings.exterior = 250;
  project.envelope.zeroAboveGround = zero;
  const room = createRoom('entrance', 0, 0, 5000, 4000);
  room.id = 'entry-room';
  const door = createOpening('door', room.id, side, side % 2 ? 2000 : 2500, 1000);
  door.id = 'front-door';
  if (role != null) door.entryRole = role;
  project.rooms.push(room);
  project.openings.push(door);
  return { project, room, door };
}

test('главная наружная дверь даёт стабильную площадку и ступени до ±0.000', () => {
  const { project } = house();
  const before = JSON.stringify(project);
  const [entrance] = deriveEntrances(project);

  assert.equal(entrance.id, 'auto-entry:front-door');
  assert.equal(entrance.openingId, 'front-door');
  assert.equal(entrance.levelId, project.activeLevel);
  assert.equal(entrance.mainSource, 'explicit');
  assert.equal(entrance.status, 'ready');
  assert.deepEqual(entrance.outward, { x: 0, y: -1 });
  assert.deepEqual(entrance.threshold, { x: 2500, y: -250, z: 0 });
  assert.equal(entrance.groundZ, -1000);
  assert.equal(entrance.rise, 1000);

  assert.deepEqual([entrance.landing.id, entrance.landing.kind], ['auto-entry:front-door:landing', 'landing']);
  assert.equal(entrance.landing.z, 0);
  assert.equal(entrance.landing.width, 1600);
  assert.equal(entrance.landing.depth, 1500);
  assert.equal(entrance.landing.polygon.length, 4);

  assert.equal(entrance.steps.enabled, true);
  assert.equal(entrance.steps.count, 7);
  assert.ok(entrance.steps.riser <= 150);
  assert.equal(entrance.steps.tread, 300);
  assert.equal(entrance.steps.run, 2100);
  assert.deepEqual(entrance.steps.bottomCenter, { x: 2500, y: -3850 });
  assert.equal(entrance.ramp.enabled, false);
  assert.deepEqual(entrance.components.map((component) => component.kind), ['landing', 'steps']);

  assert.equal(JSON.stringify(project), before, 'deriveEntrances не пишет производные объекты в project');
  assert.deepEqual(deriveEntrances(project), [entrance], 'повторный расчёт детерминирован');
});

test('без заданного ±0.000 вход найден, но остаётся pending без геометрии', () => {
  const { project } = house({ zero: null });
  const [entrance] = deriveEntrances(project);
  assert.equal(entrance.id, 'auto-entry:front-door');
  assert.equal(entrance.status, 'pending');
  assert.equal(entrance.reason, 'building-datum-required');
  assert.equal(entrance.groundZ, null);
  assert.equal(entrance.rise, null);
  assert.equal(entrance.landing, null);
  assert.equal(entrance.steps, null);
  assert.equal(entrance.ramp, null);
  assert.deepEqual(entrance.components, []);
});

test('режим both раскладывает ступени и прямой пандус рядом на общей площадке', () => {
  const { project } = house();
  project.envelope.entrance = { mode: 'both' };
  const [entrance] = deriveEntrances(project);

  assert.equal(entrance.mode, 'both');
  assert.equal(entrance.landing.width, 3000);
  assert.equal(entrance.steps.enabled, true);
  assert.equal(entrance.ramp.enabled, true);
  assert.equal(entrance.ramp.rise, 1000);
  assert.equal(entrance.ramp.run, 12500);
  assert.ok(Math.abs(entrance.ramp.slope - 0.08) < 1e-12);
  assert.notEqual(entrance.steps.lateralOffset, entrance.ramp.lateralOffset);
  assert.deepEqual(entrance.components.map((component) => component.kind), ['landing', 'steps', 'ramp']);
});

test('main выбирается только среди наружных дверей нижнего занятого этажа', () => {
  const project = createProject();
  project.envelope.zeroAboveGround = 500;
  project.settings.exterior = 250;
  const left = createRoom('living', 0, 0, 4000, 4000);
  const right = createRoom('hall', 4100, 0, 4000, 4000);
  left.id = 'left';
  right.id = 'right';
  const innerMain = createOpening('door', left.id, 1, 2000, 900);
  innerMain.id = 'inner-main';
  innerMain.entryRole = 'main';
  const lowerOuter = createOpening('door', right.id, 2, 2000, 900);
  lowerOuter.id = 'lower-outer';
  project.rooms.push(left, right);
  project.openings.push(innerMain, lowerOuter);

  const upper = createLevel('2 этаж', 3000, 3000, 'L2');
  const upperRoom = createRoom('entrance', 0, 0, 4000, 4000);
  upperRoom.id = 'upper-room';
  const upperMain = createOpening('door', upperRoom.id, 0, 2000, 1000);
  upperMain.id = 'upper-main';
  upperMain.entryRole = 'main';
  upper.rooms.push(upperRoom);
  upper.openings.push(upperMain);
  project.levels.push(upper);

  const [entrance] = deriveEntrances(project);
  assert.equal(entrance.openingId, 'lower-outer', 'внутренняя main-дверь и дверь верхнего этажа не кандидаты');
  assert.equal(entrance.levelId, 'L1');
  assert.equal(entrance.mainSource, 'room');
});

test('явно служебная наружная дверь не становится главным входом', () => {
  const { project } = house({ role: 'service' });
  assert.deepEqual(deriveEntrances(project), []);
});

test('автоматический вход можно отключить, а mode none оставляет только площадку', () => {
  const { project } = house();
  project.envelope.entrance.mode = 'none';
  const [landingOnly] = deriveEntrances(project);
  assert.equal(landingOnly.steps.enabled, false);
  assert.equal(landingOnly.ramp.enabled, false);
  assert.deepEqual(landingOnly.components.map((component) => component.kind), ['landing']);

  project.envelope.entrance.enabled = false;
  assert.deepEqual(deriveEntrances(project), []);
});
