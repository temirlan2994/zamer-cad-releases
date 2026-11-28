import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { openSample, pickWorkspaceView, startApp, settleCanvas } from './helpers.mjs';

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

  it('открывает аналитику как самостоятельный вид и сохраняет её вкладку', async () => {
    const { page } = app;
    const levelId = await page.evaluate(() => window.__kepler.state.project.activeLevel);
    const viewId = `analysis:ergonomics:${encodeURIComponent(levelId)}`;
    await pickWorkspaceView(page, 'analytics', viewId);
    await page.waitForFunction((id) => window.__kepler.state.analyticalView?.id === id, viewId);
    assert.equal(await page.isHidden('#projectRoutePanel'), true, 'вид не перекрывается плавающим окном');
    assert.deepEqual(await page.evaluate(() => ({
      mode: window.__kepler.state.modeName,
      levelId: window.__kepler.state.project.activeLevel,
      ergo: window.__kepler.state.ergo?.on,
    })), { mode: 'plan', levelId, ergo: true });
    const levelName = await page.evaluate((id) => (
      window.__kepler.state.project.levels.find((level) => level.id === id)?.name
    ), levelId);
    assert.equal(await page.textContent('#viewPropsTitle'), `Вид: Эргономика · ${levelName}`);

    const tab = page.locator(`[data-workspace-view="${viewId}"]`);
    await tab.waitFor();
    assert.equal(await tab.getAttribute('aria-selected'), 'true');

    await tab.hover();
    await tab.locator('.wv-tab-x').click();
    await tab.waitFor({ state: 'detached' });
    assert.equal(await page.evaluate(() => window.__kepler.state.analyticalView), null);
    assert.equal(await page.evaluate(() => window.__kepler.state.ergo?.on), false);
    assert.deepEqual(app.errors, []);
  });

  it('световые виды первого и второго этажей независимы от обычных планов', async () => {
    const { page } = app;
    await page.evaluate(async () => { (await import('./ui/levels.js')).addLevel(); });
    const levels = await page.evaluate(() => window.__kepler.state.project.levels.map((level) => level.id));
    assert.ok(levels.length >= 2);
    const viewId = `analysis:light:${encodeURIComponent(levels[1])}`;
    const firstLightId = `analysis:light:${encodeURIComponent(levels[0])}`;
    const secondPlanCamera = { scale: 0.041, panX: 21, panY: 22, rotation: 0 };
    const firstPlanCamera = { scale: 0.052, panX: 31, panY: 32, rotation: 0 };
    await page.evaluate(async ({ firstLevel, secondPlanCamera: second, firstPlanCamera: first }) => {
      const { switchLevel } = await import('./ui/levels.js');
      Object.assign(window.__kepler.state.view, second);
      switchLevel(firstLevel);
      Object.assign(window.__kepler.state.view, first);
    }, { firstLevel: levels[0], secondPlanCamera, firstPlanCamera });
    await pickWorkspaceView(page, 'analytics', firstLightId);
    await page.waitForFunction((id) => window.__kepler.state.analyticalView?.id === id, firstLightId);
    await page.click(`#levelBar [data-level="${levels[1]}"]`);
    await page.waitForFunction((id) => window.__kepler.state.analyticalView?.id === id, viewId);
    assert.deepEqual(await page.evaluate(() => ({
      activeLevel: window.__kepler.state.project.activeLevel,
      scope: window.__kepler.state.solarAnalysis.scope,
      levelId: window.__kepler.state.solarAnalysis.levelId,
      panelHidden: document.getElementById('projectRoutePanel').hidden,
    })), {
      activeLevel: levels[1], scope: 'level', levelId: levels[1], panelHidden: true,
    });
    assert.deepEqual(await page.evaluate(() => ({
      scale: window.__kepler.state.view.scale,
      panX: window.__kepler.state.view.panX,
      panY: window.__kepler.state.view.panY,
      rotation: window.__kepler.state.view.rotation,
    })), secondPlanCamera, 'первое открытие аналитики наследует настоящий план второго этажа');

    const secondCamera = { scale: 0.123, panX: 111, panY: 222, rotation: 0 };
    await page.evaluate((camera) => Object.assign(window.__kepler.state.view, camera), secondCamera);
    await page.click(`#levelBar [data-level="${levels[0]}"]`);
    await page.waitForFunction((id) => window.__kepler.state.analyticalView?.id === id, firstLightId);
    assert.equal(await page.evaluate(() => window.__kepler.state.solarAnalysis.levelId), levels[0]);
    const firstCamera = { scale: 0.087, panX: 333, panY: 444, rotation: 0 };
    await page.evaluate((camera) => Object.assign(window.__kepler.state.view, camera), firstCamera);
    await page.click(`#levelBar [data-level="${levels[1]}"]`);
    await page.waitForFunction((id) => window.__kepler.state.analyticalView?.id === id, viewId);
    assert.deepEqual(await page.evaluate(() => ({
      scale: window.__kepler.state.view.scale,
      panX: window.__kepler.state.view.panX,
      panY: window.__kepler.state.view.panY,
      rotation: window.__kepler.state.view.rotation,
    })), secondCamera, 'камера светового вида второго этажа не стала камерой плана');
    await page.evaluate(async () => { (await import('./ui/project-route.js')).closeAnalyticalView(); });
    assert.deepEqual(await page.evaluate(() => ({
      scale: window.__kepler.state.view.scale,
      panX: window.__kepler.state.view.panX,
      panY: window.__kepler.state.view.panY,
      rotation: window.__kepler.state.view.rotation,
    })), secondPlanCamera, 'закрытие аналитики возвращает камеру обычного плана');
    await pickWorkspaceView(page, 'analytics', viewId);
    await page.waitForFunction((id) => window.__kepler.state.analyticalView?.id === id, viewId);
    assert.deepEqual(await page.evaluate(() => ({
      scale: window.__kepler.state.view.scale,
      panX: window.__kepler.state.view.panX,
      panY: window.__kepler.state.view.panY,
      rotation: window.__kepler.state.view.rotation,
    })), secondCamera, 'повторное открытие возвращает камеру аналитического вида');
    await page.click(`#levelBar [data-level="${levels[0]}"]`);
    await page.waitForFunction((id) => window.__kepler.state.analyticalView?.id === id, firstLightId);
    assert.deepEqual(await page.evaluate(() => ({
      scale: window.__kepler.state.view.scale,
      panX: window.__kepler.state.view.panX,
      panY: window.__kepler.state.view.panY,
      rotation: window.__kepler.state.view.rotation,
    })), firstCamera, 'каждый поэтажный аналитический вид хранит собственную камеру');

    await page.evaluate(async () => {
      const { mutate, undo } = await import('./ui/store.js');
      mutate(() => { window.__kepler.state.project.name += ' · проверка'; });
      undo();
    });
    await page.waitForFunction((id) => (
      window.__kepler.state.analyticalView?.id === id
      && window.__kepler.state.solarAnalysis?.scope === 'level'
    ), firstLightId);

    await page.evaluate(async () => { (await import('./ui/props-views.js')).openView('3d'); });
    await page.waitForFunction(() => window.__kepler.state.analyticalView == null);
    assert.equal(await page.evaluate(() => window.__kepler.state.solarAnalysis.on), false);

    await pickWorkspaceView(page, 'plans', `plan:${levels[0]}`);
    await page.waitForFunction((id) => window.__kepler.state.project.activeLevel === id, levels[0]);
    assert.equal(await page.evaluate(() => window.__kepler.state.analyticalView), null);
    assert.equal(await page.evaluate(() => window.__kepler.state.solarAnalysis.on), false);
    assert.deepEqual(app.errors, []);
  });

  it('новый проект закрывает прежний аналитический вид, а не подменяет его другим', async () => {
    const { page } = app;
    const levelId = await page.evaluate(() => window.__kepler.state.project.activeLevel);
    const viewId = `analysis:light:${encodeURIComponent(levelId)}`;
    await pickWorkspaceView(page, 'analytics', viewId);
    await page.waitForFunction((id) => window.__kepler.state.analyticalView?.id === id, viewId);
    await page.waitForFunction((id) => document.querySelector(`.wv-tabs [data-workspace-view="${id}"]`)?.getAttribute('aria-selected') === 'true', viewId);

    await page.evaluate(async () => { (await import('./ui/files.js')).newProject(); });
    await page.locator('#projectRoutePanel').waitFor({ state: 'hidden' });
    await page.waitForFunction(() => document.querySelector('.wv-tabs [aria-selected="true"]')?.dataset.workspaceView?.startsWith('plan:'));
    assert.equal(await page.locator('.wv-tabs [data-workspace-view^="analysis:"][aria-selected="true"]').count(), 0);
    assert.deepEqual(app.errors, []);
    await page.evaluate(() => window.__kepler.loadSample());
    await page.waitForFunction(() => window.__kepler.state.project.rooms.length > 0);
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
    await page.mouse.move(head.x, head.y);
    await page.mouse.down();
    await page.mouse.move(head.x + 70, head.y + 35);
    await page.mouse.up();
    assert.equal(await page.evaluate(() => window.__kepler.state.project.grids[0].at), 0);
    assert.equal(await page.evaluate(() => window.__kepler.state.selection?.type), 'grid');

    await settleCanvas(page);
    const selectedLine = await page.evaluate(() => {
      const grid = window.__kepler.state._gridUI[0];
      const box = document.getElementById('canvas').getBoundingClientRect();
      return { x: box.x+(grid.A.x+grid.B.x)/2, y: box.y+(grid.A.y+grid.B.y)/2 };
    });
    await page.mouse.move(selectedLine.x, selectedLine.y);
    await page.mouse.down();
    await page.mouse.move(selectedLine.x + 70, selectedLine.y);
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

  it('открывает поэтажное освещение всех помещений из общего меню видов', async () => {
    const { page } = app;
    await page.tap('#projectRouteClose');
    await page.locator('#projectRoutePanel').waitFor({ state: 'hidden' });

    await page.tap('#workspaceViewPicker');
    const menu = page.getByRole('dialog', { name: 'Все виды проекта' });
    await menu.locator('[data-view-group="analytics"]').tap();
    const titles = await menu.locator('[data-view-key^="analysis:"] span').allTextContents();
    assert.ok(titles.some((title) => /^Планировка · /.test(title)), titles.join(', '));
    assert.ok(titles.some((title) => /^Освещение · /.test(title)), titles.join(', '));
    assert.ok(titles.some((title) => /^Эргономика · /.test(title)), titles.join(', '));
    const light = menu.locator('[data-view-key^="analysis:light:"]').first();
    const viewId = await light.getAttribute('data-view-key');
    await light.tap();

    await page.waitForFunction((id) => window.__kepler.state.analyticalView?.id === id, viewId);
    assert.equal(await page.isHidden('#projectRoutePanel'), true);
    await page.waitForFunction((id) => document.querySelector(`.wv-tabs [data-workspace-view="${id}"]`)?.getAttribute('aria-selected') === 'true', viewId);
    await page.evaluate(() => window.__kepler.fitView());
    const expected = await page.evaluate(() => window.__kepler.state.project.rooms
      .filter((room) => room.type !== 'shaft').map((room) => room.id).sort());
    await page.waitForFunction((roomIds) => {
      const drawn = window.__kepler.state._lightAnalysisDrawn;
      return drawn?.roomIds?.length === roomIds.length
        && roomIds.every((id) => drawn.roomIds.includes(id));
    }, expected);
    assert.match(await page.textContent('#solarLegend'), /Готово/);
    const lightState = await page.evaluate(() => ({
      scope: window.__kepler.state.solarAnalysis.scope,
      levelId: window.__kepler.state.solarAnalysis.levelId,
      roomIds: [...(window.__kepler.state._lightAnalysisDrawn?.roomIds || [])].sort(),
    }));
    assert.equal(lightState.scope, 'level');
    assert.equal(lightState.levelId, await page.evaluate(() => window.__kepler.state.project.activeLevel));
    assert.deepEqual(lightState.roomIds, expected, 'renderer сам показал все помещения этажа без выбора');
    const afterRoomDetail = await page.evaluate(async () => {
      const { focusSolarRoom, setSolarAnalysis } = await import('./ui/solar-analysis.js');
      const rooms = window.__kepler.state.project.rooms.filter((room) => room.type !== 'shaft');
      focusSolarRoom(rooms[0]?.id);
      setSolarAnalysis(true, rooms[0]?.id);
      return {
        scope: window.__kepler.state.solarAnalysis.scope,
        roomId: window.__kepler.state.solarAnalysis.roomId,
      };
    });
    assert.equal(afterRoomDetail.scope, 'level', 'детали комнаты не скрывают карту всего этажа');
    assert.ok(afterRoomDetail.roomId, 'выбранная комната хранится только как деталь вида');
    await page.waitForFunction((roomIds) => {
      const drawn = window.__kepler.state._lightAnalysisDrawn;
      return drawn?.roomIds?.length === roomIds.length
        && roomIds.every((id) => drawn.roomIds.includes(id));
    }, expected);
    const offscreenId = await page.evaluate(async () => {
      const { createRoom } = await import('./core/model.js');
      const { mutate } = await import('./ui/store.js');
      const room = createRoom('bedroom', 1_000_000, 1_000_000, 4000, 4000);
      room.id = 'light-offscreen-room';
      mutate(() => { window.__kepler.state.project.rooms.push(room); });
      window.__floorLightE2E = await import('./ui/render-solar.js');
      return room.id;
    });
    await page.waitForFunction(() => {
      const state = window.__kepler.state;
      const progress = window.__floorLightE2E.levelLightAnalysisProgress(
        state.project.activeLevel, state.solarAnalysis.mode,
      );
      return progress.total > 0 && progress.ready === progress.total && progress.pending === 0;
    });
    assert.equal(await page.evaluate((roomId) => (
      window.__floorLightE2E.currentLightAnalysis(roomId)?.roomId || null
    ), offscreenId), offscreenId, 'комната вне экрана тоже пересчитана автоматически');
    assert.deepEqual(app.errors, []);
  });
});

