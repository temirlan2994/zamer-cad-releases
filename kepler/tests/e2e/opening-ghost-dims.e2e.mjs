// e2e: при вставке окна/двери под курсором — размеры до ближайшей стены или
// соседнего проёма слева и справа (core/opening-spacing.js openingGaps).
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, openSample } from './helpers.mjs';

describe('вставка проёма: размеры слева и справа', () => {
  let app;
  before(async () => { app = await startApp(); await openSample(app.page); });
  after(async () => { await app?.close(); });

  for (const kind of ['window', 'door']) {
    it(`${kind}: превью получает расстояния до обоих краёв`, async () => {
      const { page } = app;
      const target = await page.evaluate(async (openKind) => {
        const { planToScreen } = await import('./ui/view.js');
        const { startPlaceOpening } = await import('./ui/tools.js');
        const k = window.__kepler;
        startPlaceOpening(openKind);
        // Строка параметров инструмента сдвигает холст, вид компенсирует это
        // на следующем кадре; каталог проёмов (.library) открывается поверх
        // левой части холста — берём стену, точка которой видна на холсте.
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        const cv = document.getElementById('canvas');
        const box = cv.getBoundingClientRect();
        const at = (w) => {
          const s = planToScreen(w.from + (w.to - w.from) * 0.3, (w.center.y1 + w.center.y2) / 2);
          return { x: box.left + s.x, y: box.top + s.y };
        };
        const w = k.state.walls.find((x) => {
          if (x.kind !== 'own' || x.orient !== 'h' || x.to - x.from <= 3000) return false;
          const p = at(x);
          return document.elementFromPoint(p.x, p.y) === cv;
        });
        return w && at(w);
      }, kind);
      assert.ok(target, 'есть видимая стена для превью');
      await page.mouse.move(target.x, target.y, { steps: 4 });
      const gaps = await page.evaluate(async () => {
        const { openingGaps } = await import('./core/opening-spacing.js');
        const k = window.__kepler;
        const op = k.state.ghostDoor || k.state.ghostOpeningFull;
        if (!op) return null;
        const g = openingGaps(k.state.project, op, k.state.walls);
        return g && { left: g.from - g.left, right: g.right - g.to };
      });
      assert.ok(gaps, 'есть превью проёма');
      assert.ok(gaps.left > 0 && gaps.right > 0, `слева ${gaps.left}, справа ${gaps.right}`);
      await page.keyboard.press('Escape');
    });
  }
  it('панель параметров до вставки; инструмент остаётся активным — несколько окон подряд', async () => {
    const { page } = app;
    const pts = await page.evaluate(async () => {
      const { planToScreen } = await import('./ui/view.js');
      const { startPlaceOpening } = await import('./ui/tools.js');
      const k = window.__kepler;
      startPlaceOpening('window');
      // Ждём компенсацию сдвига холста (строка параметров) и берём длинную
      // стену, целиком видимую на холсте: каталог проёмов закрывает левую часть.
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const cv = document.getElementById('canvas');
      const box = cv.getBoundingClientRect();
      const T = [0.15, 0.3, 0.45, 0.6, 0.75, 0.9];
      const at = (w, t) => {
        const s = planToScreen(w.from + (w.to - w.from) * t, (w.center.y1 + w.center.y2) / 2);
        return { x: box.left + s.x, y: box.top + s.y };
      };
      const visible = (w) => T.every((t) => { const p = at(w, t); return document.elementFromPoint(p.x, p.y) === cv; });
      const w = k.state.walls.filter((x) => x.kind === 'own' && x.orient === 'h' && x.to - x.from > 4500 && visible(x))
        .sort((a, b) => (b.to - b.from) - (a.to - a.from))[0];
      return { spots: w ? T.map((t) => at(w, t)) : [], n0: k.state.project.openings.length };
    });
    assert.ok(pts.spots.length, 'есть видимая длинная стена');
    await page.waitForSelector('#presetW', { state: 'visible' });
    await page.fill('#presetW', '700');
    await page.press('#presetW', 'Tab');
    // Несколько кликов подряд по разным местам стены: часть мест может быть занята соседями.
    for (const p of pts.spots) {
      await page.mouse.move(p.x, p.y, { steps: 3 });
      await page.mouse.down(); await page.mouse.up();
    }
    const res = await page.evaluate((n0) => {
      const k = window.__kepler;
      const added = k.state.project.openings.slice(n0);
      return { added: added.map((o) => o.width), tool: k.state.tool?.kind || null };
    }, pts.n0);
    assert.ok(res.added.length >= 2, `поставлено окон подряд: ${res.added.length}`);
    assert.ok(res.added.every((w) => w === 700), 'все окна шириной 700 из панели параметров');
    assert.equal(res.tool, 'place-opening', 'инструмент активен');
    await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(() => window.__kepler.state.tool?.kind || null), null);
  });

  it('без ошибок в консоли', () => { assert.deepEqual(app.errors, []); });
});
