// e2e панели «Проекты» (режим «в браузере»: IndexedDB).
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
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

it('снимок остаётся в истории одного проекта, переносится в файле и восстанавливается обратно', async () => {
  const app = await startApp();
  const { page } = app;
  try {
    await openSample(page);
    const editHeight = (value) => page.evaluate(async (height) => {
      const { tweak } = await import('./ui/store.js');
      tweak(() => { window.__kepler.state.project.levels[0].height = height; });
    }, value);
    const currentHeight = () => page.evaluate(() => window.__kepler.state.project.levels[0].height);
    const openVersions = () => page.click('#projectsBtn');
    await editHeight(2800);
    await openVersions();
    await page.fill('#prjNote', 'Исходная высота');
    await page.click('#prjSave');
    await page.waitForSelector('.prj-row .prj-main small:has-text("версий: 1")');
    await page.click('#projectsClose');
    await editHeight(3470);
    await openVersions();
    await page.click('#projectsList [data-act="toggle"]');
    await page.click('#projectsList [data-vid]');
    await page.waitForFunction(() => document.getElementById('projectsScreen').hidden);
    assert.equal(await currentHeight(), 2800);
    await openVersions();
    await page.waitForSelector('#projectRecoveryRows [data-act="restore-history"]');
    assert.equal(await page.locator('#projectsList .prj-row').count(), 1);
    const isolation = await page.evaluate(async () => {
      const { recoveryVersions } = await import('./ui/project-history.js');
      return (await recoveryVersions({ pid: window.__kepler.state.pid, scope: 'different-account' })).length;
    });
    assert.equal(isolation, 0);
    await page.click('#projectsClose');

    const [download] = await Promise.all([page.waitForEvent('download'), page.click('#saveBtn')]);
    const file = await download.path();
    const data = JSON.parse(await readFile(file, 'utf8'));
    assert.equal(data.levels[0].height, 2800);
    const version = data.projectHistory.entries.find((item) => /Снимок до/.test(item.note));
    assert.ok(version);
    assert.ok(data.projectHistory.entries.some((item) => item.note === 'Исходная высота'));
    assert.equal(version.snapshot.levels[0].height, 3470);
    assert.equal(version.snapshot.projectHistory, undefined);
    await page.locator('#fileInput').setInputFiles({
      name: 'Проверка.kepler.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(data)),
    });
    await page.waitForFunction(() => Boolean(window.__kepler.state.project.fileHistoryId) && !window.__kepler.state.pid);
    await page.reload();
    await page.waitForFunction(() => Boolean(window.__kepler?.state.project.fileHistoryId));
    await openVersions();
    await page.locator('#projectRecoveryRows .prj-ver').filter({ hasText: 'Снимок до открытия' }).getByRole('button').click();
    await page.waitForFunction(() => document.getElementById('projectsScreen').hidden);
    assert.equal(await currentHeight(), 3470);
    await openVersions();
    await page.getByText('Состояние перед восстановлением', { exact: false }).waitFor();
    assert.deepEqual(app.errors, []);
  } finally {
    await app.close();
  }
});

