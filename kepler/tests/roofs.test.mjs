// Крыши-плиты (core/roofs.js): свой контур (стартовая форма по помещениям,
// дальше без связи), перенос, правка вершин и рёбер, деление ребра и
// удаление вершины, вынос по сторонам (прямоугольник и Г-образное
// основание), привязки, нормализация и перенос старых крыш (roomIds →
// outline), сохранение v7/v6, автокровля не дублируется, парапет; грани 3D
// (core/mesh3d.js roofFaces), фасад и разрез, выбор в 3D.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyRoofOutlineHandle, applyRoofPreset, createRoof, dragOverhang, gridArea, gridEdges, insertRoofVertex, moveRoof,
  normalizeRoof, normalizeRoofs, offsetOutline, outlineArea, overhangLabel, patchRoof, pushRoofEdgePart, rectGrid, rectsBox,
  rectsOutline, removeRoofVertex, roofAtPoint, roofBaseRects, roofFromRooms, roofHandles, roofOutlineHandles, roofOverRoom,
  roofRects, roofSlabEdges, roofSlabOutline, roofStats, roofZ, snapOverhang, snapRoofDz, snapRoofMove, tidyOutline,
  triangulate, validOutline, unionOutlines, mergeTouchingRoofs, roofsMergeable, boxOutline,
} from '../core/roofs.js';
import { createLevel, createProject, createRoom, deserializeProject, fileDataV6, serializeProject } from '../core/model.js';
import { buildHouseMesh, roofFaces } from '../core/mesh3d.js';
import { buildElevation } from '../core/elevation.js';
import { buildSection } from '../core/section.js';
import { pickFaces, pickObject, screenRay } from '../core/pick3d.js';
import { buildStructuredExport } from '../core/export.js';

function house() {
  const p = createProject('Крыши');
  const a = createRoom('living', 0, 0, 6000, 4000); a.id = 'a';
  const b = createRoom('kitchen', 6000, 0, 4000, 4000); b.id = 'b';
  p.rooms.push(a, b);
  return p;
}

// Двухэтажный: 2 этаж над комнатой a.
function twoStorey() {
  const p = house();
  const l2 = createLevel('2 этаж', 3000, 3000, 'L2');
  const c = createRoom('bedroom', 0, 0, 6000, 4000); c.id = 'c';
  l2.rooms.push(c);
  p.levels.push(l2);
  return p;
}

const bbox = (p, r) => rectsBox(roofRects(p, r));
// Крыша со стартовой формой по помещениям этажа L1 (без связи с ними).
const over = (p, ids, patch = {}, existing = []) => roofFromRooms(p, 'L1', ids, patch, existing);

test('создание над помещением: основание по наружной грани стен, вынос 600, отметка над этажом', () => {
  const p = house();
  const r = over(p, ['a']);
  assert.equal(r.name, 'Крыша 1');
  assert.equal(r.roomIds, undefined, 'с помещениями не связана');
  assert.deepEqual(r.outline, [{ x: -250, y: -250 }, { x: 6250, y: -250 }, { x: 6250, y: 4250 }, { x: -250, y: 4250 }]);
  assert.deepEqual(r.overhang, { n: 600, e: 600, s: 600, w: 600 });
  assert.equal(r.thickness, 300);
  assert.equal(r.edge.type, 'fascia');
  assert.equal(r.parapet.type, 'wall');
  assert.equal(r.parapet.height, 200);
  assert.deepEqual(rectsBox(roofBaseRects(p, r)), { x0: -250, y0: -250, x1: 6250, y1: 4250 });
  assert.deepEqual(bbox(p, r), { x0: -850, y0: -850, x1: 6850, y1: 4850 });
  const z = roofZ(p, r);
  assert.equal(z.z0, 3000);
  assert.equal(z.z1, 3300);
  assert.equal(roofZ(p, { ...r, dz: -200 }).z0, 2800);
  assert.equal(over(p, ['b'], {}, [r]).name, 'Крыша 2');
  assert.equal(roofOverRoom({ ...p, roofs: [r] }, 'L1', p.rooms[0]).id, r.id);
  assert.equal(roofOverRoom({ ...p, roofs: [r] }, 'L1', p.rooms[1]), null);
  // Помещение сдвинули — крыша на месте (связи нет).
  p.rooms[0].x += 1000;
  assert.deepEqual(rectsBox(roofBaseRects(p, r)), { x0: -250, y0: -250, x1: 6250, y1: 4250 });
});

test('форма по двум помещениям — одна плита без шва; объединение прямоугольников в контур', () => {
  const p = house();
  const r = over(p, ['a', 'b']);
  assert.equal(r.outline.length, 4);
  assert.deepEqual(bbox(p, r), { x0: -850, y0: -850, x1: 10850, y1: 4850 });
  const g = rectGrid([roofRects(p, r)]);
  assert.equal(gridEdges(g).length, 4, 'прямоугольник — 4 ребра');
  assert.equal(gridArea(g), 11700 * 5700);
  // Г из двух прямоугольников — 6 вершин; несвязные — габарит.
  const L = rectsOutline([{ x0: 0, y0: 0, x1: 6000, y1: 4000 }, { x0: 0, y0: 4000, x1: 3000, y1: 7000 }]);
  assert.equal(L.length, 6);
  assert.ok(validOutline(L));
  assert.deepEqual(rectsOutline([{ x0: 0, y0: 0, x1: 1000, y1: 1000 }, { x0: 3000, y0: 0, x1: 4000, y1: 1000 }]),
    [{ x: 0, y: 0 }, { x: 4000, y: 0 }, { x: 4000, y: 1000 }, { x: 0, y: 1000 }]);
  assert.deepEqual(tidyOutline([{ x: 0, y: 0 }, { x: 500, y: 0 }, { x: 1000, y: 0 }, { x: 1000, y: 1000 }, { x: 1000, y: 1000 }, { x: 0, y: 1000 }]).length, 4);
  assert.equal(validOutline([{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 0, y: 1000 }, { x: 1000, y: 1000 }]), false, 'бабочка');
});

