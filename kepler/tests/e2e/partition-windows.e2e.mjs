import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, openNew, settleView, clickToolbarTool } from './helpers.mjs';

async function scene(page, kind) {
  return page.evaluate(async (kind) => {
    const { createRoom } = await import('./core/model.js');
    const { addManualWall } = await import('./core/wall-manual.js');
    const { mutate } = await import('./ui/store.js');
    const { cancelTool, selectObject } = await import('./ui/tools.js');
    const { state } = window.__kepler;
    cancelTool();
    mutate(() => {
      state.project.rooms = [];
      state.project.walls = [];
      state.project.openings = [];
      state.project.items = [];
      state.project.settings.autoArrangeFurniture = false;
      if (kind === 'shared') {
        state.project.rooms.push(createRoom('bedroom', 0, 0, 4000, 4000), createRoom('living', 4100, 0, 4000, 4000));
      } else {
        const parent = createRoom('living', 0, 0, 8000, 6000);
        state.project.rooms.push(parent);
        if (kind === 'nested') {
          const child = createRoom('bedroom', 2000, 1500, 3000, 3000);
          child.parentId = parent.id;
          state.project.rooms.push(child);
        } else addManualWall(state.project, { x: 4000, y: 500 }, { x: 4000, y: 5500 });
      }
    });
    const wall = state.walls.find((w) => w.orient === 'v' && (kind === 'nested'
      ? w.rooms[0] === state.project.rooms[1].id : w.kind === kind));
    if (!wall) throw new Error(`Missing ${kind} partition`);
    selectObject({ type: 'wall', key: wall.key, from: wall.from });
    window.__kepler.fitView();
    return { key: wall.key, from: wall.from, x: wall.band.x + wall.band.w / 2, y: (wall.from + wall.to) / 2 };
  }, kind);
}

async function clickWall(page, at) {
  await settleView(page);
  const p = await page.evaluate(({ x, y }) => {
    const canvas = document.getElementById('canvas');
    const b = canvas.getBoundingClientRect();
    const point = window.__kepler.planToScreen(x, y);
    return { x: b.x + point.x, y: b.y + point.y };
  }, at);
  await page.mouse.move(p.x, p.y);
  await page.waitForFunction(() => Boolean(window.__kepler.state.ghostOpeningFull));
  await page.mouse.click(p.x, p.y);
  await page.waitForFunction(() => window.__kepler.state.project.openings.length === 1);
  return page.evaluate(async () => {
    const { openingRect } = await import('./core/walls.js');
    const { state } = window.__kepler;
    const opening = state.project.openings[0];
    const placed = openingRect(state.project, opening, state.walls);
    return { kind: opening.kind, key: placed?.wall.key, orphan: Boolean(opening.orphan) };
  });
}

describe('окна в перегородках', () => {
  let app;
  before(async () => { app = await startApp({ width: 1400, height: 900 }); await openNew(app.page); });
  after(async () => { await app?.close(); });
  for (const kind of ['shared', 'nested', 'manual']) {
    it(`${kind}: кнопка окна доступна, предпросмотр и вставка работают, Undo удаляет проём`, async () => {
      const { page } = app;
      const wall = await scene(page, kind);
      const button = page.locator('[data-selection-action="add-window"]');
      assert.equal(await button.isEnabled(), true);
      await button.click();
      assert.deepEqual(await clickWall(page, wall), { kind: 'window', key: wall.key, orphan: false });
      await page.keyboard.press('Escape');
      await page.keyboard.press('Control+z');
      assert.equal(await page.evaluate(() => window.__kepler.state.project.openings.length), 0);
    });
  }
  it('общий инструмент «Окно» тоже ставит окно в перегородку', async () => {
    const { page } = app;
    const wall = await scene(page, 'shared');
    await clickToolbarTool(page, 'windowToolBtn');
    assert.deepEqual(await clickWall(page, wall), { kind: 'window', key: wall.key, orphan: false });
    assert.deepEqual(app.errors, []);
  });
});
