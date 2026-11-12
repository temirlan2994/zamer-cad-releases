// Крыши-плиты (core/roofs.js): создание над помещением, объединение,
// вынос по сторонам (прямоугольник и Г-образное основание), привязки,
// нормализация, сохранение v7/v6, автокровля не дублируется, парапет;
// грани 3D (core/mesh3d.js roofFaces), фасад и разрез, выбор в 3D.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addRoomToRoof, applyRoofPreset, createRoof, dragOverhang, gridArea, gridEdges, normalizeRoof, normalizeRoofs,
  overhangLabel, patchRoof, rectGrid, rectsBox, removeRoomFromRoof, roofBaseRects, roofHandles, roofOfRoom, roofRects,
  roofZ, snapOverhang, snapRoofDz,
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

test('создание над помещением: основание по наружной грани стен, вынос 600, отметка над этажом', () => {
  const p = house();
  const r = createRoof({ levelId: 'L1', roomIds: ['a'] });
  assert.equal(r.name, 'Крыша 1');
  assert.deepEqual(r.overhang, { n: 600, e: 600, s: 600, w: 600 });
  assert.equal(r.thickness, 300);
  assert.equal(r.edge.type, 'fascia');
  assert.equal(r.parapet.type, 'none');
  assert.deepEqual(rectsBox(roofBaseRects(p, r)), { x0: -250, y0: -250, x1: 6250, y1: 4250 });
  assert.deepEqual(bbox(p, r), { x0: -850, y0: -850, x1: 6850, y1: 4850 });
  const z = roofZ(p, r);
  assert.equal(z.z0, 3000);
  assert.equal(z.z1, 3300);
  assert.equal(roofZ(p, { ...r, dz: -200 }).z0, 2800);
  assert.equal(createRoof({ levelId: 'L1', roomIds: ['b'] }, [r]).name, 'Крыша 2');
  assert.equal(roofOfRoom({ ...p, roofs: [r] }, 'L1', 'a').id, r.id);
  assert.equal(roofOfRoom({ ...p, roofs: [r] }, 'L1', 'b'), null);
});

test('объединение двух помещений — одна плита без шва', () => {
  const p = house();
  let r = createRoof({ levelId: 'L1', roomIds: ['a'] });
  r = addRoomToRoof(r, 'b');
  assert.deepEqual(r.roomIds, ['a', 'b']);
  assert.deepEqual(bbox(p, r), { x0: -850, y0: -850, x1: 10850, y1: 4850 });
  const g = rectGrid([roofRects(p, r)]);
  assert.equal(gridEdges(g).length, 4, 'прямоугольник — 4 ребра');
  assert.equal(gridArea(g), 11700 * 5700);
  assert.equal(removeRoomFromRoof(r, 'b').roomIds.length, 1);
  assert.equal(removeRoomFromRoof(createRoof({ levelId: 'L1', roomIds: ['a'] }), 'a'), null);
});

test('вынос по сторонам: n — к меньшим y (верх плана), e — к большим x; Г-образное основание', () => {
  const p = house();
  const r = patchRoof(createRoof({ levelId: 'L1', roomIds: ['a'] }), { overhang: { n: 0, e: 1000, s: 200, w: 1500 } });
  assert.deepEqual(bbox(p, r), { x0: -1750, y0: -250, x1: 7250, y1: 4450 });
  // Г: a + комната под ней слева.
  const c = createRoom('hall', 0, 4000, 3000, 3000); c.id = 'c';
  p.rooms.push(c);
  const g = patchRoof(createRoof({ levelId: 'L1', roomIds: ['a', 'c'] }), { overhang: { n: 0, e: 1000, s: 500, w: 0 } });
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
  const r = createRoof({ levelId: 'L1', roomIds: ['a'] });
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
  const r1 = createRoof({ levelId: 'L1', roomIds: ['b'] });
  assert.equal(snapRoofDz(q, r1, 130).value, 150);
  assert.deepEqual(snapRoofDz(q, r1, 2960, { tol: 100 }), { value: 3000, label: 'верх «2 этаж»' });
});

