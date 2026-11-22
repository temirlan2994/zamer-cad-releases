import test from "node:test";
import assert from "node:assert/strict";
import { pointInPolygon } from "./geometry.js";
import { createPlanAnnotation, formatPlanArea, formatPlanElevation, MAX_PLAN_ANNOTATION_POINTS,
  normalizePlanAnnotation, PLAN_ELEVATION_STYLES, planAnnotationAnchors, planAnnotationGeometry,
  planAnnotationPointsFromEntity, tessellatePolyline, totalPlanAreaM2 } from "./plan-annotations.js";

function rectangle(minX, minY, maxX, maxY) {
  return [{ x: minX, y: minY }, { x: maxX, y: minY }, { x: maxX, y: maxY }, { x: minX, y: maxY }];
}

test("area stores an independent closed polygon in millimeters and derives its area", () => {
  const points = rectangle(-1000, -2000, 2000, 2000);
  const annotated = createPlanAnnotation("area-1", "area", [...points, points[0]], { label: " Комната " });
  assert.deepEqual(annotated, { id: "area-1", type: "area", layer: "areas", points, label: "Комната" });
  const { areaMm2, areaM2, anchor, bounds } = planAnnotationGeometry(annotated);
  assert.equal(areaMm2, 12_000_000);
  assert.equal(areaM2, 12);
  assert.deepEqual(anchor, { x: 500, y: 0 });
  assert.deepEqual(bounds, { minX: -1000, minY: -2000, maxX: 2000, maxY: 2000 });
  points[0].x = 100;
  assert.equal(annotated.points[0].x, -1000);
});

test("one annotation reports the sum of disconnected contours and picks an interior label ring", () => {
  const first = rectangle(0, 0, 1000, 1000);
  const second = rectangle(3000, 0, 5000, 2000);
  const annotation = createPlanAnnotation("combined", "area", first, { contours: [first, second] });
  assert.notEqual(annotation.points, first);
  assert.equal(annotation.points, annotation.contours[0]);
  const geometry = planAnnotationGeometry(annotation);
  assert.equal(geometry.areaM2, 5);
  assert.deepEqual(geometry.bounds, { minX: 0, minY: 0, maxX: 5000, maxY: 2000 });
  assert.deepEqual(geometry.anchor, { x: 4000, y: 1000 });
  assert.deepEqual(geometry.anchorBounds, geometry.rings[1].bounds);
  assert.deepEqual(normalizePlanAnnotation(JSON.parse(JSON.stringify(annotation))), annotation);
  for (const changed of [rectangle(500, 500, 2000, 2000), rectangle(1000, 0, 2000, 1000), rectangle(200, 200, 300, 300), first]) {
    assert.equal(createPlanAnnotation("overlap", "area", first, { contours: [first, changed] }), null);
  }
  assert.equal(normalizePlanAnnotation({ ...annotation, points: second }), null);
});

test("project total sums every specified area and ignores elevations or invalid geometry", () => {
  const room = createPlanAnnotation("room", "area", rectangle(0, 0, 2000, 3000));
  const first = rectangle(3000, 0, 4000, 1000);
  const second = rectangle(5000, 0, 7000, 2000);
  const combined = createPlanAnnotation("combined", "area", first, { contours: [first, second] });
  const elevation = createPlanAnnotation("height", "elevation", rectangle(0, 0, 9000, 9000), { height: 2800 });
  assert.equal(totalPlanAreaM2([room, combined, elevation, { type: "area", points: [] }, null]), 11);
  assert.equal(totalPlanAreaM2([]), 0);
});

test("concave contours keep the label strictly inside when the centroid falls in the notch", () => {
  const points = [[0, 0], [6000, 0], [6000, 6000], [4500, 6000], [4500, 1500], [1500, 1500], [1500, 6000], [0, 6000]]
    .map(([x, y]) => ({ x, y }));
  assert.equal(pointInPolygon({ x: 3000, y: 2500 }, points), false);
  for (const contour of [points, points.slice().reverse()]) {
    const geometry = planAnnotationGeometry({ type: "area", points: contour });
    assert.equal(geometry.areaM2, 22.5);
    assert.ok(pointInPolygon(geometry.anchor, contour));
  }
});

