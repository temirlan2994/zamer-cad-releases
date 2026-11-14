// e2e нестандартного зазора «≠ N мм»: «Замечания», три способа исправить (сдвинуть, растянуть,
// стена нужной толщины) из «Замечаний» и панели действий, отмена; автостыковка после растягивания.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { startApp, uploadText } from './helpers.mjs';

describe('нестандартный зазор между комнатами', () => {
  let app;
  before(async () => {
    app = await startApp();
    const text = await readFile(new URL('../fixtures/user-house-2026-11.json', import.meta.url), 'utf8');
    await uploadText(app.page, '#fileInput', 'house.kepler.json', text);
    await app.page.waitForFunction(() => window.__kepler.state.project.rooms.length > 5);
  });
  after(async () => { await app?.close(); });

  const gaps = () => app.page.evaluate(() => (window.__kepler.state.gaps || []).length);
  const roomsXY = () => app.page.evaluate(() => JSON.stringify(window.__kepler.state.project.rooms.map((r) => [r.id, r.x, r.y])));

  it('панель «⚠» показывает зазор, «Пристыковать» его убирает, Ctrl+Z возвращает', async () => {
    assert.ok((await gaps()) >= 1, 'зазор не найден в фикстуре');
    await app.page.click('#issuesBtn');
    const item = '#issuesPanel [data-issue-id^="gap:"]';
    await app.page.waitForSelector(`${item} [data-goto]`);
    assert.match(await app.page.textContent(item), /Нестандартный зазор \d+ мм/);
    await app.page.click(`${item} [data-goto]`);
    const sel = await app.page.evaluate(() => window.__kepler.state.selection);
    assert.equal(sel?.type, 'multi');
    assert.equal(sel.roomIds.length, 2, 'выбрана пара комнат зазора');
    assert.match(await app.page.textContent(`${item} [data-fix="move"]`), /Сдвинуть «.+» на \d+ мм/);
    assert.match(await app.page.textContent(`${item} [data-fix="stretch"]`), /(Продлить|Сузить) сторону «.+» на \d+ мм/);
    const before = await roomsXY();
    await app.page.click(`${item} [data-fix="move"]`);
    assert.notEqual(await roomsXY(), before, 'комната не сдвинулась');
    assert.equal(await gaps(), 0, 'зазор остался');
    await app.page.keyboard.press('Control+z');
    assert.equal(await roomsXY(), before, 'отмена не вернула положение');
    assert.ok((await gaps()) >= 1);
  });

  const focus = async () => {
    await app.page.evaluate(() => {
      const g = window.__kepler.state.gaps[0];
      window.__kepler.state.gapFocus = g.key;
      window.__kepler.select({ type: 'multi', roomIds: [g.a, g.b], itemIds: [] });
    });
  };
  const dims = () => app.page.evaluate(() => JSON.stringify(window.__kepler.state.project.rooms.map((r) => [r.id, r.x, r.y, r.w, r.h])));

  it('панель действий над выбранной парой: «Сдвинуть», «Растянуть», «Стена N» — у каждой подсказка', async () => {
    await focus();
    const bar = '#selectionToolbar';
    assert.match(await app.page.textContent(`${bar} .selection-toolbar-label`), /Зазор \d+ мм \(нужно \d+\)/);
    for (const a of ['gap-move', 'gap-stretch', 'gap-thicken']) {
      assert.equal(await app.page.isVisible(`${bar} [data-selection-action="${a}"]`), true, a);
      assert.ok((await app.page.getAttribute(`${bar} [data-selection-action="${a}"]`, 'title')).length > 10, `${a}: подсказка`);
    }
  });

  it('«Растянуть»: двигается одна сторона, размер меняется, комнаты стыкуются; Ctrl+Z возвращает', async () => {
    await focus();
    const before = await dims();
    const n = await gaps();
    await app.page.click('#selectionToolbar [data-selection-action="gap-stretch"]');
    assert.equal(await gaps(), n - 1, 'зазор убран');
    const after = await dims();
    const changed = JSON.parse(after).filter((r, i) => JSON.stringify(r) !== JSON.stringify(JSON.parse(before)[i]));
    assert.equal(changed.length, 1, 'изменилась одна комната');
    await app.page.keyboard.press('Control+z');
    assert.equal(await dims(), before);
    assert.equal(await gaps(), n);
  });

  it('«Стена N»: комнаты не двигаются, щель — общая стена; Ctrl+Z возвращает', async () => {
    await focus();
    const before = await dims();
    const n = await gaps();
    const label = await app.page.textContent('#selectionToolbar [data-selection-action="gap-thicken"]');
    if (/\d/.test(label)) {
      await app.page.click('#selectionToolbar [data-selection-action="gap-thicken"]');
      assert.equal(await dims(), before, 'комнаты на месте');
      assert.equal(await gaps(), n - 1);
      await app.page.keyboard.press('Control+z');
      assert.equal(await gaps(), n);
    } else {
      assert.equal(await app.page.isDisabled('#selectionToolbar [data-selection-action="gap-thicken"]'), true, 'нельзя — кнопка выключена');
    }
  });

  it('без ошибок в консоли', () => { assert.deepEqual(app.errors, []); });
});

