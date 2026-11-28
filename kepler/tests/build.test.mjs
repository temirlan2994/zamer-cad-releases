// Сборка артефакта из index.html и целостность страницы.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ROOT, PAGE, moduleGraph, applicationPages, applicationModuleGraph, artifactPage, buildArtifact } from '../scripts/build-artifact.mjs';

const html = readFileSync(join(ROOT, 'index.html'), 'utf8');

test('номер версии совпадает с package.json и виден у каждого логотипа', () => {
  const { version } = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  const lock = JSON.parse(readFileSync(join(ROOT, 'package-lock.json'), 'utf8'));
  assert.equal(lock.version, version);
  assert.equal(lock.packages[''].version, version);
  const badges = [...html.matchAll(/<span class="app-version"[^>]*>([^<]+)<\/span>/g)];
  assert.equal(badges.length, 3);
  for (const badge of badges) assert.equal(badge[1], `v${version}`);
});

test('все модули ui/ достижимы из точек входа страниц', () => {
  const graph = new Set(applicationModuleGraph());
  for (const f of readdirSync(join(ROOT, 'ui'))) assert.ok(graph.has(`ui/${f}`), `ui/${f} не подключён`);
  for (const f of ['render.js', 'core/model.js', 'core/migrate.js', 'core/zamer/geometry.js']) assert.ok(graph.has(f), f);
  assert.ok(graph.has('workers/layout-worker.js'), 'module Worker не попал в граф');
  assert.ok(graph.has('core/layout-worker-handler.js'), 'зависимости Worker не попали в граф');
});

test('отложенно открываемый инструмент и его зависимости включаются в сборку', () => {
  const root = mkdtempSync(join(tmpdir(), 'kepler-module-graph-'));
  try {
    writeFileSync(join(root, 'app.js'), "export const open = () => import('./inspector.js');");
    writeFileSync(join(root, 'inspector.js'), "import './icons.js';");
    writeFileSync(join(root, 'icons.js'), '');
    assert.deepEqual(moduleGraph('app.js', root), ['app.js', 'icons.js', 'inspector.js']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('страница артефакта — фрагмент из index.html', () => {
  const page = artifactPage(html);
  assert.match(page, /^<title>kep•ler 3D<\/title>/);
  assert.ok(page.includes('href="./styles.css"'));
  assert.ok(page.includes('<script type="module" src="./app.js"></script>'));
  assert.ok(!/<(html|head|body)[\s>]/.test(page), 'без обёртки документа');
  assert.ok(page.includes('id="canvas"'));
});

test('каждый id, который ищет код, создаётся страницей или панелью', () => {
  const ids = new Set();
  const templates = applicationPages().map((page) => readFileSync(join(ROOT, page), 'utf8'));
  for (const f of readdirSync(join(ROOT, 'ui'))) {
    const code = readFileSync(join(ROOT, 'ui', f), 'utf8');
    templates.push(code);
    for (const m of code.matchAll(/(?:\bel|getElementById)\('([\w-]+)'\)/g)) ids.add(m[1]);
  }
  assert.ok(ids.size > 20);
  const markup = templates.join('\n');
  for (const id of ids) assert.ok(markup.includes(`id="${id}"`), `отсутствует #${id}`);
});

test('сборка кладёт страницу, стили, модули и манифест', () => {
  const out = mkdtempSync(join(tmpdir(), 'kepler-artifact-'));
  try {
    const { files } = buildArtifact(out);
    assert.ok(existsSync(join(out, PAGE)));
    assert.ok(files.includes('styles.css') && files.includes('app.js') && files.includes('ui/input.js'));
    for (const style of html.matchAll(/<link\s[^>]*rel="stylesheet"[^>]*href="\.\/([^"]+)"/g)) {
      assert.ok(files.includes(style[1]), style[1]);
      assert.ok(readFileSync(join(out, PAGE), 'utf8').includes(style[0]));
    }
    for (const file of ['review.html', 'review.css', 'ui/review-client.js', 'ui/review-document.js']) assert.ok(files.includes(file), file);
    assert.ok(files.includes('workers/layout-worker.js'));
    assert.ok(files.includes('assets/garden-villa.png'));
    for (const module of ['geometry.js', 'blocks.js', 'dxf-writer.js']) {
      const rel = `core/zamer/${module}`;
      assert.ok(files.includes(rel), rel);
      assert.deepEqual(readFileSync(join(out, rel)), readFileSync(join(ROOT, '../shared/cad', module)));
    }
    for (const f of files) assert.ok(existsSync(join(out, f)), f);
    const manifest = JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8'));
    assert.deepEqual(manifest.files, files);
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});
