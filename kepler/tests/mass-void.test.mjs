import test from 'node:test';
import assert from 'node:assert/strict';

import { area } from '../core/geom/poly.js';
import {
  createMass, createMassVoid, massSketch, normalizeMassVoids, solidMasses, voidMasses,
} from '../core/masses.js';
import { buildHouseMesh, massFaces } from '../core/mesh3d.js';
import { pickBoxes } from '../core/pick3d.js';
import {
  createLevel, createProject, createRoom, deserializeProject, hasContent, serializeProject,
} from '../core/model.js';
import { buildStructuredExport } from '../core/export.js';
import { roomNetAreaM2 } from '../core/rooms.js';

const span = (f, axis) => [Math.min(...f.pts.map((p) => p[axis])), Math.max(...f.pts.map((p) => p[axis]))];
const horizontalCovers = (f, x, y, z) => {
  if (Math.abs(f.normal.z) < 0.5 || Math.abs(f.pts[0].z - z) > 0.6) return false;
  const [x0, x1] = span(f, 'x'); const [y0, y1] = span(f, 'y');
  return x > x0 + 0.1 && x < x1 - 0.1 && y > y0 + 0.1 && y < y1 - 0.1;
};

test('massVoids: нормализация, отдельное хранение и экспорт', () => {
  assert.deepEqual(normalizeMassVoids('x'), []);
  const list = normalizeMassVoids([
    { id: 'same', x: 0, y: 0, w: 2000, d: 3000, z0: 100, h: 2000 },
    { id: 'same', x: 0, y: 0, w: 2000, d: 3000, h: 2000 },
    { x: 'bad' },
  ]);
  assert.equal(list.length, 2);
  assert.ok(list.every((m) => m.id.startsWith('void-')));
  assert.notEqual(list[0].id, list[1].id);
  const p = createProject('void');
  p.massVoids = [createMassVoid({ x: 1000, y: 2000, w: 3000, d: 2000, z0: 500, h: 2500 })];
  assert.ok(hasContent(p));
  const back = deserializeProject(serializeProject(p));
  assert.deepEqual(back.massVoids, p.massVoids);
  assert.equal(solidMasses(back).length, 0);
  assert.equal(voidMasses(back).length, 1);
  assert.deepEqual(buildStructuredExport(back).mass_voids, p.massVoids);
});

test('эскиз: полая масса вычитает отверстие из solid-контура', () => {
  const solid = createMass({ x: 5000, y: 5000, w: 10000, d: 10000, h: 3000 });
  const cut = createMassVoid({ x: 5000, y: 5000, w: 4000, d: 4000, h: 3000 });
  const sketch = massSketch([solid], { elevation: 0, height: 3000 }, [cut]);
  assert.equal(sketch.voidRects.length, 1);
  assert.equal(sketch.outline.length, 1);
  assert.equal(sketch.outline[0].length, 2, 'наружный контур + отверстие');
  assert.equal(area(sketch.outline), 84_000_000);
});

test('3D массы: сквозной cutter оставляет внутренние торцы и не закрывает центр', () => {
  const solid = createMass({ x: 5000, y: 5000, w: 10000, d: 10000, h: 3000 });
  const cut = createMassVoid({ x: 5000, y: 5000, w: 4000, d: 4000, h: 3000 });
  const faces = massFaces([solid], { voids: [cut] });
  assert.ok(faces.length > 6);
  assert.ok(!faces.some((f) => horizontalCovers(f, 5000, 5000, 3000)), 'верх над пустотой удалён');
  assert.ok(faces.some((f) => Math.abs(f.normal.x) > 0.5 && span(f, 'x')[0] === 3000), 'есть внутренний вертикальный торец');
  assert.ok(faces.every((f) => f.massId === solid.id && f.kind === 'mass'));
});

test('void режет пол, межэтажную плиту и стены по своему диапазону Z', () => {
  const p = createProject('дом с пустотой');
  p.rooms.push(createRoom('living', 0, 0, 6000, 6000));
  const l2 = createLevel('2 этаж', 3000, 3000, 'L2');
  l2.rooms.push(createRoom('hall', 0, 0, 6000, 6000));
  p.levels.push(l2);
  // Один cutter проходит сквозь плиту и пол L2, второй — через наружную стену L1.
  const vertical = createMassVoid({ x: 3000, y: 3000, w: 1600, d: 1600, z0: 2700, h: 800 });
  const wallCut = createMassVoid({ x: 0, y: 1000, w: 1200, d: 1200, z0: 500, h: 1800 });
  p.massVoids = [vertical, wallCut];
  const faces = buildHouseMesh(p);
  const floors2 = faces.filter((f) => f.kind === 'floor' && f.level === 'L2');
  assert.ok(!floors2.some((f) => horizontalCovers(f, 3000, 3000, 3001)), 'пол второго этажа вырезан');
  const slabs = faces.filter((f) => f.kind === 'slab');
  assert.ok(!slabs.some((f) => horizontalCovers(f, 3000, 3000, 2999)), 'верх плиты вырезан');
  assert.ok(slabs.some((f) => Math.abs(f.normal.x) + Math.abs(f.normal.y) > 0.5 && span(f, 'z')[0] < 3000), 'у плиты есть внутренний торец');
  const wallFaces = faces.filter((f) => f.kind === 'wall');
  assert.ok(wallFaces.some((f) => f.normal.z < -0.5 && Math.abs(f.pts[0].z - 2300) < 1), 'над void есть нижний откос стены');
  assert.ok(!pickBoxes(p).openings.some((o) => o.id === wallCut.id), 'cutter не маскируется под дверь/окно для 3D-выбора');
});

test('void, не доходящий до поверхности, делает нишу, но не дырку сверху', () => {
  const p = createProject('ниша');
  p.rooms.push(createRoom('living', 0, 0, 6000, 6000));
  const l2 = createLevel('2 этаж', 3000, 3000, 'L2');
  l2.rooms.push(createRoom('hall', 0, 0, 6000, 6000));
  p.levels.push(l2);
  p.massVoids = [createMassVoid({ x: 3000, y: 3000, w: 1200, d: 1200, z0: 2820, h: 80 })];
  const slabs = buildHouseMesh(p).filter((f) => f.kind === 'slab');
  assert.ok(slabs.some((f) => horizontalCovers(f, 3000, 3000, 2999)), 'верх плиты остаётся');
  assert.ok(slabs.some((f) => f.normal.z < -0.5 && Math.abs(f.pts[0].z - 2920) < 1), 'внутри плиты есть потолок ниши');
});

test('void через пол уменьшает расчётную площадь комнаты так же, как 3D-пол', () => {
  const p = createProject('площадь с пустотой');
  const room = createRoom('living', 0, 0, 6000, 6000);
  p.rooms.push(room);
  p.massVoids = [createMassVoid({ x: 3000, y: 3000, w: 2000, d: 2000, z0: 0, h: 1000 })];
  assert.equal(roomNetAreaM2(p, room), 32);
  const floor = buildHouseMesh(p).filter((f) => f.kind === 'floor');
  assert.ok(!floor.some((f) => horizontalCovers(f, 3000, 3000, 1)));
});
