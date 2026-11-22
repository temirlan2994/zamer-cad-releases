// E2E этапов 6–7: честный световой обзор и итоговая проверка без score.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { openNew, openRouteView, startApp } from './helpers.mjs';

// Этапы открываются из палитры внизу (интерфейс 0.4.5): кнопка этапа → пункт меню.
async function openHomeView(page, view, title, mobile = false) {
  await openRouteView(page, view, { mobile });
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

  it('показывает девять доступных этапов и не выдаёт оценку света за норму', async () => {
    const { page } = app;
    await openHomeView(page, 'climate', 'Свет и солнце');
    const nav = await page.evaluate(() => ({
      count: document.querySelectorAll('#projectRouteSteps [role="tab"]').length,
      current: document.querySelector('#projectRouteSteps [aria-current="page"]')?.dataset.routeView,
      selected: document.querySelector('#projectRouteSteps [data-route-view="climate"]')?.getAttribute('aria-selected'),
    }));
    assert.deepEqual(nav, { count: 9, current: 'climate', selected: 'true' });
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
    await openHomeView(page, 'climate', 'Свет и солнце');
    assert.equal(await page.locator('[data-home-climate-map][aria-pressed="true"]').count(), 0);
    await page.click('#projectRouteClose');
    assert.deepEqual(app.errors, []);
  });

  it('разделяет проблемы, неизвестное и факты, а CTA возвращает к этапу', async () => {
    const { page } = app;
    await openHomeView(page, 'review', 'Проверка проекта');
    assert.equal(await page.getAttribute('#projectRouteSteps [data-route-view="review"]', 'aria-current'), 'page');
    assert.notEqual(await page.getAttribute('.home-review-summary', 'data-status'), 'checked',
      'неподтверждённое солнце и отсутствующие климатические данные не могут быть зелёными');
    const text = await page.textContent('[data-home-review]');
    assert.match(text, /не экспертиза/i);
    assert.match(text, /Не хватает данных|Недостаточно данных/i);
    assert.match(text, /Проверенные факты/i);
    assert.doesNotMatch(text, /общий балл|\d+\s*% готов/i);
    assert.equal(await page.locator('[data-home-review-stage]').count(), 8);
    assert.equal(await page.locator('[data-home-review-stage="envelope"]').count(), 1);
    assert.equal(await page.locator('[data-home-review-stage="deliverables"]').count(), 1);

    await page.click('[data-review-stage-list] > summary');
    await page.click('[data-review-stage-list] [data-home-review-view="climate"]');
    await page.waitForFunction(() => (
      document.querySelector('#projectRoutePanelTitle')?.textContent === 'Свет и солнце'
    ));
    assert.equal(await page.getAttribute('#projectRouteSteps [data-route-view="climate"]', 'aria-current'), 'page');
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
      const tabs = [...document.querySelectorAll('#projectRouteSteps button')];
      const controls = [...document.querySelectorAll('[data-home-review-action]')]
        .filter((node) => node.getClientRects().length);
      const active = document.querySelector('#projectRouteSteps [aria-current="page"]');
      const activeRect = active?.getBoundingClientRect();
      return {
        current: document.querySelector('#projectRouteSteps [aria-current="page"]')?.dataset.routeView,
        modal: document.getElementById('projectRoutePanel')?.getAttribute('aria-modal'),
        heights: controls.map((node) => node.getBoundingClientRect().height),
        tabHeights: tabs.map((node) => node.getBoundingClientRect().height),
        activeInside: Boolean(activeRect && activeRect.left >= -1 && activeRect.right <= innerWidth + 1),
        noDocumentOverflow: document.documentElement.scrollWidth <= innerWidth + 1,
      };
    });
    assert.equal(result.current, 'review');
    // Окно этапа с 0.4.5 немодальное: палитра этапов остаётся доступной.
    assert.equal(result.modal, 'false');
    assert.equal(result.activeInside, true, JSON.stringify(result));
    assert.equal(result.noDocumentOverflow, true, JSON.stringify(result));
    assert.equal(result.tabHeights.length, 9);
    // Кнопки палитры этапов — 40 px (размер палитры на телефоне); действия этапа — от 44 px.
    assert.ok(result.tabHeights.every((height) => height >= 40), JSON.stringify(result));
    assert.ok(result.heights.length > 0);
    assert.ok(result.heights.every((height) => height >= 44), JSON.stringify(result));
    assert.deepEqual(app.errors, []);
  });
});
