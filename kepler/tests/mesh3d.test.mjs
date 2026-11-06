// 3D-модель дома: стены с проёмами, полы этажей, крыша и участок.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createProject, createRoom, createOpening, createLevel } from '../core/model.js';
import { buildHouseMesh, boxFaces } from '../core/mesh3d.js';

const zRange = (f) => [Math.min(...f.pts.map((p) => p.z)), Math.max(...f.pts.map((p) => p.z))];

function oneRoom(kind) {
  const p = createProject();
  const room = createRoom('living', 0, 0, 4000, 3000);
  p.rooms.push(room);
  p.openings.push(createOpening(kind, room.id, 0, 2000, 1200)); // верхняя стена, по центру
  return p;
}

test('коробка: верх и четыре стороны, нормали наружу', () => {
  const f = boxFaces(0, 0, 10, 20, 0, 30, '#fff', 'wall');
  assert.equal(f.length, 5);
  assert.deepEqual(f.map((x) => [x.normal.x, x.normal.y, x.normal.z]), [[0, 0, 1], [0, -1, 0], [0, 1, 0], [-1, 0, 0], [1, 0, 0]]);
  assert.deepEqual(boxFaces(0, 0, 0, 10, 0, 10), [], 'вырожденная — пусто');
});

test('окно режет стену: подоконник, перемычка и стекло', () => {
  const faces = buildHouseMesh(oneRoom('window'));
  const glass = faces.filter((f) => f.kind === 'glass');
  assert.equal(glass.length, 1);
  assert.deepEqual(zRange(glass[0]), [900, 2400]); // подоконник 900 + высота 1500
  // Над окном (x 1400…2600) есть кусок стены 2400…3000, под ним — 0…900.
  const over = faces.filter((f) => f.kind === 'wall' && f.normal.z === 1 && f.pts.every((p) => p.x >= 1399 && p.x <= 2601 && p.y <= 0));
  const tops = over.map((f) => f.pts[0].z).sort((a, b) => a - b);
  assert.deepEqual(tops, [900, 3000]);
  assert.ok(faces.filter((f) => f.kind === 'wall').every((f) => f.noEdges), 'части стены не обводятся как отдельные кубики');
  assert.ok(faces.some((f) => f.edges?.length >= 20), 'у цельной стены есть архитектурный контур и рёбра проёма');
});

test('дверь: проём до пола, только перемычка, без стекла', () => {
  const faces = buildHouseMesh(oneRoom('door'));
  assert.equal(faces.filter((f) => f.kind === 'glass').length, 0);
  const over = faces.filter((f) => f.kind === 'wall' && f.normal.z === 1 && f.pts.every((p) => p.x >= 1399 && p.x <= 2601 && p.y <= 0));
  assert.deepEqual(over.map((f) => f.pts[0].z), [3000], 'только перемычка над дверью');
});

test('этажи: полы на своих отметках, крыша над верхним, участок по желанию', () => {
  const p = createProject();
  p.rooms.push(createRoom('living', 0, 0, 5000, 4000));
  p.levels.push(createLevel('2 этаж', 3000, 2800, 'L2'));
  p.activeLevel = 'L2';
  p.rooms.push(createRoom('bedroom', 0, 0, 5000, 4000));
  const floors = buildHouseMesh(p).filter((f) => f.kind === 'floor').map((f) => f.pts[0].z);
  assert.deepEqual(floors, [1, 3001]);
  const roof = buildHouseMesh(p, { roof: true }).filter((f) => f.kind === 'roof');
  assert.ok(roof.length && roof.every((f) => zRange(f)[0] >= 5800));
  p.site.neighbors.push({ id: 'n', x: 20000, y: 0, w: 8000, h: 6000, height: 7000, rot: 30 });
  const site = buildHouseMesh(p, { site: true });
  assert.equal(site.filter((f) => f.kind === 'ground').length, 1);
  assert.equal(site.filter((f) => f.kind === 'neighbor').length, 5);
});

// Верх плиты: площадь горизонтальных граней с нормалью вверх.
const topArea = (faces) => faces.filter((f) => f.normal.z === 1).reduce((t, f) => {
  const xs = f.pts.map((p) => p.x); const ys = f.pts.map((p) => p.y);
  return t + (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys));
}, 0);
const sides = (faces) => faces.filter((f) => f.normal.z === 0);

