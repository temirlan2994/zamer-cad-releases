const { test } = require("node:test");
const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");

function availablePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

async function waitForHealth(baseUrl, child) {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    if (child.exitCode != null) throw new Error(`Test server exited with ${child.exitCode}`);
    try {
      const response = await fetch(`${baseUrl}/api/health`, { cache: "no-store" });
      if (response.ok) return;
    } catch {
      // The child may still be binding the port.
    }
    await new Promise((resolve) => setTimeout(resolve, 60));
  }
  throw new Error("Timed out waiting for test server");
}

function startServer(port, dataDir) {
  return childProcess.spawn(process.execPath, [path.join(__dirname, "server.js")], {
    cwd: __dirname,
    env: { ...process.env, HOST: "127.0.0.1", PORT: String(port), DATA_DIR: dataDir },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
}

function stopServer(child) {
  return new Promise((resolve) => {
    if (!child || child.exitCode != null) {
      resolve();
      return;
    }
    child.once("exit", resolve);
    child.kill();
    setTimeout(() => {
      if (child.exitCode == null) child.kill("SIGKILL");
    }, 1500).unref();
  });
}

function sessionCookie(response) {
  const value = response.headers.get("set-cookie") || "";
  return value.split(";")[0];
}

async function jsonRequest(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {}),
    },
  });
  const payload = await response.json().catch(() => ({}));
  return { response, payload };
}

test("server keeps project revisions safe across conflicts and restart", { timeout: 30000 }, async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "zamer-server-test-"));
  const port = await availablePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  let server = startServer(port, dataDir);
  try {
    await waitForHealth(baseUrl, server);
    const login = `sync-${Date.now()}`;
    const password = "reliable-pass-123";
    const register = await jsonRequest(`${baseUrl}/api/auth/register`, {
      method: "POST",
      body: JSON.stringify({ login, password }),
    });
    assert.equal(register.response.status, 200);
    const firstCookie = sessionCookie(register.response);
    assert.ok(firstCookie.startsWith("zamer_session="));

    const secondLogin = await jsonRequest(`${baseUrl}/api/auth/login`, {
      method: "POST",
      body: JSON.stringify({ login, password }),
    });
    assert.equal(secondLogin.response.status, 200);
    const activeCookie = sessionCookie(secondLogin.response);

    const oldStatus = await jsonRequest(`${baseUrl}/api/auth/status`, { headers: { Cookie: firstCookie } });
    assert.equal(oldStatus.payload.user, null);
    const activeStatus = await jsonRequest(`${baseUrl}/api/auth/status`, { headers: { Cookie: activeCookie } });
    assert.equal(activeStatus.payload.user.login, login);

    const created = await jsonRequest(`${baseUrl}/api/projects`, {
      method: "POST",
      headers: { Cookie: activeCookie },
      body: JSON.stringify({ name: "Надежный замер" }),
    });
    assert.equal(created.response.status, 200);
    assert.equal(created.payload.project.revision, 1);
    const projectId = created.payload.project.projectId;

    const firstSave = await jsonRequest(`${baseUrl}/api/projects/${projectId}`, {
      method: "PUT",
      headers: { Cookie: activeCookie },
      body: JSON.stringify({
        ...created.payload.project,
        baseRevision: 1,
        clientSaveId: "first-save",
        entities: [{ id: "line-safe", type: "line", layer: "measure", x1: 0, y1: 0, x2: 3200, y2: 0 }],
      }),
    });
    assert.equal(firstSave.response.status, 200);
    assert.equal(firstSave.payload.revision, 2);

    const staleSave = await jsonRequest(`${baseUrl}/api/projects/${projectId}`, {
      method: "PUT",
      headers: { Cookie: activeCookie },
      body: JSON.stringify({
        ...created.payload.project,
        baseRevision: 1,
        clientSaveId: "stale-save",
        entities: [{ id: "line-stale", type: "line", layer: "measure", x1: 0, y1: 0, x2: 1700, y2: 0 }],
      }),
    });
    assert.equal(staleSave.response.status, 409);
    assert.equal(staleSave.payload.code, "revision_conflict");
    assert.equal(staleSave.payload.recoveryProject.entities[0].id, "line-stale");
    const recoveryProjectId = staleSave.payload.recoveryProject.projectId;

    const repeatedStaleSave = await jsonRequest(`${baseUrl}/api/projects/${projectId}`, {
      method: "PUT",
      headers: { Cookie: activeCookie },
      body: JSON.stringify({
        ...created.payload.project,
        baseRevision: 1,
        clientSaveId: "stale-save",
        entities: [{ id: "line-stale", type: "line", layer: "measure", x1: 0, y1: 0, x2: 1700, y2: 0 }],
      }),
    });
    assert.equal(repeatedStaleSave.response.status, 409);
    assert.equal(repeatedStaleSave.payload.recoveryProject.projectId, recoveryProjectId);

    const list = await jsonRequest(`${baseUrl}/api/projects`, { headers: { Cookie: activeCookie } });
    assert.equal(list.response.status, 200);
    assert.ok(list.payload.projects.some((project) => project.id === projectId));
    assert.equal(list.payload.projects.filter((project) => project.id === recoveryProjectId).length, 1);

    await stopServer(server);
    server = startServer(port, dataDir);
    await waitForHealth(baseUrl, server);

    const restored = await jsonRequest(`${baseUrl}/api/projects/${projectId}`, { headers: { Cookie: activeCookie } });
    assert.equal(restored.response.status, 200);
    assert.equal(restored.payload.project.revision, 2);
    assert.equal(restored.payload.project.entities[0].id, "line-safe");

    const versionDir = path.join(dataDir, "project-versions", activeStatus.payload.user.id, projectId);
    assert.ok(fs.readdirSync(versionDir).some((name) => name.endsWith(".json")));

    const deleted = await jsonRequest(`${baseUrl}/api/projects/${recoveryProjectId}`, {
      method: "DELETE",
      headers: { Cookie: activeCookie },
    });
    assert.equal(deleted.response.status, 200);
    assert.equal(deleted.payload.recoverable, true);
    const trashDir = path.join(dataDir, "project-trash", activeStatus.payload.user.id);
    assert.ok(fs.readdirSync(trashDir).some((name) => name.startsWith(`${recoveryProjectId}-`)));
  } finally {
    await stopServer(server);
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
