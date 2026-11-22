// Ландшафт, этап 2 (core): линейные и площадные объекты, вершины,
// сглаживание, помощники, шаблоны сада, баланс территории и ведомость.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  cloneLandscapeObject, createLandscapeObject, hitEdge, hitLandscape, hitVertex, insertVertex, moveVertex,
  normalizeLandscape, objectAreaM2, objectLengthM, objectOutline, objectPath, pointInObject, removeVertex,
  rotateObjectAbout, smoothPath, steppingSlabs, translateObject,
} from '../core/landscape.js';
import {
  composeGarden, entryPathObject, exteriorDoors, fillArea, parkingAtEntry, plantAlong,
} from '../core/landscape-tools.js';
import { balanceRows, buildLandscapeCsv, landscapeBalance, landscapeSchedule } from '../core/landscape-report.js';
import { LANDSCAPE_NORMS } from '../core/norms.js';
import { tepReport, tepRows } from '../core/tep.js';
import { createProject, deserializeProject, serializeProject } from '../core/model.js';
import { buildStructuredExport } from '../core/export.js';
import { pointInPolygon } from '../core/zamer/geometry.js';
import { buildSample } from '../ui/sample.js';

const near = (a, b, tol = 1) => Math.abs(a - b) <= tol;
const L = [{ x: 0, y: 0 }, { x: 5000, y: 0 }, { x: 5000, y: 4000 }];
const RECT = [{ x: 0, y: 0 }, { x: 4000, y: 0 }, { x: 4000, y: 3000 }, { x: 0, y: 3000 }];

test('дорожка по точкам: габарит с полушириной, длина, площадь, попадание по оси', () => {
  const p = createLandscapeObject('path', 0, 0, { points: L, width: 1000, variant: 'pavers' });
  assert.equal(p.rotation, 0);
  assert.deepEqual([p.x, p.y, p.w, p.h], [2500, 2000, 6000, 5000]);
  assert.ok(near(objectLengthM(p), 9, 1e-9));
  assert.ok(near(objectAreaM2(p), 9, 1e-9));
  assert.ok(pointInObject(p, { x: 2500, y: 400 }));
  assert.ok(!pointInObject(p, { x: 2500, y: 600 }));
  assert.ok(pointInObject(p, { x: 4600, y: 2000 }));
  // Контур полосы — замкнутый многоугольник вокруг оси.
  const out = objectOutline(p);
  assert.equal(out.length, 6);
  assert.ok(pointInPolygon({ x: 2500, y: 300 }, out));
  assert.ok(!pointInPolygon({ x: 2500, y: 700 }, out));
  // Ширина в пределах.
  assert.equal(createLandscapeObject('path', 0, 0, { points: L, width: 1 }).width, 50);
});

test('контур: площадь и периметр, попадание, сверху — линии над площадями', () => {
  const lawn = createLandscapeObject('lawn-area', 0, 0, { points: RECT });
  assert.deepEqual([lawn.x, lawn.y, lawn.w, lawn.h], [2000, 1500, 4000, 3000]);
  assert.ok(near(objectAreaM2(lawn), 12, 1e-9));
  assert.ok(near(objectLengthM(lawn), 14, 1e-9));
  assert.ok(pointInObject(lawn, { x: 100, y: 100 }));
  assert.ok(!pointInObject(lawn, { x: -100, y: 100 }));
  assert.ok(pointInObject(lawn, { x: -100, y: 100 }, 150), 'с допуском — у кромки');
  const path = createLandscapeObject('path', 0, 0, { points: [{ x: -1000, y: 1500 }, { x: 5000, y: 1500 }] });
  assert.equal(hitLandscape([path, lawn], { x: 2000, y: 1500 }).id, path.id, 'дорожка поверх газона');
  const tree = createLandscapeObject('tree-pine', 2000, 1500);
  assert.equal(hitLandscape([tree, path, lawn], { x: 2000, y: 1500 }).id, tree.id, 'крона поверх всего');
});

