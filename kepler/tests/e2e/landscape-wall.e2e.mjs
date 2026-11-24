// e2e «Ландшафт»: подпорная стенка и террасы-уровни — стенка рисуется по
// точкам из каталога, панель (высота, перепад, сторона верха, капа, объём),
// отметка площадки «+0.45» и автоматический марш к краю площадки, Ctrl+Z, 3D-грани,
// оба стиля без ошибок консоли.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, openSample, worldToClient, dropOnCanvas } from './helpers.mjs';

const MIME = 'application/x-kepler-landscape';
const objects = (page) => page.evaluate(() => JSON.parse(JSON.stringify(window.__kepler.state.project.site.landscape?.objects || [])));
const byKind = async (page, kind) => (await objects(page)).find((o) => o.kind === kind);
const undoLen = (page) => page.evaluate(async () => (await import('./ui/state.js')).history.undo.length);
const at = (page, p) => page.evaluate(([x, y]) => window.__kepler.worldToScreen(x, y), [p.x, p.y]);

async function clickWorld(page, x, y) {
  const p = await worldToClient(page, x, y);
  await page.mouse.move(p.x, p.y);
  await page.mouse.click(p.x, p.y);
}

async function setField(page, sel, value) {
  await page.fill(sel, String(value));
  await page.press(sel, 'Enter');
}

