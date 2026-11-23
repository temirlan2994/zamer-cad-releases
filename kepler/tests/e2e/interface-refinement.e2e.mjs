import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { openSample, startApp } from './helpers.mjs';

describe('компактная аналитика и управляемые вкладки', () => {
  let app;

  before(async () => {
    app = await startApp({ width: 1360, height: 820 });
    await openSample(app.page);
  });

  after(async () => { await app?.close(); });

  it('показывает нижнюю палитру статусов и открывает одну задачу участка', async () => {
    const { page } = app;
    const dock = await page.locator('#projectRoute .project-route-bar').boundingBox();
    assert.ok(dock.y > 820 * 0.75, `палитра внизу: ${JSON.stringify(dock)}`);
    assert.equal(await page.locator('#projectRouteSteps [data-route-view]').count(), 9);
    assert.equal(await page.locator('#projectRouteSteps [data-route-view] > span:visible').count(), 0);
    assert.equal(await page.locator('#projectHomeProgram').count(), 0, 'дублирующей кнопки «Аналитика» нет');

    const hover = page.locator('#projectRouteHover');
    await page.click('[data-route-view="site"]');
    await hover.waitFor({ state: 'visible' });
    assert.equal(await page.isHidden('#projectRoutePanel'), true, 'первый клик открывает только меню');
    assert.equal(await page.getAttribute('[data-route-view="site"]', 'aria-expanded'), 'true');
    await page.keyboard.press('Escape');
    await hover.waitFor({ state: 'hidden' });
    assert.equal(await page.getAttribute('[data-route-view="site"]', 'aria-expanded'), 'false');
    await page.click('[data-route-view="site"]');
    await hover.waitFor({ state: 'visible' });
    const labels = await hover.locator('[data-route-task] span').allTextContents();
    assert.ok(labels.some((label) => /Топосъёмка/.test(label)));
    assert.ok(labels.some((label) => /Граница/.test(label)));
    assert.ok(labels.some((label) => /Дорога/.test(label)));
    assert.ok(labels.some((label) => /Соседние/.test(label)));

    await hover.locator('[data-route-task="boundary"]').click();
    await page.locator('#projectRoutePanel:not([hidden])').waitFor();
    assert.equal(await page.textContent('#projectRoutePanelTitle'), 'Граница участка');
    assert.equal(await page.locator('#projectRouteBody .project-route-task').count(), 1);
    assert.equal(await page.locator('#projectRouteBody .home-system-nav').count(), 0);
  });

  it('маленькое окно перетаскивается за заголовок и закрывается крестиком', async () => {
    const { page } = app;
    const head = page.locator('.project-route-panel-head');
    const before = await page.locator('#projectRoutePanel').boundingBox();
    const grip = await head.boundingBox();
    await page.mouse.move(grip.x + 70, grip.y + 20);
    await page.mouse.down();
    await page.mouse.move(grip.x + 170, grip.y + 55, { steps: 4 });
    await page.mouse.up();
    const afterMove = await page.locator('#projectRoutePanel').boundingBox();
    assert.ok(afterMove.x > before.x + 70, `окно сдвинулось: ${before.x} → ${afterMove.x}`);
    await page.click('#projectRouteClose');
    await page.locator('#projectRoutePanel').waitFor({ state: 'hidden' });
    await page.waitForTimeout(200);
    assert.equal(await page.isHidden('#projectRouteHover'), true);
    assert.equal(await page.locator('#projectRouteSteps .active').count(), 0);
    assert.equal(await page.locator('#projectRouteSteps [aria-current]').count(), 0);
    assert.equal(await page.locator('#projectRouteSteps [aria-selected="true"]').count(), 0);
    assert.equal(await page.locator('#projectRouteSteps [aria-expanded="true"]').count(), 0);
    assert.equal(await page.evaluate(() => document.activeElement?.dataset?.routeView), 'site',
      'фокус вернулся без автооткрытия меню');

    await page.click('[data-route-view="flows"]');
    await page.click('#projectRouteHover [data-route-hover-view="flows"]');
    await page.locator('#projectRoutePanel:not([hidden])').waitFor();
    await page.keyboard.press('Escape');
    await page.locator('#projectRoutePanel').waitFor({ state: 'hidden' });
    await page.waitForTimeout(200);
    assert.equal(await page.isHidden('#projectRouteHover'), true);
    assert.equal(await page.locator('#projectRouteSteps .active').count(), 0);
    assert.equal(await page.locator('#projectRouteSteps [aria-selected="true"]').count(), 0);
    assert.equal(await page.evaluate(() => document.activeElement?.dataset?.routeView), 'flows');

    await page.click('[data-route-view="program"]');
    await page.click('#projectRouteHover [data-route-hover-mission="rooms"]');
    await page.locator('#projectRoutePanel:not([hidden])').waitFor();
    assert.equal(await page.getAttribute('[data-home-program] [data-analysis-mission="rooms"]', 'aria-current'), 'step',
      'пункт «Комнаты» открывает сразу нужный шаг');
    assert.equal(await page.locator('[data-analysis-mission-panel="rooms"]:not([hidden])').count(), 1);
    await page.click('#projectRouteClose');
  });

  it('вкладки меняют порядок перетаскиванием и закрываются своим крестиком', async () => {
    const { page } = app;
    const landscape = page.locator('[data-workspace-view="landscape"]');
    const model = page.locator('[data-workspace-view="3d"]');
    await landscape.dragTo(model);
    const order = await page.locator('.wv-tabs [data-workspace-view]').evaluateAll((nodes) => nodes.map((node) => node.dataset.workspaceView));
    assert.ok(order.indexOf('landscape') < order.indexOf('3d'), order.join(', '));

    await landscape.hover();
    await landscape.locator('.wv-tab-x').click();
    await landscape.waitFor({ state: 'detached' });
    assert.deepEqual(app.errors, []);
  });

  it('первый жест только выбирает координационную ось, второй её двигает', async () => {
    const { page } = app;
    await page.click('#modePlanBtn');
    await page.evaluate(async () => {
      const { createGrid } = await import('./core/grid-axes.js');
      const { mutate } = await import('./ui/store.js');
      const { setPlanGridPref } = await import('./ui/plan-grids.js');
      const { requestDraw } = await import('./ui/view.js');
      setPlanGridPref({ on: true });
      mutate(() => { window.__kepler.state.project.grids = [createGrid({ kind: 'x', at: 0 }, [])]; });
      requestDraw();
    });
    await page.waitForFunction(() => window.__kepler.state._gridUI?.length === 1);
    const ui = await page.evaluate(() => {
      const grid = window.__kepler.state._gridUI[0];
      return { head: grid.heads[0], line: { x: (grid.A.x + grid.B.x) / 2, y: (grid.A.y + grid.B.y) / 2 } };
    });
    const canvas = await page.locator('#canvas').boundingBox();
    const head = { x: canvas.x + ui.head.x, y: canvas.y + ui.head.y };
    const line = { x: canvas.x + ui.line.x, y: canvas.y + ui.line.y };
    await page.mouse.move(head.x, head.y);
    await page.mouse.down();
    await page.mouse.move(head.x + 70, head.y + 35);
    await page.mouse.up();
    assert.equal(await page.evaluate(() => window.__kepler.state.project.grids[0].at), 0);
    assert.equal(await page.evaluate(() => window.__kepler.state.selection?.type), 'grid');

    await page.mouse.move(line.x, line.y);
    await page.mouse.down();
    await page.mouse.move(line.x + 70, line.y);
    await page.mouse.up();
    assert.notEqual(await page.evaluate(() => window.__kepler.state.project.grids[0].at), 0);
  });
});

