import test from 'node:test';
import assert from 'node:assert/strict';
import { createOpening, createProject, createRoom } from '../core/model.js';
import { roomNetAreaM2 } from '../core/rooms.js';
import { sharedKey } from '../core/walls.js';
import { roomDaylightAnalysis, roomDaylightAnalysisKey } from '../core/daylight-analysis.js';

function daylightRoom({ depth = 5000, width = 1200, height = 1500, sill = 800 } = {}) {
  const project = createProject('Проверка дневного света');
  const room = createRoom('living', 0, 0, 6000, depth);
  const opening = createOpening('window', room.id, 2, 3000, width);
  opening.height = height;
  opening.sill = sill;
  project.rooms.push(room);
  project.openings.push(opening);
  return { project, room, opening };
}

const analyze = (project, room, extra = {}) => roomDaylightAnalysis(project, {
  roomId: room.id,
  cell: 500,
  ...extra,
});

function finiteMetrics(result) {
  return [
    result.meanDaylightFactor, result.minDaylightFactor, result.maxDaylightFactor,
    result.meanLux, result.coverageDaylightFactor, result.coverageLux,
    result.meanWindowSkyVisibility, result.uniformity,
  ].every(Number.isFinite);
}

test('предварительная карта детерминирована, чиста и ограничена 400 ячейками', () => {
  const { project, room } = daylightRoom({ width: 1800, height: 1800 });
  const before = JSON.stringify(project);
  const a = analyze(project, room, { maxCells: 5000 });
  const b = analyze(project, room, { maxCells: 5000 });

  assert.equal(JSON.stringify(project), before, 'расчёт не меняет проект');
  assert.deepEqual(a, b);
  assert.equal(a.method, 'cie-overcast-concept/1');
  assert.equal(a.preliminary, true);
  assert.equal(a.estimated, true);
  assert.equal(a.normative, false);
  assert.ok(a.points.length > 0 && a.points.length <= 400);
  assert.ok(finiteMetrics(a));
  assert.ok(a.meanDaylightFactor > 0);
  assert.equal(a.meanLux, a.meanDaylightFactor / 100 * a.externalLux);
  assert.ok(a.points.every((point) =>
    point.estimatedLux === point.daylightFactor / 100 * a.externalLux));
  assert.ok(a.points.every((point) => point.daylightFactor >= 0 &&
    point.daylightFactor <= a.physicalCapDaylightFactor));
  assert.equal(a.assumptions.externalLux, a.externalLux);
  assert.equal(a.assumptions.workplane, a.workplane);
  assert.match(a.assumptions.sky, /overcast/i);
  assert.ok(a.assumptions.reflections);
  assert.ok(a.assumptions.shading);
  assert.match(a.assumptions.skyVisibility, /не полный SVF/i);

  const customTarget = analyze(project, room, { luxTarget: 500 });
  const sampledArea = customTarget.points.reduce((sum, point) => sum + point.area, 0);
  const expected300 = customTarget.points.reduce((sum, point) =>
    sum + (point.estimatedLux >= 300 ? point.area : 0), 0) / sampledArea;
  const expected500 = customTarget.points.reduce((sum, point) =>
    sum + (point.estimatedLux >= 500 ? point.area : 0), 0) / sampledArea;
  assert.equal(customTarget.coverage300, expected300);
  assert.equal(customTarget.coverageLux, expected500);
});

test('без окон все показатели конечны и равны нулю', () => {
  const project = createProject();
  const room = createRoom('living', 0, 0, 4000, 4000);
  project.rooms.push(room);
  const result = analyze(project, room);

  assert.equal(result.windows, 0);
  assert.ok(finiteMetrics(result));
  assert.deepEqual({
    meanDaylightFactor: result.meanDaylightFactor,
    minDaylightFactor: result.minDaylightFactor,
    maxDaylightFactor: result.maxDaylightFactor,
    meanLux: result.meanLux,
    coverageDaylightFactor: result.coverageDaylightFactor,
    coverageLux: result.coverageLux,
  }, {
    meanDaylightFactor: 0,
    minDaylightFactor: 0,
    maxDaylightFactor: 0,
    meanLux: 0,
    coverageDaylightFactor: 0,
    coverageLux: 0,
  });
  assert.ok(result.points.every((point) => point.daylightFactor === 0 && point.estimatedLux === 0));
  assert.equal(result.recommendations[0].code, 'NO_WINDOWS');
});

test('большее окно монотонно увеличивает DF и расчётные люксы', () => {
  const { project, room, opening } = daylightRoom({ width: 600, height: 900 });
  const small = analyze(project, room);
  opening.width = 3000;
  const wide = analyze(project, room);
  opening.width = 600;
  opening.height = 2100;
  const tall = analyze(project, room);

  assert.ok(wide.meanDaylightFactor > small.meanDaylightFactor,
    `ширина: ${small.meanDaylightFactor} → ${wide.meanDaylightFactor}`);
  assert.ok(wide.meanLux > small.meanLux);
  assert.ok(tall.meanDaylightFactor > small.meanDaylightFactor,
    `высота: ${small.meanDaylightFactor} → ${tall.meanDaylightFactor}`);
  assert.ok(tall.meanLux > small.meanLux);
});

