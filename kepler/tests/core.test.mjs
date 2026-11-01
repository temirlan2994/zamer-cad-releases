// Тесты геометрического ядра Kepler Plan: стены, стыковка, вложение,
// связность, расстановка свободной мебели и экспорт.
// Запуск: node --test kepler/tests/core.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';

import { createProject, createRoom, createOpening, createItem, serializeProject, deserializeProject } from '../core/model.js';
import { deriveWalls, doorLink, doorSymbol, clampOpeningOffset } from '../core/walls.js';
import {
  validateRoomPlacement, snapRoomPosition, determineParent, moveRoomBy,
  roomNetAreaM2, analyzeConnectivity, suggestAccess, rectsOverlap,
} from '../core/rooms.js';
import { arrangeRoom, defaultItemsFor, itemRect, itemsInRoom, reclaimItemsFromChild } from '../core/furnish.js';
import { computeRoomEdges } from '../core/rooms.js';
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
  const ownOnSharedSide = walls.filter((w) => w.kind === 'own' && w.rooms[0] === a.id && w.sides[a.id] === 1);
  assert.equal(ownOnSharedSide.length, 0);
});

test('комнаты верхнего уровня могут перекрываться (одна съедает другую)', () => {
  const { project, b } = makeTwoDockedRooms();
  // Перекрытие верхнеуровневых комнат теперь разрешено.
  assert.equal(validateRoomPlacement(project, { ...b, x: 3500 }, b.id).ok, true);
  assert.equal(validateRoomPlacement(project, { ...b, x: 4100 }, b.id).ok, true);
  assert.equal(validateRoomPlacement(project, { ...b, x: 6000 }, b.id).ok, true);
});

test('eat-площадь: верхняя комната отнимает перекрытие у нижней', () => {
  const project = createProject();
  const a = createRoom('living', 0, 0, 5000, 4000); // 20 м²
  const b = createRoom('bedroom', 3000, 0, 4000, 4000); // перекрытие по x: 3000..5000 = 2000×4000 = 8 м²
  project.rooms.push(a, b); // b позже в массиве → b съедает a
  assert.ok(Math.abs(roomNetAreaM2(project, a) - 12) < 0.01, `a=${roomNetAreaM2(project, a)}`);
  assert.ok(Math.abs(roomNetAreaM2(project, b) - 16) < 0.01, `b=${roomNetAreaM2(project, b)}`);
  // Поменяли порядок: теперь a съедает b.
  project.rooms = [b, a];
  assert.ok(Math.abs(roomNetAreaM2(project, a) - 20) < 0.01);
  assert.ok(Math.abs(roomNetAreaM2(project, b) - 8) < 0.01);
});

test('привязка при перетаскивании стыкует комнаты через толщину стены', () => {
  const { project, b } = makeTwoDockedRooms();
  const snapped = snapRoomPosition(project, b, 4080, 12, 60, null);
  assert.equal(snapped.x, 4100);
  assert.equal(snapped.y, 0);
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
  assert.equal(validateRoomPlacement(project, { ...bath, x: 4200 }, bath.id).ok, false);
  // 20 м² минус габарит санузла со стенами (2.2×2.2 = 4.84).
  assert.ok(Math.abs(roomNetAreaM2(project, bedroom) - 15.16) < 0.01);
  // Переключение «кто берёт площадь»: спальня остаётся полной.
  bath.takesArea = false;
  assert.ok(Math.abs(roomNetAreaM2(project, bedroom) - 20) < 0.01);
});

test('перемещение комнаты двигает вложенные помещения и мебель внутри', () => {
  const project = createProject();
  const bedroom = createRoom('bedroom', 0, 0, 5000, 4000);
  const bath = createRoom('bathroom', 2900, 200, 2000, 1800);
  bath.parentId = bedroom.id;
  project.rooms.push(bedroom, bath);
  // Мебель свободна: кровать внутри спальни, стол снаружи.
  project.items.push(createItem('bed-double', 1000, 3000, 1600, 2000));
  project.items.push(createItem('table', 20000, 20000, 1400, 800));
  moveRoomBy(project, bedroom.id, 500, -300);
  assert.equal(bath.x, 3400);
  assert.equal(project.items[0].x, 1500); // поехала вместе с комнатой
  assert.equal(project.items[1].x, 20000); // внешняя мебель осталась
});

