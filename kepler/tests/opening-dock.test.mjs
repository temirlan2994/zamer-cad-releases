// Проём не пропадает при стыковке комнат: окно/дверь стены, ставшей общей
// (зазор перегородки, вплотную или с наездом до MERGE_DEPTH — срез
// полоски), остаются видимыми в
// общей стене; ушедшие под соседа — «сироты» с замечанием; не поместившиеся
// на стене — сироты, а не удаление.
// Запуск: node --test tests/opening-dock.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';

import { createOpening, createProject, createRoom } from '../core/model.js';
import { deriveWalls, openingRect } from '../core/walls.js';
import { orphanOpenings, resolveOpeningConflicts } from '../core/opening-spacing.js';
import { reconcileEats } from '../core/v7/eat-bridge.js';
import { collectIssues } from '../core/issues.js';
import { levelWallSolids } from '../core/mesh3d.js';

// A 4000×3000 с окном на левой стене (y 900…2100) и дверью на верхней.
function scene(b) {
  const p = createProject('стыковка');
  const a = createRoom('living', 0, 0, 4000, 3000);
  a.name = 'Гостиная';
  const room = createRoom('bedroom', b.x, b.y, b.w, b.h);
  room.name = 'Спальня';
  p.rooms.push(a, room);
  const win = createOpening('window', a.id, 3, 1500, 1200);
  const door = createOpening('door', a.id, 0, 2000, 900);
  p.openings.push(win, door);
  return { p, a, b: room, win, door };
}

const placed = (p, o) => openingRect(p, p.openings.find((x) => x.id === o.id) || { orphan: true }, deriveWalls(p));
const texts = (p) => collectIssues(p).groups.flatMap((g) => g.items).map((i) => i.text);

test('B пристыкована с зазором перегородки — окно в общей стене, видно, с замечанием', () => {
  const { p, win } = scene({ x: -3100, y: 0, w: 3000, h: 3000 });
  reconcileEats(p);
  const at = placed(p, win);
  assert.ok(at, 'окно стоит на стене');
  assert.equal(at.wall.kind, 'shared');
  assert.equal(at.absCenter, 1500);
  assert.ok(texts(p).includes('Окно в общей стене — нет света снаружи'));
});

for (const [name, b] of [
  ['вплотную (зазор 0)', { x: -3000, y: 0, w: 3000, h: 3000 }],
  ['зазор 50 мм', { x: -3050, y: 0, w: 3000, h: 3000 }],
  ['вплотную, B со смещением (часть грани)', { x: -3000, y: 1000, w: 3000, h: 3000 }],
  ['вплотную, короткая B над окном', { x: -3000, y: 700, w: 3000, h: 1600 }],
  ['с наездом 250 мм на A (магнит к грани стены)', { x: -2750, y: 0, w: 3000, h: 3000 }],
  ['с наездом 500 мм на A', { x: -2500, y: 0, w: 3000, h: 3000 }],
]) {
  test(`B ${name}: срез полоски — окно переезжает в общую стену, не в сироты; B ушла — окно на месте`, () => {
    const { p, a, b: room, win, door } = scene(b);
    const res = reconcileEats(p, { touched: [room.id] });
    assert.equal(res.eaten.length, 1, 'нижняя съедена полоской');
    assert.ok(p.openings.some((o) => o.id === win.id), 'окно в проекте');
    assert.ok(!(a.eatBase.openings || []).some((o) => o.id === win.id), 'окно не сирота');
    const at = placed(p, win);
    assert.ok(at, 'окно видно');
    assert.equal(at.wall.kind, 'shared');
    assert.ok(Math.abs(at.absCenter - 1500) <= 200, `окно на прежнем месте: ${at.absCenter}`);
    assert.ok(placed(p, door), 'дверь видна');
    room.x -= 6000;
    reconcileEats(p, { touched: [room.id] });
    const back = p.openings.find((o) => o.id === win.id);
    assert.deepEqual([back.side, back.offset], [3, 1500], 'окно вернулось на свою грань');
    assert.equal(placed(p, win).wall.kind, 'own');
  });
}

