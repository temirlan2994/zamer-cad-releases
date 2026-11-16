// e2e: световой анализ выбранной комнаты. Проверяем связку UI → ленивый
// расчёт → карта/легенда и живой пересчёт площади остекления после правки
// настоящего окна, а не только расчёт фасадных часов.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { clickToolbarTool, openNew, startApp } from './helpers.mjs';

async function scene(page) {
  return page.evaluate(async () => {
    const model = await import('./core/model.js');
    const store = await import('./ui/store.js');
    const st = window.__kepler.state;
    const project = model.createProject('Световой анализ');
    const room = model.createRoom('living', 0, 0, 6000, 5000);
    room.id = 'solar-room';
    const opening = model.createOpening('window', room.id, 2, 3000, 1000);
    opening.id = 'solar-window';
    opening.height = 2400;
    opening.sill = 0;
    project.rooms.push(room);
    project.openings.push(opening);
    project.site.solarVerified = true;
    project.site.sun.date = '2026-03-21';
    st.project = project;
    st.selection = null;
    store.refreshDerived();
    store.afterChange();
    window.__kepler.fitView();
    window.__kepler.select({ type: 'room', id: room.id });
    return { roomId: room.id, windowId: opening.id };
  });
}

async function heavyReportScene(page, count = 16) {
  return page.evaluate(async (roomCount) => {
    const model = await import('./core/model.js');
    const store = await import('./ui/store.js');
    const st = window.__kepler.state;
    const project = model.createProject('Большой световой отчёт');
    project.site.solarVerified = true;
    for (let i = 0; i < roomCount; i += 1) {
      const room = model.createRoom('living', (i % 4) * 8000, Math.floor(i / 4) * 7000, 6000, 5000);
      room.id = `async-room-${i}`;
      project.rooms.push(room);
      const opening = model.createOpening('window', room.id, 2, 3000, 1800);
      opening.id = `async-window-${i}`;
      opening.height = 1800;
      opening.sill = 700;
      project.openings.push(opening);
    }
    for (let i = 0; i < roomCount * 2; i += 1) {
      project.site.neighbors.push({
        id: `async-neighbor-${i}`,
        x: -20_000 + (i % 8) * 8000,
        y: 35_000 + Math.floor(i / 8) * 6000,
        w: 3000, h: 3000, height: 6000, rot: 0,
      });
    }
    st.project = project;
    st.selection = null;
    store.refreshDerived();
    store.afterChange();
    return roomCount * 12;
  }, count);
}

async function startSolarReport(page) {
  await page.evaluate(async () => {
    const { openSolarReport } = await import('./ui/solar-report-ui.js');
    void openSolarReport();
  });
}

const analysis = (page) => page.evaluate(async () => {
  const { currentSolarAnalysis } = await import('./ui/solar-analysis.js');
  const value = currentSolarAnalysis();
  return value && {
    roomId: value.roomId,
    verified: value.verified,
    windows: value.windows,
    glazingArea: value.glazing.area,
    points: value.points.length,
  };
});

