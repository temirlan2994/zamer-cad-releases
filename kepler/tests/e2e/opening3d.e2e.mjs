// e2e: двери/окна прямо в 3D — вставка по фасаду, межэтажная
// привязка размеров и линий, Shift без привязки, ручки и Undo.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { clickToolbarTool, openNew, startApp } from './helpers.mjs';

const d3 = (page) => page.evaluate(() => window.__kepler.debug3d());
const upperOpenings = (page) => page.evaluate(() => {
  const s = window.__kepler.state;
  return structuredClone(s.project.levels.find((l) => l.id === 'L2')?.openings || []);
});

// Ищем реально видимый пиксель боковой грани нужной стены. Это устойчивее
// фиксированных координат: frameHouse меняет камеру вместе с размером дома.
async function wallPoint(page, targetX = 2200) {
  return page.evaluate(async (along) => {
    const { levelProject } = await import('./core/model.js');
    const { deriveWalls } = await import('./core/walls.js');
    const box = document.getElementById('canvas3d').getBoundingClientRect();
    const walls = deriveWalls(levelProject(window.__kepler.state.project, 'L2'));
    const north = walls.find((w) => w.orient === 'h' && Math.abs(w.edge) < 1);
    const cross = north.band.y + north.band.h / 2;
    const target = window.__kepler.screen3d({ x: along, y: cross, z: 4200 });
    let best = null;
    for (let y = box.top + 25; y < box.bottom - 25; y += 5) {
      for (let x = box.left + 25; x < box.right - 25; x += 5) {
        const hit = window.__kepler.pick3d(x, y);
        if (hit?.type !== 'wall' || hit.levelId !== 'L2' || hit.face !== 'side' || hit.key !== north?.key) continue;
        const score = Math.hypot(x - target.x, y - target.y);
        if (!best || score < best.score) best = { x, y, score, key: hit.key };
      }
    }
    return best;
  }, targetX);
}

async function setupTwoFloors(page) {
  await page.evaluate(async () => {
    const { createLevel, createOpening, createRoom } = await import('./core/model.js');
    const store = await import('./ui/store.js');
    const s = window.__kepler.state;
    const l1 = s.project.levels[0];
    const r1 = createRoom('living', 0, 0, 6000, 4000);
    l1.rooms = [r1];
    l1.items = [];
    const lower = createOpening('window', r1.id, 0, 2200, 1600);
    lower.height = 1400;
    lower.sill = 850;
    l1.openings = [lower];

    const l2 = createLevel('2 этаж', 3000, 3000, 'L2');
    l2.rooms = [createRoom('bedroom', 0, 0, 6000, 4000)];
    s.project.levels.push(l2);
    s.project.activeLevel = l2.id;
    store.refreshDerived();
    store.afterChange();
  });
}

