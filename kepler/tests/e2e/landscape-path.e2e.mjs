// e2e «Ландшафт»: дорожка с поворотом — тип угла (4 варианта), укладка
// плит (строгая, размер), «Разорвать» (панель выделения и клавиша X):
// N отдельных плит `slab`, выделены группой, одна двигается отдельно,
// Ctrl+Z возвращает дорожку; без ошибок консоли.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, openSample, worldToClient } from './helpers.mjs';

const objects = (page) => page.evaluate(() => (window.__kepler.state.project.site.landscape?.objects || [])
  .map((o) => ({
    id: o.id, kind: o.kind, x: o.x, y: o.y, rotation: o.rotation, points: o.points, variant: o.variant,
    corner: o.corner, laying: o.laying, slabL: o.slabL, gap: o.gap,
  })));
const selection = (page) => page.evaluate(() => window.__kepler.state.selection);
const slabCount = (page, id) => page.evaluate(async (pid) => {
  const L = await import('./core/landscape.js');
  const o = window.__kepler.state.project.site.landscape.objects.find((x) => x.id === pid);
  return L.steppingSlabs(o).length;
}, id);

async function clickWorld(page, x, y) {
  const p = await worldToClient(page, x, y);
  await page.mouse.move(p.x, p.y);
  await page.mouse.click(p.x, p.y);
}

async function dragWorld(page, a, b, steps = 8) {
  const p = await worldToClient(page, a.x, a.y);
  const q = await worldToClient(page, b.x, b.y);
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  for (let i = 1; i <= steps; i += 1) await page.mouse.move(p.x + ((q.x - p.x) * i) / steps, p.y + ((q.y - p.y) * i) / steps);
  await page.mouse.up();
}

describe('ландшафт: углы дорожки, укладка и «Разорвать»', () => {
  let app;
  let pathId;
  before(async () => {
    app = await startApp();
    await openSample(app.page);
    await app.page.click('#landscapeBtn');
  });
  after(async () => { await app?.close(); });

  it('дорожка из плит-ступеней с поворотом на 90°: по умолчанию — угловая плита', async () => {
    const { page } = app;
    await page.click('#lsTabs button[data-ls-cat="site"]');
    await page.click('#lsItems [data-ls-kind="path"]');
    await page.selectOption('#lsDrawVariant', 'stepping');
    await page.uncheck('#lsDrawSmooth');
    for (const [x, y] of [[13000, -4000], [9000, -4000], [9000, 1000]]) await clickWorld(page, x, y);
    await page.keyboard.press('Enter');
    const [path] = (await objects(page)).filter((o) => o.kind === 'path');
    assert.ok(path);
    pathId = path.id;
    assert.equal(path.corner, undefined, 'поле не записано — старый вид');
    assert.equal(await page.isChecked('input[name="lsCorner"][value="slab"]'), true);
  });

  it('переключатель «Угол»: 4 варианта пишутся в данные', async () => {
    const { page } = app;
    for (const corner of ['miter', 'butt', 'round', 'slab']) {
      await page.click(`.ls-corner label:has(input[value="${corner}"])`);
      const o = (await objects(page)).find((x) => x.id === pathId);
      assert.equal(o.corner, corner);
      assert.equal(await page.isChecked(`input[name="lsCorner"][value="${corner}"]`), true);
    }
  });

  it('укладка: строгая, размер плиты и зазор', async () => {
    const { page } = app;
    await page.selectOption('#lsLaying', 'strict');
    await page.fill('#lsSlabL', '400');
    await page.press('#lsSlabL', 'Enter');
    await page.fill('#lsGap', '150');
    await page.press('#lsGap', 'Enter');
    const o = (await objects(page)).find((x) => x.id === pathId);
    assert.equal(o.laying, 'strict');
    assert.equal(o.slabL, 400);
    assert.equal(o.gap, 150);
    await page.selectOption('#lsLaying', 'natural');
    assert.equal((await objects(page)).find((x) => x.id === pathId).laying, undefined);
  });

  it('«Разорвать» (панель выделения): N плит, выделены группой; Ctrl+Z — дорожка', async () => {
    const { page } = app;
    const n = await slabCount(page, pathId);
    assert.ok(n >= 6, String(n));
    const n0 = (await objects(page)).length;
    await page.click('#selectionToolbar [data-selection-action="explode"]');
    // Действие панели выполняется после загрузки модуля (асинхронно).
    await page.waitForFunction(() => window.__kepler.state.project.site.landscape.objects.some((o) => o.kind === 'slab'));
    const list = await objects(page);
    const slabs = list.filter((o) => o.kind === 'slab');
    assert.equal(slabs.length, n);
    assert.equal(list.length, n0 - 1 + n);
    assert.ok(!list.some((o) => o.id === pathId), 'дорожки больше нет');
    const sel = await selection(page);
    assert.equal(sel.type, 'landscape');
    assert.deepEqual([...sel.ids].sort(), slabs.map((o) => o.id).sort(), 'выделена вся группа');
    await page.keyboard.press('Control+z');
    const back = await objects(page);
    assert.ok(back.some((o) => o.id === pathId && o.kind === 'path'));
    assert.equal(back.filter((o) => o.kind === 'slab').length, 0);
  });

  it('клавиша X: разорвать; одна плита двигается отдельно; Ctrl+Z ×2 — дорожка', async () => {
    const { page } = app;
    await page.evaluate((id) => window.__kepler.select({ type: 'landscape', ids: [id] }), pathId);
    await page.evaluate(() => document.activeElement?.blur());
    await page.keyboard.press('x');
    const slabs = (await objects(page)).filter((o) => o.kind === 'slab');
    assert.ok(slabs.length >= 6);
    const one = slabs[Math.floor(slabs.length / 2)];
    await page.evaluate((id) => window.__kepler.select({ type: 'landscape', ids: [id] }), one.id);
    await dragWorld(page, { x: one.x, y: one.y }, { x: one.x + 1500, y: one.y + 1500 });
    const after = (await objects(page)).filter((o) => o.kind === 'slab');
    const moved = after.find((o) => o.id === one.id);
    assert.ok(Math.hypot(moved.x - one.x, moved.y - one.y) > 300, 'плита сдвинулась'); // привязка к соседним плитам может притянуть
    for (const s of after.filter((o) => o.id !== one.id)) {
      const was = slabs.find((o) => o.id === s.id);
      assert.deepEqual([s.x, s.y], [was.x, was.y], 'остальные на месте');
    }
    await page.keyboard.press('Control+z');
    await page.keyboard.press('Control+z');
    const back = await objects(page);
    assert.ok(back.some((o) => o.id === pathId && o.kind === 'path'));
    assert.equal(back.filter((o) => o.kind === 'slab').length, 0);
  });

  it('без ошибок в консоли', () => {
    assert.deepEqual(app.errors, []);
  });
});
