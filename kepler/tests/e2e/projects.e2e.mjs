// e2e панели «Проекты» (режим «в браузере»: IndexedDB).
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, openSample } from './helpers.mjs';

describe('проекты в браузере', () => {
  let app;
  before(async () => { app = await startApp(); await openSample(app.page); });
  after(async () => { await app?.close(); });

  it('сохранить версию → правка → вторая версия → открыть первую без отката имени', async () => {
    const { page } = app;
    await page.click('#projectsBtn');
    await page.waitForSelector('#projectsScreen:not([hidden]) #prjSave:not([disabled])');
    await page.waitForFunction(() => /браузере/.test(document.getElementById('projectsMode').textContent));
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
    assert.notEqual(name0, 'Дом v2');
    assert.equal(await page.evaluate(() => window.__kepler.state.project.name), 'Дом v2');
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

describe('проекты и отмена', () => {
  let app;
  before(async () => { app = await startApp(); await openSample(app.page); });
  after(async () => { await app?.close(); });

  it('Ctrl+Z после открытия другого проекта возвращает и содержимое, и привязку', async () => {
    const { page } = app;
    const pid = () => page.evaluate(() => window.__kepler.state.pid);
    const name = () => page.evaluate(() => window.__kepler.state.project.name);
    // Проект А — сохранён версией.
    await page.click('#projectsBtn');
    await page.waitForSelector('#projectsScreen:not([hidden]) #prjSave:not([disabled])');
    await page.click('#prjSave');
    await page.waitForSelector('.prj-row .prj-main small:has-text("версий: 1")');
    const pidA = await pid();
    const nameA = await name();
    await page.click('#projectsClose');
    // Проект Б — шаблон (другой проект, без привязки).
    await page.evaluate(() => window.__kepler.loadTemplate?.('two-storey'));
    // Открываем А из «Проектов», затем Ctrl+Z.
    await page.click('#projectsBtn');
    await page.waitForSelector('.prj-row [data-act="open"]');
    await page.click('.prj-row [data-act="open"]');
    await page.waitForFunction(() => document.getElementById('projectsScreen').hidden);
    assert.equal(await pid(), pidA);
    await page.keyboard.press('Control+z');
    assert.equal(await pid(), null, 'после отмены привязка к А снята — Б не должен записываться в А');
    assert.notEqual(await name(), nameA);
    assert.deepEqual(app.errors, []);
  });

  it('Ctrl+Z сразу после «Пример» не подменяет проект пустым', async () => {
    const { page } = app;
    await page.evaluate(() => window.__kepler.newProject?.());
    await page.evaluate(() => window.__kepler.loadSample?.());
    const rooms = () => page.evaluate(() => window.__kepler.state.project.rooms.length);
    assert.ok(await rooms() > 0);
    await page.keyboard.press('Control+z');
    assert.ok(await rooms() > 0, 'пример остался на месте');
  });

  it('окно «Проекты» не пропускает Ctrl+Z к открытому чертежу', async () => {
    const { page } = app;
    const before = await page.evaluate(() => window.__kepler.state.project.name);
    await page.evaluate(async () => {
      const store = await import('./ui/store.js');
      const { state } = await import('./ui/state.js');
      store.mutate(() => { state.project.name = 'Не менять под окном'; });
    });
    await page.waitForFunction(() => window.__kepler.state.project.name === 'Не менять под окном');
    await page.click('#projectsBtn');
    await page.waitForSelector('#projectsScreen:not([hidden])');
    await page.keyboard.press('Control+z');
    assert.equal(await page.evaluate(() => window.__kepler.state.project.name), 'Не менять под окном');
    await page.click('#projectsClose');
    await page.keyboard.press('Control+z');
    assert.equal(await page.evaluate(() => window.__kepler.state.project.name), before);
  });
});
