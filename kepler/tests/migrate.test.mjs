// Миграции формата файла проекта: старые файлы должны открываться всегда.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createProject, serializeProject, deserializeProject } from '../core/model.js';
import { SCHEMA, SCHEMA_VERSION, migrateProject, schemaVersion } from '../core/migrate.js';

const fixture = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

test('на каждую прошлую версию формата есть настоящий файл-фикстура', () => {
  for (let v = 1; v < SCHEMA_VERSION; v += 1) {
    assert.ok(existsSync(new URL(`./fixtures/v${v}-project.kepler.json`, import.meta.url)), `нет фикстуры v${v}`);
  }
});

test('файл версии 1 открывается: planSiteRot → viewRotation, данные целы', () => {
  const text = fixture('v1-project.kepler.json');
  const raw = JSON.parse(text);
  const p = deserializeProject(text);
  assert.equal(p.schema, SCHEMA);
  assert.equal(p.viewRotation, 330);
  assert.ok(!('planSiteRot' in p));
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

test('v1 без поля поворота и с мусором в нём', () => {
  const base = { schema: 'kepler-plan/1', name: 'x', rooms: [], openings: [], items: [] };
  assert.equal(deserializeProject(JSON.stringify(base)).viewRotation, 0);
  assert.equal(deserializeProject(JSON.stringify({ ...base, planSiteRot: 'abc' })).viewRotation, 0);
  assert.equal(deserializeProject(JSON.stringify({ ...base, planSiteRot: -30 })).viewRotation, 330);
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
