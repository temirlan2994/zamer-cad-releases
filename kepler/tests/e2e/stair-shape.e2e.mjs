import assert from 'node:assert/strict';
import { test } from 'node:test';
import { openNew, settleView, startApp } from './helpers.mjs';
import { stairBodyPoint, stairFaceCenters } from './stair-handle-helpers.mjs';

async function setup(page, outdoor = false) {
  await openNew(page);
  await page.evaluate(async (outdoor) => {
    const { createRoom, createOpening } = await import('./core/model.js');
    const { createLandscapeObject } = await import('./core/landscape.js');
    const { mutate } = await import('./ui/store.js');
    const { state } = window.__kepler;
    mutate(() => {
      state.project.envelope.zeroAboveGround = 900;
      if (outdoor) {
        state.project.site.landscape.objects.push(createLandscapeObject('stairs-out', 0, 0,
          { id: 'outside-stair', w: 2400, h: 3000, height: 900, rotation: 35 }));
      } else {
        const room = createRoom('entrance', 0, 0, 5000, 4000);
        const door = createOpening('door', room.id, 2, 2500, 1000);
        door.id = 'entry-door'; door.entryRole = 'main';
        state.project.rooms.push(room); state.project.openings.push(door);
      }
    });
  }, outdoor);
  await page.evaluate(() => document.getElementById('view3dBtn').click());
  await page.click('.v3-views summary'); await page.click('[data-v3-preset="top"]');
  await page.click('#v3Fit'); await settleView(page);
  const mobile = await page.evaluate(() => navigator.maxTouchPoints > 0);
  const click = (p) => mobile ? page.touchscreen.tap(p.x, p.y) : page.mouse.click(p.x, p.y);
  const at = await stairBodyPoint(page, outdoor);
  assert.ok(at, 'выбирается отдельная проступь');
  await click(at); await settleView(page);
  assert.equal(await page.inputValue('#stairPart'), '', 'первый клик — общие настройки');
  assert.equal(await page.locator('#stairPartWidth').count(), 0);
  assert.equal(await page.locator('[data-stair-edge]:visible').count(), 0);
  assert.equal(await page.locator(outdoor ? '#lsStFlight' : '#porchMode').count(), 1);
  if (await page.locator('body').evaluate((b) => b.classList.contains('sheet-props'))) await page.tap('#mobileBar [data-sheet="props"]');
  const next = await stairBodyPoint(page, outdoor); assert.ok(next);
  await click(next); await settleView(page);
  assert.equal(await page.inputValue('#stairPart'), 'step-3');
  assert.equal(await page.locator(outdoor ? '#lsStFlight' : '#porchMode').count(), 0, 'общие настройки скрыты при правке ступени');
  if (await page.locator('body').evaluate((b) => b.classList.contains('sheet-props'))) await page.tap('#mobileBar [data-sheet="props"]');
  await settleView(page);
}

async function handle(page, edge, delta) {
  const b = await page.locator(`[data-stair-edge="${edge}"]`).boundingBox();
  assert.ok(b, 'ручка видна');
  const start = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  const p = (await stairFaceCenters(page)).world[edge];
  const shift = await page.evaluate(async ({ edge, delta, p }) => {
    const { stairShapeSelection } = await import('./ui/stair-shape.js');
    const { part } = stairShapeSelection();
    const axis = ['left', 'right'].includes(edge) ? part.xAxis : part.yAxis;
    const k = window.__kepler;
    const a = k.screen3d(p); const b = k.screen3d({ x: p.x + axis.x * delta, y: p.y + axis.y * delta, z: p.z });
    return { x: b.x - a.x, y: b.y - a.y };
  }, { edge, delta, p });
  return { start, end: { x: start.x + shift.x, y: start.y + shift.y } };
}

const edits = (page, outdoor) => page.evaluate((outdoor) => {
  const p = window.__kepler.state.project;
  return (outdoor ? p.site.landscape.objects[0].meta : p.openings[0].entrance)?.shapeEdits || {};
}, outdoor);

