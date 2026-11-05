// Мультивыделение помещений: сдвиг, поворот на 90° и копия группы (core/room-group.js).
// Запуск: node --test tests/room-group.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';

import { createItem, createOpening, createProject, createRoom } from '../core/model.js';
import { deriveWalls } from '../core/walls.js';
import { roomShapeArea } from '../core/room-shape.js';
import {
  captureRoomGroup, groupCargo, moveRoomGroup, planGroupCopy, rotateRoomGroup,
} from '../core/room-group.js';
import { windowsOnSharedWalls } from '../core/opening-spacing.js';

function twoRooms() {
  const project = createProject();
  const a = createRoom('living', 0, 0, 4000, 3000);
  const b = createRoom('bedroom', 4100, 0, 3000, 3000);
  project.rooms.push(a, b);
  const win = createOpening('window', a.id, 0, 1000, 1200);
  const door = createOpening('door', a.id, 1, 1500, 900);
  door.hingeStart = true;
  const winB = createOpening('window', b.id, 0, 1500, 1200);
  project.openings.push(win, door, winB);
  const sofa = createItem('sofa', 1000, 1000, 2000, 900, 0);
  const lonely = createItem('chair', 20000, 20000, 500, 500, 0);
  project.items.push(sofa, lonely);
  project.wallOverrides[`e|${a.id}|0`] = { thickness: 400 };
  return { project, a, b, win, door, winB, sofa, lonely };
}

const sharedCount = (project) => deriveWalls(project).filter((w) => w.kind === 'shared').length;

test('груз группы: вложенные помещения и мебель внутри, чужая мебель не едет', () => {
  const { project, a, b, sofa, lonely } = twoRooms();
  const child = createRoom('wardrobe', 200, 200, 1000, 1000);
  child.parentId = a.id;
  project.rooms.push(child);
  const cargo = groupCargo(project, [a.id, b.id], []);
  assert.deepEqual(cargo.rooms.map((r) => r.id).sort(), [a.id, b.id, child.id].sort());
  assert.ok(cargo.items.includes(sofa));
  assert.ok(!cargo.items.includes(lonely));
});

test('сдвиг группы: комнаты, мебель и проёмы едут вместе, общая стена сохраняется', () => {
  const { project, a, b, win, sofa, lonely } = twoRooms();
  const shared = sharedCount(project);
  const res = moveRoomGroup(project, [a.id, b.id], [], 500, -250);
  assert.equal(res.ok, true);
  assert.deepEqual([a.x, a.y, b.x, b.y], [500, -250, 4600, -250]);
  assert.deepEqual([sofa.x, sofa.y], [1500, 750]);
  assert.deepEqual([lonely.x, lonely.y], [20000, 20000]);
  assert.equal(win.offset, 1000); // проём хранится относительно комнаты
  assert.equal(sharedCount(project), shared);
});

test('сдвиг вложенного помещения за пределы родителя — отказ и откат', () => {
  const project = createProject();
  const parent = createRoom('living', 0, 0, 5000, 4000);
  const child = createRoom('wardrobe', 500, 500, 1500, 1500);
  child.parentId = parent.id;
  const other = createRoom('wardrobe', 2500, 500, 1500, 1500);
  other.parentId = parent.id;
  project.rooms.push(parent, child, other);
  const res = moveRoomGroup(project, [child.id, other.id], [], 3000, 0);
  assert.equal(res.ok, false);
  assert.deepEqual([child.x, other.x], [500, 2500]);
});

test('поворот группы на 90°: геометрия, проёмы, петли, мебель, переопределения стен', () => {
  const { project, a, b, win, door, sofa, lonely } = twoRooms();
  const shared = sharedCount(project);
  const res = rotateRoomGroup(project, [a.id, b.id], []);
  assert.equal(res.ok, true);
  assert.deepEqual(res.center, { x: 3550, y: 1500 });
  assert.deepEqual([a.x, a.y, a.w, a.h], [2050, -2050, 3000, 4000]);
  assert.deepEqual([b.x, b.y, b.w, b.h], [2050, 2050, 3000, 3000]);
  // Окно с верхней стены — на правой, на той же точке.
  assert.equal(win.side, 1);
  assert.equal(win.offset, 1000);
  // Дверь в общей стене (правая сторона) — на нижней, петли у того же косяка.
  assert.equal(door.side, 2);
  assert.equal(door.offset, 1500);
  assert.equal(door.hingeStart, false);
  assert.deepEqual([sofa.x, sofa.y, sofa.rotation], [4050, -1050, 90]);
  assert.deepEqual([lonely.x, lonely.y], [20000, 20000]);
  assert.equal(project.wallOverrides[`e|${a.id}|1`]?.thickness, 400);
  assert.equal(project.wallOverrides[`e|${a.id}|0`], undefined);
  assert.equal(sharedCount(project), shared);
});

