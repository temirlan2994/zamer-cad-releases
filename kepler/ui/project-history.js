import { hashText, getProject, KEEP_VERSIONS, loadVersion, newId, saveVersion } from '../core/storage.js';
import { getLocalBackend } from './cloud.js';

const MAX_FILE_HISTORY_BYTES = 50 * 1024 * 1024;
const encoder = new TextEncoder();

function snapshotData(raw) {
  const { projectHistory: _history, fileHistoryId: _id, ...data } = raw;
  return data;
}

function snapshotHash(text) {
  return hashText(JSON.stringify(snapshotData(JSON.parse(text))));
}

async function archive(scope, key) {
  const local = await getLocalBackend();
  return { ...local, root: `recovery/${hashText(scope)}/projects`, pid: key };
}

const keysFor = ({ pid, fileId }) => [
  ...(pid ? [`project-${hashText(pid)}`] : []),
  ...(fileId ? [`file-${hashText(fileId)}`] : []),
];

export async function preserveProjectVersion(context, text, { compare, note } = {}) {
  const [key] = keysFor(context);
  if (!key || !text || (compare && snapshotHash(text) === snapshotHash(compare))) return false;
  const { db, root, pid, persistent } = await archive(context.scope, key);
  if (!persistent) throw new Error('Браузер не предоставил хранилище истории проекта');
  await saveVersion(db, root, JSON.stringify(snapshotData(JSON.parse(text))), { pid, note });
  return true;
}

export async function recoveryVersions(context) {
  const groups = await Promise.all(keysFor(context).map(async (key) => {
    const { db, root, pid } = await archive(context.scope, key);
    const meta = await getProject(db, root, pid);
    return (meta?.versions || []).map((version) => ({
      ...version, source: key, load: () => loadVersion(db, root, pid, version.id),
    }));
  }));
  const seen = new Set();
  return groups.flat().sort((a, b) => b.at.localeCompare(a.at)).filter(({ hash }) => {
    if (seen.has(hash)) return false;
    seen.add(hash);
    return true;
  });
}

export async function fileWithProjectHistory(text, context, backend) {
  const sources = await Promise.allSettled([
    recoveryVersions(context),
    context.pid && backend ? getProject(backend.db, backend.root, context.pid).then((meta) => (
      (meta?.versions || []).map((version) => ({
        ...version, load: () => loadVersion(backend.db, backend.root, context.pid, version.id),
      }))
    )) : [],
  ]);
  const data = snapshotData(JSON.parse(text));
  const versions = sources.flatMap((result) => result.status === 'fulfilled' ? result.value : [])
    .sort((a, b) => b.at.localeCompare(a.at));
  let partial = sources.some((result) => result.status === 'rejected');
  const seen = new Set();
  const entries = [];
  let remaining = MAX_FILE_HISTORY_BYTES;
  for (const version of versions) {
    try {
      const { text: saved, missing } = await version.load();
      if (missing?.length) { partial = true; continue; }
      const snapshot = snapshotData(JSON.parse(saved));
      const compact = JSON.stringify(snapshot);
      const hash = hashText(compact);
      if (seen.has(hash)) continue;
      const bytes = encoder.encode(compact).length;
      if (entries.length >= KEEP_VERSIONS || bytes > remaining) { partial = true; break; }
      seen.add(hash);
      remaining -= bytes;
      entries.push({ at: version.at, note: version.note || '', snapshot });
    } catch { partial = true; }
  }
  if (entries.length) data.projectHistory = { version: 1, entries };
  return { text: JSON.stringify(data), count: entries.length, partial };
}

export async function importProjectHistory(data, scope) {
  const source = data.projectHistory;
  const project = snapshotData(data);
  if (source?.version !== 1 || !Array.isArray(source.entries) || !source.entries.length) return project;
  const id = newId('fh');
  const { db, root, pid, persistent } = await archive(scope, keysFor({ fileId: id })[0]);
  if (!persistent) throw new Error('Разрешите браузеру сохранить историю этого файла');
  let remaining = MAX_FILE_HISTORY_BYTES;
  const entries = [];
  for (const entry of source.entries.slice(0, KEEP_VERSIONS)) {
    const at = new Date(typeof entry?.at === 'string' ? entry.at : NaN);
    if (!Number.isFinite(at.getTime()) || !Array.isArray(entry?.snapshot?.levels)
      || !/^kepler-plan\/[1-7]$/.test(entry.snapshot.schema)) continue;
    const text = JSON.stringify(snapshotData(entry.snapshot));
    remaining -= encoder.encode(text).length;
    if (remaining < 0) throw new Error('История файла превышает 50 МиБ');
    entries.push({ text, at, note: typeof entry.note === 'string' ? entry.note.slice(0, 160) : '' });
  }
  for (const { text, at, note } of entries.sort((a, b) => a.at - b.at)) {
    await saveVersion(db, root, text, { pid, now: at, note: note || 'Версия из файла' });
  }
  if (entries.length) project.fileHistoryId = id;
  return project;
}
