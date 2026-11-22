// Единая контекстная панель: команды всегда в одном месте и действительно
// изменяют выбранный объект.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, openNew, dropOnCanvas } from './helpers.mjs';

describe('контекстная панель выделения', () => {
  let app;
  before(async () => {
    app = await startApp();
    await openNew(app.page);
  });
  after(async () => { await app?.close(); });

  it('комната: копировать, дверь, окно и удалить собраны сверху', async () => {
    await dropOnCanvas(app.page, 'application/x-kepler-room', 'living');
    await app.page.waitForSelector('#selectionToolbar:not([hidden])');
    assert.equal(await app.page.locator('.selection-toolbar-label').innerText(), 'Помещение');
    for (const action of ['duplicate', 'add-door', 'add-window', 'delete']) {
      assert.equal(await app.page.locator(`[data-selection-action="${action}"]`).count(), 1);
    }
    await app.page.click('[data-selection-action="duplicate"]');
    assert.equal(await app.page.evaluate(() => window.__kepler.state.project.rooms.length), 2);
  });

  it('мебель: копирование, поворот и зеркало работают из той же панели', async () => {
    await dropOnCanvas(app.page, 'application/x-kepler-furn', 'bed-double');
    assert.equal(await app.page.locator('.selection-toolbar-label').innerText(), 'Мебель');
    const original = await app.page.evaluate(() => window.__kepler.state.project.items.at(-1).id);
    await app.page.click('[data-selection-action="rotate"]');
    await app.page.click('[data-selection-action="mirror"]');
    const changed = await app.page.evaluate((id) => {
      const item = window.__kepler.state.project.items.find((candidate) => candidate.id === id);
      return { rotation: item.rotation, mirrored: item.mirrored };
    }, original);
    assert.deepEqual(changed, { rotation: 90, mirrored: true });

    await app.page.click('[data-selection-action="duplicate"]');
    assert.equal(await app.page.evaluate(() => window.__kepler.state.project.items.length), 2);
    await app.page.keyboard.press('Control+d');
    assert.equal(await app.page.evaluate(() => window.__kepler.state.project.items.length), 3);
    await app.page.keyboard.press('Control+c');
    await app.page.keyboard.press('Control+v');
    assert.equal(await app.page.evaluate(() => window.__kepler.state.project.items.length), 4);
    assert.deepEqual(app.errors, []);
  });
});
