// Разрезы по линии на плане этажа (core/section.js) и их модель (core/views.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createLevel, createOpening, createProject, createRoom, deserializeProject, projectFromData, serializeProject,
} from '../core/model.js';
import { buildSection, houseDepth, lineIntervals, sectionFrame, sideOfPoint } from '../core/section.js';
import { addSectionView, nextSectionName, normalizeView, removeView, sectionMark, sectionViews } from '../core/views.js';

// Комната 5×4 м (оси дома 0..5000 × 0..4000, наружные стены 250 наружу):
// окно на верхней стене (y < 0) по центру, дверь — на правой (x > 5000).
function house() {
  const p = createProject();
  const room = createRoom('living', 0, 0, 5000, 4000);
  p.rooms.push(room);
  p.openings.push(createOpening('window', room.id, 0, 2500, 1200));
  p.openings.push(createOpening('door', room.id, 1, 2000, 900));
  return p;
}

const sec = (a, b, extra = {}) => ({ id: 's', kind: 'section', name: 'Разрез 1', line: { a, b }, side: 1, ...extra });
const of = (s, kind) => s.cuts.filter((c) => c.kind === kind);
const near = (x, y, tol = 1) => Math.abs(x - y) <= tol;

test('поперёк через окно: стены слева и справа, проём на месте окна, кровля сверху, пол снизу', () => {
  const p = house();
  // Линия сверху вниз через x = 2500: пересекает верхнюю стену (окно) и нижнюю.
  const s = buildSection(p, sec({ x: 2500, y: -1000 }, { x: 2500, y: 5000 }));
  const walls = of(s, 'wall');
  // Взгляд на запад (side 1, n = левая нормаль a→b): север справа.
  const north = walls.filter((c) => near(c.u0, -1000) && near(c.u1, -750));
  const south = walls.filter((c) => near(c.u0, -5250) && near(c.u1, -5000));
  assert.ok(south.some((c) => c.z0 === 0 && c.z1 === 3000), 'южная стена — на всю высоту');
  // Северная стена разрезана проёмом окна: подоконник 0..900 и перемычка 2400..3000.
  assert.deepEqual(north.map((c) => [c.z0, c.z1]).sort((x, y) => x[0] - y[0]), [[0, 900], [2400, 3000]]);
  assert.deepEqual(s.openings.map((o) => [o.kind, o.z0, o.z1]), [['window', 900, 2400]]);
  assert.ok(near(s.openings[0].u0, -1000) && near(s.openings[0].u1, -750));
  // Кровля над домом, пол — плита под нижним этажом.
  const roof = of(s, 'roof');
  assert.ok(roof.length && roof.every((c) => c.z0 === 3000 && c.z1 === 3250));
  const floor = of(s, 'floor');
  assert.ok(floor.length && floor.every((c) => c.z1 === 0 && c.z0 === -200));
  assert.ok(near(Math.min(...floor.map((c) => c.u0)), -5250) && near(Math.max(...floor.map((c) => c.u1)), -750));
  assert.ok(s.cutEdges.length >= 8, 'контур сечения');
  assert.deepEqual(s.levels.map((l) => l.label), ['+0.000']);
  assert.ok(s.ground.length >= 2);
  // Вид за плоскостью: внутренняя грань западной стены видна.
  assert.ok(s.polys.some((q) => q.kind === 'wall'));
  assert.ok(s.bounds.z0 <= -200 && s.bounds.z1 >= 3250);
});

test('вдоль дома через дверь: правая стена с проёмом двери, на виде — стены', () => {
  const p = house();
  // Линия слева направо через y = 2000 (дверь на правой стене по центру).
  const s = buildSection(p, sec({ x: -1000, y: 2000 }, { x: 6000, y: 2000 }));
  const doors = s.openings.filter((o) => o.kind === 'door');
  assert.equal(doors.length, 1);
  assert.equal(doors[0].z0, 0);
  assert.equal(doors[0].z1, 2100);
  // Над дверью — перемычка, сама дверь от пола: в правой стене кусок 2100..3000.
  const right = of(s, 'wall').filter((c) => near(c.u0, doors[0].u0) && near(c.u1, doors[0].u1));
  assert.deepEqual(right.map((c) => [c.z0, c.z1]), [[2100, 3000]]);
  assert.equal(of(s, 'wall').length, 2, 'левая стена целиком + перемычка');
  assert.ok(s.polys.length > 0);
});

test('разрез под 45° — без ошибок, сечения длиннее толщины стены', () => {
  const p = house();
  const s = buildSection(p, sec({ x: -1000, y: -1000 }, { x: 5000, y: 5000 }));
  const walls = of(s, 'wall');
  assert.ok(walls.length >= 2);
  for (const c of [...s.cuts, ...s.openings]) assert.ok(c.u1 > c.u0 && c.z1 > c.z0, 'размеры положительные');
  // Наискось через стену 250 мм: длина сечения ≈ 250·√2.
  assert.ok(walls.some((c) => c.u1 - c.u0 > 300), 'сечение наискось длиннее');
  for (const q of s.polys) for (const pt of q.pts) assert.ok(Number.isFinite(pt.u) && Number.isFinite(pt.z));
});

test('два этажа: перекрытие между этажами, отметки уровней', () => {
  const p = house();
  p.levels.push(createLevel('2 этаж', 3000, 2800, 'L2'));
  p.activeLevel = 'L2';
  p.rooms.push(createRoom('bedroom', 0, 0, 5000, 4000));
  const s = buildSection(p, sec({ x: 2500, y: -1000 }, { x: 2500, y: 5000 }));
  const slab = of(s, 'slab');
  assert.ok(slab.length, 'перекрытие разрезано');
  assert.ok(slab.every((c) => c.z1 === 2999 && c.z0 === 2800));
  assert.deepEqual(s.levels.map((l) => [l.z, l.label]), [[0, '+0.000'], [3000, '+3.000']]);
  assert.ok(of(s, 'wall').some((c) => c.z0 === 3000 && c.z1 === 5800), 'стены второго этажа');
  assert.ok(of(s, 'roof').every((c) => c.z0 === 5800));
});