describe('автостыковка после правки', () => {
  let app;
  let living;
  before(async () => {
    app = await startApp();
    await app.page.click('#startNew');
    await app.page.waitForFunction(() => document.getElementById('startScreen').hidden);
    living = await app.page.evaluate(async () => {
      const { createRoom } = await import('./core/model.js');
      const st = window.__kepler.state;
      const a = createRoom('living', 0, 0, 5000, 4000);
      const b = createRoom('bedroom', 5000 + 130, 0, 3000, 3000);
      st.project.rooms.push(a, b);
      const { refreshDerived, afterChange } = await import('./ui/store.js');
      refreshDerived(); afterChange();
      return a.id;
    });
  });
  after(async () => { await app?.close(); });

  const width = () => app.page.evaluate((id) => window.__kepler.state.project.rooms.find((x) => x.id === id).w, living);
  const gapCount = () => app.page.evaluate(() => (window.__kepler.state.gaps || []).length);
  const typeWidth = async (w) => {
    await app.page.evaluate((id) => window.__kepler.selectRoom(id), living);
    await app.page.fill('#roomW', String(w));
    await app.page.press('#roomW', 'Enter');
  };

  it('прежний зазор не трогаем: ввели ту же ширину по другой оси — зазор 130 остался', async () => {
    assert.equal(await gapCount(), 1, 'зазор 130 мм есть');
    await app.page.evaluate((id) => window.__kepler.selectRoom(id), living);
    const h = Number(await app.page.inputValue('#roomH'));
    await app.page.fill('#roomH', String(h + 500));
    await app.page.press('#roomH', 'Enter');
    await app.page.waitForFunction(() => window.__kepler.state.project.rooms[0].h === 4500);
    assert.equal(await gapCount(), 1, 'зазор не менялся — не стыкуем');
    await app.page.keyboard.press('Control+z');
  });

  it('кнопка «Магнит» выключена — введённая ширина остаётся как есть', async () => {
    await app.page.evaluate(() => { window.__kepler.state.snapSettings.magnet = false; });
    await typeWidth(5020);
    await app.page.waitForFunction(() => window.__kepler.state.project.rooms[0].w === 5020);
    assert.equal(await gapCount(), 1, 'зазор 110 остался');
    assert.doesNotMatch(await app.page.textContent('#toast'), /Состыковано/);
    await app.page.keyboard.press('Control+z');
    assert.equal(await width(), 5000);
    await app.page.evaluate(() => { window.__kepler.state.snapSettings.magnet = true; });
  });

  it('ввели ширину, зазор стал 110 мм: сторона продлена до стены 100 мм; Ctrl+Z — как введено, ещё раз — как было', async () => {
    await typeWidth(5020);
    await app.page.waitForFunction(() => window.__kepler.state.project.rooms[0].w === 5030);
    assert.equal(await width(), 5030, 'сторона прилипла: 5020 + 10');
    assert.equal(await gapCount(), 0, 'общая стена образовалась');
    assert.match(await app.page.textContent('#toast'), /Состыковано: общая стена 100 мм \(10 мм\)/);
    await app.page.keyboard.press('Control+z');
    assert.equal(await width(), 5020, 'введённое значение сохранено');
    assert.equal(await gapCount(), 1);
    await app.page.keyboard.press('Control+z');
    assert.equal(await width(), 5000);
    assert.deepEqual(app.errors, []);
  });

  it('зазор дальше 60 мм от толщины стены — не стыкуем', async () => {
    await typeWidth(4900); // зазор 230
    await app.page.waitForFunction(() => window.__kepler.state.project.rooms[0].w === 4900);
    assert.equal(await width(), 4900);
    assert.equal(await gapCount(), 1);
    await app.page.keyboard.press('Control+z');
  });
});
