import { copyFileSync, cpSync, rmSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { ROOT, assetSource } from './build-artifact.mjs';
import { pwaFiles, writePwaAssets } from './build-pwa-assets.mjs';

const output = resolve(ROOT, '../dist/kepler-pages');
const developmentFiles = new Set(['node_modules', 'dist', 'tests']);
rmSync(output, { recursive: true, force: true });
cpSync(ROOT, output, {
  recursive: true,
  filter: (source) => !developmentFiles.has(relative(ROOT, source).split(sep)[0]),
});

for (const file of pwaFiles()) {
  const source = assetSource(ROOT, file);
  if (source !== join(ROOT, file)) copyFileSync(source, join(output, file));
}
const { version, assets } = writePwaAssets(join(output, 'pwa-assets.js'), process.argv[2], output);
console.log(`Kepler PWA ${version}: ${assets.length} файлов для офлайн-кэша → ${output}`);
