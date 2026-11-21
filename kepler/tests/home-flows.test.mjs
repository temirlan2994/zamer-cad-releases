import test from 'node:test';
import assert from 'node:assert/strict';

import { analyzeHomeFlows } from '../core/home-flows.js';
import {
  createLevel, createOpening, createProject, createRoom,
} from '../core/model.js';

function room(level, id, type, x, y = 0, w = 3000, h = 3000) {
  const value = createRoom(type, x, y, w, h);
  value.id = id;
  level.rooms.push(value);
  return value;
}

function door(level, id, owner, side = 1, offset = 1500, width = 900) {
  const value = createOpening('door', owner.id, side, offset, width);
  value.id = id;
  level.openings.push(value);
  return value;
}

function activeScenario(id, overrides = {}) {
  return {
    scenarioId: id,
    enabled: true,
    mandatory: false,
    actorPersonIds: [],
    frequencyValue: null,
    frequencyPeriod: null,
    ...overrides,
  };
}

function binding(scenarioId, routeId, from, to, instanceId = 'main') {
  return {
    scenarioId, routeId, instanceId,
    from: { levelId: from.levelId, roomId: from.roomId },
    to: { levelId: to.levelId, roomId: to.roomId },
    sourceRef: 'test',
  };
}

const point = (levelId, roomId) => ({ levelId, roomId });

test('зоны берутся из каталога, неизвестный тип остаётся unknown', () => {
  const project = createProject('Зоны');
  room(project.levels[0], 'living', 'living', 0);
  room(project.levels[0], 'wet', 'bathroom', 3100);
  room(project.levels[0], 'mystery', 'future-room', 6200);

  const result = analyzeHomeFlows(project);
  assert.equal(result.status, 'unknown', 'наличие комнат не включает сценарии');
  assert.deepEqual(result.zones.rooms.map(({ roomId, zoneId, status }) => ({ roomId, zoneId, status })), [
    { roomId: 'living', zoneId: 'living', status: 'known' },
    { roomId: 'wet', zoneId: 'wet', status: 'known' },
    { roomId: 'mystery', zoneId: 'unknown', status: 'unknown' },
  ]);
  assert.equal(result.summary.classifiedRoomCount, 2);
  assert.equal(result.summary.unknownZoneCount, 1);
});
test('активный сценарий без явной привязки не создаёт выдуманный маршрут', () => {
  const project = createProject('Без привязки');
  room(project.levels[0], 'entry', 'entrance', 0);
  room(project.levels[0], 'living', 'living', 3100);
  door(project.levels[0], 'door-entry-living', project.levels[0].rooms[0]);
  project.layoutBrief = { scenarioSelections: [activeScenario('SCN001')] };

  const result = analyzeHomeFlows(project);
  assert.equal(result.summary.activeScenarioCount, 1);
  assert.equal(result.scenarios[0].routes.length, 2);
  assert.ok(result.scenarios[0].routes.every((route) => route.reasonCode === 'unknown_binding'));
  assert.ok(result.transitionLoads.every((transition) => transition.scenarioRouteCount === 0));
});

test('явная привязка использует реальную дверь и агрегирует только явную частоту', () => {
  const project = createProject('Прямой маршрут');
  const level = project.levels[0];
  const entry = room(level, 'entry', 'entrance', 0);
  room(level, 'living', 'living', 3100);
  door(level, 'door-entry-living', entry);
  project.layoutBrief = {
    scenarioSelections: [activeScenario('SCN001', { frequencyValue: 2, frequencyPeriod: 'week' })],
    scenarioRouteBindings: [
      binding('SCN001', 'entry_to_seat', point('L1', 'entry'), point('L1', 'entry')),
      {
        ...binding('SCN001', 'entry_to_clean', point('L1', 'entry'), point('L1', 'living')),
        actorPersonId: 'person-1',
      },
    ],
  };

  const result = analyzeHomeFlows(project);
  const [sameRoom, direct] = result.scenarios[0].routes;
  assert.equal(sameRoom.status, 'co_located');
  assert.equal(sameRoom.physicalPathStatus, 'unknown');
  assert.equal(direct.status, 'direct');
  assert.equal(direct.actorPersonId, 'person-1');
  assert.deepEqual(direct.pathRoomKeys, ['L1:entry', 'L1:living']);
  assert.equal(result.transitionLoads.length, 1);
  assert.deepEqual(result.transitionLoads[0].openingIds, ['door-entry-living']);
  assert.equal(result.transitionLoads[0].scenarioRouteCount, 1);
  assert.deepEqual(result.transitionLoads[0].frequencyByPeriod, { week: 2 });
  assert.equal(result.roomLoads.find((load) => load.roomId === 'entry').scenarioRouteCount, 2);
});

