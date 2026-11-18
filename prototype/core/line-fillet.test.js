import test from "node:test";
import assert from "node:assert/strict";
import { arcGeometry } from "./geometry.js";
import { filletLines } from "./line-fillet.js";

const near = (value, expected) => assert.ok(Math.abs(value - expected) < 1e-8, `${value} ≈ ${expected}`);

test("90° fillet keeps the picked legs and uses tangent arc endpoints", () => {
  const horizontal = { x1: -20, y1: 0, x2: 300, y2: 0 };
  const vertical = { x1: 0, y1: 350, x2: 0, y2: -30 };
  const result = filletLines(horizontal, vertical, { x: 250, y: 1 }, { x: 1, y: 250 }, 100);
  assert.deepEqual(result.first, { x1: 100, y1: 0, x2: 300, y2: 0 });
  assert.deepEqual(result.second, { x1: 0, y1: 350, x2: 0, y2: 100 });
  const { start, through, end } = result.arc;
  assert.deepEqual(start, { x: 100, y: 0 });
  assert.deepEqual(end, { x: 0, y: 100 });
  const geometry = arcGeometry(start, through, end);
  near(geometry.center.x, 100);
  near(geometry.center.y, 100);
  near(geometry.radius, 100);
  near(through.x, 100 - 100 / Math.sqrt(2));
  near(through.y, through.x);
});

test("zero-radius fillet extends missing legs into a sharp corner", () => {
  const horizontal = { x1: 20, y1: 10, x2: 250, y2: 10 };
  const vertical = { x1: 0, y1: 230, x2: 0, y2: 35 };
  assert.deepEqual(filletLines(horizontal, vertical, { x: 100, y: 10 }, { x: 0, y: 150 }, 0), {
    first: { x1: 0, y1: 10, x2: 250, y2: 10 },
    second: { x1: 0, y1: 230, x2: 0, y2: 10 },
    arc: null,
  });
});

test("fillet handles an oblique corner and keeps the selected negative ray", () => {
  const horizontal = { x1: -800, y1: 0, x2: 300, y2: 0 };
  const diagonal = { x1: 600, y1: 600, x2: -20, y2: -20 };
  const result = filletLines(horizontal, diagonal, { x: -500, y: 0 }, { x: 400, y: 400 }, 100);
  const { start, through, end } = result.arc;
  const geometry = arcGeometry(start, through, end);
  near(geometry.radius, 100);
  near(geometry.center.x, start.x);
  near((geometry.center.x - end.x) + (geometry.center.y - end.y), 0);
  assert.equal(result.first.x1, -800);
  assert.equal(result.second.x1, 600);
});

test("fillet rejects invalid picks, parallel lines and radii that consume a leg", () => {
  const horizontal = { x1: 0, y1: 0, x2: 100, y2: 0 };
  const vertical = { x1: 0, y1: 0, x2: 0, y2: 300 };
  const parallel = { x1: 0, y1: 10, x2: 100, y2: 10 };
  const a = { x: 90, y: 0 };
  const b = { x: 0, y: 150 };
  assert.equal(filletLines(horizontal, parallel, a, b, 1), null);
  for (const radius of [-1, NaN, Infinity, 100, 101]) {
    assert.equal(filletLines(horizontal, vertical, a, b, radius), null);
  }
  assert.equal(filletLines(horizontal, vertical, { x: -50, y: 0 }, b, 20), null);
  assert.equal(filletLines({ ...horizontal, x1: -100 }, vertical, { x: 0, y: 0 }, b, 20), null);
  assert.equal(filletLines(horizontal, vertical, null, b, 15), null);
  assert.ok(filletLines(horizontal, vertical, { x: 0, y: 0 }, b, 20));
});
