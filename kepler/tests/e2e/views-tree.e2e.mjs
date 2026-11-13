// e2e: виды и листы, как в Revit. «Виды» — дерево видов (планы этажей,
// участок, ландшафт, 3D, разрезы, фасады): клик/двойной клик открывает вид,
// активный подсвечен. «Свойства» без выбора — «Вид: …» и его настройки,
// с выбором — свойства объекта; лист выбран или открыт — свойства листа.
// «Листы»: двойной клик открывает лист на холсте, Esc закрывает.
// «ТЭП»: подвкладки-значки «Экспликация помещений» и «ТЭП».
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, openSample } from './helpers.mjs';

const st = (page) => page.evaluate(() => ({
  mode: window.__kepler.state.modeName,
  level: window.__kepler.state.project.activeLevel,
  levels: window.__kepler.state.project.levels.map((l) => l.id),
}));
const activeView = (page) => page.$$eval('#viewTree .vt-item[aria-selected="true"]', (ns) => ns.map((n) => n.dataset.view));

describe('дерево видов, свойства вида, листы, ТЭП — компьютер 1280', () => {
  let app;
  before(async () => { app = await startApp(); await openSample(app.page); });
  after(async () => { await app?.close(); });

  it('группы дерева; активный вид — план текущего этажа', async () => {
    const { page } = app;
    await page.click('#propsTabViews');
    const groups = await page.$$eval('#viewTree .vt-group > summary', (ns) => ns.map((n) => n.firstChild.textContent.trim()));
    assert.deepEqual(groups, ['Планы этажей', 'Кровля', 'Участок', 'Ландшафт', '3D', 'Разрезы', 'Фасады']);
    const { level } = await st(page);
    assert.deepEqual(await activeView(page), [`plan:${level}`]);
    assert.match(await page.textContent('[data-vt-group="facades"]'), /Фасад Север/);
    // «План крыши»: открывается из дерева, на лист не тянется; назад — план этажа.
    assert.equal(await page.getAttribute('[data-view="roofplan"]', 'draggable'), 'false');
    await page.click('[data-view="roofplan"]');
    assert.equal(await page.evaluate(() => window.__kepler.state.roofPlan), true);
    assert.deepEqual(await activeView(page), ['roofplan']);
    await page.click(`[data-view="plan:${level}"]`);
    assert.equal(await page.evaluate(() => window.__kepler.state.roofPlan), false);
    assert.deepEqual(await activeView(page), [`plan:${level}`]);
  });

  it('двойной клик по «2 этаж» — этаж и режим «План»', async () => {
    const { page } = app;
    await page.click('#levelBar .add');
    const { levels } = await st(page);
    assert.equal(levels.length, 2);
    await page.click('#propsTabViews');
    const names = await page.$$eval('[data-vt-group="plans"] .vt-name', (ns) => ns.map((n) => n.textContent));
    assert.equal(names.length, 2);
    // Сначала — «Ландшафт» и первый этаж, потом двойным кликом второй.
    await page.click('[data-view="landscape"]');
    assert.equal((await st(page)).mode, 'landscape');
    await page.click(`[data-view="plan:${levels[0]}"]`);
    assert.deepEqual(await st(page), { mode: 'plan', level: levels[0], levels });
    await page.click('[data-view="site"]');
    assert.equal((await st(page)).mode, 'site');
    await page.dblclick(`#viewTree [data-view="plan:${levels[1]}"]`);
    const s = await st(page);
    assert.equal(s.mode, 'plan');
    assert.equal(s.level, levels[1]);
    assert.deepEqual(await activeView(page), [`plan:${levels[1]}`]);
    assert.equal(await page.textContent(`[data-view="plan:${levels[1]}"] .vt-name`), names[1]);
    assert.equal(await page.getAttribute('#propsTabViews', 'aria-selected'), 'true', 'вкладка «Виды» остаётся');
    await page.click(`[data-view="plan:${levels[0]}"]`);
    assert.deepEqual(app.errors, []);
  });

  it('«Ландшафт», «Участок», «3D» — открываются из дерева; Esc закрывает 3D', async () => {
    const { page } = app;
    await page.click('[data-view="landscape"]');
    assert.equal((await st(page)).mode, 'landscape');
    assert.deepEqual(await activeView(page), ['landscape']);
    await page.click('[data-view="site"]');
    assert.equal((await st(page)).mode, 'site');
    assert.deepEqual(await activeView(page), ['site']);
    await page.click('[data-view="3d"]');
    assert.equal(await page.isVisible('#view3d'), true);
    assert.deepEqual(await activeView(page), ['3d']);
    await page.keyboard.press('Escape');
    assert.equal(await page.isHidden('#view3d'), true);
    assert.deepEqual(await activeView(page), ['site']);
    // В «Участке» без выбора — свои настройки и свёрнутый «Вид: Участок».
    await page.click('#propsTabMain');
    assert.match(await page.textContent('#viewSummary'), /Вид: Участок/);
    await page.click('#viewSummary');
    assert.equal(await page.isVisible('#viewSection #viewsAngleInput'), true);
    await page.click('#propsTabViews');
    await page.click(`[data-view="plan:${(await st(page)).levels[0]}"]`);
    assert.deepEqual(app.errors, []);
  });

  it('«Свойства» без выбора — «Вид: 1 этаж» и настройки; объект — его свойства', async () => {
    const { page } = app;
    await page.click('#propsTabMain');
    const name = await page.evaluate(() => window.__kepler.state.project.levels[0].name);
    assert.equal(await page.textContent('#viewPropsTitle'), `Вид: ${name}`);
    for (const id of ['#viewsAngleInput', '#viewsAlignBtn', '#viewsDimOuter', '#views3dBtn', '#viewsLsOn']) {
      assert.equal(await page.isVisible(id), true, id);
    }
    assert.equal(await page.$eval('#projectSection', (n) => n.open), false, '«Проект» — свёрнут внизу');
    const id = await page.evaluate(() => window.__kepler.state.project.rooms[0].id);
    await page.evaluate((rid) => window.__kepler.selectRoom(rid), id);
    assert.equal(await page.isVisible('#roomName'), true);
    assert.equal(await page.$('#viewPropsTitle'), null);
    await page.evaluate(() => window.__kepler.select(null));
    assert.equal(await page.isVisible('#viewPropsTitle'), true);
    assert.deepEqual(app.errors, []);
  });

  it('«Листы»: клик — свойства листа; двойной клик — лист на холсте; Esc — назад', async () => {
    const { page } = app;
    await page.click('#propsTabSheets');
    await page.click('#sheetsList [data-sheet="site"] .sheets-name');
    assert.equal(await page.getAttribute('#sheetsList [data-sheet="site"]', 'aria-selected'), 'true');
    await page.click('#propsTabMain');
    assert.equal(await page.textContent('#sheetPropsTitle'), 'Лист 1 — Генплан');
    assert.match(await page.textContent('#sheetProps'), /A3 · 420×297 мм/);
    assert.match(await page.textContent('#sheetProps'), /альбомная/);
    await page.click('#sheetPropBack');
    assert.equal(await page.isVisible('#viewPropsTitle'), true, '«← Свойства вида»');

    const before = await st(page);
    await page.click('#propsTabSheets');
    const key = `level:${before.levels[0]}`;
    await page.dblclick(`#sheetsList [data-sheet="${key}"] .sheets-name`);
    assert.equal(await page.isVisible('#sheetView'), true);
    assert.match(await page.textContent('#sheetViewTitle'), /^Лист 2 — План: /);
    await page.waitForFunction(() => document.getElementById('sheetViewImg')?.naturalWidth > 0);
    for (const b of ['#sheetViewPdf', '#sheetViewPng', '#sheetViewClose']) assert.equal(await page.isVisible(b), true, b);
    await page.click('#propsTabMain');
    assert.match(await page.textContent('#sheetPropsTitle'), /^Лист 2/);
    await page.waitForFunction(() => /1:\d+/.test(document.getElementById('sheetPropScale')?.textContent || ''));
    // PNG — этот лист, A3 150 dpi.
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#sheetViewPng')]);
    assert.match(dl.suggestedFilename(), /лист-2\.png$/);
    await page.keyboard.press('Escape');
    assert.equal(await page.isHidden('#sheetView'), true);
    assert.deepEqual(await st(page), before, 'вид — прежний');
    assert.equal(await page.isVisible('#viewPropsTitle'), true);
    // «Закрыть лист» — то же.
    await page.click('#propsTabSheets');
    await page.click(`#sheetsList [data-sheet-open="${key}"]`);
    assert.equal(await page.isVisible('#sheetView'), true);
    await page.click('#sheetViewClose');
    assert.equal(await page.isHidden('#sheetView'), true);
    assert.deepEqual(app.errors, []);
  });

  it('«ТЭП»: две подвкладки-значки, мгновенная подсказка, подвкладка помнится', async () => {
    const { page } = app;
    await page.click('#propsTabTep');
    const tabs = await page.$$eval('.tep-tabs > button', (ns) => ns.map((n) => ({
      id: n.id, title: n.getAttribute('title'), label: n.getAttribute('aria-label'), role: n.getAttribute('role'),
      sel: n.getAttribute('aria-selected'), text: [...n.childNodes].filter((c) => !c.classList?.contains('ptab-tip')).map((c) => c.textContent).join('').trim(),
    })));
    assert.deepEqual(tabs.map((t) => [t.id, t.label, t.role, t.title, t.text]), [
      ['tepTabRooms', 'Экспликация помещений', 'tab', null, ''],
      ['tepTabTep', 'ТЭП', 'tab', null, ''],
    ]);
    assert.equal(await page.isVisible('#tepRows'), true);
    assert.equal(await page.$('#schedTable'), null);
    await page.mouse.move(5, 5);
    assert.equal(await page.isHidden('#tepTip-rooms'), true);
    await page.hover('#tepTabRooms');
    const tip = await page.$eval('#tepTip-rooms', (n) => ({ d: getComputedStyle(n).display, t: n.textContent, r: n.getBoundingClientRect().toJSON() }));
    assert.notEqual(tip.d, 'none');
    assert.ok(tip.t.startsWith('Экспликация помещений ·'), tip.t);
    assert.ok(tip.r.x >= 0 && tip.r.x + tip.r.width <= 1280, JSON.stringify(tip.r));
    await page.click('#tepTabRooms');
    assert.equal(await page.getAttribute('#tepTabRooms', 'aria-selected'), 'true');
    assert.equal(await page.isVisible('#schedTable'), true);
    assert.equal(await page.$('#tepRows'), null);
    await page.evaluate(() => window.__kepler.select(null)); // перерисовка панели
    assert.equal(await page.isVisible('#schedTable'), true, 'подвкладка помнится');
    await page.click('#propsTabMain');
    await page.click('#propsTabTep');
    assert.equal(await page.getAttribute('#tepTabRooms', 'aria-selected'), 'true');
    await page.click('#tepTabTep');
    assert.equal(await page.isVisible('#tepHouse'), true);
    assert.deepEqual(app.errors, []);
  });
});

