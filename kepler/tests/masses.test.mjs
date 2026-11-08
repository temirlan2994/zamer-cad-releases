// Массы (core/masses.js): создание, нормализация, «тяни-толкай» граней,
// постановка на массу, сечение этажа и объединённый контур эскиза,
// привязка прямоугольника к рёбрам эскиза, сохранение v7/v6; луч × плоскость
// и выбор массы (core/pick3d.js); грани 3D (core/mesh3d.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MASS_MIN, copyMass, createMass, faceOf, faceSize, floorsLabel, isSupported, levelMasses, massBox, massExtent,
  massFromCorners, massRect, massSketch, massStats, massStep, normalizeMass, normalizeMasses, resizeFace,
  rotateMass90, sectionRects, setFaceSize, sketchLines, snapRectToSketch, snapValue, stackMass, supportAt,
  unionOutline,
} from '../core/masses.js';
import {
  createLevel, createProject, deserializeProject, fileDataV6, serializeProject,
} from '../core/model.js';
import { buildHouseMesh, massFaces } from '../core/mesh3d.js';
import { basePlane, pickMass, rayPlaneZ, screenRay } from '../core/pick3d.js';
import { buildStructuredExport } from '../core/export.js';
import { area } from '../core/geom/poly.js';

test('создание: имя, размеры, ограничения, центр основания', () => {
  const a = createMass({ x: 1000, y: 2000, w: 6000, d: 4000, h: 3000 });
  assert.equal(a.name, 'Масса 1');
  assert.deepEqual(massBox(a), { x0: -2000, y0: 0, x1: 4000, y1: 4000, z0: 0, z1: 3000 });
  const b = createMass({ w: 10, d: 5000, h: -5, z0: -300 }, [a]);
  assert.equal(b.name, 'Масса 2');
  assert.equal(b.w, MASS_MIN);
  assert.equal(b.h, MASS_MIN);
  assert.equal(b.z0, 0);
  const c = massFromCorners({ x: 5000, y: 3000 }, { x: 0, y: 0 }, 6000, 3000, [a, b]);
  assert.deepEqual([c.x, c.y, c.w, c.d, c.z0, c.h, c.name], [2500, 1500, 5000, 3000, 6000, 3000, 'Масса 3']);
});

test('нормализация: битые отброшены, числа-строки, дубли id, поворот кратно 90', () => {
  assert.equal(normalizeMass(null), null);
  assert.equal(normalizeMass({ x: 0, y: 0, w: 0, d: 1, h: 1 }), null);
  const m = normalizeMass({ id: 'm1', x: '10', y: 20, w: '3000', d: 2000, h: 2500, rotation: 95, z0: '-5', name: '  ' });
  assert.deepEqual([m.x, m.w, m.rotation, m.z0, m.name], [10, 3000, 90, 0, 'Масса']);
  const list = normalizeMasses([{ id: 'a', x: 0, y: 0, w: 1000, d: 1000, h: 1000 }, 'мусор', { id: 'a', x: 0, y: 0, w: 1000, d: 1000, h: 1000 }]);
  assert.equal(list.length, 2);
  assert.notEqual(list[0].id, list[1].id);
  assert.deepEqual(normalizeMasses('x'), []);
});

test('поворот 90°: основание меняет оси, центр на месте', () => {
  const m = createMass({ x: 0, y: 0, w: 6000, d: 2000 });
  const r = rotateMass90(m);
  assert.equal(r.rotation, 90);
  assert.deepEqual(massExtent(r), { ex: 2000, ey: 6000 });
  assert.deepEqual(massRect(r), { x: -1000, y: -3000, w: 2000, h: 6000 });
  // Тяни-толкай у повёрнутой: грань +x меняет d (вдоль x дома).
  const r2 = resizeFace(r, 'px', 1000);
  assert.deepEqual([r2.w, r2.d], [6000, 3000]);
  assert.equal(massBox(r2).x0, -1000);
});

