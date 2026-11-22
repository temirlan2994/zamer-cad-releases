import assert from 'node:assert/strict';
import test from 'node:test';

import { pointInPolygon } from '../core/geom/index.js';
import {
  createProject, deserializeProject, hasContent, serializeProject,
} from '../core/model.js';
import {
  siteOpportunity,
  sitePassport,
  sitePlanningRoute,
  workingBuildableGeometry,
} from '../core/site-planning.js';

function readySite() {
  const project = createProject('Анализ участка');
  project.site.boundary = [
    { x: 0, y: 0 },
    { x: 50_000, y: 0 },
    { x: 50_000, y: 40_000 },
    { x: 0, y: 40_000 },
  ];
  project.site.roads = [{
    id: 'road-1',
    points: [{ x: 0, y: -2_000 }, { x: 50_000, y: -2_000 }],
    width: 3_500,
  }];
  project.site.entry = { x: 5_000, y: 0, angle: 0 };
  project.site.solarVerified = true;
  Object.assign(project.site.planning, {
    withoutUnderlay: true,
    contextReviewed: true,
    flatTerrain: true,
    constraintsConfirmed: {
      setbackBoundary: project.site.setbackBoundary,
      setbackNeighbor: project.site.setbackNeighbor,
    },
    referenceFootprint: { width: 9_000, depth: 7_000, rotation: 0 },
  });
  return project;
}

test('пустой проект честно оставляет факты неизвестными или отсутствующими', () => {
  const project = createProject();
  const passport = sitePassport(project);
  const route = sitePlanningRoute(project);

  assert.equal(passport.status, 'incomplete');
  assert.equal(passport.facts.underlay.status, 'unknown');
  assert.equal(passport.facts.boundary.status, 'missing');
  assert.equal(passport.facts.context.status, 'unknown');
  assert.equal(passport.facts.solar.status, 'unknown');
  assert.equal(passport.facts.terrain.status, 'unknown');
  assert.equal(passport.facts.constraints.status, 'unknown');
  assert.equal(passport.facts.zone.status, 'unknown');
  assert.equal(passport.facts.footprint.status, 'missing');
  assert.equal(route.total, 9);
  assert.equal(route.completed, 0);
  assert.equal(route.progress, 0);
  assert.deepEqual(route.stages.map(({ id }) => id), ['foundation', 'access', 'conditions', 'constraints']);
});

test('явные подтверждения завершают только соответствующие факты', () => {
  const project = readySite();
  const passport = sitePassport(project);
  const route = sitePlanningRoute(project);

  assert.equal(passport.status, 'ready');
  assert.equal(passport.facts.underlay.source, 'confirmation');
  assert.equal(passport.facts.context.source, 'confirmation');
  assert.equal(passport.facts.terrain.source, 'confirmation');
  assert.equal(passport.facts.constraints.status, 'done');
  assert.equal(route.progress, 1);

  project.site.planning.referenceFootprint = null;
  const withoutOptionalFootprint = sitePlanningRoute(project);
  assert.equal(withoutOptionalFootprint.progress, 1);
  assert.equal(sitePassport(project).facts.footprint.required, false);

  project.site.setbackBoundary += 500;
  const changed = sitePassport(project);
  assert.equal(changed.facts.constraints.status, 'unknown');
  assert.match(changed.facts.constraints.reason, /изменились/);
});

test('наличие соседа не подменяет подтверждение полноты окружения', () => {
  const project = readySite();
  project.site.planning.contextReviewed = false;
  project.site.neighbors = [{
    id: 'known-neighbor', x: 40_000, y: 20_000, w: 4_000, h: 6_000, rot: 0,
  }];
  const passport = sitePassport(project);
  const route = sitePlanningRoute(project);

  assert.equal(passport.facts.context.status, 'unknown');
  assert.equal(passport.facts.context.count, 1);
  assert.equal(route.stages.find(({ id }) => id === 'access').status, 'unknown');
  const opportunity = siteOpportunity(project);
  assert.ok(opportunity.candidates.every(({ factors }) => factors.privacy.known === false));
});

test('подтверждение окружения инвалидируется после изменения соседей и сохраняет снимок', () => {
  const project = readySite();
  assert.equal(sitePassport(project).facts.context.status, 'done');

  project.site.neighbors.push({
    id: 'neighbor-new', x: 40_000, y: 20_000, w: 4_000, h: 6_000, rot: 0,
  });
  assert.equal(project.site.planning.contextReviewed, false);
  assert.equal(sitePassport(project).facts.context.status, 'unknown');
  assert.ok(siteOpportunity(project).candidates.every(({ factors }) => factors.privacy.known === false));

  project.site.planning.contextReviewed = true;
  assert.equal(sitePassport(project).facts.context.status, 'done');
  const loaded = deserializeProject(serializeProject(project));
  assert.equal(loaded.site.planning.contextSnapshot, project.site.planning.contextSnapshot);
  assert.equal(sitePassport(loaded).facts.context.status, 'done');

  loaded.site.neighbors[0].x += 500;
  assert.equal(sitePassport(loaded).facts.context.status, 'unknown');
});

