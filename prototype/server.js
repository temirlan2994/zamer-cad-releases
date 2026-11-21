const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { DEFAULT_LINE_LAYER, normalizeLineLayerSettings } = require("./core/line-layers.js");
const { normalizeReusableBlocks } = require("./core/reusable-blocks.js");
const { normalizeNumericStep } = require("./core/numeric-stepper.js");

const root = __dirname;
// Development serves the same files that the Docker image embeds under core/.
const sharedCad = path.resolve(root, "../shared/cad");
const sharedCadFiles = new Set(["core/geometry.js", "core/blocks.js", "core/dimensions.js", "core/dxf-writer.js"]);
const useSharedCadSources = fs.existsSync(sharedCad);
const sharedZip = path.resolve(root, "../kepler/core/zip.js");
const useSharedZip = fs.existsSync(sharedZip);
const dataRoot = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : root;
const port = process.env.PORT || 4187;
const host = process.env.HOST || "127.0.0.1";
const projectStatePath = path.join(dataRoot, "project-state.json");
const projectStatesDir = path.join(dataRoot, "project-states");
const projectVersionsDir = path.join(dataRoot, "project-versions");
const projectTrashDir = path.join(dataRoot, "project-trash");
const usersPath = path.join(projectStatesDir, "auth-users.json");
const sessionsPath = path.join(projectStatesDir, "auth-sessions.json");
const maxProjectBytes = 2 * 1024 * 1024;
const maxServerVersions = 50;
const sessionCookieName = "zamer_session";
const sessionMaxAgeSeconds = 60 * 60 * 24 * 30;
const passwordIterations = 120000;
const secureCookieSuffix = process.env.NODE_ENV === "production" ? "; Secure" : "";

const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
};

const server = http.createServer((request, response) => {
  const url = new URL(request.url, `http://${host}:${port}`);

  if (url.pathname.startsWith("/api/")) {
    applyApiCors(request, response);
    if (request.method === "OPTIONS") {
      response.writeHead(204);
      response.end();
      return;
    }
  }

  if (url.pathname === "/api/health") {
    handleHealthApi(response);
    return;
  }

  if (url.pathname === "/api/auth" || url.pathname.startsWith("/api/auth/")) {
    handleAuthApi(request, response, url);
    return;
  }

  if (url.pathname === "/api/projects" || url.pathname.startsWith("/api/projects/")) {
    handleProjectsApi(request, response, url);
    return;
  }

  if (url.pathname === "/api/project") {
    handleProjectApi(request, response, url);
    return;
  }

  let decodedPath;
  try {
    decodedPath = decodeURIComponent(url.pathname);
  } catch {
    decodedPath = url.pathname;
  }
  const safePath = url.pathname === "/" ? "/index.html" : decodedPath;
  const filePath = path.normalize(path.join(root, safePath));

  // Containment check via path.relative: a child resolves to a relative path
  // that neither escapes with ".." nor is absolute. startsWith(root) was unsafe
  // because it also matches sibling directories like "<root>-secret".
  const relative = path.relative(root, filePath);
  if (relative !== "" && (relative.startsWith("..") || path.isAbsolute(relative))) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  const modulePath = relative.split(path.sep).join("/");
  let sourcePath = filePath;
  if (useSharedCadSources && sharedCadFiles.has(modulePath)) sourcePath = path.join(sharedCad, path.basename(filePath));
  if (useSharedZip && modulePath === "core/zip.js") sourcePath = sharedZip;

  fs.readFile(sourcePath, (error, content) => {
    if (error) {
      response.writeHead(404);
      response.end("Not found");
      return;
    }
    response.writeHead(200, {
      "Content-Type": types[path.extname(filePath)] || "application/octet-stream",
      "Cache-Control": "no-store",
    });
    response.end(content);
  });
});

