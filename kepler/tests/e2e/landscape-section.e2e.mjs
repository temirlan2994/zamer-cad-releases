// e2e «Ландшафт»: инструмент «Разрез» — линия по точкам (Esc — без
// изменений, Enter — одна запись истории), окно разреза: SVG с отметками,
// стиль «Эскиз»/«Чертёж», сторона взгляда, глубина, скачивание SVG и DXF,
// клик по линии на плане открывает разрез, удаление и Ctrl+Z.
// Скриншоты — в папку из переменной KEPLER_SHOTS (если задана).
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { startApp, openSample, clickWorld } from './helpers.mjs';

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
});
