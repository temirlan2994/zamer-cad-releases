// e2e шага B4 (видовые экраны листа, как в Revit): обрезка вида ручками
// реальной мышью (чернила вне рамки исчезают), «Обрезать вид» и «Сбросить
// обрезку», Ctrl+Z; номера видов в подписи, «Л3-1» в дереве, «Лист 3, вид
// 1» в «Свойствах» вида; двойной клик открывает вид, Esc — назад к листу;
// камера 3D на листе после «Обновить из 3D»; растр под зум листа; файл;
// PDF листа с обрезкой; телефон — щипок и сдвиг листа пальцами.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { startApp, openSample, uploadText } from './helpers.mjs';

const OUT = process.env.KEPLER_SHOTS || '';
const drawn = (page) => page.evaluate(() => window.__kepler.state.sheetDrawn);
const undoLen = (page) => page.evaluate(async () => (await import('./ui/state.js')).history.undo.length);
const vpOf = async (page, viewId) => (await drawn(page)).viewports.find((v) => v.viewId === viewId);

async function sheetToClient(page, x, y) {
  const box = await page.locator('#sheetCanvas').boundingBox();
  const d = await drawn(page);
  return { x: box.x + d.ox + x * d.k, y: box.y + d.oy + y * d.k };
}

// Доля «чернил» (не белой бумаги) в прямоугольнике листа (мм).
const inkIn = (page, b) => page.evaluate((r) => {
  const c = document.querySelector('#sheetCanvas');
  const d = window.__kepler.state.sheetDrawn;
  const dpr = c.width / c.clientWidth;
  const x = Math.round((d.ox + r.x0 * d.k) * dpr);
  const y = Math.round((d.oy + r.y0 * d.k) * dpr);
  const w = Math.max(1, Math.round((r.x1 - r.x0) * d.k * dpr));
  const h = Math.max(1, Math.round((r.y1 - r.y0) * d.k * dpr));
  const { data } = c.getContext('2d').getImageData(x, y, w, h);
  let ink = 0;
  for (let i = 0; i < data.length; i += 16) if (data[i] + data[i + 1] + data[i + 2] < 720) ink += 1;
  return ink / (data.length / 16);
}, b);

// Отпечаток пикселей прямоугольника листа (для «картинка сменилась»).
const pixHash = (page, b) => page.evaluate((r) => {
  const c = document.querySelector('#sheetCanvas');
  const d = window.__kepler.state.sheetDrawn;
  const dpr = c.width / c.clientWidth;
  const { data } = c.getContext('2d').getImageData(Math.round((d.ox + r.x0 * d.k) * dpr), Math.round((d.oy + r.y0 * d.k) * dpr),
    Math.max(1, Math.round((r.x1 - r.x0) * d.k * dpr)), Math.max(1, Math.round((r.y1 - r.y0) * d.k * dpr)));
  let h = 0;
  for (let i = 0; i < data.length; i += 4) h = (h * 31 + data[i] + data[i + 1] * 3 + data[i + 2] * 7) % 1e9;
  return h;
}, b);

async function download(page, click) {
  const [dl] = await Promise.all([page.waitForEvent('download'), click()]);
  return { name: dl.suggestedFilename(), bytes: await readFile(await dl.path()) };
}

// Лист 3 с планом (1:100), фасадом Север (1:100) и разрезом (1:200).
async function setupSheet(page) {
  await page.evaluate(async () => {
    const st = window.__kepler.state;
    const { mutate } = await import('./ui/store.js');
    const V = await import('./core/views.js');
    const rs = st.project.rooms;
    const y = (Math.min(...rs.map((r) => r.y)) + Math.max(...rs.map((r) => r.y + r.h))) / 2;
    mutate(() => {
      V.addSectionView(st.project, {
        levelId: st.project.activeLevel, a: { x: Math.min(...rs.map((r) => r.x)) - 1500, y }, b: { x: Math.max(...rs.map((r) => r.x + r.w)) + 1500, y },
      });
      const s = V.addSheet(st.project, { no: '3' });
      V.placeView(st.project, s.id, `plan:${st.project.activeLevel}`, { x: 110, y: 115, scale: 100 });
      V.placeView(st.project, s.id, 'elev-N', { x: 300, y: 62, scale: 100 });
      V.placeView(st.project, s.id, 'sec-1', { x: 300, y: 180, scale: 200 });
    });
  });
  await page.click('#propsTabSheets');
  await page.dblclick('#sheetsList [data-sheet="user:sh-1"] .sheets-name');
  await page.waitForSelector('#sheetCanvas');
}

