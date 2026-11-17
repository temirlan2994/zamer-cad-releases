// Б3: проёмы не уезжают при переносе/растяжении западной и северной стен.
import test from 'node:test';
import assert from 'node:assert/strict';

import { createOpening, createProject, createRoom } from '../core/model.js';
import { captureOpeningAnchors, reanchorOpenings } from '../core/opening-anchor.js';
import { moveWallBy } from '../core/wall-edit.js';
import { deriveWalls, sideEdge } from '../core/walls.js';

// Абсолютный центр проёма в осях дома.
function center(project, opening) {
  const room = project.rooms.find((r) => r.id === opening.roomId);
  const edge = sideEdge(room, opening.side);
  assert.ok(edge, `сторона ${opening.side} не найдена`);
  return edge.orient === 'h'
    ? { x: room.x + opening.offset, y: edge.edge }
    : { x: edge.edge, y: room.y + opening.offset };
}

function wallOf(project, room, side) {
  return deriveWalls(project).find((w) => w.rooms.includes(room.id) && w.sides[room.id] === side);
}

function rectProject() {
  const project = createProject('Б3');
  const room = createRoom('living', 1000, 2000, 4000, 3000);
  project.rooms.push(room);
  const o = {
    n: createOpening('window', room.id, 0, 2000, 900), // x 3000
    e: createOpening('window', room.id, 1, 1500, 900), // y 3500
    s: createOpening('door', room.id, 2, 1000, 900), // x 2000
    w: createOpening('window', room.id, 3, 1500, 900), // y 3500
  };
  project.openings.push(...Object.values(o));
  return { project, room, o };
}

const pts = (project, o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, center(project, v)]));

test('перенос западной стены наружу: проёмы на месте, западное окно едет со стеной', () => {
  const { project, room, o } = rectProject();
  const before = pts(project, o);
  const res = moveWallBy(project, wallOf(project, room, 3), -500, { finalize: true });
  assert.equal(res.ok, true);
  assert.equal(room.x, 500);
  const after = pts(project, o);
  assert.deepEqual(after.n, before.n);
  assert.deepEqual(after.s, before.s);
  assert.deepEqual(after.e, before.e);
  assert.deepEqual(after.w, { x: 500, y: before.w.y });
  assert.deepEqual(res.clamped, []);
});

test('западная стена внутрь: проём, не помещающийся на укороченной стене, прижат и отмечен', () => {
  const { project, room, o } = rectProject();
  const res = moveWallBy(project, wallOf(project, room, 3), 1500, { finalize: true });
  assert.equal(res.ok, true);
  assert.equal(room.x, 2500);
  const after = pts(project, o);
  assert.equal(after.n.x, 3000); // ещё помещается — на месте
  assert.equal(after.s.x, 2500 + 450); // прижат к началу стены
  assert.deepEqual(res.clamped, [o.s.id]);
  assert.deepEqual(after.w, { x: 2500, y: 3500 });
});

test('перенос северной стены: проёмы W/E/S на месте, северное окно едет со стеной', () => {
  for (const delta of [-700, 800]) {
    const { project, room, o } = rectProject();
    const before = pts(project, o);
    const res = moveWallBy(project, wallOf(project, room, 0), delta, { finalize: true });
    assert.equal(res.ok, true);
    assert.equal(room.y, 2000 + delta);
    const after = pts(project, o);
    assert.deepEqual(after.w, before.w);
    assert.deepEqual(after.e, before.e);
    assert.deepEqual(after.s, before.s);
    assert.deepEqual(after.n, { x: before.n.x, y: 2000 + delta });
  }
});

test('общая стена: у правой комнаты меняется x, её проёмы на N/S не уезжают', () => {
  const project = createProject('Общая');
  const left = createRoom('living', 0, 0, 4000, 3000);
  const right = createRoom('bedroom', 4100, 0, 5000, 3000);
  project.rooms.push(left, right);
  const n = createOpening('window', right.id, 0, 3000, 900); // x 7100
  const s = createOpening('window', right.id, 2, 1000, 900); // x 5100
  const l = createOpening('window', left.id, 0, 1000, 900); // x 1000
  project.openings.push(n, s, l);
  const wall = deriveWalls(project).find((w) => w.kind === 'shared');
  assert.equal(moveWallBy(project, wall, -600, { finalize: true }).ok, true);
  assert.equal(right.x, 3500);
  assert.equal(center(project, n).x, 7100);
  assert.equal(center(project, s).x, 5100);
  assert.equal(center(project, l).x, 1000);
});

