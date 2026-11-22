// Ручки кухни-конструктора на плане (core/kitchen.js: kitchenHandles,
// kitchenHandleDrag): длина сторон, глубина, ширина элементов, привязка, пределы.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  compositeBounds, editKitchen, kitchenHandleDrag, kitchenHandles, normalizeItemsComp, withDefaultComp,
} from '../core/composite.js';
import { createItem } from '../core/model.js';

const kitchenOf = (kind, comp, { x = 0, y = 0, rotation = 0 } = {}) => {
  const it = withDefaultComp(createItem(kind, x, y, 1, 1, rotation));
  if (comp) { it.comp = { ...it.comp, ...comp }; normalizeItemsComp([it]); }
  return it;
};
const handle = (it, op, key, val) => kitchenHandles(it).find((h) => h.op === op && (!key || h[key] === val));
const drag = (it, h, dx, dy, step) => {
  const r = kitchenHandleDrag(it, h, dx, dy, step);
  assert.ok(r, `ручка ${h.op} не сработала`);
  return { ...it, ...r.next, r };
};
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6, `${msg}: ${a} ≠ ${b}`);

test('набор ручек П-кухни: элементы, торцы сторон, глубина, ширина', () => {
  const it = kitchenOf('kitchen-u');
  const hs = kitchenHandles(it);
  assert.deepEqual(hs.filter((h) => h.op === 'move').map((h) => h.type).sort(), it.comp.items.map((e) => e.type).sort());
  assert.deepEqual(hs.filter((h) => h.op === 'length').map((h) => `${h.side}:${h.end}`), ['left:start', 'main:end', 'right:end']);
  assert.equal(hs.filter((h) => h.op === 'depth').length, 3);
  assert.equal(hs.find((h) => h.op === 'depth').side, 'main', 'глубина основной стороны — первой');
  assert.deepEqual(hs.filter((h) => h.op === 'width').map((h) => h.elem).sort(), ['fridge', 'hob', 'hood', 'sink']);
  // Ручки элементов — первыми (e2e ищет ручку мойки по type).
  assert.equal(hs.find((h) => h.type === 'sink').op, 'move');
  // Колонна духового шкафа фиксированной ширины — без ручки ширины.
  const ov = { ...it, ...editKitchen(it, { op: 'toggle', type: 'oven-column', on: true }) };
  assert.ok(kitchenHandles(ov).some((h) => h.op === 'move' && h.type === 'oven-column'));
  assert.ok(!kitchenHandles(ov).some((h) => h.op === 'width' && h.elem === 'oven-column'));
  // Торцы — наружу от кухни: ручка длины основной стороны П — справа.
  const m = handle(it, 'length', 'side', 'main');
  assert.deepEqual([m.nx, m.ny], [1, 0]);
  near(m.x, compositeBounds(it).x + compositeBounds(it).w, 'торец основной стороны');
});

test('длина основной стороны линейной кухни: шаг 50, левый торец на месте', () => {
  const it = kitchenOf('kitchen-row', null, { x: 1000, y: 500 });
  const left = compositeBounds(it).x;
  const n = drag(it, handle(it, 'length', 'side', 'main'), 437, 80);
  assert.equal(n.comp.len.main, 2850);
  assert.equal(n.r.label, 'Длина: 2850 мм');
  near(compositeBounds(n).x, left, 'левый торец');
  // Без привязки (Shift) — по миллиметру.
  assert.equal(drag(it, handle(it, 'length', 'side', 'main'), 437, 0, 1).comp.len.main, 2837);
  // Короче элементов нельзя: мойка 800 + плита 600 — упор на 1400.
  const s = drag(it, handle(it, 'length', 'side', 'main'), -1600, 0);
  assert.equal(s.comp.len.main, 1400);
  assert.equal(s.r.stop, true);
});

test('крылья П: левое тянется вниз, правое — вниз; основная сторона на месте', () => {
  const it = kitchenOf('kitchen-u', null, { x: 0, y: 0 });
  const b0 = compositeBounds(it);
  const l = drag(it, handle(it, 'length', 'side', 'left'), 0, 310);
  assert.equal(l.comp.len.left, 2100);
  near(compositeBounds(l).y, b0.y, 'верх (основная сторона) на месте');
  near(compositeBounds(l).x, b0.x, 'левый край на месте');
  const r = drag(it, handle(it, 'length', 'side', 'right'), 0, -400);
  assert.equal(r.comp.len.right, 1400);
  near(compositeBounds(r).y, b0.y, 'верх на месте');
  // Основная сторона П: правое крыло уезжает, левое на месте.
  const m = drag(it, handle(it, 'length', 'side', 'main'), 500, 0);
  assert.equal(m.comp.len.main, 3500);
  near(compositeBounds(m).x, b0.x, 'левое крыло на месте');
});

test('зеркальная Г: торец основной стороны слева, правое крыло на месте; поворот 90°', () => {
  const it = kitchenOf('kitchen-corner', { mirror: true }, { x: 0, y: 0 });
  const h = handle(it, 'length', 'side', 'main');
  assert.equal(h.end, 'start');
  const b0 = compositeBounds(it);
  const n = drag(it, h, -500, 0);
  assert.equal(n.comp.len.main, 2900);
  near(compositeBounds(n).x + compositeBounds(n).w, b0.x + b0.w, 'правый край на месте');
  // Поворот: тянем по ходу ручки — длина растёт, противоположный торец на месте.
  const rt = kitchenOf('kitchen-row', null, { x: 0, y: 0, rotation: 90 });
  const hr = handle(rt, 'length', 'side', 'main');
  const top = compositeBounds(rt).y;
  const nr = drag(rt, hr, hr.ux * 300, hr.uy * 300);
  assert.equal(nr.comp.len.main, 2700);
  near(compositeBounds(nr).y, top, '90°: начало стороны на месте');
});

test('глубина и ширина элемента: шаг, пределы как в панели', () => {
  const it = kitchenOf('kitchen-row');
  const d = handle(it, 'depth');
  assert.equal(drag(it, d, d.vx * 60, d.vy * 60).comp.depth, 650);
  assert.equal(drag(it, d, d.vx * 60, d.vy * 60, 1).comp.depth, 660);
  const lo = drag(it, d, -d.vx * 1000, -d.vy * 1000);
  assert.equal(lo.comp.depth, 400);
  assert.equal(lo.r.stop, true);
  assert.equal(drag(it, d, d.vx * 1000, d.vy * 1000).comp.depth, 900);
  const w = handle(it, 'width', 'elem', 'sink');
  const sink = (n) => n.comp.items.find((e) => e.type === 'sink');
  const s1 = drag(it, w, 230, 0);
  assert.equal(sink(s1).w, 1050);
  assert.equal(s1.r.label, 'Мойка: 1050 мм');
  assert.equal(sink(drag(it, w, 1000, 0)).w, 1200, 'не шире максимума');
  assert.equal(sink(drag(it, w, -500, 0)).w, 800, 'не уже минимума');
  assert.equal(kitchenHandleDrag(it, { op: 'boom' }, 0, 0), null);
});
