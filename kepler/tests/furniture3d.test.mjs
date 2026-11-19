// 3D, срез 1: мебель в сетке (core/mesh3d.js furnitureFaces, высоты —
// core/furniture3d.js), фильтр этажей и выбор объектов лучом (core/pick3d.js
// pickObject): помещение, проём, мебель, лестница, стена — ближайшее побеждает.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createItem, createLevel, createOpening, createProject, createRoom } from '../core/model.js';
import { buildHouseMesh, shownLevelIds } from '../core/mesh3d.js';
import { furniture3d } from '../core/furniture3d.js';
import { compositeParts, withDefaultComp } from '../core/composite.js';
import { pickBoxes, pickFaces, pickObject } from '../core/pick3d.js';
import { buildElevation } from '../core/elevation.js';
import { buildSection } from '../core/section.js';

const xs = (faces) => faces.flatMap((f) => f.pts.map((p) => p.x));
const ys = (faces) => faces.flatMap((f) => f.pts.map((p) => p.y));
const zs = (faces) => faces.flatMap((f) => f.pts.map((p) => p.z));
const span = (a) => [Math.min(...a), Math.max(...a)];
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

function house() {
  const p = createProject('3d');
  const r = createRoom('living', 0, 0, 5000, 4000);
  r.id = 'R';
  p.rooms.push(r);
  return p;
}

test('мягкая кровать — основание, матрас, изголовье и подушки в одном габарите', () => {
  const p = house();
  const bed = createItem('bed-double', 2000, 1500, 1600, 2000);
  p.items.push(bed);
  const faces = buildHouseMesh(p, { furniture: true }).filter((f) => f.kind === 'furniture');
  assert.equal(faces.length, 25, 'пять отдельных объёмов по пять видимых граней');
  assert.ok(faces.every((f) => f.itemId === bed.id && f.level === p.activeLevel));
  assert.deepEqual(span(xs(faces)), [1200, 2800]);
  assert.deepEqual(span(ys(faces)), [500, 2500]);
  const [z0, z1] = span(zs(faces));
  assert.ok(z0 > 2 && z0 < 10, `низ над полом: ${z0}`);
  assert.ok(near(z1 - z0, furniture3d('bed-double').h), `высота ${z1 - z0}`);
  assert.equal(furniture3d('wardrobe').h, 2100);
  assert.equal(furniture3d('toilet').h, 420);
  assert.equal(furniture3d('hood').z0, 1700, 'вытяжка висит');
  assert.equal(furniture3d('unknown-kind').h, 800, 'неизвестный вид — по умолчанию');
});

test('стул: сиденье 450 и спинка у задней кромки (−Y) до полной высоты', () => {
  const p = house();
  p.items.push(createItem('chair', 1000, 1000, 450, 450));
  const tops = buildHouseMesh(p, { furniture: true }).filter((f) => f.kind === 'furniture' && f.normal.z === 1);
  assert.equal(tops.length, 2);
  const [seat, back] = tops.sort((a, b) => a.pts[0].z - b.pts[0].z);
  assert.ok(near(seat.pts[0].z - 3, 450) && near(back.pts[0].z - 3, 900), `${seat.pts[0].z} / ${back.pts[0].z}`);
  assert.deepEqual(span(ys([back])), [775, 835], 'спинка 60 мм у верхней кромки');
});

test('журнальная композиция в 3D — две отдельные столешницы разной высоты', () => {
  const p = house();
  p.items.push(createItem('coffee-table', 2000, 1500, 1250, 850));
  const tops = buildHouseMesh(p, { furniture: true })
    .filter((face) => face.kind === 'furniture' && face.normal.z === 1);
  assert.equal(tops.length, 2);
  assert.equal(new Set(tops.map((face) => face.pts[0].z)).size, 2);
  assert.ok(tops.every((face) => face.pts.length === 24), 'круглые столешницы без грубой квадратной коробки');
});

test('поворот 90°: ширина ложится вдоль Y', () => {
  const p = house();
  p.items.push(createItem('wardrobe', 2000, 2000, 1800, 600, 90));
  const faces = buildHouseMesh(p, { furniture: true }).filter((f) => f.kind === 'furniture');
  const [x0, x1] = span(xs(faces));
  const [y0, y1] = span(ys(faces));
  assert.ok(near(x1 - x0, 600, 1e-6) && near(y1 - y0, 1800, 1e-6), `${x1 - x0}×${y1 - y0}`);
  assert.ok(near(span(zs(faces))[1] - span(zs(faces))[0], 2100));
});

