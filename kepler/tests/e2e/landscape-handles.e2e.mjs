// e2e «Ландшафт»: постановка ровно по экрану при повёрнутом виде (север
// участка примера — 20°), режимы ручек клумбы по повторным кликам (поворот,
// растяжение, масштаб), поворот группы двух клумб, поворот помещения кнопкой
// «Повернуть 90°» в «Плане» (одна запись истории, Ctrl+Z).
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, openSample, worldToClient } from './helpers.mjs';

const A_AT = { x: 12000, y: -3500 };
const B_AT = { x: 12000, y: 1000 };

const objects = (page) => page.evaluate(() => (window.__kepler.state.project.site.landscape?.objects || [])
  .map((o) => ({ id: o.id, kind: o.kind, x: o.x, y: o.y, w: o.w, h: o.h, rotation: o.rotation })));
const undoLen = (page) => page.evaluate(async () => (await import('./ui/state.js')).history.undo.length);
const handleMode = (page) => page.evaluate(() => window.__kepler.state.itemHandle?.mode || 'select');
// Ручки рамки текущего выбора в клиентских координатах.
const frameHandles = (page) => page.evaluate(async () => {
  const H = await import('./core/landscape-handles.js');
  const s = window.__kepler.state;
  const info = H.lsHandleInfo(s.project.site.landscape.objects, s.selection, s.itemHandle, s.view.rotation);
  const r = document.getElementById('canvas').getBoundingClientRect();
  const c = (p) => { const q = window.__kepler.worldToScreen(p.x, p.y); return { id: p.id, x: r.left + q.x, y: r.top + q.y }; };
  return {
    frame: info.frame,
    corners: H.frameCorners(info.frame).map(c), edges: H.frameEdges(info.frame).map(c),
    rotators: H.frameRotators(info.frame, 20, s.view.scale).map(c), center: c(info.frame),
  };
});
// Углы объекта на экране (nw, ne).
const screenCorners = (page, id) => page.evaluate(async (oid) => {
  const L = await import('./core/landscape.js');
  const o = window.__kepler.state.project.site.landscape.objects.find((x) => x.id === oid);
  return L.objectCorners(o).map((p) => window.__kepler.worldToScreen(p.x, p.y));
}, id);

async function drag(page, from, to, steps = 8) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= steps; i += 1) await page.mouse.move(from.x + ((to.x - from.x) * i) / steps, from.y + ((to.y - from.y) * i) / steps);
  await page.mouse.up();
}

