// e2e: магнит масс в 3D реальной мышью — гизмо-стрелка X встаёт вплотную к
// соседней массе (разница ровно 0), подпись и подсветка, гистерезис и отрыв,
// квадрат XY по двум осям, Z — стопка на верх чужой массы, отметка этажа и
// земля, точка размера к грани соседа, Shift и флажок «Магнит масс»
// отключают, Ctrl+Z одним шагом, создание с тем же магнитом, сохранение.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { clickToolbarTool, startApp, openNew } from './helpers.mjs';

const d3 = (page) => page.evaluate(() => window.__kepler.debug3d());
const masses = (page) => page.evaluate(() => window.__kepler.state.project.masses || []);
const sc = (page, p) => page.evaluate((q) => window.__kepler.screen3d(q), p);
const box = (m) => ({ x0: m.x - m.w / 2, x1: m.x + m.w / 2, y0: m.y - m.d / 2, y1: m.y + m.d / 2, z0: m.z0, z1: m.z0 + m.h });
const byName = async (page, name) => (await masses(page)).find((m) => m.name === name);
const shots = process.env.KEPLER_MASS_SHOTS;

async function select(page, id) {
  await page.evaluate(async (q) => {
    (await import('./ui/tools.js')).selectObject({ type: 'mass', id: q });
  }, id);
  await page.waitForTimeout(30);
}

const partAt = (page, p) => page.evaluate(async (q) => {
  const at = (await import('./ui/mass3d.js')).massPartAt({ clientX: q.x, clientY: q.y, pointerType: 'mouse' });
  return at ? at.part : null;
}, p);

// Жест: мышь вниз в a, затем по точкам list; check(i, debug3d) после каждой.
async function gesture(page, a, list, check, { shift = false } = {}) {
  await page.mouse.move(a.x, a.y, { steps: 2 });
  await page.mouse.down();
  if (shift) await page.keyboard.down('Shift');
  for (let i = 0; i < list.length; i += 1) {
    await page.mouse.move(list[i].x, list[i].y, { steps: 5 });
    if (check) await check(i, await d3(page));
  }
  if (shift) await page.keyboard.up('Shift');
  await page.mouse.up();
}

// Начало стрелки или квадрата гизмо и экранные точки для сдвигов (мм).
async function gizmoPath(page, axis, shifts) {
  const s = await d3(page);
  const g = s.mass.gizmo;
  const a = axis === 'xy'
    ? { x: g.plane.reduce((t, p) => t + p.x, 0) / 4, y: g.plane.reduce((t, p) => t + p.y, 0) / 4 }
    : { x: g.origin.x + (g.tips[axis].x - g.origin.x) * 0.7, y: g.origin.y + (g.tips[axis].y - g.origin.y) * 0.7 };
  assert.equal(await partAt(page, a), `g${axis}`);
  const id = (await page.evaluate(() => window.__kepler.state.selection)).id;
  const m = (await masses(page)).find((q) => q.id === id);
  const c = { x: m.x, y: m.y, z: m.z0 + m.h / 2 };
  const o = await sc(page, c);
  const pts = [];
  for (const sh of shifts) {
    const t = await sc(page, { x: c.x + (sh.x || 0), y: c.y + (sh.y || 0), z: c.z + (sh.z || 0) });
    pts.push({ x: a.x + t.x - o.x, y: a.y + t.y - o.y });
  }
  return { a, pts, tol: s.mass.snapTol };
}

