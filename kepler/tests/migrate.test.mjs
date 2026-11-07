// Миграции формата файла проекта: старые файлы должны открываться всегда.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createProject, deserializeProject, levelProject, serializeProject } from '../core/model.js';
import { reconcileEats } from '../core/v7/eat-bridge.js';
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

// ---------------------------------------------------------------- Схема 6: ручные стены

test('файл версии 5 открывается как v6: walls: [] на этажах, геометрия та же', () => {
  const raw = JSON.parse(fixture('v5-project.kepler.json'));
  const p = deserializeProject(JSON.stringify(raw));
  assert.equal(p.schema, SCHEMA);
  for (const l of p.levels) assert.deepEqual(l.walls, []);
  assert.deepEqual(p.levels.map((l) => l.rooms), raw.levels.map((l) => l.rooms));
  assert.deepEqual(p.levels.map((l) => l.openings), raw.levels.map((l) => l.openings));
  // Сохраняется в формате 7 (docs/v7-stage2-plan.md, срез 2): блоки вместо комнат.
  const text = serializeProject(p);
  const saved = JSON.parse(text);
  assert.equal(saved.schema, 'kepler-plan/7');
  assert.ok(saved.levels.every((l) => Array.isArray(l.blocks) && !('rooms' in l)));
  // Ядро v7 держит отступы проёмов на сетке 0,5 мм.
  const grid = (x) => JSON.parse(JSON.stringify(x, (k, v) => (k === 'offset' && typeof v === 'number' ? Math.round(v * 2) / 2 : v)));
  // Открытие v7 пересчитывает съедание по номиналам (пары ближе перегородки
  // отодвигаются) — сравниваем с тем же пересчётом исходного проекта.
  for (const l of p.levels) reconcileEats(levelProject(p, l.id));
  assert.deepEqual(grid(deserializeProject(text)), grid(p));
});

test('v5 → v6 → движок v2: стены комнат те же, что у v2 на исходном файле', async () => {
  const { deriveWallsV2 } = await import('../core/walls.js');
  const raw = JSON.parse(fixture('v5-project.kepler.json'));
  const p = deserializeProject(JSON.stringify(raw));
  const pick = (w) => [w.key, w.kind, Math.round(w.from), Math.round(w.to), w.thickness, w.wallType];
  const v6 = deriveWallsV2(p).map(pick);
  // Тот же проект без поля walls (как v5 в памяти).
  for (const l of p.levels) delete l.walls;
  const v5 = deriveWallsV2(p).map(pick);
  assert.deepEqual(v6, v5);
});

test('шаг 5 → 6: walls только добавляется (этажи и варианты), прочее не трогается', () => {
  const lvl = { id: 'L1', rooms: [{ id: 'r' }], openings: [], items: [], wallOverrides: { k: { thickness: 300 } } };
  const out = MIGRATIONS[5]({ schema: 'kepler-plan/5', levels: [lvl], variants: [{ id: 'v', house: { levels: [lvl] } }] });
  assert.deepEqual(out.levels[0], { ...lvl, walls: [] });
  assert.deepEqual(out.variants[0].house.levels[0].walls, []);
  const keep = MIGRATIONS[5]({ levels: [{ ...lvl, walls: [{ id: 'w' }] }] });
  assert.deepEqual(keep.levels[0].walls, [{ id: 'w' }]);
});

test('проект с ручной стеной сохраняется в формате 7; битые стены и проёмы чистятся', () => {
  const p = createProject('x');
  p.walls.push({ id: 'w1', axis: { kind: 'line', a: { x: 0, y: 0 }, b: { x: 3000, y: 0 } }, thickness: 9999 });
  p.walls.push({ id: 'w2', axis: { kind: 'line', a: { x: 5, y: 5 }, b: { x: 5, y: 5 } } }); // нулевая ось
  p.walls.push({ id: 'w3', axis: { a: { x: 'a', y: 0 }, b: { x: 1, y: 1 } } });
  p.openings.push({ id: 'd1', kind: 'door', host: { wallId: 'w1', t: 1000 }, width: 800 });
  p.openings.push({ id: 'd2', kind: 'door', host: { wallId: 'нет', t: 1000 }, width: 800 });
  const text = serializeProject(p);
  assert.equal(JSON.parse(text).schema, 'kepler-plan/7');
  const q = deserializeProject(text);
  assert.deepEqual(q.walls.map((w) => w.id), ['w1']);
  assert.equal(q.walls[0].thickness, 600, 'толщина зажата в пределы');
  assert.equal(q.walls[0].justify, 'center');
  assert.deepEqual(q.openings.map((o) => o.id), ['d1']);
  assert.deepEqual(q.openings[0].host, { wallId: 'w1', t: 1000 });
  assert.equal(q.openings[0].roomId, null);
  assert.deepEqual(deserializeProject(serializeProject(q)), q);
});
