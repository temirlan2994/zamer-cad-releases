// Библиотека дверей и окон: при инструменте «Дверь» / «Окно» выезжает каталог
// пресетов (категории, поиск, карточки-превью). Карточка задаёт тип и размеры
// инструмента, строка параметров синхронна, вставка — серией, Esc закрывает.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, openSample } from './helpers.mjs';
import { OPENING_CATEGORIES, openingPresets } from '../../core/opening-catalog.js';

describe('библиотека дверей и окон', () => {
  let app;
  before(async () => { app = await startApp({ width: 1400, height: 900 }); await openSample(app.page); });
  after(async () => { await app?.close(); });

  const preset = () => app.page.evaluate(() => ({ ...window.__kepler.state.tool?.preset }));
  // Точки на длинной наружной горизонтальной стене (клиентские координаты);
  // стена — в центре холста, правее библиотеки.
  // last — другая стена (у первой уже стоят двери).
  const wallPoints = (ts, last = false) => app.page.evaluate(async ([list, other]) => {
    const { planToScreen } = await import('./ui/view.js');
    const st = window.__kepler.state;
    const all = st.walls.filter((x) => x.kind === 'own' && x.orient === 'h' && x.to - x.from > 4500);
    const w = other ? all[all.length - 1] : all[0];
    const mid = (w.center.y1 + w.center.y2) / 2;
    const cv = document.getElementById('canvas');
    st.view.scale = Math.max(st.view.scale, 0.07);
    const c = planToScreen((w.from + w.to) / 2, mid);
    st.view.panX += cv.clientWidth * 0.62 - c.x;
    st.view.panY += cv.clientHeight / 2 - c.y;
    (await import('./ui/view.js')).requestDraw();
    const r = cv.getBoundingClientRect();
    return list.map((t) => { const s = planToScreen(w.from + (w.to - w.from) * t, mid); return { x: r.left + s.x, y: r.top + s.y }; });
  }, [ts, last]);

  it('«Дверь»: библиотека с категориями, карточками и поиском', async () => {
    const { page } = app;
    assert.equal(await page.isVisible('.library'), false);
    await page.click('#doorToolBtn');
    assert.equal(await page.isVisible('.library'), true, 'библиотека выехала');
    assert.equal(await page.isVisible('#openingsBar'), true);
    assert.equal(await page.isVisible('#furnitureBar'), false);
    assert.equal(await page.isVisible('#libraryTabs'), false, 'без вкладок помещений и мебели');
    assert.equal(await page.textContent('#openingsTitle'), 'Двери');
    const cats = await page.$$eval('#openingCats button', (ns) => ns.map((n) => n.dataset.cat));
    assert.deepEqual(cats, OPENING_CATEGORIES.door.map((c) => c.id));
    const first = await page.$$eval('#openingItems .opening-chip', (ns) => ns.map((n) => n.dataset.preset));
    assert.ok(first.length >= 2);
    assert.equal(await page.$$eval('#openingItems .opening-chip canvas', (ns) => ns.length), first.length, 'у каждой карточки превью');
    await page.click('#openingCats button[data-cat="sliding"]');
    assert.deepEqual(await page.$$eval('#openingItems .opening-chip', (ns) => ns.map((n) => n.dataset.preset)), openingPresets('door', 'sliding').map((p) => p.id));
    await page.fill('#openSearch', 'входная');
    const found = await page.$$eval('#openingItems .opening-chip', (ns) => ns.map((n) => n.dataset.preset));
    assert.ok(found.includes('entry-1000'), found.join());
    // строка параметров — на месте
    assert.equal(await page.isVisible('#toolOptions #presetW'), true);
  });

  it('карточка задаёт тип и размеры; строка параметров и подсветка синхронны', async () => {
    const { page } = app;
    await page.click('#openingItems .opening-chip[data-preset="entry-1000"]');
    assert.deepEqual(await preset(), { type: 'single', width: 1000, height: 2100, sill: 0 });
    assert.equal(await page.evaluate(() => window.__kepler.state.tool?.kind), 'place-opening', 'инструмент остаётся');
    assert.equal(await page.inputValue('#presetW'), '1000');
    assert.equal(await page.inputValue('#presetType'), 'single');
    assert.equal(await page.$eval('.opening-chip[data-preset="entry-1000"]', (n) => n.classList.contains('active')), true);
    await page.fill('#openSearch', '');
    await page.click('#openingCats button[data-cat="double"]');
    await page.click('#openingItems .opening-chip[data-preset="double-1400"]');
    assert.deepEqual(await preset(), { type: 'double', width: 1400, height: 2100, sill: 0 });
    assert.equal(await page.inputValue('#presetType'), 'double');
    assert.equal(await page.$$eval('.opening-chip.active', (ns) => ns.length), 1);
    // Поле ширины в строке — подсветка карточки уходит (размер не из каталога).
    await page.fill('#presetW', '1450');
    await page.press('#presetW', 'Tab');
    assert.equal(await page.$$eval('.opening-chip.active', (ns) => ns.length), 0);
    await page.click('#openingItems .opening-chip[data-preset="double-1200"]');
    assert.equal((await preset()).width, 1200);
  });

  it('вставка серией — проёмы с выбранным пресетом; Esc — выход и библиотека закрыта', async () => {
    const { page } = app;
    const n0 = await page.evaluate(() => window.__kepler.state.project.openings.length);
    const pts = await wallPoints([0.3, 0.7]);
    for (const p of pts) {
      await page.mouse.move(p.x, p.y, { steps: 3 });
      await page.mouse.click(p.x, p.y);
      await page.waitForTimeout(60);
    }
    const added = await page.evaluate((n) => window.__kepler.state.project.openings.slice(n).map((o) => ({ type: o.type, width: o.width, height: o.height })), n0);
    assert.equal(added.length, 2, 'два проёма подряд');
    for (const o of added) assert.deepEqual(o, { type: 'double', width: 1200, height: 2100 });
    assert.equal(await page.isVisible('#openingsBar'), true, 'библиотека остаётся для серии');
    await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(() => window.__kepler.state.tool), null);
    assert.equal(await page.isVisible('.library'), false, 'Esc закрывает библиотеку');
  });

  it('«Окно»: свои категории, поиск «в пол», панорамное ставится с пресетом; повторный клик закрывает', async () => {
    const { page } = app;
    await page.click('#windowToolBtn');
    assert.equal(await page.textContent('#openingsTitle'), 'Окна');
    assert.deepEqual(await page.$$eval('#openingCats button', (ns) => ns.map((n) => n.dataset.cat)), OPENING_CATEGORIES.window.map((c) => c.id));
    await page.fill('#openSearch', 'в пол');
    const found = await page.$$eval('#openingItems .opening-chip', (ns) => ns.map((n) => n.dataset.preset));
    assert.ok(found.length >= 3 && found.every((id) => /^(pano|french)/.test(id)), found.join());
    await page.click('.opening-chip[data-preset="pano-2400"]');
    assert.deepEqual(await preset(), { type: 'panoramic', width: 2400, height: 2100, sill: 100 });
    assert.equal(await page.inputValue('#presetSill'), '100');
    // Стена примера уже с окнами — освобождаем её под широкое панорамное.
    const n0 = await page.evaluate(() => {
      const st = window.__kepler.state;
      st.project.openings = st.project.openings.filter((o) => o.kind === 'door');
      return st.project.openings.length;
    });
    const [p] = await wallPoints([0.5], true);
    await page.mouse.move(p.x, p.y, { steps: 3 });
    await page.mouse.click(p.x, p.y);
    await page.waitForFunction((n) => window.__kepler.state.project.openings.length > n, n0);
    const o = await page.evaluate(() => { const list = window.__kepler.state.project.openings; const x = list[list.length - 1]; return { kind: x.kind, type: x.type, width: x.width, sill: x.sill }; });
    assert.deepEqual(o, { kind: 'window', type: 'panoramic', width: 2400, sill: 100 });
    await page.click('#windowToolBtn');
    assert.equal(await page.evaluate(() => window.__kepler.state.tool), null);
    assert.equal(await page.isVisible('.library'), false);
  });

  it('без ошибок в консоли', () => { assert.deepEqual(app.errors, []); });
});
