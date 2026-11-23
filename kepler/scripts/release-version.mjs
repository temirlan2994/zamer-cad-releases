import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

export function parseReleaseVersion(value) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(value || '').trim());
  if (!match) throw new Error(`Версия «${value}» должна иметь формат X.Y.Z`);
  return match.slice(1).map(Number);
}

export function compareReleaseVersions(a, b) {
  const left = parseReleaseVersion(a);
  const right = parseReleaseVersion(b);
  for (let i = 0; i < left.length; i += 1) {
    if (left[i] !== right[i]) return left[i] > right[i] ? 1 : -1;
  }
  return 0;
}

export function nextPatchVersion(version) {
  const [major, minor, patch] = parseReleaseVersion(version);
  return `${major}.${minor}.${patch + 1}`;
}

export function assertVersionAdvanced(current, previous) {
  if (compareReleaseVersions(current, previous) <= 0) {
    throw new Error(
      `Публикация требует новую версию: сейчас ${current}, предыдущая ${previous}. ` +
      'Выполните npm run version:next в каталоге kepler.',
    );
  }
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

export function assertVersionConsistency(root = ROOT) {
  const pkg = readJson(join(root, 'package.json'));
  const lock = readJson(join(root, 'package-lock.json'));
  const html = readFileSync(join(root, 'index.html'), 'utf8');
  const version = parseReleaseVersion(pkg.version).join('.');
  if (lock.version !== version || lock.packages?.['']?.version !== version) {
    throw new Error(`Версия ${version} не синхронизирована с package-lock.json`);
  }
  const badges = [...html.matchAll(
    /<span class="app-version"[^>]*aria-label="Версия ([^"]+)"[^>]*>v([^<]+)<\/span>/g,
  )];
  if (badges.length !== 3 || badges.some((match) => match[1] !== version || match[2] !== version)) {
    throw new Error(`Версия ${version} не синхронизирована с тремя логотипами в index.html`);
  }
  return version;
}

export function setReleaseVersion(version, root = ROOT) {
  const next = parseReleaseVersion(version).join('.');
  const packagePath = join(root, 'package.json');
  const lockPath = join(root, 'package-lock.json');
  const htmlPath = join(root, 'index.html');
  const pkg = readJson(packagePath);
  const lock = readJson(lockPath);
  const html = readFileSync(htmlPath, 'utf8');

  pkg.version = next;
  lock.version = next;
  if (!lock.packages?.['']) throw new Error('В package-lock.json отсутствует корневой пакет');
  lock.packages[''].version = next;

  let badgeCount = 0;
  const updatedHtml = html.replace(
    /<span class="app-version"[^>]*>[^<]*<\/span>/g,
    () => {
      badgeCount += 1;
      return `<span class="app-version" aria-label="Версия ${next}">v${next}</span>`;
    },
  );
  if (badgeCount !== 3) throw new Error(`Ожидалось 3 номера версии в index.html, найдено ${badgeCount}`);

  writeJson(packagePath, pkg);
  writeJson(lockPath, lock);
  writeFileSync(htmlPath, updatedHtml);
  return assertVersionConsistency(root);
}

function packageVersion(root = ROOT) {
  return readJson(join(root, 'package.json')).version;
}

export async function publishedPackageVersion(url, request = fetch, options = {}) {
  const {
    attempts = 3,
    timeoutMs = 10_000,
    retryDelayMs = 500,
  } = options;
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await request(url, {
        headers: { 'cache-control': 'no-cache' },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      return parseReleaseVersion(data.version).join('.');
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        await new Promise((resolveDelay) => setTimeout(resolveDelay, attempt * retryDelayMs));
      }
    }
  }
  throw new Error(`Не удалось прочитать опубликованную версию: ${lastError?.message || lastError}`);
}

async function main() {
  const command = process.argv[2];
  if (command === 'bump') {
    const current = packageVersion();
    const next = process.argv[3] || nextPatchVersion(current);
    assertVersionAdvanced(next, current);
    setReleaseVersion(next);
    console.log(`Версия Kepler: ${current} → ${next}`);
    return;
  }
  if (command === 'check-live') {
    const current = assertVersionConsistency();
    const previous = await publishedPackageVersion(process.argv[3]);
    assertVersionAdvanced(current, previous);
    console.log(`Версия публикации подтверждена: ${previous} → ${current}`);
    return;
  }
  throw new Error('Использование: release-version.mjs bump [X.Y.Z] | check-live <package-url>');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
