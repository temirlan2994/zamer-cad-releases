import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDxf, buildRevitDxf, dxfLine, dxfCircle, dxfLinearDimension, dxfString, roundDxf, writeDxf } from "./dxf.js";

const countRecords = (dxf, type) => (dxf.match(new RegExp(`\\n0\\n${type}\\n`, "g")) || []).length;

function entityRecords(dxf) {
  const lines = dxf.split("\n");
  const entities = [];
  let current;
  let section;
  for (let index = 0; index < lines.length - 1; index += 2) {
    const [code, value] = [lines[index], lines[index + 1]];
    if (code === "0" && value === "SECTION") {
      section = lines[index + 3];
      continue;
    }
    if (code === "0" && value === "ENDSEC") section = null;
    if (section !== "ENTITIES") continue;
    if (code === "0") {
      current = { type: value, fields: new Map() };
      entities.push(current);
    } else if (current) {
      const values = current.fields.get(code) ?? [];
      values.push(value);
      current.fields.set(code, values);
    }
  }
  return entities;
}

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

test("native polyline bulges follow their outgoing edge and reflect the DXF Y axis", () => {
  const points = [{ x: 0, y: 0 }, { x: 2000, y: 0 }, { x: 2000, y: 1500 }];
  const open = { type: "polyline", layer: "measure", points, closed: false, bulges: [1, 0] };
  const closed = { ...open, closed: true, bulges: [0, -0.1250000001, 1.5] };
  for (const build of [buildDxf, buildRevitDxf]) {
    const dxf = build([open, closed]);
    const [first, second] = entityRecords(dxf);
    assert.equal(first.type, "LWPOLYLINE");
    assert.equal(second.type, "LWPOLYLINE");
    assert.deepEqual(first.fields.get("42"), ["-1"]);
    assert.deepEqual(second.fields.get("42"), ["0.1250000001", "-1.5"]);
    assert.match(dxf, /\n10\n0\n20\n0\n42\n-1\n10\n2000\n20\n0\n10\n2000\n20\n-1500\n/);
    assert.match(dxf, /\n10\n2000\n20\n0\n42\n0\.1250000001\n10\n2000\n20\n-1500\n42\n-1\.5\n/);
  }
  assert.equal(writeDxf([open, closed]), writeDxf([{ ...open, bulges: undefined }, { ...closed, bulges: undefined }]));
});

