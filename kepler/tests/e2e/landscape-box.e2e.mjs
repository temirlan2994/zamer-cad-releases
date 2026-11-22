// e2e «Ландшафт»: клумба-короб с посадками и наружная лестница —
// перетаскивание короба из каталога, растение «на короб» садится внутрь,
// короб двигается/поворачивается/копируется/удаляется вместе с растениями
// (одна запись истории, Ctrl+Z), «Посадить в короб», лестница — ступени
// по высоте подъёма, оба стиля рисуются без ошибок консоли.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, openSample, dropOnCanvas, worldToClient } from './helpers.mjs';

const MIME = 'application/x-kepler-landscape';
// Свободное место участка примера (граница −5…16 × −6…12 м), в стороне от дома.
const BOX_AT = { x: 12000, y: -3500 };

const objects = (page) => page.evaluate(() => (window.__kepler.state.project.site.landscape?.objects || [])
  .map((o) => ({ id: o.id, kind: o.kind, x: o.x, y: o.y, w: o.w, h: o.h, rotation: o.rotation, parent: o.parent, height: o.height, meta: o.meta })));
const undoLen = (page) => page.evaluate(async () => (await import('./ui/state.js')).history.undo.length);
const at = (page, p) => page.evaluate(([x, y]) => window.__kepler.worldToScreen(x, y), [p.x, p.y]);
// Растение внутри засыпки короба (внутренний контур).
const inside = (page, boxId, id) => page.evaluate(async ([b, c]) => {
  const L = await import('./core/landscape.js');
  const { pointInPolygon } = await import('./core/zamer/geometry.js');
  const objs = window.__kepler.state.project.site.landscape.objects;
  const box = objs.find((o) => o.id === b); const o = objs.find((x) => x.id === c);
  return pointInPolygon(o, L.planterInner(box));
}, [boxId, id]);

