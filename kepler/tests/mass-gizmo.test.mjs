// Гизмо и точки массы (core/mass-gizmo.js): размер за точку (центры граней
// и углы, минимум 300, противоположная грань стоит), перенос вдоль оси гизмо
// (проекция сдвига мыши), привязка сдвига, попадание в экранных координатах;
// подземная часть массы на рельефе (core/mass-ground.js) и высота земли.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  GIZMO_AXES, MASS_GRIP_MIN, MASS_HANDLES, gizmoOrigin, gizmoPick, handleFacing, handlePick, handlePoint,
  massHandle, moveAlongAxis, resizeByHandle, snapShift,
} from '../core/mass-gizmo.js';
import { massGroundFaces, massGroundSplit, massUnderground } from '../core/mass-ground.js';
import { createMass, massBox } from '../core/masses.js';
import { buildHouseMesh, terrainHeightFn } from '../core/mesh3d.js';
import { axisDelta, projectPoint } from '../core/pick3d.js';
import { createProject } from '../core/model.js';
import { normalizeTerrain } from '../core/terrain.js';

const box = (m) => { const b = massBox(m); return [b.x0, b.y0, b.z0, b.x1, b.y1, b.z1]; };
const M = () => createMass({ x: 4000, y: 2500, w: 8000, d: 5000, h: 3000 });

test('ручки: 6 центров граней и 8 углов, точки на габарите', () => {
  assert.equal(MASS_HANDLES.length, 14);
  assert.equal(MASS_HANDLES.filter((h) => h.face).length, 6);
  const b = massBox(M());
  assert.deepEqual(handlePoint(b, massHandle('px').s), { x: 8000, y: 2500, z: 1500 });
  assert.deepEqual(handlePoint(b, massHandle('top').s), { x: 4000, y: 2500, z: 3000 });
  assert.deepEqual(handlePoint(b, massHandle('cnpn').s), { x: 0, y: 5000, z: 0 });
  assert.deepEqual(gizmoOrigin(b), { x: 4000, y: 2500, z: 1500 });
  // Ось Y гизмо — «на север» плана (y дома вниз).
  assert.deepEqual(GIZMO_AXES.y, { x: 0, y: -1, z: 0 });
});

test('размер за центр грани: противоположная стоит, минимум 300', () => {
  const m = M();
  assert.deepEqual(box(resizeByHandle(m, massHandle('px').s, { x: 1000 })), [0, 0, 0, 9000, 5000, 3000]);
  assert.deepEqual(box(resizeByHandle(m, massHandle('nx').s, { x: -500 })), [-500, 0, 0, 8000, 5000, 3000]);
  assert.deepEqual(box(resizeByHandle(m, massHandle('py').s, { y: 1000 })), [0, 0, 0, 8000, 6000, 3000]);
  assert.deepEqual(box(resizeByHandle(m, massHandle('ny').s, { y: 99999 })), [0, 5000 - MASS_GRIP_MIN, 0, 8000, 5000, 3000]);
  assert.deepEqual(box(resizeByHandle(m, massHandle('top').s, { z: 1500 })), [0, 0, 0, 8000, 5000, 4500]);
  assert.deepEqual(box(resizeByHandle(m, massHandle('top').s, { z: -9000 })), [0, 0, 0, 8000, 5000, 300]);
  // Низ: вверх — высота меньше, верх стоит; вниз ниже 0 не уходит.
  const up = { ...m, z0: 3000 };
  assert.deepEqual(box(resizeByHandle(up, massHandle('bottom').s, { z: -1000 })), [0, 0, 2000, 8000, 5000, 6000]);
  assert.deepEqual(box(resizeByHandle(up, massHandle('bottom').s, { z: -9000 })), [0, 0, 0, 8000, 5000, 6000]);
  // Сдвиг по чужой оси центр грани не трогает.
  assert.deepEqual(box(resizeByHandle(m, massHandle('px').s, { y: 700, z: 900 })), [0, 0, 0, 8000, 5000, 3000]);
});

