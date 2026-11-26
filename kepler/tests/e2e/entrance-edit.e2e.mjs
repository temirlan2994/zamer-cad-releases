import assert from 'node:assert/strict';
import { test } from 'node:test';
import { openNew, pickWorkspaceView, settleView, startApp, worldToClient } from './helpers.mjs';

test('крыльцо выбирается в 3D: размеры и материал, сохранение и удаление без двери', async () => {
  const app = await startApp({ width: 1440, height: 900 });
  const { page } = app;
  try {
    await openNew(page);
    await page.evaluate(async () => {
      const { createRoom, createOpening } = await import('./core/model.js');
      const { mutate } = await import('./ui/store.js');
      const { state } = window.__kepler;
      mutate(() => {
        state.project.envelope.zeroAboveGround = 900;
        const room = createRoom('entrance', 0, 0, 5000, 4000);
        const door = createOpening('door', room.id, 2, 2500, 1000);
        door.id = 'front-door'; door.entryRole = 'main';
        state.project.rooms.push(room); state.project.openings.push(door);
      });
    });
    await page.click('#view3dBtn');
    await page.click('.v3-views summary');
    await page.click('[data-v3-preset="top"]');
    await page.click('#v3Fit');
    await settleView(page);
    const target = await page.evaluate(async () => {
      const { entranceFaces } = await import('./core/mesh3d.js');
      const k = window.__kepler;
      return entranceFaces(k.state.project).filter((f) => f.normal.z > .9).map((f) => {
        const center = f.pts.reduce((a, p) => ({ x: a.x + p.x / f.pts.length, y: a.y + p.y / f.pts.length, z: a.z + p.z / f.pts.length }), { x: 0, y: 0, z: 0 });
        return k.screen3d(center);
      }).find((p) => document.elementFromPoint(p.x, p.y)?.id === 'canvas3d' && k.pick3d(p.x, p.y)?.type === 'entrance');
    });
    assert.ok(target, 'поверхность лестницы доступна для выбора');
    await page.mouse.click(target.x, target.y);
    assert.deepEqual(await page.evaluate(() => window.__kepler.state.selection), { type: 'entrance', id: 'front-door' });
    for (const [key, value] of [['width', '3200'], ['landingDepth', '2200'], ['tread', '400']]) {
      await page.locator(`[data-porch-field="${key}"]`).fill(value);
      await page.locator(`[data-porch-field="${key}"]`).press('Tab');
    }
    await page.uncheck('#porchAutoSteps');
    await page.fill('#porchStepCount', '4');
    await page.press('#porchStepCount', 'Tab');
    await page.selectOption('#porchMaterial', 'graphite');
    const result = await page.evaluate(async () => {
      const { deriveEntrances } = await import('./core/entrance.js');
      const { entranceFaces } = await import('./core/mesh3d.js');
      const { serializeProject, deserializeProject } = await import('./core/model.js');
      const project = deserializeProject(serializeProject(window.__kepler.state.project));
      return { entry: deriveEntrances(project)[0], door: project.openings[0], colors: [...new Set(entranceFaces(project).map((f) => f.color))] };
    });
    assert.equal(result.entry.landing.width, 3200); assert.equal(result.entry.landing.depth, 2200);
    assert.equal(result.entry.steps.count, 4); assert.equal(result.entry.steps.run, 1600);
    assert.equal(result.door.width, 1000); assert.deepEqual(result.colors, ['#4d5254']);
    if (process.env.KEPLER_SHOTS) await page.screenshot({ path: `${process.env.KEPLER_SHOTS}/editable-porch.png` });
    await page.click('#porchDelete');
    assert.equal(await page.evaluate(() => window.__kepler.state.project.openings.length), 1);
    assert.equal(await page.evaluate(async () => (await import('./core/entrance.js')).deriveEntrances(window.__kepler.state.project).length), 0);
    await page.keyboard.press('Control+z');
    assert.equal(await page.evaluate(async () => (await import('./core/entrance.js')).deriveEntrances(window.__kepler.state.project)[0]?.landing.width), 3200);
    await page.evaluate(() => window.__kepler.select({ type: 'opening', id: 'front-door' }));
    await page.click('#editEntrance');
    await page.click('#porchReset');
    assert.equal(await page.locator('[data-porch-field="width"]').inputValue(), '1600');
    await page.reload();
    await page.waitForFunction(() => window.__kepler?.state.project?.openings.length === 1);
    assert.equal(await page.evaluate(async () => (await import('./core/entrance.js')).deriveEntrances(window.__kepler.state.project)[0]?.steps.count), 6);
    assert.deepEqual(app.errors, []);
  } finally { await app.close(); }
});

for (const mobile of [false, true]) test(`наружная лестница из каталога ландшафта${mobile ? ' на телефоне' : ''}`, async () => {
  const app = await startApp({ mobile });
  const { page } = app;
  try {
    await openNew(page);
    assert.equal(await page.locator('#outdoorStairsToolBtn').count(), 0);
    if (mobile) {
      await pickWorkspaceView(page, 'model', 'landscape');
      await page.tap('#mobileBar [data-sheet="rooms"]');
      await page.tap('[data-ls-quick="stairs"]');
    } else {
      await page.click('#landscapeBtn');
      await page.click('[data-ls-quick="stairs"]');
    }
    assert.equal(await page.evaluate(() => window.__kepler.state.modeName), 'landscape');
    assert.equal(await page.evaluate(() => window.__kepler.state.tool?.kind), 'ls-flight');
    const canvas = await page.locator('#canvas').boundingBox();
    const y = canvas.y + canvas.height / 2;
    const points = mobile ? [{ x: canvas.x + 100, y }, { x: canvas.x + 190, y }]
      : [await worldToClient(page, 0, 0), await worldToClient(page, 0, 3500)];
    for (const p of points) {
      if (mobile) await page.touchscreen.tap(p.x, p.y);
      else await page.mouse.click(p.x, p.y);
    }
    const stair = await page.evaluate(() => window.__kepler.state.project.site.landscape.objects[0]);
    assert.equal(stair.kind, 'stairs-out');
    assert.equal(await page.locator('#lsStLanding').count(), 1, 'параметры созданной лестницы доступны');
    await page.keyboard.press('Control+z');
    assert.equal(await page.evaluate(() => window.__kepler.state.project.site.landscape.objects.length), 0);
    assert.deepEqual(app.errors, []);
  } finally { await app.close(); }
});
