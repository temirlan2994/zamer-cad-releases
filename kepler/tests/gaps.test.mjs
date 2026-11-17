// Нестандартные зазоры (аудит 2026-11: «стыковка только при зазоре ~100 мм;
// при 0,3–0,5 м двойная стена без подсказки»): поиск промахов стыковки и
// сдвиг, который превращает их в общую стену.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { createItem, createOpening, createProject, createRoom, deserializeProject, levelProject } from '../core/model.js';
import { findNearMissGaps, planGapMove } from '../core/gaps.js';
import { moveRoomGroup } from '../core/room-group.js';
import { projectAdjacencies, sharedKey } from '../core/walls.js';
import { dockSnapRadius, snapRoomPosition } from '../core/rooms.js';

// Большая гостиная слева, маленькая спальня справа на зазоре gap.
function pair(gap, { bedH = 3000, bedY = 0 } = {}) {
  const project = createProject('зазор');
  const living = createRoom('living', 0, 0, 5000, 4000);
  const bed = createRoom('bedroom', 5000 + gap, bedY, 3000, bedH);
  project.rooms.push(living, bed);
  return { project, living, bed };
}

function dock(project, gap) {
  const { move } = gap;
  const res = moveRoomGroup(project, [move.roomId], [], move.dx, move.dy);
  assert.ok(res.ok, res.reason);
}

for (const g of [50, 98, 102, 300, 450]) {
  test(`зазор ${g} мм: найден, сдвиг меньшей комнаты даёт общую стену`, () => {
    const { project, living, bed } = pair(g);
    const gaps = findNearMissGaps(project);
    assert.equal(gaps.length, 1);
    const [gap] = gaps;
    assert.equal(gap.gap, g);
    assert.equal(gap.target, 100);
    assert.equal(gap.axis, 'x');
    assert.deepEqual(gap.overlap, { from: 0, to: 3000 });
    assert.equal(gap.move.roomId, bed.id, 'двигается меньшая комната');
    assert.equal(gap.move.dx, 100 - g);
    assert.equal(gap.move.dy, 0);
    dock(project, gap);
    assert.equal(bed.x, living.x + living.w + 100);
    assert.ok(projectAdjacencies(project).some((adj) => sharedKey(adj.a.id, adj.b.id) === sharedKey(living.id, bed.id)));
    assert.equal(findNearMissGaps(project).length, 0);
  });
}

test('зазор 483 мм и 451 мм — вне радиуса стыковки, промахом не считается', () => {
  assert.equal(findNearMissGaps(pair(483).project).length, 0);
  assert.equal(findNearMissGaps(pair(451).project).length, 0);
  assert.equal(findNearMissGaps(pair(500).project).length, 0);
});

test('точный зазор и зазор в пределах 1 мм — не промах; своя толщина пары — цель', () => {
  assert.equal(findNearMissGaps(pair(100).project).length, 0);
  assert.equal(findNearMissGaps(pair(100.5).project).length, 0);
  // 99 и 101 — в допуске 1 мм: это уже общая стена (findAdjacencies), не промах.
  for (const g of [99, 101]) {
    const { project } = pair(g);
    assert.equal(findNearMissGaps(project).length, 0);
    assert.equal(projectAdjacencies(project).length > 0, true);
  }
  const { project, living, bed } = pair(200);
  project.wallOverrides = { [sharedKey(living.id, bed.id)]: { thickness: 200 } };
  assert.equal(findNearMissGaps(project).length, 0);
  project.wallOverrides[sharedKey(living.id, bed.id)].thickness = 250;
  const [gap] = findNearMissGaps(project);
  assert.equal(gap.target, 250);
  assert.equal(gap.move.dx, 50);
});

test('перекрытие по длине меньше 300 мм — не промах', () => {
  assert.equal(findNearMissGaps(pair(50, { bedY: 3750 }).project).length, 0); // перекрытие 250
  assert.equal(findNearMissGaps(pair(50, { bedY: 3650 }).project).length, 1); // перекрытие 350
  assert.equal(findNearMissGaps(pair(50, { bedY: 5000 }).project).length, 0); // вообще мимо
});

test('вертикальная ось: комната снизу, сдвиг по Y', () => {
  const project = createProject('y');
  const a = createRoom('living', 0, 0, 5000, 4000);
  const b = createRoom('bathroom', 1000, 4000 + 250, 2000, 2000);
  project.rooms.push(a, b);
  const [gap] = findNearMissGaps(project);
  assert.equal(gap.axis, 'y');
  assert.equal(gap.move.roomId, b.id);
  assert.equal(gap.move.dy, -150);
  assert.deepEqual(gap.at, { x: 2000, y: 4125 });
});

test('сдвиг везёт мебель и проёмы, терраса и шахта не участвуют', () => {
  const { project, bed } = pair(250);
  const sofa = createItem('sofa', 6000, 1500);
  project.items.push(sofa);
  project.openings.push(createOpening('window', bed.id, 0, 1000, 1200));
  const [gap] = findNearMissGaps(project);
  dock(project, gap);
  assert.equal(sofa.x, 5850);
  const terrace = createProject('t');
  terrace.rooms.push(createRoom('living', 0, 0, 5000, 4000), createRoom('terrace', 5050, 0, 3000, 3000));
  assert.equal(findNearMissGaps(terrace).length, 0);
});

