// e2e панели «Проекты» (режим «в браузере»: IndexedDB).
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, openSample } from './helpers.mjs';

describe('проекты в браузере', () => {
  let app;
  before(async () => { app = await startApp(); await openSample(app.page); });
  after(async () => { await app?.close(); });

  it('сохранить версию → правка → вторая версия → открыть первую', async () => {
    const { page } = app;
    await page.click('#projectsBtn');
    await page.waitForSelector('#projectsScreen:not([hidden]) #prjSave:not([disabled])');
    assert.match(await page.textContent('#projectsMode'), /браузере/);
    assert.equal(await page.isHidden('#prjTabShared'), true, 'общие — только в облаке');
    const name0 = await page.evaluate(() => window.__kepler.state.project.name);
    await page.fill('#prjNote', 'первая');
    await page.click('#prjSave');
    await page.waitForSelector('.prj-row .prj-main small:has-text("версий: 1")');

    await page.click('#projectsClose');
    await page.fill('#projectName', 'Дом v2');
    await page.press('#projectName', 'Enter');
    await page.dispatchEvent('#projectName', 'change');
    await page.waitForFunction(() => window.__kepler.state.project.name === 'Дом v2');
    await page.click('#projectsBtn');
    await page.click('#prjSave');
    await page.waitForSelector('.prj-row .prj-main small:has-text("версий: 2")');

    await page.click('[data-act="toggle"]');
    await page.waitForSelector('.prj-ver');
    await page.click('.prj-ver:last-child [data-act="open"]'); // самая старая версия
    await page.waitForFunction(() => document.getElementById('projectsScreen').hidden);
    assert.equal(await page.evaluate(() => window.__kepler.state.project.name), name0);
    assert.deepEqual(app.errors, []);
  });

  it('версии переживают перезагрузку страницы', async () => {
    const { page } = app;
    await page.waitForTimeout(700); // автосохранение (500 мс)
    await page.reload();
    await page.waitForFunction(() => Boolean(window.__kepler));
    await page.click('#projectsBtn');
    await page.waitForSelector('.prj-row .prj-main small:has-text("версий: 2")');
    page.once('dialog', (d) => d.accept());
    await page.click('[data-act="delete"]');
    await page.waitForSelector('#projectsList:has-text("Пока ничего не сохранено")');
  });
});
