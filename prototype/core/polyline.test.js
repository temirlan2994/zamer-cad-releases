import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDxf, buildRevitDxf } from "./dxf.js";
import { createPolyline, polylineBounds, polylineSegments, validPolylinePoints } from "./polyline.js";

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
    { p1: points[0], p2: points[1] },
    { p1: points[1], p2: points[2] },
  ]);
  assert.deepEqual(polylineSegments(closed), [
    ...polylineSegments(open),
    { p1: points[2], p2: points[0] },
  ]);
  assert.deepEqual(polylineBounds(closed), { minX: -2.5, minY: -70, maxX: 100, maxY: 8 });
});

test("exports native R12 POLYLINE objects with vertex coordinates and closure flags", () => {
  const open = createPolyline("open", [{ x: 0.0001, y: 0 }, { x: 0.0002, y: -0.0001 }]);
  const closed = createPolyline("closed", points, { closed: true, layer: "walls" });
  const dxf = buildDxf([open, closed]);
  assert.match(dxf, /\n9\n\$ACADVER\n1\nAC1009\n/);
  assert.match(dxf, /\n0\nPOLYLINE\n8\nmeasure\n66\n1\n10\n0\n20\n0\n30\n0\n70\n0\n/);
  assert.match(dxf, /\n0\nPOLYLINE\n8\nwalls\n66\n1\n10\n0\n20\n0\n30\n0\n70\n1\n/);
  assert.match(dxf, /\n0\nVERTEX\n8\nmeasure\n10\n0\.0002\n20\n0\.0001\n30\n0\n/);
  assert.match(dxf, /\n0\nVERTEX\n8\nwalls\n10\n-2\.5\n20\n-8\n30\n0\n/);
  assert.equal(dxf.match(/\n0\nVERTEX\n/g)?.length, 5);
  assert.equal(dxf.match(/\n0\nSEQEND\n/g)?.length, 2);
  assert.doesNotMatch(dxf, /\n0\n(?:LINE|LWPOLYLINE)\n/);
  assert.match(buildRevitDxf([open]), /\n0\nPOLYLINE\n8\nZAMER_MEASURE\n/);
});
