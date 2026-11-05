import test from 'node:test';
import assert from 'node:assert/strict';

import { isShaft, roomType } from '../core/catalog.js';
import { buildStructuredExport } from '../core/export.js';
import { buildHouseMesh } from '../core/mesh3d.js';
import { createProject, createRoom } from '../core/model.js';
import { MIN_SHAFT_SIZE, roomNetAreaM2, totalAreaM2, validateRoomPlacement } from '../core/rooms.js';
import { deriveWalls } from '../core/walls.js';

function shaftProject() {
  const project = createProject('Дом с шахтой');
  const parent = createRoom('living', 0, 0, 5000, 4000);
  const shaft = createRoom('shaft', 1200, 1000, 1000, 1000);
  shaft.parentId = parent.id;
  project.rooms.push(parent, shaft);
  return { project, parent, shaft };
}

test('«Шахта» размещается внутри, между и снаружи помещений с минимумом 200 мм', () => {
  const project = createProject('Проверка шахты');
  assert.equal(roomType('shaft').title, 'Шахта');
  assert.equal(isShaft({ type: 'shaft' }), true);
  const outside = createRoom('shaft', 0, 0, 1200, 1200);
  assert.equal(MIN_SHAFT_SIZE, 200);
  assert.equal(validateRoomPlacement(project, outside, null).ok, true);
  outside.w = 200; outside.h = 200;
  assert.equal(validateRoomPlacement(project, outside, null).ok, true);
  outside.w = 150;
  assert.equal(validateRoomPlacement(project, outside, null).ok, false);

  const parent = createRoom('living', 0, 0, 5000, 4000);
  project.rooms.push(parent);
  outside.w = 200;
  outside.parentId = parent.id;
  outside.x = 1500; outside.y = 1200;
  assert.equal(validateRoomPlacement(project, outside, null).ok, true);
});

test('шахта между комнатами вырезает площадь обеих и остаётся перегородкой', () => {
  const project = createProject('Шахта между комнатами');
  const left = createRoom('living', 0, 0, 3000, 4000);
  const right = createRoom('kitchen', 3100, 0, 3000, 4000);
  const shaft = createRoom('shaft', 2800, 1000, 500, 600);
  project.rooms.push(left, right, shaft);

  assert.equal(validateRoomPlacement(project, shaft, shaft.id).ok, true);
  assert.equal(roomNetAreaM2(project, left), 11.88);
  assert.equal(roomNetAreaM2(project, right), 11.88);
  const walls = deriveWalls(project).filter((wall) => wall.kind === 'own' && wall.rooms[0] === shaft.id);
  assert.ok(walls.length >= 2);
  assert.ok(walls.every((wall) => wall.thickness === project.settings.partition));

  const crossingWalls = deriveWalls(project).filter((wall) =>
    ['own', 'shared'].includes(wall.kind) && !wall.rooms.includes(shaft.id) &&
    Math.min(wall.band.x + wall.band.w, shaft.x + shaft.w) - Math.max(wall.band.x, shaft.x) > 1 &&
    Math.min(wall.band.y + wall.band.h, shaft.y + shaft.h) - Math.max(wall.band.y, shaft.y) > 1);
  assert.equal(crossingWalls.length, 0);

  const floors = buildHouseMesh(project).filter((face) => face.kind === 'floor');
  for (const point of [{ x: 2900, y: 1300 }, { x: 3200, y: 1300 }]) {
    const covered = floors.some((face) => {
      const xs = face.pts.map((vertex) => vertex.x);
      const ys = face.pts.map((vertex) => vertex.y);
      return point.x > Math.min(...xs) && point.x < Math.max(...xs)
        && point.y > Math.min(...ys) && point.y < Math.max(...ys);
    });
    assert.equal(covered, false);
  }
});

test('шахта вычитается из полезной площади и получает четыре стены', () => {
  const { project, parent, shaft } = shaftProject();
  assert.equal(roomNetAreaM2(project, shaft), 0);
  assert.equal(roomNetAreaM2(project, parent), 18.56);
  assert.equal(totalAreaM2(project), 18.56);
  const walls = deriveWalls(project).filter((wall) => wall.kind === 'own' && wall.rooms[0] === shaft.id);
  assert.equal(walls.length, 4);
  assert.ok(walls.every((wall) => wall.thickness === project.settings.partition));
});

test('в 3D у шахты нет пола, а в перекрытии родителя остаётся отверстие', () => {
  const { project, shaft } = shaftProject();
  const floors = buildHouseMesh(project).filter((face) => face.kind === 'floor');
  assert.equal(floors.some((face) => face.roomId === shaft.id), false);
  const center = { x: shaft.x + shaft.w / 2, y: shaft.y + shaft.h / 2 };
  const coversCenter = floors.some((face) => {
    const xs = face.pts.map((point) => point.x);
    const ys = face.pts.map((point) => point.y);
    return center.x > Math.min(...xs) && center.x < Math.max(...xs)
      && center.y > Math.min(...ys) && center.y < Math.max(...ys);
  });
  assert.equal(coversCenter, false);
});

test('структурированный экспорт помечает шахту как проём', () => {
  const { project, shaft } = shaftProject();
  const out = buildStructuredExport(project).levels[0].rooms.find((room) => room.id === shaft.id);
  assert.equal(out.void, true);
  assert.equal(out.net_area_m2, 0);
});
