// Ландшафт: постановка ровно по экрану при повёрнутом виде и режимы ручек
// (одиночный объект и группа) — core/landscape.js, core/landscape-handles.js.
// Запуск: node --test tests/landscape-handles.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';

import { createLandscapeObject, objectCorners, screenPlaceRotation } from '../core/landscape.js';
import {
  frameCorners, lsFrame, lsHandleInfo, lsHandleKey, lsHandleModes, lsStarts, nextLsHandle, rotateLs, scaleLs, screenAngle,
  stretchLs,
} from '../core/landscape-handles.js';

const deg2rad = (d) => (d * Math.PI) / 180;
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

test('постановка: поворот компенсирует угол вида, на экране — ровно', () => {
  assert.equal(screenPlaceRotation('planter-box', 0), 0, 'вид не повёрнут — 0');
  for (const viewDeg of [-20, 25, 90, -135]) {
    const view = deg2rad(viewDeg);
    const rot = screenPlaceRotation('planter-box', view);
    // Экран = R(view)·мир: на экране объект повёрнут на view + rotation.
    const onScreen = (((viewDeg + rot) % 360) + 360) % 360;
    assert.ok(near(onScreen, 0, 0.02) || near(onScreen, 360, 0.02), `вид ${viewDeg}° → ${rot}°`);
    assert.ok(near(screenPlaceRotation('planter-box', view, 90), (rot + 90) % 360, 1e-9), 'Пробел — +90° к экранному');
  }
  assert.equal(screenPlaceRotation('path', deg2rad(30)), 0, 'линия — по точкам');
  assert.equal(screenPlaceRotation('lawn-area', deg2rad(30)), 0, 'контур — по точкам');
  assert.equal(screenPlaceRotation('tree-pine', deg2rad(30)), 0, 'круглому угол вида не нужен');
  assert.equal(screenPlaceRotation('bench', deg2rad(-20)), 20);
  assert.equal(screenPlaceRotation('callout', deg2rad(-20)), 20, 'выноска — как раньше');
  // Верхняя сторона клумбы на экране горизонтальна.
  const view = deg2rad(-25);
  const o = createLandscapeObject('planter-box', 0, 0, { rotation: screenPlaceRotation('planter-box', view) });
  const [nw, ne] = objectCorners(o).map((p) => ({
    x: p.x * Math.cos(view) - p.y * Math.sin(view), y: p.x * Math.sin(view) + p.y * Math.cos(view),
  }));
  assert.ok(Math.abs(nw.y - ne.y) < 1, 'верхняя сторона горизонтальна на экране');
});

test('режимы: прямоугольник — 4, круг/растение — масштаб, линия — поворот и масштаб', () => {
  assert.deepEqual(lsHandleModes(createLandscapeObject('planter-box', 0, 0)), ['select', 'rotate', 'stretch', 'scale']);
  assert.deepEqual(lsHandleModes(createLandscapeObject('pad-round', 0, 0)), ['select', 'scale']);
  assert.deepEqual(lsHandleModes(createLandscapeObject('tree-oak', 0, 0)), ['select', 'scale']);
  const path = createLandscapeObject('path', 0, 0, { points: [{ x: 0, y: 0 }, { x: 4000, y: 0 }] });
  assert.deepEqual(lsHandleModes(path), ['select', 'rotate', 'scale']);
  const locked = createLandscapeObject('bench', 0, 0);
  locked.locked = true;
  assert.deepEqual(lsHandleModes(locked), ['select']);
});

test('повторные клики перебирают режимы; ключ — по выбору', () => {
  const box = createLandscapeObject('planter-box', 0, 0);
  const sel = { type: 'landscape', ids: [box.id] };
  const key = lsHandleKey(sel);
  const modes = lsHandleModes(box);
  let h = null;
  const seen = [];
  for (let i = 0; i < 4; i += 1) { h = nextLsHandle(h, key, modes); seen.push(h.mode); }
  assert.deepEqual(seen, ['rotate', 'stretch', 'scale', 'select']);
  const tree = createLandscapeObject('tree-oak', 0, 0);
  assert.equal(nextLsHandle(null, `ls:${tree.id}`, lsHandleModes(tree)).mode, 'scale', 'у растения сразу масштаб');
  assert.equal(lsHandleKey({ type: 'landscape', ids: ['b', 'a'] }), 'lsgroup:a,b');
  assert.equal(lsHandleKey({ type: 'item', id: 'x' }), null);
  const info = lsHandleInfo([box], sel, { id: key, mode: 'stretch' });
  assert.equal(info.mode, 'stretch');
  assert.equal(info.framed, false);
  assert.equal(lsHandleInfo([box], sel, { id: 'ls:other', mode: 'scale' }).mode, 'select', 'чужой режим не действует');
});

