import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDxf, buildRevitDxf, dxfLine, dxfCircle, dxfLinearDimension, dxfString, roundDxf } from "./dxf.js";

const countRecords = (dxf, type) => (dxf.match(new RegExp(`\\n0\\n${type}\\n`, "g")) || []).length;

test("roundDxf rounds to 3 decimals and normalizes -0", () => {
  assert.equal(roundDxf(1.23456), "1.235");
  assert.equal(roundDxf(-0), "0");
  assert.equal(roundDxf(200), "200");
});

test("dxfString keeps R12 text ASCII-safe and preserves Cyrillic as Unicode escapes", () => {
  assert.equal(dxfString("Замер 1"), "\\U+0417\\U+0430\\U+043C\\U+0435\\U+0440 1");
  assert.equal(dxfString("Первая\nстрока"), "\\U+041F\\U+0435\\U+0440\\U+0432\\U+0430\\U+044F \\U+0441\\U+0442\\U+0440\\U+043E\\U+043A\\U+0430");
  assert.equal(dxfString("📐"), "\\U+0001F4D0");
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

test("both Zamer DXF profiles preserve tiny line geometry and do not emit Infinity or corrupt endpoints", () => {
  const line = { type: "line", x1: 0, y1: 0, x2: 0.0004, y2: 0, layer: "measure" };
  for (const build of [buildDxf, buildRevitDxf]) {
    const dxf = build([line, { ...line, x2: 1e307 }, { ...line, x2: null }, { ...line, x2: 0 }]);
    assert.equal(countRecords(dxf, "LINE"), 2);
    assert.ok(dxf.includes("\n11\n0.0004\n"));
    assert.ok(dxf.includes("\n11\n1e+307\n"));
    assert.ok(!dxf.includes("Infinity"));
  }
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

test("Zamer DXF preserves a sub-millimeter fillet arc radius and its angular span", () => {
  const radius = 0.00025;
  const entity = {
    type: "arc", layer: "measure",
    start: { x: radius, y: 0 },
    through: { x: radius - radius / Math.sqrt(2), y: radius - radius / Math.sqrt(2) },
    end: { x: 0, y: radius },
  };
  const dxf = buildDxf([entity]);
  assert.equal(countRecords(dxf, "ARC"), 1);
  const parsedRadius = Number(dxf.match(/\n0\nARC\n[\s\S]*?\n40\n([^\n]+)/)?.[1]);
  assert.ok(Math.abs(parsedRadius - radius) < 1e-12);
});

test("buildDxf exports text annotations", () => {
  const dxf = buildDxf([{ type: "text", x: 120, y: 340, text: "Спальня", height: 260, rotation: 15, layer: "dimensions" }]);
  assert.equal(countRecords(dxf, "TEXT"), 1);
  assert.ok(dxf.includes(`\n1\n${dxfString("Спальня")}\n`));
  assert.ok(dxf.includes("\n40\n260\n"));
});

test("linear dimensions export as extension lines, arrows, dimension line and text", () => {
  const records = dxfLinearDimension({
    type: "line",
    layer: "dimensions",
    x1: 0,
    y1: 0,
    x2: 2400,
    y2: 0,
    dimX1: 0,
    dimY1: -360,
    dimX2: 2400,
    dimY2: -360,
  }, "dimensions").join("\n");
  assert.equal((records.match(/(^|\n)0\nLINE\n/g) || []).length, 7);
  assert.equal((records.match(/(^|\n)0\nTEXT\n/g) || []).length, 1);
  assert.ok(records.includes("\n1\n2400\n"));
  assert.ok(!records.includes("NaN"));
});

test("angular dimensions are safely omitted until supported", () => {
  const dxf = buildDxf([{ type: "line", layer: "dimensions", dimensionKind: "angular", vertex: { x: 0, y: 0 } }]);
  assert.equal(countRecords(dxf, "LINE"), 0);
  assert.ok(!dxf.includes("NaN"));
  assert.ok(!dxf.includes("undefined"));
});

test("leader exports a line, arrow and visible text", () => {
  const dxf = buildDxf([{ type: "line", layer: "dimensions", dimensionKind: "leader", x1: 0, y1: 0, x2: 900, y2: 600, text: "Розетка" }]);
  assert.equal(countRecords(dxf, "LINE"), 3);
  assert.equal(countRecords(dxf, "TEXT"), 1);
  assert.ok(dxf.includes(`\n1\n${dxfString("Розетка")}\n`));
  assert.ok(!dxf.includes("NaN"));
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
