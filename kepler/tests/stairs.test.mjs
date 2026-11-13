import test from 'node:test';
import assert from 'node:assert/strict';

import { buildHouseMesh } from '../core/mesh3d.js';
import { buildSection } from '../core/section.js';
import { createItem, createProject, createRoom, deserializeProject, serializeProject } from '../core/model.js';
import {
  STAIR_BUILDS, applyStairPreset, dragStairHandle, stairBuild, materializeStair, setStairParam, stairCalculation, stairHandles, stairLayout, stairPreset,
} from '../core/stairs.js';

test('быстрые формы лестницы подбирают компактные габариты', () => {
  const straight = stairPreset('straight', 3000);
  const turn = stairPreset('l', 3000);
  const u = stairPreset('u', 3000);
  assert.equal(straight.w, 1000);
  assert.ok(straight.h > u.h, 'П-образная лестница короче прямой');
  assert.ok(turn.w > 2500 && turn.h > 2500);
  assert.deepEqual(u, { w: 2200, h: 3160 }); // 2 марша по 1000 + зазор 200; площадка 1000 + 8 × 270
});

test('автоподбор даёт удобные ступени под высоту этажа', () => {
  const stair = createItem('stairs', 0, 0, 1000, 3000);
  applyStairPreset(stair, 'u', 3000);
  const calc = stairCalculation(stair);
  assert.equal(calc.shape, 'u');
  assert.ok(calc.okRiser);
  assert.ok(calc.okTread);
  assert.ok(calc.okComfort);
  assert.ok(calc.risers >= 16 && calc.risers <= 18);
});

test('лестница создаёт настоящие ступени в 3D', () => {
  const project = createProject('Лестница в 3D');
  const room = createRoom('stairs-room', 0, 0, 2400, 3500);
  const stair = createItem('stairs', 1200, 1750, 2200, 3250);
  applyStairPreset(stair, 'u', 3000);
  project.rooms.push(room);
  project.items.push(stair);
  const faces = buildHouseMesh(project).filter((face) => face.kind === 'stairs');
  assert.ok(faces.length > 40);
  assert.ok(faces.every((face) => face.itemId === stair.id));
  const top = Math.max(...faces.filter((face) => face.part === 'tread').flatMap((face) => face.pts.map((point) => point.z)));
  assert.ok(top > 2700 && top < 3000);
});

// --- П-образная в 3 марша; ручки; параметры ---

const make = (shape, h = 3000) => applyStairPreset(createItem('stairs', 0, 0, 1000, 3000), shape, h);
const handle = (item, id) => stairHandles(item).find((x) => x.id === id);
const pull = (item, id, mm, opts) => {
  const h = handle(item, id);
  return dragStairHandle(item, id, { x: h.x + h.out.x * mm, y: h.y + h.out.y * mm }, opts);
};
const inside = (rect, lay) => rect.x >= -lay.W / 2 - 0.01 && rect.y >= -lay.H / 2 - 0.01
  && rect.x + rect.w <= lay.W / 2 + 0.01 && rect.y + rect.h <= lay.H / 2 + 0.01;
const overlap = (a, b) => Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > 0.5
  && Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > 0.5;
const noOverlaps = (lay, msg) => {
  const parts = [...lay.flights, ...lay.landings];
  for (let i = 0; i < parts.length; i += 1) {
    assert.ok(inside(parts[i], lay), `${msg}: часть ${i} в габарите`);
    for (let j = i + 1; j < parts.length; j += 1) assert.ok(!overlap(parts[i], parts[j]), `${msg}: части ${i} и ${j} не налезают`);
  }
};
// Левый верхний угол габарита в осях плана.
const topLeft = (it) => {
  const a = ((it.rotation || 0) * Math.PI) / 180;
  return { x: it.x - (it.w / 2) * Math.cos(a) + (it.h / 2) * Math.sin(a), y: it.y - (it.w / 2) * Math.sin(a) - (it.h / 2) * Math.cos(a) };
};

