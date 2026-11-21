// Ландшафт: массив копий (вдоль линии, по кругу/дуге, прямоугольный) и
// засадка контура растениями (Poisson-disk, доли видов, seed, отступ, короб).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLandscapeObject, normalizeLandscape, planterInner } from '../core/landscape.js';
import { childrenOf, withChildren } from '../core/landscape-build.js';
import {
  arrayCopies, buildArray, canFill, crownR, fillPolygonOf, groupBase, linePositions, plantFill, plantFillObject,
  polarPositions, rectPositions,
} from '../core/landscape-array.js';
import { pointInPolygon } from '../core/zamer/geometry.js';

const near = (a, b, tol = 1) => Math.abs(a - b) <= tol;
const rect = (x0, y0, x1, y1) => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
const edgeDist = (p, poly) => Math.min(...poly.map((a, i) => {
  const b = poly[(i + 1) % poly.length];
  const dx = b.x - a.x; const dy = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(a.x + dx * t - p.x, a.y + dy * t - p.y);
}));
const noOverlap = (list) => {
  for (let i = 0; i < list.length; i += 1) {
    for (let j = i + 1; j < list.length; j += 1) {
      const a = list[i]; const b = list[j];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (d < crownR(a.kind, Math.max(a.w, a.h)) + crownR(b.kind, Math.max(b.w, b.h))) return false;
    }
  }
  return true;
};

test('массив вдоль линии: шаг, количество, поворот по направлению', () => {
  const line = [{ x: 0, y: 0 }, { x: 4000, y: 0 }, { x: 4000, y: 3000 }];
  const bySte = linePositions(line, { step: 1000 });
  assert.equal(bySte.length, 8, '0…7000 через 1000');
  assert.deepEqual(bySte[5], { x: 4000, y: 1000, rot: 0 });
  const byCount = linePositions(line, { count: 3 });
  assert.deepEqual(byCount.map((p) => [p.x, p.y]), [[0, 0], [3500, 0], [4000, 3000]]);
  const aligned = linePositions(line, { step: 2000, align: true });
  assert.equal(aligned[0].rot, 0);
  assert.ok(near(aligned[aligned.length - 1].rot, 90, 0.01), 'второй отрезок вниз (Y вниз) — +90°');
  assert.deepEqual(linePositions([{ x: 0, y: 0 }], { step: 100 }), []);
});

test('массив копий: новые id, место оригинала пропущено, поворот вокруг позиции', () => {
  const bench = createLandscapeObject('bench', 0, 0);
  const pos = linePositions([{ x: 0, y: 0 }, { x: 0, y: 3000 }], { step: 1000, align: true });
  const copies = arrayCopies([bench], groupBase([bench]), pos);
  assert.equal(copies.length, 3, 'первая позиция — сам оригинал');
  assert.equal(new Set([...copies.map((c) => c.id), bench.id]).size, 4);
  assert.deepEqual(copies.map((c) => c.y), [1000, 2000, 3000]);
  assert.ok(copies.every((c) => c.rotation === 0), 'прямая линия — без поворота');
  const turn = arrayCopies([bench], { x: 0, y: 0 }, [{ x: 5000, y: 0, rot: 90 }]);
  assert.deepEqual([turn[0].x, turn[0].y, turn[0].rotation], [5000, 0, 90]);
});

test('по кругу: полный круг, дуга с концами, радиус задан', () => {
  const base = { x: 3000, y: 0 };
  const full = polarPositions(base, { center: { x: 0, y: 0 }, count: 4, angle: 360 });
  assert.deepEqual(full.map((p) => [p.x, p.y]), [[3000, 0], [0, 3000], [-3000, 0], [0, -3000]]);
  assert.deepEqual(full.map((p) => p.rot), [0, 90, 180, 270]);
  const arc = polarPositions(base, { center: { x: 0, y: 0 }, count: 3, angle: 90, align: false });
  assert.deepEqual(arc.map((p) => [p.x, p.y, p.rot]), [[3000, 0, 0], [2121, 2121, 0], [0, 3000, 0]]);
  const big = polarPositions(base, { center: { x: 0, y: 0 }, radius: 5000, count: 2, angle: 360 });
  assert.deepEqual(big.map((p) => [p.x, p.y]), [[5000, 0], [-5000, 0]]);
  // Опорная точка = центр — первая позиция сверху (−Y).
  assert.deepEqual(polarPositions({ x: 0, y: 0 }, { center: { x: 0, y: 0 }, radius: 1000, count: 1 }).map((p) => [p.x, p.y]), [[0, -1000]]);
  const tree = createLandscapeObject('tree-fruit', 3000, 0);
  const ring = arrayCopies([tree], groupBase([tree]), full);
  assert.equal(ring.length, 3, 'оригинал + 3 копии = 4 по кругу');
});

