// Магнит масс (core/mass-snap.js): цели по осям для двух масс, грань к
// грани, заподлицо, отметки этажей, земля, радиус из пикселей (20…600 мм),
// гистерезис, отключение, повёрнутая масса, приоритеты, минимальный размер.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  axisTargets, snapContact, snapLabel, snapMove, snapRadius, snapTolerances,
} from '../core/mass-snap.js';
import { massBox } from '../core/masses.js';
import { MASS_GRIP_MIN } from '../core/mass-gizmo.js';

// Масса A: x 0…8000, y 0…5000, z 0…3000; B — справа через зазор 1000.
const A = { id: 'a', name: 'Масса 1', x: 4000, y: 2500, w: 8000, d: 5000, z0: 0, h: 3000, rotation: 0 };
const B = { id: 'b', name: 'Масса 2', x: 13000, y: 3000, w: 8000, d: 6000, z0: 0, h: 6000, rotation: 0 };
const other = (m) => ({ id: m.id, name: m.name, box: massBox(m) });

test('радиус из пикселей: 12 px × мм/px, в пределах 20…600 мм; отрыв больше', () => {
  assert.equal(snapRadius(12, 10), 120);
  assert.equal(snapRadius(12, 0.5), 20);
  assert.equal(snapRadius(12, 200), 600);
  const m = snapTolerances(10);
  assert.deepEqual(m, { tol: 120, release: 160 });
  const t = snapTolerances(10, 'touch');
  assert.equal(t.tol, 200);
  assert.ok(t.release > t.tol);
  assert.ok(snapTolerances(0.1).release > snapTolerances(0.1).tol, 'отрыв > притяжения и у предела');
});

test('цели по x: грань к грани (вплотную), заподлицо, центр', () => {
  const ts = axisTargets('x', massBox(A), [other(B)]);
  const find = (kind, edge) => ts.find((t) => t.kind === kind && t.edge === edge);
  assert.equal(find('face', 'hi').value, 9000); // моя max = чужая min
  assert.equal(find('face', 'lo').value, 17000); // моя min = чужая max
  assert.equal(find('flush', 'lo').value, 9000);
  assert.equal(find('flush', 'hi').value, 17000);
  assert.equal(find('center', 'mid').value, 13000);
  assert.equal(find('face', 'hi').id, 'b');
  // Сдвиг +950 (зазор 1000, радиус 120) — встаёт вплотную ровно: x1 = 9000.
  const r = snapMove({ lo: 0, hi: 8000, v: 950, targets: ts, tol: 120, step: 100 });
  assert.equal(r.value, 1000);
  assert.equal(r.snap.kind, 'face');
  assert.equal(snapLabel(r.snap), 'к грани «Масса 2»');
  // Далеко — шаг.
  assert.deepEqual(snapMove({ lo: 0, hi: 8000, v: 640, targets: ts, tol: 120, step: 100 }), { value: 600, snap: null });
});

test('не касаются по другим осям — «по грани», ранг ниже грани к грани', () => {
  const far = { ...B, id: 'c', name: 'Масса 3', y: 30000 };
  const ts = axisTargets('x', massBox(A), [other(B), other(far)]);
  const c = ts.find((t) => t.id === 'c' && t.edge === 'hi' && t.value === 9000);
  // Та же координата у B (касается) — цель одна, грань к грани B.
  assert.equal(c, undefined);
  const ts2 = axisTargets('x', massBox(A), [other(far)]);
  const al = ts2.find((t) => t.edge === 'hi' && t.value === 9000);
  assert.equal(al.kind, 'align');
  assert.equal(snapLabel(al), 'по грани «Масса 3»');
});

test('заподлицо по y и приоритет: грань к грани важнее центра и заподлицо', () => {
  const ts = axisTargets('y', massBox(A), [other(B)]);
  // A y 0…5000, B y 0…6000: сдвиг +30 → моя min 30 ~ 0 (заподлицо), моя mid 2530 ~ 3000? нет.
  const r = snapMove({ lo: 0, hi: 5000, v: 30, targets: ts, tol: 120 });
  assert.equal(r.value, 0);
  assert.equal(r.snap.kind, 'flush');
  assert.equal(snapLabel(r.snap), 'заподлицо с «Масса 2»');
  // Две цели в радиусе: центр ближе, грань дальше — побеждает грань.
  const t2 = [
    { key: 'c', kind: 'center', rank: 4, edge: 'mid', value: 105, axis: 'x' },
    { key: 'f', kind: 'face', rank: 0, edge: 'hi', value: 1090, axis: 'x' },
  ];
  assert.equal(snapMove({ lo: 0, hi: 1000, v: 100, targets: t2, tol: 120 }).snap.key, 'f');
  // Один ранг — ближайшая.
  const t3 = [
    { key: 'p', kind: 'face', rank: 0, edge: 'hi', value: 1110, axis: 'x' },
    { key: 'q', kind: 'face', rank: 0, edge: 'lo', value: 95, axis: 'x' },
  ];
  assert.equal(snapMove({ lo: 0, hi: 1000, v: 100, targets: t3, tol: 120 }).snap.key, 'q');
});

