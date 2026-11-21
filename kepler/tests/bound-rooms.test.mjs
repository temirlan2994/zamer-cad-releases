// Петля ручных стен → обычная комната (core/bound-rooms.js): конвертация,
// толщины и проёмы, стены вне петли, соседи, миграция старых room.bound,
// поведение — как у нарисованной комнаты.
import test from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_EXTERIOR, DEFAULT_PARTITION } from '../core/catalog.js';
import {
  createLoopRoom, findLoopAt, freeLoops, loopField, splitRoomByWall, wallsInsideRooms,
} from '../core/bound-rooms.js';
import {
  createOpening, createProject, createRoom, deserializeProject, fileDataV6, serializeProject,
} from '../core/model.js';
import { roomPolygon, roomShapeHandles } from '../core/room-shape.js';
import { roomNetAreaM2, validateRoomPlacement } from '../core/rooms.js';
import { addManualWall } from '../core/wall-manual.js';
import {
  deriveWalls, deriveWallsV1, deriveWallsV2, doorLink, doorSwingRect, doorSymbol, openingRect, wallsEngine,
} from '../core/walls.js';
import { normsReport } from '../core/norms.js';
import { moveRoomGroup, rotateRoomGroup } from '../core/room-group.js';
import { planRoomDuplicate } from '../core/duplicate-room.js';
import { checkWallInvariants } from './wall-invariants-lib.mjs';

const T = 200; // толщина ручных стен в фикстурах

function wallLoop(p, pts, opts = {}) {
  const out = [];
  for (let i = 0; i < pts.length; i += 1) {
    out.push(addManualWall(p, pts[i], pts[(i + 1) % pts.length], { thickness: T, wallType: 'exterior', ...opts }));
  }
  return out;
}

const rectPts = (x, y, w, h) => [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }];

function make(p, at, opts) {
  const res = createLoopRoom(p, deriveWalls(p), at, opts);
  assert.ok(res.ok, res.reason);
  return res;
}

function hostOpening(kind, wallId, t, width) {
  const o = createOpening(kind, null, 0, 0, width);
  delete o.side; delete o.offset;
  o.roomId = null;
  o.host = { wallId, t };
  return o;
}

// Инварианты стен; у старого движка (KEPLER_WALLS=v1, нет ручных стен)
// наложения углов — известный дефект (tests/wall-invariants.test.mjs).
function assertInvariants(p, walls = deriveWalls(p)) {
  const v1 = wallsEngine(p) === 'v1';
  for (const [inv, r] of Object.entries(checkWallInvariants(p, walls))) {
    if (!(v1 && inv === 'area')) assert.ok(r.ok, `${inv}: ${r.sample}`);
  }
}

const area = (p, r) => Number(roomNetAreaM2(p, r).toFixed(3));

// Стены без id/ключей — для сравнения с «нарисованной» комнатой.
const shape = (walls) => JSON.stringify(walls.map((w) => ({
  kind: w.kind, orient: w.orient, thickness: w.thickness, wallType: w.wallType, rects: w.rects || w.band,
})));

// Такая же комната, нарисованная инструментом «Комната», с теми же параметрами стен.
function drawnTwin(p, room) {
  const q = createProject('нарисованная');
  q.settings = { ...p.settings };
  const twin = { ...createRoom(room.type, room.x, room.y, room.w, room.h), ...(room.outline ? { outline: room.outline } : {}) };
  q.rooms.push(twin);
  for (const [k, v] of Object.entries(p.wallOverrides)) q.wallOverrides[k.replace(room.id, twin.id)] = v;
  return { q, twin };
}

