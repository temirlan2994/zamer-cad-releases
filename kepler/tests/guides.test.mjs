// Умные направляющие перемещения (core/guides.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { guideFrames, mergeWithGrid, movingBoxes, prepareGuides, snapGuides } from '../core/guides.js';

const rect = (x, y, w, h, id) => ({ id, pts: [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }] });
const run = (targets, moving, delta, opts = {}, angles = [0]) => {
  const index = prepareGuides(targets, angles);
  return snapGuides(index, movingBoxes(index, moving), delta, { tol: 10, ...opts });
};
const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);

test('левые края совпадают: сдвиг по X, направляющая align/left', () => {
  const res = run([rect(0, 0, 1000, 1000, 'a')], [rect(0, 2000, 500, 500)], { x: 7, y: 0 });
  assert.equal(res.snapped, true);
  near(res.delta.x, 0);
  near(res.delta.y, 0);
  assert.deepEqual(res.axes, { x: true, y: false });
  const g = res.guides.find((x) => x.axis === 'x');
  assert.equal(g.kind, 'left');
  near(g.from.x, 0);
  assert.ok(g.label, 'подпись расстояния до объекта');
});

test('правые края и центры', () => {
  const right = run([rect(0, 0, 1000, 1000)], [rect(400, 2000, 600, 600)], { x: 6, y: 0 });
  near(right.delta.x, 0);
  assert.equal(right.guides[0].kind, 'right');
  const center = run([rect(0, 0, 1000, 1000)], [rect(300, 2000, 400, 400)], { x: -8, y: 0 });
  near(center.delta.x, 0);
  assert.equal(center.guides[0].kind, 'cx');
});

test('стык край к краю и одновременно верх к верху', () => {
  // Движущийся справа от цели: левый край к правому краю цели, верх к верху.
  const res = run([rect(0, 0, 1000, 1000)], [rect(1005, 4, 500, 500)], { x: 0, y: 0 });
  near(res.delta.x, -5);
  near(res.delta.y, -4);
  const kinds = res.guides.map((g) => g.kind).sort();
  assert.deepEqual(kinds, ['dock', 'top']);
});

test('порог: дальше tol — без привязки, ближайшая важнее', () => {
  const far = run([rect(0, 0, 1000, 1000)], [rect(20, 2000, 500, 500)], { x: 0, y: 0 });
  assert.equal(far.snapped, false);
  assert.equal(far.guides.length, 0);
  // Два кандидата: 6 мм (край b) и 3 мм (край a) — берётся 3.
  const best = run([rect(3, 0, 100, 100, 'a'), rect(-6, 300, 100, 100, 'b')], [rect(0, 1000, 50, 50)], { x: 0, y: 0 });
  near(best.delta.x, 3);
});

test('отключение: enabled=false и неизменный сдвиг', () => {
  const res = run([rect(0, 0, 1000, 1000)], [rect(2, 2000, 500, 500)], { x: 1, y: 2 }, { enabled: false });
  assert.equal(res.snapped, false);
  assert.deepEqual(res.delta, { x: 1, y: 2 });
});

test('ограничение локальной оси не уводит наклонное ребро со своей траектории', () => {
  const a = Math.PI / 4;
  const c = Math.cos(a); const s = Math.sin(a);
  const R = (x, y) => ({ x: x * c - y * s, y: x * s + y * c });
  const target = { pts: [R(0, -1000), R(100, -1000), R(100, -500), R(0, -500)] };
  const moving = { pts: [R(6, 0), R(506, 0)] };
  const along = run([target], [moving], { x: 0, y: 0 }, { axis: 'u' }, [a]);
  assert.equal(along.snapped, true);
  near(along.delta.x, -6 * c);
  near(along.delta.y, -6 * s);
  assert.ok(along.guides.every((g) => g.axis === 'x'));
  const blocked = run([target], [moving], { x: 0, y: 0 }, { axis: 'v' }, [a]);
  assert.equal(blocked.snapped, false, 'цель по U не должна привязывать разрешённую только V ось');
});

