// Сквозная шкала 1–9 и локальное восстановление последнего этапа проекта.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { openNew, startApp } from './helpers.mjs';

describe('единый маршрут дома', () => {
  let app;

  before(async () => {
    app = await startApp();
    await openNew(app.page);
  });

  after(async () => { await app?.close(); });

  it('показывает девять статусов, продолжение и вертикальную навигацию', async () => {
    const { page } = app;
    await page.click('#projectHomeProgram');
    await page.waitForSelector('#projectRoutePanel:not([hidden])');
    const initial = await page.evaluate(() => {
      const nav = document.querySelector('.home-system-nav');
      const tabs = [...nav.querySelectorAll('[role="tab"]')];
      return {
        ids: tabs.map((tab) => tab.dataset.homeView),
        statuses: tabs.map((tab) => tab.dataset.status),
        columns: getComputedStyle(nav).gridTemplateColumns.split(' ').length,
        progress: document.querySelector('.home-workflow-progress')?.textContent,
        continueText: document.querySelector('.home-workflow-continue')?.textContent,
      };
    });
    assert.deepEqual(initial.ids, [
      'site', 'program', 'flows', 'engineering', 'circulation',
      'climate', 'review', 'envelope', 'deliverables',
    ]);
    assert.ok(initial.statuses.every((status) => ['checked', 'attention', 'blocked', 'unknown'].includes(status)));
    assert.equal(initial.columns, 1);
    assert.match(initial.progress, /из 9/);
    assert.match(initial.continueText, /Далее/);
    assert.equal(await page.getAttribute('.home-workflow-continue', 'data-home-view'), 'program');
    await page.click('.home-workflow-continue');
    await page.waitForFunction(() => (
      document.querySelector('.home-system-nav [aria-current="page"]')?.dataset.homeView === 'program'
    ));

    await page.click('[data-home-view="site"]');
    await page.waitForFunction(() => (
      document.querySelector('.home-system-nav [aria-current="page"]')?.dataset.homeView === 'site'
    ));
    await page.keyboard.press('ArrowDown');
    await page.waitForFunction(() => (
      document.querySelector('.home-system-nav [aria-current="page"]')?.dataset.homeView === 'program'
    ));
    await page.keyboard.press('End');
    await page.waitForFunction(() => (
      document.querySelector('.home-system-nav [aria-current="page"]')?.dataset.homeView === 'deliverables'
    ));
    await page.keyboard.press('Home');
    await page.waitForFunction(() => (
      document.querySelector('.home-system-nav [aria-current="page"]')?.dataset.homeView === 'site'
    ));
    await page.keyboard.press('ArrowRight');
    await page.waitForFunction(() => (
      document.querySelector('.home-system-nav [aria-current="page"]')?.dataset.homeView === 'program'
    ));
    await page.keyboard.press('ArrowLeft');
    await page.waitForFunction(() => (
      document.querySelector('.home-system-nav [aria-current="page"]')?.dataset.homeView === 'site'
    ));
    assert.deepEqual(app.errors, []);
  });

  it('хранит последний этап отдельно для каждого проекта', async () => {
    const { page } = app;
    await page.evaluate(async () => {
      window.__workflowFirstProject = window.__kepler.state.project;
      window.__kepler.state.pid = 'workflow-project-a';
      const { renderProjectRoute } = await import('./ui/project-route.js');
      renderProjectRoute();
    });
    await page.click('[data-home-view="deliverables"]');
    await page.waitForFunction(() => (
      document.querySelector('.home-system-nav [aria-current="page"]')?.dataset.homeView === 'deliverables'
    ));
    await page.click('#projectRouteClose');

    await page.evaluate(async () => {
      const { createProject } = await import('./core/model.js');
      const { renderProjectRoute } = await import('./ui/project-route.js');
      window.__kepler.state.project = createProject('Второй проект');
      window.__kepler.state.pid = 'workflow-project-b';
      renderProjectRoute();
    });
    await page.click('#projectHomeProgram');
    assert.equal(await page.getAttribute('[data-home-view="site"]', 'aria-current'), 'page');
    await page.click('#projectRouteClose');

    await page.evaluate(async () => {
      const { renderProjectRoute } = await import('./ui/project-route.js');
      window.__kepler.state.project = window.__workflowFirstProject;
      window.__kepler.state.pid = 'workflow-project-a';
      renderProjectRoute();
    });
    await page.click('#projectHomeProgram');
    assert.equal(await page.getAttribute('[data-home-view="deliverables"]', 'aria-current'), 'page');
    assert.deepEqual(app.errors, []);
  });

  it('из общей проверки открывает листы и точный рабочий вид', async () => {
    const { page } = app;
    await page.click('[data-home-view="review"]');
    await page.waitForSelector('[data-home-review]');

    const sheets = page.locator('[data-home-review-item="deliverables:missing:sheets"] [data-home-review-action="open-finding-sheets"]');
    await sheets.click();
    await page.waitForSelector('#projectRoutePanel', { state: 'hidden' });
    assert.equal(await page.evaluate(() => window.__kepler.state.propsTab), 'sheets');

    await page.click('#projectHomeProgram');
    await page.waitForSelector('[data-home-review]');
    const site = page.locator('[data-home-review-item="deliverables:missing:site"] [data-home-review-action="open-finding-view"]');
    await site.click();
    await page.waitForSelector('#projectRoutePanel', { state: 'hidden' });
    await page.waitForFunction(() => window.__kepler.state.modeName === 'site');
    assert.deepEqual(app.errors, []);
  });

  it('после перезагрузки возвращает этап текущего проекта', async () => {
    const { page } = app;
    await page.evaluate(async () => {
      const { createRoom } = await import('./core/model.js');
      const { flushAutosave, mutate, PID_KEY } = await import('./ui/store.js');
      const { setScopedItem } = await import('./ui/storage-scope.js');
      const state = window.__kepler.state;
      state.pid = 'workflow-reload-project';
      setScopedItem(PID_KEY, state.pid);
      mutate(() => {
        if (!state.project.levels[0].rooms.length) {
          state.project.levels[0].rooms.push(createRoom('living', 0, 0, 4200, 3600));
        }
      });
      flushAutosave();
    });
    await page.click('#projectHomeProgram');
    await page.click('[data-home-view="envelope"]');
    await page.click('#projectRouteClose');
    await page.evaluate(async () => {
      const { flushAutosave } = await import('./ui/store.js');
      flushAutosave();
    });

    await page.reload();
    await page.waitForFunction(() => (
      window.__kepler?.state?.pid === 'workflow-reload-project'
      && window.__kepler.state.project?.levels?.[0]?.rooms?.length > 0
    ));
    if (await page.locator('#startContinue').isVisible()) await page.click('#startContinue');
    await page.click('#projectHomeProgram');
    assert.equal(await page.getAttribute('[data-home-view="envelope"]', 'aria-current'), 'page');
    assert.deepEqual(app.errors, []);
  });
});
