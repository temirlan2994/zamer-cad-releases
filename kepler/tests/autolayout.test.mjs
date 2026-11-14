// Многовариантная авторасстановка: поиск с откатом, сложный контур,
// закреплённые предметы и независимая проверка результата.
import test from 'node:test';
import assert from 'node:assert/strict';

import { applyFurnitureLayout, generateFurnitureLayouts, validateFurnitureLayout } from '../core/autolayout.js';
import { createItem, createOpening, createProject, createRoom } from '../core/model.js';
import { roomContainsPoint } from '../core/room-shape.js';
import { addManualWall } from '../core/wall-manual.js';
import { deriveWalls } from '../core/walls.js';

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
  project.rooms.push(room);
  project.openings.push(createOpening('door', room.id, 2, 3100, 900));
  project.items.push(
    createItem('bed-double', 3100, 2500, 1600, 2000),
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
