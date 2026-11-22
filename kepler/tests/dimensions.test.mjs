import test from 'node:test';
import assert from 'node:assert/strict';

import { facadeDimensionStations } from '../core/dimensions.js';
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

test('контур дома для ступенчатой комнаты идёт по её форме, а сосед в вырезе убирает наружные рёбра', () => {
  const project = createProject('вырез');
  const living = createRoom('living', 0, 0, 6000, 6000);
  living.notch = { corner: 'ne', w: 3000, h: 3000 };
  project.rooms.push(living);
  const edges = computeBuildingOutline(project, 250);
  assert.equal(edges.length, 6, 'Г-контур: 6 рёбер');
  // сосед заполняет вырез — общий контур становится прямоугольником
  const kitchen = createRoom('kitchen', 3000, 0, 3000, 3000);
  project.rooms.push(kitchen);
  assert.equal(computeBuildingOutline(project, 250).length, 4, 'вырез закрыт — 4 ребра');
});
