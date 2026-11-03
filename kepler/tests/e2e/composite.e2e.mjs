// e2e: стол со стульями — панель свойств (вид стула, стороны, отступ) и
// пересчёт стульев при изменении размера столешницы.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, openNew, dropOnCanvas } from './helpers.mjs';
import { compositeParts } from '../../core/composite.js';

describe('стол со стульями', () => {
  let app;
  before(async () => {
    app = await startApp();
    await openNew(app.page);
    await dropOnCanvas(app.page, 'application/x-kepler-room', 'living');
    await dropOnCanvas(app.page, 'application/x-kepler-furn', 'dining-table');
  });
  after(async () => { await app?.close(); });

  const table = () => app.page.evaluate(() => window.__kepler.state.project.items.find((i) => i.kind === 'dining-table'));

  it('новый стол — сразу со стульями, настройки в панели', async () => {
    const t = await table();
    assert.equal(t.comp?.type, 'dining');
    await app.page.evaluate((id) => window.__kepler.select({ type: 'item', id }), t.id);
    await app.page.waitForSelector('#compDining');
    assert.equal(await app.page.textContent('#compTotal'), '4');
  });

  it('торцы, ширина стола и отступ пересчитывают стулья', async () => {
    await app.page.check('[data-comp-side="left"]');
    await app.page.waitForFunction(() => document.querySelector('#compTotal')?.textContent === '5');
    await app.page.fill('#itemW', '2400');
    await app.page.dispatchEvent('#itemW', 'change');
    await app.page.waitForFunction(() => document.querySelector('#compTotal')?.textContent === '9');
    await app.page.fill('#compOffset', '-100');
    await app.page.dispatchEvent('#compOffset', 'change');
    const t = await table();
    assert.equal(t.w, 2400);
    assert.equal(t.comp.offset, -100);
    assert.equal(compositeParts(t).length, 9);
    await app.page.selectOption('#compChair', '');
    await app.page.waitForFunction(() => document.querySelector('#compTotal')?.textContent === '0');
    assert.deepEqual(app.errors, []);
  });
});