test('старый contextReviewed boolean получает совместимый снимок при загрузке', () => {
  const data = JSON.parse(serializeProject(readySite()));
  delete data.site.planning.contextSnapshot;
  const loaded = deserializeProject(JSON.stringify(data));

  assert.equal(loaded.site.planning.contextReviewed, true);
  assert.equal(typeof loaded.site.planning.contextSnapshot, 'string');
  assert.equal(sitePassport(loaded).facts.context.status, 'done');
  loaded.site.neighbors.push({ id: 'later', x: 30_000, y: 20_000, w: 4_000, h: 4_000 });
  assert.equal(sitePassport(loaded).facts.context.status, 'unknown');
});

test('рабочая геометрия сужает границу и вычитает соседский буфер', () => {
  const project = readySite();
  project.site.neighbors = [{
    id: 'neighbor-1', x: 25_000, y: 20_000, w: 4_000, h: 4_000, rot: 0,
  }];
  const result = workingBuildableGeometry(project.site);

  assert.equal(result.status, 'verified');
  assert.equal(pointInPolygon(result.geometry, { x: 500, y: 500 }), false);
  assert.equal(pointInPolygon(result.geometry, { x: 2_000, y: 2_000 }), true);
  assert.equal(pointInPolygon(result.geometry, { x: 25_000, y: 20_000 }), false);
  assert.ok(result.areaM2 > 0);
  assert.ok(result.areaM2 < 47 * 37);
});

test('красная линия пока даёт предупреждение, а схлопнувшийся inset — empty', () => {
  const project = readySite();
  project.site.redLine = [{ x: 0, y: 3_000 }, { x: 50_000, y: 3_000 }];
  const withRedLine = workingBuildableGeometry(project.site);
  assert.equal(pointInPolygon(withRedLine.geometry, { x: 25_000, y: 4_000 }), true);
  assert.ok(withRedLine.warnings.some((warning) => warning.includes('Красная линия')));

  project.site.boundary = [
    { x: 0, y: 0 }, { x: 2_000, y: 0 }, { x: 2_000, y: 2_000 }, { x: 0, y: 2_000 },
  ];
  assert.equal(workingBuildableGeometry(project.site).status, 'empty');
});

test('самопересекающаяся граница не выдаётся за рабочее пятно', () => {
  const project = readySite();
  project.site.boundary = [
    { x: 5_000, y: 0 },
    { x: 10_000, y: 10_000 },
    { x: 0, y: 4_000 },
    { x: 10_000, y: 4_000 },
    { x: 0, y: 10_000 },
  ];

  const buildable = workingBuildableGeometry(project.site);
  assert.equal(buildable.status, 'error');
  assert.equal(buildable.geometry.length, 0);
  assert.equal(sitePassport(project).facts.boundary.status, 'error');
});

test('детальный плавный контур не становится ложной пустой зоной после отступа', () => {
  const project = readySite();
  project.site.boundary = Array.from({ length: 256 }, (_, index) => {
    const angle = index * Math.PI * 2 / 256;
    return { x: Math.cos(angle) * 40_000, y: Math.sin(angle) * 40_000 };
  });

  const buildable = workingBuildableGeometry(project.site);
  assert.equal(buildable.status, 'verified');
  assert.equal(buildable.geometry.length, 1);
  assert.ok(buildable.areaM2 > 4_500 && buildable.areaM2 < 4_800);
  assert.ok(buildable.evidence.some(({ id }) => id === 'boundary-decimation'));
});

test('экстремальные конечные координаты дают error, а не падение геометрии', () => {
  const project = readySite();
  project.site.boundary = [
    { x: 0, y: 0 }, { x: 1e308, y: 0 }, { x: 0, y: 1e308 },
  ];

  assert.doesNotThrow(() => workingBuildableGeometry(project.site));
  assert.equal(workingBuildableGeometry(project.site).status, 'error');
  assert.equal(sitePassport(project).facts.boundary.status, 'error');
  assert.equal(siteOpportunity(project).status, 'error');
});

