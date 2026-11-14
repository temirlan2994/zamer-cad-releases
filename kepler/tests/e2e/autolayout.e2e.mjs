// Снятая авторасстановка не должна оставлять кнопки или скрытно двигать
// мебель. Ручное добавление мебели из карточки комнаты остаётся доступным.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { openSample, startApp } from './helpers.mjs';

describe('авторасстановка мебели отключена', () => {
  let app;
  let roomId;

  before(async () => {
    app = await startApp();
    await openSample(app.page);
    roomId = await app.page.evaluate(() => window.__kepler.state.project.rooms
      .find((room) => room.type === 'bedroom')?.id);
    assert.ok(roomId, 'в примере есть спальня');
    await app.page.evaluate((id) => window.__kepler.selectRoom(id), roomId);
    await app.page.waitForSelector('#roomW');
  });

  after(async () => { await app?.close(); });

  it('убирает все точки запуска, но оставляет ручное добавление мебели', async () => {
    const { page } = app;
    assert.equal(await page.locator('#arrangeBtn').count(), 0);
    assert.equal(await page.locator('#arrangeWholeHomeBtn').count(), 0);
    assert.equal(await page.locator('#autoArrangeFurniture').count(), 0);
    assert.equal(await page.getByText('Авторасстановка мебели', { exact: true }).count(), 0);
    assert.ok(await page.locator('[data-add]').count() > 0, 'ручные кнопки «+» остались');

    const itemId = await page.evaluate(async (id) => {
      const { itemsInRoom } = await import('./core/furnish.js');
      const state = window.__kepler.state;
      const room = state.project.rooms.find((candidate) => candidate.id === id);
      return itemsInRoom(state.project, room)[0]?.id;
    }, roomId);
    assert.ok(itemId, 'в спальне есть мебель');
    await page.evaluate((id) => window.__kepler.select({ type: 'item', id }), itemId);
    await page.waitForSelector('#itemW');
    assert.equal(await page.locator('#itemAutoLayoutLocked').count(), 0);
  });

  it('не двигает мебель даже при принудительном фоновом вызове', async () => {
    const result = await app.page.evaluate(async (id) => {
      const { arrangeRoomsNow, AUTO_LAYOUT_AVAILABLE } = await import('./ui/auto-layout.js');
      const { itemsInRoom } = await import('./core/furnish.js');
      const state = window.__kepler.state;
      const room = state.project.rooms.find((candidate) => candidate.id === id);
      const poses = () => itemsInRoom(state.project, room)
        .map(({ id: itemId, x, y, rotation = 0 }) => ({ id: itemId, x, y, rotation }))
        .sort((a, b) => a.id.localeCompare(b.id));
      const beforePoses = poses();
      const outcome = arrangeRoomsNow([id], { force: true });
      return {
        available: AUTO_LAYOUT_AVAILABLE,
        applied: outcome.applied,
        beforePoses,
        afterPoses: poses(),
      };
    }, roomId);

    assert.equal(result.available, false);
    assert.equal(result.applied, 0);
    assert.deepEqual(result.afterPoses, result.beforePoses);
    assert.deepEqual(app.errors, []);
  });
});
