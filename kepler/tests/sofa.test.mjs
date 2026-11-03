// Диван-конструктор (core/composite.js, тип 'sofa'): сборка модулей,
// габарит, повороты, правки с якорем, выгрузка.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SOFA_BACK, compositeBounds, compositeParts, editSofa, isFixedSizeComp, normalizeComp, normalizeItemsComp,
  dedupeSegments, partRect, partsInHouse, partsOverlap, pointInComposite, sofaEnds, sofaLines, sofaModule, sofaSpots,
  withDefaultComp,
} from '../core/composite.js';
import { defaultItemsFor } from '../core/furnish.js';
import { createRoom } from '../core/model.js';
import { itemBounds } from '../core/clearance.js';
import { buildStructuredExport, planEntities } from '../core/export.js';
import { createItem, createProject, deserializeProject, serializeProject } from '../core/model.js';

const sofaWith = (modules, { kind = 'sofa', dir = 0, depth = 950, x = 0, y = 0, rotation = 0 } = {}) => {
  const it = createItem(kind, x, y, 1, 1, rotation);
  it.comp = { type: 'sofa', depth, dir, modules: modules.map((m) => (Array.isArray(m) ? sofaModule(...m) : sofaModule(m))) };
  normalizeItemsComp([it]);
  return it;
};
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6, `${msg}: ${a} ≠ ${b}`);
// Части касаются (общая кромка), но не пересекаются.
const touching = (a, b) => {
  const ra = partRect(a); const rb = partRect(b);
  const ix = Math.min(ra.x + ra.w, rb.x + rb.w) - Math.max(ra.x, rb.x);
  const iy = Math.min(ra.y + ra.h, rb.y + rb.h) - Math.max(ra.y, rb.y);
  return (Math.abs(ix) < 1e-6 && iy > 0) || (Math.abs(iy) < 1e-6 && ix > 0);
};

test('диваны каталога — конструкторы, размер совпадает с каталогом', () => {
  for (const [kind, w, h] of [['sofa', 2200, 950], ['sofa-2', 1600, 900], ['sofa-corner', 2600, 1600], ['sofa-u', 3000, 2400]]) {
    const it = withDefaultComp(createItem(kind, 0, 0, 10, 10));
    assert.equal(it.comp.type, 'sofa', kind);
    assert.deepEqual([it.w, it.h], [w, h], kind);
    assert.ok(isFixedSizeComp(it));
    assert.equal(partsOverlap(compositeParts(it)), false, `${kind}: части не пересекаются`);
  }
  assert.equal(withDefaultComp(createItem('sofa-bed', 0, 0, 2000, 1000)).comp, undefined);
});

test('прямой диван: подлокотник + 2 сиденья + подлокотник впритык, спинка только у сидений', () => {
  const it = sofaWith(['arm', 'seat', 'seat', 'arm']);
  const p = compositeParts(it);
  assert.deepEqual(p.map((q) => q.kind), ['sofa:arm', 'sofa:seat', 'sofa:seat', 'sofa:arm']);
  assert.deepEqual(p.map((q) => q.x), [-1000, -450, 450, 1000]);
  assert.ok(p.every((q) => q.y === 0 && q.h === 950 && q.rotation === 0));
  assert.deepEqual(p.map((q) => q.back), [0, SOFA_BACK, SOFA_BACK, 0], 'подлокотник не заходит на спинку');
  for (let i = 1; i < p.length; i += 1) assert.ok(touching(p[i - 1], p[i]), `стык ${i}`);
  // Общую кромку рисует только предыдущий модуль.
  assert.deepEqual(p.map((q) => [q.joinStart, q.joinEnd]), [[false, true], [true, true], [true, true], [true, false]]);
  assert.ok(p.slice(1).every((q) => q.startFrom === q.h), 'начальная кромка у соседей не повторяется');
});

test('сиденье + угол + сиденье: угол поворачивает цепочку, спинка в обе стороны', () => {
  const it = sofaWith([['seat', 1000], 'corner', ['seat', 800]]);
  assert.deepEqual([it.w, it.h], [1000 + 950, 950 + 800]);
  const [s1, c, s2] = compositeParts(it);
  assert.equal(c.kind, 'sofa:corner');
  assert.equal(c.w, 950); assert.equal(c.h, 950);
  assert.equal(c.back, SOFA_BACK);
  assert.equal(s2.rotation, 90, 'после угла — вниз');
  assert.ok(touching(s1, c) && touching(c, s2));
  assert.equal(partsOverlap([s1, c, s2]), false);
  // Спинка второго сиденья — на правой кромке, на одной линии с краем угла.
  near(partRect(s2).x + partRect(s2).w, partRect(c).x + partRect(c).w, 'правая кромка');
});