test('правка контура: перенос, ребро, вершина, деление ребра (Г-форма), удаление вершины', () => {
  const p = house();
  const r = createRoof({ levelId: 'L1', outline: [{ x: 0, y: 0 }, { x: 6000, y: 0 }, { x: 6000, y: 4000 }, { x: 0, y: 4000 }], overhang: { n: 0, e: 0, s: 0, w: 0 } });
  // Перенос — весь контур.
  const m = moveRoof(r, 1000, -500);
  assert.deepEqual(rectsBox(roofBaseRects(p, m)), { x0: 1000, y0: -500, x1: 7000, y1: 3500 });
  // Привязка переноса: правая грань 6000+990 липнет к линии 7000, иначе шаг.
  assert.deepEqual(snapRoofMove(r, 990, 33, { xs: [7000], ys: [], tol: 50, step: 100 }), { dx: 1000, dy: 0, snapped: true });
  assert.deepEqual(snapRoofMove(r, 1234, 0, { step: 100 }), { dx: 1200, dy: 0, snapped: false });
  // Ручки: 4 вершины + 4 ребра.
  const hs = roofOutlineHandles(r);
  assert.equal(hs.filter((h) => h.kind === 'vertex').length, 4);
  assert.equal(hs.filter((h) => h.kind === 'edge').length, 4);
  // Ребро e (x = 6000, индекс 1) — на x = 8000.
  const e1 = hs.find((h) => h.kind === 'edge' && h.x === 6000);
  const wide = applyRoofOutlineHandle(r, e1, { x: 8000, y: 2000 });
  assert.deepEqual(rectsBox(roofBaseRects(p, wide)), { x0: 0, y0: 0, x1: 8000, y1: 4000 });
  // Вершина (6000, 4000) — в (7000, 5000): оба ребра.
  const v2 = hs.find((h) => h.kind === 'vertex' && h.x === 6000 && h.y === 4000);
  const big = applyRoofOutlineHandle(r, v2, { x: 7000, y: 5000 });
  assert.deepEqual(rectsBox(roofBaseRects(p, big)), { x0: 0, y0: 0, x1: 7000, y1: 5000 });
  // Ребро за противоположное — негодно (null), контур не ломается.
  assert.equal(applyRoofOutlineHandle(r, e1, { x: 0, y: 0 }), null);
  // Излом нижнего ребра (индекс 2: (6000,4000)→(0,4000)) в x = 3000 (точка
  // на прямой) и сдвиг правой половины вниз — Г-форма (уступ у излома).
  const split = insertRoofVertex(r, 2, { x: 3000, y: 4100 });
  assert.equal(split.outline.length, 5);
  assert.deepEqual(split.outline[3], { x: 3000, y: 4000 });
  const half = roofOutlineHandles(split).find((h) => h.kind === 'edge' && h.y === 4000 && h.x === 4500);
  assert.ok(half, 'ручка правой половины ребра');
  const L = applyRoofOutlineHandle(split, half, { x: 4500, y: 6000 });
  assert.equal(L.outline.length, 6, 'Г — 6 вершин');
  assert.equal(gridArea(rectGrid([roofBaseRects(p, L)])), 6000 * 4000 + 3000 * 2000);
  assert.equal(insertRoofVertex(r, 2, { x: 50, y: 4000 }), null, 'у самой вершины — нет');
  // Удаление вогнутой вершины Г — снова прямоугольник по габариту.
  const inner = L.outline.findIndex((q) => q.x === 3000 && q.y === 4000);
  const back = removeRoofVertex(L, inner);
  assert.equal(back.outline.length, 4);
  assert.deepEqual(rectsBox(roofBaseRects(p, back)), { x0: 0, y0: 0, x1: 6000, y1: 6000 });
  assert.equal(removeRoofVertex(r, 0), null, 'у прямоугольника вершину не удалить');
  assert.equal(removeRoofVertex(split, 3).outline.length, 4, 'излом на прямой — убрать');
  // Вынос считается от нового контура.
  const oh = patchRoof(L, { overhang: { n: 500, e: 500, s: 500, w: 500 } });
  assert.deepEqual(bbox(p, oh), { x0: -500, y0: -500, x1: 6500, y1: 6500 });
});

test('вынос по сторонам: n — к меньшим y (верх плана), e — к большим x; Г-образное основание', () => {
  const p = house();
  const r = patchRoof(over(p, ['a']), { overhang: { n: 0, e: 1000, s: 200, w: 1500 } });
  assert.deepEqual(bbox(p, r), { x0: -1750, y0: -250, x1: 7250, y1: 4450 });
  // Г: a + комната под ней слева.
  const c = createRoom('hall', 0, 4000, 3000, 3000); c.id = 'c';
  p.rooms.push(c);
  const g = patchRoof(roofFromRooms(p, 'L1', ['a', 'c']), { overhang: { n: 0, e: 1000, s: 500, w: 0 } });
  const edges = gridEdges(rectGrid([roofRects(p, g)]));
  assert.equal(edges.length, 6, 'Г — 6 рёбер');
  // Внутреннее ребро уступа (нормаль +x) сдвинуто на e = 1000: x = 3250 + 1000.
  const step = edges.find((e) => e.n.x === 1 && e.a.x < 6000);
  assert.equal(step.a.x, 4250);
  // Нижнее ребро уступа комнаты a (нормаль +y) — на s = 500: y = 4250 + 500.
  const ledge = edges.find((e) => e.n.y === 1 && e.a.y < 6000);
  assert.equal(ledge.a.y, 4750);
  const hs = roofHandles(p, g);
  assert.deepEqual(hs.map((h) => h.id).sort(), ['e', 'n', 'ne', 'nw', 's', 'se', 'sw', 'w']);
  const e = hs.find((h) => h.id === 'e');
  assert.equal(e.x, 7250);
});