function applyApiCors(request, response) {
  const origin = request.headers.origin;
  const hostname = (() => {
    try {
      return new URL(origin || "http://localhost").hostname;
    } catch {
      return "";
    }
  })();
  if (origin === "null" || /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/i.test(origin || "") || /\.trycloudflare\.com$/i.test(hostname)) {
    response.setHeader("Access-Control-Allow-Origin", origin);
    response.setHeader("Access-Control-Allow-Credentials", "true");
    response.setHeader("Vary", "Origin");
  }
  response.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function sendJson(response, status, payload, extraHeaders = {}) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...extraHeaders,
  });
  response.end(JSON.stringify(payload));
}

function handleHealthApi(response) {
  try {
    fs.mkdirSync(projectStatesDir, { recursive: true });
    fs.accessSync(projectStatesDir, fs.constants.R_OK | fs.constants.W_OK);
    sendJson(response, 200, { ok: true, storage: "ready", time: new Date().toISOString() });
  } catch {
    sendJson(response, 503, { ok: false, storage: "unavailable" });
  }
}

function readRequestJson(request, response, callback) {
  let body = "";
  request.setEncoding("utf8");
  request.on("data", (chunk) => {
    body += chunk;
    if (Buffer.byteLength(body, "utf8") > maxProjectBytes) {
      response.writeHead(413, { "Content-Type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ ok: false, error: "Project is too large" }));
      request.destroy();
    }
  });
  request.on("end", () => {
    try {
      callback(JSON.parse(body || "{}"));
    } catch {
      sendJson(response, 400, { ok: false, error: "Invalid JSON" });
    }
  });
}

function readJsonFileSync(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJsonFileSyncAtomic(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${Date.now()}-${process.pid}-${Math.random().toString(36).slice(2, 10)}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(payload, null, 2), "utf8");
  fs.renameSync(tempPath, filePath);
}

function normalizeLogin(login) {
  return String(login || "").trim().toLowerCase();
}

function validLogin(login) {
  return /^[\p{L}\p{N}._@+-]{3,80}$/u.test(login);
}

function validPassword(password) {
  return typeof password === "string" && password.length >= 6 && password.length <= 128;
}

function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    login: user.login,
    createdAt: user.createdAt,
  };
}

function readUsers() {
  const payload = readJsonFileSync(usersPath, { users: [] });
  return Array.isArray(payload.users) ? payload.users : [];
}

function writeUsers(users) {
  writeJsonFileSyncAtomic(usersPath, { users });
}

function readSessions() {
  const payload = readJsonFileSync(sessionsPath, { sessions: [] });
  return Array.isArray(payload.sessions) ? payload.sessions : [];
}

function writeSessions(sessions) {
  writeJsonFileSyncAtomic(sessionsPath, { sessions });
}

function passwordHash(password, salt = crypto.randomBytes(16).toString("base64")) {
  const hash = crypto.pbkdf2Sync(password, salt, passwordIterations, 32, "sha256").toString("base64");
  return { salt, hash, iterations: passwordIterations };
}

function passwordMatches(password, user) {
  if (!validPassword(password) || !user?.passwordHash || !user?.salt) return false;
  const iterations = Number(user.iterations) || passwordIterations;
  const candidate = crypto.pbkdf2Sync(password, user.salt, iterations, 32, "sha256");
  const saved = Buffer.from(user.passwordHash, "base64");
  return saved.length === candidate.length && crypto.timingSafeEqual(saved, candidate);
}

function parseCookies(header = "") {
  const cookies = {};
  for (const part of String(header).split(";")) {
    const index = part.indexOf("=");
    if (index <= 0) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    cookies[key] = decodeURIComponent(value);
  }
  return cookies;
}

function sessionCookie(sessionId, maxAge = sessionMaxAgeSeconds) {
  return `${sessionCookieName}=${encodeURIComponent(sessionId)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secureCookieSuffix}`;
}

function clearSessionCookie() {
  return `${sessionCookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secureCookieSuffix}`;
}

