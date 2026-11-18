import test from "node:test";
import assert from "node:assert/strict";
import { extendLine, joinLines, lineCrossing, mirrorLine, parallelLine, scaleLine, splitLine, trimLine } from "./line-edits.js";

const segment = (x1, y1, x2, y2) => ({ x1, y1, x2, y2 });
const point = (x, y = 0) => ({ x, y });
const horizontal = segment(0, 0, 100, 0);
const boundary = (x) => segment(x, -50, x, 50);

test("finds segment crossings with the parameters of both directed lines", () => {
  assert.deepEqual(lineCrossing(horizontal, segment(80, 60, 80, -20)), { x: 80, y: 0, t: 0.8, u: 0.75 });
  assert.deepEqual(lineCrossing(horizontal, segment(100, 0, 100, 10)), { x: 100, y: 0, t: 1, u: 0 });
  assert.equal(lineCrossing(horizontal, segment(50, 5, 80, 5)), null);
  assert.equal(lineCrossing(horizontal, segment(50, 0, 80, 0)), null);
  assert.equal(lineCrossing(horizontal, segment(50, 0, 50, 0)), null);
});

test("extends one or both directions for apparent intersections", () => {
  const edge = segment(125, 25, 125, 50);
  assert.equal(lineCrossing(horizontal, edge, { extendFirst: true }), null);
  assert.equal(lineCrossing(horizontal, edge, { extendSecond: true }), null);
  assert.deepEqual(lineCrossing(horizontal, edge, { extendFirst: true, extendSecond: true }), { x: 125, y: 0, t: 1.25, u: -1 });
});

test("trims the picked end against the nearest finite crossing", () => {
  const line = Object.freeze({ ...horizontal, id: "source", layer: "measure" });
  const edges = Object.freeze([boundary(70), segment(95, 10, 95, 30), boundary(25), segment(20, 0, 80, 0)]);
  assert.deepEqual(trimLine(line, edges, point(95, 4)), [segment(0, 0, 70, 0)]);
  assert.deepEqual(trimLine(line, edges, point(-3)), [segment(25, 0, 100, 0)]);
  assert.deepEqual(line, { ...horizontal, id: "source", layer: "measure" });
});

test("trims between surrounding boundaries while retaining both outer segments", () => {
  const reversed = segment(100, 0, 0, 0);
  assert.deepEqual(trimLine(reversed, [boundary(25), boundary(60), boundary(60), boundary(85)], point(70)), [
    segment(100, 0, 85, 0),
    segment(60, 0, 0, 0),
  ]);
  assert.equal(trimLine(reversed, [boundary(60)], point(60)), null);
  assert.equal(trimLine(reversed, [boundary(0), boundary(100), boundary(125)], point(20)), null);
});

test("extends only the selected end to the nearest finite edge in front of it", () => {
  const edges = [boundary(200), boundary(120), boundary(80), boundary(-90), boundary(-20), segment(105, 1, 105, 40)];
  assert.deepEqual(extendLine(horizontal, edges, point(90, 5)), segment(0, 0, 120, 0));
  assert.deepEqual(extendLine(horizontal, edges, point(10)), segment(-20, 0, 100, 0));
  assert.deepEqual(extendLine(segment(100, 0, 0, 0), edges, point(10)), segment(100, 0, -20, 0));
  assert.equal(extendLine(horizontal, [boundary(-20), boundary(100), boundary(80)], point(90)), null);
});

test("trims the portion of a line inside a circle at its two exact crossings", () => {
  const circle = { type: "circle", cx: 50, cy: 0, radius: 15 };
  assert.deepEqual(trimLine(horizontal, [circle], point(48)), [segment(0, 0, 35, 0), segment(65, 0, 100, 0)]);
  assert.deepEqual(trimLine(horizontal, [{ ...circle, cy: 15 }], point(75)), [segment(0, 0, 50, 0)]);
  assert.equal(trimLine(horizontal, [{ ...circle, cy: 16 }], point(75)), null);
});

test("extends to the nearer circle intersection, ignoring one behind the selected end", () => {
  const circle = { type: "circle", cx: 150, cy: 0, radius: 30 };
  assert.deepEqual(extendLine(horizontal, [circle], point(95)), segment(0, 0, 120, 0));
  assert.deepEqual(extendLine(horizontal, [{ ...circle, cx: 115 }], point(95)), segment(0, 0, 145, 0));
});

