import test from "node:test";
import assert from "node:assert/strict";
import { decodeCadText, encodeMText } from "./cad-text.js";
import { buildDxf } from "./dxf.js";
import { importDxf } from "./dxf-import.js";
import { dxfToDwg, dwgToDxf } from "./dwg.js";
import { writeDwgDocument } from "./dwg-compat.js";
import { DwgReader, DwgObjectWriter } from "./vendor/acad-ts-3.9.0/index.js";
import { validateZamerProject } from "./project-format.js";

function close(actual, expected) { assert.ok(Math.abs(actual - expected) < 1e-7, `${actual} != ${expected}`); }
function drawing(records) {
  return [0, "SECTION", 2, "ENTITIES", ...records, 0, "ENDSEC", 0, "EOF", ""].join("\n");
}

test("CAD text controls preserve literal braces, slashes, Unicode and paragraphs", () => {
  const text = "{Узел} \\server\\file\nРазмер ⌀ 25 ± 2° 😀";
  assert.equal(decodeCadText(encodeMText(text), true), text);
  assert.equal(decodeCadText("{\\fArial|b1;\\H2x;Шкаф}\\P\\LФасад\\l \\U+0410 %%d", true), "Шкаф\nФасад А °");
  assert.equal(decodeCadText("{Обычный текст} \\path"), "{Обычный текст} \\path");
});

test("native MTEXT remains a single editable text block through DWG with width, rotation and frame", async () => {
  const source = { id: "text", type: "text", layer: "text", x: 123.5, y: 850.25, height: 120, rotation: 32,
    text: ("Русский текст 😀 {полка} \\ " .repeat(15)) + "\nВторая строка", textWidth: 3200, textFrame: true };
  const dxf = buildDxf([source], { nativeAnnotations: true });
  assert.equal(dxf.split("\nMTEXT\n").length - 1, 1);
  assert.ok(dxf.includes("\n3\n")); // Multi-chunk text, including surrogate pairs.
  for (const input of [dxf, await dwgToDxf(await dxfToDwg(dxf))]) {
    const { project, skipped } = importDxf(input);
    assert.equal(skipped, 0);
    assert.equal(project.entities.length, 1);
    const [actual] = project.entities;
    assert.equal(actual.type, "text");
    assert.equal(actual.text, source.text);
    assert.equal(actual.textFrame, true);
    for (const key of ["x", "y", "height", "rotation", "textWidth"]) close(actual[key], source[key]);
    validateZamerProject(project);
  }
});

test("native LEADER retains its text association, shape and frame through a DWG edit and resave", async () => {
  for (const leaderLine of ["straight", "bent"]) for (const leaderFrame of [false, true]) {
    const source = { id: "leader", type: "line", layer: "text", dimensionKind: "leader", x1: 100, y1: 200,
      x2: 2500, y2: 700, leaderLine, leaderFrame, leaderElbow: { x: 900, y: 700 },
      text: "Розетка\nВысота 300", textHeight: 100 };
    const bytes = await dxfToDwg(buildDxf([source], { nativeAnnotations: true }));
    // Check the actual CAD object graph, not only our importer or a rendered picture.
    const doc = DwgReader.readFromStream(bytes.buffer);
    const native = [...doc.entities].find(entity => entity.objectName === "LEADER");
    assert.equal(native.associatedAnnotation?.objectName, "MTEXT");
    const { project, skipped } = importDxf(await dwgToDxf(bytes));
    assert.equal(skipped, 0);
    assert.equal(project.entities.length, 1);
    const [actual] = project.entities;
    for (const key of ["dimensionKind", "text", "textHeight", "leaderLine", "leaderFrame"]) assert.equal(actual[key], source[key]);
    for (const key of ["x1", "y1", "x2", "y2"]) close(actual[key], source[key]);
    if (leaderLine === "bent") assert.deepEqual(actual.leaderElbow, source.leaderElbow);
    actual.text = "Исправленная подпись";
    actual.x1 += 125;
    const rewritten = await dxfToDwg(buildDxf(project.entities, { nativeAnnotations: true }));
    const reopened = importDxf(await dwgToDxf(rewritten));
    assert.equal(reopened.project.entities.length, 1);
    assert.equal(reopened.project.entities[0].text, actual.text);
    close(reopened.project.entities[0].x1, actual.x1);
    validateZamerProject(reopened.project);
  }
});

test("native dimensions remain dimensions beside editable leaders and MTEXT", async () => {
  const source = [
    { id: "dimension", type: "line", layer: "dimensions", x1: 0, y1: 0, x2: 2000, y2: 0, offset: 400 },
    { id: "text", type: "text", layer: "text", x: 500, y: 500, height: 100, text: "Две\nстроки" },
    { id: "leader", type: "line", layer: "text", dimensionKind: "leader", x1: 0, y1: 0, x2: 800, y2: 800,
      text: "Выноска", textHeight: 80, leaderLine: "straight", leaderFrame: false },
  ];
  const bytes = await dxfToDwg(buildDxf(source, { nativeAnnotations: true }));
  const kinds = [...DwgReader.readFromStream(bytes.buffer).entities].map(entity => entity.objectName);
  assert.equal(kinds.filter(kind => kind === "DIMENSION").length, 1);
  assert.equal(kinds.filter(kind => kind === "LEADER").length, 1);
  assert.equal(kinds.filter(kind => kind === "MTEXT").length, 2);
  assert.equal(importDxf(await dwgToDxf(bytes)).project.entities.length, 3);
});

test("unrepresentable leaders don't consume their still-readable labels", () => {
  const { project, skipped } = importDxf(drawing([
    0, "LEADER", 5, "A", 72, 1, 10, 0, 20, 0, 10, 100, 20, 100, 340, "B",
    0, "MTEXT", 5, "B", 10, 200, 20, 300, 40, 50, 1, "Подпись", 71, 5,
  ]));
  assert.equal(skipped, 1);
  assert.equal(project.entities.length, 1);
  assert.equal(project.entities[0].type, "text");
});

test("MTEXT rotation obeys radians and field precedence", () => {
  for (const [fields, degrees] of [[ [50, Math.PI / 2], -90 ],
    [[50, Math.PI / 2, 11, 1, 21, 0], 0], [[11, 1, 21, 0, 50, Math.PI / 2], -90]]) {
    const { project } = importDxf(drawing([0, "MTEXT", 10, 0, 20, 0, 40, 100, 1, "Текст", ...fields]));
    close(project.entities[0].rotation, degrees);
  }
});

test("the pinned DWG writer compatibility repair is scoped to one write, including failure", () => {
  const original = DwgObjectWriter.prototype._writeLeader;
  assert.throws(() => writeDwgDocument(null));
  assert.equal(DwgObjectWriter.prototype._writeLeader, original);
});
