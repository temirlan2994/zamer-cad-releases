import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildElevation } from '../core/elevation.js';
import { buildSection } from '../core/section.js';
import { createOpening, createProject, createRoom } from '../core/model.js';
import { entranceFaces, foundationFaces, linkedRoofFaces } from '../core/mesh3d.js';

function house() {
  const project = createProject('Связанные системы');
  project.settings.exterior = 250;
  const room = createRoom('hall', 0, 0, 6000, 4000);
  project.rooms.push(room);
  const door = createOpening('door', room.id, 0, 3000, 1000);
  door.entryRole = 'main';
  project.openings.push(door);
  project.envelope.zeroAboveGround = 1000;
  return project;
}

test('тип крыши проходит через 3D, фасад и точный наклонный разрез', () => {
  const project = house();
  project.envelope.roof.type = 'gable';
  project.envelope.roof.pitchDeg = 30;
  project.envelope.roof.direction = 'n';
  const roof = linkedRoofFaces(project);
  const tops = roof.filter((face) => face.roofSurface === 'top');
  assert.ok(tops.length >= 2);
  assert.ok(tops.some((face) => face.normal.z > 0.5 && face.normal.z < 0.999));
  assert.ok(Math.max(...tops.flatMap((face) => face.pts.map((point) => point.z))) > 4000);

  const elevation = buildElevation(project, 'S');
  assert.ok(elevation.polys.some((poly) => poly.kind === 'roof' && Math.max(...poly.pts.map((point) => point.z)) > 4000));
  const section = buildSection(project, {
    id: 's', kind: 'section', name: 'Разрез', side: 1,
    line: { a: { x: 3000, y: -1000 }, b: { x: 3000, y: 5000 } },
  });
  const cuts = section.cuts.filter((cut) => cut.kind === 'roof');
  assert.ok(cuts.length >= 2);
  assert.ok(cuts.some((cut) => new Set(cut.pts.map((point) => Math.round(point.z))).size > 2), 'скат не стал прямоугольником');
});

test('стояк связанной крыши опускается до земли, а не заканчивается у карниза', () => {
  const project = house();
  project.envelope.roof.type = 'flat';
  project.envelope.roof.drainage = 'external';
  const downpipes = linkedRoofFaces(project).filter((face) => face.roofDrain === 'downpipe');
  assert.ok(downpipes.length > 0);
  assert.equal(Math.min(...downpipes.flatMap((face) => face.pts.map((point) => point.z))), -1000);
  assert.ok(Math.max(...downpipes.flatMap((face) => face.pts.map((point) => point.z))) > 3000);
});

test('тип основания и автоматический вход дают семантические 3D-компоненты', () => {
  const project = house();
  project.envelope.foundation.type = 'piles';
  const foundation = foundationFaces(project);
  assert.ok(foundation.some((face) => face.foundationComponentKind === 'pile'));
  assert.ok(foundation.some((face) => face.foundationComponentKind === 'grillage'));

  const entrance = entranceFaces(project);
  assert.ok(entrance.some((face) => face.entranceComponentKind === 'landing'));
  assert.ok(entrance.some((face) => face.entranceComponentKind === 'steps'));
  assert.ok(entrance.every((face) => face.openingId === project.openings[0].id));
  const landingTop = entrance.find((face) => face.entranceComponentKind === 'landing' && face.normal.z > 0.5);
  assert.ok(landingTop);
  assert.ok(landingTop.cutZ0 < landingTop.pts[0].z, 'площадка передаёт в разрез низ своего тела');
});
