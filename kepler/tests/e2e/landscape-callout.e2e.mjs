// e2e «Ландшафт»: выноски и ведомость растений — «Подписать» (T) на
// выделенном дереве, текст в панели, перетаскивание ручек «указатель» и
// «текст», выноска из каталога, Ctrl+Z, оба стиля и 3D без ошибок, DXF-слой;
// ведомость растений в панели: цена → сумма и итог, отмена.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, openSample, worldToClient, dropOnCanvas } from './helpers.mjs';

const MIME = 'application/x-kepler-landscape';
const objects = (page) => page.evaluate(() => JSON.parse(JSON.stringify(window.__kepler.state.project.site.landscape?.objects || [])));
const callouts = async (page) => (await objects(page)).filter((o) => o.kind === 'callout');
const undoLen = (page) => page.evaluate(async () => (await import('./ui/state.js')).history.undo.length);
const at = (page, p) => page.evaluate(([x, y]) => window.__kepler.worldToScreen(x, y), [p.x, p.y]);
const blur = (page) => page.evaluate(() => document.activeElement?.blur());

async function drag(page, from, to) {
  const a = await worldToClient(page, from.x, from.y);
  const b = await worldToClient(page, to.x, to.y);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 4 });
  await page.mouse.move(b.x, b.y, { steps: 4 });
  await page.mouse.up();
}

