// Типы дверей и окон, высота потолка комнаты.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createProject, createRoom, createOpening } from '../core/model.js';
import { buildRoomContext } from '../core/furnish.js';
import { addManualWall } from '../core/wall-manual.js';
import { deriveWalls, doorLeaves, doorSwingRect, doorSwingRects } from '../core/walls.js';
import { buildProjectDxf, buildStructuredExport } from '../core/export.js';
import { roomChecks } from '../core/norms.js';
import { buildRoomScheduleCsv } from '../core/schedule.js';

function withDoor(type, width = 1400) {
  const p = createProject();
  const room = createRoom('living', 0, 0, 5000, 4000);
  p.rooms.push(room);
  const door = createOpening('door', room.id, 2, 2500, width);
  if (type) door.type = type;
  p.openings.push(door);
  return { p, room, door };
}
const count = (dxf, name) => dxf.split('\n').filter((l, i, a) => l === name && a[i - 1] === '0').length;

test('створки: одна, две половины от обоих косяков, без створок у раздвижной и проёма', () => {
  for (const [type, n] of [[undefined, 1], ['single', 1], ['double', 2], ['sliding', 0], ['none', 0]]) {
    const { p, door } = withDoor(type);
    assert.equal(doorLeaves(p, door, deriveWalls(p)).length, n, String(type));
  }
  const { p, door } = withDoor('double');
  const [a, b] = doorLeaves(p, door, deriveWalls(p));
  assert.deepEqual([a.hinge.x, b.hinge.x], [1800, 3200]); // косяки проёма 1400 по центру 2500
  assert.equal(Math.hypot(a.closed.x - a.hinge.x, a.closed.y - a.hinge.y), 700);
});

test('двустворчатая дверь на ручной стене разводит половины по host.t', () => {
  const p = createProject();
  p.rooms.push(createRoom('living', 0, 0, 5000, 4000));
  const wall = addManualWall(p, { x: 1000, y: 2000 }, { x: 5000, y: 2000 });
  const door = createOpening('door', null, 0, 0, 1200);
  delete door.side;
  delete door.offset;
  door.roomId = null;
  door.type = 'double';
  door.host = { wallId: wall.id, t: 2000 };
  p.openings.push(door);

  const [left, right] = doorLeaves(p, door, deriveWalls(p));
  assert.deepEqual(
    [left.rect.x + left.rect.w / 2, right.rect.x + right.rect.w / 2],
    [2700, 3300],
  );
  assert.deepEqual([left.hinge.x, right.hinge.x], [2400, 3600]);
  assert.deepEqual([left.closed.x, right.closed.x], [3000, 3000]);
});

test('swing-зона соответствует типу двери, а раздвижной проём остаётся входом маршрута', () => {
  const single = withDoor('single');
  const singleWalls = deriveWalls(single.p);
  assert.equal(doorSwingRects(single.p, single.door, singleWalls).length, 1);
  assert.deepEqual(
    [doorSwingRect(single.p, single.door, singleWalls).w, doorSwingRect(single.p, single.door, singleWalls).h].sort((a, b) => a - b),
    [1400, 1400],
  );

  const double = withDoor('double');
  const doubleWalls = deriveWalls(double.p);
  assert.equal(doorSwingRects(double.p, double.door, doubleWalls).length, 2);
  assert.deepEqual(
    [doorSwingRect(double.p, double.door, doubleWalls).w, doorSwingRect(double.p, double.door, doubleWalls).h].sort((a, b) => a - b),
    [700, 1400],
  );
  double.door.requiredLeafIndices = [0];
  assert.equal(doorSwingRects(double.p, double.door, doubleWalls).length, 1);

  for (const type of ['sliding', 'none']) {
    const { p, room, door } = withDoor(type);
    const walls = deriveWalls(p);
    assert.equal(doorSwingRect(p, door, walls), null);
    const context = buildRoomContext(p, room, walls);
    assert.equal(context.doorCells.length, 1, `${type}: порог остаётся стартом маршрута`);
  }
});

test('DXF: двустворчатая — две дуги, раздвижная — без дуг, проём — пусто', () => {
  assert.equal(count(buildProjectDxf(withDoor('double').p), 'ARC'), 2);
  assert.equal(count(buildProjectDxf(withDoor('sliding').p), 'ARC'), 0);
  assert.equal(count(buildProjectDxf(withDoor('none').p), 'ARC'), 0);
  assert.equal(count(buildProjectDxf(withDoor().p), 'ARC'), 1);
});

test('JSON для Revit: тип, высота и подоконник проёма; высота потолка комнаты', () => {
  const { p, room } = withDoor('sliding');
  const win = createOpening('window', room.id, 0, 2500, 1500);
  win.type = 'panoramic'; win.sill = 100; win.height = 2400;
  p.openings.push(win);
  room.ceiling = 2800;
  const data = buildStructuredExport(p).levels[0];
  assert.deepEqual(data.openings.map((o) => [o.kind, o.type, o.sill, o.height]), [['door', 'sliding', 0, 2100], ['window', 'panoramic', 100, 2400]]);
  assert.equal(data.rooms[0].ceiling_height, 2800);
});

test('высота потолка: своя у комнаты или этаж минус перекрытие', () => {
  const { p, room } = withDoor();
  const level = p.levels[0];
  const h = () => roomChecks(p, room, level).find((c) => c.kind === 'height');
  assert.equal(h().ok, true); // 3000 − 300 = 2700
  room.ceiling = 2400;
  assert.equal(h().ok, false);
  assert.match(buildRoomScheduleCsv(p), /;2,40;да;/);
});
