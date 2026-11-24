import assert from 'node:assert/strict';
import { test } from 'node:test';
import { openNew, startApp } from './helpers.mjs';

for (const mobile of [false, true]) {
  test(`Второй свет · ${mobile ? 'телефон' : 'компьютер'} · предпросмотр, проём с окном и одна отмена`, async () => {
    const app = await startApp({ mobile });
    const { page } = app;
    const press = (selector) => mobile ? page.tap(selector) : page.click(selector);
    const point = async (x, y) => {
      const p = await page.evaluate(([px, py]) => {
        const box = document.getElementById('canvas').getBoundingClientRect();
        const pos = window.__kepler.planToScreen(px, py);
        return { x: box.x + pos.x, y: box.y + pos.y };
      }, [x, y]);
      if (mobile) await page.touchscreen.tap(p.x, p.y); else await page.mouse.click(p.x, p.y);
    };
    const result = () => page.evaluate(() => {
      const { project } = window.__kepler.state;
      const hole = project.levels[1].slabOpenings?.[0];
      return { area: hole && hole.w * hole.h, railing: hole?.atrium?.railing, span: project.openings[0].span?.levelId };
    });
    try {
      await openNew(page);
      await page.evaluate(async () => {
        const { createLevel, createRoom, createOpening } = await import('./core/model.js');
        const { mutate } = await import('./ui/store.js');
        const { planToScreen, requestDraw } = await import('./ui/view.js');
        const { state } = window.__kepler;
        mutate(() => {
          const room = createRoom('living', 0, 0, 6000, 5000);
          const upper = createLevel('Галерея', 3000, 3000, 'upper-atrium-test');
          upper.rooms.push(createRoom('hall', 0, 0, 6000, 5000));
          state.project.levels.push(upper);
          state.project.rooms.push(room);
          state.project.openings.push(createOpening('window', room.id, 0, 2900, 1400));
        });
        const canvas = document.getElementById('canvas');
        state.view.scale = Math.min(.07, canvas.clientWidth / 8400);
        const center = planToScreen(3000, 2500);
        state.view.panX += canvas.clientWidth * .45 - center.x;
        state.view.panY += canvas.clientHeight * .4 - center.y;
        requestDraw();
      });
      const action = '[data-selection-action="atrium"]';
      await point(2800, 2200);
      await press(action);
      await page.locator('#atriumPanel').waitFor({ timeout: 5000 });
      assert.match(await page.locator('#atriumStatus').innerText(), /Галерея.*30 м²/);
      if (!mobile) {
        await page.locator('[data-atrium-area="rect"]').focus();
        await page.keyboard.press('Enter');
        await page.keyboard.press('Enter');
        await page.keyboard.press('Shift+ArrowRight');
        await page.keyboard.press('Shift+ArrowDown');
        await page.keyboard.press('Enter');
        assert.match(await page.locator('#atriumStatus').innerText(), /1 м²/);
        assert.equal(await page.locator('#atriumApply').evaluate((e) => e === document.activeElement), true);
      }
      await press('#atriumClose');
      assert.equal((await result()).area, undefined);
      await press(action);
      await press('[data-atrium-area="rect"]');
      await point(1500, 0);
      await point(4500, 2500);
      const preview = await page.evaluate(() => {
        const { tool } = window.__kepler.state;
        return { area: tool.preview?.area, rails: tool.preview?.rails.length, windows: tool.preview?.windows.length };
      });
      assert.ok(Math.abs(preview.area - 7500000) < 160000, JSON.stringify(preview));
      assert.equal(preview.rails, 3);
      assert.equal(preview.windows, 1);
      assert.equal(await page.locator('#atriumApply').isEnabled(), true);
      const bounds = await page.locator('#atriumPanel').boundingBox();
      assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= page.viewportSize().width);
      await page.locator('#atriumRails').uncheck();
      assert.equal(await page.locator('#atriumRails').isVisible(), true);
      await page.locator('#atriumRails').check();
      await page.locator('#atriumWindow').selectOption({ index: 1 });
      assert.ok(await page.evaluate(() => window.__kepler.state.tool.windowRect?.w > 0));
      assert.equal((await result()).span, undefined);
      await press('#atriumApply');
      assert.equal(await page.locator('#atriumPanel').isVisible(), false);
      assert.deepEqual(await result(), { area: preview.area, railing: true, span: 'upper-atrium-test' });
      await press('#undoBtn');
      assert.equal((await result()).area, undefined);
      assert.equal((await result()).span, undefined);
      await press('#redoBtn');
      assert.deepEqual(await result(), { area: preview.area, railing: true, span: 'upper-atrium-test' });
      if (!mobile) {
        await press('#undoBtn');
        await point(2800, 2200);
        await press('#view3dBtn');
        await press('#v3Atrium');
        await page.locator('#atriumPanel').waitFor();
        assert.equal(await page.locator('#view3d').isVisible(), false);
        await press('#atriumApply');
        assert.equal(await page.locator('#view3d').isVisible(), true);
        assert.equal((await result()).area, 30000000);
      }
      assert.deepEqual(app.errors, []);
    } catch (error) {
      if (app.errors.length) throw new Error(app.errors.join("\n"), { cause: error });
      throw error;
    } finally {
      await app.close();
    }
  });
}
