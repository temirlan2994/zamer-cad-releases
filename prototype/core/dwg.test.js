import assert from "node:assert/strict";
import { test } from "node:test";
import { buildDxf } from "./dxf.js";
import { importDxf } from "./dxf-import.js";
import { dwgToDxf, dxfToDwg } from "./dwg.js";

const layer = { id: "line-layer-electric", name: "Электрика", color: "#c33a59" };
const entities = [
  { id: "segment", type: "line", layer: layer.id, x1: 215, y1: 250, x2: 1820, y2: 420 },
  { id: "contour", type: "polyline", layer: layer.id, closed: true,
    points: [{ x: 200, y: 400 }, { x: 800, y: 401 }, { x: 215, y: 880 }], bulges: [0.25, 0, 0] },
  { id: "circle", type: "circle", layer: "measure", cx: 1500, cy: 500, radius: 340 },
  { id: "arc", type: "arc", layer: "measure", start: { x: 100, y: 0 }, through: { x: 200, y: 100 }, end: { x: 100, y: 200 } },
  { id: "text", type: "text", layer: "text", x: 700, y: 720, height: 120, rotation: 0, text: "Розетки кухни" },
];
const source = buildDxf(entities, { customLineLayers: [layer] });

function drawingContent({ project }) {
  const layers = new Map(project.customLineLayers.map((item) => [item.id, item]));
  return project.entities.map(({ id, layer, ...entity }) => ({
    ...entity,
    layer: layers.has(layer) ? layers.get(layer).name : layer,
  }));
}

test("DWG conversion writes an AutoCAD 2018 binary and preserves editable CAD entities", async () => {
  const bytes = new TextEncoder().encode(source);
  const original = bytes.slice();
  const dwg = await dxfToDwg(bytes);
  assert.equal(new TextDecoder().decode(dwg.subarray(0, 6)), "AC1032");
  assert.deepEqual(bytes, original);
  const dxf = await dwgToDxf(dwg.buffer);
  const imported = importDxf(dxf);
  assert.deepEqual(drawingContent(imported), drawingContent(importDxf(source)));
  assert.equal(imported.project.customLineLayers.find(({ name }) => name === layer.name).color, layer.color);
});

test("DWG export recovers a source DXF whose header points to a missing dimension style", async () => {
  const withoutStyle = source.replace("HEADER\n", "HEADER\n9\n$DIMSTYLE\n2\nISO-25\n");
  assert.notEqual(withoutStyle, source);
  const dwg = await dxfToDwg(withoutStyle);
  assert.deepEqual(drawingContent(importDxf(await dwgToDxf(dwg))), drawingContent(importDxf(source)));
});

test("DWG import rejects unrelated data and empty files", async () => {
  await assert.rejects(dwgToDxf(new Uint8Array([1, 2, 3, 4])), /неизвестный формат/);
  await assert.rejects(dwgToDxf(new ArrayBuffer(0)), /пуст/);
});
