// Ландшафт: сдвиг ребра контура как линии (core/landscape-handles.js moveEdgeLs).
// Запуск: node --test tests/landscape-edge.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';

import { edgeFrame, moveEdgeLs } from '../core/landscape-handles.js';

const RECT = [{ x: 0, y: 0 }, { x: 4000, y: 0 }, { x: 4000, y: 3000 }, { x: 0, y: 3000 }];
const nearPt = (p, x, y, eps = 1) => Math.abs(p.x - x) <= eps && Math.abs(p.y - y) <= eps;

test('прямоугольник: нижнее ребро вниз — боковые удлиняются', () => {
  // Ребро 2: (4000,3000) → (0,3000), нормаль (0,−1) — «вниз» это −d.
  const r = moveEdgeLs(RECT, 2, true, -500);
  assert.deepEqual(r.points, [{ x: 0, y: 0 }, { x: 4000, y: 0 }, { x: 4000, y: 3500 }, { x: 0, y: 3500 }]);
  assert.equal(r.clamped, false);
  // Исходник не тронут.
  assert.equal(RECT[2].y, 3000);
});

test('шаг: линия ребра встаёт на сетку, без шага — как есть', () => {
  assert.equal(moveEdgeLs(RECT, 2, true, -537, { snap: 100 }).points[2].y, 3500);
  const off = [...RECT.slice(0, 2), { x: 4000, y: 3020 }, { x: 0, y: 3020 }];
  const r = moveEdgeLs(off, 2, true, -537, { snap: 100 });
  assert.equal(r.points[2].y, 3600);
  assert.equal(r.points[3].y, 3600);
  assert.equal(moveEdgeLs(off, 2, true, -537).points[2].y, 3557);
  // Правое ребро (вертикальное) — по x.
  assert.equal(moveEdgeLs(RECT, 1, true, -0, { snap: 100 }).d, 0);
  const e = moveEdgeLs(RECT, 1, true, edgeFrame(RECT, 1).n.x * 260, { snap: 100 });
  assert.equal(e.points[1].x, 4300);
  assert.equal(e.points[2].x, 4300);
});

test('Г-образный: внутреннее ребро — смежные остаются на своих прямых', () => {
  const L = [{ x: 0, y: 0 }, { x: 4000, y: 0 }, { x: 4000, y: 2000 }, { x: 2000, y: 2000 }, { x: 2000, y: 4000 }, { x: 0, y: 4000 }];
  const r = moveEdgeLs(L, 2, true, -500);
  assert.ok(nearPt(r.points[2], 4000, 2500));
  assert.ok(nearPt(r.points[3], 2000, 2500));
  assert.deepEqual(r.points[4], L[4]);
  // Дальше нижней грани — упор: смежное ребро не выворачивается.
  const far = moveEdgeLs(L, 2, true, -2600, { snap: 100 });
  assert.equal(far.clamped, true);
  assert.equal(far.points[3].y, 3900);
  assert.equal(far.points[2].y, 3900);
});

test('трапеция: концы скользят по наклонным боковым', () => {
  const T = [{ x: 0, y: 0 }, { x: 4000, y: 0 }, { x: 3000, y: 3000 }, { x: 1000, y: 3000 }];
  const r = moveEdgeLs(T, 2, true, -1000);
  assert.ok(nearPt(r.points[2], 2667, 4000), JSON.stringify(r.points[2]));
  assert.ok(nearPt(r.points[3], 1333, 4000), JSON.stringify(r.points[3]));
});

test('наклонное ребро: сдвиг вдоль нормали кратен шагу, ребро параллельно', () => {
  const P = [{ x: 0, y: 0 }, { x: 4000, y: 0 }, { x: 4000, y: 2000 }, { x: 0, y: 3000 }];
  const f0 = edgeFrame(P, 2);
  const r = moveEdgeLs(P, 2, true, 530, { snap: 100 });
  assert.equal(r.d, 500);
  const f1 = edgeFrame(r.points, 2);
  assert.ok(Math.abs(f0.u.x * f1.u.y - f0.u.y * f1.u.x) < 1e-3, 'параллельно');
  const dist = (r.points[2].x - P[2].x) * f0.n.x + (r.points[2].y - P[2].y) * f0.n.y;
  assert.ok(Math.abs(dist - 500) < 2, `расстояние ${dist}`);
  // Концы — на своих вертикальных боковых.
  assert.equal(r.points[2].x, 4000);
  assert.equal(r.points[3].x, 0);
});

test('схлопывание: упор, форма не ломается', () => {
  // Нижнее ребро вверх на 3500 — выше верхнего нельзя.
  const r = moveEdgeLs(RECT, 2, true, 3500, { snap: 100 });
  assert.equal(r.clamped, true);
  assert.equal(r.points[2].y, 100);
  assert.equal(r.points[3].y, 100);
  const free = moveEdgeLs(RECT, 2, true, 3500);
  assert.ok(free.points[2].y >= 1 && free.points[2].y < 5, `без шага — у самого края (${free.points[2].y})`);
  // Треугольник: ребро к вершине — упор до вырождения.
  const tri = [{ x: 0, y: 0 }, { x: 4000, y: 0 }, { x: 2000, y: 3000 }];
  const t = moveEdgeLs(tri, 0, true, 5000, { snap: 100 });
  assert.equal(t.clamped, true);
  assert.ok(t.points[0].y < 3000 && t.points[1].y < 3000);
  assert.ok(t.points[1].x > t.points[0].x, 'ребро не вывернулось');
});

test('открытая линия: конец без соседа едет по нормали', () => {
  const pl = [{ x: 0, y: 0 }, { x: 2000, y: 0 }, { x: 2000, y: 2000 }];
  const r = moveEdgeLs(pl, 0, false, 500);
  assert.deepEqual(r.points, [{ x: 0, y: 500 }, { x: 2000, y: 500 }, { x: 2000, y: 2000 }]);
});
