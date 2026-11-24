import assert from 'node:assert/strict';
import { test } from 'node:test';
import { openNew, startApp } from './helpers.mjs';

for (const mobile of [false, true]) {
  test(`Фасад · ${mobile ? 'телефон' : 'компьютер'} · размещение на стену и свойства`, async () => {
    const app = await startApp({ mobile });
    const { page } = app;
    const press = (sel) => mobile ? page.tap(sel) : page.click(sel);
    const point = ({ x, y }) => mobile ? page.touchscreen.tap(x, y) : page.mouse.click(x, y);
    const facadeList = () => page.evaluate(() => window.__kepler.state.project.masses || []);
    try {
      await openNew(page);
      await page.evaluate(async () => {
        const { createRoom } = await import('./core/model.js');
        const { mutate } = await import('./ui/store.js');
        const { project } = window.__kepler.state;
        mutate(() => { project.rooms = [createRoom('living', 0, 0, 7000, 5000)]; });
      });
      await press('#view3dBtn');
      await press('.v3-facade summary');
      assert.equal(await page.locator('[data-facade-kind]:visible').count(), 5);
      await press('[data-facade-kind="stone"]');
      const wall = await page.evaluate(async () => {
        const { screen3d, pick3d, state, debug3d } = window.__kepler;
        const { pickBoxes, pickWall, screenRay } = await import('./core/pick3d.js');
        const cam = debug3d().cam;
        const box = document.querySelector('#canvas3d').getBoundingClientRect();
        const { walls } = pickBoxes(state.project);
        for (const [x, y] of [[3500, -250], [-250, 2500], [3500, 5250], [7250, 2500]]) {
          const p = screen3d({ x, y, z: 1500 });
          if (document.elementFromPoint(p.x, p.y)?.id !== 'canvas3d') continue;
          if (pick3d(p.x, p.y)?.face !== 'side') continue;
          const hit = pickWall(walls, screenRay(cam, box.width, box.height, p.x - box.left, p.y - box.top));
          if (hit && hit.normal[hit.orient === 'h' ? 'y' : 'x'] === hit.box.facadeOutward) return p;
        }
        return null;
      });
      assert.ok(wall, 'виден наружный бок стены');
      await point(wall);
      let masses = await facadeList();
      assert.equal(masses.length, 1, await page.locator('#v3Hint').innerText());
      assert.equal(masses[0].facadeKind, 'stone');
      assert.ok(masses[0].facadeHost?.roomId);
      if (mobile) await press('#mobileBar [data-sheet="props"]');
      const finish = page.locator('#facadeFinish:visible');
      await finish.selectOption({ label: 'Сланец' });
      masses = await facadeList();
      assert.equal(masses[0].color, '#626669');
      await press('#massCopy:visible');
      assert.equal((await facadeList()).length, 2);
      await press('#massDelete:visible');
      assert.equal((await facadeList()).length, 1);
      if (!mobile) {
        await page.keyboard.press('Control+z');
        assert.equal((await facadeList()).length, 2);
        const beforeMove = (await facadeList())[0];
        await page.evaluate(async () => {
          const { mutate } = await import('./ui/store.js');
          const { project } = window.__kepler.state;
          mutate(() => { project.rooms[0].x += 600; });
        });
        assert.equal((await facadeList())[0].x, beforeMove.x + 600);
        await page.keyboard.press('Control+z');
        assert.equal((await facadeList())[0].x, beforeMove.x);
      }
      if (!mobile) {
        await press('.v3-facade summary');
        await press('[data-facade-kind="light"]');
        const surface = await page.evaluate((p) => {
          const k = window.__kepler;
          for (let dy = -4; dy <= 4; dy += 2) {
            for (let dx = -4; dx <= 4; dx += 2) {
              if (k.pick3d(p.x + dx, p.y + dy)?.type === 'mass') return { x: p.x + dx, y: p.y + dy };
            }
          }
          return null;
        }, wall);
        assert.ok(surface, 'видна установленная каменная отделка');
        await point(surface);
        const light = (await facadeList()).find((m) => m.facadeKind === 'light');
        assert.ok(light?.facadeHost, 'световая полоса прикреплена поверх облицовки');
        assert.ok(Math.abs(light.facadeHost.offset) >= 48);
        await press('#massDelete:visible');
        const use = async (kind) => {
          await press('.v3-facade summary');
          await press(`[data-facade-kind="${kind}"]`);
        };
        await use('band');
        await point(surface);
        const band = (await facadeList()).find((m) => m.facadeKind === 'band');
        assert.ok(band?.w >= 5500);
        assert.ok(Number.isFinite(band.facadeHost.bandAnchor));
        await press('#massDelete:visible');
        await use('canopy');
        await point(surface);
        const canopy = (await facadeList()).find((m) => m.facadeKind === 'canopy');
        assert.ok(canopy);
        await use('light');
        const cap = await page.evaluate((m) => window.__kepler.screen3d({ x: m.x, y: m.y, z: m.z0 + m.h }), canopy);
        await page.mouse.move(cap.x, cap.y);
        await point(cap);
        const strip = (await facadeList()).find((m) => m.canopyId === canopy.id);
        assert.equal(strip?.z0 + strip?.h, canopy.z0);
        assert.equal(strip?.w, canopy.w);
      }
      assert.deepEqual(app.errors, []);
    } finally { await app.close(); }
  });
}
