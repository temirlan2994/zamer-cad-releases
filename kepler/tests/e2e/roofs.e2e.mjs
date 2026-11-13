// e2e: крыши-плиты (core/roofs.js) реальной мышью. Крыша — свой контур, без
// связи с помещениями; чертится и правится на «Плане крыши» (дерево видов):
// K на плане этажа открывает его с инструментом, клик по помещению
// подложки — крыша по его форме; на обычном плане крыша не рисуется и
// клики не ловит; на «Плане крыши» — перенос, ребро, вершина, деление ребра
// (Г-форма) и удаление вершины двойным кликом, Esc, Ctrl+Z, точка выноса;
// «Свойства» с карточками меняют 3D; в 3D инструмент накрывает помещение,
// точка выноса и стрелка Z тянутся, Delete; сохранение; фасад с выносом.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, openNew } from './helpers.mjs';

const SHOTS = process.env.KEPLER_SHOTS || '';
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` }); };

const st = (page, fn, arg) => page.evaluate(fn, arg);
const roofs = (page) => st(page, () => window.__kepler.state.project.roofs || []);
const sel = (page) => st(page, () => window.__kepler.state.selection);
const d3 = (page) => st(page, () => window.__kepler.debug3d());
const toClient = async (page, x, y) => {
  const box = await (await page.$('#canvas')).boundingBox();
  const s = await st(page, ([px, py]) => window.__kepler.planToScreen(px, py), [x, y]);
  return { x: box.x + s.x, y: box.y + s.y };
};
const handle = (page, id) => st(page, async (hid) => {
  const { roofHandles } = await import('./core/roofs.js');
  const s = window.__kepler.state;
  const roof = s.project.roofs.find((r) => r.id === s.selection.id);
  return roofHandles(s.project, roof).find((h) => h.id === hid);
}, id);
const box = (r) => {
  const xs = r.outline.map((q) => q.x); const ys = r.outline.map((q) => q.y);
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
};
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} ≈ ${b}`);

async function dragPlan(page, a, b, mid) {
  await page.mouse.move(a.x, a.y, { steps: 2 });
  await page.mouse.down();
  await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 4 });
  await page.mouse.move(b.x, b.y, { steps: 4 });
  if (mid) await mid();
  await page.mouse.up();
}

