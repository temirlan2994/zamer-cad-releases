// Проекты с историей версий поверх db-подобного хранилища: облако claude.ai
// (capability `db`) или браузер (core/memdb.js + IndexedDB). Без DOM.
//
// Раскладка (root — коллекция проектов одного человека):
//   <root>/<pid>               карточка: имя, даты, версии (новые первыми), картинки
//   <root>/<pid>/c/<vid>.<i>   текст версии кусками ≤ 200 КиБ (лимит документа 256 КиБ)
//   <root>/<pid>/b/<hash>.<i>  тяжёлые данные (картинка топосъёмки) — одна копия
//                              на все версии, удаляется, когда на неё никто не ссылается
//
// Личные проекты: root = data/users/<uid> — видит только владелец.
// Публикация «для просмотра»: root = shared/<uid>/p, оглавление — shared/<uid>
// (читают все, кто открыл артефакт; пишет только автор).

export const CHUNK_BYTES = 200 * 1024;
export const KEEP_VERSIONS = 30;
const HEAVY_MIN = 4096; // строки data:… длиннее — в отдельные документы
const BLOB_PREFIX = 'kblob:';

// cyrb53 + длина — быстрый некриптографический отпечаток (символы [0-9a-z]).
export function hashText(text) {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36) + text.length.toString(36);
}

