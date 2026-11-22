// Проектный оркестратор авторасстановки: этажи, seed-мебель, locks и бюджеты.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  applyWholeHomeLayout, planWholeHomeLayout, StaleWholeHomeLockError,
} from '../core/whole-home-layout.js';
import {
  createItem, createLevel, createOpening, createProject, createRoom,
} from '../core/model.js';

function addRoom(level, type, x, y, w, h) {
  const room = createRoom(type, x, y, w, h);
  level.rooms.push(room);
  level.openings.push(createOpening('door', room.id, 2, w / 2, 900));
  return room;
}

function twoLevelEmptyProject() {
  const project = createProject('Весь дом');
  const first = project.levels[0];
  const second = createLevel('2 этаж', 3000, 3000, 'L2');
  project.levels.push(second);
  const bedroom = addRoom(first, 'bedroom', 0, 0, 6200, 5000);
  const cabinet = addRoom(second, 'cabinet', 0, 0, 6000, 4800);
  return { project, bedroom, cabinet };
}

const fastRoomSearch = {
  beamWidth: 32,
  candidatesPerItem: 12,
  maxBasePoses: 48,
};

test('детерминированно обходит этажи, меблирует пустые комнаты и не меняет проект', () => {
  const { project } = twoLevelEmptyProject();
  const before = JSON.stringify(project);
  const options = { count: 2, roomOptions: fastRoomSearch };
  const first = planWholeHomeLayout(project, options);
  const second = planWholeHomeLayout(project, options);

  assert.equal(first.status, 'feasible', first.diagnostics.join('; '));
  assert.equal(first.rooms.length, 2);
  assert.equal(first.summary.seededRooms, 2);
  assert.ok(first.summary.seedItems > 0);
  assert.ok(first.variants.length > 0);
  assert.deepEqual(first, second);
  assert.equal(JSON.stringify(project), before);

  for (const variant of first.variants) {
    assert.equal(variant.complete, true);
    assert.equal(variant.rooms.length, 2);
    assert.ok(variant.seedItems.length > 0);
    const poses = new Map(variant.placements.map((pose) => [pose.itemId, pose]));
    for (const seed of variant.seedItems) {
      const pose = poses.get(seed.id);
      assert.ok(pose, `нет позиции seed-предмета ${seed.id}`);
      assert.deepEqual(
        { x: seed.x, y: seed.y, rotation: seed.rotation },
        { x: pose.x, y: pose.y, rotation: pose.rotation },
      );
    }
  }
});

test('сохраняет абсолютные locks во всех вариантах комнаты и проекта', () => {
  const project = createProject('Locks');
  const room = addRoom(project.levels[0], 'bedroom', 0, 0, 6200, 5000);
  const bed = createItem('bed-double', 3100, 2500, 1600, 2000);
  const wardrobe = createItem('wardrobe', 900, 4700, 1800, 600, 180);
  const dresser = createItem('dresser', 5000, 2500, 1000, 450);
  project.levels[0].items.push(bed, wardrobe, dresser);

  const result = planWholeHomeLayout(project, {
    count: 3,
    lockedIds: [wardrobe.id],
    roomOptions: fastRoomSearch,
  });

  assert.equal(result.status, 'feasible', result.diagnostics.join('; '));
  assert.deepEqual(result.rooms[0].lockedIds, [wardrobe.id]);
  assert.deepEqual(result.rooms[0].lockedPlacements[0], {
    itemId: wardrobe.id,
    levelId: project.levels[0].id,
    roomId: room.id,
    x: 900,
    y: 4700,
    rotation: 180,
  });
  for (const variant of result.variants) {
    const pose = variant.placements.find((entry) => entry.itemId === wardrobe.id);
    assert.deepEqual(
      { x: pose.x, y: pose.y, rotation: pose.rotation },
      { x: 900, y: 4700, rotation: 180 },
    );
  }
});

test('maxRooms завершает обход явным статусом бюджета и не выдаёт неполный вариант', () => {
  const { project } = twoLevelEmptyProject();
  const result = planWholeHomeLayout(project, {
    count: 1,
    maxRooms: 1,
    roomOptions: fastRoomSearch,
  });

  assert.equal(result.status, 'search_budget_exhausted');
  assert.equal(result.rooms.length, 1);
  assert.deepEqual(result.variants, []);
  assert.equal(result.budget.exhausted, true);
  assert.equal(result.budget.reason, 'max_rooms');
  assert.equal(result.summary.unprocessedRooms, 1);
  assert.equal(result.summary.complete, false);
});