test('дорога нулевой длины не завершает этап доступа', () => {
  const project = readySite();
  project.site.roads = [{
    id: 'zero-road', points: [{ x: 5_000, y: 0 }, { x: 5_000, y: 0 }], width: 3_500,
  }];

  const passport = sitePassport(project);
  const route = sitePlanningRoute(project);
  const opportunity = siteOpportunity(project);
  assert.equal(passport.facts.roads.status, 'error');
  assert.equal(route.stages.find(({ id }) => id === 'access').status, 'error');
  assert.ok(opportunity.candidates.every(({ factors }) => factors.access.known === false));
  assert.notEqual(opportunity.status, 'ready');
});

test('дорога вдали от въезда не считается связанной с участком', () => {
  const project = readySite();
  project.site.roads = [{
    id: 'far-road',
    points: [{ x: 1_000_000, y: 1_000_000 }, { x: 1_050_000, y: 1_000_000 }],
    width: 3_500,
  }];

  const passport = sitePassport(project);
  const route = sitePlanningRoute(project);
  const opportunity = siteOpportunity(project);
  assert.equal(passport.facts.roads.status, 'error');
  assert.equal(route.stages.find(({ id }) => id === 'access').status, 'error');
  assert.ok(opportunity.candidates.every(({ factors }) => factors.access.known === false));
  assert.notEqual(opportunity.status, 'ready');
});

test('неподтверждённые ограничения не дают карте статус ready', () => {
  const project = readySite();
  project.site.planning.constraintsConfirmed = null;

  assert.equal(workingBuildableGeometry(project.site).status, 'preliminary');
  assert.equal(sitePassport(project).facts.zone.status, 'unknown');
  assert.equal(siteOpportunity(project).status, 'preliminary');
});

test('ошибочные солнечные данные остаются неизвестным фактором', () => {
  const project = readySite();
  project.site.location.lat = 123;

  const passport = sitePassport(project);
  const opportunity = siteOpportunity(project);
  assert.equal(passport.facts.solar.status, 'error');
  assert.ok(opportunity.coverage < 1);
  assert.ok(opportunity.candidates.every(({ factors }) => factors.sun.known === false));
  assert.notEqual(opportunity.status, 'ready');
});

test('зимний солнечный расчёт учитывает южное полушарие', () => {
  const project = readySite();
  project.site.location = { lat: -33.87, lon: 151.21, tz: 10 };
  const opportunity = siteOpportunity(project);

  assert.ok(opportunity.candidates.length > 0);
  assert.ok(opportunity.candidates.every(({ factors }) => factors.sun.raw.date === '2025-06-21'));
});

test('карта ограничена 500 ячейками и проверяет всё пятно, а не только центр', () => {
  const project = readySite();
  project.site.neighbors = [{
    id: 'neighbor-1', x: 30_000, y: 20_000, w: 3_000, h: 3_000, rot: 25,
  }];
  const result = siteOpportunity(project);

  assert.ok(result.cells.length > 0);
  assert.ok(result.cells.length <= 500);
  assert.ok(result.cells.some(({ blocked }) => blocked));
  assert.ok(result.cells.some(({ blocked }) => !blocked));
  assert.ok(result.candidates.length >= 1 && result.candidates.length <= 3);
  for (const candidate of result.candidates) {
    assert.equal(candidate.corners.length, 4);
    assert.ok(candidate.corners.every((corner) => pointInPolygon(result.geometry, corner)));
  }
});

test('карта отклоняет нереалистично малый или чрезмерный проверочный габарит', () => {
  const project = readySite();
  assert.equal(siteOpportunity(project, {
    footprint: { width: 1_000, depth: 8_000, rotation: 0 },
  }).status, 'missing');
  assert.equal(siteOpportunity(project, {
    footprint: { width: 101_000, depth: 8_000, rotation: 0 },
  }).status, 'missing');
});

test('близость к въезду повышает только фактор доступа', () => {
  const project = readySite();
  const result = siteOpportunity(project, {
    footprint: { width: 5_000, depth: 5_000, rotation: 30 },
  });
  const available = result.cells.filter(({ blocked }) => !blocked);
  const near = available.reduce((best, cell) => (
    cell.factors.access.raw.distance < best.factors.access.raw.distance ? cell : best
  ));
  const far = available.reduce((best, cell) => (
    cell.factors.access.raw.distance > best.factors.access.raw.distance ? cell : best
  ));

  assert.ok(near.factors.access.score > far.factors.access.score);
});

test('фактор доступа не считает въезд внутри участка валидным', () => {
  const project = readySite();
  project.site.entry = { x: 25_000, y: 20_000, angle: 0 };

  const passport = sitePassport(project);
  const result = siteOpportunity(project);
  assert.equal(passport.facts.entry.status, 'error');
  assert.equal(result.status, 'partial');
  assert.ok(result.coverage < 1);
  assert.ok(result.candidates.every(({ factors }) => factors.access.known === false));
});

