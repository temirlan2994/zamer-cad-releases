// Исправление зазора (core/gap-fix.js): сдвиг, растяжение стороны, стена
// нужной толщины, автостыковка после жеста.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createProject, createRoom } from '../core/model.js';
import { findNearMissGaps, planGapMove } from '../core/gaps.js';
import {
  AUTO_DOCK_MM, applyGapStretch, applyGapThicken, autoDockFix, planGapStretch, planGapThicken,
} from '../core/gap-fix.js';
import { projectAdjacencies, sharedKey } from '../core/walls.js';

// Гостиная слева, спальня справа на зазоре gap (по умолчанию перегородка 100).
function pair(gap, { bedW = 3000, bedH = 3000 } = {}) {
  const project = createProject('зазор');
  const living = createRoom('living', 0, 0, 5000, 4000);
  const bed = createRoom('bedroom', 5000 + gap, 0, bedW, bedH);
  project.rooms.push(living, bed);
  return { project, living, bed };
}
const joined = (project, a, b) => projectAdjacencies(project).some((adj) => sharedKey(adj.a.id, adj.b.id) === sharedKey(a.id, b.id));

test('в записи зазора есть координаты обращённых друг к другу граней', () => {
  const [gap] = findNearMissGaps(pair(130).project);
  assert.deepEqual(gap.edges, { a: 5000, b: 5130 });
});

test('растяжение: щель шире — сторона меньшей комнаты идёт к соседу, остальное не двигается', () => {
  const { project, living, bed } = pair(130);
  const [gap] = findNearMissGaps(project, { move: false });
  const plan = planGapStretch(project, gap);
  assert.equal(plan.move.roomId, bed.id, 'меньшая комната');
  assert.equal(plan.move.shift, -30, 'левая сторона спальни — на 30 мм влево');
  assert.ok(applyGapStretch(project, plan.move).ok);
  assert.equal(bed.x, 5100);
  assert.equal(bed.w, 3030, 'ширина выросла, правая сторона на месте');
  assert.equal(living.w, 5000);
  assert.ok(joined(project, living, bed));
  assert.equal(findNearMissGaps(project).length, 0);
});

test('растяжение: щель уже перегородки — сторона уходит внутрь комнаты', () => {
  const { project, living, bed } = pair(70);
  const [gap] = findNearMissGaps(project, { move: false });
  const plan = planGapStretch(project, gap, { prefer: bed.id, only: true });
  assert.equal(plan.move.shift, 30);
  applyGapStretch(project, plan.move);
  assert.equal(bed.x, 5100);
  assert.equal(bed.w, 2970);
  assert.ok(joined(project, living, bed));
});

test('растяжение: можно выбрать большую комнату (prefer + only)', () => {
  const { project, living } = pair(130);
  const [gap] = findNearMissGaps(project, { move: false });
  const plan = planGapStretch(project, gap, { prefer: living.id, only: true });
  assert.equal(plan.move.roomId, living.id);
  assert.equal(plan.move.shift, 30, 'правая сторона гостиной вправо на 30');
  applyGapStretch(project, plan.move);
  assert.equal(living.w, 5030);
  assert.ok(joined(project, living, project.rooms[1]));
});

test('растяжение: комната не уже 900 мм — иначе отказ с причиной', () => {
  const { project, bed } = pair(70, { bedW: 920 });
  const [gap] = findNearMissGaps(project, { move: false });
  const plan = planGapStretch(project, gap, { prefer: bed.id, only: true });
  assert.equal(plan.move, null);
  assert.match(plan.reason, /900/);
});

test('стена нужной толщины: комнаты на месте, щель — общая стена', () => {
  const { project, living, bed } = pair(150);
  const [gap] = findNearMissGaps(project, { move: false });
  const plan = planGapThicken(project, gap);
  assert.equal(plan.thickness, 150);
  applyGapThicken(project, gap, plan.thickness);
  assert.equal(bed.x, 5150, 'комната не двигалась');
  assert.ok(joined(project, living, bed));
  assert.equal(findNearMissGaps(project).length, 0);
  assert.equal(project.wallOverrides[gap.key].thickness, 150);
});

