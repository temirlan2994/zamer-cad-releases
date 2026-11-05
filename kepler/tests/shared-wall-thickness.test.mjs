// Толщина общей стены (блокер Б2 аудита 2026-11): стена остаётся общей при
// любой толщине, несущая между комнатами строится, старые проекты не меняются.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { createOpening, createProject, createRoom, deserializeProject, levelProject } from '../core/model.js';
import { deriveWalls, doorLink, findAdjacencies, openingRect, sharedKey } from '../core/walls.js';
import { analyzeConnectivity, snapRoomPosition, totalAreaM2 } from '../core/rooms.js';
import { setSharedWallThickness, setWallDefaults, setWallKind } from '../core/wall-thickness.js';
import { buildStructuredExport } from '../core/export.js';
import { buildIfc } from '../core/ifc.js';

// Холл (вход снаружи) | Спальня, дверь между ними в общей стене.
function twoRooms() {
  const project = createProject('Б2');
  const hall = createRoom('hall', 0, 0, 4000, 3000);
  const bed = createRoom('bedroom', 4100, 0, 4000, 3000);
  project.rooms.push(hall, bed);
  const entry = createOpening('door', hall.id, 3, 1500, 900); // левая наружная
  const inner = createOpening('door', hall.id, 1, 1500, 900); // в общей стене
  const win = createOpening('window', bed.id, 0, 2000, 1200); // верхняя стена спальни
  project.openings.push(entry, inner, win);
  return { project, hall, bed, entry, inner, win };
}

const shared = (project) => deriveWalls(project).filter((w) => w.kind === 'shared');

test('100 → 300 → 100 мм: стена остаётся общей, дверь между комнатами, связность цела', () => {
  const { project, hall, bed, inner, win } = twoRooms();
  const winBefore = openingRect(project, win, deriveWalls(project)).rect;
  const innerBefore = openingRect(project, inner, deriveWalls(project)).rect;
  for (const t of [300, 100]) {
    const wall = shared(project)[0];
    const result = setSharedWallThickness(project, wall, t);
    assert.equal(result.ok, true, result.reason);
    assert.deepEqual(result.broken, []);
    const walls = deriveWalls(project);
    const list = walls.filter((w) => w.kind === 'shared');
    assert.equal(list.length, 1, `при ${t} мм стена должна остаться общей`);
    assert.equal(list[0].thickness, t);
    assert.equal(bed.x - (hall.x + hall.w), t);
    // Своих (наружных) стен в зазоре нет.
    assert.equal(walls.filter((w) => w.kind === 'own' && w.rooms[0] === hall.id && w.sides[hall.id] === 1).length, 0);
    const link = doorLink(project, inner, walls);
    assert.deepEqual(new Set(link), new Set([hall.id, bed.id]));
    assert.ok(!link.includes('outside'));
    const conn = analyzeConnectivity(project, walls);
    assert.deepEqual(conn.unreachable, []);
    // Дверь в общей стене стоит на месте относительно неподвижного холла.
    const innerNow = openingRect(project, inner, walls).rect;
    assert.equal(innerNow.y, innerBefore.y);
    assert.equal(innerNow.x, hall.x + hall.w);
    // Окно спальни едет вместе со спальней.
    const winNow = openingRect(project, win, walls).rect;
    assert.equal(winNow.x - winBefore.x, bed.x - 4100);
  }
  assert.equal(bed.x, 4100);
  assert.equal(project.wallOverrides[sharedKey(hall.id, bed.id)].thickness, 100);
});

test('сосед слева: сдвигается в правильную сторону', () => {
  const project = createProject();
  const right = createRoom('hall', 4100, 0, 4000, 3000);
  const left = createRoom('bedroom', 0, 0, 4000, 3000);
  project.rooms.push(right, left);
  const wall = shared(project)[0];
  const moverId = wall.rooms[1];
  const fixedBefore = structuredClone(project.rooms.find((r) => r.id === wall.rooms[0]));
  assert.equal(setSharedWallThickness(project, wall, 250).ok, true);
  const fixed = project.rooms.find((r) => r.id === wall.rooms[0]);
  assert.deepEqual({ x: fixed.x, y: fixed.y }, { x: fixedBefore.x, y: fixedBefore.y });
  const mover = project.rooms.find((r) => r.id === moverId);
  assert.notEqual(mover.x, moverId === left.id ? 0 : 4100);
  assert.equal(shared(project).length, 1);
  assert.equal(shared(project)[0].thickness, 250);
});

test('несущая 380 мм между двумя комнатами строится и считается общей', () => {
  const project = createProject();
  const a = createRoom('living', 0, 0, 5000, 4000);
  const b = createRoom('kitchen', 5000 + 380, 0, 4000, 4000);
  project.rooms.push(a, b);
  // Без своей толщины зазор 380 — не стена, а две наружные.
  assert.equal(shared(project).length, 0);
  project.wallOverrides[sharedKey(a.id, b.id)] = { thickness: 380, kind: 'bearing' };
  const walls = shared(project);
  assert.equal(walls.length, 1);
  assert.equal(walls[0].thickness, 380);
  assert.equal(walls[0].wallType, 'bearing');
  // Стыковка при перетаскивании держит зазор этой стены.
  const snap = snapRoomPosition(project, b, 5000 + 300, 0, 50, null);
  assert.equal(snap.x, 5000 + 380);
  // Экспорт: признак несущей в JSON и Pset_WallCommon.LoadBearing в IFC.
  const exported = buildStructuredExport(project).levels[0].walls.find((w) => w.shared);
  assert.equal(exported.type, 'bearing');
  assert.equal(exported.load_bearing, true);
  const ifc = buildIfc(project).text;
  assert.match(ifc, /'Pset_WallCommon'/);
  assert.match(ifc, /IFCPROPERTYSINGLEVALUE\('LoadBearing',\$,IFCBOOLEAN\(\.T\.\),\$\)/);
});

