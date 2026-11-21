import test from "node:test";
import assert from "node:assert/strict";
import { draftArcFromBend, editableFigure, extendFigure, figureGripPoints, figureReferenceAt, figureReferencePoint, reshapeFigure, splitFigure, trimFigure, validFigurePiece } from "./figure-edits.js";
import { arcGeometry } from "./geometry.js";
import { polylineSegments } from "./polyline.js";

const point = (x, y) => ({ x, y });
const edge = (x1, y1, x2, y2) => ({ x1, y1, x2, y2 });
const polyline = (points, closed = false) => ({ type: "polyline", points, closed });
const near = (actual, expected) => assert.ok(Math.hypot(actual.x - expected.x, actual.y - expected.y) < 1e-7,
  `${JSON.stringify(actual)} is not near ${JSON.stringify(expected)}`);

test("arc drafts reject a flat bend and a radius outside the drawing range", () => {
  const start = point(0, 0);
  const end = point(1000, 0);
  assert.equal(draftArcFromBend(start, end, point(500, 0)), null);
  assert.equal(draftArcFromBend(start, end, point(500, 1e-9)), null);
  const diagonalEnd = point(839.12, 1362.29);
  assert.equal(draftArcFromBend(start, diagonalEnd, point(839.12, 1362.29 + 1e-12)), null);
});

test("arc draft radius and sweep remain usable for shallow, reflected and major bends", () => {
  for (const height of [0.1, -0.1, 500, -850]) {
    const { arc } = draftArcFromBend(point(0, 0), point(1000, 0), point(750, height));
    near(arc.through, point(500, height));
    assert.ok(Math.abs(arc.radius - (500 ** 2 + height ** 2) / (2 * Math.abs(height))) < 1e-6);
    assert.ok(Math.abs(arc.sweep + 4 * Math.atan(height / 500)) < 1e-12);
    assert.ok(validFigurePiece(arc));
  }
});

test("trim can remove a bend between two cuts without breaking unaffected segments", () => {
  const chain = polyline([point(0, 0), point(100, 0), point(100, 100), point(200, 100)]);
  assert.deepEqual(trimFigure(chain, [edge(40, -10, 40, 10), edge(80, 80, 120, 80)], point(95, 40)), [
    polyline([point(0, 0), point(40, 0)]),
    polyline([point(100, 80), point(100, 100), point(200, 100)]),
  ]);
});

test("trim opens a rectangle while retaining its other edges in order", () => {
  const section = { type: "rectangle", ...edge(0, 0, 100, 100) };
  const cutters = [edge(30, -10, 30, 20), edge(70, -10, 70, 20)];
  assert.deepEqual(trimFigure(section, cutters, point(50, 0)), [
    polyline([point(70, 0), point(100, 0), point(100, 100), point(0, 100), point(0, 0), point(30, 0)]),
  ]);
  assert.equal(trimFigure(section, cutters.slice(0, 1), point(50, 0)), null);
});

test("trim opens a circle at exact intersections and keeps the opposite span", () => {
  const circle = { type: "circle", cx: 0, cy: 0, radius: 100 };
  const [arc] = trimFigure(circle, [edge(0, -200, 0, 200)], point(100, 0));
  near(arc.start, point(0, -100));
  near(arc.through, point(-100, 0));
  near(arc.end, point(0, 100));
  const geometry = arcGeometry(arc.start, arc.through, arc.end);
  near(geometry.center, point(0, 0));
  assert.equal(editableFigure(circle, "extend"), false);
  assert.equal(trimFigure(circle, [edge(100, -200, 100, 200)], point(0, 100)), null);
});

test("extend only changes the chosen open polyline end or the chosen arc endpoint", () => {
  const chain = polyline([point(0, 0), point(100, 0), point(100, 100)]);
  assert.deepEqual(extendFigure(chain, [edge(20, 140, 160, 140)], point(100, 95)),
    polyline([point(0, 0), point(100, 0), point(100, 140)]));
  assert.equal(extendFigure({ ...chain, closed: true }, [], point(100, 100)), null);
  const arc = { type: "arc", start: point(100, 0), through: point(0, -100), end: point(-100, 0) };
  const extended = extendFigure(arc, [edge(0, 40, 0, 120)], point(-99, -3));
  near(extended.start, arc.start);
  near(extended.end, point(0, 100));
  near(arcGeometry(extended.start, extended.through, extended.end).center, point(0, 0));
});

test("break follows a closed path and preserves independent references on retained pieces", () => {
  const circle = { type: "circle", cx: 0, cy: 0, radius: 100 };
  const [arc] = splitFigure(circle, point(100, 0), point(0, -100));
  near(arc.start, point(0, -100));
  near(arc.end, point(100, 0));
  assert.equal(splitFigure(circle, point(100, 0)), null);
  const arcRef = figureReferenceAt(arc, point(-100, 0));
  assert.equal(arcRef.pointKey, "arc-fraction");
  near(figureReferencePoint(arc, arcRef), point(-100, 0));
  assert.equal(figureReferenceAt(arc, point(70.710678, -70.710678)), null);
  const chain = polyline([point(0, 0), point(100, 0), point(100, 100), point(200, 100)]);
  const [first, second] = splitFigure(chain, point(100, 15), point(100, 30));
  assert.deepEqual(first, polyline([point(0, 0), point(100, 0), point(100, 15)]));
  assert.deepEqual(second, polyline([point(100, 30), point(100, 100), point(200, 100)]));
  const edgeRef = figureReferenceAt(second, point(100, 60));
  assert.equal(edgeRef.pointKey, "edge-fraction");
  near(figureReferencePoint(second, edgeRef), point(100, 60));
});

