// Разрез участка по линии (core/landscape-section.js): профиль земли и
// рельефа, сечения стенок, лестниц, коробов, площадок с отметками, силуэты
// растений с глубиной, дом по этажам, хранение в site.landscape.sections,
// SVG (ui/landscape-section-svg.js) и DXF.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLandscapeObject, normalizeLandscape, normalizeSection, nextSectionName } from '../core/landscape.js';
import {
  buildSectionDxf, cutIntervals, plantShape, sectionFrame, sectionPlanDxfEntities, sectionPlanMarks, sectionProfile, stationOf,
} from '../core/landscape-section.js';
import { buildSitePlanDxf, buildStructuredExport } from '../core/export.js';
import { createOpening, createProject, createRoom, deserializeProject, serializeProject } from '../core/model.js';
import { sectionSvg, pickSectionScale } from '../ui/landscape-section-svg.js';

const near = (a, b, tol = 1) => Math.abs(a - b) <= tol;
const project = (...objects) => {
  const p = createProject();
  p.site.landscape.objects.push(...objects);
  return p;
};
const zMax = (prims) => Math.max(...prims.flatMap((p) => (p.shape === 'plant' ? [p.plant.z + p.plant.h] : p.pts.map((q) => q.z))));
const xs = (p) => p.pts.map((q) => q.x);
// Линия разреза с севера на юг по x = 2500 (ось Y вниз): «слева по ходу» — восток (+X).
const NS = [{ x: 2500, y: -6000 }, { x: 2500, y: 6000 }];

test('линия: станция, смещение (слева — положительно), участки внутри контура', () => {
  const fr = sectionFrame([{ x: 0, y: 0 }, { x: 10000, y: 0 }, { x: 10000, y: 5000 }]);
  assert.equal(fr.length, 15000);
  const a = stationOf(fr, { x: 3000, y: -2000 });
  assert.equal(a.s, 3000);
  assert.equal(a.d, 2000, 'по ходу на восток слева — север (−Y)');
  assert.equal(stationOf(fr, { x: 3000, y: 1000 }).d, -1000);
  assert.ok(stationOf(fr, { x: -500, y: 0 }).s < 0, 'за началом — отрицательная станция');
  const sq = [{ x: 2000, y: -1000 }, { x: 4000, y: -1000 }, { x: 4000, y: 1000 }, { x: 2000, y: 1000 }];
  assert.deepEqual(cutIntervals(fr, sq).map((iv) => iv.map(Math.round)), [[2000, 4000]]);
  const corner = [{ x: 9000, y: -1000 }, { x: 11000, y: -1000 }, { x: 11000, y: 1000 }, { x: 9000, y: 1000 }];
  assert.deepEqual(cutIntervals(fr, corner).map((iv) => iv.map(Math.round)), [[9000, 11000]], 'через излом — один участок');
});

test('пустой участок: ровная земля на нуле, короткая линия — null', () => {
  const prof = sectionProfile(project(), NS, 'left');
  assert.equal(prof.length, 12000);
  assert.ok(prof.ground.every((p) => p.z === 0));
  assert.equal(prof.prims.length, 0);
  assert.equal(prof.marks.length, 0, 'без рельефа отметки земли не ставятся');
  assert.equal(sectionProfile(project(), [{ x: 0, y: 0 }, { x: 50, y: 0 }], 'left'), null);
});

test('подпорная стенка: тело в сечении на реальную высоту, засыпка со стороны верха, отметки', () => {
  // Стенка вдоль X, верх — слева по ходу (север, −Y), низ — юг.
  const w = createLandscapeObject('retaining-wall', 0, 0, { points: [{ x: 0, y: 0 }, { x: 5000, y: 0 }], height: 1200, meta: { upper: 'left' } });
  const prof = sectionProfile(project(w), NS, 'left');
  const body = prof.prims.filter((p) => p.kind === 'retaining-wall');
  assert.equal(body.length, 1);
  assert.ok(body[0].cut);
  assert.ok(near(Math.max(...xs(body[0])) - Math.min(...xs(body[0])), 300), 'толщина 300');
  assert.equal(zMax(body), 1200);
  const fill = prof.prims.find((p) => p.kind === 'fill');
  assert.ok(fill, 'засыпка со стороны верха');
  assert.ok(Math.max(...xs(fill)) <= Math.min(...xs(body[0])) + 1, 'засыпка — с севера (в начале линии)');
  assert.equal(zMax([fill]), 1200);
  assert.ok(prof.marks.some((m) => m.text === '+1.20'));
  assert.ok(!prof.marks.some((m) => m.text === '±0.00'), 'на ровном участке ±0.00 у земли не ставится');
  // Смотрим в другую сторону — рисунок зеркальный: засыпка справа.
  const back = sectionProfile(project(w), NS, 'right');
  const f2 = back.prims.find((p) => p.kind === 'fill');
  const b2 = back.prims.find((p) => p.kind === 'retaining-wall');
  assert.ok(Math.min(...xs(f2)) >= Math.max(...xs(b2)) - 1);
});

