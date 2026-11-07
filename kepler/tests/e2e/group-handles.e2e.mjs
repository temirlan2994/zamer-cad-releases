// Группа мебели: повторные клики по выбранной группе переключают ручки
// общей рамки — выбор → поворот → растяжение → масштаб; поворот группы
// поворачивает все предметы, Ctrl+Z возвращает одним шагом.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, openSample, zoomToItems } from './helpers.mjs';

describe('группа мебели: режимы ручек общей рамки', () => {
  let app;
  let ids;
  before(async () => {
    app = await startApp({ width: 1400, height: 900 });
    await openSample(app.page);
    // Три предмета без поворота в свободном месте — для надёжных кликов.
    ids = await app.page.evaluate(() => {
      const k = window.__kepler.state;
      const list = k.project.items.filter((i) => !i.comp && i.w >= 500 && i.h >= 400).slice(0, 3);
      const room = k.project.rooms.reduce((a, b) => (a.w * a.h >= b.w * b.h ? a : b));
      const cx = room.x + room.w / 2;
      const cy = room.y + room.h / 2;
      list.forEach((it, n) => {
        it.rotation = 0; it.w = 600; it.h = 500; it.group = undefined;
        it.x = cx - 900 + n * 900; it.y = cy + (n === 1 ? 700 : 0);
      });
      window.__kepler.fitView?.();
      return list.map((i) => i.id);
    });
    assert.equal(ids.length, 3);
    await zoomToItems(app.page, 0.12, ids);
  });
  after(async () => { await app?.close(); });

  const toClient = async (x, y) => {
    const box = await (await app.page.$('#canvas')).boundingBox();
    const s = await app.page.evaluate(([px, py]) => window.__kepler.planToScreen(px, py), [x, y]);
    return { x: box.x + s.x, y: box.y + s.y };
  };
  const items = () => app.page.evaluate((list) => {
    const k = window.__kepler.state;
    return list.map((id) => {
      const it = k.project.items.find((i) => i.id === id);
      return { id, x: it.x, y: it.y, w: it.w, h: it.h, rotation: it.rotation || 0 };
    });
  }, ids);
  const mode = () => app.page.evaluate(async () => {
    const m = await import('./core/group-handles.js');
    const h = await import('./core/item-handles.js');
    const k = window.__kepler.state;
    const id = m.groupHandleId(k.selection);
    return id ? h.itemHandleMode(k.itemHandle, id) : null;
  });
  async function click(p, opts = {}) {
    const c = await toClient(p.x, p.y);
    if (opts.shift) await app.page.keyboard.down('Shift');
    await app.page.mouse.click(c.x, c.y);
    if (opts.shift) await app.page.keyboard.up('Shift');
    await app.page.waitForTimeout(80);
  }

  it('Shift+клик по трём предметам — группа; клики по ней: выбор → поворот → растяжение → масштаб → выбор', async () => {
    const [a, b, c] = await items();
    await click(a);
    await click(b, { shift: true });
    await click(c, { shift: true });
    const sel = await app.page.evaluate(() => window.__kepler.state.selection);
    assert.equal(sel.type, 'multi');
    assert.deepEqual([...sel.itemIds].sort(), [...ids].sort());
    const seen = [await mode()];
    for (let i = 0; i < 4; i += 1) { await click(a); seen.push(await mode()); }
    assert.deepEqual(seen, ['select', 'rotate', 'stretch', 'scale', 'select']);
    // Клики не сдвинули предметы.
    assert.deepEqual(await items(), [a, b, c]);
  });

  it('поворот группы за круг у угла: все предметы повернулись, Ctrl+Z возвращает', async () => {
    const start = await items();
    await click(start[0]); // → rotate
    assert.equal(await mode(), 'rotate');
    const geo = await app.page.evaluate(async () => {
      const m = await import('./core/group-handles.js');
      const k = window.__kepler.state;
      const box = m.groupBounds(m.groupItems(k.project, k.selection));
      const r = m.groupRotators(box, 20, k.view.scale).find((x) => x.id === 'se');
      return { c: m.groupCenter(box), r };
    });
    const { c, r } = geo;
    const rad = Math.hypot(r.x - c.x, r.y - c.y);
    const a0 = Math.atan2(r.y - c.y, r.x - c.x);
    const p0 = await toClient(r.x, r.y);
    await app.page.mouse.move(p0.x, p0.y);
    await app.page.mouse.down();
    for (let s = 1; s <= 10; s += 1) {
      const ang = a0 + (Math.PI / 2) * (s / 10);
      const p = await toClient(c.x + rad * Math.cos(ang), c.y + rad * Math.sin(ang));
      await app.page.mouse.move(p.x, p.y);
    }
    await app.page.mouse.up();
    const after1 = await items();
    for (let i = 0; i < 3; i += 1) {
      const s = start[i];
      const t = after1[i];
      assert.equal(t.rotation, (s.rotation + 90) % 360, `${s.id}: поворот`);
      // Центр: (dx, dy) → (-dy, dx) вокруг центра рамки.
      assert.ok(Math.abs(t.x - (c.x - (s.y - c.y))) < 1, `${s.id}: x`);
      assert.ok(Math.abs(t.y - (c.y + (s.x - c.x))) < 1, `${s.id}: y`);
      assert.equal(t.w, s.w); assert.equal(t.h, s.h);
    }
    await app.page.keyboard.press('Control+z');
    await app.page.waitForTimeout(80);
    assert.deepEqual(await items(), start, 'один шаг отмены возвращает группу');
  });

  it('Esc выходит из режима ручек группы, группа остаётся выбранной', async () => {
    // Отмена снимает выбор — выделяем группу заново и включаем поворот.
    const [a, b, c] = await items();
    await click(a);
    await click(b, { shift: true });
    await click(c, { shift: true });
    const sel0 = await app.page.evaluate(() => window.__kepler.state.selection);
    await click(a);
    assert.equal(await mode(), 'rotate');
    await app.page.keyboard.press('Escape');
    assert.equal(await mode(), 'select');
    const sel = await app.page.evaluate(() => window.__kepler.state.selection);
    assert.equal(sel?.type, 'multi');
    assert.deepEqual(sel.itemIds, sel0.itemIds);
    assert.deepEqual(app.errors, []);
  });
});
