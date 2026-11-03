// Свободные стены и колонны: 3D, DXF, JSON, проходы.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createProject, createRoom, createOpening, createItem } from '../core/model.js';
import { buildHouseMesh, structuralOutline } from '../core/mesh3d.js';
import { buildProjectDxf, buildStructuredExport } from '../core/export.js';
import { furnitureIssues } from '../core/clearance.js';
import { deriveWalls } from '../core/walls.js';
import { isStructural } from '../core/catalog.js';

function hall() {
  const p = createProject();
  const r = createRoom('living', 0, 0, 8000, 6000);
  p.rooms.push(r);
  p.openings.push(createOpening('door', r.id, 2, 4000, 900));
  p.items.push(
    createItem('wall-free', 4000, 2000, 3000, 120, 90),
    createItem('column', 2000, 4000, 400, 400),
    createItem('column-round', 6000, 4000, 400, 400),
  );
  return { p, r };
}
const count = (dxf, name) => dxf.split('\n').filter((l, i, a) => l === name && a[i - 1] === '0').length;

test('конструкции отмечены в каталоге', () => {
  assert.equal(isStructural('wall-free'), true);
  assert.equal(isStructural('column'), true);
  assert.equal(isStructural('sofa'), false);
});

test('контур: повёрнутая стена и 12-угольник колонны', () => {
  const wall = structuralOutline({ kind: 'wall-free', x: 0, y: 0, w: 3000, h: 120, rotation: 90 });
  const xs = wall.map((p) => Math.round(p.x));
  const ys = wall.map((p) => Math.round(p.y));
  assert.deepEqual([Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)], [-60, 60, -1500, 1500]);
  assert.equal(structuralOutline({ kind: 'column-round', x: 0, y: 0, w: 400, h: 400 }).length, 12);
});

test('3D: стены и колонны на всю высоту этажа', () => {
  const { p } = hall();
  const walls = buildHouseMesh(p).filter((f) => f.kind === 'wall' && f.normal.z === 1 && f.pts[0].z === 3000);
  // Верх: 4 стены комнаты + 3 конструкции.
  assert.ok(walls.length >= 7);
});

test('DXF: стена — линии стены, круглая колонна — окружность; JSON — отдельно от мебели', () => {
  const { p } = hall();
  const dxf = buildProjectDxf(p);
  assert.equal(count(dxf, 'CIRCLE'), 1);
  const lvl = buildStructuredExport(p).levels[0];
  assert.equal(lvl.furniture.length, 0);
  assert.equal(lvl.free_walls.length, 1);
  assert.deepEqual(lvl.free_walls[0].from, { x: 4000, y: 500 });
  assert.equal(lvl.free_walls[0].thickness, 120);
  assert.deepEqual(lvl.columns.map((c) => c.shape), ['rect', 'round']);
});

test('проходы: к колонне идти не нужно, но мебель с ней пересекается', () => {
  const { p, r } = hall();
  const kinds = furnitureIssues(p, r, deriveWalls(p)).map((i) => i.kind);
  assert.deepEqual(kinds, []);
  p.items.push(createItem('armchair', 2000, 4000, 900, 900)); // кресло в колонне
  assert.ok(furnitureIssues(p, r, deriveWalls(p)).some((i) => i.kind === 'overlap'));
});
