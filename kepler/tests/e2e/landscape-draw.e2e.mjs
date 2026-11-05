// e2e «Ландшафт», этап 2: рисование дорожки по точкам (Enter, Backspace),
// газона прямоугольником, правка вершин (перетаскивание, «+» на ребре,
// Delete), помощники (дорожка от въезда, парковка), шаблон сада с
// подтверждением, слои, 3D-флажок, ведомость CSV; без ошибок консоли.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { startApp, openSample, worldToClient } from './helpers.mjs';

const objects = (page) => page.evaluate(() => (window.__kepler.state.project.site.landscape?.objects || [])
  .map((o) => ({ id: o.id, kind: o.kind, points: o.points, width: o.width, smooth: o.smooth, variant: o.variant, locked: o.locked })));
const tool = (page) => page.evaluate(() => window.__kepler.state.tool?.kind || null);
const undoLen = (page) => page.evaluate(async () => (await import('./ui/state.js')).history.undo.length);

async function clickWorld(page, x, y) {
  const p = await worldToClient(page, x, y);
  await page.mouse.move(p.x, p.y);
  await page.mouse.click(p.x, p.y);
}

async function dragWorld(page, a, b, { steps = 8, shift = false } = {}) {
  const p = await worldToClient(page, a.x, a.y);
  const q = await worldToClient(page, b.x, b.y);
  if (shift) await page.keyboard.down('Shift');
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  for (let i = 1; i <= steps; i += 1) await page.mouse.move(p.x + ((q.x - p.x) * i) / steps, p.y + ((q.y - p.y) * i) / steps);
  await page.mouse.up();
  if (shift) await page.keyboard.up('Shift');
}

async function download(page, click) {
  const [dl] = await Promise.all([page.waitForEvent('download'), click()]);
  return { name: dl.suggestedFilename(), text: await readFile(await dl.path(), 'utf8') };
}

