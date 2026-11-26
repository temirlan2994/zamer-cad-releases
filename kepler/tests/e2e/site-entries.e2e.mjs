import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { clickWorld, openNew, settleView, startApp, worldToClient } from './helpers.mjs';

const entries = (page) => page.evaluate(() => structuredClone(window.__kepler.state.project.site.entries));
async function entryControl(page, query) {
  await settleView(page);
  return page.evaluate(async (q) => {
    (await import('./ui/dom.js')).renderer.draw(window.__kepler.state);
    const control = window.__kepler.state._entryUI?.controls.find((c) => Object.entries(q).every(([key, value]) => c[key] === value));
    if (!control) throw new Error(`Нет ручки въезда: ${JSON.stringify(q)}`);
    const box = document.getElementById('canvas').getBoundingClientRect();
    return { x: box.x + control.x, y: box.y + control.y };
  }, query);
}
async function flipEntry(page, part, action = 'direction', touch = false) {
  const point = await entryControl(page, { kind: 'flip', part, action });
  if (touch) await page.touchscreen.tap(point.x, point.y);
  else await page.mouse.click(point.x, point.y);
}
async function resizeTarget(page, part, end, extra) {
  return page.evaluate(async ([index, edge, delta]) => {
    const { entryParts } = await import('./core/site-entries.js');
    const { entryWorldPoint } = await import('./core/site-entry-handles.js');
    const s = window.__kepler.state;
    const entry = s.project.site.entries.find((e) => e.id === s.selection.id);
    const p = entryParts(entry)[index];
    const sign = edge === 'start' ? -1 : 1;
    return entryWorldPoint(entry, p.offset + sign * (p.width / 2 + delta));
  }, [part, end, extra]);
}
async function chooseEntry(page, choice, { mobile = false, wicket = false, size = choice.startsWith('wicket') ? '1000-1800' : '4000-1800' } = {}) {
  if (mobile) {
    if (!await page.locator('#mobileDraw').isVisible()) await page.tap('#mobileBar [data-sheet="draw"]');
    await page.tap('#mobileDraw [data-draw="entry"]');
  } else await page.click('[data-site-tool="entry"]');
  await page.click(`#entryLibraryBar [data-entry-cat="${choice}"]`);
  if (!choice.startsWith('wicket')) await page.locator('#entryPresetWicket').setChecked(wicket);
  if (process.env.KEPLER_SHOTS) await page.screenshot({ path: `${process.env.KEPLER_SHOTS}/entry-menu-${mobile ? 'phone' : 'desktop'}-${choice}.png` });
  await page.click(`#entryLibraryBar [data-entry-preset="${choice}-${size}"]`);
}
async function setup(page, mobile = false) {
  await openNew(page);
  await page.evaluate(async () => {
    const { mutate } = await import('./ui/store.js');
    mutate(() => {
      const s = window.__kepler.state.project.site;
      s.boundary = [{ x: 0, y: 0 }, { x: 24000, y: 0 }, { x: 24000, y: 18000 }, { x: 0, y: 18000 }];
      s.entries = []; s.entry = null;
    });
    window.__kepler.setEditorMode('site');
  });
  await settleView(page);
  await page.evaluate(async (phone) => {
    const v = window.__kepler.state.view;
    v.scale = phone ? .012 : .025; v.panX = phone ? 25 : 350; v.panY = 100;
    (await import('./ui/view.js')).requestDraw();
  }, mobile);
}

