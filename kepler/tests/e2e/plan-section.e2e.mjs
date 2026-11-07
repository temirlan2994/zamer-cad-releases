// e2e разрезов по линии на плане этажа (ui/plan-section.js): инструмент
// «Разрез» (кнопка и S) — 2 клика + клик стороны, вид в project.views, в
// дереве «Разрезы» и на плане; двойной клик открывает окно разреза
// (ui/elevation-view.js), «Развернуть» меняет сторону, ручка конца двигает
// линию, Ctrl+Z, переименование, удаление, файл, другой этаж, телефон.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, openSample, uploadText } from './helpers.mjs';

const st = (page, fn, arg) => page.evaluate(fn, arg);
const sections = (page) => st(page, () => (window.__kepler.state.project.views || []).filter((v) => v.kind === 'section'));
const drawn = (page) => st(page, () => window.__kepler.state.elevationDrawn);
const undoLen = (page) => st(page, async () => (await import('./ui/state.js')).history.undo.length);

// Оси дома → клиентские координаты.
async function planClient(page, x, y) {
  const box = await page.locator('#canvas').boundingBox();
  const s = await page.evaluate(async ([px, py]) => (await import('./ui/view.js')).planToScreen(px, py), [x, y]);
  return { x: box.x + s.x, y: box.y + s.y };
}

// Габарит комнат активного этажа.
const houseBox = (page) => st(page, () => {
  const rs = window.__kepler.state.project.rooms;
  return {
    x0: Math.min(...rs.map((r) => r.x)), y0: Math.min(...rs.map((r) => r.y)),
    x1: Math.max(...rs.map((r) => r.x + r.w)), y1: Math.max(...rs.map((r) => r.y + r.h)),
  };
});

const inkShare = (page) => page.evaluate(() => {
  const c = document.getElementById('elevCanvas');
  const { data } = c.getContext('2d').getImageData(0, 0, c.width, c.height);
  let ink = 0;
  for (let i = 0; i < data.length; i += 16) {
    if (Math.abs(data[i] - data[0]) + Math.abs(data[i + 1] - data[1]) + Math.abs(data[i + 2] - data[2]) > 30) ink += 1;
  }
  return ink / (data.length / 16);
});
const imageSum = (page) => page.evaluate(() => {
  const c = document.getElementById('elevCanvas');
  const { data } = c.getContext('2d').getImageData(0, 0, c.width, c.height);
  let h = 0;
  for (let i = 0; i < data.length; i += 4) h = (h * 31 + data[i] + data[i + 1] * 3 + data[i + 2] * 7) % 1000000007;
  return h;
});

