// Регрессия стыковки стен при пошаговом приближении помещений.
import test from 'node:test';
import assert from 'node:assert/strict';

import { createProject, createRoom } from '../core/model.js';
import { snapRoomPosition } from '../core/rooms.js';
import { deriveWalls } from '../core/walls.js';
import { applyResize } from '../ui/snap.js';
import { state } from '../ui/state.js';

function twoRooms(width = 2700) {
  const project = createProject('Стык стен');
  const left = createRoom('living', 0, 0, width, 3400);
  const stair = createRoom('stairs-room', 3300, 0, 2800, 3400);
  project.rooms.push(left, stair);
  return { project, left, stair };
}

test('общая стена появляется только при зазоре, равном толщине перегородки', () => {
  for (const gap of [600, 450, 420, 300, 170, 1, 0, -250]) {
    const { project, left, stair } = twoRooms(widthForGap(gap));
    assert.equal(stair.x - (left.x + left.w), gap);
    assert.equal(deriveWalls(project).filter((wall) => wall.kind === 'shared').length, 0, `зазор ${gap}`);
  }

  const { project } = twoRooms(3200); // 3300 − 3200 = перегородка 100 мм
  const shared = deriveWalls(project).filter((wall) => wall.kind === 'shared');
  assert.equal(shared.length, 1);
  assert.equal(shared[0].thickness, 100);
});

test('общая стена заполняет зазор при обратном порядке комнат в проекте', () => {
  const project = createProject('Порядок комнат');
  // Реальный порядок из проекта пользователя: сначала правое помещение,
  // затем левое. Раньше полотно 21050…21150 уходило внутрь лестницы, а
  // настоящий зазор 20950…21050 оставался белым.
  const stair = createRoom('stairs-room', 21050, -5350, 4250, 3400);
  const bedroom = createRoom('bedroom', 13200, -5350, 7750, 3400);
  project.rooms.push(stair, bedroom);

  const shared = deriveWalls(project).filter((wall) => wall.kind === 'shared');
  assert.equal(shared.length, 1);
  assert.deepEqual(shared[0].band, { x: 20950, y: -5350, w: 100, h: 3400 });
  assert.equal(shared[0].center.x1, 21000);
  assert.equal(shared[0].center.x2, 21000);
});

function widthForGap(gap) {
  return 3300 - gap;
}

test('перемещение комнаты магнитом оставляет ровно 100 мм под общую стену', () => {
  const { project, left } = twoRooms(2700);
  // Сырая позиция даёт зазор 420 мм; раньше он становился стеной толщиной
  // 420 мм. Теперь помещение сразу попадает в конструктивный зазор 100 мм.
  const snapped = snapRoomPosition(project, left, 180, 0, 140, null);
  assert.equal(snapped.x, 500);
  assert.equal(3300 - (snapped.x + left.w), 100);
});

test('растягивание стены не проходит через промежуточные толщины и не съедает лестницу', () => {
  const previousProject = state.project;
  const previousWalls = state.walls;
  const previousScale = state.view.scale;
  try {
    const { project, left, stair } = twoRooms(2700);
    state.project = project;
    state.walls = deriveWalls(project);
    state.view.scale = 0.1;
    applyResize(left, {
      start: { ...left }, plan: { x: 0, y: 0 }, handle: 'e',
    }, { x: 180, y: 0 });

    assert.equal(left.w, 3200);
    assert.equal(stair.x - (left.x + left.w), 100);
    assert.equal(stair.w, 2800);
    const shared = deriveWalls(project).filter((wall) => wall.kind === 'shared');
    assert.equal(shared.length, 1);
    assert.equal(shared[0].thickness, 100);
  } finally {
    state.project = previousProject;
    state.walls = previousWalls;
    state.view.scale = previousScale;
  }
});
