// e2e: ландшафт на плане этажа (ui/plan-landscape.js, render.js). То, что
// начерчено в «Ландшафте», после возврата в «План» рисуется приглушённо под
// домом (флаг state._planLandscape и пиксели холста); во «Видах» —
// переключатель «Показывать ландшафт на плане», группы и «Только
// планировки» (localStorage); клик по ландшафту в «Плане» его не выделяет.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, openSample, dropOnCanvas, worldToClient } from './helpers.mjs';

const MIME = 'application/x-kepler-landscape';
// Точки внутри участка примера, в стороне от дома (как в landscape.e2e).
const TREE_AT = { x: 13000, y: -3000 };
const PARK_AT = { x: 13000, y: 9200 };

const frame = (page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
const drawn = async (page) => { await frame(page); return page.evaluate(() => window.__kepler.state._planLandscape); };

// Цвет холста около мировой точки (среднее по квадрату 31×31 px).
async function pixel(page, at) {
  await frame(page);
  const c = await worldToClient(page, at.x, at.y);
  return page.evaluate(([cx, cy]) => {
    const cv = document.getElementById('canvas');
    const r = cv.getBoundingClientRect();
    const k = cv.width / r.width;
    const d = cv.getContext('2d').getImageData(Math.round((cx - r.x) * k) - 15, Math.round((cy - r.y) * k) - 15, 31, 31).data;
    const s = [0, 0, 0];
    for (let i = 0; i < d.length; i += 4) { s[0] += d[i]; s[1] += d[i + 1]; s[2] += d[i + 2]; }
    return s.map((v) => Math.round(v / (d.length / 4)));
  }, [c.x, c.y]);
}
const diff = (a, b) => Math.max(...a.map((v, i) => Math.abs(v - b[i])));

describe('ландшафт на плане этажа', () => {
  let app;
  let bare;
  before(async () => {
    app = await startApp();
    await openSample(app.page);
    const { page } = app;
    await page.evaluate(() => localStorage.removeItem('kepler-plan-landscape'));
    bare = { tree: await pixel(page, TREE_AT), park: await pixel(page, PARK_AT) };
    await page.click('#landscapeBtn');
    for (const [kind, at] of [['tree-pine', TREE_AT], ['parking-2', PARK_AT]]) {
      const c = await worldToClient(page, at.x, at.y);
      const box = await page.locator('#canvas').boundingBox();
      await dropOnCanvas(page, MIME, kind, { x: c.x - box.x, y: c.y - box.y });
    }
    await page.keyboard.press('Escape');
    await page.click('#modePlanBtn');
  });
  after(async () => { await app?.close(); });

  it('нарисованное в «Ландшафте» видно в «Плане» — под домом, приглушённо', async () => {
    const { page } = app;
    assert.equal(await page.evaluate(() => window.__kepler.state.modeName), 'plan');
    assert.equal(await page.evaluate(() => window.__kepler.state.project.site.landscape.objects.length), 2);
    assert.equal(await drawn(page), 2, `оба объекта нарисованы ${JSON.stringify(await page.evaluate(() => window.__kepler.state.project.site.landscape.objects.map((o) => o.kind)))}`);
    const tree = await pixel(page, TREE_AT);
    const park = await pixel(page, PARK_AT);
    assert.ok(diff(tree, bare.tree) > 12, `дерево видно ${tree} / ${bare.tree}`);
    assert.ok(diff(park, bare.park) > 6, `парковка видна ${park} / ${bare.park}`);
    assert.equal(await page.isVisible('#lsItems'), false, 'каталога ландшафта в «Плане» нет');
  });

  it('клик по ландшафту в «Плане» его не выделяет', async () => {
    const { page } = app;
    await page.evaluate(() => window.__kepler.select(null));
    const c = await worldToClient(page, TREE_AT.x, TREE_AT.y);
    await page.mouse.move(c.x, c.y);
    await page.mouse.click(c.x, c.y);
    const st = await page.evaluate(() => ({ sel: window.__kepler.state.selection, hover: window.__kepler.state.hover }));
    assert.notEqual(st.sel?.type, 'landscape', `выбор ${JSON.stringify(st.sel)}`);
    assert.notEqual(st.hover?.type, 'landscape', `наведение ${JSON.stringify(st.hover)}`);
    assert.equal(await page.evaluate(() => window.__kepler.state.modeName), 'plan');
  });

  it('«Свойства» вида (ничего не выбрано): переключатель, группы и «Только планировки»', async () => {
    const { page } = app;
    await page.click('#propsTabMain');
    assert.equal(await page.isChecked('#viewsLsOn'), true, 'по умолчанию — вкл');
    const groups = await page.$$eval('[data-plan-ls]', (ns) => ns.map((n) => [n.dataset.planLs, n.checked]));
    assert.deepEqual(groups, [['shadows', false], ['plants', true], ['covers', true], ['objects', true], ['labels', false], ['notes', false]]);

    await page.uncheck('#viewsLsOn');
    assert.equal(await drawn(page), 0);
    assert.ok(diff(await pixel(page, TREE_AT), bare.tree) <= 3, 'дерево скрыто');
    assert.equal(await page.isDisabled('[data-plan-ls="plants"]'), true, 'группы недоступны');
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('kepler-plan-landscape')).on), false);
    await page.check('#viewsLsOn');
    assert.equal(await drawn(page), 2);

    await page.uncheck('[data-plan-ls="plants"]');
    assert.equal(await drawn(page), 1, 'без деревьев — только парковка');
    assert.ok(diff(await pixel(page, TREE_AT), bare.tree) <= 3, 'дерево скрыто');
    assert.ok(diff(await pixel(page, PARK_AT), bare.park) > 6, 'парковка видна');
    await page.uncheck('[data-plan-ls="covers"]');
    assert.equal(await drawn(page), 0);
    await page.check('[data-plan-ls="plants"]');
    assert.equal(await drawn(page), 1);

    await page.click('#viewsLsPlanOnly');
    assert.equal(await drawn(page), 0, '«Только планировки»');
    assert.equal(await page.isChecked('#viewsLsOn'), false);
    assert.deepEqual(await page.$$eval('[data-plan-ls]:checked', (ns) => ns.length), 0);
    // Включили снова — группы по умолчанию.
    await page.check('#viewsLsOn');
    assert.equal(await drawn(page), 2);
    assert.deepEqual(app.errors, []);
  });

  it('настройка — вид в браузере: переживает перезагрузку, в проект не пишется', async () => {
    const { page } = app;
    await page.uncheck('[data-plan-ls="covers"]');
    const json = await page.evaluate(() => JSON.stringify(window.__kepler.state.project));
    assert.ok(!json.includes('planLs') && !json.includes('kepler-plan-landscape'));
    assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('kepler-plan-landscape')).covers), false);
  });

  it('«Участок» и «Ландшафт» — как раньше', async () => {
    const { page } = app;
    await page.click('#landscapeBtn');
    assert.equal(await drawn(page), 0, 'в «Ландшафте» — свои слои, не плановый');
    await page.click('#modePlanBtn');
    assert.equal(await drawn(page), 1);
    assert.deepEqual(app.errors, []);
  });
});
