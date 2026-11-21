// Временные размеры выбранной мебели (как в Revit): от предмета до стен и
// соседней мебели; клик по подписи — ввод расстояния, предмет сдвигается.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, openNew, zoomToItems } from './helpers.mjs';

// Комната 5×4 м, стол 1200×800 в (1500, 2000), диван справа 1000×800 в (3700, 2000).
async function scene(page) {
  return page.evaluate(async () => {
    const m = await import('./core/model.js');
    const s = await import('./ui/store.js');
    const k = window.__kepler.state;
    const table = m.createItem('table', 1500, 2000, 1200, 800);
    const sofa = m.createItem('sofa', 3700, 2000, 1000, 800);
    s.mutate(() => {
      k.project.rooms.push(m.createRoom('living', 0, 0, 5000, 4000));
      k.project.items.push(table, sofa);
    });
    window.__kepler.fitView();
    return { table: table.id, sofa: sofa.id };
  });
}
const canvasBox = (page) => page.$('#canvas').then((c) => c.boundingBox());
async function planToClient(page, x, y) {
  const box = await canvasBox(page);
  const s = await page.evaluate(([px, py]) => window.__kepler.planToScreen(px, py), [x, y]);
  return { x: box.x + s.x, y: box.y + s.y };
}
const dims = (page) => page.evaluate(() => {
  const ui = window.__kepler.state._tempDimsUI;
  return ui ? Object.fromEntries(ui.dims.map((d) => [d.dir, { value: Math.round(d.value), x: d.x, y: d.y, box: d.box }])) : null;
});
const tableX = (page, id) => page.evaluate((tid) => window.__kepler.state.project.items.find((i) => i.id === tid).x, id);

describe('временные размеры мебели (мышь)', () => {
  let app; let ids;
  before(async () => {
    app = await startApp({ width: 1400, height: 900 });
    await openNew(app.page);
    ids = await scene(app.page);
  });
  after(async () => { await app?.close(); });

  it('выбранный стол: размеры до стен и дивана', async () => {
    const p = await planToClient(app.page, 1500, 2000);
    await app.page.mouse.click(p.x, p.y);
    await app.page.waitForTimeout(80);
    const d = await dims(app.page);
    assert.deepEqual(
      Object.fromEntries(Object.entries(d).map(([k, v]) => [k, v.value])),
      { left: 900, right: 1100, up: 1600, down: 1600 },
    );
  });

  it('клик по подписи → ввод 500 → стол сдвинут, противоположный размер пересчитан; Undo', async () => {
    const box = await canvasBox(app.page);
    const d = await dims(app.page);
    await app.page.mouse.click(box.x + d.left.x, box.y + d.left.y);
    assert.equal(await app.page.isVisible('#dimInput'), true);
    assert.equal(await app.page.inputValue('#dimInputField'), '900');
    await app.page.fill('#dimInputField', '500');
    await app.page.press('#dimInputField', 'Enter');
    await app.page.waitForTimeout(80);
    assert.equal(await app.page.isVisible('#dimInput'), false);
    assert.equal(await tableX(app.page, ids.table), 1100);
    const after1 = await dims(app.page);
    assert.equal(after1.left.value, 500);
    assert.equal(after1.right.value, 1500);
    assert.equal(await app.page.evaluate(() => window.__kepler.state.selection?.type), 'item');
    await app.page.keyboard.press('Control+z');
    await app.page.waitForTimeout(80);
    assert.equal(await tableX(app.page, ids.table), 1500);
  });

  it('недопустимое расстояние — стол на месте, сообщение; Esc закрывает', async () => {
    const box = await canvasBox(app.page);
    const p = await planToClient(app.page, 1500, 2000);
    await app.page.mouse.click(box.x + 5, box.y + 5); // снять выбор
    await app.page.mouse.click(p.x, p.y);
    await app.page.waitForTimeout(80);
    const d = await dims(app.page);
    await app.page.mouse.click(box.x + d.right.x, box.y + d.right.y);
    await app.page.fill('#dimInputField', '2500'); // влево на 1400 > 900 до стены
    await app.page.press('#dimInputField', 'Enter');
    await app.page.waitForTimeout(80);
    assert.equal(await tableX(app.page, ids.table), 1500);
    assert.match(await app.page.textContent('#toast'), /стену/);
    assert.equal(await app.page.isVisible('#dimInput'), true, 'поле остаётся для исправления');
    await app.page.press('#dimInputField', 'Escape');
    assert.equal(await app.page.isVisible('#dimInput'), false);
    assert.equal(await tableX(app.page, ids.table), 1500);
  });

  it('перетаскивание — размеры обновляются вживую; в режиме поворота скрыты', async () => {
    const a = await planToClient(app.page, 1500, 2000);
    const b = await planToClient(app.page, 1800, 2000);
    await app.page.mouse.move(a.x, a.y);
    await app.page.mouse.down();
    await app.page.mouse.move((a.x + b.x) / 2, a.y);
    await app.page.mouse.move(b.x, b.y);
    const mid = await dims(app.page);
    await app.page.mouse.up();
    const x = await tableX(app.page, ids.table);
    assert.notEqual(x, 1500, 'стол сдвинут');
    assert.equal(mid.left.value, Math.round(x - 600), 'левый размер во время перетаскивания');
    // Повторный клик — режим поворота: временных размеров нет.
    const c = await planToClient(app.page, x, 2000);
    await app.page.mouse.click(c.x, c.y);
    await app.page.waitForTimeout(80);
    const mode = await app.page.evaluate(() => window.__kepler.state.itemHandle?.mode);
    assert.equal(mode, 'rotate');
    assert.equal(await dims(app.page), null);
    assert.deepEqual(app.errors, []);
  });
});

describe('временные размеры мебели (телефон)', () => {
  let app; let ids;
  before(async () => {
    app = await startApp({ mobile: true });
    await openNew(app.page);
    ids = await scene(app.page);
  });
  after(async () => { await app?.close(); });

  it('тап по столу, тап по подписи (цель ≥ 36 px), ✓ — стол сдвинут', async () => {
    // На узком экране вид дальше 1:45 — мебель не отвечает на касание: приближаем.
    await zoomToItems(app.page, 0.12, [ids.table]);
    const p =await planToClient(app.page, 1500, 2000);
    await app.page.touchscreen.tap(p.x, p.y);
    await app.page.waitForTimeout(120);
    const d = await dims(app.page);
    assert.ok(d?.up, 'размер вверх есть');
    assert.ok(d.up.box.w >= 36 && d.up.box.h >= 36, 'цель касания не меньше 36 px');
    const box = await canvasBox(app.page);
    // Касание у края цели (не по центру подписи) — тоже открывает поле.
    await app.page.touchscreen.tap(box.x + d.up.x, box.y + d.up.box.y + 3);
    await app.page.waitForTimeout(120);
    assert.equal(await app.page.isVisible('#dimInput'), true);
    await app.page.fill('#dimInputField', '1000');
    await app.page.tap('#dimInputOk');
    await app.page.waitForTimeout(80);
    assert.equal(await app.page.isVisible('#dimInput'), false);
    const y = await app.page.evaluate((tid) => window.__kepler.state.project.items.find((i) => i.id === tid).y, ids.table);
    assert.equal(y, 1400);
    assert.deepEqual(app.errors, []);
  });
});
