// Кухня-конструктор (core/kitchen.js, тип comp 'kitchen'): формы линия/Г/П,
// автозаполнение, галочки, перемещение элементов, повороты, выгрузка.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  compositeBounds, compositeParts, editKitchen, isFixedSizeComp, kitchenElementAt, kitchenFrames, kitchenHandles,
  kitchenLines, kitchenProject, normalizeComp, normalizeItemsComp, partRect, partsInHouse, partsOverlap,
  pointInComposite, withDefaultComp,
} from '../core/composite.js';
import { itemShapes, furnitureIssues } from '../core/clearance.js';
import { buildStructuredExport, planEntities } from '../core/export.js';
import { buildIfc } from '../core/ifc.js';
import { createItem, createProject, createRoom, deserializeProject, serializeProject } from '../core/model.js';
import { deriveWalls } from '../core/walls.js';

const kitchenOf = (kind, comp, { x = 0, y = 0, rotation = 0 } = {}) => {
  const it = withDefaultComp(createItem(kind, x, y, 1, 1, rotation));
  if (comp) { it.comp = { ...it.comp, ...comp }; normalizeItemsComp([it]); }
  return it;
};
const apply = (it, edit) => {
  const next = editKitchen(it, edit);
  assert.ok(next, `правка ${JSON.stringify(edit)} не прошла`);
  Object.assign(it, next);
  return it;
};
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6, `${msg}: ${a} ≠ ${b}`);
const layer = (parts, l) => parts.filter((p) => p.layer === l);
// Длина нижнего ряда на стороне (части с углами) — должна равняться длине стороны.
const sideRun = (parts, side) => layer(parts, 'base').filter((p) => p.side === side).reduce((s, p) => s + p.w, 0);

test('формы линия / Г / П: стороны, углы, габарит, без наложений', () => {
  const cases = [['kitchen-row', 'line', 2400, 600, ['main']], ['kitchen-corner', 'L', 2400, 1800, ['left', 'main']], ['kitchen-u', 'U', 3000, 1800, ['left', 'main', 'right']]];
  for (const [kind, shape, w, h, sides] of cases) {
    const it = kitchenOf(kind);
    assert.ok(isFixedSizeComp(it));
    assert.equal(it.comp.shape, shape);
    assert.deepEqual([it.w, it.h], [w, h], `${shape}: габарит`);
    const parts = compositeParts(it);
    assert.equal(partsOverlap(layer(parts, 'base')), false, `${shape}: нижний ряд без наложений`);
    assert.equal(partsOverlap(layer(parts, 'upper')), false, `${shape}: верхний ряд без наложений`);
    assert.equal(parts.filter((p) => p.kind === 'kitchen:corner').length, sides.length - 1, `${shape}: углов`);
    // Угол принадлежит стороне до него, соседняя сторона начинается после угла.
    for (const side of sides) {
      const f = kitchenFrames(it.comp).find((q) => q.side === side);
      near(sideRun(parts, side) + (f.cs ? it.comp.depth : 0), it.comp.len[side], `${shape}/${side}: ряд закрывает сторону`);
    }
    // Все части — внутри габарита.
    for (const p of parts) {
      const r = partRect(p);
      assert.ok(r.x >= -w / 2 - 1e-6 && r.x + r.w <= w / 2 + 1e-6 && r.y >= -h / 2 - 1e-6 && r.y + r.h <= h / 2 + 1e-6, `${shape}: ${p.kind} вне габарита`);
    }
  }
});

test('линии: каждый отрезок один раз, верхний ряд не повторяет нижний', () => {
  for (const kind of ['kitchen-row', 'kitchen-corner', 'kitchen-u']) {
    const { base, upper } = kitchenLines(compositeParts(kitchenOf(kind)));
    const all = [...base, ...upper];
    const key = (s) => s.join(',');
    assert.equal(new Set(all.map(key)).size, all.length);
    for (const [a, b, c, d] of upper) {
      const dup = base.some(([e, f, g, h]) => (b === d && f === h && b === f && Math.min(Math.max(a, c), Math.max(e, g)) - Math.max(Math.min(a, c), Math.min(e, g)) > 1e-6)
        || (a === c && e === g && a === e && Math.min(Math.max(b, d), Math.max(f, h)) - Math.max(Math.min(b, d), Math.min(f, h)) > 1e-6));
      assert.equal(dup, false, `${kind}: двойная линия`);
    }
  }
});