test('площадка с отметкой: подиум и покрытие, верх = elev, отметка +0.90', () => {
  const pad = createLandscapeObject('paving-area', 0, 0, { points: [{ x: 0, y: -2000 }, { x: 5000, y: -2000 }, { x: 5000, y: 2000 }, { x: 0, y: 2000 }], elev: 900 });
  const prof = sectionProfile(project(pad), NS, 'left');
  const cover = prof.prims.find((p) => p.kind === 'paving-area' && p.cat === 'cover');
  assert.ok(cover?.cut);
  assert.equal(zMax([cover]), 900);
  assert.ok(near(Math.max(...xs(cover)) - Math.min(...xs(cover)), 4000));
  assert.ok(prof.prims.some((p) => p.id.endsWith(':podium')), 'подиум до земли');
  assert.ok(prof.marks.some((m) => m.text === '+0.90'));
});

test('лестница: ступени-блоки, верх = подъём, отметки низа и верха', () => {
  const st = createLandscapeObject('stairs-out', 2500, 0, { height: 750, elev: 0 });
  const prof = sectionProfile(project(st), NS, 'left');
  const steps = prof.prims.filter((p) => p.kind === 'stairs-out');
  assert.equal(steps.length, 5, '750 / 150 = 5 ступеней');
  assert.ok(steps.every((p) => p.cut));
  assert.ok(near(zMax(steps), 750));
  assert.ok(prof.marks.some((m) => m.text === '+0.75'));
});

test('короб: борта и засыпка ниже верха борта; растение в коробе стоит на засыпке', () => {
  const box = createLandscapeObject('planter-box', 2500, 0, { w: 3000, h: 1200, height: 450 });
  const plant = createLandscapeObject('shrub-box', 2500, 0, { parent: box.id });
  const prof = sectionProfile(project(box, plant), NS, 'left');
  const walls = prof.prims.filter((p) => p.kind === 'planter-box' && p.cat === 'built');
  assert.equal(walls.length, 2, 'два борта в сечении');
  const fill = prof.prims.find((p) => p.id === `${box.id}:fill`);
  assert.equal(zMax([fill]), 390);
  const sh = prof.prims.find((p) => p.kind === 'shrub-box');
  assert.equal(sh.plant.z, 390);
});

test('растения: силуэт на глубине, только со стороны взгляда, дальние — бледнее', () => {
  const near1 = createLandscapeObject('tree-pine', 5500, 0); // 3 м слева (восток)
  const far = createLandscapeObject('tree-birch', 12500, 1000); // 10 м слева
  const behind = createLandscapeObject('tree-oak', -2500, 0); // справа — за спиной
  const p = project(near1, far, behind);
  const prof = sectionProfile(p, NS, 'left', { depth: 15000 });
  const plants = prof.prims.filter((x) => x.shape === 'plant');
  assert.deepEqual(plants.map((x) => x.kind), ['tree-birch', 'tree-pine'], 'дальние раньше (под ближними)');
  assert.equal(plants[1].depth, 3000);
  assert.equal(plants[1].plant.h, 15000);
  assert.ok(plants[0].fade > plants[1].fade);
  assert.equal(plants[0].title, 'Берёза', 'вариант «крона» — не вид');
  assert.equal(plants[1].title, 'Сосна обыкновенная');
  const right = sectionProfile(p, NS, 'right');
  assert.deepEqual(right.prims.filter((x) => x.shape === 'plant').map((x) => x.kind), ['tree-oak']);
  // Крона, пересечённая линией, — в сечении.
  const cut = sectionProfile(project(createLandscapeObject('tree-oak', 3000, 0)), NS, 'right');
  assert.ok(cut.prims[0].cut);
  const sh = plantShape(plants[1]);
  assert.ok(sh.crown.length > 10 && sh.trunk.length === 4);
  // Глубина вида ограничивает силуэты.
  assert.equal(sectionProfile(p, NS, 'left', { depth: 5000 }).prims.filter((x) => x.shape === 'plant').length, 1);
});

test('рельеф: линия земли по отметкам, объекты стоят на земле, отметки на концах', () => {
  const p = project(createLandscapeObject('tree-thuja', 2500, 0));
  p.site.terrain = {
    points: [{ x: -10000, y: -10000, z: 100000 }, { x: 10000, y: -10000, z: 100000 }, { x: 10000, y: 10000, z: 102000 }, { x: -10000, y: 10000, z: 102000 }],
    floorZ: 100000, contourStep: 500, show: {},
  };
  const prof = sectionProfile(p, NS, 'left');
  const g0 = prof.ground[0]; const g1 = prof.ground[prof.ground.length - 1];
  assert.ok(near(g0.z, 400, 5) && near(g1.z, 1600, 5), `уклон 0,1: ${g0.z} → ${g1.z}`);
  const t = prof.prims.find((x) => x.kind === 'tree-thuja');
  assert.ok(near(t.plant.z, 1000, 5), 'туя на земле');
  assert.ok(prof.marks.some((m) => m.kind === 'ground' && m.text === '+0.40'));
});

