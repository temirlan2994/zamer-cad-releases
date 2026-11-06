// Помещения по стенам (этап C): заливка петель, статусы, нормы, команды.
import test from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_EXTERIOR, DEFAULT_PARTITION } from '../core/catalog.js';
import {
  createBoundRoom, findLoopAt, loopField, resolveBoundRooms, splitRoomByWall, unbindRoomWalls, wallsInsideRooms,
} from '../core/bound-rooms.js';
import {
  createOpening, createProject, createRoom, deserializeProject, fileSchema, serializeProject,
} from '../core/model.js';
import { roomContainsPoint, roomPolygon, roomRects } from '../core/room-shape.js';
import { roomNetAreaM2, totalAreaM2 } from '../core/rooms.js';
import { addManualWall, moveManualWall, removeManualWall } from '../core/wall-manual.js';
import { deriveWalls, doorLink, hostOpeningRoom, openingRect } from '../core/walls.js';
import { normsReport, roomChecks } from '../core/norms.js';
import { windowsOf } from '../core/insolation.js';
import { buildStructuredExport } from '../core/export.js';
import { facadeDimensionStations } from '../core/dimensions.js';
import { computeBuildingOutline } from '../core/rooms.js';

const T = 200; // толщина ручных стен в фикстурах

function wallLoop(p, pts, thickness = T) {
  const out = [];
  for (let i = 0; i < pts.length; i += 1) {
    out.push(addManualWall(p, pts[i], pts[(i + 1) % pts.length], { thickness, wallType: 'exterior' }));
  }
  return out;
}

const rectPts = (x, y, w, h) => [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }];

function resolve(p) {
  const walls = deriveWalls(p);
  const res = resolveBoundRooms(p, walls);
  return { walls, ...res };
}

function make(p, at, opts) {
  const res = createBoundRoom(p, deriveWalls(p), at, opts);
  assert.ok(res.ok, res.reason);
  return res.room;
}

const area = (p, r) => Number(roomNetAreaM2(p, r).toFixed(3));

test('прямоугольник из 4 стен → помещение «в свету»', () => {
  const p = createProject('петля');
  wallLoop(p, rectPts(0, 0, 5000, 4000));
  const room = make(p, { x: 2500, y: 2000 });
  assert.equal(room.type, 'living');
  assert.equal(room.name, 'Гостиная');
  assert.deepEqual({ x: room.x, y: room.y, w: room.w, h: room.h }, { x: 100, y: 100, w: 4800, h: 3800 });
  assert.equal(area(p, room), 18.24);
  assert.equal(roomPolygon(room).length, 4);
  assert.ok(roomContainsPoint(room, 200, 200));
  assert.ok(!roomContainsPoint(room, 50, 50));
  // Своих стен у помещения нет — только 4 ручные.
  const walls = deriveWalls(p);
  assert.ok(walls.every((w) => w.kind === 'manual'));
  assert.ok(!room.boundIssue);
});

test('Г-образная петля: контур из 6 вершин, площадь чистая', () => {
  const p = createProject('Г');
  wallLoop(p, [{ x: 0, y: 0 }, { x: 6000, y: 0 }, { x: 6000, y: 3000 }, { x: 3000, y: 3000 }, { x: 3000, y: 5000 }, { x: 0, y: 5000 }]);
  const room = make(p, { x: 1000, y: 1000 });
  assert.equal(roomPolygon(room).length, 6);
  assert.equal(area(p, room), 21.84);
  assert.equal(roomRects(room).reduce((s, r) => s + r.w * r.h, 0) / 1e6, 21.84);
});

test('щелчок не в петле: по стене, снаружи, узкая щель — отказ с причиной', () => {
  const p = createProject('отказ');
  wallLoop(p, rectPts(0, 0, 5000, 4000));
  const walls = deriveWalls(p);
  assert.equal(findLoopAt(p, walls, { x: 0, y: 2000 }).ok, false);
  assert.match(findLoopAt(p, walls, { x: 9000, y: 2000 }).reason, /не замкнуты/);
  make(p, { x: 2500, y: 2000 });
  assert.match(findLoopAt(p, deriveWalls(p), { x: 1000, y: 1000 }).reason, /уже есть/);
});

