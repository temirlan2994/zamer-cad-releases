// Многовариантная авторасстановка: поиск с откатом, сложный контур,
// закреплённые предметы и независимая проверка результата.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  applyFurnitureLayout, generateFurnitureLayouts, layoutRuleScoreAdjustment, validateFurnitureLayout,
} from '../core/autolayout.js';
import { createItem, createOpening, createProject, createRoom } from '../core/model.js';
import { roomContainsPoint } from '../core/room-shape.js';
import { addManualWall } from '../core/wall-manual.js';
import { deriveWalls, doorSwingRects } from '../core/walls.js';

function bedroom({ shaped = false } = {}) {
  const project = createProject('Авторасстановка');
  const room = createRoom('bedroom', 0, 0, 6200, 5000);
  if (shaped) room.notch = { corner: 'nw', w: 1800, h: 1600 };
  project.rooms.push(room);
  project.openings.push(createOpening('door', room.id, 2, 3100, 900));
  project.openings.push(createOpening('window', room.id, 0, 3900, 1600));
  project.items.push(
    createItem('bed-double', 3100, 2500, 1600, 2000),
    createItem('wardrobe', 1000, 2500, 1800, 600),
    createItem('dresser', 5000, 2500, 1000, 450),
  );
  return { project, room, walls: deriveWalls(project) };
}

test('строит несколько детерминированных проверенных вариантов и не мутирует проект', () => {
  const { project, room, walls } = bedroom();
  const before = project.items.map((item) => ({ x: item.x, y: item.y, rotation: item.rotation }));
  const a = generateFurnitureLayouts(project, room, walls, { count: 3 });
  const b = generateFurnitureLayouts(project, room, walls, { count: 3 });
  assert.equal(a.status, 'feasible', a.diagnostics.join('; '));
  assert.ok(a.layouts.length >= 2, `вариантов: ${a.layouts.length}`);
  assert.deepEqual(a.layouts.map((x) => x.profile), ['balanced', 'preserve', 'spacious']);
  assert.deepEqual(a.layouts.map((x) => x.placements), b.layouts.map((x) => x.placements));
  assert.equal(new Set(a.layouts.map((x) => JSON.stringify(x.placements))).size, a.layouts.length);
  assert.deepEqual(project.items.map((item) => ({ x: item.x, y: item.y, rotation: item.rotation })), before);
  for (const layout of a.layouts) assert.equal(validateFurnitureLayout(project, room, walls, layout).ok, true);
});

test('использует настоящий Г-контур, а не его габаритный прямоугольник', () => {
  const { project, room, walls } = bedroom({ shaped: true });
  const result = generateFurnitureLayouts(project, room, walls, { count: 2 });
  assert.equal(result.status, 'feasible', result.diagnostics.join('; '));
  for (const layout of result.layouts) {
    for (const pose of layout.placements) {
      const item = project.items.find((x) => x.id === pose.itemId);
      const rotated = pose.rotation % 180 !== 0;
      const w = rotated ? item.h : item.w; const h = rotated ? item.w : item.h;
      for (const [dx, dy] of [[-w / 2 + 1, -h / 2 + 1], [w / 2 - 1, -h / 2 + 1], [w / 2 - 1, h / 2 - 1], [-w / 2 + 1, h / 2 - 1]]) {
        assert.equal(roomContainsPoint(room, pose.x + dx, pose.y + dy), true, `${item.kind} вне Г-контура`);
      }
    }
  }
});

test('валидатор не пропускает узкий вырез между контрольными точками мебели', () => {
  const project = createProject();
  const room = createRoom('bedroom', 0, 0, 6000, 5000);
  room.outline = [
    { x: 0, y: 0 }, { x: 2000, y: 0 }, { x: 2000, y: 800 }, { x: 2200, y: 800 },
    { x: 2200, y: 0 }, { x: 6000, y: 0 }, { x: 6000, y: 5000 }, { x: 0, y: 5000 },
  ];
  const bed = createItem('bed-double', 2500, 600, 2000, 1000);
  project.rooms.push(room);
  project.items.push(bed);
  const layout = { placements: [{ itemId: bed.id, x: bed.x, y: bed.y, rotation: 0 }] };
  const validation = validateFurnitureLayout(project, room, deriveWalls(project), layout);
  assert.equal(validation.ok, false);
  assert.ok(validation.checks.some((entry) => entry.status === 'fail' && entry.text.includes('outside')));
});

test('GEO001 не пропускает самопересекающийся контур с достаточным числом рёбер', () => {
  const project = createProject();
  const room = createRoom('bedroom', 0, 0, 4000, 4000);
  room.outline = [
    { x: 0, y: 0 }, { x: 4000, y: 0 }, { x: 4000, y: 4000 },
    { x: 1000, y: 4000 }, { x: 1000, y: 1000 }, { x: 3000, y: 1000 },
    { x: 3000, y: 3000 }, { x: 0, y: 3000 },
  ];
  project.rooms.push(room);

  const validation = validateFurnitureLayout(project, room, deriveWalls(project), { placements: [] });
  const geo001 = validation.ruleResults.find((entry) => entry.ruleId === 'GEO001');

  assert.equal(geo001.status, 'fail');
  assert.equal(geo001.metricResults[0].value, false);
  assert.equal(validation.ok, false);
});

