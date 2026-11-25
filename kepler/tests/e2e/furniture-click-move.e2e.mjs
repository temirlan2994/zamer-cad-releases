import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, openNew, settleView, zoomToItems } from './helpers.mjs';

async function scene(page, grouped = false) {
  const ids = await page.evaluate(async (grouped) => {
    const { createRoom, createItem } = await import('./core/model.js');
    const { mutate } = await import('./ui/store.js');
    const { selectObject } = await import('./ui/tools.js');
    const { snapSettings } = await import('./ui/draw-snap-ui.js');
    const { state } = window.__kepler;
    const items = [createItem('bed-double', 3000, 2500, 1600, 2000)];
    if (grouped) {
      items.push(createItem('nightstand', 1800, 3250, 500, 500), createItem('nightstand', 4200, 3250, 500, 500));
      items.forEach((item) => { item.group = 'bed-set'; });
    }
    mutate(() => {
      state.project.rooms = [createRoom('bedroom', 0, 0, 6000, 5000)];
      state.project.items = items;
    });
    snapSettings().guides = false;
    selectObject(grouped
      ? { type: 'multi', roomIds: [], itemIds: items.map((item) => item.id), wallIds: [] }
      : { type: 'item', id: items[0].id });
    window.__kepler.fitView();
    return items.map((item) => item.id);
  }, grouped);
  await zoomToItems(page, 0.12, ids);
  return ids;
}

async function client(page, x, y) {
  await settleView(page);
  return page.evaluate(([x, y]) => {
    const b = document.getElementById('canvas').getBoundingClientRect();
    const p = window.__kepler.planToScreen(x, y);
    return { x: b.x + p.x, y: b.y + p.y };
  }, [x, y]);
}
const positions = (page) => page.evaluate(() => window.__kepler.state.project.items.map(({ x, y }) => ({ x, y })));
async function start(page) {
  await page.click('[data-selection-action="move-furniture"]');
  await page.waitForFunction(() => window.__kepler.state.tool?.kind === 'move-furniture');
}
async function pick(page) {
  const p = await client(page, 3000, 2500);
  await page.mouse.click(p.x, p.y);
  await page.waitForFunction(() => window.__kepler.state.tool?.stage === 'place');
}

describe('перемещение мебели кликами', () => {
  let app;
  before(async () => { app = await startApp({ width: 1400, height: 900 }); await openNew(app.page); });
  after(async () => { await app?.close(); });

  it('два клика без удержания, размеры вживую, фиксация и один Undo', async () => {
    const { page } = app;
    await scene(page);
    await start(page);
    await pick(page);
    const target = await client(page, 3400, 2700);
    await page.mouse.move(target.x, target.y, { steps: 5 });
    assert.deepEqual(await positions(page), [{ x: 3400, y: 2700 }]);
    const dims = await page.evaluate(() => window.__kepler.state._tempDimsUI.dims.map((d) => [d.dir, d.value]));
    assert.equal(Object.fromEntries(dims).left, 2600);
    await page.mouse.click(target.x, target.y);
    assert.equal(await page.evaluate(() => window.__kepler.state.tool), null);
    const away = await client(page, 3800, 3100);
    await page.mouse.move(away.x, away.y);
    assert.deepEqual(await positions(page), [{ x: 3400, y: 2700 }]);
    await page.keyboard.press('Control+z');
    assert.deepEqual(await positions(page), [{ x: 3000, y: 2500 }]);
    await page.keyboard.press('Control+y');
    assert.deepEqual(await positions(page), [{ x: 3400, y: 2700 }]);
  });

  it('кровать с тумбами переносится целиком, Esc откатывает весь комплект', async () => {
    const { page } = app;
    await scene(page, true);
    const before = await positions(page);
    await start(page);
    await pick(page);
    const target = await client(page, 3400, 2700);
    await page.mouse.move(target.x, target.y, { steps: 5 });
    assert.deepEqual(await positions(page), before.map(({ x, y }) => ({ x: x + 400, y: y + 200 })));
    await page.keyboard.press('Escape');
    assert.deepEqual(await positions(page), before);
    assert.equal(await page.evaluate(() => window.__kepler.state.tool), null);
    // После отмены движения мыши не продолжают перенос.
    await page.mouse.move(target.x + 40, target.y + 20);
    assert.deepEqual(await positions(page), before);
    await start(page);
    await pick(page);
    const drop = await client(page, 3400, 2700);
    await page.mouse.click(drop.x, drop.y);
    assert.deepEqual(await positions(page), before.map(({ x, y }) => ({ x: x + 400, y: y + 200 })));
    await page.keyboard.press('Control+z');
    assert.deepEqual(await positions(page), before);
  });

  it('кнопка отмены и клик вне плана возвращают исходные координаты', async () => {
    const { page } = app;
    await scene(page);
    for (const outside of ['[data-selection-action="cancel-move"]', '#projectName']) {
      await start(page);
      await pick(page);
      const target = await client(page, 3400, 2700);
      await page.mouse.move(target.x, target.y);
      await page.click(outside);
      assert.deepEqual(await positions(page), [{ x: 3000, y: 2500 }]);
      assert.equal(await page.evaluate(() => window.__kepler.state.tool), null);
    }
    assert.deepEqual(app.errors, []);
  });
});

describe('перенос мебели двумя касаниями', () => {
  let app;
  before(async () => { app = await startApp({ mobile: true }); await openNew(app.page); });
  after(async () => { await app?.close(); });
  it('тап захватывает мебель, следующий тап ставит её без удержания', async () => {
    const { page } = app;
    await scene(page);
    await page.tap('[data-selection-action="move-furniture"]');
    await page.waitForFunction(() => window.__kepler.state.tool?.kind === 'move-furniture');
    const a = await client(page, 3000, 2500);
    await page.touchscreen.tap(a.x, a.y);
    await page.waitForFunction(() => window.__kepler.state.tool?.stage === 'place');
    const b = await client(page, 3400, 2700);
    await page.touchscreen.tap(b.x, b.y);
    assert.deepEqual(await positions(page), [{ x: 3400, y: 2700 }]);
    assert.equal(await page.evaluate(() => window.__kepler.state.tool), null);
    assert.deepEqual(app.errors, []);
  });
});
