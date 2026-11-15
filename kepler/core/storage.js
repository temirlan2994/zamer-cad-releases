// Проекты с историей версий поверх db-подобного хранилища: облако claude.ai
// (capability `db`) или браузер (core/memdb.js + IndexedDB). Без DOM.
//
// Раскладка (root — коллекция проектов одного человека):
//   <root>/<pid>               карточка: имя, даты, версии (новые первыми), картинки
//   <root>/<pid>/c/<vid>.<i>   текст версии кусками ≤ 200 КиБ (лимит документа 256 КиБ)
//   <root>/<pid>/b/<hash>.<i>  тяжёлые данные (картинка топосъёмки) — одна копия
//                              на все версии, удаляется, когда на неё никто не ссылается
//   <root>/<pid>/draft/current последний облачный черновик (указатель)
//   <root>/<pid>/draft/<rev>.<i> части текста черновика
//   <root>/<pid>/draft-blobs/<hash>.<i> тяжёлые данные черновика
//
// Личные проекты: root = data/users/<uid> — видит только владелец.
// Публикация «для просмотра»: root = shared/<uid>/p, оглавление — shared/<uid>
// (читают все, кто открыл артефакт; пишет только автор).

export const CHUNK_BYTES = 200 * 1024;
export const KEEP_VERSIONS = 30;
// 256 × 200 КиБ ≈ 50 МиБ на один JSON/blob — уже намного больше обычного
// проекта, но не позволяет повреждённым метаданным запустить тысячи чтений.
const MAX_CHUNKS = 256;
const MAX_BLOBS = 512;
const HEAVY_MIN = 4096; // строки data:… длиннее — в отдельные документы
const BLOB_PREFIX = 'kblob:';
const SAFE_ID = /^[A-Za-z0-9._:@+~-]{1,128}$/;

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

const safeId = (value) => typeof value === 'string' && SAFE_ID.test(value);

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
  if (parts.length > MAX_CHUNKS) throw new Error('Проект слишком большой для облачного хранения');
  await inBatches(parts.map((s, i) => [i, s]), 4, ([i, s]) => retry(() => db.doc(`${coll}/${prefix}.${i}`).set({ s })));
  return parts.length;
}

async function readChunks(db, coll, prefix, count) {
  if (!safeId(prefix) || !Number.isInteger(count) || count < 1 || count > MAX_CHUNKS) {
    throw new Error('Некорректное описание частей проекта');
  }
  const parts = Array(count);
  await inBatches(Array.from({ length: count }, (_, i) => i), 8, async (i) => {
    const snap = await retry(() => db.doc(`${coll}/${prefix}.${i}`).get());
    const s = snap.exists ? snap.data()?.s : undefined;
    if (typeof s !== 'string') throw new Error(`Нет части ${i + 1} из ${count} (${prefix}) — данные повреждены или нет доступа`);
    parts[i] = s;
  });
  return parts.join('');
}

async function deleteChunks(db, coll, prefix, count) {
  if (!safeId(prefix) || !Number.isInteger(count) || count < 1 || count > MAX_CHUNKS) return;
  await inBatches(Array.from({ length: count }, (_, i) => i), 4, (i) => retry(() => db.doc(`${coll}/${prefix}.${i}`).delete()));
}

const clone = (v) => JSON.parse(JSON.stringify(v));

export async function getProject(db, root, pid) {
  const snap = await retry(() => db.doc(`${root}/${pid}`).get());
  return snap.exists ? { id: pid, ...clone(snap.data()) } : null;
}

const draftColl = (root, pid) => `${root}/${pid}/draft`;
const draftBlobsColl = (root, pid) => `${root}/${pid}/draft-blobs`;
const draftRef = (db, root, pid) => db.doc(`${draftColl(root, pid)}/current`);

function normalizedDraft(data) {
  if (!data || typeof data !== 'object') return null;
  const revision = typeof data.revision === 'string' ? data.revision : '';
  const chunks = Number(data.chunks);
  if (!safeId(revision) || !Number.isInteger(chunks) || chunks < 1 || chunks > MAX_CHUNKS) return null;
  const blobs = data.blobs && typeof data.blobs === 'object' && !Array.isArray(data.blobs)
    ? Object.fromEntries(Object.entries(data.blobs)
      .filter(([h, n]) => safeId(h) && Number.isInteger(Number(n)) && Number(n) > 0 && Number(n) <= MAX_CHUNKS)
      .slice(0, MAX_BLOBS)
      .map(([h, n]) => [h, Number(n)]))
    : {};
  return { ...clone(data), revision, chunks, blobs };
}

