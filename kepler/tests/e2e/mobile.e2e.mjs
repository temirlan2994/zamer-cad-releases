// e2e мобильной раскладки 390×844 (ui/mobile.js, styles.css «Телефон, шаг 3»):
// лента инструментов с подписями внизу, нижняя навигация (Каталог, Свойства,
// Виды, Листы, 3D, Ещё), нижние листы с ручкой и «✕», компактная шапка,
// ничего не выходит за экран. Планшет 768 — компьютерная раскладка без
// мобильной навигации.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, openSample } from './helpers.mjs';

const W = 390;
const H = 844;
const box = async (page, sel) => (await page.$(sel)).boundingBox();
const inScreen = (b) => b && b.x >= -0.5 && b.y >= -0.5 && b.x + b.width <= W + 0.5 && b.y + b.height <= H + 0.5;
const has = (page, cls) => page.evaluate((c) => document.body.classList.contains(c), cls);
const settle = (page) => page.waitForTimeout(260); // выезд листа — 0.2 с

// Видимые контролы вне экрана (кроме лежащих в прокручиваемых рядах).
const offscreen = (page) => page.evaluate(() => {
  const out = [];
  for (const n of document.querySelectorAll('button, input, select')) {
    const r = n.getBoundingClientRect();
    if (!r.width || !r.height || !n.offsetParent || getComputedStyle(n).visibility === 'hidden') continue;
    if (r.x >= -0.5 && r.right <= innerWidth + 0.5 && r.y >= -0.5 && r.bottom <= innerHeight + 0.5) continue;
    let p = n.parentElement;
    let scroller = false;
    while (p && p !== document.body) {
      const cs = getComputedStyle(p);
      if (/auto|scroll/.test(cs.overflowX + cs.overflowY)) { scroller = true; break; }
      p = p.parentElement;
    }
    if (!scroller) out.push(n.id || n.className || n.tagName);
  }
  return out;
});

