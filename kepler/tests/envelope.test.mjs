// Автоматическая оболочка: проектный ноль, земля, фундамент и связанная крыша.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildSection } from '../core/section.js';
import { buildHouseMesh, foundationFaces, terrainHeightFn } from '../core/mesh3d.js';
import { pickFaces, pickObject } from '../core/pick3d.js';
import {
  createLevel, createProject, createRoom, deserializeProject, hasContent, serializeProject,
} from '../core/model.js';
import { captureGroundReference, houseTerrain, normalizeTerrain } from '../core/terrain.js';

const range = (faces) => [
  Math.min(...faces.flatMap((face) => face.pts.map((point) => point.z))),
  Math.max(...faces.flatMap((face) => face.pts.map((point) => point.z))),
];

function oneStorey() {
  const project = createProject();
  project.settings.exterior = 250;
  project.rooms.push(
    createRoom('living', 0, 0, 4000, 4000),
    createRoom('kitchen', 4000, 0, 3000, 4000),
  );
  return project;
}

test('свес новой крыши сохраняется, старые дома сохраняют свои габариты', () => {
  const project = createProject();
  assert.equal(project.envelope.roof.overhang, 600);
  assert.equal(hasContent(project), false);
  const raw = JSON.parse(serializeProject(project));
  assert.equal(deserializeProject(JSON.stringify(raw)).envelope.roof.overhang, 600);
  delete raw.envelope.roof.overhang;
  const legacy = deserializeProject(JSON.stringify(raw));
  assert.equal(legacy.envelope.roof.overhang, 0);
  assert.equal(hasContent(legacy), false);
  raw.envelope.roof.overhang = 350;
  assert.equal(deserializeProject(JSON.stringify(raw)).envelope.roof.overhang, 350);
});

test('±0.000 над плоской землёй создаёт единые цоколь и фундамент', () => {
  const project = oneStorey();
  project.envelope.zeroAboveGround = 1000;
  project.envelope.foundation.depth = 800;

  const height = terrainHeightFn(project);
  assert.equal(height(0, 0), -1000);
  assert.equal(height.flat, true);

  const foundation = foundationFaces(project);
  const buried = foundation.filter((face) => face.kind === 'foundation');
  const plinth = foundation.filter((face) => face.kind === 'plinth');
  assert.deepEqual(range(buried), [-1800, -1500], 'новая плита использует заданную толщину 300 мм');
  assert.deepEqual(range(plinth), [-1500, 0], 'цоколь непрерывно доходит до ±0.000');
  assert.equal(buried.filter((face) => face.normal.z === 1).length, 1, 'смежные комнаты дают одно основание');
  assert.equal(plinth.filter((face) => face.normal.z === 1).length, 1, 'у цоколя нет шва между комнатами');
  const edges = foundation.flatMap((face) => face.edges || []);
  assert.ok(edges.every(([a, b]) => !(a.x === 4000 && b.x === 4000)), 'внутренней грани между комнатами нет');

  const ground = buildHouseMesh(project, { site: true }).filter((face) => face.kind === 'ground');
  assert.equal(ground.length, 1);
  assert.ok(ground[0].pts.every((point) => point.z === -1005));
});

test('старый фундамент только с depth сохраняет прежнюю сплошную геометрию', () => {
  const project = oneStorey();
  project.envelope.zeroAboveGround = 1000;
  const raw = JSON.parse(serializeProject(project));
  raw.envelope.foundation = { enabled: true, depth: 800 };
  const back = deserializeProject(JSON.stringify(raw));

  assert.equal(back.envelope.foundation.sizingMode, 'legacy-depth');
  const foundation = foundationFaces(back);
  assert.deepEqual(range(foundation.filter((face) => face.kind === 'foundation')), [-1800, -1000]);
  assert.deepEqual(range(foundation.filter((face) => face.kind === 'plinth')), [-1000, 0]);
});
test('связанная крыша включается режимом оболочки и несёт метаданные этажа', () => {
  const project = oneStorey();
  const linked = buildHouseMesh(project, { roof: true, roofs: false });
  const tops = linked.filter((face) => face.autoRoofId && face.kind === 'roof' && face.normal.z === 1);
  assert.equal(tops.length, 1);
  assert.equal(tops[0].level, project.activeLevel);
  assert.equal(tops[0].roofSource, 'linked');
  assert.ok(linked.some((face) => face.autoRoofId && face.kind === 'roof-soffit'), 'у кровли есть нижняя грань');
  const room = project.rooms[0];
  const hit = pickObject({ faces: pickFaces(linked) }, {
    o: { x: room.x + room.w / 2, y: room.y + room.h / 2, z: 10000 },
    d: { x: 0, y: 0, z: -1 },
  });
  assert.equal(hit?.type, 'roof', 'крыша выбирается над комнатой');
  assert.equal(hit.id, tops[0].autoRoofId);
  const interior = buildHouseMesh(project, { roof: false, roofs: false });
  assert.equal(pickObject({ faces: pickFaces(interior) }, {
    o: { x: room.x + room.w / 2, y: room.y + room.h / 2, z: 10000 }, d: { x: 0, y: 0, z: -1 },
  })?.type, 'room', 'при скрытой крыше можно выбрать комнату');

  project.envelope.roofMode = 'manual';
  assert.equal(buildHouseMesh(project, { roof: true, roofs: false }).some((face) => face.autoRoofId), false);
});

