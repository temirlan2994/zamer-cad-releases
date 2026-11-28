// Список офлайн-файлов PWA. На GitHub Pages версия равна GITHUB_SHA, локально
// — хешу содержимого, поэтому каждое опубликованное изменение создаёт новый
// service worker/cache без ручного увеличения номера.

import { createHash } from 'node:crypto';
import {
  existsSync, readFileSync, statSync, writeFileSync,
} from 'node:fs';
import { join, posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT, assetSource, applicationPages, applicationModuleGraph, pageAssets } from './build-artifact.mjs';

const clean = (path) => posix.normalize(String(path).replace(/^\.\//, ''));

export function pwaFiles(root = ROOT) {
  const pages = applicationPages(root);
  const files = new Set([...pages, 'sw.js', 'pwa-assets.js']);
  for (const page of pages) {
    for (const asset of pageAssets(readFileSync(join(root, page), 'utf8'))) files.add(clean(asset));
  }
  for (const file of applicationModuleGraph(root)) files.add(clean(file));
  for (const manifest of [...files].filter((file) => /\.webmanifest$/i.test(file))) {
    const data = JSON.parse(readFileSync(join(root, manifest), 'utf8'));
    for (const icon of data.icons || []) {
      if (typeof icon.src !== 'string' || /^(?:[a-z]+:|\/)/i.test(icon.src)) continue;
      files.add(clean(posix.join(posix.dirname(manifest), icon.src)));
    }
  }
  return [...files].filter((file) => {
    const path = assetSource(root, file);
    return file === 'pwa-assets.js' || (existsSync(path) && statSync(path).isFile());
  }).sort();
}

export function pwaAssetData(root = ROOT, requestedVersion = null) {
  const files = pwaFiles(root);
  let version = String(requestedVersion || '').trim();
  if (!version) {
    const hash = createHash('sha256');
    for (const file of files) {
      if (file === 'pwa-assets.js') continue;
      hash.update(file).update('\0').update(readFileSync(assetSource(root, file))).update('\0');
    }
    version = hash.digest('hex').slice(0, 16);
  }
  return {
    version: version.replace(/[^a-z0-9._-]/gi, '-').slice(0, 80) || 'source',
    assets: ['./', ...files.map((file) => `./${file}`)],
  };
}

export function writePwaAssets(output = join(ROOT, 'pwa-assets.js'), version = null, root = ROOT) {
  const data = pwaAssetData(root, version);
  const code = `// Сгенерировано scripts/build-pwa-assets.mjs.\n` +
    `globalThis.KEPLER_PWA = Object.freeze(${JSON.stringify(data, null, 2)});\n`;
  writeFileSync(output, code);
  return data;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const output = resolve(process.argv[3] || join(ROOT, 'pwa-assets.js'));
  const data = writePwaAssets(output, process.argv[2] || null);
  console.log(`PWA ${data.version}: ${data.assets.length} файлов → ${output}`);
}
