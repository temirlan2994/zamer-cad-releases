import { MAX_ZAMER_FILE_BYTES } from "./project-format.js";

const DRIVE = "https://www.googleapis.com/drive/v3";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3/files";
const PROJECT_KIND = "zamer-cad-v1";
const FILE_FIELDS = "id,name,createdTime,size,appProperties";
const validId = (id) => typeof id === "string" && /^[a-zA-Z0-9_-]{1,80}$/.test(id);

export class GoogleDriveError extends Error {
  constructor(status) {
    super(status === 401 ? "Подтвердите вход через Google"
      : status === 403 ? "Google Диск недоступен. Проверьте разрешение приложения и место в аккаунте."
      : "Не удалось связаться с Google Диском");
    this.status = status;
  }
}

export async function googleAccountForToken(token, fetcher = fetch) {
  const response = await fetcher("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(12000),
  });
  if (!response.ok) throw new GoogleDriveError(response.status);
  const { sub, email, email_verified } = await response.json();
  if (typeof sub !== "string" || !/^\d{1,40}$/.test(sub) || typeof email !== "string" || email_verified !== true) {
    throw new Error("Не удалось подтвердить Google-аккаунт");
  }
  return { id: `google-${sub}`, login: email };
}

function decodeRecord(file) {
  const { id, name, createdTime, size, appProperties } = file;
  if (!validId(id) || appProperties?.kind !== PROJECT_KIND || !validId(appProperties.project)) return null;
  return {
    id, name, createdTime, size: Number(size) || 0, projectId: appProperties.project,
    previous: validId(appProperties.previous) && appProperties.previous !== id ? appProperties.previous : null,
    deleted: appProperties.deleted === "1",
  };
}

