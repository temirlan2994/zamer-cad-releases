// Терраса у стены дома не меняет стен и не съедает; перила — объект:
// выбор кликом, ручки концов, «Разделить», «Удалить», «Тип», Ctrl+Z,
// сохранение, выбор и удаление в 3D. Реальной мышью.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, openNew, settleView } from './helpers.mjs';

const SHOTS = process.env.KEPLER_SHOTS || '';
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` }); };

const st = (page, fn, arg) => page.evaluate(fn, arg);
const toClient = async (page, x, y) => {
  const box = await (await page.$('#canvas')).boundingBox();
  const s = await page.evaluate(([px, py]) => window.__kepler.planToScreen(px, py), [x, y]);
  return { x: box.x + s.x, y: box.y + s.y };
};
const wallsJson = (page) => st(page, () => JSON.stringify(window.__kepler.state.walls
  .map((w) => ({ key: w.key, kind: w.kind, t: w.thickness, rects: w.rects || w.band }))));
const railings = (page, roomId) => st(page, async (id) => {
  const { roomRailings } = await import('./core/railings.js');
  const s = window.__kepler.state;
  const room = s.project.rooms.find((r) => r.id === id);
  return roomRailings(room, s.project.rooms, s.project.settings);
}, roomId);

describe('терраса и перила', () => {
  let app;
  let living;
  let terrace;
  before(async () => {
    app = await startApp();
    await app.page.emulateMedia({ colorScheme: 'light' });
    await openNew(app.page);
  });
  after(async () => {
    assert.deepEqual(app.errors, []);
    await app?.close();
  });

  it('терраса из библиотеки вплотную к дому: стены не меняются, замечаний и перил со стороны дома нет', async () => {
    const { page } = app;
    await page.click('#boundRoomBtn');
    await page.click('#roomCards .room-card[data-type="living"]');
    let p = await toClient(page, 0, 0);
    await page.mouse.click(p.x, p.y);
    await page.waitForFunction(() => window.__kepler.state.project.rooms.length === 1);
    await page.keyboard.press('Escape');
    living = await st(page, () => window.__kepler.state.project.rooms[0]);
    await st(page, () => { window.__kepler.select(null); window.__kepler.fitView(); });
    const before = await wallsJson(page);
    await shot(page, 'rail-1-house');
    // Терраса 4000×2500 ниже дома: курсор чуть дальше наружной грани — магнит.
    await page.click('#boundRoomBtn');
    await page.click('#roomCards .room-card[data-type="terrace"]');
    const cx = living.x + living.w / 2;
    p = await toClient(page, cx, living.y + living.h + 250 + 1250 + 60);
    await page.mouse.move(p.x, p.y);
    await page.mouse.click(p.x, p.y);
    await page.waitForFunction(() => window.__kepler.state.project.rooms.length === 2);
    await page.keyboard.press('Escape');
    terrace = await st(page, () => window.__kepler.state.project.rooms.find((r) => r.type === 'terrace'));
    assert.equal(terrace.y, living.y + living.h + 250, 'прижата к наружной грани стены, без перегородки');
    assert.equal(await wallsJson(page), before, 'стены дома не изменились');
    const info = await st(page, async () => {
      const { roomOverlaps } = await import('./core/norms.js');
      const s = window.__kepler.state;
      return { overlaps: roomOverlaps(s.project).length, eaten: s.project.rooms.some((r) => r.eatBase) };
    });
    assert.deepEqual(info, { overlaps: 0, eaten: false });
    const list = await railings(page, terrace.id);
    const houseFrom = living.x - 250 - terrace.x; const houseTo = living.x + living.w + 250 - terrace.x;
    assert.ok(!list.some((s) => s.side === 0 && s.to > houseFrom + 1 && s.from < houseTo - 1), 'нет перил на стыке с домом');
    assert.ok(list.some((s) => s.side === 2));
    // Вписываем дом вместе с террасой: после первого fitView (только дом)
    // нижние перила оказывались под плавающей палитрой этапов (#projectRoute),
    // и клики следующих шагов попадали в неё, а не в холст.
    await st(page, () => { window.__kepler.select(null); window.__kepler.fitView(); });
    await settleView(page);
    await shot(page, 'rail-2-terrace');
  });

  it('клик по перилам выбирает сегмент: «Свойства» и плашка', async () => {
    const { page } = app;
    const p = await toClient(page, terrace.x + terrace.w / 2, terrace.y + terrace.h - 35);
    await page.mouse.click(p.x, p.y);
    const sel = await st(page, () => window.__kepler.state.selection);
    assert.equal(sel?.type, 'railing');
    assert.equal(sel.roomId, terrace.id);
    assert.match(await page.textContent('#propsBody'), /Перила/);
    assert.equal(await page.isVisible('#selectionToolbar [data-selection-action="railing-split"]'), true);
    await shot(page, 'rail-3-selected');
  });

  it('ручка конца укорачивает сегмент; Ctrl+Z — одним шагом', async () => {
    const { page } = app;
    const seg = (await railings(page, terrace.id)).find((s) => s.side === 2);
    const mid = seg.edge - seg.outward * 35;
    const a = await toClient(page, seg.b, mid);
    const b = await toClient(page, seg.b - 1000, mid);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move((a.x + b.x) / 2, a.y, { steps: 4 });
    await page.mouse.move(b.x, b.y, { steps: 4 });
    await page.mouse.up();
    const after = (await railings(page, terrace.id)).find((s) => s.id === seg.id);
    assert.ok(Math.abs((after.to - after.from) - (seg.to - seg.from - 1000)) <= 100, `длина ${after.to - after.from}`);
    assert.equal(await st(page, (id) => Array.isArray(window.__kepler.state.project.rooms.find((r) => r.id === id).railings), terrace.id), true);
    await shot(page, 'rail-4-shortened');
    await page.keyboard.press('Control+z');
    const undone = await st(page, (id) => window.__kepler.state.project.rooms.find((r) => r.id === id).railings, terrace.id);
    assert.equal(undone, undefined, 'отмена вернула перила по умолчанию');
  });

  it('«Разделить», «Удалить» часть, «Тип»', async () => {
    const { page } = app;
    const p = await toClient(page, terrace.x + terrace.w * 0.75, terrace.y + terrace.h - 35);
    await page.mouse.click(p.x, p.y);
    assert.equal(await st(page, () => window.__kepler.state.selection?.type), 'railing');
    await page.click('#selectionToolbar [data-selection-action="railing-split"]');
    await page.waitForFunction((id) => (window.__kepler.state.project.rooms.find((r) => r.id === id).railings || [])
      .filter((s) => s.side === 2).length === 2, terrace.id);
    let side2 = (await railings(page, terrace.id)).filter((s) => s.side === 2);
    assert.equal(side2.length, 2, 'разделено на два');
    await page.click('#selectionToolbar [data-selection-action="railing-type"]');
    await page.waitForFunction(() => {
      const s = window.__kepler.state;
      const room = s.project.rooms.find((r) => r.id === s.selection?.roomId);
      return room?.railings?.find((x) => x.id === s.selection.id)?.type === 'balusters';
    });
    const typed = await st(page, () => window.__kepler.state.selection);
    assert.equal((await railings(page, terrace.id)).find((s) => s.id === typed.id).type, 'balusters');
    await page.keyboard.press('Delete');
    side2 = (await railings(page, terrace.id)).filter((s) => s.side === 2);
    assert.equal(side2.length, 1, 'часть удалена');
    assert.equal(await st(page, () => window.__kepler.state.selection), null);
  });

  it('сохранение и загрузка файла сохраняют перила', async () => {
    const { page } = app;
    const same = await st(page, async (id) => {
      const m = await import('./core/model.js');
      const s = window.__kepler.state;
      const back = m.deserializeProject(m.serializeProject(s.project));
      const a = s.project.rooms.find((r) => r.id === id).railings;
      const b = back.levels.find((l) => l.id === s.project.activeLevel).rooms.find((r) => r.id === id).railings;
      return JSON.stringify(a) === JSON.stringify(b) && a.length > 0;
    }, terrace.id);
    assert.equal(same, true);
  });

  it('3D: клик по перилам выбирает, Delete удаляет', async () => {
    const { page } = app;
    // Правая сторона — стекло (крупная цель для клика).
    const right = (await railings(page, terrace.id)).find((s) => s.side === 1);
    const p = await toClient(page, right.edge - 35, (right.a + right.b) / 2);
    await page.mouse.click(p.x, p.y);
    assert.equal(await st(page, () => window.__kepler.state.selection?.type), 'railing');
    await page.selectOption('#railType', 'glass');
    await page.click('#view3dBtn');
    await page.waitForFunction(() => window.__kepler.debug3d().active);
    const before = await st(page, () => window.__kepler.debug3d().railings);
    assert.ok(before > 0, 'перила в 3D');
    await st(page, () => window.__kepler.select(null));
    const at = await st(page, (q) => window.__kepler.screen3d(q), { x: right.edge - 35, y: (right.a + right.b) / 2, z: 500 });
    const hit = await st(page, ([x, y]) => window.__kepler.pick3d(x, y), [at.x, at.y]);
    assert.equal(hit?.type, 'railing', `под точкой ${JSON.stringify(hit)}`);
    await page.mouse.click(at.x, at.y);
    const sel = await st(page, () => window.__kepler.state.selection);
    assert.equal(sel?.type, 'railing');
    assert.equal(sel.id, right.id);
    assert.ok((await st(page, () => window.__kepler.debug3d().highlightedAll)) > 0, 'подсвечены');
    await shot(page, 'rail-5-3d');
    await page.keyboard.press('Delete');
    assert.ok(!(await railings(page, terrace.id)).some((s) => s.id === right.id), 'удалены');
    assert.ok((await st(page, () => window.__kepler.debug3d().railings)) < before);
  });
});
