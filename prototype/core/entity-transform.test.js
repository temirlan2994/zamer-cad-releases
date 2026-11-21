import test from "node:test";
import assert from "node:assert/strict";
import { scaleStoredEntity } from "./entity-transform.js";

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
  assert.deepEqual(scaleStoredEntity({ id: "t", type: "text", x: 200, y: 200, height: 20 }, base, 2),
    { id: "t", type: "text", x: 300, y: 300, height: 40 });
});

test("rejects invalid scale factors without mutating the source", () => {
  const entity = { id: "line", type: "line", x1: 0, y1: 0, x2: 10, y2: 10 };
  assert.equal(scaleStoredEntity(entity, { x: 0, y: 0 }, 0), null);
  assert.equal(scaleStoredEntity(entity, { x: 0, y: 0 }, Number.NaN), null);
  assert.deepEqual(entity, { id: "line", type: "line", x1: 0, y1: 0, x2: 10, y2: 10 });
});
