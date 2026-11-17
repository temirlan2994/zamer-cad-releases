// E2E этапов 6–7: честный световой обзор и итоговая проверка без score.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { openNew, startApp } from './helpers.mjs';

const panel = '#projectRoutePanel';

async function openHomeView(page, view, title, mobile = false) {
  if (!(await page.locator(panel).isVisible())) {
    if (mobile) await page.tap('#projectHomeProgram');
    else await page.click('#projectHomeProgram');
  }
  await page.waitForSelector(`${panel}:not([hidden])`);
  const selector = `[data-home-view="${view}"]`;
  if (mobile) await page.tap(selector);
  else await page.click(selector);
  await page.waitForFunction((expected) => (
    document.querySelector('#projectRoutePanelTitle')?.textContent === expected
  ), title);
}

describe('свет и итоговая проверка проекта', () => {
  let app;
  let roomId;

  before(async () => {
    app = await startApp({ issueGroups: 'all' });
    await openNew(app.page);
    roomId = await app.page.evaluate(async () => {
      const { createOpening, createRoom } = await import('./core/model.js');
      const { mutate } = await import('./ui/store.js');
      let id = null;
      mutate(() => {
        const project = window.__kepler.state.project;
        const room = createRoom('living', 0, 0, 5200, 4200);
        room.name = 'Гостиная света';
        const opening = createOpening('window', room.id, 0, 2600, 1800);
        opening.height = 1500;
        opening.sill = 800;
        project.rooms = [room];
        project.openings = [opening];
        // Координаты существуют, но пользователь их не подтвердил: результат
        // обязан остаться ориентировочным.
        project.site.location = { lat: 43.2389, lon: 76.8897, tz: 5 };
        project.site.north = 0;
        project.site.solarVerified = false;
        id = room.id;
      });
      return id;
    });
  });

  after(async () => { await app?.close(); });

  it('показывает шесть доступных этапов и не выдаёт оценку света за норму', async () => {
    const { page } = app;
    await openHomeView(page, 'climate', 'Свет и солнце');
    const nav = await page.evaluate(() => ({
      count: document.querySelectorAll('.home-system-nav [role="tab"]').length,
      current: document.querySelector('.home-system-nav [aria-current="page"]')?.dataset.homeView,
      selected: document.querySelector('[data-home-view="climate"]')?.getAttribute('aria-selected'),
    }));
    assert.deepEqual(nav, { count: 6, current: 'climate', selected: 'true' });
    const text = await page.textContent('[data-home-climate]');
    assert.match(text, /Не нормативное заключение/i);
    assert.match(text, /ориентировочн|не подтвержден/i);
    assert.doesNotMatch(text, /норма выполнена/i);
    assert.equal(await page.locator('[data-home-climate-room]').inputValue() !== '', true);
    assert.deepEqual(app.errors, []);
  });

  it('включает существующую карту света и выключает конкурирующие слои', async () => {
    const { page } = app;
    await openHomeView(page, 'climate', 'Свет и солнце');
    await page.evaluate(() => {
      window.__kepler.state.homeProgramOverlay = { on: true, mode: 'flows', result: {} };
      window.__kepler.state.homeEngineeringOverlay = { on: true, result: {} };
      window.__kepler.state.homeCirculationOverlay = { on: true, result: {} };
    });
    await page.click('[data-home-climate-action="toggle-map"][data-home-climate-map="daylight"]');
    await page.waitForFunction((expectedRoom) => (
      window.__kepler.state.solarAnalysis?.on === true
      && window.__kepler.state.solarAnalysis?.mode === 'daylight'
      && window.__kepler.state.solarAnalysis?.roomId === expectedRoom
      && document.getElementById('solarLegend')?.hidden === false
    ), roomId);
    const result = await page.evaluate(() => ({
      program: window.__kepler.state.homeProgramOverlay.on,
      engineering: window.__kepler.state.homeEngineeringOverlay.on,
      circulation: window.__kepler.state.homeCirculationOverlay.on,
      legend: document.getElementById('solarLegend')?.textContent,
      panelHidden: document.getElementById('projectRoutePanel')?.hidden,
    }));
    assert.equal(result.program, false);
    assert.equal(result.engineering, false);
    assert.equal(result.circulation, false);
    assert.match(result.legend, /Освещённость|пасмурное небо/i);
    assert.equal(result.panelHidden, true);
    assert.deepEqual(app.errors, []);
  });

  it('синхронизирует кнопку и легенду после сброса состояния вида', async () => {
    const { page } = app;
    await page.evaluate(async () => {
      window.__kepler.state.solarAnalysis = { on: false, roomId: null, mode: 'direct' };
      const { renderProjectRoute } = await import('./ui/project-route.js');
      renderProjectRoute();
    });
    assert.equal(await page.isHidden('#solarLegend'), true);
    assert.equal(await page.getAttribute('#sunAnalysisBtn', 'aria-pressed'), 'false');
    assert.equal(await page.locator('#sunAnalysisBtn').evaluate((node) => node.classList.contains('active')), false);
    assert.deepEqual(app.errors, []);
  });

  it('разделяет проблемы, неизвестное и факты, а CTA возвращает к этапу', async () => {
    const { page } = app;
    await openHomeView(page, 'review', 'Проверка проекта');
    assert.equal(await page.getAttribute('[data-home-view="review"]', 'aria-current'), 'page');
    assert.notEqual(await page.getAttribute('.home-review-summary', 'data-status'), 'checked',
      'неподтверждённое солнце и отсутствующие климатические данные не могут быть зелёными');
    const text = await page.textContent('[data-home-review]');
    assert.match(text, /не экспертиза/i);
    assert.match(text, /Не хватает данных|Недостаточно данных/i);
    assert.match(text, /Проверенные факты/i);
    assert.doesNotMatch(text, /общий балл|\d+\s*% готов/i);

    await page.click('[data-home-review-view="climate"]');
    await page.waitForFunction(() => (
      document.querySelector('#projectRoutePanelTitle')?.textContent === 'Свет и солнце'
    ));
    assert.equal(await page.getAttribute('[data-home-view="climate"]', 'aria-current'), 'page');
    assert.deepEqual(app.errors, []);
  });
});

