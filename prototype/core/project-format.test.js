import test from "node:test";
import assert from "node:assert/strict";
import { validateZamerProject } from "./project-format.js";

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
