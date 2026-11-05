// Подсветка мебели, объединённой пользователем в группу.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hoveredFurnitureIds } from '../render.js';

const items = [
  { id: 'table', group: 'dining-set' },
  { id: 'chair-a', group: 'dining-set' },
  { id: 'chair-b', group: 'dining-set' },
  { id: 'sofa' },
  { id: 'lamp', group: 'lighting' },
];

test('наведение на один предмет подсвечивает всю его группу', () => {
  assert.deepEqual([...hoveredFurnitureIds(items, { type: 'item', id: 'chair-a' })].sort(),
    ['chair-a', 'chair-b', 'table']);
});

test('одиночный предмет и чужие типы наведения не затрагивают соседей', () => {
  assert.deepEqual([...hoveredFurnitureIds(items, { type: 'item', id: 'sofa' })], ['sofa']);
  assert.equal(hoveredFurnitureIds(items, { type: 'room', id: 'room-1' }).size, 0);
  assert.equal(hoveredFurnitureIds(items, { type: 'item', id: 'missing' }).size, 0);
});
