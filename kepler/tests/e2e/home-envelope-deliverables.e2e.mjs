// E2E этапов 8–9: фактическая геометрическая сводка, переход в 3D,
// концептуальный комплект и доступная на телефоне лента из девяти этапов.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { openNew, openRouteView, startApp } from './helpers.mjs';

const PANEL = '#projectRoutePanel';

// Этапы открываются из палитры внизу (интерфейс 0.4.5): кнопка этапа → пункт меню.
async function openHomeView(page, view, title, { mobile = false } = {}) {
  await openRouteView(page, view, { mobile });
  await page.waitForFunction((expected) => document.querySelector('#projectRoutePanelTitle')?.textContent === expected, title);
}

async function seedEnvelopeProject(page) {
  await page.evaluate(async () => {
    const { createOpening, createRoom } = await import('./core/model.js');
    const { createRoof } = await import('./core/roofs.js');
    const { addSectionView } = await import('./core/views.js');
    const { mutate } = await import('./ui/store.js');
    mutate(() => {
      const project = window.__kepler.state.project;
      const room = createRoom('living', 0, 0, 6200, 4800);
      room.name = 'Гостиная E2E';
      project.rooms = [room];
      project.openings = [createOpening('window', room.id, 0, 3100, 1800)];
      project.site.boundary = [
        { x: -5000, y: -5000 }, { x: 15000, y: -5000 },
        { x: 15000, y: 15000 }, { x: -5000, y: 15000 },
      ];
      project.roofs = [createRoof({
        levelId: project.activeLevel,
        name: 'Кровля E2E',
        outline: [
          { x: -300, y: -300 }, { x: 6500, y: -300 },
          { x: 6500, y: 5100 }, { x: -300, y: 5100 },
        ],
      })];
      addSectionView(project, {
        levelId: project.activeLevel,
        name: 'Разрез E2E',
        a: { x: -1000, y: 2400 },
        b: { x: 7200, y: 2400 },
      });
    });
  });
}

describe('объём и концептуальный комплект', () => {
  let app;

  before(async () => {
    app = await startApp();
    await openNew(app.page);
    await seedEnvelopeProject(app.page);
  });

  after(async () => { await app?.close(); });

  it('показывает девять этапов, ТЭП, явную кровлю и честные ограничения', async () => {
    const { page } = app;
    await openHomeView(page, 'envelope', 'Объём и фасады');

    assert.equal(await page.locator('#projectRouteSteps [role="tab"]').count(), 9);
    assert.equal(await page.getAttribute('#projectRouteSteps [data-route-view="envelope"]', 'aria-current'), 'page');
    assert.match(await page.textContent('[data-home-envelope-section="roofs"]'), /Кровля E2E/);
    assert.match(await page.textContent('[data-home-envelope-section="views"]'), /Фасад Север|Фасады/i);

    const footprint = await page.locator('.home-envelope-metrics > div')
      .filter({ hasText: 'Площадь застройки' }).locator('dd').textContent();
    const volume = await page.locator('.home-envelope-metrics > div')
      .filter({ hasText: 'Строительный объём' }).locator('dd').textContent();
    assert.match(footprint, /\d/);
    assert.doesNotMatch(footprint, /—/);
    assert.match(volume, /\d/);
    assert.doesNotMatch(volume, /—/);

    const text = await page.textContent('[data-home-envelope]');
    assert.match(text, /не подтверждает несущую способность/i);
    assert.match(text, /объём кровли.*не добав|объём кровли/i);
    assert.doesNotMatch(text, /конструктив\w* готов|теплотехн\w* готов|норма выполнена/i);
    assert.deepEqual(app.errors, []);
  });

  it('CTA открывает существующий 3D-вид и закрывает маршрут', async () => {
    const { page } = app;
    await openHomeView(page, 'envelope', 'Объём и фасады');
    await page.click('[data-home-envelope-action="open-3d"]');
    await page.waitForSelector('body.v3-open');
    assert.equal(await page.isHidden(PANEL), true);
    assert.equal(await page.isVisible('#view3d'), true);
    await page.evaluate(async () => {
      const { close3d } = await import('./ui/view3d.js');
      close3d();
    });
    assert.deepEqual(app.errors, []);
  });

  it('показывает шесть групп выпуска и открывает существующий диспетчер листов', async () => {
    const { page } = app;
    await openHomeView(page, 'deliverables', 'Листы и выдача');
    assert.equal(await page.getAttribute('#projectRouteSteps [data-route-view="deliverables"]', 'aria-current'), 'page');
    assert.equal(await page.locator('[data-home-deliverables-check]').count(), 6);
    assert.equal(await page.getAttribute('[data-home-deliverables-check="plans"]', 'data-status'), 'ready');
    assert.equal(await page.getAttribute('[data-home-deliverables-check="site"]', 'data-status'), 'ready');
    assert.equal(await page.getAttribute('[data-home-deliverables-check="facades"]', 'data-status'), 'ready');
    assert.equal(await page.getAttribute('[data-home-deliverables-check="sections"]', 'data-status'), 'ready');

    const text = await page.textContent('[data-home-deliverables]');
    assert.match(text, /не является рабочей документацией/i);
    assert.match(text, /150 dpi/i);
    assert.doesNotMatch(text, /общий балл|\d+\s*% готов/i);

    await page.locator('[data-home-deliverables-action="open-sheets"]').first().click();
    await page.waitForFunction(() => (
      window.__kepler.state.propsTab === 'sheets'
      && document.getElementById('projectRoutePanel')?.hidden === true
    ));
    assert.match(await page.textContent('#propsPanel'), /Листы/);
    assert.deepEqual(app.errors, []);
  });
});

