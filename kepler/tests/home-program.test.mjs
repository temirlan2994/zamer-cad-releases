import test from 'node:test';
import assert from 'node:assert/strict';
import {
  analyzeHomeProgram, normalizeHomeProgram, suggestHomeProgram,
} from '../core/home-program.js';
import {
  createLevel, createOpening, createProject, createRoom, deserializeProject, hasContent, serializeProject,
} from '../core/model.js';

const resolvedOptions = (overrides = {}) => ({
  guestBedroom: false,
  office: false,
  laundry: false,
  pantry: false,
  wardrobe: false,
  guestWc: false,
  garage: false,
  terrace: false,
  ...overrides,
});

function confirmedProgram(overrides = {}) {
  return {
    confirmed: true,
    socialMode: 'combined',
    bedroomCount: 1,
    bathroomCount: 1,
    options: resolvedOptions(),
    ...overrides,
  };
}

function addDocked(level, types) {
  const rooms = types.map((type, index) => createRoom(type, index * 3100, 0, 3000, 3000));
  level.rooms.push(...rooms);
  return rooms;
}

function connectChain(level, rooms) {
  for (let index = 0; index < rooms.length - 1; index += 1) {
    level.openings.push(createOpening('door', rooms[index].id, 1, 1500, 900));
  }
}

test('пустой проект не получает выдуманную программу', () => {
  const project = createProject('Пустой');
  const suggestion = suggestHomeProgram(project);
  assert.equal(suggestion.status, 'unknown');
  assert.equal(suggestion.program.socialMode, 'unknown');
  assert.equal(suggestion.program.bedroomCount, null);
  assert.equal(suggestion.program.bathroomCount, null);

  const result = analyzeHomeProgram(project);
  assert.equal(result.status, 'unknown');
  assert.equal(result.input, null);
  assert.deepEqual(result.targets, []);
  assert.ok(result.warnings.some((warning) => /состав семьи/i.test(warning)));
});

test('рекомендация по семье предварительная и объясняет каждый вывод', () => {
  const project = createProject('Семья');
  project.layoutBrief = {
    actors: Array.from({ length: 7 }, (_, index) => ({ id: `A${index}`, alias: `Жилец ${index + 1}` })),
    capacity: {
      dailySeats: 7, guestSeats: 13, guestCount: 6, adultCount: 4, childCount: 3, simultaneousCooks: 2,
    },
  };
  const suggestion = suggestHomeProgram(project);
  assert.equal(suggestion.status, 'preliminary');
  assert.equal(suggestion.program.bedroomCount, 4);
  assert.equal(suggestion.program.bathroomCount, 2);
  assert.equal(suggestion.program.options.laundry, true);
  assert.equal(suggestion.program.options.pantry, true);
  assert.equal(suggestion.program.options.wardrobe, true);
  assert.equal(suggestion.program.options.guestWc, true);
  assert.equal(suggestion.program.options.guestBedroom, null, 'места за столом не доказывают ночующих гостей');
  assert.match(suggestion.reasons.bedroomCount, /по два жильца/i);
});

test('homeProgram нормализует enum, положительные количества и три состояния опций', () => {
  assert.equal(normalizeHomeProgram(null), null);
  const program = normalizeHomeProgram({
    confirmed: 'да', socialMode: 'дворец', bedroomCount: '3.4', bathroomCount: -2,
    options: { office: true, garage: false, terrace: 'да' },
  });
  assert.equal(program.confirmed, false);
  assert.equal(program.socialMode, 'unknown');
  assert.equal(program.bedroomCount, 3);
  assert.equal(program.bathroomCount, null);
  assert.equal(program.options.office, true);
  assert.equal(program.options.garage, false);
  assert.equal(program.options.terrace, null);
});

test('homeProgram хранит до 30 типизированных спален с уникальными id', () => {
  const program = normalizeHomeProgram({
    confirmed: true,
    socialMode: 'combined',
    bedroomCount: 9,
    bathroomCount: 2,
    bedrooms: [
      { id: 'sleep', kind: 'main', ensuite: true, wardrobe: null },
      { id: 'sleep', kind: 'child', ensuite: false, wardrobe: true },
      { id: '', kind: 'неизвестная', ensuite: 'да', wardrobe: false },
    ],
    options: resolvedOptions(),
  });
  assert.equal(program.bedroomCount, 3, 'явный список задаёт число спален');
  assert.deepEqual(program.bedrooms, [
    { id: 'sleep', kind: 'main', ensuite: true, wardrobe: null },
    { id: 'sleep-2', kind: 'child', ensuite: false, wardrobe: true },
    { id: 'bedroom-3', kind: 'adult', ensuite: null, wardrobe: false },
  ]);
});

