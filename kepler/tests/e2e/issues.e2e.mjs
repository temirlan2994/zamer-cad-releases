// e2e кнопки замечаний «⚠ N» (ui/issues.js): число, панель по группам,
// переход к объекту, закрытие, живое обновление, телефон.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, openSample } from './helpers.mjs';

const issuesState = (page) => page.evaluate(() => {
  const s = window.__kepler.state.issues;
  return { count: s.count, ids: s.groups.flatMap((g) => g.items.map((i) => i.id)), groups: s.groups.map((g) => g.title) };
});
const domIds = (page) => page.$$eval('#issuesPanel [data-issue-id]', (ns) => ns.map((n) => n.dataset.issueId));

// Пример + гарантированное замечание с целью: самую большую комнату сужаем
// до 2 м в свойствах (площадь ниже нормы), выбор снимаем.
async function openWithIssue(page) {
  await openSample(page);
  await page.evaluate(() => {
    const k = window.__kepler;
    const room = [...k.state.project.rooms].sort((a, b) => b.w * b.h - a.w * a.h)[0];
    k.selectRoom(room.id);
    const input = document.getElementById('roomW');
    input.value = '2000';
    input.dispatchEvent(new Event('change', { bubbles: true }));
    k.select(null);
  });
  await page.waitForFunction(() => window.__kepler.state.issues.groups.some((g) => g.items.some((i) => i.severity === 'warn' && i.target?.type === 'room')));
}

// Первое предупреждение с целью-комнатой или предметом.
const firstTarget = (page) => page.evaluate(() => {
  const items = window.__kepler.state.issues.groups.flatMap((g) => g.items);
  return items.find((i) => i.severity === 'warn' && i.target && ['room', 'item'].includes(i.target.type)) || null;
});

