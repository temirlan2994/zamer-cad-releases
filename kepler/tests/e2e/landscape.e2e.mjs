// e2e «Ландшафт»: кнопка слева от этажей, вход в режим, каталог, постановка
// дерева и парковки, перемещение, отмена, возврат в «План», сохранение и
// открытие JSON, без ошибок консоли.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { startApp, openSample, dropOnCanvas, uploadText, worldToClient } from './helpers.mjs';

const MIME = 'application/x-kepler-landscape';
// Точки внутри участка примера (граница −5…16 × −6…12 м), в стороне от дома.
const TREE_AT = { x: 13000, y: -3000 };
const PARK_AT = { x: 13000, y: 9200 };

const objects = (page) => page.evaluate(() => (window.__kepler.state.project.site.landscape?.objects || [])
  .map((o) => ({ id: o.id, kind: o.kind, x: o.x, y: o.y, w: o.w, h: o.h, rotation: o.rotation, variant: o.variant })));
const mode = (page) => page.evaluate(() => window.__kepler.state.modeName);

async function download(page, click) {
  const [dl] = await Promise.all([page.waitForEvent('download'), click()]);
  return { name: dl.suggestedFilename(), text: await readFile(await dl.path(), 'utf8') };
}

describe('ландшафт', () => {
  let app;
  before(async () => { app = await startApp(); await openSample(app.page); });
  after(async () => { await app?.close(); });

  it('«Ландшафт» доступен среди открытых видов и в каталоге видов', async () => {
    const chip = app.page.getByRole('tab', { name: 'Ландшафт', exact: true }).first();
    assert.ok(await chip.isVisible());
    assert.equal(await app.page.locator('#workspaceViewPicker option[value="landscape"]').textContent(), 'Ландшафт');
    // Список этажей не изменился (кнопка — вне #levelBar).
    const bar = await app.page.$$eval('#levelBar button', (els) => els.map((e) => e.textContent));
    assert.deepEqual(bar, ['1 этаж', '+']);
  });

  it('клик переводит в режим «Ландшафт»: вид участка и свой каталог', async () => {
    await app.page.click('#landscapeBtn');
    assert.equal(await mode(app.page), 'landscape');
    assert.equal(await app.page.getAttribute('#landscapeBtn', 'aria-selected'), 'true');
    assert.equal(await app.page.isVisible('#landscapeBar'), true);
    assert.equal(await app.page.isVisible('#libraryTabs'), false);
    assert.equal(await app.page.$$eval('#levelBar button.active', (els) => els.length), 0, 'этаж не подсвечен');
    // Камера — как у «Участка»: север вверх.
    const rot = await app.page.evaluate(() => {
      const s = window.__kepler.state;
      return { view: s.view.rotation, north: s.project.site.north || 0 };
    });
    assert.ok(Math.abs(rot.view + (rot.north * Math.PI) / 180) < 1e-9);
    const tabs = await app.page.$$eval('#lsTabs button', (els) => els.map((e) => e.textContent));
    assert.deepEqual(tabs, ['Озеленение', 'Ландшафт и площадки']);
    assert.ok(await app.page.$('#lsItems [data-ls-kind="tree-pine"]'));
    await app.page.click('#lsTabs button[data-ls-cat="site"]');
    assert.ok(await app.page.$('#lsItems [data-ls-kind="parking-2"]'));
    await app.page.fill('#lsSearch', 'сосн');
    assert.ok(await app.page.$('#lsItems [data-ls-kind="tree-pine"]'), 'поиск по всему каталогу');
    await app.page.fill('#lsSearch', '');
    await app.page.click('#lsTabs button[data-ls-cat="green"]');
  });

  it('дерево: клик по карточке → призрак → клики ставят, Esc — выход', async () => {
    await app.page.click('#lsItems [data-ls-kind="tree-pine"]');
    assert.equal(await app.page.evaluate(() => window.__kepler.state.tool?.kind), 'place-landscape');
    const p = await worldToClient(app.page, TREE_AT.x, TREE_AT.y);
    await app.page.mouse.move(p.x, p.y);
    assert.equal(await app.page.evaluate(() => window.__kepler.state.ghostLandscape?.kind), 'tree-pine');
    await app.page.mouse.click(p.x, p.y);
    const list = await objects(app.page);
    assert.equal(list.length, 1);
    assert.equal(list[0].kind, 'tree-pine');
    assert.ok(Math.hypot(list[0].x - TREE_AT.x, list[0].y - TREE_AT.y) < 300, 'там, где кликнули');
    assert.equal(await app.page.evaluate(() => window.__kepler.state.tool?.kind), 'place-landscape', 'инструмент остаётся');
    await app.page.keyboard.press('Escape');
    assert.equal(await app.page.evaluate(() => window.__kepler.state.tool), null);
    assert.equal(await app.page.evaluate(() => window.__kepler.state.ghostLandscape), null);
  });

  it('парковка: перетаскивание карточки на холст', async () => {
    const at = await app.page.evaluate(([x, y]) => window.__kepler.worldToScreen(x, y), [PARK_AT.x, PARK_AT.y]);
    await dropOnCanvas(app.page, MIME, 'parking-2', at);
    const list = await objects(app.page);
    assert.equal(list.length, 2);
    const park = list.find((o) => o.kind === 'parking-2');
    assert.ok(park, 'парковка на 2 машины');
    assert.deepEqual([park.w, park.h], [5200, 5300]);
    // Выбрана — панель свойств показывает её.
    assert.match(await app.page.textContent('#propsPanel'), /Парковка на 2 машины/);
  });

  it('перемещение мышью — одна запись истории; Ctrl+Z возвращает', async () => {
    const [tree] = (await objects(app.page)).filter((o) => o.kind === 'tree-pine');
    const undoBefore = await app.page.evaluate(async () => (await import('./ui/state.js')).history.undo.length);
    const p = await worldToClient(app.page, tree.x, tree.y);
    await app.page.mouse.move(p.x, p.y);
    await app.page.mouse.down();
    for (let i = 1; i <= 6; i += 1) await app.page.mouse.move(p.x + i * 10, p.y + i * 5);
    await app.page.mouse.up();
    const moved = (await objects(app.page)).find((o) => o.id === tree.id);
    const scale = await app.page.evaluate(() => window.__kepler.state.view.scale);
    assert.ok(Math.hypot(moved.x - tree.x, moved.y - tree.y) > 30 / scale, 'дерево уехало');
    const undoAfter = await app.page.evaluate(async () => (await import('./ui/state.js')).history.undo.length);
    assert.equal(undoAfter, undoBefore + 1, 'одна запись на жест');
    assert.deepEqual(await app.page.evaluate(() => window.__kepler.state.selection), { type: 'landscape', ids: [tree.id] });
    await app.page.keyboard.press('Control+z');
    const back = (await objects(app.page)).find((o) => o.id === tree.id);
    assert.deepEqual([back.x, back.y], [tree.x, tree.y]);
  });

  it('клавиши: R, копия Ctrl+D, Delete; Ctrl+Z', async () => {
    const [tree] = (await objects(app.page)).filter((o) => o.kind === 'tree-pine');
    await app.page.evaluate((id) => window.__kepler.select({ type: 'landscape', ids: [id] }), tree.id);
    await app.page.keyboard.press('KeyR');
    assert.equal((await objects(app.page)).find((o) => o.id === tree.id).rotation, 90);
    await app.page.keyboard.press('Control+d');
    assert.equal((await objects(app.page)).length, 3);
    await app.page.keyboard.press('Delete');
    assert.equal((await objects(app.page)).length, 2);
    await app.page.keyboard.press('Control+z');
    assert.equal((await objects(app.page)).length, 3);
    await app.page.keyboard.press('Control+z'); // отмена копии
    await app.page.keyboard.press('Control+z'); // отмена поворота
    const list = await objects(app.page);
    assert.equal(list.length, 2);
    assert.equal(list.find((o) => o.id === tree.id).rotation, 0);
  });

  it('клик по этажу возвращает в «План»', async () => {
    await app.page.click('#levelBar button[data-level]');
    assert.equal(await mode(app.page), 'plan');
    assert.equal(await app.page.isVisible('#landscapeBar'), false);
    assert.equal(await app.page.isVisible('.library'), false, 'в «Плане» без инструмента библиотеки нет');
    assert.equal(await app.page.getAttribute('#landscapeBtn', 'aria-selected'), 'false');
    assert.equal(await app.page.$$eval('#levelBar button.active', (els) => els.length), 1);
    // Верхний переключатель «План / Участок» работает как раньше.
    await app.page.click('#modeSiteBtn');
    assert.equal(await mode(app.page), 'site');
    await app.page.click('#modePlanBtn');
    assert.equal(await mode(app.page), 'plan');
  });

  it('сохранение в JSON и открытие: ландшафт на месте', async () => {
    const before = await objects(app.page);
    assert.equal(before.length, 2);
    const file = await download(app.page, () => app.page.click('#saveBtn'));
    const saved = JSON.parse(file.text);
    assert.equal(saved.site.landscape.objects.length, 2);
    await app.page.evaluate(() => window.__kepler.newProject());
    assert.deepEqual(await objects(app.page), []);
    await uploadText(app.page, '#fileInput', file.name, file.text);
    await app.page.waitForFunction(() => /Открыт проект/.test(document.getElementById('toast').textContent));
    assert.deepEqual(await objects(app.page), before);
    // Структурированный JSON (kepler-export/2) — тоже с ландшафтом.
    await app.page.click('#exportBtn');
    const json = await download(app.page, () => app.page.click('[data-export="json"]'));
    const data = JSON.parse(json.text);
    assert.equal(data.schema, 'kepler-export/2');
    assert.deepEqual(data.site.landscape.objects.map((o) => o.kind).sort(), ['parking-2', 'tree-pine']);
  });

  it('без ошибок в консоли', () => {
    assert.deepEqual(app.errors, []);
  });
});
