// e2e правки при повёрнутом доме: в «Плане» всё прямое, в «Участке» дом
// повёрнут, но выбирается, тянется и выделяется рамкой как обычно.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, openSample } from './helpers.mjs';

const planClient = async (page, x, y) => {
  const box = await (await page.$('#canvas')).boundingBox();
  const s = await page.evaluate(([px, py]) => window.__kepler.planToScreen(px, py), [x, y]);
  return { x: box.x + s.x, y: box.y + s.y };
};
const living = (page) => page.evaluate(() => {
  const r = window.__kepler.state.project.rooms.find((x) => x.type === 'living');
  return { id: r.id, x: r.x, y: r.y, w: r.w, h: r.h };
});

describe('повёрнутый дом', () => {
  let app;
  before(async () => { app = await startApp(); await openSample(app.page); });
  after(async () => { await app?.close(); });

  it('поле «Поворот дома» поворачивает дом на месте, «План» остаётся прямым', async () => {
    await app.page.fill('#buildingRot', '30');
    await app.page.locator('#buildingRot').blur();
    const s = await app.page.evaluate(() => ({
      rot: window.__kepler.state.project.building.rotation,
      view: (window.__kepler.state.view.rotation * 180) / Math.PI,
    }));
    assert.equal(s.rot, 30);
    assert.ok(Math.abs(s.view + 30) < 1e-9, `вид ${s.view}`);
    assert.equal(await app.page.$eval('#alignBtn', (n) => n.classList.contains('active')), true);
  });

  it('в «Плане» комната тянется мышью по осям экрана', async () => {
    const r = await living(app.page);
    const a = await planClient(app.page, r.x + 400, r.y + 400);
    const b = await planClient(app.page, r.x + 400, r.y + 400 + 1500);
    await app.page.mouse.move(a.x, a.y);
    await app.page.mouse.down();
    await app.page.mouse.move(b.x, b.y, { steps: 8 });
    await app.page.mouse.up();
    const after = await living(app.page);
    assert.equal(after.x, r.x, 'по X не сдвинулась');
    assert.ok(Math.abs(after.y - (r.y + 1500)) <= 200, `y: ${r.y} → ${after.y}`);
    await app.page.keyboard.press('Control+z');
    assert.deepEqual(await living(app.page), r);
  });

  it('в «Участке» (север вверх) повёрнутая комната выбирается кликом', async () => {
    await app.page.click('#modeSiteBtn');
    await app.page.evaluate(() => window.__kepler.fitView());
    const r = await living(app.page);
    const c = await planClient(app.page, r.x + r.w / 2, r.y + r.h * 0.8);
    await app.page.mouse.click(c.x, c.y);
    const sel = await app.page.evaluate(() => window.__kepler.state.selection);
    assert.deepEqual(sel, { type: 'room', id: r.id });
  });

  it('рамка в «Участке» выделяет повёрнутые комнаты', async () => {
    await app.page.keyboard.press('Escape');
    const corners = await app.page.evaluate(() => {
      const k = window.__kepler;
      const pts = [];
      for (const r of k.state.project.rooms) {
        for (const [x, y] of [[r.x, r.y], [r.x + r.w, r.y], [r.x + r.w, r.y + r.h], [r.x, r.y + r.h]]) pts.push(k.planToScreen(x, y));
      }
      return {
        minX: Math.min(...pts.map((p) => p.x)), maxX: Math.max(...pts.map((p) => p.x)),
        minY: Math.min(...pts.map((p) => p.y)), maxY: Math.max(...pts.map((p) => p.y)),
      };
    });
    const box = await (await app.page.$('#canvas')).boundingBox();
    // Сначала выключаем слой участка, чтобы клик по пустому месту начал рамку.
    await app.page.mouse.move(box.x + corners.minX - 30, box.y + corners.minY - 30);
    await app.page.mouse.down();
    await app.page.mouse.move(box.x + corners.maxX + 30, box.y + corners.maxY + 30, { steps: 6 });
    await app.page.mouse.up();
    const sel = await app.page.evaluate(() => window.__kepler.state.selection);
    const rooms = await app.page.evaluate(() => window.__kepler.state.project.rooms.length);
    assert.equal(sel?.type, 'multi');
    assert.equal(sel.roomIds.length, rooms);
  });

  it('без ошибок в консоли', () => {
    assert.deepEqual(app.errors, []);
  });
});
