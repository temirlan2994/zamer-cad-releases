// Ручные стены (этап B): создание, правка, проёмы на них, потребители.
import test from 'node:test';
import assert from 'node:assert/strict';

import { createOpening, createProject, createRoom, deserializeProject, serializeProject } from '../core/model.js';
import { moveRoomBy } from '../core/rooms.js';
import {
  addManualWall, dragManualWallEnd, moveManualWall, orthoPoint, removeManualWall, setManualWallJustify,
  setManualWallKind, setManualWallThickness, setWallHeight, wallAxisVerdict,
} from '../core/wall-manual.js';
import {
  clampOpeningOffset, deriveWalls, doorLink, doorSymbol, openingRect, wallContains, wallsEngine,
} from '../core/walls.js';
import { fitOpeningOffset, resolveOpeningConflicts } from '../core/opening-spacing.js';
import { moveWallBy } from '../core/wall-edit.js';
import { setWallKind } from '../core/wall-thickness.js';
import { buildIfc, stepString } from '../core/ifc.js';
import { buildStructuredExport, planEntities } from '../core/export.js';
import { buildHouseMesh } from '../core/mesh3d.js';

function hostDoor(wallId, t, width = 900) {
  const d = createOpening('door', null, 0, 0, width);
  delete d.side; delete d.offset;
  d.roomId = null;
  d.host = { wallId, t };
  return d;
}

function twoRoomsWithPartition() {
  const p = createProject('ручная');
  const a = createRoom('living', 0, 0, 6000, 4000);
  a.id = 'A';
  p.rooms.push(a);
  const w = addManualWall(p, { x: 3000, y: 0 }, { x: 3000, y: 4000 });
  return { p, w };
}

test('ось: свободный угол, орто по запросу и длина не короче 100 мм', () => {
  assert.deepEqual(orthoPoint({ x: 0, y: 0 }, { x: 1000, y: 300 }), { x: 1000, y: 0 });
  assert.deepEqual(orthoPoint({ x: 0, y: 0 }, { x: 100, y: -900 }), { x: 0, y: -900 });
  assert.equal(wallAxisVerdict({ x: 0, y: 0 }, { x: 1000, y: 10 }).ok, true);
  assert.equal(wallAxisVerdict({ x: 0, y: 0 }, { x: 50, y: 0 }).ok, false);
  assert.equal(wallAxisVerdict({ x: 0, y: 0 }, { x: 0, y: 500 }).ok, true);
});

test('проект с ручной стеной идёт на v2, стена — запись manual с телом по оси', () => {
  const { p, w } = twoRoomsWithPartition();
  assert.equal(wallsEngine(p), 'v2');
  const walls = deriveWalls(p);
  const m = walls.find((x) => x.kind === 'manual');
  assert.ok(m);
  assert.equal(m.key, `m|${w.id}`);
  assert.equal(m.wallId, w.id);
  assert.deepEqual(m.band, { x: 2950, y: 0, w: 100, h: 4000 });
  assert.ok(m.rects.length > 0);
  // Комнатные стены не вычитаются ручной: верхняя наружная стена цела.
  const top = walls.filter((x) => x.kind === 'own' && x.orient === 'h' && x.edge === 0);
  assert.ok(top.length);
});

test('косая стена получает точный полигон на плане и тело в 3D', () => {
  const p = createProject('косая');
  const w = addManualWall(p, { x: 0, y: 0 }, { x: 3000, y: 2000 }, { thickness: 200 });
  const rec = deriveWalls(p).find((entry) => entry.wallId === w.id);
  assert.equal(rec.orient, 'a');
  assert.equal(rec.poly.length, 4);
  assert.equal(wallContains(rec, { x: 1500, y: 1000 }), true);
  assert.equal(wallContains(rec, { x: 1500, y: 1600 }), false, 'не используется прямоугольный band');
  const mesh = buildHouseMesh(p, { site: false, roof: false });
  assert.ok(mesh.some((face) => face.ref?.key === rec.key), 'полигон выдавлен в 3D');
});

test('стена, начерченная внутри помещения, становится его частью и едет вместе с ним', () => {
  const p = createProject('владелец стены');
  const room = createRoom('living', 1000, 2000, 5000, 4000);
  p.rooms.push(room);
  const wall = addManualWall(p, { x: 2000, y: 3000 }, { x: 5000, y: 3000 });
  assert.equal(wall.ownerRoomId, room.id);
  moveRoomBy(p, room.id, 700, -300);
  assert.deepEqual(wall.axis, {
    kind: 'line', a: { x: 2700, y: 2700 }, b: { x: 5700, y: 2700 },
  });
  const copy = deserializeProject(serializeProject(p));
  assert.equal(copy.walls[0].ownerRoomId, room.id, 'связь переживает сохранение');
});