test('тяни-толкай: противоположная грань стоит, минимум, верх и низ', () => {
  const m = createMass({ x: 3000, y: 2000, w: 6000, d: 4000, h: 3000 });
  const a = resizeFace(m, 'px', 1000);
  assert.deepEqual([massBox(a).x0, massBox(a).x1], [0, 7000]);
  const b = resizeFace(m, 'nx', 500);
  assert.deepEqual([massBox(b).x0, massBox(b).x1], [-500, 6000]);
  const c = resizeFace(m, 'ny', -10000);
  assert.equal(massBox(c).y1 - massBox(c).y0, MASS_MIN);
  assert.equal(massBox(c).y1, 4000);
  const d = resizeFace(m, 'top', 1500);
  assert.deepEqual([d.z0, d.h], [0, 4500]);
  const e = resizeFace({ ...m, z0: 3000 }, 'bottom', 1000);
  assert.deepEqual([e.z0, e.h], [2000, 4000]);
  assert.equal(faceSize(m, 'py'), 4000);
  const f = setFaceSize(m, 'nx', 8000);
  assert.deepEqual([massBox(f).x0, massBox(f).x1], [-2000, 6000]);
  assert.equal(setFaceSize(m, 'top', 'abc'), null);
  assert.equal(faceOf('z', 1), 'top');
  assert.equal(faceOf('y', -1), 'ny');
});

test('постановка на массу: на верх перекрывающей, иначе на землю; опора', () => {
  const base = createMass({ x: 0, y: 0, w: 8000, d: 6000, h: 6000 });
  const top = stackMass(createMass({ x: 1000, y: 0, w: 3000, d: 3000, h: 3000 }), [base]);
  assert.equal(top.z0, 6000);
  assert.ok(isSupported(top, [base, top]));
  const aside = stackMass(createMass({ x: 9000, y: 0, w: 2000, d: 2000 }), [base]);
  assert.equal(aside.z0, 0, 'вплотную, без перекрытия — на земле');
  assert.equal(supportAt([base], { x: 0, y: 0 }), 6000);
  assert.equal(supportAt([base], { x: 50000, y: 0 }), 0);
  assert.ok(!isSupported({ ...top, z0: 7000 }, [base]));
});

test('сечение и массы этажа', () => {
  const p = createProject('m');
  p.levels.push(createLevel('2 этаж', 3000, 3000, 'L2'));
  const a = createMass({ x: 0, y: 0, w: 6000, d: 6000, h: 6000 });
  const b = createMass({ x: 0, y: 0, w: 2000, d: 2000, z0: 6000, h: 3000 });
  assert.deepEqual(sectionRects([a, b], 1000).map((r) => r.id), [a.id]);
  assert.deepEqual(sectionRects([a, b], 6000).map((r) => r.id), [b.id]);
  assert.deepEqual(levelMasses([a, b], p.levels[0]).map((m) => m.id), [a.id]);
  assert.deepEqual(levelMasses([a, b], { elevation: 6000, height: 3000 }).map((m) => m.id), [b.id]);
  assert.equal(levelMasses([a, b], { elevation: 9000, height: 3000 }).length, 0);
});

test('объединённый контур: Г-форма из двух боксов и перекрывающиеся боксы', () => {
  const a = createMass({ x: 4000, y: 2500, w: 8000, d: 5000 });
  const b = createMass({ x: 2000, y: 8500, w: 4000, d: 7000 });
  const s = massSketch([a, b], { elevation: 0, height: 3000 });
  assert.equal(s.rects.length, 2);
  assert.equal(s.outline.length, 1, 'один контур');
  assert.equal(s.outline[0].length, 1, 'без дыр');
  assert.equal(s.outline[0][0].length, 6, 'Г-форма — 6 вершин');
  assert.equal(area(s.outline), 8000 * 5000 + 4000 * 7000);
  const lines = sketchLines(s);
  assert.equal(lines.xs.length + lines.ys.length, 6);
  // Перекрытие: площадь объединения без двойного счёта.
  const o = unionOutline([{ x0: 0, y0: 0, x1: 4000, y1: 4000 }, { x0: 2000, y0: 2000, x1: 6000, y1: 6000 }]);
  assert.equal(o.length, 1);
  assert.equal(area(o), 16e6 * 2 - 4e6);
  // Раздельные — два контура.
  assert.equal(unionOutline([{ x0: 0, y0: 0, x1: 1000, y1: 1000 }, { x0: 5000, y0: 0, x1: 6000, y1: 1000 }]).length, 2);
});

