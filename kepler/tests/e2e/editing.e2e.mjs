// e2e правки через интерфейс: клавиатура, панель свойств, проёмы, файлы,
// экспорт, рисование участка, тема, колесо. Проходит по всем модулям ui/*.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { startApp, openNew, dropOnCanvas, clickWorld, uploadText } from './helpers.mjs';

const proj = (page) => page.evaluate(() => {
  const p = window.__kepler.state.project;
  return {
    rooms: p.rooms.map((r) => ({ id: r.id, x: r.x, y: r.y, w: r.w, h: r.h, name: r.name })),
    openings: p.openings.length,
    sel: window.__kepler.state.selection,
  };
});

// Скачивание через меню: возвращает имя и текст файла.
async function download(page, click) {
  const [dl] = await Promise.all([page.waitForEvent('download'), click()]);
  return { name: dl.suggestedFilename(), text: await readFile(await dl.path(), 'utf8') };
}

describe('правка через интерфейс', () => {
  let app;
  before(async () => {
    app = await startApp();
    await openNew(app.page);
    await dropOnCanvas(app.page, 'application/x-kepler-room', 'living');
  });
  after(async () => { await app?.close(); });

  it('панель свойств: ширина и название комнаты', async () => {
    await app.page.fill('#roomW', '4500');
    await app.page.locator('#roomW').blur();
    await app.page.fill('#roomName', 'Зал');
    await app.page.locator('#roomName').blur();
    const r = (await proj(app.page)).rooms[0];
    assert.equal(r.w, 4500);
    assert.equal(r.name, 'Зал');
  });

  it('«Дверь» в контекстной панели и клик по стене добавляют дверь', async () => {
    const r = (await proj(app.page)).rooms[0];
    await app.page.click('[data-selection-action="add-door"]');
    await clickWorld(app.page, r.x + r.w / 2, r.y - 60);
    assert.equal((await proj(app.page)).openings, 1);
  });

  it('клавиатура: Delete удаляет, Ctrl+Z возвращает, Esc снимает выделение', async () => {
    const id = (await proj(app.page)).rooms[0].id;
    await app.page.evaluate((rid) => window.__kepler.selectRoom(rid), id);
    await app.page.keyboard.press('Delete');
    assert.equal((await proj(app.page)).rooms.length, 0);
    await app.page.keyboard.press('Control+z');
    assert.equal((await proj(app.page)).rooms.length, 1);
    await app.page.evaluate((rid) => window.__kepler.selectRoom(rid), id);
    await app.page.keyboard.press('Escape');
    assert.equal((await proj(app.page)).sel, null);
  });

  it('колесо мыши меняет масштаб', async () => {
    const box = await (await app.page.$('#canvas')).boundingBox();
    const before = await app.page.evaluate(() => window.__kepler.state.view.scale);
    await app.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await app.page.mouse.wheel(0, -400);
    await app.page.waitForFunction((s) => window.__kepler.state.view.scale > s, before);
  });

  it('сохранение в файл и открытие того же файла', async () => {
    const before = await proj(app.page);
    const file = await download(app.page, () => app.page.click('#saveBtn'));
    assert.match(file.name, /\.kepler\.json$/);
    // Файл — формат 7 (ядро v7, docs/v7-stage2-plan.md), в памяти — модель приложения.
    assert.equal(JSON.parse(file.text).schema, 'kepler-plan/7');
    await uploadText(app.page, '#fileInput', file.name, file.text);
    await app.page.waitForFunction(() => /Открыт проект/.test(document.getElementById('toast').textContent));
    const after = await proj(app.page);
    assert.deepEqual(after.rooms, before.rooms);
    assert.equal(after.openings, before.openings);
  });

  it('экспорт: структурированный JSON и DXF', async () => {
    await app.page.click('#exportBtn');
    const json = await download(app.page, () => app.page.click('[data-export="json"]'));
    const data = JSON.parse(json.text);
    assert.equal(data.schema, 'kepler-export/2');
    assert.equal(data.levels[0].rooms.length, 1);
    await app.page.click('#exportBtn');
    const dxf = await download(app.page, () => app.page.click('[data-export="dxf"]'));
    assert.ok(dxf.text.includes('ENTITIES') && dxf.text.trim().endsWith('EOF'));
  });

  it('участок: граница по 4 точкам + Enter, север по 2 точкам', async () => {
    await app.page.click('#modeSiteBtn');
    const pts = await app.page.evaluate(() => {
      const c = document.getElementById('canvas');
      const w = c.clientWidth;
      const h = c.clientHeight;
      return [[0.3, 0.3], [0.7, 0.3], [0.7, 0.7], [0.3, 0.7]]
        .map(([fx, fy]) => window.__kepler.screenToWorld(w * fx, h * fy));
    });
    await app.page.click('#siteTools button:nth-child(2)'); // «Граница участка»
    for (const p of pts) await clickWorld(app.page, p.x, p.y);
    await app.page.keyboard.press('Enter');
    const boundary = await app.page.evaluate(() => window.__kepler.state.project.site.boundary);
    assert.equal(boundary?.length, 4);

    await app.page.click('#siteTools button:nth-child(8)'); // «Север по 2 точкам»
    await clickWorld(app.page, pts[0].x, pts[0].y);
    await clickWorld(app.page, pts[1].x, pts[1].y); // стрелка вправо по экрану
    const north = await app.page.evaluate(() => window.__kepler.state.project.site.north);
    assert.ok(Math.abs(north - 90) < 1, `север ${north}°`);
    await app.page.click('#modePlanBtn');
  });

  it('тема переключается по кругу', async () => {
    const theme = () => app.page.evaluate(() => document.documentElement.dataset.theme || 'system');
    const seen = [];
    for (let i = 0; i < 3; i += 1) { await app.page.click('#themeBtn'); seen.push(await theme()); }
    assert.deepEqual(seen, ['light', 'dark', 'system']);
  });

  it('стартовое меню открывается и закрывается', async () => {
    await app.page.click('#menuBtn');
    assert.equal(await app.page.$eval('#startScreen', (n) => n.hidden), false);
    await app.page.click('#startContinue');
    assert.equal(await app.page.$eval('#startScreen', (n) => n.hidden), true);
  });

  it('без ошибок в консоли', () => {
    assert.deepEqual(app.errors, []);
  });
});

