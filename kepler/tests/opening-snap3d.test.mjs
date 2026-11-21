import test from 'node:test';
import assert from 'node:assert/strict';

import { createLevel, createOpening, createProject, createRoom, levelProject } from '../core/model.js';
import { lowerOpeningTargets, snapOpeningToLower } from '../core/opening-snap3d.js';
import { deriveWalls } from '../core/walls.js';

function house() {
  const project = createProject('Привязка проёмов');
  const room1 = createRoom('living', 0, 0, 6000, 4000);
  project.rooms.push(room1);
  const window1 = createOpening('window', room1.id, 0, 2200, 1600);
  window1.height = 1400;
  window1.sill = 850;
  project.openings.push(window1);
  const l2 = createLevel('2 этаж', 3000, 3000, 'L2');
  const room2 = createRoom('bedroom', 0, 0, 6000, 4000);
  l2.rooms.push(room2);
  project.levels.push(l2);
  const lp2 = levelProject(project, 'L2');
  const wall = deriveWalls(lp2).find((w) => w.rooms?.includes(room2.id) && w.orient === 'h' && w.edge < 1);
  return { project, wall, window1 };
}

test('цели межэтажной привязки собираются только с той же стены', () => {
  const { project, wall, window1 } = house();
  const room = project.levels[0].rooms[0];
  project.levels[0].openings.push(createOpening('window', room.id, 1, 1500, 900));
  const targets = lowerOpeningTargets(project, 'L2', wall);
  assert.equal(targets.length, 1);
  assert.equal(targets[0].id, window1.id);
  assert.equal(targets[0].levelId, 'L1');
  assert.equal(targets[0].center, 2200);
  assert.equal(targets[0].from, 1400);
  assert.equal(targets[0].to, 3000);
});

test('центр верхнего окна липнет к нижнему и копирует размеры', () => {
  const { project, wall } = house();
  const targets = lowerOpeningTargets(project, 'L2', wall);
  const opening = createOpening('window', 'x', 0, 0, 1000);
  const result = snapOpeningToLower(opening, 2260, targets, 100);
  assert.ok(result.snapped);
  assert.equal(result.center, 2200);
  assert.equal(result.opening.width, 1600);
  assert.equal(result.opening.height, 1400);
  assert.equal(result.opening.sill, 850);
  assert.equal(result.sourceLevelId, 'L1');
  assert.match(result.label, /размер как у окна/);
});

test('край проёма липнет отдельно; Shift-эквивалент с нулевым допуском не липнет', () => {
  const { project, wall } = house();
  const targets = lowerOpeningTargets(project, 'L2', wall);
  const opening = createOpening('door', 'x', 0, 0, 900);
  const edge = snapOpeningToLower(opening, 3460, targets, 20); // правый край 3910 — не рядом
  assert.equal(edge.snapped, false);
  const window = createOpening('window', 'x', 0, 0, 1000);
  const left = snapOpeningToLower(window, 1910, targets, 20); // левый край 1410 ≈ 1400
  assert.ok(left.snapped);
  assert.equal(left.mode, 'from');
  assert.equal(left.center, 2200, 'после копирования ширины левый край остаётся на линии низа');
  assert.equal(snapOpeningToLower(window, 2200, targets, 0).snapped, false);
});
