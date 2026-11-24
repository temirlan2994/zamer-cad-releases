// e2e удобств: шаблоны в стартовом меню, справка, поиск мебели, единицы.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp } from './helpers.mjs';

describe('шаблоны и удобства', () => {
  let app;
  before(async () => { app = await startApp({ issueGroups: 'all' }); });
  after(async () => { await app?.close(); });

  it('стартовое меню: четыре шаблона; двухэтажный открывается с этажами', async () => {
    const titles = await app.page.$$eval('#startTemplates [data-template] b', (ns) => ns.map((n) => n.textContent));
    assert.equal(titles.length, 4);
    assert.ok(titles.includes('Вилла у воды'));
    await app.page.click('#startTemplates [data-template="two-storey"]');
    await app.page.waitForSelector('#startScreen', { state: 'hidden' });
    const s = await app.page.evaluate(() => {
      const p = window.__kepler.state.project;
      return { levels: p.levels.map((l) => l.rooms.length), bar: [...document.querySelectorAll('#levelBar button')].map((b) => b.textContent) };
    });
    assert.deepEqual(s.levels, [5, 6]);
    assert.deepEqual(s.bar, ['1 этаж', '2 этаж', '+']);
    const active = await app.page.evaluate(() => window.__kepler.state.project.activeLevel);
    assert.match(await app.page.textContent(`#issuesPanel [data-issue-id="access:${active}:ok"]`), /доступны от входа/);
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

  it('поиск мебели по всему каталогу; смена раздела сбрасывает пустой результат', async () => {
    await app.page.click('#furnitureToolBtn');
    await app.page.fill('#furnSearch', 'ванн');
    const found = await app.page.$$eval('#furnitureItems .chip-name', (ns) => ns.map((n) => n.textContent));
    assert.ok(found.length >= 1 && found.every((t) => /ванн/i.test(t)), found.join(', '));
    await app.page.fill('#furnSearch', 'нет-такой-мебели');
    assert.match(await app.page.textContent('#furnitureItems'), /Ничего не нашлось/);
    await app.page.click('#objectSections [data-object-section="bath"]');
    assert.equal(await app.page.inputValue('#furnSearch'), '');
    assert.ok(await app.page.$$eval('#furnitureItems .furniture-chip', (ns) => ns.length) > 0);
    await app.page.$eval('#libTabRooms', (n) => n.click());
  });

  it('размеры в метрах', async () => {
    await app.page.keyboard.press('Escape');
    await app.page.keyboard.press('Escape'); // закрыть библиотеку
    await app.page.click('#projectSummary'); // настройки проекта — свёрнутая секция «Проект»
    await app.page.selectOption('#unitsSel', 'm');
    assert.equal(await app.page.evaluate(() => window.__kepler.state.project.settings.units), 'm');
  });

  it('отмена не подменяет загруженный шаблон пустым проектом', async () => {
    await app.page.keyboard.press('Control+z'); // единицы
    await app.page.keyboard.press('Control+z'); // загрузка шаблона в пустой проект — в историю не попадает
    const state = await app.page.evaluate(() => ({
      name: window.__kepler.state.project.name,
      rooms: window.__kepler.state.project.rooms.length,
    }));
    assert.notEqual(state.name, 'Новый дом');
    assert.ok(state.rooms > 0);
  });

  it('без ошибок в консоли', () => {
    assert.deepEqual(app.errors, []);
  });

  it('карточка виллы открывает редактируемый дом в перспективе со стороны пруда', async () => {
    const { page } = app;
    if (await page.isHidden('#startScreen')) await page.click('#menuBtn');
    await page.click('#startTemplates [data-template="garden-villa"]');
    await page.waitForSelector('#view3d', { state: 'visible' });
    const model = await page.evaluate(() => {
      const { state, debug3d } = window.__kepler;
      const { faces, cam } = debug3d();
      return { name: state.project.name, floors: state.project.levels.length, faces, cam };
    });
    assert.equal(model.name, 'Вилла у воды');
    assert.equal(model.floors, 2);
    assert.ok(model.faces > 50);
    assert.equal(model.cam.projection, 'perspective');
    assert.ok(Math.abs(model.cam.pitch) < 0.2, 'взгляд с уровня пешехода');
    assert.deepEqual(app.errors, []);
  });
});
