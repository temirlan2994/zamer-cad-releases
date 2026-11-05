// e2e телефона 390×844 в светлой и тёмной теме: справка (вся в экране,
// прокручивается, «✕» доступна), панель 3D (не шире экрана, «Закрыть»
// видна), плашка «Тени» (не закрывает холст), окно разреза (читаемо,
// «Закрыть» видна); смена темы перерисовывает миниатюры ландшафта.
// Скриншоты — в папку из переменной KEPLER_SHOTS (если задана).
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, openSample } from './helpers.mjs';

const SHOTS = process.env.KEPLER_SHOTS || '';
const W = 390;
const H = 844;
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` }); };
const jsClick = (page, sel) => page.evaluate((s) => document.querySelector(s).click(), sel);
const box = async (page, sel) => (await page.$(sel)).boundingBox();
const inViewport = (b) => b && b.x >= 0 && b.y >= 0 && b.x + b.width <= W + 0.5 && b.y + b.height <= H + 0.5;
const frame = (page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

for (const theme of ['light', 'dark']) {
  describe(`телефон, тема ${theme === 'dark' ? 'тёмная' : 'светлая'}`, () => {
    let app;
    before(async () => {
      app = await startApp({ mobile: true });
      await app.page.emulateMedia({ colorScheme: theme });
      await app.page.reload();
      await app.page.waitForFunction(() => Boolean(window.__kepler));
      await openSample(app.page);
    });
    after(async () => { await app?.close(); });

    it('тема применилась', async () => {
      const canvasColor = await app.page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--canvas').trim());
      assert.equal(canvasColor, theme === 'dark' ? '#0d1118' : '#fbfcfe');
    });

    it('справка: в экране, с прокруткой, разделы «Ландшафт» и «Пальцы», без «50 мм»', async () => {
      const { page } = app;
      await jsClick(page, '#helpBtn');
      await page.waitForSelector('#helpScreen:not([hidden])');
      const card = await box(page, '#helpScreen .help-card');
      assert.ok(card.height <= H && card.y >= 0, `карточка ${JSON.stringify(card)}`);
      assert.ok(inViewport(await box(page, '#helpClose')), '«✕» в экране');
      const text = await page.textContent('#helpGrid');
      for (const s of ['Ландшафт', 'Пальцы', 'Shift+A', 'Удержание', 'Временные размеры', 'Засадить', 'Тени', 'Разрез']) {
        assert.ok(text.includes(s), `нет «${s}»`);
      }
      assert.ok(!text.includes('50 мм (Shift — 500)'), 'старый шаг стрелок');
      const scroll = await page.evaluate(() => { const g = document.getElementById('helpGrid'); return { sh: g.scrollHeight, ch: g.clientHeight, sw: g.scrollWidth, cw: g.clientWidth }; });
      assert.ok(scroll.sh > scroll.ch, 'список прокручивается');
      assert.ok(scroll.sw <= scroll.cw + 1, 'без горизонтальной прокрутки');
      await shot(page, `m-${theme}-help`);
      await page.evaluate(() => { document.getElementById('helpGrid').scrollTop = 99999; });
      await shot(page, `m-${theme}-help-end`);
      await jsClick(page, '#helpClose');
      assert.equal(await page.isVisible('#helpScreen'), false);
    });

    it('3D: панель в экране, «Закрыть» доступна', async () => {
      const { page } = app;
      await jsClick(page, '#view3dBtn');
      await page.waitForSelector('#view3d:not([hidden])');
      const bar = await box(page, '.view3d-bar');
      assert.ok(bar.x >= 0 && bar.x + bar.width <= W + 0.5, `панель ${JSON.stringify(bar)}`);
      assert.ok(inViewport(await box(page, '#v3Close')), '«Закрыть» в экране');
      await frame(page);
      await shot(page, `m-${theme}-3d`);
      await page.tap('#v3Close');
      assert.equal(await page.isVisible('#view3d'), false);
    });

    it('плашка «Тени» в режиме «Солнце» не закрывает холст', async () => {
      const { page } = app;
      await jsClick(page, '#landscapeBtn');
      await page.waitForFunction(() => document.body.classList.contains('mode-landscape'));
      await page.evaluate(() => {
        const r = document.querySelector('#lsSunBar input[value="sun"]');
        r.checked = true; r.dispatchEvent(new Event('change', { bubbles: true }));
      });
      await page.evaluate(() => {
        const c = document.getElementById('lsSunAnalysis');
        c.checked = true; c.dispatchEvent(new Event('change', { bubbles: true }));
      });
      await page.waitForTimeout(400);
      await frame(page);
      const sun = await box(page, '#lsSunBar');
      const wrap = await box(page, '.canvas-wrap');
      assert.ok(sun.height <= wrap.height * 0.4, `плашка ${Math.round(sun.height)} из ${Math.round(wrap.height)}`);
      assert.ok(sun.width <= W * 0.65, `ширина плашки ${sun.width}`);
      assert.ok(inViewport(sun));
      await shot(page, `m-${theme}-sun`);
      await page.evaluate(() => {
        const r = document.querySelector('#lsSunBar input[value="off"]');
        r.checked = true; r.dispatchEvent(new Event('change', { bubbles: true }));
      });
    });

    it('окно разреза: «Закрыть» в экране, чертёж не сжат', async () => {
      const { page } = app;
      await page.evaluate(async () => {
        const S = await import('./ui/landscape-section.js');
        S.startSectionTool();
        const t = window.__kepler.state.tool;
        t.points.push({ x: 12000, y: -6500 }, { x: 12000, y: 3000 });
        S.finishSection();
      });
      await page.waitForSelector('#lsSectionView:not([hidden]) svg');
      await frame(page);
      assert.ok(inViewport(await box(page, '#lsSecClose')), '«Закрыть» в экране');
      const svg = await box(page, '#lsSecBody svg');
      assert.ok(svg.height >= 200, `высота чертежа ${svg.height}`);
      assert.ok(svg.width >= W * 0.9, `ширина чертежа ${svg.width}`);
      await shot(page, `m-${theme}-section`);
      await jsClick(page, '#lsSecClose');
    });

    it('без ошибок в консоли', () => {
      assert.deepEqual(app.errors, []);
    });
  });
}

describe('смена темы перерисовывает миниатюры ландшафта', () => {
  let app;
  before(async () => {
    app = await startApp({ width: 1280, height: 820 });
    await app.page.emulateMedia({ colorScheme: 'light' });
    await app.page.evaluate(() => localStorage.setItem('kepler-theme', 'light'));
    await app.page.reload();
    await app.page.waitForFunction(() => Boolean(window.__kepler));
    await openSample(app.page);
    await app.page.click('#landscapeBtn');
    await app.page.waitForSelector('#lsItems canvas');
  });
  after(async () => { await app?.close(); });

  it('светлая → тёмная: картинка карточки другая', async () => {
    const { page } = app;
    const pic = () => page.evaluate(() => document.querySelector('#lsItems canvas').toDataURL());
    const before = await pic();
    const after = await page.evaluate(async () => {
      const T = await import('./ui/theme.js');
      T.cycleTheme(); // светлая → тёмная
      return { theme: document.documentElement.dataset.theme };
    });
    assert.equal(after.theme, 'dark');
    assert.notEqual(await pic(), before);
    assert.deepEqual(app.errors, []);
  });
});
