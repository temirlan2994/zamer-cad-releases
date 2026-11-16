// e2e раскладки «Интерфейс, шаг 2»: шапка без инструментов рисования;
// колонка инструментов слева (только значки, подсказка .tb-tip — сразу, без
// title); библиотека выезжает у колонки только для «Помещения» / «Мебели»
// (холст не сдвигается); строка параметров над холстом — дверь/окно, стена;
// правая панель — «Свойства», «ТЭП», «⚠ Замечания», настройки проекта —
// свёрнутой секцией; телефон — строка инструментов и «⚠» на холсте.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { clickToolbarTool, mobileSelectFamilyTool, startApp, openSample } from './helpers.mjs';

const box = (page, sel) => page.locator(sel).boundingBox();
const tool = (page) => page.evaluate(() => {
  const t = window.__kepler.state.tool;
  return t ? { kind: t.kind, item: t.itemKind || null } : null;
});
const active = (page, sel) => page.$eval(sel, (n) => n.classList.contains('active'));
const same = (a, b) => ['x', 'y', 'width', 'height'].every((k) => Math.abs(a[k] - b[k]) < 0.5);

describe('раскладка: колонка инструментов, библиотека, строка параметров', () => {
  let app;
  before(async () => { app = await startApp({ width: 1440, height: 860 }); await openSample(app.page); });
  after(async () => { await app?.close(); });

  it('шапка — режимы и общие действия; колонка инструментов слева от холста', async () => {
    const { page } = app;
    for (const id of ['modePlanBtn', 'modeSiteBtn', 'view3dBtn']) {
      assert.equal(await page.$eval(`#${id}`, (n) => Boolean(n.closest('.topbar .mode-tabs'))), true, `#${id} — режим в шапке`);
    }
    assert.equal(await page.$$eval('.topbar .tb-btn, .topbar #wallToolBtn, .topbar #doorToolBtn', (ns) => ns.length), 0, 'в шапке нет инструментов');
    const [top, strip, canvas, opts] = await Promise.all(['.topbar', '#toolStrip', '#canvas', '#toolOptions'].map((s) => box(page, s)));
    assert.ok(strip.width <= 56, `колонка узкая: ${strip.width}`);
    assert.ok(strip.y >= top.y + top.height - 1 && strip.x < 2, 'колонка под шапкой у левого края');
    assert.ok(strip.x + strip.width <= canvas.x + 1, 'колонка слева от холста');
    assert.ok(opts.y >= top.y + top.height - 1 && opts.y + opts.height <= canvas.y + 1 && opts.height <= 44, 'строка параметров — тонкая, над холстом');
    const ids = ['selectToolBtn', 'wallToolBtn', 'boundRoomBtn', 'openingsGroupBtn', 'furnitureToolBtn', 'stairsToolBtn', 'massGroupBtn', 'roofToolBtn', 'docsGroupBtn', 'analysisGroupBtn', 'viewBtn', 'fitBtn'];
    const rects = [];
    for (const id of ids) {
      assert.equal(await page.$eval(`#${id}`, (n) => Boolean(n.closest('#toolStrip'))), true, `#${id} в колонке`);
      rects.push(await box(page, `#${id}`));
    }
    for (let i = 1; i < rects.length; i += 1) {
      assert.ok(rects[i].y >= rects[i - 1].y + rects[i - 1].height - 1, `${ids[i]} ниже ${ids[i - 1]}`);
      assert.ok(Math.abs(rects[i].x - rects[0].x) < 2, `${ids[i]} в одной колонке`);
    }
  });

  it('значки без title; подсказка — сразу при наведении: название, что делает, клавиша', async () => {
    const { page } = app;
    const titled = await page.$$eval('#toolStrip .tb-btn', (ns) => ns.filter((n) => n.offsetParent && n.hasAttribute('title')).map((n) => n.id || n.getAttribute('aria-label')));
    assert.deepEqual(titled, [], 'без title');
    const labels = await page.$$eval('#toolStrip .tb-btn', (ns) => ns.filter((n) => n.offsetParent).map((n) => n.querySelector('.tb-label')?.offsetParent ? n.id : null).filter(Boolean));
    assert.deepEqual(labels, [], 'только значки, без подписей');
    await page.hover('#wallToolBtn');
    const tip = await page.$eval('#wallToolBtn .tb-tip', (n) => {
      const cs = getComputedStyle(n);
      const r = n.getBoundingClientRect();
      return { display: cs.display, transition: cs.transitionDuration, text: n.textContent, x: r.x, right: r.right };
    });
    assert.equal(tip.display, 'block');
    assert.match(tip.text, /Стена/);
    assert.match(tip.text, /\bW\b/);
    assert.ok(/^0s/.test(tip.transition), 'без перехода');
    const btn = await box(page, '#wallToolBtn');
    assert.ok(tip.x >= btn.x + btn.width && tip.right <= 1440, 'справа от колонки, в экране');
    await page.mouse.move(700, 450);
    assert.equal(await page.$eval('#wallToolBtn .tb-tip', (n) => getComputedStyle(n).display), 'none');
  });

  it('библиотека: только для «Помещения» и «Мебели», холст не сдвигается', async () => {
    const { page } = app;
    const canvas0 = await box(page, '#canvas');
    assert.equal(await page.isVisible('.library'), false, 'в «Выборе» библиотеки нет');
    await page.click('#boundRoomBtn');
    assert.deepEqual(await tool(page), { kind: 'bound-room', item: null });
    assert.equal(await page.isVisible('#roomCards'), true, 'типы комнат');
    const lib = await box(page, '.library');
    const strip = await box(page, '#toolStrip');
    assert.ok(Math.abs(lib.x - (strip.x + strip.width)) < 2, 'рядом с колонкой');
    assert.ok(same(await box(page, '#canvas'), canvas0), 'холст на месте');
    await page.click('#roomCards .room-card >> text=Кухня');
    assert.equal((await tool(page)).kind, 'place-room');
    assert.equal(await page.isVisible('#roomCards'), true, 'библиотека остаётся при размещении');
    assert.equal(await active(page, '#boundRoomBtn'), true);
    assert.match(await page.textContent('#toolOptionsBody'), /Кухня/, 'строка — выбранный тип');
    await page.keyboard.press('Escape');
    assert.equal(await tool(page), null);
    assert.equal(await page.isVisible('.library'), true, 'первый Esc — выход из размещения');
    await page.keyboard.press('Escape');
    assert.equal(await page.isVisible('.library'), false, 'второй Esc закрывает библиотеку');
    await page.click('#furnitureToolBtn');
    assert.equal(await page.isVisible('#furnitureBar'), true);
    assert.equal(await active(page, '#furnitureToolBtn'), true);
    assert.equal(await active(page, '#selectToolBtn'), false);
    await page.click('#wallToolBtn');
    assert.equal((await tool(page)).kind, 'wall');
    assert.equal(await page.isVisible('.library'), false, 'другой инструмент закрывает библиотеку');
    await page.click('#furnitureToolBtn');
    assert.equal(await tool(page), null, '«Мебель» выключает стену');
    assert.equal(await page.isVisible('#furnitureBar'), true);
    await page.click('#furnitureToolBtn');
    assert.equal(await page.isVisible('.library'), false, 'повторный клик закрывает');
    await page.click('#stairsToolBtn');
    assert.deepEqual(await tool(page), { kind: 'place-furniture', item: 'stairs' });
    assert.equal(await active(page, '#stairsToolBtn'), true);
    assert.equal(await active(page, '#furnitureToolBtn'), false);
    assert.equal(await page.isVisible('.library'), true, 'у лестницы открыт свой каталог');
    assert.equal(await page.isVisible('#stairsBar'), true);
    assert.ok(await page.$$eval('#stairItems [data-stair-preset]', (nodes) => nodes.length) >= 3, 'в каталоге есть готовые лестницы');
    await page.click('#stairCats [data-stair-environment="exterior"]');
    await page.click('#stairItems [data-stair-preset="exterior-concrete"]');
    assert.equal(await page.evaluate(() => window.__kepler.state.tool?.stairPreset), 'exterior-concrete');
    await page.click('#stairsToolBtn');
    assert.equal(await tool(page), null);
    assert.ok(same(await box(page, '#canvas'), canvas0), 'холст не менял размер');
  });

  it('строка параметров: дверь — тип и размеры, стена — тип и толщина; подсказка справа', async () => {
    const { page } = app;
    assert.equal(await page.$eval('#toolOptionsBody', (n) => n.childElementCount), 0, '«Выбор» — без параметров');
    await clickToolbarTool(page, 'doorToolBtn');
    for (const sel of ['#presetType', '#presetW', '#presetH']) {
      assert.equal(await page.$eval(sel, (n) => Boolean(n.closest('#toolOptions'))), true, `${sel} в строке параметров`);
      assert.equal(await page.isVisible(sel), true);
    }
    assert.equal(await page.$('#propsPanel #presetW'), null, 'в правой панели параметров вставки нет');
    assert.equal(await page.$eval('#canvasHint', (n) => Boolean(n.closest('#toolOptions')) && !n.hidden), true, 'подсказка — справа в строке');
    const [w, hint] = await Promise.all([box(page, '#presetH'), box(page, '#canvasHint')]);
    assert.ok(hint.x > w.x + w.width, 'подсказка правее полей');
    await page.fill('#presetW', '900');
    await page.press('#presetW', 'Tab');
    assert.equal(await page.evaluate(() => window.__kepler.state.tool.preset.width), 900);
    await clickToolbarTool(page, 'windowToolBtn');
    assert.equal(await page.isVisible('#presetSill'), true, 'окно — подоконник');
    await page.keyboard.press('Escape');
    await page.click('#wallToolBtn');
    const ext = await page.evaluate(() => window.__kepler.state.project.settings);
    await page.selectOption('#toWallType', 'exterior');
    const t = await page.evaluate(() => ({ type: window.__kepler.state.tool.wallType, th: window.__kepler.state.tool.thickness }));
    assert.equal(t.type, 'exterior');
    assert.ok(t.th > 0 && t.th === Number(await page.inputValue('#toWallT')), `толщина ${t.th}`);
    assert.ok(ext, 'настройки есть');
    await page.fill('#toWallT', '150');
    await page.press('#toWallT', 'Tab');
    assert.equal(await page.evaluate(() => window.__kepler.state.tool.thickness), 150);
    await page.keyboard.press('Escape');
    assert.equal(await page.$eval('#toolOptionsBody', (n) => n.childElementCount), 0);
  });

  it('правая панель: «Свойства», «Виды», «Листы», «ТЭП», «⚠ Замечания»; проект — свёрнутой секцией', async () => {
    const { page } = app;
    const tabs = await page.$$eval('#propsPanel .props-tabs > button', (ns) => ns.map((n) => n.id));
    assert.deepEqual(tabs, ['propsTabMain', 'propsTabViews', 'propsTabSheets', 'propsTabTep', 'issuesBtn']);
    assert.equal(await page.$('#propsPanel .library, #propsPanel #roomCards'), null, 'библиотеки в правой панели нет');
    assert.equal(await page.$eval('#projectSection', (n) => n.open), false, '«Проект» свёрнут');
    assert.equal(await page.isVisible('#levelName'), false);
    await page.click('#projectSummary');
    assert.equal(await page.isVisible('#levelName'), true);
    assert.equal(await page.isVisible('#unitsSel'), true);
    // Перерисовка панели не сворачивает секцию.
    await page.evaluate(() => window.__kepler.select(null));
    assert.equal(await page.$eval('#projectSection', (n) => n.open), true);
    await page.click('#issuesBtn');
    assert.equal(await page.$eval('#issuesPanel', (n) => Boolean(n.closest('#propsPanel')) && !n.hidden), true, 'замечания — в правой панели');
    assert.equal(await page.isVisible('#propsBody'), false);
    assert.equal(await page.getAttribute('#propsTabMain', 'aria-selected'), 'false');
    await page.click('#propsTabMain');
    assert.equal(await page.isHidden('#issuesPanel'), true);
    assert.equal(await page.isVisible('#propsBody'), true);
    assert.equal(await page.getAttribute('#propsTabMain', 'aria-selected'), 'true');
    const id = await page.evaluate(() => window.__kepler.state.project.rooms[0].id);
    await page.evaluate((rid) => window.__kepler.selectRoom(rid), id);
    assert.equal(await page.isVisible('#roomName'), true, 'свойства выбранной комнаты');
    assert.deepEqual(app.errors, []);
  });
});

