// e2e листов: PDF-альбом (генплан + этажи), PNG текущего листа, CSV экспликации.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { startApp, openSample } from './helpers.mjs';

async function exportFile(page, kind) {
  await page.click('#exportBtn');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click(`[data-export="${kind}"]`)]);
  return { name: dl.suggestedFilename(), bytes: await readFile(await dl.path()) };
}

describe('листы и экспликация', () => {
  let app;
  before(async () => { app = await startApp(); await openSample(app.page); });
  after(async () => { await app?.close(); });

  it('PDF: генплан и план этажа — две страницы A3', async () => {
    const f = await exportFile(app.page, 'sheet-pdf');
    assert.match(f.name, /\.pdf$/);
    const text = f.bytes.toString('latin1');
    assert.ok(text.startsWith('%PDF-1.4'));
    assert.match(text, /\/Count 2/);
    assert.match(text, /\/MediaBox \[0 0 1190\.55 841\.89\]/);
    assert.ok(f.bytes.length > 100_000, `размер ${f.bytes.length}`);
    if (process.env.KEPLER_SHEET_OUT) await writeFile(process.env.KEPLER_SHEET_OUT, f.bytes);
  });

  it('PNG текущего этажа: A3 при 150 dpi', async () => {
    const f = await exportFile(app.page, 'sheet-png');
    assert.match(f.name, /\.png$/);
    assert.deepEqual([...f.bytes.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47]);
    assert.equal(f.bytes.readUInt32BE(16), 2480); // ширина
    assert.equal(f.bytes.readUInt32BE(20), 1754); // высота
    if (process.env.KEPLER_PNG_OUT) await writeFile(process.env.KEPLER_PNG_OUT, f.bytes);
  });

  it('CSV экспликации открывается в Excel (BOM, «;»)', async () => {
    const f = await exportFile(app.page, 'schedule-csv');
    assert.match(f.name, /\.csv$/);
    const text = f.bytes.toString('utf8');
    assert.ok(text.startsWith('﻿'));
    assert.match(text, /Этаж;№;Помещение;Площадь, м²/);
    assert.match(text, /Общая площадь;\d+,\d\d/);
  });

  it('без ошибок в консоли', () => {
    assert.deepEqual(app.errors, []);
  });
});