test('прямоугольная петля → обычная комната: стен нет, толщина в overrides, тот же вывод стен', () => {
  const p = createProject('петля');
  wallLoop(p, rectPts(0, 0, 5000, 4000));
  const { room, removed } = make(p, { x: 2500, y: 2000 });
  assert.equal(removed.length, 4);
  assert.equal(p.walls.length, 0);
  assert.deepEqual(Object.keys(room).sort(), Object.keys(createRoom('living', 0, 0)).sort(), 'поля — как у обычной комнаты');
  assert.equal(room.name, 'Гостиная');
  assert.deepEqual({ x: room.x, y: room.y, w: room.w, h: room.h }, { x: 100, y: 100, w: 4800, h: 3800 });
  assert.equal(area(p, room), 18.24);
  for (const side of [0, 1, 2, 3]) assert.deepEqual(p.wallOverrides[`e|${room.id}|${side}`], { thickness: T });
  // Стены выводит движок как у любой комнаты — и совпадают с нарисованной (v1 и v2).
  const { q } = drawnTwin(p, room);
  assert.equal(shape(deriveWallsV2(p)), shape(deriveWallsV2(q)));
  assert.equal(shape(deriveWallsV1(p)), shape(deriveWallsV1(q)));
  const walls = deriveWalls(p);
  assert.ok(walls.every((w) => w.kind === 'own' && w.thickness === T));
  for (const [inv, r] of Object.entries(checkWallInvariants(p, deriveWallsV2(p)))) assert.ok(r.ok, `v2 ${inv}: ${r.sample}`);
  const v1 = checkWallInvariants(p, deriveWallsV1(p));
  for (const inv of ['holes', 'coverage', 'intrusion', 'thickness', 'fragments']) assert.ok(v1[inv].ok, `v1 ${inv}: ${v1[inv].sample}`);
});

test('Г-образная петля → комната с outline из 6 вершин, стороны контура с толщинами', () => {
  const p = createProject('Г');
  wallLoop(p, [{ x: 0, y: 0 }, { x: 6000, y: 0 }, { x: 6000, y: 3000 }, { x: 3000, y: 3000 }, { x: 3000, y: 5000 }, { x: 0, y: 5000 }]);
  const { room } = make(p, { x: 1000, y: 1000 });
  assert.equal(p.walls.length, 0);
  assert.equal(room.outline.length, 6);
  assert.equal(roomPolygon(room).length, 6);
  assert.equal(area(p, room), 21.84);
  assert.equal(Object.keys(p.wallOverrides).filter((k) => k.startsWith(`e|${room.id}|`)).length, 6);
  assert.equal(roomShapeHandles(room).length, 12, 'ручки углов и сторон — как у контурной комнаты');
  const { q } = drawnTwin(p, room);
  assert.equal(shape(deriveWallsV2(p)), shape(deriveWallsV2(q)));
  for (const [inv, r] of Object.entries(checkWallInvariants(p, deriveWallsV2(p)))) assert.ok(r.ok, `${inv}: ${r.sample}`);
});

test('разные стены петли: толщина, класс, высота и скрытие — по сторонам', () => {
  const p = createProject('стороны');
  const [top, right, bottom, left] = wallLoop(p, rectPts(0, 0, 5000, 4000));
  right.thickness = 300; right.wallType = 'bearing';
  bottom.wallType = 'partition'; bottom.thickness = DEFAULT_EXTERIOR;
  left.hidden = true;
  top.top = { level: null, offset: 0, height: 2500 };
  const { room } = make(p, { x: 2500, y: 2000 });
  const o = (side) => p.wallOverrides[`e|${room.id}|${side}`];
  assert.deepEqual(o(0), { thickness: T, top: { height: 2500 } });
  assert.deepEqual(o(1), { thickness: 300, kind: 'bearing' });
  assert.deepEqual(o(2), { kind: 'partition' }, 'толщина по умолчанию не записывается');
  assert.deepEqual(o(3), { thickness: T, hidden: true });
  assert.equal(room.x, 100);
  assert.equal(room.w, 5000 - 100 - 150);
  const walls = deriveWalls(p);
  assert.ok(walls.find((w) => w.sides?.[room.id] === 3).hidden);
  assert.equal(walls.find((w) => w.sides?.[room.id] === 1).wallType, 'bearing');
});

