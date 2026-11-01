// Тесты ядра участка: полигоны, зона застройки, солнце и тени.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createSite, polygonAreaM2, insetPolygon, checkRectBuildable,
  sunPosition, shadowVector, shadowPolygon, nearestPointOnPolyline,
} from '../core/site.js';

const rectPoly = (x, y, w, h) => [
  { x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h },
];

test('площадь полигона: участок 20×30 м = 600 м²', () => {
  assert.equal(polygonAreaM2(rectPoly(0, 0, 20000, 30000)), 600);
});

test('инсет границы: отступ 1,5 м уменьшает участок с каждой стороны', () => {
  const zone = insetPolygon(rectPoly(0, 0, 20000, 30000), 1500);
  assert.ok(zone);
  assert.ok(Math.abs(polygonAreaM2(zone) - 17 * 27) < 0.01);
  // Все вершины на 1500 мм внутри.
  for (const p of zone) {
    assert.ok(p.x >= 1499 && p.x <= 18501);
    assert.ok(p.y >= 1499 && p.y <= 28501);
  }
  // Обход полигона против часовой тоже работает.
  const ccw = insetPolygon(rectPoly(0, 0, 20000, 30000).reverse(), 1500);
  assert.ok(Math.abs(polygonAreaM2(ccw) - 17 * 27) < 0.01);
});

test('инсет схлопывается на маленьком участке', () => {
  assert.equal(insetPolygon(rectPoly(0, 0, 2000, 2000), 1500), null);
});

test('зона застройки: внутри можно, у границы и у соседа нельзя', () => {
  const site = createSite();
  site.boundary = rectPoly(0, 0, 20000, 30000);
  // Дом 10×8 м в центре — можно.
  assert.equal(checkRectBuildable(site, { x: 5000, y: 10000, w: 10000, h: 8000 }).ok, true);
  // Дом вплотную к границе — нельзя (отступ 1,5 м).
  const nearEdge = checkRectBuildable(site, { x: 500, y: 10000, w: 10000, h: 8000 });
  assert.equal(nearEdge.ok, false);
  assert.match(nearEdge.reason, /границу застройки/);
  // Сосед: дом ближе 6 м к соседнему — нельзя.
  site.neighbors = [{ id: 'n1', x: 25000, y: 15000, w: 8000, h: 8000, height: 6000 }];
  const nearNeighbor = checkRectBuildable(site, { x: 12000, y: 12000, w: 6000, h: 6000 });
  assert.equal(nearNeighbor.ok, false);
  assert.match(nearNeighbor.reason, /соседнему дому/);
  // Без границы участка ограничений нет.
  const free = createSite();
  assert.equal(checkRectBuildable(free, { x: -1e6, y: -1e6, w: 1000, h: 1000 }).ok, true);
});

test('солнце: Алматы, летнее солнцестояние, около солнечного полудня', () => {
  // Солнечный полдень ≈ 11:54 местного (UTC+5): высота ≈ 70°, азимут ≈ 180°.
  const noon = sunPosition(43.238, 76.889, 5, '2026-06-21', 11 * 60 + 54);
  assert.ok(noon.altitude > 68 && noon.altitude < 72, `высота ${noon.altitude}`);
  assert.ok(noon.azimuth > 170 && noon.azimuth < 190, `азимут ${noon.azimuth}`);
  // Через 25 минут после полудня солнце уже заметно западнее юга.
  const later = sunPosition(43.238, 76.889, 5, '2026-06-21', 12 * 60 + 20);
  assert.ok(later.azimuth > 185 && later.azimuth < 215, `азимут ${later.azimuth}`);
});

