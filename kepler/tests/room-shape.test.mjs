import test from 'node:test';
import assert from 'node:assert/strict';

import { buildStructuredExport } from '../core/export.js';
import { buildHouseMesh } from '../core/mesh3d.js';
import { createProject, createRoom } from '../core/model.js';
import { computeBuildingOutline, computeRoomEdges, roomNetAreaM2 } from '../core/rooms.js';
import {
  applyRoomShapeHandle, finalizeRoomOutline, roomContainsPoint, roomPolygon, roomRects,
  roomShapeArea, roomShapeHandles, splitRoomOutlineWall,
} from '../core/room-shape.js';
import { deriveWalls } from '../core/walls.js';

function lRoomProject() {
  const project = createProject('Г-образная комната');
  const room = createRoom('living', 0, 0, 8000, 5000);
  room.notch = { corner: 'ne', w: 2000, h: 1500 };
  project.rooms.push(room);
  return { project, room };
}

test('угловой вырез образует Г-контур, площадь и попадание корректны', () => {
  const { room } = lRoomProject();
  assert.equal(roomRects(room).length, 2);
  assert.equal(roomPolygon(room).length, 6);
  assert.equal(roomShapeArea(room), 37_000_000);
  assert.equal(roomContainsPoint(room, 7000, 500), false, 'в вырезе комнаты нет');
  assert.equal(roomContainsPoint(room, 7000, 2500), true);
});

test('Г-комната получает шесть стен и настоящий наружный контур', () => {
  const { project, room } = lRoomProject();
  assert.equal(computeRoomEdges(project, room).edges.length, 6);
  assert.equal(computeBuildingOutline(project, 0).length, 6);
  assert.equal(roomNetAreaM2(project, room), 37);
  const own = deriveWalls(project).filter((wall) => wall.kind === 'own' && wall.rooms[0] === room.id);
  assert.equal(own.length, 6);
  assert.ok(own.some((wall) => wall.sides[room.id] === 'notch-v'));
  assert.ok(own.some((wall) => wall.sides[room.id] === 'notch-h'));
});

test('Г-комната получает ручки на всех вершинах и стенах реального контура', () => {
  const { room } = lRoomProject();
  const handles = roomShapeHandles(room);
  assert.equal(handles.length, 12);
  assert.equal(handles.filter((handle) => handle.kind === 'vertex').length, 6);
  assert.equal(handles.filter((handle) => handle.kind === 'edge').length, 6);
  assert.ok(handles.every((handle) => roomPolygon(room).some((point, index, polygon) => {
    const next = polygon[(index + 1) % polygon.length];
    return handle.x >= Math.min(point.x, next.x) && handle.x <= Math.max(point.x, next.x)
      && handle.y >= Math.min(point.y, next.y) && handle.y <= Math.max(point.y, next.y);
  })));
});

test('средняя ручка двигает стену, а совмещение убирает уступ', () => {
  const { room } = lRoomProject();
  const innerWall = roomShapeHandles(room).find((handle) => handle.kind === 'edge' && handle.moveY === 'y1');
  applyRoomShapeHandle(room, innerWall, { x: innerWall.x, y: 2000 });
  assert.equal(room.notch.h, 2000);

  const aligned = roomShapeHandles(room).find((handle) => handle.kind === 'edge' && handle.moveY === 'y1');
  const result = applyRoomShapeHandle(room, aligned, { x: aligned.x, y: room.y }, { mergeTolerance: 100 });
  assert.equal(result.merged, true);
  assert.equal(room.notch, undefined);
  assert.equal(roomPolygon(room).length, 4);
});

test('при объединении наружной стены сохраняется новый уменьшенный габарит', () => {
  const { room } = lRoomProject();
  const outerRight = roomShapeHandles(room).find((handle) => handle.kind === 'edge' && handle.moveX === 'x2');
  const result = applyRoomShapeHandle(room, outerRight, { x: 6000, y: outerRight.y }, { mergeTolerance: 100 });
  assert.equal(result.merged, true);
  assert.equal(room.notch, undefined);
  assert.equal(room.w, 6000);
});

test('внутренний угол Г-комнаты не получает выступ стены', () => {
  const { project, room } = lRoomProject();
  const vertical = deriveWalls(project).find((wall) => wall.sides[room.id] === 'notch-v');
  assert.ok(vertical);
  assert.ok(vertical.band.y + vertical.band.h <= 1501, 'вертикальная стена заканчивается во внутреннем углу');
});

test('пол, 3D и структурированный экспорт учитывают Г-образную форму', () => {
  const { project, room } = lRoomProject();
  const floors = buildHouseMesh(project).filter((face) => face.kind === 'floor' && face.roomId === room.id);
  assert.equal(floors.length, 2);
  const exported = buildStructuredExport(project);
  const out = exported.levels[0].rooms[0];
  assert.equal(out.polygon.length, 6);
  assert.equal(out.area_m2, 37);
});

test('стену можно делить многократно, форма меняется только после сдвига', () => {
  const project = createProject('Многократное деление');
  const room = createRoom('living', 0, 0, 8000, 5000);
  project.rooms.push(room);
  const top = deriveWalls(project).find((wall) => wall.kind === 'own' && wall.sides[room.id] === 0);
  assert.equal(splitRoomOutlineWall(room, top, 4000), true);
  assert.equal(roomShapeArea(room), 40_000_000, 'само деление не меняет площадь');

  const leftHalf = roomShapeHandles(room).find((handle) => handle.kind === 'edge' && handle.y === 0 && handle.x < 4000);
  applyRoomShapeHandle(room, leftHalf, { x: leftHalf.x, y: 1500 });
  assert.equal(finalizeRoomOutline(room).merged, false);
  assert.equal(roomShapeArea(room), 34_000_000);
  assert.equal(deriveWalls(project).filter((wall) => wall.kind === 'own' && wall.rooms[0] === room.id).length, 6);

  const bottom = deriveWalls(project).find((wall) => wall.kind === 'own' && wall.sides[room.id] === 2);
  assert.equal(splitRoomOutlineWall(room, bottom, 6000), true, 'вторую стену тоже можно делить');
  assert.equal(roomShapeArea(room), 34_000_000);
});

test('несдвинутое деление упрощается обратно в одну стену', () => {
  const project = createProject();
  const room = createRoom('living', 0, 0, 5000, 4000);
  project.rooms.push(room);
  const wall = deriveWalls(project).find((candidate) => candidate.kind === 'own' && candidate.sides[room.id] === 0);
  splitRoomOutlineWall(room, wall, 2500);
  assert.equal(finalizeRoomOutline(room).merged, true);
  assert.equal(room.outline, undefined);
  assert.equal(roomPolygon(room).length, 4);
});
