import assert from 'node:assert/strict';
import { test } from 'node:test';
import { openNew, settleView, startApp } from './helpers.mjs';

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
  const at = await page.evaluate(async (outdoor) => {
    const { buildHouseMesh } = await import('./core/mesh3d.js');
    const k = window.__kepler;
    return buildHouseMesh(k.state.project, { site: true, landscape: true }).filter((f) => f.stairPart === 'step-3' && f.normal.z > .9).map((f) => {
      const c = f.pts.reduce((a, p) => ({ x: a.x + p.x / f.pts.length, y: a.y + p.y / f.pts.length, z: a.z + p.z / f.pts.length }), { x: 0, y: 0, z: 0 });
      return k.screen3d(c);
    }).find((p) => document.elementFromPoint(p.x, p.y)?.id === 'canvas3d' && k.pick3d(p.x, p.y)?.part === 'step-3' && k.pick3d(p.x, p.y)?.type === (outdoor ? 'landscape' : 'entrance'));
  }, outdoor);
  assert.ok(at, 'выбирается отдельная проступь');
  await page.mouse.click(at.x, at.y);
  assert.equal(await page.inputValue('#stairPart'), 'step-3');
  if (await page.locator('body').evaluate((b) => b.classList.contains('sheet-props'))) await page.tap('#mobileBar [data-sheet="props"]');
  await settleView(page);
}

async function handle(page, edge, delta, outdoor) {
  const b = await page.locator(`[data-stair-edge="${edge}"]`).boundingBox();
  assert.ok(b, 'ручка видна');
  const start = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  const shift = await page.evaluate(async ({ outdoor, edge, delta }) => {
    const { toLocal } = await import('./core/building.js');
    const { deriveEntrances, entranceParts } = await import('./core/entrance.js');
    const k = window.__kepler; const p = k.state.project;
    let part;
    if (outdoor) {
      const { stairTreads } = await import('./core/landscape.js');
      const { buildHouseMesh } = await import('./core/mesh3d.js');
      const o = p.site.landscape.objects[0]; const a = o.rotation * Math.PI / 180;
      const origin = toLocal(p.building, o);
      const axis = (x, y) => { const e = toLocal(p.building, { x: o.x + x, y: o.y + y }); return { x: e.x - origin.x, y: e.y - origin.y }; };
      const tread = stairTreads(o).find((t) => t.key === 'step-3');
      const face = buildHouseMesh(p, { site: true, landscape: true }).find((f) => f.landscapeId === o.id && f.stairPart === tread.key && f.normal.z > .9);
      part = { origin, xAxis: axis(Math.cos(a), Math.sin(a)), yAxis: axis(-Math.sin(a), Math.cos(a)), z: face.pts[0].z,
        rect: { left: tread.left, right: tread.right, back: tread.top, front: tread.bottom } };
    } else part = entranceParts(deriveEntrances(p)[0]).find((t) => t.key === 'step-3');
    const across = ['left', 'right'].includes(edge);
    const axis = across ? part.xAxis : part.yAxis;
    const r = part.rect;
    const x = across ? r[edge] : (r.left + r.right) / 2;
    const y = across ? (r.back + r.front) / 2 : r[edge];
    const point = { x: part.origin.x + x * part.xAxis.x + y * part.yAxis.x, y: part.origin.y + x * part.xAxis.y + y * part.yAxis.y, z: part.z };
    const a = k.screen3d(point); const b = k.screen3d({ x: point.x + axis.x * delta, y: point.y + axis.y * delta, z: point.z });
    return { x: b.x - a.x, y: b.y - a.y };
  }, { outdoor, edge, delta });
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
    if (perspective) {
      await page.click('.v3-views summary'); await page.click('[data-v3-preset="iso"]');
      await page.click('[data-v3-projection="perspective"]'); await page.click('#v3Fit'); await settleView(page);
    }
    const width = Number(await page.inputValue('#stairPartWidth'));
    const { start, end } = await handle(page, 'right', 800, outdoor);
    await page.mouse.move(start.x, start.y); await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 6 }); await page.mouse.up();
    assert.equal(Number(await page.inputValue('#stairPartWidth')), width + 800);
    assert.deepEqual(Object.keys(await edits(page, outdoor)), ['step-3']);
    const saved = await edits(page, outdoor);
    const other = await handle(page, 'front', 500, outdoor);
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

test('телефон: край ступени меняется касанием и отменяется при pointercancel', async () => {
  const app = await startApp({ mobile: true });
  const { page } = app;
  try {
    await setup(page, false);
    const { start, end } = await handle(page, 'right', 600, false);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 2 });
    for (const [type, points] of [['touchStart', [start]], ['touchMove', [end]], ['touchEnd', []]]) {
      await cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map((p) => ({ ...p, id: 1 })) });
    }
    assert.equal((await edits(page, false))['step-3'].right, 600);
    const before = await edits(page, false);
    const next = await handle(page, 'right', 300, false);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...next.start, id: 2 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...next.end, id: 2 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
    assert.deepEqual(await edits(page, false), before);
    assert.deepEqual(app.errors, []);
  } finally { await app.close(); }
});
