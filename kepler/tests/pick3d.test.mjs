// 3D: выбор стены лучом (core/pick3d.js), ссылки граней на стены
// (core/mesh3d.js) и правка стены ручками (core/wall-edit3d.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLevel, createOpening, createProject, createRoom } from '../core/model.js';
import { buildHouseMesh, buildLevelWalls } from '../core/mesh3d.js';
import {
  axisDelta, pickWall, projectPoint, screenRay, wallBoxes,
} from '../core/pick3d.js';
import {
  applyGrip, applyGripValue, findWallRecord, gripFor, gripValue, wallHeight3d,
} from '../core/wall-edit3d.js';
import { addManualWall } from '../core/wall-manual.js';
import { deriveWalls } from '../core/walls.js';

const close = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

function room4x3() {
  const p = createProject('3d');
  const r = createRoom('living', 0, 0, 4000, 3000);
  r.id = 'R';
  p.rooms.push(r);
  return p;
}
const ray = (o, d) => ({ o, d });
const down = (x, y) => ray({ x, y, z: 50000 }, { x: 0, y: 0, z: -1 });

test('луч сверху: верх стены, ключ, грань «top»; внутрь комнаты — промах', () => {
  const p = room4x3();
  const boxes = wallBoxes(p);
  const hit = pickWall(boxes, down(2000, -100));
  assert.equal(hit.key, 'e|R|0');
  assert.equal(hit.face, 'top');
  assert.equal(hit.point.z, 3000);
  assert.equal(hit.levelId, p.activeLevel);
  assert.equal(pickWall(boxes, down(2000, 1500)), null, 'пол не стена');
  assert.equal(pickWall(boxes, ray({ x: 2000, y: -5000, z: 5000 }, { x: 0, y: 1, z: 0 })), null, 'над стенами');
});

test('луч сбоку: ближайшая грань, нормаль наружу, торец и бок', () => {
  const p = room4x3();
  const boxes = wallBoxes(p);
  const side = pickWall(boxes, ray({ x: 2000, y: -9000, z: 1500 }, { x: 0, y: 1, z: 0 }));
  assert.equal(side.key, 'e|R|0');
  assert.equal(side.face, 'side');
  assert.deepEqual(side.normal, { x: 0, y: -1, z: 0 });
  assert.equal(side.point.y, -250);
  // Слева направо: сначала левая стена (x = −250), а не правая.
  const near = pickWall(boxes, ray({ x: -9000, y: 1500, z: 1500 }, { x: 1, y: 0, z: 0 }));
  assert.equal(near.key, 'e|R|3');
  assert.equal(near.point.x, -250);
  assert.equal(near.face, 'side');
  // Вдоль верхней стены слева — в её торец (угол принадлежит ей).
  const end = pickWall(boxes, ray({ x: -9000, y: -100, z: 1500 }, { x: 1, y: 0, z: 0 }));
  assert.equal(end.key, 'e|R|0');
  assert.equal(end.face, 'end');
});

test('окно: луч проходит в проём и попадает в дальнюю стену; ниже — в подоконную часть', () => {
  const p = room4x3();
  p.openings.push(createOpening('window', 'R', 0, 2000, 1200)); // x 1400…2600, z 900…2400
  const boxes = wallBoxes(p);
  const through = pickWall(boxes, ray({ x: 2000, y: -9000, z: 1500 }, { x: 0, y: 1, z: 0 }));
  assert.equal(through.key, 'e|R|2', 'в проёме стены нет — дальняя стена');
  assert.equal(through.point.y, 3000);
  const sill = pickWall(boxes, ray({ x: 2000, y: -9000, z: 500 }, { x: 0, y: 1, z: 0 }));
  assert.equal(sill.key, 'e|R|0');
  // Подоконник — горизонтальная грань не на верху стены: без ручки.
  const top = pickWall(boxes, down(2000, -100));
  assert.equal(top.point.z, 3000, 'сверху — перемычка');
  const sillTop = pickWall(boxes, ray({ x: 2000, y: -100, z: 2000 }, { x: 0, y: 0, z: -1 }));
  assert.equal(sillTop.face, 'reveal');
  assert.equal(gripFor(sillTop), null);
});

