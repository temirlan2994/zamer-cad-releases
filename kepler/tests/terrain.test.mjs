// Тесты рельефа: триангуляция Делоне, интерполяция, горизонтали, уклон,
// отметки под домом, разбор отметок из DXF, нормализация, экспорт.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  contours, dxfMarksToPx, houseTerrain, interpolateZ, normalizeTerrain, parseElevationM,
  parseXyzList, slopeAt, terrainModel, triangulate, underlayMarksToWorld,
} from '../core/terrain.js';
import { extractDxfElevations, parseDxf } from '../core/dxf.js';
import { createProject, createRoom, deserializeProject, serializeProject } from '../core/model.js';
import { buildSitePlanDxf, buildStructuredExport } from '../core/export.js';
import { buildHouseMesh } from '../core/mesh3d.js';

// Плоскость z = z0 + a·x + b·y (мм).
const plane = (x, y) => 100000 + 0.05 * x - 0.02 * y;

function grid(n, step, fn = plane) {
  const pts = [];
  for (let i = 0; i < n; i += 1) for (let j = 0; j < n; j += 1) pts.push({ x: i * step, y: j * step, z: fn(i * step, j * step) });
  return pts;
}

function rng(seed) {
  let s = seed;
  return () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
}

// Свойство Делоне: ни одна точка не лежит строго внутри описанной окружности.
function assertDelaunay(t) {
  for (const tri of t.tris) {
    const [a, b, c] = tri.map((i) => t.pts[i]);
    const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
    const ux = ((a.x ** 2 + a.y ** 2) * (b.y - c.y) + (b.x ** 2 + b.y ** 2) * (c.y - a.y) + (c.x ** 2 + c.y ** 2) * (a.y - b.y)) / d;
    const uy = ((a.x ** 2 + a.y ** 2) * (c.x - b.x) + (b.x ** 2 + b.y ** 2) * (a.x - c.x) + (c.x ** 2 + c.y ** 2) * (b.x - a.x)) / d;
    const r = Math.hypot(a.x - ux, a.y - uy);
    for (const p of t.pts) {
      assert.ok(Math.hypot(p.x - ux, p.y - uy) >= r * (1 - 1e-6), 'точка внутри описанной окружности');
    }
  }
}

const triArea = (t) => t.tris.reduce((s, tri) => {
  const [a, b, c] = tri.map((i) => t.pts[i]);
  return s + Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)) / 2;
}, 0);

test('триангуляция сетки 6×6: 50 треугольников, покрывает квадрат', () => {
  const t = triangulate(grid(6, 1000));
  assert.equal(t.error, null);
  assert.equal(t.tris.length, 50);
  assert.ok(Math.abs(triArea(t) - 25e6) < 1);
});

test('триангуляция случайных наборов: Делоне, площадь = площади оболочки', () => {
  for (const seed of [1, 7, 42]) {
    const r = rng(seed);
    const pts = Array.from({ length: 120 }, () => ({ x: r() * 50000, y: r() * 30000, z: r() * 3000 }));
    const t = triangulate(pts);
    assert.equal(t.error, null);
    assertDelaunay(t);
    let hullArea = 0;
    for (let i = 0; i < t.hull.length; i += 1) {
      const a = t.hull[i]; const b = t.hull[(i + 1) % t.hull.length];
      hullArea += a.x * b.y - b.x * a.y;
    }
    assert.ok(Math.abs(triArea(t) - Math.abs(hullArea) / 2) / triArea(t) < 1e-6);
    // Эйлер для триангуляции точек: T = 2n − 2 − h.
    assert.equal(t.tris.length, 2 * t.pts.length - 2 - t.hull.length);
  }
});

test('интерполяция на плоскости известного уклона точна', () => {
  const r = rng(3);
  const pts = Array.from({ length: 40 }, () => { const x = r() * 20000; const y = r() * 20000; return { x, y, z: plane(x, y) }; });
  pts.push({ x: 0, y: 0, z: plane(0, 0) }, { x: 20000, y: 0, z: plane(20000, 0) }, { x: 0, y: 20000, z: plane(0, 20000) }, { x: 20000, y: 20000, z: plane(20000, 20000) });
  const model = terrainModel({ points: pts });
  for (const [x, y] of [[1234, 5678], [10000, 10000], [19999, 1], [0, 0]]) {
    assert.ok(Math.abs(interpolateZ(model, x, y) - plane(x, y)) < 1e-6, `${x},${y}`);
  }
  const s = slopeAt(model, 5000, 5000);
  assert.ok(Math.abs(s.percent - Math.hypot(5, 2)) < 1e-6);
  // Вниз по склону: z растёт по x и падает по y → вниз — к −x, +y.
  assert.ok(Math.cos((s.downDeg * Math.PI) / 180) < 0 && Math.sin((s.downDeg * Math.PI) / 180) > 0);
  // Вне оболочки: null, с clamp — по ближайшему краю.
  assert.equal(interpolateZ(model, -5000, 1000), null);
  assert.ok(Math.abs(interpolateZ(model, -5000, 1000, { clamp: true }) - plane(0, 1000)) < 1e-6);
});

