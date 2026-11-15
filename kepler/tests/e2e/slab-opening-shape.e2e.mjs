// Ручной проём перекрытия произвольной формы: настоящий инструмент панели,
// контур по точкам + Enter, нижний этаж/лестница в clipped-underlay и ручки
// вершин. Production-состояние подготавливается через публичные core/store API,
// сам проём создаётся и редактируется только реальными событиями мыши.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, openNew } from './helpers.mjs';

async function planToClient(page, x, y) {
  const box = await (await page.$('#canvas')).boundingBox();
  const p = await page.evaluate(([px, py]) => window.__kepler.planToScreen(px, py), [x, y]);
  return { x: box.x + p.x, y: box.y + p.y };
}

async function clickPlan(page, x, y) {
  const p = await planToClient(page, x, y);
  await page.mouse.move(p.x, p.y);
  await page.mouse.click(p.x, p.y);
}

async function selectedOpening(page) {
  return page.evaluate(async () => {
    const st = window.__kepler.state;
    const { slabOpeningArea, slabOpeningPolygon } = await import('./core/slab-openings.js');
    const level = st.project.levels.find((l) => l.id === st.project.activeLevel);
    const opening = level?.slabOpenings?.find((o) => o.id === st.selection?.id);
    return opening ? {
      id: opening.id,
      outline: opening.outline,
      polygon: slabOpeningPolygon(opening),
      area: slabOpeningArea(opening),
    } : null;
  });
}

describe('проём перекрытия: Г-контур и вид нижней лестницы', () => {
  let app;
  let ids;

  before(async () => {
    app = await startApp({ width: 1400, height: 900 });
    await openNew(app.page);
    ids = await app.page.evaluate(async () => {
      const st = window.__kepler.state;
      const { createItem, createLevel, createRoom } = await import('./core/model.js');
      const { applyStairPreset } = await import('./core/stairs.js');
      const { mutate } = await import('./ui/store.js');
      const { requestDraw, planToScreen } = await import('./ui/view.js');
      let stair;
      let upper;
      mutate(() => {
        const lower = st.project.levels[0];
        lower.name = '1 этаж';
        lower.rooms.push(createRoom('hall', -5000, -5000, 10000, 10000));
        stair = createItem('stairs', 0, 0, 1200, 3000);
        applyStairPreset(stair, 'u', 3000);
        // Тестируем именно ручной проём: авто-проём от этой лестницы не нужен.
        stair.toLevel = 'none';
        lower.items.push(stair);
        upper = createLevel('2 этаж', 3000, 3000, 'L2-SLAB-SHAPE');
        upper.rooms.push(createRoom('hall', -5000, -5000, 10000, 10000));
        st.project.levels.push(upper);
        st.project.activeLevel = upper.id;
      });
      st.view.scale = 0.1;
      const canvas = document.getElementById('canvas');
      const center = planToScreen(0, 0);
      st.view.panX += canvas.clientWidth / 2 - center.x;
      st.view.panY += canvas.clientHeight / 2 - center.y;
      requestDraw();
      return { lowerId: st.project.levels[0].id, upperId: upper.id, stairId: stair.id };
    });
    await app.page.waitForFunction((upperId) => window.__kepler.state.project.activeLevel === upperId, ids.upperId);
  });

  after(async () => { await app?.close(); });

  it('кнопка включает инструмент проёма', async () => {
    const { page } = app;
    assert.equal(await page.isVisible('#slabOpeningToolBtn'), true);
    await page.click('#slabOpeningToolBtn');
    assert.equal(await page.evaluate(() => window.__kepler.state.tool?.kind), 'slab-opening');
    assert.equal(await page.$eval('#slabOpeningToolBtn', (button) => button.classList.contains('active')), true);
    assert.equal(await page.$eval('#canvas', (canvas) => getComputedStyle(canvas).cursor), 'crosshair');
  });

  it('шесть кликов + Enter создают Г-контур и показывают лестницу снизу', async () => {
    const { page } = app;
    // Полный габарит 3600×3600, вырезан нижний левый угол 2200×1500.
    for (const [x, y] of [
      [-1800, -1800], [1800, -1800], [1800, 1800],
      [400, 1800], [400, 300], [-1800, 300],
    ]) await clickPlan(page, x, y);

    assert.equal(await page.evaluate(() => window.__kepler.state.tool?.points.length), 6);
    assert.equal(await page.isVisible('#draftDone'), true, 'кнопка завершения черновика видима');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => window.__kepler.state.tool == null && window.__kepler.state.selection?.type === 'slab');

    const opening = await selectedOpening(page);
    assert.ok(opening, 'созданный проём выбран');
    assert.equal(opening.outline.length, 6);
    assert.equal(opening.polygon.length, 6);
    assert.ok(Math.abs(opening.area - 9_660_000) < 10_000, `площадь Г-контура: ${opening.area}`);

    await page.waitForFunction(([openingId, lowerId, stairId]) => {
      const rec = (window.__kepler.state._slabUnderlay || []).find((x) => x.openingId === openingId);
      return rec?.sourceLevelId === lowerId && rec.stairIds.includes(stairId) && rec.itemIds.includes(stairId);
    }, [opening.id, ids.lowerId, ids.stairId]);
    const underlay = await page.evaluate((openingId) =>
      window.__kepler.state._slabUnderlay.find((x) => x.openingId === openingId), opening.id);
    assert.equal(underlay.sourceLevelId, ids.lowerId);
    assert.deepEqual(underlay.stairIds, [ids.stairId]);

    await page.waitForFunction((openingId) => {
      const rec = (window.__kepler.state._slabUI || []).find((x) => x.id === openingId);
      return rec?.polygon && rec.handles?.length === 12;
    }, opening.id);
    const handles = await page.evaluate((openingId) => {
      const rec = window.__kepler.state._slabUI.find((x) => x.id === openingId);
      return rec.handles.map((h) => ({ id: h.id, kind: h.kind }));
    }, opening.id);
    assert.equal(handles.filter((h) => h.kind === 'vertex').length, 6);
    assert.equal(handles.filter((h) => h.kind === 'midpoint').length, 6);
  });

  it('круглая ручка двигает вершину свободного контура', async () => {
    const { page } = app;
    const before = await selectedOpening(page);
    const box = await (await page.$('#canvas')).boundingBox();
    const handle = await page.evaluate((openingId) => {
      const rec = window.__kepler.state._slabUI.find((x) => x.id === openingId);
      return rec?.handles.find((h) => h.id === 'v:4')?.s || null;
    }, before.id);
    assert.ok(handle, 'ручка внутреннего угла существует');

    const from = { x: box.x + handle.x, y: box.y + handle.y };
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x + 40, from.y, { steps: 8 }); // 400 мм при scale=0.1
    await page.mouse.up();
    await page.waitForFunction(([id, area]) => {
      const level = window.__kepler.state.project.levels.find((l) => l.id === window.__kepler.state.project.activeLevel);
      const opening = level?.slabOpenings?.find((o) => o.id === id);
      if (!opening) return false;
      return import('./core/slab-openings.js').then((m) => Math.abs(m.slabOpeningArea(opening) - area) > 100_000);
    }, [before.id, before.area]);

    const afterMove = await selectedOpening(page);
    assert.equal(afterMove.id, before.id);
    assert.equal(afterMove.polygon.length, 6);
    assert.ok(afterMove.area <= before.area - 250_000, `${before.area} → ${afterMove.area}`);
  });

  it('без ошибок в консоли', () => {
    assert.deepEqual(app.errors, []);
  });
});
