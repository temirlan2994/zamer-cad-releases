// Регрессии ввода (аудит 2026-11b, П-11…П-18): касания через CDP, клики и клавиши.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, openNew } from './helpers.mjs';

// Комнаты A 5×4 м и B 4×4 м; стол 1200×800 в (1500, 2000); два табурета в группе g1.
async function scene(page) {
  return page.evaluate(async () => {
    const m = await import('./core/model.js');
    const s = await import('./ui/store.js');
    const k = window.__kepler.state;
    const a = m.createRoom('living', 0, 0, 5000, 4000);
    const b = m.createRoom('bedroom', 6000, 0, 4000, 4000);
    const table = m.createItem('table', 1500, 2000, 1200, 800);
    const g1 = m.createItem('table', 3800, 900, 600, 600);
    const g2 = m.createItem('table', 3800, 3000, 600, 600);
    g1.group = 'g1'; g2.group = 'g1';
    s.mutate(() => {
      k.project.rooms.push(a, b);
      k.project.items.push(table, g1, g2);
    });
    window.__kepler.fitView();
    return { a: a.id, b: b.id, table: table.id, g1: g1.id, g2: g2.id };
  });
}
const canvasBox = (page) => page.$('#canvas').then((c) => c.boundingBox());
async function planToClient(page, x, y) {
  const box = await canvasBox(page);
  const s = await page.evaluate(([px, py]) => window.__kepler.planToScreen(px, py), [x, y]);
  return { x: box.x + s.x, y: box.y + s.y };
}
const itemOf = (page, id) => page.evaluate((i) => { const x = window.__kepler.state.project.items.find((v) => v.id === i); return { x: x.x, y: x.y, w: x.w, h: x.h }; }, id);
const roomOf = (page, id) => page.evaluate((i) => { const r = window.__kepler.state.project.rooms.find((v) => v.id === i); return r && { x: r.x, y: r.y, w: r.w, h: r.h }; }, id);
const selection = (page) => page.evaluate(() => window.__kepler.state.selection);
const select = (page, sel) => page.evaluate(async (s) => (await import('./ui/tools.js')).selectObject(s), sel);
const handleMode = (page) => page.evaluate(async () => {
  const m = await import('./core/item-handles.js');
  const k = window.__kepler.state;
  return k.selection?.type === 'item' ? m.itemHandleMode(k.itemHandle, k.selection.id) : null;
});
const panX = (page) => page.evaluate(() => window.__kepler.state.view.panX);

