// Сценарии съедания перекрытых комнат на мосту v7 (core/v7/eat-bridge.js,
// core/v7/carve.js; docs/v7-stage2-plan.md, срез 6 — замена старых тестов
// core/room-eat.js): верхняя комната забирает у нижней пересечение, между
// ними — перегородка толщины общей стены пары; результат зависит только от
// номинальных форм и порядка (путь-независимость), удалили/сдвинули верхнюю —
// нижняя снова целая, проёмы-«сироты» возвращаются.
import test from 'node:test';
import assert from 'node:assert/strict';

import { createOpening, createProject, createRoom, removeRoom } from '../core/model.js';
import { createLoopRoom } from '../core/bound-rooms.js';
import { normsReport, roomOverlaps, trimRoomBy } from '../core/norms.js';
import { roomRects, roomShapeArea } from '../core/room-shape.js';
import { roomNetAreaM2 } from '../core/rooms.js';
import { EAT_SLIVER } from '../core/v7/carve.js';
import { eatSummary, eatersOf, liftRoom, nominalShape, reconcileEats } from '../core/v7/eat-bridge.js';
import { deriveWalls, openingRect, sharedKey, wallRects } from '../core/walls.js';
import { EAT_FIXTURES } from './wall-fixtures.mjs';

const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;
const shape = (r) => ({ x: r.x, y: r.y, w: r.w, h: r.h, outline: r.outline || null });
const box = (r) => [r.x, r.y, r.w, r.h];

function pair(lower, upper, extra = {}) {
  const p = createProject('съедание');
  const a = createRoom(lower.type || 'living', lower.x, lower.y, lower.w, lower.h);
  const b = createRoom(upper.type || 'bedroom', upper.x, upper.y, upper.w, upper.h);
  a.name = 'Нижняя'; b.name = 'Верхняя';
  Object.assign(p.settings, extra);
  p.rooms.push(a, b);
  return { p, a, b };
}
const corner = () => pair({ x: 0, y: 0, w: 4000, h: 4000 }, { x: 3000, y: 3000, w: 3000, h: 3000 });

const clip = (r, q) => {
  const w = Math.min(r.x + r.w, q.x + q.w) - Math.max(r.x, q.x);
  const h = Math.min(r.y + r.h, q.y + q.h) - Math.max(r.y, q.y);
  return w > 0 && h > 0 ? w * h : 0;
};

test('угол: нижняя — Г без пересечения и зазора 100, между ними общая перегородка', () => {
  const { p, a, b } = corner();
  const union = 4000 * 4000 + 3000 * 3000 - 1000 * 1000;
  const res = reconcileEats(p, { touched: [b.id] });
  assert.equal(res.eaten.length, 1);
  assert.equal(res.failed.length, 0);
  assert.ok(a.outline, 'нижняя стала контурной');
  assert.equal(roomShapeArea(a), 4000 * 4000 - 1100 * 1100);
  assert.equal(roomOverlaps(p).length, 0);
  // Площади без двойного учёта: эффективные + стены в пределах объединения
  // исходных комнат = площадь объединения.
  const walls = deriveWalls(p);
  const shared = walls.filter((w) => w.kind === 'shared' && w.rooms.includes(a.id) && w.rooms.includes(b.id));
  assert.ok(shared.length >= 2, 'общая стена по обеим сторонам угла');
  for (const w of shared) assert.equal(w.thickness, 100);
  const A0 = { x: 0, y: 0, w: 4000, h: 4000 }; const B0 = { x: 3000, y: 3000, w: 3000, h: 3000 };
  const AB = { x: 3000, y: 3000, w: 1000, h: 1000 };
  const wallIn = walls.flatMap((w) => wallRects(w)).reduce((s, r) => s + clip(r, A0) + clip(r, B0) - clip(r, AB), 0);
  const eff = (roomNetAreaM2(p, a) + roomNetAreaM2(p, b)) * 1e6;
  assert.equal(eff, union - 1100 * 1100 + 1000 * 1000, 'нижняя отдала пересечение и зазор');
  assert.ok(near(eff + wallIn, union, 1), `${eff} + ${wallIn} ≠ ${union}`);
  assert.equal(normsReport(p).problems.filter((x) => x.kind === 'overlap').length, 0);
  assert.match(eatSummary(res), /«Нижняя» уменьшена: пересечение с «Верхняя»/);
});

test('толщина общей стены пары берётся из wallOverrides[s|a|b]', () => {
  const { p, a, b } = pair({ x: 0, y: 0, w: 5000, h: 4000 }, { x: 4000, y: 0, w: 3000, h: 4000 });
  p.wallOverrides[sharedKey(a.id, b.id)] = { thickness: 200 };
  reconcileEats(p, { touched: [b.id] });
  assert.equal(roomRects(a).length, 1, 'прямоугольник остался прямоугольником');
  assert.equal(roomShapeArea(a), 3800 * 4000);
  const shared = deriveWalls(p).find((w) => w.kind === 'shared' && w.rooms.includes(a.id) && w.rooms.includes(b.id));
  assert.equal(shared?.thickness, 200);
});

