// Внешние исходные данные авторасстановки: нормализация, готовность и файл.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createLayoutBrief, layoutBriefIsEmpty, layoutBriefReadiness,
  normalizeCatalogItemMetadata, normalizeLayoutBrief,
} from '../core/layout-brief.js';
import {
  createItem, createProject, deserializeProject, serializeProject,
} from '../core/model.js';

test('пустое задание совместимо со старым проектом, null отличается от подтверждённого []', () => {
  const empty = createLayoutBrief();
  assert.equal(layoutBriefIsEmpty(empty), true);
  assert.equal(empty.fixedEngineering, null);
  assert.equal(empty.storageInventory, null);
  assert.deepEqual(empty.capacity, {
    dailySeats: null, guestSeats: null, simultaneousCooks: null,
  });
  assert.deepEqual(empty.scenarioSelections, []);

  const confirmedNone = normalizeLayoutBrief({ fixedEngineering: [], storageInventory: [] });
  assert.equal(layoutBriefIsEmpty(confirmedNone), false);
  assert.deepEqual(confirmedNone.fixedEngineering, []);
  assert.deepEqual(confirmedNone.storageInventory, []);

  const oldProject = deserializeProject(serializeProject(createProject('Старый')));
  assert.equal('layoutBrief' in oldProject, false);
});

test('нормализация чистит enum, дубликаты id и ссылки на удалённые объекты', () => {
  const brief = normalizeLayoutBrief({
    actors: [
      { id: 'A1', alias: 'Первый', mobilityProfile: 'standard', dataStatus: 'declared' },
      { id: 'A1', alias: 'Второй', mobilityProfile: 'телепорт', dataStatus: 'точно' },
    ],
    capacity: { dailySeats: '4', guestSeats: -2, simultaneousCooks: '2' },
    fixedEngineering: [{
      id: 'E1', kind: 'outlet', levelId: 'missing', roomId: 'R1', x: '120', y: 300,
      equipmentItemIds: ['I1', 'missing'], dataStatus: 'measured', clearanceMm: -1,
    }],
    storageInventory: [{
      id: 'S1', category: 'одежда', count: '12', ownerActorIds: ['A1', 'missing'],
      roomIds: ['R1', 'missing'], frequency: 'daily', dataStatus: 'declared',
    }],
    scenarioSelections: [
      { scenarioId: 'SCN003', enabled: true, mandatory: true, actorPersonIds: ['A1', 'missing'] },
      { scenarioId: 'SCN999', enabled: true },
      { scenarioId: 'SCN003', enabled: false },
    ],
  }, { levelIds: ['L1'], roomIds: ['R1'], itemIds: ['I1'] });

  assert.deepEqual(brief.actors.map((actor) => actor.id), ['A1', 'A1-2']);
  assert.equal(brief.actors[1].mobilityProfile, 'unknown');
  assert.equal(brief.actors[1].dataStatus, 'unknown');
  assert.deepEqual(brief.capacity, { dailySeats: 4, guestSeats: null, simultaneousCooks: 2 });
  assert.equal(brief.fixedEngineering[0].levelId, null);
  assert.equal(brief.fixedEngineering[0].roomId, 'R1');
  assert.equal(brief.fixedEngineering[0].clearanceMm, null);
  assert.deepEqual(brief.fixedEngineering[0].equipmentItemIds, ['I1']);
  assert.deepEqual(brief.storageInventory[0].ownerActorIds, ['A1']);
  assert.deepEqual(brief.storageInventory[0].roomIds, ['R1']);
  assert.equal(brief.storageInventory[0].count, 12);
  assert.deepEqual(brief.scenarioSelections, [{
    scenarioId: 'SCN003', enabled: true, mandatory: true, actorPersonIds: ['A1'],
    frequencyValue: null, frequencyPeriod: null, specificRequirements: null, sourceRef: null,
  }]);

  assert.equal(normalizeLayoutBrief({
    capacity: { simultaneousCooks: 0 },
  }).capacity.simultaneousCooks, null);
});

