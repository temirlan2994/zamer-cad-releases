// Общая стена при растяжении ручкой (core/wall-follow.js): встречные грани
// соседей едут вместе с гранью — перегородка остаётся одной.
import test from 'node:test';
import assert from 'node:assert/strict';

import { createProject, createRoom } from '../core/model.js';
import { deriveWalls } from '../core/walls.js';
import { reconcileEats } from '../core/v7/eat-bridge.js';
import {
  applyFollow, clampDelta, edgeAtPoint, findFollowers, followLimits, followVerdict, handleEdges, startFollow,
} from '../core/wall-follow.js';

function room(type, x, y, w, h, id) {
  const r = createRoom(type, x, y, w, h);
  r.id = id;
  return r;
}

// Растянуть a за ручку handle на delta (как ui/input.js: a — сама, соседи — applyFollow).
function stretch(project, a, handle, delta, follow) {
  const s = follow.dragStart;
  if (handle === 'e') a.w = s.w + delta.x;
  if (handle === 'w') { a.x = s.x + delta.x; a.w = s.w - delta.x; }
  if (handle === 's') a.h = s.h + delta.y;
  return applyFollow(project, follow, delta);
}

function setup(rooms, movingId, handle) {
  const project = createProject('Тест');
  project.rooms.push(...rooms);
  const a = project.rooms.find((r) => r.id === movingId);
  const follow = startFollow(project, findFollowers(project.rooms, movingId, handleEdges(a, handle)));
  follow.dragStart = structuredClone(a);
  return { project, a, follow };
}

const sharedCount = (project) => deriveWalls(project).filter((w) => w.kind === 'shared').length;
const area = (r) => r.w * r.h;

test('две пристыкованные: ручка общей стены двигает обе грани, зазор и общая стена — одна', () => {
  const { project, a, follow } = setup([room('bedroom', 0, 0, 4000, 3000, 'A'), room('living', 4100, 0, 5000, 3000, 'B')], 'A', 'e');
  assert.deepEqual(follow.map((f) => f.id), ['B']);
  const b = project.rooms[1];
  const total = area(a) + area(b);
  for (const dx of [300, 700, 1200, -500, -1500, 0, 450, -460]) {
    stretch(project, a, 'e', { x: dx, y: 0 }, follow);
    assert.equal(b.x - (a.x + a.w), 100, `зазор при ${dx}`);
    assert.equal(b.x + b.w, 9100, 'дальняя грань B на месте');
    assert.equal(sharedCount(project), 1, `одна общая при ${dx}`);
    assert.equal(area(a) + area(b), total, 'площади меняются согласованно');
  }
});

test('путь-независимость: кадр зависит только от сдвига', () => {
  const mk = () => setup([room('bedroom', 0, 0, 4000, 3000, 'A'), room('living', 4100, 0, 5000, 3000, 'B')], 'A', 'e');
  const one = mk(); const two = mk();
  for (const dx of [900, -1300, 400, 1600, 250]) stretch(one.project, one.a, 'e', { x: dx, y: 0 }, one.follow);
  stretch(two.project, two.a, 'e', { x: 250, y: 0 }, two.follow);
  assert.deepEqual(one.project.rooms.map((r) => [r.x, r.w]), two.project.rooms.map((r) => [r.x, r.w]));
});

test('сосед длиннее по стыку тянет и тех, кто стоит напротив него (транзитивно)', () => {
  // A и D слева друг над другом, B справа во всю высоту.
  const { project, follow } = setup([
    room('bedroom', 0, 0, 4000, 3000, 'A'), room('kitchen', 0, 3100, 4000, 3000, 'D'),
    room('living', 4100, 0, 5000, 6100, 'B'), room('hall', 9200, 0, 2000, 6100, 'C'),
  ], 'A', 'e');
  assert.deepEqual(follow.map((f) => f.id).sort(), ['B', 'D'], 'C (за B) не попутчик');
  stretch(project, project.rooms[0], 'e', { x: 600, y: 0 }, follow);
  const [A, D, B, C] = project.rooms;
  assert.equal(D.w, 4600);
  assert.equal(B.x, 4700); assert.equal(B.x + B.w, 9100);
  assert.equal(C.x, 9200, 'C на месте');
  assert.equal(A.w, 4600);
});

