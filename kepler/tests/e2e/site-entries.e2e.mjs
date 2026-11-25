import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { clickWorld, openNew, settleView, startApp, worldToClient } from './helpers.mjs';

const entries = (page) => page.evaluate(() => structuredClone(window.__kepler.state.project.site.entries));
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
    v.scale = phone ? .012 : .025; v.panX = phone ? 25 : 150; v.panY = 100;
    (await import('./ui/view.js')).requestDraw();
  }, mobile);
}

describe('ворота и калитки участка', () => {
  let app;
  before(async () => { app = await startApp(); await setup(app.page); });
  after(async () => { await app?.close(); });

  it('два клика создают двое ворот, а отдельная калитка — третий объект', async () => {
    const { page } = app;
    await page.click('[data-site-tool="entry"]');
    await clickWorld(page, 6000, 18000);
    await clickWorld(page, 16000, 18000);
    assert.equal((await entries(page)).length, 2);
    await page.click('[data-site-tool="wicket"]');
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
    await page.selectOption('#entryWicketSide', 'left');
    await page.fill('#entryWicketWidth', '1.2'); await page.locator('#entryWicketWidth').press('Tab');
    let list = await entries(page);
    assert.equal(list[0].wicket, false);
    assert.equal(list[1].wicket, true);
    assert.equal(list[1].wicketSide, 'left');
    assert.equal(list[1].wicketWidth, 1200);
    assert.equal(list[1].width, 4000);
    await page.uncheck('#entryWicket');
    list = await entries(page);
    assert.equal(list[1].wicket, false);
    assert.equal(list[1].wicketWidth, 1200);
    await page.check('#entryWicket');
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
    assert.equal(await page.locator('#entryWidth').inputValue(), '4');
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
    await page.tap('#mobileBar [data-sheet="draw"]');
    await page.tap('#mobileDraw [data-draw="entry"]');
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
    await page.tap('#mobileBar [data-sheet="draw"]');
    await page.tap('#mobileDraw [data-draw="wicket"]');
    const at = await worldToClient(page, 6000, 0);
    await page.touchscreen.tap(at.x, at.y);
    assert.equal((await entries(page))[2].kind, 'wicket');
    assert.deepEqual(app.errors, []);
  });
});
