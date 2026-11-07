// Деление ОБЩЕЙ стены (core/wall-split.js): контуры обеих комнат режутся в
// одной точке, половину тянут ручкой — встречное ребро соседа едет вместе
// (core/wall-follow.js), общая стена остаётся общей.
import test from 'node:test';
import assert from 'node:assert/strict';

import { createProject, createRoom } from '../core/model.js';
import { applyRoomShapeHandle, roomPolygon, roomShapeArea, roomShapeHandles } from '../core/room-shape.js';
import { applyFollow, edgeAtPoint, findFollowers, startFollow } from '../core/wall-follow.js';
import { splitWallRooms } from '../core/wall-split.js';
import { deriveWalls } from '../core/walls.js';

function room(type, x, y, w, h, id, name = id) {
  const r = createRoom(type, x, y, w, h);
  r.id = id; r.name = name;
  return r;
}

function scene(rooms) {
  const project = createProject('Общая стена');
  project.rooms.push(...rooms);
  return project;
}

const sharedWalls = (project) => deriveWalls(project).filter((w) => w.kind === 'shared');
const vertsAt = (r, x, y) => roomPolygon(r).filter((p) => Math.abs(p.x - x) < 0.5 && Math.abs(p.y - y) < 0.5).length;

// Как ui/input.js 'shape-resize': A — ручкой ребра, соседи — applyFollow.
function dragHalf(project, a, half, dx) {
  const handle = roomShapeHandles(a).find((h) => h.kind === 'edge' &&
    Math.abs(h.x - half.x) < 0.5 && Math.abs(h.y - half.y) < 0.5);
  assert.ok(handle, 'ручка половины найдена');
  const e0 = edgeAtPoint(a, handle);
  const follow = startFollow(project, findFollowers(project.rooms, a.id, [e0]));
  applyRoomShapeHandle(a, handle, { x: handle.x + dx, y: handle.y }, { mergeTolerance: 50 });
  const rep = applyFollow(project, follow, { x: dx, y: 0 });
  return { follow, rep };
}

// Гостевой санузел (A) слева, прихожая (B) справа, общая вертикальная стена.
const pair = () => scene([room('bath', 0, 0, 2000, 3000, 'A', 'Гостевой санузел'), room('hall', 2100, 0, 3000, 3000, 'B', 'Прихожая')]);

test('деление общей стены: обе комнаты получают совпадающие вершины в одной точке', () => {
  const project = pair();
  const [a, b] = project.rooms;
  const areas = [roomShapeArea(a), roomShapeArea(b)];
  const wall = sharedWalls(project)[0];
  assert.ok(wall, 'общая стена есть');
  const res = splitWallRooms(project, wall, 1200);
  assert.equal(res.ok, true, res.reason);
  assert.deepEqual(res.roomIds.sort(), ['A', 'B']);
  assert.equal(vertsAt(a, 2000, 1200), 2, 'A: две вершины на стыке');
  assert.equal(vertsAt(b, 2100, 1200), 2, 'B: две вершины на стыке');
  assert.deepEqual([roomShapeArea(a), roomShapeArea(b)], areas, 'форма не изменилась');
  // Общая стена одна (тот же ключ пары), теперь из двух участков-половин.
  const after = sharedWalls(project);
  assert.deepEqual([...new Set(after.map((w) => w.key))], [wall.key], 'общая стена по-прежнему одна');
  assert.equal(after.reduce((s, w) => s + Math.abs(w.to - w.from), 0), 3000, 'без щели');
  assert.ok(after.every((w) => w.thickness === 100));
});

test('сдвиг половины: уступ в обеих комнатах, зазор постоянный, площади согласованы', () => {
  for (const dx of [600, -500]) {
    const project = pair();
    const [a, b] = project.rooms;
    const total = roomShapeArea(a) + roomShapeArea(b);
    assert.equal(splitWallRooms(project, sharedWalls(project)[0], 1200).ok, true);
    // нижняя половина ребра A: x = 2000, y 1200…3000
    const { follow, rep } = dragHalf(project, a, { x: 2000, y: 2100 }, dx);
    assert.equal(rep.ok, true);
    assert.deepEqual(follow.map((f) => f.id), ['B']);
    assert.equal(follow[0].edges.length, 1, 'у соседа попутчик — ровно одна половина');
    assert.equal(follow[0].edges[0].from, 1200);
    assert.equal(follow[0].edges[0].to, 3000);
    // уступы: у A грань низа на 2000+dx, у B — на 2100+dx; верх — на месте.
    // Ступенька A — в точке деления, ступенька B отнесена на перегородку (100).
    const stepB = dx > 0 ? 1100 : 1300;
    assert.equal(vertsAt(a, 2000, 1200), 1); assert.equal(vertsAt(a, 2000 + dx, 1200), 1);
    assert.equal(vertsAt(b, 2100, stepB), 1, JSON.stringify(roomPolygon(b)));
    assert.equal(vertsAt(b, 2100 + dx, stepB), 1);
    const walls = sharedWalls(project);
    assert.ok(walls.length >= 1);
    for (const w of walls) assert.equal(w.thickness, 100, 'зазор прежний');
    assert.equal(walls.length, 3, 'общая стена: две вертикальные половины и ступенька');
    assert.ok(walls.every((w) => w.key === walls[0].key), 'ключ пары один');
    // Свои стены A/B между комнатами — только стыки 100×100 в углах уступа.
    const inner = deriveWalls(project).filter((w) => w.kind === 'own' && w.orient === 'v' && w.edge > 1000 && w.edge < 4000);
    assert.ok(inner.every((w) => Math.abs(w.to - w.from) <= 100), JSON.stringify(inner));
    assert.equal(roomShapeArea(a) - 2000 * 3000, 1800 * dx);
    assert.equal(total - roomShapeArea(a) - roomShapeArea(b), 100 * Math.abs(dx), 'площади согласованы: разница — ступенька перегородки');
  }
});

