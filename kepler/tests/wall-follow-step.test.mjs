// Уступ общей стены (core/wall-follow.js): грань соседа ДЛИННЕЕ стыка —
// едет только участок над тянущейся комнатой, сосед становится Г-образным,
// дальние соседи (кухня рядом с санузлом под общим коридором) не трогаются.
import test from 'node:test';
import assert from 'node:assert/strict';

import { createProject, createRoom } from '../core/model.js';
import { deriveWalls } from '../core/walls.js';
import { reconcileEats } from '../core/v7/eat-bridge.js';
import { finalizeRoomOutline, roomPolygon, roomShapeArea } from '../core/room-shape.js';
import {
  applyFollow, clampDelta, findFollowers, followLimits, followVerdict, handleEdges, MIN_STEP_ARM, startFollow,
} from '../core/wall-follow.js';

function room(type, x, y, w, h, id) {
  const r = createRoom(type, x, y, w, h);
  r.id = id;
  return r;
}

// Коридор 5292×1200 сверху; под ним санузел 2040×3700 и кухня справа,
// верх санузла и кухни на одной линии, перегородки 100 мм.
function scene() {
  const project = createProject('Тест');
  project.rooms.push(
    room('hall', 0, 0, 5292, 1200, 'C'),
    room('bathroom', 0, 1300, 2040, 3700, 'S'),
    room('kitchen', 2140, 1300, 3152, 3700, 'K'),
  );
  const [C, S, K] = project.rooms;
  const follow = startFollow(project, findFollowers(project.rooms, 'S', handleEdges(S, 'n')));
  const sStart = structuredClone(S);
  return { project, C, S, K, follow, sStart, kStart: structuredClone(K) };
}

// Верх санузла на dy (как ui/input.js: сама комната + applyFollow).
function pullTop(t, dy) {
  t.S.y = t.sStart.y + dy; t.S.h = t.sStart.h - dy;
  return applyFollow(t.project, t.follow, { x: 0, y: dy });
}

const poly = (r) => roomPolygon(r).map((p) => [p.x, p.y]);
const sharedWalls = (project) => deriveWalls(project).filter((w) => w.kind === 'shared');

test('находится только коридор, с уступом; кухня не попутчик', () => {
  const t = scene();
  assert.deepEqual(t.follow.map((f) => f.id), ['C']);
  const e = t.follow[0].edges[0];
  assert.deepEqual(e.partial, { lo: 0, hi: 2040, stepLo: false, stepHi: true });
});

test('верх санузла вниз на 600: санузел 2040×3100, коридор Г, кухня на месте', () => {
  const t = scene();
  const rep = pullTop(t, 600);
  assert.equal(rep.ok, true);
  assert.deepEqual([t.S.x, t.S.y, t.S.w, t.S.h], [0, 1900, 2040, 3100]);
  assert.deepEqual(t.K, t.kStart, 'кухня без изменений');
  finalizeRoomOutline(t.C);
  assert.equal(poly(t.C).length, 6, 'одна ступенька — Г-контур');
  // Форма: участок над санузлом опущен до 1800, ступенька — по грани санузла x=2040.
  const pts = poly(t.C);
  assert.ok(pts.some(([x, y]) => x === 0 && y === 1800));
  assert.ok(pts.some(([x, y]) => x === 2040 && y === 1800));
  assert.ok(pts.some(([x, y]) => x === 2040 && y === 1200));
  assert.equal(roomShapeArea(t.C), 5292 * 1200 + 2040 * 600);
  // Площади согласованы: санузел потерял столько, сколько получил коридор.
  assert.equal(roomShapeArea(t.C) + roomShapeArea(t.S), 5292 * 1200 + 2040 * 3700 + 0);
  // Без съедания и щелей: перегородка коридор–санузел одна, коридор–кухня есть.
  const res = reconcileEats(t.project, { touched: ['S'] });
  assert.equal(res.eaten.length, 0);
  const pairs = sharedWalls(t.project).map((w) => [...w.rooms].sort().join());
  assert.ok(pairs.includes('C,S') && pairs.includes('C,K') && pairs.includes('K,S'));
});

test('верх санузла вверх на 600: у коридора вырез над санузлом, кухня на месте', () => {
  const t = scene();
  const rep = pullTop(t, -600);
  assert.equal(rep.ok, true);
  assert.deepEqual(t.K, t.kStart);
  finalizeRoomOutline(t.C);
  const pts = poly(t.C);
  assert.equal(pts.length, 6);
  // Ступенька отнесена на перегородку: x = 2040 + 100 (на линии левой грани кухни).
  assert.ok(pts.some(([x, y]) => x === 0 && y === 600));
  assert.ok(pts.some(([x, y]) => x === 2140 && y === 600));
  assert.ok(pts.some(([x, y]) => x === 2140 && y === 1200));
  assert.equal(roomShapeArea(t.C), 5292 * 1200 - 2140 * 600);
  const res = reconcileEats(t.project, { touched: ['S'] });
  assert.equal(res.eaten.length, 0);
  assert.equal(followVerdict(t.project, t.follow).ok, true);
});

