import assert from 'node:assert/strict';
import { it } from 'node:test';
import { openNew, startApp } from './helpers.mjs';

it('узкий витраж: сохранённая высота, ввод размера и ручка меняют стекло обоих этажей', async () => {
  const app = await startApp({ width: 1440, height: 950 });
  const { page } = app;
  try {
    await openNew(page);
    await page.evaluate(async () => {
      const { createLevel, createRoom, createOpening } = await import('./core/model.js');
      const { mutate } = await import('./ui/store.js');
      mutate(() => {
        const p = window.__kepler.state.project;
        const room = createRoom('living', 0, 0, 7000, 5000); room.ceiling = 2700; p.rooms.push(room);
        const opening = createOpening('window', room.id, 2, 2200, 1200);
        Object.assign(opening, { id: 'tall-window', type: 'fixed', heightMode: 'custom', sill: 100, height: 5500 });
        p.openings.push(opening);
        const upper = createLevel('2 этаж', 3000, 3000, 'L2');
        upper.rooms.push(createRoom('bedroom', 0, 0, 7000, 5000)); p.levels.push(upper);
      });
    });
    await page.click('#view3dBtn');
    await page.getByRole('button', { name: 'Перспектива', exact: true }).click();
    const at = (z) => page.evaluate((z) => window.__kepler.screen3d({ x: 2200, y: 5125, z }), z);
    const glass = await at(4400);
    await page.mouse.click(glass.x, glass.y);
    await page.waitForFunction(() => window.__kepler.state.selection?.id === 'tall-window');
    const check = () => page.evaluate(async () => {
      const { buildHouseMesh } = await import('./core/mesh3d.js');
      const p = window.__kepler.state.project;
      const glass = buildHouseMesh(p).filter((f) => f.kind === 'glass' && f.openingId === 'tall-window');
      return { top: Math.max(...glass.flatMap((f) => f.pts.map((v) => v.z))), width: p.openings[0].width, count: glass.length };
    });
    assert.deepEqual(await check(), { top: 5600, width: 1200, count: 2 });
    assert.equal(await page.locator('#openTopLevel').inputValue(), 'L2');
    await page.locator('#openH').fill('5000'); await page.locator('#openH').press('Tab');
    assert.deepEqual(await check(), { top: 5100, width: 1200, count: 2 });
    await page.locator('#openH').fill('2500'); await page.locator('#openH').press('Tab');
    assert.deepEqual(await check(), { top: 2600, width: 1200, count: 1 });
    const top = await at(2600), goal = await at(5700);
    await page.mouse.move(top.x, top.y); await page.mouse.down();
    assert.equal(await page.evaluate(() => window.__kepler.debug3d().openingTool.resizing), 'top');
    await page.mouse.move(goal.x, goal.y, { steps: 12 }); await page.mouse.up();
    assert.deepEqual(await check(), { top: 5700, width: 1200, count: 2 });
    await page.screenshot({ path: '/tmp/tall-window-fixed.png' });
    await page.selectOption('#openTopLevel', '');
    assert.deepEqual(await check(), { top: 2600, width: 1200, count: 1 });
    assert.deepEqual(app.errors, []);
  } finally { await app.close(); }
});

