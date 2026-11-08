// Мебель реагирует на мышь только при масштабе 1:80 и ближе (core/hit-stack.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createItem, createProject, createRoom } from '../core/model.js';
import { deriveWalls } from '../core/walls.js';
import { ITEM_EDIT_DENOMINATOR, itemsEditable, planHitStack } from '../core/hit-stack.js';

// пикселей на мм для знаменателя d (как в строке состояния «≈ 1:d»)
const scaleFor = (d) => 96 / 25.4 / d;

test('порог: 1:80 и ближе — можно, дальше — нельзя', () => {
  assert.equal(ITEM_EDIT_DENOMINATOR, 80);
  assert.equal(itemsEditable(scaleFor(80)), true);
  assert.equal(itemsEditable(scaleFor(30)), true);
  assert.equal(itemsEditable(scaleFor(81)), false);
  assert.equal(itemsEditable(scaleFor(300)), false);
});

test('издали под мышью только помещение, вблизи — мебель сверху', () => {
  const project = createProject();
  const room = createRoom('living', 0, 0, 5000, 4000);
  project.rooms.push(room);
  const item = createItem('sofa-3', 1000, 1000, 2200, 950);
  project.items.push(item);
  const walls = deriveWalls(project);
  const point = { x: item.x + item.w / 2, y: item.y + item.h / 2 };
  const far = planHitStack(project, walls, scaleFor(300), point).map((h) => h.type);
  assert.ok(!far.includes('item') && far.includes('room'), far.join());
  const near = planHitStack(project, walls, scaleFor(40), point).map((h) => h.type);
  assert.equal(near[0], 'item', near.join());
});
