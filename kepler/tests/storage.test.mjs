import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryDb } from '../core/memdb.js';
import {
  chunkText, deleteDraft, deleteProject, listProjects, listShared, loadDraft, loadShared,
  loadVersion, publishProject, saveDraft, saveVersion, splitHeavy, joinHeavy,
  unpublishProject, userRoot, DB_RULES,
} from '../core/storage.js';

const root = userRoot('u1');
const proj = (extra = {}) => JSON.stringify({ name: 'Дом', rooms: [1, 2, 3], ...extra });

test('chunkText: куски в лимите, склейка без потерь (кириллица, суррогаты)', () => {
  const text = 'Привет "мир" 😀'.repeat(500);
  const parts = chunkText(text, 1000);
  assert.ok(parts.length > 1);
  assert.equal(parts.join(''), text);
  for (const p of parts) assert.ok(new TextEncoder().encode(JSON.stringify({ s: p })).length <= 1000);
});

test('splitHeavy/joinHeavy: тяжёлая картинка выносится и возвращается', () => {
  const img = `data:image/png;base64,${'A'.repeat(6000)}`;
  const { body, blobs } = splitHeavy(JSON.stringify({ name: 'x', site: { underlay: img } }));
  assert.ok(body.length < 500);
  assert.equal(Object.keys(blobs).length, 1);
  const { text, missing } = joinHeavy(body, blobs);
  assert.equal(JSON.parse(text).site.underlay, img);
  assert.deepEqual(missing, []);
  assert.equal(joinHeavy(body, {}).missing.length, 1);
});

test('saveVersion/loadVersion: версии, без дубля при отсутствии изменений', async () => {
  const db = createMemoryDb();
  const a = await saveVersion(db, root, proj(), { pid: 'p1' });
  assert.equal(a.unchanged, false);
  const same = await saveVersion(db, root, proj(), { pid: 'p1' });
  assert.equal(same.unchanged, true);
  const b = await saveVersion(db, root, proj({ rooms: [9] }), { pid: 'p1', note: 'правка' });
  assert.equal(b.meta.versions.length, 2);
  assert.equal(JSON.parse((await loadVersion(db, root, 'p1')).text).rooms[0], 9);
  assert.equal(JSON.parse((await loadVersion(db, root, 'p1', a.version.id)).text).rooms[0], 1);
  assert.equal((await listProjects(db, root))[0].name, 'Дом');
});

test('карточка проекта хранит компактный эскиз вне истории версий', async () => {
  const db = createMemoryDb();
  const project = {
    name: 'Дом с эскизом',
    levels: [{ rooms: [{ id: 'r1', x: 0, y: 0, w: 4200, h: 3600 }] }],
  };
  const saved = await saveVersion(db, root, JSON.stringify(project), { pid: 'preview' });
  assert.equal(saved.meta.preview.v, 1);
  assert.equal(saved.meta.preview.rooms.length, 1);
  assert.equal('preview' in saved.meta.versions[0], false, 'история версий не раздувается');
});

test('облачный черновик хранится отдельно и открывается без ручной версии', async () => {
  const db = createMemoryDb();
  const saved = await saveDraft(db, root, proj({ rooms: [7] }), {
    pid: 'draft-only', stats: { rooms: 1 }, now: new Date('2026-11-15T10:00:00Z'),
  });
  assert.equal(saved.unchanged, false);
  assert.equal(saved.meta.versions.length, 0);
  assert.equal(saved.meta.draftUpdatedAt, '2026-11-15T10:00:00.000Z');
  assert.equal((await listProjects(db, root))[0].id, 'draft-only');
  assert.deepEqual(JSON.parse((await loadDraft(db, root, 'draft-only')).text).rooms, [7]);
  const opened = await loadVersion(db, root, 'draft-only');
  assert.equal(opened.version.isDraft, true);
  assert.deepEqual(JSON.parse(opened.text).rooms, [7]);
});

test('переименование черновика обновляет карточку и сам проект', async () => {
  const db = createMemoryDb();
  await saveDraft(db, root, proj({ name: 'Старое имя' }), { pid: 'rename-draft' });
  await saveDraft(db, root, proj({ name: 'Новое имя' }), { pid: 'rename-draft' });
  assert.equal((await listProjects(db, root))[0].name, 'Новое имя');
  assert.equal(JSON.parse((await loadDraft(db, root, 'rename-draft')).text).name, 'Новое имя');
});

