import assert from "node:assert/strict";
import test from "node:test";
import { buildBlockPreview } from "./block-preview.js";

const point = (x, y) => ({ x, y });

test("a single horizontal or vertical line is centered and fills its corresponding axis", () => {
  const horizontal = { type: "line", x1: 150, y1: 300, x2: 1150, y2: 300 };
  const vertical = { type: "line", x1: 150, y1: 300, x2: 150, y2: 1300 };
  assert.deepEqual(buildBlockPreview({ parts: [horizontal] }), { viewBox: "0 0 64 48", paths: [{ d: "M4.8 24L59.2 24" }] });
  assert.deepEqual(buildBlockPreview({ parts: [vertical] }), { viewBox: "0 0 64 48", paths: [{ d: "M32 4.8L32 43.2" }] });
});

test("block previews preserve rectangle closure and use actual SVG arcs for circles, arcs, and bulges", () => {
  const preview = buildBlockPreview({ parts: [
    { type: "rectangle", x1: 0, y1: 0, x2: 160, y2: 100 },
    { type: "circle", cx: 600, cy: 300, radius: 140 },
    { type: "arc", start: point(320, 0), through: point(420, 100), end: point(320, 200) },
    { type: "polyline", points: [point(0, 240), point(200, 240), point(200, 440)], closed: true, bulges: [-1, 0, 0] },
  ] });
  assert.equal(preview.paths.length, 1);
  const [{ d }] = preview.paths;
  assert.equal(d.match(/M/g).length, 4);
  assert.equal(d.match(/A/g).length, 4);
  assert.equal(d.match(/Z/g).length, 3);
  assert.match(d, /^[\d. AMLZ-]+$/u);
});

test("layer colors preserve one shared view and malformed input produces no markup", () => {
  const layer = "line-layer-cold";
  const definition = { name: "<private>", parts: [
    { type: "line", layer, x1: 0, y1: 0, x2: 100, y2: 0 },
    { type: "line", x1: 100, y1: 0, x2: 100, y2: 100 },
  ] };
  assert.deepEqual(buildBlockPreview(definition, { width: 80, height: 60,
    customLineLayers: [{ id: layer, name: "Вода", color: "#11AADD" }] }), {
    viewBox: "0 0 80 60",
    paths: [{ d: "M16 6L64 6", color: "#11aadd" }, { d: "M64 6L64 54" }],
  });
  const invalidColor = buildBlockPreview(definition, { customLineLayers: [{ id: layer, name: "Вода", color: "url(https://invalid.test)" }] });
  assert.equal(invalidColor.paths.length, 1);
  assert.deepEqual(Object.keys(invalidColor.paths[0]), ["d"]);
  assert.equal(buildBlockPreview({ parts: [{ type: "circle", cx: 0, cy: 0, radius: Infinity }] }), null);
  assert.equal(buildBlockPreview({ parts: [] }), null);
});
