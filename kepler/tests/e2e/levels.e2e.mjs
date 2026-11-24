// e2e этажей: переключатель, новый этаж с лестницей, подложка этажа ниже,
// PgUp/PgDn, отмена, удаление.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { pickWorkspaceView, startApp, openNew, dropOnCanvas } from './helpers.mjs';

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

describe('общие отступы окон в пол', () => {
  let app;
  before(async () => {
    app = await startApp({ width: 1280, height: 800 });
    await openNew(app.page);
    await app.page.evaluate(async () => {
      const { createOpening, createRoom } = await import('./core/model.js');
      const { mutate } = await import('./ui/store.js');
      const project = window.__kepler.state.project;
      const room = createRoom('living', 0, 0, 8000, 5000);
      const linkedA = createOpening('window', room.id, 0, 1800, 1200);
      Object.assign(linkedA, {
        id: 'linked-a', type: 'panoramic', heightMode: 'level', sill: 0, height: 1800,
      });
      const linkedB = createOpening('window', room.id, 0, 4200, 1200);
      Object.assign(linkedB, {
        id: 'linked-b', type: 'lift-slide', heightMode: 'level', sill: 300, height: 2700,
      });
      const custom = createOpening('window', room.id, 0, 6500, 900);
      Object.assign(custom, {
        id: 'custom', type: 'fixed', heightMode: 'custom', sill: 700, height: 1600,
      });
      mutate(() => {
        project.rooms = [room];
        project.openings = [linkedA, linkedB, custom];
      });
    });
  });
  after(async () => { await app?.close(); });

  it('одной парой полей меняет все связанные окна, но не индивидуальные', async () => {
    const { page } = app;
    const signatureBefore = await page.evaluate(async () => {
      const { layoutSignature } = await import('./ui/auto-layout.js');
      const project = window.__kepler.state.project;
      return layoutSignature(project, project.rooms[0]);
    });
    if (!(await page.isVisible('#tallWindowBottomGap'))) await page.click('#projectSummary');
    await page.fill('#tallWindowBottomGap', '0');
    await page.press('#tallWindowBottomGap', 'Tab');
    await page.fill('#tallWindowTopGap', '200');
    await page.press('#tallWindowTopGap', 'Tab');

    const geometry = () => page.evaluate(async () => {
      const { activeLevel } = await import('./core/model.js');
      const { openingHeight, openingSill } = await import('./core/opening-preset.js');
      const project = window.__kepler.state.project;
      const level = activeLevel(project);
      return Object.fromEntries(project.openings.map((opening) => [opening.id, {
        sill: openingSill(opening, level), height: openingHeight(opening, level),
        mode: opening.heightMode,
      }]));
    });
    let values = await geometry();
    assert.deepEqual(values['linked-a'], { sill: 0, height: 2800, mode: 'level' });
    assert.deepEqual(values['linked-b'], values['linked-a']);
    assert.deepEqual(values.custom, { sill: 700, height: 1600, mode: 'custom' });
    assert.match(await page.textContent('#tallWindowComputedHeight'), /2800 мм · 2 окна/);
    assert.notEqual(await page.evaluate(async () => {
      const { layoutSignature } = await import('./ui/auto-layout.js');
      const project = window.__kepler.state.project;
      return layoutSignature(project, project.rooms[0]);
    }), signatureBefore, 'общие отступы инвалидируют готовый вариант авторасстановки');

    await page.evaluate(async () => {
      const { selectObject } = await import('./ui/tools.js');
      selectObject({ type: 'opening', id: 'linked-a' });
    });
    assert.equal(await page.inputValue('#openH'), '2800');
    assert.equal(await page.inputValue('#openSill'), '0');
    assert.equal(await page.isDisabled('#openH'), true);
    assert.equal(await page.isDisabled('#openSill'), true);
    await page.uncheck('#openHeightLinked');

    await page.evaluate(async () => {
      const { selectObject } = await import('./ui/tools.js');
      selectObject(null);
    });
    if (!(await page.isVisible('#tallWindowBottomGap'))) await page.click('#projectSummary');
    await page.fill('#tallWindowBottomGap', '100');
    await page.press('#tallWindowBottomGap', 'Tab');
    await page.fill('#tallWindowTopGap', '400');
    await page.press('#tallWindowTopGap', 'Tab');
    values = await geometry();
    assert.deepEqual(values['linked-a'], { sill: 0, height: 2800, mode: 'custom' }, 'отвязанное окно сохраняет геометрию');
    assert.deepEqual(values['linked-b'], { sill: 100, height: 2500, mode: 'level' });
    assert.deepEqual(values.custom, { sill: 700, height: 1600, mode: 'custom' });
    assert.deepEqual(app.errors, []);
  });
});