export function newId(prefix) {
  return `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

const encoder = new TextEncoder();
const docBytes = (s) => encoder.encode(JSON.stringify({ s })).length;

// Нарезка строки на куски, каждый из которых как документ {s} ≤ maxBytes
// в UTF-8 (кириллица — 2 байта, кавычки экранируются).
export function chunkText(text, maxBytes = CHUNK_BYTES) {
  const out = [];
  let i = 0;
  while (i < text.length) {
    let n = Math.min(maxBytes, text.length - i);
    while (n > 1 && docBytes(text.slice(i, i + n)) > maxBytes) n = Math.floor(n * 0.8);
    const last = text.charCodeAt(i + n - 1);
    if (n > 1 && i + n < text.length && last >= 0xd800 && last <= 0xdbff) n -= 1; // не рвать суррогатную пару
    out.push(text.slice(i, i + n));
    i += n;
  }
  return out.length ? out : [''];
}

function walkStrings(node, fn) {
  if (Array.isArray(node)) {
    node.forEach((v, i) => { if (typeof v === 'string') node[i] = fn(v); else if (v && typeof v === 'object') walkStrings(v, fn); });
  } else if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      if (typeof v === 'string') node[k] = fn(v); else if (v && typeof v === 'object') walkStrings(v, fn);
    }
  }
}

// Тяжёлые строки data:… выносятся в blobs[hash], в тексте — ссылка kblob:hash.
export function splitHeavy(projectText) {
  const data = JSON.parse(projectText);
  const blobs = {};
  walkStrings(data, (s) => {
    if (s.length <= HEAVY_MIN || !s.startsWith('data:')) return s;
    const h = hashText(s);
    blobs[h] = s;
    return BLOB_PREFIX + h;
  });
  return { body: JSON.stringify(data), blobs, name: typeof data.name === 'string' ? data.name : '' };
}

// Обратно: ссылки kblob:hash → данные. Пропавшие картинки — null (и в missing).
export function joinHeavy(bodyText, blobs) {
  const data = JSON.parse(bodyText);
  const missing = [];
  walkStrings(data, (s) => {
    if (!s.startsWith(BLOB_PREFIX)) return s;
    const h = s.slice(BLOB_PREFIX.length);
    if (typeof blobs[h] === 'string') return blobs[h];
    missing.push(h);
    return null;
  });
  return { text: JSON.stringify(data), missing };
}

// Временный сбой хранилища — одна повторная попытка после паузы.
async function retry(fn) {
  try {
    return await fn();
  } catch (error) {
    if (error?.code !== 'unavailable') throw error;
    await new Promise((r) => { setTimeout(r, 300 + Math.random() * 500); });
    return fn();
  }
}

async function inBatches(items, size, fn) {
  for (let i = 0; i < items.length; i += size) {
    await Promise.all(items.slice(i, i + size).map(fn));
  }
}

async function writeChunks(db, coll, prefix, text) {
  const parts = chunkText(text);
  await inBatches(parts.map((s, i) => [i, s]), 4, ([i, s]) => retry(() => db.doc(`${coll}/${prefix}.${i}`).set({ s })));
  return parts.length;
}

async function readChunks(db, coll, prefix, count) {
  const parts = await Promise.all(Array.from({ length: count }, (_, i) => retry(() => db.doc(`${coll}/${prefix}.${i}`).get())));
  return parts.map((snap, i) => {
    const s = snap.exists ? snap.data()?.s : undefined;
    if (typeof s !== 'string') throw new Error(`Нет части ${i + 1} из ${count} (${prefix}) — данные повреждены или нет доступа`);
    return s;
  }).join('');
}

async function deleteChunks(db, coll, prefix, count) {
  await inBatches(Array.from({ length: count }, (_, i) => i), 4, (i) => retry(() => db.doc(`${coll}/${prefix}.${i}`).delete()));
}

const clone = (v) => JSON.parse(JSON.stringify(v));

export async function getProject(db, root, pid) {
  const snap = await retry(() => db.doc(`${root}/${pid}`).get());
  return snap.exists ? { id: pid, ...clone(snap.data()) } : null;
}

// Сохранить новую версию. Без изменений с последней версии — ничего не
// пишется (unchanged: true). keep — сколько версий хранить (старые удаляются).
export async function saveVersion(db, root, projectText, {
  pid, note = '', stats = null, keep = KEEP_VERSIONS, now = new Date(),
} = {}) {
  if (!pid) throw new Error('Нет идентификатора проекта');
  const metaRef = db.doc(`${root}/${pid}`);
  const snap = await retry(() => metaRef.get());
  const at = now.toISOString();
  const meta = snap.exists ? clone(snap.data()) : { createdAt: at, versions: [], blobs: {} };
  meta.versions = Array.isArray(meta.versions) ? meta.versions : [];
  meta.blobs = meta.blobs && typeof meta.blobs === 'object' ? meta.blobs : {};
  const { body, blobs, name } = splitHeavy(projectText);
  const hash = hashText(body);
  if (meta.versions[0]?.hash === hash && meta.versions.length <= keep) {
    if (note && !meta.versions[0].note) { // подпись к уже сохранённому
      meta.versions[0].note = note;
      await retry(() => metaRef.set(meta));
    }
    return { meta: { id: pid, ...meta }, version: meta.versions[0], unchanged: true };
  }

  // 1) данные: картинки (если новых нет — не пишутся), затем текст версии
  for (const [h, text] of Object.entries(blobs)) {
    if (!meta.blobs[h]) meta.blobs[h] = await writeChunks(db, `${root}/${pid}/b`, h, text);
  }
  const vid = newId('v');
  const chunks = await writeChunks(db, `${root}/${pid}/c`, vid, body);
  const version = { id: vid, at, note, hash, chunks, bytes: body.length, blobs: Object.keys(blobs), stats };

  // 2) карточка — после данных: оборванное сохранение не портит прежние версии
  meta.versions = [version, ...meta.versions];
  const dropped = meta.versions.slice(keep);
  meta.versions = meta.versions.slice(0, keep);
  const live = new Set(meta.versions.flatMap((v) => v.blobs || []));
  const deadBlobs = Object.entries(meta.blobs).filter(([h]) => !live.has(h));
  for (const [h] of deadBlobs) delete meta.blobs[h];
  Object.assign(meta, { name: name || meta.name || 'Без названия', updatedAt: at, head: vid });
  await retry(() => metaRef.set(meta));

  // 3) уборка вытесненных версий и ненужных картинок
  for (const v of dropped) await deleteChunks(db, `${root}/${pid}/c`, v.id, v.chunks);
  for (const [h, n] of deadBlobs) await deleteChunks(db, `${root}/${pid}/b`, h, n);
  return { meta: { id: pid, ...meta }, version, unchanged: false };
}

// Текст проекта нужной версии (по умолчанию — последней).
export async function loadVersion(db, root, pid, vid = null) {
  const meta = await getProject(db, root, pid);
  if (!meta) throw new Error('Проект не найден (удалён или нет доступа)');
  const version = vid ? meta.versions.find((v) => v.id === vid) : meta.versions[0];
  if (!version) throw new Error('Версия не найдена');
  const body = await readChunks(db, `${root}/${pid}/c`, version.id, version.chunks);
  const blobs = {};
  for (const h of version.blobs || []) {
    blobs[h] = meta.blobs[h] ? await readChunks(db, `${root}/${pid}/b`, h, meta.blobs[h]) : undefined;
  }
  const { text, missing } = joinHeavy(body, blobs);
  return { text, meta, version, missing };
}

export async function deleteProject(db, root, pid) {
  const meta = await getProject(db, root, pid);
  if (!meta) return;
  for (const v of meta.versions || []) await deleteChunks(db, `${root}/${pid}/c`, v.id, v.chunks);
  for (const [h, n] of Object.entries(meta.blobs || {})) await deleteChunks(db, `${root}/${pid}/b`, h, n);
  await retry(() => db.doc(`${root}/${pid}`).delete());
}

const byDateDesc = (a, b) => String(b.updatedAt || b.at || '').localeCompare(String(a.updatedAt || a.at || ''));

function projectsFrom(snap) {
  return snap.docs.filter((d) => d.exists && Array.isArray(d.data()?.versions)).map((d) => ({ id: d.id, ...clone(d.data()) })).sort(byDateDesc);
}

export async function listProjects(db, root) {
  return projectsFrom(await retry(() => db.collection(root).get()));
}

// Подписка на список проектов (один раз на экран; возвращает отписку).
export function watchProjects(db, root, next, error) {
  return db.collection(root).onSnapshot((snap) => next(projectsFrom(snap)), error);
}

// ---------------------------------------------------------------- Публикация

export const userRoot = (uid) => `data/users/${uid}`;
export const sharedRoot = (uid) => `shared/${uid}/p`;
const sharedIndex = (uid) => `shared/${uid}`;

// Опубликовать снимок проекта для просмотра (последняя публикация заменяет прежнюю).
export async function publishProject(db, uid, projectText, { pid, stats = null, now = new Date() } = {}) {
  const { meta, version } = await saveVersion(db, sharedRoot(uid), projectText, { pid, stats, keep: 1, now });
  const ref = db.doc(sharedIndex(uid));
  const snap = await retry(() => ref.get());
  const items = (snap.exists ? clone(snap.data()?.items || []) : []).filter((it) => it.pid !== pid);
  items.unshift({ pid, name: meta.name, at: version.at, stats: version.stats ?? stats });
  await retry(() => ref.set({ items, updatedAt: version.at }));
  return { meta, version };
}

export async function unpublishProject(db, uid, pid) {
  await deleteProject(db, sharedRoot(uid), pid);
  const ref = db.doc(sharedIndex(uid));
  const snap = await retry(() => ref.get());
  if (!snap.exists) return;
  const items = (snap.data()?.items || []).filter((it) => it.pid !== pid);
  if (items.length) await retry(() => ref.set({ items, updatedAt: new Date().toISOString() }));
  else await retry(() => ref.delete());
}

function sharedFrom(snap) {
  return snap.docs.flatMap((d) => (d.exists ? (d.data()?.items || []) : [])
    .filter((it) => it && typeof it.pid === 'string')
    .map((it) => ({ ...clone(it), owner: d.id })))
    .sort(byDateDesc);
}

export async function listShared(db) {
  return sharedFrom(await retry(() => db.collection('shared').get()));
}

export function watchShared(db, next, error) {
  return db.collection('shared').onSnapshot((snap) => next(sharedFrom(snap)), error);
}

export function loadShared(db, owner, pid) {
  return loadVersion(db, sharedRoot(owner), pid);
}

// Правила доступа к `db` при публикации артефакта: публикации читают все,
// автор пишет только своё (владелец артефакта может убрать любую).
export const DB_RULES = [
  { path: 'shared', read: 'view', write: 'owner' },
  { path: 'shared/{self}', write: 'interact' },
];