test('мебель — только по флажку; лестницы и колонны не дублируются; верх не выше перекрытия', () => {
  const p = house();
  p.items.push(createItem('stairs', 1000, 2000, 1000, 3000), createItem('column', 4000, 3000, 400, 400));
  p.items.push(createItem('gazebo', 2500, 2000, 3000, 3000));
  assert.equal(buildHouseMesh(p).filter((f) => f.kind === 'furniture').length, 0, 'по умолчанию мебели нет');
  const furn = buildHouseMesh(p, { furniture: true }).filter((f) => f.kind === 'furniture');
  assert.equal(new Set(furn.map((f) => f.itemId)).size, 1, 'только беседка');
  const level = p.levels[0];
  assert.ok(span(zs(furn))[1] <= level.height, 'не протыкает перекрытие');
});

test('составная мебель: стол со стульями, диван и кухня — коробками по частям', () => {
  const p = house();
  const table = withDefaultComp(createItem('dining-table', 2500, 2000, 1600, 900));
  const sofa = withDefaultComp(createItem('sofa-corner', 2500, 2000, 2600, 1600));
  const kitchen = withDefaultComp(createItem('kitchen-corner', 2500, 2000, 2400, 1800));
  p.items.push(table, sofa, kitchen);
  const faces = buildHouseMesh(p, { furniture: true }).filter((f) => f.kind === 'furniture');
  const count = (id) => faces.filter((f) => f.itemId === id && f.normal.z === 1).length;
  // Стул и сиденье дивана — две коробки: сиденье и спинка.
  const seated = (parts) => parts.filter((q) => q.kind === 'chair' || ['sofa:seat', 'sofa:chaise'].includes(q.kind)).length;
  const corners = (parts) => parts.filter((q) => q.kind === 'sofa:corner').length;
  assert.equal(count(table.id), 1 + compositeParts(table).length + seated(compositeParts(table)), 'столешница + стулья');
  const sp = compositeParts(sofa);
  assert.equal(count(sofa.id), sp.length + seated(sp) + 2 * corners(sp), 'диван — только модули');
  assert.equal(count(kitchen.id), compositeParts(kitchen).length, 'кухня — только части');
  // Верхние шкафы кухни висят: низ выше 1000 мм.
  const upper = compositeParts(kitchen).filter((q) => q.layer === 'upper').length;
  const hanging = faces.filter((f) => f.itemId === kitchen.id && f.normal.z === 1 && Math.min(...zs([f])) > 1000);
  assert.ok(upper > 0 && hanging.length >= upper);
});

test('этажи: мебель на отметке своего этажа; фильтр «до активного» и «только активный»', () => {
  const p = house();
  p.levels.push(createLevel('2 этаж', 3000, 2800, 'L2'));
  p.activeLevel = 'L2';
  const r2 = createRoom('bedroom', 0, 0, 5000, 4000);
  r2.id = 'R2';
  p.rooms.push(r2);
  p.items.push(createItem('bed-double', 2000, 2000, 1600, 2000));
  const all = buildHouseMesh(p, { furniture: true, roof: true });
  const bed = all.filter((f) => f.kind === 'furniture');
  assert.ok(span(zs(bed))[0] > 3000, 'кровать на 2 этаже');
  assert.deepEqual(shownLevelIds(p, 'all').length, 2);
  p.activeLevel = p.levels[0].id;
  assert.deepEqual(shownLevelIds(p, 'upto'), [p.levels[0].id]);
  const upto = buildHouseMesh(p, { furniture: true, roof: true, levels: 'upto' });
  assert.deepEqual([...new Set(upto.filter((f) => f.kind === 'floor').map((f) => f.level))], [p.levels[0].id]);
  assert.equal(upto.filter((f) => f.kind === 'furniture').length, 0, 'мебель 2 этажа скрыта');
  assert.equal(upto.filter((f) => f.kind === 'roof').length, 0, 'кровля скрыта вместе с верхним этажом');
  assert.equal(upto.filter((f) => f.kind === 'slab').length, 0, 'перекрытие под 2 этажом скрыто');
  p.activeLevel = 'L2';
  const only = buildHouseMesh(p, { furniture: true, levels: 'only' });
  assert.deepEqual([...new Set(only.filter((f) => f.kind === 'floor').map((f) => f.level))], ['L2']);
  assert.ok(only.some((f) => f.kind === 'slab'), 'основание этажа — перекрытие');
  assert.ok(only.every((f) => !f.ref || f.ref.level === 'L2'), 'стены только активного');
});

