// E2E следующих этапов дома: функциональные зоны/маршруты и честный
// предварительный инженерный обзор.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { openNew, startApp } from './helpers.mjs';

const panel = '#projectRoutePanel';

async function openHomeView(page, view, title) {
  const open = await page.locator(panel).isVisible();
  if (!open) await page.click('#projectHomeProgram');
  await page.waitForSelector(`${panel}:not([hidden])`);
  if (view !== 'program') {
    await page.click(`[data-route-action="open-home-view"][data-home-view="${view}"]`);
  }
  await page.waitForFunction((expected) => (
    document.querySelector('#projectRoutePanelTitle')?.textContent === expected
  ), title);
}

describe('этапы зон, маршрутов и инженерии', () => {
  let app;
  let ids;

  before(async () => {
    app = await startApp();
    await openNew(app.page);
    ids = await app.page.evaluate(async () => {
      const { createOpening, createRoom } = await import('./core/model.js');
      const { ensureLayoutBrief } = await import('./core/layout-brief.js');
      const { mutate } = await import('./ui/store.js');
      let result;
      mutate(() => {
        const project = window.__kepler.state.project;
        const bedroom = createRoom('bedroom', 0, 0, 3000, 3000);
        const hall = createRoom('hall', 3100, 0, 3000, 3000);
        const bathroom = createRoom('bathroom', 6200, 0, 3000, 3000);
        const kitchen = createRoom('kitchen', 0, 3100, 3000, 3000);
        const dining = createRoom('dining', 3100, 3100, 3000, 3000);
        project.rooms = [bedroom, hall, bathroom, kitchen, dining];
        project.openings = [
          createOpening('door', bedroom.id, 1, 1500, 900),
          createOpening('door', hall.id, 1, 1500, 900),
        ];
        const brief = ensureLayoutBrief(project);
        brief.homeProgram = {
          confirmed: true,
          socialMode: 'separate',
          bedroomCount: 1,
          bathroomCount: 1,
          options: {
            guestBedroom: false, office: false, laundry: false, pantry: false,
            wardrobe: false, guestWc: false, garage: false, terrace: false,
          },
        };
        result = {
          levelId: project.activeLevel,
          bedroom: bedroom.id,
          hall: hall.id,
          bathroom: bathroom.id,
          kitchen: kitchen.id,
          dining: dining.id,
        };
      });
      return result;
    });
  });

  after(async () => { await app?.close(); });

  it('сохраняет явные сценарии, частоту и привязки после перерисовки', async () => {
    const { page } = app;
    await openHomeView(page, 'flows', 'Зоны и маршруты');
    assert.equal(await page.getAttribute('[data-home-view="flows"]', 'aria-current'), 'page');
    assert.match(await page.textContent('.home-flow-disclaimer'), /не измеряет точную траекторию/i);

    await page.click('.home-flow-scenario:has([data-home-flow-scenario="SCN002"]) > summary');
    await page.click('.home-flow-scenario:has([data-home-flow-scenario="SCN003"]) > summary');
    await page.focus('[data-home-flow-scenario="SCN002"]');
    const scrollBefore = await page.evaluate(() => {
      const node = document.getElementById('projectRoutePanel');
      node.scrollTop = Math.min(240, node.scrollHeight - node.clientHeight);
      return node.scrollTop;
    });
    await page.selectOption('[data-home-flow-scenario="SCN002"]', 'required');
    await page.waitForSelector('.home-flow-scenario[data-active="true"] [data-route-id="bed_to_bathroom"]');
    const preserved = await page.evaluate(() => ({
      focus: document.activeElement?.dataset.homeFlowScenario || null,
      extraOpen: document.querySelector('[data-home-flow-scenario-id="SCN003"]')?.open,
      scrollTop: document.getElementById('projectRoutePanel')?.scrollTop,
    }));
    assert.equal(preserved.focus, 'SCN002');
    assert.equal(preserved.extraOpen, true);
    assert.ok(Math.abs(preserved.scrollTop - scrollBefore) <= 1, JSON.stringify({ scrollBefore, preserved }));

    await page.fill('[data-home-flow-frequency-value="SCN002"]', '2');
    await page.press('[data-home-flow-frequency-value="SCN002"]', 'Tab');
    await page.selectOption('[data-home-flow-frequency-period="SCN002"]', 'day');

    const value = (roomId) => `${encodeURIComponent(ids.levelId)}|${encodeURIComponent(roomId)}`;
    await page.selectOption('[data-home-flow-binding="from"][data-scenario-id="SCN002"][data-route-id="bed_to_wardrobe"]', value(ids.bedroom));
    await page.selectOption('[data-home-flow-binding="to"][data-scenario-id="SCN002"][data-route-id="bed_to_wardrobe"]', value(ids.bedroom));
    await page.selectOption('[data-home-flow-binding="from"][data-scenario-id="SCN002"][data-route-id="bed_to_bathroom"]', value(ids.bedroom));
    await page.selectOption('[data-home-flow-binding="to"][data-scenario-id="SCN002"][data-route-id="bed_to_bathroom"]', value(ids.bathroom));
    await page.selectOption('[data-home-flow-binding="from"][data-scenario-id="SCN002"][data-route-id="wardrobe_to_exit"]', value(ids.bedroom));
    await page.selectOption('[data-home-flow-binding="to"][data-scenario-id="SCN002"][data-route-id="wardrobe_to_exit"]', value(ids.hall));

    const saved = await page.evaluate(() => {
      const brief = window.__kepler.state.project.layoutBrief;
      return {
        selection: structuredClone(brief.scenarioSelections.find((entry) => entry.scenarioId === 'SCN002')),
        bindings: structuredClone(brief.scenarioRouteBindings.filter((entry) => entry.scenarioId === 'SCN002')),
      };
    });
    assert.equal(saved.selection.enabled, true);
    assert.equal(saved.selection.mandatory, true);
    assert.equal(saved.selection.frequencyValue, 2);
    assert.equal(saved.selection.frequencyPeriod, 'day');
    assert.equal(saved.bindings.length, 3);

    await page.click('[data-home-view="program"]');
    await page.click('[data-home-view="flows"]');
    assert.equal(await page.inputValue('[data-home-flow-frequency-value="SCN002"]'), '2');
    assert.equal(await page.inputValue('[data-home-flow-binding="to"][data-scenario-id="SCN002"][data-route-id="bed_to_bathroom"]'), value(ids.bathroom));

    await page.click('[data-home-flows-action="toggle-overlay"]');
    await page.waitForFunction(() => window.__kepler.state._homeFlowsUI?.active === true
      && window.__kepler.state._homeFlowsUI.routeCounts.drawn > 0);
    const overlay = await page.evaluate(() => ({
      on: window.__kepler.state.homeProgramOverlay.on,
      mode: window.__kepler.state.homeProgramOverlay.mode,
      zones: window.__kepler.state._homeFlowsUI.drawnZoneCount,
      drawn: window.__kepler.state._homeFlowsUI.routeCounts.drawn,
      panelHidden: document.getElementById('projectRoutePanel').hidden,
    }));
    assert.equal(overlay.on, true);
    assert.equal(overlay.mode, 'flows');
    assert.ok(overlay.zones >= 5, JSON.stringify(overlay));
    assert.ok(overlay.drawn >= 2, JSON.stringify(overlay));
    assert.equal(overlay.panelHidden, true);
  });

  it('не считает общую стену без двери доказанным маршрутом', async () => {
    const { page } = app;
    await openHomeView(page, 'flows', 'Зоны и маршруты');
    await page.click('.home-flow-scenario:has([data-home-flow-scenario="SCN003"]) > summary');
    await page.selectOption('[data-home-flow-scenario="SCN003"]', 'required');
    const value = (roomId) => `${encodeURIComponent(ids.levelId)}|${encodeURIComponent(roomId)}`;
    for (const routeId of ['fridge_to_prep', 'coffee_to_seat']) {
      await page.selectOption(`[data-home-flow-binding="from"][data-scenario-id="SCN003"][data-route-id="${routeId}"]`, value(ids.kitchen));
      await page.selectOption(`[data-home-flow-binding="to"][data-scenario-id="SCN003"][data-route-id="${routeId}"]`, value(ids.dining));
    }
    const statuses = await page.$$eval('.home-flow-scenario[data-active="true"] [data-scenario-id="SCN003"][data-home-flow-binding="from"]', (nodes) => (
      nodes.map((node) => node.closest('.home-flow-binding')?.dataset.status)
    ));
    assert.ok(statuses.length >= 2);
    assert.ok(statuses.every((status) => status === 'missing'), JSON.stringify(statuses));
    const scenarioText = await page.locator('[data-home-flow-scenario="SCN003"]')
      .locator('xpath=ancestor::details[1]').textContent();
    assert.match(scenarioText, /граничат, но дверь|проход/i);
  });

  it('различает не обследовано и подтверждённое отсутствие инженерных точек', async () => {
    const { page } = app;
    await openHomeView(page, 'engineering', 'Инженерные связи');
    assert.match(await page.textContent('.home-engineering-section-head'), /Не обследовано/i);

    await page.click('[data-home-engineering-action="mark-none"]');
    assert.deepEqual(await page.evaluate(() => window.__kepler.state.project.layoutBrief.fixedEngineering), []);
    assert.match(await page.textContent('.home-engineering-section-head'), /Подтверждено отсутствие/i);

    await page.click('[data-home-engineering-action="add-point"]');
    await page.waitForSelector('[data-engineering-point]');
    assert.equal(await page.evaluate(() => window.__kepler.state.project.layoutBrief.fixedEngineering.length), 1);
    assert.deepEqual(await page.evaluate(() => {
      const point = window.__kepler.state.project.layoutBrief.fixedEngineering[0];
      return { x: point.x, y: point.y };
    }), { x: null, y: null }, 'новая точка не получает выдуманные координаты');
    await page.selectOption('[data-engineering-field="kind"]', 'drain');
    await page.fill('[data-engineering-field="x"]', '1000');
    await page.press('[data-engineering-field="x"]', 'Tab');
    await page.fill('[data-engineering-field="y"]', '1000');
    await page.press('[data-engineering-field="y"]', 'Tab');
    await page.selectOption('[data-engineering-field="dataStatus"]', 'measured');
    await page.fill('[data-engineering-field="sourceRef"]', 'Контрольный обмер');
    await page.press('[data-engineering-field="sourceRef"]', 'Tab');

    await page.click('[data-home-engineering-action="toggle-overlay"]');
    await page.waitForFunction(() => window.__kepler.state._homeEngineeringUI?.active === true);
    const overlay = await page.evaluate(() => ({
      engineeringOn: window.__kepler.state.homeEngineeringOverlay.on,
      flowsOn: window.__kepler.state.homeProgramOverlay.on,
      rooms: window.__kepler.state._homeEngineeringUI.roomNeedCount,
      points: window.__kepler.state._homeEngineeringUI.explicitPointCount,
      panelHidden: document.getElementById('projectRoutePanel').hidden,
    }));
    assert.equal(overlay.engineeringOn, true);
    assert.equal(overlay.flowsOn, false, 'аналитические слои не конкурируют');
    assert.ok(overlay.rooms > 0, JSON.stringify(overlay));
    assert.equal(overlay.points, 1);
    assert.equal(overlay.panelHidden, true);
    assert.deepEqual(app.errors, []);
  });
});

