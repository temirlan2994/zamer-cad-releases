import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryDb } from '../core/memdb.js';
import {
  chunkText, deleteProject, listProjects, listShared, loadShared, loadVersion, publishProject,
  saveVersion, splitHeavy, joinHeavy, unpublishProject, userRoot, DB_RULES,
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

test('DB_RULES: читают все, пишет автор', () => {
  assert.equal(DB_RULES[0].path, 'shared');
  assert.ok(DB_RULES.some((r) => r.path === 'shared/{self}'));
});
