import test from 'node:test';
import assert from 'node:assert/strict';

import { applyAtrium, atriumRails, previewAtrium, reshapeAtrium } from '../core/atrium.js';
import { buildHouseMesh } from '../core/mesh3d.js';
import { pointInPolygon } from '../core/geom/poly.js';
import { pickFaces } from '../core/pick3d.js';
import {
  createItem, createLevel, createOpening, createProject, createRoom, deserializeProject, levelProject, removeRoom, serializeProject,
} from '../core/model.js';
import { roomNetAreaM2 } from '../core/rooms.js';
import { removeSlabOpening, slabOpeningPolygon } from '../core/slab-openings.js';
import { addManualWall } from '../core/wall-manual.js';
import { applyStairPreset, stairLayout, stairToPlan } from '../core/stairs.js';
import { windowSpanTop } from '../core/spanning-windows.js';

const rect = { x: 0, y: 0, w: 3500, h: 3000 };
function fixture() {
  const project = createProject('Второй свет');
  const lower = project.levels[0];
  lower.height = 3200;
  const upper = createLevel('Галерея', 3200, 3400, 'L2');
  project.levels.push(upper);
  const living = createRoom('living', 0, 0, 6000, 5000);
  const hall = createRoom('hall', 0, 0, 6000, 5000);
  lower.rooms.push(living);
  upper.rooms.push(hall);
  const wide = createOpening('window', living.id, 0, 1650, 2000);
  const narrow = createOpening('window', living.id, 0, 5200, 800);
  lower.openings.push(wide, narrow);
  return { project, lower, upper, living, hall, wide, narrow };
}

test('предпросмотр и одна запись второго света: только открытые кромки и выбранный витраж', () => {
  const { project, lower, upper, living, hall, wide, narrow } = fixture();
  const before = serializeProject(project);
  const options = { rect, windowId: wide.id };
  const preview = previewAtrium(project, lower.id, living.id, options);
  assert.ok(preview.ok, preview.reason);
  assert.deepEqual(preview.windows.map((o) => o.id), [wide.id]);
  assert.equal(preview.area, 10_500_000);
  assert.equal(preview.rails.length, 2);
  assert.deepEqual(preview.rails.map(({ a, b }) => [a, b]), [
    [{ x: 3500, y: 0 }, { x: 3500, y: 3000 }],
    [{ x: 3500, y: 3000 }, { x: 0, y: 3000 }],
  ]);
  assert.equal(serializeProject(project), before);
  assert.equal(applyAtrium(project, lower.id, living.id, { rect, windowId: narrow.id }).ok, false);
  assert.equal(serializeProject(project), before, 'отказ не оставляет ни витража, ни проёма');
  const result = applyAtrium(project, lower.id, living.id, options);
  assert.ok(result.ok, result.reason);
  assert.equal(upper.slabOpenings.length, 1);
  assert.equal(upper.openings.length, 0);
  assert.equal(narrow.span, undefined);
  assert.equal(windowSpanTop(project, lower.id, wide), upper.elevation + upper.height - upper.slabThickness);
  assert.equal(roomNetAreaM2(levelProject(project, upper.id), hall), 19.5);

  const copy = deserializeProject(serializeProject(project));
  const hole = copy.levels[1].slabOpenings[0];
  assert.equal(hole.id, result.openingId);
  assert.deepEqual(atriumRails(copy, upper.id, hole), preview.rails);
  const mesh = buildHouseMesh(copy);
  const covers = (face, x, y) => face.normal.z > 0.9 && pointInPolygon(face.pts, { x, y });
  for (const floor of [mesh.filter((f) => f.kind === 'floor' && f.level === upper.id), mesh.filter((f) => f.slabRole === 'interfloor')]) {
    assert.ok(!floor.some((f) => covers(f, 2050, 2410)));
    assert.ok(floor.some((f) => covers(f, 4100, 2100)));
  }
  const glass = mesh.filter((f) => f.alpha && f.slabOpeningId === hole.id);
  assert.equal(glass.length, 2);
  assert.ok(glass.every((f) => f.pts.every((p) => p.z >= upper.elevation && p.z <= upper.elevation + 1100)));
  assert.ok(pickFaces(glass).every((f) => f.pick.type === 'slab' && f.pick.id === hole.id));
  assert.ok(removeSlabOpening(copy, upper.id, hole.id));
  assert.equal(copy.openings[0].span, undefined);
  assert.equal(roomNetAreaM2(levelProject(copy, upper.id), copy.levels[1].rooms[0]), 30);
});

