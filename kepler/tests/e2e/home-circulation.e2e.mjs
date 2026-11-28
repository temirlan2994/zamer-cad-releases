// E2E этапа 5: геометрические маршруты внутри помещений.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { openNew, openRouteView, startApp } from './helpers.mjs';

// Этапы открываются из палитры внизу (интерфейс 0.4.5): кнопка этапа → пункт меню.
async function openCirculation(page, mobile = false) {
  await openRouteView(page, 'circulation', { mobile });
  await page.waitForFunction(() => (
    document.querySelector('#projectRoutePanelTitle')?.textContent === 'Движение и проходы'
  ));
}

async function openCirculationMission(page, id) {
  const section = page.locator(`[data-analysis-fold="${id}"]`);
  const mission = page.locator(`[data-analysis-mission="${id}"]`);
  if (await mission.count()) {
    if (await mission.getAttribute('aria-current') !== 'step') await mission.click();
  } else if (!await section.evaluate((node) => node.open)) {
    await section.locator('summary').first().click();
  }
  await page.waitForFunction((selector) => {
    const node = document.querySelector(selector);
    return Boolean(node?.open && !node.hidden);
  }, `[data-analysis-fold="${id}"]`);
}

async function waitAnchorFocus(page, end) {
  try { await page.waitForFunction((end) => document.activeElement?.dataset.circulationAnchor === end, end); }
  catch (error) {
    const focus = await page.evaluate(() => ({ tag: document.activeElement?.tagName, id: document.activeElement?.id, data: { ...document.activeElement?.dataset } }));
    throw new Error(`${error.message}; active control: ${JSON.stringify(focus)}`, { cause: error });
  }
}

describe('движение и проходы', () => {
  let app;
  let ids;

  before(async () => {
    app = await startApp();
    await openNew(app.page);
    ids = await app.page.evaluate(async () => {
      const {
        createItem, createOpening, createRoom,
      } = await import('./core/model.js');
      const { ensureLayoutBrief } = await import('./core/layout-brief.js');
      const { mutate } = await import('./ui/store.js');
      let result;
      mutate(() => {
        const project = window.__kepler.state.project;
        const entry = createRoom('entrance', 0, 0, 5000, 4000);
        const kitchen = createRoom('kitchen', 5100, 0, 5000, 4000);
        const portal = createOpening('door', entry.id, 1, 2000, 1200);
        const coat = createItem('coat-rack', 1000, 2000, 900, 450);
        const table = createItem('dining-table', 7600, 2000, 1600, 900);
        project.rooms = [entry, kitchen];
        project.openings = [portal];
        project.items = [coat, table];
        const brief = ensureLayoutBrief(project);
        brief.scenarioSelections = [{
          scenarioId: 'SCN015', enabled: true, mandatory: true,
          actorPersonIds: [], frequencyValue: 3, frequencyPeriod: 'day',
        }];
        brief.scenarioRouteBindings = [{
          scenarioId: 'SCN015', routeId: 'delivery_to_unpack', instanceId: 'main',
          from: { levelId: project.activeLevel, roomId: entry.id },
          to: { levelId: project.activeLevel, roomId: kitchen.id },
          actorPersonId: null, sourceRef: 'e2e',
        }];
        result = {
          portalId: portal.id,
          tableId: table.id,
        };
      });
      return result;
    });
  });

  after(async () => { await app?.close(); });

  it('не выдаёт привязку только к помещениям за точный маршрут', async () => {
    const { page } = app;
    await openCirculation(page);
    assert.equal(await page.getAttribute('#projectRouteSteps [data-route-view="circulation"]', 'aria-current'), 'page');
    assert.match(await page.textContent('.home-circulation-disclaimer'), /дискретный геометрический расчёт/i);
    const status = await page.getAttribute('.home-circulation-summary', 'data-status');
    assert.notEqual(status, 'clear', 'неизвестные точки маршрута не должны давать зелёный итог');
    assert.match(await page.textContent('.home-circulation-anchor'), /приблизительн/i);
  });

  it('сохраняет точные якоря и фокус после пересчёта', async () => {
    const { page } = app;
    await openCirculation(page);
    const from = '[data-circulation-anchor="from"][data-scenario-id="SCN015"][data-route-id="delivery_to_unpack"]';
    const to = '[data-circulation-anchor="to"][data-scenario-id="SCN015"][data-route-id="delivery_to_unpack"]';
    await openCirculationMission(page, 'circulation-anchors');

    await page.focus(from);
    await page.selectOption(from, `opening:${ids.portalId}`);
    await page.waitForFunction((openingId) => {
      const binding = window.__kepler.state.project.layoutBrief.scenarioRouteBindings
        .find((entry) => entry.scenarioId === 'SCN015' && entry.routeId === 'delivery_to_unpack');
      return binding?.from?.anchorType === 'opening' && binding.from.anchorId === openingId;
    }, ids.portalId);
    await waitAnchorFocus(page, 'from');

    await page.focus(to);
    await page.selectOption(to, `item:${ids.tableId}`);
    await page.waitForFunction((itemId) => {
      const binding = window.__kepler.state.project.layoutBrief.scenarioRouteBindings
        .find((entry) => entry.scenarioId === 'SCN015' && entry.routeId === 'delivery_to_unpack');
      return binding?.to?.anchorType === 'item' && binding.to.anchorId === itemId;
    }, ids.tableId);
    await waitAnchorFocus(page, 'to');

    const binding = await page.evaluate(() => structuredClone(
      window.__kepler.state.project.layoutBrief.scenarioRouteBindings
        .find((entry) => entry.scenarioId === 'SCN015' && entry.routeId === 'delivery_to_unpack'),
    ));
    assert.deepEqual(
      { type: binding.from.anchorType, id: binding.from.anchorId },
      { type: 'opening', id: ids.portalId },
    );
    assert.deepEqual(
      { type: binding.to.anchorType, id: binding.to.anchorId },
      { type: 'item', id: ids.tableId },
    );
    assert.notEqual(await page.getAttribute('.home-circulation-summary', 'data-status'), 'approximate');
  });

  it('пересчитывает профиль и включает единственный аналитический слой', async () => {
    const { page } = app;
    await openCirculation(page);
    await openCirculationMission(page, 'circulation-check');
    await page.click('[data-home-circulation-action="set-profile"][data-circulation-profile="1400"]');
    assert.equal(await page.evaluate(() => window.__kepler.state.homeCirculationOverlay.profileWidthMm), 1400);
    assert.match(await page.textContent('.home-circulation-summary'), /1.?400|1400/);
    await page.click('[data-home-circulation-action="set-profile"][data-circulation-profile="600"]');

    await page.evaluate(() => {
      window.__kepler.state.homeEngineeringOverlay = {
        on: true, result: { rooms: [] }, signature: 'e2e',
      };
    });
    await page.click('[data-home-circulation-action="toggle-overlay"]');
    await page.waitForFunction(() => window.__kepler.state._homeCirculationUI?.active === true);
    const state = await page.evaluate(() => ({
      circulation: window.__kepler.state.homeCirculationOverlay.on,
      engineering: window.__kepler.state.homeEngineeringOverlay.on,
      flows: window.__kepler.state.homeProgramOverlay.on,
      legendHidden: document.getElementById('homeCirculationLegend').hidden,
      panelHidden: document.getElementById('projectRoutePanel').hidden,
    }));
    assert.equal(state.circulation, true);
    assert.equal(state.engineering, false);
    assert.equal(state.flows, false);
    assert.equal(state.legendHidden, false);
    assert.equal(state.panelHidden, true);
    assert.deepEqual(app.errors, []);
  });
});

