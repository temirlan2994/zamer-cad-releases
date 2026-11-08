// e2e: массы (концептуальная форма) — создание и правка боксов в 3D
// реальной мышью, числовой ввод, Esc по стадиям, масса на грани другой,
// тяни-толкай граней, перенос с Alt, Delete, Ctrl+Z/Y, копия; эскиз на
// плане и его настройка, магнит комнаты к ребру эскиза, сохранение и
// загрузка, создание двумя кликами на плане.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, openNew, worldToClient } from './helpers.mjs';

const d3 = (page) => page.evaluate(() => window.__kepler.debug3d());
const masses = (page) => page.evaluate(() => window.__kepler.state.project.masses || []);
const sel = (page) => page.evaluate(() => window.__kepler.state.selection);
const sc = (page, p) => page.evaluate((q) => window.__kepler.screen3d(q), p);
const dims = (m) => [m.x, m.y, m.w, m.d, m.z0, m.h];

async function clickAt(page, p) {
  const s = await sc(page, p);
  await page.mouse.move(s.x, s.y, { steps: 4 });
  await page.mouse.click(s.x, s.y);
  return s;
}

async function dragFace(page, from, to, { alt = false } = {}) {
  const a = await sc(page, from);
  const b = await sc(page, to);
  await page.mouse.move(a.x, a.y);
  if (alt) await page.keyboard.down('Alt');
  await page.mouse.down();
  await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 4 });
  await page.mouse.move(b.x, b.y, { steps: 4 });
  await page.mouse.up();
  if (alt) await page.keyboard.up('Alt');
}