function createSession(userId) {
  const sessions = readSessions().filter(
    (session) => Date.parse(session.expiresAt || "") > Date.now() && session.userId !== userId,
  );
  const now = Date.now();
  const session = {
    id: crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(24).toString("hex"),
    userId,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + sessionMaxAgeSeconds * 1000).toISOString(),
  };
  sessions.push(session);
  writeSessions(sessions);
  return session;
}

function developerUser() {
  const login = "developer";
  const users = readUsers();
  let user = users.find((item) => item.login === login);
  if (user) return user;
  const { salt, hash, iterations } = passwordHash("developer123");
  const now = new Date().toISOString();
  user = {
    id: "developer",
    login,
    salt,
    passwordHash: hash,
    iterations,
    createdAt: now,
    updatedAt: now,
  };
  users.push(user);
  writeUsers(users);
  return user;
}

function currentAuth(request) {
  const sessionId = parseCookies(request.headers.cookie || "")[sessionCookieName];
  if (!/^[a-zA-Z0-9_-]{16,80}$/.test(sessionId || "")) return null;
  const sessions = readSessions();
  const session = sessions.find((item) => item.id === sessionId);
  if (!session || Date.parse(session.expiresAt || "") <= Date.now()) {
    if (session) writeSessions(sessions.filter((item) => item.id !== sessionId));
    return null;
  }
  const user = readUsers().find((item) => item.id === session.userId);
  if (!user) return null;
  return { session, user };
}

function removeSession(sessionId) {
  if (!sessionId) return;
  writeSessions(readSessions().filter((session) => session.id !== sessionId));
}

function sendAuthRequired(response) {
  sendJson(response, 401, { ok: false, error: "Auth required" });
}

function handleAuthApi(request, response, url) {
  if (url.pathname === "/api/auth/status" && request.method === "GET") {
    const auth = currentAuth(request);
    sendJson(response, 200, { ok: true, user: publicUser(auth?.user) });
    return;
  }

  if (url.pathname === "/api/auth/logout" && request.method === "POST") {
    const sessionId = parseCookies(request.headers.cookie || "")[sessionCookieName];
    removeSession(sessionId);
    sendJson(response, 200, { ok: true, user: null }, { "Set-Cookie": clearSessionCookie() });
    return;
  }


  if (url.pathname === "/api/auth/dev" && request.method === "POST") {
    const user = developerUser();
    const session = createSession(user.id);
    sendJson(response, 200, { ok: true, user: publicUser(user), developer: true }, { "Set-Cookie": sessionCookie(session.id) });
    return;
  }

  if ((url.pathname === "/api/auth/login" || url.pathname === "/api/auth/register") && request.method === "POST") {
    readRequestJson(request, response, (body) => {
      const login = normalizeLogin(body.login);
      const password = String(body.password || "");
      if (!validLogin(login)) {
        sendJson(response, 400, { ok: false, error: "Логин: минимум 3 символа, буквы/цифры/._@+-" });
        return;
      }
      if (!validPassword(password)) {
        sendJson(response, 400, { ok: false, error: "Пароль должен быть от 6 символов" });
        return;
      }

      const users = readUsers();
      const existing = users.find((user) => user.login === login);
      if (url.pathname === "/api/auth/register") {
        if (existing) {
          sendJson(response, 409, { ok: false, error: "Такой логин уже есть" });
          return;
        }
        const { salt, hash, iterations } = passwordHash(password);
        const now = new Date().toISOString();
        const user = {
          id: `u-${crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(12).toString("hex")}`.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 80),
          login,
          salt,
          passwordHash: hash,
          iterations,
          createdAt: now,
          updatedAt: now,
        };
        users.push(user);
        writeUsers(users);
        const session = createSession(user.id);
        sendJson(response, 200, { ok: true, user: publicUser(user) }, { "Set-Cookie": sessionCookie(session.id) });
        return;
      }

      if (!existing || !passwordMatches(password, existing)) {
        sendJson(response, 401, { ok: false, error: "Неверный логин или пароль" });
        return;
      }
      const session = createSession(existing.id);
      sendJson(response, 200, { ok: true, user: publicUser(existing) }, { "Set-Cookie": sessionCookie(session.id) });
    });
    return;
  }

  response.writeHead(405, { Allow: "GET, POST" });
  response.end("Method not allowed");
}