test('горизонтали на плоскости: прямые с шагом, каждая 5-я — основная', () => {
  const model = terrainModel({ points: grid(5, 5000) }); // 20×20 м
  const levels = contours(model, 100);
  assert.ok(levels.length > 5);
  for (const lv of levels) {
    assert.equal(lv.z % 100, 0);
    assert.equal(lv.major, (lv.z / 100) % 5 === 0);
    assert.equal(lv.lines.length, 1); // на плоскости — одна связная линия
    for (const p of lv.lines[0].pts) assert.ok(Math.abs(plane(p.x, p.y) - lv.z) < 1e-6);
    assert.equal(lv.lines[0].closed, false);
  }
});

test('горизонтали на конусе: замкнутые кольца', () => {
  const pts = [{ x: 0, y: 0, z: 5000 }];
  for (let k = 0; k < 36; k += 1) {
    const a = (k / 36) * Math.PI * 2;
    for (const r of [4000, 8000, 12000]) pts.push({ x: Math.cos(a) * r, y: Math.sin(a) * r, z: 5000 - r / 2.4 });
  }
  const model = terrainModel({ points: pts });
  const levels = contours(model, 1000);
  assert.deepEqual(levels.map((l) => l.z), [1000, 2000, 3000, 4000]);
  for (const lv of levels) {
    assert.equal(lv.lines.length, 1);
    assert.equal(lv.lines[0].closed, true);
    const radius = (5000 - lv.z) * 2.4;
    for (const p of lv.lines[0].pts) assert.ok(Math.abs(Math.hypot(p.x, p.y) - radius) < radius * 0.02);
  }
});

test('вырожденные случаи: мало точек, на прямой, дубликаты — без падений', () => {
  assert.match(triangulate([]).error, /нет/);
  assert.match(triangulate([{ x: 0, y: 0, z: 1 }, { x: 1000, y: 0, z: 2 }]).error, /минимум 3/);
  assert.match(triangulate([{ x: 0, y: 0, z: 1 }, { x: 1000, y: 1000, z: 2 }, { x: 2000, y: 2000, z: 3 }]).error, /одной прямой/);
  const dup = triangulate([{ x: 0, y: 0, z: 1 }, { x: 0, y: 0, z: 9 }, { x: 0.3, y: 0, z: 1 }, { x: 1000, y: 0, z: 2 }]);
  assert.equal(dup.duplicates, 2);
  assert.match(dup.error, /минимум 3/);
  const m = terrainModel({ points: [{ x: 0, y: 0, z: 1 }] });
  assert.equal(interpolateZ(m, 0, 0, { clamp: true }), null);
  assert.deepEqual(contours(m, 500), []);
  assert.equal(slopeAt(m, 0, 0), null);
  // Точки с одинаковой высотой: плоская площадка, горизонталей нет.
  const flat = terrainModel({ points: grid(3, 1000, () => 50000) });
  assert.deepEqual(contours(flat, 500), []);
});

test('отметки под домом: углы, перепад, предупреждение > 1 м, отметка пола', () => {
  const project = createProject();
  project.levels[0].rooms.push(createRoom('living', 0, 0, 10000, 8000));
  project.settings.exterior = 0;
  project.building = { rotation: 90, origin: { x: 20000, y: 0 } }; // дом повёрнут
  // Склон 15 % вдоль Y съёмки.
  project.site.terrain = normalizeTerrain({ points: grid(6, 10000, (x, y) => 100000 + 0.15 * y) });
  const h = houseTerrain(project);
  assert.equal(h.corners.length, 4);
  // Повёрнутый дом: локальный X идёт вдоль Y съёмки (10 м → перепад 1.5 м).
  assert.ok(Math.abs(h.drop - 1500) < 1e-6);
  assert.equal(h.warn, true);
  assert.equal(h.floorZ, h.floorAuto);
  project.site.terrain.floorZ = 101000;
  assert.equal(houseTerrain(project).floorZ, 101000);
  // 3D: земля по рельефу (много граней), цоколь под домом.
  const faces = buildHouseMesh(project, { site: true });
  assert.ok(faces.filter((f) => f.kind === 'ground').length > 100);
  assert.ok(faces.some((f) => f.kind === 'plinth'));
  const flatFaces = buildHouseMesh(createProject(), { site: true });
  assert.ok(!flatFaces.some((f) => f.kind === 'plinth'));
});