describe('раскладка на телефоне', () => {
  let app;
  before(async () => { app = await startApp({ mobile: true }); await openSample(app.page); });
  after(async () => { await app?.close(); });

  it('план во всю ширину (колонки нет), «⚠» на холсте, параметры — только у инструмента', async () => {
    const { page } = app;
    const [canvas, nav] = await Promise.all([box(page, '#canvas'), box(page, '#mobileBar')]);
    assert.equal(await page.isVisible('#toolStrip'), false, 'колонки инструментов нет');
    assert.ok(canvas.x <= 0.5 && canvas.width >= 389, `план во всю ширину ${JSON.stringify(canvas)}`);
    assert.ok(nav.y >= canvas.y + canvas.height - 1 && nav.y + nav.height <= 844.5, 'навигация — внизу экрана');
    assert.equal(await page.$eval('#issuesBtn', (n) => Boolean(n.closest('.canvas-wrap'))), true);
    assert.equal(await page.isVisible('#issuesBtn'), true);
    assert.equal(await page.isVisible('#toolOptions'), false, '«Выбор» — строки параметров нет');
    await page.tap('#mobileBar [data-sheet="draw"]');
    await mobileSelectFamilyTool(page, 'openings', 'doorToolBtn');
    assert.equal(await page.isVisible('#presetW'), true, 'дверь — параметры');
    const opts = await box(page, '#toolOptions');
    assert.ok(opts.x >= 0 && opts.x + opts.width <= 390.5, 'в экране');
    assert.equal(await page.$eval('#canvasHint', (n) => Boolean(n.closest('.canvas-wrap'))), true, 'подсказка — на холсте');
    await page.keyboard.press('Escape');
    assert.equal(await page.isVisible('#toolOptions'), false);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= 390), 'не шире экрана');
    assert.deepEqual(app.errors, []);
  });
});
