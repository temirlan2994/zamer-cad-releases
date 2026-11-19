// Связанные высоты этажа, помещений и высоких окон.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  activeLevel, createOpening, createProject, createRoom, roomCeiling,
} from '../core/model.js';
import { buildHouseMesh, furnitureFaces, furnitureVolumes } from '../core/mesh3d.js';
import { openingHeight } from '../core/opening-preset.js';

function oneRoom() {
  const project = createProject('Высоты');
  const room = createRoom('living', 0, 0, 5000, 4000);
  room.id = 'R';
  project.rooms.push(room);
  return { project, room, level: activeLevel(project) };
}

test('помещение связано с этажом, индивидуальная высота сохраняется', () => {
  const { room, level } = oneRoom();
  assert.equal(roomCeiling(room, level), 2700);
  level.height = 3400;
  assert.equal(roomCeiling(room, level), 3100);
  room.ceiling = 2650;
  level.height = 3800;
  assert.equal(roomCeiling(room, level), 2650);
});

test('связанный витраж следует общей высоте этажа, обычное окно — своей', () => {
  const { level } = oneRoom();
  const opening = createOpening('window', 'R', 0, 2000, 2400);
  opening.type = 'panoramic';
  opening.sill = 100;
  opening.heightMode = 'level';
  assert.equal(openingHeight(opening, level), 2400);
  level.tallWindowHeight = 2650;
  assert.equal(openingHeight(opening, level), 2650);
  opening.heightMode = 'custom';
  opening.height = 2150;
  assert.equal(openingHeight(opening, level), 2150);
});

test('3D окна содержит стеклопакет и объёмную алюминиевую раму', () => {
  const { project } = oneRoom();
  const opening = createOpening('window', 'R', 0, 2500, 2400);
  opening.type = 'lift-slide';
  opening.sill = 100;
  opening.heightMode = 'level';
  project.openings.push(opening);
  const faces = buildHouseMesh(project);
  assert.equal(faces.filter((face) => face.kind === 'glass' && face.openingId === opening.id).length, 1);
  assert.ok(faces.filter((face) => face.kind === 'window-frame' && face.openingId === opening.id).length >= 20);
});

test('детальная 3D-мебель сложнее расчётного объёма, но сохраняет один id', () => {
  const item = { id: 'S', kind: 'loveseat', x: 1000, y: 1000, w: 1900, h: 1000, rotation: 0 };
  const simple = furnitureVolumes([item], 3000);
  const detailedFaces = furnitureFaces({ items: [item] }, 0, 3000, 'L1');
  assert.equal(simple.length, 2, 'для теней остаётся лёгкая модель');
  assert.ok(detailedFaces.length > simple.length * 5, 'в 3D есть цоколь, подушка, спинка и боковины');
  assert.ok(detailedFaces.every((face) => face.itemId === item.id));
});
