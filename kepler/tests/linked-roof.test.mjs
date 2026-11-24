import { test } from 'node:test';
import assert from 'node:assert/strict';

import { slopedRoofFaces } from '../core/linked-roof.js';

const rectGrid = (w = 6000, h = 4000) => ({
  xs: [0, w], ys: [0, h], nx: 1, ny: 1, mask: new Uint8Array([1]),
});

const topFaces = (faces) => faces.filter((face) => face.roofSurface === 'top');
const sideFaces = (faces) => faces.filter((face) => face.roofSurface === 'edge');
const close = (actual, expected, tolerance = 1e-6) => assert.ok(
  Math.abs(actual - expected) <= tolerance,
  `expected ${actual} to be within ${tolerance} of ${expected}`,
);

const area2d = (points) => Math.abs(points.reduce((sum, point, index) => {
  const next = points[(index + 1) % points.length];
  return sum + point.x * next.y - next.x * point.y;
}, 0)) / 2;

test('flat: old slab levels, outward normals, outline and drainage metadata', () => {
  const faces = slopedRoofFaces(rectGrid(), {
    type: 'flat', z: 3000, thickness: 250, autoRoofId: 'auto-roof:L1', roofSource: 'linked', level: 'L1',
  });

  assert.equal(topFaces(faces).length, 1);
  assert.equal(faces.filter((face) => face.roofSurface === 'bottom').length, 1);
  assert.equal(sideFaces(faces).length, 4);
  assert.ok(topFaces(faces)[0].pts.every((point) => point.z === 3250));
  assert.ok(faces.find((face) => face.roofSurface === 'bottom').pts.every((point) => point.z === 3000));
  assert.equal(topFaces(faces)[0].cutZ0, 3000);
  assert.equal(topFaces(faces)[0].normal.z, 1);
  assert.equal(faces.find((face) => face.roofSurface === 'bottom').normal.z, -1);
  assert.equal(topFaces(faces)[0].autoRoofId, 'auto-roof:L1');
  assert.equal(topFaces(faces)[0].roofSource, 'linked');
  assert.equal(topFaces(faces)[0].level, 'L1');
  assert.deepEqual(new Set(faces.drainageEdges.map((edge) => edge.side)), new Set(['n', 'e', 's', 'w']));
  assert.equal(topFaces(faces)[0].edges.length, 16);
  assert.equal(topFaces(faces)[0].drainageEdges.length, 4);
});

test('shed: cardinal direction is the low/drain side', () => {
  const pitchDeg = 30;
  const faces = slopedRoofFaces(rectGrid(), { type: 'shed', pitchDeg, direction: 's', z: 3000, thickness: 250 });
  const top = topFaces(faces)[0];
  const north = top.pts.filter((point) => point.y === 0);
  const south = top.pts.filter((point) => point.y === 4000);
  const rise = Math.tan(Math.PI / 6) * 4000;

  assert.ok(south.every((point) => point.z === 3250));
  assert.ok(north.every((point) => Math.abs(point.z - (3250 + rise)) < 1e-6));
  assert.ok(top.normal.z > 0 && top.normal.y > 0, 'top normal follows the slope');
  assert.equal(top.cutZ0, undefined, 'a sloped surface does not pretend to have one flat cutZ0');
  assert.deepEqual(faces.drainageEdges.map((edge) => edge.side), ['s']);
  assert.ok(faces.drainageEdges[0].a.z === 3250 && faces.drainageEdges[0].b.z === 3250);
  close(top.bottomPts[0].z, top.pts[0].z - 250);
});

test('gable: auto ridge follows the long side and both eaves drain', () => {
  const faces = slopedRoofFaces(rectGrid(8000, 4000), { type: 'gable', pitchDeg: 45, direction: 'auto', z: 3000, thickness: 250 });
  const tops = topFaces(faces);
  assert.equal(tops.length, 2);
  assert.ok(tops.every((face) => face.roofDirection === 'n'));
  assert.ok(sideFaces(faces).some((f) => Math.abs(f.normal.x) === 1
    && f.pts.some((p) => p.y === 2000 && Math.abs(p.z - 5250) < 1e-6)), 'торец плиты закрыт на коньке');
  const points = tops.flatMap((face) => face.pts);
  const ridge = points.filter((point) => point.y === 2000);
  assert.ok(ridge.length >= 4);
  assert.ok(ridge.every((point) => Math.abs(point.z - 5250) < 1e-6));
  assert.ok(points.filter((point) => point.y === 0 || point.y === 4000).every((point) => point.z === 3250));
  assert.deepEqual(new Set(faces.drainageEdges.map((edge) => edge.side)), new Set(['n', 's']));
});

test('hip: four exact planes and a ridge on a rectangular footprint', () => {
  const faces = slopedRoofFaces(rectGrid(8000, 4000), { type: 'hip', pitchDeg: 45, z: 3000, thickness: 250 });
  const tops = topFaces(faces);
  assert.equal(tops.length, 4);
  const ridge = tops.flatMap((face) => face.pts)
    .filter((point) => point.y === 2000 && (point.x === 2000 || point.x === 6000));
  assert.ok(ridge.length >= 4);
  assert.ok(ridge.every((point) => Math.abs(point.z - 5250) < 1e-6));
  assert.ok(tops.every((face) => face.normal.z > 0));
  assert.deepEqual(new Set(faces.drainageEdges.map((edge) => edge.side)), new Set(['n', 'e', 's', 'w']));
});

test('complex and disconnected masks triangulate safely with component metadata', () => {
  // L on the left plus an isolated cell on the right.
  const grid = {
    xs: [0, 2000, 4000, 6000], ys: [0, 2000, 4000], nx: 3, ny: 2,
    mask: new Uint8Array([
      1, 1, 0,
      1, 0, 1,
    ]),
  };
  const faces = slopedRoofFaces(grid, {
    type: 'hip', pitchDeg: 35, z: 3000, thickness: 250, metadata: { scenario: 'complex' },
  });
  const tops = topFaces(faces);
  const left = tops.filter((face) => face.roofComponent === 0);
  const right = tops.filter((face) => face.roofComponent === 1);

  assert.equal(left.length, 12, 'three L cells are split into four triangles each');
  assert.equal(right.length, 4, 'the isolated rectangular component has four hip planes');
  close(left.reduce((sum, face) => sum + area2d(face.pts), 0), 12_000_000);
  close(right.reduce((sum, face) => sum + area2d(face.pts), 0), 4_000_000);
  assert.ok(faces.every((face) => face.pts.every((point) => [point.x, point.y, point.z].every(Number.isFinite))));
  assert.ok(faces.every((face) => [face.normal.x, face.normal.y, face.normal.z].every(Number.isFinite)));
  assert.ok(faces.every((face) => face.scenario === 'complex'));
  assert.deepEqual(new Set(faces.drainageEdges.map((edge) => edge.roofComponent)), new Set([0, 1]));
});

test('invalid values are normalized and drainage can be disabled', () => {
  const faces = slopedRoofFaces(rectGrid(), {
    type: 'unknown', pitchDeg: Number.NaN, direction: 'diagonal', thickness: Number.NaN, drainage: false,
  });
  assert.equal(topFaces(faces)[0].roofType, 'flat');
  assert.equal(topFaces(faces)[0].pitchDeg, 0);
  assert.equal(topFaces(faces)[0].roofThickness, 250);
  assert.deepEqual(faces.drainageEdges, []);

  const empty = slopedRoofFaces({ xs: [0], ys: [0], mask: [] });
  assert.equal(empty.length, 0);
  assert.deepEqual(empty.drainageEdges, []);
});