test('двери и связность: недостижимая комната находится, подсказка осмысленная', () => {
  const { project, a, b } = makeTwoDockedRooms();
  project.openings.push(createOpening('door', a.id, 0, 1200, 800));
  let result = analyzeConnectivity(project);
  assert.equal(result.hasEntrance, true);
  assert.deepEqual(result.unreachable, [b.id]);
  const hint = suggestAccess(project, b.id, result);
  assert.equal(hint.targetId, a.id);
  assert.match(hint.text, /дверь/i);
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
  assert.equal(Math.round(symbol.open.x - symbol.hinge.x), 0);
  assert.equal(Math.round(symbol.open.y - symbol.hinge.y), 800);
});

// --- Сценарий MVP: спальня 5×4, мебель, вложенный санузел, перестройка ---

function furnishedBedroom() {
  const project = createProject();
  const bedroom = createRoom('bedroom', 0, 0, 5000, 4000);
  project.rooms.push(bedroom);
  project.openings.push(createOpening('door', bedroom.id, 2, 2500, 800));
  // Типовой набор: кровать, 2 тумбочки, шкаф — плюс туалетный столик.
  for (const item of defaultItemsFor(bedroom)) project.items.push(item);
  project.items.push(createItem('dressing-table', 2500, 2000, 1000, 450));
  return { project, bedroom };
}

test('MVP: расстановка спальни 5×4 размещает всё без пересечений', () => {
  const { project, bedroom } = furnishedBedroom();
  const rejected = arrangeRoom(project, bedroom, deriveWalls(project));
  assert.equal(rejected.length, 0, `отказы: ${rejected.map((r) => r.reason).join('; ')}`);

  const items = itemsInRoom(project, bedroom);
  const kinds = items.map((i) => i.kind);
  assert.ok(kinds.includes('bed-double'));
  assert.equal(kinds.filter((k) => k === 'nightstand').length, 2);
  assert.ok(kinds.includes('wardrobe'));
  assert.ok(kinds.includes('dressing-table'));

  const rects = items.map((i) => itemRect(i));
  for (let i = 0; i < rects.length; i += 1) {
    for (let j = i + 1; j < rects.length; j += 1) {
      assert.equal(rectsOverlap(rects[i], rects[j]), false,
        `${items[i].kind} пересекается с ${items[j].kind}`);
    }
  }
  for (const r of rects) {
    assert.ok(r.x >= -1 && r.y >= -1 && r.x + r.w <= 5001 && r.y + r.h <= 4001);
  }
});

test('MVP: вложенный санузел 2×2 — мебель перестраивается без пересечений', () => {
  const { project, bedroom } = furnishedBedroom();
  let walls = deriveWalls(project);
  arrangeRoom(project, bedroom, walls);

  const bath = createRoom('bathroom', 2900, 100, 2000, 2000);
  bath.parentId = bedroom.id;
  project.rooms.push(bath);
  assert.equal(validateRoomPlacement(project, bath, bath.id).ok, true);
  project.openings.push(createOpening('door', bath.id, 2, 1000, 700));
  // Мебель спальни из-под нового санузла вытаскивается (как делает редактор).
  reclaimItemsFromChild(project, bedroom, bath);
  for (const item of defaultItemsFor(bath)) project.items.push(item);

  walls = deriveWalls(project);
  const rejectedBedroom = arrangeRoom(project, bedroom, walls);
  arrangeRoom(project, bath, walls);

  const bedroomItems = itemsInRoom(project, bedroom);
  assert.ok(bedroomItems.some((i) => i.kind === 'bed-double'), 'кровать должна поместиться');
  for (const r of rejectedBedroom) assert.match(r.reason, /[а-яА-Я]/);

  const bathOuter = { x: bath.x - 100, y: bath.y - 100, w: bath.w + 200, h: bath.h + 200 };
  const rects = bedroomItems.map((i) => itemRect(i));
  for (const r of rects) assert.equal(rectsOverlap(r, bathOuter), false, 'мебель в санузле');
  for (let i = 0; i < rects.length; i += 1) {
    for (let j = i + 1; j < rects.length; j += 1) {
      assert.equal(rectsOverlap(rects[i], rects[j]), false);
    }
  }
  for (const item of itemsInRoom(project, bath)) {
    const r = itemRect(item);
    assert.ok(r.x >= bath.x - 1 && r.y >= bath.y - 1 && r.x + r.w <= bath.x + bath.w + 1 && r.y + r.h <= bath.y + bath.h + 1);
  }
});

