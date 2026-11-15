// e2e: «Полая масса» хранится отдельно от обычной массы, повторяет её
// команды и действительно вычитает объём из пола/дома в открытом 3D.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { openNew, startApp, worldToClient } from './helpers.mjs';

const projectMasses = (page) => page.evaluate(() => ({
  solids: window.__kepler.state.project.masses || [],
  voids: window.__kepler.state.project.massVoids || [],
  selection: window.__kepler.state.selection,
  tool: window.__kepler.state.tool,
}));

describe('Полая масса: полный пользовательский цикл', () => {
  let app;
  before(async () => {
    app = await startApp({ width: 1400, height: 860 });
    await openNew(app.page);
  });
  after(async () => { await app?.close(); });

  it('Shift+M включает вычитающий вариант, два клика сохраняют его отдельно', async () => {
    const { page } = app;
    await page.evaluate(async () => {
      const { createRoom } = await import('./core/model.js');
      const store = await import('./ui/store.js');
      const st = window.__kepler.state;
      st.project.rooms = [createRoom('living', -8000, -8000, 16000, 16000)];
      store.refreshDerived();
      (await import('./ui/view.js')).requestDraw();
    });
    await page.keyboard.press('Shift+M');
    let data = await projectMasses(page);
    assert.equal(data.tool?.kind, 'mass');
    assert.equal(data.tool?.void, true);
    assert.equal(await page.getAttribute('#massVoidToolBtn', 'aria-pressed'), 'true');

    const a = await worldToClient(page, -1200, -1200);
    const b = await worldToClient(page, 1200, 1200);
    await page.mouse.click(a.x, a.y);
    await page.mouse.click(b.x, b.y);
    await page.waitForFunction(() => window.__kepler.state.project.massVoids?.length === 1);

    data = await projectMasses(page);
    assert.equal(data.solids.length, 0, 'cutter не попал в project.masses');
    assert.equal(data.voids.length, 1);
    assert.match(data.voids[0].id, /^void-/);
    assert.deepEqual(data.selection, { type: 'mass', id: data.voids[0].id });
    assert.match(await page.textContent('#propsPanel'), /Полая масса/);
  });

  it('копирование, удаление и Undo работают как у обычной массы', async () => {
    const { page } = app;
    const first = (await projectMasses(page)).voids[0];
    await page.keyboard.press('Control+d');
    let data = await projectMasses(page);
    assert.equal(data.voids.length, 2);
    assert.ok(data.voids.every((m) => m.id.startsWith('void-')));
    assert.equal(data.solids.length, 0);
    assert.notEqual(data.selection.id, first.id, 'выбрана копия');

    await page.keyboard.press('Delete');
    data = await projectMasses(page);
    assert.equal(data.voids.length, 1);
    await page.keyboard.press('Control+z');
    await page.waitForFunction(() => window.__kepler.state.project.massVoids?.length === 2);
    assert.equal((await projectMasses(page)).voids.length, 2);
    await page.keyboard.press('Control+y');
    await page.waitForFunction(() => window.__kepler.state.project.massVoids?.length === 1);
    assert.equal((await projectMasses(page)).voids.length, 1);
  });

  it('в открытом 3D cutter вырезает пол, а соседняя точка остаётся', async () => {
    const { page } = app;
    await page.evaluate(async () => {
      const { createMass, createMassVoid } = await import('./core/masses.js');
      const { createRoom } = await import('./core/model.js');
      const store = await import('./ui/store.js');
      const st = window.__kepler.state;
      st.project.rooms = [createRoom('living', 0, 0, 6000, 6000)];
      st.project.items = [];
      st.project.openings = [];
      st.project.masses = [createMass({ x: 3000, y: 3000, w: 6000, d: 6000, z0: 0, h: 3000 })];
      st.project.massVoids = [createMassVoid({ x: 3000, y: 3000, w: 1800, d: 1800, z0: 0, h: 3500 })];
      st.selection = null;
      st.tool = null;
      store.refreshDerived();
      (await import('./ui/view.js')).requestDraw();
    });
    await page.click('#view3dBtn');
    await page.waitForFunction(async () => (await import('./ui/view3d.js')).debug3d().active);
    const covered = await page.evaluate(async () => {
      const v3 = await import('./ui/view3d.js');
      return { cut: v3.debug3dCovered(3000, 3000), kept: v3.debug3dCovered(500, 500) };
    });
    assert.deepEqual(covered.cut.floor, [], 'пол в центре cutter удалён из реальной 3D-сцены');
    assert.ok(covered.kept.floor.includes('L1'), 'пол рядом с cutter сохранён');

    const boolean = await page.evaluate(async () => {
      const { buildHouseMesh } = await import('./core/mesh3d.js');
      const faces = buildHouseMesh(window.__kepler.state.project, { masses: true });
      const at = (f, x, y, z) => {
        if (Math.abs(f.normal?.z || 0) < 0.5 || Math.abs(f.pts?.[0]?.z - z) > 1) return false;
        const xs = f.pts.map((p) => p.x); const ys = f.pts.map((p) => p.y);
        return x > Math.min(...xs) && x < Math.max(...xs) && y > Math.min(...ys) && y < Math.max(...ys);
      };
      return {
        massFaces: faces.filter((f) => f.kind === 'mass').length,
        massTopAtCut: faces.some((f) => f.kind === 'mass' && at(f, 3000, 3000, 3000)),
      };
    });
    assert.ok(boolean.massFaces > 6, 'у вырезанной массы появились внутренние торцы');
    assert.equal(boolean.massTopAtCut, false, 'верх обычной массы над пустотой удалён');
  });

  it('ручка размера void перестраивает вырез прямо во время жеста и отменяется одним Undo', async () => {
    const { page } = app;
    const cutter = (await projectMasses(page)).voids[0];
    const selectAt = await page.evaluate(async (m) => (await import('./ui/view3d.js')).debug3dScreen({
      x: m.x, y: m.y, z: m.z0 + m.h,
    }), cutter);
    await page.mouse.click(selectAt.x, selectAt.y);
    await page.waitForFunction((id) => window.__kepler.state.selection?.id === id, cutter.id);
    const grip = (await page.evaluate(() => window.__kepler.debug3d())).mass.handles.py;
    assert.ok(grip, 'у выбранного cutter есть та же ручка грани, что у массы');
    const target = await page.evaluate(async (m) => (await import('./ui/view3d.js')).debug3dScreen({
      x: m.x, y: 5000, z: m.z0 + m.h / 2,
    }), cutter);
    const before = await page.evaluate(async () => (await import('./ui/view3d.js')).debug3dCovered(3000, 4500));
    assert.ok(before.floor.includes('L1'));
    assert.equal(await page.evaluate(async (p) => (await import('./ui/mass3d.js')).massPartAt({
      clientX: p.x, clientY: p.y, pointerType: 'mouse',
    })?.part || null, grip), 'py');

    await page.mouse.move(grip.x, grip.y);
    await page.mouse.down();
    await page.mouse.move(target.x, target.y, { steps: 8 });
    await page.waitForFunction((d) => window.__kepler.state.project.massVoids[0].d > d, cutter.d);
    const during = await page.evaluate(async () => (await import('./ui/view3d.js')).debug3dCovered(3000, 4500));
    assert.deepEqual(during.floor, [], 'границы пола перестроены до отпускания мыши');
    await page.mouse.up();
    assert.ok((await projectMasses(page)).voids[0].d > cutter.d);

    await page.keyboard.press('Control+z');
    await page.waitForFunction((d) => window.__kepler.state.project.massVoids[0].d === d, cutter.d);
    const undone = await page.evaluate(async () => (await import('./ui/view3d.js')).debug3dCovered(3000, 4500));
    assert.ok(undone.floor.includes('L1'), 'Undo вернул геометрию одним шагом');
  });

  it('cutter скрыт без наведения, при hover подсвечивается и выбирается', async () => {
    const { page } = app;
    const cutter = await page.evaluate(async () => {
      const { createMass } = await import('./core/masses.js');
      const store = await import('./ui/store.js');
      const st = window.__kepler.state;
      st.project.rooms = [];
      const cutter = st.project.massVoids[0];
      st.project.masses = [createMass({
        x: cutter.x, y: cutter.y, w: cutter.w + 3000, d: cutter.d + 3000,
        z0: cutter.z0, h: cutter.h,
      })];
      st.selection = null;
      st.tool = null;
      store.refreshDerived();
      (await import('./ui/view3d.js')).refresh3d();
      return cutter;
    });
    await page.mouse.move(5, 5);
    await page.waitForFunction(async () => (await import('./ui/view3d.js')).debug3d().massVoidHoverId == null);
    assert.equal((await page.evaluate(() => window.__kepler.debug3d())).massVoidOverlayFaces, 0, 'без hover cutter полностью скрыт');
    const point = { x: cutter.x, y: cutter.y, z: cutter.z0 + cutter.h };
    const screen = await page.evaluate(async (p) => (await import('./ui/view3d.js')).debug3dScreen(p), point);
    const picked = await page.evaluate(async (p) => (await import('./ui/view3d.js')).debug3dPick(p.x, p.y), screen);
    assert.deepEqual(picked && { type: picked.type, id: picked.id }, { type: 'mass', id: cutter.id });
    await page.mouse.move(screen.x, screen.y);
    await page.waitForFunction((id) => window.__kepler.debug3d().massVoidHoverId === id, cutter.id);
    assert.ok((await page.evaluate(() => window.__kepler.debug3d())).massVoidOverlayFaces >= 12, 'hover показывает оранжевую подсветку');
    await page.mouse.down();
    await page.mouse.move(screen.x + 160, screen.y + 90, { steps: 3 });
    await page.mouse.up();
    await page.waitForFunction(() => window.__kepler.debug3d().massVoidHoverId == null);
    assert.equal((await page.evaluate(() => window.__kepler.debug3d())).massVoidOverlayFaces, 0, 'после вращения камеры старый hover не остаётся');
    await page.mouse.move(5, 5);
    await page.waitForFunction(() => window.__kepler.debug3d().massVoidHoverId == null);
    assert.equal((await page.evaluate(() => window.__kepler.debug3d())).massVoidOverlayFaces, 0, 'после ухода курсора cutter снова скрыт');
    const rotatedScreen = await page.evaluate(async (p) => (await import('./ui/view3d.js')).debug3dScreen(p), point);
    await page.mouse.move(rotatedScreen.x, rotatedScreen.y);
    await page.mouse.click(rotatedScreen.x, rotatedScreen.y);
    await page.waitForFunction((id) => window.__kepler.state.selection?.id === id, cutter.id);
    const state3d = await page.evaluate(() => window.__kepler.debug3d());
    assert.equal(state3d.massVoids, 1);
    assert.ok(state3d.massVoidOverlayFaces >= 12, 'выбранный cutter остаётся видимым для правки');
    assert.equal(state3d.mass.gizmo != null, true, 'у void доступен тот же 3D-гизмо');
    assert.match(await page.textContent('#propsPanel'), /Полая масса/);
  });

  it('правка вне целевой геометрии удаляет cutter одним шагом Undo', async () => {
    const { page } = app;
    const cutter = (await projectMasses(page)).voids[0];
    assert.ok(cutter, 'после выбора остался валидный cutter');
    await page.locator('#massZ0').evaluate((input) => {
      input.value = '10000';
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.waitForFunction(() => (window.__kepler.state.project.massVoids || []).length === 0);
    assert.equal((await projectMasses(page)).selection, null, 'удалённый невидимый объект не остаётся выбранным');

    await page.keyboard.press('Control+z');
    await page.waitForFunction((id) => window.__kepler.state.project.massVoids?.some((m) => m.id === id), cutter.id);
    const restored = (await projectMasses(page)).voids.find((m) => m.id === cutter.id);
    assert.equal(restored.z0, cutter.z0, 'Undo целиком возвращает cutter до невалидной правки');
  });

  it('удаление последней комнаты-цели убирает cutter, Undo возвращает оба', async () => {
    const { page } = app;
    const ids = await page.evaluate(async () => {
      const { createMassVoid } = await import('./core/masses.js');
      const { createProject, createRoom } = await import('./core/model.js');
      const store = await import('./ui/store.js');
      const st = window.__kepler.state;
      const project = createProject('orphan cleanup');
      const room = createRoom('living', 0, 0, 6000, 6000);
      const cutter = createMassVoid({ x: 3000, y: 3000, w: 1200, d: 1200, z0: 0, h: 1000 });
      project.rooms = [room];
      project.massVoids = [cutter];
      st.project = project;
      st.selection = { type: 'room', id: room.id };
      store.clearHistory();
      store.refreshDerived();
      store.afterChange();
      return { room: room.id, cutter: cutter.id };
    });

    await page.evaluate(async () => (await import('./ui/plan-actions.js')).deleteSelection());
    await page.waitForFunction(() => window.__kepler.state.project.rooms.length === 0
      && (window.__kepler.state.project.massVoids || []).length === 0);

    await page.keyboard.press('Control+z');
    await page.waitForFunction(({ room, cutter }) => window.__kepler.state.project.rooms.some((r) => r.id === room)
      && window.__kepler.state.project.massVoids?.some((m) => m.id === cutter), ids);
  });

  it('завершает сценарий без ошибок консоли', () => assert.deepEqual(app.errors, []));
});
