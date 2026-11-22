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
    await app.page.click('#projectSummary'); // секция «Проект»
    await app.page.fill('#buildingRot', '30');
    await app.page.locator('#buildingRot').blur();
    const s = await app.page.evaluate(() => ({
      rot: window.__kepler.state.project.building.rotation,
      view: (window.__kepler.state.view.rotation * 180) / Math.PI,
    }));
    assert.equal(s.rot, 30);
    assert.ok(Math.abs(s.view + 30) < 1e-9, `вид ${s.view}`);
    // Свой угол вида не задан — «Выровнять вид» не подсвечена, «План» идёт по осям дома.
    assert.equal(await app.page.$eval('#viewBtn', (n) => n.classList.contains('active')), false);
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

  it('в «Участке» (север вверх) клик по повёрнутой комнате выбирает дом, а не комнату', async () => {
    await app.page.click('#modeSiteBtn');
    await app.page.evaluate(() => window.__kepler.fitView());
    const r = await living(app.page);
    const c = await planClient(app.page, r.x + r.w / 2, r.y + r.h * 0.8);
    await app.page.mouse.click(c.x, c.y);
    const sel = await app.page.evaluate(() => window.__kepler.state.selection);
    assert.deepEqual(sel, { type: 'site', kind: 'building' });
  });

  it('в «Участке» дом тянется мышью целиком, одна отмена возвращает', async () => {
    const r = await living(app.page);
    const o0 = await app.page.evaluate(() => ({ ...window.__kepler.state.project.building.origin }));
    const a = await planClient(app.page, r.x + r.w / 2, r.y + r.h * 0.8);
    await app.page.mouse.move(a.x, a.y);
    await app.page.mouse.down();
    await app.page.mouse.move(a.x + 60, a.y + 40, { steps: 6 });
    await app.page.mouse.up();
    const o1 = await app.page.evaluate(() => ({ ...window.__kepler.state.project.building.origin }));
    assert.ok(o1.x !== o0.x || o1.y !== o0.y, 'дом не сдвинулся');
    await app.page.keyboard.press('Control+z');
    const o2 = await app.page.evaluate(() => ({ ...window.__kepler.state.project.building.origin }));
    assert.deepEqual(o2, o0);
  });

  it('без ошибок в консоли', () => {
    assert.deepEqual(app.errors, []);
  });
});
