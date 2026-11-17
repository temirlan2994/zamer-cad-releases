// Название проекта — один живой источник для шапки, вкладки, хранилища и файлов.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { openSample, startApp } from './helpers.mjs';

describe('единое название проекта', () => {
  let app;
  before(async () => { app = await startApp(); await openSample(app.page); });
  after(async () => { await app?.close(); });

  it('меняется сразу во всех местах и переживает перезагрузку', async () => {
    const { page } = app;
    assert.match(await page.locator('.topbar .brand').textContent(), /^kep•ler\s+3D/);

    await page.fill('#projectName', 'Дом у моря');
    assert.equal(await page.inputValue('#projectName'), 'Дом у моря');
    assert.equal(await page.evaluate(() => window.__kepler.state.project.name), 'Дом у моря');
    assert.equal(await page.title(), 'Дом у моря — kep•ler 3D');

    await page.press('#projectName', 'Enter');
    await page.waitForTimeout(700);
    await page.reload();
    await page.waitForFunction(() => Boolean(window.__kepler));
    assert.equal(await page.evaluate(() => window.__kepler.state.project.name), 'Дом у моря');
    assert.equal(await page.inputValue('#projectName'), 'Дом у моря');
    assert.equal(await page.title(), 'Дом у моря — kep•ler 3D');
    if (await page.isVisible('#startContinue')) await page.click('#startContinue');

    const download = page.waitForEvent('download');
    await page.click('#saveBtn');
    assert.equal((await download).suggestedFilename(), 'Дом-у-моря.kepler.json');
    assert.equal(await page.evaluate(async () => (
      await import('./ui/project-name.js')
    ).safeProjectFileName('Үй жобасы №1')), 'Үй-жобасы-1');
    assert.deepEqual(app.errors, []);
  });

  it('сразу обновляет текущую карточку, а пустое имя нормализует', async () => {
    const { page } = app;
    await page.click('#projectsBtn');
    await page.waitForSelector('#projectsScreen:not([hidden]) #prjSave:not([disabled])');
    await page.click('#prjSave');
    await page.waitForSelector('.prj-row.current');
    await page.click('#projectsClose');

    await page.fill('#projectName', 'Проект на холме');
    await page.click('#projectsBtn');
    await page.waitForSelector('.prj-row.current .prj-main b');
    assert.equal(await page.locator('.prj-row.current .prj-main b').textContent(), 'Проект на холме');
    await page.click('#projectsClose');

    await page.fill('#projectName', '');
    await page.press('#projectName', 'Enter');
    assert.equal(await page.inputValue('#projectName'), 'Без названия');
    assert.equal(await page.evaluate(() => window.__kepler.state.project.name), 'Без названия');
    assert.equal(await page.title(), 'Без названия — kep•ler 3D');

    await page.keyboard.press('Control+z');
    assert.equal(await page.evaluate(() => window.__kepler.state.project.name), 'Проект на холме');
    assert.equal(await page.title(), 'Проект на холме — kep•ler 3D');
    await page.keyboard.press('Control+Shift+z');
    assert.equal(await page.evaluate(() => window.__kepler.state.project.name), 'Без названия');
    assert.deepEqual(app.errors, []);
  });

  it('перерисовывает штамп уже открытого листа', async () => {
    const { page } = app;
    await page.evaluate(async () => {
      const sheets = await import('./ui/sheet.js');
      const view = await import('./ui/sheet-view.js');
      const spec = sheets.sheetList(window.__kepler.state.project)[0];
      view.openSheet(sheets.sheetKey(spec));
    });
    await page.waitForSelector('#sheetViewImg');
    await page.evaluate(() => { window.__sheetSrcBeforeRename = document.getElementById('sheetViewImg').src; });
    await page.fill('#projectName', 'Дом с новым именем');
    await page.waitForFunction(() => document.getElementById('sheetViewImg')?.src !== window.__sheetSrcBeforeRename);
    await page.press('#projectName', 'Enter');
    assert.deepEqual(app.errors, []);
  });

  it('не теряет cloud pid, выданный во время набора имени', async () => {
    const { page } = app;
    await page.evaluate(() => window.__kepler.newProject());
    await page.fill('#projectName', 'Новый облачный дом');
    await page.evaluate(() => { window.__kepler.state.pid = 'p-assigned-during-rename'; });
    await page.press('#projectName', 'Enter');
    await page.keyboard.press('Control+z');
    assert.equal(await page.evaluate(() => window.__kepler.state.pid), 'p-assigned-during-rename');
    assert.deepEqual(app.errors, []);
  });
});