async function selectVp(page, viewId) {
  const vp = await vpOf(page, viewId);
  const p = await sheetToClient(page, (vp.box.x0 + vp.box.x1) / 2, (vp.box.y0 + vp.box.y1) / 2);
  await page.mouse.click(p.x, p.y);
  assert.equal((await drawn(page)).selected, vp.id, `выбран ${viewId}`);
  return vp;
}

async function deselect(page) {
  await page.evaluate(() => { window.__kepler.state.sheetVp = null; document.dispatchEvent(new CustomEvent('kepler:view')); });
  await page.evaluate(async () => (await import('./ui/sheet-view.js')).drawEditor());
}

describe('B4: обрезка, номера, двойной клик, камера 3D — компьютер 1440', () => {
  let app;
  let full = null; // рамка фасада без обрезки
  before(async () => { app = await startApp({ width: 1440, height: 900 }); await openSample(app.page); await setupSheet(app.page); });
  after(async () => { await app?.close(); });

  it('номера видов: подпись «№ · Название», маркер, «Л3-N» в дереве', async () => {
    const { page } = app;
    const d = await drawn(page);
    assert.deepEqual(d.viewports.map((v) => [v.viewId, v.no]), [[`plan:${await page.evaluate(() => window.__kepler.state.project.activeLevel)}`, '1'], ['elev-N', '2'], ['sec-1', '3']]);
    for (const v of d.viewports) {
      assert.ok(!v.empty, `${v.viewId} не пуст`);
      assert.ok(await inkIn(page, { x0: v.box.cap.x0, y0: v.box.cap.y0, x1: v.box.cap.x0 + 7, y1: v.box.cap.y1 }) > 0.04, `маркер у ${v.viewId}`);
    }
    await page.click('#propsTabViews');
    assert.equal(await page.textContent('#viewTree [data-view="elev-N"] .vt-sheet'), 'Л3-2');
    assert.equal(await page.textContent('#viewTree [data-view="sec-1"] .vt-sheet'), 'Л3-3');
    await selectVp(page, 'elev-N');
    await page.click('#propsTabMain');
    assert.match(await page.textContent('#vpPropsSub'), /^Лист 3, вид 2/);
    assert.match(await page.textContent('#vpMarker'), /2 \/ Л3/);
    // Свой номер: «7», пусто — снова по порядку.
    await page.fill('#vpNo', '7');
    await page.press('#vpNo', 'Enter');
    assert.equal((await vpOf(page, 'elev-N')).no, '7');
    await page.fill('#vpNo', '1');
    await page.press('#vpNo', 'Enter');
    assert.match(await page.textContent('#toast'), /Номер 1 уже занят/);
    assert.equal((await vpOf(page, 'elev-N')).no, '7');
    await page.fill('#vpNo', '');
    await page.press('#vpNo', 'Enter');
    assert.equal((await vpOf(page, 'elev-N')).no, '2');
    assert.deepEqual(app.errors, []);
  });

  it('ручка обрезки реальной мышью: правый край к середине — чернила справа исчезли, вид не сдвинулся', async () => {
    const { page } = app;
    const vp = await selectVp(page, 'elev-N');
    full = vp.box;
    const w = full.x1 - full.x0;
    const right = { x0: full.x0 + w * 0.62, y0: full.y0 + 1, x1: full.x1 - 1, y1: full.y1 - 1 };
    await deselect(page);
    const inkBefore = await inkIn(page, right);
    assert.ok(inkBefore > 0.02, `справа есть чертёж: ${inkBefore}`);
    await selectVp(page, 'elev-N');
    const undo = await undoLen(page);
    const from = await sheetToClient(page, full.x1, (full.y0 + full.y1) / 2);
    const to = await sheetToClient(page, full.x0 + w * 0.55, (full.y0 + full.y1) / 2 + 3);
    await page.mouse.move(from.x, from.y);
    assert.equal(await page.$eval('#sheetCanvas', (c) => c.style.cursor), 'ew-resize', 'курсор ручки');
    await page.mouse.down();
    await page.mouse.move((from.x + to.x) / 2, from.y, { steps: 4 });
    await page.mouse.move(to.x, to.y, { steps: 4 });
    await page.mouse.up();
    const cut = await vpOf(page, 'elev-N');
    assert.ok(cut.crop, 'рамка обрезки есть');
    assert.equal(await undoLen(page), undo + 1, 'одна запись истории на жест');
    assert.deepEqual([cut.x, cut.y], [vp.x, vp.y], 'центр вида на месте');
    assert.ok(Math.abs(cut.box.x1 - (full.x0 + w * 0.55)) <= 5.01, `правый край у середины: ${cut.box.x1}`);
    assert.ok(Math.abs(((cut.box.x1 * 1000) % 5000)) < 2 || Math.abs(((cut.box.x1 * 1000) % 5000) - 5000) < 2, `край на сетке 5 мм: ${cut.box.x1}`);
    assert.deepEqual([cut.box.x0, cut.box.y0, cut.box.y1], [full.x0, full.y0, full.y1], 'остальные края на месте');
    assert.equal(cut.box.cap.y0, cut.box.y1);
    await deselect(page);
    const gone = { ...right, x0: Math.max(right.x0, cut.box.x1 + 1.5) };
    const inkAfter = await inkIn(page, gone);
    assert.ok(inkAfter < 0.002, `вне рамки пусто: ${inkAfter}`);
    assert.ok(await inkIn(page, { x0: full.x0 + 2, y0: full.y0 + 2, x1: cut.box.x1 - 2, y1: full.y1 - 2 }) > 0.02, 'внутри рамки чертёж есть');
    assert.deepEqual(app.errors, []);
  });

  it('«Свойства»: «Обрезать вид», «Сбросить обрезку», Ctrl+Z/Ctrl+Y, масштаб тянет рамку', async () => {
    const { page } = app;
    await selectVp(page, 'elev-N');
    await page.click('#propsTabMain');
    assert.equal(await page.isChecked('#vpCrop'), true);
    if (OUT) await page.screenshot({ path: `${OUT}b4-vp-props-crop.png` });
    const crop = (await vpOf(page, 'elev-N')).crop;
    await page.uncheck('#vpCrop');
    let v = await vpOf(page, 'elev-N');
    assert.equal(v.crop.off, true, 'рамка помнится');
    assert.equal(v.box.x1, full.x1, 'вид целиком');
    await page.check('#vpCrop');
    v = await vpOf(page, 'elev-N');
    assert.deepEqual(v.crop, crop);
    // Масштаб 1:200 — рамка в мм вида та же, центр видимой части на месте.
    const c0 = (v.box.x0 + v.box.x1) / 2;
    await page.click('[data-vp-scale="200"]');
    v = await vpOf(page, 'elev-N');
    assert.deepEqual(v.crop, crop);
    assert.ok(Math.abs((v.box.x0 + v.box.x1) / 2 - c0) < 0.2, 'центр рамки на месте');
    await page.keyboard.press('Control+z');
    v = await vpOf(page, 'elev-N');
    assert.equal(v.scale, 100);
    await page.click('#vpCropReset');
    v = await vpOf(page, 'elev-N');
    assert.equal(v.crop, null);
    assert.equal(v.box.x1, full.x1);
    assert.equal(await page.isDisabled('#vpCropReset'), true);
    await page.keyboard.press('Control+z');
    assert.deepEqual((await vpOf(page, 'elev-N')).crop, crop, 'Ctrl+Z вернул обрезку');
    await page.keyboard.press('Control+y');
    assert.equal((await vpOf(page, 'elev-N')).crop, null);
    await page.keyboard.press('Control+z');
    assert.deepEqual((await vpOf(page, 'elev-N')).crop, crop);
    assert.deepEqual(app.errors, []);
  });

  it('двойной клик по фасаду открывает окно вида, Esc — назад к листу; план — так же', async () => {
    const { page } = app;
    const v = await vpOf(page, 'elev-N');
    const p = await sheetToClient(page, (v.box.x0 + v.box.x1) / 2, (v.box.y0 + v.box.y1) / 2);
    await page.mouse.dblclick(p.x, p.y);
    assert.equal(await page.isHidden('#sheetView'), true, 'лист закрыт');
    assert.equal(await page.evaluate(async () => (await import('./ui/elevation-view.js')).openElevationId()), 'elev-N');
    await page.click('#propsTabMain');
    assert.match(await page.textContent('#viewPlacedNo'), /Лист 3, вид 2/);
    assert.ok((await page.evaluate(() => window.__kepler.state.elevationDrawn)).crop, 'в окне вида — рамка обрезки');
    if (OUT) await page.screenshot({ path: `${OUT}b4-elev-crop.png` });
    await page.keyboard.press('Escape');
    assert.equal(await page.isVisible('#sheetCanvas'), true, 'Esc вернул лист');
    assert.equal(await page.evaluate(async () => (await import('./ui/elevation-view.js')).isElevationOpen()), false);
    // План этажа.
    const pl = (await drawn(page)).viewports[0];
    const q = await sheetToClient(page, (pl.box.x0 + pl.box.x1) / 2, (pl.box.y0 + pl.box.y1) / 2);
    await page.mouse.dblclick(q.x, q.y);
    assert.equal(await page.isHidden('#sheetView'), true);
    assert.equal(await page.evaluate(() => window.__kepler.state.modeName), 'plan');
    await page.keyboard.press('Escape');
    assert.equal(await page.isVisible('#sheetCanvas'), true, 'Esc с плана вернул лист');
    assert.deepEqual(app.errors, []);
  });

  it('3D на листе: «Обновить из 3D» — камера окна 3D вместо аксонометрии', async () => {
    const { page } = app;
    await page.evaluate(async () => {
      const st = window.__kepler.state;
      const { mutate } = await import('./ui/store.js');
      const V = await import('./core/views.js');
      mutate(() => { V.placeView(st.project, 'sh-1', '3d', { x: 110, y: 235, scale: 500 }); });
    });
    const v0 = await vpOf(page, '3d');
    assert.ok(v0 && !v0.empty, '3D на листе');
    assert.equal(v0.cam, null);
    const area = { x0: v0.box.x0 - 15, y0: v0.box.y0 - 10, x1: v0.box.x1 + 15, y1: v0.box.y1 + 4 };
    await deselect(page);
    const h0 = await pixHash(page, area);
    await selectVp(page, '3d');
    await page.click('#propsTabMain');
    assert.match(await page.textContent('#vpCamText'), /аксонометрия по умолчанию/);
    await page.click('#vpCam');
    const v1 = await vpOf(page, '3d');
    assert.ok(v1.cam && Number.isFinite(v1.cam.yaw) && Number.isFinite(v1.cam.pitch), JSON.stringify(v1.cam));
    assert.match(await page.textContent('#vpCamText'), /из 3D · азимут -?\d+°, наклон \d+°/);
    await deselect(page);
    assert.notEqual(await pixHash(page, area), h0, 'картинка 3D сменилась');
    assert.deepEqual(app.errors, []);
  });

  it('растр под зум листа: ×2/×4 после паузы, сдвиг листа растр не перестраивает', async () => {
    const { page } = app;
    const v = await vpOf(page, 'elev-N');
    assert.equal(v.rasterF, 1);
    const px1 = v.rasterPx;
    const c = await sheetToClient(page, (v.box.x0 + v.box.x1) / 2, (v.box.y0 + v.box.y1) / 2);
    await page.mouse.move(c.x, c.y);
    for (let i = 0; i < 6; i += 1) await page.mouse.wheel(0, -300);
    await page.waitForFunction(() => window.__kepler.state.sheetDrawn.viewports.find((x) => x.viewId === 'elev-N').rasterF > 1, null, { timeout: 5000 });
    const z = await vpOf(page, 'elev-N');
    assert.ok(z.rasterPx > px1 * 1.5, `растр крупнее: ${px1} → ${z.rasterPx}`);
    // Сдвиг листа (средняя кнопка): тот же растр, без новой ступени.
    const marks = await page.evaluate(() => { window.__rasterMark = window.__kepler.state.sheetDrawn.f; return window.__rasterMark; });
    await page.mouse.move(c.x, c.y);
    await page.mouse.down({ button: 'middle' });
    await page.mouse.move(c.x - 80, c.y + 40, { steps: 5 });
    await page.mouse.up({ button: 'middle' });
    const after2 = await vpOf(page, 'elev-N');
    assert.equal(after2.rasterPx, z.rasterPx);
    assert.equal((await drawn(page)).f, marks);
    await page.click('#sheetViewFit');
    assert.deepEqual(app.errors, []);
  });

  it('сохранение и открытие файла: crop, no, cam на месте; PDF листа с обрезкой', async () => {
    const { page } = app;
    await page.evaluate(async () => {
      const { findViewport } = await import('./core/views.js');
      const { mutate } = await import('./ui/store.js');
      mutate(() => { findViewport(window.__kepler.state.project, 'vp-3').vp.no = 'Р1'; });
    });
    const before = await page.evaluate(() => window.__kepler.state.project.sheets);
    assert.ok(before[0].viewports.find((v) => v.viewId === 'elev-N').crop);
    assert.ok(before[0].viewports.find((v) => v.viewId === '3d').cam);
    const text = await page.evaluate(async () => (await import('./core/model.js')).serializeProject(window.__kepler.state.project));
    await page.click('#sheetViewClose');
    await uploadText(page, '#fileInput', 'crop.kepler.json', text);
    await page.waitForFunction(() => window.__kepler.state.project.sheets?.[0]?.viewports.length === 4);
    assert.deepEqual(await page.evaluate(() => window.__kepler.state.project.sheets), before);
    await page.click('#propsTabSheets');
    await page.dblclick('#sheetsList [data-sheet="user:sh-1"] .sheets-name');
    const d = await drawn(page);
    assert.deepEqual(d.viewports.map((v) => v.no), ['1', '2', 'Р1', '3']);
    assert.ok(d.viewports[1].crop);
    if (OUT) {
      await page.mouse.click(1000, 880);
      await page.screenshot({ path: `${OUT}b4-sheet-light.png` });
      await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; document.dispatchEvent(new CustomEvent('kepler:view')); });
      await page.screenshot({ path: `${OUT}b4-sheet-dark.png` });
      await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; document.dispatchEvent(new CustomEvent('kepler:view')); });
    }
    await page.click('#propsTabMain');
    const one = await download(page, () => page.click('#sheetPropPdfOne'));
    const t = one.bytes.toString('latin1');
    assert.match(one.name, /лист-\d+\.pdf$/);
    assert.match(t, /\/Count 1/);
    assert.match(t, /\/MediaBox \[0 0 1190\.55 841\.89\]/, 'A3 альбомный');
    assert.ok(one.bytes.length > 80_000, `PDF непустой: ${one.bytes.length}`);
    assert.deepEqual(app.errors, []);
  });
});