test('B глубоко перекрывает грань с окном — окно сирота (в данных) с замечанием и возвращается', () => {
  const { p, a, b: room, win } = scene({ x: -1500, y: 0, w: 3000, h: 3000 });
  reconcileEats(p, { touched: [room.id] });
  assert.ok(!p.openings.some((o) => o.id === win.id));
  assert.deepEqual(a.eatBase.openings.map((o) => o.id), [win.id]);
  assert.deepEqual(orphanOpenings(p).map((x) => x.opening.id), [win.id]);
  assert.ok(texts(p).some((t) => /Проём «окно» под соседней комнатой/.test(t)));
  room.x -= 6000;
  reconcileEats(p, { touched: [room.id] });
  assert.equal(placed(p, win).absCenter, 1500, 'вернулось на место');
});

test('съедена часть грани: окно на видимой части стены видно и не висит без стены', () => {
  const { p, a, b: room, win } = scene({ x: -2500, y: 1800, w: 3000, h: 3000 });
  reconcileEats(p, { touched: [room.id] });
  assert.ok(a.eatBase);
  const at = placed(p, win);
  assert.ok(at, 'окно видно');
  assert.ok(at.absCenter >= at.wall.from && at.absCenter <= at.wall.to, 'центр окна на стене');
  assert.ok(Math.abs(at.absCenter - 1500) <= 450, `окно почти на месте: ${at.absCenter}`);
});

test('нет места на стене — проём сирота (keep), не удаляется; замечание «потерял стену»', () => {
  const p = createProject('место');
  const a = createRoom('bedroom', 0, 0, 2000, 3000);
  p.rooms.push(a);
  p.openings.push(createOpening('window', a.id, 0, 1000, 1500), createOpening('door', a.id, 0, 1000, 900));
  const walls = deriveWalls(p);
  const res = resolveOpeningConflicts(p, walls, { keep: true });
  assert.equal(res.dropped.length, 0);
  assert.equal(res.orphaned.length, 1);
  assert.equal(p.openings.length, 2, 'оба в проекте');
  const orphan = p.openings.find((o) => o.orphan);
  assert.equal(openingRect(p, orphan, walls), null, 'сирота не рисуется');
  assert.ok(texts(p).some((t) => /Проём «дверь» потерял стену/.test(t)));
  // Место появилось — сирота вернётся (reconcileOpenings снимает флаг, если стена есть).
  a.w = 5000;
  delete orphan.orphan;
  const again = resolveOpeningConflicts(p, deriveWalls(p), { keep: true });
  assert.equal(again.orphaned.length, 0);
  assert.ok(openingRect(p, orphan, deriveWalls(p)));
});

test('двери двух комнат на одной линии общей стены — обе видны, не налезают', () => {
  const p = createProject('двойной');
  const a = createRoom('bedroom', 0, 0, 4000, 3000);
  const b = createRoom('living', 4100, 0, 4000, 3000);
  p.rooms.push(a, b);
  p.openings.push(createOpening('door', a.id, 1, 1500, 900), createOpening('window', b.id, 3, 1500, 900));
  const walls = deriveWalls(p);
  resolveOpeningConflicts(p, walls, { keep: true });
  const spans = p.openings.map((o) => openingRect(p, o, walls)).map((r) => [r.absCenter - 450, r.absCenter + 450]).sort((x, y) => x[0] - y[0]);
  assert.equal(spans.length, 2);
  assert.ok(spans[1][0] - spans[0][1] >= 99.5, 'зазор между проёмами');
});

test('3D: окно и дверь в общей стене вырезаны в теле стены', () => {
  const { p, a, b: room, win } = scene({ x: -3000, y: 0, w: 3000, h: 3000 });
  p.openings.push(createOpening('door', room.id, 1, 2500, 800)); // дверь B в той же стене, ниже окна
  reconcileEats(p, { touched: [room.id] });
  const walls = deriveWalls(p);
  const { voids } = levelWallSolids(p, walls, 3000);
  const onShared = voids.filter((v) => v.wall.kind === 'shared');
  assert.ok(onShared.some((v) => v.id === win.id && v.kind === 'window'), 'окно вырезано');
  assert.ok(onShared.some((v) => v.kind === 'door'), 'дверь вырезана');
  assert.ok(a.eatBase);
});
