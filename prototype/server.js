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
    tempPath: path.join(projectStatesDir, `project-${client}.tmp.json`),
  };
}

function handleProjectApi(request, response, url) {
  const paths = clientProjectPaths(url);
  if (request.method === "GET") {
    fs.readFile(paths.statePath, "utf8", (error, content) => {
      if (error) {
        if (error.code === "ENOENT") {
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
        fs.writeFile(paths.tempPath, content, "utf8", (writeError) => {
        if (writeError) {
          sendJson(response, 500, { ok: false, error: "Could not write project" });
          return;
        }
        fs.rename(paths.tempPath, paths.statePath, (renameError) => {
          if (renameError) {
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
