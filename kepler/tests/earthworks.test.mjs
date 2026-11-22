import { test } from 'node:test';
import assert from 'node:assert/strict';

import { analyzeEarthworks } from '../core/earthworks.js';
import { createProject, createRoom } from '../core/model.js';
import { normalizeTerrain } from '../core/terrain.js';

const near = (actual, expected, tolerance = 1e-6) => {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected} ± ${tolerance}`);
};

function squareTerrain(size = 10000, z = () => 0) {
  return normalizeTerrain({ points: [
    { id: 'nw', x: 0, y: 0, z: z(0, 0) },
    { id: 'ne', x: size, y: 0, z: z(size, 0) },
    { id: 'se', x: size, y: size, z: z(size, size) },
    { id: 'sw', x: 0, y: size, z: z(0, size) },
  ] });
}

function oneRoom({ x = 0, y = 0, w = 10000, h = 10000, terrain = squareTerrain() } = {}) {
  const project = createProject();
  project.settings.exterior = 0;
  project.rooms.push(createRoom('living', x, y, w, h));
  project.site.terrain = terrain;
  return project;
}

test('flat terrain: equal grade is zero; ±1 m is exactly 100 m³', () => {
  const project = oneRoom();
  const equal = analyzeEarthworks(project, { grade: { mode: 'absolute', zMm: 0 } });
  assert.equal(equal.status, 'candidate');
  near(equal.coverage.ratio, 1);
  near(equal.areas.padM2, 100);
  near(equal.areas.cutM2, 0);
  near(equal.areas.fillM2, 0);
  near(equal.volumes.cutM3, 0);
  near(equal.volumes.fillM3, 0);

  const fill = analyzeEarthworks(project, { grade: { mode: 'absolute', zMm: 1000 } });
  near(fill.volumes.cutM3, 0);
  near(fill.volumes.fillM3, 100);
  near(fill.volumes.netM3, 100);
  near(fill.extremes.maxFillMm, 1000);

  const cut = analyzeEarthworks(project, { grade: { mode: 'absolute', zMm: -1000 } });
  near(cut.volumes.cutM3, 100);
  near(cut.volumes.fillM3, 0);
  near(cut.volumes.netM3, -100);
  near(cut.extremes.maxCutMm, 1000);
});

test('10% slope split at its middle gives 12.5 m³ cut and fill', () => {
  const project = oneRoom({ terrain: squareTerrain(10000, (x) => x * 0.1) });
  const result = analyzeEarthworks(project, { grade: { mode: 'absolute', zMm: 500 } });
  assert.equal(result.status, 'candidate');
  near(result.volumes.cutM3, 12.5, 1e-5);
  near(result.volumes.fillM3, 12.5, 1e-5);
  near(result.volumes.netM3, 0, 1e-7);
  near(result.areas.cutM2, 50, 1e-5);
  near(result.areas.fillM2, 50, 1e-5);

  const balanced = analyzeEarthworks(project);
  assert.equal(balanced.grade.mode, 'balanced');
  near(balanced.grade.absoluteZMm, 500, 1e-5);
  near(balanced.volumes.cutM3, 12.5, 1e-5);
  near(balanced.volumes.fillM3, 12.5, 1e-5);
});

test('internal terrain peak is integrated, not missed by footprint corners', () => {
  const project = oneRoom();
  project.site.terrain = normalizeTerrain({ points: [
    { id: 'nw', x: 0, y: 0, z: 0 },
    { id: 'ne', x: 10000, y: 0, z: 0 },
    { id: 'se', x: 10000, y: 10000, z: 0 },
    { id: 'sw', x: 0, y: 10000, z: 0 },
    { id: 'peak', x: 5000, y: 5000, z: 1000 },
  ] });
  const result = analyzeEarthworks(project, { grade: { mode: 'absolute', zMm: 0 } });
  near(result.volumes.cutM3, 100 / 3, 1e-5);
  near(result.volumes.fillM3, 0);
  near(result.extremes.maxCutMm, 1000);
});

test('L-shaped adjacent rooms form one 75 m² footprint without double count', () => {
  const project = createProject();
  project.settings.exterior = 0;
  project.rooms.push(
    createRoom('living', 0, 0, 10000, 5000),
    createRoom('kitchen', 0, 5000, 5000, 5000),
    createRoom('storage', 1000, 1000, 2000, 2000), // overlap must not add area
  );
  project.site.terrain = squareTerrain();
  const result = analyzeEarthworks(project, { grade: { mode: 'absolute', zMm: 1000 } });
  near(result.areas.padM2, 75);
  near(result.volumes.fillM3, 75);
  near(result.coverage.ratio, 1);
});

test('building rotation preserves flat-terrain area and volume', () => {
  const project = oneRoom({ terrain: squareTerrain(40000) });
  project.building = { rotation: 37, origin: { x: 20000, y: 12000 } };
  const result = analyzeEarthworks(project, { grade: { mode: 'absolute', zMm: 1000 } });
  assert.equal(result.status, 'candidate');
  // Polygon kernel snaps to its documented 0.5 mm grid.
  near(result.areas.padM2, 100, 0.002);
  near(result.volumes.fillM3, 100, 0.002);
});

test('survey hull is not clamped: half coverage is partial, none is unknown', () => {
  const half = oneRoom({ terrain: normalizeTerrain({ points: [
    { id: 'a', x: 0, y: 0, z: 0 },
    { id: 'b', x: 5000, y: 0, z: 0 },
    { id: 'c', x: 5000, y: 10000, z: 0 },
    { id: 'd', x: 0, y: 10000, z: 0 },
  ] }) });
  const partial = analyzeEarthworks(half, { grade: { mode: 'absolute', zMm: 1000 } });
  assert.equal(partial.status, 'partial');
  near(partial.coverage.ratio, 0.5);
  near(partial.coverage.outsideSurveyM2, 50);
  near(partial.volumes.fillM3, 50);
  assert.ok(partial.warnings.some((item) => item.code === 'partial_survey'));
  assert.equal(partial.source.clamped, false);

  half.building.origin.x = 20000;
  const outside = analyzeEarthworks(half, { grade: { mode: 'absolute', zMm: 1000 } });
  assert.equal(outside.status, 'unknown');
  assert.equal(outside.reason, 'outside_survey');
  near(outside.volumes.fillM3, 0);
});

test('missing or degenerate terrain and missing footprint stay unknown', () => {
  const missing = oneRoom();
  missing.site.terrain = null;
  assert.equal(analyzeEarthworks(missing).status, 'unknown');
  assert.equal(analyzeEarthworks(missing).reason, 'no_terrain');

  const line = oneRoom({ terrain: normalizeTerrain({ points: [
    { x: 0, y: 0, z: 0 }, { x: 5000, y: 0, z: 0 }, { x: 10000, y: 0, z: 0 },
  ] }) });
  assert.equal(analyzeEarthworks(line).reason, 'no_terrain');

  const empty = createProject();
  empty.site.terrain = squareTerrain();
  assert.equal(analyzeEarthworks(empty).reason, 'no_footprint');
});

test('relative grade requires a datum and resolves from finished floor', () => {
  const project = oneRoom({ terrain: squareTerrain(10000, () => 100000) });
  const noDatum = analyzeEarthworks(project, { grade: { mode: 'relative', zMm: -300 } });
  assert.equal(noDatum.status, 'unknown');
  assert.equal(noDatum.reason, 'missing_datum');

  project.envelope.zeroAboveGround = 1000;
  project.envelope.groundReferenceZ = 100000;
  const result = analyzeEarthworks(project, { grade: { mode: 'relative', zMm: -300 } });
  near(result.grade.absoluteZMm, 100700);
  near(result.grade.relativeZMm, -300);
  near(result.volumes.fillM3, 70);
});

test('balanced target and work-pad margin are deterministic and do not mutate project', () => {
  const project = oneRoom({ terrain: squareTerrain(20000, (x) => x * 0.05) });
  project.building.origin = { x: 5000, y: 5000 };
  const before = JSON.stringify(project);
  const opts = {
    boundary: 'work-pad', marginMm: 1000,
    grade: { mode: 'balanced', targetNetM3: 14.4 },
  };
  const first = analyzeEarthworks(project, opts);
  const second = analyzeEarthworks(project, opts);
  assert.deepEqual(second, first);
  assert.equal(JSON.stringify(project), before);
  near(first.areas.padM2, 144, 1e-4);
  near(first.volumes.netM3, 14.4, 1e-5);
});

test('invalid options return unknown instead of throwing or producing NaN', () => {
  const project = oneRoom();
  for (const opts of [
    { boundary: 'bad' },
    { marginMm: -1 },
    { grade: { mode: 'absolute', zMm: Number.NaN } },
    { grade: { mode: 'balanced', slopeX: 'bad' } },
    { grade: { mode: 'balanced', targetNetM3: Number.POSITIVE_INFINITY } },
  ]) {
    const result = analyzeEarthworks(project, opts);
    assert.equal(result.status, 'unknown');
    assert.ok(result.warnings.length);
    assert.doesNotMatch(JSON.stringify(result), /NaN|Infinity/);
  }
});
