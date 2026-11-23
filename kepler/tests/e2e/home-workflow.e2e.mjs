// Сквозная шкала 1–9 и локальное восстановление последнего этапа проекта.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { openNew, openRouteView, startApp } from './helpers.mjs';

async function openReviewMissionList(page, mission) {
  const tab = page.locator(`[data-home-review] [data-analysis-mission="${mission}"]`);
  if (await tab.getAttribute('aria-current') !== 'step') await tab.click();
  const disclosure = page.locator(`[data-analysis-mission-panel="${mission}"] .analysis-disclosure`).first();
  if (await disclosure.getAttribute('open') === null) await disclosure.locator('summary').click();
}

describe('единый маршрут дома', () => {
  let app;

  before(async () => {
    app = await startApp();
    await openNew(app.page);
  });

  after(async () => { await app?.close(); });

  // С 0.4.5 этапы переключаются палитрой внизу: кнопка этапа → меню → окно.
  // Вертикальной ленты и кнопки «Далее» внутри окна больше нет.
  it('палитра показывает девять статусов и навигацию с клавиатуры', async () => {
    const { page } = app;
    const steps = '#projectRouteSteps';
    const initial = await page.evaluate((selector) => {
      const tabs = [...document.querySelectorAll(`${selector} [role="tab"]`)];
      return {
        ids: tabs.map((tab) => tab.dataset.routeView),
        statuses: tabs.map((tab) => tab.dataset.status),
      };
    }, steps);
    assert.deepEqual(initial.ids, [
      'site', 'program', 'flows', 'engineering', 'circulation',
      'climate', 'review', 'envelope', 'deliverables',
    ]);
    assert.ok(initial.statuses.every((status) => ['checked', 'attention', 'blocked', 'unknown'].includes(status)));
    assert.equal(await page.locator('#projectHomeProgram').count(), 0);

    await openRouteView(page, 'program');
    await page.waitForFunction(() => (
      document.querySelector('#projectRouteSteps [aria-current="page"]')?.dataset.routeView === 'program'
    ));
    const focused = () => page.evaluate(() => document.activeElement?.dataset?.routeView || null);
    await page.focus(`${steps} [data-route-view="site"]`);
    await page.keyboard.press('ArrowRight');
    assert.equal(await focused(), 'program');
    await page.keyboard.press('End');
    assert.equal(await focused(), 'deliverables');
    await page.keyboard.press('Home');
    assert.equal(await focused(), 'site');
    await page.keyboard.press('ArrowLeft');
    assert.equal(await focused(), 'deliverables');
    await page.keyboard.press('Escape');
    assert.deepEqual(app.errors, []);
  });

  it('после закрытия не оставляет этап выбранным при смене проекта', async () => {
    const { page } = app;
    await page.evaluate(async () => {
      window.__workflowFirstProject = window.__kepler.state.project;
      window.__kepler.state.pid = 'workflow-project-a';
      const { renderProjectRoute } = await import('./ui/project-route.js');
      renderProjectRoute();
    });
    await openRouteView(page, 'deliverables');
    await page.waitForFunction(() => (
      document.querySelector('#projectRouteSteps [aria-current="page"]')?.dataset.routeView === 'deliverables'
    ));
    await page.click('#projectRouteClose');
    await page.waitForSelector('#projectRoutePanel', { state: 'hidden' });
    assert.equal(await page.locator('#projectRouteSteps [aria-selected="true"]').count(), 0);
    assert.equal(await page.locator('#projectRouteSteps [aria-current]').count(), 0);

    await page.evaluate(async () => {
      const { createProject } = await import('./core/model.js');
      const { renderProjectRoute } = await import('./ui/project-route.js');
      window.__kepler.state.project = createProject('Второй проект');
      window.__kepler.state.pid = 'workflow-project-b';
      renderProjectRoute();
    });
    assert.equal(await page.isHidden('#projectRoutePanel'), true);
    assert.equal(await page.locator('#projectRouteSteps [aria-selected="true"]').count(), 0);

    await page.evaluate(async () => {
      const { renderProjectRoute } = await import('./ui/project-route.js');
      window.__kepler.state.project = window.__workflowFirstProject;
      window.__kepler.state.pid = 'workflow-project-a';
      renderProjectRoute();
    });
    assert.equal(await page.isHidden('#projectRoutePanel'), true);
    assert.equal(await page.locator('#projectRouteSteps [aria-selected="true"]').count(), 0);
    await openRouteView(page, 'deliverables');
    assert.equal(await page.getAttribute('#projectRouteSteps [data-route-view="deliverables"]', 'aria-current'), 'page');
    await page.click('#projectRouteClose');
    assert.deepEqual(app.errors, []);
  });

  it('из общей проверки открывает листы и точный рабочий вид', async () => {
    const { page } = app;
    await openRouteView(page, 'review');
    await page.waitForSelector('[data-home-review]');
    await openReviewMissionList(page, 'unknowns');

    const sheets = page.locator('[data-home-review-item="deliverables:missing:sheets"] [data-home-review-action="open-finding-sheets"]');
    await sheets.click();
    await page.waitForSelector('#projectRoutePanel', { state: 'hidden' });
    assert.equal(await page.evaluate(() => window.__kepler.state.propsTab), 'sheets');

    await openRouteView(page, 'review');
    await page.waitForSelector('[data-home-review]');
    await openReviewMissionList(page, 'unknowns');
    const site = page.locator('[data-home-review-item="deliverables:missing:site"] [data-home-review-action="open-finding-view"]');
    await site.click();
    await page.waitForSelector('#projectRoutePanel', { state: 'hidden' });
    await page.waitForFunction(() => window.__kepler.state.modeName === 'site');
    assert.deepEqual(app.errors, []);
  });

  it('после перезагрузки не отмечает закрытое окно как выбранное', async () => {
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
    await openRouteView(page, 'envelope');
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
    assert.equal(await page.isHidden('#projectRoutePanel'), true);
    assert.equal(await page.isHidden('#projectRouteHover'), true);
    assert.equal(await page.locator('#projectRouteSteps [aria-selected="true"]').count(), 0);
    assert.equal(await page.locator('#projectRouteSteps [aria-current]').count(), 0);
    await openRouteView(page, 'envelope');
    assert.equal(await page.textContent('#projectRoutePanelTitle'), 'Объём и фасады');
    assert.deepEqual(app.errors, []);
  });
});