describe('типы проёмов и высота потолка', () => {
  let app;
  before(async () => {
    app = await startApp({ issueGroups: 'all' });
    await openNew(app.page);
    await dropOnCanvas(app.page, 'application/x-kepler-room', 'living');
  });
  after(async () => { await app?.close(); });

  const opening = (page, kind) => page.evaluate((k) => {
    const o = window.__kepler.state.project.openings.find((x) => x.kind === k);
    return o && { id: o.id, type: o.type, width: o.width, sill: o.sill, height: o.height };
  }, kind);

  it('дверь → двустворчатая (ширина не меньше 1200), окно → панорамное', async () => {
    const r = (await proj(app.page)).rooms[0];
    await app.page.click('[data-selection-action="add-door"]');
    await clickWorld(app.page, r.x + r.w / 2, r.y - 60);
    await app.page.keyboard.press('Escape'); // инструмент остаётся активным для серии — выходим
    const d = await opening(app.page, 'door');
    await app.page.evaluate((id) => window.__kepler.select({ type: 'opening', id }), d.id);
    await app.page.selectOption('#openType', 'double');
    const d2 = await opening(app.page, 'door');
    assert.equal(d2.type, 'double');
    assert.ok(d2.width >= 1200);

    await app.page.evaluate((id) => window.__kepler.selectRoom(id), r.id);
    await app.page.click('[data-selection-action="add-window"]');
    await clickWorld(app.page, r.x - 60, r.y + r.h / 2);
    await app.page.keyboard.press('Escape');
    const w = await opening(app.page, 'window');
    await app.page.evaluate((id) => window.__kepler.select({ type: 'opening', id }), w.id);
    await app.page.selectOption('#openType', 'panoramic');
    const w2 = await opening(app.page, 'window');
    assert.deepEqual([w2.type, w2.sill], ['panoramic', 100]);
    assert.ok(w2.height >= 2000);
  });

  it('высота потолка комнаты; пусто — снова по этажу', async () => {
    const r = (await proj(app.page)).rooms[0];
    await app.page.evaluate((id) => window.__kepler.selectRoom(id), r.id);
    await app.page.fill('#roomCeil', '2.4');
    await app.page.locator('#roomCeil').blur();
    const ceil = () => app.page.evaluate(() => window.__kepler.state.project.rooms[0].ceiling);
    assert.equal(await ceil(), 2400);
    // Замечание — в панели «⚠» (не в свойствах), с переходом к этой комнате.
    const height = `#issuesPanel [data-issue-id^="height:"]`;
    assert.match(await app.page.textContent(height), /Высота ≈ 2,40 м < 2,5 м/);
    assert.doesNotMatch(await app.page.textContent('#propsPanel'), /Высота ≈/);
    assert.ok(await app.page.evaluate((id) => window.__kepler.state.issues.groups.flatMap((g) => g.items)
      .some((i) => i.id.startsWith('height:') && i.target?.id === id), r.id));
    await app.page.fill('#roomCeil', '');
    await app.page.locator('#roomCeil').blur();
    assert.equal(await ceil(), null);
  });

  it('без ошибок в консоли', () => {
    assert.deepEqual(app.errors, []);
  });
});

// Блокер Б2: толщина общей стены из панели свойств не рвёт стыковку.
describe('толщина и тип общей стены', () => {
  let app;
  before(async () => {
    app = await startApp();
    await openNew(app.page);
    await dropOnCanvas(app.page, 'application/x-kepler-room', 'living');
  });
  after(async () => { await app?.close(); });

  const sharedWalls = (page) => page.evaluate(() => window.__kepler.state.walls
    .filter((w) => w.kind === 'shared')
    .map((w) => ({ key: w.key, from: w.from, thickness: w.thickness, type: w.wallType })));

  it('300 мм и «Несущая»: стена остаётся общей, сосед сдвигается', async () => {
    const id = (await proj(app.page)).rooms[0].id;
    await app.page.evaluate((rid) => window.__kepler.selectRoom(rid), id);
    await app.page.keyboard.press('Control+c');
    await app.page.keyboard.press('Control+v');
    const [wall] = await sharedWalls(app.page);
    assert.ok(wall, 'копия пристыкована общей стеной');
    await app.page.evaluate((w) => window.__kepler.select({ type: 'wall', key: w.key, from: w.from }), wall);
    await app.page.fill('#wallT', '300');
    await app.page.locator('#wallT').blur();
    let list = await sharedWalls(app.page);
    assert.equal(list.length, 1);
    assert.equal(list[0].thickness, 300);
    await app.page.selectOption('#wallKind', 'bearing');
    list = await sharedWalls(app.page);
    assert.equal(list.length, 1);
    assert.equal(list[0].type, 'bearing');
    assert.equal(list[0].thickness, 300, 'ручная толщина сохраняется при смене типа');
    await app.page.keyboard.press('Control+z');
    await app.page.keyboard.press('Control+z');
    list = await sharedWalls(app.page);
    assert.deepEqual([list.length, list[0].thickness], [1, 100]);
  });

  it('без ошибок в консоли', () => {
    assert.deepEqual(app.errors, []);
  });
});
