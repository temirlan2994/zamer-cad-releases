// Проёмы не налезают друг на друга; дубликат комнаты не загоняет окна в
// общую стену; скрытая общая стена не рвёт наружный контур.
// Запуск: node --test tests/opening-spacing.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';

import { createOpening, createProject, createRoom } from '../core/model.js';
import { deriveWalls, openingRect, wallRects } from '../core/walls.js';
import {
  OPENING_GAP, fitOpeningOffset, openingGaps, resolveOpeningConflicts, snapOpeningOffset, windowsOnSharedWalls,
} from '../core/opening-spacing.js';
import { planRoomDuplicate } from '../core/duplicate-room.js';

function spans(project, walls) {
  return project.openings.map((o) => {
    const p = openingRect(project, o, walls);
    return { id: o.id, from: p.absCenter - o.width / 2, to: p.absCenter + o.width / 2 };
  }).sort((a, b) => a.from - b.from);
}

function assertSpaced(list) {
  for (let i = 1; i < list.length; i += 1) {
    assert.ok(list[i].from - list[i - 1].to >= OPENING_GAP - 0.5,
      `зазор ${list[i].from - list[i - 1].to} < ${OPENING_GAP}`);
  }
}

test('новый проём поверх существующего сдвигается к ближайшему свободному месту', () => {
  const project = createProject();
  const room = createRoom('living', 0, 0, 6000, 4000);
  project.rooms.push(room);
  const win = createOpening('window', room.id, 0, 3000, 1500); // 2250..3750
  project.openings.push(win);
  const walls = deriveWalls(project);
  const door = createOpening('door', room.id, 0, 3100, 900);
  const off = fitOpeningOffset(project, door, walls, 3100);
  // Ближе справа: 3750 + 100 + 450 = 4300.
  assert.equal(off, 4300);
  door.offset = off;
  project.openings.push(door);
  assertSpaced(spans(project, walls));
});

test('на занятой стене места нет — null (отказ)', () => {
  const project = createProject();
  const room = createRoom('bedroom', 0, 0, 2000, 3000);
  project.rooms.push(room);
  project.openings.push(createOpening('window', room.id, 0, 1000, 1500)); // 250..1750
  const walls = deriveWalls(project);
  const door = createOpening('door', room.id, 0, 1000, 900);
  assert.equal(fitOpeningOffset(project, door, walls, 1000), null);
});

test('проёмы двух комнат в общей стене — соседи', () => {
  const project = createProject();
  const a = createRoom('bedroom', 0, 0, 4000, 3000);
  const b = createRoom('living', 4100, 0, 4000, 3000);
  project.rooms.push(a, b);
  project.openings.push(createOpening('door', a.id, 1, 1500, 900)); // y 1050..1950
  const walls = deriveWalls(project);
  const other = createOpening('door', b.id, 3, 1500, 900);
  const off = fitOpeningOffset(project, other, walls, 1500);
  assert.ok(Math.abs(off - 1500) >= 900 + OPENING_GAP - 0.5);
});

test('прижатые проёмы раздвигаются, не помещающиеся — удаляются', () => {
  const project = createProject();
  const room = createRoom('living', 0, 0, 3000, 4000);
  project.rooms.push(room);
  // После укорачивания стены (Б3) оба окна прижаты к одному краю.
  const w1 = createOpening('window', room.id, 0, 2200, 1200);
  const w2 = createOpening('window', room.id, 0, 2200, 1200);
  project.openings.push(w1, w2);
  const walls = deriveWalls(project);
  const res = resolveOpeningConflicts(project, walls);
  assert.deepEqual(res.dropped, []);
  assert.deepEqual(res.moved, [w2.id]);
  assertSpaced(spans(project, walls));
  // Третье окно уже не влезает.
  const w3 = createOpening('window', room.id, 0, 1500, 1200);
  project.openings.push(w3);
  const res2 = resolveOpeningConflicts(project, walls);
  assert.deepEqual(res2.dropped, [w3.id]);
  assert.equal(project.openings.length, 2);
});

