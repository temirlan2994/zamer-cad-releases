import assert from 'node:assert/strict';
import { test } from 'node:test';
import { openNew, pickWorkspaceView, settleView, startApp, with3dLayers, worldToClient } from './helpers.mjs';

const objects = (page) => page.evaluate(() => window.__kepler.state.project.site.landscape.objects);

async function point(page, x, y) {
  const at = await worldToClient(page, x, y);
  await page.mouse.move(at.x, at.y);
  await page.mouse.click(at.x, at.y);
}

test('единый маршрут: профиль, границы участков, подсветка в 3D и отмена', async () => {
  const app = await startApp({ width: 1440, height: 900 });
  const { page } = app;
  try {
    await openNew(page);
    await page.click('#landscapeBtn');
    await page.click('[data-ls-quick="route"]');
    for (const [x, y] of [[-5_300, -1_800], [-1_100, -1_800], [-1_100, 2_600], [4_200, 2_600]]) {
      await point(page, x, y);
    }
    await page.locator('[data-route-level="2"]').fill('700');
    await page.locator('[data-route-level="2"]').press('Tab');
    const node = page.locator('#lsRouteProfile [data-route-node="2"] circle').first();
    const center = await node.boundingBox();
    const hit = await page.evaluate(({ x, y, width, height }) => (
      document.elementFromPoint(x + width / 2, y + height / 2)?.outerHTML.slice(0, 200)
    ), center);
    assert.match(hit, /<circle/);
    await page.mouse.move(center.x + center.width / 2, center.y + center.height / 2);
    await page.mouse.down();
    await page.mouse.move(center.x + center.width / 2, center.y + center.height / 2 - 7, { steps: 5 });
    await page.mouse.up();
    const level = await page.locator('[data-route-level="2"]').inputValue();
    assert.ok(Number(level) > 700, `Отметка после перетаскивания: ${level}`);
    const second = page.locator('[data-route-section="1"]');
    if (await second.getAttribute('open') === null) await second.locator('summary').click();
    await second.locator('[data-route-field="kind"]').selectOption('stairs');
    await second.locator('[data-route-field="width"]').fill('2400');
    await second.locator('[data-route-field="width"]').press('Tab');
    const third = page.locator('[data-route-section="2"]');
    await third.locator('[data-route-field="kind"]').selectOption('slabs');
    await third.locator('[data-route-field="stagger"]').check();
    await page.locator('#lsRouteLightSide').selectOption('both');

    const folder = process.env.KEPLER_OUTDOOR_SCREENSHOT_DIR;
    if (folder) await page.screenshot({ path: folder + '/outdoor-route-plan.png' });
    await page.click('#lsRouteFinish');
    const route = await objects(page);
    assert.equal(route.find((item) => item.kind === 'stairs-out')?.w, 2400);
    assert.ok(route.some((item) => item.kind === 'path' && item.meta?.staggerSlabs));
    assert.ok(route.some((item) => item.kind === 'paving-area'));
    assert.ok(route.filter((item) => item.kind === 'lamp').length >= 6);
    await page.click('#view3dBtn');
    await page.click('#v3Fit');
    await with3dLayers(page, () => page.locator('#v3Evening').check());
    await page.evaluate(() => window.__kepler.select(null));
    await settleView(page);
    if (folder) await page.screenshot({ path: folder + '/outdoor-route-evening.png' });
    await page.keyboard.press('Control+z');
    assert.equal((await objects(page)).length, 0);
    assert.deepEqual(app.errors, []);
  } finally {
    await app.close();
  }
});

