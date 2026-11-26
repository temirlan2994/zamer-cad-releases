import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, createLevel, createRoom, createOpening, serializeProject, deserializeProject, levelProject } from '../core/model.js';
import { clearWindowSpan, levelWindowOpenings, nextWindowSpan, setWindowSpan, windowSpanTop } from '../core/spanning-windows.js';
import { buildHouseMesh } from '../core/mesh3d.js';
import { pickBoxes, pickWall } from '../core/pick3d.js';
import { planHitStack } from '../core/hit-stack.js';
import { addManualWall } from '../core/wall-manual.js';
import { deriveWalls, openingRect } from '../core/walls.js';
import { windowsOf } from '../core/insolation.js';
import { buildIfc } from '../core/ifc.js';
import { buildStructuredExport } from '../core/export.js';
import { roomChecks } from '../core/norms.js';

function splitFacade(gap = 150) {
  const project = createProject('Широкий витраж'); const base = project.levels[0];
  base.rooms.push(createRoom('living', 0, 0, 10000, 5000));
  const opening = createOpening('window', base.rooms[0].id, 0, 5000, 4200);
  opening.type = 'fixed'; opening.heightMode = 'level'; base.openings.push(opening);
  const upper = createLevel('2 этаж', 3000);
  upper.rooms.push(createRoom('bedroom', 0, 0, 5000, 5000), createRoom('bedroom', 5000+gap, 0, 5000-gap, 5000));
  project.levels.push(upper); return { project, base, upper, opening };
}

test('широкое окно проходит через фасад двух верхних комнат и заполненный стык', () => {
  for (const gap of [0, 150, 250]) {
    const { project, base, upper, opening } = splitFacade(gap);
    assert.ok(setWindowSpan(project, base.id, opening, 5700));
    const up = levelProject(project, upper.id), walls = deriveWalls(up), parts = levelWindowOpenings(up, walls);
    assert.equal(parts.length, 2); assert.equal(parts.reduce((sum, part) => sum+part.width, 0), 4200);
    const rects = parts.map((part) => openingRect(up, part, walls).rect);
    assert.equal(rects[0].x, 2900); assert.equal(rects[0].x+rects[0].w, rects[1].x); assert.equal(rects[1].x+rects[1].w, 7100);
    assert.deepEqual(parts.map((part) => part.roomId), upper.rooms.map((room) => room.id));
    const boxes = pickBoxes(project);
    for (const x of [3000, 4990, 5075, 6000, 7000]) {
      const hit = pickWall(boxes.walls, { o: { x, y: -1000, z: 4500 }, d: { x: 0, y: 1, z: 0 } });
      assert.ok(!hit || hit.point.y >= -.5, 'наружная стена и стык вырезаны; внутренняя перегородка остаётся');
    }
    const mesh = buildHouseMesh(project);
    const slabs = mesh.filter((f) => f.slabRole === 'interfloor' && f.normal.z > .5);
    assert.ok(!slabs.some((f) => f.pts.some((p) => p.y < 0) && 5075 > Math.min(...f.pts.map((p) => p.x)) && 5075 < Math.max(...f.pts.map((p) => p.x))), 'внутри окна нет полосы перекрытия');
    const glass = mesh.filter((f) => f.kind === 'glass' && f.openingId === opening.id);
    assert.equal(glass.length, 3);
    const verticalFrames = mesh.filter((f) => f.kind === 'window-frame' && f.openingId === opening.id && Math.max(...f.pts.map((p) => p.z))-Math.min(...f.pts.map((p) => p.z)) > 2000);
    assert.ok(!verticalFrames.some((f) => f.pts.some((p) => p.x > 4990 && p.x < 5260)), 'стык комнат не добавляет лишних стоек рамы');
    assert.equal(upper.openings.length, 0, 'на втором этаже нет сохранённых копий окна');
  }
});

test('составной фасад сохраняет соседние окна и не перекрывает разрыв или сдвиг стены', () => {
  const { project, base, upper, opening } = splitFacade();
  const other = createOpening('window', upper.rooms[1].id, 0, 1000, 900); upper.openings.push(other);
  const before = JSON.stringify(other);
  assert.equal(nextWindowSpan(project, base.id, opening), null); assert.equal(JSON.stringify(other), before);
  upper.openings.pop(); assert.ok(nextWindowSpan(project, base.id, opening));
  upper.rooms[1].y = 100; assert.equal(nextWindowSpan(project, base.id, opening), null);
  upper.rooms[1].y = 0; upper.rooms[1].x += 1000;
  assert.equal(nextWindowSpan(project, base.id, opening), null);
});