test('сглаживание: кривая проходит через вершины, выборка плотнее', () => {
  const pts = smoothPath(L, false);
  assert.ok(pts.length > 10);
  for (const v of L) assert.ok(pts.some((p) => near(p.x, v.x, 1e-6) && near(p.y, v.y, 1e-6)), 'через вершину');
  const s = createLandscapeObject('path', 0, 0, { points: L, smooth: true });
  assert.ok(objectPath(s).length > 3);
  assert.ok(Math.abs(objectLengthM(s) - 9) > 0.05 && objectLengthM(s) < 11, 'длина — по кривой, а не по ломаной');
  // Замкнутый контур сглаживается без «шва».
  const pond = createLandscapeObject('pond-area', 0, 0, { points: RECT, smooth: true });
  const path = objectPath(pond);
  assert.ok(path.length > 8);
  assert.ok(objectAreaM2(pond) > 12 && objectAreaM2(pond) < 18, "кривая через вершины — чуть больше ломаной");
});

test('плиты-ступени: шаг вдоль оси, детерминированно, площадь — сумма плит', () => {
  const p = createLandscapeObject('path', 0, 0, { id: 'ls-step', points: [{ x: 0, y: 0 }, { x: 10000, y: 0 }], width: 1000, variant: 'stepping' });
  const a = steppingSlabs(p);
  const b = steppingSlabs({ ...p });
  assert.deepEqual(a, b);
  assert.ok(a.length >= 12 && a.length <= 16, String(a.length));
  for (let i = 1; i < a.length; i += 1) assert.ok(a[i].x > a[i - 1].x + a[i].along, 'между плитами шов-газон');
  const sum = a.reduce((s, x) => s + x.along * x.across, 0) / 1e6;
  assert.ok(near(objectAreaM2(p), sum, 1e-9));
  assert.ok(objectAreaM2(p) < 10, 'меньше сплошной дорожки');
});

test('вершины: перемещение, вставка, удаление с минимумом, попадание по вершине и ребру', () => {
  const lawn = createLandscapeObject('lawn-area', 0, 0, { points: RECT });
  assert.equal(hitVertex(lawn, { x: 3950, y: 40 }, 100), 1);
  assert.equal(hitVertex(lawn, { x: 2000, y: 1500 }, 100), -1);
  assert.equal(hitEdge(lawn, { x: 2000, y: 3050 }, 100), 2);
  insertVertex(lawn, 2, { x: 2000, y: 4000 });
  assert.equal(lawn.points.length, 5);
  assert.equal(lawn.h, 4000, 'габарит пересчитан');
  moveVertex(lawn, 3, { x: 2000, y: 5000 });
  assert.equal(lawn.h, 5000);
  assert.ok(removeVertex(lawn, 3));
  assert.ok(removeVertex(lawn, 0));
  assert.equal(lawn.points.length, 3);
  assert.equal(removeVertex(lawn, 0), false, 'у контура минимум 3 вершины');
  const line = createLandscapeObject('fence-line', 0, 0, { points: [{ x: 0, y: 0 }, { x: 1000, y: 0 }] });
  assert.equal(removeVertex(line, 0), false, 'у линии минимум 2');
});

test('сдвиг, поворот и копия фигур — вместе с вершинами', () => {
  const p = createLandscapeObject('path', 0, 0, { points: L, width: 800 });
  translateObject(p, 1000, -500);
  assert.deepEqual(p.points[0], { x: 1000, y: -500 });
  rotateObjectAbout(p, 1000, -500, 90);
  assert.deepEqual(p.points[1], { x: 1000, y: 4500 });
  assert.equal(p.rotation, 0);
  const c = cloneLandscapeObject({ ...p, locked: true }, 100, 100);
  assert.notEqual(c.id, p.id);
  assert.equal(c.locked, undefined, 'копия без замка');
  assert.deepEqual(c.points[0], { x: 1100, y: -400 });
  assert.equal(p.points[0].x, 1000, 'оригинал не тронут');
  const tree = createLandscapeObject('tree-oak', 1000, 0);
  rotateObjectAbout(tree, 0, 0, 90);
  assert.deepEqual([tree.x, tree.y, tree.rotation], [0, 1000, 90]);
});

