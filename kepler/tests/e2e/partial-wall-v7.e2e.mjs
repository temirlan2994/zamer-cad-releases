// e2e: участок стены, когда грань комнаты лишь частично общая с соседом
// (жалоба: «стена не двигается, когда часть стены наружная и часть
// внутренняя»). Гардеробная 2800×1900 под Г-образным холлом, настоящей мышью;
// дом без поворота и под 45°. Г-холл — двумя способами: съеденный
// прямоугольник (гардеробная поверх его угла) и Г-комната с вырезом.
// Вторая часть: толщина/тип/скрытие из «Свойств» — только выделенный участок.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, openNew } from './helpers.mjs';

async function planToClient(page, x, y) {
  const box = await (await page.$('#canvas')).boundingBox();
  const s = await page.evaluate(([px, py]) => window.__kepler.planToScreen(px, py), [x, y]);
  return { x: box.x + s.x, y: box.y + s.y };
}

// shape: 'eat' — холл-прямоугольник, гардеробная поверх его левого нижнего
// угла (холл съеден → Г); 'notch' — холл с вырезом «sw», гардеробная под ним.
async function setup(page, { rotation, shape }) {
  await page.evaluate(async ({ rotation: rot, shape: kind }) => {
    const { mutate } = await import('./ui/store.js');
    const { selectObject } = await import('./ui/tools.js');
    const { createRoom } = await import('./core/model.js');
    const { state } = window.__kepler;
    selectObject(null);
    mutate(() => {
      state.project.building.rotation = rot;
      state.project.rooms.length = 0; state.project.items.length = 0; state.project.openings.length = 0;
      for (const k of Object.keys(state.project.wallOverrides)) delete state.project.wallOverrides[k];
      if (kind === 'eat') {
        const h = createRoom('hall', 0, 0, 6000, 4000); h.id = 'H'; h.name = 'Холл';
        const g = createRoom('wardrobe', -1000, 3000, 2800, 1900); g.id = 'G'; g.name = 'Гардеробная 2';
        state.project.rooms.push(h, g);
      } else {
        const h = createRoom('hall', 0, 0, 6000, 4000); h.id = 'H'; h.name = 'Холл';
        h.notch = { corner: 'sw', w: 3000, h: 2000 };
        const g = createRoom('wardrobe', 1500, 4100, 2800, 1900); g.id = 'G'; g.name = 'Гардеробная 2';
        state.project.rooms.push(h, g);
      }
    });
    state.view.scale = 0.05; state.view.panX = 640; state.view.panY = 330; state.view.rotation = 0;
    window.__kepler.requestDraw?.();
  }, { rotation, shape });
}

const snap = (page) => page.evaluate(() => {
  const { state } = window.__kepler;
  const nom = (id) => {
    const r = state.project.rooms.find((x) => x.id === id);
    const b = r.eatBase?.base || r;
    return { x: b.x, y: b.y, w: b.w, h: b.h, notch: b.notch ? { ...b.notch } : null, eaten: Boolean(r.eatBase) };
  };
  const shared = state.walls.filter((w) => w.kind === 'shared' && w.rooms.includes('G') && w.rooms.includes('H') && w.orient === 'h')
    .map((w) => ({ from: w.from, to: w.to, lo: w.band.y, hi: w.band.y + w.band.h, key: w.key }));
  return { g: nom('G'), h: nom('H'), shared };
});

// Тянуть общий горизонтальный участок G|H за тело на dy (мм плана).
async function dragShared(page, dys) {
  const s0 = await snap(page);
  assert.equal(s0.shared.length, 1, `один общий участок: ${JSON.stringify(s0)}`);
  const w = s0.shared[0];
  const cx = (w.from + w.to) / 2; const cy = (w.lo + w.hi) / 2;
  const at = await planToClient(page, cx, cy);
  await page.mouse.click(at.x, at.y);
  const sel = await page.evaluate(() => window.__kepler.state.selection);
  assert.equal(sel?.type, 'wall', `выделена стена: ${JSON.stringify(sel)}`);
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  const seen = [];
  for (const dy of dys) {
    const p = await planToClient(page, cx, cy + dy);
    await page.mouse.move(p.x, p.y, { steps: 6 });
    seen.push(await snap(page));
  }
  await page.mouse.up();
  return { s0, seen, end: await snap(page) };
}

for (const rotation of [0, 45]) {
  describe(`участок стены: съеденный Г-холл над гардеробной, дом ${rotation}°`, () => {
    let app;
    before(async () => {
      app = await startApp();
      await openNew(app.page);
      await setup(app.page, { rotation, shape: 'eat' });
    });
    after(async () => { await app?.close(); });

    it('общий участок ездит мышью туда-сюда; холл следует за гранью гардеробной', async () => {
      const { page } = app;
      const { s0, seen, end } = await dragShared(page, [-300, -800, -400, 300, 600, -500]);
      assert.equal(s0.h.eaten, true, 'холл съеден гардеробной (Г)');
      const dys = [-300, -800, -400, 300, 600, -500];
      seen.forEach((s, i) => {
        assert.equal(s.g.y, s0.g.y + dys[i], `верх гардеробной на шаге ${dys[i]}: ${JSON.stringify(s)}`);
        assert.equal(s.g.y + s.g.h, s0.g.y + s0.g.h, 'низ гардеробной на месте');
        assert.deepEqual({ x: s.h.x, y: s.h.y, w: s.h.w, h: s.h.h }, { x: 0, y: 0, w: 6000, h: 4000 }, 'номинал холла не меняется');
        assert.equal(s.shared.length, 1, `общий участок один: ${JSON.stringify(s.shared)}`);
        assert.equal(s.shared[0].hi, s.g.y, 'общая стена прилегает к гардеробной');
      });
      assert.equal(end.g.y, s0.g.y - 500);
      await page.keyboard.press('Control+z');
      assert.deepEqual(await snap(page), s0);
    });

    it('без ошибок в консоли', () => { assert.deepEqual(app.errors, []); });
  });
}

