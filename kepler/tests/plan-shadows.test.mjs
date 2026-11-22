// Тени на плане (core/plan-shadows.js): направление в осях дома, полосы по
// рёбрам, смотрящим по тени, градиент по нормали ребра; объёмы с высотой —
// стены на этаж, мебель как в 3D (у дивана сиденье и спинка); длина тени —
// по высоте с одним масштабом; поднятый объём — тень отделена; тень касания —
// только у стоящих на полу; границы слоя и подпись кеша.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  castShadow, contactLength, planShadowDir, shadowBounds, shadowCasters, shadowKey, shadowScale, shadowStrips,
} from '../core/plan-shadows.js';

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
  const [s] = shadowStrips(square, { x: 0.6, y: 0.8 }, 100).filter((x) => near(x.from.x, x.to.x));
  assert.ok(s, 'нижнее ребро y = 100');
  assert.ok(near(s.to.y - s.from.y, 80), `t = 1 на расстоянии v·n = 80, а не 100: ${JSON.stringify(s)}`);
});

test('вырожденная фигура или нулевая длина — без полос', () => {
  assert.deepEqual(shadowStrips([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }], { x: 0, y: 1 }, 50), []);
  assert.deepEqual(shadowStrips(square, { x: 0, y: 1 }, 0), []);
});

test('масштаб тени: стена 3000 мм при средней длине — 1200 мм; высокое солнце — не короче k = 0,25', () => {
  assert.ok(near(3000 * shadowScale(0.25, 1), 1200));
  assert.ok(near(shadowScale(0.1, 1), shadowScale(0.25, 1)));
  assert.ok(near(shadowScale(0.3, 1.6), 0.3 * 1.6 * 1.6));
});

test('кто отбрасывает тень: видимые стены на высоту этажа; диван — сиденье и спинка выше', () => {
  const walls = [{ polys: [square] }, { hidden: true, polys: [square] }, { poly: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 10 }] }];
  const items = [{ id: 'S', kind: 'sofa', x: 1000, y: 1000, w: 2000, h: 900, rotation: 0 }];
  const c = shadowCasters(walls, items, { wallHeight: 2800 });
  const ws = c.filter((x) => x.kind === 'wall');
  assert.equal(ws.length, 2, 'скрытая стена — без тени');
  assert.ok(ws.every((w) => w.z0 === 0 && w.z1 === 2800));
  const sofa = c.filter((x) => x.kind === 'item');
  assert.equal(sofa.length, 2, 'сиденье и спинка');
  const [seat, back] = sofa.sort((a, b) => a.z0 - b.z0);
  assert.equal(seat.z0, 0);
  assert.ok(back.z0 > 0 && back.z1 > seat.z1, `спинка выше сиденья: ${JSON.stringify([seat.z1, back.z0, back.z1])}`);
});

test('соприкасающиеся куски стен дают единый силуэт без внутренних торцов', () => {
  const walls = [
    { rects: [{ x: 0, y: 0, w: 1000, h: 200 }] },
    { rects: [{ x: 1000, y: 0, w: 200, h: 1200 }] },
  ];
  const casters = shadowCasters(walls).filter((x) => x.kind === 'wall');
  assert.equal(casters.length, 1, 'L-стык объединён в один контур');
  const strips = shadowStrips(casters[0].poly, { x: 1, y: 0 }, 300);
  assert.ok(strips.every((strip) => strip.from.x !== 1000), 'скрытый торец первого куска не отбрасывает полосу');
});

test('тень объёма: длина по высоте; поднятый объём — тень начинается со сдвига', () => {
  const s = 0.4;
  const dir = { x: 1, y: 0 };
  const onFloor = castShadow({ poly: square, z0: 0, z1: 500 }, dir, s);
  assert.ok(near(onFloor.len, 200) && near(onFloor.base[0].x, 0));
  const top = castShadow({ poly: square, z0: 700, z1: 750 }, dir, s);
  assert.ok(near(top.base[0].x, 280) && near(top.len, 20), 'столешница: тень отделена, тонкая');
  const tall = castShadow({ poly: square, z0: 0, z1: 1e6 }, dir, s);
  assert.equal(tall.len, 5000, 'длина ограничена');
});

test('тень касания: только у стоящих на полу; не длиннее 240 мм', () => {
  assert.ok(contactLength({ z0: 0, z1: 3000 }, 0.4) <= 240);
  assert.ok(near(contactLength({ z0: 0, z1: 500 }, 0.4), 500 * 0.4 * 0.22));
  assert.equal(contactLength({ z0: 450, z1: 850 }, 0.4), 0);
});

test('границы слоя включают кончик тени', () => {
  const b = shadowBounds([{ poly: square, z0: 0, z1: 1000 }], { x: -1, y: 0 }, 0.3);
  assert.deepEqual([b.minX, b.maxX, b.minY, b.maxY], [-300, 100, 0, 100]);
});

test('подпись кеша меняется от сдвига и высоты, но не от дробей мм', () => {
  const base = { poly: square, z0: 0, z1: 1000, kind: 'item' };
  const moved = { ...base, poly: square.map((p) => ({ x: p.x + 50, y: p.y })) };
  const tiny = { ...base, poly: square.map((p) => ({ x: p.x + 0.2, y: p.y })) };
  assert.notEqual(shadowKey([base]), shadowKey([moved]));
  assert.notEqual(shadowKey([base]), shadowKey([{ ...base, z1: 1500 }]));
  assert.equal(shadowKey([base]), shadowKey([tiny]));
  assert.notEqual(shadowKey([base], 'L1'), shadowKey([base], 'L2'));
});
