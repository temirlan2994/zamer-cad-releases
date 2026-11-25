import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, openNew, settleView, clickToolbarTool, mobileSelectFamilyTool } from './helpers.mjs';

async function scene(page) {
  await page.evaluate(async () => {
    const { createRoom } = await import('./core/model.js');
    const { mutate } = await import('./ui/store.js');
    const { cancelTool, selectObject } = await import('./ui/tools.js');
    const { state } = window.__kepler;
    cancelTool(); selectObject(null);
    mutate(() => {
      state.project.rooms = [createRoom('living', 0, 0, 6000, 5000)];
      state.project.openings = [];
      state.project.items = [];
      state.project.settings.autoArrangeFurniture = false;
    });
    window.__kepler.fitView();
  });
}

async function client(page, x, y) {
  await settleView(page);
  return page.evaluate(([x, y]) => {
    const b = document.getElementById('canvas').getBoundingClientRect();
    const p = window.__kepler.planToScreen(x, y);
    return { x: b.x + p.x, y: b.y + p.y };
  }, [x, y]);
}

async function place(page, preset, configure = null) {
  await scene(page);
  await clickToolbarTool(page, 'windowToolBtn');
  await page.click('#openingCats [data-cat="with-door"]');
  await page.click(`#openingItems [data-preset="${preset}"]`);
  if (configure) await configure(page);
  await settleView(page);
  await page.evaluate(async () => {
    const { planToScreen, requestDraw } = await import('./ui/view.js');
    const { state } = window.__kepler;
    const canvas = document.getElementById('canvas');
    const at = planToScreen(3000, -125);
    state.view.panX += canvas.clientWidth * .65 - at.x;
    state.view.panY += canvas.clientHeight * .48 - at.y;
    requestDraw();
  });
  const at = await client(page, 3000, -125);
  await page.mouse.move(at.x, at.y);
  await page.waitForFunction(() => Boolean(window.__kepler.state.ghostOpeningFull));
  await page.mouse.click(at.x, at.y);
  await page.waitForFunction(() => window.__kepler.state.project.openings.length === 1);
  await page.keyboard.press('Escape');
}

const data = (page) => page.evaluate(async () => {
  const { levelWindowOpenings } = await import('./core/spanning-windows.js');
  const { state } = window.__kepler;
  return {
    stored: structuredClone(state.project.openings),
    parts: levelWindowOpenings(state.project, state.walls).map(({ kind, type, width, sill, height, offset }) => ({ kind, type, width, sill, height, offset })),
  };
});

