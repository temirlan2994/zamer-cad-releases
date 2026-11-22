// Привязка стен к координационным осям (core/grid-pins.js, «замок» как в
// Revit): формат и чистка полей, сохранение v7/v6, прикрепление стены
// (встаёт на ось), сдвиг оси двигает прикреплённые грани и соседа по общей
// стене, отказ без изменений, снятие привязки (грань ушла с оси, ось удалена
// или сменила направление), перенумерация осей, ручная стена (линия и
// торцы), магнит стены к оси и привязка точек ручной стены к осям.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { autoGrids, autoNumberGrids, createGrid, renumberGrids } from '../core/grid-axes.js';
import { addManualWall, snapWallPoint, wallCenterTargets } from '../core/wall-manual.js';
import {
  createProject, createRoom, deserializeProject, fileDataV6, normalizeRoom, normalizeWall, serializeProject,
} from '../core/model.js';
import { deriveWalls } from '../core/walls.js';
import { normalizeRoomPins, normalizeWallPins } from '../core/grid-pins-model.js';
import {
  dirOf, hasGridPins, moveGridWithPins, nearestWallGrid, pinWallToGrid, syncGridPins, unpinWallFromGrid,
  autoWallMode, setWallPinMode, wallBody, wallLocks, wallMagnet, wallPins,
} from '../core/grid-pins.js';

// Две комнаты с общей стеной (зазор 100 = перегородка) по x = 4000…4100.
function twoRooms() {
  const p = createProject('Оси');
  const a = createRoom('living', 0, 0, 4000, 3000); a.name = 'Гостиная';
  const b = createRoom('bedroom', 4100, 0, 3000, 3000); b.name = 'Спальня';
  p.rooms.push(a, b);
  return { p, a, b };
}

const sharedV = (p) => deriveWalls(p).find((w) => w.kind === 'shared' && w.orient === 'v');

test('формат: чистка привязок комнаты и ручной стены', () => {
  assert.equal(normalizeRoomPins(null), null);
  assert.deepEqual(normalizeRoomPins([
    { dir: 'e', gridId: 'g1', off: '-50', mode: 'axis' }, { dir: 'q', gridId: 'g1' }, { dir: 'n' },
    { dir: 'e', gridId: 'g1', off: -50 }, { dir: 'w', gridId: 'g2' },
  ]), [{ dir: 'e', gridId: 'g1', off: -50, mode: 'axis' }, { dir: 'w', gridId: 'g2', off: 0, mode: 'face' }]);
  assert.deepEqual(normalizeWallPins({ line: { gridId: 'g', off: 5 }, a: { gridId: 'h' }, b: 7 }),
    { line: { gridId: 'g', off: 5, mode: 'face' }, a: { gridId: 'h', off: 0 } });
  const r = normalizeRoom({ x: 0, y: 0, w: 10, h: 10, axisPins: [{ dir: 'x' }] });
  assert.equal('axisPins' in r, false);
  const w = normalizeWall({ axis: { a: { x: 0, y: 0 }, b: { x: 1000, y: 0 } }, axisPins: { line: { gridId: 'g' } } });
  assert.deepEqual(w.axisPins, { line: { gridId: 'g', off: 0, mode: 'face' } });
  assert.equal(dirOf({ orient: 'h', outward: -1 }), 'n');
  assert.equal(dirOf({ orient: 'v', outward: 1 }), 'e');
});

test('общая стена: «по оси» — встаёт на ось, обе комнаты помнят грань', () => {
  const { p, a, b } = twoRooms();
  const g = createGrid({ kind: 'x', at: 4200 }, []);
  p.grids = [g];
  const res = pinWallToGrid(p, sharedV(p), g, { mode: 'axis' });
  assert.ok(res.ok, res.reason);
  assert.equal(a.w, 4150); // ось стены 4150…4250 → середина 4200
  assert.equal(b.x, 4250);
  assert.deepEqual(a.axisPins, [{ dir: 'e', gridId: g.id, off: -50, mode: 'axis' }]);
  assert.deepEqual(b.axisPins, [{ dir: 'w', gridId: g.id, off: 50, mode: 'axis' }]);
  assert.deepEqual(wallPins(p, sharedV(p)).map((x) => x.gridId), [g.id]);
  // Замок: закрыт, на оси у стены.
  const locks = wallLocks(p, sharedV(p), p.grids);
  assert.equal(locks.length, 1);
  assert.equal(locks[0].closed, true);
  assert.equal(locks[0].mode, 'axis');
  assert.equal(locks[0].at.x, 4200);
});

