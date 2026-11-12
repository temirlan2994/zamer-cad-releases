// e2e: крыши-плиты (core/roofs.js) реальной мышью — инструмент «Крыша» (K)
// на плане: клик по помещению создаёт и выбирает крышу, Shift+клик
// добавляет помещение, контур выноса и «Свойства» с карточками; точка
// стороны тянет вынос (подпись, Ctrl+Z); типы края/парапета/материал меняют
// 3D; в 3D инструмент накрывает помещение, точка выноса и стрелка Z тянутся,
// Delete; сохранение; фасад с выносом; автокровля не дублируется.
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

async function dragPlan(page, a, b, mid) {
  await page.mouse.move(a.x, a.y, { steps: 2 });
  await page.mouse.down();
  await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 4 });
  await page.mouse.move(b.x, b.y, { steps: 4 });
  if (mid) await mid();
  await page.mouse.up();
}

describe('Крыши-плиты: инструмент, ручки, типы, 3D', () => {
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

  it('кнопка и подсказка, K — инструмент, клик по помещению — крыша создана и выбрана', async () => {
    const { page } = app;
    assert.ok(await page.isVisible('#roofToolBtn'));
    assert.match(await page.textContent('#tbTip-roof'), /клик по помещению — накрыть крышей/);
    await page.keyboard.press('KeyK');
    assert.equal(await st(page, () => window.__kepler.state.tool?.kind), 'roof');
    assert.ok(await page.$eval('#roofToolBtn', (b) => b.classList.contains('active')));
    const p = await toClient(page, 3000, 2000);
    await page.mouse.move(p.x, p.y, { steps: 3 });
    assert.equal(await st(page, () => window.__kepler.state.tool.hover), 'a');
    await page.mouse.click(p.x, p.y);
    const list = await roofs(page);
    assert.equal(list.length, 1);
    assert.equal(list[0].levelId, 'L1');
    assert.deepEqual(list[0].roomIds, ['a']);
    assert.deepEqual(await sel(page), { type: 'roof', id: list[0].id });
    assert.equal(await st(page, () => window.__kepler.state.tool?.kind), 'roof', 'инструмент остаётся');
    assert.ok(await page.isVisible('#roofProps .roof-card'));
    await page.waitForFunction(() => window.__kepler.state._planRoofs === 1);
  });

  it('Shift+клик — второе помещение в той же крыше; клик по накрытому — выбрать', async () => {
    const { page } = app;
    const p = await toClient(page, 8000, 2000);
    await page.keyboard.down('Shift');
    await page.mouse.click(p.x, p.y);
    await page.keyboard.up('Shift');
    const list = await roofs(page);
    assert.equal(list.length, 1);
    assert.deepEqual(list[0].roomIds, ['a', 'b']);
    await page.mouse.click(p.x, p.y);
    assert.equal((await roofs(page)).length, 1, 'накрытое — не новая крыша');
    await page.keyboard.press('Escape');
    assert.equal(await st(page, () => window.__kepler.state.tool), null);
    await shot(page, 'roof-1-plan');
  });

  it('клик в зоне выноса выбирает крышу; точка стороны тянет вынос, подпись, Ctrl+Z', async () => {
    const { page } = app;
    await st(page, () => window.__kepler.select(null));
    // Зум ближе: точки и зона выноса крупнее.
    await st(page, async () => {
      const s = window.__kepler.state;
      s.view.scale = 0.06;
      const c = document.getElementById('canvas');
      const q = window.__kepler.planToScreen(5000, 2000);
      s.view.panX += c.clientWidth / 2 - q.x;
      s.view.panY += c.clientHeight / 2 - q.y;
      window.__kepler.fitView && (await import('./ui/view.js')).requestDraw();
    });
    const z = await toClient(page, -600, 2000);
    await page.mouse.click(z.x, z.y);
    const id = (await roofs(page))[0].id;
    assert.deepEqual(await sel(page), { type: 'roof', id });
    await shot(page, 'roof-2-selected');
    const h = await handle(page, 'w');
    assert.equal(h.x, -850);
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
    await page.mouse.click(z.x - 30, z.y); // отмена/возврат снимают выбор — снова клик в зоне выноса
    assert.equal((await sel(page))?.type, 'roof');
    // Угол: две стороны сразу.
    const c = await handle(page, 'ne');
    const c0 = await toClient(page, c.x, c.y);
    const c1 = await toClient(page, c.x + 400, c.y - 400);
    await dragPlan(page, c0, c1);
    const oh = (await roofs(page))[0].overhang;
    assert.equal(oh.n, 1000);
    assert.equal(oh.e, 1000);
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
    assert.deepEqual(top.roomIds, ['c']);
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
        over: (Math.max(...roofU) - Math.max(...wallU)),
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

  it('кнопка видна, тап по помещению создаёт крышу и выбирает её', async () => {
    const { page } = app;
    assert.ok(await page.isVisible('#roofToolBtn'));
    await page.tap('#roofToolBtn');
    assert.equal(await st(page, () => window.__kepler.state.tool?.kind), 'roof');
    const p = await toClient(page, 3000, 2000);
    await page.touchscreen.tap(p.x, p.y);
    await page.waitForFunction(() => (window.__kepler.state.project.roofs || []).length === 1);
    assert.equal((await sel(page)).type, 'roof');
  });
});