test('П-образная в 3 марша: три марша, две площадки, ступени по высоте этажа', () => {
  const s = make('u3', 3000);
  const lay = stairLayout(s);
  const calc = stairCalculation(s);
  assert.equal(lay.flights.length, 3);
  assert.equal(lay.landings.length, 2);
  assert.equal(calc.risers, 17);
  // 17 подъёмов: 16 горизонталей ниже перекрытия, из них 2 — площадки.
  assert.equal(calc.treads, 14);
  assert.deepEqual(calc.flights, [5, 4, 5]);
  assert.ok(calc.okRiser && calc.okTread && calc.okComfort && calc.okWidth && calc.okFlights && calc.okLandings, calc.warnings.join('; '));
  assert.equal(s.w, 1000 + 4 * 270 + 1000, 'по X: площадка + 4 проступи + площадка');
  assert.equal(s.h, 1000 + 5 * 270, 'по Y: площадка + 5 проступей');
  assert.deepEqual(lay.flights.map((f) => [f.dir.x, f.dir.y]), [[0, -1], [1, 0], [0, 1]], 'вверх, поперёк, вниз по плану');
  noOverlaps(lay, 'П3');
  assert.deepEqual(lay.flights.map((f) => f.startStep), [1, 7, 12]);
  assert.deepEqual(lay.landings.map((l) => l.step), [6, 11]);
  assert.equal(lay.flights[2].startStep + lay.flights[2].n - 1, calc.risers - 1, 'последняя проступь — на подъём ниже перекрытия');
});

test('П-образная в 3 марша в 3D: ступени растут до перекрытия', () => {
  const project = createProject('П3');
  project.items.push(make('u3', 3000));
  const faces = buildHouseMesh(project).filter((f) => f.kind === 'stairs' && (f.part === 'tread' || f.part === 'landing'));
  const top = Math.max(...faces.flatMap((f) => f.pts.map((p) => p.z)));
  assert.ok(Math.abs(top - 16 * (3000 / 17)) < 1, `верх ${top}`);
});

test('ручка марша: тянешь нижний марш — верхние ступени убывают, сумма та же', () => {
  for (const shape of ['l', 'u', 'u3']) {
    const s = make(shape);
    const before = stairCalculation(s);
    const next = pull(s, 'steps:0', 2 * 270 + 20);
    const after = stairCalculation(next);
    assert.equal(after.treads, before.treads, `${shape}: сумма ступеней сохраняется`);
    assert.equal(after.flights[0], before.flights[0] + 2, `${shape}: первый марш +2`);
    const last = after.flights.length - 1;
    assert.equal(after.flights[last], before.flights[last] - 2, `${shape}: верхний марш −2`);
    assert.ok(Math.abs(topLeft(next).x - topLeft(s).x) < 0.01 && Math.abs(topLeft(next).y - topLeft(s).y) < 0.01, `${shape}: площадка на месте`);
    noOverlaps(stairLayout(next), shape);
  }
  const s = make('u');
  const far = stairCalculation(pull(s, 'steps:0', 20000));
  assert.equal(far.flights[1], 1, 'в марше не меньше одной проступи');
  assert.equal(far.treads, stairCalculation(s).treads);
});

test('ручка марша у прямой меняет проступь, ступеней столько же', () => {
  const s = make('straight');
  const next = pull(s, 'going', 16 * 20, { snap: 10 });
  assert.equal(next.going, 290);
  assert.equal(stairCalculation(next).treads, 16);
  assert.equal(next.h, 16 * 290);
});

test('ручка ширины марша: по курсору, не уже 900, с шагом; Shift — без шага', () => {
  const s = make('u3');
  // У П3 шире оба боковых марша и площадки: кромка уходит на 2Δ ширины.
  const next = pull(s, 'width', 200, { snap: 50 });
  assert.equal(next.flightWidth, 1100);
  const h0 = handle(s, 'width');
  const h1 = handle(next, 'width');
  assert.ok(Math.abs((h1.x - h0.x) * h0.out.x + (h1.y - h0.y) * h0.out.y - 200) < 1, 'кромка под курсором');
  assert.equal(pull(s, 'width', -600).flightWidth, 900, 'норма — не уже 900');
  assert.equal(pull(make('straight'), 'width', 123, { snap: 1 }).flightWidth, 1123, 'без шага');
  assert.equal(pull(make('u'), 'width', 200, { snap: 50 }).flightWidth, 1100, 'П: оба марша шире, кромка под курсором');
});

