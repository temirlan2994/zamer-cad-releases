// Явные привязки абстрактных маршрутов сценариев к помещениям.

import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeHomeFlows } from '../core/home-flows.js';
import {
  createLayoutBrief, ensureLayoutBrief, layoutBriefIsEmpty, normalizeLayoutBrief,
} from '../core/layout-brief.js';
import {
  createItem, createOpening, createProject, createRoom, deserializeProject, serializeProject,
} from '../core/model.js';

function projectWithRooms() {
  const project = createProject('Привязки маршрутов');
  const bedroom = createRoom('bedroom', 0, 0, 3600, 3200);
  const entrance = createRoom('entrance', 3700, 0, 2600, 2200);
  project.rooms.push(bedroom, entrance);
  return { project, bedroom, entrance, levelId: project.activeLevel };
}

test('валидная привязка маршрута переживает сохранение и открытие проекта', () => {
  const { project, bedroom, entrance, levelId } = projectWithRooms();
  project.layoutBrief = {
    scenarioSelections: [{ scenarioId: 'SCN014', enabled: true, mandatory: true }],
    scenarioRouteBindings: [{
      scenarioId: 'SCN014',
      routeId: 'bed_to_door',
      instanceId: 'ночной-выход',
      from: { levelId, roomId: bedroom.id },
      to: { levelId, roomId: entrance.id },
      sourceRef: 'user',
    }],
  };

  const loaded = deserializeProject(serializeProject(project));
  assert.deepEqual(loaded.layoutBrief.scenarioRouteBindings, [{
    scenarioId: 'SCN014',
    routeId: 'bed_to_door',
    instanceId: 'ночной-выход',
    from: { levelId, roomId: bedroom.id },
    to: { levelId, roomId: entrance.id },
    actorPersonId: null,
    sourceRef: 'user',
  }]);
});

test('snake_case и старые имена конечных точек нормализуются', () => {
  const brief = normalizeLayoutBrief({
    scenario_route_bindings: [{
      scenario_id: 'SCN017',
      route_id: 'summer_terrace',
      instance_id: 'лето',
      from_endpoint: { level_id: 'L1', room_id: 'R1' },
      to_endpoint: { level_id: 'L1', room_id: 'R2' },
      actor_person_id: 'A1',
      source_ref: 'опрос',
    }],
    actors: [{ id: 'A1', alias: 'Жилец' }],
  }, { levelIds: ['L1'], roomIds: ['R1', 'R2'] });

  assert.deepEqual(brief.scenarioRouteBindings, [{
    scenarioId: 'SCN017',
    routeId: 'summer_terrace',
    instanceId: 'лето',
    from: { levelId: 'L1', roomId: 'R1' },
    to: { levelId: 'L1', roomId: 'R2' },
    actorPersonId: 'A1',
    sourceRef: 'опрос',
  }]);
});

test('неизвестные scenario_id и route_id не попадают в задание', () => {
  const brief = normalizeLayoutBrief({
    scenarioRouteBindings: [
      { scenarioId: 'SCN999', routeId: 'bed_to_door' },
      { scenarioId: 'SCN014', routeId: 'unknown_route' },
      {
        scenarioId: 'SCN014', routeId: 'bed_to_door',
        from: { levelId: 'L1', roomId: 'R1' },
        to: { levelId: 'L1', roomId: 'R2' },
      },
    ],
  }, { levelIds: ['L1'], roomIds: ['R1', 'R2'] });

  assert.equal(brief.scenarioRouteBindings.length, 1);
  assert.equal(brief.scenarioRouteBindings[0].scenarioId, 'SCN014');
  assert.equal(brief.scenarioRouteBindings[0].routeId, 'bed_to_door');
});

test('ссылка на удалённую комнату очищается и остаётся безопасно missing', () => {
  const { project, entrance, levelId } = projectWithRooms();
  project.layoutBrief = {
    scenarioSelections: [{ scenarioId: 'SCN014', enabled: true, mandatory: true }],
    scenarioRouteBindings: [{
      scenarioId: 'SCN014', routeId: 'bed_to_door', instanceId: 'устаревший',
      from: { levelId, roomId: 'ROOM-DELETED' },
      to: { levelId, roomId: entrance.id },
    }],
  };

  const loaded = deserializeProject(serializeProject(project));
  const binding = loaded.layoutBrief.scenarioRouteBindings[0];
  assert.deepEqual(binding.from, { levelId, roomId: null });
  const route = analyzeHomeFlows(loaded).scenarios
    .find((scenario) => scenario.scenarioId === 'SCN014').routes
    .find((candidate) => candidate.routeId === 'bed_to_door');
  assert.equal(route.status, 'missing');
  assert.equal(route.reasonCode, 'missing_endpoint');
});