describe('телефон 390×844: мобильная раскладка', () => {
  let app;
  before(async () => { app = await startApp({ mobile: true }); await openSample(app.page); });
  after(async () => { await app?.close(); });

  it('шапка компактная: название, ⟲ ⟳, «Сохранить», «⋯» — в экране, без прокрутки', async () => {
    const { page } = app;
    for (const sel of ['#projectName', '#undoBtn', '#redoBtn', '#saveBtn', '#moreBtn']) {
      assert.equal(await page.isVisible(sel), true, sel);
      assert.ok(inScreen(await box(page, sel)), `${sel} в экране`);
    }
    const top = await page.$eval('.topbar', (n) => ({ sw: n.scrollWidth, cw: n.clientWidth, h: n.getBoundingClientRect().height }));
    assert.ok(top.sw <= top.cw + 1, `шапка без прокрутки ${JSON.stringify(top)}`);
    assert.ok(top.h <= 60, `шапка в одну строку: ${top.h}`);
    assert.ok((await page.evaluate(() => document.documentElement.scrollWidth)) <= W, 'страница не шире экрана');
    assert.deepEqual(await offscreen(page), []);
  });

  it('инструменты — колонкой слева: значок и подпись, цели ≥ 44 px; каталожного нет', async () => {
    const { page } = app;
    const [strip, canvas, nav] = await Promise.all(['#toolStrip', '#canvas', '#mobileBar'].map((s) => box(page, s)));
    assert.ok(strip.x + strip.width <= canvas.x + 1 && strip.width < 80, `колонка слева от холста ${JSON.stringify([strip, canvas])}`);
    assert.ok(nav.y >= canvas.y + canvas.height - 1, 'навигация под холстом');
    const btns = await page.$$eval('#toolStrip .tb-btn', (ns) => ns.filter((n) => n.offsetParent).map((n) => {
      const r = n.getBoundingClientRect();
      const label = n.querySelector('.tb-label');
      return { id: n.id || n.dataset.siteTool || '', w: r.width, h: r.height, text: label?.offsetParent ? label.textContent.trim() : '' };
    }));
    for (const b of btns) {
      assert.ok(b.text, `у ${b.id} видна подпись`);
      assert.ok(b.w >= 44 && b.h >= 44, `${b.id} ${b.w}×${b.h}`);
    }
    const texts = btns.map((b) => b.text);
    for (const t of ['Выбор', 'Стена', 'Масса', 'Крыша', 'Ось', 'Разрез']) assert.ok(texts.includes(t), `нет «${t}»`);
    for (const t of ['Помещение', 'Дверь', 'Окно', 'Мебель', 'Лестница']) assert.ok(!texts.includes(t), `«${t}» — в каталоге, не в колонке`);
  });

  it('нижняя навигация: подписи, ≥ 44 px, в экране', async () => {
    const { page } = app;
    const items = await page.$$eval('#mobileBar button', (ns) => ns.filter((n) => n.offsetParent).map((n) => {
      const r = n.getBoundingClientRect();
      return { t: n.textContent.trim(), x: r.x, y: r.y, w: r.width, h: r.height };
    }));
    assert.deepEqual(items.map((i) => i.t), ['Каталог', 'Свойства', 'Виды', 'Листы', '3D', 'Ещё']);
    for (const i of items) {
      assert.ok(i.h >= 44 && i.w >= 44, `${i.t} ${i.w}×${i.h}`);
      assert.ok(inScreen({ x: i.x, y: i.y, width: i.w, height: i.h }), `${i.t} в экране`);
    }
  });

  it('«Виды» и «Листы» — одно касание; лист над навигацией, ручка и «✕»', async () => {
    const { page } = app;
    await page.tap('#mobileBar [data-sheet="views"]');
    await settle(page);
    assert.equal(await has(page, 'sheet-props'), true);
    assert.equal(await page.isVisible('#viewTree'), true, 'дерево видов');
    const [sheet, nav] = await Promise.all([box(page, '#propsPanel'), box(page, '#mobileBar')]);
    assert.ok(sheet.y + sheet.height <= nav.y + 1, 'лист не закрывает навигацию');
    assert.ok(sheet.height < H * 0.5, `лист ~45%: ${sheet.height}`);
    assert.equal(await page.getAttribute('#mobileBar [data-sheet="views"]', 'aria-pressed'), 'true');
    await page.tap('#mobileBar [data-sheet="sheets"]');
    await settle(page);
    assert.equal(await page.isVisible('#sheetsPdfBtn'), true, 'вкладка «Листы»');
    assert.equal(await page.getAttribute('#mobileBar [data-sheet="sheets"]', 'aria-pressed'), 'true');
    // Касание ручки — высокий лист, ещё раз — обратно.
    await page.tap('#propsPanel .sheet-handle');
    await settle(page);
    assert.ok((await box(page, '#propsPanel')).height > H * 0.6, 'высокий лист');
    await page.tap('#propsPanel .sheet-handle');
    await settle(page);
    assert.ok((await box(page, '#propsPanel')).height < H * 0.5);
    assert.deepEqual(await offscreen(page), []);
    await page.tap('#propsPanel .sheet-close');
    await settle(page);
    assert.equal(await has(page, 'sheet-props'), false, '«✕» закрыл лист');
  });

  it('«Свойства» открывают вкладку свойств, повторное касание — закрывает', async () => {
    const { page } = app;
    await page.tap('#mobileBar [data-sheet="props"]');
    await settle(page);
    assert.equal(await page.getAttribute('#propsTabMain', 'aria-selected'), 'true');
    await page.tap('#mobileBar [data-sheet="props"]');
    await settle(page);
    assert.equal(await has(page, 'sheet-props'), false);
  });

  it('«Каталог» — второй ряд; «Помещение» — каталог нижним листом; карточка включает размещение', async () => {
    const { page } = app;
    assert.equal(await page.isVisible('#mobileCat'), false, 'второй ряд скрыт');
    await page.tap('#mobileBar [data-sheet="rooms"]');
    await settle(page);
    const cats = await page.$$eval('#mobileCat button', (ns) => ns.map((n) => n.textContent.trim()));
    assert.deepEqual(cats, ['Помещение', 'Мебель', 'Окно', 'Дверь', 'Лестница']);
    assert.equal(await page.getAttribute('#mobileBar [data-sheet="rooms"]', 'aria-pressed'), 'true');
    await page.tap('#mobileCat [data-cat="room"]');
    await settle(page);
    assert.equal(await has(page, 'sheet-library'), true, 'каталог выехал');
    assert.equal(await page.isVisible('#roomCards .room-card >> text=Гостиная'), true);
    const [lib, row] = await Promise.all([box(page, '.library'), box(page, '#mobileCat')]);
    assert.ok(lib.y + lib.height <= row.y + 1, 'лист над вторым рядом');
    assert.deepEqual(await offscreen(page), []);
    await page.tap('#roomCards .room-card >> text=Гостиная');
    const tool = await page.evaluate(() => window.__kepler.state.tool);
    assert.equal(tool?.kind, 'place-room');
    assert.ok(tool?.type, 'тип комнаты выбран');
    assert.equal(await has(page, 'sheet-library'), false, 'каталог уехал — план свободен');
    await page.keyboard.press('Escape');
  });

  it('«Дверь» — каталог проёмов; «Лестница» — выбор формы, касание плана ставит', async () => {
    const { page } = app;
    await page.tap('#mobileCat [data-cat="door"]');
    await settle(page);
    assert.equal(await page.evaluate(() => window.__kepler.state.tool?.openKind), 'door');
    assert.equal(await page.isVisible('#openingsBar'), true, 'каталог дверей');
    await page.tap('#mobileCat [data-cat="stairs"]');
    await settle(page);
    assert.equal(await has(page, 'sheet-stairs'), true);
    assert.deepEqual(await page.$$eval('#mobileCat [aria-pressed="true"]', (ns) => ns.map((n) => n.dataset.cat)), ['stairs']);
    await page.tap('#mobileStairs [data-stair="l"]');
    const t = await page.evaluate(() => window.__kepler.state.tool);
    assert.equal(t?.itemKind, 'stairs');
    assert.equal(t?.stairShape, 'l');
    const c = await box(page, '#canvas');
    await page.touchscreen.tap(c.x + c.width * 0.6, c.y + c.height * 0.3);
    assert.ok(await page.evaluate(() => window.__kepler.state.project.items.some((i) => i.kind === 'stairs' && i.stairShape === 'l')), 'Г-образная лестница');
    await page.keyboard.press('Escape');
    await page.tap('#mobileBar [data-sheet="rooms"]');
    assert.equal(await page.isVisible('#mobileCat'), false, 'повторное «Каталог» прячет ряд');
  });

  it('«Ещё»: режим «Участок», затем «План»; привязки — рядом сверху, все видны', async () => {
    const { page } = app;
    await page.tap('#moreBtn');
    await settle(page);
    assert.equal(await has(page, 'sheet-more'), true);
    assert.deepEqual(await offscreen(page), []);
    await page.tap('#mobileMore [data-more="site"]');
    assert.equal(await page.evaluate(() => window.__kepler.state.modeName), 'site');
    assert.equal(await has(page, 'sheet-more'), false);
    await page.tap('#mobileBar [data-sheet="more"]');
    await settle(page);
    await page.tap('#mobileMore [data-more="plan"]');
    assert.equal(await page.evaluate(() => window.__kepler.state.modeName), 'plan');
    assert.equal(await page.isVisible('#snapBar [data-snap="ortho"]'), true, 'привязки видны сразу');
    const [snap, canvas] = await Promise.all([box(page, '#mobileSnapRow'), box(page, '#canvas')]);
    assert.ok(snap.y + snap.height <= canvas.y + 1, 'ряд привязок над холстом');
    assert.equal(await page.$('#snapBar .snap-menu'), null, 'кнопки-меню нет');
  });

  it('«3D» на навигации открывает 3D, повторно — закрывает', async () => {
    const { page } = app;
    await page.tap('#mobileBar [data-sheet="3d"]');
    await page.waitForSelector('#view3d', { state: 'visible' });
    assert.equal(await page.getAttribute('#mobileBar [data-sheet="3d"]', 'aria-pressed'), 'true');
    await page.tap('#mobileBar [data-sheet="3d"]');
    await page.waitForSelector('#view3d', { state: 'hidden' });
    assert.ok((await page.evaluate(() => document.documentElement.scrollWidth)) <= W);
    assert.deepEqual(app.errors, []);
  });
});

describe('планшет 768×1024: компьютерная раскладка', () => {
  let app;
  before(async () => { app = await startApp({ width: 768, height: 1024 }); await openSample(app.page); });
  after(async () => { await app?.close(); });

  it('режимы в шапке, мобильной навигации и «⋯» нет, страница не шире экрана', async () => {
    const { page } = app;
    assert.equal(await page.isVisible('#modePlanBtn'), true);
    assert.equal(await page.isVisible('#mobileBar'), false);
    assert.equal(await page.isVisible('#moreBtn'), false);
    assert.equal(await page.isVisible('#mobileMore'), false);
    assert.equal(await page.$$eval('.sheet-grip', (ns) => ns.filter((n) => n.offsetParent).length), 0);
    assert.ok((await page.evaluate(() => document.documentElement.scrollWidth)) <= 768);
    assert.deepEqual(app.errors, []);
  });
});