test('растяжение одного прямоугольника: противоположная сторона на месте, пределы типа', () => {
  const box = createLandscapeObject('planter-box', 0, 0, { rotation: 30 });
  const frame = lsFrame([box]);
  const nw = objectCorners(box).find((c) => c.id === 'nw');
  const a = deg2rad(30);
  const point = { x: box.x + (box.w / 2 + 1000) * Math.cos(a), y: box.y + (box.w / 2 + 1000) * Math.sin(a) };
  const { objects: [o] } = stretchLs(lsStarts([box]), frame, 'e', point);
  assert.equal(o.w, box.w + 1000);
  assert.equal(o.h, box.h);
  const nw2 = objectCorners(o).find((c) => c.id === 'nw');
  assert.ok(Math.hypot(nw2.x - nw.x, nw2.y - nw.y) < 2, 'западная сторона неподвижна');
  // Сжатие ниже минимума типа — упор в минимум.
  const tiny = stretchLs(lsStarts([box]), frame, 'e', { x: nw.x, y: nw.y }).objects[0];
  assert.equal(tiny.w, 600);
});

test('группа: рамка по экрану, поворот вокруг центра, масштаб от угла, растяжение', () => {
  const a = createLandscapeObject('planter-box', 0, 0);
  const b = createLandscapeObject('planter-box', 5000, 0);
  const view = deg2rad(-20);
  assert.equal(lsFrame([a, b], view).rotation, screenAngle(view));
  assert.equal(screenAngle(view), 20);
  const flat = lsFrame([a, b], 0);
  assert.deepEqual([flat.x, flat.y, flat.w, flat.h], [2500, 0, 8000, 1200]);
  const rot = rotateLs(lsStarts([a, b]), { x: flat.x, y: flat.y }, 90);
  assert.deepEqual(rot.map((o) => [o.x, o.y, o.rotation]), [[2500, -2500, 90], [2500, 2500, 90]]);
  // Масштаб ×1.5 за юго-восточный угол: северо-западный на месте.
  const se = frameCorners(flat).find((c) => c.id === 'se');
  const nw = frameCorners(flat).find((c) => c.id === 'nw');
  const big = scaleLs(lsStarts([a, b]), flat, 'se', { x: nw.x + (se.x - nw.x) * 1.5, y: nw.y + (se.y - nw.y) * 1.5 });
  assert.ok(near(big.k, 1.5, 1e-9));
  assert.deepEqual(big.objects.map((o) => [o.w, o.h]), [[4500, 1800], [4500, 1800]]);
  assert.ok(near(big.frame.x - big.frame.w / 2, nw.x), 'угол на месте');
  // Растяжение на восток на 2 м: размеры вдоль оси растут, запад на месте.
  const st = stretchLs(lsStarts([a, b]), flat, 'e', { x: flat.x + flat.w / 2 + 2000, y: 0 });
  assert.ok(near(st.k, 10000 / 8000));
  assert.equal(st.objects[0].w, 3750);
  assert.equal(st.objects[0].h, 1200);
  assert.equal(st.objects[0].x - st.objects[0].w / 2, -1500, 'левый край группы на месте');
});

test('линия и растение в коробе: поворот по точкам, растение только едет', () => {
  const path = createLandscapeObject('path', 0, 0, { points: [{ x: 0, y: 0 }, { x: 4000, y: 0 }] });
  const [r] = rotateLs(lsStarts([path]), { x: 2000, y: 0 }, 90);
  assert.deepEqual(r.points, [{ x: 2000, y: -2000 }, { x: 2000, y: 2000 }]);
  const box = createLandscapeObject('planter-box', 0, 0);
  const plant = createLandscapeObject('shrub-box', 500, 0);
  plant.parent = box.id;
  const out = scaleLs(lsStarts([box, plant]), lsFrame([box]), 'se', { x: box.w, y: box.h }, { about: 'center', moveOnly: new Set([plant.id]) });
  const p2 = out.objects.find((o) => o.id === plant.id);
  assert.equal(p2.w, plant.w, 'размер растения не меняется');
  assert.ok(p2.x > plant.x, 'растение отъехало вместе с бортом');
});
