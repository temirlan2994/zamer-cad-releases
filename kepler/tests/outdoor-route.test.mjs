import assert from 'node:assert/strict';
import { test } from 'node:test';
import { gradedPathLevel, steppingSlabs, toWorld, translateObject } from '../core/landscape.js';
import { landscapeFaces } from '../core/mesh3d-landscape.js';
import { createProject, deserializeProject, serializeProject } from '../core/model.js';
import { outdoorLights, plotOutdoorRoute } from '../core/outdoor-route.js';
import { syncOutdoorStairs } from '../core/outdoor-stair-links.js';

const ground = Object.assign(() => 0, { siteDatum: 0 });
const project = (objects) => {
  const p = createProject();
  p.site.landscape.objects = objects;
  return p;
};

test('марш, поворотная площадка и настил составляют один маршрут с общими отметками', () => {
  const points = [{ x: 0, y: 0 }, { x: 4600, y: 0, level: 700 }, { x: 4600, y: 5600 }];
  const route = plotOutdoorRoute(points, {
    ground, sections: [{ kind: 'stairs', width: 2400 }, { kind: 'slabs', width: 1800, stagger: true }],
  });
  assert.deepEqual(route.errors, []);
  const [stair, slabs, pad] = route.objects;
  assert.deepEqual([stair.kind, slabs.kind, pad.kind], ['stairs-out', 'path', 'paving-area']);
  assert.equal(stair.elevTo, pad.elev);
  assert.equal(pad.elev, slabs.elev);
  assert.ok(stair.meta.stairLinks.ends.some((end) => end.anchor?.id === pad.id));
  assert.ok(new Set(steppingSlabs(slabs).map((s) => s.across)).size >= 2);
  assert.ok(new Set(steppingSlabs(slabs).map((s) => s.x)).size >= 2);

  const model = deserializeProject(serializeProject(project(route.objects)));
  const [savedStair, savedPath, savedPad] = model.site.landscape.objects;
  const lamps = outdoorLights([savedStair, savedPath], { ground, side: 'both', step: 1400 });
  assert.ok(lamps.length >= 8);
  assert.ok(lamps.every((lamp) => lamp.kind === 'lamp' && Number.isFinite(lamp.elev)));
  model.site.landscape.objects.push(...lamps);
  assert.ok(landscapeFaces(model, ground, { evening: true }).some((f) => f.kind === 'landscape-light'));
  assert.ok(!landscapeFaces(model, ground).some((f) => f.kind === 'landscape-light'));

  const prior = toWorld(savedStair, 0, -savedStair.h / 2);
  savedPad.elev = 960;
  translateObject(savedPad, 600, 0);
  assert.equal(syncOutdoorStairs([savedStair, savedPath, savedPad], ground), 0);
  assert.equal(savedStair.elevTo, 960);
  const after = toWorld(savedStair, 0, -savedStair.h / 2);
  assert.ok(Math.abs(after.x - prior.x - 600) < 2 && Math.abs(after.y - prior.y) < 2);
});

test('ручные отметки создают физический уклон, явные разные отметки плит дают ошибку', () => {
  const points = [{ x: 0, y: 0, level: 300 }, { x: 9000, y: 0, level: 900 }];
  const grade = plotOutdoorRoute(points, { ground, sections: [{ kind: 'path' }] });
  assert.deepEqual(grade.errors, []);
  const [path] = grade.objects;
  assert.equal(path.meta.pathLevel, 'graded');
  assert.equal(gradedPathLevel(path, 4500, 0), 600);
  const top = landscapeFaces(project([path]), ground).filter((f) => f.normal.z > 0.9).flatMap((f) => f.pts.map((p) => p.z));
  assert.equal(Math.min(...top), 300);
  assert.equal(Math.max(...top), 900);
  const slabs = plotOutdoorRoute(points, { ground, sections: [{ kind: 'slabs' }] });
  assert.match(slabs.errors.join(' '), /отметки.*совпадать/);
});
