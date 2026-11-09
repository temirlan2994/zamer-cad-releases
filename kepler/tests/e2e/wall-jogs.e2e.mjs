// e2e: файл пользователя со сдвигами помещений 10–50 мм открывается, стены
// на плане — без ступенек и зубцов (контур тела стен без рёбер < 50 мм)
// в трёх местах жалобы: Коридор 2, Постирочная, угол Гостиная/Холл/Гардеробная.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { startApp, openNew, uploadText } from './helpers.mjs';

const text = readFileSync(new URL('../fixtures/user-house-joints-2026-11.kepler.json', import.meta.url), 'utf8');

describe('стены без микроступенек (файл пользователя)', () => {
  let app;
  before(async () => { app = await startApp(); await openNew(app.page); });
  after(async () => { await app?.close(); });

  it('файл открывается, стены считает движок v2', async () => {
    await uploadText(app.page, '#fileInput', 'joints.kepler.json', text);
    await app.page.waitForFunction(() => window.__kepler.state.project.rooms.some((r) => r.name === 'Коридор 2'));
    const engine = await app.page.evaluate(async () => (await import('./core/walls.js')).wallsEngine(window.__kepler.state.project));
    assert.equal(engine, 'v2');
  });

  it('в областях жалобы нет рёбер контура стен короче 50 мм', async () => {
    const short = await app.page.evaluate(async () => {
      const { wallOutline } = await import('./core/walls.js');
      const { state } = window.__kepler;
      const boxes = {
        'Коридор 2': { x: 6700, y: -13800, w: 3900, h: 1900 },
        Постирочная: { x: 10100, y: -13600, w: 2900, h: 3500 },
        'угол у скрытой стены': { x: -500, y: -14000, w: 1000, h: 2000 },
        'низ комнат': { x: 2000, y: -10500, w: 11000, h: 600 },
      };
      const out = [];
      for (const c of wallOutline(state.walls)) {
        c.pts.forEach((a, i) => {
          const b = c.pts[(i + 1) % c.pts.length];
          const len = Math.hypot(b.x - a.x, b.y - a.y);
          if (len >= 49.5) return;
          for (const [name, q] of Object.entries(boxes)) {
            if (a.x >= q.x && a.x <= q.x + q.w && a.y >= q.y && a.y <= q.y + q.h) out.push(`${name}: ${a.x},${a.y} ${len}`);
          }
        });
      }
      return out;
    });
    assert.deepEqual(short, []);
  });

  it('без ошибок в консоли', () => {
    assert.deepEqual(app.errors, []);
  });
});