describe('компактная аналитика на телефоне', () => {
  let app;
  before(async () => {
    app = await startApp({ mobile: true });
    await openSample(app.page);
  });
  after(async () => { await app?.close(); });

  it('остаётся нижней палитрой и не дублируется в шапке', async () => {
    const { page } = app;
    assert.equal(await page.locator('#projectHomeProgram').count(), 0);
    assert.equal(await page.locator('#projectRouteSteps [data-route-view]').count(), 9);
    const dock = await page.locator('#projectRoute .project-route-bar').boundingBox();
    assert.ok(dock.y > 844 * 0.7, JSON.stringify(dock));

    const menu = page.locator('#projectRouteHover');
    await page.tap('[data-route-view="engineering"]');
    await menu.waitFor({ state: 'visible' });
    assert.equal(await page.isHidden('#projectRoutePanel'), true, 'первый тап открывает меню этапа');
    await menu.locator('[data-route-hover-view="engineering"]').first().tap();
    await page.locator('#projectRoutePanel:not([hidden])').waitFor();
    assert.equal(await page.textContent('#projectRoutePanelTitle'), 'Инженерные связи');
    assert.equal(await menu.isHidden(), true);
    await page.tap('#projectRouteClose');
    await page.locator('#projectRoutePanel').waitFor({ state: 'hidden' });
    await page.waitForTimeout(200);
    assert.equal(await page.locator('#projectRouteSteps .active').count(), 0);
    assert.equal(await page.locator('#projectRouteSteps [aria-selected="true"]').count(), 0);
    assert.equal(await menu.isHidden(), true);

    await page.tap('[data-route-view="site"]');
    await menu.waitFor({ state: 'visible' });
    assert.equal(await page.isHidden('#projectRoutePanel'), true);
    await menu.locator('[data-route-task]').first().tap();
    const panel = page.locator('#projectRoutePanel:not([hidden])');
    await panel.waitFor();
    const box = await panel.boundingBox();
    assert.ok(box.x >= 0 && box.x + box.width <= 390, JSON.stringify(box));
    assert.equal(await page.locator('#projectRouteBody .project-route-task').count(), 1);
  });
});
