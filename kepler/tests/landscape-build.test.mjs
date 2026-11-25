// Ландшафт: наружная лестница, клумба-короб с посадками (parent), бордюр —
// каталог, расчёт ступеней, привязка растений, сохранение, 3D, ведомость.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createLandscapeObject, curbLines, landscapeDef, normalizeLandscape, objectAreaM2, planterInner, resizeObject,
  rotateObjectAbout, stairsInfo, syncStairs, toLocal,
} from '../core/landscape.js';
import {
  canPlantInto, childrenOf, cloneGroup, clampIntoPlanter, plantInPlanter, pruneParents, refitChildren, rotateChildren,
  settleInPlanter, settleMoved, withChildren,
} from '../core/landscape-build.js';
import { landscapeFaces } from '../core/mesh3d-landscape.js';
import { landscapeBalance, landscapeDxfEntities, landscapeSchedule } from '../core/landscape-report.js';
import { buildStructuredExport } from '../core/export.js';
import { createProject, deserializeProject, serializeProject } from '../core/model.js';
import { pointInPolygon } from '../core/zamer/geometry.js';

const near = (a, b, tol = 1) => Math.abs(a - b) <= tol;
const zs = (faces) => faces.flatMap((f) => f.pts.map((q) => q.z));
const project = (...objects) => {
  const p = createProject();
  p.site.landscape.objects.push(...objects);
  return p;
};

test('каталог: лестница, короба, бордюр, цветы — в своих группах', () => {
  assert.equal(landscapeDef('stairs-out').group, 'Лестницы и бордюры');
  assert.equal(landscapeDef('curb').shape, 'line');
  assert.equal(landscapeDef('planter-box').group, 'Цветники');
  assert.equal(landscapeDef('planter-area').shape, 'poly');
  assert.equal(landscapeDef('planter-box').vis, 'objects');
  assert.equal(landscapeDef('stairs-out').surface, 'hard');
  assert.equal(landscapeDef('planter-box').surface, 'green');
  assert.ok(canPlantInto('flowers-clump') && canPlantInto('tree-birch') && canPlantInto('hedge-box'));
  assert.ok(!canPlantInto('planter-box') && !canPlantInto('bed-rect') && !canPlantInto('path') && !canPlantInto('bench'));
});

test('лестница: ступени по высоте подъёма (~150), длина = ступени × проступь, ручная правка', () => {
  const s = createLandscapeObject('stairs-out', 0, 0, { height: 900 });
  let st = stairsInfo(s);
  assert.deepEqual([st.steps, st.riser, st.tread, s.h], [6, 150, 300, 1800]);
  assert.ok(st.auto);
  // Подъём 700 → 5 ступеней по 140.
  s.height = 700; syncStairs(s);
  st = stairsInfo(s);
  assert.deepEqual([st.steps, st.riser, s.h], [5, 140, 1500]);
  // Ручное число ступеней и проступь.
  s.meta = { ...s.meta, steps: 4, tread: 350 }; syncStairs(s);
  assert.deepEqual([stairsInfo(s).steps, s.h, stairsInfo(s).riser], [4, 1400, 175]);
  // Тянем длину ручкой — меняется проступь, длина кратна ступеням.
  resizeObject(s, s.w, 1650);
  assert.equal(stairsInfo(s).tread, 413);
  assert.equal(s.h, 1652);
  // Борта: ширина марша = ширина − 2 борта.
  s.meta = { ...s.meta, cheeks: true, cheekW: 200 };
  assert.equal(stairsInfo(s).flight, s.w - 400);
  // Поворот — как у прямоугольников.
  rotateObjectAbout(s, 0, 0, 90);
  assert.equal(s.rotation, 90);
});

