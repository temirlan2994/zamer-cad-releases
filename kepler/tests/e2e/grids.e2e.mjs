// e2e: координационные оси реальной мышью — инструмент «Ось» (кнопка, G,
// Tab), клики ставят оси 1, 2 и А, ось видна на плане (флаг и пиксели),
// выбор кликом по кружку, перетаскивание линии и кружка, «Свойства» оси,
// Delete и Ctrl+Z, «Оси по стенам», магнит комнаты к оси при переносе,
// сохранение и загрузка, настройка «Показывать оси», оси на листе плана;
// телефон — инструмент виден и тапами ставит ось.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { clickToolbarTool, mobileSelectFamilyTool, openToolFamily, startApp, openSample, worldToClient } from './helpers.mjs';

const grids = (page) => page.evaluate(() => window.__kepler.state.project.grids || []);
const sel = (page) => page.evaluate(() => window.__kepler.state.selection);
const st = (page, key) => page.evaluate((k) => window.__kepler.state[k], key);
const byLabel = async (page, label) => (await grids(page)).find((g) => g.label === label);

async function toClient(page, x, y) {
  const wp = await page.evaluate(async (q) => (await import('./ui/view.js')).planToWorld(q), { x, y });
  return worldToClient(page, wp.x, wp.y);
}

async function canvasBox(page) {
  return (await page.$('#canvas')).boundingBox();
}

// Экранная точка интерфейса оси (state._gridUI) → клиентская.
async function gridUi(page, id) {
  const ui = await page.evaluate((gid) => window.__kepler.state._gridUI.find((r) => r.id === gid), id);
  const box = await canvasBox(page);
  const c = (p) => ({ x: box.x + p.x, y: box.y + p.y });
  return { ...ui, A: c(ui.A), B: c(ui.B), heads: ui.heads.map((h) => ({ ...c(h), end: h.end })) };
}

const color = (page, x, y) => page.evaluate(([cx, cy]) => {
  const c = document.getElementById('canvas');
  const r = c.getBoundingClientRect();
  const k = c.width / r.width;
  return [...c.getContext('2d').getImageData(Math.round((cx - r.left) * k), Math.round((cy - r.top) * k), 1, 1).data];
}, [x, y]);

async function redraw(page) {
  await page.evaluate(async () => (await import('./ui/view.js')).requestDraw());
  await page.waitForTimeout(80);
}

