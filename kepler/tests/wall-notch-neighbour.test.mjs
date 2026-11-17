// Стена соседа внутри выреза ступенчатой комнаты — обычная наружная, а не
// «перекрытая»: габарит ступенчатой комнаты не должен истончать чужие стены.
import test from 'node:test';
import assert from 'node:assert/strict';

import { createProject, createRoom } from '../core/model.js';
import { deriveWalls } from '../core/walls.js';

test('вырез ступенчатой комнаты не истончает верхнюю стену соседа', () => {
  const project = createProject('вырез');
  const living = createRoom('living', 0, 0, 6000, 6000);
  living.notch = { corner: 'sw', w: 3000, h: 3000 }; // свободен угол x 0..3000, y 3000..6000
  const kitchen = createRoom('kitchen', 0, 3500, 3000, 2500); // целиком в вырезе
  project.rooms.push(living, kitchen);
  const exterior = project.settings?.exterior ?? 250;
  const top = deriveWalls(project).filter((w) => w.kind === 'own' && w.rooms[0] === kitchen.id && w.orient === 'h' && Math.abs(w.edge - 3500) < 2);
  assert.ok(top.length > 0, 'верхняя стена кухни не найдена');
  for (const w of top) assert.equal(w.thickness, exterior, `толщина ${w.thickness} вместо ${exterior}`);
});
