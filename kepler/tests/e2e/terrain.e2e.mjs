// e2e рельефа: инструмент «Отметка высоты» в режиме «Участок» — ввод чисел
// на плане, горизонтали и сводка в панели, перетаскивание (одна запись
// истории), отмена последней отметки.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, openNew, clickWorld, worldToClient } from './helpers.mjs';

const terrain = (page) => page.evaluate(() => window.__kepler.state.project.site.terrain);

describe('рельеф', () => {
  let app;
  let c; // центр экрана в координатах съёмки
  before(async () => {
    app = await startApp();
    await openNew(app.page);
    await app.page.click('#modeSiteBtn');
    c = await app.page.evaluate(() => {
      const cnv = document.getElementById('canvas');
      return window.__kepler.screenToWorld(cnv.clientWidth / 2, cnv.clientHeight / 2);
    });
  });
  after(async () => { await app?.close(); });

  it('4 отметки кликом с вводом числа → горизонтали и сводка', async () => {
    const { page } = app;
    await page.click('#siteTools button:has-text("Отметка высоты")');
    const marks = [[-6000, -6000, '100.00'], [6000, -6000, '100,50'], [6000, 6000, '101.50'], [-6000, 6000, '101.00']];
    for (const [dx, dy, z] of marks) {
      await clickWorld(page, c.x + dx, c.y + dy);
      await page.waitForSelector('#elevOverlay:not([hidden])');
      await page.fill('#elevInput', z);
      await page.press('#elevInput', 'Enter');
      await page.waitForSelector('#elevOverlay', { state: 'hidden' });
    }
    const t = await terrain(page);
    assert.deepEqual(t.points.map((p) => p.z), [100000, 100500, 101500, 101000]);
    assert.equal(await page.textContent('#terrainMinMax'), '100.00 / 101.50 м');
    // Горизонтали считаются тем же модулем, что и на плане.
    const levels = await page.evaluate(async () => {
      const T = await import('./core/terrain.js');
      const tr = window.__kepler.state.project.site.terrain;
      return T.contours(T.terrainModel(tr), tr.contourStep).map((l) => l.z);
    });
    assert.deepEqual(levels, [100500, 101000]);
    // Строка статуса: отметка под курсором.
    const mid = await worldToClient(page, c.x, c.y);
    await page.mouse.move(mid.x, mid.y);
    assert.match(await page.textContent('#cursorPos'), /отм\. 100\.\d\d/);
    assert.deepEqual(app.errors, []);
  });

  it('перетаскивание точки — одна запись истории; отмена убирает последнюю отметку', async () => {
    const { page } = app;
    const before = await terrain(page);
    const p0 = before.points[0];
    const a = await worldToClient(page, p0.x, p0.y);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(a.x + 20, a.y + 10, { steps: 5 });
    await page.mouse.move(a.x + 40, a.y + 20, { steps: 5 });
    await page.mouse.up();
    const moved = (await terrain(page)).points[0];
    assert.ok(moved.x > p0.x + 500, 'точка сдвинулась');
    await page.keyboard.press('Control+z'); // одна отмена — точка на месте
    const back = (await terrain(page)).points;
    assert.equal(back.length, 4);
    assert.equal(back[0].x, p0.x);
    await page.keyboard.press('Control+z'); // ещё одна — убирает последнюю отметку
    const after = (await terrain(page)).points;
    assert.equal(after.length, 3);
    assert.deepEqual(after.map((p) => p.z), [100000, 100500, 101500]);
    assert.deepEqual(app.errors, []);
  });
});
