import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, createLevel, createRoom, createOpening, serializeProject, deserializeProject, levelProject } from '../core/model.js';
import { clearWindowSpan, levelWindowOpenings, nextWindowSpan, setWindowSpan, windowSpanTop } from '../core/spanning-windows.js';
import { buildHouseMesh } from '../core/mesh3d.js';
import { pickBoxes, pickWall } from '../core/pick3d.js';
import { planHitStack } from '../core/hit-stack.js';
import { addManualWall } from '../core/wall-manual.js';
import { deriveWalls } from '../core/walls.js';
import { windowsOf } from '../core/insolation.js';
import { buildIfc } from '../core/ifc.js';
import { buildStructuredExport } from '../core/export.js';
import { roomChecks } from '../core/norms.js';

function fixture() {
  const project = createProject('Витраж');
  const base = project.levels[0];
  base.elevation = 500;
  const upper = createLevel('2 этаж', 3500, 3400, 'L2');
  project.levels.push(upper);
  base.rooms.push(createRoom('living', 0, 0, 7000, 5000));
  upper.rooms.push(createRoom('bedroom', 1000, 0, 5000, 5000));
  const opening = createOpening('window', base.rooms[0].id, 0, 3500, 3200);
  opening.type = 'panoramic';
  opening.heightMode = 'level';
  base.openings.push(opening);
  return { project, base, upper, opening };
}

test('одно окно следует за потолком и своей нижней отметкой после открытия v7', () => {
  const { project, base, upper, opening } = fixture();
  assert.deepEqual(nextWindowSpan(project, base.id, opening), { targetLevelId: upper.id, minTop: 3001, maxTop: 6100 });
  assert.ok(setWindowSpan(project, base.id, opening, 6000));
  const saved = serializeProject(project);
  const copy = deserializeProject(saved);
  const actual = copy.openings[0];
  assert.deepEqual(actual.span, { levelId: upper.id, topGap: 100 });
  assert.equal(copy.levels[1].openings.length, 0);
  copy.levels[1].rooms[0].ceiling = 2900;
  assert.equal(windowSpanTop(copy, base.id, actual), 5800);
  copy.levels[0].tallWindowBottomOffset = 125;
  const lower = levelWindowOpenings(copy)[0];
  const up = levelWindowOpenings(levelProject(copy, upper.id))[0];
  assert.deepEqual([lower.sill, lower.height, up.sill, up.height, up.offset], [125, 2875, 0, 2800, 2500]);
  clearWindowSpan(actual);
  assert.equal(levelWindowOpenings(copy)[0], actual);
  assert.equal(levelWindowOpenings(levelProject(copy, upper.id)).length, 0);
  assert.equal(actual.heightMode, 'level');
  assert.equal(windowSpanTop(deserializeProject(saved), base.id, opening), 6000);
  project.openings.splice(0);
  assert.deepEqual(levelWindowOpenings(levelProject(project, upper.id)), []);
});

test('проверяет полную ширину, ориентацию и существующий проём верхнего этажа', () => {
  const { project, base, upper, opening } = fixture();
  const blocked = createOpening('door', upper.rooms[0].id, 0, 2600, 900);
  upper.openings.push(blocked);
  assert.equal(nextWindowSpan(project, base.id, opening), null);
  assert.equal(setWindowSpan(project, base.id, opening, 6100), false);
  upper.openings.pop();
  assert.ok(setWindowSpan(project, base.id, opening, 6100));
  upper.rooms[0].y += 100;
  assert.equal(windowSpanTop(project, base.id, opening), null);
  assert.equal(levelWindowOpenings(project)[0], opening);
  upper.rooms[0].y = 0;
  assert.equal(windowSpanTop(project, base.id, opening), 6100, 'живая геометрия вернулась');
  upper.rooms[0].w = 2500;
  assert.equal(nextWindowSpan(project, base.id, opening), null);
  assert.equal(nextWindowSpan(project, upper.id, opening), null);
  assert.equal(nextWindowSpan(project, base.id, { ...opening, kind: 'door' }), null);
});