test('z: земля, отметки этажей, стопка на верх чужой массы', () => {
  const box = { ...massBox(A), x0: 9500, x1: 12500, z0: 2000, z1: 5000 }; // над B по xy
  const levels = [{ elevation: 0, height: 3000, name: '1 этаж' }, { elevation: 3000, height: 3000, name: '2 этаж' }];
  const ts = axisTargets('z', box, [other(B)], { levels, ground: [150] });
  const g = ts.filter((t) => t.kind === 'ground').map((t) => t.value).sort((a, b) => a - b);
  assert.deepEqual(g, [0, 150]);
  assert.equal(snapLabel(ts.find((t) => t.kind === 'ground')), 'на землю');
  // Стопка: низ на верх B (6000), касаются по xy — «на «Масса 2»».
  const stack = snapMove({ lo: 2000, hi: 5000, v: 3950, targets: ts, tol: 120 });
  assert.equal(stack.value, 4000);
  assert.equal(stack.snap.kind, 'face');
  assert.equal(snapLabel(stack.snap), 'на «Масса 2»');
  // Отметка этажа 3000: низ 2000 + 970 → 3000.
  const lv = snapMove({ lo: 2000, hi: 5000, v: 970, targets: ts.filter((t) => t.id !== 'b'), tol: 120 });
  assert.equal(lv.value, 1000);
  assert.equal(lv.snap.kind, 'level');
  assert.equal(snapLabel(lv.snap), 'отметка 3000');
  // На землю: низ 2000 − 1990 → 0 (не 10).
  const gr = snapMove({ lo: 2000, hi: 5000, v: -1990, targets: ts, tol: 120 });
  assert.equal(gr.value, -2000);
  assert.equal(gr.snap.kind, 'ground');
});

test('гистерезис: притянутая цель держит до радиуса отрыва', () => {
  const ts = axisTargets('x', massBox(A), [other(B)]);
  const s1 = snapMove({ lo: 0, hi: 8000, v: 900, targets: ts, tol: 120, release: 160, step: 100 });
  assert.equal(s1.value, 1000);
  // Курсор отошёл на 140 (> 120, < 160) — держит.
  const s2 = snapMove({ lo: 0, hi: 8000, v: 860, targets: ts, tol: 120, release: 160, step: 100, held: s1.snap.key });
  assert.equal(s2.value, 1000);
  assert.equal(s2.snap.key, s1.snap.key);
  // Без гистерезиса — уже не держит.
  assert.equal(snapMove({ lo: 0, hi: 8000, v: 860, targets: ts, tol: 120, step: 100 }).snap, null);
  // Дальше 160 — оторвался.
  const s3 = snapMove({ lo: 0, hi: 8000, v: 820, targets: ts, tol: 120, release: 160, step: 100, held: s1.snap.key });
  assert.deepEqual(s3, { value: 800, snap: null });
});

test('магнит выключен (Shift/Alt/флажок): только шаг или мм', () => {
  const ts = axisTargets('x', massBox(A), [other(B)]);
  assert.deepEqual(snapMove({ lo: 0, hi: 8000, v: 995, targets: ts, tol: 120, free: true, step: 0 }), { value: 995, snap: null });
  assert.deepEqual(snapMove({ lo: 0, hi: 8000, v: 962, targets: ts, tol: 120, free: true, step: 50 }), { value: 950, snap: null });
});

test('повёрнутая на 90° масса — цели по реальному габариту', () => {
  const R = { ...B, rotation: 90 }; // w 8000 → по y, d 6000 → по x
  const ts = axisTargets('x', massBox(A), [other(R)]);
  const face = ts.find((t) => t.kind === 'face' && t.edge === 'hi');
  assert.equal(face.value, 13000 - 3000);
});

test('точка размера: цель меньше минимального размера отбрасывается', () => {
  // Правая грань A (x1 = 8000) тянется влево к грани x = 200 (чужая) — размер < 300.
  const C = { id: 'c', name: 'Масса 3', x: -2000, y: 2500, w: 4400, d: 5000, z0: 0, h: 3000, rotation: 0 }; // x −4200…200
  const b = massBox(A);
  const ts = axisTargets('x', b, [other(C)]).filter((t) => t.edge === 'hi');
  const accept = (dv) => 8000 + dv - b.x0 >= MASS_GRIP_MIN;
  const r = snapMove({ lo: 8000, hi: 8000, v: -7750, targets: ts, tol: 120, accept, step: 100 });
  assert.equal(r.snap, null);
  // Допустимая цель — принимается: грань к x = 200 при x0 = −200 было бы можно.
  const ok = snapMove({ lo: 8000, hi: 8000, v: -7750, targets: ts, tol: 120, accept: () => true });
  assert.equal(ok.value, -7800);
});

test('плоскость стыка: пересечение габаритов, иначе объединение', () => {
  const box = { ...massBox(A), x0: 1000, x1: 9000 };
  const t = { axis: 'x', value: 9000, kind: 'face' };
  const c = snapContact(box, t, massBox(B));
  assert.deepEqual(c, { axis: 'x', value: 9000, ranges: { y: [0, 5000], z: [0, 3000] } });
  const g = snapContact(box, { axis: 'z', value: 0, kind: 'ground' });
  assert.deepEqual(g.ranges, { x: [1000, 9000], y: [0, 5000] });
});
