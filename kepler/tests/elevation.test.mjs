// Фасады (core/elevation.js): проекция дома на вертикальную плоскость,
// сторона по северу, отметки, перекрытия; виды и листы (core/views.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLevel, createOpening, createProject, createRoom, deserializeProject, fileDataV6, projectFromData, serializeProject } from '../core/model.js';
import { buildElevation, facadeSide, fmtMark } from '../core/elevation.js';
import { facadeViews, materializeView } from '../core/views.js';

// Комната 5×4 м: окно на верхней стене (сторона 0), дверь — на правой (1).
function house({ rotation = 0, north = 0 } = {}) {
  const p = createProject();
  const room = createRoom('living', 0, 0, 5000, 4000);
  p.rooms.push(room);
  p.openings.push(createOpening('window', room.id, 0, 2500, 1200));
  p.openings.push(createOpening('door', room.id, 1, 2000, 900));
  p.building.rotation = rotation;
  p.site.north = north;
  return p;
}

const kinds = (el) => el.polys.map((p) => p.kind);
const has = (el, kind) => kinds(el).includes(kind);
const zr = (poly) => [Math.min(...poly.pts.map((p) => p.z)), Math.max(...poly.pts.map((p) => p.z))];

test('север вверх, дом без поворота: окно — на северном фасаде, дверь — на восточном', () => {
  const p = house();
  const n = buildElevation(p, 'N');
  assert.ok(has(n, 'window'), 'окно на севере');
  assert.ok(!has(n, 'door'));
  const e = buildElevation(p, 'E');
  assert.ok(has(e, 'door'), 'дверь на востоке');
  assert.ok(!has(e, 'window'));
  const s = buildElevation(p, 'S');
  assert.ok(!has(s, 'window') && !has(s, 'door'), 'с обратной стороны окна нет');
  const w = buildElevation(p, 'W');
  assert.ok(!has(w, 'window') && !has(w, 'door'));
  // Окно: подоконник 900, верх 2400; дверь — от пола до 2100.
  assert.deepEqual(zr(n.polys.find((q) => q.kind === 'window')), [900, 2400]);
  assert.deepEqual(zr(e.polys.find((q) => q.kind === 'door')), [0, 2100]);
});

test('фасад не зеркальный: на северном фасаде запад справа', () => {
  const p = house();
  const room = p.rooms[0];
  p.openings.length = 0;
  p.openings.push(createOpening('window', room.id, 0, 800, 600)); // у западного (левого) края
  const n = buildElevation(p, 'N');
  const win = n.polys.find((q) => q.kind === 'window');
  const cu = win.pts.reduce((s, q) => s + q.u, 0) / win.pts.length;
  assert.ok(cu > (n.bounds.u0 + n.bounds.u1) / 2, 'окно у западного края — справа для зрителя с севера');
  const s = buildElevation(p, 'S');
  assert.ok(!has(s, 'window'));
});

test('высота стены = высоте этажа, ширина — по наружным граням', () => {
  const p = house();
  const s = buildElevation(p, 'S', { roof: false });
  assert.equal(s.bounds.z0, 0);
  assert.equal(s.bounds.z1, 3000);
  const t = p.settings.exterior;
  assert.ok(Math.abs(s.width - (5000 + 2 * t)) < 1, `ширина ${s.width}`);
  const e = buildElevation(p, 'E', { roof: false });
  assert.ok(Math.abs(e.width - (4000 + 2 * t)) < 1);
  const roofed = buildElevation(p, 'S');
  assert.ok(roofed.polys.some((q) => q.kind === 'roof'));
  assert.ok(roofed.bounds.z1 > 3000);
  assert.ok(s.polys.every((q) => q.edges.length), 'у граней есть контур');
});

test('поворот дома и север: сторона «Север» согласована', () => {
  // Дом повёрнут на 90° по часовой: на север смотрит левая сторона плана (3).
  assert.equal(facadeSide(house({ rotation: 90 }), 'N').side, 3);
  // Север повёрнут на 90° (на восток экрана), дом прямо: правая сторона (1).
  assert.equal(facadeSide(house({ north: 90 }), 'N').side, 1);
  // Оба на 90° — снова верх.
  assert.equal(facadeSide(house({ rotation: 90, north: 90 }), 'N').side, 0);
  // 40° — ближе к верху, 50° — к левой стороне.
  assert.equal(facadeSide(house({ rotation: 40 }), 'N').side, 0);
  assert.equal(facadeSide(house({ rotation: 50 }), 'N').side, 3);
  // 45° — однозначно, и четыре фасада — четыре разные стороны.
  const p45 = house({ rotation: 45 });
  const sides = ['N', 'E', 'S', 'W'].map((d) => facadeSide(p45, d).side);
  assert.equal(new Set(sides).size, 4);
  assert.equal((sides[0] + 2) % 4, sides[2], 'Север и Юг — противоположные стороны');
  // При повороте на 90° окно (верхняя стена) смотрит на восток.
  const p90 = house({ rotation: 90 });
  assert.ok(has(buildElevation(p90, 'E'), 'window'));
  assert.ok(!has(buildElevation(p90, 'N'), 'window'));
  assert.ok(has(buildElevation(p90, 'S'), 'door'), 'дверь (правая стена) — на юге');
});

test('два этажа: перекрытие между ними и отметки уровней', () => {
  const p = house();
  p.levels.push(createLevel('2 этаж', 3000, 2800, 'L2'));
  p.activeLevel = 'L2';
  p.rooms.push(createRoom('bedroom', 0, 0, 5000, 4000));
  const s = buildElevation(p, 'S', { roof: false });
  const slab = s.polys.filter((q) => q.kind === 'slab');
  assert.ok(slab.length, 'перекрытие видно');
  assert.ok(slab.every((q) => zr(q)[0] >= 2799 && zr(q)[1] <= 3000));
  assert.deepEqual(s.levels.map((l) => [l.z, l.label]), [[0, '±0.000'], [3000, '+3.000']]);
  assert.equal(s.bounds.z1, 5800);
  assert.equal(fmtMark(-450), '−0.450');
});

test('виды: фасады по умолчанию лениво, сохраняются в файле v7 и v6', () => {
  const p = house();
  assert.equal(p.views, undefined);
  assert.deepEqual(facadeViews(p).map((v) => v.name), ['Фасад Север', 'Фасад Юг', 'Фасад Запад', 'Фасад Восток']);
  const v = materializeView(p, 'elev-N');
  v.scale = 50;
  v.marks = false;
  p.sheets = [{ id: 's1', no: '1', name: 'Фасады', format: 'A3', orient: 'landscape', viewports: [] }];
  const back = deserializeProject(serializeProject(p));
  assert.equal(back.views.length, 1);
  assert.equal(back.views[0].scale, 50);
  assert.equal(back.views[0].marks, false);
  assert.equal(facadeViews(back)[0].scale, 50);
  assert.equal(back.sheets[0].name, 'Фасады');
  const v6 = projectFromData(JSON.parse(JSON.stringify(fileDataV6(p))));
  assert.equal(v6.views[0].scale, 50);
  assert.equal(v6.sheets.length, 1);
  // Без views и sheets — полей нет; битые записи отбрасываются.
  const plain = deserializeProject(serializeProject(house()));
  assert.equal(plain.views, undefined);
  assert.equal(plain.sheets, undefined);
  const raw = JSON.parse(serializeProject(p));
  raw.views.push(null, { id: 'x', kind: 'elevation', dir: 'Q' }, { id: 'elev-N', kind: 'elevation', dir: 'N' });
  assert.equal(projectFromData(raw).views.length, 1);
});
