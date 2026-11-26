import test from 'node:test';
import assert from 'node:assert/strict';
import { boxFaces, buildHouseMesh, terrainHeightFn } from '../core/mesh3d.js';
import { createItem, createOpening, createProject, createRoom } from '../core/model.js';
import { deriveEntrances } from '../core/entrance.js';
import { applyStairPreset } from '../core/stairs.js';
import { toLocal, toWorld } from '../core/building.js';
import { entryAt } from '../core/site-entries.js';
import { pointInPolygon } from '../core/zamer/geometry.js';
import { cameraBasis } from '../core/pick3d.js';
import { smoothWalkHeight, stepWalk, walkCamera, walkDirection, walkPickFaces, walkSpawnAt, walkStart, walkWorld, WALK_EYE, WALK_HEIGHT } from '../core/walk3d.js';

const box = (x0, y0, x1, y1, z0, z1, kind = 'wall') => boxFaces(x0, y0, x1, y1, z0, z1, '#fff', kind);
const player = (x = 0, y = 0, z = 0) => ({ x, y, z, velocityZ: 0 });
const surface = (x, y, w, h, z, kind = 'floor') => ({ pts: [{ x, y, z }, { x: x+w, y, z }, { x: x+w, y: y+h, z }, { x, y: y+h, z }], normal: { x: 0, y: 0, z: 1 }, kind });

test('точка старта выбирается лучом на земле, полу, балконе и проступи с точной высотой', () => {
  const faces = [surface(-5000, -5000, 10000, 10000, -1000, 'ground'), surface(-1000, -1000, 2000, 2000, 0), surface(2000, -1000, 2000, 2000, 3000), ...box(-2000, 2000, 0, 3000, 0, 180, 'stairs')];
  const world = walkWorld(faces, () => -1000), prepared = walkPickFaces(faces);
  for (const [x, y, z] of [[-4000, 0, -1000], [0, 0, 0], [3000, 0, 3000], [-1000, 2500, 180]]) {
    const start = walkSpawnAt(world, prepared, { o: { x, y, z: 10000 }, d: { x: 0, y: 0, z: -1 } }, .7);
    assert.ok(start); assert.equal(start.x, x); assert.equal(start.y, y); assert.equal(start.z, z);
    assert.equal(start.viewZ, z); assert.equal(start.yaw, .7);
  }
});

test('выбор точки не проходит сквозь стену и не ставит персонажа на крышу или мебель', () => {
  const floor = surface(-4000, -4000, 8000, 8000, 0);
  const wall = [...box(-1200, -1000, -1000, 1000, 0, 3000), floor];
  const ray = { o: { x: -2000, y: 0, z: 1000 }, d: { x: 1, y: 0, z: -.5 } };
  assert.equal(walkSpawnAt(walkWorld(wall), walkPickFaces(wall), ray), null);
  for (const kind of ['roof', 'furniture']) {
    const faces = [floor, ...box(-1000, -1000, 1000, 1000, 500, 1000, kind)];
    assert.equal(walkSpawnAt(walkWorld(faces), walkPickFaces(faces), { o: { x: 0, y: 0, z: 5000 }, d: { x: 0, y: 0, z: -1 } }), null);
  }
});

test('выбор точки учитывает ширину и рост персонажа; в пустом проекте доступна земля', () => {
  const faces = [surface(-2000, -2000, 4000, 4000, 0), ...box(100, -1000, 400, 1000, 0, 3000)];
  const down = { o: { x: 0, y: 0, z: 5000 }, d: { x: 0, y: 0, z: -1 } };
  assert.equal(walkSpawnAt(walkWorld(faces), walkPickFaces(faces), down), null);
  const start = walkSpawnAt(walkWorld([], () => -750), [], down);
  assert.equal(start.z, -750);
  assert.equal(walkSpawnAt(walkWorld([]), [], { ...down, d: { x: 0, y: 0, z: 1 } }), null);
});

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

test('потолок учитывает рост; без границы старт снаружи дома на земле', () => {
  const floor = (level, z) => ({ pts: [{ x: 0, y: 0, z }, { x: 4000, y: 0, z }, { x: 4000, y: 4000, z }, { x: 0, y: 4000, z }], normal: { x: 0, y: 0, z: 1 }, kind: 'floor', level, roomId: level });
  const faces = [floor('ground', 0), floor('up', 3000), ...box(1400, 1400, 2600, 2600, 3000, 4000, 'furniture')];
  const world = walkWorld(faces);
  const p = walkStart(world);
  assert.equal(p.z, 0);
  assert.equal(world.blocked(p.x, p.y, p.z), false);
  assert.ok(p.y > 4000);
  const ceiling = walkWorld(box(-1000, -1000, 1000, 1000, 1300, 1500, 'slab'));
  assert.equal(ceiling.blocked(0, 0, 0), true);
  assert.equal(walkStart(walkWorld([])).z, 0);
});