test('нормализация: битые отброшены, поля зажаты, помещения — только существующие', () => {
  assert.equal(normalizeRoof(null), null);
  assert.equal(normalizeRoof({ roomIds: ['a'] }), null, 'без этажа');
  assert.equal(normalizeRoof({ levelId: 'L1', roomIds: [] }), null, 'без помещений и контура');
  const r = normalizeRoof({
    levelId: 'L1', roomIds: ['a', 'a', 5], overhang: { n: -5, e: 99999 }, thickness: 10,
    edge: { type: 'x', height: 1000, color: 'red' }, parapet: { type: 'glass', sides: { n: false } }, material: 'gold', extra: 1,
  });
  assert.deepEqual(r.roomIds, ['a']);
  assert.deepEqual(r.overhang, { n: 0, e: 3000, s: 600, w: 600 });
  assert.equal(r.thickness, 150);
  assert.equal(r.edge.type, 'fascia');
  assert.equal(r.edge.height, 600);
  assert.equal(r.edge.color, undefined);
  assert.equal(r.parapet.type, 'glass');
  assert.deepEqual(r.parapet.sides, { n: false, e: true, s: true, w: true });
  assert.equal(r.material, 'graphite');
  assert.equal(r.extra, 1);
  const list = normalizeRoofs([r, { ...r }, { ...r, levelId: 'nope' }, { ...r, id: 'x', roomIds: ['zzz'] }],
    [{ id: 'L1', rooms: [{ id: 'a' }] }]);
  assert.equal(list.length, 2);
  assert.notEqual(list[0].id, list[1].id);
  const preset = applyRoofPreset(r, 'terrace');
  assert.equal(preset.parapet.type, 'wall');
  assert.equal(preset.parapet.height, 1000);
  assert.deepEqual(preset.overhang, { n: 0, e: 0, s: 0, w: 0 });
  assert.equal(overhangLabel(applyRoofPreset(r, 'modern')), 'вынос 1200');
  assert.equal(overhangLabel(r), 'вынос 0–3000');
});

test('сохранение: kepler-plan/7 и v6 хранят крыши, старый проект без поля, удалённое помещение снимается', () => {
  const p = house();
  p.roofs = [createRoof({ levelId: 'L1', roomIds: ['a', 'b'], overhang: { n: 1200, e: 0, s: 600, w: 600 } })];
  const text = serializeProject(p);
  assert.equal(JSON.parse(text).schema, 'kepler-plan/7');
  assert.deepEqual(deserializeProject(text).roofs, p.roofs);
  assert.deepEqual(deserializeProject(JSON.stringify(fileDataV6(p))).roofs, p.roofs);
  assert.equal(deserializeProject(serializeProject(createProject('old'))).roofs, undefined);
  const gone = JSON.parse(text);
  gone.levels[0].blocks = gone.levels[0].blocks.filter((b) => b.id !== 'b');
  assert.deepEqual(deserializeProject(JSON.stringify(gone)).roofs[0].roomIds, ['a']);
  assert.equal(buildStructuredExport(p).roofs.length, 1);
  assert.equal(buildStructuredExport(house()).roofs, undefined);
});

test('3D: плита на отметке, толщина, вынос, фасция, автокровля не дублируется', () => {
  const p = house();
  p.roofs = [createRoof({ levelId: 'L1', roomIds: ['a'], dz: 100, overhang: { n: 1200, e: 600, s: 600, w: 600 } })];
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
  const auto = buildHouseMesh(p, { roof: true }).filter((f) => f.kind === 'roof' && !f.roofId && f.normal.z > 0.5);
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
  const base = createRoof({ levelId: 'L1', roomIds: ['a'], overhang: { n: 0, e: 0, s: 0, w: 0 } });
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
    createRoof({ levelId: 'L1', roomIds: ['a', 'b'], overhang: { n: 1200, e: 1200, s: 1200, w: 1200 } }),
    createRoof({ levelId: 'L2', roomIds: ['c'] }),
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
  p.roofs = [createRoof({ levelId: 'L1', roomIds: ['a', 'b'], overhang: { n: 1200, e: 1200, s: 1200, w: 1200 } })];
  const el = buildElevation(p, 'S');
  const roofPolys = el.polys.filter((q) => q.kind === 'roof');
  assert.ok(roofPolys.length > 0);
  assert.ok(roofPolys.some((q) => q.tint === '#3d4148'), 'графит');
  const us = roofPolys.flatMap((q) => q.pts.map((t) => t.u));
  const wallUs = el.polys.filter((q) => q.kind === 'wall').flatMap((q) => q.pts.map((t) => t.u));
  assert.ok(Math.max(...us) - Math.max(...wallUs) >= 1199, 'вынос за стену');
  assert.ok(Math.min(...wallUs) - Math.min(...us) >= 1199);
  assert.equal(el.bounds.z1, 3350);
  const sec = buildSection(p, { kind: 'section', id: 's1', line: { a: { x: 3000, y: -3000 }, b: { x: 3000, y: 8000 } } });
  assert.ok(sec, 'разрез построен');
  const cut = sec.cuts.filter((c) => c.kind === 'roof');
  assert.ok(cut.some((c) => c.z0 === 3000 && c.z1 === 3300), 'плита в сечении');
  assert.ok(cut.some((c) => c.u1 - c.u0 >= 4500 + 2400), 'с выносом');
});

test('выбор в 3D: клик по крыше сверху выбирает её, без крыши — помещение', () => {
  const p = house();
  p.roofs = [createRoof({ levelId: 'L1', roomIds: ['a'] })];
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
