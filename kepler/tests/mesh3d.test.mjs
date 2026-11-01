// 3D-модель дома: стены с проёмами, полы этажей, крыша и участок.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createProject, createRoom, createOpening, createLevel } from '../core/model.js';
import { buildHouseMesh, boxFaces } from '../core/mesh3d.js';

const zRange = (f) => [Math.min(...f.pts.map((p) => p.z)), Math.max(...f.pts.map((p) => p.z))];

function oneRoom(kind) {
  const p = createProject();
  const room = createRoom('living', 0, 0, 4000, 3000);
  p.rooms.push(room);
  p.openings.push(createOpening(kind, room.id, 0, 2000, 1200)); // верхняя стена, по центру
  return p;
}

test('коробка: верх и четыре стороны, нормали наружу', () => {
  const f = boxFaces(0, 0, 10, 20, 0, 30, '#fff', 'wall');
  assert.equal(f.length, 5);
  assert.deepEqual(f.map((x) => [x.normal.x, x.normal.y, x.normal.z]), [[0, 0, 1], [0, -1, 0], [0, 1, 0], [-1, 0, 0], [1, 0, 0]]);
  assert.deepEqual(boxFaces(0, 0, 0, 10, 0, 10), [], 'вырожденная — пусто');
});

test('окно режет стену: подоконник, перемычка и стекло', () => {
  const faces = buildHouseMesh(oneRoom('window'));
  const glass = faces.filter((f) => f.kind === 'glass');
  assert.equal(glass.length, 1);
  assert.deepEqual(zRange(glass[0]), [900, 2400]); // подоконник 900 + высота 1500
  // Над окном (x 1400…2600) есть кусок стены 2400…3000, под ним — 0…900.
  const over = faces.filter((f) => f.kind === 'wall' && f.normal.z === 1 && f.pts.every((p) => p.x >= 1399 && p.x <= 2601 && p.y <= 0));
  const tops = over.map((f) => f.pts[0].z).sort((a, b) => a - b);
  assert.deepEqual(tops, [900, 3000]);
});

test('дверь: проём до пола, только перемычка, без стекла', () => {
  const faces = buildHouseMesh(oneRoom('door'));
  assert.equal(faces.filter((f) => f.kind === 'glass').length, 0);
  const over = faces.filter((f) => f.kind === 'wall' && f.normal.z === 1 && f.pts.every((p) => p.x >= 1399 && p.x <= 2601 && p.y <= 0));
  assert.deepEqual(over.map((f) => f.pts[0].z), [3000], 'только перемычка над дверью');
});

test('этажи: полы на своих отметках, крыша над верхним, участок по желанию', () => {
  const p = createProject();
  p.rooms.push(createRoom('living', 0, 0, 5000, 4000));
  p.levels.push(createLevel('2 этаж', 3000, 2800, 'L2'));
  p.activeLevel = 'L2';
  p.rooms.push(createRoom('bedroom', 0, 0, 5000, 4000));
  const floors = buildHouseMesh(p).filter((f) => f.kind === 'floor').map((f) => f.pts[0].z);
  assert.deepEqual(floors, [1, 3001]);
  const roof = buildHouseMesh(p, { roof: true }).filter((f) => f.kind === 'roof');
  assert.ok(roof.length && roof.every((f) => zRange(f)[0] >= 5800));
  p.site.neighbors.push({ id: 'n', x: 20000, y: 0, w: 8000, h: 6000, height: 7000, rot: 30 });
  const site = buildHouseMesh(p, { site: true });
  assert.equal(site.filter((f) => f.kind === 'ground').length, 1);
  assert.equal(site.filter((f) => f.kind === 'neighbor').length, 5);
});