describe('ворота и калитки участка', () => {
  let app;
  before(async () => { app = await startApp(); await setup(app.page); });
  after(async () => { await app?.close(); });

  it('два клика создают двое ворот, а отдельная калитка — третий объект', async () => {
    const { page } = app;
    assert.equal(await page.locator('[data-site-tool="entry"]').getAttribute('aria-label'), 'Въезд');
    assert.equal(await page.locator('[data-site-tool="wicket"]').count(), 0);
    await chooseEntry(page, 'swing', { size: '3000-1800' });
    assert.equal(await page.locator('#entryLibraryBar').isVisible(), true);
    assert.equal(await page.locator('dialog:modal').count(), 0);
    await page.fill('#toEntryWidth', '4000'); await page.locator('#toEntryWidth').press('Tab');
    await page.fill('#toEntryHeight', '1900'); await page.locator('#toEntryHeight').press('Tab');
    await clickWorld(page, 6000, 18000);
    await page.click('[data-site-tool="entry"]');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#siteEntryMenu[open]').count(), 0);
    assert.equal(await page.evaluate(() => window.__kepler.state.tool), null);
    assert.equal(await page.locator('#entryLibraryBar').isVisible(), false);
    await chooseEntry(page, 'sliding', { wicket: true, size: '5000-2000' });
    await clickWorld(page, 16000, 18000);
    assert.equal((await entries(page)).length, 2);
    assert.deepEqual([(await entries(page))[0].width, (await entries(page))[0].height], [4000, 1900]);
    assert.equal(await page.locator('#entryLibraryBar').isVisible(), true);
    assert.deepEqual((await entries(page)).map((e) => [e.opening, e.wicket]), [['swing', false], ['sliding', true]]);
    assert.deepEqual([(await entries(page))[1].width, (await entries(page))[1].height], [5000, 2000]);
    await chooseEntry(page, 'wicket');
    assert.equal(await page.locator('#siteEntryMenu[open]').count(), 0);
    await clickWorld(page, 6000, 0);
    const list = await entries(page);
    assert.equal(list.length, 3);
    assert.deepEqual(list.map((e) => e.kind), ['gate', 'gate', 'wicket']);
    assert.equal(list[2].width, 1000);
    assert.equal(await page.evaluate(() => window.__kepler.state.project.site.entry.id), list[0].id);
  });

  it('калитка включается и выключается у выбранных ворот; её ширина не меняет ворота', async () => {
    const { page } = app;
    await page.keyboard.press('Escape');
    await clickWorld(page, 16000, 18000);
    await page.check('#entryWicket');
    await page.selectOption('#entryWicketOpening', 'sliding');
    await flipEntry(page, 1);
    await flipEntry(page, 0); await flipEntry(page, 0);
    const directed = (await entries(page))[1];
    assert.equal(directed.wicketOpening, 'sliding'); assert.equal(directed.wicketSlideDirection, 'left'); assert.equal(directed.slideDirection, 'right');
    await page.selectOption('#entryWicketSide', 'left');
    await page.fill('#entryWicketWidth', '1200'); await page.locator('#entryWicketWidth').press('Tab');
    let list = await entries(page);
    assert.equal(list[0].wicket, false);
    assert.equal(list[1].wicket, true);
    assert.equal(list[1].wicketSide, 'left');
    assert.equal(list[1].wicketWidth, 1200);
    assert.equal(list[1].width, 5000);
    await page.selectOption('#entryOpening', 'swing');
    await flipEntry(page, 0);
    assert.equal((await entries(page))[1].swingSide, 'outside');
    assert.equal((await entries(page))[1].width, 5000);
    assert.equal((await entries(page))[1].wicketWidth, 1200);
    await page.selectOption('#entryOpening', 'sliding');
    await page.uncheck('#entryWicket');
    list = await entries(page);
    assert.equal(list[1].wicket, false);
    assert.equal(list[1].wicketWidth, 1200);
    await page.check('#entryWicket');
  });

  it('размеры установленных ворот правятся в миллиметрах, как у окон', async () => {
    const { page } = app;
    await page.fill('#entryWidth', '4500'); await page.locator('#entryWidth').press('Tab');
    await page.fill('#entryHeight', '2100'); await page.locator('#entryHeight').press('Tab');
    const list = await entries(page);
    assert.deepEqual([list[1].width, list[1].height, list[1].wicketWidth], [4500, 2100, 1200]);
    assert.equal(list[0].width, 4000);
    assert.equal(list[2].width, 1000);
    assert.equal(await page.locator('#entryWidth').inputValue(), '4500');
    assert.equal(await page.locator('#entryHeight').inputValue(), '2100');
    if (process.env.KEPLER_SHOTS) await page.screenshot({ path: `${process.env.KEPLER_SHOTS}/entry-dimension-properties.png` });
    await page.click('#undoBtn'); await page.click('#undoBtn');
    assert.deepEqual((await entries(page)).map((e) => e.width), [4000, 5000, 1000]);
    assert.equal((await entries(page))[1].height, 2000);
  });

  it('наружная ручка боковой калитки меняет только её ширину и отменяется одним шагом', async () => {
    const { page } = app;
    await clickWorld(page, 16000, 18000);
    const before = (await entries(page))[1];
    const at = await entryControl(page, { kind: 'resize', part: 1, end: 'start' });
    const target = await resizeTarget(page, 1, 'start', 200);
    const to = await worldToClient(page, target.x, target.y);
    await page.mouse.move(at.x, at.y); await page.mouse.down(); await page.mouse.move(to.x, to.y, { steps: 5 }); await page.mouse.up();
    const after = (await entries(page))[1];
    assert.equal(after.wicketWidth, 1400);
    assert.deepEqual([after.width, after.x, after.y], [before.width, before.x, before.y]);
    await page.click('#undoBtn');
    assert.equal((await entries(page))[1].wicketWidth, 1200);
  });

  it('перемещение и удаление затрагивают одни ворота; Undo восстанавливает их', async () => {
    const { page } = app;
    const before = await entries(page);
    const a = await worldToClient(page, 16000, 18000); const b = await worldToClient(page, 18000, 18000);
    await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y, { steps: 5 }); await page.mouse.up();
    let list = await entries(page);
    assert.ok(Math.abs(list[1].x - 18000) < 2);
    assert.deepEqual(list[0], before[0]); assert.deepEqual(list[2], before[2]);
    await page.click('#propsBody #del');
    assert.equal((await entries(page)).length, 2);
    await page.keyboard.press('Control+z');
    list = await entries(page);
    assert.equal(list.length, 3);
    assert.ok(list.find((e) => e.id === before[1].id));
    assert.deepEqual(app.errors, []);
  });

  it('ворота видны в 3D и выбираются с открытием своих свойств', async () => {
    const { page } = app;
    await page.click('#view3dBtn');
    const target = await page.evaluate(async () => {
      const { toLocal } = await import('./core/building.js');
      const e = window.__kepler.state.project.site.entries[0];
      const rad = e.dir * Math.PI / 180;
      const local = toLocal(window.__kepler.state.project.building, { x: e.x - Math.sin(rad) * 1000, y: e.y + Math.cos(rad) * 1000 });
      return { id: e.id, at: window.__kepler.screen3d({ ...local, z: 900 }) };
    });
    const hit = await page.evaluate((at) => window.__kepler.pick3d(at.x, at.y), target.at);
    assert.equal(hit?.type, 'site'); assert.equal(hit?.id, target.id);
    await page.mouse.click(target.at.x, target.at.y);
    assert.deepEqual(await page.evaluate(() => window.__kepler.state.selection), { type: 'site', kind: 'entry', id: target.id });
    assert.equal(await page.locator('#entryWidth').inputValue(), '4000');
    if (process.env.KEPLER_SHOTS) await page.screenshot({ path: `${process.env.KEPLER_SHOTS}/site-gates-3d.png` });
    assert.deepEqual(app.errors, []);
  });
});

