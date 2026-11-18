import test from "node:test";
import assert from "node:assert/strict";
import { constrainLinePoint, parseLinePoint } from "./line-input.js";

const base = { x: 100, y: 200 };

test("absolute and relative CAD coordinates invert Y and retain decimal precision", () => {
  assert.deepEqual(parseLinePoint(" 12.25, -20.5 "), { x: 12.25, y: 20.5 });
  assert.deepEqual(parseLinePoint("#-10,20", { base }), { x: -10, y: -20 });
  assert.deepEqual(parseLinePoint(" 10,5 ; -20,25 "), { x: 10.5, y: 20.25 });
  assert.deepEqual(parseLinePoint("@20,5", { base }), { x: 120, y: 195 });
  assert.deepEqual(parseLinePoint("@1,25;-2,5", { base }), { x: 101.25, y: 202.5 });
  assert.deepEqual(parseLinePoint("0,0"), { x: 0, y: 0 });
});

test("polar coordinates use positive counterclockwise angles and exact cardinal axes", () => {
  assert.deepEqual(parseLinePoint("@20.25<90", { base }), { x: 100, y: 179.75 });
  assert.deepEqual(parseLinePoint("@20,25<-90", { base }), { x: 100, y: 220.25 });
  assert.deepEqual(parseLinePoint("@10<540", { base }), { x: 90, y: 200 });
  const diagonal = parseLinePoint("@10<45", { base });
  assert.ok(Math.abs(diagonal.x - (100 + Math.sqrt(50))) < 1e-10);
  assert.ok(Math.abs(diagonal.y - (200 - Math.sqrt(50))) < 1e-10);
});

test("a bare distance advances along the supplied world-space direction", () => {
  assert.deepEqual(parseLinePoint(" 25.5 ", { base, direction: { x: 0, y: -12 } }), { x: 100, y: 174.5 });
  assert.deepEqual(parseLinePoint("10", { base, direction: { x: 3, y: 4 } }), { x: 106, y: 208 });
  assert.deepEqual(parseLinePoint("2", { base, direction: { x: -Number.MAX_VALUE, y: 0 } }), { x: 98, y: 200 });
  assert.equal(parseLinePoint("100", { base }), null);
  assert.equal(parseLinePoint("100", { base, direction: { x: 0, y: 0 } }), null);
  assert.equal(parseLinePoint("-100", { base, direction: { x: 1, y: 0 } }), null);
});

test("malformed, non-finite and incomplete input does not resolve", () => {
  for (const value of [null, "", "@1", "#1", "1,", "1,2,3", "1.1,5;2", "@-1<90", "@1<", "@1<2<3", "1<2", "@1<Infinity", "1 mm,2", `1${"0".repeat(400)},1`]) {
    assert.equal(parseLinePoint(value, { base }), null, String(value));
  }
  assert.equal(parseLinePoint("@1,2"), null);
  assert.equal(parseLinePoint("@1<90"), null);
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
