// e2e листов пользователя (шаг B3): «+ Лист», двойной клик открывает
// рабочий лист, «Фасад Север» перетаскивается из дерева «Виды» на лист
// (HTML5 DnD реальной мышью), масштаб, сдвиг, один вид — один лист,
// Delete и Ctrl+Z, сохранение файла, PDF листа A3 и A2 книжного; телефон —
// «На лист…».
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { startApp, openSample, uploadText } from './helpers.mjs';

const OUT = process.env.KEPLER_SHOTS || '';
const drawn = (page) => page.evaluate(() => window.__kepler.state.sheetDrawn);
const undoLen = (page) => page.evaluate(async () => (await import('./ui/state.js')).history.undo.length);
const sheets = (page) => page.evaluate(() => window.__kepler.state.project.sheets);

// Точка листа (мм) → клиентские координаты.
async function sheetToClient(page, x, y) {
  const box = await page.locator('#sheetCanvas').boundingBox();
  const d = await drawn(page);
  return { x: box.x + d.ox + x * d.k, y: box.y + d.oy + y * d.k };
}

// Перетащить вид из дерева «Виды» на лист в точку (мм листа).
async function dragView(page, viewId, x, y) {
  await page.click('#propsTabViews');
  const box = await page.locator('#sheetCanvas').boundingBox();
  const p = await sheetToClient(page, x, y);
  await page.locator(`#viewTree [data-view="${viewId}"]`).dragTo(page.locator('#sheetCanvas'), { targetPosition: { x: p.x - box.x, y: p.y - box.y } });
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

async function download(page, click) {
  const [dl] = await Promise.all([page.waitForEvent('download'), click()]);
  return { name: dl.suggestedFilename(), bytes: await readFile(await dl.path()) };
}

describe('листы пользователя — компьютер 1440', () => {
  let app;
  before(async () => { app = await startApp({ width: 1440, height: 900 }); await openSample(app.page); });
  after(async () => { await app?.close(); });

  it('«+ Лист» — новый лист в списке, двойной клик открывает пустой рабочий лист', async () => {
    const { page } = app;
    assert.equal(await sheets(page), undefined, 'пример — без листов пользователя');
    await page.click('#propsTabSheets');
    const before = await page.$$eval('#sheetsList .sheets-item', (ns) => ns.length);
    await page.click('#sheetsAddBtn');
    const names = await page.$$eval('#sheetsList .sheets-item', (ns) => ns.map((n) => [n.querySelector('.sheets-no').textContent, n.dataset.sheet]));
    assert.equal(names.length, before + 1);
    assert.deepEqual(names.at(-1), [String(before + 1), 'user:sh-1']);
    assert.deepEqual((await sheets(page)).map((s) => [s.no, s.name, s.format, s.orient]), [[String(before + 1), `Лист ${before + 1}`, 'A3', 'landscape']]);
    if (OUT) await page.screenshot({ path: `${OUT}b3-list.png` });
    await page.dblclick('#sheetsList [data-sheet="user:sh-1"] .sheets-name');
    assert.equal(await page.isVisible('#sheetCanvas'), true);
    assert.match(await page.textContent('#sheetViewTitle'), /^Лист 3 — Лист 3$/);
    assert.match(await page.textContent('#sheetViewMeta'), /A3 · 420×297 мм · альбомная/);
    assert.equal(await page.isVisible('#sheetEditHint'), true, 'подсказка на пустом листе');
    const d = await drawn(page);
    assert.equal(d.viewports.length, 0);
    assert.ok(d.k > 1.5, `лист вписан: ${d.k}`);
    assert.ok(await inkIn(page, { x0: 230, y0: 237, x1: 415, y1: 292 }) > 0.02, 'штамп нарисован');
    assert.deepEqual(app.errors, []);
  });

  it('перетаскивание «Фасад Север» из «Видов» — видовой экран в точке сброса', async () => {
    const { page } = app;
    const undo = await undoLen(page);
    await dragView(page, 'elev-N', 200, 100);
    const d = await drawn(page);
    assert.equal(d.viewports.length, 1);
    const vp = d.viewports[0];
    assert.equal(vp.viewId, 'elev-N');
    assert.ok([50, 100, 200, 500].includes(vp.scale));
    assert.ok(vp.x % 5 === 0 && vp.y % 5 === 0, `привязка 5 мм: ${vp.x}, ${vp.y}`);
    assert.ok(vp.box.x0 >= 20 && vp.box.x1 <= 415, 'вид в рамке листа');
    assert.equal(await undoLen(page), undo + 1, 'одна запись истории');
    assert.ok(await inkIn(page, vp.box) > 0.05, 'фасад нарисован на листе');
    assert.match(await page.textContent('#toast'), /Фасад Север — на листе 3, М 1:\d+/);
    assert.equal(d.selected, vp.id, 'новый вид выбран');
    // Дерево помечает размещённый вид номером листа и номером вида (B4).
    assert.equal(await page.textContent('#viewTree [data-view="elev-N"] .vt-sheet'), 'Л3-1');
    assert.deepEqual(app.errors, []);
  });

  it('«Свойства» видового экрана: масштаб переключается, подпись', async () => {
    const { page } = app;
    await page.click('#propsTabMain');
    assert.equal(await page.textContent('#vpPropsTitle'), 'Фасад Север');
    const w0 = (await drawn(page)).viewports[0].box;
    await page.click('[data-vp-scale="200"]');
    let vp = (await drawn(page)).viewports[0];
    assert.equal(vp.scale, 200);
    assert.equal(await page.textContent('#vpScaleVal'), '1:200');
    assert.ok(vp.box.x1 - vp.box.x0 < w0.x1 - w0.x0, 'вид стал меньше');
    await page.click('[data-vp-scale="100"]');
    vp = (await drawn(page)).viewports[0];
    assert.equal(vp.scale, 100);
    if (OUT) await page.screenshot({ path: `${OUT}b3-vp-props.png` });
    assert.deepEqual(app.errors, []);
  });

  it('перетаскивание вида мышью — сдвиг с шагом 5 мм, одна запись истории', async () => {
    const { page } = app;
    const vp = (await drawn(page)).viewports[0];
    const undo = await undoLen(page);
    const from = await sheetToClient(page, vp.x, vp.y);
    const to = await sheetToClient(page, vp.x - 52, vp.y + 41);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 4 });
    await page.mouse.move(to.x, to.y, { steps: 4 });
    await page.mouse.up();
    const moved = (await drawn(page)).viewports[0];
    assert.ok(Math.abs(moved.x - (vp.x - 52)) <= 3 && Math.abs(moved.y - (vp.y + 41)) <= 3, `${moved.x}, ${moved.y}`);
    assert.ok(moved.x % 5 === 0 && moved.y % 5 === 0);
    assert.equal(await undoLen(page), undo + 1);
    // Пустое место — сдвиг листа, проект не меняется.
    const d0 = await drawn(page);
    const empty = await sheetToClient(page, 400, 20);
    await page.mouse.move(empty.x, empty.y);
    await page.mouse.down();
    await page.mouse.move(empty.x - 60, empty.y + 30, { steps: 3 });
    await page.mouse.up();
    const d1 = await drawn(page);
    assert.ok(Math.abs(d1.ox - d0.ox + 60) < 1 && Math.abs(d1.oy - d0.oy - 30) < 1);
    assert.equal(d1.selected, null, 'клик по пустому — выбор снят');
    assert.equal(await undoLen(page), undo + 1);
    // Колесо — масштаб листа; «Вписать» — обратно.
    await page.mouse.wheel(0, -300);
    assert.ok((await drawn(page)).k > d1.k);
    await page.click('#sheetViewFit');
    assert.ok(Math.abs((await drawn(page)).k - d0.k) < 1e-6);
    assert.deepEqual(app.errors, []);
  });

  it('тот же вид второй раз — отказ с сообщением; Delete убирает, Ctrl+Z возвращает', async () => {
    const { page } = app;
    await dragView(page, 'elev-N', 300, 200);
    assert.equal((await drawn(page)).viewports.length, 1);
    assert.match(await page.textContent('#toast'), /Вид уже размещён на листе 3/);
    // Выбрать кликом и удалить.
    const vp = (await drawn(page)).viewports[0];
    const p = await sheetToClient(page, vp.x, vp.y);
    await page.mouse.click(p.x, p.y);
    assert.equal((await drawn(page)).selected, vp.id);
    await page.keyboard.press('Delete');
    assert.equal((await drawn(page)).viewports.length, 0);
    await page.keyboard.press('Control+z');
    assert.equal((await drawn(page)).viewports.length, 1);
    assert.equal((await drawn(page)).viewports[0].viewId, 'elev-N');
    await page.keyboard.press('Control+y');
    assert.equal((await drawn(page)).viewports.length, 0);
    await page.keyboard.press('Control+z');
    assert.equal(await page.isVisible('#sheetCanvas'), true, 'лист открыт после отмены');
    assert.deepEqual(app.errors, []);
  });

  it('план этажа и разрез — на тот же лист; скриншоты светлый/тёмный', async () => {
    const { page } = app;
    await page.evaluate(async () => {
      const st = window.__kepler.state;
      const { mutate } = await import('./ui/store.js');
      const { addSectionView } = await import('./core/views.js');
      const rs = st.project.rooms;
      const y = (Math.min(...rs.map((r) => r.y)) + Math.max(...rs.map((r) => r.y + r.h))) / 2;
      mutate(() => addSectionView(st.project, {
        levelId: st.project.activeLevel, a: { x: Math.min(...rs.map((r) => r.x)) - 1500, y }, b: { x: Math.max(...rs.map((r) => r.x + r.w)) + 1500, y },
      }));
    });
    // Фасад — вправо вверх, план — влево, разрез — под фасадом.
    const vp = (await drawn(page)).viewports[0];
    const from = await sheetToClient(page, vp.x, vp.y);
    const to = await sheetToClient(page, 300, 75);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 6 });
    await page.mouse.up();
    const level = await page.evaluate(() => window.__kepler.state.project.activeLevel);
    await dragView(page, `plan:${level}`, 95, 110);
    await dragView(page, 'sec-1', 300, 175);
    const d = await drawn(page);
    assert.deepEqual(d.viewports.map((v) => v.viewId), ['elev-N', `plan:${level}`, 'sec-1']);
    for (const v of d.viewports) {
      assert.ok(!v.empty, `${v.viewId} не пуст`);
      assert.ok(await inkIn(page, v.box) > 0.03, `${v.viewId} нарисован`);
      assert.ok(v.box.x0 >= 20 && v.box.x1 <= 415 && v.box.y0 >= 5 && v.box.cap.y1 <= 292, `${v.viewId} в рамке`);
    }
    assert.equal(d.viewports[1].scale, 100, 'план 1:100 по умолчанию');
    await page.click('#propsTabSheets');
    if (OUT) {
      await page.mouse.click(1000, 880); // снять подсказки вкладок
      await page.screenshot({ path: `${OUT}b3-sheet-light.png` });
      await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; document.dispatchEvent(new CustomEvent('kepler:view')); });
      await page.screenshot({ path: `${OUT}b3-sheet-dark.png` });
      await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; document.dispatchEvent(new CustomEvent('kepler:view')); });
    }
    assert.deepEqual(app.errors, []);
  });

  it('«Скачать PDF» — альбом с листом пользователя; PDF одного листа A2 книжного', async () => {
    const { page } = app;
    const f = await download(page, () => page.click('#sheetViewPdf'));
    assert.match(f.name, /\.pdf$/);
    const text = f.bytes.toString('latin1');
    assert.match(text, /\/Count 3/);
    assert.equal((text.match(/\/MediaBox \[0 0 1190\.55 841\.89\]/g) || []).length, 3, 'три листа A3');
    assert.ok(f.bytes.length > 150_000, `размер ${f.bytes.length}`);
    if (OUT) await writeFile(`${OUT}b3-sheets.pdf`, f.bytes);
    // Формат A2 книжный в «Свойствах» листа — PDF этого листа.
    await page.mouse.click(5, 5); // фокус с холста
    await page.evaluate(() => { window.__kepler.state.sheetVp = null; document.dispatchEvent(new CustomEvent('kepler:view')); });
    await page.click('#propsTabMain');
    await page.selectOption('#sheetPropFormat', 'A2');
    await page.selectOption('#sheetPropOrient', 'portrait');
    assert.match(await page.textContent('#sheetViewMeta'), /A2 · 420×594 мм · книжная/);
    const one = await download(page, () => page.click('#sheetPropPdfOne'));
    const t1 = one.bytes.toString('latin1');
    assert.match(one.name, /лист-3\.pdf$/);
    assert.match(t1, /\/Count 1/);
    assert.match(t1, /\/MediaBox \[0 0 1190\.55 1683\.78\]/);
    const w = Number(/\/Width (\d+)/.exec(t1)[1]);
    const h = Number(/\/Height (\d+)/.exec(t1)[1]);
    assert.deepEqual([w, h], [2480, 3508], 'растр A2 книжного, 150 dpi');
    assert.ok(one.bytes.length > 100_000, `страница непустая: ${one.bytes.length}`);
    await page.keyboard.press('Control+z');
    await page.keyboard.press('Control+z');
    assert.match(await page.textContent('#sheetViewMeta'), /A3 · 420×297 мм · альбомная/);
    assert.deepEqual(app.errors, []);
  });

  it('сохранение и открытие файла — лист и виды на месте', async () => {
    const { page } = app;
    const before = await sheets(page);
    const text = await page.evaluate(async () => (await import('./core/model.js')).serializeProject(window.__kepler.state.project));
    assert.match(JSON.parse(text).schema, /kepler-plan\/7/);
    await page.click('#sheetViewClose');
    await uploadText(page, '#fileInput', 'sheets.kepler.json', text);
    await page.waitForFunction(() => window.__kepler.state.project.sheets?.[0]?.viewports.length === 3);
    assert.deepEqual(await sheets(page), before);
    await page.click('#propsTabSheets');
    await page.dblclick('#sheetsList [data-sheet="user:sh-1"] .sheets-name');
    assert.equal((await drawn(page)).viewports.length, 3);
    // Удаление листа — из «Свойств»; Ctrl+Z возвращает.
    await page.click('#propsTabMain');
    await page.click('#sheetPropDelete');
    assert.equal(await sheets(page), undefined);
    assert.equal(await page.isHidden('#sheetView'), true);
    await page.keyboard.press('Control+z');
    assert.equal((await sheets(page)).length, 1);
    assert.deepEqual(app.errors, []);
  });
});

