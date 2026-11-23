// e2e: режим «Эргономика» (core/ergonomics.js, ui/render-ergonomics.js,
// ui/ergonomics.js). Кнопка в колонке и клавиша E, красная зона у тесно
// стоящей кровати, перетаскивание мышью в норму — красное исчезает, счётчик
// на кнопке, группа «Эргономика» в «Замечаниях» и переход к предмету,
// «Эргономика предмета» в «Свойствах» («Показать», «Исправить»), настройка
// запоминается, печать без зон, на телефоне кнопка видна.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, worldToClient, zoomToItems, openRouteView } from './helpers.mjs';

const frame = (page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
const drawn = async (page) => { await frame(page); return page.evaluate(() => window.__kepler.state._ergoDrawn); };

// Красных пикселей «эргономики» в квадрате 21×21 вокруг точки плана.
async function redAt(page, at) {
  await frame(page);
  const c = await worldToClient(page, at.x, at.y);
  return page.evaluate(([cx, cy]) => {
    const cv = document.getElementById('canvas');
    const r = cv.getBoundingClientRect();
    const k = cv.width / r.width;
    const d = cv.getContext('2d').getImageData(Math.round((cx - r.x) * k) - 10, Math.round((cy - r.y) * k) - 10, 21, 21).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] > 180 && d[i] - d[i + 1] > 60 && d[i] - d[i + 2] > 50) n += 1;
    return n;
  }, [c.x, c.y]);
}

// Спальня 3000×4000, дверь внизу справа; кровать у верхней стены, слева щель 300 мм.
async function scene(page) {
  await page.evaluate(async () => {
    const m = await import('./core/model.js');
    const store = await import('./ui/store.js');
    const st = window.__kepler.state;
    const p = m.createProject('Эргономика');
    const r = m.createRoom('bedroom', 0, 0, 3000, 4000);
    p.rooms.push(r);
    p.openings.push(m.createOpening('door', r.id, 2, 2300, 800));
    const bed = m.createItem('bed-double', 300 + 800, 1000, 1600, 2000);
    bed.id = 'bed';
    p.items.push(bed);
    st.project = p;
    st.selection = null;
    store.refreshDerived();
    store.afterChange();
    window.__kepler.fitView();
  });
}

