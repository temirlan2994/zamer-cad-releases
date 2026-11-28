import test from "node:test";
import assert from "node:assert/strict";
import { Ellipse, Line, XYZ, DwgReader, DwgObjectWriter } from "./vendor/acad-ts-3.9.0/index.js";
import { writeDwgDocument } from "./dwg-compat.js";
import { buildDxf } from "./dxf.js";
import { dwgToDxf, dxfToDwg, saveSourceDwg } from "./dwg.js";
import { importDxf } from "./dxf-import.js";
import { createCadSource, cadSourceBytes, validateCadSource } from "./cad-source.js";
import { validateZamerProject, validStoredEntity } from "./project-format.js";
import { normalizeSurvey } from "./survey.js";
import { createReusableBlockDefinition, createReusableBlockInstance, expandReusableBlock } from "./reusable-blocks.js";

async function fixture() {
  const bytes = await dxfToDwg(buildDxf([
    { id: "line", type: "line", layer: "measure", x1: 0, y1: 0, x2: 1000, y2: 0 },
    { id: "text", type: "text", layer: "text", x: 0, y: 500, height: 100, text: "Исходная\nнадпись", textWidth: 1500 },
    { id: "leader", type: "line", layer: "text", dimensionKind: "leader", x1: 0, y1: 0, x2: 2500, y2: 800,
      text: "Подпись", textHeight: 100, leaderLine: "bent", leaderFrame: true, leaderElbow: { x: 1200, y: 800 } },
    { id: "dimension", type: "line", layer: "dimensions", measurementType: "aligned", x1: 0, y1: 0, x2: 1000, y2: 0, offset: 300 },
    { id: "circle", type: "circle", layer: "measure", cx: 3000, cy: 3000, radius: 500 },
    { id: "polyline", type: "polyline", layer: "measure", closed: true, points: [{ x: 0, y: 2000 }, { x: 1000, y: 2000 }, { x: 1000, y: 2800 }], bulges: [0.2, 0, 0] },
  ], { nativeAnnotations: true }));
  const doc = DwgReader.readFromStream(bytes.buffer);
  const ellipse = new Ellipse();
  ellipse.center = new XYZ(4000, 800, 0);
  ellipse.majorAxisEndPoint = new XYZ(800, 0, 0);
  doc.entities.add(ellipse);
  doc.paperSpace.entities.add(new Line(new XYZ(5000, 0, 0), new XYZ(5100, 0, 0)));
  doc.summaryInfo.title = "Исходный DWG с листом и эллипсом";
  const sourceBytes = writeDwgDocument(doc);
  const imported = importDxf(await dwgToDxf(sourceBytes));
  return { bytes: sourceBytes, source: createCadSource(sourceBytes, "original.dwg", imported), drawing: imported.project, skipped: imported.skipped };
}

test("original DWG survives JSON project backup and an unchanged save byte for byte", async () => {
  const { source, bytes, drawing } = await fixture();
  const backup = JSON.parse(JSON.stringify({ ...drawing, cadSource: source }));
  validateZamerProject(backup);
  assert.deepEqual(cadSourceBytes(backup.cadSource), bytes);
  assert.deepEqual(await saveSourceDwg(backup.cadSource, { ...backup, theme: "light" }), bytes);
  assert.equal(backup.cadSource.name, "original.dwg");
});

test("editing a line keeps the uneditable ellipse, paper space, styles and original handle", async () => {
  const { bytes, source, drawing, skipped } = await fixture();
  assert.equal(skipped, 1);
  const original = DwgReader.readFromStream(bytes.buffer);
  const before = [...original.entities].find(entity => entity.objectName === "LINE");
  const line = drawing.entities.find(entity => entity.type === "line" && entity.layer !== "dimensions" && !entity.dimensionKind);
  line.x2 = 1800;
  const output = await saveSourceDwg(source, drawing);
  const doc = DwgReader.readFromStream(output.buffer);
  const actual = [...doc.entities].find(entity => entity.handle === before.handle);
  assert.equal(actual.endPoint.x, 1800);
  assert.equal([...doc.entities].find(entity => entity.objectName === "ELLIPSE").center.x, 4000);
  assert.equal([...doc.paperSpace.entities].find(entity => entity.objectName === "LINE").startPoint.x, 5000);
  assert.equal(doc.summaryInfo.title, original.summaryInfo.title);
  assert.equal(doc.header.version, original.header.version);
  assert.deepEqual([...doc.layers].map(layer => layer.name), [...original.layers].map(layer => layer.name));
  assert.deepEqual(cadSourceBytes(source), bytes);
});

