// Лестница: «П-образная, 3 марша» из инструмента, ручки на плане реальной
// мышью (ступени по маршам — сумма сохраняется, ширина марша, угол площадки),
// Ctrl+Z одним шагом, Esc отменяет жест, параметры в «Свойствах», файл.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, openNew, uploadText, zoomToItems } from './helpers.mjs';

describe('лестница: П-образная в 3 марша и ручки маршей', () => {
  let app;
  before(async () => {
    app = await startApp({ width: 1400, height: 900 });
    app.page.on('dialog', (d) => d.accept());
    await openNew(app.page);
  });
  after(async () => { await app?.close(); });

  // Лестница выбрана, вид — крупный (ручки только при 1:45 и ближе).
  const redraw = async (scale = 0.12) => {
    await app.page.evaluate(() => {
      const st = window.__kepler.state;
      const it = st.project.items.find((i) => i.kind === 'stairs');
      if (it && !(st.selection?.type === 'item' && st.selection.id === it.id)) window.__kepler.select({ type: 'item', id: it.id });
    });
    await zoomToItems(app.page, scale);
    await app.page.evaluate(async () => (await import('./ui/view.js')).requestDraw());
    await app.page.waitForTimeout(120);
  };
  const stair = () => app.page.evaluate(() => {
    const it = window.__kepler.state.project.items.find((i) => i.kind === 'stairs');
    return it ? JSON.parse(JSON.stringify(it)) : null;
  });
  const calc = () => app.page.evaluate(async () => {
    const m = await import('./core/stairs.js');
    const it = window.__kepler.state.project.items.find((i) => i.kind === 'stairs');
    return m.stairCalculation(it);
  });
  // Ручка лестницы на экране (клиентские координаты) и точка «наружу» на d px.
  const handle = async (id) => {
    const box = await (await app.page.$('#canvas')).boundingBox();
    const h = await app.page.evaluate((hid) => window.__kepler.state._stairUI?.handles.find((x) => x.id === hid) || null, id);
    assert.ok(h, `ручка ${id} нарисована`);
    return { x: box.x + h.x, y: box.y + h.y };
  };
  const outDir = (id) => app.page.evaluate(async (hid) => {
    const m = await import('./core/stairs.js');
    const st = window.__kepler.state;
    const it = st.project.items.find((i) => i.kind === 'stairs');
    const h = m.stairHandles(it, 3000).find((x) => x.id === hid);
    const a = window.__kepler.planToScreen(h.x, h.y);
    const b = window.__kepler.planToScreen(h.x + h.out.x * 1000, h.y + h.out.y * 1000);
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    return { x: (b.x - a.x) / len, y: (b.y - a.y) / len, pxPerMm: len / 1000 };
  }, id);
  async function drag(id, mm, { esc = false } = {}) {
    const p = await handle(id);
    const d = await outDir(id);
    const page = app.page;
    await page.mouse.move(p.x, p.y);
    await page.mouse.down();
    for (let i = 1; i <= 6; i += 1) await page.mouse.move(p.x + d.x * d.pxPerMm * mm * (i / 6), p.y + d.y * d.pxPerMm * mm * (i / 6));
    if (esc) await page.keyboard.press('Escape');
    await page.mouse.up();
    await page.waitForTimeout(60);
  }

  it('инструмент «Лестница»: форма в строке параметров, ставится П-образная в 3 марша', async () => {
    const { page } = app;
    await page.click('#stairsToolBtn');
    assert.equal(await page.isVisible('#toStairShape'), true, 'выбор формы в строке параметров');
    await page.selectOption('#toStairShape', 'u3');
    const c = await page.$eval('#canvas', (n) => { const r = n.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
    await page.mouse.move(c.x, c.y);
    await page.mouse.click(c.x, c.y);
    await page.waitForFunction(() => window.__kepler.state.project.items.some((i) => i.kind === 'stairs'));
    const s = await stair();
    assert.equal(s.stairShape, 'u3');
    assert.equal(s.stairStyle, 'interior-wood');
    assert.equal(s.stairMaterial, 'wood');
    const k = await calc();
    assert.deepEqual(k.flights, [5, 4, 5]);
    assert.equal(k.treads + 2, k.risers - 1, 'три марша и две площадки — по высоте этажа');
    assert.ok(k.okRiser && k.okTread && k.okComfort, k.warnings.join('; '));
    assert.equal(await page.evaluate(() => window.__kepler.state.selection?.type), 'item');
    assert.match(await page.textContent('#propsPanel'), /П-образная, 3 марша/);
  });

  it('издали ручек нет; при 1:45 и ближе — круги с числом ступеней, ширина, площадки', async () => {
    const { page } = app;
    await page.evaluate(async () => { window.__kepler.state.view.scale = 0.02; (await import('./ui/view.js')).requestDraw(); });
    await page.waitForTimeout(120);
    assert.equal(await page.evaluate(() => window.__kepler.state._stairUI), null, 'мелкий масштаб — без ручек');
    await redraw();
    const ids = await page.evaluate(() => window.__kepler.state._stairUI?.handles.map((h) => h.id));
    assert.deepEqual(ids, ['steps:0', 'steps:1', 'steps:2', 'width', 'landing:0', 'landing:1']);
  });

  it('ручка нижнего марша: ступени внизу прибавляются, вверху убывают, сумма та же; Ctrl+Z — одним шагом', async () => {
    const { page } = app;
    const before = await calc();
    await drag('steps:0', 2 * 270 + 30);
    const after = await calc();
    assert.equal(after.treads, before.treads, 'сумма ступеней сохраняется');
    assert.equal(after.flights[0], before.flights[0] + 2);
    assert.equal(after.flights[2], before.flights[2] - 2);
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(80);
    assert.deepEqual((await calc()).flights, before.flights, 'отмена одним шагом');
  });

  it('Esc во время жеста — лестница как была', async () => {
    await redraw();
    const before = await stair();
    await drag('steps:0', 600, { esc: true });
    const now = await stair();
    assert.deepEqual(now.flights, before.flights);
    assert.equal(now.w, before.w);
  });

  it('ручка ширины марша: шире, не уже 900', async () => {
    await redraw();
    await drag('width', 400);
    const s = await stair();
    assert.ok(s.flightWidth >= 1150 && s.flightWidth <= 1250, `ширина ${s.flightWidth}`);
    await redraw();
    await drag('width', -1200);
    assert.equal((await stair()).flightWidth, 900, 'норма — не уже 900');
  });

  it('ручка угла площадки: площадка больше, ступени те же', async () => {
    await redraw();
    const before = await stair();
    const p = await handle('landing:0');
    const page = app.page;
    const d = await outDir('landing:0');
    await page.mouse.move(p.x, p.y);
    await page.mouse.down();
    const dx = -300 * d.pxPerMm;
    const dy = -300 * d.pxPerMm;
    for (let i = 1; i <= 5; i += 1) await page.mouse.move(p.x + dx * (i / 5), p.y + dy * (i / 5));
    await page.mouse.up();
    const s = await stair();
    assert.ok(s.landings[0].w > before.landings[0].w && s.landings[0].h > before.landings[0].h, JSON.stringify(s.landings));
    assert.deepEqual(s.flights, before.flights);
  });

  it('«Свойства»: ступени марша числом — сумма сохраняется; форма меняется кнопкой', async () => {
    const { page } = app;
    const before = await calc();
    await page.fill('[data-stair-param="n:1"]', String(before.flights[1] + 1));
    await page.press('[data-stair-param="n:1"]', 'Tab');
    await page.waitForTimeout(80);
    const after = await calc();
    assert.equal(after.flights[1], before.flights[1] + 1);
    assert.equal(after.treads, before.treads);
    await page.click('[data-stair-shape="u"]');
    assert.equal((await stair()).stairShape, 'u');
    await page.click('[data-stair-shape="u3"]');
    assert.equal((await stair()).stairShape, 'u3');
  });

  it('файл: параметры лестницы сохраняются и открываются', async () => {
    const { page } = app;
    await page.evaluate(async () => {
      const m = await import('./core/stairs.js');
      const it = window.__kepler.state.project.items.find((i) => i.kind === 'stairs');
      m.setStairParam(it, 'n:0', 6, 3000);
    });
    const saved = await stair();
    const text = await page.evaluate(async () => (await import('./core/model.js')).serializeProject(window.__kepler.state.project));
    await uploadText(page, '#fileInput', 'stairs.kepler.json', text);
    await page.waitForFunction((id) => {
      const it = window.__kepler.state.project.items.find((i) => i.kind === 'stairs');
      return it && it.id === id && window.__kepler.state.selection === null;
    }, saved.id);
    const back = await stair();
    for (const key of ['stairShape', 'flightWidth', 'going', 'flights', 'landings', 'w', 'h']) assert.deepEqual(back[key], saved[key], key);
  });

  it('без ошибок в консоли', () => {
    assert.deepEqual(app.errors, []);
  });
});