test('ввод отметки и списка x, y, z', () => {
  assert.equal(parseElevationM('123.45'), 123450);
  assert.equal(parseElevationM(' 123,45 '), 123450);
  assert.equal(parseElevationM('-0.5'), -500);
  assert.equal(parseElevationM('абв'), null);
  assert.equal(parseElevationM(''), null);
  const { points, errors } = parseXyzList('X;Y;Z\n10;20;123,45\n1.5, 2.5, 100.1\n7\t8\t9\nмусор', 'm');
  assert.deepEqual(points, [{ x: 10000, y: 20000, z: 123450 }, { x: 1500, y: 2500, z: 100100 }, { x: 7000, y: 8000, z: 9000 }]);
  assert.deepEqual(errors, [5]);
  assert.equal(parseXyzList('1 2 3', 'mm').points[0].z, 3);
});

// --- DXF ---

const dxf = (body, units = 6) => [
  '0', 'SECTION', '2', 'HEADER', '9', '$INSUNITS', '70', String(units), '0', 'ENDSEC',
  '0', 'SECTION', '2', 'ENTITIES', ...body, '0', 'ENDSEC', '0', 'EOF',
].join('\n');
const point = (x, y, z) => ['0', 'POINT', '8', '0', '10', String(x), '20', String(y), '30', String(z)];
const text = (x, y, h, t) => ['0', 'TEXT', '8', '0', '10', String(x), '20', String(y), '40', String(h), '1', t];

test('DXF: POINT с Z в метрах и в миллиметрах', () => {
  const m = extractDxfElevations(parseDxf(dxf([...point(10, 20, 123.45), ...point(30, 20, 124.1), ...point(5, 5, 0)], 6)));
  assert.equal(m.marks.length, 2); // Z = 0 — точка без отметки
  assert.deepEqual(m.marks[0], { x: 10, y: 20, z: 123450 });
  const mm = extractDxfElevations(parseDxf(dxf([...point(10000, 20000, 123450)], 4)));
  assert.equal(mm.marks[0].z, 123450);
  // Без $INSUNITS — метры (как подложка).
  const none = extractDxfElevations(parseDxf(['0', 'SECTION', '2', 'ENTITIES', ...point(1, 2, 3.5), '0', 'ENDSEC', '0', 'EOF'].join('\n')));
  assert.equal(none.marks[0].z, 3500);
});

test('DXF: подпись рядом с точкой — её отметка, отдельная подпись — сама точка', () => {
  const parsed = parseDxf(dxf([
    ...point(10, 20, 0), ...text(10.3, 20.2, 0.5, '123,45'), // рядом с точкой без Z
    ...text(50, 50, 0.5, '124.10'), // одна, без точки
    ...text(80, 80, 0.5, 'Дом'), // не число
    ...text(90, 90, 0.5, '12.5 м'), // посторонняя (далеко от медианы) — отсеивается
    ...text(91, 90, 0.5, '125.00'),
  ]));
  const m = extractDxfElevations(parsed);
  assert.equal(m.counts.points, 1);
  assert.deepEqual(m.marks.find((p) => p.x === 10), { x: 10, y: 20, z: 123450 });
  assert.ok(m.marks.some((p) => p.x === 50 && p.z === 124100));
  assert.ok(!m.marks.some((p) => p.z === 12500));
  assert.equal(m.marks.length, 3);
});

