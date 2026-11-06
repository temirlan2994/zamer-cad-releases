// e2e ручных стен (этап B): инструмент «Стена» рисует цепочку из 4 стен,
// дверь ставится на ручную стену, отмена/повтор, автосохранение и
// перезагрузка (формат kepler-plan/6), без ошибок в консоли.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, openNew, clickWorld, worldToClient } from './helpers.mjs';

const walls = (page) => page.evaluate(() => window.__kepler.state.project.walls.map((w) => ({ id: w.id, a: w.axis.a, b: w.axis.b })));

describe('ручные стены', () => {
  let app;
  before(async () => {
    app = await startApp();
    await openNew(app.page);
    // Масштаб с запасом: прямоугольник 4×3 м по центру экрана.
    await app.page.evaluate(() => {
      const { state } = window.__kepler;
      state.view.scale = 0.08;
      state.view.panX = 300;
      state.view.panY = 250;
    });
  });
  after(async () => { await app?.close(); });

  it('кнопка «Стена» и клики рисуют цепочку из 4 стен', async () => {
    const { page } = app;
    await page.click('#wallToolBtn');
    assert.equal(await page.evaluate(() => window.__kepler.state.tool?.kind), 'wall');
    for (const [x, y] of [[0, 0], [4000, 0], [4000, 3000], [0, 3000], [0, 0]]) await clickWorld(page, x, y);
    await page.keyboard.press('Enter');
    const list = await walls(page);
    assert.equal(list.length, 4);
    assert.deepEqual(list.map((w) => [w.a, w.b]), [
      [{ x: 0, y: 0 }, { x: 4000, y: 0 }],
      [{ x: 4000, y: 0 }, { x: 4000, y: 3000 }],
      [{ x: 4000, y: 3000 }, { x: 0, y: 3000 }],
      [{ x: 0, y: 3000 }, { x: 0, y: 0 }],
    ]);
    const s = await page.evaluate(() => {
      const { state } = window.__kepler;
      return { tool: state.tool, sel: state.selection, manual: state.walls.filter((w) => w.kind === 'manual').length };
    });
    assert.equal(s.tool, null, 'Enter закончил цепочку');
    assert.equal(s.manual, 4);
    assert.match(s.sel?.key || '', /^m\|/, 'последняя стена выбрана');
  });

  it('ось — только ортогонально: косой клик прижимается к горизонтали', async () => {
    const { page } = app;
    await page.keyboard.press('w');
    await clickWorld(page, 0, -1500);
    await clickWorld(page, 3000, -1100);
    await page.keyboard.press('Escape');
    const last = (await walls(page)).at(-1);
    assert.equal(last.a.y, last.b.y);
    assert.equal(await page.evaluate(() => window.__kepler.state.tool), null);
    // Отмена — косая стена уходит.
    await page.keyboard.press('Control+z');
    assert.equal((await walls(page)).length, 4);
  });

  it('дверь на ручной стене: host, отмена и повтор', async () => {
    const { page } = app;
    const top = (await walls(page))[0];
    await clickWorld(page, 2000, 0);
    assert.equal(await page.evaluate(() => window.__kepler.state.selection?.key), `m|${top.id}`);
    await page.click('[data-selection-action="add-door"]');
    await clickWorld(page, 2000, 300);
    const door = await page.evaluate(() => window.__kepler.state.project.openings[0]);
    assert.equal(door?.host?.wallId, top.id);
    assert.ok(Math.abs(door.host.t - 2000) <= 100, `t = ${door.host.t}`);
    const rect = await page.evaluate((id) => window.__kepler.openingRectOf(id), door.id);
    assert.equal(rect.kind, 'manual');
    await page.keyboard.press('Control+z');
    assert.equal(await page.evaluate(() => window.__kepler.state.project.openings.length), 0);
    await page.keyboard.press('Control+Shift+z');
    assert.equal(await page.evaluate(() => window.__kepler.state.project.openings.length), 1);
  });

  it('перетаскивание ручной стены сдвигает её и концы соседних', async () => {
    const { page } = app;
    await page.keyboard.press('Escape');
    const from = await worldToClient(page, 4000, 1500);
    const to = await worldToClient(page, 4500, 1500);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 5 });
    await page.mouse.up();
    const list = await walls(page);
    assert.equal(list[1].a.x, 4500);
    assert.equal(list[0].b.x, 4500, 'верхняя стена удлинилась торцом');
    assert.equal(list[2].a.x, 4500);
  });

  it('сохранение и перезагрузка: стены и дверь на месте, формат 6', async () => {
    const { page } = app;
    const saved = await page.evaluate(async () => {
      const store = await import('./ui/store.js');
      store.flushAutosave();
      return JSON.parse(localStorage.getItem('kepler-plan-autosave')).schema;
    });
    assert.equal(saved, 'kepler-plan/6');
    await page.reload();
    await page.waitForFunction(() => Boolean(window.__kepler) && window.__kepler.state.project.walls?.length === 4);
    const s = await page.evaluate(() => {
      const { state } = window.__kepler;
      return {
        walls: state.project.walls.length,
        host: state.project.openings[0]?.host?.wallId,
        manual: state.walls.filter((w) => w.kind === 'manual').length,
      };
    });
    assert.equal(s.walls, 4);
    assert.equal(s.manual, 4);
    assert.ok(s.host);
  });

  it('без ошибок в консоли', () => {
    assert.deepEqual(app.errors, []);
  });
});
