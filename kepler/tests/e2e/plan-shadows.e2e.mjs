// e2e теней на плане (ui/plan-shadows.js, core/plan-shadows.js) и настроек вида
// (core/view-display.js): пол у стены по направлению тени темнее, стена — нет;
// слой из кеша — сдвиг плана его не перестраивает, правка — перестраивает;
// пока тянут комнату — тени нет; «Отображение» и «Освещение» — у каждого вида свои.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, openSample } from './helpers.mjs';

// Средняя яркость 5×5 точек холста в точке плана (мм, оси дома) — после
// синхронной перерисовки.
const lum = (page, x, y) => page.evaluate(async ([px, py]) => {
  const { renderer } = await import('./ui/dom.js');
  renderer.draw(window.__kepler.state);
  const c = document.getElementById('canvas');
  const dpr = c.width / c.clientWidth;
  const q = window.__kepler.planToScreen(px, py);
  const d = c.getContext('2d').getImageData(Math.round(q.x * dpr) - 2, Math.round(q.y * dpr) - 2, 5, 5).data;
  let s = 0;
  for (let i = 0; i < d.length; i += 4) s += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
  return s / (d.length / 4);
}, [x, y]);
const builds = (page) => page.evaluate(() => window.__kepler.state._planShadow?.builds || 0);
const setOn = (page, on) => page.evaluate(async (v) => {
  const { setViewDisplay } = await import('./core/view-display.js');
  const st = window.__kepler.state;
  setViewDisplay(st.project, `plan:${st.project.activeLevel}`, { shadows: v });
}, on);

