// e2e многовариантной авторасстановки: предпросмотр не меняет проект,
// применение отменяется одним шагом, закреплённая мебель не двигается,
// изменение формы автоматически перестраивает остальные предметы.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, openSample } from './helpers.mjs';

const roomItems = (page, roomId) => page.evaluate(async (id) => {
  const { itemsInRoom } = await import('./core/furnish.js');
  const state = window.__kepler.state;
  const room = state.project.rooms.find((candidate) => candidate.id === id);
  return itemsInRoom(state.project, room).map((item) => ({
    id: item.id, kind: item.kind, x: item.x, y: item.y,
    rotation: item.rotation || 0, locked: item.autoLayoutLocked === true,
  })).sort((a, b) => a.id.localeCompare(b.id));
}, roomId);

const poseKey = (items) => JSON.stringify(items.map(({ id, x, y, rotation }) => ({ id, x, y, rotation })));

async function selectRoom(page, roomId) {
  await page.evaluate((id) => window.__kepler.selectRoom(id), roomId);
  await page.waitForSelector('#arrangeBtn');
}

async function buildVariants(page) {
  await page.click('#arrangeBtn');
  await page.waitForFunction(() => document.querySelectorAll('[data-layout-variant]').length >= 2);
  return page.$$eval('[data-layout-variant]', (cards) => cards.map((card) => card.dataset.layoutVariant));
}

async function applyVariant(page, index = 1) {
  const buttons = page.locator('[data-layout-apply]');
  await buttons.nth(index).click();
  await page.waitForFunction(() => document.querySelectorAll('[data-layout-variant]').length === 0);
}

