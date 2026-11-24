import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FACADE_ELEMENTS } from '../data/facade-catalog.js';
import { bindFacadeToWall, createCanopyLight, createFacadeElement, fitFacadeBand, syncFacadeHosts, updateFacadeAttachment } from '../core/facade.js';
import { createOpening, createProject, createRoom, deserializeProject, serializeProject } from '../core/model.js';
import { buildHouseMesh } from '../core/mesh3d.js';
import { copyMass, massBox, resizeMass } from '../core/masses.js';
import { pickFaces, pickObject } from '../core/pick3d.js';
import { buildElevation } from '../core/elevation.js';

const host = { point: { x: 2500, y: -250, z: 1700 }, normal: { x: 0, y: -1 }, level: { elevation: 0, height: 3000 }, from: 0, to: 5000 };

test('Пояс идёт через соседнюю комнату до наружных углов и останавливается у разрыва фасада', () => {
  const p = createProject();
  const level = p.levels[0];
  const a = createRoom('living', 0, 0, 5000, 4000);
  const b = createRoom('living', 5250, 0, 3000, 4000);
  const distant = createRoom('living', 13000, 0, 4000, 4000);
  level.rooms.push(a, b, distant);
  const m = bindFacadeToWall(p, createFacadeElement('band', host), level.id, a.id, 0);
  assert.ok(fitFacadeBand(p, m));
  assert.deepEqual([massBox(m).x0, massBox(m).x1], [-250, 8500]);
  p.masses = [m];
  b.w += 1000;
  syncFacadeHosts(p);
  assert.deepEqual([massBox(m).x0, massBox(m).x1], [-250, 9500]);
  const restored = deserializeProject(serializeProject(p));
  syncFacadeHosts(restored);
  assert.deepEqual(restored.masses, p.masses);
  assert.equal(updateFacadeAttachment(p, m, resizeMass(m, { w: 1800 })).facadeHost?.bandAnchor, undefined);
});

test('Подсветка под навесом следует за кромкой при повороте и следует за удалением хозяина', () => {
  const p = createProject();
  const canopy = createFacadeElement('canopy', host);
  const light = createCanopyLight(canopy);
  p.masses = [light, canopy];
  assert.equal(massBox(light).y0, massBox(canopy).y0);
  assert.equal(massBox(light).z1, canopy.z0);
  Object.assign(canopy, { x: 1010, y: 2010, rotation: 270, z0: 3400, w: 5150, d: 650 });
  syncFacadeHosts(p);
  assert.equal(massBox(light).x1, massBox(canopy).x1);
  assert.equal(light.y, canopy.y);
  assert.equal(light.w, 5150);
  assert.equal(massBox(light).z1, 3400);
  const restored = deserializeProject(serializeProject(p));
  syncFacadeHosts(restored);
  assert.deepEqual(restored.masses, p.masses);
  assert.equal(updateFacadeAttachment(p, light, { ...light, z0: 1700 }).canopyId, undefined);
  assert.equal(copyMass(light, p.masses).canopyId, undefined);
  p.masses = [light];
  assert.deepEqual(syncFacadeHosts(p), [light.id]);
});

test('Фасад сохраняет материал, тонкие размеры и монтажную плоскость при изменении выноса', () => {
  const p = createProject();
  p.masses = Object.keys(FACADE_ELEMENTS).map((kind) => createFacadeElement(kind, host));
  for (const m of p.masses) {
    assert.equal(massBox(m).y1, host.point.y);
    assert.equal(massBox(resizeMass(m, { d: m.d + 55 })).y1, host.point.y);
    const copy = copyMass(m, p.masses);
    assert.equal(copy.x - m.x, m.w);
    assert.equal(copy.y, m.y);
  }
  const restored = deserializeProject(serializeProject(p));
  assert.deepEqual(restored.masses, p.masses);
  const wash = createFacadeElement('light', { ...host, point: { x: 0, y: 20, z: 700 }, normal: { x: 1, y: 0 }, to: 600 });
  assert.equal(wash.w, 600);
  assert.equal(massBox(wash).x0, 0);
  assert.equal(wash.y, 300);
  assert.equal(createFacadeElement('bogus', host), null);
});

test('Облицовка вырезается по окну, выбирается на простенке и видна на чертеже фасада', () => {
  const project = createProject();
  const room = createRoom('living', 0, 0, 5000, 4000);
  project.rooms.push(room);
  project.openings.push(createOpening('window', room.id, 0, 2500, 1200));
  const exterior = project.settings.exterior;
  const panel = createFacadeElement('stone', { ...host, point: { ...host.point, y: -exterior } });
  panel.w = 4000;
  project.masses = [panel];
  const faces = buildHouseMesh(project);
  const facade = faces.filter((f) => f.facadeKind === 'stone');
  assert.ok(facade.length);
  const pick = (x) => pickObject({ faces: pickFaces(facade) }, { o: { x, y: -1000, z: 1600 }, d: { x: 0, y: 1, z: 0 } });
  assert.equal(pick(2500), null);
  assert.equal(pick(1200)?.id, panel.id);
  assert.ok(buildElevation(project, 'N').polys.some((poly) => poly.tint === panel.color));
});

test('Связанная отделка следует за комнатой, этажом и чистой высотой, самостоятельная — остаётся на месте', () => {
  const p = createProject();
  const level = p.levels[0];
  level.height = 3000;
  const room = createRoom('living', 0, 0, 5000, 4000);
  level.rooms.push(room);
  const attach = (kind) => bindFacadeToWall(p, createFacadeElement(kind, { ...host, level }), level.id, room.id, 0);
  const panel = attach('stone');
  const light = attach('light');
  const free = createFacadeElement('canopy', host);
  p.masses = [panel, light, free];
  const initialLight = light.z0;
  level.elevation = 850;
  level.height = 3600;
  room.x += 1400;
  room.y -= 500;
  assert.deepEqual(syncFacadeHosts(p), []);
  assert.deepEqual([panel.x, panel.y, panel.z0, panel.h], [3900, -775, 850, 3600]);
  assert.equal(light.z0, initialLight + 1450);
  assert.equal(free.x, 2500);
  room.w = 6000;
  syncFacadeHosts(p);
  assert.equal(panel.x, room.x + room.w / 2);
  room.w = 5000;
  room.ceiling = 2800;
  syncFacadeHosts(p);
  assert.equal(panel.h, 2800);
  p.masses[0] = updateFacadeAttachment(p, panel, { ...panel, x: panel.x + 180 });
  assert.equal(p.masses[0].facadeHost.along, 2680);
  p.masses[1] = updateFacadeAttachment(p, light, { ...light, y: light.y - 500 });
  assert.ok(!p.masses[1].facadeHost);
  const restored = deserializeProject(serializeProject(p));
  syncFacadeHosts(restored);
  assert.deepEqual(restored.masses, p.masses);
  restored.rooms.length = 0;
  assert.deepEqual(syncFacadeHosts(restored), [panel.id]);
  assert.deepEqual(restored.masses.map((m) => m.id), [light.id, free.id]);
});
