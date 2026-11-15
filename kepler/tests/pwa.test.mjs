// Устанавливаемое приложение: манифест, иконки, service worker и артефакт.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  existsSync, mkdtempSync, readFileSync, rmSync,
} from 'node:fs';
import { dirname, join, normalize, relative, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { ROOT, buildArtifact } from '../scripts/build-artifact.mjs';
import { pwaAssetData } from '../scripts/build-pwa-assets.mjs';

const html = readFileSync(join(ROOT, 'index.html'), 'utf8');

function localRef(pattern, title) {
  const value = html.match(pattern)?.[1];
  assert.ok(value, `${title} подключён в index.html`);
  assert.ok(value.startsWith('./') && !value.includes('..'), `${title} — локальный относительный путь`);
  return value.slice(2);
}

function fileFrom(root, rel, title = rel) {
  const path = resolve(root, rel);
  assert.equal(relative(root, path).startsWith('..'), false, `${title} остаётся внутри приложения`);
  assert.ok(existsSync(path), `${title}: файл существует`);
  return path;
}

const manifestRel = () => localRef(/<link\b(?=[^>]*\brel=["']manifest["'])[^>]*\bhref=["']([^"']+)["'][^>]*>/i, 'Web App Manifest');

test('index.html объявляет PWA и настройки iPhone', () => {
  manifestRel();
  assert.match(html, /<meta\b(?=[^>]*\bname=["']theme-color["'])[^>]*\bcontent=["']#[0-9a-f]{6}["'][^>]*>/i);
  assert.match(html, /<meta\b(?=[^>]*\bname=["']apple-mobile-web-app-capable["'])[^>]*\bcontent=["']yes["'][^>]*>/i);
  assert.match(html, /<meta\b(?=[^>]*\bname=["']apple-mobile-web-app-status-bar-style["'])/i);
  const apple = localRef(/<link\b(?=[^>]*\brel=["']apple-touch-icon["'])[^>]*\bhref=["']([^"']+)["'][^>]*>/i, 'иконка iPhone');
  fileFrom(ROOT, apple, 'иконка iPhone');
});

test('manifest позволяет установить kep•ler 3D на телефон', () => {
  const rel = manifestRel();
  const manifest = JSON.parse(readFileSync(fileFrom(ROOT, rel), 'utf8'));
  assert.match(manifest.name, /kep.*ler.*3D/i);
  assert.ok(typeof manifest.short_name === 'string' && manifest.short_name.length <= 30);
  assert.ok(['standalone', 'fullscreen', 'minimal-ui'].includes(manifest.display));
  assert.ok(manifest.start_url === './' || manifest.start_url === '.');
  assert.ok(manifest.scope === './' || manifest.scope === '.');
  assert.match(manifest.theme_color, /^#[0-9a-f]{6}$/i);
  assert.match(manifest.background_color, /^#[0-9a-f]{6}$/i);
  assert.equal(manifest.lang, 'ru');

  const icons = Array.isArray(manifest.icons) ? manifest.icons : [];
  for (const size of ['192x192', '512x512']) {
    const icon = icons.find((x) => String(x.sizes || '').split(/\s+/).includes(size));
    assert.ok(icon, `есть иконка ${size}`);
    assert.equal(icon.type, 'image/png', `${size} — PNG`);
    fileFrom(dirname(join(ROOT, rel)), normalize(icon.src), `иконка ${size}`);
  }
  assert.ok(icons.some((x) => String(x.purpose || '').split(/\s+/).includes('maskable')), 'есть maskable-иконка Android');
});

test('service worker обновляет приложение и оставляет офлайн-копию', () => {
  const sources = [
    readFileSync(join(ROOT, 'app.js'), 'utf8'),
    ...['ui/pwa.js', 'ui/install.js'].filter((f) => existsSync(join(ROOT, f))).map((f) => readFileSync(join(ROOT, f), 'utf8')),
  ].join('\n');
  assert.match(sources, /serviceWorker\.register\s*\(/, 'service worker регистрируется приложением');
  assert.match(sources, /sw\.js/, 'регистрация указывает на sw.js');
  const sw = readFileSync(fileFrom(ROOT, 'sw.js', 'service worker'), 'utf8');
  for (const event of ['install', 'activate', 'fetch']) {
    assert.match(sw, new RegExp(`addEventListener\\(\\s*['"]${event}['"]`), `обрабатывается ${event}`);
  }
  assert.match(sw, /skipWaiting\s*\(/, 'новая версия активируется без ручной очистки кэша');
  assert.match(sw, /clients\.claim\s*\(/, 'новая версия берёт открытые вкладки под управление');
  const installHandler = sw.match(/addEventListener\(\s*['"]install['"][\s\S]*?\n\}\);/)?.[0] || '';
  assert.doesNotMatch(installHandler, /skipWaiting\s*\(/, 'обновление не переключается посреди открытого проекта');
  assert.match(sources, /visibilityState\s*===\s*['"]hidden['"][\s\S]{0,240}activateWaitingUpdate/, 'ожидающая версия включается после сворачивания');
  assert.match(sources, /function\s+activateWaitingUpdate[\s\S]{0,360}SKIP_WAITING/, 'клиент включает ожидающий worker явно');
  assert.match(sw, /clients\.matchAll\([^)]*type:\s*['"]window['"][^)]*includeUncontrolled:\s*true/, 'worker учитывает все вкладки приложения');
  assert.match(sw, /client\.url\.startsWith\(self\.registration\.scope\)/, 'чужие страницы того же домена не блокируют обновление');
  assert.match(sw, /visibilityState\s*!==\s*['"]hidden['"]/, 'видимая вкладка блокирует переключение версии');
  assert.match(sw, /await\s+Promise\.all\(batch\.map/, 'неполная новая сборка не заменяет рабочую');
  assert.match(sw, /request\.method\s*!==?\s*['"]GET['"]|request\.method\s*===?\s*['"]GET['"]/, 'изменяющие запросы не кэшируются');
  assert.match(sw, /location\.origin|url\.origin/, 'чужие домены не попадают в локальный кэш');
  assert.match(sources, /updateViaCache\s*:\s*['"]none['"]/, 'проверка новой версии service worker не берётся из HTTP-кэша');
  assert.match(sources, /\.update\s*\(/, 'при запуске явно проверяется свежая версия');
  assert.match(sw, /importScripts\s*\([^)]*pwa-assets\.js/, 'worker получает версию и список файлов сборки');
  const assets = readFileSync(fileFrom(ROOT, 'pwa-assets.js', 'описание PWA-сборки'), 'utf8');
  assert.match(assets, /KEPLER_PWA/);
  assert.match(assets, /version/);
  assert.match(assets, /assets/);
});

test('pwa-assets.js содержит полный актуальный список офлайн-файлов', () => {
  const source = readFileSync(fileFrom(ROOT, 'pwa-assets.js'), 'utf8');
  const json = source.match(/Object\.freeze\((\{[\s\S]*\})\);/)?.[1];
  assert.ok(json, 'pwa-assets.js содержит Object.freeze с JSON');
  const committed = JSON.parse(json);
  assert.deepEqual(
    committed.assets,
    pwaAssetData(ROOT, committed.version).assets,
    'после добавления файлов или import нужно запустить build-pwa-assets.mjs',
  );
});

test('сборка страницы содержит весь устанавливаемый PWA', () => {
  const out = mkdtempSync(join(tmpdir(), 'kepler-pwa-'));
  try {
    const { files } = buildArtifact(out);
    const manifest = manifestRel();
    assert.ok(files.includes(manifest), 'manifest попал в артефакт');
    const data = JSON.parse(readFileSync(join(ROOT, manifest), 'utf8'));
    for (const icon of data.icons || []) {
      const rel = normalize(join(dirname(manifest), icon.src));
      assert.ok(files.includes(rel), `${rel} попал в артефакт`);
      assert.ok(existsSync(join(out, rel)), `${rel} скопирован`);
    }
    for (const rel of ['sw.js', 'pwa-assets.js']) {
      assert.ok(files.includes(rel), `${rel} попал в артефакт`);
      assert.ok(existsSync(join(out, rel)), `${rel} скопирован`);
    }
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});