test('крыльцо на реальных стенах: выход и повторный вход через все стороны при высоком цоколе', () => {
  for (const zero of [900, 1500]) for (const side of [0, 1, 2, 3]) for (const type of ['single', 'balcony-swing']) {
    const project = createProject(); project.envelope.zeroAboveGround = zero;
    const room = createRoom('entrance', 0, 0, 5000, 4000);
    const door = createOpening('door', room.id, side, side % 2 ? 2000 : 2500, 1000);
    door.entryRole = 'main'; door.type = type;
    if (type === 'balcony-swing') door.assembly = { leftWindow: false, rightWindow: false };
    project.rooms.push(room); project.openings.push(door);
    const before = JSON.stringify(project);
    const entrance = deriveEntrances(project)[0], n = entrance.outward, t = entrance.threshold;
    const world = walkWorld(buildHouseMesh(project, { site: true }), terrainHeightFn(project));
    const p = player(t.x-n.x*1000, t.y-n.y*1000, 1);
    const distance = entrance.landing.depth + entrance.steps.run + 1800;
    const count = Math.ceil(distance / 35);
    for (let cycle = 0; cycle < 2; cycle++) {
      for (let i = 0; i < count; i++) stepWalk(world, p, n.x*35, n.y*35, .025);
      for (let i = 0; i < 50; i++) stepWalk(world, p, 0, 0, .025);
      assert.ok(Math.abs(p.z+zero) <= 1, `выход: сторона ${side}, цоколь ${zero}`);
      for (let i = 0; i < count; i++) stepWalk(world, p, -n.x*35, -n.y*35, .025);
      assert.ok(Math.abs(p.z-1) <= 1, `вход: сторона ${side}, цоколь ${zero}`);
      assert.ok(Math.hypot(p.x-(t.x-n.x*1000), p.y-(t.y-n.y*1000)) < 40);
    }
    assert.equal(JSON.stringify(project), before);
  }
});

test('старт перед калиткой: снаружи участка при любом порядке вершин и повороте дома', () => {
  for (const reverse of [false, true]) for (const rotation of [0, 37, 170]) {
    const project = createProject(); project.building = { rotation, origin: { x: 140000, y: -90000 } };
    let boundary = [{ x: -5000, y: -5000 }, { x: 10000, y: -5000 }, { x: 10000, y: 10000 }, { x: -5000, y: 10000 }];
    if (reverse) boundary = boundary.reverse();
    project.site.boundary = boundary.map((p) => toWorld(project.building, p));
    const anchor = toWorld(project.building, { x: 2500, y: -5000 });
    const entry = { id: 'wicket', kind: 'wicket', width: 1000, height: 1800 };
    project.site.entries = [{ ...entry, ...entryAt(project.site, anchor, entry) }];
    project.envelope.zeroAboveGround = 1000;
    const world = walkWorld(buildHouseMesh(project, { site: true, landscape: true }), terrainHeightFn(project));
    const start = walkStart(world, project);
    const target = toLocal(project.building, anchor);
    assert.equal(pointInPolygon(toWorld(project.building, start), project.site.boundary), false);
    assert.ok(Math.abs(start.x-target.x) < 1);
    assert.ok(Math.abs(start.y - (target.y-1200)) < 1);
    assert.equal(start.z, -1000);
    const forward = walkDirection(start.yaw, 1, 0);
    stepWalk(world, start, forward.x*2400, forward.y*2400, .05);
    assert.ok(start.y > target.y+1000, 'через створку можно войти на участок');
  }
});

test('внутренние лестницы: подъём по реальным проступям с плавной высотой взгляда', () => {
  for (const build of ['open', 'closed', 'cantilever']) {
    const project = createProject();
    project.rooms.push(createRoom('stairs-room', -2000, -4000, 4000, 8000));
    const stair = applyStairPreset(createItem('stairs', 0, 0, 1000, 3000), 'straight', 3000);
    stair.stairBuild = build; project.items.push(stair);
    const world = walkWorld(buildHouseMesh(project)), p = { ...player(0, stair.h/2+500, 1), viewZ: 1 };
    let maxJump = 0, lag = false;
    for (let i = 0; i < 135; i++) {
      const before = p.viewZ;
      stepWalk(world, p, 0, -35, .025); smoothWalkHeight(p, .025);
      maxJump = Math.max(maxJump, Math.abs(p.viewZ-before));
      if (p.z-p.viewZ > 20) lag = true;
    }
    assert.ok(p.z > 2800, build);
    assert.ok(maxJump < 100 && lag, 'камера не прыгает на целый подступенок');
    for (let i = 0; i < 60; i++) smoothWalkHeight(p, .025);
    assert.equal(p.viewZ, p.z);
    let descentJump = 0;
    for (let i = 0; i < 135; i++) {
      const before = p.viewZ;
      stepWalk(world, p, 0, 35, .025); smoothWalkHeight(p, .025);
      descentJump = Math.max(descentJump, Math.abs(p.viewZ-before));
    }
    assert.ok(p.z < 2 && descentJump < 100);
  }
});

test('сглаживание высоты не зависит от частоты кадров и доходит до точной отметки', () => {
  const a = { z: 180, viewZ: 0 }, b = { z: 180, viewZ: 0 };
  for (let i = 0; i < 12; i++) smoothWalkHeight(a, 1/60);
  for (let i = 0; i < 6; i++) smoothWalkHeight(b, 1/30);
  assert.ok(Math.abs(a.viewZ-b.viewZ) < 1e-8);
  assert.ok(a.viewZ > 0 && a.viewZ < 180);
  for (let i = 0; i < 60; i++) smoothWalkHeight(a, 1/60);
  assert.equal(a.viewZ, 180);
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