test('хранение: точки, ширина, сглаживание, цвет и замок переживают сохранение', () => {
  const pr = createProject();
  pr.site.landscape.objects.push(
    createLandscapeObject('path', 0, 0, { points: L, width: 1200, smooth: true, variant: 'deck', color: '#aa7744', locked: true }),
    createLandscapeObject('pool-area', 0, 0, { points: RECT, variant: 'dark' }),
  );
  const again = deserializeProject(serializeProject(pr));
  assert.deepEqual(again.site.landscape, pr.site.landscape);
  const [path] = again.site.landscape.objects;
  assert.equal(path.width, 1200);
  assert.equal(path.smooth, true);
  assert.equal(path.locked, true);
  // Битые фигуры (мало точек) — отброшены.
  const n = normalizeLandscape({ objects: [{ kind: 'path', x: 0, y: 0, points: [{ x: 0, y: 0 }] }, { kind: 'lawn-area', x: 0, y: 0, points: L.slice(0, 2) }] });
  assert.equal(n.objects.length, 0);
  // JSON-экспорт — с вершинами, шириной, длиной и площадью.
  const ex = buildStructuredExport(pr).site.landscape.objects;
  assert.equal(ex[0].shape, 'line');
  assert.equal(ex[0].width, 1200);
  assert.ok(ex[0].length_m > 0 && ex[0].area_m2 > 0);
  assert.equal(ex[1].points.length, 4);
  assert.ok(near(ex[1].area_m2, 12, 0.01));
});

test('посадить вдоль: шаг, стороны, отступ внутрь замкнутого контура', () => {
  const line = [{ x: 0, y: 0 }, { x: 10000, y: 0 }];
  const one = plantAlong(line, { kind: 'shrub-box', step: 2000, offset: 1000, sides: 'left' });
  assert.equal(one.length, 6);
  assert.ok(one.every((o) => o.y === 1000 && o.kind === 'shrub-box'));
  const both = plantAlong(line, { kind: 'shrub-box', step: 2000, offset: 1000, sides: 'both' });
  assert.equal(both.length, 12);
  assert.ok(both.some((o) => o.y === -1000));
  const square = [{ x: 0, y: 0 }, { x: 20000, y: 0 }, { x: 20000, y: 20000 }, { x: 0, y: 20000 }];
  const ring = plantAlong(square, { kind: 'tree-thuja', step: 4000, offset: 1000, closed: true, inside: true });
  assert.equal(ring.length, 20);
  assert.ok(ring.every((o) => pointInPolygon(o, square)), 'отступ — внутрь участка');
  assert.deepEqual(plantAlong(line, { kind: 'нет' }), []);
});

test('заполнить область: внутри, без наложения крон, детерминированно, обходит дом', () => {
  const square = [{ x: 0, y: 0 }, { x: 30000, y: 0 }, { x: 30000, y: 30000 }, { x: 0, y: 30000 }];
  const house = [{ x: 10000, y: 10000 }, { x: 20000, y: 10000 }, { x: 20000, y: 20000 }, { x: 10000, y: 20000 }];
  const a = fillArea(square, { kind: 'tree-birch', density: 0.6, seed: 's', avoid: [house] });
  const b = fillArea(square, { kind: 'tree-birch', density: 0.6, seed: 's', avoid: [house] });
  assert.deepEqual(a.map((o) => [o.x, o.y]), b.map((o) => [o.x, o.y]));
  assert.ok(a.length >= 8, String(a.length));
  for (const o of a) assert.ok(pointInPolygon(o, square) && !pointInPolygon(o, house));
  for (let i = 0; i < a.length; i += 1) {
    for (let j = i + 1; j < a.length; j += 1) assert.ok(Math.hypot(a[i].x - a[j].x, a[i].y - a[j].y) >= a[i].w * 0.94, 'кроны не наезжают');
  }
  const dense = fillArea(square, { kind: 'tree-birch', density: 1, seed: 's' });
  const sparse = fillArea(square, { kind: 'tree-birch', density: 0.1, seed: 's' });
  assert.ok(dense.length > sparse.length);
});

