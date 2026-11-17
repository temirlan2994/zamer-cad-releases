// e2e этажей: переключатель, новый этаж с лестницей, подложка этажа ниже,
// PgUp/PgDn, отмена, удаление.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, openNew, dropOnCanvas } from './helpers.mjs';

const levels = (page) => page.evaluate(() => {
  const p = window.__kepler.state.project;
  return {
    active: p.activeLevel,
    list: p.levels.map((l) => ({ id: l.id, name: l.name, rooms: l.rooms.map((r) => ({ type: r.type, x: r.x, y: r.y })) })),
    bar: [...document.querySelectorAll('#levelBar button')].map((b) => b.textContent),
  };
});

describe('этажи', () => {
  let app;
  before(async () => { app = await startApp({ issueGroups: 'all' }); await openNew(app.page); });
  after(async () => { await app?.close(); });

  it('один этаж и кнопка «+» на холсте', async () => {
    const s = await levels(app.page);
    assert.deepEqual(s.bar, ['1 этаж', '+']);
  });

  it('«+» добавляет этаж сверху и переносит лестницу на то же место', async () => {
    await dropOnCanvas(app.page, 'application/x-kepler-room', 'stairs-room');
    await app.page.click('#levelBar button.add');
    const s = await levels(app.page);
    assert.equal(s.list.length, 2);
    assert.equal(s.active, s.list[1].id);
    assert.deepEqual(s.bar, ['1 этаж', '2 этаж', '+']);
    assert.deepEqual(s.list[1].rooms, s.list[0].rooms, 'лестница на том же месте');
    const below = await app.page.evaluate(() => window.__kepler.state.belowWalls?.length || 0);
    assert.ok(below > 0, 'стены этажа ниже видны подложкой');
    assert.match(await app.page.textContent(`#issuesPanel [data-issue-id="access:${s.list[1].id}:ok"]`), /от лестницы/);
  });

  it('комнаты второго этажа не трогают первый', async () => {
    // Слева от лестницы, в осях дома.
    const at = await app.page.evaluate(() => {
      const k = window.__kepler;
      const st = k.state.project.rooms[0];
      return k.planToScreen(st.x - 4000, st.y + st.h / 2);
    });
    await dropOnCanvas(app.page, 'application/x-kepler-room', 'bedroom', at);
    const s = await levels(app.page);
    assert.deepEqual(s.list[1].rooms.map((r) => r.type).sort(), ['bedroom', 'stairs-room']);
    assert.deepEqual(s.list[0].rooms.map((r) => r.type), ['stairs-room']);
  });

  it('PgDn / PgUp и клик по этажу переключают этаж', async () => {
    const { list } = await levels(app.page);
    await app.page.keyboard.press('PageDown');
    assert.equal((await levels(app.page)).active, list[0].id);
    assert.equal(await app.page.evaluate(() => window.__kepler.state.belowWalls), null);
    await app.page.keyboard.press('PageUp');
    assert.equal((await levels(app.page)).active, list[1].id);
    await app.page.click('#levelBar button[data-level="L1"]');
    assert.equal((await levels(app.page)).active, 'L1');
    await app.page.click(`#levelBar button[data-level="${list[1].id}"]`);
  });

  it('отмена убирает этаж; удаление этажа из свойств', async () => {
    await app.page.keyboard.press('Control+z'); // спальня
    await app.page.keyboard.press('Control+z'); // этаж
    assert.equal((await levels(app.page)).list.length, 1);
    await app.page.click('#levelBar button.add');
    await app.page.keyboard.press('Escape');
    if (!(await app.page.isVisible('#deleteLevel'))) await app.page.click('#projectSummary'); // секция «Проект»
    await app.page.click('#deleteLevel');
    const s = await levels(app.page);
    assert.equal(s.list.length, 1);
    assert.deepEqual(s.bar, ['1 этаж', '+']);
  });

  it('без ошибок в консоли', () => {
    assert.deepEqual(app.errors, []);
  });
});

describe('этажи на телефоне', () => {
  it('добавление, свойства, переход с участка и удаление через меню видов', async () => {
    const app = await startApp({ mobile: true });
    try {
      const { page } = app;
      await openNew(page);
      const picker = page.locator('#workspaceViewPicker');
      assert.equal(await page.isVisible('#levelDock'), false);
      await picker.selectOption('landscape');
      await picker.selectOption('add-level');
      const created = await levels(page);
      assert.equal(created.list.length, 2);
      assert.equal(await page.evaluate(() => window.__kepler.state.modeName), 'plan');
      await picker.selectOption('level-properties');
      await page.waitForSelector('#levelSection[open] #levelName');
      assert.equal(await page.evaluate(() => document.activeElement.id), 'levelSummary');
      await page.fill('#levelName', 'Мансарда');
      await page.press('#levelName', 'Tab');
      await page.fill('#levelHeight', '3.6');
      await page.press('#levelHeight', 'Tab');
      await page.waitForFunction(() => window.__kepler.state.project.levels.at(-1).height === 3600);
      await picker.selectOption('site');
      await picker.selectOption({ label: 'Мансарда' });
      assert.equal((await levels(page)).active, created.active);
      await picker.selectOption('level-properties');
      await page.tap('#deleteLevel');
      await page.waitForFunction(() => window.__kepler.state.project.levels.length === 1);
      await page.waitForFunction(() => ![...document.querySelector('#workspaceViewPicker').options].some((o) => o.textContent.includes('Мансарда')));
      assert.deepEqual(app.errors, []);
    } finally { await app.close(); }
  });
});
