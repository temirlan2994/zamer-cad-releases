import assert from 'node:assert/strict';
import { test } from 'node:test';
import { openNew, pickWorkspaceView, settleView, startApp, worldToClient } from './helpers.mjs';

async function placeLivingRoom(page, mobile) {
  if (mobile) {
    await page.tap('#mobileBar [data-sheet="rooms"]');
    await page.tap('#mobileCat [data-cat="room"]');
    await page.tap('#roomCards .room-card[data-type="living"]');
  } else {
    await page.click('#boundRoomBtn');
    await page.click('#roomCards .room-card[data-type="living"]');
  }
  const { x, y } = await worldToClient(page, 0, 0);
  if (mobile) await page.touchscreen.tap(x, y);
  else await page.mouse.click(x, y);
  await page.waitForFunction(() => window.__kepler.state.project.rooms.length === 1);
}

// Выбираем точку на фактическом верхнем скате. Проверяем результат клика
// отдельно, чтобы перебор позиций не мог скрыть ошибку hit testing.
async function roofSurfacePoint(page) {
  await settleView(page);
  return page.evaluate(async () => {
    const { linkedRoofFaces } = await import('./core/mesh3d.js');
    const { state, screen3d } = window.__kepler;
    const canvas = document.getElementById('canvas3d');
    const groups = linkedRoofFaces(state.project).filter((face) => face.roofSurface === 'top');
    for (const face of groups) {
      const p = Object.fromEntries(['x', 'y', 'z'].map((axis) =>
        [axis, face.pts.reduce((sum, v) => sum + v[axis], 0) / face.pts.length]));
      const s = screen3d(p);
      if (document.elementFromPoint(s.x, s.y) === canvas) return s;
    }
    return null;
  });
}

async function levelsCoveredAt(page, x, y) {
  return page.evaluate(async (point) => {
    const { linkedRoofFaces } = await import('./core/mesh3d.js');
    const { pointInPolygon } = await import('./core/zamer/geometry.js');
    const faces = linkedRoofFaces(window.__kepler.state.project);
    return [...new Set(faces.filter((f) => f.roofSurface === 'top' && pointInPolygon(point, f.pts)).map((f) => f.level))];
  }, { x, y });
}

test('Из каталога в 3D · крыша двух этажей подрезается, выбирается и отменяется отдельно от перекрытия', async () => {
  const app = await startApp();
  const { page } = app;
  try {
    await openNew(page);
    await placeLivingRoom(page, false);
    const lower = await page.evaluate(() => window.__kepler.state.project.rooms[0]);
    const firstLevel = await page.evaluate(() => window.__kepler.state.project.activeLevel);
    const y = lower.y + lower.h * 0.43;
    const covered = lower.x + lower.w * 0.23;
    const exposed = lower.x + lower.w * 0.82;
    assert.deepEqual(await levelsCoveredAt(page, exposed, y), [firstLevel]);

    await page.click('#roomAbove');
    const secondLevel = await page.evaluate(() => window.__kepler.state.project.activeLevel);
    assert.notEqual(secondLevel, firstLevel);
    assert.deepEqual(await levelsCoveredAt(page, covered, y), [secondLevel]);
    assert.deepEqual(await levelsCoveredAt(page, exposed, y), [secondLevel]);
    await page.fill('#roomW', String(Math.round(lower.w / 2)));
    await page.press('#roomW', 'Tab');
    assert.deepEqual(await levelsCoveredAt(page, exposed, y), [firstLevel], 'Открытый участок внизу снова накрыт');
    assert.deepEqual(await levelsCoveredAt(page, covered, y), [secondLevel], 'Под комнатой наверху нет кровли нижнего этажа');

    const slabCount = () => page.evaluate(async () => {
      const { floorSlabFaces } = await import('./core/mesh3d.js');
      return floorSlabFaces(window.__kepler.state.project).length;
    });
    const slabs = await slabCount();
    assert.ok(slabs > 0);
    await pickWorkspaceView(page, 'plans', 'roofplan');
    const at = await worldToClient(page, exposed, y);
    await page.mouse.click(at.x, at.y);
    assert.equal(await page.evaluate(() => window.__kepler.state.selection?.type), 'roof');
    await page.click('#roofDelete');
    assert.deepEqual(await levelsCoveredAt(page, exposed, y), []);
    assert.deepEqual(await levelsCoveredAt(page, covered, y), [secondLevel]);
    assert.equal(await slabCount(), slabs, 'Оба перекрытия остаются в модели');
    await page.click('#undoBtn');
    assert.deepEqual(await levelsCoveredAt(page, exposed, y), [firstLevel]);
    await page.click('#redoBtn');
    assert.deepEqual(await levelsCoveredAt(page, exposed, y), []);

    await pickWorkspaceView(page, 'plans', 'plan:' + firstLevel);
    const roomPoint = await worldToClient(page, lower.x + lower.w * 0.7, y);
    await page.mouse.click(roomPoint.x, roomPoint.y);
    await page.click('#roomRoofBtn');
    assert.deepEqual(await levelsCoveredAt(page, exposed, y), [firstLevel]);
    assert.deepEqual(await levelsCoveredAt(page, covered, y), [secondLevel]);
    assert.deepEqual(app.errors, []);
  } finally { await app.close(); }
});