function twoStorey() {
  // 1 этаж: 10×6 м из двух комнат; 2 этаж — только над левой (5×6 м).
  const p = createProject();
  p.settings.exterior = 250;
  p.rooms.push(createRoom('living', 0, 0, 5000, 6000), createRoom('kitchen', 5000, 0, 5000, 6000));
  p.levels.push(createLevel('2 этаж', 3000, 2800, 'L2'));
  p.activeLevel = 'L2';
  p.rooms.push(createRoom('bedroom', 0, 0, 5000, 6000));
  return p;
}

test('одноэтажный дом: одна кровля без швов по внешнему контуру', () => {
  const p = createProject();
  p.settings.exterior = 250;
  p.rooms.push(createRoom('living', 0, 0, 5000, 4000), createRoom('kitchen', 5000, 0, 3000, 4000));
  const faces = buildHouseMesh(p, { roof: true });
  const roof = faces.filter((f) => f.kind === 'roof');
  assert.equal(faces.filter((f) => f.kind === 'slab').length, 0, 'перекрытий нет');
  const tops = roof.filter((f) => f.normal.z === 1);
  assert.equal(tops.length, 1, 'смежные комнаты — одна плита');
  assert.equal(topArea(roof), 8500 * 4500);
  assert.equal(sides(roof).length, 4, 'торцы только по контуру');
  assert.ok(roof.every((f) => zRange(f)[0] >= 3000 && zRange(f)[1] <= 3250));
  // Рёбра — только по контуру: ни одно не лежит на шве x = 5000.
  const edges = roof.flatMap((f) => f.edges || []);
  assert.ok(edges.length && edges.every(([a, b]) => !(a.x === 5000 && b.x === 5000)));
});

test('Г-образная комната: кровля без внутренних швов, внутренний угол на месте', () => {
  const p = createProject();
  p.settings.exterior = 250;
  // Две смежные комнаты буквой Г: 6×3 и 3×3 под левой частью.
  p.rooms.push(createRoom('living', 0, 0, 6000, 3000), createRoom('hall', 0, 3000, 3000, 3000));
  const roof = buildHouseMesh(p, { roof: true }).filter((f) => f.kind === 'roof');
  assert.equal(topArea(roof), 6500 * 3500 + 3500 * 3000);
  assert.equal(sides(roof).length, 6, 'шесть торцов Г-контура');
  assert.ok(roof.filter((f) => f.normal.z === 1).length <= 2);
});

test('два этажа с неполным верхним: кровля над каждой открытой частью', () => {
  const p = twoStorey();
  const roof = buildHouseMesh(p, { roof: true }).filter((f) => f.kind === 'roof');
  const low = roof.filter((f) => zRange(f)[1] === 3250);
  const high = roof.filter((f) => zRange(f)[1] === 6050);
  assert.equal(low.length + high.length, roof.length, 'кровли только на отметках верха этажей');
  // Над 1 этажом — правая часть x 5250…10250 (левую закрывает 2 этаж со стеной).
  const lowTops = low.filter((f) => f.normal.z === 1);
  assert.equal(lowTops.length, 1);
  const xs = lowTops[0].pts.map((p0) => p0.x);
  assert.deepEqual([Math.min(...xs), Math.max(...xs)], [5250, 10250]);
  assert.equal(topArea(low), 5000 * 6500);
  assert.equal(topArea(high), 5500 * 6500);
  // Без кровли — открыто сверху, как раньше.
  assert.equal(buildHouseMesh(p).filter((f) => f.kind === 'roof').length, 0);
});

test('перекрытие между этажами: под верхним этажом, толщина 200, лестница вырезана', () => {
  const p = twoStorey();
  let slab = buildHouseMesh(p).filter((f) => f.kind === 'slab');
  assert.ok(slab.length);
  assert.ok(slab.every((f) => zRange(f)[0] >= 2800 && zRange(f)[1] <= 3000));
  assert.ok(slab.some((f) => zRange(f)[0] === 2800) && slab.some((f) => zRange(f)[1] === 2999));
  assert.equal(topArea(slab), 5540 * 6540, 'пятно 2 этажа ∩ 1 этажа, со стеной и выступом 20');
  // Лестница на 2 этаже — проём в перекрытии.
  p.rooms.push(createRoom('stairs-room', 1000, 1000, 2000, 3000));
  slab = buildHouseMesh(p).filter((f) => f.kind === 'slab');
  assert.equal(topArea(slab), 5540 * 6540 - 2000 * 3000);
  assert.equal(sides(slab).length, 8, 'внешний контур и проём');
});

