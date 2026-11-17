// e2e «Разделить» ОБЩУЮ стену настоящей мышью (core/wall-split.js): две
// комнаты рядом, общая вертикальная стена. Выбор стены → «Разделить» → линия
// деления, клик → у обеих комнат вершины на стыке; половину тянут круглой
// точкой — уступ в обеих комнатах, щели нет; Ctrl+Z возвращает обе; Esc без
// сдвига откатывает деление; Alt — оторвать.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, openNew } from './helpers.mjs';

const SHOTS = process.env.KEPLER_SHOTS || '';

async function planToClient(page, x, y) {
  const box = await (await page.$('#canvas')).boundingBox();
  const s = await page.evaluate(([px, py]) => window.__kepler.planToScreen(px, py), [x, y]);
  return { x: box.x + s.x, y: box.y + s.y };
}

// Состояние пары: контуры (абсолютные точки), общие стены A|B, временное деление.
const pair = (page) => page.evaluate(() => {
  const { state } = window.__kepler;
  const get = (id) => {
    const r = state.project.rooms.find((x) => x.id === id);
    const pts = r.outline ? r.outline.map((p) => [r.x + p.x, r.y + p.y]) : null;
    return { x: r.x, y: r.y, w: r.w, h: r.h, pts, eaten: Boolean(r.eatBase) };
  };
  const shared = state.walls.filter((w) => w.kind === 'shared' && w.rooms.includes('A') && w.rooms.includes('B'));
  return {
    a: get('A'), b: get('B'),
    shared: shared.map((w) => ({ orient: w.orient, len: Math.abs(w.to - w.from), t: w.thickness })),
    // Свои стены A/B внутри пары (между комнатами) — признак щели. Стыки
    // 100×100 в углах уступа (короче перегородки) — не щель.
    innerOwn: state.walls.filter((w) => w.kind === 'own' && w.rooms.some((id) => id === 'A' || id === 'B') &&
      Math.abs(w.to - w.from) > 100.5 &&
      (w.orient === 'v' ? w.edge > 1000 && w.edge < 4500 && Math.min(w.from, w.to) < 2900 && Math.max(w.from, w.to) > 100
        : w.edge > 100 && w.edge < 2900)).length,
    pending: state.pendingRoomSplit ? [...(state.pendingRoomSplit.roomIds || [])].sort() : null,
    sel: state.selection ? `${state.selection.type}:${state.selection.id || state.selection.key}` : null,
  };
});

const has = (pts, x, y) => (pts || []).filter(([px, py]) => Math.abs(px - x) < 0.5 && Math.abs(py - y) < 0.5).length;
const sharedLen = (s) => s.shared.filter((w) => w.orient === 'v').reduce((sum, w) => sum + w.len, 0);
// Щели нет: между комнатами только общая стена толщиной 100.
function noGap(s, msg) {
  assert.equal(s.innerOwn, 0, `своих стен между комнатами нет (${msg}): ${JSON.stringify(s)}`);
  assert.ok(s.shared.length && s.shared.every((w) => w.t === 100), `общая стена толщиной 100 (${msg})`);
}

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
      const a = createRoom('living', 0, 0, 2000, 3000); a.id = 'A'; a.name = 'Гостевой санузел';
      const b = createRoom('bedroom', 2100, 0, 3000, 3000); b.id = 'B'; b.name = 'Прихожая'; // перегородка 100
      state.project.rooms.push(a, b);
    });
    state.view.scale = 0.12; state.view.panX = 300; state.view.panY = 220; state.view.rotation = 0;
    window.__kepler.requestDraw?.();
  });
}

