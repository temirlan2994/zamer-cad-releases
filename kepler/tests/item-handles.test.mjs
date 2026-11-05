import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inItemCore, itemEdgeHandles, itemHandleMode, nextItemHandle, stretchItem } from '../core/item-handles.js';

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

test('сердцевина предмета: у большого — всё, кроме полосы допуска; у малого ручки не закрывают тело', () => {
  const big = { x: 0, y: 0, w: 2000, h: 1000, rotation: 0 };
  assert.equal(inItemCore(big, { x: 0, y: 0 }, 100), true);
  assert.equal(inItemCore(big, { x: 950, y: 0 }, 100), false, 'полоса ручки у края');
  assert.equal(inItemCore(big, { x: 850, y: 0 }, 100), true, 'за полосой — тело');
  // Малый: сторона 300 мм, допуск 220 мм (палец при мелком масштабе) — центр всё равно тело.
  const small = { x: 0, y: 0, w: 300, h: 300, rotation: 0 };
  assert.equal(inItemCore(small, { x: 0, y: 0 }, 220), true);
  assert.equal(inItemCore(small, { x: 60, y: -60 }, 220), true, 'центральная половина — тело');
  assert.equal(inItemCore(small, { x: 140, y: 0 }, 220), false, 'у края — ручка');
  // Поворот учитывается: точка вдоль длинной стороны повёрнутого на 90° предмета.
  const rot = { x: 0, y: 0, w: 2000, h: 400, rotation: 90 };
  assert.equal(inItemCore(rot, { x: 0, y: 700 }, 50), true);
  assert.equal(inItemCore(rot, { x: 700, y: 0 }, 50), false);
});