test('layoutBrief и паспортные поля мебели переживают файл kepler-plan/7', () => {
  const project = createProject('Исходные данные');
  const item = createItem('fridge', 1000, 1200, 700, 700);
  Object.assign(item, {
    manufacturer: 'Factory',
    sku: 'FR-42',
    sourceUrl: 'https://example.test/fr-42',
    geometryStatus: 'verified_sku',
    planProjectionVerified: true,
    manualStatus: 'verified',
    manualConstraints: [{
      id: 'manual-1', status: 'verified', requirement: 'Вентиляционный зазор',
      sourceRef: 'стр. 8', clearances: { backMm: 50, topMm: 100 },
    }],
  });
  project.items.push(item);
  project.layoutBrief = {
    actors: [{ id: 'A1', alias: 'Жилец', heightMm: 1750, mobilityProfile: 'standard', dataStatus: 'declared' }],
    capacity: { dailySeats: 1, guestSeats: 0, simultaneousCooks: 1 },
    fixedEngineering: [],
    storageInventory: [],
    uncertainty: [{ id: 'U1', scope: 'site', fieldPath: 'site.neighbors', status: 'unknown', note: 'Нет съёмки' }],
    scenarioSelections: [{ scenarioId: 'SCN014', enabled: true, mandatory: true, actorPersonIds: ['A1'] }],
  };

  const loaded = deserializeProject(serializeProject(project));
  assert.equal(loaded.layoutBrief.version, 1);
  assert.equal(loaded.layoutBrief.actors[0].alias, 'Жилец');
  assert.equal(loaded.layoutBrief.capacity.simultaneousCooks, 1);
  assert.deepEqual(loaded.layoutBrief.fixedEngineering, []);
  assert.deepEqual(loaded.layoutBrief.storageInventory, []);
  assert.equal(loaded.layoutBrief.scenarioSelections[0].scenarioId, 'SCN014');
  assert.deepEqual(loaded.layoutBrief.scenarioSelections[0].actorPersonIds, ['A1']);
  assert.equal(loaded.items[0].geometryStatus, 'verified_sku');
  assert.equal(loaded.items[0].planProjectionVerified, true);
  assert.equal(loaded.items[0].manualConstraints[0].clearances.backMm, 50);
});

test('SKU сам по себе не означает проверенную геометрию или паспорт', () => {
  const normalized = normalizeCatalogItemMetadata({ sku: 'ABC-1' });
  assert.equal(normalized.sku, 'ABC-1');
  assert.equal(normalized.geometryStatus, undefined);
  assert.equal(normalized.manualStatus, undefined);
  assert.equal(normalized.planProjectionVerified, undefined);
  assert.equal(normalizeCatalogItemMetadata({ planProjectionVerified: 'да' }).planProjectionVerified, false);
  assert.equal(normalizeCatalogItemMetadata({ planProjectionVerified: true }).planProjectionVerified, true);

  const project = createProject('Готовность');
  const item = createItem('chair', 500, 500, 500, 500);
  item.sku = 'ABC-1';
  project.items.push(item);
  project.site.solarVerified = true;
  project.layoutBrief = {
    actors: [{ id: 'A1', alias: 'Жилец', heightMm: 1750, mobilityProfile: 'standard', dataStatus: 'declared' }],
    capacity: { dailySeats: 1, guestSeats: 0 },
    fixedEngineering: [],
    storageInventory: [],
  };

  let readiness = layoutBriefReadiness(project);
  assert.equal(readiness.sections.find((section) => section.id === 'capacity').status, 'partial');
  assert.equal(readiness.sections.find((section) => section.id === 'manuals').status, 'missing');
  assert.equal(readiness.complete, false);

  project.layoutBrief.capacity.simultaneousCooks = 1;
  readiness = layoutBriefReadiness(project);
  assert.equal(readiness.sections.find((section) => section.id === 'capacity').status, 'ready');

  Object.assign(item, {
    geometryStatus: 'verified_sku',
    sourceUrl: 'https://example.test/abc-1',
    manualStatus: 'not_required',
  });
  readiness = layoutBriefReadiness(project);
  assert.equal(readiness.sections.find((section) => section.id === 'manuals').status, 'missing');
  assert.equal(readiness.complete, false);

  item.planProjectionVerified = true;
  readiness = layoutBriefReadiness(project);
  assert.equal(readiness.sections.find((section) => section.id === 'manuals').status, 'ready');
  assert.equal(readiness.complete, true);
});

test('нестандартная мобильность остаётся частичной без габарита пользователя', () => {
  const project = createProject('Доступность');
  project.layoutBrief = {
    actors: [{ id: 'A1', alias: 'Жилец', heightMm: 1700, mobilityProfile: 'wheelchair', dataStatus: 'measured' }],
    capacity: { dailySeats: 1, guestSeats: 0, simultaneousCooks: 1 },
    fixedEngineering: [],
    storageInventory: [],
  };
  project.site.solarVerified = true;

  let section = layoutBriefReadiness(project).sections.find((entry) => entry.id === 'accessibility');
  assert.equal(section.status, 'partial');
  project.layoutBrief.actors[0].bodyWidthMm = 750;
  project.layoutBrief.actors[0].bodyDepthMm = 1200;
  section = layoutBriefReadiness(project).sections.find((entry) => entry.id === 'accessibility');
  assert.equal(section.status, 'ready');
});
