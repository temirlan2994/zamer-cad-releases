import test from 'node:test';
import assert from 'node:assert/strict';

import { analyzeHomeCirculation } from '../core/home-circulation.js';
import { withDefaultComp } from '../core/composite.js';
import { buildRoomWalkGrid } from '../core/ergonomics.js';
import {
  createItem, createLevel, createOpening, createProject, createRoom,
} from '../core/model.js';
import { roomContainsPoint } from '../core/room-shape.js';
import { addManualWall } from '../core/wall-manual.js';

function room(level, id, type, x, y, w, h) {
  const value = createRoom(type, x, y, w, h);
  value.id = id;
  level.rooms.push(value);
  return value;
}

function item(level, id, kind, x, y, w = 800, h = 800, rotation = 0) {
  const value = createItem(kind, x, y, w, h, rotation);
  value.id = id;
  level.items.push(value);
  return value;
}

const endpoint = (levelId, roomId, anchorId = null) => ({
  levelId, roomId,
  anchorType: anchorId ? 'item' : null,
  anchorId,
});

function route({ id = 'route', levelId = 'L1', roomIds = ['room'], from = null, to = null, transitions = [], status = null } = {}) {
  const keys = roomIds.map((roomId) => `${levelId}:${roomId}`);
  return {
    id, scenarioId: 'SCN001', routeId: id,
    status: status || (roomIds.length === 1 ? 'co_located' : 'direct'),
    levelId,
    fromRoomKey: keys[0], toRoomKey: keys[keys.length - 1],
    fromEndpoint: from || endpoint(levelId, roomIds[0]),
    toEndpoint: to || endpoint(levelId, roomIds[roomIds.length - 1]),
    pathRoomKeys: keys,
    transitions,
  };
}

function flows(routes, frequency = { known: true, value: 3, period: 'day' }) {
  return {
    functionalRoutes: [],
    scenarios: [{ scenarioId: 'SCN001', title: 'Сценарий', frequency, routes }],
  };
}

test('путь огибает мебель и использует диагонали без пересечения препятствия', () => {
  const project = createProject('Обход');
  const level = project.levels[0];
  room(level, 'room', 'living', 0, 0, 6000, 4000);
  item(level, 'from', 'armchair', 700, 2000, 600, 600);
  item(level, 'to', 'desk', 5300, 2000, 700, 600);
  item(level, 'barrier', 'wardrobe', 3000, 2000, 1200, 2000);
  const input = route({
    from: endpoint('L1', 'room', 'from'),
    to: endpoint('L1', 'room', 'to'),
  });
  const result = analyzeHomeCirculation(project, { flows: flows([input]), profileWidthMm: 600 });
  const found = result.routes[0];
  assert.ok(['clear', 'narrow'].includes(found.status), found.reason);
  assert.ok(found.points.some((point) => Math.abs(point.y - 2000) > 800), 'маршрут огибает шкаф');
  assert.ok(found.points.some((point, index) => index > 0
    && point.x !== found.points[index - 1].x && point.y !== found.points[index - 1].y), 'есть диагональный участок');
});

test('Г-образная комната не превращается в габаритный прямоугольник', () => {
  const project = createProject('Г-контур');
  const level = project.levels[0];
  const shaped = room(level, 'room', 'living', 0, 0, 6000, 5000);
  shaped.outline = [
    { x: 0, y: 0 }, { x: 6000, y: 0 }, { x: 6000, y: 2000 },
    { x: 3000, y: 2000 }, { x: 3000, y: 5000 }, { x: 0, y: 5000 },
  ];
  item(level, 'from', 'armchair', 1000, 4000, 500, 500);
  item(level, 'to', 'desk', 5000, 1000, 500, 500);
  const input = route({ from: endpoint('L1', 'room', 'from'), to: endpoint('L1', 'room', 'to') });
  const found = analyzeHomeCirculation(project, { flows: flows([input]) }).routes[0];
  assert.ok(['clear', 'narrow'].includes(found.status), found.reason);
  assert.ok(found.points.every((point) => roomContainsPoint(shaped, point.x, point.y)));
  assert.ok(found.points.every((point) => !(point.x > 3000 && point.y > 2000)));
});