test("a small contour far from origin retains its dimensions", () => {
  const minimum = 999_999_999_900;
  const points = rectangle(minimum, minimum, minimum + 20, minimum + 5);
  const geometry = planAnnotationGeometry({ type: "elevation", points });
  assert.equal(geometry.areaMm2, 100);
  assert.deepEqual(geometry.anchor, { x: minimum + 10, y: minimum + 2.5 });
});

test("rejects zero-area rings, self-intersection, repeating edges and non-finite vertices", () => {
  const a = { x: 0, y: 0 };
  const b = { x: 80, y: 80 };
  const c = { x: 0, y: 80 };
  const d = { x: 100, y: 0 };
  for (const points of [[], [a, b], [a, b, c, d], [a, b, a, c], [a, b, { x: 40, y: 40 }, d],
    [a, b, { x: 160, y: 160 }], [a, { x: NaN, y: 0 }, b], [a, b, null], Array(MAX_PLAN_ANNOTATION_POINTS + 2).fill(a)]) {
    assert.equal(createPlanAnnotation("bad", "area", points), null);
  }
});

test("validation checks the current vertices after an unsuccessful close on a mutable draft", () => {
  const points = [{ x: 0, y: 0 }, { x: 100, y: 0 }];
  assert.equal(createPlanAnnotation("draft", "area", points), null);
  points.push({ x: 100, y: 50 });
  assert.equal(planAnnotationGeometry(createPlanAnnotation("draft", "area", points)).areaMm2, 2500);
  points[2].y = 0;
  assert.equal(createPlanAnnotation("draft", "area", points), null);
});

test("zone styles persist signed and decimal Z, with zero treated as a valid datum", () => {
  const points = rectangle(0, 0, 1000, 1000);
  const ceiling = createPlanAnnotation("ceiling", "elevation", points, { height: 2780.125 });
  const beam = createPlanAnnotation("beam", "elevation", points, { height: -123.5, zoneStyle: "beam" });
  const datum = createPlanAnnotation("datum", "elevation", points, { height: -0, zoneStyle: "drop" });
  assert.equal(ceiling.layer, "elevations");
  assert.equal(ceiling.zoneStyle, "ceiling");
  assert.equal(beam.zoneStyle, "beam");
  assert.ok(Object.is(datum.height, 0));
  assert.equal(new Set(Object.values(PLAN_ELEVATION_STYLES).map(({ color }) => color)).size, 3);
  assert.equal(formatPlanElevation(ceiling.height), "+2780,125 мм");
  assert.equal(formatPlanElevation(beam.height), "-123,5 мм");
  assert.equal(formatPlanElevation(datum.height), "0 мм");
  assert.equal(formatPlanArea(12.345), "12,35 м²");
  assert.equal(formatPlanArea(0.002), "<0,01 м²");
  assert.equal(createPlanAnnotation("bad", "elevation", points), null);
  assert.equal(createPlanAnnotation("bad", "elevation", points, { height: Infinity }), null);
  assert.equal(createPlanAnnotation("bad", "elevation", points, { height: 100, zoneStyle: "floor" }), null);
  assert.equal(normalizePlanAnnotation({ ...ceiling, layer: "areas" }), null);
  assert.deepEqual(normalizePlanAnnotation({ ...ceiling, layer: undefined, zoneStyle: undefined }), ceiling);
});

test("an outer Z label avoids enclosed zones while each inner label remains independent", () => {
  const outer = createPlanAnnotation("ceiling", "elevation", rectangle(0, 0, 6000, 6000), { height: 2800 });
  const inner = createPlanAnnotation("beam", "elevation", rectangle(100, 100, 5900, 5900), { height: 2600, zoneStyle: "beam" });
  const other = createPlanAnnotation("drop", "elevation", rectangle(7500, 100, 9000, 1000), { height: -150, zoneStyle: "drop" });
  const room = createPlanAnnotation("area", "area", outer.points);
  const anchors = planAnnotationAnchors([outer, inner, other, room]);
  assert.equal(anchors.size, 4);
  assert.ok(pointInPolygon(anchors.get(outer.id), outer.points));
  assert.ok(!pointInPolygon(anchors.get(outer.id), inner.points));
  assert.deepEqual(anchors.get(inner.id), { x: 3000, y: 3000 });
  assert.deepEqual(anchors.get(other.id), { x: 8250, y: 550 });
  assert.deepEqual(anchors.get(room.id), { x: 3000, y: 3000 });
});

