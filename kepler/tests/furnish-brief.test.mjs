import test from 'node:test';
import assert from 'node:assert/strict';

import { defaultItemsFor } from '../core/furnish.js';

const diningRoom = {
  id: 'room-dining', type: 'dining', x: 0, y: 0, w: 5000, h: 4000,
};

test('типовой набор столовой учитывает вместимость из брифа', () => {
  const items = defaultItemsFor(diningRoom, {
    layoutBrief: { capacity: { dailySeats: 3, guestSeats: 6 } },
  });
  assert.equal(items.filter((item) => item.kind === 'chair').length, 6);
  assert.equal(items.filter((item) => item.kind === 'dining-table-6').length, 1);
  assert.equal(items.filter((item) => item.kind === 'dining-table').length, 0);
});

test('каталог не скрывает запрос вместимости выше доступного стола', () => {
  const items = defaultItemsFor(diningRoom, {
    layoutBrief: { capacity: { dailySeats: 4, guestSeats: 12 } },
  });
  assert.equal(items.filter((item) => item.kind === 'chair').length, 6);
  assert.equal(items.filter((item) => item.kind === 'dining-table-6').length, 1);
});

test('старый проект без брифа сохраняет прежние четыре места', () => {
  const items = defaultItemsFor(diningRoom);
  assert.equal(items.filter((item) => item.kind === 'chair').length, 4);
  assert.equal(items.filter((item) => item.kind === 'dining-table').length, 1);
});
