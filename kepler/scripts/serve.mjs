// Мини-статический сервер для разработки и e2e-тестов.
// Запуск: npm run serve  (PORT=8080 по умолчанию)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { assetSource } from './build-artifact.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

const PREVIEW_DIRS = ['assets', 'core', 'data', 'ui', 'workers'];

function isPreviewAsset(file) {
  if (!Object.hasOwn(TYPES, path.extname(file)) || file.split('/').some((part) => part.startsWith('.'))) return false;
  if (file.includes('/')) return PREVIEW_DIRS.includes(file.split('/')[0]);
  return file.endsWith('.css') || file.endsWith('.webmanifest')
    || ['index.html', 'review.html', 'app.js', 'render.js', 'firebase-config.js', 'pwa-assets.js'].includes(file);
}

export function createServer(root = ROOT, { preview = false } = {}) {
  let revision = randomUUID();
  let updateTimer;
  const reloadPath = '/__kepler_preview.js';
  const revisionPath = '/__kepler_revision';

  const server = http.createServer((req, res) => {
    if (preview) res.setHeader('Cache-Control', 'no-store');
    let rel;
    try {
      rel = decodeURIComponent(req.url.split('?')[0]);
    } catch {
      res.writeHead(400).end();
      return;
    }
    if (!rel.startsWith('/') || rel.includes('\0') || rel.includes('\\')) {
      res.writeHead(400).end();
      return;
    }
    if (preview && rel === revisionPath) {
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' }).end(revision);
      return;
    }
    if (rel === '/') rel = '/index.html';
    const file = path.resolve(root, `.${path.posix.normalize(rel)}`);
    if (!file.startsWith(`${path.resolve(root)}${path.sep}`)) { res.writeHead(403).end(); return; }
    const asset = path.relative(root, file).split(path.sep).join('/');
    if (preview && rel !== reloadPath && !isPreviewAsset(asset)) {
      res.writeHead(404).end('404');
      return;
    }
    const source = preview && rel === reloadPath
      ? path.join(ROOT, 'scripts/preview-refresh.js')
      : assetSource(root, asset);
    fs.readFile(source, (err, data) => {
      if (err) { res.writeHead(404).end('404'); return; }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
      if (preview && asset === 'index.html') {
        const html = data.toString().replace('<html ', `<html data-kepler-preview="${revision}" `)
          .replace('<title>', '<title>Предпросмотр · ')
          .replace('</body>', `<script src=".${reloadPath}" defer></script></body>`);
        res.end(html);
        return;
      }
      res.end(data);
    });
  });
  if (preview) {
    const bump = () => {
      clearTimeout(updateTimer);
      updateTimer = setTimeout(() => { revision = randomUUID(); }, 350).unref();
    };
    const watches = [fs.watch(root, { persistent: false }, (_event, file) => {
      if (file && isPreviewAsset(file)) bump();
    })];
    for (const dir of PREVIEW_DIRS) {
      watches.push(fs.watch(path.join(root, dir), { recursive: true, persistent: false }, (_event, file) => {
        if (file && isPreviewAsset(`${dir}/${file}`)) bump();
      }));
    }
    if (root === ROOT) {
      watches.push(fs.watch(path.resolve(root, '../shared/cad'), { recursive: true, persistent: false }, bump));
      watches.push(fs.watch(path.join(ROOT, 'scripts/preview-refresh.js'), { persistent: false }, bump));
    }
    server.once('close', () => {
      clearTimeout(updateTimer);
      watches.forEach((watch) => watch.close());
    });
  }
  return server;
}

// Запуск сервера на свободном порту (port=0) — для тестов.
export function listen(server, port = 0, host = '127.0.0.1') {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      resolve(server.address().port);
    });
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const preview = process.argv.includes('--preview');
  const server = createServer(ROOT, { preview });
  const host = preview ? process.env.KEPLER_PREVIEW_HOST : undefined;
  const port = await listen(server, Number(process.env.PORT) || (preview ? 4173 : 8080), host);
  console.log(`kep•ler 3D: http://127.0.0.1:${port}/`);
}
