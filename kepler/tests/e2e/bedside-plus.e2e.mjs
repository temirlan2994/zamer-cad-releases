import test from 'node:test';
import assert from 'node:assert/strict';

import { openNew, startApp, zoomToItems } from './helpers.mjs';

test('кнопки + у кровати добавляют тумбы в один перемещаемый комплект', { timeout: 20_000 }, async () => {
  const app = await startApp();
  try {
    await openNew(app.page);
    const bedId = await app.page.evaluate(async () => {
      const { createItem } = await import('./core/model.js');
      const st = window.__kepler.state;
      const bed = createItem('bed-double', 2500, 1800, 1600, 2000);
      st.project.items = [bed];
      window.__kepler.select({ type: 'item', id: bed.id });
      return bed.id;
    });
    await zoomToItems(app.page, 0.14, [bedId]);
    await app.page.waitForFunction(() => window.__kepler.state._bedsideUI?.spots?.length === 2);

    const first = await app.page.evaluate(() => window.__kepler.state._bedsideUI.spots.find((spot) => spot.side === 'left'));
    const canvas = await (await app.page.$('#canvas')).boundingBox();
    await app.page.mouse.click(canvas.x + first.x, canvas.y + first.y);
    await app.page.waitForFunction(() => window.__kepler.state.project.items.filter((item) => item.kind === 'nightstand').length === 1);
    await app.page.waitForFunction(() => window.__kepler.state._bedsideUI?.spots?.length === 1);

    let result = await app.page.evaluate((id) => {
      const st = window.__kepler.state;
      const bed = st.project.items.find((item) => item.id === id);
      const stand = st.project.items.find((item) => item.kind === 'nightstand');
      return { bed, stand, selection: st.selection, spots: st._bedsideUI?.spots?.map((spot) => spot.side) };
    }, bedId);
    assert.equal(result.bed.group, result.stand.group);
    assert.equal(result.bed.bedsideSet, result.stand.bedsideSet);
    assert.equal(result.stand.bedsideSide, 'left');
    assert.deepEqual(result.selection.itemIds.sort(), [bedId, result.stand.id].sort());
    assert.deepEqual(result.spots, ['right']);

    const second = await app.page.evaluate(() => window.__kepler.state._bedsideUI.spots[0]);
    await app.page.mouse.click(canvas.x + second.x, canvas.y + second.y);
    await app.page.waitForFunction(() => window.__kepler.state.project.items.filter((item) => item.kind === 'nightstand').length === 2);
    await app.page.waitForFunction(() => window.__kepler.state._bedsideUI?.spots?.length === 0);

    await app.page.keyboard.press('Control+z');
    await app.page.waitForFunction(() => window.__kepler.state.project.items.filter((item) => item.kind === 'nightstand').length === 1);
    result = await app.page.evaluate(async () => {
      const { missingBedsideSpots } = await import('./core/bedside.js');
      const items = window.__kepler.state.project.items;
      const bed = items.find((item) => item.kind === 'bed-double');
      return {
        sides: items.filter((item) => item.kind === 'nightstand').map((item) => item.bedsideSide),
        spots: missingBedsideSpots(items, bed).map((spot) => spot.side),
      };
    });
    assert.deepEqual(result.sides, ['left']);
    assert.deepEqual(result.spots, ['right']);
    assert.deepEqual(app.errors, []);
  } finally {
    await app.close();
  }
});

