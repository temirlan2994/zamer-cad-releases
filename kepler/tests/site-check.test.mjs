// Дом на участке: сдвиг целиком (building.origin) и проверка положения.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rotateBuildingAbout, toWorld } from '../core/building.js';
import { createProject, createRoom } from '../core/model.js';
import { siteWarning } from '../core/rooms.js';
import {
  buildingFootprint, buildingSiteCheck, moveBuilding, panForMovedBuilding, pointInBuilding, polygonsDistance,
  setBuildingOrigin,
} from '../core/site-check.js';
import { projectPoint } from '../render.js';

const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

// Участок 20×20 м, отступ 1.5 м → зона от 1500 до 18500. Комната 4×4 м,
// с наружными стенами (250) — 4.5×4.5 м.
function project() {
  const p = createProject();
  p.site.boundary = [{ x: 0, y: 0 }, { x: 20000, y: 0 }, { x: 20000, y: 20000 }, { x: 0, y: 20000 }];
  p.rooms.push(createRoom('living', 0, 0, 4000, 4000));
  p.building = { rotation: 0, origin: { x: 5000, y: 5000 } };
  return p;
}

test('сдвиг дома меняет только origin, поворот сохраняется', () => {
  const b = { rotation: 30, origin: { x: 100, y: 200 } };
  const m = moveBuilding(b, 1000, -500);
  assert.deepEqual(m.origin, { x: 1100, y: -300 });
  assert.equal(m.rotation, 30);
  assert.deepEqual(b.origin, { x: 100, y: 200 }, 'исходный объект не меняется');
  assert.deepEqual(setBuildingOrigin(b, 7000, 8000).origin, { x: 7000, y: 8000 });
  assert.deepEqual(moveBuilding(null, 10, 20).origin, { x: 10, y: 20 });
});

test('мировые координаты комнат смещаются вместе с домом (и при повороте)', () => {
  const p = project();
  p.building = rotateBuildingAbout(p.building, { x: 2000, y: 2000 }, 40);
  const room = p.rooms[0];
  const before = toWorld(p.building, { x: room.x, y: room.y });
  const fpBefore = buildingFootprint(p)[0].corners;
  p.building = moveBuilding(p.building, 3000, -1000);
  const after = toWorld(p.building, { x: room.x, y: room.y });
  assert.ok(near(after.x - before.x, 3000) && near(after.y - before.y, -1000));
  const fpAfter = buildingFootprint(p)[0].corners;
  fpAfter.forEach((c, i) => {
    assert.ok(near(c.x - fpBefore[i].x, 3000) && near(c.y - fpBefore[i].y, -1000));
  });
  assert.equal(room.x, 0, 'локальные координаты комнаты не меняются');
  assert.ok(pointInBuilding(p, toWorld(p.building, { x: 2000, y: 2000 })));
  assert.ok(!pointInBuilding(p, { x: -50000, y: 0 }));
});

test('проверка зоны застройки: N мм выхода', () => {
  const p = project();
  let check = buildingSiteCheck(p);
  assert.equal(check.zoneOverflow, 0);
  assert.ok(check.ok);
  // Левый край пятна дома: origin.x − 250. Зона начинается с 1500.
  p.building = setBuildingOrigin(p.building, 1500 + 250 - 300, 5000);
  check = buildingSiteCheck(p);
  assert.equal(check.zoneOverflow, 300);
  assert.match(check.issues[0], /выходит за зону застройки на 300 мм/);
  assert.ok(!check.ok);
  assert.ok(siteWarning(p), 'старое предупреждение согласовано');
  // Без границы участка — проверки зоны нет.
  p.site.boundary = null;
  assert.equal(buildingSiteCheck(p).zoneOverflow, null);
});

test('проверка отступа до соседа', () => {
  const p = project();
  // Пятно дома: 4750…9250 по X. Сосед 4×4 м с центром справа.
  p.site.neighbors = [{ id: 'n1', x: 9250 + 4000 + 2000, y: 7000, w: 4000, h: 4000, rot: 0 }];
  let check = buildingSiteCheck(p);
  assert.ok(near(check.neighborGap, 4000));
  assert.equal(check.neighborId, 'n1');
  assert.match(check.issues.join(), /До соседа 4 м < 6 м/);
  p.building = moveBuilding(p.building, -2500, 0);
  check = buildingSiteCheck(p);
  assert.ok(near(check.neighborGap, 6500));
  assert.ok(check.ok);
  // Пересечение — расстояние 0.
  p.building = setBuildingOrigin(p.building, 12000, 6000);
  assert.equal(buildingSiteCheck(p).neighborGap, 0);
});

test('расстояние между многоугольниками', () => {
  const sq = (x, y, s) => [{ x, y }, { x: x + s, y }, { x: x + s, y: y + s }, { x, y: y + s }];
  assert.equal(polygonsDistance(sq(0, 0, 10), sq(20, 0, 10)), 10);
  assert.ok(near(polygonsDistance(sq(0, 0, 10), sq(13, 14, 10)), 5));
  assert.equal(polygonsDistance(sq(0, 0, 10), sq(5, 5, 10)), 0);
  // Крест: вершины не внутри, но рёбра пересекаются.
  const bar1 = [{ x: -10, y: -1 }, { x: 10, y: -1 }, { x: 10, y: 1 }, { x: -10, y: 1 }];
  const bar2 = [{ x: -1, y: -10 }, { x: 1, y: -10 }, { x: 1, y: 10 }, { x: -1, y: 10 }];
  assert.equal(polygonsDistance(bar1, bar2), 0);
});

test('вид «Плана» едет за сдвинутым домом: дом на том же месте экрана', () => {
  const view = { scale: 0.05, rotation: -0.7, panX: 300, panY: 200 };
  const b = { rotation: 40, origin: { x: 1000, y: 2000 } };
  const local = { x: 3000, y: 1500 };
  const before = projectPoint(view, ...Object.values(toWorld(b, local)));
  const moved = moveBuilding(b, 4500, -2500);
  const v2 = { ...view, ...panForMovedBuilding(view, 4500, -2500) };
  const after = projectPoint(v2, ...Object.values(toWorld(moved, local)));
  assert.ok(near(before.x, after.x) && near(before.y, after.y));
});

test('пустой дом — замечаний нет', () => {
  const p = createProject();
  p.site.boundary = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }];
  const check = buildingSiteCheck(p);
  assert.ok(check.ok);
  assert.equal(check.footprint.length, 0);
});