test("anchor and geometry caches follow point replacements, including an edited nested contour", () => {
  const outer = createPlanAnnotation("outer", "elevation", rectangle(0, 0, 4000, 4000), { height: 2800 });
  const inner = createPlanAnnotation("inner", "elevation", rectangle(1000, 1000, 3000, 3000), { height: 2500 });
  const geometry = planAnnotationGeometry(outer);
  assert.equal(planAnnotationGeometry({ ...outer }), geometry);
  const before = planAnnotationAnchors([outer, inner]);
  assert.equal(planAnnotationAnchors([{ ...outer, height: 2750 }, inner]), before);
  assert.ok(!pointInPolygon(before.get(outer.id), inner.points));
  inner.points = rectangle(0, 0, 800, 800);
  const after = planAnnotationAnchors([outer, inner]);
  assert.notEqual(after, before);
  assert.deepEqual(after.get(outer.id), geometry.anchor);
  assert.deepEqual(after.get(inner.id), { x: 400, y: 400 });
  outer.points = rectangle(0, 0, 3000, 2400);
  assert.notEqual(planAnnotationGeometry(outer), geometry);
  assert.equal(planAnnotationGeometry(outer).areaM2, 7.2);
});

test("closed polylines, rectangles and circles supply valid editable zone vertices", () => {
  const points = rectangle(10, 20, 3010, 4020);
  assert.deepEqual(planAnnotationPointsFromEntity({ type: "rectangle", x1: 10, y1: 20, x2: 3010, y2: 4020 }), points);
  const source = { type: "polyline", points, closed: true };
  const copy = planAnnotationPointsFromEntity(source);
  assert.deepEqual(copy, points);
  copy[0].y = 88;
  assert.equal(points[0].y, 20);
  assert.equal(planAnnotationPointsFromEntity({ ...source, closed: false }), null);
  assert.equal(planAnnotationPointsFromEntity({ type: "rectangle", x1: 1, y1: 2, x2: 1, y2: 5 }), null);
  const circle = planAnnotationPointsFromEntity({ type: "circle", cx: 100, cy: 200, radius: 2000 });
  const metrics = planAnnotationGeometry({ type: "area", points: circle });
  assert.ok(circle.length >= 64);
  assert.ok(Math.abs(metrics.areaM2 - Math.PI * 4) < 0.001);
  assert.ok(pointInPolygon(metrics.anchor, circle));
});

test("area conversion follows curved first and closing edges and keeps original vertices", () => {
  const points = rectangle(0, 0, 2000, 2000);
  const source = { type: "polyline", closed: true, points, bulges: [1, 0, 0, 0.414213562373095] };
  const sampled = planAnnotationPointsFromEntity(source);
  assert.ok(sampled.length > points.length);
  assert.deepEqual(sampled.filter((vertex) => points.some((point) => vertex.x === point.x && vertex.y === point.y)), points);
  const first = sampled.slice(1, sampled.findIndex(({ x, y }) => x === 2000 && y === 0));
  assert.ok(first.some(({ y }) => y < -999));
  const last = sampled.slice(sampled.findIndex(({ x, y }) => x === 0 && y === 2000) + 1);
  assert.ok(last.some(({ x }) => x < -400));
  const expected = 4 + Math.PI / 2 + (Math.PI / 2 - 1);
  const measured = planAnnotationGeometry({ type: "area", points: sampled }).areaM2;
  assert.ok(Math.abs(measured - expected) < 0.002);
  assert.equal(planAnnotationPointsFromEntity({ ...source, bulges: [1] }), null);
  assert.equal(planAnnotationPointsFromEntity({ ...source, closed: false, bulges: [1, 0, 0] }), null);
});

test("sampling an open mixed polyline keeps both joins and allocates available points across arcs", () => {
  const points = [{ x: 0, y: 0 }, { x: 2500, y: 0 }, { x: 5000, y: 0 }, { x: 7500, y: 0 }];
  const source = { type: "polyline", closed: false, points, bulges: [1, 0, -1] };
  const sampled = tessellatePolyline(source, 17);
  assert.equal(sampled.length, 17);
  assert.deepEqual(sampled.filter((vertex) => points.includes(vertex)), points);
  assert.ok(sampled.some(({ y }) => y < -1000));
  assert.ok(sampled.some(({ y }) => y > 1000));
  assert.equal(tessellatePolyline(source, 5), null);
});