test('короб: внутренний контур, растение садится внутрь и не выходит за борт', () => {
  const box = createLandscapeObject('planter-box', 1000, 2000, { id: 'box-a', w: 4000, h: 1600, rotation: 30 });
  assert.deepEqual(box.meta, { wall: 180, fill: 'soil' });
  const inner = planterInner(box);
  assert.equal(inner.length, 4);
  // Цветы у самого борта — сдвигаются внутрь на свой радиус.
  const edge = toLocal(box, box);
  assert.deepEqual([Math.round(edge.x), Math.round(edge.y)], [0, 0]);
  const p = { x: 0, y: 0 };
  Object.assign(p, { x: box.x + 1900 * Math.cos(Math.PI / 6), y: box.y + 1900 * Math.sin(Math.PI / 6) });
  const fl = createLandscapeObject('flowers-clump', p.x, p.y, { id: 'fl-1', w: 600 });
  const objects = [box];
  assert.equal(settleInPlanter(objects, fl)?.id, 'box-a');
  assert.equal(fl.parent, 'box-a');
  const l = toLocal(box, fl);
  assert.ok(near(l.x, 2000 - 180 - 300, 2), String(l.x));
  // Дерево — по стволу: крона может нависать.
  const tree = createLandscapeObject('tree-birch', box.x, box.y, { id: 'tr-1' });
  settleInPlanter(objects, tree);
  assert.equal(tree.parent, 'box-a');
  // Вне короба — не привязывается; привязанное, вынесенное за борт, — отвязывается.
  const far = createLandscapeObject('shrub-box', 9000, 9000, { id: 'sh-far', parent: 'box-a' });
  assert.equal(settleInPlanter(objects, far), null);
  assert.equal(far.parent, undefined);
  // Контурный короб: растение у кромки — внутрь.
  const area = createLandscapeObject('planter-area', 0, 0, { id: 'box-p', points: [{ x: 0, y: 0 }, { x: 5000, y: 0 }, { x: 5000, y: 3000 }, { x: 0, y: 3000 }] });
  const g = createLandscapeObject('grass-clump', 150, 1500, { w: 800 });
  assert.equal(settleInPlanter([area], g)?.id, 'box-p');
  assert.ok(g.x >= 180 + 399 && pointInPolygon(g, planterInner(area)), String(g.x));
  clampIntoPlanter(area, Object.assign(g, { x: 2500, y: 1500 }));
  assert.deepEqual([g.x, g.y], [2500, 1500], 'внутри с запасом — на месте');
});

test('короб: группа — перенос, поворот, размер, копия и удаление вместе с растениями', () => {
  const box = createLandscapeObject('planter-box', 0, 0, { id: 'box-b', w: 3000, h: 1200 });
  const a = createLandscapeObject('shrub-box', 800, 0, { id: 'in-a', w: 500, parent: 'box-b' });
  const b = createLandscapeObject('grass-clump', -800, 100, { id: 'in-b', w: 500, parent: 'box-b' });
  const other = createLandscapeObject('boulder', 5000, 0, { id: 'free' });
  const objects = [box, a, b, other];
  assert.deepEqual([...withChildren(objects, ['box-b'])].sort(), ['box-b', 'in-a', 'in-b']);
  assert.deepEqual(childrenOf(objects, 'box-b').map((o) => o.id), ['in-a', 'in-b']);
  // Поворот на 90° вокруг центра короба.
  box.rotation = 90;
  rotateChildren(objects, box, 90);
  assert.deepEqual([a.x, a.y, a.rotation], [0, 800, 90]);
  // Сдвинутые вместе с коробом не пересаживаются; одиночное растение — пересаживается.
  for (const o of [box, a, b]) { o.x += 1000; o.y += 1000; }
  settleMoved(objects, ['box-b', 'in-a', 'in-b']);
  assert.equal(a.parent, 'box-b');
  // Короб уменьшили — растения пропорционально и внутри борта.
  const before = { ...box };
  resizeObject(box, 1500, 900);
  refitChildren(objects, box, before);
  for (const c of [a, b]) assert.ok(pointInPolygon(c, planterInner(box)), c.id);
  // Копия группы: новые id, parent — на новый короб.
  const copies = cloneGroup([box, a, b], 2000, 0);
  const nb = copies.find((o) => o.kind === 'planter-box');
  assert.notEqual(nb.id, 'box-b');
  assert.ok(copies.filter((o) => o.kind !== 'planter-box').every((o) => o.parent === nb.id));
  // Удаление короба → ссылки снимаются у оставшихся.
  const rest = [a, b, other];
  pruneParents(rest);
  assert.ok(rest.every((o) => !o.parent));
});