test('размер за угол: две смежные грани сразу, противоположный угол стоит', () => {
  const m = M();
  assert.deepEqual(box(resizeByHandle(m, massHandle('cppn').s, { x: 1000, y: 2000 })), [0, 0, 0, 9000, 7000, 3000]);
  assert.deepEqual(box(resizeByHandle(m, massHandle('cnnp').s, { x: 500, y: -1000 })), [500, -1000, 0, 8000, 5000, 3000]);
  const tiny = resizeByHandle(m, massHandle('cpnp').s, { x: -99999, y: 99999 });
  assert.deepEqual(box(tiny), [0, 4700, 0, 300, 5000, 3000]);
  // Повёрнутая масса: размеры — по осям дома.
  const r = { ...m, rotation: 90 };
  const rb = resizeByHandle(r, massHandle('px').s, { x: 1000 });
  assert.equal(massBox(rb).x1 - massBox(rb).x0, 6000);
  assert.equal(rb.d, 6000);
});

test('перенос вдоль оси гизмо: только эта координата; низ не ниже 0', () => {
  const m = M();
  const x = moveAlongAxis(m, 'x', 1200);
  assert.deepEqual([x.x, x.y, x.z0], [5200, 2500, 0]);
  const y = moveAlongAxis(m, 'y', 1000); // стрелка Y — на −y дома
  assert.deepEqual([y.x, y.y, y.z0], [4000, 1500, 0]);
  const z = moveAlongAxis(m, 'z', 2500);
  assert.deepEqual([z.x, z.y, z.z0, z.h], [4000, 2500, 2500, 3000]);
  assert.equal(moveAlongAxis(z, 'z', -9000).z0, 0);
});

test('проекция сдвига мыши на ось: стрелка X по экрану → смещение по x', () => {
  const cam = { yaw: -2.2, pitch: 0.62, dist: 25000, eyeDist: 50000, target: { x: 0, y: 0, z: 1500 } };
  const W = 1000; const H = 700;
  const o = projectPoint(cam, W, H, { x: 0, y: 0, z: 0 });
  for (const axis of ['x', 'y', 'z']) {
    const a = GIZMO_AXES[axis];
    const t = projectPoint(cam, W, H, { x: a.x * 2000, y: a.y * 2000, z: a.z * 2000 });
    // Мышь прошла ровно по экранному образу 2 м оси — смещение 2000 мм.
    const d = axisDelta(cam, W, H, a, t.x - o.x, t.y - o.y);
    assert.ok(Math.abs(d - 2000) < 1e-6, `${axis}: ${d}`);
    // Поперёк оси — ноль.
    const n = axisDelta(cam, W, H, a, -(t.y - o.y), t.x - o.x);
    assert.ok(Math.abs(n) < 1e-6);
  }
});

test('привязка сдвига: край к линии, иначе шаг; без шага — до мм', () => {
  assert.deepEqual(snapShift(0, 8000, 1490, [9500], 50, 100), { value: 1500, line: 9500 });
  assert.deepEqual(snapShift(0, 8000, -1030, [-1000], 50, 100), { value: -1000, line: -1000 });
  assert.deepEqual(snapShift(0, 8000, 1234, [], 50, 250), { value: 1250, line: null });
  assert.deepEqual(snapShift(0, 8000, 1234.4, [], 50, 0), { value: 1234, line: null });
});

test('попадание: точки раньше стрелок, невидимые — только без видимых рядом', () => {
  const scr = {
    origin: { x: 100, y: 100 },
    tips: { x: { x: 180, y: 120 }, y: { x: 160, y: 60 }, z: { x: 100, y: 16 } },
    plane: [{ x: 115, y: 100 }, { x: 130, y: 104 }, { x: 140, y: 92 }, { x: 125, y: 88 }],
  };
  assert.equal(gizmoPick(scr, { x: 178, y: 119 }), 'x');
  assert.equal(gizmoPick(scr, { x: 103, y: 30 }), 'z');
  assert.equal(gizmoPick(scr, { x: 128, y: 96 }), 'xy');
  assert.equal(gizmoPick(scr, { x: 300, y: 300 }), null);
  assert.equal(gizmoPick(scr, { x: 186, y: 140 }, 8), null);
  assert.equal(gizmoPick(scr, { x: 186, y: 140 }, 22), 'x', 'палец — шире');
  // Ось «в глаз» (короткая на экране) не ловится.
  assert.equal(gizmoPick({ ...scr, tips: { ...scr.tips, z: { x: 101, y: 95 } } }, { x: 101, y: 96 }), null);
  const list = [{ id: 'top', p: { x: 10, y: 10 }, back: false }, { id: 'bottom', p: { x: 12, y: 10 }, back: true }];
  assert.equal(handlePick(list, { x: 12, y: 10 }), 'top');
  assert.equal(handlePick(list.slice(1), { x: 12, y: 10 }), 'bottom');
  assert.equal(handlePick(list, { x: 40, y: 10 }), null);
  // Видимость: верх виден камере сверху, низ — нет.
  const f = { x: -0.5, y: 0.5, z: -0.7 };
  assert.equal(handleFacing(massHandle('top').s, f), true);
  assert.equal(handleFacing(massHandle('bottom').s, f), false);
});

