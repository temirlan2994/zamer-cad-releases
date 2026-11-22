// Привязки черчения линий (core/draw-snap.js): полярные лучи и орто,
// выравнивание X/Y, объектные привязки, приоритеты, Shift, динамический ввод.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  displayAngle, dynamicPoint, formatLength, parseDynamicLength, snapDrawPoint,
} from '../core/draw-snap.js';

// Масштаб 0,1 px/мм: допуск 10 px = 100 мм; сетка 100 мм.
const base = { scale: 0.1, grid: 100 };
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;
const at = (r, x, y, eps = 1e-6) => assert.ok(near(r.point.x, x, eps) && near(r.point.y, y, eps), `${JSON.stringify(r.point)} ≠ ${x};${y} (${r.kind})`);

test('полярный луч 90°: почти вертикаль прилипает, подпись «длина · угол»', () => {
  const r = snapDrawPoint({ ...base, cursor: { x: 30, y: -2010 }, prev: { x: 0, y: 0 } });
  assert.equal(r.kind, 'polar');
  at(r, 0, -2000);
  assert.equal(r.tooltip, '2,00 м · 90°');
  assert.ok(r.guides.some((g) => g.type === 'polar'));
});

test('допуск в пикселях: дальше 10 px от луча — сетка; при крупном масштабе — снова луч', () => {
  const far = snapDrawPoint({ ...base, cursor: { x: 330, y: -2010 }, prev: { x: 0, y: 0 } });
  assert.equal(far.kind, 'grid');
  at(far, 300, -2000);
  const zoomed = snapDrawPoint({ ...base, scale: 0.02, cursor: { x: 330, y: -2010 }, prev: { x: 0, y: 0 } });
  assert.equal(zoomed.kind, 'polar', 'при 0,02 px/мм допуск 500 мм');
});

test('полярный луч 45° (длина по сетке), шаг 90° его не даёт', () => {
  const r = snapDrawPoint({ ...base, cursor: { x: 1020, y: -980 }, prev: { x: 0, y: 0 } });
  assert.equal(r.kind, 'polar');
  assert.ok(near(Math.hypot(r.point.x, r.point.y), 1400, 1e-6));
  assert.ok(near(displayAngle({ x: 0, y: 0 }, r.point), 45, 1e-6));
  const r90 = snapDrawPoint({ ...base, cursor: { x: 1020, y: -980 }, prev: { x: 0, y: 0 }, opts: { polarStep: 90 } });
  assert.notEqual(r90.kind, 'polar');
});

test('орто (F8) и временное орто (Ctrl): всегда по оси от последней точки', () => {
  const r = snapDrawPoint({ ...base, cursor: { x: 1000, y: -400 }, prev: { x: 0, y: 0 }, opts: { ortho: true } });
  assert.equal(r.kind, 'ortho');
  at(r, 1000, 0);
  const t = snapDrawPoint({ ...base, cursor: { x: 300, y: 1700 }, prev: { x: 0, y: 0 }, opts: { tempOrtho: true } });
  at(t, 0, 1700);
});

test('выравнивание X/Y от двух вершин: точка пересечения со значком', () => {
  const shapes = [[{ x: 500, y: 3000 }, { x: 500, y: 4000 }], [{ x: 2000, y: 1000 }, { x: 3000, y: 1000 }]];
  const r = snapDrawPoint({ ...base, cursor: { x: 530, y: 1040 }, otherShapes: shapes });
  assert.equal(r.kind, 'track');
  at(r, 500, 1000);
  assert.equal(r.guides.filter((g) => g.type === 'align').length, 2);
  assert.ok(r.markers.some((m) => m.kind === 'track'));
  assert.equal(r.markers.filter((m) => m.kind === 'source').length, 2, 'подсветка исходных вершин');
});

test('выравнивание по одной вершине + полярный луч', () => {
  const r = snapDrawPoint({
    ...base, cursor: { x: 2470, y: 20 }, prev: { x: 0, y: 0 }, otherShapes: [[{ x: 2500, y: 5000 }, { x: 2500, y: 6000 }]],
  });
  assert.equal(r.kind, 'track');
  at(r, 2500, 0);
});

test('объектные привязки: конец, середина, пересечение, центр', () => {
  const shapes = [[{ x: -1000, y: 50 }, { x: 1000, y: 50 }], [{ x: 300, y: -1000 }, { x: 300, y: 1000 }]];
  const end = snapDrawPoint({ ...base, cursor: { x: 970, y: 70 }, otherShapes: shapes });
  assert.equal(end.kind, 'end'); at(end, 1000, 50);
  assert.equal(end.label, 'Конец');
  const int = snapDrawPoint({ ...base, cursor: { x: 330, y: 30 }, otherShapes: shapes });
  assert.equal(int.kind, 'int'); at(int, 300, 50);
  const mid = snapDrawPoint({ ...base, cursor: { x: 30, y: 60 }, otherShapes: shapes });
  assert.equal(mid.kind, 'mid'); at(mid, 0, 50);
  const ctr = snapDrawPoint({ ...base, cursor: { x: 5040, y: 5030 }, circles: [{ x: 5000, y: 5000 }] });
  assert.equal(ctr.kind, 'center'); at(ctr, 5000, 5000);
});

