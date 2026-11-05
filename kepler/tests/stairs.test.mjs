import test from 'node:test';
import assert from 'node:assert/strict';

import { buildHouseMesh } from '../core/mesh3d.js';
import { createItem, createProject, createRoom } from '../core/model.js';
import { applyStairPreset, stairCalculation, stairPreset } from '../core/stairs.js';

test('быстрые формы лестницы подбирают компактные габариты', () => {
  const straight = stairPreset('straight', 3000);
  const turn = stairPreset('l', 3000);
  const u = stairPreset('u', 3000);
  assert.equal(straight.w, 1000);
  assert.ok(straight.h > u.h, 'П-образная лестница короче прямой');
  assert.ok(turn.w > 2500 && turn.h > 2500);
  assert.deepEqual(u, { w: 2200, h: 3250 });
});

test('автоподбор даёт удобные ступени под высоту этажа', () => {
  const stair = createItem('stairs', 0, 0, 1000, 3000);
  applyStairPreset(stair, 'u', 3000);
  const calc = stairCalculation(stair);
  assert.equal(calc.shape, 'u');
  assert.ok(calc.okRiser);
  assert.ok(calc.okTread);
  assert.ok(calc.okComfort);
  assert.ok(calc.risers >= 16 && calc.risers <= 18);
});

test('лестница создаёт настоящие ступени в 3D', () => {
  const project = createProject('Лестница в 3D');
  const room = createRoom('stairs-room', 0, 0, 2400, 3500);
  const stair = createItem('stairs', 1200, 1750, 2200, 3250);
  applyStairPreset(stair, 'u', 3000);
  project.rooms.push(room);
  project.items.push(stair);
  const faces = buildHouseMesh(project).filter((face) => face.kind === 'stairs');
  assert.ok(faces.length > 40);
  assert.ok(faces.every((face) => face.itemId === stair.id));
  const top = Math.max(...faces.flatMap((face) => face.pts.map((point) => point.z)));
  assert.ok(top > 2700 && top < 3000);
});
