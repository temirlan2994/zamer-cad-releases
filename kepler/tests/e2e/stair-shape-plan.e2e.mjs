import assert from 'node:assert/strict';
import { test } from 'node:test';
import { openNew, pickWorkspaceView, settleView, startApp } from './helpers.mjs';

async function setup(page, outdoor, mobile) {
  await openNew(page);
  await page.evaluate(async (outdoor) => {
    const { createRoom, createOpening } = await import('./core/model.js');
    const { createLandscapeObject } = await import('./core/landscape.js');
    const { mutate } = await import('./ui/store.js');
    const p = window.__kepler.state.project;
    mutate(() => {
      p.envelope.zeroAboveGround = 900;
      p.building = { rotation: 37, origin: { x: 700, y: -500 } };
      if (outdoor) p.site.landscape.objects.push(createLandscapeObject('stairs-out', 4000, 5000,
        { id: 'outside-stair', w: 2400, h: 3000, height: 900, rotation: 23 }));
      else {
        const room = createRoom('entrance', 0, 0, 5000, 4000);
        const door = createOpening('door', room.id, 2, 2500, 1000);
        door.id = 'entry-door'; door.entryRole = 'main'; p.rooms.push(room); p.openings.push(door);
      }
    });
  }, outdoor);
  await pickWorkspaceView(page, 'model', 'landscape');
  const at = await page.evaluate(async ({ outdoor, mobile }) => {
    const { entrancePlanParts } = await import('./ui/render-entrance.js');
    const { stairTreads, toWorld } = await import('./core/landscape.js');
    const view = await import('./ui/view.js');
    const st = window.__kepler.state;
    let center;
    if (outdoor) {
      const o = st.project.site.landscape.objects[0]; const tread = stairTreads(o).find((t) => t.key === 'step-3');
      center = toWorld(o, 0, (tread.top + tread.bottom) / 2);
    } else {
      const poly = entrancePlanParts(st).find((t) => t.key === 'step-3').worldPolygon;
      center = { x: (poly[0].x + poly[2].x) / 2, y: (poly[0].y + poly[2].y) / 2 };
    }
    const c = document.getElementById('canvas'); st.view.scale = mobile ? .045 : .08; st.view.rotation = .14;
    const before = view.worldToScreen(center.x, center.y);
    st.view.panX += c.clientWidth * .57 - before.x;
    st.view.panY += c.clientHeight * .35 - before.y;
    view.requestDraw();
    const s = view.worldToScreen(center.x, center.y); const rect = c.getBoundingClientRect();
    return { x: rect.x + s.x, y: rect.y + s.y };
  }, { outdoor, mobile });
  await settleView(page);
  if (mobile) await page.touchscreen.tap(at.x, at.y); else await page.mouse.click(at.x, at.y);
  if (mobile) await page.tap('#mobileBar [data-sheet="props"]');
  if (outdoor) await page.selectOption('#stairPart', 'step-3');
  if (mobile) await page.tap('#mobileBar [data-sheet="props"]');
  await settleView(page);
  assert.equal(await page.locator('[data-stair-plan-edge]:visible').count(), 4);
}

async function endPoint(page, edge, distance) {
  const bounds = await page.locator(`[data-stair-plan-edge="${edge}"]`).boundingBox();
  assert.ok(bounds, 'ручка доступна');
  const start = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
  const delta = await page.evaluate(async ({ edge, distance }) => {
    const { stairShapeSelection, stairShapeEdgePoint } = await import('./ui/stair-shape.js');
    const { planToScreen } = await import('./ui/view.js');
    const { part } = stairShapeSelection(); const axis = ['left', 'right'].includes(edge) ? part.xAxis : part.yAxis;
    const p = stairShapeEdgePoint(part, edge); const a = planToScreen(p.x, p.y);
    const b = planToScreen(p.x + axis.x * distance, p.y + axis.y * distance);
    return { x: b.x - a.x, y: b.y - a.y };
  }, { edge, distance });
  return { start, end: { x: start.x + delta.x, y: start.y + delta.y } };
}
const edits = (page, outdoor) => page.evaluate((outdoor) => {
  const p = window.__kepler.state.project;
  return (outdoor ? p.site.landscape.objects[0].meta : p.openings[0].entrance)?.shapeEdits || {};
}, outdoor);

for (const outdoor of [false, true]) for (const mobile of [false, true]) test(`ручки ступени в ландшафте: ${outdoor ? 'отдельная лестница' : 'крыльцо'}, ${mobile ? 'телефон' : 'мышь'}`, async () => {
  const app = await startApp({ mobile, width: 1440, height: 1000 }); const { page } = app;
  try {
    await setup(page, outdoor, mobile);
    const selection = await page.evaluate(() => structuredClone(window.__kepler.state.selection));
    const old = { width: Number(await page.inputValue('#stairPartWidth')), depth: Number(await page.inputValue('#stairPartDepth')) };
    const cdp = mobile ? await page.context().newCDPSession(page) : null;
    const gesture = async (edge, distance, cancel = false) => {
      const { start, end } = await endPoint(page, edge, distance);
      if (mobile) {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...start, id: 1 }] });
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...end, id: 1 }] });
        await settleView(page);
        await cdp.send('Input.dispatchTouchEvent', { type: cancel ? 'touchCancel' : 'touchEnd', touchPoints: [] });
      } else {
        await page.mouse.move(start.x, start.y); await page.mouse.down();
        await page.mouse.move(end.x, end.y, { steps: 5 }); await settleView(page);
        if (cancel) await page.keyboard.press('Escape');
        await page.mouse.up();
      }
      await settleView(page);
    };
    await gesture('right', 800);
    assert.equal(Number(await page.inputValue('#stairPartWidth')), old.width + 800);
    assert.deepEqual(Object.keys(await edits(page, outdoor)), ['step-3'], 'соседние ступени не меняются');
    const widthOnly = await edits(page, outdoor);
    await gesture('front', 500);
    assert.equal(Number(await page.inputValue('#stairPartDepth')), old.depth + 500);
    const final = await edits(page, outdoor);
    await gesture('left', -300, true);
    assert.deepEqual(await edits(page, outdoor), final, 'отмена жеста возвращает форму');
    await page.keyboard.press('Control+z'); assert.deepEqual(await edits(page, outdoor), widthOnly, 'один жест — один шаг истории');
    await page.keyboard.press('Control+Shift+z'); assert.deepEqual(await edits(page, outdoor), final);
    await page.evaluate((selection) => window.__kepler.select(selection), selection); await settleView(page);
    if (process.env.KEPLER_SHOTS) await page.screenshot({ path: `${process.env.KEPLER_SHOTS}/stair-plan-${outdoor ? 'outdoor' : 'porch'}-${mobile ? 'phone' : 'desktop'}.png` });
    await page.reload(); await page.waitForFunction(() => window.__kepler?.state.project);
    assert.deepEqual(await edits(page, outdoor), final, 'форма сохранена в файле');
    assert.deepEqual(app.errors, []);
  } finally { await app.close(); }
});
