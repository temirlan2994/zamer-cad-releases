// e2e среза 3 этапа 2 (docs/v7-stage2-plan.md): жесты блоков на номинальной
// модели — настоящей мышью, дом повёрнут на 45°.
//  (а) налез верхним — нижний уменьшился ВО ВРЕМЯ жеста; убрал — целый;
//  (б) сдвинул нижний — целый на новом месте;
//  (в) любой порядок + Ctrl+Z/Ctrl+Y == построение с нуля;
//  (д) Г-комната тянется за вершины/рёбра; ручки съеденной — на номинале;
//  (е) мебель едет с блоком (и не уезжает чужая из «выреза»);
//  магнит 300 мм, Alt — без магнита, тумблер в «Привязках»;
//  поворот R, дублирование Ctrl+D, удаление Delete.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, openNew } from './helpers.mjs';

const shapes = (page) => page.evaluate(() => window.__kepler.state.project.rooms
  .map((r) => ({ id: r.id, x: r.x, y: r.y, w: r.w, h: r.h, outline: r.outline || null, notch: r.notch || null }))
  .sort((a, b) => (a.id < b.id ? -1 : 1)));
const room = async (page, id) => (await shapes(page)).find((r) => r.id === id);
const item = (page, id) => page.evaluate((i) => {
  const it = window.__kepler.state.project.items.find((x) => x.id === i);
  return it ? { x: it.x, y: it.y } : null;
}, id);
const order = (page) => page.evaluate(() => window.__kepler.state.project.rooms.map((r) => r.id));
const base = (page, id) => page.evaluate((i) => {
  const r = window.__kepler.state.project.rooms.find((x) => x.id === i);
  return r?.eatBase?.base || null;
}, id);

// Построение с нуля по номиналам и порядку — эталон для (в).
const fromScratch = (page) => page.evaluate(async () => {
  const { nominalShape, reconcileEats } = await import('./core/v7/eat-bridge.js');
  const { createProject } = await import('./core/model.js');
  const { state } = window.__kepler;
  const p = createProject('с нуля');
  p.settings = JSON.parse(JSON.stringify(state.project.settings));
  for (const r of state.project.rooms) {
    const n = JSON.parse(JSON.stringify(nominalShape(r)));
    delete n.eatBase;
    p.rooms.push(n);
  }
  reconcileEats(p);
  return p.rooms.map((r) => ({ id: r.id, x: r.x, y: r.y, w: r.w, h: r.h, outline: r.outline || null, notch: r.notch || null }))
    .sort((a, b) => (a.id < b.id ? -1 : 1));
});

async function planToClient(page, x, y) {
  const box = await (await page.$('#canvas')).boundingBox();
  const s = await page.evaluate(([px, py]) => window.__kepler.planToScreen(px, py), [x, y]);
  return { x: box.x + s.x, y: box.y + s.y };
}

// Перетаскивание мышью; mid(page) вызывается, пока кнопка ещё нажата.
async function dragPlan(page, a, b, { select = true, mid = null, alt = false, shift = false } = {}) {
  const from = await planToClient(page, a[0], a[1]);
  const to = await planToClient(page, b[0], b[1]);
  if (select) await page.mouse.click(from.x, from.y);
  await page.mouse.move(from.x, from.y);
  if (alt) await page.keyboard.down('Alt');
  if (shift) await page.keyboard.down('Shift');
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 14 });
  let seen = null;
  if (mid) seen = await mid(page);
  await page.mouse.up();
  if (alt) await page.keyboard.up('Alt');
  if (shift) await page.keyboard.up('Shift');
  return seen;
}

async function setup(page, { withItems = true, lshape = false } = {}) {
  await page.evaluate(async ({ withItems: wi, lshape: ls }) => {
    const { mutate } = await import('./ui/store.js');
    const { selectObject } = await import('./ui/tools.js');
    const { createItem, createRoom } = await import('./core/model.js');
    const { state } = window.__kepler;
    selectObject(null);
    mutate(() => {
      state.project.building.rotation = 45;
      state.project.rooms.length = 0;
      state.project.items.length = 0;
      state.project.openings.length = 0;
      const a = createRoom('living', 0, 0, 4000, 4000); a.id = 'A';
      const b = createRoom('bedroom', 6000, 0, 3000, 3000); b.id = 'B';
      state.project.rooms.push(a, b);
      if (ls) {
        const c = createRoom('kitchen', 0, 8000, 5000, 4000); c.id = 'C';
        c.notch = { corner: 'ne', w: 2000, h: 2000 };
        state.project.rooms.push(c);
      }
      if (wi) {
        const ia = createItem('chair', 1000, 1000, 400, 400); ia.id = 'IA';
        // В B, в той её части, что после наезда окажется над «вырезом» A.
        const ib = createItem('chair', 6300, 300, 400, 400); ib.id = 'IB';
        state.project.items.push(ia, ib);
      }
    });
    state.view.scale = 0.025; state.view.panX = 560; state.view.panY = 330; state.view.rotation = 0;
    window.__kepler.requestDraw?.();
  }, { withItems, lshape });
}