test('тип «Несущая» даёт несущую толщину из настроек и сохраняет стыковку', () => {
  const { project, hall, bed } = twoRooms();
  project.settings.bearing = 380;
  const result = setWallKind(project, shared(project)[0], 'bearing');
  assert.equal(result.ok, true, result.reason);
  const wall = shared(project)[0];
  assert.equal(wall.wallType, 'bearing');
  assert.equal(wall.thickness, 380);
  assert.equal(bed.x - (hall.x + hall.w), 380);
  // Ручная толщина при смене типа не теряется.
  setSharedWallThickness(project, wall, 420);
  setWallKind(project, shared(project)[0], 'partition');
  assert.equal(shared(project)[0].thickness, 420);
  assert.equal(shared(project)[0].wallType, 'partition');
});

test('инвариант: площадь комнат не меняется, меняются только стена и позиция соседа', () => {
  const { project, hall, bed } = twoRooms();
  const area = totalAreaM2(project);
  const hallBefore = structuredClone(hall);
  const bedBefore = structuredClone(bed);
  for (const t of [50, 300, 600, 180, 100]) {
    assert.equal(setSharedWallThickness(project, shared(project)[0], t).ok, true);
    assert.ok(Math.abs(totalAreaM2(project) - area) < 1e-9);
    assert.deepEqual(hall, hallBefore);
    assert.deepEqual({ ...bed, x: bedBefore.x }, bedBefore);
  }
});

test('третья комната за соседом сдвигается вместе с ним: её стыковка не рвётся', () => {
  const { project, bed } = twoRooms();
  const third = createRoom('bath', bed.x + bed.w + 100, 0, 2000, 3000);
  project.rooms.push(third);
  assert.equal(shared(project).length, 2);
  const result = setSharedWallThickness(project, shared(project).find((w) => !w.rooms.includes(third.id)), 300);
  assert.equal(result.ok, true);
  assert.deepEqual(result.broken, []);
  assert.equal(shared(project).length, 2);
  assert.equal(third.x, bed.x + bed.w + 100);
});

test('сохранение и загрузка: своя толщина общей стены переживает файл', () => {
  const { project, hall, bed } = twoRooms();
  setSharedWallThickness(project, shared(project)[0], 300);
  const again = deserializeProject(JSON.stringify(project));
  const walls = deriveWalls(again).filter((w) => w.kind === 'shared');
  assert.equal(walls.length, 1);
  assert.equal(walls[0].thickness, 300);
  assert.deepEqual(new Set(walls[0].rooms), new Set([hall.id, bed.id]));
});

test('смена перегородки по умолчанию не рвёт уже построенные общие стены', () => {
  const { project } = twoRooms();
  setWallDefaults(project, { partition: 120, exterior: 300, bearing: 250 });
  assert.deepEqual([project.settings.partition, project.settings.exterior, project.settings.bearing], [120, 300, 250]);
  const walls = shared(project);
  assert.equal(walls.length, 1);
  assert.equal(walls[0].thickness, 100);
  const own = deriveWalls(project).find((w) => w.kind === 'own');
  assert.equal(own.thickness, 300);
});

test('старые проекты (v1–v4) открываются без изменения стен', () => {
  for (const v of [1, 2, 3, 4]) {
    const text = readFileSync(new URL(`./fixtures/v${v}-project.kepler.json`, import.meta.url), 'utf8');
    const raw = JSON.parse(text);
    const p = deserializeProject(text);
    assert.equal(p.settings.partition, raw.settings?.partition ?? 100);
    assert.equal(p.settings.exterior, raw.settings?.exterior ?? 250);
    assert.equal(p.settings.bearing, 200);
    for (const level of p.levels) {
      const lp = levelProject(p, level.id);
      // Без своих толщин общих стен стыковки те же, что по прежнему правилу.
      const before = findAdjacencies(lp.rooms, lp.settings.partition).length;
      const now = findAdjacencies(lp.rooms, lp.settings.partition, lp.wallOverrides).length;
      assert.equal(now, before, `v${v}`);
      for (const wall of deriveWalls(lp).filter((w) => w.kind === 'shared')) {
        assert.equal(wall.thickness, lp.settings.partition, `v${v}`);
      }
    }
  }
});

test('коридор поперёк линии стены растягивается, если за ним сдвигается сосед', () => {
  const { project, hall, bed } = twoRooms();
  const corridor = createRoom('corridor', 0, 3100, 8100, 1500);
  const store = createRoom('storage', 8200, 3100, 1500, 1500);
  project.rooms.push(corridor, store);
  const door = createOpening('door', corridor.id, 0, 6000, 900); // в спальню
  project.openings.push(door);
  const before = deriveWalls(project).filter((w) => w.kind === 'shared').length;
  const result = setSharedWallThickness(project, shared(project).find((w) => w.orient === 'v' && w.rooms.includes(hall.id)), 300);
  assert.equal(result.ok, true);
  assert.deepEqual(result.broken, []);
  assert.deepEqual(result.stretched, [corridor.id]);
  assert.equal(corridor.w, 8300);
  assert.equal(store.x, 8400);
  assert.equal(door.offset, 6200); // дверь в спальню уехала вместе со спальней
  assert.equal(deriveWalls(project).filter((w) => w.kind === 'shared').length, before);
  assert.equal(bed.x, 4300);
});
