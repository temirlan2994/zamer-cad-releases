// Тесты геометрического ядра Kepler Plan: стены, стыковка, вложение,
// связность, авторасстановка мебели и экспорт. Запуск: node --test kepler/tests/
import test from 'node:test';
import assert from 'node:assert/strict';

import { createProject, createRoom, createOpening, createItem, serializeProject, deserializeProject } from '../core/model.js';
import { deriveWalls, doorLink, doorSymbol, openingRect, clampOpeningOffset } from '../core/walls.js';
import {
  validateRoomPlacement, snapRoomPosition, determineParent, moveRoomBy,
  roomNetAreaM2, analyzeConnectivity, suggestAccess, rectsOverlap,
} from '../core/rooms.js';
import { furnishRoom, refurnishRoom, itemRect } from '../core/furnish.js';
import { buildStructuredExport, buildProjectDxf } from '../core/export.js';

function makeTwoDockedRooms() {
  const project = createProject('Тест');
  const a = createRoom('bedroom', 0, 0, 4000, 3000);
  const b = createRoom('living', 4100, 0, 5000, 3000); // зазор 100 = перегородка
  project.rooms.push(a, b);
  return { project, a, b };
}

test('общая стена двух состыкованных комнат — один объект', () => {
  const { project, a, b } = makeTwoDockedRooms();
  const walls = deriveWalls(project);
  const shared = walls.filter((w) => w.kind === 'shared');
  assert.equal(shared.length, 1);
  assert.equal(shared[0].thickness, 100);
  assert.equal(shared[0].from, 0);
  assert.equal(shared[0].to, 3000);
  assert.deepEqual(new Set(shared[0].rooms), new Set([a.id, b.id]));
  // Сторона комнаты A, выходящая на общую стену, не должна дублироваться own-сегментом.
  const ownOnSharedSide = walls.filter((w) => w.kind === 'own' && w.rooms[0] === a.id && w.sides[a.id] === 1);
  assert.equal(ownOnSharedSide.length, 0);
});

test('пересечение и узкая щель между комнатами запрещены', () => {
  const { project, b } = makeTwoDockedRooms();
  assert.equal(validateRoomPlacement(project, { ...b, x: 3500 }, b.id).ok, false); // пересечение
  assert.equal(validateRoomPlacement(project, { ...b, x: 4050 }, b.id).ok, false); // щель 50 < 100
  assert.equal(validateRoomPlacement(project, { ...b, x: 4100 }, b.id).ok, true); // ровно стена
  assert.equal(validateRoomPlacement(project, { ...b, x: 6000 }, b.id).ok, true); // отдельно
});

test('привязка при перетаскивании стыкует комнаты через толщину стены', () => {
  const { project, a, b } = makeTwoDockedRooms();
  const snapped = snapRoomPosition(project, b, 4080, 12, 60, null);
  assert.equal(snapped.x, 4100); // стыковка к правой стене A
  assert.equal(snapped.y, 0); // выравнивание по верхней кромке
});

test('вложение: санузел внутри спальни, площадь родителя уменьшается', () => {
  const project = createProject();
  const bedroom = createRoom('bedroom', 0, 0, 5000, 4000);
  project.rooms.push(bedroom);
  const bathRect = { x: 2900, y: 200, w: 2000, h: 2000 };
  assert.equal(determineParent(project, bathRect, null), bedroom.id);
  const bath = createRoom('bathroom', bathRect.x, bathRect.y, bathRect.w, bathRect.h);
  bath.parentId = bedroom.id;
  project.rooms.push(bath);
  assert.equal(validateRoomPlacement(project, bath, bath.id).ok, true);
  // Частично снаружи — нельзя.
  assert.equal(validateRoomPlacement(project, { ...bath, x: 4200 }, bath.id).ok, false);
  // 20 м² минус габарит санузла со стенами (2.2×2.2 = 4.84).
  assert.ok(Math.abs(roomNetAreaM2(project, bedroom) - 15.16) < 0.01);
});

test('перемещение комнаты двигает вложенные помещения и мебель', () => {
  const project = createProject();
  const bedroom = createRoom('bedroom', 0, 0, 5000, 4000);
  const bath = createRoom('bathroom', 2900, 200, 2000, 1800);
  bath.parentId = bedroom.id;
  project.rooms.push(bedroom, bath);
  project.items.push(createItem('bed-double', bedroom.id, 1000, 2000, 1600, 2000));
  moveRoomBy(project, bedroom.id, 500, -300);
  assert.equal(bath.x, 3400);
  assert.equal(bath.y, -100);
  assert.equal(project.items[0].x, 1500);
});