test('вогнутая часть bbox вложенной Г-комнаты остаётся свободной', () => {
  const project = createProject('Вложенная Г-комната');
  const level = project.levels[0];
  const parent = room(level, 'parent', 'living', 0, 0, 8000, 6000);
  const child = room(level, 'child', 'bathroom', 2000, 1000, 4000, 4000);
  child.parentId = parent.id;
  child.outline = [
    { x: 0, y: 0 }, { x: 4000, y: 0 }, { x: 4000, y: 1500 },
    { x: 1500, y: 1500 }, { x: 1500, y: 4000 }, { x: 0, y: 4000 },
  ];
  item(level, 'from', 'armchair', 4200, 3500, 500, 500);
  item(level, 'to', 'desk', 5500, 4300, 500, 500);
  const input = route({
    levelId: 'L1', roomIds: ['parent'],
    from: endpoint('L1', 'parent', 'from'), to: endpoint('L1', 'parent', 'to'),
  });
  const found = analyzeHomeCirculation(project, { flows: flows([input]), profileWidthMm: 600 }).routes[0];
  assert.ok(['clear', 'narrow'].includes(found.status), found.reason);
  assert.ok(found.points.every((point) => !roomContainsPoint(child, point.x, point.y)));
});

test('ручная стена участвует в поиске пути и не пропускает профиль сквозь тело', () => {
  const project = createProject('Ручная стена');
  const level = project.levels[0];
  room(level, 'room', 'living', 0, 0, 6000, 4000);
  item(level, 'from', 'armchair', 1000, 2000, 500, 500);
  item(level, 'to', 'desk', 5000, 2000, 500, 500);
  addManualWall(project, { x: 3000, y: 0 }, { x: 3000, y: 3800 });
  const input = route({ from: endpoint('L1', 'room', 'from'), to: endpoint('L1', 'room', 'to') });
  const found = analyzeHomeCirculation(project, { flows: flows([input]), profileWidthMm: 600 }).routes[0];
  assert.equal(found.status, 'blocked');
  assert.equal(found.points.length, 0, 'заблокированный маршрут не получает выдуманную линию');
});

test('точный предмет не перепрыгивает через замкнутые ручные стены', () => {
  const project = createProject('Замкнутый предмет');
  const level = project.levels[0];
  room(level, 'room', 'living', 0, 0, 6000, 4000);
  item(level, 'from', 'armchair', 1600, 2000, 500, 500);
  item(level, 'to', 'desk', 5200, 2000, 500, 500);
  const corners = [
    [{ x: 1000, y: 1400 }, { x: 2200, y: 1400 }],
    [{ x: 2200, y: 1400 }, { x: 2200, y: 2600 }],
    [{ x: 2200, y: 2600 }, { x: 1000, y: 2600 }],
    [{ x: 1000, y: 2600 }, { x: 1000, y: 1400 }],
  ];
  for (const [from, to] of corners) addManualWall(project, from, to, { thickness: 200 });
  const input = route({ from: endpoint('L1', 'room', 'from'), to: endpoint('L1', 'room', 'to') });
  const found = analyzeHomeCirculation(project, { flows: flows([input]), profileWidthMm: 600 }).routes[0];
  assert.ok(['blocked', 'unknown'].includes(found.status), found.reason);
  assert.equal(found.points.length, 0);
});