test('цепочка дверей даёт reachable, а общая стена без двери — missing', () => {
  const project = createProject('Цепочка');
  const level = project.levels[0];
  const a = room(level, 'a', 'bedroom', 0);
  const corridor = room(level, 'corridor', 'corridor', 3100);
  room(level, 'b', 'bathroom', 6200);
  door(level, 'door-a-corridor', a);
  door(level, 'door-corridor-b', corridor);
  project.layoutBrief = {
    scenarioSelections: [activeScenario('SCN013')],
    scenarioRouteBindings: [
      binding('SCN013', 'bed_to_bathroom', point('L1', 'a'), point('L1', 'b')),
      binding('SCN013', 'bed_to_seat', point('L1', 'a'), point('L1', 'a')),
    ],
  };

  let result = analyzeHomeFlows(project);
  const route = result.scenarios[0].routes.find((entry) => entry.routeId === 'bed_to_bathroom');
  assert.equal(route.status, 'reachable');
  assert.deepEqual(route.pathRoomKeys, ['L1:a', 'L1:corridor', 'L1:b']);
  assert.equal(result.roomLoads.find((load) => load.roomId === 'corridor').transitCount, 1);

  level.openings = level.openings.filter((opening) => opening.id !== 'door-corridor-b');
  result = analyzeHomeFlows(project);
  const broken = result.scenarios[0].routes.find((entry) => entry.routeId === 'bed_to_bathroom');
  assert.equal(broken.status, 'missing');
  assert.ok(['adjacent_without_door', 'no_passage'].includes(broken.reasonCode));
});

test('окно не создаёт переход между комнатами', () => {
  const project = createProject('Окно');
  const level = project.levels[0];
  const a = room(level, 'a', 'living', 0);
  room(level, 'b', 'terrace', 3100);
  const window = createOpening('window', a.id, 1, 1500, 1200);
  window.id = 'window-only';
  level.openings.push(window);
  project.layoutBrief = {
    scenarioSelections: [activeScenario('SCN017')],
    scenarioRouteBindings: [
      binding('SCN017', 'summer_terrace', point('L1', 'a'), point('L1', 'b')),
      binding('SCN017', 'winter_main', point('L1', 'a'), point('L1', 'a')),
      binding('SCN017', 'season_storage', point('L1', 'a'), point('L1', 'a')),
    ],
  };
  const route = analyzeHomeFlows(project).scenarios[0].routes
    .find((entry) => entry.routeId === 'summer_terrace');
  assert.equal(route.status, 'missing');
  assert.equal(route.reasonCode, 'adjacent_without_door');
});

test('межэтажная привязка остаётся unknown даже при комнатах лестницы', () => {
  const project = createProject('Этажи');
  room(project.levels[0], 'bed', 'bedroom', 0);
  room(project.levels[0], 'stairs-1', 'stairs-room', 3100);
  project.levels.push(createLevel('2 этаж', 3000, 3000, 'L2'));
  room(project.levels[1], 'stairs-2', 'stairs-room', 0);
  room(project.levels[1], 'bath', 'bathroom', 3100);
  project.layoutBrief = {
    scenarioSelections: [activeScenario('SCN013')],
    scenarioRouteBindings: [
      binding('SCN013', 'bed_to_bathroom', point('L1', 'bed'), point('L2', 'bath')),
      binding('SCN013', 'bed_to_seat', point('L1', 'bed'), point('L1', 'bed')),
    ],
  };
  const route = analyzeHomeFlows(project).scenarios[0].routes
    .find((entry) => entry.routeId === 'bed_to_bathroom');
  assert.equal(route.status, 'unknown');
  assert.equal(route.reasonCode, 'vertical_connector_unknown');
  assert.equal(route.topologyEvidence, null);
});

