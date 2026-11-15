// Fencing облачного черновика: даже уже начавшийся запрос прежнего
// устройства не может заменить модель после передачи права редактирования.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryDb } from '../core/memdb.js';
import { acquireEditLease, takeoverEditLease } from '../core/edit-lease.js';
import {
  deleteProject, getProject, loadDraft, saveDraft, saveVersion, userRoot,
} from '../core/storage.js';

const ROOT = userRoot('lease-user');
const PID = 'lease-project';
const A = { sessionId: 'session-a', deviceId: 'device-a', deviceName: 'Телефон A' };
const B = { sessionId: 'session-b', deviceId: 'device-b', deviceName: 'Телефон B' };
const project = (name, value) => JSON.stringify({ name, value, rooms: [] });
const editor = (lease) => ({ sessionId: lease.sessionId, epoch: lease.epoch });

test('старое устройство после takeover не меняет draft/current', async () => {
  const db = createMemoryDb();
  const first = await acquireEditLease(db, ROOT, PID, A);
  assert.equal(first.status, 'acquired');
  await saveDraft(db, ROOT, project('A', 1), {
    pid: PID,
    editor: editor(first.lease),
    now: new Date('2026-11-15T10:00:00Z'),
  });

  const second = await takeoverEditLease(db, ROOT, PID, B, { force: true });
  assert.equal(second.status, 'acquired');
  assert.equal(second.lease.epoch, first.lease.epoch + 1);
  const savedByB = await saveDraft(db, ROOT, project('B', 2), {
    pid: PID,
    editor: editor(second.lease),
    now: new Date('2026-11-15T10:01:00Z'),
  });

  await assert.rejects(
    saveDraft(db, ROOT, project('Запоздалый A', 3), {
      pid: PID,
      editor: editor(first.lease),
      now: new Date('2026-11-15T10:02:00Z'),
    }),
    (error) => error?.code === 'edit-lease-lost',
  );
  // Отдельно проверяем быстрый путь unchanged: он тоже обязан проверить lease.
  await assert.rejects(
    saveDraft(db, ROOT, project('B', 2), {
      pid: PID,
      editor: editor(first.lease),
      now: new Date('2026-11-15T10:03:00Z'),
    }),
    (error) => error?.code === 'edit-lease-lost',
  );

  const current = await loadDraft(db, ROOT, PID);
  assert.deepEqual(JSON.parse(current.text), JSON.parse(project('B', 2)));
  assert.equal(current.draft.revision, savedByB.draft.revision);
  assert.equal(current.draft.editorSession, B.sessionId);
  assert.equal(current.draft.editorEpoch, second.lease.epoch);
});

test('параллельный поздний save A проигрывает действующему save B', async () => {
  const db = createMemoryDb();
  const first = await acquireEditLease(db, ROOT, PID, A);
  await saveDraft(db, ROOT, project('Начало', 0), {
    pid: PID, editor: editor(first.lease),
  });
  const second = await takeoverEditLease(db, ROOT, PID, B, { force: true });

  const [stale, active] = await Promise.allSettled([
    saveDraft(db, ROOT, project('Старое устройство', 10), {
      pid: PID, editor: editor(first.lease),
    }),
    saveDraft(db, ROOT, project('Новое устройство', 20), {
      pid: PID, editor: editor(second.lease),
    }),
  ]);
  assert.equal(stale.status, 'rejected');
  assert.equal(stale.reason?.code, 'edit-lease-lost');
  assert.equal(active.status, 'fulfilled');

  const current = await loadDraft(db, ROOT, PID);
  assert.equal(JSON.parse(current.text).name, 'Новое устройство');
  assert.equal(current.draft.editorSession, B.sessionId);
  assert.equal(current.draft.editorEpoch, second.lease.epoch);
});

test('запоздалая ручная версия A не меняет head после takeover B', async () => {
  let pauseNextVersion = false;
  let releaseChunk;
  let chunkStarted;
  const chunkReached = new Promise((resolve) => { chunkStarted = resolve; });
  const chunkReleased = new Promise((resolve) => { releaseChunk = resolve; });
  let paused = false;
  const db = createMemoryDb({
    onWrite(path) {
      if (!pauseNextVersion || paused || !path.includes(`/${PID}/c/v`)) return null;
      paused = true;
      chunkStarted();
      return chunkReleased;
    },
  });
  const first = await acquireEditLease(db, ROOT, PID, A);
  await saveVersion(db, ROOT, project('Начало A', 0), {
    pid: PID, editor: editor(first.lease),
  });

  pauseNextVersion = true;
  const staleSave = saveVersion(db, ROOT, project('Запоздалый A', 10), {
    pid: PID, editor: editor(first.lease),
  });
  await chunkReached;

  const second = await takeoverEditLease(db, ROOT, PID, B, { force: true });
  const savedByB = await saveVersion(db, ROOT, project('Актуальный B', 20), {
    pid: PID, editor: editor(second.lease),
  });
  releaseChunk();

  await assert.rejects(staleSave, (error) => error?.code === 'edit-lease-lost');
  await assert.rejects(
    saveVersion(db, ROOT, project('Актуальный B', 20), {
      pid: PID, editor: editor(first.lease),
    }),
    (error) => error?.code === 'edit-lease-lost',
  );

  const meta = await getProject(db, ROOT, PID);
  assert.equal(meta.head, savedByB.version.id);
  assert.equal(meta.versions[0].id, savedByB.version.id);
  assert.equal(meta.editorSession, B.sessionId);
  assert.equal(meta.editorEpoch, second.lease.epoch);
});

test('удаление сначала проверяет lease и старое устройство не удаляет карточку', async () => {
  const db = createMemoryDb();
  const first = await acquireEditLease(db, ROOT, PID, A);
  await saveVersion(db, ROOT, project('Проект', 1), {
    pid: PID, editor: editor(first.lease),
  });
  const second = await takeoverEditLease(db, ROOT, PID, B, { force: true });

  await assert.rejects(
    deleteProject(db, ROOT, PID, { editor: editor(first.lease) }),
    (error) => error?.code === 'edit-lease-lost',
  );
  assert.equal((await getProject(db, ROOT, PID)).name, 'Проект');

  await deleteProject(db, ROOT, PID, { editor: editor(second.lease) });
  assert.equal(await getProject(db, ROOT, PID), null);
  assert.equal(await loadDraft(db, ROOT, PID), null);
});
