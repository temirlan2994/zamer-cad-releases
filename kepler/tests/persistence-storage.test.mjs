// Хранилище версий: ошибка записи не скрывается, две вкладки не стирают
// версии друг друга (аудит 2026-11b, П-8, П-9a).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryDb } from '../core/memdb.js';
import { listProjects, loadVersion, saveVersion, userRoot } from '../core/storage.js';

const root = userRoot('u1');
const proj = (name) => JSON.stringify({ name, rooms: [] });

test('ошибка onWrite (квота IndexedDB) доходит до saveVersion', async () => {
  const db = createMemoryDb({ onWrite: () => Promise.reject(new Error('браузер не дал записать (нет места)')) });
  await assert.rejects(() => saveVersion(db, root, proj('Дом'), { pid: 'p1' }), /нет места/);
});

test('успешный onWrite-промис ждётся, данные записаны', async () => {
  const writes = [];
  const db = createMemoryDb({ onWrite: async (path) => { writes.push(path); } });
  const { unchanged } = await saveVersion(db, root, proj('Дом'), { pid: 'p1' });
  assert.equal(unchanged, false);
  assert.ok(writes.some((p) => p === `${root}/p1`));
});

test('applyRemote: изменение из другой вкладки видно без onWrite', async () => {
  let calls = 0;
  const db = createMemoryDb({ onWrite: () => { calls += 1; } });
  db.applyRemote(`${root}/p9`, { name: 'Чужой', versions: [] });
  assert.equal(calls, 0);
  const snap = await db.doc(`${root}/p9`).get();
  assert.equal(snap.data().name, 'Чужой');
  db.applyRemote(`${root}/p9`, null);
  assert.equal((await db.doc(`${root}/p9`).get()).exists, false);
});

test('две вкладки сохраняют одновременно — обе версии остаются', async () => {
  const db = createMemoryDb();
  await saveVersion(db, root, proj('v0'), { pid: 'p1', now: new Date('2026-01-01T00:00:00Z') });
  // Обе вкладки прочитали карточку до того, как другая записала свою.
  const [a, b] = await Promise.all([
    saveVersion(db, root, proj('Вкладка A'), { pid: 'p1', now: new Date('2026-01-01T00:01:00Z') }),
    saveVersion(db, root, proj('Вкладка B'), { pid: 'p1', now: new Date('2026-01-01T00:02:00Z') }),
  ]);
  const [meta] = await listProjects(db, root);
  const ids = meta.versions.map((v) => v.id);
  assert.ok(ids.includes(a.version.id), 'версия A не потерялась');
  assert.ok(ids.includes(b.version.id), 'версия B не потерялась');
  assert.equal(meta.versions.length, 3);
  for (const v of meta.versions) {
    const { text } = await loadVersion(db, root, 'p1', v.id);
    assert.ok(JSON.parse(text).name);
  }
});