describe('режим «Эргономика»', () => {
  let app;
  before(async () => {
    app = await startApp({ width: 1400, height: 900 });
    const { page } = app;
    await page.evaluate(() => localStorage.removeItem('kepler-ergo'));
    await page.click('#startNew');
    await page.waitForFunction(() => document.getElementById('startScreen').hidden);
    await scene(page);
  });
  after(async () => { await app?.close(); });

  it('изначально выключен и доступен в разделе «Движение»', async () => {
    const { page } = app;
    assert.equal(await drawn(page), null);
    await openRouteView(page, 'circulation');
    await page.click('[data-analysis-fold="ergo"] > summary');
    assert.equal(await page.isChecked('#viewsErgoOn'), false);
    assert.equal(await page.isDisabled('#viewsErgoHeat'), true);
    await page.click('#projectRouteClose');
    assert.equal(await redAt(page, { x: 150, y: 1500 }), 0);
  });

  it('E — включает: у кровати красная зона, счётчик на кнопке, группа в «Замечаниях»', async () => {
    const { page } = app;
    await page.mouse.move(700, 450);
    await page.keyboard.press('e');
    const d = await drawn(page);
    assert.ok(d && d.error >= 1, JSON.stringify(d));
    assert.ok(await redAt(page, { x: 150, y: 1500 }) > 40, 'красная полоса слева от кровати');
    await page.click('#issuesBtn');
    const chip = await page.getAttribute('[data-issue-group="ergo"]', 'aria-pressed');
    assert.equal(chip, 'true');
    const text = await page.textContent('#issuesPanel [data-group="ergo"]');
    assert.match(text, /Кровать.*проход слева 300 мм до стены, нужно ≥ 700/);
    await page.click('#issuesPanel [data-group="ergo"] .issue-go');
    const sel = await page.evaluate(() => window.__kepler.state.selection);
    assert.deepEqual(sel, { type: 'item', id: 'bed' });
  });

  it('«Свойства» предмета: находки с зазором, «Показать» подсвечивает зону', async () => {
    const { page } = app;
    await page.click('#propsTabMain').catch(() => {});
    await page.evaluate(() => window.__kepler.select({ type: 'item', id: 'bed' }));
    await page.waitForSelector('#ergoItem');
    assert.match(await page.textContent('#ergoItem'), /проход слева 300 мм/);
    await page.click('#ergoItem [data-ergo-show]');
    assert.match(await page.evaluate(() => window.__kepler.state.ergoFocus), /^ergo:zone:/);
  });

  it('тянем кровать мышью к стене — красное исчезает, счётчик «✓»', async () => {
    const { page } = app;
    await page.evaluate(() => window.__kepler.select(null));
    await zoomToItems(page, 0.12, ['bed']);
    const a = await worldToClient(page, 1100, 1200);
    const b = await worldToClient(page, 800, 1200);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move((a.x + b.x) / 2, a.y, { steps: 4 });
    await page.mouse.move(b.x, b.y, { steps: 6 });
    // Живой пересчёт во время перетаскивания (троттлинг ~90 мс).
    await page.waitForTimeout(200);
    const live = await drawn(page);
    assert.equal(live.error, 0, `пересчёт во время перетаскивания ${JSON.stringify(live)}`);
    await page.mouse.up();
    const x = await page.evaluate(() => window.__kepler.state.project.items[0].x);
    assert.ok(Math.abs(x - 800) <= 50, `кровать x=${x}`);
    const d = await drawn(page);
    assert.equal(d.error, 0, JSON.stringify(d));
    assert.equal(await redAt(page, { x: 1900 + 200, y: 1500 }), 0);
  });

  it('«Исправить» сдвигает стол до нормы одним шагом истории', async () => {
    const { page } = app;
    await page.evaluate(async () => {
      const m = await import('./core/model.js');
      const store = await import('./ui/store.js');
      const st = window.__kepler.state;
      const t = m.createItem('desk', 900, 2900, 1200, 600, 180); // лицом вверх, к кровати: за стулом 600 — тесно
      t.id = 'desk';
      store.mutate(() => { st.project.items.push(t); });
      window.__kepler.select({ type: 'item', id: 'desk' });
    });
    await page.waitForSelector('#ergoItem');
    const fix = await page.$('#ergoItem [data-ergo-fix]');
    assert.ok(fix, await page.textContent('#ergoItem'));
    const y0 = await page.evaluate(() => window.__kepler.state.project.items.find((i) => i.id === 'desk').y);
    await fix.click();
    const y1 = await page.evaluate(() => window.__kepler.state.project.items.find((i) => i.id === 'desk').y);
    assert.ok(y1 > y0, `стол отодвинут ${y0} → ${y1}`);
    assert.match(await page.textContent('#ergoItem'), /в норме/);
    await page.keyboard.press('Control+z');
    assert.equal(await page.evaluate(() => window.__kepler.state.project.items.find((i) => i.id === 'desk').y), y0);
  });

  it('печать и лист — без зон эргономики', async () => {
    const { page } = app;
    const red = await page.evaluate(async () => {
      const { renderRegion } = await import('./ui/sheet.js');
      const st = window.__kepler.state;
      const cv = renderRegion(st.project, { kind: 'plan', box: { cx: 1500, cy: 2000 }, rotation: 0, denominator: 50, width: 120, height: 120 });
      const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
      let n = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i] > 180 && d[i] - d[i + 1] > 60 && d[i] - d[i + 2] > 50) n += 1;
      return n;
    });
    assert.equal(red, 0);
  });

  it('выключение убирает зоны, а перезагрузка не накладывает аналитику на обычный план', async () => {
    const { page } = app;
    await page.evaluate(() => window.__kepler.select(null));
    await openRouteView(page, 'circulation');
    const fold = page.locator('[data-analysis-fold="ergo"]');
    if (!await fold.evaluate((node) => node.open)) await fold.locator('summary').click();
    await page.uncheck('#viewsErgoOn');
    assert.equal(await drawn(page), null);
    await page.locator('#projectRoutePanel').waitFor({ state: 'hidden' });
    assert.equal(await page.evaluate(() => window.__kepler.state.analyticalView), null);
    assert.equal(JSON.parse(await page.evaluate(() => localStorage.getItem('kepler-ergo'))).on, false);
    await openRouteView(page, 'circulation');
    const reopened = page.locator('[data-analysis-fold="ergo"]');
    if (!await reopened.evaluate((node) => node.open)) await reopened.locator('summary').click();
    await page.check('#viewsErgoOn');
    await page.waitForFunction(() => window.__kepler.state.analyticalView?.analysis === 'ergonomics');
    await page.reload();
    await page.waitForFunction(() => Boolean(window.__kepler));
    assert.equal(await page.evaluate(async () => (await import('./ui/render-ergonomics.js')).ergoPref().on), false);
    assert.equal(await page.evaluate(() => window.__kepler.state.analyticalView), null);
  });
});

describe('режим «Эргономика» на телефоне', () => {
  let app;
  before(async () => {
    app = await startApp({ mobile: true });
    await app.page.click('#startNew');
  });
  after(async () => { await app?.close(); });

  it('колонки нет — режим включается чипом в «⚠ Замечаниях»', async () => {
    const { page } = app;
    await page.waitForFunction(() => document.getElementById('startScreen').hidden);
    await page.tap('#issuesBtn');
    await page.tap('#issuesPanel [data-issue-group="ergo"]');
    assert.equal(await page.getAttribute('#issuesPanel [data-issue-group="ergo"]', 'aria-pressed'), 'true');
  });
});
