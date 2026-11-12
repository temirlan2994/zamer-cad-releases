// e2e: привязка стен к осям ПО ЦЕНТРУ (оси стены) реальной мышью и цели
// привязки «центр стены» (core/grid-pins.js autoWallMode, core/wall-manual.js
// snapWallPoint): ручная стена липнет концом к осевой линии соседней стены и
// к середине стены (подпись); инструмент «Ось» ставит ось по центру
// перегородки; «Оси по стенам» в режиме «по оси» → замок у наружной стены
// виден, клик — закрыт, ось едет — стена едет, Ctrl+Z; общая стена с осью
// по середине зазора; смена режима правым кликом по замку и в «Свойствах».
// Скриншоты — если задан KEPLER_SHOTS (папка).
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { startApp, openSample, worldToClient } from './helpers.mjs';

const SHOTS = process.env.KEPLER_SHOTS || '';
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: join(SHOTS, `${name}.png`) }); };

const st = (page, key) => page.evaluate((k) => window.__kepler.state[k], key);
const room = (page, name) => page.evaluate((n) => window.__kepler.state.project.rooms.find((r) => r.name === n), name);
const grids = (page) => page.evaluate(() => window.__kepler.state.project.grids || []);
const grid = async (page, id) => (await grids(page)).find((g) => g.id === id);

async function toClient(page, x, y) {
  const wp = await page.evaluate(async (q) => (await import('./ui/view.js')).planToWorld(q), { x, y });
  return worldToClient(page, wp.x, wp.y);
}

async function redraw(page) {
  await page.evaluate(async () => (await import('./ui/view.js')).requestDraw());
  await page.waitForTimeout(80);
}

async function lock(page, gridId) {
  await redraw(page);
  const l = await page.evaluate((gid) => (window.__kepler.state._gridLocks || []).find((x) => !gid || x.gridId === gid) || null, gridId);
  if (!l) return null;
  const box = await (await page.$('#canvas')).boundingBox();
  return { ...l, cx: box.x + l.x, cy: box.y + l.y };
}

// y точки на стене x (без проёмов) в пределах y0…y1.
const wallY = (page, x, y0, y1) => page.evaluate(async ([wx, a, b]) => {
  const hit = await import('./ui/hit.js');
  for (let yy = a; yy < b; yy += 100) if (hit.hitPlanStack({ x: wx, y: yy })[0]?.type === 'wall') return yy;
  return null;
}, [x, y0, y1]);

async function drag(page, from, to) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 4 });
  await page.mouse.move(to.x, to.y, { steps: 4 });
  await page.mouse.up();
  await page.waitForTimeout(60);
}

async function selectWallAt(page, x, y) {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(600); // серия кликов (event.detail) перебирает объекты под курсором
  const c = await toClient(page, x, y);
  await page.mouse.click(c.x, c.y);
  return page.evaluate(() => window.__kepler.state.selection);
}