test('MVP: невозможная мебель отклоняется с объяснением и остаётся на месте', () => {
  const project = createProject();
  const tiny = createRoom('bedroom', 0, 0, 1500, 1500);
  project.rooms.push(tiny);
  const bed = createItem('bed-double', 750, 750, 1600, 2000);
  project.items.push(bed);
  const rejected = arrangeRoom(project, tiny, deriveWalls(project));
  assert.equal(rejected.length, 1);
  assert.match(rejected[0].reason, /не помещается|не хватает/i);
  assert.equal(bed.x, 750); // предмет не прыгнул
});

test('мебель свободна: предмет вне комнат никому не мешает', () => {
  const { project } = makeTwoDockedRooms();
  project.items.push(createItem('sofa', 50000, 50000, 2200, 950));
  const walls = deriveWalls(project);
  const rejected = arrangeRoom(project, project.rooms[0], walls);
  assert.equal(rejected.length, 0);
  assert.equal(project.items[0].x, 50000);
});

test('контур комнаты: прямоугольная — 4 ребра, Г-образная — 6 с реальными длинами', () => {
  const project = createProject();
  const a = createRoom('living', 0, 0, 8000, 4000);
  project.rooms.push(a);
  const rectEdges = computeRoomEdges(project, a);
  assert.equal(rectEdges.rectangular, true);
  assert.equal(rectEdges.edges.length, 4);
  // Кабинет съедает верхний правый угол (перекрытие 2000×2000).
  const b = createRoom('cabinet', 6000, 0, 3000, 2000);
  project.rooms.push(b);
  const L = computeRoomEdges(project, a);
  assert.equal(L.rectangular, false);
  assert.equal(L.edges.length, 6);
  const topH = L.edges.filter((e) => e.orient === 'h').map((e) => Math.round(e.to - e.from)).sort((x, y) => x - y);
  // Низ 8000, верхняя часть 6000, ступень 2000.
  assert.deepEqual(topH, [2000, 6000, 8000]);
});

test('экспорт: структурированный JSON и DXF собираются', () => {
  const { project, a } = makeTwoDockedRooms();
  project.openings.push(createOpening('door', a.id, 0, 1200, 800));
  project.openings.push(createOpening('door', a.id, 1, 1500, 800));
  project.openings.push(createOpening('window', project.rooms[1].id, 0, 2500, 1200));
  for (const item of defaultItemsFor(a)) project.items.push(item);
  arrangeRoom(project, a, deriveWalls(project));

  const data = buildStructuredExport(project);
  assert.equal(data.schema, 'kepler-export/1');
  assert.equal(data.levels[0].rooms.length, 2);
  assert.ok(data.levels[0].walls.some((w) => w.shared));
  assert.ok(data.levels[0].walls.every((w) => w.thickness > 0));
  assert.equal(data.connections.has_entrance, true);
  assert.equal(data.connections.unreachable_rooms.length, 0);
  // Мебель привязана к комнате по фактическому положению.
  assert.ok(data.levels[0].furniture.every((f) => f.room === a.id));

  const dxf = buildProjectDxf(project);
  assert.ok(dxf.includes('ENTITIES'));
  assert.ok(dxf.trim().endsWith('EOF'));
  const revit = buildProjectDxf(project, { profile: 'revit' });
  assert.ok(revit.includes('ZAMER_WALLS'));
});

test('сериализация проекта: сохранение и загрузка без потерь', () => {
  const { project } = makeTwoDockedRooms();
  project.openings.push(createOpening('door', project.rooms[0].id, 0, 1200, 800));
  project.items.push(createItem('sofa', 1000, 1000, 2200, 950));
  const text = serializeProject(project);
  const loaded = deserializeProject(text);
  assert.equal(loaded.rooms.length, 2);
  assert.equal(loaded.openings.length, 1);
  assert.equal(loaded.items[0].kind, 'sofa');
  assert.throws(() => deserializeProject('{"schema":"other"}'));
});