test('равные промежутки: между двумя объектами и вслед за парой', () => {
  // A [0..100], B [400..500]; движущийся шириной 100 — посередине при x = 200.
  const mid = run([rect(0, 0, 100, 100), rect(400, 0, 100, 100)], [rect(194, 30, 100, 40)], { x: 0, y: 0 }, { tol: 8 });
  near(mid.delta.x, 6);
  const gaps = mid.guides.filter((g) => g.type === 'gap');
  assert.equal(gaps.length, 2);
  assert.equal(gaps[0].label, '100');
  // Пара A [0..100], B [300..400] (промежуток 200) — третий встаёт в 600.
  const next = run([rect(0, 0, 100, 100), rect(300, 0, 100, 100)], [rect(605, 20, 100, 40)], { x: 0, y: 0 }, { tol: 8 });
  near(next.delta.x, -5);
  assert.ok(next.guides.some((g) => g.type === 'gap' && g.label === '200'));
});

test('повёрнутые объекты: рамка по осям объекта, углы реальной формы', () => {
  const a = Math.PI / 6; // 30°
  const c = Math.cos(a); const s = Math.sin(a);
  const R = (x, y) => ({ x: x * c - y * s, y: x * s + y * c });
  const rrect = (x, y, w, h) => ({ pts: [R(x, y), R(x + w, y), R(x + w, y + h), R(x, y + h)] });
  // Цель и движущийся повёрнуты на 30°; в их осях левые края расходятся на 5 мм.
  const target = rrect(0, 0, 1000, 1000);
  const moving = rrect(5, 3000, 500, 500);
  const res = run([target], [moving], { x: 0, y: 0 }, {}, [0, a]);
  assert.equal(res.snapped, true);
  near(res.angle, a);
  assert.equal(res.axes, null); // рамка повёрнута относительно осей пространства
  // Сдвиг на −5 мм вдоль оси объекта (в мире — повёрнутый вектор).
  near(res.delta.x, -5 * c, 1e-6);
  near(res.delta.y, -5 * s, 1e-6);
  // В экранной рамке углы реальной формы дают габарит: края проверяются там же.
  const screen = run([target], [rrect(5, 3000, 500, 500)], { x: 0, y: 0 }, {}, [0]);
  const tx = Math.min(...target.pts.map((p) => p.x));
  assert.ok(!screen.snapped || Math.abs(screen.guides[0].from.x - tx) < 11);
});

test('круги — габарит центр ± r', () => {
  const res = run([{ c: { x: 0, y: 0 }, r: 500 }], [{ c: { x: 1004, y: 3000 }, r: 500 }], { x: 0, y: 0 });
  near(res.delta.x, -4);
  assert.equal(res.guides[0].kind, 'dock'); // край круга к краю круга
});

test('guideFrames убирает повторы по модулю 90°', () => {
  assert.deepEqual(guideFrames([0, Math.PI / 2, Math.PI]), [0]);
  assert.equal(guideFrames([0, 0.3, 0.3 + Math.PI / 2]).length, 2);
});

test('mergeWithGrid: непривязанная ось — по сетке', () => {
  const res = run([rect(0, 0, 1000, 1000)], [rect(3, 2000, 500, 500)], { x: 0, y: 37 });
  assert.deepEqual(mergeWithGrid(res, { x: 50, y: 50 }), { x: -3, y: 50 });
  assert.deepEqual(mergeWithGrid({ snapped: false }, { x: 50, y: 0 }), { x: 50, y: 0 });
});

test('производительность: 500 целей, кадр < 16 мс', () => {
  const targets = [];
  for (let i = 0; i < 500; i += 1) targets.push(rect((i % 25) * 1300, Math.floor(i / 25) * 1700, 900 + (i % 7) * 30, 800 + (i % 5) * 40, `t${i}`));
  const t0 = performance.now();
  const index = prepareGuides(targets, [0, 0.4]);
  const boxes = movingBoxes(index, [rect(10000, 10000, 700, 700)]);
  const prep = performance.now() - t0;
  const t1 = performance.now();
  for (let k = 0; k < 60; k += 1) snapGuides(index, boxes, { x: k * 13, y: k * 7 }, { tol: 10, reach: 30000 });
  const frame = (performance.now() - t1) / 60;
  assert.ok(frame < 16, `кадр ${frame.toFixed(2)} мс`);
  assert.ok(prep < 200, `подготовка ${prep.toFixed(1)} мс`);
});
