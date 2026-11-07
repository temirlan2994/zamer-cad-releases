// Съедание перекрытых комнат (core/room-eat.js, docs/walls-v2-architecture.md,
// раздел 5): верхняя комната забирает у нижней пересечение, между ними —
// перегородка толщины общей стены пары. Тесты идут на любом движке
// (npm test — v2, KEPLER_WALLS=v1 — старый).
import test from 'node:test';
import assert from 'node:assert/strict';

import { createOpening, createProject, createRoom } from '../core/model.js';
import { createLoopRoom } from '../core/bound-rooms.js';
import { normsReport, roomOverlaps, trimRoomBy } from '../core/norms.js';
import { eatOverlaps, eatShape, restoreEaten } from '../core/room-eat.js';
import { roomRects, roomShapeArea } from '../core/room-shape.js';
import { roomNetAreaM2 } from '../core/rooms.js';
import { deriveWalls, openingRect, sharedKey, wallRects, wallsEngine } from '../core/walls.js';
import { EAT_FIXTURES } from './wall-fixtures.mjs';

const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

function pair(lower, upper, extra = {}) {
  const p = createProject('съедание');
  const a = createRoom(lower.type || 'living', lower.x, lower.y, lower.w, lower.h);
  const b = createRoom(upper.type || 'bedroom', upper.x, upper.y, upper.w, upper.h);
  a.name = 'Нижняя'; b.name = 'Верхняя';
  Object.assign(p.settings, extra);
  p.rooms.push(a, b);
  return { p, a, b };
}

const clip = (r, q) => {
  const w = Math.min(r.x + r.w, q.x + q.w) - Math.max(r.x, q.x);
  const h = Math.min(r.y + r.h, q.y + q.h) - Math.max(r.y, q.y);
  return w > 0 && h > 0 ? w * h : 0;
};

test('угол: нижняя — Г без пересечения и зазора 100, между ними общая перегородка', () => {
  const { p, a, b } = pair({ x: 0, y: 0, w: 4000, h: 4000 }, { x: 3000, y: 3000, w: 3000, h: 3000 });
  const union = 4000 * 4000 + 3000 * 3000 - 1000 * 1000;
  const res = eatOverlaps(p, [b.id]);
  assert.equal(res.eaten.length, 1);
  assert.equal(res.failed.length, 0);
  assert.ok(a.outline, 'нижняя стала контурной');
  assert.equal(roomShapeArea(a), 4000 * 4000 - 1100 * 1100);
  assert.equal(roomOverlaps(p).length, 0);
  // Площади — без двойного учёта: эффективные площади + стены в пределах
  // объединения исходных комнат = площадь объединения.
  const walls = deriveWalls(p);
  const shared = walls.filter((w) => w.kind === 'shared' && w.rooms.includes(a.id) && w.rooms.includes(b.id));
  assert.ok(shared.length >= 2, 'общая стена по обеим сторонам угла');
  for (const w of shared) assert.equal(w.thickness, 100);
  const A0 = { x: 0, y: 0, w: 4000, h: 4000 }; const B0 = { x: 3000, y: 3000, w: 3000, h: 3000 };
  const AB = { x: 3000, y: 3000, w: 1000, h: 1000 };
  const wallIn = walls.flatMap((w) => wallRects(w)).reduce((s, r) => s + clip(r, A0) + clip(r, B0) - clip(r, AB), 0);
  const eff = (roomNetAreaM2(p, a) + roomNetAreaM2(p, b)) * 1e6;
  assert.equal(eff, union - 1100 * 1100 + 1000 * 1000, 'нижняя отдала пересечение и зазор');
  // v1: куски стен накладываются (известный дефект e) — сумма только для v2.
  if (wallsEngine(p) === 'v2') assert.ok(near(eff + wallIn, union, 1), `${eff} + ${wallIn} ≠ ${union}`);
  // Нормы: замечания о перекрытии нет.
  assert.equal(normsReport(p).problems.filter((x) => x.kind === 'overlap').length, 0);
});

test('толщина общей стены пары берётся из wallOverrides[s|a|b]', () => {
  const { p, a, b } = pair({ x: 0, y: 0, w: 5000, h: 4000 }, { x: 4000, y: 0, w: 3000, h: 4000 });
  p.wallOverrides[sharedKey(a.id, b.id)] = { thickness: 200 };
  eatOverlaps(p, [b.id]);
  assert.equal(a.outline, undefined, 'прямоугольник остался прямоугольником');
  assert.equal(a.w, 3800);
  const shared = deriveWalls(p).find((w) => w.kind === 'shared' && w.rooms.includes(a.id) && w.rooms.includes(b.id));
  assert.equal(shared?.thickness, 200);
});