test('точный предмет не перепрыгивает узкий подход ради более широкой клетки', () => {
  const project = createProject('Узкий подход');
  const level = project.levels[0];
  room(level, 'room', 'living', 0, 0, 6000, 4000);
  item(level, 'from', 'armchair', 1600, 2000, 300, 300);
  item(level, 'to', 'desk', 5200, 2000, 500, 500);
  addManualWall(project, { x: 0, y: 1625 }, { x: 2500, y: 1625 }, { thickness: 100 });
  addManualWall(project, { x: 0, y: 2375 }, { x: 2500, y: 2375 }, { thickness: 100 });
  const input = route({ from: endpoint('L1', 'room', 'from'), to: endpoint('L1', 'room', 'to') });
  const found = analyzeHomeCirculation(project, { flows: flows([input]), profileWidthMm: 600 }).routes[0];
  assert.equal(found.status, 'narrow');
  assert.ok(found.minWidthMm >= 600 && found.minWidthMm < 800, String(found.minWidthMm));
  assert.ok(found.points[0].x < 2500, 'линия начинается у предмета до узкого горлышка');
});

test('сервисная точка не перепрыгивает коридор уже расчётного профиля', () => {
  const project = createProject('Слишком узкий подход');
  const level = project.levels[0];
  room(level, 'room', 'living', 0, 0, 6000, 4000);
  item(level, 'from', 'armchair', 1600, 2000, 300, 300);
  item(level, 'to', 'desk', 5200, 2000, 500, 500);
  addManualWall(project, { x: 0, y: 1700 }, { x: 2500, y: 1700 }, { thickness: 100 });
  addManualWall(project, { x: 0, y: 2300 }, { x: 2500, y: 2300 }, { thickness: 100 });
  const input = route({ from: endpoint('L1', 'room', 'from'), to: endpoint('L1', 'room', 'to') });
  const found = analyzeHomeCirculation(project, { flows: flows([input]), profileWidthMm: 600 }).routes[0];
  assert.ok(['blocked', 'unknown'].includes(found.status), found.reason);
  assert.equal(found.points.length, 0);
});

test('проём в перекрытии является пустотой, а не свободным полом', () => {
  const project = createProject('Проём в полу');
  const level = project.levels[0];
  room(level, 'room', 'living', 0, 0, 6000, 3000);
  item(level, 'from', 'armchair', 600, 1500, 500, 500);
  item(level, 'to', 'desk', 5400, 1500, 500, 500);
  level.slabOpenings = [{ id: 'hole', x: 2500, y: 0, w: 1000, h: 3000 }];
  const input = route({ from: endpoint('L1', 'room', 'from'), to: endpoint('L1', 'room', 'to') });
  const found = analyzeHomeCirculation(project, { flows: flows([input]), profileWidthMm: 600 }).routes[0];
  assert.equal(found.status, 'blocked');
  assert.equal(found.points.length, 0);
});

test('ряд отдельных стульев учитывается как текущее препятствие', () => {
  const project = createProject('Стулья');
  const level = project.levels[0];
  room(level, 'room', 'living', 0, 0, 6000, 3000);
  item(level, 'from', 'armchair', 600, 1500, 500, 500);
  item(level, 'to', 'desk', 5400, 1500, 500, 500);
  for (const [index, y] of [500, 1500, 2500].entries()) {
    item(level, `chair-${index}`, 'office-chair', 3000, y, 800, 800);
  }
  const input = route({ from: endpoint('L1', 'room', 'from'), to: endpoint('L1', 'room', 'to') });
  const found = analyzeHomeCirculation(project, { flows: flows([input]), profileWidthMm: 600 }).routes[0];
  assert.equal(found.status, 'blocked');
});

test('видимые стулья составного обеденного стола входят в препятствия', () => {
  const project = createProject('Обеденная группа');
  const level = project.levels[0];
  const living = room(level, 'room', 'living', 0, 0, 6000, 4000);
  const table = withDefaultComp(createItem('dining-table', 3000, 2000, 1600, 900));
  table.id = 'dining';
  level.items.push(table);
  const grid = buildRoomWalkGrid(project, living, []);
  assert.ok(grid.obstacles.filter((obstacle) => obstacle.kind === 'item'
    && obstacle.id === table.id).length > 1, 'столешница и стулья имеют отдельные контуры');
});