describe('ландшафт: постановка по экрану, режимы ручек, группа; поворот помещения', () => {
  let app;
  let a;
  let b;
  before(async () => {
    app = await startApp();
    await openSample(app.page);
    await app.page.click('#landscapeBtn');
  });
  after(async () => { await app?.close(); });

  it('вид повёрнут — клумба-короб и призрак стоят ровно по экрану', async () => {
    const { page } = app;
    const view = await page.evaluate(() => window.__kepler.state.view.rotation);
    assert.ok(Math.abs(view) > 0.1, 'вид «Ландшафта» повёрнут по северу участка');
    await page.click('#lsTabs button[data-ls-cat="green"]');
    await page.click('#lsItems [data-ls-kind="planter-box"]');
    const p = await worldToClient(page, A_AT.x, A_AT.y);
    await page.mouse.move(p.x, p.y);
    const ghost = await page.evaluate(() => window.__kepler.state.ghostLandscape?.rotation);
    assert.ok(Math.abs(ghost - (-view * 180) / Math.PI) < 0.02 || Math.abs(ghost - 360 - (-view * 180) / Math.PI) < 0.02, 'призрак — по экрану');
    await page.mouse.click(p.x, p.y);
    await page.keyboard.press('Escape');
    [a] = await objects(page);
    assert.equal(a.kind, 'planter-box');
    const [nw, ne, , sw] = await screenCorners(page, a.id);
    assert.ok(Math.abs(nw.y - ne.y) < 0.5, 'верх горизонтален на экране');
    assert.ok(Math.abs(nw.x - sw.x) < 0.5, 'бок вертикален на экране');
  });

  it('повторные клики по клумбе: поворот → растяжение → масштаб → выбор', async () => {
    const { page } = app;
    const c = await worldToClient(page, a.x, a.y);
    await page.mouse.click(c.x, c.y);
    assert.deepEqual(await page.evaluate(() => window.__kepler.state.selection), { type: 'landscape', ids: [a.id] });
    assert.equal(await handleMode(page), 'select');
    await page.waitForTimeout(400);
    await page.mouse.click(c.x, c.y);
    assert.equal(await handleMode(page), 'rotate');
    // Поворот за круг у угла: +90° (шаг 15°) от экранного угла.
    const undo0 = await undoLen(page);
    let h = await frameHandles(page);
    const rot = h.rotators.find((r) => r.id === 'se');
    const ang = Math.atan2(rot.y - h.center.y, rot.x - h.center.x) + Math.PI / 2;
    const len = Math.hypot(rot.x - h.center.x, rot.y - h.center.y);
    await drag(page, rot, { x: h.center.x + Math.cos(ang) * len, y: h.center.y + Math.sin(ang) * len }, 12);
    let o = (await objects(page)).find((x) => x.id === a.id);
    const d = (((o.rotation - a.rotation) % 360) + 360) % 360;
    assert.ok(Math.abs(d - 90) < 0.05, `повёрнута на 90° (${d})`);
    assert.equal(await undoLen(page), undo0 + 1, 'одна запись истории');
    await page.keyboard.press('Control+z');
    o = (await objects(page)).find((x) => x.id === a.id);
    assert.ok(Math.abs(o.rotation - a.rotation) < 0.01, 'Ctrl+Z вернул угол');
    // Растяжение: восточная сторона на 60 px, западная на месте
    // (Ctrl+Z мог сбросить режим — кликаем до «растяжения»).
    for (let i = 0; i < 4 && await handleMode(page) !== 'stretch'; i += 1) {
      await page.waitForTimeout(400);
      await page.mouse.click(c.x, c.y);
    }
    assert.equal(await handleMode(page), 'stretch');
    h = await frameHandles(page);
    const e = h.edges.find((x) => x.id === 'e');
    const before = await screenCorners(page, a.id);
    await drag(page, e, { x: e.x + 60, y: e.y });
    o = (await objects(page)).find((x) => x.id === a.id);
    assert.ok(o.w > a.w + 500, `шире (${o.w})`);
    assert.equal(o.h, a.h, 'глубина та же');
    const after = await screenCorners(page, a.id);
    assert.ok(Math.hypot(after[0].x - before[0].x, after[0].y - before[0].y) < 2, 'западная сторона на месте');
    // Масштаб за угол и снова «Выбор».
    await page.waitForTimeout(400);
    const c2 = await worldToClient(page, o.x, o.y);
    await page.mouse.click(c2.x, c2.y);
    assert.equal(await handleMode(page), 'scale');
    h = await frameHandles(page);
    const se = h.corners.find((x) => x.id === 'se');
    await drag(page, se, { x: se.x + 30, y: se.y + 30 });
    const scaled = (await objects(page)).find((x) => x.id === a.id);
    assert.ok(scaled.h > o.h, 'угол меняет размер');
    await page.waitForTimeout(400);
    const c3 = await worldToClient(page, scaled.x, scaled.y);
    await page.mouse.click(c3.x, c3.y);
    assert.equal(await handleMode(page), 'select');
    a = scaled;
  });

  it('две клумбы: повторный клик — поворот группы вокруг общего центра', async () => {
    const { page } = app;
    await page.click('#lsItems [data-ls-kind="planter-box"]');
    const p = await worldToClient(page, B_AT.x, B_AT.y);
    await page.mouse.click(p.x, p.y);
    await page.keyboard.press('Escape');
    b = (await objects(page)).find((x) => x.id !== a.id);
    await page.evaluate((ids) => window.__kepler.select({ type: 'landscape', ids }), [a.id, b.id]);
    const c = await worldToClient(page, b.x, b.y);
    await page.mouse.click(c.x, c.y);
    assert.equal(await handleMode(page), 'rotate', 'режим группы');
    const undo0 = await undoLen(page);
    const h = await frameHandles(page);
    const rot = h.rotators.find((r) => r.id === 'ne');
    const ang = Math.atan2(rot.y - h.center.y, rot.x - h.center.x) + Math.PI / 2;
    const len = Math.hypot(rot.x - h.center.x, rot.y - h.center.y);
    await drag(page, rot, { x: h.center.x + Math.cos(ang) * len, y: h.center.y + Math.sin(ang) * len }, 12);
    const list = await objects(page);
    const a2 = list.find((x) => x.id === a.id);
    const b2 = list.find((x) => x.id === b.id);
    for (const [s, t] of [[a, a2], [b, b2]]) {
      const d = (((t.rotation - s.rotation) % 360) + 360) % 360;
      assert.ok(Math.abs(d - 90) < 0.05, `каждая повёрнута на 90° (${d})`);
    }
    // Взаимное расстояние сохранилось — поворот, а не перенос.
    assert.ok(Math.abs(Math.hypot(a2.x - b2.x, a2.y - b2.y) - Math.hypot(a.x - b.x, a.y - b.y)) < 3);
    assert.equal(await undoLen(page), undo0 + 1, 'одна запись истории');
    await page.keyboard.press('Escape');
    assert.equal(await handleMode(page), 'select', 'Esc — выход из режима, выбор остаётся');
    assert.equal((await page.evaluate(() => window.__kepler.state.selection)).ids.length, 2);
  });

  it('«План»: кнопка «Повернуть 90°» у помещения — с мебелью; Ctrl+Z', async () => {
    const { page } = app;
    await page.click('#levelBar button[data-level]');
    const room = await page.evaluate(() => {
      const s = window.__kepler.state;
      const r = s.project.rooms.find((x) => !x.parentId);
      return { id: r.id, w: r.w, h: r.h };
    });
    await page.evaluate((id) => window.__kepler.selectRoom(id), room.id);
    const btn = await page.$('#selectionToolbar [data-selection-action="rotate"]');
    assert.ok(btn, 'кнопка поворота у помещения');
    const undo0 = await undoLen(page);
    await btn.click();
    const after = await page.evaluate((id) => {
      const r = window.__kepler.state.project.rooms.find((x) => x.id === id);
      return { w: r.w, h: r.h };
    }, room.id);
    assert.deepEqual(after, { w: room.h, h: room.w }, 'стороны поменялись — повёрнуто на 90°');
    assert.equal(await undoLen(page), undo0 + 1, 'одна запись истории');
    await page.keyboard.press('Control+z');
    const back = await page.evaluate((id) => {
      const r = window.__kepler.state.project.rooms.find((x) => x.id === id);
      return { w: r.w, h: r.h };
    }, room.id);
    assert.deepEqual(back, { w: room.w, h: room.h });
    assert.deepEqual(app.errors, []);
  });
});
