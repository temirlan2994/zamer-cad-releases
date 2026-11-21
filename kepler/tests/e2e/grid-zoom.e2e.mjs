// Шаг перемещения мельчает при приближении камеры.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, openSample, worldToClient, zoomToItems } from './helpers.mjs';

describe('шаг привязки и приближение', () => {
  let app;
  before(async () => { app = await startApp(); await openSample(app.page); });
  after(async () => { await app?.close(); });

  const firstItem = () => app.page.evaluate(() => {
    const i = window.__kepler.state.project.items.find((x) => !x.comp && x.w < 1500 && x.h < 1500);
    return { id: i.id, x: i.x, y: i.y, w: i.w, h: i.h };
  });
  const posOf = (id) => app.page.evaluate((i) => { const x = window.__kepler.state.project.items.find((v) => v.id === i); return { x: x.x, y: x.y }; }, id);
  const setScale = (scale) => app.page.evaluate((s) => { window.__kepler.state.view.scale = s; }, scale);

  it('обычный вид: мышь двигает мебель с шагом 50 мм, стрелка — на 50', async () => {
    const it = await firstItem();
    // Мебель берётся мышью только при 1:45 и ближе; при 0.12 (≈1:31) шаг ещё 50.
    await zoomToItems(app.page, 0.12, [it.id]);
    assert.equal(await app.page.evaluate(() => window.__kepler.gridStep()), 50);
    await app.page.evaluate((id) => window.__kepler.select({ type: 'item', id }), it.id);
    // item.x/y — центр предмета (не левый верхний угол).
    const c = await worldToClient(app.page, it.x, it.y);
    await app.page.mouse.move(c.x, c.y);
    await app.page.mouse.down();
    await app.page.mouse.move(c.x + 13, c.y, { steps: 6 });
    await app.page.mouse.up();
    const p = await posOf(it.id);
    assert.ok(p.x !== it.x && p.x % 50 === 0, `x=${p.x} (было ${it.x}): ожидали сдвиг, кратный 50`);
    await app.page.keyboard.press('Control+z');
  });

  it('при приближении шаг мельче: стрелка двигает на 10, потом на 1 мм', async () => {
    const it = await firstItem();
    await app.page.evaluate((id) => window.__kepler.select({ type: 'item', id }), it.id);
    await setScale(1.5);
    assert.equal(await app.page.evaluate(() => window.__kepler.gridStep()), 10);
    await app.page.keyboard.press('ArrowRight');
    assert.equal((await posOf(it.id)).x - it.x, 10, 'шаг стрелки при scale 1.5');
    await setScale(10);
    assert.equal(await app.page.evaluate(() => window.__kepler.gridStep()), 1);
    await app.page.keyboard.press('ArrowRight');
    assert.equal((await posOf(it.id)).x - it.x, 11, 'шаг стрелки при scale 10');
    await setScale(0.08);
    await app.page.keyboard.press('ArrowRight');
    assert.equal((await posOf(it.id)).x - it.x, 61, 'после отдаления шаг снова 50');
  });

  it('без ошибок в консоли', () => { assert.deepEqual(app.errors, []); });
});