test('DXF: вершины 3DFACE и горизонтали с отметкой; INSERT переносит Z', () => {
  const face = ['0', '3DFACE', '8', '0', '10', '0', '20', '0', '30', '100', '11', '10', '21', '0', '31', '101', '12', '10', '22', '10', '32', '102', '13', '0', '23', '10', '33', '103'];
  const lw = ['0', 'LWPOLYLINE', '8', '0', '90', '2', '38', '99.5', '10', '20', '20', '0', '10', '30', '20', '0'];
  const m = extractDxfElevations(parseDxf(dxf([...face, ...lw])));
  assert.equal(m.counts.vertices, 6);
  assert.ok(m.marks.some((p) => p.x === 10 && p.y === 10 && p.z === 102000));
  assert.ok(m.marks.some((p) => p.x === 30 && p.z === 99500));
  const blocks = [
    '0', 'SECTION', '2', 'HEADER', '9', '$INSUNITS', '70', '6', '0', 'ENDSEC',
    '0', 'SECTION', '2', 'BLOCKS', '0', 'BLOCK', '2', 'PT', '10', '0', '20', '0', ...point(0, 0, 1), '0', 'ENDBLK', '0', 'ENDSEC',
    '0', 'SECTION', '2', 'ENTITIES', '0', 'INSERT', '2', 'PT', '10', '5', '20', '6', '30', '120', '0', 'ENDSEC', '0', 'EOF',
  ].join('\n');
  const b = extractDxfElevations(parseDxf(blocks));
  assert.deepEqual(b.marks, [{ x: 5, y: 6, z: 121000 }]);
});

test('отметки подложки: пиксели ↔ координаты съёмки (масштаб, поворот)', () => {
  const tf = { bx: 0, by: 0, k: 10, H: 1000 }; // 1 ед. = 10 px, Y вверх
  const px = dxfMarksToPx([{ x: 10, y: 20, z: 5 }], tf);
  assert.deepEqual(px, [{ px: 100, py: 800, z: 5 }]);
  const u = { x: 0, y: 0, widthPx: 1000, heightPx: 1000, mmPerPx: 100, rot: 0, marks: px };
  assert.deepEqual(underlayMarksToWorld(u), [{ x: 10000, y: 80000, z: 5 }]);
  const turned = underlayMarksToWorld({ ...u, rot: 90 })[0];
  // Поворот на 90° вокруг центра (50 м; 50 м): (−40; +30) → (−30; −40).
  assert.ok(Math.abs(turned.x - 20000) < 1e-6 && Math.abs(turned.y - 10000) < 1e-6);
});

// --- Модель и экспорт ---

test('нормализация: битые точки и настройки, старый файл без рельефа', () => {
  const t = normalizeTerrain({
    points: [{ id: 'a', x: 1, y: 2, z: 3 }, { id: 'a', x: 4, y: 5, z: '6,5' }, { x: 'x', y: 1, z: 1 }, null, { x: 1, y: 1 }],
    contourStep: -5, floorZ: 'abc', show: { points: false, contours: 'да' },
  });
  assert.equal(t.points.length, 2);
  assert.notEqual(t.points[0].id, t.points[1].id);
  assert.equal(t.points[1].z, 6.5);
  assert.equal(t.contourStep, 500);
  assert.equal(t.floorZ, null);
  assert.deepEqual(t.show, { points: false, contours: true, labels: true, shade: false });
  assert.equal(normalizeTerrain(null), null);
  assert.equal(normalizeTerrain('мусор'), null);
  const old = createProject();
  delete old.site.terrain;
  assert.equal(deserializeProject(serializeProject(old)).site.terrain, null);
});

test('экспорт: JSON site.terrain, DXF генплана — POINT с Z и слой горизонталей', () => {
  const project = createProject();
  project.levels[0].rooms.push(createRoom('living', 0, 0, 6000, 6000));
  project.site.terrain = normalizeTerrain({ points: grid(4, 5000), contourStep: 250 });
  const back = deserializeProject(serializeProject(project));
  assert.equal(back.site.terrain.points.length, 16);
  assert.equal(back.site.terrain.contourStep, 250);
  const json = buildStructuredExport(project);
  assert.equal(json.site.terrain.points.length, 16);
  assert.equal(json.site.terrain.contour_step, 250);
  assert.ok(json.site.terrain.house.corners.length === 4);
  const out = buildSitePlanDxf(project);
  assert.ok(out.includes('\ncontours\n') && out.includes('\nterrain_points\n'));
  const lines = out.split('\n');
  const i = lines.indexOf('POINT');
  assert.ok(i > 0);
  assert.equal(lines[i + 2], 'terrain_points');
  assert.equal(Number(lines[i + 8]), 100000); // Z первой точки, мм
  // Обратное чтение: те же отметки (DXF — мм, $INSUNITS = 4).
  const marks = extractDxfElevations(parseDxf(out)).marks;
  assert.ok(marks.filter((m) => m.z === 100000).length >= 1);
});