test("text and leader edits retain the native annotation link and unrelated objects", async () => {
  const { source, drawing } = await fixture();
  const text = drawing.entities.find(entity => entity.type === "text");
  text.text = "Исправленная\nнадпись"; text.x += 200; text.textWidth = 2000;
  const leader = drawing.entities.find(entity => entity.dimensionKind === "leader");
  leader.text = "Новая подпись"; leader.x1 = 300;
  const output = await saveSourceDwg(source, drawing);
  const doc = DwgReader.readFromStream(output.buffer);
  const native = [...doc.entities].find(entity => entity.objectName === "LEADER");
  assert.equal(native.associatedAnnotation.objectName, "MTEXT");
  assert.equal(native.associatedAnnotation.plainText, "Новая подпись");
  const reopened = importDxf(await dwgToDxf(output));
  assert.equal(reopened.project.entities.find(entity => entity.type === "text").text, text.text);
  assert.equal(reopened.project.entities.find(entity => entity.type === "text").textWidth, 2000);
  assert.equal(reopened.project.entities.find(entity => entity.dimensionKind === "leader").x1, 300);
});

test("adding and deleting model objects preserves the original noneditable data", async () => {
  const { source, drawing } = await fixture();
  drawing.entities = drawing.entities.filter(entity => !entity.dimensionKind && entity.layer !== "dimensions");
  drawing.entities.push({ id: "new-line", type: "line", layer: "measure", x1: 50, y1: 60, x2: 700, y2: 800 });
  const output = await saveSourceDwg(source, drawing);
  const doc = DwgReader.readFromStream(output.buffer);
  assert.equal([...doc.entities].filter(entity => entity.objectName === "LEADER").length, 0);
  assert.equal([...doc.entities].filter(entity => entity.objectName === "DIMENSION").length, 0);
  assert.equal([...doc.entities].filter(entity => entity.objectName === "ELLIPSE").length, 1);
  assert.equal([...doc.entities].filter(entity => entity.objectName === "LINE").length, 2);
  assert.equal([...doc.paperSpace.entities].length, 1);
});

test("changed native dimensions keep their dimension style", async () => {
  const { source, drawing, bytes } = await fixture();
  const previous = [...DwgReader.readFromStream(bytes.buffer).entities].find(entity => entity.objectName === "DIMENSION");
  drawing.entities.find(entity => entity.layer === "dimensions").x2 = 1400;
  const output = await saveSourceDwg(source, drawing);
  const dimension = [...DwgReader.readFromStream(output.buffer).entities].find(entity => entity.objectName === "DIMENSION");
  assert.equal(dimension.secondPoint.x, 1400);
  assert.equal(dimension.style.name, previous.style.name);
  assert.equal(dimension.style.textHeight, previous.style.textHeight);
});

test("unsupported edits fail without changing the stored original", async () => {
  const { source, bytes, drawing } = await fixture();
  drawing.entities[0].type = "wall";
  await assert.rejects(saveSourceDwg(source, drawing), /Исходник доступен без изменений/);
  assert.deepEqual(cadSourceBytes(source), bytes);
});

test("explicit line color and weight can be changed without replacing its CAD handle", async () => {
  const { source, drawing } = await fixture();
  const line = drawing.entities.find(entity => entity.type === "line" && !entity.dimensionKind && entity.layer !== "dimensions");
  line.color = "#ff0000"; line.lineWeight = 0.5;
  const output = await saveSourceDwg(source, drawing);
  const doc = DwgReader.readFromStream(output.buffer);
  const actual = [...doc.entities].find(entity => entity.objectName === "LINE");
  assert.equal(actual.lineWeight, 50);
  assert.match(new TextDecoder().decode(await dwgToDxf(output)), /\n\s*420\n16711680\n/);
});

