// Свет на участке использует общую дату и время проекта.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, openSample } from './helpers.mjs';

const redraw = (page) => page.evaluate(async () => {
  (await import('./ui/view.js')).requestDraw();
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
});
// Средняя яркость холста (0–255).
const meanLum = (page) => page.evaluate(() => {
  const c = document.getElementById('canvas');
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let s = 0;
  for (let i = 0; i < d.length; i += 16) s += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
  return s / (d.length / 16);
});
const setTime = async (page, minutes) => {
  await page.evaluate((m) => {
    const el = document.getElementById('lsSunTime');
    el.value = String(m);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, minutes);
  await redraw(page);
};

async function setSun(page, { mode, date } = {}) {
  await page.click('[data-landscape-climate]');
  if (mode) await page.selectOption('[data-climate-setting="landscapeMode"]', mode);
  if (date) {
    await page.fill('[data-home-climate-date]', date);
    await page.locator('[data-home-climate-date]').blur();
  }
  await page.click('#projectRouteClose');
}

describe('ландшафт: тени по солнцу', () => {
  let app;
  before(async () => {
    app = await startApp();
    await openSample(app.page);
    // Посадки: деревья к югу и востоку от дома, беседка, забор.
    await app.page.evaluate(async () => {
      const L = await import('./core/landscape.js');
      const objs = window.__kepler.state.project.site.landscape.objects;
      objs.push(
        L.createLandscapeObject('tree-oak', 12000, 8000, { w: 6000, height: 12000 }),
        L.createLandscapeObject('tree-pine', -2000, 9000),
        L.createLandscapeObject('gazebo', 12500, -2500),
        L.createLandscapeObject('fence-line', 0, 0, { points: [{ x: -4500, y: 11000 }, { x: 3000, y: 11000 }] }),
      );
    });
  });
  after(async () => { await app?.close(); });

  it('плашка «Тени» только в «Ландшафте»', async () => {
    const { page } = app;
    assert.equal(await page.isVisible('#lsSunBar'), false, 'в «Плане» скрыта');
    await page.click('#landscapeBtn');
    await page.waitForFunction(() => window.__kepler.state.modeName === 'landscape');
    assert.equal(await page.isVisible('#lsSunBar'), true);
    assert.match(await page.textContent('#lsSunBar'), /Свет на участке/);
    assert.equal(await page.$('#lsSunTime'), null, 'ползунок — только в режиме «Солнце»');
  });

  it('«Солнце»: ползунок, дата, подпись; вечером тени длиннее', async () => {
    const { page } = app;
    await setSun(page, { mode: 'off' });
    await redraw(page);
    const off = await meanLum(page);
    await setSun(page, { mode: 'sun' });
    assert.equal(await page.evaluate(() => window.__kepler.state.lsSun.mode), 'sun');
    assert.ok(await page.$('#lsSunTime'));
    await setSun(page, { date: '2026-06-21' });
    await setTime(page, 12 * 60);
    const noon = await meanLum(page);
    assert.match(await page.textContent('#lsSunInfo'), /высота \d+°/);
    await setTime(page, 19 * 60);
    const evening = await meanLum(page);
    assert.equal(await page.textContent('#lsSunClock'), '19:00');
    assert.ok(noon < off, `тени в полдень темнее «Выкл»: ${noon} < ${off}`);
    assert.ok(evening < noon - 0.5, `вечером длиннее: ${evening} < ${noon}`);
    // Ночью солнца нет.
    await setSun(page, { date: '2026-12-21' });
    await setTime(page, 20 * 60 + 30);
    assert.match(await page.textContent('#lsSunInfo'), /за горизонтом/);
    const sun = await page.evaluate(() => window.__kepler.state.project.site.sun);
    assert.equal(sun.time, 20 * 60 + 30);
    assert.match(sun.date, /-12-21$/);
    // Только режим отображения хранится в браузере.
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('kepler-ls-sun')));
    assert.equal(saved.mode, 'sun');
    assert.equal(saved.time, undefined);
    assert.equal(await page.evaluate(() => 'lsSun' in window.__kepler.state.project.site), false);
  });

  it('пока тянут ползунок — упрощённый расчёт, после — полный', async () => {
    const { page } = app;
    await setSun(page, { date: '2026-06-21' });
    await page.evaluate(() => {
      const el = document.getElementById('lsSunTime');
      el.value = '600';
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    assert.equal(await page.evaluate(() => window.__kepler.state.lsSunDragging), true);
    await redraw(page);
    await page.evaluate(() => document.getElementById('lsSunTime').dispatchEvent(new Event('change', { bubbles: true })));
    assert.equal(await page.evaluate(() => window.__kepler.state.lsSunDragging), false);
  });

  it('анализ освещённости: сводка по участку и клумбам', async () => {
    const { page } = app;
    await page.evaluate(async () => {
      const L = await import('./core/landscape.js');
      window.__kepler.state.project.site.landscape.objects.push(L.createLandscapeObject('bed-rect', 3000, 9500));
    });
    await page.click('[data-landscape-climate]');
    await page.click('[data-home-climate-action="landscape-map"]');
    await redraw(page);
    await page.waitForFunction(() => /Участок, в среднем/.test(document.getElementById('lsSunSummary')?.textContent || ''));
    const text = await page.textContent('#lsSunSummary');
    assert.match(text, /Клумба прямоугольная/);
    assert.match(text, /(солнце|полутень|тень)/);
    await page.click('[data-landscape-climate]');
    await page.click('[data-home-climate-action="landscape-map"]');
    await page.click('#projectRouteClose');
  });

  it('оба стиля и все режимы рисуются без ошибок консоли', async () => {
    const { page } = app;
    for (const style of ['drawing', 'sketch']) {
      await page.evaluate(async (s) => (await import('./ui/landscape-style.js')).setLandscapeStyle(s), style);
      for (const mode of ['sun', 'default', 'off', 'sun']) {
        await setSun(page, { mode });
        await redraw(page);
      }
    }
    // В «Участке» плашки нет, тени инсоляции участка — как раньше.
    await page.click('#modeSiteBtn');
    assert.equal(await page.isVisible('#lsSunBar'), false);
    await redraw(page);
    assert.deepEqual(app.errors, []);
  });
});