test('экранный луч: точка → пиксель → луч проходит через точку; поворот дома не влияет', () => {
  const cam = { yaw: -2.2, pitch: 0.62, dist: 25000, eyeDist: 50000, target: { x: 2000, y: 1500, z: 1500 } };
  const p0 = { x: 2000, y: -125, z: 2999 };
  const px = projectPoint(cam, 800, 600, p0);
  const r = screenRay(cam, 800, 600, px.x, px.y);
  const t = (p0.x - r.o.x) * r.d.x + (p0.y - r.o.y) * r.d.y + (p0.z - r.o.z) * r.d.z;
  const q = { x: r.o.x + r.d.x * t, y: r.o.y + r.d.y * t, z: r.o.z + r.d.z * t };
  assert.ok(Math.hypot(q.x - p0.x, q.y - p0.y, q.z - p0.z) < 1e-3);
  const p = room4x3();
  const hit = pickWall(wallBoxes(p), r);
  assert.equal(hit.key, 'e|R|0');
  p.building = { rotation: 30, origin: { x: 5000, y: -2000 } };
  const hit2 = pickWall(wallBoxes(p), r);
  assert.equal(hit2.key, hit.key);
  assert.ok(close(hit2.t, hit.t));
  // Сдвиг мыши вверх по экрану поднимает по оси z.
  assert.ok(axisDelta(cam, 800, 600, { x: 0, y: 0, z: 1 }, 0, -50) > 0);
  assert.equal(axisDelta({ ...cam, pitch: Math.PI / 2 }, 800, 600, { x: 0, y: 0, z: 1 }, 0, -50), 0, 'ось в глаз');
});

test('перспективный экранный луч проходит через спроецированную точку', () => {
  const cam = {
    yaw: -2.2, pitch: 0.62, dist: 25000, eyeDist: 30000,
    projection: 'perspective', target: { x: 2000, y: 1500, z: 1500 },
  };
  const p = { x: 1500, y: 800, z: 2400 };
  const px = projectPoint(cam, 900, 600, p);
  const r = screenRay(cam, 900, 600, px.x, px.y);
  const t = (p.x - r.o.x) * r.d.x + (p.y - r.o.y) * r.d.y + (p.z - r.o.z) * r.d.z;
  const q = { x: r.o.x + r.d.x * t, y: r.o.y + r.d.y * t, z: r.o.z + r.d.z * t };
  assert.ok(Math.hypot(q.x - p.x, q.y - p.y, q.z - p.z) < 1e-3);
  assert.ok(axisDelta(cam, 900, 600, { x: 0, y: 0, z: 1 }, 0, -40) > 0);
});

test('грани 3D ссылаются на свои стены (ref), стекло — тоже', () => {
  const p = room4x3();
  p.openings.push(createOpening('window', 'R', 0, 2000, 1200));
  const faces = buildHouseMesh(p);
  const keys = new Set(deriveWalls(p).map((w) => w.key));
  const walls = faces.filter((f) => f.kind === 'wall');
  assert.ok(walls.length > 0);
  for (const f of walls) {
    assert.equal(f.ref?.type, 'wall');
    assert.ok(keys.has(f.ref.key) || f.ref.keys?.some((k) => keys.has(k)), f.ref.key);
    assert.equal(f.ref.level, p.activeLevel);
  }
  if (process.env.KEPLER_WALLS !== 'v1') {
    const tops = walls.filter((f) => f.ref.face === 'top' && f.pts[0].z === 3000);
    assert.deepEqual([...new Set(tops.map((f) => f.ref.key))].sort(), [...keys].sort());
    assert.ok(walls.filter((f) => f.ref.key === 'e|R|0' && f.ref.face === 'side').length >= 2);
  }
  assert.equal(faces.find((f) => f.kind === 'glass').ref.key, 'e|R|0');
  assert.ok(buildLevelWalls(p, p.activeLevel).every((f) => f.wallsOf === p.activeLevel));
});

test('своя высота ручной стены: верх, отметка этажа выше, низ над полом; проём по стене', { skip: process.env.KEPLER_WALLS === 'v1' && 'ручные стены — только v2' }, () => {
  const p = room4x3();
  const upper = createLevel('2 этаж', 3000, 3000);
  p.levels.push(upper);
  const w = addManualWall(p, { x: 2000, y: 0 }, { x: 2000, y: 3000 }, { thickness: 100 });
  w.top.height = 1200;
  let hit = pickWall(wallBoxes(p), down(2000, 1500));
  assert.equal(hit.key, `m|${w.id}`);
  assert.equal(hit.wallId, w.id);
  assert.equal(hit.face, 'top');
  assert.equal(hit.point.z, 1200);
  // Верх по этажу выше: отметка его пола (+ offset).
  w.top = { level: upper.id, offset: 0, height: null };
  hit = pickWall(wallBoxes(p), down(2000, 1500));
  assert.equal(hit.point.z, 3000);
  w.top = { level: upper.id, offset: 2000, height: null };
  const rec = findWallRecord(p, `m|${w.id}`);
  assert.equal(wallHeight3d(p, rec).height, 5000, 'стена через этаж');
  let faces = buildHouseMesh(p).filter((f) => f.ref?.key === `m|${w.id}`);
  assert.equal(Math.max(...faces.flatMap((f) => f.pts.map((q) => q.z))), 5000);
  // Низ поднят: под стеной есть грань низа, луч снизу попадает в неё.
  w.top = { level: null, offset: 0, height: 1000 };
  w.base = { offset: 800 };
  faces = buildHouseMesh(p).filter((f) => f.ref?.key === `m|${w.id}`);
  const zs = faces.flatMap((f) => f.pts.map((q) => q.z));
  assert.deepEqual([Math.min(...zs), Math.max(...zs)], [800, 1800]);
  assert.ok(faces.some((f) => f.normal.z === -1 && f.pts[0].z === 800), 'низ стены');
  assert.equal(pickWall(wallBoxes(p), ray({ x: 2000, y: 1500, z: 100 }, { x: 0, y: 0, z: 1 })).face, 'reveal');
  // Наружные стены — на всю высоту этажа, рёбра контура строятся.
  const outer = buildHouseMesh(p).filter((f) => f.ref?.key === 'e|R|0');
  assert.equal(Math.max(...outer.flatMap((f) => f.pts.map((q) => q.z))), 3000);
});

