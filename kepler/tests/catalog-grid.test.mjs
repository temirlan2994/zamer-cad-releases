import test from 'node:test';
import assert from 'node:assert/strict';
import { GRID_STEP, gridStepForScale } from '../core/catalog.js';

test('шаг привязки мельчает при приближении камеры', () => {
  assert.equal(gridStepForScale(0.08), GRID_STEP); // обычный вид
  assert.equal(gridStepForScale(0.2), 50);
  assert.equal(gridStepForScale(0.4), 25);
  assert.equal(gridStepForScale(1), 10);
  assert.equal(gridStepForScale(2), 5);
  assert.equal(gridStepForScale(10), 1);
  assert.equal(gridStepForScale(0), GRID_STEP);
  assert.equal(gridStepForScale(undefined), GRID_STEP);
  // шаг не растёт при дальнейшем приближении
  let prev = Infinity;
  for (const s of [0.05, 0.2, 0.5, 1, 2, 5, 10, 50]) { const g = gridStepForScale(s); assert.ok(g <= prev); prev = g; }
});
