import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createLevel, createProject, createRoom } from '../core/model.js';
import { boxOutline, createRoof } from '../core/roofs.js';
import { planRoofStack, roomRoofCoverage } from '../ui/plan-roofs.js';
import { state } from '../ui/state.js';

test('Свойства комнаты учитывают надстройку над ней внутри общего контура кровли', () => {
  const project = createProject();
  const covered = createRoom('living', 0, 0, 4000, 4000);
  const exposed = createRoom('living', 4100, 0, 4000, 4000);
  project.rooms = [covered, exposed];
  const upper = createLevel('2 этаж', 3000);
  upper.rooms.push(createRoom('living', 0, 0, 4000, 4000));
  project.levels.push(upper);
  state.project = project;
  assert.equal(roomRoofCoverage(covered).linked, undefined);
  const visible = roomRoofCoverage(exposed).linked;
  assert.ok(visible.roomIds.includes(covered.id));
  assert.ok(visible.roomIds.includes(exposed.id));
});

test('Для частичного ручного навеса видны и он, и оставшаяся связанная крыша', () => {
  const project = createProject();
  const room = createRoom('living', 0, 0, 7000, 4000);
  project.rooms = [room];
  state.project = project;
  const roof = createRoof({ levelId: project.activeLevel, outline: boxOutline({ x0: 0, y0: 0, x1: 1200, y1: 2000 }) });
  project.roofs = [roof];
  const coverage = roomRoofCoverage(room);
  assert.equal(coverage.manual.id, roof.id);
  assert.ok(coverage.linked.roomIds.includes(room.id));
});

test('Верхняя связанная крыша рисуется и выбирается поверх нижнего ручного контура', () => {
  const project = createProject();
  project.rooms = [createRoom('living', 0, 0, 6000, 4000)];
  project.roofs = [createRoof({ levelId: project.activeLevel, outline: boxOutline({ x0: 0, y0: 0, x1: 6000, y1: 4000 }) })];
  const upper = createLevel('2 этаж', 3000);
  upper.rooms.push(createRoom('living', 0, 0, 3000, 4000));
  project.levels.push(upper);
  state.project = project;
  const stack = planRoofStack();
  assert.ok(stack.includes(project.roofs[0]));
  assert.equal(stack.at(-1).levelId, upper.id);
  assert.equal(stack.at(-1).roofSource, 'linked');
});
