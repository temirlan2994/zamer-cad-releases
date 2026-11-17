import test from 'node:test';
import assert from 'node:assert/strict';

import { buildStructuredExport } from '../core/export.js';
import { pointInPolygon } from '../core/geom/poly.js';
import { buildHouseMesh } from '../core/mesh3d.js';
import {
  createItem, createLevel, createProject, createRoom, deserializeProject, levelProject, serializeProject,
} from '../core/model.js';
import { roomNetAreaM2 } from '../core/rooms.js';
import {
  createSlabOpening, resetSlabOpeningAuto, setSlabOpeningPolygon, slabOpeningArea,
  slabOpeningCutRects, slabOpeningPolygon, slabOpenings,
} from '../core/slab-openings.js';

const L_OUTLINE = [
  { x: 1000, y: 1000 }, { x: 4000, y: 1000 },
  { x: 4000, y: 2000 }, { x: 2000, y: 2000 },
  { x: 2000, y: 4000 }, { x: 1000, y: 4000 },
];

const TRIANGLE = [
  { x: 1000, y: 1000 }, { x: 5000, y: 1000 }, { x: 1000, y: 5000 },
];

function twoStorey() {
  const project = createProject('Форма проёма');
  project.rooms.push(createRoom('living', 0, 0, 6000, 6000));
  const l2 = createLevel('2 этаж', 3000, 3000, 'L2');
  const hall = createRoom('hall', 0, 0, 6000, 6000);
  l2.rooms.push(hall);
  project.levels.push(l2);
  return { project, l2, hall };
}

function topAt(faces, kind, x, y, level = null) {
  const point = { x, y };
  return faces.some((face) => face.kind === kind && face.normal?.z > 0.5 &&
    (level == null || face.level === level) &&
    pointInPolygon(face.pts.map((p) => ({ x: p.x, y: p.y })), point, 0.01));
}

function assertOpeningCut(faces, levelId, point, message) {
  assert.equal(topAt(faces, 'slab', point.x, point.y), false, `${message}: перекрытие вырезано`);
  assert.equal(topAt(faces, 'floor', point.x, point.y, levelId), false, `${message}: пол вырезан`);
}

function assertOpeningSolid(faces, levelId, point, message) {
  assert.equal(topAt(faces, 'slab', point.x, point.y), true, `${message}: перекрытие осталось`);
  assert.equal(topAt(faces, 'floor', point.x, point.y, levelId), true, `${message}: пол остался`);
}

test('legacy-прямоугольник: JSON остаётся без outline, polygon и площадь выводятся из x/y/w/h', () => {
  const { project, l2 } = twoStorey();
  const legacy = { id: 'legacy-hole', x: 900, y: 1200, w: 2100, h: 1700 };
  l2.slabOpenings = [{ ...legacy }];

  const back = deserializeProject(serializeProject(project));
  const stored = back.levels.find((level) => level.id === l2.id).slabOpenings[0];
  assert.deepEqual(stored, legacy);
  assert.equal(Object.hasOwn(stored, 'outline'), false);
  assert.deepEqual(slabOpeningPolygon(stored), [
    { x: 900, y: 1200 }, { x: 3000, y: 1200 },
    { x: 3000, y: 2900 }, { x: 900, y: 2900 },
  ]);
  assert.equal(slabOpeningArea(stored), 3_570_000);
  assert.deepEqual(slabOpeningCutRects(stored), [{ x: 900, y: 1200, w: 2100, h: 1700 }]);

  const raw = JSON.parse(serializeProject(back));
  const rawStored = raw.levels.find((level) => level.id === l2.id).slabOpenings[0];
  assert.equal(Object.hasOwn(rawStored, 'outline'), false, 'старый прямоугольник не переписывается в новую форму');
});

