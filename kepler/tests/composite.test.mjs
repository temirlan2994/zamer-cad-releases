// Составная мебель: стол со стульями (core/composite.js) и реестр блоков.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  chairsFit, compositeBounds, compositeParts, defaultComp, normalizeComp, normalizeItemsComp, partsInHouse, withDefaultComp,
} from '../core/composite.js';
import { blocksByGroup, furnitureBlock, registerBlock, unregisterBlock } from '../core/blocks.js';
import { itemBounds } from '../core/clearance.js';
import { buildProjectDxf, buildStructuredExport, planEntities } from '../core/export.js';
import { createItem, createProject } from '../core/model.js';

const table = (w = 1600, h = 900, comp = {}) => {
  const it = withDefaultComp(createItem('dining-table', 0, 0, w, h));
  it.comp = { ...it.comp, ...comp, sides: { ...it.comp.sides, ...(comp.sides || {}) } };
  return it;
};
const bySide = (parts) => ({
  top: parts.filter((p) => p.rotation === 0).length,
  bottom: parts.filter((p) => p.rotation === 180).length,
  left: parts.filter((p) => p.rotation === 270).length,
  right: parts.filter((p) => p.rotation === 90).length,
});

test('число стульев на стороне: floor((L + зазор) / (стул + зазор))', () => {
  assert.equal(chairsFit(1600, 450, 150), 2);
  assert.equal(chairsFit(1800, 450, 150), 3);
  assert.equal(chairsFit(1050, 450, 150), 2); // ровно впритык
  assert.equal(chairsFit(1049, 450, 150), 1);
  assert.equal(chairsFit(400, 450, 150), 0);
});

test('стол 1600×900 по умолчанию: по 2 стула сверху и снизу', () => {
  const parts = compositeParts(table());
  assert.deepEqual(bySide(parts), { top: 2, bottom: 2, left: 0, right: 0 });
  assert.ok(parts.every((p) => p.kind === 'chair' && p.w === 450 && p.h === 450), 'стул не растягивается');
});

test('растягивание стола пересчитывает стулья, ряд центрирован', () => {
  const parts = compositeParts(table(2400));
  const top = parts.filter((p) => p.rotation === 0).map((p) => p.x);
  assert.equal(top.length, 4);
  assert.deepEqual(top, [-900, -300, 300, 900]);
  assert.equal(compositeParts(table(1000)).filter((p) => p.rotation === 0).length, 1);
  assert.equal(compositeParts(table(1000))[0].x, 0);
});

test('стороны и торцы: стулья смотрят лицом к столу', () => {
  const parts = compositeParts(table(1600, 900, { sides: { left: true, right: true, bottom: false } }));
  assert.deepEqual(bySide(parts), { top: 2, bottom: 0, left: 1, right: 1 });
  const left = parts.find((p) => p.rotation === 270);
  const right = parts.find((p) => p.rotation === 90);
  const top = parts.find((p) => p.rotation === 0);
  // Отступ 100 от края до стула: центр стула = край + 100 + 225.
  assert.equal(left.x, -800 - 325);
  assert.equal(right.x, 800 + 325);
  assert.equal(top.y, -450 - 325);
  assert.equal(left.y, 0);
});

test('отрицательный отступ — стул задвинут под стол', () => {
  const [top] = compositeParts(table(1000, 900, { offset: -150, sides: { bottom: false } }));
  assert.equal(top.y, -450 + 150 - 225);
});

test('без стульев и без comp — частей нет', () => {
  assert.deepEqual(compositeParts(table(1600, 900, { chair: null })), []);
  assert.deepEqual(compositeParts(createItem('dining-table', 0, 0, 1600, 900)), []);
  assert.deepEqual(compositeParts(createItem('sofa', 0, 0, 2200, 950)), []);
});