describe('ворота на телефоне', () => {
  let app;
  before(async () => { app = await startApp({ mobile: true }); await setup(app.page, true); });
  after(async () => { await app?.close(); });
  it('касания создают несколько ворот; в свойствах включается калитка', async () => {
    const { page } = app;
    await chooseEntry(page, 'sliding', { mobile: true });
    for (const x of [6000, 16000]) {
      const p = await worldToClient(page, x, 18000);
      await page.touchscreen.tap(p.x, p.y);
    }
    assert.equal((await entries(page)).length, 2);
    await page.tap('#mobileBar [data-sheet="props"]');
    await page.check('#entryWicket');
    assert.equal((await entries(page))[1].wicket, true);
    await page.tap('#entryAdd');
    assert.equal(await page.locator('body').evaluate((b) => b.classList.contains('sheet-props')), false);
    await chooseEntry(page, 'wicket-sliding', { mobile: true });
    await page.selectOption('#toEntryDirection', 'left');
    const at = await worldToClient(page, 6000, 0);
    await page.touchscreen.tap(at.x, at.y);
    assert.equal((await entries(page))[2].kind, 'wicket');
    assert.equal((await entries(page))[2].opening, 'sliding');
    assert.equal((await entries(page))[2].slideDirection, 'left');
    await flipEntry(page, 0, 'direction', true);
    assert.equal((await entries(page))[2].slideDirection, 'right');
    const atHandle = await entryControl(page, { kind: 'resize', part: 0, end: 'end' });
    const target = await resizeTarget(page, 0, 'end', 500);
    const end = await worldToClient(page, target.x, target.y);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: atHandle.x, y: atHandle.y, id: 1 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: end.x, y: end.y, id: 1 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    assert.ok(Math.abs((await entries(page))[2].width - 1500) <= 50);
    assert.equal((await entries(page)).length, 3, 'ручка не создаёт новую калитку');
    assert.deepEqual(app.errors, []);
  });
});