test('ручки: тянуть сторону и угол, привязки 0/600/1000/1500 и к граням, шаг', () => {
  const r = over(house(), ['a']);
  assert.equal(dragOverhang(r, ['e'], 400, 0).roof.overhang.e, 1000);
  assert.equal(dragOverhang(r, ['n'], 0, -300).roof.overhang.n, 900, 'n растёт вверх (y вниз)');
  assert.equal(dragOverhang(r, ['w'], 1000, 0).roof.overhang.w, 0, 'не меньше 0');
  const c = dragOverhang(r, ['n', 'w'], -100, -200).roof.overhang;
  assert.deepEqual([c.n, c.w], [800, 700]);
  assert.deepEqual(snapOverhang(980, { tol: 50 }), { value: 1000, label: '1000 мм' });
  assert.equal(snapOverhang(1234, { step: 50 }).value, 1250);
  assert.equal(snapOverhang(5000, {}).value, 3000);
  // Грань: сторона e основания на 6250, линия 7400 → вынос 1150.
  assert.equal(snapOverhang(1160, { side: 'e', base: 6250, lines: [7400], tol: 30 }).value, 1150);
  assert.equal(snapOverhang(1160, { side: 'w', base: -250, lines: [-1400], tol: 30 }).value, 1150);
  // dz: шаг 50, привязка к отметкам этажей.
  const q = twoStorey();
  const r1 = roofFromRooms(q, 'L1', ['b']);
  assert.equal(snapRoofDz(q, r1, 130).value, 150);
  assert.deepEqual(snapRoofDz(q, r1, 2960, { tol: 100 }), { value: 3000, label: 'верх «2 этаж»' });
});

test('нормализация: битые отброшены, поля зажаты; старые крыши над помещениями получают свой контур', () => {
  const sq = [{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 1000, y: 1000 }, { x: 0, y: 1000 }];
  assert.equal(normalizeRoof(null), null);
  assert.equal(normalizeRoof({ outline: sq }), null, 'без этажа');
  assert.equal(normalizeRoof({ levelId: 'L1', roomIds: ['a'] }), null, 'без контура (старые roomIds — только через normalizeRoofs)');
  const r = normalizeRoof({
    levelId: 'L1', outline: sq, roomIds: ['a'], overhang: { n: -5, e: 99999 }, thickness: 10,
    edge: { type: 'x', height: 1000, color: 'red' }, parapet: { type: 'glass', sides: { n: false } }, material: 'gold', extra: 1,
  });
  assert.equal(r.roomIds, undefined, 'поле помещений отброшено');
  assert.deepEqual(r.outline, sq);
  assert.deepEqual(r.overhang, { n: 0, e: 3000, s: 600, w: 600 });
  assert.equal(r.thickness, 150);
  assert.equal(r.edge.type, 'fascia');
  assert.equal(r.edge.height, 600);
  assert.equal(r.edge.color, undefined);
  assert.equal(r.parapet.type, 'glass');
  assert.deepEqual(r.parapet.sides, { n: false, e: true, s: true, w: true });
  assert.equal(r.material, 'graphite');
  assert.equal(r.extra, 1);
  const levels = [{ id: 'L1', rooms: [createRoom('living', 0, 0, 6000, 4000), createRoom('kitchen', 6000, 0, 4000, 4000)] }];
  levels[0].rooms[0].id = 'a'; levels[0].rooms[1].id = 'b';
  const old = { id: 'old', levelId: 'L1', roomIds: ['a', 'b'], overhang: { n: 600, e: 600, s: 600, w: 600 } };
  const list = normalizeRoofs([r, { ...r }, { ...r, levelId: 'nope' }, { id: 'x', levelId: 'L1', roomIds: ['zzz'] }, old],
    levels, { exterior: 250 });
  assert.equal(list.length, 3, 'битый этаж и крыша без существующих помещений — отброшены');
  assert.notEqual(list[0].id, list[1].id);
  const mig = list.find((x) => x.id === 'old');
  assert.equal(mig.roomIds, undefined);
  assert.deepEqual(mig.outline, [{ x: -250, y: -250 }, { x: 10250, y: -250 }, { x: 10250, y: 4250 }, { x: -250, y: 4250 }]);
  const preset = applyRoofPreset(r, 'terrace');
  assert.equal(preset.parapet.type, 'wall');
  assert.equal(preset.parapet.height, 1000);
  assert.deepEqual(preset.overhang, { n: 0, e: 0, s: 0, w: 0 });
  assert.equal(overhangLabel(applyRoofPreset(r, 'modern')), 'вынос 1200');
  assert.equal(overhangLabel(r), 'вынос 0–3000');
});

