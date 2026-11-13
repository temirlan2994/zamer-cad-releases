// Тени на плане (core/plan-shadows.js): направление в осях дома, полосы по
// рёбрам, смотрящим по тени, градиент по нормали ребра, кто отбрасывает тень,
// границы слоя и подпись кеша.
import test from 'node:test';
import assert from 'node:assert/strict';
import { planShadowDir, shadowBounds, shadowCasters, shadowKey, shadowLength, shadowStrips } from '../core/plan-shadows.js';

const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;
const square = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }];

test('направление: без поворота дома — как в мире; дом повёрнут — в его осях', () => {
  const d0 = planShadowDir({ x: 1, y: 0 }, null);
  assert.ok(near(d0.x, 1) && near(d0.y, 0));
  // Дом повёрнут на 90°: мировое «вправо» в осях дома — «вверх» (−y).
  const d90 = planShadowDir({ x: 1, y: 0 }, { rotation: 90, origin: { x: 0, y: 0 } });
  assert.ok(near(d90.x, 0) && near(d90.y, -1), JSON.stringify(d90));
  const dn = planShadowDir({ x: 3, y: 4 }, null);
  assert.ok(near(Math.hypot(dn.x, dn.y), 1), 'единичный вектор');
});

test('полосы: только рёбра, смотрящие по тени; обход в любую сторону', () => {
  for (const poly of [square, [...square].reverse()]) {
    const right = shadowStrips(poly, { x: 1, y: 0 }, 50);
    assert.equal(right.length, 1, 'вправо — одно ребро x = 100');
    assert.ok(right[0].quad.every((p) => p.x >= 100 - 1e-9), JSON.stringify(right[0].quad));
    assert.ok(near(right[0].from.x, 100) && near(right[0].to.x, 150), 'градиент от ребра до края тени');
    assert.equal(shadowStrips(poly, { x: Math.SQRT1_2, y: Math.SQRT1_2 }, 50).length, 2, 'по диагонали — два ребра');
  }
});

test('градиент — по нормали ребра: для косой тени конец сдвинут на n·(n·v)', () => {
  const [s] = shadowStrips(square, { x: 0.6, y: 0.8 }, 100).filter((x) => near(x.from.y, x.to.y) === false && near(x.from.x, x.to.x));
  assert.ok(s, 'нижнее ребро y = 100');
  assert.ok(near(s.to.y - s.from.y, 80), `t = 1 на расстоянии v·n = 80, а не 100: ${JSON.stringify(s)}`);
});

test('вырожденная фигура — без полос', () => {
  assert.deepEqual(shadowStrips([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }], { x: 0, y: 1 }, 50), []);
});

test('кто отбрасывает тень: видимые стены (многоугольники или полосы) и мебель', () => {
  const walls = [
    { polys: [square] },
    { hidden: true, polys: [square] },
    { poly: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 10 }] },
  ];
  const items = [{ kind: 'wardrobe', x: 500, y: 500, w: 1000, h: 600, rotation: 90 }, { kind: 'bed', x: 0, y: 0, w: 0, h: 0 }];
  const c = shadowCasters(walls, items, { wallHeight: 3000, k: 0.3 });
  assert.deepEqual(c.map((x) => x.kind), ['wall', 'wall', 'item'], 'скрытая стена и пустой предмет — без тени');
  assert.equal(c[0].len, shadowLength(3000, 0.3));
  assert.ok(c[2].len < c[0].len, 'мебель ниже стены — тень короче');
  // Повёрнутый на 90° шкаф 1000×600: по X занимает 600.
  const xs = c[2].poly.map((p) => p.x);
  assert.ok(near(Math.max(...xs) - Math.min(...xs), 600, 1e-6));
});

test('длина тени ограничена: от 250 до 4000 мм; высокое солнце — не короче, чем при k = 0,25', () => {
  assert.equal(shadowLength(10, 0.3), 250);
  assert.equal(shadowLength(100000, 2), 4000);
  assert.equal(shadowLength(3000, 0.1), shadowLength(3000, 0.25));
});

test('границы слоя включают сдвинутую копию', () => {
  const b = shadowBounds([{ poly: square, len: 300 }], { x: -1, y: 0 });
  assert.deepEqual([b.minX, b.maxX, b.minY, b.maxY], [-300, 100, 0, 100]);
});

test('подпись кеша меняется от сдвига стены и прочих условий, но не от дробей мм', () => {
  const a = shadowCasters([{ polys: [square] }], [], {});
  const moved = shadowCasters([{ polys: [square.map((p) => ({ x: p.x + 50, y: p.y }))] }], [], {});
  const tiny = shadowCasters([{ polys: [square.map((p) => ({ x: p.x + 0.2, y: p.y }))] }], [], {});
  assert.notEqual(shadowKey(a), shadowKey(moved));
  assert.equal(shadowKey(a), shadowKey(tiny));
  assert.notEqual(shadowKey(a, 'L1'), shadowKey(a, 'L2'));
});
