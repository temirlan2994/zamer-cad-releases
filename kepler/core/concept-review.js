import { deserializeProject, serializeProject, makeId } from './model.js';
import { cleanText, ensureConcept, normalizeConcept } from './concept-data.js';

export function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((entry) => canonicalJson(entry) ?? 'null').join(',')}]`;
  return `{${Object.keys(value).filter((key) => value[key] !== undefined).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
}

export async function sha256(value) {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value;
  return [...new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes))].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function reviewContent(project) {
  const raw = JSON.parse(serializeProject(project, { pretty: false }));
  delete raw.variants; delete raw.revision; delete raw.fileHistoryId; delete raw.activeLevel;
  const concept = normalizeConcept(raw.concept);
  raw.concept = { version: 1, budget: concept.budget, construction: concept.construction, regulations: concept.regulations };
  return { project: raw, variantId: project.concept?.activeVariantId || null };
}

export async function designDigest(project) {
  return sha256(canonicalJson(reviewContent(project)));
}

export async function createReviewSnapshot(project, { now = new Date().toISOString() } = {}) {
  const content = reviewContent(project);
  return { schema: 'kepler-review/1', id: makeId('review'), digest: await sha256(canonicalJson(content)), createdAt: now,
    name: cleanText(content.project.name, 200), variantName: cleanText(project.variants?.find((variant) => variant.id === content.variantId)?.name || 'Текущий дом', 120), ...content };
}

export async function validateReviewSnapshot(raw) {
  if (raw?.schema !== 'kepler-review/1' || !/^review[a-z0-9_-]+$/i.test(raw.id || '') || !/^[a-f0-9]{64}$/.test(raw.digest || '')) throw new Error('Неизвестный формат снимка');
  const content = { project: raw.project, variantId: raw.variantId ?? null };
  if (await sha256(canonicalJson(content)) !== raw.digest) throw new Error('Содержимое снимка изменено: контрольная сумма не совпадает');
  return { snapshot: structuredClone(raw), project: deserializeProject(JSON.stringify(raw.project)) };
}

export function rememberReviewSnapshot(project, snapshot) {
  const concept = ensureConcept(project);
  const snapshots = Array.isArray(concept.reviewSnapshots) ? concept.reviewSnapshots : [];
  if (!snapshots.some((entry) => entry.id === snapshot.id)) snapshots.push(structuredClone(snapshot));
  const known = new Map((concept.reviewSnapshotRefs || []).map((entry) => [entry.id, entry]));
  for (const entry of snapshots) known.set(entry.id, { id: entry.id, digest: entry.digest, createdAt: entry.createdAt, name: entry.name, variantName: entry.variantName });
  concept.reviewSnapshotRefs = [...known.values()].slice(-500);
  concept.reviewSnapshots = snapshots.slice(-10);
}

export function makeReviewResponse(snapshot, { author, action = 'comment', message = '', point = null, target = null, now = new Date().toISOString() } = {}) {
  const name = cleanText(author, 120), text = cleanText(message, 4000);
  if (typeof now !== 'string' || now.length > 40 || !Number.isFinite(Date.parse(now))) throw new Error('Некорректная дата ответа');
  if (!name) throw new Error('Укажите имя участника');
  if (!['comment', 'approve', 'revise'].includes(action)) throw new Error('Неизвестный тип решения');
  if (action !== 'approve' && !text) throw new Error('Введите замечание');
  const location = point && [point.x, point.y, point.z].every((value) => Number.isFinite(value) && Math.abs(value) < 1e9) ? { x: point.x, y: point.y, z: point.z } : null;
  return { schema: 'kepler-review-response/1', id: makeId('response'), snapshotId: snapshot.id, digest: snapshot.digest,
    author: name, action, message: text, createdAt: now, point: location,
    target: target && typeof target.id === 'string' ? { id: cleanText(target.id, 200), type: cleanText(target.type, 40), levelId: cleanText(target.levelId, 100) } : null };
}

export function importReviewResponse(project, raw, { receivedAt = new Date().toISOString(), authenticatedUid = null } = {}) {
  if (raw?.schema !== 'kepler-review-response/1' || !/^response[a-z0-9_-]+$/i.test(raw.id || '') || !/^[a-f0-9]{64}$/.test(raw.digest || '')) throw new Error('Неизвестный формат ответа');
  const concept = ensureConcept(project), snapshot = [...(concept.reviewSnapshots || []), ...(concept.reviewSnapshotRefs || [])].find((entry) => entry.id === raw.snapshotId && entry.digest === raw.digest);
  if (!snapshot) throw new Error('Ответ относится к неизвестному снимку. Откройте исходный проект согласования.');
  const checked = makeReviewResponse(snapshot, { author: raw.author, action: raw.action, message: raw.message, point: raw.point, target: raw.target, now: raw.createdAt });
  Object.assign(checked, { id: raw.id, receivedAt, authenticatedUid, identity: authenticatedUid ? 'authenticated' : 'declared' });
  const existing = concept.decisions.find((entry) => entry.id === checked.id);
  if (existing) {
    for (const key of ['snapshotId', 'digest', 'author', 'action', 'message', 'createdAt', 'point', 'target']) {
      if (canonicalJson(existing[key]) !== canonicalJson(checked[key])) throw new Error('Идентификатор ответа уже использован другим содержимым');
    }
    return false;
  }
  concept.decisions.push(checked);
  return true;
}

export function reviewApproval(project, digest) {
  const decisions = (project.concept?.decisions || []).filter((entry) => entry.digest === digest);
  const decision = [...decisions].reverse().find((entry) => ['approve', 'revise'].includes(entry.action));
  return { status: decision?.action === 'approve' ? 'approved' : decision?.action === 'revise' ? 'revision' : 'pending', decision: decision || null,
    comments: decisions.filter((entry) => entry.action === 'comment'),
    stale: (project.concept?.decisions || []).some((entry) => entry.action === 'approve' && entry.digest !== digest) };
}

// Сводка отличий от переданного снимка, без навигационного состояния.
export function reviewChanges(project, snapshot) {
  const current = reviewContent(project), previous = snapshot.project;
  const sections = [
    ['levels','Этажи, планировка, проёмы и мебель'], ['building','Положение дома'], ['site','Участок'],
    ['envelope','Основание и оболочка'], ['masses','Фасадные массы'], ['massVoids','Вырезы масс'],
    ['roofs','Кровли'], ['settings','Параметры проекта'], ['layoutBrief','Задание и связи'],
    ['views','Виды'], ['sheets','Листы'], ['grids','Оси'],
  ];
  const changes = sections.filter(([key]) => canonicalJson(current.project[key]) !== canonicalJson(previous[key])).map(([,title]) => title);
  for (const [key,title] of [['budget','Бюджет'],['construction','Конструктивные решения'],['regulations','Региональные правила']]) {
    if (canonicalJson(current.project.concept?.[key]) !== canonicalJson(previous.concept?.[key])) changes.push(title);
  }
  if (current.variantId !== (snapshot.variantId || null)) changes.push('Выбранный вариант дома');
  return changes;
}
