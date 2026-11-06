// Норма «Помещения перекрываются» (docs/walls-v2-architecture.md, раздел 5).
import test from 'node:test';
import assert from 'node:assert/strict';

import { createProject, createRoom } from '../core/model.js';
import { normsReport, roomOverlaps, trimRoomBy } from '../core/norms.js';
import { roomShapeArea } from '../core/room-shape.js';

function overlapPair() {
  const p = createProject('перекрытие');
  const a = createRoom('living', 0, 0, 5000, 4000);
  const b = createRoom('kitchen', 4000, 1000, 3000, 3000);
  p.rooms.push(a, b);
  return { p, a, b };
}

test('перекрытие: ровно одно замечание у верхней комнаты, с зоной и «Обрезать»', () => {
  const { p, a, b } = overlapPair();
  const report = normsReport(p);
  const overlaps = report.problems.filter((x) => x.kind === 'overlap');
  assert.equal(overlaps.length, 1);
  assert.equal(overlaps[0].room.id, b.id);
  assert.match(overlaps[0].text, /перекрываются \(3,00 м²\)/);
  assert.deepEqual(overlaps[0].rects, [{ x: 4000, y: 1000, w: 1000, h: 3000 }]);
  assert.equal(overlaps[0].trim.roomId, a.id);
  assert.equal(report.overlaps.length, 1);
});

test('«Обрезать»: нижняя комната теряет зону перекрытия, замечание уходит', () => {
  const { p, a, b } = overlapPair();
  assert.ok(trimRoomBy(a, b));
  assert.equal(roomShapeArea(a), 5000 * 4000 - 1000 * 3000, 'Г-образная без зоны перекрытия');
  assert.equal(roomOverlaps(p).length, 0);
  // Комната целиком внутри другой — обрезать нельзя (дыра), комната не тронута.
  const q = createProject();
  const big = createRoom('living', 0, 0, 6000, 6000);
  const small = createRoom('kitchen', 2000, 2000, 2000, 2000);
  q.rooms.push(big, small);
  assert.equal(trimRoomBy(big, small), false);
  assert.equal(big.outline, undefined);
});

test('вложенные, шахты и терраса — не перекрытие', () => {
  const p = createProject();
  const room = createRoom('living', 0, 0, 6000, 5000);
  const nested = createRoom('bathroom', 500, 500, 2000, 2000);
  nested.parentId = room.id;
  const shaft = createRoom('shaft', 4000, 1000, 600, 600);
  const terrace = createRoom('terrace', 5000, 0, 3000, 5000);
  p.rooms.push(room, nested, shaft, terrace);
  assert.equal(roomOverlaps(p).length, 0);
});
