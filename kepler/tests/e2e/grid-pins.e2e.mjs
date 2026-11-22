// e2e: стены и координационные оси реальной мышью (core/grid-pins.js,
// ui/grid-locks.js): стену тянут к оси — липнет, ось подсвечена, подпись;
// у стены на оси — замок (открыт), подсказка; клик — закрыт (прикреплена);
// ось тянут мышью и меняют в «Свойствах» — стена и комнаты едут, Ctrl+Z —
// одним шагом; общая стена по оси; Alt — оторвать; повторный клик — открыть;
// сохранение и загрузка; удаление оси снимает привязку; ручная стена —
// концы на осях; кнопка «Прикрепить к оси». Скриншоты — если задан
// KEPLER_SHOTS (папка).
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { startApp, openSample, worldToClient } from './helpers.mjs';

const SHOTS = process.env.KEPLER_SHOTS || '';
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: join(SHOTS, `${name}.png`) }); };

const st = (page, key) => page.evaluate((k) => window.__kepler.state[k], key);
const room = (page, name) => page.evaluate((n) => window.__kepler.state.project.rooms.find((r) => r.name === n), name);
const grid = (page, id) => page.evaluate((gid) => window.__kepler.state.project.grids.find((g) => g.id === gid), id);

async function toClient(page, x, y) {
  const wp = await page.evaluate(async (q) => (await import('./ui/view.js')).planToWorld(q), { x, y });
  return worldToClient(page, wp.x, wp.y);
}

async function redraw(page) {
  await page.evaluate(async () => (await import('./ui/view.js')).requestDraw());
  await page.waitForTimeout(80);
}

async function addGrid(page, kind, at) {
  return page.evaluate(async ([k, a]) => {
    const ga = await import('./core/grid-axes.js');
    const gr = await import('./ui/grids.js');
    const g = ga.createGrid({ kind: k, at: a }, window.__kepler.state.project.grids || []);
    gr.addGrid(g);
    return g.id;
  }, [kind, at]);
}

// Замок у выделенной стены (клиентские координаты) или null.
async function lock(page, gridId) {
  await redraw(page);
  const l = await page.evaluate((gid) => (window.__kepler.state._gridLocks || []).find((x) => !gid || x.gridId === gid) || null, gridId);
  if (!l) return null;
  const box = await (await page.$('#canvas')).boundingBox();
  return { ...l, cx: box.x + l.x, cy: box.y + l.y };
}

const color = (page, x, y) => page.evaluate(([cx, cy]) => {
  const c = document.getElementById('canvas');
  const r = c.getBoundingClientRect();
  const k = c.width / r.width;
  return [...c.getContext('2d').getImageData(Math.round((cx - r.left) * k), Math.round((cy - r.top) * k), 1, 1).data];
}, [x, y]);

// y точки на стене x (без проёмов) в пределах y0…y1.
const wallY = (page, x, y0, y1) => page.evaluate(async ([wx, a, b]) => {
  const hit = await import('./ui/hit.js');
  for (let yy = a; yy < b; yy += 100) if (hit.hitPlanStack({ x: wx, y: yy })[0]?.type === 'wall') return yy;
  return null;
}, [x, y0, y1]);

async function drag(page, from, to, { alt = false, probe = null } = {}) {
  await page.mouse.move(from.x, from.y);
  if (alt) await page.keyboard.down('Alt');
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 4 });
  await page.mouse.move(to.x, to.y, { steps: 4 });
  const seen = probe ? await probe() : null;
  await page.mouse.up();
  if (alt) await page.keyboard.up('Alt');
  await page.waitForTimeout(60);
  return seen;
}