describe('Координационные оси на плане', () => {
  let app;
  before(async () => {
    app = await startApp({ width: 1440, height: 860 });
    await openSample(app.page);
    await app.page.click('#fitBtn');
    // Чуть отдалить: место справа и снизу от дома под новые оси.
    await app.page.evaluate(async () => {
      const s = window.__kepler.state;
      s.view.scale *= 0.7;
      (await import('./ui/view.js')).requestDraw();
    });
    await app.page.waitForTimeout(100);
  });
  after(async () => { await app?.close(); });

  it('кнопка «Ось» в колонке, подсказка, клавиша G', async () => {
    const { page } = app;
    assert.ok(await page.isVisible('#docsGroupBtn'));
    await openToolFamily(page, 'gridToolBtn');
    assert.match(await page.textContent('#tbTip-grid'), /Ось.*Tab.*Esc/s);
    await page.keyboard.press('KeyG');
    assert.equal(await page.evaluate(() => window.__kepler.state.tool?.kind), 'grid');
    assert.ok(await page.$eval('#gridToolBtn', (b) => b.classList.contains('active')));
    await page.keyboard.press('KeyG');
    assert.equal(await page.evaluate(() => window.__kepler.state.tool), null);
    await clickToolbarTool(page, 'gridToolBtn');
    assert.equal(await page.evaluate(() => window.__kepler.state.tool?.kind), 'grid');
    assert.ok(await page.isVisible('#toGridKind'));
  });

  it('клики ставят оси 1 и 2 (вертикальные), Tab — горизонтальная А; ось видна', async () => {
    const { page } = app;
    await page.selectOption('#toGridKind', 'x');
    const a = await toClient(page, 13000, 3000);
    await page.mouse.move(a.x, a.y, { steps: 3 });
    assert.ok(await st(page, 'planGridsDrawn') === 0);
    await page.mouse.click(a.x, a.y);
    const b = await toClient(page, 16000, 3000);
    await page.mouse.move(b.x, b.y, { steps: 5 });
    await page.mouse.click(b.x, b.y);
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => window.__kepler.state.tool.gkind), 'y');
    const c = await toClient(page, 5000, 10500);
    await page.mouse.move(c.x, c.y, { steps: 5 });
    await page.mouse.click(c.x, c.y);
    const list = await grids(page);
    assert.deepEqual(list.map((g) => [g.label, g.kind]), [['1', 'x'], ['2', 'x'], ['А', 'y']]);
    assert.ok(Math.abs(list[0].at - 13000) <= 250 && Math.abs(list[1].at - 16000) <= 250, JSON.stringify(list));
    assert.ok(Math.abs(list[2].at - 10500) <= 250);
    assert.equal(await page.evaluate(() => window.__kepler.state.tool?.kind), 'grid', 'инструмент остаётся');
    await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(() => window.__kepler.state.tool), null);
    await redraw(page);
    assert.equal(await st(page, 'planGridsDrawn'), 3);
    // Кружок с маркой — не цвет фона.
    const ui = await gridUi(page, list[0].id);
    const h = ui.heads[1];
    const ring = await color(page, h.x + 14, h.y);
    const bg = await color(page, h.x + 40, h.y + 40);
    assert.notDeepEqual(ring, bg, 'кружок марки нарисован');
  });

  it('клик по кружку выбирает ось; плашка выделения', async () => {
    const { page } = app;
    const g1 = await byLabel(page, '1');
    const ui = await gridUi(page, g1.id);
    await page.mouse.click(ui.heads[0].x, ui.heads[0].y);
    assert.deepEqual(await sel(page), { type: 'grid', id: g1.id });
    assert.ok(await page.isVisible('#selectionToolbar'));
    assert.match(await page.textContent('#selectionToolbar'), /Ось 1/);
    assert.ok(await page.isVisible('#gridProps'));
  });

  it('перетаскивание линии двигает ось; Ctrl+Z — один шаг', async () => {
    const { page } = app;
    const g2 = await byLabel(page, '2');
    const ui = await gridUi(page, g2.id);
    // Точка на линии ниже дома (вне комнат).
    const p = { x: ui.A.x + (ui.B.x - ui.A.x) * 0.9, y: ui.A.y + (ui.B.y - ui.A.y) * 0.9 };
    const target = await toClient(page, g2.at + 1000, 0);
    const dx = target.x - (await toClient(page, g2.at, 0)).x;
    await page.mouse.move(p.x, p.y);
    await page.mouse.down();
    await page.mouse.move(p.x + dx / 2, p.y, { steps: 3 });
    await page.mouse.move(p.x + dx, p.y, { steps: 3 });
    await page.mouse.up();
    const moved = await byLabel(page, '2');
    assert.deepEqual(await sel(page), { type: 'grid', id: g2.id });
    assert.ok(Math.abs(moved.at - (g2.at + 1000)) <= 260, `${g2.at} → ${moved.at}`);
    await page.keyboard.press('Control+z');
    assert.equal((await byLabel(page, '2')).at, g2.at);
  });

  it('кружок меняет длину линии', async () => {
    const { page } = app;
    const g2 = await byLabel(page, '2');
    const ui = await gridUi(page, g2.id);
    const h = ui.heads.find((x) => x.end === 'to');
    const ext0 = await page.evaluate(async (g) => (await import('./core/grid-axes.js')).gridExtent(window.__kepler.state.project, g), g2);
    const down = await toClient(page, g2.at, ext0.to + 2000);
    const at0 = await toClient(page, g2.at, ext0.to);
    await page.mouse.move(h.x, h.y);
    await page.mouse.down();
    await page.mouse.move(h.x + (down.x - at0.x), h.y + (down.y - at0.y), { steps: 4 });
    await page.mouse.up();
    const g = await byLabel(page, '2');
    assert.ok(Number.isFinite(g.to) && g.to > ext0.to + 1500, `to ${g.to} (было ${ext0.to})`);
    await page.keyboard.press('Control+z');
    assert.equal((await byLabel(page, '2')).to, undefined);
  });

  it('«Свойства» меняют марку и положение', async () => {
    const { page } = app;
    const g1 = await byLabel(page, '1');
    await page.evaluate(async (id) => (await import('./ui/tools.js')).selectObject({ type: 'grid', id }), g1.id);
    await page.waitForSelector('#gridLabel');
    await page.fill('#gridLabel', '1а');
    await page.press('#gridLabel', 'Enter');
    await page.waitForTimeout(50);
    assert.equal((await grids(page)).find((g) => g.id === g1.id).label, '1а');
    await page.fill('#gridAt', String(g1.at - 500));
    await page.press('#gridAt', 'Enter');
    await page.waitForTimeout(50);
    assert.equal((await grids(page)).find((g) => g.id === g1.id).at, g1.at - 500);
    await page.keyboard.press('Control+z');
    await page.keyboard.press('Control+z');
    const back = (await grids(page)).find((g) => g.id === g1.id);
    assert.deepEqual([back.label, back.at], ['1', g1.at]);
  });

  it('Delete удаляет ось, Ctrl+Z возвращает', async () => {
    const { page } = app;
    const g = await byLabel(page, 'А');
    await page.evaluate(async (id) => (await import('./ui/tools.js')).selectObject({ type: 'grid', id }), g.id);
    await page.keyboard.press('Delete');
    assert.equal(await byLabel(page, 'А'), undefined);
    await page.keyboard.press('Control+z');
    assert.ok(await byLabel(page, 'А'));
  });

  it('«Оси по стенам» в «Свойствах» вида: сетка по дому, повтор — без дублей', async () => {
    const { page } = app;
    await page.keyboard.press('Escape');
    await page.waitForSelector('#viewsGridAuto');
    const n0 = (await grids(page)).length;
    await page.click('#viewsGridAuto');
    const list = await grids(page);
    assert.ok(list.length >= n0 + 4, `${n0} → ${list.length}`);
    const xs = list.filter((g) => g.kind === 'x').map((g) => g.at);
    assert.ok(xs.includes(-250) && xs.includes(10350), `x: ${xs}`);
    await page.click('#viewsGridAuto');
    assert.equal((await grids(page)).length, list.length);
  });

  it('комната при переносе примагничивается к оси', async () => {
    const { page } = app;
    const g2 = await byLabel(page, '2');
    const id = await page.evaluate(async (x0) => {
      const { createRoom } = await import('./core/model.js');
      const store = await import('./ui/store.js');
      const r = createRoom('storage', x0 + 1500, 14000, 3000, 2500);
      store.mutate(() => { window.__kepler.state.project.rooms.push(r); });
      return r.id;
    }, g2.at);
    await redraw(page);
    const c = await toClient(page, g2.at + 3000, 15250);
    const t = await toClient(page, g2.at + 1600, 15250); // левая грань — в 100 мм от оси
    await page.mouse.move(c.x, c.y);
    await page.mouse.down();
    await page.mouse.move((c.x + t.x) / 2, (c.y + t.y) / 2, { steps: 3 });
    await page.mouse.move(t.x, t.y, { steps: 3 });
    const guides = await st(page, 'guides');
    await page.mouse.up();
    const room = await page.evaluate((rid) => window.__kepler.state.project.rooms.find((r) => r.id === rid), id);
    assert.equal(room.x, g2.at, `грань ${room.x} на оси ${g2.at}`);
    assert.ok(guides.some((g) => g.gridId === g2.id), 'направляющая по оси');
  });

  it('сохранение и загрузка файла: оси на месте', async () => {
    const { page } = app;
    const before = await grids(page);
    const after = await page.evaluate(async () => {
      const { serializeProject } = await import('./core/model.js');
      const store = await import('./ui/store.js');
      const text = serializeProject(window.__kepler.state.project);
      store.restoreFrom(text);
      return { list: window.__kepler.state.project.grids, schema: JSON.parse(text).schema };
    });
    assert.equal(after.schema, 'kepler-plan/7');
    assert.deepEqual(after.list, before);
  });

  it('настройка «Показывать оси на плане» выключает и включает', async () => {
    const { page } = app;
    await page.keyboard.press('Escape');
    await page.waitForSelector('#viewsGridOn');
    await redraw(page);
    assert.ok(await st(page, 'planGridsDrawn') > 0);
    await page.uncheck('#viewsGridOn');
    await redraw(page);
    assert.equal(await st(page, 'planGridsDrawn'), 0);
    await page.check('#viewsGridOn');
    await redraw(page);
    assert.ok(await st(page, 'planGridsDrawn') > 0);
    await page.check('#viewsGridDims');
    await redraw(page);
    assert.ok(await st(page, 'planGridDims') > 0, 'размерная цепочка');
    await page.uncheck('#viewsGridDims');
  });

  it('оси на листе плана этажа (A3): есть по настройке, нет — без неё', async () => {
    const { page } = app;
    const ink = await page.evaluate(async () => {
      const sheet = await import('./ui/sheet.js');
      const pg = await import('./ui/plan-grids.js');
      const p = window.__kepler.state.project;
      const count = () => {
        const pts = sheet.planPoints(p);
        const box = sheet.rotatedBox(pts, 0);
        const c = sheet.renderRegion(p, { kind: 'plan', box, rotation: 0, denominator: 200, width: 400, height: 270, ppm: 2 });
        const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
        let dark = 0; // печать — тёмной линией
        for (let i = 0; i < d.length; i += 4) if (d[i] < 120 && d[i + 1] < 120 && d[i + 2] < 120) dark += 1;
        return { dark };
      };
      pg.setPlanGridPref({ sheets: true });
      const on = count();
      pg.setPlanGridPref({ sheets: false });
      const off = count();
      pg.setPlanGridPref({ sheets: true });
      return { on, off };
    });
    assert.ok(ink.on.dark > ink.off.dark, `на листе — линии осей: ${JSON.stringify(ink)}`);
    assert.deepEqual(app.errors, []);
  });
});

