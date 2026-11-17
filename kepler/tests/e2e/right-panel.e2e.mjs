// e2e: правая панель — ряд из 5 значков (Свойства, Виды, Листы, ТЭП,
// Замечания): подпись у активного раздела, у каждого — aria-label, role=tab и
// мгновенная подсказка только название вкладки, не выходящая за экран;
// клик переключает панели и aria-selected. «Виды» — дерево видов; настройки
// вида (поворот — те же команды, что панель ⟲; ландшафт на плане) — во
// «Свойствах» без выбора; «Листы» — список листов, двойной клик открывает
// лист на холсте, PDF. Телефон: «Виды» и «Листы» есть в нижнем листе.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { startApp, openSample } from './helpers.mjs';

const TABS = [
  { id: 'propsTabMain', label: 'Свойства', body: '#projectSection' },
  { id: 'propsTabViews', label: 'Виды', body: '#viewTree' },
  { id: 'propsTabSheets', label: 'Листы', body: '#sheetsList' },
  { id: 'propsTabTep', label: 'Площади', body: '#tepHouse' },
  { id: 'issuesBtn', label: 'Замечания', body: '#issuesPanel' },
];
const TIPS = ['ptabTip-props', 'ptabTip-views', 'ptabTip-sheets', 'ptabTip-tep', 'ptabTip-issues'];

describe('правая панель — 5 значков, компьютер 1280', () => {
  let app;
  before(async () => { app = await startApp(); await openSample(app.page); });
  after(async () => { await app?.close(); });

  it('пять вкладок со значками, доступными именами и подписью активного раздела', async () => {
    const { page } = app;
    const btns = await page.$$eval('#propsPanel .props-tabs > button', (ns) => ns.map((n) => ({
      id: n.id, title: n.getAttribute('title'), label: n.getAttribute('aria-label'), role: n.getAttribute('role'), selected: n.getAttribute('aria-selected') === 'true',
      icon: Boolean(n.querySelector('svg, .issues-icon')),
      text: [...n.querySelectorAll(':scope > :not(.ptab-tip)')].filter((c) => c.offsetParent && !c.classList.contains('issues-icon') && !c.classList.contains('issues-count')).map((c) => c.textContent).join('').trim(),
    })));
    assert.deepEqual(btns.map((b) => b.id), TABS.map((t) => t.id));
    for (const [i, b] of btns.entries()) {
      assert.equal(b.title, null, `${b.id}: без title`);
      assert.ok(b.label?.startsWith(TABS[i].label), `${b.id}: aria-label ${b.label}`);
      assert.equal(b.role, 'tab');
      assert.ok(b.icon, `${b.id}: значок`);
      assert.equal(b.text, b.selected ? TABS[i].label : '', `${b.id}: подпись текущего раздела`);
    }
    const row = await page.locator('#propsPanel .props-tabs').boundingBox();
    const boxes = await Promise.all(TABS.map((t) => page.locator(`#${t.id}`).boundingBox()));
    for (const b of boxes) assert.ok(Math.abs(b.y - boxes[0].y) < 1 && b.height <= 44, `в один ряд ${JSON.stringify(b)}`);
    assert.ok(boxes[4].x + boxes[4].width <= row.x + row.width + 0.5);
  });

  it('подсказка — сразу при наведении, в экране, «название · что делает»', async () => {
    const { page } = app;
    await page.mouse.move(5, 5);
    for (const [i, t] of TABS.entries()) {
      const tip = `#${TIPS[i]}`;
      assert.equal(await page.isHidden(tip), true, `${t.id}: без наведения скрыта`);
      await page.hover(`#${t.id}`);
      const m = await page.$eval(tip, (n) => {
        const cs = getComputedStyle(n);
        const r = n.getBoundingClientRect();
        return { display: cs.display, tDur: cs.transitionDuration, tDelay: cs.transitionDelay, aName: cs.animationName, r: { x: r.x, y: r.y, w: r.width, h: r.height }, text: n.textContent };
      });
      assert.notEqual(m.display, 'none', `${t.id}: видна`);
      assert.ok(/^0s(, 0s)*$/.test(m.tDur) && /^0s(, 0s)*$/.test(m.tDelay) && m.aName === 'none', `${t.id}: без задержки`);
      assert.ok(m.r.x >= 0 && m.r.x + m.r.w <= 1280 && m.r.y >= 0 && m.r.y + m.r.h <= 820, `${t.id}: в экране ${JSON.stringify(m.r)}`);
      assert.equal(m.text.trim(), t.label, `${t.id}: только название, без описания: ${m.text}`);
    }
    await page.mouse.move(5, 5);
  });

  it('клик переключает панели и aria-selected', async () => {
    const { page } = app;
    for (const t of [...TABS.slice(1), TABS[0]]) {
      await page.click(`#${t.id}`);
      for (const o of TABS) {
        assert.equal(await page.getAttribute(`#${o.id}`, 'aria-selected'), String(o.id === t.id), `${t.id}: ${o.id}`);
      }
      assert.equal(await page.isVisible(t.body), true, `${t.id}: ${t.body}`);
      assert.match(await page.$eval(`#${t.id}`, (n) => n.className), t.id === 'issuesBtn' ? /issues-btn/ : /\bactive\b/);
    }
    assert.deepEqual(app.errors, []);
  });

  it('«Свойства» вида: кнопка поворота открывает настройки вида', async () => {
    const { page } = app;
    await page.click('#propsTabMain');
    await page.fill('#viewsAngleInput', '15');
    await page.press('#viewsAngleInput', 'Tab');
    await page.click('#viewBtn');
    assert.equal(await page.inputValue('#viewsAngleInput'), '15');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'viewsAngleInput');
    assert.equal(await page.isEnabled('#viewsAngleReset'), true);
    await page.click('#viewsAngleReset');
    assert.equal(await page.inputValue('#viewsAngleInput'), '0');
    assert.equal(await page.isVisible('#viewsLsPlanOnly'), true);
    assert.deepEqual(app.errors, []);
  });

  it('«Листы»: список, лист на холсте, PDF', async () => {
    const { page } = app;
    await page.click('#propsTabSheets');
    const names = await page.$$eval('#sheetsList .sheets-name', (ns) => ns.map((n) => n.textContent));
    assert.deepEqual(names, ['Генплан', 'План: 1 этаж']);
    await page.dblclick('#sheetsList [data-sheet="level:' + await page.evaluate(() => window.__kepler.state.project.activeLevel) + '"] .sheets-name');
    await page.waitForFunction(() => document.getElementById('sheetViewImg')?.naturalWidth > 0);
    assert.equal(await page.$eval('#sheetViewImg', (n) => n.naturalWidth), 2480);
    await page.keyboard.press('Escape');
    assert.equal(await page.isHidden('#sheetView'), true);
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#sheetsPdfBtn')]);
    assert.match(dl.suggestedFilename(), /\.pdf$/);
    assert.match((await readFile(await dl.path())).toString('latin1'), /\/Count 2/);
    assert.deepEqual(app.errors, []);
  });
});

