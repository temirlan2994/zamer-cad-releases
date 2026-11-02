import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildZip, crc32 } from '../core/zip.js';

test('crc32 известной строки', () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
});

test('zip: заголовки, число файлов и данные на месте', () => {
  const zip = buildZip([{ name: 'a.dxf', data: 'hello' }, { name: 'папка/b.ifc', data: new Uint8Array([1, 2, 3]) }]);
  const v = new DataView(zip.buffer);
  assert.equal(v.getUint32(0, true), 0x04034b50);
  assert.equal(v.getUint32(zip.length - 22, true), 0x06054b50);
  assert.equal(v.getUint16(zip.length - 22 + 10, true), 2);
  const cdOffset = v.getUint32(zip.length - 22 + 16, true);
  assert.equal(v.getUint32(cdOffset, true), 0x02014b50);
  assert.equal(new TextDecoder().decode(zip.subarray(30 + 5, 30 + 5 + 5)), 'hello');
});

test('zip читается системным unzip', async () => {
  const { mkdtempSync, writeFileSync, readFileSync, rmSync } = await import('node:fs');
  const { execFileSync } = await import('node:child_process');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  let have = true;
  try { execFileSync('unzip', ['-v'], { stdio: 'ignore' }); } catch { have = false; }
  if (!have) return;
  const dir = mkdtempSync(join(tmpdir(), 'kzip-'));
  try {
    writeFileSync(join(dir, 'x.zip'), buildZip([{ name: 'дом.dxf', data: 'LINE\n0\n' }]));
    execFileSync('unzip', ['-q', join(dir, 'x.zip'), '-d', join(dir, 'out')]);
    assert.equal(readFileSync(join(dir, 'out', 'дом.dxf'), 'utf8'), 'LINE\n0\n');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