test('пример: наружная дверь, дорожка от въезда до входа в обход дома, парковка у въезда', () => {
  const { project } = buildSample();
  const doors = exteriorDoors(project);
  assert.ok(doors.length >= 1);
  const { obj, door } = entryPathObject(project, { variant: 'pavers' });
  assert.equal(obj.kind, 'path');
  assert.deepEqual(obj.points[0], { x: project.site.entry.x, y: project.site.entry.y });
  const last = obj.points[obj.points.length - 1];
  assert.ok(Math.hypot(last.x - door.x, last.y - door.y) < 2);
  // Ортогональная: все отрезки — по осям.
  for (let i = 1; i < obj.points.length; i += 1) {
    const a = obj.points[i - 1]; const b = obj.points[i];
    assert.ok(a.x === b.x || a.y === b.y, 'ортогональный отрезок');
  }
  const curved = entryPathObject(project, { curved: true, variant: 'deck' }).obj;
  assert.equal(curved.smooth, true);
  assert.equal(entryPathObject(createProject(), {}).error.includes('въезд'), true);
  const spaces = parkingAtEntry(project, 3);
  assert.equal(spaces.length, 3);
  assert.ok(spaces.every((o) => o.kind === 'parking-1'));
  for (const o of spaces) for (const p of objectOutline(o)) assert.ok(pointInPolygon(p, project.site.boundary), 'на участке');
});

test('шаблоны сада: три композиции внутри участка, детерминированно', () => {
  const { project } = buildSample();
  for (const id of ['japanese', 'pine', 'family']) {
    const res = composeGarden(project, id);
    assert.ok(!res.error, id);
    assert.ok(res.objects.length >= 8, `${id}: ${res.objects.length}`);
    for (const o of res.objects) {
      assert.ok(pointInPolygon({ x: o.x, y: o.y }, project.site.boundary) || o.kind === 'path', `${id}: ${o.kind} внутри`);
    }
    const again = composeGarden(project, id);
    assert.deepEqual(again.objects.map((o) => [o.kind, o.x, o.y]), res.objects.map((o) => [o.kind, o.x, o.y]));
    const kinds = new Set(res.objects.map((o) => o.kind));
    if (id === 'japanese') for (const k of ['boulder', 'gravel-area', 'tree-bonsai', 'shrub-box', 'tree-thuja', 'path']) assert.ok(kinds.has(k), `${id}: ${k}`);
    if (id === 'pine') for (const k of ['tree-pine', 'firepit', 'path']) assert.ok(kinds.has(k), `${id}: ${k}`);
    if (id === 'family') for (const k of ['pool', 'terrace-deck', 'parking-1', 'lawn-area', 'playground', 'vegbeds']) assert.ok(kinds.has(k), `${id}: ${k}`);
  }
  assert.ok(composeGarden(createProject(), 'pine').error);
});

test('баланс территории: застройка + покрытия + вода + озеленение + остаток = 100 %', () => {
  const { project } = buildSample();
  const empty = landscapeBalance(project);
  assert.ok(near(empty.shares.green, 0, 1e-9));
  assert.ok(empty.shares.building > 0.1);
  project.site.landscape.objects.push(
    createLandscapeObject('lawn-area', 0, 0, { points: project.site.boundary }),
    createLandscapeObject('pool-area', 0, 0, { points: [{ x: 10000, y: -5000 }, { x: 14000, y: -5000 }, { x: 14000, y: -2000 }, { x: 10000, y: -2000 }] }),
    createLandscapeObject('paving-area', 0, 0, { points: [{ x: -4000, y: -5000 }, { x: 0, y: -5000 }, { x: 0, y: -3000 }, { x: -4000, y: -3000 }] }),
    createLandscapeObject('tree-oak', -2000, -4000), // крона над мощением — не озеленение
  );
  const b = landscapeBalance(project);
  const total = Object.values(b.shares).reduce((s, v) => s + v, 0);
  assert.ok(near(total, 1, 1e-9));
  assert.ok(near(b.m2.water, 12, 0.6), `вода ${b.m2.water}`);
  assert.ok(near(b.m2.hard, 8, 0.6), `покрытия ${b.m2.hard}`);
  assert.ok(near(b.shares.none, 0, 1e-9), 'газон по всему участку');
  assert.ok(near(b.m2.green + b.m2.hard + b.m2.water + b.m2.building, b.plot, 1e-6));
  assert.equal(b.minGreen, LANDSCAPE_NORMS.minGreenShare);
  assert.equal(b.greenOk, b.shares.green >= 0.4);
  const rows = balanceRows(b).map((r) => r[0]);
  assert.ok(rows.includes('Озеленение') && rows.includes('Не благоустроено') && rows.includes('Процент озеленения'));
  // В ТЭП — тот же блок.
  const tep = tepReport(project);
  assert.ok(tep.landscape);
  assert.ok(tepRows(tep).some(([k]) => k === 'Процент озеленения'));
  // Настраиваемый ориентир.
  project.settings.minGreenShare = 0.9;
  assert.equal(landscapeBalance(project).greenOk, false);
  assert.equal(landscapeBalance(createProject()), null);
});

