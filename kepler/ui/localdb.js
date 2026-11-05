// Проекты «в браузере»: хранилище в памяти (core/memdb.js) с зеркалом в
// IndexedDB. Тот же API, что у capability `db`, поэтому core/storage.js
// работает с ним без изменений. Нет IndexedDB (приватный режим и т.п.) —
// остаётся память до закрытия вкладки (persistent: false).
//
// Ошибка записи в IndexedDB (квота, закрытая база) не проглатывается:
// set/delete отклоняются, и «Сохранить версию» сообщает о сбое.
// Несколько вкладок: каждая запись рассылается через BroadcastChannel, и
// память других вкладок обновляется — иначе вкладка с устаревшей копией
// перезаписала бы чужие версии.
//
// Отдельное хранилище blobs — тяжёлые данные автосохранения (подложка),
// когда в localStorage на них не хватает места (ui/store.js).

import { createMemoryDb } from '../core/memdb.js';

const DB_NAME = 'kepler-plan';
const STORE = 'docs';
const BLOBS = 'blobs';
const CHANNEL = 'kepler-plan-db';

const wrap = (req) => new Promise((resolve, reject) => {
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});

let idbPromise = null;
function openIdb() {
  idbPromise ??= (async () => {
    if (typeof indexedDB === 'undefined') throw new Error('Нет IndexedDB');
    const open = indexedDB.open(DB_NAME, 2);
    open.onupgradeneeded = () => {
      const db = open.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      if (!db.objectStoreNames.contains(BLOBS)) db.createObjectStore(BLOBS);
    };
    return wrap(open);
  })();
  idbPromise.catch(() => { idbPromise = null; });
  return idbPromise;
}

const writeError = (error) => new Error(`браузер не дал записать (${error?.name === 'QuotaExceededError' ? 'нет места' : error?.message || 'ошибка IndexedDB'})`);

export async function createLocalDb() {
  let idb = null;
  const initial = {};
  try {
    idb = await openIdb();
    const tx = idb.transaction(STORE, 'readonly');
    const store = tx.objectStore(STORE);
    const [keys, values] = await Promise.all([wrap(store.getAllKeys()), wrap(store.getAll())]);
    keys.forEach((k, i) => { initial[k] = values[i]; });
  } catch {
    idb = null;
  }
  let channel = null;
  try { channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel(CHANNEL) : null; } catch { channel = null; }
  let chain = Promise.resolve();
  const onWrite = idb ? (path, body) => {
    const job = chain.then(() => new Promise((resolve, reject) => {
      const tx = idb.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      if (body === null) store.delete(path); else store.put(body, path);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    })).then(() => {
      try { channel?.postMessage({ path, body }); } catch { /* вкладка закрывается */ }
    }, (error) => { throw writeError(error); });
    chain = job.catch(() => {}); // следующая запись не ждёт упавшую
    return job;
  } : null;
  const db = createMemoryDb({ initial, onWrite });
  if (channel) {
    channel.onmessage = (e) => {
      const { path, body } = e.data || {};
      if (typeof path === 'string') { try { db.applyRemote(path, body); } catch { /* чужой путь */ } }
    };
  }
  return { db, persistent: Boolean(idb) };
}

// ---------------------------------------------------------------- Тяжёлые данные автосохранения

export async function putBlob(key, text) {
  const idb = await openIdb();
  await new Promise((resolve, reject) => {
    const tx = idb.transaction(BLOBS, 'readwrite');
    tx.objectStore(BLOBS).put(text, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function getBlob(key) {
  const idb = await openIdb();
  const value = await wrap(idb.transaction(BLOBS, 'readonly').objectStore(BLOBS).get(key));
  return typeof value === 'string' ? value : null;
}