describe('Стены и координационные оси: магнит и замок', () => {
  let app;
  let g3; // вертикальная ось у восточной стены гостиной
  before(async () => {
    app = await startApp({ width: 1440, height: 860 });
    await openSample(app.page);
    await app.page.click('#fitBtn');
    await app.page.evaluate(async () => {
      const s = window.__kepler.state;
      s.view.scale *= 0.85;
      (await import('./ui/view.js')).requestDraw();
    });
    await app.page.waitForTimeout(100);
  });
  after(async () => { await app?.close(); });

  it('стена при перетаскивании липнет к оси: подсветка и подпись', async () => {
    const { page } = app;
    g3 = await addGrid(page, 'x', 10600);
    const living = await room(page, 'Гостиная');
    assert.equal(living.x + living.w, 10100);
    // Точка на восточной стене гостиной без проёмов.
    const y = await page.evaluate(async (lv) => {
      const hit = await import('./ui/hit.js');
      for (let yy = lv.y + 300; yy < lv.y + lv.h; yy += 100) {
        const top = hit.hitPlanStack({ x: 10225, y: yy })[0];
        if (top?.type === 'wall') return yy;
      }
      return null;
    }, living);
    assert.ok(y !== null, 'точка на стене');
    const from = await toClient(page, 10225, y);
    const to = await toClient(page, 10425, y); // наружная грань в 50 мм от оси
    const seen = await drag(page, from, to, {
      probe: async () => {
        await redraw(page);
        await shot(page, 'wall-snaps-to-grid');
        return { guides: await st(page, 'guides'), tag: await st(page, 'gridSnapTag') };
      },
    });
    assert.ok(seen.guides.some((g) => g.gridId === g3), 'ось подсвечена');
    assert.match(seen.tag?.text || '', /^Ось /);
    const after = await room(page, 'Гостиная');
    assert.equal(after.x + after.w, 10350, 'наружная грань (10350 + 250) на оси 10600');
    assert.equal(await page.evaluate(() => window.__kepler.state.selection?.type), 'wall');
  });

  it('у стены на оси — открытый замок, подсказка; клик — закрыт', async () => {
    const { page } = app;
    const l = await lock(page, g3);
    assert.ok(l, 'замок есть');
    assert.equal(l.closed, false);
    await shot(page, 'lock-open');
    await page.mouse.move(l.cx, l.cy);
    await page.waitForTimeout(40);
    assert.ok(await page.isVisible('#gridLockTip'));
    assert.match(await page.textContent('#gridLockTip'), /^Прикрепить стену к оси /);
    const open = await color(page, l.cx, l.cy - 7); // поле кружка вокруг дужки — светлое
    await page.mouse.click(l.cx, l.cy);
    const l2 = await lock(page, g3);
    assert.equal(l2.closed, true);
    const closed = await color(page, l2.cx - 7, l2.cy - 4); // залитый акцентом кружок
    assert.notDeepEqual(open, closed);
    const lv = await room(page, 'Гостиная');
    assert.deepEqual(lv.axisPins.map((p) => [p.dir, p.gridId, p.off]), [['e', g3, -250]]);
    await page.mouse.move(l2.cx, l2.cy + 1);
    await page.waitForTimeout(40);
    assert.match(await page.textContent('#gridLockTip'), /^Открепить от оси /);
    await page.mouse.move(l2.cx + 200, l2.cy + 200);
    // «Свойства» стены: привязка видна.
    assert.match(await page.textContent('#wallPinBlock'), /Привязана к оси .* по грани/);
    await shot(page, 'lock-closed-props');
  });

  it('ось тянут мышью — стена и комната едут; Ctrl+Z — одним шагом', async () => {
    const { page } = app;
    const g = await grid(page, g3);
    // Линия оси выше дома (вне комнат и стен).
    const from = await toClient(page, g.at, -900);
    const to = await toClient(page, g.at + 500, -900);
    // Ось сначала выбирают отдельным кликом, затем тянут.
    await page.mouse.click(from.x, from.y);
    assert.deepEqual(await page.evaluate(() => window.__kepler.state.selection), { type: 'grid', id: g3 });
    await drag(page, from, to);
    assert.equal((await grid(page, g3)).at, 11100);
    const lv = await room(page, 'Гостиная');
    assert.equal(lv.x + lv.w, 10850);
    await page.keyboard.press('Control+z');
    assert.equal((await grid(page, g3)).at, 10600);
    assert.equal((await room(page, 'Гостиная')).x + (await room(page, 'Гостиная')).w, 10350);
    assert.equal((await room(page, 'Гостиная')).axisPins.length, 1, 'привязка вернулась с отменой');
  });

  it('поле «Положение» в «Свойствах» оси двигает прикреплённую стену', async () => {
    const { page } = app;
    await page.evaluate(async (id) => (await import('./ui/tools.js')).selectObject({ type: 'grid', id }), g3);
    await page.waitForSelector('#gridAt');
    assert.match(await page.textContent('#gridPinned'), /1/);
    await page.fill('#gridAt', '10900');
    await page.press('#gridAt', 'Enter');
    await page.waitForTimeout(80);
    const lv = await room(page, 'Гостиная');
    assert.equal(lv.x + lv.w, 10650);
    await page.keyboard.press('Control+z');
    assert.equal((await room(page, 'Гостиная')).x + (await room(page, 'Гостиная')).w, 10350);
  });

  it('общая стена «по оси»: обе комнаты едут с осью', async () => {
    const { page } = app;
    const gm = await addGrid(page, 'x', 5050); // середина перегородки спальня|гостиная
    const bed = await room(page, 'Спальня');
    const y = await wallY(page, 5050, bed.y + 300, bed.y + bed.h);
    const c = await toClient(page, 5050, y);
    await page.mouse.click(c.x, c.y);
    const sel = await page.evaluate(() => window.__kepler.state.selection);
    assert.equal(sel.type, 'wall');
    const l = await lock(page, gm);
    assert.ok(l, 'замок у общей стены');
    assert.equal(l.mode, 'axis');
    await page.mouse.click(l.cx, l.cy);
    assert.equal((await lock(page, gm)).closed, true);
    await page.evaluate(async (id) => (await import('./ui/grids.js')).moveGridTo(id, 5350), gm);
    const b2 = await room(page, 'Спальня');
    const lv = await room(page, 'Гостиная');
    assert.equal(b2.x + b2.w, 5300);
    assert.equal(lv.x, 5400);
    assert.equal(lv.x + lv.w, 10350, 'восточная стена — на своей оси');
    await page.keyboard.press('Control+z');
    assert.equal((await room(page, 'Гостиная')).x, 5100);
    await page.keyboard.press('Control+z'); // и привязку общей стены
    assert.equal((await room(page, 'Спальня')).axisPins, undefined);
  });

  it('Alt-перетаскивание отрывает стену от оси (тост)', async () => {
    const { page } = app;
    const lv = await room(page, 'Гостиная');
    const y = await wallY(page, 10475, lv.y + 300, lv.y + lv.h);
    const c = await toClient(page, 10475, y);
    await page.waitForTimeout(600);
    await page.mouse.click(c.x, c.y);
    assert.equal(await page.evaluate(() => window.__kepler.state.selection?.type), 'wall');
    const from = await toClient(page, 10475, y);
    const to = await toClient(page, 11075, y);
    await drag(page, from, to, { alt: true });
    const after = await room(page, 'Гостиная');
    assert.equal(after.x, 5100, 'двигалась стена, а не комната');
    assert.ok(after.x + after.w > 10800, `стена уехала без магнита: ${after.x + after.w}`);
    assert.equal((after.axisPins || []).some((p) => p.gridId === g3), false);
    assert.match(await page.textContent('#toast'), /Стена отвязана от оси/);
    await page.keyboard.press('Control+z');
    assert.equal((await room(page, 'Гостиная')).axisPins.length >= 1, true);
  });

  it('повторный клик по замку открывает: ось двигается, стена стоит', async () => {
    const { page } = app;
    const lv = await room(page, 'Гостиная');
    const c = await toClient(page, 10475, await wallY(page, 10475, lv.y + 300, lv.y + lv.h));
    await page.waitForTimeout(600);
    await page.mouse.click(c.x, c.y);
    assert.equal(await page.evaluate(() => window.__kepler.state.selection?.type), 'wall');
    const l = await lock(page, g3);
    assert.equal(l.closed, true);
    await page.mouse.click(l.cx, l.cy);
    assert.equal((await lock(page, g3)).closed, false);
    await page.evaluate(async (id) => (await import('./ui/grids.js')).moveGridTo(id, 11000), g3);
    assert.equal((await room(page, 'Гостиная')).x + (await room(page, 'Гостиная')).w, 10350);
    await page.keyboard.press('Control+z');
    await page.keyboard.press('Control+z'); // и замок снова закрыт
    assert.equal((await room(page, 'Гостиная')).axisPins.length, 1);
  });

  it('кнопка «Прикрепить к оси» в плашке и сохранение/загрузка файла', async () => {
    const { page } = app;
    const pins = await page.evaluate(async () => {
      const { serializeProject } = await import('./core/model.js');
      const store = await import('./ui/store.js');
      const text = serializeProject(window.__kepler.state.project);
      store.restoreFrom(text);
      return window.__kepler.state.project.rooms.find((r) => r.name === 'Гостиная').axisPins;
    });
    assert.equal(pins.length, 1);
    assert.equal(pins[0].gridId, g3);
    // Плашка: у прикреплённой — «Открепить от оси».
    const lv = await room(page, 'Гостиная');
    const c = await toClient(page, 10475, await wallY(page, 10475, lv.y + 1700, lv.y + lv.h)); 
    await page.waitForTimeout(600); // серия кликов (event.detail) перебирает объекты под курсором
    await page.mouse.click(c.x, c.y);
    const dbg = await page.evaluate(() => ({ sel: window.__kepler.state.selection, tb: document.getElementById('selectionToolbar').innerHTML.replace(/\s+/g, ' ').slice(0, 600) }));
    assert.ok(await page.$('[data-selection-action="grid-unpin"]'), JSON.stringify(dbg));
    await page.click('[data-selection-action="grid-unpin"]');
    await page.waitForFunction(() => !window.__kepler.state.project.rooms.find((r) => r.name === 'Гостиная').axisPins);
    await page.click('[data-selection-action="grid-pin"]');
    await page.waitForFunction(() => window.__kepler.state.project.rooms.find((r) => r.name === 'Гостиная').axisPins?.length === 1);
  });

  it('удаление оси снимает привязку', async () => {
    const { page } = app;
    await page.evaluate(async (id) => (await import('./ui/tools.js')).selectObject({ type: 'grid', id }), g3);
    await page.keyboard.press('Delete');
    assert.equal(await grid(page, g3), undefined);
    assert.equal((await room(page, 'Гостиная')).axisPins, undefined);
    await page.keyboard.press('Control+z');
    assert.ok(await grid(page, g3));
    assert.equal((await room(page, 'Гостиная')).axisPins.length, 1);
  });

  it('ручная стена: концы липнут к осям, торец тянется к оси', async () => {
    const { page } = app;
    const gx = await addGrid(page, 'x', 2000);
    const gy = await addGrid(page, 'y', 9500);
    const gx2 = await addGrid(page, 'x', 7000);
    await page.keyboard.press('Escape');
    await page.click('#wallToolBtn');
    const a = await toClient(page, 2120, 9420);
    const b = await toClient(page, 6000, 9430);
    await page.mouse.move(a.x, a.y, { steps: 2 });
    await page.mouse.click(a.x, a.y);
    await page.mouse.move(b.x, b.y, { steps: 2 });
    await page.mouse.click(b.x, b.y);
    await page.keyboard.press('Escape');
    const w = await page.evaluate(() => window.__kepler.state.project.walls.at(-1));
    assert.deepEqual(w.axis.a, { x: 2000, y: 9500 }, 'начало — на пересечении осей');
    assert.equal(w.axis.b.y, 9500, 'линия — по оси');
    // Торец b — к оси x = 7000.
    await redraw(page);
    const end = await toClient(page, w.axis.b.x, w.axis.b.y);
    const target = await toClient(page, 7120, w.axis.b.y);
    const seen = await drag(page, end, target, { probe: () => st(page, 'guides') });
    const w2 = await page.evaluate(() => window.__kepler.state.project.walls.at(-1));
    assert.equal(w2.axis.b.x, 7000);
    assert.ok(seen.some((g) => g.gridId === gx2), 'ось подсвечена');
    // Замки у ручной стены: линия и торцы.
    const locks = await page.evaluate(async () => { (await import('./ui/view.js')).requestDraw(); await new Promise((r) => setTimeout(r, 60)); return window.__kepler.state._gridLocks.map((l) => `${l.part}:${l.gridId}`); });
    assert.ok(locks.includes(`line:${gy}`) && locks.includes(`a:${gx}`) && locks.includes(`b:${gx2}`), locks.join(','));
    const l = await lock(page, gy);
    await page.mouse.click(l.cx, l.cy);
    await page.evaluate(async (id) => (await import('./ui/grids.js')).moveGridTo(id, 9800), gy);
    const w3 = await page.evaluate(() => window.__kepler.state.project.walls.at(-1));
    assert.equal(w3.axis.a.y, 9800);
    assert.deepEqual(app.errors, []);
  });
});
