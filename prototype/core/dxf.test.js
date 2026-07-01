import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDxf, buildRevitDxf, dxfLine, dxfCircle, roundDxf } from "./dxf.js";

const countRecords = (dxf, type) => (dxf.match(new RegExp(`\\n0\\n${type}\\n`, "g")) || []).length;

test("roundDxf rounds to 3 decimals and normalizes -0", () => {
  assert.equal(roundDxf(1.23456), "1.235");
  assert.equal(roundDxf(-0), "0");
  assert.equal(roundDxf(200), "200");
});

test("dxfLine flips Y and tags the layer", () => {
  assert.deepEqual(
    dxfLine(0, 0, 100, 200, "walls"),
    ["0", "LINE", "8", "walls", "10", "0", "20", "0", "30", "0", "11", "100", "21", "-200", "31", "0"],
  );
});

test("dxfCircle flips center Y and uses absolute radius", () => {
  assert.deepEqual(
    dxfCircle(10, 20, -50, "measure"),
    ["0", "CIRCLE", "8", "measure", "10", "10", "20", "-20", "30", "0", "40", "50"],
  );
});

test("buildDxf wraps a valid section/EOF envelope", () => {
  const dxf = buildDxf([]);
  assert.ok(dxf.startsWith("0\nSECTION\n2\nHEADER"));
  assert.ok(dxf.includes("\n9\n$ACADVER\n1\nAC1009\n"));
  assert.ok(dxf.includes("\n9\n$INSUNITS\n70\n4\n"));
  assert.ok(dxf.includes("\n0\nLTYPE\n2\nCONTINUOUS\n"));
  assert.ok(dxf.includes("\n2\nENTITIES\n"));
  assert.ok(dxf.endsWith("0\nENDSEC\n0\nEOF\n"));
});

test("buildDxf emits one LINE per line entity", () => {
  const dxf = buildDxf([{ type: "line", x1: 0, y1: 0, x2: 1000, y2: 0, layer: "measure" }]);
  assert.equal(countRecords(dxf, "LINE"), 1);
});

test("buildDxf expands a wall into 3 lines (two faces + centerline)", () => {
  const dxf = buildDxf([{ type: "wall", x1: 0, y1: 0, x2: 1000, y2: 0, width: 180 }]);
  assert.equal(countRecords(dxf, "LINE"), 3);
});

test("buildDxf expands a block into 4 footprint edges", () => {
  const dxf = buildDxf([{ type: "block", kind: "table", x: 0, y: 0, rotation: 0, width: 1000, height: 600 }]);
  assert.equal(countRecords(dxf, "LINE"), 4);
});

test("buildDxf exports a circle entity", () => {
  const dxf = buildDxf([{ type: "circle", cx: 100, cy: 200, radius: 500, layer: "measure" }]);
  assert.equal(countRecords(dxf, "CIRCLE"), 1);
});

test("buildDxf exports a rectangle as 4 lines", () => {
  const dxf = buildDxf([{ type: "rectangle", x1: 0, y1: 0, x2: 1000, y2: 600, layer: "measure" }]);
  assert.equal(countRecords(dxf, "LINE"), 4);
});

test("buildDxf exports a non-collinear arc", () => {
  const dxf = buildDxf([{ type: "arc", start: { x: 100, y: 0 }, through: { x: 0, y: 100 }, end: { x: -100, y: 0 }, layer: "measure" }]);
  assert.equal(countRecords(dxf, "ARC"), 1);
});

test("buildDxf skips a degenerate (collinear) arc instead of emitting garbage", () => {
  const dxf = buildDxf([{ type: "arc", start: { x: 0, y: 0 }, through: { x: 50, y: 0 }, end: { x: 100, y: 0 }, layer: "measure" }]);
  assert.equal(countRecords(dxf, "ARC"), 0);
});

test("buildRevitDxf uses Revit-friendly millimeter layers", () => {
  const dxf = buildRevitDxf([
    { type: "wall", x1: 0, y1: 0, x2: 1000, y2: 0, width: 180 },
    { type: "line", x1: 0, y1: 0, x2: 0, y2: 500, layer: "dimensions" },
  ]);
  assert.ok(dxf.includes("\n9\n$INSUNITS\n70\n4\n"));
  assert.ok(dxf.includes("\n2\nZAMER_WALLS\n"));
  assert.ok(dxf.includes("\n2\nZAMER_DIMENSIONS\n"));
  assert.ok(dxf.includes("\n8\nZAMER_WALLS\n"));
  assert.ok(dxf.includes("\n8\nZAMER_DIMENSIONS\n"));
});
