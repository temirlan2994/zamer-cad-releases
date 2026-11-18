import test from "node:test";
import assert from "node:assert/strict";
import { angularDimensionGeometry, dimensionGeometry, formatDimensionLength } from "./dimensions.js";

const points = { x1: 600, y1: 1500, x2: 1800, y2: 2400 };

test("projected and aligned dimensions measure different aspects of the same points", () => {
  const horizontal = dimensionGeometry({ ...points, measurementType: "linear", measurementAxis: "x", offset: 1600 });
  const vertical = dimensionGeometry({ ...points, measurementType: "linear", measurementAxis: "y", offset: -600 });
  const aligned = dimensionGeometry({ ...points, measurementType: "aligned", offset: 1600 });
  assert.equal(formatDimensionLength(horizontal), "1200");
  assert.equal(formatDimensionLength(vertical), "900");
  assert.equal(formatDimensionLength(aligned), "1500");
  assert.deepEqual(horizontal.lineStart, { x: 600, y: 3100 });
  assert.deepEqual(horizontal.lineEnd, { x: 1800, y: 3100 });
  assert.deepEqual(vertical.lineStart, { x: 1200, y: 1500 });
  assert.deepEqual(vertical.lineEnd, { x: 1200, y: 2400 });
});

test("the signed offset retains its side when a fixed-axis measurement reverses", () => {
  const geometry = dimensionGeometry({
    x1: 1200, y1: 0, x2: 0, y2: 900, measurementType: "linear", measurementAxis: "x", offset: -300,
  });
  assert.deepEqual(geometry.lineStart, { x: 1200, y: -300 });
  assert.deepEqual(geometry.lineEnd, { x: 0, y: -300 });
  assert.equal(geometry.measurement, 1200);
});

test("aligned anchors follow a rotated reference and reconstruct on undo", () => {
  const entity = { x1: 1200, y1: 2450, x2: 2400, y2: 2450, measurementType: "aligned", offset: 500 };
  const before = dimensionGeometry(entity);
  const rotated = dimensionGeometry({ ...entity, x2: 1200, y2: 1250, dimX1: 1200, dimY1: 2950, dimX2: 1200, dimY2: 2950 });
  assert.equal(before.measurement, 1200);
  assert.equal(rotated.measurement, 1200);
  assert.deepEqual(rotated.lineStart, { x: 1700, y: 2450 });
  assert.deepEqual(rotated.lineEnd, { x: 1700, y: 1250 });
  assert.deepEqual(dimensionGeometry({ ...entity, dimX1: 1700, dimY1: 2450, dimX2: 1700, dimY2: 1250 }), before);
});

test("legacy dimension anchors preserve their appearance and identify an existing projected axis", () => {
  const geometry = dimensionGeometry({ ...points, dimX1: 600, dimY1: 3100, dimX2: 1800, dimY2: 3100 });
  assert.equal(geometry.measurementAxis, "x");
  assert.equal(geometry.mode, "linear");
  assert.equal(geometry.measurement, 1200);
  assert.equal(geometry.offset, 1600);
  const old = dimensionGeometry({ ...points, dimX1: 120, dimY1: 600, dimX2: 420, dimY2: 1000 });
  assert.equal(old.mode, "legacy");
  assert.equal(old.measurement, 500);
  assert.deepEqual(old.lineEnd, { x: 420, y: 1000 });
});

test("collapsed legacy aligned anchors can be reconstructed from measured points", () => {
  const legacy = dimensionGeometry({
    x1: 1200, y1: 2450, x2: 2400, y2: 2450, dimX1: 1200, dimY1: 2950, dimX2: 1200, dimY2: 2950,
  });
  assert.deepEqual(legacy.lineEnd, { x: 2400, y: 2950 });
  assert.equal(legacy.measurement, 1200);
});

test("angular dimensions reject missing or coincident rays and use the shorter signed span", () => {
  const vertex = { x: 0, y: 0 };
  const arm1 = { x: -5, y: 0 };
  const arm2 = { x: 0, y: 5 };
  assert.equal(angularDimensionGeometry({ vertex, arm1: vertex, arm2 }), null);
  assert.equal(angularDimensionGeometry({ vertex, arm1 }), null);
  const geometry = angularDimensionGeometry({ vertex, arm1, arm2 });
  assert.equal(geometry.measurement, 90);
  assert.equal(geometry.sweep, -Math.PI / 2);
});
