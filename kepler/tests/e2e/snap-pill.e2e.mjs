// e2e: привязки — ряд значков в строке состояния справа, вплотную слева от
// масштаба, как статус-бар AutoCAD (ui/draw-snap-ui.js): все переключатели на
// месте, без подписей; клик меняет настройку (localStorage kepler-draw-snap)
// и aria-pressed; подсказка видна сразу при наведении (без задержек и
// переходов), не выходит за экран, у правого края — по правому краю; ряд не
// перекрывает этажи, зум и библиотеку на 1280 и на телефоне 390.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, openSample } from './helpers.mjs';

const KEYS = ['ortho', 'polar', 'objects', 'tracking', 'magnet', 'guides'];
const overlap = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
const box = (page, sel) => page.locator(sel).boundingBox();

describe('привязки в правом нижнем углу — компьютер 1280', () => {
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
      assert.ok(Math.abs(m.r.x + m.r.width - (b.x + b.width + 4)) < 2, `${k}: по правому краю кнопки`);
      assert.equal(await page.isVisible(tip), true);
    }
    assert.match(await page.textContent('#snapTip-magnet'), /Магнит блоков.*Alt/);
    assert.match(await page.textContent('#snapTip-ortho'), /F8/);
    await page.mouse.move(5, 5);
    assert.equal(await page.isHidden('#snapTip-ortho'), true);
  });

  it('в правом нижнем углу: вплотную слева от масштаба, под зумом, не перекрывает этажи', async () => {
    const { page } = app;
    const [pill, levels, zoom, canvas, scale] = await Promise.all(['#snapBar', '#levelDock', '.zoom-controls', '#canvas', '#scaleInfo'].map((s) => box(page, s)));
    assert.equal(await page.$eval('#snapBar', (n) => n.parentElement.classList.contains('statusbar')), true, 'в строке состояния');
    assert.match(await page.textContent('#scaleInfo'), /1:\d+/);
    assert.ok(!overlap(pill, levels), `этажи ${JSON.stringify([pill, levels])}`);
    assert.ok(!overlap(pill, zoom), `зум ${JSON.stringify([pill, zoom])}`);
    assert.ok(!overlap(pill, scale), `масштаб ${JSON.stringify([pill, scale])}`);
    const gap = scale.x - (pill.x + pill.width);
    assert.ok(gap >= 0 && gap <= 16, `вплотную слева от масштаба: ${gap}`);
    assert.ok(Math.abs(pill.y + pill.height / 2 - (scale.y + scale.height / 2)) < 3, 'на одной линии с масштабом');
    assert.ok(pill.y + pill.height <= canvas.y + canvas.height + 0.5 && pill.y > canvas.y + canvas.height - 32, `на нижней кромке ${JSON.stringify([pill, canvas])}`);
    assert.ok(pill.x > canvas.x + canvas.width / 2 && pill.x + pill.width <= canvas.x + canvas.width, 'справа');
    assert.ok(zoom.y + zoom.height <= pill.y, 'зум — над привязками');
    assert.ok(pill.height <= 26, `компактно: ${pill.height}`);
    assert.deepEqual(app.errors, []);
  });

  it('открытая библиотека не закрывает привязки', async () => {
    const { page } = app;
    await page.click('#furnitureToolBtn');
    assert.equal(await page.isVisible('.library'), true);
    const [pill, lib] = await Promise.all(['#snapBar', '.library'].map((s) => box(page, s)));
    assert.ok(!overlap(pill, lib), `библиотека ${JSON.stringify([pill, lib])}`);
    assert.equal(await page.isVisible('#snapBar [data-snap="ortho"]'), true);
    await page.keyboard.press('Escape');
    assert.deepEqual(app.errors, []);
  });
});

describe('привязки — телефон 390', () => {
  let app;
  before(async () => {
    app = await startApp({ mobile: true });
    await openSample(app.page);
  });
  after(async () => { await app?.close(); });

  it('переключатели открываются поверх плана, сохраняют настройку при повороте экрана', async () => {
    const { page } = app;
    const sel = '#snapBar [data-snap="objects"]';
    await page.setViewportSize({ width: 320, height: 640 });
    assert.equal(await page.isVisible(sel), false);
    await page.tap('#mobileSnapBtn');
    const panel = await box(page, '#mobileSnapRow');
    assert.ok(panel.x >= 0 && panel.x + panel.width <= 320);
    const before = await page.getAttribute(sel, 'aria-pressed');
    await page.tap(sel);
    const pressed = await page.getAttribute(sel, 'aria-pressed');
    assert.notEqual(pressed, before);
    await page.evaluate(() => {
      const canvas = document.querySelector('#canvas');
      canvas.addEventListener('pointerdown', () => { canvas.dataset.snapDismissTap = '1'; }, { once: true });
    });
    await page.touchscreen.tap(150, 540);
    assert.equal(await page.isVisible('#mobileSnapRow'), false);
    assert.equal(await page.getAttribute('#canvas', 'data-snap-dismiss-tap'), null, 'касание закрыло привязки без редактирования');
    await page.tap('#mobileSnapBtn');
    await page.setViewportSize({ width: 844, height: 390 });
    await page.waitForSelector('.statusbar #snapBar');
    assert.equal(await page.getAttribute(sel, 'aria-pressed'), pressed);
    assert.equal(await page.isVisible('#mobileSnapBtn'), false);
    assert.equal(await page.locator('.project-route-bar #projectRouteSteps [data-route-view]').count(), 9);
    await page.setViewportSize({ width: 390, height: 844 });
    // Палитра девяти этапов остаётся внизу; привязки возвращаются в ряд телефона.
    await page.waitForSelector('#mobileSnapRow #snapBar', { state: 'attached' });
    assert.equal(await page.locator('.project-route-bar #projectRouteSteps [data-route-view]').count(), 9);
    assert.equal(await page.isVisible(sel), false);
    await page.tap('#mobileSnapBtn');
    await page.tap('#projectRouteSteps [data-route-view="site"]');
    assert.equal(await page.isVisible('#mobileSnapRow'), false);
    assert.equal(await page.isVisible('#projectRouteHover'), true);
    assert.equal(await page.isVisible('#projectRoutePanel'), false);
    await page.tap('#projectRouteHover [data-route-task]');
    assert.equal(await page.isVisible('#projectRoutePanel'), true);
    assert.deepEqual(app.errors, []);
  });
});
