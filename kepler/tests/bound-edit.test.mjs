// Помещение по стенам правится «как обычное»: правки сторон, углов, размеров,
// переноса, поворота и копии транслируются в правки его ручных стен.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  boundEdges, boundHandleMoves, boundLoopWalls, moveBoundRoomEdges, resizeBoundRoom,
} from '../core/bound-edit.js';
import { createBoundRoom, resolveBoundRooms } from '../core/bound-rooms.js';
import { createItem, createOpening, createProject, createRoom } from '../core/model.js';
import { roomShapeArea, roomShapeHandles } from '../core/room-shape.js';
import { captureRoomGroup, moveRoomGroup, planGroupCopy, rotateRoomGroup } from '../core/room-group.js';
import { planRoomDuplicate } from '../core/duplicate-room.js';
import { addManualWall } from '../core/wall-manual.js';
import { deriveWalls, openingRect, wallsEngine } from '../core/walls.js';
import { checkWallInvariants } from './wall-invariants-lib.mjs';

const T = 200;
const rectPts = (x, y, w, h) => [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }];
const L_PTS = [{ x: 0, y: 0 }, { x: 6000, y: 0 }, { x: 6000, y: 3000 }, { x: 3000, y: 3000 }, { x: 3000, y: 5000 }, { x: 0, y: 5000 }];

function loop(p, pts) {
  return pts.map((a, i) => addManualWall(p, a, pts[(i + 1) % pts.length], { thickness: T, wallType: 'exterior' }));
}

function make(p, at) {
  const res = createBoundRoom(p, deriveWalls(p), at);
  assert.ok(res.ok, res.reason);
  resolveBoundRooms(p, deriveWalls(p));
  return res.room;
}

function refresh(p) {
  const walls = deriveWalls(p);
  resolveBoundRooms(p, walls);
  return walls;
}

const box = (r) => ({ x: r.x, y: r.y, w: r.w, h: r.h });
const room = (p, id) => p.rooms.find((r) => r.id === id);

function invariantsOk(p) {
  const res = checkWallInvariants(p, refresh(p));
  // v1 — устаревший движок с известными дефектами (tests/wall-invariants.test.mjs).
  const known = wallsEngine(p) === 'v1' ? ['area', 'intrusion'] : [];
  for (const [k, v] of Object.entries(res)) {
    if (!known.includes(k)) assert.ok(v.ok, `${k}: ${JSON.stringify(v.sample)}`);
  }
}

test('сторона: ручка тянет стену, соседние стены удлиняются, контур в свету', () => {
  const p = createProject('сторона');
  loop(p, rectPts(0, 0, 5000, 4000));
  const r = make(p, { x: 2500, y: 2000 });
  assert.deepEqual(box(r), { x: 100, y: 100, w: 4800, h: 3800 });
  const east = boundEdges(r).find((e) => e.orient === 'v' && e.outward > 0);
  const handle = roomShapeHandles(r).find((h) => h.kind === 'edge' && h.index === east.index);
  assert.ok(handle?.bound);
  const moves = boundHandleMoves(r, handle, { x: 5900, y: 2000 });
  assert.deepEqual(moves, [{ index: east.index, delta: 1000 }]);
  const res = moveBoundRoomEdges(p, r.id, moves);
  assert.ok(res.ok, res.reason);
  refresh(p);
  assert.deepEqual(box(room(p, r.id)), { x: 100, y: 100, w: 5800, h: 3800 });
  // Ось правой стены — на 6000, верхняя и нижняя дотянулись.
  const xs = p.walls.flatMap((w) => [w.axis.a.x, w.axis.b.x]);
  assert.equal(Math.max(...xs), 6000);
  assert.equal(p.walls.filter((w) => w.axis.a.x === 6000 || w.axis.b.x === 6000).length, 3);
  invariantsOk(p);
  // Размеры в свойствах — тот же механизм.
  assert.ok(resizeBoundRoom(p, r.id, { w: 4000, h: 3000 }).ok);
  refresh(p);
  assert.deepEqual(box(room(p, r.id)), { x: 100, y: 100, w: 4000, h: 3000 });
  // Слишком маленькое — отказ, проект не меняется.
  const before = JSON.stringify(p.walls);
  assert.equal(resizeBoundRoom(p, r.id, { w: 50 }).ok, false);
  assert.equal(JSON.stringify(p.walls), before);
});

