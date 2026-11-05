// Мебель: повторные клики по выбранному предмету переключают ручки —
// выбор → поворот → растяжение с одной стороны → масштаб.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, openSample, worldToClient } from './helpers.mjs';

describe('мебель: режимы ручек по повторным кликам', () => {
  let app;
  before(async () => {
    app = await startApp({ width: 1400, height: 900 });
    await openSample(app.page);
  });
  after(async () => { await app?.close(); });

  const mode = () => app.page.evaluate(async () => {
    const m = await import('./core/item-handles.js');
    const k = window.__kepler.state;
    const id = k.selection?.type === 'item' ? k.selection.id : null;
    return id ? m.itemHandleMode(k.itemHandle, id) : null;
  });
  const item = () => app.page.evaluate(() => {
    const k = window.__kepler.state;
    const it = k.project.items.find((i) => i.w >= 600 && i.h >= 400) || k.project.items[0];
    return { id: it.id, x: it.x, y: it.y, w: it.w, h: it.h, rotation: it.rotation || 0 };
  });
  async function click(p) {
    const c = await worldToClient(app.page, p.x, p.y);
    await app.page.mouse.click(c.x, c.y);
    await app.page.waitForTimeout(80);
  }

  it('клики: выбор → поворот → растяжение → масштаб → выбор', async () => {
    const it0 = await item();
    // подставляем прямоугольный предмет без поворота в центр обзора для надёжных кликов
    await app.page.evaluate((id) => {
      const k = window.__kepler.state;
      const it = k.project.items.find((i) => i.id === id);
      it.rotation = 0;
    }, it0.id);
    const p = { x: it0.x, y: it0.y };
    const seen = [];
    for (let i = 0; i < 5; i += 1) { await click(p); seen.push(await mode()); }
    assert.deepEqual(seen, ['select', 'rotate', 'stretch', 'scale', 'select']);
  });

  it('растяжение: тянем правую сторону — левая остаётся на месте, высота прежняя', async () => {
    const it0 = await item();
    const p = { x: it0.x, y: it0.y };
    await click(p); // → rotate (уже выбран)
    await click(p); // → stretch
    assert.equal(await mode(), 'stretch');
    const a = await worldToClient(app.page, it0.x + it0.w / 2, it0.y);
    const b = await worldToClient(app.page, it0.x + it0.w / 2 + 600, it0.y);
    await app.page.mouse.move(a.x, a.y);
    await app.page.mouse.down();
    await app.page.mouse.move((a.x + b.x) / 2, a.y);
    await app.page.mouse.move(b.x, b.y);
    await app.page.mouse.up();
    const it1 = await item();
    assert.ok(it1.w > it0.w, 'ширина выросла');
    assert.equal(it1.h, it0.h, 'высота не изменилась');
    assert.ok(Math.abs((it1.x - it1.w / 2) - (it0.x - it0.w / 2)) <= 1, 'левая грань на месте');
    assert.deepEqual(app.errors, []);
  });
});