test('ручки углов площадки: размеры площадки, марши не ломаются', () => {
  const l = make('l');
  const h = handle(l, 'landing:0');
  const next = dragStairHandle(l, 'landing:0', { x: h.x - 300, y: h.y - 200 }, { snap: 50 });
  assert.deepEqual(next.landings, [{ w: 1300, h: 1200 }]);
  assert.deepEqual(next.flights, l.flights, 'ступени те же');
  const u = make('u');
  const hu = handle(u, 'landing:0');
  const nu = dragStairHandle(u, 'landing:0', { x: hu.x - 100, y: hu.y - 400 }, { snap: 50 });
  assert.equal(nu.gap, 300);
  assert.equal(nu.landingDepth, 1400);
  const small = dragStairHandle(u, 'landing:0', { x: hu.x + 50, y: hu.y + 800 }, { snap: 50 });
  assert.equal(small.landingDepth, 1000, 'площадка не уже марша');
  const u3 = make('u3');
  for (const id of ['landing:0', 'landing:1']) {
    const hh = handle(u3, id);
    const n3 = dragStairHandle(u3, id, { x: hh.x + hh.out.x * 300, y: hh.y - 300 }, { snap: 50 });
    noOverlaps(stairLayout(n3), id);
    assert.deepEqual(n3.flights, u3.flights);
    assert.ok(n3.w > u3.w && n3.h > u3.h, `${id}: площадка больше`);
  }
});

test('повёрнутая и отражённая лестница: ручка тянется по курсору', () => {
  const s = { ...make('u3'), rotation: 90, mirrored: true, x: 5000, y: 2000 };
  const h0 = handle(s, 'width');
  const next = pull(s, 'width', 300, { snap: 50 });
  const h1 = handle(next, 'width');
  assert.equal(next.flightWidth, 1150);
  assert.ok(Math.abs((h1.x - h0.x) * h0.out.x + (h1.y - h0.y) * h0.out.y - 300) < 1);
});

test('числовой ввод: ступени марша, подъёмы, ширина; нормы с предупреждением', () => {
  const s = make('u3');
  setStairParam(s, 'n:0', 7);
  assert.deepEqual(s.flights, [7, 4, 3]);
  setStairParam(s, 'risers', 19);
  assert.equal(stairCalculation(s).risers, 19);
  assert.equal(stairCalculation(s).treads, 16);
  setStairParam(s, 'width', 700);
  assert.equal(s.flightWidth, 900, 'не уже нормы');
  setStairParam(s, 'going', 420);
  const c = stairCalculation(s);
  assert.equal(c.okTread, false);
  assert.ok(c.warnings.some((w) => /Проступь/.test(w)));
  assert.equal(stairLayout(s).W, s.w, 'габарит по раскладке');
});

test('старая лестница без параметров раскладывается по габариту', () => {
  const old = { ...createItem('stairs', 0, 0, 2200, 3250), stairShape: 'u' };
  const lay = stairLayout(old);
  assert.equal(lay.W, 2200);
  assert.equal(lay.H, 3250);
  const m = materializeStair(old);
  assert.equal(m.w, 2200);
  assert.equal(m.h, 3250);
  assert.equal(m.flightWidth, 1000);
  const s = make('u3');
  const scaled = { ...s, w: s.w * 1.2 };
  assert.ok(Math.abs(stairLayout(scaled).W - scaled.w) < 0.01, 'габарит поменяли извне — снова по габариту');
});

test('параметры лестницы сохраняются в файле и читаются обратно', () => {
  const project = createProject('Файл');
  const s = make('u3');
  setStairParam(s, 'n:1', 6);
  project.items.push(s);
  const back = deserializeProject(serializeProject(project));
  const item = back.items.find((i) => i.id === s.id);
  for (const key of ['stairShape', 'flightWidth', 'going', 'flights', 'landings', 'w', 'h']) assert.deepEqual(item[key], s[key], key);
});

// --- Конструкция в 3D: монолит / тетивы / консольная ---

const stairMesh = (shape, build, extra = {}) => {
  const project = createProject('Конструкция');
  const s = make(shape, 3000);
  if (build) s.stairBuild = build;
  Object.assign(s, extra);
  project.items.push(s);
  return { project, s, faces: buildHouseMesh(project).filter((f) => f.kind === 'stairs') };
};
const parts = (faces) => faces.reduce((m, f) => ({ ...m, [f.part]: (m[f.part] || 0) + 1 }), {});

