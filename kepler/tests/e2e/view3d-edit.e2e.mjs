// e2e правки стен в 3D (этап E): клик выбирает стену (подсветка, тот же
// выбор на плане), перетаскивание верхней грани меняет высоту одной записью
// истории, Ctrl+Z возвращает. Оба движка стен: v2 (по умолчанию) и v1.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, openSample } from './helpers.mjs';

const d3 = (page) => page.evaluate(() => window.__kepler.debug3d());

// Стена активного этажа, чей верх виден в центре своего куска.
const visibleWallTop = (page) => page.evaluate(() => {
  const { state, screen3d, pick3d } = window.__kepler;
  const level = state.project.levels.find((l) => l.id === state.project.activeLevel);
  const box = document.getElementById('canvas3d').getBoundingClientRect();
  for (const w of state.walls) {
    if (!['own', 'shared'].includes(w.kind) || w.hidden) continue;
    const rects = w.rects || [w.band];
    const r = rects.reduce((a, b) => (b.w * b.h > a.w * a.h ? b : a));
    const s = screen3d({ x: r.x + r.w / 2, y: r.y + r.h / 2, z: level.elevation + level.height });
    if (s.x < box.left + 20 || s.x > box.right - 20 || s.y < box.top + 60 || s.y > box.bottom - 120) continue;
    const hit = pick3d(s.x, s.y);
    if (hit?.key === w.key && hit.face === 'top') return { key: w.key, x: s.x, y: s.y, levelH: level.height };
  }
  return null;
});

const ownHeight = (page, key) => page.evaluate((k) => window.__kepler.state.project.wallOverrides[k]?.top?.height ?? null, key);

for (const engine of ['v2', 'v1']) {
  describe(`3D: выбор и правка стены (${engine})`, () => {
    let app;
    let wall;
    before(async () => {
      app = await startApp({ query: `walls=${engine}` });
      await openSample(app.page);
      await app.page.click('#view3dBtn');
      wall = await visibleWallTop(app.page);
    });
    after(async () => { await app?.close(); });

    it('клик по стене выбирает её и подсвечивает', async () => {
      const { page } = app;
      assert.ok(wall, 'нашлась стена с видимым верхом');
      assert.equal(await page.isVisible('#v3Hint'), true);
      await page.mouse.click(wall.x, wall.y);
      const s = await d3(page);
      assert.equal(s.selectedKey, wall.key);
      assert.ok(s.highlighted > 0, 'грани выбранной стены подсвечены');
      assert.match(await page.textContent('#v3Hint'), /высота/);
      assert.equal(await page.evaluate(() => window.__kepler.state.selection?.type), 'wall');
    });

    it('тянуть верхнюю грань вверх — высота стены растёт', async () => {
      const { page } = app;
      assert.equal(await ownHeight(page, wall.key), null);
      await page.mouse.move(wall.x, wall.y);
      await page.mouse.down();
      await page.mouse.move(wall.x, wall.y - 40, { steps: 4 });
      assert.equal((await d3(page)).editing, true, 'идёт правка, а не вращение');
      await page.mouse.move(wall.x, wall.y - 80, { steps: 4 });
      await page.mouse.up();
      const h = await ownHeight(page, wall.key);
      assert.ok(h > wall.levelH, `высота ${h}`);
      assert.equal(h % 50, 0, 'привязка к шагу сетки');
      assert.equal((await d3(page)).editing, false);
      assert.equal((await d3(page)).selectedKey, wall.key, 'выбор сохранён');
    });

    it('после закрытия 3D на плане выбрана та же стена; Ctrl+Z возвращает высоту', async () => {
      const { page } = app;
      // Esc при выборе только снимает его — закрываем кнопкой, выбор остаётся.
      await page.click('#v3Close');
      assert.equal(await page.isVisible('#view3d'), false);
      const sel = await page.evaluate(() => window.__kepler.state.selection);
      assert.equal(sel?.type, 'wall');
      assert.equal(sel.key, wall.key);
      await page.keyboard.press('Control+z');
      assert.equal(await ownHeight(page, wall.key), null);
      await page.keyboard.press('Control+y');
      assert.ok((await ownHeight(page, wall.key)) > wall.levelH, 'повтор');
      await page.keyboard.press('Control+z');
    });

    it('3D после отмены: вращение работает, клик в пустоту снимает выбор', async () => {
      const { page } = app;
      await page.click('#view3dBtn');
      // Отмена снимает выбор (как на плане) — выбираем снова.
      await page.mouse.click(wall.x, wall.y);
      const box = await (await page.$('#canvas3d')).boundingBox();
      const before0 = await d3(page);
      await page.mouse.move(box.x + 30, box.y + box.height - 140);
      await page.mouse.down();
      await page.mouse.move(box.x + 150, box.y + box.height - 100, { steps: 6 });
      await page.mouse.up();
      const after0 = await d3(page);
      assert.ok(Math.abs(after0.cam.yaw - before0.cam.yaw) > 0.5, 'вращение');
      assert.equal(after0.selectedKey, wall.key, 'вращение не меняет выбор');
      // Пустота: левый верхний угол неба.
      const empty = await page.evaluate(([x, y]) => window.__kepler.pick3d(x, y), [box.x + 8, box.y + 70]);
      assert.equal(empty, null);
      await page.mouse.click(box.x + 8, box.y + 70);
      assert.equal((await d3(page)).selectedKey, null);
      await page.keyboard.press('Escape');
    });

    it('без ошибок в консоли', () => {
      assert.deepEqual(app.errors, []);
    });
  });
}
