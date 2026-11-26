import assert from 'node:assert/strict';
import { test } from 'node:test';
import { openNew, settleView, startApp } from './helpers.mjs';

const canopy = (page) => page.evaluate(() => window.__kepler.state.project.masses.find((m) => m.id === 'canopy'));
const right = (m) => m.x + m.w / 2;
const left = (m) => m.x - m.w / 2;

for (const variant of ['parallel', 'perspective', 'phone']) test(`навес: угол своей стены вместо реек, без отскока · ${variant}`, async () => {
  const mobile = variant === 'phone'; const app = await startApp({ mobile, width: 1440, height: 1000 });
  const { page } = app;
  try {
    await openNew(page);
    await page.evaluate(async () => {
      const { createRoom } = await import('./core/model.js');
      const { bindFacadeToWall, createFacadeElement } = await import('./core/facade.js');
      const { mutate } = await import('./ui/store.js');
      const p = window.__kepler.state.project; const level = p.levels[0];
      mutate(() => {
        const room = createRoom('living', 0, 0, 9000, 5000); p.rooms.push(room);
        const m = createFacadeElement('canopy', { level, point: { x: 4150, y: 5250, z: 2758 }, normal: { x: 0, y: 1 }, from: 0, to: 9000 });
        Object.assign(m, { id: 'canopy', x: 4150, w: 7700, z0: 2638, h: 240 });
        bindFacadeToWall(p, m, level.id, room.id, 2);
        const slats = createFacadeElement('slats', { level, point: { x: -500, y: 2400, z: 1500 }, normal: { x: -1, y: 0 }, from: 0, to: 5000 });
        slats.id = 'slats'; p.masses = [m, slats];
      });
    });
    await page.evaluate(() => document.getElementById('view3dBtn').click());
    await page.click('.v3-views summary'); await page.click('[data-v3-preset="iso"]');
    if (variant === 'perspective') await page.click('[data-v3-projection="perspective"]');
    await page.click('#v3Fit');
    await page.evaluate(() => window.__kepler.select({ type: 'mass', id: 'canopy' }));
    if (mobile && await page.locator('body').evaluate((b) => b.classList.contains('sheet-props'))) await page.tap('#mobileBar [data-sheet="props"]');
    await settleView(page);
    const tol = await page.evaluate(() => window.__kepler.debug3d().mass.snapTol.x.tol);
    await page.evaluate(async (tol) => {
      const { mutate } = await import('./ui/store.js');
      mutate(() => { const slats = window.__kepler.state.project.masses.find((m) => m.id === 'slats'); slats.x = -250 - tol * .7 - slats.d / 2; });
    }, tol);
    await settleView(page);
    const original = await canopy(page);
    const path = await page.evaluate(async ({ tol, mobile }) => {
      const k = window.__kepler; const debug = k.debug3d().mass;
      const start = debug.handles.nx;
      const { massPartAt } = await import('./ui/mass3d.js');
      const { axisDelta } = await import('./core/pick3d.js');
      const hit = massPartAt({ clientX: start.x, clientY: start.y, pointerType: mobile ? 'touch' : 'mouse' });
      const m = k.state.project.masses.find((m) => m.id === 'canopy');
      const p = { x: m.x - m.w / 2, y: m.y, z: m.z0 + m.h / 2 }; const at = k.screen3d(p);
      const c = document.getElementById('canvas3d');
      const ends = [-250 - tol * 1.1, -250 + tol * .2].map((x) => {
        const q = k.screen3d({ ...p, x }); const dx = q.x - at.x; const dy = q.y - at.y;
        const measured = axisDelta(k.debug3d().cam, c.clientWidth, c.clientHeight, { x: 1, y: 0, z: 0 }, dx, dy);
        const factor = (x - p.x) / measured;
        return { x: start.x + dx * factor, y: start.y + dy * factor };
      });
      return { start: { x: start.x, y: start.y }, ends, hit: hit?.part };
    }, { tol, mobile });
    assert.equal(path.hit, 'nx');
    const cdp = mobile ? await page.context().newCDPSession(page) : null;
    if (mobile) await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...path.start, id: 1 }] });
    else { await page.mouse.move(path.start.x, path.start.y); await page.mouse.down(); }
    for (let i = 0; i < path.ends.length; i += 1) {
      const p = path.ends[i];
      if (mobile) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...p, id: 1 }] });
      else await page.mouse.move(p.x, p.y);
      await settleView(page);
      const snap = await page.evaluate(() => window.__kepler.debug3d().mass.snap);
      if (!i) assert.equal(snap?.target, 'slats', 'вдали от угла обычный магнит доступен');
      else {
        assert.equal(snap?.kind, 'host-wall', 'угол своей стены перехватывает привязку у отделки');
        assert.equal(left(await canopy(page)), -250);
        assert.match(await page.textContent('#v3Hint'), /по углу стены/);
      }
    }
    if (mobile) await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); else await page.mouse.up();
    await settleView(page);
    const final = await canopy(page);
    assert.equal(left(final), -250, 'после отпускания нет отскока к x=0');
    assert.equal(right(final), 8000); assert.equal(final.y, original.y);
    assert.equal(final.d, original.d); assert.ok(final.facadeHost);
    await page.keyboard.press('Control+z'); assert.deepEqual(await canopy(page), original);
    await page.keyboard.press('Control+Shift+z'); assert.deepEqual(await canopy(page), final);
    if (process.env.KEPLER_SHOTS) await page.screenshot({ path: `${process.env.KEPLER_SHOTS}/canopy-snap-${variant}.png` });
    await page.reload(); await page.waitForFunction(() => window.__kepler?.state.project);
    assert.deepEqual(await canopy(page), final, 'привязка сохраняется в файле');
    assert.deepEqual(app.errors, []);
  } finally { await app.close(); }
});