describe('жесты блоков на номинале, дом под 45°', () => {
  let app;
  let eaten;
  before(async () => {
    app = await startApp();
    await openNew(app.page);
    await setup(app.page);
  });
  after(async () => { await app?.close(); });

  it('(а)+(е) наезд верхним: нижняя меняется ВО ВРЕМЯ жеста, мебель верхней едет с ней', async () => {
    const { page } = app;
    const live = await dragPlan(page, [8500, 2500], [5500, 5500], { mid: (p) => room(p, 'A') });
    assert.ok(live.outline, `во время жеста A уже съедена: ${JSON.stringify(live)}`);
    const a = await room(page, 'A');
    assert.ok(a.outline, 'после жеста A — Г');
    assert.deepEqual(await item(page, 'IB'), { x: 3300, y: 3300 }, 'мебель B уехала с B');
    assert.deepEqual(await item(page, 'IA'), { x: 1000, y: 1000 }, 'мебель A на месте');
    eaten = await shapes(page);
    assert.deepEqual(eaten, await fromScratch(page), '(в) = с нуля');
  });

  it('(а) убрали верхнюю — нижняя целая уже во время жеста; вернули — как было', async () => {
    const { page } = app;
    const live = await dragPlan(page, [5500, 5500], [5500, 11500], { mid: (p) => room(p, 'A') });
    assert.equal(live.outline, null, 'во время жеста A уже целая');
    assert.deepEqual(await room(page, 'A'), { id: 'A', x: 0, y: 0, w: 4000, h: 4000, outline: null, notch: null });
    await dragPlan(page, [5500, 11500], [5500, 5500]);
    assert.deepEqual(await shapes(page), eaten, 'то же, что после первого наезда');
  });

  it('ручки съеденной — на номинале; растяжение под верхней не поднимает её', async () => {
    const { page } = app;
    await page.mouse.click(...Object.values(await planToClient(page, 500, 500)));
    const handles = await page.evaluate(async () => {
      const { roomHandles } = await import('./render.js');
      const r = window.__kepler.state.project.rooms.find((x) => x.id === 'A');
      return roomHandles(r).map((h) => [h.id, h.x, h.y]);
    });
    assert.deepEqual(handles.find((h) => h[0] === 'se'), ['se', 4000, 4000], `ручка угла номинала (под B): ${JSON.stringify(handles)}`);
    // Левая грань A (ручка w) — наружу на 1000; A остаётся под B.
    const live = await dragPlan(page, [0, 2000], [-1000, 2000], { select: false, mid: (p) => base(p, 'A') });
    assert.equal(live?.w, 5000, `номинал растёт во время жеста: ${JSON.stringify(live)}`);
    assert.deepEqual(await base(page, 'A'), { x: -1000, y: 0, w: 5000, h: 4000 });
    assert.deepEqual(await order(page), ['A', 'B'], 'B по-прежнему выше');
    // Угол номинала под B (его не видно) — тоже тянется (Shift — только
    // сетка: на этом мелком масштабе грань липнет к линиям стен в 560 мм).
    await dragPlan(page, [4000, 4000], [4500, 4500], { select: false, shift: true });
    assert.deepEqual(await base(page, 'A'), { x: -1000, y: 0, w: 5500, h: 4500 });
    const b = await room(page, 'B');
    assert.equal(b.outline, null, 'B целая');
    assert.deepEqual(await shapes(page), await fromScratch(page), '(в) = с нуля');
  });

  it('(в) отмены/повторы всех жестов == построение с нуля', async () => {
    const { page } = app;
    const now = await shapes(page);
    for (let i = 0; i < 4; i += 1) {
      await page.keyboard.press('Control+z');
      assert.deepEqual(await shapes(page), await fromScratch(page), `отмена ${i + 1}`);
    }
    for (let i = 0; i < 4; i += 1) {
      await page.keyboard.press('Control+y');
      assert.deepEqual(await shapes(page), await fromScratch(page), `повтор ${i + 1}`);
    }
    assert.deepEqual(await shapes(page), now, 'вернулись к последнему состоянию');
  });

  it('(б)+(е) сдвиг съеденной A — целая на новом месте, её мебель с ней, мебель B на месте', async () => {
    const { page } = app;
    const ib = await item(page, 'IB');
    await dragPlan(page, [500, 500], [500, -7000]);
    const a = await room(page, 'A');
    assert.equal(a.outline, null, JSON.stringify(a));
    assert.equal(a.w * a.h, 5500 * 4500, 'номинал целиком');
    assert.deepEqual(await item(page, 'IA'), { x: 1000, y: -6500 }, 'мебель A уехала с A');
    assert.deepEqual(await item(page, 'IB'), ib, 'мебель B над «вырезом» A — на месте');
    assert.deepEqual(await shapes(page), await fromScratch(page));
  });

  it('без ошибок в консоли', () => {
    assert.deepEqual(app.errors, []);
  });
});

