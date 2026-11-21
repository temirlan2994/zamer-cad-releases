import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDxf, buildRevitDxf } from "./dxf.js";
import { appendDxfPolyline } from "./dxf-writer.js";
import { createPolyline, polylineArcPoint, polylineBounds, polylineSegments, validPolylinePoints } from "./polyline.js";

const points = [{ x: -2.5, y: 8 }, { x: 100, y: 8 }, { x: 100, y: -70 }];

test("creates one polyline with independent copies of its vertices", () => {
  const vertices = structuredClone(points);
  const polyline = createPolyline("polyline-1", vertices, { layer: "walls" });
  assert.deepEqual(polyline, { id: "polyline-1", type: "polyline", layer: "walls", points, closed: false });
  vertices[0].x = 25;
  assert.equal(polyline.points[0].x, -2.5);
  assert.equal(createPolyline("open", points.slice(0, 2)).layer, "measure");
});

test("rejects malformed and degenerate vertices before storing a polyline", () => {
  assert.equal(createPolyline("short", points.slice(0, 1)), null);
  assert.equal(createPolyline("closed", points.slice(0, 2), { closed: true }), null);
  assert.equal(validPolylinePoints([points[0], points[0], points[1]]), false);
  assert.equal(validPolylinePoints([...points, points[0]], true), false);
  assert.equal(validPolylinePoints([points[0], { x: "10", y: 3 }]), false);
  assert.equal(validPolylinePoints([points[0], { x: Infinity, y: 9 }]), false);
  assert.equal(validPolylinePoints(Array(2)), false);
  assert.equal(polylineBounds(null), null);
  assert.deepEqual(polylineSegments(null), []);
});

test("enumerates consecutive edges and adds the last-to-first edge only when closed", () => {
  const open = createPolyline("open", points);
  const closed = createPolyline("closed", points, { closed: true });
  assert.deepEqual(polylineSegments(open), [
    { p1: points[0], p2: points[1], index: 0, bulge: 0, arc: null },
    { p1: points[1], p2: points[2], index: 1, bulge: 0, arc: null },
  ]);
  assert.deepEqual(polylineSegments(closed), [
    ...polylineSegments(open),
    { p1: points[2], p2: points[0], index: 2, bulge: 0, arc: null },
  ]);
  assert.deepEqual(polylineBounds(closed), { minX: -2.5, minY: -70, maxX: 100, maxY: 8 });
});

test("validates and copies outgoing bulges with exact centers and signed direction", () => {
  const vertices = [{ x: -100, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 120 }];
  const bulges = [1, 0];
  const curved = createPolyline("curved", vertices, { bulges });
  bulges[0] = 0;
  assert.deepEqual(curved.bulges, [1, 0]);
  const [first, second] = polylineSegments(curved);
  assert.equal(first.index, 0);
  assert.deepEqual(first.arc.center, { x: 0, y: 0 });
  assert.equal(first.arc.radius, 100);
  assert.equal(first.arc.sweep, Math.PI);
  assert.deepEqual(polylineArcPoint(first.arc, 0.5), { x: 0, y: -100 });
  assert.equal(second.arc, null);
  const closing = createPolyline("closed-curve", vertices, { closed: true, bulges: [0, 0, -1] });
  assert.equal(polylineSegments(closing)[2].arc.sweep, -Math.PI);
  assert.deepEqual(polylineSegments(closing)[2].p2, vertices[0]);
  for (const invalid of [[1], [1, -Infinity], [NaN, 0], Array(2), [null, 0], [1e100, 0]]) {
    assert.equal(validPolylinePoints(vertices, false, invalid), false);
  }
  assert.equal(createPolyline("straight", vertices, { bulges: [0, -0] }).bulges, undefined);
});

test("bounds include major arc extrema between all defining points", () => {
  const side = 100 / Math.SQRT2;
  const major = createPolyline("major", [{ x: side, y: side }, { x: side, y: -side }], { bulges: [Math.tan(3 * Math.PI / 8)] });
  const expected = { minX: -100, minY: -100, maxX: side, maxY: 100 };
  for (const [key, actual] of Object.entries(polylineBounds(major))) {
    assert.ok(Math.abs(actual - expected[key]) < 1e-9, `${key} was ${actual}`);
  }
});

test("two vertices may close a D or a two-arc loop while straight and retraced loops stay invalid", () => {
  const diameter = [{ x: -100, y: 0 }, { x: 100, y: 0 }];
  const d = createPolyline("d", diameter, { closed: true, bulges: [1, 0] });
  const loop = createPolyline("loop", diameter, { closed: true, bulges: [1, 1] });
  assert.deepEqual(polylineBounds(d), { minX: -100, minY: -100, maxX: 100, maxY: 0 });
  assert.deepEqual(polylineBounds(loop), { minX: -100, minY: -100, maxX: 100, maxY: 100 });
  assert.equal(createPolyline("straight", diameter, { closed: true, bulges: [0, 0] }), null);
  assert.equal(createPolyline("retraced", diameter, { closed: true, bulges: [1, -1] }), null);
  const legacy = [];
  appendDxfPolyline(legacy, d, "measure");
  assert.deepEqual(legacy, []);
  for (const writer of [buildDxf, buildRevitDxf]) {
    const dxf = writer([d, loop]);
    assert.equal(dxf.match(/\n0\nLWPOLYLINE\n/g)?.length, 2);
    assert.equal(dxf.match(/\n90\n2\n70\n1\n/g)?.length, 2);
    assert.equal(dxf.match(/\n42\n-1\n/g)?.length, 3);
  }
});

test("exports native LWPOLYLINE objects with vertex coordinates and closure flags", () => {
  const open = createPolyline("open", [{ x: 0.0001, y: 0 }, { x: 0.0002, y: -0.0001 }]);
  const closed = createPolyline("closed", points, { closed: true, layer: "walls" });
  const dxf = buildDxf([open, closed]);
  assert.match(dxf, /\n8\nmeasure\n100\nAcDbPolyline\n90\n2\n70\n0\n10\n0\.0001\n20\n0\n10\n0\.0002\n20\n0\.0001\n/);
  assert.match(dxf, /\n8\nwalls\n100\nAcDbPolyline\n90\n3\n70\n1\n10\n-2\.5\n20\n-8\n10\n100\n20\n-8\n10\n100\n20\n70\n/);
  assert.equal(dxf.match(/\n0\nLWPOLYLINE\n/g)?.length, 2);
  assert.doesNotMatch(dxf, /\n0\n(?:LINE|POLYLINE|VERTEX|SEQEND)\n/);
  assert.match(buildRevitDxf([closed]), /\n8\nZAMER_WALLS\n100\nAcDbPolyline\n90\n3\n70\n1\n/);
});
