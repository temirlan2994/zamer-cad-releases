// e2e «Ландшафт»: «Массив» (Shift+A и кнопка панели выделения) —
// прямоугольный, вдоль линии, по кругу: предпросмотр призраками, Esc —
// без изменений, Enter/«Применить» — одна запись истории, выделена вся
// группа; «Засадить» газон набором видов и короб (растения привязаны).
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, openSample, dropOnCanvas, clickWorld } from './helpers.mjs';

const MIME = 'application/x-kepler-landscape';
const BENCH_AT = { x: 9000, y: -4500 };

const objects = (page) => page.evaluate(() => (window.__kepler.state.project.site.landscape?.objects || [])
  .map((o) => ({ id: o.id, kind: o.kind, x: o.x, y: o.y, w: o.w, h: o.h, rotation: o.rotation, parent: o.parent })));
const undoLen = (page) => page.evaluate(async () => (await import('./ui/state.js')).history.undo.length);
const at = (page, p) => page.evaluate(([x, y]) => window.__kepler.worldToScreen(x, y), [p.x, p.y]);
const tool = (page) => page.evaluate(() => {
  const t = window.__kepler.state.tool;
  return t ? { kind: t.kind, mode: t.mode, ghosts: t.preview?.objects.length || 0 } : null;
});
const selection = (page) => page.evaluate(() => window.__kepler.state.selection?.ids || []);
const select = (page, ids) => page.evaluate((list) => window.__kepler.select({ type: 'landscape', ids: list }), ids);
const blur = (page) => page.evaluate(() => document.activeElement?.blur());
// Клик точно в мировую точку: Shift — без привязки (как при черчении).
const clickFree = async (page, x, y) => {
  await page.keyboard.down('Shift');
  await clickWorld(page, x, y);
  await page.keyboard.up('Shift');
};