test("trim slices a bulged edge at exact crossings and leaves the straight remainder joined", () => {
  const chain = { ...polyline([point(-100, 0), point(100, 0), point(180, 0)]), bulges: [1, 0] };
  const cutters = [edge(0, -120, 0, -20), edge(50, -120, 50, -20)];
  const [first, second] = trimFigure(chain, cutters, point(25, -99));
  const firstEdge = polylineSegments(first)[0];
  const [secondEdge, straight] = polylineSegments(second);
  near(firstEdge.p2, point(0, -100));
  near(secondEdge.p1, point(50, -Math.sqrt(7500)));
  near(firstEdge.arc.center, point(0, 0));
  near(secondEdge.arc.center, point(0, 0));
  assert.equal(straight.arc, null);
  assert.deepEqual(straight.p2, point(180, 0));
  const base = point(-100 / Math.SQRT2, -100 / Math.SQRT2);
  const ref = figureReferenceAt(first, base);
  near(figureReferencePoint(first, ref), base);
  assert.equal(figureReferenceAt(first, point(-50, -50)), null);
  assert.equal(trimFigure(chain, [edge(0, 1, 0, 50)], point(0, -100)), null);
});

test("break retains curved segments and explicitly clears bulges on a remaining straight-only piece", () => {
  const chain = { ...polyline([point(-100, 0), point(100, 0), point(180, 0)]), bulges: [1, 0] };
  const [first, second] = splitFigure(chain, point(0, -100));
  for (const piece of [first, second]) {
    const arc = polylineSegments(piece)[0].arc;
    near(arc.center, point(0, 0));
    assert.ok(Math.abs(arc.sweep - Math.PI / 2) < 1e-9);
  }
  const [straight] = trimFigure(chain, [edge(125, -50, 125, 50)], point(0, -100));
  assert.deepEqual(straight, polyline([point(125, 0), point(180, 0)]));
});

test("extend follows the terminal edge's circle instead of its chord", () => {
  const chain = { ...polyline([point(200, 0), point(100, 0), point(-100, 0)]), bulges: [0, -1] };
  const changed = extendFigure(chain, [edge(0, 40, 0, 120)], point(-99, -3));
  const [straight, curved] = polylineSegments(changed);
  assert.deepEqual(straight.p1, point(200, 0));
  assert.deepEqual(straight.p2, point(100, 0));
  assert.equal(straight.arc, null);
  near(curved.p2, point(0, 100));
  near(curved.arc.center, point(0, 0));
  assert.ok(Math.abs(curved.arc.sweep + 3 * Math.PI / 2) < 1e-9);
});

test("trim opens a two-vertex D path and keeps both surviving curved portions joined by the chord", () => {
  const d = { ...polyline([point(-100, 0), point(100, 0)], true), bulges: [1, 0] };
  const [cut] = trimFigure(d, [edge(-120, -50, 120, -50)], point(0, -100));
  assert.equal(cut.closed, false);
  const [first, chord, last] = polylineSegments(cut);
  near(first.p1, point(Math.sqrt(7500), -50));
  near(last.p2, point(-Math.sqrt(7500), -50));
  near(first.arc.center, point(0, 0));
  assert.equal(chord.arc, null);
  near(last.arc.center, point(0, 0));
});

test("figure grips change the intended geometry while rejecting a degenerate drag", () => {
  const circle = { type: "circle", cx: 0, cy: 0, radius: 100 };
  assert.deepEqual(reshapeFigure(circle, figureGripPoints(circle)[0], point(0, 175)), { radius: 175 });
  assert.equal(reshapeFigure(circle, { key: "radius" }, point(0, 0)), null);

  const rectangle = { type: "rectangle", ...edge(0, 0, 100, 100) };
  assert.deepEqual(reshapeFigure(rectangle, figureGripPoints(rectangle)[1], point(150, -20)), { x2: 150, y1: -20 });
  assert.equal(reshapeFigure(rectangle, figureGripPoints(rectangle)[1], point(150, 100)), null);

  const arc = { type: "arc", start: point(-100, 0), through: point(0, -100), end: point(100, 0) };
  const [start, through, end] = figureGripPoints(arc);
  assert.deepEqual(reshapeFigure(arc, start, point(-120, 0)), { start: point(-120, 0) });
  assert.deepEqual(reshapeFigure(arc, through, point(0, -60)), { through: point(0, -60) });
  assert.deepEqual(reshapeFigure(arc, end, point(120, 0)), { end: point(120, 0) });
  assert.equal(reshapeFigure(arc, through, point(0, 0)), null);
});

test("moving a polyline bend preserves both endpoints and moving a vertex preserves original bulges", () => {
  const entity = { ...polyline([point(-100, 0), point(100, 0)], true), bulges: [1, 0] };
  const [vertex, , bend] = figureGripPoints(entity);
  assert.equal(bend.key, "bend");
  assert.deepEqual(reshapeFigure(entity, bend, point(13, -45)), { bulges: [0.45, 0] });
  assert.equal(reshapeFigure(entity, bend, point(0, 0)), null);
  assert.deepEqual(reshapeFigure(entity, vertex, point(-120, 0)), { points: [point(-120, 0), point(100, 0)] });
  assert.deepEqual(entity.bulges, [1, 0]);
});
