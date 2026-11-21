// e2e: общая стена при растяжении ручкой (core/wall-follow.js), настоящей
// мышью, дом повёрнут на 45°. Тянем ручку грани A на общей стене с B туда-
// сюда — ни на одном шаге нет зазора, общая стена одна, площади A и B
// меняются согласованно; отпускание — один шаг отмены; Alt — оторвать.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, openNew } from './helpers.mjs';

async function planToClient(page, x, y) {
  const box = await (await page.$('#canvas')).boundingBox();
  const s = await page.evaluate(([px, py]) => window.__kepler.planToScreen(px, py), [x, y]);
  return { x: box.x + s.x, y: box.y + s.y };
}

// Состояние пары: номиналы, число общих стен A|B, съедание.
const pair = (page) => page.evaluate(() => {
  const { state } = window.__kepler;
  const get = (id) => {
    const r = state.project.rooms.find((x) => x.id === id);
    const b = r.eatBase?.base || r;
    return { x: b.x, y: b.y, w: b.w, h: b.h, eaten: Boolean(r.eatBase), outline: Boolean(r.outline) };
  };
  const shared = state.walls.filter((w) => w.kind === 'shared' && w.rooms.includes('A') && w.rooms.includes('B'));
  const own = state.walls.filter((w) => w.kind === 'own' && w.orient === 'v' &&
    w.rooms.some((id) => id === 'A' || id === 'B') && w.from < 2000 && w.to > 1000 && w.edge > 1000 && w.edge < 8000);
  return { a: get('A'), b: get('B'), shared: shared.length, sharedT: shared[0]?.thickness ?? null, innerOwn: own.length };
});

async function setup(page) {
  await page.evaluate(async () => {
    const { mutate } = await import('./ui/store.js');
    const { selectObject } = await import('./ui/tools.js');
    const { createRoom } = await import('./core/model.js');
    const { state } = window.__kepler;
    selectObject(null);
    mutate(() => {
      state.project.building.rotation = 45;
      state.project.rooms.length = 0;
      state.project.items.length = 0;
      state.project.openings.length = 0;
      const a = createRoom('living', 0, 0, 4000, 3000); a.id = 'A';
      const b = createRoom('bedroom', 4100, 0, 4000, 3000); b.id = 'B'; // перегородка 100
      state.project.rooms.push(a, b);
    });
    state.view.scale = 0.04; state.view.panX = 560; state.view.panY = 250; state.view.rotation = 0;
    window.__kepler.requestDraw?.();
  });
}

describe('общая стена тянется ручкой — обе грани вместе, дом 45°', () => {
  let app;
  let start;
  before(async () => {
    app = await startApp();
    await openNew(app.page);
    await setup(app.page);
  });
  after(async () => { await app?.close(); });

  it('туда-сюда по шагам: зазор 100, общая стена одна, площади согласованы', async () => {
    const { page } = app;
    start = await pair(page);
    assert.equal(start.shared, 1, JSON.stringify(start));
    const total = start.a.w * start.a.h + start.b.w * start.b.h;
    await page.mouse.click(...Object.values(await planToClient(page, 1000, 1500))); // выделить A
    const h = await planToClient(page, 4000, 1500); // ручка «e» A — на общей стене
    await page.mouse.move(h.x, h.y);
    await page.mouse.down();
    const seen = [];
    for (const x of [4300, 4700, 5200, 5600, 4900, 4200, 3600, 3000, 3400, 4150, 4600]) {
      const p = await planToClient(page, x, 1500);
      await page.mouse.move(p.x, p.y, { steps: 6 });
      const s = await pair(page);
      seen.push(s.a.w);
      const gap = s.b.x - (s.a.x + s.a.w);
      assert.equal(gap, 100, `зазор на шаге ${x}: ${JSON.stringify(s)}`);
      assert.equal(s.shared, 1, `одна общая стена на шаге ${x}: ${JSON.stringify(s)}`);
      assert.equal(s.sharedT, 100);
      assert.equal(s.innerOwn, 0, 'нет двух своих стен вместо общей');
      assert.equal(s.b.x + s.b.w, 8100, 'дальняя грань B на месте');
      assert.equal(s.a.eaten || s.b.eaten, false, 'никто никого не съел');
      assert.equal(s.a.w * s.a.h + s.b.w * s.b.h, total, 'сумма площадей неизменна');
    }
    await page.mouse.up();
    assert.ok(Math.max(...seen) >= 5200 && Math.min(...seen) <= 3200, `грань реально ходила: ${seen}`);
    const end = await pair(page);
    assert.notEqual(end.a.w, start.a.w, 'размер изменился');
    assert.equal(end.b.x - (end.a.x + end.a.w), 100);
    assert.equal(end.shared, 1);
  });

  it('Ctrl+Z — одним шагом обе комнаты как были; Ctrl+Y — снова', async () => {
    const { page } = app;
    const after1 = await pair(page);
    await page.keyboard.press('Control+z');
    assert.deepEqual(await pair(page), start);
    await page.keyboard.press('Control+y');
    assert.deepEqual(await pair(page), after1);
    await page.keyboard.press('Control+z');
  });

  it('Alt — оторвать: тянется только A, B на месте', async () => {
    const { page } = app;
    await page.mouse.click(...Object.values(await planToClient(page, 1000, 1500)));
    const h = await planToClient(page, 4000, 1500);
    const to = await planToClient(page, 3000, 1500);
    await page.mouse.move(h.x, h.y);
    await page.keyboard.down('Alt');
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 10 });
    await page.mouse.up();
    await page.keyboard.up('Alt');
    const s = await pair(page);
    assert.equal(s.b.x, 4100, `B на месте: ${JSON.stringify(s)}`);
    assert.ok(s.a.w < 3500, `A уже: ${s.a.w}`);
    await page.keyboard.press('Control+z');
    assert.deepEqual(await pair(page), start);
  });

  it('сосед упирается в минимум — грань дальше не идёт, стена не рвётся', async () => {
    const { page } = app;
    await page.mouse.click(...Object.values(await planToClient(page, 1000, 1500)));
    const h = await planToClient(page, 4000, 1500);
    const to = await planToClient(page, 8000, 1500);
    await page.mouse.move(h.x, h.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 12 });
    const s = await pair(page);
    await page.mouse.up();
    assert.equal(s.b.w, 900, `B сжалась до минимума: ${JSON.stringify(s)}`);
    assert.equal(s.b.x - (s.a.x + s.a.w), 100);
    assert.equal(s.shared, 1);
    await page.keyboard.press('Control+z');
  });

  it('без ошибок в консоли', () => {
    assert.deepEqual(app.errors, []);
  });
});