export function googleDriveProjects(token, fetcher = fetch) {
  async function request(url, options = {}, accepted = []) {
    const { headers, ...rest } = options;
    const response = await fetcher(url, {
      ...rest, headers: { ...headers, Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(25000),
    });
    if (!response.ok && !accepted.includes(response.status)) throw new GoogleDriveError(response.status);
    return response;
  }

  return {
    async list() {
      const params = new URLSearchParams({
        spaces: "appDataFolder", q: `trashed = false and appProperties has { key='kind' and value='${PROJECT_KIND}' }`,
        fields: `nextPageToken,incompleteSearch,files(${FILE_FIELDS})`, pageSize: "1000",
      });
      const records = [];
      do {
        const page = await (await request(`${DRIVE}/files?${params}`)).json();
        if (page.incompleteSearch || !Array.isArray(page.files)) throw new Error("Google Диск вернул неполный список");
        records.push(...page.files.map(decodeRecord).filter(Boolean));
        if (!page.nextPageToken) break;
        params.set("pageToken", page.nextPageToken);
      } while (true);
      return records;
    },

    async reserve() {
      const result = await (await request(`${DRIVE}/files/generateIds?count=1&space=appDataFolder`)).json();
      const id = result.ids?.[0];
      if (!validId(id)) throw new Error("Не удалось зарезервировать файл в Google Диске");
      return id;
    },

    async write({ id, projectId, previous, deleted, project }) {
      const metadata = {
        id, name: deleted ? `${projectId}.deleted` : `${project.name}.zamer`, parents: ["appDataFolder"],
        mimeType: "application/json", appProperties: {
          kind: PROJECT_KIND, project: projectId, ...(previous ? { previous } : {}), deleted: deleted ? "1" : "0",
        },
      };
      const boundary = `zamer-${crypto.randomUUID()}`;
      const file = new Blob([JSON.stringify(project ?? null)]);
      if (file.size > MAX_ZAMER_FILE_BYTES) throw new Error("Чертёж слишком большой для синхронизации");
      const body = new Blob([
        `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`,
        `--${boundary}\r\nContent-Type: application/json\r\n\r\n`, file, `\r\n--${boundary}--\r\n`,
      ]);
      let response = await request(`${UPLOAD}?uploadType=multipart&fields=${encodeURIComponent(FILE_FIELDS)}`, {
        method: "POST", headers: { "Content-Type": `multipart/related; boundary=${boundary}` }, body,
      }, [409]);
      if (response.status === 409) response = await request(`${DRIVE}/files/${id}?fields=${encodeURIComponent(FILE_FIELDS)}`);
      const record = decodeRecord(await response.json());
      if (!record || record.id !== id || record.projectId !== projectId || record.previous !== previous || record.deleted !== deleted) {
        throw new Error("Google Диск не подтвердил версию чертежа");
      }
      return record;
    },

    async read(record) {
      if (record.size > MAX_ZAMER_FILE_BYTES) throw new Error("Чертёж в Google Диске слишком большой");
      const response = await request(`${DRIVE}/files/${record.id}?alt=media`);
      const file = await response.blob();
      if (file.size > MAX_ZAMER_FILE_BYTES) throw new Error("Чертёж в Google Диске слишком большой");
      return JSON.parse(await file.text());
    },

    async discard(id) {
      await request(`${DRIVE}/files/${id}`, { method: "DELETE" }, [404]);
    },
  };
}

export function driveProjectStamp(project) {
  return project ? `${project.revision}:${project.updatedAt}` : null;
}

function currentVersions(records) {
  const parents = new Set(records.map(({ previous }) => previous).filter(Boolean));
  const groups = new Map();
  for (const record of records) {
    if (parents.has(record.id)) continue;
    if (!groups.has(record.projectId)) groups.set(record.projectId, []);
    groups.get(record.projectId).push(record);
  }
  const files = [];
  for (const [id, versions] of groups) {
    versions.sort((a, b) => String(b.createdTime).localeCompare(String(a.createdTime)) || b.id.localeCompare(a.id));
    files.push({ id, record: versions[0], conflict: false });
    for (const record of versions.slice(1)) {
      const copyId = `cloud-${record.id}`.slice(0, 80);
      if (!record.deleted && !groups.has(copyId)) files.push({ id: copyId, record, conflict: true });
    }
  }
  return files;
}

async function pruneVersions(remote, records) {
  // Remove ancestors first so a failed cleanup cannot expose an old revision as current.
  const superseded = new Set(records.map(({ previous }) => previous).filter(Boolean));
  const known = new Map(records.map((record) => [record.id, record]));
  for (let removed = 0; removed < 12; removed++) {
    const obsolete = [...known.values()].find(({ id, previous }) => superseded.has(id) && !known.has(previous));
    if (!obsolete) return;
    await remote.discard(obsolete.id);
    known.delete(obsolete.id);
  }
}

export async function syncDriveProjects(local, remote) {
  const records = new Map((await remote.list()).map((record) => [record.id, record]));
  const projects = new Map((await local.list()).map((project) => [project.id, project]));
  const ids = new Set([...projects.keys(), ...Object.keys(local.states())]);
  for (const id of ids) {
    if (!local.active()) return;
    const state = local.states()[id] || {};
    const deleted = !projects.has(id) && state.remove;
    const observed = deleted ? "deleted" : driveProjectStamp(projects.get(id));
    if (!observed || (observed === state.stamp && !state.pending)) continue;
    const project = !deleted && projects.has(id) ? await local.load(id) : null;
    const stamp = deleted ? "deleted" : driveProjectStamp(project?.meta);
    if (!stamp || (stamp === state.stamp && !state.pending)) continue;

    const previous = state.groupId === id ? state.fileId ?? null : null;
    const pending = state.pending;
    // A previous attempt may have finished after a network interruption.
    if (pending && records.has(pending.id)) {
      const uploaded = records.get(pending.id);
      await local.writeState(id, { stamp: pending.stamp, fileId: uploaded.id, groupId: id, pending: null });
      if (pending.stamp === stamp) continue;
    }
    const base = pending && records.has(pending.id) ? pending.id : previous;
    const fileId = pending?.stamp === stamp ? pending.id : await remote.reserve();
    await local.writeState(id, { pending: { id: fileId, stamp, previous: base } });
    const record = await remote.write({ id: fileId, projectId: id,
      previous: pending?.stamp === stamp ? pending.previous : base, deleted: Boolean(deleted), project: project?.data });
    records.set(record.id, record);
    await local.writeState(id, { stamp, fileId: record.id, groupId: id, pending: null });
  }

  for (const entry of currentVersions([...records.values()])) {
    if (!local.canReceive()) break;
    const state = local.states()[entry.id] || {};
    if (state.fileId === entry.record.id && (entry.record.deleted || projects.has(entry.id))) continue;
    const project = entry.record.deleted ? null : await remote.read(entry.record);
    await local.receive(entry, project, state);
  }

  if (local.active()) await pruneVersions(remote, [...records.values()]).catch(() => {});
}
