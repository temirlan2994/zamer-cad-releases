// e2e: масса на рельефе — часть под землёй видна бледно сквозь землю
// (грани massUnder) с линией пересечения; без слоя «Участок» её нет; при
// переносе гизмо подземный слой пересобирается.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, openNew } from './helpers.mjs';

const d3 = (page) => page.evaluate(() => window.__kepler.debug3d());
const sc = (page, p) => page.evaluate((q) => window.__kepler.screen3d(q), p);

async function pixel(page, x, y) {
  const buf = await page.screenshot({ clip: { x: Math.round(x), y: Math.round(y), width: 1, height: 1 } });
  return page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = 1; c.height = 1;
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0);
    return [...ctx.getImageData(0, 0, 1, 1).data];
  }, buf.toString('base64'));
}

const diff = (a, b) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);

describe('Масса на рельефе: подземная часть', () => {
  let app;
  before(async () => {
    app = await startApp({ width: 1440, height: 860 });
    await openNew(app.page);
    // Склон вдоль x: 1 м на 10 м (пол — отметка 100.00); масса 8 × 5 × 6 м
    // у x = 0…8000 — земля поднимается от 0 до 0,8 м над её низом.
    await app.page.evaluate(async () => {
      const M = await import('./core/masses.js');
      const T = await import('./core/terrain.js');
      const p = window.__kepler.state.project;
      p.masses = [M.createMass({ x: 4000, y: 2500, w: 8000, d: 5000, h: 6000 })];
      const pts = [];
      for (const x of [-15000, 0, 15000, 30000]) for (const y of [-15000, 15000]) pts.push({ x, y, z: 100000 + x * 0.1 });
      p.site.terrain = T.normalizeTerrain({ points: pts, floorZ: 100000 });
    });
    await app.page.click('#view3dBtn');
    await app.page.waitForTimeout(150);
  });
  after(async () => { await app?.close(); });

  it('часть под землёй — отдельные бледные грани и ватерлиния; пиксель виден сквозь землю', async () => {
    const { page } = app;
    const s = await d3(page);
    assert.ok(s.undergroundFaces > 0, `подземных граней ${s.undergroundFaces}`);
    assert.ok(s.waterline > 0);
    // Бок py (виден камере) у x = 7000: земля +700, точка z = 300 — под землёй.
    const p = await sc(page, { x: 7000, y: 5000, z: 300 });
    const on = await pixel(page, p.x, p.y);
    await page.uncheck('#v3Masses');
    await page.waitForTimeout(80);
    assert.equal((await d3(page)).undergroundFaces, 0);
    const ground = await pixel(page, p.x, p.y);
    assert.ok(diff(on, ground) > 12, `подземная часть отличается от земли: ${on} / ${ground}`);
    await page.check('#v3Masses');
    await page.waitForTimeout(80);
    assert.equal(diff(await pixel(page, p.x, p.y), on) < 4, true);
    if (process.env.KEPLER_MASS_SHOTS) {
      const t = await sc(page, { x: 4000, y: 2500, z: 6000 });
      await page.mouse.click(t.x, t.y);
      await page.waitForTimeout(80);
      await page.screenshot({ path: `${process.env.KEPLER_MASS_SHOTS}/mass-slope.png` });
      await page.keyboard.press('Escape');
    }
  });

  it('без слоя «Участок» подземного слоя нет', async () => {
    const { page } = app;
    await page.uncheck('#v3Site');
    await page.waitForTimeout(80);
    assert.equal((await d3(page)).undergroundFaces, 0);
    await page.check('#v3Site');
    await page.waitForTimeout(80);
    assert.ok((await d3(page)).undergroundFaces > 0);
  });

  it('перенос гизмо выше по склону: подземный слой пересобран, Z прилипает к земле', async () => {
    const { page } = app;
    const before = (await d3(page)).undergroundFaces;
    const t = await sc(page, { x: 4000, y: 2500, z: 6000 });
    await page.mouse.click(t.x, t.y);
    const g = (await d3(page)).mass.gizmo;
    assert.ok(g, 'гизмо');
    const a = { x: g.origin.x + (g.tips.x.x - g.origin.x) * 0.7, y: g.origin.y + (g.tips.x.y - g.origin.y) * 0.7 };
    const o = await sc(page, { x: 4000, y: 2500, z: 3000 });
    const b = await sc(page, { x: 12000, y: 2500, z: 3000 });
    await page.mouse.move(a.x, a.y, { steps: 2 });
    await page.mouse.down();
    await page.mouse.move(a.x + (b.x - o.x) / 2, a.y + (b.y - o.y) / 2, { steps: 4 });
    await page.mouse.move(a.x + b.x - o.x, a.y + b.y - o.y, { steps: 4 });
    const during = (await d3(page)).undergroundFaces;
    await page.mouse.up();
    const m = (await page.evaluate(() => window.__kepler.state.project.masses))[0];
    assert.equal(m.x, 12000);
    assert.ok(during > 0 && (await d3(page)).undergroundFaces > 0);
    assert.notEqual(during, before, 'слой пересобран во время жеста');
    // Z: низ вверх к земле под центром (x = 12000 → +1200).
    const g2 = (await d3(page)).mass.gizmo;
    const z0 = { x: g2.origin.x + (g2.tips.z.x - g2.origin.x) * 0.7, y: g2.origin.y + (g2.tips.z.y - g2.origin.y) * 0.7 };
    const c0 = await sc(page, { x: 12000, y: 2500, z: 3000 });
    const c1 = await sc(page, { x: 12000, y: 2500, z: 4220 });
    await page.mouse.move(z0.x, z0.y, { steps: 2 });
    await page.mouse.down();
    await page.mouse.move(z0.x + c1.x - c0.x, z0.y + c1.y - c0.y, { steps: 6 });
    await page.mouse.up();
    const m2 = (await page.evaluate(() => window.__kepler.state.project.masses))[0];
    assert.equal(m2.z0, 1200, 'низ — на земле под центром');
    assert.deepEqual(app.errors, []);
  });
});