test('вертикальный масштаб усиливает только перепад, а не высоту нуля', () => {
  const project = createProject();
  project.settings.exterior = 0;
  project.rooms.push(createRoom('living', 0, 0, 10000, 10000));
  project.envelope.zeroAboveGround = 1000;
  project.site.terrain = normalizeTerrain({ points: [
    { id: 'a', x: 0, y: 0, z: 100000 },
    { id: 'b', x: 10000, y: 0, z: 101000 },
    { id: 'c', x: 0, y: 10000, z: 100000 },
    { id: 'd', x: 10000, y: 10000, z: 101000 },
  ] });
  const normal = terrainHeightFn(project, 1);
  const amplified = terrainHeightFn(project, 5);
  assert.equal(normal(5000, 5000), -1000);
  assert.equal(amplified(5000, 5000), -1000, 'опорная земля остаётся на −1 м');
  assert.equal(normal(0, 5000), -1500);
  assert.equal(amplified(0, 5000), -3500);

  const sampled = houseTerrain(project);
  project.envelope.groundReferenceZ = sampled.sampledGroundReferenceZ;
  const fixedFloorZ = houseTerrain(project).floorZ;
  project.rooms[0].x = 4000;
  assert.equal(houseTerrain(project).floorZ, fixedFloorZ, '±0.000 не прыгает при изменении пятна дома');
});

test('опорная земля фиксируется до появления дома, пустой нижний этаж не мешает посадке', () => {
  const project = createProject();
  project.envelope.zeroAboveGround = 1000;
  project.site.terrain = normalizeTerrain({ points: [
    { id: 'a', x: 0, y: 0, z: 100000 },
    { id: 'b', x: 20000, y: 0, z: 102000 },
    { id: 'c', x: 0, y: 20000, z: 100000 },
    { id: 'd', x: 20000, y: 20000, z: 102000 },
  ] });
  assert.equal(captureGroundReference(project), 101000, 'без пятна берётся средняя земля участка');
  const upper = createLevel('2 этаж', 3000, 3000);
  upper.rooms.push(createRoom('living', 0, 0, 4000, 4000));
  project.levels.push(upper);
  const initial = houseTerrain(project);
  assert.ok(initial, 'найден нижний занятый, а не первый пустой этаж');
  assert.equal(initial.floorZ, 102000);
  upper.rooms[0].x = 12000;
  assert.equal(houseTerrain(project).floorZ, 102000, 'перемещение дома не меняет абсолютный ±0.000');
});

test('разрез режет основание, а проектный ноль переживает файл и считается содержимым', () => {
  const project = oneStorey();
  assert.equal(hasContent(createProject()), false);
  project.envelope.zeroAboveGround = 1000;
  project.envelope.foundation.depth = 800;
  const emptyWithDatum = createProject();
  emptyWithDatum.envelope.zeroAboveGround = 450;
  assert.equal(hasContent(emptyWithDatum), true);

  const back = deserializeProject(serializeProject(project));
  assert.equal(back.envelope.zeroAboveGround, 1000);
  assert.equal(back.envelope.foundation.depth, 800);

  const section = buildSection(back, {
    id: 's', kind: 'section', name: 'Разрез', side: 1,
    line: { a: { x: -1000, y: 2000 }, b: { x: 8000, y: 2000 } },
  });
  const cuts = section.cuts.filter((cut) => cut.kind === 'foundation');
  assert.ok(cuts.length >= 2);
  assert.deepEqual(range(cuts), [-1800, 0]);
  assert.ok(section.ground.every((point) => point.z === -1000));
});

test('параметры связанных систем и толщина перекрытия сохраняются в файле', () => {
  const project = oneStorey();
  project.envelope.zeroAboveGround = 850;
  project.envelope.roof = { type: 'hip', pitchDeg: 22, direction: 'e', overhang: 650, drainage: 'external' };
  project.envelope.foundation = {
    ...project.envelope.foundation, type: 'piles', pileDiameter: 350, pileLength: 4200, pileSpacing: 2100,
  };
  project.envelope.entrance = { ...project.envelope.entrance, mode: 'both', landingDepth: 1700, rampSlope: 0.06 };
  project.envelope.earthworks = { mode: 'balanced', margin: 1800, gradeOffset: 120 };
  project.levels[0].slabThickness = 350;
  const back = deserializeProject(serializeProject(project));
  assert.deepEqual(back.envelope.roof, project.envelope.roof);
  assert.equal(back.envelope.foundation.type, 'piles');
  assert.equal(back.envelope.foundation.pileLength, 4200);
  assert.equal(back.envelope.entrance.mode, 'both');
  assert.equal(back.envelope.earthworks.mode, 'balanced');
  assert.equal(back.levels[0].slabThickness, 350);
});
