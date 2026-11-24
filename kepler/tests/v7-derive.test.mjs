// derive v7: чистота, путь-независимость, косые стены, Г-блок, T-стык,
// проёмы, «разобрать на стены», производительность.
import test from 'node:test';
import assert from 'node:assert/strict';
import { area, pointInPolygon, rectRing, union } from '../core/geom/index.js';
import {
  addBlock, addOpening, addWall, blockHasWalls, createBlock, createOpening7, createProject7, createWall, moveBlock, raiseBlock,
  removeBlock, resizeBlock,
} from '../core/v7/model.js';
import { derive, totalArea } from '../core/v7/derive.js';
import { explodeBlock } from '../core/v7/explode.js';
import { fromV6 } from '../core/v7/migrate.js';
import { nestedRoom, eatChain } from './wall-fixtures.mjs';
import { TEMPLATES } from '../core/templates.js';
import { rng } from './v7-geom.test.mjs';

const clone = (x) => JSON.parse(JSON.stringify(x));
const fresh = (p, opts = {}) => derive(p, { cache: false, ...opts });

function project(rects) {
  const p = createProject7();
  rects.forEach(([x, y, w, h, type = 'living'], i) => {
    const b = createBlock(type, x, y, w, h);
    b.id = `b${i}`;
    addBlock(p, b);
  });
  return p;
}

const level = (p) => p.levels[0];
const room = (res, id) => res.rooms.find((r) => r.id === id);

test('derive — чистая, детерминированная, кешируется', () => {
  const p = project([[0, 0, 4000, 4000], [3000, 3000, 3000, 3000], [7100, 0, 3000, 3000]]);
  const before = JSON.stringify(p);
  const a = fresh(p);
  assert.equal(JSON.stringify(p), before, 'вход не меняется');
  assert.deepEqual(fresh(clone(p)), a, 'та же истина → тот же результат');
  assert.deepEqual(fresh(p), a, 'идемпотентна');
  const shuffled = clone(p);
  level(shuffled).blocks.reverse();
  assert.deepEqual(fresh(shuffled), a, 'порядок массива не влияет (порядок — z, id)');
  assert.equal(derive(p), derive(p), 'кеш по входу');
  assert.equal(room(a, 'b0').areaNet, 16 - 1.1 * 1.1, 'съедание с зазором перегородки');
});

test('путь-независимость: случайные операции = построение итога с нуля', () => {
  const r = rng(2026);
  const ops = ['move', 'move', 'move', 'resize', 'raise', 'add', 'remove'];
  for (let seqNo = 0; seqNo < 30; seqNo += 1) {
    const p = project([[0, 0, 4000, 3000], [4100, 0, 3000, 3000], [0, 3100, 7100, 3000]]);
    let next = 3;
    for (let k = 0; k < 10; k += 1) {
      const L = level(p);
      const op = ops[Math.floor(r() * ops.length)];
      const pick = L.blocks[Math.floor(r() * L.blocks.length)];
      if (op === 'add' || !pick) {
        const b = createBlock('bedroom', Math.round(r() * 60) * 100, Math.round(r() * 60) * 100, 2000 + Math.round(r() * 30) * 100, 2000 + Math.round(r() * 30) * 100);
        b.id = `n${next += 1}`;
        addBlock(p, b);
      } else if (op === 'move') moveBlock(p, pick.id, (Math.round(r() * 40) - 20) * 100, (Math.round(r() * 40) - 20) * 100);
      else if (op === 'resize') resizeBlock(p, pick.id, { w: 1500 + Math.round(r() * 40) * 100, h: 1500 + Math.round(r() * 40) * 100 });
      else if (op === 'raise') raiseBlock(p, pick.id);
      else if (L.blocks.length > 1) removeBlock(p, pick.id);
      fresh(p); // промежуточные derive не должны ничего «запомнить»
    }
    // Итоговое состояние — с нуля, в перемешанном порядке.
    const scratch = createProject7();
    const finalBlocks = clone(level(p).blocks);
    for (let i = finalBlocks.length - 1; i > 0; i -= 1) {
      const j = Math.floor(r() * (i + 1));
      [finalBlocks[i], finalBlocks[j]] = [finalBlocks[j], finalBlocks[i]];
    }
    for (const b of finalBlocks) addBlock(scratch, b, { top: false });
    assert.deepEqual(fresh(scratch), fresh(p), `последовательность ${seqNo}`);
  }
});