it('старые резервные карточки по умолчанию свёрнуты, их можно показать или найти', async () => {
  const app = await startApp();
  const { page } = app;
  try {
    await page.evaluate(async () => {
      const { createProject, serializeProject } = await import('./core/model.js');
      const { saveVersion } = await import('./core/storage.js');
      const { getLocalBackend } = await import('./ui/cloud.js');
      const { db, root } = await getLocalBackend();
      await saveVersion(db, root, serializeProject(createProject('K330')), { pid: 'home-330' });
      await saveVersion(db, root, serializeProject(createProject('K330 — резерв 23.11, 22:52')), { pid: 'existing-backup' });
    });
    await page.reload();
    await page.locator('#startRecentProjects [data-pid="home-330"]').waitFor();
    assert.equal(await page.locator('#startRecentProjects button').count(), 1);
    const toggle = page.locator('#startLegacyBackups');
    await toggle.click();
    await page.locator('#startRecentProjects [data-pid="existing-backup"]').waitFor();
    await toggle.click();
    assert.equal(await page.locator('#startRecentProjects [data-pid="existing-backup"]').count(), 0);
    await page.locator('#startProjectSearch').fill('резерв 23.11');
    await page.locator('#startRecentProjects [data-pid="existing-backup"]').waitFor();
    assert.deepEqual(app.errors, []);
  } finally {
    await app.close();
  }
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

for (const mobile of [false, true]) {
  it(`старый дом доступен со старта и из версий — ${mobile ? 'телефон' : 'компьютер'}`, async () => {
    const app = await startApp({ mobile });
    const { page } = app;
    const click = (locator) => mobile ? locator.tap() : locator.click();
    try {
      await page.evaluate(async () => {
        const { createProject, serializeProject } = await import('./core/model.js');
        const { getLocalBackend } = await import('./ui/cloud.js');
        const { saveVersion } = await import('./core/storage.js');
        const { db, root } = await getLocalBackend();
        const names = ['Дом у берёзы', 'Тихий сад', ...Array.from({ length: 6 }, (_, i) => `Корпус ${i + 1}`)];
        for (const [i, name] of names.entries()) {
          await saveVersion(db, root, serializeProject(createProject(name)), {
            pid: `archive-${i}`, now: new Date(2026, 0, i + 1),
          });
        }
      });
      await page.reload();
      const cards = page.locator('#startRecentProjects button');
      const search = page.getByRole('searchbox', { name: 'Найти сохранённый проект' });
      await cards.first().waitFor();
      assert.equal(await cards.count(), 6);
      assert.match(await page.textContent('#startRecentStatus'), /6 из 8/);
      await click(page.getByRole('button', { name: 'Показать ещё (2)' }));
      assert.equal(await cards.count(), 8);
      assert.equal(await page.evaluate(() => document.activeElement.dataset.pid), 'archive-1');
      await search.fill('несуществующий проект');
      assert.equal(await cards.count(), 0);
      assert.equal(await page.textContent('#startRecentStatus'), 'Совпадений нет');
      assert.equal(await page.isHidden('#startExamplesSection'), true);
      await click(page.getByRole('button', { name: 'Очистить поиск проектов' }));
      assert.equal(await cards.count(), 6);
      assert.equal(await search.evaluate((input) => input === document.activeElement), true);
      assert.equal(await page.isVisible('#startExamplesSection'), true);
      await search.fill('БЕРЕЗ  дом');
      assert.equal(await cards.count(), 1);
      await click(cards.first());
      await page.waitForFunction(() => window.__kepler.state.pid === 'archive-0');
      assert.equal(await page.evaluate(() => window.__kepler.state.project.name), 'Дом у берёзы');
      await page.reload();
      await page.waitForFunction(() => window.__kepler?.state.pid === 'archive-0' && document.getElementById('startScreen').hidden);
      if (mobile) {
        await click(page.locator('#moreBtn'));
        await click(page.locator('#mobileMore [data-more="projects"]'));
      } else {
        await click(page.locator('#projectsBtn'));
      }
      const versionsSearch = page.getByRole('searchbox', { name: 'Найти проект в списке' });
      await versionsSearch.waitFor();
      assert.equal(await page.evaluate(() => document.activeElement.id), 'projectsClose');
      await page.keyboard.press('Tab');
      assert.equal(await page.evaluate(() => Boolean(document.activeElement.closest('#projectsScreen'))), true);
      await versionsSearch.fill('сад');
      const row = page.locator('#projectsList .prj-row');
      assert.equal(await row.count(), 1);
      assert.equal(await row.locator('b').textContent(), 'Тихий сад');
      await click(row.locator('[data-act="toggle"]'));
      assert.equal(await row.locator('.prj-ver').count(), 1);
      await versionsSearch.press('Escape');
      assert.equal(await row.count(), 8);
      assert.equal(await page.isVisible('#projectsScreen'), true);
      await versionsSearch.press('Escape');
      assert.equal(await page.isHidden('#projectsScreen'), true);
      assert.equal(await page.evaluate(() => document.activeElement.id), mobile ? 'moreBtn' : 'projectsBtn');
      assert.deepEqual(app.errors, []);
    } finally {
      await app.close();
    }
  });
}
