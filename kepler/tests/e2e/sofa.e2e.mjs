// e2e: диван-конструктор — «+» на плане, меню модулей, отмена; список модулей в панели.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, openNew, dropOnCanvas } from './helpers.mjs';

describe('диван-конструктор', () => {
  let app;
  before(async () => {
    app = await startApp();
    await openNew(app.page);
    await dropOnCanvas(app.page, 'application/x-kepler-room', 'living');
    await dropOnCanvas(app.page, 'application/x-kepler-furn', 'sofa');
  });
  after(async () => { await app?.close(); });

  const sofa = () => app.page.evaluate(() => window.__kepler.state.project.items.find((i) => i.kind === 'sofa'));

  it('«+» на конце дивана → меню → модуль добавлен, отмена убирает', async () => {
    const s0 = await sofa();
    assert.equal(s0.comp?.type, 'sofa');
    assert.equal(s0.comp.modules.length, 4);
    await app.page.evaluate((id) => window.__kepler.select({ type: 'item', id }), s0.id);
    await app.page.waitForSelector('#compSofa');
    await app.page.waitForFunction(() => window.__kepler.state._sofaUI?.spots?.filter((s) => s.end !== 'joint').length === 2);
    const spot = await app.page.evaluate(() => window.__kepler.state._sofaUI.spots.find((s) => s.end === 'end'));
    const box = await (await app.page.$('#canvas')).boundingBox();
    await app.page.mouse.click(box.x + spot.x, box.y + spot.y);
    await app.page.waitForSelector('#sofaMenu:not([hidden])');
    await app.page.click('#sofaMenu [data-sofa-add="seat"]');
    await app.page.waitForFunction(() => document.querySelector('#sofaCount')?.textContent === '5');
    const s1 = await sofa();
    assert.equal(s1.comp.modules.length, 5);
    assert.equal(s1.comp.modules.at(-1).type, 'seat');
    assert.equal(s1.w, s0.w + 900);
    assert.equal(s1.x - s1.w / 2, s0.x - s0.w / 2, 'левый край не сдвинулся');
    assert.equal(await app.page.evaluate(() => window.__kepler.state.selection?.type), 'item', 'выделение не сбито');
    await app.page.keyboard.press('Control+z');
    await app.page.waitForFunction(() => window.__kepler.state.project.items.find((i) => i.kind === 'sofa').comp.modules.length === 4);
    assert.equal((await sofa()).w, s0.w);
  });

  it('«+» на стыке — вставка в середину, отмена', async () => {
    const s0 = await sofa();
    await app.page.evaluate((id) => window.__kepler.select({ type: 'item', id }), s0.id);
    await app.page.waitForFunction(() => window.__kepler.state._sofaUI?.spots?.some((s) => s.end === 'joint'));
    const spot = await app.page.evaluate(() => window.__kepler.state._sofaUI.spots.find((s) => s.end === 'joint'));
    const box = await (await app.page.$('#canvas')).boundingBox();
    await app.page.mouse.click(box.x + spot.x, box.y + spot.y);
    await app.page.waitForSelector('#sofaMenu:not([hidden])');
    await app.page.click('#sofaMenu [data-sofa-add="ottoman"]');
    await app.page.waitForFunction(() => document.querySelector('#sofaCount')?.textContent === '5');
    const s1 = await sofa();
    assert.equal(s1.comp.modules[spot.at].type, 'ottoman');
    await app.page.keyboard.press('Control+z');
    await app.page.waitForFunction(() => window.__kepler.state.project.items.find((i) => i.kind === 'sofa').comp.modules.length === 4);
  });

  it('панель: угловой модуль и удаление', async () => {
    const s0 = await sofa();
    await app.page.evaluate((id) => window.__kepler.select({ type: 'item', id }), s0.id);
    await app.page.waitForSelector('#compSofa');
    await app.page.selectOption('#sofaAddType', 'corner');
    await app.page.click('#sofaAdd');
    await app.page.waitForFunction(() => document.querySelector('#sofaCount')?.textContent === '5');
    const s1 = await sofa();
    assert.equal(s1.h, s0.h, 'угол в конце — глубина та же');
    await app.page.click('[data-sofa-del="4"]');
    await app.page.waitForFunction(() => document.querySelector('#sofaCount')?.textContent === '4');
    assert.deepEqual(app.errors, []);
  });
});
