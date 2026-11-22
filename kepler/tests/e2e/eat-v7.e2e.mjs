// e2e среза 1 этапа 2 (core/v7/eat-bridge.js, docs/v7-stage2-plan.md):
// съедание считается с нуля по номинальным формам — любой порядок жестов
// мышью, отмена/повтор и удаление дают то же, что построение с нуля.
// Дом повёрнут на 45°.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, openNew } from './helpers.mjs';

const shapes = (page) => page.evaluate(() => window.__kepler.state.project.rooms
  .map((r) => ({ id: r.id, x: r.x, y: r.y, w: r.w, h: r.h, outline: r.outline || null })));
const roomA = async (page) => (await shapes(page)).find((r) => r.id === 'A');

async function planToClient(page, x, y) {
  const box = await (await page.$('#canvas')).boundingBox();
  const s = await page.evaluate(([px, py]) => window.__kepler.planToScreen(px, py), [x, y]);
  return { x: box.x + s.x, y: box.y + s.y };
}

async function dragPlan(page, a, b) {
  const from = await planToClient(page, a[0], a[1]);
  const to = await planToClient(page, b[0], b[1]);
  await page.mouse.click(from.x, from.y);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 12 });
  await page.mouse.up();
}

describe('съедание путь-независимо, дом под 45°', () => {
  let app;
  let start;
  let eaten;
  before(async () => {
    app = await startApp();
    await openNew(app.page);
    await app.page.evaluate(async () => {
      const { mutate } = await import('./ui/store.js');
      const { createRoom } = await import('./core/model.js');
      const { state } = window.__kepler;
      mutate(() => {
        state.project.building.rotation = 45;
        const a = createRoom('living', 0, 0, 4000, 4000); a.id = 'A';
        const b = createRoom('bedroom', 6000, 0, 3000, 3000); b.id = 'B';
        state.project.rooms.push(a, b);
      });
      state.view.scale = 0.025; state.view.panX = 560; state.view.panY = 330; state.view.rotation = 0;
      window.__kepler.requestDraw?.();
    });
    start = await shapes(app.page);
  });
  after(async () => { await app?.close(); });

  it('дом на экране действительно под углом', async () => {
    const v = await app.page.evaluate(() => {
      const a = window.__kepler.planToScreen(0, 0); const b = window.__kepler.planToScreen(4000, 0);
      return { dx: b.x - a.x, dy: b.y - a.y };
    });
    assert.ok(Math.abs(v.dx) > 20 && Math.abs(v.dy) > 20, `ось X дома на экране: ${JSON.stringify(v)}`);
  });

  it('наезд, прочь, обратно, отмена/повтор, удаление — как с нуля', async () => {
    const { page } = app;
    await dragPlan(page, [7500, 1500], [4500, 4500]); // B на угол A
    eaten = await shapes(page);
    const a1 = eaten.find((r) => r.id === 'A');
    assert.ok(a1.outline, `A съедена (Г): ${JSON.stringify(a1)}`);
    await dragPlan(page, [4500, 4500], [4500, 9500]); // B прочь
    assert.deepEqual(await roomA(page), start.find((r) => r.id === 'A'), 'A снова целая');
    await dragPlan(page, [4500, 9500], [4500, 4500]); // B обратно
    assert.deepEqual(await shapes(page), eaten, 'то же, что после первого наезда');
    await page.keyboard.press('Control+z');
    await page.keyboard.press('Control+z');
    assert.deepEqual(await shapes(page), eaten, 'две отмены — снова первый наезд');
    await page.keyboard.press('Control+Shift+z');
    await page.keyboard.press('Control+Shift+z');
    assert.deepEqual(await shapes(page), eaten, 'два повтора');
    await page.evaluate(async () => {
      const { deleteSelection } = await import('./ui/plan-actions.js');
      const { selectObject } = await import('./ui/tools.js');
      selectObject({ type: 'room', id: 'B' });
      deleteSelection();
    });
    assert.deepEqual(await roomA(page), start.find((r) => r.id === 'A'), 'B удалена — A целая');
    await page.keyboard.press('Control+z');
    assert.deepEqual(await shapes(page), eaten, 'отмена удаления — снова съедена');
    const red = await page.evaluate(() => (window.__kepler.state.norms.overlaps || []).length);
    assert.equal(red, 0, 'нет красных зон');
  });

  it('сдвиг съеденной A прочь — A целая на новом месте, B не тронута', async () => {
    const { page } = app;
    await dragPlan(page, [500, 500], [500, -6000]);
    const s = await shapes(page);
    const a = s.find((r) => r.id === 'A');
    assert.equal(a.outline, null, JSON.stringify(a));
    assert.equal(a.w * a.h, 4000 * 4000);
    assert.ok(a.y < -4000, 'A уехала');
    assert.deepEqual(s.find((r) => r.id === 'B'), eaten.find((r) => r.id === 'B'));
  });

  it('без ошибок в консоли', () => {
    assert.deepEqual(app.errors, []);
  });
});