test('угол Г-образного: внутренний угол двигает две стены', () => {
  const p = createProject('Г');
  loop(p, L_PTS);
  const r = make(p, { x: 1000, y: 1000 });
  const area0 = roomShapeArea(r);
  // Внутренний угол — вершина (2900, 2900): грани стен по осям 3000.
  const handle = roomShapeHandles(r).find((h) => h.kind === 'vertex' && h.x === 2900 && h.y === 2900);
  assert.ok(handle, JSON.stringify(r.poly));
  const res = moveBoundRoomEdges(p, r.id, boundHandleMoves(r, handle, { x: 3900, y: 3400 }));
  assert.ok(res.ok, res.reason);
  refresh(p);
  const now = room(p, r.id);
  assert.ok(!now.boundIssue);
  assert.equal(now.poly.length, 6);
  assert.ok(now.poly.some((q) => q.x === 3900 && q.y === 3400), JSON.stringify(now.poly));
  assert.equal(area0, 21.84e6);
  assert.equal(roomShapeArea(now), 5800 * 3300 + 3800 * 1500);
  invariantsOk(p);
});

test('перенос и поворот: стены петли, проём host, мебель и seed едут с помещением', () => {
  const p = createProject('перенос');
  const walls = loop(p, rectPts(0, 0, 5000, 4000));
  const r = make(p, { x: 2500, y: 2000 });
  const door = createOpening('door', null, null, 0, 900);
  delete door.side; delete door.offset; door.roomId = null;
  door.host = { wallId: walls[0].id, t: 2500 };
  p.openings.push(door);
  const sofa = createItem('sofa', 2000, 2000, 2000, 900);
  p.items.push(sofa);
  const area0 = roomShapeArea(r);
  const mv = moveRoomGroup(p, [r.id], [], 1000, 500);
  assert.ok(mv.ok, mv.reason);
  refresh(p);
  assert.deepEqual(box(room(p, r.id)), { x: 1100, y: 600, w: 4800, h: 3800 });
  assert.equal(roomShapeArea(room(p, r.id)), area0);
  assert.deepEqual([sofa.x, sofa.y], [3000, 2500]);
  const placed = openingRect(p, door, deriveWalls(p));
  assert.equal(Math.round(placed.absCenter), 3500);
  // Поворот на 90° вокруг центра группы.
  const rot = rotateRoomGroup(p, [r.id], []);
  assert.ok(rot.ok, rot.reason);
  refresh(p);
  const turned = room(p, r.id);
  assert.equal(turned.w, 3800);
  assert.equal(turned.h, 4800);
  assert.ok(!turned.boundIssue);
  assert.equal(sofa.rotation, 90);
  assert.ok(openingRect(p, door, deriveWalls(p)));
  invariantsOk(p);
});

