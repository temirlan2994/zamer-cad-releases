// Телефон: объект двигается только после долгого нажатия; быстрый свайп — панорама.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, openSample, worldToClient } from './helpers.mjs';

describe('касание: долгое нажатие для перемещения', () => {
  let app; let cdp;
  before(async () => {
    app = await startApp({ mobile: true });
    await openSample(app.page);
    cdp = await app.page.context().newCDPSession(app.page);
  });
  after(async () => { await app?.close(); });

  const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
  const room = () => app.page.evaluate(() => { const r = window.__kepler.state.project.rooms[0]; return { x: r.x, y: r.y, cx: r.x + r.w / 2, cy: r.y + r.h / 2 }; });
  const panX = () => app.page.evaluate(() => window.__kepler.state.view.panX);

  async function swipe(holdMs) {
    const r = await room();
    const p = await worldToClient(app.page, r.cx, r.cy);
    await touch('touchStart', p.x, p.y);
    await app.page.waitForTimeout(holdMs);
    for (let i = 1; i <= 6; i++) { await touch('touchMove', p.x + i * 8, p.y); await app.page.waitForTimeout(16); }
    await touch('touchEnd');
    await app.page.waitForTimeout(100);
  }

  it('быстрый свайп по комнате — панорама, комната на месте', async () => {
    const before = await room(); const pan0 = await panX();
    await swipe(0);
    const after = await room();
    assert.deepEqual([after.x, after.y], [before.x, before.y]);
    assert.notEqual(await panX(), pan0, 'план сдвинулся');
  });

  it('долгое нажатие, затем свайп — комната двигается', async () => {
    const before = await room(); const pan0 = await panX();
    await swipe(650);
    const after = await room();
    assert.notDeepEqual([after.x, after.y], [before.x, before.y], 'комната сдвинулась');
    assert.equal(await panX(), pan0, 'панорамы нет');
    assert.deepEqual(app.errors, []);
  });

  const sel = () => app.page.evaluate(() => window.__kepler.state.selection?.id ?? null);
  async function tapRoom(holdMs = 0, move = false) {
    const r = await room();
    const p = await worldToClient(app.page, r.cx, r.cy);
    await touch('touchStart', p.x, p.y);
    await app.page.waitForTimeout(holdMs);
    if (move) { for (let i = 1; i <= 5; i++) { await touch('touchMove', p.x + i * 8, p.y); await app.page.waitForTimeout(16); } }
    await touch('touchEnd');
    await app.page.waitForTimeout(100);
  }

  it('выбор: свайп по комнате не выбирает, тап выбирает, пустое место тапом снимает', async () => {
    await app.page.evaluate(async () => (await import('./ui/tools.js')).selectObject(null));
    await tapRoom(0, true);
    assert.equal(await sel(), null, 'после свайпа ничего не выбрано');
    await tapRoom(0, false);
    const id = (await app.page.evaluate(() => window.__kepler.state.project.rooms[0].id));
    assert.equal(await sel(), id, 'тап выбрал комнату');
    // свайп по выбранному — выбор остаётся
    await tapRoom(0, true);
    assert.equal(await sel(), id, 'панорама не снимает выбор');
    assert.deepEqual(app.errors, []);
  });
});
