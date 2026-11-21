// e2e среза 4 этапа 2 (docs/v7-stage2-plan.md): проёмы и стены на мосту v7,
// настоящей мышью, дом повёрнут на 45°.
//  • дверь, ушедшая под верхнюю комнату («сирота»), пропадает во время жеста
//    и возвращается на то же место, когда верхняя уходит; отмена/повтор;
//  • окно ставится инструментом на съеденную комнату;
//  • петля ручных стен → «Помещение» — обычная комната: ручки, поворот R.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { clickToolbarTool, startApp, openNew } from './helpers.mjs';

async function planToClient(page, x, y) {
  const box = await (await page.$('#canvas')).boundingBox();
  const s = await page.evaluate(([px, py]) => window.__kepler.planToScreen(px, py), [x, y]);
  return { x: box.x + s.x, y: box.y + s.y };
}
async function clickPlan(page, x, y) {
  const p = await planToClient(page, x, y);
  await page.mouse.click(p.x, p.y);
}
async function dragPlan(page, a, b, { mid = null } = {}) {
  const from = await planToClient(page, a[0], a[1]);
  const to = await planToClient(page, b[0], b[1]);
  await page.mouse.click(from.x, from.y);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 14 });
  const seen = mid ? await mid(page) : null;
  await page.mouse.up();
  return seen;
}
const openings = (page) => page.evaluate(() => window.__kepler.state.project.openings
  .map((o) => ({ id: o.id, kind: o.kind, roomId: o.roomId, side: o.side, offset: o.offset })));

describe('проёмы-сироты и окна на мосту v7, дом 45°', () => {
  let app;
  let door;
  before(async () => {
    app = await startApp();
    await openNew(app.page);
    await app.page.evaluate(async () => {
      const { mutate } = await import('./ui/store.js');
      const { createRoom } = await import('./core/model.js');
      const { state } = window.__kepler;
      mutate(() => {
        state.project.building.rotation = 45;
        const a = createRoom('living', 0, 0, 4000, 4000); a.id = 'A';
        const b = createRoom('bedroom', 6000, 0, 3000, 3000); b.id = 'B';
        state.project.rooms.push(a, b);
      });
      state.view.scale = 0.025; state.view.panX = 560; state.view.panY = 330; state.view.rotation = 0;
      window.__kepler.requestDraw?.();
    });
  });
  after(async () => { await app?.close(); });

  it('дверь инструментом на правую стену A', async () => {
    const { page } = app;
    await clickToolbarTool(page, 'doorToolBtn');
    await clickPlan(page, 4100, 3400);
    await page.keyboard.press('Escape');
    const list = await openings(page);
    assert.equal(list.length, 1, JSON.stringify(list));
    [door] = list;
    assert.equal(door.roomId, 'A');
    assert.equal(door.side, 1, 'правая сторона');
  });

  it('B накрыла дверь — пропала во время жеста; B ушла — вернулась на место', async () => {
    const { page } = app;
    const live = await dragPlan(page, [8500, 2500], [5500, 5500], { mid: openings }); // B: 3000…6000 × 3000…6000
    assert.equal(live.length, 0, 'во время жеста дверь уже под B');
    assert.equal((await openings(page)).length, 0);
    await dragPlan(page, [5500, 5500], [5500, 11500]);
    assert.deepEqual(await openings(page), [door], 'вернулась та же дверь, то же место');
    await page.keyboard.press('Control+z');
    assert.equal((await openings(page)).length, 0, 'отмена — снова под B');
    await page.keyboard.press('Control+y');
    assert.deepEqual(await openings(page), [door], 'повтор — снова на месте');
    await page.keyboard.press('Control+z');
  });

  it('окно ставится инструментом на съеденную комнату', async () => {
    const { page } = app;
    assert.ok(await page.evaluate(() => window.__kepler.state.project.rooms.find((r) => r.id === 'A').eatBase), 'A съедена');
    await clickToolbarTool(page, 'windowToolBtn');
    await clickPlan(page, 1500, -100);
    await page.keyboard.press('Escape');
    const win = (await openings(page)).find((o) => o.kind === 'window');
    assert.ok(win, 'окно поставлено');
    assert.equal(win.roomId, 'A');
    assert.equal(win.side, 0, 'верхняя сторона');
  });

  it('без ошибок в консоли', () => {
    assert.deepEqual(app.errors, []);
  });
});

describe('петля стен → помещение, дом 45°', () => {
  let app;
  before(async () => {
    app = await startApp();
    await openNew(app.page);
    await app.page.evaluate(async () => {
      const { mutate } = await import('./ui/store.js');
      const { state } = window.__kepler;
      mutate(() => { state.project.building.rotation = 45; });
      state.view.scale = 0.04; state.view.panX = 560; state.view.panY = 250; state.view.rotation = 0;
      window.__kepler.requestDraw?.();
    });
  });
  after(async () => { await app?.close(); });

  it('4 стены мышью → «Помещение» → обычная комната: ручки, поворот R, отмена', async () => {
    const { page } = app;
    await page.click('#wallToolBtn');
    for (const [x, y] of [[0, 0], [4000, 0], [4000, 3000], [0, 3000], [0, 0]]) await clickPlan(page, x, y);
    await page.keyboard.press('Enter');
    assert.equal(await page.evaluate(() => window.__kepler.state.project.walls.length), 4);
    await page.click('#boundRoomBtn');
    await clickPlan(page, 2000, 1500);
    const r = await page.evaluate(() => {
      const { state } = window.__kepler;
      const room = state.project.rooms[0];
      return room && { id: room.id, w: room.w, h: room.h, walls: state.project.walls.length, sel: state.selection };
    });
    assert.ok(r, 'комната создана');
    assert.equal(r.walls, 0, 'стены стали стенами комнаты');
    assert.deepEqual(r.sel, { type: 'room', id: r.id });
    const handles = await page.evaluate(async () => {
      const { roomHandles } = await import('./render.js');
      return roomHandles(window.__kepler.state.project.rooms[0]).length;
    });
    assert.equal(handles, 8, 'ручки как у обычной комнаты');
    await page.keyboard.press('r');
    const rot = await page.evaluate(() => { const x = window.__kepler.state.project.rooms[0]; return { w: x.w, h: x.h }; });
    assert.deepEqual(rot, { w: r.h, h: r.w }, 'поворот R');
    await page.keyboard.press('Control+z');
    const back = await page.evaluate(() => { const x = window.__kepler.state.project.rooms[0]; return { w: x.w, h: x.h }; });
    assert.deepEqual(back, { w: r.w, h: r.h });
  });

  it('без ошибок в консоли', () => {
    assert.deepEqual(app.errors, []);
  });
});
