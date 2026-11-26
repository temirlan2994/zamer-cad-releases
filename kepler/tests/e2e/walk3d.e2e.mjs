import assert from 'node:assert/strict';
import { it } from 'node:test';
import { openNew, openSample, startApp } from './helpers.mjs';

const scene = (page) => page.evaluate(() => window.__kepler.debug3d());
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const project = (page) => page.evaluate(() => JSON.stringify(window.__kepler.state.project));

it('прогулка: реальное WASD, обзор мышью, защита модели и возврат камеры по Esc', async () => {
  const app = await startApp();
  try {
    const { page } = app;
    await openNew(page);
    await page.click('#view3dBtn');
    const previous = await scene(page), data = await project(page);
    const preferences = await page.evaluate(() => localStorage.getItem('kepler-3d-layers'));
    await page.click('#v3Walk');
    const initial = await scene(page);
    assert.equal(initial.walk.height, 1700);
    assert.equal(initial.cam.projection, 'perspective');
    await page.keyboard.down('w');
    await page.waitForFunction((p) => {
      const w = window.__kepler.debug3d().walk;
      return Math.hypot(w.x-p.x, w.y-p.y) > 300;
    }, initial.walk);
    await page.keyboard.up('w');
    const moved = await scene(page);
    assert.ok(distance(initial.walk, moved.walk) > 300);
    const canvas = await page.locator('#canvas3d').boundingBox();
    await page.mouse.move(canvas.x + canvas.width / 2, canvas.y + canvas.height / 2);
    await page.mouse.down();
    await page.mouse.move(canvas.x + canvas.width / 2 + 80, canvas.y + canvas.height / 2 + 25, { steps: 8 });
    await page.mouse.up();
    const looked = await scene(page);
    assert.ok(Math.abs(looked.cam.yaw - moved.cam.yaw) > 0.05);
    assert.ok(Math.abs(looked.cam.pitch - moved.cam.pitch) > 0.01);
    await page.keyboard.press('Delete'); await page.keyboard.press('m'); await page.keyboard.press('Control+z');
    assert.equal(await project(page), data);
    assert.equal(await page.evaluate(() => window.__kepler.state.tool), null);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !window.__kepler.debug3d().walk);
    assert.deepEqual((await scene(page)).cam, previous.cam);
    assert.equal((await scene(page)).active, true);
    assert.equal(await page.evaluate(() => localStorage.getItem('kepler-3d-layers')), preferences);
    assert.equal(await page.locator('#propsPanel').evaluate((e) => e.inert), false);
    await page.click('#v3Walk');
    await page.click('#v3Close');
    assert.equal((await scene(page)).walk, null);
    assert.equal(await page.locator('body').evaluate((e) => e.classList.contains('v3-walking')), false);
    assert.deepEqual(app.errors, []);
  } finally { await app.close(); }
});

it('пример дома: старт на полу, стены ограничивают движение, потеря фокуса останавливает WASD', async () => {
  const app = await startApp();
  try {
    const { page } = app;
    await openSample(page); await page.click('#view3dBtn');
    const data = await project(page);
    await page.click('#v3Walk');
    const initial = (await scene(page)).walk;
    assert.ok(initial && Number.isFinite(initial.z));
    assert.ok(Math.abs(initial.z) <= 2);
    await page.keyboard.down('w');
    await page.waitForFunction((start) => {
      const w = window.__kepler.debug3d().walk;
      if (Math.hypot(w.x-start.x, w.y-start.y) < 200) return false;
      const prev = window.walkTestPosition;
      if (!prev || Math.hypot(w.x-prev.x, w.y-prev.y) > .2) {
        window.walkTestPosition = { x: w.x, y: w.y, since: performance.now() };
        return false;
      }
      return performance.now() - prev.since > 500;
    }, initial, { polling: 100 });
    const stopped = (await scene(page)).walk;
    assert.ok(distance(initial, stopped) < 4000, 'стена удерживает персонажа при зажатой W');
    await page.keyboard.up('w');
    await page.keyboard.down('d');
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    const blurred = (await scene(page)).walk;
    await page.waitForTimeout(200);
    assert.deepEqual((await scene(page)).walk, blurred);
    await page.keyboard.up('d');
    await page.click('#v3Walk');
    assert.equal(await project(page), data);
    assert.deepEqual(app.errors, []);
  } finally { await app.close(); }
});

it('телефон: кнопка прогулки, движение удержанием кнопки и взгляд свайпом', async () => {
  const app = await startApp({ mobile: true });
  try {
    const { page } = app;
    await openNew(page); await page.tap('#view3dBtn');
    const previous = await scene(page);
    await page.tap('#v3Walk');
    const initial = await scene(page);
    const cdp = await page.context().newCDPSession(page);
    const button = await page.locator('[data-walk-key="KeyW"]').boundingBox();
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: button.x + 22, y: button.y + 22 }] });
    await page.waitForFunction((p) => {
      const w = window.__kepler.debug3d().walk;
      return Math.hypot(w.x-p.x, w.y-p.y) > 200;
    }, initial.walk);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    const box = await page.locator('#canvas3d').boundingBox();
    const x = box.x + box.width * .4, y = box.y + box.height * .5;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + 60, y: y + 20 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    assert.ok(Math.abs((await scene(page)).cam.yaw - initial.cam.yaw) > .05);
    await page.tap('#v3Walk');
    await page.waitForFunction(() => !window.__kepler.debug3d().walk);
    assert.deepEqual((await scene(page)).cam, previous.cam);
    assert.equal((await scene(page)).walk, null);
    assert.deepEqual(app.errors, []);
  } finally { await app.close(); }
});

it('прогулка начинается на выбранном этаже интерьера и возвращает его ракурс', async () => {
  const app = await startApp();
  try {
    const { page } = app;
    await page.getByRole('button', { name: /Двухэтажный · 4 спальни/ }).click();
    await page.click('#view3dBtn');
    await page.locator('.v3-views summary').click();
    await page.click('#v3EnterInterior');
    const level = await page.evaluate(() => window.__kepler.state.project.levels[1]);
    await page.selectOption('#v3InteriorLevel', level.id);
    const previous = await scene(page), data = await project(page);
    await page.click('#v3Walk');
    assert.ok(Math.abs((await scene(page)).walk.z - level.elevation) <= 2);
    await page.keyboard.press('Escape');
    assert.deepEqual((await scene(page)).cam, previous.cam);
    assert.deepEqual((await scene(page)).levelsShown, previous.levelsShown);
    assert.equal(await page.locator('#v3InteriorLevel').inputValue(), level.id);
    assert.equal(await project(page), data);
    assert.deepEqual(app.errors, []);
  } finally { await app.close(); }
});

it('прогулка доступна без WebGL: обрезка стен у ближней плоскости не вызывает ошибок', async () => {
  const app = await startApp();
  try {
    const { page } = app;
    await openSample(page);
    await page.evaluate(() => {
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (type, ...args) {
        return type.includes('webgl') ? null : original.call(this, type, ...args);
      };
    });
    await page.click('#view3dBtn'); await page.click('#v3Walk');
    assert.equal((await scene(page)).webgl, false);
    await page.keyboard.down('w'); await page.waitForTimeout(200); await page.keyboard.up('w');
    assert.ok(Number.isFinite((await scene(page)).walk.z));
    await page.keyboard.press('Escape');
    assert.equal((await scene(page)).walk, null);
    assert.deepEqual(app.errors, []);
  } finally { await app.close(); }
});
