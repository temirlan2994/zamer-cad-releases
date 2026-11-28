// e2e «Ландшафт»: тянуть ребро выбранной площадки как линию — ховер (курсор,
// подсветка), сдвиг ребра со смежными, упор при схлопывании, Esc — отмена,
// Ctrl+Z одним шагом; ручки вершин и середин и перенос тела — как раньше.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, openSample, worldToClient, settleCanvas } from './helpers.mjs';

const AT = { x: 12000, y: -3500 };
const W = 120; // полуширина площадки на экране, px
const H = 80;

const undoLen = (page) => page.evaluate(async () => (await import('./ui/state.js')).history.undo.length);
const cursor = (page) => page.evaluate(() => document.getElementById('canvas').style.cursor);
const lawn = (page) => page.evaluate(() => {
  const o = window.__kepler.state.project.site.landscape.objects.find((x) => x.id === 'ls-edge-e2e');
  return o.points.map((p) => ({ ...p }));
});
// Вершины на экране (клиентские координаты).
const screenPts = (page) => page.evaluate(() => {
  const r = document.getElementById('canvas').getBoundingClientRect();
  const o = window.__kepler.state.project.site.landscape.objects.find((x) => x.id === 'ls-edge-e2e');
  return o.points.map((p) => { const s = window.__kepler.worldToScreen(p.x, p.y); return { x: r.left + s.x, y: r.top + s.y }; });
});
const lerp = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
const crossDir = (a, b, c, d) => {
  const u = { x: b.x - a.x, y: b.y - a.y };
  const v = { x: d.x - c.x, y: d.y - c.y };
  return (u.x * v.y - u.y * v.x) / (Math.hypot(u.x, u.y) * Math.hypot(v.x, v.y));
};

async function drag(page, from, to, steps = 8) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= steps; i += 1) await page.mouse.move(from.x + ((to.x - from.x) * i) / steps, from.y + ((to.y - from.y) * i) / steps);
  await page.mouse.up();
}

