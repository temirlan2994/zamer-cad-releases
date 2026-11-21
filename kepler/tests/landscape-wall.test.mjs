// Ландшафт: подпорная стенка (по линии) и отметки уровня площадок —
// каталог, расчёт объёма, стороны верха/низа, сохранение, 3D, ведомость,
// ТЭП, экспорт JSON и DXF.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyStairsDrop, createLandscapeObject, fmtElev, landscapeDef, normalizeElev, normalizeLandscape, retainingEdges,
  retainingInfo, stairsDrop, stairsInfo,
} from '../core/landscape.js';
import { landscapeFaces } from '../core/mesh3d-landscape.js';
import { landscapeDxfEntities, landscapeSchedule, retainingTotals } from '../core/landscape-report.js';
import { buildSitePlanDxf, buildStructuredExport } from '../core/export.js';
import { tepReport, tepRows } from '../core/tep.js';
import { createProject, deserializeProject, serializeProject } from '../core/model.js';

const near = (a, b, tol = 1) => Math.abs(a - b) <= tol;
const zs = (faces) => faces.flatMap((f) => f.pts.map((q) => q.z));
const project = (...objects) => {
  const p = createProject();
  p.site.landscape.objects.push(...objects);
  return p;
};
const wall = (opts = {}) => createLandscapeObject('retaining-wall', 0, 0, { points: [{ x: 0, y: 0 }, { x: 5000, y: 0 }], ...opts });

test('каталог: подпорная стенка — линия, материалы, умолчания', () => {
  const def = landscapeDef('retaining-wall');
  assert.equal(def.shape, 'line');
  assert.equal(def.group, 'Подпорные стенки');
  assert.equal(def.vis, 'objects');
  assert.equal(def.surface, null, 'не покрытие — в баланс не входит');
  assert.deepEqual(def.variants.map((v) => v.id), ['concrete', 'stone', 'gabion', 'corten']);
  const w = wall();
  assert.equal(w.width, 300);
  assert.equal(w.height, 1200);
  assert.deepEqual(w.meta, { upper: 'left', drop: 0, cap: false, capH: 60 });
  assert.equal('elev' in w, false);
});

test('стенка: объём тела и капы, перепад и парапет', () => {
  const ri = retainingInfo(wall());
  assert.equal(ri.length, 5000);
  assert.equal(ri.drop, 1200, 'перепад 0 — равен высоте');
  assert.equal(ri.parapet, 0);
  assert.ok(near(ri.volume, 5 * 0.3 * 1.2, 1e-9), String(ri.volume));
  const c = retainingInfo(wall({ height: 1000, meta: { drop: 700, cap: true, capH: 80 } }));
  assert.equal(c.parapet, 300);
  assert.equal(c.capW, 360);
  assert.ok(near(c.bodyM3, 5 * 0.3 * 1.0, 1e-9));
  assert.ok(near(c.capM3, 5 * 0.36 * 0.08, 1e-9));
  assert.ok(near(c.volume, c.bodyM3 + c.capM3, 1e-12));
  // Перепад больше высоты — не больше высоты; битые поля — по умолчанию.
  assert.equal(retainingInfo(wall({ height: 800, meta: { drop: 5000 } })).drop, 800);
  assert.deepEqual(wall({ meta: { upper: 'x', cap: 'yes', capH: -5 } }).meta, { upper: 'left', drop: 0, cap: false, capH: 20 });
});

test('стенка: кромки верха и низа по ходу линии (ось Y вниз)', () => {
  // Линия вправо: «слева по ходу» — сверху на экране (−Y).
  const l = retainingEdges(wall());
  assert.ok(l.upper.every((p) => near(p.y, -150)), JSON.stringify(l.upper));
  assert.ok(l.lower.every((p) => near(p.y, 150)));
  assert.equal(l.lowSign, 1);
  const r = retainingEdges(wall({ meta: { upper: 'right' } }));
  assert.ok(r.upper.every((p) => near(p.y, 150)));
  assert.equal(r.lowSign, -1);
});

test('отметки: нормализация, подпись, перепад лестницы', () => {
  assert.equal(normalizeElev(''), null);
  assert.equal(normalizeElev(null), null);
  assert.equal(normalizeElev('abc'), null);
  assert.equal(normalizeElev('450.4'), 450);
  assert.equal(normalizeElev(99999), 20000);
  assert.equal(fmtElev(450), '+0.45');
  assert.equal(fmtElev(-300), '−0.30');
  assert.equal(fmtElev(0), '±0.00');
  const pav = createLandscapeObject('paving-area', 0, 0, { elev: 450 });
  assert.equal(pav.elev, 450);
  // Отметка — только у площадок, дорожки, лестницы, стенки.
  assert.equal('elev' in createLandscapeObject('bench', 0, 0, { elev: 300 }), false);
  const st = createLandscapeObject('stairs-out', 0, 0, { elev: 0, elevTo: 600 });
  assert.equal(stairsDrop(st), 600);
  assert.equal(applyStairsDrop(st), true);
  assert.equal(st.height, 600);
  assert.equal(stairsInfo(st).steps, 4);
  assert.equal(st.h, 4 * 300, 'длина в плане пересчитана');
  assert.equal(stairsDrop(createLandscapeObject('stairs-out', 0, 0, { elev: 500, elevTo: 200 })), null);
  assert.equal(applyStairsDrop(createLandscapeObject('stairs-out', 0, 0, { elev: 100 })), false);
});