describe('ландшафт: массив и засадка', () => {
  let app;
  let bench;
  before(async () => {
    app = await startApp();
    await openSample(app.page);
    await app.page.click('#landscapeBtn');
  });
  after(async () => { await app?.close(); });

  it('Shift+A — прямоугольный массив: призраки, Enter, одна запись истории, Ctrl+Z', async () => {
    const { page } = app;
    await page.click('#lsTabs button[data-ls-cat="site"]');
    await dropOnCanvas(page, MIME, 'bench', await at(page, BENCH_AT));
    [bench] = await objects(page);
    assert.equal(bench.kind, 'bench');
    await blur(page);
    const before0 = await objects(page);
    const undo0 = await undoLen(page);
    await page.keyboard.press('Shift+A');
    assert.deepEqual(await tool(page), { kind: 'ls-array', mode: 'rect', ghosts: 5 }, '2×3 − оригинал');
    assert.match(await page.textContent('#propsPanel'), /Массив/);
    assert.deepEqual(await objects(page), before0, 'предпросмотр не меняет проект');
    await page.fill('#lsArRows', '3');
    await page.fill('#lsArCols', '2');
    await page.fill('#lsArDx', '2500');
    await page.fill('#lsArDy', '-1500');
    assert.equal((await tool(page)).ghosts, 5);
    await page.press('#lsArDy', 'Enter');
    assert.equal(await tool(page), null);
    const list = await objects(page);
    const benches = list.filter((o) => o.kind === 'bench');
    assert.equal(benches.length, 6);
    assert.ok(benches.some((o) => o.x === bench.x + 2500 && o.y === bench.y - 3000), 'угол 3-го ряда');
    assert.equal(new Set(benches.map((o) => o.id)).size, 6, 'новые id');
    assert.equal(await undoLen(page), undo0 + 1, 'одна запись истории');
    assert.equal((await selection(page)).length, 6, 'выделена вся группа');
    await page.keyboard.press('Control+z');
    assert.deepEqual(await objects(page), before0);
  });

  it('вдоль линии (кнопка «Массив»): Esc — без изменений; точки, шаг, поворот, «Применить»', async () => {
    const { page } = app;
    await select(page, [bench.id]);
    await page.click('#selectionToolbar [data-selection-action="array"]');
    await page.waitForSelector('#lsArray');
    await page.click('#lsArray label.seg-opt:has(input[value="path"])');
    assert.equal((await tool(page)).mode, 'path');
    await clickFree(page, bench.x, bench.y);
    await clickFree(page, bench.x + 4000, bench.y);
    assert.ok((await tool(page)).ghosts >= 1);
    await page.keyboard.press('Escape');
    assert.equal(await tool(page), null);
    assert.deepEqual(await selection(page), [bench.id], 'Esc — выделение осталось');
    assert.equal((await objects(page)).length, 1);
    // Снова: Г-образная линия, шаг 2000, поворот по направлению.
    await page.click('#selectionToolbar [data-selection-action="array"]');
    await page.waitForSelector('#lsArray');
    assert.equal((await tool(page)).mode, 'path', 'режим запомнен');
    await page.fill('#lsArStep', '2000');
    await page.check('#lsArAlign');
    await clickFree(page, bench.x, bench.y);
    await clickFree(page, bench.x + 4000, bench.y);
    await clickFree(page, bench.x + 4000, bench.y + 4000);
    await page.click('#lsArApply');
    const copies = (await objects(page)).filter((o) => o.id !== bench.id);
    assert.equal(copies.length, 4, 'на 2, 4, 6, 8 м (0 — оригинал)');
    const last = copies.find((o) => Math.abs(o.y - (bench.y + 4000)) <= 60);
    assert.ok(last && Math.abs(last.rotation - 90) < 1, 'на втором отрезке повёрнута на 90°');
    await page.keyboard.press('Control+z');
    assert.equal((await objects(page)).length, 1);
  });

  it('по кругу: клик — центр, 4 по кругу с поворотом', async () => {
    const { page } = app;
    await select(page, [bench.id]);
    await blur(page);
    await page.keyboard.press('Shift+A');
    await page.click('#lsArray label.seg-opt:has(input[value="polar"])');
    await clickFree(page, bench.x, bench.y + 3000);
    await page.fill('#lsArPCount', '4');
    assert.equal((await tool(page)).ghosts, 3);
    await page.keyboard.press('Enter');
    const list = await objects(page);
    assert.equal(list.length, 4);
    const opposite = list.find((o) => Math.abs(o.y - (bench.y + 6000)) <= 60);
    assert.ok(opposite && Math.abs(opposite.x - bench.x) <= 60 && opposite.rotation === 180, 'напротив, развёрнута');
    await page.keyboard.press('Control+z');
  });

  it('«Засадить» газон двумя видами и короб — внутри, кроны не пересекаются, Ctrl+Z', async () => {
    const { page } = app;
    await page.click('#lsTabs button[data-ls-cat="green"]');
    await dropOnCanvas(page, MIME, 'lawn-patch', await at(page, { x: 12000, y: 7000 }));
    const lawn = (await objects(page)).find((o) => o.kind === 'lawn-patch');
    assert.match(await page.textContent('#propsPanel'), /Засадить/);
    const undo0 = await undoLen(page);
    await page.selectOption('#lsPfKind0', 'flowers-clump');
    await page.fill('#lsPfShare0', '70');
    await page.selectOption('#lsPfKind1', 'grass-clump');
    await page.fill('#lsPfShare1', '30');
    await page.fill('#lsPfMargin', '100');
    await page.click('#lsPfGo');
    const plants = (await objects(page)).filter((o) => o.kind === 'flowers-clump' || o.kind === 'grass-clump');
    assert.ok(plants.length >= 5, `посажено ${plants.length}`);
    assert.ok(plants.some((o) => o.kind === 'grass-clump') && plants.some((o) => o.kind === 'flowers-clump'));
    const ok = await page.evaluate(async (id) => {
      const A = await import('./core/landscape-array.js');
      const { pointInPolygon } = await import('./core/zamer/geometry.js');
      const objs = window.__kepler.state.project.site.landscape.objects;
      const host = objs.find((o) => o.id === id);
      const poly = A.fillPolygonOf(host);
      const ps = objs.filter((o) => o.kind === 'flowers-clump' || o.kind === 'grass-clump');
      const inside = ps.every((o) => pointInPolygon(o, poly));
      let overlap = false;
      for (let i = 0; i < ps.length; i += 1) {
        for (let j = i + 1; j < ps.length; j += 1) {
          if (Math.hypot(ps[i].x - ps[j].x, ps[i].y - ps[j].y) < (ps[i].w + ps[j].w) / 2) overlap = true;
        }
      }
      return { inside, overlap };
    }, lawn.id);
    assert.deepEqual(ok, { inside: true, overlap: false });
    assert.equal(await undoLen(page), undo0 + 1);
    await page.keyboard.press('Control+z');
    assert.equal((await objects(page)).filter((o) => o.kind === 'flowers-clump').length, 0);
    // Короб: кнопка «Засадить» панели выделения — растения привязаны к коробу.
    await dropOnCanvas(page, MIME, 'planter-box', await at(page, { x: 12000, y: -3500 }));
    const box = (await objects(page)).find((o) => o.kind === 'planter-box');
    await page.click('#selectionToolbar [data-selection-action="plant-fill"]');
    await page.waitForFunction((id) => window.__kepler.state.project.site.landscape.objects.some((o) => o.parent === id), box.id);
    const kids = (await objects(page)).filter((o) => o.parent === box.id);
    assert.ok(kids.length >= 2, `в коробе ${kids.length}`);
    for (const style of ['drawing', 'sketch']) {
      await page.evaluate(async (s) => { window.__kepler.state.lsStyle = s; (await import('./ui/view.js')).requestDraw(); }, style);
      await page.waitForTimeout(150);
    }
    assert.deepEqual(app.errors, []);
  });
});
