// e2e 3D, срез 1: мебель в 3D, выбор мышью помещения, проёма и мебели
// (общий с планом, «Свойства»), клавиши Delete / Ctrl+C/V/D / R / Esc и
// переключатель «Этажи» с кнопками этажей поверх 3D.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { with3dLayers, pickWorkspaceView, startApp, openSample } from './helpers.mjs';

const d3 = (page) => page.evaluate(() => window.__kepler.debug3d());
const sel = (page) => page.evaluate(() => window.__kepler.state.selection);

// Сетка точек холста 3D → середина попаданий каждого вида (item — мебель
// без лестниц, door — дверь, opening — любой проём, room, wall).
const scan = (page) => page.evaluate(() => {
  const { state, pick3d } = window.__kepler;
  const box = document.getElementById('canvas3d').getBoundingClientRect();
  const found = {};
  for (let y = box.top + 70; y < box.bottom - 70; y += 12) {
    for (let x = box.left + 20; x < box.right - 20; x += 12) {
      const hit = pick3d(x, y);
      if (!hit) continue;
      const keys = [hit.type];
      if (hit.type === 'item' && state.project.items.find((i) => i.id === hit.id)?.kind === 'stairs') keys[0] = 'stairs';
      if (hit.type === 'opening' && state.project.openings.find((o) => o.id === hit.id)?.kind === 'door') keys.push('door');
      for (const k of keys) (found[k] ||= []).push({ x, y, ...hit });
    }
  }
  // Середина списка — точка внутри объекта, а не на кромке.
  return Object.fromEntries(Object.entries(found).map(([k, v]) => [k, v[Math.floor(v.length / 2)]]));
});

