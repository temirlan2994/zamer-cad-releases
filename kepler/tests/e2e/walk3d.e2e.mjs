import assert from 'node:assert/strict';
import { it } from 'node:test';
import { openNew, openSample, startApp } from './helpers.mjs';

const scene = (page) => page.evaluate(() => window.__kepler.debug3d());
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const project = (page) => page.evaluate(() => JSON.stringify(window.__kepler.state.project));

async function chooseWalk(page, { mobile = false, point = null, yaw = null, levelZ = null } = {}) {
  if (mobile) await page.tap('#v3Walk'); else await page.click('#v3Walk');
  assert.equal((await scene(page)).walk, null, 'первое нажатие ещё не запускает прогулку');
  assert.equal((await scene(page)).walkChoosing, true);
  if (yaw != null) {
    let delta = (await scene(page)).cam.yaw-yaw;
    const c = await page.locator('#canvas3d').boundingBox();
    while (Math.abs(delta) > .001) {
      const dx = Math.max(-150, Math.min(150, delta/.008));
      await page.mouse.move(c.x+c.width/2, c.y+c.height/2); await page.mouse.down();
      if (Math.abs(dx) < 8) await page.mouse.move(c.x+c.width/2+Math.sign(dx)*8, c.y+c.height/2);
      await page.mouse.move(c.x+c.width/2+dx, c.y+c.height/2, { steps: 8 }); await page.mouse.up();
      delta = (await scene(page)).cam.yaw-yaw;
    }
  }
  let target = null;
  for (let attempt = 0; attempt < 6 && !target; attempt++) {
    target = await page.evaluate(async ({ point, levelZ }) => {
      const { walkPickFaces, walkSpawnAt, walkWorld } = await import('./core/walk3d.js');
      const { screenRay } = await import('./core/pick3d.js');
      const { buildHouseMesh, terrainHeightFn } = await import('./core/mesh3d.js');
      const { camera3dSnapshot } = await import('./ui/view3d.js');
      const p = window.__kepler.state.project, c = camera3dSnapshot();
      const rect = document.getElementById('canvas3d').getBoundingClientRect();
      const faces = buildHouseMesh(p, { ...c, roofs: c.roof, facades: c.masses });
      const prepared = walkPickFaces(faces), world = walkWorld(faces, terrainHeightFn(p, c.terrainScale));
      const full = walkWorld(buildHouseMesh(p, { ...c, roof: true, roofs: true, site: true, levels: 'all', furniture: true, landscape: true, masses: true, facades: true }), terrainHeightFn(p, c.terrainScale));
      const candidates = point ? [window.__kepler.screen3d(point)] : [];
      if (!point) for (let y = rect.top+rect.height*.35; y < rect.bottom-100; y += 25) for (let x = rect.left+25; x < rect.right-25; x += 25) candidates.push({ x, y });
      for (const at of candidates) {
        if (at.x < rect.left+5 || at.x > rect.right-5 || at.y < rect.top+100 || at.y > rect.bottom-90) continue;
        const top = document.elementFromPoint(at.x, at.y);
        if (top?.id !== 'canvas3d') continue;
        const spawn = walkSpawnAt(world, prepared, screenRay(c, rect.width, rect.height, at.x-rect.left, at.y-rect.top), c.yaw);
        if (!spawn || full.blocked(spawn.x, spawn.y, spawn.z)) continue;
        if (point && Math.hypot(spawn.x-point.x, spawn.y-point.y, spawn.z-point.z) > 20) continue;
        if (levelZ != null && Math.abs(spawn.z-levelZ) > 2) continue;
        return at;
      }
      return null;
    }, { point, levelZ });
    if (!target) {
      const c = await page.locator('#canvas3d').boundingBox();
      await page.mouse.move(c.x+c.width/2, c.y+c.height/2); await page.mouse.wheel(0, 450);
    }
  }
  assert.ok(target, 'найдена видимая свободная точка для второго клика');
  if (!mobile) { await page.mouse.move(target.x, target.y); assert.equal(await page.locator('#v3WalkStart').isVisible(), true); }
  if (mobile) await page.touchscreen.tap(target.x, target.y); else await page.mouse.click(target.x, target.y);
  await page.waitForFunction(() => Boolean(window.__kepler.debug3d().walk));
  return target;
}