describe('свойства поэтажной аналитики', () => {
  it('показывает действия выбранной карты и сохраняет режим солнца при переходе на другой этаж', async () => {
    const app = await startApp({ viewSections: 'default' });
    const { page } = app;
    try {
      await page.click('[data-template="two-storey"]');
      const [first, second] = await page.evaluate(() => window.__kepler.state.project.levels.map((l) => l.id));
      await page.click('#propsTabSheets');
      await pickWorkspaceView(page, 'analytics', `analysis:light:${first}`);
      assert.equal(await page.locator('#propsTabMain').getAttribute('aria-selected'), 'true');
      assert.equal(await page.locator('#projectSection').count(), 0);
      await page.getByLabel('Карта всех помещений').selectOption('direct');
      await page.click(`#levelBar [data-level="${second}"]`);
      assert.match(await page.innerText('#solarLegend'), /Прямое солнце · все помещения/);
      assert.equal(await page.getByLabel('Карта всех помещений').inputValue(), 'direct');
      await page.getByRole('button', { name: 'Дата, координаты и север' }).click();
      assert.ok(await page.locator('[data-analysis-mission-panel="location"]').isVisible());
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => document.activeElement?.dataset.floorMission === 'location');
      for (const [type, name, mission] of [
        ['layout', 'Сценарии семьи', 'scenarios'],
        ['circulation', 'Ширина прохода', 'circulation-check'],
        ['engineering', 'Мокрые зоны', 'engineering-wet'],
      ]) {
        await pickWorkspaceView(page, 'analytics', `analysis:${type}:${second}`);
        await page.locator('#propsBody').getByRole('button', { name }).click();
        assert.ok(await page.locator(`[data-analysis-mission-panel="${mission}"]`).isVisible());
        await page.click('#projectRouteClose');
      }
      await pickWorkspaceView(page, 'analytics', `analysis:ergonomics:${second}`);
      await page.getByLabel('Карта проходимости', { exact: true }).check();
      assert.equal(await page.evaluate(() => window.__kepler.state.ergo.heat), true);
      await pickWorkspaceView(page, 'plans', `plan:${second}`);
      assert.ok(await page.locator('#projectSection').isVisible());
      assert.deepEqual(app.errors, []);
    } finally { await app.close(); }
  });

  it('на телефоне показывает управление картой пустого этажа и возвращает к черчению', async () => {
    const app = await startApp({ mobile: true, viewSections: 'default' });
    const { page } = app;
    try {
      await page.click('#startNew');
      const id = await page.evaluate(() => window.__kepler.state.project.activeLevel);
      await pickWorkspaceView(page, 'analytics', `analysis:light:${id}`);
      assert.match(await page.innerText('#solarLegend'), /Добавьте помещение/);
      await page.tap('#mobileBar [data-sheet="props"]');
      assert.match(await page.innerText('#mobilePropsTitle'), /Освещение/);
      await page.getByLabel('Карта всех помещений').selectOption('direct');
      assert.ok(await page.getByRole('button', { name: 'Перейти на план этажа' }).isVisible());
      await page.getByRole('button', { name: 'Перейти на план этажа' }).tap();
      assert.ok(await page.locator('#solarLegend').isHidden());
      assert.equal(await page.locator('#mobileBar [data-sheet="props"]').getAttribute('aria-pressed'), 'false');
      assert.equal(await page.evaluate(() => window.__kepler.state.project.activeLevel), id);
      assert.deepEqual(app.errors, []);
    } finally { await app.close(); }
  });
});
