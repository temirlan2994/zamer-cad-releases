// e2e «Разделить» стену: линия деления за курсором, клик или цифры+Enter режут, Esc отменяет.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, openSample } from './helpers.mjs';

describe('разделить стену: отступ от торца', () => {
  let app;
  let splitRoom = null; // комната из первого теста: её стены после деления меняются
  before(async () => { app = await startApp(); await openSample(app.page); });
  after(async () => { await app?.close(); });

  const pickWall = (exclude = null) => app.page.evaluate((skip) => {
    const k = window.__kepler;
    const w = k.state.walls.find((x) => x.kind === 'own' && x.orient === 'h' && x.to - x.from > 3000 && x.rooms[0] !== skip);
    k.select({ type: 'wall', key: w.key, from: w.from });
    return { key: w.key, from: w.from, to: w.to, room: w.rooms[0] };
  }, exclude);
  // Панель выделения перерисовывается асинхронно — ждём кнопку, а не кликаем вслепую.
  const pickWallReady = async (exclude = null) => {
    const w = await pickWall(exclude);
    await app.page.waitForSelector('[data-selection-action="split-wall"]:not([disabled])', { timeout: 5000 });
    return w;
  };
  const verts = (id) => app.page.evaluate((rid) => {
    const r = window.__kepler.state.project.rooms.find((x) => x.id === rid);
    return r.outline ? r.outline.length : 4;
  }, id);

  const edit = () => app.page.evaluate(() => { const e = window.__kepler.state.splitEdit; return e ? { along: e.along, typed: e.typed } : null; });

  it('«Разделить» включает линию деления, цифры задают размер, Enter делит', async () => {
    const w = await pickWallReady();
    splitRoom = w.room;
    const v0 = await verts(w.room);
    await app.page.click('[data-selection-action="split-wall"]');
    assert.ok(await edit(), 'режим деления включён');
    assert.equal(await app.page.locator('#splitInput').count(), 0, 'плашки с полем больше нет');
    await app.page.keyboard.type('1200');
    const e = await edit();
    assert.equal(e.typed, '1200');
    await app.page.keyboard.press('Enter');
    assert.equal(await edit(), null);
    assert.equal(await verts(w.room), v0 + 2, 'две совпадающие вершины добавлены');
  });

  it('линия идёт за курсором, клик режет, Esc отменяет', async () => {
    await app.page.keyboard.press('Escape');
    const w = await pickWallReady(splitRoom);
    const v0 = await verts(w.room);
    await app.page.click('[data-selection-action="split-wall"]');
    const a0 = (await edit()).along;
    // Курсор вдоль стены: линия переезжает.
    const pos = await app.page.evaluate(async (wall) => {
      const { planToScreen } = await import('./ui/view.js');
      const k = window.__kepler; const cv = document.getElementById('canvas').getBoundingClientRect();
      const ww = k.state.walls.find((x) => x.key === wall.key && x.from === wall.from);
      const perp = (ww.center.y1 + ww.center.y2) / 2;
      const p = planToScreen(wall.from + (wall.to - wall.from) * 0.7, perp);
      return { x: cv.left + p.x, y: cv.top + p.y };
    }, w);
    await app.page.mouse.move(pos.x, pos.y, { steps: 4 });
    const a1 = (await edit()).along;
    assert.ok(a1 !== a0 && Math.abs(a1 - (w.from + (w.to - w.from) * 0.7)) < 200, 'линия на курсоре');
    await app.page.keyboard.press('Escape');
    assert.equal(await edit(), null);
    assert.equal(await verts(w.room), v0, 'Esc — без изменений');
    // Снова: клик режет.
    await app.page.click('[data-selection-action="split-wall"]');
    await app.page.mouse.move(pos.x, pos.y, { steps: 4 });
    await app.page.mouse.down(); await app.page.mouse.up();
    assert.equal(await edit(), null);
    assert.equal(await verts(w.room), v0 + 2, 'клик разделил стену');
  });

  it('зум колесом: линия остаётся под курсором, не прыгает', async () => {
    await app.page.keyboard.press('Escape');
    const w = await pickWallReady(splitRoom);
    await app.page.click('[data-selection-action="split-wall"]');
    const pos = await app.page.evaluate(async (wall) => {
      const { planToScreen } = await import('./ui/view.js');
      const cv = document.getElementById('canvas').getBoundingClientRect();
      const ww = window.__kepler.state.walls.find((x) => x.key === wall.key && x.from === wall.from);
      const p = planToScreen(wall.from + (wall.to - wall.from) * 0.6, (ww.center.y1 + ww.center.y2) / 2);
      return { x: cv.left + p.x, y: cv.top + p.y };
    }, w);
    await app.page.mouse.move(pos.x, pos.y, { steps: 3 });
    await app.page.mouse.wheel(0, -300);
    // После зума линия — под неподвижным курсором (на экране), а не на старом месте плана.
    const dist = await app.page.evaluate(async ({ wall, pos }) => {
      const { planToScreen } = await import('./ui/view.js');
      const cv = document.getElementById('canvas').getBoundingClientRect();
      const ww = window.__kepler.state.walls.find((x) => x.key === wall.key && x.from === wall.from);
      const along = window.__kepler.state.splitEdit.along;
      const p = planToScreen(along, (ww.center.y1 + ww.center.y2) / 2);
      return Math.hypot(cv.left + p.x - pos.x, cv.top + p.y - pos.y);
    }, { wall: w, pos });
    assert.ok(dist < 30, `линия ушла от курсора на ${Math.round(dist)} px при зуме`);
    await app.page.keyboard.press('Escape');
  });

  it('без ошибок в консоли', () => { assert.deepEqual(app.errors, []); });
});