describe('правая панель — телефон 390', () => {
  let app;
  before(async () => { app = await startApp({ mobile: true }); await openSample(app.page); });
  after(async () => { await app?.close(); });

  it('свойства и листы открываются из нижней навигации, таблица площадей из аналитики, замечания с холста', async () => {
    const { page } = app;
    await page.tap('#mobileBar [data-sheet="props"]');
    await page.waitForTimeout(300);
    for (const id of ['propsTabMain', 'propsTabViews', 'propsTabSheets', 'propsTabTep']) assert.equal(await page.isVisible(`#${id}`), false, id);
    assert.equal(await page.$eval('#issuesBtn', (n) => Boolean(n.closest('.canvas-wrap'))), true);
    await page.tap('#mobileBar [data-sheet="sheets"]');
    await page.waitForTimeout(300);
    assert.equal(await page.isVisible('#sheetsPdfBtn'), true);
    await page.tap('#mobileBar [data-sheet="sheets"]');
    await page.tap('#projectHomeProgram');
    await page.tap('#projectRoutePanel [data-home-view="envelope"]');
    await page.tap('[data-analysis-open="tep"]');
    assert.equal(await page.getAttribute('#propsTabTep', 'aria-selected'), 'true');
    assert.equal(await page.isVisible('#schedTable'), true);
    assert.ok((await page.evaluate(() => document.documentElement.scrollWidth)) <= 390);
    assert.deepEqual(app.errors, []);
  });
});