test('Телефон · первое помещение сразу получает выбираемую в 3D крышу, удаление переживает перезагрузку', async () => {
  const app = await startApp({ mobile: true });
  const { page } = app;
  try {
    await openNew(page);
    await placeLivingRoom(page, true);
    const room = await page.evaluate(() => window.__kepler.state.project.rooms[0]);
    const x = room.x + room.w * 0.4;
    const y = room.y + room.h * 0.6;
    await page.tap('#view3dBtn');
    await page.tap('.v3-views summary');
    await page.tap('[data-v3-preset="top"]');
    const at = await roofSurfacePoint(page);
    assert.ok(at, 'В 3D видна поверхность крыши');
    await page.touchscreen.tap(at.x, at.y);
    const selected = await page.evaluate(() => window.__kepler.state.selection);
    assert.equal(selected?.type, 'roof', 'Касание покрытия выбирает крышу');
    await page.tap('#mobileBar [data-sheet="props"]');
    await page.tap('#roofDelete');
    assert.deepEqual(await levelsCoveredAt(page, x, y), []);
    await page.waitForFunction(async (roomId) => {
      const { getScopedItem } = await import('./ui/storage-scope.js');
      const save = getScopedItem('kepler-plan-autosave');
      if (!save) return false;
      const { deserializeProject } = await import('./core/model.js');
      return deserializeProject(save).rooms.some((r) => r.id === roomId && r.linkedRoof === false);
    }, room.id);
    await page.reload();
    await page.waitForFunction((id) => window.__kepler?.state.project?.rooms.some((r) => r.id === id), room.id);
    assert.deepEqual(await levelsCoveredAt(page, x, y), [], 'Удалённая крыша не появляется заново при открытии');
    assert.deepEqual(app.errors, []);
  } finally { await app.close(); }
});

test('Смежные комнаты · удалить и восстановить покрытие только выбранной комнаты', async () => {
  const app = await startApp();
  const { page } = app;
  try {
    await openNew(page);
    await placeLivingRoom(page, false);
    const first = await page.evaluate(() => window.__kepler.state.project.rooms[0]);
    await page.keyboard.press('Escape');
    await page.click('#boundRoomBtn');
    await page.click('#roomCards .room-card[data-type="living"]');
    const y = first.y + first.h / 2;
    const at = await worldToClient(page, first.x + 1.5 * first.w + 100, y);
    await page.mouse.click(at.x, at.y);
    const second = await page.evaluate(() => window.__kepler.state.project.rooms[1]);
    assert.ok(second);
    const firstCenter = first.x + first.w * 0.44;
    const secondCenter = second.x + second.w * 0.44;
    const level = await page.evaluate(() => window.__kepler.state.project.activeLevel);
    assert.deepEqual(await levelsCoveredAt(page, firstCenter, y), [level]);
    assert.deepEqual(await levelsCoveredAt(page, secondCenter, y), [level]);

    await page.click('#roomRoofRemove');
    assert.deepEqual(await levelsCoveredAt(page, firstCenter, y), [level]);
    assert.deepEqual(await levelsCoveredAt(page, secondCenter, y), []);
    await page.click('#roomRoofBtn');
    assert.deepEqual(await levelsCoveredAt(page, secondCenter, y), [level]);
    assert.equal(await page.evaluate(() => window.__kepler.state.project.roofs?.length || 0), 0,
      'Восстановление связанного покрытия не создаёт второй ручной крыши');
    assert.deepEqual(app.errors, []);
  } finally { await app.close(); }
});
