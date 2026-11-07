// e2e: привязки — «пилюля» значков внизу холста (ui/draw-snap-ui.js):
// все переключатели на месте, без подписей; клик меняет настройку
// (localStorage kepler-draw-snap) и aria-pressed; подсказка видна сразу при
// наведении (без задержек и переходов) и не выходит за экран; пилюля не
// перекрывает этажи и масштаб на 1280 и на телефоне 390.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, openSample } from './helpers.mjs';

const KEYS = ['ortho', 'polar', 'objects', 'tracking', 'magnet', 'guides'];
const overlap = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
const box = (page, sel) => page.locator(sel).boundingBox();

describe('привязки внизу холста — компьютер 1280', () => {
  let app;
  before(async () => {
    app = await startApp();
    await openSample(app.page);
  });
  after(async () => { await app?.close(); });

  it('все привязки — значки без подписей, со своими aria-label и aria-pressed', async () => {
    const { page } = app;
    const btns = await page.$$eval('#snapBar [data-snap]', (ns) => ns.map((n) => ({
      key: n.dataset.snap, label: n.getAttribute('aria-label'), pressed: n.getAttribute('aria-pressed'),
      svg: Boolean(n.querySelector('svg')), title: n.getAttribute('title'),
      text: [...n.childNodes].filter((c) => !(c.classList?.contains('snap-tip'))).map((c) => c.textContent).join('').trim(),
    })));
    assert.deepEqual(btns.map((b) => b.key), KEYS);
    for (const b of btns) {
      assert.ok(b.svg && b.label, `${b.key}: значок и aria-label`);
      assert.equal(b.text, '', `${b.key}: без подписи`);
      assert.equal(b.title, null, `${b.key}: без title`);
      assert.match(b.pressed, /^(true|false)$/);
    }
    assert.equal(await page.isVisible('#snapPolarStep'), true, 'шаг полярки');
    assert.equal(await page.$('#snapMenuBtn'), null, 'старого меню нет');
    assert.equal(await page.$('#orthoBtn'), null, 'старой кнопки «Орто» нет');
  });

  it('клик переключает настройку, aria-pressed и сохраняется; шаг полярки — по кругу', async () => {
    const { page } = app;
    for (const k of KEYS) {
      const sel = `#snapBar [data-snap="${k}"]`;
      const before = await page.evaluate((key) => window.__kepler.state.snapSettings[key], k);
      await page.click(sel);
      assert.equal(await page.evaluate((key) => window.__kepler.state.snapSettings[key], k), !before, k);
      assert.equal(await page.getAttribute(sel, 'aria-pressed'), String(!before));
      assert.equal(await page.$eval(sel, (n) => n.classList.contains('on')), !before);
      assert.equal(await page.evaluate((key) => JSON.parse(localStorage.getItem('kepler-draw-snap'))[key], k), !before);
      await page.click(sel);
      assert.equal(await page.getAttribute(sel, 'aria-pressed'), String(before));
    }
    const step0 = await page.evaluate(() => window.__kepler.state.snapSettings.polarStep);
    await page.click('#snapPolarStep');
    const step1 = await page.evaluate(() => window.__kepler.state.snapSettings.polarStep);
    assert.notEqual(step1, step0);
    assert.equal((await page.textContent('#snapPolarStep .snap-step-val')).trim(), `${step1}°`);
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('kepler-draw-snap')).polarStep), step1);
  });

  it('подсказка — сразу при наведении, без задержки; в экране; текст «что делает»', async () => {
    const { page } = app;
    await page.mouse.move(5, 5);
    assert.equal(await page.isHidden('#snapTip-magnet'), true, 'без наведения скрыта');
    for (const k of [...KEYS, 'step']) {
      const btn = k === 'step' ? '#snapPolarStep' : `#snapBar [data-snap="${k}"]`;
      const tip = `#snapTip-${k}`;
      await page.hover(btn);
      // Сразу после наведения — без ожидания.
      const m = await page.$eval(tip, (n) => {
        const cs = getComputedStyle(n);
        const r = n.getBoundingClientRect();
        return {
          display: cs.display, tDelay: cs.transitionDelay, tDur: cs.transitionDuration, aDelay: cs.animationDelay, aName: cs.animationName,
          opacity: cs.opacity, visibility: cs.visibility, r: { x: r.x, y: r.y, width: r.width, height: r.height }, text: n.textContent,
        };
      });
      assert.notEqual(m.display, 'none', `${k}: видна`);
      assert.equal(m.opacity, '1');
      assert.equal(m.visibility, 'visible');
      assert.ok(/^0s(, 0s)*$/.test(m.tDelay) && /^0s(, 0s)*$/.test(m.tDur), `${k}: без перехода ${m.tDelay}/${m.tDur}`);
      assert.ok(m.aName === 'none' && /^0s/.test(m.aDelay), `${k}: без анимации`);
      assert.ok(m.r.x >= 0 && m.r.x + m.r.width <= 1280 && m.r.y >= 0, `${k}: в экране ${JSON.stringify(m.r)}`);
      const b = await box(page, btn);
      assert.ok(m.r.y + m.r.height <= b.y, `${k}: над кнопкой`);
      assert.ok(m.text.includes('·'), `${k}: название · что делает`);
      assert.equal(await page.isVisible(tip), true);
    }
    assert.match(await page.textContent('#snapTip-magnet'), /Магнит блоков.*Alt/);
    assert.match(await page.textContent('#snapTip-ortho'), /F8/);
    await page.mouse.move(5, 5);
    assert.equal(await page.isHidden('#snapTip-ortho'), true);
  });

  it('по центру низа холста, не перекрывает этажи и масштаб', async () => {
    const { page } = app;
    const [pill, levels, zoom, canvas] = await Promise.all(['#snapBar', '#levelDock', '.zoom-controls', '#canvas'].map((s) => box(page, s)));
    assert.ok(!overlap(pill, levels), `этажи ${JSON.stringify([pill, levels])}`);
    assert.ok(!overlap(pill, zoom), `масштаб ${JSON.stringify([pill, zoom])}`);
    assert.ok(pill.x > levels.x + levels.width && pill.x + pill.width < zoom.x, 'между этажами и масштабом');
    assert.ok(Math.abs(pill.x + pill.width / 2 - (canvas.x + canvas.width / 2)) < 2, 'по центру');
    assert.ok(pill.y + pill.height <= canvas.y + canvas.height && pill.y > canvas.y + canvas.height - 120, 'внизу');
    assert.deepEqual(app.errors, []);
  });
});

describe('привязки внизу холста — телефон 390', () => {
  let app;
  before(async () => {
    app = await startApp({ mobile: true });
    await openSample(app.page);
  });
  after(async () => { await app?.close(); });

  it('в экране, не перекрывает этажи; касание переключает', async () => {
    const { page } = app;
    const [pill, levels] = await Promise.all(['#snapBar', '#levelDock'].map((s) => box(page, s)));
    assert.ok(pill.x >= 0 && pill.x + pill.width <= 390, `в экране ${JSON.stringify(pill)}`);
    assert.ok(!overlap(pill, levels), `этажи ${JSON.stringify([pill, levels])}`);
    if (await page.isVisible('.zoom-controls')) assert.ok(!overlap(pill, await box(page, '.zoom-controls')));
    const sel = '#snapBar [data-snap="objects"]';
    const before = await page.getAttribute(sel, 'aria-pressed');
    await page.tap(sel);
    assert.notEqual(await page.getAttribute(sel, 'aria-pressed'), before);
    assert.ok((await page.evaluate(() => document.documentElement.scrollWidth)) <= 390);
    assert.deepEqual(app.errors, []);
  });
});
