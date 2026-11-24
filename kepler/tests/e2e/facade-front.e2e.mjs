import assert from 'node:assert/strict';
import { test } from 'node:test';
import { openNew, startApp } from './helpers.mjs';

async function wallPoint(page) {
  return page.evaluate(() => {
    const canvas = document.querySelector('#canvas3d');
    const rect = canvas.getBoundingClientRect();
    const { pick3d } = window.__kepler;
    for (let y = rect.top + rect.height / 2; y < rect.bottom - 25; y += 12) {
      for (let x = rect.left + 24; x < rect.right - 24; x += 12) {
        if (document.elementFromPoint(x, y) === canvas && pick3d(x, y)?.face === 'side') return { x, y };
      }
    }
    return null;
  });
}

for (const mobile of [false, true]) {
  test(`Редактирование фасада · ${mobile ? 'телефон' : 'компьютер'} · стена, отделка, возврат камеры`, async () => {
    const app = await startApp({ mobile });
    const { page } = app;
    const press = (selector) => mobile ? page.tap(selector) : page.click(selector);
    const point = ({ x, y }) => mobile ? page.touchscreen.tap(x, y) : page.mouse.click(x, y);
    const camera = () => page.evaluate(() => window.__kepler.debug3d().cam);
    try {
      await openNew(page);
      await page.evaluate(async () => {
        const { createRoom } = await import('./core/model.js');
        const { mutate } = await import('./ui/store.js');
        mutate(() => { window.__kepler.state.project.rooms = [createRoom('living', 0, 0, 7200, 5000)]; });
      });
      await press('#view3dBtn');
      if (mobile) await press('.v3-views summary');
      await press('[data-v3-projection="perspective"]');
      if (mobile) await press('.v3-views summary');
      const before = await camera();
      const wall = await wallPoint(page);
      assert.ok(wall, 'виден фасад');
      if (!mobile) await point(wall);
      await press('.v3-facade summary');
      await press('[data-facade-front]');
      if (mobile) await point(wall);
      await page.locator('#v3ExitFacade').waitFor({ state: 'visible' });
      const front = await camera();
      assert.equal(front.pitch, 0);
      assert.equal(front.projection, 'orthographic');
      if (!mobile) {
        const rect = await page.locator('#canvas3d').boundingBox();
        const x = rect.x + rect.width / 2, y = rect.y + rect.height / 2;
        await page.mouse.move(x, y);
        await page.mouse.down();
        await page.mouse.move(x + 55, y - 21, { steps: 5 });
        await page.mouse.up();
        const panned = await camera();
        assert.equal(panned.yaw, front.yaw);
        assert.equal(panned.pitch, 0);
        assert.notDeepEqual(panned.target, front.target);
        await press('#v3Fit');
        assert.deepEqual((await camera()).target, front.target);
      }
      await press('.v3-facade summary');
      await press('[data-facade-kind="stone"]');
      await point(await wallPoint(page));
      assert.ok(await page.evaluate(() => window.__kepler.state.project.masses.some((m) => m.facadeKind === 'stone' && m.facadeHost)));
      await press('#v3ExitFacade');
      assert.deepEqual(await camera(), before);
      assert.deepEqual(app.errors, []);
    } finally { await app.close(); }
  });
}

test('Фронтальный вид · ручка окна тянется на второй этаж, возврат из другого вида сохраняет исходную камеру', async () => {
  const app = await startApp();
  const { page } = app;
  try {
    await openNew(page);
    await page.evaluate(async () => {
      const { createRoom, createOpening, createLevel } = await import('./core/model.js');
      const { mutate } = await import('./ui/store.js');
      const { project } = window.__kepler.state;
      mutate(() => {
        const room = createRoom('living', 0, 0, 7200, 5000);
        project.rooms = [room];
        const opening = createOpening('window', room.id, 2, 3600, 2000);
        opening.sill = 500;
        opening.height = 1400;
        project.openings = [opening];
        const upper = createLevel('2 этаж', 3000, 3000, 'L2');
        upper.rooms = [createRoom('living', 0, 0, 7200, 5000)];
        project.levels.push(upper);
      });
    });
    await page.click('#view3dBtn');
    const at = (z) => page.evaluate((height) => window.__kepler.screen3d({ x: 3600, y: 5150, z: height }), z);
    const before = await page.evaluate(() => window.__kepler.debug3d().cam);
    const glass = await at(1200);
    await page.mouse.click(glass.x, glass.y);
    assert.equal(await page.evaluate(() => window.__kepler.state.selection?.type), 'opening');
    await page.click('.v3-facade summary');
    await page.click('[data-facade-front]');
    const top = await at(1900), ceiling = await at(5550);
    await page.mouse.move(top.x, top.y);
    await page.mouse.down();
    assert.equal(await page.evaluate(() => window.__kepler.debug3d().openingTool.resizing), 'top');
    await page.mouse.move(ceiling.x, ceiling.y, { steps: 6 });
    await page.mouse.up();
    assert.equal(await page.evaluate(() => window.__kepler.state.project.openings[0].span?.levelId), 'L2');
    await page.click('#v3Close');
    await page.click('#view3dBtn');
    assert.equal(await page.locator('#v3ExitFacade').isVisible(), false);
    assert.deepEqual(await page.evaluate(() => window.__kepler.debug3d().cam), before);
    assert.deepEqual(app.errors, []);
  } finally { await app.close(); }
});