// Тело общей стены тянут мышью, комнаты стоят вплотную (зазор 0): нижняя
// «съедена» верхней. Двигаться должны обе номинальные грани — никакой щели.
describe('общая стена тянется за тело — вплотную стоящие комнаты', () => {
  let app;
  before(async () => {
    app = await startApp();
    await openNew(app.page);
    await app.page.evaluate(async () => {
      const { mutate } = await import('./ui/store.js');
      const { selectObject } = await import('./ui/tools.js');
      const { createRoom } = await import('./core/model.js');
      const { state } = window.__kepler;
      selectObject(null);
      mutate(() => {
        state.project.building.rotation = 0;
        state.project.rooms.length = 0; state.project.items.length = 0; state.project.openings.length = 0;
        const a = createRoom('living', 0, 0, 4000, 3000); a.id = 'A';
        const b = createRoom('bedroom', 0, 3000, 4000, 3000); b.id = 'B';
        state.project.rooms.push(a, b);
      });
      state.view.scale = 0.04; state.view.panX = 500; state.view.panY = 150; state.view.rotation = 0;
      window.__kepler.requestDraw?.();
    });
  });
  after(async () => { await app?.close(); });

  const nominal = (page) => page.evaluate(() => {
    const get = (id) => { const r = window.__kepler.state.project.rooms.find((x) => x.id === id); return r.eatBase?.base || r; };
    const a = get('A'); const b = get('B');
    return { aH: a.h, bY: b.y, bH: b.h };
  });

  it('обе грани едут вместе, щели нет; Ctrl+Z возвращает', async () => {
    const { page } = app;
    const start = await nominal(page);
    const wallY = await page.evaluate(() => {
      const w = window.__kepler.state.walls.find((x) => x.kind === 'shared' && x.orient === 'h');
      return (w.center.y1 + w.center.y2) / 2;
    });
    const at = await planToClient(page, 2000, wallY);
    await page.mouse.click(at.x, at.y);
    await page.mouse.move(at.x, at.y);
    await page.mouse.down();
    for (const dy of [300, 900, 1400, 600, -300, -700, 0, 500]) {
      const p = await planToClient(page, 2000, wallY + dy);
      await page.mouse.move(p.x, p.y, { steps: 6 });
      const n = await nominal(page);
      assert.equal(n.aH, n.bY, `щели нет на шаге ${dy}: ${JSON.stringify(n)}`);
      assert.equal(n.bY + n.bH, 6000, 'дальняя грань B на месте');
    }
    await page.mouse.up();
    const end = await nominal(page);
    assert.notEqual(end.aH, start.aH, 'стена сдвинулась');
    await page.keyboard.press('Control+z');
    assert.deepEqual(await nominal(page), start);
  });

  it('без ошибок в консоли', () => {
    assert.deepEqual(app.errors, []);
  });
});
