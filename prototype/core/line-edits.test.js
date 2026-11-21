import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_LINE_COORDINATE, extendLine, isLinePoint, isValidLine, joinLines, lineCrossing,
  mirrorLine, nearbyBoundaryPoints, nearbyIntersections, nearbyPerpendiculars,
  nearestBoundaryPoint, nearestIntersection, nearestLineExtension, nearestPerpendicular, parallelLine,
  scaleLine, splitLine, trimLine,
} from "./line-edits.js";

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

test("snaps beyond either end of a straight segment without snapping along its interior", () => {
  const source = segment(100, 0, 0, 0);
  const type = "extension";
  assert.deepEqual(nearestLineExtension(point(150, 6), [source], 8), { x: 150, y: 0, type, anchor: point(100) });
  assert.deepEqual(nearestLineExtension(point(-80, -4), [source], 8), { x: -80, y: 0, type, anchor: point(0) });
  assert.equal(nearestLineExtension(point(50, 1), [source], 8), null);
  assert.equal(nearestLineExtension(point(140, 9), [source], 8), null);
});

test("can snap the exact crossing of a continuation with another boundary", () => {
  const pick = point(146, 5);
  const target = boundary(150);
  const type = "extension";
  const anchor = point(100);
  assert.deepEqual(nearestLineExtension(pick, [horizontal, target], 9), { x: 146, y: 0, type, anchor });
  assert.deepEqual(nearestLineExtension(pick, [horizontal, target], 9, { intersect: true }), { x: 150, y: 0, type, anchor });
  assert.deepEqual(nearestLineExtension(pick, [horizontal, boundary(130)], 9, { intersect: true }), { x: 146, y: 0, type, anchor });
});

test("ignores degenerate segments and arc chords when finding a tilted continuation", () => {
  const diagonal = segment(0, 0, 50, 25);
  const arc = { type: "arc", ...segment(0, 0, 25, 10) };
  const snap = nearestLineExtension(point(100, 55), [arc, segment(1, 1, 1, 1), diagonal], 8);
  assert.deepEqual(snap.anchor, point(50, 25));
  assert.ok(Math.abs(snap.x - 102) < 1e-10);
  assert.ok(Math.abs(snap.y - 51) < 1e-10);
  assert.equal(nearestLineExtension(point(100, 40), [arc], 8), null);
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

test("rejects non-finite, degenerate or out-of-range newly written line geometry", () => {
  assert.equal(isLinePoint(point(MAX_LINE_COORDINATE, -MAX_LINE_COORDINATE)), true);
  assert.equal(isLinePoint(point(MAX_LINE_COORDINATE + 1, 0)), false);
  assert.equal(isLinePoint(point(Infinity, 0)), false);
  assert.equal(isValidLine(null), false);
  assert.equal(isValidLine(segment(0, 0, 0.0004, 0)), true);
  assert.equal(isValidLine(segment(0, 0, 0, 0)), false);
  assert.equal(isValidLine(segment(0, 0, 1e307, 0)), false);
  assert.equal(splitLine(segment(-1e308, 0, -1e308, 100), point(1e308), point(5)), null);
});

test("finds intersections on finite lines and the actual angular spans of arcs", () => {
  const circle = { type: "circle", cx: 50, cy: 0, radius: 20 };
  const arc = { type: "arc", start: point(50, -20), through: point(70), end: point(50, 20) };
  assert.deepEqual(nearestIntersection(point(28), [horizontal, circle], 10), { x: 30, y: 0, type: "intersection" });
  assert.equal(nearestIntersection(point(28), [horizontal, arc], 10), null);
  assert.deepEqual(nearestIntersection(point(69), [horizontal, arc], 10), { x: 70, y: 0, type: "intersection" });
  assert.equal(nearestIntersection(point(70), [segment(0, 0, 65, 0), arc], 10), null);
});

test("finds the closer of two circle-circle intersections without using coincident curves", () => {
  const a = { type: "circle", cx: 0, cy: 0, radius: 5 };
  const b = { type: "circle", cx: 6, cy: 0, radius: 5 };
  assert.deepEqual(nearestIntersection(point(3, -5), [a, b], 10), { x: 3, y: -4, type: "intersection" });
  assert.deepEqual(nearestIntersection(point(3, 5), [a, b], 10), { x: 3, y: 4, type: "intersection" });
  assert.equal(nearestIntersection(point(5), [a, a], 1), null);
  const tangent = { ...b, cx: 10 };
  assert.deepEqual(nearestIntersection(point(5), [a, tangent], 0.001), { x: 5, y: 0, type: "intersection" });
});

test("ignores parallel boundaries in either direction and still finds crossings with other shapes", () => {
  const parallel = [segment(0, 0, 100, 0), segment(100, 10, 0, 10)];
  assert.equal(nearestIntersection(point(50, 5), parallel, 10), null);
  assert.deepEqual(nearestIntersection(point(50), [...parallel, segment(50, -1, 50, 1)], 10),
    { x: 50, y: 0, type: "intersection" });
  assert.deepEqual(nearestIntersection(point(50), [horizontal, horizontal, boundary(50)], 0),
    { x: 50, y: 0, type: "intersection" });
});

test("collects distinct nearby crossing and perpendicular alternatives in distance order", () => {
  const lines = [horizontal, boundary(35), boundary(42), boundary(43), boundary(42)];
  const type = "intersection";
  assert.deepEqual(nearbyIntersections(point(41), lines, 7, 2), [
    { x: 42, y: 0, type }, { x: 43, y: 0, type },
  ]);
  assert.deepEqual(nearbyIntersections(point(41), lines, 1), [{ x: 42, y: 0, type }]);
  assert.deepEqual(nearbyBoundaryPoints(point(39, 10), lines, 4), [
    { x: 42, y: 10, type: "nearest" }, { x: 35, y: 10, type: "nearest" }, { x: 43, y: 10, type: "nearest" },
  ]);
  assert.deepEqual(nearbyPerpendiculars(point(41, 10), point(30, 10), lines, 3), [
    { x: 42, y: 10, type: "perpendicular" }, { x: 43, y: 10, type: "perpendicular" },
  ]);
});

test("snaps to radial perpendiculars and to the closest point of a trimmed arc", () => {
  const circle = { type: "circle", cx: 0, cy: 0, radius: 10 };
  const rightArc = { type: "arc", start: point(0, -10), through: point(10), end: point(0, 10) };
  const foot = nearestPerpendicular(point(6, 6), point(20, 20), [circle], 5);
  assert.ok(Math.abs(foot.x - 10 / Math.sqrt(2)) < 1e-9);
  assert.ok(Math.abs(foot.x - foot.y) < 1e-9);
  assert.equal(foot.type, "perpendicular");
  assert.equal(nearestPerpendicular(point(-10), point(15), [rightArc], 2), null);
  assert.deepEqual(nearestBoundaryPoint(point(-8, -6), [rightArc], 15), { x: 0, y: -10, type: "nearest" });
  assert.deepEqual(nearestBoundaryPoint(point(20), [rightArc], 15), { x: 10, y: 0, type: "nearest" });
  assert.deepEqual(nearestPerpendicular(point(7, 10), point(6, 2), [segment(0, 10, 20, 10)], 5), { x: 6, y: 10, type: "perpendicular" });
});