// Рельеф: склон вдоль x — от −1 м до +2 м относительно пола (на ровном
// участке без дома пол — средняя отметка).
function slopeProject() {
  const p = createProject();
  const pts = [];
  for (const x of [-10000, 0, 10000, 20000]) for (const y of [-10000, 10000]) pts.push({ x, y, z: 100000 + x * 0.1 });
  p.site.terrain = normalizeTerrain({ points: pts, floorZ: 100000 });
  return p;
}

test('высота земли в точке (оси дома, от пола)', () => {
  const hz = terrainHeightFn(slopeProject());
  assert.ok(Math.abs(hz(0, 0)) < 1e-6);
  assert.ok(Math.abs(hz(5000, 3000) - 500) < 1e-6);
  assert.ok(Math.abs(hz(-10000, 0) + 1000) < 1e-6);
  assert.ok(Math.abs(terrainHeightFn(slopeProject(), 2)(5000, 0) - 1000) < 1e-6, 'усиление рельефа');
  assert.equal(terrainHeightFn(createProject()), null);
});

test('подземная часть: ровная земля — нет; склон — бока режутся по профилю', () => {
  const m = createMass({ x: 4000, y: 0, w: 8000, d: 4000, h: 3000 }); // x 0…8000
  assert.equal(massGroundSplit(massBox(m), () => 0).under.length, 0);
  assert.equal(massUnderground(m, () => -500), false);
  const hz = terrainHeightFn(slopeProject()); // земля 0 → 800 мм по x
  const split = massGroundSplit(massBox(m), hz);
  assert.ok(split.under.length > 0);
  // Все точки подземной части — не выше земли и в габарите массы.
  for (const f of split.under) {
    for (const p of f.pts) {
      assert.ok(p.z <= hz(p.x, p.y) + 1e-6, `точка ${JSON.stringify(p)} над землёй`);
      assert.ok(p.z >= -1e-6 && p.z <= 3000 + 1e-6);
    }
  }
  // Площадь подземной части бока px (x = 8000, земля 800): 4000 × 800.
  const px = split.under.filter((f) => f.normal.x === 1);
  const areaYZ = (P) => Math.abs(P.reduce((s, p, i) => { const q = P[(i + 1) % P.length]; return s + p.y * q.z - q.y * p.z; }, 0)) / 2;
  assert.ok(Math.abs(px.reduce((s, f) => s + areaYZ(f.pts), 0) - 4000 * 800) < 1);
  // Низ — под землёй (ячейки), ватерлиния — по бокам, выше низа.
  assert.ok(split.under.some((f) => f.normal.z === -1));
  assert.ok(split.line.length > 0);
  assert.ok(split.line.every(([a, b]) => a.z > 0 && b.z > 0));
  // Масса выше земли — не погружена; глубоко в земле — верх тоже.
  assert.equal(massUnderground({ ...m, z0: 1000 }, hz), false);
  const deep = massGroundSplit(massBox({ ...m, x: 15000, h: 300 }), hz);
  assert.ok(deep.under.some((f) => f.normal.z === 1));
});

test('сетка 3D: грани massUnder и massLine только со слоем «Участок» и рельефом', () => {
  const p = slopeProject();
  p.masses = [createMass({ x: 4000, y: 0, w: 8000, d: 4000, h: 3000 })];
  const on = buildHouseMesh(p, { site: true, masses: true });
  assert.ok(on.filter((f) => f.kind === 'massUnder' && f.pts.length).length > 0);
  assert.ok(on.some((f) => f.kind === 'massLine' && f.edges.length));
  assert.equal(buildHouseMesh(p, { site: false, masses: true }).filter((f) => f.kind === 'massUnder').length, 0);
  const flat = createProject();
  flat.masses = p.masses;
  assert.equal(buildHouseMesh(flat, { site: true, masses: true }).filter((f) => f.kind === 'massUnder').length, 0);
  assert.equal(massGroundFaces(p.masses, null).length, 0);
});