describe('ландшафт: выноски и ведомость растений', () => {
  let app;
  before(async () => {
    app = await startApp();
    await openSample(app.page);
    await app.page.click('#landscapeBtn');
    // Крупнее: ручки выноски разнесены на экране.
    await app.page.evaluate(async () => {
      const k = window.__kepler; const v = k.state.view;
      const cv = document.getElementById('canvas');
      v.scale = 0.05; v.rotation = 0;
      v.panX = cv.clientWidth / 2 - 12000 * v.scale; v.panY = cv.clientHeight / 2 - (-2000) * v.scale;
      (await import('./ui/view.js')).requestDraw();
    });
  });
  after(async () => { await app?.close(); });

  it('«Подписать» (T): выноска к дереву, текст — название вида, одна запись истории', async () => {
    const { page } = app;
    await dropOnCanvas(page, MIME, 'tree-fruit', await at(page, { x: 10000, y: -1000 }));
    const tree = (await objects(page)).find((o) => o.kind === 'tree-fruit');
    assert.ok(tree, 'дерево поставлено');
    const undo0 = await undoLen(page);
    await blur(page);
    await page.keyboard.press('t');
    const [c] = await callouts(page);
    assert.ok(c, 'выноска создана');
    assert.equal(c.meta.text, 'Яблоня');
    assert.deepEqual(c.points[0], { x: tree.x, y: tree.y }, 'указывает в центр дерева');
    assert.equal(await undoLen(page), undo0 + 1);
    const sel = await page.evaluate(() => window.__kepler.state.selection);
    assert.deepEqual(sel.ids, [c.id], 'новая выноска выделена');
    assert.match(await page.textContent('#propsPanel'), /Выноска/);
    assert.ok(await page.$('#lsNoteText'));
  });

  it('текст в панели (несколько строк), знак и высота букв; Ctrl+Z', async () => {
    const { page } = app;
    await page.fill('#lsNoteText', 'Яблоня\nсаженец 1,8 м');
    await blur(page);
    await page.waitForFunction(() => window.__kepler.state.project.site.landscape.objects.find((o) => o.kind === 'callout')?.meta.text.includes('\n'));
    await page.selectOption('#lsVariant', 'arrow');
    await page.fill('#lsNoteSize', '400');
    await page.press('#lsNoteSize', 'Enter');
    const [c] = await callouts(page);
    assert.deepEqual([c.meta.text, c.variant, c.meta.size], ['Яблоня\nсаженец 1,8 м', 'arrow', 400]);
    await blur(page);
    await page.keyboard.press('Control+z');
    assert.equal((await callouts(page))[0].meta.size, 300);
    await page.keyboard.press('Control+y');
    assert.equal((await callouts(page))[0].meta.size, 400);
  });

  it('ручки: «текст» двигает излом с полкой, «указатель» — точку; тело — всю выноску', async () => {
    const { page } = app;
    const [c0] = await callouts(page);
    await page.evaluate((id) => window.__kepler.select({ type: 'landscape', ids: [id] }), c0.id);
    const undo0 = await undoLen(page);
    await drag(page, { x: c0.x, y: c0.y }, { x: c0.x + 2000, y: c0.y - 1000 });
    const [c1] = await callouts(page);
    assert.deepEqual(c1.points[0], c0.points[0], 'указатель на месте');
    assert.ok(Math.abs(c1.x - (c0.x + 2000)) <= 200 && Math.abs(c1.y - (c0.y - 1000)) <= 200, `излом сдвинут: ${c1.x},${c1.y}`);
    await drag(page, c1.points[0], { x: c1.points[0].x - 1500, y: c1.points[0].y + 800 });
    const [c2] = await callouts(page);
    assert.deepEqual([c2.x, c2.y], [c1.x, c1.y], 'текст на месте');
    assert.ok(Math.abs(c2.points[0].x - (c1.points[0].x - 1500)) <= 200, 'указатель сдвинут');
    assert.equal(await undoLen(page), undo0 + 2);
    await blur(page);
    await page.keyboard.press('Control+z');
    assert.deepEqual((await callouts(page))[0].points[0], c1.points[0]);
    // Перенос за линию указателя — едут обе точки.
    const [c3] = await callouts(page);
    const mid = { x: (c3.points[0].x + c3.x) / 2, y: (c3.points[0].y + c3.y) / 2 };
    await drag(page, mid, { x: mid.x + 1000, y: mid.y });
    const [c4] = await callouts(page);
    assert.ok(c4.x - c3.x >= 800 && c4.points[0].x - c3.points[0].x >= 800, 'выноска перенесена целиком');
    assert.equal(c4.y, c3.y);
  });

  it('выноска из каталога: клик — точка указания; Esc — выйти', async () => {
    const { page } = app;
    await page.click('#lsTabs button[data-ls-cat="site"]');
    await page.click('#lsItems [data-ls-kind="callout"]');
    const p = await worldToClient(page, 14000, 1000);
    await page.mouse.move(p.x, p.y);
    await page.mouse.click(p.x, p.y);
    await page.keyboard.press('Escape');
    const list = await callouts(page);
    assert.equal(list.length, 2);
    const c = list[1];
    assert.ok(Math.abs(c.points[0].x - 14000) <= 200 && Math.abs(c.points[0].y - 1000) <= 200);
    assert.equal(c.meta.text, 'Выноска');
  });

  it('стили «Эскиз»/«Чертёж», 3D и DXF: выноски без ошибок, слой LANDSCAPE_NOTES, в 3D нет', async () => {
    const { page } = app;
    for (const style of ['drawing', 'sketch']) {
      await page.evaluate(async (s) => {
        const k = window.__kepler;
        k.state.lsStyle = s;
        k.state.selection = null;
        (await import('./ui/view.js')).requestDraw();
      }, style);
      await page.waitForTimeout(250);
      if (process.env.KEPLER_SHOTS) await (await page.$('#canvas')).screenshot({ path: `${process.env.KEPLER_SHOTS}/callout-${style}.png` });
    }
    const res = await page.evaluate(async () => {
      const E = await import('./core/export.js');
      const M = await import('./core/mesh3d-landscape.js');
      const p = window.__kepler.state.project;
      const only = { ...p, site: { ...p.site, landscape: { objects: p.site.landscape.objects.filter((o) => o.kind === 'callout') } } };
      return { dxf: E.buildSitePlanDxf(p).includes('LANDSCAPE_NOTES'), faces: M.landscapeFaces(only).length };
    });
    assert.deepEqual(res, { dxf: true, faces: 0 });
    await page.click('#view3dBtn');
    await page.waitForTimeout(300);
    await page.keyboard.press('Escape');
    assert.deepEqual(app.errors, []);
  });

  it('ведомость растений в панели: цена → сумма и итог; Ctrl+Z', async () => {
    const { page } = app;
    await page.evaluate(() => window.__kepler.select(null));
    await page.waitForSelector('#lsPlants');
    const text = await page.textContent('#lsPlants');
    assert.match(text, /Деревья/);
    assert.match(text, /Яблоня/);
    assert.doesNotMatch(text, /Выноска/);
    const row = '#lsPlants details[data-plant="tree-fruit|apple"]';
    await page.click(`${row} summary`);
    await page.fill(`${row} input[data-pf="price"]`, '15000');
    await page.press(`${row} input[data-pf="price"]`, 'Enter');
    await page.waitForFunction(() => window.__kepler.state.project.site.landscape.plants?.['tree-fruit|apple']?.price === 15000);
    assert.match(await page.textContent('#lsPlantTotal'), /15\s000/);
    assert.ok(await page.$(`${row}[open]`), 'строка остаётся раскрытой');
    await page.fill(`${row} input[data-pf="size"]`, '2200');
    await page.press(`${row} input[data-pf="size"]`, 'Enter');
    await page.waitForFunction(() => window.__kepler.state.project.site.landscape.plants?.['tree-fruit|apple']?.size === 2200);
    if (process.env.KEPLER_SHOTS) await (await page.$('#propsPanel')).screenshot({ path: `${process.env.KEPLER_SHOTS}/plants-panel.png` });
    await blur(page);
    await page.keyboard.press('Control+z');
    await page.keyboard.press('Control+z');
    assert.equal(await page.evaluate(() => window.__kepler.state.project.site.landscape.plants), undefined);
    assert.deepEqual(app.errors, []);
  });
});