test('сдвиг стены — контур и площадь пересчитываются', () => {
  const p = createProject('сдвиг');
  const [, right] = wallLoop(p, rectPts(0, 0, 5000, 4000));
  const room = make(p, { x: 2500, y: 2000 });
  moveManualWall(p, right.id, 1000);
  resolve(p);
  assert.equal(room.w, 5800);
  assert.equal(area(p, room), 22.04);
});

test('петля разомкнулась → open: последний контур, площадь 0, замечание в нормах', () => {
  const p = createProject('открыто');
  const [, right] = wallLoop(p, rectPts(0, 0, 5000, 4000));
  const room = make(p, { x: 2500, y: 2000 });
  removeManualWall(p, right.id);
  resolve(p);
  assert.equal(room.boundIssue, 'open');
  assert.equal(room.w, 4800, 'контур — последний');
  assert.equal(roomNetAreaM2(p, room), 0);
  assert.equal(totalAreaM2(p), 0);
  const checks = roomChecks(p, room, p.levels[0]);
  assert.equal(checks.length, 1);
  assert.match(checks[0].text, /не замкнуто/);
  // Вернули стену (отмена) — снова замкнуто.
  addManualWall(p, { x: 5000, y: 0 }, { x: 5000, y: 4000 }, { thickness: T });
  resolve(p);
  assert.ok(!room.boundIssue);
  assert.equal(area(p, room), 18.24);
});

test('две комнаты через общую стену; удалили стену — слияние; вернули — снова две', () => {
  const p = createProject('две');
  wallLoop(p, rectPts(0, 0, 8000, 4000));
  const mid = addManualWall(p, { x: 4000, y: 0 }, { x: 4000, y: 4000 }, { thickness: 100 });
  const a = make(p, { x: 2000, y: 2000 });
  const b = make(p, { x: 6000, y: 2000 }, { type: 'bedroom' });
  assert.equal(b.name, 'Спальня');
  assert.equal(area(p, a), 14.63);
  assert.equal(area(p, b), 14.63);
  removeManualWall(p, mid.id);
  resolve(p);
  assert.ok(!a.boundIssue);
  assert.equal(b.boundIssue, 'merged');
  assert.equal(b.boundWith, a.id);
  assert.equal(area(p, a), 29.64);
  assert.equal(area(p, b), 0);
  assert.match(roomChecks(p, b, p.levels[0])[0].text, /Два помещения в одном контуре/);
  addManualWall(p, { x: 4000, y: 0 }, { x: 4000, y: 4000 }, { thickness: 100 });
  resolve(p);
  assert.ok(!a.boundIssue && !b.boundIssue);
  assert.equal(area(p, b), 14.63);
});

test('петля разделилась (Т-перегородка) — помещение в части с seed, вторая — свободная петля', () => {
  const p = createProject('деление');
  wallLoop(p, rectPts(0, 0, 8000, 4000));
  const room = make(p, { x: 2000, y: 2000 });
  addManualWall(p, { x: 4000, y: 0 }, { x: 4000, y: 4000 }, { thickness: 100 });
  const { free } = resolve(p);
  assert.ok(!room.boundIssue);
  assert.ok(room.x + room.w <= 3950 + 0.5);
  assert.equal(free.length, 1);
  assert.ok(free[0].bbox.x >= 4050 - 0.5);
});

test('seed попал в стену — помещение остаётся с наибольшим пересечением, seed переставлен', () => {
  const p = createProject('seed');
  const [, right] = wallLoop(p, rectPts(0, 0, 5000, 4000));
  const room = make(p, { x: 4500, y: 2000 });
  moveManualWall(p, right.id, -500); // тело стены 4400..4600 — поверх seed
  resolve(p);
  assert.ok(!room.boundIssue);
  assert.equal(room.w, 4300);
  assert.ok(roomContainsPoint(room, room.bound.seed.x, room.bound.seed.y));
  assert.notEqual(room.bound.seed.x, 4500);
});

