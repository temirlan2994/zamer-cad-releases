// e2e помещения по стенам (этап C): нарисовать 4 стены, кнопкой «Помещение»
// создать помещение кликом внутри петли, сдвинуть стену — контур и площадь
// пересчитались; отмена/повтор; перезагрузка (формат kepler-plan/6).
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, openNew, clickWorld, worldToClient } from './helpers.mjs';

const roomState = (page) => page.evaluate(() => {
  const { state } = window.__kepler;
  const r = state.project.rooms.find((x) => x.bound);
  return r ? { id: r.id, x: r.x, y: r.y, w: r.w, h: r.h, issue: r.boundIssue || null, seed: r.bound.seed, n: state.project.rooms.length } : null;
});

describe('помещение по стенам', () => {
  let app;
  before(async () => {
    app = await startApp();
    await openNew(app.page);
    await app.page.evaluate(() => {
      const { state } = window.__kepler;
      state.view.scale = 0.08;
      state.view.panX = 300;
      state.view.panY = 250;
    });
  });
  after(async () => { await app?.close(); });

  it('4 стены → «Помещение» → клик внутри петли создаёт помещение в свету', async () => {
    const { page } = app;
    await page.click('#wallToolBtn');
    for (const [x, y] of [[0, 0], [4000, 0], [4000, 3000], [0, 3000], [0, 0]]) await clickWorld(page, x, y);
    await page.keyboard.press('Enter');
    await page.click('#boundRoomBtn');
    assert.equal(await page.evaluate(() => window.__kepler.state.tool?.kind), 'bound-room');
    // Клик снаружи — помещение не создаётся.
    await clickWorld(page, 6000, 1500);
    assert.equal(await roomState(page), null);
    await clickWorld(page, 2000, 1500);
    const r = await roomState(page);
    assert.ok(r, 'помещение создано');
    const t = await page.evaluate(() => window.__kepler.state.project.walls[0].thickness);
    assert.deepEqual({ x: r.x, y: r.y, w: r.w, h: r.h }, { x: t / 2, y: t / 2, w: 4000 - t, h: 3000 - t });
    assert.equal(r.issue, null);
    const sel = await page.evaluate(() => window.__kepler.state.selection);
    assert.deepEqual(sel, { type: 'room', id: r.id });
    assert.equal(await page.evaluate(() => window.__kepler.state.tool), null);
  });

  it('сдвиг стены — контур и площадь пересчитываются; отмена и повтор', async () => {
    const { page } = app;
    await page.keyboard.press('Escape');
    const before = await roomState(page);
    const from = await worldToClient(page, 4000, 1500);
    const to = await worldToClient(page, 5000, 1500);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 6 });
    await page.mouse.up();
    const after1 = await roomState(page);
    assert.equal(after1.w, before.w + 1000);
    const area = await page.evaluate(async (id) => {
      const { roomNetAreaM2 } = await import('./core/rooms.js');
      const { state } = window.__kepler;
      return roomNetAreaM2(state.project, state.project.rooms.find((x) => x.id === id));
    }, after1.id);
    assert.ok(Math.abs(area - (after1.w * after1.h) / 1e6) < 1e-6, `площадь ${area}`);
    await page.keyboard.press('Control+z');
    assert.equal((await roomState(page)).w, before.w);
    await page.keyboard.press('Control+Shift+z');
    assert.equal((await roomState(page)).w, before.w + 1000);
  });

  it('удаление стены — помещение не замкнуто, замечание в нормах; отмена возвращает', async () => {
    const { page } = app;
    const wallId = await page.evaluate(() => window.__kepler.state.project.walls[2].id);
    await page.evaluate(async (id) => {
      const { mutate } = await import('./ui/store.js');
      const { removeManualWall } = await import('./core/wall-manual.js');
      const { state } = window.__kepler;
      mutate(() => removeManualWall(state.project, id));
    }, wallId);
    assert.equal((await roomState(page)).issue, 'open');
    const problem = await page.evaluate(() => window.__kepler.state.norms.problems.some((p) => p.kind === 'bound'));
    assert.ok(problem);
    await page.keyboard.press('Control+z');
    assert.equal((await roomState(page)).issue, null);
  });

  it('сохранение и перезагрузка: помещение и контур на месте, формат 6', async () => {
    const { page } = app;
    const before = await roomState(page);
    const schema = await page.evaluate(async () => {
      const store = await import('./ui/store.js');
      store.flushAutosave();
      return JSON.parse(localStorage.getItem('kepler-plan-autosave')).schema;
    });
    assert.equal(schema, 'kepler-plan/6');
    await page.reload();
    await page.waitForFunction(() => Boolean(window.__kepler) && window.__kepler.state.project.rooms?.some((r) => r.bound));
    const r = await roomState(page);
    assert.deepEqual({ x: r.x, y: r.y, w: r.w, h: r.h, issue: r.issue }, { x: before.x, y: before.y, w: before.w, h: before.h, issue: null });
  });

  it('без ошибок в консоли', () => {
    assert.deepEqual(app.errors, []);
  });
});