describe('этапы 8–9 на телефоне', () => {
  let app;

  before(async () => {
    app = await startApp({ mobile: true });
    await openNew(app.page);
  });

  after(async () => { await app?.close(); });

  it('активная вкладка видна, цели касания крупные и страница не переполняется', async () => {
    const { page } = app;
    await openHomeView(page, 'deliverables', 'Листы и выдача', { mobile: true });
    await page.waitForFunction(() => {
      const active = document.querySelector('#projectRouteSteps [aria-current="page"]');
      if (!active) return false;
      const rect = active.getBoundingClientRect();
      return rect.left >= -1 && rect.right <= innerWidth + 1;
    });
    const result = await page.evaluate(() => {
      const nav = document.querySelector('#projectRouteSteps');
      const tabs = [...nav.querySelectorAll('button')];
      const active = nav.querySelector('[aria-current="page"]');
      const activeRect = active.getBoundingClientRect();
      const actions = [...document.querySelectorAll('[data-home-deliverables-action]')]
        .filter((node) => node.getClientRects().length && !node.disabled);
      return {
        count: tabs.length,
        current: active.dataset.routeView,
        activeInside: activeRect.left >= -1 && activeRect.right <= innerWidth + 1,
        allInside: tabs.every((node) => {
          const rect = node.getBoundingClientRect();
          return rect.left >= -1 && rect.right <= innerWidth + 1;
        }),
        tabHeights: tabs.map((node) => node.getBoundingClientRect().height),
        actionHeights: actions.map((node) => node.getBoundingClientRect().height),
        noDocumentOverflow: document.documentElement.scrollWidth <= innerWidth + 1,
        modal: document.getElementById('projectRoutePanel')?.getAttribute('aria-modal'),
      };
    });
    assert.equal(result.count, 9);
    assert.equal(result.current, 'deliverables');
    // Окно этапа с 0.4.5 немодальное: палитра этапов остаётся доступной.
    assert.equal(result.modal, 'false');
    assert.equal(result.activeInside, true, JSON.stringify(result));
    assert.equal(result.allInside, true, JSON.stringify(result));
    assert.equal(result.noDocumentOverflow, true, JSON.stringify(result));
    // Кнопки палитры этапов — 40 px (размер палитры на телефоне); действия этапа — от 44 px.
    assert.ok(result.tabHeights.every((height) => height >= 40), JSON.stringify(result));
    assert.ok(result.actionHeights.length > 0);
    assert.ok(result.actionHeights.every((height) => height >= 44), JSON.stringify(result));
    assert.deepEqual(app.errors, []);
  });
});