test('удалённая комната даёт missing, disabled сценарий не даёт нагрузки', () => {
  const project = createProject('Сломанная привязка');
  room(project.levels[0], 'entry', 'entrance', 0);
  project.layoutBrief = {
    scenarioSelections: [activeScenario('SCN001')],
    scenarioRouteBindings: [
      binding('SCN001', 'entry_to_clean', point('L1', 'entry'), point('L1', 'deleted')),
    ],
  };
  let result = analyzeHomeFlows(project);
  assert.equal(result.scenarios[0].routes.find((route) => route.routeId === 'entry_to_clean').reasonCode, 'missing_endpoint');

  project.layoutBrief.scenarioSelections[0].enabled = false;
  result = analyzeHomeFlows(project);
  assert.equal(result.scenarios.length, 0);
  assert.equal(result.summary.activeScenarioCount, 0);
  assert.ok(result.roomLoads.every((load) => load.scenarioRouteCount === 0));
});

test('частоты разных периодов не смешиваются и actor ids не являются множителем', () => {
  const project = createProject('Частоты');
  const level = project.levels[0];
  const a = room(level, 'a', 'entrance', 0);
  room(level, 'b', 'living', 3100);
  door(level, 'door-ab', a);
  project.layoutBrief = {
    scenarioSelections: [
      activeScenario('SCN001', {
        actorPersonIds: ['p1', 'p2', 'p3'], frequencyValue: 2, frequencyPeriod: 'week',
      }),
      activeScenario('SCN015', { frequencyValue: 1, frequencyPeriod: 'day' }),
    ],
    scenarioRouteBindings: [
      binding('SCN001', 'entry_to_seat', point('L1', 'a'), point('L1', 'a')),
      binding('SCN001', 'entry_to_clean', point('L1', 'a'), point('L1', 'b')),
      binding('SCN015', 'delivery_to_unpack', point('L1', 'a'), point('L1', 'b')),
    ],
  };
  const transition = analyzeHomeFlows(project).transitionLoads[0];
  assert.deepEqual(transition.frequencyByPeriod, { week: 2, day: 1 });
  assert.equal(transition.scenarioRouteCount, 2);
});

test('подтверждённая программа агрегирует все спальни, а не только representative', () => {
  const project = createProject('Все спальни');
  const level = project.levels[0];
  const entry = room(level, 'entry', 'entrance', 0);
  const social = room(level, 'social', 'kitchen-living', 3100);
  const bed1 = room(level, 'bed-1', 'bedroom', 6200);
  const corridor = room(level, 'corridor', 'corridor', 9300);
  room(level, 'bath', 'bathroom', 12400);
  const bed2 = room(level, 'bed-2', 'bedroom', 9300, 3100);
  door(level, 'd-entry-social', entry);
  door(level, 'd-social-bed1', social);
  door(level, 'd-bed1-corridor', bed1);
  door(level, 'd-corridor-bath', corridor);
  door(level, 'd-bed2-corridor', bed2, 0);
  door(level, 'd-outside', entry, 3);
  project.layoutBrief = {
    homeProgram: {
      confirmed: true,
      socialMode: 'combined',
      bedroomCount: 2,
      bathroomCount: 1,
      options: {
        guestBedroom: false, office: false, laundry: false, pantry: false,
        wardrobe: false, guestWc: false, garage: false, terrace: false,
      },
    },
  };

  const result = analyzeHomeFlows(project);
  const bedroomRoutes = result.functionalRoutes.filter((route) => route.connectionId === 'bedroom-bathroom');
  assert.equal(bedroomRoutes.length, 2);
  assert.deepEqual(new Set(bedroomRoutes.map((route) => route.fromRoomKey)), new Set(['L1:bed-1', 'L1:bed-2']));
  assert.ok(result.roomLoads.find((load) => load.roomId === 'corridor').requirementCount >= 2);
});

test('ошибка обязательной программы видна без выбранных сценариев, зоны считаются как группы', () => {
  const project = createProject('Неполная программа');
  room(project.levels[0], 'entry', 'entrance', 0);
  room(project.levels[0], 'living', 'living', 3100);
  project.layoutBrief = {
    homeProgram: {
      confirmed: true,
      socialMode: 'combined',
      bedroomCount: 1,
      bathroomCount: 1,
      options: {
        guestBedroom: false, office: false, laundry: false, pantry: false,
        wardrobe: false, guestWc: false, garage: false, terrace: false,
      },
    },
  };

  const result = analyzeHomeFlows(project);
  assert.equal(result.summary.activeScenarioCount, 0);
  assert.equal(result.status, 'incomplete');
  assert.ok(result.summary.functionalProblemCount > 0);
  assert.equal(result.summary.zoneCount, 2);
});