it('выбор точки: поворот, неверная поверхность, Esc, повторная кнопка и закрытие 3D не запускают прогулку', async () => {
  const app = await startApp();
  try {
    const { page } = app;
    await openSample(page); await page.click('#view3dBtn');
    const previous = await scene(page), data = await project(page);
    await page.click('#v3Walk');
    assert.equal((await scene(page)).walkChoosing, true);
    assert.equal((await scene(page)).walk, null);
    const c = await page.locator('#canvas3d').boundingBox();
    await page.mouse.move(c.x+c.width/2, c.y+c.height/2); await page.mouse.down();
    await page.mouse.move(c.x+c.width/2+80, c.y+c.height/2+20, { steps: 8 }); await page.mouse.up();
    assert.equal((await scene(page)).walk, null);
    assert.notEqual((await scene(page)).cam.yaw, previous.cam.yaw);
    // Находим видимую стену обычным API выбора и нажимаем на неё.
    const wall = await page.evaluate(() => {
      const c = document.getElementById('canvas3d').getBoundingClientRect();
      for (let y = c.top+c.height*.3; y < c.bottom-100; y += 15) for (let x = c.left+30; x < c.right-60; x += 15) {
        if (document.elementFromPoint(x, y)?.id === 'canvas3d' && window.__kepler.pick3d(x, y)?.type === 'wall') return { x, y };
      }
      return null;
    });
    assert.ok(wall); await page.mouse.click(wall.x, wall.y);
    assert.equal((await scene(page)).walkChoosing, true);
    assert.equal((await scene(page)).walk, null);
    assert.equal(await page.evaluate(() => window.__kepler.state.selection), null);
    await page.keyboard.press('Delete'); await page.keyboard.press('Control+z');
    assert.equal(await project(page), data);
    await page.keyboard.press('Escape');
    assert.equal((await scene(page)).walkChoosing, false);
    assert.deepEqual((await scene(page)).cam, previous.cam);
    assert.equal(await page.locator('#propsPanel').evaluate((e) => e.inert), false);
    await page.click('#v3Walk'); await page.click('#v3Walk');
    assert.equal((await scene(page)).walkChoosing, false);
    await page.click('#v3Walk'); await page.click('#v3Close');
    assert.equal((await scene(page)).active, false);
    assert.equal(await page.locator('body').evaluate((e) => e.classList.contains('v3-walk-choosing')), false);
    assert.equal(await project(page), data); assert.deepEqual(app.errors, []);
  } finally { await app.close(); }
});

it('второй клик на балконе ставит персонажа в указанное место на высоте этажа', async () => {
  const app = await startApp();
  try {
    const { page } = app; await openNew(page);
    await page.evaluate(async () => {
      const { createRoom, createLevel } = await import('./core/model.js');
      const { mutate } = await import('./ui/store.js');
      mutate(() => {
        const p = window.__kepler.state.project;
        p.rooms.push(createRoom('living', 0, 0, 5000, 4000));
        const upper = createLevel('2 этаж', 3000);
        upper.rooms.push(createRoom('bedroom', 0, 0, 5000, 4000), createRoom('balcony', 1000, 4000, 2200, 2200));
        p.levels.push(upper);
      });
    });
    await page.click('#view3dBtn'); const previous = await scene(page), data = await project(page);
    await chooseWalk(page, { point: { x: 2100, y: 4800, z: 3000 } });
    const position = (await scene(page)).walk;
    assert.ok(Math.abs(position.x-2100) < 15 && Math.abs(position.y-4800) < 15);
    assert.ok(Math.abs(position.z-3000) < 2);
    await page.keyboard.press('Escape');
    assert.deepEqual((await scene(page)).cam, previous.cam);
    assert.equal(await project(page), data); assert.deepEqual(app.errors, []);
  } finally { await app.close(); }
});

