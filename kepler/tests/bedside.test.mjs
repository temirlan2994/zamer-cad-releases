// Быстрые тумбы у кровати: места у изголовья, поворот и занятые стороны.
import test from 'node:test';
import assert from 'node:assert/strict';

import { bedsideTarget, missingBedsideSpots, supportsBedsideNightstands } from '../core/bedside.js';

const bed = (extra = {}) => ({
  id: 'bed-1', kind: 'bed-double', x: 2500, y: 1000, w: 1600, h: 2000, rotation: 0,
  ...extra,
});

test('тумбы стоят по бокам изголовья с зазором 50 мм', () => {
  assert.deepEqual(bedsideTarget(bed(), 'left'), {
    side: 'left', x: 1425, y: 200, w: 450, h: 400, rotation: 0,
  });
  assert.deepEqual(bedsideTarget(bed(), 'right'), {
    side: 'right', x: 3575, y: 200, w: 450, h: 400, rotation: 0,
  });
});

test('места поворачиваются вместе с кроватью', () => {
  const target = bedsideTarget(bed({ rotation: 90 }), 'right');
  assert.deepEqual(target, { side: 'right', x: 3300, y: 2075, w: 450, h: 400, rotation: 90 });
});

test('занятая сторона скрывается только у своего комплекта', () => {
  const b = bed({ bedsideSet: 'set-1', group: 'grp-1' });
  const left = { id: 'n1', kind: 'nightstand', bedsideSet: 'set-1', bedsideSide: 'left', group: 'grp-1' };
  const wrongCopy = { id: 'n2', kind: 'nightstand', bedsideSet: 'set-1', bedsideSide: 'right', group: 'grp-2' };
  assert.deepEqual(missingBedsideSpots([b, left, wrongCopy], b).map((spot) => spot.side), ['right']);
});

test('ручка есть у обычных кроватей, но не у двухъярусной и детской кроватки', () => {
  assert.equal(supportsBedsideNightstands({ kind: 'bed-queen' }), true);
  assert.equal(supportsBedsideNightstands({ kind: 'kids-bed' }), true);
  assert.equal(supportsBedsideNightstands({ kind: 'bed-bunk' }), false);
  assert.equal(supportsBedsideNightstands({ kind: 'crib' }), false);
});