test('сохранение: kepler-plan/7 и v6 хранят крыши с контуром, старый проект без поля; старый файл с roomIds открывается', () => {
  const p = house();
  p.roofs = [over(p, ['a', 'b'], { overhang: { n: 1200, e: 0, s: 600, w: 600 } })];
  const text = serializeProject(p);
  assert.equal(JSON.parse(text).schema, 'kepler-plan/7');
  assert.deepEqual(deserializeProject(text).roofs, p.roofs);
  assert.deepEqual(deserializeProject(JSON.stringify(fileDataV6(p))).roofs, p.roofs);
  assert.equal(deserializeProject(serializeProject(createProject('old'))).roofs, undefined);
  // Старый файл (крыша над помещениями): контур по ним, roomIds уходит; без
  // одной из комнат — контур по оставшейся.
  const legacy = JSON.parse(text);
  legacy.roofs[0] = { ...legacy.roofs[0], roomIds: ['a', 'b'] };
  delete legacy.roofs[0].outline;
  const opened = deserializeProject(JSON.stringify(legacy)).roofs[0];
  assert.equal(opened.roomIds, undefined);
  assert.deepEqual(rectsBox(roofBaseRects(p, opened)), { x0: -250, y0: -250, x1: 10250, y1: 4250 });
  legacy.levels[0].blocks = legacy.levels[0].blocks.filter((b) => b.id !== 'b');
  const lessOne = deserializeProject(JSON.stringify(legacy)).roofs[0];
  assert.deepEqual(rectsBox(roofBaseRects(p, lessOne)), { x0: -250, y0: -250, x1: 6250, y1: 4250 });
  // Контур после правки переживает сохранение; экспорт JSON — с контуром.
  const moved = { ...house(), roofs: [moveRoof(p.roofs[0], 500, 0)] };
  assert.deepEqual(deserializeProject(serializeProject(moved)).roofs[0].outline, moved.roofs[0].outline);
  assert.deepEqual(buildStructuredExport(moved).roofs[0].outline, moved.roofs[0].outline);
  assert.equal(buildStructuredExport(p).roofs.length, 1);
  assert.equal(buildStructuredExport(house()).roofs, undefined);
});

test('3D: плита на отметке, толщина, вынос, фасция, автокровля не дублируется', () => {
  const p = house();
  p.roofs = [over(p, ['a'], { dz: 100, overhang: { n: 1200, e: 600, s: 600, w: 600 }, parapet: { type: 'none' } })];
  const faces = roofFaces(p);
  const slab = faces.filter((f) => f.kind === 'roof');
  const tops = slab.filter((f) => f.normal.z > 0.5);
  assert.ok(tops.length >= 1);
  assert.ok(tops.every((f) => f.pts.every((q) => q.z === 3400)), 'верх = 3000 + 100 + 300');
  assert.ok(tops.every((f) => f.cutZ0 === 3100 && f.roofId === p.roofs[0].id));
  const ys = slab.flatMap((f) => f.pts.map((q) => q.y));
  assert.equal(Math.min(...ys), -250 - 1200, 'вынос n — к меньшим y');
  const fascia = faces.filter((f) => f.kind === 'fascia');
  assert.ok(fascia.length > 0);
  const fz = fascia.flatMap((f) => f.pts.map((q) => q.z));
  assert.equal(Math.max(...fz), 3450);
  assert.ok(Math.min(...fz) <= 3100, 'фасция закрывает торец плиты');
  assert.ok(fascia.flatMap((f) => f.pts.map((q) => q.x)).some((x) => x === 6850 + 40), 'борт снаружи плиты');
  assert.equal(faces.filter((f) => f.kind === 'parapet').length, 0);
  // Автокровля (флажок «Крыша»): над накрытым помещением — нет второй плиты.
  const auto = buildHouseMesh(p, { roof: true }).filter((f) => f.kind === 'roof' && f.roofSource === 'linked' && f.normal.z > 0.5);
  assert.ok(auto.length > 0, 'над кухней автокровля есть');
  for (const f of auto) assert.ok(f.pts.every((q) => q.x >= 6850 - 0.5), `автоплита не над крышей: ${JSON.stringify(f.pts[0])}`);
  // Без крыш автокровля — над обеими комнатами.
  const bare = house();
  const autoAll = buildHouseMesh(bare, { roof: true }).filter((f) => f.kind === 'roof' && f.normal.z > 0.5);
  assert.ok(autoAll.some((f) => f.pts.some((q) => q.x < 1000)));
  // Опция roofs: false — без крыш-плит.
  assert.equal(buildHouseMesh(p, { roofs: false }).filter((f) => f.roofId).length, 0);
  assert.ok(buildHouseMesh(p).some((f) => f.roofId));
});

test('3D: парапет по включённым сторонам, типы, цвет материала', () => {
  const p = house();
  const base = over(p, ['a'], { overhang: { n: 0, e: 0, s: 0, w: 0 } });
  const wall = patchRoof(base, { parapet: { type: 'wall', height: 1000, thickness: 200, sides: { n: true, e: false, s: false, w: false } } });
  const par = roofFaces(p, [wall]).filter((f) => f.kind === 'parapet');
  assert.ok(par.length > 0);
  const pts = par.flatMap((f) => f.pts);
  assert.equal(Math.max(...pts.map((q) => q.z)), 3300 + 1000);
  assert.equal(Math.min(...pts.map((q) => q.y)), -250);
  assert.equal(Math.max(...pts.map((q) => q.y)), -250 + 200, 'только сторона n');
  const all = patchRoof(wall, { parapet: { sides: { e: true, s: true, w: true }, inset: 300 } });
  const ap = roofFaces(p, [all]).filter((f) => f.kind === 'parapet').flatMap((f) => f.pts);
  assert.equal(Math.min(...ap.map((q) => q.x)), -250 + 300, 'отступ от края');
  for (const type of ['glass', 'rail', 'stepped']) {
    const f = roofFaces(p, [patchRoof(base, { parapet: { type } })]).filter((x) => x.kind === 'parapet');
    assert.ok(f.length > 0, type);
  }
  assert.ok(roofFaces(p, [patchRoof(base, { parapet: { type: 'glass' } })]).some((f) => f.kind === 'parapet' && f.alpha < 1));
  for (const type of ['cornice', 'drip']) assert.ok(roofFaces(p, [patchRoof(base, { edge: { type } })]).some((f) => f.kind === 'fascia'), type);
  assert.equal(roofFaces(p, [patchRoof(base, { edge: { type: 'plain' } })]).filter((f) => f.kind === 'fascia').length, 0);
  const white = roofFaces(p, [patchRoof(base, { material: 'white' })]).find((f) => f.kind === 'roof');
  assert.equal(white.color, '#ecebe6');
});

