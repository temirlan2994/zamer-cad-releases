// e2e: уступ общей стены (core/wall-follow.js), настоящей мышью. Коридор
// 5292×1200 сверху, под ним санузел 2040×3700 и справа кухня (верх на той же
// линии). Ручку верхней грани санузла тянут вниз и вверх: двигается только
// участок нижней грани коридора над санузлом — коридор Г-образный, кухня на
// месте, щелей и съедания нет. Ctrl+Z — одним шагом, Esc — отмена жеста.
// SHOTS=<папка> — скриншоты до/после.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, openNew } from './helpers.mjs';

const SHOTS = process.env.SHOTS || '';

async function planToClient(page, x, y) {
  const box = await (await page.$('#canvas')).boundingBox();
  const s = await page.evaluate(([px, py]) => window.__kepler.planToScreen(px, py), [x, y]);
  return { x: box.x + s.x, y: box.y + s.y };
}

const scene = (page) => page.evaluate(async () => {
  const { roomPolygon } = await import('./core/room-shape.js');
  const { state } = window.__kepler;
  const get = (id) => {
    const r = state.project.rooms.find((x) => x.id === id);
    return {
      x: r.x, y: r.y, w: r.w, h: r.h, eaten: Boolean(r.eatBase), outline: Boolean(r.outline),
      poly: roomPolygon(r).map((p) => `${p.x},${p.y}`).sort(),
    };
  };
  const pairs = state.walls.filter((w) => w.kind === 'shared').map((w) => [...w.rooms].sort().join('|')).sort();
  return { C: get('C'), S: get('S'), K: get('K'), pairs };
});

async function setup(page) {
  await page.evaluate(async () => {
    const { mutate } = await import('./ui/store.js');
    const { selectObject } = await import('./ui/tools.js');
    const { createRoom } = await import('./core/model.js');
    const { state } = window.__kepler;
    selectObject(null);
    mutate(() => {
      state.project.building.rotation = 0;
      state.project.rooms.length = 0; state.project.items.length = 0; state.project.openings.length = 0;
      const c = createRoom('hall', 0, 0, 5292, 1200); c.id = 'C'; c.name = 'Коридор';
      const s = createRoom('bathroom', 0, 1300, 2040, 3700); s.id = 'S'; s.name = 'Санузел';
      const k = createRoom('kitchen', 2140, 1300, 3152, 3700); k.id = 'K'; k.name = 'Кухня';
      state.project.rooms.push(c, s, k);
    });
    state.view.scale = 0.1; state.view.panX = 300; state.view.panY = 120; state.view.rotation = 0;
    window.__kepler.requestDraw?.();
  });
}

async function shot(page, name) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` });
}

describe('уступ общей стены: санузел под длинным коридором', () => {
  let app;
  let start;
  before(async () => {
    app = await startApp();
    await openNew(app.page);
    await app.page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));
    await setup(app.page);
  });
  after(async () => { await app?.close(); });

  async function grabTop(page) {
    await page.mouse.click(...Object.values(await planToClient(page, 1000, 3000))); // выделить санузел
    const h = await planToClient(page, 1020, 1300); // ручка «n» — на общей стене с коридором
    await page.mouse.move(h.x, h.y);
    await page.mouse.down();
  }

  it('вниз: санузел меньше, коридор Г-образный, кухня на месте', async () => {
    const { page } = app;
    start = await scene(page);
    assert.deepEqual(start.pairs, ['C|K', 'C|S', 'K|S'], JSON.stringify(start));
    await shot(page, 'step-0-before');
    await grabTop(page);
    for (const y of [1500, 1700, 1900]) {
      const p = await planToClient(page, 1020, y);
      await page.mouse.move(p.x, p.y, { steps: 6 });
      const s = await scene(page);
      assert.deepEqual(s.K, start.K, `кухня на месте на шаге ${y}`);
      assert.equal(s.C.eaten || s.S.eaten || s.K.eaten, false, 'никто не съеден');
    }
    await page.mouse.up();
    const s = await scene(page);
    await shot(page, 'step-1-down');
    assert.deepEqual([s.S.x, s.S.y, s.S.w, s.S.h], [0, 1900, 2040, 3100], JSON.stringify(s.S));
    assert.deepEqual(s.K, start.K, 'кухня без изменений');
    assert.equal(s.C.outline, true);
    assert.deepEqual(s.C.poly, ['0,0', '0,1800', '2040,1200', '2040,1800', '5292,0', '5292,1200'], 'Г-коридор');
    assert.ok(s.pairs.includes('C|S') && s.pairs.includes('C|K') && s.pairs.includes('K|S'), `перегородки: ${s.pairs}`);
    assert.equal(s.C.eaten || s.S.eaten || s.K.eaten, false);
  });

  it('Ctrl+Z — одним шагом как было (коридор прямоугольный)', async () => {
    const { page } = app;
    await page.keyboard.press('Control+z');
    assert.deepEqual(await scene(page), start);
  });

  it('вверх: у коридора вырез над санузлом, кухня на месте', async () => {
    const { page } = app;
    await grabTop(page);
    for (const y of [1100, 900, 700]) {
      const p = await planToClient(page, 1020, y);
      await page.mouse.move(p.x, p.y, { steps: 6 });
    }
    await page.mouse.up();
    const s = await scene(page);
    await shot(page, 'step-2-up');
    assert.deepEqual([s.S.y, s.S.h], [700, 4300], JSON.stringify(s.S));
    assert.deepEqual(s.K, start.K, 'кухня без изменений');
    assert.deepEqual(s.C.poly, ['0,0', '0,600', '2140,1200', '2140,600', '5292,0', '5292,1200'], 'вырез до линии кухни');
    assert.ok(s.pairs.includes('C|S') && s.pairs.includes('C|K') && s.pairs.includes('K|S'), `перегородки: ${s.pairs}`);
    assert.equal(s.C.eaten || s.S.eaten || s.K.eaten, false);
    await page.keyboard.press('Control+z');
    assert.deepEqual(await scene(page), start);
  });

  it('туда-обратно в 0 — коридор снова прямоугольный, без лишних вершин', async () => {
    const { page } = app;
    await grabTop(page);
    for (const y of [1900, 800, 1300]) {
      const p = await planToClient(page, 1020, y);
      await page.mouse.move(p.x, p.y, { steps: 6 });
    }
    await page.mouse.up();
    const s = await scene(page);
    assert.deepEqual(s.C, start.C);
    assert.deepEqual(s.K, start.K);
  });

  it('Esc посреди жеста — всё как до жеста', async () => {
    const { page } = app;
    await grabTop(page);
    const p = await planToClient(page, 1020, 2000);
    await page.mouse.move(p.x, p.y, { steps: 6 });
    const mid = await scene(page);
    assert.equal(mid.C.outline, true, 'в жесте коридор уже Г');
    await page.keyboard.press('Escape');
    await page.mouse.up();
    const s = await scene(page);
    assert.deepEqual(s, start);
  });

  it('без ошибок в консоли', () => {
    assert.deepEqual(app.errors, []);
  });
});