describe('листы пользователя — телефон', () => {
  let app;
  before(async () => { app = await startApp({ mobile: true }); await openSample(app.page); });
  after(async () => { await app?.close(); });

  it('«На лист…» в «Свойствах» вида кладёт вид и открывает лист', async () => {
    const { page } = app;
    await page.tap('#mobileBar [data-sheet="sheets"]');
    await page.tap('#sheetsAddBtn');
    assert.equal((await sheets(page)).length, 1);
    await page.tap('#mobileSheetHead [data-tab="views"]');
    await page.tap('#viewTree [data-view="elev-S"]');
    await page.tap('#mobileBar [data-sheet="props"]');
    await page.tap('#viewPlaceBtn');
    await page.tap('[data-place-sheet="sh-1"]');
    assert.equal(await page.isVisible('#sheetCanvas'), true);
    const d = await drawn(page);
    assert.deepEqual(d.viewports.map((v) => v.viewId), ['elev-S']);
    assert.ok(await inkIn(page, d.viewports[0].box) > 0.03);
    const bar = await page.locator('#sheetViewClose').boundingBox();
    assert.ok(bar.x >= 0 && bar.x + bar.width <= 390.5);
    assert.ok((await page.evaluate(() => document.documentElement.scrollWidth)) <= 390);
    if (OUT) await page.screenshot({ path: `${OUT}b3-phone.png` });
    // Вид уже на листе — в «Свойствах» вида: «Открыть лист».
    await page.tap('#sheetViewClose');
    await page.tap('#mobileBar [data-sheet="props"]');
    assert.equal(await page.getAttribute('#propsTabMain', 'aria-selected'), 'true', '«Свойства» — сразу настройки вида');
    assert.match(await page.textContent('#viewPlacedOn'), /на листе 3/);
    assert.deepEqual(app.errors, []);
  });
});
