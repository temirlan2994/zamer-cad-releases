// Временные размеры выбранной мебели (core/temp-dims.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createProject, createRoom, createItem } from '../core/model.js';
import { moveItemToDistance, planTempDimMove, tempDimensions } from '../core/temp-dims.js';

// Комната 5×4 м с началом в (0,0); стол 1200×800 с центром (1500, 2000).
function setup() {
  const p = createProject();
  const r = createRoom('living', 0, 0, 5000, 4000);
  p.rooms.push(r);
  const table = createItem('table', 1500, 2000, 1200, 800);
  p.items.push(table);
  return { p, r, table };
}
const byDir = (dims) => Object.fromEntries(dims.map((d) => [d.dir, d]));

test('до стен комнаты в четыре стороны', () => {
  const { p, table } = setup();
  const d = byDir(tempDimensions(p, table));
  assert.equal(d.left.value, 900);
  assert.equal(d.right.value, 2900);
  assert.equal(d.up.value, 1600);
  assert.equal(d.down.value, 1600);
  assert.equal(d.left.targetKind, 'wall');
  assert.deepEqual(d.left.from, { x: 900, y: 2000 });
  assert.deepEqual(d.left.to, { x: 0, y: 2000 });
});

test('ближайшая мебель в полосе проекции, а не за её пределами', () => {
  const { p, table } = setup();
  const sofa = createItem('sofa', 3500, 2200, 1000, 800); // справа, в полосе стола
  const off = createItem('chair', 2500, 500, 400, 400); // справа выше полосы — не цель
  p.items.push(sofa, off);
  const d = byDir(tempDimensions(p, table));
  assert.equal(d.right.value, 3000 - 2100);
  assert.equal(d.right.targetKind, 'item');
  assert.equal(d.right.targetId, sofa.id);
  // Линия — по середине общего участка проекций (y 1800..2400 ∩ 1600..2400).
  assert.equal(d.right.from.y, 2100);
});

test('вплотную — размер скрыт; дальше 6 м — скрыт', () => {
  const p = createProject();
  p.rooms.push(createRoom('living', 0, 0, 9000, 3000));
  const t = createItem('table', 600, 1500, 1200, 800); // левая грань у стены
  p.items.push(t);
  const d = byDir(tempDimensions(p, t));
  assert.equal(d.left, undefined);
  assert.equal(d.right, undefined); // 7800 > 6000
  assert.ok(byDir(tempDimensions(p, t, { keepZero: true, maxDist: Infinity })).left.value === 0);
});

test('повёрнутый предмет — по описывающему габариту', () => {
  const { p, table } = setup();
  table.rotation = 90; // 800 × 1200 в осях дома
  const d = byDir(tempDimensions(p, table));
  assert.equal(d.left.value, 1100);
  assert.equal(d.up.value, 1400);
});

test('вне комнаты — размеров нет', () => {
  const { p } = setup();
  const lost = createItem('table', 9000, 9000, 1000, 1000);
  p.items.push(lost);
  assert.deepEqual(tempDimensions(p, lost), []);
});

test('сдвиг на заданное расстояние, размер не меняется', () => {
  const { p, table } = setup();
  const d = byDir(tempDimensions(p, table));
  assert.deepEqual(moveItemToDistance(table, d.left, 500), { x: 1100, y: 2000 });
  assert.deepEqual(moveItemToDistance(table, d.right, 500), { x: 3900, y: 2000 });
  assert.deepEqual(moveItemToDistance(table, d.up, 0), { x: 1500, y: 400 });
  assert.deepEqual(moveItemToDistance(table, d.down, 100), { x: 1500, y: 3500 });
  const plan = planTempDimMove(p, table, 'left', 500);
  assert.equal(plan.ok, true);
  assert.equal(plan.x, 1100);
  table.x = plan.x;
  const after = byDir(tempDimensions(p, table));
  assert.equal(after.left.value, 500);
  assert.equal(after.right.value, 3300); // противоположное — само
});

test('недопустимый ввод: упор в мебель, выход из комнаты, отрицательное', () => {
  const { p, table } = setup();
  const sofa = createItem('sofa', 3500, 2000, 1000, 800);
  p.items.push(sofa);
  // Слева 900, справа до дивана 900: дальше 1800 от стены — упрётся в диван.
  assert.equal(planTempDimMove(p, table, 'left', 1800).ok, true);
  const bad = planTempDimMove(p, table, 'left', 1801);
  assert.equal(bad.ok, false);
  assert.match(bad.reason, /мебель/);
  assert.equal(planTempDimMove(p, table, 'up', 3300).ok, false); // 1600 + 1600 = 3200 свободно
  assert.equal(planTempDimMove(p, table, 'up', -10).ok, false);
});

function bedroomGroup() {
  const p = createProject();
  p.rooms.push(createRoom('bedroom', 0, 0, 6000, 5000));
  const bed = createItem('bed-double', 3000, 2500, 1600, 2000);
  const left = createItem('nightstand', 1800, 3250, 500, 500);
  const right = createItem('nightstand', 4200, 3250, 500, 500);
  const items = [bed, left, right];
  p.items.push(...items);
  return { p, items };
}

test('кровать с тумбами: расстояния от общей рамки, участники группы не препятствия', () => {
  const { p, items } = bedroomGroup();
  const d = byDir(tempDimensions(p, items));
  assert.deepEqual(Object.fromEntries(Object.entries(d).map(([dir, dim]) => [dir, dim.value])), {
    left: 1550, right: 1550, up: 1500, down: 1500,
  });
  assert.ok(Object.values(d).every((dim) => dim.targetKind === 'wall'));
  const cabinet = createItem('wardrobe', 5200, 3000, 600, 800);
  p.items.push(cabinet);
  const withCabinet = byDir(tempDimensions(p, items));
  assert.equal(withCabinet.right.value, 450);
  assert.equal(withCabinet.right.targetId, cabinet.id);
});

test('отступ группы перемещает общий центр и учитывает свободное место целиком', () => {
  const { p, items } = bedroomGroup();
  const before = JSON.stringify(items);
  assert.deepEqual(planTempDimMove(p, items, 'left', 500), { ok: true, x: 1950, y: 2500 });
  assert.equal(planTempDimMove(p, items, 'left', 3100).ok, true);
  assert.equal(planTempDimMove(p, items, 'left', 3101).ok, false);
  assert.equal(JSON.stringify(items), before, 'планирование не меняет предметы');
});

test('группа из разных комнат и пустая группа не дают общего размера комнаты', () => {
  const { p, items } = bedroomGroup();
  p.rooms.push(createRoom('bedroom', 7000, 0, 4000, 5000));
  items[2].x = 9000;
  assert.deepEqual(tempDimensions(p, items), []);
  assert.deepEqual(tempDimensions(p, []), []);
});