async function touchDraftMeta(db, root, pid, { at, name, revision, stats }) {
  const ref = db.doc(`${root}/${pid}`);
  let fields = {
    name: name || 'Без названия',
    updatedAt: at,
    draftUpdatedAt: at,
    draftRevision: revision,
    draftStats: stats,
  };
  const snap = await retry(() => ref.get());
  if (snap.exists) {
    const current = snap.data() || {};
    if (String(current.updatedAt || '') > String(at)) {
      fields = { ...fields, name: current.name || fields.name, updatedAt: current.updatedAt };
    }
    await retry(() => ref.update(fields));
    return { id: pid, ...clone(current), ...fields };
  }
  const meta = { createdAt: at, versions: [], blobs: {}, head: null, ...fields };
  await retry(() => ref.set(meta));
  return { id: pid, ...meta };
}

// Фоновое облачное сохранение. Черновик отделён от ручных версий: частые
// правки не засоряют их список, а последний проект можно продолжить на
// другом устройстве. Указатель пишется только после всех частей.
export async function saveDraft(db, root, projectText, {
  pid, stats = null, now = new Date(),
} = {}) {
  if (!pid) throw new Error('Нет идентификатора проекта');
  const at = now.toISOString();
  const { body, blobs, name } = splitHeavy(projectText);
  const hash = hashText(body);
  const ref = draftRef(db, root, pid);
  const beforeSnap = await retry(() => ref.get());
  const before = beforeSnap.exists ? normalizedDraft(beforeSnap.data()) : null;
  if (before?.hash === hash) {
    const meta = await getProject(db, root, pid);
    const savedMeta = meta?.draftRevision === before.revision
      ? meta
      : await touchDraftMeta(db, root, pid, {
        at: before.updatedAt || at,
        name: name || before.name,
        revision: before.revision,
        stats: before.stats ?? stats,
      });
    return { meta: savedMeta, draft: before, unchanged: true };
  }

  const blobChunks = {};
  for (const [h, text] of Object.entries(blobs)) {
    blobChunks[h] = before?.blobs?.[h]
      || await writeChunks(db, draftBlobsColl(root, pid), h, text);
  }
  const revision = newId('d');
  const chunks = await writeChunks(db, draftColl(root, pid), revision, body);
  const draft = {
    revision,
    updatedAt: at,
    name: name || 'Без названия',
    hash,
    chunks,
    bytes: body.length,
    blobs: blobChunks,
    stats,
  };
  await retry(() => ref.set(draft));
  // Карточка следует за фактическим указателем, даже если другая вкладка
  // успела заменить его между записью частей и этим чтением.
  let check = await retry(() => ref.get());
  let active = check.exists ? normalizedDraft(check.data()) : null;
  let meta = active
    ? await touchDraftMeta(db, root, pid, {
      at: active.updatedAt || at,
      name: active.name || name,
      revision: active.revision,
      stats: active.stats ?? stats,
    })
    : await getProject(db, root, pid);
  const finalCheck = await retry(() => ref.get());
  const finalActive = finalCheck.exists ? normalizedDraft(finalCheck.data()) : null;
  if (finalActive && finalActive.revision !== active?.revision) {
    active = finalActive;
    meta = await touchDraftMeta(db, root, pid, {
      at: active.updatedAt || at,
      name: active.name || name,
      revision: active.revision,
      stats: active.stats ?? stats,
    });
    check = finalCheck;
  }

  // Не удаляем данные, если другая вкладка уже успела положить новый
  // указатель: её черновик мог переиспользовать прежний blob.
  if (check.exists && check.data()?.revision === revision && before) {
    await deleteChunks(db, draftColl(root, pid), before.revision, before.chunks);
    for (const [h, n] of Object.entries(before.blobs)) {
      if (!(h in blobChunks)) await deleteChunks(db, draftBlobsColl(root, pid), h, n);
    }
  }
  return { meta, draft, unchanged: false, superseded: active?.revision !== revision };
}

