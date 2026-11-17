// Участки стены (core/wall-spans.js): толщина, тип и скрытие из «Свойств»
// меняют только выделенный участок, а не всю сторону/пару (жалоба: «должно
// касаться только этой стены (выделенного участка), а не общей длины»).
import test from 'node:test';
import assert from 'node:assert/strict';

import { createProject, createRoom, deserializeProject, serializeProject } from '../core/model.js';
import { deriveWalls } from '../core/walls.js';
import { setWallKind, setWallSpan } from '../core/wall-thickness.js';
import { overridePieces, writeSpan, writeWhole, turnSpans } from '../core/wall-spans.js';
import { rotateRoomGroup } from '../core/room-group.js';
import { reconcileEats } from '../core/v7/eat-bridge.js';
import { DEFAULT_EXTERIOR } from '../core/catalog.js';

// Холл 2000..4000 над гардеробной 0..6000: верх гардеробной — своя 0..2000,
// общая 2000..4000, своя 4000..6000.
function strip() {
  const project = createProject('Участки');
  const hall = createRoom('hall', 2000, 0, 2000, 3000); hall.id = 'H';
  const ward = createRoom('wardrobe', 0, 3100, 6000, 1900); ward.id = 'G';
  project.rooms.push(hall, ward);
  return { project, hall, ward };
}
const topOwn = (project) => deriveWalls(project)
  .filter((w) => w.key === 'e|G|0').sort((a, b) => a.from - b.from);

test('толщина своей стены — только выделенный участок, соседний той же стороны как был', () => {
  const { project } = strip();
  const [left, right] = topOwn(project);
  assert.deepEqual([left.from, left.to, right.from, right.to], [0, 2000, 4000, 6000]);
  assert.equal(setWallSpan(project, left, { thickness: 400 }).whole, false);
  const [l2, r2] = topOwn(project);
  assert.equal(l2.thickness, 400);
  assert.equal(r2.thickness, DEFAULT_EXTERIOR, 'правый участок не изменился');
  assert.equal(project.wallOverrides['e|G|0'].thickness, undefined, 'на весь ключ не записано');
  const shared = deriveWalls(project).find((w) => w.kind === 'shared');
  assert.equal(shared.thickness, 100, 'общая не тронута');
});

test('тип своей стены (с толщиной класса) и скрытие — только участок', () => {
  const { project } = strip();
  const [, right] = topOwn(project);
  setWallKind(project, right, 'partition');
  let [l, r] = topOwn(project);
  assert.deepEqual([l.wallType, l.thickness], ['exterior', DEFAULT_EXTERIOR]);
  assert.deepEqual([r.wallType, r.thickness], ['partition', 100]);
  setWallSpan(project, l, { hidden: true });
  [l, r] = topOwn(project);
  assert.deepEqual([l.hidden, r.hidden], [true, false]);
});

test('общая стена пары из двух участков: скрытие и тип — только выбранного', () => {
  const project = createProject('Г');
  const hall = createRoom('hall', 0, 0, 6000, 4000); hall.id = 'H';
  const ward = createRoom('wardrobe', -1000, 3000, 2800, 1900); ward.id = 'G';
  project.rooms.push(hall, ward);
  reconcileEats(project);
  const shared = () => deriveWalls(project).filter((w) => w.kind === 'shared');
  assert.equal(shared().length, 2, 'h и v участки пары');
  const h = shared().find((w) => w.orient === 'h');
  setWallSpan(project, h, { hidden: true, kind: 'bearing', thickness: 300 });
  const now = shared();
  assert.deepEqual(now.map((w) => [w.orient, w.hidden, w.wallType, w.thickness]).sort(),
    [['h', true, 'bearing', 100], ['v', false, 'partition', 100]], 'толщина общей — зазор пары, не участок');
  // Перенос холла (хозяина ключа s|G|H — G) не теряет участок гардеробной.
  ward.x += 500; hall.x += 500;
  reconcileEats(project);
  assert.equal(shared().find((w) => w.orient === 'h').hidden, true);
});

test('единственный участок ключа — запись на весь ключ (как раньше); старые записи без spans читаются', () => {
  const project = createProject('Одна');
  const room = createRoom('living', 0, 0, 4000, 3000);
  project.rooms.push(room);
  const wall = deriveWalls(project).find((w) => w.key === `e|${room.id}|0`);
  assert.equal(setWallSpan(project, wall, { thickness: 250 }).whole, true);
  assert.deepEqual(project.wallOverrides[`e|${room.id}|0`], { thickness: 250 });
  const { project: p2 } = strip();
  p2.wallOverrides['e|G|0'] = { thickness: 450 };
  assert.deepEqual(topOwn(p2).map((w) => w.thickness), [450, 450]);
});

test('участок едет с комнатой и переживает сохранение (kepler-plan/7) и поворот группы', () => {
  const { project, hall, ward } = strip();
  setWallSpan(project, topOwn(project)[0], { thickness: 400 });
  hall.x += 1000; ward.x += 1000;
  const moved = topOwn(project);
  assert.deepEqual(moved.map((w) => [w.from, w.thickness]), [[1000, 400], [5000, DEFAULT_EXTERIOR]]);

  const back = deserializeProject(serializeProject(project));
  const again = deriveWalls(back).filter((w) => w.key === 'e|G|0').sort((a, b) => a.from - b.from);
  assert.deepEqual(again.map((w) => [w.from, w.to, w.thickness]), moved.map((w) => [w.from, w.to, w.thickness]));

  // Поворот на 90°: верх (0) → правая сторона (1); участок 400 — у того же края.
  assert.equal(rotateRoomGroup(project, ['H', 'G'], []).ok, true);
  const side = deriveWalls(project).filter((w) => w.key === 'e|G|1').sort((a, b) => a.from - b.from);
  const g = project.rooms.find((r) => r.id === 'G');
  assert.equal(side.length, 2);
  assert.deepEqual(side.map((w) => [w.from - g.y, w.thickness]), [[0, 400], [4000, DEFAULT_EXTERIOR]]);
});

test('чистые функции участков: запись, слияние, на весь ключ, поворот', () => {
  let o = writeSpan(undefined, 'h', 0, 2000, { thickness: 400 });
  o = writeSpan(o, 'h', 1000, 3000, { kind: 'bearing' });
  assert.deepEqual(overridePieces(o, 0, 'h', 0, 4000).map((p) => [p.from, p.to, p.override?.thickness ?? null, p.override?.kind ?? null]),
    [[0, 1000, 400, null], [1000, 2000, 400, 'bearing'], [2000, 3000, null, 'bearing'], [3000, 4000, null, null]]);
  o = writeSpan(o, 'h', 0, 3000, { kind: 'bearing', thickness: 400 });
  assert.deepEqual(o.spans, [{ orient: 'h', from: 0, to: 3000, thickness: 400, kind: 'bearing' }], 'склеено');
  const whole = writeWhole(o, { thickness: 200 });
  assert.deepEqual(whole, { thickness: 200, spans: [{ orient: 'h', from: 0, to: 3000, kind: 'bearing' }] });
  assert.deepEqual(turnSpans({ spans: [{ orient: 'v', from: 500, to: 1500, hidden: true }] }, 3000).spans,
    [{ orient: 'h', from: 1500, to: 2500, hidden: true }]);
});