test('привязка по грани: тело по одну сторону оси, смена привязки не двигает тело', () => {
  const p = createProject('x');
  const w = addManualWall(p, { x: 0, y: 0 }, { x: 3000, y: 0 }, { thickness: 200, justify: 'left' });
  // a→b вправо, левая грань на оси (y=0), тело справа (вниз, +y).
  let m = deriveWalls(p).find((x) => x.kind === 'manual');
  assert.deepEqual(m.band, { x: 0, y: 0, w: 3000, h: 200 });
  setManualWallJustify(p, w.id, 'center');
  m = deriveWalls(p).find((x) => x.kind === 'manual');
  assert.deepEqual(m.band, { x: 0, y: 0, w: 3000, h: 200 });
  assert.equal(w.axis.a.y, 100);
});

test('сдвиг, перенос торца, толщина, класс, высота', () => {
  const p = createProject('x');
  const h = addManualWall(p, { x: 0, y: 0 }, { x: 4000, y: 0 });
  const v = addManualWall(p, { x: 2000, y: 0 }, { x: 2000, y: 3000 }); // торец на теле h
  assert.equal(moveManualWall(p, h.id, -500).ok, true);
  assert.equal(h.axis.a.y, -500);
  assert.equal(v.axis.a.y, -500, 'примыкающая стена едет торцом вместе');
  assert.equal(v.axis.b.y, 3000);
  // Через общий moveWallBy (как на плане).
  const rec = deriveWalls(p).find((x) => x.wallId === h.id);
  assert.equal(moveWallBy(p, rec, 500).ok, true);
  assert.equal(h.axis.a.y, 0);

  assert.equal(dragManualWallEnd(p, h.id, 'b', { x: 5000, y: 777 }).ok, true);
  assert.deepEqual(h.axis.b, { x: 5000, y: 777 }, 'торец следует за свободным курсором');
  assert.equal(dragManualWallEnd(p, h.id, 'b', { x: 50, y: 0 }).ok, false, 'короче минимума');
  assert.equal(dragManualWallEnd(p, h.id, 'b', { x: -2000, y: 0 }).ok, true, 'свободный разворот допустим');

  assert.equal(setManualWallThickness(p, h.id, 9999).thickness, 600);
  setManualWallThickness(p, h.id, 100);
  assert.equal(setManualWallKind(p, h.id, 'bearing').thickness, 200, 'толщина класса, т. к. своя не задавалась');
  const rec2 = deriveWalls(p).find((x) => x.wallId === h.id);
  assert.equal(setWallKind(p, rec2, 'exterior').ok, true);
  assert.equal(h.wallType, 'exterior');

  setWallHeight(p, rec2, { height: 1200 });
  const z = deriveWalls(p).find((x) => x.wallId === h.id);
  assert.equal(z.z1 - z.z0, 1200);
  // Стена комнаты — в wallOverrides.
  setWallHeight(p, 'e|r|0', { height: 2500 });
  assert.equal(p.wallOverrides['e|r|0'].top.height, 2500);
});

test('проём на ручной стене: прямоугольник, створка, зажим, соседи, связь помещений', () => {
  const { p, w } = twoRoomsWithPartition();
  // a=(3000,0) → b=(3000,4000): t от верха.
  const d = hostDoor(w.id, 2000);
  p.openings.push(d);
  const walls = deriveWalls(p);
  const placed = openingRect(p, d, walls);
  assert.deepEqual(placed.rect, { x: 2950, y: 1550, w: 100, h: 900 });
  assert.equal(placed.wall.kind, 'manual');
  const sym = doorSymbol(p, d, walls);
  assert.ok(sym, 'символ двери строится');
  // a→b вниз: «слева» — +x; swingIn открывает в +x.
  assert.ok(sym.open.x > 3000);
  assert.equal(clampOpeningOffset(p, d, walls, 50), 500);
  assert.equal(clampOpeningOffset(p, d, walls, 99999), 3500);
  // Обе стороны стены — одна комната «A» (перегородка ещё не делит помещение).
  assert.deepEqual(doorLink(p, d, walls), ['A', 'A']);
  const d2 = hostDoor(w.id, 2100);
  p.openings.push(d2);
  const res = resolveOpeningConflicts(p, walls);
  assert.equal(res.dropped.length, 0);
  assert.ok(Math.abs(d2.host.t - d.host.t) >= 900 + 100, 'раздвинуты с зазором');
  assert.equal(fitOpeningOffset(p, d2, walls, d2.host.t), d2.host.t);
});

