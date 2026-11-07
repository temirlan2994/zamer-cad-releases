// e2e колонки инструментов (ui/toolstrip.js) и вкладки «ТЭП»
// (ui/props-tep.js): кнопки-иконки с подсказками, подсветка активного
// инструмента, наборы «План» / «Участок» / «Ландшафт», всплывающие «Вид»,
// привязки внизу холста, шапка без инструментов; удалённые блоки «Варианты»,
// «Управление», «Движок стен»; телефон — прокручиваемая строка.
// Раскладка целиком (библиотека, строка параметров) — layout.e2e.mjs.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, openSample } from './helpers.mjs';

const tool = (page) => page.evaluate(() => window.__kepler.state.tool?.kind || null);
const active = (page, sel) => page.$eval(sel, (n) => n.classList.contains('active'));
const MOVED = ['fitBtn', 'wallToolBtn', 'boundRoomBtn', 'dimModeBtn', 'viewBtn', 'alignBtn', 'stairsToolBtn'];

describe('панель инструментов', () => {
  let app;
  before(async () => {
    app = await startApp();
    await openSample(app.page);
  });
  after(async () => { await app?.close(); });

  it('кнопки в колонке, в шапке — режимы и общие действия', async () => {
    const { page } = app;
    assert.equal(await page.isVisible('#toolStrip'), true);
    for (const id of [...MOVED, 'selectToolBtn', 'doorToolBtn', 'windowToolBtn', 'furnitureToolBtn']) {
      assert.equal(await page.$eval(`#${id}`, (n) => Boolean(n.closest('#toolStrip'))), true, `#${id} на панели инструментов`);
    }
    for (const id of ['undoBtn', 'redoBtn', 'themeBtn', 'helpBtn', 'projectsBtn', 'menuBtn', 'saveBtn', 'exportBtn', 'modePlanBtn', 'modeSiteBtn', 'view3dBtn', 'projectName']) {
      assert.equal(await page.$eval(`#${id}`, (n) => Boolean(n.closest('.topbar'))), true, `#${id} в шапке`);
    }
    assert.equal(await page.$$eval('.topbar #fitBtn, .topbar #wallToolBtn, .topbar #dimModeBtn', (ns) => ns.length), 0);
    // Колонка — под шапкой, слева от холста.
    const [top, strip, canvas] = await Promise.all(['.topbar', '#toolStrip', '#canvas'].map((s) => page.locator(s).boundingBox()));
    assert.ok(strip.y >= top.y + top.height - 1 && canvas.x >= strip.x + strip.width - 1, 'шапка → колонка | холст');
    // Иконка, подсказка (.tb-tip, без title) с названием, подпись — не длиннее одного слова.
    const btns = await page.$$eval('#toolStrip .tb-btn', (ns) => ns.filter((n) => n.offsetParent).map((n) => ({
      id: n.id, svg: Boolean(n.querySelector('svg')), title: n.hasAttribute('title') ? '' : n.querySelector('.tb-tip')?.textContent || '', label: n.getAttribute('aria-label'),
      text: n.querySelector('.tb-label')?.textContent.trim() || '',
    })));
    assert.ok(btns.length >= 10, `кнопок ${btns.length}`); // «Орто» и «Привязки» переехали вниз холста
    for (const b of btns) {
      assert.ok(b.svg && b.title.length > 3 && b.label, `кнопка ${b.id}: иконка и подсказка`);
      assert.ok(!/\s/.test(b.text), `подпись ${b.id} «${b.text}» — одно слово`);
    }
    assert.match(await page.textContent('#wallToolBtn .tb-tip'), /\bW\b/);
    assert.equal(await page.$$eval('#toolStrip #orthoBtn, #toolStrip #snapMenuBtn, #toolStrip #snapBar', (ns) => ns.length), 0, 'привязки — не на панели');
  });

  it('активный инструмент подсвечен; Esc и «Выбор» снимают', async () => {
    const { page } = app;
    assert.equal(await active(page, '#selectToolBtn'), true);
    await page.click('#wallToolBtn');
    assert.equal(await tool(page), 'wall');
    assert.equal(await active(page, '#wallToolBtn'), true);
    assert.equal(await active(page, '#selectToolBtn'), false);
    await page.keyboard.press('Escape');
    assert.equal(await tool(page), null);
    assert.equal(await active(page, '#wallToolBtn'), false);
    assert.equal(await active(page, '#selectToolBtn'), true);
    await page.keyboard.press('w'); // клавиша осталась
    assert.equal(await tool(page), 'wall');
    assert.equal(await active(page, '#wallToolBtn'), true);
    await page.click('#selectToolBtn');
    assert.equal(await tool(page), null);
    await page.click('#doorToolBtn');
    assert.deepEqual(await page.evaluate(() => [window.__kepler.state.tool?.kind, window.__kepler.state.tool?.openKind]), ['place-opening', 'door']);
    assert.equal(await active(page, '#doorToolBtn'), true);
    await page.click('#windowToolBtn');
    assert.equal(await page.evaluate(() => window.__kepler.state.tool?.openKind), 'window');
    assert.equal(await active(page, '#doorToolBtn'), false);
    assert.equal(await active(page, '#windowToolBtn'), true);
    await page.click('#windowToolBtn'); // повторный клик — выйти
    assert.equal(await tool(page), null);
    await page.click('#boundRoomBtn');
    assert.equal(await tool(page), 'bound-room');
    assert.equal(await active(page, '#boundRoomBtn'), true);
    await page.click('#boundRoomBtn');
    assert.equal(await tool(page), null);
  });

  it('«Мебель» открывает каталог мебели', async () => {
    const { page } = app;
    await page.click('#furnitureToolBtn');
    assert.equal(await page.isVisible('#furnitureBar'), true);
    assert.equal(await active(page, '#furnitureToolBtn'), true);
    await page.$eval('#libTabRooms', (n) => n.click());
    assert.equal(await active(page, '#furnitureToolBtn'), false);
    assert.equal(await page.isVisible('#roomCards'), true);
  });

  it('«Вид» — всплывающая панель; привязки — значками в строке состояния справа', async () => {
    const { page } = app;
    await page.click('#viewBtn');
    assert.equal(await page.isVisible('#viewPanel'), true);
    const [btn, panel] = await Promise.all(['#viewBtn', '#viewPanel'].map((s) => page.locator(s).boundingBox()));
    assert.ok(panel.x >= btn.x + btn.width && panel.y >= 0 && panel.y + panel.height <= 820, `панель справа от колонки ${JSON.stringify(panel)}`);
    await page.click('#viewBtn');
    assert.equal(await page.isHidden('#viewPanel'), true);
    assert.equal(await page.$eval('#snapBar', (n) => Boolean(n.closest('.canvas-wrap .statusbar'))), true);
    assert.equal(await page.$$eval('#snapBar [data-snap]', (ns) => ns.length), 6, 'Орто, Полярка, Объекты, Выравнивание, Магнит блоков, Направляющие');
    // Размеры: подпись и подсветка меняются.
    assert.equal((await page.textContent('#dimModeBtn .tb-label')).trim(), 'Снаружи');
    await page.click('#dimModeBtn');
    assert.equal((await page.textContent('#dimModeBtn .tb-label')).trim(), 'Ось');
    assert.equal(await active(page, '#dimModeBtn'), false);
    await page.click('#dimModeBtn');
    assert.equal(await active(page, '#dimModeBtn'), true);
  });

  it('режимы меняют набор: «Участок» — слои участка, «Ландшафт» — разрез, массив, выноска', async () => {
    const { page } = app;
    assert.equal(await page.isVisible('#planTools'), true);
    assert.equal(await page.isHidden('#siteTools'), true);
    await page.click('#modeSiteBtn');
    assert.equal(await page.isHidden('#planTools'), true);
    assert.equal(await page.isVisible('#siteTools'), true);
    assert.equal(await page.isHidden('#landscapeTools'), true);
    assert.equal(await page.isHidden('.library'), true, 'левая панель без каталога скрыта');
    const names = await page.$$eval('#siteTools .tb-btn', (ns) => ns.map((n) => n.getAttribute('aria-label')));
    assert.deepEqual(names, ['Топосъёмка', 'Граница участка', 'Красная линия', 'Дорога', 'Въезд', 'Соседний дом', 'Отметка высоты', 'Север по 2 точкам', 'Калибровка']);
    await page.click('#siteTools [aria-label="Север по 2 точкам"]');
    assert.equal(await tool(page), 'north');
    assert.equal(await active(page, '#siteTools [aria-label="Север по 2 точкам"]'), true);
    assert.equal(await active(page, '#selectToolBtn'), false);
    await page.click('#siteTools [aria-label="Север по 2 точкам"]'); // повторный — выйти
    assert.equal(await tool(page), null);
    await page.click('#landscapeBtn');
    assert.equal(await page.isHidden('#siteTools'), true);
    assert.equal(await page.isVisible('#landscapeTools'), true);
    assert.equal(await page.isVisible('#lsItems'), true, 'каталог ландшафта слева');
    assert.equal(await page.$eval('#landscapeTools [data-ls-tool="array"]', (n) => n.disabled), true, 'массив — только с выделением');
    await page.click('#landscapeTools [data-ls-tool="section"]');
    assert.equal(await tool(page), 'ls-section');
    assert.equal(await active(page, '#landscapeTools [data-ls-tool="section"]'), true);
    await page.keyboard.press('Escape');
    await page.click('#modePlanBtn');
    assert.equal(await page.isVisible('#planTools'), true);
    assert.equal(await page.isVisible('.library'), false, '«План» без инструмента — библиотека не занимает холст');
    assert.deepEqual(app.errors, []);
  });
});