test('возврат в 0 и путь-независимость: коридор снова прямоугольник', () => {
  const t = scene();
  for (const dy of [600, -700, 300, -200]) pullTop(t, dy);
  pullTop(t, 0);
  assert.equal(t.C.outline, undefined);
  assert.deepEqual([t.C.x, t.C.y, t.C.w, t.C.h], [0, 0, 5292, 1200]);
  const two = scene();
  for (const dy of [900, -400, 250]) pullTop(t, dy);
  pullTop(two, 250);
  assert.deepEqual(t.C, two.C);
});

test('ограничение: над уступом коридор не тоньше MIN_STEP_ARM; вниз — без ограничения коридором', () => {
  const t = scene();
  const lim = followLimits(t.follow);
  assert.equal(lim.y.lo, -(1200 - MIN_STEP_ARM));
  assert.equal(lim.y.hi, Infinity);
  assert.equal(clampDelta(-5000, lim.y), -900);
  // Без клэмпа (жест Г-ручки) — отказ кадра, а не схлопнутый контур.
  assert.equal(pullTop(t, -1000).ok, false);
});

test('дверь в стене коридор–санузел едет с участком уступа', () => {
  const t = scene();
  t.project.openings.push({ id: 'd1', type: 'door', roomId: 'C', side: 2, offset: 1000, width: 800 });
  t.follow = startFollow(t.project, findFollowers(t.project.rooms, 'S', handleEdges(t.S, 'n')));
  const rep = pullTop(t, 600);
  assert.equal(rep.ok, true);
  assert.deepEqual(rep.clamped, []);
  const d = t.project.openings[0];
  assert.equal(t.C.x + d.offset, 1000);
  pullTop(t, 0);
  assert.deepEqual([d.side, d.offset], [2, 1000]);
});

test('Т-уступ: коридор выходит за санузел с обеих сторон', () => {
  const project = createProject('Тест');
  project.rooms.push(room('hall', 0, 0, 6000, 1200, 'C'), room('bathroom', 2000, 1300, 2000, 3000, 'S'));
  const [C, S] = project.rooms;
  const follow = startFollow(project, findFollowers(project.rooms, 'S', handleEdges(S, 'n')));
  assert.deepEqual(follow[0].edges[0].partial, { lo: 2000, hi: 4000, stepLo: true, stepHi: true });
  S.y = 1800; S.h = 2500;
  assert.equal(applyFollow(project, follow, { x: 0, y: 500 }).ok, true);
  finalizeRoomOutline(C);
  assert.equal(roomPolygon(C).length, 8);
  assert.equal(roomShapeArea(C), 6000 * 1200 + 2000 * 500);
  S.y = 800; S.h = 3500;
  applyFollow(project, follow, { x: 0, y: -500 });
  finalizeRoomOutline(C);
  assert.equal(roomShapeArea(C), 6000 * 1200 - 2200 * 500, 'вырез шире на две перегородки');
});

test('остаток грани у конца короче зазора + 100 мм — как раньше: грань целиком', () => {
  const project = createProject('Тест');
  project.rooms.push(room('hall', 0, 0, 2190, 1200, 'C'), room('bathroom', 0, 1300, 2040, 3000, 'S'));
  const follow = startFollow(project, findFollowers(project.rooms, 'S', handleEdges(project.rooms[1], 'n')));
  assert.equal(follow[0].edges[0].partial, undefined);
  applyFollow(project, follow, { x: 0, y: 400 });
  assert.deepEqual([project.rooms[0].h, project.rooms[0].outline], [1600, undefined]);
});

test('шахта длиннее стыка — грань целиком (уступ шахте не делается)', () => {
  const project = createProject('Тест');
  project.rooms.push(room('shaft', 0, 0, 3000, 400, 'H'), room('bathroom', 0, 500, 2000, 3000, 'S'));
  const follow = startFollow(project, findFollowers(project.rooms, 'S', handleEdges(project.rooms[1], 'n')));
  assert.equal(follow.length, 1);
  assert.equal(follow[0].edges[0].partial, undefined);
});

test('сосед короче стыка — грань целиком; Alt — соседи на месте', () => {
  const project = createProject('Тест');
  project.rooms.push(room('living', 0, 0, 6000, 5000, 'A'), room('bathroom', 1000, 5100, 2000, 2000, 'B'));
  const [A, B] = project.rooms;
  const follow = startFollow(project, findFollowers(project.rooms, 'A', handleEdges(A, 's')));
  assert.equal(follow[0].edges[0].partial, undefined);
  applyFollow(project, follow, { x: 0, y: 300 });
  assert.deepEqual([B.y, B.h, B.outline], [5400, 1700, undefined]);
  const t = scene();
  pullTop(t, 600);
  applyFollow(t.project, t.follow, null);
  assert.deepEqual([t.C.h, t.C.outline], [1200, undefined]);
});