test('явные типы спален дают отдельные цели без дубля гостевой', () => {
  const project = createProject('Спальни по составу');
  project.layoutBrief = {
    homeProgram: confirmedProgram({
      bedroomCount: 4,
      bedrooms: [
        { id: 'main', kind: 'main', ensuite: true, wardrobe: true },
        { id: 'kid-1', kind: 'child', ensuite: false, wardrobe: false },
        { id: 'kid-2', kind: 'child', ensuite: null, wardrobe: null },
        { id: 'guest', kind: 'guest', ensuite: false, wardrobe: false },
      ],
      options: resolvedOptions({ guestBedroom: true, wardrobe: false }),
    }),
  };
  const result = analyzeHomeProgram(project);
  const bedrooms = result.targets.filter((target) => target.id.startsWith('bedrooms-'));
  assert.deepEqual(bedrooms.map(({ id, count, canonicalType }) => ({ id, count, canonicalType })), [
    { id: 'bedrooms-main', count: 1, canonicalType: 'master-bedroom' },
    { id: 'bedrooms-child', count: 2, canonicalType: 'kids-room' },
    { id: 'bedrooms-guest', count: 1, canonicalType: 'guest-bedroom' },
  ]);
  assert.equal(result.targets.filter((target) => target.canonicalType === 'guest-bedroom').length, 1);
  const wardrobe = result.targets.find((target) => target.id === 'wardrobe');
  assert.equal(wardrobe.count, 1);
  const bathrooms = result.targets.find((target) => target.id === 'bathrooms');
  assert.equal(bathrooms.count, 2, 'общий санузел и санузел при спальне считаются отдельно');
  assert.deepEqual(bathrooms.requirements, { common: 1, ensuite: 1 });
  assert.equal(bedrooms[0].requirements.ensuite.status, 'unknown', 'свой санузел — требование, не доказанный результат');
  assert.ok(result.unresolvedFields.includes('bedrooms.kid-2.ensuite'));
  assert.ok(result.warnings.some((warning) => /конкретной комнатой/i.test(warning)));
});

test('гостевой санузел предлагается по числу гостей, legacy выводится из общего числа мест', () => {
  const explicit = createProject('Гости');
  explicit.layoutBrief = {
    actors: [{ id: 'a1' }, { id: 'a2' }],
    capacity: { dailySeats: 2, guestSeats: 7, guestCount: 5 },
  };
  assert.equal(suggestHomeProgram(explicit).program.options.guestWc, true);
  assert.equal(suggestHomeProgram(explicit).facts.guestCount, 5);

  const legacy = createProject('Старые гости');
  legacy.layoutBrief = {
    actors: [{ id: 'a1' }, { id: 'a2' }],
    capacity: { dailySeats: 2, guestSeats: 6 },
  };
  assert.equal(suggestHomeProgram(legacy).facts.guestCount, 4);
  assert.equal(suggestHomeProgram(legacy).program.options.guestWc, true);
});

test('программа дома делает проект непустым до первого помещения', () => {
  const confirmed = createProject('Только программа');
  confirmed.layoutBrief = { homeProgram: confirmedProgram() };
  assert.equal(hasContent(confirmed), true);

  const draft = createProject('Черновик программы');
  draft.layoutBrief = {
    homeProgram: { confirmed: false, socialMode: 'unknown', bedroomCount: 2 },
  };
  assert.equal(hasContent(draft), true);
  assert.equal(hasContent(createProject('Совсем пустой')), false);
});

test('combined и separate дают разные, не дублирующиеся цели', () => {
  const combined = createProject('Объединённый');
  combined.layoutBrief = { homeProgram: confirmedProgram() };
  assert.deepEqual(analyzeHomeProgram(combined).targets.map(({ id }) => id), [
    'entrance', 'social-combined', 'bedrooms', 'bathrooms',
  ]);

  const separate = createProject('Раздельный');
  separate.layoutBrief = { homeProgram: confirmedProgram({ socialMode: 'separate' }) };
  assert.deepEqual(analyzeHomeProgram(separate).targets.map(({ id }) => id), [
    'entrance', 'living', 'kitchen', 'bedrooms', 'bathrooms',
  ]);
});

