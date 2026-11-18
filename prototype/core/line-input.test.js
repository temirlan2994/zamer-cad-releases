import test from "node:test";
import assert from "node:assert/strict";
import { constrainLinePoint, linePointWithConstraint, linePolarPoint, parseLineDecimal } from "./line-input.js";

const base = { x: 100, y: 200 };

test("a fixed length uses the direction chosen with the cursor", () => {
  assert.deepEqual(linePointWithConstraint(base, { x: 100, y: 172 }, { length: 25.5 }), { x: 100, y: 174.5 });
  assert.deepEqual(linePointWithConstraint(base, base, { length: 25.5 }), base);
});

test("a fixed angle constrains the cursor to the forward ray", () => {
  assert.deepEqual(linePointWithConstraint(base, { x: 150, y: 130 }, { angle: 90 }), { x: 100, y: 130 });
  assert.deepEqual(linePointWithConstraint(base, { x: 80, y: 250 }, { angle: 90 }), base);
  assert.deepEqual(linePointWithConstraint(base, { x: 170, y: 130 }, { angle: 0 }), { x: 170, y: 200 });
});

test("metric entry validates decimals and preserves exact cardinal angles", () => {
  assert.equal(parseLineDecimal(" -45,25 "), -45.25);
  assert.equal(parseLineDecimal(""), null);
  assert.equal(parseLineDecimal("bad"), null);
  assert.equal(parseLineDecimal("0"), 0);
  assert.deepEqual(linePolarPoint(base, 0.25, 90), { x: 100, y: 199.75 });
});

test("orthogonal constraint projects onto the nearest axis without rotating a length", () => {
  assert.deepEqual(constrainLinePoint(base, { x: 170, y: 240 }), { x: 170, y: 200 });
  assert.deepEqual(constrainLinePoint(base, { x: 80, y: 130 }), { x: 100, y: 130 });
  assert.deepEqual(constrainLinePoint(base, { x: 25, y: 210 }), { x: 25, y: 200 });
  assert.deepEqual(constrainLinePoint(base, { x: 110, y: 280 }), { x: 100, y: 280 });
  assert.deepEqual(constrainLinePoint(base, base), base);
  const diagonal = constrainLinePoint(base, { x: 130, y: 220 }, 45);
  assert.ok(Math.abs(diagonal.x - 125) < 1e-10);
  assert.ok(Math.abs(diagonal.y - 225) < 1e-10);
});