describe('световой анализ комнаты', () => {
  let app;
  let ids;

  before(async () => {
    app = await startApp({ width: 1400, height: 900 });
    await openNew(app.page);
    ids = await scene(app.page);
  });

  after(async () => { await app?.close(); });

  it('включается для выбранной комнаты и показывает проверенную карту', async () => {
    const { page } = app;
    await page.waitForSelector('#roomName');
    assert.match(await page.textContent('#propsPanel'), /Световой анализ/);
    assert.equal(await page.getAttribute('#sunAnalysisBtn', 'aria-pressed'), 'false');

    await clickToolbarTool(page, 'sunAnalysisBtn');
    await page.waitForSelector('#solarLegend:not([hidden])');
    assert.equal(await page.getAttribute('#sunAnalysisBtn', 'aria-pressed'), 'true');
    assert.match(await page.textContent('#solarLegend'), /Прямое солнце/);

    const value = await analysis(page);
    assert.equal(value.roomId, ids.roomId);
    assert.equal(value.verified, true);
    assert.equal(value.windows, 1);
    assert.ok(value.points > 0, JSON.stringify(value));
    assert.ok(Math.abs(value.glazingArea - 2.4) < 0.001, JSON.stringify(value));
  });

  it('изменение ширины окна сразу пересчитывает остекление', async () => {
    const { page } = app;
    await page.evaluate((id) => window.__kepler.select({ type: 'opening', id }), ids.windowId);
    await page.waitForSelector('#openW');
    await page.fill('#openW', '2000');
    await page.locator('#openW').blur();
    await page.waitForFunction(async () => {
      const { currentSolarAnalysis } = await import('./ui/solar-analysis.js');
      return (currentSolarAnalysis()?.glazing.area || 0) > 4.7;
    });

    const value = await analysis(page);
    assert.ok(Math.abs(value.glazingArea - 4.8) < 0.001, JSON.stringify(value));
    assert.equal(await page.isVisible('#solarLegend'), true, 'карта остаётся при редактировании её окна');

    await page.evaluate((id) => window.__kepler.select({ type: 'room', id }), ids.roomId);
    await page.waitForSelector('#roomName');
    assert.match(await page.textContent('#propsPanel'), /Остекление[\s\S]*4[,.]8/);
  });

  it('переключается на эскизные КЕО/люксы и реагирует на стекло', async () => {
    const { page } = app;
    await page.focus('#solarDirectTab');
    await page.keyboard.press('ArrowRight');
    await page.waitForFunction(() => window.__kepler.state.solarAnalysis?.mode === 'daylight');
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'solarDaylightTab');
    await page.waitForSelector('[data-daylight-metric="lux-mean"]');
    assert.match(await page.textContent('#solarLegend'), /Освещённость|500\+ лк/);
    assert.match(await page.textContent('#solarAnalysisPanel'), /Предварительная оценка|Предварительно/);

    const before = await page.evaluate(async () => {
      const { currentDaylightAnalysis } = await import('./ui/solar-analysis.js');
      const value = currentDaylightAnalysis();
      return { df: value.meanDaylightFactor, lux: value.meanLux, coverage300: value.coverage300 };
    });
    assert.ok(before.df > 0 && before.lux > 0, JSON.stringify(before));
    assert.ok(before.coverage300 >= 0 && before.coverage300 <= 1, JSON.stringify(before));

    await page.fill('#daylightTransmittance', '30');
    await page.locator('#daylightTransmittance').blur();
    await page.waitForFunction(async (previous) => {
      const { currentDaylightAnalysis } = await import('./ui/solar-analysis.js');
      return currentDaylightAnalysis()?.meanLux < previous;
    }, before.lux);
    const after = await page.evaluate(async () => {
      const { currentDaylightAnalysis } = await import('./ui/solar-analysis.js');
      return currentDaylightAnalysis().meanLux;
    });
    assert.ok(after < before.lux, `${before.lux} → ${after}`);
  });

  it('строит сезонную сводку и готовит CSV/JSON', async () => {
    const { page } = app;
    const currentLux = await page.evaluate(async () => {
      const { currentDaylightAnalysis } = await import('./ui/solar-analysis.js');
      return currentDaylightAnalysis().meanLux;
    });
    await page.click('[data-solar-report-open]');
    await page.waitForSelector('#solarReportDialog:not([hidden])');
    await page.waitForFunction(() => /\u0421\u0432\u043e\u0434\u043a\u0430 \u0433\u043e\u0442\u043e\u0432\u0430/.test(document.querySelector('#solarReportStatus')?.textContent || ''));
    assert.equal(await page.locator(`[data-solar-report-row="${ids.roomId}"]`).count(), 1);
    assert.match(await page.textContent('#solarReportSummary'), /1 помещение[\s\S]*12 реперных/);
    assert.equal(await page.isEnabled('#solarReportCsv'), true);
    assert.equal(await page.isEnabled('#solarReportJson'), true);
    assert.match(await page.textContent(`[data-solar-report-row="${ids.roomId}"]`), /КЕО|%|\u043bк/);
    const reportLuxText = await page.textContent(
      `[data-solar-report-row="${ids.roomId}"] [data-report-metric="illuminance"]`,
    );
    const reportLux = Number(reportLuxText.replace(/[^0-9,.-]/g, '').replace(',', '.'));
    assert.ok(Math.abs(reportLux - currentLux) <= 1, `карта ${currentLux} лк, отчёт ${reportLuxText}`);

    const beforeDelete = await page.evaluate(() => ({
      rooms: window.__kepler.state.project.rooms.length,
      selection: window.__kepler.state.selection?.id,
    }));
    await page.keyboard.press('Delete');
    assert.deepEqual(await page.evaluate(() => ({
      rooms: window.__kepler.state.project.rooms.length,
      selection: window.__kepler.state.selection?.id,
    })), beforeDelete, 'модальный отчёт не пропускает Delete в план');
    await page.keyboard.press('Escape');
    assert.equal(await page.isHidden('#solarReportDialog'), true);
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'solarAnnualRun');
  });

  it('показывает живой progress, отменяет большой отчёт и чисто открывается снова', async () => {
    const { page } = app;
    const total = await heavyReportScene(page);
    await startSolarReport(page);
    await page.waitForSelector('#solarReportDialog:not([hidden])');
    await page.waitForFunction(() => /^\u0420\u0430\u0441\u0447\u0451\u0442: \d+ \u0438\u0437 \d+/.test(
      document.querySelector('#solarReportStatus')?.textContent || '',
    ));
    const progressText = await page.textContent('#solarReportStatus');
    const progress = /^(?:\u0420\u0430\u0441\u0447\u0451\u0442: )(\d+) \u0438\u0437 (\d+)/.exec(progressText);
    assert.ok(progress, progressText);
    assert.ok(Number(progress[1]) > 0 && Number(progress[1]) < total, progressText);
    assert.equal(Number(progress[2]), total);

    await page.keyboard.press('Escape');
    await page.waitForSelector('#solarReportDialog', { state: 'hidden' });
    await page.waitForTimeout(100);
    assert.doesNotMatch(await page.textContent('#solarReportStatus'), /Сводка готова/);

    ids = await scene(page);
    await startSolarReport(page);
    await page.waitForSelector('#solarReportDialog:not([hidden])');
    await page.waitForFunction(() => /Сводка готова/.test(
      document.querySelector('#solarReportStatus')?.textContent || '',
    ));
    assert.equal(await page.locator(`[data-solar-report-row="${ids.roomId}"]`).count(), 1);
    await page.keyboard.press('Escape');
    assert.equal(await page.isHidden('#solarReportDialog'), true);
    assert.deepEqual(app.errors, []);
  });

  it('выключение убирает аналитическую легенду и не даёт ошибок', async () => {
    const { page } = app;
    await clickToolbarTool(page, 'sunAnalysisBtn');
    assert.equal(await page.getAttribute('#sunAnalysisBtn', 'aria-pressed'), 'false');
    assert.equal(await page.isHidden('#solarLegend'), true);
    assert.deepEqual(app.errors, []);
  });
});