describe('ландшафт: подпорная стенка и отметки уровня', () => {
  let app;
  before(async () => {
    app = await startApp();
    await openSample(app.page);
    await app.page.click('#landscapeBtn');
  });
  after(async () => { await app?.close(); });

  it('стенка: карточка → две точки → Enter; панель — высота, перепад, сторона, капа, объём', async () => {
    const { page } = app;
    await page.click('#lsTabs button[data-ls-cat="site"]');
    await page.click('#lsItems [data-ls-kind="retaining-wall"]');
    const undo0 = await undoLen(page);
    await clickWorld(page, 9000, -4500);
    await clickWorld(page, 14000, -4500);
    await page.keyboard.press('Enter');
    const w = await byKind(page, 'retaining-wall');
    assert.ok(w, 'стенка создана');
    assert.equal(w.points.length, 2);
    assert.equal(await undoLen(page), undo0 + 1);
    const panel = await page.textContent('#propsPanel');
    assert.match(panel, /Подпорная стенка/);
    assert.match(panel, /Толщина, м/);
    assert.match(panel, /Объём бетона/);
    await setField(page, '#lsRwH', 1500);
    await page.waitForFunction(() => window.__kepler.state.project.site.landscape.objects.find((o) => o.kind === 'retaining-wall').height === 1500);
    await setField(page, '#lsRwDrop', 1200);
    await page.selectOption('#lsRwUpper', 'right');
    await page.check('#lsRwCap');
    await page.selectOption('#lsVariant', 'gabion');
    const w2 = await byKind(page, 'retaining-wall');
    assert.deepEqual([w2.height, w2.variant], [1500, 'gabion']);
    assert.deepEqual(w2.meta, { upper: 'right', drop: 1200, cap: true, capH: 60 });
    const text = await page.textContent('#propsPanel');
    assert.match(text, /Парапет над верхом грунта\s*300 мм/);
    assert.match(text, /Объём кладки/);
    // Ctrl+Z — по шагу (снимок как у остальных): материал, затем капа.
    await page.evaluate(() => document.activeElement?.blur());
    await page.keyboard.press('Control+z');
    assert.equal((await byKind(page, 'retaining-wall')).variant, 'concrete');
    await page.keyboard.press('Control+z');
    assert.equal((await byKind(page, 'retaining-wall')).meta.cap, false);
    await page.keyboard.press('Control+y');
    await page.keyboard.press('Control+y');
    assert.equal((await byKind(page, 'retaining-wall')).variant, 'gabion');
  });

  it('отметка площадки: поле «Отметка», подпись «+0.45», пусто — без поля', async () => {
    const { page } = app;
    await page.evaluate(async () => {
      const L = await import('./core/landscape.js');
      const st = await import('./ui/store.js');
      st.mutate(() => {
        window.__kepler.state.project.site.landscape.objects.push(L.createLandscapeObject('paving-area', 0, 0, {
          id: 'pv', points: [{ x: 9000, y: -3500 }, { x: 14000, y: -3500 }, { x: 14000, y: -500 }, { x: 9000, y: -500 }],
        }));
      });
      window.__kepler.select({ type: 'landscape', ids: ['pv'] });
    });
    assert.match(await page.textContent('#propsPanel'), /Отметка поверхности, мм/);
    await setField(page, '#lsElev', 450);
    await page.waitForFunction(() => window.__kepler.state.project.site.landscape.objects.find((o) => o.id === 'pv').elev === 450);
    const { measure } = await page.evaluate(async () => {
      const R = await import('./ui/render-landscape.js');
      const L = await import('./core/landscape.js');
      const o = window.__kepler.state.project.site.landscape.objects.find((x) => x.id === 'pv');
      return { measure: `${R.landscapeMeasure(o)} ${L.fmtElev(o.elev)}` };
    });
    assert.match(measure, /\+0\.45$/);
    await setField(page, '#lsElev', '');
    assert.equal('elev' in (await objects(page)).find((o) => o.id === 'pv'), false);
    await setField(page, '#lsElev', 450);
  });

  it('лестница: отметки низа и верха сразу меняют высоту подъёма', async () => {
    const { page } = app;
    await dropOnCanvas(page, MIME, 'stairs-out', await at(page, { x: 11500, y: 2000 }));
    assert.match(await page.textContent('#propsPanel'), /Отметка низа/);
    await setField(page, '#lsElev', 0);
    await setField(page, '#lsElevTo', 450);
    const st = await byKind(page, 'stairs-out');
    assert.deepEqual([st.elev, st.elevTo, st.height, st.h], [0, 450, 450, 900]);
    assert.match(await page.textContent('#propsPanel'), /Подступенок\s*150 мм/);
  });

  it('лестница от выбранного края мощения: один клик и автоматический разворот', async () => {
    const { page } = app;
    await page.evaluate(() => window.__kepler.select({ type: 'landscape', ids: ['pv'] }));
    await page.getByText('Лестница к краю площадки', { exact: true }).click();
    await page.click('#lsAttachStairs');
    await clickWorld(page, 11500, -500);
    const stair = await page.evaluate(() => {
      const state = window.__kepler.state;
      return state.project.site.landscape.objects.find((o) => o.id === state.selection.ids[0]);
    });
    assert.deepEqual([stair.kind, stair.elev, stair.elevTo, stair.rotation], ['stairs-out', 0, 450, 0]);
    assert.equal(stair.y - stair.h / 2, -500);
    await page.evaluate(() => window.__kepler.select({ type: 'landscape', ids: ['pv'] }));
    await setField(page, '#lsElev', 750);
    const raised = (await objects(page)).find((o) => o.id === stair.id);
    assert.deepEqual([raised.elevTo, raised.height, raised.h, raised.y - raised.h / 2], [750, 750, 1500, -500]);
    await setField(page, '#lsElev', 450);
  });

  it('лаунж: карточка из каталога, диаметр, поворот и уровень пола', async () => {
    const { page } = app;
    await page.fill('#lsSearch', 'лаунж');
    await page.click('#lsItems [data-ls-kind="sunken-lounge"]');
    await clickWorld(page, 14000, 2500);
    await page.keyboard.press('Escape');
    const lounge = await byKind(page, 'sunken-lounge');
    await page.evaluate((id) => window.__kepler.select({type: 'landscape', ids: [id]}), lounge.id);
    await setField(page, '#lsW', 4.2);
    await setField(page, '#lsRot', 90);
    await setField(page, '#lsElev', -450);
    await setField(page, '#lsElevTo', 150);
    const updated = await byKind(page, 'sunken-lounge');
    assert.deepEqual([updated.w, updated.h, updated.rotation, updated.elev, updated.elevTo], [4200, 4200, 90, -450, 150]);
  });

  it('3D: стенка и приподнятая площадка дают грани; оба стиля и подписи без ошибок', async () => {
    const { page } = app;
    const top = await page.evaluate(async () => {
      const M = await import('./core/mesh3d-landscape.js');
      const f = M.landscapeFaces(window.__kepler.state.project);
      return Math.max(...f.flatMap((x) => x.pts.map((q) => q.z)));
    });
    assert.equal(top, 1500 + 60, 'стенка 1500 + капа 60');
    await page.click('#view3dBtn');
    await page.waitForTimeout(300);
    await page.keyboard.press('Escape');
    for (const style of ['drawing', 'sketch']) {
      await page.evaluate(async (s) => {
        const k = window.__kepler;
        k.state.lsStyle = s;
        k.state.lsVis = { ...(k.state.lsVis || {}), labels: s === 'drawing' };
        (await import('./ui/view.js')).requestDraw();
      }, style);
      await page.waitForTimeout(200);
    }
    assert.deepEqual(app.errors, []);
  });
});