test('колонна-стена внутри — дыра: площадь меньше, точка в колонне не в помещении', () => {
  const p = createProject('дыра');
  wallLoop(p, rectPts(0, 0, 6000, 5000));
  addManualWall(p, { x: 2000, y: 2500 }, { x: 3000, y: 2500 }, { thickness: 200 });
  const room = make(p, { x: 1000, y: 1000 });
  assert.equal(room.holes?.length, 1);
  assert.equal(area(p, room), Number((5.8 * 4.8 - 0.2).toFixed(3)));
  assert.ok(!roomContainsPoint(room, 2500, 2500));
  assert.ok(roomContainsPoint(room, 2500, 3000));
});

test('смешанная петля: кольцо блок-комнаты + 3 ручные стены', () => {
  const p = createProject('смесь');
  const a = createRoom('bedroom', 0, 0, 4000, 4000);
  p.rooms.push(a);
  addManualWall(p, { x: 4000, y: -100 }, { x: 7000, y: -100 }, { thickness: 200 });
  addManualWall(p, { x: 7000, y: -100 }, { x: 7000, y: 4100 }, { thickness: 200 });
  addManualWall(p, { x: 7000, y: 4100 }, { x: 4000, y: 4100 }, { thickness: 200 });
  // Внутри блок-комнаты помещение по стенам не создаётся.
  assert.match(findLoopAt(p, deriveWalls(p), { x: 2000, y: 2000 }).reason, /уже помещение/);
  const room = make(p, { x: 5500, y: 2000 }, { type: 'corridor' });
  assert.equal(room.x, 4000 + DEFAULT_EXTERIOR);
  assert.equal(area(p, room), Number(((6900 - 4000 - DEFAULT_EXTERIOR) * 4000 / 1e6).toFixed(3)));
  // Блок-комната и её стены не изменились.
  assert.equal(area(p, a), 16);
});

test('v1/v2: двор между блок-комнатами — петля в обоих движках', () => {
  const P = DEFAULT_PARTITION;
  const results = {};
  for (const engine of ['v1', 'v2']) {
    process.env.KEPLER_WALLS = engine;
    try {
      const p = createProject('двор');
      p.rooms.push(createRoom('living', 0, 0, 9000, 3000));
      p.rooms.push(createRoom('bedroom', 0, 3000 + P, 3000, 3000));
      p.rooms.push(createRoom('bedroom', 6000, 3000 + P, 3000, 3000));
      p.rooms.push(createRoom('kitchen', 0, 6000 + 2 * P, 9000, 3000));
      const walls = deriveWalls(p);
      assert.ok(!walls.some((w) => w.kind === 'manual'));
      const res = createBoundRoom(p, walls, { x: 4500, y: 4500 }, { type: 'hall' });
      assert.ok(res.ok, `${engine}: ${res.reason}`);
      resolveBoundRooms(p, deriveWalls(p));
      assert.ok(!res.room.boundIssue);
      results[engine] = roomNetAreaM2(p, res.room);
    } finally {
      delete process.env.KEPLER_WALLS;
    }
  }
  assert.ok(results.v2 > 5, `площадь двора ${results.v2}`);
  assert.ok(Math.abs(results.v1 - results.v2) / results.v2 < 0.05, JSON.stringify(results));
});