for (const [outdoor, perspective] of [[false, false], [true, false], [true, true]]) test(`${outdoor ? 'отдельная лестница' : 'крыльцо'}${perspective ? ', перспектива' : ''}: ручки, одна ступень, точные размеры, отмена и файл`, async () => {
  const app = await startApp({ width: 1440, height: 1000 });
  const { page } = app;
  try {
    await setup(page, outdoor);
    if (!outdoor) {
      await page.click('[data-selection-action="stair-whole"]'); await settleView(page);
      assert.equal(await page.inputValue('#stairPart'), '', 'панель действий возвращает общий выбор');
      assert.equal(await page.locator('[data-stair-edge]:visible').count(), 0);
      const landing = await stairBodyPoint(page, false, 'landing'); assert.ok(landing);
      await page.mouse.click(landing.x, landing.y); await settleView(page);
      assert.equal(await page.inputValue('#stairPart'), 'landing', 'повторный клик выбирает площадку');
      const step = await stairBodyPoint(page, false); assert.ok(step);
      await page.mouse.click(step.x, step.y); await settleView(page);
      assert.equal(await page.inputValue('#stairPart'), 'step-3', 'можно переключиться с площадки на ступень');
    }
    if (perspective) {
      await page.click('.v3-views summary'); await page.click('[data-v3-preset="iso"]');
      await page.click('[data-v3-projection="perspective"]'); await page.click('#v3Fit'); await settleView(page);
    }
    const width = Number(await page.inputValue('#stairPartWidth'));
    const { start, end } = await handle(page, 'right', 800);
    await page.mouse.move(start.x, start.y); await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 6 }); await page.mouse.up();
    assert.equal(Number(await page.inputValue('#stairPartWidth')), width + 800);
    assert.deepEqual(Object.keys(await edits(page, outdoor)), ['step-3']);
    const saved = await edits(page, outdoor);
    const other = await handle(page, 'front', 500);
    await page.mouse.move(other.start.x, other.start.y); await page.mouse.down();
    await page.mouse.move(other.end.x, other.end.y, { steps: 4 });
    await page.keyboard.press('Escape'); await page.mouse.up();
    assert.deepEqual(await edits(page, outdoor), saved, 'Esc восстанавливает форму');
    await page.keyboard.press('Control+z');
    assert.deepEqual(await edits(page, outdoor), {}, 'один жест отменяется одним шагом');
    await page.keyboard.press('Control+Shift+z');
    assert.deepEqual(await edits(page, outdoor), saved);
    await page.evaluate((outdoor) => window.__kepler.select(outdoor ? { type: 'landscape', ids: ['outside-stair'], part: 'step-3' } : { type: 'entrance', id: 'entry-door', part: 'step-3' }), outdoor);
    await page.fill('#stairPartDepth', '900'); await page.press('#stairPartDepth', 'Tab');
    await page.fill('#stairPartSide', '300'); await page.press('#stairPartSide', 'Tab');
    assert.equal(await page.inputValue('#stairPartDepth'), '900');
    assert.equal(await page.inputValue('#stairPartSide'), '300');
    const final = await edits(page, outdoor);
    if (process.env.KEPLER_SHOTS) await page.screenshot({ path: `${process.env.KEPLER_SHOTS}/stair-shape-${outdoor ? 'outdoor' : 'porch'}.png` });
    await page.reload();
    await page.waitForFunction(() => window.__kepler?.state.project);
    assert.deepEqual(await edits(page, outdoor), final);
    assert.deepEqual(app.errors, []);
  } finally { await app.close(); }
});

for (const outdoor of [false, true]) test(`телефон: выбор и правка ${outdoor ? 'наружной лестницы' : 'крыльца'}, отмена касания`, async () => {
  const app = await startApp({ mobile: true });
  const { page } = app;
  try {
    await setup(page, outdoor);
    const { start, end } = await handle(page, 'right', 600);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 2 });
    for (const [type, points] of [['touchStart', [start]], ['touchMove', [end]], ['touchEnd', []]]) {
      await cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map((p) => ({ ...p, id: 1 })) });
    }
    await settleView(page);
    assert.equal((await edits(page, outdoor))['step-3'].right, 600);
    const before = await edits(page, outdoor);
    const next = await handle(page, 'right', 300);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...next.start, id: 2 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...next.end, id: 2 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
    await settleView(page);
    assert.deepEqual(await edits(page, outdoor), before);
    assert.deepEqual(app.errors, []);
  } finally { await app.close(); }
});