describe('дерево видов и листы — телефон 390', () => {
  let app;
  before(async () => { app = await startApp({ mobile: true }); await openSample(app.page); });
  after(async () => { await app?.close(); });

  it('вид и лист из нижнего листа открываются во весь холст', async () => {
    const { page } = app;
    const sheetOpen = () => page.evaluate(() => document.body.classList.contains('sheet-props'));
    await page.tap('#mobileBar [data-sheet="props"]');
    await page.tap('#propsTabViews');
    await page.tap('[data-view="site"]');
    assert.equal((await st(page)).mode, 'site');
    assert.equal(await sheetOpen(), false, 'нижний лист уехал');
    await page.tap('#mobileBar [data-sheet="props"]');
    await page.tap('#propsTabSheets');
    await page.tap('#sheetsList [data-sheet-open="site"]');
    assert.equal(await page.isVisible('#sheetView'), true);
    assert.equal(await sheetOpen(), false);
    const bar = await page.locator('#sheetViewClose').boundingBox();
    assert.ok(bar.x >= 0 && bar.x + bar.width <= 390.5, `«Закрыть лист» в экране ${JSON.stringify(bar)}`);
    await page.tap('#sheetViewClose');
    assert.equal(await page.isHidden('#sheetView'), true);
    assert.ok((await page.evaluate(() => document.documentElement.scrollWidth)) <= 390);
    assert.deepEqual(app.errors, []);
  });
});
