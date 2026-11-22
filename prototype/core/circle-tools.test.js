import test from "node:test";
import assert from "node:assert/strict";
import { diameterCircle, tangentRadiusCircle, threePointCircle } from "./circle-tools.js";

const point = (x, y) => ({ x, y });
const line = (x1, y1, x2, y2) => ({ x1, y1, x2, y2 });

test("diameter endpoints create a circle at the midpoint and reject duplicate or unbounded results", () => {
  assert.deepEqual(diameterCircle(point(-1500, 600), point(2900, 600)), { cx: 700, cy: 600, radius: 2200 });
  assert.equal(diameterCircle(point(0, 0), point(0, 0)), null);
  assert.equal(diameterCircle(point(-1e12, 1e12), point(1e12, 1e12)), null);
});

test("all three noncollinear points are on the circumference, even near large translated coordinates", () => {
  const offset = 999_999_000_000;
  const circle = threePointCircle(point(offset - 120, offset), point(offset, offset - 120), point(offset + 120, offset));
  assert.deepEqual(circle, { cx: offset, cy: offset, radius: 120 });
  assert.equal(threePointCircle(point(0, 0), point(1000, 1000), point(2000, 2000)), null);
});

test("tangent circle fits two perpendicular finite edges and won't extend them past their endpoints", () => {
  const horizontal = line(0, 0, 4000, 0);
  const vertical = line(0, 0, 0, 3000);
  const picks = [point(500, 0), point(0, 500)];
  assert.deepEqual(tangentRadiusCircle(horizontal, vertical, 500, ...picks), {
    cx: 500, cy: 500, radius: 500, contacts: picks,
  });
  assert.equal(tangentRadiusCircle(horizontal, line(0, 1000, 0, 3000), 500, ...picks), null);
  assert.equal(tangentRadiusCircle(horizontal, vertical, 0, ...picks), null);
});

test("parallel edges accept exactly half the spacing and pick a center in the shared range", () => {
  const lower = line(0, 0, 5000, 0);
  const upper = line(4500, 1000, 900, 1000);
  const picks = [point(1600, 0), point(2400, 1000)];
  assert.deepEqual(tangentRadiusCircle(lower, upper, 500, ...picks), {
    cx: 2000, cy: 500, radius: 500, contacts: [point(2000, 0), point(2000, 1000)],
  });
  assert.equal(tangentRadiusCircle(lower, upper, 501, ...picks), null);
  assert.equal(tangentRadiusCircle(lower, lower, 500, ...picks), null);
});

test("tangent circles support circle and arc boundaries and validate the selected sweep", () => {
  const base = line(-5000, 0, 5000, 0);
  const circle = { type: "circle", cx: 0, cy: 3000, radius: 1000 };
  const picks = [point(0, 0), point(0, 2000)];
  const expected = { cx: 0, cy: 1000, radius: 1000, contacts: picks };
  assert.deepEqual(tangentRadiusCircle(base, circle, 1000, ...picks), expected);
  const start = point(-1000, 3000);
  const end = point(1000, 3000);
  assert.deepEqual(tangentRadiusCircle(base, { type: "arc", start, through: point(0, 2000), end }, 1000, ...picks), expected);
  assert.equal(tangentRadiusCircle(base, { type: "arc", start, through: point(0, 4000), end }, 1000, ...picks), null);
  assert.deepEqual(tangentRadiusCircle({ type: "circle", cx: -1000, cy: 0, radius: 500 },
    { type: "circle", cx: 1000, cy: 0, radius: 500 }, 500, point(-500, 0), point(500, 0)), {
    cx: 0, cy: 0, radius: 500, contacts: [point(-500, 0), point(500, 0)],
  });
});

test("concentric arc supports can meet in their common sweep when the picked points are outside it", () => {
  const onCircle = (r, degrees) => point(r * Math.cos(degrees * Math.PI / 180), r * Math.sin(degrees * Math.PI / 180));
  const arc = (r, a, b) => ({ type: "arc", start: onCircle(r, a), through: onCircle(r, (a + b) / 2), end: onCircle(r, b) });
  const circle = tangentRadiusCircle(arc(1000, 0, 90), arc(2000, 45, 135), 500, onCircle(1000, 15), onCircle(2000, 120));
  assert.equal(circle?.radius, 500);
  const centerAngle = Math.atan2(circle.cy, circle.cx) * 180 / Math.PI;
  assert.ok(centerAngle >= 45 - 1e-8 && centerAngle <= 90 + 1e-8);
  assert.ok(Math.abs(Math.hypot(circle.cx, circle.cy) - 1500) < 1e-8);
});
