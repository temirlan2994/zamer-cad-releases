// e2e поворота ВИДА (ui/view-align.js): «Выровнять вид» по двум точкам с
// привязкой, свои углы у «Плана»/«Участка»/«Ландшафта», сохранение после
// перезагрузки, «Сбросить», «Развернуть оси дома по виду», касания.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  dropOnCanvas, startApp, openSample, openNew,
} from './helpers.mjs';

const snap = (page) => page.evaluate(() => {
  const s = window.__kepler.state;
  return {
    mode: s.modeName,
    view: ((s.view.rotation || 0) * 180) / Math.PI,
    angles: s.project.settings.viewAngles || null,
    north: s.project.site.north || 0,
    building: s.project.building,
    data: JSON.stringify({ b: s.project.building, l: s.project.levels, site: s.project.site }),
  };
});

// Клиентская точка по координатам дома (план) или мира.
async function client(page, fnName, x, y) {
  const box = await (await page.$('#canvas')).boundingBox();
  const s = await page.evaluate(([f, px, py]) => window.__kepler[f](px, py), [fnName, x, y]);
  return { x: box.x + s.x, y: box.y + s.y };
}

const angDiff = (a, b) => { const d = Math.abs((((a - b) % 360) + 540) % 360 - 180); return d; };

describe('поворот вида', () => {
  let app;
  before(async () => { app = await startApp(); await openSample(app.page); });
  after(async () => { await app?.close(); });

  it('угол вида «Плана» из поля: крутится камера, данные дома те же', async () => {
    const { page } = app;
    const s0 = await snap(page);
    await page.click('#viewBtn');
    await page.fill('#viewAngleInput', '25');
    await page.press('#viewAngleInput', 'Enter');
    await page.locator('#viewAngleInput').blur();
    const s1 = await snap(page);
    assert.equal(s1.angles?.plan, 25);
    assert.ok(Math.abs(s1.view + 25) < 0.01, `вид ${s1.view}`);
    assert.equal(s1.data, s0.data, 'дом, комнаты и участок не изменились');
    assert.equal(await page.$eval('#viewBtn', (n) => n.classList.contains('active')), true);
  });

  it('«Выровнять вид» двумя кликами по краю комнаты (с привязкой к углам)', async () => {
    const { page } = app;
    const s0 = await snap(page);
    const r = await page.evaluate(() => {
      const x = window.__kepler.state.project.rooms.find((q) => q.type === 'living');
      return { x: x.x, y: x.y, w: x.w, h: x.h };
    });
    if (await page.$eval('#viewPanel', (n) => n.hidden)) await page.click('#viewBtn');
    await page.click('#alignBtn');
    assert.equal(await page.evaluate(() => window.__kepler.state.tool?.kind), 'align-view');
    // Клики чуть мимо углов (несимметрично): без привязки линия шла бы под углом.
    const a = await client(page, 'planToScreen', r.x + 50, r.y + 50);
    const b = await client(page, 'planToScreen', r.x + r.w - 50, r.y + 20);
    await page.mouse.move(a.x, a.y);
    await page.mouse.click(a.x, a.y);
    await page.mouse.move(b.x, b.y, { steps: 4 });
    await page.mouse.click(b.x, b.y);
    const s1 = await snap(page);
    assert.equal(await page.evaluate(() => window.__kepler.state.tool), null);
    // Край комнаты идёт по оси дома → на экране горизонтален.
    const edge = await page.evaluate(([x, y, w]) => {
      const k = window.__kepler;
      const p = k.planToScreen(x, y);
      const q = k.planToScreen(x + w, y);
      return (Math.atan2(q.y - p.y, q.x - p.x) * 180) / Math.PI;
    }, [r.x, r.y, r.w]);
    assert.ok(Math.abs(edge) < 0.01, `край комнаты под ${edge}°`);
    assert.ok(Math.abs(s1.angles.plan - s0.building.rotation) < 0.01 || angDiff(s1.angles.plan, s0.building.rotation) < 0.01);
    assert.equal(s1.data, s0.data, 'данные не изменились');
  });

  it('повторный клик по ⟲ во время выравнивания — отмена', async () => {
    const { page } = app;
    if (await page.$eval('#viewPanel', (n) => n.hidden)) await page.click('#viewBtn');
    await page.click('#alignBtn');
    assert.equal(await page.$eval('#viewBtn', (n) => n.classList.contains('armed')), true);
    await page.click('#viewBtn');
    assert.equal(await page.evaluate(() => window.__kepler.state.tool), null);
    assert.equal(await page.$eval('#viewBtn', (n) => n.classList.contains('armed')), false);
  });

  it('у «Участка» свой угол, «План» и «Ландшафт» его не наследуют', async () => {
    const { page } = app;
    const p0 = await snap(page);
    await page.click('#modeSiteBtn');
    const s0 = await snap(page);
    assert.ok(Math.abs(angDiff(-s0.view, s0.north)) < 0.01, 'по умолчанию север вверх');
    await page.click('#viewBtn');
    await page.click('#alignBtn');
    // Линия под −30° на экране, от центра холста; Shift — без привязок.
    const box = await (await page.$('#canvas')).boundingBox();
    const c = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    const d = { x: c.x + 150 * Math.cos(-Math.PI / 6), y: c.y + 150 * Math.sin(-Math.PI / 6) };
    const w = await page.evaluate(([cx, cy, dx, dy, bx, by]) => {
      const k = window.__kepler;
      return [k.screenToWorld(cx - bx, cy - by), k.screenToWorld(dx - bx, dy - by)];
    }, [c.x, c.y, d.x, d.y, box.x, box.y]);
    await page.keyboard.down('Shift');
    await page.mouse.click(c.x, c.y);
    await page.mouse.click(d.x, d.y);
    await page.keyboard.up('Shift');
    const s1 = await snap(page);
    const dy = await page.evaluate(([p, q]) => {
      const k = window.__kepler;
      return k.worldToScreen(q.x, q.y).y - k.worldToScreen(p.x, p.y).y;
    }, w);
    assert.ok(Math.abs(dy) < 0.5, `линия не горизонтальна: dy=${dy}`);
    assert.ok(Number.isFinite(s1.angles.site));
    assert.ok(angDiff(s1.angles.site, s1.angles.plan) > 5, 'углы «Плана» и «Участка» разные');
    assert.equal(s1.angles.plan, p0.angles.plan, '«План» не изменился');
    assert.equal(s1.data, p0.data, 'данные не изменились');

    await page.click('#landscapeBtn');
    const l = await snap(page);
    assert.ok(angDiff(-l.view, l.north) < 0.01, '«Ландшафт» — по умолчанию север вверх');
    await page.click('#modePlanBtn');
    assert.ok(angDiff(-(await snap(page)).view, s1.angles.plan) < 0.01, '«План» — свой угол');
    await page.click('#modeSiteBtn');
    assert.ok(angDiff(-(await snap(page)).view, s1.angles.site) < 0.01, '«Участок» — свой угол');
  });

  it('углы сохраняются после перезагрузки', async () => {
    const { page } = app;
    await page.click('#modePlanBtn');
    const before = await snap(page);
    await page.evaluate(async () => { (await import('./ui/store.js')).flushAutosave(); });
    await page.reload();
    await page.waitForFunction(() => Boolean(window.__kepler));
    if (await page.$eval('#startScreen', (n) => !n.hidden)) await page.click('#startContinue');
    const after = await snap(page);
    assert.deepEqual(after.angles, before.angles);
    assert.deepEqual(after.building, before.building);
    assert.ok(angDiff(-after.view, after.mode === 'plan' ? after.angles.plan : after.angles.site) < 0.01, `вид ${after.view}`);
  });

  it('«Сбросить» возвращает умолчание только текущему режиму', async () => {
    const { page } = app;
    if ((await snap(page)).mode !== 'plan') await page.click('#modePlanBtn');
    const s0 = await snap(page);
    await page.click('#viewBtn');
    await page.click('#viewAngleReset');
    const s1 = await snap(page);
    assert.equal(s1.angles?.plan, undefined);
    assert.equal(s1.angles?.site, s0.angles.site, '«Участок» не тронут');
    assert.ok(angDiff(-s1.view, s1.building.rotation) < 0.01, '«План» снова по осям дома');
    assert.equal(s1.data, s0.data);
  });

  it('«Развернуть оси дома по виду» поворачивает дом; Ctrl+Z возвращает', async () => {
    const { page } = app;
    await page.click('#modeSiteBtn');
    const s0 = await snap(page);
    await page.click('#viewBtn');
    await page.click('#axesToViewBtn');
    const s1 = await snap(page);
    assert.ok(angDiff(s1.building.rotation, s0.building.rotation) > 1, 'дом повернулся');
    assert.ok(angDiff(s1.building.rotation % 90, ((s0.angles.site % 90) + 90) % 90) < 0.01
      || angDiff((s1.building.rotation % 90) + 90, ((s0.angles.site % 90) + 90) % 90) < 0.01, 'оси по виду');
    assert.ok(angDiff(-s1.view, s0.angles.site) < 0.01, 'камера осталась');
    await page.mouse.click(5, 5); // фокус с кнопки
    await page.keyboard.press('Control+z');
    const s2 = await snap(page);
    assert.deepEqual(s2.building, s0.building);
  });

  it('без ошибок в консоли', () => {
    assert.deepEqual(app.errors, []);
  });
});