describe('свойства: вкладка «ТЭП и площади», удалённые блоки', () => {
  let app;
  before(async () => {
    app = await startApp();
    await openSample(app.page);
  });
  after(async () => { await app?.close(); });

  it('«Проект» — параметры без площадей, вариантов, клавиш и движка стен', async () => {
    const { page } = app;
    assert.equal(await page.isVisible('#propsTabMain'), true);
    assert.equal(await page.getAttribute('#propsTabMain', 'aria-selected'), 'true');
    const text = await page.textContent('#propsBody');
    assert.match(text, /Проект/);
    for (const s of ['Помещений', 'Варианты', 'Сгенерировать', 'Управление', 'Движок стен', 'Состав', 'Площадь застройки']) {
      assert.ok(!text.includes(s), `нет «${s}»`);
    }
    for (const sel of ['#wallsEngineSel', '#variantSave', '#variantGenerate', '#compareScreen', '.hotkeys', '#propsPanel .variant-list']) {
      assert.equal(await page.$(sel), null, `нет ${sel}`);
    }
    assert.ok(await page.$('#levelName'), 'этаж остаётся');
    assert.ok(await page.$('#unitsSel'), 'единицы остаются');
  });

  it('вкладка: подвкладки «ТЭП» (показатели дома) и «Экспликация»; строка выбирает помещение', async () => {
    const { page } = app;
    await page.click('#propsTabTep');
    assert.equal(await page.getAttribute('#propsTabTep', 'aria-selected'), 'true');
    const house = await page.textContent('#tepHouse');
    assert.match(house, /Помещений/);
    assert.match(house, /площадь/i);
    const tep = await page.textContent('#tepRows');
    assert.match(tep, /Площадь застройки/);
    assert.match(tep, /Общая площадь дома/);
    assert.equal(await page.$('#schedTable'), null, 'экспликация — на своей подвкладке');
    await page.click('#tepTabRooms');
    assert.equal(await page.$('#tepRows'), null);
    const rooms = await page.evaluate(() => window.__kepler.state.project.levels.reduce((n, l) => n + l.rooms.length, 0));
    assert.equal(await page.$$eval('#schedTable [data-sched-room]', (ns) => ns.length), rooms);
    assert.match(await page.textContent('#schedTable tfoot'), /Общая/);
    // Перерисовка панели (правка) не сбрасывает вкладку и подвкладку.
    await page.evaluate(() => window.__kepler.select(null));
    assert.equal(await page.isVisible('#schedTable'), true);
    const id = await page.$eval('#schedTable [data-sched-room]', (n) => n.dataset.schedRoom);
    await page.click(`#schedTable [data-sched-room="${id}"]`);
    assert.deepEqual(await page.evaluate(() => window.__kepler.state.selection), { type: 'room', id });
    assert.equal(await page.getAttribute('#propsTabMain', 'aria-selected'), 'true', 'выбор объекта — вкладка «Свойства»');
    assert.ok(await page.$('#roomName'), 'свойства помещения');
    assert.deepEqual(app.errors, []);
  });
});

