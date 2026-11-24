import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compositionWall, prepareComposition } from '../core/facade-compositions.js';
import { syncFacadeHosts } from '../core/facade.js';
import { createProject, createRoom, deserializeProject, serializeProject } from '../core/model.js';
import { massBox } from '../core/masses.js';

const make = () => {
  const project = createProject();
  const room = createRoom('living', 600, 900, 7000, 6000);
  project.rooms.push(room);
  return { project, room };
};

test('Панорама сохраняет отдельное связанное окно, две панели и существующие проёмы', () => {
  const { project, room } = make();
  const host = compositionWall(project, project.activeLevel, room.id, 1, 4000);
  const pan = () => prepareComposition(project, 'panorama', host, 5800, 1200);
  const { opening, masses } = pan();
  assert.equal(opening.offset, 3500 - room.y);
  assert.equal(opening.heightMode, 'level');
  assert.equal(opening.frameMaterial, 'aluminum');
  assert.equal(new Set(masses.map((m) => m.id)).size, 2);
  project.masses = masses;
  project.openings.push(opening);
  assert.match(pan().error, /проём/);
  assert.equal(project.openings.length, 1);
  const saved = deserializeProject(serializeProject(project));
  assert.deepEqual(saved.masses, masses);
  assert.equal(saved.openings[0].id, opening.id);
});

test('Настил, навес и две стойки совпадают по отметкам и следуют за стеной после сохранения', () => {
  const { project, room } = make();
  const host = compositionWall(project, project.activeLevel, room.id, 0, 3100);
  const makeTerrace = () => prepareComposition(project, 'terrace', host, 700, 7100);
  project.masses = makeTerrace().masses;
  assert.match(makeTerrace().error, /настил/);
  const saved = deserializeProject(serializeProject(project));
  const original = structuredClone(saved.masses);
  saved.rooms[0].x += 600;
  saved.levels[0].height += 500;
  saved.levels[0].elevation += 300;
  syncFacadeHosts(saved);
  const [canopy, deck, ...posts] = saved.masses;
  assert.equal(canopy.x, original[0].x + 600);
  assert.equal(canopy.z0, original[0].z0 + 800);
  for (const p of posts) {
    assert.equal(p.z0, massBox(deck).z1);
    assert.equal(massBox(p).z1, canopy.z0);
    assert.ok(massBox(p).y0 > massBox(canopy).y0);
  }
  assert.equal(prepareComposition(project, 'panorama', host, 1000, 1400).masses, undefined);
});