test('Г-контур: локальный outline, площадь, сериализация и структурированный экспорт используют форму, а не bbox', () => {
  const { project, l2, hall } = twoStorey();
  const opening = createSlabOpening(project, l2.id, L_OUTLINE);

  assert.ok(opening);
  assert.deepEqual({ x: opening.x, y: opening.y, w: opening.w, h: opening.h },
    { x: 1000, y: 1000, w: 3000, h: 3000 });
  assert.deepEqual(opening.outline, [
    { x: 0, y: 0 }, { x: 3000, y: 0 }, { x: 3000, y: 1000 },
    { x: 1000, y: 1000 }, { x: 1000, y: 3000 }, { x: 0, y: 3000 },
  ]);
  assert.deepEqual(slabOpeningPolygon(opening), L_OUTLINE);
  assert.equal(slabOpeningArea(opening), 5_000_000, 'Г-контур — 5 м², bbox — 9 м²');
  assert.equal(roomNetAreaM2(levelProject(project, l2.id), hall), 31);

  const back = deserializeProject(serializeProject(project));
  const stored = back.levels.find((level) => level.id === l2.id).slabOpenings[0];
  assert.deepEqual(slabOpeningPolygon(stored), L_OUTLINE);
  assert.equal(slabOpeningArea(stored), 5_000_000);

  const exported = buildStructuredExport(back).levels.find((level) => level.id === l2.id).slab_openings[0];
  assert.equal(exported.source, 'manual');
  assert.deepEqual(exported.polygon, L_OUTLINE);
  assert.deepEqual(exported.size, { w: 3000, h: 3000 });
  assert.equal(exported.area_m2, 5);
});

test('Г-контур: 3D вырезает два рукава, но сохраняет пол и перекрытие во вогнутой части bbox', () => {
  const { project, l2 } = twoStorey();
  createSlabOpening(project, l2.id, L_OUTLINE);
  const faces = buildHouseMesh(project);

  assertOpeningCut(faces, l2.id, { x: 3500, y: 1500 }, 'горизонтальный рукав');
  assertOpeningCut(faces, l2.id, { x: 1500, y: 3500 }, 'вертикальный рукав');
  assertOpeningSolid(faces, l2.id, { x: 3000, y: 3000 }, 'вогнутая часть внутри bbox, но вне проёма');
});

test('диагональный треугольник: площадь точна, а 3D не вырезает весь bbox', () => {
  const { project, l2, hall } = twoStorey();
  const opening = createSlabOpening(project, l2.id, TRIANGLE);

  assert.ok(opening);
  assert.deepEqual(slabOpeningPolygon(opening), TRIANGLE);
  assert.equal(slabOpeningArea(opening), 8_000_000);
  const stripsArea = slabOpeningCutRects(opening).reduce((sum, rect) => sum + rect.w * rect.h, 0);
  assert.ok(Math.abs(stripsArea - 8_000_000) < 1, `площадь полос ${stripsArea}`);
  assert.ok(Math.abs(roomNetAreaM2(levelProject(project, l2.id), hall) - 28) < 1e-6);

  const faces = buildHouseMesh(project);
  assertOpeningCut(faces, l2.id, { x: 2000, y: 2000 }, 'точка внутри треугольника');
  assertOpeningSolid(faces, l2.id, { x: 4500, y: 4500 }, 'точка вне диагонали, но внутри bbox');
});

test('auto→manual: полигональная правка сохраняет stairId, отвязывает форму и «Вернуть авто» восстанавливает следование', () => {
  const { project, l2 } = twoStorey();
  const stair = createItem('stairs', 2500, 2500, 1000, 3000);
  project.items.push(stair);
  const [auto] = slabOpenings(project, l2.id);
  assert.ok(auto?.auto);

  const manual = setSlabOpeningPolygon(project, l2.id, auto.id, L_OUTLINE);
  assert.ok(manual);
  assert.notEqual(manual.id, auto.id);
  assert.equal(manual.stairId, stair.id);
  assert.deepEqual(slabOpeningPolygon(manual), L_OUTLINE);
  assert.equal(l2.slabOpenings.length, 1);
  assert.equal(slabOpenings(project, l2.id)[0].auto, false);

  stair.x += 1200;
  assert.deepEqual(slabOpeningPolygon(slabOpenings(project, l2.id)[0]), L_OUTLINE,
    'ручной контур больше не следует за лестницей');

  const autoId = resetSlabOpeningAuto(project, l2.id, manual.id);
  assert.equal(autoId, `auto:${stair.id}`);
  assert.equal(l2.slabOpenings, undefined);
  const [restored] = slabOpenings(project, l2.id);
  assert.equal(restored.id, autoId);
  assert.equal(restored.auto, true);
  assert.equal(restored.stairId, stair.id);
  assert.equal(Object.hasOwn(restored, 'outline'), false);
  assert.equal(restored.x, Math.round(stair.x - stair.w / 2 - 100));
});
