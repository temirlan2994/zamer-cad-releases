// Типы дверей и окон, высота потолка комнаты.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createProject, createRoom, createOpening } from '../core/model.js';
import { deriveWalls, doorLeaves } from '../core/walls.js';
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
