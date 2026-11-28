import { validateReviewSnapshot } from './concept-review.js';

const PART_SIZE = 180000, MAX_BYTES = 24*1024*1024, MAX_PARTS = 160;
export const REVIEW_COLLECTION = 'conceptReviews';
export function reviewToken() {
  return [...globalThis.crypto.getRandomValues(new Uint8Array(32))].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
const validId = (id) => /^[a-f0-9]{64}$/.test(id || '');
const millis = (value) => typeof value?.toMillis === 'function' ? value.toMillis() : value instanceof Date ? value.getTime() : Date.parse(value);
const ref = (db, id) => { if (!validId(id)) throw new Error('Некорректная ссылка согласования'); return db.doc(`${REVIEW_COLLECTION}/${id}`); };
const read = async (doc) => typeof doc.getServer === 'function' ? doc.getServer() : doc.get();

export async function publishReviewSnapshot(snapshot, backend, { now = Date.now(), durationDays = 7, baseUrl = 'https://example.invalid/' } = {}) {
  if (backend?.provider !== 'firebase' || backend.mode !== 'cloud' || !backend.uid) throw new Error('Для ссылки войдите в Google-облако. Без входа доступен клиентский файл HTML.');
  await validateReviewSnapshot(snapshot);
  const text = JSON.stringify(snapshot), bytes = new TextEncoder().encode(text).length;
  if (bytes > MAX_BYTES) throw new Error('Снимок превышает 24 МиБ. Для большого проекта используйте клиентский файл.');
  // Ограничиваем UTF-8-байты: кириллица и emoji не должны превышать
  // серверный предел, даже если длина JS-строки заметно меньше.
  const parts = []; let start = 0, index = 0, partBytes = 0;
  for (const character of text) {
    const code = character.codePointAt(0), size = code <= 0x7f ? 1 : code <= 0x7ff ? 2 : code <= 0xffff ? 3 : 4;
    if (partBytes+size > PART_SIZE) { parts.push(text.slice(start,index)); start=index; partBytes=0; }
    partBytes += size; index += character.length;
  }
  if (index > start) parts.push(text.slice(start));
  if (parts.length > MAX_PARTS) throw new Error('Снимок содержит слишком много данных для ссылки');
  if (!Number.isFinite(now) || !Number.isFinite(durationDays)) throw new Error('Некорректный срок ссылки');
  const id = reviewToken(), root = ref(backend.db, id), expires = now+Math.min(30, Math.max(1, durationDays))*86400000;
  const timestamp = (ms) => backend.db.timestampFromMillis?.(ms) || new Date(ms);
  await root.set({ schema: 1, ownerUid: backend.uid, createdAt: backend.db.serverTimestamp?.() || timestamp(now),
    expiresAt: timestamp(expires), revoked: false, ready: false, digest: snapshot.digest, snapshotId: snapshot.id,
    parts: parts.length, bytes, title: snapshot.name });
  try {
    for (let index = 0; index < parts.length; index++) await root.collection('parts').doc(String(index)).set({ text: parts[index], index });
    await root.update({ ready: true });
  } catch (error) {
    try { await root.update({ revoked: true }); } catch { /* Незавершённый снимок ready:false не читается посетителем. */ }
    throw error;
  }
  const url = new URL('review.html', baseUrl); url.hash = `review=${id}`;
  return { id, ownerUid: backend.uid, snapshotId: snapshot.id, digest: snapshot.digest, createdAt: new Date(now).toISOString(), expiresAt: new Date(expires).toISOString(), revoked: false, url: url.href };
}

export async function loadSharedReview(db, id, { now = Date.now() } = {}) {
  const root = ref(db, id), doc = await read(root), meta = doc.exists ? doc.data() : null;
  if (!meta || meta.revoked || !meta.ready || !Number.isFinite(millis(meta.expiresAt)) || millis(meta.expiresAt) <= now) throw new Error('Ссылка недоступна, отозвана или срок её действия истёк');
  if (!Number.isInteger(meta.parts) || meta.parts < 1 || meta.parts > MAX_PARTS || !(meta.bytes > 0 && meta.bytes <= MAX_BYTES)) throw new Error('Некорректный размер снимка');
  const texts = [];
  for (let index = 0; index < meta.parts; index++) {
    const part = await read(root.collection('parts').doc(String(index)));
    const data = part.exists ? part.data() : null;
    if (data?.index !== index || typeof data.text !== 'string' || new TextEncoder().encode(data.text).length > PART_SIZE) throw new Error('Часть снимка недоступна или повреждена');
    texts.push(data.text);
  }
  const text = texts.join('');
  if (new TextEncoder().encode(text).length !== meta.bytes) throw new Error('Размер снимка не совпадает с опубликованным');
  const checked = await validateReviewSnapshot(JSON.parse(text));
  if (checked.snapshot.digest !== meta.digest || checked.snapshot.id !== meta.snapshotId) throw new Error('Снимок не соответствует ссылке');
  return { ...checked, metadata: meta };
}

export async function revokeSharedReview(share, backend) {
  if (backend?.provider !== 'firebase' || backend.uid !== share.ownerUid) throw new Error('Отозвать ссылку может её владелец');
  await ref(backend.db, share.id).update({ revoked: true });
}

export async function sendSharedReviewResponse(db, shareId, response, user, { now = Date.now() } = {}) {
  if (!user?.uid) throw new Error('Для отправки по ссылке войдите через Google или скачайте ответ файлом');
  const root = ref(db, shareId), doc = await read(root), meta = doc.exists ? doc.data() : null;
  if (!meta || !meta.ready || meta.revoked || !Number.isFinite(millis(meta.expiresAt)) || millis(meta.expiresAt) <= now || meta.digest !== response.digest || meta.snapshotId !== response.snapshotId) throw new Error('Снимок отозван, устарел или не соответствует ответу');
  await root.collection('responses').doc(response.id).set({ response, authorUid: user.uid, receivedAt: db.serverTimestamp?.() || new Date(now) });
}

export async function sharedReviewResponses(share, backend) {
  if (backend?.provider !== 'firebase' || backend.uid !== share.ownerUid) throw new Error('Ответы доступны только владельцу ссылки');
  const docs = await ref(backend.db, share.id).collection('responses').orderBy('receivedAt').get();
  return docs.docs.map((doc) => doc.data());
}