describe('надстройка комнаты', () => {
  it('из каталога 3D на план → комната этажом выше → общие отступы → отмена', async () => {
    const app = await startApp();
    try {
      const { page } = app;
      await openNew(page);
      await page.click('#view3dBtn');
      await page.click('#furnitureToolBtn');
      await page.click('#modelAddRoom');
      assert.equal(await page.isVisible('#roomSearch'), true);
      await dropOnCanvas(page, 'application/x-kepler-room', 'living');
      await page.click('#roomAbove');
      const result = await levels(page);
      assert.equal(result.list.length, 2);
      assert.deepEqual(result.list[0].rooms, result.list[1].rooms);
      assert.equal(result.active, result.list[1].id);
      await page.keyboard.press('Control+z');
      assert.equal((await levels(page)).list.length, 1);
      await page.keyboard.press('Control+y');
      assert.equal((await levels(page)).list.length, 2);
      await page.click('#levelBar button:first-child');
      await page.click('#projectSummary');
      assert.equal(await page.isChecked('#allLevelWindowGaps'), true);
      await page.fill('#tallWindowTopGap', '240');
      await page.press('#tallWindowTopGap', 'Tab');
      const gaps = () => page.evaluate(() => window.__kepler.state.project.levels.map((level) => level.tallWindowTopOffset));
      assert.deepEqual(await gaps(), [240, 240]);
      await page.uncheck('#allLevelWindowGaps');
      await page.fill('#tallWindowTopGap', '320');
      await page.press('#tallWindowTopGap', 'Tab');
      assert.deepEqual(await gaps(), [320, 240]);
      await page.evaluate(async () => {
        const { selectObject } = await import('./ui/tools.js');
        selectObject({ type: 'room', id: window.__kepler.state.project.rooms[0].id });
      });
      await page.click('#roomAbove');
      assert.match(await page.textContent('#toast'), /место занимает/);
      assert.deepEqual((await levels(page)).list.map((l) => l.rooms.length), [1, 1]);
      assert.deepEqual(app.errors, []);
    } finally { await app.close(); }
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
      await picker.tap();
      const menu = page.getByRole('dialog', { name: 'Все виды проекта' });
      const bounds = await menu.boundingBox();
      assert.ok(bounds && bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= 390.5 && bounds.y + bounds.height <= 844.5);
      await menu.getByRole('tab', { name: 'Модель и участок' }).tap();
      await menu.getByRole('button', { name: 'Ландшафт', exact: true }).tap();
      assert.equal(await page.evaluate(() => window.__kepler.state.modeName), 'landscape');
      await pickWorkspaceView(page, 'plans', 'add-level');
      const created = await levels(page);
      assert.equal(created.list.length, 2);
      assert.equal(await page.evaluate(() => window.__kepler.state.modeName), 'plan');
      await pickWorkspaceView(page, 'plans', 'level-properties');
      await page.waitForSelector('#levelSection[open] #levelName');
      assert.equal(await page.evaluate(() => document.activeElement.id), 'levelSummary');
      await page.fill('#levelName', 'Мансарда');
      await page.press('#levelName', 'Tab');
      await page.fill('#levelHeight', '3.6');
      await page.press('#levelHeight', 'Tab');
      await page.waitForFunction(() => window.__kepler.state.project.levels.at(-1).height === 3600);
      await page.fill('#tallWindowBottomGap', '80');
      await page.press('#tallWindowBottomGap', 'Tab');
      await page.fill('#tallWindowTopGap', '320');
      await page.press('#tallWindowTopGap', 'Tab');
      assert.deepEqual(await page.evaluate(() => {
        const level = window.__kepler.state.project.levels.at(-1);
        return [level.tallWindowBottomOffset, level.tallWindowTopOffset, level.tallWindowHeight];
      }), [80, 320, 3200]);
      await pickWorkspaceView(page, 'model', 'site');
      await picker.tap();
      await menu.getByRole('tab', { name: 'Планы' }).tap();
      await menu.getByRole('button', { name: 'Мансарда', exact: true }).tap();
      assert.equal((await levels(page)).active, created.active);
      await pickWorkspaceView(page, 'plans', 'level-properties');
      await page.tap('#deleteLevel');
      await page.waitForFunction(() => window.__kepler.state.project.levels.length === 1);
      await picker.tap();
      await menu.getByRole('tab', { name: 'Планы' }).tap();
      assert.equal(await menu.getByRole('button', { name: 'Мансарда', exact: true }).count(), 0);
      assert.deepEqual(app.errors, []);
    } finally { await app.close(); }
  });
});
