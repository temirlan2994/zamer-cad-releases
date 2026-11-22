// E2E «Маршрута проекта»: производные статусы, запуск инструментов,
// подтверждение исходных данных и карта возможностей участка.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { openNew, openRouteFromOverview, openRouteView, startApp } from './helpers.mjs';

// В 0.4.5 этапы участка открываются из нижней палитры: кнопка «Участок» →
// меню задач (`[data-route-task]` с `data-route-task-stage`) → панель задачи.
// Список этапов внутри панели убран, в панели показывается одна задача.
async function openTask(page, stageId, taskId) {
  await openRouteView(page, 'site', { task: taskId });
  await page.waitForSelector(`#projectRouteBody .project-route-task[data-route-task="${taskId}"]`);
  assert.equal(await page.getAttribute(`#projectRouteHover [data-route-task="${taskId}"]`, 'data-route-task-stage'), stageId,
    `задача ${taskId} относится к этапу ${stageId}`);
  assert.equal(await page.getAttribute('#projectRouteSteps [data-route-view="site"]', 'aria-current'), 'page',
    'текущий этап палитры — «Участок»');
}

// Статусы задач этапа читаются из меню палитры: этап готов, когда готовы все его задачи.
async function stageTaskStatuses(page, stageId) {
  await page.click('#projectRouteSteps [data-route-view="site"]');
  await page.waitForSelector('#projectRouteHover:not([hidden])');
  const statuses = await page.$$eval(`#projectRouteHover [data-route-task-stage="${stageId}"]`,
    (nodes) => nodes.map((node) => node.dataset.routeStatus));
  await page.click('#projectRouteSteps [data-route-view="site"]');
  await page.waitForSelector('#projectRouteHover', { state: 'hidden' });
  return statuses;
}

async function taskStatusByControl(page, selector) {
  return page.$eval(selector, (node) => node.closest('.project-route-task')?.dataset.status || null);
}

async function seedUsableSite(page) {
  await page.evaluate(async () => {
    const { mutate } = await import('./ui/store.js');
    mutate(() => {
      const site = window.__kepler.state.project.site;
      site.boundary = [
        { x: 0, y: 0 }, { x: 60_000, y: 0 },
        { x: 60_000, y: 50_000 }, { x: 0, y: 50_000 },
      ];
      site.roads = [{
        id: 'route-test-road', width: 3500,
        points: [{ x: -6000, y: 25_000 }, { x: 0, y: 25_000 }],
      }];
      site.entry = { x: 0, y: 25_000 };
      site.neighbors = [];
      site.planning.contextReviewed = true;
      site.planning.flatTerrain = true;
      site.planning.constraintsConfirmed = {
        setbackBoundary: site.setbackBoundary,
        setbackNeighbor: site.setbackNeighbor,
      };
    });
  });
  await page.waitForSelector('[data-route-view="site"]', { state: 'attached' });
}

