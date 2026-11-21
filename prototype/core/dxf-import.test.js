import test from "node:test";
import assert from "node:assert/strict";
import { buildDxf } from "./dxf.js";
import { dwgToDxf, dxfToDwg } from "./dwg.js";
import { importDxf } from "./dxf-import.js";
import { validateZamerProject } from "./project-format.js";
import { createReusableBlockDefinition, createReusableBlockInstance, expandReusableBlock } from "./reusable-blocks.js";

function fixture(entities, units = 4, tables = []) {
  return [0, "SECTION", 2, "HEADER", 9, "$INSUNITS", 70, units, 0, "ENDSEC",
    0, "SECTION", 2, "TABLES", ...tables, 0, "ENDSEC",
    0, "SECTION", 2, "ENTITIES", ...entities, 0, "ENDSEC", 0, "EOF", ""].join("\n");
}

test("native CAD import preserves real-world units, layer lock, color and curved polyline direction", () => {
  const { project, skipped } = importDxf(fixture([
    0, "LINE", 8, "Стены", 10, 1, 20, 2, 11, 4, 21, 5,
    0, "LWPOLYLINE", 8, "Стены", 70, 1, 10, 0, 20, 0, 42, 1, 10, 1, 20, 0, 42, 1,
    0, "POINT", 8, "Стены", 10, 1, 20, 1,
  ], 5, [0, "LAYER", 2, "Стены", 70, 5, 62, 7, 420, 0x782c62]));
  assert.equal(skipped, 1);
  assert.deepEqual(project.entities[0], { type: "line", id: "dxf-0", layer: "line-layer-dxf-1", x1: 10, y1: -20, x2: 40, y2: -50 });
  assert.deepEqual(project.entities[1].bulges, [-1, -1]);
  assert.deepEqual(project.customLineLayers, [{ id: "line-layer-dxf-1", name: "Стены", color: "#782c62" }]);
  assert.deepEqual(project.lockedLayers, ["line-layer-dxf-1"]);
  assert.ok(!project.visibleLayers.includes("line-layer-dxf-1"));
  assert.equal(validateZamerProject(project), project);
});

test("Zamer CAD exchange preserves editable dimensions and native block references", async () => {
  const definition = createReusableBlockDefinition("template", "Узел", [
    { id: "element", type: "line", layer: "measure", x1: 0, y1: 0, x2: 100, y2: 300 },
  ]);
  const insert = { ...createReusableBlockInstance(definition, "placed", { x: 110, y: 210 }), rotation: 90, flipX: true, scale: 2 };
  const dxf = buildDxf([
    { id: "dimension", type: "line", layer: "dimensions", measurementType: "aligned", x1: 0, y1: 10, x2: 400, y2: 10, offset: 100 },
    insert,
  ]);
  const [originalLine] = expandReusableBlock(insert);
  for (const source of [dxf, await dwgToDxf(await dxfToDwg(dxf))]) {
    const { project, skipped } = importDxf(source);
    assert.equal(skipped, 0);
    assert.equal(project.reusableBlocks[0].name, "Узел");
    const restoredInsert = project.entities.find(entity => entity.type === "block");
    const [restoredLine] = expandReusableBlock(restoredInsert);
    for (const coordinate of ["x1", "y1", "x2", "y2"]) assert.ok(Math.abs(restoredLine[coordinate] - originalLine[coordinate]) < 1e-8);
    const dimension = project.entities.find(entity => entity.layer === "dimensions");
    assert.equal(dimension.x2, 400);
    assert.equal(dimension.dimY2, 110);
    assert.equal(validateZamerProject(project), project);
  }
});

test("CAD import rejects invalid or unsupported input", () => {
  assert.throws(() => importDxf("AutoCAD Binary DXF"), /двоичном/);
  assert.throws(() => importDxf("0\nSECTION\n2\n"), /повреждён/);
  assert.throws(() => importDxf(fixture([0, "POINT", 10, 0, 20, 0])), /нет поддерживаемых объектов/);
});
