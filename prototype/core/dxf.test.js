import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDxf, buildRevitDxf, dxfLine, dxfCircle, dxfLinearDimension, dxfString, roundDxf, writeDxf } from "./dxf.js";

const countRecords = (dxf, type) => (dxf.match(new RegExp(`\\n0\\n${type}\\n`, "g")) || []).length;

function dimensionRecords(dxf) {
  const lines = dxf.split("\n");
  const dimensions = [];
  let current;
  for (let index = 0; index < lines.length - 1; index += 2) {
    const code = lines[index];
    const value = lines[index + 1];
    if (code === "0") {
      current = value === "DIMENSION" ? { fields: new Map(), subclasses: [] } : null;
      if (current) dimensions.push(current);
    } else if (current && code === "100") {
      current.subclasses.push(value);
    } else if (current) {
      current.fields.set(code, value);
    }
  }
  return dimensions;
}

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

test("buildDxf emits a 2007 drawing with millimeter units and model-space ownership", () => {
  const dxf = buildDxf([]);
  assert.ok(dxf.startsWith("0\nSECTION\n2\nHEADER"));
  assert.ok(dxf.includes("\n9\n$ACADVER\n1\nAC1021\n"));
  assert.ok(dxf.includes("\n9\n$INSUNITS\n70\n4\n"));
  assert.ok(dxf.includes("\n100\nAcDbLinetypeTableRecord\n2\nContinuous\n"));
  assert.ok(dxf.includes("\n100\nAcDbBlockTableRecord\n2\n*Model_Space\n"));
  assert.ok(dxf.includes("\n100\nAcDbLayout\n1\nModel\n"));
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

test("modern text annotations preserve Cyrillic and remove DXF-breaking controls", () => {
  const entity = { type: "text", x: 120, y: 340, text: "Спальня\r\n№1", height: 260, rotation: 15, layer: "dimensions" };
  for (const build of [buildDxf, buildRevitDxf]) {
    const dxf = build([entity]);
    assert.equal(countRecords(dxf, "TEXT"), 1);
    assert.ok(dxf.includes("\n1\nСпальня №1\n"));
    assert.ok(dxf.includes("\n40\n260\n"));
  }
  assert.match(writeDxf([entity]), /\n9\n\$ACADVER\n1\nAC1009\n/);
  assert.ok(writeDxf([entity]).includes(`\n1\n${dxfString(entity.text)}\n`));
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

test("both profiles retain projected and aligned dimensions and their rendered values", () => {
  const legacyProjected = {
    type: "line", layer: "dimensions", x1: 0, y1: 0, x2: 3000, y2: 4000,
    dimX1: 0, dimY1: -360, dimX2: 3000, dimY2: -360,
  };
  const aligned = { ...legacyProjected, measurementType: "aligned", offset: 360 };
  const vertical = { ...legacyProjected, measurementType: "linear", measurementAxis: "y", offset: 360 };
  for (const build of [buildDxf, buildRevitDxf]) {
    const dxf = build([legacyProjected, aligned, vertical]);
    const dimensions = dimensionRecords(dxf);
    assert.equal(dimensions.length, 3);
    assert.equal(countRecords(dxf, "TEXT"), 3);
    for (const [index, type, length, rotation] of [[0, "32", 3000, 0], [1, "33", 5000, -53.130102354], [2, "32", 4000, -90]]) {
      const { fields, subclasses } = dimensions[index];
      assert.equal(fields.get("70"), type);
      assert.equal(Number(fields.get("42")), length);
      assert.equal(fields.get("1"), "<> мм");
      assert.ok(Math.abs(Number(fields.get("50")) - rotation) < 1e-8);
      assert.ok(subclasses.includes("AcDbAlignedDimension"));
      assert.equal(subclasses.includes("AcDbRotatedDimension"), type === "32");
    }
    for (const label of ["3000 мм", "5000 мм", "4000 мм"]) assert.ok(dxf.includes(`\n1\n${label}\n`));
  }
});

test("both profiles export native three-point dimensions with visible angle geometry and degrees", () => {
  const angle = {
    type: "line", layer: "dimensions", dimensionKind: "angular",
    vertex: { x: 0, y: 0 }, arm1: { x: 1000, y: 0 }, arm2: { x: 1000, y: 1000 },
  };
  for (const build of [buildDxf, buildRevitDxf]) {
    const dxf = build([angle]);
    const dimensions = dimensionRecords(dxf);
    assert.equal(dimensions.length, 1);
    const [{ fields, subclasses }] = dimensions;
    assert.equal(countRecords(dxf, "ARC"), 1);
    assert.equal(countRecords(dxf, "TEXT"), 1);
    assert.ok(dxf.includes("\n1\n45°\n"));
    assert.equal(fields.get("70"), "37");
    assert.ok(Math.abs(Number(fields.get("42")) - Math.PI / 4) < 1e-8);
    assert.equal(fields.get("1"), "<>°");
    assert.ok(subclasses.includes("AcDb3PointAngularDimension"));
    assert.match(dxf, /\n100\nAcDbArc\n50\n315\n51\n0\n/);
  }
});

test("incomplete angular dimensions are safely omitted", () => {
  const dxf = buildDxf([{ type: "line", layer: "dimensions", dimensionKind: "angular", vertex: { x: 0, y: 0 } }]);
  assert.equal(countRecords(dxf, "LINE"), 0);
  assert.equal(countRecords(dxf, "DIMENSION"), 0);
  assert.ok(!dxf.includes("NaN"));
  assert.ok(!dxf.includes("undefined"));
});

test("leader exports a line, arrow and visible text", () => {
  const dxf = buildDxf([{ type: "line", layer: "dimensions", dimensionKind: "leader", x1: 0, y1: 0, x2: 900, y2: 600, text: "Розетка" }]);
  assert.equal(countRecords(dxf, "LINE"), 3);
  assert.equal(countRecords(dxf, "TEXT"), 1);
  assert.ok(dxf.includes("\n1\nРозетка\n"));
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