test('П-образный из 7 модулей: два угла, части не пересекаются, концы смотрят вниз', () => {
  const it = sofaWith(['arm', 'seat', 'corner', ['seat', 1200], 'corner', 'seat', 'arm'], { dir: 3 });
  const parts = compositeParts(it);
  assert.equal(parts.length, 7);
  assert.equal(partsOverlap(parts), false);
  assert.deepEqual([it.w, it.h], [950 + 1200 + 950, 950 + 900 + 200]);
  const ends = sofaEnds(it);
  assert.deepEqual(ends.map((e) => [e.end, e.nx, e.ny]), [['start', 0, 1], ['end', 0, 1]]);
  near(ends[0].y, it.h / 2, 'начало — на нижней кромке');
  near(ends[1].x, it.w / 2 - 950 / 2, 'конец — под правым крылом');
});

test('кольцо из углов и встречные шезлонги не собираются (пересечение)', () => {
  const ring = sofaWith(['corner', 'corner', 'corner', 'corner']);
  assert.equal(partsOverlap(compositeParts(ring)), false, 'четыре угла — квадрат без наложений');
  assert.equal(editSofa(ring, { op: 'add', end: 'end', type: 'corner' }), null);
  assert.equal(editSofa(ring, { op: 'add', end: 'end', type: 'seat' }), null);
  const u = sofaWith(['chaise', 'corner', ['seat', 400], 'corner', 'chaise'], { dir: 3 });
  assert.equal(partsOverlap(compositeParts(u)), true);
  const ok = sofaWith(['chaise', 'corner', ['seat', 1600], 'corner']);
  assert.equal(editSofa(ok, { op: 'add', end: 'end', type: 'chaise' }) !== null, true);
});

test('шезлонг глубже сиденья: остаток боковой кромки рисует он сам', () => {
  const [, ch] = compositeParts(sofaWith(['seat', 'chaise']));
  assert.equal(ch.h, 950 + 700);
  assert.equal(ch.startFrom, 950);
});

test('добавление в конец: диван не прыгает, габарит растёт', () => {
  const it = sofaWith(['arm', 'seat', 'seat', 'arm'], { x: 5000, y: 3000 });
  const before = partsInHouse(it);
  const next = editSofa(it, { op: 'add', end: 'end', type: 'seat' });
  Object.assign(it, next);
  assert.equal(it.comp.modules.length, 5);
  assert.equal(it.w, 2200 + 900);
  const after = partsInHouse(it);
  for (let i = 0; i < 4; i += 1) {
    near(after[i].x, before[i].x, `x модуля ${i}`);
    near(after[i].y, before[i].y, `y модуля ${i}`);
  }
});

test('угол в начало: прежние модули остаются на месте и в той же ориентации', () => {
  for (const rotation of [0, 90, 180, 270]) {
    const it = sofaWith(['arm', 'seat', 'seat'], { x: 1000, y: -2000, rotation });
    const before = partsInHouse(it);
    Object.assign(it, editSofa(it, { op: 'add', end: 'start', type: 'corner' }));
    const after = partsInHouse(it);
    assert.equal(after[0].kind, 'sofa:corner');
    for (let i = 0; i < 3; i += 1) {
      near(after[i + 1].x, before[i].x, `${rotation}°: x ${i}`);
      near(after[i + 1].y, before[i].y, `${rotation}°: y ${i}`);
      assert.equal(after[i + 1].rotation, before[i].rotation, `${rotation}°: поворот ${i}`);
    }
    assert.equal(partsOverlap(compositeParts(it)), false);
  }
});

test('удаление и замена модуля, отказ удалить последний', () => {
  const it = sofaWith(['corner', 'seat', 'arm']);
  const before = partsInHouse(it);
  Object.assign(it, editSofa(it, { op: 'remove', index: 0 }));
  assert.deepEqual(it.comp.modules.map((m) => m.type), ['seat', 'arm']);
  const after = partsInHouse(it);
  near(after[0].x, before[1].x, 'сиденье на месте'); near(after[0].y, before[1].y, 'сиденье на месте');
  assert.equal(after[0].rotation, before[1].rotation);
  Object.assign(it, editSofa(it, { op: 'set', index: 0, w: 1200 }));
  assert.deepEqual([it.w, it.h], [950, 1400], 'цепочка идёт вниз, как шла после угла');
  Object.assign(it, editSofa(it, { op: 'set', index: 1, type: 'ottoman' }));
  assert.equal(it.comp.modules[1].w, 900, 'смена типа — ширина по умолчанию нового типа');
  Object.assign(it, editSofa(it, { op: 'remove', index: 1 }));
  assert.equal(editSofa(it, { op: 'remove', index: 0 }), null);
  assert.equal(editSofa(it, { op: 'add', end: 'end', type: 'bed' }), null);
});