test('сдвиг оси: прикреплённые грани едут, комнаты растягиваются; отказ — без изменений', () => {
  const { p, a, b } = twoRooms();
  const g = createGrid({ kind: 'x', at: 4050 }, []);
  p.grids = [g];
  assert.ok(pinWallToGrid(p, sharedV(p), g, { mode: 'axis' }).ok);
  const r = moveGridWithPins(p, g.id, 4550);
  assert.ok(r.ok, r.reason);
  assert.equal(p.grids[0].at, 4550);
  assert.equal(a.w, 4500);
  assert.equal(b.x, 4600);
  assert.equal(b.w, 2500);
  assert.equal(sharedV(p).thickness, 100); // перегородка не порвалась
  assert.deepEqual(syncGridPins(p), { dropped: 0, orphans: 0 });
  // Спальня меньше минимума — отказ, всё как было.
  const before = JSON.stringify(p.rooms);
  const bad = moveGridWithPins(p, g.id, 7000);
  assert.equal(bad.ok, false);
  assert.match(bad.reason, /Спальня/);
  assert.equal(p.grids[0].at, 4550);
  assert.equal(JSON.stringify(p.rooms), before);
});

test('наружная стена «по грани»: наружная грань на оси; сосед по общей стене — попутчик', () => {
  const { p, a, b } = twoRooms();
  // Своя наружная стена гостиной (север): y = −250…0, ось y = −300 в 50 мм.
  const gy = createGrid({ kind: 'y', at: -300 }, []);
  p.grids = [gy];
  const north = deriveWalls(p).find((w) => w.kind === 'own' && w.orient === 'h' && w.rooms[0] === a.id && w.band.y < 0);
  assert.ok(pinWallToGrid(p, north, gy, { mode: 'face' }).ok);
  assert.equal(a.y, -50); // наружная грань (−300) на оси
  assert.equal(a.h, 3050);
  assert.deepEqual(a.axisPins, [{ dir: 'n', gridId: gy.id, off: 250, mode: 'face' }]);
  // Привязка только у гостиной (e), спальня — сосед по общей стене.
  const { p: q, a: qa, b: qb } = twoRooms();
  const gx = createGrid({ kind: 'x', at: 4000 }, []);
  q.grids = [gx];
  qa.axisPins = [{ dir: 'e', gridId: gx.id, off: 0, mode: 'face' }];
  const r = moveGridWithPins(q, gx.id, 3500);
  assert.ok(r.ok, r.reason);
  assert.equal(qa.w, 3500);
  assert.equal(qb.x, 3600); // встречная грань соседа — следом
  assert.equal(qb.w, 3500);
  assert.equal(b.x, 4100); // первая пара не тронута
});

test('грань увели с оси — привязка снимается; ось удалена или сменила направление — тоже', () => {
  const { p, a, b } = twoRooms();
  const g = createGrid({ kind: 'x', at: 4050 }, []);
  p.grids = [g];
  pinWallToGrid(p, sharedV(p), g, { mode: 'axis' });
  a.w += 400; // стену утащили дальше магнита
  assert.deepEqual(syncGridPins(p), { dropped: 1, orphans: 0 });
  assert.equal(a.axisPins, undefined);
  assert.equal(b.axisPins.length, 1);
  p.grids = [{ ...p.grids[0], kind: 'y' }];
  assert.deepEqual(syncGridPins(p), { dropped: 0, orphans: 1 });
  assert.equal(b.axisPins, undefined);
  // Удаление оси.
  const t = twoRooms();
  const g2 = createGrid({ kind: 'x', at: 4050 }, []);
  t.p.grids = [g2];
  pinWallToGrid(t.p, sharedV(t.p), g2, { mode: 'axis' });
  assert.ok(hasGridPins(t.p, g2.id));
  t.p.grids = [];
  assert.equal(syncGridPins(t.p).orphans, 2);
  assert.equal(hasGridPins(t.p, g2.id), false);
});

test('открепить: замок открыт, ось двигается — стена стоит', () => {
  const { p, a } = twoRooms();
  const g = createGrid({ kind: 'x', at: 4050 }, []);
  p.grids = [g];
  pinWallToGrid(p, sharedV(p), g, { mode: 'axis' });
  assert.ok(unpinWallFromGrid(p, sharedV(p), g.id));
  assert.equal(wallPins(p, sharedV(p)).length, 0);
  const lock = wallLocks(p, sharedV(p), p.grids)[0];
  assert.equal(lock.closed, false);
  assert.ok(moveGridWithPins(p, g.id, 4550).ok);
  assert.equal(a.w, 4000);
});

