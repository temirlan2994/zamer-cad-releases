// Ландшафт (core/landscape.js): каталог, объекты, геометрия, хранение в проекте.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  LANDSCAPE_CATALOG, LANDSCAPE_CATEGORIES, LANDSCAPE_SHAPES, TREE_HOUSE_MIN, createLandscapeObject,
  hitLandscape, isOutsideSite, landscapeByCategory, landscapeDef, landscapeHandles, landscapeSummary,
  landscapeWarnings, normalizeLandscape, objectBox, objectCorners, objectsInPolygon, pointInObject,
  resizeObject, searchLandscape, seededRandom,
} from '../core/landscape.js';
import { createProject, deserializeProject, serializeProject } from '../core/model.js';
import { buildStructuredExport } from '../core/export.js';

const fixture = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const square = (s) => [{ x: 0, y: 0 }, { x: s, y: 0 }, { x: s, y: s }, { x: 0, y: s }];

test('каталог валиден: id уникальны, размеры > 0, категории не пусты', () => {
  const kinds = LANDSCAPE_CATALOG.map((d) => d.kind);
  assert.equal(new Set(kinds).size, kinds.length, 'kind уникальны');
  for (const d of LANDSCAPE_CATALOG) {
    assert.ok(d.title && d.group, d.kind);
    assert.ok(LANDSCAPE_CATEGORIES.some((c) => c.id === d.cat), `${d.kind}: категория`);
    assert.ok(LANDSCAPE_SHAPES.includes(d.shape), `${d.kind}: форма`);
    assert.ok(d.w > 0 && d.h > 0, `${d.kind}: размер`);
    assert.ok(d.min.w > 0 && d.min.h > 0 && d.min.w <= d.w && d.min.h <= d.h, `${d.kind}: минимум`);
    assert.ok(d.max.w >= d.w && d.max.h >= d.h, `${d.kind}: максимум`);
    assert.ok(d.variants.length >= 1, `${d.kind}: варианты`);
    assert.equal(new Set(d.variants.map((v) => v.id)).size, d.variants.length, `${d.kind}: id вариантов`);
    assert.ok((d.shape === 'note' ? ['note'] : ['ground', 'low', 'tall']).includes(d.layer), `${d.kind}: слой`);
    assert.ok(d.colors.length >= 3 && d.colors.every((c) => /^#[0-9a-f]{6}$/i.test(c)), `${d.kind}: краски`);
    if (d.shape === 'point' || d.shape === 'circle') assert.equal(d.w, d.h, `${d.kind}: круглый`);
  }
  for (const c of LANDSCAPE_CATEGORIES) assert.ok(landscapeByCategory(c.id).length >= 10, c.id);
  // Этап 2: линейные и площадные доступны в каталоге (рисуются мышью).
  assert.ok(landscapeByCategory('site').some((d) => d.shape === 'line'));
  assert.ok(landscapeByCategory('site').some((d) => d.shape === 'poly'));
  assert.ok(LANDSCAPE_CATALOG.every((d) => d.stage === 1));
  for (const d of LANDSCAPE_CATALOG) assert.ok(['green', 'hard', 'water', null].includes(d.surface), `${d.kind}: поверхность`);
  for (const kind of ['tree-pine', 'tree-thuja', 'shrub-box', 'parking-2', 'firepit', 'pool', 'pond', 'gazebo', 'carport']) {
    assert.ok(landscapeDef(kind), kind);
  }
  assert.ok(searchLandscape('сосн').some((d) => d.kind === 'tree-pine'));
  assert.ok(searchLandscape('парков').length >= 2);
});

test('создание объекта: умолчания типа, радиус кроны, пределы размера', () => {
  const tree = createLandscapeObject('tree-oak', 1003, 2007);
  assert.equal(tree.kind, 'tree-oak');
  assert.equal(tree.w, tree.h);
  assert.equal(tree.r, tree.w / 2);
  assert.equal(tree.variant, landscapeDef('tree-oak').variants[0].id);
  assert.equal(tree.height, landscapeDef('tree-oak').height);
  assert.ok(tree.id.startsWith('ls-'));
  resizeObject(tree, 3000, 9000); // круглый — по одной стороне
  assert.equal(tree.w, 3000);
  assert.equal(tree.h, 3000);
  assert.equal(tree.r, 1500);
  resizeObject(tree, 1);
  assert.equal(tree.w, landscapeDef('tree-oak').min.w);
  const park = createLandscapeObject('parking-1', 0, 0, { rotation: 450 });
  assert.equal(park.rotation, 90);
  assert.equal(park.r, undefined);
  resizeObject(park, 3000, 99999);
  assert.deepEqual([park.w, park.h], [3000, landscapeDef('parking-1').max.h]);
  assert.throws(() => createLandscapeObject('нет-такого', 0, 0));
});

test('геометрия: углы с поворотом, попадание, рамка, ручки', () => {
  const p = createLandscapeObject('parking-1', 0, 0); // 2500 × 5300
  assert.ok(pointInObject(p, { x: 1200, y: 2600 }));
  assert.ok(!pointInObject(p, { x: 1300, y: 0 }));
  p.rotation = 90;
  const box = objectBox(p);
  assert.ok(Math.abs(box.maxX - 2650) < 1e-6 && Math.abs(box.maxY - 1250) < 1e-6);
  assert.ok(pointInObject(p, { x: 2600, y: 0 }));
  assert.ok(!pointInObject(p, { x: 0, y: 1300 }));
  const nw = objectCorners(p).find((c) => c.id === 'nw');
  assert.ok(Math.abs(nw.x - 2650) < 1e-6 && Math.abs(nw.y + 1250) < 1e-6, 'nw после поворота на 90°');
  // Круглая крона: угол габарита — мимо.
  const t = createLandscapeObject('tree-pine', 10000, 0);
  assert.ok(pointInObject(t, { x: 10000 + 2400, y: 0 }));
  assert.ok(!pointInObject(t, { x: 10000 + 2400, y: 2400 }));
  // Сверху — высокий объект (крона над площадкой).
  const pad = createLandscapeObject('pad', 10000, 0, { w: 8000, h: 8000 });
  assert.equal(hitLandscape([t, pad], { x: 10000, y: 0 }).id, t.id);
  assert.equal(hitLandscape([pad, t], { x: 13500, y: 3500 }).id, pad.id);
  assert.equal(hitLandscape([pad, t], { x: 50000, y: 0 }), null);
  const inRect = objectsInPolygon([p, t], [{ x: -100, y: -100 }, { x: 100, y: -100 }, { x: 100, y: 100 }, { x: -100, y: 100 }]);
  assert.deepEqual(inRect.map((o) => o.id), [p.id]);
  const { corners, rotators } = landscapeHandles(t, 20, 0.02);
  assert.equal(corners.length, 4);
  assert.equal(rotators.length, 4);
  assert.ok(Math.hypot(rotators[0].x - t.x, rotators[0].y - t.y) > Math.hypot(corners[0].x - t.x, corners[0].y - t.y));
});

test('выход за участок и дерево у дома — мягкие предупреждения', () => {
  const boundary = square(30000);
  const inside = createLandscapeObject('tree-birch', 15000, 15000);
  const edge = createLandscapeObject('tree-birch', 1000, 15000); // крона 5 м — за границей
  assert.equal(isOutsideSite(inside, boundary), false);
  assert.equal(isOutsideSite(edge, boundary), true);
  assert.equal(isOutsideSite(edge, null), false, 'без границы — не проверяем');
  const house = [{ x: 16000, y: 10000 }, { x: 26000, y: 10000 }, { x: 26000, y: 14000 }, { x: 16000, y: 14000 }];
  const w = landscapeWarnings([inside, edge], { boundary, footprints: [house] });
  assert.equal(w.has(edge.id), false, 'предупреждение «за границей участка» отключено');
  assert.ok(w.get(inside.id).some((t) => t.includes('от дома')), `ближе ${TREE_HOUSE_MIN} мм к дому`);
  const far = createLandscapeObject('tree-birch', 5000, 25000);
  assert.equal(landscapeWarnings([far], { boundary, footprints: [house] }).has(far.id), false);
  // Не дерево у дома — без замечания.
  const bench = createLandscapeObject('bench', 15000, 15000);
  assert.equal(landscapeWarnings([bench], { boundary, footprints: [house] }).has(bench.id), false);
});

test('нормализация: битые объекты отброшены, повторные id заменены', () => {
  const good = createLandscapeObject('pool', 0, 0);
  const n = normalizeLandscape({
    objects: [good, { kind: 'нет', x: 0, y: 0 }, { kind: 'pool', x: 'a' }, null, { ...good }, { kind: 'tree-pine', x: 1, y: 2, r: 1500 }],
  });
  assert.equal(n.objects.length, 3);
  assert.equal(new Set(n.objects.map((o) => o.id)).size, 3);
  assert.equal(n.objects[2].w, 3000, 'r старой записи → диаметр');
  assert.deepEqual(normalizeLandscape(undefined), { objects: [] });
  assert.deepEqual(normalizeLandscape({ objects: 'x' }), { objects: [] });
});

test('проект: поле необязательное — старые файлы без него, пересохранение без потерь', () => {
  for (const name of ['v1-project.kepler.json', 'v4-project.kepler.json']) {
    const p = deserializeProject(fixture(name));
    assert.deepEqual(p.site.landscape, { objects: [] }, name);
  }
  const raw = JSON.parse(serializeProject(createProject()));
  delete raw.site.landscape;
  assert.deepEqual(deserializeProject(JSON.stringify(raw)).site.landscape, { objects: [] });

  const p = createProject();
  p.site.landscape.objects.push(createLandscapeObject('firepit', 5000, 6000, { variant: 'stones' }));
  p.site.landscape.objects.push(createLandscapeObject('tree-fruit', 1000, 2000, { variant: 'cherry', rotation: 30 }));
  const again = deserializeProject(serializeProject(p));
  assert.deepEqual(again.site.landscape, p.site.landscape);
  assert.deepEqual(deserializeProject(serializeProject(again)), again);
});

test('экспорт JSON kepler-export/2: ландшафт в участке, версия та же', () => {
  const p = createProject();
  const ex0 = buildStructuredExport(p);
  assert.equal(ex0.schema, 'kepler-export/2');
  assert.equal(ex0.site?.landscape ?? null, null);
  p.site.landscape.objects.push(createLandscapeObject('parking-2', 3000, 4000));
  const ex = buildStructuredExport(p);
  assert.equal(ex.schema, 'kepler-export/2');
  const [o] = ex.site.landscape.objects;
  assert.equal(o.kind, 'parking-2');
  assert.equal(o.title, 'Парковка на 2 машины');
  assert.equal(o.cover, true);
  assert.deepEqual([o.x, o.y, o.w, o.h], [3000, 4000, 5200, 5300]);
});

test('сводка и детерминированный разброс текстур', () => {
  const objs = [createLandscapeObject('tree-pine', 0, 0), createLandscapeObject('pad', 0, 0, { w: 2000, h: 3000 }), createLandscapeObject('bench', 0, 0)];
  const s = landscapeSummary(objs);
  assert.equal(s.count, 3);
  assert.equal(s.trees, 1);
  assert.ok(Math.abs(s.coverM2 - 6) < 1e-9);
  const a = seededRandom('ls-1');
  const b = seededRandom('ls-1');
  const xs = [a(), a(), a()];
  assert.deepEqual(xs, [b(), b(), b()]);
  assert.ok(xs.every((x) => x >= 0 && x < 1));
  assert.notEqual(seededRandom('ls-2')(), xs[0]);
});