test('неизвестный уклон не улучшает score и уменьшает coverage', () => {
  const project = readySite();
  project.site.planning.flatTerrain = false;
  const withoutTerrain = siteOpportunity(project);
  assert.equal(withoutTerrain.status, 'partial');
  assert.ok(withoutTerrain.coverage < 1);
  assert.ok(withoutTerrain.candidates.every(({ factors }) => factors.slope.known === false));

  project.site.planning.flatTerrain = true;
  const flat = siteOpportunity(project);
  assert.equal(flat.coverage, 1);
  assert.ok(flat.candidates.every(({ factors }) => factors.slope.score === 100));
  assert.ok(flat.candidates[0].score >= withoutTerrain.candidates[0].score);
});

test('реальный рельеф имеет приоритет над устаревшим подтверждением flatTerrain', () => {
  const project = readySite();
  project.site.planning.flatTerrain = true;
  project.site.terrain = {
    points: [
      { id: 'a', x: 0, y: 0, z: 0 },
      { id: 'b', x: 50_000, y: 0, z: 5_000 },
      { id: 'c', x: 50_000, y: 40_000, z: 5_000 },
      { id: 'd', x: 0, y: 40_000, z: 0 },
    ],
  };
  const passport = sitePassport(project);
  const result = siteOpportunity(project);

  assert.equal(passport.facts.terrain.source, 'terrain');
  assert.equal(result.coverage, 1);
  assert.ok(result.candidates.every(({ factors }) => factors.slope.known));
  assert.ok(result.candidates.every(({ factors }) => factors.slope.raw.maxPercent >= 9.9));
  assert.ok(result.candidates.every(({ factors }) => factors.slope.score < 100));
});

test('ошибочный реальный рельеф не подменяется устаревшим признаком flatTerrain', () => {
  const project = readySite();
  project.site.planning.flatTerrain = true;
  project.site.terrain = {
    points: [
      { id: 'a', x: 0, y: 0, z: 0 },
      { id: 'b', x: 25_000, y: 0, z: 500 },
      { id: 'c', x: 50_000, y: 0, z: 1_000 },
    ],
  };

  const passport = sitePassport(project);
  const result = siteOpportunity(project);
  assert.equal(passport.facts.terrain.status, 'error');
  assert.equal(result.status, 'partial');
  assert.ok(result.coverage < 1);
  assert.ok(result.candidates.every(({ factors }) => factors.slope.known === false));
});

test('каждая разреженная компонента рабочей зоны получает seed-пробу', () => {
  const project = readySite();
  project.site.boundary = [
    { x: 0, y: 0 }, { x: 1_000_000, y: 0 },
    { x: 1_000_000, y: 1_000_000 }, { x: 0, y: 1_000_000 },
  ];
  project.site.entry = { x: 0, y: 0, angle: 0 };
  project.site.neighbors = [
    { id: 'vertical', x: 500_000, y: 500_000, w: 964_000, h: 1_000_000, rot: 0 },
    { id: 'horizontal', x: 500_000, y: 500_000, w: 1_000_000, h: 964_000, rot: 0 },
  ];
  project.site.planning.contextReviewed = true;
  project.site.planning.referenceFootprint = { width: 2_000, depth: 2_000, rotation: 0 };

  const first = siteOpportunity(project);
  const second = siteOpportunity(project);
  assert.equal(first.geometry.length, 4);
  assert.equal(first.status, 'ready');
  assert.ok(first.cells.length <= 500);
  assert.ok(first.candidates.length > 0);
  for (const polygon of first.geometry) {
    assert.ok(first.cells.some((cell) => !cell.blocked
      && cell.seed && pointInPolygon([polygon], { x: cell.x, y: cell.y })));
  }
  assert.deepEqual(second, first);
});

test('подтверждения и ориентировочное пятно переживают сохранение проекта', () => {
  const project = readySite();
  const loaded = deserializeProject(serializeProject(project));

  assert.deepEqual(loaded.site.planning, project.site.planning);
  assert.deepEqual(siteOpportunity(loaded).referenceFootprint, project.site.planning.referenceFootprint);
});

test('явное решение маршрута считается содержимым проекта', () => {
  const project = createProject();
  assert.equal(hasContent(project), false);
  project.site.planning.withoutUnderlay = true;
  assert.equal(hasContent(project), true);
});

test('расчёт детерминирован и не мутирует проект', () => {
  const project = readySite();
  const before = JSON.stringify(project);
  const first = siteOpportunity(project);
  const second = siteOpportunity(project);

  assert.deepEqual(second, first);
  assert.equal(JSON.stringify(project), before);
});
