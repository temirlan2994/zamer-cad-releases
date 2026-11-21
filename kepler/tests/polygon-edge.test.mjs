// Ребро проёма: фиксация движения вдоль линии или перпендикулярно ей.
import test from 'node:test';
import assert from 'node:assert/strict';

import { dragPolygonEdge, polygonEdgeAxis, polygonEdgeMode } from '../core/polygon-edge.js';

const RECT = [{ x: 0, y: 0 }, { x: 4000, y: 0 }, { x: 4000, y: 3000 }, { x: 0, y: 3000 }];

test('доминирующая проекция выбирает ось один раз', () => {
  assert.equal(polygonEdgeMode(RECT, 0, { x: 500, y: 80 }), 'along');
  assert.equal(polygonEdgeMode(RECT, 0, { x: 80, y: 500 }), 'normal');
  assert.deepEqual(polygonEdgeAxis(RECT, 0, 'along'), { x: 1, y: 0 });
  assert.deepEqual(polygonEdgeAxis(RECT, 0, 'normal'), { x: -0, y: 1 });
});

test('вдоль ребра едут ровно две его вершины', () => {
  const r = dragPolygonEdge(RECT, 0, { x: 537, y: 20 }, { mode: 'along', snap: 100 });
  assert.equal(r.d, 500);
  assert.deepEqual(r.points, [
    { x: 500, y: 0 }, { x: 4500, y: 0 }, { x: 4000, y: 3000 }, { x: 0, y: 3000 },
  ]);
  assert.deepEqual(RECT[0], { x: 0, y: 0 }, 'исходник не меняется');
});

test('перпендикулярный сдвиг сохраняет соседние линии', () => {
  const r = dragPolygonEdge(RECT, 0, { x: 10, y: 470 }, { mode: 'normal', snap: 100 });
  assert.equal(r.d, 500);
  assert.deepEqual(r.points, [
    { x: 0, y: 500 }, { x: 4000, y: 500 }, { x: 4000, y: 3000 }, { x: 0, y: 3000 },
  ]);
});

test('наклонное ребро движется строго по выбранной оси', () => {
  const P = [{ x: 0, y: 0 }, { x: 1000, y: 1000 }, { x: 0, y: 3000 }];
  const a = dragPolygonEdge(P, 0, { x: 410, y: 390 }, { mode: 'along', snap: 100 });
  assert.equal(a.d, 600);
  assert.ok(Math.abs(a.delta.x - a.delta.y) < 1e-6);
  const n = dragPolygonEdge(P, 0, { x: -380, y: 420 }, { mode: 'normal', snap: 100 });
  assert.equal(n.d, 600);
  assert.ok(Math.abs(n.delta.x + n.delta.y) < 1e-6);
});

