import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { openNew, startApp } from './helpers.mjs';

describe('Полая масса: инструмент и свойства', () => {
  let app;
  before(async () => {
    app = await startApp({ width: 1280, height: 820 });
    await openNew(app.page);
  });
  after(async () => { await app?.close(); });

  it('отдельная кнопка включает вычитающий режим', async () => {
    await app.page.click('#massVoidToolBtn');
    const tool = await app.page.evaluate(() => window.__kepler.state.tool);
    assert.equal(tool.kind, 'mass');
    assert.equal(tool.void, true);
    assert.equal(await app.page.getAttribute('#massVoidToolBtn', 'aria-pressed'), 'true');
  });

  it('два клика на плане создают massVoids, а не обычную массу', async () => {
    await app.page.evaluate(async () => {
      const { createRoom } = await import('./core/model.js');
      const store = await import('./ui/store.js');
      const st = window.__kepler.state;
      st.project.rooms = [createRoom('living', -5000, -5000, 10000, 10000)];
      store.refreshDerived();
      (await import('./ui/view.js')).requestDraw();
    });
    const points = await app.page.evaluate(async () => {
      const v = await import('./ui/view.js');
      const st = window.__kepler.state;
      st.view.scale = 0.08;
      st.view.panX = 600;
      st.view.panY = 400;
      v.requestDraw();
      const box = document.getElementById('canvas').getBoundingClientRect();
      return [{ ...v.planToScreen(-1000, -1000), ox: box.left, oy: box.top }, { ...v.planToScreen(1000, 1000), ox: box.left, oy: box.top }];
    });
    for (const p of points) await app.page.mouse.click(p.ox + p.x, p.oy + p.y);
    await app.page.waitForFunction(() => window.__kepler.state.project.massVoids?.length === 1);
    const result = await app.page.evaluate(() => ({
      voids: window.__kepler.state.project.massVoids,
      solids: window.__kepler.state.project.masses || [],
      selection: window.__kepler.state.selection,
    }));
    assert.equal(result.voids.length, 1);
    assert.equal(result.solids.length, 0);
    assert.match(result.voids[0].id, /^void-/);
    assert.equal(result.selection.id, result.voids[0].id);
    assert.match(await app.page.textContent('#propsPanel'), /Полая масса/);
    assert.match(await app.page.textContent('#propsPanel'), /Вычитающий объём/);
  });

  it('на плане пустота отличается оранжевым контуром и удаляется как масса', async () => {
    await app.page.waitForTimeout(100);
    assert.equal(await app.page.evaluate(() => window.__kepler.state._planMasses), 1);
    await app.page.keyboard.press('Delete');
    await app.page.waitForFunction(() => !window.__kepler.state.project.massVoids?.length);
    assert.equal(await app.page.evaluate(() => window.__kepler.state.selection), null);
  });

  it('без ошибок в консоли', () => assert.deepEqual(app.errors, []));
});