test('этажи: нижняя крыша шире, верхняя уже; крыша над этажом скрыта, когда этаж выше не показан', () => {
  const p = twoStorey();
  p.roofs = [
    roofFromRooms(p, 'L1', ['a', 'b'], { overhang: { n: 1200, e: 1200, s: 1200, w: 1200 } }),
    roofFromRooms(p, 'L2', ['c']),
  ];
  const faces = buildHouseMesh(p);
  const top = (id) => faces.filter((f) => f.roofId === id && f.kind === 'roof' && f.normal.z > 0.5).map((f) => f.pts[0].z);
  assert.ok(top(p.roofs[0].id).every((z) => z === 3300));
  assert.ok(top(p.roofs[1].id).every((z) => z === 6300));
  // Над пятном 2 этажа нижняя плита не строится — козырёк вокруг (перекрытие там своё).
  const lowTops = faces.filter((f) => f.roofId === p.roofs[0].id && f.kind === 'roof' && f.normal.z > 0.5);
  const inside = (f) => { const xs = f.pts.map((q) => q.x); const ys = f.pts.map((q) => q.y); return Math.min(...xs) < 3000 && Math.max(...xs) > 3000 && Math.min(...ys) < 2000 && Math.max(...ys) > 2000; };
  assert.ok(!lowTops.some(inside), 'над спальней нижней плиты нет');
  assert.ok(lowTops.some((f) => f.pts.some((q) => q.x > 7000)), 'над кухней — есть');
  p.activeLevel = 'L1';
  const upto = buildHouseMesh(p, { levels: 'upto' });
  assert.equal(upto.filter((f) => f.roofId).length, 0, 'этаж выше скрыт — крыша над первым тоже');
  p.activeLevel = 'L2';
  assert.ok(buildHouseMesh(p, { levels: 'only' }).some((f) => f.roofId === p.roofs[1].id));
});

test('фасад и разрез: крыша с выносом и фасцией, цвет материала; сечение плиты', () => {
  const p = house();
  p.roofs = [over(p, ['a', 'b'], { overhang: { n: 1200, e: 1200, s: 1200, w: 1200 } })];
  const el = buildElevation(p, 'S');
  const roofPolys = el.polys.filter((q) => q.kind === 'roof');
  assert.ok(roofPolys.length > 0);
  assert.ok(roofPolys.some((q) => q.tint === '#3d4148'), 'графит');
  const us = roofPolys.flatMap((q) => q.pts.map((t) => t.u));
  const wallUs = el.polys.filter((q) => q.kind === 'wall').flatMap((q) => q.pts.map((t) => t.u));
  assert.ok(Math.max(...us) - Math.max(...wallUs) >= 1199, 'вынос за стену');
  assert.ok(Math.min(...wallUs) - Math.min(...us) >= 1199);
  assert.equal(el.bounds.z1, 3500, 'верх парапета новой крыши');
  const sec = buildSection(p, { kind: 'section', id: 's1', line: { a: { x: 3000, y: -3000 }, b: { x: 3000, y: 8000 } } });
  assert.ok(sec, 'разрез построен');
  const cut = sec.cuts.filter((c) => c.kind === 'roof');
  assert.ok(cut.some((c) => c.z0 === 3000 && c.z1 === 3300), 'плита в сечении');
  assert.ok(cut.some((c) => c.u1 - c.u0 >= 4500 + 2400), 'с выносом');
});

test('выбор в 3D: клик по крыше сверху выбирает её, без крыши — помещение', () => {
  const p = house();
  p.roofs = [over(p, ['a'])];
  const cam = { yaw: -2.2, pitch: 1.2, dist: 30000, eyeDist: 50000, target: { x: 3000, y: 2000, z: 0 } };
  const hitAt = (faces) => {
    const ray = { o: { x: 3000, y: 2000, z: 20000 }, d: { x: 0, y: 0, z: -1 } };
    return pickObject({ walls: [], openings: [], faces: pickFaces(faces) }, ray);
  };
  const hit = hitAt(buildHouseMesh(p));
  assert.equal(hit.type, 'roof');
  assert.equal(hit.id, p.roofs[0].id);
  const hit2 = hitAt(buildHouseMesh(p, { roofs: false }));
  assert.equal(hit2.type, 'room');
  assert.ok(screenRay(cam, 800, 600, 400, 300));
});

const rect = (w = 6000, h = 4000, oh = 0) => createRoof({ levelId: 'L1', outline: [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }], overhang: { n: oh, e: oh, s: oh, w: oh } });