describe('маршрут подготовки участка', () => {
  let app;

  before(async () => {
    app = await startApp();
    await openNew(app.page);
  });

  after(async () => { await app?.close(); });

  it('открывает этап и запускает существующий инструмент участка', async () => {
    const { page } = app;
    assert.equal(await page.isVisible('#projectRoute'), true);
    assert.equal(await page.locator('#projectRouteSteps button').count(), 9);
    assert.equal(await page.isVisible('#projectRoutePanel'), false);

    await openTask(page, 'foundation', 'boundary');
    // Заголовок панели — выбранная задача, «хлебные крошки» — этап аналитики.
    assert.equal(await page.textContent('#projectRoutePanelTitle'), 'Граница участка');
    assert.match(await page.textContent('#projectRoutePanelKicker'), /^Аналитика \/ Этап 1 из 9$/);
    await page.click('#projectRouteClose');
    await page.waitForFunction(() => document.getElementById('projectRoutePanel')?.hidden === true);
    assert.equal(await page.evaluate(() => document.activeElement?.dataset?.routeView), 'site',
      'после пересоздания панели фокус возвращается на актуальную кнопку этапа');

    await openTask(page, 'foundation', 'boundary');
    await page.click('#projectRouteBody [data-route-tool="boundary"]');

    await page.waitForFunction(() => window.__kepler.state.tool?.kind === 'draw');
    assert.deepEqual(await page.evaluate(() => ({
      mode: window.__kepler.state.modeName,
      kind: window.__kepler.state.tool?.kind,
      target: window.__kepler.state.tool?.target,
      panelHidden: document.getElementById('projectRoutePanel').hidden,
    })), { mode: 'site', kind: 'draw', target: 'boundary', panelHidden: true });
    await page.keyboard.press('Escape');
  });

  it('явное решение меняет статус, а подтверждение отступов сбрасывается после их изменения', async () => {
    const { page } = app;
    await page.evaluate(async () => {
      const { mutate } = await import('./ui/store.js');
      mutate(() => {
        window.__kepler.state.project.site.boundary = [
          { x: 0, y: 0 }, { x: 60_000, y: 0 },
          { x: 60_000, y: 50_000 }, { x: 0, y: 50_000 },
        ];
      });
    });
    await openTask(page, 'foundation', 'underlay');
    const without = '[data-route-confirm="withoutUnderlay"]';
    assert.equal(await taskStatusByControl(page, without), 'unknown');
    await page.check(without);
    await page.waitForFunction(() => window.__kepler.state.project.site.planning.withoutUnderlay === true);
    await page.waitForFunction(() => document.activeElement?.dataset?.routeConfirm === 'withoutUnderlay');
    assert.equal(await page.isChecked(without), true, 'явное решение хранится в модели проекта');
    assert.equal(await taskStatusByControl(page, without), 'done');
    assert.deepEqual(await stageTaskStatuses(page, 'foundation'), ['done', 'done'],
      'этап «Съёмка и границы» готов: граница есть, подложка явно не нужна');

    await openTask(page, 'constraints', 'constraints');
    const constraints = '[data-route-confirm="constraintsConfirmed"]';
    await page.check(constraints);
    await page.waitForFunction(() => Boolean(window.__kepler.state.project.site.planning.constraintsConfirmed));
    assert.equal(await taskStatusByControl(page, constraints), 'done');

    await page.evaluate(async () => {
      const { mutate } = await import('./ui/store.js');
      mutate(() => { window.__kepler.state.project.site.setbackBoundary += 500; });
    });
    await page.waitForFunction(() => document.querySelector('[data-route-confirm="constraintsConfirmed"]')?.checked === false);
    assert.equal(await taskStatusByControl(page, constraints), 'unknown');
    assert.equal(await page.evaluate(() => window.__kepler.state.project.site.planning.constraintsConfirmed.setbackBoundary
      !== window.__kepler.state.project.site.setbackBoundary), true, 'сохранённое подтверждение не выдаётся за актуальное');
  });

  it('не выдаёт пустой участок за построенную карту возможностей', async () => {
    const { page } = app;
    const previousBoundary = await page.evaluate(async () => {
      const { mutate } = await import('./ui/store.js');
      const site = window.__kepler.state.project.site;
      const boundary = structuredClone(site.boundary);
      mutate(() => { site.boundary = null; });
      return boundary;
    });
    await openTask(page, 'constraints', 'zone');
    await page.fill('[data-route-footprint="width"]', '10');
    await page.fill('[data-route-footprint="depth"]', '8');
    await page.click('[data-route-action="save-footprint"]');
    await page.click('[data-route-action="toggle-opportunity"]');
    await page.waitForFunction(() => window.__kepler.state.siteOpportunity?.result);

    assert.equal(await page.isVisible('#projectRoutePanel'), true, 'панель остаётся открытой для исправления исходных данных');
    assert.equal(await page.evaluate(() => window.__kepler.state.siteOpportunity.on), false);
    assert.equal(await page.getAttribute('[data-route-action="toggle-opportunity"]', 'aria-checked'), 'false');
    assert.match(await page.textContent('.project-route-opportunity-result'), /Недостаточно исходных данных/);

    await page.evaluate(async (boundary) => {
      const { mutate } = await import('./ui/store.js');
      mutate(() => { window.__kepler.state.project.site.boundary = boundary; });
    }, previousBoundary);
  });

  it('показывает рабочее пятно и при уже включённом слое', async () => {
    const { page } = app;
    if (await page.isVisible('#projectRoutePanel')) await page.click('#projectRouteClose');
    await page.click('#modePlanBtn');
    await page.evaluate(() => { window.__kepler.state.project.site.showBuildZone = true; });
    await openTask(page, 'constraints', 'zone');
    await page.click('[data-route-action="show-zone"]');
    await page.waitForFunction(() => window.__kepler.state.modeName === 'site');
    assert.equal(await page.isHidden('#projectRoutePanel'), true);
  });

  it('сохраняет проверочный габарит и рисует объяснимую карту возможностей', async () => {
    const { page } = app;
    await seedUsableSite(page);
    await page.evaluate(async () => {
      const { mutate } = await import('./ui/store.js');
      mutate(() => {
        window.__kepler.state.project.site.neighbors.push({
          id: 'route-neighbor', x: 70_000, y: 25_000,
          w: 8000, h: 8000, rot: 0, height: 6000,
        });
      });
    });
    await openTask(page, 'access', 'neighbor');
    const context = '[data-route-confirm="contextReviewed"]';
    await page.waitForFunction((selector) => document.querySelector(selector)?.checked === false, context);
    assert.equal(await taskStatusByControl(page, context), 'unknown', 'изменение соседей сбрасывает подтверждение окружения');
    await page.check(context);
    await page.waitForFunction((selector) => document.querySelector(selector)?.checked === true, context);
    assert.equal(await taskStatusByControl(page, context), 'done');

    if (await page.isVisible('#projectRoutePanel')) await page.click('#projectRouteClose');
    await page.click('#modePlanBtn');
    await openTask(page, 'constraints', 'zone');

    await page.fill('[data-route-footprint="width"]', '10');
    await page.fill('[data-route-footprint="depth"]', '8');
    await page.fill('[data-route-footprint="rotation"]', '15');
    await page.click('[data-route-action="save-footprint"]');
    await page.waitForFunction(() => document.activeElement?.dataset?.routeAction === 'save-footprint');
    assert.deepEqual(await page.evaluate(() => window.__kepler.state.project.site.planning.referenceFootprint), {
      width: 10_000, depth: 8000, rotation: 15,
    });

    await page.click('[data-route-action="toggle-opportunity"]');
    await page.waitForFunction(() => window.__kepler.state.modeName === 'site');
    await page.waitForFunction(() => window.__kepler.state.siteOpportunity?.result?.cells?.length > 0);
    await page.waitForFunction(() => window.__kepler.state._siteOpportunityUI?.active === true);
    const result = await page.evaluate(() => ({
      on: window.__kepler.state.siteOpportunity.on,
      status: window.__kepler.state.siteOpportunity.result.status,
      candidates: window.__kepler.state.siteOpportunity.result.candidates.length,
      cells: window.__kepler.state.siteOpportunity.result.cells.length,
      visibleCells: window.__kepler.state._siteOpportunityUI.visibleCellCount,
      drawnCandidates: window.__kepler.state._siteOpportunityUI.drawnCandidateCount,
    }));
    assert.equal(result.on, true);
    assert.match(result.status, /^(ready|partial)$/);
    assert.ok(result.cells > 0 && result.visibleCells > 0, `ячейки ${JSON.stringify(result)}`);
    assert.ok(result.candidates > 0 && result.drawnCandidates > 0, `кандидаты ${JSON.stringify(result)}`);
    assert.equal(await page.isVisible('#siteOpportunityLegend'), true, 'легенда видна вместе с картой');
    await openTask(page, 'constraints', 'zone');
    assert.equal(await page.getAttribute('[data-route-action="toggle-opportunity"]', 'aria-checked'), 'true');
    const cache = await page.evaluate(async () => {
      const { mutate } = await import('./ui/store.js');
      const before = window.__kepler.state.siteOpportunity.result;
      mutate(() => { window.__kepler.state.project.name = 'Проверка кеша маршрута'; });
      const afterUnrelated = window.__kepler.state.siteOpportunity.result;
      mutate(() => { window.__kepler.state.project.site.entry.x += 250; });
      return {
        reusedForUnrelatedChange: before === afterUnrelated,
        refreshedForSiteChange: afterUnrelated !== window.__kepler.state.siteOpportunity.result,
      };
    });
    assert.deepEqual(cache, { reusedForUnrelatedChange: true, refreshedForSiteChange: true });
    await page.click('[data-route-action="toggle-opportunity"]');
    await page.waitForFunction(() => document.activeElement?.dataset?.routeAction === 'toggle-opportunity');
    assert.equal(await page.isHidden('#siteOpportunityLegend'), true, 'легенда скрывается вместе с картой');
    assert.deepEqual(app.errors, []);
  });
});