test('закреплённый предмет остаётся на месте, выбранный вариант применяется отдельно', () => {
  const { project, room, walls } = bedroom();
  const wardrobe = project.items.find((item) => item.kind === 'wardrobe');
  wardrobe.x = 900;
  wardrobe.y = 4700;
  wardrobe.rotation = 180;
  const result = generateFurnitureLayouts(project, room, walls, { count: 2, lockedIds: [wardrobe.id] });
  assert.equal(result.status, 'feasible', result.diagnostics.join('; '));
  for (const layout of result.layouts) {
    const pose = layout.placements.find((p) => p.itemId === wardrobe.id);
    assert.deepEqual(pose, { itemId: wardrobe.id, x: 900, y: 4700, rotation: 180 });
    assert.equal(validateFurnitureLayout(project, room, walls, layout, { lockedIds: [wardrobe.id] }).ok, true);
  }
  const chosen = result.layouts[0];
  assert.equal(applyFurnitureLayout(project, chosen), project.items.length);
  for (const pose of chosen.placements) {
    const item = project.items.find((x) => x.id === pose.itemId);
    assert.deepEqual({ x: item.x, y: item.y, rotation: item.rotation }, { x: pose.x, y: pose.y, rotation: pose.rotation });
  }
});

test('закрепление сохраняет эквивалентные и дробные углы без ложного отказа', () => {
  for (const rotation of [-90, 360, 450, 22.5]) {
    const project = createProject();
    const room = createRoom('cabinet', 0, 0, 5000, 4000);
    const desk = createItem('desk', 2500, 2000, 1400, 700);
    desk.rotation = rotation;
    desk.autoLayoutLocked = true;
    project.rooms.push(room);
    project.items.push(desk);
    const result = generateFurnitureLayouts(project, room, deriveWalls(project), { count: 1 });
    assert.equal(result.status, 'feasible', `${rotation}°: ${result.diagnostics.join('; ')}`);
    assert.equal(result.layouts[0].placements[0].rotation, rotation);
  }
});

test('возвращает внутрь мебель, оказавшуюся за новой границей комнаты', () => {
  const { project, room, walls } = bedroom();
  const itemIds = project.items.map((item) => item.id);
  const dresser = project.items.find((item) => item.kind === 'dresser');
  dresser.x = room.x + room.w + 800;
  const result = generateFurnitureLayouts(project, room, walls, { count: 2, itemIds });
  assert.equal(result.status, 'feasible', result.diagnostics.join('; '));
  for (const layout of result.layouts) {
    assert.equal(layout.placements.length, itemIds.length);
    assert.ok(layout.placements.some((pose) => pose.itemId === dresser.id));
    assert.equal(validateFurnitureLayout(project, room, walls, layout, { itemIds }).ok, true);
  }
});

test('не выдаёт неполный вариант, если обязательная мебель не помещается', () => {
  const project = createProject();
  const room = createRoom('bedroom', 0, 0, 1800, 1800);
  project.rooms.push(room);
  project.items.push(createItem('bed-double', 900, 900, 1600, 2000));
  const result = generateFurnitureLayouts(project, room, deriveWalls(project));
  assert.equal(result.status, 'search_budget_exhausted');
  assert.deepEqual(result.layouts, []);
  assert.ok(result.diagnostics.length > 0);
});

test('валидатор отклоняет дубликаты и позиции мебели из другой комнаты', () => {
  const { project, room, walls } = bedroom();
  const result = generateFurnitureLayouts(project, room, walls, { count: 1 });
  assert.equal(result.status, 'feasible');
  const placements = result.layouts[0].placements;
  const duplicate = validateFurnitureLayout(project, room, walls, {
    placements: [...placements, { ...placements[0] }],
  });
  assert.equal(duplicate.ok, false);
  const outsider = createItem('chair', 10000, 10000, 450, 450);
  project.items.push(outsider);
  const extra = validateFurnitureLayout(project, room, walls, {
    placements: [...placements, { itemId: outsider.id, x: 1000, y: 1000, rotation: 0 }],
  });
  assert.equal(extra.ok, false);
});

test('ручная стена внутри помещения остаётся физическим препятствием', () => {
  const project = createProject();
  const room = createRoom('cabinet', 0, 0, 6000, 4000);
  const desk = createItem('desk', 3000, 2000, 1200, 600);
  project.rooms.push(room);
  project.items.push(desk);
  addManualWall(project, { x: 3000, y: 0 }, { x: 3000, y: 4000 }, { thickness: 120 });
  const walls = deriveWalls(project);
  const validation = validateFurnitureLayout(project, room, walls, {
    placements: [{ itemId: desk.id, x: desk.x, y: desk.y, rotation: 0 }],
  });
  assert.equal(validation.ok, false);
  assert.ok(validation.checks.some((entry) => entry.status === 'fail' && entry.text.includes('wall')));
});

test('разные двери не маскируют разрыв маршрута внутри комнаты', () => {
  const project = createProject();
  const room = createRoom('cabinet', 0, 0, 6000, 4000);
  const left = createItem('desk', 1200, 2000, 1200, 600);
  const right = createItem('desk', 4800, 2000, 1200, 600);
  project.rooms.push(room);
  project.items.push(left, right);
  project.openings.push(
    createOpening('door', room.id, 3, 2000, 900),
    createOpening('door', room.id, 1, 2000, 900),
  );
  addManualWall(project, { x: 3000, y: 0 }, { x: 3000, y: 4000 }, { thickness: 120 });
  const walls = deriveWalls(project);
  const validation = validateFurnitureLayout(project, room, walls, {
    placements: [
      { itemId: left.id, x: left.x, y: left.y, rotation: 0 },
      { itemId: right.id, x: right.x, y: right.y, rotation: 180 },
    ],
  });
  assert.equal(validation.ok, false);
  assert.match(validation.route.reason, /порталы не связаны/);
});