describe('этапы дома на телефоне', () => {
  let app;

  before(async () => {
    app = await startApp({ mobile: true });
    await openNew(app.page);
  });

  after(async () => { await app?.close(); });

  it('открывает нижний лист и оставляет крупные цели касания', async () => {
    const { page } = app;
    await page.tap('#projectHomeProgram');
    await page.waitForSelector(`${panel}:not([hidden])`);
    await page.tap('[data-home-view="flows"]');
    await page.waitForFunction(() => document.querySelector('#projectRoutePanelTitle')?.textContent === 'Зоны и маршруты');
    const result = await page.evaluate(() => {
      const panelNode = document.getElementById('projectRoutePanel');
      const buttons = [...document.querySelectorAll('.home-system-nav button')];
      const rects = buttons.map((button) => button.getBoundingClientRect());
      const active = document.querySelector('.home-system-nav [aria-current="page"]')?.getBoundingClientRect();
      return {
        modal: panelNode.getAttribute('aria-modal'),
        current: document.querySelector('.home-system-nav [aria-current="page"]')?.dataset.homeView,
        heights: rects.map((rect) => rect.height),
        activeInsideViewport: Boolean(active && active.left >= -1 && active.right <= innerWidth + 1),
        noDocumentOverflow: document.documentElement.scrollWidth <= innerWidth + 1,
      };
    });
    assert.equal(result.modal, 'true');
    assert.equal(result.current, 'flows');
    assert.ok(result.heights.every((height) => height >= 42), JSON.stringify(result));
    assert.equal(result.activeInsideViewport, true);
    assert.equal(result.noDocumentOverflow, true);
    assert.deepEqual(app.errors, []);
  });
});