test('ломать как стену: тянуть часть ребра — уступ (Г, П, Т), нажатие у конца — всё ребро', () => {
  const p = house();
  const r = rect();
  // Нижнее ребро (индекс 2) нажато в x = 1500 — ближе к левому концу: часть 1500…0 уходит вниз.
  const L = pushRoofEdgePart(r, 2, { x: 1500, y: 4000 }, { x: 1500, y: 5000 });
  assert.deepEqual(L.outline, [{ x: 0, y: 0 }, { x: 6000, y: 0 }, { x: 6000, y: 4000 }, { x: 1500, y: 4000 }, { x: 1500, y: 5000 }, { x: 0, y: 5000 }]);
  assert.equal(outlineArea(L.outline), 6000 * 4000 + 1500 * 1000);
  // Внутрь — вырез (Г с вогнутым углом).
  const cut = pushRoofEdgePart(r, 2, { x: 4500, y: 4000 }, { x: 4500, y: 3000 });
  assert.equal(outlineArea(cut.outline), 6000 * 4000 - 1500 * 1000);
  // Два излома и средняя часть — П/Т-выступ.
  const two = insertRoofVertex(insertRoofVertex(r, 2, { x: 4000, y: 4000 }), 3, { x: 2000, y: 4000 });
  assert.equal(two.outline.length, 6);
  const mid = roofOutlineHandles(two).find((h) => h.kind === 'edge' && h.x === 3000 && h.y === 4000);
  const T = applyRoofOutlineHandle(two, mid, { x: 3000, y: 5500 });
  assert.equal(T.outline.length, 8, 'Т — 8 вершин');
  assert.equal(outlineArea(T.outline), 6000 * 4000 + 2000 * 1500);
  assert.equal(gridArea(rectGrid([roofBaseRects(p, T)])), 6000 * 4000 + 2000 * 1500);
  // Вернуть заподлицо — уступ исчезает.
  const back = roofOutlineHandles(T).find((h) => h.kind === 'edge' && h.x === 3000 && h.y === 5500);
  const flat = applyRoofOutlineHandle(T, back, { x: 3000, y: 4000 });
  assert.equal(outlineArea(flat.outline), 6000 * 4000);
  // У конца ребра (ближе 100 мм) — сдвиг всего ребра.
  const all = pushRoofEdgePart(r, 2, { x: 50, y: 4000 }, { x: 50, y: 4500 });
  assert.deepEqual(rectsBox(roofBaseRects(p, all)), { x0: 0, y0: 0, x1: 6000, y1: 4500 });
  assert.equal(all.outline.length, 4);
});

test('свободные вершины: косая грань, трапеция, треугольник; привязка к x/y соседей; без free — прямые углы', () => {
  const r = rect(6000, 4000, 600);
  const v2 = roofOutlineHandles(r).find((h) => h.kind === 'vertex' && h.x === 6000 && h.y === 4000);
  const trap = applyRoofOutlineHandle(r, v2, { x: 4000, y: 4000 }, { free: true });
  assert.deepEqual(trap.outline[2], { x: 4000, y: 4000 });
  assert.ok(validOutline(trap.outline));
  assert.equal(outlineArea(trap.outline), ((6000 + 4000) / 2) * 4000);
  // Притяжение к x/y других вершин — прямой угол.
  const snapped = applyRoofOutlineHandle(r, v2, { x: 5970, y: 4030 }, { free: true, mergeTolerance: 50 });
  assert.deepEqual(snapped.outline[2], { x: 6000, y: 4000 });
  // Без free — оба ребра параллельно (прямоугольник растёт).
  assert.deepEqual(rectsBox(roofBaseRects(null, applyRoofOutlineHandle(r, v2, { x: 7000, y: 5000 }))), { x0: 0, y0: 0, x1: 7000, y1: 5000 });
  // Вершину на соседнюю — треугольник.
  const tri = applyRoofOutlineHandle(r, v2, { x: 0, y: 4000 }, { free: true });
  assert.equal(tri.outline.length, 3);
  assert.equal(outlineArea(tri.outline), (6000 * 4000) / 2);
  // Самопересечение (вершина за противоположное ребро) — null.
  assert.equal(applyRoofOutlineHandle(r, v2, { x: 3000, y: -3000 }, { free: true }), null);
  // Удалить вершину косого контура — соседи соединяются (из трапеции — треугольник).
  assert.equal(removeRoofVertex(trap, 2).outline.length, 3);
  // Ребро косого контура: сдвиг по нормали, соседи удлиняются по своим линиям.
  const slantEdge = roofOutlineHandles(trap).find((h) => h.kind === 'edge' && h.index === 1);
  const pushed = applyRoofOutlineHandle(trap, slantEdge, { x: 6000, y: 3000 });
  assert.ok(pushed && outlineArea(pushed.outline) > outlineArea(trap.outline));
  assert.equal(pushed.outline.length, 4);
  assert.equal(pushed.outline[1].y, 0, 'конец скользит по верхнему ребру');
  assert.equal(pushed.outline[2].y, 4000, 'и по нижнему');
});

