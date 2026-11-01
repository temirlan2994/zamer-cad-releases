// e2e участка: импорт DXF (выбросы, блоки, proxy), поворот вида «Выровнять».
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  startApp, openNew, uploadText, clickWorld,
  dxfSurveyWithOutlier, dxfWithBlocks, dxfProxyOnly,
} from './helpers.mjs';

const underlay = (page) => page.evaluate(() => {
  const u = window.__kepler.state.project.site.underlay;
  return u ? { widthM: (u.widthPx * u.mmPerPx) / 1000, rot: u.rot || 0 } : null;
});

describe('участок', () => {
  let app;
  before(async () => {
    app = await startApp();
    await openNew(app.page);
    await app.page.click('#modeSiteBtn');
  });
  after(async () => { await app?.close(); });

  it('DXF с далёким выбросом: масштаб правдоподобный', async () => {
    await uploadText(app.page, '#underlayInput', 'survey.dxf', dxfSurveyWithOutlier());
    await app.page.waitForFunction(() => Boolean(window.__kepler.state.project.site.underlay));
    const u = await underlay(app.page);
    assert.ok(u.widthM > 10 && u.widthM < 100, `ширина ${u.widthM} м`);
    assert.match(await app.page.textContent('#toast'), /DXF/);
  });

  it('DXF с блоками INSERT разворачивается', async () => {
    await uploadText(app.page, '#underlayInput', 'blocks.dxf', dxfWithBlocks());
    await app.page.waitForFunction(() => /INSERT/.test(document.getElementById('toast').textContent));
    assert.ok(await underlay(app.page));
  });

  it('DXF только с proxy-объектами — понятная подсказка', async () => {
    await uploadText(app.page, '#underlayInput', 'proxy.dxf', dxfProxyOnly());
    await app.page.waitForFunction(() => /proxy/i.test(document.getElementById('toast').textContent));
  });

  it('«Выровнять» поворачивает весь вид, одинаково в обоих режимах', async () => {
    await app.page.click('#modePlanBtn');
    await app.page.click('#alignBtn');
    // Две точки вдоль линии под 30°.
    await clickWorld(app.page, 0, 0);
    await clickWorld(app.page, 1000, 577);
    const plan = await app.page.evaluate(() => ({
      rot: window.__kepler.state.project.viewRotation,
      view: window.__kepler.state.view.rotation,
    }));
    assert.ok(Math.abs(plan.rot - 330) < 0.5, `viewRotation=${plan.rot}`);
    assert.ok(Math.abs(plan.view - (-30 * Math.PI) / 180) < 0.01 || Math.abs(plan.view - (330 * Math.PI) / 180) < 0.01);
    await app.page.click('#modeSiteBtn');
    const site = await app.page.evaluate(() => window.__kepler.state.view.rotation);
    // В «Участке» тот же поворот (север проекта = 0).
    assert.ok(Math.abs(Math.cos(site) - Math.cos(plan.view)) < 1e-6 && Math.abs(Math.sin(site) - Math.sin(plan.view)) < 1e-6);
  });

  it('повторное «Выровнять» сбрасывает поворот', async () => {
    await app.page.click('#modePlanBtn');
    await app.page.click('#alignBtn');
    const rot = await app.page.evaluate(() => [window.__kepler.state.project.viewRotation, window.__kepler.state.view.rotation]);
    assert.deepEqual(rot, [0, 0]);
  });

  it('без ошибок в консоли', () => {
    assert.deepEqual(app.errors, []);
  });
});