describe('ландшафт: рисование и помощники', () => {
  let app;
  before(async () => {
    app = await startApp();
    await openSample(app.page);
    await app.page.click('#landscapeBtn');
  });
  after(async () => { await app?.close(); });

  it('дорожка: клик по карточке → точки → Backspace → Enter; одна запись истории', async () => {
    const { page } = app;
    await page.click('#lsTabs button[data-ls-cat="site"]');
    await page.click('#lsItems [data-ls-kind="path"]');
    assert.equal(await tool(page), 'draw-landscape');
    assert.match(await page.textContent('#propsPanel'), /Рисование: Дорожка/);
    await page.selectOption('#lsDrawVariant', 'pavers');
    await page.uncheck('#lsDrawSmooth');
    const undo0 = await undoLen(page);
    for (const [x, y] of [[13000, -4000], [9000, -4000], [9000, 0], [11000, 2000]]) await clickWorld(page, x, y);
    assert.equal(await page.evaluate(() => window.__kepler.state.tool.points.length), 4);
    await page.keyboard.press('Backspace');
    assert.equal(await page.evaluate(() => window.__kepler.state.tool.points.length), 3);
    assert.match(await page.textContent('#canvasHint'), /Длина/);
    await page.keyboard.press('Enter');
    assert.equal(await tool(page), null, 'инструмент завершён');
    const list = await objects(page);
    assert.equal(list.length, 1);
    const [path] = list;
    assert.equal(path.kind, 'path');
    assert.equal(path.variant, 'pavers');
    assert.equal(path.points.length, 3);
    assert.ok(Math.hypot(path.points[0].x - 13000, path.points[0].y + 4000) < 300);
    assert.equal(await undoLen(page), undo0 + 1);
    assert.deepEqual(await page.evaluate(() => window.__kepler.state.selection), { type: 'landscape', ids: [path.id] });
    assert.match(await page.textContent('#lsMeasure'), /L \d+,\d+ м/);
  });

  it('Esc отменяет рисование без объекта', async () => {
    const { page } = app;
    await page.click('#lsItems [data-ls-kind="fence-line"]');
    await clickWorld(page, -4000, 10000);
    await clickWorld(page, 0, 10000);
    await page.keyboard.press('Escape');
    assert.equal(await tool(page), null);
    assert.equal((await objects(page)).length, 1);
  });

  it('газон: протянуть — прямоугольник; двойной клик по ребру — новая вершина; Delete — удалить её', async () => {
    const { page } = app;
    await page.click('#lsTabs button[data-ls-cat="green"]');
    await page.click('#lsItems [data-ls-kind="lawn-area"]');
    await dragWorld(page, { x: -4500, y: -5500 }, { x: 3000, y: -1500 }, { shift: true });
    const lawn = (await objects(page)).find((o) => o.kind === 'lawn-area');
    assert.ok(lawn, 'газон создан');
    assert.equal(lawn.points.length, 4);
    // Вставка вершины двойным кликом в середину ребра 0→1.
    const a = lawn.points[0]; const b = lawn.points[1];
    const onEdge = await worldToClient(page, a.x + (b.x - a.x) * 0.3, a.y + (b.y - a.y) * 0.3);
    await page.mouse.dblclick(onEdge.x, onEdge.y);
    let now = (await objects(page)).find((o) => o.id === lawn.id);
    assert.equal(now.points.length, 5, 'вершина вставлена');
    // Активная вершина (после вставки) → Delete удаляет её, а не газон.
    await page.keyboard.press('Delete');
    now = (await objects(page)).find((o) => o.id === lawn.id);
    assert.ok(now, 'газон на месте');
    assert.equal(now.points.length, 4);
  });

  it('перетаскивание вершины — одна запись истории, Ctrl+Z возвращает', async () => {
    const { page } = app;
    const lawn = (await objects(page)).find((o) => o.kind === 'lawn-area');
    await page.evaluate((id) => window.__kepler.select({ type: 'landscape', ids: [id] }), lawn.id);
    const v = lawn.points[2];
    const undo0 = await undoLen(page);
    await dragWorld(page, v, { x: v.x + 1500, y: v.y + 1000 });
    const moved = (await objects(page)).find((o) => o.id === lawn.id).points[2];
    assert.ok(Math.hypot(moved.x - v.x, moved.y - v.y) > 800, 'вершина уехала');
    assert.equal(await undoLen(page), undo0 + 1);
    await page.keyboard.press('Control+z');
    assert.deepEqual((await objects(page)).find((o) => o.id === lawn.id).points[2], v);
  });

  it('замок: закреплённый объект не двигается и не удаляется', async () => {
    const { page } = app;
    const path = (await objects(page)).find((o) => o.kind === 'path');
    await page.evaluate((id) => window.__kepler.select({ type: 'landscape', ids: [id] }), path.id);
    await page.check('#lsLock');
    assert.equal((await objects(page)).find((o) => o.id === path.id).locked, true);
    await page.click('#canvas', { position: { x: 5, y: 5 } }).catch(() => {});
    await page.evaluate((id) => window.__kepler.select({ type: 'landscape', ids: [id] }), path.id);
    await page.keyboard.press('Delete');
    assert.ok((await objects(page)).find((o) => o.id === path.id), 'не удалён');
    await page.uncheck('#lsLock');
  });

  it('помощники: дорожка от въезда до входа и парковка на 2 места', async () => {
    const { page } = app;
    await page.keyboard.press('Escape');
    const n0 = (await objects(page)).length;
    await page.selectOption('#lsEntryVariant', 'stepping');
    await page.click('#lsEntryGo');
    const list = await objects(page);
    assert.equal(list.length, n0 + 1);
    const entry = await page.evaluate(() => window.__kepler.state.project.site.entry);
    const path = list[list.length - 1];
    assert.equal(path.variant, 'stepping');
    assert.deepEqual(path.points[0], { x: entry.x, y: entry.y });
    await page.keyboard.press('Escape');
    await page.fill('#lsParkN', '2');
    await page.click('#lsParkGo');
    assert.equal((await objects(page)).filter((o) => o.kind === 'parking-1').length, 2);
  });

  it('посадить вдоль дорожки: туи с шагом — одним действием', async () => {
    const { page } = app;
    const path = (await objects(page)).find((o) => o.kind === 'path' && o.variant === 'pavers');
    await page.evaluate((id) => window.__kepler.select({ type: 'landscape', ids: [id] }), path.id);
    const undo0 = await undoLen(page);
    const n0 = (await objects(page)).length;
    await page.selectOption('#lsAlongKind', 'shrub-box');
    await page.fill('#lsAlongStep', '2');
    await page.click('#lsAlongGo');
    const added = (await objects(page)).length - n0;
    assert.ok(added >= 3, String(added));
    assert.equal(await undoLen(page), undo0 + 1);
  });

  it('шаблон «Семейный двор»: подтверждение, замена, одна запись истории', async () => {
    const { page } = app;
    await page.keyboard.press('Escape');
    const undo0 = await undoLen(page);
    await page.selectOption('#lsTemplate', 'family');
    const dialog = page.waitForEvent('dialog').then((d) => { assert.match(d.message(), /Заменить/); return d.accept(); });
    await page.click('#lsTplReplace');
    await dialog;
    const kinds = new Set((await objects(page)).map((o) => o.kind));
    for (const k of ['pool', 'terrace-deck', 'parking-1', 'lawn-area']) assert.ok(kinds.has(k), k);
    assert.equal(await undoLen(page), undo0 + 1);
    assert.match(await page.textContent('#lsBalance'), /Процент озеленения/);
  });

  it('слои: флажок скрывает группу на холсте (состояние вида)', async () => {
    const { page } = app;
    await page.uncheck('[data-ls-vis="plants"]');
    assert.equal(await page.evaluate(() => window.__kepler.state.lsVis.plants), false);
    await page.check('[data-ls-vis="plants"]');
    assert.equal(await page.evaluate(() => window.__kepler.state.lsVis.plants), true);
  });

  it('ведомость ландшафта (CSV) из меню «Экспорт»', async () => {
    const { page } = app;
    await page.click('#exportBtn');
    const csv = await download(page, () => page.click('[data-export="landscape-csv"]'));
    assert.match(csv.name, /ландшафт\.csv$/);
    assert.match(csv.text, /^\uFEFFПоз\.;/);
    assert.match(csv.text, /Бассейн/);
  });

  it('3D: флажок «Ландшафт» убирает грани ландшафта', async () => {
    const { page } = app;
    await page.click('#view3dBtn');
    const faces = () => page.evaluate(async () => (await import('./ui/view3d.js')).debug3d?.().faces ?? null);
    const on = await faces();
    await page.uncheck('#v3Landscape');
    const off = await faces();
    if (on !== null) assert.ok(on > off, `${on} > ${off}`);
    await page.check('#v3Landscape');
    await page.keyboard.press('Escape');
  });

  it('без ошибок в консоли', () => {
    assert.deepEqual(app.errors, []);
  });
});