test('поворот: части в осях дома и габарит со стульями', () => {
  const t = table();
  t.x = 1000; t.y = 2000;
  const b0 = compositeBounds(t);
  assert.deepEqual(b0, { x: 200, y: 2000 - 450 - 550, w: 1600, h: 900 + 1100 });
  assert.deepEqual(itemBounds(t), b0, 'проходы и пересечения считают стулья');
  t.rotation = 90;
  const b90 = compositeBounds(t);
  assert.deepEqual(b90, { x: 1000 - 1000, y: 2000 - 800, w: 2000, h: 1600 });
  const world = partsInHouse(t);
  const top = world.find((p) => p.rotation === 90); // верхний ряд после поворота на 90°
  assert.ok(Math.abs(top.x - (1000 + 775)) < 1e-6);
});

test('круглый стол: стулья по кругу, лицом к центру', () => {
  const it = withDefaultComp(createItem('table-round', 0, 0, 1100, 1100));
  const parts = compositeParts(it);
  assert.equal(parts.length, 5);
  assert.equal(parts[0].rotation, 0);
  assert.ok(Math.abs(parts[0].x) < 1e-6 && parts[0].y < -550);
  for (const p of parts) assert.ok(Math.abs(Math.hypot(p.x, p.y) - (550 + 100 + 225)) < 1e-6);
  it.comp.count = 3;
  assert.equal(compositeParts(it).length, 3);
});

test('проверка comp: мусор отбрасывается, числа приводятся', () => {
  assert.equal(normalizeComp({ type: 'sofa-x' }, 'dining-table'), null);
  assert.equal(normalizeComp({ type: 'dining' }, 'sofa'), null);
  assert.equal(normalizeComp('abc', 'dining-table'), null);
  const c = normalizeComp({ type: 'dining', offset: '50', spacing: -5, sides: { top: 1 } }, 'dining-table');
  assert.deepEqual(c, { type: 'dining', chair: 'chair', offset: 50, spacing: 0, sides: { top: true, bottom: false, left: false, right: false }, count: 0 });
  const items = [{ kind: 'sofa', comp: { type: 'dining' } }, { kind: 'dining-table', comp: { type: 'dining' } }];
  normalizeItemsComp(items);
  assert.ok(!('comp' in items[0]));
  assert.equal(items[1].comp.offset, 100);
  assert.equal(defaultComp('sofa'), null);
  assert.equal(defaultComp('conference-table').sides.left, true);
});

test('реестр блоков: стулья каталога и блок из DXF фиксированного размера', () => {
  assert.ok(blocksByGroup('chair').some((b) => b.id === 'chair'));
  assert.equal(furnitureBlock('chair').w, 450);
  registerBlock({ id: 'dxf:Стул-тест', title: 'Стул из DXF', group: 'chair', w: 500, h: 550, lines: [[-250, -275, 250, -275]] });
  try {
    assert.ok(blocksByGroup('chair').some((b) => b.id === 'dxf:Стул-тест'));
    const parts = compositeParts(table(1600, 900, { chair: 'dxf:Стул-тест' }));
    assert.ok(parts.every((p) => p.kind === 'dxf:Стул-тест' && p.w === 500 && p.h === 550));
    assert.equal(parts.filter((p) => p.rotation === 0).length, 2); // (1600+150)/(650) → 2
  } finally {
    unregisterBlock('dxf:Стул-тест');
  }
  // Блок не загружен — стул по умолчанию, id в comp сохраняется.
  const t = table(1600, 900, { chair: 'dxf:нет-такого' });
  assert.equal(compositeParts(t)[0].kind, 'chair');
  assert.equal(normalizeComp(t.comp, t.kind).chair, 'dxf:нет-такого');
  assert.throws(() => registerBlock({ id: 'x', w: 0, h: 1 }), /больше нуля/);
});

test('экспорт: стулья — отдельные блоки DXF и части в JSON', () => {
  const p = createProject('Т');
  p.items.push(table());
  const json = buildStructuredExport(p);
  const f = json.levels[0].furniture[0];
  assert.equal(f.size.w, 1600);
  assert.equal(f.parts.length, 4);
  assert.equal(f.comp.type, 'dining');
  const blocks = planEntities(p).filter((e) => e.type === 'block');
  assert.deepEqual(blocks.map((b) => b.kind).sort(), ['chair', 'chair', 'chair', 'chair', 'dining-table']);
  const dxf = buildProjectDxf(p);
  assert.ok(typeof dxf === 'string' && dxf.includes('ENTITIES'));
});
