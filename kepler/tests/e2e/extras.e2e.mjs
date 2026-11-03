// e2e удобств: шаблоны в стартовом меню, справка, поиск мебели, единицы.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp } from './helpers.mjs';

describe('шаблоны и удобства', () => {
  let app;
  before(async () => { app = await startApp(); });
  after(async () => { await app?.close(); });

  it('стартовое меню: три шаблона; двухэтажный открывается с этажами', async () => {
    const titles = await app.page.$$eval('#startTemplates .start-item b', (ns) => ns.map((n) => n.textContent));
    assert.equal(titles.length, 3);
    await app.page.click('#startTemplates [data-template="two-storey"]');
    await app.page.waitForSelector('#startScreen', { state: 'hidden' });
    const s = await app.page.evaluate(() => {
      const p = window.__kepler.state.project;
      return { levels: p.levels.map((l) => l.rooms.length), bar: [...document.querySelectorAll('#levelBar button')].map((b) => b.textContent) };
    });
    assert.deepEqual(s.levels, [5, 6]);
    assert.deepEqual(s.bar, ['1 этаж', '2 этаж', '+']);
    assert.match(await app.page.textContent('#connectivityBar'), /доступны/);
  });

  it('справка: «?» открывает, Esc закрывает, кнопка и клик мимо', async () => {
    await app.page.keyboard.press('Shift+Slash');
    assert.equal(await app.page.isVisible('#helpScreen'), true);
    await app.page.keyboard.press('Escape');
    assert.equal(await app.page.isVisible('#helpScreen'), false);
    await app.page.click('#helpBtn');
    assert.equal(await app.page.isVisible('#helpScreen'), true);
    await app.page.mouse.click(5, 5); // фон вокруг карточки
    assert.equal(await app.page.isVisible('#helpScreen'), false);
  });

  it('поиск мебели по всему каталогу; клик по категории сбрасывает', async () => {
    await app.page.click('#libTabFurniture');
    await app.page.fill('#furnSearch', 'ванн');
    const found = await app.page.$$eval('#furnitureItems .chip-name', (ns) => ns.map((n) => n.textContent));
    assert.ok(found.length >= 1 && found.every((t) => /ванн/i.test(t)), found.join(', '));
    await app.page.fill('#furnSearch', 'нет-такой-мебели');
    assert.match(await app.page.textContent('#furnitureItems'), /Ничего не нашлось/);
    await app.page.click('#furnitureCats button >> nth=0');
    assert.equal(await app.page.inputValue('#furnSearch'), '');
    assert.ok(await app.page.$$eval('#furnitureItems .furniture-chip', (ns) => ns.length) > 0);
    await app.page.click('#libTabRooms');
  });

  it('размеры в метрах', async () => {
    await app.page.keyboard.press('Escape');
    await app.page.selectOption('#unitsSel', 'm');
    assert.equal(await app.page.evaluate(() => window.__kepler.state.project.settings.units), 'm');
  });

  it('отмена возвращает прежний проект', async () => {
    await app.page.keyboard.press('Control+z'); // единицы
    await app.page.keyboard.press('Control+z'); // шаблон
    const name = await app.page.evaluate(() => window.__kepler.state.project.name);
    assert.equal(name, 'Новый дом');
  });

  it('без ошибок в консоли', () => {
    assert.deepEqual(app.errors, []);
  });
});