test("uses only the angular span of an arc for trimming and extending", () => {
  const arc = { type: "arc", start: point(150, -25), through: point(175), end: point(150, 25) };
  assert.deepEqual(extendLine(horizontal, [arc], point(95)), segment(0, 0, 175, 0));
  assert.deepEqual(extendLine(horizontal, [{ ...arc, start: arc.end, end: arc.start }], point(95)), segment(0, 0, 175, 0));
  const left = segment(0, 0, 150, 0);
  assert.equal(trimLine(left, [arc], point(140)), null);
  const through = segment(0, 0, 200, 0);
  assert.deepEqual(trimLine(through, [arc], point(195)), [segment(0, 0, 175, 0)]);
  assert.equal(extendLine(horizontal, [{ ...arc, through: point(150) }], point(95)), null);
});

test("splits at a projected point without adding a gap", () => {
  assert.deepEqual(splitLine(horizontal, point(40, -2)), [segment(0, 0, 40, 0), segment(40, 0, 100, 0)]);
  assert.equal(splitLine(horizontal, point(-20)), null);
  assert.equal(splitLine(horizontal, point(100)), null);
  assert.equal(splitLine(horizontal, point(NaN)), null);
});

test("breaks out an interval regardless of pick order and clips to line ends", () => {
  assert.deepEqual(splitLine(horizontal, point(60, 8), point(30, -5)), [segment(0, 0, 30, 0), segment(60, 0, 100, 0)]);
  assert.deepEqual(splitLine(horizontal, point(-15), point(40)), [segment(40, 0, 100, 0)]);
  assert.deepEqual(splitLine(horizontal, point(-15), point(125)), []);
});

test("joins collinear lines with gaps and overlaps, following the source direction", () => {
  const overlapping = segment(75, 0, 125, 0);
  const separated = segment(-30, 0, -50, 0);
  const contained = segment(15, 0, 10, 0);
  assert.deepEqual(joinLines(horizontal, [overlapping, separated, contained]), segment(-50, 0, 125, 0));
  assert.deepEqual(joinLines(segment(100, 0, 0, 0), [overlapping, separated]), segment(125, 0, -50, 0));
  assert.deepEqual(joinLines(horizontal, [contained]), horizontal);
});

test("rejects an entire join with any incompatible line", () => {
  assert.equal(joinLines(horizontal, [segment(110, 0, 120, 0), segment(120, 0, 130, 10)]), null);
  assert.equal(joinLines(horizontal, [segment(120, 1, 140, 1)]), null);
  assert.equal(joinLines(horizontal, []), null);
  assert.equal(joinLines(horizontal, [horizontal]), null);
});

test("offsets a line through a point or by a fixed distance on the picked side", () => {
  assert.deepEqual(parallelLine(horizontal, point(120, 30)), segment(0, 30, 100, 30));
  assert.deepEqual(parallelLine(horizontal, point(10, -3), 20), segment(0, -20, 100, -20));
  assert.deepEqual(parallelLine(segment(100, 0, 0, 0), point(10, -3), 20), segment(100, -20, 0, -20));
  assert.equal(parallelLine(horizontal, point(100), 20), null);
  assert.equal(parallelLine(horizontal, point(100, 20), Infinity), null);
  assert.equal(parallelLine(horizontal, point(100, 20), 0), null);
});

test("mirrors line endpoints across an arbitrary axis and retains their order", () => {
  assert.deepEqual(mirrorLine(horizontal, point(20, -30), point(20, 10)), segment(40, 0, -60, 0));
  assert.deepEqual(mirrorLine(horizontal, point(20, 10), point(20, -30)), segment(40, 0, -60, 0));
  const diagonal = mirrorLine(horizontal, point(0), point(40, 40));
  assert.ok(Math.abs(diagonal.x2) < 1e-9);
  assert.ok(Math.abs(diagonal.y2 - 100) < 1e-9);
  assert.equal(mirrorLine(horizontal, point(20, 10), point(20, 10)), null);
});

test("scales a line uniformly around a supplied base point", () => {
  assert.deepEqual(scaleLine(horizontal, point(20, 20), 2), segment(-20, -20, 180, -20));
  assert.deepEqual(scaleLine(horizontal, point(20, 20), 0.5), segment(10, 10, 60, 10));
  assert.deepEqual(scaleLine(horizontal, point(20, 20), 1), horizontal);
  assert.equal(scaleLine(horizontal, point(0), 0), null);
  assert.equal(scaleLine(horizontal, point(0), -1), null);
  assert.equal(scaleLine(horizontal, point(0), Infinity), null);
});
