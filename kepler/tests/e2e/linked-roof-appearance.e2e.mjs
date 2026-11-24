// Две одинаковые комнаты и два штатных пути создания. Сравниваем материал
// на экране, чтобы тест заметил расхождение также в выбранном 3D-рендерере.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { openNew, settleView, startApp, worldToClient } from './helpers.mjs';

test('Крыши из комнаты и инструмента K имеют одинаковый графитовый профиль и выбираются в 3D', async () => {
  const app = await startApp({ width: 1340, height: 818 });
  const { page } = app;
  try {
    await openNew(page);
    const origin = await worldToClient(page, 0, 0);
    await page.mouse.move(origin.x, origin.y);
    for (let i = 0; i < 6; i++) {
      await page.mouse.wheel(0, 170);
      await settleView(page);
    }
    for (const x of [-5000, 4500]) {
      await page.click('#boundRoomBtn');
      await page.click('#roomCards [data-type="living"]');
      const center = await worldToClient(page, x, 0);
      await page.mouse.click(center.x, center.y);
      await page.keyboard.press('Escape');
    }
    await page.keyboard.press('KeyK');
    const center = await worldToClient(page, 4500, 0);
    await page.mouse.click(center.x, center.y);
    await page.waitForFunction(() => window.__kepler.state.project.roofs.length === 1);
    await page.keyboard.press('Escape');
    await page.click('#view3dBtn');
    await page.click('.v3-views summary');
    await page.click('[data-v3-preset="top"]');
    await page.click('#v3Fit');
    await page.mouse.move(0, 0);
    await settleView(page);

    const targets = await page.evaluate(async () => {
      const { linkedRoofFaces, roofFaces } = await import('./core/mesh3d.js');
      const { state, screen3d, pick3d } = window.__kepler;
      const project = state.project;
      return [linkedRoofFaces(project), roofFaces(project)].map((faces, i) => {
        const r = project.rooms[i];
        const caps = (kind) => faces.filter((face) => face.kind === kind && face.normal.z > 0.9);
        const top = caps('roof')[0];
        const centerPoint = screen3d({ x: r.x + r.w / 2, y: r.y + r.h / 2, z: top.pts[0].z });
        const rim = caps('parapet').map((face) => {
          const p = face.pts.reduce((a, v) => ({ x: a.x + v.x, y: a.y + v.y }), { x: 0, y: 0 });
          return screen3d({ x: p.x / face.pts.length, y: p.y / face.pts.length, z: face.pts[0].z });
        }).find((p) => document.elementFromPoint(p.x, p.y)?.id === 'canvas3d' && pick3d(p.x, p.y)?.id === top.roofId);
        return { id: top.roofId, color: top.color, center: centerPoint, rim,
          heights: ['roof', 'fascia', 'parapet'].map((kind) => Math.max(...caps(kind).map((f) => f.pts[0].z))) };
      });
    });
    const [linked, manual] = targets;
    assert.equal(linked.color, manual.color);
    assert.equal(linked.color, '#3d4148');
    assert.deepEqual(linked.heights, manual.heights);
    assert.ok(linked.heights[1] > linked.heights[0]);
    assert.ok(linked.heights[2] > linked.heights[1]);
    assert.ok(linked.rim && manual.rim, 'верх бортика доступен в обоих способах создания');

    const pixels = await page.evaluate(async ({ image, centers }) => {
      const frame = new Image();
      frame.src = 'data:image/png;base64,' + image;
      await frame.decode();
      const canvas = document.createElement('canvas');
      canvas.width = frame.width;
      canvas.height = frame.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(frame, 0, 0);
      return centers.map((p) => [...ctx.getImageData(Math.round(p.x), Math.round(p.y), 1, 1).data.slice(0, 3)]);
    }, { image: (await page.screenshot()).toString('base64'), centers: targets.map((v) => v.center) });
    assert.deepEqual(pixels[0], pixels[1], 'цвет покрытия в кадре при одинаковом освещении');
    assert.ok(Math.max(...pixels[0]) < 120, 'центр покрытия тёмный');
    for (const { id, rim } of targets) {
      await page.mouse.click(rim.x, rim.y);
      assert.deepEqual(await page.evaluate(() => window.__kepler.state.selection), { type: 'roof', id });
    }
    await page.mouse.click(linked.center.x, linked.center.y);
    await page.selectOption('#linkedRoofMaterial', 'wood');
    await page.fill('#linkedRoofParapet', '0');
    await page.press('#linkedRoofParapet', 'Tab');
    await page.reload();
    await page.waitForFunction(() => window.__kepler?.state.project?.rooms.length === 2);
    const reloaded = await page.evaluate(async () => {
      const { linkedRoofFaces, roofFaces } = await import('./core/mesh3d.js');
      const project = window.__kepler.state.project;
      return [linkedRoofFaces(project), roofFaces(project)].map((faces) => ({
        color: faces.find((f) => f.kind === 'roof').color, parapet: faces.some((f) => f.kind === 'parapet'),
      }));
    });
    assert.deepEqual(reloaded, [{ color: '#a8794b', parapet: false }, { color: '#3d4148', parapet: true }]);
    assert.equal(await page.evaluate(() => window.__kepler.state.project.roofs.length), 1);
    assert.deepEqual(app.errors, []);
  } finally { await app.close(); }
});
