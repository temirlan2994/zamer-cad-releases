// Открытые помещения (терраса, балкон) не взаимодействуют со стенами и
// съеданием; перила — объект (core/railings.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, createRoom, deserializeProject, fileDataV6, serializeProject } from '../core/model.js';
import { deriveWalls } from '../core/walls.js';
import { reconcileEats } from '../core/v7/eat-bridge.js';
import { roomOverlaps } from '../core/norms.js';
import { rotateRoomGroup } from '../core/room-group.js';
import { addBlock, createBlock, createProject7 } from '../core/v7/model.js';
import { magnetSnap } from '../core/v7/magnet.js';
import { buildHouseMesh, railingFaces } from '../core/mesh3d.js';
import { pickFaces, pickObject } from '../core/pick3d.js';
import {
  RAILING_MAX_HEIGHT, defaultRailings, materializeRailings, moveRailingEnd, normalizeRailingList, railingHit,
  railingList, removeRailing, roomRailings, setRailingProps, setRailingRange, setSideRailing, splitRailing, turnRailings,
} from '../core/railings.js';

function house() {
  const p = createProject('Терраса');
  const living = createRoom('living', 1000, 0, 3000, 4000);
  living.id = 'living';
  p.rooms.push(living);
  return { p, living };
}

const shape = (r) => ({ x: r.x, y: r.y, w: r.w, h: r.h, outline: r.outline || null });

test('терраса вплотную к наружной грани и под стеной: стены дома не меняются', () => {
  for (const y of [4250, 4000, 3900]) {
    const { p } = house();
    const before = JSON.stringify(deriveWalls(p));
    const terrace = createRoom('terrace', 0, y, 5000, 2000);
    p.rooms.push(terrace);
    assert.equal(JSON.stringify(deriveWalls(p)), before, `y=${y}: стены дома те же`);
  }
});

test('терраса не съедает и не съедается, замечания о пересечении нет', () => {
  for (const order of ['over', 'under']) {
    const { p, living } = house();
    const terrace = createRoom('terrace', 0, 3000, 5000, 2000);
    if (order === 'over') p.rooms.push(terrace); else p.rooms.unshift(terrace);
    const t0 = shape(terrace); const l0 = shape(living);
    const res = reconcileEats(p, { touched: [terrace.id] });
    assert.deepEqual(shape(terrace), t0, `${order}: терраса номинальна`);
    assert.deepEqual(shape(living), l0, `${order}: комната номинальна`);
    assert.equal(res.eaten.length, 0);
    assert.equal(living.eatBase, undefined);
    assert.equal(terrace.eatBase, undefined);
    assert.equal(roomOverlaps(p).length, 0, 'нет замечания о перекрытии');
    assert.equal(deriveWalls(p).some((w) => w.kind === 'shared'), false, 'нет перегородки');
  }
});

test('магнит: терраса прижимается к наружной грани стены без перегородки', () => {
  const p = createProject7();
  addBlock(p, createBlock('living', 0, 0, 4000, 3000, { id: 'h' }));
  addBlock(p, createBlock('terrace', 0, 3400, 4000, 2000, { id: 't' }));
  const r = magnetSnap(p, 't', { x: 0, y: 3400, w: 4000, h: 2000 });
  assert.equal(r.y, 3250, 'зазор = наружная стена 250, не перегородка');
});

test('перила по умолчанию: со стороны дома нет, упираются в наружную грань', () => {
  const { p } = house();
  const terrace = createRoom('terrace', 0, 4250, 5000, 2000);
  p.rooms.push(terrace);
  const list = defaultRailings(terrace, p.rooms, p.settings);
  assert.deepEqual(list.filter((s) => s.side === 0).map((s) => [s.from, s.to]), [[0, 750], [4250, 5000]]);
  assert.ok(list.some((s) => s.side === 2 && s.from === 0 && s.to === 5000));
  // Терраса под стеной: тоже без перил на стыке.
  terrace.y = 3800;
  const under = defaultRailings(terrace, p.rooms, p.settings).filter((s) => s.side === 0);
  assert.deepEqual(under.map((s) => [s.from, s.to]), [[0, 750], [4250, 5000]]);
});