test('копия выноски с объектом меняет связь, отдельная копия становится самостоятельной', () => {
  const tree = createLandscapeObject('tree-fruit', 0, 0);
  const note = createLandscapeObject('callout', 0, 0, { meta: { text: 'Яблоня', targetId: tree.id } });
  const [copiedTree, copiedNote] = cloneGroup([tree, note], 1000, 1000);
  assert.equal(copiedNote.meta.targetId, copiedTree.id);
  assert.equal(note.meta.targetId, tree.id, 'исходная связь сохранена');
  const [standalone] = cloneGroup([note]);
  assert.equal(standalone.meta.targetId, null);
  assert.equal(normalizeLandscape({ objects: [standalone] }).objects[0].meta.targetId, null);
});

test('посадка внутрь: заполнение короба, все внутри и привязаны', () => {
  const box = createLandscapeObject('planter-box', 0, 0, { id: 'box-c', w: 4000, h: 1600 });
  const objects = [box];
  const list = plantInPlanter(objects, box, { kind: 'flowers-clump', density: 0.6 });
  assert.ok(list.length >= 2, String(list.length));
  for (const o of list) {
    assert.equal(o.parent, 'box-c');
    assert.ok(pointInPolygon(o, planterInner(box)));
  }
  // Узкий короб — ряд по оси.
  const narrow = createLandscapeObject('planter-box', 0, 5000, { id: 'box-n', w: 3000, h: 700 });
  const row = plantInPlanter([narrow], narrow, { kind: 'hedge-box', density: 1 });
  assert.ok(row.length >= 1);
  assert.equal(plantInPlanter([narrow], narrow, { kind: 'path' }).length, 0);
});

test('сохранение: parent, curb и meta переживают JSON; битые ссылки снимаются; старые проекты — как были', () => {
  const p = createProject();
  const box = createLandscapeObject('planter-box', 0, 0, { id: 'box-s', meta: { wall: 250, fill: 'mulch' } });
  const pl = createLandscapeObject('shrub-box', 300, 0, { id: 'pl-s', parent: 'box-s' });
  const orphan = createLandscapeObject('shrub-box', 300, 0, { id: 'pl-o', parent: 'нет-такого' });
  const st = createLandscapeObject('stairs-out', 5000, 0, { id: 'st-s', height: 600, meta: { tread: 320, cheeks: true } });
  const lawn = createLandscapeObject('lawn-area', 0, 0, { points: [{ x: 0, y: 0 }, { x: 4000, y: 0 }, { x: 4000, y: 3000 }], curb: { width: 80, height: 50, variant: 'stone' } });
  p.site.landscape.objects.push(box, pl, orphan, st, lawn);
  const q = deserializeProject(serializeProject(p));
  const objs = q.site.landscape.objects;
  const by = (id) => objs.find((o) => o.id === id);
  assert.equal(by('pl-s').parent, 'box-s');
  assert.equal(by('pl-o').parent, undefined);
  assert.deepEqual(by('box-s').meta, { wall: 250, fill: 'mulch' });
  assert.deepEqual([stairsInfo(by('st-s')).steps, by('st-s').h, stairsInfo(by('st-s')).cheek], [4, 1280, 150]);
  assert.deepEqual(objs.find((o) => o.kind === 'lawn-area').curb, { width: 80, height: 50, variant: 'stone' });
  // Старый объект без новых полей — без parent/curb.
  const old = normalizeLandscape({ objects: [{ id: 'x', kind: 'shrub-box', x: 0, y: 0, w: 900, h: 900 }] }).objects[0];
  assert.equal('parent' in old, false);
  assert.equal('curb' in old, false);
  // Экспорт kepler-export/2: необязательные поля.
  const ex = buildStructuredExport(q).site.landscape.objects;
  assert.equal(ex.find((o) => o.id === 'pl-s').parent, 'box-s');
  assert.equal(ex.find((o) => o.id === 'box-s').meta.fill, 'mulch');
  assert.deepEqual(ex.find((o) => o.id === 'st-s').stairs, { steps: 4, riser_mm: 150, tread_mm: 320, flight_mm: 1200, rise_mm: 600, cheek_mm: 150 });
  assert.equal(ex.find((o) => o.kind === 'lawn-area').curb.variant, 'stone');
});