describe('3D: мебель и выбор объектов', () => {
  let app;
  let hits;
  before(async () => {
    app = await startApp();
    await openSample(app.page);
    await app.page.evaluate(async () => {
      const { createLandscapeObject } = await import('./core/landscape.js');
      const { toWorld } = await import('./core/building.js');
      const s = window.__kepler.state;
      const p = toWorld(s.project.building, { x: -1800, y: 2500 });
      s.project.site.landscape = { objects: [createLandscapeObject('tree-thuja', p.x, p.y)] };
    });
    await app.page.click('#view3dBtn');
    hits = await scan(app.page);
  });
  after(async () => { await app?.close(); });

  it('мебель в сетке 3D по умолчанию, флажок «Мебель» её скрывает', async () => {
    const { page } = app;
    assert.equal(await page.isChecked('#v3Furniture'), true);
    const s = await d3(page);
    assert.ok(s.furniture > 20, `граней мебели ${s.furniture}`);
    await with3dLayers(page, () => page.uncheck('#v3Furniture'));
    assert.equal((await d3(page)).furniture, 0);
    await with3dLayers(page, () => page.check('#v3Furniture'));
    assert.equal((await d3(page)).furniture, s.furniture);
    hits = await scan(page);
    assert.ok(hits.item && hits.room && hits.door, `найдены: ${Object.keys(hits)}`);
    assert.ok(hits.landscape, `ландшафт найден: ${Object.keys(hits)}`);
  });

  it('наведение на объект — курсор-указатель', async () => {
    const { page } = app;
    await page.mouse.move(hits.item.x, hits.item.y);
    assert.equal(await page.$eval('#canvas3d', (c) => c.style.cursor), 'pointer');
  });

  it('в перспективе объекты остаются выбираемыми', async () => {
    const { page } = app;
    await page.getByRole('button', { name: 'Перспектива' }).click();
    const perspectiveHits = await scan(page);
    assert.ok(perspectiveHits.item && perspectiveHits.landscape, `найдены: ${Object.keys(perspectiveHits)}`);
    await page.mouse.click(perspectiveHits.item.x, perspectiveHits.item.y);
    assert.equal((await sel(page))?.type, 'item');
    await page.getByRole('button', { name: 'Параллельно' }).click();
    hits = await scan(page);
  });

  it('клик по мебели выбирает предмет: выбор плана, «Свойства», подсветка', async () => {
    const { page } = app;
    await page.mouse.click(hits.item.x, hits.item.y);
    const s = await sel(page);
    assert.equal(s?.type, 'item');
    assert.equal(s.id, hits.item.id);
    const title = await page.evaluate(async (id) => {
      const { FURNITURE } = await import('./core/catalog.js');
      return FURNITURE[window.__kepler.state.project.items.find((i) => i.id === id).kind].title;
    }, s.id);
    assert.match(await page.textContent('#propsBody'), new RegExp(title));
    assert.ok((await d3(page)).highlightedAll > 0, 'предмет подсвечен');
    assert.match(await page.textContent('#v3Hint'), /Delete/);
  });

  it('клик по полу — помещение, по двери — проём', async () => {
    const { page } = app;
    await page.mouse.click(hits.room.x, hits.room.y);
    const s = await sel(page);
    assert.equal(s?.type, 'room');
    assert.equal(s.id, hits.room.id);
    const name = await page.evaluate((id) => window.__kepler.state.project.rooms.find((r) => r.id === id).name, s.id);
    assert.match(await page.textContent('#propsBody'), new RegExp(name));
    await page.mouse.click(hits.door.x, hits.door.y);
    const o = await sel(page);
    assert.equal(o?.type, 'opening');
    assert.equal(o.id, hits.door.id);
    assert.ok((await d3(page)).highlightedAll > 0, 'проём подсвечен');
  });

  it('Delete удаляет мебель, Ctrl+Z возвращает', async () => {
    const { page } = app;
    const count = () => page.evaluate(() => window.__kepler.state.project.items.length);
    const n = await count();
    await page.mouse.click(hits.item.x, hits.item.y);
    assert.equal((await sel(page))?.id, hits.item.id);
    await page.keyboard.press('Delete');
    assert.equal(await count(), n - 1);
    assert.equal(await page.isVisible('#view3d'), true, '3D остаётся открытым');
    await page.keyboard.press('Control+z');
    assert.equal(await count(), n);
    assert.ok(await page.evaluate((id) => window.__kepler.state.project.items.some((i) => i.id === id), hits.item.id));
  });

  it('дерево выбирается, показывает свойства и удаляется прямо в 3D', async () => {
    const { page } = app;
    const count = () => page.evaluate(() => window.__kepler.state.project.site.landscape.objects.length);
    await page.mouse.click(hits.landscape.x, hits.landscape.y);
    assert.deepEqual(await sel(page), { type: 'landscape', ids: [hits.landscape.id] });
    assert.match(await page.textContent('#propsBody'), /Туя|Ландшафт/i);
    assert.ok((await d3(page)).highlightedAll > 0, 'дерево подсвечено');
    const n = await count();
    await page.keyboard.press('Delete');
    assert.equal(await count(), n - 1);
    await page.keyboard.press('Control+z');
    assert.equal(await count(), n);
    hits = await scan(page);
  });

  it('каталог добавляет мебель прямо на пол в 3D', async () => {
    const { page } = app;
    const count = () => page.evaluate(() => window.__kepler.state.project.items.length);
    const n = await count();
    await page.click('#furnitureToolBtn');
    await page.waitForSelector('#furnitureItems .furniture-chip', { state: 'visible' });
    await page.locator('#furnitureItems .furniture-chip').first().click();
    assert.equal(await page.evaluate(() => window.__kepler.state.tool?.kind), 'place-furniture');
    await page.mouse.click(hits.room.x, hits.room.y);
    assert.equal(await count(), n + 1);
    assert.equal((await sel(page))?.type, 'item');
    assert.equal(await page.isVisible('#view3d'), true);
    await page.keyboard.press('Escape'); // закончить постановку
    await page.keyboard.press('Control+z');
    assert.equal(await count(), n);
    hits = await scan(page);
  });

  it('Ctrl+C / Ctrl+V и Ctrl+D дублируют, R поворачивает предмет', async () => {
    const { page } = app;
    const items = () => page.evaluate(() => window.__kepler.state.project.items.map((i) => ({ id: i.id, x: i.x, y: i.y, rotation: i.rotation || 0 })));
    const before0 = await items();
    await page.mouse.click(hits.item.x, hits.item.y);
    await page.keyboard.press('Control+c');
    await page.keyboard.press('Control+v');
    const pasted = await items();
    assert.equal(pasted.length, before0.length + 1);
    const copy = pasted.find((i) => !before0.some((b) => b.id === i.id));
    const src = before0.find((i) => i.id === hits.item.id);
    assert.ok(copy && (copy.x !== src.x || copy.y !== src.y), 'вставка со смещением');
    assert.equal((await sel(page))?.id, copy.id, 'выбрана копия');
    await page.keyboard.press('Control+d');
    assert.equal((await items()).length, before0.length + 2);
    const selId = (await sel(page)).id;
    const rot0 = (await items()).find((i) => i.id === selId).rotation;
    await page.keyboard.press('r');
    const rot1 = (await items()).find((i) => i.id === selId).rotation;
    assert.equal(((rot1 - rot0) % 360 + 360) % 360, 90);
    for (let k = 0; k < 3; k += 1) await page.keyboard.press('Control+z');
    assert.equal((await items()).length, before0.length);
  });

  it('Esc сначала снимает выбор, второй Esc закрывает 3D', async () => {
    const { page } = app;
    hits = await scan(page);
    await page.mouse.click(hits.item.x, hits.item.y);
    assert.ok(await sel(page));
    await page.keyboard.press('Escape');
    assert.equal(await sel(page), null);
    assert.equal(await page.isVisible('#view3d'), true);
    await page.keyboard.press('Escape');
    assert.equal(await page.isVisible('#view3d'), false);
  });

  it('без ошибок в консоли', () => {
    assert.deepEqual(app.errors, []);
  });
});

