import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createLevel, createProject, createRoom, deserializeProject, serializeProject } from '../core/model.js';
import { canHaveLinkedRoof, linkedRoofById, linkedRoofGroups, setLinkedRoofEnabled } from '../core/roofs.js';

test('Крыша появляется вместе с комнатой; соседние комнаты накрываются единым контуром', () => {
  const p = createProject();
  const level = p.levels[0];
  const living = createRoom('living', 0, 0, 4000, 4000);
  const kitchen = createRoom('kitchen', 4100, 0, 3000, 4000);
  const wing = createRoom('living', 16000, 0, 3500, 3500);
  const balcony = createRoom('balcony', 7500, 0, 2200, 1500);
  const nested = { ...createRoom('bathroom', 1000, 1000, 1500, 1500), parentId: living.id };
  assert.deepEqual(linkedRoofGroups(p), []);
  level.rooms.push(living, kitchen, wing, balcony, nested);
  const roofs = linkedRoofGroups(p, level.id);
  assert.equal(roofs.length, 2);
  assert.deepEqual(roofs[0].roomIds, [living.id, kitchen.id].sort());
  assert.deepEqual(roofs[1].roomIds, [wing.id]);
  assert.equal(canHaveLinkedRoof(balcony), false);
  assert.equal(canHaveLinkedRoof(nested), false);
  assert.equal(canHaveLinkedRoof({ ...wing, shaft: true }), false);
  const mainId = roofs[0].id;
  const original = roofs[0].baseRects;
  level.rooms.reverse();
  living.x += 300;
  living.w -= 300;
  const changed = linkedRoofById(p, mainId);
  assert.deepEqual(changed.roomIds, roofs[0].roomIds);
  assert.notDeepEqual(changed.baseRects, original);
  assert.ok(changed.baseRects.some((r) => r.x0 === 300 - p.settings.exterior));
  const upper = createLevel('2 этаж', 3000, 3000, 'L2');
  upper.rooms.push({ ...living }); // Импортированный файл может повторять ID комнаты на разных этажах.
  p.levels.push(upper);
  assert.notEqual(linkedRoofGroups(p, upper.id)[0].id, mainId);
  assert.equal(linkedRoofById(p, mainId, upper.id), null);
});

test('Удаление адресно, сохраняется в файле и не выключает крышу будущих комнат', () => {
  const p = createProject();
  const level = p.levels[0];
  const rooms = [0, 4100, 8200].map((x) => createRoom('living', x, 0, 4000, 4000));
  level.rooms.push(...rooms);
  assert.equal(linkedRoofGroups(p).length, 1);
  assert.equal(setLinkedRoofEnabled(p, level.id, [rooms[1].id], false), true);
  assert.equal(setLinkedRoofEnabled(p, level.id, [rooms[1].id], false), false);
  assert.deepEqual(linkedRoofGroups(p).map((g) => g.roomIds), [[rooms[0].id], [rooms[2].id]]);
  const loaded = deserializeProject(serializeProject(p));
  assert.equal(loaded.rooms[1].linkedRoof, false);
  assert.deepEqual(linkedRoofGroups(loaded), linkedRoofGroups(p));
  const fresh = createRoom('kitchen', 30000, 0, 3000, 3000);
  loaded.rooms.push(fresh);
  assert.equal(linkedRoofGroups(loaded).length, 3);
  loaded.envelope.roofMode = 'manual';
  assert.deepEqual(linkedRoofGroups(deserializeProject(serializeProject(loaded))), []);
  loaded.envelope.roofMode = 'linked';
  assert.equal(linkedRoofGroups(loaded).length, 3);
  assert.equal(setLinkedRoofEnabled(loaded, level.id, [rooms[1].id], true), true);
  assert.equal(Object.hasOwn(loaded.rooms[1], 'linkedRoof'), false);
  assert.equal(linkedRoofGroups(loaded).length, 2);
  const whole = linkedRoofGroups(loaded)[0];
  setLinkedRoofEnabled(loaded, level.id, whole.roomIds, false);
  assert.deepEqual(linkedRoofGroups(loaded).map((g) => g.roomIds), [[fresh.id]]);
});

test('Прямоугольники Г-образной формы не закрывают выемку, касание скатов в вершине не объединяет крыши', () => {
  const p = createProject();
  const a = createRoom('living', 0, 0, 8000, 8000);
  a.notch = { corner: 'se', w: 4500, h: 4500 };
  const b = createRoom('living', 5500, 5500, 1500, 1500);
  const c = createRoom('living', 7500, 7500, 1500, 1500);
  p.rooms.push(a, b, c);
  const groups = linkedRoofGroups(p);
  assert.equal(groups.length, 3);
  assert.equal(groups[0].baseRects.length, 2);
  assert.ok(groups[0].baseRects.every((r) => r.x1 < b.x || r.y1 < b.y));
});
