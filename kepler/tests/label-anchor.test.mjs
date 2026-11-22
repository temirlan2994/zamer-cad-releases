import test from 'node:test';
import assert from 'node:assert/strict';
import {
  labelObstacles, planTextScale, rectOverlap, roomLabelAnchor,
} from '../core/label-anchor.js';
import { deriveWalls } from '../core/walls.js';

const room = { id: 'r1', name: 'Гостиная', x: 0, y: 0, w: 6000, h: 4000 };
const box = (p, w, h) => ({ x: p.x - w / 2, y: p.y - h / 2, w, h });

test('свободная комната — подпись в центре', () => {
  const a = roomLabelAnchor(room, [], { labelW: 1600, labelH: 900 });
  assert.deepEqual([a.x, a.y, a.moved], [3000, 2000, false]);
});

test('стол в центре — подпись уходит в свободную часть', () => {
  const table = { x: 2000, y: 1300, w: 2000, h: 1400 };
  const a = roomLabelAnchor(room, [table], { labelW: 1600, labelH: 900 });
  assert.equal(a.moved, true);
  assert.equal(rectOverlap(box(a, 1600, 900), table), 0);
  // Рамка подписи внутри комнаты.
  const b = box(a, 1600, 900);
  assert.ok(b.x >= 0 && b.y >= 0 && b.x + b.w <= 6000 && b.y + b.h <= 4000);
});

test('собственная рамка комнаты не считается препятствием', () => {
  const a = roomLabelAnchor(room, [{ x: 0, y: 0, w: 6000, h: 4000, roomId: 'r1' }], { labelW: 1600, labelH: 900 });
  assert.equal(a.moved, false);
});

test('всё занято — fallback в центр', () => {
  const rug = { x: -100, y: -100, w: 6200, h: 4200 };
  const a = roomLabelAnchor(room, [rug], { labelW: 1600, labelH: 900 });
  assert.deepEqual([a.x, a.y, a.moved], [3000, 2000, false]);
});

test('подпись больше комнаты — центр', () => {
  const small = { id: 's', x: 0, y: 0, w: 900, h: 900 };
  const a = roomLabelAnchor(small, [{ x: 300, y: 300, w: 300, h: 300 }], { labelW: 2000, labelH: 1000 });
  assert.equal(a.moved, false);
});

test('Г-образная комната: точка остаётся внутри контура', () => {
  const l = { id: 'l', x: 0, y: 0, w: 6000, h: 6000, notch: { corner: 'ne', w: 3000, h: 3000 } };
  const blocker = { x: 0, y: 3000, w: 6000, h: 3000 };
  const a = roomLabelAnchor(l, [blocker], { labelW: 1200, labelH: 700 });
  assert.ok(a.x < 3000 && a.y < 3000, `${a.x},${a.y}`);
});

test('labelObstacles: мебель, дуга двери, вложенная комната', () => {
  const project = {
    settings: {},
    rooms: [room, { id: 'r2', name: 'Санузел', x: 6000, y: 0, w: 2000, h: 2000 }],
    openings: [{ id: 'd1', kind: 'door', roomId: 'r1', side: 2, offset: 1000, width: 900, swingIn: true }],
    items: [{ id: 'i1', kind: 'table', x: 3000, y: 2000, w: 1200, h: 800, rotation: 90 }],
  };
  const obs = labelObstacles(project, deriveWalls(project));
  const item = obs.find((o) => o.kind === 'item');
  assert.deepEqual([Math.round(item.w), Math.round(item.h)], [800, 1200]);
  assert.ok(obs.some((o) => o.kind === 'door' && o.w >= 800 && o.h >= 800));
  assert.equal(obs.filter((o) => o.kind === 'room').length, 2);
});

test('planTextScale: порог подписей и размеров', () => {
  assert.deepEqual(planTextScale(60), { labels: true, font: 13, dims: true });
  const far = planTextScale(4.2); // ~1:900
  assert.equal(far.labels, false);
  assert.equal(far.dims, false);
  const mid = planTextScale(18); // подписи ещё видны, размеры уже нет
  assert.equal(mid.labels, true);
  assert.equal(mid.dims, false);
  assert.equal(planTextScale(4.2, { print: true }).labels, true);
  assert.equal(planTextScale(4.2, { print: true }).font, 7);
});
