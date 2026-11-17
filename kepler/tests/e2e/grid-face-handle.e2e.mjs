// e2e: ручка грани комнаты у координационной оси и стены 250 мм реальной
// мышью (жалоба «Гардеробная не двигается»). Маркер зазора «≈250 мм» лежал
// ровно на ручке правой грани и перехватывал нажатие (выделял пару комнат), а
// магнит осей 300 мм возвращал на ось любой сдвиг меньше 300 мм. Теперь:
// ручка важнее замка/подписи/маркера, радиус магнита осей — не больше 12 px.
// Сцена: «Гардеробная» 2635×2475 и «Гостиная» справа через стену 250, ось по
// грани (2635) или по центру стены (2760); замок открыт и закрыт.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, openNew, worldToClient } from './helpers.mjs';

const W0 = 2635;

async function scene(page, { at, snap, pin = false }) {
  await page.evaluate(async ([gat, mode, pinIt]) => {
    const s = window.__kepler.state;
    const model = await import('./core/model.js');
    const ga = await import('./core/grid-axes.js');
    const store = await import('./ui/store.js');
    const pg = await import('./ui/plan-grids.js');
    pg.setPlanGridPref({ on: true, snap: mode });
    store.mutate(() => {
      const a = model.createRoom('wardrobe', 0, 0, 2635, 2475); a.name = 'Гардеробная';
      const b = model.createRoom('living', 2885, -1000, 4000, 5000); b.name = 'Гостиная';
      s.project.rooms = [a, b];
      s.project.grids = [ga.createGrid({ kind: 'x', at: gat }, [])];
    });
    if (pinIt) {
      const gp = await import('./core/grid-pins.js');
      const w = s.walls.find((x) => x.orient === 'v' && x.rooms?.includes(s.project.rooms[0].id) && x.band.x >= 2600);
      store.mutate(() => { gp.pinWallToGrid(s.project, w, s.project.grids[0], { mode: 'auto', prefer: mode }); });
    }
    const v = await import('./ui/view.js');
    s.view.scale = 0.12;
    s.view.panX = 0; s.view.panY = 0;
    const c = document.getElementById('canvas');
    const p = v.planToScreen(2000, 1200);
    s.view.panX += c.clientWidth / 2 - p.x; s.view.panY += c.clientHeight / 2 - p.y;
    (await import('./ui/tools.js')).selectObject({ type: 'room', id: s.project.rooms[0].id });
    v.requestDraw();
  }, [at, snap, pin]);
  await page.waitForTimeout(150);
}

const wardrobe = (page) => page.evaluate(() => window.__kepler.state.project.rooms.find((r) => r.name === 'Гардеробная'));

async function toClient(page, x, y) {
  const wp = await page.evaluate(async (q) => (await import('./ui/view.js')).planToWorld(q), { x, y });
  return worldToClient(page, wp.x, wp.y);
}

// Тянем ручку правой грани так, чтобы грань пришла к x = target (мм).
async function dragEast(page, target) {
  const r = await wardrobe(page);
  const from = await toClient(page, r.x + r.w, r.y + r.h / 2);
  const to = await toClient(page, target, r.y + r.h / 2);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= 10; i += 1) await page.mouse.move(from.x + (to.x - from.x) * (i / 10), from.y);
  await page.mouse.up();
  await page.waitForTimeout(80);
  const after = await wardrobe(page);
  const sel = await page.evaluate(() => window.__kepler.state.selection?.type);
  return { east: after.x + after.w, sel, pins: after.axisPins };
}

describe('Ручка грани у оси и общей стены 250: сдвигается, не залипает', () => {
  let app;
  before(async () => {
    app = await startApp({ width: 1440, height: 860 });
    await openNew(app.page);
  });
  after(async () => { await app?.close(); });

  it('ось по грани, замок открыт: маркер «≈250 мм» на ручке не мешает; +100, +400, обратно, −300', async () => {
    const { page } = app;
    await scene(page, { at: 2635, snap: 'face' });
    // Под ручкой правой грани — маркер зазора (раньше перехватывал нажатие).
    const under = await page.evaluate(async () => {
      const s = window.__kepler.state;
      const r = s.project.rooms[0];
      const p = (await import('./ui/view.js')).planToScreen(r.x + r.w, r.y + r.h / 2);
      return Boolean((await import('./ui/gaps.js')).gapMarkerAt(p.x, p.y));
    });
    assert.equal(under, true, 'маркер зазора лежит на ручке (сцена как у пользователя)');
    let res = await dragEast(page, W0 + 100);
    assert.equal(res.sel, 'room', 'жест растяжения, а не выбор пары');
    assert.ok(Math.abs(res.east - (W0 + 100)) <= 50, `+100: ${res.east}`);
    res = await dragEast(page, W0 + 400);
    assert.ok(Math.abs(res.east - (W0 + 400)) <= 50, `+400: ${res.east}`);
    res = await dragEast(page, W0 + 8);
    assert.equal(res.east, W0, 'обратно — на ось');
    res = await dragEast(page, W0 - 300);
    assert.ok(res.east < W0 - 200, `−300: ${res.east}`);
    assert.deepEqual(app.errors, []);
  });

  it('ось по центру стены (2760): грань не прилипает к оси при сдвиге на 100 и 400', async () => {
    const { page } = app;
    await scene(page, { at: 2760, snap: 'axis' });
    let res = await dragEast(page, W0 + 100);
    assert.ok(Math.abs(res.east - (W0 + 100)) <= 50, `+100: ${res.east}`);
    res = await dragEast(page, W0 + 400);
    assert.ok(Math.abs(res.east - (W0 + 400)) <= 50, `+400: ${res.east}`);
    res = await dragEast(page, W0 + 5);
    assert.ok(Math.abs(res.east - W0) <= 50, `обратно: ${res.east}`);
  });

  it('замок закрыт: ручкой тянется, привязка снимается (стену увели с оси)', async () => {
    const { page } = app;
    await scene(page, { at: 2635, snap: 'face', pin: true });
    assert.equal((await wardrobe(page)).axisPins?.length, 1);
    const res = await dragEast(page, W0 + 400);
    assert.equal(res.sel, 'room');
    assert.ok(Math.abs(res.east - (W0 + 400)) <= 50, `+400: ${res.east}`);
    assert.equal(res.pins, undefined);
    await page.keyboard.press('Control+z');
    const back = await wardrobe(page);
    assert.equal(back.x + back.w, W0);
    assert.equal(back.axisPins?.length, 1);
  });
});