test('прямоугольный: ряды × столбцы, шаги, отрицательный шаг', () => {
  const pos = rectPositions({ x: 100, y: 200 }, { rows: 2, cols: 3, dx: 1500, dy: -1000 });
  assert.equal(pos.length, 6);
  assert.deepEqual(pos.map((p) => [p.x, p.y]).slice(0, 4), [[100, 200], [1600, 200], [3100, 200], [100, -800]]);
  const lamp = createLandscapeObject('lamp', 100, 200);
  const res = buildArray([lamp], [lamp], { mode: 'rect', rows: 2, cols: 3, dx: 1500, dy: -1000 });
  assert.equal(res.objects.length, 5);
  assert.deepEqual(res.base, { x: 100, y: 200 });
});

test('массив короба с растениями: parent копий — на свою копию короба', () => {
  const box = createLandscapeObject('planter-box', 0, 0);
  const fl = createLandscapeObject('flowers-clump', 500, 0, { parent: box.id });
  const objs = [box, fl];
  const group = objs.filter((o) => withChildren(objs, [box.id]).has(o.id));
  const res = buildArray(group, [box], { mode: 'rect', rows: 1, cols: 3, dx: 4000, dy: 0 });
  assert.equal(res.objects.length, 4);
  const boxes = res.objects.filter((o) => o.kind === 'planter-box');
  for (const b of boxes) {
    const kids = childrenOf(res.objects, b.id);
    assert.equal(kids.length, 1);
    assert.equal(kids[0].x - b.x, 500);
  }
  // Поворот по кругу: растение крутится вместе с коробом.
  const ring = buildArray(group, [box], { mode: 'polar', center: { x: 0, y: 4000 }, count: 2, angle: 360 });
  const b2 = ring.objects.find((o) => o.kind === 'planter-box');
  const k2 = childrenOf(ring.objects, b2.id)[0];
  assert.deepEqual([b2.x, b2.y, b2.rotation], [0, 8000, 180]);
  assert.deepEqual([k2.x, k2.y], [-500, 8000]);
  // Сохранение проекта: схема та же, parent копий валиден.
  const norm = normalizeLandscape({ objects: [...objs, ...ring.objects] });
  assert.equal(norm.objects.filter((o) => o.parent).length, 2);
});

test('засадка: строго внутри с отступом, кроны не пересекаются, seed повторяем', () => {
  const poly = [{ x: 0, y: 0 }, { x: 8000, y: 0 }, { x: 8000, y: 5000 }, { x: 3000, y: 6000 }, { x: 0, y: 4000 }];
  const opts = { mix: [{ kind: 'shrub-box' }], jitter: 1, margin: 300, seed: 7 };
  const a = plantFill(poly, opts);
  assert.ok(a.length > 15, `посажено ${a.length}`);
  const r = crownR('shrub-box');
  for (const o of a) {
    assert.ok(pointInPolygon(o, poly), 'центр внутри');
    assert.ok(edgeDist(o, poly) >= r + 300 - 0.5, 'крона с отступом внутри');
  }
  assert.ok(noOverlap(a), 'кроны не пересекаются');
  const b = plantFill(poly, opts);
  assert.deepEqual(a.map((o) => [o.x, o.y, o.rotation]), b.map((o) => [o.x, o.y, o.rotation]), 'тот же seed — то же');
  const c = plantFill(poly, { ...opts, seed: 8 });
  assert.notDeepEqual(a.map((o) => [o.x, o.y]), c.map((o) => [o.x, o.y]), 'другой seed — другой рисунок');
  // Без разброса — ровная шахматка, шаг соблюдён.
  const grid = plantFill(rect(0, 0, 6000, 6000), { mix: [{ kind: 'shrub-box' }], jitter: 0, step: 1500, margin: 0 });
  assert.ok(grid.length >= 9);
  for (let i = 0; i < grid.length; i += 1) {
    for (let j = i + 1; j < grid.length; j += 1) assert.ok(Math.hypot(grid[i].x - grid[j].x, grid[i].y - grid[j].y) >= 1500 - 4);
  }
  assert.ok(grid.every((o) => o.rotation === 0));
});