describe('ландшафт: клумба-короб и лестница', () => {
  let app;
  let box;
  before(async () => {
    app = await startApp({ width: 1075 });
    await openSample(app.page);
    await app.page.click('#landscapeBtn');
  });
  after(async () => { await app?.close(); });

  it('короб из каталога: перетаскивание, панель — борт, засыпка, «Посадить внутрь»', async () => {
    const { page } = app;
    await page.click('#lsTabs button[data-ls-cat="green"]');
    assert.ok(await page.$('#lsItems [data-ls-kind="planter-box"]'), 'карточка короба');
    assert.ok(await page.$('#lsItems [data-ls-kind="flowers-clump"]'), 'карточка цветов');
    await dropOnCanvas(page, MIME, 'planter-box', await at(page, BOX_AT));
    [box] = await objects(page);
    assert.equal(box.kind, 'planter-box');
    assert.deepEqual(box.meta, { wall: 180, fill: 'soil' });
    const panel = await page.textContent('#propsPanel');
    assert.match(panel, /Толщина борта/);
    assert.match(panel, /Посадить внутрь/);
    await page.selectOption('#lsPlFill', 'mulch');
    assert.equal((await objects(page))[0].meta.fill, 'mulch');
  });

  it('растение, брошенное на борт, садится внутрь и привязывается к коробу', async () => {
    const { page } = app;
    // У самого края короба (на борту).
    await dropOnCanvas(page, MIME, 'flowers-clump', await at(page, { x: box.x + box.w / 2 - 50, y: box.y }));
    await dropOnCanvas(page, MIME, 'shrub-box', await at(page, { x: box.x - 800, y: box.y }));
    const kids = (await objects(page)).filter((o) => o.parent === box.id);
    assert.equal(kids.length, 2);
    for (const c of kids) assert.ok(await inside(page, box.id, c.id), `${c.kind} внутри`);
    const fl = kids.find((o) => o.kind === 'flowers-clump');
    assert.ok(fl.x + fl.w / 2 <= box.x + box.w / 2 - 180 + 1, 'не выходит за борт');
    assert.match(await page.textContent('#propsPanel'), /В коробе/);
    // Растение вне короба — не привязано.
    await dropOnCanvas(page, MIME, 'grass-clump', await at(page, { x: box.x, y: box.y + 3000 }));
    assert.equal((await objects(page)).find((o) => o.kind === 'grass-clump').parent, undefined);
  });

  it('короб мышью: растения едут вместе, одна запись истории, Ctrl+Z', async () => {
    const { page } = app;
    const before = await objects(page);
    const undo0 = await undoLen(page);
    // Хватаем за борт (не за растение); короб стоит ровно по экрану — борт в его осях.
    const a = ((box.rotation || 0) * Math.PI) / 180;
    const ly = -box.h / 2 + 60;
    const p = await worldToClient(page, box.x - ly * Math.sin(a), box.y + ly * Math.cos(a));
    await page.mouse.move(p.x, p.y);
    await page.mouse.down();
    for (let i = 1; i <= 6; i += 1) await page.mouse.move(p.x - i * 12, p.y + i * 8);
    await page.mouse.up();
    const after1 = await objects(page);
    const nb = after1.find((o) => o.id === box.id);
    const dx = nb.x - box.x; const dy = nb.y - box.y;
    assert.ok(Math.hypot(dx, dy) > 300, 'короб уехал');
    for (const c of before.filter((o) => o.parent === box.id)) {
      const n = after1.find((o) => o.id === c.id);
      assert.deepEqual([n.x - c.x, n.y - c.y], [dx, dy], `${c.kind} со сдвигом короба`);
    }
    const free = before.find((o) => o.kind === 'grass-clump');
    assert.deepEqual(after1.find((o) => o.id === free.id).x, free.x, 'чужое не двигается');
    assert.equal(await undoLen(page), undo0 + 1);
    await page.keyboard.press('Control+z');
    assert.deepEqual(await objects(page), before);
  });

  it('R — поворот с растениями; Ctrl+D — копия с растениями; Delete — вместе; Ctrl+Z', async () => {
    const { page } = app;
    await page.evaluate((id) => window.__kepler.select({ type: 'landscape', ids: [id] }), box.id);
    const kids0 = (await objects(page)).filter((o) => o.parent === box.id);
    await page.keyboard.press('KeyR');
    let list = await objects(page);
    assert.equal(list.find((o) => o.id === box.id).rotation, ((box.rotation || 0) + 90) % 360);
    for (const c of kids0) {
      const n = list.find((o) => o.id === c.id);
      // Поворот на 90° по часовой вокруг центра короба: (dx, dy) → (−dy, dx).
      assert.ok(Math.abs(n.x - (box.x - (c.y - box.y))) <= 1 && Math.abs(n.y - (box.y + (c.x - box.x))) <= 1, c.kind);
      assert.ok(await inside(page, box.id, c.id));
    }
    const count = list.length;
    await page.keyboard.press('Control+d');
    list = await objects(page);
    assert.equal(list.length, count + 3, 'короб + 2 растения');
    const copy = list.find((o) => o.kind === 'planter-box' && o.id !== box.id);
    assert.equal(list.filter((o) => o.parent === copy.id).length, 2, 'растения копии — в копии');
    await page.keyboard.press('Delete');
    assert.equal((await objects(page)).length, count, 'копия удалена вместе с растениями');
    await page.evaluate((id) => window.__kepler.select({ type: 'landscape', ids: [id] }), box.id);
    await page.keyboard.press('Delete');
    list = await objects(page);
    assert.equal(list.filter((o) => o.id === box.id || o.parent === box.id).length, 0);
    await page.keyboard.press('Control+z');
    assert.equal((await objects(page)).filter((o) => o.parent === box.id).length, 2, 'Ctrl+Z вернул короб с растениями');
  });

  it('«Посадить в короб» заполняет засыпку привязанными растениями', async () => {
    const { page } = app;
    await page.evaluate((id) => window.__kepler.select({ type: 'landscape', ids: [id] }), box.id);
    // В коробе уже сидят цветы и самшит. Оставляем место для новых цветов независимо от привязки при броске.
    await page.fill('#lsW', '5');
    await page.press('#lsW', 'Tab');
    const n0 = (await objects(page)).filter((o) => o.parent === box.id).length;
    await page.selectOption('#lsInKind', 'flowers-clump');
    await page.fill('#lsInDensity', '1');
    await page.click('#lsInGo');
    const kids = (await objects(page)).filter((o) => o.parent === box.id);
    assert.ok(kids.length > n0, `${n0} → ${kids.length}`);
    for (const c of kids) assert.ok(await inside(page, box.id, c.id));
  });

  it('лестница: высота подъёма → ступени, проступь, «N ступ.», оба стиля без ошибок', async () => {
    const { page } = app;
    await page.click('#lsTabs button[data-ls-cat="site"]');
    assert.ok(await page.$('#lsItems [data-ls-kind="stairs-out"]'));
    assert.ok(await page.$('#lsItems [data-ls-kind="curb"]'));
    await dropOnCanvas(page, MIME, 'stairs-out', await at(page, { x: 12000, y: 7000 }));
    const st = (await objects(page)).find((o) => o.kind === 'stairs-out');
    assert.deepEqual([st.height, st.h], [750, 1500]);
    await page.fill('#lsStRise', '900');
    await page.press('#lsStRise', 'Enter');
    await page.waitForFunction(() => window.__kepler.state.project.site.landscape.objects.find((o) => o.kind === 'stairs-out').height === 900);
    const st2 = (await objects(page)).find((o) => o.kind === 'stairs-out');
    assert.equal(st2.h, 1800, '6 ступеней × 300');
    assert.match(await page.textContent('#propsPanel'), /Подступенок\s*150 мм/);
    await page.check('#lsStCheeks');
    assert.equal((await objects(page)).find((o) => o.kind === 'stairs-out').w, 1500 + 300, 'марш сохранён, борта добавлены');
    // Перерисовка в обоих стилях.
    for (const style of ['drawing', 'sketch']) {
      await page.evaluate(async (s) => { window.__kepler.state.lsStyle = s; (await import('./ui/view.js')).requestDraw(); }, style);
      await page.waitForTimeout(150);
    }
    assert.deepEqual(app.errors, []);
  });
});
