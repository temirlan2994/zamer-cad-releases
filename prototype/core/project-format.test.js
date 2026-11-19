import test from "node:test";
import assert from "node:assert/strict";
import { validateZamerProject } from "./project-format.js";
import { createPlanAnnotation } from "./plan-annotations.js";

const segment = { id: "line-1", type: "line", x1: 100, y1: 200, x2: 150, y2: 240 };
const point = { x: 200, y: 50 };
const legacy = { version: 1, entities: [segment, { ...segment, id: "wall-1", type: "wall" },
  { id: "chair-1", type: "block", x: 30, y: 100, kind: "chair" }] };

test("legacy geometry and new room and polyline records survive validation unchanged", () => {
  assert.equal(validateZamerProject(legacy), legacy);
  const current = { version: 2, name: "Обмер", entities: [segment],
    draft: { tool: "polyline", points: [point] },
    survey: { version: 1, rooms: [{ id: "room-1", drawing: { entities: [segment] } }] } };
  assert.equal(validateZamerProject(current), current);
});

test("unknown versions and malformed, duplicate, or unsupported entities are rejected", () => {
  assert.throws(() => validateZamerProject({ name: "Not a drawing" }), /отсутствует список/);
  assert.throws(() => validateZamerProject({ version: 77, entities: [] }), /версия файла/);
  for (const entities of [[{ id: "arc-1", type: "arc", start: point }], [segment, segment],
    [{ ...segment, x2: Infinity }], [{ id: "shape-1", type: "unknown" }]]) {
    assert.throws(() => validateZamerProject({ version: 2, entities }), /повреждён объект/);
  }
});

test("nested survey geometry and a polyline draft are checked before import", () => {
  const drawing = { entities: [{ id: "arc-1", type: "arc" }] };
  assert.throws(() => validateZamerProject({ entities: [], survey: { version: 1, rooms: [{ drawing }] } }), /Помещение 1/);
  assert.throws(() => validateZamerProject({ entities: [], draft: { tool: "line", points: [point] } }), /черновик/);
  assert.throws(() => validateZamerProject({ entities: [], survey: { version: 6 } }), /версия обмера/);
});

test("polylines and unfinished drafts preserve signed bulges in project and room drawings", () => {
  const points = [{ x: 0, y: 0 }, { x: 3000, y: 0 }, { x: 3000, y: 2000 }];
  const shape = { id: "curved", type: "polyline", layer: "measure", closed: true, points, bulges: [0.5, 0, -0.2] };
  const draft = { tool: "polyline", points, bulges: [-0.5, 0] };
  const drawing = { draft, entities: [shape] };
  const project = { version: 2, ...drawing, survey: { version: 1, rooms: [{ drawing }] } };
  assert.deepEqual(validateZamerProject(JSON.parse(JSON.stringify(project))), project);
  for (const bulges of [null, [0, 1], [0, null, 1], [0, NaN, 1], [0, , 1], [0, 0, 1e308], "1"]) {
    assert.throws(() => validateZamerProject({ entities: [{ ...shape, bulges }] }), /повреждён объект/);
  }
  for (const bulges of [[0], [0, 1, 2], [0, "0.3"]]) {
    assert.throws(() => validateZamerProject({ entities: [], draft: { ...draft, bulges } }), /черновик/);
  }
  assert.doesNotThrow(() => validateZamerProject({ entities: [], draft: { ...draft, points: points.slice(0, 1), bulges: [] } }));
  assert.throws(() => validateZamerProject({ entities: [], draft: { ...draft, points: points.slice(0, 1), bulges: [0] } }), /черновик/);
  assert.throws(() => validateZamerProject({ entities: [], draft: { ...draft, points: Array(1), bulges: [] } }), /черновик/);
});

test("project and room backups preserve independent plan area and Z annotations", () => {
  const points = [{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 1000, y: 1000 }, { x: 0, y: 1000 }];
  const area = createPlanAnnotation("area-1", "area", points, { label: "Кухня" });
  const elevation = createPlanAnnotation("z-1", "elevation", points, { height: -20.5, zoneStyle: "drop" });
  const stored = { version: 2, entities: [area, elevation], survey: { version: 1, rooms: [
    { id: "room-1", drawing: { entities: [area, elevation] } },
  ] } };
  const archive = JSON.parse(JSON.stringify(stored));
  assert.deepEqual(validateZamerProject(archive), stored);
  assert.throws(() => validateZamerProject({ entities: [{ ...elevation, height: "-20.5" }] }), /повреждён объект/);
  assert.throws(() => validateZamerProject({ entities: [{ ...elevation, zoneStyle: "unknown" }] }), /повреждён объект/);
  assert.throws(() => validateZamerProject({ entities: [{ ...area, layer: "elevations" }] }), /повреждён объект/);
  assert.throws(() => validateZamerProject({ entities: [{ ...area, points: [points[0], points[2], points[1], points[3]] }] }), /повреждён объект/);
});