test('светопропускание монотонно влияет на результат и входит в cache key', () => {
  const { project, room, opening } = daylightRoom({ width: 2400, height: 2000 });
  const low = analyze(project, room, { transmittance: 0.25 });
  const high = analyze(project, room, { transmittance: 0.85 });
  assert.ok(high.meanDaylightFactor > low.meanDaylightFactor);
  assert.ok(high.meanLux > low.meanLux);

  const options = { roomId: room.id, cell: 500 };
  const defaultKey = roomDaylightAnalysisKey(project, options);
  opening.transmittance = 0.35;
  const lowKey = roomDaylightAnalysisKey(project, options);
  const ownLow = analyze(project, room);
  opening.transmittance = 0.85;
  const highKey = roomDaylightAnalysisKey(project, options);
  const ownHigh = analyze(project, room);
  assert.notEqual(lowKey, defaultKey);
  assert.notEqual(highKey, lowKey);
  assert.ok(ownHigh.meanDaylightFactor > ownLow.meanDaylightFactor);
  assert.equal(ownHigh.confidence.level, 'medium');

  delete opening.transmittance;
  const nullOption = analyze(project, room, { transmittance: null });
  assert.equal(nullOption.assumptions.transmission.defaultGlass, 0.7);
  assert.equal(nullOption.confidence.level, 'low');
});

test('числовые опции ограничиваются безопасными диапазонами', () => {
  const { project, room } = daylightRoom({ width: 2400, height: 2000 });
  const result = analyze(project, room, {
    externalLux: 1_000_000,
    workplane: 100_000,
    transmittance: 5,
    frameFactor: 5,
    maintenanceFactor: 5,
    interiorReflectance: 5,
    daylightFactorTarget: -5,
    luxTarget: 100_000,
    samplesAlong: 100,
    samplesVertical: -100,
    maxCells: 10_000,
  });
  assert.equal(result.externalLux, 100_000);
  assert.equal(result.workplane, 2600);
  assert.deepEqual(result.thresholds, { daylightFactor: 0.1, lux: 5000 });
  assert.equal(result.assumptions.transmission.defaultGlass, 1);
  assert.equal(result.assumptions.transmission.frameFactor, 1);
  assert.equal(result.assumptions.transmission.maintenanceFactor, 1);
  assert.equal(result.assumptions.interiorReflectance, 0.9);
  assert.equal(result.assumptions.samplesPerWindow, 16);
  assert.ok(result.points.length <= 400);
});

test('более глубокая комната получает меньший средний DF', () => {
  const shallowFixture = daylightRoom({ depth: 3500, width: 1800, height: 1800 });
  const deepFixture = daylightRoom({ depth: 9000, width: 1800, height: 1800 });
  const shallow = analyze(shallowFixture.project, shallowFixture.room);
  const deep = analyze(deepFixture.project, deepFixture.room);

  assert.ok(deep.meanDaylightFactor < shallow.meanDaylightFactor,
    `глубина: ${shallow.meanDaylightFactor} → ${deep.meanDaylightFactor}`);
  assert.ok(deep.meanLux < shallow.meanLux);
});

test('высокое внешнее препятствие уменьшает DF, видимость неба через окно и люксы', () => {
  const { project, room } = daylightRoom({ width: 3000, height: 2500, sill: 100 });
  const free = analyze(project, room);
  project.site.neighbors.push({
    id: 'shade', x: 3000, y: room.y + room.h + 3250,
    w: 20000, h: 4000, height: 15000, rot: 0,
  });
  const shaded = analyze(project, room);

  assert.ok(shaded.meanDaylightFactor < free.meanDaylightFactor,
    `препятствие: ${free.meanDaylightFactor} → ${shaded.meanDaylightFactor}`);
  assert.ok(shaded.meanLux < free.meanLux);
  assert.ok(shaded.meanWindowSkyVisibility < free.meanWindowSkyVisibility);

  project.site.neighbors = [];
  project.masses = [{
    id: 'shade-mass', x: 3000, y: 7000,
    w: 20000, d: 3000, z0: 0, h: 20000, rotation: 0,
  }];
  const massShaded = analyze(project, room);
  assert.ok(massShaded.meanDaylightFactor < free.meanDaylightFactor);
  assert.ok(massShaded.meanWindowSkyVisibility < free.meanWindowSkyVisibility);
});

test('пасмурная оценка не зависит от даты, координат и направления севера', () => {
  const { project, room } = daylightRoom({ width: 1800, height: 1800 });
  const initial = analyze(project, room);
  project.site.sun.date = '2042-12-31';
  project.site.location = { lat: -33.86, lon: 151.21, tz: 10 };
  project.site.north = 137;
  project.site.solarVerified = !project.site.solarVerified;
  const changed = analyze(project, room);
  assert.deepEqual(changed, initial);
});

test('чистая геометрия пола и открытая зона участвуют в расчёте', () => {
  const project = createProject();
  const living = createRoom('living', 0, 0, 3000, 4000);
  const kitchen = createRoom('kitchen', 3100, 0, 3000, 4000);
  const child = createRoom('bathroom', 500, 500, 1000, 1000);
  child.parentId = living.id;
  project.rooms.push(living, kitchen, child);
  project.wallOverrides[sharedKey(living.id, kitchen.id)] = { hidden: true };
  const opening = createOpening('window', kitchen.id, 1, 2000, 2400);
  opening.height = 2000;
  opening.sill = 300;
  project.openings.push(opening);

  const result = analyze(project, living, { cell: 700 });
  const sampledArea = result.points.reduce((sum, point) => sum + point.area, 0);
  assert.deepEqual(new Set(result.zoneRoomIds), new Set([living.id, kitchen.id]));
  assert.ok(Math.abs(sampledArea / 1_000_000 - roomNetAreaM2(project, living)) < 1e-9);
  const zoneFloorArea = roomNetAreaM2(project, living) + roomNetAreaM2(project, kitchen);
  assert.ok(Math.abs(result.glazing.floorArea - zoneFloorArea) < 1e-9);
  assert.equal(result.windows, 1);
  assert.ok(result.meanDaylightFactor > 0);
});