test('дубликаты instanceId получают стабильные уникальные имена', () => {
  const raw = {
    scenarioRouteBindings: [
      { scenarioId: 'SCN014', routeId: 'bed_to_door', instanceId: 'путь' },
      { scenarioId: 'SCN014', routeId: 'bed_to_door', instanceId: 'путь' },
    ],
  };
  const once = normalizeLayoutBrief(raw);
  const twice = normalizeLayoutBrief(once);
  assert.deepEqual(once.scenarioRouteBindings.map((entry) => entry.instanceId), ['путь', 'путь-2']);
  assert.deepEqual(twice.scenarioRouteBindings.map((entry) => entry.instanceId), ['путь', 'путь-2']);
});

test('одна привязка делает layoutBrief непустым, пустой список — нет', () => {
  const empty = createLayoutBrief();
  assert.equal(layoutBriefIsEmpty(empty), true);
  const brief = normalizeLayoutBrief({
    scenarioRouteBindings: [{ scenarioId: 'SCN014', routeId: 'bed_to_door' }],
  });
  assert.equal(layoutBriefIsEmpty(brief), false);
});

test('якоря предмета и проёма переживают сохранение и открытие проекта', () => {
  const { project, bedroom, entrance, levelId } = projectWithRooms();
  const bed = createItem('bed-double', 1200, 1200, 1800, 2100);
  bed.id = 'ITEM-BED';
  project.items.push(bed);
  const door = createOpening('door', entrance.id, 0, 900, 900);
  door.id = 'OPENING-ENTRY';
  project.openings.push(door);
  project.layoutBrief = {
    scenarioSelections: [{ scenarioId: 'SCN014', enabled: true, mandatory: true }],
    scenarioRouteBindings: [{
      scenarioId: 'SCN014', routeId: 'bed_to_door', instanceId: 'точный-путь',
      from: {
        levelId, roomId: bedroom.id, anchorType: 'item', anchorId: bed.id,
      },
      to: {
        levelId, roomId: entrance.id, anchorType: 'opening', anchorId: door.id,
      },
    }],
  };

  const loaded = deserializeProject(serializeProject(project));
  const binding = loaded.layoutBrief.scenarioRouteBindings[0];
  assert.deepEqual(binding.from, {
    levelId, roomId: bedroom.id, anchorType: 'item', anchorId: bed.id,
  });
  assert.deepEqual(binding.to, {
    levelId, roomId: entrance.id, anchorType: 'opening', anchorId: door.id,
  });
});

test('snake_case и вложенный anchor нормализуются в плоские поля', () => {
  const brief = normalizeLayoutBrief({
    scenario_route_bindings: [{
      scenario_id: 'SCN014', route_id: 'bed_to_door',
      from_endpoint: {
        level_id: 'L1', room_id: 'R1', anchor_type: 'item', anchor_id: 'I1',
      },
      to_endpoint: {
        level_id: 'L1', room_id: 'R2', anchor: { kind: 'opening', id: 'O1' },
      },
    }],
  }, {
    levelIds: ['L1'], roomIds: ['R1', 'R2'], itemIds: ['I1'], openingIds: ['O1'],
  });

  assert.deepEqual(brief.scenarioRouteBindings[0].from, {
    levelId: 'L1', roomId: 'R1', anchorType: 'item', anchorId: 'I1',
  });
  assert.deepEqual(brief.scenarioRouteBindings[0].to, {
    levelId: 'L1', roomId: 'R2', anchorType: 'opening', anchorId: 'O1',
  });
});

test('удалённые и пустые якоря очищаются, помещения сохраняются', () => {
  const brief = normalizeLayoutBrief({
    scenarioRouteBindings: [{
      scenarioId: 'SCN014', routeId: 'bed_to_door',
      from: {
        levelId: 'L1', roomId: 'R1', anchorType: 'item', anchorId: 'ITEM-DELETED',
      },
      to: {
        levelId: 'L1', roomId: 'R2', anchorType: 'opening', anchorId: '',
      },
    }],
  }, {
    levelIds: ['L1'], roomIds: ['R1', 'R2'], itemIds: ['I1'], openingIds: ['O1'],
  });

  assert.deepEqual(brief.scenarioRouteBindings[0].from, { levelId: 'L1', roomId: 'R1' });
  assert.deepEqual(brief.scenarioRouteBindings[0].to, { levelId: 'L1', roomId: 'R2' });
});

test('ensureLayoutBrief очищает якорь, удалённый из проекта', () => {
  const { project, bedroom, entrance, levelId } = projectWithRooms();
  project.layoutBrief = {
    scenarioRouteBindings: [{
      scenarioId: 'SCN014', routeId: 'bed_to_door',
      from: {
        levelId, roomId: bedroom.id, anchorType: 'item', anchorId: 'ITEM-DELETED',
      },
      to: {
        levelId, roomId: entrance.id, anchorType: 'opening', anchorId: 'OPENING-DELETED',
      },
    }],
  };

  const binding = ensureLayoutBrief(project).scenarioRouteBindings[0];
  assert.deepEqual(binding.from, { levelId, roomId: bedroom.id });
  assert.deepEqual(binding.to, { levelId, roomId: entrance.id });
});