test('материализация и правки сегментов', () => {
  const { p } = house();
  const terrace = createRoom('terrace', 0, 4250, 5000, 2000);
  p.rooms.push(terrace);
  const auto = railingList(terrace, p.rooms, p.settings);
  const list = materializeRailings(terrace, p.rooms, p.settings);
  assert.deepEqual(list.map((s) => s.id), auto.map((s) => s.id), 'id сохраняются');
  const bottom = list.find((s) => s.side === 2);
  // Укоротить, клампинг по стороне.
  moveRailingEnd(terrace, bottom.id, 'b', 3000);
  assert.equal(bottom.to, 3000);
  moveRailingEnd(terrace, bottom.id, 'a', -500);
  assert.equal(bottom.from, 0);
  setRailingRange(terrace, bottom.id, 1000, 99999);
  assert.deepEqual([bottom.from, bottom.to], [1000, 5000]);
  // Разделить и удалить часть.
  const part = splitRailing(terrace, bottom.id, 3000);
  assert.ok(part);
  assert.deepEqual([bottom.from, bottom.to], [1000, 3000]);
  assert.ok(removeRailing(terrace, part));
  assert.equal(terrace.railings.filter((s) => s.side === 2).length, 1);
  // Тип и высота (клампинг).
  setRailingProps(terrace, bottom.id, { type: 'glass', height: 5000 });
  assert.equal(bottom.type, 'glass');
  assert.equal(bottom.height, RAILING_MAX_HEIGHT);
  // Сторона целиком и снятие.
  setSideRailing(terrace, p.rooms, p.settings, 1, false);
  assert.equal(terrace.railings.some((s) => s.side === 1), false);
  setSideRailing(terrace, p.rooms, p.settings, 1, true);
  assert.ok(terrace.railings.some((s) => s.side === 1 && s.from === 0 && s.to === 2000));
  // Растяжение комнаты: сегмент зажимается по стороне.
  terrace.w = 2000;
  assert.ok(railingList(terrace, p.rooms, p.settings).filter((s) => s.side === 2).every((s) => s.to <= 2000));
});

test('нормализация и сохранение v7/v6', () => {
  assert.equal(normalizeRailingList('x'), null);
  const clean = normalizeRailingList([{ side: 2, from: 900, to: 100, type: 'zzz', height: 0 }, { side: 7, from: 0, to: 100 }, { side: 0, from: 0, to: 10 }]);
  assert.equal(clean.length, 1);
  assert.deepEqual([clean[0].from, clean[0].to, clean[0].type, clean[0].height], [100, 900, 'rails', 1000]);
  const { p } = house();
  const terrace = createRoom('terrace', 0, 4250, 5000, 2000);
  terrace.railings = [{ id: 'r1', side: 2, from: 500, to: 4000, type: 'glass', height: 1100 }];
  p.rooms.push(terrace);
  const back = deserializeProject(serializeProject(p));
  const t7 = back.levels[0].rooms.find((r) => r.id === terrace.id);
  assert.deepEqual(t7.railings, terrace.railings, 'v7');
  const v6 = deserializeProject(JSON.stringify(fileDataV6(p)));
  assert.deepEqual(v6.levels[0].rooms.find((r) => r.id === terrace.id).railings, terrace.railings, 'v6');
});

test('поворот на 90° и перенос', () => {
  // turnRailings: h → v с тем же отсчётом, v → h от другого конца.
  assert.deepEqual(turnRailings([{ side: 0, from: 100, to: 600 }, { side: 1, from: 200, to: 500 }], 2000),
    [{ side: 1, from: 100, to: 600 }, { side: 2, from: 1500, to: 1800 }]);
  const p = createProject('Поворот');
  const terrace = createRoom('terrace', 0, 0, 4000, 2000);
  terrace.railings = [{ id: 'r', side: 0, from: 0, to: 1000, type: 'rails', height: 1000 }];
  p.rooms.push(terrace);
  const [a0] = roomRailings(terrace, p.rooms, p.settings);
  const res = rotateRoomGroup(p, [terrace.id], []);
  assert.ok(res.ok);
  assert.equal(terrace.railings[0].side, 1);
  const [a1] = roomRailings(terrace, p.rooms, p.settings);
  assert.equal(a1.orient, 'v');
  assert.equal(a1.b - a1.a, a0.b - a0.a);
  // Перенос: отсчёт от начала стороны — сегмент едет с комнатой.
  terrace.x += 500;
  assert.equal(roomRailings(terrace, p.rooms, p.settings)[0].edge, a1.edge + 500);
});

test('mesh3d: грани перил по сегментам; pick3d выбирает перила; план — railingHit', () => {
  const { p } = house();
  const terrace = createRoom('terrace', 0, 4250, 5000, 2000);
  terrace.railings = [{ id: 'g', side: 2, from: 0, to: 5000, type: 'glass', height: 1000 }];
  p.rooms.push(terrace);
  const faces = railingFaces(p, 0, p.activeLevel);
  assert.ok(faces.length > 0);
  assert.ok(faces.every((f) => f.railing?.id === 'g' && f.railing.roomId === terrace.id));
  const mesh = buildHouseMesh(p);
  assert.ok(mesh.some((f) => f.kind === 'railing'));
  // Луч сверху-сбоку в стекло перил (ось перил y = 6250 − 35).
  const ray = { o: { x: 2500, y: 9000, z: 600 }, d: { x: 0, y: -1, z: 0 } };
  const hit = pickObject({ faces: pickFaces(mesh) }, ray);
  assert.equal(hit?.type, 'railing');
  assert.equal(hit.id, 'g');
  const plan = railingHit(p, { x: 2500, y: 6230 }, 40);
  assert.equal(plan?.seg.id, 'g');
  assert.equal(Math.round(plan.at), 2500);
  // Удалённые перила — граней нет.
  removeRailing(terrace, 'g');
  assert.equal(railingFaces(p, 0, p.activeLevel).length, 0);
});