test("modern rotated text keeps Cyrillic, line breaks and its text layer", () => {
  const entity = { type: "text", x: 120, y: 340, text: "Спальня\r\n№1", height: 260, rotation: 90, layer: "text" };
  for (const build of [buildDxf, buildRevitDxf]) {
    const dxf = build([entity]);
    const texts = entityRecords(dxf).filter(({ type }) => type === "TEXT");
    const field = (code) => texts.map(({ fields }) => fields.get(code)?.[0]);
    assert.deepEqual(field("1"), ["Спальня", "№1"]);
    assert.deepEqual(field("8"), Array(2).fill(build === buildDxf ? "text" : "ZAMER_TEXT"));
    assert.deepEqual(field("10"), ["120", "-244"]);
    assert.deepEqual(field("20"), ["-340", "-340"]);
    assert.deepEqual(field("40"), ["260", "260"]);
    assert.deepEqual(field("50"), ["270", "270"]);
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

test("the three leader styles and multiline labels export on the text layer", () => {
  const lines = ["Вывод воды", "Холодная"].join("\n");
  const leader = { type: "line", dimensionKind: "leader", x1: 0, y1: 0, x2: 3000, y2: 1500, text: lines, textHeight: 100 };
  for (const build of [buildDxf, buildRevitDxf]) {
    const layer = build === buildDxf ? "text" : "ZAMER_TEXT";
    for (const [leaderStyle, expectedSegments, expectedFrames] of [["landing", 4, 0], ["plain", 3, 0], ["boxed", 3, 1]]) {
      const records = entityRecords(build([{ ...leader, layer: "dimensions", leaderStyle }]));
      assert.ok(records.every(({ fields }) => fields.get("8")[0] === layer));
      assert.equal(records.filter(({ type }) => type === "LINE").length, expectedSegments);
      assert.equal(records.filter(({ type }) => type === "LWPOLYLINE").length, expectedFrames);
      const texts = records.filter(({ type }) => type === "TEXT");
      assert.deepEqual(texts.map(({ fields }) => fields.get("1")[0]), lines.split("\n"));
      assert.ok(texts.every(({ fields }) => fields.get("40")[0] === "100"));
    }
  }
});

test("leader line shape and text frame export as independent switches", () => {
  const leader = { type: "line", dimensionKind: "leader", layer: "text", leaderStyle: "landing",
    x1: 0, y1: 0, x2: 3000, y2: 1500, text: "Точка", textHeight: 100 };
  for (const build of [buildDxf, buildRevitDxf]) {
    for (const [leaderLine, expectedSegments] of [["straight", 3], ["bent", 4]]) {
      for (const leaderFrame of [false, true]) {
        const records = entityRecords(build([{ ...leader, leaderLine, leaderFrame }]));
        assert.equal(records.filter(({ type }) => type === "LINE").length, expectedSegments);
        assert.equal(records.filter(({ type }) => type === "LWPOLYLINE").length, Number(leaderFrame));
        assert.equal(records.find(({ type }) => type === "TEXT").fields.get("1")[0], "Точка");
      }
    }
  }
});

test("zones export closed editable XY contours and native labels on separate colored layers", () => {
  const points = [{ x: 125.0002, y: -300 }, { x: 4125.0002, y: -300 }, { x: 4125.0002, y: 1700 }, { x: 125.0002, y: 1700 }];
  const zone = { type: "area", id: "floor", layer: "areas", points: [...points, points[0]], label: "Зона кухни" };
  const beam = { ...zone, type: "elevation", id: "beam", layer: "elevations", height: -150, zoneStyle: "beam", label: "" };
  const crossing = { ...zone, id: "broken", points: [points[0], points[2], points[1], points[3]] };
  for (const build of [buildDxf, buildRevitDxf]) {
    const areaLayer = build === buildDxf ? "areas" : "ZAMER_AREA";
    const zLayer = build === buildDxf ? "elevations" : "ZAMER_Z";
    const records = entityRecords(build([zone, beam, crossing]));
    const area = records.filter(({ fields }) => fields.get("8")[0] === areaLayer);
    const elevation = records.filter(({ fields }) => fields.get("8")[0] === zLayer);
    assert.equal(area.length, 3);
    assert.equal(elevation.length, 2);
    for (const [contour] of [area, elevation]) {
      assert.equal(contour.type, "LWPOLYLINE");
      assert.deepEqual(contour.fields.get("70"), ["1"]);
      assert.deepEqual(contour.fields.get("90"), ["4"]);
      assert.deepEqual(contour.fields.get("10"), ["125.0002", "4125.0002", "4125.0002", "125.0002"]);
      assert.deepEqual(contour.fields.get("20"), ["300", "300", "-1700", "-1700"]);
      assert.equal(Number(contour.fields.get("38")?.[0] ?? 0), 0);
    }
    assert.deepEqual(area.slice(1).map(({ fields }) => fields.get("1")[0]), ["8 м²", "Зона кухни"]);
    assert.deepEqual(elevation[1].fields.get("1"), ["Z -150 мм"]);
    assert.equal(Number(elevation[1].fields.get("30")[0]), 0);
    for (const { fields } of elevation) assert.equal(Number(fields.get("420")[0]), 0x9a5b17);
    const custom = entityRecords(build([{ ...beam, label: "Под балкой" }])).filter(({ type }) => type === "TEXT");
    assert.deepEqual(custom.map(({ fields }) => fields.get("1")[0]), ["Z -150 мм", "Под балкой"]);
  }
});

test("combined area and Z export all independent outlines, one label each, and project precision", () => {
  const first = [{ x: 0, y: 0 }, { x: 2000, y: 0 }, { x: 2000, y: 1000 }, { x: 0, y: 1000 }];
  const second = [{ x: 4500, y: 300 }, { x: 5734, y: 300 }, { x: 5734, y: 1300 }, { x: 4500, y: 1300 }];
  const zone = { type: "area", id: "combined", points: first, contours: [first, second] };
  const elevation = { ...zone, type: "elevation", id: "combined-z", height: -2450, zoneStyle: "drop" };
  const measurementSettings = { unit: "m", precision: 3, areaPrecision: 3 };
  for (const [build, areaLayer, zLayer] of [[buildDxf, "areas", "elevations"], [buildRevitDxf, "ZAMER_AREA", "ZAMER_Z"]]) {
    const entities = entityRecords(build([zone, elevation], { measurementSettings }));
    for (const [layer, label] of [[areaLayer, "3,234 м²"], [zLayer, "Z -2,45 м"]]) {
      const records = entities.filter(({ fields }) => fields.get("8")[0] === layer);
      assert.deepEqual(records.map(({ type }) => type), ["LWPOLYLINE", "LWPOLYLINE", "TEXT"]);
      assert.deepEqual(records.slice(0, 2).map(({ fields }) => fields.get("70")[0]), ["1", "1"]);
      assert.deepEqual(records[1].fields.get("10"), ["4500", "5734", "5734", "4500"]);
      assert.deepEqual(records[2].fields.get("1"), [label]);
    }
  }
});

test("native dimension geometry stays in mm, using project length and angle precision for labels", () => {
  const radians = 32.46 * Math.PI / 180;
  const entities = [
    { type: "line", layer: "dimensions", x1: 0, y1: 0, x2: 1234, y2: 0, offset: 200 },
    { type: "line", layer: "dimensions", dimensionKind: "angular", vertex: { x: 0, y: 0 },
      arm1: { x: 1000, y: 0 }, arm2: { x: 1000 * Math.cos(radians), y: 1000 * Math.sin(radians) } },
  ];
  for (const build of [buildDxf, buildRevitDxf]) {
    const dxf = build(entities, { measurementSettings: { unit: "m", precision: 3, anglePrecision: 1 } });
    const dimensions = dimensionRecords(dxf);
    assert.equal(dimensions[0].fields.get("42"), "1234");
    assert.equal(dimensions[0].fields.get("1"), "<> м");
    assert.equal(dimensions[1].fields.get("1"), "<>°");
    assert.match(dxf, /\n1\n1,234 м\n/);
    assert.match(dxf, /\n1\n32,5°\n/);
    assert.match(dxf, /\n\$INSUNITS\n70\n4\n/);
    assert.match(dxf, /\n144\n0\.001\n179\n1\n271\n3\n/);
  }
});

test("CAD annotation scale changes automatic label height and preserves entered text height", () => {
  const fixture = [{ type: "line", layer: "dimensions", x1: 0, y1: 0, x2: 2400, y2: 0, offset: 320 },
    { type: "elevation", id: "ceiling", height: 2700, zoneStyle: "ceiling",
      points: [{ x: 0, y: 0 }, { x: 6500, y: 0 }, { x: 6500, y: 4800 }, { x: 0, y: 4800 }] },
    { type: "text", layer: "text", x: 100, y: 100, text: "Замер", height: 200 }];
  for (const build of [buildDxf, buildRevitDxf]) {
    const small = build(fixture, { annotationScale: 0.85 });
    const large = build(fixture, { annotationScale: 1.3 });
    for (const label of ["2400 мм", "Z +2700 мм"]) {
      assert.match(small, new RegExp(`\\n40\\n120\\n1\\n${label.replace("+", "\\+")}\\n`));
      assert.match(large, new RegExp(`\\n40\\n183\\.529\\n1\\n${label.replace("+", "\\+")}\\n`));
    }
    for (const dxf of [small, large]) assert.match(dxf, /\n40\n200\n1\nЗамер\n/);
  }
});

test("CAD labels for overlapping area and elevation outlines use distinct positions", () => {
  const points = [{ x: 0, y: 0 }, { x: 6000, y: 0 }, { x: 6000, y: 4000 }, { x: 0, y: 4000 }];
  const records = entityRecords(buildDxf([{ type: "area", id: "floor", points },
    { type: "elevation", id: "ceiling", points, height: 2700, zoneStyle: "ceiling" }]));
  const label = (layer) => records.find(({ type, fields }) => type === "TEXT" && fields.get("8")[0] === layer).fields;
  const area = label("areas");
  const ceiling = label("elevations");
  assert.ok(Math.abs(Number(area.get("21")[0]) - Number(ceiling.get("21")[0])) >= 300);
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

test("modern DXF includes walls and furniture layers only for emitted legacy geometry", () => {
  const wall = { type: "wall", x1: 0, y1: 0, x2: 1000, y2: 0, width: 180 };
  const furniture = { type: "block", kind: "table", x: 200, y: 400, width: 1000, height: 600 };
  const note = { type: "text", x: 100, y: 100, layer: "furniture", text: "Архив" };
  for (const [build, wallLayer, furnitureLayer] of [[buildDxf, "walls", "furniture"], [buildRevitDxf, "ZAMER_WALLS", "ZAMER_FURNITURE"]]) {
    const empty = build([{ ...wall, x1: NaN, x2: NaN }]);
    for (const layer of [wallLayer, furnitureLayer]) assert.ok(!empty.includes(`\n2\n${layer}\n`));
    const both = build([wall, furniture]);
    for (const layer of [wallLayer, furnitureLayer]) {
      assert.ok(both.includes(`\n2\n${layer}\n`));
      assert.ok(both.includes(`\n8\n${layer}\n`));
    }
    assert.ok(build([note]).includes(`\n2\n${furnitureLayer}\n`));
  }
  const legacy = writeDxf([]);
  assert.ok(legacy.includes("\n2\nwalls\n") && legacy.includes("\n2\nfurniture\n"));
});