test('сохранение: схема 6, poly/seed переживают перезагрузку; битый bound — блок-комната', () => {
  const p = createProject('файл');
  wallLoop(p, rectPts(0, 0, 5000, 4000));
  const room = make(p, { x: 2500, y: 2000 });
  const text = serializeProject(p);
  assert.match(text, /kepler-plan\/6/);
  const q = deserializeProject(text);
  const r = q.rooms.find((x) => x.id === room.id);
  assert.deepEqual(r.bound, { mode: 'walls', seed: { x: 2500, y: 2000 } });
  assert.equal(r.poly.length, 4);
  resolve(q);
  assert.equal(area(q, r), 18.24);
  // Только помещение по стенам, без ручных стен (двор блоков) — тоже схема 6.
  const only = createProject('двор');
  only.rooms.push({ ...createRoom('hall', 0, 0, 1000, 1000), bound: { mode: 'walls', seed: { x: 5, y: 5 } } });
  assert.equal(fileSchema(only), 'kepler-plan/6');
  const bad = JSON.parse(text);
  bad.levels[0].rooms[0].bound = { mode: 'x' };
  const z = deserializeProject(JSON.stringify(bad));
  assert.equal(z.rooms[0].bound, undefined);
  assert.equal(z.rooms[0].poly, undefined);
});

test('окно ручной стены: свет, инсоляция, фасадные размеры через помещение', () => {
  const p = createProject('окно');
  const [top] = wallLoop(p, rectPts(0, 0, 5000, 4000));
  const room = make(p, { x: 2500, y: 2000 });
  const win = createOpening('window', null, 0, 0, 1500);
  delete win.side; delete win.offset;
  win.roomId = null;
  win.host = { wallId: top.id, t: 2500 };
  win.height = 1500;
  p.openings.push(win);
  const walls = deriveWalls(p);
  const own = hostOpeningRoom(p, win, walls);
  assert.equal(own.room.id, room.id);
  assert.equal(own.outward, -1, 'улица — сверху (−y)');
  const light = roomChecks(p, room, p.levels[0], walls).find((c) => c.kind === 'light');
  assert.ok(light.text.startsWith('Окна 2,25 м²'), light.text);
  const wins = windowsOf(p);
  assert.equal(wins.length, 1);
  assert.equal(wins[0].roomId, room.id);
  assert.ok(wins[0].normal.y < -0.99);
  // Фасадная цепочка верхнего фасада получает косяки окна.
  const edge = computeBuildingOutline(p, T).find((e) => e.orient === 'h' && e.inSide === 1);
  const stations = facadeDimensionStations(p, walls, edge, T);
  assert.ok(stations.includes(1750) && stations.includes(3250), JSON.stringify(stations));
  // Дверь между двумя помещениями по стенам.
  const mid = addManualWall(p, { x: 2500, y: 0 }, { x: 2500, y: 4000 }, { thickness: 100 });
  const b = make(p, { x: 4000, y: 2000 });
  resolve(p);
  const door = createOpening('door', null, 0, 0, 800);
  delete door.side; delete door.offset;
  door.roomId = null;
  door.host = { wallId: mid.id, t: 2000 };
  p.openings.push(door);
  const link = doorLink(p, door, deriveWalls(p));
  assert.deepEqual(new Set(link), new Set([room.id, b.id]));
  const rep = normsReport(p);
  assert.ok(rep.rooms.find((r) => r.id === room.id));
});

test('экспорт: помещение по стенам с флагом bound и контуром', () => {
  const p = createProject('экспорт');
  wallLoop(p, rectPts(0, 0, 5000, 4000));
  const room = make(p, { x: 2500, y: 2000 });
  const data = buildStructuredExport(p);
  const lvl = data.levels?.[0] || data;
  const r = (lvl.rooms || []).find((x) => x.id === room.id);
  assert.ok(r, 'помещение в экспорте');
  assert.equal(r.bound, 'walls');
  assert.equal(r.enclosed, true);
  assert.equal(r.net_area_m2, 18.24);
});

