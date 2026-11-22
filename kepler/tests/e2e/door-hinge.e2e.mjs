// Дверь при вставке: петли — строго с одной стороны, не мерцают от положения мыши
// вдоль стены; Пробел переключает ТОЛЬКО левую/правую сторону петель.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, openSample } from './helpers.mjs';

describe('дверь: петли не мерцают, Пробел — только слева/справа', () => {
  let app;
  before(async () => { app = await startApp(); await openSample(app.page); });
  after(async () => { await app?.close(); });

  it('мышь вдоль стены не меняет петли; Пробел меняет и больше ничего', async () => {
    const { page } = app;
    const pts = await page.evaluate(async () => {
      const { planToScreen } = await import('./ui/view.js');
      const { startPlaceOpening } = await import('./ui/tools.js');
      const k = window.__kepler;
      const w = k.state.walls.find((x) => x.kind === 'own' && x.orient === 'h' && x.to - x.from > 3500);
      startPlaceOpening('door');
      // Строка параметров инструмента сдвигает холст; вид компенсирует сдвиг
      // в ResizeObserver — координаты считаем после этого кадра.
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const mid = (w.center.y1 + w.center.y2) / 2;
      const cv = document.getElementById('canvas').getBoundingClientRect();
      const at = (t) => { const s = planToScreen(w.from + (w.to - w.from) * t, mid); return { x: cv.left + s.x, y: cv.top + s.y }; };
      return [0.35, 0.4, 0.45, 0.5, 0.55, 0.6, 0.65].map(at);
    });
    const ghost = () => page.evaluate(() => {
      const g = window.__kepler.state.ghostDoor;
      return g && { hingeStart: g.hingeStart, swingIn: g.swingIn };
    });
    const seen = new Set();
    for (const p of pts) {
      await page.mouse.move(p.x, p.y, { steps: 3 });
      const g = await ghost();
      assert.ok(g, 'есть превью двери');
      seen.add(g.hingeStart);
    }
    assert.equal(seen.size, 1, `петли не прыгают: ${[...seen]}`);
    const before = await ghost();
    await page.keyboard.press('Space');
    const after1 = await ghost();
    assert.notEqual(after1.hingeStart, before.hingeStart, 'Пробел переключил петли');
    assert.equal(after1.swingIn, before.swingIn, 'сторона открывания не менялась');
    // и после Пробела мышь по-прежнему ничего не переключает
    const seen2 = new Set();
    for (const p of pts) {
      await page.mouse.move(p.x, p.y, { steps: 3 });
      seen2.add((await ghost()).hingeStart);
    }
    assert.equal(seen2.size, 1);
    await page.keyboard.press('Space');
    assert.equal((await ghost()).hingeStart, before.hingeStart, 'второй Пробел вернул');
    await page.keyboard.press('Escape');
  });

  it('без ошибок в консоли', () => { assert.deepEqual(app.errors, []); });
});