// Холл 2000..4000 над гардеробной 0..6000: верх гардеробной — своя 0..2000,
// общая 2000..4000, своя 4000..6000. Толщина/тип/скрытие — только участок.
describe('толщина и тип из «Свойств» — только выделенный участок, дом 45°', () => {
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
        state.project.building.rotation = 45;
        state.project.rooms.length = 0; state.project.items.length = 0; state.project.openings.length = 0;
        for (const k of Object.keys(state.project.wallOverrides)) delete state.project.wallOverrides[k];
        const h = createRoom('hall', 2000, 0, 2000, 3000); h.id = 'H'; h.name = 'Холл';
        const g = createRoom('wardrobe', 0, 3100, 6000, 1900); g.id = 'G'; g.name = 'Гардеробная 2';
        state.project.rooms.push(h, g);
      });
      state.view.scale = 0.05; state.view.panX = 560; state.view.panY = 250; state.view.rotation = 0;
      window.__kepler.requestDraw?.();
    });
  });
  after(async () => { await app?.close(); });

  const top = (page) => page.evaluate(() => window.__kepler.state.walls
    .filter((w) => w.rooms.includes('G') && w.orient === 'h' && Math.abs(w.edge - 3100) < 1 || (w.kind === 'shared'))
    .map((w) => ({ kind: w.kind, from: w.from, to: w.to, t: w.thickness, type: w.wallType, hidden: w.hidden }))
    .sort((a, b) => a.from - b.from));

  async function clickPiece(page, from, to) {
    const t = (await top(page)).find((w) => w.from === from && w.to === to);
    const at = await planToClient(page, (from + to) / 2, 3100 - t.t / 2);
    await page.mouse.click(at.x, at.y);
    const sel = await page.evaluate(() => window.__kepler.state.selection);
    assert.deepEqual([sel?.type, sel?.key, sel?.from], ['wall', 'e|G|0', from], JSON.stringify(sel));
  }

  it('толщина левого участка 400 — правый участок и общая как были; Ctrl+Z одним шагом', async () => {
    const { page } = app;
    const start = await top(page);
    assert.deepEqual(start.map((w) => [w.kind, w.from, w.to]), [['own', 0, 2000], ['shared', 2000, 4000], ['own', 4000, 6000]]);
    await clickPiece(page, 0, 2000);
    await page.fill('#wallT', '400');
    await page.press('#wallT', 'Enter'); // change, как у пользователя
    const now = await top(page);
    assert.deepEqual(now.map((w) => [w.from, w.t]), [[0, 400], [2000, 100], [4000, start[2].t]], JSON.stringify(now));
    const sel = await page.evaluate(() => window.__kepler.state.selection);
    assert.deepEqual([sel.key, sel.from], ['e|G|0', 0], 'выделен тот же участок');
    assert.equal(await page.inputValue('#wallT'), '400');
    await page.evaluate(() => document.activeElement?.blur());
    await page.keyboard.press('Control+z');
    assert.deepEqual(await top(page), start);
    await page.keyboard.press('Control+y');
    assert.deepEqual((await top(page)).map((w) => w.t), [400, 100, start[2].t]);
  });

  it('тип и скрытие правого участка — левый не меняется', async () => {
    const { page } = app;
    await clickPiece(page, 4000, 6000);
    await page.selectOption('#wallKind', 'partition');
    let now = await top(page);
    assert.deepEqual(now.map((w) => [w.from, w.type, w.t]), [[0, 'exterior', 400], [2000, 'partition', 100], [4000, 'partition', 100]]);
    await clickPiece(page, 4000, 6000);
    await page.getByRole('button', { name: /Скрыть стену/ }).click();
    now = await top(page);
    assert.deepEqual(now.map((w) => w.hidden), [false, false, true]);
  });

  it('без ошибок в консоли', () => { assert.deepEqual(app.errors, []); });
});

describe('участок стены: Г-холл с вырезом над гардеробной, дом 45°', () => {
  let app;
  before(async () => {
    app = await startApp();
    await openNew(app.page);
    await setup(app.page, { rotation: 45, shape: 'notch' });
  });
  after(async () => { await app?.close(); });

  it('общий участок двигает низ холла и верх гардеробной (Г-вырез — как перенос стороны)', async () => {
    const { page } = app;
    const dys = [-300, -700, 200, 500, -400];
    const { s0, seen, end } = await dragShared(page, dys);
    seen.forEach((s, i) => {
      assert.equal(s.g.y, s0.g.y + dys[i], `верх гардеробной на шаге ${dys[i]}: ${JSON.stringify(s)}`);
      assert.equal(s.h.y + s.h.h, s0.h.y + s0.h.h + dys[i], 'низ холла едет с ним');
      assert.equal(s.g.y - (s.h.y + s.h.h), 100, 'перегородка 100');
    });
    assert.equal(end.g.y, s0.g.y - 400);
    await page.keyboard.press('Control+z');
    assert.deepEqual(await snap(page), s0);
  });

  it('без ошибок в консоли', () => { assert.deepEqual(app.errors, []); });
});
