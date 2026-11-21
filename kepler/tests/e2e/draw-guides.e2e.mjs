// e2e: привязки черчения линий (core/draw-snap.js, ui/draw-snap-ui.js) —
// полярный луч 90°, орто (F8 и Ctrl), выравнивание по вершине другой линии,
// динамический ввод длины (число + Enter), Shift без привязок; в «Ландшафте»
// (дорожка, ограждение) и в «Участке» (граница). Курсор смещается на
// несколько пикселей от точной оси — точка должна встать ровно на ось.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, openNew } from './helpers.mjs';

const toolPoints = (page) => page.evaluate(() => (window.__kepler.state.draft?.points
  || window.__kepler.state.tool?.points || []).map((p) => ({ x: p.x, y: p.y })));
const snapKind = (page) => page.evaluate(() => window.__kepler.state.drawSnap?.kind || null);
const scale = (page) => page.evaluate(() => window.__kepler.state.view.scale);

// Мировая точка + сдвиг в экранных пикселях → клиентские координаты.
async function client(page, p, dx = 0, dy = 0) {
  const box = await (await page.$('#canvas')).boundingBox();
  const s = await page.evaluate(([x, y]) => window.__kepler.worldToScreen(x, y), [p.x, p.y]);
  return { x: box.x + s.x + dx, y: box.y + s.y + dy };
}
async function canvasAt(page, fx, fy) {
  const box = await (await page.$('#canvas')).boundingBox();
  const catalog = await page.locator('.library').boundingBox();
  const left = catalog ? Math.max(box.x, catalog.x + catalog.width) : box.x;
  return { x: left + (box.x + box.width - left) * fx, y: box.y + box.height * fy };
}
async function moveClick(page, c) {
  await page.mouse.move(c.x - 3, c.y - 3);
  await page.mouse.move(c.x, c.y);
  await page.mouse.click(c.x, c.y);
}
const last = (pts) => pts[pts.length - 1];