test('блок сдвинули поверх другого и убрали обратно — нижний ровно номинальный', () => {
  const p = project([[0, 0, 5000, 4000], [6000, 0, 3000, 3000]]);
  const start = fresh(p);
  moveBlock(p, 'b1', -3000, 1000);
  const over = fresh(p);
  assert.equal(over.carved.b0.eaten, true);
  assert.ok(room(over, 'b0').areaNet < 20);
  moveBlock(p, 'b1', 3000, -1000);
  const back = fresh(p);
  assert.deepEqual(back.carved.b0.shape, back.carved.b0.nominal);
  assert.deepEqual(back.rooms, start.rooms);
  assert.deepEqual(back.outline, start.outline);
  // Нижний тронули (он стал верхним) — теперь он ест верхний, не наоборот.
  moveBlock(p, 'b1', -3000, 1000);
  raiseBlock(p, 'b0');
  const swapped = fresh(p);
  assert.equal(room(swapped, 'b0').areaNet, 20);
  assert.equal(swapped.carved.b1.eaten, true);
});

test('несъедаемые перекрытия: whole / split / small — форма номинальная, причина в issues', () => {
  const whole = fresh(project([[1000, 1000, 2000, 2000], [0, 0, 5000, 5000]]));
  assert.equal(whole.carved.b0.status, 'whole');
  assert.deepEqual(whole.carved.b0.shape, whole.carved.b0.nominal);
  assert.deepEqual(whole.issues.map((i) => [i.block, i.why]), [['b0', 'whole']]);
  const split = fresh(project([[0, 0, 6000, 3000], [2500, -500, 1000, 4000]]));
  assert.equal(split.carved.b0.status, 'split');
  const small = fresh(project([[0, 0, 3000, 3000], [-100, 400, 3600, 3000]]));
  assert.equal(small.carved.b0.status, 'small');
  const p = project([[0, 0, 6000, 4000], [3000, 3000, 3000, 3000]]);
  const child = createBlock('bathroom', 4000, 1000, 1500, 2500);
  child.id = 'c'; child.parentId = 'b0';
  addBlock(p, child);
  const ch = fresh(p);
  assert.equal(ch.carved.b0.status, 'children');
});

function slantedSquare(deg, side = 5000, t = 200) {
  const p = createProject7();
  const c = Math.cos((deg * Math.PI) / 180); const s = Math.sin((deg * Math.PI) / 180);
  const pts = [[0, 0], [side, 0], [side, side], [0, side]].map(([x, y]) => ({ x: 10000 + x * c - y * s, y: 10000 + x * s + y * c }));
  pts.forEach((a, i) => addWall(p, createWall(a, pts[(i + 1) % 4], { thickness: t })));
  return p;
}

test('косые стены 30° и 45°: стыки без щелей, площадь комнаты из 4 стен', () => {
  for (const deg of [30, 45]) {
    const res = fresh(slantedSquare(deg));
    assert.equal(res.outline.length, 1, `${deg}°: одно тело`);
    assert.equal(res.outline[0].length, 2, `${deg}°: одна дыра`);
    assert.equal(res.rooms.length, 1);
    assert.ok(Math.abs(res.rooms[0].areaNet - 4.8 * 4.8) < 0.01, `${deg}°: ${res.rooms[0].areaNet}`);
    // Внешний контур — повёрнутый квадрат 5200: миттеры на углах.
    assert.ok(Math.abs(area([res.outline[0][0]]) / 1e6 - 5.2 * 5.2) < 0.01);
    assert.equal(res.outline[0][0].length, 4);
  }
  // Параллелограмм 60°: внутренняя площадь (b·sinφ − t)(a·sinφ − t)/sinφ.
  const p = createProject7();
  const a = 6000; const b = 4000; const phi = Math.PI / 3; const t = 200;
  const pts = [{ x: 0, y: 0 }, { x: a, y: 0 }, { x: a + b * Math.cos(phi), y: b * Math.sin(phi) }, { x: b * Math.cos(phi), y: b * Math.sin(phi) }];
  pts.forEach((q, i) => addWall(p, createWall(q, pts[(i + 1) % 4], { thickness: t })));
  const res = fresh(p);
  const sin = Math.sin(phi);
  const expect = ((b * sin - t) * (a * sin - t)) / sin / 1e6;
  assert.equal(res.rooms.length, 1);
  assert.ok(Math.abs(res.rooms[0].areaNet - expect) < 0.01, `${res.rooms[0].areaNet} ≈ ${expect}`);
});