test('несъедаемое: целиком под верхней, разрез на части — комната не тронута, понятное замечание', () => {
  {
    const { p, a, b } = pair({ x: 1000, y: 1000, w: 2000, h: 2000 }, { x: 0, y: 0, w: 5000, h: 5000 });
    const res = reconcileEats(p, { touched: [b.id] });
    assert.equal(res.failed[0]?.why, 'whole');
    assert.deepEqual(shape(a), { x: 1000, y: 1000, w: 2000, h: 2000, outline: null });
    const o = normsReport(p).problems.filter((x) => x.kind === 'overlap');
    assert.equal(o.length, 1);
    assert.match(o[0].text, /«Нижняя» целиком под «Верхняя»/);
    assert.equal(o[0].trim, null);
  }
  {
    const { p, a, b } = pair({ x: 0, y: 0, w: 8000, h: 4000 }, { x: 3000, y: -1000, w: 2000, h: 6000 });
    const res = reconcileEats(p, { touched: [b.id] });
    assert.equal(res.failed[0]?.why, 'split');
    assert.equal(a.outline, undefined);
    assert.equal(p.rooms.at(-1), b, 'верхняя — поверх по z');
    assert.match(normsReport(p).problems.find((x) => x.kind === 'overlap').text, /разрезает «Нижняя» на части/);
  }
});

test('волосок у края срезается: нет полоски тоньше EAT_SLIVER', () => {
  const { p, a, b } = pair({ x: 0, y: 0, w: 5000, h: 4000 }, { x: 150, y: 3000, w: 3000, h: 3000 });
  reconcileEats(p, { touched: [b.id] });
  assert.ok(a.eatBase, 'съедена');
  for (const r of roomRects(a)) assert.ok(Math.min(r.w, r.h) >= EAT_SLIVER, JSON.stringify(r));
});

test('проёмы нижней: на оставшейся части стены — на месте в мире, под верхней — сирота', () => {
  const { p, a, b } = pair({ x: 0, y: 0, w: 5000, h: 4000 }, { x: 4000, y: 2000, w: 3000, h: 3000 });
  const keep = createOpening('window', a.id, 1, 800, 900); // правая стена, y 350…1250 — остаётся
  const gone = createOpening('door', a.id, 1, 3000, 800); // правая стена, y ≈ 3000 — под верхней
  p.openings.push(keep, gone);
  const before = openingRect(p, keep, deriveWalls(p));
  reconcileEats(p, { touched: [b.id] });
  assert.deepEqual(p.openings.map((o) => o.id), [keep.id]);
  assert.deepEqual(a.eatBase.openings.map((o) => o.id), [gone.id], 'дверь — сирота съеденной');
  const after = openingRect(p, keep, deriveWalls(p));
  assert.ok(before && after);
  assert.ok(near(before.rect.x, after.rect.x, 1) && near(before.rect.y, after.rect.y, 1), 'окно не сдвинулось');
});

test('«Обрезать» старого перекрытия — с перегородкой', () => {
  const { p, a, b } = pair({ x: 0, y: 0, w: 5000, h: 4000 }, { x: 4000, y: 1000, w: 3000, h: 3000 });
  const report = normsReport(p).problems.filter((x) => x.kind === 'overlap');
  assert.equal(report.length, 1);
  assert.match(report[0].text, /между ними встанет перегородка/);
  assert.ok(report[0].trim, 'есть действие «Обрезать»');
  assert.equal(a.outline, undefined, 'нормы считают на копии — проект не тронут');
  assert.ok(trimRoomBy(a, b, p));
  assert.equal(roomShapeArea(a), 5000 * 4000 - 1100 * 3100);
  assert.equal(roomOverlaps(p).length, 0);
});

test('фикстуры съедания: перекрытий нет, формы не пересекаются', () => {
  for (const [name, build] of Object.entries(EAT_FIXTURES)) {
    const p = build();
    assert.equal(roomOverlaps(p).length, 0, name);
    assert.ok(p.rooms.some((r) => r.eatBase), `${name}: кто-то съеден`);
    const rects = p.rooms.flatMap((r) => roomRects(r));
    for (let i = 0; i < rects.length; i += 1) {
      for (let k = i + 1; k < rects.length; k += 1) assert.equal(clip(rects[i], rects[k]), 0, `${name}: формы пересекаются`);
    }
  }
});