test('косой контур: вынос по нормалям рёбер, площадь, валидация, попадание, 3D, фасад, разрез', () => {
  const p = house();
  const r = createRoof({ levelId: 'L1', outline: [{ x: 0, y: 0 }, { x: 6000, y: 0 }, { x: 4000, y: 4000 }, { x: 0, y: 4000 }] });
  const slab = roofSlabOutline(p, r);
  assert.equal(slab.length, 4);
  // Косое ребро (6000,0)-(4000,4000) сдвинуто на 600 по своей нормали.
  const L = Math.hypot(2000, 4000);
  const d = (q) => ((q.x - 6000) * 4000) / L + (q.y * 2000) / L;
  assert.ok(Math.abs(d(slab[1]) - 600) < 1 && Math.abs(d(slab[2]) - 600) < 1);
  assert.deepEqual(slab[0], { x: -600, y: -600 });
  // Площадь плиты — по многоугольнику.
  const st = roofStats(p, r);
  assert.ok(Math.abs(st.area - outlineArea(slab) / 1e6) < 1e-9);
  assert.ok(st.area > (((6000 + 4000) / 2) * 4000) / 1e6);
  // Ромб с разными выносами по сторонам: рёбра плиты есть, ручки выноса — 8.
  const diamond = createRoof({ levelId: 'L1', outline: [{ x: 0, y: -3000 }, { x: 3000, y: 0 }, { x: 0, y: 3000 }, { x: -3000, y: 0 }], overhang: { n: 0, e: 1000, s: 1000, w: 0 } });
  assert.equal(roofSlabEdges(p, diamond).length, 4);
  assert.equal(roofHandles(p, diamond).length, 8);
  // Острый угол — срез двумя точками (без длинного шипа).
  const sharp = offsetOutline([{ x: 0, y: 0 }, { x: 10000, y: 1000 }, { x: 0, y: 2000 }], 500);
  assert.equal(sharp.length, 4);
  assert.ok(Math.max(...sharp.map((q) => q.x)) < 10000 + 4 * 500 + 1);
  // Валидация: треугольник годен, бабочка, шип и крошка — нет.
  assert.ok(validOutline([{ x: 0, y: 0 }, { x: 3000, y: 0 }, { x: 0, y: 3000 }]));
  assert.equal(validOutline([{ x: 0, y: 0 }, { x: 3000, y: 3000 }, { x: 3000, y: 0 }, { x: 0, y: 3000 }]), false);
  assert.equal(validOutline([{ x: 0, y: 0 }, { x: 3000, y: 0 }, { x: 1000, y: 0 }, { x: 0, y: 3000 }]), false, 'шип назад');
  assert.equal(validOutline([{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 0, y: 50 }]), false, 'меньше 0,01 м²');
  // Треугольники вогнутого контура покрывают его площадь.
  const Lp = [{ x: 0, y: 0 }, { x: 4000, y: 0 }, { x: 4000, y: 1000 }, { x: 1000, y: 3000 }, { x: 0, y: 3000 }];
  const tris = triangulate(Lp);
  assert.equal(tris.length, 3);
  assert.ok(Math.abs(tris.reduce((s, t) => s + outlineArea(t), 0) - outlineArea(Lp)) < 1);
  // Попадание — по многоугольнику.
  const q = { ...p, roofs: [r] };
  assert.equal(roofAtPoint(q, 'L1', 1000, 1000)?.id, r.id);
  assert.equal(roofAtPoint(q, 'L1', 5800, 3800), null, 'за косой гранью');
  // 3D: плита — треугольники на отметке, фасция и парапеты всех типов строятся.
  const faces = roofFaces(p, [r]);
  const tops = faces.filter((f) => f.kind === 'roof' && f.normal.z > 0.5);
  assert.ok(tops.length >= 2 && tops.every((f) => f.pts.length === 3 && f.pts.every((t) => t.z === 3300) && f.cutZ0 === 3000));
  assert.ok(Math.abs(tops.reduce((s, f) => s + outlineArea(f.pts), 0) - outlineArea(slab)) < 1);
  assert.ok(faces.some((f) => f.kind === 'fascia'));
  const sb = rectsBox([{ x0: Math.min(...slab.map((t) => t.x)), y0: Math.min(...slab.map((t) => t.y)), x1: Math.max(...slab.map((t) => t.x)), y1: Math.max(...slab.map((t) => t.y)) }]);
  for (const type of ['wall', 'glass', 'rail', 'stepped']) {
    const pf = roofFaces(p, [patchRoof(r, { parapet: { type } })]).filter((f) => f.kind === 'parapet');
    assert.ok(pf.length > 0, type);
    for (const f of pf) assert.ok(f.pts.every((t) => t.x >= sb.x0 - 1 && t.x <= sb.x1 + 1 && t.y >= sb.y0 - 1 && t.y <= sb.y1 + 1), `${type}: парапет на плите`);
  }
  const one = roofFaces(p, [patchRoof(r, { parapet: { type: 'wall', sides: { n: true, e: false, s: false, w: false } } })]).filter((f) => f.kind === 'parapet');
  assert.ok(Math.max(...one.flatMap((f) => f.pts.map((t) => t.y))) <= -600 + 200 + 1, 'только сторона n');
  for (const type of ['cornice', 'drip']) assert.ok(roofFaces(p, [patchRoof(r, { edge: { type } })]).some((f) => f.kind === 'fascia'), type);
  // Фасад и разрез.
  p.roofs = [r];
  const el = buildElevation(p, 'S');
  assert.ok(el.polys.some((x) => x.kind === 'roof'));
  const sec = buildSection(p, { kind: 'section', id: 's1', line: { a: { x: 1000, y: -3000 }, b: { x: 1000, y: 8000 } } });
  const cut = sec.cuts.filter((c) => c.kind === 'roof');
  assert.ok(cut.some((c) => c.z0 === 3000 && c.z1 === 3300), 'плита в сечении');
  // Старый ортогональный контур — прежняя геометрия (сетка прямоугольников).
  const o = rect(6000, 4000, 600);
  assert.deepEqual(rectsBox(roofRects(p, o)), { x0: -600, y0: -600, x1: 6600, y1: 4600 });
  assert.equal(roofSlabOutline(p, o).length, 4);
  // Сохранение косого контура.
  assert.deepEqual(deserializeProject(serializeProject(p)).roofs[0].outline, r.outline);
});

// ---------------------------------------------------------------- слияние крыш

const R = (x0, y0, x1, y1) => boxOutline({ x0, y0, x1, y1 });
const roofsOn = (outlines, patches = []) => {
  const list = [];
  outlines.forEach((o, i) => list.push(createRoof({ levelId: 'L1', outline: o, ...(patches[i] || {}) }, list)));
  return list;
};