describe('тени на плане', () => {
  let app;
  let probe; // точка пола в тени и точка на стене
  before(async () => {
    app = await startApp({ planShadows: true });
    await openSample(app.page);
    probe = await app.page.evaluate(async () => {
      const st = window.__kepler.state;
      const { planShadowDir } = await import('./core/plan-shadows.js');
      const { landscapeShadow } = await import('./ui/render-landscape.js');
      const dir = planShadowDir(landscapeShadow(st.project.site), st.project.building);
      const r = st.project.rooms.find((x) => x.name === 'Гостиная');
      const wall = st.walls.find((w) => !w.hidden && w.thickness >= 200 && w.polys?.length);
      const poly = wall.polys[0];
      const cx = poly.reduce((s, p) => s + p.x, 0) / poly.length;
      const cy = poly.reduce((s, p) => s + p.y, 0) / poly.length;
      // Тень падает вверх (−y): пол Гостиной у её нижней стены.
      return { dir, floor: { x: r.x + r.w * 0.7, y: r.y + r.h - 200 }, wall: { x: cx, y: cy } };
    });
  });
  after(async () => { await app?.close(); });

  it('пол у стены по направлению тени темнее, сама стена не темнеет', async () => {
    const { page } = app;
    assert.ok(probe.dir.y < -0.5, `в примере тень падает вверх: ${JSON.stringify(probe.dir)}`);
    await setOn(page, false);
    const floorOff = await lum(page, probe.floor.x, probe.floor.y);
    const wallOff = await lum(page, probe.wall.x, probe.wall.y);
    await setOn(page, true);
    const floorOn = await lum(page, probe.floor.x, probe.floor.y);
    const wallOn = await lum(page, probe.wall.x, probe.wall.y);
    assert.ok(floorOff - floorOn >= 10, `пол в тени: ${floorOff.toFixed(1)} → ${floorOn.toFixed(1)}`);
    assert.ok(Math.abs(wallOn - wallOff) <= 2, `стена не темнеет: ${wallOff.toFixed(1)} → ${wallOn.toFixed(1)}`);
  });

  it('слой из кеша: сдвиг плана не перестраивает, правка размера комнаты — перестраивает', async () => {
    const { page } = app;
    await lum(page, probe.floor.x, probe.floor.y);
    const b0 = await builds(page);
    for (let i = 0; i < 5; i += 1) {
      await page.evaluate(() => { window.__kepler.state.view.panX += 13; });
      await lum(page, probe.floor.x, probe.floor.y);
    }
    assert.equal(await builds(page), b0, 'сдвиг — без перестройки');
    const id = await page.evaluate(() => window.__kepler.state.project.rooms.find((x) => x.name === 'Гостиная').id);
    await page.evaluate((rid) => window.__kepler.selectRoom(rid), id);
    const w0 = Number(await page.inputValue('#roomW'));
    await page.fill('#roomW', String(w0 + 600));
    await page.press('#roomW', 'Enter');
    await page.waitForFunction((b) => (window.__kepler.state._planShadow?.builds || 0) > b, b0);
    assert.deepEqual(app.errors, []);
  });

  it('пока тянут комнату — тени нет и слой не перестраивается; отпустили — новая', async () => {
    const { page } = app;
    await page.click('#propsTabMain');
    await lum(page, probe.floor.x, probe.floor.y);
    const c = await page.evaluate(() => {
      const r = window.__kepler.state.project.rooms.find((x) => x.name === 'Кухня');
      const q = window.__kepler.planToScreen(r.x + r.w / 2, r.y + r.h / 2);
      const cb = document.getElementById('canvas').getBoundingClientRect();
      return { x: cb.x + q.x, y: cb.y + q.y };
    });
    const b0 = await builds(page);
    await page.mouse.move(c.x, c.y);
    await page.mouse.down();
    for (let i = 1; i <= 6; i += 1) { await page.mouse.move(c.x + i * 10, c.y + i * 6); await page.waitForTimeout(30); }
    assert.equal(await page.evaluate(() => window.__kepler.state._planShadow.hidden), true, 'тянут — тень спрятана');
    assert.equal(await builds(page), b0, 'и не перестраивается');
    await page.mouse.up();
    await page.waitForFunction((b) => window.__kepler.state._planShadow.builds > b && !window.__kepler.state._planShadow.hidden, b0);
    await page.evaluate(() => document.getElementById('undoBtn').click());
  });

  it('«Освещение» в «Свойствах» вида: тени выключаются для этого вида, в проекте', async () => {
    const { page } = app;
    await page.evaluate(() => window.__kepler.select(null));
    await page.click('#propsTabMain');
    assert.equal(await page.isChecked('#viewsShadows'), true);
    const on = await lum(page, probe.floor.x, probe.floor.y);
    await page.uncheck('#viewsShadows');
    const off = await lum(page, probe.floor.x, probe.floor.y);
    assert.ok(off - on >= 10, `выключили — пол светлее: ${on.toFixed(1)} → ${off.toFixed(1)}`);
    assert.deepEqual(await page.evaluate(() => window.__kepler.state.project.viewDisplay), { 'plan:L1': { shadows: false } });
    assert.equal(await page.isVisible('input[name="viewsLength"]'), false, 'без теней — свет и длина скрыты');
    await page.check('#viewsShadows');
    await page.click('input[name="viewsLight"][value="fixed"] + span');
    await page.click('input[name="viewsLength"][value="long"] + span');
    assert.deepEqual(await page.evaluate(() => window.__kepler.state.project.viewDisplay), { 'plan:L1': { light: 'fixed', length: 'long' } });
    assert.deepEqual(app.errors, []);
  });

  it('«Отображение»: помещения серые — только в этом виде; тень дома по солнцу — своя у вида', async () => {
    const { page } = app;
    const sat = async () => page.evaluate(async ([px, py]) => {
      const { renderer } = await import('./ui/dom.js');
      renderer.draw(window.__kepler.state);
      const c = document.getElementById('canvas');
      const dpr = c.width / c.clientWidth;
      const q = window.__kepler.planToScreen(px, py);
      const [r, g, b] = c.getContext('2d').getImageData(Math.round(q.x * dpr), Math.round(q.y * dpr), 1, 1).data;
      return Math.max(r, g, b) - Math.min(r, g, b);
    }, [probe.floor.x, probe.floor.y - 1500]);
    const colored = await sat();
    await page.click('input[name="viewsRooms"][value="gray"] + span');
    assert.ok(await sat() <= 4 && colored > 4, `серые: насыщенность ${colored} → ${await sat()}`);
    assert.equal(await page.evaluate(() => window.__kepler.state.project.viewDisplay['plan:L1'].rooms), 'gray');
    await page.uncheck('#viewsSunShadow');
    assert.equal(await page.evaluate(() => window.__kepler.state.project.viewDisplay['plan:L1'].sunShadow), false);
    // «Участок» — свой вид: помещения цветные, тень дома по солнцу есть.
    await page.evaluate(() => window.__kepler.setEditorMode('site'));
    await page.click('#propsTabMain');
    await page.evaluate(() => { const d = document.getElementById('viewSection'); if (d) d.open = true; });
    assert.equal(await page.isChecked('input[name="viewsRooms"][value="color"]'), true);
    assert.equal(await page.isChecked('#viewsSunShadow'), true);
    await page.evaluate(() => window.__kepler.setEditorMode('plan'));
    assert.deepEqual(app.errors, []);
  });
});

describe('свойства вида — разделы по умолчанию', () => {
  let app;
  before(async () => { app = await startApp({ viewSections: 'default' }); await openSample(app.page); });
  after(async () => { await app?.close(); });

  it('открыты «Отображение», «Освещение», «Лист»; поворот, сетка и прочее свёрнуты и помнятся', async () => {
    const { page } = app;
    await page.click('#propsTabMain');
    const open = await page.$$eval('#propsBody details.vs-sec', (ns) => Object.fromEntries(ns.map((n) => [n.dataset.sec, n.open])));
    assert.equal(open.display, true);
    assert.equal(open.light, true);
    assert.equal(open.rotation, false);
    assert.equal(open.grid, false);
    assert.equal(await page.isVisible('#viewsAngleInput'), false);
    assert.equal(await page.$('#views3dBtn'), null, '3D — кнопкой навигации, в свойствах не нужен');
    await page.click('details.vs-sec[data-sec="rotation"] > summary');
    assert.equal(await page.isVisible('#viewsAngleInput'), true);
    await page.evaluate(async () => (await import('./ui/props.js')).renderProps());
    assert.equal(await page.isVisible('#viewsAngleInput'), true, 'раскрытый раздел остаётся раскрытым после перерисовки');
    assert.deepEqual(app.errors, []);
  });
});