test('несъедаемое: целиком под верхней, разрез на части — комната не тронута, понятное замечание', () => {
  {
    const { p, a, b } = pair({ x: 1000, y: 1000, w: 2000, h: 2000 }, { x: 0, y: 0, w: 5000, h: 5000 });
    // Верхняя целиком накрывает нижнюю (вложенной она станет только жестом «внутрь»).
    const res = eatOverlaps(p, [b.id]);
    assert.equal(res.failed[0]?.why, 'whole');
    assert.equal(a.w, 2000);
    const o = normsReport(p).problems.filter((x) => x.kind === 'overlap');
    assert.equal(o.length, 1);
    assert.match(o[0].text, /«Нижняя» целиком под «Верхняя»/);
    assert.equal(o[0].trim, null);
  }
  {
    const { p, a, b } = pair({ x: 0, y: 0, w: 8000, h: 4000 }, { x: 3000, y: -1000, w: 2000, h: 6000 });
    const res = eatOverlaps(p, [b.id]);
    assert.equal(res.failed[0]?.why, 'split');
    assert.equal(a.outline, undefined);
    assert.equal(p.rooms.at(-1), b, 'верхняя — поверх по z');
    assert.match(normsReport(p).problems.find((x) => x.kind === 'overlap').text, /разрезает «Нижняя» на части/);
  }
});

test('волосок у края срезается: нет полоски тоньше EAT_SLIVER', () => {
  const lower = createRoom('living', 0, 0, 5000, 4000);
  const upper = createRoom('bedroom', 150, 3000, 3000, 3000);
  const shape = eatShape(lower, upper, 100);
  assert.ok(shape.ok);
  for (const r of shape.rects) assert.ok(Math.min(r.w, r.h) >= 250, JSON.stringify(r));
});

test('проёмы нижней: на оставшейся части стены — на месте в мире, под верхней — удалены', () => {
  const { p, a, b } = pair({ x: 0, y: 0, w: 5000, h: 4000 }, { x: 4000, y: 2000, w: 3000, h: 3000 });
  const keep = createOpening('window', a.id, 1, 800, 900); // правая стена, y 350…1250 — остаётся
  const gone = createOpening('door', a.id, 1, 3000, 800); // правая стена, y ≈ 3000 — под верхней
  p.openings.push(keep, gone);
  const before = openingRect(p, keep, deriveWalls(p));
  const res = eatOverlaps(p, [b.id]);
  assert.deepEqual(res.lost, [gone.id]);
  assert.equal(p.openings.length, 1);
  const after = openingRect(p, keep, deriveWalls(p));
  assert.ok(before && after);
  assert.ok(near(before.rect.x, after.rect.x, 1) && near(before.rect.y, after.rect.y, 1), 'окно не сдвинулось');
});

test('«Обрезать» старого перекрытия — с перегородкой', () => {
  const { p, a, b } = pair({ x: 0, y: 0, w: 5000, h: 4000 }, { x: 4000, y: 1000, w: 3000, h: 3000 });
  const report = normsReport(p).problems.filter((x) => x.kind === 'overlap');
  assert.equal(report.length, 1);
  assert.match(report[0].text, /между ними встанет перегородка/);
  assert.ok(trimRoomBy(a, b, p));
  assert.equal(roomShapeArea(a), 5000 * 4000 - 1100 * 3100);
  assert.equal(roomOverlaps(p).length, 0);
});