describe('маршрут проекта на телефоне', () => {
  let app;

  before(async () => {
    app = await startApp({ mobile: true });
    await openNew(app.page);
  });

  after(async () => { await app?.close(); });

  it('открывается нижним листом и освобождает холст при запуске инструмента', async () => {
    const { page } = app;
    const checkSheet = async (label) => {
      const [viewport, panel] = await Promise.all([
        page.evaluate(() => ({ width: innerWidth, height: innerHeight })),
        page.locator('#projectRoutePanel').boundingBox(),
      ]);
      assert.ok(panel.x >= -1 && panel.x + panel.width <= viewport.width + 1, `${label}: лист по ширине: ${JSON.stringify(panel)}`);
      assert.ok(panel.y >= 0 && panel.y + panel.height <= viewport.height + 1, `${label}: лист в окне: ${JSON.stringify(panel)}`);
      assert.ok(panel.y > viewport.height * 0.15, `${label}: нижний лист не перекрывает весь экран`);
    };
    await page.tap('#projectHomeProgram');
    await page.waitForSelector('#projectRouteHover:not([hidden])');
    assert.equal(await page.isHidden('#projectRoutePanel'), true, 'первая кнопка сначала открывает меню этапов');
    await page.tap('#projectHomeProgram');
    await page.waitForSelector('#projectRouteHover', { state: 'hidden' });
    await openRouteFromOverview(page, 'site', { mobile: true });
    await checkSheet('кнопка аналитики');

    // В 0.4.5 панель показывает одну задачу; границу открываем из меню палитры.
    await openRouteView(page, 'site', { mobile: true, task: 'boundary' });
    await page.waitForSelector('#projectRouteBody .project-route-task[data-route-task="boundary"]');
    await checkSheet('задача «Граница участка»');

    await page.tap('#projectRouteBody [data-route-tool="boundary"]');
    await page.waitForFunction(() => window.__kepler.state.tool?.target === 'boundary');
    assert.deepEqual(await page.evaluate(() => ({
      mode: window.__kepler.state.modeName,
      tool: window.__kepler.state.tool?.kind,
      hidden: document.getElementById('projectRoutePanel').hidden,
      bodyOpen: document.body.classList.contains('project-route-open'),
    })), { mode: 'site', tool: 'draw', hidden: true, bodyOpen: false });
    assert.deepEqual(app.errors, []);
  });
});
