import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { openSample, startApp } from './helpers.mjs';

async function openCatalog(page) {
  await openSample(page);
  await page.tap('#mobileBar [data-sheet="rooms"]');
  await page.tap('#mobileCat [data-cat="furniture"]');
  await page.waitForSelector('#objectCatalogTabs:not([hidden])');
}

describe('Разделы мобильной библиотеки', () => {
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
      assert.equal(await page.locator('#openSearch').inputValue(), '900');
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

  it('при ширине 320 пикселей все разделы доступны и целиком видны две соседние карточки', async () => {
    const { page, errors, close } = await startApp({ mobile: true });
    try {
      await page.setViewportSize({ width: 320, height: 568 });
      await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
      await openCatalog(page);
      const bounds = await page.evaluate(() => {
        const rect = (el) => el.getBoundingClientRect();
        const grid = document.querySelector('#furnitureItems');
        const [a, b] = [...grid.children].map(rect);
        const nav = document.querySelector('#objectSections');
        const last = rect(nav.lastElementChild);
        return { sameRow: a.y === b.y, bottom: a.bottom, gridBottom: rect(grid).bottom,
          beside: b.left >= a.right, navFits: last.right <= rect(nav).right + 1,
          pageFits: document.documentElement.scrollWidth === innerWidth };
      });
      assert.ok(bounds.sameRow && bounds.beside && bounds.bottom <= bounds.gridBottom);
      assert.ok(bounds.navFits && bounds.pageFits);
      await page.tap('#catalogSearchToggle');
      assert.ok(await page.locator('#furnSearch').isVisible());
      assert.deepEqual(errors, []);
    } finally { await close(); }
  });
});