test('растяжение за ручку W (габарит): снимок и пересчёт идемпотентны', () => {
  const { project, room, o } = rectProject();
  const before = pts(project, o);
  const anchors = captureOpeningAnchors(project, room);
  for (const x of [600, 200, 800]) { // несколько шагов перетаскивания
    room.w = 1000 + 4000 - x; room.x = x;
    reanchorOpenings(project, room, anchors);
  }
  const after = pts(project, o);
  assert.deepEqual(after.n, before.n);
  assert.deepEqual(after.s, before.s);
  assert.deepEqual(after.w, { x: 800, y: before.w.y });
});

function lProject() {
  // Г-комната: вырез в северо-восточном углу 2000×2000.
  const project = createProject('Г');
  const room = { ...createRoom('living', 0, 0, 6000, 5000), notch: { corner: 'ne', w: 2000, h: 2000 } };
  project.rooms.push(room);
  const o = {
    n: createOpening('window', room.id, 0, 1500, 900),
    nv: createOpening('window', room.id, 'notch-v', 500, 900), // x 4000, y 500
    nh: createOpening('window', room.id, 'notch-h', 5000, 900), // y 2000, x 5000
    e: createOpening('window', room.id, 1, 3500, 900),
    s: createOpening('door', room.id, 2, 3000, 900),
    w: createOpening('window', room.id, 3, 2500, 900),
  };
  project.openings.push(...Object.values(o));
  return { project, room, o };
}

test('Г-комната: перенос западной стены не сдвигает остальные проёмы', () => {
  const { project, room, o } = lProject();
  const before = pts(project, o);
  assert.equal(moveWallBy(project, wallOf(project, room, 3), -1000, { finalize: true }).ok, true);
  assert.equal(room.x, -1000);
  assert.ok(room.notch);
  const after = pts(project, o);
  for (const k of ['n', 'nv', 'nh', 'e', 's']) assert.deepEqual(after[k], before[k], k);
  assert.deepEqual(after.w, { x: -1000, y: before.w.y });
});

test('Г-комната: перенос северной стены — вырез едет, проёмы остаются', () => {
  const { project, room, o } = lProject();
  const before = pts(project, o);
  assert.equal(moveWallBy(project, wallOf(project, room, 0), -1000, { finalize: true }).ok, true);
  assert.equal(room.y, -1000);
  const after = pts(project, o);
  for (const k of ['nv', 'e', 's', 'w']) assert.deepEqual(after[k], before[k], k);
  assert.deepEqual(after.n, { x: before.n.x, y: -1000 });
  assert.deepEqual(after.nh, { x: before.nh.x, y: 1000 }); // уступ сдвинулся вместе с N
});

test('контурная Г-комната: finalize меняет room.x и номера сторон — проёмы на месте', () => {
  const project = createProject('Контур');
  const room = {
    ...createRoom('living', 0, 0, 4000, 3000),
    outline: [
      { x: 0, y: 0 }, { x: 2000, y: 0 }, { x: 2000, y: 1000 },
      { x: 4000, y: 1000 }, { x: 4000, y: 3000 }, { x: 0, y: 3000 },
    ],
  };
  project.rooms.push(room);
  const step = createOpening('window', room.id, 'outline-2', 3000, 900); // y 1000, x 3000
  const s = createOpening('door', room.id, 2, 3000, 900); // y 3000, x 3000
  const w = createOpening('window', room.id, 3, 2000, 900); // x 0, y 2000
  project.openings.push(step, s, w);
  const before = [step, s, w].map((x) => center(project, x));
  assert.equal(moveWallBy(project, wallOf(project, room, 3), -500, { finalize: true }).ok, true);
  assert.equal(room.x, -500);
  const after = [step, s, w].map((x) => center(project, x));
  assert.deepEqual(after[0], before[0]);
  assert.deepEqual(after[1], before[1]);
  assert.deepEqual(after[2], { x: -500, y: 2000 });
});
