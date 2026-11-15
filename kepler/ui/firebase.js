// Firebase для статической версии Kepler Plan: Google Authentication и
// адаптер modular Firestore к маленькому db-API, которое уже использует
// core/storage.js. SDK загружается динамически и только при заполненной
// firebase-config.js — локальная и artifact-версии не зависят от сети.

import { FIREBASE_CONFIG, firebaseConfigured } from '../firebase-config.js';

const SDK_VERSION = '11.10.0';
const SDK_ROOT = `https://www.gstatic.com/firebasejs/${SDK_VERSION}`;
const APP_NAME = 'kepler-plan';

let runtimePromise = null;
const authListeners = new Set();

const account = (user) => (user ? {
  uid: String(user.uid),
  name: user.displayName || '',
  email: user.email || '',
  photoURL: user.photoURL || '',
} : null);

export function firebaseAccount(user) { return account(user); }

export function readableFirebaseError(error) {
  const code = String(error?.code || '');
  if (code.includes('popup-closed-by-user')) return new Error('Вход отменён');
  if (code.includes('popup-blocked')) return new Error('Браузер заблокировал окно входа Google');
  if (code.includes('unauthorized-domain')) return new Error('Этот адрес сайта не разрешён в Firebase Authentication');
  if (code.includes('network-request-failed') || code === 'unavailable') return new Error('Нет связи с Google/Firebase');
  if (code.includes('operation-not-allowed')) return new Error('Вход через Google не включён в Firebase Authentication');
  return new Error(error?.message || 'Ошибка Firebase');
}

function wrapDocSnapshot(snapshot) {
  const exists = typeof snapshot.exists === 'function' ? snapshot.exists() : Boolean(snapshot.exists);
  return {
    id: snapshot.id,
    exists,
    data: () => (exists ? snapshot.data() : undefined),
    metadata: snapshot.metadata || { fromCache: false, hasPendingWrites: false },
  };
}

function wrapQuerySnapshot(snapshot) {
  return {
    docs: (snapshot.docs || []).map(wrapDocSnapshot),
    size: snapshot.size ?? snapshot.docs?.length ?? 0,
    empty: snapshot.empty ?? !(snapshot.docs?.length),
    metadata: snapshot.metadata || { fromCache: false, hasPendingWrites: false },
    docChanges: () => (typeof snapshot.docChanges === 'function' ? snapshot.docChanges() : [])
      .map((change) => ({ ...change, doc: wrapDocSnapshot(change.doc) })),
  };
}

// api — набор функций modular Firestore. Параметр явный, чтобы адаптер
// проверялся unit-тестом без загрузки SDK и сети.
export function createFirestoreAdapter(firestore, api) {
  const makeDoc = (ref) => ({
    id: ref.id,
    path: ref.path,
    get: async () => wrapDocSnapshot(await api.getDoc(ref)),
    set: async (data, options = undefined) => (options
      ? api.setDoc(ref, data, options)
      : api.setDoc(ref, data)),
    update: async (data) => api.updateDoc(ref, data),
    delete: async () => api.deleteDoc(ref),
    onSnapshot: (next, error) => api.onSnapshot(ref, (snap) => next(wrapDocSnapshot(snap)), error),
    collection: (subpath) => makeCollection(api.collection(ref, subpath)),
  });

  const makeQuery = (base, constraints = []) => {
    const ref = constraints.length ? api.query(base, ...constraints) : base;
    return {
      where: (field, op, value) => makeQuery(base, [...constraints, api.where(field, op, value)]),
      orderBy: (field, direction = 'asc') => makeQuery(base, [...constraints, api.orderBy(field, direction)]),
      limit: (count) => makeQuery(base, [...constraints, api.limit(count)]),
      get: async () => wrapQuerySnapshot(await api.getDocs(ref)),
      onSnapshot: (next, error) => api.onSnapshot(ref, (snap) => next(wrapQuerySnapshot(snap)), error),
    };
  };

  const makeCollection = (ref) => ({
    ...makeQuery(ref),
    path: ref.path,
    doc: (id = null) => makeDoc(id ? api.doc(ref, id) : api.doc(ref)),
    add: async (data) => makeDoc(await api.addDoc(ref, data)),
  });

  return {
    doc: (path) => makeDoc(api.doc(firestore, path)),
    collection: (path) => makeCollection(api.collection(firestore, path)),
  };
}