describe('разрез по линии на плане — компьютер 1280', () => {
  let app;
  let box;
  let line;
  before(async () => {
    app = await startApp();
    await openSample(app.page);
    box = await houseBox(app.page);
  });
  after(async () => { await app?.close(); });

  it('кнопка «Разрез»: подсказка с клавишей S; 2 клика + клик стороны — вид создан', async () => {
    const { page } = app;
    assert.match(await page.textContent('#sectionToolBtn .tb-tip'), /\bS\b/);
    await page.click('#sectionToolBtn');
    assert.equal(await st(page, () => window.__kepler.state.tool?.kind), 'psec');
    assert.equal(await page.$eval('#sectionToolBtn', (n) => n.classList.contains('active')), true);
    const cx = Math.round((box.x0 + box.x1) / 2 / 100) * 100;
    const a = await planClient(page, cx, box.y0 - 1500);
    const b = await planClient(page, cx, box.y1 + 1500);
    const side = await planClient(page, cx - 1500, (box.y0 + box.y1) / 2);
    const undo = await undoLen(page);
    await page.mouse.click(a.x, a.y);
    await page.mouse.click(b.x, b.y);
    assert.equal(await sections(page).then((s) => s.length), 0, 'до клика стороны — черновик');
    await page.mouse.move(side.x, side.y);
    await page.mouse.click(side.x, side.y);
    const secs = await sections(page);
    assert.equal(secs.length, 1);
    const v = secs[0];
    line = v.line;
    assert.equal(v.name, 'Разрез 1');
    assert.equal(v.levelId, await st(page, () => window.__kepler.state.project.activeLevel));
    assert.ok(Math.abs(v.line.a.x - cx) < 300 && Math.abs(v.line.b.x - cx) < 300, JSON.stringify(v.line));
    // Линия сверху вниз, клик слева (запад) — side 1 (левая нормаль a→b).
    assert.equal(v.side, 1);
    assert.equal(await undoLen(page), undo + 1, 'одна запись истории');
    assert.equal(await st(page, () => window.__kepler.state.tool), null);
    assert.deepEqual(await st(page, () => window.__kepler.state.selection), { type: 'section', id: v.id });
    assert.equal(await page.isVisible('#secName'), true, '«Свойства» разреза');
    assert.deepEqual(await st(page, () => window.__kepler.state.planSectionsDrawn), [{ id: v.id, bold: true }]);
    assert.deepEqual(app.errors, []);
  });

  it('клавиша S и Esc; дерево «Разрезы» показывает разрез', async () => {
    const { page } = app;
    await page.keyboard.press('Escape');
    await page.keyboard.press('s');
    assert.equal(await st(page, () => window.__kepler.state.tool?.kind), 'psec');
    await page.keyboard.press('Escape');
    assert.equal(await st(page, () => window.__kepler.state.tool), null);
    await page.click('#propsTabViews');
    const names = await page.$$eval('[data-vt-group="sections"] .vt-name', (ns) => ns.map((n) => n.textContent));
    assert.deepEqual(names, ['Разрез 1']);
    await page.click('#propsTabMain');
  });

  it('двойной клик по линии — окно разреза; «Развернуть» меняет сторону и картинку', async () => {
    const { page } = app;
    const q = await planClient(page, line.a.x + (line.b.x - line.a.x) * 0.3, line.a.y + (line.b.y - line.a.y) * 0.3);
    await page.mouse.dblclick(q.x, q.y);
    const id = (await sections(page))[0].id;
    assert.equal(await st(page, () => window.__kepler.state.elevationOpen), id);
    assert.match(await page.textContent('#elevViewTitle'), /Разрез 1 1:100/);
    const d = await drawn(page);
    assert.equal(d.kind, 'section');
    assert.ok(d.cuts > 2, `сечений ${d.cuts}`);
    assert.ok(await inkShare(page) > 0.01, 'на холсте разреза есть рисунок');
    const sum1 = await imageSum(page);
    await page.click('#propsTabMain');
    assert.match(await page.textContent('#viewPropsTitle'), /Вид: Разрез 1/);
    await page.click('#elevFlipBtn');
    assert.equal((await drawn(page)).side, -1);
    assert.equal((await sections(page))[0].side, -1);
    assert.notEqual(await imageSum(page), sum1, 'картинка поменялась');
    await page.keyboard.press('Control+z');
    assert.equal((await sections(page))[0].side, 1);
    assert.equal((await drawn(page)).side, 1);
    await page.keyboard.press('Escape');
    assert.equal(await st(page, () => window.__kepler.state.elevationOpen), null);
    // Из дерева — тоже открывается.
    await page.click('#propsTabViews');
    await page.click(`#viewTree [data-view="${id}"]`);
    assert.equal(await st(page, () => window.__kepler.state.elevationOpen), id);
    await page.keyboard.press('Escape');
    await page.click('#propsTabMain');
    assert.deepEqual(app.errors, []);
  });

  it('выбор линии, ручка конца двигает её; Ctrl+Z возвращает; переименование', async () => {
    const { page } = app;
    const q = await planClient(page, line.a.x + (line.b.x - line.a.x) * 0.3, line.a.y + (line.b.y - line.a.y) * 0.3);
    await page.mouse.click(q.x, q.y);
    assert.equal(await st(page, () => window.__kepler.state.selection?.type), 'section');
    const b0 = (await sections(page))[0].line.b;
    const B = await planClient(page, b0.x, b0.y);
    const undo = await undoLen(page);
    await page.mouse.move(B.x, B.y);
    await page.mouse.down();
    await page.mouse.move(B.x + 40, B.y + 10, { steps: 4 });
    await page.mouse.move(B.x + 80, B.y + 20, { steps: 4 });
    await page.mouse.up();
    const b1 = (await sections(page))[0].line.b;
    assert.ok(b1.x - b0.x > 300, `конец сдвинулся ${JSON.stringify([b0, b1])}`);
    assert.equal(await undoLen(page), undo + 1);
    await page.keyboard.press('Control+z');
    assert.deepEqual((await sections(page))[0].line.b, b0);
    // Переименование и глубина — в «Свойствах».
    await page.mouse.click(q.x, q.y);
    await page.fill('#secName', 'Разрез А');
    await page.press('#secName', 'Enter');
    await page.waitForFunction(() => window.__kepler.state.project.views.find((v) => v.kind === 'section').name === 'Разрез А');
    await page.fill('#secDepth', '1500');
    await page.press('#secDepth', 'Enter');
    await page.waitForFunction(() => window.__kepler.state.project.views.find((v) => v.kind === 'section').depth === 1500);
    await page.click('[data-sec-scale="50"]');
    assert.equal((await sections(page))[0].scale, 50);
    await page.click('#propsTabViews');
    assert.deepEqual(await page.$$eval('[data-vt-group="sections"] .vt-name', (ns) => ns.map((n) => n.textContent)), ['Разрез А']);
    await page.click('#propsTabMain');
    assert.deepEqual(app.errors, []);
  });

  it('файл хранит разрез; на другом этаже линия тонкая', async () => {
    const { page } = app;
    const text = await st(page, async () => (await import('./core/model.js')).serializeProject(window.__kepler.state.project));
    await page.keyboard.press('Escape');
    await uploadText(page, '#fileInput', 'section.kepler.json', text);
    await page.waitForFunction(() => window.__kepler.state.project.views?.some((v) => v.kind === 'section' && v.name === 'Разрез А'));
    const v = (await sections(page))[0];
    assert.equal(v.depth, 1500);
    assert.equal(v.scale, 50);
    // Новый этаж: линия первого этажа — не жирная.
    await st(page, async () => {
      const lv = await import('./ui/levels.js');
      lv.addLevel();
    });
    await page.waitForFunction(() => {
      const s = window.__kepler.state;
      return s.project.levels.length > 1 && s.project.activeLevel !== s.project.levels[0].id;
    });
    await st(page, () => window.__kepler.requestDraw?.());
    await page.waitForTimeout(100);
    assert.deepEqual(await st(page, () => window.__kepler.state.planSectionsDrawn), [{ id: v.id, bold: false }]);
    await st(page, async () => {
      const lv = await import('./ui/levels.js');
      lv.switchLevel(window.__kepler.state.project.levels[0].id);
    });
    await page.waitForTimeout(100);
    assert.deepEqual(await st(page, () => window.__kepler.state.planSectionsDrawn), [{ id: v.id, bold: true }]);
    assert.deepEqual(app.errors, []);
  });

  it('удаление (Del и кнопка), Ctrl+Z возвращает', async () => {
    const { page } = app;
    const l = (await sections(page))[0].line;
    const q = await planClient(page, l.a.x + (l.b.x - l.a.x) * 0.3, l.a.y + (l.b.y - l.a.y) * 0.3);
    await page.mouse.click(q.x, q.y);
    assert.equal(await st(page, () => window.__kepler.state.selection?.type), 'section');
    await page.keyboard.press('Delete');
    assert.equal((await sections(page)).length, 0);
    await page.keyboard.press('Control+z');
    assert.equal((await sections(page)).length, 1);
    await page.mouse.click(q.x, q.y);
    await page.click('#secDelete');
    assert.equal((await sections(page)).length, 0);
    assert.deepEqual(app.errors, []);
  });
});

describe('разрез — телефон', () => {
  let app;
  before(async () => { app = await startApp({ mobile: true }); await openSample(app.page); });
  after(async () => { await app?.close(); });

  it('инструмент доступен в строке инструментов; тапы рисуют разрез', async () => {
    const { page } = app;
    await page.locator('#sectionToolBtn').scrollIntoViewIfNeeded();
    assert.equal(await page.isVisible('#sectionToolBtn'), true);
    await page.tap('#sectionToolBtn');
    assert.equal(await st(page, () => window.__kepler.state.tool?.kind), 'psec');
    const b = await houseBox(page);
    const cy = (b.y0 + b.y1) / 2;
    const p1 = await planClient(page, b.x0 - 1000, cy);
    const p2 = await planClient(page, b.x1 + 1000, cy);
    const p3 = await planClient(page, (b.x0 + b.x1) / 2, b.y0);
    for (const p of [p1, p2, p3]) await page.touchscreen.tap(p.x, p.y);
    const secs = await sections(page);
    assert.equal(secs.length, 1);
    assert.deepEqual(app.errors, []);
  });
});