describe('магнит блоков, поворот, копия, удаление, Г-комната (дом 45°)', () => {
  let app;
  before(async () => {
    app = await startApp();
    await openNew(app.page);
  });
  after(async () => { await app?.close(); });

  it('магнит 300 мм прижимает с зазором перегородки; Alt и тумблер — без магнита', async () => {
    const { page } = app;
    await setup(page, { withItems: false });
    // B: левая грань 6000 → 4250 (зазор 250 до A) — магнит даёт 4100.
    await dragPlan(page, [7500, 1500], [5750, 1500]);
    assert.equal((await room(page, 'B')).x, 4100, 'прижата с перегородкой 100');
    await page.keyboard.press('Control+z');
    assert.equal((await room(page, 'B')).x, 6000);
    await dragPlan(page, [7500, 1500], [5750, 1500], { alt: true });
    const bAlt = await room(page, 'B');
    assert.ok(bAlt.x > 4150, `Alt — без магнита: ${bAlt.x}`);
    await page.keyboard.press('Control+z');
    // Тумблер «Примагничивание блоков» в «Привязках».
    await page.click('#snapMenuBtn');
    const btn = '#snapBar [data-snap="magnet"]';
    assert.equal(await page.$eval(btn, (n) => n.classList.contains('on')), true, 'по умолчанию включён');
    assert.match(await page.$eval(btn, (n) => n.textContent), /Примагничивание блоков/);
    await page.click(btn);
    assert.equal(await page.$eval(btn, (n) => n.classList.contains('on')), false);
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('kepler-draw-snap')).magnet);
    assert.equal(saved, false, 'настройка запомнена');
    await page.click('#snapMenuBtn');
    await dragPlan(page, [7500, 1500], [5750, 1500]);
    assert.ok((await room(page, 'B')).x > 4150, 'выключен — без магнита');
    await page.keyboard.press('Control+z');
    await page.click('#snapMenuBtn');
    await page.click(btn);
    await page.click('#snapMenuBtn');
    // Явно «внутрь» соседа дальше радиуса — съедание как обычно.
    await dragPlan(page, [7500, 1500], [4500, 1500]); // B.x = 3000, на 1000 внутри A
    assert.equal((await room(page, 'B')).x, 3000);
    assert.ok((await room(page, 'A')).outline, 'A съедена');
    // Растяжение: правая грань A к B (B.x = 3000 → не мешает); отменим.
    await page.keyboard.press('Control+z');
    // Растяжение ручкой: правая грань A 4000 → 5750 (зазор 250 до B) → 5900.
    await page.mouse.click(...Object.values(await planToClient(page, 500, 500)));
    await dragPlan(page, [4000, 2000], [5750, 2000], { select: false });
    assert.equal((await room(page, 'A')).w, 5900, 'грань прижата к B с перегородкой');
    await page.keyboard.press('Control+z');
  });

  it('поворот R съеденной — поворачивается номинал; копия Ctrl+D — целая; Delete — нижняя целая', async () => {
    const { page } = app;
    await setup(page, { withItems: false });
    await page.evaluate(async () => {
      const { mutate } = await import('./ui/store.js');
      const { state } = window.__kepler;
      mutate(() => { const a = state.project.rooms.find((r) => r.id === 'A'); a.w = 6000; a.h = 3000; });
    });
    await dragPlan(page, [7500, 1500], [5000, 2500]); // B на A: 3500…6500 × 1000…4000
    assert.ok((await room(page, 'A')).outline, 'A съедена');
    // Поворот съеденной A: поворачивается номинал 6000×3000 → 3000×6000 вокруг центра.
    await page.mouse.click(...Object.values(await planToClient(page, 500, 500)));
    await page.keyboard.press('r');
    const rotated = await page.evaluate(() => {
      const r = window.__kepler.state.project.rooms.find((x) => x.id === 'A');
      return r.eatBase?.base || { x: r.x, y: r.y, w: r.w, h: r.h };
    });
    assert.equal(rotated.w, 3000, JSON.stringify(rotated));
    assert.equal(rotated.h, 6000);
    assert.deepEqual(await shapes(page), await fromScratch(page), 'поворот = с нуля');
    await page.keyboard.press('Control+z');
    assert.deepEqual(await base(page, 'A'), { x: 0, y: 0, w: 6000, h: 3000 }, 'отмена поворота');
    // Копия съеденной — копируется блок целиком.
    await page.mouse.click(...Object.values(await planToClient(page, 500, 500)));
    await page.keyboard.press('Control+d');
    const copy = await page.evaluate(() => {
      const r = window.__kepler.state.project.rooms.find((x) => x.name?.endsWith('копия'));
      return r ? { w: r.w, h: r.h, outline: r.outline || null, eaten: Boolean(r.eatBase) } : null;
    });
    assert.ok(copy, 'копия есть');
    assert.equal(copy.w * copy.h, 6000 * 3000, `копия — номинал целиком: ${JSON.stringify(copy)}`);
    assert.deepEqual(await shapes(page), await fromScratch(page), 'копия = с нуля');
    await page.keyboard.press('Control+z');
    // Удаление верхней — нижняя целая; отмена — снова съедена.
    const before = await shapes(page);
    await page.mouse.click(...Object.values(await planToClient(page, 6000, 3500)));
    await page.keyboard.press('Delete');
    assert.deepEqual(await room(page, 'A'), { id: 'A', x: 0, y: 0, w: 6000, h: 3000, outline: null, notch: null });
    await page.keyboard.press('Control+z');
    assert.deepEqual(await shapes(page), before);
  });

  it('(д) Г-комната тянется за вершину и ребро; съеденная Г — ручки по номиналу', async () => {
    const { page } = app;
    await setup(page, { withItems: false, lshape: true });
    await page.mouse.click(...Object.values(await planToClient(page, 500, 9000)));
    const hs = await page.evaluate(async () => {
      const { roomHandles } = await import('./render.js');
      const r = window.__kepler.state.project.rooms.find((x) => x.id === 'C');
      return roomHandles(r).map((h) => ({ id: h.id, kind: h.kind, x: h.x, y: h.y }));
    });
    // Внутренняя вершина выреза (3000, 10000) → (2500, 10500).
    const v = hs.find((h) => h.kind === 'vertex' && h.x === 3000 && h.y === 10000);
    assert.ok(v, JSON.stringify(hs));
    await dragPlan(page, [v.x, v.y], [2500, 10500], { select: false });
    let c = await room(page, 'C');
    assert.deepEqual(c.notch, { corner: 'ne', w: 2500, h: 2500 }, JSON.stringify(c));
    // Ребро: нижняя грань (середина) 12000 → 12500.
    const e = hs.find((h) => h.kind === 'edge' && h.y === 12000);
    await dragPlan(page, [e.x, 12000], [e.x, 12500], { select: false });
    c = await room(page, 'C');
    assert.equal(c.h, 4500);
    // B наезжает на конец «подошвы» Г — у C ручки остаются по номиналу (Г, 6 вершин).
    await dragPlan(page, [7500, 1500], [5000, 11500]); // B: 3500…6500 × 10000…13000
    assert.ok((await room(page, 'C')).outline, 'C съедена');
    await page.mouse.click(...Object.values(await planToClient(page, 500, 9000)));
    const sel = await page.evaluate(() => window.__kepler.state.selection);
    assert.deepEqual(sel, { type: 'room', id: 'C' });
    const hs2 = await page.evaluate(async () => {
      const { roomHandles } = await import('./render.js');
      const r = window.__kepler.state.project.rooms.find((x) => x.id === 'C');
      return roomHandles(r).filter((h) => h.kind === 'vertex').map((h) => [h.x, h.y]);
    });
    assert.equal(hs2.length, 6, `вершины номинала Г: ${JSON.stringify(hs2)}`);
    assert.ok(hs2.some(([x, y]) => x === 5000 && y === 12500), 'угол номинала под B');
    assert.deepEqual(await shapes(page), await fromScratch(page));
  });

  it('без ошибок в консоли', () => {
    assert.deepEqual(app.errors, []);
  });
});