// Касания через протокол Chrome (щипок — двумя точками); сессия — на жест.
let cdp = null;
async function touch(page, type, points) {
  const box = await page.locator('#sheetCanvas').boundingBox();
  cdp ||= await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map((p, id) => ({ x: box.x + p.x, y: box.y + p.y, id })) });
  if (type === 'touchEnd') { await cdp.detach(); cdp = null; }
}

describe('B4: телефон — щипок и сдвиг листа', () => {
  let app;
  before(async () => { app = await startApp({ mobile: true }); await openSample(app.page); });
  after(async () => { await app?.close(); });

  it('два пальца — масштаб листа, один палец по пустому — сдвиг', async () => {
    const { page } = app;
    await page.evaluate(async () => {
      const st = window.__kepler.state;
      const { mutate } = await import('./ui/store.js');
      const V = await import('./core/views.js');
      mutate(() => {
        const s = V.addSheet(st.project, { no: '3' });
        V.placeView(st.project, s.id, 'elev-S', { x: 120, y: 80, scale: 100 });
      });
      (await import('./ui/sheet-view.js')).openSheet('user:sh-1');
    });
    await page.waitForSelector('#sheetCanvas');
    const box = await page.locator('#sheetCanvas').boundingBox();
    const d0 = await drawn(page);
    const cx = box.width / 2;
    const cy = box.height / 2;
    await touch(page, 'touchStart', [{ x: cx - 30, y: cy }, { x: cx + 30, y: cy }]);
    for (let i = 1; i <= 6; i += 1) await touch(page, 'touchMove', [{ x: cx - 30 - i * 15, y: cy }, { x: cx + 30 + i * 15, y: cy }]);
    await touch(page, 'touchEnd', []);
    const d1 = await drawn(page);
    assert.ok(d1.k > d0.k * 2, `щипок увеличил лист: ${d0.k} → ${d1.k}`);
    // Точка под серединой пальцев осталась на месте.
    const sx0 = (cx - d0.ox) / d0.k;
    const sx1 = (cx - d1.ox) / d1.k;
    assert.ok(Math.abs(sx0 - sx1) < 2, `якорь щипка: ${sx0} / ${sx1}`);
    assert.deepEqual((await page.evaluate(() => window.__kepler.state.project.sheets))[0].viewports.map((v) => [v.x, v.y]), [[120, 80]], 'вид не сдвинут');
    // Один палец по пустому месту листа (угол за видом) — сдвиг.
    assert.equal(await page.locator('#projectRoute .project-route-bar').isVisible(), false);
    const free = { x: 10, y: box.height - 20 };
    await touch(page, 'touchStart', [free]);
    for (let i = 1; i <= 5; i += 1) await touch(page, 'touchMove', [{ x: free.x + i * 12, y: free.y - i * 8 }]);
    await touch(page, 'touchEnd', []);
    const d2 = await drawn(page);
    assert.ok(Math.abs(d2.ox - d1.ox - 60) < 3 && Math.abs(d2.oy - d1.oy + 40) < 3, `сдвиг: ${d2.ox - d1.ox}, ${d2.oy - d1.oy}`);
    assert.equal(Math.round(d2.k * 1000), Math.round(d1.k * 1000));
    if (OUT) await page.screenshot({ path: `${OUT}b4-phone-pinch.png` });
    assert.deepEqual(app.errors, []);
  });
});