test('«Стена делит помещение» и «Разделить на два»', () => {
  const p = createProject('разделить');
  const a = createRoom('living', 0, 0, 6000, 4000);
  a.id = 'A';
  p.rooms.push(a);
  const w1 = createOpening('window', 'A', 0, 1500, 1200); // верх, левая часть
  const w2 = createOpening('window', 'A', 0, 4500, 1200); // верх, правая часть
  p.openings.push(w1, w2);
  const wall = addManualWall(p, { x: 3000, y: 0 }, { x: 3000, y: 4000 }, { thickness: 120, wallType: 'partition' });
  const door = createOpening('door', null, 0, 0, 800);
  delete door.side; delete door.offset;
  door.roomId = null;
  door.host = { wallId: wall.id, t: 2000 };
  p.openings.push(door);
  const inside = wallsInsideRooms(p);
  assert.deepEqual(inside, [{ wallId: wall.id, roomId: 'A', divides: true }]);
  const rep = normsReport(p);
  const check = rep.problems.find((c) => c.kind === 'wall-divides');
  assert.match(check.text, /делит помещение/);
  assert.ok(check.split);
  // Короткая стена — внутри, но не делит.
  const q = createProject('внутри');
  q.rooms.push(createRoom('living', 0, 0, 6000, 4000));
  addManualWall(q, { x: 3000, y: 0 }, { x: 3000, y: 2000 }, { thickness: 120 });
  assert.equal(wallsInsideRooms(q)[0].divides, false);

  const res = splitRoomByWall(p, deriveWalls(p), 'A', wall.id);
  assert.ok(res.ok, res.reason);
  const [left, right] = res.roomIds.map((id) => p.rooms.find((r) => r.id === id));
  assert.deepEqual({ x: left.x, w: left.w }, { x: 0, w: 2940 });
  assert.deepEqual({ x: right.x, w: right.w }, { x: 3060, w: 2940 });
  assert.equal(p.walls.length, 0);
  const walls = deriveWalls(p);
  const shared = walls.filter((w) => w.kind === 'shared');
  assert.ok(shared.length, 'общая стена');
  assert.equal(shared[0].thickness, 120);
  // Окна остались на месте в мире, дверь — на общей стене.
  assert.equal(w1.roomId, left.id);
  assert.equal(w2.roomId, right.id);
  assert.equal(openingRect(p, w2, walls).absCenter, 4500);
  assert.ok(!door.host);
  const link = doorLink(p, door, walls);
  assert.deepEqual(new Set(link), new Set([left.id, right.id]));
  assert.equal(openingRect(p, door, walls).absCenter, 2000);
});

test('«Отвязать стены»: блок → помещение по стенам, площадь и проёмы на месте', () => {
  const p = createProject('отвязать');
  const a = createRoom('living', 0, 0, 5000, 4000);
  a.id = 'A';
  const b = createRoom('bedroom', 5000 + DEFAULT_PARTITION, 0, 3000, 4000);
  b.id = 'B';
  p.rooms.push(a, b);
  const win = createOpening('window', 'A', 0, 2500, 1500);
  const door = createOpening('door', 'A', 1, 2000, 800); // на общей стене с B
  p.openings.push(win, door);
  const before = deriveWalls(p);
  const winAt = openingRect(p, win, before).absCenter;
  const doorAt = openingRect(p, door, before).absCenter;
  const areaA = roomNetAreaM2(p, a);
  const res = unbindRoomWalls(p, before, 'A');
  assert.ok(res.ok, res.reason);
  assert.equal(res.wallIds.length, 3, 'три своих стороны → три ручные стены');
  assert.ok(a.bound);
  resolve(p);
  assert.ok(!a.boundIssue, a.boundIssue);
  assert.ok(Math.abs(roomNetAreaM2(p, a) - areaA) < 1e-6);
  const walls = deriveWalls(p);
  assert.ok(win.host);
  assert.equal(openingRect(p, win, walls).absCenter, winAt);
  assert.equal(hostOpeningRoom(p, win, walls).room.id, 'A');
  assert.equal(door.roomId, 'B');
  assert.equal(openingRect(p, door, walls).absCenter, doorAt);
  assert.deepEqual(new Set(doorLink(p, door, walls)), new Set(['A', 'B']));
  // Стена B со стороны A — тонкая (как была общая).
  const bLeft = walls.find((w) => w.kind === 'own' && w.rooms[0] === 'B' && w.orient === 'v' && w.edge === b.x);
  assert.equal(bLeft.thickness, DEFAULT_PARTITION);
});

test('поле петель: пустой проект — нет поля', () => {
  assert.equal(loopField(createProject('пусто'), []), null);
});