test('автозаполнение при смене длины: шкафы и заглушка, элементы на месте', () => {
  const it = kitchenOf('kitchen-row');
  const x0 = it.x - it.w / 2;
  apply(it, { op: 'length', side: 'main', value: 3150 });
  assert.equal(it.w, 3150);
  near(it.x - it.w / 2, x0, 'начало стороны у стены не сдвинулось');
  const parts = compositeParts(it);
  near(sideRun(parts, 'main'), 3150, 'ряд закрывает сторону');
  const fillers = parts.filter((p) => p.kind === 'kitchen:filler');
  assert.ok(fillers.every((p) => p.w < 300));
  assert.ok(parts.filter((p) => p.kind === 'kitchen:base').every((p) => p.w >= 300 && p.w <= 1200));
  assert.deepEqual(it.comp.items.map((e) => [e.type, e.x]), [['sink', 600], ['hob', 1800], ['hood', 1800]]);
  // Короче, чем помещаются элементы, — отказ; минимальная длина — по пределу.
  assert.equal(editKitchen(it, { op: 'length', side: 'main', value: 1000 }), null);
  apply(it, { op: 'toggle', type: 'sink', on: false });
  apply(it, { op: 'toggle', type: 'hob', on: false });
  apply(it, { op: 'toggle', type: 'hood', on: false });
  apply(it, { op: 'length', side: 'main', value: 10 });
  assert.equal(it.comp.len.main, 300);
});

test('галочки: элемент появляется на свободном месте и убирается', () => {
  const it = kitchenOf('kitchen-row', { len: { main: 3600 } });
  apply(it, { op: 'move', type: 'hob', x: 3000 });
  apply(it, { op: 'toggle', type: 'dishwasher', on: true });
  const dw = it.comp.items.find((e) => e.type === 'dishwasher');
  assert.deepEqual([dw.side, dw.x, dw.w], ['main', 1400, 600], 'посудомойка — рядом с мойкой');
  apply(it, { op: 'toggle', type: 'fridge', on: true });
  assert.equal(partsOverlap(layer(compositeParts(it), 'base')), false);
  assert.equal(editKitchen(it, { op: 'toggle', type: 'fridge', on: true }), null, 'второй холодильник нельзя');
  // Колонна снимает верхние шкафы над собой.
  const fr = it.comp.items.find((e) => e.type === 'fridge');
  const upper = layer(compositeParts(it), 'upper').filter((p) => p.kind === 'kitchen:wall-cabinet');
  assert.ok(upper.every((p) => p.at + p.w <= fr.x || p.at >= fr.x + fr.w));
  apply(it, { op: 'toggle', type: 'dishwasher', on: false });
  assert.equal(it.comp.items.some((e) => e.type === 'dishwasher'), false);
  near(sideRun(compositeParts(it), 'main'), 3600, 'место занято шкафами');
  apply(it, { op: 'upper', value: false });
  assert.equal(layer(compositeParts(it), 'upper').filter((p) => p.kind !== 'kitchen:hood').length, 0);
  // Нет места — отказ.
  const small = kitchenOf('kitchen-row', { len: { main: 1400 }, items: [{ type: 'sink', side: 'main', x: 0, w: 800 }, { type: 'hob', side: 'main', x: 800, w: 600 }] });
  assert.equal(editKitchen(small, { op: 'toggle', type: 'fridge', on: true }), null);
});