test('повороты 0/90/180/270: габарит и проходы — по частям', () => {
  const it = sofaWith(['arm', 'seat', 'corner', 'seat', 'arm'], { x: 3000, y: 2000 });
  const [w, h] = [it.w, it.h];
  for (const rotation of [0, 90, 180, 270]) {
    it.rotation = rotation;
    const b = compositeBounds(it);
    const odd = rotation % 180 !== 0;
    near(b.w, odd ? h : w, `${rotation}° w`); near(b.h, odd ? w : h, `${rotation}° h`);
    near(b.x + b.w / 2, 3000, `${rotation}° центр`);
    assert.deepEqual(itemBounds(it), b);
    const world = partsInHouse(it);
    assert.ok(world.every((p) => p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h));
  }
});

test('проверка comp дивана: мусор, пределы, сохранение и открытие', () => {
  const c = normalizeComp({ type: 'sofa', depth: '5000', dir: -1, modules: [{ type: 'seat', w: 50 }, { type: 'x' }, null, { type: 'corner', w: 3 }] }, 'sofa');
  assert.deepEqual(c, { type: 'sofa', depth: 1400, dir: 3, modules: [{ type: 'seat', w: 400 }, { type: 'corner' }] });
  assert.equal(normalizeComp({ type: 'sofa', modules: [] }, 'sofa').modules.length, 4, 'пустой — по умолчанию');
  assert.equal(normalizeComp({ type: 'sofa' }, 'sofa-bed'), null);
  const p = createProject();
  const old = createItem('sofa', 0, 0, 2200, 950); // прежний диван без comp
  const it = sofaWith(['seat', 'corner', 'seat'], { x: 100 });
  it.w = 9999; // испорченный размер правится по модулям
  p.items.push(old, it);
  const back = deserializeProject(serializeProject(p));
  assert.equal(back.items[0].comp, undefined, 'старый диван без comp остаётся обычным');
  assert.equal(back.items[1].w, 900 + 950);
  assert.deepEqual(back.items[1].comp, it.comp);
});

test('выгрузка: JSON — comp и модули, DXF — только модули, без габаритного блока', () => {
  const p = createProject();
  const it = sofaWith(['arm', 'seat', 'arm']);
  p.items.push(it);
  const blocks = planEntities(p).filter((e) => e.type === 'block');
  assert.deepEqual(blocks.map((b) => b.kind), ['sofa:arm', 'sofa:seat', 'sofa:arm']);
  const exp = buildStructuredExport(p);
  const f = (exp.levels?.[0] || exp).furniture.find((x) => x.id === it.id);
  assert.equal(f.comp.type, 'sofa');
  assert.equal(f.parts.length, 3);
  assert.deepEqual(f.size, { w: 1300, h: 950 });
});

// Сумма длин перекрытий коллинеарных отрезков (0 — повторов нет).
function duplicatedLength(segs) {
  let total = 0;
  for (let i = 0; i < segs.length; i += 1) {
    for (let j = i + 1; j < segs.length; j += 1) {
      const [a1, b1, a2, b2] = segs[i]; const [c1, d1, c2, d2] = segs[j];
      if (b1 === b2 && d1 === d2 && b1 === d1) total += Math.max(0, Math.min(Math.max(a1, a2), Math.max(c1, c2)) - Math.max(Math.min(a1, a2), Math.min(c1, c2)));
      if (a1 === a2 && c1 === c2 && a1 === c1) total += Math.max(0, Math.min(Math.max(b1, b2), Math.max(d1, d2)) - Math.max(Math.min(b1, b2), Math.min(d1, d2)));
    }
  }
  return total;
}