test('проёмы host → обычные проёмы комнаты: то же место, то же открывание и петли', () => {
  const p = createProject('проёмы');
  const [top, right] = wallLoop(p, rectPts(0, 0, 5000, 4000));
  // Ось правой стены идёт сверху вниз, верхней — слева направо; обратная ось — тоже.
  const left = p.walls[3];
  const win = hostOpening('window', top.id, 1800, 1500);
  const door = hostOpening('door', right.id, 2000, 900);
  door.swingIn = true; door.hingeStart = true;
  const back = hostOpening('door', left.id, 1000, 800); // ось слева: снизу вверх, t от низа
  back.swingIn = false; back.hingeStart = false;
  p.openings.push(win, door, back);
  const before = deriveWalls(p);
  const at = (o, walls) => openingRect(p, o, walls).absCenter;
  const was = {
    win: at(win, before), door: at(door, before), back: at(back, before),
    swing: doorSwingRect(p, door, before), backSwing: doorSwingRect(p, back, before),
    hinge: doorSymbol(p, door, before).hinge, backHinge: doorSymbol(p, back, before).hinge,
  };
  const { room, lost } = make(p, { x: 2500, y: 2000 });
  assert.deepEqual(lost, []);
  for (const o of [win, door, back]) {
    assert.equal(o.roomId, room.id);
    assert.ok(!o.host);
  }
  assert.deepEqual([win.side, door.side, back.side], [0, 1, 3]);
  assert.equal(win.offset, 1800 - room.x);
  assert.equal(door.offset, 2000 - room.y);
  assert.equal(back.offset, 3000 - room.y);
  const after = deriveWalls(p);
  assert.equal(at(win, after), was.win);
  assert.equal(at(door, after), was.door);
  assert.equal(at(back, after), was.back);
  assert.deepEqual(doorSwingRect(p, door, after), was.swing);
  assert.deepEqual(doorSwingRect(p, back, after), was.backSwing);
  assert.deepEqual(doorSymbol(p, door, after).hinge, was.hinge);
  assert.deepEqual(doorSymbol(p, back, after).hinge, was.backHinge);
  assert.deepEqual(doorLink(p, door, after), [room.id, 'outside']);
});

test('стены вне петли остаются ручными: торчащий конец, Т-примыкание снаружи', () => {
  const p = createProject('торцы');
  const top = addManualWall(p, { x: 0, y: 0 }, { x: 7000, y: 0 }, { thickness: T, wallType: 'exterior' });
  addManualWall(p, { x: 5000, y: 0 }, { x: 5000, y: 4000 }, { thickness: T, wallType: 'exterior' });
  addManualWall(p, { x: 5000, y: 4000 }, { x: 0, y: 4000 }, { thickness: T, wallType: 'exterior' });
  addManualWall(p, { x: 0, y: 4000 }, { x: 0, y: 0 }, { thickness: T, wallType: 'exterior' });
  const stub = addManualWall(p, { x: 5000, y: 4000 }, { x: 5000, y: 6000 }, { thickness: T, wallType: 'exterior' });
  const win = hostOpening('window', top.id, 6000, 900); // на торчащем конце
  p.openings.push(win);
  const { room, removed } = make(p, { x: 2500, y: 2000 });
  assert.equal(removed.length, 3);
  assert.deepEqual(p.walls.map((w) => w.id).sort(), [top.id, stub.id].sort());
  assert.ok(win.host, 'проём оставшейся стены — на ней');
  // Сторона под длинной стеной — той же толщины: тела совпадают, наложений нет.
  assert.deepEqual(p.wallOverrides[`e|${room.id}|0`], { thickness: T });
  assertInvariants(p);
});

test('две петли через общую стену → две комнаты с общей стеной и дверью между ними', () => {
  const p = createProject('две');
  wallLoop(p, rectPts(0, 0, 8000, 4000));
  // 200 — не перегородка по умолчанию: общая стена получает свою толщину.
  const mid = addManualWall(p, { x: 4000, y: 0 }, { x: 4000, y: 4000 }, { thickness: 200, wallType: 'partition' });
  const door = hostOpening('door', mid.id, 2000, 800);
  p.openings.push(door);
  const a = make(p, { x: 2000, y: 2000 }).room;
  const b = make(p, { x: 6000, y: 2000 }, { type: 'bedroom' }).room;
  assert.equal(b.name, 'Спальня');
  // Верх и низ (общие длинные стены) — ручные, середина стала общей стеной.
  assert.equal(p.walls.length, 2);
  assert.deepEqual(p.wallOverrides[`s|${a.id < b.id ? a.id : b.id}|${a.id < b.id ? b.id : a.id}`], { thickness: 200, kind: 'partition' });
  const walls = deriveWalls(p);
  const shared = walls.filter((w) => w.kind === 'shared');
  assert.equal(shared.length, 1);
  assert.equal(shared[0].thickness, 200);
  assert.equal(door.roomId, a.id);
  assert.deepEqual(new Set(doorLink(p, door, walls)), new Set([a.id, b.id]));
  assertInvariants(p, walls);
});

