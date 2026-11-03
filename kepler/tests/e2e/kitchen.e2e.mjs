// e2e: кухня-конструктор — форма П, галочка «Мойка», перетаскивание мойки
// мышью вдоль стороны, отмена.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, openNew, dropOnCanvas } from './helpers.mjs';

describe('кухня-конструктор', () => {
  let app;
  before(async () => {
    app = await startApp();
    await openNew(app.page);
    await dropOnCanvas(app.page, 'application/x-kepler-room', 'kitchen');
    await dropOnCanvas(app.page, 'application/x-kepler-furn', 'kitchen-row');
  });
  after(async () => { await app?.close(); });

  const kitchen = () => app.page.evaluate(() => window.__kepler.state.project.items.find((i) => i.kind === 'kitchen-row'));
  const sink = async () => (await kitchen()).comp.items.find((e) => e.type === 'sink');

  it('П-образная, галочка «Мойка», перетаскивание мойки, отмена', async () => {
    const k0 = await kitchen();
    assert.equal(k0.comp?.type, 'kitchen');
    await app.page.evaluate((id) => window.__kepler.select({ type: 'item', id }), k0.id);
    await app.page.waitForSelector('#compKitchen');
    await app.page.click('[data-kitchen-shape="U"]');
    await app.page.waitForFunction(() => window.__kepler.state.project.items.find((i) => i.kind === 'kitchen-row').comp.shape === 'U');
    assert.equal(await app.page.$$eval('[data-kitchen-len]', (l) => l.length), 3, 'три длины сторон');
    // Длина основной стороны — в панели (свободное место заполняется шкафами).
    await app.page.fill('[data-kitchen-len="main"]', '3600');
    await app.page.press('[data-kitchen-len="main"]', 'Enter');
    await app.page.waitForFunction(() => window.__kepler.state.project.items.find((i) => i.kind === 'kitchen-row').comp.len.main === 3600);
    // Снять и снова поставить «Мойку» — встаёт на первое свободное место основной стороны.
    await app.page.uncheck('[data-kitchen-el="sink"]');
    await app.page.waitForFunction(() => !window.__kepler.state.project.items.find((i) => i.kind === 'kitchen-row').comp.items.some((e) => e.type === 'sink'));
    await app.page.check('[data-kitchen-el="sink"]');
    await app.page.waitForFunction(() => window.__kepler.state.project.items.find((i) => i.kind === 'kitchen-row').comp.items.some((e) => e.type === 'sink'));
    const s0 = await sink();
    assert.deepEqual([s0.side, s0.x], ['main', 600]);
    // Тянем ручку мойки вдоль стороны на 600 мм.
    await app.page.waitForFunction(() => window.__kepler.state._kitchenUI?.handles?.some((h) => h.type === 'sink'));
    const { from, step } = await app.page.evaluate(() => {
      const K = window.__kepler;
      const it = K.state.project.items.find((i) => i.kind === 'kitchen-row');
      const h = K.state._kitchenUI.handles.find((q) => q.type === 'sink');
      const a = K.planToScreen(it.x, it.y);
      const b = K.planToScreen(it.x + 600, it.y);
      const px = Math.hypot(b.x - a.x, b.y - a.y); // 600 мм в пикселях
      return { from: { x: h.x, y: h.y }, step: { x: h.ux * px, y: h.uy * px } };
    });
    const box = await (await app.page.$('#canvas')).boundingBox();
    const kBefore = await kitchen();
    await app.page.mouse.move(box.x + from.x, box.y + from.y);
    await app.page.mouse.down();
    for (let i = 1; i <= 5; i += 1) await app.page.mouse.move(box.x + from.x + (step.x * i) / 5, box.y + from.y + (step.y * i) / 5);
    await app.page.mouse.up();
    const s1 = await sink();
    assert.deepEqual([s1.side, s1.x], ['main', 1200], 'мойка сдвинулась на 600 мм');
    const kAfter = await kitchen();
    assert.deepEqual([kAfter.x, kAfter.y], [kBefore.x, kBefore.y], 'кухня целиком не сдвинулась');
    await app.page.keyboard.press('Control+z');
    await app.page.waitForFunction(() => window.__kepler.state.project.items.find((i) => i.kind === 'kitchen-row').comp.items.find((e) => e.type === 'sink')?.x === 600);
    assert.deepEqual(app.errors, []);
  });
});