test('подтверждённая программа сравнивает комнаты всех этажей и площади', () => {
  const project = createProject('Два этажа');
  project.levels.push(createLevel('2 этаж', 3000, 3000, 'L2'));
  project.levels[0].rooms.push(createRoom('entrance', 0, 0, 3000, 2500));
  project.levels[0].rooms.push(createRoom('kitchen-living', 3100, 0, 6500, 4500));
  const bedroom = createRoom('master-bedroom', 0, 0, 4800, 4200);
  const bathroom = createRoom('bathroom', 4900, 0, 2200, 2000);
  project.levels[1].rooms.push(bedroom, bathroom);
  project.levels[1].openings.push(createOpening('door', bedroom.id, 1, 1500, 900));
  project.layoutBrief = { homeProgram: confirmedProgram() };

  const result = analyzeHomeProgram(project);
  assert.equal(result.summary.missingRooms, 0);
  assert.equal(result.summary.presentCount, 4);
  assert.equal(result.summary.present, 4);
  assert.equal(result.summary.total, 4);
  assert.ok(result.summary.targetAreaM2 > 0);
  assert.ok(result.targets.every((target) => target.actualAreaM2 > 0));
  assert.ok(result.targets.every((target) => target.addType === target.canonicalType));
  assert.deepEqual(result.levels.map(({ roomCount }) => roomCount), [2, 2]);
  assert.equal(result.connections.find(({ id }) => id === 'bedroom-bathroom').status, 'direct');
});

test('реальные двери дают direct, а цепочка помещений — reachable', () => {
  const directProject = createProject('Прямые связи');
  const directRooms = addDocked(directProject.levels[0], ['entrance', 'kitchen-living', 'bedroom', 'bathroom']);
  connectChain(directProject.levels[0], directRooms);
  directProject.layoutBrief = { homeProgram: confirmedProgram() };
  const withoutExteriorDoor = analyzeHomeProgram(directProject);
  assert.equal(withoutExteriorDoor.connections.find(({ id }) => id === 'entrance-public').status, 'direct');
  assert.equal(withoutExteriorDoor.connections.find(({ id }) => id === 'kitchen-public').status, 'direct');
  assert.equal(withoutExteriorDoor.connections.find(({ id }) => id === 'bedroom-bathroom').status, 'direct');
  assert.equal(withoutExteriorDoor.status, 'incomplete', 'одних внутренних дверей недостаточно');
  assert.deepEqual(withoutExteriorDoor.summary.levelsWithoutEntrance, [directProject.levels[0].id]);
  assert.equal(withoutExteriorDoor.summary.unreachableRoomCount, 0);
  assert.equal(withoutExteriorDoor.summary.accessIssueCount, 1);
  assert.ok(withoutExteriorDoor.warnings.some((warning) => /корень входа/i.test(warning)));

  directProject.levels[0].openings.push(createOpening('door', directRooms[0].id, 3, 1500, 900));
  const direct = analyzeHomeProgram(directProject);
  assert.deepEqual(
    direct.connections.find(({ id }) => id === 'bedroom-bathroom').paths,
    direct.connections.find(({ id }) => id === 'bedroom-bathroom').checks,
  );
  assert.equal(direct.status, 'ready');
  assert.equal(direct.summary.accessIssueCount, 0);
  assert.deepEqual(direct.summary.levelsWithoutEntrance, []);

  const reachableProject = createProject('Маршрут');
  const [bedroom, corridor, bathroom] = addDocked(reachableProject.levels[0], ['bedroom', 'corridor', 'bathroom']);
  connectChain(reachableProject.levels[0], [bedroom, corridor, bathroom]);
  reachableProject.layoutBrief = { homeProgram: confirmedProgram() };
  const connection = analyzeHomeProgram(reachableProject).connections.find(({ id }) => id === 'bedroom-bathroom');
  assert.equal(connection.status, 'reachable');
  assert.deepEqual(connection.pathRoomIds, [bedroom.id, corridor.id, bathroom.id]);
});

