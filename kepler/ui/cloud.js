// Где хранятся проекты и как отдаются файлы.
//  • в артефакте claude.ai: capability `db` (облако; нужен вход) + `user`;
//  • иначе (страница открыта сама по себе): браузер, IndexedDB.
// Скачивание в артефакте — capability `downloads` (формы вроде .dxf/.ifc там
// запрещены, их кладём в .zip); без неё — обычная ссылка с download.

import { buildZip } from '../core/zip.js';
import { userRoot } from '../core/storage.js';
import { firebaseConfigured } from '../firebase-config.js';
import { toast } from './dom.js';
import {
  firebaseSignInGoogle, firebaseSignOut, firebaseState, initializeFirebase,
  onFirebaseAuthChanged,
} from './firebase.js';
import { createLocalDb } from './localdb.js';

const withTimeout = (promise, ms) => Promise.race([
  promise,
  new Promise((resolve) => { setTimeout(() => resolve(null), ms); }),
]);

let claudeBackendPromise = null;
let localBackendPromise = null;

async function claudeBackend() {
  if (!globalThis.claude?.use) return null;
  claudeBackendPromise ??= (async () => {
    try {
      const claude = globalThis.claude;
      const [db, user] = await Promise.all([withTimeout(claude.use('db'), 8000), withTimeout(claude.use('user'), 8000)]);
      if (!db || !user?.id) return null;
      const uid = await user.id();
      return uid ? {
        mode: 'cloud', provider: 'claude', db, uid: String(uid),
        root: userRoot(uid), persistent: true,
        user: { uid: String(uid), name: '', email: '', photoURL: '' },
      } : null;
    } catch { return null; }
  })();
  return claudeBackendPromise;
}

async function localBackend() {
  localBackendPromise ??= createLocalDb().then((local) => ({
    mode: 'browser', provider: 'local', db: local.db, uid: 'local',
    root: userRoot('local'), persistent: local.persistent, user: null,
  }));
  return localBackendPromise;
}

export function getLocalBackend() { return localBackend(); }

// → { mode: 'cloud' | 'browser', db, uid, root, persistent }
export function getBackend() {
  return (async () => {
    const claude = await claudeBackend();
    if (claude) return claude;
    if (firebaseConfigured()) {
      try {
        // firebaseState не грузит SDK для первого гостя; сеть нужна только
        // при явном входе или восстановлении уже известной сессии.
        const state = await withTimeout(firebaseState(), 8000);
        if (state?.user) {
          const runtime = await withTimeout(initializeFirebase(), 8000);
          const user = {
            uid: String(state.user.uid), name: state.user.name || '',
            email: state.user.email || '', photoURL: state.user.photoURL || '',
          };
          return {
            mode: 'cloud', provider: 'firebase', db: runtime.db, uid: user.uid,
            root: userRoot(user.uid), persistent: true, user,
          };
        }
      } catch { /* Firebase недоступен — локальный режим остаётся рабочим */ }
    }
    return localBackend();
  })();
}

export async function getAccountState() {
  const claude = await claudeBackend();
  if (claude) return { provider: 'claude', configured: true, signedIn: true, user: claude.user, error: null };
  const state = await withTimeout(firebaseState(), 8000) || {
    configured: firebaseConfigured(), user: null,
    error: new Error('Google/Firebase пока не отвечает — доступен локальный режим'),
  };
  return {
    provider: state.configured ? 'firebase' : 'local',
    configured: state.configured,
    signedIn: Boolean(state.user),
    user: state.user,
    error: state.error,
  };
}

// Вызывается до loadAutosave(): так локальные ключи сразу получают namespace
// текущего Google/Claude uid и один пользователь общего компьютера не увидит
// черновик другого.
export async function prepareAccount() {
  const state = await getAccountState();
  return { ...state, uid: state.user?.uid || 'guest' };
}

export async function getInitialAccountUid() {
  return (await prepareAccount()).uid;
}

export async function initializeCloud() {
  await getAccountState();
  return getBackend();
}

export function onAccountChange(listener) {
  if (globalThis.claude?.use) {
    getAccountState().then(listener);
    return () => {};
  }
  if (!firebaseConfigured()) {
    queueMicrotask(() => listener({ provider: 'local', configured: false, signedIn: false, user: null, error: null }));
    return () => {};
  }
  return onFirebaseAuthChanged((state) => listener({
    provider: 'firebase', configured: state.configured,
    signedIn: Boolean(state.user), user: state.user, error: state.error,
  }));
}

export async function signInGoogle() {
  await firebaseSignInGoogle();
  return getAccountState();
}

export async function signOutGoogle() {
  await firebaseSignOut();
  return getAccountState();
}

// Расширения, которые принимает capability `downloads`.
const CLOUD_EXT = new Set('gif png jpg jpeg webp mp4 webm mov txt json md docx pptx epub csv ttf html svg pdf xlsx zip fig'.split(' '));

async function toBytes(data) {
  if (typeof data === 'string') return new TextEncoder().encode(data);
  if (data instanceof Blob) return new Uint8Array(await data.arrayBuffer());
  return data;
}

function anchorDownload(filename, data, mime) {
  const blob = data instanceof Blob ? data : new Blob([data], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// Один файл: filename + данные (строка | Uint8Array | Blob).
export async function saveFile(filename, data, mime = 'application/octet-stream') {
  try {
    const claude = globalThis.claude;
    const downloads = claude?.use ? await withTimeout(claude.use('downloads'), 3000) : null;
    if (downloads) {
      let name = filename;
      let payload = data;
      const ext = name.slice(name.lastIndexOf('.') + 1).toLowerCase();
      if (!CLOUD_EXT.has(ext)) { // .dxf, .ifc — только в архиве
        payload = buildZip([{ name, data: await toBytes(data) }]);
        name = `${name.replace(/\.[^.]+$/, '')}.zip`;
      }
      await downloads.save({ filename: name, data: payload });
      return true;
    }
    anchorDownload(filename, data, mime);
    return true;
  } catch (error) {
    if (error?.code === 'declined') return false;
    toast('Скачивание недоступно в этом окружении — используйте «Копировать»', true);
    return false;
  }
}

// Несколько файлов одним архивом: [{ name, data }].
export async function saveZip(filename, files) {
  const entries = [];
  for (const f of files) entries.push({ name: f.name, data: await toBytes(f.data) });
  return saveFile(filename, buildZip(entries), 'application/zip');
}
