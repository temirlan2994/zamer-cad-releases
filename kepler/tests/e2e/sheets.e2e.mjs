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

function pdfPageImage(bytes, index) {
  const images = [...bytes.toString('latin1').matchAll(/\/Filter \/DCTDecode \/Length (\d+) >>\nstream\n/g)];
  const image = images[index];
  assert.ok(image, `растр страницы ${index + 1}`);
  const start = image.index + image[0].length;
  return bytes.subarray(start, start + Number(image[1]));
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

  it('выбор и предпросмотр второго автолиста выгружают именно вторую страницу альбома', async () => {
    const { page } = app;
    const album = await exportFile(page, 'sheet-pdf');
    const second = pdfPageImage(album.bytes, 1);
    assert.ok(!pdfPageImage(album.bytes, 0).equals(second), 'генплан отличается от поэтажного плана');
    const downloadOne = async (button) => {
      const [file] = await Promise.all([page.waitForEvent('download'), button.click()]);
      assert.match(file.suggestedFilename(), /лист-2\.pdf$/);
      const bytes = await readFile(await file.path());
      assert.match(bytes.toString('latin1'), /\/Count 1/);
      assert.ok(pdfPageImage(bytes, 0).equals(second), 'точная копия изображения второй страницы, со штампом');
    };
    await page.getByRole('tab', { name: 'Листы', exact: true }).click();
    const sheet = page.getByRole('option').filter({ hasText: 'План: 1 этаж' });
    await sheet.locator('.sheets-name').click();
    await downloadOne(page.getByRole('button', { name: 'PDF выбранного листа' }));
    await sheet.getByRole('button', { name: 'Открыть' }).click();
    assert.equal(await page.locator('#projectRoute').isVisible(), false, 'палитра не перекрывает лист');
    await downloadOne(page.getByRole('button', { name: 'Скачать PDF этого листа' }));
    await page.getByRole('tab', { name: 'Свойства', exact: true }).click();
    await downloadOne(page.locator('#sheetPropPdfOne'));
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#sheetView').isVisible(), false);
    assert.equal(await page.locator('#projectRoute .project-route-bar').isVisible(), true, 'палитра вернулась');
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

describe('IFC', () => {
  let app;
  before(async () => { app = await startApp(); await openSample(app.page); });
  after(async () => { await app?.close(); });

  it('экспорт IFC4 из меню: файл STEP со стенами, проёмами и помещениями', async () => {
    const f = await exportFile(app.page, 'ifc');
    assert.match(f.name, /\.ifc$/);
    const text = f.bytes.toString('utf8');
    assert.ok(text.startsWith('ISO-10303-21;'));
    assert.match(text, /FILE_SCHEMA\(\('IFC4'\)\)/);
    assert.ok((text.match(/=IFCWALL\(/g) || []).length > 10);
    assert.equal((text.match(/=IFCSPACE\(/g) || []).length, 5);
    assert.match(await app.page.textContent('#toast'), /IFC4: стен \d+, дверей \d+, окон \d+, помещений 5/);
    if (process.env.KEPLER_IFC_OUT) await writeFile(process.env.KEPLER_IFC_OUT, f.bytes);
  });

  it('без ошибок в консоли', () => {
    assert.deepEqual(app.errors, []);
  });
});