test('петля из комнаты и ручных стен: общая стена с соседом, ручных стен не остаётся', () => {
  const p = createProject('смешанная');
  const bed = createRoom('bedroom', 0, 0, 4000, 4000);
  p.rooms.push(bed);
  addManualWall(p, { x: 4000, y: -100 }, { x: 7000, y: -100 }, { thickness: T });
  addManualWall(p, { x: 7000, y: -100 }, { x: 7000, y: 4100 }, { thickness: T });
  addManualWall(p, { x: 7000, y: 4100 }, { x: 4000, y: 4100 }, { thickness: T });
  const { room } = make(p, { x: 5500, y: 2000 }, { type: 'corridor' });
  assert.equal(p.walls.length, 0);
  assert.equal(room.x, 4000 + DEFAULT_EXTERIOR);
  const key = bed.id < room.id ? `s|${bed.id}|${room.id}` : `s|${room.id}|${bed.id}`;
  assert.deepEqual(p.wallOverrides[key], { thickness: DEFAULT_EXTERIOR, kind: 'exterior' });
  const walls = deriveWalls(p);
  assert.equal(walls.filter((w) => w.kind === 'shared').length, 1);
  assertInvariants(p, walls);
});

test('v1/v2: двор между комнатами — та же комната и общие стены в обоих движках', () => {
  const P = DEFAULT_PARTITION;
  const results = {};
  const env = process.env.KEPLER_WALLS;
  for (const engine of ['v1', 'v2']) {
    process.env.KEPLER_WALLS = engine;
    try {
      const p = createProject('двор');
      p.rooms.push(createRoom('living', 0, 0, 9000, 3000));
      p.rooms.push(createRoom('bedroom', 0, 3000 + P, 3000, 3000));
      p.rooms.push(createRoom('bedroom', 6000, 3000 + P, 3000, 3000));
      p.rooms.push(createRoom('kitchen', 0, 6000 + 2 * P, 9000, 3000));
      const { room } = make(p, { x: 4500, y: 4500 }, { type: 'hall' });
      const walls = deriveWalls(p);
      results[engine] = {
        box: [room.x, room.y, room.w, room.h], area: area(p, room),
        shared: walls.filter((w) => w.kind === 'shared' && w.rooms.includes(room.id)).length,
      };
    } finally {
      if (env === undefined) delete process.env.KEPLER_WALLS; else process.env.KEPLER_WALLS = env;
    }
  }
  assert.deepEqual(results.v1, results.v2);
  assert.ok(results.v2.shared >= 4, JSON.stringify(results.v2));
});

test('поведение — как у обычной комнаты: размещение, перенос, поворот, копия, нормы', () => {
  const p = createProject('как обычная');
  wallLoop(p, rectPts(0, 0, 5000, 4000));
  const { room } = make(p, { x: 2500, y: 2000 });
  assert.equal(validateRoomPlacement(p, room, room.id).ok, true);
  assert.deepEqual(roomShapeHandles(room), [], 'прямоугольник — ручки сторон и углов габарита (render.roomHandles)');
  // Наезд на соседа — тот же отказ, что у нарисованной комнаты.
  const near = createRoom('bedroom', 4000, 0, 3000, 3000);
  p.rooms.push(near);
  const { q, twin } = drawnTwin(p, room);
  q.rooms.push({ ...near });
  assert.deepEqual(validateRoomPlacement(p, near, near.id), validateRoomPlacement(q, q.rooms[1], near.id));
  p.rooms.pop();
  assert.equal(twin.w, room.w);
  const moved = moveRoomGroup(p, [room.id], [], 500, 0);
  assert.equal(moved.ok, true, moved.reason);
  assert.equal(room.x, 600);
  const turned = rotateRoomGroup(p, [room.id], []);
  assert.equal(turned.ok, true, turned.reason);
  assert.deepEqual([room.w, room.h], [3800, 4800]);
  const dup = planRoomDuplicate(p, room.id);
  assert.equal(dup.ok, true, dup.reason);
  assert.ok(!('walls' in dup));
  assert.ok(normsReport(p).rooms.find((r) => r.id === room.id));
});