test('side = −1 зеркалит вид; сторона по точке', () => {
  const p = house();
  const a = { x: 2500, y: -1000 }; const b = { x: 2500, y: 5000 };
  const s1 = buildSection(p, sec(a, b));
  const s2 = buildSection(p, sec(a, b, { side: -1 }));
  const w1 = s1.openings[0]; const w2 = s2.openings[0];
  assert.ok(near(w1.u0, -w2.u1) && near(w1.u1, -w2.u0), 'окно отражено');
  assert.equal(s2.side, -1);
  assert.equal(sectionFrame(sec(a, b)).view.x, -1, 'side 1 — взгляд на запад (влево от a→b вниз)');
  assert.equal(sideOfPoint({ a, b }, { x: 0, y: 2000 }), 1);
  assert.equal(sideOfPoint({ a, b }, { x: 5000, y: 2000 }), -1);
});

test('depth ограничивает видимое за плоскостью', () => {
  const p = house();
  const line = [{ x: -1000, y: 2000 }, { x: 6000, y: 2000 }];
  const full = buildSection(p, sec(...line));
  const shallow = buildSection(p, sec(...line, { depth: 100 }));
  const farDepth = (s) => Math.max(0, ...s.polys.map((q) => q.depth));
  assert.ok(farDepth(full) > 1500, `полный вид до дальней стены ${farDepth(full)}`);
  assert.ok(farDepth(shallow) <= 100, `глубина 100 мм — ${farDepth(shallow)}`);
  assert.equal(full.cuts.length, shallow.cuts.length, 'сечение то же');
  assert.equal(houseDepth(p, sec(...line)), 2300, 'до габарита: от y = 2000 до наружной грани 4250');
});

test('чистая функция: проект не меняется; битая линия — null', () => {
  const p = house();
  const before = serializeProject(p);
  buildSection(p, sec({ x: 2500, y: -1000 }, { x: 2500, y: 5000 }, { depth: 500 }));
  assert.equal(serializeProject(p), before);
  assert.equal(buildSection(p, sec({ x: 0, y: 0 }, { x: 0, y: 0 })), null);
  assert.equal(buildSection(p, { id: 'x', kind: 'section' }), null);
  // Линия мимо дома — пустой разрез без ошибок.
  const miss = buildSection(p, sec({ x: 20000, y: 0 }, { x: 20000, y: 4000 }));
  assert.equal(miss.cuts.length, 0);
});

test('lineIntervals: невыпуклый контур, отсечение по длине отрезка', () => {
  const L = [{ x: 0, y: 0 }, { x: 4000, y: 0 }, { x: 4000, y: 1000 }, { x: 1000, y: 1000 }, { x: 1000, y: 3000 }, { x: 0, y: 3000 }];
  assert.deepEqual(lineIntervals(L, { x: -500, y: 500 }, { x: 1, y: 0 }, 6000), [[500, 4500]]);
  assert.deepEqual(lineIntervals(L, { x: 500, y: -500 }, { x: 0, y: 1 }, 2000), [[500, 2000]]);
  assert.deepEqual(lineIntervals(L, { x: 2000, y: 2000 }, { x: 1, y: 0 }, 1000), []);
});

test('views: разрезы — нормализация, дубли id, файл, имена', () => {
  const p = house();
  const v = addSectionView(p, { levelId: p.activeLevel, a: { x: 0, y: 2000 }, b: { x: 5000, y: 2000 }, side: -1 });
  assert.equal(v.name, 'Разрез 1');
  assert.equal(v.id, 'sec-1');
  assert.equal(nextSectionName(p), 'Разрез 2');
  assert.equal(sectionMark(v), '1');
  const back = deserializeProject(serializeProject(p));
  assert.deepEqual(sectionViews(back).map((x) => [x.id, x.side, x.line.b.x, x.levelId]), [['sec-1', -1, 5000, p.activeLevel]]);
  const raw = JSON.parse(serializeProject(p));
  raw.views.push(
    { id: 'bad1', kind: 'section' },
    { id: 'bad2', kind: 'section', line: { a: { x: 0, y: 0 }, b: { x: 0, y: 0 } } },
    { id: 'bad3', kind: 'section', line: { a: { x: 'q', y: 0 }, b: { x: 1, y: 2 } } },
    { id: 'sec-1', kind: 'section', line: { a: { x: 0, y: 0 }, b: { x: 900, y: 0 } } },
    { id: 'ok', kind: 'section', line: { a: { x: '10', y: 0 }, b: { x: 900, y: 0 } }, side: 7, depth: -5 },
  );
  const views = projectFromData(raw).views;
  assert.deepEqual(views.map((x) => x.id), ['sec-1', 'ok']);
  const ok = views[1];
  assert.equal(ok.line.a.x, 10);
  assert.equal(ok.side, 1);
  assert.equal('depth' in ok, false);
  assert.equal(ok.name, 'Разрез');
  assert.equal(normalizeView({ id: 'd', kind: 'section', line: { a: { x: 0, y: 0 }, b: { x: 1000, y: 0 } }, depth: 1234.4 }).depth, 1234);
  assert.ok(removeView(p, 'sec-1'));
  assert.equal(sectionViews(p).length, 0);
});