test('привязка прямоугольника к рёбрам эскиза: на ребро или внутрь на толщину стены', () => {
  const s = massSketch([createMass({ x: 5000, y: 5000, w: 10000, d: 10000 })], { elevation: 0, height: 3000 });
  const lines = sketchLines(s);
  const r = snapRectToSketch({ x: 120, y: 3000, w: 4000, h: 3000 }, lines, { distance: 300 });
  assert.equal(r.x, 0);
  assert.ok(r.snappedX && !r.snappedY);
  assert.equal(r.guides[0].axis, 'v');
  const inset = snapRectToSketch({ x: 380, y: 3000, w: 4000, h: 3000 }, lines, { distance: 300, inset: 400 });
  assert.equal(inset.x, 400, 'грань комнаты внутри контура на толщину наружной стены');
  const far = snapRectToSketch({ x: 2000, y: 3000, w: 4000, h: 3000 }, lines, { distance: 300 });
  assert.ok(!far.snappedX);
  // Растяжение: двигается только грань e.
  const e = snapRectToSketch({ x: 3000, y: 3000, w: 6800, h: 3000 }, lines, { distance: 300, edges: ['e'] });
  assert.deepEqual([e.x, e.w], [3000, 7000]);
});

test('привязка значения и шаг по масштабу; сводка; подпись этажей; копия', () => {
  assert.deepEqual(snapValue(1040, [1000, 2000], 50, 100), { value: 1000, line: 1000 });
  assert.deepEqual(snapValue(1140, [1000], 50, 100), { value: 1100, line: null });
  assert.equal(massStep(0.2), 50);
  assert.equal(massStep(0.04), 250);
  assert.equal(massStep(0.001), 1000);
  const m = createMass({ w: 10000, d: 8000, h: 6000 });
  const st = massStats(m, 3000);
  assert.deepEqual([st.area, st.volume, st.floors], [80, 480, 2]);
  assert.equal(floorsLabel(3000, 3000), '≈ 1 этаж');
  assert.equal(floorsLabel(6200, 3000), '≈ 2 этажа');
  assert.equal(floorsLabel(15000, 3000), '≈ 5 этажей');
  const c = copyMass(m, [m]);
  assert.notEqual(c.id, m.id);
  assert.equal(c.name, 'Масса 2');
  assert.equal(c.x, m.x + 11000);
});

test('чистота: функции не меняют вход', () => {
  const m = createMass({ x: 0, y: 0, w: 4000, d: 4000 });
  const snap = JSON.stringify(m);
  resizeFace(m, 'px', 100); rotateMass90(m); stackMass(m, [m]); setFaceSize(m, 'top', 5000); copyMass(m, [m]);
  massSketch([m], { elevation: 0, height: 3000 });
  assert.equal(JSON.stringify(m), snap);
});