test('петля стен вокруг комнаты целиком — помещение не создаётся', () => {
  const p = createProject('петля вокруг');
  const inner = createRoom('bathroom', 2000, 2000, 1500, 1500);
  inner.name = 'Санузел';
  p.rooms.push(inner);
  const wall = (id, ax, ay, bx, by) => ({
    id, axis: { kind: 'line', a: { x: ax, y: ay }, b: { x: bx, y: by } }, justify: 'center', thickness: 200,
    typeId: null, wallType: 'partition', base: { offset: 0 }, top: { level: null, offset: 0, height: null },
    hidden: false, roomBounding: true,
  });
  p.walls.push(wall('w1', 0, 0, 6000, 0), wall('w2', 6000, 0, 6000, 6000), wall('w3', 6000, 6000, 0, 6000), wall('w4', 0, 6000, 0, 0));
  const res = createLoopRoom(p, deriveWalls(p), { x: 500, y: 500 });
  assert.equal(res.ok, false);
  assert.match(res.reason, /уже есть помещение «Санузел»/);
  assert.equal(p.rooms.length, 1);
});

test('съеденная комната возвращает форму, когда верхняя отъезжает', () => {
  const { p, a, b } = corner();
  reconcileEats(p, { touched: [b.id] });
  assert.ok(a.outline, 'нижняя стала Г-образной');
  b.x = 8000; b.y = 8000;
  const res = reconcileEats(p, { touched: [b.id] });
  assert.equal(res.restored.length, 1);
  assert.match(eatSummary(res), /Форма восстановлена: «Нижняя»/);
  assert.deepEqual(shape(a), { x: 0, y: 0, w: 4000, h: 4000, outline: null });
  assert.equal(a.eatBase, undefined);
});

test('частичный возврат: верхняя сдвинулась, но ещё перекрывает', () => {
  const { p, a, b } = corner();
  reconcileEats(p, { touched: [b.id] });
  const area0 = roomShapeArea(a);
  b.x = 3500; b.y = 3500;
  reconcileEats(p, { touched: [b.id] });
  const areaNow = roomShapeArea(a);
  b.x = 3000; b.y = 3000;
  reconcileEats(p, { touched: [b.id] });
  assert.ok(areaNow > roomShapeArea(a));
  assert.equal(roomShapeArea(a), area0, 'вернулась ровно к исходному съеданию');
});

test('нижнюю подвинули саму — номинал едет с ней, форма не «телепортируется»', () => {
  const { p, a, b } = corner();
  reconcileEats(p, { touched: [b.id] });
  a.x -= 2000;
  reconcileEats(p, { touched: [a.id] });
  b.x = 9000;
  reconcileEats(p, { touched: [b.id] });
  assert.equal(a.eatBase, undefined);
  assert.deepEqual(shape(a), { x: -2000, y: 0, w: 4000, h: 4000, outline: null });
});

test('после удаления съедавшей комнаты форма и проём возвращаются', () => {
  const { p, a, b } = pair({ x: 0, y: 0, w: 5000, h: 4000 }, { x: 4000, y: 2000, w: 3000, h: 3000 });
  const door = createOpening('door', a.id, 1, 3000, 800);
  p.openings.push(door);
  reconcileEats(p, { touched: [b.id] });
  assert.ok(!p.openings.some((o) => o.id === door.id), 'проём пропал под верхней');
  removeRoom(p, b.id);
  reconcileEats(p);
  assert.deepEqual(shape(a), { x: 0, y: 0, w: 5000, h: 4000, outline: null });
  assert.ok(p.openings.some((o) => o.id === door.id), 'проём вернулся');
});

test('проём под съедавшей комнатой возвращается, когда она уехала', () => {
  const { p, a, b } = pair({ x: 0, y: 0, w: 5000, h: 4000 }, { x: 4000, y: 2000, w: 3000, h: 3000 });
  const door = createOpening('door', a.id, 1, 3000, 800);
  p.openings.push(door);
  const before = openingRect(p, door, deriveWalls(p));
  reconcileEats(p, { touched: [b.id] });
  const lostAfterEat = !p.openings.some((o) => o.id === door.id);
  b.x = 9000; b.y = 9000;
  reconcileEats(p, { touched: [b.id] });
  assert.ok(lostAfterEat, 'проём пропал под верхней');
  const back = p.openings.find((o) => o.id === door.id);
  assert.ok(back, 'проём вернулся');
  const after = openingRect(p, back, deriveWalls(p));
  assert.ok(near(before.rect.x, after.rect.x, 1) && near(before.rect.y, after.rect.y, 1), 'на прежнем месте');
});

