import assert from "node:assert/strict";
import test from "node:test";
import { buildDxf } from "./dxf.js";
import { polylineSegments } from "./polyline.js";
import { validateZamerProject } from "./project-format.js";
import { createRevisionCloud, revisionCloudRectangle } from "./revision-cloud.js";

const corners = revisionCloudRectangle({ x: 0, y: 0 }, { x: 1200, y: 900 });

test("revision clouds scallop outwards in either winding and retain arcs in native and DXF exports", () => {
  for (const ring of [corners, [...corners].reverse()]) {
    const cloud = createRevisionCloud("cloud", ring, 300);
    assert.equal(cloud.revisionCloud, true);
    assert.equal(cloud.closed, true);
    assert.equal(cloud.points.length, 14);
    const segments = polylineSegments(cloud);
    assert.ok(segments.every(({ arc }) => arc));
    assert.ok(segments.filter(({ p1, p2 }) => p1.y === 0 && p2.y === 0).every(({ arc }) => arc.through.y < 0));
    assert.deepEqual(validateZamerProject(JSON.parse(JSON.stringify({ entities: [cloud] }))).entities[0], cloud);
    assert.match(buildDxf([cloud]), /LWPOLYLINE/);
  }
});

test("degenerate and crossing outlines are rejected and large outlines keep a bounded arc count", () => {
  assert.equal(createRevisionCloud("flat", revisionCloudRectangle({ x: 0, y: 0 }, { x: 0, y: 900 }), 300), null);
  assert.equal(createRevisionCloud("crossing", [corners[0], corners[2], corners[1], corners[3]], 300), null);
  const large = createRevisionCloud("large", revisionCloudRectangle({ x: 0, y: 0 }, { x: 1000000, y: 900000 }), 1);
  assert.ok(large.points.length > 400 && large.points.length <= 512);
});
