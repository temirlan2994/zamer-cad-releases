// e2e среза 5 этапа 2 (docs/v7-stage2-plan.md): панель «Свойства» у
// съеденной комнаты показывает и правит НОМИНАЛ (полную форму блока), а
// видимую форму заново даёт съедание; площадь в ТЭП и экспликации — по
// видимой форме. Дом повёрнут на 45°.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, openNew } from './helpers.mjs';
import { createProject, createRoom } from '../../core/model.js';
import { reconcileEats } from '../../core/v7/eat-bridge.js';
import { roomShapeArea } from '../../core/room-shape.js';

const shapeOf = (r) => ({ x: r.x, y: r.y, w: r.w, h: r.h, outline: r.outline || null });
const shapes = (page) => page.evaluate(() => window.__kepler.state.project.rooms
  .map((r) => ({ id: r.id, x: r.x, y: r.y, w: r.w, h: r.h, outline: r.outline || null })));
const room = async (page, id) => (await shapes(page)).find((r) => r.id === id);

// Построение с нуля: A шириной aw, B сверху (позже в массиве).
function reference(aw) {
  const p = createProject('эталон');
  const a = createRoom('living', 0, 0, aw, 4000); a.id = 'A';
  const b = createRoom('bedroom', 3000, 3000, 3000, 3000); b.id = 'B';
  p.rooms.push(a, b);
  reconcileEats(p);
  return { a: shapeOf(a), b: shapeOf(b), area: (roomShapeArea(a) + roomShapeArea(b)) / 1e6 };
}

const num = (s) => Number(String(s).replace(/\s/g, '').replace(',', '.').replace(/[^\d.]/g, ''));

async function setWidth(page, w) {
  await page.fill('#roomW', String(w));
  await page.press('#roomW', 'Tab');
}

describe('свойства съеденной комнаты — по номиналу, дом под 45°', () => {
  let app;
  before(async () => {
    app = await startApp();
    await openNew(app.page);
    await app.page.evaluate(async () => {
      const { mutate } = await import('./ui/store.js');
      const { createRoom } = await import('./core/model.js');
      const { selectObject } = await import('./ui/tools.js');
      const { state } = window.__kepler;
      mutate(() => {
        state.project.building.rotation = 45;
        const a = createRoom('living', 0, 0, 4000, 4000); a.id = 'A';
        const b = createRoom('bedroom', 3000, 3000, 3000, 3000); b.id = 'B';
        state.project.rooms.push(a, b);
      });
      state.view.scale = 0.025; state.view.panX = 560; state.view.panY = 330; state.view.rotation = 0;
      selectObject({ type: 'room', id: 'A' });
      window.__kepler.requestDraw?.();
    });
  });
  after(async () => { await app?.close(); });

  it('A съедена, в панели — номинал 4000×4000 и подсказка', async () => {
    const { page } = app;
    const a = await room(page, 'A');
    assert.ok(a.outline, `A съедена (Г): ${JSON.stringify(a)}`);
    assert.deepEqual(a, { id: 'A', ...reference(4000).a });
    assert.equal(await page.inputValue('#roomW'), '4000');
    assert.equal(await page.inputValue('#roomH'), '4000');
    assert.ok(await page.isVisible('#roomNominalHint'));
  });

  it('ширина 5000 в панели — номинал растёт, видимая = построение с нуля, B выше', async () => {
    const { page } = app;
    await setWidth(page, 5000);
    const s = await shapes(page);
    const ref = reference(5000);
    assert.deepEqual(s.map((r) => r.id), ['A', 'B'], 'B по-прежнему сверху');
    assert.deepEqual(s.find((r) => r.id === 'A'), { id: 'A', ...ref.a });
    assert.deepEqual(s.find((r) => r.id === 'B'), { id: 'B', ...ref.b });
    const base = await page.evaluate(() => window.__kepler.state.project.rooms.find((r) => r.id === 'A').eatBase?.base);
    assert.deepEqual(base, { x: 0, y: 0, w: 5000, h: 4000 });
    assert.equal(await page.inputValue('#roomW'), '5000', 'панель — номинал');
  });

  it('обратно 4000 — то же, что сначала (не от видимой формы)', async () => {
    const { page } = app;
    await setWidth(page, 4000);
    assert.deepEqual(await room(page, 'A'), { id: 'A', ...reference(4000).a });
  });

  it('площадь в ТЭП и экспликации = видимая', async () => {
    const { page } = app;
    const ref = reference(4000);
    await page.click('#propsTabTep');
    await page.click('#tepTabRooms');
    const total = await page.$eval('#schedTable tfoot tr td.area', (td) => td.textContent);
    assert.ok(Math.abs(num(total) - ref.area) < 0.01, `«Общая» ${total} = видимая ${ref.area.toFixed(2)}`);
    assert.ok(num(total) < 25 - 1, 'без двойного счёта перекрытия');
    await page.click('#tepTabTep');
    const tep = await page.$eval('#tepRows', (el) => el.textContent);
    const m = tep.match(/Общая площадь дома\s*([\d\s,]+)/);
    assert.ok(m, tep);
    assert.ok(Math.abs(num(m[1]) - ref.area) < 0.06, `ТЭП ${m[1]} ≈ ${ref.area.toFixed(1)}`);
    await page.click('#propsTabMain');
  });

  it('отмена возвращает 5000, повтор — 4000', async () => {
    const { page } = app;
    await page.evaluate(async () => { const { undo } = await import('./ui/store.js'); undo(); });
    assert.deepEqual(await room(page, 'A'), { id: 'A', ...reference(5000).a });
    await page.evaluate(async () => { const { redo } = await import('./ui/store.js'); redo(); });
    assert.deepEqual(await room(page, 'A'), { id: 'A', ...reference(4000).a });
  });

  it('без ошибок в консоли', () => {
    assert.deepEqual(app.errors, []);
  });
});