test('засадка набором видов: доли соблюдаются, мелкие заполняют пустоты, обход стоящих', () => {
  const poly = rect(0, 0, 20000, 12000);
  const mix = [{ kind: 'flowers-clump', share: 3 }, { kind: 'grass-clump', share: 1 }];
  const list = plantFill(poly, { mix, jitter: 0.7, seed: 3, margin: 0 });
  const fl = list.filter((o) => o.kind === 'flowers-clump').length;
  const gr = list.filter((o) => o.kind === 'grass-clump').length;
  assert.ok(list.length > 100);
  assert.ok(near(fl / list.length, 0.75, 0.08), `доля цветов ${(fl / list.length).toFixed(2)}`);
  assert.ok(gr > 0);
  assert.ok(noOverlap(list));
  const circles = [{ x: 10000, y: 6000, r: 2000 }];
  const around = plantFill(poly, { mix, jitter: 0.7, seed: 3, circles });
  assert.ok(around.every((o) => Math.hypot(o.x - 10000, o.y - 6000) >= 2000 + crownR(o.kind)), 'обходит стоящее дерево');
  assert.deepEqual(plantFill(poly, { mix: [{ kind: 'nope' }] }), []);
  assert.deepEqual(plantFill(rect(0, 0, 300, 300), { mix: [{ kind: 'shrub-box' }] }), [], 'не влезает — пусто');
});

test('засадить объект: газон-контур (обход дорожки), пятно, короб через parent', () => {
  const lawn = createLandscapeObject('lawn-area', 0, 0, { points: rect(0, 0, 10000, 6000) });
  const path = createLandscapeObject('path', 0, 0, { points: [{ x: 5000, y: -1000 }, { x: 5000, y: 7000 }], width: 1200 });
  const tree = createLandscapeObject('tree-fruit', 2000, 3000);
  const objs = [lawn, path, tree];
  assert.ok(canFill(lawn) && !canFill(path) && !canFill(createLandscapeObject('paving-area', 0, 0, { points: rect(0, 0, 10, 10) })));
  const list = plantFillObject(objs, lawn, { mix: [{ kind: 'shrub-box' }], jitter: 0.5, seed: 1, margin: 100 });
  assert.ok(list.length > 10);
  const r = crownR('shrub-box');
  assert.ok(list.every((o) => Math.abs(o.x - 5000) >= 600 + r - 1), 'не на дорожке');
  assert.ok(list.every((o) => Math.hypot(o.x - 2000, o.y - 3000) >= 2000 + r), 'не под деревом');
  assert.ok(list.every((o) => !o.parent));
  // Пятно (эллипс): внутри контура.
  const patch = createLandscapeObject('lawn-patch', 0, 0, { w: 6000, h: 3000 });
  const pl = plantFillObject([patch], patch, { mix: [{ kind: 'flowers-clump' }], seed: 2, margin: 0 });
  assert.ok(pl.length > 5 && pl.every((o) => pointInPolygon(o, fillPolygonOf(patch))));
  // Короб: в засыпке, привязаны к коробу, обходят уже посаженные.
  const box = createLandscapeObject('planter-area', 0, 0, { points: rect(0, 0, 6000, 3000) });
  const old = createLandscapeObject('shrub-box', 1000, 1500, { parent: box.id });
  const kids = plantFillObject([box, old], box, { mix: [{ kind: 'flowers-clump' }], seed: 5, margin: 0 });
  assert.ok(kids.length > 3);
  const inner = planterInner(box);
  for (const k of kids) {
    assert.equal(k.parent, box.id);
    assert.ok(pointInPolygon(k, inner));
    assert.ok(Math.hypot(k.x - old.x, k.y - old.y) >= 450 + 400);
  }
});