function clientProjectPaths(url) {
  const rawClient = url.searchParams.get("client") || "default";
  const client = /^[a-zA-Z0-9_-]{8,80}$/.test(rawClient) ? rawClient : "default";
  return {
    client,
    statePath: path.join(projectStatesDir, `project-${client}.json`),
  };
}

function uniqueProjectTempPath(client) {
  const nonce = `${Date.now()}-${process.pid}-${Math.random().toString(36).slice(2, 10)}`;
  return path.join(projectStatesDir, `project-${client}.${nonce}.tmp.json`);
}

function safeId(value, fallback = "default") {
  return /^[a-zA-Z0-9_-]{3,80}$/.test(value || "") ? value : fallback;
}

const clientMutationQueues = new Map();

function enqueueClientMutation(client, task) {
  const previous = clientMutationQueues.get(client) || Promise.resolve();
  const queued = previous.catch(() => {}).then(task);
  clientMutationQueues.set(client, queued);
  const cleanup = () => {
    if (clientMutationQueues.get(client) === queued) clientMutationQueues.delete(client);
  };
  queued.then(cleanup, cleanup);
  return queued;
}

function runClientMutation(client, response, task) {
  enqueueClientMutation(client, task).catch((error) => {
    console.error("Project mutation failed", error);
    if (!response.headersSent) sendJson(response, 500, { ok: false, error: "Could not safely update project" });
  });
}

function projectRevisionValue(project) {
  const value = Number(project?.revision);
  return Number.isFinite(value) && value >= 1 ? Math.floor(value) : 1;
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (!value || typeof value !== "object") return JSON.stringify(value);
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
}

function projectContentHash(project) {
  const content = { ...(project || {}) };
  for (const key of [
    "baseRevision",
    "clientId",
    "clientSaveId",
    "clientSavedAt",
    "localSavedAt",
    "revision",
    "savedAt",
    "serverSavedAt",
    "storageId",
    "syncPending",
    "updatedAt",
  ]) delete content[key];
  return crypto.createHash("sha256").update(stableJson(content)).digest("hex");
}

function readProjectsIndexSync(client) {
  const payload = readJsonFileSync(projectsIndexPath(client), { projects: [] });
  return Array.isArray(payload.projects) ? payload.projects : [];
}

function writeProjectsIndexSync(client, projects) {
  writeJsonFileSyncAtomic(projectsIndexPath(client), { client, projects });
}

function upsertProjectMetaSync(client, meta) {
  const projects = readProjectsIndexSync(client);
  const next = projects.filter((project) => project.id !== meta.id);
  next.unshift(meta);
  next.sort((a, b) => Date.parse(b.updatedAt || "") - Date.parse(a.updatedAt || ""));
  writeProjectsIndexSync(client, next);
}

function removeProjectMetaSync(client, projectId) {
  writeProjectsIndexSync(client, readProjectsIndexSync(client).filter((project) => project.id !== projectId));
}

function archiveProjectVersionSync(client, projectId, project, reason = "save") {
  if (!project || typeof project !== "object") return;
  const directory = path.join(projectVersionsDir, client, projectId);
  fs.mkdirSync(directory, { recursive: true });
  const revision = String(projectRevisionValue(project)).padStart(8, "0");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const archivePath = path.join(directory, `${revision}-${stamp}-${safeId(reason, "save")}.json`);
  writeJsonFileSyncAtomic(archivePath, { archivedAt: new Date().toISOString(), reason, project });

  const versions = fs.readdirSync(directory)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .reverse();
  for (const name of versions.slice(maxServerVersions)) {
    fs.unlinkSync(path.join(directory, name));
  }
}

