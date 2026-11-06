// e2e «Комната съедает комнату» (core/room-eat.js): сдвинуть комнату на
// другую — нижняя уменьшилась, между ними тонкая общая стена, красной
// подсветки перекрытия нет; отмена/повтор одним шагом; перезагрузка.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, openNew, clickWorld, worldToClient } from './helpers.mjs';

const snap = (page) => page.evaluate(() => {
  const { state } = window.__kepler;
  const rooms = Object.fromEntries(state.project.rooms.map((r) => [r.id, {
    x: r.x, y: r.y, w: r.w, h: r.h, outline: r.outline ? r.outline.length : 0,
  }]));
  const shared = state.walls.filter((w) => w.kind === 'shared' && w.rooms.includes('A') && w.rooms.includes('B'))
    .map((w) => w.thickness);
  return {
    rooms,
    shared,
    overlaps: state.norms.problems.filter((x) => x.kind === 'overlap').length,
    redRects: (state.norms.overlaps || []).length,
    partition: state.project.settings.partition || 100,
  };
});

async function drag(page, a, b) {
  const from = await worldToClient(page, a[0], a[1]);
  const to = await worldToClient(page, b[0], b[1]);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 10 });
  await page.mouse.up();
}

describe('комната съедает комнату', () => {
  let app;
  let s0;
  before(async () => {
    app = await startApp();
    await openNew(app.page);
    await app.page.evaluate(async () => {
      const { mutate } = await import('./ui/store.js');
      const { createRoom } = await import('./core/model.js');
      const { state } = window.__kepler;
      state.view.scale = 0.06;
      state.view.panX = 80;
      state.view.panY = 150;
      mutate(() => {
        const a = createRoom('living', 0, 0, 4000, 4000); a.id = 'A';
        const b = createRoom('bedroom', 6000, 0, 3000, 3000); b.id = 'B';
        state.project.rooms.push(a, b);
      });
    });
    s0 = await snap(app.page);
  });
  after(async () => { await app?.close(); });

  it('сдвиг B на угол A: A — Г, между ними перегородка, замечания нет', async () => {
    const { page } = app;
    // B (6000…9000) → на 3000 влево и 3000 вниз: угол на A.
    await clickWorld(page, 7500, 1500);
    await drag(page, [7500, 1500], [4500, 4500]);
    const s = await snap(page);
    const b = s.rooms.B;
    assert.ok(b.x < 4000 && b.y < 4000, `B перекрыл угол A: ${JSON.stringify(b)}`);
    assert.ok(s.rooms.A.outline >= 6, 'A — контур (Г)');
    assert.ok(s.shared.length > 0, 'общая стена A|B');
    assert.ok(s.shared.every((t) => t === s.partition), `толщина ${s.shared}`);
    assert.equal(s.overlaps, 0, 'нет «Помещения перекрываются»');
    assert.equal(s.redRects, 0, 'нет красной зоны');
    const area = await page.evaluate(async () => {
      const { roomShapeArea } = await import('./core/room-shape.js');
      return roomShapeArea(window.__kepler.state.project.rooms.find((r) => r.id === 'A'));
    });
    const ix = 4000 - (b.x - s.partition); const iy = 4000 - (b.y - s.partition);
    assert.equal(area, 4000 * 4000 - ix * iy, 'A отдала пересечение и зазор');
  });

  it('отмена и повтор — одним шагом', async () => {
    const { page } = app;
    const after1 = await snap(page);
    await page.keyboard.press('Control+z');
    const back = await snap(page);
    assert.deepEqual(back.rooms, s0.rooms, 'обе комнаты как до жеста');
    await page.keyboard.press('Control+Shift+z');
    assert.deepEqual((await snap(page)).rooms, after1.rooms);
  });

  it('перезагрузка: форма и стена сохранились', async () => {
    const { page } = app;
    const before1 = await snap(page);
    await page.evaluate(async () => { (await import('./ui/store.js')).flushAutosave(); });
    await page.reload();
    await page.waitForFunction(() => Boolean(window.__kepler) && window.__kepler.state.project.rooms?.length === 2);
    const s = await snap(page);
    assert.deepEqual(s.rooms, before1.rooms);
    assert.deepEqual(s.shared, before1.shared);
    assert.equal(s.overlaps, 0);
  });

  it('без ошибок в консоли', () => {
    assert.deepEqual(app.errors, []);
  });
});