test('узкий зазор блокирует профиль 600 мм, но пропускает меньший профиль', () => {
  const project = createProject('Узкий зазор');
  const level = project.levels[0];
  room(level, 'room', 'living', 0, 0, 5000, 3000);
  item(level, 'from', 'armchair', 700, 2600, 500, 400);
  item(level, 'to', 'desk', 4300, 2600, 500, 400);
  item(level, 'barrier', 'wardrobe', 2500, 1205, 500, 2410);
  const input = route({ from: endpoint('L1', 'room', 'from'), to: endpoint('L1', 'room', 'to') });
  const wide = analyzeHomeCirculation(project, { flows: flows([input]), profileWidthMm: 600 });
  const narrow = analyzeHomeCirculation(project, { flows: flows([input]), profileWidthMm: 450 });
  assert.equal(wide.routes[0].status, 'blocked');
  assert.ok(['clear', 'narrow'].includes(narrow.routes[0].status), narrow.routes[0].reason);
});

test('чистая ширина двери входит в bottleneck маршрута', () => {
  const project = createProject('Дверь');
  const level = project.levels[0];
  const a = room(level, 'a', 'living', 0, 0, 3000, 3000);
  room(level, 'b', 'living', 3100, 0, 3000, 3000);
  item(level, 'from', 'armchair', 800, 1500, 500, 500);
  item(level, 'to', 'desk', 5300, 1500, 500, 500);
  const opening = createOpening('door', a.id, 1, 1500, 620);
  opening.id = 'door-ab';
  level.openings.push(opening);
  const transition = {
    transitionKey: 'L1:a|b', levelId: 'L1',
    aRoomKey: 'L1:a', bRoomKey: 'L1:b',
    openingIds: ['door-ab'], evidenceKinds: ['door'],
  };
  const input = route({
    roomIds: ['a', 'b'],
    from: endpoint('L1', 'a', 'from'), to: endpoint('L1', 'b', 'to'),
    transitions: [transition],
  });
  const result = analyzeHomeCirculation(project, { flows: flows([input]), profileWidthMm: 600 });
  assert.ok(['clear', 'narrow'].includes(result.routes[0].status), result.routes[0].reason);
  assert.equal(result.routes[0].minWidthMm, 620);
  assert.equal(result.routes[0].bottleneck.openingId, 'door-ab');
});

test('мебель перед промежуточной дверью не позволяет порталу перепрыгнуть препятствие', () => {
  const project = createProject('Перекрытая дверь');
  const level = project.levels[0];
  const a = room(level, 'a', 'living', 0, 0, 3000, 3000);
  room(level, 'b', 'living', 3100, 0, 3000, 3000);
  item(level, 'from', 'armchair', 700, 1500, 500, 500);
  item(level, 'to', 'desk', 5400, 1500, 500, 500);
  item(level, 'blocker', 'wardrobe', 2500, 1500, 800, 2200);
  const opening = createOpening('door', a.id, 1, 1500, 800);
  opening.id = 'door-ab';
  level.openings.push(opening);
  const input = route({
    roomIds: ['a', 'b'],
    from: endpoint('L1', 'a', 'from'), to: endpoint('L1', 'b', 'to'),
    transitions: [{
      transitionKey: 'L1:a|b', levelId: 'L1',
      aRoomKey: 'L1:a', bRoomKey: 'L1:b', openingIds: ['door-ab'], evidenceKinds: ['door'],
    }],
  });
  const found = analyzeHomeCirculation(project, { flows: flows([input]), profileWidthMm: 600 }).routes[0];
  assert.equal(found.status, 'blocked');
  assert.equal(found.reasonCode, 'portal_approach_blocked');
  assert.equal(found.points.length, 0);
});

