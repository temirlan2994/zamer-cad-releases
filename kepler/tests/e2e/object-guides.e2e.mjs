// e2e «Умные направляющие» при перемещении (core/guides.js, ui/guides-ui.js):
// две клумбы-короба — вторую ведём к первой, появляется направляющая и
// левый край прилипает; Shift во время жеста и выключатель «Направляющие»
// отключают привязку; то же для мебели и группы мебели.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, openSample, dropOnCanvas, zoomToItems } from './helpers.mjs';

const MIME = 'application/x-kepler-landscape';

describe('умные направляющие перемещения', () => {
  let app;
  before(async () => {
    app = await startApp({ width: 1400, height: 900 });
    await openSample(app.page);
  });
  after(async () => { await app?.close(); });

  const canvasBox = async () => (await app.page.$('#canvas')).boundingBox();
  // Экранные габариты ландшафтного объекта (по углам реальной формы).
  const lsScreenBox = (id) => app.page.evaluate(async (oid) => {
    const L = await import('./core/landscape.js');
    const o = window.__kepler.state.project.site.landscape.objects.find((x) => x.id === oid);
    const pts = L.objectCorners(o).map((p) => window.__kepler.worldToScreen(p.x, p.y));
    const xs = pts.map((p) => p.x); const ys = pts.map((p) => p.y);
    return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys), cx: (Math.min(...xs) + Math.max(...xs)) / 2, cy: (Math.min(...ys) + Math.max(...ys)) / 2 };
  }, id);
  const guidesNow = () => app.page.evaluate(() => (window.__kepler.state.objGuides || []).length);
  const undo = () => app.page.keyboard.press('Control+z');

  // Тянем мышью от экранной точки from на (dx, dy) px; shiftMid — Shift зажат во время жеста.
  async function drag(from, dx, dy, { shiftMid = false } = {}) {
    const c = await canvasBox();
    const p = { x: c.x + from.x, y: c.y + from.y };
    await app.page.mouse.move(p.x, p.y);
    await app.page.mouse.down();
    if (shiftMid) await app.page.keyboard.down('Shift');
    const n = 8;
    for (let i = 1; i <= n; i += 1) await app.page.mouse.move(p.x + (dx * i) / n, p.y + (dy * i) / n);
    const shown = await guidesNow();
    await app.page.mouse.up();
    if (shiftMid) await app.page.keyboard.up('Shift');
    await app.page.waitForTimeout(60);
    return shown;
  }

  it('ландшафт: две клумбы — направляющая и прилипание левого края; Shift и выключатель — без привязки', async () => {
    const { page } = app;
    await page.click('#landscapeBtn');
    await page.click('#lsTabs button[data-ls-cat="green"]');
    const c = await canvasBox();
    // Две клумбы в свободном месте экрана: вторая правее и ниже.
    await dropOnCanvas(page, MIME, 'planter-box', { x: c.width * 0.78, y: c.height * 0.2 });
    await dropOnCanvas(page, MIME, 'planter-box', { x: c.width * 0.88, y: c.height * 0.45 });
    const ids = await page.evaluate(() => window.__kepler.state.project.site.landscape.objects
      .filter((o) => o.kind === 'planter-box').map((o) => o.id));
    assert.equal(ids.length, 2);
    const [aId, bId] = ids;
    const A = await lsScreenBox(aId);
    const B = await lsScreenBox(bId);
    // Ведём B за борт так, чтобы его левый край оказался в 3 px от левого края A.
    const grab = { x: B.cx, y: B.minY + 4 };
    const dx = A.minX + 3 - B.minX;
    const shown = await drag(grab, dx, 0);
    assert.ok(shown > 0, 'направляющая во время жеста');
    const B1 = await lsScreenBox(bId);
    assert.ok(Math.abs(B1.minX - A.minX) < 0.6, `левый край прилип: ${B1.minX} vs ${A.minX}`);
    assert.equal(await guidesNow(), 0, 'после жеста направляющие убраны');
    // Ctrl+Z — одним шагом назад.
    await undo();
    const B2 = await lsScreenBox(bId);
    assert.ok(Math.abs(B2.minX - B.minX) < 0.6, 'отмена вернула клумбу');
    // Shift во время жеста — без направляющих.
    const shownShift = await drag(grab, dx, 0, { shiftMid: true });
    assert.equal(shownShift, 0, 'Shift — без направляющих');
    const B3 = await lsScreenBox(bId);
    assert.ok(Math.abs(B3.minX - A.minX) > 0.6, 'Shift — край не прилип');
    await undo();
    // Выключатель «Направляющие» среди значков привязок.
    await page.click('#snapBar [data-snap="guides"]');
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('kepler-draw-snap')).guides), false);
    const shownOff = await drag(grab, dx, 0);
    assert.equal(shownOff, 0, 'выключено — без направляющих');
    await undo();
    await page.click('#snapBar [data-snap="guides"]');
    assert.equal(await page.evaluate(() => window.__kepler.state.snapSettings.guides), true);
    assert.deepEqual(app.errors, []);
  });

  it('мебель и группа мебели прилипают к краю другого предмета', async () => {
    const { page } = app;
    await page.click('#modePlanBtn');
    const ids = await page.evaluate(() => {
      const k = window.__kepler.state;
      const room = k.project.rooms.reduce((a, b) => (a.w * a.h >= b.w * b.h ? a : b));
      const list = k.project.items.filter((i) => !i.comp && i.w >= 400 && i.h >= 400).slice(0, 3);
      // Остальная мебель — вне комнаты, чтобы не мешала.
      for (const it of k.project.items) if (!list.includes(it)) { it.x = room.x - 50000; it.y = room.y - 50000; }
      const cx = room.x + room.w / 2; const cy = room.y + room.h / 2;
      const pos = [[cx - 1300, cy - 900], [cx + 200, cy + 700], [cx + 1200, cy + 700]];
      list.forEach((it, n) => { it.rotation = 0; it.w = 600; it.h = 500; it.group = undefined; [it.x, it.y] = pos[n]; });
      window.__kepler.fitView?.();
      return list.map((i) => i.id);
    });
    assert.equal(ids.length, 3);
    // Мебель берётся мышью только при 1:45 и ближе.
    await zoomToItems(page, 0.12, ids);
    await page.waitForTimeout(100);
    const scr = (id) => page.evaluate((iid) => {
      const it = window.__kepler.state.project.items.find((i) => i.id === iid);
      const s = window.__kepler.planToScreen(it.x - it.w / 2, it.y);
      const c = window.__kepler.planToScreen(it.x, it.y);
      return { left: s.x, cx: c.x, cy: c.y, x: it.x, y: it.y };
    }, id);
    const sel = (id) => page.evaluate((iid) => window.__kepler.state.selection?.id === iid
      || window.__kepler.state.selection?.itemIds?.includes(iid), id);
    const [aId, bId, cId] = ids;
    // Один предмет: B к левому краю A (3 px не доходя).
    const A = await scr(aId);
    let B = await scr(bId);
    const c = await canvasBox();
    await page.mouse.click(c.x + B.cx, c.y + B.cy);
    assert.ok(await sel(bId));
    const shown = await drag({ x: B.cx, y: B.cy }, A.left + 3 - B.left, 0);
    assert.ok(shown > 0, 'направляющая у мебели');
    B = await scr(bId);
    assert.ok(Math.abs(B.left - A.left) < 0.6, `край предмета прилип: ${B.left} vs ${A.left}`);
    await undo();
    // Группа B + C: левый край группы (B) к левому краю A.
    B = await scr(bId);
    const C = await scr(cId);
    await page.evaluate(async (list) => {
      (await import('./ui/tools.js')).selectObject({ type: 'multi', roomIds: [], itemIds: list });
    }, [bId, cId]);
    assert.equal(await page.evaluate(() => window.__kepler.state.selection?.type), 'multi');
    // 1,5 px до края A — ближе любых случайных совпадений с другими целями.
    const shownG = await drag({ x: B.cx, y: B.cy }, A.left + 1.5 - B.left, 0);
    assert.ok(shownG > 0, 'направляющая у группы');
    const B2 = await scr(bId);
    const C2 = await scr(cId);
    assert.ok(Math.abs(B2.left - A.left) < 0.6, `группа прилипла левым краем ${JSON.stringify([A, B, B2])}`);
    assert.ok(Math.abs((C2.x - B2.x) - (C.x - B.x)) < 1e-6, 'группа едет целиком');
    assert.deepEqual(app.errors, []);
  });
});