test('четыре поворота возвращают группу в исходное состояние', () => {
  const { project, a, b } = twoRooms();
  const before = JSON.stringify({ rooms: project.rooms, openings: project.openings, items: project.items, o: project.wallOverrides });
  for (let i = 0; i < 4; i += 1) assert.equal(rotateRoomGroup(project, [a.id, b.id], []).ok, true);
  const after = JSON.stringify({ rooms: project.rooms, openings: project.openings, items: project.items, o: project.wallOverrides });
  assert.equal(after, before);
});

test('поворот Г-комнаты (вырез и контур): площадь сохраняется, проём на стене выреза остаётся', () => {
  const project = createProject();
  const g = createRoom('living', 0, 0, 6000, 5000);
  g.notch = { corner: 'ne', w: 2000, h: 2000 };
  const poly = createRoom('kitchen', 0, 6000, 4000, 3000);
  poly.outline = [{ x: 0, y: 0 }, { x: 4000, y: 0 }, { x: 4000, y: 1500 }, { x: 2500, y: 1500 }, { x: 2500, y: 3000 }, { x: 0, y: 3000 }];
  project.rooms.push(g, poly);
  const notchWin = createOpening('window', g.id, 'notch-h', 5000, 1000);
  project.openings.push(notchWin);
  const areas = [roomShapeArea(g), roomShapeArea(poly)];
  assert.equal(rotateRoomGroup(project, [g.id, poly.id], []).ok, true);
  assert.equal(g.notch.corner, 'se');
  assert.equal(notchWin.side, 'notch-v');
  assert.deepEqual([roomShapeArea(g), roomShapeArea(poly)], areas);
  for (let i = 0; i < 3; i += 1) rotateRoomGroup(project, [g.id, poly.id], []);
  assert.deepEqual([g.x, g.y, g.w, g.h, g.notch.corner], [0, 0, 6000, 5000, 'ne']);
  assert.equal(notchWin.side, 'notch-h');
  assert.equal(notchWin.offset, 5000);
  assert.deepEqual(poly.outline[2], { x: 4000, y: 1500 });
});

test('копия группы: взаимное положение сохраняется, окна в общей стене убираются, мебель копируется', () => {
  const { project, a, b } = twoRooms();
  const source = captureRoomGroup(project, [a.id, b.id], []);
  assert.equal(source.items.length, 1);
  const plan = planGroupCopy(project, source);
  assert.equal(plan.ok, true);
  assert.equal(plan.rooms.length, 2);
  const [ca, cb] = plan.rooms;
  assert.equal(cb.x - ca.x, b.x - a.x);
  assert.equal(cb.y - ca.y, b.y - a.y);
  assert.ok(ca.id !== a.id && cb.id !== b.id);
  assert.equal(plan.items.length, 1);
  assert.equal(plan.items[0].x, 1000 + plan.dx);
  // Копии проёмов привязаны к копиям помещений.
  const copyIds = new Set(plan.rooms.map((r) => r.id));
  assert.ok(plan.openings.every((o) => copyIds.has(o.roomId)));
  // Вставка: окна копий не оказываются в общих стенах.
  project.rooms.push(...plan.rooms);
  project.openings.push(...plan.openings);
  const windows = plan.openings.filter((o) => o.kind === 'window').map((o) => o.id);
  assert.deepEqual(windowsOnSharedWalls(project, deriveWalls(project), windows), []);
});

test('копия группы вниз: окно верхней стены копии попало бы в общую стену — удаляется', () => {
  const project = createProject();
  const a = createRoom('living', 0, 0, 4000, 3000);
  const b = createRoom('bedroom', 4100, 0, 3000, 3000);
  // Справа и слева места нет: стены по бокам.
  const left = createRoom('hall', -10000, -5000, 9900, 15000);
  const right = createRoom('hall', 7200, -5000, 9900, 15000);
  project.rooms.push(a, b, left, right);
  const top = createOpening('window', a.id, 0, 2000, 1200);
  project.openings.push(top);
  const plan = planGroupCopy(project, captureRoomGroup(project, [a.id, b.id]));
  assert.equal(plan.ok, true);
  assert.equal(plan.dx, 0);
  assert.equal(plan.dy, 3100);
  assert.equal(plan.removedWindows, 1);
  assert.equal(plan.openings.length, 0);
});