test('фикстуры съедания: перекрытий нет, площади нижних уменьшены', () => {
  for (const [name, build] of Object.entries(EAT_FIXTURES)) {
    const p = build();
    assert.equal(roomOverlaps(p).length, 0, name);
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
  const { p, a, b } = pair({ x: 0, y: 0, w: 4000, h: 4000 }, { x: 3000, y: 3000, w: 3000, h: 3000 });
  eatOverlaps(p, [b.id]);
  assert.ok(a.outline, 'нижняя стала Г-образной');
  b.x = 8000; b.y = 8000; // отъехала
  const res = eatOverlaps(p, [b.id]);
  assert.equal(res.restored.length, 1);
  assert.equal(a.outline, undefined);
  assert.deepEqual([a.x, a.y, a.w, a.h], [0, 0, 4000, 4000]);
  assert.equal(a.eatBase, undefined);
});

test('частичный возврат: верхняя сдвинулась, но ещё перекрывает', () => {
  const { p, a, b } = pair({ x: 0, y: 0, w: 4000, h: 4000 }, { x: 3000, y: 3000, w: 3000, h: 3000 });
  eatOverlaps(p, [b.id]);
  b.x = 3500; b.y = 3500;
  eatOverlaps(p, [b.id]);
  const areaNow = roomShapeArea(a);
  b.x = 3000; b.y = 3000;
  eatOverlaps(p, [b.id]);
  assert.ok(roomShapeArea(a) < 4000 * 4000);
  assert.ok(areaNow > roomShapeArea(a));
});

test('нижнюю подвинули сами — база забывается, форма не «телепортируется»', () => {
  const { p, a, b } = pair({ x: 0, y: 0, w: 4000, h: 4000 }, { x: 3000, y: 3000, w: 3000, h: 3000 });
  eatOverlaps(p, [b.id]);
  a.x -= 2000;
  eatOverlaps(p, [a.id]);
  b.x = 9000;
  eatOverlaps(p, [b.id]);
  assert.equal(a.eatBase, undefined);
  assert.equal(a.x, -2000);
});

test('после удаления съедавшей комнаты форма возвращается', () => {
  const { p, a, b } = pair({ x: 0, y: 0, w: 4000, h: 4000 }, { x: 3000, y: 3000, w: 3000, h: 3000 });
  eatOverlaps(p, [b.id]);
  p.rooms = p.rooms.filter((r) => r.id !== b.id);
  restoreEaten(p, new Set([b.id]));
  assert.equal(a.outline, undefined);
  assert.deepEqual([a.x, a.y, a.w, a.h], [0, 0, 4000, 4000]);
});

test('проём под съедавшей комнатой возвращается вместе с формой', () => {
  const { p, a, b } = pair({ x: 0, y: 0, w: 5000, h: 4000 }, { x: 4000, y: 2000, w: 3000, h: 3000 });
  const door = createOpening('door', a.id, 1, 3000, 800); // правая стена, y ≈ 3000 — под верхней
  p.openings.push(door);
  eatOverlaps(p, [b.id]);
  const lostAfterEat = !p.openings.some((o) => o.id === door.id);
  b.x = 9000; b.y = 9000;
  eatOverlaps(p, [b.id]);
  assert.ok(lostAfterEat, 'проём пропал под верхней');
  assert.ok(p.openings.some((o) => o.id === door.id), 'проём вернулся');
});

test('узкий остаток 700 мм съедается (раньше отказ «меньше 900» оставлял красное)', () => {
  const { p, a, b } = pair({ x: 0, y: 0, w: 3000, h: 4000 }, { x: 800, y: -500, w: 4000, h: 6000 });
  const res = eatOverlaps(p, [b.id]);
  assert.equal(res.failed.length, 0);
  assert.equal(res.eaten.length, 1);
  assert.equal(a.w, 700);
  assert.equal(roomOverlaps(p).length, 0);
});

test('сдвинули съеденную нижнюю комнату — она возвращается целой на новом месте', () => {
  const { p, a, b } = pair({ x: 0, y: 0, w: 4000, h: 4000 }, { x: 3000, y: 3000, w: 3000, h: 3000 });
  eatOverlaps(p, [b.id]);
  assert.ok(a.outline, 'нижняя съедена');
  a.x -= 6000; a.y -= 6000; // отодвинули нижнюю целиком (форма та же, место другое)
  const res = eatOverlaps(p, [a.id]);
  assert.equal(res.restored.length, 1);
  assert.equal(a.outline, undefined);
  assert.deepEqual([a.x, a.y, a.w, a.h], [-6000, -6000, 4000, 4000]);
  assert.equal(roomOverlaps(p).length, 0);
});

test('нижнюю сдвинули, но она всё ещё под верхней — теперь съедает верхнюю («последняя двигаемая сверху»)', () => {
  const { p, a, b } = pair({ x: 0, y: 0, w: 4000, h: 4000 }, { x: 3000, y: 3000, w: 3000, h: 3000 });
  eatOverlaps(p, [b.id]);
  a.x += 200; // чуть двинули
  eatOverlaps(p, [a.id]);
  assert.equal(roomOverlaps(p).length, 0, 'перекрытия нет');
});

test('группу (нижняя + съедавшая) сдвинули вместе — форма нижней не меняется', () => {
  const { p, a, b } = pair({ x: 0, y: 0, w: 4000, h: 4000 }, { x: 3000, y: 3000, w: 3000, h: 3000 });
  eatOverlaps(p, [b.id]);
  const area0 = roomShapeArea(a);
  for (const r of [a, b]) { r.x += 1500; r.y += 700; }
  eatOverlaps(p, [a.id, b.id]);
  assert.equal(roomShapeArea(a), area0);
  assert.ok(a.eatBase, 'база сдвинута вместе');
  b.x = 20000; // потом уехала съедавшая — нижняя возвращает полную форму на новом месте
  eatOverlaps(p, [b.id]);
  assert.equal(a.outline, undefined);
  assert.deepEqual([a.x, a.y, a.w, a.h], [1500, 700, 4000, 4000]);
});