test('правка ручками: высота, толщина с неподвижной гранью, сдвиг, длина, число', { skip: process.env.KEPLER_WALLS === 'v1' && 'ручные стены — только v2' }, () => {
  const p = room4x3();
  const w = addManualWall(p, { x: 2000, y: 0 }, { x: 2000, y: 3000 }, { thickness: 100 });
  const key = `m|${w.id}`;
  let rec = findWallRecord(p, key);
  const top = gripFor({ face: 'top', kind: 'manual', normal: { x: 0, y: 0, z: 1 } });
  assert.equal(gripValue(p, rec, top), 3000);
  assert.equal(applyGrip(p, rec, top, -1234).ok, true);
  assert.equal(w.top.height, 1750, 'верх 3000 − 1234 → привязка 50 мм');
  assert.equal(applyGrip(p, findWallRecord(p, key), top, -99999).ok, true);
  assert.equal(w.top.height, 100, 'не ниже минимума');

  // Alt + бок справа (+x): толщина растёт вправо, левая грань (1950) на месте.
  rec = findWallRecord(p, key);
  const right = gripFor({ face: 'side', kind: 'manual', normal: { x: 1, y: 0, z: 0 } }, { alt: true });
  assert.equal(right.kind, 'thickness');
  assert.equal(applyGrip(p, rec, right, 104).ok, true);
  rec = findWallRecord(p, key);
  assert.equal(rec.thickness, 200);
  assert.equal(rec.band.x, 1950);
  // Бок без Alt: сдвиг по нормали грани.
  const left = gripFor({ face: 'side', kind: 'manual', normal: { x: -1, y: 0, z: 0 } });
  assert.equal(applyGrip(p, rec, left, 480, { finalize: true }).ok, true);
  rec = findWallRecord(p, key);
  assert.equal(rec.band.x, 1450, 'влево на 500 (привязка)');
  // Торец снизу (+y): длина.
  const end = gripFor({ face: 'end', kind: 'manual', normal: { x: 0, y: 1, z: 0 } });
  assert.equal(applyGrip(p, rec, end, -1000).ok, true);
  assert.equal(Math.max(w.axis.a.y, w.axis.b.y), 2000);
  // Числом: длина 2500 от верхнего торца, толщина 150, высота 2700.
  rec = findWallRecord(p, key);
  assert.equal(applyGripValue(p, rec, end, 2500).ok, true);
  assert.equal(Math.max(w.axis.a.y, w.axis.b.y), 2500);
  assert.equal(applyGripValue(p, findWallRecord(p, key), right, 150).ok, true);
  assert.equal(w.thickness, 150);
  assert.equal(applyGripValue(p, findWallRecord(p, key), top, 2700).ok, true);
  assert.equal(w.top.height, 2700);
  assert.equal(applyGripValue(p, rec, top, -5).ok, false);
});

test('правка стены комнаты: высота в wallOverrides, сдвиг грани, толщина', () => {
  const p = room4x3();
  let rec = findWallRecord(p, 'e|R|1');
  const top = { kind: 'height', axis: { x: 0, y: 0, z: 1 } };
  assert.equal(applyGrip(p, rec, top, 520).ok, true);
  assert.equal(p.wallOverrides['e|R|1'].top.height, 3500);
  if (process.env.KEPLER_WALLS !== 'v1') {
    const hit = pickWall(wallBoxes(p), down(4100, 1500));
    assert.equal(hit.key, 'e|R|1');
    assert.equal(hit.point.z, 3500, '3D следует своей высоте стены комнаты');
  }
  // Бок наружу (+x) — правая стена отъезжает, комната шире.
  rec = findWallRecord(p, 'e|R|1');
  assert.equal(applyGrip(p, rec, { kind: 'move', axis: { x: 1, y: 0, z: 0 } }, 1000, { finalize: true }).ok, true);
  assert.equal(p.rooms[0].w, 5000);
  rec = findWallRecord(p, 'e|R|1');
  assert.equal(applyGrip(p, rec, { kind: 'thickness', axis: { x: 1, y: 0, z: 0 } }, 50).ok, true);
  assert.equal(findWallRecord(p, 'e|R|1').thickness, 300);
  // Торец стены комнаты — без ручки длины.
  assert.equal(gripFor({ face: 'end', kind: 'own', normal: { x: 0, y: 1, z: 0 } }), null);
});
