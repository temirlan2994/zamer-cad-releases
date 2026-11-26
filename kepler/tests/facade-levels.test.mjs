import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createLevel, createProject, createRoom } from '../core/model.js';
import { createFacadeElement, facadeParts } from '../core/facade.js';
import { createMass } from '../core/masses.js';
import { buildHouseMesh, facadeLevelBounds, massFaces } from '../core/mesh3d.js';
import { pickFaces, pickObject } from '../core/pick3d.js';

function house(kind = 'slats') {
  const p = createProject(); const lower = p.levels[0]; lower.height = 3000;
  lower.rooms.push(createRoom('living', 0, 0, 5000, 4000));
  const upper = createLevel('2 этаж', 3000, 3000);
  upper.rooms.push(createRoom('living', 0, 0, 5000, 4000)); p.levels.push(upper);
  const m = createFacadeElement(kind, { point: { x: 2500, y: -250, z: 1500 }, normal: { x: 0, y: -1 }, level: lower, from: 0, to: 5000 });
  Object.assign(m, { w: 1050, z0: -250, h: 6250 }); p.masses = [m];
  return { p, m, lower, upper };
}

for (const kind of ['slats', 'stone', 'band', 'canopy', 'light']) test(`${kind}: текущий этаж обрезает фасад, «все этажи» восстанавливает полную высоту`, () => {
  const { p, m, lower, upper } = house(kind); const before = JSON.stringify(p);
  const z = (mode) => buildHouseMesh(p, { levels: mode, facades: true }).filter((f) => f.massId === m.id).flatMap((f) => f.pts.map((v) => v.z));
  for (const mode of ['only', 'upto']) {
    assert.equal(Math.max(...z(mode)), 3000);
    assert.ok(Math.min(...z(mode)) >= -250);
  }
  p.activeLevel = upper.id;
  assert.ok(Math.min(...z('only')) >= 3000);
  assert.ok(Math.max(...z('only')) <= 6000);
  assert.ok(Math.min(...z('upto')) < 3000);
  p.activeLevel = lower.id;
  assert.equal(Math.max(...z('all')), Math.max(...facadeParts(m).map((part) => part.z1)));
  assert.equal(JSON.stringify(p), before, 'режим вида не изменяет размеры в файле');
});

test('скрытый фрагмент не выбирается лучом; обычные концептуальные массы сохраняют высоту', () => {
  const { p, m } = house();
  const part = facadeParts(m)[0];
  const ray = { o: { x: (part.x0 + part.x1) / 2, y: -2000, z: 4500 }, d: { x: 0, y: 1, z: 0 } };
  assert.equal(pickObject({ faces: pickFaces(buildHouseMesh(p, { levels: 'only' })) }, ray), null);
  assert.equal(pickObject({ faces: pickFaces(buildHouseMesh(p)) }, ray)?.id, m.id);
  const ordinary = createMass({ x: 10000, y: 0, h: 9000 }); p.masses.push(ordinary);
  const mesh = buildHouseMesh(p, { levels: 'only', masses: true });
  assert.equal(Math.max(...mesh.filter((f) => f.massId === ordinary.id).flatMap((f) => f.pts.map((v) => v.z))), 9000);
});

test('быстрая пересборка масс и полная сцена используют одинаковое отсечение', () => {
  const { p, m } = house();
  const fast = massFaces([m], { facadeClip: facadeLevelBounds(p, 'only') });
  const full = buildHouseMesh(p, { levels: 'only' }).filter((f) => f.massId === m.id);
  assert.deepEqual(fast, full);
  assert.ok(fast.some((f) => f.normal.z > .9 && f.pts.every((v) => v.z === 3000)), 'срез закрыт верхними гранями');
});
