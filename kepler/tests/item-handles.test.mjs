import { test } from 'node:test';
import assert from 'node:assert/strict';
import { itemEdgeHandles, itemHandleMode, nextItemHandle, stretchItem } from '../core/item-handles.js';

test('режимы ручек идут по кругу: выбор → поворот → растяжение → масштаб → выбор', () => {
  let h = null;
  const seen = [itemHandleMode(h, 'a')];
  for (let i = 0; i < 4; i += 1) { h = nextItemHandle(h, 'a'); seen.push(itemHandleMode(h, 'a')); }
  assert.deepEqual(seen, ['select', 'rotate', 'stretch', 'scale', 'select']);
  assert.equal(itemHandleMode(h, 'b'), 'select', 'для другого предмета режим сброшен');
});

test('растяжение вправо: левая сторона на месте, ширина растёт, высота прежняя', () => {
  const item = { x: 1000, y: 500, w: 800, h: 400, rotation: 0 };
  const r = stretchItem(item, 'e', { x: 2000, y: 700 });
  assert.equal(r.w, 1400); // от левой грани (600) до курсора (2000)
  assert.equal(r.h, 400);
  assert.equal(r.x - r.w / 2, 600, 'левая грань осталась на месте');
  assert.equal(r.y, 500);
});

test('растяжение вверх на повёрнутом на 90° предмете', () => {
  const item = { x: 0, y: 0, w: 1000, h: 400, rotation: 90 };
  // локальная ось X смотрит вниз (+Y мира); сторона «e» — внизу
  const [, e] = itemEdgeHandles(item);
  assert.ok(Math.abs(e.x) < 1e-6 && Math.abs(e.y - 500) < 1e-6);
  const r = stretchItem(item, 'e', { x: 0, y: 1500 });
  assert.equal(r.w, 2000);
  assert.ok(Math.abs(r.y - 500) < 1e-6, 'центр сдвинулся вниз, верхняя грань на месте');
});

test('минимальный размер и защита от переворота', () => {
  const item = { x: 0, y: 0, w: 800, h: 400, rotation: 0 };
  const r = stretchItem(item, 'e', { x: -2000, y: 0 }); // потянули за противоположную сторону
  assert.ok(r.w >= 200);
});
