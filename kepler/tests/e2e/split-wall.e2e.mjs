// e2e «Разделить» стену: выбор торца и расстояния, Enter делит, Esc отменяет.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, openSample } from './helpers.mjs';

describe('разделить стену: отступ от торца', () => {
  let app;
  let splitRoom = null; // комната из первого теста: её стены после деления меняются
  before(async () => { app = await startApp(); await openSample(app.page); });
  after(async () => { await app?.close(); });

  const pickWall = (exclude = null) => app.page.evaluate((skip) => {
    const k = window.__kepler;
    const w = k.state.walls.find((x) => x.kind === 'own' && x.orient === 'h' && x.to - x.from > 3000 && x.rooms[0] !== skip);
    k.select({ type: 'wall', key: w.key, from: w.from });
    return { key: w.key, from: w.from, to: w.to, room: w.rooms[0] };
  }, exclude);
  // Панель выделения перерисовывается асинхронно — ждём кнопку, а не кликаем вслепую.
  const pickWallReady = async (exclude = null) => {
    const w = await pickWall(exclude);
    await app.page.waitForSelector('[data-selection-action="split-wall"]:not([disabled])', { timeout: 5000 });
    return w;
  };
  const verts = (id) => app.page.evaluate((rid) => {
    const r = window.__kepler.state.project.rooms.find((x) => x.id === rid);
    return r.outline ? r.outline.length : 4;
  }, id);

  it('«Разделить» открывает плашку, Enter делит по введённому расстоянию', async () => {
    const w = await pickWallReady();
    splitRoom = w.room;
    const v0 = await verts(w.room);
    await app.page.click('[data-selection-action="split-wall"]');
    await app.page.waitForSelector('#splitInput', { state: 'visible' });
    await app.page.fill('#splitInputField', '1200');
    await app.page.press('#splitInputField', 'Enter');
    await app.page.waitForSelector('#splitInput', { state: 'hidden' });
    assert.equal(await verts(w.room), v0 + 2, 'две совпадающие вершины добавлены');
  });

  it('Esc отменяет без изменений, расстояние вне диапазона не делит', async () => {
    await app.page.keyboard.press('Escape');
    const w = await pickWallReady(splitRoom);
    const v0 = await verts(w.room);
    await app.page.click('[data-selection-action="split-wall"]');
    await app.page.waitForSelector('#splitInput', { state: 'visible' });
    await app.page.fill('#splitInputField', '20');
    await app.page.press('#splitInputField', 'Enter');
    assert.equal(await verts(w.room), v0, 'меньше 100 мм — не делит');
    await app.page.press('#splitInputField', 'Escape');
    await app.page.waitForSelector('#splitInput', { state: 'hidden' });
    assert.equal(await verts(w.room), v0);
  });

  it('без ошибок в консоли', () => { assert.deepEqual(app.errors, []); });
});