export async function loadDraft(db, root, pid) {
  const snap = await retry(() => draftRef(db, root, pid).get());
  if (!snap.exists) return null;
  const draft = normalizedDraft(snap.data());
  if (!draft) throw new Error('Облачный черновик повреждён');
  const body = await readChunks(db, draftColl(root, pid), draft.revision, draft.chunks);
  const blobs = {};
  for (const [h, n] of Object.entries(draft.blobs)) {
    blobs[h] = await readChunks(db, draftBlobsColl(root, pid), h, n);
  }
  const { text, missing } = joinHeavy(body, blobs);
  return { text, draft, missing };
}

export async function deleteDraft(db, root, pid) {
  const ref = draftRef(db, root, pid);
  const snap = await retry(() => ref.get());
  if (!snap.exists) return false;
  const draft = normalizedDraft(snap.data());
  if (draft) {
    await deleteChunks(db, draftColl(root, pid), draft.revision, draft.chunks);
    for (const [h, n] of Object.entries(draft.blobs)) {
      await deleteChunks(db, draftBlobsColl(root, pid), h, n);
    }
  }
  await retry(() => ref.delete());
  const metaRef = db.doc(`${root}/${pid}`);
  const metaSnap = await retry(() => metaRef.get());
  if (metaSnap.exists) {
    const meta = metaSnap.data() || {};
    await retry(() => metaRef.update({
      draftUpdatedAt: null,
      draftRevision: null,
      draftStats: null,
      updatedAt: meta.versions?.[0]?.at || meta.createdAt || meta.updatedAt || null,
    }));
  }
  return true;
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

  // 2) карточка — после данных: оборванное сохранение не портит прежние версии.
  // Проверка ревизии: пока писались данные, другая вкладка могла сохранить
  // свою версию — тогда берём свежую карточку, а свою версию кладём сверху
  // (иначе последняя запись стёрла бы чужую версию).
  // После записи — проверка, что наша версия в карточке осталась (запись
  // другой вкладки могла лечь сверху); нет — сливаем ещё раз.
  const written = { ...meta.blobs };
  let base = meta;
  let result = null;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const fresh = await retry(() => metaRef.get());
    const latest = fresh.exists ? clone(fresh.data()) : null;
    if (latest && (attempt > 0 || latest.head !== meta.head || latest.updatedAt !== meta.updatedAt)) {
      base = rebaseMeta(latest, blobs, written);
    }
    result = buildMeta(base, version, keep, name, at);
    await retry(() => metaRef.set(result.meta));
    const check = await retry(() => metaRef.get());
    if (!check.exists || (check.data()?.versions || []).some((v) => v?.id === vid)) break;
    base = result.meta;
  }
  const { meta: saved, dropped, deadBlobs } = result;

  // 3) уборка вытесненных версий и ненужных картинок
  for (const v of dropped) await deleteChunks(db, `${root}/${pid}/c`, v.id, v.chunks);
  for (const [h, n] of deadBlobs) await deleteChunks(db, `${root}/${pid}/b`, h, n);
  return { meta: { id: pid, ...saved }, version, unchanged: false };
}

// Свежая карточка (её записала другая вкладка) + картинки, которые записали мы.
function rebaseMeta(latest, blobs, written) {
  const meta = { ...latest };
  meta.versions = Array.isArray(latest.versions) ? latest.versions : [];
  meta.blobs = latest.blobs && typeof latest.blobs === 'object' ? { ...latest.blobs } : {};
  for (const h of Object.keys(blobs)) if (!meta.blobs[h] && written[h]) meta.blobs[h] = written[h];
  return meta;
}

// Карточка с новой версией сверху: лишние версии и ненужные картинки — на уборку.
function buildMeta(base, version, keep, name, at) {
  const meta = { ...base, blobs: { ...base.blobs } };
  const versions = [version, ...(base.versions || []).filter((v) => v?.id !== version.id)];
  const dropped = versions.slice(keep);
  meta.versions = versions.slice(0, keep);
  const live = new Set(meta.versions.flatMap((v) => v.blobs || []));
  const deadBlobs = Object.entries(meta.blobs).filter(([h]) => !live.has(h));
  for (const [h] of deadBlobs) delete meta.blobs[h];
  Object.assign(meta, { name: name || meta.name || 'Без названия', updatedAt: at, head: version.id });
  return { meta, dropped, deadBlobs };
}