test('сохранение: kepler-plan/7 и v6 хранят массы, старый проект без поля открывается', () => {
  const p = createProject('m');
  p.masses = [createMass({ x: 1000, y: 2000, w: 6000, d: 4000, h: 3000, rotation: 90 })];
  const text = serializeProject(p);
  assert.equal(JSON.parse(text).schema, 'kepler-plan/7');
  const back = deserializeProject(text);
  assert.deepEqual(back.masses, p.masses);
  const v6 = deserializeProject(JSON.stringify(fileDataV6(p)));
  assert.deepEqual(v6.masses, p.masses);
  const old = deserializeProject(serializeProject(createProject('old')));
  assert.equal(old.masses, undefined, 'пустой список не хранится');
  const broken = deserializeProject(JSON.stringify({ ...JSON.parse(text), masses: [{ x: 'a' }, 5] }));
  assert.equal(broken.masses, undefined);
  // Экспорт JSON: необязательное поле masses.
  assert.equal(buildStructuredExport(p).masses.length, 1);
  assert.equal(buildStructuredExport(createProject('x')).masses, undefined);
});

test('3D: грани масс только с опцией masses; 6 граней, полупрозрачные', () => {
  const p = createProject('m');
  p.masses = [createMass({ w: 4000, d: 4000, h: 3000 })];
  assert.equal(buildHouseMesh(p).filter((f) => f.kind === 'mass').length, 0);
  const faces = buildHouseMesh(p, { masses: true }).filter((f) => f.kind === 'mass');
  assert.equal(faces.length, 6);
  assert.ok(faces.every((f) => f.alpha < 1 && f.massId === p.masses[0].id));
  assert.deepEqual(massFaces(p.masses).map((f) => f.face).sort(), ['bottom', 'nx', 'ny', 'px', 'py', 'top']);
  const top = faces.find((f) => f.face === 'top');
  assert.ok(top.pts.every((q) => q.z === 3000), 'верх — над землёй');
});

test('луч × плоскость и выбор массы, «поставить на грань»', () => {
  const ray = { o: { x: 0, y: 0, z: 10000 }, d: { x: 0, y: 0, z: -1 } };
  assert.deepEqual(rayPlaneZ(ray, 0), { x: 0, y: 0, z: 0, t: 10000 });
  assert.equal(rayPlaneZ({ o: ray.o, d: { x: 1, y: 0, z: 0 } }, 0), null);
  assert.equal(rayPlaneZ(ray, 20000), null, 'плоскость позади');
  const m = createMass({ x: 0, y: 0, w: 4000, d: 4000, h: 6000 });
  const boxes = [{ id: m.id, ...massBox(m) }];
  const hit = pickMass(boxes, ray);
  assert.equal(hit.face, 'top');
  assert.equal(hit.point.z, 6000);
  const side = pickMass(boxes, { o: { x: 10000, y: 0, z: 1000 }, d: { x: -1, y: 0, z: 0 } });
  assert.equal(side.face, 'px');
  assert.deepEqual(basePlane(boxes, ray).z, 6000);
  assert.equal(basePlane(boxes, ray).massId, m.id);
  const miss = { o: { x: 9000, y: 0, z: 10000 }, d: { x: 0, y: 0, z: -1 } };
  assert.deepEqual(basePlane(boxes, miss), { z: 0, point: { x: 9000, y: 0, z: 0, t: 10000 }, massId: null });
  // Настоящий луч камеры сверху-сбоку: попадает в верх массы.
  const cam = { yaw: -2.2, pitch: 0.62, dist: 25000, eyeDist: 50000, target: { x: 0, y: 0, z: 1500 } };
  const r = screenRay(cam, 800, 600, 400, 300);
  const plane = basePlane(boxes, r);
  assert.ok(plane && (plane.z === 6000 || plane.z === 0));
});

test('стены: вершины эскиза — точки привязки инструмента «Стена»', async () => {
  const { snapWallPoint } = await import('../core/wall-manual.js');
  const s = massSketch([createMass({ x: 5000, y: 5000, w: 10000, d: 10000 })], { elevation: 0, height: 3000 });
  const r = snapWallPoint({ p: { x: 9930, y: 4321 }, points: s.points, tol: 100, grid: 50 });
  assert.deepEqual(r.point, { x: 10000, y: 4300 });
  assert.equal(r.snapX, 10000);
});
