// e2e многовариантной авторасстановки: предпросмотр не меняет проект,
// применение отменяется одним шагом, закреплённая мебель не двигается,
// изменение формы автоматически перестраивает остальные предметы.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
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

async function canvasHash(page) {
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
  const png = await page.locator('#canvas').screenshot();
  return createHash('sha256').update(png).digest('hex');
}

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

  it('сохраняет число готовящих и подтверждение полной проекции в исходных данных', async () => {
    const { page } = app;
    await selectRoom(page, roomId);
    const before = await page.evaluate(async (id) => {
      const { itemsInRoom } = await import('./core/furnish.js');
      const { layoutSignature } = await import('./ui/auto-layout.js');
      const state = window.__kepler.state;
      const room = state.project.rooms.find((candidate) => candidate.id === id);
      return {
        itemId: itemsInRoom(state.project, room)[0].id,
        signature: layoutSignature(state.project, room),
      };
    }, roomId);

    const briefEditor = page.locator('[data-layout-brief]');
    if (!await briefEditor.evaluate((element) => element.open)) {
      await page.locator('[data-layout-brief] > summary').click();
    }
    const capacityEditor = page.locator('[data-brief-section="capacity"]');
    if (!await capacityEditor.evaluate((element) => element.open)) {
      await page.locator('[data-brief-section="capacity"] > summary').click();
    }
    await page.fill('[data-capacity="simultaneousCooks"]', '2');
    await page.dispatchEvent('[data-capacity="simultaneousCooks"]', 'change');
    await page.waitForFunction(() => window.__kepler.state.project.layoutBrief?.capacity?.simultaneousCooks === 2);

    const manualsEditor = page.locator('[data-brief-section="manuals"]');
    if (!await manualsEditor.evaluate((element) => element.open)) {
      await page.locator('[data-brief-section="manuals"] > summary').click();
    }
    const projection = page.locator(`[data-brief-item="${before.itemId}"] [data-item-plan-projection]`);
    await projection.check();
    await page.waitForFunction((itemId) => window.__kepler.state.project.items
      .find((item) => item.id === itemId)?.planProjectionVerified === true, before.itemId);

    const after = await page.evaluate(async ({ id }) => {
      const { layoutSignature } = await import('./ui/auto-layout.js');
      const state = window.__kepler.state;
      const room = state.project.rooms.find((candidate) => candidate.id === id);
      return layoutSignature(state.project, room);
    }, { id: roomId });
    assert.notEqual(after, before.signature, 'новые исходные данные входят в сигнатуру расчёта');
    assert.equal(await page.inputValue('[data-capacity="simultaneousCooks"]'), '2');
    assert.equal(await projection.isChecked(), true);

    // Тесты ниже используют тот же проект: детерминированно возвращаем оба
    // поля вместо зависимости от порядка глобального Undo-стека.
    await projection.uncheck();
    await page.waitForFunction((itemId) => window.__kepler.state.project.items
      .find((item) => item.id === itemId)?.planProjectionVerified !== true, before.itemId);
    await page.fill('[data-capacity="simultaneousCooks"]', '');
    await page.dispatchEvent('[data-capacity="simultaneousCooks"]', 'change');
    await page.waitForFunction(() => window.__kepler.state.project.layoutBrief?.capacity?.simultaneousCooks == null);
    if (await briefEditor.evaluate((element) => element.open)) {
      await page.locator('[data-layout-brief] > summary').click();
    }
    assert.equal(await page.locator('[data-layout-brief]').getAttribute('open'), null);
    assert.deepEqual(app.errors, []);
  });

  it('инвалидирует варианты по новым входам мебели, дверей и соседней геометрии', async () => {
    const signatures = await app.page.evaluate(async (id) => {
      const { layoutSignature } = await import('./ui/auto-layout.js');
      const { cloneProject } = await import('./core/model.js');
      const source = cloneProject(window.__kepler.state.project);
      const sign = (project) => layoutSignature(
        project,
        project.rooms.find((candidate) => candidate.id === id),
      );

      const nullOccupancy = cloneProject(source);
      nullOccupancy.items = [...(nullOccupancy.items || []), {
        id: 'signature-bed', kind: 'bed-double', x: -10000, y: -10000,
        w: 1600, h: 2000, rotation: 0, occupancyCount: null,
      }];
      const zeroOccupancy = cloneProject(nullOccupancy);
      zeroOccupancy.items.at(-1).occupancyCount = 0;

      const nullHandle = cloneProject(source);
      nullHandle.openings = [...(nullHandle.openings || []), {
        id: 'signature-door', kind: 'door', roomId: id, side: 0, offset: 500,
        width: 900, height: 2100, type: 'single', handleProjectionMm: null,
      }];
      const zeroHandle = cloneProject(nullHandle);
      zeroHandle.openings.at(-1).handleProjectionMm = 0;

      const plainItem = cloneProject(nullOccupancy);
      plainItem.items.at(-1).mirrored = false;
      const mirrored = cloneProject(plainItem);
      mirrored.items.at(-1).mirrored = true;
      const baseNeighbor = cloneProject(source);
      baseNeighbor.rooms.push({
        id: 'signature-neighbor', type: 'hall', x: 20000, y: 20000, w: 3000, h: 3000,
      });
      const neighboringRoom = cloneProject(baseNeighbor);
      neighboringRoom.rooms.at(-1).x += 1;

      return {
        nullOccupancy: sign(nullOccupancy), zeroOccupancy: sign(zeroOccupancy),
        nullHandle: sign(nullHandle), zeroHandle: sign(zeroHandle),
        plainItem: sign(plainItem), mirrored: sign(mirrored),
        baseNeighbor: sign(baseNeighbor), neighboringRoom: sign(neighboringRoom),
      };
    }, roomId);
    assert.notEqual(signatures.nullOccupancy, signatures.zeroOccupancy);
    assert.notEqual(signatures.nullHandle, signatures.zeroHandle);
    assert.notEqual(signatures.plainItem, signatures.mirrored);
    assert.notEqual(signatures.baseNeighbor, signatures.neighboringRoom);
  });

  it('строит варианты без мутации, применяет с Undo и соблюдает закрепление', async () => {
    const { page } = app;
    const initial = await roomItems(page, roomId);
    assert.ok(initial.length >= 2, `мебели в спальне: ${initial.length}`);
    const historyBeforePreview = await page.evaluate(async () => {
      const { history } = await import('./ui/state.js');
      return { undo: history.undo.length, redo: history.redo.length };
    });

    const ids = await buildVariants(page);
    assert.ok(ids.length >= 2);
    assert.deepEqual(await roomItems(page, roomId), initial, 'предпросмотр не меняет координаты');
    const canvasBeforePreview = await canvasHash(page);

    const previewButtons = page.locator('[data-layout-preview]');
    assert.equal(await previewButtons.count(), ids.length, 'у каждого варианта есть предпросмотр');
    await page.locator(`[data-layout-variant="${ids[0]}"] [data-layout-preview]`).click();
    await page.waitForFunction(({ expectedRoomId, expectedLayoutId }) => {
      const preview = window.__kepler.state.layoutPreview;
      return preview?.roomId === expectedRoomId
        && preview.layoutId === expectedLayoutId
        && Array.isArray(preview.items)
        && preview.items.length > 0;
    }, { expectedRoomId: roomId, expectedLayoutId: ids[0] });
    const firstPreview = await page.evaluate(() => {
      const preview = window.__kepler.state.layoutPreview;
      return {
        roomId: preview.roomId,
        layoutId: preview.layoutId,
        items: preview.items.map((item) => ({ id: item.id, x: item.x, y: item.y, rotation: item.rotation || 0 })),
      };
    });
    assert.equal(firstPreview.roomId, roomId);
    assert.equal(firstPreview.layoutId, ids[0]);
    assert.ok(firstPreview.items.every((item) => (
      item.id && [item.x, item.y, item.rotation].every(Number.isFinite)
    )));
    assert.deepEqual(await roomItems(page, roomId), initial, 'первый preview не меняет проект');
    assert.deepEqual(await page.evaluate(async () => {
      const { history } = await import('./ui/state.js');
      return { undo: history.undo.length, redo: history.redo.length };
    }), historyBeforePreview, 'первый preview не пишет историю');
    assert.notEqual(await canvasHash(page), canvasBeforePreview, 'preview действительно виден на плане');
    const firstCard = page.locator(`[data-layout-variant="${ids[0]}"]`);
    assert.equal(await firstCard.getAttribute('aria-current'), 'true');
    assert.equal(await firstCard.evaluate((element) => element.classList.contains('is-previewing')), true);
    assert.equal(await firstCard.locator('[data-layout-preview-close]').evaluate((element) => document.activeElement === element), true,
      'фокус остаётся на управлении активного варианта');

    await page.locator(`[data-layout-variant="${ids[1]}"] [data-layout-preview]`).click();
    await page.waitForFunction((expectedLayoutId) => (
      window.__kepler.state.layoutPreview?.layoutId === expectedLayoutId
    ), ids[1]);
    const secondCard = page.locator(`[data-layout-variant="${ids[1]}"]`);
    assert.notEqual(await firstCard.getAttribute('aria-current'), 'true');
    assert.equal(await firstCard.evaluate((element) => element.classList.contains('is-previewing')), false);
    assert.equal(await secondCard.getAttribute('aria-current'), 'true');
    assert.equal(await secondCard.evaluate((element) => element.classList.contains('is-previewing')), true);
    assert.equal(await secondCard.locator('[data-layout-preview-close]').evaluate((element) => document.activeElement === element), true,
      'при переключении фокус следует за активным вариантом');
    assert.deepEqual(await roomItems(page, roomId), initial, 'смена preview не меняет проект');
    assert.deepEqual(await page.evaluate(async () => {
      const { history } = await import('./ui/state.js');
      return { undo: history.undo.length, redo: history.redo.length };
    }), historyBeforePreview, 'смена preview не пишет историю');

    await secondCard.locator('[data-layout-preview-close]').click();
    await page.waitForFunction(() => window.__kepler.state.layoutPreview == null);
    assert.equal(await page.locator('.layout-variant.is-previewing').count(), 0);
    assert.equal(await secondCard.locator('[data-layout-preview]').evaluate((element) => document.activeElement === element), true,
      'после закрытия фокус возвращается к предпросмотру того же варианта');
    assert.equal(await canvasHash(page), canvasBeforePreview, 'закрытие возвращает исходное изображение плана');
    assert.deepEqual(await roomItems(page, roomId), initial, 'закрытие preview возвращает исходный вид без мутации');
    assert.deepEqual(await page.evaluate(async () => {
      const { history } = await import('./ui/state.js');
      return { undo: history.undo.length, redo: history.redo.length };
    }), historyBeforePreview, 'закрытие preview не пишет историю');

    await page.locator(`[data-layout-variant="${ids[1]}"] [data-layout-preview]`).click();
    await page.waitForFunction((expectedLayoutId) => (
      window.__kepler.state.layoutPreview?.layoutId === expectedLayoutId
    ), ids[1]);
    const selectedPreviewPose = await page.evaluate(() => window.__kepler.state.layoutPreview.items
      .map((item) => ({ id: item.id, x: item.x, y: item.y, rotation: item.rotation || 0 }))
      .sort((a, b) => a.id.localeCompare(b.id)));

    await applyVariant(page, 1);
    assert.equal(await page.evaluate(() => window.__kepler.state.layoutPreview), null, 'применение очищает preview');
    assert.deepEqual((await roomItems(page, roomId)).map(({ id, x, y, rotation }) => ({ id, x, y, rotation })), selectedPreviewPose,
      'применён именно показанный вариант');
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
        capacity: { dailySeats: 4, guestSeats: 4, simultaneousCooks: 1 },
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
