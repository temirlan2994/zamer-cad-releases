// Миграции формата файла проекта: старые файлы должны открываться всегда.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createProject, serializeProject, deserializeProject } from '../core/model.js';
import { SCHEMA, SCHEMA_VERSION, MIGRATIONS, migrateProject, schemaVersion } from '../core/migrate.js';

const fixture = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

test('на каждую прошлую версию формата есть настоящий файл-фикстура', () => {
  for (let v = 1; v < SCHEMA_VERSION; v += 1) {
    assert.ok(existsSync(new URL(`./fixtures/v${v}-project.kepler.json`, import.meta.url)), `нет фикстуры v${v}`);
  }
});

test('файл версии 1 открывается: данные целы, формат текущий', () => {
  const text = fixture('v1-project.kepler.json');
  const raw = JSON.parse(text);
  const p = deserializeProject(text);
  assert.equal(p.schema, SCHEMA);
  assert.ok(!('planSiteRot' in p) && !('viewRotation' in p));
  assert.deepEqual(p.building, { rotation: 0, origin: { x: 0, y: 0 } });
  assert.deepEqual(p.rooms, raw.rooms);
  assert.deepEqual(p.openings, raw.openings);
  assert.deepEqual(p.items, raw.items);
  assert.deepEqual(p.site.boundary, raw.site.boundary);
  assert.equal(p.site.north, 12);
  assert.equal(p.site.neighbors[0].rot, 15);
  // Пересохранение даёт уже текущую версию, и она открывается без изменений.
  const again = deserializeProject(serializeProject(p));
  assert.deepEqual(again, p);
});

test('файл версии 2: поворот камеры убран, у дома появились свои оси', () => {
  const raw = JSON.parse(fixture('v2-project.kepler.json'));
  assert.equal(raw.viewRotation, 330);
  const p = deserializeProject(JSON.stringify(raw));
  assert.equal(p.schema, SCHEMA);
  assert.ok(!('viewRotation' in p));
  assert.deepEqual(p.building, { rotation: 0, origin: { x: 0, y: 0 } });
  assert.deepEqual(p.rooms, raw.rooms, 'геометрия дома не меняется');
});

test('шаг 1 → 2: planSiteRot → viewRotation, мусор и минус нормализуются', () => {
  const base = { schema: 'kepler-plan/1', name: 'x', rooms: [], openings: [], items: [] };
  assert.equal(MIGRATIONS[1](base).viewRotation, 0);
  assert.equal(MIGRATIONS[1]({ ...base, planSiteRot: 'abc' }).viewRotation, 0);
  assert.equal(MIGRATIONS[1]({ ...base, planSiteRot: -30 }).viewRotation, 330);
});

test('миграция не меняет исходные данные', () => {
  const raw = JSON.parse(fixture('v1-project.kepler.json'));
  const copy = JSON.parse(JSON.stringify(raw));
  migrateProject(raw);
  assert.deepEqual(raw, copy);
});

test('цепочка миграций доходит до текущей версии с любой прошлой', () => {
  for (let v = 1; v <= SCHEMA_VERSION; v += 1) {
    const out = migrateProject({ schema: `kepler-plan/${v}`, rooms: [], openings: [], items: [] });
    assert.equal(out.schema, SCHEMA);
  }
});

test('новый проект сохраняется и открывается без потерь', () => {
  const p = createProject('Тест');
  assert.equal(p.schema, SCHEMA);
  assert.ok(p.site, 'участок создаётся вместе с проектом');
  assert.deepEqual(deserializeProject(serializeProject(p)), p);
});

test('понятные ошибки: чужой файл, файл из будущего, не JSON', () => {
  assert.equal(schemaVersion('kepler-plan/7'), 7);
  assert.equal(schemaVersion('other'), null);
  assert.throws(() => deserializeProject('{"schema":"other"}'), /не файл проекта/);
  assert.throws(() => deserializeProject('{"schema":"kepler-plan/99","rooms":[],"openings":[],"items":[]}'), /более новой версией/);
  assert.throws(() => deserializeProject('<html>'), /не является JSON/);
  assert.throws(() => deserializeProject(`{"schema":"${SCHEMA}"}`), /повреждён/);
});

test('файл версии 4: обеденный стол без стульев получает стулья частями (comp)', () => {
  const raw = JSON.parse(fixture('v4-project.kepler.json'));
  const p = deserializeProject(JSON.stringify(raw));
  assert.equal(p.schema, SCHEMA);
  const byId = Object.fromEntries(p.items.map((i) => [i.id, i]));
  const table = byId['item-v4-table'];
  assert.equal(table.comp.type, 'dining');
  assert.deepEqual(table.comp.sides, { top: true, bottom: true, left: false, right: false });
  assert.equal(table.w, 1600, 'размер стола не меняется');
  // Круглый стол и диван — без comp; у стула рядом со столом — тоже.
  assert.ok(!('comp' in byId['item-v4-round']));
  assert.ok(!('comp' in byId['item-v4-sofa']));
  assert.ok(!('comp' in byId['item-v4-chair']));
  assert.deepEqual(deserializeProject(serializeProject(p)), p);
});

test('шаг 4 → 5: стол рядом с отдельными стульями остаётся без comp, варианты тоже мигрируют', () => {
  const lvl = (items) => ({ id: 'L1', rooms: [], openings: [], items, wallOverrides: {} });
  const t = { id: 't', kind: 'dining-table', x: 0, y: 0, w: 1600, h: 900, rotation: 0 };
  const c = { id: 'c', kind: 'chair-soft', x: 0, y: -700, w: 500, h: 520, rotation: 0 };
  const out = MIGRATIONS[4]({ schema: 'kepler-plan/4', levels: [lvl([t, c])], variants: [{ id: 'v', house: { levels: [lvl([t])] } }] });
  assert.ok(!('comp' in out.levels[0].items[0]));
  assert.equal(out.variants[0].house.levels[0].items[0].comp.type, 'dining');
});

test('битый comp при открытии отбрасывается, предмет остаётся', () => {
  const p = createProject('x');
  p.items.push({ id: 'i1', kind: 'sofa', x: 0, y: 0, w: 2200, h: 950, rotation: 0, comp: { type: 'dining' } });
  p.items.push({ id: 'i2', kind: 'dining-table', x: 0, y: 0, w: 1600, h: 900, rotation: 0, comp: { type: 'dining', offset: 'abc' } });
  const q = deserializeProject(serializeProject(p));
  assert.ok(!('comp' in q.items[0]));
  assert.equal(q.items[1].comp.offset, 100);
});