describe('движение на телефоне', () => {
  let app;

  before(async () => {
    app = await startApp({ mobile: true });
    await openNew(app.page);
  });

  after(async () => { await app?.close(); });

  it('открывается тапом и оставляет крупные цели управления', async () => {
    const { page } = app;
    await openCirculation(page, true);
    await page.waitForFunction(() => {
      const active = document.querySelector('#projectRouteSteps [data-route-view="circulation"]')?.getBoundingClientRect();
      const nav = document.querySelector('#projectRouteSteps')?.getBoundingClientRect();
      return Boolean(active && nav && active.left >= nav.left - 1 && active.right <= nav.right + 1);
    });
    await openCirculationMission(page, 'circulation-layers');
    const before = await page.getAttribute('[data-home-circulation-action="toggle-routes"]', 'aria-checked');
    await page.tap('[data-home-circulation-action="toggle-routes"]');
    assert.notEqual(await page.getAttribute('[data-home-circulation-action="toggle-routes"]', 'aria-checked'), before);
    const result = await page.evaluate(() => {
      // Кнопки палитры этапов (40 px) здесь не проверяются: их размер задаёт
      // общая палитра, а не этот этап.
      const selectors = [
                '.home-circulation-profile button',
        '.home-circulation-layer-controls button',
        '[data-circulation-width]',
      ];
      const nodes = selectors.flatMap((selector) => [...document.querySelectorAll(selector)])
        .filter((node) => node.getClientRects().length);
      const active = document.querySelector('#projectRouteSteps [data-route-view="circulation"]')?.getBoundingClientRect();
      const nav = document.querySelector('#projectRouteSteps')?.getBoundingClientRect();
      return {
        current: document.querySelector('#projectRouteSteps [aria-current="page"]')?.dataset.routeView,
        heights: nodes.map((node) => node.getBoundingClientRect().height),
        activeRect: active ? { left: active.left, right: active.right } : null,
        navRect: nav ? { left: nav.left, right: nav.right } : null,
        navScrollLeft: document.querySelector('#projectRouteSteps')?.scrollLeft ?? null,
        activeVisible: active && nav ? active.left >= nav.left - 1 && active.right <= nav.right + 1 : false,
      };
    });
    assert.equal(result.current, 'circulation');
    assert.ok(result.heights.length > 0);
    assert.ok(result.heights.every((height) => Math.round(height) >= 44), JSON.stringify(result));
    assert.equal(result.activeVisible, true, JSON.stringify(result));
    assert.deepEqual(app.errors, []);
  });
});