test('двери и связность: недостижимая комната находится, подсказка осмысленная', () => {
  const { project, a, b } = makeTwoDockedRooms();
  // Входная дверь в комнату A (верхняя сторона — наружная стена).
  project.openings.push(createOpening('door', a.id, 0, 1200, 800));
  let result = analyzeConnectivity(project);
  assert.equal(result.hasEntrance, true);
  assert.deepEqual(result.unreachable, [b.id]);
  const hint = suggestAccess(project, b.id, result);
  assert.equal(hint.targetId, a.id);
  assert.match(hint.text, /дверь/i);
  // Дверь в общей стене соединяет комнаты.
  project.openings.push(createOpening('door', a.id, 1, 1500, 800));
  result = analyzeConnectivity(project);
  assert.equal(result.unreachable.length, 0);
  const link = doorLink(project, project.openings[1], deriveWalls(project));
  assert.deepEqual(new Set(link), new Set([a.id, b.id]));
});

test('проём не вылезает за пределы стены (clampOpeningOffset)', () => {
  const project = createProject();
  const room = createRoom('bedroom', 0, 0, 4000, 3000);
  project.rooms.push(room);
  const opening = createOpening('door', room.id, 0, 3900, 800);
  const walls = deriveWalls(project);
  const clamped = clampOpeningOffset(project, opening, walls, 3900);
  assert.ok(clamped <= 4000 - 400 - 50);
  assert.ok(clamped >= 450);
});

test('символ двери: створка и дуга согласованы', () => {
  const project = createProject();
  const room = createRoom('bedroom', 0, 0, 4000, 3000);
  project.rooms.push(room);
  const door = createOpening('door', room.id, 0, 2000, 800);
  project.openings.push(door);
  const walls = deriveWalls(project);
  const symbol = doorSymbol(project, door, walls);
  assert.ok(symbol);
  // Открытая створка перпендикулярна стене и направлена внутрь комнаты (вниз).
  assert.equal(Math.round(symbol.open.x - symbol.hinge.x), 0);
  assert.equal(Math.round(symbol.open.y - symbol.hinge.y), 800);
});

// --- Сценарий MVP: спальня 5×4, мебель, вложенный санузел, перестройка ---

test('MVP: авторасстановка спальни 5×4 расставляет всё без пересечений', () => {
  const project = createProject();
  const bedroom = createRoom('bedroom', 0, 0, 5000, 4000);
  bedroom.checklist = { 'bed-double': true, nightstand: true, wardrobe: true, 'dressing-table': true };
  project.rooms.push(bedroom);
  project.openings.push(createOpening('door', bedroom.id, 2, 2500, 800));
  const walls = deriveWalls(project);
  const { placed, rejected } = furnishRoom(project, bedroom, walls);

  assert.equal(rejected.length, 0, `отказы: ${rejected.map((r) => r.reason).join('; ')}`);
  const kinds = placed.map((p) => p.kind);
  assert.ok(kinds.includes('bed-double'));
  assert.equal(kinds.filter((k) => k === 'nightstand').length, 2);
  assert.ok(kinds.includes('wardrobe'));
  assert.ok(kinds.includes('dressing-table'));

  // Без пересечений между предметами.
  const rects = placed.map((p) => itemRect({ ...p }));
  for (let i = 0; i < rects.length; i += 1) {
    for (let j = i + 1; j < rects.length; j += 1) {
      assert.equal(rectsOverlap(rects[i], rects[j]), false,
        `${placed[i].kind} пересекается с ${placed[j].kind}`);
    }
  }
  // Все предметы внутри комнаты.
  for (const r of rects) {
    assert.ok(r.x >= -1 && r.y >= -1 && r.x + r.w <= 5001 && r.y + r.h <= 4001);
  }
});