describe('световой анализ на телефоне', () => {
  let app;

  before(async () => {
    app = await startApp({ mobile: true });
    await openNew(app.page);
    await scene(app.page);
  });

  after(async () => { await app?.close(); });

  it('включается из свойств комнаты; запасной вход синхронен', async () => {
    const { page } = app;
    assert.equal(await page.isVisible('#sunAnalysisBtn'), false, 'колонка инструментов скрыта');

    // Основной телефонный путь: выбранная комната → «Свойства».
    await page.tap('#mobileBar [data-sheet="props"]');
    await page.waitForSelector('#solarAnalysisOn', { state: 'visible' });
    assert.equal(await page.isChecked('#solarAnalysisOn'), false);
    await page.tap('#solarAnalysisOn');
    await page.waitForFunction(() => window.__kepler.state.solarAnalysis?.on === true);
    await page.waitForSelector('#solarLegend:not([hidden])', { state: 'visible' });
    assert.equal(await page.isChecked('#solarAnalysisOn'), true);

    // Запасной путь — «Свойства» активного вида без выделения. Он должен
    // отражать то же состояние, а не включать второй независимый режим.
    await page.tap('#mobileBar [data-sheet="props"]'); // закрыть лист
    await page.evaluate(() => window.__kepler.select(null));
    await page.tap('#mobileBar [data-sheet="props"]');

    const section = '#propsPanel details[data-sec="solar"]';
    await page.waitForSelector(section);
    if (!await page.$eval(section, (node) => node.open)) await page.tap(`${section} > summary`);
    await page.waitForSelector('#viewsSolarOn', { state: 'visible' });
    assert.match(await page.textContent('#viewsSolar'), /Световой анализ|Карта прямого солнца/);
    assert.equal(await page.isChecked('#viewsSolarOn'), true);

    const legend = await page.locator('#solarLegend').boundingBox();
    assert.ok(legend && legend.x >= 0 && legend.y >= 0, JSON.stringify(legend));
    assert.ok(legend.x + legend.width <= 390.5, `легенда помещается по ширине: ${JSON.stringify(legend)}`);
    assert.ok(legend.y + legend.height <= 844.5, `легенда помещается по высоте: ${JSON.stringify(legend)}`);
    assert.deepEqual(app.errors, []);
  });
});
