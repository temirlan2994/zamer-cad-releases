// Мебель берётся мышью только при масштабе 1:165 и ближе (core/hit-stack.js,
// itemsEditable): издали клик и перетаскивание по мебели попадают в помещение
// под ней — комната едет вместе с мебелью; вблизи — выбирается и едет предмет.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, openNew } from './helpers.mjs';

// Масштаб (px/мм) для крупности 1:N — как в itemsEditable: N = round(96 / 25.4 / scale).
const scaleFor = (n) => 96 / 25.4 / n;

describe('мебель: выбор и перетаскивание зависят от масштаба', () => {
  let app; let ids;
  before(async () => {
    app = await startApp({ width: 1400, height: 900 });
    await openNew(app.page);
    // Комната 5×4 м, стол 1200×800 в её середине.
    ids = await app.page.evaluate(async () => {
      const m = await import('./core/model.js');
      const s = await import('./ui/store.js');
      const k = window.__kepler.state;
      const room = m.createRoom('living', 0, 0, 5000, 4000);
      const table = m.createItem('table', 2500, 2000, 1200, 800);
      s.mutate(() => { k.project.rooms.push(room); k.project.items.push(table); });
      return { room: room.id, table: table.id };
    });
  });
  after(async () => { await app?.close(); });

  // Масштаб 1:N, стол — в центре холста.
  const setScale = (n) => app.page.evaluate(([sc, id]) => {
    const k = window.__kepler;
    const it = k.state.project.items.find((i) => i.id === id);
    k.state.view.scale = sc;
    const c = document.getElementById('canvas');
    const s = k.planToScreen(it.x, it.y);
    k.state.view.panX += c.clientWidth / 2 - s.x;
    k.state.view.panY += c.clientHeight / 2 - s.y;
    k.requestDraw?.();
  }, [scaleFor(n), ids.table]);
  const state = () => app.page.evaluate(([rid, tid]) => {
    const k = window.__kepler.state;
    const r = k.project.rooms.find((v) => v.id === rid);
    const t = k.project.items.find((v) => v.id === tid);
    return { room: { x: r.x, y: r.y }, table: { x: t.x, y: t.y }, sel: k.selection ? { type: k.selection.type, id: k.selection.id } : null };
  }, [ids.room, ids.table]);
  const deselect = () => app.page.evaluate(async () => (await import('./ui/tools.js')).selectObject(null));
  async function tableClient() {
    const box = await (await app.page.$('#canvas')).boundingBox();
    const t = (await state()).table;
    const s = await app.page.evaluate(([x, y]) => window.__kepler.planToScreen(x, y), [t.x, t.y]);
    return { x: box.x + s.x, y: box.y + s.y };
  }
  async function clickTable() {
    await deselect();
    const p = await tableClient();
    await app.page.mouse.click(p.x, p.y);
    // Пауза, чтобы следующий клик не стал двойным (режим ручек).
    await app.page.waitForTimeout(450);
    return (await state()).sel;
  }
  async function dragTable(dx, dy) {
    const p = await tableClient();
    await app.page.mouse.move(p.x, p.y);
    await app.page.mouse.down();
    for (let i = 1; i <= 8; i += 1) await app.page.mouse.move(p.x + (dx * i) / 8, p.y + (dy * i) / 8);
    await app.page.mouse.up();
    await app.page.waitForTimeout(80);
  }

  it('издали (1:300) клик по мебели выбирает помещение', async () => {
    await setScale(300);
    assert.deepEqual(await clickTable(), { type: 'room', id: ids.room });
  });

  it('издали (1:300) перетаскивание за мебель двигает помещение вместе с мебелью', async () => {
    await setScale(300);
    await clickTable();
    const s0 = await state();
    await dragTable(120, 60);
    const s1 = await state();
    assert.ok(Math.hypot(s1.room.x - s0.room.x, s1.room.y - s0.room.y) > 500, `комната сдвинулась: ${JSON.stringify([s0.room, s1.room])}`);
    // Стол — на том же месте относительно комнаты.
    assert.ok(Math.abs((s1.table.x - s1.room.x) - (s0.table.x - s0.room.x)) < 1e-6, 'стол едет с комнатой по X');
    assert.ok(Math.abs((s1.table.y - s1.room.y) - (s0.table.y - s0.room.y)) < 1e-6, 'стол едет с комнатой по Y');
    assert.deepEqual((await state()).sel, { type: 'room', id: ids.room }, 'выбрана комната, не стол');
    await app.page.keyboard.press('Control+z');
    assert.deepEqual((await state()).room, s0.room, 'отмена вернула комнату');
  });

  it('вблизи (1:40) клик выбирает предмет, перетаскивание двигает только его', async () => {
    await setScale(40);
    assert.deepEqual(await clickTable(), { type: 'item', id: ids.table });
    const s0 = await state();
    await dragTable(100, 50);
    const s1 = await state();
    assert.deepEqual(s1.room, s0.room, 'комната на месте');
    assert.ok(Math.hypot(s1.table.x - s0.table.x, s1.table.y - s0.table.y) > 500, `стол сдвинулся: ${JSON.stringify([s0.table, s1.table])}`);
    assert.deepEqual(s1.sel, { type: 'item', id: ids.table });
    await app.page.keyboard.press('Control+z');
    assert.deepEqual((await state()).table, s0.table, 'отмена вернула стол');
  });

  it('граница: 1:165 — предмет, 1:166 — помещение', async () => {
    await setScale(165);
    assert.deepEqual(await clickTable(), { type: 'item', id: ids.table }, '1:165 включительно');
    await setScale(166);
    assert.deepEqual(await clickTable(), { type: 'room', id: ids.room }, '1:166 — уже издали');
    assert.deepEqual(app.errors, []);
  });
});
