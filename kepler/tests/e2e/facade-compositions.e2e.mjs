import assert from 'node:assert/strict';
import { test } from 'node:test';
import { openNew, startApp } from './helpers.mjs';

for (const mobile of [false, true]) {
  test('Фасадная композиция · ' + (mobile ? 'касания и подгонка ко всей стене' : 'растягивание на стене и отмена'), async () => {
    const app = await startApp({ mobile });
    const { page } = app;
    const press = (selector) => mobile ? page.tap(selector) : page.click(selector);
    const model = () => page.evaluate(() => {
      const p = window.__kepler.state.project;
      return { openings: p.openings.length, kinds: (p.masses || []).map((m) => m.facadeKind) };
    });
    try {
      await openNew(page);
      await page.evaluate(async (withWindows) => {
        const { createRoom, createOpening } = await import('./core/model.js');
        const { mutate } = await import('./ui/store.js');
        const { project } = window.__kepler.state;
        mutate(() => {
          const room = createRoom('living', 0, 0, 7200, 6200);
          project.rooms = [room];
          if (withWindows) project.openings = [0, 1, 2, 3].map((side) => createOpening('window', room.id, side, 700, 1000));
        });
      }, mobile);
      await press('#view3dBtn');
      await press('.v3-facade summary');
      await press('[data-facade-composition="' + (mobile ? 'terrace' : 'panorama') + '"]');
      const pair = await page.evaluate((withWindows) => {
        const k = window.__kepler;
        const wall = k.state.project.settings.exterior;
        for (const segment of [
          [[700, -wall], [6300, -wall]], [[-wall, 700], [-wall, 5400]],
          [[7200 + wall, 700], [7200 + wall, 5400]], [[700, 6200 + wall], [6300, 6200 + wall]],
        ]) {
          const ps = segment.map(([x, y]) => k.screen3d({ x, y, z: 1500 }));
          if (ps.every((p, i) => {
            const hit = k.pick3d(p.x, p.y);
            return document.elementFromPoint(p.x, p.y)?.id === 'canvas3d'
              && (withWindows && i === 0 ? hit?.type === 'opening' : hit?.face === 'side');
          })) return ps;
        }
      }, mobile);
      assert.ok(pair, 'Видна стена для размещения');
      if (mobile) {
        await page.touchscreen.tap(pair[0].x, pair[0].y);
        await press('.v3-composition-fit');
        assert.deepEqual(await model(), { openings: 4, kinds: ['canopy', 'decking', 'post', 'post'] });
      } else {
        await page.mouse.move(pair[0].x, pair[0].y);
        await page.mouse.down();
        await page.mouse.move(pair[1].x, pair[1].y, { steps: 8 });
        await page.mouse.up();
        assert.deepEqual(await model(), { openings: 1, kinds: ['slats', 'slats'] });
        await page.keyboard.press('Control+z');
        assert.deepEqual(await model(), { openings: 0, kinds: [] });
        await page.keyboard.press('Control+y');
        assert.equal((await model()).openings, 1);
      }
      assert.deepEqual(app.errors, []);
    } finally { await app.close(); }
  });
}