test('вырезает две стены и край перекрытия, оставляет стекло и раму без двойной перемычки', () => {
  const { project, base, upper, opening } = fixture();
  setWindowSpan(project, base.id, opening, 6100);
  const boxes = pickBoxes(project);
  const owner = boxes.openings.filter((b) => b.id === opening.id);
  assert.deepEqual(owner.map((box) => [box.z0, box.z1, box.levelId]), [
    [600, 3500, base.id], [3500, 6600, base.id],
  ]);
  for (const z of [3000, 3600, 5700]) {
    const through = pickWall(boxes.walls, { o: { x: 3500, y: -1000, z }, d: { x: 0, y: 1, z: 0 } });
    assert.ok(through.point.y >= 5000);
  }
  const mesh = buildHouseMesh(project);
  const glass = mesh.filter((f) => f.kind === 'glass' && f.openingId === opening.id);
  assert.deepEqual(glass.map((f) => [f.pts[0].z, f.pts[2].z]), [[600, 3500], [3500, 6600]]);
  const rails = mesh.filter((f) => f.kind === 'window-frame' && f.openingId === opening.id &&
    Math.max(...f.pts.map((p) => p.x)) - Math.min(...f.pts.map((p) => p.x)) > 3100);
  assert.ok(rails.length);
  assert.ok(rails.every((f) => f.pts.every((p) => Math.abs(p.z - 3500) > 500)));
  const slab = mesh.filter((f) => f.slabRole === 'interfloor' && f.normal.z > 0.5);
  const covers = (x, y) => slab.some(({ pts }) => x > Math.min(...pts.map((p) => p.x)) && x < Math.max(...pts.map((p) => p.x))
    && y > Math.min(...pts.map((p) => p.y)) && y < Math.max(...pts.map((p) => p.y)));
  assert.equal(covers(3500, -125), false, 'в стене за стеклом нет торца плиты');
  assert.equal(covers(3500, -265), false, 'вырез доходит до наружного выступа');
  assert.equal(covers(3500, 500), true, 'пол комнаты сохранён');
  assert.equal(covers(1500, -125), true, 'по бокам от окна плита сохранена');
  const lp = levelProject(project, upper.id);
  const hit = planHitStack(lp, deriveWalls(lp), 1, { x: 3500, y: -125 })[0];
  assert.equal(hit.id, opening.id);
  assert.equal(hit.entity.spanOwnerLevelId, base.id);
});

test('свет учитывается в обеих комнатах; в IFC два выреза и один элемент окна', () => {
  const { project, base, upper, opening } = fixture();
  setWindowSpan(project, base.id, opening, 6100);
  assert.deepEqual(windowsOf(project).map((w) => [w.levelId, w.roomId, w.sill, w.height]), [
    [base.id, base.rooms[0].id, 100, 2900], [upper.id, upper.rooms[0].id, 0, 3100],
  ]);
  const lp = levelProject(project, upper.id);
  assert.ok(roomChecks(lp, upper.rooms[0], upper).find((check) => check.kind === 'light').ok);
  const ifc = buildIfc(project);
  assert.equal(ifc.counts.windows, 1);
  assert.equal(ifc.text.match(/=IFCOPENINGELEMENT\(/g).length, 2);
  assert.equal(ifc.text.match(/=IFCWINDOW\(/g).length, 1);
  const levels = buildStructuredExport(project).levels;
  assert.deepEqual(levels.map((l) => [l.openings[0].id, l.openings[0].part]), [[opening.id, 'lower'], [opening.id, 'upper']]);
});

test('фасадные ручные стены с противоположным направлением осей', () => {
  const { project, base, upper, opening } = fixture();
  for (const level of project.levels) {
    const lp = levelProject(project, level.id);
    lp.wallOverrides[`e|${lp.rooms[0].id}|0`] = { hidden: true };
    const left = { x: 0, y: -125 };
    const right = { x: 7000, y: -125 };
    addManualWall(lp, level === base ? left : right, level === base ? right : left, { thickness: 250, wallType: 'exterior' });
  }
  opening.host = { wallId: base.walls[0].id, t: 3250 };
  opening.roomId = null;
  assert.ok(setWindowSpan(project, base.id, opening, 6000));
  const [projected] = levelWindowOpenings(levelProject(project, upper.id));
  assert.deepEqual(projected.host, { wallId: upper.walls[0].id, t: 3750 });
  assert.equal(projected.spanOutward, -1);
  assert.deepEqual(windowsOf(project).map((w) => w.roomId), [base.rooms[0].id, upper.rooms[0].id]);
});
