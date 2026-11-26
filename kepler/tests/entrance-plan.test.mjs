import test from 'node:test';
import assert from 'node:assert/strict';
import { createLevel, createOpening, createProject, createRoom } from '../core/model.js';
import { deriveWalls } from '../core/walls.js';
import { entranceFaces } from '../core/mesh3d.js';
import { entrancePlanParts, hitEntrancePlan, visibleEntranceParts } from '../ui/render-entrance.js';

function fixture() {
  const project = createProject(); project.envelope.zeroAboveGround = 900;
  project.building = { rotation: 37, origin: { x: 1700, y: -800 } };
  const room = createRoom('entrance', 0, 0, 5000, 4000);
  const door = createOpening('door', room.id, 2, 2500, 1000); door.entryRole = 'main';
  door.entrance = { shapeEdits: { landing: { right: 1200 }, 'step-3': { right: 1800, front: 400 } } };
  project.rooms.push(room); project.openings.push(door);
  return { project, walls: deriveWalls(project), drawingRevision: 0 };
}

test('план крыльца совпадает с верхними гранями 3D и выбирается после поворота дома', () => {
  const st = fixture(); const parts = entrancePlanParts(st);
  const faces = entranceFaces(st.project);
  assert.equal(parts.length, 7);
  for (const p of parts) {
    const top = faces.filter((f) => f.stairPart === p.key && f.normal.z > .9);
    assert.ok(p.polygon.every((v) => top.some((f) => f.pts.some((q) => Math.hypot(q.x - v.x, q.y - v.y) < .01))));
  }
  const step = parts.find((p) => p.key === 'step-3');
  // Центр расширенной части, снаружи исходного марша и выше следующей ступени.
  const a = step.worldPolygon[1]; const b = step.worldPolygon[2];
  const middle = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  assert.equal(hitEntrancePlan(st, middle, 1)?.key, 'step-3');
});

test('наведение и масштаб используют готовый план, а изменение модели обновляет его', () => {
  const st = fixture(); const first = entrancePlanParts(st);
  st.view = { scale: .03, panX: 400 };
  assert.strictEqual(entrancePlanParts(st), first);
  st.project.openings[0].entrance.enabled = false; st.drawingRevision += 1;
  assert.deepEqual(entrancePlanParts(st), []);
  st.project.openings[0].entrance.enabled = true; st.drawingRevision += 1;
  assert.equal(entrancePlanParts(st).length, 7);
});


test('крыльцо видно на своём плане и участке, но не на чужом этаже и плане крыши', () => {
  const st = fixture(); st.modeName = 'plan';
  const first = st.project.activeLevel;
  assert.equal(visibleEntranceParts(st).length, 7);
  const upper = createLevel('2 этаж', 3000); st.project.levels.push(upper);
  st.project.activeLevel = upper.id;
  assert.deepEqual(visibleEntranceParts(st), []);
  st.modeName = 'site'; assert.equal(visibleEntranceParts(st).length, 7);
  st.modeName = 'landscape'; assert.equal(visibleEntranceParts(st).length, 7);
  st.project.activeLevel = first; st.modeName = 'plan'; st.roofPlan = true;
  assert.deepEqual(visibleEntranceParts(st), []);
});
