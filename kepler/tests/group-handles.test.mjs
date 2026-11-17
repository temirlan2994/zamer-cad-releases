import test from 'node:test';
import assert from 'node:assert/strict';
import {
  groupBounds, groupHandleId, groupRotateDeg, groupStarts, isItemGroup, rotateGroup, scaleGroup, stretchGroup,
} from '../core/group-handles.js';
import { defaultComp } from '../core/composite.js';

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} ≈ ${b}`);
const items = () => [
  { id: 'a', kind: 'sofa', x: 1000, y: 1000, w: 2000, h: 1000, rotation: 0 },
  { id: 'b', kind: 'table', x: 3500, y: 1000, w: 1000, h: 1000, rotation: 0 },
  { id: 'c', kind: 'armchair', x: 2000, y: 2500, w: 1000, h: 1000, rotation: 90 },
];

test('группа мебели: только предметы, не меньше двух; ключ не зависит от порядка', () => {
  assert.equal(isItemGroup({ type: 'multi', roomIds: [], itemIds: ['a', 'b'] }), true);
  assert.equal(isItemGroup({ type: 'multi', roomIds: ['r'], itemIds: ['a', 'b'] }), false);
  assert.equal(isItemGroup({ type: 'multi', roomIds: [], itemIds: ['a'] }), false);
  assert.equal(isItemGroup({ type: 'item', id: 'a' }), false);
  assert.equal(groupHandleId({ type: 'multi', roomIds: [], itemIds: ['b', 'a'] }),
    groupHandleId({ type: 'multi', roomIds: [], itemIds: ['a', 'b'] }));
});

test('рамка группы — объединение габаритов (повёрнутый — по описывающему)', () => {
  const box = groupBounds(items());
  assert.deepEqual(box, { x: 0, y: 500, w: 4000, h: 2500 });
});

test('поворот на 90°: центры вокруг центра рамки, rotation +90', () => {
  const list = items();
  const box = groupBounds(list);
  const center = { x: box.x + box.w / 2, y: box.y + box.h / 2 }; // 2000, 1750
  const out = rotateGroup(groupStarts(list), center, 90);
  const a = out.find((i) => i.id === 'a');
  // (1000,1000) - c = (-1000,-750) → (750,-1000) → (2750, 750)
  near(a.x, 2750); near(a.y, 750); assert.equal(a.rotation, 90);
  assert.equal(out.find((i) => i.id === 'c').rotation, 180);
  // Габарит после поворота на 90° — транспонированная рамка с тем же центром.
  const nb = groupBounds(list.map((it) => ({ ...it, ...out.find((o) => o.id === it.id) })));
  near(nb.w, 2500); near(nb.h, 4000);
  near(nb.x + nb.w / 2, center.x); near(nb.y + nb.h / 2, center.y);
});

test('поворот на произвольный угол сохраняет расстояния и размеры; 360 → 0', () => {
  const list = items();
  const center = { x: 2000, y: 1750 };
  const out = rotateGroup(groupStarts(list), center, 37);
  for (const it of list) {
    const o = out.find((x) => x.id === it.id);
    near(Math.hypot(o.x - center.x, o.y - center.y), Math.hypot(it.x - center.x, it.y - center.y), 1e-2);
    assert.equal(o.w, it.w); assert.equal(o.h, it.h);
    near(o.rotation, (it.rotation + 37) % 360);
  }
  const d = Math.hypot(out[0].x - out[1].x, out[0].y - out[1].y);
  near(d, 2500, 1e-2);
  assert.equal(rotateGroup(groupStarts(list), center, 360)[0].rotation, 0);
});

test('угол жеста: шаг 5° и 15°', () => {
  const c = { x: 0, y: 0 };
  const deg = groupRotateDeg(c, { x: 100, y: 0 }, { x: Math.cos(0.3), y: Math.sin(0.3) }, 5);
  assert.equal(deg, 15); // 17,2° → 15°
  assert.equal(groupRotateDeg(c, { x: 100, y: 0 }, { x: 0, y: 100 }, 15), 90);
});

test('растяжение вправо: левая сторона неподвижна, позиции и ширины ×k, повёрнутый на 90° — по h', () => {
  const list = items();
  const box = groupBounds(list); // x 0..4000
  const res = stretchGroup(groupStarts(list), box, 'e', { x: 8000, y: 0 });
  assert.equal(res.k, 2);
  assert.equal(res.box.x, 0); assert.equal(res.box.w, 8000);
  const a = res.items.find((i) => i.id === 'a');
  assert.equal(a.x, 2000); assert.equal(a.w, 4000); assert.equal(a.h, 1000); assert.equal(a.y, 1000);
  const c = res.items.find((i) => i.id === 'c');
  assert.equal(c.x, 4000); assert.equal(c.h, 2000); assert.equal(c.w, 1000); // повёрнут на 90°: вдоль X — его h
  // Левые грани, касавшиеся неподвижной стороны, остались на ней.
  assert.equal(a.x - a.w / 2, 0);
});

test('растяжение вверх: нижняя сторона неподвижна, шаг 50 мм', () => {
  const list = items();
  const box = groupBounds(list); // y 500..3000
  const res = stretchGroup(groupStarts(list), box, 'n', { x: 0, y: -1010 });
  assert.equal(res.box.y + res.box.h, 3000);
  assert.equal(res.box.h, 4000); // 4010 → 4000
  const b = res.items.find((i) => i.id === 'b');
  assert.equal(b.h, 1600); assert.equal(b.w, 1000);
});

test('растяжение: минимум размера предмета и без зеркального переворота', () => {
  const list = items();
  const box = groupBounds(list);
  const res = stretchGroup(groupStarts(list), box, 'e', { x: -5000, y: 0 });
  assert.ok(res.k > 0);
  for (const it of res.items) {
    assert.ok(it.w >= 100 && it.h >= 100, `${it.id}: ${it.w}×${it.h}`);
  }
  // Самый узкий вдоль X предмет — ровно на минимуме.
  assert.equal(Math.min(...res.items.map((i) => (i.id === 'c' ? i.h : i.w))), 100);
});

test('растяжение: повёрнутый на 45° и диван-конструктор только сдвигаются', () => {
  const list = [
    { id: 'a', kind: 'bed', x: 1000, y: 1000, w: 1000, h: 1000, rotation: 45 },
    { id: 's', kind: 'sofa', x: 4000, y: 1000, w: 2400, h: 900, rotation: 0, comp: defaultComp('sofa') },
    { id: 't', kind: 'dining-table', x: 7000, y: 1000, w: 1600, h: 900, rotation: 0, comp: defaultComp('dining-table') },
  ];
  const starts = groupStarts(list);
  const box = groupBounds(list);
  const res = stretchGroup(starts, box, 'e', { x: box.x + box.w * 2, y: 0 });
  const a = res.items.find((i) => i.id === 'a');
  assert.equal(a.w, 1000); assert.equal(a.h, 1000); assert.equal(a.rotation, 45);
  assert.ok(a.x > 1000);
  const s = res.items.find((i) => i.id === 's');
  assert.equal(starts.find((i) => i.id === 's').fixed, true);
  assert.equal(s.w, 2400); assert.equal(s.h, 900);
  assert.ok(s.x > 4000);
  // Стол со стульями (не фиксированный) растягивается, стулья пересчитаются по размеру стола.
  const t = res.items.find((i) => i.id === 't');
  assert.equal(t.w, Math.round(1600 * res.k)); assert.equal(t.h, 900);
});

test('масштаб за угол: противоположный угол неподвижен, всё ×k', () => {
  const list = items();
  const box = groupBounds(list); // 0,500 4000×2500
  const res = scaleGroup(groupStarts(list), box, 'se', { x: 8000, y: 5500 });
  assert.equal(res.k, 2);
  assert.equal(res.box.x, 0); assert.equal(res.box.y, 500);
  assert.equal(res.box.w, 8000); assert.equal(res.box.h, 5000);
  const a = res.items.find((i) => i.id === 'a');
  assert.equal(a.x, 2000); assert.equal(a.y, 1500); assert.equal(a.w, 4000); assert.equal(a.h, 2000);
  assert.equal(res.items.find((i) => i.id === 'c').rotation, 90);
});

test('масштаб за северо-западный угол и минимум', () => {
  const list = items();
  const box = groupBounds(list);
  const res = scaleGroup(groupStarts(list), box, 'nw', { x: 2000, y: 1750 }); // половина
  assert.equal(res.k, 0.5);
  assert.equal(res.box.x + res.box.w, 4000); assert.equal(res.box.y + res.box.h, 3000);
  const tiny = scaleGroup(groupStarts(list), box, 'nw', { x: 3999, y: 2999 });
  for (const it of tiny.items) assert.ok(Math.min(it.w, it.h) >= 100);
});
