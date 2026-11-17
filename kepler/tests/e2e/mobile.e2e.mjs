// e2e мобильной раскладки 390×844 (ui/mobile.js, ui/mobile-card.js, styles.css
// «Телефон»): план во всю ширину, ряд привязок сверху, нижняя навигация
// (Рисовать, Каталог, Свойства, Листы) со вторыми рядами, карточка
// выбранного объекта и этажи вверху плана, лист «Виды» с режимом и «Листами», нижние листы с ручкой
// и «✕», компактная шапка, ничего не выходит за экран. Планшет 768 —
// компьютерная раскладка без мобильной навигации.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, openSample, mobileSelectFamilyTool } from './helpers.mjs';

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

  it('колонки инструментов нет: план во всю ширину, привязки сверху, «Вписать» — кнопкой на плане', async () => {
    const { page } = app;
    assert.equal(await page.isVisible('#toolStrip'), false, 'колонка скрыта');
    const [canvas, snap, nav] = await Promise.all(['#canvas', '#mobileSnapRow', '#mobileBar'].map((s) => box(page, s)));
    assert.ok(canvas.x <= 0.5 && canvas.width >= W - 1, `план во всю ширину ${JSON.stringify(canvas)}`);
    assert.ok(snap.y + snap.height <= canvas.y + 1, 'привязки над планом');
    assert.ok(nav.y >= canvas.y + canvas.height - 1, 'навигация под планом');
    assert.equal(await page.isVisible('#snapBar [data-snap="ortho"]'), true, 'привязки видны сразу');
    const [levels, warn] = await Promise.all(['#levelDock', '#issuesBtn'].map((s) => box(page, s)));
    assert.ok(levels.y < canvas.y + 20 && levels.x < 20, `этажи — вверху слева ${JSON.stringify(levels)}`);
    assert.ok(warn.x >= levels.x + levels.width && Math.abs(warn.y - levels.y) < 2, '«⚠» — сразу за этажами');
    assert.equal(await page.isVisible('#fitFab'), true);
    assert.ok(inScreen(await box(page, '#fitFab')));
    await page.evaluate(() => { window.__kepler.state.view.panX += 900; });
    const pan = await page.evaluate(() => window.__kepler.state.view.panX);
    await page.tap('#fitFab');
    assert.notEqual(await page.evaluate(() => window.__kepler.state.view.panX), pan, '«Вписать» вернул план в экран');
  });

  it('нижняя навигация: Рисовать · Каталог · Свойства · Листы, ≥ 44 px, в экране', async () => {
    const { page } = app;
    const items = await page.$$eval('#mobileBar button', (ns) => ns.filter((n) => n.offsetParent).map((n) => {
      const r = n.getBoundingClientRect();
      return { t: n.textContent.trim(), x: r.x, y: r.y, w: r.width, h: r.height };
    }));
    assert.deepEqual(items.map((i) => i.t), ['Рисовать', 'Каталог', 'Свойства', 'Листы']);
    for (const i of items) {
      assert.ok(i.h >= 44 && i.w >= 44, `${i.t} ${i.w}×${i.h}`);
      assert.ok(inScreen({ x: i.x, y: i.y, width: i.w, height: i.h }), `${i.t} в экране`);
    }
  });

  it('«Рисовать» — второй ряд инструментов; «Стена» включает инструмент, «Готово» выходит', async () => {
    const { page } = app;
    assert.equal(await page.isVisible('#mobileDraw'), false);
    await page.tap('#mobileBar [data-sheet="draw"]');
    const labels = await page.$$eval('#mobileDraw button', (ns) => ns.map((n) => n.textContent.trim()));
    assert.deepEqual(labels, ['Стена', 'Проёмы', 'Крыша', 'Масса', 'Документация', 'Готово']);
    assert.equal(await page.getAttribute('#mobileBar [data-sheet="draw"]', 'aria-pressed'), 'true');
    await page.tap('#mobileDraw [data-draw="wallToolBtn"]');
    assert.equal(await page.evaluate(() => window.__kepler.state.tool?.kind), 'wall');
    assert.equal(await page.getAttribute('#mobileDraw [data-draw="wallToolBtn"]', 'aria-pressed'), 'true');
    const [snap, opts, canvas] = await Promise.all(['#mobileSnapRow', '#toolOptions', '#canvas'].map((s) => box(page, s)));
    assert.ok(snap.y + snap.height <= opts.y + 1 && opts.y + opts.height <= canvas.y + 1, 'параметры стены — под привязками');
    assert.deepEqual(await offscreen(page), []);
    await page.tap('#mobileDraw [data-done]');
    assert.equal(await page.evaluate(() => window.__kepler.state.tool), null, '«Готово» — инструмент выключен');
    assert.equal(await page.isVisible('#mobileDraw'), false, 'ряд убран');
  });

  it('«Каталог» — второй ряд; «Помещение» — каталог нижним листом; карточка включает размещение', async () => {
    const { page } = app;
    assert.equal(await page.isVisible('#mobileCat'), false, 'второй ряд скрыт');
    await page.tap('#mobileBar [data-sheet="rooms"]');
    await settle(page);
    const cats = await page.$$eval('#mobileCat button', (ns) => ns.map((n) => n.textContent.trim()));
    assert.deepEqual(cats, ['Помещение', 'Мебель', 'Лестница', 'Готово']);
    assert.equal(await page.getAttribute('#mobileBar [data-sheet="rooms"]', 'aria-pressed'), 'true');
    await page.tap('#mobileCat [data-cat="room"]');
    await settle(page);
    assert.equal(await has(page, 'sheet-library'), true, 'каталог выехал');
    assert.equal(await page.isVisible('#roomCards .room-card >> text=Гостиная'), true);
    assert.equal(await page.isVisible('#libTabRooms'), false, 'вкладки каталога не нужны — разделы во втором ряду');
    const [lib, row] = await Promise.all([box(page, '.library'), box(page, '#mobileCat')]);
    assert.ok(lib.y + lib.height <= row.y + 1, 'лист над вторым рядом');
    assert.deepEqual(await offscreen(page), []);
    await page.tap('#roomCards .room-card >> text=Гостиная');
    const tool = await page.evaluate(() => window.__kepler.state.tool);
    assert.equal(tool?.kind, 'place-room');
    assert.ok(tool?.type, 'тип комнаты выбран');
    assert.equal(await has(page, 'sheet-library'), false, 'каталог уехал — план свободен');
    await page.tap('#mobileCat [data-done]');
    assert.equal(await page.evaluate(() => window.__kepler.state.tool), null, '«Готово» — размещение отменено');
    assert.equal(await page.isVisible('#mobileCat'), false);
  });

  it('«Дверь» — каталог проёмов; «Лестница» — выбор формы, касание плана ставит', async () => {
    const { page } = app;
    await page.tap('#mobileBar [data-sheet="draw"]');
    await mobileSelectFamilyTool(page, 'openings', 'doorToolBtn');
    await settle(page);
    assert.equal(await page.evaluate(() => window.__kepler.state.tool?.openKind), 'door');
    assert.equal(await page.isVisible('#openingsBar'), true, 'каталог дверей');
    await page.tap('#mobileBar [data-sheet="rooms"]');
    await page.tap('#mobileCat [data-cat="stairs"]');
    await settle(page);
    assert.equal(await has(page, 'sheet-stairs'), true);
    assert.deepEqual(await page.$$eval('#mobileCat [aria-pressed="true"]', (ns) => ns.map((n) => n.dataset.cat)), ['stairs']);
    assert.ok(await page.$$eval('#mobileStairs [data-stair-preset]', (nodes) => nodes.length) >= 6, 'есть интерьерные и наружные пресеты');
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

  it('выбранный объект — карточка вверху плана: название, размеры, действия; поле размера правит объект', async () => {
    const { page } = app;
    const id = await page.evaluate(() => window.__kepler.state.project.rooms.find((r) => r.name === 'Гостиная').id);
    await page.evaluate((rid) => window.__kepler.selectRoom(rid), id);
    await page.waitForSelector('#mobileCard', { state: 'visible' });
    assert.equal(await page.textContent('#mobileCardTitle'), 'Гостиная');
    assert.deepEqual(await page.$$eval('#mobileCard .mc-chip small', (ns) => ns.map((n) => n.textContent)), ['Ш', 'Г']);
    assert.match(await page.textContent('#mobileCard .mc-info'), /м²/);
    assert.equal(await page.isVisible('#mobileCard [data-selection-action="delete"]'), true, 'действия — в карточке');
    assert.equal(await page.$eval('#selectionToolbar', (n) => Boolean(n.closest('#mobileCard'))), true);
    const [card, canvas, levels] = await Promise.all([box(page, '#mobileCard'), box(page, '#canvas'), box(page, '#levelDock')]);
    assert.ok(Math.abs(card.y - canvas.y) < 2, `карточка — вверху плана ${JSON.stringify([card, canvas])}`);
    assert.ok(levels.y >= card.y + card.height - 1, 'этажи — под карточкой');
    assert.deepEqual(await offscreen(page), []);
    const w0 = await page.evaluate((rid) => window.__kepler.state.project.rooms.find((r) => r.id === rid).w, id);
    await page.fill('#mobileCard input[data-field="roomW"]', String(w0 + 500));
    await page.press('#mobileCard input[data-field="roomW"]', 'Enter');
    await page.waitForFunction(([rid, w]) => window.__kepler.state.project.rooms.find((r) => r.id === rid).w === w, [id, w0 + 500]);
    await page.evaluate(() => document.getElementById('undoBtn').click());
    await page.evaluate((rid) => window.__kepler.selectRoom(rid), id); // отмена снимает выделение
    await page.waitForSelector('#mobileCard', { state: 'visible' });
    // «Свойства» — лист без вкладок; карточка на это время скрыта
    await page.tap('#mobileCardProps');
    await settle(page);
    assert.equal(await has(page, 'sheet-props'), true);
    assert.equal(await page.isVisible('#roomName'), true, 'поля помещения');
    assert.equal(await page.isVisible('#propsTabMain'), false, 'вкладок панели нет');
    assert.equal(await page.isVisible('#mobileCard'), false);
    await page.tap('#propsPanel .sheet-close');
    await settle(page);
    assert.equal(await page.isVisible('#mobileCard'), true, 'лист закрыт — карточка вернулась');
    await page.evaluate(() => window.__kepler.select(null));
    await page.waitForSelector('#mobileCard', { state: 'hidden' });
  });

  it('подсказки без клавиш: «Тапайте…», выход — «Готово»; инструмент из карточки — «Готово» на плане', async () => {
    const { page } = app;
    await page.tap('#mobileBar [data-sheet="draw"]');
    await mobileSelectFamilyTool(page, 'openings', 'doorToolBtn');
    const touch = await page.getAttribute('#canvasHint', 'data-touch');
    assert.match(touch, /^Тапайте по стенам/);
    assert.match(touch, /«Готово» — выход/);
    assert.doesNotMatch(touch, /Esc|Пробел|Клик/);
    assert.match(await page.textContent('#canvasHint'), /Esc — выход/, 'исходный текст на месте — его сравнивает код');
    assert.equal(await page.isVisible('#toolDone'), false, '«Готово» уже есть в ряду');
    await page.tap('#mobileDraw [data-done]');
    const id = await page.evaluate(() => window.__kepler.state.project.rooms.find((r) => r.name === 'Гостиная').id);
    await page.evaluate((rid) => window.__kepler.selectRoom(rid), id);
    await page.tap('#mobileCard [data-selection-action="add-window"]');
    assert.equal(await page.evaluate(() => window.__kepler.state.tool?.openKind), 'window');
    assert.equal(await page.isVisible('#toolDone'), true, 'ряда нет — «Готово» на плане');
    await page.tap('#toolDone');
    assert.equal(await page.evaluate(() => window.__kepler.state.tool), null);
    assert.equal(await page.isVisible('#toolDone'), false);
  });

  it('«Листы» открывают список и дают перейти к дереву видов', async () => {
    const { page } = app;
    await page.tap('#mobileBar [data-sheet="sheets"]');
    await settle(page);
    assert.equal(await has(page, 'sheet-props'), true);
    assert.equal(await page.isVisible('#sheetsPdfBtn'), true, 'сразу видны листы');
    assert.equal(await page.getAttribute('#mobileBar [data-sheet="sheets"]', 'aria-pressed'), 'true');
    const [sheet, nav] = await Promise.all([box(page, '#propsPanel'), box(page, '#mobileBar')]);
    assert.ok(sheet.y + sheet.height <= nav.y + 1, 'лист не закрывает навигацию');
    assert.ok(sheet.height < H * 0.5, `лист ~45%: ${sheet.height}`);
    await page.tap('#mobileSheetHead [data-tab="views"]');
    await settle(page);
    assert.equal(await page.isVisible('#viewTree'), true, 'дерево видов');
    assert.equal(await page.getAttribute('#mobileBar [data-sheet="sheets"]', 'aria-pressed'), 'true');
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

  it('«Свойства» без выделения — настройки вида, повторное касание закрывает', async () => {
    const { page } = app;
    await page.tap('#mobileBar [data-sheet="props"]');
    await settle(page);
    assert.equal(await page.getAttribute('#propsTabMain', 'aria-selected'), 'true');
    assert.equal(await page.isVisible('#mobileSheetHead'), false, 'вкладки листов скрыты');
    await page.tap('#mobileBar [data-sheet="props"]');
    await settle(page);
    assert.equal(await has(page, 'sheet-props'), false);
  });

  it('вкладка «Участок»: инструменты участка в «Рисовать», «Готово» видна; обратно «План»', async () => {
    const { page } = app;
    await page.tap('#modeSiteBtn');
    assert.equal(await page.evaluate(() => window.__kepler.state.modeName), 'site');
    assert.equal(await has(page, 'sheet-props'), false, 'лист закрылся — участок виден');
    assert.equal(await page.isHidden('#mobileBar [data-sheet="rooms"]'), true, 'в «Участке» каталога нет');
    await page.tap('#mobileBar [data-sheet="draw"]');
    const n = await page.$$eval('#mobileDraw [data-draw]', (ns) => ns.length);
    assert.ok(n >= 8, `инструменты участка: ${n}`);
    assert.ok(inScreen(await box(page, '#mobileDraw [data-done]')), '«Готово» в экране');
    await page.tap('#modePlanBtn');
    assert.equal(await page.evaluate(() => window.__kepler.state.modeName), 'plan');
  });

  it('«⋯»: действия проекта, тема, справка и установка', async () => {
    const { page } = app;
    await page.tap('#moreBtn');
    await settle(page);
    assert.equal(await has(page, 'sheet-more'), true);
    const keys = await page.$$eval('#mobileMore [data-more]', (ns) => ns.map((n) => n.dataset.more));
    assert.deepEqual(keys, ['projects', 'export', 'menu', 'theme', 'help', 'install']);
    assert.deepEqual(await offscreen(page), []);
    await page.tap('#mobileMore .sheet-close');
    await settle(page);
    assert.equal(await has(page, 'sheet-more'), false);
  });

  it('повторный выбор 3D сохраняет вид, план открывается своей вкладкой', async () => {
    const { page } = app;
    await page.tap('#view3dBtn');
    await page.waitForSelector('#view3d', { state: 'visible' });
    assert.equal(await page.getAttribute('#view3dBtn', 'aria-selected'), 'true');
    await page.tap('#view3dBtn');
    assert.equal(await page.isVisible('#view3d'), true);
    await page.tap('#modePlanBtn');
    await page.waitForSelector('#view3d', { state: 'hidden' });
    assert.ok((await page.evaluate(() => document.documentElement.scrollWidth)) <= W);
    assert.deepEqual(app.errors, []);
  });
});

describe('планшет 768×1024: компьютерная раскладка', () => {
  let app;
  before(async () => { app = await startApp({ width: 768, height: 1024 }); await openSample(app.page); });
  after(async () => { await app?.close(); });

  it('виды в верхних вкладках, мобильной навигации и «⋯» нет, страница не шире экрана', async () => {
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