describe('окна с дверью из каталога', () => {
  let app;
  before(async () => { app = await startApp({ width: 1500, height: 1000 }); await openNew(app.page); });
  after(async () => { await app?.close(); });

  for (const [preset, type, doorType] of [
    ['glazed-swing-2400', 'glazed-swing', 'single'], ['glazed-double-1800', 'glazed-double', 'double'],
    ['glazed-sliding-3000', 'glazed-sliding', 'sliding'], ['balcony-swing-2200', 'balcony-swing', 'single'],
    ['balcony-sliding-3000', 'balcony-sliding', 'sliding'],
  ]) {
    it(`${preset}: одна вставка создаёт целый блок с нужным открыванием`, async () => {
      await place(app.page, preset);
      const current = await data(app.page);
      assert.equal(current.stored.length, 1);
      assert.equal(current.stored[0].type, type);
      assert.equal(current.parts[0].kind, 'door');
      assert.equal(current.parts[0].type, doorType);
      assert.equal(current.parts[0].sill, 0);
      if (type.startsWith('balcony-')) assert.equal(current.parts[1].sill, 900);
    });
  }

  it('можно поменять сторону двери, её ширину и подоконник оконной части', async () => {
    const { page } = app;
    await place(page, 'balcony-swing-2200');
    const at = await client(page, 3500, -125);
    await page.mouse.click(at.x, at.y);
    await page.waitForSelector('#openDoorWidth');
    await page.fill('#openDoorWidth', '800'); await page.press('#openDoorWidth', 'Tab');
    await page.uncheck('#openWindowRight');
    await page.check('#openWindowLeft');
    await page.fill('#openWindowSill', '1100'); await page.press('#openWindowSill', 'Tab');
    const current = await data(page);
    assert.equal(current.stored[0].width, 2200);
    assert.equal(current.parts[0].width, 800);
    assert.equal(current.parts[0].offset, 3700);
    assert.equal(current.parts[1].sill, 1100);
    assert.equal(current.parts[1].height, 1200);
    if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/balcony-block.png` });
    await page.click('[data-selection-action="flip-swing"]');
    assert.equal((await data(page)).stored[0].swingIn, !current.stored[0].swingIn);
  });

  it('за оконную часть переносится весь блок без скачка; удаление и Undo относятся ко всему блоку', async () => {
    const { page } = app;
    await place(page, 'balcony-swing-2200');
    const from = await client(page, 3500, -125);
    const to = await client(page, 3900, -125);
    await page.mouse.move(from.x, from.y); await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 5 }); await page.mouse.up();
    let current = await data(page);
    assert.equal(current.stored[0].offset, 3400);
    assert.deepEqual(current.parts.map((p) => p.offset), [2750, 3900]);
    await page.keyboard.press('Delete');
    assert.equal((await data(page)).stored.length, 0);
    await page.keyboard.press('Control+z');
    current = await data(page);
    assert.equal(current.stored.length, 1); assert.equal(current.parts.length, 2);
    assert.deepEqual(app.errors, []);
  });

  it('боковые окна настраиваются до вставки, отключаются независимо и восстанавливаются с прежней шириной', async () => {
    const { page } = app;
    await place(page, 'glazed-swing-2400', async () => {
      await page.check('#presetWindowLeft');
      await page.fill('#presetWindowWidthLeft', '700');
      await page.press('#presetWindowWidthLeft', 'Tab');
    });
    let current = await data(page);
    assert.equal(current.stored[0].width, 3100);
    assert.deepEqual(current.parts.map((p) => p.width), [900, 700, 1500]);
    const at = await client(page, 2600, -125);
    await page.mouse.click(at.x, at.y);
    await page.waitForSelector('#openWindowLeft');
    await page.uncheck('#openWindowLeft');
    current = await data(page);
    assert.equal(current.stored[0].width, 2400);
    assert.deepEqual(current.parts.map((p) => p.width), [900, 1500]);
    await page.uncheck('#openWindowRight');
    current = await data(page);
    assert.equal(current.stored[0].width, 900);
    assert.equal(current.parts.length, 1);
    await page.check('#openWindowLeft');
    assert.equal((await data(page)).stored[0].width, 1600);
    await page.check('#openWindowRight');
    current = await data(page);
    assert.equal(current.stored[0].width, 3100);
    assert.deepEqual(current.parts.map((p) => p.width), [900, 700, 1500]);
    // Изменение, не помещающееся на стене, откатывается целиком.
    await page.fill('#openWindowWidthLeft', '7000'); await page.press('#openWindowWidthLeft', 'Tab');
    assert.equal((await data(page)).stored[0].width, 3100);
    assert.equal(await page.inputValue('#openWindowWidthLeft'), '700');
    await page.uncheck('#openWindowRight');
    await page.keyboard.press('Control+z');
    assert.equal((await data(page)).parts.length, 3);
    assert.deepEqual(app.errors, []);
  });
});

describe('оконно-дверной блок на телефоне', () => {
  let app;
  before(async () => { app = await startApp({ mobile: true }); await openNew(app.page); });
  after(async () => { await app?.close(); });
  it('категория и пресет доступны, одним тапом вставляется весь балконный блок', async () => {
    const { page } = app;
    await scene(page);
    await page.tap('#mobileBar [data-sheet="draw"]');
    await mobileSelectFamilyTool(page, 'openings', 'windowToolBtn');
    await page.tap('#openingCats [data-cat="with-door"]');
    await page.tap('#openingItems [data-preset="balcony-sliding-3000"]');
    await settleView(page);
    await page.evaluate(async () => {
      const { planToScreen, requestDraw } = await import('./ui/view.js');
      const { state } = window.__kepler;
      const canvas = document.getElementById('canvas');
      const p = planToScreen(3000, -125);
      state.view.panX += canvas.clientWidth / 2 - p.x;
      state.view.panY += canvas.clientHeight / 2 - p.y;
      requestDraw();
    });
    const p = await client(page, 3000, -125);
    await page.touchscreen.tap(p.x, p.y);
    const current = await data(page);
    assert.equal(current.stored.length, 1);
    assert.equal(current.parts.length, 2);
    assert.equal(current.parts[0].type, 'sliding');
    assert.equal(current.parts[1].sill, 900);
    await page.evaluate(async () => {
      const { cancelTool, selectObject } = await import('./ui/tools.js');
      cancelTool();
      selectObject({ type: 'opening', id: window.__kepler.state.project.openings[0].id });
    });
    await page.tap('#mobileBar [data-sheet="props"]');
    await page.tap('#openWindowLeft');
    assert.equal((await data(page)).parts.length, 3);
    await page.tap('#openWindowRight');
    assert.equal((await data(page)).parts.length, 2);
    await page.tap('#openWindowLeft');
    assert.equal((await data(page)).parts.length, 1);
    assert.equal((await data(page)).stored[0].width, 1800);
    assert.deepEqual(app.errors, []);
  });
});