test('ведомость: позиции с количеством, CSV для Excel', () => {
  const objs = [
    createLandscapeObject('tree-pine', 0, 0), createLandscapeObject('tree-pine', 9000, 0),
    createLandscapeObject('tree-pine', 0, 9000, { w: 3000 }),
    createLandscapeObject('path', 0, 0, { points: L, width: 1000, variant: 'pavers' }),
    createLandscapeObject('bench', 0, 0),
  ];
  const rows = landscapeSchedule(objs);
  const pines = rows.filter((r) => r.kind === 'tree-pine');
  assert.equal(pines.length, 2, 'разные размеры — разные позиции');
  assert.equal(pines.reduce((s, r) => s + r.count, 0), 3);
  const path = rows.find((r) => r.kind === 'path');
  assert.ok(near(path.length, 9, 1e-9) && near(path.area, 9, 1e-9));
  assert.deepEqual(rows.map((r) => r.pos), rows.map((_, i) => i + 1));
  assert.equal(rows[0].cat, 'green', 'сначала озеленение');
  const pr = createProject();
  pr.site.landscape.objects.push(...objs);
  const csv = buildLandscapeCsv(pr);
  assert.ok(csv.startsWith('﻿Поз.;'));
  // Первый блок — ведомость; за пустой строкой — ведомость растений.
  assert.equal(csv.trim().split('\r\n\r\n')[0].split('\r\n').length, rows.length + 1);
  assert.match(csv, /Ведомость растений/);
  assert.match(csv, /Дорожка;Брусчатка;1;шт;;9,00;9,00/);
});

test('DXF генплана: слои LANDSCAPE_* — кроны окружностями, дорожки и площадки контурами', async () => {
  const { buildSitePlanDxf } = await import('../core/export.js');
  const { project } = buildSample();
  project.site.landscape.objects.push(
    createLandscapeObject('tree-pine', 12000, -3000),
    createLandscapeObject('path', 0, 0, { points: [{ x: 5000, y: 12000 }, { x: 5000, y: 8000 }], variant: 'pavers' }),
    createLandscapeObject('path', 0, 0, { points: [{ x: -4000, y: 11000 }, { x: -4000, y: 6000 }], variant: 'stepping' }),
    createLandscapeObject('lawn-area', 0, 0, { points: RECT }),
    createLandscapeObject('bench', 10000, 10000),
  );
  const dxf = buildSitePlanDxf(project);
  for (const name of ['LANDSCAPE_TREES', 'LANDSCAPE_PATHS', 'LANDSCAPE_AREAS', 'LANDSCAPE_FURNITURE']) {
    assert.ok(dxf.includes(`\n${name}\n`), name);
  }
  const lines = dxf.split('\n');
  const count = (type, layer) => lines.filter((l, i) => l === type && lines.slice(i, i + 12).includes(layer)).length;
  assert.equal(count('CIRCLE', 'LANDSCAPE_TREES'), 2, 'крона + ствол');
  assert.ok(count('LINE', 'LANDSCAPE_PATHS') >= 4 + 4 * 6, 'полоса + плиты');
  assert.equal(count('LINE', 'LANDSCAPE_AREAS'), 4);
  assert.equal(count('LINE', 'LANDSCAPE_FURNITURE'), 4);
});