test('непустой верхний этаж без помещения лестницы не считается доступным', () => {
  const project = createProject('Верхний этаж без лестницы');
  const rooms = addDocked(project.levels[0], ['entrance', 'kitchen-living', 'bedroom', 'bathroom']);
  connectChain(project.levels[0], rooms);
  project.levels[0].openings.push(createOpening('door', rooms[0].id, 3, 1500, 900));
  const upper = createLevel('2 этаж', 3000, 3000, 'L2');
  const upperRooms = addDocked(upper, ['vestibule', 'cabinet']);
  connectChain(upper, upperRooms);
  // Даже наружная дверь в верхнем тамбуре не доказывает путь с нижнего
  // этажа: без лестницы такой этаж остаётся недоступным.
  upper.openings.push(createOpening('door', upperRooms[0].id, 3, 700, 900));
  project.levels.push(upper);
  project.layoutBrief = { homeProgram: confirmedProgram() };

  const result = analyzeHomeProgram(project);
  assert.equal(result.status, 'incomplete');
  assert.deepEqual(result.summary.levelsWithoutEntrance, ['L2']);
  assert.equal(result.summary.accessIssueCount, 1);
  assert.match(result.warnings.find((warning) => warning.includes('2 этаж')), /лестниц/i);
});

test('наружная дверь из спальни не заменяет корень входа в прихожей', () => {
  const project = createProject('Неправильный наружный вход');
  const rooms = addDocked(project.levels[0], ['entrance', 'kitchen-living', 'bedroom', 'bathroom']);
  connectChain(project.levels[0], rooms);
  project.levels[0].openings.push(createOpening('door', rooms[2].id, 0, 1500, 900));
  project.layoutBrief = { homeProgram: confirmedProgram() };

  const bedroomExit = analyzeHomeProgram(project);
  assert.equal(bedroomExit.levels[0].hasEntrance, true, 'наружная дверь распознана графом');
  assert.equal(bedroomExit.levels[0].hasEntryRoot, false, 'но она не является корнем прихожей');
  assert.equal(bedroomExit.status, 'incomplete');
  assert.deepEqual(bedroomExit.summary.levelsWithoutEntrance, [project.levels[0].id]);

  project.levels[0].openings.push(createOpening('door', rooms[0].id, 3, 1500, 900));
  const entranceExit = analyzeHomeProgram(project);
  assert.equal(entranceExit.levels[0].hasEntryRoot, true);
  assert.equal(entranceExit.status, 'ready');
});

test('достижимый обход не заменяет требуемый прямой проход', () => {
  const project = createProject('Кладовая через коридор');
  const rooms = addDocked(
    project.levels[0], ['entrance', 'kitchen-living', 'corridor', 'pantry', 'bedroom', 'bathroom'],
  );
  connectChain(project.levels[0], rooms);
  project.levels[0].openings.push(createOpening('door', rooms[0].id, 3, 1500, 900));
  project.layoutBrief = {
    homeProgram: confirmedProgram({ options: resolvedOptions({ pantry: true }) }),
  };

  const result = analyzeHomeProgram(project);
  const pantryConnection = result.connections.find(({ id }) => id === 'pantry-kitchen');
  assert.equal(pantryConnection.status, 'reachable');
  assert.equal(pantryConnection.acceptable, false);
  assert.match(pantryConnection.reason, /нужен прямой проход/i);
  assert.equal(result.summary.connectionIssues, 1);
  assert.match(result.summary.text, /проблем функциональных связей 1/i);
  assert.equal(result.status, 'incomplete');
});

test('общая стена без двери не выдаётся за проход', () => {
  const project = createProject('Нет двери');
  const [entrance, social] = addDocked(project.levels[0], ['entrance', 'kitchen-living']);
  project.layoutBrief = { homeProgram: confirmedProgram() };
  const connection = analyzeHomeProgram(project).connections.find(({ id }) => id === 'entrance-public');
  assert.equal(connection.status, 'adjacent_without_door');
  assert.equal(connection.fromRoomId, entrance.id);
  assert.equal(connection.toRoomId, social.id);
  assert.match(connection.reason, /проход/i);
});

