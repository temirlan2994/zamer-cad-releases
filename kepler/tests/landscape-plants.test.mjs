// Ландшафт: ведомость растений (виды, группы, единицы, справочник цен и
// размеров посадки, итог, CSV/JSON/DXF) и выноски (kind 'callout') —
// раскладка, попадание, поворот, сохранение, DXF-слой, исключение из
// ведомости, баланса, ТЭП и 3D.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createLandscapeObject, landscapeDef, landscapeSummary, normalizeLandscape, objectOutline, pointInObject,
  rotateObjectAbout, translateObject,
} from '../core/landscape.js';
import {
  CALLOUT_OFFSET, calloutDxf, calloutHit, calloutLayout, calloutLines, normalizeCalloutMeta,
} from '../core/landscape-callout.js';
import {
  PLANT_GROUPS, fmtMoney, plantDefaults, plantGroupOf, plantKey, plantSchedule, setPlantEntry,
} from '../core/landscape-plants.js';
import { childrenOf, plantInPlanter } from '../core/landscape-build.js';
import { buildLandscapeCsv, landscapeBalance, landscapeDxfEntities, landscapeSchedule } from '../core/landscape-report.js';
import { landscapeFaces } from '../core/mesh3d-landscape.js';
import { buildSitePlanDxf, buildStructuredExport } from '../core/export.js';
import { tepReport } from '../core/tep.js';
import { createProject, deserializeProject, serializeProject } from '../core/model.js';

const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;
const project = (...objects) => {
  const p = createProject();
  p.site.landscape.objects.push(...objects);
  return p;
};
const garden = () => [
  createLandscapeObject('tree-fruit', 0, 0, { variant: 'apple' }),
  createLandscapeObject('tree-fruit', 5000, 0, { variant: 'apple' }),
  createLandscapeObject('tree-fruit', 9000, 0, { variant: 'pear' }),
  createLandscapeObject('shrub-flower', 0, 6000, { variant: 'lilac' }),
  createLandscapeObject('hedge-line', 0, 0, { points: [{ x: 0, y: 9000 }, { x: 6000, y: 9000 }] }),
  createLandscapeObject('flowers-clump', 0, 12000, { variant: 'lavender' }),
  createLandscapeObject('lawn-area', 0, 0, { points: [{ x: 0, y: 0 }, { x: 10000, y: 0 }, { x: 10000, y: 5000 }, { x: 0, y: 5000 }] }),
  createLandscapeObject('bed-rect', 0, 20000, { w: 3000, h: 1000 }),
  createLandscapeObject('bench', 0, 0),
  createLandscapeObject('boulder', 0, 0),
];

// ------------------------------------------------------------ Ведомость растений

test('виды и группы: деревья → кустарники → цветы → газон, вид = тип + вариант', () => {
  assert.deepEqual(PLANT_GROUPS.map((g) => g.id), ['trees', 'shrubs', 'flowers', 'lawn']);
  assert.equal(plantGroupOf('tree-pine'), 'trees');
  assert.equal(plantGroupOf('hedge-line'), 'shrubs');
  assert.equal(plantGroupOf('grass-clump'), 'flowers');
  assert.equal(plantGroupOf('lawn-patch'), 'lawn');
  for (const k of ['boulder', 'planter-box', 'bench', 'callout', 'path']) assert.equal(plantGroupOf(k), null, k);
  assert.equal(plantKey(createLandscapeObject('tree-fruit', 0, 0)), 'tree-fruit|apple');
  assert.equal(plantDefaults('tree-fruit|pear').name, 'Груша');
  assert.equal(plantDefaults('tree-pine|mugo').size, 600, 'размер посадки варианта');
  assert.equal(plantDefaults('tree-pine|scots').size, 2000, 'размер посадки типа');
  assert.match(plantDefaults('shrub-flower|lilac').note, /цветение/);
  assert.equal(plantDefaults('tree-birch|autumn').name, 'Берёза, осенняя крона');
});

