import assert from 'node:assert/strict';
import { test } from 'node:test';
import { clickToolbarTool, mobileSelectFamilyTool, openNew, startApp } from './helpers.mjs';

for (const mobile of [false, true]) {
  test(`Угловой витраж · ${mobile ? 'телефон' : 'компьютер'} · выбор второго крыла, общий стык и отмена`, async () => {
    const app = await startApp({ mobile });
    const { page } = app;
    const press = (selector) => mobile ? page.tap(selector) : page.click(selector);
    const at = async (x, y) => {
      const p = await page.evaluate(async ([px, py]) => {
        const { planToScreen, requestDraw } = await import('./ui/view.js');
        const { state } = window.__kepler;
        const box = document.getElementById('canvas').getBoundingClientRect();
        state.view.scale = .08;
        const current = planToScreen(px, py);
        state.view.panX += box.width * .55 - current.x;
        state.view.panY += box.height * .45 - current.y;
        requestDraw();
        return { x: box.left + box.width * .55, y: box.top + box.height * .45 };
      }, [x, y]);
      if (mobile) await page.touchscreen.tap(p.x, p.y);
      else await page.mouse.click(p.x, p.y);
    };
    try {
      await openNew(page);
      await page.evaluate(async () => {
        const { createRoom } = await import('./core/model.js');
        const { mutate } = await import('./ui/store.js');
        mutate(() => window.__kepler.state.project.rooms.push(createRoom('living', 0, 0, 6500, 5200)));
      });
      if (mobile) {
        await press('#mobileBar [data-sheet="draw"]');
        await mobileSelectFamilyTool(page, 'openings', 'windowToolBtn');
      } else await clickToolbarTool(page, 'windowToolBtn');
      await press('#openingCats [data-cat="panoramic"]');
      await press('#openingItems [data-preset="corner-glazing"]');
      await at(600, -125);
      await page.waitForFunction(() => window.__kepler.state.project.openings.length === 1, null, { timeout: 3000 });
      const id = await page.evaluate(() => window.__kepler.state.project.openings[0].id);
      await page.keyboard.press('Escape');
      await at(-125, 1000);
      assert.equal(await page.evaluate(() => window.__kepler.state.selection?.id), id);
      if (mobile) await press('#mobileBar [data-sheet="props"]');
      const props = page.locator('#propsBody');
      await props.locator('#cornerReturn').fill('2200');
      await props.locator('#cornerReturn').press('Enter');
      await props.locator('#cornerJoint').selectOption('pier');
      const value = () => page.evaluate(() => window.__kepler.state.project.openings[0].corner);
      assert.deepEqual(await value(), { end: 'from', returnWidth: 2200, joint: 'pier' });
      await press('#undoBtn');
      assert.deepEqual(await value(), { end: 'from', returnWidth: 2200, joint: 'post' });
      assert.deepEqual(app.errors, []);
    } finally {
      await app.close();
    }
  });
}

test('угловой витраж ставится на фасаде, оба стекла и их ручки принадлежат одному объекту', async () => {
  const app = await startApp();
  const { page } = app;
  try {
    await openNew(page);
    await page.evaluate(async () => {
      const { createRoom } = await import('./core/model.js');
      const { mutate } = await import('./ui/store.js');
      mutate(() => window.__kepler.state.project.rooms.push(createRoom('living', 0, 0, 8000, 6000)));
    });
    await page.click('#view3dBtn');
    await clickToolbarTool(page, 'windowToolBtn');
    await page.click('#openingCats [data-cat="panoramic"]', { timeout: 3500 });
    await page.click('#openingItems [data-preset="corner-glazing"]');
    const pixel = await page.evaluate(() => {
      const k = window.__kepler;
      const area = document.getElementById('canvas3d').getBoundingClientRect();
      for (let y = area.top + 85; y < area.bottom - 40; y += 6) {
        for (let x = area.left + 25; x < area.right - 25; x += 6) {
          if (document.elementFromPoint(x, y)?.id !== 'canvas3d') continue;
          const hit = k.pick3d(x, y);
          if (hit?.type === 'wall' && hit.face === 'side' && hit.key.startsWith('e|')) return { x, y };
        }
      }
      return null;
    });
    assert.ok(pixel, 'видимый фасад');
    await page.mouse.click(pixel.x, pixel.y);
    await page.waitForFunction(() => window.__kepler.state.project.openings[0]?.corner, null, { timeout: 4000 });
    await page.keyboard.press('Escape');
    const info = await page.evaluate(async () => {
      const { state } = window.__kepler;
      const { selectObject } = await import('./ui/tools.js');
      const { openingHandleAt } = await import('./ui/opening3d.js');
      const { cornerWindowHandles } = await import('./core/corner-windows.js');
      const { openingHeight, openingSill } = await import('./core/opening-preset.js');
      const op = state.project.openings[0];
      selectObject({ type: 'opening', id: op.id });
      const level = state.project.levels[0];
      const z = level.elevation + openingSill(op, level) + openingHeight(op, level) / 2;
      return cornerWindowHandles(state.project, op, state.walls).map((h) => {
        const p = window.__kepler.screen3d({ x: h.x, y: h.y, z });
        const handle = openingHandleAt({ clientX: p.x, clientY: p.y });
        return { id: handle?.id, x: p.x, y: p.y, orient: h.wall.orient };
      });
    });
    assert.deepEqual(info.map((h) => h.id), ['main', 'return']);
    await page.keyboard.press('Control+z');
    assert.equal(await page.evaluate(() => window.__kepler.state.project.openings.length), 0);
    assert.deepEqual(app.errors, []);
  } finally {
    await app.close();
  }
});