it('прогулка: реальное WASD, обзор мышью, защита модели и возврат камеры по Esc', async () => {
  const app = await startApp();
  try {
    const { page } = app;
    await openNew(page);
    await page.click('#view3dBtn');
    const previous = await scene(page), data = await project(page);
    const preferences = await page.evaluate(() => localStorage.getItem('kepler-3d-layers'));
    await chooseWalk(page);
    const initial = await scene(page);
    assert.equal(initial.walk.height, 1700);
    assert.equal(initial.cam.projection, 'perspective');
    await page.keyboard.down('w');
    await page.waitForFunction((p) => {
      const w = window.__kepler.debug3d().walk;
      return Math.hypot(w.x-p.x, w.y-p.y) > 300;
    }, initial.walk);
    await page.keyboard.up('w');
    const moved = await scene(page);
    assert.ok(distance(initial.walk, moved.walk) > 300);
    const canvas = await page.locator('#canvas3d').boundingBox();
    await page.mouse.move(canvas.x + canvas.width / 2, canvas.y + canvas.height / 2);
    await page.mouse.down();
    await page.mouse.move(canvas.x + canvas.width / 2 + 80, canvas.y + canvas.height / 2 + 25, { steps: 8 });
    await page.mouse.up();
    const looked = await scene(page);
    assert.ok(Math.abs(looked.cam.yaw - moved.cam.yaw) > 0.05);
    assert.ok(Math.abs(looked.cam.pitch - moved.cam.pitch) > 0.01);
    await page.keyboard.press('o');
    await page.waitForFunction(() => document.getElementById('v3WalkSettings').open && !window.__kepler.debug3d().walk.locked);
    await page.keyboard.press('Escape');
    assert.ok((await scene(page)).walk, 'Esc из настроек сохраняет прогулку');
    await page.keyboard.press('Delete'); await page.keyboard.press('m'); await page.keyboard.press('Control+z');
    assert.equal(await project(page), data);
    assert.equal(await page.evaluate(() => window.__kepler.state.tool), null);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !window.__kepler.debug3d().walk);
    assert.deepEqual((await scene(page)).cam, previous.cam);
    assert.equal((await scene(page)).active, true);
    assert.equal(await page.evaluate(() => localStorage.getItem('kepler-3d-layers')), preferences);
    assert.equal(await page.locator('#propsPanel').evaluate((e) => e.inert), false);
    await page.click('#v3Walk');
    await page.click('#v3Close');
    assert.equal((await scene(page)).walk, null);
    assert.equal(await page.locator('body').evaluate((e) => e.classList.contains('v3-walking')), false);
    assert.deepEqual(app.errors, []);
  } finally { await app.close(); }
});

it('пример дома: старт снаружи, потеря фокуса останавливает WASD', async () => {
  const app = await startApp();
  try {
    const { page } = app;
    await openSample(page); await page.click('#view3dBtn');
    const data = await project(page);
    await chooseWalk(page);
    const initial = (await scene(page)).walk;
    assert.ok(initial && Number.isFinite(initial.z));
    assert.ok(Math.abs(initial.z) <= 2);
    await page.keyboard.down('w');
    await page.waitForFunction((start) => {
      const w = window.__kepler.debug3d().walk;
      return Math.hypot(w.x-start.x, w.y-start.y) > 200;
    }, initial);
    await page.keyboard.up('w');
    await page.keyboard.down('d');
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    const blurred = (await scene(page)).walk;
    await page.waitForTimeout(200);
    assert.deepEqual((await scene(page)).walk, blurred);
    await page.keyboard.up('d');
    await page.click('#v3Walk');
    assert.equal(await project(page), data);
    assert.deepEqual(app.errors, []);
  } finally { await app.close(); }
});

it('телефон: кнопка прогулки, движение удержанием кнопки и взгляд свайпом', async () => {
  const app = await startApp({ mobile: true });
  try {
    const { page } = app;
    await openNew(page); await page.tap('#view3dBtn');
    const previous = await scene(page);
    await chooseWalk(page, { mobile: true });
    const initial = await scene(page);
    const cdp = await page.context().newCDPSession(page);
    const button = await page.locator('[data-walk-key="KeyW"]').boundingBox();
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: button.x + 22, y: button.y + 22 }] });
    await page.waitForFunction((p) => {
      const w = window.__kepler.debug3d().walk;
      return Math.hypot(w.x-p.x, w.y-p.y) > 200;
    }, initial.walk);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    const box = await page.locator('#canvas3d').boundingBox();
    const x = box.x + box.width * .4, y = box.y + box.height * .5;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + 60, y: y + 20 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    assert.ok(Math.abs((await scene(page)).cam.yaw - initial.cam.yaw) > .05);
    await page.tap('#v3Walk');
    await page.waitForFunction(() => !window.__kepler.debug3d().walk);
    assert.deepEqual((await scene(page)).cam, previous.cam);
    assert.equal((await scene(page)).walk, null);
    assert.deepEqual(app.errors, []);
  } finally { await app.close(); }
});

