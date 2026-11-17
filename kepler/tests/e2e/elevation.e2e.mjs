// e2e фасадов (ui/elevation-view.js): дерево видов → «Фасад Север» открывает
// фасад на холсте (только просмотр), Esc и «Закрыть вид» возвращают план,
// масштаб 1:50/1:100/1:200 и отметки — в «Свойствах», хранятся в
// project.views и переживают сохранение/открытие файла; телефон.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, openSample, uploadText } from './helpers.mjs';

const activeView = (page) => page.$$eval('#viewTree .vt-item[aria-selected="true"]', (ns) => ns.map((n) => n.dataset.view));
const drawn = (page) => page.evaluate(() => window.__kepler.state.elevationDrawn);
const open = (page) => page.evaluate(() => window.__kepler.state.elevationOpen);

// Непустой рисунок: доля пикселей холста фасада, отличных от фона.
const inkShare = (page) => page.evaluate(() => {
  const c = document.getElementById('elevCanvas');
  const ctx = c.getContext('2d');
  const { data } = ctx.getImageData(0, 0, c.width, c.height);
  const bg = [data[0], data[1], data[2]];
  let ink = 0;
  for (let i = 0; i < data.length; i += 16) {
    if (Math.abs(data[i] - bg[0]) + Math.abs(data[i + 1] - bg[1]) + Math.abs(data[i + 2] - bg[2]) > 30) ink += 1;
  }
  return ink / (data.length / 16);
});

describe('фасады — компьютер 1280', () => {
  let app;
  before(async () => { app = await startApp(); await openSample(app.page); });
  after(async () => { await app?.close(); });

  it('«Фасады» в дереве — четыре стороны; проект без views', async () => {
    const { page } = app;
    await page.click('#propsTabViews');
    const names = await page.$$eval('[data-vt-group="facades"] .vt-name', (ns) => ns.map((n) => n.textContent));
    assert.deepEqual(names, ['Фасад Север', 'Фасад Юг', 'Фасад Запад', 'Фасад Восток']);
    assert.equal(await page.evaluate(() => window.__kepler.state.project.views), undefined, 'фасады по умолчанию не пишутся в проект');
  });

  it('двойной клик по «Фасад Север» — фасад на холсте; Esc закрывает', async () => {
    const { page } = app;
    const mode = await page.evaluate(() => window.__kepler.state.modeName);
    await page.dblclick('#viewTree [data-view="elev-N"]');
    assert.equal(await open(page), 'elev-N');
    assert.equal(await page.isVisible('#elevView'), true);
    assert.deepEqual(await activeView(page), ['elev-N']);
    assert.match(await page.textContent('#elevViewTitle'), /Фасад Север 1:100/);
    const d = await drawn(page);
    assert.ok(d.polys > 3, `граней ${d.polys}`);
    assert.ok(await inkShare(page) > 0.01, 'на холсте фасада есть рисунок');
    // Только просмотр: колесо меняет масштаб вида, не проект.
    const undo = await page.evaluate(async () => (await import('./ui/state.js')).history.undo.length);
    const box = await page.locator('#elevCanvas').boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, -400);
    assert.ok((await drawn(page)).zoom > 1);
    await page.click('#elevViewFit');
    assert.equal((await drawn(page)).zoom, d.zoom);
    await page.click('[data-cut-zoom="in"]');
    assert.equal((await drawn(page)).zoom, d.zoom * 1.25);
    await page.locator('#elevCanvas').press('0');
    assert.equal((await drawn(page)).zoom, d.zoom);
    assert.equal((await drawn(page)).scale, 100);
    assert.equal(await page.evaluate(async () => (await import('./ui/state.js')).history.undo.length), undo);
    await page.keyboard.press('Escape');
    assert.equal(await open(page), null);
    assert.equal(await page.isHidden('#elevView'), true);
    assert.equal(await page.evaluate(() => window.__kepler.state.modeName), mode, 'режим не менялся');
    assert.deepEqual(app.errors, []);
  });

  it('три других фасада открываются; «✕ Закрыть вид»', async () => {
    const { page } = app;
    for (const d of ['S', 'W', 'E']) {
      await page.click(`#viewTree [data-view="elev-${d}"]`);
      assert.equal(await open(page), `elev-${d}`);
      assert.deepEqual(await activeView(page), [`elev-${d}`]);
      assert.ok((await drawn(page)).polys > 3);
      assert.ok(await inkShare(page) > 0.01);
    }
    await page.click('#elevViewClose');
    assert.equal(await open(page), null);
    // Из фасада — к плану этажа деревом.
    await page.click('#viewTree [data-view="elev-N"]');
    const level = await page.evaluate(() => window.__kepler.state.project.activeLevel);
    await page.click(`#viewTree [data-view="plan:${level}"]`);
    assert.equal(await open(page), null);
    assert.deepEqual(await activeView(page), [`plan:${level}`]);
    assert.deepEqual(app.errors, []);
  });

  it('«Свойства»: Вид: Фасад Север, масштаб и отметки → project.views; файл их хранит', async () => {
    const { page } = app;
    await page.click('#viewTree [data-view="elev-N"]');
    await page.click('#propsTabMain');
    assert.match(await page.textContent('#viewPropsTitle'), /Вид: Фасад Север/);
    await page.click('[data-elev-scale="50"]');
    assert.match(await page.textContent('#elevViewTitle'), /1:50/);
    assert.equal((await drawn(page)).scale, 50);
    await page.click('[data-elev-scale="200"]');
    assert.equal((await drawn(page)).scale, 200);
    assert.match(await page.textContent('#elevViewTitle'), /Фасад Север 1:200/);
    await page.uncheck('#elevMarks');
    const views = await page.evaluate(() => window.__kepler.state.project.views);
    assert.deepEqual(views.map((v) => [v.id, v.scale, v.marks]), [['elev-N', 200, false]]);
    // Ctrl+Z возвращает отметки.
    await page.keyboard.press('Control+z');
    assert.equal(await page.evaluate(() => window.__kepler.state.project.views[0].marks), undefined);
    // Сохранение и открытие файла (kepler-plan/7).
    const text = await page.evaluate(async () => {
      const { serializeProject } = await import('./core/model.js');
      return serializeProject(window.__kepler.state.project);
    });
    assert.match(JSON.parse(text).schema, /kepler-plan\/7/);
    await page.keyboard.press('Escape');
    await uploadText(page, '#fileInput', 'facades.kepler.json', text);
    await page.waitForFunction(() => window.__kepler.state.project.views?.length === 1);
    assert.equal(await page.evaluate(() => window.__kepler.state.project.views[0].scale), 200);
    await page.click('#propsTabViews');
    await page.click('#viewTree [data-view="elev-N"]');
    assert.equal((await drawn(page)).scale, 200);
    await page.keyboard.press('Escape');
    assert.deepEqual(app.errors, []);
  });
});

describe('фасады — телефон', () => {
  let app;
  before(async () => { app = await startApp({ mobile: true }); await openSample(app.page); });
  after(async () => { await app?.close(); });

  it('фасад открывается из «Видов» и закрывается', async () => {
    const { page } = app;
    await page.locator('#workspaceViewPicker').focus();
    await page.selectOption('#workspaceViewPicker', 'elev-S');
    assert.equal(await open(page), 'elev-S');
    assert.equal(await page.isVisible('#elevView'), true);
    assert.ok(await inkShare(page) > 0.005);
    await page.tap('#elevViewClose');
    assert.equal(await open(page), null);
    assert.equal(await page.isHidden('#elevView'), true);
    assert.deepEqual(app.errors, []);
  });
});
