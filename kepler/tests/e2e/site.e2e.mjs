// e2e участка: импорт DXF (выбросы, блоки, proxy), поворот дома «Выровнять».
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  startApp, openNew, uploadText, clickWorld, dropOnCanvas,
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

  it('«Выровнять» ставит дом вдоль линии участка: в «Плане» комнаты прямые', async () => {
    await app.page.click('#modePlanBtn');
    await app.page.click('#alignBtn');
    // Две точки вдоль линии участка под 30° (координаты съёмки).
    await clickWorld(app.page, 0, 0);
    await clickWorld(app.page, 1000, 577);
    const s = await app.page.evaluate(() => {
      const k = window.__kepler;
      const a = k.worldToScreen(0, 0);
      const b = k.worldToScreen(1000, 577);
      return { rot: k.state.project.building.rotation, view: k.state.view.rotation, lineDy: b.y - a.y };
    });
    assert.ok(Math.abs(s.rot - 30) < 0.5, `поворот дома ${s.rot}`);
    assert.ok(Math.abs(s.view + (30 * Math.PI) / 180) < 0.01, 'вид «Плана» идёт по осям дома');
    assert.ok(Math.abs(s.lineDy) < 1, 'линия участка на экране горизонтальна');
    assert.equal(await app.page.$eval('#alignBtn', (n) => n.classList.contains('active')), true);

    // Новая комната — прямая на экране «Плана» и параллельна линии участка.
    await dropOnCanvas(app.page, 'application/x-kepler-room', 'living');
    const edge = () => app.page.evaluate(() => {
      const k = window.__kepler;
      const r = k.state.project.rooms.at(-1);
      const a = k.planToScreen(r.x, r.y);
      const b = k.planToScreen(r.x + r.w, r.y);
      return (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
    });
    assert.ok(Math.abs(await edge()) < 0.01, 'в «Плане» стена горизонтальна');
    await app.page.click('#modeSiteBtn');
    assert.ok(Math.abs((await edge()) - s.rot) < 0.01, 'в «Участке» (север вверх) дом стоит под углом линии');
  });

  it('повторное «Выровнять» возвращает 0°, дом крутится на месте', async () => {
    const center = () => app.page.evaluate(() => {
      const { building: b, rooms } = window.__kepler.state.project;
      const r = rooms.at(-1);
      const cx = r.x + r.w / 2;
      const cy = r.y + r.h / 2;
      const t = (b.rotation * Math.PI) / 180;
      return { x: b.origin.x + cx * Math.cos(t) - cy * Math.sin(t), y: b.origin.y + cx * Math.sin(t) + cy * Math.cos(t) };
    });
    const before = await center();
    await app.page.click('#modePlanBtn');
    await app.page.click('#alignBtn');
    const after = await center();
    const s = await app.page.evaluate(() => [window.__kepler.state.project.building.rotation, window.__kepler.state.view.rotation]);
    assert.deepEqual(s, [0, 0]);
    assert.ok(Math.hypot(after.x - before.x, after.y - before.y) < 1, 'центр дома на участке не сдвинулся');
  });

  it('без ошибок в консоли', () => {
    assert.deepEqual(app.errors, []);
  });
});
