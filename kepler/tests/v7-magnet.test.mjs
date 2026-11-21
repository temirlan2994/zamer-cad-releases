// Примагничивание блоков v7 (core/v7/magnet.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { addBlock, createBlock, createProject7 } from '../core/v7/model.js';
import { magnetEdges, magnetSnap } from '../core/v7/magnet.js';
import { derive } from '../core/v7/derive.js';

function project() {
  const p = createProject7();
  for (const [id, x, y, w, h, parentId = null] of [
    ['a', 0, 0, 4000, 3000], ['m', 4300, 200, 3000, 2600], ['big', 0, 5000, 8000, 4000], ['kid', 1000, 6000, 1500, 1500, 'big'],
  ]) addBlock(p, createBlock('living', x, y, w, h, { id, parentId }));
  return p;
}

test('прижимает вплотную с зазором перегородки; по X и Y независимо', () => {
  const p = project();
  const r = magnetSnap(p, 'm', { x: 4300, y: 200, w: 3000, h: 2600 });
  assert.equal(r.x, 4100, 'грань к грани + перегородка 100');
  assert.equal(r.dx, -200);
  assert.equal(r.y, 0, 'выравнивание верхних граней (−200 ≤ 300)');
  assert.deepEqual(r.guides.map((g) => [g.axis, g.at, g.kind, g.target]), [['x', 4100, 'contact', 'a'], ['y', 0, 'align', 'a']]);
  // После прижима derive видит одну общую перегородку.
  p.levels[0].blocks.find((b) => b.id === 'm').x = r.x;
  p.levels[0].blocks.find((b) => b.id === 'm').y = r.y;
  const res = derive(p, { cache: false });
  assert.ok(res.walls.some((w) => w.pair?.join() === 'a,m' && w.thickness === 100));
  // Своя толщина пары — свой зазор.
  p.levels[0].pairs['a|m'] = { thickness: 200 };
  assert.equal(magnetSnap(p, 'm', { x: 4300, y: 200, w: 3000, h: 2600 }).x, 4200);
});

test('не двигает при distance = 0, enabled = false и вне радиуса', () => {
  const p = project();
  const rect = { x: 4300, y: 200, w: 3000, h: 2600 };
  assert.deepEqual(magnetSnap(p, 'm', rect, { distance: 0 }), { x: 4300, y: 200, dx: 0, dy: 0, guides: [] });
  assert.deepEqual(magnetSnap(p, 'm', rect, { enabled: false }), { x: 4300, y: 200, dx: 0, dy: 0, guides: [] });
  const far = magnetSnap(p, 'm', { x: 4300, y: 200, w: 3000, h: 2600 }, { distance: 150 });
  assert.equal(far.dx, 0, '200 > 150 — по X не тянет');
});

test('вложенный блок — к внутренним граням родителя', () => {
  const p = project();
  const r = magnetSnap(p, 'kid', { x: 200, y: 5250, w: 1500, h: 1500 });
  assert.equal(r.x, 100, 'родитель x=0 + перегородка');
  assert.equal(r.y, 5100);
});

test('растяжение: подвижная грань — к соседу с зазором перегородки, неподвижная на месте', () => {
  const p = project();
  // Правую грань «a» тянем к «m» (m.x = 4300): 4250 → 4200 (зазор 100).
  const r = magnetEdges(p, 'a', { x: 0, y: 0, w: 4250, h: 3000 }, ['e']);
  assert.deepEqual(r.rect, { x: 0, y: 0, w: 4200, h: 3000 });
  assert.equal(r.guides[0].kind, 'contact');
  assert.equal(r.guides[0].edge, 'e');
  // Левую грань «m» — к «a» (a: 0…4000): 4050 → 4100.
  const l = magnetEdges(p, 'm', { x: 4050, y: 200, w: 3250, h: 2600 }, ['w']);
  assert.equal(l.rect.x, 4100);
  assert.equal(l.rect.x + l.rect.w, 7300, 'правая грань не двигается');
  // Дальше радиуса и выключенный магнит — без изменений.
  assert.deepEqual(magnetEdges(p, 'a', { x: 0, y: 0, w: 3000, h: 3000 }, ['e']).rect, { x: 0, y: 0, w: 3000, h: 3000 });
  assert.deepEqual(magnetEdges(p, 'a', { x: 0, y: 0, w: 4250, h: 3000 }, ['e'], { enabled: false }).rect.w, 4250);
  // Вложенный — к внутренней грани родителя.
  const k = magnetEdges(p, 'kid', { x: 1000, y: 6000, w: 6750, h: 1500 }, ['e']);
  assert.equal(k.rect.x + k.rect.w, 7900);
});