test('копия (Ctrl+D, буфер, другой этаж): стены петли с проёмами, новый seed, площадь та же', () => {
  const p = createProject('копия');
  const walls = loop(p, rectPts(0, 0, 5000, 4000));
  const r = make(p, { x: 2500, y: 2000 });
  const door = createOpening('door', null, null, 0, 900);
  door.roomId = null; delete door.side; delete door.offset;
  door.host = { wallId: walls[1].id, t: 2000 };
  p.openings.push(door);
  const plan = planRoomDuplicate(p, r.id);
  assert.ok(plan.ok, plan.reason);
  assert.equal(plan.walls.length, 4);
  assert.equal(plan.openings.length, 1);
  assert.ok(plan.walls.every((w) => !walls.some((s) => s.id === w.id)));
  assert.equal(plan.openings[0].host.wallId, plan.walls.find((w) => w.axis.a.x === walls[1].axis.a.x + plan.dx).id);
  p.walls.push(...plan.walls); p.rooms.push(...plan.rooms); p.openings.push(...plan.openings);
  refresh(p);
  const copy = plan.rooms[0];
  assert.notEqual(copy.bound.seed.x, r.bound.seed.x);
  assert.ok(!copy.boundIssue && !r.boundIssue);
  assert.equal(roomShapeArea(copy), roomShapeArea(r));
  invariantsOk(p);
  // Вставка группы на другом этаже — на то же место.
  const clip = captureRoomGroup(p, [r.id]);
  assert.equal(clip.walls.length, 4);
  p.levels.push({ ...structuredClone(p.levels[0]), id: 'lvl2', rooms: [], walls: [], openings: [], items: [] });
  p.activeLevel = 'lvl2';
  const other = planGroupCopy(p, clip);
  assert.ok(other.ok, other.reason);
  assert.deepEqual([other.dx, other.dy], [0, 0]);
});

test('общая стена с невыбранным помещением: перенос — отказ с причиной; сторона — сосед следует', () => {
  const p = createProject('два');
  loop(p, rectPts(0, 0, 8000, 4000));
  addManualWall(p, { x: 4000, y: 0 }, { x: 4000, y: 4000 }, { thickness: 100 });
  const a = make(p, { x: 2000, y: 2000 });
  const b = make(p, { x: 6000, y: 2000 });
  assert.ok(boundLoopWalls(p, a).size >= 4);
  const before = JSON.stringify(p.walls);
  const mv = moveRoomGroup(p, [a.id], [], 500, 0);
  assert.equal(mv.ok, false);
  assert.match(mv.reason, /общая/);
  assert.equal(JSON.stringify(p.walls), before);
  // Вдвоём — можно.
  assert.ok(moveRoomGroup(p, [a.id, b.id], [], 0, 1000).ok);
  refresh(p);
  // Правая сторона A — общая перегородка: B сужается.
  const ra = room(p, a.id);
  const east = boundEdges(ra).find((e) => e.orient === 'v' && e.outward > 0);
  const res = moveBoundRoomEdges(p, a.id, [{ index: east.index, delta: 1000 }]);
  assert.ok(res.ok, res.reason);
  refresh(p);
  assert.equal(room(p, a.id).w, 3850 + 1000);
  assert.equal(room(p, b.id).w, 3850 - 1000);
  assert.ok(!room(p, b.id).boundIssue);
});

test('контур замыкает блок-комната (v1 и v2): перенос — отказ с причиной, проект цел', () => {
  const env = process.env.KEPLER_WALLS;
  for (const engine of ['v1', 'v2']) {
    process.env.KEPLER_WALLS = engine;
    try {
      const P = 100;
      const p = createProject('двор');
      p.rooms.push(createRoom('living', 0, 0, 9000, 3000));
      p.rooms.push(createRoom('bedroom', 0, 3000 + P, 3000, 3000));
      p.rooms.push(createRoom('bedroom', 6000, 3000 + P, 3000, 3000));
      p.rooms.push(createRoom('kitchen', 0, 6000 + 2 * P, 9000, 3000));
      const yard = make(p, { x: 4500, y: 4500 });
      const before = JSON.stringify(p.rooms);
      const res = moveRoomGroup(p, [yard.id], [], 1000, 0);
      assert.equal(res.ok, false, engine);
      assert.match(res.reason, /замыкают стены других помещений/);
      assert.equal(JSON.stringify(p.rooms), before);
      const side = moveBoundRoomEdges(p, yard.id, [{ index: 0, delta: 500 }]);
      assert.equal(side.ok, false);
      assert.ok(side.reason);
      // Вместе с блоками — едет.
      assert.ok(moveRoomGroup(p, p.rooms.map((r) => r.id), [], 0, 1000).ok, engine);
      invariantsOk(p);
    } finally {
      if (env === undefined) delete process.env.KEPLER_WALLS; else process.env.KEPLER_WALLS = env;
    }
  }
});