describe('панель инструментов на телефоне', () => {
  let app;
  before(async () => {
    app = await startApp({ mobile: true });
    await openSample(app.page);
  });
  after(async () => { await app?.close(); });

  it('одна прокручиваемая строка, кнопки ≥ 40 px, вёрстка не шире экрана', async () => {
    const { page } = app;
    const strip = await page.locator('#toolStrip').boundingBox();
    assert.ok(strip.x >= 0 && strip.x + strip.width <= 390.5, `панель ${JSON.stringify(strip)}`);
    assert.ok(strip.height <= 56, `одна строка: ${strip.height}`);
    const m = await page.evaluate(() => {
      const s = document.getElementById('toolStrip');
      const sizes = [...s.querySelectorAll('.tb-btn')].filter((n) => n.offsetParent).map((n) => n.getBoundingClientRect());
      return {
        sw: s.scrollWidth, cw: s.clientWidth, overflow: getComputedStyle(s).overflowX,
        minH: Math.min(...sizes.map((r) => r.height)), minW: Math.min(...sizes.map((r) => r.width)),
        page: document.documentElement.scrollWidth,
      };
    });
    assert.ok(m.minH >= 40 && m.minW >= 40, `кнопки ${m.minW}×${m.minH}`);
    assert.equal(m.overflow, 'auto');
    assert.ok(m.page <= 390, `страница ${m.page}`);
    assert.equal(await page.isVisible('#mobileBar'), true, 'нижняя панель осталась');
    // Последняя кнопка достижима прокруткой, «Вид» открывает панель в экране.
    await page.locator('#viewBtn').scrollIntoViewIfNeeded();
    await page.tap('#viewBtn');
    const panel = await page.locator('#viewPanel').boundingBox();
    assert.ok(panel && panel.x >= 0 && panel.x + panel.width <= 390.5 && panel.y >= 0 && panel.y + panel.height <= 844, `панель вида ${JSON.stringify(panel)}`);
    await page.tap('#viewBtn');
    assert.equal(await page.isHidden('#viewPanel'), true);
    await page.locator('#wallToolBtn').scrollIntoViewIfNeeded();
    await page.tap('#wallToolBtn');
    assert.equal(await tool(page), 'wall');
    assert.equal(await active(page, '#wallToolBtn'), true);
    await page.keyboard.press('Escape');
    assert.deepEqual(app.errors, []);
  });
});
