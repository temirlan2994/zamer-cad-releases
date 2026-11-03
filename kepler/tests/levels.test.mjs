// Этажи: данные по этажам, активный этаж, миграция, связность и экспорт.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  createProject, createRoom, createOpening, createLevel, serializeProject, deserializeProject,
  levelProject, sortedLevels, groundLevel, levelBelow, isUpperLevel, SCHEMA,
} from '../core/model.js';
import { analyzeConnectivity } from '../core/rooms.js';
import { buildStructuredExport, buildProjectDxf, buildSitePlanDxf } from '../core/export.js';
import { dxfString } from '../core/zamer/dxf.js';

const fixture = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

function twoFloors() {
  const p = createProject('Двухэтажный');
  p.rooms.push(createRoom('living', 0, 0, 5000, 4000), createRoom('stairs-room', 5100, 0, 2400, 3200));
  const l2 = createLevel('2 этаж', 3000, 2900, 'L2');
  p.levels.push(l2);
  p.activeLevel = 'L2';
  p.rooms.push(createRoom('bedroom', 0, 0, 5000, 4000), createRoom('stairs-room', 5100, 0, 2400, 3200));
  p.activeLevel = 'L1';
  return p;
}

test('project.rooms — комнаты активного этажа; в JSON только levels[]', () => {
  const p = twoFloors();
  assert.deepEqual(p.rooms.map((r) => r.type), ['living', 'stairs-room']);
  p.activeLevel = 'L2';
  assert.deepEqual(p.rooms.map((r) => r.type), ['bedroom', 'stairs-room']);
  p.rooms = p.rooms.filter((r) => r.type !== 'bedroom'); // присваивание пишет в активный этаж
  assert.equal(p.levels[1].rooms.length, 1);
  const json = JSON.parse(serializeProject(p));
  assert.ok(!('rooms' in json) && !('openings' in json) && !('items' in json));
  assert.equal(json.levels.length, 2);
  assert.equal(json.activeLevel, 'L2');
});

test('сохранение и открытие нескольких этажей без потерь', () => {
  const p = twoFloors();
  const back = deserializeProject(serializeProject(p));
  assert.deepEqual(back, p);
  assert.equal(back.rooms.length, 2, 'аксессоры восстановлены');
});

test('порядок этажей, нижний этаж, этаж ниже, вид на этаже', () => {
  const p = twoFloors();
  assert.deepEqual(sortedLevels(p).map((l) => l.id), ['L1', 'L2']);
  assert.equal(groundLevel(p).id, 'L1');
  assert.equal(levelBelow(p, 'L2').id, 'L1');
  assert.equal(levelBelow(p, 'L1'), null);
  assert.equal(isUpperLevel(p, 'L2'), true);
  assert.equal(isUpperLevel(p, 'L1'), false);
  const view = levelProject(p, 'L2');
  assert.equal(view.rooms[0].type, 'bedroom');
  assert.equal(p.rooms[0].type, 'living', 'исходный проект не переключился');
});

test('файл версии 3: комнаты переезжают в первый этаж', () => {
  const raw = JSON.parse(fixture('v3-project.kepler.json'));
  const p = deserializeProject(JSON.stringify(raw));
  assert.equal(p.schema, SCHEMA);
  assert.equal(p.levels.length, 1);
  assert.deepEqual({ id: p.levels[0].id, elevation: p.levels[0].elevation, height: p.levels[0].height }, { id: 'L1', elevation: 0, height: 3000 });
  assert.deepEqual(p.rooms, raw.rooms);
  assert.deepEqual(p.openings, raw.openings);
  assert.deepEqual(p.items, raw.items);
  assert.deepEqual(p.wallOverrides, raw.wallOverrides);
  assert.deepEqual(p.building, raw.building);
});

test('верхний этаж: вход — лестница', () => {
  const p = twoFloors();
  p.activeLevel = 'L2';
  let a = analyzeConnectivity(p);
  assert.equal(a.hasEntrance, true);
  const bedroom = p.rooms.find((r) => r.type === 'bedroom');
  assert.ok(a.unreachable.includes(bedroom.id), 'без двери спальня недоступна');
  // Дверь между спальней и лестницей (общая стена: правая сторона спальни).
  p.openings.push(createOpening('door', bedroom.id, 1, 1500, 900));
  a = analyzeConnectivity(p);
  assert.deepEqual(a.unreachable, []);
  // На первом этаже лестница входом не считается.
  p.activeLevel = 'L1';
  assert.equal(analyzeConnectivity(p).hasEntrance, false);
});

test('экспорт: этажи снизу вверх, DXF плана с обоими этажами, генплан — нижний', () => {
  const p = twoFloors();
  const data = buildStructuredExport(p);
  assert.deepEqual(data.levels.map((l) => [l.id, l.elevation, l.height, l.rooms.length]), [['L1', 0, 3000, 2], ['L2', 3000, 2900, 2]]);
  assert.ok(data.levels.every((l) => l.connections && Array.isArray(l.walls)));
  const dxf = buildProjectDxf(p);
  assert.ok(dxf.includes(dxfString('1 этаж (0.00)')) && dxf.includes(dxfString('2 этаж (3.00)')));
  p.site.boundary = [{ x: -9000, y: -9000 }, { x: 16000, y: -9000 }, { x: 16000, y: 14000 }, { x: -9000, y: 14000 }];
  const site = buildSitePlanDxf(p);
  assert.ok(site.includes(dxfString('Гостиная')) && !site.includes(dxfString('Спальня')), 'генплан по нижнему этажу');
});