test('полная форма Г-комнаты сохраняет пол галереи в вырезе и не ставит перила у стен', () => {
  const { project, lower, upper, living } = fixture();
  living.notch = { corner: 'se', w: 1800, h: 1200 };
  const result = applyAtrium(project, lower.id, living.id);
  assert.ok(result.ok, result.reason);
  assert.equal(result.area, 27_840_000);
  assert.equal(result.polygon.length, 6);
  assert.equal(result.rails.length, 2);
  assert.deepEqual(atriumRails(project, upper.id, upper.slabOpenings[0]), result.rails);
  const all = fixture();
  assert.deepEqual(previewAtrium(all.project, all.lower.id, all.living.id).rails, []);
});

test('свободный участок проверяется при подтверждении и повторной правке', () => {
  const { project, lower, upper, living, hall, wide } = fixture();
  const create = (options) => applyAtrium(project, lower.id, living.id, options);
  const blocked = (pattern, options = { rect }) => {
    const before = serializeProject(project);
    const actual = create(options);
    assert.equal(actual.ok, false);
    assert.match(actual.reason, pattern);
    assert.equal(serializeProject(project), before);
  };
  blocked(/300/, { rect: { ...rect, w: 220 } });
  blocked(/внутри/, { rect: { ...rect, x: -100 } });
  const chair = createItem('armchair', 3400, 3000, 550, 800, 33);
  upper.items.push(chair);
  blocked(/стоит/);
  upper.items.length = 0;
  upper.openings.push(createOpening('door', hall.id, 0, 2300, 900));
  blocked(/Дверь/);
  upper.openings.length = 0;
  addManualWall(levelProject(project, upper.id), { x: 1000, y: 500 }, { x: 3200, y: 2500 });
  blocked(/стену/);
  upper.walls.length = 0;
  const result = create({ rect, railing: false, windowId: wide.id });
  assert.ok(result.ok, result.reason);
  assert.deepEqual(result.rails, []);
  blocked(/уже есть/);
  const hole = upper.slabOpenings[0];
  const initial = slabOpeningPolygon(hole);
  assert.equal(reshapeAtrium(project, upper.id, hole, { rect: { ...rect, x: 4500 } }).ok, false);
  assert.equal(reshapeAtrium(project, upper.id, hole, { rect: { ...rect, y: 50 } }).ok, false);
  assert.deepEqual(slabOpeningPolygon(hole), initial);
  hole.atrium.railing = true;
  assert.ok(reshapeAtrium(project, upper.id, hole, { rect: { ...rect, h: 2350 } }).ok);
  assert.equal(hole.h, 2350);
  assert.ok(atriumRails(project, upper.id, hole).some(({ a, b }) => a.y === 2350 && b.y === 2350));

  wide.span.topGap = 150;
  assert.ok(removeSlabOpening(project, upper.id, hole.id));
  assert.equal(wide.span.topGap, 150, 'сохраняет последующую самостоятельную правку окна');
});

test('соседние проёмы не делят одно ограждение, старые лестничные проёмы сохраняются', () => {
  const { project, lower, upper, living } = fixture();
  assert.ok(applyAtrium(project, lower.id, living.id, { rect }).ok);
  const adjacent = { x: 3500, y: 750, w: 1800, h: 1500 };
  assert.ok(applyAtrium(project, lower.id, living.id, { rect: adjacent }).ok);
  const rails = atriumRails(project, upper.id, upper.slabOpenings[0]);
  const vertical = rails.filter(({ a, b }) => a.x === 3500 && b.x === 3500);
  assert.deepEqual(vertical.map(({ a, b }) => [a.y, b.y]).sort((a, b) => a[0] - b[0]), [[0, 750], [2250, 3000]]);
  assert.ok(atriumRails(project, upper.id, upper.slabOpenings[1]).every(({ a, b }) => a.x !== 3500 || b.x !== 3500));

  const old = fixture();
  old.lower.items.push(createItem('stairs', 2200, 1800, 1400, 2000));
  assert.match(previewAtrium(old.project, old.lower.id, old.living.id, { rect }).reason, /уже есть/);
  old.project.levels.pop();
  assert.match(previewAtrium(old.project, old.lower.id, old.living.id).reason, /Добавьте этаж/);
});