async function loadSdk() {
  const [appApi, authApi, firestoreApi] = await Promise.all([
    import(`${SDK_ROOT}/firebase-app.js`),
    import(`${SDK_ROOT}/firebase-auth.js`),
    import(`${SDK_ROOT}/firebase-firestore.js`),
  ]);
  return { appApi, authApi, firestoreApi };
}

function notifyAuth(runtime) {
  const state = { configured: true, user: account(runtime.user), error: null };
  for (const listener of [...authListeners]) listener(state);
}

export async function initializeFirebase() {
  if (!firebaseConfigured()) return null;
  runtimePromise ??= (async () => {
    const { appApi, authApi, firestoreApi } = await loadSdk();
    const app = appApi.getApps().find((candidate) => candidate.name === APP_NAME)
      || appApi.initializeApp(FIREBASE_CONFIG, APP_NAME);
    const auth = authApi.getAuth(app);
    try {
      await authApi.setPersistence(auth, authApi.browserLocalPersistence);
    } catch {
      // Приватный режим иногда запрещает постоянное хранилище. Вход всё
      // равно должен работать до закрытия вкладки.
      await authApi.setPersistence(auth, authApi.inMemoryPersistence);
    }
    // Не держим документы Firestore в постоянном IndexedDB-кэше: после
    // выхода на общем компьютере служебная копия чужого облака не должна
    // оставаться в профиле браузера. Офлайн-страховку обеспечивает отдельное
    // локальное автосохранение, изолированное по Firebase UID.
    const firestore = firestoreApi.getFirestore(app);
    const runtime = {
      app, auth, authApi, firestore,
      db: createFirestoreAdapter(firestore, firestoreApi),
      user: null,
      authUnsubscribe: null,
    };
    await new Promise((resolve, reject) => {
      let initial = true;
      runtime.authUnsubscribe = authApi.onAuthStateChanged(auth, (user) => {
        runtime.user = user || null;
        notifyAuth(runtime);
        if (initial) { initial = false; resolve(); }
      }, (error) => {
        if (initial) { initial = false; reject(readableFirebaseError(error)); }
        else {
          const state = { configured: true, user: null, error: readableFirebaseError(error) };
          for (const listener of [...authListeners]) listener(state);
        }
      });
    });
    return runtime;
  })();
  try {
    return await runtimePromise;
  } catch (error) {
    runtimePromise = null;
    throw readableFirebaseError(error);
  }
}

export async function firebaseState() {
  if (!firebaseConfigured()) return { configured: false, user: null, error: null };
  try {
    const runtime = await initializeFirebase();
    return { configured: true, user: account(runtime?.user), error: null };
  } catch (error) {
    return { configured: true, user: null, error: readableFirebaseError(error) };
  }
}

export function onFirebaseAuthChanged(listener) {
  authListeners.add(listener);
  initializeFirebase()
    .then((runtime) => {
      if (runtime && authListeners.has(listener)) listener({ configured: true, user: account(runtime.user), error: null });
      else if (!runtime && authListeners.has(listener)) listener({ configured: false, user: null, error: null });
    })
    .catch((error) => {
      if (authListeners.has(listener)) listener({ configured: true, user: null, error: readableFirebaseError(error) });
    });
  return () => authListeners.delete(listener);
}

export async function firebaseSignInGoogle() {
  if (!firebaseConfigured()) throw new Error('Firebase ещё не настроен');
  try {
    const runtime = await initializeFirebase();
    const provider = new runtime.authApi.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    const result = await runtime.authApi.signInWithPopup(runtime.auth, provider);
    return account(result.user);
  } catch (error) {
    throw readableFirebaseError(error);
  }
}

export async function firebaseSignOut() {
  const runtime = await initializeFirebase();
  if (runtime) await runtime.authApi.signOut(runtime.auth);
}
