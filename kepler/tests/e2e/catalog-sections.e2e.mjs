import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { openSample, startApp } from './helpers.mjs';

async function openCatalog(page, mobile = true) {
  await openSample(page);
  if (mobile) {
    await page.tap('#mobileBar [data-sheet="rooms"]');
    await page.tap('#mobileCat [data-cat="furniture"]');
  } else await page.click('#furnitureToolBtn');
  await page.waitForSelector('#objectCatalogTabs:not([hidden])');
}

describe('Разделы библиотеки', () => {
  it('запоминает категорию мебели при переходе через кухню и проёмы, ищет предметы по всему каталогу', async () => {
    const { page, errors, close } = await startApp({ mobile: true });
    try {
      await openCatalog(page);
      const sections = page.locator('#objectSections');
      const category = (id) => page.locator(`#furnitureCategoryList [data-category="${id}"]`);
      const items = page.locator('#furnitureItems');
      await category('beds').tap();
      assert.ok(await items.locator('[data-kind="bed-double"]').isVisible());
      await sections.getByRole('button', { name: 'Кухня' }).tap();
      await category('appliance').tap();
      await sections.getByRole('button', { name: 'Окна' }).tap();
      assert.ok(await page.locator('#openingItems [data-preset]').first().isVisible());
      await page.tap('#catalogSearchToggle');
      await page.fill('#openSearch', '900');
      assert.ok(await page.locator('#openingItems [data-preset="win-900x1200"]').isVisible());
      assert.equal(await page.locator('#openingCats').isVisible(), false);
      await sections.getByRole('button', { name: 'Двери' }).tap();
      assert.equal(await page.locator('#openSearch').isVisible(), false);
      await sections.getByRole('button', { name: 'Мебель' }).tap();
      assert.equal(await category('beds').getAttribute('aria-pressed'), 'true');
      assert.equal(await page.evaluate(() => window.__kepler.state.tool), null);
      await page.tap('#catalogSearchToggle');
      await page.fill('#furnSearch', 'диван 2600 х 1600');
      assert.ok(await items.locator('[data-kind="sofa-corner"]').isVisible());
      assert.equal(await page.locator('#furnitureCategoryList').isVisible(), false);
      await page.locator('#furnSearch').press('Escape');
      assert.equal(await page.locator('#furnSearch').isVisible(), false);
      assert.ok(await items.locator('[data-kind="bed-double"]').isVisible());
      await sections.getByRole('button', { name: 'Кухня' }).tap();
      assert.equal(await category('appliance').getAttribute('aria-pressed'), 'true');
      assert.deepEqual(errors, []);
    } finally { await close(); }
  });

  for (const mobile of [true, false]) it(`Каталог ${mobile ? 'на узком телефоне' : 'на компьютере'}: в каждом разделе категории слева, карточки справа`, async () => {
    const { page, errors, close } = await startApp({ mobile });
    try {
      if (mobile) await page.setViewportSize({ width: 320, height: 568 });
      await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
      await openCatalog(page, mobile);
      const sections = page.locator('#objectSections');
      const nav = await sections.boundingBox();
      const last = await sections.getByRole('button', { name: 'Декор' }).boundingBox();
      assert.ok(last.x + last.width <= nav.x + nav.width + 1, 'все разделы помещаются в панели');
      for (const [section, rail, grid, category, item] of [
        ['Мебель', '#furnitureCategoryList', '#furnitureItems', '[data-category="beds"]', '[data-kind="bed-double"]'],
        ['Двери', '#openingCats', '#openingItems', '[data-cat="entrance"]', '[data-preset="entry-1000"]'],
        ['Окна', '#openingCats', '#openingItems', '[data-cat="wide"]', '[data-preset="win-2100x1500"]'],
        ['Кухня', '#furnitureCategoryList', '#furnitureItems', '[data-category="appliance"]', '[data-kind="fridge"]'],
        ['Санузел', '#furnitureCategoryList', '#furnitureItems', '[data-category="basins"]', '[data-kind="washbasin"]'],
        ['Декор', '#furnitureCategoryList', '#furnitureItems', '[data-category="lighting"]', '[data-kind="floor-lamp"]'],
      ]) {
        await sections.getByRole('button', { name: section }).click();
        const categories = page.locator(rail).getByRole('button');
        const cards = page.locator(grid).getByRole('button');
        const [top, next, first, second, pane] = await Promise.all([
          categories.first().boundingBox(), categories.nth(1).boundingBox(),
          cards.first().boundingBox(), cards.nth(1).boundingBox(), page.locator(grid).boundingBox(),
        ]);
        assert.ok(next.y >= top.y + top.height - 1 && next.x === top.x, `${section}: вертикальный список`);
        assert.ok(top.x + top.width <= first.x + 1 && first.y < top.y + top.height, `${section}: карточки справа`);
        assert.ok(second.x >= first.x + first.width - 1 && second.y === first.y, `${section}: две соседние карточки`);
        assert.ok(first.y + first.height <= pane.y + pane.height + 1, `${section}: целая карточка в экране`);
        await page.locator(rail).locator(category).click();
        assert.equal(await page.locator(rail).locator(category).getAttribute('aria-pressed'), 'true');
        assert.ok(await page.locator(grid).locator(item).isVisible());
      }
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth === innerWidth), true);
      await sections.getByRole('button', { name: 'Мебель' }).click();
      if (mobile) await page.tap('#catalogSearchToggle');
      assert.ok(await page.locator('#furnSearch').isVisible());
      assert.deepEqual(errors, []);
    } finally { await close(); }
  });
});
