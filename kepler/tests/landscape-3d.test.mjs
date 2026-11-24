// Ландшафт в 3D (core/mesh3d-landscape.js): формы, высоты, рельеф, переключатель.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLandscapeObject, hitLandscape, resizeObject, rotateObjectAbout, searchLandscape, steppingSlabs, translateObject } from '../core/landscape.js';
import { landscapeFaces, offsetPolygon, triangulate } from '../core/mesh3d-landscape.js';
import { buildHouseMesh } from '../core/mesh3d.js';
import { createProject, deserializeProject, serializeProject } from '../core/model.js';

const project = (...objects) => {
  const p = createProject();
  p.site.landscape.objects.push(...objects);
  return p;
};
const zs = (faces) => faces.flatMap((f) => f.pts.map((q) => q.z));
const xs = (faces) => faces.flatMap((f) => f.pts.map((q) => q.x));

test('триангуляция невыпуклого контура: площадь сохраняется', () => {
  const L = [{ x: 0, y: 0 }, { x: 4000, y: 0 }, { x: 4000, y: 1000 }, { x: 1000, y: 1000 }, { x: 1000, y: 3000 }, { x: 0, y: 3000 }];
  const tris = triangulate(L);
  assert.equal(tris.length, 4);
  const area = tris.reduce((s, [a, b, c]) => s + Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)) / 2, 0);
  assert.equal(area, 6e6);
  const big = offsetPolygon([{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 1000, y: 1000 }, { x: 0, y: 1000 }], 100);
  assert.deepEqual(big.map((p) => [Math.round(p.x), Math.round(p.y)]), [[-100, -100], [1100, -100], [1100, 1100], [-100, 1100]]);
});

test('водная завеса: выбор, поворот, перемещение и сохранение размеров камня и струи', () => {
  assert.ok(searchLandscape('водопад').some((def) => def.kind === 'water-curtain'));
  const object = createLandscapeObject('water-curtain', 1200, 4000, { height: 3100, variant: 'limestone' });
  resizeObject(object, 4400, 800);
  rotateObjectAbout(object, object.x, object.y, 90);
  translateObject(object, 800, 1000);
  const p = deserializeProject(serializeProject(project(object)));
  const saved = p.site.landscape.objects[0];
  assert.deepEqual([saved.x, saved.y, saved.rotation, saved.w, saved.h, saved.height, saved.variant],
    [2000, 5000, 90, 4400, 800, 3100, 'limestone']);
  assert.equal(hitLandscape([saved], { x: 2000, y: 6500 })?.id, saved.id);
  const faces = landscapeFaces(p, () => 350);
  assert.ok(faces.every((f) => f.landscapeId === object.id));
  assert.equal(Math.max(...zs(faces)), 3450);
  const water = faces.filter((f) => f.kind === 'landscape-water');
  const curtain = water.find((f) => Math.abs(f.normal.x) > 0.99);
  assert.ok(curtain && Math.max(...zs([curtain])) - Math.min(...zs([curtain])) > 2800);
  const ys = curtain.pts.map((pt) => pt.y);
  assert.ok(Math.max(...ys) - Math.min(...ys) > 4100);
  assert.ok(water.some((f) => Math.abs(f.normal.z) > 0.99));
});

test('дерево: ствол и крона, верх кроны — на высоте дерева, центр — где стоит', () => {
  const oak = createLandscapeObject('tree-oak', 5000, 3000, { id: 'ls-oak-3d', height: 12000 });
  const f = landscapeFaces(project(oak));
  assert.ok(f.length >= 40 && f.length <= 80, String(f.length));
  assert.ok(f.every((face) => face.landscapeId === oak.id), 'каждая грань выбирает своё дерево');
  assert.ok(Math.abs(Math.max(...zs(f)) - 12000) < 1, 'верх кроны');
  assert.equal(Math.min(...zs(f)), 0, 'ствол от земли');
  const x = xs(f);
  assert.ok(Math.abs((Math.max(...x) + Math.min(...x)) / 2 - 5000) < 400);
  assert.ok(f.some((x2) => x2.color === '#6b4a33'), 'ствол');
  // Ель — конус: вершина в одной точке.
  const spruce = landscapeFaces(project(createLandscapeObject('tree-spruce', 0, 0)));
  const top = spruce.flatMap((x2) => x2.pts).filter((q) => q.z === Math.max(...zs(spruce)));
  assert.ok(top.every((q) => q.x === 0 && q.y === 0));
});

