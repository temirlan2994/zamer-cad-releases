// Временный вид интерьера должен открывать настоящее редактирование этажа и
// возвращать внешнюю камеру, даже когда обычный вид скрывает мебель.
import assert from 'node:assert/strict';
import { it } from 'node:test';
import { openSample, settleView, startApp, with3dLayers } from './helpers.mjs';

const scene = (page) => page.evaluate(() => window.__kepler.debug3d());

async function openTwoStoreys(page) {
  await page.getByRole('button', { name: /Двухэтажный · 4 спальни/ }).click();
  await page.locator('#view3dBtn').click();
}

async function enter(page, mobile = false) {
  const views = page.locator('.v3-views summary');
  const button = page.getByRole('button', { name: 'Интерьер этажа' });
  if (mobile) { await views.tap(); await button.tap(); }
  else { await views.click(); await button.click(); }
  await settleView(page);
}

// Точка видимой грани, доступная для клика с этой камеры.
async function objectPoint(page, type) {
  return page.evaluate((wanted) => {
    const rect = document.getElementById('canvas3d').getBoundingClientRect();
    for (let y = rect.top + rect.height * 0.4; y < rect.top + rect.height * 0.7; y += 10) {
      for (let x = rect.left + rect.width * 0.35; x < rect.left + rect.width * 0.7; x += 10) {
        const hit = window.__kepler.pick3d(x, y);
        if (hit?.type === wanted) return { x, y, id: hit.id };
      }
    }
    return null;
  }, type);
}

it('интерьер показывает активный этаж, позволяет изменить комнату другого этажа и восстанавливает прежний вид', async () => {
  const app = await startApp();
  try {
    const { page } = app;
    await openTwoStoreys(page);
    await with3dLayers(page, () => page.uncheck('#v3Furniture'));
    await page.getByRole('button', { name: 'Перспектива' }).click();
    const previous = await scene(page);
    const preferences = () => page.evaluate(() => localStorage.getItem('kepler-3d-layers'));
    const stored = await preferences();
    const levels = previous.levelsShown;
    assert.equal(levels.length, 2);

    await enter(page);
    const first = await scene(page);
    assert.equal(first.roof, false);
    assert.deepEqual(first.levelsShown, [levels[0]]);
    assert.equal(await page.locator('#v3Furniture').isChecked(), true);
    assert.equal(await page.locator('#v3Scope').innerText(), 'Интерьер · 1 этаж');
    const floor = page.getByRole('combobox', { name: 'Этаж интерьера' });
    await floor.selectOption(levels[1]);
    const second = await scene(page);
    assert.deepEqual(second.levelsShown, [levels[1]]);
    assert.ok(second.cam.target.z > first.cam.target.z + 2000);
    const pt = await objectPoint(page, 'room');
    assert.ok(pt);
    await page.mouse.click(pt.x, pt.y);
    await page.locator('#roomName').fill('Новая спальня');
    await page.locator('#roomName').blur();
    const editedName = () => page.evaluate((id) => window.__kepler.state.project.rooms.find((r) => r.id === id).name, pt.id);
    await page.keyboard.press('Control+z');
    assert.notEqual(await editedName(), 'Новая спальня');
    await page.keyboard.press('Control+y');
    assert.equal(await editedName(), 'Новая спальня');
    assert.equal((await scene(page)).levels, 'only');
    await page.getByRole('button', { name: 'Вернуть вид' }).click();
    assert.deepEqual((await scene(page)).cam, previous.cam);
    assert.deepEqual((await scene(page)).levelsShown, levels);
    assert.equal((await scene(page)).roof, previous.roof);
    assert.equal(await page.locator('#v3Furniture').isChecked(), false);
    assert.equal(await preferences(), stored);
    const result = await page.evaluate(({ id, levelId }) => {
      const p = window.__kepler.state.project;
      return [p.activeLevel, p.levels.find((l) => l.id === levelId).rooms.find((r) => r.id === id).name];
    }, { id: pt.id, levelId: levels[1] });
    assert.deepEqual(result, [levels[0], 'Новая спальня']);
    assert.deepEqual(app.errors, []);
  } finally { await app.close(); }
});

it('касание выбирает комнату, закрытие 3D из интерьера сохраняет внешний ракурс и слои', async () => {
  const app = await startApp({ mobile: true });
  try {
    const { page } = app;
    await openTwoStoreys(page);
    const previous = await scene(page);
    await enter(page, true);
    const secondFloor = previous.levelsShown[1];
    await page.getByRole('combobox', { name: 'Этаж интерьера' }).selectOption(secondFloor);
    const interiorCamera = (await scene(page)).cam;
    const pt = await objectPoint(page, 'room');
    assert.ok(pt);
    await page.touchscreen.tap(pt.x, pt.y);
    assert.equal(await page.evaluate(() => window.__kepler.state.selection?.id), pt.id);
    await page.getByRole('button', { name: 'Закрыть 3D-вид' }).tap();
    const shot = await page.evaluate(async () => (await import('./ui/view3d.js')).camera3dSnapshot({ capturedOnly: true }));
    assert.equal(shot.levelId, secondFloor);
    assert.equal(shot.levels, 'only');
    assert.equal(shot.roof, false);
    assert.deepEqual(shot.target, interiorCamera.target);
    await page.locator('#view3dBtn').tap();
    assert.equal(await page.locator('#v3InteriorControls').isVisible(), false);
    assert.deepEqual((await scene(page)).cam, previous.cam);
    assert.equal((await scene(page)).roof, true);
    assert.deepEqual(app.errors, []);
  } finally { await app.close(); }
});


it('в интерьере можно выбрать мебель, даже если в обычном виде её слой скрыт', async () => {
  const app = await startApp();
  try {
    const { page } = app;
    await openSample(page);
    await page.locator('#view3dBtn').click();
    await with3dLayers(page, () => page.uncheck('#v3Furniture'));
    assert.equal((await scene(page)).furniture, 0);
    await enter(page);
    assert.ok((await scene(page)).furniture > 0);
    const pt = await objectPoint(page, 'item');
    assert.ok(pt);
    await page.mouse.click(pt.x, pt.y);
    assert.equal(await page.evaluate(() => window.__kepler.state.selection?.id), pt.id);
    if (process.env.KEPLER_INTERIOR_OUT) await page.screenshot({ path: process.env.KEPLER_INTERIOR_OUT });
    await page.getByRole('button', { name: 'Вернуть вид' }).click();
    assert.equal((await scene(page)).furniture, 0);
    assert.equal(await page.evaluate(() => window.__kepler.state.selection), null);
  } finally { await app.close(); }
});
