import assert from 'node:assert/strict';
import test from 'node:test';
import { openNew, startApp, worldToClient } from './helpers.mjs';

for (const mobile of [false, true]) {
  test(`Пристройка из свойств · ${mobile ? 'телефон' : 'компьютер'}`, async () => {
    const app = await startApp({ mobile, viewSections: 'default' });
    const { page } = app;
    const press = (selector) => mobile ? page.tap(selector) : page.click(selector);
    try {
      await openNew(page);
      await press('[data-first-tool="boundRoomBtn"]');
      await press('#roomCards [data-type="living"]');
      const at = await worldToClient(page, 0, 0);
      if (mobile) await page.touchscreen.tap(at.x, at.y);
      else await page.mouse.click(at.x, at.y);
      await page.waitForFunction(() => window.__kepler.state.selection?.type === 'room');
      if (mobile) await press('#mobileBar [data-sheet="props"]');
      else { await page.focus('#adjacentRoom summary'); await page.keyboard.press('Enter'); }
      if (mobile) await press('#adjacentRoom summary');
      await page.selectOption('#adjacentType', 'kitchen');
      await page.selectOption('#adjacentSide', '3');
      await press('#adjacentApply');
      const info = () => page.evaluate(async () => {
        const { state } = window.__kepler;
        const { doorLink } = await import('./core/walls.js');
        return {
          rooms: state.project.rooms.map((r) => ({ id: r.id, x: r.x, w: r.w, type: r.type })),
          gap: state.project.settings.partition,
          door: state.project.openings.map((o) => doorLink(state.project, o, state.walls)),
          selection: state.selection,
        };
      });
      const built = await info();
      assert.equal(built.rooms.length, 2);
      const [living, kitchen] = built.rooms;
      assert.equal(kitchen.type, 'kitchen');
      assert.equal(living.x - kitchen.x - kitchen.w, built.gap);
      assert.deepEqual(built.selection, { type: 'room', id: kitchen.id });
      assert.deepEqual(new Set(built.door[0]), new Set([living.id, kitchen.id]));
      await press('#undoBtn');
      assert.equal((await info()).rooms.length, 1);
      assert.equal((await info()).door.length, 0);
      await press('#redoBtn');
      assert.equal((await info()).rooms.length, 2);
      assert.equal((await info()).door.length, 1);
      await page.reload();
      await page.waitForFunction(() => window.__kepler?.state.project);
      assert.deepEqual((await info()).rooms, built.rooms);
      assert.deepEqual(app.errors, []);
    } finally {
      await app.close();
    }
  });
}
