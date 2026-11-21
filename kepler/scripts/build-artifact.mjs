// Сборка страницы-артефакта (claude.ai) из index.html — один источник правды.
//
// Страница артефакта — это <title>, ссылки на стили и содержимое <body>:
// обёртку документа добавляет площадка при публикации. Рядом кладутся
// таблицы стилей и модули, достижимые из app.js,
// с теми же относительными путями, плюс manifest.json со списком файлов.
//
//   node scripts/build-artifact.mjs [папка]     (по умолчанию dist/artifact)

import { readFileSync, writeFileSync, mkdirSync, copyFileSync, rmSync, existsSync } from 'node:fs';
import { dirname, join, posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const PAGE = 'kepler-plan.html';

const IMPORT_RE = /^\s*(?:import|export)\s[^'"]*?from\s*['"](\.{1,2}\/[^'"]+)['"]|^\s*import\s*['"](\.{1,2}\/[^'"]+)['"]/gm;
const DYNAMIC_IMPORT_RE = /\bimport\s*\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/g;
const MODULE_URL_RE = /new\s+URL\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*,\s*import\.meta\.url\s*\)/g;

// Все локальные модули, достижимые из entry (пути от корня, через «/»).
export function moduleGraph(entry, root = ROOT) {
  const seen = new Set();
  const visit = (rel) => {
    if (seen.has(rel)) return;
    seen.add(rel);
    const code = readFileSync(join(root, rel), 'utf8');
    for (const m of code.matchAll(IMPORT_RE)) {
      visit(posix.normalize(posix.join(posix.dirname(rel), m[1] || m[2])));
    }
    for (const m of code.matchAll(DYNAMIC_IMPORT_RE)) {
      visit(posix.normalize(posix.join(posix.dirname(rel), m[1])));
    }
    // Module Worker не является import-выражением, но его entry и весь его
    // статический граф должны лежать рядом со страницей артефакта.
    for (const m of code.matchAll(MODULE_URL_RE)) {
      const target = posix.normalize(posix.join(posix.dirname(rel), m[1]));
      if (target.endsWith('.js')) visit(target);
    }
  };
  visit(entry);
  return [...seen].sort();
}

// index.html → фрагмент страницы артефакта.
export function artifactPage(html) {
  const title = /<title>[\s\S]*?<\/title>/.exec(html)?.[0];
  const styles = [...html.matchAll(/<link\s[^>]*rel="stylesheet"[^>]*>/g)].map((m) => m[0]);
  const body = /<body[^>]*>([\s\S]*)<\/body>/.exec(html)?.[1];
  if (!title || !body) throw new Error('index.html: нет <title> или <body>');
  return `${title}\n${styles.join('\n')}\n${body.replace(/\s+$/, '')}\n`;
}

// Локальные файлы, на которые ссылается страница (src/href вида ./x).
export function pageAssets(html) {
  return [...html.matchAll(/\s(?:src|href)="\.\/([^"]+)"/g)].map((m) => m[1]);
}

export function buildArtifact(outDir, root = ROOT) {
  const html = readFileSync(join(root, 'index.html'), 'utf8');
  const assets = pageAssets(html);
  const scripts = assets.filter((a) => a.endsWith('.js'));
  const files = new Set(assets.filter((a) => !a.endsWith('.js')));
  for (const entry of scripts) for (const f of moduleGraph(entry, root)) files.add(f);
  // Иконки перечислены внутри manifest, а service worker не является import.
  for (const manifest of [...files].filter((f) => /\.webmanifest$/i.test(f))) {
    const data = JSON.parse(readFileSync(join(root, manifest), 'utf8'));
    for (const icon of data.icons || []) {
      if (typeof icon.src !== 'string' || /^(?:[a-z]+:|\/)/i.test(icon.src)) continue;
      files.add(posix.normalize(posix.join(posix.dirname(manifest), icon.src)));
    }
  }
  if (existsSync(join(root, 'sw.js'))) {
    files.add('sw.js');
    files.add('index.html'); // Точка старта PWA и страница для офлайн-переходов.
  }
  const list = [...files].sort();

  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, PAGE), artifactPage(html));
  for (const f of list) {
    mkdirSync(dirname(join(outDir, f)), { recursive: true });
    copyFileSync(join(root, f), join(outDir, f));
  }
  writeFileSync(join(outDir, 'manifest.json'), `${JSON.stringify({ page: PAGE, files: list }, null, 2)}\n`);
  return { page: join(outDir, PAGE), files: list };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const out = resolve(process.argv[2] || join(ROOT, 'dist/artifact'));
  const { page, files } = buildArtifact(out);
  console.log(`страница: ${page}`);
  console.log(`файлов: ${files.length}`);
  for (const f of files) console.log(`  ${f}`);
}
