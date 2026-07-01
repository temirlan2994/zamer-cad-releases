const http = require("http");
const fs = require("fs");
const path = require("path");

const root = __dirname;
const port = process.env.PORT || 4187;
const host = process.env.HOST || "127.0.0.1";
const projectStatePath = path.join(root, "project-state.json");
const projectStatesDir = path.join(root, "project-states");
const maxProjectBytes = 2 * 1024 * 1024;

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

  fs.readFile(filePath, (error, content) => {
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

function sendJson(response, status, payload) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(payload));
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
    createdAt: project?.createdAt || fallback.createdAt || new Date().toISOString(),
    updatedAt: project?.savedAt || project?.updatedAt || fallback.updatedAt || new Date().toISOString(),
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
  const template = body.template || "blank";
  const entities = template === "apartment" && !Array.isArray(source.entities)
    ? [
        { id: "wall-1", type: "wall", layer: "walls", x1: 0, y1: 0, x2: 5200, y2: 0, width: 180 },
        { id: "wall-2", type: "wall", layer: "walls", x1: 5200, y1: 0, x2: 5200, y2: 3600, width: 180 },
        { id: "wall-3", type: "wall", layer: "walls", x1: 5200, y1: 3600, x2: 0, y2: 3600, width: 180 },
        { id: "wall-4", type: "wall", layer: "walls", x1: 0, y1: 3600, x2: 0, y2: 0, width: 180 },
      ]
    : Array.isArray(source.entities) ? source.entities : [];
  return {
    version: 2,
    clientId: client,
    projectId: id,
    name,
    createdAt: source.createdAt || now,
    updatedAt: now,
    savedAt: now,
    theme: source.theme === "dark" ? "dark" : "light",
    view: source.view || { scale: 0.085, panX: 92, panY: 84 },
    snaps: Array.isArray(source.snaps) ? source.snaps : ["grid", "end", "polar"],
    visibleLayers: Array.isArray(source.visibleLayers) ? source.visibleLayers : ["walls", "dimensions", "furniture", "measure"],
    annotationScale: Number.isFinite(source.annotationScale) ? source.annotationScale : 1,
    selectionFilter: source.selectionFilter || "all",
    furnitureTab: source.furnitureTab || "furniture",
    furnitureCategory: source.furnitureCategory || "sofas",
    furnitureSheetPosition: source.furnitureSheetPosition || "half",
    entities,
    thumbnail: source.thumbnail || null,
  };
}

function handleProjectsApi(request, response, url) {
  const client = clientFromUrl(url);
  const match = url.pathname.match(/^\/api\/projects\/([^/]+)$/);
  const projectId = match ? safeId(decodeURIComponent(match[1]), "") : "";

  if (url.pathname === "/api/projects" && request.method === "GET") {
    sendProjectsList(response, client);
    return;
  }

  if (url.pathname === "/api/projects" && request.method === "POST") {
    readRequestJson(request, response, (body) => {
      const project = defaultProjectPayload(client, body);
      const filePath = projectFilePath(client, project.projectId);
      const tempPath = uniqueProjectFileTempPath(client, project.projectId);
      writeJsonFileAtomic(filePath, project, tempPath, (writeError) => {
        if (writeError) {
          sendJson(response, 500, { ok: false, error: "Could not create project" });
          return;
        }
        upsertProjectMeta(client, projectSummary(project, { id: project.projectId }), (indexError) => {
          if (indexError) {
            sendJson(response, 500, { ok: false, error: "Could not update project list" });
            return;
          }
          sendJson(response, 200, { ok: true, client, project, meta: projectSummary(project, { id: project.projectId }) });
        });
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
      const now = new Date().toISOString();
      const project = {
        ...body,
        version: body.version || 2,
        clientId: client,
        projectId,
        name: String(body.name || "Без названия").slice(0, 80),
        createdAt: body.createdAt || now,
        updatedAt: now,
        savedAt: body.savedAt || now,
      };
      const tempPath = uniqueProjectFileTempPath(client, projectId);
      writeJsonFileAtomic(filePath, project, tempPath, (writeError) => {
        if (writeError) {
          sendJson(response, 500, { ok: false, error: "Could not save project" });
          return;
        }
        upsertProjectMeta(client, projectSummary(project, { id: projectId }), (indexError) => {
          if (indexError) {
            sendJson(response, 500, { ok: false, error: "Could not update project list" });
            return;
          }
          sendJson(response, 200, { ok: true, client, projectId, meta: projectSummary(project, { id: projectId }) });
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
    fs.unlink(filePath, () => {
      removeProjectMeta(client, projectId, (indexError) => {
        if (indexError) {
          sendJson(response, 500, { ok: false, error: "Could not update project list" });
          return;
        }
        sendJson(response, 200, { ok: true, client, projectId });
      });
    });
    return;
  }

  response.writeHead(405, { Allow: "GET, POST, PUT, DELETE" });
  response.end("Method not allowed");
}

function handleProjectApi(request, response, url) {
  const paths = clientProjectPaths(url);
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