it('в интерьере второго этажа можно выбрать точку на полу и вернуть ракурс этажа', async () => {
  const app = await startApp();
  try {
    const { page } = app;
    await page.getByRole('button', { name: /Двухэтажный · 4 спальни/ }).click();
    await page.click('#view3dBtn');
    await page.locator('.v3-views summary').click();
    await page.click('#v3EnterInterior');
    const level = await page.evaluate(() => window.__kepler.state.project.levels[1]);
    await page.selectOption('#v3InteriorLevel', level.id);
    const previous = await scene(page), data = await project(page);
    await chooseWalk(page, { levelZ: level.elevation });
    assert.ok(Math.abs((await scene(page)).walk.z-level.elevation) <= 2);
    await page.keyboard.press('Escape');
    assert.deepEqual((await scene(page)).cam, previous.cam);
    assert.deepEqual((await scene(page)).levelsShown, previous.levelsShown);
    assert.equal(await page.locator('#v3InteriorLevel').inputValue(), level.id);
    assert.equal(await project(page), data);
    assert.deepEqual(app.errors, []);
  } finally { await app.close(); }
});

it('чувствительность меняется клавиатурой, влияет на обзор и сохраняется после перезагрузки', async () => {
  const app = await startApp();
  try {
    const { page } = app;
    await openNew(page); await page.click('#view3dBtn'); await chooseWalk(page);
    await page.evaluate(() => { document.getElementById('canvas3d').requestPointerLock = undefined; });
    const slider = page.locator('#v3WalkSensitivity');
    const look = async () => {
      const c = await page.locator('#canvas3d').boundingBox();
      await page.mouse.move(c.x+c.width/2, c.y+c.height/2);
      const before = (await scene(page)).cam.yaw;
      await page.mouse.down();
      await page.mouse.move(c.x+c.width/2+80, c.y+c.height/2, { steps: 8 });
      await page.mouse.up();
      return Math.abs((await scene(page)).cam.yaw-before);
    };
    await page.keyboard.press('o'); await slider.focus(); await slider.press('Home');
    assert.equal((await scene(page)).walk.sensitivity, .25);
    await slider.press('ArrowRight');
    assert.equal((await scene(page)).walk.sensitivity, .3);
    await slider.press('Home'); await page.keyboard.press('Escape');
    const slow = await look();
    await page.locator('#v3WalkSettings summary').click();
    await slider.focus(); await slider.press('End'); await page.keyboard.press('Escape');
    const fast = await look();
    assert.ok(Math.abs(fast/slow-12) < .01);
    await page.keyboard.press('Escape');
    await page.reload(); await page.waitForFunction(() => Boolean(window.__kepler));
    if (await page.locator('#startScreen').isVisible()) await openNew(page);
    await page.click('#view3dBtn'); await chooseWalk(page);
    await page.locator('#v3WalkSettings summary').click();
    assert.equal(await slider.inputValue(), '3');
    assert.equal((await scene(page)).walk.sensitivity, 3);
    assert.deepEqual(app.errors, []);
  } finally { await app.close(); }
});

it('с улицы через калитку и крыльцо: вход, выход и повторный вход реальными WASD', async () => {
  const app = await startApp();
  try {
    const { page } = app;
    await openNew(page);
    await page.evaluate(async () => {
      const { createRoom, createOpening } = await import('./core/model.js');
      const { mutate } = await import('./ui/store.js');
      const { entryAt } = await import('./core/site-entries.js');
      const p = window.__kepler.state.project;
      mutate(() => {
        p.envelope.zeroAboveGround = 1000;
        const room = createRoom('entrance', 0, 0, 5000, 4000);
        const door = createOpening('door', room.id, 0, 2500, 1000); door.entryRole = 'main';
        p.rooms.push(room); p.openings.push(door);
        p.site.boundary = [{ x: -5000, y: -6000 }, { x: 10000, y: -6000 }, { x: 10000, y: 10000 }, { x: -5000, y: 10000 }];
        const entry = { id: 'walk-wicket', kind: 'wicket', width: 1000, height: 1800 };
        p.site.entries = [{ ...entry, ...entryAt(p.site, { x: 2500, y: -6000 }, entry) }];
      });
    });
    const data = await project(page);
    await page.click('#view3dBtn'); await chooseWalk(page, { point: { x: 2500, y: -7200, z: -1000 }, yaw: Math.PI/2 });
    const start = (await scene(page)).walk;
    assert.ok(start.y < -6000 && Math.abs(start.x-2500) < 1);
    await page.keyboard.down('Shift');
    for (const direction of ['w', 's', 'w']) {
      await page.keyboard.down(direction);
      await page.waitForFunction((inside) => {
        const p = window.__kepler.debug3d().walk;
        return inside ? p.y > 500 : p.y < -6800;
      }, direction === 'w');
      await page.keyboard.up(direction);
      const reached = (await scene(page)).walk;
      assert.ok(Math.abs(reached.z - (direction === 'w' ? 1 : -1000)) < 2);
    }
    await page.keyboard.up('Shift'); await page.keyboard.press('Escape');
    assert.equal(await project(page), data);
    assert.deepEqual(app.errors, []);
  } finally { await app.close(); }
});