describe('открывание отдельной калитки', () => {
  let app;
  before(async () => { app = await startApp(); await setup(app.page); });
  after(async () => { await app?.close(); });
  it('раздвижная калитка ставится из каталога, направление и петли меняются без сдвига объекта', async () => {
    const { page } = app;
    await chooseEntry(page, 'wicket-sliding');
    await page.selectOption('#toEntryDirection', 'left');
    await clickWorld(page, 6000, 18000);
    await page.keyboard.press('Escape');
    await clickWorld(page, 6000, 18000);
    const start = (await entries(page))[0];
    assert.equal(start.opening, 'sliding'); assert.equal(start.slideDirection, 'left');
    await page.selectOption('#entryOpening', 'swing');
    assert.equal(await page.locator('#entryDirection, #entryHinge').count(), 0);
    await flipEntry(page, 0);
    await flipEntry(page, 0, 'hinge');
    let w = (await entries(page))[0];
    assert.equal(w.swingSide, 'outside'); assert.equal(w.hinge, 'right');
    assert.deepEqual([w.x, w.y, w.dir, w.width, w.height], [start.x, start.y, start.dir, 1000, 1800]);
    if (process.env.KEPLER_SHOTS) await page.screenshot({ path: `${process.env.KEPLER_SHOTS}/wicket-outside-right.png` });
    await page.selectOption('#entryOpening', 'sliding');
    assert.equal((await entries(page))[0].slideDirection, 'left');
    await flipEntry(page, 0);
    w = (await entries(page))[0];
    assert.equal(w.slideDirection, 'right');
    await page.click('#undoBtn');
    assert.equal((await entries(page))[0].slideDirection, 'left');
    assert.deepEqual(app.errors, []);
  });
  it('ручка ширины сохраняет второй торец, Undo и Esc возвращают исходный размер', async () => {
    const { page } = app;
    const start = (await entries(page))[0];
    await clickWorld(page, start.x, start.y);
    const at = await entryControl(page, { kind: 'resize', part: 0, end: 'end' });
    const target = await resizeTarget(page, 0, 'end', 500);
    const to = await worldToClient(page, target.x, target.y);
    await page.mouse.move(at.x, at.y); await page.mouse.down(); await page.mouse.move(to.x, to.y, { steps: 5 }); await page.mouse.up();
    assert.equal((await entries(page))[0].width, 1500);
    assert.equal(await page.locator('#entryWidth').inputValue(), '1500');
    await page.click('#undoBtn');
    assert.deepEqual((await entries(page))[0], start);
    await clickWorld(page, start.x, start.y);
    const again = await entryControl(page, { kind: 'resize', part: 0, end: 'end' });
    await page.mouse.move(again.x, again.y); await page.mouse.down(); await page.mouse.move(to.x, to.y, { steps: 4 });
    assert.equal((await entries(page))[0].width, 1500);
    await page.keyboard.press('Escape'); await page.mouse.up();
    assert.deepEqual((await entries(page))[0], start);
    assert.deepEqual(app.errors, []);
  });
});
