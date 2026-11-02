// Проекты «в браузере»: хранилище в памяти (core/memdb.js) с зеркалом в
// IndexedDB. Тот же API, что у capability `db`, поэтому core/storage.js
// работает с ним без изменений. Нет IndexedDB (приватный режим и т.п.) —
// остаётся память до закрытия вкладки (persistent: false).

import { createMemoryDb } from '../core/memdb.js';

const DB_NAME = 'kepler-plan';
const STORE = 'docs';

const wrap = (req) => new Promise((resolve, reject) => {
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});

async function openIdb() {
  const open = indexedDB.open(DB_NAME, 1);
  open.onupgradeneeded = () => open.result.createObjectStore(STORE);
  return wrap(open);
}

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
  let chain = Promise.resolve();
  const onWrite = idb ? (path, body) => {
    chain = chain.then(() => {
      const store = idb.transaction(STORE, 'readwrite').objectStore(STORE);
      return wrap(body === null ? store.delete(path) : store.put(body, path));
    }).catch(() => { /* квота/закрыто — данные остаются в памяти */ });
  } : null;
  return { db: createMemoryDb({ initial, onWrite }), persistent: Boolean(idb) };
}