test('прикроватные тумбы не занимают независимые боковые проходы', () => {
  const project = createProject();
  const room = createRoom('bedroom', 0, 0, 6200, 5000);
  const bed = createItem('bed-double', 3100, 2500, 1600, 2000);
  bed.occupancyCount = 2;
  project.rooms.push(room);
  project.openings.push(createOpening('door', room.id, 2, 3100, 900));
  project.items.push(
    bed,
    createItem('nightstand', 3100, 2500, 450, 400),
    createItem('nightstand', 3100, 2500, 450, 400),
  );
  const result = generateFurnitureLayouts(project, room, deriveWalls(project), { count: 2 });
  assert.equal(result.status, 'feasible', result.diagnostics.join('; '));
  for (const layout of result.layouts) {
    assert.equal(validateFurnitureLayout(project, room, deriveWalls(project), layout).ok, true);
    assert.equal(layout.ruleResults.find((entry) => entry.ruleId === 'BED003')?.status, 'pass');
  }
});

test('боковые зоны односпальной и неназначенной двуспальной кровати альтернативны', () => {
  for (const { kind, width, occupancyCount, userActorIds, expected } of [
    { kind: 'bed-single', width: 900, occupancyCount: 2, expected: 'pass' },
    { kind: 'bed-double', width: 1600, expected: 'pass' },
    { kind: 'bed-double', width: 1600, occupancyCount: 2, expected: 'fail' },
    { kind: 'bed-double', width: 1600, occupancyCount: 2, userActorIds: [], expected: 'fail' },
    { kind: 'bed-double', width: 1600, occupancyCount: 2, userActorIds: ['adult-a'], expected: 'fail' },
    { kind: 'bed-double', width: 1600, userActorIds: ['adult-a', 'adult-b'], expected: 'fail' },
  ]) {
    const project = createProject();
    const room = createRoom('bedroom', 0, 0, 5000, 4000);
    const bed = createItem(kind, width / 2, 2000, width, 2000);
    if (occupancyCount !== undefined) bed.occupancyCount = occupancyCount;
    if (userActorIds !== undefined) bed.userActorIds = userActorIds;
    project.rooms.push(room);
    project.items.push(bed);
    const validation = validateFurnitureLayout(project, room, deriveWalls(project), {
      placements: [{ itemId: bed.id, x: bed.x, y: bed.y, rotation: 0 }],
    });
    assert.equal(
      validation.checks.find((entry) => entry.id.startsWith('AUTO-GEOMETRY-')).status,
      expected,
      `${kind}, occupancy=${occupancyCount ?? userActorIds?.length ?? 0}`,
    );
  }
});

test('два предмета не могут по отдельности занять обе альтернативы одной группы', () => {
  const project = createProject();
  const room = createRoom('bedroom', 0, 0, 6000, 5000);
  const bed = createItem('bed-single', 3000, 2500, 900, 2000);
  const left = createItem('nightstand', 2200, 2600, 450, 400);
  const right = createItem('nightstand', 3800, 2600, 450, 400);
  project.rooms.push(room);
  project.items.push(bed, left);
  const placements = [bed, left, right].map((item) => ({
    itemId: item.id, x: item.x, y: item.y, rotation: item.rotation,
  }));
  const oneSide = validateFurnitureLayout(project, room, deriveWalls(project), {
    placements: placements.slice(0, 2),
  }, { itemIds: [bed.id, left.id] });
  assert.equal(oneSide.checks.some((entry) => entry.id.startsWith('AUTO-GEOMETRY-') && entry.status === 'fail'), false);

  project.items.push(right);
  const bothSides = validateFurnitureLayout(project, room, deriveWalls(project), { placements });
  assert.ok(bothSides.checks.some((entry) => entry.status === 'fail' && entry.text.includes('foreign-access')));

  const wallProject = createProject();
  const wallRoom = createRoom('bedroom', 0, 0, 5000, 4000);
  const wallBed = createItem('bed-single', 450, 2000, 900, 2000);
  const remainingSideBlocker = createItem('nightstand', 1200, 2600, 450, 400);
  wallProject.rooms.push(wallRoom);
  wallProject.items.push(wallBed, remainingSideBlocker);
  const wallAndBody = validateFurnitureLayout(wallProject, wallRoom, deriveWalls(wallProject), {
    placements: [wallBed, remainingSideBlocker].map((item) => ({
      itemId: item.id, x: item.x, y: item.y, rotation: item.rotation,
    })),
  });
  assert.ok(wallAndBody.checks.some((entry) => entry.status === 'fail' && entry.text.includes('foreign-access')));
});