test('линии модулей: каждый отрезок кромки один раз (и шезлонг → угол → модуль)', () => {
  assert.deepEqual(dedupeSegments([[0, 0, 100, 0], [50, 0, 150, 0], [0, 0, 0, 10]]), [[0, 0, 100, 0], [100, 0, 150, 0], [0, 0, 0, 10]]);
  const cases = [
    ['arm', 'seat', 'seat', 'arm'],
    ['chaise', 'corner', 'seat', 'arm'],
    ['arm', 'seat', 'chaise', 'seat', 'arm'],
    ['arm', 'seat', 'corner', ['seat', 1200], 'corner', 'chaise', 'arm'],
  ];
  for (const mods of cases) {
    const parts = compositeParts(sofaWith(mods));
    const naive = parts.flatMap((p) => { const r = partRect(p); return [[r.x, r.y, r.x + r.w, r.y], [r.x, r.y + r.h, r.x + r.w, r.y + r.h], [r.x, r.y, r.x, r.y + r.h], [r.x + r.w, r.y, r.x + r.w, r.y + r.h]]; });
    assert.ok(duplicatedLength(naive) > 0, 'без слияния кромки на стыках повторяются');
    const { segs, arcs } = sofaLines(parts);
    assert.equal(duplicatedLength(segs), 0, `${mods.join('+')}: повторов нет`);
    assert.ok(arcs.length >= 2 || !mods.includes('arm'), 'скругления подлокотников');
  }
  // Шезлонг → угол → сиденье: общая часть кромки шезлонга и сиденья нарисована один раз.
  const parts = compositeParts(sofaWith(['chaise', 'corner', 'seat']));
  const ch = partRect(parts[0]);
  const edgeX = ch.x + ch.w;
  const onEdge = sofaLines(parts).segs.filter((q) => q[0] === edgeX && q[2] === edgeX);
  const len = onEdge.reduce((n, q) => n + Math.abs(q[3] - q[1]), 0);
  near(len, ch.h + 900 - 700, 'кромка x = конец шезлонга: шезлонг 1650 + сиденье 900 − общие 700');
});

test('вставка в середину: стыки как места «+», якорь — модуль перед вставкой', () => {
  const it = sofaWith(['arm', 'seat', 'corner', 'seat', 'arm'], { x: 2000, y: 1000, rotation: 90 });
  const spots = sofaSpots(it);
  assert.deepEqual(spots.filter((s) => s.end === 'joint').map((s) => s.at), [1, 2, 3, 4]);
  assert.deepEqual(spots.filter((s) => s.end !== 'joint').map((s) => s.at), [0, 5]);
  const before = partsInHouse(it);
  Object.assign(it, editSofa(it, { op: 'insert', at: 2, type: 'ottoman' }));
  assert.deepEqual(it.comp.modules.map((m) => m.type), ['arm', 'seat', 'ottoman', 'corner', 'seat', 'arm']);
  const after = partsInHouse(it);
  for (const i of [0, 1]) { near(after[i].x, before[i].x, `x ${i}`); near(after[i].y, before[i].y, `y ${i}`); }
  assert.equal(partsOverlap(compositeParts(it)), false);
  assert.equal(editSofa(it, { op: 'insert', at: 99, type: 'seat' }), null);
});

test('попадание по дивану — только по модулям, не в пустой угол Г', () => {
  const it = sofaWith(['seat', 'corner', 'seat'], { x: 1000, y: 1000 });
  // Габарит 1850×1850, модули: верх (сиденье + угол) и правое крыло вниз.
  const b = compositeBounds(it);
  assert.ok(pointInComposite(it, b.x + 100, b.y + 100), 'сиденье');
  assert.ok(pointInComposite(it, b.x + b.w - 100, b.y + b.h - 100), 'крыло');
  assert.equal(pointInComposite(it, b.x + 100, b.y + b.h - 100), false, 'пустой угол');
  it.rotation = 90;
  const b2 = compositeBounds(it);
  assert.equal(pointInComposite(it, b2.x + 100, b2.y + 100), false, 'пустой угол после поворота — слева сверху');
  assert.ok(pointInComposite(it, b2.x + b2.w - 100, b2.y + 100));
  assert.ok(pointInComposite(createItem('bed-double', 0, 0, 1600, 2000), 700, 900));
});

test('автоподбор ставит диван конструктором того же размера', () => {
  const room = createRoom('living', 0, 0, 5000, 4000);
  const sofaItem = defaultItemsFor(room).find((i) => i.kind === 'sofa');
  assert.equal(sofaItem.comp?.type, 'sofa');
  assert.deepEqual([sofaItem.w, sofaItem.h], [2200, 950]);
  assert.equal(defaultItemsFor(room).find((i) => i.kind === 'dining-table')?.comp, undefined);
});