test('проём остаётся на месте в мире при переносе начала оси; удаление стены удаляет проёмы', () => {
  const { p, w } = twoRoomsWithPartition();
  const d = hostDoor(w.id, 2000);
  p.openings.push(d);
  dragManualWallEnd(p, w.id, 'a', { x: 3000, y: 500 });
  assert.equal(d.host.t, 1500);
  assert.equal(openingRect(p, d, deriveWalls(p)).rect.y, 1550);
  assert.equal(removeManualWall(p, w.id), true);
  assert.equal(p.openings.length, 0);
  assert.equal(p.walls.length, 0);
});

test('сохранение/открытие: стены и host-проём целы, формат 7', () => {
  const { p, w } = twoRoomsWithPartition();
  p.openings.push(hostDoor(w.id, 1000));
  const text = serializeProject(p);
  assert.equal(JSON.parse(text).schema, 'kepler-plan/7');
  const q = deserializeProject(text);
  assert.equal(q.walls.length, 1);
  assert.deepEqual(q.openings[0].host, { wallId: w.id, t: 1000 });
  assert.ok(openingRect(q, q.openings[0], deriveWalls(q)));
});

test('потребители: 3D, IFC, DXF, JSON выводят ручную стену и её проём', () => {
  const { p, w } = twoRoomsWithPartition();
  p.openings.push(hostDoor(w.id, 2000));
  const ifc = buildIfc(p);
  assert.equal(ifc.counts.walls, 5, '4 наружные + ручная');
  assert.equal(ifc.counts.doors, 1);
  // Тело ручной стены 100×4000 (x 2950…3050, y 0…4000; в IFC y вверх):
  // в v2 — многоугольный профиль по контуру.
  const defs = new Map([...ifc.text.matchAll(/^(#\d+)=(.*);$/gm)].map((m) => [m[1], m[2]]));
  const refs = (id) => [...defs.get(id).matchAll(/#\d+/g)].map((m) => m[0]);
  const manualId = [...defs.entries()].find(([, b]) => b.startsWith('IFCWALL(') && b.includes(stepString('Стена (ручная)')))[0];
  const solids = refs(refs(refs(manualId).at(-1)).at(-1)).slice(1);
  assert.equal(solids.length, 1, 'одно тело');
  const profile = defs.get(refs(solids[0])[0]);
  assert.ok(profile.startsWith('IFCARBITRARYCLOSEDPROFILEDEF'), profile);
  const pts = refs(/#\d+/.exec(profile)[0]).slice(0, -1).map((id) => /\(\(([^)]*)\)\)/.exec(defs.get(id))[1].split(',').map(Number));
  const xs = pts.map((q) => q[0]); const ys = pts.map((q) => q[1]);
  assert.deepEqual([pts.length, Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)], [4, 2950, 3050, -4000, 0]);
  const json = buildStructuredExport(p);
  const lvl = json.levels ? json.levels[0] : json;
  const mw = lvl.walls.find((x) => x.source === 'manual');
  assert.ok(mw, 'стена в JSON');
  assert.equal(mw.wall_id, w.id);
  assert.deepEqual(mw.axis, { a: { x: 3000, y: 0 }, b: { x: 3000, y: 4000 } });
  assert.ok(lvl.openings.some((o) => o.host?.wall_id === w.id && o.center));
  const ents = planEntities(p);
  // DXF v2: ось ручной стены — на слое осей, грани (2950 и 3050) — в контуре стен.
  assert.ok(ents.some((e) => e.layer === 'axes' && e.x1 === 3000 && e.x2 === 3000 && Math.abs(e.y2 - e.y1) === 4000));
  for (const x of [2950, 3050]) {
    assert.ok(ents.some((e) => e.type === 'line' && e.layer === 'walls' && e.x1 === x && e.x2 === x && Math.abs(e.y2 - e.y1) > 3000), `грань ${x}`);
  }
  const faces = buildHouseMesh(p);
  assert.ok(faces.some((f) => f.kind === 'wall' && f.pts.some((pt) => Math.abs(pt.x - 2950) < 1)), '3D-тело стены');
});
