import test from 'node:test';
import assert from 'node:assert/strict';

import { FURNITURE } from '../core/catalog.js';
import { BED_DESIGNS, COFFEE_TABLE_DUO, PREMIUM_FURNITURE_SIZES, bedDesign } from '../core/furniture-design.js';

test('современные диваны учитывают полную глубину и широкие подлокотники', () => {
  assert.ok(FURNITURE.sofa.h >= 1000);
  assert.ok(FURNITURE.sofa.w >= 2600);
  assert.deepEqual({ w: FURNITURE.sofa.w, h: FURNITURE.sofa.h }, PREMIUM_FURNITURE_SIZES.sofa);
});

test('габарит кровати больше матраса и хранит честную дизайнерскую огибающую', () => {
  for (const kind of Object.keys(BED_DESIGNS)) {
    const d = bedDesign(kind);
    assert.ok(d.w > d.mattressW, `${kind}: мягкие борта по ширине`);
    assert.ok(d.h > d.mattressH, `${kind}: изголовье и изножье по длине`);
    assert.ok(d.headboardH >= 900, `${kind}: полноценное изголовье`);
  }
});

test('шкаф прихожей и гардеробная имеют рабочую глубину не меньше 600 мм', () => {
  assert.ok(FURNITURE['coat-rack'].h >= 600);
  assert.ok(FURNITURE['wardrobe-rack'].h >= 600);
  assert.ok(FURNITURE.wardrobe.h >= 600);
});

test('журнальная композиция состоит из двух столешниц внутри общей огибающей', () => {
  assert.equal(Object.keys(COFFEE_TABLE_DUO).length, 2);
  for (const disk of Object.values(COFFEE_TABLE_DUO)) {
    assert.ok(Math.abs(disk.cx) + disk.rx <= 0.5);
    assert.ok(Math.abs(disk.cy) + disk.ry <= 0.5);
  }
  assert.ok(COFFEE_TABLE_DUO.small.z > COFFEE_TABLE_DUO.large.z);
});

test('санитарный каталог различает напольный, подвесной и унитаз-биде', () => {
  assert.equal(FURNITURE.toilet.title, 'Унитаз напольный');
  assert.ok(FURNITURE['toilet-wall'].title.includes('инсталляцией'));
  assert.ok(FURNITURE['toilet-smart']);
});
