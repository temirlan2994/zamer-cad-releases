// e2e норм: сводка в панели замечаний «⚠» (не в свойствах), переход к
// комнате по клику, настройка нормы инсоляции на участке.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, openSample } from './helpers.mjs';

describe('нормы', () => {
  let app;
  before(async () => {
    app = await startApp({ issueGroups: 'all' });
    await openSample(app.page);
    await app.page.waitForFunction(() => (
      window.__kepler.state.analytics?.dirty === false
      && Boolean(window.__kepler.state.norms?.insolation)
      && Boolean(window.__kepler.state.issues)
    ));
  });
  after(async () => { await app?.close(); });

  it('в свойствах проекта блока норм нет; в панели «⚠» — инсоляция жилых комнат', async () => {
    const props = await app.page.textContent('#propsPanel');
    assert.doesNotMatch(props, /Инсоляция — |Площади, свет, высота/);
    assert.equal(await app.page.$$eval('#propsPanel .norm-list', (ns) => ns.length), 0);
    await app.page.click('#issuesBtn');
    assert.equal(await app.page.isVisible('#issuesPanel'), true);
    const text = await app.page.textContent('#issuesPanel');
    assert.match(text, /Инсоляция/);
    assert.match(text, /(южная|центральная|северная) зона/);
    const rows = await app.page.$$eval('#issuesPanel [data-issue-id^="insolation:sun:"] [data-goto]', (ns) => ns.length);
    assert.ok(rows >= 2, 'жилые комнаты образца в списке');
  });

  it('клик по комнате в списке выделяет её; свойства — без блока норм', async () => {
    await app.page.click('#issuesPanel [data-issue-id^="insolation:sun:"] [data-goto]');
    const sel = await app.page.evaluate(() => window.__kepler.state.selection);
    assert.equal(sel?.type, 'room');
    const props = await app.page.textContent('#propsPanel');
    assert.doesNotMatch(props, /Инсоляция:/);
    assert.equal(await app.page.isVisible('#issuesPanel'), true, 'на компьютере панель остаётся открытой');
    await app.page.keyboard.press('Escape');
    assert.equal(await app.page.isVisible('#issuesPanel'), false, 'Esc закрывает панель');
  });

  it('норма на участке: 20 ч не выполнить, пусто — снова по широте', async () => {
    await app.page.click('#modeSiteBtn');
    await app.page.click('[data-climate-location-link]');
    await app.page.click('[data-analysis-fold="norm"] > summary');
    await app.page.fill('#normHours', '20');
    await app.page.locator('#normHours').blur();
    await app.page.waitForFunction(() => window.__kepler.state.analytics?.dirty === false
      && window.__kepler.state.norms?.insolation?.norm?.hours === 20);
    let ok = await app.page.evaluate(() => window.__kepler.state.norms.insolation.ok);
    assert.equal(ok, false);
    assert.match(await app.page.textContent('#issuesPanel'), /не хватает/);
    assert.match(await app.page.getAttribute('#issuesBtn', 'class'), /\bwarn\b/);
    await app.page.fill('#normHours', '');
    await app.page.locator('#normHours').blur();
    await app.page.waitForFunction(() => window.__kepler.state.analytics?.dirty === false
      && window.__kepler.state.norms?.insolation?.norm?.hours === 1.5);
    const n = await app.page.evaluate(() => window.__kepler.state.norms.insolation.norm.hours);
    assert.equal(n, 1.5, 'Алматы — южная зона, 1,5 ч');
    await app.page.click('#projectRouteClose');
    await app.page.keyboard.press('Control+z'); // отмена тоже пересчитывает
    await app.page.waitForFunction(() => window.__kepler.state.analytics?.dirty === false
      && window.__kepler.state.norms?.insolation?.norm?.hours === 20);
    ok = await app.page.evaluate(() => window.__kepler.state.norms.insolation.norm.hours);
    assert.equal(ok, 20);
    await app.page.click('#modePlanBtn');
  });

  it('без ошибок в консоли', () => {
    assert.deepEqual(app.errors, []);
  });
});