test('солнце: утром на востоке, вечером на западе', () => {
  const morning = sunPosition(43.238, 76.889, 5, '2026-06-21', 8 * 60);
  assert.ok(morning.azimuth > 60 && morning.azimuth < 120, `утро ${morning.azimuth}`);
  const evening = sunPosition(43.238, 76.889, 5, '2026-06-21', 19 * 60);
  assert.ok(evening.azimuth > 240 && evening.azimuth < 300, `вечер ${evening.azimuth}`);
  const night = sunPosition(43.238, 76.889, 5, '2026-06-21', 2 * 60);
  assert.ok(night.altitude < 0, 'ночью солнце за горизонтом');
});

test('солнце: на экваторе в равноденствие почти в зените', () => {
  const sun = sunPosition(0, 0, 0, '2026-03-20', 12 * 60);
  assert.ok(sun.altitude > 85, `высота ${sun.altitude}`);
});

test('тень: при высоте 45° длина тени равна высоте, направление от солнца', () => {
  // Солнце на юге (азимут 180), север вверх (0): тень строго на север (вверх, -y).
  const vector = shadowVector({ altitude: 45, azimuth: 180 }, 0, 6000);
  assert.ok(vector);
  assert.ok(Math.abs(vector.dx) < 1);
  assert.ok(Math.abs(vector.dy + 6000) < 1);
  // За горизонтом тени нет.
  assert.equal(shadowVector({ altitude: -5, azimuth: 100 }, 0, 6000), null);
  // Поворот севера переносит тень.
  const rotated = shadowVector({ altitude: 45, azimuth: 180 }, 90, 6000);
  assert.ok(Math.abs(rotated.dx - 6000) < 1, `dx=${rotated.dx}`); // север справа → юг слева → тень вправо
});

test('полигон тени накрывает исходный прямоугольник и сдвинутый', () => {
  const poly = shadowPolygon({ x: 0, y: 0, w: 4000, h: 3000 }, { dx: 2000, dy: -5000 });
  assert.ok(poly.length >= 5);
  assert.ok(polygonAreaM2(poly) > (4 * 3));
});

test('ближайшая точка на границе — для въезда', () => {
  const boundary = rectPoly(0, 0, 20000, 30000);
  const near = nearestPointOnPolyline(boundary, { x: 10000, y: -2000 }, true);
  assert.equal(Math.round(near.y), 0);
  assert.equal(Math.round(near.x), 10000);
  assert.ok(Math.abs(near.angle) < 1); // верхнее ребро горизонтально
});

// --- Буфер соседа поворачивается вместе с домом ---
import { neighborBuffers } from '../core/site.js';

test('буфер соседнего дома — повёрнутый полигон', () => {
  const site = { setbackNeighbor: 6000, neighbors: [{ id: 'n', x: 0, y: 0, w: 10000, h: 6000, rot: 30 }] };
  const [buf] = neighborBuffers(site);
  assert.equal(buf.poly.length, 4);
  // Сторона буфера = сторона дома + 2 отступа, и она повёрнута на 30°.
  const [a, b] = buf.poly;
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  assert.ok(Math.abs(len - 22000) < 1, `длина ${len}`);
  const ang = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
  assert.ok(Math.abs(ang - 30) < 1e-6, `угол ${ang}`);
});

test('проверка застройки учитывает повёрнутый буфер (SAT)', () => {
  const boundary = [{ x: -60000, y: -60000 }, { x: 60000, y: -60000 }, { x: 60000, y: 60000 }, { x: -60000, y: 60000 }];
  const site = { boundary, setbackBoundary: 1500, setbackNeighbor: 6000, neighbors: [{ id: 'n', x: 0, y: 0, w: 10000, h: 6000, rot: 45 }] };
  // Прямоугольник у угла AABB, но вне повёрнутого буфера — допустим.
  const farCorner = checkRectBuildable(site, { x: 9000, y: 9000, w: 2000, h: 2000 });
  assert.equal(farCorner.ok, true, farCorner.reason);
  // Прямоугольник рядом с центром — внутри буфера.
  const near = checkRectBuildable(site, { x: 2000, y: -1000, w: 2000, h: 2000 });
  assert.equal(near.ok, false);
});
