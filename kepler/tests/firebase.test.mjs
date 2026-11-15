import test from 'node:test';
import assert from 'node:assert/strict';
import { firebaseConfigured } from '../firebase-config.js';
import { createFirestoreAdapter, firebaseSessionExpected } from '../ui/firebase.js';

test('firebaseConfigured требует полный публичный web config', () => {
  assert.equal(firebaseConfigured({}), false);
  assert.equal(firebaseConfigured({ apiKey: 'a', authDomain: 'b', projectId: 'c', appId: '' }), false);
  assert.equal(firebaseConfigured({ apiKey: 'a', authDomain: 'b', projectId: 'c', appId: 'd' }), true);
});

test('Firebase SDK ожидается только для ранее начатой сессии', () => {
  const previous = globalThis.localStorage;
  globalThis.localStorage = { getItem: (key) => (key === 'kepler-firebase-session' ? '1' : null) };
  try { assert.equal(firebaseSessionExpected(), true); }
  finally {
    if (previous === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = previous;
  }
  assert.equal(firebaseSessionExpected(), false);
});

test('Firestore adapter нормализует exists() и операции документов', async () => {
  const writes = [];
  const ref = (kind, path) => ({ kind, path, id: path.split('/').at(-1) });
  const api = {
    doc: (parent, id) => ref('doc', parent === 'firestore' ? id : id === undefined ? String(parent) : `${parent.path || parent}/${id || 'auto'}`),
    collection: (parent, path) => ref('collection', parent === 'firestore' ? path : path === undefined ? String(parent) : `${parent.path || parent}/${path}`),
    getDoc: async (r) => ({ id: r.id, exists: () => true, data: () => ({ value: 7 }), metadata: { fromCache: true } }),
    setDoc: async (r, data) => { writes.push(['set', r.path, data]); },
    updateDoc: async (r, data) => { writes.push(['update', r.path, data]); },
    deleteDoc: async (r) => { writes.push(['delete', r.path]); },
    getDocs: async () => ({ docs: [], size: 0, empty: true, docChanges: () => [] }),
    onSnapshot: () => () => {},
    addDoc: async (r) => ref('doc', `${r.path}/added`),
    query: (base) => base,
    where: (...args) => args,
    orderBy: (...args) => args,
    limit: (...args) => args,
  };
  const db = createFirestoreAdapter('firestore', api);
  const doc = db.doc('data/users');
  const snapshot = await doc.get();
  assert.equal(snapshot.exists, true);
  assert.deepEqual(snapshot.data(), { value: 7 });
  await doc.set({ a: 1 });
  await doc.update({ b: 2 });
  await doc.delete();
  assert.deepEqual(writes, [
    ['set', 'data/users', { a: 1 }],
    ['update', 'data/users', { b: 2 }],
    ['delete', 'data/users'],
  ]);
});