test('дом: стены по этажам с проёмом, перекрытия, отметка пола', () => {
  const p = createProject();
  const room = createRoom('living', 0, -3000, 5000, 6000);
  p.rooms.push(room);
  p.openings.push(createOpening('window', room.id, 1, 3000, 1200)); // окно в правой (восточной) стене
  const prof = sectionProfile(p, [{ x: -3000, y: 0 }, { x: 8000, y: 0 }], 'left');
  const walls = prof.prims.filter((x) => x.kind === 'house-wall');
  assert.ok(walls.length >= 3, 'западная стена + восточная под и над окном');
  assert.ok(walls.every((x) => x.cut));
  assert.ok(near(zMax(walls), 3000 - 220));
  assert.ok(prof.prims.some((x) => x.kind === 'house-opening' && x.mat === 'glass'));
  assert.ok(prof.prims.some((x) => x.kind === 'house-slab'));
  assert.ok(prof.marks.some((m) => m.text === '±0.00') && prof.marks.some((m) => m.text === '+3.00'));
  // Линия мимо дома — силуэт на глубине.
  const by = sectionProfile(p, [{ x: -3000, y: -8000 }, { x: 8000, y: -8000 }], 'right');
  const h = by.prims.find((x) => x.kind === 'house');
  assert.ok(h && !h.cut && near(h.depth, 8000 - 3000 - 250, 10));
});

test('хранение: site.landscape.sections — необязательное поле, старые проекты не меняются', () => {
  const n = normalizeLandscape({ objects: [], sections: [{ points: [{ x: 0, y: 0 }, { x: 5000, y: 0 }], side: 'right', name: 'Б', depth: 9e9 }, { points: [{ x: 0, y: 0 }] }] });
  assert.equal(n.sections.length, 1);
  assert.equal(n.sections[0].side, 'right');
  assert.equal(n.sections[0].depth, 100000);
  assert.equal('sections' in normalizeLandscape({ objects: [] }), false);
  assert.equal(normalizeSection({ points: [{ x: 0, y: 0 }, { x: 10, y: 0 }] }), null, 'слишком короткая');
  assert.equal(nextSectionName([{ name: 'А' }, { name: 'Б' }]), 'В');
  const p = createProject();
  p.site.landscape.sections = [normalizeSection({ id: 's1', name: 'А', points: NS })];
  const back = deserializeProject(serializeProject(p));
  assert.deepEqual(back.site.landscape.sections, p.site.landscape.sections);
  const json = buildStructuredExport(p);
  assert.equal(json.site?.landscape?.sections?.[0]?.name, 'А');
});

test('SVG: оба стиля, заголовок, масштаб, отметки и подписи', () => {
  const w = createLandscapeObject('retaining-wall', 0, 0, { points: [{ x: 0, y: 0 }, { x: 5000, y: 0 }], height: 1200 });
  const prof = sectionProfile(project(w, createLandscapeObject('tree-spruce', 5000, 2000)), { points: NS, name: 'А' }, 'left');
  assert.equal(pickSectionScale(prof), 100, "ель 14 м — в поле A3 при 1:100");
  for (const style of ['sketch', 'drawing']) {
    const svg = sectionSvg(prof, { style });
    assert.match(svg, /^<svg[^>]+viewBox/);
    assert.match(svg, /Разрез А–А/);
    assert.match(svg, /М 1:100/);
    assert.match(svg, /\+1\.20/);
    assert.match(svg, /Подпорная стенка/);
    assert.match(svg, /data-kind="ground"/);
    assert.equal((svg.match(/<svg/g) || []).length, 1);
  }
  assert.match(sectionSvg(prof, { style: 'sketch' }), /feTurbulence/);
  assert.match(sectionSvg(prof, { style: 'drawing' }), /pattern id="ks-d-concrete"/);
});

test('DXF: разрез на слое LANDSCAPE_SECTION; линия разреза на генплане', () => {
  const w = createLandscapeObject('retaining-wall', 0, 0, { points: [{ x: 0, y: 0 }, { x: 5000, y: 0 }], height: 1200 });
  const prof = sectionProfile(project(w), { points: NS, name: 'А' }, 'left');
  const dxf = buildSectionDxf(prof);
  assert.match(dxf, /LANDSCAPE_SECTION/);
  assert.match(dxf, /\+1\.20/);
  assert.ok((dxf.match(/\nLINE\n/g) || []).length > 10);
  const sec = normalizeSection({ name: 'А', points: NS, side: 'left' });
  const m = sectionPlanMarks(sec, 1000);
  assert.equal(m.ends.length, 2);
  assert.ok(m.ends.every((e) => e.dir.x === 1 && e.dir.y === 0), 'стрелки — в сторону взгляда (восток)');
  assert.ok(sectionPlanDxfEntities([sec]).some((e) => e.type === 'text' && e.text === 'А'));
  const p = project(w);
  p.site.boundary = [{ x: -10000, y: -10000 }, { x: 10000, y: -10000 }, { x: 10000, y: 10000 }, { x: -10000, y: 10000 }];
  p.site.landscape.sections = [sec];
  assert.match(buildSitePlanDxf(p), /LANDSCAPE_SECTION/);
});
