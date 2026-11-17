// Граница участка: круглые ручки с «+» вставляют новый угол и тем же жестом
// позволяют его потянуть. Вставка и движение — одна операция Undo.
import {
  after, before, beforeEach, describe, it,
} from 'node:test';
import assert from 'node:assert/strict';
import { openNew, startApp, worldToClient } from './helpers.mjs';

const ORIGINAL = [
  { x: -10000, y: -8000 },
  { x: 10000, y: -8000 },
  { x: 10000, y: 8000 },
  { x: -10000, y: 8000 },
];

const boundary = (page) => page.evaluate(() => window.__kepler.state.project.site.boundary.map((p) => ({ ...p })));
const undoLength = (page) => page.evaluate(async () => (await import('./ui/state.js')).history.undo.length);

async function prepare(page) {
  await page.evaluate(() => window.__kepler.newProject());
  await page.evaluate(async (points) => {
    const { mutate } = await import('./ui/store.js');
    mutate(() => { window.__kepler.state.project.site.boundary = structuredClone(points); });
  }, ORIGINAL);
  await page.click('#modeSiteBtn');
  await page.click('[data-site-tool="boundary"]');
  await page.evaluate(() => window.__kepler.fitView());
}

describe('ручки добавления угла границы участка', () => {
  let app;
  before(async () => {
    app = await startApp();
    await openNew(app.page);
  });
  beforeEach(async () => { await prepare(app.page); });
  after(async () => { await app?.close(); });

  it('клик по кругу с плюсом вставляет вершину и отменяется одним шагом', async () => {
    const { page } = app;
    const undoBefore = await undoLength(page);
    const midpoint = await worldToClient(page, 0, -8000);
    await page.mouse.click(midpoint.x, midpoint.y);
    const result = await boundary(page);
    assert.equal(result.length, 5);
    assert.deepEqual(result[1], { x: 0, y: -8000 });
    assert.deepEqual([result[0], ...result.slice(2)], ORIGINAL);
    assert.equal(await undoLength(page), undoBefore + 1);
    await page.keyboard.press('Control+z');
    assert.deepEqual(await boundary(page), ORIGINAL);
  });

  it('новый угол можно сразу потянуть, и это всё ещё один шаг истории', async () => {
    const { page } = app;
    const undoBefore = await undoLength(page);
    const from = await worldToClient(page, 0, -8000);
    const to = await worldToClient(page, 0, -11000);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 6 });
    await page.mouse.up();
    const result = await boundary(page);
    assert.equal(result.length, 5);
    assert.ok(Math.abs(result[1].x) <= 100);
    assert.ok(result[1].y < -10000, `новый угол y=${result[1].y}`);
    assert.equal(await undoLength(page), undoBefore + 1);
    await page.keyboard.press('Control+z');
    assert.deepEqual(await boundary(page), ORIGINAL);
    assert.deepEqual(app.errors, []);
  });

  it('существующая квадратная вершина двигается без добавления ещё одной', async () => {
    const { page } = app;
    const from = await worldToClient(page, -10000, -8000);
    const to = await worldToClient(page, -11000, -9000);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 5 });
    await page.mouse.up();
    const result = await boundary(page);
    assert.equal(result.length, 4);
    assert.notDeepEqual(result[0], ORIGINAL[0]);
    await page.keyboard.press('Control+z');
    assert.deepEqual(await boundary(page), ORIGINAL);
  });
});

describe('добавление угла границы на телефоне', () => {
  let app;
  before(async () => {
    app = await startApp({ mobile: true });
    await openNew(app.page);
  });
  beforeEach(async () => {
    await app.page.evaluate(async (points) => {
      window.__kepler.newProject();
      const { mutate } = await import('./ui/store.js');
      const { setEditorMode } = await import('./ui/modes.js');
      const { activateSiteTool } = await import('./ui/toolstrip.js');
      mutate(() => { window.__kepler.state.project.site.boundary = structuredClone(points); });
      setEditorMode('site');
      activateSiteTool('boundary');
      window.__kepler.fitView();
    }, ORIGINAL);
  });
  after(async () => { await app?.close(); });

  it('тап по средней ручке вставляет угол, а не двигает вид', async () => {
    const { page } = app;
    const viewBefore = await page.evaluate(() => ({ ...window.__kepler.state.view }));
    const midpoint = await worldToClient(page, 0, -8000);
    await page.touchscreen.tap(midpoint.x, midpoint.y);
    const result = await boundary(page);
    assert.equal(result.length, 5);
    assert.deepEqual(result[1], { x: 0, y: -8000 });
    assert.deepEqual(await page.evaluate(() => ({ ...window.__kepler.state.view })), viewBefore);
    assert.deepEqual(app.errors, []);
  });

  it('на короткой стороне выбирает ближайший плюс, а не соседнюю вершину', async () => {
    const { page } = app;
    const short = [
      { x: -700, y: -3000 }, { x: 700, y: -3000 },
      { x: 700, y: 3000 }, { x: -700, y: 3000 },
    ];
    await page.evaluate(async (points) => {
      const { requestDraw } = await import('./ui/view.js');
      const state = window.__kepler.state;
      state.project.site.boundary = structuredClone(points);
      const canvas = document.getElementById('canvas');
      state.view = {
        scale: 0.03, rotation: 0,
        panX: canvas.clientWidth / 2, panY: canvas.clientHeight / 2,
      };
      requestDraw();
    }, short);
    const midpoint = await worldToClient(page, 0, -3000);
    await page.touchscreen.tap(midpoint.x, midpoint.y);
    const result = await boundary(page);
    assert.equal(result.length, 5);
    assert.deepEqual(result[1], { x: 0, y: -3000 });
  });
});
