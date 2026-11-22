import test from "node:test";
import assert from "node:assert/strict";
import { buildProjectPreview } from "./project-preview.js";

const line = (x1, y1, x2, y2, layer = "measure") => ({ type: "line", layer, x1, y1, x2, y2 });
const point = (x, y) => ({ x, y });

test("fits the sketch independently of the camera and respects hidden layers", () => {
  const project = {
    visibleLayers: ["measure"],
    entities: [line(0, 0, 1000, 500), line(-90000, -90000, 90000, 90000, "walls")],
  };
  const preview = buildProjectPreview(project);
  assert.deepEqual(preview, { viewBox: "0 0 160 96", paths: [{ d: "M9.6 12.8L150.4 83.2", tone: "geometry" }] });
  assert.deepEqual(buildProjectPreview({ ...project, view: { panX: 20000, panY: -100, scale: 0.007 } }), preview);
  assert.equal(buildProjectPreview({ ...project, visibleLayers: [] }), null);
  assert.deepEqual(buildProjectPreview({ entities: [line(0, 0, 0.0001, 0)] }, { width: 200, height: 100 }), {
    viewBox: "0 0 200 100", paths: [{ d: "M10 50L190 50", tone: "geometry" }],
  });
});

test("preserves real circles, arcs and bulged paths and combines annotation layers", () => {
  const entities = [
    { ...line(0, 0, 1200, 0, "walls"), type: "wall", width: 100 },
    { ...line(0, 0, 1200, 600), type: "rectangle" },
    { type: "circle", cx: 300, cy: 400, radius: 150 },
    { type: "arc", start: point(500, 0), through: point(600, 300), end: point(700, 0) },
    { type: "polyline", points: [point(800, 0), point(1200, 0)], bulges: [1] },
    { type: "block", x: 700, y: 550, width: 150, height: 125, rotation: 30 },
    { type: "elevation", points: [point(50, 0), point(150, 0), point(150, 150)] },
    { type: "area", points: [point(0, 0), point(1200, 0), point(1200, 600)] },
    { ...line(100, 250, 200, 300, "text"), dimensionKind: "leader", leaderElbow: point(140, 400),
      leaderLine: "bent", leaderFrame: true, textHeight: 50, text: "<private-name>" },
    { ...line(0, 0, 1200, 0, "dimensions"), offset: -100 },
    { type: "line", layer: "dimensions", dimensionKind: "angular", vertex: point(0, 0), arm1: point(600, 0), arm2: point(0, 600) },
    { type: "text", x: 900, y: 400, height: 30, rotation: 90, text: "<private-title>" },
  ];
  const { paths } = buildProjectPreview({ entities });
  assert.deepEqual(paths.map(({ tone }) => tone), ["area", "elevation", "wall", "geometry", "furniture", "annotation"]);
  assert.equal(paths.filter(path => path.fill).length, 2);
  assert.equal(paths.find(path => path.tone === "geometry").d.match(/A/g).length, 4);
  assert.equal(paths.find(path => path.tone === "annotation").d.match(/A/g).length, 1);
  assert.ok(paths.every(path => /^[\d. AMLZ-]+$/.test(path.d)));
});

test("reduces dense plans while retaining endpoints, extrema, and accepted polyline draft", () => {
  const entities = Array.from({ length: 1800 }, (_, index) => line(0, 0, 100 + index % 15, 0));
  entities[991] = line(-1000, 0, -900, 0);
  const overview = buildProjectPreview({ entities });
  assert.match(overview.paths[0].d, /M9\.6 48L/);
  assert.ok(overview.paths[0].d.length < 20000);

  const points = Array.from({ length: 2000 }, (_, index) => point(index, 0));
  points[997] = point(997, -3000);
  const draft = buildProjectPreview({ entities: [], draft: { tool: "polyline", points } });
  assert.match(draft.paths[0].d, /L\d+(?:\.\d+)? 9\.6/);
  assert.ok(draft.paths[0].d.length < 5000);
});

test("ignores corrupt and overflow geometry without obscuring a valid drawing", () => {
  const legitimate = line(1e12 - 50, -1e12, 1e12, -1e12 + 100);
  const corrupted = [null, true, { type: "flattened" }, line(0, 0, Infinity, 0), { type: "circle", cx: 0, cy: 0, radius: 1e200 },
    { type: "polyline", points: [point(0, 0), null] }, { type: "rectangle", x1: "10", y1: 0, x2: 100, y2: 0 }];
  assert.deepEqual(buildProjectPreview({ entities: [...corrupted, legitimate] }), buildProjectPreview({ entities: [legitimate] }));
  assert.equal(buildProjectPreview({ entities: corrupted }), null);
  assert.equal(buildProjectPreview({ entities: [legitimate] }, { height: Infinity }), null);
});