test('сохранение: стенка и отметки переживают сериализацию; старые проекты — без полей', () => {
  const p = project(
    wall({ id: 'rw', height: 900, variant: 'gabion', elev: -200, meta: { upper: 'right', drop: 600, cap: true } }),
    createLandscapeObject('deck-area', 0, 0, { id: 'dk', elev: 450 }),
    createLandscapeObject('stairs-out', 0, 0, { id: 'st', elev: 0, elevTo: 450 }),
  );
  const objs = deserializeProject(serializeProject(p)).site.landscape.objects;
  const by = (id) => objs.find((o) => o.id === id);
  assert.equal(by('rw').variant, 'gabion');
  assert.equal(by('rw').height, 900);
  assert.equal(by('rw').elev, -200);
  assert.deepEqual(by('rw').meta, { upper: 'right', drop: 600, cap: true, capH: 60 });
  assert.equal(by('dk').elev, 450);
  assert.deepEqual([by('st').elev, by('st').elevTo], [0, 450]);
  const old = normalizeLandscape({ objects: [{ id: 'a', kind: 'paving-area', x: 0, y: 0, points: [{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 1000, y: 1000 }] }] }).objects[0];
  assert.equal('elev' in old, false);
  const bad = normalizeLandscape({ objects: [{ id: 'b', kind: 'paving-area', x: 0, y: 0, elev: 'x', points: [{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 1000, y: 1000 }] }] }).objects[0];
  assert.equal('elev' in bad, false);
});

test('3D: стенка нужной высоты, капа сверху, площадка на отметке с подиумом', () => {
  assert.equal(Math.max(...zs(landscapeFaces(project(wall({ height: 1500 }))))), 1500);
  const capped = landscapeFaces(project(wall({ height: 1000, meta: { cap: true, capH: 80 } })));
  assert.equal(Math.max(...zs(capped)), 1080);
  assert.equal(Math.min(...zs(capped)), 0);
  const pts = [{ x: 0, y: 0 }, { x: 4000, y: 0 }, { x: 4000, y: 3000 }, { x: 0, y: 3000 }];
  const flat = landscapeFaces(project(createLandscapeObject('paving-area', 0, 0, { points: pts })));
  const raised = landscapeFaces(project(createLandscapeObject('paving-area', 0, 0, { points: pts, elev: 450 })));
  assert.equal(Math.max(...zs(raised)), Math.max(...zs(flat)) + 450);
  assert.equal(Math.min(...zs(raised)), 0, 'бока подиума — от земли');
  assert.ok(raised.some((f) => f.normal.z === 0), 'есть боковые грани');
  // Лестница на отметке +0,30: низ ступеней поднят.
  const st = landscapeFaces(project(createLandscapeObject('stairs-out', 0, 0, { height: 600, elev: 300 })));
  assert.equal(Math.max(...zs(st)), 900);
});

test('ведомость, ТЭП, экспорт JSON и DXF: длина, высота, объём', () => {
  const a = wall({ height: 1000 });
  const b = createLandscapeObject('retaining-wall', 0, 0, { points: [{ x: 0, y: 3000 }, { x: 3000, y: 3000 }], height: 1000 });
  const c = createLandscapeObject('retaining-wall', 0, 0, { points: [{ x: 0, y: 6000 }, { x: 2000, y: 6000 }], height: 600, variant: 'stone' });
  const rows = landscapeSchedule([a, b, c]).filter((r) => r.kind === 'retaining-wall');
  assert.equal(rows.length, 2, 'по материалу и сечению');
  const conc = rows.find((r) => r.count === 2);
  assert.ok(near(conc.length, 8, 1e-9));
  assert.ok(near(conc.volume, 8 * 0.3 * 1.0, 1e-9));
  assert.match(conc.size, /^300×1000 мм, V 2,40 м³$/);
  assert.equal(conc.area, 0);
  const t = retainingTotals([a, b, c]);
  assert.deepEqual([t.count, t.length], [3, 10]);
  const p = project(a, c);
  const tep = tepRows(tepReport(p));
  const row = tep.find(([k]) => k === 'Подпорные стенки');
  assert.ok(row, JSON.stringify(tep));
  assert.match(row[1], /^7,0 м · 1,86 м³ \(2 шт\.\)$/);
  assert.equal(tepRows(tepReport(createProject())).some(([k]) => k === 'Подпорные стенки'), false);
  // JSON: необязательные поля без смены схемы.
  a.elev = -300;
  const ex = buildStructuredExport(p);
  const ea = ex.site.landscape.objects.find((o) => o.id === a.id);
  assert.equal(ea.elev_mm, -300);
  assert.deepEqual(ea.retaining, { thickness_mm: 300, height_mm: 1000, drop_mm: 1000, parapet_mm: 0, upper_side: 'left', cap: false, length_m: 5, volume_m3: 1.5 });
  // DXF: двойная линия + торцы + штрихи к низу (+Y) + отметка текстом.
  const ents = landscapeDxfEntities({ landscape: { objects: [a] } }).filter((e) => e.layer === 'lsWalls');
  const lines = ents.filter((e) => e.type === 'line');
  const ticks = lines.filter((e) => near(e.x1, e.x2, 1e-6) && e.y1 > 100);
  assert.equal(ticks.length, 8, String(ticks.length));
  assert.ok(ticks.every((e) => e.y2 > e.y1), 'штрихи — в сторону низа');
  assert.equal(lines.length, 2 + 2 + ticks.length);
  assert.equal(ents.find((e) => e.type === 'text').text, '−0.30 / +0.70');
  assert.match(buildSitePlanDxf(p), /LANDSCAPE_WALLS/);
});