test('MVP: вложенный санузел 2×2 — мебель перестраивается без пересечений', () => {
  const project = createProject();
  const bedroom = createRoom('bedroom', 0, 0, 5000, 4000);
  bedroom.checklist = { 'bed-double': true, nightstand: true, wardrobe: true, 'dressing-table': true };
  project.rooms.push(bedroom);
  project.openings.push(createOpening('door', bedroom.id, 2, 2500, 800));

  let walls = deriveWalls(project);
  refurnishRoom(project, bedroom, walls, createItem);
  assert.ok(project.items.length >= 4);

  // Добавляем санузел 2×2 в угол спальни.
  const bath = createRoom('bathroom', 2900, 100, 2000, 2000);
  bath.parentId = bedroom.id;
  project.rooms.push(bath);
  assert.equal(validateRoomPlacement(project, bath, bath.id).ok, true);
  project.openings.push(createOpening('door', bath.id, 2, 1000, 700));

  walls = deriveWalls(project);
  const rejectedBedroom = refurnishRoom(project, bedroom, walls, createItem);
  refurnishRoom(project, bath, walls, createItem);

  // Кровать обязана остаться; отказы (если есть) объяснены по-русски.
  const bedroomItems = project.items.filter((i) => i.roomId === bedroom.id);
  assert.ok(bedroomItems.some((i) => i.kind === 'bed-double'), 'кровать должна поместиться');
  for (const r of rejectedBedroom) assert.match(r.reason, /[а-яА-Я]/);

  // Ничего не пересекается: мебель спальни ↔ габарит санузла и между собой.
  const bathOuter = { x: bath.x - 100, y: bath.y - 100, w: bath.w + 200, h: bath.h + 200 };
  const rects = bedroomItems.map((i) => itemRect(i));
  for (const r of rects) assert.equal(rectsOverlap(r, bathOuter), false, 'мебель в санузле');
  for (let i = 0; i < rects.length; i += 1) {
    for (let j = i + 1; j < rects.length; j += 1) {
      assert.equal(rectsOverlap(rects[i], rects[j]), false);
    }
  }
  // Мебель санузла внутри санузла.
  for (const item of project.items.filter((i) => i.roomId === bath.id)) {
    const r = itemRect(item);
    assert.ok(r.x >= bath.x - 1 && r.y >= bath.y - 1 && r.x + r.w <= bath.x + bath.w + 1 && r.y + r.h <= bath.y + bath.h + 1);
  }
});

test('MVP: невозможная мебель отклоняется с объяснением', () => {
  const project = createProject();
  const tiny = createRoom('bedroom', 0, 0, 1500, 1500);
  tiny.checklist = { 'bed-double': true };
  project.rooms.push(tiny);
  const { placed, rejected } = furnishRoom(project, tiny, deriveWalls(project));
  assert.equal(placed.length, 0);
  assert.equal(rejected.length, 1);
  assert.match(rejected[0].reason, /не помещается|не хватает/i);
});

test('экспорт: структурированный JSON и DXF собираются', () => {
  const { project, a, b } = makeTwoDockedRooms();
  project.openings.push(createOpening('door', a.id, 0, 1200, 800));
  project.openings.push(createOpening('door', a.id, 1, 1500, 800));
  project.openings.push(createOpening('window', b.id, 0, 2500, 1200));
  refurnishRoom(project, a, deriveWalls(project), createItem);

  const data = buildStructuredExport(project);
  assert.equal(data.schema, 'kepler-export/1');
  assert.equal(data.levels[0].rooms.length, 2);
  assert.ok(data.levels[0].walls.some((w) => w.shared));
  assert.ok(data.levels[0].walls.every((w) => w.thickness > 0));
  assert.equal(data.connections.has_entrance, true);
  assert.equal(data.connections.unreachable_rooms.length, 0);

  const dxf = buildProjectDxf(project);
  assert.ok(dxf.includes('ENTITIES'));
  assert.ok(dxf.trim().endsWith('EOF'));
  const revit = buildProjectDxf(project, { profile: 'revit' });
  assert.ok(revit.includes('ZAMER_WALLS'));
});

test('сериализация проекта: сохранение и загрузка без потерь', () => {
  const { project } = makeTwoDockedRooms();
  project.openings.push(createOpening('door', project.rooms[0].id, 0, 1200, 800));
  const text = serializeProject(project);
  const loaded = deserializeProject(text);
  assert.equal(loaded.rooms.length, 2);
  assert.equal(loaded.openings.length, 1);
  assert.deepEqual(loaded.rooms[0].checklist, project.rooms[0].checklist);
  assert.throws(() => deserializeProject('{"schema":"other"}'));
});
