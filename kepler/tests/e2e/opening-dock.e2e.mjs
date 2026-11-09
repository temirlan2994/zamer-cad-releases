// Проём не пропадает при стыковке комнат (реальная мышь): у комнаты A окно на
// левой стене и дверь на верхней; комнату B без окон пододвигают к стене с
// окном — вплотную, со смещением, короткую над окном. Окно остаётся в
// проекте, стоит в общей стене (openingRect не null) и видно на плане
// (пиксели: в проёме светло, на стене рядом — темно). B глубоко на стене с
// окном — окно «сирота» и возвращается, когда B увели.
// SHOTS=<папка> — снимки экрана.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, openNew } from './helpers.mjs';

const SHOTS = process.env.SHOTS || '';
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` }); };

async function planToClient(page, x, y) {
  const box = await (await page.$('#canvas')).boundingBox();
  const s = await page.evaluate(([px, py]) => window.__kepler.planToScreen(px, py), [x, y]);
  return { x: box.x + s.x, y: box.y + s.y };
}

async function dragPlan(page, a, b) {
  const from = await planToClient(page, a[0], a[1]);
  const to = await planToClient(page, b[0], b[1]);
  await page.mouse.click(from.x, from.y);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 14 });
  await page.mouse.up();
}

async function reset(page, b) {
  await page.evaluate(async (bb) => {
    const { mutate } = await import('./ui/store.js');
    const { createOpening, createRoom } = await import('./core/model.js');
    const { state } = window.__kepler;
    mutate(() => {
      state.project.rooms.splice(0);
      state.project.openings.splice(0);
      const a = createRoom('living', 0, 0, 4000, 3000); a.id = 'A';
      const r = createRoom('bedroom', bb.x, bb.y, bb.w, bb.h); r.id = 'B';
      state.project.rooms.push(a, r);
      const w = createOpening('window', 'A', 3, 1500, 1200); w.id = 'W';
      const d = createOpening('door', 'A', 0, 2000, 900); d.id = 'D';
      state.project.openings.push(w, d);
    });
    state.selection = null;
    state.view.scale = 0.08; state.view.panX = 760; state.view.panY = 260; state.view.rotation = 0;
    window.__kepler.requestDraw?.();
  }, b);
}

// Состояние окна W: в проекте, сирота съеденной, где стоит, пиксели.
async function windowState(page) {
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  return page.evaluate(async () => {
    const { deriveWalls, openingRect } = await import('./core/walls.js');
    const { state } = window.__kepler;
    const p = state.project;
    const w = p.openings.find((o) => o.id === 'W');
    const a = p.rooms.find((r) => r.id === 'A');
    const placed = w ? openingRect(p, w, deriveWalls(p)) : null;
    const out = {
      inProject: Boolean(w),
      orphanOfA: (a.eatBase?.openings || []).some((o) => o.id === 'W'),
      kind: placed?.wall.kind || null,
      center: placed?.absCenter ?? null,
      door: Boolean(openingRect(p, p.openings.find((o) => o.id === 'D') || { orphan: true }, deriveWalls(p))),
    };
    if (placed) {
      // Пиксели: точка внутри проёма (¼ толщины, мимо линии стекла) и точка
      // на той же стене в 400 мм за краем окна.
      const canvas = document.getElementById('canvas');
      const ctx = canvas.getContext('2d');
      const k = canvas.width / canvas.clientWidth;
      const lum = (x, y) => {
        const s = window.__kepler.planToScreen(x, y);
        const d = ctx.getImageData(Math.round(s.x * k), Math.round(s.y * k), 1, 1).data;
        return 0.299 * d[0] + 0.587 * d[1] + 0.114 * d[2];
      };
      const r = placed.rect;
      const x = r.x + r.w * 0.25;
      out.lumWindow = lum(x, placed.absCenter + 250);
      const wallY = placed.absCenter - w.width / 2 - 400;
      out.lumWall = wallY > placed.wall.from + 50 ? lum(x, wallY) : null;
    }
    return out;
  });
}

function assertVisible(s, label) {
  assert.ok(s.inProject, `${label}: окно в проекте ${JSON.stringify(s)}`);
  assert.ok(s.kind, `${label}: окно стоит на стене ${JSON.stringify(s)}`);
  assert.ok(Math.abs(s.center - 1500) <= 450, `${label}: окно на месте ${JSON.stringify(s)}`);
  assert.ok(s.door, `${label}: дверь видна`);
  assert.ok(s.lumWindow > 150, `${label}: в проёме светло ${JSON.stringify(s)}`);
  if (s.lumWall !== null) assert.ok(s.lumWall < s.lumWindow - 40, `${label}: стена рядом темнее ${JSON.stringify(s)}`);
}

describe('проём не пропадает при стыковке комнат', () => {
  let app;
  before(async () => {
    app = await startApp();
    await openNew(app.page);
  });
  after(async () => { await app?.close(); });

  it('B вплотную к стене с окном — окно в общей стене, видно', async () => {
    const { page } = app;
    await reset(page, { x: -7000, y: 0, w: 3000, h: 3000 });
    await shot(page, 'dock-1-before');
    await dragPlan(page, [-5500, 1500], [-1500, 1500]);
    await shot(page, 'dock-1-after');
    const s = await windowState(page);
    assertVisible(s, 'вплотную');
    assert.equal(s.kind, 'shared', JSON.stringify(s));
    assert.equal(s.orphanOfA, false);
  });

  it('B вплотную со смещением (часть стены с окном) — окно видно', async () => {
    const { page } = app;
    await reset(page, { x: -7000, y: 1000, w: 3000, h: 3000 });
    await dragPlan(page, [-5500, 2500], [-1500, 2500]);
    await shot(page, 'dock-2-after');
    assertVisible(await windowState(page), 'со смещением');
  });

  it('короткая B напротив окна — окно в общей стене, видно', async () => {
    const { page } = app;
    await reset(page, { x: -7000, y: 700, w: 3000, h: 1600 });
    await dragPlan(page, [-5500, 1500], [-1500, 1500]);
    await shot(page, 'dock-3-after');
    const s = await windowState(page);
    assertVisible(s, 'короткая');
    assert.equal(s.kind, 'shared', JSON.stringify(s));
  });

  it('B наезжает на стену с окном (магнит к грани стены) — стены объединились, окно видно', async () => {
    const { page } = app;
    await reset(page, { x: -7000, y: 0, w: 3000, h: 3000 });
    await dragPlan(page, [-5500, 1500], [-1250, 1500]);
    await shot(page, 'dock-5-overlap');
    const a = await page.evaluate(() => window.__kepler.state.project.rooms.find((r) => r.id === 'A'));
    assert.ok(a.eatBase, 'A срезана наездом');
    const s = await windowState(page);
    assertVisible(s, 'наезд');
    assert.equal(s.kind, 'shared', JSON.stringify(s));
    assert.equal(s.orphanOfA, false);
    await dragPlan(page, [-1250, 1500], [-6500, 1500]);
    const back = await windowState(page);
    assertVisible(back, 'B увели');
    assert.equal(back.kind, 'own');
  });

  it('B глубоко на стене с окном — окно сирота, B увели — окно вернулось', async () => {
    const { page } = app;
    await reset(page, { x: -7000, y: 0, w: 3000, h: 3000 });
    await dragPlan(page, [-5500, 1500], [0, 1500]);
    await shot(page, 'dock-4-eaten');
    const eaten = await page.evaluate(() => window.__kepler.state.project.rooms.find((r) => r.id === 'A').eatBase);
    assert.ok(eaten, 'A съедена');
    const s = await windowState(page);
    assert.equal(s.inProject, false, 'окно под B не рисуется');
    assert.ok(s.orphanOfA, `окно хранится сиротой ${JSON.stringify(s)}`);
    const issue = await page.evaluate(async () => {
      const { collectIssues } = await import('./core/issues.js');
      return collectIssues(window.__kepler.state.project).groups.flatMap((g) => g.items).map((i) => i.text);
    });
    assert.ok(issue.some((t) => /Проём «окно» под соседней комнатой/.test(t)), JSON.stringify(issue));
    await dragPlan(page, [0, 1500], [-6500, 1500]);
    await shot(page, 'dock-4-back');
    const back = await windowState(page);
    assertVisible(back, 'вернулось');
    assert.equal(back.kind, 'own');
  });
});