describe('Массы: магнит в 3D', () => {
  let app;
  let A; let B; let E; let F;
  before(async () => {
    app = await startApp({ width: 1440, height: 860 });
    await openNew(app.page);
    await app.page.click('#view3dBtn');
    // A: x 0…8000, y 0…5000, z 0…3500; B: x 10000…16000, y 0…6000, z 0…6000;
    // E: над B, z 7000…9000; F: вдали, z 0…2000.
    await app.page.evaluate(async () => {
      const { createMass } = await import('./core/masses.js');
      const { addMass } = await import('./ui/masses.js');
      const list = [];
      for (const o of [
        { x: 4000, y: 2500, w: 8000, d: 5000, h: 3500 },
        { x: 13000, y: 3000, w: 6000, d: 6000, h: 6000 },
        { x: 13000, y: 3000, w: 3000, d: 3000, z0: 7000, h: 2000 },
        { x: 4000, y: 16000, w: 3000, d: 3000, h: 2000 },
      ]) list.push(addMass(createMass(o, [...window.__kepler.state.project.masses || [], ...list])));
    });
    await app.page.click('#v3Fit');
    await app.page.waitForTimeout(100);
    [A, B, E, F] = await masses(app.page);
  });
  after(async () => { await app?.close(); });

  it('флажок «Магнит масс» в панели 3D, по умолчанию включён', async () => {
    const { page } = app;
    assert.ok(await page.isVisible('#v3MassSnapWrap'));
    assert.equal(await page.isChecked('#v3MassSnap'), true);
    assert.equal((await d3(page)).mass.magnet, true);
  });

  it('стрелка X: в радиусе — вплотную (ровно 0), подпись и подсветка; гистерезис; за радиусом — отрыв', async () => {
    const { page } = app;
    await select(page, A.id);
    const tol = (await d3(page)).mass.snapTol.x;
    assert.ok(tol.tol >= 20 && tol.tol <= 600, `радиус ${tol.tol}`);
    assert.ok(tol.release > tol.tol);
    const gap = 2000; // A.x1 = 8000, B.x0 = 10000
    const { a, pts } = await gizmoPath(page, 'x', [
      { x: gap - tol.tol * 0.5 }, // в радиусе — прилипла
      { x: gap - (tol.tol + tol.release) / 2 }, // между радиусами — держит
      { x: gap - tol.release * 1.6 - 100 }, // за отрывом — свободна
      { x: gap - tol.tol * 0.4 }, // снова в радиусе
    ]);
    await gesture(page, a, pts, async (i, s) => {
      if (i === 0 || i === 1 || i === 3) {
        assert.ok(s.mass.snap, `магнит на шаге ${i}`);
        assert.equal(s.mass.snap.kind, 'face');
        assert.equal(s.mass.snap.target, B.id);
        assert.match(s.label, /к грани «Масса 2»/);
        assert.match(await page.textContent('#v3Hint'), /Магнит: к грани «Масса 2»/);
        const m = await byName(page, 'Масса 1');
        assert.equal(box(m).x1, box(B).x0, 'вплотную, без зазора');
        if (i === 0 && shots) await page.screenshot({ path: `${shots}/mass-snap-face.png` });
      } else {
        assert.equal(s.mass.snap, null, 'оторвалась');
        assert.notEqual(box(await byName(page, 'Масса 1')).x1, box(B).x0);
      }
    });
    const m = await byName(page, 'Масса 1');
    assert.equal(box(m).x1, 10000);
    assert.deepEqual([m.y, m.z0, m.w, m.d, m.h], [A.y, A.z0, A.w, A.d, A.h]);
    assert.equal((await d3(page)).mass.snap, null, 'после жеста подсветки нет');
    // Ctrl+Z — одним шагом.
    await page.keyboard.press('Control+z');
    assert.equal((await byName(page, 'Масса 1')).x, A.x);
    await page.keyboard.press('Control+y');
    assert.equal(box(await byName(page, 'Масса 1')).x1, 10000);
    await page.keyboard.press('Control+z');
  });

  it('Shift и флажок выключают магнит', async () => {
    const { page } = app;
    await select(page, A.id);
    const tol = (await d3(page)).mass.snapTol.x;
    let g = await gizmoPath(page, 'x', [{ x: 2000 - tol.tol * 0.5 }]);
    await gesture(page, g.a, g.pts, async (_i, s) => assert.equal(s.mass.snap, null), { shift: true });
    assert.notEqual(box(await byName(page, 'Масса 1')).x1, 10000);
    await page.keyboard.press('Control+z');
    assert.equal((await byName(page, 'Масса 1')).x, A.x);
    // Флажок «Магнит масс» — выкл (запоминается), жест не липнет.
    await select(page, A.id);
    await page.uncheck('#v3MassSnap');
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('kepler-3d-layers')).massSnap), false);
    g = await gizmoPath(page, 'x', [{ x: 2000 - tol.tol * 0.5 }]);
    await gesture(page, g.a, g.pts, async (_i, s) => assert.equal(s.mass.snap, null));
    assert.notEqual(box(await byName(page, 'Масса 1')).x1, 10000);
    await page.keyboard.press('Control+z');
    await page.check('#v3MassSnap');
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('kepler-3d-layers')).massSnap), true);
    // Слои 3D (флажок «Мебель») не затирают магнит.
    await page.uncheck('#v3Furniture');
    await page.check('#v3Furniture');
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('kepler-3d-layers')).massSnap), true);
  });

  it('квадрат XY: липнет по двум осям независимо', async () => {
    const { page } = app;
    await select(page, A.id);
    const tol = (await d3(page)).mass.snapTol;
    const k = Math.min(tol.x.tol, tol.y.tol) * 0.4;
    // x: A.x1 8000 → B.x0 10000 (вплотную); y: A.y1 5000 → B.y1 6000 (заподлицо).
    const g = await gizmoPath(page, 'xy', [{ x: 2000 - k, y: 1000 + k }]);
    await gesture(page, g.a, g.pts, async (_i, s) => {
      assert.equal(s.mass.snap?.count, 2, 'две цели');
      assert.match(s.label, /к грани «Масса 2», заподлицо с «Масса 2»/);
    });
    const b = box(await byName(page, 'Масса 1'));
    assert.deepEqual([b.x1, b.y1, b.z0], [10000, 6000, 0]);
    await page.keyboard.press('Control+z');
  });

  it('Z: стопка на верх чужой массы, отметка этажа, земля', async () => {
    const { page } = app;
    // E (низ 7000) над B (верх 6000) — вниз почти на 1000: низ = 6000.
    await select(page, E.id);
    let tol = (await d3(page)).mass.snapTol.z;
    let g = await gizmoPath(page, 'z', [{ z: -1000 + tol.tol * 0.4 }]);
    await gesture(page, g.a, g.pts, async (_i, s) => {
      assert.equal(s.mass.snap?.kind, 'face');
      assert.match(s.label, /на «Масса 2»/);
      if (shots) await page.screenshot({ path: `${shots}/mass-snap-stack.png` });
    });
    assert.equal((await byName(page, 'Масса 3')).z0, 6000);
    // F (вдали): вверх почти на 3000 — низ на отметку этажа 3000.
    const lv = await page.evaluate(() => window.__kepler.state.project.levels.map((l) => [l.elevation, l.height]));
    const top = lv[0][0] + lv[0][1];
    await select(page, F.id);
    tol = (await d3(page)).mass.snapTol.z;
    g = await gizmoPath(page, 'z', [{ z: top - tol.tol * 0.4 }]);
    await gesture(page, g.a, g.pts, async (_i, s) => {
      assert.equal(s.mass.snap?.kind, 'level');
      assert.match(s.label, new RegExp(`отметка ${top}`));
    });
    assert.equal((await byName(page, 'Масса 4')).z0, top);
    // Обратно почти до земли — на землю (низ ровно 0).
    await select(page, F.id);
    g = await gizmoPath(page, 'z', [{ z: -top + tol.tol * 0.4 }]);
    await gesture(page, g.a, g.pts, async (_i, s) => {
      assert.equal(s.mass.snap?.kind, 'ground');
      assert.match(s.label, /на землю/);
    });
    assert.equal((await byName(page, 'Масса 4')).z0, 0);
  });

  it('точка размера центра грани липнет к грани соседа; размер в подписи', async () => {
    const { page } = app;
    await select(page, A.id);
    const s0 = await d3(page);
    const tol = s0.mass.snapTol.x;
    const h = s0.mass.handles.px;
    assert.equal(await partAt(page, h), 'px');
    const m = await byName(page, 'Масса 1');
    const o = await sc(page, { x: box(m).x1, y: m.y, z: m.z0 + m.h / 2 });
    const t = await sc(page, { x: 10000 - tol.tol * 0.4, y: m.y, z: m.z0 + m.h / 2 });
    await gesture(page, h, [{ x: h.x + t.x - o.x, y: h.y + t.y - o.y }], async (_i, s) => {
      assert.equal(s.mass.snap?.kind, 'face');
      assert.match(s.label, /^10000 × 5000 × 3500 мм · к грани «Масса 2»/);
      if (shots) await page.screenshot({ path: `${shots}/mass-snap-handle.png` });
    });
    const b = box(await byName(page, 'Масса 1'));
    assert.deepEqual([b.x0, b.x1], [0, 10000]);
    await page.keyboard.press('Control+z');
    assert.equal(box(await byName(page, 'Масса 1')).x1, 8000);
  });

  it('создание: угол основания липнет к грани массы', async () => {
    const { page } = app;
    await clickToolbarTool(page, 'massToolBtn');
    const a = await sc(page, { x: 19000, y: 1000, z: 0 });
    await page.mouse.move(a.x, a.y, { steps: 3 });
    await page.mouse.click(a.x, a.y);
    assert.equal((await d3(page)).mass.stage, 'base');
    const tol = (await d3(page)).mass.snapTol;
    assert.equal(tol, null);
    const b = await sc(page, { x: 16000 + 60, y: 4000, z: 0 });
    await page.mouse.move(b.x, b.y, { steps: 4 });
    const s = await d3(page);
    assert.equal(s.mass.b.x, 16000);
    assert.match(s.label, /по грани «Масса 2»|к грани «Масса 2»/);
    await page.keyboard.press('Escape'); // стадия назад
    await page.keyboard.press('Escape'); // выйти из инструмента
    assert.equal((await d3(page)).mass.tool, false);
  });

  it('сохранение и загрузка: координаты вплотную сохраняются', async () => {
    const { page } = app;
    await select(page, A.id);
    const tol = (await d3(page)).mass.snapTol.x;
    const g = await gizmoPath(page, 'x', [{ x: 2000 - tol.tol * 0.3 }]);
    await gesture(page, g.a, g.pts);
    const before = await masses(page);
    const after = await page.evaluate(async () => {
      const { serializeProject } = await import('./core/model.js');
      const store = await import('./ui/store.js');
      store.restoreFrom(serializeProject(window.__kepler.state.project));
      return window.__kepler.state.project.masses;
    });
    assert.deepEqual(after, before);
    assert.equal(box(after[0]).x1, box(after[1]).x0);
    assert.deepEqual(app.errors, []);
  });
});