test('ландшафт: лестница по двум отметкам, дорожка по земле и плиты на одной высоте', async () => {
  const app = await startApp({ width: 1440, height: 900 });
  const { page } = app;
  try {
    await openNew(page);
    await page.evaluate(async () => {
      const { mutate } = await import('./ui/store.js');
      const { createLandscapeObject } = await import('./core/landscape.js');
      const { createTerrain } = await import('./core/terrain.js');
      const { state } = window.__kepler;
      const boundary = [{ x: -8000, y: -6000 }, { x: 8000, y: -6000 }, { x: 8000, y: 6000 }, { x: -8000, y: 6000 }];
      mutate(() => {
        state.project.site.boundary = boundary;
        state.project.site.terrain = { ...createTerrain(), points: boundary.map((p) => ({ ...p, z: p.x < 0 ? 0 : 1600 })) };
        state.project.site.landscape ??= { objects: [] };
        state.project.site.landscape.objects.push(createLandscapeObject('pond-area', 2600, 0, {
          points: [{ x: 1400, y: -3400 }, { x: 4800, y: -3400 }, { x: 4800, y: 2800 }, { x: 1400, y: 2800 }],
        }));
      });
    });
    await page.click('#landscapeBtn');
    await page.click('[data-ls-quick="stairs"]');
    await page.locator('#lsFlightLanding').fill('1200');
    await page.locator('#lsFlightLanding').press('Tab');
    await point(page, -5000, 1600);
    assert.equal((await objects(page)).length, 1);
    await point(page, 1000, 1600);

    const stair = (await objects(page)).find((o) => o.kind === 'stairs-out');
    assert.ok(stair);
    assert.equal(stair.variant, 'graphite');
    assert.equal(stair.w, 2400);
    assert.equal(stair.meta.landing, 1200);
    assert.ok(Math.abs(stair.height - 600) < 30, String(stair.height));
    assert.ok(Math.abs(stair.h - 6000) < 50, String(stair.h));
    await page.keyboard.press('Control+z');
    assert.ok(!(await objects(page)).some((o) => o.id === stair.id));
    await page.keyboard.press('Control+Shift+z');
    assert.ok((await objects(page)).some((o) => o.id === stair.id));
    await page.evaluate((id) => window.__kepler.select({ type: 'landscape', ids: [id] }), stair.id);
    await page.locator('#lsStLanding').fill('1500');
    await page.locator('#lsStLanding').press('Tab');
    const edited = (await objects(page)).find((o) => o.id === stair.id);
    assert.equal(edited.h - stair.h, 300);
    assert.ok(Math.abs((edited.x + edited.h / 2) - (stair.x + stair.h / 2)) < 2, 'верхний край остался на месте');

    await page.click('[data-ls-quick="terrain"]');
    await point(page, -5300, -1400);
    await point(page, -2600, -2400);
    await point(page, 900, -2100);
    await page.keyboard.press('Enter');
    await page.click('[data-ls-quick="floating"]');
    await page.locator('#lsElev').fill('400');
    await page.locator('#lsElev').press('Tab');
    await point(page, 3200, -4400);
    await point(page, 3200, 3900);
    await page.keyboard.press('Enter');

    const [groundPath, bridge] = (await objects(page)).filter((o) => o.kind === 'path');
    assert.equal(groundPath.meta.pathLevel, 'terrain');
    assert.equal(groundPath.points.length, 3);
    assert.equal(bridge.meta.pathLevel, 'fixed');
    assert.equal(bridge.elev, 400);
    assert.equal(bridge.gap, 140);

    const result = await page.evaluate(async ({ stairId, groundId, bridgeId }) => {
      const { buildHouseMesh } = await import('./core/mesh3d.js');
      const { serializeProject, deserializeProject } = await import('./core/model.js');
      const { stairsInfo, stairTreads } = await import('./core/landscape.js');
      const { sectionProfile } = await import('./core/landscape-section.js');
      const { state } = window.__kepler;
      const model = deserializeProject(serializeProject(state.project));
      const faces = buildHouseMesh(model, { site: true, landscape: true });
      const topZ = (id) => [...new Set(faces.filter((f) => f.landscapeId === id && f.normal.z > 0.9)
        .flatMap((f) => f.pts.map((p) => p.z)))];
      const stair = model.site.landscape.objects.find((o) => o.id === stairId);
      const section = (points, id) => sectionProfile(model, points).prims
        .filter((p) => p.id === id && p.cut && p.shape === 'poly')
        .map((p) => Math.max(...p.pts.map((q) => q.z)));
      return {
        terrainZ: topZ(groundId), bridgeZ: topZ(bridgeId), staircaseZ: topZ(stairId),
        info: stairsInfo(stair), treads: stairTreads(stair),
        stairSection: section([{ x: -7000, y: stair.y }, { x: 1200, y: stair.y }], stairId),
        bridgeSection: section([{ x: 3200, y: -5000 }, { x: 3200, y: 4600 }], bridgeId),
      };
    }, { stairId: stair.id, groundId: groundPath.id, bridgeId: bridge.id });
    assert.ok(result.terrainZ.length > 4, 'дорожка считывает промежуточные отметки');
    assert.equal(result.bridgeZ.length, 1, 'верх всех плит на общей отметке');
    assert.ok(result.bridgeSection.length > 2);
    assert.ok(result.bridgeSection.every((z) => z === result.bridgeZ[0]));
    assert.ok(result.stairSection.length > 2);
    assert.ok(Math.abs(Math.max(...result.stairSection) - Math.max(...result.staircaseZ)) < 1);
    assert.ok(result.treads.some(({ top, bottom }) => bottom - top > result.info.tread + 1100));

    if (process.env.KEPLER_OUTDOOR_SCREENSHOT_DIR) {
      const folder = process.env.KEPLER_OUTDOOR_SCREENSHOT_DIR;
      await page.mouse.move(0, 0);
      await page.screenshot({ path: folder + '/outdoor-stairs-plan.png' });
      await page.click('#view3dBtn');
      await page.click('#v3Fit');
      await page.evaluate(() => window.__kepler.select(null));
      const canvas = await page.locator('#canvas3d').boundingBox();
      await page.mouse.move(canvas.x + canvas.width / 2, canvas.y + canvas.height / 2);
      await page.mouse.wheel(0, -225);
      await page.mouse.move(0, 0);
      await settleView(page);
      await page.screenshot({ path: folder + '/outdoor-stairs-3d.png' });
    }
    assert.deepEqual(app.errors, []);
  } finally {
    await app.close();
  }
});