test('Ctrl+D: окно копии не остаётся в общей стене с исходной', () => {
  const project = createProject();
  const room = createRoom('bedroom', 0, 0, 4000, 3000);
  project.rooms.push(room);
  // Окна слева и сверху: справа копия встанет вплотную, её левое окно —
  // в общей стене.
  project.openings.push(createOpening('window', room.id, 3, 1500, 1200));
  project.openings.push(createOpening('window', room.id, 0, 2000, 1200));
  const plan = planRoomDuplicate(project, room.id);
  assert.equal(plan.ok, true);
  project.rooms.push(...plan.rooms);
  project.openings.push(...plan.openings);
  const walls = deriveWalls(project);
  assert.deepEqual(windowsOnSharedWalls(project, walls), []);
  assert.ok(walls.some((w) => w.kind === 'shared'), 'копия стоит вплотную');
  // Справа нет окна у исходной → копия справа, её левое окно удалено.
  assert.equal(plan.dx, 4100);
  assert.equal(plan.removedOpenings, 1);
  assert.equal(plan.openings.length, 1);
});

test('Ctrl+D: окно исходной справа — копия встаёт с другой стороны', () => {
  const project = createProject();
  const room = createRoom('bedroom', 0, 0, 4000, 3000);
  project.rooms.push(room);
  project.openings.push(createOpening('window', room.id, 1, 1500, 1200));
  const plan = planRoomDuplicate(project, room.id);
  assert.equal(plan.ok, true);
  assert.notEqual(plan.dx, 4100);
  project.rooms.push(...plan.rooms);
  project.openings.push(...plan.openings);
  assert.deepEqual(windowsOnSharedWalls(project, deriveWalls(project)), []);
  assert.equal(plan.removedOpenings, 0);
});

test('Ctrl+D: справа занято — копия в свободном месте, без наложения', () => {
  const project = createProject();
  const room = createRoom('bedroom', 0, 0, 4000, 3000);
  const right = createRoom('living', 4100, 0, 4000, 3000);
  project.rooms.push(room, right);
  const plan = planRoomDuplicate(project, room.id);
  assert.equal(plan.ok, true);
  const copy = plan.rooms[0];
  for (const r of [room, right]) {
    const ox = Math.min(copy.x + copy.w, r.x + r.w) - Math.max(copy.x, r.x);
    const oy = Math.min(copy.y + copy.h, r.y + r.h) - Math.max(copy.y, r.y);
    assert.ok(ox <= 1 || oy <= 1, 'копия не налезает на соседей');
  }
});

test('скрытая общая стена: наружный контур без щели, стена помечена hidden', () => {
  const project = createProject();
  const a = createRoom('bedroom', 0, 0, 4000, 3000);
  const b = createRoom('living', 4100, 0, 5000, 3000);
  project.rooms.push(a, b);
  const shared = deriveWalls(project).find((w) => w.kind === 'shared');
  project.wallOverrides[shared.key] = { hidden: true };
  const walls = deriveWalls(project);
  assert.equal(walls.find((w) => w.kind === 'shared').hidden, true);
  // Верхняя наружная линия (y < 0) покрыта от x=0 до x=9100 без разрыва.
  // Куски тела стен (v1 — полосы и заплатки-стыки, v2 — rects области).
  const top = walls.filter((w) => !w.hidden).flatMap(wallRects)
    .filter((r) => r.y < 0 && r.y + r.h <= 0.5)
    .map((r) => ({ from: r.x, to: r.x + r.w }))
    .sort((p, q) => p.from - q.from);
  let reach = 0;
  for (const seg of top) {
    if (seg.from > reach + 0.5) break;
    reach = Math.max(reach, seg.to);
  }
  assert.ok(reach >= 9100, `щель в наружной стене после x=${reach}`);
});

test('привязка проёма: круглые расстояния до торца, середина стены, без шага', () => {
  const project = createProject();
  const room = createRoom('living', 0, 0, 6000, 4000);
  project.rooms.push(room);
  const op = createOpening('window', room.id, 0, 1234, 911);
  project.openings.push(op);
  const walls = deriveWalls(project);
  const gaps = (offset) => {
    const probe = { ...op, offset };
    const g = openingGaps(project, probe, walls);
    return { l: g.from - g.left, r: g.right - g.to };
  };
  // шаг 50: ближайший к торцу зазор кратен шагу
  const a = snapOpeningOffset(project, op, walls, 1234, { step: 50, tol: 0 });
  assert.equal(gaps(a).l % 50, 0, JSON.stringify(gaps(a)));
  // рядом с серединой — ровно по центру: зазоры равны
  const mid = snapOpeningOffset(project, op, walls, 3010, { step: 50, tol: 100 });
  const gm = gaps(mid);
  assert.ok(Math.abs(gm.l - gm.r) < 1, JSON.stringify(gm));
  // Shift (step 1, tol 0) — позиция не меняется
  assert.equal(snapOpeningOffset(project, op, walls, 1234, { step: 1, tol: 0 }), 1234);
});