test('частичный scope учитывает тела, зоны пользования и маршруты исключённой мебели', () => {
  const collisionProject = createProject();
  const collisionRoom = createRoom('cabinet', 0, 0, 6000, 4000);
  const selected = createItem('chair', 3000, 2000, 450, 450);
  const fixed = createItem('chair', 3000, 2000, 450, 450);
  collisionProject.rooms.push(collisionRoom);
  collisionProject.items.push(selected, fixed);
  const collision = validateFurnitureLayout(collisionProject, collisionRoom, deriveWalls(collisionProject), {
    placements: [{ itemId: selected.id, x: selected.x, y: selected.y, rotation: 0 }],
  }, { itemIds: [selected.id] });
  assert.equal(collision.ok, false);
  assert.equal(collision.ruleResults.find((entry) => entry.ruleId === 'GEO004')?.status, 'fail');

  const supportProject = createProject();
  const supportRoom = createRoom('cabinet', 0, 0, 6000, 4000);
  const supportTarget = createItem('chair', 3000, 2000, 450, 450);
  const outsideFixed = createItem('wardrobe', 100, 1000, 600, 600);
  supportProject.rooms.push(supportRoom);
  supportProject.items.push(supportTarget, outsideFixed);
  const support = validateFurnitureLayout(supportProject, supportRoom, deriveWalls(supportProject), {
    placements: [{ itemId: supportTarget.id, x: supportTarget.x, y: supportTarget.y, rotation: 0 }],
  }, { itemIds: [supportTarget.id] });
  assert.equal(support.ruleResults.find((entry) => entry.ruleId === 'GEO018')?.status, 'fail');
  assert.equal(support.ok, false);

  const accessProject = createProject();
  const accessRoom = createRoom('cabinet', 0, 0, 6000, 4000);
  const desk = createItem('desk', 3000, 600, 1200, 600);
  const chair = createItem('chair', 3000, 1200, 450, 450);
  accessProject.rooms.push(accessRoom);
  accessProject.items.push(desk, chair);
  const access = validateFurnitureLayout(accessProject, accessRoom, deriveWalls(accessProject), {
    placements: [{ itemId: chair.id, x: chair.x, y: chair.y, rotation: 0 }],
  }, { itemIds: [chair.id] });
  assert.ok(access.checks.some((entry) => entry.status === 'fail' && entry.text.includes('fixed-access')));

  const routeProject = createProject();
  const routeRoom = createRoom('cabinet', 0, 0, 6000, 5000);
  const target = createItem('chair', 3000, 4000, 450, 450);
  const barrier = createItem('wardrobe', 3000, 2500, 6000, 600);
  routeProject.rooms.push(routeRoom);
  routeProject.items.push(target, barrier);
  routeProject.openings.push(createOpening('door', routeRoom.id, 0, 3000, 900));
  const route = validateFurnitureLayout(routeProject, routeRoom, deriveWalls(routeProject), {
    placements: [{ itemId: target.id, x: target.x, y: target.y, rotation: 0 }],
  }, { itemIds: [target.id] });
  assert.equal(route.route.ok, false);
  assert.equal(route.checks.find((entry) => entry.id === 'AUTO-ROUTE-600')?.status, 'fail');
});

test('вложенная наружная стена считается опорой изголовья', () => {
  const project = createProject();
  const room = createRoom('bedroom', 0, 0, 6000, 5000);
  const child = createRoom('wardrobe', 2000, 0, 2000, 800);
  child.parentId = room.id;
  const bed = createItem('bed-double', 3000, 1900, 1600, 2000);
  bed.occupancyCount = 1;
  project.rooms.push(room, child);
  project.items.push(bed);
  const validation = validateFurnitureLayout(project, room, deriveWalls(project), {
    placements: [{ itemId: bed.id, x: bed.x, y: bed.y, rotation: 0 }],
  });
  assert.equal(validation.ruleResults.find((entry) => entry.ruleId === 'BED002')?.status, 'pass');
});

test('BED006 сохраняет fail для известного дефицита и unknown при достаточном известном минимуме', () => {
  const build = (withSurfaces) => {
    const project = createProject();
    const room = createRoom('bedroom', 0, 0, 9000, 5000);
    const known = createItem('bed-double', 2000, 2000, 1600, 2000);
    known.occupancyCount = 2;
    const unknown = createItem('bed-double', 6500, 2000, 1600, 2000);
    const items = [known, unknown];
    if (withSurfaces) items.push(
      createItem('nightstand', 925, 1200, 450, 400),
      createItem('side-table', 3075, 1200, 450, 400),
    );
    project.rooms.push(room);
    project.items.push(...items);
    const placements = items.map((item) => ({
      itemId: item.id, x: item.x, y: item.y, rotation: item.rotation,
    }));
    return validateFurnitureLayout(project, room, deriveWalls(project), { placements });
  };
  assert.equal(build(false).ruleResults.find((entry) => entry.ruleId === 'BED006')?.status, 'fail');
  assert.equal(build(true).ruleResults.find((entry) => entry.ruleId === 'BED006')?.status, 'unknown');
});

test('BED006 учитывает неизвестную занятость детской кровати', () => {
  const project = createProject();
  const room = createRoom('bedroom', 0, 0, 8000, 5000);
  const emptyAdult = createItem('bed-double', 2000, 1500, 1600, 2000);
  emptyAdult.occupancyCount = 0;
  const childBed = createItem('kids-bed', 6000, 1500, 900, 1900);
  project.rooms.push(room);
  project.items.push(emptyAdult, childBed);
  const validation = validateFurnitureLayout(project, room, deriveWalls(project), {
    placements: [emptyAdult, childBed].map((item) => ({
      itemId: item.id, x: item.x, y: item.y, rotation: item.rotation,
    })),
  });
  assert.equal(validation.ruleResults.find((entry) => entry.ruleId === 'BED006')?.status, 'unknown');
});