describe('замечания: кнопка «⚠» и панель', () => {
  let app;
  before(async () => { app = await startApp(); await openWithIssue(app.page); });
  after(async () => { await app?.close(); });

  it('кнопка с числом замечаний; старых плашек и блоков норм нет', async () => {
    const s = await issuesState(app.page);
    assert.ok(s.count > 0, 'в примере есть замечания');
    assert.equal(await app.page.isVisible('#issuesBtn'), true);
    assert.equal((await app.page.textContent('#issuesCount')).trim(), String(s.count));
    assert.match(await app.page.getAttribute('#issuesBtn', 'class'), /\bwarn\b/);
    assert.equal(await app.page.$('#gapBar'), null);
    assert.equal(await app.page.$('#connectivityBar'), null);
    assert.equal(await app.page.$$eval('#propsPanel .norms, #propsPanel .norm-list', (ns) => ns.length), 0);
    assert.doesNotMatch(await app.page.textContent('#propsPanel'), /Площади, свет, высота|Инсоляция — /);
    assert.match(await app.page.textContent('#propsPanel'), /ТЭП/, 'ТЭП остаётся в свойствах');
  });

  it('панель: группы и все замечания из расчёта', async () => {
    assert.equal(await app.page.isVisible('#issuesPanel'), false);
    await app.page.click('#issuesBtn');
    assert.equal(await app.page.isVisible('#issuesPanel'), true);
    assert.equal(await app.page.getAttribute('#issuesBtn', 'aria-expanded'), 'true');
    const s = await issuesState(app.page);
    assert.deepEqual(await domIds(app.page), s.ids);
    const titles = await app.page.$$eval('#issuesPanel .issue-group h4', (ns) => ns.map((n) => n.textContent));
    assert.equal(titles.length, s.groups.length);
    for (const [i, g] of s.groups.entries()) assert.ok(titles[i].startsWith(g), `${titles[i]} / ${g}`);
    assert.equal(await app.page.$$eval('#issuesPanel .issue.warn', (ns) => ns.length) >= s.count, true);
  });

  it('клик по замечанию выбирает объект, показывает его на холсте и подсвечивает', async () => {
    const entry = await firstTarget(app.page);
    assert.ok(entry, 'есть замечание с комнатой или предметом');
    await app.page.evaluate(() => { const v = window.__kepler.state.view; v.panX += 3000; v.panY -= 2000; });
    await app.page.click(`#issuesPanel [data-issue-id="${entry.id}"] [data-goto]`);
    const got = await app.page.evaluate(() => ({ sel: window.__kepler.state.selection, flash: window.__kepler.state.flash }));
    assert.equal(got.sel?.type, entry.target.type);
    assert.equal(got.sel?.id, entry.target.id);
    assert.ok(got.flash?.rects?.length, 'подсветка места');
    // Центр объекта — на видимой части холста правее открытой панели.
    const pos = await app.page.evaluate((f) => {
      const c = document.getElementById('canvas').getBoundingClientRect();
      const p = document.getElementById('issuesPanel').getBoundingClientRect();
      const s = window.__kepler.planToScreen(f.x + f.w / 2, f.y + f.h / 2);
      return { x: s.x + c.left, y: s.y + c.top, c: { l: c.left, r: c.right, t: c.top, b: c.bottom }, panelRight: p.right };
    }, entry.focus);
    assert.ok(pos.x > pos.panelRight && pos.x < pos.c.r, `x ${pos.x} вне ${pos.panelRight}…${pos.c.r}`);
    assert.ok(pos.y > pos.c.t && pos.y < pos.c.b, `y ${pos.y}`);
    assert.equal(await app.page.isVisible('#issuesPanel'), true);
    assert.match(await app.page.getAttribute(`#issuesPanel [data-issue-id="${entry.id}"]`, 'class'), /selected/);
    assert.equal(await app.page.evaluate(() => window.__kepler.state.modeName), 'plan');
  });

  it('список обновляется при правке; клик вне и Esc закрывают', async () => {
    const entry = await firstTarget(app.page);
    if (entry.target.type === 'room') await app.page.evaluate((id) => window.__kepler.selectRoom(id), entry.target.id);
    const before = await issuesState(app.page);
    await app.page.locator('#canvas').focus().catch(() => {});
    await app.page.keyboard.press('Delete');
    await app.page.waitForFunction((ids) => JSON.stringify(window.__kepler.state.issues.groups.flatMap((g) => g.items.map((i) => i.id))) !== JSON.stringify(ids), before.ids);
    const after = await issuesState(app.page);
    assert.deepEqual(await domIds(app.page), after.ids, 'панель следует за расчётом');
    assert.equal((await app.page.textContent('#issuesCount')).trim(), String(after.count));
    assert.equal(await app.page.isVisible('#issuesCount'), after.count > 0);
    assert.equal(await app.page.isVisible('#issuesPanel'), true, 'правка не закрывает панель');
    await app.page.keyboard.press('Control+z');
    await app.page.click('.brand'); // клик вне
    assert.equal(await app.page.isVisible('#issuesPanel'), false);
    await app.page.click('#issuesBtn');
    assert.equal(await app.page.isVisible('#issuesPanel'), true);
    await app.page.keyboard.press('Escape');
    assert.equal(await app.page.isVisible('#issuesPanel'), false);
    assert.equal(await app.page.getAttribute('#issuesBtn', 'aria-expanded'), 'false');
  });

  it('без ошибок в консоли', () => { assert.deepEqual(app.errors, []); });
});

describe('замечания на телефоне', () => {
  let app;
  before(async () => { app = await startApp({ mobile: true }); await openWithIssue(app.page); });
  after(async () => { await app?.close(); });

  it('кнопка видна; панель — нижний лист над панелью кнопок; переход закрывает лист', async () => {
    const vp = app.page.viewportSize();
    const btn = await app.page.locator('#issuesBtn').boundingBox();
    assert.ok(btn && btn.x >= 0 && btn.y >= 0 && btn.x + btn.width <= vp.width && btn.y + btn.height <= vp.height, 'кнопка в экране');
    await app.page.locator('#issuesBtn').tap();
    assert.equal(await app.page.isVisible('#issuesPanel'), true);
    const sheet = await app.page.locator('#issuesPanel').boundingBox();
    const bar = await app.page.locator('#mobileBar').boundingBox();
    assert.ok(Math.abs(sheet.x) < 1 && Math.abs(sheet.width - vp.width) < 2, 'во всю ширину');
    assert.ok(sheet.y + sheet.height <= bar.y + 1, 'над панелью кнопок');
    const entry = await firstTarget(app.page);
    await app.page.locator(`#issuesPanel [data-issue-id="${entry.id}"] [data-goto]`).tap();
    const sel = await app.page.evaluate(() => window.__kepler.state.selection);
    assert.equal(sel?.type, entry.target.type);
    assert.equal(sel?.id, entry.target.id);
    assert.equal(await app.page.isVisible('#issuesPanel'), false, 'лист закрылся — объект виден');
  });

  it('без ошибок в консоли', () => { assert.deepEqual(app.errors, []); });
});