test('свежий draft побеждает ручную версию, explicit version остаётся доступной', async () => {
  const db = createMemoryDb();
  const manual = await saveVersion(db, root, proj({ rooms: [1] }), {
    pid: 'draft-newer', now: new Date('2026-11-15T10:00:00Z'),
  });
  await saveDraft(db, root, proj({ rooms: [2] }), {
    pid: 'draft-newer', now: new Date('2026-11-15T10:01:00Z'),
  });
  const latest = await loadVersion(db, root, 'draft-newer');
  assert.equal(latest.version.isDraft, true);
  assert.deepEqual(JSON.parse(latest.text).rooms, [2]);
  const explicit = await loadVersion(db, root, 'draft-newer', manual.version.id);
  assert.equal(explicit.version.id, manual.version.id);
  assert.deepEqual(JSON.parse(explicit.text).rooms, [1]);
  assert.equal((await listProjects(db, root))[0].versions.length, 1, 'draft не затёр версии');
});

test('ручная версия новее draft становится основной', async () => {
  const db = createMemoryDb();
  await saveDraft(db, root, proj({ rooms: [1] }), {
    pid: 'manual-newer', now: new Date('2026-11-15T10:00:00Z'),
  });
  const manual = await saveVersion(db, root, proj({ rooms: [9] }), {
    pid: 'manual-newer', now: new Date('2026-11-15T10:02:00Z'),
  });
  const opened = await loadVersion(db, root, 'manual-newer');
  assert.equal(opened.version.id, manual.version.id);
  assert.deepEqual(JSON.parse(opened.text).rooms, [9]);
});

test('старый draft не заменяет эскиз более новой ручной версии', async () => {
  const db = createMemoryDb();
  const project = (w) => JSON.stringify({
    name: 'Дом', levels: [{ rooms: [{ id: 'r1', x: 0, y: 0, w, h: 3000 }] }],
  });
  const manual = await saveVersion(db, root, project(6000), {
    pid: 'preview-order', now: new Date('2026-11-15T10:02:00Z'),
  });
  await saveDraft(db, root, project(2000), {
    pid: 'preview-order', now: new Date('2026-11-15T10:00:00Z'),
  });
  const meta = (await listProjects(db, root)).find((item) => item.id === 'preview-order');
  assert.deepEqual(meta.preview, manual.meta.preview);
  assert.equal(meta.updatedAt, '2026-11-15T10:02:00.000Z');
});

test('draft не дублируется, меняется атомарно и очищает старые части', async () => {
  const db = createMemoryDb();
  const image = `data:image/png;base64,${'D'.repeat(6000)}`;
  const first = await saveDraft(db, root, proj({ pad: 'я'.repeat(300 * 1024), image }), {
    pid: 'replace-draft', now: new Date('2026-11-15T10:00:00Z'),
  });
  const keysAfterFirst = Object.keys(db.dump());
  assert.ok(first.draft.chunks > 1);
  assert.ok(keysAfterFirst.some((key) => key.includes('/draft-blobs/')));
  const same = await saveDraft(db, root, proj({ pad: 'я'.repeat(300 * 1024), image }), {
    pid: 'replace-draft', now: new Date('2026-11-15T10:01:00Z'),
  });
  assert.equal(same.unchanged, true);
  assert.deepEqual(Object.keys(db.dump()).sort(), keysAfterFirst.sort());

  const second = await saveDraft(db, root, proj({ rooms: [8] }), {
    pid: 'replace-draft', now: new Date('2026-11-15T10:02:00Z'),
  });
  const keys = Object.keys(db.dump());
  assert.notEqual(second.draft.revision, first.draft.revision);
  assert.ok(!keys.some((key) => key.includes(`/draft/${first.draft.revision}.`)));
  assert.ok(!keys.some((key) => key.includes('/draft-blobs/')));
  assert.deepEqual(JSON.parse((await loadDraft(db, root, 'replace-draft')).text).rooms, [8]);
});

test('deleteDraft сохраняет версии, deleteProject удаляет draft-only целиком', async () => {
  const db = createMemoryDb();
  await saveVersion(db, root, proj({ rooms: [1] }), { pid: 'keep-version' });
  await saveDraft(db, root, proj({ rooms: [2] }), { pid: 'keep-version' });
  assert.equal(await deleteDraft(db, root, 'keep-version'), true);
  assert.equal((await listProjects(db, root))[0].draftUpdatedAt, null);
  assert.deepEqual(JSON.parse((await loadVersion(db, root, 'keep-version')).text).rooms, [1]);

  await saveDraft(db, root, proj({ rooms: [3] }), { pid: 'draft-delete' });
  await deleteProject(db, root, 'draft-delete');
  assert.ok(!Object.keys(db.dump()).some((key) => key.includes('draft-delete')));
});