describe('Массы: создание и правка в 3D, эскиз на плане', () => {
  let app;
  before(async () => {
    app = await startApp({ width: 1440, height: 860 });
    await openNew(app.page);
    await app.page.click('#view3dBtn');
  });
  after(async () => { await app?.close(); });

  it('кнопка «Масса» в колонке, подсказка, клавиша M', async () => {
    const { page } = app;
    assert.ok(await page.isVisible('#massToolBtn'));
    assert.match(await page.textContent('#tbTip-mass'), /Масса/);
    await page.keyboard.press('KeyM');
    assert.equal((await d3(page)).mass.tool, true);
    assert.match(await page.textContent('#v3Hint'), /клик — угол/);
    await page.keyboard.press('KeyM');
    assert.equal((await d3(page)).mass.tool, false);
    await page.click('#massToolBtn');
    assert.equal((await d3(page)).mass.tool, true);
    assert.ok(await page.$eval('#massToolBtn', (b) => b.classList.contains('active')));
  });

  it('клик — угол, клик — угол, вверх — высота, клик — масса создана и выбрана', async () => {
    const { page } = app;
    await clickAt(page, { x: 0, y: 0, z: 0 });
    assert.equal((await d3(page)).mass.stage, 'base');
    const b = await sc(page, { x: 8000, y: 5000, z: 0 });
    await page.mouse.move(b.x, b.y, { steps: 6 });
    const s = await d3(page);
    assert.deepEqual(s.mass.b, { x: 8000, y: 5000 });
    assert.match(s.label, /8000 × 5000 мм/);
    await page.mouse.click(b.x, b.y);
    assert.equal((await d3(page)).mass.stage, 'height');
    const top = await sc(page, { x: 8000, y: 5000, z: 6000 });
    await page.mouse.move(b.x, top.y, { steps: 6 });
    assert.match((await d3(page)).label, /6000 мм · ≈ 2 этажа/);
    await page.mouse.click(b.x, top.y);
    const list = await masses(page);
    assert.equal(list.length, 1);
    assert.deepEqual(dims(list[0]), [4000, 2500, 8000, 5000, 0, 6000]);
    assert.equal(list[0].name, 'Масса 1');
    assert.deepEqual(await sel(page), { type: 'mass', id: list[0].id });
    assert.equal((await d3(page)).mass.stage, 'corner', 'инструмент остаётся для серии');
    assert.equal((await d3(page)).masses, 1);
    assert.ok(await page.isVisible('#v3MassesWrap'));
  });

  it('Esc — стадия назад; числа: ширина → Tab → глубина → Enter → высота → Enter', async () => {
    const { page } = app;
    await clickAt(page, { x: 12000, y: 0, z: 0 });
    assert.equal((await d3(page)).mass.stage, 'base');
    await page.keyboard.press('Escape');
    assert.equal((await d3(page)).mass.stage, 'corner');
    assert.equal((await d3(page)).mass.tool, true);
    await clickAt(page, { x: 12000, y: 0, z: 0 });
    const c = await sc(page, { x: 14000, y: 2000, z: 0 });
    await page.mouse.move(c.x, c.y, { steps: 4 });
    await page.keyboard.press('6');
    assert.equal((await d3(page)).mass.num, 'w');
    await page.keyboard.type('000');
    await page.keyboard.press('Tab');
    assert.equal((await d3(page)).mass.num, 'd');
    await page.keyboard.type('4000');
    await page.keyboard.press('Enter');
    assert.equal((await d3(page)).mass.stage, 'height');
    assert.equal((await d3(page)).mass.num, 'h');
    await page.keyboard.press('Enter'); // высота по умолчанию 3000
    const list = await masses(page);
    assert.equal(list.length, 2);
    assert.deepEqual(dims(list[1]), [15000, 2000, 6000, 4000, 0, 3000]);
  });

  it('масса на верхней грани другой: низ = верх', async () => {
    const { page } = app;
    const a = await sc(page, { x: 1000, y: 1000, z: 6000 });
    await page.mouse.move(a.x, a.y, { steps: 4 });
    assert.match((await d3(page)).label || '', /на «Масса 1»/);
    await page.mouse.click(a.x, a.y);
    assert.equal((await d3(page)).mass.z, 6000);
    const b = await sc(page, { x: 4000, y: 4000, z: 6000 });
    await page.mouse.move(b.x, b.y, { steps: 4 });
    await page.mouse.click(b.x, b.y);
    const t = await sc(page, { x: 4000, y: 4000, z: 9000 });
    await page.mouse.move(b.x, t.y, { steps: 4 });
    await page.mouse.click(b.x, t.y);
    const m = (await masses(page))[2];
    assert.deepEqual(dims(m), [2500, 2500, 3000, 3000, 6000, 3000]);
    // Удалить — Delete (масса выбрана), выйти из инструмента — Esc.
    await page.keyboard.press('Escape');
    assert.equal((await d3(page)).mass.tool, false);
    await page.keyboard.press('Delete');
    assert.equal((await masses(page)).length, 2);
  });

  it('правка: верх — высота, бок — размер, Alt — перенос; Ctrl+Z/Y; копия', async () => {
    const { page } = app;
    const m1 = (await masses(page))[0];
    // Клик по массе (под курсором только она) — выбор.
    await clickAt(page, { x: 4000, y: 2500, z: 6000 });
    assert.deepEqual(await sel(page), { type: 'mass', id: m1.id });
    assert.match(await page.textContent('#propsBody'), /Масса[\s\S]*Объём/);
    await dragFace(page, { x: 4000, y: 2500, z: 6000 }, { x: 4000, y: 2500, z: 7000 });
    let m = (await masses(page))[0];
    assert.deepEqual([m.z0, m.h], [0, 7000]);
    // Бок py (виден с камеры по умолчанию): глубина растёт, грань y = 0 стоит.
    await dragFace(page, { x: 4000, y: 5000, z: 3000 }, { x: 4000, y: 6000, z: 3000 });
    m = (await masses(page))[0];
    assert.deepEqual([m.y - m.d / 2, m.y + m.d / 2], [0, 6000]);
    // Alt + тянуть — перенос по плоскости основания.
    await dragFace(page, { x: 4000, y: 3000, z: 7000 }, { x: 6000, y: 3000, z: 7000 }, { alt: true });
    m = (await masses(page))[0];
    assert.deepEqual([m.x, m.y, m.w, m.d, m.h], [6000, 3000, 8000, 6000, 7000]);
    await page.keyboard.press('Control+z');
    m = (await masses(page))[0];
    assert.equal(m.x, 4000);
    await page.keyboard.press('Control+y');
    m = (await masses(page))[0];
    assert.equal(m.x, 6000);
    // Выбор после отмены снимается — выбираем снова и копируем.
    await clickAt(page, { x: 6000, y: 3000, z: 7000 });
    await page.keyboard.press('Control+d');
    const list = await masses(page);
    assert.equal(list.length, 3);
    assert.equal(list[2].name, 'Масса 3');
    assert.equal(list[2].x, 6000 + 8000 + 1000);
    await page.keyboard.press('Delete');
    assert.equal((await masses(page)).length, 2);
  });

  it('двойной клик по грани — точная высота', async () => {
    const { page } = app;
    await clickAt(page, { x: 6000, y: 3000, z: 7000 });
    const p = await sc(page, { x: 6000, y: 3000, z: 7000 });
    await page.mouse.dblclick(p.x, p.y);
    assert.equal((await d3(page)).mass.num, 'face');
    await page.fill('#v3MassNum', '6000');
    await page.keyboard.press('Enter');
    assert.equal((await masses(page))[0].h, 6000);
  });

  it('на плане — эскиз под домом; настройка «Показывать эскиз» выключает', async () => {
    const { page } = app;
    await page.click('#v3Close');
    await page.click('#fitBtn');
    await page.waitForTimeout(100);
    assert.equal(await page.evaluate(() => window.__kepler.state._planMasses), 2);
    // Пиксель внутри эскиза отличается от фона (заливка), снаружи — нет.
    const m = (await masses(page))[0];
    const inside = await worldToClient(page, ...(await page.evaluate(async (q) => {
      const v = await import('./ui/view.js');
      const w = v.planToWorld({ x: q.x, y: q.y });
      return [w.x, w.y];
    }, m)));
    const color = (x, y) => page.evaluate(([cx, cy]) => {
      const c = document.getElementById('canvas');
      const r = c.getBoundingClientRect();
      const k = c.width / r.width;
      return [...c.getContext('2d').getImageData(Math.round((cx - r.left) * k), Math.round((cy - r.top) * k), 1, 1).data];
    }, [x, y]);
    const on = await color(inside.x, inside.y);
    await page.evaluate(() => { window.__kepler.state.selection = null; });
    await page.evaluate(async () => {
      const pm = await import('./ui/plan-masses.js');
      pm.setPlanMassPref({ on: false });
      (await import('./ui/view.js')).requestDraw();
    });
    await page.waitForTimeout(100);
    assert.equal(await page.evaluate(() => window.__kepler.state._planMasses), 0);
    const off = await color(inside.x, inside.y);
    assert.notDeepEqual(on, off, 'заливка эскиза видна');
    await page.evaluate(async () => {
      const pm = await import('./ui/plan-masses.js');
      pm.setPlanMassPref({ on: true });
      (await import('./ui/view.js')).requestDraw();
      (await import('./ui/props.js')).renderProps();
    });
    await page.waitForTimeout(50);
    assert.equal(await page.evaluate(() => window.__kepler.state._planMasses), 2);
  });

  it('настройка в «Свойствах» вида: флажок эскиза', async () => {
    const { page } = app;
    await page.keyboard.press('Escape');
    await page.waitForSelector('#viewsMassOn');
    assert.equal(await page.isChecked('#viewsMassOn'), true);
    await page.uncheck('#viewsMassOn');
    await page.waitForTimeout(50);
    assert.equal(await page.evaluate(() => window.__kepler.state._planMasses), 0);
    await page.check('#viewsMassOn');
    await page.waitForTimeout(50);
    assert.equal(await page.evaluate(() => window.__kepler.state._planMasses), 2);
  });

  it('комната рядом с эскизом примагничивается к его ребру', async () => {
    const { page } = app;
    // Правое ребро второй массы (слева над холстом — библиотека помещений).
    const m = (await masses(page))[1];
    const x1 = m.x + m.w / 2;
    await page.evaluate(async () => (await import('./ui/tools.js')).startPlaceRoom('living'));
    await page.waitForTimeout(450); // библиотека выезжает
    const w = await page.evaluate(async () => (await import('./core/catalog.js')).roomType('living').w);
    // Центр призрака — так, чтобы правая грань была в 120 мм от ребра эскиза.
    const target = { x: x1 - 120 - w / 2, y: m.y };
    const wpt = await page.evaluate(async (q) => (await import('./ui/view.js')).planToWorld(q), target);
    const c = await worldToClient(page, wpt.x, wpt.y);
    await page.mouse.move(c.x, c.y, { steps: 3 });
    const ghost = await page.evaluate(() => window.__kepler.state.ghost?.rect);
    assert.ok(ghost, 'призрак комнаты');
    const exterior = await page.evaluate(() => window.__kepler.state.project.settings.exterior);
    const right = ghost.x + ghost.w;
    assert.ok([x1, x1 - exterior].includes(right), `грань ${right} у ребра ${x1}`);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(450);
  });

  it('сохранение и загрузка файла: массы на месте', async () => {
    const { page } = app;
    const before = await masses(page);
    const after = await page.evaluate(async () => {
      const { serializeProject } = await import('./core/model.js');
      const store = await import('./ui/store.js');
      const text = serializeProject(window.__kepler.state.project);
      store.restoreFrom(text);
      return { list: window.__kepler.state.project.masses, schema: JSON.parse(text).schema };
    });
    assert.equal(after.schema, 'kepler-plan/7');
    assert.deepEqual(after.list, before);
  });

  it('на плане два клика инструментом создают массу высотой 3000', async () => {
    const { page } = app;
    await page.click('#massToolBtn');
    const toClient = async (x, y) => {
      const wp = await page.evaluate(async (q) => (await import('./ui/view.js')).planToWorld(q), { x, y });
      return worldToClient(page, wp.x, wp.y);
    };
    const a = await toClient(12000, 5000);
    const b = await toClient(17000, 8000);
    await page.mouse.move(a.x, a.y, { steps: 2 });
    await page.mouse.click(a.x, a.y);
    await page.mouse.move(b.x, b.y, { steps: 4 });
    await page.mouse.click(b.x, b.y);
    const list = await masses(page);
    assert.equal(list.length, 3);
    const m = list[2];
    assert.deepEqual([m.w, m.d, m.h, m.z0], [5000, 3000, 3000, 0]);
    await page.keyboard.press('Escape');
    assert.deepEqual(app.errors, []);
  });
});