test('сдвиг разорвёт стыковку с третьей комнатой — двигаем другую, иначе move: null', () => {
  // Спальня зажата: справа вплотную (точный зазор) кабинет; слева гостиная на 50.
  const { project, living, bed } = pair(50);
  const office = createRoom('bedroom', 5050 + 3000 + 100, 0, 3000, 3000);
  project.rooms.push(office);
  // Двигать спальню нельзя (разорвётся стыковка с кабинетом) — двигается гостиная.
  const [gap] = findNearMissGaps(project);
  assert.equal(gap.move.roomId, living.id);
  assert.equal(gap.move.dx, -50);
  // Слева от гостиной вплотную ещё одна комната — двигать некого.
  const hall = createRoom('hall', -100 - 2000, 0, 2000, 4000);
  project.rooms.push(hall);
  const [stuck] = findNearMissGaps(project).filter((g) => g.key === sharedKey(living.id, bed.id));
  assert.equal(stuck.move, null);
  assert.match(stuck.reason, /стыковка/);
});

test('раздвинуть некуда: с обеих сторон соседи в 20–30 мм — move: null, причина «наложится»', () => {
  const { project, living, bed } = pair(50);
  project.rooms.push(
    createRoom('hall', 5050 + 3000 + 20, 0, 2000, 3000), // справа от спальни, зазор 20
    createRoom('hall', -30 - 2000, 0, 2000, 4000), // слева от гостиной, зазор 30
  );
  const gap = findNearMissGaps(project).find((g) => g.key === sharedKey(living.id, bed.id));
  assert.equal(gap.gap, 50);
  assert.equal(gap.move, null);
  assert.match(gap.reason, /наложится/);
  const plan = planGapMove(project, findNearMissGaps(project, { move: false }).find((g) => g.key === gap.key));
  assert.equal(plan.move, null);
});

test('Г-комнаты: зазор у стороны выреза находится и исправляется', () => {
  const project = createProject('Г');
  // Г-гостиная с вырезом в правом нижнем углу; в вырез вписана спальня с зазором 60.
  const living = createRoom('living', 0, 0, 6000, 6000);
  living.notch = { corner: 'se', w: 3000, h: 3000 };
  const bed = createRoom('bedroom', 3060, 3100, 2900, 2900);
  project.rooms.push(living, bed);
  const gaps = findNearMissGaps(project);
  assert.equal(gaps.length, 1);
  const [gap] = gaps;
  assert.equal(gap.gap, 60);
  assert.equal(gap.axis, 'x');
  // Сверху у спальни уже точный зазор 100 — пара стыкуется, сдвиг разорвал бы её.
  assert.equal(gap.move, null);
  assert.match(gap.reason, /уже стыкуется/);
  bed.y = 3200; // теперь сверху зазор 200, слева 60 — ближайший промах слева
  const [loose] = findNearMissGaps(project);
  assert.equal(loose.gap, 60);
  assert.equal(loose.move.roomId, bed.id);
  assert.equal(loose.move.dx, 40);
});

test('проект пользователя: Лестница / Гостиная 3 — зазор 50, сдвиг Гостиной 3 на 50', () => {
  const p = deserializeProject(readFileSync(new URL('./fixtures/user-house-2026-11.json', import.meta.url), 'utf8'));
  const lp = levelProject(p, p.levels[0].id);
  const gaps = findNearMissGaps(lp);
  const stair = gaps.find((g) => [g.aName, g.bName].includes('Лестница') && [g.aName, g.bName].includes('Гостиная 3'));
  assert.ok(stair);
  assert.equal(stair.gap, 50);
  assert.equal(stair.target, 100);
  assert.ok(stair.move);
  assert.equal(stair.move.distance, 50);
  dock(lp, stair);
  assert.equal(findNearMissGaps(lp).filter((g) => g.key === stair.key).length, 0);
});

test('магнит перетаскивания: любой зазор 0…450 мм притягивается к толщине общей стены пары', () => {
  for (const g of [0, 30, 250, 400, 450]) {
    const { project, living, bed } = pair(g);
    const snapped = snapRoomPosition(project, bed, bed.x, bed.y, 10, null);
    assert.equal(snapped.x, living.x + living.w + 100, `зазор ${g}`);
  }
  // Своя толщина пары 300: зазор 50 и 450 — тоже к 300.
  for (const g of [50, 450]) {
    const { project, living, bed } = pair(g);
    project.wallOverrides = { [sharedKey(living.id, bed.id)]: { thickness: 300 } };
    const snapped = snapRoomPosition(project, bed, bed.x, bed.y, 10, null);
    assert.equal(snapped.x, living.x + living.w + 300, `своя 300, зазор ${g}`);
  }
  assert.equal(dockSnapRadius(100, 10), 350);
  assert.equal(dockSnapRadius(300, 10), 300);
});