test('разные этажи без доказанного коннектора остаются unknown', () => {
  const project = createProject('Этажи');
  project.levels.push(createLevel('2 этаж', 3000, 3000, 'L2'));
  const bedroom = createRoom('bedroom', 0, 0, 3000, 3000);
  const bathroom = createRoom('bathroom', 0, 0, 2200, 2000);
  project.levels[0].rooms.push(bedroom);
  project.levels[1].rooms.push(bathroom);
  project.layoutBrief = { homeProgram: confirmedProgram() };
  const connection = analyzeHomeProgram(project).connections.find(({ id }) => id === 'bedroom-bathroom');
  assert.equal(connection.status, 'unknown');
  assert.equal(connection.levelId, null);
  assert.equal(connection.fromRoomId, null);
  assert.equal(connection.toRoomId, null);
  assert.deepEqual(connection.pathRoomIds, []);
  assert.match(connection.reason, /другом этаже/i);
});

test('кухня принимает реальную связь со столовой, а гостевой с/у — только со входом или холлом', () => {
  const project = createProject('Точные роли связей');
  const [kitchen, dining, guestWc, laundry] = addDocked(
    project.levels[0], ['kitchen', 'dining', 'guest-wc', 'laundry'],
  );
  project.levels[0].openings.push(
    createOpening('door', kitchen.id, 1, 1500, 900),
    createOpening('door', guestWc.id, 1, 650, 700),
  );
  project.layoutBrief = {
    homeProgram: confirmedProgram({
      socialMode: 'separate',
      options: resolvedOptions({ guestWc: true }),
    }),
  };

  const result = analyzeHomeProgram(project);
  const kitchenConnection = result.connections.find(({ id }) => id === 'kitchen-public');
  assert.equal(kitchenConnection.status, 'direct');
  assert.equal(kitchenConnection.toRoomId, dining.id);
  const guestConnection = result.connections.find(({ id }) => id === 'guest-wc-entry');
  assert.equal(guestConnection.status, 'missing');
  assert.deepEqual(guestConnection.targetRoomIds, []);
  assert.ok(!guestConnection.targetRoomIds.includes(laundry.id));
});

test('опции добавляют точные цели и функциональные связи', () => {
  const project = createProject('Опции');
  project.layoutBrief = {
    homeProgram: confirmedProgram({
      options: resolvedOptions({ pantry: true, wardrobe: true, guestWc: true, garage: true, terrace: true, laundry: true }),
    }),
  };
  const result = analyzeHomeProgram(project);
  assert.ok(result.targets.some(({ id }) => id === 'pantry'));
  assert.ok(result.targets.some(({ id }) => id === 'wardrobe'));
  assert.ok(result.connections.some(({ id }) => id === 'pantry-kitchen'));
  assert.ok(result.connections.some(({ id }) => id === 'garage-entry'));
  assert.ok(result.connections.some(({ id }) => id === 'terrace-public'));
  assert.equal(result.connections.find(({ id }) => id === 'pantry-kitchen').status, 'missing');
  assert.equal(result.status, 'incomplete');

  const verandaOnly = createProject('Веранда не терраса');
  verandaOnly.levels[0].rooms.push(createRoom('veranda', 0, 0, 4000, 3000));
  verandaOnly.layoutBrief = {
    homeProgram: confirmedProgram({ options: resolvedOptions({ terrace: true }) }),
  };
  const terraceTarget = analyzeHomeProgram(verandaOnly).targets.find(({ id }) => id === 'terrace');
  assert.equal(terraceTarget.presentCount, 0, 'опция террасы не подменяется верандой');
});

test('анализ детерминирован, не мутирует проект и программа переживает файл', () => {
  const project = createProject('Сохранение');
  project.layoutBrief = {
    actors: [{ id: 'A1', alias: 'Жилец' }],
    homeProgram: confirmedProgram({ socialMode: 'separate', bedroomCount: 2, options: resolvedOptions({ office: true }) }),
  };
  const before = serializeProject(project, { pretty: false });
  const first = analyzeHomeProgram(project);
  const second = analyzeHomeProgram(project);
  assert.deepEqual(first, second);
  assert.equal(serializeProject(project, { pretty: false }), before);

  const loaded = deserializeProject(before);
  assert.deepEqual(loaded.layoutBrief.homeProgram, normalizeHomeProgram(project.layoutBrief.homeProgram));
  assert.equal(analyzeHomeProgram(loaded).input.options.office, true);
});
