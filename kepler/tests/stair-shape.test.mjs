import test from 'node:test';
import assert from 'node:assert/strict';
import { stairClickSelection, stairHeights, stairRect } from '../core/stair-shape.js';
import { createOpening, createProject, createRoom, deserializeProject, serializeProject } from '../core/model.js';
import { deriveEntrances, entranceParts } from '../core/entrance.js';
import { entranceFaces } from '../core/mesh3d.js';
import { createLandscapeObject, hitStairTread, pointInObject, stairTreads, toWorld } from '../core/landscape.js';
import { landscapeFaces } from '../core/mesh3d-landscape.js';
import { sectionProfile } from '../core/landscape-section.js';

test('первый клик — вся лестница, следующий — ступень или площадка; другой объект начинает с общего выбора', () => {
  for (const type of ['entrance', 'landscape']) {
    const hit = { type, id: 'stairs', part: 'step-3' };
    const whole = type === 'entrance' ? { type, id: hit.id } : { type, ids: [hit.id] };
    assert.deepEqual(stairClickSelection(null, hit), whole);
    const part = stairClickSelection(whole, hit); assert.equal(part.part, 'step-3');
    assert.deepEqual(stairClickSelection(whole, { ...hit, part: 'ramp' }), whole);
    assert.equal(stairClickSelection(part, { ...hit, part: 'step-1' }).part, 'step-1');
    assert.equal(stairClickSelection(part, { ...hit, id: 'another' }).part, undefined);
    if (type === 'entrance') assert.equal(stairClickSelection(whole, { type, id: hit.id }).part, 'landing');
  }
});

test('на ландшафте выбирается изменённая ступень за исходным габаритом повёрнутой лестницы', () => {
  const o = createLandscapeObject('stairs-out', 1500, -800, { w: 2000, height: 900, rotation: 37 });
  o.meta.shapeEdits = { 'step-3': { right: 1200 } };
  const step = stairTreads(o).find((t) => t.key === 'step-3');
  const point = toWorld(o, 1800, (step.top + step.bottom) / 2);
  assert.equal(hitStairTread(o, point), 'step-3'); assert.equal(pointInObject(o, point), true);
});

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

test('верх и низ независимы; отрицательная толщина и нечисловые правки безопасны', () => {
  const base = { lower: -1000, upper: -300 };
  assert.deepEqual(stairHeights(base, { upper: 120 }), { lower: -1000, upper: -180 });
  assert.deepEqual(stairHeights(base, { lower: 300 }), { lower: -700, upper: -300 });
  assert.deepEqual(stairHeights(base, { upper: NaN, lower: Infinity }), base);
  const invalid = stairHeights(base, { lower: 10000, upper: -10000 });
  assert.equal(invalid.upper - invalid.lower, 20);
  assert.deepEqual(stairHeights({ lower: 0, upper: 0 }), { lower: 0, upper: 0 }, 'старый нулевой подъём сохраняется');
});

test('у ступени и площадки крыльца свой верх и низ; 3D, сохранение и соседи согласованы', () => {
  const p = createProject(); p.envelope.zeroAboveGround = 900;
  const room = createRoom('entrance', 0, 0, 5000, 4000);
  const door = createOpening('door', room.id, 2, 2500, 1000);
  door.entryRole = 'main'; p.rooms.push(room); p.openings.push(door);
  const before = entranceParts(deriveEntrances(p)[0]);
  door.entrance = { shapeEdits: { landing: { upper: 80, lower: 100 }, 'step-3': { upper: 120, lower: 200 } } };
  const after = entranceParts(deriveEntrances(p)[0]);
  for (const part of after) {
    const original = before.find((t) => t.key === part.key);
    if (!door.entrance.shapeEdits[part.key]) { assert.deepEqual(part, original); continue; }
    assert.deepEqual(part.polygon, original.polygon);
    const edit = door.entrance.shapeEdits[part.key];
    assert.equal(part.z, original.z + edit.upper); assert.equal(part.z0, original.z0 + edit.lower);
    const faces = entranceFaces(p).filter((f) => f.stairPart === part.key);
    const z = faces.flatMap((f) => f.pts.map((v) => v.z));
    assert.equal(Math.min(...z), part.z0); assert.equal(Math.max(...z), part.z);
    assert.ok(faces.some((f) => f.normal.z < -.9), 'низ закрыт настоящей гранью');
  }
  assert.deepEqual(entranceParts(deriveEntrances(deserializeProject(serializeProject(p)))[0]), after);
  assert.equal(door.width, 1000);
});

test('отдельная лестница: толщина одной ступени совпадает в 3D и разрезе над основанием', () => {
  const p = createProject();
  const o = createLandscapeObject('stairs-out', 2500, 0, { height: 900, elev: 300 });
  p.site.landscape.objects.push(o);
  const before = stairTreads(o);
  o.meta.shapeEdits = { 'step-2': { upper: 100, lower: 300 } };
  const after = stairTreads(o); const step = after.find((t) => t.key === 'step-2');
  assert.deepEqual(after.filter((t) => t.key !== 'step-2'), before.filter((t) => t.key !== 'step-2'));
  const faces = landscapeFaces(p, () => 100).filter((f) => f.stairPart === 'step-2');
  const z = faces.flatMap((f) => f.pts.map((v) => v.z));
  assert.equal(Math.min(...z), 400 + step.z0); assert.equal(Math.max(...z), 400 + step.z);
  assert.ok(faces.some((f) => f.normal.z < -.9));
  const profile = sectionProfile(p, [{ x: 2500, y: -6000 }, { x: 2500, y: 6000 }], 'left');
  const cut = profile.prims.filter((prim) => prim.id === o.id && prim.kind === 'stairs-out' && prim.cat === 'built');
  assert.ok(cut.some((prim) => Math.min(...prim.pts.map((v) => v.z)) === 300 + step.z0 && Math.max(...prim.pts.map((v) => v.z)) === 300 + step.z));
  assert.deepEqual(stairTreads(deserializeProject(serializeProject(p)).site.landscape.objects[0]), after);
});