test('перемещение элемента: шаг, упор в соседа, перескок, вытяжка едет с плитой', () => {
  const it = kitchenOf('kitchen-row', { len: { main: 3600 } });
  apply(it, { op: 'move', type: 'sink', x: 1500 });
  assert.equal(it.comp.items.find((e) => e.type === 'sink').x, 1000, 'упор в плиту');
  apply(it, { op: 'move', type: 'sink', x: 2300 });
  assert.equal(it.comp.items.find((e) => e.type === 'sink').x, 2400, 'перескок за плиту');
  apply(it, { op: 'move', type: 'sink', x: 99999 });
  assert.equal(it.comp.items.find((e) => e.type === 'sink').x, 2800, 'не вылезает за сторону');
  apply(it, { op: 'move', type: 'hob', x: 0 });
  const hob = it.comp.items.find((e) => e.type === 'hob');
  const hood = it.comp.items.find((e) => e.type === 'hood');
  assert.deepEqual([hob.x, hood.x], [0, 0], 'вытяжка над плитой');
  apply(it, { op: 'move', type: 'hood', x: 1200 });
  assert.equal(it.comp.items.find((e) => e.type === 'hood').x, 1200, 'вытяжку можно отвести от плиты');
  apply(it, { op: 'move', type: 'hood', x: 0 });
  assert.equal(partsOverlap(layer(compositeParts(it), 'base')), false);
  // Перенос на другую сторону П-образной кухни.
  const u = kitchenOf('kitchen-u');
  assert.equal(editKitchen(u, { op: 'move', type: 'sink', side: 'right', x: 600 }), null, 'мойке не хватает места у холодильника');
  apply(u, { op: 'move', type: 'hob', side: 'right', x: 700 });
  const s = u.comp.items.find((e) => e.type === 'hob');
  assert.deepEqual([s.side, s.x], ['right', 600], 'на правой стороне после угла, упор в холодильник');
  assert.equal(u.comp.items.find((e) => e.type === 'hood').side, 'right', 'вытяжка — за плитой');
  assert.equal(partsOverlap(layer(compositeParts(u), 'base')), false);
});

test('форма и зеркало: смена формы, лишние элементы, зеркальная Г', () => {
  const it = kitchenOf('kitchen-row');
  apply(it, { op: 'shape', value: 'U' });
  assert.equal(it.comp.shape, 'U');
  const hob = it.comp.items.find((e) => e.type === 'hob');
  const hood = it.comp.items.find((e) => e.type === 'hood');
  assert.deepEqual([hood.side, hood.x], [hob.side, hob.x], 'вытяжка осталась над плитой');
  assert.equal(it.comp.items.find((e) => e.type === 'sink').side, 'main');
  assert.equal(partsOverlap(layer(compositeParts(it), 'base')), false);
  const u = kitchenOf('kitchen-u', { len: { main: 1500 } });
  const next = editKitchen(u, { op: 'shape', value: 'line' });
  assert.ok(next.comp.items.length < u.comp.items.length, 'не поместившиеся снимаются');
  const l = kitchenOf('kitchen-corner');
  const before = compositeParts(l).filter((p) => p.layer === 'base').map((p) => `${p.kind}:${-p.x}:${p.y}`).sort();
  apply(l, { op: 'mirror', value: true });
  assert.deepEqual(kitchenFrames(l.comp).map((f) => f.side), ['main', 'right']);
  const after = compositeParts(l).filter((p) => p.layer === 'base').map((p) => `${p.kind}:${p.x}:${p.y}`).sort();
  assert.deepEqual(after, before, 'зеркальное отражение');
});

test('повороты 0/90/180/270: габарит, попадание, элемент под точкой', () => {
  const it = kitchenOf('kitchen-corner', {}, { x: 3000, y: 2000 });
  const [w, h] = [it.w, it.h];
  for (const rotation of [0, 90, 180, 270]) {
    it.rotation = rotation;
    const b = compositeBounds(it);
    const odd = rotation % 180 !== 0;
    near(b.w, odd ? h : w, `${rotation}° w`);
    near(b.h, odd ? w : h, `${rotation}° h`);
    for (const p of partsInHouse(it).filter((q) => q.element && q.layer === 'base')) {
      assert.equal(kitchenElementAt(it, p.x, p.y)?.type, p.element, `${rotation}°: ${p.element}`);
      const at = kitchenProject(it, p.x, p.y);
      const el = it.comp.items.find((e) => e.type === p.element);
      assert.equal(at.side, el.side);
      near(at.t, el.x + el.w / 2, `${rotation}°: положение ${p.element}`);
    }
    // Ручки — у передней кромки своих элементов.
    for (const hd of kitchenHandles(it)) assert.ok(pointInComposite(it, hd.x, hd.y));
    // Пустой внутренний угол Г — не кухня.
    const inner = partsInHouse(it).find((p) => p.kind === 'kitchen:corner');
    const cx = 2 * it.x - inner.x; const cy = 2 * it.y - inner.y;
    assert.equal(pointInComposite(it, cx, cy), false, `${rotation}°: пустой угол`);
  }
});