test('BATH003 не маскирует standard-пользователя смешанным профилем', () => {
  const project = createProject();
  const room = createRoom('bathroom', 0, 0, 3000, 3000);
  const toilet = createItem('toilet', 300, 325, 400, 650);
  project.rooms.push(room);
  project.items.push(toilet);
  project.layoutBrief = { actors: [
    { id: 'standard', mobilityProfile: 'standard', dataStatus: 'declared' },
    { id: 'wheelchair', mobilityProfile: 'wheelchair', dataStatus: 'declared', bodyWidthMm: 700, bodyDepthMm: 1100 },
  ] };
  const validation = validateFurnitureLayout(project, room, deriveWalls(project), {
    placements: [{ itemId: toilet.id, x: toilet.x, y: toilet.y, rotation: 0 }],
  });
  assert.equal(validation.ruleResults.find((entry) => entry.ruleId === 'BATH003')?.status, 'fail');
});

test('BED005 измеряет только кровати с подтверждённым маршрутом через изножье', () => {
  const project = createProject();
  const room = createRoom('bedroom', 0, 0, 9000, 5000);
  const footBed = createItem('bed-double', 2000, 1500, 1600, 2000);
  footBed.occupancyCount = 1;
  footBed.routeToSecondSide = 'foot';
  footBed.routeToSecondSideDataStatus = 'declared';
  const sideBed = createItem('bed-double', 6500, 3900, 1600, 2000);
  sideBed.occupancyCount = 1;
  sideBed.routeToSecondSide = 'side';
  sideBed.routeToSecondSideDataStatus = 'declared';
  project.rooms.push(room);
  project.items.push(footBed, sideBed);
  const validation = validateFurnitureLayout(project, room, deriveWalls(project), {
    placements: [footBed, sideBed].map((item) => ({
      itemId: item.id, x: item.x, y: item.y, rotation: item.rotation,
    })),
  });
  const bed005 = validation.ruleResults.find((entry) => entry.ruleId === 'BED005');
  assert.equal(bed005.status, 'pass');
  assert.equal(bed005.metricResults[0].value, 2500);
});

test('BED003 не даёт pass при неизвестной занятости другой двуспальной кровати', () => {
  const project = createProject();
  const room = createRoom('bedroom', 0, 0, 9000, 5000);
  const known = createItem('bed-double', 2200, 1500, 1600, 2000);
  known.occupancyCount = 2;
  const unknown = createItem('bed-double', 6500, 1500, 1600, 2000);
  project.rooms.push(room);
  project.items.push(known, unknown);
  project.openings.push(createOpening('door', room.id, 2, 4500, 900));
  const validation = validateFurnitureLayout(project, room, deriveWalls(project), {
    placements: [known, unknown].map((item) => ({
      itemId: item.id, x: item.x, y: item.y, rotation: item.rotation,
    })),
  });
  assert.equal(validation.ruleResults.find((entry) => entry.ruleId === 'BED003')?.status, 'unknown');
});

test('маршрут публикует доступ по логическим группам, а две стороны — только для двух спящих', () => {
  for (const occupants of [null, 2]) {
    const project = createProject();
    const room = createRoom('bedroom', 0, 0, 6200, 5000);
    const bed = createItem('bed-double', 3100, 1500, 1600, 2000);
    if (occupants) bed.occupancyCount = occupants;
    project.rooms.push(room);
    project.items.push(bed);
    project.openings.push(createOpening('door', room.id, 2, 3100, 900));
    project.layoutBrief = { actors: [{ id: 'adult-a', mobilityProfile: 'standard', dataStatus: 'declared' }] };
    const validation = validateFurnitureLayout(project, room, deriveWalls(project), {
      placements: [{ itemId: bed.id, x: bed.x, y: bed.y, rotation: 0 }],
    });
    assert.equal(validation.route.zoneAccess.get(bed.id).length, occupants ? 2 : 1);
    assert.equal(validation.ruleResults.find((entry) => entry.ruleId === 'BED003').status, occupants ? 'pass' : 'unknown');
    assert.equal(validation.ruleResults.find((entry) => entry.ruleId === 'PATH006').status, 'unknown');
  }
});

test('независимый доступ к двум сторонам кровати без двери остаётся неизвестным', () => {
  const project = createProject();
  const room = createRoom('bedroom', 0, 0, 6200, 5000);
  const bed = createItem('bed-double', 3100, 2500, 1600, 2000);
  project.rooms.push(room);
  project.items.push(bed);
  const validation = validateFurnitureLayout(project, room, deriveWalls(project), {
    placements: [{ itemId: bed.id, x: bed.x, y: bed.y, rotation: 0 }],
  });
  assert.equal(validation.ruleResults.find((entry) => entry.ruleId === 'BED003')?.status, 'unknown');
});

test('утреннее солнце учитывается только после подтверждения участка', () => {
  const { project, room, walls } = bedroom();
  let result = generateFurnitureLayouts(project, room, walls, { count: 1 });
  assert.equal(result.layouts[0].ruleResults.find((entry) => entry.ruleId === 'BED013')?.status, 'unknown');
  project.site.boundary = [
    { x: -2000, y: -2000 }, { x: 10000, y: -2000 },
    { x: 10000, y: 10000 }, { x: -2000, y: 10000 },
  ];
  project.site.solarVerified = true;
  result = generateFurnitureLayouts(project, room, walls, { count: 1 });
  assert.notEqual(result.layouts[0].ruleResults.find((entry) => entry.ruleId === 'BED013')?.status, 'unknown');
});

