import test from 'node:test';
import assert from 'node:assert/strict';
import { stairRect } from '../core/stair-shape.js';
import { createOpening, createProject, createRoom, deserializeProject, serializeProject } from '../core/model.js';
import { deriveEntrances, entranceParts } from '../core/entrance.js';
import { entranceFaces } from '../core/mesh3d.js';
import { createLandscapeObject, stairTreads } from '../core/landscape.js';

test('один край ступени меняется независимо; плохие размеры не выворачивают прямоугольник', () => {
  const base = { left: -800, right: 800, back: 0, front: 300 };
  assert.deepEqual(stairRect(base, { right: 1000 }), { ...base, right: 1800 });
  const r = stairRect(base, { left: 9000, right: -9000, front: NaN });
  assert.ok(r.right - r.left >= 100); assert.ok(r.front - r.back >= 100);
});

test('форма ступени и площадки крыльца переживает файл; соседние ступени и дверь сохраняются', () => {
  const p = createProject(); p.envelope.zeroAboveGround = 900;
  const room = createRoom('entrance', 0, 0, 5000, 4000);
  const door = createOpening('door', room.id, 2, 2500, 1000);
  door.entryRole = 'main'; p.rooms.push(room); p.openings.push(door);
  const before = entranceParts(deriveEntrances(p)[0]);
  door.entrance = { shapeEdits: { landing: { right: 700 }, 'step-3': { left: -200, right: 1200, front: 500, back: 100 } } };
  const parts = entranceParts(deriveEntrances(p)[0]);
  assert.deepEqual(parts.find((x) => x.key === 'step-2'), before.find((x) => x.key === 'step-2'));
  const step = parts.find((x) => x.key === 'step-3');
  assert.equal(step.rect.right - step.rect.left, 3000);
  assert.equal(step.rect.front - step.rect.back, 700);
  assert.equal(parts[0].rect.right - parts[0].rect.left, 2300);
  const roundtrip = deserializeProject(serializeProject(p));
  assert.deepEqual(entranceParts(deriveEntrances(roundtrip)[0]), parts);
  const faces = entranceFaces(roundtrip).filter((f) => f.stairPart === 'step-3' && f.normal.z > .9);
  assert.ok(faces.length); assert.ok(faces.every((f) => f.pts.every((v) => Number.isFinite(v.x + v.y + v.z))));
  assert.equal(door.width, 1000);
});

test('наружная лестница: форма одной ступени сохраняет высоту и другие проступи', () => {
  const o = createLandscapeObject('stairs-out', 0, 0, { w: 2000, height: 900 });
  const before = stairTreads(o);
  o.meta = { ...o.meta, shapeEdits: { 'step-2': { right: 1000, front: 400 } } };
  const next = stairTreads(o);
  assert.deepEqual(next.filter((p) => p.key !== 'step-2'), before.filter((p) => p.key !== 'step-2'));
  const p = next.find((s) => s.key === 'step-2'); const b = before.find((s) => s.key === p.key);
  assert.equal(p.right - b.right, 1000); assert.equal(p.bottom - b.bottom, 400); assert.equal(p.z, b.z);
});