test('покрытия плоские у земли, настил — с толщиной, плиты-ступени — по одной призме', () => {
  const lawn = createLandscapeObject('lawn-area', 0, 0, { points: [{ x: 0, y: 0 }, { x: 4000, y: 0 }, { x: 4000, y: 3000 }, { x: 0, y: 3000 }] });
  const fl = landscapeFaces(project(lawn));
  assert.equal(fl.length, 2);
  assert.ok(zs(fl).every((z) => z < 0 && z > -5), 'газон ниже пола дома, над землёй');
  const deck = createLandscapeObject('deck-area', 0, 0, { points: [{ x: 0, y: 0 }, { x: 4000, y: 0 }, { x: 4000, y: 3000 }, { x: 0, y: 3000 }] });
  assert.equal(Math.max(...zs(landscapeFaces(project(deck)))), 300);
  const path = createLandscapeObject('path', 0, 0, { points: [{ x: 0, y: 0 }, { x: 8000, y: 0 }], variant: 'stepping', width: 900 });
  const fp = landscapeFaces(project(path));
  assert.equal(fp.length, steppingSlabs(path).length * 6, 'верх 2 треугольника + 4 бока');
  assert.equal(Math.max(...zs(fp)), 40);
});

test('бассейн: кайма и вода; пруд — вода и камни берега; беседка — крыша над столбами', () => {
  const pool = landscapeFaces(project(createLandscapeObject('pool', 0, 0)));
  assert.ok(pool.some((f) => f.kind === 'landscape-water' && f.pts.every((q) => q.z === 45)));
  assert.ok(pool.some((f) => f.color === '#e6e1d6'), 'кайма');
  const pond = landscapeFaces(project(createLandscapeObject('pond-area', 0, 0, {
    smooth: true, points: [{ x: 0, y: 0 }, { x: 4000, y: 0 }, { x: 4000, y: 3000 }, { x: 0, y: 3000 }],
  })));
  assert.ok(pond.filter((f) => f.kind === 'landscape-water').length >= 3);
  assert.ok(pond.length > 60, 'камни по берегу');
  const gazebo = landscapeFaces(project(createLandscapeObject('gazebo', 0, 0, { height: 3200 })));
  assert.equal(Math.max(...zs(gazebo)), 3200);
  assert.ok(gazebo.filter((f) => f.pts.length === 4 && Math.min(...f.pts.map((q) => q.z)) === 0).length >= 16, '4 столба');
});

test('в модели участка: по рельефу, в осях дома, отключается флажком', () => {
  const p = project(createLandscapeObject('tree-pine', 10000, 0), createLandscapeObject('parking-1', 0, 8000));
  p.building = { origin: { x: 10000, y: 0 }, rotation: 90 };
  const f = landscapeFaces(p);
  const tree = f.filter((x) => x.color === '#6b4a33');
  const cx = (Math.max(...xs(tree)) + Math.min(...xs(tree))) / 2;
  assert.ok(Math.abs(cx) < 1, 'дерево в начале осей дома');
  // Рельеф: всё поднимается на hz.
  const lifted = landscapeFaces(p, () => 1000);
  assert.equal(Math.min(...zs(lifted)), 1000 + Math.min(...zs(f)));
  const on = buildHouseMesh(p, { site: true });
  const off = buildHouseMesh(p, { site: true, landscape: false });
  assert.ok(off.some((face) => face.kind === 'ground'), 'сад получает основание и до добавления дома или границы');
  assert.equal(on.length - off.length, f.length);
  assert.equal(buildHouseMesh(p).length, buildHouseMesh(p, { landscape: true }).length, 'без участка — без ландшафта');
  // Разметка парковки — белые полосы.
  assert.equal(f.filter((x) => x.color === '#f4f4f0').length, 4);
});
