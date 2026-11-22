import assert from "node:assert/strict";
import test from "node:test";
import { buildDxf, buildRevitDxf } from "./dxf.js";
import { arcGeometry } from "./geometry.js";
import { pdfPlotBounds } from "./pdf.js";
import { validateZamerProject } from "./project-format.js";
import { buildProjectPreview } from "./project-preview.js";
import { createReusableBlockDefinition, createReusableBlockInstance, expandDrawingBlocks, expandReusableBlock,
  explodeEntity, normalizeReusableBlocks, reusableBlockBounds } from "./reusable-blocks.js";

const layer = "line-layer-colored";
const customLineLayers = [{ id: layer, name: "Окна", color: "#1177aa" }];
const point = (x, y) => ({ x, y });
const polyline = { id: "polyline", type: "polyline", layer, closed: true,
  points: [point(0, 0), point(400, 0), point(400, 250)], bulges: [1, 0, 0] };
const rectangle = { id: "rectangle", type: "rectangle", layer: "measure", x1: 500, y1: -100, x2: 800, y2: 300 };

test("explode preserves line and arc edges, contour order, and layers", () => {
  const edges = explodeEntity(polyline);
  assert.deepEqual(edges.map(edge => [edge.type, edge.layer]), [["arc", layer], ["line", layer], ["line", layer]]);
  assert.deepEqual(edges[0].through, point(200, -200));
  assert.equal(arcGeometry(edges[0].start, edges[0].through, edges[0].end).radius, 200);
  assert.deepEqual(edges[2], { type: "line", layer, x1: 400, y1: 250, x2: 0, y2: 0 });
  assert.equal(explodeEntity(rectangle).length, 4);
  assert.ok(explodeEntity(rectangle).every(edge => edge.type === "line" && edge.layer === "measure"));
});

test("a saved reusable block keeps complete primitives through translation, rotation, scale and reflection", () => {
  const definition = createReusableBlockDefinition("windows", "Окно", [polyline, rectangle]);
  const boundsCenter = point(400, 50);
  const source = createReusableBlockInstance(definition, "block-source", boundsCenter);
  assert.deepEqual(expandReusableBlock(source)[0].points, polyline.points);
  assert.deepEqual(reusableBlockBounds(source), { minX: 0, minY: -200, maxX: 800, maxY: 300 });
  const instance = { ...source, x: 1000, y: 2000, rotation: 90, scale: 2, flipX: true };
  const pieces = explodeEntity(instance);
  assert.deepEqual(pieces[0].bulges, [-1, -0, -0]);
  assert.deepEqual(pieces[0].points, [point(1100, 2800), point(1100, 2000), point(600, 2000)]);
  assert.deepEqual(pieces[1], { type: "rectangle", layer: "measure", x1: 1300, y1: 1800, x2: 500, y2: 1200 });
  const angled = explodeEntity({ ...instance, rotation: 25 });
  assert.equal(angled[1].type, "polyline");
  assert.equal(angled[1].closed, true);
  pieces[0].points[0].x = 0;
  assert.equal(expandReusableBlock(instance)[0].points[0].x, 1100);
});

test("backup, DXF, PDF bounds, and project miniature keep reusable block geometry", () => {
  const definition = createReusableBlockDefinition("windows", "Окно", [polyline, rectangle]);
  const source = createReusableBlockInstance(definition, "block-instance", point(400, 50));
  const doc = { version: 2, entities: [source], reusableBlocks: [definition], customLineLayers };
  const saved = JSON.parse(JSON.stringify(doc));
  assert.deepEqual(validateZamerProject(saved), saved);
  assert.deepEqual(validateZamerProject({ ...saved, reusableBlocks: [] }).entities, saved.entities);
  assert.throws(() => validateZamerProject({ ...saved, customLineLayers: [] }), /слой/);
  assert.deepEqual(normalizeReusableBlocks([definition, { ...definition, id: "duplicate" }]), [definition]);
  const expanded = expandDrawingBlocks([source]);
  assert.equal(expanded.length, 2);
  assert.equal(expandDrawingBlocks([source], part => part.layer === "measure").length, 1);
  assert.deepEqual(pdfPlotBounds([source]), pdfPlotBounds(expanded));
  assert.deepEqual(buildProjectPreview({ entities: [source] }), buildProjectPreview({ entities: expanded }));
  for (const [build, name] of [[buildDxf, "Окна"], [buildRevitDxf, "ZAMER_Окна"]]) {
    const dxf = build([source], { customLineLayers });
    assert.match(dxf, /\n0\nLWPOLYLINE\n/);
    assert.ok(dxf.includes(`\n8\n${name}\n`));
    assert.ok(dxf.includes("\n42\n-1\n"));
  }
});