describe('привязки черчения: лучи, орто, выравнивание, ввод длины', () => {
  let app;
  before(async () => {
    app = await startApp();
    await openNew(app.page);
  });
  after(async () => { await app?.close(); });

  it('привязки — значки внизу холста; F8 и значок «Орто» переключают орто', async () => {
    const { page } = app;
    const ortho = '#snapBar [data-snap="ortho"]';
    for (const k of ['ortho', 'polar', 'objects', 'tracking']) assert.equal(await page.isVisible(`#snapBar [data-snap="${k}"]`), true, k);
    await page.keyboard.press('F8');
    assert.equal(await page.evaluate(() => window.__kepler.state.snapSettings.ortho), true);
    assert.equal(await page.$eval(ortho, (n) => n.classList.contains('on')), true);
    assert.equal(await page.getAttribute(ortho, 'aria-pressed'), 'true');
    await page.keyboard.press('F8');
    assert.equal(await page.evaluate(() => window.__kepler.state.snapSettings.ortho), false);
    await page.click(ortho);
    assert.equal(await page.evaluate(() => window.__kepler.state.snapSettings.ortho), true);
    assert.equal(await page.getAttribute(ortho, 'aria-pressed'), 'true');
    await page.click(ortho);
    assert.equal(await page.evaluate(() => window.__kepler.state.snapSettings.ortho), false);
    await page.mouse.move(5, 5);
  });

  it('«Участок», граница: почти вертикаль → 90°, Ctrl → орто, Enter — замкнуть', async () => {
    const { page } = app;
    await page.click('#modeSiteBtn');
    await page.click('#siteTools button:nth-child(2)'); // «Граница участка»
    await moveClick(page, await canvasAt(page, 0.35, 0.65));
    const [a] = await toolPoints(page);
    // Вторая точка: на 5 px правее вертикали над первой.
    await page.mouse.move(...Object.values(await client(page, a, 5, -160)));
    assert.equal(await snapKind(page), 'polar');
    assert.match(await page.evaluate(() => window.__kepler.state.drawSnap.tooltip), /м · 90°$/);
    await moveClick(page, await client(page, a, 5, -160));
    const b = last(await toolPoints(page));
    assert.ok(Math.abs(b.x - a.x) < 0.5, `x ${b.x} ≠ ${a.x}`);
    assert.ok(b.y < a.y - 1000);
    // Ctrl — временное орто: курсор по диагонали ~20°, точка — ровно по горизонтали.
    await page.keyboard.down('Control');
    await moveClick(page, await client(page, b, 220, -80));
    await page.keyboard.up('Control');
    const c = last(await toolPoints(page));
    assert.ok(Math.abs(c.y - b.y) < 0.5, `y ${c.y} ≠ ${b.y}`);
    assert.ok(c.x > b.x + 1000);
    await page.keyboard.press('Enter');
    const boundary = await page.evaluate(() => window.__kepler.state.project.site.boundary);
    assert.equal(boundary.length, 3);
    assert.ok(Math.abs(boundary[1].x - boundary[0].x) < 0.5 && Math.abs(boundary[2].y - boundary[1].y) < 0.5);
  });

  it('«Ландшафт», дорожка: 90°, F8 орто, Shift — без привязки', async () => {
    const { page } = app;
    await page.click('#landscapeBtn');
    await page.click('#lsTabs button[data-ls-cat="site"]');
    await page.click('#lsItems [data-ls-kind="path"]');
    await moveClick(page, await canvasAt(page, 0.3, 0.5));
    const [a] = await toolPoints(page);
    await moveClick(page, await client(page, a, 4, -150));
    const b = last(await toolPoints(page));
    assert.ok(Math.abs(b.x - a.x) < 0.5, `90°: x ${b.x} ≠ ${a.x}`);
    await page.keyboard.press('F8');
    await moveClick(page, await client(page, b, 200, -60));
    const c = last(await toolPoints(page));
    assert.ok(Math.abs(c.y - b.y) < 0.5, `орто: y ${c.y} ≠ ${b.y}`);
    await page.keyboard.press('F8');
    // Shift: та же почти-вертикаль от c не прилипает.
    await page.keyboard.down('Shift');
    await moveClick(page, await client(page, c, 6, 120));
    await page.keyboard.up('Shift');
    const d = last(await toolPoints(page));
    const px = 1 / (await scale(page));
    assert.ok(Math.abs(d.x - c.x) > 3 * px, `Shift: x ${d.x} прилип к ${c.x}`);
    await page.keyboard.press('Backspace'); // убрать «свободную» точку
    await page.keyboard.press('Enter');
    const path = await page.evaluate(() => window.__kepler.state.project.site.landscape.objects.at(-1));
    assert.equal(path.kind, 'path');
    assert.equal(path.points.length, 3);
  });

  it('ограждение: выравнивание по вершине дорожки и ввод длины с клавиатуры', async () => {
    const { page } = app;
    const path = await page.evaluate(() => window.__kepler.state.project.site.landscape.objects.at(-1));
    const a = path.points[0];
    await page.click('#lsTabs button[data-ls-cat="site"]');
    await page.click('#lsItems [data-ls-kind="fence-line"]');
    await moveClick(page, await client(page, a, 300, 100));
    const [c] = await toolPoints(page);
    // Курсор в 3 px от вертикали через первую вершину дорожки, ниже неё.
    const ca = await client(page, a);
    const cc = await client(page, c);
    await page.mouse.move(ca.x + 3, cc.y + 120);
    assert.equal(await snapKind(page), 'track');
    await page.mouse.click(ca.x + 3, cc.y + 120);
    const p = last(await toolPoints(page));
    assert.ok(Math.abs(p.x - a.x) < 0.5, `выравнивание: x ${p.x} ≠ ${a.x}`);
    // Направление — вниз по лучу 270°, длина 3000 мм набрана с клавиатуры.
    await page.mouse.move(...Object.values(await client(page, p, 3, 60)));
    await page.keyboard.type('3000');
    assert.equal(await page.evaluate(() => window.__kepler.state.dynInput?.length), '3000');
    await page.keyboard.press('Enter');
    const q = last(await toolPoints(page));
    assert.ok(Math.abs(q.x - p.x) < 0.5 && Math.abs(q.y - (p.y + 3000)) < 0.5, `ввод: ${JSON.stringify(q)}`);
    assert.equal(await page.evaluate(() => window.__kepler.state.tool?.kind), 'draw-landscape', 'Enter с числом не завершает');
    await page.keyboard.press('Enter');
    const fence = await page.evaluate(() => window.__kepler.state.project.site.landscape.objects.at(-1));
    assert.equal(fence.kind, 'fence-line');
    assert.equal(fence.points.length, 3);
  });

  it('без ошибок в консоли', () => {
    assert.deepEqual(app.errors, []);
  });
});