test('вместимость из брифа становится обязательной проверяемой метрикой', () => {
  const project = createProject();
  const room = createRoom('dining', 0, 0, 8000, 6000);
  project.rooms.push(room);
  project.openings.push(createOpening('door', room.id, 2, 4000, 900));
  project.layoutBrief = {
    version: 1,
    actors: [],
    capacity: { dailySeats: 4, guestSeats: 6 },
    fixedEngineering: null,
    storageInventory: null,
    uncertainty: [],
  };
  const table = createItem('dining-table-6', 4000, 3000, 1800, 900);
  const chairs = [
    createItem('chair', 3000, 2000, 450, 450),
    createItem('chair', 5000, 2000, 450, 450),
    createItem('chair', 3000, 4000, 450, 450),
    createItem('chair', 5000, 4000, 450, 450),
  ];
  project.items.push(table, ...chairs);
  const layout = { placements: project.items.map((item) => ({
    itemId: item.id, x: item.x, y: item.y, rotation: item.rotation,
  })) };
  const validation = validateFurnitureLayout(project, room, deriveWalls(project), layout);
  const capacityRule = validation.ruleResults.find((entry) => entry.ruleId === 'DIN001');
  assert.equal(capacityRule.status, 'fail');
  assert.equal(capacityRule.blocking, true);
  assert.equal(capacityRule.metricResults[0].value, 4);
  assert.equal(capacityRule.metricResults[0].threshold, 6);
});

test('точные метрики спальни доходят до правил готового варианта', () => {
  const project = createProject();
  const room = createRoom('bedroom', 0, 0, 5000, 5000);
  project.rooms.push(room);
  project.openings.push(createOpening('door', room.id, 2, 2500, 900));
  project.items.push(
    createItem('bed-double', 2500, 1000, 1600, 2000),
    createItem('nightstand', 1425, 200, 450, 400),
    createItem('nightstand', 3575, 200, 450, 400),
  );
  const layout = { placements: project.items.map((item) => ({
    itemId: item.id, x: item.x, y: item.y, rotation: item.rotation,
  })) };
  const validation = validateFurnitureLayout(project, room, deriveWalls(project), layout);
  const statuses = Object.fromEntries(validation.ruleResults.map((result) => [result.ruleId, result.status]));

  assert.equal(validation.ok, true);
  for (const id of ['BED002', 'BED004', 'BED007']) assert.equal(statuses[id], 'pass', id);
  assert.equal(statuses.BED005, 'unknown', 'маршрут через изножье не выдумывается');
  assert.equal(statuses.BED020, 'unknown', 'требуемый размер спального места не задан');
  assert.equal(statuses.PATH003, 'unknown');
  assert.equal(statuses.PATH004, 'unknown', 'диаметр агента не подменяет измеренный bottleneck');
  assert.equal(statuses.PATH006, 'unknown', 'без подтверждённого профиля локальный подход не выдумывается');
  assert.equal(statuses.PATH020, 'unknown', 'без координаты и длины bottleneck нет ложного pass');

  const bed = project.items.find((item) => item.kind === 'bed-double');
  bed.routeToSecondSide = 'foot';
  bed.routeToSecondSideDataStatus = 'declared';
  const withFootRoute = validateFurnitureLayout(project, room, deriveWalls(project), layout);
  assert.equal(withFootRoute.ruleResults.find((result) => result.ruleId === 'BED005').status, 'pass');
});

