// Сохранение и загрузка: битые данные в проекте не роняют приложение
// (аудит 2026-11b, П-1, П-3, П-4, П-7).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  createProject, createRoom, deserializeProject, fileDataV6, hasContent, normalizeProject,
  normalizeProjectName, serializeProject,
} from '../core/model.js';
import { createLandscapeObject } from '../core/landscape.js';
import { deriveWalls } from '../core/walls.js';
import { normsReport } from '../core/norms.js';
import { buildStructuredExport } from '../core/export.js';

// Данные файла v6 (нормализация чистит именно их; файл v7 сводится к ним, core/v7/file.js).
const base = () => JSON.parse(JSON.stringify(fileDataV6(createProject())));
const fixture = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

// Всё, что приложение делает с проектом сразу после открытия.
function useEverywhere(project) {
  deriveWalls(project);
  normsReport(project);
  buildStructuredExport(project);
}

test('название проекта: пробелы, пустое значение и лимит облака', () => {
  assert.equal(normalizeProjectName('  Дом у моря  '), 'Дом у моря');
  assert.equal(normalizeProjectName('   '), 'Без названия');
  assert.equal(Array.from(normalizeProjectName('Я'.repeat(250))).length, 200);
});

test('битые комнаты: null, строки, NaN — отброшены; числа-строки приведены', () => {
  const data = base();
  data.levels[0].rooms = [
    null, 'room', 42, { x: 'abc', y: NaN, w: '4000', h: 3000 },
    { id: 'ok', type: 'living', x: '0', y: 0, w: '4000', h: 3000, outline: 'кривой', parentId: 'нет-такой' },
  ];
  const p = deserializeProject(JSON.stringify(data));
  assert.equal(p.rooms.length, 1);
  const r = p.rooms[0];
  assert.deepEqual([r.x, r.y, r.w, r.h], [0, 0, 4000, 3000]);
  assert.equal('outline' in r, false);
  assert.equal(r.parentId, null);
  useEverywhere(p);
});

test('битые проёмы и мебель отбрасываются, нормы и экспорт не падают', () => {
  const data = base();
  const room = createRoom('living', 0, 0, 5000, 4000);
  data.levels[0].rooms = [room];
  data.levels[0].openings = [null, { kind: 'door', roomId: room.id, side: 9, offset: 100, width: 900 },
    { kind: 'window', roomId: room.id, side: '1', offset: '2000', width: 1200 }];
  data.levels[0].items = [null, 'chair', { kind: 'sofa', x: 1000, y: 1000, w: 'x', h: 900 },
    { kind: 'sofa', x: 1000, y: 1000, w: 2000, h: 900, rotation: 'вбок' }];
  const p = deserializeProject(JSON.stringify(data));
  assert.equal(p.openings.length, 1);
  assert.equal(p.openings[0].side, 1);
  assert.equal(p.openings[0].offset, 2000);
  assert.equal(p.items.length, 1);
  assert.equal(p.items[0].rotation, 0);
  useEverywhere(p);
});

test('битый участок: граница, дороги, соседи, въезд, site строкой', () => {
  const data = base();
  data.site.boundary = [{ x: 'a' }, null, { x: 0, y: 0 }];
  data.site.roads = 'x';
  data.site.neighbors = [null, { x: 1, y: 2, w: 3000, h: '3000' }];
  data.site.entry = 'въезд';
  data.site.north = 'север';
  data.site.sun = 'солнце';
  let p = deserializeProject(JSON.stringify(data));
  assert.equal(p.site.boundary, null);
  assert.deepEqual(p.site.roads, []);
  assert.equal(p.site.neighbors.length, 1);
  assert.equal(p.site.neighbors[0].h, 3000);
  assert.equal(p.site.entry, null);
  assert.equal(p.site.north, 0);
  assert.equal(typeof p.site.sun.time, 'number');
  useEverywhere(p);

  data.site = 'oops';
  p = deserializeProject(JSON.stringify(data));
  assert.equal(p.site.boundary, null);
  assert.equal(p.site['0'], undefined); // строка не раскладывается посимвольно
  useEverywhere(p);
});

test('битые этажи: null-этаж выкидывается, wallOverrides и settings — объекты', () => {
  const data = base();
  data.levels = [null, { ...data.levels[0], wallOverrides: 'x' }];
  data.settings = 'нет';
  data.variants = [null, { house: { levels: [null, { rooms: [null], openings: [], items: [] }] } }];
  const p = deserializeProject(JSON.stringify(data));
  assert.equal(p.levels.length, 1);
  assert.deepEqual(p.levels[0].wallOverrides, {});
  assert.equal(p.settings.units, 'mm');
  assert.equal(p.variants.length, 1);
  assert.deepEqual(p.variants[0].house.levels[0].rooms, []);
  useEverywhere(p);
});

test('нормализация не портит правильные проекты (фикстуры v1–v4) и идемпотентна', () => {
  for (const name of ['v1-project.kepler.json', 'v2-project.kepler.json', 'v3-project.kepler.json', 'v4-project.kepler.json', 'user-house-2026-11.json']) {
    const p = deserializeProject(fixture(name));
    const once = serializeProject(p);
    const twice = serializeProject(normalizeProject(JSON.parse(JSON.stringify(fileDataV6(p)))));
    assert.equal(twice, once, name);
    const raw = JSON.parse(fixture(name));
    const rooms = (raw.levels || [{ rooms: raw.rooms }]).reduce((s, l) => s + (l.rooms?.length || 0), 0);
    assert.equal(p.levels.reduce((s, l) => s + l.rooms.length, 0), rooms, name);
    useEverywhere(p);
  }
});

test('hasContent: ландшафт, рельеф, подложка, граница — тоже содержимое', () => {
  const empty = createProject();
  assert.equal(hasContent(empty), false);
  assert.equal(hasContent(null), false);
  const withLandscape = createProject();
  withLandscape.site.landscape.objects.push({ id: 't1', kind: 'tree', x: 0, y: 0 });
  assert.equal(hasContent(withLandscape), true);
  const withBoundary = createProject();
  withBoundary.site.boundary = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }];
  assert.equal(hasContent(withBoundary), true);
  const withUnderlay = createProject();
  withUnderlay.site.underlay = { src: 'data:image/png;base64,AAAA', x: 0, y: 0, mmPerPx: 1 };
  assert.equal(hasContent(withUnderlay), true);
  const withTerrain = createProject();
  withTerrain.site.terrain = { points: [{ x: 0, y: 0, z: 1 }] };
  assert.equal(hasContent(withTerrain), true);
  const withRoom = createProject();
  withRoom.rooms.push(createRoom('living', 0, 0, 4000, 4000));
  assert.equal(hasContent(withRoom), true);
});

test('ландшафт без комнат переживает сохранение и загрузку', () => {
  const p = createProject();
  p.site.landscape.objects.push(createLandscapeObject('tree-oak', 1000, 2000));
  const back = deserializeProject(serializeProject(p, { pretty: false }));
  assert.equal(hasContent(back), true);
  assert.ok(back.site.landscape.objects.length >= 1);
});

test('serializeProject pretty: false — без отступов, тот же проект', () => {
  const p = createProject();
  p.rooms.push(createRoom('living', 0, 0, 4000, 4000));
  const compact = serializeProject(p, { pretty: false });
  assert.ok(!compact.includes('\n'));
  assert.ok(compact.length < serializeProject(p).length);
  assert.equal(serializeProject(deserializeProject(compact)), serializeProject(p));
});
