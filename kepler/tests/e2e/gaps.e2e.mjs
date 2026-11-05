// e2e подсказки нестандартного зазора: плашка, «Пристыковать», отмена.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { startApp, uploadText } from './helpers.mjs';

describe('нестандартный зазор между комнатами', () => {
  let app;
  before(async () => {
    app = await startApp();
    const text = await readFile(new URL('../fixtures/user-house-2026-11.json', import.meta.url), 'utf8');
    await uploadText(app.page, '#fileInput', 'house.kepler.json', text);
    await app.page.waitForFunction(() => window.__kepler.state.project.rooms.length > 5);
  });
  after(async () => { await app?.close(); });

  const gaps = () => app.page.evaluate(() => (window.__kepler.state.gaps || []).length);
  const roomsXY = () => app.page.evaluate(() => JSON.stringify(window.__kepler.state.project.rooms.map((r) => [r.id, r.x, r.y])));

  it('плашка показывает зазор, «Пристыковать» его убирает, Ctrl+Z возвращает', async () => {
    assert.ok((await gaps()) >= 1, 'зазор не найден в фикстуре');
    await app.page.waitForSelector('#gapBar:not([hidden])');
    await app.page.click('#gapBar .gap-text');
    const before = await roomsXY();
    await app.page.click('#gapBar [data-action="dock-gap"]');
    assert.notEqual(await roomsXY(), before, 'комната не сдвинулась');
    assert.equal(await gaps(), 0, 'зазор остался');
    await app.page.keyboard.press('Control+z');
    assert.equal(await roomsXY(), before, 'отмена не вернула положение');
    assert.ok((await gaps()) >= 1);
  });

  it('без ошибок в консоли', () => { assert.deepEqual(app.errors, []); });
});