test('узкий остаток 700 мм съедается', () => {
  const { p, a, b } = pair({ x: 0, y: 0, w: 3000, h: 4000 }, { x: 800, y: -500, w: 4000, h: 6000 });
  const res = reconcileEats(p, { touched: [b.id] });
  assert.equal(res.failed.length, 0);
  assert.equal(res.eaten.length, 1);
  assert.equal(roomShapeArea(a), 700 * 4000);
  assert.equal(roomOverlaps(p).length, 0);
});

test('сдвинули съеденную нижнюю — она возвращается целой на новом месте', () => {
  const { p, a, b } = corner();
  reconcileEats(p, { touched: [b.id] });
  assert.ok(a.outline, 'нижняя съедена');
  a.x -= 6000; a.y -= 6000;
  const res = reconcileEats(p, { touched: [a.id] });
  assert.equal(res.restored.length, 1);
  assert.deepEqual(shape(a), { x: -6000, y: -6000, w: 4000, h: 4000, outline: null });
  assert.equal(roomOverlaps(p).length, 0);
});

test('нижнюю чуть сдвинули под верхней — теперь она сверху и съедает верхнюю', () => {
  const { p, a, b } = corner();
  reconcileEats(p, { touched: [b.id] });
  a.x += 200;
  reconcileEats(p, { touched: [a.id] });
  assert.equal(roomOverlaps(p).length, 0, 'перекрытия нет');
  assert.ok(b.eatBase && !a.eatBase);
});

test('группу (нижняя + съедавшая) сдвинули вместе — форма нижней не меняется', () => {
  const { p, a, b } = corner();
  reconcileEats(p, { touched: [b.id] });
  const area0 = roomShapeArea(a);
  for (const r of [a, b]) { r.x += 1500; r.y += 700; }
  reconcileEats(p, { touched: [a.id, b.id] });
  assert.equal(roomShapeArea(a), area0);
  assert.ok(a.eatBase, 'нижняя по-прежнему съедена');
  assert.deepEqual(box(a.eatBase.base), [1500, 700, 4000, 4000], 'номинал сдвинут вместе');
  b.x = 20000;
  reconcileEats(p, { touched: [b.id] });
  assert.deepEqual(shape(a), { x: 1500, y: 700, w: 4000, h: 4000, outline: null });
});

// Детерминированный ГПСЧ (mulberry32).
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Построение с нуля: те же номиналы и тот же порядок, один пересчёт.
function fromScratch(p) {
  const q = createProject('с нуля');
  for (const r of p.rooms) {
    const n = nominalShape(r);
    const c = createRoom(r.type, n.x, n.y, n.w, n.h);
    c.id = r.id; c.name = r.name;
    if (n.outline) c.outline = n.outline.map((pt) => ({ ...pt }));
    q.rooms.push(c);
  }
  reconcileEats(q);
  return q;
}

test('fuzz: случайные сдвиги, растяжения и удаления = построение с нуля', () => {
  const types = ['living', 'bedroom', 'kitchen', 'hall', 'bathroom'];
  for (let seed = 1; seed <= 40; seed += 1) {
    const rand = rng(seed);
    const step = (n) => Math.round(rand() * n) * 100;
    const p = createProject(`fuzz ${seed}`);
    for (let i = 0; i < 4; i += 1) {
      const r = createRoom(types[i % types.length], step(60), step(60), 2000 + step(30), 2000 + step(30));
      r.name = `К${i}`;
      p.rooms.push(r);
    }
    reconcileEats(p, { touched: p.rooms.map((r) => r.id) });
    for (let k = 0; k < 12; k += 1) {
      const r = p.rooms[Math.floor(rand() * p.rooms.length)];
      const op = rand();
      if (op < 0.08 && p.rooms.length > 2) {
        removeRoom(p, r.id);
        reconcileEats(p);
      } else if (op < 0.3) {
        // Растяжение — по номиналу, под теми, кто ел (как ручка).
        const under = { [r.id]: eatersOf(r) };
        liftRoom(p, r.id);
        if (r.outline) continue; // номинал — прямоугольник (фикстуры fuzz)
        r.w = Math.max(1200, r.w + step(20) - 1000);
        reconcileEats(p, { touched: [r.id], under });
      } else {
        // Сдвиг видимой формы (номинал едет вместе с ней).
        r.x += step(40) - 2000; r.y += step(40) - 2000;
        reconcileEats(p, { touched: [r.id] });
      }
      const ref = fromScratch(p);
      for (const room of p.rooms) {
        const twin = ref.rooms.find((x) => x.id === room.id);
        assert.deepEqual(shape(room), shape(twin), `seed ${seed}, шаг ${k}: ${room.name}`);
      }
      // Повторный пересчёт ничего не меняет.
      const snap = JSON.stringify(p.levels);
      reconcileEats(p);
      assert.equal(JSON.stringify(p.levels), snap, `seed ${seed}, шаг ${k}: не идемпотентно`);
    }
  }
});
