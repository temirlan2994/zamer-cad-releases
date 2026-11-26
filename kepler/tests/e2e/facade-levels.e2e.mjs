import assert from 'node:assert/strict';
import { test } from 'node:test';
import { openNew, settleView, startApp, with3dLayers } from './helpers.mjs';

test('текущий план обрезает высокие рейки и ручки, в том числе во время перемещения', async () => {
  const app = await startApp({ width: 1440, height: 950 });
  const { page } = app;
  try {
    await openNew(page);
    const id = await page.evaluate(async () => {
      const { createLevel, createRoom } = await import('./core/model.js');
      const { createFacadeElement } = await import('./core/facade.js');
      const { mutate } = await import('./ui/store.js');
      const p = window.__kepler.state.project;
      let id;
      mutate(() => {
        const lower = p.levels[0]; lower.height = 3000;
        lower.rooms.push(createRoom('living', 0, 0, 5000, 4000));
        const upper = createLevel('2 этаж', 3000, 3000);
        upper.rooms.push(createRoom('living', 0, 0, 5000, 4000)); p.levels.push(upper);
        const m = createFacadeElement('slats', { point: { x: 2500, y: 4250, z: 1500 }, normal: { x: 0, y: 1 }, level: lower, from: 0, to: 5000 });
        Object.assign(m, { w: 1050, z0: -250, h: 6250 }); id = m.id; p.masses = [m];
      });
      return id;
    });
    await page.click('#view3dBtn');
    await with3dLayers(page, async () => {
      await page.uncheck('#v3Roof'); await page.uncheck('#v3Site');
      await page.selectOption('#v3Levels', 'all');
    });
    await page.click('.v3-views summary'); await page.click('[data-v3-preset="front"]');
    await page.click('#v3Fit'); await settleView(page);
    const points = () => page.evaluate(async () => {
      const { facadeParts } = await import('./core/facade.js');
      const k = window.__kepler; const m = k.state.project.masses[0]; const b = facadeParts(m)[0];
      const at = (z) => k.screen3d({ x: (b.x0 + b.x1) / 2, y: b.y1, z });
      return { low: at(1500), high: at(4500) };
    });
    const pick = (p) => page.evaluate((at) => window.__kepler.pick3d(at.x, at.y), p);
    let at = await points();
    assert.equal((await pick(at.high))?.id, id);
    await page.mouse.click(at.low.x, at.low.y);
    assert.equal(await page.inputValue('#massH'), '6250');
    assert.ok(await page.evaluate(() => window.__kepler.debug3d().mass.handles.top));
    await with3dLayers(page, () => page.selectOption('#v3Levels', 'only'));
    await settleView(page);
    assert.equal(await pick(at.high), null, 'верх скрыт вместе с этажом');
    assert.equal(await page.evaluate(() => window.__kepler.debug3d().mass.handles.top), undefined, 'скрытая верхняя ручка не торчит');
    assert.equal(await page.inputValue('#massH'), '6250', 'полная высота сохранена');
    const tip = await page.evaluate(() => window.__kepler.debug3d().mass.gizmo.tips.x);
    await page.mouse.move(tip.x, tip.y); await page.mouse.down();
    await page.keyboard.down('Shift'); await page.keyboard.down('Alt');
    await page.mouse.move(tip.x + 50, tip.y, { steps: 5 }); await settleView(page);
    assert.equal(await page.evaluate(() => window.__kepler.debug3d().mass.dragging), true);
    at = await points();
    assert.equal(await pick(at.high), null, 'быстрая пересборка во время жеста сохраняет срез');
    await page.mouse.up(); await page.keyboard.up('Alt'); await page.keyboard.up('Shift');
    await settleView(page);
    if (process.env.KEPLER_SHOTS) await page.screenshot({ path: `${process.env.KEPLER_SHOTS}/facade-current-level.png` });
    await with3dLayers(page, () => page.selectOption('#v3Levels', 'all'));
    await settleView(page);
    at = await points(); assert.equal((await pick(at.high))?.id, id, 'все этажи возвращают верх');
    assert.ok(await page.evaluate(() => window.__kepler.debug3d().mass.handles.top));
    await page.evaluate(async () => {
      const k = window.__kepler; const { switchLevel } = await import('./ui/levels.js');
      switchLevel(k.state.project.levels[1].id, { planView: false });
    });
    await with3dLayers(page, () => page.selectOption('#v3Levels', 'only'));
    await settleView(page); at = await points();
    assert.equal(await pick(at.low), null, 'низ скрыт вместе с первым этажом');
    assert.equal((await pick(at.high))?.id, id);
    assert.equal(await page.evaluate(() => window.__kepler.state.project.masses[0].h), 6250);
    assert.deepEqual(app.errors, []);
  } finally { await app.close(); }
});
