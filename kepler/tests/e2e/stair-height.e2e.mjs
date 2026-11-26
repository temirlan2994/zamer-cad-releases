import assert from 'node:assert/strict';
import { test } from 'node:test';
import { openNew, settleView, startApp } from './helpers.mjs';
import { stairFaceCenters } from './stair-handle-helpers.mjs';

const edits = (page, outdoor) => page.evaluate((outdoor) => {
  const p = window.__kepler.state.project;
  return (outdoor ? p.site.landscape.objects[0].meta : p.openings[0].entrance)?.shapeEdits || {};
}, outdoor);

async function setup(page, outdoor, perspective, part) {
  await openNew(page);
  await page.evaluate(async (outdoor) => {
    const { createRoom, createOpening } = await import('./core/model.js');
    const { createLandscapeObject } = await import('./core/landscape.js');
    const { mutate } = await import('./ui/store.js');
    const p = window.__kepler.state.project;
    mutate(() => {
      p.envelope.zeroAboveGround = 900;
      p.building = { rotation: 37, origin: { x: 700, y: -500 } };
      if (outdoor) p.site.landscape.objects.push(createLandscapeObject('stairs-out', 0, 0,
        { id: 'outside-stair', w: 2400, h: 3000, height: 900, rotation: 23, elev: 350 }));
      else {
        const room = createRoom('entrance', 0, 0, 5000, 4000);
        const door = createOpening('door', room.id, 2, 2500, 1000);
        door.id = 'entry-door'; door.entryRole = 'main'; p.rooms.push(room); p.openings.push(door);
      }
    });
  }, outdoor);
  await page.evaluate(() => document.getElementById('view3dBtn').click());
  await page.click('.v3-views summary'); await page.click('[data-v3-preset="iso"]');
  if (perspective) await page.click('[data-v3-projection="perspective"]');
  await page.click('#v3Fit');
  await page.evaluate(({ outdoor, part }) => window.__kepler.select(outdoor
    ? { type: 'landscape', ids: ['outside-stair'], part } : { type: 'entrance', id: 'entry-door', part }), { outdoor, part });
  await settleView(page);
}

async function heightHandle(page, edge, delta) {
  const bounds = await page.locator(`[data-stair-height="${edge}"]`).boundingBox();
  assert.ok(bounds, `${edge}: ручка видна`);
  const start = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
  const p = (await stairFaceCenters(page)).world[edge];
  const shift = await page.evaluate(({ p, delta }) => {
    const k = window.__kepler;
    const a = k.screen3d(p); const b = k.screen3d({ ...p, z: p.z + delta });
    return { x: b.x - a.x, y: b.y - a.y };
  }, { p, delta });
  return { start, end: { x: start.x + shift.x, y: start.y + shift.y } };
}

for (const outdoor of [false, true]) for (const variant of ['parallel', 'perspective', 'phone']) test(`толщина ${outdoor ? 'наружной лестницы' : 'крыльца'}: ${variant}`, async () => {
  const mobile = variant === 'phone'; const perspective = variant === 'perspective';
  const part = perspective ? (outdoor ? 'step-1' : 'landing') : 'step-3';
  const app = await startApp({ mobile, width: 1440, height: 1000 }); const { page } = app;
  try {
    await setup(page, outdoor, perspective, part);
    if (mobile && !await page.locator('body').evaluate((b) => b.classList.contains('sheet-props'))) await page.tap('#mobileBar [data-sheet="props"]');
    const upper = Number(await page.inputValue('#stairPart-upper'));
    const lower = Number(await page.inputValue('#stairPart-lower'));
    // Тонкая ступень на телефоне: области захвата точек пересекаются.
    const nextLower = mobile ? upper + 20 : lower + 80;
    const lowerOffset = nextLower - lower;
    const width = Number(await page.inputValue('#stairPartWidth'));
    await page.fill('#stairPart-upper', String(upper + 100)); await page.press('#stairPart-upper', 'Tab');
    assert.equal(Number(await page.inputValue('#stairPart-lower')), lower, 'верх не двигает низ');
    await page.fill('#stairPart-lower', String(nextLower)); await page.press('#stairPart-lower', 'Tab');
    assert.equal(Number(await page.inputValue('#stairPart-upper')), upper + 100, 'низ не двигает верх');
    assert.equal(Number(await page.locator('#stairPartThickness').textContent()), upper + 100 - nextLower);
    await page.fill('#stairPartWidth', String(width + 300)); await page.press('#stairPartWidth', 'Tab');
    assert.equal((await edits(page, outdoor))[part].upper, 100, 'правка контура сохраняет высоту');
    assert.equal((await edits(page, outdoor))[part].lower, lowerOffset);
    const beforeInvalid = await edits(page, outdoor);
    await page.fill('#stairPart-upper', String(lower)); await page.press('#stairPart-upper', 'Tab');
    assert.deepEqual(await edits(page, outdoor), beforeInvalid, 'грани нельзя поменять местами');
    if (mobile) await page.tap('#mobileBar [data-sheet="props"]');
    await settleView(page);
    assert.equal(await page.locator('[data-stair-height]:visible').count(), 2);
    const centers = await stairFaceCenters(page);
    for (const [edge, point] of Object.entries(centers.screen)) {
      const dot = page.locator(`[data-stair-${['upper', 'lower'].includes(edge) ? 'height' : 'edge'}="${edge}"]`);
      const box = await dot.boundingBox(); assert.ok(box, edge);
      assert.ok(Math.hypot(box.x + box.width / 2 - point.x, box.y + box.height / 2 - point.y) < 1, `${edge}: точка в центре своей грани`);
      assert.equal(await dot.textContent(), '', 'у точки нет стрелки');
      assert.equal(await dot.evaluate((b) => getComputedStyle(b, '::after').width), '10px', 'видимая точка маленькая');
    }
    const cdp = mobile ? await page.context().newCDPSession(page) : null;
    const gesture = async (edge, delta, cancel = false) => {
      const { start, end } = await heightHandle(page, edge, delta);
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
    await gesture('upper', 120);
    assert.equal((await edits(page, outdoor))[part].upper, 220);
    assert.equal((await edits(page, outdoor))[part].lower, lowerOffset);
    const topOnly = await edits(page, outdoor);
    await gesture('lower', 60);
    assert.equal((await edits(page, outdoor))[part].lower, lowerOffset + 60);
    assert.equal((await edits(page, outdoor))[part].upper, 220);
    const final = await edits(page, outdoor);
    await gesture('upper', 50, true); assert.deepEqual(await edits(page, outdoor), final, 'отмена жеста');
    await page.keyboard.press('Control+z'); assert.deepEqual(await edits(page, outdoor), topOnly, 'жест отменяется целиком');
    await page.keyboard.press('Control+Shift+z'); assert.deepEqual(await edits(page, outdoor), final);
    assert.deepEqual(Object.keys(final), [part], 'меняется только выбранный элемент');
    await page.evaluate(({ outdoor, part }) => window.__kepler.select(outdoor
      ? { type: 'landscape', ids: ['outside-stair'], part } : { type: 'entrance', id: 'entry-door', part }), { outdoor, part });
    await settleView(page);
    if (process.env.KEPLER_SHOTS) await page.screenshot({ path: `${process.env.KEPLER_SHOTS}/stair-height-${outdoor ? 'outdoor' : 'porch'}-${variant}.png` });
    await page.reload(); await page.waitForFunction(() => window.__kepler?.state.project);
    assert.deepEqual(await edits(page, outdoor), final, 'высоты сохраняются в файле');
    assert.deepEqual(app.errors, []);
  } finally { await app.close(); }
});
