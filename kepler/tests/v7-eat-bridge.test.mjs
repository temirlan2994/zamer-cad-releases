// Мост съедания v6↔v7 (core/v7/eat-bridge.js, docs/v7-stage2-plan.md, срез 1):
// видимые формы — из carve v7 с нуля, результат не зависит от порядка жестов.
import test from 'node:test';
import assert from 'node:assert/strict';

import { createOpening, createProject, createRoom, removeRoom } from '../core/model.js';
import { roomShapeArea } from '../core/room-shape.js';
import { eatState, eatersOf, liftRoom, reconcileEats } from '../core/v7/eat-bridge.js';

const shape = (r) => ({ x: r.x, y: r.y, w: r.w, h: r.h, outline: r.outline || null });

function pair() {
  const p = createProject('мост');
  const a = createRoom('living', 0, 0, 4000, 4000);
  const b = createRoom('bedroom', 3000, 3000, 3000, 3000);
  a.name = 'Нижняя'; b.name = 'Верхняя';
  p.rooms.push(a, b);
  return { p, a, b };
}

test('верхняя съедает нижнюю; убрали верхнюю — нижняя целая (а)', () => {
  const { p, a, b } = pair();
  const res = reconcileEats(p, { touched: [b.id] });
  assert.equal(res.eaten.length, 1);
  assert.ok(a.outline, 'нижняя стала Г');
  assert.ok(roomShapeArea(a) < 16e6);
  assert.deepEqual(a.eatBase.by, [b.id]);
  removeRoom(p, b.id);
  const back = reconcileEats(p);
  assert.equal(back.restored.length, 1);
  assert.deepEqual(shape(a), { x: 0, y: 0, w: 4000, h: 4000, outline: null });
  assert.equal(a.eatBase, undefined);
});

test('сдвинули съеденную нижнюю — она целая на новом месте (б)', () => {
  const { p, a, b } = pair();
  reconcileEats(p, { touched: [b.id] });
  a.x += 10000; // чистый сдвиг видимой формы
  reconcileEats(p, { touched: [a.id] });
  assert.deepEqual(shape(a), { x: 10000, y: 0, w: 4000, h: 4000, outline: null });
  assert.deepEqual(shape(b), { x: 3000, y: 3000, w: 3000, h: 3000, outline: null });
});

test('сдвинули съеденную частично под верхнюю — она поднимается и съедает верхнюю', () => {
  const { p, a, b } = pair();
  reconcileEats(p, { touched: [b.id] });
  a.x += 500;
  reconcileEats(p, { touched: [a.id] });
  assert.equal(p.rooms.at(-1), a);
  assert.equal(a.eatBase, undefined);
  assert.deepEqual(shape(a), { x: 500, y: 0, w: 4000, h: 4000, outline: null });
  assert.ok(b.eatBase && b.outline);
});

test('путь-независимость: туда-обратно и любой порядок = построение с нуля (в)', () => {
  const ref = pair();
  reconcileEats(ref.p, { touched: [ref.b.id] });
  const { p, a, b } = pair();
  reconcileEats(p, { touched: [b.id] });
  b.x += 2000; reconcileEats(p, { touched: [b.id] });
  b.y -= 5000; reconcileEats(p, { touched: [b.id] });
  b.x -= 2000; b.y += 5000; reconcileEats(p, { touched: [b.id] });
  assert.deepEqual(shape(a), shape(ref.a));
  assert.deepEqual(shape(b), shape(ref.b));
  assert.deepEqual({ ...a.eatBase, by: null }, { ...ref.a.eatBase, by: null });
  assert.deepEqual(a.eatBase.by, [b.id]);
  // Повторный пересчёт ничего не меняет.
  const again = JSON.stringify(p.levels);
  reconcileEats(p);
  assert.equal(JSON.stringify(p.levels), again);
});

test('проём под верхней — «сирота»: пропадает и возвращается, когда верхняя ушла', () => {
  const { p, a, b } = pair();
  const door = createOpening('door', a.id, 1, 3500, 900); // правая сторона нижней, у угла
  p.openings.push(door);
  reconcileEats(p, { touched: [b.id] });
  assert.ok(!p.openings.some((o) => o.id === door.id));
  assert.equal(a.eatBase.openings[0].id, door.id);
  b.x += 10000; reconcileEats(p, { touched: [b.id] });
  const back = p.openings.find((o) => o.id === door.id);
  assert.ok(back);
  assert.equal(back.side, 1);
  assert.equal(back.offset, 3500);
});

test('несъедаемое (целиком под верхней) — перекрытие остаётся с причиной (г)', () => {
  const p = createProject('мост');
  const a = createRoom('living', 1000, 1000, 1000, 1000);
  const b = createRoom('bedroom', 0, 0, 4000, 4000);
  p.rooms.push(a, b);
  const res = reconcileEats(p, { touched: [b.id] });
  assert.equal(res.failed.length, 1);
  assert.equal(res.failed[0].why, 'whole');
  assert.equal(a.eatBase, undefined);
});

test('старый файл: съевшая раньше в массиве — поднимается над съеденной', () => {
  const { p, a, b } = pair();
  reconcileEats(p, { touched: [b.id] });
  p.rooms.reverse(); // как в v6: съеденная могла оказаться выше по массиву
  reconcileEats(p);
  assert.deepEqual(p.rooms.map((r) => r.id), [a.id, b.id]);
  assert.ok(a.eatBase);
});

test('жест по номиналу: liftRoom возвращает съеденной целую форму и проёмы-сироты', () => {
  const { p, a, b } = pair();
  const door = createOpening('door', a.id, 1, 3500, 900); // правая сторона нижней — под b
  p.openings.push(door);
  reconcileEats(p, { touched: [b.id] });
  assert.ok(a.eatBase);
  assert.equal(p.openings.length, 0, 'дверь ушла под верхнюю (сирота)');
  assert.deepEqual(eatersOf(a), [b.id]);
  assert.equal(liftRoom(p, a.id), true);
  assert.deepEqual(shape(a), { x: 0, y: 0, w: 4000, h: 4000, outline: null });
  assert.equal(p.openings.length, 1, 'сирота вернулась');
  assert.equal(liftRoom(p, a.id), false, 'уже номинал');
});

test('растяжение съеденной (under): остаётся под съевшей, номинал растёт', () => {
  const { p, a, b } = pair();
  reconcileEats(p, { touched: [b.id] });
  const prev = eatState(p);
  const under = { [a.id]: eatersOf(a) };
  liftRoom(p, a.id);
  a.w = 5000; // тянем правую грань съеденной — дальше под b
  const res = reconcileEats(p, { touched: [a.id], under, prev });
  assert.deepEqual(p.rooms.map((r) => r.id), [a.id, b.id], 'b по-прежнему выше');
  assert.deepEqual(a.eatBase.base, { x: 0, y: 0, w: 5000, h: 4000 });
  assert.equal(res.eaten.length, 0, 'итог против начала жеста: та же пара');
  // Без under тронутая поднимается и съедает b.
  const { p: p2, a: a2, b: b2 } = pair();
  reconcileEats(p2, { touched: [b2.id] });
  liftRoom(p2, a2.id);
  a2.w = 5000;
  reconcileEats(p2, { touched: [a2.id] });
  assert.ok(b2.eatBase, 'без under — съедена b');
});
