// Дымовые e2e: загрузка, панели, вкладки, переключатели.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { clickToolbarTool, startApp, openSample } from './helpers.mjs';
import { ROOM_CATEGORIES, ROOM_TYPES } from '../../core/catalog.js';

describe('smoke', () => {
  let app;
  before(async () => { app = await startApp(); });
  after(async () => { await app?.close(); });

  it('при первом запуске — стартовое меню', async () => {
    assert.equal(await app.page.$eval('#startScreen', (n) => n.hidden), false);
    assert.equal(await app.page.isVisible('#startProjectsView'), true, 'локальная разработка открывает выбор проектов');
    assert.equal(await app.page.isVisible('#startNew'), true);
    assert.equal(await app.page.isVisible('#startOpen'), true);
    assert.equal(await app.page.$$eval('#startTemplates .startup-project-card', (nodes) => nodes.length), 4);
  });

  it('пример загружается без ошибок', async () => {
    await openSample(app.page);
    const rooms = await app.page.evaluate(() => window.__kepler.state.project.rooms.length);
    assert.ok(rooms >= 4, `ожидали ≥4 комнат, получили ${rooms}`);
    assert.deepEqual(app.errors, []);
  });

  it('вкладки «Помещения» / «Мебель» переключают панели', async () => {
    const hidden = (sel) => app.page.$eval(sel, (n) => n.hidden);
    assert.equal(await app.page.isVisible('.library'), false, 'без инструмента библиотека скрыта');
    await app.page.click('#boundRoomBtn'); // «Помещение» — библиотека типов комнат
    assert.equal(await app.page.isVisible('#roomCards'), true);
    assert.equal(await hidden('#libraryTop'), false);
    assert.equal(await hidden('#furnitureBar'), true);
    await app.page.$eval('#libTabFurniture', (n) => n.click());
    assert.equal(await hidden('#libraryTop'), true);
    assert.equal(await hidden('#furnitureBar'), false);
    await app.page.$eval('#libTabRooms', (n) => n.click());
    assert.equal(await hidden('#libraryTop'), false);
  });

  it('карточки помещений: все типы по группам, перетаскиваемые', async () => {
    const chips = await app.page.$$eval('#roomCards .room-card', (ns) => ns.map((n) => n.draggable));
    assert.equal(chips.length, ROOM_TYPES.length);
    assert.equal(await app.page.$$eval('#roomCards .room-group', (ns) => ns.length), ROOM_CATEGORIES.length);
    assert.ok(chips.every(Boolean));
  });

  it('мебель: иконки категорий и превью-канвасы', async () => {
    await app.page.$eval('#libTabFurniture', (n) => n.click()); // библиотека открыта «Помещением»
    const cats = await app.page.$$('#furnitureCats button');
    assert.equal(cats.length, 16);
    const chips = await app.page.$$('#furnitureItems .furniture-chip');
    const canvases = await app.page.$$('#furnitureItems .furniture-chip canvas');
    assert.ok(chips.length > 0);
    assert.equal(canvases.length, chips.length);
    await cats[6].click(); // санузел
    const after = await app.page.$$('#furnitureItems .furniture-chip');
    assert.ok(after.length > 0);
    await app.page.$eval('#libTabRooms', (n) => n.click());
    await app.page.click('#selectToolBtn'); // закрыть библиотеку
  });

  it('переключатель наружных размеров', async () => {
    const btn = '#dimModeBtn';
    const before = await app.page.textContent(btn);
    await clickToolbarTool(app.page, 'dimModeBtn');
    const after = await app.page.textContent(btn);
    assert.notEqual(before, after);
    await clickToolbarTool(app.page, 'dimModeBtn');
    assert.equal(await app.page.textContent(btn), before);
  });

  it('режим «Участок» показывает инструменты участка', async () => {
    await app.page.click('#modeSiteBtn');
    assert.equal(await app.page.$eval('#libraryTabs', (n) => n.hidden), true);
    assert.equal(await app.page.$eval('#siteTools', (n) => n.hidden), false);
    assert.ok(await app.page.$('#importUnderlay'), 'кнопка импорта топосъёмки');
    await app.page.click('#modePlanBtn');
  });

  it('за всю сессию нет ошибок в консоли', () => {
    assert.deepEqual(app.errors, []);
  });
});

describe('обязательный вход', () => {
  let app;
  before(async () => { app = await startApp({ query: 'authGate=1' }); });
  after(async () => { await app?.close(); });

  it('до Google-входа показывает только экран аккаунта', async () => {
    assert.equal(await app.page.isVisible('#startAuthView'), true);
    assert.equal(await app.page.isVisible('#startGoogleSignIn'), true);
    assert.equal(await app.page.isHidden('#startProjectsView'), true);
    assert.equal(await app.page.isHidden('#startNew'), true);
    assert.equal(await app.page.isHidden('#startOpen'), true);
    assert.deepEqual(app.errors, []);
  });
});

describe('без ?debug', () => {
  let app;
  before(async () => { app = await startApp({ debug: false }); });
  after(async () => { await app?.close(); });

  it('отладочный API не публикуется, приложение работает', async () => {
    assert.equal(await app.page.evaluate(() => typeof window.__kepler), 'undefined');
    await app.page.click('#startSample');
    await app.page.waitForSelector('#startScreen', { state: 'hidden' });
    await app.page.click('#propsTabTep'); // площади — на вкладке «ТЭП и площади»
    assert.match(await app.page.textContent('#propsPanel'), /м²/);
    assert.deepEqual(app.errors, []);
  });
});