describe('Крыши-плиты: план крыши, правка контура, типы, 3D', () => {
  let app;
  before(async () => {
    app = await startApp({ width: 1440, height: 860 });
    await app.page.emulateMedia({ colorScheme: 'light' });
    await openNew(app.page);
    // Двухэтажный дом: внизу гостиная + кухня, наверху спальня над гостиной.
    await st(app.page, async () => {
      const m = await import('./core/model.js');
      const store = await import('./ui/store.js');
      const p = m.createProject('Крыши');
      const a = m.createRoom('living', 0, 0, 6000, 4000); a.id = 'a';
      const b = m.createRoom('kitchen', 6000, 0, 4000, 4000); b.id = 'b';
      p.rooms.push(a, b);
      const l2 = m.createLevel('2 этаж', 3000, 3000, 'L2');
      const c = m.createRoom('bedroom', 0, 0, 6000, 4000); c.id = 'c';
      l2.rooms.push(c);
      p.levels.push(l2);
      store.restoreFrom(m.serializeProject(p));
      window.__kepler.state.project.activeLevel = 'L1';
      (await import('./ui/levels.js')).switchLevel('L1');
      window.__kepler.fitView();
    });
  });
  after(async () => {
    assert.deepEqual(app.errors, []);
    await app?.close();
  });

  it('K на плане этажа — «План крыши» с инструментом; клик по помещению — крыша по его форме, без связи', async () => {
    const { page } = app;
    assert.ok(await page.isVisible('#roofToolBtn'));
    assert.match(await page.textContent('#tbTip-roof'), /План крыши/);
    await page.keyboard.press('KeyK');
    assert.equal(await st(page, () => window.__kepler.state.roofPlan), true);
    assert.equal(await st(page, () => window.__kepler.state.tool?.kind), 'roof');
    assert.ok(await page.$eval('#roofToolBtn', (b) => b.classList.contains('active')));
    const p = await toClient(page, 8000, 2000);
    await page.mouse.move(p.x, p.y, { steps: 3 });
    assert.deepEqual(await st(page, () => window.__kepler.state.tool.hover), { levelId: 'L1', roomId: 'b' });
    await page.mouse.click(p.x, p.y);
    const list = await roofs(page);
    assert.equal(list.length, 1);
    assert.equal(list[0].levelId, 'L1');
    assert.equal(list[0].roomIds, undefined, 'с помещением не связана');
    assert.deepEqual(box(list[0]), { x0: 5750, y0: -250, x1: 10250, y1: 4250 });
    assert.deepEqual(await sel(page), { type: 'roof', id: list[0].id });
    assert.equal(await st(page, () => window.__kepler.state.tool), null, 'крыша создана — инструмент выключен');
    assert.ok(await page.isVisible('#roofProps .roof-card'));
    assert.equal(await page.$('[data-roof-room]'), null, 'галочек помещений нет');
    await page.waitForFunction(() => window.__kepler.state._roofPlanDrawn === 1);
    await shot(page, 'roof-1-roofplan');
  });

  it('обычный план этажа: крыша не рисуется и не перехватывает мышь', async () => {
    const { page } = app;
    await st(page, async () => (await import('./ui/props-views.js')).openView('plan:L1'));
    assert.equal(await st(page, () => window.__kepler.state.roofPlan), false);
    await page.waitForFunction(() => window.__kepler.state._planRoofs === 0);
    // Зона выноса вне помещений: клик — не крыша.
    const z = await toClient(page, 10450, 2000);
    await page.mouse.move(z.x, z.y, { steps: 2 });
    assert.notEqual((await st(page, () => window.__kepler.state.hover))?.type, 'roof');
    await page.mouse.click(z.x, z.y);
    assert.notEqual((await sel(page))?.type, 'roof');
    // Кухня под крышей — выбирается сама кухня.
    const k = await toClient(page, 8000, 2000);
    await page.mouse.click(k.x, k.y);
    assert.deepEqual(await sel(page), { type: 'room', id: 'b' });
    await page.keyboard.press('Escape');
  });

  it('«План крыши»: перенос крыши, Ctrl+Z; ребро, деление ребра — Г-форма, удаление вершины; Esc отменяет жест', async () => {
    const { page } = app;
    await st(page, async () => (await import('./ui/props-views.js')).openView('roofplan'));
    assert.equal(await st(page, () => window.__kepler.state.roofPlan), true);
    // Зум ближе.
    await st(page, async () => {
      const s = window.__kepler.state;
      s.view.scale = 0.05;
      const c = document.getElementById('canvas');
      const q = window.__kepler.planToScreen(8000, 2000);
      s.view.panX += c.clientWidth / 2 - q.x;
      s.view.panY += c.clientHeight / 2 - q.y;
      (await import('./ui/view.js')).requestDraw();
    });
    const id = (await roofs(page))[0].id;
    const b0 = box((await roofs(page))[0]);
    // Клик по плите — выбор; перенос на 1 м вправо.
    const a = await toClient(page, 8000, 2000);
    const b = await toClient(page, 9000, 2000);
    let label = '';
    await dragPlan(page, a, b, async () => { label = await st(page, () => window.__kepler.state.roofLabel?.text || ''); });
    assert.deepEqual(await sel(page), { type: 'roof', id });
    assert.match(label, /сдвиг/);
    const b1 = box((await roofs(page))[0]);
    near(b1.x0 - b0.x0, 1000, 120, 'сдвиг x');
    assert.equal(b1.x1 - b1.x0, b0.x1 - b0.x0, 'форма та же');
    await page.keyboard.press('Control+z');
    assert.deepEqual(box((await roofs(page))[0]), b0);
    if ((await sel(page))?.type !== 'roof') await page.mouse.click(a.x, a.y);
    // Правое ребро (x = 10250) — на 2 м вправо.
    const e0 = await toClient(page, 10250, 2000);
    const e1 = await toClient(page, 12250, 2000);
    await dragPlan(page, e0, e1);
    let r = (await roofs(page))[0];
    near(box(r).x1, 12250, 150, 'правое ребро');
    assert.equal(box(r).x0, 5750, 'левое ребро на месте');
    assert.equal(r.outline.length, 4);
    // Esc во время жеста — контур не меняется.
    const before = JSON.stringify(r.outline);
    const t0 = await toClient(page, 8000, -250);
    const t1 = await toClient(page, 8000, -2000);
    await page.mouse.move(t0.x, t0.y, { steps: 2 });
    await page.mouse.down();
    await page.mouse.move(t1.x, t1.y, { steps: 5 });
    await page.keyboard.press('Escape');
    await page.mouse.up();
    assert.equal(JSON.stringify((await roofs(page))[0].outline), before, 'Esc — отмена жеста');
    // Двойной клик по нижнему ребру — деление; правая половина вниз — Г-форма.
    const x1 = box(r).x1;
    const split = await toClient(page, 8000, 4250);
    await page.mouse.dblclick(split.x, split.y);
    r = (await roofs(page))[0];
    assert.equal(r.outline.length, 6, 'деление ребра: две новые вершины');
    const midX = (8000 + x1) / 2;
    const h0 = await toClient(page, midX, 4250);
    const h1 = await toClient(page, midX, 6250);
    await dragPlan(page, h0, h1);
    r = (await roofs(page))[0];
    assert.equal(r.outline.length, 6, 'Г-форма');
    near(box(r).y1, 6250, 150, 'уступ вниз');
    await shot(page, 'roof-2-lshape');
    // Двойной клик по вогнутой вершине — удалить: снова прямоугольник.
    const inner = r.outline.find((q) => Math.abs(q.x - 8000) < 200 && Math.abs(q.y - 4250) < 5);
    assert.ok(inner, 'вогнутая вершина');
    const v = await toClient(page, inner.x, inner.y);
    await page.mouse.dblclick(v.x, v.y);
    r = (await roofs(page))[0];
    assert.equal(r.outline.length, 4, 'вершина удалена');
  });

  it('точка выноса тянет вынос от контура (подпись, Ctrl+Z)', async () => {
    const { page } = app;
    if ((await sel(page))?.type !== 'roof') {
      const p = await toClient(page, 8000, 2000);
      await page.mouse.click(p.x, p.y);
    }
    const h = await handle(page, 'w');
    const a = await toClient(page, h.x, h.y);
    const b = await toClient(page, h.x - 900, h.y);
    let label = '';
    await dragPlan(page, a, b, async () => { label = await st(page, () => window.__kepler.state.roofLabel?.text || ''); });
    assert.match(label, /вынос 1500 мм/);
    assert.equal((await roofs(page))[0].overhang.w, 1500);
    assert.equal((await roofs(page))[0].overhang.e, 600);
    await page.keyboard.press('Control+z');
    assert.equal((await roofs(page))[0].overhang.w, 600);
    await page.keyboard.press('Control+y');
    assert.equal((await roofs(page))[0].overhang.w, 1500);
    const p = await toClient(page, 8000, 2000);
    await page.mouse.click(p.x, p.y);
    assert.equal((await sel(page))?.type, 'roof');
  });

  it('«Свойства»: карточки края и парапета, материал, пресеты — меняют 3D', async () => {
    const { page } = app;
    await page.click('[data-roof-parapet="wall"]');
    assert.equal((await roofs(page))[0].parapet.type, 'wall');
    await page.click('[data-roof-edge="cornice"]');
    assert.equal((await roofs(page))[0].edge.type, 'cornice');
    await page.click('[data-roof-material="wood"]');
    assert.equal((await roofs(page))[0].material, 'wood');
    await shot(page, 'roof-3-props');
    await page.click('#view3dBtn');
    let s = await d3(page);
    assert.equal(s.roofs, 1);
    assert.ok(s.parapetFaces > 0);
    assert.ok(s.roofColors.includes('#a8794b'));
    await page.click('[data-roof-parapet="glass"]');
    s = await d3(page);
    assert.ok(s.parapetFaces > 0);
    await page.click('[data-roof-preset="modern"]');
    const r = (await roofs(page))[0];
    assert.deepEqual(r.overhang, { n: 1200, e: 1200, s: 1200, w: 1200 });
    assert.equal(r.edge.type, 'fascia');
    assert.equal(r.parapet.type, 'none');
    s = await d3(page);
    assert.equal(s.parapetFaces, 0);
    assert.ok(s.fasciaFaces > 0);
    assert.equal(s.roofTop, 3300);
  });

  it('3D: инструмент накрывает помещение кликом, точка выноса и стрелка Z тянутся, Delete', async () => {
    const { page } = app;
    await page.keyboard.press('KeyK');
    assert.equal((await d3(page)).roof3d.tool, true);
    const c = await st(page, () => window.__kepler.screen3d({ x: 3000, y: 2000, z: 3000 }));
    await page.mouse.move(c.x, c.y, { steps: 3 });
    assert.equal((await d3(page)).roof3d.toolHover?.roomId, 'c');
    await page.mouse.click(c.x, c.y);
    let list = await roofs(page);
    assert.equal(list.length, 2);
    const top = list[1];
    assert.equal(top.levelId, 'L2');
    assert.equal(top.roomIds, undefined);
    assert.deepEqual(box(top), { x0: -250, y0: -250, x1: 6250, y1: 4250 });
    assert.deepEqual(await sel(page), { type: 'roof', id: top.id });
    await page.keyboard.press('Escape');
    assert.equal((await d3(page)).roof3d.tool, false);
    assert.deepEqual(await sel(page), { type: 'roof', id: top.id }, 'Esc выходит из инструмента, выбор остаётся');
    await shot(page, 'roof-4-3d');
    // Точка e: тянем на 900 мм по плоскости плиты.
    let s = await d3(page);
    const a = s.roof3d.handles.e;
    assert.ok(a);
    const z1 = 6000 + 300;
    const from = await st(page, (p) => window.__kepler.screen3d(p), { x: 6850, y: 2000, z: z1 });
    const to = await st(page, (p) => window.__kepler.screen3d(p), { x: 6850 + 900, y: 2000, z: z1 });
    await dragPlan(page, a, { x: a.x + to.x - from.x, y: a.y + to.y - from.y });
    list = await roofs(page);
    assert.ok(Math.abs(list[1].overhang.e - 1500) <= 100, `вынос e ≈ 1500: ${list[1].overhang.e}`);
    // Стрелка Z: вверх на ~500 мм.
    s = await d3(page);
    const o = s.roof3d.zAxis.origin; const t = s.roof3d.zAxis.tip;
    const g = { x: o.x + (t.x - o.x) * 0.7, y: o.y + (t.y - o.y) * 0.7 };
    const z0s = await st(page, (p) => window.__kepler.screen3d(p), { x: 3000, y: 2000, z: z1 });
    const z5s = await st(page, (p) => window.__kepler.screen3d(p), { x: 3000, y: 2000, z: z1 + 500 });
    await page.keyboard.down('Shift');
    await dragPlan(page, g, { x: g.x + z5s.x - z0s.x, y: g.y + z5s.y - z0s.y });
    await page.keyboard.up('Shift');
    const dz = (await roofs(page))[1].dz;
    assert.ok(dz > 300 && dz < 700, `dz ≈ 500: ${dz}`);
    await page.keyboard.press('Control+z');
    assert.equal((await roofs(page))[1].dz, 0);
    // Клик по плите сверху выбирает крышу (отмена сняла выбор).
    const onTop = await st(page, (p) => window.__kepler.screen3d(p), { x: 3000, y: 1000, z: z1 });
    await page.mouse.click(onTop.x, onTop.y);
    assert.deepEqual(await sel(page), { type: 'roof', id: top.id });
    await page.keyboard.press('Delete');
    assert.equal((await roofs(page)).length, 1);
    assert.equal((await d3(page)).roofs, 1);
    await page.keyboard.press('Control+z');
    assert.equal((await roofs(page)).length, 2);
    await shot(page, 'roof-5-3d-two');
  });

  it('сохранение и загрузка; фасад с выносом и фасцией; автокровля не дублируется', async () => {
    const { page } = app;
    const res = await st(page, async () => {
      const m = await import('./core/model.js');
      const { buildElevation } = await import('./core/elevation.js');
      const { buildHouseMesh } = await import('./core/mesh3d.js');
      const p = window.__kepler.state.project;
      const back = m.deserializeProject(m.serializeProject(p));
      const el = buildElevation(p, 'N');
      const roofU = el.polys.filter((q) => q.kind === 'roof').flatMap((q) => q.pts.map((t) => t.u));
      const wallU = el.polys.filter((q) => q.kind === 'wall').flatMap((q) => q.pts.map((t) => t.u));
      const auto = buildHouseMesh(p, { roof: true }).filter((f) => f.kind === 'roof' && !f.roofId && f.normal.z > 0.5);
      return {
        same: JSON.stringify(back.roofs) === JSON.stringify(p.roofs),
        // Крыша над кухней (вынос 1200) — с одного края фасада.
        over: Math.max(Math.max(...roofU) - Math.max(...wallU), Math.min(...wallU) - Math.min(...roofU)),
        tint: el.polys.some((q) => q.tint === '#3d4148'),
        auto: auto.length,
      };
    });
    assert.ok(res.same);
    assert.ok(res.over >= 1199, `вынос на фасаде: ${res.over}`);
    assert.ok(res.tint);
    assert.equal(res.auto, 0, 'все помещения под крышами — автоплит нет');
    await page.click('#v3Roof');
    assert.equal((await d3(page)).roofFaces > 0, true);
    await page.click('#v3Roof');
  });
});