describe('поворот вида: автоматические оси при вставке помещения', () => {
  let app;
  before(async () => { app = await startApp(); await openNew(app.page); });
  after(async () => { await app?.close(); });

  it('на непустом плане оси встают по виду, а один Ctrl+Z возвращает и комнату, и поворот', async () => {
    const { page } = app;
    await dropOnCanvas(page, 'application/x-kepler-room', 'living');
    await page.waitForFunction(() => window.__kepler.state.project.rooms.length === 1);

    // На непустом плане угол вида сам по себе оси дома не меняет.
    await page.click('#viewBtn');
    await page.fill('#viewAngleInput', '37');
    await page.press('#viewAngleInput', 'Enter');
    await page.locator('#viewAngleInput').blur();
    if (!(await page.$eval('#viewPanel', (node) => node.hidden))) await page.click('#viewBtn');

    const before = await page.evaluate(() => {
      const s = window.__kepler.state;
      return {
        building: structuredClone(s.project.building),
        ids: s.project.rooms.map((room) => room.id),
        angle: s.project.settings.viewAngles?.plan,
      };
    });
    assert.equal(before.angle, 37);

    await page.evaluate(async () => (await import('./ui/tools.js')).startPlaceRoom('bedroom'));
    assert.equal(await page.evaluate(() => window.__kepler.state.tool?.kind), 'place-room');
    const box = await (await page.$('#canvas')).boundingBox();
    const click = { x: box.x + box.width * 0.78, y: box.y + box.height * 0.76 };
    await page.mouse.click(click.x, click.y);
    await page.waitForFunction((count) => window.__kepler.state.project.rooms.length === count + 1, before.ids.length);

    const placed = await page.evaluate((oldIds) => {
      const k = window.__kepler;
      const room = k.state.project.rooms.find((candidate) => !oldIds.includes(candidate.id));
      const canvasBox = document.getElementById('canvas').getBoundingClientRect();
      const center = k.planToScreen(room.x + room.w / 2, room.y + room.h / 2);
      const a = k.planToScreen(room.x, room.y);
      const b = k.planToScreen(room.x + room.w, room.y);
      return {
        building: structuredClone(k.state.project.building),
        angle: k.state.project.settings.viewAngles.plan,
        center: { x: canvasBox.left + center.x, y: canvasBox.top + center.y },
        edgeDeg: (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI,
      };
    }, before.ids);

    const aligned = Math.min(...[0, 90, 180, 270]
      .map((quarter) => angDiff(placed.building.rotation, placed.angle + quarter)));
    assert.ok(aligned < 0.01, `оси ${placed.building.rotation}°, вид ${placed.angle}°`);
    assert.ok(angDiff(placed.building.rotation, before.building.rotation) > 1, 'оси дома автоматически повернулись');
    assert.ok(Math.hypot(placed.center.x - click.x, placed.center.y - click.y) < 30,
      `центр сместился от клика: ${JSON.stringify({ click, center: placed.center })}`);
    const edgeAligned = Math.min(...[0, 90, 180, 270].map((quarter) => angDiff(placed.edgeDeg, quarter)));
    assert.ok(edgeAligned < 0.01, `грань помещения под ${placed.edgeDeg}°`);

    await page.keyboard.press('Control+z');
    await page.waitForFunction((count) => window.__kepler.state.project.rooms.length === count, before.ids.length);
    const undone = await page.evaluate(() => ({
      building: structuredClone(window.__kepler.state.project.building),
      ids: window.__kepler.state.project.rooms.map((room) => room.id),
      angle: window.__kepler.state.project.settings.viewAngles?.plan,
    }));
    assert.deepEqual(undone.ids, before.ids, 'один Undo удалил новую комнату');
    assert.deepEqual(undone.building, before.building, 'тот же Undo вернул прежние оси дома');
    assert.equal(undone.angle, before.angle, 'пользовательский угол вида сохранился');
    assert.deepEqual(app.errors, []);
  });
});

describe('поворот вида: новый план и касания', () => {
  let app;
  before(async () => { app = await startApp({ mobile: true }); await openNew(app.page); });
  after(async () => { await app?.close(); });

  it('тапами по двум точкам: пустой «План» — оси дома по виду (вариант А)', async () => {
    const { page } = app;
    await page.tap('#mobileBar [data-sheet="props"]'); // телефон: поворот вида — в «Свойствах» вида
    await page.tap('#viewsAlignBtn');
    assert.equal(await page.evaluate(() => document.body.classList.contains('sheet-props')), false, 'лист уехал — точки ставят на плане');
    const box = await (await page.$('#canvas')).boundingBox();
    const c = { x: box.x + box.width / 2, y: box.y + box.height / 3 };
    await page.touchscreen.tap(c.x, c.y);
    await page.touchscreen.tap(c.x + 120, c.y + 120 * Math.tan(Math.PI / 6));
    const s = await snap(page);
    assert.ok(s.angles && Math.abs(s.angles.plan - 30) < 1, `угол ${JSON.stringify(s.angles)}`);
    assert.ok(Math.abs(s.building.rotation - s.angles.plan) < 1e-6, 'оси дома встали по виду');
    assert.ok(Math.abs(s.view + s.angles.plan) < 0.01);
  });

  it('без ошибок в консоли', () => {
    assert.deepEqual(app.errors, []);
  });
});
