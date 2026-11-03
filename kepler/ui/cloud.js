// Где хранятся проекты и как отдаются файлы.
//  • в артефакте claude.ai: capability `db` (облако; нужен вход) + `user`;
//  • иначе (страница открыта сама по себе): браузер, IndexedDB.
// Скачивание в артефакте — capability `downloads` (формы вроде .dxf/.ifc там
// запрещены, их кладём в .zip); без неё — обычная ссылка с download.

import { buildZip } from '../core/zip.js';
import { userRoot } from '../core/storage.js';
import { toast } from './dom.js';
import { createLocalDb } from './localdb.js';

const withTimeout = (promise, ms) => Promise.race([
  promise,
  new Promise((resolve) => { setTimeout(() => resolve(null), ms); }),
]);

let backendPromise = null;

// → { mode: 'cloud' | 'browser', db, uid, root, persistent }
export function getBackend() {
  backendPromise ??= (async () => {
    try {
      const claude = globalThis.claude;
      if (claude?.use) {
        const [db, user] = await Promise.all([withTimeout(claude.use('db'), 8000), withTimeout(claude.use('user'), 8000)]);
        if (db && user?.id) {
          const uid = await user.id();
          if (uid) return { mode: 'cloud', db, uid: String(uid), root: userRoot(uid), persistent: true };
        }
      }
    } catch { /* нет облака — работаем в браузере */ }
    const local = await createLocalDb();
    return { mode: 'browser', db: local.db, uid: 'local', root: userRoot('local'), persistent: local.persistent };
  })();
  return backendPromise;
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