test('слияние: смежные помещения → одна крыша, свойства от активной, имя самой ранней', () => {
  const p = house();
  const a = over(p, ['a']);
  const b = over(p, ['b'], { overhang: { n: 1000, e: 1000, s: 1000, w: 1000 }, material: 'white' }, [a]);
  const m = mergeTouchingRoofs([a, b], b.id);
  assert.ok(m);
  assert.equal(m.list.length, 1);
  assert.deepEqual(m.merged, [a.id]);
  assert.equal(m.roof.id, b.id);
  assert.equal(m.roof.name, 'Крыша 1');
  assert.equal(m.roof.material, 'white');
  assert.deepEqual(m.roof.outline, [{ x: -250, y: -250 }, { x: 10250, y: -250 }, { x: 10250, y: 4250 }, { x: -250, y: 4250 }]);
  // Вынос — от общего контура: одна плита без швов.
  p.roofs = m.list;
  assert.deepEqual(bbox(p, m.roof), { x0: -1250, y0: -1250, x1: 11250, y1: 5250 });
  assert.equal(roofRects(p, m.roof).length >= 1, true);
  assert.equal(roofFaces(p).filter((f) => f.kind === 'roof').every((f) => f.roofId === b.id), true);
});

test('слияние: касание ребром (зазор до 5 мм), перекрытие, Г-образный итог', () => {
  assert.deepEqual(unionOutlines(R(0, 0, 4000, 3000), R(4000, 0, 8000, 3000)).outline, R(0, 0, 8000, 3000));
  assert.deepEqual(unionOutlines(R(0, 0, 4000, 3000), R(4004, 0, 8000, 3000)).outline, R(0, 0, 8000, 3000));
  assert.equal(unionOutlines(R(0, 0, 4000, 3000), R(4020, 0, 8000, 3000)), null, 'зазор 20 мм — не касание');
  const ov = unionOutlines(R(0, 0, 5000, 3000), R(4000, 0, 8000, 3000));
  assert.deepEqual(ov.outline, R(0, 0, 8000, 3000));
  const g = unionOutlines(R(0, 0, 6000, 3000), R(0, 3000, 3000, 7000)).outline;
  assert.equal(g.length, 6);
  assert.equal(outlineArea(g), 6000 * 3000 + 3000 * 4000);
  assert.ok(validOutline(g));
});

test('слияние: несвязные и касание в точке не сливаются', () => {
  assert.equal(unionOutlines(R(0, 0, 4000, 3000), R(5000, 0, 8000, 3000)), null);
  assert.equal(unionOutlines(R(0, 0, 4000, 3000), R(4000, 3000, 7000, 6000)), null);
  const list = roofsOn([R(0, 0, 4000, 3000), R(5000, 0, 8000, 3000)]);
  assert.equal(mergeTouchingRoofs(list, list[1].id), null);
});

test('слияние: другой этаж, другая отметка верха, autoMerge=false — не сливаются', () => {
  const lv = roofsOn([R(0, 0, 4000, 3000), R(4000, 0, 8000, 3000)], [{}, { levelId: 'L2' }]);
  assert.equal(mergeTouchingRoofs(lv, lv[1].id), null);
  const dz = roofsOn([R(0, 0, 4000, 3000), R(4000, 0, 8000, 3000)], [{}, { dz: 200 }]);
  assert.equal(mergeTouchingRoofs(dz, dz[1].id), null);
  // Тот же верх при другой толщине — сливаются (толщина — от активной).
  const th = roofsOn([R(0, 0, 4000, 3000), R(4000, 0, 8000, 3000)], [{ thickness: 400 }, { dz: 100, thickness: 300 }]);
  assert.equal(mergeTouchingRoofs(th, th[1].id).roof.thickness, 300);
  const off = roofsOn([R(0, 0, 4000, 3000), R(4000, 0, 8000, 3000)], [{ autoMerge: false }, {}]);
  assert.equal(off[0].autoMerge, false);
  assert.equal(off[1].autoMerge, undefined);
  assert.equal(mergeTouchingRoofs(off, off[1].id), null, 'выключенная не сливается');
  assert.equal(mergeTouchingRoofs(off, off[0].id), null, 'выключенная не сливает других');
  assert.equal(mergeTouchingRoofs(off, off[1].id, { force: true }).list.length, 1, 'вручную — сливается');
  assert.equal(roofsMergeable(off[0], off[1], { force: true }), true);
  assert.equal(normalizeRoof({ ...off[0], autoMerge: 'нет' }).autoMerge, undefined);
});

test('слияние: косые контуры, цепочка из трёх, двор заливается', () => {
  const tri = unionOutlines([{ x: 0, y: 0 }, { x: 4000, y: 0 }, { x: 2000, y: 3000 }], [{ x: 4000, y: 0 }, { x: 6000, y: 3000 }, { x: 2000, y: 3000 }]);
  assert.deepEqual(tri.outline, [{ x: 0, y: 0 }, { x: 4000, y: 0 }, { x: 6000, y: 3000 }, { x: 2000, y: 3000 }]);
  const chain = roofsOn([R(0, 0, 3000, 3000), R(6000, 0, 9000, 3000), R(3000, 0, 6000, 3000)]);
  const m = mergeTouchingRoofs(chain, chain[2].id);
  assert.equal(m.list.length, 1);
  assert.deepEqual(m.roof.outline, R(0, 0, 9000, 3000));
  const ring = roofsOn([R(0, 0, 9000, 1000), R(0, 8000, 9000, 9000), R(0, 0, 1000, 9000), R(8000, 0, 9000, 9000)]);
  const rm = mergeTouchingRoofs(ring, ring[3].id);
  assert.equal(rm.filled, true);
  assert.deepEqual(rm.roof.outline, R(0, 0, 9000, 9000));
});
