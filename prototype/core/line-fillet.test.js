import test from "node:test";
import assert from "node:assert/strict";
import { arcGeometry } from "./geometry.js";
import { filletLines, filletSelectedCorners, filletSelectedPair } from "./line-fillet.js";

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

test("fillet retains the requested radius at small sizes, shallow deflection and large coordinate offsets", () => {
  for (const [origin, deflection, radius, tolerance] of [
    [0, 90, 0.00025, 1e-10],
    [0, 0.2, 100, 1e-5],
    [1e9, 90, 100, 1e-5],
  ]) {
    const angle = (180 - deflection) * Math.PI / 180;
    const first = { x1: origin, y1: origin, x2: origin + 1000, y2: origin };
    const second = { x1: origin, y1: origin, x2: origin + Math.cos(angle) * 1000, y2: origin + Math.sin(angle) * 1000 };
    const result = filletLines(first, second, { x: first.x2, y: first.y2 }, { x: second.x2, y: second.y2 }, radius);
    assert.ok(result?.arc, `Radius ${radius} at ${origin} and ${deflection}°`);
    const actual = arcGeometry(result.arc.start, result.arc.through, result.arc.end).radius;
    assert.ok(Math.abs(actual - radius) < tolerance, `${actual} ≈ ${radius}`);
  }
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

test("zero-radius fillet cannot extend a leg outside the supported drawing coordinates", () => {
  const first = { x1: 0, y1: 0, x2: 1000, y2: 0 };
  const second = { x1: 0, y1: 1e6, x2: 1000, y2: 1e6 - 0.0005 };
  assert.equal(filletLines(first, second, { x: 500, y: 0 }, { x: 500, y: 1e6 }, 0), null);
});

test("preselected segments use their outer ends when only the second leg was tapped", () => {
  const first = { x1: 300, y1: 0, x2: 0, y2: 0 };
  const second = { x1: 0, y1: 0, x2: 0, y2: 400 };
  const result = filletSelectedPair(first, second, 100, { x: 5, y: 200 });
  assert.deepEqual(result.first, { ...first, x2: 100 });
  assert.deepEqual(result.second, { ...second, y1: 100 });
});

test("batch fillets preserve both trims on a shared leg and reject overlapping trims atomically", () => {
  const first = { x1: -400, y1: 0, x2: 0, y2: 0 };
  const middle = { x1: 0, y1: 0, x2: 0, y2: 300 };
  const last = { x1: 0, y1: 300, x2: 400, y2: 300 };
  const result = filletSelectedCorners([last, first, middle], 100);
  assert.deepEqual(result.changes.get(middle), { x1: 0, y1: 100, x2: 0, y2: 200 });
  assert.equal(result.arcs.length, 2);
  assert.equal(filletSelectedCorners([first, middle, last], 160), null);
  const branch = { x1: 0, y1: 0, x2: 200, y2: -300 };
  assert.equal(filletSelectedCorners([first, branch, middle, last], 100).arcs.length, 1);
});
