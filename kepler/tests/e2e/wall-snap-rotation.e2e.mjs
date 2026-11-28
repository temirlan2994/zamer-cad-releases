// Координаты дома и участка различаются при повороте и переносе здания.
// Проверяем реальное черчение, подпись у курсора и ввод точной длины.
import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { openNew, startApp, settleCanvas } from './helpers.mjs';

async function planClient(page, point) {
  await settleCanvas(page);
  return page.evaluate((point) => {
    const box = document.getElementById('canvas').getBoundingClientRect();
    const p = window.__kepler.planToScreen(point.x, point.y);
    return { x: box.x+p.x, y: box.y+p.y };
  }, point);
}

const near = (a, b, label) => assert.ok(Math.abs(a - b) < 0.15, `${label}: ${a} / ${b}`);

describe('привязки стены при повёрнутом доме и виде', () => {
  let app;
  before(async () => { app = await startApp(); await openNew(app.page); });
  after(async () => { await app?.close(); });
  beforeEach(async () => {
    await app.page.keyboard.press('Escape');
    await app.page.evaluate(async () => {
      const { createProject } = await import('./core/model.js');
      const { restoreFrom } = await import('./ui/store.js');
      const { snapSettings } = await import('./ui/draw-snap-ui.js');
      const project = createProject('Поворот');
      project.building = { rotation: 17, origin: { x: 20000, y: 10000 } };
      restoreFrom(project);
      const { state } = window.__kepler;
      const rotation = -17 * Math.PI / 180;
      state.view = {
        scale: 0.1, rotation,
        panX: 430 - (20000 * Math.cos(rotation) - 10000 * Math.sin(rotation)) * 0.1,
        panY: 250 - (20000 * Math.sin(rotation) + 10000 * Math.cos(rotation)) * 0.1,
      };
      Object.assign(snapSettings(), { ortho: true, polar: false, objects: false, tracking: false });
      (await import('./ui/view.js')).requestDraw();
    });
  });

  it('орто идёт вдоль видимой стены, подпись и точный ввод совпадают с направлением', async () => {
    const { page } = app;
    await page.keyboard.press('w');
    const start = await planClient(page, { x: 0, y: 0 });
    await page.mouse.click(start.x, start.y);
    await page.mouse.move(start.x + 230, start.y + 30);
    const result = await page.evaluate(async () => {
      const { state } = window.__kepler;
      const point = state.tool.cursor;
      const p = window.__kepler.planToScreen(point.x, point.y);
      const { renderer, canvas } = await import('./ui/dom.js');
      const context = canvas.getContext('2d');
      const fillText = context.fillText;
      const labels = [];
      context.fillText = function (text, x, y, ...args) {
        if (text.startsWith('Орто ·')) labels.push({ text, x, y });
        return fillText.call(this, text, x, y, ...args);
      };
      try { renderer.draw(state); } finally { context.fillText = fillText; }
      return { point, p, snap: state.drawSnap, labels };
    });
    near(result.point.y, 0, 'стена идёт по горизонтали дома');
    assert.equal(result.snap.space, 'plan');
    assert.match(result.snap.tooltip, /0°$/);
    assert.equal(result.labels.length, 1);
    near(result.labels[0].x, result.p.x + 20, 'подпись возле конца стены');
    near(result.labels[0].y, result.p.y + 30, 'подпись возле конца стены');
    await page.keyboard.type('2400');
    await page.keyboard.press('Tab');
    await page.keyboard.type('0');
    await page.keyboard.press('Enter');
    const wall = await page.evaluate(() => window.__kepler.state.project.walls.at(-1));
    near(wall.axis.b.x - wall.axis.a.x, 2400, 'точная длина');
    near(wall.axis.b.y - wall.axis.a.y, 0, 'введённый угол');
  });

  it('произвольный угол вида задаёт экранные направления орто и полярки', async () => {
    const { page } = app;
    await page.evaluate(async () => {
      const { rotateViewTo, requestDraw } = await import('./ui/view.js');
      rotateViewTo(8 * Math.PI / 180); requestDraw();
    });
    await settleCanvas(page);
    await page.keyboard.press('w');
    const start = await planClient(page, { x: 0, y: 0 });
    await page.mouse.click(start.x, start.y);
    await page.mouse.move(start.x + 210, start.y + 30);
    let p = await page.evaluate(() => {
      const { tool } = window.__kepler.state;
      return [window.__kepler.planToScreen(tool.start.x, tool.start.y), window.__kepler.planToScreen(tool.cursor.x, tool.cursor.y)];
    });
    near(p[0].y, p[1].y, 'орто на экране');
    await page.evaluate(async () => {
      const { snapSettings } = await import('./ui/draw-snap-ui.js');
      Object.assign(snapSettings(), { ortho: false, polar: true, polarStep: 45 });
    });
    const anchor = await page.evaluate(() => ({ ...window.__kepler.state.tool.start }));
    const origin = await planClient(page, anchor);
    const box = await page.locator('#canvas').boundingBox();
    const directionY = origin.y-159 < box.y+20 ? 1 : -1;
    await page.mouse.move(origin.x + 160, origin.y + directionY*159);
    await settleCanvas(page);
    p = await page.evaluate(() => {
      const { tool } = window.__kepler.state;
      return [window.__kepler.planToScreen(tool.start.x, tool.start.y), window.__kepler.planToScreen(tool.cursor.x, tool.cursor.y)];
    });
    assert.ok(p[1].x-p[0].x > 150, 'указатель действительно переместился');
    near(p[1].x-p[0].x, directionY*(p[1].y-p[0].y), 'полярка 45° на экране');
  });

  it('привязки к участку и точкам стены используют координаты дома', async () => {
    const result = await app.page.evaluate(async () => {
      const { toWorld } = await import('./core/building.js');
      const { snapAt, snapSettings } = await import('./ui/draw-snap-ui.js');
      const { state } = window.__kepler;
      const local = [{ x: 3000, y: 1200 }, { x: 5000, y: 1200 }, { x: 5000, y: 4000 }];
      state.project.site.boundary = local.map((p) => toWorld(state.project.building, p));
      Object.assign(snapSettings(), { ortho: false, polar: false, objects: true, tracking: true });
      const end = snapAt({ x: 3020, y: 1220 }, {}, { space: 'plan' });
      const mid = snapAt({ x: 4010, y: 1210 }, {}, { space: 'plan' });
      const track = snapAt({ x: 3010, y: -2000 }, {}, { space: 'plan' });
      return { end, mid, track };
    });
    assert.equal(result.end.kind, 'end');
    near(result.end.point.x, 3000, 'угол X');
    near(result.end.point.y, 1200, 'угол Y');
    assert.equal(result.mid.kind, 'mid');
    near(result.mid.point.x, 4000, 'середина X');
    assert.equal(result.track.kind, 'track');
    near(result.track.point.x, 3000, 'выравнивание X');
    assert.deepEqual(app.errors, []);
  });

  it('торец стены тянется по новому направлению вида и возвращается при отмене', async () => {
    const { page } = app;
    await page.evaluate(async () => {
      const { addManualWall } = await import('./core/wall-manual.js');
      const { mutate } = await import('./ui/store.js');
      const { selectObject } = await import('./ui/tools.js');
      const { rotateViewTo } = await import('./ui/view.js');
      const { state } = window.__kepler;
      mutate(() => addManualWall(state.project, { x: 0, y: 0 }, { x: 2000, y: 0 }));
      selectObject({ type: 'wall', key: `m|${state.project.walls[0].id}` });
      rotateViewTo(8 * Math.PI / 180);
    });
    const a = await planClient(page, { x: 0, y: 0 });
    const b = await planClient(page, { x: 2000, y: 0 });
    await page.mouse.move(b.x, b.y);
    await page.mouse.down();
    await page.mouse.move(a.x + 270, a.y + 20, { steps: 4 });
    const preview = await page.evaluate(() => ({ snap: window.__kepler.state.drawSnap }));
    assert.equal(preview.snap.space, 'plan');
    await page.mouse.up();
    const wall = await page.evaluate(() => window.__kepler.state.project.walls[0]);
    const end = await planClient(page, wall.axis.b);
    near(a.y, end.y, 'конец стены по горизонтали экрана');
    await page.keyboard.press('Control+z');
    const restored = await page.evaluate(() => window.__kepler.state.project.walls[0].axis.b);
    assert.deepEqual(restored, { x: 2000, y: 0 });
    assert.deepEqual(app.errors, []);
  });
});
