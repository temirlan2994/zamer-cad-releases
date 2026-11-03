// e2e 3D-просмотра: открытие, вращение, масштаб, крыша, закрытие по Esc.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, openSample } from './helpers.mjs';

const d3 = (page) => page.evaluate(() => window.__kepler.debug3d());

describe('3D', () => {
  let app;
  before(async () => { app = await startApp(); await openSample(app.page); });
  after(async () => { await app?.close(); });

  it('кнопка «3D» открывает вид с гранями дома', async () => {
    await app.page.click('#view3dBtn');
    assert.equal(await app.page.isVisible('#view3d'), true);
    const s = await d3(app.page);
    assert.equal(s.active, true);
    assert.ok(s.faces > 50, `граней ${s.faces}`);
    if (process.env.KEPLER_3D_OUT) {
      await app.page.waitForTimeout(150);
      await app.page.screenshot({ path: process.env.KEPLER_3D_OUT });
    }
  });

  it('мышь вращает, колесо приближает', async () => {
    const before = await d3(app.page);
    const box = await (await app.page.$('#canvas3d')).boundingBox();
    await app.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await app.page.mouse.down();
    await app.page.mouse.move(box.x + box.width / 2 + 120, box.y + box.height / 2 + 40, { steps: 6 });
    await app.page.mouse.up();
    await app.page.mouse.wheel(0, -300);
    const after = await d3(app.page);
    assert.ok(Math.abs(after.cam.yaw - before.cam.yaw) > 0.5);
    assert.ok(after.cam.pitch > before.cam.pitch);
    assert.ok(after.cam.dist < before.cam.dist);
  });

  it('крыша добавляет грани; Esc закрывает 3D', async () => {
    const without = (await d3(app.page)).faces;
    await app.page.check('#v3Roof');
    assert.ok((await d3(app.page)).faces > without);
    await app.page.keyboard.press('Escape');
    assert.equal(await app.page.isVisible('#view3d'), false);
    assert.equal((await d3(app.page)).active, false);
  });

  it('без ошибок в консоли', () => {
    assert.deepEqual(app.errors, []);
  });
});

describe('стены и колонны', () => {
  let app;
  before(async () => { app = await startApp(); await openSample(app.page); });
  after(async () => { await app?.close(); });

  it('категория «Стены и колонны»: стена перетаскивается на план и видна в 3D', async () => {
    await app.page.click('#libTabFurniture');
    await app.page.click('#furnitureCats button[aria-label="Стены и колонны"]');
    const names = await app.page.$$eval('#furnitureItems .chip-name', (ns) => ns.map((n) => n.textContent));
    assert.deepEqual(names, ['Стена', 'Колонна', 'Колонна круглая']);
    await app.page.evaluate(() => {
      const c = document.getElementById('canvas');
      const r = c.getBoundingClientRect();
      const dt = new DataTransfer();
      dt.setData('application/x-kepler-furn', 'wall-free');
      const o = { clientX: r.left + 30, clientY: r.top + r.height / 2, dataTransfer: dt, bubbles: true, cancelable: true };
      c.dispatchEvent(new DragEvent('dragover', o));
      c.dispatchEvent(new DragEvent('drop', o));
    });
    const wall = await app.page.evaluate(() => window.__kepler.state.project.items.find((i) => i.kind === 'wall-free'));
    assert.ok(wall && wall.w === 3000 && wall.h === 120, JSON.stringify(wall));
    await app.page.click('#view3dBtn');
    const withWall = (await d3(app.page)).faces;
    await app.page.keyboard.press('Escape');
    await app.page.keyboard.press('Control+z');
    await app.page.click('#view3dBtn');
    assert.ok((await d3(app.page)).faces < withWall, 'без стены граней меньше');
    await app.page.keyboard.press('Escape');
  });

  it('без ошибок в консоли', () => {
    assert.deepEqual(app.errors, []);
  });
});