function recoveryProjectForConflict(client, originalProjectId, incomingProject) {
  const saveId = safeId(incomingProject.clientSaveId, `save-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  const recoveryId = safeId(`recovery-${saveId}`.slice(0, 80), `recovery-${Date.now()}`);
  const recoveryPath = projectFilePath(client, recoveryId);
  const existing = readJsonFileSync(recoveryPath, null);
  if (existing) return existing;

  const now = new Date().toISOString();
  const originalName = String(incomingProject.name || "Без названия").slice(0, 52);
  const recovery = {
    ...incomingProject,
    clientId: client,
    projectId: recoveryId,
    name: `${originalName} - восстановленная копия`.slice(0, 80),
    createdAt: now,
    updatedAt: now,
    savedAt: now,
    serverSavedAt: now,
    revision: 1,
    baseRevision: 1,
    syncPending: false,
    recoveredFrom: originalProjectId,
  };
  writeJsonFileSyncAtomic(recoveryPath, recovery);
  upsertProjectMetaSync(client, projectSummary(recovery, { id: recoveryId }));
  return recovery;
}

function clientFromUrl(url) {
  return safeId(url.searchParams.get("client"), "default");
}

function projectsIndexPath(client) {
  return path.join(projectStatesDir, `projects-${client}.json`);
}

function projectFilePath(client, projectId) {
  if (projectId === "legacy") return path.join(projectStatesDir, `project-${client}.json`);
  return path.join(projectStatesDir, `project-${client}-${projectId}.json`);
}

function uniqueProjectFileTempPath(client, projectId) {
  const nonce = `${Date.now()}-${process.pid}-${Math.random().toString(36).slice(2, 10)}`;
  return path.join(projectStatesDir, `project-${client}-${projectId}.${nonce}.tmp.json`);
}

function projectSummary(project, fallback = {}) {
  const entities = Array.isArray(project?.entities) ? project.entities : [];
  return {
    id: fallback.id || safeId(project?.projectId, ""),
    name: String(project?.name || fallback.name || "Без названия").slice(0, 80),
    site: String(project?.survey?.site || "").slice(0, 150),
    visitDate: String(project?.survey?.visitDate || "").slice(0, 10),
    createdAt: project?.createdAt || fallback.createdAt || new Date().toISOString(),
    updatedAt: project?.savedAt || project?.updatedAt || fallback.updatedAt || new Date().toISOString(),
    revision: projectRevisionValue(project),
    entityCount: entities.length,
    thumbnail: project?.thumbnail || fallback.thumbnail || null,
    legacy: Boolean(fallback.legacy),
  };
}

function readJsonFile(filePath, fallback, callback) {
  fs.readFile(filePath, "utf8", (error, content) => {
    if (error) {
      callback(null, fallback);
      return;
    }
    try {
      callback(null, JSON.parse(content));
    } catch (parseError) {
      callback(parseError, fallback);
    }
  });
}

function writeJsonFileAtomic(filePath, payload, tempPath, callback) {
  const content = JSON.stringify(payload, null, 2);
  fs.mkdir(path.dirname(filePath), { recursive: true }, (mkdirError) => {
    if (mkdirError) {
      callback(mkdirError);
      return;
    }
    fs.writeFile(tempPath, content, "utf8", (writeError) => {
      if (writeError) {
        callback(writeError);
        return;
      }
      fs.rename(tempPath, filePath, (renameError) => {
        if (renameError) fs.unlink(tempPath, () => {});
        callback(renameError);
      });
    });
  });
}

function readProjectsIndex(client, callback) {
  readJsonFile(projectsIndexPath(client), { projects: [] }, (error, payload) => {
    const projects = Array.isArray(payload?.projects) ? payload.projects : [];
    callback(error, projects);
  });
}

function writeProjectsIndex(client, projects, callback) {
  const tempPath = path.join(projectStatesDir, `projects-${client}.${Date.now()}-${Math.random().toString(36).slice(2)}.tmp.json`);
  writeJsonFileAtomic(projectsIndexPath(client), { client, projects }, tempPath, callback);
}

function upsertProjectMeta(client, meta, callback) {
  readProjectsIndex(client, (_error, projects) => {
    const next = projects.filter((project) => project.id !== meta.id);
    next.unshift(meta);
    next.sort((a, b) => Date.parse(b.updatedAt || "") - Date.parse(a.updatedAt || ""));
    writeProjectsIndex(client, next, callback);
  });
}

function removeProjectMeta(client, projectId, callback) {
  readProjectsIndex(client, (_error, projects) => {
    writeProjectsIndex(client, projects.filter((project) => project.id !== projectId), callback);
  });
}

function sendProjectsList(response, client) {
  readProjectsIndex(client, (_error, projects) => {
    const sorted = [...projects].sort((a, b) => Date.parse(b.updatedAt || "") - Date.parse(a.updatedAt || ""));
    const legacyPath = projectFilePath(client, "legacy");
    fs.readFile(legacyPath, "utf8", (legacyError, legacyContent) => {
      if (!legacyError && !sorted.some((project) => project.id === "legacy")) {
        try {
          const legacyProject = JSON.parse(legacyContent);
          sorted.unshift(projectSummary(legacyProject, { id: "legacy", name: "Последний замер", legacy: true }));
        } catch {
          // Ignore a broken legacy file in the project picker.
        }
      }
      sendJson(response, 200, { ok: true, client, projects: sorted });
    });
  });
}

function defaultProjectPayload(client, body = {}) {
  const now = new Date().toISOString();
  const id = safeId(body.id, `p-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  const name = String(body.name || "Новый замер").slice(0, 80);
  const source = body.project && typeof body.project === "object" ? body.project : {};
  const lineLayers = normalizeLineLayerSettings(source);
  const entities = Array.isArray(source.entities) ? source.entities : [];
  const rooms = Array.isArray(source.survey?.rooms) ? source.survey.rooms : [];
  const legacyLayers = ["walls", "furniture"].filter((layer) => entities.some((entity) => entity?.layer === layer) ||
    rooms.some((room) => Array.isArray(room?.drawing?.entities) && room.drawing.entities.some((entity) => entity?.layer === layer)));
  return {
    version: 2,
    clientId: client,
    projectId: id,
    name,
    createdAt: source.createdAt || now,
    updatedAt: now,
    savedAt: now,
    serverSavedAt: now,
    revision: 1,
    baseRevision: 1,
    syncPending: false,
    theme: source.theme === "dark" ? "dark" : "light",
    view: source.view || { scale: 0.085, panX: 92, panY: 84 },
    snaps: Array.isArray(source.snaps) ? source.snaps : ["grid", "end", "polar"],
    gridStep: [5, 10, 50, 100, 500, 1000].includes(source.gridStep) ? source.gridStep : 100,
    polarStep: [5, 10, 15, 30, 45, 90].includes(source.polarStep) ? source.polarStep : 5,
    numericStep: normalizeNumericStep(source.numericStep),
    visibleLayers: Array.isArray(source.visibleLayers) ? source.visibleLayers :
      [DEFAULT_LINE_LAYER, "dimensions", "text", "areas", "elevations", ...legacyLayers, ...lineLayers.customLineLayers.map(({ id }) => id)],
    ...lineLayers,
    annotationLayers: source.annotationLayers === 1 ? 1 : undefined,
    annotationScale: Number.isFinite(source.annotationScale) ? source.annotationScale : 1,
    measurementSettings: source.measurementSettings,
    selectionFilter: source.selectionFilter || "all",
    furnitureTab: source.furnitureTab || "furniture",
    furnitureCategory: source.furnitureCategory || "sofas",
    furnitureSheetPosition: source.furnitureSheetPosition || "half",
    survey: source.survey,
    draft: source.draft,
    reusableBlocks: normalizeReusableBlocks(source.reusableBlocks),
    entities,
    thumbnail: source.thumbnail || null,
  };
}

function handleProjectsApi(request, response, url) {
  const auth = currentAuth(request);
  if (!auth) {
    sendAuthRequired(response);
    return;
  }
  const client = auth.user.id;
  const match = url.pathname.match(/^\/api\/projects\/([^/]+)$/);
  const projectId = match ? safeId(decodeURIComponent(match[1]), "") : "";

  if (url.pathname === "/api/projects" && request.method === "GET") {
    sendProjectsList(response, client);
    return;
  }

  if (url.pathname === "/api/projects" && request.method === "POST") {
    readRequestJson(request, response, (body) => {
      runClientMutation(client, response, () => {
        const project = defaultProjectPayload(client, body);
        const filePath = projectFilePath(client, project.projectId);
        writeJsonFileSyncAtomic(filePath, project);
        const meta = projectSummary(project, { id: project.projectId });
        upsertProjectMetaSync(client, meta);
        sendJson(response, 200, { ok: true, client, project, meta });
      });
    });
    return;
  }

  if (!projectId) {
    sendJson(response, 404, { ok: false, error: "Project not found" });
    return;
  }

  const filePath = projectFilePath(client, projectId);

  if (request.method === "GET") {
    readJsonFile(filePath, null, (error, project) => {
      if (error || !project) {
        sendJson(response, 404, { ok: false, error: "Project not found", client, projectId });
        return;
      }
      sendJson(response, 200, { ok: true, client, projectId, project });
    });
    return;
  }

  if (request.method === "PUT" || request.method === "POST") {
    readRequestJson(request, response, (body) => {
      runClientMutation(client, response, () => {
        const current = readJsonFileSync(filePath, null);
        if (!current) {
          sendJson(response, 404, { ok: false, error: "Project not found", client, projectId });
          return;
        }

        const currentRevision = projectRevisionValue(current);
        const requestedRevision = Number(body.baseRevision ?? body.revision ?? currentRevision);
        const baseRevision = Number.isFinite(requestedRevision) ? Math.floor(requestedRevision) : currentRevision;
        if (baseRevision !== currentRevision) {
          if (projectContentHash(body) === projectContentHash(current)) {
            sendJson(response, 200, {
              ok: true,
              client,
              projectId,
              revision: currentRevision,
              savedAt: current.savedAt,
              deduplicated: true,
              meta: projectSummary(current, { id: projectId }),
            });
            return;
          }
          const recoveryProject = recoveryProjectForConflict(client, projectId, body);
          sendJson(response, 409, {
            ok: false,
            code: "revision_conflict",
            error: "A newer project revision already exists",
            currentRevision,
            recoveryProject,
            recoveryMeta: projectSummary(recoveryProject, { id: recoveryProject.projectId }),
          });
          return;
        }

        const now = new Date().toISOString();
        const serverDocument = { ...body };
        delete serverDocument.localSavedAt;
        delete serverDocument.storageId;
        const project = {
          ...serverDocument,
          version: body.version || 2,
          clientId: client,
          projectId,
          name: String(body.name || "Без названия").slice(0, 80),
          createdAt: body.createdAt || current.createdAt || now,
          clientSavedAt: body.savedAt || body.clientSavedAt || now,
          updatedAt: now,
          savedAt: now,
          serverSavedAt: now,
          revision: currentRevision + 1,
          baseRevision: currentRevision + 1,
          syncPending: false,
        };
        archiveProjectVersionSync(client, projectId, current, "save");
        writeJsonFileSyncAtomic(filePath, project);
        const meta = projectSummary(project, { id: projectId });
        upsertProjectMetaSync(client, meta);
        sendJson(response, 200, {
          ok: true,
          client,
          projectId,
          revision: project.revision,
          savedAt: project.savedAt,
          meta,
        });
      });
    });
    return;
  }

  if (request.method === "DELETE") {
    if (projectId === "legacy") {
      sendJson(response, 400, { ok: false, error: "Legacy project cannot be deleted here" });
      return;
    }
    runClientMutation(client, response, () => {
      const project = readJsonFileSync(filePath, null);
      if (project) {
        archiveProjectVersionSync(client, projectId, project, "delete");
        const directory = path.join(projectTrashDir, client);
        fs.mkdirSync(directory, { recursive: true });
        const stamp = new Date().toISOString().replace(/[:.]/g, "-");
        fs.renameSync(filePath, path.join(directory, `${projectId}-${stamp}.json`));
      }
      removeProjectMetaSync(client, projectId);
      sendJson(response, 200, { ok: true, client, projectId, recoverable: Boolean(project) });
    });
    return;
  }

  response.writeHead(405, { Allow: "GET, POST, PUT, DELETE" });
  response.end("Method not allowed");
}

function handleProjectApi(request, response, url) {
  const auth = currentAuth(request);
  if (!auth) {
    sendAuthRequired(response);
    return;
  }
  const paths = {
    client: auth.user.id,
    statePath: path.join(projectStatesDir, `project-${auth.user.id}.json`),
  };
  if (request.method === "GET") {
    fs.readFile(paths.statePath, "utf8", (error, content) => {
      if (error) {
        if (error.code === "ENOENT") {
          if (paths.client !== "default") {
            sendJson(response, 200, { ok: true, project: null, client: paths.client });
            return;
          }
          fs.readFile(projectStatePath, "utf8", (legacyError, legacyContent) => {
            if (legacyError) {
              sendJson(response, 200, { ok: true, project: null, client: paths.client });
              return;
            }
            try {
              sendJson(response, 200, { ok: true, project: JSON.parse(legacyContent), client: paths.client, migratedFromDefault: true });
            } catch {
              sendJson(response, 200, { ok: true, project: null, client: paths.client });
            }
          });
          return;
        }
        sendJson(response, 500, { ok: false, error: "Could not read project" });
        return;
      }

      try {
        sendJson(response, 200, { ok: true, project: JSON.parse(content), client: paths.client });
      } catch {
        sendJson(response, 500, { ok: false, error: "Saved project is corrupted" });
      }
    });
    return;
  }

  if (request.method === "PUT" || request.method === "POST") {
    readRequestJson(request, response, (project) => {
      const content = JSON.stringify(project, null, 2);
      fs.mkdir(projectStatesDir, { recursive: true }, (mkdirError) => {
        if (mkdirError) {
          sendJson(response, 500, { ok: false, error: "Could not prepare project storage" });
          return;
        }
        const tempPath = uniqueProjectTempPath(paths.client);
        fs.writeFile(tempPath, content, "utf8", (writeError) => {
          if (writeError) {
            sendJson(response, 500, { ok: false, error: "Could not write project" });
            return;
          }
          fs.rename(tempPath, paths.statePath, (renameError) => {
            if (renameError) {
              fs.unlink(tempPath, () => {});
              sendJson(response, 500, { ok: false, error: "Could not save project" });
              return;
            }
            sendJson(response, 200, { ok: true, client: paths.client });
          });
        });
      });
    });
    return;
  }

  response.writeHead(405, { Allow: "GET, PUT, POST" });
  response.end("Method not allowed");
}

server.listen(port, host, () => {
  console.log(`Zamer CAD prototype: http://${host}:${port}`);
  if (host === "0.0.0.0") {
    const os = require("os");
    for (const interfaces of Object.values(os.networkInterfaces())) {
      for (const item of interfaces || []) {
        if (item.family === "IPv4" && !item.internal) {
          console.log(`Phone URL: http://${item.address}:${port}`);
        }
      }
    }
  }
});

function shutdown(signal) {
  console.log(`${signal}: finishing active requests`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10000).unref();
}

process.once("SIGTERM", () => shutdown("SIGTERM"));
process.once("SIGINT", () => shutdown("SIGINT"));