test('мебель не попадает на фасад и в разрез', () => {
  const p = house();
  p.items.push(createItem('wardrobe', 2500, 3600, 1800, 600));
  const a = JSON.stringify(buildElevation(p, 'S'));
  const view = { id: 's', line: { a: { x: -1000, y: 2000 }, b: { x: 6000, y: 2000 } }, side: 1 };
  const s0 = JSON.stringify(buildSection(p, view));
  p.items.length = 0;
  assert.equal(JSON.stringify(buildElevation(p, 'S')), a);
  assert.equal(JSON.stringify(buildSection(p, view)), s0);
});

// ---------------------------------------------------------------- выбор

const ray = (o, d) => ({ o, d });
const down = (x, y) => ray({ x, y, z: 50000 }, { x: 0, y: 0, z: -1 });

function setsFor(p, opts = { furniture: true }) {
  const faces = buildHouseMesh(p, opts);
  return { ...pickBoxes(p), faces: pickFaces(faces) };
}

test('выбор: пол → помещение, предмет, лестница, проём, стена', () => {
  const p = house();
  const bed = createItem('bed-double', 1500, 1500, 1600, 2000);
  const stairs = createItem('stairs', 4000, 2000, 1000, 3000);
  p.items.push(bed, stairs);
  const door = createOpening('door', 'R', 2, 2500, 900); // нижняя стена
  p.openings.push(door);
  const sets = setsFor(p);
  assert.deepEqual(pickObject(sets, down(3000, 300)), { type: 'room', id: 'R', levelId: p.activeLevel, t: 50000 - 1 });
  const hitBed = pickObject(sets, down(1500, 1500));
  assert.equal(hitBed.type, 'item');
  assert.equal(hitBed.id, bed.id);
  assert.equal(pickObject(sets, down(4000, 2000)).id, stairs.id, 'лестница — предмет');
  const hitDoor = pickObject(sets, ray({ x: 2500, y: 9000, z: 1000 }, { x: 0, y: -1, z: 0 }));
  assert.equal(hitDoor.type, 'opening');
  assert.equal(hitDoor.id, door.id);
  const hitWall = pickObject(sets, down(2500, -100));
  assert.equal(hitWall.type, 'wall');
  assert.equal(hitWall.key, 'e|R|0');
  assert.equal(pickObject(sets, down(20000, 20000)), null, 'мимо дома');
});

test('выбор: ближайшее к камере побеждает — стена заслоняет мебель, мебель — пол', () => {
  const p = house();
  const wardrobe = createItem('wardrobe', 2500, 400, 1800, 600); // у верхней стены
  p.items.push(wardrobe);
  const sets = setsFor(p);
  // Сбоку снаружи через верхнюю стену: стена, а не шкаф за ней.
  const side = pickObject(sets, ray({ x: 2500, y: -9000, z: 1000 }, { x: 0, y: 1, z: 0 }));
  assert.equal(side.type, 'wall');
  // Изнутри комнаты в сторону стены: шкаф перед стеной.
  const inside = pickObject(sets, ray({ x: 2500, y: 3500, z: 1000 }, { x: 0, y: -1, z: 0 }));
  assert.equal(inside.type, 'item');
  assert.equal(inside.id, wardrobe.id);
  // Сверху: шкаф над полом.
  assert.equal(pickObject(sets, down(2500, 400)).id, wardrobe.id);
});

test('выбор: перекрытие заслоняет нижний этаж; при «только активный» — виден', () => {
  const p = house();
  const bed = createItem('bed-double', 2000, 2000, 1600, 2000);
  p.items.push(bed);
  const l1 = p.activeLevel;
  p.levels.push(createLevel('2 этаж', 3000, 2800, 'L2'));
  p.activeLevel = 'L2';
  const r2 = createRoom('bedroom', 0, 0, 5000, 4000);
  r2.id = 'R2';
  p.rooms.push(r2);
  const all = { ...pickBoxes(p), faces: pickFaces(buildHouseMesh(p, { furniture: true })) };
  const top = pickObject(all, down(2000, 2000));
  assert.equal(top.type, 'room');
  assert.equal(top.id, 'R2');
  assert.equal(top.levelId, 'L2');
  p.activeLevel = l1;
  const ids = shownLevelIds(p, 'only');
  const only = { ...pickBoxes(p, ids), faces: pickFaces(buildHouseMesh(p, { furniture: true, levels: 'only' })) };
  const hit = pickObject(only, down(2000, 2000));
  assert.equal(hit.type, 'item');
  assert.equal(hit.id, bed.id);
  assert.equal(hit.levelId, l1);
});
