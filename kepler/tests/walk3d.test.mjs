import test from 'node:test';
import assert from 'node:assert/strict';
import { boxFaces } from '../core/mesh3d.js';
import { cameraBasis } from '../core/pick3d.js';
import { stepWalk, walkCamera, walkDirection, walkStart, walkWorld, WALK_EYE, WALK_HEIGHT } from '../core/walk3d.js';

const box = (x0, y0, x1, y1, z0, z1, kind = 'wall') => boxFaces(x0, y0, x1, y1, z0, z1, '#fff', kind);
const player = (x = 0, y = 0, z = 0) => ({ x, y, z, velocityZ: 0 });

test('WASD относительно взгляда; диагональ не ускоряет персонажа', () => {
  assert.deepEqual(walkDirection(0, 1, 0), { x: -1, y: 0 });
  const right = walkDirection(-Math.PI / 2, 0, 1);
  assert.ok(Math.abs(right.x - 1) < 1e-9 && Math.abs(right.y) < 1e-9);
  const diagonal = walkDirection(0.7, 1, 1);
  assert.ok(Math.abs(Math.hypot(diagonal.x, diagonal.y) - 1) < 1e-9);
  assert.deepEqual(walkDirection(0, 0, 0), { x: -0, y: 0 });
});

test('стена останавливает капсулу даже при большом перемещении; вдоль стены можно скользить', () => {
  const world = walkWorld(box(1000, -5000, 1200, 5000, 0, 3000));
  const p = player();
  stepWalk(world, p, 4000, 0, 0.05);
  assert.ok(p.x >= 750 && p.x <= 800);
  stepWalk(world, p, 500, 1000, 0.05);
  assert.ok(p.x <= 800 && p.y > 900);
  assert.equal(p.z, 0);
});

test('дверной проём пропускает персонажа, стекло окна его останавливает', () => {
  const walls = [...box(1000, -5000, 1200, -500, 0, 3000), ...box(1000, 500, 1200, 5000, 0, 3000), ...box(1000, -500, 1200, 500, 2100, 3000)];
  const door = { pts: [{ x: 1100, y: -500, z: 0 }, { x: 1100, y: 500, z: 0 }, { x: 1100, y: 500, z: 2100 }, { x: 1100, y: -500, z: 2100 }], normal: { x: 1, y: 0, z: 0 }, kind: 'door', openingId: 'door' };
  const p = player(); stepWalk(walkWorld([...walls, door]), p, 2000, 0, 0.05);
  assert.equal(p.x, 2000);
  const q = player(); stepWalk(walkWorld([...walls, { ...door, kind: 'glass' }]), q, 2000, 0, 0.05);
  assert.ok(q.x <= 900);
});

test('подъём по ступеням, остановка перед высоким препятствием и плавный спуск', () => {
  const steps = [...box(500, -1000, 1000, 1000, 0, 150, 'stairs'), ...box(1000, -1000, 1500, 1000, 0, 300, 'stairs'), ...box(1500, -1000, 2000, 1000, 0, 450, 'stairs'), ...box(2500, -1000, 3000, 1000, 0, 1100, 'stairs')];
  const world = walkWorld(steps), p = player();
  stepWalk(world, p, 1700, 0, 0.05);
  assert.equal(p.z, 450);
  stepWalk(world, p, 0, 1500, 0.05);
  assert.ok(p.z > 0 && p.z < 450);
  for (let i = 0; i < 30; i++) stepWalk(world, p, 0, 0, 0.05);
  assert.equal(p.z, 0);
  const q = player(2100, 0); stepWalk(world, q, 1000, 0, 0.05);
  assert.ok(q.x <= 2300); assert.equal(q.z, 0);
});

test('потолок учитывает рост; старт на активном этаже выбирает свободное место', () => {
  const floor = (level, z) => ({ pts: [{ x: 0, y: 0, z }, { x: 4000, y: 0, z }, { x: 4000, y: 4000, z }, { x: 0, y: 4000, z }], normal: { x: 0, y: 0, z: 1 }, kind: 'floor', level, roomId: level });
  const faces = [floor('ground', 0), floor('up', 3000), ...box(1400, 1400, 2600, 2600, 3000, 4000, 'furniture')];
  const world = walkWorld(faces);
  const p = walkStart(world, { level: 'up' });
  assert.equal(p.z, 3000);
  assert.equal(world.blocked(p.x, p.y, p.z), false);
  assert.ok(p.x < 1200 || p.x > 2800 || p.y < 1200 || p.y > 2800);
  const ceiling = walkWorld(box(-1000, -1000, 1000, 1000, 1300, 1500, 'slab'));
  assert.equal(ceiling.blocked(0, 0, 0), true);
  assert.equal(walkStart(walkWorld([])).z, 0);
});

test('камера на высоте глаз персонажа 1,7 м при любом наклоне и повороте', () => {
  assert.equal(WALK_HEIGHT, 1700);
  for (const yaw of [-2, 0, 1.3]) for (const pitch of [-1.4, 0, 1.4]) {
    const cam = { yaw, pitch, dist: 25000 };
    walkCamera(cam, player(1200, -900, 3000));
    const { eye } = cameraBasis(cam, 1000, 800);
    assert.ok(Math.abs(eye.x - 1200) < 1e-8);
    assert.ok(Math.abs(eye.y - 900) < 1e-8);
    assert.ok(Math.abs(eye.z - 3000 - WALK_EYE) < 1e-8);
    assert.equal(cam.projection, 'perspective');
  }
});