test('удаление исходной комнаты или галереи убирает связанный проём, сохраняет обычные отверстия', () => {
  for (const removeUpper of [true, false]) {
    const { project, lower, upper, living, hall, wide } = fixture();
    const result = applyAtrium(project, lower.id, living.id, { rect, windowId: wide.id });
    assert.ok(result.ok, result.reason);
    upper.slabOpenings.push({ id: 'old', x: 4500, y: 3500, w: 600, h: 800 });
    removeRoom(levelProject(project, removeUpper ? upper.id : lower.id), removeUpper ? hall.id : living.id);
    assert.deepEqual(upper.slabOpenings.map((o) => o.id), ['old']);
    assert.equal(wide.span, undefined);
  }
});

test('существующая полая масса или шахта не становится полом верхнего этажа', () => {
  const { project, lower, upper, living } = fixture();
  project.massVoids = [{ id: 'v', x: 2250, y: 1500, z0: 3180, w: 600, d: 700, h: 300 }];
  assert.match(previewAtrium(project, lower.id, living.id, { rect }).reason, /масса/);
  project.massVoids = [];
  upper.rooms.push({ ...createRoom('hall', 2700, 900, 1500, 1800), shaft: true });
  assert.match(previewAtrium(project, lower.id, living.id, { rect }).reason, /шахта/);
});


test('ограждение пропускает только верхний марш связанной лестницы у кромки галереи', () => {
  const { project, lower, upper, living } = fixture();
  const cut = { x: 600, y: 1000, w: 4800, h: 3700 };
  assert.ok(applyAtrium(project, lower.id, living.id, { rect: cut }).ok);
  const hole = upper.slabOpenings[0];
  const stair = createItem('stairs', 3000, 0, 0, 0, 180);
  applyStairPreset(stair, 'u', upper.elevation);
  stair.toLevel = upper.id;
  const exit = stairLayout(stair, lower.height).flights.at(-1).end;
  stair.y = cut.y - stairToPlan(stair, exit).y;
  lower.items.push(stair);
  hole.stairId = stair.id;

  const northRails = () => atriumRails(project, upper.id, hole)
    .filter(({ a, b }) => Math.abs(a.y - cut.y) < 1 && Math.abs(b.y - cut.y) < 1);
  const hasGuardAt = (x) => northRails().some(({ a, b }) => x > Math.min(a.x, b.x) && x < Math.max(a.x, b.x));
  const first = stairToPlan(stair, stairLayout(stair).flights[0].start);
  const last = stairToPlan(stair, exit);
  assert.ok(hasGuardAt(first.x), 'ограждение над нижним маршем осталось');
  assert.equal(hasGuardAt(last.x), false);
  const remaining = northRails().reduce((len, { a, b }) => len + Math.abs(a.x - b.x), 0);
  assert.ok(Math.abs(cut.w - remaining - stair.flightWidth) < 0.01);
  const stored = serializeProject(project);
  stair.y += 500;
  assert.ok(hasGuardAt(last.x), 'после перемещения марша вдаль от кромки разрыв закрылся');
  stair.y -= 500;
  stair.mirrored = true;
  assert.ok(hasGuardAt(last.x));
  assert.equal(hasGuardAt(first.x), false, 'проход следует за зеркальным маршем');
  stair.toLevel = 'none';
  assert.ok(hasGuardAt(first.x));
  lower.items.length = 0;
  assert.ok(hasGuardAt(last.x));
  const undo = deserializeProject(stored);
  const restored = atriumRails(undo, upper.id, undo.levels[1].slabOpenings[0]);
  const top = restored.filter(({ a, b }) => Math.abs(a.y - cut.y) < 1 && Math.abs(b.y - cut.y) < 1);
  assert.equal(top.length, 2, 'открытие снимка истории восстанавливает проход');
});
