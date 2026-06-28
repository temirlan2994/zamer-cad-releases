import { test } from "node:test";
import assert from "node:assert/strict";
import {
  radToDeg,
  degToRad,
  normalizeDegrees,
  normalizeAnglePositive,
  offsetWall,
  transformBlockPoint,
  distanceWorld,
  angleBetweenPoints,
  arcGeometry,
  segmentMetrics,
  entityBounds,
  pointInSelectionRect,
  segmentsIntersect,
  pointInPolygon,
  pointToSegmentDistance,
} from "./geometry.js";
import { defaultBlockSize, entitySize, blockSegments } from "./blocks.js";

test("radToDeg / degToRad round-trip", () => {
  assert.equal(radToDeg(Math.PI), 180);
  assert.ok(Math.abs(degToRad(180) - Math.PI) < 1e-12);
  assert.ok(Math.abs(radToDeg(degToRad(57)) - 57) < 1e-12);
});

test("normalizeDegrees wraps into [0, 360)", () => {
  assert.equal(normalizeDegrees(-90), 270);
  assert.equal(normalizeDegrees(450), 90);
  assert.equal(normalizeDegrees(0), 0);
  assert.equal(normalizeDegrees(360), 0);
});

test("normalizeAnglePositive wraps into [0, 2pi)", () => {
  assert.ok(Math.abs(normalizeAnglePositive(-Math.PI / 2) - (3 * Math.PI) / 2) < 1e-12);
  assert.ok(Math.abs(normalizeAnglePositive(Math.PI * 2) - 0) < 1e-12);
});

test("offsetWall produces symmetric parallel edges", () => {
  const wall = { x1: 0, y1: 0, x2: 100, y2: 0 };
  const { a, b } = offsetWall(wall, 10);
  assert.equal(a.y1, 10);
  assert.equal(a.y2, 10);
  assert.equal(b.y1, -10);
  assert.equal(b.y2, -10);
});

test("offsetWall tolerates zero-length wall without NaN", () => {
  const { a } = offsetWall({ x1: 5, y1: 5, x2: 5, y2: 5 }, 10);
  assert.ok(Number.isFinite(a.x1) && Number.isFinite(a.y1));
});

test("transformBlockPoint rotates 90deg correctly", () => {
  const p = transformBlockPoint({ x: 0, y: 0, rotation: 90 }, 10, 0);
  assert.ok(Math.abs(p.x - 0) < 1e-9);
  assert.ok(Math.abs(p.y - 10) < 1e-9);
});

test("defaultBlockSize known + fallback", () => {
  assert.deepEqual(defaultBlockSize("sofa"), { width: 2200, height: 950 });
  assert.deepEqual(defaultBlockSize("__unknown__"), { width: 900, height: 900 });
});

test("entitySize prefers explicit dimensions", () => {
  assert.deepEqual(entitySize({ kind: "sofa", width: 1000, height: 500 }), { width: 1000, height: 500 });
  assert.deepEqual(entitySize({ kind: "sofa" }), { width: 2200, height: 950 });
});

test("blockSegments returns a closed 4-edge footprint", () => {
  const segs = blockSegments({ x: 0, y: 0, rotation: 0, kind: "table", width: 1000, height: 600 });
  assert.equal(segs.length, 4);
  // Last edge ends where the first edge starts (closed loop).
  assert.equal(segs[3].x2, segs[0].x1);
  assert.equal(segs[3].y2, segs[0].y1);
});

test("distanceWorld is Euclidean", () => {
  assert.equal(distanceWorld({ x: 0, y: 0 }, { x: 3, y: 4 }), 5);
});

test("angleBetweenPoints returns the direction in radians", () => {
  assert.ok(Math.abs(angleBetweenPoints({ x: 0, y: 0 }, { x: 0, y: 10 }) - Math.PI / 2) < 1e-12);
  assert.equal(angleBetweenPoints({ x: 0, y: 0 }, { x: 5, y: 0 }), 0);
});

test("arcGeometry finds the circumscribed circle of 3 points", () => {
  const arc = arcGeometry({ x: 100, y: 0 }, { x: 0, y: 100 }, { x: -100, y: 0 });
  assert.ok(Math.abs(arc.center.x) < 1e-9);
  assert.ok(Math.abs(arc.center.y) < 1e-9);
  assert.ok(Math.abs(arc.radius - 100) < 1e-9);
});

test("arcGeometry returns null for collinear points", () => {
  assert.equal(arcGeometry({ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 100, y: 0 }), null);
});

test("segmentMetrics reports rounded length and 0..359 angle", () => {
  assert.deepEqual(segmentMetrics(0, 0, 3000, 0), { length: 3000, angle: 0 });
  assert.deepEqual(segmentMetrics(0, 0, 0, 1000), { length: 1000, angle: 90 });
  assert.deepEqual(segmentMetrics(0, 0, -1000, 0), { length: 1000, angle: 180 });
  assert.equal(segmentMetrics(0, 0, 1000, -1000).angle, 315);
});

test("entityBounds covers each entity type", () => {
  assert.deepEqual(entityBounds({ type: "circle", cx: 0, cy: 0, radius: 50 }), { minX: -50, maxX: 50, minY: -50, maxY: 50 });
  assert.deepEqual(entityBounds({ type: "line", x1: 10, y1: 80, x2: 90, y2: 20 }), { minX: 10, maxX: 90, minY: 20, maxY: 80 });
  const arcB = entityBounds({ type: "arc", start: { x: 100, y: 0 }, through: { x: 0, y: 100 }, end: { x: -100, y: 0 } });
  assert.equal(arcB.minX, -100);
  assert.equal(arcB.maxY, 100);
});

test("pointInSelectionRect is inclusive of edges", () => {
  const rect = { minX: 0, maxX: 10, minY: 0, maxY: 10 };
  assert.equal(pointInSelectionRect({ x: 5, y: 5 }, rect), true);
  assert.equal(pointInSelectionRect({ x: 0, y: 10 }, rect), true);
  assert.equal(pointInSelectionRect({ x: 11, y: 5 }, rect), false);
});

test("segmentsIntersect detects crossing, parallel and collinear-overlap", () => {
  assert.equal(segmentsIntersect({ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }, { x: 10, y: 0 }), true);
  assert.equal(segmentsIntersect({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 5 }, { x: 10, y: 5 }), false);
  assert.equal(segmentsIntersect({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 0 }, { x: 15, y: 0 }), true);
});

test("pointInPolygon classifies inside vs outside", () => {
  const square = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
  assert.equal(pointInPolygon({ x: 5, y: 5 }, square), true);
  assert.equal(pointInPolygon({ x: 15, y: 5 }, square), false);
});

test("pointToSegmentDistance clamps to endpoints", () => {
  assert.equal(pointToSegmentDistance({ x: 5, y: 3 }, { x: 0, y: 0 }, { x: 10, y: 0 }), 3);
  assert.equal(pointToSegmentDistance({ x: -4, y: 0 }, { x: 0, y: 0 }, { x: 10, y: 0 }), 4);
});
