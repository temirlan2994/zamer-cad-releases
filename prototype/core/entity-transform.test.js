import test from "node:test";
import assert from "node:assert/strict";
import { rotateStoredEntity, scaleStoredEntity } from "./entity-transform.js";

test("scales line and wall geometry around the supplied base point", () => {
  const wall = { id: "wall", type: "wall", x1: 10, y1: 20, x2: 30, y2: 40, width: 180 };
  assert.deepEqual(scaleStoredEntity(wall, { x: 10, y: 10 }, 2),
    { ...wall, x1: 10, y1: 30, x2: 50, y2: 70, width: 360 });
  assert.equal(wall.width, 180);
});

test("scales polyline, circle, block, and text sizes", () => {
  const base = { x: 100, y: 100 };
  assert.deepEqual(scaleStoredEntity({ id: "p", type: "polyline", points: [{ x: 100, y: 100 }, { x: 200, y: 100 }] }, base, 0.5).points,
    [{ x: 100, y: 100 }, { x: 150, y: 100 }]);
  assert.deepEqual(scaleStoredEntity({ id: "c", type: "circle", cx: 200, cy: 100, radius: 50 }, base, 2),
    { id: "c", type: "circle", cx: 300, cy: 100, radius: 100 });
  assert.deepEqual(scaleStoredEntity({ id: "b", type: "block", x: 200, y: 200, width: 80, height: 40 }, base, 2),
    { id: "b", type: "block", x: 300, y: 300, width: 160, height: 80 });
  assert.deepEqual(scaleStoredEntity({ id: "t", type: "text", x: 200, y: 200, height: 20, textWidth: 120 }, base, 2),
    { id: "t", type: "text", x: 300, y: 300, height: 40, textWidth: 240 });
});

test("rejects invalid scale factors without mutating the source", () => {
  const entity = { id: "line", type: "line", x1: 0, y1: 0, x2: 10, y2: 10 };
  assert.equal(scaleStoredEntity(entity, { x: 0, y: 0 }, 0), null);
  assert.equal(scaleStoredEntity(entity, { x: 0, y: 0 }, Number.NaN), null);
  assert.deepEqual(entity, { id: "line", type: "line", x1: 0, y1: 0, x2: 10, y2: 10 });
});

test("rotates independent line, circle, text, and block copies around one shared base", () => {
  const base = { x: 10, y: 10 };
  const line = { id: "line", type: "line", x1: 20, y1: 10, x2: 30, y2: 10 };
  assert.deepEqual(rotateStoredEntity(line, base, Math.PI / 2),
    { ...line, x1: 10, y1: 20, x2: 10.000000000000002, y2: 30 });
  assert.deepEqual(rotateStoredEntity({ id: "circle", type: "circle", cx: 20, cy: 10, radius: 5 }, base, Math.PI / 2),
    { id: "circle", type: "circle", cx: 10, cy: 20, radius: 5 });
  assert.deepEqual(rotateStoredEntity({ id: "text", type: "text", x: 20, y: 10, rotation: 350 }, base, Math.PI / 2),
    { id: "text", type: "text", x: 10, y: 20, rotation: 80 });
  assert.deepEqual(rotateStoredEntity({ id: "block", type: "block", x: 0, y: 10 }, base, -Math.PI / 2),
    { id: "block", type: "block", x: 10, y: 20, rotation: 270 });
  assert.deepEqual(line, { id: "line", type: "line", x1: 20, y1: 10, x2: 30, y2: 10 });
});

test("rotating a rectangle preserves all four corners as an editable closed polyline", () => {
  const rectangle = { id: "rect", type: "rectangle", x1: 0, y1: 0, x2: 20, y2: 10, layer: "walls" };
  const rotated = rotateStoredEntity(rectangle, { x: 10, y: 5 }, Math.PI / 2);
  assert.equal(rotated.type, "polyline");
  assert.equal(rotated.closed, true);
  assert.deepEqual(rotated.points, [
    { x: 15, y: -5 }, { x: 15, y: 15 }, { x: 5, y: 15 }, { x: 5, y: -5 },
  ]);
  assert.equal("x1" in rotated, false);
});

test("rotation rejects invalid input and keeps nested contour geometry independent", () => {
  const zone = { id: "zone", type: "plan-zone", points: [{ x: 0, y: 0 }], contours: [[{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 0, y: 2 }]] };
  assert.equal(rotateStoredEntity(zone, { x: 0, y: 0 }, Number.NaN), null);
  const rotated = rotateStoredEntity(zone, { x: 0, y: 0 }, Math.PI);
  assert.deepEqual(rotated.points, rotated.contours[0]);
  assert.notEqual(rotated.points, zone.points);
  assert.deepEqual(zone.contours[0][1], { x: 2, y: 0 });
});