test('отказы: по стене, снаружи, внутри комнаты; свободные петли', () => {
  const p = createProject('отказ');
  wallLoop(p, rectPts(0, 0, 5000, 4000));
  const walls = deriveWalls(p);
  assert.equal(findLoopAt(p, walls, { x: 0, y: 2000 }).ok, false);
  assert.match(findLoopAt(p, walls, { x: 9000, y: 2000 }).reason, /не замкнуты/);
  assert.equal(freeLoops(p, walls).length, 1);
  make(p, { x: 2500, y: 2000 });
  assert.match(findLoopAt(p, deriveWalls(p), { x: 1000, y: 1000 }).reason, /уже помещение/);
  assert.equal(freeLoops(p, deriveWalls(p)).length, 0);
  assert.equal(loopField(createProject('пусто'), []), null);
});

test('миграция: старые помещения room.bound при открытии — обычные комнаты', () => {
  const p = createProject('старый файл');
  const [top] = wallLoop(p, rectPts(0, 0, 5000, 4000));
  // Вторая петля разомкнута: нет правой стены (последний кеш контура — 4800×3800).
  addManualWall(p, { x: 6000, y: 0 }, { x: 11000, y: 0 }, { thickness: T });
  addManualWall(p, { x: 11000, y: 4000 }, { x: 6000, y: 4000 }, { thickness: T });
  addManualWall(p, { x: 6000, y: 4000 }, { x: 6000, y: 0 }, { thickness: T });
  p.openings.push(hostOpening('window', top.id, 2500, 1500));
  // Старый файл — формат v6 (room.bound был только там).
  const data = JSON.parse(JSON.stringify(fileDataV6(p)));
  const old = (id, seed, x) => ({
    ...createRoom('living', x, 100, 4800, 3800), id, bound: { mode: 'walls', seed },
    poly: rectPts(x, 100, 4800, 3800),
  });
  data.levels[0].rooms.push(
    old('A', { x: 2500, y: 2000 }, 100),
    { ...old('B', { x: 8500, y: 2000 }, 6100), boundIssue: 'open' },
  );
  data.levels[0].rooms.unshift(createRoom('bathroom', 20000, 0, 2000, 2000));
  const q = deserializeProject(JSON.stringify(data));
  assert.deepEqual(q.rooms.map((r) => r.id).slice(1), ['A', 'B'], 'порядок сохранён');
  for (const r of q.rooms) {
    for (const key of ['bound', 'poly', 'holes', 'boundIssue', 'boundWith']) assert.ok(!(key in r), `${r.id}.${key}`);
  }
  const a = q.rooms.find((r) => r.id === 'A');
  const b = q.rooms.find((r) => r.id === 'B');
  assert.deepEqual([a.x, a.y, a.w, a.h], [100, 100, 4800, 3800]);
  assert.deepEqual([b.x, b.y, b.w, b.h], [6100, 100, 4800, 3800]);
  // Ручных стен не осталось: у B недостающая сторона — обычная наружная стена.
  assert.equal(q.walls.length, 0);
  assert.equal(q.openings[0].roomId, 'A');
  assert.equal(q.openings[0].side, 0);
  const walls = deriveWalls(q);
  assert.ok(walls.find((w) => w.sides?.B === 1 && w.thickness === DEFAULT_EXTERIOR));
  assertInvariants(q, walls);
  // Повторная нормализация ничего не меняет.
  assert.equal(serializeProject(deserializeProject(serializeProject(q))), serializeProject(q));
});

test('«Стена делит помещение» и «Разделить на два»', () => {
  const p = createProject('разделить');
  const a = createRoom('living', 0, 0, 6000, 4000);
  a.id = 'A';
  p.rooms.push(a);
  const w1 = createOpening('window', 'A', 0, 1500, 1200);
  const w2 = createOpening('window', 'A', 0, 4500, 1200);
  p.openings.push(w1, w2);
  const wall = addManualWall(p, { x: 3000, y: 0 }, { x: 3000, y: 4000 }, { thickness: 120, wallType: 'partition' });
  const door = hostOpening('door', wall.id, 2000, 800);
  p.openings.push(door);
  assert.deepEqual(wallsInsideRooms(p), [{ wallId: wall.id, roomId: 'A', divides: true }]);
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
  assert.equal(shared[0].thickness, 120);
  assert.equal(w1.roomId, left.id);
  assert.equal(w2.roomId, right.id);
  assert.equal(openingRect(p, w2, walls).absCenter, 4500);
  assert.deepEqual(new Set(doorLink(p, door, walls)), new Set([left.id, right.id]));
});