test('ведомость: количество, единицы (шт, м, м²), порядок групп, без цен итог 0', () => {
  const s = plantSchedule(garden());
  assert.deepEqual(s.groups.map((g) => g.id), ['trees', 'shrubs', 'flowers', 'lawn']);
  const by = Object.fromEntries(s.rows.map((r) => [r.key, r]));
  assert.equal(by['tree-fruit|apple'].qty, 2);
  assert.equal(by['tree-fruit|apple'].unit, 'шт');
  assert.equal(by['tree-fruit|pear'].qty, 1);
  assert.equal(by['hedge-line|trim'].unit, 'м');
  assert.ok(near(by['hedge-line|trim'].qty, 6));
  assert.equal(by['lawn-area|mown'].unit, 'м²');
  assert.ok(near(by['lawn-area|mown'].qty, 50));
  assert.equal(by['bed-rect|mixed'].unit, 'м²');
  assert.ok(near(by['bed-rect|mixed'].qty, 3));
  assert.equal(s.rows.length, 7, 'скамья и валун — не растения');
  assert.deepEqual(s.rows.map((r) => r.pos), s.rows.map((_, i) => i + 1));
  assert.equal(s.total, 0);
  assert.equal(s.unpriced, 7);
  assert.equal(by['tree-fruit|apple'].price, null);
  assert.equal(by['tree-fruit|apple'].size, 1800);
});

test('справочник проекта: цена, размер посадки, примечание; сумма и итог', () => {
  const land = { objects: garden() };
  setPlantEntry(land, 'tree-fruit|apple', { price: 12000 });
  setPlantEntry(land, 'tree-fruit|apple', { size: 2500, note: 'саженец в контейнере' });
  setPlantEntry(land, 'lawn-area|mown', { price: 450.5 });
  assert.deepEqual(land.plants['tree-fruit|apple'], { size: 2500, price: 12000, note: 'саженец в контейнере' });
  const s = plantSchedule(land.objects, land.plants);
  const apple = s.rows.find((r) => r.key === 'tree-fruit|apple');
  assert.equal(apple.sum, 24000);
  assert.equal(apple.size, 2500);
  const lawn = s.rows.find((r) => r.key === 'lawn-area|mown');
  assert.equal(lawn.sum, 22525, '50 м² × 450,5');
  assert.equal(s.total, 46525);
  assert.equal(s.groups.find((g) => g.id === 'trees').total, 24000);
  // Каталожное значение и пустые поля не хранятся; пустая запись — удаляется.
  setPlantEntry(land, 'tree-fruit|apple', { size: 1800, note: '', price: null });
  assert.equal(land.plants['tree-fruit|apple'], undefined);
  setPlantEntry(land, 'lawn-area|mown', { price: null });
  assert.equal('plants' in land, false);
  assert.equal(fmtMoney(1234567.5), '1 234 567,50');
});

test('растения в коробе — в общем списке', () => {
  const box = createLandscapeObject('planter-box', 0, 0, { w: 3000, h: 1200 });
  const objects = [box];
  objects.push(...plantInPlanter(objects, box, { kind: 'flowers-clump', density: 0.6 }));
  const kids = childrenOf(objects, box.id).length;
  assert.ok(kids >= 2);
  const s = plantSchedule(objects);
  assert.equal(s.rows.length, 1, 'короб — не растение');
  assert.equal(s.rows[0].qty, kids);
});

test('справочник сохраняется в проекте; битые записи и чужие ключи отброшены', () => {
  const p = project(...garden());
  p.site.landscape.plants = {
    'tree-fruit|apple': { price: '9000', size: 2000, note: '  весна  ' },
    'nope|x': { price: 1 },
    'lawn-area|mown': { price: -5, size: 'abc' },
  };
  const back = deserializeProject(serializeProject(p));
  assert.deepEqual(back.site.landscape.plants, { 'tree-fruit|apple': { size: 2000, price: 9000, note: 'весна' } });
  assert.equal(back.site.landscape.objects.length, p.site.landscape.objects.length);
  // Старые файлы без поля — без него и остаются.
  assert.equal('plants' in normalizeLandscape({ objects: [] }), false);
});