test('телефон: лестница и дорожка создаются касаниями из каталога ландшафта', async () => {
  const app = await startApp({ mobile: true });
  const { page } = app;
  try {
    await openNew(page);
    await pickWorkspaceView(page, 'model', 'landscape');
    await page.tap('#mobileBar [data-sheet="rooms"]');
    await page.tap('[data-ls-quick="stairs"]');
    const canvas = await page.locator('#canvas').boundingBox();
    const y = canvas.y + canvas.height / 2;
    await page.touchscreen.tap(canvas.x + 100, y);
    await page.touchscreen.tap(canvas.x + 180, y);
    const [stair] = await objects(page);
    assert.equal(stair.kind, 'stairs-out');
    assert.equal(stair.height, 450);
    await page.tap('#mobileBar [data-sheet="rooms"]');
    await page.tap('[data-ls-quick="terrain"]');
    await page.touchscreen.tap(canvas.x + 100, y + 70);
    await page.touchscreen.tap(canvas.x + 180, y + 85);
    await page.tap('#toolDone');
    assert.ok((await objects(page)).some((o) => o.kind === 'path' && o.meta?.pathLevel === 'terrain'));
    await page.tap('#mobileBar [data-sheet="rooms"]');
    await page.tap('[data-ls-quick="route"]');
    await page.touchscreen.tap(canvas.x + 100, y - 90);
    await page.touchscreen.tap(canvas.x + 190, y - 75);
    await page.locator('#lsRouteProfile').waitFor();
    await page.tap('#toolDone');
    assert.equal((await objects(page)).filter((o) => o.kind === 'path').length, 2);
    assert.deepEqual(app.errors, []);
  } finally {
    await app.close();
  }
});
