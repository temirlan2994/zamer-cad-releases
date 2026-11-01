// e2e правки через интерфейс: клавиатура, панель свойств, проёмы, файлы,
// экспорт, рисование участка, тема, колесо. Проходит по всем модулям ui/*.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { startApp, openNew, dropOnCanvas, clickWorld, uploadText } from './helpers.mjs';
import { SCHEMA } from '../../core/migrate.js';

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

  it('«+ Дверь» в свойствах и клик по стене добавляют дверь', async () => {
    const r = (await proj(app.page)).rooms[0];
    await app.page.click('#addDoorBtn');
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
    assert.equal(JSON.parse(file.text).schema, SCHEMA);
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

    await app.page.click('#siteTools button:nth-child(7)'); // «Север по 2 точкам»
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
