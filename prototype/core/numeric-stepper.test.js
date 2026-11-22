import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeNumericStep, numericDragDelta, steppedNumber } from "./numeric-stepper.js";

test("numeric steps apply relative to the current value in either direction", () => {
  assert.equal(steppedNumber(11, 3, 10), 41);
  assert.equal(steppedNumber(11, -3, 10), -19);
  assert.equal(steppedNumber(0.2, 1, 0.1), 0.3);
});

test("numeric steps respect field boundaries and default safely on older projects", () => {
  assert.equal(steppedNumber(3, -5, 1, { min: 2, max: 50 }), 2);
  assert.equal(steppedNumber(45, 3, 10, { min: 2, max: 50 }), 50);
  assert.equal(normalizeNumericStep(undefined), 1);
  assert.equal(normalizeNumericStep(-5), 1);
  assert.equal(normalizeNumericStep(10), 10);
});

test("a faster movement covers more steps for the same distance", () => {
  const slow = numericDragDelta(12, 120);
  const fast = numericDragDelta(12, 15);
  assert.ok(slow > 0);
  assert.ok(fast > slow * 2);
  assert.equal(numericDragDelta(-12, 15), -fast);
  assert.equal(numericDragDelta(0, 15), 0);
  assert.ok(numericDragDelta(50, 0) <= 24);
});