test('перенумерация осей не ломает привязки (привязка по id)', () => {
  const { p, a } = twoRooms();
  const g1 = createGrid({ kind: 'x', at: 4050 }, []);
  const g0 = createGrid({ kind: 'x', at: -2000 }, [g1]);
  p.grids = [g1, g0];
  pinWallToGrid(p, sharedV(p), g1, { mode: 'axis' });
  p.grids = autoNumberGrids(renumberGrids(p.grids));
  assert.equal(p.grids.find((x) => x.id === g1.id).label, '2');
  assert.ok(moveGridWithPins(p, g1.id, 4250).ok);
  assert.equal(a.w, 4200);
});

test('сохранение v7 и v6: привязки комнат и ручных стен переживают файл', () => {
  const { p } = twoRooms();
  const g = createGrid({ kind: 'x', at: 4050 }, []);
  const gy = createGrid({ kind: 'y', at: 5000 }, [g]);
  p.grids = [g, gy];
  pinWallToGrid(p, sharedV(p), g, { mode: 'axis' });
  const mw = addManualWall(p, { x: 1000, y: 5000 }, { x: 3000, y: 5000 });
  const mrec = deriveWalls(p).find((w) => w.kind === 'manual');
  assert.ok(pinWallToGrid(p, mrec, gy, { mode: 'axis' }).ok);
  assert.deepEqual(mw.axisPins, { line: { gridId: gy.id, off: 0, mode: 'axis' } });
  const back = deserializeProject(serializeProject(p));
  const ra = back.rooms.find((r) => r.name === 'Гостиная');
  assert.deepEqual(ra.axisPins, [{ dir: 'e', gridId: g.id, off: -50, mode: 'axis' }]);
  assert.deepEqual(back.walls[0].axisPins, mw.axisPins);
  const v6 = deserializeProject(JSON.stringify(fileDataV6(p)));
  assert.deepEqual(v6.rooms.find((r) => r.name === 'Спальня').axisPins, [{ dir: 'w', gridId: g.id, off: 50, mode: 'axis' }]);
  // Ось пропала из файла — привязки к ней сняты при чтении.
  const data = JSON.parse(serializeProject(p));
  data.grids = data.grids.filter((x) => x.id !== g.id);
  const orphan = deserializeProject(JSON.stringify(data));
  assert.equal(orphan.rooms.some((r) => r.axisPins), false);
  assert.ok(orphan.walls[0].axisPins.line);
  // Старый файл без полей — без привязок.
  const old = deserializeProject(serializeProject(twoRooms().p));
  assert.equal(old.rooms.some((r) => 'axisPins' in r), false);
});

test('ручная стена: линия и торцы на осях, сдвиг оси двигает стену и торец', () => {
  const p = createProject('Ручная');
  const gy = createGrid({ kind: 'y', at: 2000 }, []);
  const gx = createGrid({ kind: 'x', at: 3000 }, [gy]);
  p.grids = [gy, gx];
  const mw = addManualWall(p, { x: 0, y: 2040 }, { x: 2900, y: 2040 });
  const rec = () => deriveWalls(p).find((w) => w.kind === 'manual');
  // Линия: «по оси» → ось стены на оси y = 2000.
  assert.ok(pinWallToGrid(p, rec(), gy, { mode: 'axis' }).ok);
  assert.equal(mw.axis.a.y, 2000);
  // Торец b → на ось x = 3000.
  assert.ok(pinWallToGrid(p, rec(), gx, { part: 'b' }).ok);
  assert.equal(mw.axis.b.x, 3000);
  const locks = wallLocks(p, rec(), p.grids);
  assert.deepEqual(locks.map((l) => `${l.part}:${l.closed}`).sort(), ['b:true', 'line:true']);
  assert.ok(moveGridWithPins(p, gy.id, 2600).ok);
  assert.equal(mw.axis.a.y, 2600);
  assert.equal(mw.axis.b.y, 2600);
  assert.ok(moveGridWithPins(p, gx.id, 3500).ok);
  assert.equal(mw.axis.b.x, 3500);
  assert.equal(mw.axis.a.x, 0);
  assert.deepEqual(syncGridPins(p), { dropped: 0, orphans: 0 });
  // Стену сдвинули рукой — привязка линии снята, торец остался.
  mw.axis.a.y += 300; mw.axis.b.y += 300;
  assert.deepEqual(syncGridPins(p), { dropped: 1, orphans: 0 });
  assert.deepEqual(Object.keys(mw.axisPins), ['b']);
});

