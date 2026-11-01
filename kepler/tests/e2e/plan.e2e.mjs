// e2e режима «План»: комнаты, мебель, история, мягкие отступы.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, openNew, dropOnCanvas, worldToClient } from './helpers.mjs';

const project = (page) => page.evaluate(() => {
  const p = window.__kepler.state.project;
  return { rooms: p.rooms.length, items: p.items.length, sel: window.__kepler.state.selection };
});

describe('план', () => {
  let app;
  before(async () => { app = await startApp(); await openNew(app.page); });
  after(async () => { await app?.close(); });

  it('перетаскивание комнаты на план создаёт ПУСТУЮ комнату', async () => {
    await dropOnCanvas(app.page, 'application/x-kepler-room', 'living');
    const p = await project(app.page);
    assert.equal(p.rooms, 1);
    assert.equal(p.items, 0, 'мебель по умолчанию не добавляется');
    assert.equal(p.sel?.type, 'room');
  });

  it('клик по карточке мебели кладёт её в комнату, панель не прыгает', async () => {
    await app.page.click('#libTabFurniture');
    const chip = await app.page.$('#furnitureItems .furniture-chip');
    // Метим DOM-узел: если панель перерисуется, метка пропадёт.
    await chip.evaluate((n) => { n.dataset.probe = '1'; });
    await chip.click();
    await chip.click();
    const p = await project(app.page);
    assert.equal(p.items, 2);
    assert.ok(await app.page.$('#furnitureItems .furniture-chip[data-probe="1"]'), 'панель мебели не перерисовывалась');
    // Оба предмета внутри комнаты.
    const inside = await app.page.evaluate(() => {
      const { rooms, items } = window.__kepler.state.project;
      const r = rooms[0];
      return items.every((i) => i.x > r.x && i.x < r.x + r.w && i.y > r.y && i.y < r.y + r.h);
    });
    assert.ok(inside);
  });

  it('отмена / повтор', async () => {
    await app.page.click('#undoBtn');
    assert.equal((await project(app.page)).items, 1);
    await app.page.click('#redoBtn');
    assert.equal((await project(app.page)).items, 2);
  });

  it('перетаскивание комнаты мышью сдвигает её', async () => {
    await app.page.click('#libTabRooms');
    const before = await app.page.evaluate(() => {
      const r = window.__kepler.state.project.rooms[0];
      return { x: r.x, y: r.y, cx: r.x + r.w / 2, cy: r.y + r.h / 2 };
    });
    // Захват у края комнаты (не по мебели в центре).
    const start = await worldToClient(app.page, before.x + 400, before.y + 400);
    const end = await worldToClient(app.page, before.x + 400 + 3000, before.y + 400);
    await app.page.mouse.move(start.x, start.y);
    await app.page.mouse.down();
    await app.page.mouse.move(end.x, end.y, { steps: 8 });
    await app.page.mouse.up();
    const after = await app.page.evaluate(() => window.__kepler.state.project.rooms[0].x);
    assert.ok(Math.abs(after - (before.x + 3000)) <= 200, `x: ${before.x} → ${after}`);
  });

  it('вне зоны застройки комната ставится с предупреждением, а не запрещается', async () => {
    await app.page.evaluate(() => {
      // Участок далеко от центра экрана — центр окажется вне зоны застройки.
      const s = window.__kepler.state.project.site;
      s.boundary = [{ x: 200000, y: 200000 }, { x: 230000, y: 200000 }, { x: 230000, y: 230000 }, { x: 200000, y: 230000 }];
    });
    const before = (await project(app.page)).rooms;
    await dropOnCanvas(app.page, 'application/x-kepler-room', 'kitchen');
    assert.equal((await project(app.page)).rooms, before + 1);
    assert.match(await app.page.textContent('#toast'), /⚠/);
  });

  it('без ошибок в консоли', () => {
    assert.deepEqual(app.errors, []);
  });
});
