// Инсоляция по окнам и проверка норм.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createProject, createRoom, createOpening, createLevel } from '../core/model.js';
import {
  insolationZone, insolationNorm, rayEnter, insolationReport, meetsNorm, formatDuration,
} from '../core/insolation.js';
import { roomChecks, normsReport } from '../core/norms.js';

const sq = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];

test('зоны по широте (СанПиН): юг, центр, север', () => {
  assert.deepEqual(insolationZone(43.2), { zone: 'южная', hours: 1.5, day: '02-22', skip: 90 });
  assert.equal(insolationZone(55.7).hours, 2);
  assert.equal(insolationZone(55.7).day, '04-22');
  assert.equal(insolationZone(60).hours, 2.5);
  const site = createProject().site;
  assert.equal(insolationNorm(site).date, '2026-02-22');
  site.norms = { day: '03-01', hours: 3 };
  assert.deepEqual([insolationNorm(site).date, insolationNorm(site).hours], ['2026-03-01', 3]);
});

test('луч и выпуклый многоугольник: вход, промах, изнутри, любой обход', () => {
  assert.equal(rayEnter({ x: -5, y: 5 }, { x: 1, y: 0 }, sq), 5);
  assert.equal(rayEnter({ x: 15, y: 5 }, { x: 1, y: 0 }, sq), null);
  assert.equal(rayEnter({ x: 5, y: 5 }, { x: 0, y: 1 }, sq), 0);
  assert.equal(rayEnter({ x: -5, y: 5 }, { x: 1, y: 0 }, [...sq].reverse()), 5);
  assert.equal(rayEnter({ x: -5, y: 20 }, { x: 1, y: 0 }, sq), null);
});

// Гостиная с окном на юг (низ плана; север = вверх) и спальня с окном на север.
function house() {
  const p = createProject();
  const living = createRoom('living', 0, 0, 5000, 4200);
  const bedroom = createRoom('bedroom', 5100, 0, 4000, 3500);
  p.rooms.push(living, bedroom);
  p.openings.push(createOpening('window', living.id, 2, 2500, 1500));
  p.openings.push(createOpening('window', bedroom.id, 0, 2000, 1500));
  return { p, living, bedroom };
}

test('юг — солнце весь день, север — нет; норма выполнена одной комнатой', () => {
  const { p, living, bedroom } = house();
  const r = insolationReport(p);
  const south = r.rooms.find((x) => x.id === living.id);
  const north = r.rooms.find((x) => x.id === bedroom.id);
  assert.ok(south.longest >= 5 * 60, `юг: ${formatDuration(south.longest)}`);
  assert.equal(north.total, 0);
  assert.equal(south.meets, true);
  assert.deepEqual([r.need, r.met, r.ok], [1, 1, true]);
});

test('высокий соседний дом с юга затеняет окно', () => {
  const { p, living } = house();
  const free = insolationReport(p).rooms.find((x) => x.id === living.id).total;
  // Дом 12 м высотой в 6 м южнее, шире участка.
  p.site.neighbors.push({ id: 'n', x: 2500, y: 4200 + 250 + 6000 + 4000, w: 40000, h: 8000, height: 12000, rot: 0 });
  const shaded = insolationReport(p).rooms.find((x) => x.id === living.id);
  assert.ok(shaded.total < free - 120, `${formatDuration(free)} → ${formatDuration(shaded.total)}`);
  assert.equal(shaded.meets, false);
});

test('поворот дома меняет инсоляцию: окно уходит на север', () => {
  const { p, living } = house();
  p.building = { rotation: 180, origin: { x: 0, y: 0 } };
  assert.equal(insolationReport(p).rooms.find((x) => x.id === living.id).total, 0);
});

test('правило прерывистой инсоляции и «2 комнаты при 4+ жилых»', () => {
  assert.equal(meetsNorm({ longest: 90, total: 90 }, 1.5), true);
  assert.equal(meetsNorm({ longest: 60, total: 120 }, 1.5), true); // 1 ч + суммарно 2 ч
  assert.equal(meetsNorm({ longest: 50, total: 200 }, 1.5), false); // нет периода в 1 ч
  const p = createProject();
  for (let i = 0; i < 4; i += 1) p.rooms.push(createRoom('bedroom', i * 4100, 0, 4000, 3500));
  assert.equal(insolationReport(p).need, 2);
});

test('нормы СП 55: площадь, ширина, свет 1:8, высота', () => {
  const p = createProject();
  const small = createRoom('living', 0, 0, 3000, 3000);
  const kitchen = createRoom('kitchen', 3100, 0, 3600, 1500);
  p.rooms.push(small, kitchen);
  p.openings.push(createOpening('window', small.id, 0, 1500, 1500)); // 2,25 м² на 9 м² = 1:4
  const level = p.levels[0];
  const a = roomChecks(p, small, level);
  assert.equal(a.find((c) => c.kind === 'area').ok, false);
  assert.equal(a.find((c) => c.kind === 'light').ok, true);
  assert.equal(a.find((c) => c.kind === 'height').ok, true);
  const k = roomChecks(p, kitchen, level);
  assert.equal(k.find((c) => c.kind === 'width').ok, false);
  assert.match(k.find((c) => c.kind === 'light').text, /Нет окон/);
  const attic = createLevel('Мансарда', 3000, 2700);
  assert.equal(roomChecks(p, small, attic).find((c) => c.kind === 'height').ok, false);
  const report = normsReport(p);
  assert.equal(report.ok, false);
  assert.ok(report.problems.length >= 3);
});