function normalizedVersion(value) {
  if (!value || typeof value !== 'object' || !safeId(value.id)) return null;
  const chunks = Number(value.chunks);
  if (!Number.isInteger(chunks) || chunks < 1 || chunks > MAX_CHUNKS) return null;
  const blobs = Array.isArray(value.blobs)
    ? value.blobs.filter(safeId).slice(0, MAX_BLOBS)
    : [];
  return { ...clone(value), id: value.id, chunks, blobs };
}

// Текст проекта нужной версии (по умолчанию — последней).
export async function loadVersion(db, root, pid, vid = null) {
  const meta = await getProject(db, root, pid);
  if (!meta) throw new Error('Проект не найден (удалён или нет доступа)');
  const versions = Array.isArray(meta.versions) ? meta.versions.map(normalizedVersion).filter(Boolean) : [];
  const version = vid ? versions.find((v) => v.id === vid) : versions[0];
  if (!vid && meta.draftUpdatedAt && (!version || String(meta.draftUpdatedAt) > String(version.at || ''))) {
    try {
      const saved = await loadDraft(db, root, pid);
      if (saved) {
        return {
          text: saved.text,
          meta,
          version: {
            id: 'draft', at: saved.draft.updatedAt, note: 'Автосохранение',
            bytes: saved.draft.bytes, stats: saved.draft.stats, isDraft: true,
          },
          missing: saved.missing,
          draft: saved.draft,
        };
      }
    } catch (error) {
      if (!version) throw error;
      // Повреждённый черновик не блокирует последнюю ручную версию.
    }
  }
  if (!version) throw new Error('Версия не найдена');
  const body = await readChunks(db, `${root}/${pid}/c`, version.id, version.chunks);
  const blobs = {};
  for (const h of version.blobs || []) {
    const count = Number(meta.blobs?.[h]);
    blobs[h] = Number.isInteger(count) && count > 0 && count <= MAX_CHUNKS
      ? await readChunks(db, `${root}/${pid}/b`, h, count)
      : undefined;
  }
  const { text, missing } = joinHeavy(body, blobs);
  return { text, meta, version, missing };
}

export async function deleteProject(db, root, pid) {
  const meta = await getProject(db, root, pid);
  if (meta) {
    const versions = Array.isArray(meta.versions) ? meta.versions.map(normalizedVersion).filter(Boolean) : [];
    for (const v of versions) await deleteChunks(db, `${root}/${pid}/c`, v.id, v.chunks);
    for (const [h, n] of Object.entries(meta.blobs || {}).slice(0, MAX_BLOBS)) {
      await deleteChunks(db, `${root}/${pid}/b`, h, Number(n));
    }
  }
  await deleteDraft(db, root, pid);
  if (meta) await retry(() => db.doc(`${root}/${pid}`).delete());
}

const byDateDesc = (a, b) => String(b.updatedAt || b.at || '').localeCompare(String(a.updatedAt || a.at || ''));

function projectsFrom(snap) {
  return snap.docs.filter((d) => d.exists && Array.isArray(d.data()?.versions)).map((d) => {
    const data = clone(d.data());
    data.versions = data.versions.map(normalizedVersion).filter(Boolean).slice(0, KEEP_VERSIONS);
    return { id: d.id, ...data };
  }).sort(byDateDesc);
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
  await retry(() => ref.set({ items: items.slice(0, 100), updatedAt: version.at }));
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
    .filter((it) => it && safeId(it.pid))
    .map((it) => ({
      pid: it.pid,
      name: typeof it.name === 'string' ? it.name.slice(0, 200) : 'Без названия',
      at: typeof it.at === 'string' ? it.at.slice(0, 64) : '',
      stats: it.stats && typeof it.stats === 'object'
        ? { rooms: Number.isFinite(Number(it.stats.rooms)) ? Number(it.stats.rooms) : 0 }
        : null,
      owner: d.id,
    })))
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