describe('касания: группа, участок, малые предметы, поле размера', () => {
  let app; let cdp; let ids;
  before(async () => {
    app = await startApp({ mobile: true });
    await openNew(app.page);
    ids = await scene(app.page);
    cdp = await app.page.context().newCDPSession(app.page);
  });
  after(async () => { await app?.close(); });

  const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
  const wait = (ms) => app.page.waitForTimeout(ms);
  async function tap(p) { await touch('touchStart', p.x, p.y); await touch('touchEnd'); await wait(150); }
  async function swipe(p, holdMs = 0) {
    await touch('touchStart', p.x, p.y);
    await wait(holdMs);
    for (let i = 1; i <= 6; i++) { await touch('touchMove', p.x + i * 8, p.y); await wait(16); }
    await touch('touchEnd');
    await wait(300);
  }

  it('П-11: тап по предмету группы без выделения — выбрана группа, без ошибок', async () => {
    await select(app.page, null);
    const g = await itemOf(app.page, ids.g1);
    await tap(await planToClient(app.page, g.x, g.y));
    const sel = await selection(app.page);
    assert.equal(sel?.type, 'multi');
    assert.deepEqual([...sel.itemIds].sort(), [ids.g1, ids.g2].sort());
    assert.deepEqual(app.errors, []);
  });

  it('П-12: группа на касании двигается только после удержания, свайп — панорама', async () => {
    await select(app.page, { type: 'multi', roomIds: [], itemIds: [ids.g1, ids.g2] });
    let g = await itemOf(app.page, ids.g1);
    const pan0 = await panX(app.page);
    await swipe(await planToClient(app.page, g.x, g.y));
    assert.deepEqual(await itemOf(app.page, ids.g1), g, 'свайп не сдвинул группу');
    assert.notEqual(await panX(app.page), pan0, 'план сдвинулся');
    g = await itemOf(app.page, ids.g1);
    await swipe(await planToClient(app.page, g.x, g.y), 650);
    assert.notEqual((await itemOf(app.page, ids.g1)).x, g.x, 'после удержания группа едет');
    // Две выделенные рамкой комнаты: свайп по одной — панорама, комнаты на месте.
    await select(app.page, { type: 'multi', roomIds: [ids.a, ids.b], itemIds: [] });
    const ra = await roomOf(app.page, ids.a);
    await swipe(await planToClient(app.page, 4300, 300));
    assert.deepEqual(await roomOf(app.page, ids.a), ra, 'комнаты на месте');
    assert.deepEqual(app.errors, []);
  });

  it('П-15: у малого предмета тап по центру в режиме «растяжение» меняет режим, свайп не меняет размер', async () => {
    await app.page.evaluate((id) => {
      const k = window.__kepler;
      const it = k.state.project.items.find((i) => i.id === id);
      it.w = 300; it.h = 300;
      k.state.view.scale = 0.1; // предмет ≈ 30 px
      const c = document.getElementById('canvas');
      const s = k.planToScreen(it.x, it.y);
      k.state.view.panX += c.clientWidth / 2 - s.x;
      k.state.view.panY += c.clientHeight / 2 - s.y;
    }, ids.table);
    await select(app.page, { type: 'item', id: ids.table });
    await app.page.evaluate((id) => { window.__kepler.state.itemHandle = { id, mode: 'stretch' }; }, ids.table);
    await wait(80);
    const t = await itemOf(app.page, ids.table);
    const p = await planToClient(app.page, t.x, t.y);
    await tap(p);
    assert.equal(await handleMode(app.page), 'scale', 'тап по телу переключил режим');
    await swipe(p);
    const after1 = await itemOf(app.page, ids.table);
    assert.deepEqual([after1.w, after1.h], [300, 300], 'размер не изменился');
    const t2 = await itemOf(app.page, ids.table);
    await tap(await planToClient(app.page, t2.x, t2.y));
    assert.equal(await handleMode(app.page), 'select', 'из режима можно выйти');
    await app.page.evaluate((id) => {
      const k = window.__kepler; const it = k.state.project.items.find((i) => i.id === id);
      it.w = 1200; it.h = 800; it.x = 1500; it.y = 2000; k.fitView();
    }, ids.table);
  });

  it('П-16: поле временного размера открывается на тапе с фокусом в жесте, свайп его закрывает', async () => {
    await select(app.page, null);
    await tap(await planToClient(app.page, 1500, 2000));
    assert.equal((await selection(app.page))?.id, ids.table);
    await wait(80);
    const d = await app.page.evaluate(() => window.__kepler.state._tempDimsUI?.dims.find((x) => x.dir === 'up'));
    assert.ok(d, 'есть размер вверх');
    await app.page.evaluate(() => {
      window.__focusAtUp = null;
      document.getElementById('canvas').addEventListener('pointerup', () => { window.__focusAtUp = document.activeElement?.id; }, { once: true });
    });
    const box = await canvasBox(app.page);
    // Свайп по подписи — панорама, поле не открывается.
    await swipe({ x: box.x + d.x, y: box.y + d.y });
    assert.equal(await app.page.isVisible('#dimInput'), false, 'свайп не открыл поле');
    await app.page.evaluate(() => {
      window.__focusAtUp = null;
      document.getElementById('canvas').addEventListener('pointerup', () => { window.__focusAtUp = document.activeElement?.id; }, { once: true });
    });
    const d2 = await app.page.evaluate(() => window.__kepler.state._tempDimsUI?.dims.find((x) => x.dir === 'up'));
    await tap({ x: box.x + d2.x, y: box.y + d2.y });
    assert.equal(await app.page.isVisible('#dimInput'), true);
    assert.equal(await app.page.evaluate(() => window.__focusAtUp), 'dimInputField', 'фокус — синхронно в жесте');
    await swipe(await planToClient(app.page, 1500, 2000));
    assert.equal(await app.page.isVisible('#dimInput'), false, 'панорама закрыла поле');
    assert.deepEqual(app.errors, []);
  });

  it('П-13: «Участок» — свайп не ставит соседа и не открывает отметку, тап — ставит', async () => {
    await app.page.click('#modeSiteBtn');
    await app.page.evaluate(async () => (await import('./ui/tools.js')).setTool({ kind: 'neighbor' }));
    const box = await canvasBox(app.page);
    const p = { x: box.x + 40, y: box.y + box.height * 0.8 };
    const count = () => app.page.evaluate(() => window.__kepler.state.project.site.neighbors.length);
    const n0 = await count(); const pan0 = await panX(app.page);
    await swipe(p);
    assert.equal(await count(), n0, 'свайп не поставил дом');
    assert.notEqual(await panX(app.page), pan0, 'свайп — панорама');
    await tap(p);
    assert.equal(await count(), n0 + 1, 'тап поставил дом');
    await app.page.evaluate(async () => (await import('./ui/tools.js')).setTool({ kind: 'terrain' }));
    const q = { x: box.x + box.width * 0.6, y: box.y + 40 };
    await swipe(q);
    assert.equal(await app.page.isVisible('#elevOverlay'), false, 'свайп не открыл ввод отметки');
    await tap(q);
    assert.equal(await app.page.isVisible('#elevOverlay'), true, 'тап открыл ввод отметки');
    await app.page.keyboard.press('Escape');
    await app.page.evaluate(async () => (await import('./ui/tools.js')).cancelTool());
    assert.deepEqual(app.errors, []);
  });
});

