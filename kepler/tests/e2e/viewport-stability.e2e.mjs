import assert from 'node:assert/strict';
import { test } from 'node:test';
import { openNew, settleView, startApp } from './helpers.mjs';

test('план приближается плавно, лёгкий обратный сигнал не вызывает скачок', async () => {
  const { page, close } = await startApp();
  try {
    await openNew(page);
    await settleView(page);
    const result = await page.evaluate(async () => {
      const canvas = document.getElementById('canvas');
      const box = canvas.getBoundingClientRect();
      const point = { x: 250, y: 180 };
      const { state, screenToWorld } = window.__kepler;
      const camera = () => ({ scale: state.view.scale, world: screenToWorld(point.x, point.y) });
      const wheel = (deltaY, deltaX = 0) => canvas.dispatchEvent(new WheelEvent('wheel', {
        deltaX, deltaY, clientX: box.left + point.x, clientY: box.top + point.y, cancelable: true,
      }));
      const frames = async (count) => {
        const samples = [];
        for (let i = 0; i < count; i++) {
          await new Promise(requestAnimationFrame);
          samples.push(camera());
        }
        return samples;
      };

      const before = camera();
      wheel(0, 10);
      const [horizontal] = await frames(2);
      wheel(-2);
      const small = (await frames(3)).at(-1);
      wheel(-98);
      const rising = await frames(3);
      wheel(2);
      const interrupted = await frames(5);
      wheel(-20);
      const finished = await frames(20);
      wheel(30);
      const reversed = await frames(20);
      return { before, horizontal, small, rising, interrupted, finished, reversed };
    });
    const { before, horizontal, small, rising, interrupted, finished, reversed } = result;
    assert.deepEqual(horizontal, before);
    assert.ok(small.scale > before.scale && small.scale < before.scale * 1.01);
    assert.ok(rising[0].scale < before.scale * 1.12, 'поворот колеса занимает несколько кадров');
    const frames = [small, ...rising, ...interrupted, ...finished];
    for (let i = 1; i < frames.length; i++) {
      assert.ok(frames[i].scale >= frames[i - 1].scale - 1e-10, 'масштаб не откатывается');
    }
    assert.ok(Math.abs(finished.at(-1).scale - before.scale * 1.12 ** 1.2) < 1e-9);
    assert.ok(Math.abs(reversed.at(-1).scale - before.scale * 1.12 ** 0.9) < 1e-9, 'намеренное отдаление работает');
    for (const { world } of frames.concat(reversed)) {
      assert.ok(Math.hypot(world.x - before.world.x, world.y - before.world.y) < 1e-7);
    }
  } finally {
    await close();
  }
});

test('кнопки «+» и «−» плавно меняют масштаб вокруг центра плана', async () => {
  const { page, close } = await startApp();
  try {
    await openNew(page);
    await settleView(page);
    const result = await page.evaluate(async () => {
      const canvas = document.getElementById('canvas');
      const { state, screenToWorld } = window.__kepler;
      const center = () => screenToWorld(canvas.clientWidth / 2, canvas.clientHeight / 2);
      const before = { scale: state.view.scale, world: center() };
      document.getElementById('zoomInBtn').click();
      await new Promise(requestAnimationFrame);
      const first = state.view.scale;
      for (let i = 0; i < 24; i++) await new Promise(requestAnimationFrame);
      const near = { scale: state.view.scale, world: center() };
      document.getElementById('zoomOutBtn').click();
      for (let i = 0; i < 24; i++) await new Promise(requestAnimationFrame);
      return { before, first, near, far: { scale: state.view.scale, world: center() } };
    });
    assert.ok(result.first > result.before.scale && result.first < result.before.scale * 1.25);
    assert.equal(result.near.scale, result.before.scale * 1.25);
    assert.ok(Math.abs(result.far.scale - result.before.scale) < 1e-10);
    for (const { world } of [result.near, result.far]) {
      assert.ok(Math.hypot(world.x - result.before.world.x, world.y - result.before.world.y) < 1e-7);
    }
  } finally {
    await close();
  }
});