test('Г-образный сосед: делится и его ребро едет ровно по половине', () => {
  // B — Г: вырез снизу справа; левая грань B прямая на всю высоту.
  const project = scene([room('bath', 0, 0, 2000, 3000, 'A'), room('hall', 2100, 0, 3000, 4000, 'B')]);
  const b = project.rooms[1];
  b.notch = { corner: 'se', w: 1500, h: 1500 };
  const wall = sharedWalls(project)[0];
  const areaB = roomShapeArea(b);
  assert.equal(splitWallRooms(project, wall, 1500).ok, true);
  assert.equal(roomShapeArea(b), areaB);
  assert.equal(vertsAt(b, 2100, 1500), 2);
  const { follow, rep } = dragHalf(project, project.rooms[0], { x: 2000, y: 750 }, 400);
  assert.equal(rep.ok, true);
  assert.equal(follow[0].edges[0].to, 1500, 'верхняя половина соседа');
  assert.equal(vertsAt(b, 2500, 0), 1, 'B: верх левой грани сдвинулся');
  assert.equal(vertsAt(b, 2100, 4000), 1, 'B: низ левой грани на месте');
  assert.equal(vertsAt(b, 2100, 1600), 1, 'B: ступенька отнесена на перегородку');
  assert.equal(vertsAt(b, 2500, 1600), 1);
  for (const w of sharedWalls(project)) assert.equal(w.thickness, 100);
});

test('отказ при коротком участке у одной из комнат: ничего не меняется', () => {
  // B короче: стык 0…3000 у A, у B грань 0…1250 — точка 1200 ближе 100 мм к её концу.
  const project = scene([room('bath', 0, 0, 2000, 3000, 'A'), room('hall', 2100, 0, 3000, 1250, 'B')]);
  const before = JSON.stringify(project.rooms);
  const wall = sharedWalls(project)[0];
  const res = splitWallRooms(project, { ...wall, from: 0, to: 3000 }, 1200);
  assert.equal(res.ok, false);
  assert.match(res.reason, /B/);
  assert.equal(JSON.stringify(project.rooms), before, 'атомарно: ни одна комната не тронута');
});

test('отказ для вложенного помещения (parentId)', () => {
  const project = scene([room('bath', 0, 0, 2000, 3000, 'A'), room('hall', 2100, 0, 3000, 3000, 'B')]);
  project.rooms[1].parentId = 'X';
  const wall = { ...sharedWalls(scene([room('bath', 0, 0, 2000, 3000, 'A'), room('hall', 2100, 0, 3000, 3000, 'B')]))[0] };
  const before = JSON.stringify(project.rooms);
  assert.equal(splitWallRooms(project, wall, 1200).ok, false);
  assert.equal(JSON.stringify(project.rooms), before);
});

test('проёмы обеих комнат на делимой стене сохраняются', () => {
  const project = pair();
  const [a, b] = project.rooms;
  // Двери на общей стене выше и ниже точки деления (offset — центр от room.y).
  project.openings.push(
    { id: 'd1', type: 'door', roomId: 'A', side: 1, offset: 500, width: 700 },
    { id: 'd2', type: 'door', roomId: 'B', side: 3, offset: 2300, width: 800 },
  );
  assert.equal(splitWallRooms(project, sharedWalls(project)[0], 1200).ok, true);
  const abs = (o, r) => {
    const e = roomPolygon(r);
    return { side: o.side, y: r.y + o.offset, e: e.length };
  };
  const d1 = project.openings.find((o) => o.id === 'd1'); const d2 = project.openings.find((o) => o.id === 'd2');
  assert.equal(abs(d1, a).y, 500, 'd1 на месте');
  assert.equal(abs(d2, b).y, 2300, 'd2 на месте');
  // сторона указывает на ребро на той же линии
  const sideEdge = (r, side) => {
    const pts = roomPolygon(r);
    if (typeof side === 'number') return side;
    const i = Number(String(side).split('-')[1]);
    return pts[i].x;
  };
  assert.ok([1, 2000].includes(sideEdge(a, d1.side)));
  assert.ok([3, 2100].includes(sideEdge(b, d2.side)));
});

test('точка деления на двери — отказ, проект не тронут', () => {
  const project = pair();
  project.openings.push({ id: 'd1', type: 'door', roomId: 'A', side: 1, offset: 1200, width: 800 });
  const before = JSON.stringify({ r: project.rooms, o: project.openings });
  const res = splitWallRooms(project, sharedWalls(project)[0], 1200);
  assert.equal(res.ok, false);
  assert.equal(JSON.stringify({ r: project.rooms, o: project.openings }), before);
});