for (const mobile of [false, true]) it(`широкое окно через две комнаты второго этажа: ручка, вырез и Undo · ${mobile ? 'телефон' : 'перспектива'}`, async () => {
  const app = await startApp({ mobile, width: 1440, height: 950 });
  const { page } = app;
  try {
    await openNew(page);
    await page.evaluate(async () => {
      const { createLevel, createRoom, createOpening } = await import('./core/model.js');
      const { mutate } = await import('./ui/store.js');
      mutate(() => {
        const p = window.__kepler.state.project;
        const room = createRoom('living', 0, 0, 10000, 5000);
        p.rooms.push(room);
        const opening = createOpening('window', room.id, 2, 5000, 4200);
        opening.id = 'wide-window'; opening.type = 'fixed'; opening.heightMode = 'custom'; opening.sill = 100; opening.height = 2900;
        p.openings.push(opening);
        const upper = createLevel('2 этаж', 3000, 3000, 'L2');
        upper.rooms.push(createRoom('bedroom', 0, 0, 5000, 5000), createRoom('bedroom', 5150, 0, 4850, 5000));
        p.levels.push(upper);
      });
    });
    const press = (selector) => mobile ? page.tap(selector) : page.click(selector);
    await press('#view3dBtn');
    if (!mobile) await page.getByRole('button', { name: 'Перспектива', exact: true }).click();
    const at = (z) => page.evaluate((height) => window.__kepler.screen3d({ x: 5000, y: 5125, z: height }), z);
    const glass = await at(1500);
    if (mobile) await page.touchscreen.tap(glass.x, glass.y); else await page.mouse.click(glass.x, glass.y);
    await page.waitForFunction(() => window.__kepler.state.selection?.id === 'wide-window');
    const top = await at(3000), goal = await at(6100);
    const cdp = mobile ? await page.context().newCDPSession(page) : null;
    if (mobile) await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: top.x, y: top.y }] });
    else { await page.mouse.move(top.x, top.y); await page.mouse.down(); }
    assert.equal(await page.evaluate(() => window.__kepler.debug3d().openingTool.resizing), 'top');
    if (mobile) {
      for (let i = 1; i <= 10; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: top.x+(goal.x-top.x)*i/10, y: top.y+(goal.y-top.y)*i/10 }] });
    } else await page.mouse.move(goal.x, goal.y, { steps: 10 });
    assert.equal(await page.evaluate(() => window.__kepler.state.project.openings[0].span?.levelId), 'L2', 'проём продолжается уже во время жеста');
    if (mobile) await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); else await page.mouse.up();
    const check = () => page.evaluate(async () => {
      const { windowSpanTop, levelWindowOpenings } = await import('./core/spanning-windows.js');
      const { levelProject } = await import('./core/model.js');
      const { buildHouseMesh } = await import('./core/mesh3d.js');
      const { pickBoxes, pickWall } = await import('./core/pick3d.js');
      const p = window.__kepler.state.project, opening = p.openings[0];
      const upper = levelWindowOpenings(levelProject(p, 'L2'));
      const hit = pickWall(pickBoxes(p).walls, { o: { x: 5075, y: 6000, z: 4500 }, d: { x: 0, y: -1, z: 0 } });
      const slab = buildHouseMesh(p).filter((f) => f.slabRole === 'interfloor' && f.normal.z > .5);
      const solidAtWindow = slab.some((f) => 5075 > Math.min(...f.pts.map((v) => v.x)) && 5075 < Math.max(...f.pts.map((v) => v.x)) && 5125 > Math.min(...f.pts.map((v) => v.y)) && 5125 < Math.max(...f.pts.map((v) => v.y)));
      return { top: windowSpanTop(p, p.activeLevel, opening), parts: upper.length, width: opening.width, storedUpper: p.levels[1].openings.length, wallCut: !hit || hit.point.y <= 5000.5, solidAtWindow };
    });
    assert.deepEqual(await check(), { top: 5700, parts: 2, width: 4200, storedUpper: 0, wallCut: true, solidAtWindow: false });
    if (!mobile) await page.screenshot({ path: '/tmp/window-second-floor.png' });
    await page.keyboard.press('Control+z');
    assert.equal(await page.evaluate(() => window.__kepler.state.project.openings[0].span), undefined);
    await page.keyboard.press('Control+y'); assert.equal((await check()).top, 5700);
    // Esc во время следующего изменения возвращает прежний высокий витраж.
    const high = await at(5700), lower = await at(4200);
    if (mobile) await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: high.x, y: high.y }] });
    else { await page.mouse.move(high.x, high.y); await page.mouse.down(); }
    if (mobile) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: lower.x, y: lower.y }] });
    else await page.mouse.move(lower.x, lower.y, { steps: 5 });
    await page.keyboard.press('Escape');
    if (mobile) await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); else await page.mouse.up();
    assert.equal((await check()).top, 5700);
    assert.deepEqual(app.errors, []);
  } finally { await app.close(); }
});
