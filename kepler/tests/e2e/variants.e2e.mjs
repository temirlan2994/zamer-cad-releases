// e2e вариантов: сохранить, сравнить, открыть, сгенерировать, удалить.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp } from './helpers.mjs';

const rooms = (page) => page.evaluate(() => window.__kepler.state.project.rooms.length);
const variants = (page) => page.$$eval('#propsPanel .variant-list li b', (ns) => ns.map((n) => n.textContent));

describe('варианты', () => {
  let app;
  before(async () => {
    app = await startApp();
    await app.page.click('#startTemplates [data-template="one-storey"]');
    await app.page.waitForSelector('#startScreen', { state: 'hidden' });
  });
  after(async () => { await app?.close(); });

  it('сохранить текущий как вариант', async () => {
    await app.page.click('#variantSave');
    assert.deepEqual(await variants(app.page), ['Вариант A']);
  });

  it('сравнение: миниатюры и разница в числе помещений', async () => {
    const before = await rooms(app.page);
    const id = await app.page.evaluate(() => window.__kepler.state.project.rooms.find((r) => r.type === 'bedroom').id);
    await app.page.evaluate((rid) => window.__kepler.selectRoom(rid), id);
    await app.page.keyboard.press('Delete');
    assert.equal(await rooms(app.page), before - 1);
    await app.page.keyboard.press('Escape');
    await app.page.click('#propsPanel .variant-list li [data-v-compare]');
    assert.equal(await app.page.isVisible('#compareScreen'), true);
    assert.equal(await app.page.$$eval('#compareThumbs canvas', (ns) => ns.length), 2);
    const row = await app.page.$$eval('#compareTable tr', (trs) => trs.map((tr) => [...tr.children].map((c) => c.textContent)).find((r) => r[0] === 'Помещений'));
    assert.deepEqual(row.slice(1), [String(before - 1), String(before), '+1']);
  });

  it('открыть вариант из сравнения; Ctrl+Z возвращает прежний дом', async () => {
    const now = await rooms(app.page);
    await app.page.click('#compareOpen');
    assert.equal(await app.page.isVisible('#compareScreen'), false);
    assert.equal(await rooms(app.page), now + 1);
    await app.page.keyboard.press('Control+z');
    assert.equal(await rooms(app.page), now);
    await app.page.keyboard.press('Control+y');
  });

  it('генератор добавляет три варианта, удаление убирает', async () => {
    await app.page.keyboard.press('Escape');
    await app.page.click('#variantGenerate');
    const names = await variants(app.page);
    assert.deepEqual(names, ['Вариант A', 'Вариант B', 'Вариант C', 'Вариант D']);
    assert.match(await app.page.textContent('#propsPanel .variant-list'), /жилые на солнечной стороне|ряды поровну/);
    await app.page.click('#propsPanel .variant-list li:nth-child(2) [data-v-del]');
    assert.deepEqual(await variants(app.page), ['Вариант A', 'Вариант C', 'Вариант D']);
  });

  it('варианты сохраняются в файле проекта и открываются из него', async () => {
    const [dl] = await Promise.all([app.page.waitForEvent('download'), app.page.click('#saveBtn')]);
    const { readFile } = await import('node:fs/promises');
    const saved = JSON.parse(await readFile(await dl.path(), 'utf8'));
    assert.deepEqual(saved.variants.map((v) => v.name), ['Вариант A', 'Вариант C', 'Вариант D']);
    assert.ok(saved.variants.every((v) => v.house.levels[0].rooms.length > 0 && !('site' in v.house)));
  });

  it('без ошибок в консоли', () => {
    assert.deepEqual(app.errors, []);
  });
});
