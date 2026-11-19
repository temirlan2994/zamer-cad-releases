import test from "node:test";
import assert from "node:assert/strict";
import { validateZamerProject } from "./project-format.js";
import { createPlanAnnotation } from "./plan-annotations.js";
import { MAX_CUSTOM_LINE_LAYERS } from "./line-layers.js";

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

test("legacy and explicit bent leaders round-trip through the Zamer project format", () => {
  const leader = { ...segment, dimensionKind: "leader", layer: "text", leaderLine: "bent", text: "Точка" };
  const bent = { ...leader, id: "bent", leaderElbow: { x: 90.125, y: 220 } };
  const project = { entities: [leader, bent] };
  assert.deepEqual(validateZamerProject(JSON.parse(JSON.stringify(project))), project);
  for (const leaderElbow of [{ x: 90 }, { x: "90", y: 220 }, { x: Infinity, y: 220 }]) {
    assert.throws(() => validateZamerProject({ entities: [{ ...bent, leaderElbow }] }), /повреждён объект/);
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

test("custom line layer definitions resolve root and room geometry and polyline draft layers", () => {
  const layer = { id: "line-layer-cables", name: "Электрика", color: "#b744f8" };
  const drawing = {
    entities: [
      { ...segment, layer: layer.id },
      { ...segment, id: "derived-rectangle", type: "rectangle", layer: layer.id },
      { id: "derived-circle", type: "circle", layer: layer.id, cx: 150, cy: 200, radius: 35 },
      { id: "derived-arc", type: "arc", layer: layer.id,
        start: { x: 40, y: 80 }, through: { x: 20, y: 100 }, end: { x: 0, y: 80 } },
    ],
    draft: { tool: "polyline", points: [point], layer: layer.id },
  };
  const project = { version: 2, ...drawing, customLineLayers: [layer], activeLineLayer: layer.id,
    survey: { version: 1, rooms: [{ id: "room-1", drawing }] } };
  assert.deepEqual(validateZamerProject(JSON.parse(JSON.stringify(project))), project);
  assert.doesNotThrow(() => validateZamerProject({ entities: [{ ...segment, layer: "legacy-import" }], activeLineLayer: "measure" }));
  assert.throws(() => validateZamerProject({ ...project, activeLineLayer: "line-layer-unknown" }), /активный слой/);
  assert.throws(() => validateZamerProject({ ...project, activeLineLayer: "walls" }), /активный слой/);
  assert.throws(() => validateZamerProject({ entities: drawing.entities }), /неизвестный слой/);
  assert.throws(() => validateZamerProject({ ...project, draft: { ...drawing.draft, layer: "line-layer-unknown" } }), /черновик/);
  assert.throws(() => validateZamerProject({ ...project, survey: { version: 1, rooms: [
    { drawing: { ...drawing, draft: { ...drawing.draft, layer: 3 } } },
  ] } }), /Помещение 1: повреждён черновик/);
  assert.throws(() => validateZamerProject({ ...project, survey: { version: 1, rooms: [
    { drawing: { ...drawing, entities: [{ ...segment, layer: "line-layer-unknown" }] } },
  ] } }), /Помещение 1: неизвестный слой/);
});

test("rejects corrupt layer metadata and oversized lists before importing a file", () => {
  const layer = { id: "line-layer-note", name: "Примечания", color: "#ac12ef" };
  const oversized = Array.from({ length: MAX_CUSTOM_LINE_LAYERS + 1 }, (_, index) => ({ ...layer, id: `line-layer-${index}` }));
  for (const customLineLayers of [null, {}, [layer, layer], [{ ...layer, id: "measure" }],
    [{ ...layer, name: "<метка>" }], [{ ...layer, color: "#f0a" }], oversized]) {
    assert.throws(() => validateZamerProject({ entities: [], customLineLayers }), /повреждены слои линий/i);
  }
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

test("multi-contour zones preserve the same data in a backup and reject intersecting parts", () => {
  const points = [{ x: 0, y: 0 }, { x: 2000, y: 0 }, { x: 2000, y: 2000 }, { x: 0, y: 2000 }];
  const second = points.map(({ x, y }) => ({ x: x + 4000, y }));
  const zone = createPlanAnnotation("zone", "elevation", points, { contours: [points, second], height: 2800 });
  assert.deepEqual(validateZamerProject(JSON.parse(JSON.stringify({ entities: [zone] }))), { entities: [zone] });
  assert.throws(() => validateZamerProject({ entities: [{ ...zone, contours: [points, points] }] }), /повреждён объект/);
});
