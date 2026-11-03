// Сборка страницы-артефакта (claude.ai) из index.html — один источник правды.
//
// Страница артефакта — это <title>, ссылки на стили и содержимое <body>:
// обёртку документа добавляет площадка при публикации. Рядом кладутся
// styles.css и все модули, достижимые из app.js по статическим импортам,
// с теми же относительными путями, плюс manifest.json со списком файлов.
//
//   node scripts/build-artifact.mjs [папка]     (по умолчанию dist/artifact)

import { readFileSync, writeFileSync, mkdirSync, copyFileSync, rmSync } from 'node:fs';
import { dirname, join, posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const PAGE = 'kepler-plan.html';

const IMPORT_RE = /^\s*(?:import|export)\s[^'"]*?from\s*['"](\.{1,2}\/[^'"]+)['"]|^\s*import\s*['"](\.{1,2}\/[^'"]+)['"]/gm;

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