describe('3D: этажи', () => {
  let app;
  let l1;
  let l2;
  before(async () => {
    app = await startApp();
    await openSample(app.page);
    // Второй этаж — копия первого (комнаты, проёмы, мебель).
    [l1, l2] = await app.page.evaluate(async () => {
      const lv = await import('./ui/levels.js');
      const st = await import('./ui/store.js');
      const s = window.__kepler.state;
      const first = s.project.levels[0];
      lv.addLevel();
      const second = s.project.levels.find((l) => l.id !== first.id);
      const nid = (id) => (id ? `${id}-u` : id);
      second.rooms = first.rooms.map((r) => ({ ...structuredClone(r), id: nid(r.id), parentId: nid(r.parentId) }));
      second.items = first.items.filter((i) => i.kind !== 'stairs').map((i) => ({ ...structuredClone(i), id: nid(i.id) }));
      second.openings = first.openings.filter((o) => o.roomId).map((o) => ({ ...structuredClone(o), id: nid(o.id), roomId: nid(o.roomId) }));
      st.refreshDerived();
      st.afterChange();
      return [first.id, second.id];
    });
    await app.page.click('#view3dBtn');
  });
  after(async () => { await app?.close(); });

  it('«Все этажи» показывает полную модель без селектора рабочего этажа', async () => {
    const { page } = app;
    assert.equal(await page.inputValue('#v3Levels'), 'all');
    assert.deepEqual((await d3(page)).levelsShown.sort(), [l1, l2].sort());
    assert.equal(await page.locator('#v3WorkingLevel').count(), 0);
    assert.equal(await page.getByRole('button', { name: 'Параллельно' }).getAttribute('aria-pressed'), 'true');
  });

  it('слой этажей фильтрует модель, не превращая 3D в план этажа', async () => {
    const { page } = app;
    const camera = (await d3(page)).cam;
    await page.evaluate(async (id) => (await import('./ui/levels.js')).switchLevel(id, { planView: false }), l1);
    assert.deepEqual((await d3(page)).cam, camera);
    assert.equal(await page.evaluate(() => window.__kepler.state.project.activeLevel), l1);
    await with3dLayers(page, () => page.selectOption('#v3Levels', 'upto'));
    let s = await d3(page);
    assert.deepEqual(s.levelsShown, [l1]);
    assert.equal(s.roof, false);
    // Пол под курсором — только первого этажа.
    const hits = await scan(page);
    assert.equal(hits.room?.levelId, l1);
    await page.evaluate(async (id) => (await import('./ui/levels.js')).switchLevel(id, { planView: false }), l2);
    s = await d3(page);
    assert.deepEqual(s.levelsShown.sort(), [l1, l2].sort());
    await with3dLayers(page, () => page.selectOption('#v3Levels', 'only'));
    assert.deepEqual((await d3(page)).levelsShown, [l2]);
  });

  it('режим этажей запоминается', async () => {
    const { page } = app;
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('kepler-3d-layers')));
    assert.equal(saved.levels, 'only');
    assert.equal(saved.furniture, true);
    await with3dLayers(page, () => page.selectOption('#v3Levels', 'all'));
  });

  it('3D открывается как отдельный вид и возвращает в исходный раздел', async () => {
    const { page } = app;
    const camera = (await d3(page)).cam;
    await page.click('#modePlanBtn');
    assert.equal(await page.isHidden('#view3d'), true);
    assert.equal(await page.evaluate(() => window.__kepler.state.project.activeLevel), l1);
    await pickWorkspaceView(page, 'facades', 'elev-N');
    assert.equal(await page.isVisible('#elevView'), true);
    assert.equal(await page.isHidden('#toolStrip'), true);
    await pickWorkspaceView(page, 'sheets', `sheet:level:${l1}`);
    assert.equal(await page.isHidden('#elevView'), true);
    assert.equal(await page.isVisible('#sheetView'), true);
    assert.equal(await page.isHidden('#toolStrip'), true);
    await page.click('#view3dBtn');
    assert.equal(await page.isHidden('#sheetView'), true);
    assert.deepEqual((await d3(page)).cam, camera);
    await page.click('#modeSiteBtn');
    assert.equal(await page.isHidden('#view3d'), true);
    await page.click('#view3dBtn');
    assert.equal(await page.isVisible('#planTools'), true);
    for (const id of ['massGroupBtn', 'openingsGroupBtn', 'roofToolBtn', 'selectToolBtn', 'furnitureToolBtn', 'stairsToolBtn']) {
      assert.equal(await page.isVisible('#' + id), true, id);
    }
    for (const id of ['wallToolBtn', 'boundRoomBtn', 'slabOpeningToolBtn', 'docsGroupBtn', 'fitBtn']) assert.equal(await page.isHidden('#' + id), true, id);

    await page.click('#v3Close');
    assert.equal(await page.evaluate(() => window.__kepler.state.modeName), 'site');
    assert.equal(await page.getAttribute('#modeSiteBtn', 'aria-selected'), 'true');
  });

  it('планы этажей помнят отдельные масштабы и положения', async () => {
    const { page } = app;
    const camera = () => page.evaluate(() => {
      const { scale, panX, panY } = window.__kepler.state.view;
      return { scale, panX, panY };
    });
    await page.click('#modePlanBtn');
    const first = await camera();
    await pickWorkspaceView(page, 'plans', `plan:${l2}`);
    const canvas = page.locator('#canvas');
    await canvas.hover();
    const initial = await camera();
    await page.mouse.wheel(0, -150);
    await page.waitForFunction((s) => window.__kepler.state.view.scale !== s, initial.scale);
    const second = await camera();
    await page.click('#modePlanBtn');
    assert.deepEqual(await camera(), first);
    await page.click(`.wv-tabs [data-workspace-view="plan:${l2}"]`);
    assert.deepEqual(await camera(), second);
  });

  it('без ошибок в консоли', () => {
    assert.deepEqual(app.errors, []);
  });
});
