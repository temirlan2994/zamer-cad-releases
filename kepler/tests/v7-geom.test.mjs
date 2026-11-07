// Геометрическое ядро v7 (core/geom): булевы операции под любым углом.
// Property-тесты на случайных прямоугольниках, Г-формах и повёрнутых
// прямоугольниках (детерминированный генератор) + вырожденные случаи.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  area, buffer, clean, components, difference, erode, interiorPoint, intersection, opening, pointInPolygon,
  rectRing, simplifyRing, transform, union, xor,
} from '../core/geom/index.js';

export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ri = (r, a, b) => Math.round(a + r() * (b - a));

function randRect(r) {
  return [rectRing(ri(r, 0, 6000), ri(r, 0, 6000), ri(r, 200, 5000), ri(r, 200, 5000))];
}

function randL(r) {
  const x = ri(r, 0, 5000); const y = ri(r, 0, 5000); const w = ri(r, 1500, 5000); const h = ri(r, 1500, 5000);
  const cw = ri(r, 300, w - 300); const ch = ri(r, 300, h - 300);
  return difference([rectRing(x, y, w, h)], [rectRing(x + w - cw, y, cw, ch)]);
}

function randRot(r) {
  const deg = r() * 360;
  return transform([rectRing(-ri(r, 300, 2500), -ri(r, 300, 2500), ri(r, 600, 5000), ri(r, 600, 5000))],
    { x: ri(r, 1000, 7000), y: ri(r, 1000, 7000), rotation: deg });
}

const KINDS = [randRect, randL, randRot];
const randShape = (r) => KINDS[Math.floor(r() * KINDS.length)](r);
const tol = (...gs) => 2000 + 1e-4 * gs.reduce((s, g) => s + area(g), 0);

test('свойства: |A∪B| = |A| + |B| − |A∩B|, A\\B и A∩B не пересекаются и дают A', () => {
  const r = rng(7);
  for (let i = 0; i < 150; i += 1) {
    const A = union(randShape(r)); const B = union(randShape(r));
    const U = union(A, B); const I = intersection(A, B); const D = difference(A, B);
    const t = tol(A, B);
    assert.ok(Math.abs(area(U) - (area(A) + area(B) - area(I))) <= t, `#${i} объединение`);
    assert.ok(Math.abs(area(D) + area(I) - area(A)) <= t, `#${i} A = (A\\B) ∪ (A∩B)`);
    assert.ok(area(intersection(D, I)) <= t, `#${i} A\\B ∩ A∩B = ∅`);
    assert.ok(Math.abs(area(xor(A, B)) - (area(U) - area(I))) <= t, `#${i} xor`);
    assert.deepEqual(union(A, B), union(B, A), `#${i} объединение коммутативно и канонично`);
  }
});

test('свойства: на целых прямоугольниках тождества точные', () => {
  const r = rng(11);
  for (let i = 0; i < 150; i += 1) {
    const A = randRect(r); const B = randRect(r); const C = randRect(r);
    const U = union(A, B, C);
    const I = intersection(A, B);
    assert.equal(area(U), area(union(union(A, B), C)), `#${i} ассоциативность`);
    assert.equal(area(union(A, B)), area(A) + area(B) - area(I), `#${i}`);
    assert.equal(area(difference(A, B)) + area(I), area(A), `#${i}`);
  }
});

test('свойства: точка в объединении ⇔ в одном из слагаемых', () => {
  const r = rng(23);
  for (let i = 0; i < 60; i += 1) {
    const A = union(randShape(r)); const B = union(randShape(r));
    const U = union(A, B); const I = intersection(A, B);
    for (let k = 0; k < 30; k += 1) {
      const p = { x: r() * 12000 - 1000, y: r() * 12000 - 1000 };
      // Около границы (≤ 3 мм) — пропуск: округление до 0,5 мм.
      const near = [A, B].some((g) => pointInPolygon(g, p, 3) !== pointInPolygon(g, p, 0));
      if (near) continue;
      const a = pointInPolygon(A, p, 0); const b = pointInPolygon(B, p, 0);
      if ([U, I].some((g) => pointInPolygon(g, p, 3) !== pointInPolygon(g, p, 0))) continue;
      assert.equal(pointInPolygon(U, p, 0), a || b, `#${i}.${k} union`);
      assert.equal(pointInPolygon(I, p, 0), a && b, `#${i}.${k} intersection`);
    }
  }
});

test('вырожденные: касание сторон, общие рёбра, совпадение, нулевая площадь', () => {
  const a = [rectRing(0, 0, 1000, 1000)];
  const b = [rectRing(1000, 0, 1000, 1000)];
  const u = union(a, b);
  assert.equal(u.length, 1, 'касание по стороне сливает');
  assert.equal(u[0][0].length, 4, 'коллинеарные точки слиты');
  assert.equal(area(u), 2e6);
  assert.equal(area(intersection(a, b)), 0, 'касание — пустое пересечение');
  assert.deepEqual(union(a, a), union(a), 'совпадающие');
  assert.deepEqual(difference(a, a), []);
  assert.deepEqual(union(a, [[{ x: 0, y: 0 }, { x: 500, y: 0 }, { x: 1000, y: 0 }]]), union(a), 'нулевая площадь не влияет');
  const corner = union(a, [rectRing(1000, 1000, 500, 500)]);
  assert.equal(corner.length, 2, 'касание в точке — две компоненты');
  assert.equal(components(corner).length, 2);
  // Частично совпадающие рёбра (T-касание).
  const t = union(a, [rectRing(1000, 300, 400, 400)]);
  assert.equal(t.length, 1);
  assert.equal(area(t), 1e6 + 160000);
});

test('дыры, ориентация, починка самопересечений', () => {
  const ring = difference([rectRing(0, 0, 1000, 1000)], [rectRing(250, 250, 500, 500)]);
  assert.equal(ring.length, 1);
  assert.equal(ring[0].length, 2, 'внешний + дыра');
  assert.equal(area(ring), 1e6 - 250000);
  const island = union(ring, [rectRing(400, 400, 200, 200)]);
  assert.equal(island.length, 2, 'остров в дыре — отдельный полигон');
  // По часовой на входе — та же площадь.
  assert.equal(area(union([rectRing(0, 0, 100, 100).reverse()])), 10000);
  // «Бабочка»: самопересечение → два треугольника.
  const bow = clean([[{ x: 0, y: 0 }, { x: 100, y: 100 }, { x: 100, y: 0 }, { x: 0, y: 100 }]]);
  assert.equal(bow.length, 2);
  assert.equal(area(bow), 5000);
});

test('смещение, эрозия, открытие; внутренняя точка; упрощение', () => {
  const sq = [rectRing(0, 0, 1000, 1000)];
  assert.equal(area(buffer(sq, 100)), 1200 * 1200, 'миттер у прямого угла');
  assert.equal(area(erode(sq, 100)), 800 * 800);
  const withTail = union(sq, [rectRing(1000, 400, 2000, 100)]);
  assert.equal(area(opening(withTail, 124.5)), 1e6, 'хвост тоньше 250 срезан');
  const rot = transform(sq, { rotation: 45 });
  assert.ok(Math.abs(area(buffer(rot, 100)) - 1200 * 1200) < 3000, 'под 45° — тот же отступ');
  const L = difference(sq, [rectRing(500, 0, 500, 500)]);
  const p = interiorPoint(L);
  assert.ok(pointInPolygon(L, p, 0));
  assert.equal(simplifyRing([{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }]).length, 4);
});
