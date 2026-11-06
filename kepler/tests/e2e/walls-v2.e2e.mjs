// e2e движка стен v2 (?walls=v2): пример строится стенами-областями, клик по
// наружному углу выбирает стену, 3D открывается, ошибок в консоли нет.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, openSample, clickWorld } from './helpers.mjs';

describe('стены v2', () => {
  let app;
  before(async () => { app = await startApp({ query: 'walls=v2' }); await openSample(app.page); });
  after(async () => { await app?.close(); });

  it('стены примера — куски rects (движок v2)', async () => {
    const v2 = await app.page.evaluate(() => window.__kepler.state.walls.some((w) => Array.isArray(w.rects)));
    assert.equal(v2, true);
  });

  it('клик по углу стены выбирает её', async () => {
    // Угол — точка в rects стены, но вне её полосы band (кусок угла слит с
    // полосой в один прямоугольник, поэтому берём углы rects с отступом 40).
    const target = await app.page.evaluate(() => {
      for (const w of window.__kepler.state.walls) {
        if (w.hidden || !w.rects) continue;
        const b = w.band;
        for (const r of w.rects) {
          if (r.w < 100 || r.h < 100) continue;
          for (const [x, y] of [[r.x + 40, r.y + 40], [r.x + r.w - 40, r.y + 40], [r.x + 40, r.y + r.h - 40], [r.x + r.w - 40, r.y + r.h - 40]]) {
            const inBand = x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h;
            if (!inBand) return { key: w.key, from: w.from, x, y };
          }
        }
      }
      return null;
    });
    assert.ok(target, 'в примере есть угловой кусок стены');
    await clickWorld(app.page, target.x, target.y);
    const sel = await app.page.evaluate(() => window.__kepler.state.selection);
    assert.equal(sel?.type, 'wall');
    assert.equal(sel.key, target.key);
  });

  it('3D открывается', async () => {
    await app.page.keyboard.press('Escape');
    await app.page.click('#view3dBtn');
    assert.equal(await app.page.isVisible('#view3d'), true);
    const s = await app.page.evaluate(() => window.__kepler.debug3d());
    assert.equal(s.active, true);
    assert.ok(s.faces > 50, `граней ${s.faces}`);
    await app.page.keyboard.press('Escape');
  });

  it('без ошибок в консоли', () => {
    assert.deepEqual(app.errors, []);
  });
});
