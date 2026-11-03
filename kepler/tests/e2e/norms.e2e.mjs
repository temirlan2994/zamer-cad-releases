// e2e норм: сводка в свойствах проекта, блок комнаты, настройка нормы
// инсоляции на участке, переход к комнате по клику.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, openSample } from './helpers.mjs';

describe('нормы', () => {
  let app;
  before(async () => { app = await startApp(); await openSample(app.page); });
  after(async () => { await app?.close(); });

  it('сводка «Нормы» в свойствах проекта: инсоляция жилых комнат', async () => {
    const text = await app.page.textContent('#propsPanel');
    assert.match(text, /Нормы/);
    assert.match(text, /Инсоляция — (южная|центральная|северная) зона/);
    const rows = await app.page.$$eval('#propsPanel .norm-list [data-norm-room]', (ns) => ns.length);
    assert.ok(rows >= 2, 'жилые комнаты образца в списке');
  });

  it('клик по комнате в сводке выделяет её и показывает её нормы', async () => {
    await app.page.click('#propsPanel .norm-list [data-norm-room]');
    const sel = await app.page.evaluate(() => window.__kepler.state.selection);
    assert.equal(sel?.type, 'room');
    const text = await app.page.textContent('#propsPanel');
    assert.match(text, /Нормы/);
    assert.match(text, /Инсоляция:|Площадь .* м²/);
    await app.page.keyboard.press('Escape');
  });

  it('норма на участке: 20 ч не выполнить, пусто — снова по широте', async () => {
    await app.page.click('#modeSiteBtn');
    await app.page.fill('#normHours', '20');
    await app.page.locator('#normHours').blur();
    let ok = await app.page.evaluate(() => window.__kepler.state.norms.insolation.ok);
    assert.equal(ok, false);
    assert.match(await app.page.textContent('#propsPanel'), /не хватает/);
    await app.page.fill('#normHours', '');
    await app.page.locator('#normHours').blur();
    const n = await app.page.evaluate(() => window.__kepler.state.norms.insolation.norm.hours);
    assert.equal(n, 1.5, 'Алматы — южная зона, 1,5 ч');
    await app.page.keyboard.press('Control+z'); // отмена тоже пересчитывает
    ok = await app.page.evaluate(() => window.__kepler.state.norms.insolation.norm.hours);
    assert.equal(ok, 20);
    await app.page.click('#modePlanBtn');
  });

  it('без ошибок в консоли', () => {
    assert.deepEqual(app.errors, []);
  });
});
