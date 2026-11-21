import test from 'node:test';
import assert from 'node:assert/strict';

import { createProject, createRoom } from '../core/model.js';
import {
  WALL_SPLIT_MIN_GAP, nearestWallSplitEnd, roomPolygon, roomShapeArea, splitRoomOutlineWall, wallSplitAt,
} from '../core/room-shape.js';
import { deriveWalls } from '../core/walls.js';

function boxProject() {
  const project = createProject('Деление стены');
  const room = createRoom('living', 1000, 2000, 8000, 5000);
  project.rooms.push(room);
  const own = deriveWalls(project).filter((wall) => wall.kind === 'own' && wall.rooms[0] === room.id);
  return { project, room, top: own.find((w) => w.sides[room.id] === 0), right: own.find((w) => w.sides[room.id] === 1) };
}

test('горизонтальная стена: отсчёт от левого (from) и правого (to) торца', () => {
  const { top } = boxProject();
  const lo = Math.min(top.from, top.to); const hi = Math.max(top.from, top.to);
  const left = wallSplitAt(top, 'from', 1500);
  assert.equal(left.ok, true);
  assert.equal(left.at, lo + 1500);
  const right = wallSplitAt(top, 'to', 1500);
  assert.equal(right.ok, true);
  assert.equal(right.at, hi - 1500);
  assert.equal(left.length, hi - lo);
});

test('вертикальная стена: отсчёт от верхнего (from) и нижнего (to) торца', () => {
  const { right } = boxProject();
  const lo = Math.min(right.from, right.to); const hi = Math.max(right.from, right.to);
  assert.equal(wallSplitAt(right, 'from', 1200).at, lo + 1200);
  assert.equal(wallSplitAt(right, 'to', 1200).at, hi - 1200);
});

test('границы: не ближе 100 мм к любому торцу', () => {
  const { top } = boxProject();
  const length = Math.abs(top.to - top.from);
  for (const end of ['from', 'to']) {
    assert.equal(wallSplitAt(top, end, WALL_SPLIT_MIN_GAP - 1).ok, false);
    assert.equal(wallSplitAt(top, end, WALL_SPLIT_MIN_GAP).ok, true);
    assert.equal(wallSplitAt(top, end, length - WALL_SPLIT_MIN_GAP).ok, true);
    assert.equal(wallSplitAt(top, end, length - WALL_SPLIT_MIN_GAP + 1).ok, false);
    assert.equal(wallSplitAt(top, end, -50).ok, false);
  }
  const r = wallSplitAt(top, 'from', 99);
  assert.equal(r.min, 100);
  assert.equal(r.max, length - 100);
  assert.equal(wallSplitAt(top, 'from', NaN).ok, false);
  assert.equal(wallSplitAt(top, 'left', 500).ok, false, 'неизвестный торец');
  const short = wallSplitAt({ from: 0, to: 150 }, 'from', 100);
  assert.equal(short.ok, false, 'стена короче 200 мм не делится');
  assert.ok(short.max < short.min);
});

test('торцы не зависят от порядка from/to в объекте стены', () => {
  const straight = { from: 1000, to: 9000 };
  const reversed = { from: 9000, to: 1000 };
  assert.equal(wallSplitAt(reversed, 'from', 700).at, wallSplitAt(straight, 'from', 700).at);
  assert.equal(wallSplitAt(reversed, 'to', 700).at, 8300);
});

test('ближайший торец к точке клика', () => {
  const wall = { from: 1000, to: 9000 };
  assert.deepEqual(nearestWallSplitEnd(wall, 2500), { end: 'from', distance: 1500 });
  assert.deepEqual(nearestWallSplitEnd(wall, 7000), { end: 'to', distance: 2000 });
  assert.deepEqual(nearestWallSplitEnd(wall, undefined), { end: 'from', distance: 4000 });
  assert.deepEqual(nearestWallSplitEnd(wall, 99999), { end: 'to', distance: 0 });
});

test('деление по торцу и расстоянию при повёрнутой нумерации контура', () => {
  // Г-образный контур, обход начат с другой вершины и в обратную сторону.
  const base = [{ x: 0, y: 0 }, { x: 8000, y: 0 }, { x: 8000, y: 3000 }, { x: 5000, y: 3000 }, { x: 5000, y: 5000 }, { x: 0, y: 5000 }];
  const shifted = [...base.slice(3), ...base.slice(0, 3)].reverse();
  const project = createProject('Повёрнутая нумерация');
  const room = createRoom('living', 0, 0, 8000, 5000);
  room.outline = shifted;
  project.rooms.push(room);
  const area = roomShapeArea(room);
  const top = deriveWalls(project).find((w) => w.kind === 'own' && w.orient === 'h' && Math.abs(w.edge) < 1);
  assert.ok(top, 'верхняя стена найдена');
  const hi = Math.max(top.from, top.to);
  const { ok, at } = wallSplitAt(top, 'to', 2000);
  assert.equal(ok, true);
  assert.equal(splitRoomOutlineWall(room, top, at), true);
  const points = roomPolygon(room);
  assert.equal(points.length, 8);
  const hits = points.filter((p) => Math.abs(p.x - (hi - 2000)) < 0.5 && Math.abs(p.y) < 0.5);
  assert.equal(hits.length, 2, 'две совпадающие вершины в точке деления');
  assert.equal(roomShapeArea(room), area, 'форма не изменилась');
});