describe('разделить общую стену и потянуть половину', () => {
  let app;
  let start;
  before(async () => {
    app = await startApp();
    await openNew(app.page);
    await app.page.emulateMedia({ colorScheme: 'light' });
    await setup(app.page);
  });
  after(async () => { await app?.close(); });

  const shot = async (name) => { if (SHOTS) await app.page.screenshot({ path: `${SHOTS}/${name}.png` }); };

  // Выбрать общую стену кликом и разделить кликом на высоте y.
  async function splitAt(y) {
    const { page } = app;
    const w = await planToClient(page, 2050, 1700);
    await page.mouse.click(w.x, w.y);
    await page.waitForSelector('[data-selection-action="split-wall"]:not([disabled])', { timeout: 5000 });
    await shot('split-shared-1-wall');
    await page.click('[data-selection-action="split-wall"]');
    const p = await planToClient(page, 2050, y);
    await page.mouse.move(p.x, p.y, { steps: 5 });
    const along = await page.evaluate(() => window.__kepler.state.splitEdit?.along ?? null);
    assert.equal(along, y, 'линия деления — на курсоре (шаг 50)');
    await shot('split-shared-2-line');
    await page.mouse.down(); await page.mouse.up();
  }

  it('кнопка «Разделить» активна у общей стены; клик режет обе комнаты в одной точке', async () => {
    const { page } = app;
    start = await pair(page);
    assert.equal(start.shared.length, 1, JSON.stringify(start));
    await shot('split-shared-0-before');
    await splitAt(1200);
    const s = await pair(page);
    assert.deepEqual(s.pending, ['A', 'B'], 'временное деление на обе комнаты');
    assert.equal(has(s.a.pts, 2000, 1200), 2, `A: две вершины на стыке ${JSON.stringify(s.a)}`);
    assert.equal(has(s.b.pts, 2100, 1200), 2, `B: две вершины на стыке ${JSON.stringify(s.b)}`);
    assert.equal(sharedLen(s), 3000, 'общая стена на всю высоту');
    assert.ok(s.shared.every((w) => w.t === 100));
    assert.equal(s.sel, 'room:A');
  });

  it('половину тянут круглой точкой: уступ в обеих комнатах, щели нет', async () => {
    const { page } = app;
    const h = await planToClient(page, 2000, 2100); // ручка нижней половины ребра A
    await page.mouse.move(h.x, h.y);
    await page.mouse.down();
    try {
    for (const x of [2300, 2700, 2600]) {
      const p = await planToClient(page, x, 2100);
      await page.mouse.move(p.x, p.y, { steps: 6 });
      const s = await pair(page);
      const dx = x - 2000;
      assert.equal(has(s.a.pts, 2000 + dx, 3000), 1, `A: низ грани на ${2000 + dx}: ${JSON.stringify(s.a)}`);
      assert.equal(has(s.b.pts, 2100 + dx, 3000), 1, `B: низ грани на ${2100 + dx}: ${JSON.stringify(s.b)}`);
      noGap(s, `шаг ${x}`);
    }
    } finally { await page.mouse.up(); }
    const s = await pair(page);
    assert.equal(s.pending, null);
    assert.equal(has(s.a.pts, 2000, 1200), 1); assert.equal(has(s.a.pts, 2600, 1200), 1);
    // ступенька B отнесена на перегородку (100) от ступеньки A
    assert.equal(has(s.b.pts, 2100, 1100), 1, JSON.stringify(s.b)); assert.equal(has(s.b.pts, 2700, 1100), 1);
    assert.equal(s.b.eaten, false, 'B никто не съел');
    noGap(s, 'после жеста');
    await shot('split-shared-3-after');
  });

  it('Ctrl+Z — одним шагом обе комнаты как до деления', async () => {
    const { page } = app;
    await page.keyboard.press('Control+z');
    const s = await pair(page);
    assert.deepEqual({ a: s.a, b: s.b, shared: s.shared }, { a: start.a, b: start.b, shared: start.shared });
  });

  it('Esc без сдвига откатывает деление в обеих комнатах', async () => {
    const { page } = app;
    await splitAt(1500);
    assert.deepEqual((await pair(page)).pending, ['A', 'B']);
    await page.keyboard.press('Escape');
    const s = await pair(page);
    assert.equal(s.pending, null);
    assert.equal(s.a.pts, null, `A снова прямоугольник: ${JSON.stringify(s.a)}`);
    assert.equal(s.b.pts, null, `B снова прямоугольник: ${JSON.stringify(s.b)}`);
  });

  it('нажали на ручку и отпустили без сдвига — деление откатывается', async () => {
    const { page } = app;
    await splitAt(1500);
    const h = await planToClient(page, 2000, 750);
    await page.mouse.move(h.x, h.y); await page.mouse.down(); await page.mouse.up();
    const s = await pair(page);
    assert.equal(s.a.pts, null); assert.equal(s.b.pts, null);
  });

  it('Alt — оторвать: тянется только A, B без лишних вершин', async () => {
    const { page } = app;
    await page.keyboard.press('Escape');
    await splitAt(1500);
    const h = await planToClient(page, 2000, 750); // верхняя половина
    const to = await planToClient(page, 1600, 750);
    await page.mouse.move(h.x, h.y);
    await page.keyboard.down('Alt');
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 8 });
    await page.mouse.up();
    await page.keyboard.up('Alt');
    const s = await pair(page);
    assert.equal(has(s.a.pts, 1600, 0), 1, `A: верх грани сдвинут: ${JSON.stringify(s.a)}`);
    assert.equal(s.b.pts, null, `B прямоугольник на месте: ${JSON.stringify(s.b)}`);
    assert.equal(s.b.x, 2100);
    await page.keyboard.press('Control+z');
    const back = await pair(page);
    assert.deepEqual({ a: back.a, b: back.b }, { a: start.a, b: start.b });
  });

  it('без ошибок в консоли', () => { assert.deepEqual(app.errors, []); });
});