describe('Вилла у воды → перспектива на листе', () => {
  it('На лист… переносит камеру с уровня глаз, участок и фасадные слои', async () => {
    const app = await startApp({ width: 1440, height: 900 });
    try {
      const page = app.page;
      await page.click('[data-template="garden-villa"]');
      await page.waitForSelector('#view3d:not([hidden])');
      const cam = await page.evaluate(async () => {
        const v = await import('./ui/view3d.js');
        return (await import('./core/views.js')).normalizeCam(v.camera3dSnapshot());
      });
      assert.equal(cam.projection, 'perspective');
      await page.click('#propsTabMain');
      await page.click('#viewPlaceBtn');
      await page.click('#viewPlaceNew');
      await page.waitForSelector('#sheetCanvas');
      const sheet = await vpOf(page, '3d');
      assert.equal(sheet.empty, false);
      assert.deepEqual(sheet.cam, cam);
      const painted = await page.evaluate(async () => {
        const project = window.__kepler.state.project;
        const vp = project.sheets.at(-1).viewports[0];
        const { viewportRaster } = await import('./ui/sheet-viewports.js');
        const canvas = viewportRaster(project, vp).canvas, ctx = canvas.getContext('2d');
        const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        let ink = 0;
        for (let i = 3; i < data.length; i += 4) if (data[i]) ink++;
        return ink / (canvas.width * canvas.height);
      });
      assert.ok(painted > 0.1, `доля заполненного кадра ${painted}`);
      const saved = await page.evaluate(async () =>
        (await import('./core/model.js')).serializeProject(window.__kepler.state.project));
      await page.click('#sheetViewClose');
      await uploadText(page, '#fileInput', 'villa.kepler.json', saved);
      await page.click('#propsTabSheets');
      await page.dblclick('#sheetsList [data-sheet="user:sh-1"] .sheets-name');
      assert.deepEqual((await vpOf(page, '3d')).cam, cam);
      await page.click('#propsTabMain');
      const pdf = await download(page, () => page.click('#sheetPropPdfOne'));
      assert.match(pdf.bytes.toString('latin1'), /\/Count 1/);
      assert.deepEqual(app.errors, []);
    } finally { await app.close(); }
  });
});
