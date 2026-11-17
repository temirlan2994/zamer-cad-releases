// Fencing облачного черновика: даже уже начавшийся запрос прежнего
// устройства не может заменить модель после передачи права редактирования.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryDb } from '../core/memdb.js';
import { acquireEditLease, takeoverEditLease } from '../core/edit-lease.js';
import {
  deleteProject, getProject, loadDraft, saveDraft, saveVersion, updateProjectPreview, userRoot,
} from '../core/storage.js';

const ROOT = userRoot('lease-user');
const PID = 'lease-project';
const A = { sessionId: 'session-a', deviceId: 'device-a', deviceName: 'Телефон A' };
const A_REOPENED = { sessionId: 'session-a-reopened', deviceId: 'device-a', deviceName: 'Телефон A' };
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

test('фоновая миниатюра подчиняется тому же fencing, что основной проект', async () => {
  const db = createMemoryDb();
  const first = await acquireEditLease(db, ROOT, PID, A);
  await saveVersion(db, ROOT, project('Дом', 1), {
    pid: PID, editor: editor(first.lease),
  });
  const second = await takeoverEditLease(db, ROOT, PID, B, { force: true });
  const oldPreview = { v: 2, image: 'data:image/webp;base64,AAAA' };
  const newPreview = { v: 2, image: 'data:image/webp;base64,BBBB' };
  await assert.rejects(
    updateProjectPreview(db, ROOT, PID, oldPreview, { editor: editor(first.lease) }),
    (error) => error?.code === 'edit-lease-lost',
  );
  const saved = await updateProjectPreview(db, ROOT, PID, newPreview, { editor: editor(second.lease) });
  assert.deepEqual(saved.preview, newPreview);
  assert.equal(saved.editorSession, B.sessionId);
  assert.equal(saved.editorEpoch, second.lease.epoch);
});

test('повторный запуск на том же телефоне fencing-ом отсекает старый сеанс', async () => {
  const db = createMemoryDb();
  const first = await acquireEditLease(db, ROOT, PID, A);
  await saveDraft(db, ROOT, project('До перезапуска', 1), {
    pid: PID, editor: editor(first.lease),
  });

  const reopened = await acquireEditLease(db, ROOT, PID, A_REOPENED);
  assert.equal(reopened.status, 'acquired');
  assert.equal(reopened.lease.epoch, first.lease.epoch + 1);
  await saveDraft(db, ROOT, project('После перезапуска', 2), {
    pid: PID, editor: editor(reopened.lease),
  });

  await assert.rejects(
    saveDraft(db, ROOT, project('Запоздавший старый сеанс', 3), {
      pid: PID, editor: editor(first.lease),
    }),
    (error) => error?.code === 'edit-lease-lost',
  );

  const current = await loadDraft(db, ROOT, PID);
  assert.deepEqual(JSON.parse(current.text), JSON.parse(project('После перезапуска', 2)));
  assert.equal(current.draft.editorSession, A_REOPENED.sessionId);
  assert.equal(current.draft.editorEpoch, reopened.lease.epoch);
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
  const writes = [];
  const db = createMemoryDb({
    onWrite(path, body) { writes.push({ path, body }); },
  });
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

  writes.length = 0;
  await deleteProject(db, ROOT, PID, { editor: editor(second.lease) });
  assert.equal(await getProject(db, ROOT, PID), null);
  assert.equal(await loadDraft(db, ROOT, PID), null);

  const parent = writes.findIndex(({ path, body }) => path === `${ROOT}/${PID}` && body === null);
  const child = writes.findIndex(({ path, body }) => (
    path.startsWith(`${ROOT}/${PID}/`)
      && !path.startsWith(`${ROOT}/${PID}/lease/`)
      && body === null
  ));
  assert.ok(parent >= 0, 'parent должен быть удалён');
  assert.ok(child > parent, 'chunks удаляются только после parent');
});

test('обычные fenced save не запускают запрещённый GC старых chunks', async () => {
  const writes = [];
  const db = createMemoryDb({
    onWrite(path, body) { writes.push({ path, body }); },
  });
  const held = await acquireEditLease(db, ROOT, PID, A);
  const token = editor(held.lease);

  const firstDraft = await saveDraft(db, ROOT, project('Черновик 1', 1), {
    pid: PID, editor: token,
  });
  writes.length = 0;
  await saveDraft(db, ROOT, project('Черновик 2', 2), {
    pid: PID, editor: token,
  });
  assert.equal(writes.some(({ body }) => body === null), false);
  assert.ok(db.dump()[`${ROOT}/${PID}/draft/${firstDraft.draft.revision}.0`]);

  const firstVersion = await saveVersion(db, ROOT, project('Версия 1', 10), {
    pid: PID, editor: token, keep: 1,
  });
  writes.length = 0;
  await saveVersion(db, ROOT, project('Версия 2', 20), {
    pid: PID, editor: token, keep: 1,
  });
  assert.equal(writes.some(({ body }) => body === null), false);
  assert.ok(db.dump()[`${ROOT}/${PID}/c/${firstVersion.version.id}.0`]);
});

test('повторный cleanup удаляет orphan chunks после исчезновения parent при сохранённом lease', async () => {
  const db = createMemoryDb();
  const held = await acquireEditLease(db, ROOT, PID, A);
  const token = editor(held.lease);
  const firstDraft = await saveDraft(db, ROOT, project('Черновик 1', 1), {
    pid: PID, editor: token,
  });
  await saveDraft(db, ROOT, project('Черновик 2', 2), {
    pid: PID, editor: token,
  });
  const firstVersion = await saveVersion(db, ROOT, project('Версия 1', 10), {
    pid: PID, editor: token, keep: 1,
  });
  await saveVersion(db, ROOT, project('Версия 2', 20), {
    pid: PID, editor: token, keep: 1,
  });

  assert.ok(db.dump()[`${ROOT}/${PID}/draft/${firstDraft.draft.revision}.0`]);
  assert.ok(db.dump()[`${ROOT}/${PID}/c/${firstVersion.version.id}.0`]);
  await db.doc(`${ROOT}/${PID}`).delete(); // parent уже логически удалён

  // Даже legacy/recovery-клиент без editor token может завершить cleanup:
  // persistent lease остаётся, но живого parent больше нет.
  await deleteProject(db, ROOT, PID);
  const leftoverData = Object.keys(db.dump()).filter((path) => (
    path.startsWith(`${ROOT}/${PID}/`) && !path.startsWith(`${ROOT}/${PID}/lease/`)
  ));
  assert.deepEqual(leftoverData, []);
  assert.ok(db.dump()[`${ROOT}/${PID}/lease/editor`]);
});
