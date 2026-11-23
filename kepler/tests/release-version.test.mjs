import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync, readFileSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  assertVersionAdvanced,
  assertVersionConsistency,
  compareReleaseVersions,
  nextPatchVersion,
  parseReleaseVersion,
  publishedPackageVersion,
  setReleaseVersion,
} from '../scripts/release-version.mjs';

test('релизная версия имеет строгий X.Y.Z и растёт численно', () => {
  assert.deepEqual(parseReleaseVersion('0.4.7'), [0, 4, 7]);
  assert.equal(compareReleaseVersions('0.10.0', '0.9.9'), 1);
  assert.equal(compareReleaseVersions('1.0.0', '1.0.0'), 0);
  assert.equal(nextPatchVersion('0.4.9'), '0.4.10');
  assert.throws(() => parseReleaseVersion('v0.4.7'), /X\.Y\.Z/);
  assert.throws(() => assertVersionAdvanced('0.4.6', '0.4.6'), /требует новую версию/);
});

test('повышение версии синхронизирует package, lock и три логотипа', () => {
  const root = mkdtempSync(join(tmpdir(), 'kepler-release-version-'));
  try {
    writeFileSync(join(root, 'package.json'), '{"name":"kepler","version":"0.4.6"}\n');
    writeFileSync(join(root, 'package-lock.json'), '{"version":"0.4.6","packages":{"":{"version":"0.4.6"}}}\n');
    writeFileSync(join(root, 'index.html'), Array.from({ length: 3 }, () => (
      '<span class="app-version" aria-label="Версия 0.4.6">v0.4.6</span>'
    )).join('\n'));

    assert.equal(setReleaseVersion('0.4.7', root), '0.4.7');
    assert.equal(JSON.parse(readFileSync(join(root, 'package.json'))).version, '0.4.7');
    const lock = JSON.parse(readFileSync(join(root, 'package-lock.json')));
    assert.equal(lock.version, '0.4.7');
    assert.equal(lock.packages[''].version, '0.4.7');
    const html = readFileSync(join(root, 'index.html'), 'utf8');
    assert.equal([...html.matchAll(/aria-label="Версия 0\.4\.7">v0\.4\.7/g)].length, 3);
    assert.equal(assertVersionConsistency(root), '0.4.7');

    lock.version = '0.4.6';
    writeFileSync(join(root, 'package-lock.json'), `${JSON.stringify(lock)}\n`);
    assert.throws(() => assertVersionConsistency(root), /не синхронизирована с package-lock/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('проверка публикации читает версию последнего успешного сайта', async () => {
  const found = await publishedPackageVersion('https://example.test/package.json', async () => ({
    ok: true,
    status: 200,
    json: async () => ({ version: '0.4.6' }),
  }));
  assert.equal(found, '0.4.6');
  await assert.rejects(
    publishedPackageVersion('https://example.test/package.json', async () => ({
      ok: false,
      status: 404,
    }), { attempts: 1 }),
    /HTTP 404/,
  );
});
