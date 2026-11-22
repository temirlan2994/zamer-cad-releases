import test from "node:test";
import assert from "node:assert/strict";
import { IMPORT_UNIT_FACTORS, scaleImportedProject } from "./project-import.js";

test("converts imported centimetre geometry and keeps the same initial screen framing", () => {
  const source = {
    entities: [
      { id: "line", type: "line", x1: 2, y1: 3, x2: 42, y2: 3 },
      { id: "wall", type: "wall", x1: 0, y1: 0, x2: 100, y2: 0, width: 18 },
    ],
    view: { scale: 0.8, panX: 20, panY: 30 },
    draft: { tool: "polyline", points: [{ x: 1, y: 2 }] },
  };
  const result = scaleImportedProject(source, IMPORT_UNIT_FACTORS.cm);
  assert.deepEqual(result.entities[0], { id: "line", type: "line", x1: 20, y1: 30, x2: 420, y2: 30 });
  assert.equal(result.entities[1].width, 180);
  assert.deepEqual(result.view, { scale: 0.08, panX: 20, panY: 30 });
  assert.deepEqual(result.draft.points, [{ x: 10, y: 20 }]);
  assert.equal(source.entities[0].x1, 2);
});

test("converts elevation values and nested survey measurements", () => {
  const source = {
    entities: [{ id: "z", type: "elevation", layer: "elevations", points: [
      { x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 },
    ], height: 280, zoneStyle: "ceiling" }],
    survey: { version: 1, tolerance: 0.5, rooms: [{ id: "room", records: [{ id: "r", point: { x: 2, y: 3 }, values: { height: 280 } }],
      drawing: { entities: [{ id: "nested", type: "circle", cx: 5, cy: 6, radius: 2 }] } }] },
  };
  const result = scaleImportedProject(source, 10);
  assert.equal(result.entities[0].height, 2800);
  assert.equal(result.entities[0].points[1].x, 1000);
  assert.equal(result.survey.tolerance, 5);
  assert.deepEqual(result.survey.rooms[0].records[0].point, { x: 20, y: 30 });
  assert.equal(result.survey.rooms[0].records[0].values.height, 2800);
  assert.equal(result.survey.rooms[0].drawing.entities[0].radius, 20);
});

test("rejects unsafe import factors", () => {
  assert.throws(() => scaleImportedProject({ entities: [] }, 0), /от 0,001 до 1000/);
  assert.throws(() => scaleImportedProject({ entities: [] }, 1001), /от 0,001 до 1000/);
});