test('узкая дверь как конечная точка блокирует более широкий профиль', () => {
  const project = createProject('Наружная дверь');
  const level = project.levels[0];
  const living = room(level, 'room', 'living', 0, 0, 6000, 4000);
  item(level, 'to', 'desk', 5000, 2000, 500, 500);
  const door = createOpening('door', living.id, 0, 2000, 500);
  door.id = 'entry';
  level.openings.push(door);
  const input = route({
    from: { levelId: 'L1', roomId: 'room', anchorType: 'opening', anchorId: 'entry' },
    to: endpoint('L1', 'room', 'to'),
  });
  const found = analyzeHomeCirculation(project, { flows: flows([input]), profileWidthMm: 600 }).routes[0];
  assert.equal(found.status, 'blocked');
  assert.equal(found.minWidthMm, 500);
  assert.equal(found.bottleneck.openingId, 'entry');
});

test('общая стена без двери и окно не создают детальный маршрут', () => {
  const project = createProject('Нет прохода');
  const level = project.levels[0];
  const a = room(level, 'a', 'living', 0, 0, 3000, 3000);
  room(level, 'b', 'living', 3100, 0, 3000, 3000);
  const window = createOpening('window', a.id, 1, 1500, 1200);
  window.id = 'window-ab';
  level.openings.push(window);
  const missing = route({ roomIds: ['a', 'b'], status: 'missing' });
  missing.reasonCode = 'adjacent_without_door';
  const result = analyzeHomeCirculation(project, { flows: flows([missing]) });
  assert.equal(result.routes[0].status, 'blocked');
  assert.equal(result.routes[0].points.length, 0);
});

test('внутри одной комнаты без точных якорей результат остаётся unknown', () => {
  const project = createProject('Нет точек');
  room(project.levels[0], 'room', 'living', 0, 0, 4000, 3000);
  const result = analyzeHomeCirculation(project, { flows: flows([route()]) });
  assert.equal(result.routes[0].status, 'unknown');
  assert.equal(result.routes[0].reasonCode, 'anchor_position_unknown');
});

test('межэтажный путь остаётся unknown без геометрического коннектора', () => {
  const project = createProject('Этажи');
  room(project.levels[0], 'a', 'living', 0, 0, 3000, 3000);
  const upper = createLevel('2 этаж', 3000, 3000, 'L2');
  room(upper, 'b', 'living', 0, 0, 3000, 3000);
  project.levels.push(upper);
  const input = route({ roomIds: ['a'], status: 'unknown' });
  input.pathRoomKeys = ['L1:a', 'L2:b'];
  input.reasonCode = 'vertical_connector_unknown';
  const result = analyzeHomeCirculation(project, { flows: flows([input]) });
  assert.equal(result.routes[0].status, 'unknown');
  assert.equal(result.routes[0].points.length, 0);
});

test('удалённая конечная комната остаётся unknown, а не доказанной блокировкой', () => {
  const project = createProject('Удалённая комната');
  const missing = route({ status: 'missing' });
  missing.reasonCode = 'missing_endpoint';
  missing.pathRoomKeys = [];
  const found = analyzeHomeCirculation(project, { flows: flows([missing]) }).routes[0];
  assert.equal(found.status, 'unknown');
  assert.equal(found.reasonCode, 'missing_endpoint');
});

test('нагрузка разных периодов хранится раздельно, неизвестная не становится нулём', () => {
  const project = createProject('Частоты');
  const level = project.levels[0];
  room(level, 'room', 'living', 0, 0, 5000, 3000);
  item(level, 'from', 'armchair', 700, 1500, 500, 500);
  item(level, 'to', 'desk', 4300, 1500, 500, 500);
  const base = route({ from: endpoint('L1', 'room', 'from'), to: endpoint('L1', 'room', 'to') });
  const scenario = (id, frequency) => ({
    scenarioId: id, title: id, frequency,
    routes: [{ ...base, id: `${id}:route`, scenarioId: id }],
  });
  const result = analyzeHomeCirculation(project, { flows: {
    functionalRoutes: [],
    scenarios: [
      scenario('day', { known: true, value: 2, period: 'day' }),
      scenario('week', { known: true, value: 4, period: 'week' }),
      scenario('unknown', { known: false, value: null, period: null }),
    ],
  } });
  const heat = result.levels[0].heat;
  assert.deepEqual(heat.periods, ['day', 'week']);
  assert.ok(heat.cells.some((cell) => cell.frequencyByPeriod.day === 2
    && cell.frequencyByPeriod.week === 4));
  assert.equal(heat.unknownFrequencyRouteCount, 1);
});