describe('ландшафт: тянуть ребро площадки', () => {
  let app;
  let p0;
  before(async () => {
    app = await startApp();
    await openSample(app.page);
    await app.page.click('#landscapeBtn');
    const c = await worldToClient(app.page, AT.x, AT.y);
    // Газон — прямоугольник, ровный на экране (вид «Ландшафта» повёрнут).
    await app.page.evaluate(async ({ cx, cy, w, h }) => {
      const L = await import('./core/landscape.js');
      const r = document.getElementById('canvas').getBoundingClientRect();
      const pts = [[-w, -h], [w, -h], [w, h], [-w, h]].map(([dx, dy]) => {
        const p = window.__kepler.screenToWorld(cx - r.left + dx, cy - r.top + dy);
        return { x: Math.round(p.x), y: Math.round(p.y) };
      });
      const o = L.createLandscapeObject('lawn-area', 0, 0, { id: 'ls-edge-e2e', points: pts });
      window.__kepler.state.project.site.landscape.objects.push(o);
      window.__kepler.select({ type: 'landscape', ids: [o.id] });
    }, { cx: c.x, cy: c.y, w: W, h: H });
    p0 = await lawn(app.page);
  });
  after(async () => { await app?.close(); });

  it('ховер на ребро — курсор по наклону и подсветка; на середину — «вставить»', async () => {
    const { page } = app;
    const s = await screenPts(page);
    const onBottom = lerp(s[2], s[3], 0.25);
    await page.mouse.move(onBottom.x, onBottom.y + 3);
    assert.equal(await cursor(page), 'ns-resize');
    assert.deepEqual(await page.evaluate(() => window.__kepler.state.lsEdge), { id: 'ls-edge-e2e', index: 2 });
    assert.equal(await page.evaluate(() => document.getElementById('canvasHint').textContent), 'Линия — тянуть ребро; точки — править вершины');
    const onRight = lerp(s[1], s[2], 0.3);
    await page.mouse.move(onRight.x - 2, onRight.y);
    assert.equal(await cursor(page), 'ew-resize');
    assert.equal((await page.evaluate(() => window.__kepler.state.lsEdge)).index, 1);
    const mid = lerp(s[2], s[3], 0.5);
    await page.mouse.move(mid.x, mid.y);
    assert.equal(await cursor(page), 'copy', 'кружок середины — свой');
    await page.mouse.move(s[0].x, s[0].y);
    assert.equal(await cursor(page), 'move', 'вершина — свой');
    // Внутри площадки, вдали от линии — тело (перенос).
    await page.mouse.move((s[0].x + s[2].x) / 2, (s[0].y + s[2].y) / 2);
    assert.equal(await page.evaluate(() => window.__kepler.state.lsEdge), null);
  });

  it('тянуть нижнее ребро вниз: смежные удлиняются, одна запись истории, Ctrl+Z', async () => {
    const { page } = app;
    const undo0 = await undoLen(page);
    const s = await screenPts(page);
    const from = lerp(s[2], s[3], 0.25);
    await drag(page, from, { x: from.x + 15, y: from.y + 60 });
    const p = await lawn(page);
    assert.deepEqual(p[0], p0[0]);
    assert.deepEqual(p[1], p0[1]);
    const s2 = await screenPts(page);
    for (const i of [2, 3]) {
      const dy = s2[i].y - s[i].y;
      assert.ok(dy > 45 && dy < 75, `вершина ${i} ниже на ~60 px (${dy})`);
    }
    // Боковые — на своих прямых, ребро параллельно прежнему.
    assert.ok(Math.abs(crossDir(p0[1], p0[2], p[1], p[2])) < 0.01, 'правая сторона на своей прямой');
    assert.ok(Math.abs(crossDir(p0[0], p0[3], p[0], p[3])) < 0.01, 'левая сторона на своей прямой');
    assert.ok(Math.abs(crossDir(p0[2], p0[3], p[2], p[3])) < 0.01, 'ребро параллельно');
    assert.equal(await undoLen(page), undo0 + 1, 'одна запись истории');
    await page.keyboard.press('Control+z');
    assert.deepEqual(await lawn(page), p0, 'Ctrl+Z вернул контур');
  });

  it('Esc во время жеста — отмена; схлопнуть нельзя — упор', async () => {
    const { page } = app;
    await page.evaluate(() => window.__kepler.select({ type: 'landscape', ids: ['ls-edge-e2e'] }));
    await settleCanvas(page);
    const undo0 = await undoLen(page);
    let s = await screenPts(page);
    const from = lerp(s[2], s[3], 0.25);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    for (let i = 1; i <= 6; i += 1) await page.mouse.move(from.x, from.y + i * 10);
    assert.notDeepEqual(await lawn(page), p0, 'в жесте контур меняется');
    await page.keyboard.press('Escape');
    await page.mouse.up();
    assert.deepEqual(await lawn(page), p0, 'Esc вернул контур');
    assert.equal(await undoLen(page), undo0, 'истории нет');
    assert.deepEqual(await page.evaluate(() => window.__kepler.state.selection), { type: 'landscape', ids: ['ls-edge-e2e'] }, 'выбор остался');
    // Вверх дальше верхнего ребра — упор.
    s = await screenPts(page);
    await drag(page, lerp(s[2], s[3], 0.25), { x: from.x, y: from.y - 3 * H }, 12);
    const s2 = await screenPts(page);
    assert.ok(s2[2].y > s2[1].y && s2[3].y > s2[0].y, 'нижнее ребро ниже верхнего');
    assert.ok(s2[2].y - s2[1].y < 20, 'упёрлось почти в верхнее');
    await page.keyboard.press('Control+z');
    assert.deepEqual(await lawn(page), p0);
  });

  it('вершина и середина — как раньше; тело переносится целиком', async () => {
    const { page } = app;
    await page.evaluate(() => window.__kepler.select({ type: 'landscape', ids: ['ls-edge-e2e'] }));
    await settleCanvas(page);
    let s = await screenPts(page);
    await drag(page, s[0], { x: s[0].x - 30, y: s[0].y - 20 });
    let p = await lawn(page);
    assert.notDeepEqual(p[0], p0[0], 'вершина сдвинута');
    assert.deepEqual(p.slice(1), p0.slice(1), 'остальные на месте');
    await page.keyboard.press('Control+z');
    await page.evaluate(() => window.__kepler.select({ type: 'landscape', ids: ['ls-edge-e2e'] }));
    await settleCanvas(page);
    s = await screenPts(page);
    const mid = lerp(s[0], s[1], 0.5);
    await drag(page, mid, { x: mid.x, y: mid.y - 30 });
    p = await lawn(page);
    assert.equal(p.length, 5, 'середина ребра — новая вершина');
    await page.keyboard.press('Control+z');
    assert.deepEqual(await lawn(page), p0);
    await page.evaluate(() => window.__kepler.select({ type: 'landscape', ids: ['ls-edge-e2e'] }));
    await settleCanvas(page);
    s = await screenPts(page);
    const c = { x: (s[0].x + s[2].x) / 2, y: (s[0].y + s[2].y) / 2 };
    await drag(page, c, { x: c.x + 40, y: c.y + 25 });
    p = await lawn(page);
    const dx = p[0].x - p0[0].x;
    const dy = p[0].y - p0[0].y;
    assert.ok(Math.hypot(dx, dy) > 100, 'перенесён');
    p.forEach((q, i) => assert.ok(Math.hypot(q.x - p0[i].x - dx, q.y - p0[i].y - dy) < 0.01, `вершина ${i} — тот же сдвиг`));
    assert.deepEqual(app.errors, []);
  });
});