describe('мышь и клавиши: повторный клик, окна поверх плана, кнопки в фокусе', () => {
  let app; let ids;
  before(async () => {
    app = await startApp({ width: 1400, height: 900 });
    await openNew(app.page);
    ids = await scene(app.page);
  });
  after(async () => { await app?.close(); });

  it('П-14: быстрый двойной клик по выбранному предмету — режим ручек, не комната под ним', async () => {
    await select(app.page, { type: 'item', id: ids.table });
    const p = await planToClient(app.page, 1500, 2000);
    await app.page.mouse.click(p.x, p.y, { clickCount: 2 });
    const sel = await selection(app.page);
    assert.deepEqual([sel.type, sel.id], ['item', ids.table]);
    assert.equal(await handleMode(app.page), 'stretch', 'выбор → поворот → растяжение');
    // Esc выходит из режима ручек, предмет остаётся выбранным.
    await app.page.keyboard.press('Escape');
    assert.equal(await handleMode(app.page), 'select');
    assert.equal((await selection(app.page))?.id, ids.table);
    // Alt+клик — следующий объект стопки (комната под столом).
    await app.page.keyboard.down('Alt');
    await app.page.mouse.click(p.x, p.y);
    await app.page.keyboard.up('Alt');
    const below = await selection(app.page);
    assert.deepEqual([below.type, below.id], ['room', ids.a]);
  });

  it('П-16: поле размера следует за масштабом колесом', async () => {
    await select(app.page, null);
    const p = await planToClient(app.page, 1500, 2000);
    await app.page.mouse.click(p.x, p.y);
    await app.page.waitForTimeout(80);
    const d = await app.page.evaluate(() => window.__kepler.state._tempDimsUI?.dims.find((x) => x.dir === 'up'));
    const box = await canvasBox(app.page);
    await app.page.mouse.click(box.x + d.x, box.y + d.y);
    await app.page.waitForTimeout(80);
    assert.equal(await app.page.isVisible('#dimInput'), true);
    assert.equal(await app.page.evaluate(() => document.activeElement?.id), 'dimInputField');
    const pos = () => app.page.evaluate(() => { const o = document.getElementById('dimInput'); return { x: parseFloat(o.style.left), y: parseFloat(o.style.top) }; });
    const before1 = await pos();
    await app.page.mouse.move(box.x + 200, box.y + 200);
    await app.page.mouse.wheel(0, -300);
    await app.page.waitForTimeout(80);
    const after1 = await pos();
    assert.notDeepEqual(after1, before1, 'поле сдвинулось');
    const expect = await app.page.evaluate(() => { const a = window.__kepler.state.dimEdit.anchor; return window.__kepler.planToScreen(a.x, a.y); });
    assert.ok(Math.abs(after1.x - expect.x) < 1 && Math.abs(after1.y - expect.y) < 1, 'поле у своей подписи');
    await app.page.keyboard.press('Escape');
    await app.page.evaluate(() => window.__kepler.fitView());
  });

  it('П-17: Del, R и стрелки не правят план под справкой и 3D', async () => {
    await select(app.page, { type: 'room', id: ids.a });
    const r0 = await roomOf(app.page, ids.a);
    await app.page.keyboard.press('F1');
    assert.equal(await app.page.isVisible('#helpScreen'), true);
    for (const key of ['Delete', 'r', 'ArrowRight']) await app.page.keyboard.press(key);
    assert.deepEqual(await roomOf(app.page, ids.a), r0, 'под справкой комната не изменилась');
    await app.page.keyboard.press('Escape');
    assert.equal(await app.page.isVisible('#helpScreen'), false);
    await app.page.click('#view3dBtn');
    await app.page.waitForFunction(async () => (await import('./ui/view3d.js')).is3dOpen());
    await select(app.page, { type: 'room', id: ids.a });
    await app.page.locator('body').focus().catch(() => {});
    await app.page.evaluate(() => document.activeElement?.blur?.());
    for (const key of ['Delete', 'r', 'ArrowRight']) await app.page.keyboard.press(key);
    assert.deepEqual(await roomOf(app.page, ids.a), r0, 'под 3D комната не изменилась');
    await app.page.keyboard.press('Escape');
    assert.equal(await app.page.evaluate(async () => (await import('./ui/view3d.js')).is3dOpen()), false);
    // План снова правится.
    await select(app.page, { type: 'room', id: ids.a });
    await app.page.keyboard.press('ArrowRight');
    assert.notDeepEqual(await roomOf(app.page, ids.a), r0, 'без окон стрелка двигает');
    await app.page.keyboard.press('Control+z');
  });

  it('П-18: Enter и Space на кнопке в фокусе — нажимают кнопку, а не глобальные клавиши', async () => {
    // Клик мышью по кнопке не оставляет на ней фокус.
    await app.page.click('#modePlanBtn');
    assert.notEqual(await app.page.evaluate(() => document.activeElement?.id), 'modePlanBtn');
    await app.page.focus('#modeSiteBtn');
    await app.page.keyboard.press('Space');
    assert.equal(await app.page.evaluate(() => window.__kepler.state.modeName), 'site', 'Space нажал кнопку');
    assert.equal(await app.page.evaluate(async () => (await import('./ui/keyboard.js')).spaceDown), false, 'панорама пробелом не включилась');
    await app.page.focus('#modePlanBtn');
    await app.page.keyboard.press('Enter');
    assert.equal(await app.page.evaluate(() => window.__kepler.state.modeName), 'plan', 'Enter нажал кнопку');
    assert.deepEqual(app.errors, []);
  });
});
