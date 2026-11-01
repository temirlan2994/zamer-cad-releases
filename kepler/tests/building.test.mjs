// Система координат дома: комнаты в осях дома, участок — в координатах съёмки.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  toWorld, toLocal, rectCornersWorld, rotateBuildingAbout, composeView,
  rotationAlongLine, buildingCenter, northInBuilding,
} from '../core/building.js';
import { projectPoint } from '../render.js';
import { createProject, createRoom } from '../core/model.js';
import { validateRoomPlacement, siteWarning } from '../core/rooms.js';

const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;
const nearPt = (p, q, eps = 1e-6) => near(p.x, q.x, eps) && near(p.y, q.y, eps);

test('мир ↔ оси дома: туда и обратно', () => {
  const b = { rotation: 30, origin: { x: 5000, y: -2000 } };
  const local = { x: 1234, y: 5678 };
  assert.ok(nearPt(toLocal(b, toWorld(b, local)), local));
  // Ось X дома в мире идёт под 30° по часовой (Y вниз).
  const ax = toWorld(b, { x: 1000, y: 0 });
  assert.ok(near(Math.atan2(ax.y - b.origin.y, ax.x - b.origin.x) * 180 / Math.PI, 30));
});

test('поворот на месте: опорная точка остаётся там же в мире', () => {
  const b0 = { rotation: 10, origin: { x: 300, y: 400 } };
  const pivot = { x: 4000, y: 2500 };
  const before = toWorld(b0, pivot);
  const b1 = rotateBuildingAbout(b0, pivot, 47);
  assert.equal(b1.rotation, 47);
  assert.ok(nearPt(toWorld(b1, pivot), before));
});

test('вид дома = вид мира, повёрнутый на поворот дома', () => {
  const view = { scale: 0.07, rotation: -0.4, panX: 120, panY: 80 };
  const b = { rotation: 23, origin: { x: 1500, y: -700 } };
  const pv = composeView(view, b);
  for (const p of [{ x: 0, y: 0 }, { x: 5000, y: 3000 }, { x: -1200, y: 800 }]) {
    assert.ok(nearPt(projectPoint(pv, p.x, p.y), projectPoint(view, toWorld(b, p).x, toWorld(b, p).y), 1e-6));
  }
});

test('выравнивание по линии: ближайший к текущему вариант из шага 90°', () => {
  assert.equal(rotationAlongLine(0, 30), 30);
  assert.equal(rotationAlongLine(0, 100), 10);
  assert.equal(rotationAlongLine(0, -80), 10);
  assert.equal(rotationAlongLine(350, 30), 30);
  assert.equal(rotationAlongLine(0, -30), 330);
});

test('север в осях дома и центр дома', () => {
  assert.equal(northInBuilding(12, { rotation: 30 }), 342);
  const p = createProject();
  assert.equal(buildingCenter(p), null);
  p.rooms.push(createRoom('living', 0, 0, 4000, 2000), createRoom('kitchen', 4100, 0, 2000, 3000));
  assert.deepEqual(buildingCenter(p), { x: 3050, y: 1500 });
});

test('зона застройки проверяется по настоящим (повёрнутым) углам дома', () => {
  const p = createProject();
  // Участок 20×20 м, отступ 1.5 м → зона 17×17 м (от 1500 до 18500).
  p.site.boundary = [{ x: 0, y: 0 }, { x: 20000, y: 0 }, { x: 20000, y: 20000 }, { x: 0, y: 20000 }];
  // Квадратная комната: с наружными стенами 15×15 м в центре участка.
  const room = createRoom('living', 2750, 2750, 14500, 14500);
  p.rooms.push(room);
  assert.equal(validateRoomPlacement(p, room, room.id).warning, undefined, 'без поворота влезает');
  assert.equal(siteWarning(p), null);
  // Поворот на 45° вокруг центра: диагональ 21 м уже не влезает в 17 м.
  p.building = rotateBuildingAbout(p.building, { x: 10000, y: 10000 }, 45);
  assert.match(validateRoomPlacement(p, room, room.id).warning || '', /границ/);
  assert.match(siteWarning(p) || '', /границ/);
  // Уголки в мире действительно повёрнуты.
  const c = rectCornersWorld(p.building, room);
  assert.ok(near(Math.atan2(c[1].y - c[0].y, c[1].x - c[0].x) * 180 / Math.PI, 45));
});

// --- Экспорт с поворотом дома ---
import { buildStructuredExport, buildProjectDxf, buildSitePlanDxf } from '../core/export.js';

// Габарит отрезков LINE на слое (DXF: пары «код, значение», ось Y вверх).
function dxfLineBox(dxf, layer) {
  const t = dxf.split('\n');
  const box = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
  for (let i = 0; i < t.length - 1; i += 2) {
    if (t[i] !== '0' || t[i + 1] !== 'LINE') continue;
    const e = {};
    for (let j = i + 2; j < t.length - 1 && t[j] !== '0'; j += 2) e[t[j]] = t[j + 1];
    if (e['8'] !== layer) continue;
    for (const [x, y] of [[e['10'], e['20']], [e['11'], e['21']]]) {
      box.minX = Math.min(box.minX, +x); box.maxX = Math.max(box.maxX, +x);
      box.minY = Math.min(box.minY, -y); box.maxY = Math.max(box.maxY, -y);
    }
  }
  return box;
}

function houseOnSite(rotation) {
  const p = createProject();
  p.site.boundary = [{ x: -10000, y: -10000 }, { x: 15000, y: -10000 }, { x: 15000, y: 15000 }, { x: -10000, y: 15000 }];
  p.site.redLine = [{ x: -10000, y: -9000 }, { x: 15000, y: -9000 }];
  p.rooms.push(createRoom('living', 0, 0, 4000, 3000));
  p.building = { rotation, origin: { x: 0, y: 0 } };
  return p;
}

test('JSON для Revit: оси дома, поворот и север в осях дома', () => {
  const p = houseOnSite(30);
  p.site.north = 12;
  const data = buildStructuredExport(p);
  assert.equal(data.schema, 'kepler-export/2');
  assert.equal(data.building.rotation_deg, 30);
  assert.equal(data.building.true_north_deg, 342);
  assert.equal(data.site.frame, 'world');
  // Помещения — в осях дома (прямоугольник как есть).
  assert.deepEqual(data.levels[0].rooms[0].polygon[1], { x: 4000, y: 0 });
});

test('DXF плана — в осях дома: от поворота дома не зависит', () => {
  assert.equal(buildProjectDxf(houseOnSite(0)), buildProjectDxf(houseOnSite(37)));
});

test('DXF генплана: дом повёрнут, слои участка на месте', () => {
  const flat = dxfLineBox(buildSitePlanDxf(houseOnSite(0)), 'walls');
  const turned = dxfLineBox(buildSitePlanDxf(houseOnSite(90)), 'walls');
  // Без поворота дом тянется по X на 4 м; при 90° — по Y (x → -y).
  assert.ok(flat.maxX - flat.minX > turned.maxX - turned.minX + 500);
  assert.ok(turned.maxY - turned.minY > flat.maxY - flat.minY + 500);
  assert.ok(turned.maxX <= 400 && turned.minX < -3000, `x: ${turned.minX}…${turned.maxX}`);
  const dxf = buildSitePlanDxf(houseOnSite(30));
  for (const layer of ['site_boundary', 'red_line', 'build_zone']) assert.ok(dxf.includes(`\n${layer}\n`), layer);
  assert.ok(dxf.trim().endsWith('EOF'));
});