test('одинаковый проект даёт детерминированный путь', () => {
  const project = createProject('Детерминизм');
  const level = project.levels[0];
  room(level, 'room', 'living', 0, 0, 5000, 3000);
  item(level, 'from', 'armchair', 700, 1500, 500, 500);
  item(level, 'to', 'desk', 4300, 1500, 500, 500);
  const input = route({ from: endpoint('L1', 'room', 'from'), to: endpoint('L1', 'room', 'to') });
  const first = analyzeHomeCirculation(project, { flows: flows([input]) });
  const second = analyzeHomeCirculation(project, { flows: flows([input]) });
  assert.deepEqual(first.routes[0].points, second.routes[0].points);
  assert.deepEqual(first.routes[0].bottleneck, second.routes[0].bottleneck);
});

test('превышение бюджета оставляет маршрут неизвестным', () => {
  const project = createProject('Бюджет');
  room(project.levels[0], 'room', 'living', 0, 0, 10000, 10000);
  const result = analyzeHomeCirculation(project, { flows: flows([route()]), maxCells: 10 });
  assert.equal(result.summary.budgetExceeded, true);
  assert.equal(result.routes[0].reasonCode, 'analysis_budget_exceeded');
});

test('общий бюджет поиска честно оставляет лишние маршруты неизвестными', () => {
  const project = createProject('Бюджет маршрутов');
  const level = project.levels[0];
  room(level, 'room', 'living', 0, 0, 5000, 3000);
  item(level, 'from', 'armchair', 700, 1500, 500, 500);
  item(level, 'to', 'desk', 4300, 1500, 500, 500);
  const first = route({ id: 'a', from: endpoint('L1', 'room', 'from'), to: endpoint('L1', 'room', 'to') });
  const second = route({ id: 'b', from: endpoint('L1', 'room', 'from'), to: endpoint('L1', 'room', 'to') });
  const result = analyzeHomeCirculation(project, {
    flows: flows([first, second]), maxRouteSearches: 1,
  });
  assert.ok(['clear', 'narrow'].includes(result.routes[0].status));
  assert.equal(result.routes[1].status, 'unknown');
  assert.equal(result.routes[1].reasonCode, 'analysis_budget_exceeded');
  assert.equal(result.status, 'unknown', 'неизвестный маршрут важнее локального тесного/свободного итога');
  assert.equal(result.summary.budgetExceeded, true);
});

test('бюджет точек подхода не позволяет множеству якорей зависнуть', () => {
  const project = createProject('Бюджет якорей');
  const level = project.levels[0];
  room(level, 'room', 'living', 0, 0, 10000, 10000);
  item(level, 'from', 'armchair', 1200, 1200, 500, 500);
  item(level, 'to', 'desk', 8800, 8800, 500, 500);
  const input = route({ from: endpoint('L1', 'room', 'from'), to: endpoint('L1', 'room', 'to') });
  const result = analyzeHomeCirculation(project, {
    flows: flows([input]), maxAnchorChecks: 1,
  });
  assert.equal(result.routes[0].status, 'unknown');
  assert.equal(result.routes[0].reasonCode, 'analysis_budget_exceeded');
  assert.equal(result.summary.budgetExceeded, true);
});

test('без маршрутов сетки комнат не строятся', () => {
  const project = createProject('Без маршрутов');
  room(project.levels[0], 'room', 'living', 0, 0, 10000, 10000);
  const result = analyzeHomeCirculation(project, { flows: { functionalRoutes: [], scenarios: [] } });
  assert.equal(result.summary.routeCount, 0);
  assert.equal(result.summary.analyzedCellCount, 0);
});