test('shouldCancel останавливает синхронный обход между комнатами', () => {
  const { project } = twoLevelEmptyProject();
  const events = [];
  const result = planWholeHomeLayout(project, {
    count: 1,
    roomOptions: fastRoomSearch,
    onProgress: (event) => events.push(event.phase),
    shouldCancel: ({ phase, roomsVisited }) => phase === 'rooms' && roomsVisited >= 1,
  });

  assert.equal(result.status, 'cancelled');
  assert.equal(result.rooms.length, 1);
  assert.deepEqual(result.variants, []);
  assert.equal(result.budget.cancelled, true);
  assert.equal(result.budget.reason, 'cancelled');
  assert.ok(events.includes('rooms'));
});

test('seedEmptyRooms=false оставляет допустимое пустое помещение без seed-предметов', () => {
  const project = createProject('Пустой коридор');
  const room = addRoom(project.levels[0], 'corridor', 0, 0, 5000, 1400);
  const result = planWholeHomeLayout(project, {
    count: 1,
    seedEmptyRooms: false,
    roomIds: [room.id],
  });

  assert.equal(result.status, 'feasible', result.diagnostics.join('; '));
  assert.equal(result.rooms[0].status, 'empty');
  assert.deepEqual(result.rooms[0].seedItems, []);
  assert.equal(result.variants.length, 1);
  assert.deepEqual(result.variants[0].placements, []);
});

test('явно выбранные сценарии входят в отчёт и без evidence остаются pending', () => {
  const project = createProject('Сценарный отчёт');
  const room = addRoom(project.levels[0], 'corridor', 0, 0, 5000, 1400);
  project.layoutBrief = {
    version: 1,
    actors: [], capacity: { dailySeats: null, guestSeats: null },
    fixedEngineering: null, storageInventory: null, uncertainty: [],
    scenarioSelections: [{ scenarioId: 'SCN003', enabled: true, mandatory: true, actorPersonIds: [] }],
  };
  const result = planWholeHomeLayout(project, {
    count: 1, seedEmptyRooms: false, roomIds: [room.id],
  });
  assert.equal(result.scenarioEvaluation.summary.active, 1);
  assert.equal(result.scenarioEvaluation.summary.readiness, 'pending');
  assert.deepEqual(result.scenarioEvaluation.summary.mandatory.unknown, ['SCN003']);
});

test('атомарное применение добавляет seedItems без дублей и расставляет их по этажам', () => {
  const { project } = twoLevelEmptyProject();
  const planned = planWholeHomeLayout(project, {
    count: 1,
    roomOptions: fastRoomSearch,
  });
  assert.equal(planned.status, 'feasible', planned.diagnostics.join('; '));
  const variant = planned.variants[0];

  const applied = applyWholeHomeLayout(project, variant);
  assert.equal(applied.added.length, variant.seedItems.length);
  assert.equal(applied.moved.length, variant.placements.length);
  for (const pose of variant.placements) {
    const level = project.levels.find((entry) => entry.id === pose.levelId);
    const item = level.items.find((entry) => entry.id === pose.itemId);
    assert.deepEqual(
      { x: item.x, y: item.y, rotation: item.rotation },
      { x: pose.x, y: pose.y, rotation: pose.rotation },
    );
  }

  const counts = project.levels.map((level) => level.items.length);
  const repeated = applyWholeHomeLayout(project, variant);
  assert.deepEqual(repeated.added, []);
  assert.deepEqual(project.levels.map((level) => level.items.length), counts);
  assert.equal(repeated.skipped.filter((entry) => entry.reason === 'seed_exists').length, variant.seedItems.length);
});

test('устаревший lock отклоняет применение до добавления или перемещения мебели', () => {
  const project = createProject('Stale lock');
  const room = addRoom(project.levels[0], 'bedroom', 0, 0, 6200, 5000);
  addRoom(project.levels[0], 'cabinet', 8000, 0, 6000, 4800);
  const bed = createItem('bed-double', 3100, 2500, 1600, 2000);
  const wardrobe = createItem('wardrobe', 900, 4700, 1800, 600, 180);
  project.levels[0].items.push(bed, wardrobe);
  const planned = planWholeHomeLayout(project, {
    count: 1,
    lockedIdsByRoom: { [room.id]: [wardrobe.id] },
    roomOptions: fastRoomSearch,
  });
  assert.equal(planned.status, 'feasible', planned.diagnostics.join('; '));
  assert.ok(planned.variants[0].seedItems.length > 0);

  wardrobe.x += 100;
  const beforeApply = JSON.stringify(project);
  assert.throws(
    () => applyWholeHomeLayout(project, planned.variants[0]),
    (error) => error instanceof StaleWholeHomeLockError
      && error.code === 'STALE_LAYOUT_LOCK'
      && error.itemIds.includes(wardrobe.id),
  );
  assert.equal(JSON.stringify(project), beforeApply);
});