test('конструкция лестницы: по умолчанию «Открытая (тетивы)», поле необязательное и сохраняется', () => {
  assert.deepEqual(STAIR_BUILDS.map((b) => b.id), ['closed', 'open', 'cantilever']);
  assert.equal(stairBuild({}), 'open');
  assert.equal(stairBuild({ stairBuild: 'чужое' }), 'open');
  assert.equal(stairBuild({ stairBuild: 'closed' }), 'closed');
  const project = createProject('Сохранение');
  const s = make('u');
  s.stairBuild = 'cantilever';
  project.items.push(s);
  const back = deserializeProject(serializeProject(project));
  assert.equal(back.items.find((i) => i.kind === 'stairs').stairBuild, 'cantilever');
});

test('открытая лестница: проступи-плиты, тетивы, площадка на стойках, перила; под маршем пусто', () => {
  for (const shape of ['straight', 'l', 'u', 'u3']) {
    const { s, faces } = stairMesh(shape);
    const lay = stairLayout(s);
    const p = parts(faces);
    const treads = lay.flights.reduce((n, f) => n + f.n, 0);
    assert.equal(p.tread, treads * 6, `${shape}: каждая проступь — плита с низом`);
    assert.equal(p.stringer > 0 && p.stringer % 2, 0, `${shape}: тетивы парами`);
    assert.ok(p.rail > 0, `${shape}: есть перила`);
    assert.ok(faces.length < 400, `${shape}: граней ${faces.length}`);
    if (lay.landings.length) assert.ok(p.post > 0 && p.landing === 6 * lay.landings.length, `${shape}: площадка-плита на стойках`);
    // Плита проступи тонкая: низ на 50 мм ниже верха, не от пола.
    for (const f of faces.filter((x) => x.part === 'tread' && x.normal.z > 0.5)) {
      assert.ok(Math.abs(f.pts[0].z - f.cutZ0 - 50) < 0.01, `${shape}: толщина проступи`);
    }
    const lowest = Math.min(...faces.filter((x) => x.part === 'tread').flatMap((x) => x.pts.map((q) => q.z)));
    assert.ok(lowest > 100, `${shape}: низ первой проступи над полом (${lowest})`);
  }
});

test('закрытая лестница — прежний монолит: ступени от пола, без тетив и перил', () => {
  const { faces } = stairMesh('u', 'closed');
  const p = parts(faces);
  assert.equal(p.stringer, undefined);
  assert.equal(p.rail, undefined);
  assert.ok(p.riser > 0, 'подступенки другим тоном');
  assert.ok(faces.filter((f) => f.part === 'riser').every((f) => f.color !== faces.find((x) => x.part === 'tread').color));
  assert.equal(Math.min(...faces.flatMap((f) => f.pts.map((q) => q.z))), 0, 'монолит стоит на полу');
});

test('консольная: толстые проступи без тетив и стоек, перила со свободной стороны', () => {
  const { faces } = stairMesh('u', 'cantilever');
  const p = parts(faces);
  assert.equal(p.stringer, undefined);
  assert.equal(p.post, undefined);
  assert.ok(p.rail > 0);
  const top = faces.find((f) => f.part === 'tread' && f.normal.z > 0.5);
  assert.ok(Math.abs(top.pts[0].z - top.cutZ0 - 80) < 0.01);
});

test('отражённая и повёрнутая открытая лестница — грани без NaN, план не меняется', () => {
  const { s, faces } = stairMesh('l', 'open', { rotation: 30, mirrored: true });
  assert.ok(faces.every((f) => f.pts.every((q) => Number.isFinite(q.x + q.y + q.z))));
  assert.ok(faces.every((f) => f.itemId === s.id));
  assert.deepEqual(stairLayout(s), stairLayout({ ...s, stairBuild: 'closed' }), 'раскладка на плане от конструкции не зависит');
});

test('разрез через открытую лестницу: плиты проступей, а не заливка до пола', () => {
  const section = (build) => {
    const { project } = stairMesh('straight', build);
    const s = buildSection(project, { id: 's', kind: 'section', name: 'Р', line: { a: { x: 0, y: -3000 }, b: { x: 0, y: 3000 } }, side: 1 });
    return s.cuts.filter((c) => c.kind === 'stair');
  };
  const open = section('open');
  const closed = section('closed');
  assert.ok(open.length > 5 && closed.length > 5);
  assert.ok(open.every((c) => c.z1 - c.z0 <= 50.5), 'открытая: только толщина проступей');
  assert.ok(closed.some((c) => c.z0 === 0 && c.z1 > 2000), 'монолит: от пола');
});
