// Лестница «ведёт на этаж» и проём в перекрытии: настройка в «Свойствах»
// лестницы (подъём по отметкам этажей), авто-проём на этаже выше, ручка
// стороны проёма реальной мышью (проём становится ручным), «Вернуть авто»,
// вырез перекрытия и пола в 3D. Снимки — в KEPLER_SHOTS (если задан).
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { startApp, openNew } from './helpers.mjs';

const SHOTS = process.env.KEPLER_SHOTS || '';
const shot = async (page, name, opts = {}) => {
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, name), ...opts });
};

describe('лестница на второй этаж: проём в перекрытии', () => {
  let app;
  before(async () => {
    app = await startApp({ width: 1400, height: 900 });
    app.page.on('dialog', (d) => d.accept());
    await openNew(app.page);
  });
  after(async () => { await app?.close(); });

  const stair = () => app.page.evaluate(() => {
    const l = window.__kepler.state.project.levels.find((x) => x.items.some((i) => i.kind === 'stairs'));
    return l ? JSON.parse(JSON.stringify(l.items.find((i) => i.kind === 'stairs'))) : null;
  });
  const openings = (levelId) => app.page.evaluate(async (id) => {
    const m = await import('./core/slab-openings.js');
    return m.slabOpenings(window.__kepler.state.project, id);
  }, levelId);
  // Вид: центр проёма в центре холста, масштаб крупный.
  const focus = (o) => app.page.evaluate(async (r) => {
    const v = await import('./ui/view.js');
    const st = window.__kepler.state;
    st.view.scale = 0.09;
    const s = v.planToScreen(r.x + r.w / 2, r.y + r.h / 2);
    const c = document.getElementById('canvas');
    st.view.panX += c.clientWidth / 2 - s.x;
    st.view.panY += c.clientHeight / 2 - s.y;
    v.requestDraw();
  }, o);
  const slabHandle = async (id) => {
    await app.page.waitForTimeout(120);
    const box = await (await app.page.$('#canvas')).boundingBox();
    const h = await app.page.evaluate((hid) => {
      const r = (window.__kepler.state._slabUI || []).find((x) => x.handles);
      return r?.handles.find((x) => x.id === hid)?.s || null;
    }, id);
    assert.ok(h, `ручка ${id} нарисована`);
    return { x: box.x + h.x, y: box.y + h.y };
  };
  const pxPerMm = () => app.page.evaluate(() => {
    const a = window.__kepler.planToScreen(0, 0); const b = window.__kepler.planToScreen(1000, 0);
    return Math.hypot(b.x - a.x, b.y - a.y) / 1000;
  });

  let L1; let L2;

  it('лестница П на первом этаже и второй этаж на отметке +3,30', async () => {
    const { page } = app;
    await page.click('#stairsToolBtn');
    await page.selectOption('#toStairShape', 'u');
    const c = await page.$eval('#canvas', (n) => { const r = n.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
    await page.mouse.move(c.x, c.y);
    await page.mouse.click(c.x, c.y);
    await page.waitForFunction(() => window.__kepler.state.project.items.some((i) => i.kind === 'stairs'));
    await page.keyboard.press('Escape');
    await page.click('#levelBar button.add');
    const ids = await page.evaluate(async () => {
      const st = window.__kepler.state;
      const { mutate } = await import('./ui/store.js');
      const { createRoom } = await import('./core/model.js');
      const [a, b] = [...st.project.levels].sort((x, y) => x.elevation - y.elevation);
      const s = a.items.find((i) => i.kind === 'stairs');
      // Холл второго этажа над лестницей; отметка этажа +3,30 м.
      mutate(() => {
        b.elevation = 3300;
        b.rooms.push(createRoom('hall', Math.round(s.x - 3000), Math.round(s.y - 3000), 6000, 6000));
      });
      return [a.id, b.id];
    });
    [L1, L2] = ids;
    // Авто-проём уже есть: по умолчанию лестница ведёт на ближайший этаж выше.
    const list = await openings(L2);
    assert.equal(list.length, 1);
    assert.equal(list[0].auto, true);
  });

  it('«Свойства» лестницы: «Ведёт на этаж» — 2 этаж, подъём по отметкам, ступени пересчитаны', async () => {
    const { page } = app;
    await page.click(`#levelBar button[data-level="${L1}"]`);
    const s0 = await stair();
    await page.evaluate((id) => window.__kepler.select({ type: 'item', id }), s0.id);
    assert.equal(await page.isVisible('#stairToLevel'), true, 'поле «Куда ведёт» в «Свойствах»');
    const opts = await page.$$eval('#stairToLevel option', (os) => os.map((o) => o.textContent));
    assert.ok(opts.some((t) => /2 этаж/.test(t)), opts.join(' | '));
    assert.ok(opts.some((t) => /Никуда/.test(t)));
    await page.selectOption('#stairToLevel', L2);
    const s = await stair();
    assert.equal(s.toLevel, L2);
    assert.equal(s.floorHeight, 3300, 'подъём — разница отметок');
    const calc = await page.evaluate(async () => {
      const m = await import('./core/stairs.js');
      const st = window.__kepler.state;
      return m.stairCalculation(st.project.items.find((i) => i.kind === 'stairs'));
    });
    assert.equal(calc.risers, 19, '3300 / 175 ≈ 19 подъёмов');
    assert.equal(await page.inputValue('#floorH'), '3300');
    assert.equal(await page.$eval('#floorH', (n) => n.readOnly), true, 'высота — по этажам, не вручную');
    assert.match(await page.textContent('#stairToLevelHint'), /Подъём 3300 мм/);
    // Отметку этажа поменяли — подъём следует.
    await page.evaluate(async (id) => {
      const { mutate } = await import('./ui/store.js');
      mutate(() => { window.__kepler.state.project.levels.find((l) => l.id === id).elevation = 3000; });
    }, L2);
    assert.equal((await stair()).floorHeight, 3000);
    await page.evaluate(async (id) => {
      const { mutate } = await import('./ui/store.js');
      mutate(() => { window.__kepler.state.project.levels.find((l) => l.id === id).elevation = 3300; });
    }, L2);
    await page.evaluate((id) => window.__kepler.select({ type: 'item', id }), s0.id);
    await focus(await openings(L2).then((l) => l[0]));
    await page.waitForTimeout(150);
    await shot(page, 'stair-props.png');
  });

  it('«Показать проём»: этаж выше, проём выделен, подпись на плане', async () => {
    const { page } = app;
    await page.click('#stairShowHole');
    const st = await page.evaluate(() => ({ active: window.__kepler.state.project.activeLevel, sel: window.__kepler.state.selection }));
    assert.equal(st.active, L2);
    assert.equal(st.sel.type, 'slab');
    assert.match(st.sel.id, /^auto:/);
    const [o] = await openings(L2);
    await focus(o);
    await page.waitForTimeout(120);
    const ui = await page.evaluate(() => window.__kepler.state._slabUI.map((r) => ({ id: r.id, label: Boolean(r.label), handles: r.handles?.length || 0 })));
    assert.deepEqual(ui, [{ id: o.id, label: true, handles: 8 }]);
    assert.match(await page.textContent('#propsPanel'), /Проём в перекрытии/);
    assert.match(await page.textContent('#propsPanel'), /авто по лестнице/);
  });

  it('ручка правой стороны: проём шире, становится ручным; «Вернуть авто» — снова по лестнице', async () => {
    const { page } = app;
    const [o] = await openings(L2);
    const p = await slabHandle('e');
    const k = await pxPerMm();
    await page.mouse.move(p.x, p.y);
    await page.mouse.down();
    for (let i = 1; i <= 6; i += 1) await page.mouse.move(p.x + k * 600 * (i / 6), p.y);
    await page.mouse.up();
    await page.waitForTimeout(80);
    let [m] = await openings(L2);
    assert.equal(m.auto, false, 'после правки — ручной');
    assert.ok(Math.abs(m.w - (o.w + 600)) <= 60, `ширина ${m.w}, было ${o.w}`);
    assert.equal(m.x, o.x, 'левая сторона на месте');
    assert.equal(await page.evaluate(() => window.__kepler.state.selection.id), m.id, 'выбор перешёл на ручной проём');
    assert.match(await page.textContent('#propsPanel'), /ручной/);
    // Отмена — одним шагом.
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(80);
    assert.equal((await openings(L2))[0].auto, true, 'Ctrl+Z — снова авто');
    await page.keyboard.press('Control+y');
    await page.waitForTimeout(80);
    [m] = await openings(L2);
    assert.equal(m.auto, false);
    await page.evaluate((id) => window.__kepler.select({ type: 'slab', levelId: window.__kepler.state.project.activeLevel, id }), m.id);
    await page.click('#slabAuto');
    assert.equal((await openings(L2))[0].auto, true, '«Вернуть авто по лестнице»');
    // Снова расширить (для 3D и снимка).
    await focus((await openings(L2))[0]);
    const p2 = await slabHandle('e');
    await page.mouse.move(p2.x, p2.y);
    await page.mouse.down();
    for (let i = 1; i <= 6; i += 1) await page.mouse.move(p2.x + k * 600 * (i / 6), p2.y);
    await page.mouse.up();
    await page.waitForTimeout(150);
    await shot(page, 'plan-level2-opening.png');
  });

  it('этаж ниже: проём над головой — тонкий штрих; 3D: перекрытие и пол вырезаны', async () => {
    const { page } = app;
    const [m] = await openings(L2);
    await page.click(`#levelBar button[data-level="${L1}"]`);
    await page.waitForTimeout(100);
    await shot(page, 'plan-level1-below.png');
    await page.click('#view3dBtn');
    await page.waitForTimeout(200);
    const c = await page.evaluate((r) => window.__kepler.covered3d(r.x + r.w / 2, r.y + r.h / 2), m);
    assert.equal(c.slab, 0, 'в проёме перекрытия нет');
    assert.ok(!c.floor.includes(L2), 'пола второго этажа в проёме нет');
    const wide = await page.evaluate((r) => window.__kepler.covered3d(r.x + r.w - 200, r.y + r.h / 2), m);
    assert.equal(wide.slab, 0, 'расширенная часть тоже вырезана');
    const outside = await page.evaluate((r) => window.__kepler.covered3d(r.x + r.w + 500, r.y + r.h / 2), m);
    assert.ok(outside.floor.includes(L2), 'рядом пол второго этажа есть');
    // Вид сверху-сбоку на проём.
    const box = await (await page.$('#canvas3d')).boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 120, { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(200);
    await shot(page, '3d-opening.png');
    await page.keyboard.press('Escape');
  });

  it('без ошибок в консоли', () => {
    assert.deepEqual(app.errors, []);
  });
});