test('санузел и кухня получают направленные зазоры, а не номинальные догадки', () => {
  const bathProject = createProject();
  const bath = createRoom('bathroom', 0, 0, 3000, 3000);
  bathProject.rooms.push(bath);
  const toilet = createItem('toilet', 700, 325, 400, 650);
  bathProject.items.push(toilet);
  bathProject.layoutBrief = {
    actors: [{ id: 'adult-1', mobilityProfile: 'standard', dataStatus: 'declared' }],
  };
  const bathValidation = validateFurnitureLayout(bathProject, bath, deriveWalls(bathProject), {
    placements: [{ itemId: toilet.id, x: toilet.x, y: toilet.y, rotation: 0 }],
  });
  const bathStatuses = Object.fromEntries(bathValidation.ruleResults.map((result) => [result.ruleId, result.status]));
  assert.equal(bathStatuses.BATH002, 'pass');
  assert.equal(bathStatuses.BATH003, 'pass');
  assert.equal(bathStatuses.BATH005, 'not_applicable');

  const kitchenProject = createProject();
  const kitchen = createRoom('kitchen', 0, 0, 5000, 3000);
  kitchenProject.rooms.push(kitchen);
  const lower = createItem('kitchen-row', 2500, 300, 2400, 600, 0);
  const upper = createItem('kitchen-row', 2500, 1967, 2400, 600, 180);
  kitchenProject.items.push(lower, upper);
  const kitchenValidation = validateFurnitureLayout(kitchenProject, kitchen, deriveWalls(kitchenProject), {
    placements: [lower, upper].map((item) => ({
      itemId: item.id, x: item.x, y: item.y, rotation: item.rotation,
    })),
  });
  const kitchenStatuses = Object.fromEntries(kitchenValidation.ruleResults.map((result) => [result.ruleId, result.status]));
  assert.equal(kitchenStatuses.KIT004, 'unknown');
  assert.equal(kitchenStatuses.KIT005, 'unknown');

  for (const item of [lower, upper]) {
    item.geometryStatus = 'parametric_custom';
    item.planProjectionVerified = true;
  }
  kitchenProject.layoutBrief = { capacity: { simultaneousCooks: 1 } };
  const verifiedKitchen = validateFurnitureLayout(kitchenProject, kitchen, deriveWalls(kitchenProject), {
    placements: [lower, upper].map((item) => ({
      itemId: item.id, x: item.x, y: item.y, rotation: item.rotation,
    })),
  });
  const verifiedKitchenStatuses = Object.fromEntries(
    verifiedKitchen.ruleResults.map((result) => [result.ruleId, result.status]),
  );
  assert.equal(verifiedKitchenStatuses.KIT004, 'pass');
  assert.equal(verifiedKitchenStatuses.KIT005, 'pass');

  const externalChair = createItem('chair', -100, 1500, 450, 450);
  kitchenProject.items.push(externalChair);
  const withExternalUnknown = validateFurnitureLayout(kitchenProject, kitchen, deriveWalls(kitchenProject), {
    placements: [lower, upper].map((item) => ({
      itemId: item.id, x: item.x, y: item.y, rotation: item.rotation,
    })),
  }, { itemIds: [lower.id, upper.id] });
  assert.equal(
    withExternalUnknown.ruleResults.find((result) => result.ruleId === 'KIT005').status,
    'unknown',
  );
});

test('раздвижная дверь не получает ложный квадрат распахивания', () => {
  const project = createProject();
  const room = createRoom('bedroom', 0, 0, 4000, 4000);
  const door = createOpening('door', room.id, 0, 2000, 900);
  door.type = 'sliding';
  const chair = createItem('chair', 2000, 700, 450, 450);
  project.rooms.push(room);
  project.openings.push(door);
  project.items.push(chair);
  const validation = validateFurnitureLayout(project, room, deriveWalls(project), {
    placements: [{ itemId: chair.id, x: chair.x, y: chair.y, rotation: 0 }],
  });
  const statuses = Object.fromEntries(validation.ruleResults.map((result) => [result.ruleId, result.status]));
  assert.equal(validation.checks.some((entry) => entry.status === 'fail' && entry.text.includes('door')), false);
  assert.equal(statuses.GEO008, 'not_applicable');
  assert.equal(statuses.GEO009, 'unknown');
});

test('портал уже 600 мм даёт fail, а неизвестная ширина не превращается в pass', () => {
  for (const { width, expected, reason } of [
    { width: 500, expected: 'fail', reason: /меньше 600/ },
    { width: null, expected: 'unknown', reason: /Неизвестна чистая ширина/ },
  ]) {
    const project = createProject();
    const room = createRoom('cabinet', 0, 0, 4000, 4000);
    project.rooms.push(room);
    project.openings.push(createOpening('door', room.id, 0, 2000, width));
    const validation = validateFurnitureLayout(project, room, deriveWalls(project), { placements: [] });
    assert.equal(validation.checks.find((entry) => entry.id === 'AUTO-ROUTE-600').status, expected);
    assert.match(validation.route.reason, reason);
    assert.equal(validation.ruleResults.find((entry) => entry.ruleId === 'PATH001').status, 'unknown');
  }
});

test('отклонённая поза остаётся препятствием маршрута и двери', () => {
  const routeProject = createProject();
  const routeRoom = createRoom('bedroom', 0, 0, 2000, 4000);
  const barrier = createItem('wardrobe', 1000, 3300, 2000, 600);
  routeProject.rooms.push(routeRoom);
  routeProject.items.push(barrier);
  routeProject.openings.push(createOpening('door', routeRoom.id, 2, 1000, 900));
  const blocked = validateFurnitureLayout(routeProject, routeRoom, deriveWalls(routeProject), {
    placements: [{ itemId: barrier.id, x: barrier.x, y: barrier.y, rotation: 0 }],
  });
  assert.equal(blocked.records.length, 0);
  assert.equal(blocked.allPosedRecords.length, 1);
  assert.equal(blocked.route.ok, false);
  assert.equal(blocked.ruleResults.find((entry) => entry.ruleId === 'PATH001').status, 'unknown');

  const doorProject = createProject();
  const doorRoom = createRoom('bedroom', 0, 0, 4000, 4000);
  const outsideChair = createItem('chair', 2000, 0, 450, 450);
  doorProject.rooms.push(doorRoom);
  doorProject.items.push(outsideChair);
  doorProject.openings.push(createOpening('door', doorRoom.id, 0, 2000, 900));
  const doorCollision = validateFurnitureLayout(doorProject, doorRoom, deriveWalls(doorProject), {
    placements: [{ itemId: outsideChair.id, x: outsideChair.x, y: outsideChair.y, rotation: 0 }],
  });
  assert.ok(doorCollision.checks.some((entry) => entry.status === 'fail' && entry.text.includes('outside')));
  const geo008 = doorCollision.ruleResults.find((entry) => entry.ruleId === 'GEO008');
  assert.equal(geo008.status, 'fail');
  assert.ok(geo008.metricResults.find((entry) => entry.metric === 'door_swing_collision_count').value > 0);
  assert.equal(doorCollision.ruleResults.find((entry) => entry.ruleId === 'PATH001').status, 'unknown');
  assert.equal(doorCollision.ruleResults.find((entry) => entry.ruleId === 'PATH003').status, 'unknown');
});