test("source-unit conversion keeps metre DWGs in their original units", async () => {
  const dxf = buildDxf([{ id: "line", type: "line", layer: "measure", x1: 0, y1: 0, x2: 10, y2: 0 }])
    .replace("$INSUNITS\n70\n4", "$INSUNITS\n70\n6");
  const bytes = await dxfToDwg(dxf);
  const imported = importDxf(await dwgToDxf(bytes));
  const source = createCadSource(bytes, "metres.dwg", imported);
  assert.equal(source.unitScale, 1000);
  imported.project.entities[0].x2 += 500;
  const output = await saveSourceDwg(source, imported.project);
  assert.equal([...DwgReader.readFromStream(output.buffer).entities][0].endPoint.x, 10.5);
  assert.equal(importDxf(await dwgToDxf(output)).unitScale, 1000);
});

test("a writer changing an unrelated entity is detected and the original remains intact", async () => {
  const { source, drawing, bytes } = await fixture();
  drawing.entities[0].x2 += 20;
  const write = DwgObjectWriter.prototype._writeEllipse;
  DwgObjectWriter.prototype._writeEllipse = function(entity) {
    const point = entity.center;
    entity.center = new XYZ(99999, point.y, point.z);
    try { return write.call(this, entity); }
    finally { entity.center = point; }
  };
  try { await assert.rejects(saveSourceDwg(source, drawing), /Исходник доступен без изменений/); }
  finally { DwgObjectWriter.prototype._writeEllipse = write; }
  assert.deepEqual(cadSourceBytes(source), bytes);
});

test("inactive survey-room drawings retain their own original DWG through normalization", async () => {
  const { source, drawing } = await fixture();
  const survey = normalizeSurvey({ version: 1, activeRoomId: "room-2", rooms: [
    { id: "room-1", drawing: { entities: drawing.entities, cadSource: source } }, { id: "room-2" },
  ] });
  assert.deepEqual(survey.rooms[0].drawing.cadSource, source);
  validateZamerProject({ version: 2, entities: [], customLineLayers: drawing.customLineLayers, survey });
});

test("malformed source links and invalid source data are rejected on project load", async () => {
  const { source } = await fixture();
  const valid = value => validateCadSource(value, validStoredEntity);
  valid(source);
  assert.throws(() => valid({ ...source, data: "not a DWG" }));
  assert.throws(() => valid({ ...source, unitScale: 0 }));
  const bindings = source.bindings.map(binding => ({ ...binding }));
  bindings[0].handle = bindings[1].handle;
  assert.throws(() => valid({ ...source, bindings }));
  assert.throws(() => valid({ ...source, baseline: { entities: [{ ...source.baseline.entities[0], x1: Infinity }] } }));
});

test("circle and curved-polyline edits keep native CAD types and untouched data", async () => {
  const { source, drawing } = await fixture();
  drawing.entities.find(entity => entity.type === "circle").radius = 700;
  drawing.entities.find(entity => entity.type === "polyline").points[1].x = 1200;
  const output = await saveSourceDwg(source, drawing);
  const entities = [...DwgReader.readFromStream(output.buffer).entities];
  assert.equal(entities.find(entity => entity.objectName === "CIRCLE").radius, 700);
  const polyline = entities.find(entity => entity.objectName === "LWPOLYLINE");
  assert.equal(polyline.vertices[1].location.x, 1200);
  assert.equal(polyline.vertices[0].bulge, -0.2);
  assert.equal(entities.filter(entity => entity.objectName === "ELLIPSE").length, 1);
});

test("moving, rotating, scaling and reflecting a block preserves its CAD definition", async () => {
  const definition = createReusableBlockDefinition("definition", "Узел", [
    { id: "part", type: "line", layer: "measure", x1: 0, y1: 0, x2: 200, y2: 100 },
  ]);
  const entity = createReusableBlockInstance(definition, "placed", { x: 500, y: 500 });
  const bytes = await dxfToDwg(buildDxf([entity]));
  const imported = importDxf(await dwgToDxf(bytes));
  const source = createCadSource(bytes, "block.dwg", imported);
  const block = imported.project.entities[0];
  block.x += 300; block.y += 200; block.rotation += 90; block.scale *= 2; block.flipX = !block.flipX;
  const output = await saveSourceDwg(source, imported.project);
  const actual = importDxf(await dwgToDxf(output)).project.entities[0];
  const [expectedLine] = expandReusableBlock(block);
  const [actualLine] = expandReusableBlock(actual);
  for (const key of ["x1", "y1", "x2", "y2"]) assert.ok(Math.abs(expectedLine[key] - actualLine[key]) < 1e-7,
    `${key}: expected ${JSON.stringify(expectedLine)}, got ${JSON.stringify(actualLine)}`);
});