test('Г-блок: стены по контуру, площадь = площадь формы', () => {
  const p = createProject7();
  const b = createBlock('living', 1000, 1000, 0, 0, {
    id: 'L', shape: { kind: 'poly', pts: [{ x: 0, y: 0 }, { x: 6000, y: 0 }, { x: 6000, y: 3000 }, { x: 3000, y: 3000 }, { x: 3000, y: 5000 }, { x: 0, y: 5000 }] },
  });
  addBlock(p, b);
  const res = fresh(p);
  assert.equal(res.rooms.length, 1);
  assert.equal(res.rooms[0].areaNet, 24);
  assert.equal(res.rooms[0].name, b.name);
  assert.equal(res.walls.length, 6);
  assert.equal(res.outline.length, 1);
  assert.equal(res.outline[0][0].length, 6, 'внешний контур — тоже Г (миттер во внутреннем углу)');
  // Поворот блока на 90° — та же площадь.
  b.rotation = 90;
  assert.equal(fresh(p).rooms[0].areaNet, 24);
});

test('T-стык: блоки (три комнаты, одна общая стена ведёт узел) и ручные стены', () => {
  const res = fresh(project([[0, 0, 4000, 3000], [4100, 0, 3900, 3000], [0, 3100, 8000, 3000]]));
  assert.deepEqual(res.rooms.map((r) => [r.id, r.areaNet]), [['b0', 12], ['b1', 11.7], ['b2', 24]]);
  assert.equal(res.outline.length, 1);
  assert.equal(res.outline[0].length, 4, '3 дыры-комнаты');
  assert.equal(res.gaps.length, 0, 'щелей в узле нет');
  // Ручной T: стойка кончается на оси перекладины.
  const p = createProject7();
  addWall(p, createWall({ x: 0, y: 0 }, { x: 4000, y: 0 }, { thickness: 200 }));
  addWall(p, createWall({ x: 2000, y: 0 }, { x: 2000, y: 3000 }, { thickness: 100 }));
  const t = fresh(p);
  assert.equal(t.outline.length, 1);
  assert.equal(t.outline[0].length, 1, 'без дыр');
  assert.equal(area(t.outline), 4000 * 200 + 2900 * 100);
});

test('проёмы: на ребре блока, на общей стене, на ручной стене; сирота без памяти', () => {
  const p = project([[0, 0, 4000, 3000], [4100, 0, 4000, 3000]]);
  addOpening(p, createOpening7('window', { blockId: 'b0', edge: 0, offset: 2000 }, 1200, { id: 'win' }));
  addOpening(p, createOpening7('door', { blockId: 'b0', edge: 1, offset: 1500 }, 800, { id: 'door' }));
  const res = fresh(p);
  const win = res.openings.find((o) => o.id === 'win');
  const door = res.openings.find((o) => o.id === 'door');
  const wb = (id) => res.wallBodies.find((w) => w.id === id);
  assert.equal(wb(win.wallId).blockId, 'b0');
  assert.deepEqual(wb(door.wallId).pair, ['b0', 'b1'], 'дверь между комнатами — на общей стене');
  assert.ok(Math.abs(area(wb(win.wallId).polygon) - area(wb(win.wallId).cut) - 1200 * 250) < 1);
  assert.ok(Math.abs(area(wb(door.wallId).polygon) - area(wb(door.wallId).cut) - 800 * 100) < 1);
  assert.equal(res.rooms.length, 2, 'проёмы не сливают помещения');
  // Ручная стена с проёмом.
  const w = addWall(p, createWall({ x: 0, y: 5000 }, { x: 4000, y: 5000 }, { thickness: 200, id: 'mw' }));
  addOpening(p, createOpening7('door', { wallId: w.id, t: 1000 }, 900, { id: 'd2' }));
  assert.equal(fresh(p).openings.find((o) => o.id === 'd2').wallId, 'mw');
  // Окно на ребре, которое съел верхний блок, — сирота; блок ушёл — окно вернулось.
  const top = createBlock('kitchen', 1000, -1500, 2000, 2000);
  top.id = 'top';
  addBlock(p, top);
  assert.ok(fresh(p).issues.some((i) => i.kind === 'opening-orphan' && i.opening === 'win'));
  moveBlock(p, 'top', 0, -3000);
  assert.ok(fresh(p).openings.some((o) => o.id === 'win'));
});

const roomsView = (res) => res.rooms.map((r) => ({ id: r.id, name: r.name, type: r.type, polygon: r.polygon, areaNet: r.areaNet }));

