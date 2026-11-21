// Перенос из мобильного каталога настоящими касаниями Chromium.
import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { openSample, startApp, zoomToItems } from './helpers.mjs';

describe('мобильный каталог мебели', () => {
  let app, page, card, count, origin, target, cdp;

  async function touch(type, point) {
    cdp ||= await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type, touchPoints: point ? [{ ...point, id: 1 }] : [] });
    if (!point) { await cdp.detach(); cdp = null; }
  }

  async function hold() {
    await touch('touchStart', origin);
    await page.waitForSelector('.library.furniture-dragging');
  }

  const state = () => page.evaluate(() => {
    const { project, ghostItem, selection, tool } = window.__kepler.state;
    return { count: project.items.length, ghost: ghostItem?.kind, tool: tool?.kind,
      selected: project.items.find((item) => item.id === selection?.id), toast: document.querySelector('#toast').classList.contains('show') };
  });

  beforeEach(async () => {
    app = await startApp({ mobile: true }); page = app.page; cdp = null;
    await openSample(page);
    await page.tap('#mobileBar [data-sheet="rooms"]');
    await page.tap('#mobileCat [data-cat="furniture"]');
    card = page.locator('#furnitureItems .furniture-chip[data-kind="sofa-corner"]');
    await card.scrollIntoViewIfNeeded();
    const b = await card.boundingBox(), canvas = await page.locator('#canvas').boundingBox();
    origin = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    target = { x: canvas.x + canvas.width * .55, y: canvas.y + 105 };
    count = (await state()).count;
  });
  afterEach(async () => { await app?.close(); });

  it('тап по карточке и тап на плане ставят один выбранный диван, сообщение не закрывает следующий каталог', async () => {
    await card.tap();
    assert.equal((await state()).tool, 'place-furniture');
    await page.touchscreen.tap(target.x, target.y);
    const placed = await state();
    assert.equal(placed.count, count + 1); assert.equal(placed.selected.kind, 'sofa-corner');
    assert.equal(await page.locator('#mobileCardTitle').innerText(), 'Угловой диван');
    await page.tap('#mobileCat [data-cat="furniture"]');
    assert.equal(await card.isVisible(), true); assert.equal((await state()).toast, false);
    assert.deepEqual(app.errors, []);
  });

  it('удержание показывает призрак в точке переноса и создаёт одну отменяемую операцию', async () => {
    await hold(); await touch('touchMove', target);
    const preview = await page.evaluate(() => window.__kepler.state.ghostItem);
    assert.equal(preview?.kind, 'sofa-corner'); assert.equal((await state()).count, count);
    await touch('touchEnd'); await page.waitForSelector('#mobileCard');
    const placed = await state();
    assert.equal(placed.count, count + 1); assert.equal(placed.tool, undefined); assert.equal(placed.ghost, undefined);
    assert.equal(placed.selected.kind, 'sofa-corner');
    assert.deepEqual([placed.selected.x, placed.selected.y], [preview.x, preview.y]);
    await page.tap('#undoBtn'); assert.equal((await state()).count, count);
    assert.deepEqual(app.errors, []);
  });

  it('«Модули» включает точки дивана, смена предмета и открытие каталога выключают их', async () => {
    const modules = page.getByRole('button', { name: 'Модули', exact: true });
    await card.tap(); await page.touchscreen.tap(target.x, target.y);
    await modules.waitFor();
    const item = (await state()).selected;
    await zoomToItems(page, .085, [item.id]);
    assert.equal(await modules.getAttribute('aria-pressed'), 'false');
    assert.equal(await page.evaluate(() => window.__kepler.state._sofaUI), null);
    const canvas = await page.locator('#canvas').boundingBox();
    async function tapPlus(end) {
      const handle = await page.waitForFunction((side) => window.__kepler.state._sofaUI?.spots.find((s) => s.end === side), end);
      const spot = await handle.jsonValue();
      await page.touchscreen.tap(canvas.x + spot.x, canvas.y + spot.y);
      await page.waitForSelector('#sofaMenu:not([hidden])');
      const menu = await page.locator('#sofaMenu').boundingBox();
      const ribbon = await page.locator('#mobileCat').boundingBox();
      assert.ok(menu.x >= 0 && menu.x + menu.width <= canvas.width);
      assert.ok(menu.y + menu.height <= ribbon.y);
    }
    await modules.tap(); await tapPlus('end');
    await page.tap('#sofaMenu [data-sofa-add="seat"]');
    assert.equal((await state()).selected.comp.modules.length, item.comp.modules.length + 1);
    assert.equal(await modules.getAttribute('aria-pressed'), 'true');
    await tapPlus('start');
    assert.equal((await state()).selected.comp.modules.length, item.comp.modules.length + 1, 'тап по точке только открывает меню');
    await page.tap('#mobileCat [data-cat="furniture"]');
    assert.equal(await page.locator('#sofaMenu').isVisible(), false);
    assert.equal(await page.evaluate(() => window.__kepler.state._sofaUI), null);
    await page.tap('.library .sheet-grip .sheet-close');
    assert.equal(await modules.getAttribute('aria-pressed'), 'false');
    await modules.tap(); await page.tap('#mobileCard [data-selection-action="duplicate"]');
    await page.waitForFunction((old) => window.__kepler.state.selection?.id !== old, item.id);
    await page.waitForFunction(() => document.querySelector('#mobileSofaModules').getAttribute('aria-pressed') === 'false');
    assert.equal(await page.evaluate(() => window.__kepler.state._sofaUI), null);
    await page.evaluate(() => {
      window.__kepler.select(null);
      document.querySelector('#mobileSofaModules').click(); // запоздавший клик до перерисовки карточки
    });
    assert.equal(await page.evaluate(() => window.__kepler.state.phoneSofaEdit), null);
    assert.deepEqual(app.errors, []);
  });

  it('возврат к карточке и отмена касания очищают призрак и сохраняют каталог', async () => {
    await hold(); await touch('touchMove', target); await touch('touchMove', origin); await touch('touchEnd');
    await hold(); await touch('touchMove', target); await touch('touchCancel');
    assert.equal(await card.isVisible(), true); assert.equal((await state()).count, count);
    assert.equal((await state()).tool, undefined); assert.equal((await state()).ghost, undefined);
    assert.deepEqual(app.errors, []);
  });

  it('свайп до удержания прокручивает список без выбора предмета', async () => {
    const b = await card.boundingBox();
    const scrollTop = () => page.locator('#furnitureItems').evaluate((list) => list.scrollTop);
    const before = await scrollTop();
    const x = b.x + b.width / 2, y = b.y + b.height / 2;
    await touch('touchStart', { x, y });
    for (let dy = 12; dy <= 72; dy += 12) await touch('touchMove', { x, y: y - dy });
    await touch('touchEnd');
    assert.ok(await scrollTop() > before);
    assert.equal((await state()).count, count); assert.equal((await state()).tool, undefined);
    assert.equal(await page.locator('.library.furniture-dragging').count(), 0);
    assert.deepEqual(app.errors, []);
  });
});
