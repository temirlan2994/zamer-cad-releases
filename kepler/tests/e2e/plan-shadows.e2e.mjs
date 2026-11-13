// e2e теней на плане (ui/plan-shadows.js, core/plan-shadows.js): пол у стены по
// направлению тени темнее, стена — нет; слой из кеша — сдвиг плана его не
// перестраивает, правка — перестраивает; «Тени от стен и мебели» в «Свойствах»
// вида выключает и запоминается.
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
const setOn = (page, on) => page.evaluate(async (v) => (await import('./ui/plan-shadows.js')).setPlanShadowPref({ on: v }), on);

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

  it('«Тени от стен и мебели» в «Свойствах» вида выключает тени и запоминается', async () => {
    const { page } = app;
    await page.evaluate(() => window.__kepler.select(null));
    await page.click('#propsTabMain');
    assert.equal(await page.isChecked('#viewsShadows'), true);
    const on = await lum(page, probe.floor.x, probe.floor.y);
    await page.uncheck('#viewsShadows');
    const off = await lum(page, probe.floor.x, probe.floor.y);
    assert.ok(off - on >= 10, `выключили — пол светлее: ${on.toFixed(1)} → ${off.toFixed(1)}`);
    assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('kepler-plan-shadows'))), { on: false });
    await page.check('#viewsShadows');
    assert.deepEqual(app.errors, []);
  });
});