test('проверка comp: мусор, пределы, сохранение и открытие; старая кухня без comp', () => {
  const c = normalizeComp({
    type: 'kitchen', shape: 'Z', len: { main: -5, left: 'x' }, depth: 5000, baseW: 1, upper: 0,
    items: [{ type: 'sink', side: 'nowhere', x: 'a', w: 50 }, { type: 'sink' }, { type: 'boom' }, null, { type: 'fridge', side: 'main', x: 1e9 }],
  }, 'kitchen-row');
  assert.equal(c.shape, 'line');
  assert.equal(c.depth, 900);
  assert.equal(c.baseW, 300);
  assert.equal(c.upper, false);
  assert.equal(c.len.main, 300, 'не короче рабочего участка');
  assert.deepEqual(c.items, [], 'на 300 мм ничего не помещается');
  const c2 = normalizeComp({ type: 'kitchen', shape: 'line', items: [{ type: 'sink', side: 'nowhere', w: 50 }, { type: 'sink', x: 900 }, { type: 'fridge', x: 1e9 }] }, 'kitchen-row');
  assert.deepEqual(c2.items, [{ type: 'sink', side: 'main', x: 0, w: 800 }, { type: 'fridge', side: 'main', x: 1800, w: 600 }]);
  assert.equal(normalizeComp({ type: 'kitchen' }, 'sofa'), null);
  const p = createProject();
  const old = createItem('kitchen-row', 0, 0, 2400, 600); // прежний гарнитур без comp
  const it = kitchenOf('kitchen-u', {}, { x: 500 });
  it.w = 1; // испорченный размер правится по частям
  p.items.push(old, it);
  const back = deserializeProject(serializeProject(p));
  assert.equal(back.items[0].comp, undefined, 'старая кухня остаётся обычной');
  assert.equal(back.items[0].w, 2400);
  assert.equal(back.items[1].w, 3000);
  assert.deepEqual(back.items[1].comp, it.comp);
});

test('выгрузка: JSON — comp и части, DXF — части блоками, IFC — мебель с частями', () => {
  const p = createProject();
  const it = kitchenOf('kitchen-row', {}, { x: 2000, y: 1000 });
  p.items.push(it);
  const parts = compositeParts(it);
  const blocks = planEntities(p).filter((e) => e.type === 'block');
  assert.deepEqual(blocks.map((b) => b.kind), parts.map((q) => q.kind), 'без габаритного блока');
  assert.ok(blocks.some((b) => b.kind === 'kitchen:sink'));
  const exp = buildStructuredExport(p);
  const f = (exp.levels?.[0] || exp).furniture.find((x) => x.id === it.id);
  assert.equal(f.comp.type, 'kitchen');
  assert.equal(f.parts.length, parts.length);
  const { text, counts } = buildIfc(p, { timestamp: new Date('2026-11-02T00:00:00Z') });
  assert.equal(counts.furnitureParts, parts.length);
  assert.match(text, /IFCFURNITURE\([^;]*'kitchen:sink'/);
  assert.match(text, /IFCFURNITURE\('[^']+',#\d+,'[^']+',\$,'kitchen-row',#\d+,\$,/, 'у целого нет своей геометрии');
  const furnIds = new Set([...text.matchAll(/^(#\d+)=IFCFURNITURE\(/gm)].map((m) => m[1]));
  const rels = [...text.matchAll(/=IFCRELAGGREGATES\('[^']+',#\d+,\$,\$,(#\d+),\(([^)]*)\)\)/g)].filter((m) => furnIds.has(m[1]));
  assert.equal(rels.length, 1);
  assert.equal(rels[0][2].split(',').length, parts.length);
});

test('проходы: по контуру Г, а не по габариту', () => {
  const p = createProject();
  const room = createRoom('kitchen', 0, 0, 4000, 4000);
  p.rooms.push(room);
  const k = kitchenOf('kitchen-corner', {}, { x: 1200, y: 900 }); // Г: левая и верхняя стороны
  const chair = createItem('chair', 1800, 1500, 450, 450); // во внутреннем углу Г
  p.items.push(k, chair);
  assert.equal(itemShapes(k).length, layer(compositeParts(k), 'base').length);
  const issues = furnitureIssues(p, room, deriveWalls(p));
  assert.equal(issues.some((i) => i.kind === 'overlap'), false, 'стул во внутреннем углу не пересекается с кухней');
});