test('пол террасы в 3D лежит ниже пола дома', () => {
  const p = createProject();
  const room = createRoom('living', 0, 0, 5000, 4000);
  const terrace = createRoom('terrace', 3000, 0, 4000, 4000);
  p.rooms.push(room, terrace);
  const floors = buildHouseMesh(p).filter((face) => face.kind === 'floor');
  assert.equal(floors.find((face) => face.roomId === room.id).pts[0].z, 1);
  assert.equal(floors.find((face) => face.roomId === terrace.id).pts[0].z, 0);
});

// Устаревший v1 (явно, при любом движке): в v2 заплаток нет, наложения
// проверяет инвариант e (wall-invariants).
test('v1: заплатки стыков без двойного объёма и без потери покрытия', async () => {
  const { deriveWallsV1: deriveWalls, wallJoinPatches } = await import('../core/walls.js');
  const { WALL_FIXTURES } = await import('./wall-fixtures.mjs');
  const inside = (r, x, y) => x > r.x && x < r.x + r.w && y > r.y && y < r.y + r.h;
  const cross = (a, b) => Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > 0.5 &&
    Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > 0.5;
  let checked = 0;
  for (const name of ['teeJoint', 'crossJoint', 'mixedThicknessNode', 'nestedAtSharedWall', 'steppedWithKitchenAndShaft']) {
    const walls = deriveWalls(WALL_FIXTURES[name]());
    const solid = walls.filter((w) => !w.hidden && (w.kind === 'own' || w.kind === 'shared')).map((w) => w.band);
    const patches = wallJoinPatches(walls).map((p) => p.rect);
    for (const [i, p] of patches.entries()) {
      assert.ok(!solid.some((s) => cross(p, s)), `${name}: заплатка ${JSON.stringify(p)} поверх полосы`);
      assert.ok(!patches.some((q, j) => j !== i && cross(p, q)), `${name}: заплатки перекрываются`);
    }
    // Всё, что покрывали joint/chamfer, по-прежнему покрыто (полосой или заплаткой).
    for (const w of walls.filter((x) => !x.hidden && (x.kind === 'joint' || x.kind === 'chamfer'))) {
      const b = w.band;
      for (let x = b.x + 5; x < b.x + b.w; x += 10) {
        for (let y = b.y + 5; y < b.y + b.h; y += 10) {
          checked += 1;
          assert.ok([...solid, ...patches].some((r) => inside(r, x, y)), `${name}: дыра в (${x}, ${y})`);
        }
      }
    }
  }
  assert.ok(checked > 0, 'в фикстурах есть заплатки');
});

// Движок v2: одно тело на этаж — боковые грани только по контуру, без
// внутренних граней между кусками; рёбра — контур и кромки проёмов.
test('v2: стены — боковые грани по контуру, без швов между кусками', { skip: process.env.KEPLER_WALLS === 'v1' && 'проверка движка v2' }, () => {
  const p = createProject();
  p.settings.wallsEngine = 'v2';
  p.rooms.push(createRoom('living', 0, 0, 4000, 3000));
  const walls = buildHouseMesh(p).filter((f) => f.kind === 'wall');
  const sideFaces = walls.filter((f) => f.normal.z === 0);
  assert.equal(sideFaces.length, 8, 'наружный и внутренний контур — по 4 грани');
  const top = walls.filter((f) => f.normal.z === 1);
  const area = top.reduce((s, f) => s + (f.pts[2].x - f.pts[0].x) * (f.pts[2].y - f.pts[0].y), 0);
  assert.equal(area, 4500 * 3500 - 4000 * 3000, 'верх = площадь кольца стен');
  assert.ok(walls.every((f) => f.noEdges));
  const edges = walls.flatMap((f) => f.edges || []);
  assert.equal(edges.length, 8 * 2 + 8, 'рёбра: контуры низа и верха + 8 вертикалей углов');
  // С окном: стекло, подоконник 900 и верх 3000 над проёмом.
  p.openings.push(createOpening('window', p.rooms[0].id, 0, 2000, 1200));
  const faces = buildHouseMesh(p);
  assert.equal(faces.filter((f) => f.kind === 'glass').length, 1);
  const over = faces.filter((f) => f.kind === 'wall' && f.normal.z === 1 && f.pts.every((q) => q.x >= 1399 && q.x <= 2601 && q.y <= 0));
  assert.deepEqual(over.map((f) => f.pts[0].z).sort((x, y) => x - y), [900, 3000]);
  assert.ok(faces.some((f) => f.kind === 'wall' && f.normal.z === -1), 'низ перемычки');
});