test('ручные стены и вложенные помещения входят в препятствия распахивания двери', () => {
  for (const obstacle of ['wall', 'child']) {
    const project = createProject();
    const room = createRoom('bedroom', 0, 0, 4000, 4000);
    project.rooms.push(room);
    project.openings.push(createOpening('door', room.id, 0, 2000, 900));
    if (obstacle === 'wall') {
      addManualWall(project, { x: 1800, y: 100 }, { x: 1800, y: 700 }, { thickness: 100 });
    } else {
      const child = createRoom('bathroom', 1700, 100, 400, 400);
      child.parentId = room.id;
      project.rooms.push(child);
    }
    const validation = validateFurnitureLayout(project, room, deriveWalls(project), { placements: [] });
    const geo008 = validation.ruleResults.find((entry) => entry.ruleId === 'GEO008');
    assert.equal(geo008.status, 'fail', obstacle);
    assert.ok(geo008.metricResults.find((entry) => entry.metric === 'door_swing_collision_count').value > 0);
  }
});

test('непроверенная кинематика двери не получает fallback collision_count=0', () => {
  const project = createProject();
  const room = createRoom('bedroom', 0, 0, 4000, 4000);
  project.rooms.push(room);
  project.openings.push(createOpening('door', room.id, 0, 2000, 900));
  const validation = validateFurnitureLayout(project, room, deriveWalls(project), { placements: [] });
  const geo008 = validation.ruleResults.find((entry) => entry.ruleId === 'GEO008');
  assert.equal(geo008.status, 'unknown');
  assert.equal(
    geo008.metricResults.find((entry) => entry.metric === 'door_swing_collision_count').status,
    'unknown',
  );
});

test('частичная валидация всё равно видит прочую мебель в ходе двери', () => {
  const project = createProject();
  const room = createRoom('bedroom', 0, 0, 4000, 4000);
  const door = createOpening('door', room.id, 0, 2000, 900);
  const chair = createItem('chair', 2000, 450, 450, 450);
  project.rooms.push(room);
  project.openings.push(door);
  project.items.push(chair);

  const validation = validateFurnitureLayout(project, room, deriveWalls(project), { placements: [] }, { itemIds: [] });
  assert.equal(validation.ruleResults.find((entry) => entry.ruleId === 'GEO008').status, 'fail');
});

test('паспортная hosted-дверь не сталкивается с собственной ручной стеной', () => {
  const project = createProject();
  const room = createRoom('bedroom', 0, 0, 4000, 4000);
  const wall = addManualWall(project, { x: 0, y: 2000 }, { x: 4000, y: 2000 }, { thickness: 100 });
  const door = createOpening('door', null, 0, 0, 900);
  delete door.side;
  delete door.offset;
  Object.assign(door, {
    roomId: null,
    host: { wallId: wall.id, t: 2000 },
    swingGeometryStatus: 'verified', leafThicknessMm: 40,
    handleProjectionMm: 60, handleInsetMm: 100,
  });
  project.rooms.push(room);
  project.openings.push(door);

  const validation = validateFurnitureLayout(project, room, deriveWalls(project), { placements: [] });
  const collision = validation.ruleResults.find((entry) => entry.ruleId === 'GEO008')
    .metricResults.find((entry) => entry.metric === 'door_swing_collision_count');
  assert.equal(collision.value, 0);
});

test('одна активная створка double-портала проверяется по ширине створки', () => {
  const project = createProject();
  const room = createRoom('hall', 0, 0, 4000, 4000);
  const door = createOpening('door', room.id, 0, 2000, 900);
  door.type = 'double';
  door.requiredLeafIndices = [0];
  project.rooms.push(room);
  project.openings.push(door);

  const validation = validateFurnitureLayout(project, room, deriveWalls(project), { placements: [] });
  assert.equal(validation.checks.find((entry) => entry.id === 'AUTO-ROUTE-600').status, 'fail');
  assert.match(validation.route.reason, /450 мм меньше 600/);

  delete door.requiredLeafIndices;
  const inactive = doorSwingRects(project, door, deriveWalls(project))[1];
  door.requiredLeafIndices = [0];
  const chair = createItem('chair', inactive.x + inactive.w / 2, inactive.y + inactive.h / 2, 100, 100);
  project.items.push(chair);
  const inactiveLeaf = validateFurnitureLayout(project, room, deriveWalls(project), {
    placements: [{ itemId: chair.id, x: chair.x, y: chair.y, rotation: 0 }],
  });
  assert.equal(
    inactiveLeaf.checks.find((entry) => entry.id === `AUTO-GEOMETRY-${chair.id}`).status,
    'pass',
  );
});

test('soft-правила влияют на рейтинг, unknown остаётся нейтральным', () => {
  assert.equal(layoutRuleScoreAdjustment([
    { severity: 'soft', status: 'pass' },
    { severity: 'soft', status: 'fail' },
    { severity: 'soft', status: 'unknown' },
    { severity: 'hard', status: 'pass' },
  ]), -0.75);
});