test('сосед короче по стыку: двигается его грань целиком', () => {
  const { project, a, follow } = setup([room('living', 0, 0, 5000, 6000, 'A'), room('bath', 5100, 1000, 2000, 2000, 'B')], 'A', 'e');
  assert.deepEqual(follow.map((f) => f.id), ['B']);
  stretch(project, a, 'e', { x: -400, y: 0 }, follow);
  const b = project.rooms[1];
  assert.deepEqual([b.x, b.y, b.w, b.h], [4700, 1000, 2400, 2000]);
});

test('дальний сосед (>450 мм) и без перекрытия по стыку — не попутчики', () => {
  const far = setup([room('bedroom', 0, 0, 4000, 3000, 'A'), room('living', 4600, 0, 3000, 3000, 'B')], 'A', 'e');
  assert.equal(far.follow.length, 0);
  const diag = setup([room('bedroom', 0, 0, 4000, 3000, 'A'), room('living', 4100, 3100, 3000, 3000, 'B')], 'A', 'e');
  assert.equal(diag.follow.length, 0);
});

test('минимум соседа ограничивает сдвиг (грань упирается)', () => {
  const { follow } = setup([room('bedroom', 0, 0, 4000, 3000, 'A'), room('bath', 4100, 0, 1500, 3000, 'B')], 'A', 'e');
  const lim = followLimits(follow);
  assert.equal(lim.x.hi, 600); // 1500 − 900
  assert.equal(clampDelta(2000, lim.x), 600);
  assert.equal(clampDelta(-5000, lim.x), -5000);
});

test('followVerdict: сосед меньше минимума — отказ с понятной причиной', () => {
  const { project, a, follow } = setup([room('bedroom', 0, 0, 4000, 3000, 'A'), room('bath', 4100, 0, 1500, 3000, 'B')], 'A', 'e');
  stretch(project, a, 'e', { x: 1000, y: 0 }, follow);
  const v = followVerdict(project, follow);
  assert.equal(v.ok, false);
  assert.match(v.reason, /Соседнее помещение/);
});

test('оторвать (delta = null): соседи — как в начале жеста', () => {
  const { project, a, follow } = setup([room('bedroom', 0, 0, 4000, 3000, 'A'), room('living', 4100, 0, 5000, 3000, 'B')], 'A', 'e');
  stretch(project, a, 'e', { x: 800, y: 0 }, follow);
  applyFollow(project, follow, null);
  assert.deepEqual([project.rooms[1].x, project.rooms[1].w], [4100, 5000]);
});

test('угловая ручка: попутчики по обеим осям', () => {
  const { follow } = setup([
    room('bedroom', 0, 0, 4000, 3000, 'A'), room('living', 4100, 0, 3000, 3000, 'B'), room('hall', 0, 3100, 4000, 2000, 'C'),
  ], 'A', 'se');
  assert.deepEqual(follow.map((f) => [f.id, f.edges.map((e) => e.axis).join()]).sort(), [['B', 'x'], ['C', 'y']]);
});

test('Г-сосед: двигается его ребро, а не вся форма', () => {
  const b = room('living', 4100, 0, 4000, 4000, 'B');
  b.notch = { corner: 'sw', w: 1500, h: 1500 }; // вырез внизу слева: левая грань B — 0…2500
  const { project, a, follow } = setup([room('bedroom', 0, 0, 4000, 2500, 'A'), b], 'A', 'e');
  assert.deepEqual(follow.map((f) => f.id), ['B']);
  const rep = stretch(project, a, 'e', { x: 300, y: 0 }, follow);
  assert.equal(rep.ok, true);
  const B = project.rooms[1];
  const left = edgeAtPoint(B, { x: 4400, y: 1000 });
  assert.ok(left, 'левая грань B сдвинулась на 300');
  assert.equal(B.x + B.w, 8100, 'правая грань B на месте');
  assert.ok(edgeAtPoint(B, { x: 5600, y: 3000 }), 'внутренняя линия выреза на месте');
  assert.equal(B.notch.w, 1200);
});

test('съедание v7 не ломается: после кадра reconcileEats без перекрытий', () => {
  const { project, a, follow } = setup([room('bedroom', 0, 0, 4000, 3000, 'A'), room('living', 4100, 0, 5000, 3000, 'B')], 'A', 'e');
  stretch(project, a, 'e', { x: 700, y: 0 }, follow);
  const res = reconcileEats(project, { touched: ['A'] });
  assert.equal(res.eaten.length, 0);
  assert.ok(!project.rooms.some((r) => r.eatBase));
});