test('магнит стены к оси: грань/ось в 300 мм, прикреплённая — своей линией', () => {
  const { p } = twoRooms();
  const wall = deriveWalls(p).find((w) => w.kind === 'own' && w.orient === 'v' && w.band.x >= 7099);
  const body = wallBody(wall); // наружная стена спальни: x = 7100…7350
  assert.equal(body.lo, 7100);
  const g = createGrid({ kind: 'x', at: 7500 }, []);
  // Тянем на +100: наружная грань 7350+100 в 50 мм от оси → прилипает (delta 150).
  assert.deepEqual(pick(wallMagnet(body, 100, [g], { mode: 'face' })), { delta: 150 });
  // Дальше 300 мм — нет.
  assert.equal(wallMagnet(body, -300, [g], { mode: 'face' }), null);
  // По оси стены: середина 7225 → 7500.
  assert.deepEqual(pick(wallMagnet(body, 200, [g], { mode: 'axis' })), { delta: 275 });
  // Прикреплённая гранью lo — только lo (а не ближайшая hi).
  assert.deepEqual(pick(wallMagnet(body, -100, [g])), { delta: 150 });
  assert.equal(wallMagnet(body, -100, [g], { pinned: { gridId: g.id, ref: 7100 } }), null);
  assert.deepEqual(pick(wallMagnet(body, 300, [g], { pinned: { gridId: g.id, ref: 7100 } })), { delta: 400 });
  // Ось вне стены по длине — не цель.
  const short = { ...g, id: 'short' };
  assert.equal(wallMagnet(body, 100, [short], { extent: () => ({ from: 5000, to: 6000 }) }), null);
  assert.equal(nearestWallGrid(body, [g, createGrid({ kind: 'x', at: 20000 }, [g])]).grid.id, g.id);
});

const pick = (m) => (m ? { delta: m.delta } : null);

test('точка ручной стены липнет к осям в своём радиусе; пересечение осей — угол', () => {
  const gridPoints = [{ x: 3000, y: NaN }, { x: NaN, y: 2000 }];
  const s = snapWallPoint({ p: { x: 3200, y: 1830 }, gridPoints, gridTol: 300, tol: 20, grid: 100 });
  assert.deepEqual(s.point, { x: 3000, y: 2000 });
  assert.equal(s.gridX, true);
  assert.equal(s.gridY, true);
  // Грань стены ближе оси — побеждает грань.
  const walls = [{ band: { x: 3150, y: 0, w: 100, h: 1000 } }];
  const t = snapWallPoint({ p: { x: 3160, y: 500 }, walls, gridPoints, gridTol: 300, tol: 20, grid: 100 });
  assert.equal(t.point.x, 3150);
  assert.equal(t.gridX, false);
  // Линия от начала на оси — ортогонально по оси.
  const u = snapWallPoint({ p: { x: 5000, y: 2100 }, prev: { x: 3000, y: 2000 }, gridPoints, gridTol: 300, tol: 20, grid: 100 });
  assert.deepEqual(u.point, { x: 5000, y: 2000 });
  // Shift — без привязки.
  assert.equal(snapWallPoint({ p: { x: 3200, y: 1830 }, gridPoints, gridTol: 300, free: true }).gridX, false);
});

// ---------------------------------------------------------------- центр стены

const westV = (p) => deriveWalls(p).find((w) => w.kind === 'own' && w.orient === 'v' && w.band.x < 0);

test('автоопределение режима: ось по центру → «по оси», по грани → «по грани»; тонкая стена — по настройке', () => {
  const body = { lo: -250, mid: -125, hi: 0 };
  assert.equal(autoWallMode(body, -125).mode, 'axis');
  assert.equal(autoWallMode(body, -123).mode, 'axis');
  assert.equal(autoWallMode(body, -250).mode, 'face');
  assert.equal(autoWallMode(body, 2, 'axis').mode, 'face');
  const thin = { lo: 0, mid: 4, hi: 8 };
  assert.equal(autoWallMode(thin, 2, 'face').mode, 'face');
  assert.equal(autoWallMode(thin, 2, 'axis').mode, 'axis');
  // Замок у наружной стены видит ось по центру толщины (настройка «по грани»).
  const { p } = twoRooms();
  const g = createGrid({ kind: 'x', at: -125 }, []);
  p.grids = [g];
  const locks = wallLocks(p, westV(p), p.grids, { prefer: 'face' });
  assert.equal(locks.length, 1);
  assert.equal(locks[0].mode, 'axis');
  assert.equal(locks[0].closed, false);
  // Кнопка «Прикрепить к оси»: ближе центр — режим «по оси».
  const near = nearestWallGrid(wallBody(westV(p)), p.grids, 'face');
  assert.equal(near.mode, 'axis');
  assert.equal(near.delta, 0);
  // Ось у наружной грани — «по грани».
  const gf = createGrid({ kind: 'x', at: -240 }, []);
  assert.equal(nearestWallGrid(wallBody(westV(p)), [gf], 'axis').mode, 'face');
});