describe('полноценная авторасстановка мебели', () => {
  let app;
  let roomId;

  before(async () => {
    app = await startApp();
    await openSample(app.page);
    roomId = await app.page.evaluate(() => window.__kepler.state.project.rooms.find((room) => room.type === 'bedroom').id);
    await selectRoom(app.page, roomId);
  });
  after(async () => { await app?.close(); });

  it('строит варианты без мутации, применяет с Undo и соблюдает закрепление', async () => {
    const { page } = app;
    const initial = await roomItems(page, roomId);
    assert.ok(initial.length >= 2, `мебели в спальне: ${initial.length}`);

    const ids = await buildVariants(page);
    assert.ok(ids.length >= 2);
    assert.deepEqual(await roomItems(page, roomId), initial, 'предпросмотр не меняет координаты');

    await applyVariant(page, 1);
    const initialPose = initial.map(({ id, x, y, rotation }) => ({ id, x, y, rotation }));
    await page.waitForFunction((before) => {
      const state = window.__kepler.state;
      const now = before.map(({ id }) => {
        const item = state.project.items.find((candidate) => candidate.id === id);
        return { id, x: item.x, y: item.y, rotation: item.rotation || 0 };
      });
      return JSON.stringify(now) !== JSON.stringify(before);
    }, initialPose);
    assert.notEqual(poseKey(await roomItems(page, roomId)), poseKey(initial));

    await page.keyboard.press('Control+z');
    await page.waitForFunction((before) => {
      const state = window.__kepler.state;
      const now = before.map(({ id }) => {
        const item = state.project.items.find((candidate) => candidate.id === id);
        return { id, x: item.x, y: item.y, rotation: item.rotation || 0 };
      });
      return JSON.stringify(now) === JSON.stringify(before);
    }, initialPose);

    const bed = initial.find((item) => item.kind === 'bed-double') || initial.find((item) => item.kind.startsWith('bed'));
    assert.ok(bed, 'в спальне есть кровать');
    await page.evaluate((id) => window.__kepler.select({ type: 'item', id }), bed.id);
    await page.check('#itemAutoLayoutLocked');
    assert.equal(await page.evaluate((id) => window.__kepler.state.project.items.find((item) => item.id === id).autoLayoutLocked, bed.id), true);

    await selectRoom(page, roomId);
    await buildVariants(page);
    const bedBefore = (await roomItems(page, roomId)).find((item) => item.id === bed.id);
    await applyVariant(page, 0);
    const bedAfter = (await roomItems(page, roomId)).find((item) => item.id === bed.id);
    assert.deepEqual(bedAfter, bedBefore, 'закреплённая кровать не сдвинута');
    assert.deepEqual(app.errors, []);
  });

  it('после изменения размера перестраивает мебель одним шагом и отключается переключателем', async () => {
    const { page } = app;
    await selectRoom(page, roomId);
    assert.equal(await page.isChecked('#autoArrangeFurniture'), true);

    // Создаём заведомо плохое исходное положение незакреплённого предмета:
    // изменение размера должно исправить его уже после окончания операции.
    const before = await page.evaluate((id) => {
      const state = window.__kepler.state;
      (state.snapSettings ||= {}).magnet = false; // автодок не добавляет второй шаг истории
      const room = state.project.rooms.find((candidate) => candidate.id === id);
      const bed = state.project.items.find((item) => item.autoLayoutLocked);
      const movable = state.project.items.find((item) => item.id !== bed.id && item.x >= room.x && item.x <= room.x + room.w && item.y >= room.y && item.y <= room.y + room.h);
      movable.x = bed.x; movable.y = bed.y;
      return { width: room.w, itemId: movable.id, pose: { x: movable.x, y: movable.y, rotation: movable.rotation || 0 }, history: (window.__kepler.state.history?.undo || []).length };
    }, roomId);
    const undoBefore = await page.evaluate(async () => (await import('./ui/state.js')).history.undo.length);
    await page.fill('#roomW', String(before.width + 100));
    await page.dispatchEvent('#roomW', 'change');
    await page.waitForFunction(({ itemId, pose }) => {
      const item = window.__kepler.state.project.items.find((candidate) => candidate.id === itemId);
      return item.x !== pose.x || item.y !== pose.y || (item.rotation || 0) !== pose.rotation;
    }, before);
    assert.equal(await page.evaluate(async () => (await import('./ui/state.js')).history.undo.length), undoBefore + 1);

    await page.keyboard.press('Control+z');
    await page.waitForFunction(({ id, width, itemId, pose }) => {
      const state = window.__kepler.state;
      const room = state.project.rooms.find((candidate) => candidate.id === id);
      const item = state.project.items.find((candidate) => candidate.id === itemId);
      return room.w === width && item.x === pose.x && item.y === pose.y && (item.rotation || 0) === pose.rotation;
    }, { id: roomId, ...before });

    await selectRoom(page, roomId);
    await page.uncheck('#autoArrangeFurniture');
    await selectRoom(page, roomId);
    assert.equal(await page.isChecked('#autoArrangeFurniture'), false);
    const fixed = await page.evaluate(({ id, itemId }) => {
      const state = window.__kepler.state;
      const room = state.project.rooms.find((candidate) => candidate.id === id);
      const item = state.project.items.find((candidate) => candidate.id === itemId);
      item.x = room.x + room.w / 2;
      item.y = room.y + room.h / 2;
      return { width: room.w, x: item.x, y: item.y, rotation: item.rotation || 0 };
    }, { id: roomId, itemId: before.itemId });
    await page.fill('#roomW', String(fixed.width + 100));
    await page.dispatchEvent('#roomW', 'change');
    assert.deepEqual(await page.evaluate((id) => {
      const item = window.__kepler.state.project.items.find((candidate) => candidate.id === id);
      return { x: item.x, y: item.y, rotation: item.rotation || 0 };
    }, before.itemId), { x: fixed.x, y: fixed.y, rotation: fixed.rotation });
    assert.deepEqual(app.errors, []);
  });

  it('перестраивает мебель на всех этажах после общей геометрической правки', async () => {
    const result = await app.page.evaluate(async () => {
      const model = await import('./core/model.js');
      const store = await import('./ui/store.js');
      const { state } = await import('./ui/state.js');
      const project = model.createProject('Два этажа');
      const second = model.createLevel('2 этаж', 3000, 3000, 'L2');
      project.levels.push(second);
      project.settings.autoArrangeFurniture = true;

      const firstRoom = model.createRoom('cabinet', 0, 0, 6000, 4000);
      const secondRoom = model.createRoom('cabinet', 0, 0, 6000, 4000);
      const firstDesk = model.createItem('desk', 5500, 2000, 1200, 600);
      const secondDesk = model.createItem('desk', 5500, 2000, 1200, 600);
      project.levels[0].rooms.push(firstRoom);
      project.levels[0].items.push(firstDesk);
      second.rooms.push(secondRoom);
      second.items.push(secondDesk);
      state.project = project;
      store.refreshDerived();
      const before = store.snapshot();

      firstRoom.w = 5000;
      secondRoom.w = 5000;
      store.refreshDerived();
      const report = store.reflowLayoutChanges(before);
      return {
        applied: report.applied,
        levels: [...new Set(report.reports.map((entry) => entry.levelId))].sort(),
        first: { x: firstDesk.x, roomRight: firstRoom.x + firstRoom.w },
        second: { x: secondDesk.x, roomRight: secondRoom.x + secondRoom.w },
      };
    });
    assert.equal(result.applied, 2);
    assert.deepEqual(result.levels, ['L1', 'L2']);
    assert.ok(result.first.x < result.first.roomRight);
    assert.ok(result.second.x < result.second.roomRight);
    assert.deepEqual(app.errors, []);
  });

  it('подбирает весь дом в Worker, применяет один вариант и отменяет одним Undo', async () => {
    const setup = await app.page.evaluate(async () => {
      const model = await import('./core/model.js');
      const store = await import('./ui/store.js');
      const { state } = await import('./ui/state.js');
      const project = model.createProject('Автомеблировка дома');
      const second = model.createLevel('2 этаж', 3000, 3000, 'L2');
      project.levels.push(second);
      const dining = model.createRoom('dining', 0, 0, 6500, 5000);
      const bedroom = model.createRoom('bedroom', 0, 0, 6200, 5000);
      project.levels[0].rooms.push(dining);
      project.levels[0].openings.push(model.createOpening('door', dining.id, 2, 3250, 900));
      second.rooms.push(bedroom);
      second.openings.push(model.createOpening('door', bedroom.id, 2, 3100, 900));
      project.layoutBrief = {
        version: 1,
        actors: [{
          id: 'actor-1', alias: 'Жилец 1', heightMm: 1750, mobilityProfile: 'standard',
          bodyWidthMm: 500, bodyDepthMm: 350, carriedObjectIds: [], dataStatus: 'declared',
        }],
        capacity: { dailySeats: 4, guestSeats: 4 },
        fixedEngineering: [], storageInventory: [], uncertainty: [],
      };
      state.project = project;
      store.refreshDerived();
      return { roomId: dining.id };
    });
    await selectRoom(app.page, setup.roomId);
    assert.equal(await app.page.locator('#arrangeWholeHomeBtn').count(), 1);
    assert.equal(await app.page.evaluate(() => window.__kepler.state.project.levels.flatMap((level) => level.items).length), 0);

    await app.page.locator('[data-layout-brief] > summary').click();
    await app.page.locator('[data-brief-section="scenarios"] > summary').click();
    await app.page.selectOption('[data-scenario-id="SCN003"]', 'required');
    await app.page.waitForFunction(() => window.__kepler.state.project.layoutBrief?.scenarioSelections
      ?.some((entry) => entry.scenarioId === 'SCN003' && entry.enabled === true && entry.mandatory === true));

    await app.page.click('#arrangeWholeHomeBtn');
    await app.page.waitForFunction(() => document.querySelectorAll('[data-whole-home-variant]').length >= 1);
    assert.equal(await app.page.evaluate(() => window.__kepler.state.project.levels.flatMap((level) => level.items).length), 0,
      'предпросмотр всего дома не меняет проект');

    await app.page.locator('[data-whole-home-apply]').first().click();
    await app.page.waitForFunction(() => window.__kepler.state.project.levels.every((level) => level.items.length > 0));
    const applied = await app.page.evaluate(() => window.__kepler.state.project.levels.map((level) => level.items.length));
    assert.ok(applied.every((count) => count > 0));

    await app.page.keyboard.press('Control+z');
    await app.page.waitForFunction(() => window.__kepler.state.project.levels.every((level) => level.items.length === 0));
    assert.deepEqual(app.errors, []);
  });
});