describe('3D: создание окон и дверей, межэтажная привязка', () => {
  let app;
  let facade;

  before(async () => {
    app = await startApp({ width: 1440, height: 860 });
    await openNew(app.page);
    await setupTwoFloors(app.page);
    await app.page.click('#view3dBtn');
    // Окна в этом доме стоят на северном фасаде. С исходной южной
    // изометрии кровля заслоняет их, поэтому разворачиваем модель.
    const canvas = await app.page.locator('#canvas3d').boundingBox();
    const yaw = (await d3(app.page)).cam.yaw;
    const dx = ((yaw - Math.PI / 2 + 2 * Math.PI) % (2 * Math.PI)) / 0.008;
    await app.page.mouse.move(canvas.x + 50, canvas.y + 110);
    await app.page.mouse.down();
    await app.page.mouse.move(canvas.x + 50 + dx, canvas.y + 110, { steps: 10 });
    await app.page.mouse.up();
    facade = await wallPoint(app.page);
    assert.ok(facade, 'видна боковая грань северной стены второго этажа');
  });
  after(async () => { await app?.close(); });

  it('клик по стене создаёт окно и копирует размеры окна нижнего этажа', async () => {
    const { page } = app;
    await clickToolbarTool(page, 'windowToolBtn');
    await page.mouse.move(facade.x, facade.y, { steps: 5 });
    const ghost = (await d3(page)).openingTool;
    assert.equal(ghost.on, true);
    assert.equal(ghost.valid, true);
    assert.equal(ghost.snap?.levelId, 'L1');
    assert.ok(ghost.guides > 0, 'в 3D показаны линии окна нижнего этажа');
    assert.deepEqual(
      [ghost.opening.width, ghost.opening.height, ghost.opening.sill],
      [1600, 1400, 850],
    );
    assert.equal(await page.evaluate(() => window.__kepler.state.tool.presetWall), null, '3D-наведение не закрепляет стену для плана');
    await page.mouse.click(facade.x, facade.y);
    const list = await upperOpenings(page);
    assert.equal(list.length, 1);
    assert.deepEqual([list[0].width, list[0].height, list[0].sill], [1600, 1400, 850]);
  });

  it('Ctrl+Z отменяет вставку одним шагом, Shift создаёт обычное окно без привязки', async () => {
    const { page } = app;
    await page.keyboard.press('Control+z');
    assert.equal((await upperOpenings(page)).length, 0);

    await page.keyboard.down('Shift');
    await page.mouse.move(facade.x, facade.y, { steps: 5 });
    const ghost = (await d3(page)).openingTool;
    assert.equal(ghost.valid, true);
    assert.equal(ghost.snap, null);
    assert.deepEqual(
      [ghost.opening.width, ghost.opening.height, ghost.opening.sill],
      [1200, 1500, 900],
    );
    await page.mouse.click(facade.x, facade.y);
    await page.keyboard.up('Shift');
    const list = await upperOpenings(page);
    assert.equal(list.length, 1);
    assert.deepEqual([list[0].width, list[0].height, list[0].sill], [1200, 1500, 900]);
  });

  it('боковая 3D-ручка липнет к краю нижнего окна; Undo возвращает ширину', async () => {
    const { page } = app;
    await page.keyboard.press('Escape'); // выйти из серии вставки
    await page.evaluate(async () => {
      const { selectObject } = await import('./ui/tools.js');
      const opening = window.__kepler.state.project.openings[0];
      selectObject({ type: 'opening', id: opening.id });
    });
    await page.waitForTimeout(80); // панель свойств меняет ширину 3D-холста
    const info = await page.evaluate(async () => {
      const { deriveWalls, openingRect } = await import('./core/walls.js');
      const s = window.__kepler.state;
      const opening = s.project.openings[0];
      const walls = deriveWalls(s.project);
      const placed = openingRect(s.project, opening, walls);
      const cross = placed.wall.band.y + placed.wall.band.h / 2;
      const z = 3000 + opening.sill + opening.height / 2;
      return {
        from: window.__kepler.screen3d({ x: placed.absCenter - opening.width / 2, y: cross, z }),
        sweep: Array.from({ length: 25 }, (_, i) => window.__kepler.screen3d({ x: 1600 - i * 25, y: cross, z })),
        id: opening.id,
      };
    });
    const handle = await page.evaluate(async (p) => {
      const m = await import('./ui/opening3d.js');
      return m.openingHandleAt({ clientX: p.x, clientY: p.y, pointerType: 'mouse' })?.id || null;
    }, info.from);
    assert.equal(handle, 'from');
    await page.mouse.move(info.from.x, info.from.y);
    await page.mouse.down();
    let snapped = false;
    for (const p of info.sweep) {
      await page.mouse.move(p.x, p.y);
      if (/левый край окна/.test((await d3(page)).label || '')) { snapped = true; break; }
    }
    assert.equal(snapped, true, 'ручка встретила линию нижнего окна');
    await page.mouse.up();
    let opening = (await upperOpenings(page)).find((o) => o.id === info.id);
    const alignedFrom = await page.evaluate(async (id) => {
      const { deriveWalls, openingRect } = await import('./core/walls.js');
      const s = window.__kepler.state;
      return openingRect(s.project, s.project.openings.find((o) => o.id === id), deriveWalls(s.project)).absCenter
        - s.project.openings.find((o) => o.id === id).width / 2;
    }, info.id);
    assert.equal(Math.round(alignedFrom), 1400, 'край верхнего окна стоит на линии нижнего');
    assert.notEqual(opening.width, 1200);
    await page.keyboard.press('Control+z');
    opening = (await upperOpenings(page)).find((o) => o.id === info.id);
    assert.equal(opening.width, 1200);
  });

  it('дверь создаётся на стене прямо в 3D, Пробел меняет сторону петель', async () => {
    const { page } = app;
    await clickToolbarTool(page, 'doorToolBtn');
    const doorFacade = await wallPoint(page, 4400);
    assert.ok(doorFacade, 'видна свободная часть стены для двери');
    await page.mouse.move(doorFacade.x, doorFacade.y, { steps: 5 });
    let ghost = (await d3(page)).openingTool;
    assert.equal(ghost.valid, true);
    assert.equal(ghost.kind, 'door');
    const hingeBefore = ghost.opening.hingeStart;

    await page.keyboard.press('Space');
    ghost = (await d3(page)).openingTool;
    assert.notEqual(ghost.opening.hingeStart, hingeBefore, 'Пробел переключил петли 3D-превью');
    await page.mouse.click(doorFacade.x, doorFacade.y);

    const list = await upperOpenings(page);
    const door = list.find((o) => o.kind === 'door');
    assert.ok(door, 'дверь записана в активный этаж');
    assert.equal(door.hingeStart, ghost.opening.hingeStart);
    const picked = await page.evaluate(async (id) => {
      const { deriveWalls, openingRect } = await import('./core/walls.js');
      const s = window.__kepler.state;
      const opening = s.project.openings.find((o) => o.id === id);
      const placed = openingRect(s.project, opening, deriveWalls(s.project));
      const cross = placed.wall.band.y + placed.wall.band.h / 2;
      const screen = window.__kepler.screen3d({
        x: placed.absCenter,
        y: cross,
        z: 3000 + opening.height / 2,
      });
      const hit = window.__kepler.pick3d(screen.x, screen.y);
      return hit && { type: hit.type, id: hit.id };
    }, door.id);
    assert.deepEqual(picked, { type: 'opening', id: door.id }, '3D-геометрия проёма выбирается как дверь');
  });

  it('выбирает этаж стены при вставке, даже если на плане активен другой этаж', async () => {
    const { page } = app;
    await page.keyboard.press('Escape');
    await page.evaluate(async () => {
      const { switchLevel } = await import('./ui/levels.js');
      const { mutate } = await import('./ui/store.js');
      const s = window.__kepler.state;
      mutate(() => { s.project.levels.find((l) => l.id === 'L2').openings = []; });
      switchLevel('L1', { planView: false });
    });
    await clickToolbarTool(page, 'windowToolBtn');
    const upperWall = await wallPoint(page, 4200);
    assert.ok(upperWall);
    await page.keyboard.down('Shift');
    await page.mouse.move(upperWall.x, upperWall.y);
    const ghost = (await d3(page)).openingTool;
    assert.equal(ghost.valid, true);
    assert.equal(ghost.wall.levelId, 'L2');
    await page.mouse.click(upperWall.x, upperWall.y);
    await page.keyboard.up('Shift');
    assert.equal((await upperOpenings(page)).length, 1);
    assert.equal(await page.evaluate(() => window.__kepler.state.project.activeLevel), 'L1');
    await page.keyboard.press('Control+z');
    await page.keyboard.press('Escape');
    assert.equal((await upperOpenings(page)).length, 0);
  });

  it('один витраж на двух этажах: выбор потолка, отступ, выбор за верхнее стекло и перетягивание обратно', async () => {
    const { page } = app;
    const id = await page.evaluate(async () => {
      const { selectObject } = await import('./ui/tools.js');
      const glass = window.__kepler.state.project.levels[0].openings[0];
      selectObject({ type: 'opening', id: glass.id });
      return glass.id;
    });
    await page.selectOption('#openTopLevel', 'L2');
    assert.equal(await page.locator('#openTopGap').inputValue(), '0');
    await page.fill('#openTopGap', '200');
    await page.locator('#openTopGap').press('Tab');
    assert.equal(await page.locator('#openTopGap').inputValue(), '200');
    assert.equal((await upperOpenings(page)).length, 0);
    const point = (z) => page.evaluate(async (target) => {
      const { levelProject } = await import('./core/model.js');
      const { deriveWalls, openingRect } = await import('./core/walls.js');
      const s = window.__kepler.state;
      const lp = levelProject(s.project, 'L1');
      const placed = openingRect(lp, lp.openings[0], deriveWalls(lp));
      return window.__kepler.screen3d({ x: placed.absCenter, y: placed.wall.band.y + placed.wall.band.h / 2, z: target });
    }, z);
    const readTop = () => page.evaluate(async () => {
      const { windowSpanTop } = await import('./core/spanning-windows.js');
      const s = window.__kepler.state;
      const opening = s.project.levels[0].openings[0];
      return windowSpanTop(s.project, 'L1', opening) ?? opening.sill + opening.height;
    });
    const head = await readTop();
    assert.ok(head > 5000 && head < 6000);
    await page.evaluate(async () => {
      const { switchLevel } = await import('./ui/levels.js');
      switchLevel('L2', { planView: false });
    });
    const upperGlass = await point(4100);
    const picked = await page.evaluate((p) => {
      const hit = window.__kepler.pick3d(p.x, p.y);
      return hit && [hit.type, hit.id, hit.levelId];
    }, upperGlass);
    assert.deepEqual(picked, ['opening', id, 'L1']);
    await page.mouse.click(upperGlass.x, upperGlass.y);
    assert.deepEqual(await page.evaluate(() => {
      const s = window.__kepler.state;
      return [s.selection?.id, s.project.activeLevel];
    }), [id, 'L1']);
    async function dragTop(to) {
      const start = await point(await readTop());
      const end = await point(to);
      await page.mouse.move(start.x, start.y);
      await page.mouse.down();
      assert.equal((await d3(page)).openingTool.resizing, 'top');
      await page.mouse.move(end.x, end.y, { steps: 5 });
      await page.mouse.up();
    }
    await dragTop(2250);
    assert.ok(Math.abs(await readTop() - 2250) < 35);
    assert.equal(await page.locator('#openTopLevel').inputValue(), '');
    await dragTop(4800);
    assert.ok(Math.abs(await readTop() - 4800) < 35);
    assert.equal(await page.locator('#openTopLevel').inputValue(), 'L2');
    await page.keyboard.press('Control+z');
    assert.ok(Math.abs(await readTop() - 2250) < 35);
  });

  it('верхняя ручка притягивает окно к соседнему с видимой направляющей, Shift освобождает высоту', async () => {
    const { page } = app;
    const { start, near, neighborId } = await page.evaluate(async () => {
      const { createOpening } = await import('./core/model.js');
      const { mutate } = await import('./ui/store.js');
      const { selectObject } = await import('./ui/tools.js');
      const { project } = window.__kepler.state;
      const room = project.levels[0].rooms[0];
      const source = project.levels[0].openings[0];
      const neighbor = createOpening('window', room.id, 0, 4400, 900);
      mutate(() => {
        Object.assign(neighbor, { heightMode: 'custom', sill: 600, height: 2050 });
        Object.assign(source, { heightMode: 'custom', sill: 650, height: 1400 });
        delete source.span;
        project.levels[0].openings.push(neighbor);
      });
      selectObject({ type: 'opening', id: source.id });
      const at = (z) => window.__kepler.screen3d({ x: 2200, y: -project.settings.exterior / 2, z });
      return { start: at(2050), near: at(2620), neighborId: neighbor.id };
    });
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    assert.equal((await d3(page)).openingTool.resizing, 'top');
    await page.mouse.move(near.x, near.y, { steps: 5 });
    assert.equal((await d3(page)).openingTool.alignedHeadId, neighborId);
    assert.ok(await page.evaluate(async () => {
      const { openingOverlay } = await import('./ui/opening3d.js');
      return openingOverlay().some((f) => f.edges?.length === 1 && f.edges[0].every((p) => p.z === 2650));
    }));
    await page.keyboard.down('Shift');
    await page.mouse.move(near.x, near.y + 1);
    assert.equal((await d3(page)).openingTool.alignedHeadId, null);
    await page.keyboard.up('Shift');
    await page.mouse.move(near.x, near.y);
    await page.mouse.up();
    assert.equal(await page.evaluate(() => window.__kepler.state.project.openings[0].height), 2000);
  });

  it('балконная дверь ставится в 3D без боковых окон и сразу открывает их настройки', async () => {
    const { page } = app;
    await page.evaluate(async () => {
      const { mutate } = await import('./ui/store.js');
      const { switchLevel } = await import('./ui/levels.js');
      const { cancelTool, selectObject } = await import('./ui/tools.js');
      cancelTool(); selectObject(null);
      mutate(() => { window.__kepler.state.project.levels.find((l) => l.id === 'L2').openings = []; });
      switchLevel('L2', { planView: false });
    });
    await clickToolbarTool(page, 'windowToolBtn');
    await page.click('#openingCats [data-cat="with-door"]');
    await page.click('#openingItems [data-preset="balcony-door"]');
    const at = await wallPoint(page);
    assert.ok(at);
    await page.mouse.move(at.x, at.y, { steps: 5 });
    const ghost = (await d3(page)).openingTool;
    assert.equal(ghost.valid, true);
    assert.deepEqual([ghost.opening.width, ghost.opening.height, ghost.opening.sill], [900, 2300, 0]);
    await page.mouse.click(at.x, at.y);
    const [door] = await upperOpenings(page);
    assert.ok(door);
    assert.deepEqual(await page.evaluate(() => {
      const s = window.__kepler.state;
      return [s.tool, s.selection?.id];
    }), [null, door.id]);
    assert.equal(await page.locator('#openWindowLeft').isChecked(), false);
    assert.equal(await page.locator('#openWindowRight').isChecked(), false);
    await page.check('#openWindowRight');
    const [withWindow] = await upperOpenings(page);
    assert.equal(withWindow.assembly.rightWindow, true);
    assert.equal(withWindow.assembly.doorWidth, 900);
    assert.equal(withWindow.assembly.doorHeight, 2300);
  });

  it('без ошибок в консоли', () => {
    assert.deepEqual(app.errors, []);
  });
});

describe('Окно второго света на телефоне', () => {
  it('верхний этаж выбирается из свойств окна', async () => {
    const app = await startApp({ width: 390, height: 844, mobile: true });
    try {
      const { page } = app;
      await openNew(page);
      await setupTwoFloors(page);
      await page.evaluate(async () => {
        const { selectObject } = await import('./ui/tools.js');
        const { switchLevel } = await import('./ui/levels.js');
        const s = window.__kepler.state;
        switchLevel('L1');
        selectObject({ type: 'opening', id: s.project.openings[0].id });
      });
      await page.tap('#mobileBar [data-sheet="props"]');
      await page.selectOption('#openTopLevel', 'L2');
      assert.equal(await page.locator('#openTopGap').inputValue(), '0');
      await page.selectOption('#openTopLevel', '');
      assert.equal(await page.locator('#openTopGap').count(), 0);
      assert.deepEqual(app.errors, []);
    } finally {
      await app.close();
    }
  });
});
