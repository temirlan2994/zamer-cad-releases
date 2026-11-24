// Связанные высоты этажа, помещений и высоких окон.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  activeLevel, createOpening, createProject, createRoom, deserializeProject, normalizeProject,
  roomCeiling, serializeProject, setLevelTallWindowOffsets,
} from '../core/model.js';
import {
  buildHouseMesh, furnitureFaces, furnitureVolumes, levelWallSolids,
} from '../core/mesh3d.js';
import { openingHeight, openingSill } from '../core/opening-preset.js';
import { deriveWalls } from '../core/walls.js';

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
  setLevelTallWindowOffsets(level, { top: 250 });
  assert.equal(openingHeight(opening, level), 2650);
  assert.equal(openingSill(opening, level), 100);
  opening.heightMode = 'custom';
  opening.height = 2150;
  opening.sill = 75;
  assert.equal(openingHeight(opening, level), 2150);
  assert.equal(openingSill(opening, level), 75);
});

test('все связанные витражи имеют одинаковые верх и низ', () => {
  const { level } = oneRoom();
  const a = { kind: 'window', heightMode: 'level', sill: 0, height: 1800 };
  const b = { kind: 'window', heightMode: 'level', sill: 300, height: 2700 };
  setLevelTallWindowOffsets(level, { top: 350, bottom: 50 });
  assert.deepEqual(
    [openingSill(a, level), openingHeight(a, level), openingSill(b, level), openingHeight(b, level)],
    [50, 2600, 50, 2600],
  );
  assert.equal(level.tallWindowHeight, 2600, 'старое поле синхронизировано');
});

test('отступы остаются при смене высоты этажа и оставляют минимум 300 мм', () => {
  const { level } = oneRoom();
  setLevelTallWindowOffsets(level, { top: 400, bottom: 100 });
  level.height = 3400;
  const linked = { kind: 'window', heightMode: 'level' };
  assert.equal(openingHeight(linked, level), 2900);
  setLevelTallWindowOffsets(level);
  assert.equal(level.tallWindowHeight, 2900);
  const clamped = setLevelTallWindowOffsets(level, { top: 5000, bottom: 5000 });
  assert.equal(clamped.height, 300);
  assert.equal(clamped.top + clamped.bottom + clamped.height, level.height);
});

test('старый tallWindowHeight мигрирует без сдвига связанного витража', () => {
  const { project, level } = oneRoom();
  level.height = 3400;
  level.tallWindowHeight = 2650;
  delete level.tallWindowTopOffset;
  delete level.tallWindowBottomOffset;
  const opening = createOpening('window', 'R', 0, 2000, 2400);
  opening.heightMode = 'level';
  opening.sill = 50;
  level.openings.push(opening);
  const restored = normalizeProject(JSON.parse(JSON.stringify(project)));
  const nextLevel = activeLevel(restored);
  const nextOpening = nextLevel.openings[0];
  assert.deepEqual(
    [nextLevel.tallWindowBottomOffset, nextLevel.tallWindowTopOffset],
    [50, 700],
  );
  assert.deepEqual([openingSill(nextOpening, nextLevel), openingHeight(nextOpening, nextLevel)], [50, 2650]);
});

test('старые высокие типы без heightMode подключаются, явный custom сохраняется', () => {
  const { project, level } = oneRoom();
  const legacy = createOpening('window', 'R', 0, 1600, 1200);
  legacy.type = 'panoramic';
  delete legacy.heightMode;
  const individual = createOpening('window', 'R', 0, 3400, 1200);
  individual.type = 'panoramic';
  individual.heightMode = 'custom';
  level.openings.push(legacy, individual);
  const restored = normalizeProject(JSON.parse(JSON.stringify(project)));
  assert.deepEqual(restored.openings.map((opening) => opening.heightMode), ['level', 'custom']);
});

test('общие отступы сохраняются в файле проекта v7', () => {
  const { project, level } = oneRoom();
  const opening = createOpening('window', 'R', 0, 2000, 2400);
  opening.heightMode = 'level';
  level.openings.push(opening);
  setLevelTallWindowOffsets(level, { top: 275, bottom: 75 });
  const restored = deserializeProject(serializeProject(project));
  const nextLevel = activeLevel(restored);
  const nextOpening = nextLevel.openings[0];
  assert.deepEqual(
    [nextLevel.tallWindowTopOffset, nextLevel.tallWindowBottomOffset,
      openingSill(nextOpening, nextLevel), openingHeight(nextOpening, nextLevel)],
    [275, 75, 75, 2650],
  );
});

test('3D окна содержит стеклопакет и объёмную алюминиевую раму', () => {
  const { project, level } = oneRoom();
  const opening = createOpening('window', 'R', 0, 2500, 2400);
  opening.type = 'lift-slide';
  opening.sill = 100;
  opening.heightMode = 'level';
  project.openings.push(opening);
  setLevelTallWindowOffsets(level, { top: 0, bottom: 0 });
  const openingVoid = levelWallSolids(project, deriveWalls(project), level.height).voids
    .find((entry) => entry.id === opening.id);
  assert.deepEqual(
    [openingVoid.bottom, openingVoid.top], [0, 3000],
    'нулевые общие отступы не получают скрытый зазор в 3D',
  );
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
