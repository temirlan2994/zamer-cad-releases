// e2e «Помещение» из петли стен: нарисовать 4 стены, кнопкой «Помещение»
// кликнуть внутри петли — вместо стен обычная комната. Дальше она ведёт
// себя как нарисованная: ручка стороны, магнит к соседу (общая стена),
// наезд — «съедает» соседа, копия Ctrl+D, отмена/повтор, перезагрузка.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, openNew, clickWorld, worldToClient } from './helpers.mjs';

const plan = (page) => page.evaluate(() => {
  const { state } = window.__kepler;
  return {
    rooms: state.project.rooms.map((r) => ({ id: r.id, x: r.x, y: r.y, w: r.w, h: r.h, bound: 'bound' in r })),
    walls: state.project.walls.length,
    selection: state.selection,
  };
});

async function drag(page, a, b, { up = true } = {}) {
  const from = await worldToClient(page, a[0], a[1]);
  const to = await worldToClient(page, b[0], b[1]);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 });
  if (up) await page.mouse.up();
}

describe('помещение из петли стен — обычная комната', () => {
  let app;
  let id;
  before(async () => {
    app = await startApp();
    await openNew(app.page);
    await app.page.evaluate(() => {
      const { state } = window.__kepler;
      state.view.scale = 0.08;
      state.view.panX = 300;
      state.view.panY = 250;
    });
  });
  after(async () => { await app?.close(); });

  it('4 стены → «Помещение» → клик внутри: стены стали стенами комнаты', async () => {
    const { page } = app;
    await page.click('#wallToolBtn');
    for (const [x, y] of [[0, 0], [4000, 0], [4000, 3000], [0, 3000], [0, 0]]) await clickWorld(page, x, y);
    await page.keyboard.press('Enter');
    const t = await page.evaluate(() => window.__kepler.state.project.walls[0].thickness);
    assert.equal((await plan(page)).walls, 4);
    await page.click('#boundRoomBtn');
    assert.equal(await page.evaluate(() => window.__kepler.state.tool?.kind), 'bound-room');
    await clickWorld(page, 6000, 1500); // снаружи — ничего
    assert.equal((await plan(page)).rooms.length, 0);
    await clickWorld(page, 2000, 1500);
    const s = await plan(page);
    assert.equal(s.rooms.length, 1);
    assert.equal(s.walls, 0, 'ручных стен не осталось');
    const [r] = s.rooms;
    id = r.id;
    assert.deepEqual(r, { id, x: t / 2, y: t / 2, w: 4000 - t, h: 3000 - t, bound: false });
    assert.deepEqual(s.selection, { type: 'room', id });
    assert.equal(await page.evaluate(() => window.__kepler.state.tool), null);
    // Стены — стены комнаты той же толщины.
    const own = await page.evaluate((rid) => window.__kepler.state.walls
      .filter((w) => w.kind === 'own' && w.rooms[0] === rid).map((w) => w.thickness), id);
    assert.equal(own.length, 4);
    assert.ok(own.every((x) => x === t), JSON.stringify(own));
  });

  it('ручка стороны тянет комнату; отмена и повтор', async () => {
    const { page } = app;
    const [r0] = (await plan(page)).rooms;
    await drag(page, [r0.x + r0.w, r0.y + r0.h / 2], [r0.x + r0.w + 1000, r0.y + r0.h / 2]);
    const [r1] = (await plan(page)).rooms;
    assert.ok(Math.abs(r1.w - r0.w - 1000) <= 100, `ширина ${r0.w} → ${r1.w}`);
    assert.equal(r1.x, r0.x);
    await page.keyboard.press('Control+z');
    assert.equal((await plan(page)).rooms[0].w, r0.w);
    await page.keyboard.press('Control+Shift+z');
    assert.equal((await plan(page)).rooms[0].w, r1.w);
  });

  it('магнит к соседу — общая стена; наезд — замечание, как у обычной', async () => {
    const { page } = app;
    const [r] = (await plan(page)).rooms;
    const nx = r.x + r.w + 1500;
    await page.evaluate(async ({ x, y, h }) => {
      const { mutate } = await import('./ui/store.js');
      const { createRoom } = await import('./core/model.js');
      const { state } = window.__kepler;
      mutate(() => { const n = createRoom('bedroom', x, y, 3000, h); n.id = 'N'; state.project.rooms.push(n); });
    }, { x: nx, y: r.y, h: r.h });
    const partition = await page.evaluate(() => window.__kepler.state.project.settings.partition);
    // Тянем на 1440: магнит ставит зазор ровно в перегородку.
    const cy = r.y + r.h / 2;
    await drag(page, [r.x + 800, cy], [r.x + 800 + 1440, cy]);
    const docked = (await plan(page)).rooms.find((x) => x.id === id);
    assert.equal(nx - (docked.x + docked.w), partition, `зазор ${nx - (docked.x + docked.w)}`);
    const shared = await page.evaluate((rid) => window.__kepler.state.walls
      .some((w) => w.kind === 'shared' && w.rooms.includes(rid) && w.rooms.includes('N')), id);
    assert.ok(shared, 'общая стена с соседом');
    // Наезд — как у нарисованной комнаты: перенос разрешён, сдвинутая
    // «съедает» соседа (он короче, между ними перегородка, замечания нет);
    // Ctrl+Z возвращает обоих.
    const n0 = (await plan(page)).rooms.find((x) => x.id === 'N');
    await drag(page, [docked.x + 800, cy], [docked.x + 2800, cy]);
    const s1 = await plan(page);
    const over = s1.rooms.find((x) => x.id === id);
    const n1 = s1.rooms.find((x) => x.id === 'N');
    assert.ok(over.x > docked.x, 'комната сдвинута');
    assert.equal(n1.x, over.x + over.w + partition, 'сосед уменьшен до перегородки');
    await page.waitForFunction(() => (
      window.__kepler.state.analytics?.dirty === false
      && Boolean(window.__kepler.state.norms)
    ));
    const overlap = await page.evaluate(() => window.__kepler.state.norms.problems.some((x) => x.kind === 'overlap'));
    assert.ok(!overlap, 'замечания о перекрытии нет');
    await page.keyboard.press('Control+z');
    const s2 = await plan(page);
    const back = s2.rooms.find((x) => x.id === id);
    assert.deepEqual([back.x, back.y], [docked.x, docked.y]);
    assert.deepEqual(s2.rooms.find((x) => x.id === 'N'), n0, 'сосед восстановлен');
  });

  it('копия Ctrl+D — обычная копия; отмена и повтор', async () => {
    const { page } = app;
    await clickWorld(page, ...(await page.evaluate((rid) => {
      const r = window.__kepler.state.project.rooms.find((x) => x.id === rid);
      return [r.x + r.w / 2, r.y + r.h / 2];
    }, id)));
    assert.deepEqual((await plan(page)).selection, { type: 'room', id });
    const n0 = (await plan(page)).rooms.length;
    await page.keyboard.press('Control+d');
    const s = await plan(page);
    assert.equal(s.rooms.length, n0 + 1);
    assert.equal(s.walls, 0);
    const src = s.rooms.find((x) => x.id === id);
    const copy = s.rooms.find((x) => x.id === s.selection.id);
    assert.notEqual(copy.id, id);
    assert.deepEqual([copy.w, copy.h, copy.bound], [src.w, src.h, false]);
    await page.keyboard.press('Control+z');
    assert.equal((await plan(page)).rooms.length, n0);
    await page.keyboard.press('Control+Shift+z');
    assert.equal((await plan(page)).rooms.length, n0 + 1);
    await page.keyboard.press('Escape');
  });

  it('сохранение и перезагрузка: комнаты на месте', async () => {
    const { page } = app;
    const before = await plan(page);
    await page.evaluate(async () => {
      const store = await import('./ui/store.js');
      store.flushAutosave();
    });
    await page.reload();
    await page.waitForFunction(() => Boolean(window.__kepler) && window.__kepler.state.project.rooms?.length > 0);
    const after = await plan(page);
    assert.deepEqual(after.rooms, before.rooms);
    assert.equal(after.walls, 0);
  });

  it('без ошибок в консоли', () => {
    assert.deepEqual(app.errors, []);
  });
});
