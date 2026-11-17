// Типы помещений: библиотека по категориям, новые типы, цвет пола по типу,
// смена типа в «Свойствах» (список с optgroup).
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, openNew, worldToClient } from './helpers.mjs';
import { ROOM_CATEGORIES, ROOM_TYPES, roomColors } from '../../core/catalog.js';

const hex = (rgb) => `#${rgb.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
const near = (a, b, tol = 6) => {
  const p = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  return p(a).every((v, i) => Math.abs(v - p(b)[i]) <= tol);
};

// Цвет пикселя холста в мировой точке (без масштаба DPR — через размеры).
async function pixelAt(page, x, y) {
  const c = await worldToClient(page, x, y);
  return page.evaluate(([cx, cy]) => {
    const cv = document.getElementById('canvas');
    const r = cv.getBoundingClientRect();
    const px = Math.round((cx - r.left) * (cv.width / r.width));
    const py = Math.round((cy - r.top) * (cv.height / r.height));
    return [...cv.getContext('2d').getImageData(px, py, 1, 1).data.slice(0, 3)];
  }, [c.x, c.y]);
}

describe('типы помещений', () => {
  let app;
  before(async () => {
    app = await startApp();
    await app.page.emulateMedia({ colorScheme: 'light' });
    await openNew(app.page);
  });
  after(async () => { await app?.close(); });

  it('библиотека: группы по категориям, все типы, точка цвета типа', async () => {
    const { page } = app;
    await page.click('#boundRoomBtn');
    assert.equal(await page.isVisible('#roomCards'), true);
    const groups = await page.$$eval('#roomCards .room-group', (ns) => ns.map((n) => ({
      title: n.querySelector('.room-group-title').textContent,
      types: [...n.querySelectorAll('.room-card')].map((c) => c.dataset.type),
    })));
    assert.deepEqual(groups.map((g) => g.title), ROOM_CATEGORIES.map((c) => c.title));
    assert.equal(groups.flatMap((g) => g.types).length, ROOM_TYPES.length);
    const names = await page.$$eval('#roomCards .room-card-name', (ns) => ns.map((n) => n.textContent));
    await page.fill('#roomSearch', 'котель');
    assert.deepEqual(await page.locator('#roomCards button:visible').allTextContents(), ['Котельная']);
    await page.fill('#roomSearch', 'qqqq');
    assert.equal(await page.isVisible('#roomSearchEmpty'), true);
    await page.fill('#roomSearch', '');
    for (const t of ['Котельная', 'Постирочная', 'Гостевой санузел', 'Прихожая', 'Детская', 'Веранда']) assert.ok(names.includes(t), t);
    const dot = await page.$eval('#roomCards .room-card[data-type="boiler"] .room-dot', (n) => getComputedStyle(n).backgroundColor);
    const m = dot.match(/\d+/g).slice(0, 3).map(Number);
    assert.ok(near(hex(m), roomColors('boiler').swatch, 2), `точка ${dot}`);
  });

  it('клик «Котельная» и клик на плане — комната типа boiler цвета категории', async () => {
    const { page } = app;
    await page.click('#roomCards .room-card[data-type="boiler"]');
    assert.equal(await page.evaluate(() => window.__kepler.state.tool?.type), 'boiler');
    const at = await worldToClient(page, 0, 0);
    await page.mouse.click(at.x, at.y);
    await page.waitForFunction(() => window.__kepler.state.project.rooms.some((r) => r.type === 'boiler'));
    const room = await page.evaluate(() => window.__kepler.state.project.rooms.find((r) => r.type === 'boiler'));
    assert.equal(room.name, 'Котельная');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await page.evaluate(() => window.__kepler.select(null));
    await page.waitForTimeout(150);
    const px = await pixelAt(page, room.x + room.w * 0.2, room.y + room.h * 0.8);
    assert.ok(near(hex(px), roomColors('boiler').light), `пол ${hex(px)} ≠ ${roomColors('boiler').light}`);
  });

  it('тёмная тема — тёмный оттенок того же типа', async () => {
    const { page } = app;
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.waitForTimeout(250);
    const room = await page.evaluate(() => window.__kepler.state.project.rooms.find((r) => r.type === 'boiler'));
    const px = await pixelAt(page, room.x + room.w * 0.2, room.y + room.h * 0.8);
    assert.ok(near(hex(px), roomColors('boiler').dark), `пол ${hex(px)} ≠ ${roomColors('boiler').dark}`);
    await page.emulateMedia({ colorScheme: 'light' });
    await page.waitForTimeout(150);
  });

  it('«Свойства»: тип — список с группами; смена типа меняет тип, название и цвет', async () => {
    const { page } = app;
    const id = await page.evaluate(() => window.__kepler.state.project.rooms.find((r) => r.type === 'boiler').id);
    await page.evaluate((rid) => window.__kepler.selectRoom(rid), id);
    await page.waitForSelector('#roomType');
    const labels = await page.$$eval('#roomType optgroup', (ns) => ns.map((n) => n.label));
    assert.deepEqual(labels, ROOM_CATEGORIES.map((c) => c.title));
    assert.equal(await page.$eval('#roomType', (n) => n.value), 'boiler');
    await page.selectOption('#roomType', 'laundry');
    await page.waitForFunction((rid) => window.__kepler.state.project.rooms.find((r) => r.id === rid).type === 'laundry', id);
    const room = await page.evaluate((rid) => window.__kepler.state.project.rooms.find((r) => r.id === rid), id);
    assert.equal(room.name, 'Постирочная');
    await page.evaluate(() => window.__kepler.select(null));
    await page.waitForTimeout(150);
    const px = await pixelAt(page, room.x + room.w * 0.2, room.y + room.h * 0.8);
    assert.ok(near(hex(px), roomColors('laundry').light), `пол ${hex(px)}`);
    assert.deepEqual(app.errors, []);
  });
});