test('explodeBlock не меняет помещения (шаблоны и съеденный блок)', () => {
  const cases = TEMPLATES.map((t) => [t.id, fromV6(t.build())]);
  cases.push(['v6 nestedRoom', fromV6(nestedRoom())], ['v6 eatChain', fromV6(eatChain())]);
  cases.push(['съедание', project([[0, 0, 4000, 4000], [3000, 3000, 3000, 3000], [7100, 0, 3000, 3000]])]);
  const nested = project([[0, 0, 6000, 5000], [6100, 0, 3000, 5000]]);
  const child = createBlock('bathroom', 1000, 1000, 2000, 1500, { id: 'c', parentId: 'b0' });
  addBlock(nested, child);
  addOpening(nested, createOpening7('door', { blockId: 'c', edge: 2, offset: 1000 }, 700, { id: 'cd' }));
  addOpening(nested, createOpening7('window', { blockId: 'b0', edge: 0, offset: 3000 }, 1500, { id: 'pw' }));
  cases.push(['вложенный', nested]);
  for (const [name, p] of cases) {
    for (const L of p.levels) {
      const base = fresh(p, { levelId: L.id });
      for (const b of L.blocks) {
        const q = clone(p);
        assert.equal(explodeBlock(q, b.id, { levelId: L.id }).ok, blockHasWalls(b));
        const res = fresh(q, { levelId: L.id });
        assert.deepEqual(roomsView(res), roomsView(base), `${name}/${L.id}: разобран ${b.id}`);
        assert.ok(Math.abs(area(res.outline) - area(base.outline)) < 1, `${name}: тело стен то же`);
        assert.equal(res.openings.length, base.openings.length, `${name}: проёмы на месте`);
      }
      // Все блоки этажа по очереди.
      const q = clone(p);
      for (const b of q.levels.find((x) => x.id === L.id).blocks.map((x) => x.id)) explodeBlock(q, b, { levelId: L.id });
      assert.deepEqual(roomsView(fresh(q, { levelId: L.id })), roomsView(base), `${name}/${L.id}: разобраны все`);
    }
  }
});

test('ручная стена через блок делит помещение; семя даёт имя области из стен', () => {
  const p = project([[0, 0, 6000, 4000]]);
  addWall(p, createWall({ x: 3000, y: 0 }, { x: 3000, y: 4000 }, { thickness: 100 }));
  const res = fresh(p);
  assert.deepEqual(res.rooms.map((r) => r.id), ['b0', 'b0#2']);
  assert.ok(Math.abs(totalArea(res) - (24 - 0.4)) < 1e-9);
  const q = slantedSquare(30);
  level(q).seeds.push({ id: 's1', x: 10000 + 1000, y: 10000 + 2500, name: 'Холл', type: 'hall' });
  const named = fresh(q);
  assert.equal(named.rooms[0].name, 'Холл');
  assert.equal(named.rooms[0].id, 's1');
  assert.ok(pointInPolygon([named.rooms[0].polygon], named.rooms[0].label, 0));
});

test('производительность: 30 блоков / 150+ стен < 100 мс', () => {
  const p = createProject7();
  let n = 0;
  for (let i = 0; i < 6; i += 1) {
    for (let j = 0; j < 5; j += 1) {
      const w = 3000 + ((i * 7 + j * 3) % 5) * 200; const h = 3500;
      const b = createBlock('bedroom', i * 4100, j * 3600, Math.min(w, 4000), h);
      b.id = `g${n += 1}`;
      addBlock(p, b);
      // В каждом блоке — ручная перегородка (шкаф) косо и прямо.
      addWall(p, createWall({ x: i * 4100 + 500, y: j * 3600 + 500 }, { x: i * 4100 + 1500, y: j * 3600 + 1200 }, { thickness: 100 }));
      addWall(p, createWall({ x: i * 4100 + 2000, y: j * 3600 + 2500 }, { x: i * 4100 + 2000, y: j * 3600 + 3500 }, { thickness: 100 }));
    }
  }
  // Пара блоков внахлёст — съедание в нагрузке.
  moveBlock(p, 'g7', 500, 400);
  let best = Infinity; let res;
  for (let k = 0; k < 3; k += 1) {
    const t = performance.now();
    res = fresh(p);
    best = Math.min(best, performance.now() - t);
  }
  assert.ok(res.walls.length >= 150, `стен ${res.walls.length}`);
  assert.ok(best < 100, `derive ${best.toFixed(1)} мс`);
});

test('рамка ui не нужна: результат — простые данные (полигоны мм)', () => {
  const res = fresh(project([[0, 0, 3000, 3000]]));
  assert.deepEqual(union([rectRing(0, 0, 3000, 3000)]), [res.rooms[0].polygon]);
});