test('перпендикуляр к отрезку от последней точки', () => {
  const r = snapDrawPoint({
    ...base, cursor: { x: 1030, y: 40 }, prev: { x: 0, y: 0 }, otherShapes: [[{ x: 1000, y: -1000 }, { x: 1000, y: 3000 }]],
  });
  assert.equal(r.kind, 'perp');
  at(r, 1000, 0);
  assert.equal(r.label, 'Перпендикуляр');
});

test('параллель выбранному отрезку (после задержки наведения)', () => {
  const a = { x: 5000, y: 5000 };
  const b = { x: 5000 + 866.0254, y: 5000 - 500 };
  const r = snapDrawPoint({ ...base, cursor: { x: 1740, y: -985 }, prev: { x: 0, y: 0 }, hoverSeg: { a, b } });
  assert.equal(r.kind, 'parallel');
  assert.ok(near(displayAngle({ x: 0, y: 0 }, r.point), 30, 1e-3));
  assert.ok(near(Math.hypot(r.point.x, r.point.y), 2000, 1e-6));
  assert.ok(r.guides.some((g) => g.type === 'seg'));
});

test('приоритеты: конец > середина/луч; выравнивание > полярный луч; луч > сетка', () => {
  // Вершина у полярного луча — побеждает конец.
  const end = snapDrawPoint({ ...base, cursor: { x: 0, y: -2000 }, prev: { x: 0, y: 0 }, otherShapes: [[{ x: 40, y: -2000 }, { x: 40, y: -6000 }]] });
  assert.equal(end.kind, 'end'); at(end, 40, -2000);
  // Конец у середины: короткий отрезок — середина и конец рядом, побеждает ближайший конец.
  const em = snapDrawPoint({ ...base, cursor: { x: 95, y: 0 }, otherShapes: [[{ x: 0, y: 0 }, { x: 120, y: 0 }]] });
  assert.equal(em.kind, 'end');
  // Линия выравнивания, параллельная активному лучу, не перебивает луч от последней точки.
  const pr = snapDrawPoint({ ...base, cursor: { x: 20, y: -2000 }, prev: { x: 0, y: 0 }, otherShapes: [[{ x: 60, y: 5000 }, { x: 60, y: 9000 }]] });
  assert.equal(pr.kind, 'polar'); at(pr, 0, -2000);
});

test('Shift — все привязки выключены', () => {
  const r = snapDrawPoint({
    ...base, cursor: { x: 1020.4, y: -980.6 }, prev: { x: 0, y: 0 }, otherShapes: [[{ x: 1000, y: -1000 }, { x: 0, y: -3000 }]], opts: { free: true },
  });
  assert.equal(r.kind, 'free');
  at(r, 1020, -981);
  assert.equal(r.guides.length + r.markers.length, 0);
});

test('повёрнутый вид: лучи и орто — по осям экрана', () => {
  const axis = (-30 * Math.PI) / 180;
  const dir = { x: Math.cos(axis), y: Math.sin(axis) };
  const r = snapDrawPoint({ ...base, axis, cursor: { x: dir.x * 2000 + 20, y: dir.y * 2000 + 30 }, prev: { x: 0, y: 0 } });
  assert.equal(r.kind, 'polar');
  assert.ok(near(displayAngle({ x: 0, y: 0 }, r.point, axis), 0, 1e-6));
  assert.ok(near(r.point.x, dir.x * 2000, 1e-6) && near(r.point.y, dir.y * 2000, 1e-6));
});

test('динамический ввод: длина по направлению, угол, единицы', () => {
  assert.deepEqual(dynamicPoint({ prev: { x: 0, y: 0 }, toward: { x: 0, y: -500 }, length: 3500 }), { x: 0, y: -3500 });
  assert.deepEqual(dynamicPoint({ prev: { x: 100, y: 100 }, toward: null, length: 1000, angle: 90 }), { x: 100, y: -900 });
  assert.deepEqual(dynamicPoint({ prev: { x: 0, y: 0 }, toward: { x: 0, y: 1 }, length: 2000, angle: 0 }), { x: 2000, y: 0 });
  assert.equal(dynamicPoint({ prev: { x: 0, y: 0 }, length: 0 }), null);
  assert.equal(parseDynamicLength('3,5', 'm'), 3500);
  assert.equal(parseDynamicLength('3500', 'mm'), 3500);
  assert.equal(parseDynamicLength('abc', 'mm'), null);
  assert.equal(formatLength(3450), '3,45 м');
});
