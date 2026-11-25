import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, openNew } from './helpers.mjs';

async function client(page, x, y) {
  const box = await page.locator('#canvas').boundingBox();
  const p = await page.evaluate(([x, y]) => window.__kepler.planToScreen(x, y), [x, y]);
  return { x: box.x + p.x, y: box.y + p.y };
}
async function drag(page, a, b) {
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 5 });
  await page.mouse.up();
}
async function marquee(page) {
  await drag(page, await client(page, -500, -500), await client(page, 6500, 5500));
}
const data = (page) => page.evaluate(() => {
  const { project } = window.__kepler.state;
  return JSON.parse(JSON.stringify({ rooms: project.rooms, items: project.items, walls: project.walls, openings: project.openings }));
});

describe('ручные стены в общем выделении', () => {
  let app;
  before(async () => { app = await startApp({ width: 1440, height: 1000 }); await openNew(app.page); });
  after(async () => { await app?.close(); });
  beforeEach(async () => {
    const { page } = app;
    await page.keyboard.press('Escape');
    await page.evaluate(async () => {
      const { createProject, createRoom, createItem } = await import('./core/model.js');
      const { restoreFrom } = await import('./ui/store.js');
      const { snapSettings } = await import('./ui/draw-snap-ui.js');
      const project = createProject();
      project.rooms.push(createRoom('living', 0, 0, 6000, 4000));
      project.items.push(createItem('sofa', 1500, 1500, 1500, 800));
      restoreFrom(project);
      Object.assign(window.__kepler.state.view, { scale: 0.06, panX: 300, panY: 180, rotation: 0 });
      Object.assign(snapSettings(), { objects: false, tracking: false, polar: false, ortho: false, guides: false });
      (await import('./ui/view.js')).requestDraw();
    });
    for (const [a, b] of [[[0, 5000], [5000, 5000]], [[3500, 2500], [5000, 2500]]]) {
      await page.keyboard.press('w');
      for (const p of [a, b]) {
        const c = await client(page, ...p);
        await page.mouse.click(c.x, c.y);
      }
      await page.keyboard.press('Escape');
    }
    await page.evaluate(async () => {
      const { createOpening } = await import('./core/model.js');
      const { mutate } = await import('./ui/store.js');
      const { project } = window.__kepler.state;
      const door = createOpening('door', null, 0, 0, 900);
      door.host = { wallId: project.walls[0].id, t: 1000 };
      delete door.side; delete door.offset;
      mutate(() => project.openings.push(door));
      window.__kepler.select(null);
    });
  });

  it('рамка включает обе W-стены, перенос за стену и стрелками двигает всю группу один раз', async () => {
    const { page } = app;
    const before = await data(page);
    await marquee(page);
    const sel = await page.evaluate(() => window.__kepler.state.selection);
    assert.equal(sel.type, 'multi');
    assert.deepEqual(sel.wallIds.toSorted(), before.walls.map((w) => w.id).toSorted());
    assert.match(await page.locator('.selection-toolbar-label').innerText(), /4/);
    await drag(page, await client(page, 3000, 5000), await client(page, 3500, 5500));
    const moved = await data(page);
    assert.deepEqual([moved.rooms[0].x, moved.rooms[0].y], [500, 500]);
    assert.deepEqual([moved.items[0].x, moved.items[0].y], [2000, 2000]);
    for (let i = 0; i < before.walls.length; i++) {
      assert.deepEqual(moved.walls[i].axis.a, { x: before.walls[i].axis.a.x + 500, y: before.walls[i].axis.a.y + 500 });
      assert.deepEqual(moved.walls[i].axis.b, { x: before.walls[i].axis.b.x + 500, y: before.walls[i].axis.b.y + 500 });
    }
    assert.deepEqual(moved.openings[0].host, before.openings[0].host);
    await page.keyboard.press('Control+z');
    assert.deepEqual(await data(page), before);
    await marquee(page);
    await page.keyboard.press('ArrowRight');
    const nudged = await data(page);
    const dx = nudged.rooms[0].x - before.rooms[0].x;
    assert.ok(dx > 0);
    assert.equal(nudged.walls[0].axis.a.x - before.walls[0].axis.a.x, dx);
    assert.equal(nudged.walls[1].axis.a.x - before.walls[1].axis.a.x, dx);
  });

  it('удаление группы убирает комнаты, мебель, ручные стены и их проёмы; отмена и повтор', async () => {
    const { page } = app;
    const before = await data(page);
    await page.keyboard.press('Control+a');
    await page.keyboard.press('Delete');
    assert.deepEqual(await data(page), { rooms: [], items: [], walls: [], openings: [] });
    await page.keyboard.press('Control+z');
    assert.deepEqual(await data(page), before);
    await page.keyboard.press('Control+y');
    assert.deepEqual(await data(page), { rooms: [], items: [], walls: [], openings: [] });
  });

  it('Shift-клик собирает группу только из ручных стен, её можно скопировать и удалить', async () => {
    const { page } = app;
    const before = await data(page);
    const first = await client(page, 3000, 5000);
    const second = await client(page, 4200, 2500);
    await page.mouse.click(first.x, first.y);
    await page.keyboard.down('Shift');
    await page.mouse.click(second.x, second.y);
    await page.keyboard.up('Shift');
    const sel = await page.evaluate(() => window.__kepler.state.selection);
    assert.equal(sel.wallIds.length, 2);
    assert.equal(sel.roomIds.length, 0);
    await page.keyboard.press('Control+d');
    const copied = await data(page);
    assert.equal(copied.walls.length, 4);
    assert.equal(copied.openings.length, 2);
    assert.ok(copied.walls.slice(2).some((w) => w.id === copied.openings[1].host.wallId));
    await page.keyboard.press('Delete');
    assert.deepEqual(await data(page), before);
    assert.deepEqual(app.errors, []);
  });

  it('копирование смешанной группы сохраняет стены, их владельцев и привязку двери', async () => {
    const { page } = app;
    const before = await data(page);
    await marquee(page);
    await page.keyboard.press('Control+c');
    await page.keyboard.press('Control+v');
    const copied = await data(page);
    assert.equal(copied.rooms.length, 2);
    assert.equal(copied.items.length, 2);
    assert.equal(copied.walls.length, 4);
    assert.equal(copied.openings.length, 2);
    assert.equal(copied.walls[3].ownerRoomId, copied.rooms[1].id);
    assert.equal(copied.openings[1].host.wallId, copied.walls[2].id);
    const dx = copied.rooms[1].x - before.rooms[0].x;
    const dy = copied.rooms[1].y - before.rooms[0].y;
    assert.deepEqual(copied.walls[2].axis.a, { x: before.walls[0].axis.a.x + dx, y: before.walls[0].axis.a.y + dy });
    await page.keyboard.press('Control+z');
    assert.deepEqual(await data(page), before);
    assert.deepEqual(app.errors, []);
  });
});
