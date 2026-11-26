import assert from 'node:assert/strict';
import { test } from 'node:test';
import { openNew, pickWorkspaceView, settleView, startApp } from './helpers.mjs';

for (const [mode, mobile] of [['landscape', false], ['landscape', true], ['plan', false], ['site', false], ['plan', true], ['site', true]]) test(`крыльцо видно и выбирается: ${mode}${mobile ? ' на телефоне' : ' с повёрнутым домом'}`, async () => {
  const app = await startApp({ mobile, width: 1440, height: 950 });
  const { page } = app;
  try {
    await openNew(page);
    await page.evaluate(async () => {
      const { createLevel, createRoom, createOpening } = await import('./core/model.js');
      const { mutate } = await import('./ui/store.js');
      const { state } = window.__kepler;
      mutate(() => {
        state.project.envelope.zeroAboveGround = 900;
        state.project.building = { rotation: 37, origin: { x: 1700, y: -800 } };
        const room = createRoom('entrance', 0, 0, 5000, 4000);
        const door = createOpening('door', room.id, 2, 2500, 1000);
        door.id = 'entry-door'; door.entryRole = 'main';
        door.entrance = { shapeEdits: { landing: { right: 1200 }, 'step-3': { right: 1800 } } };
        state.project.rooms.push(room); state.project.openings.push(door);
        const upper = createLevel('2 этаж', 3000); state.project.levels.push(upper);
        state.project.activeLevel = upper.id;
      });
    });
    if (mode === 'plan') {
      const id = await page.evaluate(() => window.__kepler.state.project.levels[0].id);
      await pickWorkspaceView(page, 'plans', `plan:${id}`);
    } else await pickWorkspaceView(page, 'model', mode);
    const point = await page.evaluate(async (mobile) => {
      const { entrancePlanParts } = await import('./ui/render-entrance.js');
      const view = await import('./ui/view.js');
      const k = window.__kepler; const st = k.state;
      const part = entrancePlanParts(st).find((p) => p.key === 'step-3');
      const poly = part.worldPolygon;
      // Выбираем изменённую часть ступени, за пределами исходной ширины.
      const center = { x: poly[1].x * .8 + poly[0].x * .2, y: poly[1].y * .8 + poly[0].y * .2 };
      center.x += (poly[2].x - poly[1].x) / 2; center.y += (poly[2].y - poly[1].y) / 2;
      const canvas = document.getElementById('canvas');
      st.view.scale = mobile ? .045 : .075;
      const before = view.worldToScreen(center.x, center.y);
      st.view.panX += canvas.clientWidth / 2 - before.x;
      st.view.panY += canvas.clientHeight * .42 - before.y;
      view.requestDraw();
      return center;
    }, mobile);
    await settleView(page);
    assert.equal(await page.evaluate(() => window.__kepler.state._planEntrances), 7);
    const client = await page.evaluate(async (point) => {
      const { worldToScreen } = await import('./ui/view.js');
      const p = worldToScreen(point.x, point.y); const r = document.getElementById('canvas').getBoundingClientRect();
      return { x: r.x + p.x, y: r.y + p.y };
    }, point);
    if (mobile) await page.touchscreen.tap(client.x, client.y);
    else { await page.mouse.move(client.x, client.y); await page.mouse.click(client.x, client.y); }
    const selection = await page.evaluate(() => window.__kepler.state.selection);
    assert.deepEqual(selection, { type: 'entrance', id: 'entry-door', part: 'step-3' });
    assert.equal(await page.evaluate(() => window.__kepler.state.modeName), mode, 'выбор сохраняет текущий вид');
    assert.equal(await page.inputValue('#stairPartWidth'), '3400');
    if (mobile && !(await page.locator('body').evaluate((b) => b.classList.contains('sheet-props')))) await page.tap('#mobileBar [data-sheet="props"]');
    await page.fill('#stairPartWidth', '4000'); await page.press('#stairPartWidth', 'Tab');
    assert.equal(await page.inputValue('#stairPartWidth'), '4000');
    const pixel = () => page.evaluate(async (p) => {
      const { worldToScreen } = await import('./ui/view.js');
      const at = worldToScreen(p.x, p.y); const c = document.getElementById('canvas');
      const dpr = c.width / c.clientWidth;
      return [...c.getContext('2d').getImageData(Math.round(at.x * dpr), Math.round(at.y * dpr), 1, 1).data];
    }, point);
    await settleView(page);
    const visible = await pixel();
    if (process.env.KEPLER_SHOTS) await page.screenshot({ path: `${process.env.KEPLER_SHOTS}/entrance-${mode}-${mobile ? 'phone' : 'desktop'}.png` });
    await page.uncheck('#porchEnabled'); await settleView(page);
    assert.equal(await page.evaluate(() => window.__kepler.state._planEntrances), 0);
    assert.notDeepEqual(await pixel(), visible, 'ступень действительно нарисована на холсте');
    await page.keyboard.press('Control+z'); await settleView(page);
    assert.equal(await page.evaluate(() => window.__kepler.state._planEntrances), 7);
    if (!mobile) {
      await page.mouse.click(client.x, client.y); await page.keyboard.press('Delete');
      await settleView(page);
      assert.equal(await page.evaluate(() => window.__kepler.state._planEntrances), 0);
      assert.equal(await page.evaluate(() => window.__kepler.state.project.openings.length), 1);
      await page.keyboard.press('Control+z'); await settleView(page);
      assert.equal(await page.evaluate(() => window.__kepler.state._planEntrances), 7);
    }
    assert.equal(await page.evaluate(() => window.__kepler.state.project.site.landscape.objects.length), 0, 'крыльцо не дублируется объектом ландшафта');
    if (mode === 'plan') {
      if (mobile && await page.locator('body').evaluate((b) => b.classList.contains('sheet-props'))) await page.tap('#mobileBar [data-sheet="props"]');
      const id = await page.evaluate(() => window.__kepler.state.project.levels[1].id);
      await pickWorkspaceView(page, 'plans', `plan:${id}`); await settleView(page);
      assert.equal(await page.evaluate(() => window.__kepler.state._planEntrances), 0, 'на втором этаже крыльцо не дублируется');
    }
    assert.deepEqual(app.errors, []);
  } finally { await app.close(); }
});