describe('Крыши-плиты: телефон', () => {
  let app;
  before(async () => {
    app = await startApp({ mobile: true });
    await openNew(app.page);
    await st(app.page, async () => {
      const m = await import('./core/model.js');
      const store = await import('./ui/store.js');
      const p = m.createProject('Телефон');
      const a = m.createRoom('living', 0, 0, 6000, 4000); a.id = 'a';
      p.rooms.push(a);
      store.restoreFrom(m.serializeProject(p));
      window.__kepler.fitView();
    });
  });
  after(async () => {
    assert.deepEqual(app.errors, []);
    await app?.close();
  });

  it('кнопка видна: «План крыши», тап по помещению создаёт крышу и выбирает её', async () => {
    const { page } = app;
    assert.ok(await page.isVisible('#roofToolBtn'));
    await page.tap('#roofToolBtn');
    assert.equal(await st(page, () => window.__kepler.state.tool?.kind), 'roof');
    assert.equal(await st(page, () => window.__kepler.state.roofPlan), true);
    const p = await toClient(page, 3000, 2000);
    await page.touchscreen.tap(p.x, p.y);
    await page.waitForFunction(() => (window.__kepler.state.project.roofs || []).length === 1);
    assert.equal((await sel(page)).type, 'roof');
  });
});
