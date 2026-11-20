// e2e автоматической оболочки: обязательный ±0.000, основание и крыша.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { startApp, openNew } from './helpers.mjs';

describe('автоматическая оболочка дома', () => {
  let app;

  before(async () => {
    app = await startApp();
    await openNew(app.page);
    await app.page.evaluate(async () => {
      const { createRoom } = await import('./core/model.js');
      const { mutate } = await import('./ui/store.js');
      mutate(() => {
        window.__kepler.state.project.rooms.push(createRoom('living', 0, 0, 6000, 4000));
      });
    });
  });

  after(async () => { await app?.close(); });

  it('после первого помещения просит ±0.000 и сразу собирает дом', async () => {
    const { page } = app;
    const card = page.locator('.envelope-card[data-status="pending"]');
    await card.waitFor();
    const datum = page.locator('#buildingZeroAboveGround');
    assert.equal(await datum.getAttribute('aria-invalid'), 'true');

    await datum.fill('1,00');
    await datum.press('Tab');
    await page.waitForFunction(() => window.__kepler.state.project.envelope.zeroAboveGround === 1000);
    await page.locator('.envelope-card[data-status="ready"]').waitFor();

    const geometry = await page.evaluate(async () => {
      const { buildHouseMesh } = await import('./core/mesh3d.js');
      const faces = buildHouseMesh(window.__kepler.state.project, { site: true, roof: true });
      const zRange = (kind) => {
        const zs = faces.filter((face) => face.kind === kind).flatMap((face) => face.pts.map((point) => point.z));
        return [Math.min(...zs), Math.max(...zs)];
      };
      return {
        foundation: zRange('foundation'),
        plinth: zRange('plinth'),
        ground: zRange('ground'),
        autoRoofs: new Set(faces.filter((face) => face.autoRoofId).map((face) => face.autoRoofId)).size,
      };
    });
    assert.deepEqual(geometry.foundation, [-1800, -1000]);
    assert.deepEqual(geometry.plinth, [-1000, 0]);
    assert.deepEqual(geometry.ground, [-1005, -1005]);
    assert.equal(geometry.autoRoofs, 1);

    await page.click('#view3dBtn');
    assert.equal(await page.isChecked('#v3Roof'), true);
    assert.equal((await page.evaluate(() => window.__kepler.debug3d())).roof, true);
    assert.deepEqual(app.errors, []);
  });
});