test('стена нужной толщины: слишком тонкая или толстая щель — отказ', () => {
  const [thin] = findNearMissGaps(pair(20).project, { move: false });
  assert.equal(planGapThicken(pair(20).project, thin).thickness, null);
  const [wide] = findNearMissGaps(pair(450).project, { move: false });
  assert.equal(planGapThicken(pair(450).project, wide).thickness, 450, '450 — предел, ещё можно');
});

test('автостыковка: тянули сторону — растяжение; в допуске, комнатой, которую тянули', () => {
  const { project, living, bed } = pair(90);
  const fix = autoDockFix(project, [bed.id], 'stretch');
  assert.equal(fix.fix, 'stretch');
  assert.equal(fix.plan.roomId, bed.id);
  assert.equal(fix.plan.shift, 10);
  applyGapStretch(project, fix.plan);
  assert.ok(joined(project, living, bed));
});

test('автостыковка: двигали комнату — сдвигается она, не сосед (даже если она больше)', () => {
  const { project, living, bed } = pair(140);
  const fix = autoDockFix(project, [living.id], 'move');
  assert.equal(fix.fix, 'move');
  assert.equal(fix.plan.roomId, living.id, 'не меньшая спальня, а гостиная, которую двигали');
  assert.equal(fix.plan.dx, 40, 'гостиная вправо на 40 мм');
  assert.ok(bed);
});

test(`автостыковка: зазор дальше ${AUTO_DOCK_MM} мм от толщины стены — ничего не делает`, () => {
  const { project, bed } = pair(100 + AUTO_DOCK_MM + 1);
  assert.equal(autoDockFix(project, [bed.id], 'stretch'), null);
  assert.equal(autoDockFix(project, [bed.id], 'move'), null);
  const edge = pair(100 + AUTO_DOCK_MM);
  assert.ok(autoDockFix(edge.project, [edge.bed.id], 'move'), 'ровно на границе допуска — стыкуется');
});

test('автостыковка: комнаты с контуром (съеденные) и с вырезом (Г-образные) — только кнопками', () => {
  const { project, living, bed } = pair(130);
  living.outline = [{ x: 0, y: 0 }, { x: 5000, y: 0 }, { x: 5000, y: 4000 }, { x: 0, y: 4000 }];
  assert.equal(autoDockFix(project, [bed.id], 'stretch'), null, 'у соседа контур');
  const second = pair(130);
  second.bed.notch = { corner: 'ne', w: 500, h: 500 };
  assert.equal(autoDockFix(second.project, [second.bed.id], 'move'), null, 'у двигаемой вырез');
});

test('автостыковка: прежние зазоры не трогает — только появившиеся или изменённые правкой', () => {
  const { project, bed } = pair(130);
  const same = new Map([[findNearMissGaps(project, { move: false })[0].key, 130]]);
  assert.equal(autoDockFix(project, [bed.id], 'stretch', { changed: same }), null, 'зазор был таким же');
  const was = new Map([[findNearMissGaps(project, { move: false })[0].key, 150]]);
  assert.ok(autoDockFix(project, [bed.id], 'stretch', { changed: was }), 'зазор изменился с 150 на 130');
  assert.ok(autoDockFix(project, [bed.id], 'stretch', { changed: new Map() }), 'зазора раньше не было');
});

test('автостыковка: не трогает пары, где ни одна комната не двигалась', () => {
  const { project } = pair(130);
  const other = createRoom('kitchen', 0, 6000, 3000, 3000);
  project.rooms.push(other);
  assert.equal(autoDockFix(project, [other.id], 'move'), null);
});

test('сдвиг: prefer + only ограничивает выбор комнаты', () => {
  const { project, living, bed } = pair(130);
  const [gap] = findNearMissGaps(project, { move: false });
  assert.equal(planGapMove(project, gap).move.roomId, bed.id, 'по умолчанию — меньшая');
  assert.equal(planGapMove(project, gap, { prefer: living.id, only: true }).move.roomId, living.id);
});