describe('Координационные оси на телефоне', () => {
  let app; let cdp;
  before(async () => {
    app = await startApp({ mobile: true });
    await openSample(app.page);
    cdp = await app.page.context().newCDPSession(app.page);
  });
  after(async () => { await app?.close(); });

  const touch = (type, p) => cdp.send('Input.dispatchTouchEvent', {
    type,
    touchPoints: type === 'touchEnd' ? [] : [{ x: p.x, y: p.y }],
  });

  async function nextDraw(page) {
    await page.evaluate(async () => {
      (await import('./ui/view.js')).requestDraw();
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    });
  }

  async function touchTap(page, p) {
    await touch('touchStart', p);
    await touch('touchEnd', p);
    await nextDraw(page);
  }

  async function touchDrag(page, from, to, { hold = 0, steps = 6 } = {}) {
    await touch('touchStart', from);
    if (hold) await page.waitForTimeout(hold);
    for (let i = 1; i <= steps; i += 1) {
      await touch('touchMove', {
        x: from.x + ((to.x - from.x) * i) / steps,
        y: from.y + ((to.y - from.y) * i) / steps,
      });
    }
    await touch('touchEnd', to);
    await nextDraw(page);
  }

  // Берём участок линии вне комнат и накладок. Так тест не зависит от
  // масштаба и расположения дома на узком экране.
  async function freeGridLinePoint(page, id) {
    return page.evaluate(async (gid) => {
      const canvas = document.getElementById('canvas');
      const rect = canvas.getBoundingClientRect();
      const ui = window.__kepler.state._gridUI.find((entry) => entry.id === gid);
      const { screenToPlan } = await import('./ui/view.js');
      const { hitPlanStack } = await import('./ui/hit.js');
      if (!ui) throw new Error(`Нет экранной геометрии оси ${gid}`);
      const dx = ui.B.x - ui.A.x; const dy = ui.B.y - ui.A.y;
      const length = Math.hypot(dx, dy) || 1;
      const ux = dx / length; const uy = dy / length;
      const candidates = [];
      for (const inset of [4, 8, 16, 24, 32, 40, 56, 72]) {
        candidates.push({ x: ui.A.x + ux * inset, y: ui.A.y + uy * inset });
        candidates.push({ x: ui.B.x - ux * inset, y: ui.B.y - uy * inset });
      }
      for (const t of [0.08, 0.92, 0.15, 0.85, 0.25, 0.75, 0.5]) {
        candidates.push({ x: ui.A.x + dx * t, y: ui.A.y + dy * t });
      }
      for (const p of candidates) {
        const client = { x: rect.left + p.x, y: rect.top + p.y };
        if (client.x < rect.left + 4 || client.x > rect.right - 4 || client.y < rect.top + 4 || client.y > rect.bottom - 4) continue;
        if (document.elementFromPoint(client.x, client.y) !== canvas) continue;
        if (ui.heads.some((head) => Math.hypot(p.x - head.x, p.y - head.y) <= 18)) continue;
        if (hitPlanStack(screenToPlan(p.x, p.y)).length) continue;
        return client;
      }
      throw new Error(`Нет свободной видимой точки на оси ${gid}`);
    }, id);
  }

  async function visibleGridHead(page, id) {
    return page.evaluate((gid) => {
      const canvas = document.getElementById('canvas');
      const rect = canvas.getBoundingClientRect();
      const ui = window.__kepler.state._gridUI.find((entry) => entry.id === gid);
      if (!ui) throw new Error(`Нет экранной геометрии оси ${gid}`);
      for (const head of ui.heads) {
        const other = ui.heads.find((entry) => entry.end !== head.end);
        const p = { x: rect.left + head.x, y: rect.top + head.y };
        if (p.x < rect.left + 16 || p.x > rect.right - 16 || p.y < rect.top + 16 || p.y > rect.bottom - 16) continue;
        if (document.elementFromPoint(p.x, p.y) !== canvas) continue;
        const ox = head.x - other.x; const oy = head.y - other.y;
        const length = Math.hypot(ox, oy) || 1;
        return { ...p, end: head.end, ux: ox / length, uy: oy / length };
      }
      throw new Error(`Нет видимой марки оси ${gid}`);
    }, id);
  }

  const gridExtent = (page, id) => page.evaluate(async (gid) => {
    const g = window.__kepler.state.project.grids.find((entry) => entry.id === gid);
    return (await import('./core/grid-axes.js')).gridExtent(window.__kepler.state.project, g);
  }, id);

  it('инструмент — в ряду «Рисовать», тапом ставит ось', async () => {
    const { page } = app;
    await page.tap('#mobileBar [data-sheet="draw"]');
    assert.ok(await page.isVisible('#mobileDraw [data-draw-family="docs"]'));
    await mobileSelectFamilyTool(page, 'docs', 'gridToolBtn');
    assert.equal(await page.evaluate(() => window.__kepler.state.tool?.kind), 'grid');
    const box = await canvasBox(page);
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height * 0.3);
    await page.waitForTimeout(100);
    const list = await grids(page);
    assert.equal(list.length, 1);
    assert.equal(list[0].label, '1');
    assert.deepEqual(app.errors, []);
  });

  it('ось и её марка двигаются только после отдельного тапа выбора', async () => {
    const { page } = app;
    await page.keyboard.press('Escape');
    const grid = (await grids(page))[0];
    const clearSelection = async () => {
      await page.evaluate(async () => (await import('./ui/tools.js')).selectObject(null));
      await nextDraw(page);
    };

    // Линия: первый hold+drag лишь панорамирует, но не сдвигает ось.
    await clearSelection();
    let line = await freeGridLinePoint(page, grid.id);
    let ui = await gridUi(page, grid.id);
    const lineLength = Math.hypot(ui.B.x - ui.A.x, ui.B.y - ui.A.y) || 1;
    const normal = { x: -(ui.B.y - ui.A.y) / lineLength, y: (ui.B.x - ui.A.x) / lineLength };
    const at0 = (await grids(page)).find((entry) => entry.id === grid.id).at;
    await touchDrag(page, line, { x: line.x + normal.x * 48, y: line.y + normal.y * 48 }, { hold: 650 });
    assert.equal((await grids(page)).find((entry) => entry.id === grid.id).at, at0, 'невыбранная ось не сдвинулась');
    assert.equal(await sel(page), null, 'drag не заменяет отдельный тап');

    line = await freeGridLinePoint(page, grid.id); // после панорамы экранная точка изменилась
    await touchTap(page, line);
    assert.deepEqual(await sel(page), { type: 'grid', id: grid.id }, 'тап выбрал ось');
    line = await freeGridLinePoint(page, grid.id);
    ui = await gridUi(page, grid.id);
    const selectedLength = Math.hypot(ui.B.x - ui.A.x, ui.B.y - ui.A.y) || 1;
    const selectedNormal = { x: -(ui.B.y - ui.A.y) / selectedLength, y: (ui.B.x - ui.A.x) / selectedLength };
    await touchDrag(page, line, { x: line.x + selectedNormal.x * 48, y: line.y + selectedNormal.y * 48 }, { hold: 650 });
    assert.notEqual((await grids(page)).find((entry) => entry.id === grid.id).at, at0, 'выбранная ось сдвинулась');

    // Марка-ручка: тот же select-first, затем изменение длины без hold.
    await clearSelection();
    let head = await visibleGridHead(page, grid.id);
    const extent0 = await gridExtent(page, grid.id);
    await touchDrag(page, head, { x: head.x + head.ux * 48, y: head.y + head.uy * 48 });
    assert.deepEqual(await gridExtent(page, grid.id), extent0, 'невыбранная марка не изменила длину');
    assert.equal(await sel(page), null, 'drag марки не выбрал ось');

    head = await visibleGridHead(page, grid.id); // после панорамы марка переехала
    await touchTap(page, head);
    assert.deepEqual(await sel(page), { type: 'grid', id: grid.id }, 'тап марки выбрал ось');
    head = await visibleGridHead(page, grid.id);
    const extentSelected = await gridExtent(page, grid.id);
    await touchDrag(page, head, { x: head.x + head.ux * 48, y: head.y + head.uy * 48 });
    const extentMoved = await gridExtent(page, grid.id);
    assert.notEqual(extentMoved[head.end], extentSelected[head.end], 'ручка выбранной оси изменила длину');
    assert.deepEqual(app.errors, []);
  });
});