test('экспорт: CSV-блок, JSON plant_schedule, DXF-таблица', () => {
  const p = project(...garden());
  setPlantEntry(p.site.landscape, 'tree-fruit|apple', { price: 12000 });
  const csv = buildLandscapeCsv(p);
  assert.match(csv, /Ведомость растений/);
  assert.match(csv, /Поз\.;Группа;Наименование;Кол-во;Ед\.;Размер посадки, мм;Цена за ед\.;Сумма;Цветение \/ примечание/);
  assert.match(csv, /;Деревья;Яблоня;2;шт;1800;12000;24000;цветение IV–V/);
  assert.match(csv, /Итого стоимость озеленения;;;;;24000;/);
  const ex = buildStructuredExport(p);
  const ls = ex.site.landscape;
  assert.equal(ls.plant_schedule.total, 24000);
  assert.equal(ls.plant_schedule.rows.length, 7);
  assert.deepEqual(ls.plant_book, { 'tree-fruit|apple': { price: 12000 } });
  const dxf = buildSitePlanDxf(p);
  assert.match(dxf, /LANDSCAPE_PLANT_SCHEDULE/);
  const table = landscapeDxfEntities(p.site).filter((e) => e.layer === 'lsPlantTable');
  assert.ok(table.some((e) => /24 000/.test(e.text)));
});

// ------------------------------------------------------------ Выноски

const note = (opts = {}) => createLandscapeObject('callout', 1000, 2000, opts);

test('выноска: каталог, создание по точке указания, текст и размер', () => {
  const def = landscapeDef('callout');
  assert.equal(def.shape, 'note');
  assert.equal(def.layer, 'note');
  assert.equal(def.vis, 'notes');
  assert.equal(def.surface, null);
  assert.deepEqual(def.variants.map((v) => v.id), ['dot', 'arrow', 'none']);
  const c = note();
  assert.deepEqual(c.points, [{ x: 1000, y: 2000 }], 'клик — точка указания');
  assert.deepEqual([c.x, c.y], [1000 + CALLOUT_OFFSET.x, 2000 + CALLOUT_OFFSET.y], 'текст — вверх-вправо');
  assert.deepEqual(c.meta, { text: 'Выноска', size: 300 });
  assert.equal(c.rotation, 0);
  assert.equal(normalizeCalloutMeta({ text: 'a\r\nb', size: 99999 }).size, 3000);
  assert.deepEqual(calloutLines({ meta: { text: 'Газон\nрулонный\n\n' } }), ['Газон', 'рулонный']);
});

test('выноска: полка от излома в сторону от указателя, строки над полкой', () => {
  const c = note({ meta: { text: 'Самшит\nшар 400' } });
  const L = calloutLayout(c);
  assert.equal(L.dir, 1, 'указатель слева — полка вправо');
  assert.equal(L.shelfEnd.y, c.y);
  assert.ok(L.shelfEnd.x > c.x);
  assert.equal(L.lines.length, 2);
  assert.ok(L.lines[0].y < L.lines[1].y && L.lines[1].y < c.y, 'строки сверху вниз, над полкой (ось Y вниз)');
  // Указатель справа — полка влево.
  const r = createLandscapeObject('callout', 0, 0, { points: [{ x: 5000, y: 3000 }] });
  const R = calloutLayout(r);
  assert.equal(R.dir, -1);
  assert.ok(R.shelfEnd.x < r.x);
  assert.ok(L.lines[0].x > Math.min(L.elbow.x, L.shelfEnd.x));
});

test('выноска: попадание в текст и в линию указателя, контур, перенос и поворот', () => {
  const c = note();
  const L = calloutLayout(c);
  assert.ok(pointInObject(c, { x: (L.box.minX + L.box.maxX) / 2, y: (L.box.minY + L.box.maxY) / 2 }), 'текст');
  assert.ok(calloutHit(c, { x: (L.anchor.x + L.elbow.x) / 2, y: (L.anchor.y + L.elbow.y) / 2 }), 'линия');
  assert.ok(pointInObject(c, L.anchor), 'точка указания');
  assert.equal(pointInObject(c, { x: L.anchor.x - 3000, y: L.anchor.y + 3000 }), false);
  assert.equal(objectOutline(c).length, 4);
  translateObject(c, 500, -100);
  assert.deepEqual(c.points[0], { x: 1500, y: 1900 });
  rotateObjectAbout(c, c.points[0].x, c.points[0].y, 90);
  assert.equal(c.rotation, 90, 'текст с полкой поворачивается вместе');
  assert.deepEqual(c.points[0], { x: 1500, y: 1900 });
  assert.ok(near(c.x, 1500 - (CALLOUT_OFFSET.y), 1) && near(c.y, 1900 + CALLOUT_OFFSET.x, 1), 'излом повёрнут вокруг указателя');
  const R = calloutLayout(c);
  assert.ok(near(R.shelfEnd.x, c.x, 1e-6) && R.shelfEnd.y !== c.y, 'полка — вдоль повёрнутой оси');
  assert.ok(pointInObject(c, { x: (R.corners[0].x + R.corners[2].x) / 2, y: (R.corners[0].y + R.corners[2].y) / 2 }), 'попадание в повёрнутый текст');
});