test('наружная стена «по центру»: центр на оси, сдвиг оси двигает центр', () => {
  const { p, a } = twoRooms();
  const g = createGrid({ kind: 'x', at: -100 }, []);
  p.grids = [g];
  const res = pinWallToGrid(p, westV(p), g, { mode: 'auto' });
  assert.ok(res.ok, res.reason);
  assert.equal(res.moved, true); // центр -125 → -100
  assert.equal(a.x, 25);
  assert.deepEqual(a.axisPins, [{ dir: 'w', gridId: g.id, off: 125, mode: 'axis' }]);
  assert.equal(wallBody(westV(p)).mid, -100);
  const r = moveGridWithPins(p, g.id, -600);
  assert.ok(r.ok, r.reason);
  assert.equal(wallBody(westV(p)).mid, -600);
  assert.equal(a.x, -475);
  const locks = wallLocks(p, westV(p), p.grids);
  assert.equal(locks[0].closed, true);
  assert.equal(locks[0].mode, 'axis');
  assert.deepEqual(syncGridPins(p), { dropped: 0, orphans: 0 });
});

test('общая стена: ось по середине зазора — замок «по оси», прикрепление и сдвиг у обеих комнат', () => {
  const { p, a, b } = twoRooms();
  const g = createGrid({ kind: 'x', at: 4050 }, []);
  p.grids = [g];
  const locks = wallLocks(p, sharedV(p), p.grids, { prefer: 'face' });
  assert.equal(locks[0].mode, 'axis');
  assert.ok(pinWallToGrid(p, sharedV(p), g, { mode: locks[0].mode }).ok);
  assert.deepEqual(a.axisPins, [{ dir: 'e', gridId: g.id, off: -50, mode: 'axis' }]);
  assert.deepEqual(b.axisPins, [{ dir: 'w', gridId: g.id, off: 50, mode: 'axis' }]);
  assert.ok(moveGridWithPins(p, g.id, 3550).ok);
  assert.equal(wallBody(sharedV(p)).mid, 3550);
  assert.equal(a.w, 3500);
  assert.equal(b.x, 3600);
});

test('ручная стена (своя перегородка): ось по её оси — «по оси», сдвиг оси двигает стену', () => {
  const p = createProject('Ручная');
  const g = createGrid({ kind: 'y', at: 2000 }, []);
  p.grids = [g];
  const mw = addManualWall(p, { x: 0, y: 2000 }, { x: 3000, y: 2000 }, { thickness: 100 });
  const rec = () => deriveWalls(p).find((w) => w.kind === 'manual');
  const locks = wallLocks(p, rec(), p.grids, { prefer: 'face' });
  assert.equal(locks.find((l) => l.part === 'line').mode, 'axis');
  assert.ok(pinWallToGrid(p, rec(), g, { mode: 'auto' }).ok);
  assert.equal(mw.axisPins.line.mode, 'axis');
  assert.ok(moveGridWithPins(p, g.id, 2500).ok);
  assert.equal(mw.axis.a.y, 2500);
});

