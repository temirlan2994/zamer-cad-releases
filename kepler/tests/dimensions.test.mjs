import test from 'node:test';
import assert from 'node:assert/strict';

import { facadeDimensionStations, shapedRoomDimensionChains } from '../core/dimensions.js';
import { createOpening, createProject, createRoom } from '../core/model.js';
import { computeBuildingOutline } from '../core/rooms.js';
import { deriveWalls } from '../core/walls.js';

function bottomEdge(project, expand) {
  return computeBuildingOutline(project, expand)
    .find((edge) => edge.orient === 'h' && edge.inSide === -1);
}

test('фасадная размерная цепочка включает проёмы и ось внутренней стены', () => {
  const project = createProject('Размерная цепочка');
  const left = createRoom('living', 0, 0, 4000, 3000);
  const right = createRoom('bedroom', 4100, 0, 3000, 3000);
  project.rooms.push(left, right);
  project.openings.push(
    createOpening('window', left.id, 2, 1000, 1200),
    createOpening('door', right.id, 2, 1500, 900),
  );
  const walls = deriveWalls(project);
  const expand = project.settings.exterior;

  assert.deepEqual(
    facadeDimensionStations(project, walls, bottomEdge(project, expand), expand),
    [-250, 400, 1600, 4050, 5150, 6050, 7350],
  );
});

test('цепочка работает при размерах по оси наружной стены', () => {
  const project = createProject('Размеры по оси');
  const left = createRoom('living', 0, 0, 4000, 3000);
  const right = createRoom('bedroom', 4100, 0, 3000, 3000);
  project.rooms.push(left, right);
  project.openings.push(createOpening('window', left.id, 2, 1000, 1200));
  const walls = deriveWalls(project);
  const expand = project.settings.exterior / 2;

  assert.deepEqual(
    facadeDimensionStations(project, walls, bottomEdge(project, expand), expand),
    [-125, 400, 1600, 4050, 7225],
  );
});

test('Г-образное помещение получает наружные цепочки по всем уступам', () => {
  const room = createRoom('living', 1000, 2000, 5000, 4000);
  room.outline = [
    { x: 0, y: 0 }, { x: 1800, y: 0 }, { x: 1800, y: 1200 },
    { x: 3400, y: 1200 }, { x: 3400, y: 2600 }, { x: 5000, y: 2600 },
    { x: 5000, y: 4000 }, { x: 2200, y: 4000 }, { x: 2200, y: 3000 },
    { x: 0, y: 3000 },
  ];

  const chains = shapedRoomDimensionChains(room);
  // Верхняя цепочка — только северные стены, нижняя — только южные.
  assert.deepEqual(chains.horizontal.map((station) => station.value), [1000, 2800, 4400, 6000]);
  assert.deepEqual(chains.bottom.map((station) => station.value), [1000, 3200, 6000]);
  assert.deepEqual(chains.vertical.map((station) => station.value), [2000, 3200, 4600, 6000]);
  assert.deepEqual(chains.left.map((station) => station.value), [2000, 5000, 6000]);
  assert.deepEqual(chains.horizontal.map((station) => station.witness), [2000, 2000, 3200, 4600]);
  assert.deepEqual(chains.bottom.map((station) => station.witness), [5000, 6000, 6000]);
  assert.deepEqual(chains.vertical.map((station) => station.witness), [2800, 4400, 6000, 6000]);
  assert.deepEqual(chains.left.map((station) => station.witness), [1000, 1000, 3200]);
});

test('прямоугольная комната не получает лишние наружные цепочки', () => {
  assert.equal(shapedRoomDimensionChains(createRoom('living', 0, 0, 5000, 4000)), null);
});

test('наружные цепочки Г-комнаты — по наружным граням стен, а не по внутреннему контуру', () => {
  const room = createRoom('living', 1000, 2000, 5000, 4000);
  room.outline = [
    { x: 0, y: 0 }, { x: 1800, y: 0 }, { x: 1800, y: 1200 },
    { x: 3400, y: 1200 }, { x: 3400, y: 2600 }, { x: 5000, y: 2600 },
    { x: 5000, y: 4000 }, { x: 2200, y: 4000 }, { x: 2200, y: 3000 },
    { x: 0, y: 3000 },
  ];
  const inner = shapedRoomDimensionChains(room);
  const outer = shapedRoomDimensionChains(room, 250);
  assert.deepEqual(outer.horizontal.map((s) => s.value), [750, 3050, 4650, 6250]);
  assert.deepEqual(outer.bottom.map((s) => s.value), [750, 2950, 6250]);
  assert.deepEqual(outer.vertical.map((s) => s.value), [1750, 2950, 4350, 6250]);
  assert.deepEqual(outer.left.map((s) => s.value), [1750, 5250, 6250]);
  // общий габарит больше внутреннего ровно на две толщины стены
  assert.equal(outer.maxX - outer.minX, inner.maxX - inner.minX + 500);
  assert.equal(outer.maxY - outer.minY, inner.maxY - inner.minY + 500);
  // ни одна наружная станция не совпадает с внутренней — размеры не повторяются
  for (const key of ['horizontal', 'bottom', 'vertical', 'left']) {
    for (const s of outer[key]) assert.ok(!inner[key].some((i) => Math.abs(i.value - s.value) < 1), `${key}: ${s.value}`);
  }
  // совпавшие вершины после деления стены не ломают смещение
  const split = structuredClone(room);
  split.outline.splice(2, 0, { ...split.outline[1] });
  assert.deepEqual(shapedRoomDimensionChains(split, 250).vertical.map((s) => s.value), [1750, 2950, 4350, 6250]);
});