test('выноска под углом (вид повёрнут): смещение текста, DXF-текст с углом', () => {
  const c = createLandscapeObject('callout', 0, 0, { rotation: 30 });
  assert.equal(c.rotation, 30);
  const t = Math.PI / 6;
  assert.ok(near(c.x, CALLOUT_OFFSET.x * Math.cos(t) - CALLOUT_OFFSET.y * Math.sin(t), 1), 'смещение в осях текста');
  const txt = calloutDxf(c).find((e) => e.type === 'text');
  assert.equal(Math.round(txt.rotation), 30);
  assert.equal(normalizeLandscape({ objects: [c] }).objects[0].rotation, 30);
});

test('выноска: сохранение без смены схемы, битые поля — умолчания', () => {
  const c = note({ variant: 'arrow', meta: { text: 'Туя\nh 1,5 м', size: 400 } });
  const p = project(c);
  const back = deserializeProject(serializeProject(p)).site.landscape.objects[0];
  assert.deepEqual(back, c);
  const fixed = normalizeLandscape({ objects: [{ id: 'n1', kind: 'callout', x: 100, y: 200, variant: 'zzz', meta: { text: 42, size: 'x' } }] }).objects[0];
  assert.equal(fixed.variant, 'dot');
  assert.deepEqual(fixed.meta, { text: 'Выноска', size: 300 });
  assert.deepEqual(fixed.points[0], { x: 100 - CALLOUT_OFFSET.x, y: 200 - CALLOUT_OFFSET.y });
});

test('выноска: DXF — слой LANDSCAPE_NOTES (линии, знак, текст по строкам)', () => {
  const dot = calloutDxf(note({ meta: { text: 'Клён\nкрасный' } }));
  assert.equal(dot.filter((e) => e.type === 'line').length, 2, 'указатель + полка');
  assert.equal(dot.filter((e) => e.type === 'circle').length, 1, 'точка');
  assert.deepEqual(dot.filter((e) => e.type === 'text').map((e) => e.text), ['Клён', 'красный']);
  assert.ok(dot.every((e) => e.layer === 'lsNotes'));
  const arrow = calloutDxf(note({ variant: 'arrow' }));
  assert.equal(arrow.filter((e) => e.type === 'line').length, 5, 'стрелка — треугольник');
  const p = project(note({ meta: { text: 'Газон' } }));
  const dxf = buildSitePlanDxf(p);
  assert.match(dxf, /LANDSCAPE_NOTES/);
  assert.ok(landscapeDxfEntities(p.site).some((e) => e.layer === 'lsNotes' && e.type === 'text'));
});

test('выноска: не в ведомости, балансе, ТЭП, 3D и сводке', () => {
  const p = project(note(), createLandscapeObject('lawn-patch', 5000, 5000));
  p.site.boundary = [{ x: -10000, y: -10000 }, { x: 20000, y: -10000 }, { x: 20000, y: 20000 }, { x: -10000, y: 20000 }];
  assert.deepEqual(landscapeSchedule(p.site.landscape.objects).map((r) => r.kind), ['lawn-patch']);
  assert.deepEqual(plantSchedule(p.site.landscape.objects).rows.map((r) => r.kind), ['lawn-patch']);
  const withNote = landscapeBalance(p);
  p.site.landscape.objects.shift();
  assert.deepEqual(landscapeBalance(p).m2, withNote.m2, 'баланс не меняется');
  p.site.landscape.objects.unshift(note());
  assert.equal(landscapeFaces(project(note())).length, 0, '3D — пусто');
  const sum = landscapeSummary(p.site.landscape.objects);
  assert.equal(sum.count, 1);
  assert.equal(sum.notes, 1);
  assert.ok(tepReport(p));
});