test('бордюр: лента по линии и по периметру дорожки/газона', () => {
  const path = createLandscapeObject('path', 0, 0, { points: [{ x: 0, y: 0 }, { x: 5000, y: 0 }], width: 1200, curb: true });
  const lines = curbLines(path);
  assert.equal(lines.length, 2);
  assert.ok(lines.every((l) => !l.closed));
  assert.deepEqual(lines.map((l) => Math.round(l.pts[0].y)).sort((a, b) => a - b), [-600, 600]);
  const lawn = createLandscapeObject('lawn-area', 0, 0, { points: [{ x: 0, y: 0 }, { x: 4000, y: 0 }, { x: 4000, y: 3000 }, { x: 0, y: 3000 }], curb: true });
  assert.equal(curbLines(lawn)[0].closed, true);
  assert.equal(curbLines(createLandscapeObject('lawn-area', 0, 0, {})).length, 0);
  const curb = createLandscapeObject('curb', 0, 0, { points: [{ x: 0, y: 0 }, { x: 3000, y: 0 }] });
  assert.equal(curb.width, 100);
  assert.equal(curb.height, 150);
});

test('3D: стенки короба на высоту борта, посадки — на засыпке, ступени — реальной высоты', () => {
  const box = createLandscapeObject('planter-box', 0, 0, { id: 'box-3', w: 2000, h: 1000, height: 500 });
  const bf = landscapeFaces(project(box));
  assert.equal(Math.max(...zs(bf)), 500);
  assert.equal(Math.min(...zs(bf)), 0);
  const shrub = createLandscapeObject('shrub-box', 0, 0, { id: 'sh-3', w: 400, height: 400, parent: 'box-3' });
  const sf = landscapeFaces(project(box, shrub)).slice(bf.length);
  assert.ok(Math.min(...zs(sf)) >= 440 - 1, String(Math.min(...zs(sf))));
  const st = createLandscapeObject('stairs-out', 0, 0, { height: 600 });
  const f = landscapeFaces(project(st));
  assert.equal(Math.max(...zs(f)), 600);
  const tops = f.filter((x) => x.normal.z === 1).map((x) => x.pts[0].z);
  assert.deepEqual([...new Set(tops)].sort((a, b) => a - b), [150, 300, 450, 600]);
  // Бордюр газона — кольцо над землёй.
  const lawn = createLandscapeObject('lawn-area', 0, 0, { points: [{ x: 0, y: 0 }, { x: 4000, y: 0 }, { x: 4000, y: 3000 }], curb: { height: 120 } });
  assert.equal(Math.max(...zs(landscapeFaces(project(lawn)))), 120);
});

test('ведомость, баланс и DXF: лестница, короб, бордюр по периметру', () => {
  const st = createLandscapeObject('stairs-out', 0, 0, { height: 750 });
  const box = createLandscapeObject('planter-box', 4000, 0, { w: 2000, h: 1000 });
  const path = createLandscapeObject('path', 0, 0, { points: [{ x: 0, y: 3000 }, { x: 6000, y: 3000 }], width: 1000, curb: true });
  const rows = landscapeSchedule([st, box, path]);
  assert.match(rows.find((r) => r.kind === 'stairs-out').size, /^5 ступ\. 150×300 мм/);
  assert.match(rows.find((r) => r.kind === 'planter-box').size, /борт 180×450 мм/);
  const curb = rows.find((r) => r.title === 'Бордюр по периметру');
  assert.ok(near(curb.length, 12, 0.01), String(curb.length));
  assert.ok(near(objectAreaM2(st), 1.5 * 1.5, 1e-9));
  // Баланс: лестница — твёрдое покрытие, короб — озеленение.
  const p = project(st, box);
  p.site.boundary = [{ x: -5000, y: -5000 }, { x: 10000, y: -5000 }, { x: 10000, y: 5000 }, { x: -5000, y: 5000 }];
  const b = landscapeBalance(p);
  assert.ok(near(b.m2.hard, 2.25, 0.5), String(b.m2.hard));
  assert.ok(near(b.m2.green, 2, 0.3), String(b.m2.green));
  // DXF: рёбра ступеней и двойной контур короба.
  const ents = landscapeDxfEntities(p.site);
  assert.equal(ents.filter((e) => e.layer === 'lsPaths').length, 4 + 4);
  assert.equal(ents.filter((e) => e.layer === 'lsAreas').length, 8);
});