describe('Стены и оси: привязка по центру стены', () => {
  let app;
  let box; // габарит дома (комнаты)
  before(async () => {
    app = await startApp({ width: 1440, height: 860 });
    await openSample(app.page);
    await app.page.click('#fitBtn');
    await app.page.evaluate(async () => {
      const s = window.__kepler.state;
      s.view.scale *= 0.8;
      (await import('./ui/view.js')).requestDraw();
    });
    await app.page.waitForTimeout(100);
    box = await app.page.evaluate(() => {
      const rs = window.__kepler.state.project.rooms;
      return {
        x0: Math.min(...rs.map((r) => r.x)), y0: Math.min(...rs.map((r) => r.y)),
        x1: Math.max(...rs.map((r) => r.x + r.w)), y1: Math.max(...rs.map((r) => r.y + r.h)),
      };
    });
  });
  after(async () => { await app?.close(); });

  it('инструмент «Стена»: конец липнет к линии центра соседней стены и к середине стены (подпись)', async () => {
    const { page } = app;
    assert.equal((await grids(page)).length, 0);
    await page.keyboard.press('Escape');
    await page.click('#wallToolBtn');
    // Ниже дома, по линии центра перегородки спальня|гостиная (x = 5050).
    const y = box.y1 + 1500;
    const a = await toClient(page, 2000, y);
    await page.mouse.move(a.x, a.y, { steps: 2 });
    await page.mouse.click(a.x, a.y);
    const b = await toClient(page, 5062, y + 10);
    await page.mouse.move(b.x, b.y, { steps: 3 });
    await redraw(page);
    const tool = await st(page, 'tool');
    assert.equal(tool.cursor.x, 5050, `конец по центру стены: ${tool.cursor.x}`);
    assert.equal((await st(page, 'gridSnapTag'))?.text, 'центр стены');
    await shot(page, 'wall-center-snap');
    await page.mouse.click(b.x, b.y);
    await page.keyboard.press('Escape');
    const w = await page.evaluate(() => window.__kepler.state.project.walls.at(-1));
    assert.deepEqual(w.axis.b, { x: 5050, y });
    // Середина только что построенной стены (3525, y): начало новой стены.
    await page.click('#wallToolBtn');
    const m = await toClient(page, 3540, y + 15);
    await page.mouse.move(m.x, m.y, { steps: 3 });
    await redraw(page);
    const t2 = await st(page, 'tool');
    assert.deepEqual(t2.cursor, { x: 3525, y }, JSON.stringify(t2.cursor));
    assert.equal((await st(page, 'gridSnapTag'))?.text, 'середина стены');
    await page.keyboard.press('Escape');
    assert.equal(await st(page, 'gridSnapTag'), null);
    await page.keyboard.press('Control+z');
    assert.equal(await page.evaluate(() => (window.__kepler.state.project.walls || []).length), 0);
  });

  it('инструмент «Ось» ставит ось по центру перегородки (подпись «центр стены»)', async () => {
    const { page } = app;
    await page.keyboard.press('Escape');
    await page.click('#gridToolBtn');
    const y = box.y1 + 1200;
    // Горизонтальное движение — вертикальная ось (kind x).
    const s0 = await toClient(page, 4500, y);
    const s1 = await toClient(page, 5060, y);
    await page.mouse.move(s0.x, s0.y);
    await page.mouse.move(s1.x, s1.y, { steps: 6 });
    await redraw(page);
    const t = await st(page, 'tool');
    assert.equal(t.gkind, 'x');
    assert.equal(t.cursor.x, 5050);
    assert.equal((await st(page, 'gridSnapTag'))?.text, 'центр стены');
    await page.mouse.click(s1.x, s1.y);
    await page.keyboard.press('Escape');
    const g = (await grids(page)).at(-1);
    assert.equal(g.at, 5050);
    // Стена: замок «по оси», клик — прикреплена; ось едет — обе комнаты.
    const bed = await room(page, 'Спальня');
    const wy = await wallY(page, 5050, bed.y + 300, bed.y + bed.h);
    const sel = await selectWallAt(page, 5050, wy);
    assert.equal(sel?.type, 'wall');
    const l = await lock(page, g.id);
    assert.ok(l, 'замок у общей стены');
    assert.equal(l.mode, 'axis');
    await page.mouse.click(l.cx, l.cy);
    assert.equal((await lock(page, g.id)).closed, true);
    assert.equal((await room(page, 'Гостиная')).axisPins[0].mode, 'axis');
    await page.evaluate(async (id) => (await import('./ui/grids.js')).moveGridTo(id, 5350), g.id);
    assert.equal((await room(page, 'Спальня')).x + (await room(page, 'Спальня')).w, 5300);
    assert.equal((await room(page, 'Гостиная')).x, 5400);
    await page.keyboard.press('Control+z');
    assert.equal((await room(page, 'Гостиная')).x, 5100);
    await page.keyboard.press('Control+z');
    await page.keyboard.press('Control+z');
    assert.equal((await grids(page)).length, 0);
  });

  it('«Оси по стенам» по оси: замок у наружной стены, клик, ось едет — стена едет, Ctrl+Z', async () => {
    const { page } = app;
    await page.keyboard.press('Escape');
    await page.waitForSelector('#viewsGridSnap');
    await page.selectOption('#viewsGridSnap', 'axis');
    await page.waitForSelector('#viewsGridAuto');
    await page.click('#viewsGridAuto');
    const list = await grids(page);
    const lv = await room(page, 'Гостиная');
    const east = lv.x + lv.w + 125; // центр наружной стены 250 мм
    const g = list.find((x) => x.kind === 'x' && x.at === east);
    assert.ok(g, `ось по центру восточной стены: ${list.map((x) => `${x.kind}${x.at}`)}`);
    const wy = await wallY(page, east, lv.y + 300, lv.y + lv.h);
    const sel = await selectWallAt(page, east, wy);
    assert.equal(sel?.type, 'wall');
    const l = await lock(page, g.id);
    assert.ok(l, 'замок виден');
    assert.equal(l.closed, false);
    assert.equal(l.mode, 'axis');
    await page.mouse.move(l.cx, l.cy);
    await page.waitForTimeout(40);
    assert.match(await page.textContent('#gridLockTip'), /по центру/);
    await shot(page, 'center-lock-open');
    await page.mouse.click(l.cx, l.cy);
    const l2 = await lock(page, g.id);
    assert.equal(l2.closed, true);
    const pins = (await room(page, 'Гостиная')).axisPins;
    assert.deepEqual(pins.map((p) => [p.dir, p.gridId, p.off, p.mode]), [['e', g.id, -125, 'axis']]);
    await page.mouse.move(l2.cx + 200, l2.cy + 200);
    assert.match(await page.textContent('#wallPinBlock'), /по центру \(оси стены\)/);
    assert.equal(await page.$eval('.wall-pin-mode', (s) => s.value), 'axis');
    await shot(page, 'center-lock-closed-props');
    // Ось тянут мышью (выше дома) — центр стены едет с ней.
    const from = await toClient(page, east, box.y0 - 900);
    const to = await toClient(page, east + 500, box.y0 - 900);
    await drag(page, from, to);
    const at2 = (await grid(page, g.id)).at; // шаг сетки при сдвиге
    assert.ok(at2 > east + 300, `ось сдвинута: ${at2}`);
    const moved = await room(page, 'Гостиная');
    assert.equal(moved.x + moved.w + 125, at2, 'центр стены — на оси');
    await page.keyboard.press('Control+z');
    assert.equal((await grid(page, g.id)).at, east);
    assert.equal((await room(page, 'Гостиная')).x + (await room(page, 'Гостиная')).w + 125, east);
  });

  it('режим привязки: правый клик по замку — «по грани», список в «Свойствах» — обратно «по центру»', async () => {
    const { page } = app;
    const lv = await room(page, 'Гостиная');
    const east = lv.x + lv.w + 125;
    const g = (await grids(page)).find((x) => x.kind === 'x' && x.at === east);
    await selectWallAt(page, east, await wallY(page, east, lv.y + 300, lv.y + lv.h));
    const l = await lock(page, g.id);
    assert.equal(l.closed, true);
    await page.mouse.click(l.cx, l.cy, { button: 'right' });
    await page.waitForTimeout(60);
    // «По грани»: наружная грань на оси — комната ужалась на полтолщины.
    const f = await room(page, 'Гостиная');
    assert.equal(f.x + f.w + 250, east);
    assert.equal(f.axisPins[0].mode, 'face');
    assert.equal((await grid(page, g.id)).at, east);
    // «Свойства»: список режима → «по центру».
    await page.waitForSelector('.wall-pin-mode');
    assert.equal(await page.$eval('.wall-pin-mode', (s) => s.value), 'face');
    await page.selectOption('.wall-pin-mode', 'axis');
    await page.waitForTimeout(60);
    const c = await room(page, 'Гостиная');
    assert.equal(c.x + c.w + 125, east);
    assert.equal(c.axisPins[0].mode, 'axis');
    // Ctrl+Z — по шагу: снова «по грани», затем снова «по центру» (до правого клика).
    await page.keyboard.press('Control+z');
    assert.equal((await room(page, 'Гостиная')).axisPins[0].mode, 'face');
    await page.keyboard.press('Control+z');
    assert.equal((await room(page, 'Гостиная')).axisPins[0].mode, 'axis');
    assert.equal((await room(page, 'Гостиная')).x + (await room(page, 'Гостиная')).w + 125, east);
    assert.deepEqual(app.errors, []);
  });
});
