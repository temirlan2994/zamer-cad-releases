import test from 'node:test';
import assert from 'node:assert/strict';

import { createProject, createRoom } from '../core/model.js';
import { moveWallBy, wallRoomDimensions } from '../core/wall-edit.js';
import { deriveWalls } from '../core/walls.js';
import { liftRoom, reconcileEats } from '../core/v7/eat-bridge.js';

function sharedProject() {
  const project = createProject('Движение стен');
  const left = createRoom('living', 0, 0, 4000, 3000);
  const right = createRoom('bedroom', 4100, 0, 5000, 3000);
  project.rooms.push(left, right);
  const wall = deriveWalls(project).find((candidate) => candidate.kind === 'shared');
  return { project, left, right, wall };
}

test('общая стена двигает обе границы и сохраняет перегородку 100 мм', () => {
  const { project, left, right, wall } = sharedProject();
  const result = moveWallBy(project, wall, 500, { finalize: true });
  assert.equal(result.ok, true);
  assert.deepEqual({ x: left.x, w: left.w }, { x: 0, w: 4500 });
  assert.deepEqual({ x: right.x, w: right.w }, { x: 4600, w: 4500 });
  const next = deriveWalls(project).find((candidate) => candidate.kind === 'shared');
  assert.deepEqual(next.band, { x: 4500, y: 0, w: 100, h: 3000 });
});

test('собственная стена меняет только соответствующий габарит помещения', () => {
  const project = createProject('Наружная стена');
  const room = createRoom('living', 1000, 2000, 4000, 3000);
  project.rooms.push(room);
  const wall = deriveWalls(project).find((candidate) => candidate.kind === 'own' && candidate.sides[room.id] === 3);
  const result = moveWallBy(project, wall, -500, { finalize: true });
  assert.equal(result.ok, true);
  assert.deepEqual({ x: room.x, y: room.y, w: room.w, h: room.h }, { x: 500, y: 2000, w: 4500, h: 3000 });
});

test('у общей стены выводятся редактируемые размеры обоих помещений', () => {
  const { project, left, right, wall } = sharedProject();
  const dims = wallRoomDimensions(project, wall);
  assert.equal(dims.length, 2);
  assert.deepEqual(new Map(dims.map((dim) => [dim.roomId, dim.distance])), new Map([
    [left.id, 4000], [right.id, 5000],
  ]));

  const leftDim = dims.find((dim) => dim.roomId === left.id);
  const target = leftDim.opposite.edge + leftDim.edge.outward * 4500;
  assert.equal(moveWallBy(project, wall, target - leftDim.edge.edge, { finalize: true }).ok, true);
  assert.equal(left.w, 4500);
  assert.equal(right.w, 4500);
});

// Грань гардеробной лишь частично общая с Г-холлом (жалоба: «стена не
// двигается, когда часть стены наружная и часть внутренняя»).
test('частично общий участок: съеденный Г-холл — едет грань съевшей, холл следует', () => {
  const make = () => {
    const project = createProject('Г-холл');
    const hall = createRoom('hall', 0, 0, 6000, 4000); hall.id = 'H';
    const ward = createRoom('wardrobe', -1000, 3000, 2800, 1900); ward.id = 'G';
    project.rooms.push(hall, ward);
    reconcileEats(project);
    return { project, hall, ward };
  };
  for (const delta of [-300, 300]) {
    const { project, hall, ward } = make();
    assert.ok(hall.eatBase, 'холл съеден');
    const wall = deriveWalls(project).find((w) => w.kind === 'shared' && w.orient === 'h');
    for (const id of wall.rooms) liftRoom(project, id); // как liftForGesture
    const res = moveWallBy(project, wall, delta);
    assert.equal(res.ok, true, res.reason);
    assert.deepEqual({ y: ward.y, h: ward.h }, { y: 3000 + delta, h: 1900 - delta });
    assert.deepEqual({ x: hall.x, y: hall.y, w: hall.w, h: hall.h }, { x: 0, y: 0, w: 6000, h: 4000 }, 'номинал холла');
    reconcileEats(project, { touched: wall.rooms });
    const next = deriveWalls(project).find((w) => w.kind === 'shared' && w.orient === 'h');
    assert.equal(next.band.y + next.band.h, 3000 + delta, 'общая стена у новой грани');
  }
});

test('частично общий участок: Г-холл с вырезом — низ холла и верх гардеробной вместе', () => {
  const project = createProject('Г-холл');
  const hall = createRoom('hall', 0, 0, 6000, 4000); hall.notch = { corner: 'sw', w: 3000, h: 2000 };
  const ward = createRoom('wardrobe', 1500, 4100, 2800, 1900);
  project.rooms.push(hall, ward);
  const wall = deriveWalls(project).find((w) => w.kind === 'shared');
  assert.deepEqual([wall.from, wall.to], [3000, 4300], 'общая только часть верха гардеробной');
  assert.equal(moveWallBy(project, wall, -300).ok, true);
  assert.equal(ward.y, 3800);
  assert.equal(hall.h, 3700);
  assert.equal(ward.y - (hall.y + hall.h), 100, 'перегородка 100');
});

test('стена не сжимает помещение меньше минимального размера', () => {
  const { project, left, right, wall } = sharedProject();
  const before = JSON.stringify(project.rooms);
  const result = moveWallBy(project, wall, 4500);
  assert.equal(result.ok, false);
  assert.equal(JSON.stringify(project.rooms), before);
  assert.equal(left.w, 4000);
  assert.equal(right.w, 5000);
});
