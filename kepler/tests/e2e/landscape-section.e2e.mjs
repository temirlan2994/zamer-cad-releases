// e2e «Ландшафт»: инструмент «Разрез» — линия по точкам (Esc — без
// изменений, Enter — одна запись истории), окно разреза: SVG с отметками,
// стиль «Эскиз»/«Чертёж», сторона взгляда, глубина, скачивание SVG и DXF,
// клик по линии на плане открывает разрез, удаление и Ctrl+Z.
// Правка: ручки на точках линии (перетаскивание с привязкой, «+», двойной
// клик — удалить/добавить), переключатель стороны взгляда, буква разреза;
// лист PDF с разрезами (вкл/выкл, выбор).
// Скриншоты — в папку из переменной KEPLER_SHOTS (если задана).
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { startApp, openSample, clickWorld, worldToClient } from './helpers.mjs';

const SHOTS = process.env.KEPLER_SHOTS || '';
const undoLen = (page) => page.evaluate(async () => (await import('./ui/state.js')).history.undo.length);
const sections = (page) => page.evaluate(() => (window.__kepler.state.project.site.landscape.sections || []).map((s) => ({ ...s })));
const tool = (page) => page.evaluate(() => window.__kepler.state.tool?.kind || null);
const svgText = (page) => page.evaluate(() => document.querySelector('#lsSecBody svg')?.outerHTML || '');
const clickFree = async (page, x, y) => {
  await page.keyboard.down('Shift');
  await clickWorld(page, x, y);
  await page.keyboard.up('Shift');
};
async function download(page, click) {
  const [dl] = await Promise.all([page.waitForEvent('download'), click()]);
  return { name: dl.suggestedFilename(), text: await readFile(await dl.path(), 'utf8') };
}
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` }); };

describe('ландшафт: разрез участка', () => {
  let app;
  before(async () => {
    app = await startApp({ width: 1400, height: 860 });
    await openSample(app.page);
    await app.page.click('#landscapeBtn');
    // Подпорная стенка (верх — север), площадка +0.45, деревья.
    await app.page.evaluate(async () => {
      const L = await import('./core/landscape.js');
      const st = await import('./ui/store.js');
      st.mutate(() => {
        const list = window.__kepler.state.project.site.landscape.objects;
        list.push(L.createLandscapeObject('retaining-wall', 0, 0, { id: 'rw', points: [{ x: 9000, y: -3000 }, { x: 15000, y: -3000 }], height: 1200 }));
        list.push(L.createLandscapeObject('paving-area', 0, 0, { id: 'pv', points: [{ x: 9000, y: -1500 }, { x: 15000, y: -1500 }, { x: 15000, y: 1500 }, { x: 9000, y: 1500 }], elev: 450 }));
        list.push(L.createLandscapeObject('tree-pine', 15000, -6000, { id: 't1' }));
        list.push(L.createLandscapeObject('tree-birch', 16500, 2500, { id: 't2' }));
      });
    });
  });
  after(async () => { await app?.close(); });

  it('кнопка «Новый разрез»: Esc — без изменений; точки и Enter — разрез и окно', async () => {
    const { page } = app;
    await page.click('#lsSectionNew');
    assert.equal(await tool(page), 'ls-section');
    assert.match(await page.textContent('#propsPanel'), /Разрез участка/);
    await clickFree(page, 12000, -6500);
    await clickFree(page, 12000, 3000);
    await page.keyboard.press('Escape');
    assert.equal(await tool(page), null);
    assert.deepEqual(await sections(page), []);

    const undo0 = await undoLen(page);
    await page.click('#lsSectionNew');
    await clickFree(page, 12000, -6500);
    await clickFree(page, 12000, 3000);
    await shot(page, 'section-draft');
    await page.keyboard.press('Enter');
    const list = await sections(page);
    assert.equal(list.length, 1);
    assert.equal(list[0].name, 'А');
    assert.equal(list[0].side, 'left');
    assert.equal(list[0].points.length, 2);
    assert.equal(await undoLen(page), undo0 + 1, 'одна запись истории');
    await page.waitForSelector('#lsSectionView:not([hidden])');
    const svg = await svgText(page);
    assert.match(svg, /Разрез А–А/);
    assert.match(svg, /\+1\.20/, 'верх стенки');
    assert.match(svg, /\+0\.45/, 'отметка площадки');
    assert.match(svg, /Подпорная стенка/);
    assert.match(svg, /data-style="sketch"|data-style="drawing"/);
    await shot(page, 'section-view');
  });

  it('стиль, сторона взгляда и глубина меняют вид', async () => {
    const { page } = app;
    await page.click('#lsSectionView label.seg-opt:has(input[value="drawing"])');
    assert.match(await svgText(page), /data-style="drawing"/);
    await shot(page, 'section-drawing');
    await page.click('#lsSectionView label.seg-opt:has(input[value="sketch"])');
    assert.match(await svgText(page), /data-style="sketch"/);
    const before = await svgText(page);
    // Слева по ходу (на юг) — восток: сосна (x 15000) видна; направо — запад.
    assert.match(before, /Сосна обыкновенная/);
    await page.selectOption('#lsSecSide', 'right');
    assert.equal((await sections(page))[0].side, 'right');
    assert.doesNotMatch(await svgText(page), /Сосна обыкновенная/);
    await page.selectOption('#lsSecSide', 'left');
    await page.fill('#lsSecDepth', '2');
    await page.press('#lsSecDepth', 'Enter');
    assert.equal((await sections(page))[0].depth, 2000);
    assert.doesNotMatch(await svgText(page), /Сосна обыкновенная/, 'дальше 2 м не видно');
    await page.fill('#lsSecDepth', '15');
    await page.press('#lsSecDepth', 'Enter');
    assert.match(await svgText(page), /Сосна обыкновенная/);
  });

  it('скачивание SVG и DXF (слой LANDSCAPE_SECTION)', async () => {
    const { page } = app;
    const svg = await download(page, () => page.click('#lsSecSvg'));
    assert.match(svg.name, /разрез-А\.svg$/);
    assert.match(svg.text, /<svg[^>]+viewBox/);
    const dxf = await download(page, () => page.click('#lsSecDxf'));
    assert.match(dxf.name, /\.dxf$/);
    assert.match(dxf.text, /LANDSCAPE_SECTION/);
    assert.match(dxf.text, /\+1\.20/);
  });

  it('Esc закрывает окно; клик по линии на плане открывает; удаление и Ctrl+Z', async () => {
    const { page } = app;
    await page.keyboard.press('Escape');
    assert.equal(await page.isHidden('#lsSectionView'), true);
    assert.equal((await sections(page)).length, 1, 'Esc не удаляет разрез');
    await shot(page, 'section-plan');
    await clickWorld(page, 12000, 2600);
    await page.waitForSelector('#lsSectionView:not([hidden])');
    await page.click('#lsSecDel');
    assert.deepEqual(await sections(page), []);
    assert.equal(await page.isHidden('#lsSectionView'), true);
    await page.keyboard.press('Control+z');
    assert.equal((await sections(page)).length, 1);
    // Сохранение: поле переживает сериализацию.
    const back = await page.evaluate(async () => {
      const M = await import('./core/model.js');
      return M.deserializeProject(M.serializeProject(window.__kepler.state.project)).site.landscape.sections?.length;
    });
    assert.equal(back, 1);
    assert.deepEqual(app.errors, []);
  });

  it('ручки: перетаскивание точки — одна запись истории, вид обновляется', async () => {
    const { page } = app;
    await clickWorld(page, 12000, 2600);
    await page.waitForSelector('#lsSectionView:not([hidden])');
    // Точка линии над окном разреза (окно — низ холста).
    const p = await worldToClient(page, 12000, -6500);
    const box = await (await page.$('#lsSectionView')).boundingBox();
    assert.ok(p.y < box.y, `точка ${p.y} над окном ${box.y}`);
    await shot(page, 'section-handles');
    const undo0 = await undoLen(page);
    const svg0 = await svgText(page);
    const to = await worldToClient(page, 14000, -6500);
    await page.mouse.move(p.x, p.y);
    await page.mouse.down();
    await page.mouse.move((p.x + to.x) / 2, p.y, { steps: 3 });
    await page.mouse.move(to.x, to.y, { steps: 3 });
    await page.mouse.up();
    const pts = (await sections(page))[0].points;
    assert.equal(pts.length, 2);
    assert.ok(Math.abs(pts[0].x - 14000) <= 300 && Math.abs(pts[0].y + 6500) <= 300, JSON.stringify(pts[0]));
    assert.equal(await undoLen(page), undo0 + 1, 'жест — одна запись');
    await page.waitForFunction((s0) => document.querySelector('#lsSecBody svg')?.outerHTML !== s0, svg0);
    await page.keyboard.press('Control+z');
    assert.deepEqual((await sections(page))[0].points[0], { x: 12000, y: -6500 });
  });

  it('двойной клик: по звену — точка, по точке — убрать; «+» — точка в середине', async () => {
    const { page } = app;
    const undo0 = await undoLen(page);
    const a = await worldToClient(page, 12000, -4000);
    await page.mouse.dblclick(a.x, a.y);
    let pts = (await sections(page))[0].points;
    assert.equal(pts.length, 3);
    assert.equal(pts[1].x, 12000, 'точка — на линии');
    assert.ok(Math.abs(pts[1].y + 4000) < 150, JSON.stringify(pts[1]));
    assert.equal(await undoLen(page), undo0 + 1);
    const v = await worldToClient(page, pts[1].x, pts[1].y);
    await page.mouse.dblclick(v.x, v.y);
    pts = (await sections(page))[0].points;
    assert.equal(pts.length, 2, 'точка убрана');
    // Две точки — минимум: двойной клик по концу не удаляет.
    const e = await worldToClient(page, 12000, -6500);
    await page.mouse.dblclick(e.x, e.y);
    assert.equal((await sections(page))[0].points.length, 2);
    assert.match(await page.textContent('#toast'), /минимум 2 точки/);
    // «+» в середине звена.
    const m = await worldToClient(page, 12000, (-6500 + 3000) / 2);
    await page.mouse.click(m.x, m.y);
    pts = (await sections(page))[0].points;
    assert.equal(pts.length, 3);
    assert.deepEqual(pts[1], { x: 12000, y: -1750 });
    await page.keyboard.press('Control+z');
    assert.equal((await sections(page))[0].points.length, 2);
  });

  it('переключатель стороны взгляда на плане и буква разреза', async () => {
    const { page } = app;
    // Переключатель — с обратной стороны от стрелки: после щелчка он переезжает.
    const flipAt = () => page.evaluate(async () => {
      const R = await import('./ui/render-section.js');
      const k = window.__kepler;
      const sec = k.state.project.site.landscape.sections[0];
      return R.sectionHandlePoints(sec, k.worldToScreen, k.state.view.scale).flips[0];
    });
    const cbox = await (await page.$('#canvas')).boundingBox();
    const undo0 = await undoLen(page);
    let flip = await flipAt();
    await page.mouse.click(cbox.x + flip.x, cbox.y + flip.y);
    assert.equal((await sections(page))[0].side, 'right');
    assert.equal(await page.inputValue('#lsSecSide'), 'right');
    assert.equal(await undoLen(page), undo0 + 1);
    await shot(page, 'section-flipped');
    flip = await flipAt();
    await page.mouse.click(cbox.x + flip.x, cbox.y + flip.y);
    assert.equal((await sections(page))[0].side, 'left');
    // Буква: Enter — сохранить, одна запись истории.
    const undo1 = await undoLen(page);
    await page.fill('#lsSecName', 'в');
    await page.press('#lsSecName', 'Enter');
    assert.equal((await sections(page))[0].name, 'В');
    assert.equal(await undoLen(page), undo1 + 1);
    assert.match(await svgText(page), /Разрез В–В/);
    assert.match(await page.textContent('#lsSectionView .ls-section-title'), /–В/);
    await shot(page, 'section-renamed');
  });

  it('лист PDF: разрезы — отдельный лист; выключатель и выбор', async () => {
    const { page } = app;
    const pdf = async () => {
      await page.click('#exportBtn');
      const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-export="sheet-pdf"]')]);
      return (await readFile(await dl.path())).toString('latin1');
    };
    await page.keyboard.press('Escape');
    // Второй разрез — вдоль стенки.
    await page.evaluate(async () => {
      const L = await import('./core/landscape.js');
      const st = await import('./ui/store.js');
      st.mutate(() => {
        window.__kepler.state.project.site.landscape.sections.push(L.normalizeSection({
          id: 'sec-b', name: 'Б', points: [{ x: 8000, y: -2000 }, { x: 18000, y: -2000 }], side: 'right',
        }));
      });
    });
    await page.waitForSelector('#lsSecSheetOn');
    assert.equal(await page.isChecked('#lsSecSheetOn'), true, 'по умолчанию — на листе');
    const sheets = await page.evaluate(async () => {
      const S = await import('./ui/sheet.js');
      return S.sheetPlan(window.__kepler.state.project)
        .map((s) => (s.kind === 'sections' ? s.place.map((p) => ({ name: p.item.name, w: p.item.width, h: p.item.height })) : s.kind));
    });
    assert.equal(sheets[0], 'site');
    const secSheets = sheets.filter((s) => Array.isArray(s));
    assert.deepEqual(secSheets.flat().map((q) => q.name), ['В', 'Б'], 'порядок разрезов');
    assert.ok(secSheets.flat().every((q) => q.w <= 385 && q.h <= 222), 'в поле листа');
    // Сосна ~15 м: вдвоём по высоте не встают — по листу на разрез.
    assert.match(await pdf(), new RegExp(`/Count ${2 + secSheets.length} `), 'генплан + листы разрезов + этаж');
    if (SHOTS) {
      const png = await page.evaluate(async () => {
        const S = await import('./ui/sheet.js');
        const specs = S.sheetPlan(window.__kepler.state.project);
        const spec = specs.find((s) => s.kind === 'sections');
        await S.loadSheetImages(spec);
        return S.renderSheet(window.__kepler.state.project, spec, 2, specs.length).toDataURL('image/png');
      });
      await writeFile(`${SHOTS}/section-sheet.png`, Buffer.from(png.split(',')[1], 'base64'));
      const site = await page.evaluate(async () => {
        const S = await import('./ui/sheet.js');
        const specs = S.sheetPlan(window.__kepler.state.project);
        return S.renderSheet(window.__kepler.state.project, specs[0], 1, specs.length).toDataURL('image/png');
      });
      await writeFile(`${SHOTS}/section-site-sheet.png`, Buffer.from(site.split(',')[1], 'base64'));
    }
    // Б — не на лист: остаётся один разрез.
    await page.uncheck('[data-ls-sec-sheet="sec-b"]');
    const one = await page.evaluate(async () => (await import('./ui/sheet.js')).sheetPlan(window.__kepler.state.project)
      .filter((s) => s.kind === 'sections').map((s) => s.place.length));
    assert.deepEqual(one, [1]);
    // Выключатель — без листа разрезов.
    await page.uncheck('#lsSecSheetOn');
    assert.equal(await page.isDisabled('[data-ls-sec-sheet="sec-b"]'), true);
    assert.match(await pdf(), /\/Count 2/);
    await page.check('#lsSecSheetOn');
    await page.check('[data-ls-sec-sheet="sec-b"]');
    assert.deepEqual(app.errors, []);
  });
});
