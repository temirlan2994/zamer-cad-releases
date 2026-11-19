import test from "node:test";
import assert from "node:assert/strict";
import { planAnnotationGeometry } from "./plan-annotations.js";
import { planRegionAtPoint } from "./plan-region.js";

const line = (x1, y1, x2, y2) => ({ type: "line", layer: "measure", x1, y1, x2, y2 });
const areaAt = (entities, x, y) => planAnnotationGeometry({ type: "area", points: planRegionAtPoint({ x, y }, entities) })?.areaM2;

test("traces the face at the tap from joined line segments, with T-junctions and dead ends", () => {
  const edges = [line(0, 0, 4000, 0), line(4000, 3000, 4000, 0), line(4000, 3000, 0, 3000), line(0, 0, 0, 3000),
    line(1500, 0, 1500, 3000), line(4000, 1200, 2500, 1200)];
  assert.equal(areaAt(edges, 900, 900), 4.5);
  assert.equal(areaAt(edges, 3000, 1600), 7.5);
  assert.equal(areaAt(edges, 4300, 1600), undefined);
  assert.equal(areaAt(edges.slice(0, 3), 900, 900), undefined);
});

test("splits a rectangle across an open polyline and ignores measurement marks", () => {
  const rectangle = { type: "rectangle", x1: 0, y1: 0, x2: 6000, y2: 3000 };
  const partition = { type: "polyline", closed: false, points: [{ x: 2000, y: 0 }, { x: 2000, y: 1000 }, { x: 4000, y: 3000 }] };
  const guide = { ...line(0, 500, 6000, 500), layer: "dimensions" };
  assert.equal(areaAt([rectangle, partition, guide], 500, 200), 8);
  assert.equal(areaAt([rectangle, partition, guide], 5000, 200), 10);
});

test("coincident partial edges are merged and small floating-point endpoint differences are joined", () => {
  const edges = [line(0, 0, 2000, 0), line(250, 0, 1750, 0), line(2000.001, 0, 2000, 1000),
    line(2000, 1000, 0, 1000), line(0, 1000, 0.002, 0)];
  assert.equal(areaAt(edges, 1000, 500), 2);
});