test('смена режима привязки: «по центру» ↔ «по грани» одним шагом; отказ — без изменений', () => {
  const { p, a } = twoRooms();
  const g = createGrid({ kind: 'x', at: -125 }, []);
  p.grids = [g];
  assert.ok(pinWallToGrid(p, westV(p), g, { mode: 'axis' }).ok);
  assert.equal(a.x, 0);
  // → по грани: наружная грань (-250) встаёт на ось, комната ужимается на полтолщины.
  const r1 = setWallPinMode(p, westV(p), g.id, 'face');
  assert.ok(r1.ok, r1.reason);
  assert.equal(a.x, 125);
  assert.deepEqual(a.axisPins, [{ dir: 'w', gridId: g.id, off: 250, mode: 'face' }]);
  assert.equal(wallBody(westV(p)).lo, -125);
  // → обратно по центру.
  assert.ok(setWallPinMode(p, westV(p), g.id, 'axis').ok);
  assert.equal(a.x, 0);
  assert.deepEqual(a.axisPins, [{ dir: 'w', gridId: g.id, off: 125, mode: 'axis' }]);
  assert.equal(wallPins(p, westV(p))[0].mode, 'axis');
  // Нет такого режима — отказ, всё как было.
  const before = JSON.stringify(p.rooms);
  assert.equal(setWallPinMode(p, westV(p), g.id, 'zzz').ok, false);
  assert.equal(JSON.stringify(p.rooms), before);
  // Сохранение: режим «по оси» переживает файл.
  const back = deserializeProject(serializeProject(p));
  assert.equal(back.rooms.find((r) => r.name === 'Гостиная').axisPins[0].mode, 'axis');
});

test('«Оси по стенам» в режиме «по оси»: оси по центрам наружных стен, замок у каждой, прикрепление кликом', () => {
  const { p } = twoRooms();
  const walls = deriveWalls(p);
  p.grids = autoGrids(p, { walls, mode: 'axis' });
  for (const w of walls.filter((x) => x.kind === 'own')) {
    const body = wallBody(w);
    const g = p.grids.find((x) => x.kind === (w.orient === 'h' ? 'y' : 'x') && Math.abs(x.at - body.mid) < 0.5);
    assert.ok(g, `ось по центру стены ${w.key}`);
    const locks = wallLocks(p, w, p.grids, { prefer: 'face' });
    assert.ok(locks.some((l) => l.gridId === g.id && l.mode === 'axis'));
  }
  const w = westV(p);
  const lock = wallLocks(p, w, p.grids)[0];
  const res = pinWallToGrid(p, w, p.grids.find((x) => x.id === lock.gridId), { mode: lock.mode });
  assert.ok(res.ok, res.reason);
  assert.equal(res.moved, false);
});

test('цели привязки «центр стены»: наружная, общая, ручная; середина стены; подпись; выключение', () => {
  const { p } = twoRooms();
  addManualWall(p, { x: 1000, y: 500 }, { x: 1000, y: 2500 }, { thickness: 100 });
  const walls = deriveWalls(p);
  const xs = [...new Set(wallCenterTargets(walls).filter((c) => c.orient === 'v').map((c) => c.at))].sort((m, n) => m - n);
  assert.deepEqual(xs, [-125, 1000, 4050, 7225]);
  // Луч центра наружной стены: точка далеко от стены по длине — липнет по x.
  const s1 = snapWallPoint({ p: { x: -118, y: 6000 }, walls, tol: 20, grid: 100 });
  assert.equal(s1.point.x, -125);
  assert.equal(s1.centerX, 'center');
  assert.equal(s1.label, 'центр стены');
  // Общая стена: середина зазора 4050 (грани 4000/4100 дальше).
  const s2 = snapWallPoint({ p: { x: 4045, y: 9000 }, walls, tol: 20, grid: 100 });
  assert.equal(s2.point.x, 4050);
  // Ручная стена: середина отрезка (1000, 1500) — «середина стены».
  const s3 = snapWallPoint({ p: { x: 1010, y: 1490 }, walls, tol: 20, grid: 100 });
  assert.deepEqual(s3.point, { x: 1000, y: 1500 });
  assert.equal(s3.label, 'середина стены');
  // Рисуем от точки: конец липнет к центру соседней стены ортогонально.
  const s4 = snapWallPoint({ p: { x: 4040, y: 4010 }, prev: { x: 2000, y: 4000 }, walls, tol: 20, grid: 100 });
  assert.deepEqual(s4.point, { x: 4050, y: 4000 });
  // Грань ближе центра — грань, без подписи.
  const s5 = snapWallPoint({ p: { x: 4003, y: 9000 }, walls, tol: 20, grid: 100 });
  assert.equal(s5.point.x, 4000);
  assert.equal(s5.label, '');
  // Выключено (кнопки «Объекты»/«Выравнивание», Alt) и Shift — центров нет.
  assert.equal(snapWallPoint({ p: { x: 4045, y: 9000 }, walls, tol: 20, grid: 100, centers: false, mids: false }).point.x, 4050 - 50);
  assert.equal(snapWallPoint({ p: { x: 4045, y: 9000 }, walls, tol: 20, grid: 100, free: true }).point.x, 4045);
});