it('внутренняя лестница: WASD поднимает персонажа, камера плавно догоняет ступени и опускается обратно', async () => {
  const app = await startApp();
  try {
    const { page } = app;
    await openNew(page);
    await page.evaluate(async () => {
      const { createRoom, createOpening, createItem, createLevel } = await import('./core/model.js');
      const { applyStairPreset } = await import('./core/stairs.js');
      const { mutate } = await import('./ui/store.js');
      const { entryAt } = await import('./core/site-entries.js');
      const p = window.__kepler.state.project;
      mutate(() => {
        p.envelope.zeroAboveGround = 0;
        const room = createRoom('stairs-room', -2000, -4000, 4000, 8000);
        const door = createOpening('door', room.id, 2, 2000, 1000); door.entryRole = 'main';
        p.rooms.push(room); p.openings.push(door);
        p.items.push(applyStairPreset(createItem('stairs', 0, 0, 1000, 3000), 'straight', 3000));
        const upper = createLevel('2 этаж', 3000);
        upper.rooms.push(createRoom('stairs-room', -2000, -4000, 4000, 8000));
        p.levels.push(upper);
        p.site.boundary = [{ x: -5000, y: -6000 }, { x: 5000, y: -6000 }, { x: 5000, y: 7000 }, { x: -5000, y: 7000 }];
        const entry = { id: 'walk-wicket', kind: 'wicket', width: 1000, height: 1800 };
        p.site.entries = [{ ...entry, ...entryAt(p.site, { x: 0, y: 7000 }, entry) }];
      });
    });
    await page.click('#view3dBtn'); await chooseWalk(page, { point: { x: 0, y: 8200, z: 0 }, yaw: -Math.PI/2 });
    await page.evaluate(() => {
      window.walkHeightSamples = [];
      const sample = () => {
        const p = window.__kepler.debug3d().walk;
        if (!p) return;
        window.walkHeightSamples.push({ z: p.z, viewZ: p.viewZ });
        requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    });
    await page.keyboard.down('Shift'); await page.keyboard.down('w');
    await page.waitForFunction(() => window.__kepler.debug3d().walk.y < -1700);
    await page.keyboard.up('w');
    assert.ok((await scene(page)).walk.z > 2500);
    await page.waitForFunction(() => {
      const p = window.__kepler.debug3d().walk;
      return Math.abs(p.z-p.viewZ) < 1;
    });
    await page.keyboard.down('s');
    await page.waitForFunction(() => window.__kepler.debug3d().walk.y > 3200);
    await page.keyboard.up('s'); await page.keyboard.up('Shift');
    await page.waitForFunction(() => {
      const p = window.__kepler.debug3d().walk;
      return Math.abs(p.z-p.viewZ) < 1;
    });
    assert.ok((await scene(page)).walk.z < 2);
    const samples = await page.evaluate(() => window.walkHeightSamples);
    assert.ok(samples.some((p) => p.z-p.viewZ > 20), 'плавный подъём');
    assert.ok(samples.some((p) => p.viewZ-p.z > 20), 'плавный спуск');
    await page.keyboard.press('Escape');
    assert.deepEqual(app.errors, []);
  } finally { await app.close(); }
});

it('прогулка доступна без WebGL: обрезка стен у ближней плоскости не вызывает ошибок', async () => {
  const app = await startApp();
  try {
    const { page } = app;
    await openSample(page);
    await page.evaluate(() => {
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (type, ...args) {
        return type.includes('webgl') ? null : original.call(this, type, ...args);
      };
    });
    await page.click('#view3dBtn'); await chooseWalk(page);
    assert.equal((await scene(page)).webgl, false);
    await page.keyboard.down('w'); await page.waitForTimeout(200); await page.keyboard.up('w');
    assert.ok(Number.isFinite((await scene(page)).walk.z));
    await page.keyboard.press('Escape');
    assert.equal((await scene(page)).walk, null);
    assert.deepEqual(app.errors, []);
  } finally { await app.close(); }
});
