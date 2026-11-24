import assert from 'node:assert/strict';
import test from 'node:test';
import { planAdjacentRoom } from '../core/adjacent-room.js';
import { createLevel, createOpening, createProject, createRoom, levelProject } from '../core/model.js';
import { setWindowSpan } from '../core/spanning-windows.js';
import { linkedRoofGroups } from '../core/roofs.js';
import { deriveWalls, doorLink } from '../core/walls.js';
import { addManualWall } from '../core/wall-manual.js';

function house() {
  const p = createProject();
  const first = createRoom('living', 500, 750, 5500, 5000);
  p.rooms.push(first);
  p.settings.partition = 150;
  return { p, first };
}

test('пристройка на каждой стороне образует общую стену заданной толщины и одну соединяющую дверь', () => {
  for (const side of [0, 1, 2, 3]) {
    const { p, first } = house();
    const proposal = planAdjacentRoom(p, first.id, 'bedroom', side);
    assert.equal(proposal.ok, true, proposal.reason);
    assert.equal(p.rooms.length, 1, 'предпросмотр не меняет проект');
    p.rooms.push(proposal.room);
    p.openings.push(proposal.door);
    const walls = deriveWalls(p);
    const wall = walls.find((w) => w.kind === 'shared' && w.sides[first.id] === side);
    assert.ok(wall);
    assert.equal(wall.thickness, 150);
    assert.deepEqual(linkedRoofGroups(p)[0].roomIds, [first.id, proposal.room.id].sort());
    assert.deepEqual(new Set(doorLink(p, proposal.door, walls)), new Set([first.id, proposal.room.id]));
    assert.equal(planAdjacentRoom(p, first.id, 'bedroom', side).ok, false, 'свободного места для второй пристройки здесь нет');
  }
});

test('пристройка сохраняет существующую дверь, поддерживает глухую стену и защищает окна', () => {
  const { p, first } = house();
  assert.equal(planAdjacentRoom(p, first.id, 'bedroom', 1, false).door, null);
  const door = createOpening('door', first.id, 1, 2300, 900);
  p.openings.push(door);
  const existing = planAdjacentRoom(p, first.id, 'bedroom', 1);
  assert.equal(existing.ok, true);
  assert.equal(existing.existingDoor, true);
  assert.equal(existing.door, null);
  p.openings[0] = createOpening('window', first.id, 1, 2500, 1800);
  const blocked = planAdjacentRoom(p, first.id, 'bedroom', 1, false);
  assert.equal(blocked.ok, false);
  assert.match(blocked.reason, /окно/);
  assert.equal(planAdjacentRoom(p, first.id, 'bedroom', 3).ok, true);
});

test('защищает обратную створку углового окна и верхнюю часть двухэтажного витража', () => {
  const { p, first } = house();
  const corner = createOpening('window', first.id, 0, 1100, 2200);
  corner.corner = { end: 'from', returnWidth: 2800, joint: 'post' };
  p.openings.push(corner);
  assert.equal(planAdjacentRoom(p, first.id, 'bedroom', 3).ok, false);
  p.openings.length = 0;
  const upper = createLevel('Второй', 3000, 3000, 'L2');
  upper.rooms.push(createRoom('bedroom', first.x, first.y, first.w, first.h));
  p.levels.push(upper);
  const window = createOpening('window', first.id, 1, 2500, 2200);
  p.openings.push(window);
  assert.ok(setWindowSpan(p, p.activeLevel, window, 5200));
  const proposal = planAdjacentRoom(levelProject(p, upper.id), upper.rooms[0].id, 'living', 1);
  assert.equal(proposal.ok, false);
  assert.match(proposal.reason, /окно/);
});

test('использует свободный участок стены сложной формы и сохраняет исходную геометрию', () => {
  const { p, first } = house();
  first.notch = { corner: 'ne', w: 2000, h: 2000 };
  const next = planAdjacentRoom(p, first.id, 'kitchen', 1);
  assert.equal(next.ok, true, next.reason);
  assert.equal(next.room.y, first.y + 2000);
  const occupied = createRoom('bedroom', first.x + first.w + 600, first.y, 3000, 6000);
  p.rooms.push(occupied);
  const blocked = planAdjacentRoom(p, first.id, 'kitchen', 1);
  assert.equal(blocked.ok, false);
  assert.equal(p.rooms.length, 2);
  assert.equal(occupied.w, 3000);
});

test('вставляет кухню в свободный промежуток между окнами даже при занятых торцах и середине фасада', () => {
  const { p, first } = house();
  first.x = 0; first.y = 0; first.w = 18000; first.h = 6500;
  for (const offset of [1400, 9000, 16500]) p.openings.push(createOpening('window', first.id, 0, offset, 1400));
  const proposal = planAdjacentRoom(p, first.id, 'kitchen', 0);
  assert.equal(proposal.ok, true, proposal.reason);
  assert.equal(proposal.room.y, -p.settings.partition - proposal.room.h);
  for (const window of p.openings) {
    assert.ok(proposal.room.x >= window.offset + window.width / 2 + 50 ||
      proposal.room.x + proposal.room.w <= window.offset - window.width / 2 - 50);
  }
});

test('учитывает пересечение с реальной косой стеной', () => {
  const { p, first } = house();
  addManualWall(p, { x: 6500, y: -900 }, { x: 8500, y: 7000 });
  const blocked = planAdjacentRoom(p, first.id, 'kitchen', 1);
  assert.equal(blocked.ok, false);
  assert.match(blocked.reason, /стена/);
  assert.equal(planAdjacentRoom(p, first.id, 'kitchen', 3).ok, true);
});