describe('этапы света и проверки на телефоне', () => {
  let app;

  before(async () => {
    app = await startApp({ mobile: true });
    await openNew(app.page);
  });

  after(async () => { await app?.close(); });

  it('открываются касанием без горизонтального переполнения и с целями 44 px', async () => {
    const { page } = app;
    await openHomeView(page, 'climate', 'Свет и солнце', true);
    await openHomeView(page, 'review', 'Проверка проекта', true);
    const result = await page.evaluate(() => {
      const tabs = [...document.querySelectorAll('.home-system-nav button')];
      const controls = [
        ...tabs,
        ...document.querySelectorAll('[data-home-review-action]'),
      ].filter((node) => node.getClientRects().length);
      const rects = tabs.map((node) => node.getBoundingClientRect());
      return {
        current: document.querySelector('.home-system-nav [aria-current="page"]')?.dataset.homeView,
        modal: document.getElementById('projectRoutePanel')?.getAttribute('aria-modal'),
        heights: controls.map((node) => node.getBoundingClientRect().height),
        tabsInside: rects.every((rect) => rect.left >= -1 && rect.right <= innerWidth + 1),
        noDocumentOverflow: document.documentElement.scrollWidth <= innerWidth + 1,
      };
    });
    assert.equal(result.current, 'review');
    assert.equal(result.modal, 'true');
    assert.equal(result.tabsInside, true, JSON.stringify(result));
    assert.equal(result.noDocumentOverflow, true, JSON.stringify(result));
    assert.ok(result.heights.length >= 6);
    assert.ok(result.heights.every((height) => height >= 44), JSON.stringify(result));
    assert.deepEqual(app.errors, []);
  });
});