test('разные чистые высоты верхних комнат ограничивают общий верх окна', () => {
  const { project, base, upper, opening } = splitFacade();
  upper.rooms[0].ceiling = 2600; upper.rooms[1].ceiling = 2400;
  assert.equal(nextWindowSpan(project, base.id, opening).maxTop, 5400);
  assert.ok(setWindowSpan(project, base.id, opening, 5300));
  assert.equal(windowSpanTop(project, base.id, opening), 5300);
});

test('составной витраж: файл хранит один проём, свет получают обе комнаты, IFC даёт уникальные вырезы', () => {
  const { project, base, upper, opening } = splitFacade();
  assert.ok(setWindowSpan(project, base.id, opening, 5700));
  const copy = deserializeProject(serializeProject(project));
  assert.equal(copy.levels[0].openings.length, 1); assert.equal(copy.levels[1].openings.length, 0);
  assert.equal(windowSpanTop(copy, base.id, copy.openings[0]), 5700);
  assert.deepEqual(windowsOf(copy).filter((w) => w.levelId === upper.id).map((w) => w.roomId), upper.rooms.map((r) => r.id));
  const ifc = buildIfc(copy);
  assert.equal(ifc.counts.windows, 1);
  const ids = [...ifc.text.matchAll(/IFCOPENINGELEMENT\('([^']+)'/g)].map((m) => m[1]);
  assert.equal(ids.length, 3); assert.equal(new Set(ids).size, 3);
});

test('верхняя стена одной комнаты с разными толщинами участков остаётся единым витражом', () => {
  const { project, base, upper, opening } = splitFacade();
  upper.rooms = [createRoom('bedroom', 0, 0, 10000, 5000)];
  upper.wallOverrides[`e|${upper.rooms[0].id}|0`] = { spans: [{ orient: 'h', from: 0, to: 5000, thickness: 300 }] };
  assert.ok(setWindowSpan(project, base.id, opening, 5700));
  const glass = buildHouseMesh(project).filter((f) => f.kind === 'glass' && f.openingId === opening.id);
  assert.equal(glass.length, 3);
  assert.ok(glass.every((f) => f.pts.every((p) => p.y === -125)), 'стекло обоих этажей в одной плоскости');
});

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

test('сохранённая числовая высота на два этажа даёт настоящее стекло, вырез и экспорт', () => {
  const { project, base, upper, opening } = fixture();
  opening.heightMode = 'custom'; opening.sill = 100; opening.height = 5900;
  const saved = serializeProject(project);
  const copy = deserializeProject(saved), window = copy.openings[0];
  assert.equal(windowSpanTop(copy, base.id, window), 6000);
  const mesh = buildHouseMesh(copy);
  const glass = mesh.filter((f) => f.kind === 'glass' && f.openingId === opening.id);
  assert.deepEqual(glass.map((f) => [f.pts[0].z, f.pts[2].z]), [[600, 3500], [3500, 6500]]);
  const hit = pickWall(pickBoxes(copy).walls, { o: { x: 3500, y: -1000, z: 5000 }, d: { x: 0, y: 1, z: 0 } });
  assert.ok(hit.point.y >= 5000, 'верхняя наружная стена вырезана');
  const slab = mesh.filter((f) => f.slabRole === 'interfloor' && f.normal.z > .5);
  assert.ok(!slab.some((f) => 3500 > Math.min(...f.pts.map((p) => p.x)) && 3500 < Math.max(...f.pts.map((p) => p.x))
    && -125 > Math.min(...f.pts.map((p) => p.y)) && -125 < Math.max(...f.pts.map((p) => p.y))));
  assert.equal(buildIfc(copy).counts.windows, 1);
  assert.equal(buildStructuredExport(copy).levels[1].openings[0].top_level, upper.id);
  assert.equal(serializeProject(copy), saved, 'просмотр не переписывает файл');
  clearWindowSpan(window, copy.levels[0]);
  assert.equal(windowSpanTop(copy, base.id, window), null);
  assert.equal(levelWindowOpenings(levelProject(copy, upper.id)).length, 0);
});

test('витраж проходит через перекрытие над комнатой с индивидуальным потолком', () => {
  const { project, base, upper, opening } = fixture();
  base.rooms[0].ceiling = 2700;
  assert.ok(setWindowSpan(project, base.id, opening, 6000));
  assert.equal(levelWindowOpenings(levelProject(project, upper.id))[0].height, 3000);
  const glass = buildHouseMesh(project).filter((f) => f.kind === 'glass' && f.openingId === opening.id);
  assert.deepEqual(glass.map((f) => [f.pts[0].z, f.pts[2].z]), [[600, 3500], [3500, 6500]], 'стекло непрерывно в зоне перекрытия');
  base.rooms[0].ceiling = 2400;
  assert.equal(nextWindowSpan(project, base.id, opening), null, 'реальный вертикальный разрыв фасада сохраняется');
});

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
