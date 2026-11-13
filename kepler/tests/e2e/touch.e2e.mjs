// e2e телефона: панели снизу, размещение касанием, щипок, панорама пальцем.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, openSample } from './helpers.mjs';

// Касания через протокол Chrome (Playwright умеет только одиночный тап).
// Жест от касания до отпускания — в одной сессии; после него сессия
// закрывается, иначе обычные тапы Playwright перестают давать click.
let cdp = null;
async function touch(page, type, points) {
  const box = await (await page.$('#canvas')).boundingBox();
  cdp ||= await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', {
    type,
    touchPoints: points.map((p, id) => ({ x: box.x + p.x, y: box.y + p.y, id })),
  });
  if (type === 'touchEnd') { await cdp.detach(); cdp = null; }
}

const view = (page) => page.evaluate(() => ({ ...window.__kepler.state.view }));
const canvasBox = async (page) => (await page.$('#canvas')).boundingBox();

describe('телефон', () => {
  let app;
  before(async () => { app = await startApp({ mobile: true }); await openSample(app.page); });
  after(async () => { await app?.close(); });

  it('холст — всё, кроме узкой колонки инструментов; нижняя панель вместо боковых', async () => {
    const box = await canvasBox(app.page);
    assert.ok(box.width >= 320, `ширина холста ${box.width}`);
    assert.ok(box.height >= 500, `высота холста ${box.height}`);
    assert.equal(await app.page.isVisible('#mobileBar'), true);
    assert.equal(await app.page.isVisible('#propsPanel'), false);
  });

  // До синтетических жестов: быстрый свайп эмулятор считает «броском», и
  // следующий тап только останавливает его (на телефоне так же).
  it('«Свойства» открываются и закрываются', async () => {
    await app.page.tap('#mobileBar [data-sheet="props"]');
    await app.page.waitForSelector('#propsPanel', { state: 'visible' });
    assert.ok(await app.page.evaluate(() => document.body.classList.contains('sheet-props')));
    await app.page.tap('#mobileBar [data-sheet="props"]');
    await app.page.waitForFunction(() => !document.body.classList.contains('sheet-props'));
    await app.page.waitForSelector('#propsPanel', { state: 'hidden' });
  });

  it('«Помещения» → тап по карточке → тап по плану ставит комнату', async () => {
    const before = await app.page.evaluate(() => window.__kepler.state.project.rooms.length);
    await app.page.tap('#mobileBar [data-sheet="rooms"]');
    await app.page.tap('#mobileCat [data-cat="room"]');
    await app.page.waitForFunction(() => document.body.classList.contains('sheet-library'));
    await app.page.tap('#roomCards .room-card >> text=Терраса');
    assert.equal(await app.page.evaluate(() => document.body.classList.contains('sheet-library')), false, 'библиотека уехала');
    const box0 = await canvasBox(app.page);
    const strip = await app.page.locator('#toolStrip').boundingBox(); // холст — справа от колонки инструментов
    assert.ok(Math.abs(box0.y - strip.y) < 2 && box0.y > 30 && box0.y < 130, `холст не уехал прокруткой: y=${box0.y}`);
    // Пустое место под домом.
    const at = await app.page.evaluate(() => {
      const k = window.__kepler;
      const rooms = k.state.project.rooms;
      const maxY = Math.max(...rooms.map((r) => r.y + r.h));
      const minX = Math.min(...rooms.map((r) => r.x));
      return k.planToScreen(minX + 2500, maxY + 2500);
    });
    const box = await canvasBox(app.page);
    await app.page.touchscreen.tap(box.x + at.x, box.y + at.y);
    const after = await app.page.evaluate(() => window.__kepler.state.project.rooms.length);
    assert.equal(after, before + 1);
  });

  it('щипок двумя пальцами меняет масштаб', async () => {
    const v0 = await view(app.page);
    await touch(app.page, 'touchStart', [{ x: 150, y: 300 }, { x: 230, y: 300 }]);
    for (const d of [60, 100, 140]) {
      await touch(app.page, 'touchMove', [{ x: 190 - d, y: 300 }, { x: 190 + d, y: 300 }]);
    }
    await touch(app.page, 'touchEnd', []);
    const v1 = await view(app.page);
    assert.ok(v1.scale > v0.scale * 2.5, `масштаб ${v0.scale} → ${v1.scale}`);
  });

  it('один палец по пустому месту двигает план', async () => {
    // Уводим дом за край экрана — под пальцем гарантированно пусто.
    await app.page.evaluate(() => { window.__kepler.state.view.panX -= 5000; });
    const v0 = await view(app.page);
    const p = { x: 200, y: 300 };
    await touch(app.page, 'touchStart', [p]);
    await touch(app.page, 'touchMove', [{ x: p.x + 60, y: p.y - 40 }]);
    await touch(app.page, 'touchMove', [{ x: p.x + 120, y: p.y - 80 }]);
    await touch(app.page, 'touchEnd', []);
    const v1 = await view(app.page);
    assert.ok(Math.abs(v1.panX - v0.panX - 120) < 2 && Math.abs(v1.panY - v0.panY + 80) < 2, `сдвиг ${v1.panX - v0.panX}, ${v1.panY - v0.panY}`);
  });

  it('«Экспорт» открывается целиком поверх холста и закрывается по Esc', async () => {
    await app.page.evaluate(() => window.scrollTo(0, 0));
    await app.page.tap('#moreBtn'); // телефон: «Экспорт» — в листе «Ещё»
    await app.page.tap('#mobileMore [data-more="export"]');
    await app.page.waitForSelector('#exportDropdown', { state: 'visible' });
    const box = await (await app.page.$('#exportDropdown')).boundingBox();
    const vp = app.page.viewportSize();
    assert.ok(box.x >= 0 && box.x + box.width <= vp.width + 1, 'меню экспорта вылезает за экран по ширине');
    const first = await (await app.page.$('#exportDropdown button')).boundingBox();
    const top = await app.page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('#exportDropdown') !== null, { x: first.x + 10, y: first.y + 10 });
    assert.equal(top, true, 'первый пункт перекрыт шапкой');
    await app.page.keyboard.press('Escape');
    assert.equal(await app.page.isHidden('#exportDropdown'), true);
  });

  it('выбор инструмента участка закрывает нижнюю панель', async () => {
    await app.page.tap('#mobileBar [data-sheet="more"]'); // телефон: режимы — в листе «Ещё»
    await app.page.tap('#mobileMore [data-more="site"]');
    assert.equal(await app.page.isHidden('#mobileBar [data-sheet="rooms"]'), true, 'в «Участке» каталога нет');
    await app.page.tap('#mobileBar [data-sheet="props"]');
    await app.page.waitForFunction(() => document.body.classList.contains('sheet-props'));
    await app.page.waitForSelector('#siteTools .tb-btn', { state: 'visible' });
    await app.page.tap('#siteTools .tb-btn >> nth=3');
    await app.page.waitForFunction(() => !document.body.classList.contains('sheet-props'));
    assert.equal(await app.page.evaluate(() => window.__kepler.state.tool?.target), 'road', '«Дорога» — черчение или правка оси');
    await app.page.keyboard.press('Escape');
    await app.page.evaluate(() => document.getElementById('modePlanBtn').click());
  });

  it('без ошибок в консоли', () => {
    assert.deepEqual(app.errors, []);
  });
});