test('saveVersion: лишние версии и их куски удаляются, картинка живёт, пока нужна', async () => {
  const db = createMemoryDb();
  const img = `data:image/png;base64,${'B'.repeat(5000)}`;
  for (let i = 0; i < 4; i += 1) {
    await saveVersion(db, root, proj({ n: i, site: { underlay: img } }), { pid: 'p', keep: 2 });
  }
  const meta = (await listProjects(db, root))[0];
  assert.equal(meta.versions.length, 2);
  const keys = Object.keys(db.dump());
  assert.equal(keys.filter((k) => k.includes('/c/')).length, 2);
  assert.equal(keys.filter((k) => k.includes('/b/')).length, 1);
  await saveVersion(db, root, proj({ n: 10 }), { pid: 'p', keep: 1 }); // без картинки
  assert.equal(Object.keys(db.dump()).filter((k) => k.includes('/b/')).length, 0);
});

test('большой проект режется на куски и читается обратно', async () => {
  const db = createMemoryDb();
  const big = proj({ pad: 'я'.repeat(300 * 1024) });
  const { version } = await saveVersion(db, root, big, { pid: 'big' });
  assert.ok(version.chunks > 1);
  assert.equal((await loadVersion(db, root, 'big')).text, JSON.stringify(JSON.parse(big)));
});

test('deleteProject убирает всё', async () => {
  const db = createMemoryDb();
  await saveVersion(db, root, proj(), { pid: 'p1' });
  await deleteProject(db, root, 'p1');
  assert.deepEqual(db.dump(), {});
});

test('публикация: оглавление, чужое читается, снятие убирает', async () => {
  const db = createMemoryDb();
  await publishProject(db, 'ann', proj({ name: 'Анна' }), { pid: 'a1' });
  await publishProject(db, 'bob', proj({ name: 'Боб' }), { pid: 'b1' });
  await publishProject(db, 'ann', proj({ name: 'Анна 2', rooms: [7] }), { pid: 'a1' });
  const list = await listShared(db);
  assert.equal(list.length, 2);
  assert.ok(list.every((it) => it.owner));
  const ann = list.find((it) => it.owner === 'ann');
  assert.equal(JSON.parse((await loadShared(db, ann.owner, ann.pid)).text).rooms[0], 7);
  await unpublishProject(db, 'ann', 'a1');
  assert.deepEqual((await listShared(db)).map((it) => it.owner), ['bob']);
  assert.ok(!Object.keys(db.dump()).some((k) => k.startsWith('shared/ann')));
});

test('чужой общий индекс не передаёт опасные идентификаторы в интерфейс', async () => {
  const db = createMemoryDb();
  await db.doc('shared/evil').set({
    updatedAt: '2026-11-15T10:00:00.000Z',
    items: [
      { pid: 'bad" onfocus="alert(1)', name: '<img>', at: 'x', stats: { rooms: '<b>7</b>' } },
      { pid: 'safe-id', name: '<img>', at: '2026-11-15T10:00:00.000Z', stats: { rooms: '7' } },
    ],
  });
  const items = await listShared(db);
  assert.equal(items.length, 1);
  assert.equal(items[0].pid, 'safe-id');
  assert.equal(items[0].stats.rooms, 7);
});

test('повреждённая версия с огромным числом частей отклоняется до чтения', async () => {
  const db = createMemoryDb();
  await db.doc(`${root}/corrupt`).set({
    createdAt: '2026-11-15T10:00:00.000Z',
    updatedAt: '2026-11-15T10:00:00.000Z',
    name: 'Повреждённый',
    head: 'v1',
    blobs: {},
    versions: [{ id: 'v1', at: '2026-11-15T10:00:00.000Z', chunks: 1e9, blobs: [] }],
  });
  await assert.rejects(loadVersion(db, root, 'corrupt'), /Версия не найдена/);
});

test('DB_RULES: читают все, пишет автор', () => {
  assert.equal(DB_RULES[0].path, 'shared');
  assert.ok(DB_RULES.some((r) => r.path === 'shared/{self}'));
});
