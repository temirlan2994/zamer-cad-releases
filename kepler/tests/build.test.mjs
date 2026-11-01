// Сборка артефакта из index.html и целостность страницы.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ROOT, PAGE, moduleGraph, artifactPage, buildArtifact } from '../scripts/build-artifact.mjs';

const html = readFileSync(join(ROOT, 'index.html'), 'utf8');

test('все модули ui/ достижимы из app.js (нет забытых файлов)', () => {
  const graph = new Set(moduleGraph('app.js'));
  for (const f of readdirSync(join(ROOT, 'ui'))) assert.ok(graph.has(`ui/${f}`), `ui/${f} не подключён`);
  for (const f of ['render.js', 'core/model.js', 'core/migrate.js', 'core/zamer/geometry.js']) assert.ok(graph.has(f), f);
});

test('страница артефакта — фрагмент из index.html', () => {
  const page = artifactPage(html);
  assert.match(page, /^<title>Kepler Plan<\/title>/);
  assert.ok(page.includes('href="./styles.css"'));
  assert.ok(page.includes('<script type="module" src="./app.js"></script>'));
  assert.ok(!/<(html|head|body)[\s>]/.test(page), 'без обёртки документа');
  assert.ok(page.includes('id="canvas"'));
});

test('каждый id, который ищет код, есть в index.html', () => {
  const ids = new Set();
  for (const f of readdirSync(join(ROOT, 'ui'))) {
    const code = readFileSync(join(ROOT, 'ui', f), 'utf8');
    for (const m of code.matchAll(/(?:\bel|getElementById)\('([\w-]+)'\)/g)) ids.add(m[1]);
  }
  assert.ok(ids.size > 20);
  for (const id of ids) assert.ok(html.includes(`id="${id}"`), `в index.html нет #${id}`);
});

test('сборка кладёт страницу, стили, модули и манифест', () => {
  const out = mkdtempSync(join(tmpdir(), 'kepler-artifact-'));
  try {
    const { files } = buildArtifact(out);
    assert.ok(existsSync(join(out, PAGE)));
    assert.ok(files.includes('styles.css') && files.includes('app.js') && files.includes('ui/input.js'));
    for (const f of files) assert.ok(existsSync(join(out, f)), f);
    const manifest = JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8'));
    assert.deepEqual(manifest.files, files);
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});
